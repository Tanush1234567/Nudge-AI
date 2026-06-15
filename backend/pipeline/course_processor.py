"""Sequential per-course video processing.

WHY: Processing many lecture videos in parallel quickly trips OpenAI/Gemini
rate limits, so a course's videos are processed one at a time. After every
lecture finishes (or fails), the course's `processed_videos` count and
`status` are re-derived from the underlying jobs. When the last lecture
completes, course-level syllabus generation is kicked off.
"""

import asyncio
import logging

from db.courses import (
    get_course,
    get_course_videos,
    recompute_course_progress,
    update_course_status,
)
from pipeline.enhanced_orchestrator import process_video_enhanced

logger = logging.getLogger(__name__)

# In-process registry of running course tasks, so a second call to
# /process for the same course doesn't spawn a parallel worker.
_running: dict[str, asyncio.Task] = {}


async def process_course_videos(course_id: str) -> None:
    """Run every unprocessed lecture in the course, sequentially."""
    course = await get_course(course_id)
    if course is None:
        logger.warning("process_course_videos: course %s not found", course_id)
        return

    videos = await get_course_videos(course_id)
    if not videos:
        logger.warning("process_course_videos: course %s has no lectures", course_id)
        await update_course_status(course_id, "failed")
        return

    logger.info(
        "Course %s: processing %d lectures sequentially.", course_id, len(videos)
    )

    for v in videos:
        status = v.get("status")
        if status == "complete":
            continue
        job_id = v.get("job_id")
        url = v.get("url")
        if not job_id or not url:
            continue
        try:
            logger.info(
                "Course %s lecture %s: starting job %s",
                course_id, v.get("lecture_number"), job_id,
            )
            await process_video_enhanced(job_id, url)
        except Exception as exc:  # noqa: BLE001
            # One bad lecture must not abort the rest of the course.
            logger.exception(
                "Course %s lecture %s failed: %s",
                course_id, v.get("lecture_number"), exc,
            )
        finally:
            # Refresh course progress + status after each lecture.
            await recompute_course_progress(course_id)

    # Final reconcile and, if everything finished, trigger syllabus generation.
    final = await recompute_course_progress(course_id)
    if final and final.get("status") == "complete":
        # Local imports avoid a circular dep at module load.
        from pipeline.course_intelligence import (
            extract_course_concepts,
            generate_syllabus,
        )
        try:
            await generate_syllabus(course_id)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Auto-generate syllabus failed for course %s: %s", course_id, exc
            )
        try:
            await extract_course_concepts(course_id)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Auto-extract concepts failed for course %s: %s", course_id, exc
            )


def start_course_processing(course_id: str) -> bool:
    """Start (or no-op if already running) the sequential processor.

    Returns True if a new task was spawned, False if one was already running.
    """
    existing = _running.get(course_id)
    if existing and not existing.done():
        return False

    async def _runner() -> None:
        try:
            await process_course_videos(course_id)
        finally:
            _running.pop(course_id, None)

    task = asyncio.create_task(_runner(), name=f"course-{course_id}")
    _running[course_id] = task
    return True
