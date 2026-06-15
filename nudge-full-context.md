# Nudge — Full Context Document for New Chat
*Generated at end of long working session. Use this as the complete briefing.*

---

## 1. Who We Are

**Rishi Saraf** — SPIT Mumbai, first-year engineering. Product, architecture, backend. Built the video analyser (Pupil). Designed the full technical architecture of Nudge desktop app.

**Tanush Gupta** — TU Delft, first-year Aerospace Engineering. The person talking to Claude in this project. Responsible for the Chrome extension, reliability, and the capture-to-inference pipeline.

Applying to: IIMB incubation, SP-TBI, YC.

---

## 2. What Nudge Is

An ambient AI assistant that watches what you do on your computer and speaks up with useful, proactive insights — without being asked. Every existing AI tool waits for you to ask. Nudge doesn't wait. It watches and taps you on the shoulder when something matters.

**Target user:** Students (initial market). Eventually: developers, analysts, doctors — anyone doing knowledge work.

**Pricing:**
- €10/month (student) / €25/month (professional)  — desktop app (very flexible right now)
- €2 for 5 videos/day — Pupil (video analyser)
- Free tier: 2 full analyses OR 5 transcript-only analyses

---

## 3. The Product Architecture (North Star)

```
CAPTURE LAYER
├── Pupil / Video Analyser     ← BUILT, live at pupil.nudge.live
│   ├── YouTube URLs           ← Done
│   └── File uploads           ← 3-4 days of work remaining
├── Chrome Extension           ← Tanush building now (see Section 5)
│   ├── Passive browsing capture (pages you spend time on)
│   └── Explicit capture (right-click → "Save to Nudge")
├── Meeting capture            ← Post-funding
└── Email capture              ← Post-funding

INTELLIGENCE LAYER
├── Vision Pipeline            ← BUILT (DINOv2 + Vision LLM) — in Pupil
├── Entity Extraction          ← NOT BUILT
├── Knowledge Graph            ← NOT BUILT
└── Context Engine             ← NOT BUILT (pgvector/hybrid search)

INTERACTION LAYER
├── ASK Mode                   ← NOT BUILT ("What do I know about X?")
├── BRIEF Mode                 ← NOT BUILT (proactive pre-meeting intel)
├── DRAFT Mode                 ← NOT BUILT (generate outputs from knowledge)
└── Context Export (zip)       ← 2-3 days of work

AGENT LAYER (post-funding)
├── Post-Meeting Agent
├── Commitment Enforcer
├── Proactive Research Agent
└── Financial Context Agent
```

**Four launch screens:** Library (home), ASK (chat), Individual capture view, Collections.

---

## 4. Pupil — Video Analyser (BUILT)

**What it does:** Paste a YouTube URL → downloads video → extracts frames (DINOv2) → gets transcript → sends to Gemini → generates structured timestamped notes with extracted frames, equations, topic tags, TL;DW.

**Stack:** Python + FastAPI (port 7860), Next.js (port 3000), Gemini (gemini-2.5-flash-lite), Supabase (job tracking).

**Live at:** pupil.nudge.live

**Launch pricing:**
- 2 free full analyses (no card)
- €2 / 5 videos per day
- Submit actionable feedback → free subscription for life (genuine offer)

**Sample output:** Group Theory lecture → 13 timestamped sections, extracted octagon/permutation diagrams, homomorphism mappings, Cayley's theorem frames, topic tags, TL;DW. PDF of this output exists and was used for LinkedIn launch post.

---

## 5. Chrome Extension — Current State (Tanush's main build)

### What's been built (version 0.3.0)
A passive ambient capture extension with a local memory system. This is the **Nudge Chrome extension** not a dumb screenshot tool — it's the actual product for browser-based knowledge capture.

### Architecture

**extractor.js (content script)**
- Runs on every https:// page
- Strips nav/ads/footers, extracts main readable text (up to 8000 chars)
- Detects page kind: email / meeting / video / browse
- Sends PAGE_CONTEXT message: on load, every 3 minutes, on text selection
- Listens for FORCE_COLLECT from background

**background.js (service worker)**
Pipeline: `capture → IndexedDB raw buffer → 90s inactivity → Gemini compress → chrome.storage summaries → nudge generation uses summaries as context`

Key sections:
1. IndexedDB (`nudge_raw` database, `captures` store) — temporary raw buffer
2. Session tracker (in-memory Map: tabId+URL → lastCaptureTime)
3. Inactivity check alarm (every 60s) — fires compression when session idle ≥ 90s
4. Compression: deduplicate raw captures → 1 Gemini call → summary stored
5. Nudge generation: current context (2500 chars) + last 8 summaries → Gemini
6. chrome.storage.local: stores summaries (max 100), popup stats, last nudge

**Summary format stored:**
```json
{
  "url": "...",
  "title": "...",
  "kind": "browse|email|meeting|video",
  "summary": "one sentence what user read",
  "topics": ["topic1", "topic2"],
  "keyPoints": ["point1", "point2"],
  "timestamp": 1234567890,
  "durationMs": 180000
}
```

**Cost model:** ~1 Gemini call per page visit (compression) + 1 nudge check per 40s of browsing. ~9 Gemini calls per 30-minute study session.

**Nudge generation:** confidence ≥ 0.45 + tier S or A required to show. Force nudge bypasses throttle and zone filter.

**Zones:** email/meeting/video = on by default. browse = off by default.

**Known issues resolved in v0.3.0:**
- Hash check bug (was silently skipping all interval sends after first) — FIXED
- Force nudge used executeScript in page context where chrome.runtime doesn't exist — FIXED (now sends FORCE_COLLECT to content script instead)
- Model now read from chrome.storage at call time (not hardcoded)

**Manifest permissions:** storage, sidePanel, activeTab, scripting, alarms, tabs

### Files
- `manifest.json` — v0.3.0, MV3
- `background.js` — service worker, all logic
- `content/extractor.js` — DOM extraction + messaging
- `popup/popup.html` + `popup/popup.js` — UI (do not change without reason)
- `sidepanel/sidepanel.html` — expanded view
- `icons/icon128.png`

### Dev workflow
Two batch scripts exist:
- `build.bat` — bumps patch version, robocopy source → build folder
- `watch.bat` — watches for file changes every 2s, auto-calls build.bat

**Setup:** Load `nudge-ext-build/` (not source) as unpacked extension in Chrome. After build.bat runs, click ↻ on chrome://extensions to reload.

**Debugging:**
- extractor.js logs → page DevTools console (F12 on the test page)
- background.js logs → chrome://extensions → Nudge → "Service Worker" inspect

**Model in use:** gemini-2.0-flash-lite (stored in chrome.storage, changeable via popup settings)

---

## 6. Desktop App (Rishi's side — for reference)

Rust + Tauri + Node.js + Python. Screenpipe reads screen every 2s via OCR. 5-gate system filters ~95% of events before any API call. 3-tier memory: Mem0 (hot, 30 days), Graphiti (knowledge graph, permanent), cold storage (user-confirmed). Morning briefing, commitments tracker, people intelligence, vision boost (Claude Haiku screenshot descriptions).

**Known bugs in desktop app (not yet fixed):**
- Rate limiter feedback loop broken (record_outcome() not called on dismiss/act)
- Bypass gate muted (error detection not running)
- Port mismatch: research_client hardcoded port 9090 but service starts on 8200
- Calendar wired but not connected (None passed in main.rs)

---

## 7. Strategy (as of end of this session)

### What we decided NOT to do
- Build a "dumb screenshot pipe" Chrome extension just for investor demos
- Add meetings + browser capture simultaneously in 6 weeks
- Delay user validation until after a polished build

### What we're doing instead
1. **Launch Pupil this week** at pupil.nudge.live with the pricing above
2. **Get 20-30 real students** (TU Delft batch) on the Chrome extension immediately — WhatsApp, no polished launch needed
3. **Let user feedback drive** what gets built next, not a preset roadmap
4. **Chrome extension IS the product** — not a demo prop. The ambient memory system is the real thing.

### Key strategic tension (noted)
The product architecture's most valuable screen (ASK mode) depends on the intelligence layer (entity extraction + knowledge graph + context engine) which is entirely unbuilt. Early users can capture and view a library — but the compounding value doesn't exist yet. This is the core retention risk for the first cohort.

---

## 8. Business Numbers

- TAM: ₹11,940 Cr/yr at 5% conversion of 500M global student laptop users
- SAM: ~100M English-speaking academic students
- SOM Year 1: 1,000 paying users = ₹23.9L ARR
- Break-even: 42 paying users
- API cost: ₹45–165/user/month
- Gross margin at scale: 72–83%
- EdTech CAGR: ~13% to 2030
- AI productivity market: $7B → $108B by 2030

---

## 9. Files to Upload to Project

Upload these to the Claude Project's Files section so context persists:

| File | Why |
|---|---|
| `nudge-trd-v0.3.md` | Full technical requirements doc — desktop app architecture, gate system, memory tiers, prompt engineering |
| `nudge-ext/background.js` | Current working background.js (v0.3.0) |
| `nudge-ext/content/extractor.js` | Current working extractor |
| `nudge-ext/manifest.json` | Extension manifest |
| `nudge-ext/popup/popup.js` | Popup logic |
| `build.bat` + `watch.bat` | Dev workflow scripts |
| This document (`nudge-full-context.md`) | This briefing |

**Do NOT need to re-upload:**
- The Group Theory PDF (that was just a sample Pupil output shown for the LinkedIn post)
- Old zip files (superseded by v0.3.0)

---

## 10. What to Tell Claude at the Start of a New Chat

Paste this:

> "I'm Tanush, co-founder of Nudge. Read the project files — they contain the full business context, the Chrome extension code (v0.3.0), the TRD, and a session summary. We're building an ambient AI knowledge system. My current focus is the Chrome extension. The other co-founder Rishi handles the video analyser (Pupil). Continue from where we left off."

---

*Last updated: June 2026 — end of working session with Claude (claude.ai project)*
