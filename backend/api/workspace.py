"""Workspace endpoints: folders + semantic search.

WHY: The library view groups videos into user-owned folders and supports
semantic search over the user's completed notes. Folders live in their own
table; search runs the `match_videos` Postgres function against the
`notes_embedding` vector column populated by `save_notes`.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware import require_user
from db.client import get_supabase
from db.jobs import get_job, update_job_folder
from pipeline.model_router import generate_embedding

logger = logging.getLogger(__name__)

router = APIRouter()


# --- folders ---------------------------------------------------------------


class CreateFolderBody(BaseModel):
    name: str
    parent_id: str | None = None


class MoveJobBody(BaseModel):
    folder_id: str | None = None


@router.post("/folders")
async def create_folder(
    body: CreateFolderBody, user: dict = Depends(require_user)
) -> dict:
    """Create a new folder owned by the current user."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name required")

    def _insert() -> dict:
        sb = get_supabase()
        row = {
            "user_id": user["id"],
            "name": name,
            "parent_id": body.parent_id,
        }
        res = sb.table("folders").insert(row).execute()
        return res.data[0] if res.data else {}

    folder = await asyncio.to_thread(_insert)
    return {
        "id": folder.get("id"),
        "name": folder.get("name"),
        "parent_id": folder.get("parent_id"),
        "video_count": 0,
        "created_at": folder.get("created_at"),
    }


@router.get("/folders")
async def list_folders(user: dict = Depends(require_user)) -> list[dict]:
    """Return the user's folders with completed-video counts."""

    def _query() -> tuple[list[dict], list[dict]]:
        sb = get_supabase()
        folders_res = (
            sb.table("folders")
            .select("id, name, parent_id, created_at")
            .eq("user_id", user["id"])
            .order("created_at", desc=False)
            .execute()
        )
        jobs_res = (
            sb.table("jobs")
            .select("folder_id")
            .eq("user_id", user["id"])
            .not_.is_("folder_id", None)
            .execute()
        )
        return folders_res.data or [], jobs_res.data or []

    folders, jobs = await asyncio.to_thread(_query)
    counts: dict[str, int] = {}
    for j in jobs:
        fid = j.get("folder_id")
        if fid:
            counts[fid] = counts.get(fid, 0) + 1

    return [
        {
            "id": f["id"],
            "name": f["name"],
            "parent_id": f.get("parent_id"),
            "created_at": f.get("created_at"),
            "video_count": counts.get(f["id"], 0),
        }
        for f in folders
    ]


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, user: dict = Depends(require_user)) -> dict:
    """Delete a folder; jobs inside fall back to unfiled (ON DELETE SET NULL)."""

    def _delete() -> int:
        sb = get_supabase()
        res = (
            sb.table("folders")
            .delete()
            .eq("id", folder_id)
            .eq("user_id", user["id"])
            .execute()
        )
        return len(res.data or [])

    removed = await asyncio.to_thread(_delete)
    if not removed:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"deleted": True, "id": folder_id}


@router.patch("/jobs/{job_id}/folder")
async def move_job_to_folder(
    job_id: str, body: MoveJobBody, user: dict = Depends(require_user)
) -> dict:
    """Move a video into a folder (or unfile it by passing null)."""
    # Ownership check first — update_job_folder filters by user_id too, but a
    # cleaner 404 here beats a silent no-op.
    job = await get_job(job_id)
    if job is None or job.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")

    ok = await update_job_folder(job_id, user["id"], body.folder_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to move job")
    return {"id": job_id, "folder_id": body.folder_id}


# --- semantic search -------------------------------------------------------


@router.get("/search")
async def search_videos(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    threshold: float = Query(0.3, ge=0.0, le=1.0),
    scope: str = Query("all", pattern="^(all|course)$"),
    courseId: str | None = Query(None),
    user: dict = Depends(require_user),
) -> dict:
    """Embed `q`, run the `match_videos` RPC, and enrich with course context.

    `scope=course` + `courseId` restricts hits to videos pinned to that course
    (used by the course overview's in-course search and by future Course AI).
    """
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query required")
    if scope == "course" and not courseId:
        raise HTTPException(
            status_code=400, detail="courseId is required when scope=course"
        )

    try:
        embedding = await asyncio.to_thread(generate_embedding, query)
    except Exception as exc:  # noqa: BLE001
        logger.error("Embedding generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Embedding service failed") from exc

    # When scoping to a single course, we may need to overshoot the LIMIT and
    # filter afterwards (the RPC has no course filter). 5x is plenty.
    rpc_limit = limit * 5 if scope == "course" else limit

    def _rpc() -> list[dict]:
        sb = get_supabase()
        res = sb.rpc(
            "match_videos",
            {
                "query_embedding": embedding,
                "match_threshold": threshold,
                "match_count": rpc_limit,
                "p_user_id": user["id"],
            },
        ).execute()
        return res.data or []

    try:
        matches = await asyncio.to_thread(_rpc)
    except Exception as exc:  # noqa: BLE001
        logger.error("match_videos RPC failed: %s", exc)
        raise HTTPException(status_code=500, detail="Search failed") from exc

    ids = [m["id"] for m in matches]
    enriched: dict[str, dict] = {}
    course_by_job: dict[str, dict] = {}
    if ids:
        def _fetch() -> tuple[list[dict], list[dict], list[dict]]:
            sb = get_supabase()
            jobs = (
                sb.table("jobs")
                .select("id, video_title, video_channel, video_thumbnail, notes_json")
                .in_("id", ids)
                .execute()
            )
            cv = (
                sb.table("course_videos")
                .select("course_id, video_id, lecture_number")
                .in_("video_id", ids)
                .execute()
            )
            course_ids = sorted({r["course_id"] for r in (cv.data or [])})
            courses_data: list[dict] = []
            if course_ids:
                courses_data = (
                    sb.table("courses")
                    .select("id, title")
                    .in_("id", course_ids)
                    .execute()
                    .data
                ) or []
            return jobs.data or [], cv.data or [], courses_data

        jobs_rows, cv_rows, course_rows = await asyncio.to_thread(_fetch)
        enriched = {r["id"]: r for r in jobs_rows}
        course_titles = {c["id"]: c.get("title") for c in course_rows}
        for r in cv_rows:
            course_by_job[r["video_id"]] = {
                "course_id": r["course_id"],
                "course_title": course_titles.get(r["course_id"]),
                "lecture_number": r["lecture_number"],
            }

    results: list[dict] = []
    for m in matches:
        ctx = course_by_job.get(m["id"])
        if scope == "course":
            if not ctx or ctx["course_id"] != courseId:
                continue
        row = enriched.get(m["id"], {})
        notes = row.get("notes_json") or {}
        snippet = _extract_snippet(notes)
        results.append(
            {
                "id": m["id"],
                "title": m.get("video_title") or row.get("video_title"),
                "channel": row.get("video_channel"),
                "thumbnail_url": row.get("video_thumbnail"),
                "similarity": float(m["similarity"]),
                "snippet": snippet,
                "course_id": ctx["course_id"] if ctx else None,
                "course_title": ctx["course_title"] if ctx else None,
                "lecture_number": ctx["lecture_number"] if ctx else None,
            }
        )
        if len(results) >= limit:
            break

    return {"query": query, "scope": scope, "course_id": courseId, "results": results}


def _extract_snippet(notes_json: dict) -> str:
    """Return a short plain-text excerpt suitable for a search-result card."""
    if not isinstance(notes_json, dict):
        return ""
    summary = notes_json.get("summary")
    if isinstance(summary, str) and summary.strip():
        return _strip_html(summary)[:220]
    sections = notes_json.get("sections") or []
    for sec in sections:
        body = sec.get("content_html") or sec.get("key_takeaway") or ""
        if isinstance(body, str) and body.strip():
            return _strip_html(body)[:220]
    return ""


def _strip_html(text: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", text).strip()
