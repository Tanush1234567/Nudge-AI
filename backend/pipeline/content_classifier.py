"""Two-axis content classifier for processed videos.

WHY: Many downstream features (UI surfaces, prompt tuning, resurfacing
weighting) want to know *what kind of video* this is — both how it was
delivered (lecture, tutorial, conference talk, …) and what domain it covers
(math/science, engineering/CS, business, …). One small `gpt-4.1-nano` call
classifies on both axes and produces a few extra signals (formality,
worked-examples, key terminology) for the UI to use later.

The function deliberately uses the cheapest model — this is plain text
classification with strong priors from the rest of the pipeline's signals
(equation count, code count, board frames). When the LLM call fails we fall
back to a simple keyword heuristic so callers never see an exception.
"""

import json
import logging
from typing import Any

from pipeline.model_router import _get_client

logger = logging.getLogger(__name__)


_CLASSIFY_MODEL = "gpt-4.1-nano"

VALID_FORMATS = {
    "lecture",
    "tutorial",
    "conference_talk",
    "explainer",
    "workshop",
    "discussion",
    "demo",
    "documentary",
    "general",
}

VALID_DOMAINS = {
    "math_science",
    "engineering_cs",
    "business",
    "humanities",
    "creative",
    "medical",
    "legal",
    "general",
}


CLASSIFY_PROMPT = """Classify this video based on its content.

VIDEO TITLE: {title}
CHANNEL: {channel}
DURATION: {duration} minutes

TRANSCRIPT EXCERPT (first 500 words):
{transcript_start}

TRANSCRIPT EXCERPT (middle 500 words):
{transcript_middle}

EXTRACTED CONTENT SUMMARY:
- Equations found: {equation_count}
- Code blocks found: {code_count}
- Slides detected: {slide_count}
- Whiteboard/chalkboard frames: {board_count}
- Diagrams/charts: {diagram_count}
- Topics identified: {topics}

Classify on two axes:

FORMAT (how it's delivered): Choose exactly one:
lecture, tutorial, conference_talk, explainer, workshop, discussion, demo, documentary, general

DOMAIN (what it's about): Choose exactly one:
math_science, engineering_cs, business, humanities, creative, medical, legal, general

Also identify:
- FORMALITY: formal, semi_formal, casual
- HAS_EQUATIONS: true/false
- HAS_CODE: true/false
- HAS_WORKED_EXAMPLES: true/false (did the speaker work through specific numerical/concrete examples?)
- SPEAKER_STYLE: academic, professional, conversational, enthusiastic
- KEY_TERMINOLOGY: list 5-10 domain-specific terms used

Respond ONLY with JSON, no markdown, no explanation:
{{
  "format": "...",
  "domain": "...",
  "formality": "...",
  "has_equations": true,
  "has_code": false,
  "has_worked_examples": true,
  "speaker_style": "...",
  "key_terminology": ["...", "..."],
  "reasoning": "one sentence explaining your classification"
}}"""


def _call_classifier(prompt: str) -> str:
    """Single cheap OpenAI call with JSON-object response format."""
    client = _get_client()
    response = client.chat.completions.create(
        model=_CLASSIFY_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=400,
        response_format={"type": "json_object"},
    )
    return (response.choices[0].message.content or "").strip()


def classify_content(
    video_meta: dict,
    transcript: str,
    sections: list[dict],
) -> dict:
    """Classify a processed video on format × domain axes.

    `video_meta` keys used: `title`, `channel`, `duration_seconds`.
    `sections` are the stitched-section dicts (or notes_json sections); only
    a handful of optional fields are read — anything missing is treated as 0.
    """
    equation_count = sum(len(s.get("equations") or []) for s in sections)
    code_count = sum(1 for s in sections if s.get("content_type") == "code")
    slide_count = sum(1 for s in sections if s.get("content_type") == "slide")
    board_count = sum(
        1 for s in sections if s.get("content_type") in ("chalkboard", "whiteboard")
    )
    diagram_count = sum(1 for s in sections if s.get("content_type") == "diagram")
    topics = list({s.get("topic", "") for s in sections if s.get("topic")})[:10]

    words = (transcript or "").split()
    total = len(words)
    transcript_start = " ".join(words[:500]) if total > 0 else ""
    if total > 500:
        mid = max(0, total // 2 - 250)
        transcript_middle = " ".join(words[mid : mid + 500])
    else:
        transcript_middle = ""

    duration_minutes = (video_meta.get("duration_seconds") or 0) / 60

    prompt = CLASSIFY_PROMPT.format(
        title=video_meta.get("title", "Unknown"),
        channel=video_meta.get("channel", "Unknown"),
        duration=f"{duration_minutes:.0f}",
        transcript_start=transcript_start or "(no transcript available)",
        transcript_middle=transcript_middle or "(short video — no midpoint excerpt)",
        equation_count=equation_count,
        code_count=code_count,
        slide_count=slide_count,
        board_count=board_count,
        diagram_count=diagram_count,
        topics=", ".join(topics) if topics else "none identified",
    )

    try:
        raw = _call_classifier(prompt)
        result: dict[str, Any] = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("classify_content LLM call failed: %s", exc)
        return _heuristic_classify(
            equation_count, code_count, slide_count, board_count, video_meta
        )

    # Coerce invalid enum values back to "general" so downstream consumers
    # don't have to defensively validate.
    if result.get("format") not in VALID_FORMATS:
        result["format"] = "general"
    if result.get("domain") not in VALID_DOMAINS:
        result["domain"] = "general"

    # Normalise bool-ish strings the model may emit ("true"/"True" → True).
    for k in ("has_equations", "has_code", "has_worked_examples"):
        v = result.get(k)
        if isinstance(v, str):
            result[k] = v.lower() == "true"

    if not isinstance(result.get("key_terminology"), list):
        result["key_terminology"] = []

    return result


def _heuristic_classify(
    equation_count: int,
    code_count: int,
    slide_count: int,
    board_count: int,
    video_meta: dict,
) -> dict:
    """Keyword-only fallback used when the LLM call fails."""
    title = (video_meta.get("title", "") or "").lower()

    fmt = "general"
    if board_count > 3 or "lecture" in title or "lec " in title:
        fmt = "lecture"
    elif "tutorial" in title or "how to" in title or "build" in title:
        fmt = "tutorial"
    elif any(w in title for w in ("talk", "keynote", "conference", "summit", "ted")):
        fmt = "conference_talk"
    elif any(w in title for w in ("interview", "podcast", "panel", "discussion")):
        fmt = "discussion"
    elif any(w in title for w in ("demo", "walkthrough", "feature")):
        fmt = "demo"

    domain = "general"
    if equation_count > 5:
        domain = "math_science"
    elif code_count > 3:
        domain = "engineering_cs"

    return {
        "format": fmt,
        "domain": domain,
        "formality": "semi_formal",
        "has_equations": equation_count > 0,
        "has_code": code_count > 0,
        "has_worked_examples": False,
        "speaker_style": "professional",
        "key_terminology": [],
        "reasoning": "heuristic fallback (LLM unavailable)",
    }
