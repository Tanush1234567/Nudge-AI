"""Video analysis API endpoints — submit, poll status, fetch notes.

WHY: All endpoints require a valid Supabase access token. The Bearer token
is verified by `require_user` and the resulting user_id is used to scope
job ownership: users can only see and act on jobs they created.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.middleware import get_client_ip, require_user, validate_youtube_url
from db.jobs import (
    check_duplicate,
    count_completed_jobs,
    create_job,
    get_job,
    list_jobs,
)
from job_queue.worker import job_queue
from pipeline.download import extract_video_id

logger = logging.getLogger(__name__)

router = APIRouter()


class AnalyzeRequest(BaseModel):
    """Body for POST /analyze."""

    url: str
    # When true, skip the duplicate check and always start a fresh job.
    # Useful for re-testing the pipeline on a video already processed.
    force: bool = False


@router.post("/analyze")
async def analyze(
    body: AnalyzeRequest,
    request: Request,
    force: bool = False,
    user: dict = Depends(require_user),
) -> dict:
    """Submit a YouTube URL for analysis; returns a job id.

    `force` skips the duplicate check and can be passed either in the JSON
    body OR as a `?force=true` query parameter (handy for quick testing).
    """
    if not validate_youtube_url(body.url):
        raise HTTPException(status_code=400, detail="Not a valid YouTube URL")

    try:
        video_id = extract_video_id(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ip = get_client_ip(request)
    user_id = user["id"]

    if not (body.force or force):
        duplicate_id = await check_duplicate(video_id, user_id=user_id)
        if duplicate_id:
            return {"job_id": duplicate_id, "status": "complete"}

    job_id = await create_job(body.url, video_id, user_id=user_id, ip=ip)
    await job_queue.enqueue(job_id, body.url)

    return {"job_id": job_id, "status": "queued"}


@router.get("/status/{job_id}")
async def status(job_id: str, user: dict = Depends(require_user)) -> dict:
    """Return the current processing status of a job."""
    job = await get_job(job_id)
    if job is None or job.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job["id"],
        "status": job.get("status"),
        "progress": job.get("progress", 0),
        "stage_detail": job.get("stage_detail"),
        "frames_found": job.get("frames_captured"),
        "video_title": job.get("video_title"),
        "video_channel": job.get("video_channel"),
        "video_duration": job.get("video_duration"),
        "error_message": job.get("error_message"),
    }


def _ensure_html_summary(summary: str) -> str:
    if not summary:
        return ""
    if summary.strip().startswith("<"):
        return summary

    try:
        from pipeline.enhanced_orchestrator import (
            _clean_summary_markdown,
            _safe_slice_markdown,
            _markdown_to_html,
        )
        cleaned = _clean_summary_markdown(summary)
        sliced = _safe_slice_markdown(cleaned, max_chars=350)
        return _markdown_to_html(sliced)
    except Exception:
        return summary


@router.get("/jobs")
async def list_jobs_endpoint(user: dict = Depends(require_user)):
    """Retrieve all video analysis jobs owned by the current user."""
    all_jobs = await list_jobs(user_id=user["id"])
    results = []
    for job in all_jobs:
        results.append({
            "id": job["id"],
            "url": job["url"],
            "youtube_id": job["video_id"],
            "title": job.get("video_title") or "Untitled analysis",
            "channel": job.get("video_channel"),
            "duration_seconds": job.get("video_duration"),
            "thumbnail_url": job.get("video_thumbnail"),
            "status": job.get("status"),
            "progress": job.get("progress", 0),
            "stage_detail": job.get("stage_detail"),
            "created_at": job.get("created_at"),
            "completed_at": job.get("completed_at"),
            "folder_id": job.get("folder_id"),
        })
    return results


@router.get("/notes/{job_id}")
async def notes(job_id: str, user: dict = Depends(require_user)):
    """Return the completed notes, or 202 if the job is still running."""
    from fastapi.responses import JSONResponse
    job = await get_job(job_id)
    if job is None or job.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") != "complete":
        return JSONResponse(
            status_code=202, content={"status": job.get("status")}
        )

    notes_json = job.get("notes_json") or {}
    return {
        "job_id": job["id"],
        "video": {
            "title": job.get("video_title"),
            "channel": job.get("video_channel"),
            "duration_seconds": job.get("video_duration"),
            "thumbnail_url": job.get("video_thumbnail"),
            "youtube_id": job.get("video_id"),
        },
        "stats": job.get("stats") or {},
        "summary": _ensure_html_summary(notes_json.get("summary", "")),
        "topics": notes_json.get("topics", []),
        "sections": notes_json.get("sections", []),
        "content_classification": notes_json.get("content_classification") or {},
    }


@router.get("/debug/classify/{job_id}")
async def debug_classify(job_id: str, user: dict = Depends(require_user)) -> dict:
    """Temporary: run the content classifier against a processed job.

    Reads the persisted notes_json + transcript-derived signals from the
    stored sections and calls `classify_content`. Useful for spot-checking
    classifier output during development.
    """
    job = await get_job(job_id)
    if job is None or job.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")

    notes_json = job.get("notes_json") or {}
    sections = notes_json.get("sections") or []
    # The classifier expects per-section content_type / topic / equations
    # signals. Pull them from `extractions` when present, otherwise leave the
    # counts to come from the LLM's reading of the transcript.
    extraction_sections = notes_json.get("extractions") or []

    # Re-shape extractions to the dict shape classify_content expects.
    reshaped: list[dict] = []
    for ex in extraction_sections:
        reshaped.append({
            "content_type": ex.get("content_type"),
            "topic": ex.get("topic"),
            "equations": [ex["extracted_text"]] if ex.get("content_type") == "equation" and ex.get("extracted_text") else [],
        })
    # Add structured equations/code_blocks from stitched sections (course-aware).
    for s in sections:
        if not isinstance(s, dict):
            continue
        eqs = s.get("equations") if isinstance(s.get("equations"), list) else []
        if eqs:
            reshaped.append({"content_type": "equation", "topic": s.get("title"), "equations": eqs})

    transcript_text = ""
    # We don't store the full transcript on the job, so reconstruct from
    # the summary + each section's content_html as a best-effort stand-in.
    text_parts: list[str] = []
    summary = notes_json.get("summary")
    if isinstance(summary, str):
        text_parts.append(summary)
    for s in sections:
        if isinstance(s, dict) and isinstance(s.get("content_html"), str):
            import re
            text_parts.append(re.sub(r"<[^>]+>", "", s["content_html"]))
    transcript_text = "\n".join(text_parts)

    from pipeline.content_classifier import classify_content

    classification = classify_content(
        video_meta={
            "title": job.get("video_title"),
            "channel": job.get("video_channel"),
            "duration_seconds": job.get("video_duration"),
        },
        transcript=transcript_text,
        sections=reshaped,
    )

    return {
        "job_id": job_id,
        "video_title": job.get("video_title"),
        "classification": classification,
    }


@router.get("/user")
async def me(user: dict = Depends(require_user)) -> dict:
    """Return the current user's profile and completed-video count."""
    video_count = await count_completed_jobs(user["id"])
    return {
        "id": user["id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "avatar_url": user.get("avatar_url"),
        "video_count": video_count,
    }
