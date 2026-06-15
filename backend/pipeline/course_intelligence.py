"""Course-level LLM artifacts: syllabus, master equations, exam guide.

WHY: Once every lecture in a course is processed, we have all the section
titles, equations, key takeaways, and topics needed to build course-wide
artifacts. These run once per course (cached in `courses` JSON columns) and
can be regenerated on demand from the API.
"""

import asyncio
import json
import logging
import re
from typing import Any

from db.courses import get_course, get_course_videos, save_course_intelligence
from json_repair import repair_json
from pipeline.model_router import SYNTHESIS_MODEL, _get_client, generate_embedding

logger = logging.getLogger(__name__)

_MAX_OUTPUT_TOKENS = 6000


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _collect_lecture_summaries(videos: list[dict]) -> list[dict]:
    """Distil what each completed lecture contributes for the prompt."""
    summaries: list[dict] = []
    for v in videos:
        if v.get("status") != "complete":
            continue
        notes = v.get("notes_json") or {}
        sections = notes.get("sections") or []
        equations: list[str] = []
        concepts: set[str] = set()
        takeaways: list[str] = []
        section_titles: list[str] = []

        for sec in sections:
            title = sec.get("title") or ""
            if title:
                section_titles.append(title)
            takeaway = sec.get("key_takeaway")
            if takeaway:
                takeaways.append(_strip_html(takeaway))
            html = sec.get("content_html") or ""
            # Equations: pull all $$...$$ blocks; cap to avoid token bloat.
            equations.extend(re.findall(r"\$\$(.*?)\$\$", html, re.DOTALL)[:8])

        for t in (notes.get("topics") or []):
            if isinstance(t, str) and t.strip():
                concepts.add(t.strip())

        summaries.append(
            {
                "lecture_number": v.get("lecture_number"),
                "title": v.get("video_title") or "Untitled lecture",
                "section_titles": section_titles[:20],
                "equations": equations[:25],
                "concepts": sorted(concepts)[:20],
                "takeaways": takeaways[:8],
            }
        )
    return summaries


def _parse_json_strict(raw: str) -> dict | None:
    """Best-effort JSON parse with `json_repair` fallback."""
    if not raw or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            repaired = repair_json(raw)
            return json.loads(repaired) if isinstance(repaired, str) else repaired
        except Exception:  # noqa: BLE001
            return None


_SYLLABUS_SYSTEM = (
    "You are an expert curriculum designer building a syllabus from already-"
    "processed lecture notes. Group content by TOPIC across lectures rather "
    "than lecture-by-lecture. Be specific: use the actual equations, "
    "concepts, and lecture references provided. Output VALID JSON only — "
    "no markdown fences, no commentary."
)


def _build_syllabus_user_prompt(course_title: str, lectures: list[dict]) -> str:
    lecture_blocks: list[str] = []
    for L in lectures:
        block = (
            f"Lecture {L['lecture_number']}: {L['title']}\n"
            f"Sections: {', '.join(L['section_titles']) or '—'}\n"
            f"Key equations: {' | '.join(L['equations']) or '—'}\n"
            f"Key concepts: {', '.join(L['concepts']) or '—'}\n"
            f"Key takeaways: {' | '.join(L['takeaways']) or '—'}"
        )
        lecture_blocks.append(block)

    return (
        f"COURSE: {course_title}\n"
        f"TOTAL LECTURES: {len(lectures)}\n\n"
        f"FOR EACH LECTURE:\n" + "\n\n".join(lecture_blocks) + "\n\n"
        "GENERATE a comprehensive syllabus with:\n"
        "1. A 2-3 sentence course overview.\n"
        "2. For each TOPIC (group by topic across lectures, not by lecture):\n"
        "   - title\n"
        "   - lectures: array of lecture numbers covering it\n"
        "   - equations: array of LaTeX strings ($$...$$)\n"
        "   - concepts: array of short concept names\n"
        "   - prerequisites: array of other topic titles in this course\n"
        "3. A master_equations array: every key equation across the course, "
        "with name, latex, lecture (number), and topic.\n\n"
        "Return ONLY JSON matching:\n"
        "{\n"
        '  "overview": "string",\n'
        '  "topics": [{"title":"...","lectures":[1,4],"equations":["..."],"concepts":["..."],"prerequisites":["..."]}],\n'
        '  "master_equations": [{"latex":"...","name":"...","lecture":1,"topic":"..."}]\n'
        "}"
    )


_EXAM_SYSTEM = (
    "You are writing the definitive exam study guide for a university course. "
    "Group by TOPIC, not lecture. Be specific: cite real equations and "
    "lecture timestamps from the provided material. Output VALID JSON only — "
    "no markdown fences, no commentary."
)


def _build_exam_user_prompt(course_title: str, lectures: list[dict]) -> str:
    lecture_blocks: list[str] = []
    for L in lectures:
        block = (
            f"Lecture {L['lecture_number']}: {L['title']}\n"
            f"Sections: {', '.join(L['section_titles']) or '—'}\n"
            f"Equations: {' | '.join(L['equations']) or '—'}\n"
            f"Concepts: {', '.join(L['concepts']) or '—'}\n"
            f"Takeaways: {' | '.join(L['takeaways']) or '—'}"
        )
        lecture_blocks.append(block)

    return (
        f"COURSE: {course_title}\n"
        f"TOTAL LECTURES: {len(lectures)}\n\n"
        "LECTURE INVENTORY:\n" + "\n\n".join(lecture_blocks) + "\n\n"
        "GENERATE an exam study guide with this EXACT structure:\n"
        "1. COURSE OVERVIEW (2-3 sentences — what this course teaches).\n"
        "2. TOPICS (organised by concept, NOT by lecture order). For each topic:\n"
        "   - title\n"
        "   - importance: HIGH | MEDIUM | LOW (based on how many lectures cover it)\n"
        "   - equations: array of {latex (with $$), description}\n"
        "   - explanation: 2-3 sentences\n"
        "   - best_source: {lecture, timestamp} — clearest explanation source\n"
        "   - exam_patterns: array of strings\n"
        "   - connections: array of OTHER topic titles\n"
        "3. MASTER_EQUATIONS — every key equation across the course, with:\n"
        "   latex, variables (what each symbol means), when_to_use, lecture, timestamp, topic.\n"
        "4. QUICK_REFERENCE — definitions, theorems, common_mistakes, patterns.\n\n"
        "Return ONLY JSON matching:\n"
        "{\n"
        '  "overview": "string",\n'
        '  "topics": [{\n'
        '    "title": "...",\n'
        '    "importance": "HIGH",\n'
        '    "equations": [{"latex": "$$...$$", "description": "..."}],\n'
        '    "explanation": "...",\n'
        '    "best_source": {"lecture": 1, "timestamp": "12:30"},\n'
        '    "exam_patterns": ["..."],\n'
        '    "connections": ["other topic title"]\n'
        "  }],\n"
        '  "master_equations": [{\n'
        '    "latex": "$$...$$",\n'
        '    "variables": "x = …, y = …",\n'
        '    "when_to_use": "...",\n'
        '    "lecture": 1,\n'
        '    "timestamp": "12:30",\n'
        '    "topic": "..."\n'
        "  }],\n"
        '  "quick_reference": {\n'
        '    "definitions": [{"term": "...", "definition": "..."}],\n'
        '    "theorems": [{"name": "...", "statement": "...", "proof_ref": "Lecture 4"}],\n'
        '    "common_mistakes": ["..."],\n'
        '    "patterns": [{"if_you_see": "...", "use": "..."}]\n'
        "  }\n"
        "}"
    )


def _call_llm(system: str, user: str) -> str:
    client = _get_client()
    response = client.chat.completions.create(
        model=SYNTHESIS_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=_MAX_OUTPUT_TOKENS,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    return (response.choices[0].message.content or "").strip()


async def generate_syllabus(course_id: str) -> dict | None:
    """Build and persist a course-level syllabus + master equations."""
    videos = await get_course_videos(course_id)
    completed = [v for v in videos if v.get("status") == "complete"]
    if not completed:
        logger.warning("generate_syllabus: course %s has no completed lectures", course_id)
        return None

    course_title = next(
        (v.get("video_title") for v in completed if v.get("video_title")), "Course"
    )
    lectures = _collect_lecture_summaries(completed)
    user = _build_syllabus_user_prompt(course_title, lectures)

    try:
        raw = await asyncio.to_thread(_call_llm, _SYLLABUS_SYSTEM, user)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Syllabus LLM call failed for %s: %s", course_id, exc)
        return None

    parsed = _parse_json_strict(raw)
    if not parsed:
        logger.error("Syllabus JSON parse failed for %s", course_id)
        return None

    master_eq = parsed.get("master_equations")
    await save_course_intelligence(
        course_id,
        syllabus_json=parsed,
        master_equations=master_eq if isinstance(master_eq, list) else None,
    )
    return parsed


async def generate_exam_guide(course_id: str) -> dict | None:
    """Build and persist a course exam study guide."""
    videos = await get_course_videos(course_id)
    completed = [v for v in videos if v.get("status") == "complete"]
    if not completed:
        return None

    course_title = next(
        (v.get("video_title") for v in completed if v.get("video_title")), "Course"
    )
    lectures = _collect_lecture_summaries(completed)
    user = _build_exam_user_prompt(course_title, lectures)

    try:
        raw = await asyncio.to_thread(_call_llm, _EXAM_SYSTEM, user)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Exam guide LLM call failed for %s: %s", course_id, exc)
        return None

    parsed = _parse_json_strict(raw)
    if not parsed:
        return None

    # Merge into concept_graph without trampling existing concepts data.
    course = await get_course(course_id)
    existing = (course or {}).get("concept_graph") or {}
    merged = {**existing, "exam_guide": parsed}
    await save_course_intelligence(course_id, concept_graph=merged)
    return parsed


# ---------------------------------------------------------------------------
# Concept tracking — cluster topics across lectures and infer prerequisites.
# ---------------------------------------------------------------------------

_CLUSTER_SIM_THRESHOLD = 0.85


def _format_timestamp(seconds: float | int | None) -> str:
    if not seconds:
        return "0:00"
    total = int(round(float(seconds)))
    return f"{total // 60}:{total % 60:02d}"


def _first_equation(html: str) -> str | None:
    if not html:
        return None
    m = re.search(r"\$\$(.*?)\$\$", html, re.DOTALL)
    return m.group(0) if m else None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


async def extract_course_concepts(course_id: str) -> dict | None:
    """Cluster topics across lectures into a single concept inventory.

    The result is persisted under `courses.concept_graph.concepts` and
    `…prerequisites`, leaving any prior `exam_guide` payload alone.
    """
    videos = await get_course_videos(course_id)
    completed = [v for v in videos if v.get("status") == "complete"]
    if not completed:
        logger.warning("extract_course_concepts: no completed lectures for %s", course_id)
        return None

    # 1. Collect one record per (lecture, topic) pairing.
    records: list[dict] = []
    for v in completed:
        notes = v.get("notes_json") or {}
        sections = notes.get("sections") or []
        topics = notes.get("topics") or []
        lecture_num = v.get("lecture_number")
        for topic in topics:
            if not isinstance(topic, str) or not topic.strip():
                continue
            t = topic.strip()
            # Best-matching section by case-insensitive substring of the topic.
            best = None
            for sec in sections:
                title = sec.get("title") or ""
                if t.lower() in title.lower():
                    if best is None or len(title) > len(best.get("title") or ""):
                        best = sec
            ts_seconds = (
                best.get("timestamp_seconds") if best
                else (sections[0].get("timestamp_seconds") if sections else 0)
            )
            html = best.get("content_html") if best else ""
            records.append({
                "lecture_number": lecture_num,
                "topic": t,
                "timestamp": _format_timestamp(ts_seconds),
                "section_title": (best.get("title") if best else "") or "",
                "equation": _first_equation(html or ""),
            })

    if not records:
        # Nothing to cluster — write an empty graph so the frontend gets a 200.
        graph: dict[str, Any] = {"concepts": [], "prerequisites": []}
        course = await get_course(course_id)
        existing = (course or {}).get("concept_graph") or {}
        existing.update(graph)
        await save_course_intelligence(course_id, concept_graph=existing)
        return graph

    # 2. Embed every unique topic string (one OpenAI call per).
    unique_topics = sorted({r["topic"] for r in records})
    embedded: dict[str, list[float]] = {}
    for t in unique_topics:
        try:
            embedded[t] = await asyncio.to_thread(generate_embedding, t)
        except Exception as exc:  # noqa: BLE001
            logger.warning("embedding failed for topic %r: %s", t, exc)

    # 3. Greedy cosine-similarity clustering at 0.85.
    clusters: list[dict] = []
    for t in unique_topics:
        e = embedded.get(t)
        if e is None:
            clusters.append({"embedding": [0.0], "members": [t]})
            continue
        placed = False
        for c in clusters:
            if _cosine(c["embedding"], e) > _CLUSTER_SIM_THRESHOLD:
                c["members"].append(t)
                placed = True
                break
        if not placed:
            clusters.append({"embedding": e, "members": [t]})

    # 4. Build concept records.
    member_to_cluster: dict[str, int] = {}
    for ci, c in enumerate(clusters):
        for m in c["members"]:
            member_to_cluster[m] = ci

    concepts: list[dict] = []
    for ci, c in enumerate(clusters):
        # Canonical name = the shortest distinct member (often the clean form).
        canonical = sorted(c["members"], key=lambda s: (len(s), s.lower()))[0]
        appearances: list[dict] = []
        for r in records:
            if r["topic"] in c["members"]:
                appearances.append({
                    "lecture": r["lecture_number"],
                    "timestamp": r["timestamp"],
                    "section_title": r["section_title"],
                    "equation": r["equation"],
                    "context": "application",  # tagged below
                })
        if not appearances:
            continue
        # Sort chronologically, mark first appearance as definition.
        appearances.sort(key=lambda a: (a["lecture"], a["timestamp"]))
        first = appearances[0]
        appearances[0]["context"] = "definition"

        concepts.append({
            "id": f"c{ci}",
            "name": canonical,
            "first_appearance": {
                "lecture": first["lecture"],
                "timestamp": first["timestamp"],
            },
            "appearances": appearances,
            "leads_to": [],
            "depends_on": [],
            "total_appearances": len(appearances),
        })

    # 5. Prerequisite graph via co-occurrence + first-appearance order.
    lecture_to_concepts: dict[int, set[str]] = {}
    for c in concepts:
        for app in c["appearances"]:
            lecture_to_concepts.setdefault(app["lecture"], set()).add(c["id"])
    by_id = {c["id"]: c for c in concepts}

    for c in concepts:
        c_first = c["first_appearance"]["lecture"]
        seen_dep: set[str] = set()
        seen_lead: set[str] = set()
        for app in c["appearances"]:
            for other_id in lecture_to_concepts.get(app["lecture"], set()):
                if other_id == c["id"]:
                    continue
                other = by_id[other_id]
                other_first = other["first_appearance"]["lecture"]
                if other_first < c_first and other["name"] not in seen_dep:
                    c["depends_on"].append(other["name"])
                    seen_dep.add(other["name"])
                elif other_first > c_first and other["name"] not in seen_lead:
                    c["leads_to"].append(other["name"])
                    seen_lead.add(other["name"])

    prereqs: list[dict] = []
    for c in concepts:
        c_lectures = {a["lecture"] for a in c["appearances"]}
        for dep_name in c["depends_on"]:
            dep = next((cc for cc in concepts if cc["name"] == dep_name), None)
            if dep is None:
                continue
            dep_lectures = {a["lecture"] for a in dep["appearances"]}
            shared = sorted(c_lectures & dep_lectures)
            prereqs.append({
                "from": dep["id"],
                "from_name": dep["name"],
                "to": c["id"],
                "to_name": c["name"],
                "lectures": shared,
            })

    # 6. Persist (merging into concept_graph so exam_guide survives).
    course = await get_course(course_id)
    existing = (course or {}).get("concept_graph") or {}
    existing["concepts"] = concepts
    existing["prerequisites"] = prereqs
    await save_course_intelligence(course_id, concept_graph=existing)

    return {"concepts": concepts, "prerequisites": prereqs}


async def generate_lecture_diff(course_id: str, lecture_number: int) -> dict | None:
    """For one lecture, classify each concept as new / review / applied."""
    course = await get_course(course_id)
    if course is None:
        return None
    graph = course.get("concept_graph") or {}
    concepts = graph.get("concepts") or []
    if not concepts:
        # Lazily build the graph if it's missing.
        built = await extract_course_concepts(course_id) or {}
        concepts = built.get("concepts") or []

    new_concepts: list[dict] = []
    review_concepts: list[dict] = []
    applied_concepts: list[dict] = []

    for c in concepts:
        here = [a for a in c["appearances"] if a["lecture"] == lecture_number]
        if not here:
            continue
        first_lec = c["first_appearance"]["lecture"]
        a = here[0]
        if first_lec == lecture_number:
            new_concepts.append({
                "name": c["name"],
                "section": a.get("section_title", ""),
                "equation": a.get("equation"),
            })
            continue
        # Distinguish review vs applied: if the section title in this lecture
        # differs from the first-appearance section title, it's an application
        # in a new context; otherwise a review.
        first_app = c["appearances"][0]
        first_section = (first_app.get("section_title") or "").lower()
        here_section = (a.get("section_title") or "").lower()
        if first_section and here_section and first_section == here_section:
            review_concepts.append({
                "name": c["name"],
                "first_seen": f"Lecture {first_lec}",
                "section": a.get("section_title", ""),
            })
        else:
            applied_concepts.append({
                "name": c["name"],
                "first_seen": f"Lecture {first_lec}",
                "new_context": a.get("section_title", ""),
            })

    if applied_concepts:
        top = applied_concepts[0]
        key_connection = f"This lecture applies {top['name']} from {top['first_seen']}."
    elif new_concepts:
        names = ", ".join(n["name"] for n in new_concepts[:3])
        key_connection = f"Introduces {names}."
    else:
        key_connection = ""

    return {
        "lecture_number": lecture_number,
        "new_concepts": new_concepts,
        "review_concepts": review_concepts,
        "applied_concepts": applied_concepts,
        "key_connection": key_connection,
    }
