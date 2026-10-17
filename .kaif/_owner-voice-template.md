# The Owner's Voice Portrait — <OWNER> ("the stylistic LoRA" of krinikcam)

> **Canonical file: `AUTHOR_STYLOMETRY.md`, in the project root** — the DEFAULT name for a KAIF
> deployment, so that every reference (router, checklist, pipeline prompt) points at ONE string and
> any later agent finds the portrait without asking. What you are reading is the empty SKELETON
> shipped to `.kaif/_owner-voice-template.md`: COPY it to the canonical name and fill the copy —
> never fill the skeleton in place. The portrait is OPTIONAL: no portrait taken, no file, and
> `check` never reddens for its absence. A deployment that keeps a different name RECORDS that name
> in `KAIF_FRAMEWORK.md` (and, for the shipped linter, in `.kaif/kaif.json` → `voicePortrait`) — the
> machinery never renames an owner-class file. **Load, do not consult:** before the first word of any
> text the owner reads as his own, `node .kaif/tools/kaif-voice-lint.mjs load` prints the filled
> portrait's writing sections (§0 · §2 · §2-C · §5 · §6 · §7 — keep their numbers; `--all` prints the
> whole) into the agent's working context and leaves a witness; `check` refuses a text written before
> that load (the owner's word: write BY the stylometry, with it in the working cache).

> **Status: a BINDING instruction** for any agent writing <the owner's target artifact>. It acts
> together with the styleguide (if one exists): STRUCTURE lives in the styleguide, LANGUAGE lives
> here. This skeleton IS the methodology — fill the sections, never invent your own structure
> (a portrait written freestyle reads beautifully and does not work; field-proven).
> Written in the LANGUAGE OF THE ARTIFACT; a bilingual owner gets one portrait per language —
> rules never transfer between languages without their own quotes (features are language-bound).
>
> Living document — versioned, never DONE-tagged. A rule the owner rejects twice in practice is
> DELETED, not defended — and the deletion is a row in the **portrait journal** (§9): the history of
> this document is never rewritten in place.

## Corpus registry

The registry lives HERE, inside the portrait — never in a foreign document: a registry kept
elsewhere is orphaned the moment its host is renamed or closed (field: a portrait pointing at a
registry inside another epic's closed idea file). Rows are APPENDED, never rewritten — a source that
lost weight is marked, not deleted — and a new row is written together with its journal entry (§9).

> **Corpus registry** (filled by `/owner-voice` portrait mode, via `/interview`):
> | source path | what it is | weight | what we take from it (the owner's own words, verbatim) | confirmed by owner |
> |---|---|---|---|---|
> | `<path>` | `<same genre, pre-AI / finished work / current / foundation / historical>` | `<highest…low>` | `<e.g. "the language, NOT the formatting rules described in it">` | `<yes/pending>` |
>
> **🚧 The corpus gate:** at least TWO independent finished texts by the owner, ~15–20k words total
> (science floor: ~2,500–5,000 words minimum — below it any attribution method is noise), at least
> one in the target artifact's genre. Less corpus → this document is DRAFT OBSERVATIONS, never
> cited as canon, and rewrite mode does not start. No historical texts → the "innate" mark is not
> used at all (there is no separator), and the portrait says so aloud.

## 1. How to read this document

Five points, filled: binding force · the work boundary (rewrite only inside provenance marks) ·
register choice (which register applies to which artifact) · the self-check checklist before any
handover · calibration by the before/after pairs (§6) — the hand is calibrated on pairs, not on
descriptions.

**Modules and addresses.** Every section is a MODULE addressed by its full heading line — the
signature anchor the framework already uses for its templates: nothing is added to the document, and
line numbers are never cited. Hence: one rule = one `###` heading carrying a STABLE ID (`R7`, `M12`);
headings stay unique inside the file; a second or third register keeps its own anti-portrait, its own
before/after pairs and its own checklist layer as its OWN `###` modules in the same series; an ID is
never renumbered and a retired ID is never reused — the rules cross-reference each other by ID, so
renumbering is exactly what makes one edit reach every other module. A module is edited ALONE, and
the file GROWS by adding modules (a new register, a genre profile), never by rewriting its neighbours.

## 2. The portrait — register <PRIMARY>

**R0. THE DOCUMENT SKELETON** — how a chapter/section/clause/formula/example/table is built.
(A foreign hand is recognized by the skeleton before the vocabulary; this rule comes first.)

**R1…Rn. The rules** — syntax · voice and person · condition-first ordering · nomination instead
of pronouns · repetition instead of synonymy · the clause template · how an example is built ·
modality · punctuation · micro-typography · case enumeration · the limits of permitted liveliness.

Each rule: the operational formulation + **≥2 verbatim owner quotes with addresses**
(`file:line` or source section). A rule without quotes does not enter the portrait.
Mark ✦ = a feature alive since the earliest texts (the innate core — never touched).

> Science note: the load-bearing signal lives in FUNCTION WORDS, affixes and punctuation habits —
> not in catchphrases (catchphrases are topic-bound content and expose imitation first). Prefer
> rules about the small unconscious machinery over rules about favorite words.

## 2-C. The collocation lexicon

Table: turn of phrase → its verbatim source quote. Requirement: use EXACTLY, synonyms forbidden.
**≥20 rows** or the section names its own thinness aloud.

## 3. The portrait — register <SECOND> (if the owner has more than one)

The second register's rules + its OWN anti-portrait. ⚠️ One register's rules destroy the other —
they never mix. Use QUOTAS instead of bans ("at most one short punch sentence per 4–6 periods").

## 4. The foundation (schooling/industry): where the owner equals the source — and where they are LIVELIER than it

The second half is mandatory: without it the agent over-dries the text into officialese. No
nameable foundation → the section is declared absent aloud and sharpness expectations drop.

## 5. The anti-portrait: AI markers and their antidotes

Table: marker (with a quote FROM THE ARTIFACT BEING REWRITTEN) → "instead of X write Y".
**≥10 markers.** This is half the portrait's value: the marks that survive after every styleguide
ban is already satisfied (the aphorism-proverb close · "headline thesis + body" · the "not X but Y"
antithesis as a thought template · parcellation · pseudo-precision · entity personification).
Watch the documented drift: an LLM "improves" the author — richer vocabulary, smoother rhythm —
so quotas on variety belong here too.

## 6. BEFORE/AFTER: calibration pairs

**≥8 pairs for the primary register, ≥3 per additional one.** A real bad-text quote → its rewrite
by the portrait. This is the document's heart: few-shot on the owner's own material is what
actually moves a model — descriptions alone do not.

## 7. The self-check checklist (layered)

The checklist is the INDEPENDENT check that follows writing BY this portrait — the text is first written
by §2/§2-C/§5/§6, then checked here, then fixed, and only then it counts as written and goes to the owner
(`AGENT_GUIDE.md` → the fable loop's fourth KAIF obligation). 7A — the machine minute:
`node .kaif/tools/kaif-voice-lint.mjs check <file…> --genre <genre>` — the shipped module runs the §8 table (stop-patterns
and required positives) over the artifact and prints every hit with the row's hint; `SKIPPED` is said in
the report, never read as green. 7B — the semantic pass by a CLEAN instance (a subagent, or a fresh pass
forbidden to see the writer's rationale) against the anti-portrait and the pairs. 7C — the second
register's pass. **≥3 layers; every item checkable by an action**, never by "does it sound like the owner".

## 8. Machine heuristics

**≥10 grep patterns** of stop-constructions and positive markers whose ABSENCE is itself a signal;
each names its legal exceptions. For inflected languages the pattern covers word forms, or the
grep stays silent. They live HERE, as the table below — the owner edits the patterns where he reads
them, and the shipped linter reads THIS table (`node .kaif/tools/kaif-voice-lint.mjs check <file…>`):
prose in this section is invisible to it, and a §8 without the table makes the linter say `SKIPPED`
aloud rather than pass green. Calibrate on the live artifact first (`--warn` prints the hits without
reddening); noise above signal = the row is narrowed or deleted, never the guard weakened. A row that belongs to one genre
OPENS its hint with a label — `[work]` (every genre but the essay), `[document]` (documents only), `[prose]` (the essay only);
`check --genre <document|ticket|comment|message|reply|essay>` silences the rows of other genres, a row without a label judges every text.

| pattern | class | hint | legal exception |
|---|---|---|---|
| `<regular expression in a code span — word forms spelled out; \| inside the cell is alternation; /…/i opts into case-folding; \b is Unicode-aware>` | `<stop / positive>` | `<what to write instead, in the owner's own words>` | `<a /regex/ that silences a hit on its line, or prose the reader weighs>` |
| `<second example: \b(remember that\|note that)\b>` | `<stop>` | `<state the rule; the reader is not reminded>` | `<— (none)>` |

Column contract: **pattern** — a regular expression (ripgrep habits work: `\|` is alternation inside
the cell, a bare pattern is case-sensitive, `/…/i` folds case, `\b`, `\B`, `\w` and `\W` are
Unicode-aware — except `\W` INSIDE a character class, which stays ASCII: write `[^\p{L}\p{N}_]` there);
**class** — `stop` (a hit is a finding) or `positive` (a marker whose ABSENCE in the whole file is a
warning); **hint** — printed with every hit, in the owner's own words; **exception** — a `/regex/`
silences hits on a matching line, prose is printed beside the hit for the reader to weigh. A row whose
pattern is a `<placeholder>` is not a rule; fenced code, inline code and HTML comments in the judged
file are invisible. The linter judges these explicit patterns only — likeness stays the owner's verdict.

## 9. Portrait journal — how this document changed (append-only)

The portrait lives for years and keeps being fed; without a journal only the VCS remembers why a rule
reads the way it does. Every change lands here as a NEW row, newest on top — a recorded row is never
edited to say something else, and a correction is a NEW row that references and supersedes the old
one (the same chronicle discipline as `PROJECT_HISTORY.md` — do not restate it here). Nothing to
record IS a record: name a quiet period aloud.

| when | what changed | source | who asked |
|---|---|---|---|
| `<YYYY-MM-DD HH:MM ±HH:MM>` | `<the heading anchors touched — "§2 R7 added · §5 M12 superseded by M18">` | `<the corpus source fed in, or the owner's remark, quoted>` | `<owner (verbatim) / agent / blind test>` |

One row per: a corpus source fed in (its registry row is written in the same minute) · a rule added,
narrowed or DELETED (a deleted rule's ID is retired, never reused) · an owner remark that re-voiced a
place · a blind-test round and its verdict. A stamp is a MOMENT — date AND time in the owner's local
clock (`AGENT_GUIDE.md` → "A stamp carries the DATE AND THE TIME"); an unlogged minute is an honest
`≈ …`, never an invented one.

## Appendix: the hierarchy when in doubt

Which corpus wins on divergence; what to do with the owner's own variability.

---

> **Thresholds recap (below them the portrait is a DRAFT and rewrite mode does not start):**
> ≥10 rules (one being the skeleton) · ≥2 quotes per rule · ≥20 collocations · ≥10 anti-portrait
> markers · ≥8/≥3 before/after pairs · a ≥3-layer checklist · ≥10 machine heuristics.
> Empty sections do not exist: nothing to write IS a finding — name it aloud, never skip silently.
