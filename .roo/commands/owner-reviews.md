---
description: Deploy the interactive review contour "agent ↔ owner" — everything the agent wants from the owner (forks, reviews, approvals, answers) rendered as local HTML pages with recorded one-click decisions, a send-side approval gate, a fixed three-beep signal, auto-close, and a WAKE-UP that returns control to the waiting agent. Ships an EXECUTABLE build spec (references/build-spec.md + references/qa-suite.md) so two agents on two projects build the SAME tool instead of re-inventing it from vague requirements. Optional sugar on top of the hard canon rule "the place of questions is interviews/" (AGENT_GUIDE.md). Use when the owner asks to move approvals to rendered pages ("render my interviews", "set up owner reviews", "сделай вычитку страницей") or when a project adopts the place-of-questions practice with tooling. Field-proven twice on independent projects (Nogamelabs, NDim, KrinikCam). Trigger aliases (ru): «сделай вычитку страницей», «отрендери интервью», «разверни контур согласований», «переделай контур владельца»
---

# /owner-reviews — the owner-review contour

The hard rule already stands in `AGENT_GUIDE.md`: everything the agent wants FROM the owner lives
ONLY in `interviews/` (or a named decision-queue document). This skill is the OPTIONAL contour on
top: interviews and outbound drafts rendered as local HTML, decisions recorded with author and time,
sends mechanically gated by approval, and the waiting agent woken by the save.

Two lessons go before everything else, both paid for in the field:

1. **HTML is not the goal but the transport; the goal is the GUARD.** The place-of-questions rule
   was broken by an agent who knew it. On one project the guard found two questions nobody saw,
   hanging 5 and 13 days; on another, four — two of them 13 days old; on a third it found, on its
   birthday, an interview that had been sitting "unanswered" for two days with twelve answers
   already written in it.
2. 🔴 **A contour that accepts the human's answer but does not WAKE the waiting agent is half-built —
   and the missing half is invisible to every check.** All checks assert the path THERE (recorded in
   three places, hashes match, page confirmed). Nobody checks the one thing the contour exists for:
   *that the waiter learned the answer arrived*. In the field the owner caught it, not the tests:
   *«я дал тебе там ответы, но оно не дёрнуло тебя»*. See **I8**.

## What KAIF fixes and what it leaves to you

Earlier versions of this skill fixed only names and invariants and left the tool to the project's
agent. Field result: three projects, three different sounds, three different page layouts, and the
same four defects re-paid each time (a radio button that cannot be deselected · a pointless "who is
answering" field · no auto-close · silently dropped answer options). So the contract is now split:

- **This file — the NORMATIVE part.** Invariants, build order, the fixed decisions (sound, element
  set, mechanics), adoption rule, acceptance criterion. Deviating from it needs the owner's word.
- **`references/build-spec.md` — the EXECUTABLE part.** Exact contracts: normalization and hash,
  document parsing, page anatomy with style tokens, the deselect mechanic, the signal with its
  frequencies, browser launch and auto-close, the wake-up, the decision record schema, the guard
  with its debt ratchet. Follow it step by step; do not re-derive it.
- **`references/qa-suite.md` — the PROOF part.** The check set that caught everything in the field,
  the mutations that prove the checks can fail, and how to drive a real browser with zero
  dependencies.

The IMPLEMENTATION language and file names still belong to the project. Everything a human perceives
— what the page looks like, what it sounds like, how it behaves under a click — does not.

## Build order (field-corrected twice: "ours was worse")

0. **Measure before you code.** Grep the working directories for owner-question markers and sort
   them BY HAND into real and false. That number is your inherited debt; it decides the guard's
   construction (step 1) and it is the only honest baseline for "the tool paid off".
1. **The place-of-questions guard, WITH a debt baseline** — depends on nothing, pays immediately.
   A guard that is red from birth is not a gate: it teaches itself to be ignored. Snapshot the
   inherited debt, fail only on NEW violations, print the debt count every run — the number must go
   down. Second half of the guard: the **stale-status detector** (answers present, status still
   screaming "WAITING").
2. **The core: normalization, hash, parsing, decision record.** One module, called by both sides.
3. **The page** — built from the document every time, never hand-edited.
4. **The send-side gate** — makes approval mechanical; without it the page is decoration.
5. **Signaling** — useless before there is something to show.
6. **Accumulation for autonomous loops + the wake-up (I8) in the same step.** They are one design:
   accumulate, yes — but the batch page cannot live long.
7. **Pilot on REAL data** — the only thing that catches seam defects. Three of seven implementation
   defects surfaced only on live documents; two were caught by the owner's eyes.

**Acceptance criterion:** a full routine cycle passes **without a single clarification in chat**.
Not "the page opened" — "the owner answered, the agent was woken, and never had to re-ask".

## The invariants (normative — a contour without them falls apart)

- **I1. md is the source, HTML is derived. Always.** The page is built from the document and never
  hand-edited — otherwise a second truth appears and the next empty-context session misses decisions.
- **I2. An answer is recorded in THREE places:** back into the source md (the next session reads the
  document) · `<doc>.decision.json` beside it (machine check before send) · a copy in the decisions
  archive with `by` and `at`. The decision filename is DERIVED from the document name — a shared
  decision file gets overwritten by the next interview. **The owner's already-written words are
  never overwritten:** a re-answer arrives as a separate dated clarification, the old text stays
  verbatim.
- **I3. Approval binds to the SHA-256 of the BODY, not to the click.** Text changed after approval =
  approval void, checked by machine. **And normalization is agreed FIRST, in one function both sides
  call** — the costliest defect of this contour was one side hashing file bytes while the other
  hashed normalized text: both self-tests green, the gate refusing every artifact forever.
- **I4. The gate stands on the SEND/APPLY side, fail-closed.** Missing decision · not `approved` ·
  artifact undeclared · body gone · hash drifted · any unexpected error ⇒ refuse, non-zero, even
  under an explicit `--apply`. It never throws; it returns refusal. Nothing self-approves by timeout.
- **I5. The signal follows a successfully opened page** — and "opened" means the browser FETCHED it,
  not that you asked the OS to open it. The signal must never hold the page: fire it asynchronously,
  or the owner hears an invitation to a page that is not on screen yet.
- **I6. Quiet hours override everything**, including an explicitly requested voice level. The window
  CROSSES MIDNIGHT (e.g. 23:00–09:00) — naive `from <= now <= to` is silent all day and loud all
  night; that comparison deserves its own guard.
- **I7. Autonomous loops accumulate, never block.** A queue file parks the reference; one "N
  accumulated" page calls the owner ONCE per batch. **Do not move live documents into a pending
  folder** — that breaks every link to them from status and plans; a state file is enough.
- **I8. 🔴 The save WAKES the waiting agent.** The agent learns of events by the TERMINATION of a
  process it started — therefore a long-lived page server and a wake-up are mutually exclusive, and
  the wake-up wins. **Any recorded decision terminates the contour** (page auto-closes, process
  exits zero). If anything remains unanswered, re-opening the page is the AGENT's duty, never the
  human's. Corollary for I7: the batch page opens, the owner answers, the contour closes and wakes
  the agent; the agent re-opens the rest itself.
  **And the contour must never outlive its need** — three mechanisms, all paid for in the field:
  **(a) one document, one server** (a new `ask` evicts the previous instance through a registry of
  live contours) · **(b) a page heartbeat** (the owner closed the window ⇒ the contour exits in ~90 s
  instead of waiting out its timeout) · **(c) the session-closing ritual stops every live contour.**
  Without them an orphaned page sat for three hours and woke the agent with its timeout in the middle
  of the night, AFTER the chat was closed — a wake-up caused by a ghost is worse than none, because
  the agent acts on it.
- **I9. ⏳ The wait itself has NO deadline** (owner's ruling, 2026-08-02). A hard timeout is the only
  way the contour can die WITHOUT learning the decision: a question asked at a bad hour expires into
  nothing, the owner never knows it was there, and the agent re-opens it tomorrow. Wait as long as
  the owner needs — the honest deaths of I8 are enough, and none of them self-approves anything (I4).
  This does not soften I8: it forbids outliving the NEED, and while the answer is missing the need
  stands. An endless wait costs exactly two things, and both are mandatory:
  **(a) the heartbeat must tell a CLOSED page from a SLEEPING MACHINE.** If your own watchdog tick
  overslept its period, nobody was running — grant the page a fresh full grace period instead of a
  verdict. Otherwise a laptop shut for the night executes a page that is still open, and the owner's
  morning "Save" lands on a dead server. Make the verdict a PURE function of (now, last beat, previous
  tick, tick period, tolerance) and feed each outcome its own case in the self-test: sleep is the one
  event you cannot reproduce by hand.
  **(b) the call must REPEAT while the answer is missing** — hourly by default, silent in quiet hours
  (I6). One beep at hour X is the owner's only chance to learn they are being waited for; with a
  one-hour timeout a missed beep cost an hour, with an endless wait it costs the whole wait.

## The fixed part of the tool (do not re-decide these)

These were decided by owners in the field, cost real defects, and exist so the tool is the SAME
across projects. Exact values, code shapes and reasons: `references/build-spec.md`.

| What | Fixed decision |
|---|---|
| **Selecting an answer** | Hand-written mechanic on top of a radio input: a second click on the chosen option DESELECTS it. A native radio cannot do this, and partial answering is the normal mode — the owner starts answering and defers. Never ship a page where "none of them" is unreachable. **No extra "clear" button and no focus ring on the radio** — both were shipped once and rejected by the owner on sight (clutter, and an accent-coloured square around the circle); the row highlight is the only feedback the choice needs |
| **"Who is answering" field** | **Removed from the page** — a one-owner project always has the same answerer. But `by` is still WRITTEN by the server from config: an archive without `by` is unreadable months later. Remove the QUESTION, not the RECORD |
| **The signal** | Three beeps — **880 / 660 / 990 Hz**, 120 ms each, 60 ms apart, synthesized by the tool itself into a WAV (zero dependencies, identical on every machine). Sound FIRST and always; voice after it; the OS notification in parallel and never instead. Exit 0 is not proof the human heard |
| **The voice** | A parameter, not a menu. Prefer a local neural TTS if a neighbouring project on the same machine already has one (borrow the COMMAND, never the files), fall back to the system synthesizer. Text goes to the synthesizer as a FILE, never as a command-line argument |
| **After a decision is recorded** | The page auto-closes after **2 seconds** — but only when it was opened as an APP WINDOW, because a browser lets `window.close()` work only on a window the script itself opened. In a normal tab: an honest "your browser will not let this page close itself — you can close it now", never a silent hang |
| **Question widget** | A 4–5 px state stripe along the left edge, coloured BY STATE, plus an explicit state TAG on every question: *waiting for you* / *answered*. One detail carrying two meanings: it separates the cards and it reports |
| **What the owner must JUDGE** | Embedded, not linked: audio as `data:` URI, images as frames, a live `srcdoc` iframe for interactive mock-ups. A choice among four mock-ups opens as a SEPARATE window (the script opens it, so the script can close it); an inline frame is for quick previews of smaller decisions. A `file://` link from a page served over http is blocked by the browser — embedding is the only working path |
| **Comments** | One per question AND one for the whole document at the very bottom. A document-wide comment is a legitimate outcome on its own ("no answers, but here is what I think"); it lands as a separate dated block at the end of the md, and comments accumulate instead of overwriting |
| **How long the contour waits** | Forever — no default deadline (`timeoutSec: 0`). A deadline is the only death that loses the decision instead of recording it. An explicit `--timeout N` stays for QA and one-off runs; the exit code `7` exists only for it |
| **Repeating the call** | Every hour while the answer is missing, quiet hours silent. The console line is printed on EVERY reminder even when the sound is suppressed — that line is what QA asserts, and a `--remind <sec>` override is what makes an hourly behaviour testable in seconds |
| **Dependencies** | Zero. A markdown mini-renderer is ~120 lines; the temptation to take a static-site generator or a UI framework is large and the win is zero |

## Rakes to warn about (in falling price order — every one of them was paid)

1. **Hash without a normalization agreement** → the gate refuses always, on green self-tests (I3).
2. **The tool is built, the agent does not use it.** On one project the agent retold the questions in
   chat ten minutes after finishing the contour; the owner: *«ты издеваешься? мы только что сделали
   инструмент»*. Chat is cheaper in the moment. A tool counts as ADOPTED only when a ritual carries
   the executable command that shows violations ("show ALL unanswered interviews on one page").
3. **An answer option SILENTLY DISAPPEARS** when its bold label wraps to a second line — and the one
   that vanished was the recommended one. Checks said "options rendered"; none said HOW MANY.
   **Count, do not look:** candidate lines must equal parsed options ACROSS ALL LIVE DOCUMENTS.
4. **Fixtures do not catch live documents.** A horizontal rule after an empty answer field read as an
   ANSWER; a field labelled "Answer (owner's counter-question)" read as an answer. A run over ALL
   live documents is a handover condition for the tool.
5. **`|| true` in a check.** A check that cannot fail ASSERTS, and it sends the next diagnosis in the
   wrong direction. Never write it; hunt it in existing checks.
6. **A false alarm in a guard is worse than a miss** — it teaches ignoring the tool. Expect roughly
   as many false hits as real ones for a text-rule guard; close each with an explicit exception
   carrying its REASON on the line (a marker without a reason is itself a violation).
7. **A check bound to the changing state of live data** goes red the hour the owner answers. Rules
   belong in self-tests on fixtures; live runs assert structure, not content.
8. **A command that by design holds a server must have a "build and exit" flag.** Otherwise every
   synchronous caller — starting with your own QA run — hangs forever. Every child call inside a
   guard gets a hard deadline.
9. **Both OS themes** — dark-on-dark code blocks are caught by owners, not by self-checks. Measure
   contrast in PIXELS from the first day.
10. **Non-ASCII regexes:** in Node `\w`/`\b` are ASCII-only even with `u` — use `\p{L}` /
    `(?!\p{L})`, or the guard silently misses its own language.

## Borrowing from a neighbouring project (cheaper than any of the above)

Before writing a subsystem, ask whether a **neighbouring project on the same machine** already
solved it — and read its `bugs/` IN FULL. In the field the real value of the neighbour was not its
code but its four closed voice-path bugs (text with no letters or digits; cp1251 garbling; digits
silently swallowed until "56 → fifty-six" normalization appeared; markup leaking into speech). Each
would have been our bug, with its own hour of triage. **Borrow the interface, never the files:** a
copy gives you two truths and two places to fix.

## Parameters and compatibility

- Sound/TTS/quiet hours/port/owner name are PARAMETERS in one config file, changeable without code.
- Industrial four for outbound drafts: **Approve / Reject-with-reason / Edit / Respond**; the payload
  is visible in full (a LINK to the body file, never a pasted copy — a copy is a second truth and
  breaks I3); the audit trail keeps refusals too.
- An answer's force never depends on transport: **HTML = md = chat** — all are the owner's word,
  recorded with `by`/`at` (equivalence rule, `/interview`).
- Interviews without the contour keep working exactly as before — the sugar never becomes a duty.

---

## Как это развёрнуто в KrinikCam (локальная кастомизация, 2026-08-01)

Инструмент — **`tools/owner.mjs`**, спецификация — `references/build-spec.md` этого навыка, планы —
`plans/22` (первая версия) и `plans/23` (переписывание по полевому отчёту NDim,
`researches/28_owner_reviews_contour_field_report.md`). Настройки — `tools/owner.config.json`,
исключения гарда С ПРИЧИНАМИ — `tools/owner-guard-exceptions.json`, базовая линия долга —
`tools/owner-guard-baseline.json`. Ноль внешних зависимостей: stdlib Node + `say`/`afplay`/
`osascript`/`open` + Chrome для окна-приложения и QA.

```bash
node tools/owner.mjs guard         # ВСЕ висящие вопросы + долг числом (в ритуалах /resume, /end-chat, лупов)
node tools/owner.mjs ask <док>     # страница + сигнал; ЛЮБАЯ запись будит агента (I8)
                                   # ⏳ ЖДЁТ БЕСКОНЕЧНО (I9) — запускать ФОНОМ, зов повторяется раз в час
node tools/owner.mjs gate <док> [--q В1|--artifact <id>]   # fail-closed перед зависимой работой
node tools/owner.mjs queue <док> && node tools/owner.mjs inbox   # копить в лупах, звать раз на пачку
node tools/owner.mjs selftest      # ядро: каждому гарду скармливается ровно его дефект
node tools/owner.mjs verify        # QA ЖИВЫМ браузером (Chrome+CDP): клики, теги, цвета, консоль
node tools/owner.mjs baseline      # пересобрать базовую линию долга (долг обязан убывать)
```

Что здесь стоило дороже всего и не должно быть переоткрыто (сверх спецификации):

- **Парсер строится по ЖИВЫМ документам, а не по эталону.** В 17 интервью проекта четыре формы слота
  ответа и пять форм строки статуса. Узкий шаблон дал по `interview_006` ноль вопросов и ноль пустых
  слотов — висящее интервью было бы НЕВИДИМО и для страницы, и для гарда.
- **Главный сигнал гарда — СТРУКТУРНЫЙ (пустой слот), а не текстовый (слово в статусе):** текстовый
  греп однажды промолчал, потому что `ЗАКРЫТ` совпал с «за-крыт-ие».
- **Тег `DONE` в имени файла выводит документ из охоты за сиротами** — не ослабление гарда, а честное
  «не ищем в том, что канон объявил закрытым».
- **Сигнал не держит страницу:** до правки синхронные `afplay`+`say` держали процесс 5–8 с, и владелец
  слышал приглашение на страницу, которой ещё не было на экране.
