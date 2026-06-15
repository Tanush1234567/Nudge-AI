"""Stage 1: download a YouTube video at 360p and extract its metadata.

WHY: Frame analysis only needs ~360p, so we download the smallest pre-merged
format available (~120MB vs ~1.5GB for HD) and skip ffmpeg merging entirely.
The video is written to a per-job temp dir that the caller deletes once frames
are extracted — only the frames persist.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass

from config import MAX_VIDEO_DURATION
from pipeline.exceptions import (
    DownloadError,
    VideoNotFoundError,
    VideoTooLongError,
)

# yt-dlp video ids are exactly 11 chars: letters, digits, dash, underscore.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Ordered patterns covering every supported URL shape.
_URL_PATTERNS = [
    re.compile(r"(?:youtube\.com|youtube-nocookie\.com)/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})"),
    re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})"),
    re.compile(r"youtube\.com/embed/([A-Za-z0-9_-]{11})"),
    re.compile(r"youtube\.com/v/([A-Za-z0-9_-]{11})"),
    re.compile(r"youtube\.com/shorts/([A-Za-z0-9_-]{11})"),
]

_METADATA_TIMEOUT = 30   # seconds
_DOWNLOAD_TIMEOUT = 300  # seconds


@dataclass
class DownloadResult:
    """Outcome of a successful video download."""

    video_path: str
    video_id: str
    title: str
    channel: str
    duration_seconds: int
    thumbnail_url: str
    temp_dir: str


def extract_video_id(url: str) -> str:
    """Pull the 11-char video id from any supported YouTube URL or bare id.

    Raises ValueError if no valid id can be found.
    """
    candidate = (url or "").strip()
    if not candidate:
        raise ValueError("Empty URL.")

    # A bare id passed directly.
    if _ID_RE.match(candidate):
        return candidate

    for pattern in _URL_PATTERNS:
        match = pattern.search(candidate)
        if match:
            return match.group(1)

    raise ValueError(f"Could not extract a YouTube video id from: {url!r}")


def _run_yt_dlp(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Invoke yt-dlp, translating process failures into pipeline errors.

    Run as `python -m yt_dlp` so it resolves from the active environment
    regardless of whether the yt-dlp launcher script is on PATH.
    """
    try:
        return subprocess.run(
            [sys.executable, "-m", "yt_dlp", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise DownloadError("yt-dlp is not installed.") from exc
    except subprocess.TimeoutExpired as exc:
        raise DownloadError(f"yt-dlp timed out after {timeout}s.") from exc


def _classify_failure(stderr: str) -> Exception:
    """Map yt-dlp stderr text to the most specific pipeline exception."""
    lowered = stderr.lower()
    if any(
        s in lowered
        for s in ("video unavailable", "private video", "does not exist", "not found")
    ):
        return VideoNotFoundError("This video is unavailable, private, or removed.")
    return DownloadError(f"yt-dlp failed: {stderr.strip()[:300]}")


def download_video(url: str) -> DownloadResult:
    """Download a YouTube video at 360p into a fresh temp dir.

    Raises VideoNotFoundError, VideoTooLongError, or DownloadError on failure.
    """
    video_id = extract_video_id(url)
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    temp_dir = tempfile.mkdtemp(prefix="pupil_")

    try:
        # --- Metadata first: cheap, and lets us reject long videos early. ---
        meta_proc = _run_yt_dlp(
            ["--dump-json", "--no-download", "--no-playlist", canonical_url],
            timeout=_METADATA_TIMEOUT,
        )
        if meta_proc.returncode != 0:
            raise _classify_failure(meta_proc.stderr)

        try:
            meta = json.loads(meta_proc.stdout)
        except json.JSONDecodeError as exc:
            raise DownloadError("yt-dlp returned unparseable metadata.") from exc

        duration = int(meta.get("duration") or 0)
        if duration > MAX_VIDEO_DURATION:
            raise VideoTooLongError(minutes=duration / 60)

        # --- Download the pre-merged 360p (or next-best) format. ---
        output_template = os.path.join(temp_dir, "%(id)s.%(ext)s")
        dl_proc = _run_yt_dlp(
            [
                "-f", "best[height<=360]/best[height<=480]/best",
                "--no-playlist",
                "-o", output_template,
                canonical_url,
            ],
            timeout=_DOWNLOAD_TIMEOUT,
        )
        if dl_proc.returncode != 0:
            raise _classify_failure(dl_proc.stderr)

        downloaded = [
            os.path.join(temp_dir, f)
            for f in os.listdir(temp_dir)
            if f.startswith(video_id)
        ]
        if not downloaded:
            raise DownloadError("Download reported success but no file was found.")

        return DownloadResult(
            video_path=downloaded[0],
            video_id=video_id,
            title=meta.get("title") or "Untitled",
            channel=meta.get("channel") or meta.get("uploader") or "Unknown",
            duration_seconds=duration,
            thumbnail_url=meta.get("thumbnail") or "",
            temp_dir=temp_dir,
        )
    except Exception:
        # Never leak a temp dir on failure — the caller only cleans up on success.
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
