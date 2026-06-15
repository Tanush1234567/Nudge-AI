"""Stage 4: aligned multimodal analysis — the core of Pupil.

WHY: This is where the product's value is created. Every other tool reads the
subtitles; here each captured frame is paired with the transcript of what was
*said* around it (an asymmetric ±20s/15s window) and BOTH are sent to Gemini
Vision in one call. The model sees the visual and knows what was being
discussed when it appeared — that temporal alignment is the whole product.

Frames are processed in batches of 3 (fits Gemini's context, minimizes calls)
with a 4.5s gap between batches to stay under the 15 RPM free-tier limit.
"""

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable

import google.generativeai as genai

from config import (
    FRAME_BATCH_SIZE,
    GEMINI_MODEL,
    GEMINI_RATE_LIMIT_DELAY,
    TRANSCRIPT_WINDOW_AFTER,
    TRANSCRIPT_WINDOW_BEFORE,
)
from pipeline.llm_fallback import fallback_available, vision_fallback
from pipeline.prompts import ALIGNED_VISION_PROMPT
from pipeline.transcript import TranscriptSegment, get_transcript_in_range

logger = logging.getLogger(__name__)

_MODEL_NAME = GEMINI_MODEL
_RATE_LIMIT_BACKOFF = 60.0  # seconds to wait after a 429 before the one retry

ProgressCallback = Callable[[float], None] | Callable[[float], Awaitable[None]]


@dataclass
class AlignedAnalysis:
    """Gemini's analysis of a single frame, paired with its transcript context."""

    frame_index: int
    timestamp: float
    timestamp_str: str
    transcript_context: str
    content_type: str
    visual_description: str
    extracted_text: str
    alignment_note: str
    is_important: bool
    importance_reason: str
    topic: str


def format_timestamp(seconds: float) -> str:
    """Format seconds as MM:SS, or H:MM:SS once past an hour."""
    total = max(0, int(seconds))
    hrs, rem = divmod(total, 3600)
    mins, secs = divmod(rem, 60)
    if hrs > 0:
        return f"{hrs}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def _parse_json_response(text: str) -> dict | list:
    """Parse a model JSON response, tolerating markdown fences and stray prose.

    Tries a direct parse first, then strips ```json fences, then falls back to
    extracting the outermost [...] or {...} span via regex.
    """
    if not text:
        raise ValueError("Empty response text.")

    cleaned = text.strip()

    # Strip a leading/trailing markdown code fence if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()

    # Models asked to emit LaTeX inside JSON string values routinely leave
    # backslashes unescaped (\frac, \dot — invalid JSON escapes). Try the
    # response as-is first; if that fails, retry with LaTeX-style
    # backslash+letter sequences escaped to valid JSON (\\frac).
    sanitized = re.sub(r"\\([a-zA-Z])", r"\\\\\1", cleaned)

    for candidate in (cleaned, sanitized):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        # Fallback: grab the first balanced-looking array or object span.
        for opener, closer in (("[", "]"), ("{", "}")):
            start = candidate.find(opener)
            end = candidate.rfind(closer)
            if start != -1 and end > start:
                try:
                    return json.loads(candidate[start : end + 1])
                except json.JSONDecodeError:
                    continue

    # Last resort: tolerant repair of malformed LLM JSON — handles literal
    # newlines, unescaped quotes, trailing commas, and truncated/unclosed
    # structures. Run on the backslash-sanitized text so LaTeX survives.
    try:
        import json_repair

        repaired = json_repair.loads(sanitized)
        if repaired not in (None, "", {}, []):
            logger.warning("Recovered malformed model JSON via json-repair.")
            return repaired
    except Exception as exc:  # noqa: BLE001
        logger.error("json-repair fallback failed: %s", exc)

    logger.error(
        "Unparseable model JSON. Head: %s ||| Tail: %s",
        cleaned[:300], cleaned[-300:],
    )
    raise ValueError("Could not parse JSON from model response.")


def _placeholder(
    frame_index: int,
    timestamp: float,
    transcript_context: str,
    reason: str,
) -> AlignedAnalysis:
    """Build a content_type='error' analysis so one bad batch never aborts the run."""
    return AlignedAnalysis(
        frame_index=frame_index,
        timestamp=timestamp,
        timestamp_str=format_timestamp(timestamp),
        transcript_context=transcript_context,
        content_type="error",
        visual_description="",
        extracted_text="",
        alignment_note="",
        is_important=False,
        importance_reason=reason,
        topic="",
    )


def _is_rate_limit(exc: Exception) -> bool:
    """True if the exception looks like a Gemini 429 / quota error."""
    text = f"{type(exc).__name__} {exc}".lower()
    return "429" in text or "quota" in text or "rate limit" in text or "resource_exhausted" in text


def _call_gemini(model: "genai.GenerativeModel", contents: list, generation_config) -> str:
    """Synchronous Gemini call. Raises on a content-filter block.

    Run inside asyncio.to_thread by the caller — the SDK is blocking.
    """
    response = model.generate_content(contents, generation_config=generation_config)

    # A content-filter block surfaces as an empty candidates list / prompt feedback.
    if not getattr(response, "candidates", None):
        block = getattr(getattr(response, "prompt_feedback", None), "block_reason", None)
        raise _ContentBlocked(f"Gemini blocked the request ({block}).")

    return response.text


class _ContentBlocked(Exception):
    """Raised when Gemini's safety filter blocks a batch — that batch is skipped."""


def _frame_text(frame, context: str) -> str:
    """Render the text block that accompanies one frame's image in a request.

    Shared by the Gemini content list and the OpenRouter fallback so both
    providers see an identically-worded prompt for each frame.
    """
    ts = format_timestamp(frame.timestamp)
    spoken = context.strip() or "(no transcript available for this moment)"
    return (
        f"FRAME at {ts} (t={frame.timestamp:.1f}s)\n"
        f"TRANSCRIPT CONTEXT (what was said around this frame):\n{spoken}"
    )


async def _maybe_await(fn, value) -> None:
    """Invoke a progress callback whether it is sync or async."""
    result = fn(value)
    if asyncio.iscoroutine(result):
        await result


async def analyze_aligned_frames(
    frames: list,
    transcript: list[TranscriptSegment],
    api_key: str,
    batch_size: int = FRAME_BATCH_SIZE,
    window_before: float = TRANSCRIPT_WINDOW_BEFORE,
    window_after: float = TRANSCRIPT_WINDOW_AFTER,
    on_progress: ProgressCallback | None = None,
) -> list[AlignedAnalysis]:
    """Analyze every captured frame against its transcript context via Gemini.

    Frames are CapturedFrame objects (timestamp, frame_index, image_base64).
    Returns one AlignedAnalysis per frame, in input order. Failed batches yield
    content_type='error' placeholders rather than raising — partial notes beat
    no notes.
    """
    if not frames:
        return []

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(_MODEL_NAME)
    generation_config = genai.types.GenerationConfig(
        temperature=0.1,
        max_output_tokens=4000,
        response_mime_type="application/json",
    )

    results: list[AlignedAnalysis] = []
    batches = [
        frames[i : i + batch_size] for i in range(0, len(frames), batch_size)
    ]

    for batch_num, batch in enumerate(batches):
        # (a) Pair each frame with the transcript spoken around its timestamp.
        contexts = [
            get_transcript_in_range(
                transcript, f.timestamp, window_before, window_after
            )
            for f in batch
        ]

        # (b) Build the alternating [prompt, text, image, text, image, ...] list.
        contents: list = [ALIGNED_VISION_PROMPT.format(count=len(batch))]
        for frame, context in zip(batch, contexts):
            contents.append(_frame_text(frame, context))
            contents.append(
                {
                    "mime_type": "image/jpeg",
                    "data": base64.b64decode(frame.image_base64),
                }
            )

        # (c)+(d) Call Gemini with retry/skip handling, then parse.
        batch_results = await _analyze_batch(
            model, generation_config, contents, batch, contexts
        )
        results.extend(batch_results)

        # (g) Report progress after each completed batch.
        if on_progress is not None:
            await _maybe_await(on_progress, (batch_num + 1) / len(batches))

        # (f) Throttle between batches to stay under the free-tier RPM limit.
        if batch_num < len(batches) - 1:
            await asyncio.sleep(GEMINI_RATE_LIMIT_DELAY)

    return results


async def _analyze_batch(
    model,
    generation_config,
    contents: list,
    batch: list,
    contexts: list[str],
) -> list[AlignedAnalysis]:
    """Run one Gemini batch with full edge-case handling.

    429 -> wait 60s, retry once. Network error -> retry once. Content block or
    unparseable JSON -> error placeholders for the whole batch.
    """
    raw_text: str | None = None
    attempts = 0

    while attempts < 2 and raw_text is None:
        attempts += 1
        try:
            raw_text = await asyncio.to_thread(
                _call_gemini, model, contents, generation_config
            )
        except _ContentBlocked as exc:
            logger.warning("Skipping batch — %s", exc)
            return [
                _placeholder(f.frame_index, f.timestamp, ctx, "content_filtered")
                for f, ctx in zip(batch, contexts)
            ]
        except Exception as exc:  # noqa: BLE001
            if _is_rate_limit(exc) and attempts < 2:
                logger.warning("Gemini rate-limited; waiting %.0fs before retry.", _RATE_LIMIT_BACKOFF)
                await asyncio.sleep(_RATE_LIMIT_BACKOFF)
                continue
            if attempts < 2:
                logger.warning("Gemini call failed (%s); retrying once.", exc)
                continue
            logger.error("Gemini call failed after retry: %s", exc)
            recovered = await _vision_via_fallback(batch, contexts)
            if recovered is not None:
                return recovered
            return [
                _placeholder(f.frame_index, f.timestamp, ctx, f"api_error: {exc}")
                for f, ctx in zip(batch, contexts)
            ]

    try:
        parsed = _parse_json_response(raw_text or "")
    except ValueError as exc:
        logger.error("Unparseable Gemini JSON for batch: %s", exc)
        recovered = await _vision_via_fallback(batch, contexts)
        if recovered is not None:
            return recovered
        return [
            _placeholder(f.frame_index, f.timestamp, ctx, "malformed_json")
            for f, ctx in zip(batch, contexts)
        ]

    return _to_analyses(parsed, batch, contexts)


async def _vision_via_fallback(
    batch: list,
    contexts: list[str],
) -> list[AlignedAnalysis] | None:
    """Re-run a failed vision batch through OpenRouter.

    Returns parsed analyses on success, or None if the fallback is disabled or
    also fails — the caller then emits error placeholders as before.
    """
    if not fallback_available():
        return None
    try:
        prompt_text = ALIGNED_VISION_PROMPT.format(count=len(batch))
        frames = [
            (_frame_text(frame, ctx), frame.image_base64)
            for frame, ctx in zip(batch, contexts)
        ]
        raw_text = await vision_fallback(prompt_text, frames)
        parsed = _parse_json_response(raw_text)
        logger.info("Vision batch recovered via OpenRouter fallback.")
        return _to_analyses(parsed, batch, contexts)
    except Exception as exc:  # noqa: BLE001 — fallback failure must not abort
        logger.error("OpenRouter vision fallback failed: %s", exc)
        return None


def _to_analyses(
    parsed: dict | list,
    batch: list,
    contexts: list[str],
) -> list[AlignedAnalysis]:
    """Map Gemini's JSON array onto AlignedAnalysis objects, one per frame."""
    items = parsed if isinstance(parsed, list) else parsed.get("frames", [])

    analyses: list[AlignedAnalysis] = []
    for i, (frame, context) in enumerate(zip(batch, contexts)):
        item = items[i] if i < len(items) and isinstance(items[i], dict) else None
        if item is None:
            analyses.append(
                _placeholder(frame.frame_index, frame.timestamp, context, "missing_in_response")
            )
            continue
        analyses.append(
            AlignedAnalysis(
                frame_index=frame.frame_index,
                timestamp=frame.timestamp,
                timestamp_str=format_timestamp(frame.timestamp),
                transcript_context=context,
                content_type=str(item.get("content_type", "other")),
                visual_description=str(item.get("visual_description", "")),
                extracted_text=str(item.get("extracted_text", "")),
                alignment_note=str(item.get("alignment_note", "")),
                is_important=bool(item.get("is_important", False)),
                importance_reason=str(item.get("importance_reason", "")),
                topic=str(item.get("topic", "")),
            )
        )
    return analyses
