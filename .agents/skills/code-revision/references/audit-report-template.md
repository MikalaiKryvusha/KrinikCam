# The audit report — the output contract of `/code-revision`

Loaded on demand by the skill. The body of `/code-revision` describes the PROCEDURE; this file
describes the ARTIFACT the procedure must leave behind. Copy the skeletons below; do not restate
them from memory.

Why the artifact is specified at all: in the field, revision reports carried the verdict and the
class table but pushed every piece of forensics into other documents — so the report could not be
re-checked line by line, and a weaker session could not act on it without the author. A finding
that a weaker executor cannot execute is an unfinished finding.

## 1. Where it goes

Reports live in `reports/KAIF_AUDIT/`, whose genre is fixed by `reports/README.md` — records, not
tasks: never `DONE`-tagged, never rewritten, corrections appended. One run produces:

| File | Audience | Holds |
|---|---|---|
| `<date>_<scope>_SUMMARY.md` | the owner, and the next revision | verdict first · scope & methodology · coverage map · family table · inventory of confirmed/refuted · limits |
| `<date>_<scope>_<family-slug>.md` | the executors who will fix | one FAMILY: its mechanism, then a finding card per occurrence |

In `KAIF_AUDIT/` the index of a file is its DATE, not a running number: the `NN_<name>.md` form of
`reports/README.md` belongs to the other report folders.

One document per finding family — never one per finding, and never one per subsystem. The family
is the unit because a class is what a fix must close (`BUG_FIXING_FRAMEWORK.md` → "Close the class,
not the instance"), and because it lets the next revision recognise a NEW FACE of a known class
rather than only a repeated line.

## 2. SUMMARY skeleton

```markdown
# Audit <NN> — <scope in five words> (<date>)

**Verdict (before the evidence):** <2-4 sentences: what the gates did or did not miss, how many
findings were raised, how many survived the skeptic, and the one thing the owner should know.>

## Scope and methodology
| Field | Value |
|---|---|
| Commit / tree state | <sha + dirty?> |
| Slice | <whole base · zones touched since <date/sha> · named subsystems> |
| Axes run | <the axes; the standing set plus this project's own> |
| Model / reviewers | <which model, how many parallel reviewers, how many skeptics> |
| Deterministic layer | <which greps, linters, guards, pair-registry commands ran FIRST, and their output> |
| Excluded classes | <the noisy classes deliberately not hunted — see §5> |
| Run | <n of a planned series; a single run finds roughly half> |

## Coverage map
| Zone | Looked at | Not looked at | Why |

## Families found
| # | Family | Occurrences | Mechanism (one sentence, no property names) |

## Inventory
**Confirmed (<n>):** `<family-doc#F1>` (<one line>, <severity>) · …
**Refuted (<n>), and why that is also the result:** `<claim>` — refuted because <the decision
document, guard or observation that killed it> · …

## Limits (honesty)
- What this run did NOT cover.
- "Confirmed" means "the skeptic failed to refute it", not "true".
- Which findings sit on the defect/hygiene border and are called out as such.
```

The **Limits** section is not decoration: without it a report silently upgrades "not refuted" to
"true", which is the same fraud class as a false `[TESTED]` (`TESTING_FRAMEWORK.md`).

## 3. FAMILY document and the finding card

```markdown
# Audit <NN> · Family: <name> (<date>)

**Mechanism:** <one sentence describing HOW the failure happens — never the name of a property,
never a symptom.>
**Already guarded by:** <tool/suite/assert, or "not guarded" — this is what tells the reader
whether a new guard is owed.>
**Occurrences:** F1 … Fn, ordered by cost, descending.

## F<n> — <a CLAIM about what is broken and with what effect>
```

Each card carries these fields, and a card missing one is not shippable:

| # | Field | Must contain | Fails when |
|---|---|---|---|
| 1 | **Quote** | `path:line` plus the exact text, byte-for-byte; if the FIX lands somewhere other than the defect site, name those files too | paraphrase, ellipsis, or a line that does not exist — no quote, no finding |
| 2 | **Failure scenario** | concrete inputs/state → the wrong output, as it would actually occur | the word "theoretically"; a scenario nobody can reach |
| 3 | **Severity** | impact × likelihood, plus the decision: **Act** (fix now) / **Attend** (fix in the cycle) / **Track** (watch) | a bare label with no impact and no likelihood behind it |
| 4 | **Baseline** | `new` · `known: <bugs/NN or EXP-NNNN>` · `regression of <id>` — with the attestation line naming what was grepped | claiming novelty without the search behind it |
| 5 | **Fix sketch** | the mechanism, executable without the finder present — or an honest direction if the fix needs a decision | "be more careful"; a fix only its author could apply |
| 6 | **Fix accepted when** | a machine-checkable *fit criterion* (`REQUIREMENTS_FRAMEWORK.md`): the command, grep or test, the output that means "fixed" — AND today's MEASURED state, so the executor knows the criterion is reachable | an unmeasurable criterion (a wish, not an acceptance test); or a criterion whose current state was never measured, so nobody knows whether it is red today for a second reason |
| 7 | **Do not touch** | the neighbouring behaviour that must stay as it is, and why | absent — the executor then "fixes" the surroundings too |
| 8 | **Meta** | dates, related findings, the decision documents read, the paid class this belongs to | a finding floating free of the project's own history |

Field 4 uses the feedback loop's EXISTING deduplication key and its attestation rule — do not mint
a second one. Field 6 is a fit criterion under its canonical name. Field 3's severity is the
finding's own; the VERDICT vocabulary for whether a finding survived is the judge's
(VERIFIED / VERIFIED WITH CAVEATS / REFUTED) — no parallel scale is invented here.

**Read fields 6 and 7 against each other before shipping the card.** They are the two halves of one
sentence — what must change and what must not — and a card whose acceptance criterion requires
changing something its own "do not touch" freezes is defective, whichever half is wrong. The
executor cannot resolve that contradiction: they will either guess or stop, and both cost more than
the minute it takes the author to check. This rule exists because the first executability test of
this very template hit exactly that contradiction and had to proceed on a guess.

## 4. What makes a card executable by a weaker model

Three fields carry that weight, and field evidence is what put them here:

- **The repro stated as a CLASS condition**, not as one incident: "any project where <condition>"
  rather than "on my machine at 14:20". The class form is what lets a session that never saw the
  original run reach the same state.
- **The verification command inside the card**, so the claim can be re-checked without reading the
  codebase — the same discipline the deterministic layer runs under.
- **The link to a paid class** (`bugs/NN`, `EXP-NNNN`). A finding attached to a class the project
  already paid for is recognised; a free-floating finding is re-litigated.

Findings are written blameless: a weak model's failure is a missing guardrail, never a stupid
model. That framing is the feedback loop's, and it applies unchanged here.

## 5. Excluded classes and the noise budget

A revision that reports everything is ignored entirely. Name the excluded classes in the report's
methodology table, so exclusion is a stated decision rather than a silent gap. Start from this
list and let the project add its own:

- style, formatting and naming preferences with no behavioural effect;
- theoretical resource exhaustion with no reachable trigger;
- generic input-validation observations not tied to a concrete misuse;
- duplication that the project has recorded as a deliberate trade;
- anything already carried as a named, dated, deferred debt.

**Effective false positive** = a finding on which the executor took no action. It is the metric
that decides whether the next revision gets read at all: past roughly one in ten, operators start
ignoring the tool, and a report nobody reads is worse than no report. Count it on the NEXT run, by
this procedure, not by feel: for every finding of the previous summary's inventory, "action" means
its `bugs/` document is `DONE` or a commit names the finding's family or bug (`git log --grep`);
anything else is "no action". Write `Effective FP of the previous run: <no action> of <findings>`
plus the list into the new summary's methodology table. A noisy reviewer is repaired like any
other noisy scanner: with a labelled fixture and a precision number before and after, never with
one more ad-hoc exclusion.

## 6. Series, not a single run

One pass finds roughly half of what is there, and repeating the same pass finds the same half —
the pesticide paradox in `TESTING_FRAMEWORK.md`. So the coverage map is mandatory, and the summary
closes by naming what the NEXT run should change: a different axis, a different slice, different
data. A revision recorded without its coverage map cannot be continued, only repeated. The newest
summary IS the baseline the next run starts from (skill, Step 0).

## 7. The reviewer brief — what one reviewer receives, and nothing else

A reviewer handed the whole skill silently drops part of it; a reviewer told "look for problems"
reports style. The executor fills this page per zone and sends it as the reviewer's entire task
(field origin: the first run wrote thirteen such briefs by hand; a reviewer cut by claim clusters
rather than by directory converged on the same defect from four sides — that convergence became
evidence):

```markdown
# Reviewer brief — zone: <name>

**Read WHOLE, top to bottom — no grep as a substitute:** <files with line counts>
**What this zone is FOR, and its boundaries:** <two sentences from the ground map>
**Paid classes to hunt — their new faces:** <EXP-NNNN + one-line lesson · bugs/NN + one-line mechanism>
**Axes:** <the standing axes of Step 1 + the project's own>
**Deterministic layer already run — its output is evidence, do not repeat it:** <commands + verdicts>
**Excluded classes — do not report:** <§5 list + the project's own>
**Budget:** at most <N> cards; stop at the noise budget; say "nothing found on <axis>" by name.
**Output:** one card per finding, fields 1–8 of §3, the quote FIRST and byte-exact (`path:line`);
the baseline mark with the fingerprint; no fixes, no edits, nothing that raises a window or a sound.
**Coverage line at the end:** read whole · read partly · not read — by file.
```

## 8. The skeptic brief — independent by construction

Independence is the property, not the head-count: one skeptic per finding, or one per family
ruling on each finding, or — without subagents — a fresh pass of the executor that reads only the
card. The skeptic never sees the reviewer's rationale beyond the card:

```markdown
# Skeptic brief — finding <F#> of family <name>

**Default verdict: NOT A DEFECT.** Your job is to refute. Confirm only what survives all three lenses:
1. **Address** — open `path:line`; is the quote byte-exact? A wrong address kills the finding even
   when the thought behind it is right.
2. **Reproduction** — reach the failure yourself: a command, a fixture, a mutation — on a COPY. The
   reviewer's scenario is a claim, not evidence.
3. **Coverage** — does a recorded owner decision (`interviews/`), an idea, a bug, a guard's selftest,
   a declared exclusion or a genre boundary already cover this case? Any of them refutes.
**Output:** `REFUTED — <the document, guard or observation that killed it>` or `CONFIRMED — <your own
reproduction: command and output>`; never "plausible".
**Rules:** no fixes; no edits; nothing that raises a window or a sound on the owner's machine.
```
