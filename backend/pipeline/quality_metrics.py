"""Pre-vision quality metrics + post-vision confidence scoring.

WHY: Vision API calls are by far the most expensive stage. Cheap OpenCV-only
metrics let us decide BEFORE calling the model which frames are worth high-
detail processing, which deserve a lighter pass, and which can be skipped
entirely. Five complementary signals are computed per frame in ~10ms each,
normalised within the video's own distribution, and combined into a composite
score that drives a routing decision.

This module is intentionally self-contained — only OpenCV and NumPy. It does
not import any other pipeline modules and does not perform I/O.

Input contract (duck-typed):
  * Transcript segments: any object exposing `.start` (float seconds) and
    `.text` (str), or a dict with the same keys. Matches the project's
    pipeline.transcript.TranscriptSegment without coupling to it.
  * Frame items for score_all_frames: any object exposing `.timestamp`
    (float) and `.image` (numpy BGR ndarray). A (timestamp, image) tuple is
    also accepted.
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterable

import cv2
import numpy as np


# --- Public types -----------------------------------------------------------


class FrameRouting(Enum):
    """How the downstream vision stage should treat a frame."""

    SKIP = "skip"
    RE_GRAB = "re_grab"
    PROCESS_LOW = "process_low"
    PROCESS_STD = "process_std"
    PROCESS_HIGH = "process_high"


@dataclass
class FrameQualityScore:
    """All five pre-vision metrics plus the composite + routing decision.

    `confidence` is left at the sentinel -1.0 until compute_confidence is run
    on the model's extracted text and assigned by the caller.
    """

    ocr_density: float
    visual_entropy: float
    symbol_density: float
    transcript_mismatch: float
    layout_complexity: int
    composite_score: float
    routing: FrameRouting
    confidence: float = -1.0  # filled post-vision


# --- Constants used by individual metrics -----------------------------------

# Words that imply the speaker is referencing something visible on screen.
# When these appear in transcript near a frame with low OCR density, the
# board/slide content is probably MISSING from this frame (transition, cut,
# obscured by presenter) — a candidate for a re-grab.
_VISUAL_KEYWORDS: tuple[str, ...] = (
    "see", "look", "shows", "equation", "formula", "chart", "diagram",
    "slide", "board", "graph", "here", "notice", "written", "this", "observe",
)

# Hedging language in the vision model's output — a strong negative signal
# for how confidently the model could read the frame.
_HEDGE_PHRASES: tuple[str, ...] = (
    "appears to", "possibly", "seems like", "might be", "hard to read",
    "partially visible", "unclear", "cannot determine", "illegible",
    "blurry", "obscured",
)

# Tuning knobs surfaced as constants for clarity.
_SYMBOL_VARIANCE_THRESHOLD = 800     # local 8x8 variance above this = textured
_LAYOUT_AREA_FRACTION = 0.01         # contour must cover >=1% of frame
_TRANSCRIPT_WINDOW = 10.0            # ±10s window around the frame timestamp
_OCR_AREA_NORMALISER = 10_000.0      # MSER count per 10k pixels
_OCR_DENSITY_FLOOR = 0.1             # avoid divide-by-zero in mismatch ratio

# FIX: Cap the raw mismatch value so dividing by OCR_DENSITY_FLOOR (0.1)
# can't produce astronomically large numbers for frames with low OCR density.
# Without this cap, any frame with keyword_hits >= 1 and ocr_density near zero
# gets mismatch = 10 or 20 or more, which after normalisation pushes nearly
# every frame into RE_GRAB routing.
_MISMATCH_RAW_CAP = 10.0

# Composite weights — sum to 1.0. Mismatch is INVERTED (1 - mismatch_norm)
# because a high mismatch means content is probably missing from the frame.
_W_OCR = 0.35
_W_ENTROPY = 0.20
_W_SYMBOL = 0.20
_W_LAYOUT = 0.15
_W_MISMATCH_INV = 0.10

# Routing percentile cut-points (over the composite_score distribution).
_PCT_SKIP = 0.15      # bottom 15%
_PCT_LOW = 0.30       # next 15%
# Tightened from 0.80 to 0.90 — only the TOP 10% of frames get the premium
# Mini-tier extraction, halving the most expensive cost line.
_PCT_HIGH = 0.90
_MISMATCH_REGRAB_THRESHOLD = 0.80

# FIX: A frame is only SKIP'd if its composite score is BOTH in the bottom
# percentile AND below this absolute floor. Without this guard, when all
# frames in a video are very similar (e.g. a static whiteboard), min-max
# normalisation compresses all scores into a tiny range and the bottom 15%
# percentile cut can fall at the same value as many other frames, silently
# SKIP'ing far more than intended — sometimes every single frame.
_ABSOLUTE_SKIP_FLOOR = 0.20


# --- Duck-typed accessors ---------------------------------------------------


def _seg_start(seg: Any) -> float | None:
    if hasattr(seg, "start"):
        try:
            return float(seg.start)
        except (TypeError, ValueError):
            return None
    if isinstance(seg, dict) and "start" in seg:
        try:
            return float(seg["start"])
        except (TypeError, ValueError):
            return None
    return None


def _seg_text(seg: Any) -> str:
    if hasattr(seg, "text"):
        return seg.text or ""
    if isinstance(seg, dict):
        return seg.get("text") or ""
    return ""


def _frame_image(frame_item: Any) -> np.ndarray:
    if hasattr(frame_item, "image"):
        return frame_item.image
    if isinstance(frame_item, dict) and "image" in frame_item:
        return frame_item["image"]
    if isinstance(frame_item, tuple) and len(frame_item) == 2:
        return frame_item[1]
    raise TypeError(
        f"Cannot extract image from frame item of type {type(frame_item).__name__}; "
        "expected .image attribute, dict['image'], or (timestamp, image) tuple."
    )


def _frame_timestamp(frame_item: Any) -> float:
    if hasattr(frame_item, "timestamp"):
        return float(frame_item.timestamp)
    if isinstance(frame_item, dict) and "timestamp" in frame_item:
        return float(frame_item["timestamp"])
    if isinstance(frame_item, tuple) and len(frame_item) == 2:
        return float(frame_item[0])
    return 0.0


def _to_gray(frame: np.ndarray) -> np.ndarray:
    """Return a single-channel uint8 view of `frame`."""
    if frame.ndim == 2:
        return frame
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


# --- The five pre-vision metrics --------------------------------------------


def compute_ocr_density(frame: np.ndarray) -> float:
    """MSER region count per 10,000 pixels of frame area.

    MSER (Maximally Stable Extremal Regions) cheaply locates text-like blobs
    without running OCR. The density is a proxy for how text-heavy the frame
    is — slides and code-screens score high, talking-head shots score low.
    """
    h, w = frame.shape[:2]
    if h <= 0 or w <= 0:
        return 0.0
    gray = _to_gray(frame)
    mser = cv2.MSER_create()
    regions, _ = mser.detectRegions(gray)
    area_units = (w * h) / _OCR_AREA_NORMALISER
    if area_units <= 0:
        return 0.0
    return float(len(regions)) / area_units


def compute_visual_entropy(frame: np.ndarray) -> float:
    """Shannon entropy of the grayscale intensity histogram (0–8 bits).

    Flat / uniform frames (e.g. a blank board) score low; busy frames with a
    rich tonal range score high.
    """
    gray = _to_gray(frame)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    total = hist.sum()
    if total <= 0:
        return 0.0
    probs = hist / total
    nonzero = probs[probs > 0]
    return float(-np.sum(nonzero * np.log2(nonzero)))


def compute_symbol_density(frame: np.ndarray) -> float:
    """Fraction of the frame whose 8x8-local variance exceeds the textured threshold.

    Uses E[X²] - E[X]² implemented via two filter2D passes with an 8x8 box
    kernel. High-variance regions correlate with text, symbols, line drawings;
    flat regions (walls, sky, solid backgrounds) drop out.
    """
    gray = _to_gray(frame).astype(np.float32)
    kernel = np.ones((8, 8), dtype=np.float32) / 64.0
    mean = cv2.filter2D(gray, -1, kernel)
    sq_mean = cv2.filter2D(gray * gray, -1, kernel)
    variance = sq_mean - mean * mean
    total = variance.size
    if total <= 0:
        return 0.0
    above = int(np.count_nonzero(variance > _SYMBOL_VARIANCE_THRESHOLD))
    return above / total


def compute_transcript_mismatch(
    frame_timestamp: float,
    transcript: Iterable[Any],
    ocr_density: float,
) -> float:
    """Visual-keyword hits in the surrounding transcript window per unit OCR density.

    High value = the speaker is talking about something visible ("see this
    equation", "look at the diagram") but the frame itself has little visible
    text. Likely a transition, a cut to the presenter, or an occluded board —
    a strong signal that this frame should be re-grabbed.

    The raw ratio is capped at _MISMATCH_RAW_CAP (10.0) so that frames with
    near-zero OCR density don't produce absurdly large values that dominate
    the normalised distribution and push the majority of frames into RE_GRAB.
    """
    window_lo = frame_timestamp - _TRANSCRIPT_WINDOW
    window_hi = frame_timestamp + _TRANSCRIPT_WINDOW
    keyword_hits = 0
    for seg in transcript:
        start = _seg_start(seg)
        if start is None:
            continue
        if start < window_lo or start > window_hi:
            continue
        text = _seg_text(seg).lower()
        for keyword in _VISUAL_KEYWORDS:
            keyword_hits += text.count(keyword)
    raw = keyword_hits / max(ocr_density, _OCR_DENSITY_FLOOR)
    return min(raw, _MISMATCH_RAW_CAP)


def compute_layout_complexity(frame: np.ndarray) -> int:
    """Number of large connected edge-regions in the frame.

    A Canny edge map dilated by 5x5 joins nearby strokes. Contours whose area
    exceeds 1% of the frame are counted — these correspond to slide panels,
    figures, code blocks, etc. Distinguishes a structured slide from a busy
    but unstructured shot.
    """
    gray = _to_gray(frame)
    edges = cv2.Canny(gray, 50, 150)
    kernel = np.ones((5, 5), dtype=np.uint8)
    dilated = cv2.dilate(edges, kernel)
    contours, _ = cv2.findContours(
        dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    h, w = frame.shape[:2]
    area_threshold = _LAYOUT_AREA_FRACTION * (w * h)
    return sum(1 for c in contours if cv2.contourArea(c) > area_threshold)


# --- Aggregation ------------------------------------------------------------


def _min_max_normalise(values: list[float]) -> list[float]:
    """Map a list to [0, 1] within its own min/max. Returns 0.5 for a flat list."""
    if not values:
        return []
    lo = min(values)
    hi = max(values)
    if hi == lo:
        return [0.5] * len(values)
    span = hi - lo
    return [(v - lo) / span for v in values]


def _percentile_value(sorted_values: list[float], fraction: float) -> float:
    """Value at the given percentile of an already-sorted ascending list."""
    n = len(sorted_values)
    if n == 0:
        return 0.0
    idx = min(n - 1, max(0, int(n * fraction)))
    return sorted_values[idx]


import logging as _logging
_qm_logger = _logging.getLogger(__name__)


def score_all_frames(
    frames: Iterable[Any],
    transcript: Iterable[Any],
) -> list[FrameQualityScore]:
    """Score every candidate frame and decide its downstream routing.

    Per frame:
      1. Computes all five raw metrics.
      2. Min-max normalises each metric across the WHOLE video so the routing
         decision is relative to this video's own distribution (a slide deck
         and a whiteboard lecture get judged on their own terms).
      3. Combines normalised metrics into a weighted composite_score; the
         mismatch term is inverted because a high mismatch is a NEGATIVE
         signal.
      4. Routes by composite-score percentile, with a hard override that
         flags very-high-mismatch frames for re-grab regardless of score.
         A frame is only SKIP'd when BOTH the percentile cut applies AND the
         score is below _ABSOLUTE_SKIP_FLOOR — this prevents the entire batch
         being SKIP'd when all frames have very similar scores.

    Returns a list of FrameQualityScore in the same order as `frames`.
    """
    frame_list = list(frames)
    transcript_list = list(transcript)
    if not frame_list:
        _qm_logger.warning("[DIAG] score_all_frames called with zero frames — returning empty.")
        return []

    _qm_logger.info(
        "[DIAG] score_all_frames: scoring %d frames, %d transcript segments.",
        len(frame_list), len(transcript_list),
    )

    raw_ocr: list[float] = []
    raw_entropy: list[float] = []
    raw_symbol: list[float] = []
    raw_mismatch: list[float] = []
    raw_complexity: list[int] = []

    for item in frame_list:
        image = _frame_image(item)
        timestamp = _frame_timestamp(item)

        ocr = compute_ocr_density(image)
        entropy = compute_visual_entropy(image)
        symbol = compute_symbol_density(image)
        mismatch = compute_transcript_mismatch(timestamp, transcript_list, ocr)
        complexity = compute_layout_complexity(image)

        raw_ocr.append(ocr)
        raw_entropy.append(entropy)
        raw_symbol.append(symbol)
        raw_mismatch.append(mismatch)
        raw_complexity.append(complexity)

        _qm_logger.debug(
            "[DIAG]   t=%.1fs  ocr=%.3f  entropy=%.3f  symbol=%.3f  "
            "mismatch=%.3f(raw,capped)  complexity=%d",
            timestamp, ocr, entropy, symbol, mismatch, complexity,
        )

    n_ocr = _min_max_normalise(raw_ocr)
    n_entropy = _min_max_normalise(raw_entropy)
    n_symbol = _min_max_normalise(raw_symbol)
    n_mismatch = _min_max_normalise(raw_mismatch)
    n_complexity = _min_max_normalise([float(v) for v in raw_complexity])

    _qm_logger.info(
        "[DIAG] Raw metric ranges: "
        "ocr=[%.3f, %.3f]  entropy=[%.3f, %.3f]  symbol=[%.3f, %.3f]  "
        "mismatch=[%.3f, %.3f](capped)  complexity=[%d, %d]",
        min(raw_ocr), max(raw_ocr),
        min(raw_entropy), max(raw_entropy),
        min(raw_symbol), max(raw_symbol),
        min(raw_mismatch), max(raw_mismatch),
        min(raw_complexity), max(raw_complexity),
    )

    composites = [
        _W_OCR * n_ocr[i]
        + _W_ENTROPY * n_entropy[i]
        + _W_SYMBOL * n_symbol[i]
        + _W_LAYOUT * n_complexity[i]
        + _W_MISMATCH_INV * (1.0 - n_mismatch[i])
        for i in range(len(frame_list))
    ]

    sorted_composites = sorted(composites)
    skip_cut = _percentile_value(sorted_composites, _PCT_SKIP)
    low_cut  = _percentile_value(sorted_composites, _PCT_LOW)
    high_cut = _percentile_value(sorted_composites, _PCT_HIGH)

    _qm_logger.info(
        "[DIAG] Composite score range=[%.4f, %.4f]  "
        "skip_cut=%.4f(p%.0f)  low_cut=%.4f(p%.0f)  high_cut=%.4f(p%.0f)  "
        "absolute_skip_floor=%.4f",
        min(composites), max(composites),
        skip_cut, _PCT_SKIP * 100,
        low_cut,  _PCT_LOW  * 100,
        high_cut, _PCT_HIGH * 100,
        _ABSOLUTE_SKIP_FLOOR,
    )

    results: list[FrameQualityScore] = []
    routing_counts: dict[str, int] = {r.value: 0 for r in FrameRouting}

    for i in range(len(frame_list)):
        score = composites[i]
        mismatch_norm = n_mismatch[i]
        timestamp = _frame_timestamp(frame_list[i])

        if mismatch_norm > _MISMATCH_REGRAB_THRESHOLD:
            # RE_GRAB: transcript says there's something to see, but the
            # frame has little readable content — fetch a better frame.
            routing = FrameRouting.RE_GRAB
        elif score < skip_cut and score < _ABSOLUTE_SKIP_FLOOR:
            # FIX: SKIP only when BOTH the percentile cut fires AND the frame
            # is genuinely poor quality (absolute floor). Without the floor,
            # a video where all frames are similar would skip its lowest
            # scoring frames even if they're actually decent.
            routing = FrameRouting.SKIP
        elif score < low_cut:
            routing = FrameRouting.PROCESS_LOW
        elif score < high_cut:
            routing = FrameRouting.PROCESS_STD
        else:
            routing = FrameRouting.PROCESS_HIGH

        routing_counts[routing.value] += 1
        _qm_logger.info(
            "[DIAG]   t=%.1fs  composite=%.4f  mismatch_norm=%.3f  "
            "ocr=%.3f  entropy=%.3f  -> %s",
            timestamp, score, mismatch_norm,
            raw_ocr[i], raw_entropy[i],
            routing.value,
        )

        results.append(
            FrameQualityScore(
                ocr_density=raw_ocr[i],
                visual_entropy=raw_entropy[i],
                symbol_density=raw_symbol[i],
                transcript_mismatch=raw_mismatch[i],
                layout_complexity=raw_complexity[i],
                composite_score=score,
                routing=routing,
            )
        )

    _qm_logger.info(
        "[DIAG] score_all_frames done: %d frames → %s",
        len(frame_list),
        "  ".join(f"{k}={v}" for k, v in routing_counts.items() if v > 0),
    )
    return results


# --- Post-vision confidence scorer ------------------------------------------

_DIGIT_RUN = re.compile(r"\d+")


def compute_confidence(extraction_text: str | None) -> float:
    """Confidence that the vision model could actually read the frame.

    Counts language the model uses when it is unsure ("appears to", "blurry",
    "obscured") against signals of precise extraction (LaTeX delimiters,
    code fences, numeric tokens, overall verbosity). The score is bounded
    in [0, 1]; pure hedging tends toward 0, dense precise extraction toward 1.
    """
    text = extraction_text or ""
    if not text:
        return 0.0
    lower = text.lower()

    hedge_count = sum(lower.count(phrase) for phrase in _HEDGE_PHRASES)

    latex_delimiters = text.count("$") + text.count("\\(")
    code_blocks = text.count("```") // 2
    numbers = len(_DIGIT_RUN.findall(text))
    word_count = len(text.split())

    precision = (
        latex_delimiters * 3
        + code_blocks * 2
        + numbers
        + word_count / 50.0
    )

    denominator = max(precision + hedge_count * 10, 1.0)
    return precision / denominator
