# Nudge — Project Context (Handoff)

> Handoff context for an AI agent picking up this project. Reflects the state
> as of 2026-05-19, after an extended debugging/improvement session.

## 1. What Nudge is

An AI video-analysis tool. A user pastes a YouTube URL; the system:
1. Downloads the video at 360p (yt-dlp).
2. Fetches the transcript (youtube-transcript-api, translated to English if needed).
3. Extracts semantically distinct key frames (OpenCV + DINOv2 embeddings).
4. Sends each frame + surrounding transcript to a vision LLM for multimodal analysis.
5. Stitches per-frame analyses into topic-coherent sections.
6. Synthesizes final structured study notes (HTML + inline LaTeX + visuals).

Tagline: "Every other tool reads the subtitles. We actually watch the video."

## 2. Architecture (as actually built)

```
Frontend:  Next.js 14 (App Router)   -> http://localhost:3000
Backend:   Python FastAPI + uvicorn  -> http://localhost:7860
Database:  Supabase (Postgres)       -> table `jobs`, `free_tier_usage`
Storage:   Supabase Storage          -> extracted frame images
AI:        Gemini (primary) + OpenAI (fallback)
Queue:     in-process asyncio.Queue, 1 video at a time
```

NOTE: `.claude/CLAUDE.md` describes an "all-Google / Firebase" stack — that
document is OUTDATED. The real implementation uses **Supabase**, not Firebase.
Trust the code, not CLAUDE.md.

## 3. Repository layout

```
c:\nudge-video\
├── backend\
│   ├── .venv\                  # the real Python env (Python 3.10) — USE THIS
│   ├── main.py                 # FastAPI app; uvicorn.run(..., port=7860, reload=True)
│   ├── config.py               # all env vars + tunable constants
│   ├── .env                    # secrets (gitignored-ish; contains live keys)
│   ├── requirements.txt        # NOTE: torch/torchvision/transformers are NOT here
│   ├── Dockerfile              # installs CPU torch+torchvision, transformers
│   ├── api\
│   │   ├── videos.py           # POST /api/analyze, GET /api/status, GET /api/notes
│   │   ├── router.py, middleware.py
│   ├── pipeline\
│   │   ├── orchestrator.py     # runs the 6 stages for one job
│   │   ├── download.py         # stage 1: yt-dlp 360p
│   │   ├── transcript.py       # stage 2: youtube-transcript-api
│   │   ├── frames.py           # stage 3: DINOv2 semantic frame extraction
│   │   ├── vision.py           # stage 4: Gemini multimodal; _parse_json_response
│   │   ├── stitch.py           # stage 5: content-dedup + section grouping
│   │   ├── synthesize.py       # stage 6: final notes JSON
│   │   ├── prompts.py          # ALIGNED_VISION_PROMPT, SYNTHESIS_PROMPT
│   │   ├── llm_fallback.py     # OpenAI/OpenRouter fallback provider
│   │   └── exceptions.py
│   ├── db\
│   │   ├── client.py, jobs.py  # Supabase CRUD for the `jobs` table
│   ├── storage\frames.py       # uploads frame images to Supabase Storage
│   ├── job_queue\worker.py     # asyncio queue worker
│   └── tests\
│       ├── benchmark.py        # times + estimates cost per video
│       └── relatex_notes.py    # one-off: convert a stored note's math to LaTeX
└── frontend\
    ├── app\
    │   ├── processing\page.tsx # progress UI (polls /api/status)
    │   └── notes\[jobId]\page.tsx
    ├── components\notes\
    │   ├── notes-section.tsx   # renders a section + dispatches visuals
    │   ├── rich-content.tsx    # renders inline $...$ LaTeX via KaTeX
    │   ├── equation-block.tsx, mermaid-diagram.tsx
    └── lib\api.ts, lib\types.ts
```

## 4. The pipeline in detail

`orchestrator.process_video(job_id, url)` runs 6 stages, updating the job row
in Supabase at each step (frontend polls `/api/status`).

1. **Download** (`download.py`) — yt-dlp, `best[height<=360]`, into a temp dir.
2. **Transcript** (`transcript.py`) — best English transcript, or any language
   translated to English; returns `[]` on failure (never raises).
3. **Frames** (`frames.py`) — see section 5 below.
4. **Vision** (`vision.py`) — frames batched 5 at a time; each frame paired with
   its transcript window (±20s before / ±15s after) and sent to Gemini.
   Returns one `AlignedAnalysis` per frame. On Gemini failure → OpenAI fallback.
5. **Stitch** (`stitch.py`) — content-dedup, then group analyses into sections by
   topic + time; fills transcript-only gaps; picks ONE content-bearing image
   per section.
6. **Synthesize** (`synthesize.py`) — sections → final notes JSON via Gemini
   (OpenAI fallback). Then captured-frame metadata is injected; frames uploaded
   to Supabase Storage.

The temp dir (and the downloaded video) is always deleted.

## 5. Frame extraction (`frames.py`) — the most-iterated module

- Samples the video every ~3s. For each candidate, a tiered comparison decides
  capture: pHash fast-filter → DINOv2 (`facebook/dinov2-small`, 384-dim
  embeddings, lazy-loaded, CPU) semantic similarity.
- **Adaptive spacing:** capture spacing is stretched to `duration / MAX_FRAMES`
  so a long video's frames span the WHOLE video (fix for "all frames from the
  first 5 minutes" bug).
- **Coarse pre-collapse:** `_collapse_to_distinct_states` (threshold 0.94) only
  drops near-identical frames.
- DINOv2 falls back to pixel-diff if torch/transformers fail to load.
- `CapturedFrame` has 6 original fields + `capture_reason`.

KEY INSIGHT / known limitation: DINOv2 embeds the WHOLE frame. It cannot
distinguish a slide change when a presenter/room dominates the frame, and it is
fooled by a presenter moving in front of a static board. Therefore the REAL
dedup is done AFTER vision on extracted text content (see section 6).

## 6. Content-based dedup (`stitch.py`)

`_deduplicate_by_content` collapses frames whose *extracted on-screen text*
(what the vision model READ) overlaps by > `CONTENT_DEDUP_THRESHOLD` (0.80,
Jaccard word overlap). This is immune to presenter pose / camera framing
because it compares meaning, not pixels.

Section images: `_build_section` picks ONE representative frame, considering
ONLY content-bearing `content_type`s (`slide, chalkboard, diagram, code,
equation, demo`). `talking_head` / `other` frames are never shown — a section
with no content frame shows no image.

## 7. AI providers & the fallback chain

- **Primary:** Gemini `gemini-2.5-flash-lite`. Used first for every vision
  batch and for synthesis.
- **Fallback:** `llm_fallback.py`. Provider precedence: if `OPENAI_API_KEY`
  set → OpenAI direct (`gpt-4.1-nano`); else OpenRouter. Triggered per-call
  when Gemini fails (429/error) — vision batches and synthesis both fail over.
- **CRITICAL:** Gemini's free tier is only **20 requests/day per project**.
  One video uses ~10-15 requests, so a free Gemini key lasts ~1 video/day.
  In practice **OpenAI is the real workhorse**. `gpt-4.1-nano` ≈ $0.02-0.05
  worst-case per video (cost bounded by `MAX_FRAMES=60` → ≤12 vision batches).

## 8. JSON parsing robustness (`vision.py:_parse_json_response`)

LLMs return malformed JSON constantly (LaTeX backslashes are invalid JSON
escapes, literal newlines, truncation). The parser does:
1. strict `json.loads`
2. retry with LaTeX backslashes sanitized (`\frac` → `\\frac`)
3. last resort: `json-repair` library (handles truncation, newlines, etc.)

This is why both vision and synthesis now succeed where they used to fall back
to a useless "raw transcript" skeleton.

## 9. LaTeX rendering

- Synthesis prompt instructs the model to write math inline as `$...$` /
  `$$...$$` LaTeX inside `content_html`.
- Frontend `rich-content.tsx` renders those delimiters with KaTeX (already a
  dependency).
- `tests/relatex_notes.py` is a one-off converter for OLD notes that stored
  plain-text math: `python -m tests.relatex_notes <job_id>`.

## 10. Environment & how to run

Backend (from `c:\nudge-video\backend`):
```
.\.venv\Scripts\python.exe main.py        # serves on :7860, reload=True
```
Frontend (from `c:\nudge-video\frontend`):
```
npm run dev                               # serves on :3000
```

Python deps live in `backend\.venv`. Beyond `requirements.txt`, these were
installed manually (CPU-only) and are also in the Dockerfile:
`torch`, `torchvision`, `transformers`, `imagehash`, `json-repair`.

`.env` keys (in `backend\.env`):
```
SUPABASE_URL, SUPABASE_SERVICE_KEY
GEMINI_API_KEY            # free tier = 20 req/day; swap when exhausted
GEMINI_MODEL=gemini-2.5-flash-lite
OPENAI_API_KEY            # fallback; takes precedence over OpenRouter
OPENAI_MODEL=gpt-4.1-nano
OPENROUTER_API_KEY, OPENROUTER_MODEL   # secondary fallback (unused if OpenAI set)
ALLOWED_ORIGINS=http://localhost:3000
```

## 11. API endpoints

- `POST /api/analyze` — body `{"url": "..."}`. Optional `?force=true` query
  param OR `"force": true` in body — skips the duplicate-cache and forces a
  fresh run (essential for re-testing the same video).
- `GET /api/status/{job_id}` — progress + stage.
- `GET /api/notes/{job_id}` — completed notes (202 if still processing).

Force-reprocess from PowerShell (note: PowerShell `curl` mangles JSON bodies —
use `Invoke-RestMethod`):
```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:7860/api/analyze?force=true" `
  -ContentType "application/json" -Body '{"url":"https://www.youtube.com/watch?v=..."}'
```

## 12. Key config constants (`config.py`)

```
MAX_VIDEO_DURATION = 7200      # 2 hours
MAX_FRAMES = 60                # caps captured frames AND worst-case fallback cost
FRAME_BATCH_SIZE = 5           # frames per vision call
GEMINI_RATE_LIMIT_DELAY = 4.5  # seconds between vision batches
SEMANTIC_MODEL = facebook/dinov2-small
SEMANTIC_SIMILARITY_THRESHOLD = 0.90        # capture-time skip threshold
SEMANTIC_DISTINCT_STATE_THRESHOLD = 0.94    # coarse pre-vision collapse
CONTENT_DEDUP_THRESHOLD = 0.80              # post-vision content dedup (main knob)
```

## 13. Known issues / limitations

- **Gemini free tier = 20 req/day.** Keys die fast; OpenAI is effectively primary.
- `google.generativeai` Python package is END-OF-LIFE (logs a warning). Should
  migrate to the `google.genai` package eventually.
- `gpt-4.1-nano` is a small model: occasionally weaker JSON, and it rarely
  produces good Mermaid diagrams.
- **Diagrams:** `ai_diagram` visuals require a Mermaid string; Mermaid can only
  draw flowcharts/graphs, NOT geometric/spatial illustrations. Such diagrams
  are intentionally skipped (explained in prose instead).
- Frame quality depends on the vision model classifying `content_type`
  correctly (slide vs talking_head). A presenter standing in front of a board
  is a judgment call.
- The DINOv2 whole-frame embedding cannot crop out an occluding presenter —
  hence the post-vision content-dedup is the real safeguard.
- `MEMORY.md` / `.claude/CLAUDE.md` may be stale.

## 14. State at handoff

The pipeline runs end-to-end and produces real synthesized notes with inline
LaTeX, whole-video frame coverage, and content-only section images. The most
recent change (just before this handoff) added the `content_type` filter so
section images are never bare lecturer shots — awaiting a confirming test run.

Recurring failure mode to watch for: synthesis falling back to a "raw
transcript" skeleton. Causes seen and fixed: Gemini quota (429), OpenRouter no
credit (402), and JSON parse failures. If it recurs, check the backend log for
`Synthesis failed; returning fallback notes` and the raw-JSON head/tail log
line in `_parse_json_response`.

## 15. Gotchas for the next agent

- Backend port is **7860**, not 8080. Frontend expects `localhost:7860`.
- Use `backend\.venv\Scripts\python.exe` — the global Python lacks the deps.
- The backend runs with `reload=True`, but `.env` changes need a full restart.
- Re-testing a video requires `?force=true` (otherwise the cached job returns).
- PowerShell `curl` is `Invoke-WebRequest` — use `Invoke-RestMethod` for JSON.
