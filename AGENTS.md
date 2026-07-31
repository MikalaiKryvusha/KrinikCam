# KrinikCam — context for AI agents (universal fallback)

This project is wrapped by the **KAIF 2.1 — Strong KAIF** framework (see `KAIF_FRAMEWORK.md`). The
canon is NOT duplicated here — read the sources:

1. **`AGENT_GUIDE.md`** — THE canon: rules, names, commands, conventions (+context router: which doc
   slice to read per task type). Read before every task.
2. **`STATUS.md`** — the living state: what's done, where we are, what's next.
3. **`PHILOSOPHY.md`** — the core principle: SIMPLICITY (KISS + Occam). Stuck = you misunderstood the
   task → simplify.
4. **`BUG_FIXING_FRAMEWORK.md`** — how to fix defects (fix→build→test loop, the 3-attempts rule,
   intent gate + twin check).
5. **`TESTING_FRAMEWORK.md`** — the testing canon (1.5): the 7 principles + `[NOT-TESTED]`/`[TESTED: …]`
   trust markers on everything the agent generates (a false `[TESTED]` is a judge-hunted fraud);
   2.1 adds the taste class — a perception-adjective criterion is verified by the OWNER, not the agent.
6. **`EXPERIENCE.md`** — the agent's lesson log: recall (grep by tag) before a task, capture after a
   meaningful success/failure (skill `/experience`). Since 2.1 a `Repro:` line is MANDATORY.
7. Maps: `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (where things are) and
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (how it works).
8. **`PROJECT_HISTORY.md`** (2.1) — the append-only chronicle of closed work. NOT part of the required
   reading minimum: open it only for archaeology. `STATUS.md` is the living summary of NOW (~200 lines)
   and sheds its past into this file.

Knowledge directories: `plans/` `ideas/` `bugs/` `researches/` `interviews/` `homeworks/` — each has a
README with its rules. Closed items get the `DONE` tag in the filename. **Anything the agent wants FROM
the owner lives ONLY in `interviews/`** (hard rule, 2.1; one pointed task-level question in chat stays legal).

Skills (34; Claude Code format in `.claude/skills/` is the CANON — other systems hold generated copies in
`.agents/skills/`, `.grok/skills/`, `.cline/skills/`, `.roo/commands/`, re-synced by
`node .kaif/kaif-core.mjs sync`; never edit a copy, edit the canon and re-sync):
session `/resume` `/pause` (soft park — the chat continues here) `/end-chat` (full closure, commits and
pushes, hands the baton over) · autonomy `/autoloop` `/dayloop` `/nightloop` `/guarded-loop` (loop under
an external watchdog) · hygiene `/refresh-context` `/check-backlog` `/code-revision` · knowledge
`/report-bug` `/bug-research` `/propose-idea` `/experience` · owner `/interview` `/owner-voice`
`/owner-reviews` `/derive-styleguide` · planning `/plan-task` `/plan-epic` `/revision` `/what-next` ·
vision `/fix-vision` · help `/help-kaif` · release `/release` · execution discipline (1.5, judge pass
mandatory in the loops and `/release`; 1.6 — also before EVERY push/deploy, +6 guardrail hunts,
recon-before-code, the one-step rule, git hygiene, `[AI]…[/AI]` provenance marks; 2.1 — the planning
ladder before heavy work, the taste class, naming is never the agent's call, text travels through files):
`/fable-method` `/fable-loop` `/fable-judge` `/fable-domain` · lifecycle:
`/kaif-version` `/kaif-update` `/kaif-fork` `/kaif-switch-origin` `/kaif-remove`.

Machinery handles: `node .kaif/kaif-core.mjs <version|check|diff|modules|sync|update|update-verify|adopt-current|checkpoint>`.

Working language of the project docs: Russian. The owner is Krinik (Mikalai Kryvusha).
