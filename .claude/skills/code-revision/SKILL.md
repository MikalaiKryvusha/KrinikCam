---
name: code-revision
description: A periodic READING revision of the codebase by the strongest available model — the complement to gates and judges, which only check what was CLAIMED: zone the code (and the canon that promises what the code must do) by axis, run parallel reviewers each armed with a written brief and the project's own PAID-FOR failure classes (EXPERIENCE + bugs), demand a verbatim quote for every finding, then send every finding through an INDEPENDENT adversarial skeptic whose default verdict is "not a defect"; survivors become bug docs and their lessons feed the guardrails weak models run on. The run leaves audit reports in `reports/KAIF_AUDIT/` grouped by finding family, each finding written as a contract a weaker model can execute, and the newest summary is the next run's baseline. Use when the human says "run a code revision", "прогони ревизию кода", "audit the codebase", or when the newest summary is older than the project's cadence; distilled from two field audits (two different projects) that found every real defect OUTSIDE what gates could see, and rewritten by the model that executes it (KAIF 2.7). Trigger aliases (ru): «прогони ревизию кода», «ревизия кода», «аудит кодовой базы», «вычитай код»
---

# /code-revision — the periodic reading revision

Gates and judges verify what was CLAIMED ("did X — is X true?"). Two independent field audits
found the same thing: every real defect lived in the UNCLAIMED — checks that could not physically
fail, invariants guarded in one direction, comments describing deleted code. Those are found only
by READING, and reading at strength is exactly what a periodic revision by the strongest available
model buys: one strong hour closes weeks of accumulated weak-session gaps — and its findings feed
`EXPERIENCE.md` and the sphere's craft recipes, which is what makes the WEAK sessions smarter
afterwards.

> **Written by its executor.** The first edition was written by the model that watched the audits;
> this one was rewritten by the model that runs them, reading it as an instruction to itself
> (KAIF 2.7, epic CR) — every change names the execution failure it repairs, every kept place says
> why. The artifact contract — report skeletons, the finding card, the reviewer and skeptic
> briefs, the excluded classes, the noise budget — loads on demand:
> `references/audit-report-template.md` (a reviewer handed bloated instructions silently drops
> part of them). Steps marked *[judgment]* need the strong model; *[mechanical]* ones are a script
> or any model.

## Step 0 — baseline, scope, budget, and the ground before the hunt

1. **Find the baseline** *[mechanical]*: the newest `reports/KAIF_AUDIT/*_SUMMARY.md` that IS a
   revision — it carries a methodology table (zones · reviewers · axes) AND a coverage map — is the
   record of the last revision. The folder may hold summaries of another genre (a triage table of an
   earlier run's findings carries neither): skip them, take the newest that carries both. Its coverage map, its Limits and its closing "what the NEXT run must
   change" are this run's inputs. No summary yet → run 1: the whole codebase. The run is due when
   the owner asks or when that summary is older than the cadence `AGENT_GUIDE.md` names (four
   weeks when it names none) — no setting is invented for it.
2. **Cut the scope** *[judgment]*: the zones touched since the baseline (`git log <baseline sha>..HEAD
   --stat`) plus the zones the baseline said to take next. Zones are cut by language / layer /
   subsystem — and by CANON DOCUMENT: a promise in the canon with no mechanism behind it is an
   omission, hunted from the document side (the pairs registry is its deterministic layer).
3. **Name the budget and the stop rule** in the chat before starting: reviewers · skeptics · a
   ceiling in units the executor CAN measure — agents and wall-clock time; tokens only where the
   harness shows a counter (an invented number is worse than none). The run stops when the zone
   list is exhausted or the noise budget (reference §5) is hit. The summary records what was
   actually spent in the same units (the origin's first run: 13 agents, three zones; its "about
   1.2 M tokens" was read by the owner from the interface, not by the agent).
4. **Record the scope line in the chat**: what is hunted — **defects · vulnerabilities · frauds ·
   contradictions · omissions**, including the omission of something the canon promised — and what
   is NOT hunted (excluded classes, reference §5): a revision reporting everything is ignored
   entirely.
5. **Map the ground** *[judgment]*: subsystems, boundaries, contracts, what each zone is FOR, before
   any hunting — a reviewer who does not know a boundary reports crossing it as a defect. The map
   goes into the report's methodology table, so the next run inherits it.
6. **Run the code first** *[mechanical]*: `node .kaif/kaif-core.mjs check`, the `.kaif/tools/*`
   modules WHOSE SCOPE CROSSES THE ZONE (`check` and `selftest`; a module that reads nothing in the
   zone is not run for it, and the summary names which were run), the project's own guards (the
   tools table of `AGENT_GUIDE.md`), the pairs registry, and the greps of the paid classes — the
   `Repro:` lines of the `EXPERIENCE.md` entries tagged with the zone's tags. A repository that
   BUILDS the framework instead of deploying it has no `.kaif/`: the same modules live where its
   tools table says. Their output is evidence (`BUG_FIXING_FRAMEWORK.md` → "A finding is not a
   finding until verified", point 1); what code can find, the model is not spent on. A tool that
   answers "nothing to judge here" (its own exit code, e.g. `SKIPPED=3`) is evidence too — of
   ABSENCE: where the canon promises such declarations for this zone, the absence becomes an axis
   for the reviewers (a canon promise with no mechanism); where it does not, it goes into Limits
   as "not applicable" — and it is never read as green. Nothing in this step raises a window or a sound on the owner's machine: a contour generator
   or a live page is never started by a reviewer — the executor starts it, announced.

## Step 1 — zone and arm the reviewers

- One reviewer per zone — or, for a single small zone, two or more cut by the zone's CLAIM
  CLUSTERS (what the zone promises, not its directories; reference §7: reviewers cut that way came
  at one defect from four sides; the origin's one-zone run of 2026-09-18 adds a single observation —
  two such reviewers raised no duplicate card) — parallel where the harness
  allows; each reviewer receives a WRITTEN brief
  (reference §7) — its zone, the paid classes, the axes, the excluded classes, the card form, the
  budget — never the whole skill, and never "look for problems".
- Arm EVERY reviewer with the project's own **paid-for failure classes**: the `EXPERIENCE.md`
  entries by the zone's tags (their `Repro:` lines are the greps) and the closed `bugs/` classes. A
  reviewer hunting the classes this project already paid for finds their new faces; a generic
  reviewer finds style nits.
- **A reviewer reads its zone WHOLE** — every file, top to bottom, never by grep as a substitute:
  greps find the known, reading finds the unclaimed (the field runs read a 2 323-line core whole).
  Read whole · read partly · not read goes into the coverage map by file.
- Standing axes that both field audits proved fertile (add the project's own): decorative
  guardians (can this check actually STOP anything? what happens on empty input?) ·
  one-directional invariants (`BOTH-WAYS`) · truth↔mirror drift (run the pairs registry) ·
  progress marks set before the work (`AFTER-WORK`) · comments/docs describing deleted behavior ·
  happy-path process/stream wiring · test-fraud (checks green for the wrong reason) · a canon
  promise with no mechanism behind it.

## Step 2 — the finding contract: no quote, no finding

Every finding carries a verbatim quote (file:line + the exact text). A finding without its quote
does not exist — this single rule kept both field audits' reports checkable by script. It kills
real findings with a wrong address too (a field finding died at `:617` while the defect sat at
`:637`); that is the deliberate price, because a false finding costs more than a missed one.

The full card is eight fields (reference §3); the three that decide whether a WEAKER model can
execute the fix are the repro stated as a class condition, the verification command inside the
card, and the link to a paid class. Every finding is also marked against the baseline — `new` /
`known: <bugs/NN or EXP-NNNN>` / `regression of <id>` — with the feedback loop's own fingerprint,
`kaif-fp: <surface> :: <symptom-class> :: v<major.minor>`, and its `Dedup attestation:` line
naming the commands grepped (`/report-bug`) — both live IN THE AUDIT CARD always; whether the
project's bug document repeats them is that project's `/report-bug` rule (a deployment's
`bugs/KAIF/` tickets carry them; a project whose bugs are its own may not). Never a second key
minted here.

## Step 3 — the adversarial skeptic (mandatory, not optional)

Every finding goes to a skeptic INDEPENDENT of the reviewer that raised it — one skeptic per
finding, or one per family ruling on each finding; never the reviewer judging its own card; where
the harness has no subagents, a fresh pass that has not seen the reviewer's rationale. The
skeptic's job is to REFUTE and its default verdict is **"not a defect"**; its brief (reference §8)
names the three lenses — is the address verbatim · does an independent reproduction reach the
failure · does a recorded decision, a guard or a declared exclusion cover the case. The skeptic
reads the project's decision documents — interviews, ideas, bugs — because that is where the
truth usually is: in the field, 9 of 21 findings died there as recorded owner decisions or
already-guarded behavior, 4 of 9 on the origin's first run; each would have become false work.
Only survivors move forward — and a run whose skeptic refutes nothing is a run whose skeptic did
not work.

## Step 4 — verify, file, fix separately

- The EXECUTOR reproduces each surviving finding before any fix — the skeptic's failed refutation
  is not the reproduction; the command of the reproduction is field 6 of the card.
- Every confirmed finding names its twins: `TWINS: searched <pattern> — found <N>: <sites or
  "none">` (`BUG_FIXING_FRAMEWORK.md` → twin check) — that list is the inventory a class doc is
  made of.
- Survivors become `bugs/` documents (same-class findings → ONE class doc with the full inventory)
  AND land in the run's audit reports: one document per family, plus a summary carrying the verdict
  first, the coverage map and the limits (reference §§1–2).
- Fixes are a separate pass from the revision (separate commits; every fix proves itself with an
  ADDRESSED mutation: *mutant M → exactly checks P₁…Pₙ red, and only they; intact code → 0 red*).
- Refuted findings are recorded WITH their refutation reason — otherwise the next revision "finds"
  them again.

## Step 5 — feed the loop back

- Every confirmed class appends an `EXPERIENCE.md` lesson **with its Repro line and Trigger
  point**; a class seen for the SECOND time must leave as a mechanism (linter/guard/gate), not as
  a third reminder — a finding the model raised twice is the specification for a grep guard.
- New craft gaps go into the sphere's craft recipes (the guardian skeleton, platform patterns) —
  that is the amplification: the strong model's reading becomes the weak models' recipes.
- **Count the previous run's effective false positives** (reference §5: a finding whose bug doc
  is not DONE and whose family no commit names = no action) and write the number into this
  summary's methodology table.
- Close the summary with the record the NEXT run reads: date, scope, spend, found / refuted /
  fixed, the coverage map, and what the next run must change — one pass finds roughly half, and
  an identical pass finds the same half.

## What this skill refuses to do

- Ship findings without quotes, or fix anything during the reading pass.
- Skip the skeptic, or let the reviewer be its own skeptic — unrefuted findings are half false,
  and false findings become false work.
- Treat "the gates are green" as a reason not to read — the gates not lying is exactly what both
  audits confirmed, and every real defect was outside them anyway.
- Report a finding a weaker model cannot act on, or claim coverage the coverage map does not show.
- Raise a window or a sound on the owner's machine from a reviewer or a skeptic — a live check is
  named for the executor, who runs it announced.
