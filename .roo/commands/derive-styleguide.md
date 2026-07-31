---
description: Derive a style guide FROM THE OWNER'S OWN SAMPLE before writing into their canon artifacts — registers, reference examples quoted from the owner's text, a one-concept-one-word dictionary, a pre-write checklist — and hand it to the owner for approval together with the list of MACHINE-LINTABLE rules. Use before any substantial writing into owner canon (rulebooks, lore, brand texts), or when the human says "derive a styleguide", "выведи стайлгайд", "зафиксируй мой стиль". Framework rule — writing into a canon artifact with no approved styleguide means derive and approve one first. Trigger aliases (ru): «выведи стайлгайд», «зафиксируй мой стиль», «стайлгайд из образца»
---

# /derive-styleguide — the owner's style, extracted from evidence

A weak session cannot HOLD the owner's style in its head — ten pages in, it drifts. The cure is
never "try harder": extract the style ONCE from the owner's own text, get it approved, and turn
every machine-checkable rule into a linter line. "The model forgets the styleguide after ten
pages — the linter never does."

**The prime rule: derive from the SAMPLE, not from your head.** Every claim in the styleguide
must point at evidence in the owner's text. A styleguide invented from taste is the same fraud
as an invented number.

## Step 1. Collect the sample

Ask the owner which artifacts are the reference (or take the declared `canonArtifacts` from
`.kaif/kaif.json`). Prefer text the owner WROTE over text the owner merely accepted. If the
sample is thin (< a few pages), say so — a thin sample yields a thin guide, and the owner should
know which rules rest on how much evidence.

## Step 2. Extract, with quotes

Work through the sample and extract, each item WITH a quoted example from the owner's text:

1. **Registers** — which voice serves which content (e.g. dry codex-register for mechanics,
   narrative register for lore; the owner's own split, not a textbook's).
2. **Reference examples** — 3–7 short quotes that ARE the style: sentence shape, rhythm,
   how terms are introduced, how numbers/tables are presented.
3. **The dictionary: one concept — one word.** Every domain concept mapped to the OWNER'S term;
   every synonym the owner does NOT use goes to the forbidden list (synonym drift is how canons rot).
4. **Formatting conventions** — headings, capitalization, list punctuation, number formats,
   how formulas/stat blocks are laid out.
5. **Anti-patterns** — what the owner's text never does (filler phrases, hedging, marketing tone…),
   each with the evidence "absent from the sample / removed by the owner in commit X".

## Step 3. Split the rules: lintable vs judgment

Mark every extracted rule:
- **LINTABLE** — checkable by grep/script: forbidden synonyms and filler markers, banned
  constructions, "a formula without its where-block", heading-case violations, register-marker
  words in the wrong document type. These become lines in the canon linter (its template ships
  with the framework) — list them in a machine-friendly table: `pattern → message`.
- **JUDGMENT** — tone, rhythm, taste: stays in the guide for strong-model passes and the owner's
  proofreading. Never pretend judgment rules are enforced — say plainly which ones nothing guards.

## Step 4. The owner approves — then it binds

File the guide as a document next to the canon it governs (e.g. `rules/STYLEGUIDE.md`), marked
with your provenance marks like any AI text in owner territory. Hand it to the owner with ONE
question per genuinely ambiguous register choice (not a quiz — you did the work; they veto).
After approval: the guide is binding for every future write into that canon; the lintable rules
go into the linter the same day (a rule without its guard is a wish, not a rule).

## Notes

- Re-derive incrementally: when the owner writes something new that contradicts the guide, the
  OWNER is right — update the guide and its linter lines, never "correct" the owner's text.
- Strictness modes: deriving/updating the guide is strong-model work; RUNNING the linter is any
  model's work — that split is the point.
