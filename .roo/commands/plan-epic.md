---
description: Plan a HEAVY task or epic by the full ladder — industry web-recon + local recon synthesized into a research doc, then ONE meta-plan with phases and gates, then an operational plan for the NEXT phase only (phase N+1 is planned when phase N closes). Use when the human says "plan this epic", "take this big feature into work", "нарезай эпик", or when /plan-task's heaviness test hands the task over; the deliverable is the ladder's artifacts, not started code. Trigger aliases (ru): «спланируй эпик», «нарезай эпик», «полная лестница планирования», «бери эпик в работу»
---

# /plan-epic — the full planning ladder for heavy work

Nearly everything in this industry has golden standards, best practices, published research — or at
least documented practitioner lore. An epic planned from memory re-invents solved problems badly,
and an epic planned all-upfront executes fiction by phase three. The ladder fixes both: research
gives the epic its evidence base, the meta-plan shows the owner the whole shape once, and
phase-by-phase operational plans keep a context-losing session on the RIGHT next step.

Canon: `AGENT_GUIDE.md` → "Planning discipline — the task ladder".

## Step 0 — confirm heaviness

Run the heaviness test (≥2 of: ≥3 subsystems/canon docs · external truth or industry standard ·
more than one session · changes shipped composition/contracts · owner decisions). NOT heavy →
switch to `/plan-task`; dragging the ladder onto an ordinary task is ceremony outweighing work.

## Rung 1 — research (the epic's first artifact; no code, no meta-plan before it)

Synthesize THREE sources into one research doc in `researches/NN_<epic>.md`:

1. **Industry sweep (web):** golden standards, best practices, papers, mature open-source
   solutions for this problem class. Every claim carries its source URL; no invented citations.
   Record anti-patterns too — knowing what the industry abandoned is half the value.
2. **Local recon:** how the project's current code/docs/data actually stand where the epic will
   land (read, don't recall); prior art in `researches/` and lessons in `EXPERIENCE.md`.
3. **Requirements:** the owner's ask verbatim, `GOAL.md`/`MASTER_PLAN.md` fit, constraints.

Close the doc with: findings → implications for THIS epic → open forks for the owner. Where the
source material is large, extraction may be delegated — but only with verbatim-quote schemas and a
mechanical quote check (a finding is not a finding until verified).

## Rung 2 — the meta-plan (one document in `plans/`)

- Phases with a stated ORDER and the reasoning behind it; dependencies between phases.
- Gates: what must be true to enter/close each phase (builds green, guards proven able to fail,
  judge passes — per `TESTING_FRAMEWORK.md`).
- Acceptance criteria for the whole epic — observable, countable where possible.
- Vision-level forks → `/interview` (work on unblocked phases proceeds meanwhile);
  task-level ambiguity → one pointed question in chat.
- Commit the meta-plan before executing anything.

## Rung 3 — operational plan for the NEXT phase only

Detail ONLY the upcoming phase (R&D · testing · mock-ups · development · debugging · acceptance —
whichever apply): steps with checkboxes, per-step verification, risks. Later phases stay as
skeletons in the meta-plan. **The operational plan for phase N+1 is written when phase N closes** —
with everything phase N taught folded in.

## Rung 4 — trace and execute

- Every operational step cites its meta-plan anchor line (the citing rule, checklist step 8);
  a step you cannot anchor is scope drift caught before the diff.
- Execute each phase by the fable loop; a `/fable-judge` pass closes a phase before the next
  one's operational plan is written.
- Tick the meta-plan as phases close; on epic close, fill "Decisions made without the owner".

## What this skill refuses to do

- Start coding "while the research settles" — the research IS the epic's first artifact.
- Write all operational plans upfront — phase N+1 is planned with phase N's lessons, not before.
- Treat the web sweep as optional — "I know this domain" is a session's recall, and recall invents.
- Swallow owner forks into defaults — vision-level forks go to `/interview`, visibly.
