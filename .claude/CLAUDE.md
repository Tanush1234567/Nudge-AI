# Pupil — Video Knowledge Workspace

## What This Is
Pupil is "Readwise for Video." Users save YouTube videos, Pupil extracts 
visual content (equations, code, diagrams) from frames using DINOv2 + vision 
LLM, and produces structured editable notes in a BlockNote workspace.

## Tech Stack
- Frontend: Next.js 14 (App Router, TypeScript, Tailwind) — port 3000
- Backend: Python FastAPI — port 7860
- Editor: BlockNote (@blocknote/react + @blocknote/mantine) — ALREADY INTEGRATED
- Database: Supabase (PostgreSQL + Auth + Storage + pgvector)
- Vision: OpenAI gpt-4.1-nano/mini (model_router.py handles routing)
- Synthesis: OpenAI gpt-4.1-nano (plain markdown output)
- Payments: Stripe
- Email: Resend

## Active Orchestrator
The ENHANCED orchestrator (enhanced_orchestrator.py) is the active code path.
NOT orchestrator.py. The enhanced version uses quality metrics, region detection,
compositing, visual primitives, and tiered model routing.

## Key Files
- backend/pipeline/enhanced_orchestrator.py — main pipeline (1324 lines)
- backend/pipeline/model_router.py — model selection + synthesis (524 lines)
- backend/pipeline/quality_metrics.py — 5 pre-vision metrics + routing (503 lines)
- backend/pipeline/stitch.py — section grouping + content dedup (397 lines)
- backend/pipeline/prompts.py — vision extraction prompt (150 lines)
- frontend/components/notes/notes-editor.tsx — BlockNote + KaTeX (393 lines)
- frontend/app/dashboard/page.tsx — main app (1406 lines)

## Design System
- Primary: #6C5CE7 (purple)
- Background: #FFFFFF / #0F0F13 (dark)
- Font: DM Sans (body), JetBrains Mono (code)
- Border radius: 12px cards, 8px inputs
- Max content width: 720px for editor

## Rules
- Never ask for confirmation. Just do it.
- Never explain what you're about to do. Just do it.
- Create complete files. No placeholders or TODOs.
- Use TypeScript for frontend, Python with type hints for backend.
- Use Tailwind for all styling. No CSS files.
- Commit after each major feature.