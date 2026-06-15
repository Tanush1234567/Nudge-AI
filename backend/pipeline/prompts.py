"""LLM prompt templates, kept in one file so they can be iterated and
A/B tested without touching pipeline code.

WHY: Prompt quality is the product. Centralizing every template here means a
prompt change is a one-file diff, and prompt versions can be compared against
user ratings (see VISION_PROMPT_VERSION / SYNTHESIS_PROMPT_VERSION in config).

Both constants are .format() templates: single braces are substitution slots,
doubled braces ({{ }}) are literal JSON braces passed through to the model.
"""

# ---------------------------------------------------------------------------
# Stage 4 — Vision: analyze a batch of frames, each with its transcript context.
# Format slots: {count}
# ---------------------------------------------------------------------------
ALIGNED_VISION_PROMPT = """You are analyzing {count} frame(s) captured from an educational video.

For EACH frame you are given two things:
  1. TRANSCRIPT CONTEXT — the words spoken in a window of roughly 20 seconds
     before and 15 seconds after the frame was captured.
  2. THE IMAGE — exactly what was on screen at that moment.

WHAT MATTERS — and what does NOT:
The instructional CONTENT is what matters: the board, slide, diagram, code, or
equations. The PRESENTER does not. Do NOT describe the speaker's pose, gestures,
hands, clothing, or where they are standing — that is noise and must never
appear in your output. If the speaker is blocking part of the content, read
around them and describe only the content.

Your real job is to TRANSCRIBE and INTERPRET the content:
  - Capture every equation, symbol, label, axis name, annotation, and piece of
    text — including HAND-DRAWN math and notation. Hand-written math still
    counts as an equation: render it in LaTeX (e.g. "m_2 \\gg m_1").
  - Describe what a diagram MEANS structurally — what it represents, how its
    parts relate — not what it physically looks like.

Return ONLY a JSON array with exactly one object per frame, in the same order
the frames are given. Do not wrap it in markdown fences. Each object must have
this exact shape:

[
  {{
    "content_type": "slide | code | equation | diagram | chalkboard | demo | talking_head | other",
    "visual_description": "What the content MEANS — the concept the diagram/board conveys and how its parts relate. Describe information, not the presenter.",
    "extracted_text": "ALL content visible in the frame, transcribed verbatim. Code: character-perfect including indentation and operators. Equations and hand-drawn math: full LaTeX. Diagram labels, axis names, annotations: every one. Empty string only if there is genuinely no text or notation.",
    "alignment_note": "How the spoken transcript relates to this content — what the speaker is explaining, deriving, or asserting about it.",
    "is_important": true,
    "importance_reason": "Why this frame matters for study notes (a key concept, equation, derivation, definition, result) — or why it does not.",
    "topic": "A short topic label for this frame (2-5 words)."
  }}
]

CRITICAL RULES:
- Code must be transcribed CHARACTER-PERFECT. Never paraphrase, fix, or reformat.
- Equations — typeset OR hand-drawn — must be written in complete, valid LaTeX.
  Capture inequalities, subscripts, and relations exactly (m_1, m_2, \\gg, etc.).
- Tables must be transcribed as structured markdown tables. Do not group multiple column values into a single cell, and do not merge multiple rows. Ensure each value is placed under its correct column header.
- Extract ALL notation and text — titles, labels, axis names, annotations,
  margins, every symbol. Miss nothing.
- NEVER describe the presenter. No "a person pointing", "the speaker gestures",
  "standing in front of". Describe only the content.
- Mark is_important=false ONLY for frames with genuinely no instructional
  content (pure transition / blank). A board with math on it is always important.
- If this frame shows a visual similar to a previous frame (e.g., same 3D
  surface, same diagram type), describe what CHANGED or what is DIFFERENT.
  'A 3D surface with a curve' is never an acceptable description — specify
  the function, the curve, the viewing angle, or the annotation that makes
  this frame distinct.
- Frame descriptions must be SPECIFIC. If this frame shows content similar
  to a previous frame, describe what CHANGED. 'A slide showing the theorem'
  is never acceptable — describe WHICH theorem and what annotations or
  emphasis are visible. For diagrams: describe the structure (what's
  connected to what, what's inside what, what the labels say), not just
  'a diagram illustrating the concept.'
- Output valid JSON only. No commentary before or after the array.
"""


# ---------------------------------------------------------------------------
# Stage 6 — Synthesis: turn analyzed/stitched sections into final study notes.
# Format slots: {title} {channel} {duration} {num_sections} {sections_data}
# ---------------------------------------------------------------------------
SYNTHESIS_PROMPT = """You are a brilliant teaching assistant writing the definitive study notes
for a video. The hard work of watching the video is already done — below are
{num_sections} pre-analyzed sections, each containing transcribed board/slide
content, extracted equations and code, and transcript context.

VIDEO METADATA:
  Title:    {title}
  Channel:  {channel}
  Duration: {duration} seconds

PRE-ANALYZED SECTIONS:
{sections_data}

Transform this into study notes a student could use INSTEAD of watching the
video. The notes must TEACH THE CONTENT — not narrate the video.

WHAT GOOD NOTES DO HERE:
- Lead with the substance: the math, equations, definitions, and reasoning.
  When the extracted content or transcript contains notation (e.g. m_1, m_2,
  an inequality, a margin, a derivation), put that math front and centre,
  explain what each symbol means, and work through the reasoning step by step.
- Use the instructor's OWN notation and examples — if they wrote m_2 \\gg m_1,
  explain *that*, don't substitute generic textbook variables.
- Explain WHY, not just WHAT: motivate each idea, connect it to the previous
  one, and state the intuition behind every formula.
- Keep visual/diagram context only where it genuinely aids understanding —
  describe what a diagram shows structurally, briefly. Never narrate the
  presenter or the act of pointing.
- Do NOT pad with generic textbook material that is not grounded in this
  video's content. If the video covers a topic shallowly, keep it shallow.

Return ONLY a JSON object (no markdown fences) with this exact shape:

{{
  "summary": "A tight 2-4 sentence overview of what the video teaches.",
  "topics": ["short", "topic", "labels", "covered"],
  "sections": [
    {{
      "number": 1,
      "title": "A clear, descriptive section title.",
      "timestamp_seconds": 0,
      "content_html": "The section body as clean semantic HTML — use <p>, <ul>, <li>, <strong>, <em>, <code>, <pre>, <table>, <thead>, <tbody>, <tr>, <th>, <td>. Explain the concepts and math thoroughly in your own words. Write EVERY mathematical expression as LaTeX: wrap inline math in single dollar signs (e.g. $\\dot{{x}}$, $v^2$, $L = T - V$) and standalone equations in double dollar signs on their own line. NEVER write math as plain ASCII (no 'd/dt', no 'x_dot', no 'L = KE - PE' as text) and never put math inside <code>/<pre>. Reproduce CODE exactly as extracted inside <pre><code>; math is not code. Render data grids, structured lists of stock/numeric statistics, and comparison panels using properly structured HTML tables with matching columns; ensure each value is in its own cell (<td>) and align them with the headers (<th>). Do not group multiple values into one cell with delimiters.",
      "key_takeaway": "The single most important thing to remember from this section.",
      "visuals": [
        {{
          "type": "captured_frame | ai_diagram | code_block | equation",
          "...": "type-specific fields — see rules below"
        }}
      ]
    }}
  ]
}}

VISUAL TYPES:
- equation:       a formula from the video. Fields: latex, caption, explanation.
                  Emit one for EVERY meaningful equation, inequality, or piece
                  of notation in the extracted content.
- code_block:     code extracted from the video. Fields: language, code, caption.
- ai_diagram:     a flowchart / graph / hierarchy you generate. Fields:
                  mermaid (REQUIRED — a complete, valid Mermaid diagram
                  string), description. ONLY emit this when the concept is
                  genuinely a process, hierarchy, or relationship graph that
                  Mermaid can draw. For geometric or spatial illustrations
                  (regions, points, curves, plots) do NOT emit a diagram —
                  explain it in the prose instead. Never emit an ai_diagram
                  without a valid mermaid string.
- captured_frame: an actual frame from the video. Fields: timestamp_seconds,
                  caption. Use sparingly — only when the image itself is
                  instructive. Frame metadata is injected automatically.

CRITICAL RULES:
- NEVER modify code or equations. Reproduce them character-for-character from
  the extracted text. You may explain them, never rewrite them.
- Surface the math: if a section's content contains equations or notation,
  the notes for that section MUST explain them — not skip to a vague summary.
- Write like a brilliant TA: clear, motivated, rigorous. Explain WHY.
- Reference timestamps so the reader can jump back to the source moment.
- Order sections by timestamp_seconds ascending.
- Output valid JSON only. No commentary before or after the object.
"""
