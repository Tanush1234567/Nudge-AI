"""Daily resurfacing — pick concepts the user is about to forget.

WHY: A student processes a long course over weeks. Concepts from early
lectures fade fastest, and concepts that prerequisite later lectures matter
even more. This module assembles the daily review payload by:

1. Pulling the user's completed lectures + active courses.
2. Prioritising old course material (more than 7 days since processing).
3. Inside an active course, preferring concepts that are prerequisites for
   lectures the user has yet to reach — flagged with "📌 Coming up in
   Lecture N".
4. Filling any remaining slots with high-importance concepts from completed
   stand-alone videos.

The endpoints here are read-only / preview — actual email send via Resend is
out of scope for this iteration and can be layered on top of `_select_items`.
"""

import asyncio
import logging
import random
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware import require_user
from db.client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter()

# How old a lecture must be before its concepts are eligible for resurfacing.
_AGE_THRESHOLD_DAYS = 7
# Default daily payload size.
_DEFAULT_ITEM_COUNT = 5


# ---------------------------------------------------------------------------
# Data plumbing
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Supabase returns ISO 8601 with offset; tolerate trailing 'Z'.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _first_equation(notes_json: dict | None) -> str | None:
    if not notes_json:
        return None
    for sec in (notes_json.get("sections") or []):
        m = re.search(r"\$\$(.*?)\$\$", sec.get("content_html") or "", re.DOTALL)
        if m:
            return m.group(0)
    return None


async def _fetch_user_state(user_id: str) -> dict:
    """Pull jobs + courses + course_videos for the user in one trip."""

    def _load() -> dict:
        sb = get_supabase()
        jobs = (
            sb.table("jobs")
            .select(
                "id, video_title, video_channel, video_thumbnail, status, "
                "completed_at, created_at, notes_json"
            )
            .eq("user_id", user_id)
            .eq("status", "complete")
            .execute()
            .data
        ) or []
        courses = (
            sb.table("courses")
            .select(
                "id, title, total_videos, processed_videos, status, "
                "concept_graph, updated_at"
            )
            .eq("user_id", user_id)
            .execute()
            .data
        ) or []
        cv_rows: list[dict] = []
        if courses:
            ids = [c["id"] for c in courses]
            cv_rows = (
                sb.table("course_videos")
                .select("course_id, video_id, lecture_number")
                .in_("course_id", ids)
                .execute()
                .data
            ) or []
        return {"jobs": jobs, "courses": courses, "course_videos": cv_rows}

    return await asyncio.to_thread(_load)


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def _build_course_review_items(
    course: dict,
    cv_rows: list[dict],
    jobs_by_id: dict[str, dict],
) -> list[dict]:
    """For one active course, return resurfacing items that prefer old +
    prerequisite-of-future-lectures concepts.
    """
    course_id = course["id"]
    title = course.get("title") or "Course"
    graph = course.get("concept_graph") or {}
    concepts = graph.get("concepts") or []
    prereqs = graph.get("prerequisites") or []
    if not concepts:
        return []

    my_cv = [r for r in cv_rows if r["course_id"] == course_id]
    if not my_cv:
        return []

    # Lecture number -> job_id, plus job -> completed_at lookup.
    lec_to_job = {r["lecture_number"]: r["video_id"] for r in my_cv}
    completed_lecture_nums: set[int] = set()
    lecture_age_days: dict[int, int] = {}
    now = _now()
    for ln, jid in lec_to_job.items():
        job = jobs_by_id.get(jid)
        if not job:
            continue
        completed_lecture_nums.add(ln)
        ts = _parse_ts(job.get("completed_at") or job.get("created_at"))
        if ts:
            lecture_age_days[ln] = (now - ts).days

    if not completed_lecture_nums:
        return []

    max_processed_lec = max(completed_lecture_nums)
    pending_lecture_nums = {
        n for n in lec_to_job if n > max_processed_lec
    }

    # Build a "Coming up" map: concept_id -> list of pending lecture numbers
    # where this concept is a known prerequisite for a future lecture.
    coming_up: dict[str, list[int]] = {}
    concept_by_name = {c["name"]: c for c in concepts}
    for p in prereqs:
        if not pending_lecture_nums:
            break
        # A `from` concept is a prerequisite for a `to` concept appearing in
        # one of the listed lectures. Whenever any of those lectures lies in
        # the future, surface the `from` concept as upcoming.
        future_targets = sorted(set(p.get("lectures") or []) & pending_lecture_nums)
        if not future_targets:
            continue
        cid = p.get("from")
        if not cid:
            continue
        coming_up.setdefault(cid, [])
        for ln in future_targets:
            if ln not in coming_up[cid]:
                coming_up[cid].append(ln)

    # Score each concept: prefer (a) concept's first appearance lecture has
    # aged past the threshold and (b) being a prerequisite for an upcoming
    # lecture.
    scored: list[tuple[float, dict]] = []
    for c in concepts:
        first_lec = c.get("first_appearance", {}).get("lecture")
        if first_lec not in completed_lecture_nums:
            continue
        age_days = lecture_age_days.get(first_lec, 0)
        upcoming = coming_up.get(c["id"], [])
        # Skip concepts that are too fresh AND not prerequisites for upcoming work.
        if age_days < _AGE_THRESHOLD_DAYS and not upcoming:
            continue

        # Highest weight: prerequisite for upcoming lecture.
        # Secondary: lecture age. Tertiary: total appearances (concept centrality).
        score = (5.0 if upcoming else 0.0) + min(age_days, 60) / 10.0 + (
            min(c.get("total_appearances", 1), 10) / 10.0
        )

        first_job_id = lec_to_job.get(first_lec)
        job = jobs_by_id.get(first_job_id or "")
        equation = c["appearances"][0].get("equation") if c["appearances"] else None
        if not equation:
            equation = _first_equation(job.get("notes_json") if job else None)

        scored.append(
            (
                score,
                {
                    "kind": "course",
                    "course_id": course_id,
                    "course_title": title,
                    "lecture_number": first_lec,
                    "lecture_job_id": first_job_id,
                    "concept_name": c["name"],
                    "key_takeaway": (
                        c["appearances"][0].get("section_title")
                        if c.get("appearances")
                        else ""
                    ),
                    "key_equation": equation,
                    "coming_up_lectures": upcoming,
                    "age_days": age_days,
                    "label": (
                        "📌 Coming up: this concept is used in "
                        f"Lecture {upcoming[0]}" if upcoming else None
                    ),
                },
            )
        )

    scored.sort(key=lambda t: -t[0])
    return [item for _, item in scored]


def _build_standalone_items(
    jobs: list[dict],
    used_job_ids: set[str],
) -> list[dict]:
    """Pick items from completed jobs that aren't already covered by courses."""
    candidates: list[tuple[float, dict]] = []
    now = _now()
    for job in jobs:
        if job["id"] in used_job_ids:
            continue
        ts = _parse_ts(job.get("completed_at") or job.get("created_at"))
        if not ts:
            continue
        age_days = (now - ts).days
        if age_days < _AGE_THRESHOLD_DAYS:
            continue
        notes = job.get("notes_json") or {}
        sections = notes.get("sections") or []
        if not sections:
            continue
        # Use the section with the most informative takeaway.
        sec = max(
            sections,
            key=lambda s: len(_strip_html(s.get("key_takeaway") or "")),
            default=None,
        )
        if not sec:
            continue
        equation = _first_equation(notes)
        candidates.append(
            (
                age_days,
                {
                    "kind": "video",
                    "video_id": job["id"],
                    "video_title": job.get("video_title") or "Untitled",
                    "channel": job.get("video_channel"),
                    "thumbnail_url": job.get("video_thumbnail"),
                    "section_title": sec.get("title"),
                    "key_takeaway": _strip_html(sec.get("key_takeaway") or "")[:200],
                    "key_equation": equation,
                    "age_days": age_days,
                },
            )
        )
    # Older first.
    candidates.sort(key=lambda t: -t[0])
    return [item for _, item in candidates]


async def _select_items(user_id: str, limit: int) -> dict:
    """Compose the daily resurfacing payload."""
    state = await _fetch_user_state(user_id)
    jobs = state["jobs"]
    courses = state["courses"]
    cv_rows = state["course_videos"]
    jobs_by_id = {j["id"]: j for j in jobs}

    items: list[dict] = []
    used_job_ids: set[str] = set()

    # 1. Course-driven items first.
    active_courses = sorted(
        [c for c in courses if c.get("status") in ("processing", "partial", "complete")],
        key=lambda c: c.get("status") != "processing",
    )
    for course in active_courses:
        if len(items) >= limit:
            break
        for item in _build_course_review_items(course, cv_rows, jobs_by_id):
            if len(items) >= limit:
                break
            # No two items from the same lecture in one batch.
            key = (item["course_id"], item["lecture_number"])
            if any(
                i.get("course_id") == key[0] and i.get("lecture_number") == key[1]
                for i in items
            ):
                continue
            items.append(item)
            if item.get("lecture_job_id"):
                used_job_ids.add(item["lecture_job_id"])

    # 2. Fill remaining slots from stand-alone old videos.
    if len(items) < limit:
        for item in _build_standalone_items(jobs, used_job_ids):
            if len(items) >= limit:
                break
            items.append(item)
            used_job_ids.add(item["video_id"])

    # 3. Last-resort top-up: random recent items so the email is never empty.
    if len(items) < limit and jobs:
        spare = [
            j for j in jobs
            if j["id"] not in used_job_ids
        ]
        random.shuffle(spare)
        for job in spare[: limit - len(items)]:
            items.append(
                {
                    "kind": "video",
                    "video_id": job["id"],
                    "video_title": job.get("video_title") or "Untitled",
                    "channel": job.get("video_channel"),
                    "thumbnail_url": job.get("video_thumbnail"),
                    "section_title": None,
                    "key_takeaway": "",
                    "key_equation": _first_equation(job.get("notes_json")),
                    "age_days": 0,
                }
            )

    return {
        "generated_at": _now().isoformat(),
        "item_count": len(items),
        "items": items,
    }


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class PreviewQuery(BaseModel):
    limit: int = _DEFAULT_ITEM_COUNT


@router.get("/resurfacing/preview")
async def preview_resurfacing(
    limit: int = Query(_DEFAULT_ITEM_COUNT, ge=1, le=20),
    user: dict = Depends(require_user),
) -> dict:
    """Return the items the next resurfacing email would contain.

    Used by the in-app review screen and as a debug peek.
    """
    payload = await _select_items(user["id"], limit)
    return payload


@router.post("/resurfacing/preview")
async def preview_resurfacing_post(
    body: PreviewQuery, user: dict = Depends(require_user),
) -> dict:
    """POST variant that accepts a body for symmetry with future filters."""
    payload = await _select_items(user["id"], body.limit)
    return payload
