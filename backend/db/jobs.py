"""Job CRUD and duplicate detection.

WHY: All job-record persistence lives here so the pipeline orchestrator never
touches Supabase directly. Functions are async (the orchestrator is async),
but supabase-py is synchronous — calls run in a thread via asyncio.to_thread
so they don't block the event loop. Every DB call is wrapped: a logging
backend should degrade gracefully, never crash the pipeline.
"""

import asyncio
import logging
from datetime import datetime, timezone

from db.client import get_supabase

logger = logging.getLogger(__name__)

# Fields update_job is allowed to write — guards against typo'd kwargs.
_UPDATABLE_FIELDS = {
    "status",
    "progress",
    "stage_detail",
    "frames_captured",
    "video_title",
    "video_channel",
    "video_duration",
    "video_thumbnail",
}

# Public kwarg names that map to a differently-named DB column.
_FIELD_ALIASES = {"frames_found": "frames_captured"}


def _now() -> str:
    """Current UTC time as an ISO-8601 string for timestamp columns."""
    return datetime.now(timezone.utc).isoformat()


def clean_null_bytes(val):
    """Recursively strip null characters (\u0000 and \x00) from strings/dicts/lists."""
    if isinstance(val, str):
        return val.replace("\u0000", "").replace("\x00", "")
    elif isinstance(val, dict):
        return {k: clean_null_bytes(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [clean_null_bytes(x) for x in val]
    return val



async def create_job(
    url: str,
    video_id: str,
    user_id: str,
    ip: str | None = None,
) -> str:
    """Insert a new job row owned by `user_id` and return its generated id."""

    def _insert() -> str:
        sb = get_supabase()
        row = {
            "url": url,
            "video_id": video_id,
            "user_id": user_id,
            "anonymous_ip": ip,
            "status": "queued",
            "progress": 0,
        }
        res = sb.table("jobs").insert(row).execute()
        return res.data[0]["id"]

    return await asyncio.to_thread(_insert)


async def update_job(job_id: str, **kwargs) -> None:
    """Update arbitrary job fields; ignores None values and unknown keys."""
    fields: dict = {}
    for key, value in kwargs.items():
        if value is None:
            continue
        column = _FIELD_ALIASES.get(key, key)
        if column in _UPDATABLE_FIELDS:
            fields[column] = clean_null_bytes(value)
    if not fields:
        return

    def _update() -> None:
        sb = get_supabase()
        sb.table("jobs").update(fields).eq("id", job_id).execute()

    try:
        await asyncio.to_thread(_update)
    except Exception as exc:  # noqa: BLE001 — logging layer must not crash
        logger.error("update_job failed for %s: %s", job_id, exc)


async def fail_job(job_id: str, stage: str, message: str) -> None:
    """Mark a job as errored, recording which stage failed and why."""

    def _fail() -> None:
        sb = get_supabase()
        sb.table("jobs").update(
            {
                "status": "error",
                "error_stage": clean_null_bytes(stage),
                "error_message": clean_null_bytes(message),
                "progress": 0,
            }
        ).eq("id", job_id).execute()

    try:
        await asyncio.to_thread(_fail)
    except Exception as exc:  # noqa: BLE001
        logger.error("fail_job failed for %s: %s", job_id, exc)


async def save_notes(job_id: str, notes: dict, stats: dict) -> None:
    """Persist final notes + stats and mark the job complete.

    Also lifts the embedding out of `notes_json` into the dedicated
    `notes_embedding` vector column so the semantic-search RPC can index it.
    """
    embedding = notes.get("embedding") if isinstance(notes, dict) else None

    def _save() -> None:
        sb = get_supabase()
        payload: dict = {
            "notes_json": clean_null_bytes(notes),
            "stats": clean_null_bytes(stats),
            "status": "complete",
            "progress": 100,
            "completed_at": _now(),
        }
        if isinstance(embedding, list) and embedding:
            payload["notes_embedding"] = embedding
        sb.table("jobs").update(payload).eq("id", job_id).execute()

    try:
        await asyncio.to_thread(_save)
    except Exception as exc:  # noqa: BLE001
        logger.error("save_notes failed for %s: %s", job_id, exc)
        raise


async def update_job_folder(job_id: str, user_id: str, folder_id: str | None) -> bool:
    """Move a job into a folder (or unfile it). Returns True on success."""

    def _update() -> bool:
        sb = get_supabase()
        res = (
            sb.table("jobs")
            .update({"folder_id": folder_id})
            .eq("id", job_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)

    try:
        return await asyncio.to_thread(_update)
    except Exception as exc:  # noqa: BLE001
        logger.error("update_job_folder failed for %s: %s", job_id, exc)
        return False


async def get_job(job_id: str) -> dict | None:
    """Fetch a single job by id, or None if it does not exist."""

    def _get() -> dict | None:
        sb = get_supabase()
        res = sb.table("jobs").select("*").eq("id", job_id).limit(1).execute()
        return res.data[0] if res.data else None

    try:
        return await asyncio.to_thread(_get)
    except Exception as exc:  # noqa: BLE001
        logger.error("get_job failed for %s: %s", job_id, exc)
        return None


async def get_jobs_by_status(statuses: list[str]) -> list[dict]:
    """Fetch all jobs whose status is in the given list (startup recovery).

    Only selects what the worker queue needs — id, url, created_at. Avoids
    pulling notes_json / notes_embedding for every interrupted row.
    """

    def _get() -> list[dict]:
        sb = get_supabase()
        res = (
            sb.table("jobs")
            .select("id, url, status, created_at")
            .in_("status", statuses)
            .execute()
        )
        return res.data or []

    try:
        return await asyncio.to_thread(_get)
    except Exception as exc:  # noqa: BLE001
        logger.error("get_jobs_by_status failed: %s", exc)
        return []


# A job is a usable duplicate if it is done OR still actively in progress —
# this also collapses rapid double-submits of the same video into one job.
_REUSABLE_STATUSES = [
    "complete", "queued", "downloading", "capturing",
    "reading", "transcribing", "writing",
]


async def check_duplicate(video_id: str, user_id: str) -> str | None:
    """Return an existing job_id for this video+user that is done or running.

    Scoped to the authenticated user so two users can independently process
    the same video without colliding.
    """

    def _check() -> str | None:
        sb = get_supabase()
        res = (
            sb.table("jobs")
            .select("id")
            .eq("video_id", video_id)
            .eq("user_id", user_id)
            .in_("status", _REUSABLE_STATUSES)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return res.data[0]["id"] if res.data else None

    try:
        return await asyncio.to_thread(_check)
    except Exception as exc:  # noqa: BLE001
        logger.error("check_duplicate failed for %s: %s", video_id, exc)
        return None


async def list_jobs(user_id: str | None = None) -> list[dict]:
    """Fetch jobs ordered by creation date descending.

    Only the lightweight columns the sidebar/library actually need are
    selected — explicitly excluding `notes_json` (can be megabytes per row)
    and `notes_embedding` (1536-dim vector). Returning `*` for a user with
    dozens of processed videos produced a multi-megabyte response that
    looked like a timeout to the browser.
    """
    _LIST_COLUMNS = (
        "id, url, video_id, video_title, video_channel, video_duration, "
        "video_thumbnail, status, progress, stage_detail, created_at, "
        "completed_at, folder_id, error_stage, error_message"
    )

    def _list() -> list[dict]:
        sb = get_supabase()
        query = sb.table("jobs").select(_LIST_COLUMNS).order("created_at", desc=True)
        if user_id is not None:
            query = query.eq("user_id", user_id)
        res = query.execute()
        return res.data or []

    try:
        return await asyncio.to_thread(_list)
    except Exception as exc:  # noqa: BLE001
        logger.error("list_jobs failed: %s", exc)
        return []


async def count_completed_jobs(user_id: str) -> int:
    """Return the number of completed jobs owned by `user_id`."""

    def _count() -> int:
        sb = get_supabase()
        res = (
            sb.table("jobs")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("status", "complete")
            .execute()
        )
        return res.count or 0

    try:
        return await asyncio.to_thread(_count)
    except Exception as exc:  # noqa: BLE001
        logger.error("count_completed_jobs failed for %s: %s", user_id, exc)
        return 0
