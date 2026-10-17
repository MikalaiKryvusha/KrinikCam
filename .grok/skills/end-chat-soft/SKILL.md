---
name: end-chat-soft
description: SOFTLY CLOSE this chat with full ceremonies — usually ordered IN ADVANCE, while work is still going. Acknowledge in one line, finish the current work to a natural cut WITHOUT rushing, and only then unhurriedly run the full closure (status + handover, bonsai trim, README, rebuild, pairs registry, judge pass, commit AND push, farewell). Use when the human says "wrap up when you're done", "finish up and close the chat later", "потихоньку потом закроешь чат", "нужно будет доделать и закругляться", "доделай и сворачивайся" — an advance request is NOT an order to drop the work right now. Neutral closing phrases with no urgency ("закончим чат", "завершаем чат", "wrap up", "end the chat") also mean THIS skill. For an urgent right-now closure use /end-chat-force; for a light in-chat pause (the chat continues) use /pause. Trigger aliases (ru): «потихоньку потом закроешь чат», «доделай и закругляйся», «закончим чат», «завершаем чат», «передай эстафету», «сверни сессию», «сохрани прогресс», «зафиксируй статус», «заверши сессию»
---

# /end-chat-soft — the soft closure: finish properly, then say goodbye

The human wants this chat closed — but closed WELL, not fast. The work continues in OTHER chats
with OTHER agent sessions that start from an empty context. Two phases: first honor the work,
then run the full closure ritual. Never rush either phase.

## Phase A. The advance order — keep working to a natural cut

The order usually arrives WHILE you are working ("wrap up when you're done"). Then:

1. **Acknowledge in one line** — "Got it: I'll soft-close after reaching a natural cut —
   continuing the current work." — and RETURN to the work.
2. **Finish the current work to a logical cut**: a self-contained piece is done, verified, and
   committable; nothing is left half-rewritten. Work at your NORMAL pace and quality — no rushing,
   no corner-cutting, no shrinking the task because a closure is pending.
3. Do NOT start new large work after the order — the next natural cut is where the closure begins.

If the ask arrives when nothing is in progress — Phase A collapses: begin the closure right away
(still unhurried).

## Phase B. The full closure ritual — in order, without haste

Run the steps **in order**, narrate briefly. Don't skip steps. A step fails — stop, tell the
human, don't continue blindly.

### Step 1. Record status & the handover in STATUS.md

Update `STATUS.md`:
- **What was done in this chat** — concrete, tied to bugs/features and files.
- **Current position** — what works, what's in progress, where we are.
- **The handover ("where to continue")** — a checklist written for a STRANGER: the next session knows
  nothing this chat knew. Commands, file paths, what to verify first, open questions with owners.
- Convert relative dates to absolute (find today's date from context / `date`).

Reconcile with the active bug docs in `bugs/` and reflect their status. If a reusable lesson
emerged in this chat, capture it in `EXPERIENCE.md` (skill: `/experience`) before the handover is
passed — and then run `node .kaif/tools/kaif-experience-lint.mjs check`: a SECOND failure entry of one
`class:` with no `mechanized:` is red and names the class and both entries by id (2.7, epic EL; origin
issue #69 — 14 of 15 failure classes recurred AFTER their lesson was written). Fix it before the
handover by naming the guard in the entry, or by re-checking the price once for the whole class and
declaring it (`<!-- class-ok: <slug> — <why> -->`) — never by writing a third record; a journal with not
one `class:` exits 3 = SKIPPED, and that is said aloud, never read as clean. A journal that arrived from
before the fields existed prints its old entries as warnings on every closing: record that inherited debt ONCE —
`node .kaif/tools/kaif-experience-lint.mjs check --write-baseline` writes `.kaif/experience-lint.baseline.json`, which every
later `check` reads; commit it (a later write only shrinks it, and a new entry is never adopted — origin issue #80). If a previous `/end-chat-force` left a "ceremonies skipped" debt line in `STATUS.md` —
this closure pays it: run what was skipped and remove the line.

If the project keeps a **truth↔mirror pairs registry**, run its check commands before handing
over — a handover across a drifted pair hands the next session a lie.

**The bonsai trim (STATUS is a summary, not a chronicle):** entries that stopped being "now" —
closed phases, finished sessions, shipped releases — move VERBATIM into `PROJECT_HISTORY.md`
(newest on top; move, don't rewrite). Then re-read what remains of `STATUS.md` with the two tests
from its header ("remove this line — will the next agent err?" · "readable in one sitting?"; soft
target ~200 lines). Leave the file the way you'd want to find it.

The trim writes NEW prose — the pointer lines that stay behind ("moved to …", "decided by the owner") — so where the
attribution module is deployed, run it after the trim, before the commit: `node .kaif/tools/kaif-attribution-lint.mjs check`.
A pointer that says "by the owner's word" without his words is a new finding; fix it with the quote or its address. The lint's
default scope is the seven knowledge directories plus the root `*.md`: if the trim moved text into a directory outside it, name
that directory — `node .kaif/tools/kaif-attribution-lint.mjs check <dir>` — or the moved text is never read (2.8, epic CK; a field
report: the trim of one STATUS added one such pointer, and the dossier it created lay outside the default scope).
A deployment that never recorded the lint's baseline stops here on its INHERITED findings at its first closing (the update task's
`closing-gates` item names them): record that debt ONCE — `node .kaif/tools/kaif-attribution-lint.mjs check --write-baseline` writes
`.kaif/attribution-lint.baseline.json`; commit it. From then on only NEW findings stop the closing, and the baseline only shrinks
(2.8, epic CK; measured on four field deployments: 11 to 151 inherited findings each).

**Then the budget DOOR — after the trim, not instead of it:**

```
node .kaif/kaif-core.mjs check --gate-budgets
```

Exit 1 means a document of the re-read core is over its budget in the project's OWN lines (the lines
you wrote; modules that arrived byte-equal to the template are not counted), and each line names the
document, the two numbers and the ADDRESS its overflow moves to. Move the content there and run it
again. Raising a budget is not the cure, and neither is committing past a red gate: the whole point of
the flag is that the closing ritual STOPS here (2.7, epic CB; origin issue #71, the owner's own audit
of one project — "three core documents above budget, the warning printed for weeks and acted on
once"). Bare `check` keeps printing the same numbers as advice and exits 0, so nothing else in the
update road fails on a long document.

Since 2.8 the door is a RATCHET over `.kaif/budget-baseline.json`, which it rewrites on every run —
commit that file with the closing. The first run of a version records the debt above budget and
passes (`↳ … debt recorded`); after that a document above budget passes only while its own lines
SHRINK (`↳ … shrinking A → B`), and growth, a standstill or a new overflow stop the closing (`✖`).
Move at least one line out per closing until the document is under budget; it then leaves the file.
An unreadable base stops the door too — restore it from git. A verbatim document the owner declared
his archive (`.kaif/kaif.json` → `archives`) is judged by its digest; never declare one on your own.

### Step 2. Refresh README (when reality moved)

Bring `README.md` in line with reality: phase status, working features, instructions. If the README
is bilingual, keep both languages in sync. Don't invent — reflect only what is done and verified.

### Step 3. (Re)build / regenerate artifacts

KrinikCam (carried over from the retired `/end-chat`, 2026-10-17):

```bash
node tools/readme-pdf.mjs        # README.pdf in the root (gitignored); first time: node tools/setup.mjs (md-to-pdf)
node tools/build.mjs --no-ui     # debug APK; Java/SDK/adb are chosen by tools/env.mjs (macOS and Windows)
```

If a build fails, stop and show the errors — don't commit broken state.

### Step 4. Commit and push (judge first)

Run a `/fable-judge` pass over this chat's finished claims before pushing (the canon: a judge pass
precedes every push). Then:

KrinikCam (carried over from the retired `/end-chat`):

```bash
node tools/owner.mjs guard       # hanging interviews + orphan questions outside interviews/ (exit 1 = name them in the handover)
node .kaif/tools/contour/review.mjs --queue --list   # owner pages: anything saved in the window and not yet picked up
node tools/commit.mjs "<type>: <one line of what the session did>"   # bumps build in version.json, add -A, commit, push
```

`commit.mjs` takes a multi-line message via a file or `$'…\n…'` (AGENT_GUIDE → «Текст ходит файлами»).
README.pdf and the APK are gitignored — not committing them is normal.

Message style (from `AGENT_GUIDE.md`): `feat:` / `fix:` / `docs:` / `refactor:` / `ci:` + one line.
End the message with your standard co-author trailer, e.g.:
```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

### Step 5. The farewell report

Report to the human: what was recorded, what was built, the commit hash(es), what was pushed, and
the handover in one paragraph — the main thing the NEXT chat should do first. That's the goodbye.
It carries the ENTRY COST line `node .kaif/kaif-core.mjs check` printed (`ℹ entry cost: /resume reads … ~ Nk tokens — X % of …`),
said in the owner's language: the price of entering the next chat is the owner's to see at every closing (2.8, origin issue #99).

One line of that report is asked BY NAME, because nothing else in the session asks it
(`AGENT_GUIDE.md` → "a falsehood is corrected where it stands"): **which statement of this session
turned out to be false, and where does it still stand?** Answer it in the report, in the owner's language (`.kaif/kaif.json` →
`language`; 2.8, origin issue #97 — the owner reads this line, no machine does); the English form is:

`Standing falsehood: none` — or `Standing falsehood: <the statement> → corrected in <place>, <place>`

A statement you corrected only in the chat is still standing in the artifact the team reads, so run
the five steps BEFORE the farewell, never after it — and if a place could not be corrected, name the
place and its missing retraction command instead of answering `none`.

## Notes

- The family in one line: **/pause — the chat continues later; /end-chat-soft — finish properly,
  then say goodbye; /end-chat-force — capture the essentials and say goodbye right now.**
- This skill is also the closing move of timed autonomous runs: a named end time means "START
  /end-chat-soft at that time" (`AGENT_GUIDE.md` → Working until a named time) — never an early
  finish out of deadline fear. When a named time started this closing, the report opens with
  `BOUNDARY: now <ISO of a date probe in the same call> · named <ISO> · pool <empty | N items>` — the clock decides, never the
  agent's estimate (origin issue #96: "did not make it by 12:00" said at 11:50).
- If a push is rejected (non-fast-forward) — `git pull --rebase`, retry the push, then tell the
  human about the divergence.
- Generated artifacts that are gitignored (e.g. build outputs) won't be committed — that's fine.
