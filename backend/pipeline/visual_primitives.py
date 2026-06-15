"""Set-of-Mark / Visual-Primitives prompt construction.

Inspired by DeepSeek's "Thinking with Visual Primitives" approach
(https://github.com/ailuntx/Thinking-with-Visual-Primitives). The original
work trains a model to emit bounding-box tokens during reasoning so it can
attend to specific regions of an image. We invert the idea: instead of
training, we PRE-ANNOTATE each frame with labelled coloured rectangles and
hand the vision model both the marked-up image AND a text prompt that
names the regions by letter ("region A = the content board"). Any
off-the-shelf vision model can then be steered to focus on content and
ignore the speaker without any fine-tuning.

The "Set-of-Mark prompting" technique (Yang et al. 2023, GPT-4V) is the
direct ancestor — it showed that simple coloured overlays + letter labels
substantially improve grounded visual reasoning in frontier VLMs. This
module is the production-friendly version of that idea for educational
video frames: cheap (pure OpenCV), zero-shot (no model required), and
specifically tuned to the kinds of regions our pipeline detects.

Exports:
    annotate_frame(frame, regions) -> annotated frame copy
    generate_prompt_context(analysis, is_composite=False) -> str
    prepare_frame_for_api(frame, analysis, composite_frame=None) -> (b64, prompt)
"""

from __future__ import annotations

import base64
from typing import Optional

import cv2
import numpy as np

from pipeline.regions import (
    FrameLayout,
    FrameRegionAnalysis,
    Region,
    RegionType,
)


# --- Look-and-feel ----------------------------------------------------------

# BGR (OpenCV) colours per region type.
COLORS: dict[RegionType, tuple[int, int, int]] = {
    RegionType.SPEAKER: (0, 0, 255),         # red
    RegionType.WHITEBOARD: (0, 255, 0),      # green
    RegionType.SLIDE: (0, 255, 0),           # green
    RegionType.SCREEN: (0, 255, 0),          # green
    RegionType.WEBCAM_BUBBLE: (0, 0, 255),   # red
    RegionType.UI_CHROME: (128, 128, 128),   # grey
}

# Human-readable labels (what the vision model sees in the prompt).
LABELS: dict[RegionType, str] = {
    RegionType.SPEAKER: "SPEAKER (ignore)",
    RegionType.WHITEBOARD: "BOARD (content)",
    RegionType.SLIDE: "SLIDE (content)",
    RegionType.SCREEN: "SCREEN (content)",
    RegionType.WEBCAM_BUBBLE: "WEBCAM (ignore)",
    RegionType.UI_CHROME: "UI (noise)",
}

_FONT = cv2.FONT_HERSHEY_SIMPLEX
_FONT_SCALE = 0.6
_FONT_THICKNESS = 2
_TEXT_COLOR = (0, 0, 0)             # black text on coloured bg
_LABEL_PAD_X = 6
_LABEL_PAD_Y = 4
_BOX_THICK_CONTENT = 3
_BOX_THICK_OTHER = 2
_JPEG_QUALITY = 85


# --- Helpers ----------------------------------------------------------------


def _label_text(region: RegionType, letter: str) -> str:
    """Final label printed inside the box, e.g. 'A: BOARD (content)'."""
    base = LABELS.get(region, f"REGION ({region.value})")
    return f"{letter}: {base}"


def _to_pixel_bbox(
    region: Region, width: int, height: int
) -> tuple[int, int, int, int]:
    """Clamp and round a normalised bbox to integer pixel coordinates."""
    x1 = max(0, min(width - 1, int(round(region.x1 * width))))
    y1 = max(0, min(height - 1, int(round(region.y1 * height))))
    x2 = max(0, min(width, int(round(region.x2 * width))))
    y2 = max(0, min(height, int(round(region.y2 * height))))
    return x1, y1, x2, y2


def _assign_letters(regions: list[Region]) -> dict[int, str]:
    """Assign A, B, C, ... to regions in priority-descending order.

    Content regions (higher priority) get the earliest letters so the prompt
    can naturally list "FOCUS: A, C" with content first. The result is keyed
    by `id(region)` so the same letter can be looked up wherever the region
    appears (e.g. when iterating in draw order, which is the OPPOSITE sort).
    """
    ordered = sorted(regions, key=lambda r: -r.priority)
    return {id(r): chr(ord("A") + idx) for idx, r in enumerate(ordered)}


def _encode_jpeg_base64(frame: np.ndarray) -> str:
    """JPEG-encode a BGR frame and return a base64 ASCII string."""
    ok, buffer = cv2.imencode(
        ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY]
    )
    if not ok:
        raise RuntimeError("Failed to JPEG-encode frame for API payload.")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


# --- Annotation -------------------------------------------------------------


def annotate_frame(frame: np.ndarray, regions: list[Region]) -> np.ndarray:
    """Return a copy of `frame` with labelled coloured boxes per region.

    Boxes are drawn in priority ASCENDING order (low-priority first) so
    high-priority content rectangles end up on top of any overlapping
    speaker box. Letters are assigned in priority DESCENDING order so the
    prompt can list content regions first (A, B, ...).
    """
    if frame is None or frame.size == 0:
        raise ValueError("annotate_frame received an empty frame.")
    out = frame.copy()
    if not regions:
        return out

    height, width = out.shape[:2]
    letters = _assign_letters(regions)

    # Draw low-priority boxes first so high-priority boxes layer on top.
    for region in sorted(regions, key=lambda r: r.priority):
        color = COLORS.get(region.region_type, (255, 255, 255))
        thickness = (
            _BOX_THICK_CONTENT if region.is_content else _BOX_THICK_OTHER
        )
        x1, y1, x2, y2 = _to_pixel_bbox(region, width, height)
        if x2 <= x1 or y2 <= y1:
            continue

        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        # Label with filled coloured background anchored at the top-left
        # INSIDE corner of the box (so it never spills outside the frame).
        letter = letters[id(region)]
        text = _label_text(region.region_type, letter)
        (tw, th), baseline = cv2.getTextSize(
            text, _FONT, _FONT_SCALE, _FONT_THICKNESS
        )
        bg_x2 = min(width, x1 + tw + 2 * _LABEL_PAD_X)
        bg_y2 = min(height, y1 + th + 2 * _LABEL_PAD_Y + baseline)
        cv2.rectangle(out, (x1, y1), (bg_x2, bg_y2), color, -1)
        cv2.putText(
            out,
            text,
            (x1 + _LABEL_PAD_X, y1 + th + _LABEL_PAD_Y),
            _FONT,
            _FONT_SCALE,
            _TEXT_COLOR,
            _FONT_THICKNESS,
            cv2.LINE_AA,
        )

    return out


# --- Prompt context ---------------------------------------------------------


def _generic_prompt(layout: FrameLayout) -> str:
    """Used when no regions were detected — keeps the model on task anyway."""
    return (
        f"FRAME LAYOUT: {layout.value}\n"
        "FOCUS: Extract all visible content from this frame."
    )


def generate_prompt_context(
    analysis: FrameRegionAnalysis,
    is_composite: bool = False,
) -> str:
    """Build the text-prompt half of the visual-primitives payload.

    Lists every detected region by its assigned letter, calls out any speaker
    occlusion of the content region, and ends with explicit FOCUS / IGNORE
    instructions referencing the same letters. When `is_composite` is true,
    adds a note that the speaker is no longer present in the image.
    """
    regions = analysis.regions or []
    if not regions:
        return _generic_prompt(analysis.layout)

    letters = _assign_letters(regions)
    ordered = sorted(regions, key=lambda r: -r.priority)

    lines: list[str] = [
        f"FRAME LAYOUT: {analysis.layout.value}",
        f"CONTENT VISIBILITY: {analysis.content_visibility_pct:.0f}%",
        "",
        "ANNOTATED REGIONS (coloured boxes drawn on this image):",
    ]
    for region in ordered:
        letter = letters[id(region)]
        label = LABELS.get(region.region_type, region.region_type.value)
        action = "EXTRACT" if region.is_content else "IGNORE"
        lines.append(
            f"  [{letter}] {label} — {region.area_pct:.0f}% of frame — {action}"
        )

    # Occlusion warning — overlap is the inverse of visibility.
    if (
        analysis.content_region is not None
        and analysis.speaker_region is not None
    ):
        overlap_pct = max(0.0, 100.0 - analysis.content_visibility_pct)
        if overlap_pct > 0.0:
            lines.append("")
            lines.append(
                f"  ⚠ OVERLAP: The speaker is blocking ~{overlap_pct:.0f}% "
                "of the content region."
            )
            lines.append(
                "  Read all visible content and infer any partially occluded "
                "text from surrounding context."
            )

    if is_composite:
        lines.append("")
        lines.append(
            "NOTE: This frame was composited from multiple frames to remove "
            "the speaker."
        )
        lines.append(
            "The original scene was a whiteboard lecture. The composite shows "
            "the full board content."
        )

    content_letters = [
        letters[id(r)] for r in ordered if r.is_content
    ]
    ignore_letters = [
        letters[id(r)] for r in ordered if not r.is_content
    ]

    lines.append("")
    if content_letters:
        lines.append(
            "FOCUS: Extract ALL text, equations, diagrams, and code from "
            f"region(s) {', '.join(content_letters)}."
        )
    else:
        lines.append(
            "FOCUS: Extract any visible content; no dedicated content region "
            "was detected in this frame."
        )
    if ignore_letters:
        lines.append(
            "IGNORE: Do not describe the person or their actions in "
            f"region(s) {', '.join(ignore_letters)}."
        )

    return "\n".join(lines)


# --- Top-level entry point --------------------------------------------------


def prepare_frame_for_api(
    frame: np.ndarray,
    analysis: FrameRegionAnalysis,
    composite_frame: Optional[np.ndarray] = None,
) -> tuple[str, str]:
    """Build the (base64 image, prompt context) pair for the vision API.

    Three paths:
      * SCREEN_RECORDING layout — annotation only adds noise (the whole
        frame IS the content), so the original frame is encoded as-is and
        the prompt is a single-line directive.
      * `composite_frame` provided — the speaker has been removed by
        temporal-median compositing. The composite is sent un-annotated
        (no speaker box to draw on it) and the prompt notes that.
      * Default — annotate the original frame with labelled boxes and send
        that plus the full region-aware prompt.
    """
    if frame is None or frame.size == 0:
        raise ValueError("prepare_frame_for_api received an empty frame.")

    # Screen recording → keep it clean; the frame IS the content.
    if analysis.layout == FrameLayout.SCREEN_RECORDING:
        return (
            _encode_jpeg_base64(frame),
            "FRAME LAYOUT: screen_recording\n"
            "FOCUS: Extract all visible content from this screen capture.",
        )

    # Successful composite → use it un-annotated; speaker no longer present.
    if composite_frame is not None and composite_frame.size > 0:
        return (
            _encode_jpeg_base64(composite_frame),
            generate_prompt_context(analysis, is_composite=True),
        )

    # Default path → annotate, encode, generate context.
    annotated = annotate_frame(frame, analysis.regions or [])
    return (
        _encode_jpeg_base64(annotated),
        generate_prompt_context(analysis, is_composite=False),
    )
