# Test cases — <FEATURE / ARTIFACT NAME>

> **How to use this file.** COPY it into the project's test-doc home (default `testcases/`,
> created on first use; the sphere or the project may name another) as
> `TC_<ticket-or-feature>_<slug>.md`, then fill every `<PLACEHOLDER>` — never fill this template
> in place. The chain that produces the content is `TESTING_FRAMEWORK.md` → "The testing
> activities"; the trust rules for the markers are there too.

**Created:** <date> · **Under test:** <the feature / artifact> · **Version/build:** <...>
**Test basis:** <where the expected behaviour comes from — a requirement, the owner's word, a
spec, the canon map; quote or link EACH source — an expectation without a source is a guess>

## 1. Goal vector

<What pain this feature answers and what "working" means — one paragraph. Goal type:
Achieve / Maintain / Avoid (`REQUIREMENTS_FRAMEWORK.md`).>

## 2. Requirements under test — the basis, made testable

| # | Requirement (EARS sentence) | Fit criterion (Scale · Meter · Target) |
|---|---|---|
| R1 | WHEN <trigger>, the system shall <response> | <what is measured · how · what number passes> |

## 3. Coverage matrix — dimensions and holes

Name the dimensions the design techniques produced (equivalence partitions · boundary values ·
states and transitions · parameter pairs · error guesses) and mark what is covered and what is
consciously left out. Principle 2: exhaustive testing is impossible — prioritize by risk and SAY
what was skipped; a hole named is a decision, a hole unnamed is a future incident.

| Dimension | Values covered | Explicitly NOT covered (risk named) |
|---|---|---|
| <e.g. account state> | <fresh · returning> | <suspended — no repro path, risk low> |

## 4. Cases

Statuses: `pass` · `fail` · `blocked` · `skipped` — each with the observation named (what ran,
what was seen). A single observation flips the marker of a single CASE, never of the feature. Each
case names the MACHINERY that walks it on the real product by the user's path and what that
machinery READS — the screen, the lines, the logs (`TESTING_FRAMEWORK.md` → "What the word "test"
means"): a case whose machinery returns only an exit code is hygiene, not a test case.

| # | Case (steps → expected) | Technique | Status + evidence |
|---|---|---|---|
| C1 | <steps> → <expected result> | <partition / boundary / decision table / state / pair / guess> | [NOT-TESTED] |

## 5. Control cases — MUST

A feature check that cannot fail proves nothing: observe the feature NOT work before calling it
working (turn the controlling flag off, remove the controlling parameter).

| # | Control → expected: the behaviour is absent | Status + evidence |
|---|---|---|
| K1 | <flag off> → <the feature disappears, nothing else breaks> | [NOT-TESTED] |

## 6. Verdict

`[TESTED]` on the FEATURE is legal only when all three hold: every case above carries a status ·
the coverage matrix names its holes · the control cases ran. Defects found go to `bugs/` in the
defined shape — `TESTING_FRAMEWORK.md` steps 6–7: hunt the reproduction when the first attempt fails,
then the tester's report (template C of `/report-bug`) → `BUG_FIXING_FRAMEWORK.md`.
