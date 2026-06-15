"""Stage 6: synthesize stitched sections into final structured study notes.

WHY: This is the last LLM pass. The stitched sections already carry transcript,
code, equations, and aligned visual descriptions — synthesis turns that raw
material into polished, TA-quality notes. Captured-frame metadata is injected
back in afterwards (image URLs are filled in later, after Storage upload).
"""

import asyncio
import logging

import google.generativeai as genai

from config import GEMINI_MODEL
from pipeline.llm_fallback import fallback_available, synthesis_fallback
from pipeline.prompts import SYNTHESIS_PROMPT
from pipeline.stitch import StitchedSection
from pipeline.vision import _parse_json_response, format_timestamp

logger = logging.getLogger(__name__)


def _format_duration(seconds: float) -> str:
    """Format a duration as 'Xh Ym' past an hour, else 'X min'."""
    total = max(0, int(seconds))
    hrs, rem = divmod(total, 3600)
    mins = rem // 60
    if hrs > 0:
        return f"{hrs}h {mins}m"
    return f"{mins} min"


def _build_sections_text(sections: list[StitchedSection]) -> str:
    """Render stitched sections into the text block the prompt consumes."""
    blocks: list[str] = []
    for s in sections:
        lines = [
            f"=== SECTION {s.section_number}: {s.title} ===",
            f"Timestamp: {s.start_timestamp} (t={s.start_time:.0f}s - {s.end_time:.0f}s)",
            f"Topics: {', '.join(s.topics) if s.topics else '(none)'}",
            "",
            "TRANSCRIPT:",
            s.full_transcript.strip() or "(no transcript for this section)",
        ]

        if s.code_blocks:
            lines.append("")
            lines.append("CODE BLOCKS:")
            for cb in s.code_blocks:
                lines.append(
                    f"[{cb.get('language', 'text')} @ {cb.get('timestamp_str', '')}]"
                )
                lines.append(cb.get("code", ""))

        if s.equations:
            lines.append("")
            lines.append("EQUATIONS:")
            for eq in s.equations:
                lines.append(f"[@ {eq.get('timestamp_str', '')}] {eq.get('latex', '')}")

        if s.important_frames:
            lines.append("")
            lines.append("KEY VISUALS:")
            for fr in s.important_frames:
                lines.append(
                    f"[{fr.get('timestamp_str', '')}] "
                    f"({fr.get('content_type', 'other')}) "
                    f"{fr.get('visual_description', '')}"
                )
                align = fr.get("alignment_note", "")
                if align:
                    lines.append(f"  alignment: {align}")

        blocks.append("\n".join(lines))

    return "\n\n".join(blocks)


def _validate_notes(notes: dict) -> tuple[bool, list[str]]:
    """Check that synthesized notes have the minimum required structure."""
    warnings: list[str] = []

    if not isinstance(notes, dict):
        return False, ["Response is not a JSON object."]

    if not notes.get("summary"):
        warnings.append("Missing 'summary'.")

    sections = notes.get("sections")
    if not isinstance(sections, list) or not sections:
        warnings.append("Missing or empty 'sections' array.")
        return False, warnings

    for i, section in enumerate(sections):
        if not isinstance(section, dict):
            warnings.append(f"Section {i} is not an object.")
            continue
        if not section.get("title"):
            warnings.append(f"Section {i} missing 'title'.")
        if not section.get("content_html"):
            warnings.append(f"Section {i} missing 'content_html'.")

    # Valid enough to use if it has a summary and at least one usable section.
    is_valid = bool(notes.get("summary")) and any(
        isinstance(s, dict) and s.get("title") and s.get("content_html")
        for s in sections
    )
    return is_valid, warnings


def _inject_frame_references(notes: dict, sections: list[StitchedSection]) -> dict:
    """Replace model-invented captured_frame visuals with real frame metadata.

    The model cannot know real frame indices, so any captured_frame visual it
    generates is a hallucination — those are dropped. We then inject one real
    captured_frame per important frame. image_url is intentionally left empty;
    it is populated after the frame is uploaded to Supabase Storage.
    """
    by_number = {s.section_number: s for s in sections}

    for note_section in notes.get("sections", []):
        if not isinstance(note_section, dict):
            continue
        stitched = by_number.get(note_section.get("number"))

        visuals = note_section.get("visuals")
        if not isinstance(visuals, list):
            visuals = []
        # Drop the model's own captured_frame visuals (no valid frame_index).
        visuals = [
            v
            for v in visuals
            if not (isinstance(v, dict) and v.get("type") == "captured_frame")
        ]
        note_section["visuals"] = visuals

        if stitched is None:
            continue

        for frame in stitched.important_frames:
            visuals.append(
                {
                    "type": "captured_frame",
                    "frame_index": frame.get("frame_index"),
                    "timestamp_seconds": frame.get("timestamp"),
                    "timestamp_str": frame.get("timestamp_str"),
                    "image_url": "",  # filled in after Storage upload
                    "caption": frame.get("visual_description", ""),
                }
            )

    return notes


async def synthesize_notes(
    title: str,
    channel: str,
    duration_seconds: float,
    sections: list[StitchedSection],
    api_key: str,
) -> dict:
    """Generate final structured notes from stitched sections via Gemini.

    Calls Gemini with SYNTHESIS_PROMPT, validates the JSON structure, retries
    once on invalid output, then injects captured-frame metadata back in.
    Returns the notes dict; raises nothing the orchestrator can't handle —
    on total failure it returns a minimal valid-shaped notes object.
    """
    sections_text = _build_sections_text(sections)
    prompt = SYNTHESIS_PROMPT.format(
        title=title,
        channel=channel,
        duration=_format_duration(duration_seconds),
        num_sections=len(sections),
        sections_data=sections_text,
    )

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(GEMINI_MODEL)
    generation_config = genai.types.GenerationConfig(
        temperature=0.2,
        max_output_tokens=16000,  # long lectures produce long notes JSON
        response_mime_type="application/json",
    )

    notes: dict | None = None
    for attempt in range(2):
        try:
            response = await asyncio.to_thread(
                model.generate_content, prompt, generation_config=generation_config
            )
            parsed = _parse_json_response(response.text)
            candidate = parsed if isinstance(parsed, dict) else {}
            is_valid, warnings = _validate_notes(candidate)
            if warnings:
                logger.warning("Synthesis warnings (attempt %d): %s", attempt + 1, warnings)
            if is_valid:
                notes = candidate
                break
            logger.warning("Invalid synthesis output on attempt %d.", attempt + 1)
        except Exception as exc:  # noqa: BLE001
            logger.error("Synthesis call failed on attempt %d: %s", attempt + 1, exc)

    if notes is None and fallback_available():
        # Gemini exhausted — try the OpenRouter fallback before degrading.
        try:
            raw_text = await synthesis_fallback(prompt)
            parsed = _parse_json_response(raw_text)
            candidate = parsed if isinstance(parsed, dict) else {}
            is_valid, warnings = _validate_notes(candidate)
            if warnings:
                logger.warning("Synthesis fallback warnings: %s", warnings)
            if is_valid:
                logger.info("Synthesis recovered via OpenRouter fallback.")
                notes = candidate
        except Exception as exc:  # noqa: BLE001 — fall through to minimal notes
            logger.error("OpenRouter synthesis fallback failed: %s", exc)

    if notes is None:
        # Last resort: a minimal, validly-shaped notes object so the job can
        # still complete with the section material we already have.
        logger.error("Synthesis failed; returning fallback notes from sections.")
        notes = {
            "summary": f"Notes for '{title}' by {channel}.",
            "topics": sorted({t for s in sections for t in s.topics}),
            "sections": [
                {
                    "number": s.section_number,
                    "title": s.title,
                    "timestamp_seconds": int(s.start_time),
                    "content_html": f"<p>{s.full_transcript.strip()}</p>",
                    "key_takeaway": "",
                    "visuals": [],
                }
                for s in sections
            ],
        }

    return _inject_frame_references(notes, sections)
