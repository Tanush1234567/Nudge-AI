# Make the app feel fast and smooth

## Objective

Keep the existing visual design unchanged, but make the app *feel* fast and
stable: eliminate UI jank, fix the loading screens, and stop the dashboard from
flashing "no videos found" (empty/error state) on first load before data
arrives. Then profile and remove real render lag across the app.

## Original Request

> improve the ux of the app, some stuff in the ui is very laggy like the
> loading screen. the first time the dashboard loads, it shows no videos found
> or something like that. the ui as a whole is very jaggy and slow. I like the
> ui design, just make the experience much much better

## Intake Summary

- Input shape: `vague` (improvement-oriented, with concrete symptoms)
- Audience: end users of the Pupil video knowledge workspace
- Authority: `requested`
- Proof type: `demo` + `metric` (both: fix flashes AND profile/optimize)
- Completion proof: First dashboard load never flashes an empty/error state;
  loading shows proper skeletons; key flows are smooth (no visible layout
  shift, smooth scroll/animation, responsive interactions), demonstrated in a
  before/after walkthrough plus DevTools/Lighthouse measurements within budget.
- Goal oracle: A recorded/described before-after walkthrough of first dashboard
  load + main flows (library, folders, course view, notes editor) showing no
  empty-state flash and smooth interaction, backed by measured perf numbers
  (no significant CLS, interaction latency, frame smoothness).
- Likely misfire: (a) Redesigning the visuals — forbidden, the user likes the
  design. (b) Swapping in skeletons that merely *hide* latency without fixing
  the real cause of jank. (c) Chasing micro-optimizations that don't move
  perceived performance.
- Blind spots considered: "laggy/jaggy" splits into perceived slowness (no
  skeletons, layout shift, blocking fetches, the empty-state flash) vs. actual
  render cost (heavy re-renders, large editor/lists, unoptimized animation).
  The board must attack both. The empty-state flash is a loading-state
  correctness bug and is fixed first because it is the most visible.
- Existing plan facts: Recent commits already added transient-failure guards
  (don't flash empty library / folders / course view on transient fetch
  failures), online-state SSR hydration fix, exponential backoff + offline
  banner, and a backend slim-columns fix (list_jobs was timing out on
  notes_json). These are prior art to preserve and build on, not redo.

## Goal Oracle

The oracle for this goal is:

`A before/after walkthrough of first dashboard load + main flows showing zero
empty-state flash and smooth interaction, backed by measured perf numbers
(CLS, interaction latency, frame smoothness) within an agreed budget — with the
existing visual design unchanged.`

The PM must keep comparing task receipts to this oracle. Skeletons that hide
latency, or optimizations that don't change perceived smoothness, do not satisfy
it. The goal finishes only when a final Judge/PM audit maps receipts back to
this oracle and records `full_outcome_complete: true`.

## Goal Kind

`open_ended`

## Current Tranche

Continuous execution. Discover where loading-state flashes and real render lag
come from, fix the loading-state correctness bugs first (especially the
first-load empty-state flash), then profile and eliminate the highest-leverage
render/animation jank, advancing through successive safe verified slices until
first load and the main flows are smooth and stable. Visual design stays the
same throughout.

## Scope

- Frontend-first. Loading states, skeletons, layout shift, render
  optimization, animation smoothness, data-fetch sequencing.
- Backend only if profiling proves a specific endpoint is the real bottleneck
  behind a user-visible stall — then a bounded backend fix is in scope
  (e.g. slim queries, caching, pagination), matching the prior list_jobs fix.

## Non-Negotiable Constraints

- Do NOT change the visual design. The user explicitly likes it. No restyling,
  recoloring, relayout, or component-library swaps beyond what's needed to fix
  jank/loading behavior.
- Preserve existing transient-failure / offline / hydration guards already in
  the codebase; build on them, don't revert them.
- Frontend in TypeScript, backend in Python with type hints. Tailwind only.
- Every Worker slice must be verifiable (build passes, lint/typecheck clean,
  and a described manual check of the affected flow).

## Stop Rule

Stop only when a final audit proves first dashboard load + main flows are smooth
with no empty-state flash, backed by the oracle. Do not stop after profiling or
Judge selection — activate the Worker and fix things. Do not stop after one
verified slice if higher-leverage jank remains.

## Slice Sizing

A good task is the largest safe useful slice — e.g. "fix first-load empty-state
flash across the dashboard data path" or "eliminate layout shift + add skeletons
to the library/folders/course views", not one tiny component tweak at a time.
Prefer fixing a whole user-visible flow per Worker package.

## Canonical Board

Machine truth lives at:

`docs/goals/improve-app-ux/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins.

## Run Command

```text
/goal Follow docs/goals/improve-app-ux/goal.md.
```

## PM Loop

On every `/goal` continuation: read this charter, read `state.yaml`, re-check
the intake, work only the active task, assign Scout/Judge/Worker/PM per the
task, write a compact receipt, update the board, advance to the next largest
safe slice unless a phase/risk/final review is due, and finish only with a
Judge/PM audit receipt that maps back to the oracle and records
`full_outcome_complete: true`.
