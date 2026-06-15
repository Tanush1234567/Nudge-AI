"""Temporal-median compositing: rebuild a clean board from a window of frames.

WHY: A whiteboard lecture often has the speaker standing in front of the
board, occluding parts of the content the viewer needs. As long as the
content is STABLE over a short window (no new annotations, no slide change)
and the speaker MOVES, the per-pixel median across frames keeps the board
(constant) and discards the speaker (transient). This produces a single
"clean" composite frame for vision analysis even when no single captured
frame is clean.

Pipeline (orchestrated by `composite_frame`):
  1. extract_window_frames  — 25 evenly-spaced frames in ±10s.
  2. check_content_stability — crop to content region per frame, embed via
     DINOv2; require all pairwise cosines > 0.90 (full window) or find the
     largest contiguous sub-window ≥10 frames satisfying that.
  3. temporal_median_composite — pixel-wise median across the stable subset.

The module is self-contained — no imports from other pipeline modules. The
DINOv2 embedding function is injected by the caller (a `dino_model` callable
that takes a BGR ndarray and returns an L2-normalised numpy embedding, or
None on failure). The region detector is the one from `pipeline/regions.py`
but here it is duck-typed: only its `analyze_frame(frame)` method is called,
and only its returned `content_region` attribute is read.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# --- Tunables ---------------------------------------------------------------

_STABILITY_COSINE_THRESHOLD = 0.90
_MIN_STABLE_WINDOW = 10  # frames — minimum contiguous run to accept


# --- Video I/O --------------------------------------------------------------


def extract_window_frames(
    video_path: str,
    timestamp: float,
    window_seconds: float = 10.0,
    num_frames: int = 25,
) -> list[np.ndarray]:
    """Read N evenly-spaced frames from [timestamp ± window_seconds].

    Uses CAP_PROP_POS_MSEC seeking. Returns BGR ndarrays in chronological
    order. Silently skips timestamps the codec cannot decode — the caller
    must be prepared for fewer than `num_frames` results.
    """
    if num_frames <= 0:
        return []

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.warning("Could not open video for compositing: %s", video_path)
        return []

    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        duration = (total_frames / fps) if (fps and fps > 0) else 0.0

        t_start = max(0.0, timestamp - window_seconds)
        t_end = timestamp + window_seconds
        if duration > 0:
            t_end = min(t_end, duration)
        if t_end <= t_start:
            return []

        targets = np.linspace(t_start, t_end, num_frames)
        frames: list[np.ndarray] = []
        for t in targets:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t * 1000.0))
            ok, frame = cap.read()
            if ok and frame is not None and frame.size > 0:
                frames.append(frame)
        return frames
    finally:
        cap.release()


# --- Stability check --------------------------------------------------------


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity assuming both inputs are L2-normalised (dot product)."""
    return float(np.dot(a, b))


def _crop_to_content(
    frame: np.ndarray,
    region_detector,
) -> Optional[np.ndarray]:
    """Crop a frame to its detected content region; None if no content found."""
    analysis = region_detector.analyze_frame(frame)
    if analysis.content_region is None:
        return None
    height, width = frame.shape[:2]
    c = analysis.content_region
    x1 = int(round(c.x1 * width))
    y1 = int(round(c.y1 * height))
    x2 = int(round(c.x2 * width))
    y2 = int(round(c.y2 * height))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2]


def _largest_stable_run(
    similarity: np.ndarray,
    valid: list[bool],
    threshold: float,
) -> tuple[int, int]:
    """Find the largest contiguous sub-window in which every pair > threshold.

    Returns (start, length). `similarity[i, j]` must be symmetric with 1.0 on
    the diagonal; pairs involving an invalid frame are ignored (their row/col
    is skipped by `valid`).
    """
    n = len(valid)
    best_start, best_len = 0, 0
    for start in range(n):
        if not valid[start]:
            continue
        end = start  # inclusive
        while end + 1 < n and valid[end + 1]:
            new = end + 1
            # The new frame must be similar to every frame already in the run.
            if all(
                similarity[i, new] > threshold for i in range(start, end + 1)
            ):
                end = new
            else:
                break
        run_len = end - start + 1
        if run_len > best_len:
            best_start, best_len = start, run_len
    return best_start, best_len


def check_content_stability(
    frames: list[np.ndarray],
    region_detector,
    dino_model: Callable[[np.ndarray], Optional[np.ndarray]],
) -> tuple[bool, Optional[list[np.ndarray]]]:
    """Decide whether the content across `frames` is stable enough to composite.

    For each frame, crop to its content region and produce a DINOv2 embedding
    of the crop. If every pairwise cosine across all frames > 0.90 → all
    frames are stable. Otherwise, look for the largest contiguous sub-window
    in which every pairwise cosine > 0.90; if that run is ≥10 frames long,
    return it. Else `(False, None)`.

    Frames whose content region cannot be detected or whose embedding fails
    are treated as breakpoints — they end any contiguous run.
    """
    n = len(frames)
    if n == 0:
        return (False, None)

    embeddings: list[Optional[np.ndarray]] = []
    for frame in frames:
        crop = _crop_to_content(frame, region_detector)
        if crop is None or crop.size == 0:
            embeddings.append(None)
            continue
        try:
            emb = dino_model(crop)
        except Exception as exc:  # noqa: BLE001 — failure must not abort
            logger.warning("DINOv2 embedding failed in stability check: %s", exc)
            emb = None
        embeddings.append(emb)

    valid = [e is not None for e in embeddings]
    if sum(valid) < 2:
        return (False, None)

    similarity = np.ones((n, n), dtype=np.float32)
    for i in range(n):
        if not valid[i]:
            continue
        for j in range(i + 1, n):
            if not valid[j]:
                continue
            s = _cosine(embeddings[i], embeddings[j])
            similarity[i, j] = s
            similarity[j, i] = s

    # Fast path: every pairwise similarity > threshold across the whole window.
    full_min = np.inf
    for i in range(n):
        if not valid[i]:
            continue
        for j in range(i + 1, n):
            if not valid[j]:
                continue
            full_min = min(full_min, similarity[i, j])
    if full_min > _STABILITY_COSINE_THRESHOLD:
        return (True, frames)

    # Fallback: find the largest contiguous stable sub-window.
    start, length = _largest_stable_run(
        similarity, valid, _STABILITY_COSINE_THRESHOLD
    )
    if length >= _MIN_STABLE_WINDOW:
        return (True, frames[start : start + length])

    return (False, None)


# --- Median composite -------------------------------------------------------


def temporal_median_composite(frames: list[np.ndarray]) -> np.ndarray:
    """Per-pixel median of a stack of frames.

    Static content (the board) is preserved; transient pixels (the speaker
    crossing the frame) are washed out by the median. All inputs must share
    the same (H, W, C) shape — `composite_frame` guarantees this because the
    frames come from a single video.
    """
    if not frames:
        raise ValueError("temporal_median_composite needs at least one frame.")
    if not all(f.shape == frames[0].shape for f in frames):
        raise ValueError(
            "temporal_median_composite requires frames of identical shape."
        )
    stack = np.stack(frames, axis=0)
    return np.median(stack, axis=0).astype(np.uint8)


# --- Orchestrator -----------------------------------------------------------


def composite_frame(
    video_path: str,
    timestamp: float,
    region_detector,
    dino_model: Callable[[np.ndarray], Optional[np.ndarray]],
) -> Optional[np.ndarray]:
    """Build a clean composite for `timestamp`, or return None if not possible.

    Returns the median-composited BGR frame on success, or None when the
    content was not stable enough (e.g. a slide change inside the window, or
    too much motion in the content region itself). On None, the caller should
    fall back to whatever the original frame provided.
    """
    frames = extract_window_frames(video_path, timestamp)
    if not frames:
        logger.info("Composite: no frames extracted around t=%.1fs", timestamp)
        return None

    stable, stable_frames = check_content_stability(
        frames, region_detector, dino_model
    )
    if not stable or not stable_frames:
        logger.info(
            "Composite: content unstable in window around t=%.1fs", timestamp
        )
        return None

    return temporal_median_composite(stable_frames)
