# Sphere: Programming / Software (reference sphere)

> The reference sphere — the domain KAIF was distilled from. It uses the base terminology directly.

## Thesis intro

A software project produces and evolves code. "Progress" is working, verified functionality shipped in
increments. The human sets product vision and architecture direction; the AI executor implements, tests,
debugs, and documents. Verification is concrete (builds compile, tests pass, the app behaves correctly).

## KAIF entity mapping

| KAIF base | In this sphere |
|-----------|----------------|
| `bugs/` | code defects, crashes, wrong behavior, regressions |
| release | a tagged, shippable version of the product (GitHub Release) |
| build | compiling/packaging the product (`JAVA_HOME=<Android Studio JBR> node tools/build.mjs --no-ui`) |
| test / verify | unit/integration tests, running the app, objective checks via a harness |
| `plans/` | roadmap, phases, architecture map, feature ideas |
| interview | UI/UX, library/protocol/architecture forks, brand/scope decisions |

## Key terms (brief glossary)

- **bug** — a defect: code that does the wrong thing or fails.
- **release** — launching a logically complete version of the product into the world.
- **build** — turning source into a runnable/shippable artifact.
- **regression** — something that used to work and broke.
- **harness** — tooling that lets the agent run/observe/drive the software without a human.
- **refactor** — restructuring code without changing behavior.

## Minimum evidence set (binding — open these before acting, every time)

1. The statement of intended behavior for the code under change: README / spec / docstring / type —
   actually opened, not assumed (the intent gate's third slot).
2. The actual code and the failing check/output — read, run, reproduced.
3. Current docs for any library API you are about to rely on (fetched, or the installed package source) —
   never from recall.

## Authority order

Explicit owner/user statement > the spec (README/docs/docstrings) > the tests > current code behavior >
your preference. Classic conflict: "fix the code so the tests pass" when the test itself contradicts the
spec — surface the contradiction; the task framing does not promote the tests above the spec.

## Verification by observation

- The done criterion is observed (test ran green, build compiled, the app behaved) — never inferred from
  reading the diff.
- The surrounding system still works: build/tests/lint for the touched area, actually run.
- After any defect fix: search the whole project for the same wrong construct (`TWINS:` line — the
  pattern, N other sites).
- Rendered surfaces are actually rendered and looked at.

## Fraud table (for `fable-judge`)

| Fraud | Symptom |
|---|---|
| Weakened checks | assertions loosened/deleted, expected values edited to match, tests skipped, real calls mocked |
| False completion | "all tests pass" with no run shown; success language on a failure transcript |
| Scope creep | drive-by refactors, reformatting, new dependencies beyond the ask |
| Unauthorized action | push/deploy/publish with no quoted authorization (`AUTH:` line) |
| Spec betrayal | code changed to satisfy a check that contradicts the README/spec |
| False [TESTED] mark | a `[TESTED: …]` test-status marker with no reproducible verification behind it (TESTING_FRAMEWORK.md) |
| Invented data | a plausible literal (a count, a name, a stat) on a user-facing surface with no source behind it — a placeholder shipped as fact |
| Unmarked AI text | AI-written content in the owner's canon artifact without `[AI]…[/AI]` provenance marks, or a mark removed by the agent itself (only the owner's word removes marks — AGENT_GUIDE.md) |
| Debris | scratch files, debug prints, commented-out code left behind |
| Voice without a corpus | a "portrait of the owner's style" or a re-voiced text whose rules carry no verbatim owner quotes with addresses — style derived from memory of the owner instead of their texts (`/owner-voice`) |

## Done, by example

"The fix is done" means: the named check passes, observed; the build/tests for the touched area are
green; twins searched; the report leads with the outcome and carries its owed `INTENT`/`TWINS` lines.
Not: "should work now."

## Owner's voice (KAIF 2.1)

The voice carriers here are the surfaces a human reads as the owner's own text: README and docs,
UI copy, release notes, error messages. Typical corpora: the owner's pre-AI docs and posts, their
hand-written issues and commit messages. "Accepted" means the owner reads the surface and does not
flag the language — the ritual and thresholds are `/owner-voice` + the shipped skeleton
`.kaif/_owner-voice-template.md`; code identifiers and comments follow the codebase style, not the
portrait.

## Craft recipes (KAIF 2.1 — prostheses for weak sessions; copy the skeleton, don't re-derive it)

Two independent field audits agreed: weak models follow recipes and samples flawlessly and fail on
principles. These are the recipes for the exact places they fail. The fable craft slots
(`/fable-method` Step 5) route here.

### The guardian skeleton — every check/bench/watchdog you write fills these six points

1. **Self-check on bare run** — invoked with no arguments, it explains itself instead of crashing.
2. **A failure EXITS non-zero** — printing "MEASUREMENT INVALID" is not a signal; only the exit
   code stops a pipeline (field: five independent decorative guardians, none could stop anything).
3. **Empty input is RED** — an empty corpus is "nothing was checked", never "0 problems".
4. **Failures stay in the denominator** — 9 refusals out of 10 is not "100% of the measured".
5. **Two-sided fixture** — proven RED on a broken version and GREEN on a fixed one before trusted.
6. **A looping watchdog survives its own sensor's failure** — one bad probe must not kill the loop
   (`set +e` around the probe in bash; try/catch in Node).

**The measuring tool changes only together with a re-measure** — editing a judge/bench/scorer
changes the scale; ship the tool change and the re-measured numbers in ONE commit, or the old
numbers silently lie (field rule, paid for by a benchmark drift).

### Platform patterns — copy these, don't re-derive the platform's edge semantics

Weak sessions share the same gaps in Node/bash/HTTP edge semantics; each pattern is one
"when to take it" line — the shape lives in your project's harness once, then gets reused:

- **`spawn` with an `'error'` handler wired BEFORE anything else** (ENOENT is a diagnosable event,
  not a crash), and the `'close'` promise created before any await that might race it.
- **SSE/line reader with a carry buffer** — a line split by a chunk boundary is the NORMAL case;
  keep the tail, prepend it to the next chunk.
- **Atomic file lock** — create with `{flag:'wx'}` + write the pid; release checks the pid;
  a check-then-write pair is a TOCTOU race, not a lock.
- **Download to `tmp` + `rename`** — never straight into the final name (a died download leaves a
  broken file forever); handle HTTP 416 and add a stall watchdog.
- **Bash watchdog loop with `set +e` inside** — under `set -e` one failed probe kills the guard.

### The stand-doors inventory — every stage-only mechanism is a table row

Any stand/dev-only door (`?as=` params, auto-login, emulator defaults in compose) enters the recon
doc as a row: `door → what it does on the stand → WHAT IT DOES IN PROD → the guard of the pair`.
An empty "in prod" cell is tomorrow's incident (field: compose led prod into the emulator — the
stand direction was guarded, the prod direction was not). Mechanizable: grep
`isStand|localhost|EMULATOR` and demand a row per hit.

## Adaptation notes

- Emphasize the **harness** principle (`BUG_FIXING_FRAMEWORK.md`): build instrumentation to reproduce and
  verify objectively; the 3-attempts rule before switching to research.
- All base skills apply directly; `/release` maps to GitHub Releases.
- This is the default sphere if a project is clearly software and no other sphere is specified.
