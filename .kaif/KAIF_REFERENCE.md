# KAIF Reference — the explanatory note

This document is the COMPLETE technical reference of Krinik AI Framework (KAIF): every module
of the framework is named, defined and located here, and the internal terminology is established
here. It is written for two readers at once: the human who wants to understand what is deployed in
their project, and the AI agent that must answer such questions precisely (`/help-kaif` reads this
document and cites its sections). Statements of obligation use "shall"/"never"; statements of
permission use "may". Section numbers are stable addresses: cite them as "Reference §N.M".

The one-glance essence: KAIF externalizes an AI agent's working memory and discipline into the
repository itself — documents, directories and skills that any fresh session reads to resume with
full context. Everything mechanizable is done by machinery; the agent's cognitive work is reserved
for understanding the project and making judgment calls.

## 1. Terms and definitions

| Term | Definition |
|---|---|
| **Payload** | The set of canonical templates deployed into a target project. Single source: the origin repository's `framework/` directory. |
| **Wrapper** | The framework applied to a concrete project: the deployed documents, directories and skills, plus the project's own knowledge base. |
| **Core (thin)** | `KAIF.md` — the ~150-line entry point: a three-step bootstrap that fetches the installer machinery. Transient in the target project. |
| **Machinery** | `KAIF-CORE.mjs`, deployed as `.kaif/kaif-core.mjs` — the installer/updater executable that performs every mechanizable step. |
| **Bundle** | `KAIF-CORE-BUNDLE.md` — every deployable file as `FILE:` blocks plus one meta block (§8.2). |
| **Module** | A logical section of a template — the atom of diffing and replacement (§9). Everything from one heading line to the next; the text before the first heading is the `<preamble>` module. |
| **Signature anchor** | A module's address: its full unique heading line. Nothing is added to documents; line numbers are derived, recomputed on every build. |
| **Module class** | `static` — upstream-owned, mechanically replaceable · `adaptive` — carries project values, replaced with value transfer · `owner` — the owner's content, never in the machinery's scope. |
| **Module map** | The generated inventory of all modules with anchors, classes and hashes: `kaif-module-map.json` (§9.1). |
| **Template sha / disk sha** | Two snapshot provenances: what THIS framework version deploys (post-fill, EOL-normalized) vs. what lies on disk. Only a template-sha match authorizes mechanical replacement. |
| **Adoption (kept)** | Taking an existing file as found instead of writing the template. An adopted path's snapshot is owner content and never authorizes replacement. |
| **Synthetic baseline** | A template snapshot reconstructed from the OLD version's own release artifact, used when a deployment carries no snapshots (§10.4). |
| **Marker** | `.kaif/kaif.json` — the deployment record (§12.1). |
| **Deploy manifest** | `.kaif/deploy-manifest.json` — the deployment's snapshot ledger (§12.2). |
| **Receipt** | `.kaif/last-update.json` — the permanent proof of the last update (§12.3). |
| **Owner** | The human whose vision the project serves. The owner's word outranks every document. |
| **Canon artifact** | An owner document whose wording IS the content (rules, lore, brand texts). AI text enters it only marked (§13.3). |
| **Contour** | A top-level logical module of the system or of the methodology itself: a complete closed stack of context on one direction — boundaries · governance · execution layer · quality control (`AGENT_GUIDE.md` → Contours). |

## 2. Design principles

1. **Externalized memory.** State lives in files, not in a chat: a session may die at any moment
   and the next one shall resume from the repository alone.
2. **Bounded autonomy.** The agent decides what is cheap to revert; vision-level decisions belong
   to the owner and travel through interviews.
3. **Mechanize, then trust.** Whatever can be checked by code is checked by code; conventions are
   backed by guards, and a guard is proven able to fire before it is trusted.
4. **Respectful by construction.** The machinery never overwrites what it cannot prove it
   deployed; the owner's content is byte-inviolable across every operation.
5. **One source, many surfaces.** Every template lives once in the payload; deployed copies and
   per-system mirrors are derived mechanically.

## 3. The two layers of the origin repository

The origin repository is fractal: it IS the framework and is WRAPPED by it. Layer one — the
payload (`framework/`), generated into the distribution artifacts. Layer two — the origin's own
wrapper (root documents, `.claude/skills/`, knowledge directories) — the framework applied to the
framework. Deployment into user projects flows ONLY from the distribution artifacts, never from
the origin's wrapper.

## 4. Distribution artifacts

Each release attaches six artifacts (their roles are machine-readable in `kaif-manifest.json`; the loader fetches and pins by sha256
exactly the two it executes — the core and the bundle):

| Artifact | Role |
|---|---|
| `KAIF.md` | The thin entry point; transient in the target project. |
| `KAIF-CORE.mjs` | The machinery; survives as `.kaif/kaif-core.mjs` (except on anonymous deployments, §11.3). |
| `KAIF-CORE-BUNDLE.md` | The COMPLETE deployable set: documents, skills, spheres, optional tool modules, the optional refresh-hooks module, language packs. |
| `kaif-manifest.json` | Version, codename, sha256 pins of the fetched pair, asset roles. |
| `KAIF-FULL.md` | The offline fallback core — a SUBSET (no language packs/spheres/references); not an authoritative diff baseline (only a last-resort candidate for a synthetic one, §10.4). |
| `kaif-module-map.json` | The generated module inventory (§9.1) — informative: the machinery splits modules itself, so it is neither fetched nor pinned. |

## 5. The document system

Fourteen key documents ship with a deployment (thirteen project documents plus this reference):

| Document | Purpose | Written by |
|---|---|---|
| `AGENT_GUIDE.md` | The canon: rules, map, commands, conventions. | Machinery deploys; agent adapts. |
| `PHILOSOPHY.md` | How the agent thinks: simplicity (KISS + Occam) and the wider principle set. | Deployed verbatim. |
| `BUG_FIXING_FRAMEWORK.md` | How defects are fixed: intent gate, 3-attempt rule, twin check, class-not-instance, guards. | Deployed verbatim. |
| `TESTING_FRAMEWORK.md` | Nothing raw is trusted: the `[NOT-TESTED]`/`[TESTED: …]` contract, observation gates. | Deployed verbatim. |
| `REQUIREMENTS_FRAMEWORK.md` | How requirements are written and checked: goal vector + acceptance criteria first, the ten quality criteria, EARS, fit criterion, the stop-word dictionary as a lintable guard (2.2, epic N). | Deployed verbatim. |
| `GOAL.md` | The owner's vision. | **The owner.** |
| `MASTER_PLAN.md` | The phased road from the current state to the GOAL. | Agent derives (`/revision`). |
| `STATUS.md` | The living SUMMARY of now and the handover between sessions (soft target ~200 lines — the first of the re-read core's size budgets that `check` warns above, all nine since 2.5; since 2.7 the budget counts the project's OWN lines and the warning names the chronicle as the address; closed work moves to the chronicle — the bonsai trim, and `check --gate-budgets` is the door the closing ritual runs after it; since 2.8 the door is a ratchet over the committed `.kaif/budget-baseline.json` — a document above budget passes only while its own lines shrink). | Agent, after every task. |
| `PROJECT_HISTORY.md` | The append-only chronicle: closed sessions/phases/releases, newest first; NOT in `/resume`'s canon set — archaeology on demand (2.1, epic H). | Agent, at `/end-chat-soft`'s trim. |
| `EXPERIENCE.md` | The grep-friendly journal of lessons with trigger tags. | Agent (`/experience`). |
| `PROJECT_STRUCTURE_EXTERNAL_MAP.md` | The external map: directories, files. | Agent maintains. |
| `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` | The internal map: abstractions and interactions. | Agent maintains. |
| `KAIF_FRAMEWORK.md` | "KAIF, deployed here": the deployment record page. | Agent, after injection. |
| `KAIF_REFERENCE.md` (this document, at `.kaif/`) | The complete framework reference. | Deployed verbatim. |

One OPTIONAL canon document joins the fourteen only when it is earned: **`AUTHOR_STYLOMETRY.md`** in
the project root — the owner's voice portrait (`/owner-voice`), written by the agent from the owner's
own texts and accepted by the owner. It ships as a SKELETON (`.kaif/_owner-voice-template.md`), never
as a filled file or a stub: a deployment without a portrait is complete and `check` stays green. Its
history is kept INSIDE the file, append-only (§9 of the skeleton), and its §8 is a TABLE of machine
heuristics (pattern · class · hint · exception) that the shipped linter `kaif-voice-lint` reads as the
machine half of the independent check after a text is written BY the portrait (2.7, epic VC: written by
the portrait → checked independently by it → fixed → only then written and brought to the owner). Two
bundle-only skeletons of the
same family serve the testing canon: `.kaif/_testcases-template.md` (2.3 — the case set per feature,
`TESTING_FRAMEWORK.md` → the activities chain) and `.kaif/_testrun-report-template.md` (2.7, epic TR —
the seven-field report an EXECUTED run leaves at `<testdocs>/reports/<YYYY-MM-DD>_<work>.md`;
`TESTING_FRAMEWORK.md` → "An executed run produces its report"). A fourth skeleton (2.8, epic CK; origin issues
#89 #90) gives tier 4 of the document taxonomy its file: `.kaif/_house-rules-template.md`, copied to `HOUSE_RULES.md`
at the project root on first use — a standing rule of the owner (`/fix-vision` step 3), a route or recipe worth
keeping, a project-subject section moving out of an over-budget guide; the copy is the project's, `/resume` reads it
at entry, and it is not one of the fourteen key documents. Since 2.8 it is also where the guide's project FACTS live —
the stands and harness commands, the environment dossier table (`/refresh-context` regenerates it there), the tools
table and the push recipe — while the guide keeps the method and one pointer line per section. One more
bundle-only page of the same family (2.6, epic IC; origin issues #19 #38 #47 #51): **`.kaif/INTERACTIVE_CONTOUR_SPEC.md`**
— the one-page executable CONTRACT of the owner-facing interactive contour (the two legal option forms,
the pre-flight that refuses a page without radio buttons with exit 3, the three records and the fact of
showing, outcomes and exit codes, the call, the faces and flags of the shipped generator under
`.kaif/tools/contour/`). The form check is a door of its own — `review.mjs <doc> --check`: parse,
pre-flight and render self-check with no server, no sound and no call (2.7, epic QL, origin issue #56) —
and that door has a SECOND axis, the ARCHAEOLOGY of every live question (2.7, epic AQ, origin issue #70:
13 questions brought to one owner that his own prior answers had already settled, one of them 44 days
after his answer). A question to the owner is a CLAIM that the matter is not settled, so a live question
of a document dated on or after `2026-09-18` opens only with the attestation of the search that was run —
`<!-- archaeology: grep -rniE "<the heading's words>" interviews/ GOAL.md MASTER_PLAN.md plans/ → N hits ·
read: <files|none> · prior: <none | "<the prior answer>" + address> -->` between the heading and the first
option; without it the door exits 3 and PRINTS that ready command, `N > 0` with `prior: none` is refused
too, `N = 0` is honest, and documents dated before that day are never judged (`--check` says which of the
two it did). Since 2.8 (epic OW, origin issues #74 · #82) the door searches itself for a question in ANY transport, a
chat question too — `review.mjs --search "<the question>"`, no shell and no locale (a capital Cyrillic letter was lost
by `grep -i` in Git Bash; the printed grep carries `LC_ALL=C.UTF-8`) — and `N > 0` with `read: none` is refused. `/interview` step 3d carries the same five steps for the agent's hand. It is not a skeleton to fill: a session checks a page against it in a minute,
and `/owner-reviews` says "run the shipped generator, do not build a contour". The generator itself ships
as three tool modules under `.kaif/tools/contour/` — `core.mjs` (parsing, records, pre-flight), `review.mjs`
(the page, the server, the call, the queue, the faces interview · notice · proofreading · mockup review, `--selftest`; since 2.7, epic IW — origin issue #64 — the server comes up on the previous run's port when that process is gone so the owner's browser draft is restored, names a taken port together with the loss, and the page reports when it lives in a tab instead of the app window; since 2.7, epic LP — origin issue #66 — `<doc> --close` is the only way to end a live page from outside: it reads the lock (port · pid · title · last input · draft state carried by the pulse) and refuses with exit 4 while the owner typed less than the quiet threshold ago, while the page is younger than it, or while a draft is unsaved — and it ends the page by asking the page's own server, never by killing a pid read from a file; the app window runs on its own browser profile in the project, `.kaif/contour-window/`, so an answer saved while the server was gone (IndexedDB is the primary carrier, durable half a second after the write) is picked up headless at the next queue, check or show — once no browser holds the profile — and recorded with `recovered: true`; an unknown flag refuses before any page, exit 1)
and `texts.mjs` (the RU/EN dictionaries and parser labels; other languages fall back to EN and the page says so) —
and reads every parameter from `.kaif/kaif.json`, never asking the owner.

Knowledge directories, each with its own README: `plans/` `ideas/` `bugs/` `researches/`
`interviews/` `homeworks/` `reports/`. Closed items take the `DONE` tag in the filename (§13.1);
research notes and reports are living records and are never tagged.

The documents divide into five tiers (the taxonomy canon lives in `AGENT_GUIDE.md` → Document
taxonomy): **KEY canon documents** — the re-read core of nine the agent re-reads on schedule
(`GOAL`, `AGENT_GUIDE`, `PHILOSOPHY`, `REQUIREMENTS_FRAMEWORK`, `TESTING_FRAMEWORK`,
`BUG_FIXING_FRAMEWORK`, `STATUS`, `MASTER_PLAN`, `PROJECT_STRUCTURE_EXTERNAL_MAP`) — a smaller
set than the fourteen shipped key documents above; **EXTENDED canon documents**, fetched on demand
by the context router; **WORKING canon documents** — the dynamic knowledge-directory documents,
each opening with the lintable header meta (H1 + `Created`/`Parent`/`Status`/`Outbound`, in the
project's working language); **OTHER KAIF documents** — the project's local "house rules"; and
**project working documents**, which belong to the owner's project, not to the framework.

## 6. The skill system

Thirty-seven skills — the verbs of project work — deploy to `.claude/skills/` (canonical) and are
mirrored into every declared agent system (§7.3). Groups:

- **Session:** `resume` (read ALL canon documents, pick one main thing) · `pause` (soft-park the
  chat: logical stopping point, green tree, local commit, NO pushes) · `end-chat-soft` (the unhurried full closure; since 2.7, epic SF — origin issue #67 — the farewell report answers `Standing falsehood: none` or names the statement and the places it was corrected in; the force closure carries the same line as one phrase) + `end-chat-force` (the urgent capture-and-go closure:
  STATUS handover, judge, commit AND push) · `refresh-context` · `check-backlog`.
- **Autonomy loops:** `autoloop` · `dayloop` · `nightloop` — grind the backlog; every item ends
  with a mandatory judge pass; an owner's drive-by note is filed to the backlog, not a task switch —
  plus `guarded-loop` (2.1): the same loop under a WATCHDOG (external wake-ups every N minutes,
  a work-proving heartbeat file, a restart policy with an escalation cap).
- **Knowledge:** `experience` · `report-bug` · `bug-research` · `propose-idea` · `interview`.
- **Owner contour (2.1):** `owner-voice` (a stylometric portrait of the owner's written voice from
  their own texts; portrait and rewrite modes, the skeleton ships as
  `.kaif/_owner-voice-template.md`, and the filled portrait lives at the project root as the
  optional `AUTHOR_STYLOMETRY.md`) · `owner-reviews` (the optional review contour: interviews and
  outbound drafts as local HTML pages, decisions recorded with `by`/`at`, sends gated fail-closed;
  the hard place-of-questions rule itself lives in AGENT_GUIDE).
- **Planning:** `plan-task` (one operational plan for an ordinary task; runs the heaviness test) ·
  `plan-epic` (the full ladder for heavy work: industry web-recon + local recon → research doc →
  meta-plan with phases → operational plan of the NEXT phase only).
- **Vision:** `revision` · `fix-vision` · `what-next` · `help-kaif` (reads THIS reference).
- **Canon writing:** `derive-styleguide` (§13.4).
- **Code quality (2.1):** `code-revision` — the periodic reading revision of the codebase by the
  strongest model: zoned parallel reviewers armed with the project's paid-for failure classes
  (EXPERIENCE + bugs), verbatim quote per finding, adversarial skeptic with the default verdict
  "not a defect"; survivors become bug docs and feed the guardrails. Since 2.2 the run also leaves
  audit reports in `reports/KAIF_AUDIT/` — one document per finding family plus a summary with the
  coverage map and the limits — and each finding is written as an eight-field contract a weaker
  model can execute (skeletons: the skill's `references/audit-report-template.md`). Rewritten by its
  executor in 2.7 (epic CR) and then proven by a functional run on a real zone: the reference now
  carries the reviewer and skeptic briefs and the effective-FP procedure, the newest summary that IS
  a revision is named as the run's baseline, and the seven places where the executor stopped were
  fixed in the text.
- **Shipping:** `release` (owner-confirmed only).
- **Execution discipline (vendored from fable-method, MIT):** `fable-method` · `fable-loop` ·
  `fable-judge` · `fable-domain`.
- **Lifecycle:** `kaif-version` · `kaif-update` · `kaif-fork` · `kaif-switch-origin` —
  origin-tied, skipped on anonymous deployments — plus `kaif-remove`, which is NOT origin-tied
  and ships on every deployment (removal must stay available to an anonymous owner too). Their
  headers state the current mechanical command first: an adopted copy of a lifecycle skill goes
  stale silently, and its staleness breaks the update itself — when prose and machinery disagree,
  the machinery and the origin release notes win.

## 7. Installation

### 7.1 The thin pipeline

`KAIF.md` (3 bootstrap steps with `KAIF-BOOT:` checkpoints) → the agent writes `KAIF-LOADER.mjs`
verbatim and runs it → the loader fetches `kaif-manifest.json` + the machinery pair, verifies
sha256 (a mismatch never installs) → hands over to `kaif-core.mjs install`.

### 7.2 What install does

Parses the bundle; applies the language pack (`--lang`; §7.4); autofills the canonical
placeholders from project reality (package.json, git config, LICENSE); writes files respectfully
(`writeIfNew`: an existing non-empty file is ADOPTED, never clobbered); deploys per-system skill
mirrors; wires the marker, npm handles and the deploy manifest (v2, §12.2); writes ONE cognitive
deliverable — `KAIF_ADAPTATION_TASK.md`, whose items close only via `checkpoint <id>` commands
(the `field-report` item requires the mandatory field install report to exist in
`reports/KAIF_UPDATES/` before it ticks; the `owner-voice` item closes the voice-portrait
question BEFORE any owner-facing text is written — portrait installed, or a canonical
`no voice portrait` line recorded in the deployed AGENT_GUIDE); `verify-final` runs the final
gates (§7.5) and self-cleans the installer.

### 7.3 Agent systems

Declared via `--agents` (default: claude-code, codex, grok-build, cline, zoo-code). The canonical
skill set lives in `.claude/skills/`; mirrors derive from it mechanically (`sync` command;
`update-verify` re-syncs automatically). Cognitive work lands in the canon only — a mirror is
never edited by hand.

### 7.4 Languages

Two language packs are MAINTAINED: `en` (the source language itself) and `ru`. The other eight —
es, pt, fr, de, zh-Hans, ja, hi, ar — are FROZEN at their full KAIF 2.2 state (owner's decision
#56, named in the open: nine parallel packs are heavy to maintain and do not yet pay for
themselves). A frozen pack STAYS in the bundle and deploys exactly as it did in 2.2 — the
owner-facing documents plus skill trigger aliases — but receives no updates with new releases;
its byte state is pinned by the origin's guard, so silent degradation cannot ride a release. A
frozen pack is REVIVED on community demand: open an issue at the origin. Deploying with one stays
legal, and the install log says its status honestly.

A pack overrides the owner-facing documents and injects trigger aliases into each skill's
`description:`. Agent documents stay English by default. A project that translated its wrapper
wholesale declares `"i18n": "translated"` in the marker: mechanical replacement is then disabled
in favor of per-module diffs, and the machinery never wars with the translation (§10.2).

### 7.5 The final gates

One sequence for every road (`verify-final` = `update-verify`): checkpoint grep (the judge tick
requires its verdict line) → placeholder scan across ALL deployed surfaces → anonymity leak scan
(§11.3) → marker self-heal from the manifest snapshot → mirror re-sync → disk-sha re-snapshot →
self-clean. Guarantees are a property of the deployed tree, not of the road taken to it.

## 8. The bundle

### 8.1 FILE blocks

Each deployable file travels as `> **FILE: \`<dest>\`**` + a six-backtick fence. The label is law:
the block's destination path is exact.

### 8.2 The meta block

`kaif-bundle-manifest.json` — data for the machinery, never written to disk: `version`,
`released`, `templateNotes` (current release), `templateNotesByVersion` (per-release news, printed
as the UNION of the update interval), `deprecations` (artifacts retired by this release, §10.5),
`moduleClasses` (manual class overrides), `policyChanges` (§10.6), `renamesByVersion` (headings
renamed by a release — §9.3), `build` (2.8: `sourceTree` — the fingerprint of the sources the bundle was built from; `prerelease` —
the newer version whose notes a build between releases already carries, else null; the marker records both, §12.1).

## 9. The module map

### 9.1 Generation

The build cuts every deployable markdown file into modules by signature anchors (headings outside
code fences; duplicate signatures fail the build) and emits `kaif-module-map.json`: for each file,
the ordered list of `{signature, class, sha256, lines}`. Classes are COMPUTED — owner-seeded
files → `owner`; a module carrying a canonical placeholder, or a skill frontmatter → `adaptive`;
all else → `static` — with rare manual overrides in `module-classes.json`. The build's splitter
and the machinery's vendored copy are pinned to identical behavior by an executed check on every
build.

### 9.2 Guarantees

Split-and-rejoin is byte-identical for every file (the build fails otherwise). The map is
validated against the bundle by re-splitting; a stale or tampered map fails the self-check.

### 9.3 Renamed headings (2.7)

A module's address is its signature — the full heading line — so renaming a heading looks, to an
update, exactly like removing one module and adding another. That ambiguity is not resolved by
guessing (neither does any migration system: an explicit declaration is the industry's answer), so
a release DECLARES its renames in the meta block: `renamesByVersion` → `{ '<version>': { '<template
dest>': [['<old heading>', '<new heading>'], …] } }`, applied over the `(from, to]` interval like
policy changes, with both hops of a twice-renamed heading kept so a tree that skipped one release
still finds its own. The merge binds each target to the hop that is actually ON DISK and then
treats the pair as ONE module: untouched → replaced under the new heading; carrying local edits →
your section stays, with ONE heading and a task item naming the rename; old anchor absent → a log
line by name, never a failure. Every outcome is logged as `renamed: <path> :: <old> → <new>`,
because silence leaves the owner unable to tell a rename from a delete-plus-add. The build warns
by name when a heading vanished from a template since the previous release with neither a rename
nor a deprecation behind it. The first hop INTO a release that declares a rename is the exception: that
update is run by the DEPLOYED older core, which does not read the map, so a section the owner edited under a
renamed heading arrives twice and the update task names it as "upstream removed" — the release notes and
the task tell the owner to fold it by hand once (2.6 → 2.7: `/end-chat-soft` and `/end-chat-force` Step 1,
`/code-revision` Step 0).

## 10. Updating

### 10.1 Classification

For every bundle file, against the deployment's snapshots: an owner file is never in scope (but a
changed owner TEMPLATE surfaces as an "owner-conventions" task item); a missing file is added; a
file whose disk sha equals its TEMPLATE sha is replaced (or kept if upstream did not change it);
a diverged markdown file undergoes the MODULAR merge. Equality is judged MODULO the hand-filled
slots (2.6, origin issue #48): a file that differs from its template only by the values the
adaptation task filled into slots the machinery could not fill (`<BUILD_COMMAND>`, `<TEST_HARNESS>`,
the co-author line) is untouched — the replacement carries those fills into the new template, and
a deprecated file of that shape retires mechanically. The fills are DERIVED from the disk (the
template matched as a pattern with one capture per slot; the proof is the exact sha of the disk
text with the fills folded back), cached in the deploy manifest as `fills`, never asked of anyone.

### 10.2 The modular merge

Reconstruction starts from the DISK order (the owner's inserted sections keep their place).
A module untouched since deploy takes the new template's text; a localized module is never
replaced by a template that carries none of the owner's script; an edited module is kept — and
lands in the task WITH a "your version → new template" diff ONLY when upstream actually changed
it (2.6: a module already equal to the incoming template — the deploy values healed since, e.g.
by `project-name` — is nothing to hand over and makes no item; the comparison is by the FILLED
texts, because the manifest keeps no raw template texts and the healing rewrites the fill map).
New template modules insert by template order. A file whose body carries the owner's
script prints its verdict WITH the numbers that produced it — `baseFound N of M, ceiling K →
frozen | merged` (2.5: a rehearsal and the live run compare line by line, not by outcome).
The H1 is OUT of that count (2.5, origin bug 100): it is the one heading that carries a deploy-time
value, and a synthetic baseline fills it from whatever the folder resolves to — one tree under two
folder names once got two verdicts, ±1 at the ceiling; the polygon now runs exactly that and
demands one verdict. The rehearsal is BINDING (2.5, origin issue #27 R1): `diff --source` prints the same verdicts
over the same candidate set (2.6: ONE predicate for both — an md file neither owner-seeded nor
skipped by anonymity — so the rehearsal file and the receipt count the same files; origin issue
#42) and records them in `.kaif/update-rehearsal.json`; the next `update` over that tree (or one
given `--rehearsal <receipt>` from a sandbox copy — on the bootstrap route the same flag rides the
loader's line into `install`, 2.6, and the auto record is consumed on both routes) freezes any file whose
live verdict is `merged` where the rehearsal said `frozen` — kept intact, the template delta in
the task, both number sets in the `verdict-mismatch` item — so what the rehearsal showed the
owner stays true; every candidate's verdict also rides the receipt (`verdicts`), and a record
for another version interval is named and ignored.
Anchored blocks — `<!-- KAIF:NAME:BEGIN -->` … `<!-- KAIF:NAME:END -->` (the creed, the prayer)
— are indivisible units (2.5, origin issue #27): the merge plan is judged as a whole, and a
pair that was balanced on disk but would come out unbalanced (its markers live in different
modules — one carrier applied, the other kept) rolls every changed carrier back to the disk
state and lands in the task as ONE item, `(anchored block KAIF:NAME)`, with the diff of all its
carriers; a NEW module whose insertion point falls inside a pair open on disk is inserted after
the module that closes it (a localized prayer cut into the owner's headings never receives
upstream text between its markers); a pair already broken on disk is not rolled back — the item
names it, and `check` reddens the document with the weight of a two-headed document until it is
restored by hand.

### 10.3 The update task

`KAIF_UPDATE_TASK.md` lists: per-module merges with diffs · whole-file merges (a
translated-wholesale file also names its UPSTREAM path and a ready `git diff v<from> v<to> --
<src>` — the dest → src map ships in the bundle meta as `sources`, 2.5) · owner-convention
transfers · deprecations carrying local edits (every deprecation names its SUCCESSOR in the log
and in the item, and the kept ones are counted in the task's context line and the receipt —
2.5, origin issue #32 R-D) · stale claims (lines asserting ANY version older than the one being
installed — not only the one just replaced: a one-version window let a README badge two releases
back survive three green updates, so a line stuck on an earlier version now names it, `(asserts
2.2)`, 2.6, origin issue #44 — anywhere in the project: prose AND the project's own scripts: `package.json`,
`*.mjs/js/ts/sh/ps1/py/yml/toml`, lock files excluded, 2.5; the item is UNCONDITIONAL on a
version change — an empty scan says `no lines found`, so a silent scanner failure can never pass
as a clean tree, 2.5; the files are the ones git sees — nested `.claude/worktrees` copies are not the project, a broken link is
skipped with a name, a directory or a file the walk could not read turns the item into «could NOT see the whole tree», 2.8, epic SC,
origin issue #77; a line correct by design takes `<!-- KAIF-VERSION-OK: reason -->` on it or on the line above, a table row inside
the row — the line above a row is another row, and its marker excuses only itself, 2.8, finding K-R5; a claim is a PAIR — the framework's word and a version that belongs to it, no conjunction between them and, in the
order «KAIF … 2.7», no other name, a codename before the word being the release's own, while in the reverse order a lowercase word or a
product name right before the version keeps the version the product's; a date only inside a parenthesis does not make a dated record,
and a table row whose label names the framework version is the record itself whatever dates its other cells carry; a script pin is
named in the code's vocabulary — a quoted old version assigned to an identifier that names a pin (`EXPECTED_VERSION`,
`FRAMEWORK_VERSION`, `KAIF_REQUIRED`), or a `.version` compared with it in a script that reads `kaif.json`, in a script that names the
framework, a date in its trailing comment silencing nothing; a parenthesis wrapped onto the next line is stripped on both lines — 2.8, origin issues #75 · #91) ·
language arrivals (NEW files of the release that arrived English on a non-English deployment,
2.5) · verdict mismatches (files frozen because the recorded rehearsal's wholesale verdict
differed from this run's — both number sets named, 2.5) · mode switch (on an anonymous →
origin transition, the kept files that were deployed with the anonymous wording — named for a
re-read, 2.5) · the closing gates (the machine gates of the closing ritual, run READ-ONLY over the tree the
update just wrote — the budget door through the same ratchet as `check --gate-budgets`, the lesson-journal and
attribution lints where deployed — each verdict named: passes, STOPS with its reason and address, or not judged;
unconditional, so "nothing stops the first closing" is a printed verdict; and since `update` writes its task with the
core deployed when it ran, a task written by an older core has no such item — then `checkpoint recheck`, run by the fresh
core, names the same gates; 2.8, epic CK, N12 of the 2.8 recon) · the owner-voice snapshot (2.8, epic VO; origin issue #103 —
the owner's word: replace, not merge): the bundle meta pins the release's public voice snapshot (sha256 of its LF text, first line, core
version, the markers by which a portrait shows it derives from it — the public snapshot's own labels only — and the first line of every
layout of the snapshot); a portrait that names a marker and is not the snapshot gets the
`owner-voice-core` item — fetch, keep only the local part above the snapshot's first line, the snapshot after it byte for byte; a
portrait that names no marker (another owner's, or a private copy of the core) is never touched; on a task written by an older core the fresh core's `recheck`
refuses with the same instruction until the replacement is done ·
the news interval · executing
checkpoints (`owner-voice-core` compares the snapshot part of the portrait with the pin by sha256 and refuses until they match, and
refuses a merge — a snapshot's first line in the local part above it;
`closing-gates` measures the gates again over the merged tree and records; `recheck` runs the
actual check; `judge` requires `--verdict` with evidence; `field-report` demands the mandatory
field update report on disk in `reports/KAIF_UPDATES/`, pinned to the delivered version — an
update does not verify green without its report).

### 10.4 Legacy and anonymous roads

A bootstrap over an existing deployment classifies exactly like an update whenever a baseline
exists: the surviving deploy manifest, or a synthetic baseline fetched from the OLD version's own
release artifact (`--baseline` overrides the source; unreachable baseline falls back to classic
adopt-everything, stated aloud). Agents and language are inherited from the marker; a re-run never
clobbers recorded checkpoints.

### 10.5 Deprecations

A release may retire artifacts earlier releases deployed: untouched instances are removed
mechanically; locally edited ones are listed in the task. The mechanism that replaced another owns
the cleanup of its predecessor.
Since 2.8 (epic CH) a deprecation that retires a FEATURE names the phrases its projects built on (`search`) and its version
(`since`): the update task of an interval that crosses it lists them with the fate of each hit by its signature — an order signed
by the agent is removed as the agent's decision, one signed by the owner goes to the owner; a question it made moot is withdrawn
(`review.mjs --mark-withdrawn`), a KAIF ticket it resolved reads `**Delivered upstream:** resolved in origin <version>` — a legal
resting state, silent in `check`.

### 10.6 Policy changes

A release that CHANGES A RULE of the previous version (not merely its wording) declares it in the
meta block's `policyChanges`, keyed by version. The update task prints them in a separate
section: a policy change is never merged silently as an ordinary diff. Since 2.9 (epic SW; origin issue #114 — the KAIF owner's
word: what KAIF delivers with an update is accepted without questions) the rules are ACCEPTED with the version: the agent names
each in the field report and the farewell and asks the project owner only where a rule collides with a decision he recorded
himself (an `[OWNER]` line, its address in the question).

### 10.7 Commands

`update` (mechanical pass; writes a crash journal before its first tree mutation and removes it
as its last act — a run killed mid-flight stays visible) · `resume` (after a crashed update:
restore the pre-update tree byte-exact from the journal's backup, remove files the dead run
created, consume the journal) · `diff` (audit: protected vs replace-eligible; `--source`:
per-module preview against another version — a v1 manifest gets a synthetic baseline of the
deployed version, `--baseline` overrides its source; a bare `github.com/<owner>/<repo>` source
resolves to its latest-release assets; since 2.8 — court of epic UP, finding K-R2a — `--render <file>` prints that file as
`install` of the source writes it in THIS deployment's language with its fills and mode: the oracle of a hand merge, render the
old source and the new one and compare both with the disk; the deployment's hand fills fold in as the update folds them, `--render`
without `--source` refuses, and an anonymous deployment is never rendered an origin-tied skill install would not write there) · `adopt-current` (after a MANUAL migration: re-adopt
reality so the mechanical road stays alive) · `sync` (re-mirror skills) · `modules` (print the
machinery's module cut) · `stale-claims` (since 2.8, epic SC: re-run the scan for lines asserting an older version, READ-ONLY —
`--from <v> --to <v>`, the default is the last update receipt; exit 1 only when the walk failed or no interval is known) · `checkpoint` · `update-verify` · `check` (the deployed tree against its manifest and the marker — a tree with neither the bundle nor the deploy manifest is refused: is KAIF deployed here? So are a bundle that cannot be read (absent, without FILE blocks or its manifest block, a language pack's triggers in bad JSON) and a deploy manifest unreadable as JSON — restore it from git. A deployed file, agent artifact or the marker MISSING or empty, a broken marker schema (§12.1), a two-headed document or an unpaired anchor block (§10.2) and a deployed artifact git-ignored by a line KAIF wrote itself (the next update anchors it to the root) are failures, summed up in one closing `INCOMPLETE: N artifacts missing` line with exit 1; warnings, never a failure: a deployed artifact git-ignored by the project's own rule, named with its `.gitignore` line and the `!<file>` cure (since 2.9, origin issue #130; the install summary prints the same scan), a delivered hook not wired, a retired hook still wired in `.claude/settings.json` or in the personal `settings.local.json`, and a settings file unreadable (since 2.9, epics SW and WH — §14), mirror drift of the skill copies other agent systems read (three named, the rest counted; `sync` cures it), a sphere with no library under `.kaif/spheres/`, a step of the closing or release skill that is still an instruction slot of the template — «`<Run the project build …>`» (since 2.9, origin issue #141: the ritual ran no build for 18 days), and the /resume list — a re-read core document the deployed `/resume` does not name as a Step 1 bullet, or a bullet naming a file missing on disk (since 2.7, epic TR); since 2.7, epic SD — origin issue #65 — also the axis "undelivered signal", an allowlist: on tracking: origin a numbered `bugs/KAIF/NN_*.md` ticket is silent only when its `Delivered upstream:` line names an issue — a `…/issues/N` URL or `#NN` — and does not say NOT YET; NOT YET is named with the ready `report` command, a missing, translated or unreadable line, or NOT YET beside an issue, as "no readable delivery state" with both legal forms, and the third form, `resolved in origin <version>`, is silent only with a version no newer than the deployment; a warning, read by the same function as `report`; since 2.8, epic CH — origin issue #78 — the same axis reads the field reports `reports/KAIF_UPDATES/*_KAIF_<X.Y>_{UPDATE,INSTALL}_REPORT.md` of 2.8 and later; older ones were local by the canon of their time) · (since 2.7, epic FR — origin issue #68 — also the axis "constitution keeps the obligations of its template": with a `TEAM_CONSTITUTION.md` in the root and the skill's template on disk, every bold anchor of § 2's numbered items and every one of the nine `## N.` headings must survive generation — headings matched by NUMBER, rules by anchor, and a document where not one anchor matches is translated, so the axis counts and says so; losses are named one by one, a warning never a failure, and `<!-- constitution-ok: <why> -->` beside the item is the declared exemption) · (since 2.7, epic CB — origin issues #43/#45/#71 — the size budgets of the re-read core are judged by the project's OWN lines: a disk module whose (signature, sha256) pair is in the deployment's `moduleShas` ARRIVED and is not counted, so a 1655-line `AGENT_GUIDE.md` with 300 arrived lines is judged at 1355; the warning carries `own lines N of budget ~M` and the ADDRESS the overflow moves to, taken per document from `DOC_BUDGETS` — the chronicle for `STATUS.md`, the chronicle · `researches/` · a house-rules file for the rest; three fallbacks name themselves in the line instead of going silent — no module cut for the file, a file translated WHOLESALE (not one template signature survives, so a by-signature cut is impossible by construction) and an OWNER-SEEDED document whose shipped skeleton the project wrote over, all three counting every line as the project's own; `--gate-budgets` turns the advice into a DOOR — exit 1 after every other axis has spoken, one `<document>: own lines N of budget M → <address>` line each, while the bare `check` keeps the warning and exit 0 so no update road fails on a long document; the closing ritual `/end-chat-soft` runs the flag. The same epic judges the SKILL LANGUAGE MIX by the share of foreign-script prose tokens instead of a single occurrence of a script — fenced blocks and inline code spans are not prose, a body with not one token in the owner's script is ENGLISH as before, and a body that keeps the owner's script while at or above the named threshold of its tokens are foreign is a MIX, named with its percentage: a fully English skill carrying three stray localized words used to be invisible to both counts) · (since 2.8, epic CK — origin issues #84 #85 #99 — the budget door is a RATCHET over `.kaif/budget-baseline.json`, rewritten on every run and committed with the closing (since 2.9, epic UT — criterion 18 — except while an update task is open: the door then writes nothing and says to run the door LAST, after `update-verify`): the first run of a version records the debt above budget and passes, afterwards a document above budget passes only while its own lines shrink, and growth, a standstill or a new overflow stop the closing — an unreadable base stops too: restore it from git; a document the owner declared his verbatim ARCHIVE (`archives`, §12.1) is judged by its digest, its own size is information; the warning of a file translated wholesale names the shipped template's length (`templateLines` of the deploy manifest) and the room it leaves; the move-out address names `HOUSE_RULES.md` with the command that creates it, and `STATUS.md` gets it as a second address for standing rules and reference tables; the count of English skills speaks only where the marker declares `i18n: translated`, the MIX line stays unconditional; and every `check` prints the ENTRY COST as reference — the re-read core, plus `HOUSE_RULES.md` where it exists, in thousands of tokens and as a share of a 1M-token model window, at two named rates of characters per token, never a stop) · `version` · `report
<ticket>` (2.5, epic SG: deliver a `bugs/KAIF/` ticket — since 2.8, epic CH, also an update's field report — to the origin through `gh` under the KAIF
owner's standing authorization — origin issue #15 — with an authorship trailer, and write the
issue URL into its `Delivered upstream:` line; refusals named: `tracking: anonymous`, no `gh`,
not a ticket, `gh` refused; a timeout of the CREATE call is OUTCOME UNKNOWN, exit 3, never a
refusal — a hanging `gh auth status` is `not ready`, exit 2: nothing was sent, a repeat is safe
(2.6 wording, court RL 2.5); the contract line is read as a PARAGRAPH — an issue in it (a
`…/issues/N` URL, or `#NN` as the value itself or right after the word origin/issue) with no
`not yet` is delivered (idempotent), `not yet` in any case with
no issue is undelivered, both at once is ambiguous and refused, and a refusal names both legal
forms with the exact edit (2.6, origin issue #40; since 2.7 one function reads it for `report` and
`check`, and a URL that is not an issue no longer counts); `--dry-run`
calls nothing; the `KAIF_GH` seam lets a polygon stand in for `gh`).

### 10.8 Predicting a pass

The cheapest *exact* prediction is a **sandbox copy**: export the tree (`git -c core.autocrlf=false archive` — the flag keeps the
committed line endings unless a `.gitattributes` `eol` pins them, 2.8, origin issue #81), re-init git in the copy, run the REAL update or bootstrap there and read its diff.
This is not a model of the pass but the pass itself — field-proven byte-identical to the subsequent live run, up to line endings on
a Windows tree with `core.autocrlf=true`. A rehearsal record and a copy's receipt carry the fingerprint of the core that wrote them
(2.8, finding N17): the automatic record of another core is named, ignored and removed; a `--rehearsal` receipt that another core
signed is refused — on the loader route by the LOADER, before it writes the new core (a refusal after the swap left a new core under
the old marker); a named receipt for another interval is refused; an unreadable automatic record is removed; an unsigned one the owner
names (a pre-2.8 copy) is applied with a warning — a 2.5 core's record once bound a
newer core's bootstrap. Recommended
before the first-ever update and on heavily localized deployments; `diff --source` remains the
lighter per-module preview. The copy's receipt binds the live run on EITHER route (2.6): `update
--rehearsal <receipt>` or `node KAIF-LOADER.mjs --lang <code> --rehearsal <receipt>` — the loader
validates its flags BEFORE any download (`--lang --mode --agents --baseline --force --rehearsal`
ride to `install`, `--channel --source` are its own; anything else is refused with nothing fetched
and nothing written — origin issue #42 found three trees left with a new core under an old marker).
On the bootstrap route the task renders module diffs with the OLD template texts (`−`/`+`, never
`+` alone): the machinery fetches the previous release's own artifact for them, `--baseline
<dir|url>` offline (2.6, origin issue #41).

## 11. Trust and provenance

### 11.1 Receipts and history

Every update writes the receipt (`.kaif/last-update.json`: from→to, route, counters, per-module
divergences; `update-verify` stamps `verifiedAt`) and appends to the marker's `history`. An update
is provable after the fact, forever.

### 11.2 Snapshot provenance

The deploy manifest keeps `templateShas` (what the framework deployed) apart from `shas` (what
lies on disk, refreshed post-merge). Authority to replace derives ONLY from template shas; hence
an adaptation that survived one update cannot die in the next. Template and module hashes are
EOL-normalized; the disk snapshot (`shas`) is byte-exact.

### 11.3 Install mode: origin by default, anonymity on request

The install mode defaults to `standard`, which records `tracking: "origin"` together with the
origin URL: version checks, respectful updates and the feedback loop are available to a fresh
deployment without further configuration. Anonymity is never reached by default — only by the
explicit flag. The default is guarded by the sandbox polygon (suite `s01`), which asserts the
marker of a flag-free install rather than the wording of the help text: help is prose, the marker
is behaviour.

`--mode anonymous`: origin-tied skills are skipped, author regions stripped, the acronym
de-expanded; no origin field, no core kept after self-clean. The deploy manifest carries no origin
and SURVIVES — the next bootstrap classifies mechanically. The leak scan covers only
machinery-deployed paths and excludes token clusters matching the project owner's own identity:
the owner's name is not a leak.

## 12. Schemas

### 12.1 The marker (`.kaif/kaif.json`)

| Field | Meaning |
|---|---|
| `framework` | Always `"KAIF"`. |
| `version`, `released` | Deployed version and its release date. |
| `build`, `prerelease` | Written by `install` and both update routes (2.8, origin #107): `build` — the first 12 hex digits of the source-tree fingerprint of the bundle; `prerelease` — present only when the bundle is a build between releases that already carries the notes of that newer version (a release build clears it); the update that reaches that version names it in the task item `prerelease-origin`. |
| `tracking` | `"origin"` (the default, §11.3) or `"anonymous"`. |
| `origin` | The origin URL (absent on anonymous). |
| `sphere` | The project's sphere; its library shall exist at `.kaif/spheres/<sphere>.md`. |
| `agents` | The declared agent systems (array). |
| `language` | The owner's working language. |
| `i18n` | Optional: `"translated"` — the wrapper is translated wholesale (§7.4); updates record it automatically when the translation net recognizes translated files on a non-English deployment. |
| `canonArtifacts` | Declared owner canon paths for the provenance module (§13.3). Seeded `[]` at deploy/update — the conscious "no canon yet" state; a MISSING key makes the provenance gate exit 3 "SKIPPED". |
| `archives` | Optional (2.8): `{ "<re-read core document>": "<digest path>" }` or `{ "<document>": { "digest": "<path>", "owner": "<where the owner's word lives>" } }` — a verbatim document the OWNER declares his archive; set only on his word, like `canonArtifacts`. The size budget is judged on the digest (which must name its archive), the archive's size is printed as information; a digest that is missing or does not name its archive leaves the archive judged as a document. `check` validates the shape. |
| `aiMarks` | Optional: localized provenance mark pairs as open tags in the owner's script (the `[AI]`/`[AI-ed]` analogs a translated wrapper uses, two entries); closers are derived by inserting `/`, and the English pair always works. Literal examples live in the tool's header, not here — an EN template body must stay free of owner-script text (§7.4's translation net judges bodies). |
| `history` | Update history: `{from, to, route, date}` entries; `date` is a moment — local ISO 8601 with the offset (§12.3). |

Commands never require the CLI to restate what the marker already records. The marker is edited
only through commands (`sphere`, updates) — never by hand.

### 12.2 The deploy manifest (`.kaif/deploy-manifest.json`)

`manifestVersion: 2` · `paths` (deployed files) · `agents` (per-system artifacts) · `shas` (disk
snapshot) · `templateShas` (deployed-template snapshot) · `moduleShas` (per-module cut:
signature/class/sha per markdown file) · `kept` (adoption provenance) · `values` (the deploy-time
placeholder snapshot — every later pass fills templates with THESE values, so signatures never
drift when the environment changes; to rename the project deliberately, edit this snapshot and
reconcile the canon by hand) · `marker` (pristine marker snapshot backing self-heal).

### 12.3 The receipt (`.kaif/last-update.json`)

`from`, `to`, `route` (`core-update` | `legacy-bootstrap`), `date`, `counters`, `diverged`,
`divergedModules`, `ownerConvention`, `judgeVerdict` (the full judge verdict recorded by
`checkpoint judge` — the committable proof of the update's judging), `verifiedAt` (stamped by
`update-verify`). `date` and `verifiedAt` are MOMENTS, so both carry the time and the offset in
the owner's local clock — full ISO 8601 (`2026-08-08T07:13:00+03:00`), never a bare date: on a
day carrying two updates a date-only receipt cannot say which one it proves.

### 12.4 The crash journal (`.kaif/update-journal.json`)

Written by `update` (and a version-moving bootstrap) after the pre-update backup and BEFORE the
first tree mutation; removed as the run's last act. `from`, `to`, `source`, `route`,
`startedAt` (a moment, §12.3 convention), `backupDir`, `born` (paths the run will create). A run
killed mid-flight therefore leaves either an untouched tree or a visible journal — never a
half-updated tree without a trace. While the journal exists, `update` and the bootstrap refuse
and name `resume`, which restores every backed-up file byte-exact, removes the `born` files and
consumes the journal. Git-ignored (ignore-first): it is transient run state, not history.

## 13. Conventions

1. **The DONE tag.** A closed bug/idea/homework is renamed `NN_DONE_…` with a status section;
   closing anything requires the "Decisions made without the owner" section.
2. **Test-status markers.** Everything non-trivial is born `[NOT-TESTED]` and becomes
   `[TESTED: date · how]` only by observation. A false `[TESTED]` is judge-hunted fraud.
3. **Provenance marks.** AI text in an owner canon artifact carries paired `[AI]…[/AI]` /
   `[AI-ed]…[/AI-ed]` marks; only the owner's word removes them. Mechanized by the optional
   module `.kaif/tools/kaif-provenance.mjs` (`check` / `report` / `accept`); the owner declares
   the canon via `canonArtifacts`. For machine-consumed canon (prompts, configs), the mark's
   carrier is the accompanying document, never the artifact itself.
4. **Strictness modes.** `draft` — fast, outside the canon; `canon` — the full pipeline:
   approved styleguide (`/derive-styleguide`) → marked writing → canon linter green
   (`.kaif/tools/kaif-canon-lint.mjs`, guards proven by `selftest`) → provenance gate → the
   owner's acceptance. Mechanical steps run on any model; judgment steps on a strong one.
5. **Judge before push.** A `/fable-judge` pass precedes every push and deploy.

## 14. Optional tool modules

Shipped to `.kaif/tools/`, active only when the project opts in:

| Module | Purpose |
|---|---|
| `kaif-provenance.mjs` | The acceptance gate for AI text in owner canon (§13.3). |
| `kaif-canon-lint.mjs` | The growing canon linter: revoked decision → forbidden wording; accepted decision → guarded full unique line; `selftest` proves every guard can fire. |
| `kaif-requirements-lint.mjs` | The stop-word dictionary of `REQUIREMENTS_FRAMEWORK.md` as an advisory grep guard over requirement sections (`check` / `selftest`); quotes, ❌ examples, code, and `(justified: …)` lines are legal by construction. |
| `kaif-guard-lint.mjs` | The guard-declaration block of `TESTING_FRAMEWORK.md` gate 5 (second half, 2.5) as an advisory linter (`check` / `selftest`): every `@guard` carries `THREAT` · `PROVED-AGAINST` · `GAP` · `ON-REAL-PATH`, every `@forensic` carries `EXPLAINS` · `DURABLE-AT` (with `close` / `exit` / `trip-only` rejected), every `@fork` carries `OPTIONS` · `COST` · `RECON` · `DECIDED`; fires only on explicit markers, `SKIPPED=3` when a tree carries none. |
| `kaif-scenario-lint.mjs` | The scenario form of an acceptance criterion (`REQUIREMENTS_FRAMEWORK.md` → "The scenario form", 2.5) as an advisory linter (`check` / `selftest`): a started four-line scenario — Situation · Action · Result · Check, keywords mirrored per language — keeps its shape under seven rules-as-data (order · one action · observable result · no implementation words · third person · a runnable Check · concrete values); an empty owner-written Check is a warning; never demands a scenario, `SKIPPED=3` when a tree carries none. |
| `kaif-attribution-lint.mjs` | The authorship of a decision (`AGENT_GUIDE.md` → "Authorship of a decision", 2.7, epic AW; origin issue #55 — an agent's own choice recorded as "the owner's decision" held a run while the owner's machine died) as an advisory linter (`check [paths…] [--write-baseline]` / `selftest`): a line that attributes a decision or an order to the owner ("the owner's decision", "the owner decided", their RU forms) must carry a verbatim quote, an interview address or a decision number within ±2 lines, or on its own line the address of the commit that holds the owner's words verbatim (`commit <hash>`, since 2.8 — the owner's standing rule enters the rulebook as a rule, his words stay at the source), or be signed as the agent's own (`[AI]`, the localized pair) — otherwise it is DEBT, counted against a baseline that only shrinks (`.kaif/attribution-lint.baseline.json`; since 2.9 — epic PV, origin issues #111 · #112 — it holds a fingerprint `file:sha16(line)` and a count per line, never the text, and a baseline of 2.8 with text values still reads as debt; the root `*.md` are the ones git sees, so a file git ignores is never read; `--write-baseline` limited to paths rewrites only their entries; a copy of a recorded line beyond its count is NEW); patterns are data per language; quote lines, fenced code, inline code and ❌ examples are invisible; `SKIPPED=3` on a tree with no markdown in scope. |
| `kaif-testrun-lint.mjs` | The run report of `TESTING_FRAMEWORK.md` → "An executed run produces its report" (2.7, epic TR; origin issue #59 — the owner-QA's word "THERE WAS NO TESTING") as an advisory linter (`check [home]` / `selftest`): every report in `<testdocs>/reports/` is named `<YYYY-MM-DD>_<work>.md` (the date-first name is the index) and carries seven non-empty fields — Work · Contour · Runs (a moment and a command in a code span per run) · Checks (opening with two separate lines, `Hygiene:` and `Functional run:` — a Verdict `pass` whose Checks carry no functional run or say `NONE` reddens: hygiene alone is `partial`; 2.7, epic CL, origin issue #62) · Found (a list or an explicit "none") · Traces · Verdict (pass · fail · blocked · partial); rules as data, keywords per language, placeholders are not content; `SKIPPED=3` when the home has no `reports/` — an unwritten report is invisible to it, and the judge hunts the claim without one. Second genre (2.8, epic TB; origin issue #105): `bug <report>` judges one tester's bug report (template C of `/report-bug`) — four sections (Description · Steps to reproduce · Expected result · Actual result; Russian keywords too), three lines (Build · Environment · Evidence) each with a value, the steps a numbered list (the user's path), and a report that says "not reproduced" carries a reproduction hunt of at least three variants; exit 1 names each finding. |
| `kaif-voice-lint.mjs` | The machine minute of the owner's voice portrait (`AUTHOR_STYLOMETRY.md` §7A/§8) — the machine half of the INDEPENDENT check that follows writing BY the portrait (`AGENT_GUIDE.md` → the fable loop's fourth KAIF obligation: written by the portrait → checked independently by it → fixed → only then written and brought to the owner; "Showing is an action"; 2.7, epic VC; origin issue #61 — a field agent rewrote a player sheet through seven rounds under the owner's eyes without opening the portrait once) as an advisory tool (`load [--all | --sections <regex>] [--genre <genre>] [--out <file>]` / `check <files…> [--genre <genre>] [--warn]` / `selftest`; since 2.8 — epic VO, origin issue #102 — a §8 row whose hint opens with a genre label `[work]`·`[document]`·`[prose]` (or the same three words in the portrait's language — the Russian mirrors ship in the module) judges only its genres, the same names and rule as the owner's core storage tool; the writing sections of a bare `load` include §1, `--genre essay` adds §3): `load` prints the portrait into the agent's working context BEFORE the first word and leaves the witness `.kaif/voice-marker.json` (the owner's word: write BY the stylometry, with it in the working cache; since 2.8 — epic CK, origin issue #99, a field portrait of ~170k tokens loaded whole for every unit — a bare `load` prints the WRITING sections, §0 · §1 · §2 · §5 · §6 · §7 with their subsections, §2-C among them, and their price in tokens at the rates of the entry-cost line of `check`, and names every other section with its weight and a ready ASCII-only `--sections` regex; `--all` prints the whole; a portrait with none of them numbered is printed whole, said aloud; since 2.9 — origin tickets #143 · #145, a client that caps tool output by bytes cut the print inside a UTF-8 character — `--out <file>` writes the same selection to a UTF-8 file with the same witness, the agent reads that file whole, and a path inside the git work tree that git does not ignore is refused before any write: the copy may be of a private portrait); `check` refuses a text with no witness, with a witness for another portrait, last written before the first load or more than an hour after the last load ("written past the portrait" — never muted by `--warn`) and runs the stop-patterns and required positives of the portrait's §8 TABLE (pattern · class · hint · exception — `\|` is alternation, a bare pattern is case-sensitive, `/…/i` folds case, `\b`/`\w` are Unicode-aware) over the written text before it counts as written; every hit is printed with the portrait's own hint, a row's `/regex/` exception silences a hit on its line and prose is printed beside it; fenced code, inline code and HTML comments are invisible; `--warn` is the calibration mode; `SKIPPED=3` without a portrait, without a §8 table or with placeholder rows only — likeness is never judged, that verdict is the owner's; the portrait path may be named in `.kaif/kaif.json` → `voicePortrait`. |
| `kaif-ranking-lint.mjs` | The fixed form of a `/what-next` answer (2.6, epic WN; origin issue #53 — a field agent quoted "the newest pain is not a priority claim" and broke it in the same answer) as an advisory linter (`check <draft.md>` / `selftest`): the answer opens with `METRIC:` and `MAIN PHASE:` read from the documents, ranks steps in a `| step | moves | closes | effort |` table where row 1 moves the metric or closes something, keeps the fresh words of the owner on a shelf "not ranked by the metric", and always carries the tech-debt line — seven rules-as-data, RU/EN anchors, SKIPPED (exit 3) on a document that never started an answer. |
| `kaif-experience-lint.mjs` | The recurrence deadline of `EXPERIENCE.md` — "Two strikes → a mechanism, never a third reminder" (2.7, epic EL; origin issue #69 — a field audit of one project's whole journal: 7 of 120 failure entries mechanized, 14 of 15 failure classes recurred AFTER their lesson was written, five lessons written 6–17 times in different words) as an advisory linter (`check [journal] [--baseline <file>]` / `--shrink EXP-NNNN [journal] [--yes]` / `selftest`): the field `class: <slug>` on its own line under the entry heading is the UNIT of recurrence, and the SECOND failure entry (`❌` or `❌→✅`) of one class with no `mechanized:` is a finding that names the class and BOTH entries by id. Two fates clear it, both written: `mechanized: <the tool>` in the entry, or the price of the WHOLE class re-checked and declared beside the list — `<!-- class-ok: <slug> — <why it is not cheaply possible> -->` (an empty declaration is itself a finding; declared classes are printed on the summary line and that list only shrinks). It also carries the field rules of the origin's own guard (exactly one of `mechanized:` / `none-cheap: <why>` / `subject-lesson`; a trap by form may not answer `subject-lesson`) against an inherited-debt baseline the caller passes, warns when `mechanized:` names a command or path the project does not contain (a path the project IGNORES is not dangling, and addresses are not checked at all for a journal outside a project tree — said aloud) and when a slug is outside the journal's class list; `--shrink` collapses a MECHANIZED entry to its class line plus one pointer line (`Lesson → guard: … · repro … · full text: git log -p -S "<id>"`), showing by default and writing only with `--yes`; `SKIPPED=3` when not one entry carries `class:` — recurrence cannot be counted, and "not judged" never reads as "clean". Keywords are a per-language table; ids are not assumed numeric (a field journal writes `EXP-NEW-<slug>`). |

Six of these modules walk the project tree (provenance · canon-lint · requirements-lint · guard-lint · attribution-lint ·
scenario-lint), and each carries a byte-identical copy of the core's ONE tree walker (2.8, epic SC; origin issue #77 — twenty
nested worktree copies hid the real file from a scan, and one broken link ended a walk in a stack trace or in a false «clean»): the
files are the ones `git ls-files --cached --others --exclude-standard` lists (without git — a walk that skips `.git`,
`node_modules` and `.claude/worktrees`), a nested repository is not the project, a broken link is skipped with a name (`walk:
skipped N unreadable path(s) — …`), and a directory or a file the walk could not read is FAILED — the check exits 1 instead of
reading clean, and `kaif-provenance report` refuses instead of saying that nothing awaits acceptance. A deployed module cannot import the core (the same reason the voice module copies the token rates), so the origin's build
refuses a copy that drifted from the core's block.

A sibling optional module ships to `.kaif/hooks/` (2.2, epic O) — the **refresh-hooks module**:
mechanical injections of the context-refresh canon (`AGENT_GUIDE.md` → Context refresh) for
agent systems with lifecycle hooks. Four scripts speaking the Claude Code hook contract —
`session-start-refresh.mjs` (canon order after compaction/clear), `prompt-refresh-timer.mjs`
(refresh-marker age over 60 minutes → refresh order; silent while fresh),
`stop-status-guard.mjs` (a dirty worktree or a commit within 3 h while `STATUS.md` went stale → one soft block per
session, naming what it saw), `prompt-resume-word.mjs` (2.7, epic RS: the prompt's FIRST word is `resume` or its Russian shorthand — an imperative
before it counts, the Russian noun as a heading with a colon does not (2.8) → the order to run `/resume` in full before the work;
a leading "stop" → the order to stop in this turn (2.8, epic OW — an amplifier of "The owner's word mid-turn"); silent on every other message — Claude Code only,
other systems' prompt field not verified) — plus `settings-fragment.json`, the ready sample config. Each hook carries a predicate; one
suppression window exists, on the STATUS guard; injections are orders, never document bodies. RETIRED in 2.9 (origin ticket #144, the
KAIF owner's verdict on the field): `pretool-owner-word.mjs` (2.8, `PreToolUse` — refused the next call after a mid-turn word) and the
pre-release `stop-owner-answer.mjs` (`Stop` — demanded a last "next step" arrow line); the update retires an untouched copy (§10.5
deprecations), `wire-hooks` removes their entries from `.claude/settings.json` with the value proof, `check` names one left wired. The hooks judge the PROJECT ROOT — the nearest folder above the event's `cwd` holding `.kaif/kaif.json` — not the
folder the agent went into, and every order names the marker by its full path (2.9, epic HK; origin ticket #94). Activation
(2.9, epic SW; origin issue #115): the install and update tasks tell the agent to run `node .kaif/kaif-core.mjs wire-hooks`,
which merges the fragment into `.claude/settings.json` additively — the owner's entries kept, a repeat run changes nothing,
`"hooks": "off"` in `.kaif/kaif.json` opts out; the write is the agent's and open to its harness, never hidden inside `update`
(`.kaif/hooks/README.md`) — and a deployment without hooks never reddens: the markdown ritual is the complete contour on its own.

**Portability across agent systems** (phase O5; contracts read in each vendor's live docs on
2026-08-07). The predicate and the order text are system-independent; only the JSON envelope of
the injection differs, so each script takes `--emit <shape>` and the SAMPLE names the shape
explicitly — never auto-detection, because a hook must exit silently on anything unclear and a
wrong guess would therefore fail invisibly. Four samples ship beside the reference one:
`sample-codex-hooks.json` (identical field names — the scripts run unchanged),
`sample-cursor-hooks.json`, `sample-copilot-hooks.json`, `sample-antigravity-hooks.json`. Grok
Build needs none — it reads `.claude/settings.json` directly. Where a system's contract carries
only one hook of three, the sample ships that one and says why in its own `_readme`; where a
system cannot inject agent-facing context at all (Windsurf/Cascade, Cline), no sample ships and
the markdown ritual is the honest answer. The module README holds the per-system table, and the
adapters (`_index.md` → "Hook support") hold the same survey from the agent-system side.

## 15. Lifecycle

- `kaif-version` — the deployed version; check origin for newer releases.
- `kaif-update` — the mechanical respectful update (§10); the cognitive residue is the task file.
- `kaif-fork` — snapshot the evolved KAIF into the user's own repository and track it. A fork IS
  an origin only when it PUBLISHES A RELEASE carrying the three machinery artifacts
  (`kaif-manifest.json`, `KAIF-CORE.mjs`, `KAIF-CORE-BUNDLE.md`): `update` fetches from
  `releases/latest/download`, and a repository without a release yields 404. Verification is one
  command: `node .kaif/kaif-core.mjs update --source <fork>/releases/latest/download` shall
  answer with a version or "already up to date" — never 404.
- `kaif-switch-origin` — return tracking to the official origin.
- `kaif-remove` — respectful removal: partial (knowledge artifacts stay) or full.

## 16. Where to read more

The living showcase is the origin README. The execution discipline is documented inside the
`fable-*` skills. The requirements canon is `REQUIREMENTS_FRAMEWORK.md`; the testing canon is
`TESTING_FRAMEWORK.md`; the debugging canon is `BUG_FIXING_FRAMEWORK.md` — bugs are what is born
when testing's checks run against what the requirements demanded. The thinking canon is
`PHILOSOPHY.md`. This reference documents the FRAMEWORK; the project's own architecture lives in
the project's two maps.

## 17. Why the canon says so (informative)

This section is INFORMATIVE: it carries no rule of its own, and a rule found only here is not a rule. The canon documents keep
each rule as a step, a command or a checkbox with one clause of "why"; the rest of its birth certificate — the incident that paid
for it, the owner's word that ordered it, the version that shipped it — lives here, so the rule reads short at the moment of
decision and its reason is still one lookup away. Each entry is keyed by the canon section it explains: the file, an arrow, and
the section heading verbatim. The build fails on an entry whose heading no longer exists in that file, so an entry cannot
outlive its rule silently. Read the entry BEFORE changing or dropping a rule: a rule whose reason you cannot see is a fence
whose purpose you have not yet found.

### `TESTING_FRAMEWORK.md` → What the word "test" means — a functional run on the real product, by the user's path

The word was never defined, and a session used it honestly while the owner read it as false (origin issue #62: "25 closed,
all tested" on unit · self-test · mutant, recounted by the owner-QA as 3 of 25). The owner then defined "by hand" for an AI
agent (origin decision #116, rendered): it writes itself the scenarios from the functionality of the module, the feature, the
fixed bug, writes itself the machinery, and in the real product — stage or production — walks the application: presses the
buttons, reads the lines, looks at the screen, reads the logs — as a QA would by hand. KAIF 2.7, epic CL.

### `TESTING_FRAMEWORK.md` → The testing activities — the chain that makes "tested" mean something

Field-paid (origin issue #21): with no obligation to design the observation set, an agent ran ONE happy path, reported the
feature as working, and the owner produced five uncovered cases in about a minute. The chain is the ISTQB activities canon
(test basis → design techniques → documentation → execution → defect reporting), distilled for an AI agent. KAIF 2.3, epic X.

### `TESTING_FRAMEWORK.md` → Test-status markers — the trust contract

Rule 7 (a FEATURE marker requires a designed set) comes from the same ticket as the activities chain (origin issue #21): a
marker satisfied by one observation certifies that something was observed, while silently claiming the feature was tested —
two different statements. The markers exist as the persistent memory of verification: the check in the moment dies with the
session, the marker tells future agents and posterity that the foundation was load-tested.

### `TESTING_FRAMEWORK.md` → The work produces its own means of checking

"Raw deserves no trust" binds the PRODUCER, not only the checker. The section is principle 3 (early testing) applied to
production rather than to inspection, and it is why the harness exists: the harness is what makes the checking repeatable once
it exists. The triviality gate is stated here once; until 2.8 a second, looser copy (a trivial change needs "no ceremony beyond
its normal comment" — no marker named) stood under "How this composes with the rest of KAIF", and the surviving copy is the one
that names the comment AND the marker. KAIF 2.2, task T6. Why "the same step, never later": verification postponed to a later
step is verification that never happens, and verification that lives only in a session's scratchpad dies with the session.

### `TESTING_FRAMEWORK.md` → An executed run produces its report

The chain puts test documents BEFORE a run and the trust contract puts a marker INSIDE the claim — and nothing said what the
run itself leaves behind. Field-paid (origin issue #59; the owner-QA's word: "THERE WAS NO TESTING"): the agent ran a probe
twice, wrote `[TESTED]` and "stage accepted", and the owner could see neither a command, nor a moment, nor what was found. The
seven fields are the ISO/IEC/IEEE 29119-3 test execution log and test completion report, distilled. KAIF 2.7, epic TR.

### `TESTING_FRAMEWORK.md` → Green tests ≠ working — the observation gates

Gate 5, the named broken version (origin issue #35): four field guards in one evening were each green and mutation-proven —
and each proven against the failure that was convenient to simulate (a process death on a digital twin instead of a machine
freeze; a readback after a CLEAN close instead of a death without one; one warning instead of an accumulation; the first step
instead of any step). The machine hung, and the fuse built for it recorded nothing. KAIF 2.5, epic CN.
Gates 6–7 and their two placement rules (origin issue #18): three deploys in one night served an application that did not
start at all, with every local instrument green. KAIF 2.3, epic X. The deploy door and the hook that denies the raw deploy
command exist because a rule that lives only in a document is a rule the shipping session skips under pressure.

### `TESTING_FRAMEWORK.md` → The agent's stand is not the owner's real world — "done" about production comes after the real world

KAIF 2.6, origin issue #52; the owner's word: the agent is OBLIGED to verify on the real world so as not to break what is
already in production. The class was named after three refusals of an incident-shaped fix: the agent verifies on a clean,
freshly built stand, while the owner's world is accumulated.

### `AGENT_GUIDE.md` → Task execution discipline — the fable loop

- **The `AUTH:` carve-out stands in its own line** because it lost twice, origin issues #37 and #65, while it lived as prose in the
  git paragraph: the broad "confirm outward actions" reflex won both times. KAIF 2.7, epic SD.
- **The fork** (origin issue #36; the owner's word: a fork is NOT the agent's to decide alone) — the field case behind it is the
  black box of `PHILOSOPHY.md` → the fourth door. KAIF 2.5, epic CN.
- **The real world** (origin issue #52; the owner's word: the agent is OBLIGED to verify on the real world so as not to break what
  is already in production). KAIF 2.6, epic RW.
- **The owner's portrait** (origin issue #61): a field agent rewrote a player sheet through seven rounds under the owner's eyes
  without opening the portrait once. The origin owner's word, 2026-09-12, rendered from Russian: "the AI agent writes the text in
  the voice and by the rules the owner's stylometry prescribes; after writing, by that same stylometry, the agent runs an
  independent check of what it wrote, fixes it, and only then counts the text as written and brings it to the owner for approval"
  — and minutes later: write BY the stylometry, WITH IT IN THE WORKING CACHE. KAIF 2.7, epic VC.
- **A claim no wider than its observation** (origin issue #63; the owner's word in the ticket, rendered from Russian: "you assert
  what you did not check"): the agent had verified `curl` → 200 on the local server and reported "the page is open, waiting for
  you for three hours" — a screenshot showed no browser window at all. The canon demanded observation for tests and nothing for
  statements in a report, so an agent could verify the proxy it can reach cheaply and state a fact about the thing it never
  looked at — honestly, in good faith, with a green check behind it. KAIF 2.7, epic CL.
- **A falsehood corrected where it stands** (origin issue #67; the project owner's word in the ticket, rendered from Russian: "the
  agent leaves a lie and forgets to correct the lie where it left it, once it has found out that something in the past was a lie"
  — said the moment he caught the live case: "you wrote that in the comments and left it there, and it is a lie"). KAIF 2.7, epic SF.
- **Why the obligations attach at the call point:** weaving a KAIF clause into the vendored skills' text would fork the vendor
  and quietly break the sync ritual that ports upstream changes without a merge.
- **The first obligation (a check is produced, not only observed):** step 5 of the vendored loop asks the agent to observe a
  check; the KAIF line is what obliges it to have made one.
- **The shipped contour speaks the fifth obligation itself:** at every window it raises it prints `Window: … — the launcher
  returned 0; whether a window is on the owner's screen this line does not verify`, so the proxy is named where it is produced.

### `AGENT_GUIDE.md` → Decisions the agent must NOT make alone — interviews

- **The place of questions:** in the field such a guard surfaced two questions nobody saw, hanging 5 and 13 days. The exit
  condition of the queue (I42) comes from field issue #47 — the owner's word: questions to the owner are priority number ONE.
- **Every question is a scenario:** origin decision #98 — two questions phrased as technical explanations came back as "I don't
  understand the problem — as a customer". **The customer's language:** origin decision #106 and its bug 112.
- **Confusion is a sign to search** (origin issue #50; the owner's word, 2026-09-05, rendered from Russian: "if I propose something
  and it confuses you, you don't understand it — that is your direct sign to go and search the internet for what I meant, or to ask
  me"). The field case, three instances in one day in one project: the owner's answer "write role-playing game and RPG at once" was
  read as a third tag, the edit rolled back and "not done" delivered as a finding — the owner: "nothing breaks!"; a ten-second
  search, or a look at the catalogue (90 records already carried the pair), would have settled it in a minute instead of forty. The
  guard's tag-pair model was RIGHT; the reading was wrong. KAIF 2.6, epic FK.
- **Three legal outcomes and the reading view:** origin issues #54/#58 and origin bug 113; the field page carried 18 535 characters
  of settled matter above the one live question. KAIF 2.7, epic QL.
- **Showing is an action:** the field words that paid for it — "I will NOT open it by double-click! You are forcing me to dig
  through project files again!" An earlier wording claimed the rule was "guarded mechanically" — indicative, about a check that did
  not exist, and a weak session reads such a sentence as a guarantee already met (origin bug 71).
- **A question is self-sufficient:** an agent wrote "the goals are listed in researches/18" and believed it had shown them. The
  owner had said it many times before it was written down: "do not send me digging through MD documents! An open question must be
  sufficient for me to understand the matter being decided!"
- **The taste class:** in the field both suggested demo URLs turned out dead — a link is not an artifact to perceive.
- **Action permission ≠ identity authorship:** a blanket "yes" once disguised a naming question as a technical detail of shipping —
  the field incident behind the rule.
- **Authorship of a decision** (origin issue #55, TOP by the owner's word, rendered from Russian: "you write some nonsense yourself,
  then read it back and interpret it as MY word"; "everything else you must mark as `[AI]`, so that not EVERYTHING written is taken
  for my word"; "my words are what I write to you here, and in the interviews"). Both kinds of decision used to land in the same
  document in the same words, and a day later a fresh session could tell them apart only by trusting the previous one. The field: a
  "the owner's decision P1: wait, no threshold" comment in live code — the owner's actual word at that fork was "do as you see fit"
  — held a run for 119 s while the owner's machine died; 430 of 1083 references to the owner's will in one deployment carried no
  quote. KAIF 2.7, epic AW.
- **Provenance marks outside the canon:** a field agent, forbidden to mark outside the canon, invented "(my taste)" (origin issue
  #55); since 2.7 the marks are legal in any document brought to the owner.
- **Why one mark does three jobs:** *trust* — the owner sees exactly what is his and what was generated, so proofreading becomes
  scanning marks instead of rereading everything; *rollback* — an unaccepted block is safe to remove; *safety for future agents* —
  unaccepted `[AI]` text is never mistaken for the owner's canon.
- **The showcase exemption:** the owner's decision (origin decision #65), quoted: "README and the release notes are not subject to the mandatory
  provenance-mark rules `[AI]`". The reason is mechanical, not aesthetic: a mark's whole purpose is an internal acceptance queue,
  and in a text published as-is it reads to every stranger as unfinished work.

### `AGENT_GUIDE.md` → Document taxonomy — the five tiers

The by-name warning about a re-read core document missing from `/resume` Step 1 (KAIF 2.7, epic TR, origin issue #59): a field
ritual opened 5 of the 9 core documents, and nothing said a word.

### `AGENT_GUIDE.md` → Context refresh — the re-read rule and its witness

The fourth hook of the refresh-hooks module — the order to run `/resume` when the owner's message opens with the word `resume` —
arrived in KAIF 2.7 (epic RS).

### `AGENT_GUIDE.md` → Languages — routed by AUDIENCE, never by directory

The routing question replaced a directory list because the field cost of a frozen list was an owner discovering his own roadmap in
a foreign language within hours of install (issue #6; his words, translated: "I speak Russian, actually"). The trigger-alias rule
(KAIF 2.7, epic HO; issue #57 — a field deployment in Russian; the owner's words, translated: "That is not a 'baton' — that is local
slang. In the industry this is called a HANDOVER, and what we write into STATUS is often written into a HANDOVER.md"; and, before
that, simply: "What does Baton mean?"): rendered literally, the English `baton` landed on the Russian word for a LOAF OF BREAD. The
fix is not a better dictionary but a source of truth that already existed — the Russian aliases of `/end-chat-soft` already said
*pass the relay*, while the canon those aliases trigger said *baton*: the guide was arguing with its own triggers, and the owner
arbitrated for the triggers.

### `AGENT_GUIDE.md` → The form of an obligation — a command, a step, or a checkbox

Field measurement (origin issue #22): two rules of equal canonical weight sat in the same context — the one that had a command was
honoured unprompted; the one stated as prose accumulated debt for 90 minutes and was paid only when the owner asked. <!-- attribution-ok: a field measurement of rule forms, no decision of the owner is claimed -->

### `AGENT_GUIDE.md` → A leading skill word is an order — the first word of the owner's message

KAIF 2.7, epic RS; the origin's owner, rendered from Russian: "if I write it, I REQUIRE the agent to run that skill before starting
the work" — said because agents kept reading the leading `resume` as a topic and starting the task below it. The class behind
it: a skill's trigger lists WORDS, never their POSITION; the kick's "standalone, never mid-sentence" (`/kaif-go`) points the other
way; and nothing mechanical read the prompt until the hook.

### `AGENT_GUIDE.md` → The owner's word mid-turn — the system signs its author

KAIF 2.8, epic OW; origin bug 123 (S1): a session read the owner's "STOP" — delivered mid-turn, signed by the agent system as
the user's — as text inside a tool result, applied the rule for data to it and worked on for minutes, then wrote down that no
order had come. The recon of the delivery across the agent systems of the adapters (the origin's researches/34): the systems
queue a mid-turn message or steer the turn with it at the next tool boundary, and sign the author; no vendor promises that a
prompt hook fires for it — hence the hook branch is an amplifier. The question branch was paid for by the origin itself: the
session that wrote this recon answered the owner's mid-turn question after six tool calls, and the owner had to repeat it. And the
session that shipped the rule met it again the same evening (2026-09-25, 19:32): its answer to the owner's mid-turn question was
composed in the reasoning and never emitted as text — 18 tool calls, the owner unanswered; the transcript showed it. Hence the
mechanical half the origin owner asked for that evening: the gate `pretool-owner-word.mjs` (event `PreToolUse`) refuses a tool call
after the owner's mid-turn message that has no text answer in the transcript — the rule says «answer AS TEXT» for the same reason.
Its first edition refused EVERY call until the answer showed in the record; that session's texts between calls kept landing as
reasoning, so each mid-turn word stopped the work until the owner wrote again — and the owner's verdict came the same hour: answer by
the gate, do not stop the work. The gate refuses once per message; its order makes the turn's final text carry the answer.
The field paid for the gate anyway: 2.9's `Stop` companion made every answer end with a "next step" arrow line, and on one field project five
short remarks of the owner were five stops — his verdict (origin ticket #144, rendered from Russian): remove it from KAIF entirely,
"I don't like that you stop on this". Both hooks left the module in 2.9; the rule kept its words — answer as text, then work on.
Without the hooks the 2.9 release court measured the origin's own sessions: of 16 mid-turn words of the owner, 7 were answered before the
next tool call. The owner's verdict (rendered from Russian): unless the user explicitly asks the agent to stop, the agent answers the
question at once and goes on with what it was doing before it — so the rule now says AT ONCE, before any further tool call.

### `AGENT_GUIDE.md` → The storefront — text a stranger reads

The rules are paid for by a wave of twenty-odd defects the owner found by eye in a single pass, and by the owner's own root
diagnosis: "it reads as if you write English in Russian words."
The paragraphs that follow the ten rules under the same heading carry their own reasons. **Text through files — the argument:**
the temptation to file a throwaway script's progress line under "not covered" is strong (no document is edited, nothing ships),
and that is exactly how sessions that KNOW the rule break it; the owner is the one who sees the corrupted output. **A stamp
carries the date and the time:** on one date three decisions read as simultaneous, and a closure looks as if it preceded the
decision that caused it. A guard for this rule scopes itself by the stamp's OWN date: stamps dated before the adoption stay silent
without any baseline file to maintain. **The moment is probed** (2.8, origin issue #96): the origin had fixed the class for itself —
the probe in the same call and a stamp-truth guard (a moment may not be later than the commit that wrote it) — and had never
shipped it; a field session stamped its documents 1–5 minutes ahead of the clock and told its owner at 11:50 that it had missed
12:00. A future `at` in the refresh marker silences the timer hook as well (origin bugs/119 №2 — the write side).

### `AGENT_GUIDE.md` → Backlog & the DONE tag

The metric-not-date shelf of `/what-next` (KAIF 2.6, origin issue #53): an agent quoted the rule against ranking by recency and in
the same answer ranked yesterday's and today's word of the owner above the main phase and 87 open bugs.
The five-step contour for a defect in KAIF itself is an owner's field decision, adopted as canon: *"if the AI agent noticed a defect
in the KAIF work methodology, fix it in the local KAIF — and file a bug report to the neighboring KAIF project, to the AI agent
developing KAIF; it will then be fixed in KAIF in a coming update"*. The standing order to propose principles is the KAIF owner's
explicit direction to deployed agents; the framework's vision belongs to its author, so every proposal's fate is his.

### `AGENT_GUIDE.md` → Git workflow

- **The `AUTH:` carve-out is stated in the git paragraph** because that paragraph is read before every task (origin issue #37):
  two TOP tickets sat "Delivered upstream: NOT YET" for hours under the very sentence that should have released them.
- **The commit tool names its set out loud** because of a field incident: a tool that staged everything after the agent's
  inspection carried two of the owner's files into the origin under an agent's message minutes after he dropped them into the tree.
- **One tool call — one action** because of a field ticket (origin #146, KAIF 2.9): Claude Code's auto-mode permission classifier
  refused `git add`, `git commit` and `git push` joined by `&&` into one command and passed each step on its own; the owner set
  the rule (origin decision #145) — each git step its own call, and a refusal of a single action is not retried or worked around
  but told to him.

### `AGENT_GUIDE.md` → Planning discipline — the task ladder (`/plan-task` · `/plan-epic`)

Nearly everything in the industry has golden standards, best practices, published research or at least documented practitioner
lore — the state of the art is an external truth too, which is why an epic starts with a recon. The ladder is not ceremony for its
own sake: research gives the epic its evidence base, the meta-plan is where the owner sees the whole shape once, and phase-by-phase
operational plans keep a context-losing session executing the RIGHT next step instead of re-deriving the epic.

### `AGENT_GUIDE.md` → Environment dossier — the agent knows its machine from its own notes

The dossier TABLE moved to the house-rules file in KAIF 2.8 (epic CK, measured on field deployments): the guide is the
method, and the facts of one machine are local law — tier 4. Two field deployments had grown this section by 5 and 13 lines, and a
guide translated wholesale counts every such line against its budget. The origin keeps its own dossier the same way.

### `AGENT_GUIDE.md` → Goal of the project

Until 2.8 the section asked for a one-paragraph restatement of `GOAL.md` — a second copy of the goal, a pair that drifts. The
field grew it by 5 lines per deployment; KAIF 2.8 (epic CK) leaves a pointer to the one copy.

### `AGENT_GUIDE.md` → Architecture — the map

Until 2.8 the section carried a module map that its own text said to "keep in sync with" the external map — a declared drift
pair, and a pair is better removed than watched. KAIF 2.8 (epic CK) keeps the one line that is a rule here — the key invariant —
and points to the two map documents.

### `AGENT_GUIDE.md` → Test harness (how the agent observes & drives the software)

The harness COMMANDS moved to the house-rules file ("Stands, environments and devices") in KAIF 2.8, epic CK: the largest
growth measured in the field was this table — 64 lines in one deployment, a 151-line section in another — and in a guide
translated wholesale every line of it counts against the budget. The principle — the harness is the most important investment
for autonomous work — stays in the guide.

### `AGENT_GUIDE.md` → Tools

The tools table moved to the house-rules file ("Tools of this project") in KAIF 2.8, epic CK: the 2.8 skeleton had grown a
table of the same columns, one fact in two homes (a twin of step CK4.5 found by the field measurement). The origin has kept
its tools table in its house-rules file since 2.7.

### `AGENT_GUIDE.md` → Push / GitHub authentication

The push recipe moved to the house-rules file ("Routes, recipes and conventions") in KAIF 2.8, epic CK: it is a recipe of one
environment, and one field deployment grew the section from 8 to 36 lines.
