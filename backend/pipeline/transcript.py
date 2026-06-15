"""Stage 2: fetch a YouTube transcript and align segments to frame times.

WHY: The transcript is what makes Pupil "watch" the video — each extracted
frame is paired with the words spoken around it. get_transcript_in_range is
the alignment primitive: an asymmetric window (more time before than after a
frame) because a presenter usually explains a concept *before* showing it.

Transcripts are best-effort. A video with captions disabled must not break the
pipeline — get_transcript returns [] and vision analysis proceeds frame-only.
"""

import logging
from dataclasses import dataclass

from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

logger = logging.getLogger(__name__)


@dataclass
class TranscriptSegment:
    """A single timed caption line."""

    start: float
    end: float
    text: str


def _to_segments(fetched) -> list[TranscriptSegment]:
    """Convert a youtube-transcript-api FetchedTranscript into our dataclass."""
    segments: list[TranscriptSegment] = []
    for snip in fetched:
        start = float(snip.start)
        duration = float(getattr(snip, "duration", 0.0) or 0.0)
        text = (snip.text or "").strip()
        if text:
            segments.append(
                TranscriptSegment(start=start, end=start + duration, text=text)
            )
    return segments


def get_transcript(video_id: str) -> list[TranscriptSegment]:
    """Fetch the best available English transcript for a video.

    Preference order: manual English captions, then auto-generated English,
    then any other language translated to English. Returns [] if nothing is
    available or any error occurs — this stage never raises.
    """
    try:
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        # a) Manually created English captions — highest quality.
        try:
            return _to_segments(
                transcript_list.find_manually_created_transcript(["en"]).fetch()
            )
        except NoTranscriptFound:
            pass

        # b) Auto-generated English captions.
        try:
            return _to_segments(
                transcript_list.find_generated_transcript(["en"]).fetch()
            )
        except NoTranscriptFound:
            pass

        # c) Any language, translated to English.
        for transcript in transcript_list:
            if transcript.is_translatable:
                try:
                    return _to_segments(transcript.translate("en").fetch())
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Translation to English failed for %s: %s", video_id, exc
                    )
                    continue

        # d) Nothing usable.
        logger.info("No usable transcript found for %s", video_id)
        return []
    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable) as exc:
        logger.info("Transcript unavailable for %s: %s", video_id, exc)
        return []
    except Exception as exc:  # noqa: BLE001 — this stage must never crash
        logger.error("Unexpected transcript error for %s: %s", video_id, exc)
        return []


def get_transcript_in_range(
    segments: list[TranscriptSegment],
    center_time: float,
    window_before: float = 20.0,
    window_after: float = 15.0,
) -> str:
    """Join the text of every segment overlapping a window around center_time.

    The window is [center_time - window_before, center_time + window_after].
    A segment overlaps when seg.start < end AND seg.end > start. The window is
    asymmetric on purpose — explanation precedes the visual it describes.
    """
    start_time = center_time - window_before
    end_time = center_time + window_after

    overlapping = [
        seg.text
        for seg in segments
        if seg.start < end_time and seg.end > start_time
    ]
    return " ".join(overlapping)
