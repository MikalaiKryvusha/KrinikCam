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
| build | compiling/packaging the product (`<BUILD_COMMAND>`) |
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
| Debris | scratch files, debug prints, commented-out code left behind |

## Done, by example

"The fix is done" means: the named check passes, observed; the build/tests for the touched area are
green; twins searched; the report leads with the outcome and carries its owed `INTENT`/`TWINS` lines.
Not: "should work now."

## Adaptation notes

- Emphasize the **harness** principle (`BUG_FIXING_FRAMEWORK.md`): build instrumentation to reproduce and
  verify objectively; the 3-attempts rule before switching to research.
- All base skills apply directly; `/release` maps to GitHub Releases.
- This is the default sphere if a project is clearly software and no other sphere is specified.
