"""Pipeline orchestrator — runs all 6 stages for one video job.

WHY: Each stage updates the job record so the frontend can show live progress,
and each stage's failure maps to a clear user-facing message. The temp dir is
always removed in a finally block — a 120MB video must never leak even when a
stage crashes midway.
"""

import logging
import shutil

from config import GEMINI_API_KEY, MAX_VIDEO_DURATION
from db.jobs import fail_job, get_job, save_notes, update_job
from pipeline.download import download_video
from pipeline.exceptions import (
    DownloadError,
    FrameExtractionError,
    VideoNotFoundError,
    VideoTooLongError,
)
from pipeline.frames import extract_smart_frames
from pipeline.stitch import stitch_analyses
from pipeline.synthesize import synthesize_notes
from pipeline.transcript import get_transcript
from pipeline.vision import analyze_aligned_frames

logger = logging.getLogger(__name__)


def _compute_stats(
    frames: list,
    analyses: list,
    sections: list,
    notes: dict,
    has_transcript: bool,
) -> dict:
    """Summarize the run for the job's stats column."""
    diagrams = 0
    for section in notes.get("sections", []):
        for visual in section.get("visuals", []) if isinstance(section, dict) else []:
            if isinstance(visual, dict) and visual.get("type") == "ai_diagram":
                diagrams += 1
    return {
        "frames_captured": len(frames),
        "frames_important": sum(1 for a in analyses if a.is_important),
        "diagrams_generated": diagrams,
        "code_blocks_extracted": sum(len(s.code_blocks) for s in sections),
        "equations_extracted": sum(len(s.equations) for s in sections),
        "has_transcript": has_transcript,
        "sections_count": len(sections),
    }


async def process_video(job_id: str, url: str) -> None:
    """Run the full analysis pipeline for one job, updating its DB record."""
    temp_dir: str | None = None

    # Skip jobs already finished or cancelled before the worker reached them.
    existing = await get_job(job_id)
    if existing and existing.get("status") in ("error", "complete"):
        logger.info("Skipping job %s — already %s", job_id, existing["status"])
        return

    try:
        # --- Stage 1: Download (0-8%) ---
        update_job(job_id, status="downloading", progress=4,
                   stage_detail="Downloading video...")
        try:
            download = download_video(url)
        except VideoNotFoundError:
            await fail_job(job_id, "download", "Video not found or is private")
            return
        except VideoTooLongError as exc:
            limit_min = MAX_VIDEO_DURATION // 60
            await fail_job(
                job_id, "download",
                f"Video is {exc.minutes:.0f} minutes. Maximum is {limit_min} minutes",
            )
            return
        except DownloadError as exc:
            await fail_job(job_id, "download", f"Could not download: {exc}")
            return

        temp_dir = download.temp_dir
        await update_job(
            job_id, progress=8, status="downloading",
            video_title=download.title, video_channel=download.channel,
            video_duration=download.duration_seconds,
            video_thumbnail=download.thumbnail_url,
        )

        # --- Stage 2: Transcript (8-18%) ---
        await update_job(job_id, status="transcribing", progress=12,
                         stage_detail="Fetching transcript...")
        transcript = get_transcript(download.video_id)  # never raises
        has_transcript = bool(transcript)
        await update_job(job_id, progress=18)

        # --- Stage 3: Frames (18-38%) ---
        await update_job(job_id, status="capturing", progress=22,
                         stage_detail="Extracting key frames...")
        try:
            frames_dir = f"{temp_dir}/frames"
            frames = extract_smart_frames(download.video_path, frames_dir)
        except FrameExtractionError:
            await fail_job(job_id, "frames", "Frame extraction failed")
            return
        await update_job(job_id, progress=38, frames_captured=len(frames))

        # --- Stage 4: Vision (38-70%) ---
        await update_job(job_id, status="reading", progress=40,
                         stage_detail="Analyzing frames with transcript context...")

        async def vision_progress(fraction: float) -> None:
            await update_job(job_id, progress=int(40 + fraction * 30))

        analyses = await analyze_aligned_frames(
            frames, transcript, GEMINI_API_KEY, on_progress=vision_progress,
        )
        await update_job(job_id, progress=70)

        # --- Stage 5: Stitching (70-78%) ---
        await update_job(job_id, status="writing", progress=72,
                         stage_detail="Organizing into sections...")
        sections = stitch_analyses(analyses, transcript, download.duration_seconds)
        await update_job(job_id, progress=78)

        # --- Stage 6: Synthesis (78-92%) ---
        await update_job(job_id, status="writing", progress=82,
                         stage_detail="Generating study notes...")
        notes = await synthesize_notes(
            download.title, download.channel, download.duration_seconds,
            sections, GEMINI_API_KEY,
        )
        await update_job(job_id, progress=92)

        # --- Save: upload frames + persist notes (92-100%) ---
        await update_job(job_id, progress=94, stage_detail="Uploading frames...")
        from storage.frames import upload_key_frames

        frame_urls = await upload_key_frames(job_id, frames, sections)
        _apply_frame_urls(notes, frame_urls)

        stats = _compute_stats(frames, analyses, sections, notes, has_transcript)
        await save_notes(job_id, notes, stats)
        logger.info("Job %s completed: %d sections.", job_id, len(sections))

    except Exception as exc:  # noqa: BLE001 — last-resort job failure handler
        logger.exception("Unexpected error processing job %s", job_id)
        await fail_job(job_id, "pipeline", f"Unexpected error: {exc}")
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


def _apply_frame_urls(notes: dict, frame_urls: dict[int, str]) -> None:
    """Fill in image_url on captured_frame visuals from the upload result."""
    for section in notes.get("sections", []):
        if not isinstance(section, dict):
            continue
        for visual in section.get("visuals", []):
            if (
                isinstance(visual, dict)
                and visual.get("type") == "captured_frame"
                and visual.get("frame_index") in frame_urls
            ):
                visual["image_url"] = frame_urls[visual["frame_index"]]
