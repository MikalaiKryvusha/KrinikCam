# KrinikCam — context for AI agents (universal fallback)

This project is wrapped by the **KAIF 1.6 — Homeostatic KAIF** framework (see `KAIF_FRAMEWORK.md`). The
canon is NOT duplicated here — read the sources:

1. **`AGENT_GUIDE.md`** — THE canon: rules, names, commands, conventions (+context router: which doc
   slice to read per task type). Read before every task.
2. **`STATUS.md`** — the living state: what's done, where we are, what's next.
3. **`PHILOSOPHY.md`** — the core principle: SIMPLICITY (KISS + Occam). Stuck = you misunderstood the
   task → simplify.
4. **`BUG_FIXING_FRAMEWORK.md`** — how to fix defects (fix→build→test loop, the 3-attempts rule,
   intent gate + twin check).
5. **`TESTING_FRAMEWORK.md`** — the testing canon (1.5): the 7 principles + `[NOT-TESTED]`/`[TESTED: …]`
   trust markers on everything the agent generates (a false `[TESTED]` is a judge-hunted fraud).
6. **`EXPERIENCE.md`** — the agent's lesson log: recall (grep by tag) before a task, capture after a
   meaningful success/failure (skill `/experience`).
7. Maps: `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (where things are) and
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (how it works).

Knowledge directories: `plans/` `ideas/` `bugs/` `researches/` `interviews/` `homeworks/` — each has a
README with its rules. Closed items get the `DONE` tag in the filename.

Skills (Claude Code format, `.claude/skills/`; other systems have their own copies in `.agents/skills/`,
`.grok/skills/`, `.cline/skills/`, `.roo/commands/` — treat each SKILL.md as a named procedure):
`/resume` `/pause` `/autoloop` `/dayloop` `/nightloop` `/refresh-context` `/check-backlog`
`/report-bug` `/bug-research` `/propose-idea` `/experience` `/interview` `/revision` `/fix-vision`
`/what-next` `/help-kaif` `/release` · execution discipline (1.5, judge pass mandatory in the loops and
`/release`; 1.6 — also before EVERY push/deploy, +6 guardrail hunts, recon-before-code, the one-step
rule, git hygiene, `[AI]…[/AI]` provenance marks): `/fable-method` `/fable-loop` `/fable-judge`
`/fable-domain` · lifecycle:
`/kaif-version` `/kaif-update` `/kaif-fork` `/kaif-switch-origin` `/kaif-remove`.

Working language of the project docs: Russian. The owner is Krinik (Mikalai Kryvusha).
