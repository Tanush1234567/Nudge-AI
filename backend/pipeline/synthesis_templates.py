"""Adaptive synthesis templates for Pupil.

The synthesis prompt is composed of three parts:
1. UNIVERSAL STRUCTURE — applies to every video.
2. FORMAT INSTRUCTIONS — how to structure notes based on delivery format.
3. DOMAIN INSTRUCTIONS — how to handle content based on subject area.

These are composed at runtime: UNIVERSAL + FORMAT[detected] + DOMAIN[detected].
"""

UNIVERSAL_PROMPT = """You are creating study notes that someone can LEARN FROM by
reading instead of watching the video. A reader of these notes should understand
the material as well as if they watched the entire video.

CONTENT CLASSIFICATION:
- Format: {format} ({format_description})
- Domain: {domain}
- Speaker style: {speaker_style}
- Contains equations: {has_equations}
- Contains code: {has_code}

{format_instructions}

{domain_instructions}

SECTION WRITING RULES:

Each section must contain all five elements below, written as FLOWING PROSE.
Do NOT include the labels or headings 'Context', 'Core Content', 'Concrete
Grounding', 'Visual Reference', or 'Connection' in your output. These are
structural guidelines for you, not headings for the reader. The reader should
see natural, flowing notes — not a filled-out template.

Here is what each section must accomplish, woven together naturally:

- Open by establishing what is being discussed and why it matters at this
  point. If it builds on a previous section, make the link explicit.

- Deliver the actual knowledge — the equations, arguments, steps, code,
  or concepts. Be thorough. A reader with only these notes should get
  the full picture.

- Ground the abstract in something concrete. This means AT MINIMUM one of:
  (a) A worked numerical example with actual numbers the reader can verify
  (b) A specific named case study, experiment, or real-world instance
  (c) A short calculation showing the concept applied to a simple case

  CRITICAL: 'Visualize it as...' or 'This is analogous to...' do NOT count
  as concrete grounding. You need actual numbers, actual names, or an actual
  computation. If the lecturer worked through an example, reproduce their
  steps in full. If they didn't, create a minimal example: for differential
  forms use f(x,y) = xy; for group theory use D₃ or S₃; for ML use small
  arrays with 3-5 elements; for any topic, pick the simplest specific instance.

- When a captured frame is relevant, explain what it SHOWS and what the
  reader should NOTICE — not 'a slide shows the theorem' but 'notice how
  the coloured regions partition the group into equal-sized cosets, visually
  confirming that |stab(x)| divides |G|.'

- End by connecting to the next section in one sentence.

EXAMPLE of good section writing (notice: no labels, flows naturally):

  The total differential extends the single-variable derivative to
  multiple variables. In one dimension, a small change Δx produces
  Δu ≈ u'(x)Δx — the derivative scales the input change. For a
  function of two variables z = f(x,y), both x and y can change
  independently, so the total change is approximated by contributions
  from each:

  $$\\Delta f \\approx \\frac{{\\partial f}}{{\\partial x}}\\Delta x + \\frac{{\\partial f}}{{\\partial y}}\\Delta y$$

  For example, if f(x,y) = x²y, then ∂f/∂x = 2xy and ∂f/∂y = x².
  At the point (1,2), a small change Δx = 0.1, Δy = 0.05 gives
  Δf ≈ 2(1)(2)(0.1) + (1)²(0.05) = 0.45. The actual change is
  f(1.1, 2.05) - f(1,2) = 1.21 × 2.05 - 2 = 0.4805, so the
  approximation is close. The captured frame shows this as a small
  rectangle on a 3D surface — the partial derivatives determine how
  the surface tilts in each direction, and the total differential
  combines both tilts.

  This linear approximation is the foundation of differential forms,
  which we formalise next.

RULES:
- Start with a TL;DW paragraph (2-4 sentences) synthesising the ENTIRE video
  before the first ## heading. This paragraph appears ONCE at the very top.

  CRITICAL: Do NOT create any section titled 'TL;DW', 'Notes', 'Summary',
  'Introduction', or 'Overview'. The first ## section must be the first
  actual topic of the video. The TL;DW paragraph before ## 1 is the only
  summary. Never repeat it.

- Each ## section title must be UNIQUE and specific to the content of that section.
- NEVER repeat content from a previous section. Reference it instead.
- If two input sections cover the same material, MERGE them into one comprehensive treatment.
- Output EXACTLY {section_count} sections with ## headings, no more, no fewer.
  The first ## heading must be a real topic — not a meta-section like
  'Notes' or 'TL;DW'. If the video has 10 content topics, output exactly
  10 ## sections, each covering one topic. Do not add wrapper sections.

- WORKED EXAMPLES: When the lecturer works through a specific example with
  calculations (a proof step-by-step, a numerical computation, a code
  walkthrough), give it FULL treatment. Reproduce every step. Show the
  computation. Explain what the result means. Worked examples should be the
  LONGEST part of any section that contains them — they are where
  understanding happens. Never compress a worked example into one sentence.

- Identify 3-8 KEY CONCEPTS that deserve callout boxes:
  > **CONCEPT: [Term]**
  > [Definition or key point]
  > [Intuitive explanation or practical implication]
  Place these where the term is first properly introduced.
"""

# ═══════════════════════════════════════════════════════
# FORMAT INSTRUCTIONS (how the content is delivered)
# ═══════════════════════════════════════════════════════

FORMAT_INSTRUCTIONS = {

    "lecture": """FORMAT: ACADEMIC LECTURE
The speaker is teaching progressively — each concept builds on the last.
Your notes must preserve this progression.

- Start each section with MOTIVATION: what problem does this concept solve?
  Why is it needed? What was insufficient about the previous approach?
- Before any equation or formal statement, provide INTUITION in plain language.
  Use any analogies or visual metaphors the lecturer used.
- For proofs: explain the REASONING for each step, not just the formal statements.
  "We need closure because..." not just "Closure: if σ,τ ∈ H then στ ∈ H."
- Preserve the lecturer's specific examples — they chose those examples for a reason.
- If the lecturer asked the class a question, include it as a thought prompt.
""",

    "tutorial": """FORMAT: STEP-BY-STEP TUTORIAL
The speaker is guiding through a hands-on process. Notes must be actionable.

- Structure around WHAT TO DO, not what the speaker said about doing it.
- For each step: the action, the tool/command used, what the expected result is,
  and common mistakes to watch for.
- Track PROGRESS: at the start of each section, briefly note what's been built so
  far and what's being added now.
- Code blocks must be complete enough to run — no fragments. Include file paths
  when the speaker mentions them.
- After code blocks: what happens when you run this, what the output looks like.
- Note any dependencies, installations, or configuration mentioned.
- If the speaker says "you can also do X instead" — include that as an alternative.
""",

    "conference_talk": """FORMAT: CONFERENCE TALK / KEYNOTE
The speaker is presenting an argument, framework, or insight.
Notes must capture the argument structure, not just the topic.

- Identify the speaker's CENTRAL THESIS — the one sentence that summarises
  their entire talk. Put it prominently at the top.
- Structure around the speaker's ARGUMENT, not chronology. What's the claim?
  What evidence do they offer? What's the implication?
- Preserve SPECIFIC examples, case studies, data points, and company names
  the speaker cited — these are the substance, not the rhetoric.
- If the speaker presents a FRAMEWORK or MODEL (most do — a 2x2 matrix,
  a 3-step process, a mental model), capture its structure explicitly.
- Capture the speaker's most MEMORABLE phrases or formulations (paraphrased).
  Conference talks are remembered by their soundbites.
- End with ACTIONABLE TAKEAWAYS: what should the viewer DO differently?
- Attribute ideas to the speaker by name throughout.
""",

    "explainer": """FORMAT: VISUAL EXPLAINER
The content relies heavily on visual intuition and animation to build understanding.
Notes must preserve the visual reasoning, not just the conclusions.

- The VISUAL INTUITION is the content — not a supplement to it. When the video
  uses an animation to show why something works, describe what the animation
  reveals and why it's illuminating.
- Build understanding progressively: start with the simplest version of the
  concept and layer complexity, matching the video's approach.
- Captured frames are especially important here — they capture the visual
  explanations that ARE the content. Describe them in detail.
- Balance intuition with precision: the explainer's gift is making hard things
  feel simple, but note where simplifications were made.
- If the video builds a visual metaphor (e.g., "think of it as a rubber sheet"),
  preserve that metaphor and use it consistently.
""",

    "workshop": """FORMAT: WORKSHOP / LIVE CODING SESSION
The content is interactive and hands-on, possibly with audience participation.

- Structure around EXERCISES or TASKS, not topics.
- For each exercise: the goal, the approach, the solution, what to learn from it.
- If the presenter shows multiple approaches, compare them explicitly.
- Capture any live debugging or problem-solving — these "oops" moments often
  contain the most valuable learning.
- Note audience questions if audible — they often represent common confusion points.
- Track the state of whatever is being built at each stage.
""",

    "discussion": """FORMAT: DISCUSSION / INTERVIEW / PANEL
Multiple speakers are exchanging ideas. Notes must preserve individual voices.

- ATTRIBUTE every position to the speaker who holds it. Never merge speakers
  into a generic "they discussed..."
- Structure around TOPICS or QUESTIONS, not chronologically.
- For each topic: what was asked, what each speaker said, where they agreed,
  where they disagreed.
- Preserve the most striking quotes or exchanges (paraphrased if long).
- Note when a speaker references specific research, companies, or data.
- Capture the dynamic: who pushed back on whom, what surprised the host,
  what generated the strongest response.
- If there's a moderator, their questions often frame the most important issues.
""",

    "demo": """FORMAT: PRODUCT DEMO / WALKTHROUGH
The speaker is showcasing a product, tool, or system.

- Structure around PROBLEMS SOLVED, not features shown.
- For each feature: what problem it addresses, how it works (from the demo),
  and how it compares to alternatives (if mentioned).
- Note specific UI elements, commands, or workflows shown.
- Capture pricing, availability, limitations, and requirements if mentioned.
- Reference captured frames showing key UI states or results.
- Distinguish between what's available now vs. "coming soon" if applicable.
""",

    "documentary": """FORMAT: DOCUMENTARY / INVESTIGATIVE
The content builds a thesis through evidence, expert interviews, and narrative.

- Identify the CENTRAL QUESTION or thesis being explored.
- Track the EVIDENCE CHAIN: what facts, examples, and expert opinions support
  or complicate the thesis.
- Attribute expert perspectives by name and credential.
- Preserve specific dates, numbers, locations, and primary sources cited.
- Note counter-arguments or complications the documentary acknowledges.
- Capture the narrative arc: how does the story build, what's the turning point,
  what's the conclusion?
- End with: what the documentary concludes and what questions remain open.
""",

    "general": """FORMAT: GENERAL VIDEO
Apply the universal structure. Focus on:
- Capturing the main ideas and supporting details clearly.
- Preserving specific examples, data, and references.
- Identifying any frameworks, processes, or models presented.
- Explaining domain-specific terminology.
""",
}

# ═══════════════════════════════════════════════════════
# DOMAIN INSTRUCTIONS (what the content is about)
# ═══════════════════════════════════════════════════════

DOMAIN_INSTRUCTIONS = {

    "math_science": """DOMAIN: MATHEMATICS / SCIENCE
- Every equation: (a) what problem it solves, (b) plain-language meaning of each
  symbol, (c) a worked numerical example if the lecturer provided one — if they
  didn't, create a brief one using small, verifiable numbers.
- For proofs: the reasoning for each step, not just the statement.
- Preserve visual/geometric intuitions — these are often more valuable than formalism.
- Use $$...$$ for display equations, $...$ for inline math.
- If the lecturer used a specific notation convention, note it at the first occurrence.
""",

    "engineering_cs": """DOMAIN: ENGINEERING / COMPUTER SCIENCE
- Code blocks: properly formatted with language tags, complete enough to understand
  (include context like imports and function signatures).
- After code: what it does (1 sentence), expected output, common mistakes.
- Architecture/system descriptions: capture the components, their relationships,
  and the data flow between them.
- Distinguish between concepts (how something works) and implementation (how to build it).
- Note specific libraries, frameworks, tools, and versions mentioned.
- If algorithms are discussed: inputs, outputs, time/space complexity, when to use them.
""",

    "business": """DOMAIN: BUSINESS / STRATEGY
- Frameworks and models: capture their structure explicitly (the 2x2 matrix,
  the 3-step process, the spectrum).
- Specific examples: company names, metrics, outcomes, timelines — the concrete
  data that supports the argument.
- Distinguish between the speaker's opinion and data-backed claims.
- Capture actionable advice: what should someone DO with this information?
- Note any recommended books, tools, resources, or further reading.
""",

    "humanities": """DOMAIN: HUMANITIES / SOCIAL SCIENCES
- Arguments: clearly state the thesis, supporting evidence, and counter-arguments.
- Primary sources: specific texts, quotes, historical events, dates, and figures.
- Distinguish between established scholarly consensus and the speaker's interpretation.
- Preserve nuance — humanities content often deals with tensions and ambiguities
  that shouldn't be flattened into simple bullet points.
- Note theoretical frameworks or schools of thought referenced.
""",

    "creative": """DOMAIN: CREATIVE / DESIGN / ARTS
- Techniques and processes: the specific method, tool, or approach used at each stage.
- Visual references: what the result looks like at each step (reference captured frames).
- Principles and taste: capture the WHY behind creative decisions, not just the HOW.
- Note specific tools, materials, software, or resources mentioned.
- If the speaker critiques or compares work: preserve their specific observations.
""",

    "medical": """DOMAIN: MEDICAL / HEALTH
- Be precise with medical terminology while also providing plain-language explanations.
- Note specific studies, trial names, or clinical guidelines referenced.
- Distinguish between established medical consensus and emerging research.
- Capture dosages, procedures, or protocols mentioned with their context.
- Note any caveats, contraindications, or limitations the speaker mentioned.
""",

    "legal": """DOMAIN: LEGAL / REGULATORY
- Cite specific statutes, cases, regulations, or standards mentioned.
- Distinguish between the law as written, its interpretation, and practical application.
- Note jurisdictional context — which country/state/system is being discussed.
- Capture any tests, standards, or criteria mentioned (e.g., the "reasonable person" test).
- Preserve the speaker's analysis of how rules apply to specific situations.
""",

    "general": """DOMAIN: GENERAL
- Focus on clarity and completeness.
- Explain any specialised terminology when first used.
- Preserve specific examples and data points.
""",
}

# Format descriptions for the prompt
FORMAT_DESCRIPTIONS = {
    "lecture": "academic/educational lecture with progressive knowledge building",
    "tutorial": "step-by-step hands-on instruction, building something practical",
    "conference_talk": "speaker presenting an argument or framework to an audience",
    "explainer": "visual/animated explanation designed to build intuitive understanding",
    "workshop": "interactive hands-on session with exercises",
    "discussion": "conversation between multiple speakers (interview, podcast, panel)",
    "demo": "product or tool walkthrough and demonstration",
    "documentary": "narrated investigation building a thesis through evidence",
    "general": "general video content",
}


def build_synthesis_prompt(
    classification: dict,
    section_count: int,
) -> str:
    """Compose the complete synthesis system prompt from a classification.

    Falls back to the "general" block whenever a key is missing or invalid so
    every caller gets a usable prompt regardless of classifier output quality.
    """
    fmt = classification.get("format") or "general"
    if fmt not in FORMAT_INSTRUCTIONS:
        fmt = "general"
    domain = classification.get("domain") or "general"
    if domain not in DOMAIN_INSTRUCTIONS:
        domain = "general"

    return UNIVERSAL_PROMPT.format(
        format=fmt,
        format_description=FORMAT_DESCRIPTIONS.get(fmt, "general video content"),
        domain=domain,
        speaker_style=classification.get("speaker_style", "professional"),
        has_equations=bool(classification.get("has_equations", False)),
        has_code=bool(classification.get("has_code", False)),
        format_instructions=FORMAT_INSTRUCTIONS[fmt],
        domain_instructions=DOMAIN_INSTRUCTIONS[domain],
        section_count=section_count,
    )
