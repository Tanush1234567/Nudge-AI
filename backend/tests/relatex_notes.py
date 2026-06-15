"""One-off: convert a stored note's plain-text math into LaTeX delimiters.

WHY: Notes generated before the LaTeX-aware synthesis prompt have equations as
plain ASCII text ("d/dt (dL/dx_dot) - dL/dx = 0"), which renders as ugly
monospace. This rewrites each section's content_html so every mathematical
expression is wrapped in $...$ / $$...$$ LaTeX — a single cheap Gemini call
per section, NOT a video reprocess — then writes notes_json back to the job.

Usage:
    python -m tests.relatex_notes <job_id>
"""

import re
import sys

import google.generativeai as genai

from config import GEMINI_API_KEY, GEMINI_MODEL
from db.client import get_supabase

_PROMPT = """You are given the HTML body of one study-notes section.

Rewrite it so that EVERY mathematical expression, equation, symbol, or variable
is valid LaTeX wrapped in delimiters:
  - inline math:        $...$    e.g. $\\dot{{x}}$, $KE = \\tfrac12 m v^2$
  - standalone equation: $$...$$ on its own line

Convert ASCII math into proper LaTeX:
  "d/dt (dL/dx_dot) - dL/dx = 0"  ->  $$\\frac{{d}}{{dt}}\\frac{{\\partial L}}{{\\partial \\dot{{x}}}} - \\frac{{\\partial L}}{{\\partial x}} = 0$$
  "x_dot"  ->  $\\dot{{x}}$        "mv^2"  ->  $m v^2$        "mgy"  ->  $m g y$

Rules:
- Do NOT wrap math in <code> or <pre>. If a <code>/<pre> tag contains only
  math, remove the tag and use $...$ instead.
- Keep ALL non-math text and every other HTML tag exactly as-is.
- Return ONLY the rewritten HTML — no commentary, no markdown fences.

SECTION HTML:
{html}
"""


def _strip_fences(text: str) -> str:
    """Remove a leading/trailing markdown code fence if the model added one."""
    cleaned = text.strip()
    fence = re.match(r"^```(?:html)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    return fence.group(1).strip() if fence else cleaned


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python -m tests.relatex_notes <job_id>")
        return 1
    job_id = sys.argv[1]

    sb = get_supabase()
    res = sb.table("jobs").select("notes_json").eq("id", job_id).limit(1).execute()
    if not res.data:
        print(f"No job found: {job_id}")
        return 1

    notes = res.data[0].get("notes_json") or {}
    sections = notes.get("sections") or []
    if not sections:
        print("Job has no note sections to convert.")
        return 1

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    converted = 0
    for sec in sections:
        html = (sec.get("content_html") or "").strip()
        if not html:
            continue
        try:
            resp = model.generate_content(_PROMPT.format(html=html))
            new_html = _strip_fences(resp.text)
            if new_html:
                sec["content_html"] = new_html
                converted += 1
                print(f"  converted section {sec.get('number')}")
        except Exception as exc:  # noqa: BLE001
            print(f"  section {sec.get('number')} failed: {exc}")

    if converted == 0:
        print("Nothing converted — leaving the note unchanged.")
        return 1

    sb.table("jobs").update({"notes_json": notes}).eq("id", job_id).execute()
    print(f"Updated job {job_id}: {converted} section(s) re-LaTeX'd.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
