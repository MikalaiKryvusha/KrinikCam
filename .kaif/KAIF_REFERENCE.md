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

Each release attaches five artifacts (their roles are machine-readable in `kaif-manifest.json`):

| Artifact | Role |
|---|---|
| `KAIF.md` | The thin entry point; transient in the target project. |
| `KAIF-CORE.mjs` | The machinery; survives as `.kaif/kaif-core.mjs` (except on anonymous deployments, §11.3). |
| `KAIF-CORE-BUNDLE.md` | The COMPLETE deployable set: documents, skills, spheres, optional tool modules, language packs. |
| `kaif-manifest.json` | Version, codename, sha256 pins of the fetched pair, asset roles. |
| `KAIF-FULL.md` | The offline fallback core — a SUBSET (no language packs/spheres/references); not an authoritative diff baseline (only a last-resort candidate for a synthetic one, §10.4). |

## 5. The document system

Thirteen key documents ship with a deployment (twelve project documents plus this reference):

| Document | Purpose | Written by |
|---|---|---|
| `AGENT_GUIDE.md` | The canon: rules, map, commands, conventions. | Machinery deploys; agent adapts. |
| `PHILOSOPHY.md` | How the agent thinks: simplicity (KISS + Occam) and the wider principle set. | Deployed verbatim. |
| `BUG_FIXING_FRAMEWORK.md` | How defects are fixed: intent gate, 3-attempt rule, twin check, class-not-instance, guards. | Deployed verbatim. |
| `TESTING_FRAMEWORK.md` | Nothing raw is trusted: the `[NOT-TESTED]`/`[TESTED: …]` contract, observation gates. | Deployed verbatim. |
| `GOAL.md` | The owner's vision. | **The owner.** |
| `MASTER_PLAN.md` | The phased road from the current state to the GOAL. | Agent derives (`/revision`). |
| `STATUS.md` | The living SUMMARY of now and the baton between sessions (soft target ~200 lines; closed work moves to the chronicle — the bonsai trim). | Agent, after every task. |
| `PROJECT_HISTORY.md` | The append-only chronicle: closed sessions/phases/releases, newest first; NOT in `/resume`'s canon set — archaeology on demand (2.1, epic H). | Agent, at `/end-chat`'s trim. |
| `EXPERIENCE.md` | The grep-friendly journal of lessons with trigger tags. | Agent (`/experience`). |
| `PROJECT_STRUCTURE_EXTERNAL_MAP.md` | The external map: directories, files. | Agent maintains. |
| `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` | The internal map: abstractions and interactions. | Agent maintains. |
| `KAIF_FRAMEWORK.md` | "KAIF, deployed here": the deployment record page. | Agent, after injection. |
| `KAIF_REFERENCE.md` (this document, at `.kaif/`) | The complete framework reference. | Deployed verbatim. |

Knowledge directories, each with its own README: `plans/` `ideas/` `bugs/` `researches/`
`interviews/` `homeworks/`. Closed items take the `DONE` tag in the filename (§13.1).

## 6. The skill system

Thirty-four skills — the verbs of project work — deploy to `.claude/skills/` (canonical) and are
mirrored into every declared agent system (§7.3). Groups:

- **Session:** `resume` (read ALL canon documents, pick one main thing) · `pause` (soft-park the
  chat: logical stopping point, green tree, local commit, NO pushes) · `end-chat` (full closure:
  STATUS baton, judge, commit AND push) · `refresh-context` · `check-backlog`.
- **Autonomy loops:** `autoloop` · `dayloop` · `nightloop` — grind the backlog; every item ends
  with a mandatory judge pass; an owner's drive-by note is filed to the backlog, not a task switch —
  plus `guarded-loop` (2.1): the same loop under a WATCHDOG (external wake-ups every N minutes,
  a work-proving heartbeat file, a restart policy with an escalation cap).
- **Knowledge:** `experience` · `report-bug` · `bug-research` · `propose-idea` · `interview`.
- **Owner contour (2.1):** `owner-voice` (a stylometric portrait of the owner's written voice from
  their own texts; portrait and rewrite modes, the skeleton ships as
  `.kaif/_owner-voice-template.md`) · `owner-reviews` (the optional review contour: interviews and
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
  "not a defect"; survivors become bug docs and feed the guardrails.
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
deliverable — `KAIF_ADAPTATION_TASK.md`, whose items close only via `checkpoint <id>` commands;
`verify-final` runs the final gates (§7.5) and self-cleans the installer.

### 7.3 Agent systems

Declared via `--agents` (default: claude-code, codex, grok-build, cline, zoo-code). The canonical
skill set lives in `.claude/skills/`; mirrors derive from it mechanically (`sync` command;
`update-verify` re-syncs automatically). Cognitive work lands in the canon only — a mirror is
never edited by hand.

### 7.4 Languages

Nine language packs (ru, es, pt, fr, de, zh-Hans, ja, hi, ar) override the owner-facing documents
and inject trigger aliases into each skill's `description:`. Agent documents stay English by
default. A project that translated its wrapper wholesale declares `"i18n": "translated"` in the
marker: mechanical replacement is then disabled in favor of per-module diffs, and the machinery
never wars with the translation (§10.2).

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
`moduleClasses` (manual class overrides), `policyChanges` (§10.6).

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

## 10. Updating

### 10.1 Classification

For every bundle file, against the deployment's snapshots: an owner file is never in scope (but a
changed owner TEMPLATE surfaces as an "owner-conventions" task item); a missing file is added; a
file whose disk sha equals its TEMPLATE sha is replaced (or kept if upstream did not change it);
a diverged markdown file undergoes the MODULAR merge.

### 10.2 The modular merge

Reconstruction starts from the DISK order (the owner's inserted sections keep their place).
A module untouched since deploy takes the new template's text; a localized module is never
replaced by a template that carries none of the owner's script; an edited module is kept — and
lands in the task WITH a "your version → new template" diff ONLY when upstream actually changed
it. New template modules insert by template order.

### 10.3 The update task

`KAIF_UPDATE_TASK.md` lists: per-module merges with diffs · whole-file merges · owner-convention
transfers · deprecations carrying local edits · stale claims (lines still asserting the OLD
version anywhere in the project) · the news interval · executing checkpoints (`recheck` runs the
actual check; `judge` requires `--verdict` with evidence).

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

### 10.6 Policy changes

A release that CHANGES A RULE of the previous version (not merely its wording) declares it in the
meta block's `policyChanges`, keyed by version. The update task prints them in a separate
"decisions for the OWNER" section: a policy change is never merged silently as an ordinary diff.

### 10.7 Commands

`update` (mechanical pass) · `diff` (audit: protected vs replace-eligible; `--source`: per-module
preview against another version — a v1 manifest gets a synthetic baseline of the deployed version,
`--baseline` overrides its source) · `adopt-current` (after a MANUAL migration: re-adopt reality so
the mechanical road stays alive) · `sync` (re-mirror skills) · `modules` (print the machinery's
module cut) · `checkpoint` · `update-verify` · `check` · `version`.

### 10.8 Predicting a pass

The cheapest *exact* prediction is a **sandbox copy**: export the tree (`git archive`), re-init git
in the copy, run the REAL update or bootstrap there and read its diff. This is not a model of the
pass but the pass itself — field-proven byte-identical to the subsequent live run. Recommended
before the first-ever update and on heavily localized deployments; `diff --source` remains the
lighter per-module preview.

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

### 11.3 Anonymity

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
| `tracking` | `"origin"` or `"anonymous"`. |
| `origin` | The origin URL (absent on anonymous). |
| `sphere` | The project's sphere; its library shall exist at `.kaif/spheres/<sphere>.md`. |
| `agents` | The declared agent systems (array). |
| `language` | The owner's working language. |
| `i18n` | Optional: `"translated"` — the wrapper is translated wholesale (§7.4). |
| `canonArtifacts` | Optional: declared owner canon paths for the provenance module (§13.3). |
| `history` | Update history: `{from, to, route, date}` entries. |

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
`divergedModules`, `ownerConvention`, `verifiedAt` (stamped by `update-verify`).

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
`fable-*` skills. The testing canon is `TESTING_FRAMEWORK.md`; the debugging canon is
`BUG_FIXING_FRAMEWORK.md`; the thinking canon is `PHILOSOPHY.md`. This reference documents the
FRAMEWORK; the project's own architecture lives in the project's two maps.
