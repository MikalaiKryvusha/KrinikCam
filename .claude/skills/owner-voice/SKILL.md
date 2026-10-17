---
name: owner-voice
description: Take a stylometric PORTRAIT of the owner's written voice from their own texts and rewrite a project artifact by it, so AI text sounds like the owner's text. Three modes — portrait (capture the voice), rewrite (re-voice an artifact under machine-checkable invariants) and check (the machine half of the independent check that follows writing BY the portrait). The writing contract for any text the owner reads as his own — written BY the portrait, then checked independently by it, fixed, only then written and brought to the owner. Use when the human says "make a portrait of my style", "write like me", "this is not my language", "перепиши моим голосом", "это не мой язык", "match my voice" — AND ON YOUR OWN INITIATIVE when the owner rejects a text over its language or style for the SECOND time: that is the signal that styleguide bans are not working and a portrait is needed. Field-proven methodology (one field project, then applied cross-project); the portrait skeleton ships as .kaif/_owner-voice-template.md. The filled portrait is a separate OPTIONAL canon file: AUTHOR_STYLOMETRY.md. Trigger aliases (ru): «портрет моего стиля», «пиши как я», «это не мой язык», «перепиши моим голосом», «проверь голос», «сверь со стилометрией»
---

# /owner-voice — the owner's voice

A styleguide is a set of bans and structure demands: it answers "what not to write" and does NOT
restore a voice — a whole field epic went through a full styleguide pipeline and the owner still
said "this is not my language". The cure is a different instrument class: a POSITIVE portrait
("a stylistic LoRA") taken from the owner's own texts, where every rule is proven by their quote.
The portrait is a CANON document with a canonical name — **`AUTHOR_STYLOMETRY.md`** in the project
root: the agent writes it, the owner accepts it, and every later agent finds it without asking. It is
OPTIONAL — no portrait taken, no file, and no check reddens for its absence. The methodology is the
shipped skeleton `.kaif/_owner-voice-template.md`: **COPY it to `AUTHOR_STYLOMETRY.md` and fill the
copy**, never freestyle and never fill the skeleton in place — the blank and the portrait are two
different files.

**Why a portrait at all — the owner's own "soup" metaphor:** live human speech is a soup —
nourishing solids (meaning, connotation) generously wrapped in warm water, the optional "sugar" of
speech that makes it soft to swallow. An LLM is strongest exactly at MEANING, so its native text is
the strained solids alone: correct, densely packed — and no longer a soup but a porridge one can
choke on. A human proofreader feels that strain in every sentence, and the strain is what makes AI
text obvious. The portrait pours the OWNER's own water back — not random water, but his way of
thinking and speaking.

## When to invoke

- On the owner's ask; on the proactive trigger "second rejection over language".
- NOT for touching up three paragraphs — there, the writing contract below applies as it is (written
  BY the portrait, checked independently, fixed, then shown); the full ritual of `portrait`/`rewrite`
  starts at several units of work.
- The writing contract — EVERY time a text the owner signs or reads as his own is written (a rulebook
  chapter, a player sheet, a UI string table, site copy, a README section): the fable loop's fourth
  KAIF obligation (`AGENT_GUIDE.md`), spelled out in the next section; mode `check` is its machine half.

## The writing contract — by the portrait, independently checked, then the owner

The obligation "open the portrait and run its checklist" lived as prose in a checklist, and a field
agent rewrote a player sheet through seven rounds under the owner's eyes without opening the
portrait once; the owner caught it by the language ("how many times did you compare this text with
my stylometry?" — zero). His statement of the expected behaviour (origin, 2026-09-12, rendered from
Russian): **"the AI agent writes the text in the voice and by the rules the owner's stylometry
prescribes; after writing, by that same stylometry, the agent runs an independent check of what it
wrote, fixes it, and only then counts the text as written and brings it to the owner for approval."**
Three steps, in this order — and the report of the unit names each:

1. **Write BY the portrait — with it in your working context.** Before the first word:
   `node .kaif/tools/kaif-voice-lint.mjs load` prints the WRITING sections of `AUTHOR_STYLOMETRY.md` — the
   bans §0, how to read it §1, the rules §2, the lexicon §2-C, the anti-portrait §5, the before/after pairs §6, the checklist
   §7 (with `--genre essay` also the prose register §3) — INTO YOUR WORKING CONTEXT, names every other section with its weight and a ready `--sections`
   command (load one the unit needs; `--all` loads the whole portrait) and leaves the witness `.kaif/voice-marker.json`
   (your client cuts long tool output by bytes? `--out <file>` writes the same selection to a UTF-8 file outside the project
   tree — read that file whole before the first word);
   write by it while it is there — the owner's word: write BY the stylometry, WITH IT IN THE WORKING
   CACHE — the lexicon's turn of phrase, not a synonym; the skeleton of the section the owner uses; the
   register of the artifact. A draft written "natively" and re-voiced afterwards is the class this
   contract closes, not its execution: `check` refuses a text with no load witness or last written
   before the first load ("written past the portrait").
2. **Check INDEPENDENTLY by the same portrait.** Two halves, both named in the report: (a) the
   machine minute — mode `check` below (the §8 table; a `SKIPPED` is said aloud, never read as green);
   (b) the semantic pass §7B by a CLEAN instance — a subagent, or a fresh pass forbidden to see the
   writer's rationale, reading the text against the anti-portrait and the pairs (the judge of the
   `rewrite` pipeline, applied to one unit). The writer's own glance at its own text is not an
   independent check.
3. **Fix — only then it is written.** Every hit is rewritten by the portrait's hint or answered in the
   portrait's exception column (the owner's canon: his word or a journal row §9); only after that the
   text counts as written — and only then it is shown to the owner for approval, never before.

What the report of the unit carries: the portrait modules read before the first word · the command
line and its outcome (hits answered, or `SKIPPED` in so many words) · the clean pass and its verdict ·
the fixes made. `/fable-judge` hunts owner text past the portrait: written without it open, checked by
no independent pass, or shown before the fixes.

## Mode `check` — the machine half of the independent check

A rule that yields an artifact names the command that produces it — this is that command, the
machine half of step 2 above (the semantic half is the clean-instance pass §7B):

```
node .kaif/tools/kaif-voice-lint.mjs load [--all | --sections <regex>] [--genre <genre>] [--out <file>]   # step 1: the portrait into your context + the witness
node .kaif/tools/kaif-voice-lint.mjs check <file…> --genre <genre> [--warn]        # step 2, the machine half; genres: document · ticket · comment · message · reply · essay
```

- **What it reads:** the §8 TABLE of `AUTHOR_STYLOMETRY.md` (or the file named in `.kaif/kaif.json`
  → `voicePortrait`) — `pattern · class · hint · legal exception`, the form the skeleton
  `.kaif/_owner-voice-template.md` carries. The portrait is the single source of the patterns; the
  module has none of its own.
- **The witness:** `load` records `.kaif/voice-marker.json` (the moments taken by the tool — a
  history of loads, the portrait's path and sha, the sections printed; session state, ignored by git
  like the refresh marker; another portrait starts a new witness). `check` refuses a text with no
  witness, with a witness for another portrait, last written BEFORE the first load, or written MORE
  THAN AN HOUR after the last load before it (the hour rule of context refresh: the portrait had left
  the cache — reload before every unit) — "written past the portrait", exit 1, never muted by
  `--warn`; it warns when the portrait changed since the load. A bare `load` prints the writing sections
  (§0 · §1 · §2 · §5 · §6 · §7 with their subsections, §2-C among them; `--genre essay` adds §3) and its price in tokens, and names
  the rest — a portrait with none of them numbered is loaded whole, said aloud; `--all` loads the whole. A §8 row whose hint OPENS with
  a genre label judges only its genres — `[work]` every genre but essay, `[document]` only document, `[prose]` only essay (or
  the same words in the portrait's language — the module reads the Russian mirrors too) (2.8, origin issue #102: work-only rows stopped the owner's prose 214 times of 217); `check --genre`
  silences the rows of other genres, and without it every row judges every text and the run says the labels exist;
  `load --sections <regex>` that matches no section loads nothing and writes no witness. The witness is a marker with the marker class's
  boundary: it proves the load ran, not that the print was read — the judge reads the named modules
  against the text.
- **What it prints:** every hit as `file:line — «fragment» → hint (exception: …)` and exits 1; a
  clean file exits 0 with the count of lines judged; a `positive`-class row absent from the file is a
  warning. `--warn` prints the hits and exits 0 — the calibration mode ("warning mode first; noise
  above signal = no guard"). A row's `/regex/` exception silences a hit on its line; prose is printed
  beside the hit for you to weigh.
- **`SKIPPED=3` is an outcome you REPORT, never a pass:** no portrait · no §8 section · a §8 without
  the table (greps as prose — move them into the table) · a table with placeholder rows only. The
  report line for the show says "voice check: SKIPPED — no portrait" in so many words.
- **On a hit:** rewrite by the hint; a hit that is legal in this place is answered in the portrait's
  exception column (the owner's canon, so his word or a journal row §9), never by silencing the rule
  or deleting the row — that is a weakened check, and `/fable-judge` hunts it.
- **Boundary, said every run:** likeness is not judged — "sounds like the owner" is the taste class
  and the owner's verdict; the command catches only the explicit patterns of §8. The semantic pass
  (§7B) and the owner's eyes remain.
- **Wiring:** a text class with a build script (a sheet generator, a string table, a README section)
  runs the command inside the script — a hit stops the build or is answered (the deployment task
  `owner-voice` of the installer asks for exactly this); a text without a script runs it by hand
  after writing, before the text counts as written (`AGENT_GUIDE.md` → "Showing is an action").
- **What the command is NOT:** it is not the writing step (the text is written BY the portrait first,
  step 1 of the contract) and not the whole check (the clean-instance pass §7B is the other half).

## Mode `portrait` — capturing the voice

1. **Corpus registry, via `/interview`** (asynchronous — work continues on what is already in the
   repo while the owner answers; such sources are marked "pending confirmation"). Ask by SOURCE
   CLASSES the owner won't recall unprompted: same genre pre-AI (highest weight) · any finished
   released work · current unmarked text · the foundation they LEARNED to write from · historical
   "embarrassing" texts (low weight but the only INNATE/ACQUIRED separator). Record the owner's
   restrictions VERBATIM in the registry ("take the language, NOT the formatting rules") — without
   that line the agent hauls content instead of style. Late additions are the NORM: a new source =
   a new analyst pass + a re-synthesis, never a restart. **The corpus gate** (thresholds in the
   skeleton) decides whether this is a portrait or only draft observations.
2. **One analyst per source** (same dimensions: syntax · lexicon · structure · punctuation/rhythm ·
   morphology; an observation without a verbatim quote is not accepted) **+ a separate
   ANTI-PORTRAIT analyst** on the AI text already in the artifact: what still sounds like AI after
   every formal ban is satisfied. That is half the value.
3. **Synthesis into the skeleton + an adversarial completeness critic** with the one question:
   *"could a weak session, armed with ONLY this document, write text the owner takes for their
   own?"* — returns "complete" or the list of holes.
4. **Acceptance by BLIND TEST** (the honest eval): 6–10 unlabeled fragments, half genuine
   owner texts NOT in the corpus, half agent texts by the portrait; the owner marks "mine / not
   mine"; accepted when they cannot tell better than chance. Every correct catch becomes a new
   anti-portrait row.
5. **The weave-in — a handover gate, all five points:** context router (task type "writing into
   the owner's artifact" ⇒ read the portrait) · the before-every-task checklist · the sphere
   library's binding evidence set · the artifact's styleguide (if any) · a machine guard in
   WARNING mode (calibrated on the live artifact first; noise above signal = no guard).
6. **Upkeep:** the portrait is alive and versioned, never DONE. Every owner edit at review is
   input: a rejected wording becomes an anti-portrait row; a rule rejected twice is deleted, not
   defended. Ripened machine heuristics graduate into a guard.
   **Feeding — the standing procedure, two entrances:** a NEW owner source, or the owner's "this is
   not my language" against a concrete place. Both run by the late-additions rule of step 1 above —
   it is stated there once and not restated here: a source is first written as a ROW into the corpus
   registry (with the owner's verbatim restriction) and then gets its analyst pass; a remark starts with an
   anti-portrait pass on the rejected place. Re-synthesis touches ONLY the modules that pass hit —
   a portrait is edited module by module, never regenerated, and a new genre is a new REGISTER
   inside the file, never a second document. Every feeding closes with a row in the portrait journal
   (§9): append-only, an older row superseded and never rewritten. A corpus from a genre the
   portrait has not covered is honest new ground — say so aloud in the new register.

## Mode `rewrite` — re-voicing an artifact

**Applicability gate first:** the pipeline assumes a TEXT artifact under version control with a
line diff. Slides/CMS/cloud doc → either convert with a PROVEN round-trip (export → edit → import
→ compare, tested on one unit BEFORE starting) or don't start; edit fragment-by-fragment via the
owner instead.

**Provenance is the precondition:** only text marked as AI-written is rewritten (the marks turn
"make it pretty" into a machine-bounded task: rewrite inside, not a character outside). Owner text
edited by AI (`[AI-ed]`) is NOT rewritten — only spot-removal of explicit anti-portrait markers.
No provenance? The ladder: (a) a pre-AI revision exists → machine-mark the diff from it; (b) the
owner names the last revision they vouch for (via `/interview`) → everything after gets marked;
(c) no history at all → **marks are never invented backdated** — rewrite mode is unavailable;
do `portrait` + "all new AI text under marks from now on"; the existing artifact is edited
fragment-by-fragment at the owner's direct word.

**The pipeline is a DELTA to `/fable-loop`** (do not restate it: rewriter writing BY the portrait →
mode `check` over the unit (zero hits, or every hit answered) → adversarial judge, separate instance,
reads the diff LINE BY LINE against the anti-portrait and the pairs → up to two repair rounds →
verified → invariants check → one commit per unit — the writing contract above, per unit). New here
is only: the provenance gate, the machine minute, the invariants ladder, and the no-meaning-fixes rule. The judge checks TWO things separately: meaning identity (numbers,
formulas, references, enumerated cases) and portrait conformity (by the anti-portrait and pairs).

**Invariants named BEFORE work, shown after** — the ladder, top to bottom:
1. universal minimum: text outside marks byte-identical to the previous revision + the FACT
   INVENTORY of the unit (sorted lists of numbers · proper names/terms · references · enumerated
   cases, before vs after — the diff of the two lists is empty; this is the parity-inventory craft
   under its existing name);
2. sphere bonus where it exists: linter · build · tests · byte-identical machine-consumer output;
3. neither available → the work is NOT handed over as verified: it carries `[NOT-TESTED]` and goes
   to the owner as a draft.

**Waves of 4–6 units, one commit per unit** (the only thing that survived three network drops in
the field). After a crash: revise the tree — keep what's whole, roll back what's broken, never
commit what wasn't judged; the resume list SHRINKS PHYSICALLY to the undone (a stale resume cache
happily rewrites accepted work).

**Meaning holes found while rewriting are NEVER fixed in passing** — they go to a suspicion list,
and a VERIFICATOR with the live text and the decision docs stands between the list and the backlog
(field: 75 suspicions → 8 real docs + 43 refuted; without the verificator the backlog gets half
garbage). Rejects are recorded WITH reasons.

**Handover — the self-review loop:** assemble the artifact → LOOK at it with eyes (render it if
visual — and prove the render path works BEFORE the first edit, not at handover) → not satisfied →
fix → look again → … → satisfied → report. Green checks are not a handover.

## What this skill forbids

- Starting with rewrite before a portrait exists (a lost epic in the field).
- A portrait rule without an owner quote; an empty skeleton section skipped silently.
- Fixing meaning under the guise of style; touching provenance marks.
- Declaring done without the named invariant shown and without eyes on the artifact.
- Transferring rules between languages or registers without their own quotes.

## Notes

- Frauds of this ritual live in the sphere fraud tables as ONE row ("Voice without a corpus");
  the rest are hunted by `/fable-judge` via its standing hunts (meaning drift = weakened checks;
  removed marks = provenance fraud).
- The judge is a separate agent instance; a harness without subagents runs the judge as a clean
  pass strictly by the critic checklist, forbidden to look at its own rationale.
