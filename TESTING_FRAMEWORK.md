# TESTING_FRAMEWORK — how the agent tests what it creates

Raw generated content — code, a document, an analysis, anything — **must not be trusted**: it may *look*
logical and working and still be broken or fail the owner's actual requirements, and an early defect that
rides silently to production is the most expensive kind. Testing is a first-class part of ALL work, not a
formality after it; this canon applies to **every artifact in every sphere** (what "verify" means in your
sphere is defined by the sphere library's *Verification by observation* and *Minimum evidence set*).

## The seven principles of testing (the canon)

1. **Testing shows the presence of defects, not their absence.** A green suite never proves the product
   has no bugs — bugs ALWAYS exist; testing lowers the risk, never to zero.
2. **Exhaustive testing is impossible.** You cannot check every input/state combination — prioritize by
   risk and value instead of pretending completeness.
3. **Early testing saves the budget.** Verify at the requirements/plan stage; the later a defect is
   found, the more it costs (the waterfall skyscraper on an untested foundation).
4. **Defects cluster.** Most bugs live in a few narrow modules — where one was found, hunt for more
   (the fable-method twin check is this principle mechanized).
5. **The pesticide paradox.** The same tests stop finding new bugs — vary the tests, angles, and data.
6. **Testing is context-dependent.** Methods are chosen per project and sphere — a payment system, a
   research paper, and a landing page are not tested alike.
7. **The absence-of-errors fallacy.** A defect-free product that does not solve the user's task is
   worthless — always test against the OWNER'S requirements (`GOAL.md`, the idea, the plan), not only
   against the code's own consistency.

## What the word "test" means — a functional run on the real product, by the user's path

The agent does by machinery what a QA does by hand: it derives the scenarios from the functionality of
the module, the feature or the fixed bug, then walks the real product — stage or production — the way the
user does, pressing the buttons, reading the lines, looking at the screen and reading the logs. So:

1. **A test is a functional run on the REAL product (stage or production), by the user's path, whose
   result is READ.** The agent derives the scenarios from the functionality under test (the chain
   below), writes the machinery that walks them (a browser driver, a CLI session, a log reader) and runs
   it as the user would, READING the screen, the lines, the logs; never "the owner will test" — his eye judges taste.
2. **Hygiene is not a test.** Lint, unit tests, self-tests, mutation proofs, guards — mandatory (gate 5
   stays), never called "testing" in a report, a marker or a handover: they prove the check can fail, not
   that the thing works for a person. Machinery that returns only an exit code is an instrument, not a
   test: a run is a test when its result was read, and the report says what.
3. **`[NOT-TESTED]` is inadmissible to production.** Marker rule 2 flips on a functional run only; the
   run report carries it SEPARATE from hygiene (`Hygiene:` · `Functional run:` — never summed; `NONE` =
   *fixed, not tested*); a bug's closing status carries the same two lines (`/report-bug`).

## The testing activities — the chain that makes "tested" mean something

The trust contract below says how much to TRUST a result; this section says how the testing WORK
is done. Testing a feature is a chain of activities, not one observation — walk it in order, each
step with its exit condition:

1. **Analyze the test basis.** Name the source of truth for the expected behaviour — a
   requirement, the owner's word, a spec, the canon map (`REQUIREMENTS_FRAMEWORK.md` shapes
   these). *Exit:* every claim under test quotes where its expectation comes from; an expectation
   that is missing or untestable goes back as a requirements defect (principle 3 — cheapest right
   here). Studying the requirements to derive the test basis IS a testing activity, not somebody
   else's chapter.
2. **Design the observation set by named techniques.** Derive the cases with the standard
   instruments: equivalence partitioning · boundary values · decision tables · state transitions ·
   pairwise · use-case walk · error guessing. *Exit:* a written case list whose DIMENSIONS are
   named — which partitions, boundaries and states are covered, and which are consciously not
   (principle 2: prioritize by risk, and SAY what was left out).
3. **Write the documentation before executing.** Test documentation lives in files, never in the
   session's head: a plan (what and why) · a suite / checklist (the ordered set) · cases (steps ·
   expected · status). Copy the shipped template into the project's test-doc home (default
   `testcases/`, created on first use; the sphere or the project may name another):
   `cp .kaif/_testcases-template.md testcases/TC_<feature>_<slug>.md` — an artifact class with no
   home and no shape does not get written.
4. **Execute with bookkeeping.** Every case ends in a status — `pass` · `fail` · `blocked` ·
   `skipped` — with the observation named (what ran, what was seen). *Exit:* no case without a
   status; coverage is the case list, never an impression.
5. **Run the control case before calling the feature working.** Turn the controlling flag off /
   remove the controlling parameter and observe the feature NOT work: a feature check that cannot
   fail proves nothing (gate 5 below, applied at feature level).
6. **Hunt the reproduction** when a defect or a reported phenomenon does not reproduce on the
   first attempt: vary it over named axes — data and state · position · timing and races · entry
   point · fresh vs accumulated account · stage vs production · network — and write every attempt
   down. *Exit:* the steps reproduce it, or the report says "not reproduced" and lists at least
   three variants tried, each with its outcome — one attempt is never a verdict.
7. **File defects in the defined shape** — the tester's report a developer reads: **Description ·
   Steps to reproduce · Expected result · Actual result**, plus **Build · Environment · Evidence** and the
   severity/priority the tracker takes; the steps are the user's path in the product, never state assembled
   through a back door (template C of `/report-bug`; `node .kaif/tools/kaif-testrun-lint.mjs bug <report>`
   checks the sections and the hunt) — then hand off to `BUG_FIXING_FRAMEWORK.md` (one document per defect).

## Test-status markers — the trust contract

Every non-trivial artifact the agent generates carries an explicit, grep-friendly test status in its
comment / accompanying note. The marker strings are canonical English (like the `DONE` tag), regardless
of the project language:

- **`[NOT-TESTED]`** — freshly generated, raw. **Do not trust it.** The LLM "thought" it was right;
  that is not evidence.
- **`[TESTED: <date> · <how it was verified / what was observed>]`** — verified by observation, with
  the evidence named (a run, a render, a recomputation, a check against the source).

**The rules:**

1. **Creating raw content** (a non-trivial block/method/module/section) → write `[NOT-TESTED]` into its
   comment at birth. Commenting is already mandatory (`AGENT_GUIDE.md`); the marker is part of the
   initial comment.
2. **Meeting `[NOT-TESTED]`** (yours or inherited) → do not build on it blindly: plan its verification,
   verify **by observation** (fable-method Step 5: it ran, it rendered, it counted — never inferred from
   reading; and a FUNCTIONAL RUN on the real product, its result read — hygiene does not flip the marker:
   the section on the word "test" above), then flip it to `[TESTED: …]` with the evidence named.
3. **Meeting `[TESTED: …]`** → you may trust it and need not re-test — but keep a grain of doubt
   (principle 1: bugs always exist). If evidence contradicts the marker, the marker is wrong: investigate.
4. **Testing found a defect** → file it (`/report-bug`, method: `BUG_FIXING_FRAMEWORK.md`), fix, re-test,
   and only then mark `[TESTED]`.
5. **A false `[TESTED]`** — the marker present with no verification actually performed — is a fraud;
   `/fable-judge` hunts it like any false completion claim. Never flip a marker without the observation.
6. **Carrier by artifact type:** code → the block/method comment; a document → the section's note; any
   other sphere → the nearest commentable carrier the sphere convention offers.
7. **A FEATURE marker requires a designed set.** `[TESTED]` on a feature is legal only alongside the
   written case set with its covered dimensions (the activities chain above); a single observation
   flips the marker of a single CASE, never of the feature: "it worked once on the happy path" is a
   case-level fact.

Markers are the persistent memory of verification: fable-method's Step 5 verifies *in the moment*; the
marker preserves that fact **across sessions**, for future agents.

## The work produces its own means of checking

Building something includes building what checks it — a test suite, a check-list, test cases, a
fixture, a guard — planned WITH the work and landing in the SAME step, never "later".

The contract in step form — walk it on every non-trivial piece of work:

1. **Name the check while planning the work.** The same task step that builds X names what will
   check X — a suite · a checklist · test cases · a fixture · a guard.
2. **Land both in the same step.** The check enters the repository together with the work — never
   "later", never only in the session's scratchpad.
3. **Prove the check on a broken version** before trusting its green (gate 5 below;
   `BUG_FIXING_FRAMEWORK.md` → Guards). A closed defect is additionally born with the guard for
   its CLASS — that rule lives in `BUG_FIXING_FRAMEWORK.md` ("a fix without a guard is a fix on
   credit") and is not restated here.

The triviality gate applies: a trivial change verified by its one obvious check needs no ceremony
beyond the usual comment and marker. What is never legal is finishing non-trivial work with nothing
that can re-check it.

## An executed run produces its report

A run that left no artifact is indistinguishable from a run that never happened. So:

1. **Every executed run leaves a run report** — a live probe, a smoke, a polygon, a functional
   run — in the test-doc home, as a catalog by date:
   `cp .kaif/_testrun-report-template.md testcases/reports/<YYYY-MM-DD>_<work>.md`
   (the home is `testcases/` by default; a project may name another in `.kaif/kaif.json` →
   `testdocs`). The date-first name IS the index: the directory listing is the list of runs, like
   the runs page of a test-management tool — nobody keeps a second list by hand.
2. **Seven fields, none empty** — *Work* (what was tested and against which basis — the case set,
   the plan) · *Contour* (the part of the system and the stand: environment, build, data) · *Runs*
   (how many, WHEN — a timestamp per run — and the exact COMMANDS in code spans) · *Checks* (what
   was verified, case by case, with statuses — opening with two separate lines, `Hygiene:` and
   `Functional run:` — what was walked · on which contour · what was READ, or `NONE`) · *Found* (the defects — or the explicit word "none":
   zero is a finding, silence is not) · *Traces* (where the evidence lives: logs, screenshots,
   artifacts — their paths) · *Verdict* (pass · fail · blocked · partial, with the reason).
3. **A `[TESTED: …]` claim about a run names its report** — the marker carries the report's
   address (`testcases/reports/2026-09-12_polygon.md`) beside the date and the evidence; a claim
   about a run with no report behind it is the "tested without a run report" fraud `/fable-judge`
   hunts.
4. **The linter judges the form, the judge judges the truth.** The optional tool module
   `node .kaif/tools/kaif-testrun-lint.mjs check` (`selftest`) reddens on a missing or empty field,
   on a report outside the date catalog, on *Runs* without a command or a moment, on *Found* that
   is neither a list nor an explicit "none", on a *Verdict* `pass` whose *Checks* carry no
   `Functional run:` line or say `NONE` (hygiene alone is `partial`); when the home has no `reports/` it prints `SKIPPED=3`
   and says so — **an unwritten report is invisible to the linter**; only the judge and the owner
   can ask where it is.

## Green tests ≠ working — the observation gates

A green suite is one observation, not the verdict (principle 1): whole classes of defects are invisible
to every test and obvious to one minute of looking. Before "done" on anything that runs, renders, or
ships, walk the gates that apply:

1. **Live smoke with your eyes on the log.** Run the real process (not only the tests) and read its
   first working cycle in the log — startup, the key operation, no silent error spam.
2. **Self-sufficiency of the shipped artifact.** The image/bundle/package must start in isolation (a
   fresh container/directory) — a build that only works inside your working tree is not shipped.
3. **Domain invariants, before/after.** Before the work, write down the numbers that must not change
   (counts, sums, sizes); after, compare. Comparing two numbers is the one check any session performs
   perfectly — and its signal is among the highest there is.
4. **Countable quality proxies.** Where quality is visual or subjective, find what can be counted
   (animations per screen, panel-opacity checks, bundle growth): a zero on the counter is a stop-defect.
   A proxy never replaces the owner's eye — it catches the zeros *before* the owner has to.
5. **A check that has never failed proves nothing.** Every new guard/check is verified on a broken
   version first (see `BUG_FIXING_FRAMEWORK.md` → Guards); goldens for refactors are byte-exact —
   an empty diff is proof, "the numbers look the same" is not.
   **And the broken version is NAMED — together with its distance from the THREAT.** Reddening a
   guard against *a* broken version is necessary and not sufficient: a guard proven against the
   failure that was convenient to simulate, instead of the threat it exists for, does not withhold
   confidence — it ISSUES it, falsely. So every guard declares, next to itself, four
   greppable lines, and a guard is DONE only when the last one is no longer `NOT YET`:
   ```
   @guard <name>
   THREAT:         the real event it exists for
   PROVED-AGAINST: what the red run actually did
   GAP:            what the proof does NOT cover — or the word `none`, written after thinking
   ON-REAL-PATH:   where it was seen working on the path the owner actually runs — or `NOT YET`
   ```
   A recorder whose tape must outlive the event it explains declares the same way — `@forensic
   <name>` · `EXPLAINS:` the event · `DURABLE-AT:` when the evidence becomes durable — and `close`,
   `exit`, `trip-only` are rejected values: evidence durable only at a clean ending is not evidence.
   The optional tool module `kaif-guard-lint` (`.kaif/tools/`, `check` / `selftest`) reds on a block
   with a missing field or a rejected `DURABLE-AT`; it fires only on explicit `@guard` / `@forensic`
   markers and never guesses what a guard is.
6. **After a deploy, the gate is production itself, entered as a user.** Sign in by whatever door
   the product offers, walk the real screens, read the console — only then is "deployed" a fact.
   A smoke that only walks public surfaces proves the landing page is alive, not the product: if
   the product has authenticated state, an unauthenticated smoke is NOT evidence about the
   product.
7. **Artifact integrity before shipping.** "It built" and "it is one build" are different claims:
   the shipped bundle carries exactly ONE build identity, asserted mechanically before upload. An
   output directory that is not cleaned between builds ships a mixture of two builds — every
   individual file valid, the SET broken — and mixtures fail in ways no test sees.

Two placement rules: gates 6–7 belong IN THE DEPLOY PATH, not in prose — one deploy door that runs
them itself and fails on any red step (where the agent system has hooks, deny the raw deploy command).
And a post-deploy smoke must be able to FAIL on a dead product: prove there was something to measure before
painting green — a smoke that is greenest when the product is emptiest is worse than no smoke.

## The agent's stand is not the owner's real world — "done" about production comes after the real world

The agent verifies its work on a clean, freshly built stand — a fresh browser, a clean checkout, a
new user, today's build — and says "done". The owner's world is ACCUMULATED: an old session, a saved
profile, his own edits in the deployed tree, the cache of the previous build — and there it breaks,
while every instrument of the agent was green by construction. Before the word "done" about anything
already in production, the report carries the difference line:

```
REAL WORLD: accumulated — <what the owner's world already holds: sessions, profiles, data, edits>;
data and machine — <his data, his device, his account>; path — <the door he actually walks>
```

Each item has exactly two legal outcomes — *verified on the real world* (on his state, his data, his
path) or *verified with real state taken from the real world* (seeded from there, never invented).
"not verified there" is not an outcome: it is a STOP — the work stands and names what it waits for
(access · the machine · the owner's word). The one exception is the owner's word about a specific
check that CHANGES his state (writing into his live profile): then the check waits for the owner at
the machine, and "done" is not said. Gates 6–7 tell you to enter production as a user; this rule
tells you WHOSE production — his, with everything it has accumulated. `/fable-judge` hunts "done"
about production without the difference line (the done-without-the-real-world hunt).

## The taste class — when the observer must be human

A subjectively-perceptual acceptance criterion (a perception adjective: beautiful, natural,
pleasant, "feels right") is still verified by observation — but the OBSERVER is the human, by
necessity, not the agent. The agent's role is to PREPARE the observation: produce a mock-up on the
project's own material and hand over an artifact to perceive (`AGENT_GUIDE.md` → "The taste
class"; the homework doc with its two standing fields). The agent's own "sounds good to me" is not
a verification and never flips a marker; the owner's recorded verdict is.

## How this composes with the rest of KAIF

- **`REQUIREMENTS_FRAMEWORK.md`** — shapes what is REQUIRED; this framework verifies what was MADE
  against it. Principle 3 (early testing) is executed at the requirements stage there; deriving the test
  basis FROM the requirements is step 1 of the chain here; bugs are born where the two meet (`BUG_FIXING_FRAMEWORK.md`).
- **fable-method** — Step 5 (verify by observation) is HOW one check is done; this framework says WHAT carries a status.
- **`/fable-judge`** — treats test-status markers as claims: a `[TESTED]` it cannot reproduce is REFUTED.
- **Its guards** — optional tool modules in `.kaif/tools/` (`.kaif/KAIF_REFERENCE.md` §14): `kaif-guard-lint` (gate 5's
  declaration block) and `kaif-testrun-lint` (the run report's seven fields; `bug` — the tester's report); advisory.
- **`BUG_FIXING_FRAMEWORK.md`** — where testing's findings go (one doc per defect; 3 attempts → research).
- **Spheres** (`.kaif/spheres/`) — the sphere's evidence, its meaning of "verified by observation", its fraud table (principle 6).
- **The harness** — invest in tooling that makes verification observable and deterministic
  (`AGENT_GUIDE.md` → Test harness); eyeballing is not testing.
- **Why a rule here is the way it is** — the field history of the sections that have one (the ticket that
  paid for a rule, the owner's word) lives in `.kaif/KAIF_REFERENCE.md` §17, under the same heading; read the
  entry before changing or dropping a rule.

*Grounding: the seven principles and the activities chain are the ISTQB canon (istqb.org; ru: testbase.ru);
the run report is the ISO/IEC/IEEE 29119-3 test execution log and test completion report, distilled to seven fields.*
