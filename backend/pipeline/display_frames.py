"""Pick and prepare the ONE image shown alongside each section in the notes.

WHY: A user should never see a photo of the lecturer in their study notes —
they should see the board, the slide, or the screen the lecturer was talking
about. This module decides which captured frame in a section is the best
visual candidate and crops it (or uses a pre-computed composite) so only
the educational content is shown.

Three operations:
  * `score_display_quality` — per-frame "good for display" score in [0, 1].
  * `prepare_display_frame` — turn a chosen frame into the final base64 JPEG,
    cropping to the content region (or using a clean composite when one
    exists, or leaving a screen-recording untouched).
  * `select_best_display_frame` — orchestrator: score every frame in a
    stitched section, pick the winner, prepare it, return (b64, timestamp,
    score) for downstream storage.

The module imports two NEW pipeline modules (quality_metrics, regions) and
otherwise only uses OpenCV, NumPy, and stdlib base64.
"""

from __future__ import annotations

import base64
from typing import Any, Iterable, Optional

import cv2
import numpy as np

from pipeline.quality_metrics import compute_ocr_density
from pipeline.regions import FrameLayout, FrameRegionAnalysis, Region


# --- Tunables ---------------------------------------------------------------

_DISPLAY_MAX_WIDTH = 800      # px — caps stored image width for efficiency
_JPEG_QUALITY = 85
_CROP_PADDING_PCT = 0.05      # 5% breathing room on each side of content
_COMPOSITE_TIGHT_PADDING = 0.0  # composites are already clean — no padding

# OCR density is "regions per 10,000 pixels"; a busy textbook slide tends to
# top out around ~12-15. We saturate the normalised value at this scale so
# the score component stays bounded.
_OCR_DENSITY_SATURATION = 15.0

# Score weights from the spec — sum to 1.0.
_W_VISIBILITY = 0.40
_W_NO_SPEAKER = 0.30
_W_OCR = 0.20
_W_COMPOSITE = 0.10


# --- Duck-typed input access ------------------------------------------------


def _frame_image(item: Any) -> np.ndarray:
    if hasattr(item, "image"):
        return item.image
    if isinstance(item, dict) and "image" in item:
        return item["image"]
    if isinstance(item, tuple) and len(item) == 2:
        return item[1]
    raise TypeError(
        "section_frames items must expose .image, dict['image'], or be "
        "(timestamp, image) tuples."
    )


def _frame_timestamp(item: Any) -> float:
    if hasattr(item, "timestamp"):
        return float(item.timestamp)
    if isinstance(item, dict) and "timestamp" in item:
        return float(item["timestamp"])
    if isinstance(item, tuple) and len(item) == 2:
        return float(item[0])
    return 0.0


# --- Image helpers ----------------------------------------------------------


def _crop_to_region(
    frame: np.ndarray,
    region: Region,
    padding_pct: float = _CROP_PADDING_PCT,
) -> np.ndarray:
    """Crop `frame` to `region` with optional padding, clamped to frame edges."""
    height, width = frame.shape[:2]
    x1 = max(0.0, region.x1 - padding_pct)
    y1 = max(0.0, region.y1 - padding_pct)
    x2 = min(1.0, region.x2 + padding_pct)
    y2 = min(1.0, region.y2 + padding_pct)

    px1 = int(round(x1 * width))
    py1 = int(round(y1 * height))
    px2 = int(round(x2 * width))
    py2 = int(round(y2 * height))
    if px2 <= px1 or py2 <= py1:
        return frame
    return frame[py1:py2, px1:px2]


def _resize_max_width(
    frame: np.ndarray, max_width: int = _DISPLAY_MAX_WIDTH
) -> np.ndarray:
    """Shrink the frame so its width does not exceed `max_width`."""
    height, width = frame.shape[:2]
    if width <= max_width or width <= 0:
        return frame
    scale = max_width / float(width)
    return cv2.resize(
        frame,
        (max_width, max(1, int(round(height * scale)))),
        interpolation=cv2.INTER_AREA,
    )


def _encode_jpeg_base64(frame: np.ndarray) -> str:
    """JPEG-encode the frame and return a base64 ASCII string."""
    ok, buffer = cv2.imencode(
        ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY]
    )
    if not ok:
        raise RuntimeError("Failed to JPEG-encode display frame.")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


# --- prepare_display_frame --------------------------------------------------


def prepare_display_frame(
    frame: np.ndarray,
    analysis: FrameRegionAnalysis,
    composite_frame: Optional[np.ndarray] = None,
) -> str:
    """Turn a chosen frame into the final base64 JPEG shown in the notes.

    Decision tree:
      1. A composite was produced (clean board, speaker removed) — use it,
         cropped tightly to the content region.
      2. Screen recording layout — the frame IS the content; use as-is.
      3. A content region was detected — crop to it with 5% padding so the
         user sees only the slide/board, never the speaker.
      4. No content region — fall back to the original frame.

    The final image is always resized to at most `_DISPLAY_MAX_WIDTH` pixels
    wide to keep storage reasonable.
    """
    if frame is None or frame.size == 0:
        raise ValueError("prepare_display_frame received an empty frame.")

    # 1) Composite available → use it; tight-crop if we know where content is.
    if composite_frame is not None and composite_frame.size > 0:
        chosen = composite_frame
        if analysis is not None and analysis.content_region is not None:
            chosen = _crop_to_region(
                chosen, analysis.content_region, padding_pct=_COMPOSITE_TIGHT_PADDING
            )

    # 2) Screen recording → the whole frame is the content.
    elif analysis is not None and analysis.layout == FrameLayout.SCREEN_RECORDING:
        chosen = frame

    # 3) Crop to detected content region with breathing room.
    elif analysis is not None and analysis.content_region is not None:
        chosen = _crop_to_region(
            frame, analysis.content_region, padding_pct=_CROP_PADDING_PCT
        )

    # 4) Fall back to the original frame.
    else:
        chosen = frame

    chosen = _resize_max_width(chosen)
    return _encode_jpeg_base64(chosen)


# --- score_display_quality --------------------------------------------------


def score_display_quality(
    frame: np.ndarray,
    analysis: FrameRegionAnalysis,
    is_composite: bool = False,
) -> float:
    """How good is `frame` as the section's display image? Returns 0.0 - 1.0.

    Combines four signals:
      * Content visibility — main driver: is the board / slide actually shown?
      * Lack of speaker — less of the frame covered by the presenter = better.
      * OCR density — readable text in the frame = more useful visual.
      * Composite bonus — composited frames are preferred (already clean).
    """
    if frame is None or frame.size == 0:
        return 0.0

    visibility = 0.0
    speaker_area_pct = 0.0
    if analysis is not None:
        visibility = max(0.0, min(100.0, analysis.content_visibility_pct)) / 100.0
        if analysis.speaker_region is not None:
            speaker_area_pct = max(0.0, min(100.0, analysis.speaker_region.area_pct))
    no_speaker = 1.0 - (speaker_area_pct / 100.0)

    try:
        ocr_norm = min(1.0, compute_ocr_density(frame) / _OCR_DENSITY_SATURATION)
    except Exception:
        ocr_norm = 0.0

    composite_term = 1.0 if is_composite else 0.5

    score = (
        visibility * _W_VISIBILITY
        + no_speaker * _W_NO_SPEAKER
        + ocr_norm * _W_OCR
        + composite_term * _W_COMPOSITE
    )
    return max(0.0, min(1.0, score))


# --- select_best_display_frame ---------------------------------------------


def select_best_display_frame(
    section_frames: Iterable[Any],
    analyses: Iterable[FrameRegionAnalysis],
    composites: Iterable[Optional[np.ndarray]],
) -> tuple[Optional[str], Optional[float], float]:
    """Pick the best display frame in a section, prepare it, and return it.

    All three iterables must be the SAME length and aligned: index i refers
    to the same captured frame across each. `composites[i]` may be None when
    no composite was produced for that frame.

    Returns `(display_image_b64, timestamp, score)`. When the section has no
    frames, returns `(None, None, 0.0)` so the caller can render a
    text-only section gracefully.
    """
    frames = list(section_frames)
    analysis_list = list(analyses)
    composite_list = list(composites)

    if not (len(frames) == len(analysis_list) == len(composite_list)):
        raise ValueError(
            "section_frames, analyses, and composites must be the same length "
            f"(got {len(frames)}, {len(analysis_list)}, {len(composite_list)})."
        )

    if not frames:
        return (None, None, 0.0)

    best_idx = -1
    best_score = -1.0
    for i, (item, analysis, composite) in enumerate(
        zip(frames, analysis_list, composite_list)
    ):
        image = _frame_image(item)
        is_composite = composite is not None and composite.size > 0
        score = score_display_quality(image, analysis, is_composite=is_composite)
        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx < 0:
        return (None, None, 0.0)

    best_item = frames[best_idx]
    best_image = _frame_image(best_item)
    best_analysis = analysis_list[best_idx]
    best_composite = composite_list[best_idx]

    display_b64 = prepare_display_frame(
        best_image, best_analysis, composite_frame=best_composite
    )
    return (display_b64, _frame_timestamp(best_item), max(0.0, best_score))
