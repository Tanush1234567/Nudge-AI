"""Re-grab better frames around a flagged timestamp.

WHY: When the pre-vision quality scorer flags a frame for RE_GRAB (the
speaker referenced something visible in the transcript, but the captured
frame had almost no readable content — a transition, a cut to the
presenter, or an occluded board), this module pulls a fresh set of frames
from the raw video around the same timestamp and picks the one with the
most readable content. It is the rescue path that prevents losing a
genuinely important moment because the original sampler happened to land
on a bad frame.

Two functions:
  * regrab_frames — evenly-spaced re-grabs from a ±window around `timestamp`.
  * find_best_frame — pick the most readable re-grab; widen the window once
    if nothing in the original ±15s window is readable.

The module is self-contained — only OpenCV/NumPy and stdlib. The OCR-density
scorer is injected as a callable so this module does not import from any
other pipeline module.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_MIN_OCR_DENSITY = 0.3   # below this, the window has nothing readable
_WIDE_WINDOW_SECONDS = 30  # used as the second-attempt window in find_best_frame


# --- Re-grab frames around a timestamp -------------------------------------


def regrab_frames(
    video_path: str,
    timestamp: float,
    window: float = 15.0,
    count: int = 10,
) -> list[tuple[np.ndarray, float]]:
    """Extract `count` frames evenly spaced within [t-window, t+window].

    Uses CAP_PROP_POS_MSEC seeking. Returns (frame, timestamp_seconds)
    tuples in chronological order. Timestamps that cannot be decoded (out of
    bounds, codec hiccup) are silently skipped — the caller must be prepared
    for fewer than `count` results.
    """
    if count <= 0:
        return []

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.warning("regrab_frames could not open video: %s", video_path)
        return []

    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        duration = (total_frames / fps) if (fps and fps > 0) else 0.0

        t_start = max(0.0, timestamp - window)
        t_end = timestamp + window
        if duration > 0:
            t_end = min(t_end, duration)
        if t_end <= t_start:
            return []

        targets = np.linspace(t_start, t_end, count)
        grabs: list[tuple[np.ndarray, float]] = []
        for t in targets:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t * 1000.0))
            ok, frame = cap.read()
            if ok and frame is not None and frame.size > 0:
                grabs.append((frame, float(t)))
        return grabs
    finally:
        cap.release()


# --- Pick the best re-grab -------------------------------------------------


def _score_grabs(
    grabs: list[tuple[np.ndarray, float]],
    quality_scorer: Callable[[np.ndarray], float],
) -> list[tuple[float, np.ndarray, float]]:
    """Score every (frame, ts) pair with the supplied OCR-density callable."""
    scored: list[tuple[float, np.ndarray, float]] = []
    for frame, ts in grabs:
        try:
            score = float(quality_scorer(frame))
        except Exception as exc:  # noqa: BLE001 — one bad score must not abort
            logger.warning("regrab quality scorer failed at t=%.2fs: %s", ts, exc)
            continue
        scored.append((score, frame, ts))
    return scored


def find_best_frame(
    video_path: str,
    timestamp: float,
    quality_scorer: Callable[[np.ndarray], float],
) -> Optional[tuple[np.ndarray, float]]:
    """Pull a fresh set of frames around `timestamp` and return the most readable.

    Strategy:
      1. Re-grab 10 frames in [t-15, t+15] and pick the one with the highest
         OCR density (per the injected `quality_scorer`).
      2. If the best score is still under 0.3 — the speaker probably had
         the board on screen briefly, just not inside that 30s window —
         widen to [t-30, t+30] and try once more.
      3. If still nothing readable, return None and let the caller fall back
         to whatever it already had.

    Returns `(best_frame, best_timestamp_seconds)` or None.
    """
    grabs = regrab_frames(video_path, timestamp, window=15.0, count=10)
    scored = _score_grabs(grabs, quality_scorer)

    if scored:
        scored.sort(key=lambda s: s[0], reverse=True)
        best_score, best_frame, best_ts = scored[0]
        if best_score >= _MIN_OCR_DENSITY:
            return (best_frame, best_ts)
        logger.info(
            "regrab @ %.1fs: best score %.2f below floor %.2f — widening window.",
            timestamp, best_score, _MIN_OCR_DENSITY,
        )

    # Second attempt: a wider window in case the visible content was further
    # from the original timestamp than ±15s.
    grabs = regrab_frames(
        video_path, timestamp, window=_WIDE_WINDOW_SECONDS, count=10
    )
    scored = _score_grabs(grabs, quality_scorer)

    if not scored:
        return None

    scored.sort(key=lambda s: s[0], reverse=True)
    best_score, best_frame, best_ts = scored[0]
    if best_score < _MIN_OCR_DENSITY:
        logger.info(
            "regrab @ %.1fs: wider window still under %.2f — giving up.",
            timestamp, _MIN_OCR_DENSITY,
        )
        return None

    return (best_frame, best_ts)
