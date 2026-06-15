"""Enhanced orchestrator — ties the new vision pipeline together.

WHY: Tasks 1-6 each added a self-contained module (quality_metrics, regions,
compositing, visual_primitives, model_router, regrab). This file is the
integration point that runs them in order for one job, mirroring the
existing orchestrator.py's progress/error patterns so the frontend's
processing UI keeps working.

Pipeline (per the Task 7 spec):
  0  Download + transcript                        (existing modules)
  1  DINOv2 first pass — candidate frames         (existing extract_smart_frames)
  2  Quality metrics + SKIP filter + RE_GRAB      (quality_metrics, regrab)
  3  Region detection per frame                   (regions)
  4  Temporal-median compositing where needed     (compositing)
  5  Content-region dedup (DINOv2 second pass)    (this module: content_region_dedup)
  6  Visual-primitives prompt construction        (visual_primitives)
  7  Vision API extraction with model routing     (model_router)
  8  Stitch extractions into sections             (existing stitch_analyses)
  9  Synthesize final notes + embedding           (model_router)
 10  Persist to Supabase                          (existing save_notes)

The existing orchestrator.py is NOT modified — this is a new module the
worker can call in its place (or alongside) once the team is ready.
"""

from __future__ import annotations

import asyncio
import base64
import dataclasses
import logging
import os
import re
import shutil
from dataclasses import dataclass
from typing import Optional

import cv2
import markdown as md_lib
import numpy as np

from config import MAX_VIDEO_DURATION
from db.jobs import fail_job, get_job, save_notes, update_job
from pipeline.download import download_video
from pipeline.exceptions import (
    DownloadError,
    FrameExtractionError,
    VideoNotFoundError,
    VideoTooLongError,
)
from pipeline.frames import (
    CapturedFrame,
    _get_embedding,
    _load_dinov2,
    extract_smart_frames,
)
from pipeline.transcript import (
    TranscriptSegment,
    get_transcript,
    get_transcript_in_range,
)
from pipeline.vision import AlignedAnalysis, format_timestamp
from pipeline.stitch import stitch_analyses, StitchedSection

# --- New modules from Tasks 1-6 --------------------------------------------
from pipeline.quality_metrics import (
    FrameQualityScore,
    FrameRouting,
    compute_layout_complexity,
    compute_ocr_density,
    compute_symbol_density,
    compute_transcript_mismatch,
    compute_visual_entropy,
    score_all_frames,
)
from pipeline.regions import (
    FrameLayout,
    FrameRegionAnalysis,
    RegionDetector,
)
from pipeline.compositing import composite_frame
from pipeline.visual_primitives import prepare_frame_for_api
from pipeline.model_router import (
    extract_with_retry,
    generate_embedding,
    synthesize_notes,
)
from pipeline.regrab import find_best_frame

logger = logging.getLogger(__name__)


# --- Unified internal frame representation ---------------------------------


@dataclass
class _PFrame:
    """One frame as it flows through the enhanced pipeline.

    Carries the decoded image (needed by every CV module), the original
    timestamp, the index it had in the captured list (so callers can map
    back to the source frames), and its quality score / routing.
    `captured` is set when the frame came from extract_smart_frames; it is
    None when the frame was produced by a RE_GRAB.
    """
    timestamp: float
    image: np.ndarray
    original_index: int
    quality: FrameQualityScore
    captured: Optional[CapturedFrame] = None


def _ndarray_from_captured(captured: CapturedFrame) -> Optional[np.ndarray]:
    """Decode a CapturedFrame back into a BGR ndarray.

    Prefers the on-disk JPEG (cheap) and falls back to base64 if the file
    was already cleaned up.
    """
    if captured.image_path and os.path.exists(captured.image_path):
        img = cv2.imread(captured.image_path)
        if img is not None and img.size > 0:
            return img
    if captured.image_base64:
        buf = np.frombuffer(
            base64.b64decode(captured.image_base64), dtype=np.uint8
        )
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is not None and img.size > 0:
            return img
    return None


# --- Helpers ---------------------------------------------------------------


def _score_replacement(
    image: np.ndarray,
    timestamp: float,
    transcript: list[TranscriptSegment],
    template: FrameQualityScore,
) -> FrameQualityScore:
    """Build a FrameQualityScore for a re-grabbed replacement frame.

    The full `score_all_frames` normalises within a video's own distribution;
    re-grabbing one frame after the fact does not change that distribution,
    so we compute its raw metrics, default the normalised pieces to the
    centre (0.5), and route as PROCESS_STD. This is good enough for the
    downstream stages and matches the spirit of `score_single_frame` from
    the spec.
    """
    ocr = compute_ocr_density(image)
    entropy = compute_visual_entropy(image)
    symbol = compute_symbol_density(image)
    mismatch = compute_transcript_mismatch(timestamp, transcript, ocr)
    layout = compute_layout_complexity(image)
    return FrameQualityScore(
        ocr_density=ocr,
        visual_entropy=entropy,
        symbol_density=symbol,
        transcript_mismatch=mismatch,
        layout_complexity=layout,
        composite_score=template.composite_score if template else 0.5,
        routing=FrameRouting.PROCESS_STD,
    )


def _crop_to_region_arr(image: np.ndarray, region) -> np.ndarray:
    """Crop a frame to a normalised Region; return the image as-is if invalid."""
    h, w = image.shape[:2]
    x1 = max(0, int(round(region.x1 * w)))
    y1 = max(0, int(round(region.y1 * h)))
    x2 = min(w, int(round(region.x2 * w)))
    y2 = min(h, int(round(region.y2 * h)))
    if x2 <= x1 or y2 <= y1:
        return image
    return image[y1:y2, x1:x2]


def _transcript_window_text(
    transcript: list[TranscriptSegment],
    timestamp: float,
) -> str:
    """Asymmetric ±20s/+15s transcript text — matches existing pipeline."""
    return get_transcript_in_range(
        transcript, timestamp, window_before=20.0, window_after=15.0
    )


# --- Stage 5: content-region dedup -----------------------------------------


def content_region_dedup(
    pframes: list[_PFrame],
    analyses: list[FrameRegionAnalysis],
    composites: dict[int, np.ndarray],
) -> list[tuple[int, _PFrame, FrameRegionAnalysis]]:
    """Drop consecutive frames whose content-region embeddings cosine > 0.92.

    For each frame we generate a DINOv2 embedding of the CONTENT region only
    (or of the composite when one was produced). Walking the frames in
    chronological order, we compare each frame's crop-embedding to the
    most-recently-KEPT frame's; if the cosine similarity exceeds 0.92 the
    two are treated as the same content state and we keep whichever has the
    higher `quality.composite_score`. Otherwise we keep the new frame.

    Returns `[(original_index, pframe, analysis), ...]` for the kept frames.
    """
    if not _load_dinov2():
        # DINOv2 unavailable — fall back to keeping everything; downstream
        # modules will still produce results, just with possible duplicates.
        logger.warning(
            "content_region_dedup: DINOv2 not available — passing all frames through."
        )
        return [
            (pf.original_index, pf, an) for pf, an in zip(pframes, analyses)
        ]

    # Compute one embedding per frame, on the content crop (or composite).
    embeddings: list[Optional[np.ndarray]] = []
    for idx, (pf, analysis) in enumerate(zip(pframes, analyses)):
        composite = composites.get(idx)
        if composite is not None and composite.size > 0:
            source = composite
            if analysis.content_region is not None:
                source = _crop_to_region_arr(source, analysis.content_region)
        elif analysis.content_region is not None:
            source = _crop_to_region_arr(pf.image, analysis.content_region)
        else:
            source = pf.image
        try:
            embeddings.append(_get_embedding(source))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "content_region_dedup: embedding failed for frame %d: %s", idx, exc
            )
            embeddings.append(None)

    kept: list[tuple[int, _PFrame, FrameRegionAnalysis]] = []
    kept_emb: list[Optional[np.ndarray]] = []

    for idx, (pf, analysis, emb) in enumerate(zip(pframes, analyses, embeddings)):
        if not kept:
            kept.append((pf.original_index, pf, analysis))
            kept_emb.append(emb)
            continue

        prev_idx, prev_pf, prev_an = kept[-1]
        prev_emb = kept_emb[-1]

        if emb is None or prev_emb is None:
            kept.append((pf.original_index, pf, analysis))
            kept_emb.append(emb)
            continue

        sim = float(np.dot(emb, prev_emb))
        if sim > 0.92:
            # Same state — keep whichever frame has the higher quality score.
            if pf.quality.composite_score > prev_pf.quality.composite_score:
                kept[-1] = (pf.original_index, pf, analysis)
                kept_emb[-1] = emb
            # else: drop pf (don't append)
        else:
            kept.append((pf.original_index, pf, analysis))
            kept_emb.append(emb)

    logger.info(
        "content_region_dedup: %d -> %d frames after similarity collapse.",
        len(pframes), len(kept),
    )
    return kept


# --- Persistence helpers ---------------------------------------------------


# Regexes used to protect LaTeX spans across the markdown -> HTML pass.
# Order matters: display math FIRST so its $$...$$ delimiters are not
# half-eaten by the inline $...$ pattern.
_LATEX_DISPLAY = re.compile(r"\$\$[\s\S]+?\$\$")
_LATEX_INLINE = re.compile(r"\$[^$\n]+?\$")
_LATEX_PAREN = re.compile(r"\\\([\s\S]+?\\\)")
_LATEX_BRACKET = re.compile(r"\\\[[\s\S]+?\\\]")


def _markdown_to_html(markdown_text: str) -> str:
    """Convert markdown -> HTML while keeping LaTeX spans byte-identical.

    The frontend's RichContent component already renders inline `$...$` and
    `$$...$$` via KaTeX, but it expects the surrounding text to already be
    HTML (headings, lists, code blocks). We run python-markdown over the
    text WITHOUT letting it touch math spans — backslash- and underscore-
    heavy LaTeX collides badly with markdown emphasis rules (`f_x`,
    `\\frac`, etc.). The protect / restore dance keeps everything intact.
    """
    if not markdown_text:
        return ""

    placeholders: dict[str, str] = {}

    def _stash(match: re.Match) -> str:
        token = f"@@LATEX{len(placeholders)}@@"
        placeholders[token] = match.group(0)
        return token

    protected = markdown_text
    for pattern in (_LATEX_DISPLAY, _LATEX_BRACKET, _LATEX_INLINE, _LATEX_PAREN):
        protected = pattern.sub(_stash, protected)

    html = md_lib.markdown(
        protected,
        extensions=["fenced_code", "tables", "sane_lists"],
        output_format="html",
    )

    for token, original in placeholders.items():
        html = html.replace(token, original)
    return html


_MAX_DISPLAY_SECTIONS = 15  # belt-and-braces — also reinforced in the prompt


def _split_markdown_to_sections(markdown: str) -> list[dict]:
    """Coarsely split synthesised markdown by `## ` headings.

    Used only to populate the existing notes_json.sections shape so the
    current frontend has something to render. A future frontend that knows
    how to render the raw markdown can read notes_json.markdown directly.

    If the model still produces too many `## ` sections, adjacent ones are
    merged into groups (the merged section keeps the first title and the
    original sub-titles are demoted to `### ` sub-headings inside the body)
    so the notes page never shows a 40-item table of contents.
    """
    if not markdown:
        return []
    sections: list[dict] = []
    current_title = "Notes"
    buffer: list[str] = []
    for line in markdown.splitlines():
        if line.startswith("## "):
            if buffer or current_title != "Notes":
                sections.append(
                    {"title": current_title, "body": "\n".join(buffer).strip()}
                )
            current_title = line[3:].strip() or "Notes"
            buffer = []
        else:
            buffer.append(line)
    sections.append({"title": current_title, "body": "\n".join(buffer).strip()})
    sections = [s for s in sections if s["body"]]

    if len(sections) <= _MAX_DISPLAY_SECTIONS:
        return sections

    # Too many — merge into groups of ceil(N/cap) so the top-level count
    # comes in at or under the cap. Demote sub-section titles to ### so
    # nothing is lost from the notes.
    import math
    group_size = math.ceil(len(sections) / _MAX_DISPLAY_SECTIONS)
    merged: list[dict] = []
    for i in range(0, len(sections), group_size):
        group = sections[i : i + group_size]
        title = group[0]["title"]
        body_parts = [group[0]["body"]] if group[0]["body"] else []
        for sub in group[1:]:
            body_parts.append(f"### {sub['title']}")
            if sub["body"]:
                body_parts.append(sub["body"])
        merged.append({"title": title, "body": "\n\n".join(body_parts).strip()})
    return merged


def _parse_section_number(title: str) -> Optional[int]:
    """Parse section number from title (e.g. '3. Title' -> 3)."""
    match = re.match(r"^(\d+)\b", title.strip())
    if match:
        return int(match.group(1))
    return None


def merge_stitched_sections(
    sections: list[StitchedSection],
    max_cap: int = 15,
) -> list[StitchedSection]:
    """Merge stitched sections to keep the section count under max_cap."""
    if len(sections) <= max_cap:
        return sections

    import math
    group_size = math.ceil(len(sections) / max_cap)
    merged: list[StitchedSection] = []

    for i in range(0, len(sections), group_size):
        group = sections[i : i + group_size]
        first = group[0]

        # Combine transcripts
        transcripts = [s.full_transcript for s in group if s.full_transcript]
        merged_transcript = "\n\n".join(transcripts)

        # Merge code blocks, equations, important_frames, topics
        merged_code = []
        for s in group:
            merged_code.extend(s.code_blocks)

        merged_eq = []
        for s in group:
            merged_eq.extend(s.equations)

        merged_frames = []
        for s in group:
            merged_frames.extend(s.important_frames)

        merged_topics = []
        for s in group:
            merged_topics.extend(s.topics)

        # Unique topics
        seen_topics = set()
        unique_topics = []
        for t in merged_topics:
            if t not in seen_topics:
                seen_topics.add(t)
                unique_topics.append(t)

        # Generate combined title
        titles = [s.title for s in group if s.title and s.title != "Untitled section"]
        if titles:
            seen_titles = set()
            unique_titles = []
            for t in titles:
                if t not in seen_titles:
                    seen_titles.add(t)
                    unique_titles.append(t)
            title = " / ".join(unique_titles[:3])  # Limit length
        else:
            title = "Untitled section"

        # Combine analyses
        merged_analyses = []
        for s in group:
            merged_analyses.extend(s.analyses)

        new_sec = StitchedSection(
            section_number=first.section_number,
            title=title,
            start_time=first.start_time,
            end_time=group[-1].end_time,
            start_timestamp=first.start_timestamp,
            analyses=merged_analyses,
            full_transcript=merged_transcript,
            code_blocks=merged_code,
            equations=merged_eq,
            important_frames=merged_frames,
            topics=unique_topics,
        )
        merged.append(new_sec)

    # Renumber sequentially
    for idx, sec in enumerate(merged, start=1):
        sec.section_number = idx

    return merged


def _clean_summary_markdown(markdown_text: str) -> str:
    if not markdown_text:
        return ""
    lines = markdown_text.strip().splitlines()
    cleaned_lines = []
    found_content = False
    for line in lines:
        stripped = line.strip()
        if not found_content:
            if stripped.startswith("#"):
                continue
            if not stripped:
                continue
            found_content = True
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def _safe_slice_markdown(md: str, max_chars: int = 350) -> str:
    if len(md) <= max_chars:
        return md

    in_inline_paren = False   # \( ... \)
    in_block_bracket = False  # \[ ... \]
    in_inline_dollar = False  # $ ... $
    in_block_dollar = False   # $$ ... $$

    i = 0
    n = len(md)

    while i < n:
        if i >= max_chars:
            if not (in_inline_paren or in_block_bracket or in_inline_dollar or in_block_dollar):
                slice_idx = i
                for j in range(i, min(i + 30, n)):
                    if md[j] in (' ', '\n', '\t', '.', ',', ';', '!'):
                        slice_idx = j
                        break
                return md[:slice_idx].strip() + "…"

        if i < n - 1 and md[i:i+2] == "\\(":
            in_inline_paren = True
            i += 2
            continue
        elif i < n - 1 and md[i:i+2] == "\\)":
            in_inline_paren = False
            i += 2
            continue
        elif i < n - 1 and md[i:i+2] == "\\[":
            in_block_bracket = True
            i += 2
            continue
        elif i < n - 1 and md[i:i+2] == "\\]":
            in_block_bracket = False
            i += 2
            continue
        elif i < n - 1 and md[i:i+2] == "$$":
            in_block_dollar = not in_block_dollar
            i += 2
            continue
        elif md[i] == "$":
            in_inline_dollar = not in_inline_dollar
            i += 1
            continue

        i += 1

    return md


# Labels from the synthesis template that should never be a takeaway. Earlier
# versions of the prompt emitted these as bold section labels, and the
# heuristic kept picking them up — guard explicitly.
_TAKEAWAY_SKIP = {
    "context", "context:", "core content", "core content:",
    "concrete grounding", "concrete grounding:",
    "visual reference", "visual reference:",
    "connection", "connection:",
    "key takeaway", "key takeaway:",
    "tl;dw", "tl;dw:", "notes", "notes:",
    "callout boxes", "callout boxes:",
    "end of notes", "end of notes.",
    "summary", "summary:",
}


def _extract_takeaway(html: str) -> str:
    """Extract the key takeaway from a section's HTML.

    Priority order:
    1. Last display equation ($$...$$) — usually the key result.
    2. A CONCEPT: card if present.
    3. First substantive bold text (not a section label).
    4. First sentence longer than 20 chars (label-filtered).
    """
    if not html:
        return ""

    # 1. Last display equation.
    equations = re.findall(r'\$\$(.*?)\$\$', html, re.DOTALL)
    if equations:
        eq = equations[-1].strip()
        if len(eq) > 3:  # skip trivial matches
            return f"$${eq}$$"

    # 2. CONCEPT card.
    concept = re.search(r'CONCEPT:\s*(.+?)(?:\n|<br|</)', html)
    if concept:
        return concept.group(1).strip()

    # 3. Bold text that isn't a section label.
    strongs = re.findall(r'<strong>(.*?)</strong>', html)
    for s in strongs:
        cleaned = s.strip().lower().rstrip(':').rstrip('.')
        if cleaned not in _TAKEAWAY_SKIP and len(cleaned) > 5:
            return s.strip()

    # 4. First substantive sentence (strip HTML tags first).
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    sentences = re.split(r'(?<=[.!?])\s+', text)
    for sentence in sentences:
        cleaned_lower = sentence.strip().lower().rstrip(':').rstrip('.')
        if cleaned_lower not in _TAKEAWAY_SKIP and len(sentence.strip()) > 20:
            result = sentence.strip()
            if len(result) > 150:
                result = result[:147] + "..."
            return result

    return ""


def _build_notes_json(
    markdown: str,
    stitched_sections,
    extractions: list[dict],
    video_meta: dict,
    embedding: list[float] | None,
    image_b64_by_idx: dict[int, str] | None = None,
) -> dict:
    """Compose a notes_json payload compatible with the existing schema.

    Stores BOTH the raw markdown (for a future renderer) and a per-section
    breakdown with content_html set to the section's slice of the markdown.

    When `image_b64_by_idx` is provided, captured-frame visuals are inlined
    as data-URL JPEGs so the existing frontend renders the images.
    """
    md_sections = _split_markdown_to_sections(markdown)
    sections_out: list[dict] = []
    image_b64_by_idx = image_b64_by_idx or {}

    # Strip out meta-sections the model may emit despite the prompt instruction.
    # These are sections like "## 1. Notes" or "## TL;DW" that just regurgitate
    # the summary at the top of the document.
    _META_TITLES = {
        "notes", "tl;dw", "tldw", "summary", "overview", "introduction",
        "final study notes", "study notes", "end of notes",
    }
    md_sections_filtered: list[dict] = []
    for sec in md_sections:
        title_lower = (sec.get("title") or "").strip().lower()
        title_clean = re.sub(r"^\d+[\.\)]\s*", "", title_lower).strip()
        if title_clean in _META_TITLES:
            continue
        if title_clean.startswith("final study notes"):
            continue
        if title_clean.startswith("tl;dw") or title_clean.startswith("tl:dw"):
            continue
        md_sections_filtered.append(sec)
    # If filtering would empty the document (e.g. the model only emitted meta
    # sections), keep the originals so we still produce some output.
    if md_sections_filtered:
        md_sections = md_sections_filtered

    # Pair each markdown section with the stitched section at the SAME ORDINAL
    # POSITION. Earlier code tried to match by the number the model emitted
    # in the title (e.g. "## 2. Foo"), but the model's numbering is unreliable
    # — it can hit a valid post-merge section_number and silently point to
    # the wrong content. Position pairing is robust as long as the model
    # respects the input section order, which the synthesis prompt enforces.

    for idx, md in enumerate(md_sections):
        title = md["title"]
        body = md["body"]
        stitched = stitched_sections[idx] if idx < len(stitched_sections) else None

        title_cleaned = re.sub(r"^\d+\.\s*", "", title)  # Strip leading "1. " from title for cleaner UI
        # Strip LaTeX delimiters and stray macros so titles read cleanly in the UI.
        title_cleaned = re.sub(r"\\\(|\\\)|\\\[|\\\]|\$\$?", "", title_cleaned).strip()
        title_cleaned = re.sub(r"\\operatorname\{([^}]+)\}", r"\1", title_cleaned)
        title_cleaned = re.sub(r"\\[a-zA-Z]+", "", title_cleaned).strip()
        title_cleaned = re.sub(r"\s+", " ", title_cleaned).strip()
        timestamp = stitched.start_time if stitched else 0.0

        # Build captured-frame visuals from the stitched section's important_frames
        visuals: list[dict] = []
        if stitched is not None:
            for important in getattr(stitched, "important_frames", []) or []:
                frame_idx = important.get("frame_index")
                image_b64 = image_b64_by_idx.get(frame_idx)
                if not image_b64:
                    continue
                visuals.append(
                    {
                        "type": "captured_frame",
                        "frame_index": frame_idx,
                        "timestamp_seconds": important.get("timestamp"),
                        "timestamp_str": important.get("timestamp_str"),
                        "image_url": f"data:image/jpeg;base64,{image_b64}",
                        "caption": (
                            important.get("visual_description")
                            or important.get("alignment_note")
                            or ""
                        ),
                    }
                )

        sections_out.append(
            {
                "number": idx + 1,  # Sequential 1-based index
                "title": title_cleaned,
                "timestamp_seconds": timestamp,
                # LaTeX-safe markdown -> HTML
                "content_html": _markdown_to_html(body),
                "key_takeaway": _extract_takeaway(_markdown_to_html(body)),
                "visuals": visuals,
            }
        )

    summary_md = _clean_summary_markdown(markdown)
    summary_sliced = _safe_slice_markdown(summary_md, max_chars=350)
    summary_html = _markdown_to_html(summary_sliced)

    return {
        "summary": summary_html,
        "topics": list(dict.fromkeys(t for sec in stitched_sections for t in getattr(sec, 'topics', []) if t))[:12],
        "sections": sections_out,
        "markdown": markdown,
        "embedding": embedding,
        "extractions": extractions,
        "content_classification": video_meta.get("content_classification") or {},
    }


def _compute_stats(
    pframes: list[_PFrame],
    extractions: list[dict],
    stitched_sections,
) -> dict:
    """Summarise the run for the job's stats column."""
    return {
        "frames_captured": len(pframes),
        "frames_important": sum(
            1 for e in extractions if e.get("is_important") and e.get("content_type") != "error"
        ),
        "diagrams_generated": 0,
        "code_blocks_extracted": sum(
            len(getattr(s, "code_blocks", []) or []) for s in stitched_sections
        ),
        "equations_extracted": sum(
            len(getattr(s, "equations", []) or []) for s in stitched_sections
        ),
        "sections_count": len(stitched_sections),
    }


# --- Main entry point ------------------------------------------------------


async def _run_synthesis_and_persist(
    job_id: str,
    url: str,
    video_meta: dict,
    section_dicts: list[dict],
    stitched_sections_dict: list[dict],
    extractions: list[dict],
    image_b64_by_idx: dict[int, str],
    frames_captured_count: int,
    cache_path: str,
) -> None:
    from types import SimpleNamespace
    from pipeline.model_router import generate_embedding, synthesize_notes

    # 1. Note Synthesis (Stage 9)
    await update_job(
        job_id, status="writing", progress=90,
        stage_detail="Synthesising final notes (from cache)...",
    )
    markdown = await asyncio.to_thread(
        synthesize_notes, section_dicts, video_meta
    )

    # Embedding of the synthesised notes — best-effort; ignore failures.
    try:
        embedding = await asyncio.to_thread(generate_embedding, markdown)
    except Exception as exc:  # noqa: BLE001
        logger.warning("generate_embedding failed: %s", exc)
        embedding = None

    # 2. Reconstruct stitched_sections list of SimpleNamespace objects
    stitched_sections = []
    for sec_dict in stitched_sections_dict:
        s = SimpleNamespace(
            start_time=sec_dict.get("start_time"),
            important_frames=sec_dict.get("important_frames", []),
            code_blocks=sec_dict.get("code_blocks", []),
            equations=sec_dict.get("equations", [])
        )
        stitched_sections.append(s)

    # 3. Persist (Stage 10)
    await update_job(
        job_id, status="writing", progress=96,
        stage_detail="Saving notes...",
    )

    notes_json = _build_notes_json(
        markdown=markdown,
        stitched_sections=stitched_sections,
        extractions=extractions,
        video_meta=video_meta,
        embedding=embedding,
        image_b64_by_idx=image_b64_by_idx,
    )
    
    mock_pframes = [None] * frames_captured_count
    stats = _compute_stats(mock_pframes, extractions, stitched_sections)
    
    await save_notes(job_id, notes_json, stats)
    
    # Delete the cache file on successful save
    try:
        if os.path.exists(cache_path):
            os.remove(cache_path)
            logger.info("Successfully deleted pipeline cache file %s", cache_path)
    except Exception as exc:
        logger.warning("Failed to delete pipeline cache: %s", exc)


async def process_video_enhanced(job_id: str, url: str) -> None:
    """Run the enhanced pipeline for one job, updating its DB record.

    Drop-in replacement for the existing `orchestrator.process_video` —
    same `(job_id, url)` signature, same status-update conventions, same
    final `save_notes` so the existing frontend keeps working.
    """
    temp_dir: Optional[str] = None

    existing = await get_job(job_id)
    if existing and existing.get("status") in ("error", "complete"):
        logger.info("Skipping job %s — already %s", job_id, existing["status"])
        return

    try:
        import json
        from pipeline.download import extract_video_id
        
        # Check for cached pipeline results from a previous run to allow instant resumption
        try:
            video_id = extract_video_id(url)
            cache_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "storage",
                "pipeline_cache",
            )
            cache_path = os.path.join(cache_dir, f"{video_id}.json")
            
            if os.path.exists(cache_path):
                logger.info("Found cached pipeline state for video %s at %s. Resuming note synthesis...", video_id, cache_path)
                with open(cache_path, "r", encoding="utf-8") as fh:
                    cached = json.load(fh)
                
                # Run note synthesis and persist from cache
                await _run_synthesis_and_persist(
                    job_id=job_id,
                    url=url,
                    video_meta=cached["video_meta"],
                    section_dicts=cached["section_dicts"],
                    stitched_sections_dict=cached["stitched_sections_dict"],
                    extractions=cached["extractions"],
                    image_b64_by_idx={int(k): v for k, v in cached["image_b64_by_idx"].items()},
                    frames_captured_count=cached.get("frames_captured_count", 0),
                    cache_path=cache_path,
                )
                return
        except Exception as exc:
            logger.warning("Could not resume from pipeline cache: %s", exc)
            # Fall through to run full pipeline

        # ============================================================
        # Stage 0a — Download
        # ============================================================
        await update_job(
            job_id, status="downloading", progress=4,
            stage_detail="Downloading video...",
        )
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
            await fail_job(job_id, "download", str(exc))
            return

        temp_dir = download.temp_dir
        await update_job(
            job_id,
            video_title=download.title,
            video_channel=download.channel,
            video_duration=download.duration_seconds,
            video_thumbnail=download.thumbnail_url,
        )

        # ============================================================
        # Stage 0b — Transcript
        # ============================================================
        await update_job(
            job_id, status="transcribing", progress=12,
            stage_detail="Fetching transcript...",
        )
        transcript: list[TranscriptSegment] = await asyncio.to_thread(
            get_transcript, download.video_id
        )

        # ============================================================
        # Stage 1 — DINOv2 first pass (candidate frames)
        # ============================================================
        await update_job(
            job_id, status="capturing", progress=22,
            stage_detail="Extracting candidate frames...",
        )
        frames_dir = os.path.join(temp_dir, "frames")
        try:
            captured: list[CapturedFrame] = await asyncio.to_thread(
                extract_smart_frames, download.video_path, frames_dir
            )
        except FrameExtractionError as exc:
            await fail_job(job_id, "frames", str(exc))
            return
        if not captured:
            await fail_job(job_id, "frames", "No frames could be extracted from the video.")
            return

        logger.info(
            "[DIAG] Stage 1 complete: %d frames extracted by extract_smart_frames.",
            len(captured),
        )

        # Frontend's "N frames captured" counter reads this field.
        await update_job(job_id, frames_captured=len(captured))

        # Materialise each captured frame as an ndarray.
        decoded: list[tuple[CapturedFrame, np.ndarray]] = []
        for cf in captured:
            arr = _ndarray_from_captured(cf)
            if arr is not None:
                decoded.append((cf, arr))
        if not decoded:
            await fail_job(job_id, "frames", "Captured frames could not be decoded.")
            return

        logger.info(
            "[DIAG] Stage 1 decode: %d/%d frames decoded successfully from disk/base64.",
            len(decoded), len(captured),
        )

        # ============================================================
        # Stage 2 — Quality metrics + SKIP filter + RE_GRAB rescue
        # ============================================================
        await update_job(
            job_id, status="capturing", progress=34,
            stage_detail="Scoring frame quality...",
        )

        # Adapter objects with .timestamp + .image — what score_all_frames expects.
        @dataclass
        class _ScoreItem:
            timestamp: float
            image: np.ndarray

        score_inputs = [
            _ScoreItem(timestamp=cf.timestamp, image=arr) for cf, arr in decoded
        ]
        quality_scores = await asyncio.to_thread(
            score_all_frames, score_inputs, transcript
        )

        pframes: list[_PFrame] = []
        for idx, ((cf, arr), q) in enumerate(zip(decoded, quality_scores)):
            if q.routing == FrameRouting.SKIP:
                logger.info(
                    "[DIAG] Stage 2 SKIP: frame idx=%d t=%.1fs  "
                    "composite=%.4f  ocr=%.3f  entropy=%.3f  mismatch_raw=%.3f",
                    idx, cf.timestamp,
                    q.composite_score, q.ocr_density,
                    q.visual_entropy, q.transcript_mismatch,
                )
                continue
            pframes.append(
                _PFrame(
                    timestamp=cf.timestamp,
                    image=arr,
                    original_index=idx,
                    quality=q,
                    captured=cf,
                )
            )

        logger.info(
            "[DIAG] Stage 2 quality filter: %d/%d frames survive SKIP filter "
            "(%d SKIP'd).",
            len(pframes), len(decoded), len(decoded) - len(pframes),
        )

        # RE_GRAB: pull better frames from the raw video.
        n_regrab_attempted = sum(1 for pf in pframes if pf.quality.routing == FrameRouting.RE_GRAB)
        n_regrab_success = 0
        n_regrab_fail = 0
        logger.info(
            "[DIAG] Stage 2 RE_GRAB: %d frames flagged for re-grab.",
            n_regrab_attempted,
        )
        for i, pf in enumerate(pframes):
            if pf.quality.routing != FrameRouting.RE_GRAB:
                continue
            replacement = await asyncio.to_thread(
                find_best_frame,
                download.video_path,
                pf.timestamp,
                compute_ocr_density,
            )
            if replacement is None:
                # Couldn't rescue — keep the original but route it as STD so
                # we at least attempt extraction rather than dropping silently.
                logger.info(
                    "[DIAG] RE_GRAB failed at t=%.1fs (video deleted or no readable frame found) "
                    "— falling back to PROCESS_STD.",
                    pf.timestamp,
                )
                pf.quality.routing = FrameRouting.PROCESS_STD
                n_regrab_fail += 1
                continue
            new_image, new_ts = replacement
            new_quality = _score_replacement(
                new_image, new_ts, transcript, template=pf.quality
            )
            pframes[i] = _PFrame(
                timestamp=new_ts,
                image=new_image,
                original_index=pf.original_index,
                quality=new_quality,
                captured=None,
            )
            n_regrab_success += 1
            logger.info(
                "[DIAG] RE_GRAB success: replaced t=%.1fs with t=%.1fs.",
                pf.timestamp, new_ts,
            )

        if n_regrab_attempted:
            logger.info(
                "[DIAG] RE_GRAB summary: %d attempted, %d succeeded, %d failed "
                "(fell back to PROCESS_STD).",
                n_regrab_attempted, n_regrab_success, n_regrab_fail,
            )

        if not pframes:
            await fail_job(
                job_id, "frames", "All frames were skipped after quality scoring."
            )
            return

        logger.info(
            "[DIAG] Stage 2 complete: %d frames entering region detection.",
            len(pframes),
        )

        # ============================================================
        # Stage 2.5 — Refine each frame to its densest neighbour
        # ============================================================
        # WHY: Scene-change detection lands on moments of CHANGE, which on
        # a whiteboard lecture often means the board going from FULL to
        # EMPTY (a big visual change). The frame the viewer actually wants
        # is the one just BEFORE the erase started — board most full of
        # writing. For each kept frame, scan a ±5s window and swap it for
        # the frame whose OCR density is highest. That naturally picks
        # the "just finished writing" moment instead of the erasing one.
        # OCR density is local (MSER) — no API calls, ~10ms per candidate.
        from pipeline.regrab import regrab_frames

        await update_job(
            job_id, status="capturing", progress=40,
            stage_detail="Refining frames to densest content...",
        )

        n_refined = 0
        for pf in pframes:
            candidates = regrab_frames(
                download.video_path, pf.timestamp, window=5.0, count=7
            )
            if not candidates:
                continue
            best_score = compute_ocr_density(pf.image)
            best_image: np.ndarray = pf.image
            best_ts = pf.timestamp
            for cand_img, cand_ts in candidates:
                score = compute_ocr_density(cand_img)
                if score > best_score:
                    best_score = score
                    best_image = cand_img
                    best_ts = cand_ts
            if best_image is not pf.image:
                pf.image = best_image
                pf.timestamp = best_ts
                n_refined += 1
        logger.info(
            "[DIAG] Stage 2.5 density refinement: swapped %d/%d frames "
            "for higher-OCR neighbours.",
            n_refined, len(pframes),
        )

        # ============================================================
        # Stage 3 — Region detection
        # ============================================================
        await update_job(
            job_id, status="reading", progress=42,
            stage_detail="Detecting layout & content regions...",
        )
        region_detector = RegionDetector()
        analyses: list[FrameRegionAnalysis] = [
            region_detector.analyze_frame(pf.image) for pf in pframes
        ]

        # ============================================================
        # Stage 4 — Compositing for whiteboard frames needing it
        # ============================================================
        await update_job(
            job_id, status="reading", progress=48,
            stage_detail="Building clean board composites...",
        )
        composites: dict[int, np.ndarray] = {}
        kept_pframes_after_comp = []
        kept_analyses_after_comp = []
        for i, (pf, analysis) in enumerate(zip(pframes, analyses)):
            if (
                analysis.layout == FrameLayout.WHITEBOARD_LECTURE
                and analysis.needs_compositing
            ):
                try:
                    comp = await asyncio.to_thread(
                        composite_frame,
                        download.video_path,
                        pf.timestamp,
                        region_detector,
                        _get_embedding,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "compositing failed at t=%.1fs: %s", pf.timestamp, exc
                    )
                    comp = None
                
                if comp is not None:
                    new_idx = len(kept_pframes_after_comp)
                    composites[new_idx] = comp
                    pf.image = comp  # overwrite with clean board composite
                    kept_pframes_after_comp.append(pf)
                    kept_analyses_after_comp.append(analysis)
                else:
                    logger.info(
                        "[DIAG] Skipping occluded whiteboard frame at t=%.1fs because compositing failed (unstable board).",
                        pf.timestamp,
                    )
            else:
                new_idx = len(kept_pframes_after_comp)
                kept_pframes_after_comp.append(pf)
                kept_analyses_after_comp.append(analysis)
                
        pframes = kept_pframes_after_comp
        analyses = kept_analyses_after_comp

        # ============================================================
        # Stage 5 — Content-region dedup
        # ============================================================
        unique = content_region_dedup(pframes, analyses, composites)
        if not unique:
            await fail_job(
                job_id, "frames", "All frames were collapsed by content dedup."
            )
            return

        logger.info(
            "[DIAG] Stage 5 content_region_dedup: %d frames → %d unique frames.",
            len(pframes), len(unique),
        )

        # Update the counter to the actually-analysed frame count.
        await update_job(job_id, frames_captured=len(unique))

        # ============================================================
        # Stage 6 — Visual-primitives annotation + Stage 7 extraction
        # ============================================================
        await update_job(
            job_id, status="reading", progress=58,
            stage_detail="Reading frames with model routing...",
        )

        extractions: list[dict] = []
        kept_pframes: list[_PFrame] = []
        kept_analyses: list[FrameRegionAnalysis] = []
        total = len(unique)
        logger.info(
            "[DIAG] Stage 6-7 vision extraction: starting on %d frames.", total
        )
        for n, (idx_in_pframes, pf, analysis) in enumerate(unique):
            composite_for_frame = composites.get(idx_in_pframes)
            image_b64, prompt_ctx = prepare_frame_for_api(
                pf.image, analysis, composite_frame=composite_for_frame
            )
            transcript_window = _transcript_window_text(transcript, pf.timestamp)

            extraction, confidence, model_used, retried = await asyncio.to_thread(
                extract_with_retry,
                image_b64,
                prompt_ctx,
                transcript_window,
                pf.quality.routing,
                pf.timestamp,
            )
            extraction["_confidence"] = confidence
            extraction["_retried"] = retried
            extractions.append(extraction)
            kept_pframes.append(pf)
            kept_analyses.append(analysis)

            # Live progress within the extraction loop (58% -> 80%).
            await update_job(
                job_id,
                progress=58 + int(round(22 * (n + 1) / max(1, total))),
                stage_detail=f"Extracting frame {n + 1}/{total}...",
            )

        # ============================================================
        # Stage 8 — Stitch via existing stitch_analyses
        # ============================================================
        await update_job(
            job_id, status="writing", progress=82,
            stage_detail="Stitching sections...",
        )

        aligned: list[AlignedAnalysis] = []
        for pf, ext in zip(kept_pframes, extractions):
            # IMPORTANT: frame_index must match the key used in image_b64_by_idx
            # (which is keyed by cf.frame_index = the position in captured[]).
            # pf.original_index is the position in decoded[] — when frames are
            # SKIP'd in Stage 2 the two values diverge and the image lookup misses.
            # For RE_GRAB replacements (pf.captured is None) we have no better
            # index and fall back to original_index; those frames won't have an
            # inline image in the notes (which is acceptable).
            if pf.captured is not None:
                display_frame_index = pf.captured.frame_index
            else:
                display_frame_index = pf.original_index

            logger.debug(
                "[DIAG] AlignedAnalysis frame_index=%d (original_index=%d, captured=%s) t=%.1fs",
                display_frame_index, pf.original_index,
                "yes" if pf.captured else "no (regrab)",
                pf.timestamp,
            )

            aligned.append(
                AlignedAnalysis(
                    frame_index=display_frame_index,
                    timestamp=pf.timestamp,
                    timestamp_str=format_timestamp(pf.timestamp),
                    transcript_context=_transcript_window_text(transcript, pf.timestamp),
                    content_type=ext.get("content_type", "other"),
                    visual_description=ext.get("visual_description", ""),
                    extracted_text=ext.get("extracted_text", ""),
                    alignment_note=ext.get("alignment_note", ""),
                    is_important=bool(ext.get("is_important", True)),
                    importance_reason="",
                    topic=ext.get("topic", ""),
                )
            )

        stitched_sections = await asyncio.to_thread(
            stitch_analyses, aligned, transcript, download.duration_seconds,
        )
        stitched_sections = merge_stitched_sections(stitched_sections, max_cap=15)

        # ============================================================
        # Stage 9 — Synthesis + embedding
        # ============================================================
        await update_job(
            job_id, status="writing", progress=90,
            stage_detail="Synthesising final notes...",
        )

        section_dicts = []
        for sec in stitched_sections:
            d = dataclasses.asdict(sec)
            # asdict loses non-serialisable bits; we only need the model-facing shape.
            d["analyses"] = [
                {
                    "content_type": a.content_type,
                    "extracted_text": a.extracted_text,
                    "visual_description": a.visual_description,
                    "alignment_note": a.alignment_note,
                    "timestamp": a.timestamp,
                }
                for a in (sec.analyses or [])
            ]
            section_dicts.append(d)

        video_meta = {
            "title": download.title,
            "channel": download.channel,
            "duration_seconds": download.duration_seconds,
            "url": url,
        }

        # Build the image lookup from the FINAL kept_pframes — every entry
        # corresponds to a frame that actually went through extraction, and
        # the key is the same value `AlignedAnalysis.frame_index` carries,
        # so the lookup in _build_notes_json is guaranteed to hit. This also
        # means RE_GRAB replacements contribute their RESCUED image (not the
        # original bad one) because pf.image is the rescued ndarray.
        image_b64_by_idx: dict[int, str] = {}
        for pf in kept_pframes:
            key = (
                pf.captured.frame_index
                if pf.captured is not None
                else pf.original_index
            )
            ok, buf = cv2.imencode(
                ".jpg", pf.image, [int(cv2.IMWRITE_JPEG_QUALITY), 85]
            )
            if ok:
                image_b64_by_idx[key] = base64.b64encode(buf.tobytes()).decode("ascii")
        logger.info(
            "[DIAG] image_b64_by_idx: %d entries (from kept_pframes), keys=%s",
            len(image_b64_by_idx),
            sorted(image_b64_by_idx.keys()),
        )

        # Cache the pipeline state before note synthesis/DB saving
        try:
            cache_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "storage",
                "pipeline_cache",
            )
            os.makedirs(cache_dir, exist_ok=True)
            video_id = download.video_id
            cache_path = os.path.join(cache_dir, f"{video_id}.json")
            
            stitched_sections_dict = []
            for sec in stitched_sections:
                sec_dict = dataclasses.asdict(sec)
                sec_dict["analyses"] = []  # Not needed for note synthesis
                stitched_sections_dict.append(sec_dict)
                
            cache_data = {
                "video_meta": {
                    "title": download.title,
                    "channel": download.channel,
                    "duration_seconds": download.duration_seconds,
                    "url": url,
                    "video_id": download.video_id,
                    "thumbnail_url": download.thumbnail_url,
                },
                "section_dicts": section_dicts,
                "extractions": extractions,
                "stitched_sections_dict": stitched_sections_dict,
                "image_b64_by_idx": {str(k): v for k, v in image_b64_by_idx.items()},
                "frames_captured_count": len(kept_pframes),
            }
            with open(cache_path, "w", encoding="utf-8") as fh:
                json.dump(cache_data, fh, ensure_ascii=False, indent=2)
            logger.info("Saved pipeline cache to %s", cache_path)
        except Exception as exc:
            logger.warning("Failed to save pipeline cache: %s", exc)

        # ============================================================
        # Stage 9 — Synthesis + embedding
        # ============================================================
        await update_job(
            job_id, status="writing", progress=90,
            stage_detail="Synthesising final notes...",
        )
        transcript_text = " ".join(seg.text for seg in (transcript or []) if getattr(seg, "text", None))
        markdown = await asyncio.to_thread(
            synthesize_notes, section_dicts, video_meta, transcript_text
        )

        # Embedding of the synthesised notes — best-effort; ignore failures.
        try:
            embedding = await asyncio.to_thread(generate_embedding, markdown)
        except Exception as exc:  # noqa: BLE001
            logger.warning("generate_embedding failed: %s", exc)
            embedding = None

        # ============================================================
        # Stage 10 — Persist
        # ============================================================
        await update_job(
            job_id, status="writing", progress=96,
            stage_detail="Saving notes...",
        )

        notes_json = _build_notes_json(
            markdown=markdown,
            stitched_sections=stitched_sections,
            extractions=extractions,
            video_meta=video_meta,
            embedding=embedding,
            image_b64_by_idx=image_b64_by_idx,
        )
        stats = _compute_stats(kept_pframes, extractions, stitched_sections)
        await save_notes(job_id, notes_json, stats)

        # Delete the cache file on successful save
        try:
            if os.path.exists(cache_path):
                os.remove(cache_path)
                logger.info("Successfully deleted pipeline cache file %s", cache_path)
        except Exception as exc:
            logger.warning("Failed to delete pipeline cache: %s", exc)

    except Exception as exc:  # noqa: BLE001 — last-resort error handler
        logger.exception("Enhanced pipeline crashed for job %s", job_id)
        try:
            await fail_job(job_id, "pipeline", f"{type(exc).__name__}: {exc}")
        except Exception:
            pass
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
