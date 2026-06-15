"""OpenAI client + intelligent model routing for extraction & synthesis.

WHY: Vision calls dominate cost. Routing each frame to the cheapest model
that can actually read it — and bumping low-confidence Nano results up to
Mini — is the single biggest lever on cost vs. quality. The pre-vision
quality scorer (`pipeline.quality_metrics`) already classifies each frame
into a FrameRouting tier; this module maps that tier to the right model,
detail level, and post-vision retry policy.

Routing table:
  PROCESS_LOW   -> gpt-4.1-nano  (detail="low",  cheapest path)
  PROCESS_STD   -> gpt-4.1-nano  (detail="auto", default path)
  PROCESS_HIGH  -> gpt-4.1-mini  (detail="high", precision path)

Static (instructions, output schema) goes BEFORE dynamic (per-frame
context) in every prompt so OpenAI's prompt-cache treats them as cacheable
prefixes — this matters when running through many frames in one batch.

The module reads OPENAI_API_KEY from config.py and uses the official
`openai` SDK. It imports `FrameRouting` and `compute_confidence` from
`pipeline.quality_metrics`; no other pipeline modules are touched.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from typing import Any, Optional

from openai import OpenAI
from openai import APIError, BadRequestError, RateLimitError

from config import OPENAI_API_KEY
from pipeline.quality_metrics import FrameRouting, compute_confidence

logger = logging.getLogger(__name__)


# --- Model selection --------------------------------------------------------

MODEL_MAP: dict[FrameRouting, tuple[str, str]] = {
    FrameRouting.PROCESS_LOW: ("gpt-4.1-nano", "low"),
    FrameRouting.PROCESS_STD: ("gpt-4.1-nano", "auto"),
    # HIGH tier uses Mini at "auto" detail (not "high") — cuts image-token
    # cost ~40% while still routing to the more capable model.
    FrameRouting.PROCESS_HIGH: ("gpt-4.1-mini", "auto"),
}

# Synthesis + embedding endpoints.
# Synthesis runs on nano: it produces plain Markdown, no JSON brittleness,
# and saves ~$0.013/hour vs. mini for negligible quality loss on prose.
SYNTHESIS_MODEL = "gpt-4.1-nano"
EMBEDDING_MODEL = "text-embedding-3-small"

# Tunables
_BATCH_SLEEP_SECONDS = 2.0       # gap between sequential extract calls
# Confidence floor lowered to accept marginal nano outputs rather than
# routinely upgrading to mini — biggest single-knob cost driver after
# percentile routing.
_NANO_CONFIDENCE_FLOOR = 0.3
_MAX_OUTPUT_TOKENS_EXTRACT = 1500
_MAX_OUTPUT_TOKENS_SYNTH = 8000


# --- Lazy OpenAI client -----------------------------------------------------

_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    """Return a singleton OpenAI client; created lazily on first call."""
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY is not set in the environment / .env."
            )
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


# --- Static prompt fragments (cacheable prefixes) ---------------------------

# Put this FIRST in every extraction prompt so OpenAI's cache reuses it.
_EXTRACTION_SYSTEM = (
    "You are a vision model extracting study-notes content from a single "
    "frame of an educational video. You read the BOARD or SLIDE in the "
    "frame, transcribing every equation, symbol, label, and code character "
    "verbatim. You IGNORE the presenter entirely — never describe their "
    "pose, gestures, or appearance. Hand-drawn math is still math; render "
    "it in valid LaTeX. Code is character-perfect; never paraphrase. The "
    "transcript window is provided as alignment context — use it to "
    "understand intent, but trust the image for the truth.\n"
    "\n"
    "Return ONLY a JSON object with this exact shape (no markdown fences):\n"
    "{\n"
    '  "content_type": "slide | code | equation | diagram | chalkboard | demo | talking_head | other",\n'
    '  "extracted_text": "every readable symbol/word on the visible content, verbatim, with hand math in LaTeX",\n'
    '  "visual_description": "what the content MEANS — the concept/structure of the diagram; not the presenter",\n'
    '  "alignment_note": "how the spoken transcript relates to the visible content",\n'
    '  "is_important": true,\n'
    '  "topic": "2-5 word topic label"\n'
    "}\n"
)

# Static tail appended to every user prompt — keeps schema reminder right
# before the dynamic content for models that drift away from instructions.
_OUTPUT_REMINDER = "Return ONLY the JSON object described above."

# Routing-specific addendum for HIGH-precision extractions.
_HIGH_PRECISION_ADDENDUM = (
    "This frame was flagged as high-value: take extra care to transcribe "
    "every symbol and to capture small annotations, subscripts, and "
    "marginalia that a faster pass would miss."
)


def _build_user_content(
    image_base64: str,
    prompt_context: str,
    transcript_window: str,
    routing: FrameRouting,
    timestamp: float,
    detail: str,
) -> list[dict]:
    """Build the multi-part user message: static reminder, then dynamic, then image."""
    parts: list[dict] = [
        # Static comes first so the cache prefix is as long as possible.
        {"type": "text", "text": _OUTPUT_REMINDER},
    ]
    if routing == FrameRouting.PROCESS_HIGH:
        parts.append({"type": "text", "text": _HIGH_PRECISION_ADDENDUM})

    parts.append(
        {
            "type": "text",
            "text": (
                f"FRAME TIMESTAMP: {timestamp:.2f}s\n\n"
                f"{prompt_context.strip()}\n\n"
                f"TRANSCRIPT WINDOW:\n{(transcript_window or '').strip()}"
            ),
        }
    )
    parts.append(
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{image_base64}",
                "detail": detail,
            },
        }
    )
    return parts


# --- JSON parsing -----------------------------------------------------------


def _parse_json_loose(text: str) -> Optional[dict]:
    """Best-effort JSON parse. Strips fences and tries the first {...} span."""
    if not text:
        return None
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


# --- Public: single-frame extraction ---------------------------------------


def _call_chat_for_json(
    model: str,
    user_content: list[dict],
    max_tokens: int,
) -> str:
    """Call chat-completions and return the raw message text. Raises on hard errors."""
    client = _get_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _EXTRACTION_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        max_tokens=max_tokens,
        temperature=0.1,
    )
    return response.choices[0].message.content or ""


def extract_frame(
    image_base64: str,
    prompt_context: str,
    transcript_window: str,
    routing: FrameRouting,
    timestamp: float,
) -> dict:
    """Run one vision extraction and return the parsed JSON dict.

    Picks the model + image detail level from MODEL_MAP. Retries the parse
    ONCE if the first response isn't valid JSON (some models occasionally
    drop a stray prefix even with response_format set).
    """
    if routing not in MODEL_MAP:
        raise ValueError(f"extract_frame called with non-process routing {routing}.")

    model, detail = MODEL_MAP[routing]
    user_content = _build_user_content(
        image_base64=image_base64,
        prompt_context=prompt_context,
        transcript_window=transcript_window,
        routing=routing,
        timestamp=timestamp,
        detail=detail,
    )

    for attempt in (1, 2):
        try:
            raw = _call_chat_for_json(
                model, user_content, _MAX_OUTPUT_TOKENS_EXTRACT
            )
        except (RateLimitError, APIError, BadRequestError) as exc:
            if attempt == 1:
                logger.warning(
                    "extract_frame[%s] attempt %d failed: %s — retrying.",
                    model, attempt, exc,
                )
                time.sleep(2.0)
                continue
            raise

        parsed = _parse_json_loose(raw)
        if parsed is not None:
            parsed.setdefault("_model_used", model)
            parsed.setdefault("_timestamp", timestamp)
            return parsed

        logger.warning(
            "extract_frame[%s] returned unparseable JSON on attempt %d.",
            model, attempt,
        )

    # Both attempts produced unparseable output — surface a structured failure.
    return {
        "content_type": "error",
        "extracted_text": "",
        "visual_description": "",
        "alignment_note": "",
        "is_important": False,
        "topic": "extraction_failed",
        "_model_used": model,
        "_timestamp": timestamp,
        "_error": "unparseable_json",
    }


# --- Public: sequential batch ---------------------------------------------


def extract_batch(
    frames_data: list[tuple[str, str, str, float]],
    routing: FrameRouting,
) -> list[dict]:
    """Run extract_frame on each (image_b64, prompt_ctx, transcript, ts) tuple.

    Sequential with a fixed gap between calls — respects per-minute rate
    limits without needing client-side bucketing. Failures of individual
    frames do not stop the batch; each result is the corresponding dict
    (possibly the {content_type:'error'} placeholder).
    """
    results: list[dict] = []
    for i, item in enumerate(frames_data):
        image_b64, prompt_ctx, transcript_window, timestamp = item
        try:
            extraction = extract_frame(
                image_base64=image_b64,
                prompt_context=prompt_ctx,
                transcript_window=transcript_window,
                routing=routing,
                timestamp=timestamp,
            )
        except Exception as exc:  # noqa: BLE001 — one bad frame must not abort
            logger.error("extract_batch frame %d failed: %s", i, exc)
            extraction = {
                "content_type": "error",
                "extracted_text": "",
                "visual_description": "",
                "alignment_note": "",
                "is_important": False,
                "topic": "extraction_failed",
                "_timestamp": timestamp,
                "_error": str(exc),
            }
        results.append(extraction)

        # Polite pacing — skip the sleep after the last frame.
        if i < len(frames_data) - 1:
            time.sleep(_BATCH_SLEEP_SECONDS)

    return results


# --- Public: extract with confidence-based upgrade ------------------------


def extract_with_retry(
    image_base64: str,
    prompt_context: str,
    transcript_window: str,
    routing: FrameRouting,
    timestamp: float,
) -> tuple[dict, float, str, bool]:
    """Extract once; if confidence is low on a Nano result, retry on Mini.

    Returns (extraction, confidence, model_used, retried).
    `retried` is True only when the Nano output's confidence fell below the
    floor and the frame was re-run through PROCESS_HIGH (Mini).
    """
    extraction = extract_frame(
        image_base64=image_base64,
        prompt_context=prompt_context,
        transcript_window=transcript_window,
        routing=routing,
        timestamp=timestamp,
    )
    text_for_confidence = (
        extraction.get("extracted_text") or ""
    ) + " " + (extraction.get("visual_description") or "")
    confidence = compute_confidence(text_for_confidence)
    model_used = extraction.get("_model_used", MODEL_MAP[routing][0])

    is_nano = "nano" in model_used.lower()
    if confidence < _NANO_CONFIDENCE_FLOOR and is_nano:
        logger.info(
            "Low confidence (%.2f) on %s — upgrading frame at %.1fs to Mini.",
            confidence, model_used, timestamp,
        )
        upgraded = extract_frame(
            image_base64=image_base64,
            prompt_context=prompt_context,
            transcript_window=transcript_window,
            routing=FrameRouting.PROCESS_HIGH,
            timestamp=timestamp,
        )
        upgraded_text = (
            upgraded.get("extracted_text") or ""
        ) + " " + (upgraded.get("visual_description") or "")
        upgraded_confidence = compute_confidence(upgraded_text)
        # Keep the better of the two (precision goes up monotonically with
        # the upgrade in practice, but defend against a worse Mini outlier).
        if upgraded_confidence >= confidence:
            return (
                upgraded,
                upgraded_confidence,
                upgraded.get("_model_used", MODEL_MAP[FrameRouting.PROCESS_HIGH][0]),
                True,
            )

    return (extraction, confidence, model_used, False)


# --- Public: synthesis -----------------------------------------------------


def synthesize_notes(
    sections: list[dict],
    video_metadata: dict,
    transcript: str = "",
) -> str:
    """Send all extracted sections to the synthesis model; return markdown.

    Classifies the video on format × domain via `classify_content` and feeds
    the result through `build_synthesis_prompt` to compose an adaptive system
    prompt. The classification itself is also written back onto
    `video_metadata["content_classification"]` so the orchestrator can persist
    it into notes_json for the frontend / resurfacing / concept layers.
    """
    # Local imports to avoid a circular-import risk at module load time.
    from pipeline.content_classifier import classify_content
    from pipeline.synthesis_templates import build_synthesis_prompt

    section_count = len(sections)
    classification = classify_content(video_metadata, transcript, sections)
    video_metadata["content_classification"] = classification

    system_prompt = build_synthesis_prompt(
        classification=classification,
        section_count=section_count,
    )

    user_payload = {
        "video": {
            "title": video_metadata.get("title", ""),
            "channel": video_metadata.get("channel", ""),
            "duration_seconds": video_metadata.get("duration_seconds"),
        },
        "sections": sections,
    }
    user_text = (
        "Write the final study notes from the following extracted sections. "
        "Use the instructor's own notation. Order sections chronologically.\n"
        "\n"
        f"```json\n{json.dumps(user_payload, ensure_ascii=False, indent=2)}\n```"
    )

    client = _get_client()
    response = client.chat.completions.create(
        model=SYNTHESIS_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        max_tokens=_MAX_OUTPUT_TOKENS_SYNTH,
        temperature=0.25,
    )
    return (response.choices[0].message.content or "").strip()


# --- Public: embeddings ----------------------------------------------------


def generate_embedding(text: str) -> list[float]:
    """Return a 1536-dim embedding for the given text.

    Uses text-embedding-3-small. Empty text returns a zero vector rather than
    raising, so callers can use the embedding for similarity scoring without
    special-casing missing content.
    """
    if not text or not text.strip():
        return [0.0] * 1536
    client = _get_client()
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
    )
    return list(response.data[0].embedding)
