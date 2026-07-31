---
description: Run an autonomous backlog loop under a WATCHDOG — the agent arranges its own EXTERNAL wake-ups every N minutes (default 10) so a hung chat, a flaky network or a stuck API call can never silently kill the run; a heartbeat file proves real progress, a bounded duration (default 1 hour when none is given) ends the run cleanly, and a restart policy with a cooldown and an escalation cap replaces infinite crash-loops. Use when the human says "run a guarded loop", "work autonomously until 22:00 with alarms every 20 minutes", "work the backlog for 3 hours", "работай в защищённом цикле", "работай автономно с будильниками". Item execution itself follows /autoloop verbatim. Trigger aliases (ru): «защищённый цикл», «работай в защищённом цикле», «цикл с будильниками», «работай автономно с будильниками»
---

# /guarded-loop — an autonomous loop that survives a hang

The ordinary loops (`/autoloop`, `/dayloop`, `/nightloop`) trust the harness to keep the agent
alive. In the field that trust sometimes breaks: the network lags, an API call errors out, the
chat hangs — and the agent never wakes up on its own. The guarded loop adds three guarantees on
top of the SAME loop discipline: an **external watchdog** that pokes the agent every N minutes, a
**heartbeat** that proves real progress, and a **restart policy** that neither gives up nor loops
forever. Everything about picking and executing backlog items is `/autoloop`'s canon, unchanged.

## Step 0 — parse the ask, state the contract

Two parameters, spoken back in ONE line before starting:

- **Duration** — explicit ("until 22:00", "for 3 hours") or the default: **1 hour** for a bare
  "run a guarded loop".
- **Alarm interval** — explicit ("alarms every 20 minutes") or the default: **10 minutes**.

Example: *"Guarded loop: until 22:00, wake-ups every 10 min (default). Starting."*

## Step 1 — arm the WATCHDOG (external, never self)

The process that runs the work must not be the only judge of its own health — a hung agent cannot
run its own self-check. Two layers:

1. **The harness's native scheduler first** (scheduled wake-ups / cron prompts / self-alarms of
   your agent system) — armed for the alarm interval. This is the STANDARD path.
2. **The guard layer — a LOCAL OS mechanism** the agent builds once per project (Windows Task
   Scheduler / cron / a background script — add it to the project's harness and document it):
   every N minutes it checks the heartbeat file's freshness and, on a stale pulse, re-pokes or
   restarts the agent by whatever means the project's harness allows (re-invoke CLI, notification
   to the owner as last resort). KAIF prescribes the CONTRACT below; the script itself is the
   project's tool, not the framework's.

Watchdog contract (each line exists because its absence burned a real run):
- **single-instance guard** — a lock/pid file, so two watchdogs never double-restart;
- **debounce** — act only after M consecutive stale checks (a long build legitimately silences
  the pulse; pick M from the project's MEASURED longest step, never from thin air);
- **disarm at the end of the run** (Step 5) — a watchdog left armed past its run is a footgun.

## Step 2 — the HEARTBEAT: pulse = finished work, never a timer

Append one line to **`.kaif/heartbeat.log`** at the END of every completed iteration/step:

```
<ISO timestamp> | <backlog item> | <status: done/progress/blocked> | next: <next action>
```

The pulse is written ONLY when a step actually completes. A heartbeat fed by a timer ("still
alive" on schedule) defeats the entire mechanism — the watchdog would happily watch a hung agent
tick — and is a fraud `/fable-judge` hunts. The last line doubles as a micro-recovery-context.
The file is runtime state, not history: it lives in `.gitignore` (the machinery's ignore-first
list covers it since 2.1) — never commit the pulse.

## Step 3 — the loop itself

Run backlog items exactly per `/autoloop`: same item selection, same fable-loop execution, the
mandatory judge pass per item, drive-by notes to the backlog, a HEAVY unplanned item →
`/plan-epic` first. Context/limits are the harness's concern, never a stop condition.

## Step 4 — waking up: restart policy

Woken by the watchdog and the pulse is stale:

1. Say so aloud: *"woken by watchdog — pulse stale since <T>"* (honesty first; the log line is
   forensics for the next session).
2. Recover by the standard entry: **`/resume`** — `STATUS.md` plus the last heartbeat line ARE
   the recovery context; continue the interrupted item or take the next one.
3. **Cooldown** between watchdog-triggered restarts (don't thrash a flaky network).
4. **Escalation cap:** after ~3 consecutive restarts with NO forward progress (no new heartbeat
   entries between them) — STOP: record the state in `STATUS.md` (and a `bugs/` doc if the cause
   looks like a defect), disarm the watchdog, and leave a clear note for the owner. An endless
   crash-loop burns the budget and masks the real problem.

## Step 5 — end of the run

At the duration boundary (or when the pool is empty): finish the current item cleanly, write the
final heartbeat line (`run complete`), **disarm the external watchdog**, and close per the
session's situation — a parking note (the `/pause` way) if the chat continues, or the full
`/end-chat` ceremony if the session ends. Report: items done, restarts survived, anything
escalated.

## What this skill refuses to do

- Rely on the agent's own liveness alone — the runner is never the sole judge of its health.
- Feed the heartbeat from a timer — the pulse proves WORK (the judge hunts this).
- "Always restart" — without a cooldown and the escalation cap a bad state becomes a crash-storm.
- Leave the watchdog armed after the run, or run two watchdogs without a single-instance guard.
- Invent thresholds — the debounce and timeouts come from the project's measured durations.
