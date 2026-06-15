"""Playlist URL detection and metadata extraction.

WHY: A course is built from a YouTube playlist. We need to (a) tell whether a
URL is a single video, a playlist, or a video inside a playlist, and (b) fetch
the playlist's contents without downloading any videos — that's what `yt-dlp
--flat-playlist` is for.
"""

import json
import logging
import re
import subprocess
import sys
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from pipeline.exceptions import DownloadError

logger = logging.getLogger(__name__)

_PLAYLIST_ID_RE = re.compile(r"[?&]list=([A-Za-z0-9_-]+)")

_METADATA_TIMEOUT = 60  # seconds


@dataclass
class PlaylistEntry:
    """One entry in a playlist (lightweight — no full metadata)."""

    video_id: str
    title: str
    url: str
    duration_seconds: int | None
    thumbnail: str | None


@dataclass
class PlaylistInfo:
    """Result of fetching a playlist's flat metadata."""

    playlist_id: str
    title: str
    description: str
    uploader: str | None
    thumbnail: str | None
    entries: list[PlaylistEntry]

    @property
    def total_videos(self) -> int:
        return len(self.entries)

    @property
    def total_duration_seconds(self) -> int:
        return sum((e.duration_seconds or 0) for e in self.entries)


def extract_playlist_id(url: str) -> str | None:
    """Pull the `list=...` id out of any YouTube URL shape."""
    if not url:
        return None
    m = _PLAYLIST_ID_RE.search(url)
    return m.group(1) if m else None


def extract_playlist_url(url: str) -> str | None:
    """Build the canonical playlist URL from any URL containing `list=`."""
    pid = extract_playlist_id(url)
    if not pid:
        return None
    return f"https://www.youtube.com/playlist?list={pid}"


def classify_url(url: str) -> dict:
    """Decide whether a URL is a single video, a playlist, or video-in-playlist.

    Returns a dict the API/UI can branch on:
      - {"type": "playlist",          "url": ...}
      - {"type": "video_in_playlist", "video_url": ..., "playlist_url": ...}
      - {"type": "single_video",      "url": ...}
      - {"type": "unknown",           "url": ...}
    """
    raw = (url or "").strip()
    lower = raw.lower()
    has_list = "list=" in lower
    has_watch = "watch" in lower or "youtu.be" in lower
    is_playlist_path = "/playlist" in lower

    if has_list and is_playlist_path:
        return {"type": "playlist", "url": raw}
    if has_list and has_watch:
        return {
            "type": "video_in_playlist",
            "video_url": raw,
            "playlist_url": extract_playlist_url(raw),
        }
    if has_watch:
        return {"type": "single_video", "url": raw}
    return {"type": "unknown", "url": raw}


def _canonical_playlist_url(url: str) -> str:
    """Strip noise but keep the `list=` param; use the canonical /playlist path."""
    pid = extract_playlist_id(url)
    if pid:
        return f"https://www.youtube.com/playlist?list={pid}"
    # Fall back to the URL as-given.
    return url


def _run_yt_dlp(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Invoke `python -m yt_dlp` consistently with pipeline.download."""
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


def fetch_playlist_metadata(url: str) -> PlaylistInfo:
    """Return playlist title, description, and entries without downloading.

    Uses `--flat-playlist --dump-single-json` so we make one HTTP call and get
    a single JSON document with every entry inside.
    """
    canonical = _canonical_playlist_url(url)
    proc = _run_yt_dlp(
        [
            "--flat-playlist",
            "--dump-single-json",
            "--no-warnings",
            canonical,
        ],
        timeout=_METADATA_TIMEOUT,
    )
    if proc.returncode != 0:
        raise DownloadError(
            f"yt-dlp failed to fetch playlist: {proc.stderr.strip()[:300]}"
        )

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise DownloadError("yt-dlp returned unparseable playlist metadata.") from exc

    entries_raw = data.get("entries") or []
    entries: list[PlaylistEntry] = []
    for e in entries_raw:
        if not e:
            continue
        vid = e.get("id") or ""
        if not vid:
            continue
        entries.append(
            PlaylistEntry(
                video_id=vid,
                title=e.get("title") or "Untitled",
                url=f"https://www.youtube.com/watch?v={vid}",
                duration_seconds=int(e["duration"]) if e.get("duration") else None,
                thumbnail=(e.get("thumbnails") or [{}])[-1].get("url")
                if e.get("thumbnails")
                else None,
            )
        )

    return PlaylistInfo(
        playlist_id=data.get("id") or extract_playlist_id(canonical) or "",
        title=data.get("title") or "Untitled playlist",
        description=data.get("description") or "",
        uploader=data.get("uploader") or data.get("channel"),
        thumbnail=(data.get("thumbnails") or [{}])[-1].get("url")
        if data.get("thumbnails")
        else None,
        entries=entries,
    )
