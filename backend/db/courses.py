"""Course CRUD helpers.

WHY: A course is a parent record that owns many `jobs` (lectures) via the
`course_videos` junction. Course-level intelligence (syllabus, master
equation sheet, concept graph) lives in JSON columns on the courses table.
Everything is async-wrapped so the API layer doesn't block the event loop.
"""

import asyncio
import logging
from datetime import datetime, timezone

from db.client import get_supabase

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_course(
    user_id: str,
    title: str,
    source_url: str,
    total_videos: int,
    description: str | None = None,
    thumbnail_url: str | None = None,
    platform: str = "youtube",
) -> dict:
    """Insert a new course row and return it."""

    def _insert() -> dict:
        sb = get_supabase()
        row = {
            "user_id": user_id,
            "title": title,
            "description": description,
            "source_url": source_url,
            "platform": platform,
            "thumbnail_url": thumbnail_url,
            "total_videos": total_videos,
            "processed_videos": 0,
            "status": "processing",
        }
        res = sb.table("courses").insert(row).execute()
        return res.data[0] if res.data else {}

    return await asyncio.to_thread(_insert)


async def get_course(course_id: str) -> dict | None:
    """Fetch a course row by id."""

    def _get() -> dict | None:
        sb = get_supabase()
        res = sb.table("courses").select("*").eq("id", course_id).limit(1).execute()
        return res.data[0] if res.data else None

    try:
        return await asyncio.to_thread(_get)
    except Exception as exc:  # noqa: BLE001
        logger.error("get_course failed for %s: %s", course_id, exc)
        return None


async def list_courses(user_id: str) -> list[dict]:
    """Return every course owned by `user_id`, newest first."""

    def _list() -> list[dict]:
        sb = get_supabase()
        res = (
            sb.table("courses")
            .select("id, title, description, source_url, platform, thumbnail_url, "
                    "total_videos, processed_videos, status, created_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []

    try:
        return await asyncio.to_thread(_list)
    except Exception as exc:  # noqa: BLE001
        logger.error("list_courses failed for %s: %s", user_id, exc)
        return []


async def delete_course(course_id: str, user_id: str) -> bool:
    """Delete a course (and its junction rows via ON DELETE CASCADE)."""

    def _delete() -> int:
        sb = get_supabase()
        res = (
            sb.table("courses")
            .delete()
            .eq("id", course_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(res.data or [])

    try:
        removed = await asyncio.to_thread(_delete)
        return removed > 0
    except Exception as exc:  # noqa: BLE001
        logger.error("delete_course failed for %s: %s", course_id, exc)
        return False


async def add_course_video(course_id: str, video_id: str, lecture_number: int) -> None:
    """Insert a junction row pinning a job to a course at a given order."""

    def _insert() -> None:
        sb = get_supabase()
        sb.table("course_videos").insert(
            {
                "course_id": course_id,
                "video_id": video_id,
                "lecture_number": lecture_number,
            }
        ).execute()

    try:
        await asyncio.to_thread(_insert)
    except Exception as exc:  # noqa: BLE001
        logger.error("add_course_video failed (%s -> %s): %s", course_id, video_id, exc)
        raise


async def get_course_videos(course_id: str) -> list[dict]:
    """Return junction rows joined to job state, ordered by lecture_number."""

    def _get() -> list[dict]:
        sb = get_supabase()
        cv = (
            sb.table("course_videos")
            .select("video_id, lecture_number")
            .eq("course_id", course_id)
            .order("lecture_number")
            .execute()
        )
        rows = cv.data or []
        if not rows:
            return []
        ids = [r["video_id"] for r in rows]
        jobs = (
            sb.table("jobs")
            .select("id, url, video_id, video_title, video_channel, "
                    "video_duration, video_thumbnail, status, progress, "
                    "notes_json, stats, completed_at")
            .in_("id", ids)
            .execute()
        )
        by_id = {j["id"]: j for j in (jobs.data or [])}
        out: list[dict] = []
        for r in rows:
            job = by_id.get(r["video_id"]) or {}
            out.append(
                {
                    "lecture_number": r["lecture_number"],
                    "job_id": r["video_id"],
                    **job,
                }
            )
        return out

    try:
        return await asyncio.to_thread(_get)
    except Exception as exc:  # noqa: BLE001
        logger.error("get_course_videos failed for %s: %s", course_id, exc)
        return []


async def recompute_course_progress(course_id: str) -> dict | None:
    """Refresh processed_videos count and status based on current job states."""

    def _recompute() -> dict | None:
        sb = get_supabase()
        course = sb.table("courses").select("*").eq("id", course_id).limit(1).execute()
        if not course.data:
            return None
        total = course.data[0]["total_videos"]

        cv = (
            sb.table("course_videos")
            .select("video_id")
            .eq("course_id", course_id)
            .execute()
        )
        ids = [r["video_id"] for r in (cv.data or [])]
        if not ids:
            return course.data[0]

        jobs = sb.table("jobs").select("id, status").in_("id", ids).execute()
        states = [j["status"] for j in (jobs.data or [])]
        completed = sum(1 for s in states if s == "complete")
        errored = sum(1 for s in states if s == "error")

        if completed >= total:
            new_status = "complete"
        elif completed == 0 and errored >= total:
            new_status = "failed"
        elif completed > 0 and (completed + errored) >= total:
            new_status = "partial"
        else:
            new_status = "processing"

        sb.table("courses").update(
            {
                "processed_videos": completed,
                "status": new_status,
                "updated_at": _now(),
            }
        ).eq("id", course_id).execute()

        course.data[0]["processed_videos"] = completed
        course.data[0]["status"] = new_status
        return course.data[0]

    try:
        return await asyncio.to_thread(_recompute)
    except Exception as exc:  # noqa: BLE001
        logger.error("recompute_course_progress failed for %s: %s", course_id, exc)
        return None


async def update_course_status(course_id: str, status: str) -> None:
    """Force a course status value (used by the course processor)."""

    def _update() -> None:
        sb = get_supabase()
        sb.table("courses").update(
            {"status": status, "updated_at": _now()}
        ).eq("id", course_id).execute()

    try:
        await asyncio.to_thread(_update)
    except Exception as exc:  # noqa: BLE001
        logger.error("update_course_status failed for %s: %s", course_id, exc)


async def save_course_intelligence(
    course_id: str,
    *,
    syllabus_json: dict | None = None,
    master_equations: list | None = None,
    concept_graph: dict | None = None,
    course_embedding: list[float] | None = None,
) -> None:
    """Persist any of the course-level generated artifacts."""

    payload: dict = {"updated_at": _now()}
    if syllabus_json is not None:
        payload["syllabus_json"] = syllabus_json
    if master_equations is not None:
        payload["master_equations"] = master_equations
    if concept_graph is not None:
        payload["concept_graph"] = concept_graph
    if course_embedding is not None:
        payload["course_embedding"] = course_embedding

    if len(payload) == 1:
        return  # nothing to write besides updated_at — skip

    def _save() -> None:
        sb = get_supabase()
        sb.table("courses").update(payload).eq("id", course_id).execute()

    try:
        await asyncio.to_thread(_save)
    except Exception as exc:  # noqa: BLE001
        logger.error("save_course_intelligence failed for %s: %s", course_id, exc)
        raise
