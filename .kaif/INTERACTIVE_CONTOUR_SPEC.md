# INTERACTIVE CONTOUR — the one-page executable contract (KAIF 2.6, epic IC)

<!-- Ships as .kaif/INTERACTIVE_CONTOUR_SPEC.md (bundle-only). This page is the CONTRACT every owner-facing page must satisfy — the shipped generator (.kaif/tools/contour/, 2.6) implements it; a project that still runs its own contour checks it against these lines BEFORE opening a page to the owner.
The long-form canon (47 invariants, build contract C1–C13, traps T1–T11) stays in the /owner-reviews skill; this page is the part a session can verify in one minute. Origin: field tickets #19 #38 #47 #51 — every one a contour rebuilt per project and broken on its own edge case (a page opened WITHOUT radio buttons because the options were typed as paragraphs).
This page has a BUDGET (120 lines, judged by the origin's suite s22): a new article is written at the width of the table below, or it pays for its lines by tightening an old one. -->

## 1. Source document — what the page is built from

- **md is the source, HTML is derived. Always.** The page is rendered from the document; nothing is hand-edited.
- A question is a heading `### Q<n>. <text>`; its answer field is a line starting with `**Answer:**` (the Russian alias of the
  label is legal). An answer already written by the owner is NEVER overwritten — a new text lands as a dated follow-up field.
- **Options are recognised in two carriers with one letter vocabulary** (2.9, origin issue #127) — anything else renders WITHOUT radio buttons:
  - a table row per option: `| **A** | what it means | price and risk |`
  - a list item per option: `- **A)**` · `- **A:**` · `- **A.**` · `- **A (note):**` · a bold letter alone `- **A** — …`; a letter the parse does not read — a list item or a paragraph `**C.** …` — is NAMED by the door (`letters authored N, recognised M`, exit 3), never dropped
- A question with NO options is legal only when it DECLARES a free field (a `D) your own answer` option, or the marker
  `<!-- questions-guard:no-scenario <reason> -->` for a naming/taste question). Paragraph headings like `**A. …**` are NOT options — the #51 defect.
- Every question and every option is a four-line scenario (Situation · Action · Result · Check) in the owner's language; the technical note stands UNDER the scenario, never instead of it.

## 2. Pre-flight — runs before any page opens (exit 3 = refuse to open)

```
for each question Q<n>:
  options(Q<n>) = table rows | **X** |  ∪  list items - **X)** · - **X:** · - **X.** · - **X (note):** · - **X**   (letters authored > options → exit 3)
  if count(options) < 2 and no declared free field:
    print "Q<n>: 0 options in list form and no declared free field — the page would open without radio
           buttons; fix the form: - **A)** …"   →  exit 3
self-check after render: count(radio groups) == count(questions)  →  mismatch = exit 3, never a silent page
```

The generator runs this pre-flight itself. **The form check is a door of its own** (2.7, origin issue #56): `review.mjs <doc> --check` = parse + pre-flight + render self-check → `blocks N, recognised M: …` + what was NOT recognised, exit 3 / 0;
no server, no sound, no call, no showing recorded. `--no-open` is NOT a check: it serves and CALLS (only the window stays shut). **An unknown flag REFUSES before any page, sound or call — exit 1** (2.7, epic LP, origin issue #66: the 2.6 generator let `--close` fall through to the show and called the owner); the known flags are printed with the refusal.
**Second axis of the same door — ARCHAEOLOGY (2.7, origin issue #70: 13 questions brought to one owner that his own prior answers had already settled, one of them 44 days after his answer).** A LIVE question of a document whose header date is on or after `2026-09-18` opens only WITH the attestation of the search that was actually run, standing between its heading and its FIRST option; the door searches itself for a question in ANY transport, a chat question too (2.8, origin issues #74 · #82: `review.mjs --search "<the question>"` — no shell and no locale decide whether a capital Cyrillic letter is found; the printed grep carries `LC_ALL=C.UTF-8`):
`<!-- archaeology: search "<the heading's words>" → N hits · read: <files | none> · prior: <none | "<the prior answer>" + address> -->`
Without it the door exits 3 and PRINTS the ready command; `N > 0` with `read: none` or `prior: none` is refused too (legal: `prior: unrelated — <why>`), while `N = 0` is an honest attestation — the axis promises the agent SEARCHED and said with what, never that it found.
Exempt: answered questions, the declared `<!-- archaeology: n/a — <reason> -->`, and every document dated before that day (the field's history is never repainted). `--check` says which of the two it did: `archaeology: N of M live questions attested` / `archaeology: not judged — header date … is before …`. **Third axis — the question is SELF-CONTAINED (2.9, origin issue #124).** A live question's heading and stem (the lines before its first option or answer field; the addressee and origin lines excluded) refuse the door with exit 3 on a BACKWARD or SIDEWAYS reference — the parser's `refBack`: «see above», «in the section», «§3» and their Russian mirrors; a forward reference («options below») is legal; `<!-- ref-ok: <reason> -->` on the line exempts it, an empty reason does not; documents dated before 2026-09-28 stay silent.

## 3. Records — three files, derived names; a record is replaced only by a NEW revision of the document (the table below)

| Fact | Where | Shape |
|---|---|---|
| the answer | back into the source md, at `**Answer:**` | `X) <text> <!-- owner-review: by <owner> · <local time> -->` |
| the decision | `<decisionsDir>/<doc-basename>.decision.json` | `{ kind, document, by, at (ISO), atHuman (local words), comment, answers: { Q1: { choice, text, comment } } }` — plus `recovered: true` when the answer was saved on the owner's computer while the server was gone and picked up by the agent (2.7, LP); the provenance comment in the md says it too; the saves of ONE page MERGE into it (2.8, `rev` → `revAfter`), a new revision of the document starts a new decision |
| the archive | `<decisionsDir>/archive/<doc-basename>--<ISO>.json` | a copy per save; never rewritten |
| the fact of SHOWING | `<decisionsDir>/shown.json` | `{ "<doc>": { "at": "<ISO>", "transport": "page \| batch \| chat" } }` — written when the window opens, or by hand for a pointed chat question (`--mark-shown <doc> --transport chat`) |
| the queue | `<decisionsDir>/queue.json` | a STATE file — live documents are never moved into a pending folder |
| the fact of IMPLEMENTING | `<decisionsDir>/implemented.json` | `{ "<doc>": { "<Q>": { "at": "<ISO>", "where": "<commit or file>" } } }` — the FOURTH fact (2.7, origin issue #54): written by the agent's hand the moment the decision lands in rules or code (`--mark-implemented <doc> <Q> --where <ref>`); a document whose every open question is implemented is never raised again — the queue and the show print `implemented, but open: <doc> Q1 → close the status` and exit 2 (`--queue --list` and a direct show: always; the batch `--queue`: the line is printed, exit 2 when nothing else waits); an OPEN question a withdrawal made moot takes the same fact with `"withdrawn": true, "why"` — `--mark-withdrawn <doc> <Q> --why <reason>` (2.8), never an answer on the owner's behalf; an answered one is refused |

Approval binds to the SHA-256 of the NORMALISED body (BOM stripped, CRLF/CR → LF, trailing blanks cut, exactly one final newline). Text changed after approval = approval void.

## 4. The page — what the owner must see

- **Reading view (2.7, origin issue #54):** LIVE questions first; everything answered and the document's text below as ONE
  collapsed archive (`<details class="archive">`) — nothing removed. Three legal outcomes: answer · remark · «read, no remarks» (§5).
- A radio button per option under every question, a free-text field, one **Save** button, a visible "saved" signal. **Readable without the browser's zoom** (2.8, origin issue #106 — a field owner's explicit word): the page renders at 1.7× the browser base through `html { zoom }` — the whole page, as Ctrl+Plus does (raising font-size alone turns the radio circles into dots), the Save button at 1.5× (its own zoom 1.5 / 1.7), and every width breakpoint is multiplied by the same scale (media queries do not see CSS zoom).
- **The Save control is a FLOATING button at the top right** (`.fab { position:fixed; top; right }`), visible at any scroll and window height; the status is a pill
  under it, no wider than the button's column the header keeps free and at most two lines tall — a status that does not fit them rides the bar above the page, and each bar is cleared only by its own owner (2.9, origin issue #125 — a wide pill covered the document title). **A bar pinned to the bottom edge is FORBIDDEN** — a window taller than the screen (remote desktop, phone) hides it (2.7, origin issue #60, the
  owner's word: a FAB at the top right). The render self-check judges it (`.fab` fixed, no `bottom:0`, no raw `**` in labels) and refuses a failing page with exit 3.
- **The header scrolls with the page** (`header { position: static }`) — the owner's word; only the emergency banner ("server silent") may stay pinned.
- Refusing the owner's work is LOUD: every request that carries the owner's text sits in try/catch; a failed save returns the text onto the page with Copy and Retry; a draft lives in `localStorage` and is restored on load ("picked up N fields"). No path may leave the Save button disabled with no
  visible error. **The answer survives the server** (2.7, LP, origin issue #66; the owner's word: "JS writes the file to the computer, into the project folder — no choice, no 'save as'"): the window runs on its own profile in the project (`.kaif/contour-window/`, ignore-first, sign-in-off flags,
  `account_info` checked after launch); Save with the server gone stores the answer there, IndexedDB the primary carrier — durable half a second after the write even if the browser dies ("saved on this computer, the agent will pick it up" — no dialog; only in the app window, `display-mode:
  standalone` observed by the page: a TAB lives in a profile the agent never reads, so it gets the rescue ring with the answer text and no promise); the next `--queue --list` / `--check` / show picks it up headless on the same profile and port (the origin; deferred while a browser still holds the
  profile) → recorded as the owner's decision with `recovered: true`, the lock released; an unsaved draft is named and kept.
- The page polls `/alive?i=&d=&s=&doc=` (ms since input · draft fields · saved · the document) every 15 s (envelope 10–60 s) and says out loud when the server
  goes silent; the lock keeps that input state (2.7, LP) so `--close` can read it from another process; the answer names the document's revision on disk (2.8).
- Time shown to a human is LOCAL words; ISO lives in the records.

## 5. Process — outcomes, patience, wake-up

- Exactly three outcomes, all in the process log: **decision recorded → exit 0** · **page closed without an answer — or after N saved answers, already recorded (2.8) → exit 2** · **interrupted → exit 130**. Pre-flight refusal is exit 3.
- On the proofreading and mockup faces «Done» with empty fields is a decision recorded too — the record carries `noRemarks: true` («looked, no
  remarks» is the most frequent verdict on an artifact, and the page says so under the field); the page never refuses it. Only the interview face still needs an answer or a comment (origin bug 113).
- Patience is infinite by default (`--timeout 0`); a finite timeout is an automation flag and means tolerated silence.
- Answers are saved ONE AT A TIME (2.8, the KAIF owner's word): the page LIVES while its document has an unanswered question («Saved. Questions left:
  N», the answered one moves to the settled fold, the other drafts stay); the last answer ends it with exit 0. The agent is woken by a separate WAITER
  started next to the page as a tracked task — `review.mjs --wait <doc>`: exit 0 on each recorded answer, 2 when the contour ended without one — its lock gone, or its server's process dead while the lock stays (2.9, #125: `--queue --list` then picks up an answer saved in the window) — or none came up within a minute; apply the
  answer, start it again while questions are left. The page dying is an event too: `sendBeacon('/closed')` on `pagehide` plus a silence watch (~3 min, two strikes).
- A save carries the REVISION its page was built from: another revision (the document rewritten under an open tab) → 409, the text stays on the page with
  «Open the new revision»; a repeated save is recognised; a draft key carries its question's fingerprint — a draft never lands on a rewritten question.
- One document — one window (a lock with pid and address); a free port (`listen(0)`) — the previous run's port FIRST when
  that process is gone (the draft lives in its origin), a taken port named in the log; a separate app window (`--app=`),
  never a tab — the page checks `display-mode: standalone` itself and says when it is a tab. Auto-close is an ATTEMPT (~2 s).
- **A live owner page is closed only by `<doc> --close`** (2.7, LP, #66 — "the contour closed while I WAS TYPING"): prints port · pid · title ("compare with the window you were told about"), REFUSES with exit 4 while the last input — or the page itself — is younger than the quiet threshold (180 s;
  `contour.closeQuietMs`) or a draft is unsaved, else asks the page's OWN server to end (token from the lock; a pid from a file is never killed without `--force`; the waiting agent sees exit 2) and prints `closed <doc>`; `--force` needs `--owner-word "<quote>"` (logged — an audit trail, not a gate).
  A neighbour session's word is never evidence — check the port and the pid. The browser window is never killed: its draft stays on the project profile.

## 6. The call — sound first, voice by language

Beeps 880/160 → 660/160 → 990/260 ms through the sound card, then the banner, then the voice — after the page is up, never before. The voice is chosen by the deployment language (`.kaif/kaif.json` →
`language`) first, timbre second; when no matching engine exists the call line says so ("system voice — engine not installed") and the contour drops to beeps + banner rather than speaking noise. The
rich engine is a MACHINE resource reached through the environment (`KAIF_VOICE_TOOL`, `KAIF_VOICE`, `KAIF_SAPI_VOICE`) — never a path inside the project. Quiet hours override every level; the window
may cross midnight. **The call names the calling session** when the project has more than one workspace («<owner>, this is <session>. …», `CALL · <session>:`, the window title; `KAIF_SESSION_NAME`,
else the workspace directory) — and `review.mjs --call "<what is needed>" [--dry-run]` carries a request for the owner's hands outside a page (2.8, #95 · #98).

## 7. Faces and flags (the shipped generator)

| Face | Command | Record |
|---|---|---|
| interview (questions with options) | `node .kaif/tools/contour/review.mjs <doc.md>` | `kind: "interview"` |
| notice (something to TELL, no answer owed) | `… <doc.md> --notice` | `kind: "notice"`; "read" is the normal outcome, exit 0 |
| proofreading (a comment field per paragraph) | `… <doc.md> --proofread` | `kind: "proofread"`, `comments: { "p<N>": text }` |
| mockup review (an image + comments) | `… <image> --mockup` | `kind: "mockup"` |
| queue page "N accumulated" / queue without a browser | `… --queue` / `… --queue --list` (exit 2 while a waiting document was NEVER shown) | — |
| self-test (no browser) | `… --selftest` | red on the "options as paragraphs" fixture, green on the canonical forms |
| call the owner — hands or a quick answer (2.8) | `… --call "<what is needed>" [--dry-run]` | the phrase names the calling session; `--dry-run` — printed, no sound |
| search a prior answer / wait for the next one (2.8) | `… --search "<question>"` / `… --wait [<doc.md>]` | hits by file and line + the attestation line / exit 0 on a recorded answer, 2 when the contour ended or never came up within a minute |
| close a live page (2.7, LP) | `… <doc.md> --close [--force --owner-word "<quote>"]` | prints port · pid · title; exit 4 = refused (owner typing / page younger than the threshold / draft unsaved), 0 = closed or nothing to close |

Parameters are READ, never asked (owner rule #97, "a mechanic ships only complete"): `contour.projectName` (default: the project directory name), `contour.ownerName` (default: the owner row of
AGENT_GUIDE's identity table, else "owner"), `contour.callName` / `contour.spokenProjectName` (how the voice addresses the owner and names the project; defaults `ownerName` / `projectName`),
`contour.decisionsDir` (default `interviews/decisions`), `contour.quietFrom/quietTo` (default none), texts by `language` (RU/EN shipped, others fall back to EN and the page says so).

## 8. Acceptance in one minute

```
node .kaif/tools/contour/review.mjs --selftest                     # green; names the red fixture
node .kaif/tools/contour/review.mjs interviews/<doc>.md --no-open  # exit 0 and a printed URL, or exit 3 with the fix
ls <decisionsDir>/*.decision.json <decisionsDir>/shown.json        # records exist after the first save / show
```
