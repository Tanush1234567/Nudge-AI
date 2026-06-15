"""Course / playlist endpoints.

WHY: A course wraps a YouTube playlist as a parent record. The flow is:
1. `POST /api/courses` — fetch playlist metadata, create the course + a job
   for each lecture, kick off the sequential processor.
2. `POST /api/courses/{id}/process` — resume processing (idempotent).
3. `GET /api/courses[/id]` — list / drill-in views.
4. `POST /api/courses/{id}/generate-syllabus` and `/generate-exam-guide`
   — re-run the LLM artifacts on demand.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware import get_client_ip, require_user
from db.courses import (
    add_course_video,
    create_course,
    delete_course,
    get_course,
    get_course_videos,
    list_courses,
    recompute_course_progress,
)
from db.jobs import create_job
from pipeline.course_intelligence import (
    extract_course_concepts,
    generate_exam_guide,
    generate_lecture_diff,
    generate_syllabus,
)
from pipeline.course_processor import start_course_processing
from pipeline.playlist import (
    classify_url,
    fetch_playlist_metadata,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateCourseBody(BaseModel):
    url: str


class ClassifyBody(BaseModel):
    url: str


@router.post("/classify-url")
async def classify_url_endpoint(body: ClassifyBody, _: dict = Depends(require_user)) -> dict:
    """Tell the frontend whether a URL is a video / playlist / video-in-playlist."""
    return classify_url(body.url)


@router.post("/courses")
async def create_course_endpoint(
    body: CreateCourseBody, user: dict = Depends(require_user)
) -> dict:
    """Create a course from a YouTube playlist URL and start processing it."""
    kind = classify_url(body.url)
    if kind["type"] not in ("playlist", "video_in_playlist"):
        raise HTTPException(
            status_code=400,
            detail="URL must be a YouTube playlist or a video within a playlist.",
        )
    playlist_url = (
        kind["url"] if kind["type"] == "playlist" else kind.get("playlist_url")
    )
    if not playlist_url:
        raise HTTPException(status_code=400, detail="Could not derive playlist URL.")

    try:
        info = await asyncio.to_thread(fetch_playlist_metadata, playlist_url)
    except Exception as exc:  # noqa: BLE001
        logger.exception("fetch_playlist_metadata failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to read playlist: {exc}") from exc

    if not info.entries:
        raise HTTPException(status_code=400, detail="Playlist is empty.")

    course = await create_course(
        user_id=user["id"],
        title=info.title,
        source_url=playlist_url,
        total_videos=info.total_videos,
        description=info.description,
        thumbnail_url=info.thumbnail,
    )
    if not course:
        raise HTTPException(status_code=500, detail="Failed to create course.")

    # Create a job per entry, junction-row pinning each into the course.
    created_videos: list[dict] = []
    for idx, entry in enumerate(info.entries, start=1):
        try:
            job_id = await create_job(
                url=entry.url,
                video_id=entry.video_id,
                user_id=user["id"],
            )
            await add_course_video(course["id"], job_id, idx)
            created_videos.append(
                {
                    "lecture_number": idx,
                    "job_id": job_id,
                    "title": entry.title,
                    "duration": entry.duration_seconds,
                    "thumbnail": entry.thumbnail,
                    "url": entry.url,
                }
            )
        except Exception as exc:  # noqa: BLE001
            # Most likely cause: duplicate (user, video_id) — log and continue.
            logger.warning(
                "create_job/add_course_video failed for %s: %s", entry.url, exc
            )

    start_course_processing(course["id"])

    return {
        "course_id": course["id"],
        "title": info.title,
        "description": info.description,
        "thumbnail": info.thumbnail,
        "total_videos": info.total_videos,
        "total_duration_seconds": info.total_duration_seconds,
        "videos": created_videos,
    }


@router.post("/courses/{course_id}/process")
async def process_course_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """(Re)start sequential processing for a course."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    started = start_course_processing(course_id)
    return {"course_id": course_id, "started": started}


@router.get("/courses")
async def list_courses_endpoint(user: dict = Depends(require_user)) -> list[dict]:
    """All courses owned by the current user (lightweight rows)."""
    return await list_courses(user["id"])


@router.get("/courses/{course_id}")
async def get_course_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Course details + lecture list, with a small summary per lecture."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")

    # Keep the headline counts fresh on every drill-in.
    refreshed = await recompute_course_progress(course_id) or course
    videos = await get_course_videos(course_id)

    lectures: list[dict] = []
    for v in videos:
        notes = v.get("notes_json") or {}
        sections = notes.get("sections") or []
        first_eq = None
        first_takeaway = None
        for sec in sections:
            html = sec.get("content_html") or ""
            if first_eq is None:
                import re
                m = re.search(r"\$\$(.*?)\$\$", html, re.DOTALL)
                if m:
                    first_eq = m.group(0)
            if first_takeaway is None and sec.get("key_takeaway"):
                first_takeaway = sec["key_takeaway"]
            if first_eq and first_takeaway:
                break
        lectures.append(
            {
                "job_id": v.get("job_id"),
                "lecture_number": v.get("lecture_number"),
                "title": v.get("video_title") or "Untitled",
                "channel": v.get("video_channel"),
                "duration_seconds": v.get("video_duration"),
                "thumbnail_url": v.get("video_thumbnail"),
                "status": v.get("status"),
                "progress": v.get("progress", 0),
                "key_takeaway": first_takeaway,
                "first_equation": first_eq,
            }
        )

    return {
        "id": refreshed["id"],
        "title": refreshed["title"],
        "description": refreshed.get("description"),
        "thumbnail_url": refreshed.get("thumbnail_url"),
        "source_url": refreshed["source_url"],
        "platform": refreshed.get("platform"),
        "status": refreshed.get("status"),
        "total_videos": refreshed.get("total_videos"),
        "processed_videos": refreshed.get("processed_videos"),
        "has_syllabus": refreshed.get("syllabus_json") is not None,
        "has_exam_guide": bool((refreshed.get("concept_graph") or {}).get("exam_guide")),
        "lectures": lectures,
    }


@router.delete("/courses/{course_id}")
async def delete_course_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Delete a course (cascades to course_videos and jobs)."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    ok = await delete_course(course_id, user["id"])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to delete course.")
    return {"deleted": True, "id": course_id}


@router.get("/courses/{course_id}/syllabus")
async def get_syllabus_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Return the persisted syllabus_json, or 404 if not generated yet."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    syllabus = course.get("syllabus_json")
    if not syllabus:
        raise HTTPException(status_code=404, detail="Syllabus not generated yet.")
    return {
        "course_id": course_id,
        "syllabus": syllabus,
        "master_equations": course.get("master_equations") or [],
    }


@router.post("/courses/{course_id}/generate-syllabus")
async def generate_syllabus_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """(Re)generate the course syllabus via LLM and persist it."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    syllabus = await generate_syllabus(course_id)
    if syllabus is None:
        raise HTTPException(
            status_code=409,
            detail="No completed lectures yet, or syllabus generation failed.",
        )
    return {"course_id": course_id, "syllabus": syllabus}


@router.post("/courses/{course_id}/generate-exam-guide")
async def generate_exam_guide_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Generate an exam study guide from all completed lectures."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    if course.get("status") != "complete":
        raise HTTPException(
            status_code=409,
            detail="Exam guide is available only once every lecture has finished processing.",
        )
    guide = await generate_exam_guide(course_id)
    if guide is None:
        raise HTTPException(
            status_code=409,
            detail="Exam guide generation failed.",
        )
    return {"course_id": course_id, "exam_guide": guide}


@router.get("/courses/{course_id}/exam-guide")
async def get_exam_guide(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Return the persisted exam study guide, or 404 if not generated yet."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    cg = course.get("concept_graph") or {}
    guide = cg.get("exam_guide")
    if not guide:
        raise HTTPException(status_code=404, detail="Exam guide not generated yet.")
    return {"course_id": course_id, "exam_guide": guide}


# ---------------------------------------------------------------------------
# Concept tracking
# ---------------------------------------------------------------------------


@router.get("/courses/{course_id}/concepts")
async def get_course_concepts(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Return the persisted concept graph (concepts + prerequisites)."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    graph = course.get("concept_graph") or {}
    return {
        "course_id": course_id,
        "concepts": graph.get("concepts") or [],
        "prerequisites": graph.get("prerequisites") or [],
    }


@router.post("/courses/{course_id}/generate-concepts")
async def generate_concepts_endpoint(course_id: str, user: dict = Depends(require_user)) -> dict:
    """Trigger concept extraction (also auto-runs on full course completion)."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    graph = await extract_course_concepts(course_id)
    if graph is None:
        raise HTTPException(
            status_code=409,
            detail="No completed lectures yet, or concept extraction failed.",
        )
    return {"course_id": course_id, **graph}


@router.get("/courses/{course_id}/lectures/{lecture_number}/diff")
async def get_lecture_diff(
    course_id: str,
    lecture_number: int,
    user: dict = Depends(require_user),
) -> dict:
    """Return the new/review/applied concept breakdown for one lecture."""
    course = await get_course(course_id)
    if course is None or course.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Course not found.")
    diff = await generate_lecture_diff(course_id, lecture_number)
    if diff is None:
        raise HTTPException(status_code=404, detail="Lecture or course not found.")
    return diff
