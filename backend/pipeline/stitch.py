"""Stage 5: stitch raw frame analyses into coherent, ordered sections.

WHY: Vision produces one analysis per frame; synthesis needs topic-coherent
*sections*. This module groups analyses by topic + time proximity, pulls the
full transcript for each section, deduplicates code/equations, and fills long
speech-only gaps so a talking-head lecture still produces usable notes.
"""

import logging
import re
from collections import Counter
from dataclasses import dataclass, field

from config import CONTENT_DEDUP_THRESHOLD
from pipeline.transcript import TranscriptSegment, get_transcript_in_range
from pipeline.vision import AlignedAnalysis, format_timestamp

logger = logging.getLogger(__name__)

# Content-bearing frame types — only these are worth showing as a section
# image. A talking_head shot of just the lecturer adds nothing to the notes.
_VISUAL_CONTENT_TYPES = {
    "code", "equation", "diagram", "slide", "chalkboard", "demo",
}

# A topic change OR a gap larger than this starts a new section.
_TIME_GAP_THRESHOLD = 120.0
# Transcript padding around a section's frame span.
_TRANSCRIPT_PAD_BEFORE = 5.0
_TRANSCRIPT_PAD_AFTER = 30.0
# Talking-head fallback: split a frameless lecture every 5 minutes.
_TALKING_HEAD_CHUNK = 300.0

# Per-language keyword sets for the code-language heuristic.
_LANG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "python": ("def ", "import ", "print(", "elif ", "lambda ", "self.", "__init__"),
    "javascript": ("const ", "let ", "function ", "=>", "console.log", "var "),
    "java": ("public class", "public static void", "System.out.", "private ", "void "),
    "cpp": ("#include", "std::", "int main(", "cout <<", "cin >>", "->"),
    "sql": ("SELECT ", "FROM ", "WHERE ", "INSERT INTO", "JOIN ", "GROUP BY"),
    "html": ("<!DOCTYPE", "<html", "<div", "<span", "</", "<body"),
    "css": ("{", "}", "margin:", "padding:", "color:", "display:"),
    "r": ("<- ", "library(", "data.frame", "ggplot(", "c("),
}


@dataclass
class StitchedSection:
    """A topic-coherent slice of the video, ready for synthesis."""

    section_number: int
    title: str
    start_time: float
    end_time: float
    start_timestamp: str
    analyses: list = field(default_factory=list)
    full_transcript: str = ""
    code_blocks: list[dict] = field(default_factory=list)
    equations: list[dict] = field(default_factory=list)
    important_frames: list[dict] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)


def _normalize_topic(topic: str) -> str:
    """Lowercase + collapse whitespace for loose topic comparison."""
    return re.sub(r"\s+", " ", (topic or "").strip().lower())


def _detect_language(code: str, topic: str) -> str:
    """Guess a code block's language from keyword hits; default 'text'."""
    haystack = f"{code}\n{topic}"
    scores: dict[str, int] = {}
    for lang, keywords in _LANG_KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in haystack)
        if hits:
            scores[lang] = hits
    if not scores:
        return "text"
    return max(scores, key=scores.get)


def _looks_like_equation(text: str) -> bool:
    """True if a line of extracted text resembles a maths equation."""
    if not text:
        return False
    if re.search(r"\\[a-zA-Z]+|\\frac|\\sum|\\int|\^|_\{", text):
        return True
    # A bare '=' with maths-ish symbols around it (but not an assignment line).
    return "=" in text and bool(re.search(r"[+\-*/^∑∫√πθλ]", text))


def _group_analyses(analyses: list[AlignedAnalysis]) -> list[list[AlignedAnalysis]]:
    """Split important analyses into groups on topic change or a long time gap."""
    groups: list[list[AlignedAnalysis]] = []
    current: list[AlignedAnalysis] = []

    for analysis in analyses:
        if not current:
            current = [analysis]
            continue
        prev = current[-1]
        topic_changed = _normalize_topic(analysis.topic) != _normalize_topic(prev.topic)
        gap_too_large = (analysis.timestamp - prev.timestamp) > _TIME_GAP_THRESHOLD
        if topic_changed or gap_too_large:
            groups.append(current)
            current = [analysis]
        else:
            current.append(analysis)

    if current:
        groups.append(current)
    return groups


def _build_section(
    group: list[AlignedAnalysis],
    transcript: list[TranscriptSegment],
) -> StitchedSection:
    """Assemble one StitchedSection from a group of analyses."""
    start_time = group[0].timestamp
    end_time = group[-1].timestamp

    # Full transcript spanning the group, padded asymmetrically.
    span_center = (start_time + end_time) / 2
    half = (end_time - start_time) / 2
    full_transcript = get_transcript_in_range(
        transcript,
        span_center,
        window_before=half + _TRANSCRIPT_PAD_BEFORE,
        window_after=half + _TRANSCRIPT_PAD_AFTER,
    )

    # Deduplicate code blocks by whitespace-normalized content.
    code_blocks: list[dict] = []
    seen_code: set[str] = set()
    equations: list[dict] = []
    seen_eq: set[str] = set()

    for a in group:
        text = (a.extracted_text or "").strip()
        if not text:
            continue
        if a.content_type == "code":
            key = re.sub(r"\s+", "", text)
            if key and key not in seen_code:
                seen_code.add(key)
                code_blocks.append(
                    {
                        "code": text,
                        "language": _detect_language(text, a.topic),
                        "timestamp": a.timestamp,
                        "timestamp_str": a.timestamp_str,
                    }
                )
        elif a.content_type == "equation" or _looks_like_equation(text):
            key = re.sub(r"\s+", "", text)
            if key and key not in seen_eq:
                seen_eq.add(key)
                equations.append(
                    {
                        "latex": text,
                        "timestamp": a.timestamp,
                        "timestamp_str": a.timestamp_str,
                    }
                )

    # One representative frame per section — and ONLY a frame that actually
    # shows instructional content. A shot of just the lecturer (talking_head /
    # other) adds nothing, so frames of those types are never shown; a section
    # with no content-bearing frame simply shows no image.
    priority = {"code": 0, "equation": 0, "diagram": 1, "slide": 1, "chalkboard": 1}
    content_frames = [
        a for a in group if a.content_type in _VISUAL_CONTENT_TYPES
    ]
    ranked = sorted(
        content_frames,
        # Prefer the richest type, then the frame with the most extracted text.
        key=lambda a: (priority.get(a.content_type, 2), -len(a.extracted_text or "")),
    )
    important_frames = [
        {
            "frame_index": a.frame_index,
            "timestamp": a.timestamp,
            "timestamp_str": a.timestamp_str,
            "content_type": a.content_type,
            "visual_description": a.visual_description,
            "extracted_text": a.extracted_text,
            "alignment_note": a.alignment_note,
        }
        for a in ranked[:1]
    ]

    topic_counts = Counter(a.topic for a in group if a.topic)
    title = topic_counts.most_common(1)[0][0] if topic_counts else "Untitled section"
    topics = [t for t, _ in topic_counts.most_common()]

    return StitchedSection(
        section_number=0,  # renumbered later
        title=title,
        start_time=start_time,
        end_time=end_time,
        start_timestamp=format_timestamp(start_time),
        analyses=list(group),
        full_transcript=full_transcript,
        code_blocks=code_blocks,
        equations=equations,
        important_frames=important_frames,
        topics=topics,
    )


def _transcript_only_section(
    start: float,
    end: float,
    transcript: list[TranscriptSegment],
    title: str = "Discussion",
) -> StitchedSection:
    """Build a frameless section from transcript text alone."""
    center = (start + end) / 2
    half = (end - start) / 2
    text = get_transcript_in_range(
        transcript, center, window_before=half, window_after=half
    )
    return StitchedSection(
        section_number=0,
        title=title,
        start_time=start,
        end_time=end,
        start_timestamp=format_timestamp(start),
        full_transcript=text,
    )


def _fill_transcript_gaps(
    sections: list[StitchedSection],
    transcript: list[TranscriptSegment],
    video_duration: float,
    min_gap: float = 180.0,
) -> list[StitchedSection]:
    """Insert 'Discussion' sections for long stretches with no visual sections."""
    if not transcript:
        return sections

    filled: list[StitchedSection] = []
    cursor = 0.0
    for section in sorted(sections, key=lambda s: s.start_time):
        if section.start_time - cursor > min_gap:
            filler = _transcript_only_section(cursor, section.start_time, transcript)
            if filler.full_transcript.strip():
                filled.append(filler)
        filled.append(section)
        cursor = max(cursor, section.end_time)

    # Trailing gap after the last section.
    if video_duration - cursor > min_gap:
        filler = _transcript_only_section(cursor, video_duration, transcript)
        if filler.full_transcript.strip():
            filled.append(filler)

    return filled


def _sections_from_transcript(
    transcript: list[TranscriptSegment],
    video_duration: float,
) -> list[StitchedSection]:
    """Talking-head fallback: split a frameless video into time chunks."""
    if not transcript:
        return []

    end = max(video_duration, transcript[-1].end)
    sections: list[StitchedSection] = []
    start = 0.0
    while start < end:
        chunk_end = min(start + _TALKING_HEAD_CHUNK, end)
        section = _transcript_only_section(
            start, chunk_end, transcript, title="Lecture segment"
        )
        if section.full_transcript.strip():
            sections.append(section)
        start = chunk_end
    return sections


def _content_signature(analysis: AlignedAnalysis) -> str:
    """A normalized word-bag of what the vision model read off this frame.

    Uses extracted_text (verbatim board/slide content) as the primary signal;
    falls back to visual_description when a frame has little or no text.
    """
    text = (analysis.extracted_text or "").strip()
    if len(text) < 15:
        text = f"{text} {analysis.visual_description or ''}".strip()
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def _content_overlap(sig_a: str, sig_b: str) -> float:
    """Jaccard word overlap of two content signatures (0.0 - 1.0)."""
    words_a, words_b = set(sig_a.split()), set(sig_b.split())
    if not words_a and not words_b:
        return 1.0
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


def _deduplicate_by_content(
    analyses: list[AlignedAnalysis],
    threshold: float = CONTENT_DEDUP_THRESHOLD,
) -> list[AlignedAnalysis]:
    """Collapse frames whose extracted on-screen content is essentially the same.

    WHY: Pixel/embedding dedup is fooled by a moving presenter — whether he
    stands beside a slide or in front of a whiteboard. This compares the
    CONTENT the vision model actually read, so two frames of the same board
    collapse regardless of pose or framing, and two genuinely different slides
    stay separate even when the surrounding room makes them look alike.

    Keeps the first occurrence of each distinct content state. Error-typed
    analyses pass through untouched (they are filtered out downstream anyway).
    """
    kept: list[AlignedAnalysis] = []
    kept_signatures: list[str] = []

    for analysis in analyses:
        if analysis.content_type == "error":
            kept.append(analysis)
            continue

        signature = _content_signature(analysis)
        if not signature:
            # No readable content to compare — keep rather than guess.
            kept.append(analysis)
            continue

        duplicate_idx = -1
        for idx, seen in enumerate(kept_signatures):
            if _content_overlap(signature, seen) >= threshold:
                duplicate_idx = idx
                break

        if duplicate_idx != -1:
            # Duplicate state: keep the one with the longer extracted text.
            # This ensures we get the most complete board/slide representation.
            current_best = kept[duplicate_idx]
            new_text_len = len(analysis.extracted_text or "")
            old_text_len = len(current_best.extracted_text or "")
            if new_text_len > old_text_len:
                kept[duplicate_idx] = analysis
                kept_signatures[duplicate_idx] = signature
            continue

        kept.append(analysis)
        kept_signatures.append(signature)

    logger.info(
        "Content dedup: %d analyses -> %d distinct content states.",
        len(analyses), len(kept),
    )
    return kept


def stitch_analyses(
    analyses: list[AlignedAnalysis],
    transcript: list[TranscriptSegment],
    video_duration: float,
) -> list[StitchedSection]:
    """Group frame analyses into ordered, topic-coherent sections.

    Falls back to pure-transcript sections when no frame was marked important
    (e.g. a talking-head lecture). Returns sections renumbered from 1.
    """
    # Collapse frames that show the same content before grouping — this is
    # what actually keeps near-duplicate board/slide frames out of the notes.
    analyses = _deduplicate_by_content(analyses)

    important = [
        a for a in analyses if a.is_important and a.content_type != "error"
    ]
    important.sort(key=lambda a: a.timestamp)

    if not important:
        logger.info("No important frames — building sections from transcript only.")
        sections = _sections_from_transcript(transcript, video_duration)
    else:
        groups = _group_analyses(important)
        sections = [_build_section(g, transcript) for g in groups]
        sections = _fill_transcript_gaps(sections, transcript, video_duration)

    sections.sort(key=lambda s: s.start_time)
    for i, section in enumerate(sections, start=1):
        section.section_number = i

    # Deduplicate section titles. Prefer the first equation as a disambiguator
    # (more informative than a timestamp) and fall back to start_timestamp when
    # no equations were captured for that section.
    seen_titles: dict[str, int] = {}
    for section in sections:
        if section.title in seen_titles:
            seen_titles[section.title] += 1
            if section.equations:
                eq_preview = (section.equations[0].get("latex") or "")[:30]
                if eq_preview:
                    section.title = f"{section.title}: {eq_preview}"
                else:
                    section.title = f"{section.title} ({section.start_timestamp})"
            else:
                section.title = f"{section.title} ({section.start_timestamp})"
        else:
            seen_titles[section.title] = 1

    logger.info("Stitched %d analyses into %d sections.", len(analyses), len(sections))
    return sections
