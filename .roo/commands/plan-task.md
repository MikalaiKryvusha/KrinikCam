---
description: Plan an ORDINARY task, bug or idea into one operational plan — goal vector, acceptance criteria, steps with checkboxes, verification-by-observation, risks — sized so the ceremony never outweighs the work. Runs the heaviness test first and hands a HEAVY task over to /plan-epic (the full research → meta-plan → phased ladder). Use when the human says "plan this task", "make a plan for this bug/idea", "how would you approach this", or when the agent picks up an unplanned backlog item; for epic-scale work use /plan-epic instead. Trigger aliases (ru): «спланируй задачу», «составь план по задаче», «план по багу», «план по идее»
---

# /plan-task — one operational plan for an ordinary task

An unplanned task gets executed by improvisation, and improvisation does not survive a
context-losing session. An ORDINARY task deserves exactly ONE artifact: a short operational plan
a fresh session can execute and judge the work by. No ladder, no phases — that is `/plan-epic`'s
territory, and dragging an epic's ceremony onto a small task is as wrong as skipping planning on
a big one.

## Step 0 — the heaviness test (canon: AGENT_GUIDE.md → Planning discipline)

The task is HEAVY when **≥2** of these hold:

- touches ≥3 subsystems or canon documents;
- rests on an external truth or an industry standard;
- does not fit one session;
- changes shipped composition or public contracts;
- needs owner-level decisions.

HEAVY → stop here, switch to **`/plan-epic`** (say so in one chat line). Otherwise continue.

## Step 1 — gather (minutes, not hours)

- The source document (`ideas/NN`, `bugs/NN`, or the owner's ask verbatim).
- The relevant map slice (`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` — blast radius).
- `EXPERIENCE.md` grep by the task's tags — cite relevant lessons or say "none".
- If the task rests on an external truth — the recon doc first (checklist step 9); planning from
  recall is inventing.

## Step 2 — write the plan

Structure (keep it to one screen where possible):

```
## Plan: <one-line goal>
**Goal vector:** <what pain we solve and where we want to be — name Achieve / Maintain / Avoid where it clarifies>
**Acceptance criteria (done when):** <observable criteria — what will be SEEN working, not "code written"; a numeric criterion carries its fit criterion: Scale · Meter · Target — or one four-line scenario per criterion (REQUIREMENTS_FRAMEWORK.md → The scenario form):>
- Situation. <the state of the world with concrete values — not an action>
- Action. <exactly one action of the user, the system or the agent>
- Result. <what is SEEN from outside: a number, an output line, a file — never "works correctly">
- Check. <a repository command or query + its expected output; Scale · Meter · Target live here>
**Steps:**
- [ ] <step — small enough to verify on its own>
- [ ] ...
**Verification:** <BY WHICH TEST ARTIFACTS each claim is observed AND WHERE THEY LIVE — the suite/
case/fixture/guard and its path in the repo; artifacts are produced BY THIS PLAN, in the same steps,
never "later" (TESTING_FRAMEWORK.md → "The work produces its own means of checking")>
**Risks:** <top 1-3, each with the reaction if it fires — Murphy ranking from PHILOSOPHY.md>
```

The goal vector + acceptance criteria block OPENS the plan and is written by
`REQUIREMENTS_FRAMEWORK.md` (verifiable wording, no stop-words, fit criteria). The vector and
criteria are not final truths — they may be modified, added, or removed as the work teaches;
changing them is an edit, not a failure.

Placement: a small task's plan lives as a **section inside its idea/bug document**; a larger one
gets its own `plans/NN_<name>.md`. Either way the plan is committed before the work starts.

**Planning a PHASE of an epic?** Then this plan is that epic's child, and it declares its parent
twice over: in its **filename** — `NN_epicMM_<phase>_<name>.md`, `MM` being the parent epic's
number (`plans/README.md` → Naming) — and in its **steps**, each quoting the meta-plan's anchor
line it executes. The name links the family; the quote proves the step is in scope. A step you
cannot anchor in the parent is scope drift, caught before the diff.

## Step 3 — clearance, then go

- The plan crosses owner territory (brand, UX, architecture, canon content)? Surface the fork
  first — one pointed question in chat for task-level ambiguity, `/interview` for vision-level.
- Otherwise start executing immediately (fable loop, checklist step 7) — the plan is standing
  authorization for its own reversible steps.

## What this skill refuses to do

- Plan an epic as a flat step list (the heaviness test exists so scope drift is caught at
  planning, not mid-execution).
- Produce a plan without acceptance criteria or verification — "steps done" is not "task done"
  (`TESTING_FRAMEWORK.md`: raw output is untrusted).
- Skip the plan because "the task is clear" — clear to THIS session; the plan is for the next one.
