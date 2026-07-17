# TESTING_FRAMEWORK — how the agent tests what it creates

Raw generated content — code, a document, an analysis, anything — **must not be trusted**. It may *look*
logical and working and still be broken, or fail the owner's actual requirements (the idea, the plan, the
vision). An early defect that rides silently to production is the most expensive kind — it destroys
projects from the inside. Testing is a distinct, first-class part of ALL work, not a formality after it.
This document is the agent's testing canon; it applies to **every artifact in every sphere** — a function,
a dataset, a legal clause, a bridge design, a thought (what "verify" means in your sphere is defined by
the project's sphere library: its *Verification by observation* and *Minimum evidence set* sections).

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
   reading), then flip the marker to `[TESTED: …]` with the evidence named.
3. **Meeting `[TESTED: …]`** → you may trust it and need not re-test — but keep a grain of doubt
   (principle 1: bugs always exist). If evidence contradicts the marker, the marker is wrong: investigate.
4. **Testing found a defect** → file it (`/report-bug`, method: `BUG_FIXING_FRAMEWORK.md`), fix, re-test,
   and only then mark `[TESTED]`.
5. **A false `[TESTED]`** — the marker present with no verification actually performed — is a fraud;
   `/fable-judge` hunts it like any false completion claim. Never flip a marker without the observation.
6. **Carrier by artifact type:** code → the block/method comment; a document → the section's note; any
   other sphere → the nearest commentable carrier the sphere convention offers.

Markers are the persistent memory of verification: fable-method's Step 5 verifies *in the moment*; the
marker preserves that fact **across sessions**, for future agents and posterity — who else will know the
foundation was load-tested?

## How this composes with the rest of KAIF

- **fable-method** — Step 5 (verify by observation) is HOW a single check is performed; this framework
  says WHAT must carry a status and how trust propagates. The triviality gate still applies: a trivial
  change verified by its one obvious check needs no ceremony beyond its normal comment.
- **`/fable-judge`** — treats test-status markers as claims: a `[TESTED]` it cannot reproduce is REFUTED.
- **`BUG_FIXING_FRAMEWORK.md`** — where testing's findings go (one doc per defect; 3 attempts → research).
- **Spheres** (`.kaif/spheres/`) — define the sphere's evidence, verification-by-observation meaning, and
  fraud table; principle 6 lives there.
- **The harness** — invest in tooling that makes verification observable and deterministic
  (`AGENT_GUIDE.md` → Test harness); eyeballing is not testing.

*Grounding: the seven principles are the ISTQB canon (istqb.org; ru: testbase.ru) — distilled here for an
AI agent across all spheres.*
