"""Spatial region detection: persons, content surfaces, layout classification.

WHY: Downstream stages need to know WHERE things are in a frame — not just
that a frame has visual content, but which pixels are the whiteboard, which
are the presenter, and how much of the board is occluded. This drives
re-grab decisions, content-only cropping for downstream embedding, and the
overall layout classification (lecture / slideshow / PiP / etc.).

Two cheap detectors run per frame:
  * YOLOv8-nano (`yolov8n.pt`) for person bounding boxes.
  * OpenCV thresholding + edge density for content surfaces.

The module is self-contained — no imports from other pipeline modules — and
does not perform I/O beyond the YOLO model file (downloaded on first use).

All region coordinates are normalised to [0, 1]. `area_pct` is a percentage.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# --- Public types -----------------------------------------------------------


class RegionType(Enum):
    """What a detected region represents."""

    SPEAKER = "speaker"
    WHITEBOARD = "whiteboard"
    SLIDE = "slide"
    SCREEN = "screen"
    WEBCAM_BUBBLE = "webcam_bubble"
    UI_CHROME = "ui_chrome"


class FrameLayout(Enum):
    """The overall composition of a frame."""

    WHITEBOARD_LECTURE = "whiteboard_lecture"
    SLIDESHOW = "slideshow"
    SCREEN_RECORDING = "screen_recording"
    PICTURE_IN_PICTURE = "pip"
    TALKING_HEAD = "talking_head"
    MIXED = "mixed"


@dataclass
class Region:
    """A spatial region in a frame, with normalised coordinates [0, 1]."""

    region_type: RegionType
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    area_pct: float   # percentage of frame area, 0-100
    is_content: bool
    priority: int     # higher = more important downstream

    @property
    def center(self) -> tuple[float, float]:
        """Centre of the region in normalised coords."""
        return ((self.x1 + self.x2) / 2.0, (self.y1 + self.y2) / 2.0)


@dataclass
class FrameRegionAnalysis:
    """Result of analysing one frame's regions and layout."""

    layout: FrameLayout
    regions: list[Region] = field(default_factory=list)
    content_region: Optional[Region] = None
    speaker_region: Optional[Region] = None
    content_visibility_pct: float = 0.0
    # True when a whiteboard frame is partially blocked by the speaker — a
    # downstream stage can composite (e.g. fill from another frame in the
    # same content state) to recover the hidden region.
    needs_compositing: bool = False


# --- Detection constants ----------------------------------------------------

_PERSON_CLASS = 0                # YOLO COCO class index for "person"
_BRIGHT_THRESHOLD = 170          # grayscale value above which = bright surface
_MORPH_KERNEL_SIZE = 20          # close/open kernel for cleaning up the mask
_MIN_CONTENT_AREA_PCT = 10.0     # contour must cover ≥10% of frame
_WHITEBOARD_AREA_PCT = 40.0      # WHITEBOARD requires ≥40% area …
_WHITEBOARD_ASPECT = 1.2         #   … AND aspect ratio (w/h) ≥ 1.2
_SCREEN_EDGE_DENSITY = 0.05      # min edge-pixel fraction to call it a SCREEN
_WEBCAM_MAX_AREA_PCT = 15.0      # person smaller than this …
_WEBCAM_CORNER_MARGIN = 0.20     #   … with centre within 20% of any corner

# Priorities — higher = more important to preserve / show downstream.
_PRIORITY_CONTENT = 10
_PRIORITY_SPEAKER = 0
_PRIORITY_WEBCAM = 0


# --- Geometry helpers -------------------------------------------------------


def _to_region(
    region_type: RegionType,
    x1_px: float, y1_px: float, x2_px: float, y2_px: float,
    width: int, height: int,
    confidence: float,
    is_content: bool,
    priority: int,
) -> Region:
    """Convert a pixel-coord bbox into a normalised Region."""
    if width <= 0 or height <= 0:
        raise ValueError("Frame dimensions must be positive.")
    nx1 = max(0.0, min(1.0, x1_px / width))
    ny1 = max(0.0, min(1.0, y1_px / height))
    nx2 = max(0.0, min(1.0, x2_px / width))
    ny2 = max(0.0, min(1.0, y2_px / height))
    area_pct = max(0.0, (nx2 - nx1) * (ny2 - ny1)) * 100.0
    return Region(
        region_type=region_type,
        x1=nx1, y1=ny1, x2=nx2, y2=ny2,
        confidence=float(confidence),
        area_pct=area_pct,
        is_content=is_content,
        priority=priority,
    )


def _bbox_intersection_area(a: Region, b: Region) -> float:
    """Intersection area (in normalised² units) of two regions."""
    ix1 = max(a.x1, b.x1)
    iy1 = max(a.y1, b.y1)
    ix2 = min(a.x2, b.x2)
    iy2 = min(a.y2, b.y2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)


# --- The detector -----------------------------------------------------------


class RegionDetector:
    """Per-frame region detector: persons via YOLO, surfaces via OpenCV.

    The YOLO model is loaded eagerly in __init__ — instantiate one detector
    once and reuse it for every frame. The first instantiation will download
    `yolov8n.pt` (~6MB) if it isn't cached.
    """

    def __init__(self) -> None:
        # Imported lazily so the rest of the module remains importable even
        # if ultralytics is missing (caller will then see a clear error).
        from ultralytics import YOLO

        logger.info("Loading YOLOv8-nano for region detection...")
        self._model = YOLO("yolov8n.pt")
        logger.info("YOLOv8-nano ready.")

    # ----- person detection ------------------------------------------------

    def detect_persons(self, frame: np.ndarray) -> list[Region]:
        """Return one SPEAKER Region per person YOLOv8 finds in the frame.

        Regions are returned with their priority/is_content suitable for a
        full-frame speaker. `detect_webcam_bubble` may later reclassify some
        of them as WEBCAM_BUBBLE.
        """
        if frame is None or frame.size == 0:
            return []

        height, width = frame.shape[:2]
        # verbose=False keeps the ultralytics per-call log noise out.
        results = self._model(frame, verbose=False)
        if not results:
            return []

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return []

        cls_list = boxes.cls.tolist()
        xyxy_list = boxes.xyxy.tolist()
        conf_list = boxes.conf.tolist()

        persons: list[Region] = []
        for cls, xyxy, conf in zip(cls_list, xyxy_list, conf_list):
            if int(cls) != _PERSON_CLASS:
                continue
            x1, y1, x2, y2 = xyxy
            persons.append(
                _to_region(
                    RegionType.SPEAKER,
                    x1, y1, x2, y2,
                    width, height,
                    confidence=conf,
                    is_content=False,
                    priority=_PRIORITY_SPEAKER,
                )
            )
        return persons

    # ----- content surface detection ---------------------------------------

    def detect_content_regions(self, frame: np.ndarray) -> list[Region]:
        """Detect bright surfaces (whiteboards / slides) or, failing that, a screen.

        Two-stage:
          A) Bright: threshold the grayscale at 170, morph close+open with a
             20x20 kernel, find external contours, keep those above 10% of
             the frame area. Each surviving contour is classified WHITEBOARD
             if its bounding box has aspect ratio ≥1.2 AND area ≥40%; else
             SLIDE.
          B) Dark fallback: only if (A) found nothing. Canny edges; if the
             edge-pixel fraction exceeds 0.05, the whole frame is reported
             as a SCREEN region (dark code editor, terminal, etc.).
        """
        if frame is None or frame.size == 0:
            return []

        height, width = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame

        # --- (A) Bright surface path ---
        _, mask = cv2.threshold(gray, _BRIGHT_THRESHOLD, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (_MORPH_KERNEL_SIZE, _MORPH_KERNEL_SIZE)
        )
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        frame_area = float(width * height)
        bright_regions: list[Region] = []

        for contour in contours:
            contour_area = float(cv2.contourArea(contour))
            area_pct = (contour_area / frame_area) * 100.0 if frame_area > 0 else 0.0
            if area_pct < _MIN_CONTENT_AREA_PCT:
                continue

            x, y, w, h = cv2.boundingRect(contour)
            aspect = (w / h) if h > 0 else 0.0

            if aspect >= _WHITEBOARD_ASPECT and area_pct >= _WHITEBOARD_AREA_PCT:
                rtype = RegionType.WHITEBOARD
            else:
                rtype = RegionType.SLIDE

            bright_regions.append(
                _to_region(
                    rtype,
                    x, y, x + w, y + h,
                    width, height,
                    confidence=min(1.0, area_pct / 100.0 + 0.5),
                    is_content=True,
                    priority=_PRIORITY_CONTENT,
                )
            )

        if bright_regions:
            return bright_regions

        # --- (B) Dark / screen-recording fallback ---
        edges = cv2.Canny(gray, 50, 150)
        edge_density = float(np.count_nonzero(edges)) / edges.size if edges.size else 0.0
        if edge_density > _SCREEN_EDGE_DENSITY:
            return [
                _to_region(
                    RegionType.SCREEN,
                    0, 0, width, height,
                    width, height,
                    confidence=min(1.0, edge_density * 4.0),
                    is_content=True,
                    priority=_PRIORITY_CONTENT,
                )
            ]

        return []

    # ----- webcam-bubble reclassification ----------------------------------

    def detect_webcam_bubble(
        self,
        persons: list[Region],
        width: int,
        height: int,
    ) -> list[Region]:
        """Reclassify small corner-pinned persons as WEBCAM_BUBBLE regions.

        Mutates the passed list in place AND returns it for convenience. A
        person is treated as a webcam bubble when its area is <15% of the
        frame and its centre falls within 20% of any corner.
        """
        for person in persons:
            if person.region_type != RegionType.SPEAKER:
                continue
            if person.area_pct >= _WEBCAM_MAX_AREA_PCT:
                continue

            cx, cy = person.center
            near_left = cx <= _WEBCAM_CORNER_MARGIN
            near_right = cx >= (1.0 - _WEBCAM_CORNER_MARGIN)
            near_top = cy <= _WEBCAM_CORNER_MARGIN
            near_bottom = cy >= (1.0 - _WEBCAM_CORNER_MARGIN)
            in_corner = (near_left or near_right) and (near_top or near_bottom)

            if in_corner:
                person.region_type = RegionType.WEBCAM_BUBBLE
                person.priority = _PRIORITY_WEBCAM

        return persons

    # ----- layout classification ------------------------------------------

    def classify_layout(
        self,
        persons: list[Region],
        content_regions: list[Region],
    ) -> FrameLayout:
        """Decide the overall composition of the frame.

        Precedence:
          1. PICTURE_IN_PICTURE — a webcam bubble alongside any content.
          2. WHITEBOARD_LECTURE — at least one WHITEBOARD content region.
          3. SLIDESHOW — at least one SLIDE region (no whiteboard).
          4. SCREEN_RECORDING — a SCREEN region (no whiteboard / slide).
          5. TALKING_HEAD — full-frame speaker, no content.
          6. MIXED — anything else.
        """
        has_webcam = any(
            r.region_type == RegionType.WEBCAM_BUBBLE for r in persons
        )
        has_full_speaker = any(
            r.region_type == RegionType.SPEAKER for r in persons
        )
        content_types = {r.region_type for r in content_regions}

        if has_webcam and content_regions:
            return FrameLayout.PICTURE_IN_PICTURE

        if RegionType.WHITEBOARD in content_types:
            return FrameLayout.WHITEBOARD_LECTURE
        if RegionType.SLIDE in content_types:
            return FrameLayout.SLIDESHOW
        if RegionType.SCREEN in content_types:
            return FrameLayout.SCREEN_RECORDING

        if has_full_speaker and not content_regions:
            return FrameLayout.TALKING_HEAD

        return FrameLayout.MIXED

    # ----- visibility / occlusion -----------------------------------------

    def calculate_visibility(
        self,
        content_region: Optional[Region],
        speaker_region: Optional[Region],
    ) -> float:
        """Percentage (0-100) of the content region not occluded by the speaker.

        No content -> 0 (nothing to be visible).
        Content but no speaker -> 100.
        """
        if content_region is None:
            return 0.0
        if speaker_region is None:
            return 100.0
        content_area = (
            (content_region.x2 - content_region.x1)
            * (content_region.y2 - content_region.y1)
        )
        if content_area <= 0:
            return 0.0
        overlap = _bbox_intersection_area(content_region, speaker_region)
        visibility = (1.0 - overlap / content_area) * 100.0
        return max(0.0, min(100.0, visibility))

    # ----- top-level frame analysis ---------------------------------------

    def analyze_frame(self, frame: np.ndarray) -> FrameRegionAnalysis:
        """Run all region detection and produce a single FrameRegionAnalysis.

        Picks the primary `content_region` as the highest-area content
        region, and the primary `speaker_region` as the highest-area
        non-webcam person. `needs_compositing` is set for whiteboard lectures
        whose content is partially occluded by the speaker.
        """
        if frame is None or frame.size == 0:
            return FrameRegionAnalysis(layout=FrameLayout.MIXED)

        height, width = frame.shape[:2]

        persons = self.detect_persons(frame)
        persons = self.detect_webcam_bubble(persons, width, height)

        content_regions = self.detect_content_regions(frame)

        layout = self.classify_layout(persons, content_regions)

        primary_content = (
            max(content_regions, key=lambda r: r.area_pct)
            if content_regions
            else None
        )

        full_speakers = [
            r for r in persons if r.region_type == RegionType.SPEAKER
        ]
        primary_speaker = (
            max(full_speakers, key=lambda r: r.area_pct)
            if full_speakers
            else None
        )

        visibility = self.calculate_visibility(primary_content, primary_speaker)
        needs_compositing = (
            layout == FrameLayout.WHITEBOARD_LECTURE
            and primary_content is not None
            and visibility < 100.0
        )

        return FrameRegionAnalysis(
            layout=layout,
            regions=persons + content_regions,
            content_region=primary_content,
            speaker_region=primary_speaker,
            content_visibility_pct=visibility,
            needs_compositing=needs_compositing,
        )
