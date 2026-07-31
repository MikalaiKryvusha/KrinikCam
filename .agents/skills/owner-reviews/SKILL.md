---
name: owner-reviews
description: Deploy the interactive review contour "agent ↔ owner" — everything the agent wants from the owner (forks, reviews, approvals, answers) rendered as local HTML pages with recorded one-click decisions, a send-side approval gate, signaling, and accumulation for autonomous loops. Optional sugar on top of the hard canon rule "the place of questions is interviews/" (AGENT_GUIDE.md). Use when the owner asks to move approvals to rendered pages ("render my interviews", "set up owner reviews", "сделай вычитку страницей") or when a project adopts the place-of-questions practice with tooling. KAIF fixes the methodology (what must hold); the project's agent builds the tools (how). Field-proven contour (Nogamelabs: "Мне нравится. Получилось удобно"). Trigger aliases (ru): «сделай вычитку страницей», «отрендери интервью», «разверни контур согласований»
---

# /owner-reviews — the owner-review contour

The hard rule already stands in `AGENT_GUIDE.md`: everything the agent wants FROM the owner lives
ONLY in `interviews/` (or a named decision-queue document). This skill is the OPTIONAL contour on
top: interviews and outbound drafts rendered as local HTML, decisions recorded with author and
time, sends mechanically gated by approval. The field's main lesson goes first: **HTML is not the
goal but the transport; the goal is the GUARD** — the place-of-questions rule was broken by an
agent who knew it, and the guard found two questions nobody saw, hanging 5 and 13 days.

KAIF fixes NAMES and INVARIANTS; the implementation belongs to the project's agent. Zero external
dependencies is explicitly encouraged — the field contour is a ~100-line markdown mini-renderer, a
stdlib localhost server that lives seconds (serve → record → die), system utilities for
voice/sound/notification/browser; the page is self-contained and opens offline. The temptation to
take a static-site generator or UI framework is large and the win is zero.

## Build order (field-corrected: "ours was worse")

1. **The place-of-questions guard** — depends on nothing, pays immediately, shows the real scale.
2. **Render + decision record** — the core; the metadata contract lives here.
3. **The send-side gate** — makes approval mechanical; without it the page is decoration.
4. **Signaling** — useless before there is something to show.
5. **Accumulation for autonomous loops** — needed exactly when the practice enters day/night loops.
6. **Pilot on REAL data** — the only thing that catches seam defects.

**Acceptance criterion:** a full routine cycle passes **without a single clarification in chat**.
Not "the page opened" — "the owner approved and the agent never had to re-ask".

## The invariants (normative — a contour without them falls apart)

- **I1. md is the source, HTML is derived. Always.** The page is built from the document and never
  hand-edited — otherwise a second truth appears and the next empty-context session misses
  decisions.
- **I2. An answer is recorded in THREE places:** back into the source md (the next session reads
  the document) · `<doc>.decision.json` beside it (machine check before send) · a copy in the
  decisions archive with `by` and `at` (who decided, when). The decision filename is DERIVED from
  the document name — a shared decision file gets overwritten by the next interview.
- **I3. Approval binds to the SHA-256 of the BODY, not to the click.** Text changed after approval
  = approval void, checked by machine. **And agree on normalization** — who strips what, at which
  step: the field's costliest defect was the page hashing file bytes while the sender hashed
  normalized text (trailing `\n` stripped); both self-tests green, the gate would refuse every
  artifact always. Only the end-to-end pilot on real data caught it.
- **I4. The gate stands on the SEND side, fail-closed.** The sending tool itself reads the
  decision, requires `approved` for THIS artifact, re-checks the hash — and refuses non-zero even
  under an explicit `--apply` when the decision is missing, `rejected`, or the text drifted. Any
  doubt = refusal. A request never self-approves by timeout.
- **I5. The signal follows a successfully opened page** — call the owner from the renderer, after
  the page is up; otherwise you get the class "summoned, nothing to show".
- **I6. Quiet hours override everything**, including an explicitly requested voice level:
  autoloop → quiet hours → setting. The window CROSSES MIDNIGHT (e.g. 23:00–09:00) — naive
  `from <= now <= to` is silent all day and loud all night; that comparison deserves its own guard.
- **I7. Autonomous loops accumulate, never block.** A queue flag parks the document in a pending
  folder; one "N accumulated" page (each card linking to its document) calls the owner ONCE per
  batch. Without this the practice is incompatible with day/night loops.

## The name contract (candidate, field-tested on four product routines)

Metadata block in the document head (fenced YAML): `title` · `kind` (interview / outbound draft /
…) · `artifacts:` list of approvable bodies, each `{id, target ("Slack · #channel"), format,
body_file}`. **`body_file` is a LINK, not a copy-paste** — the page shows exactly the bytes that
will leave, and the hash is computed over them; a pasted copy is a second truth and breaks I3.
Decision record: `kind, document, by, at, comment` + `artifacts: {<id>: {status, sha256}}` for
drafts / `answers: {Q1: {choice, text, comment}}` for interviews. `by` is not decoration — it is
what makes the archive readable months later.

## Rakes to warn about (in falling price order)

1. Hash without a normalization agreement → the gate refuses always, on green self-tests (I3).
2. **Tool built, agent not using it** — the same day the page worked, the agent retold questions
   in chat: chat is cheaper in the moment. A tool counts as ADOPTED only when a ritual carries the
   executable command that shows violations ("show ALL unanswered interviews on one page").
3. **Exit 0 ≠ the human got the signal** — native notifications get muted silently by OS focus
   settings with a success code. A must-arrive signal needs a path independent of user settings,
   and delivery is confirmed WITH THE HUMAN, not by exit code.
4. **Fixtures don't catch live documents** — three renderer defects surfaced only on the project's
   real files. A run over ALL existing live documents is a handover condition for the tool.
5. **A false alarm in a guard is worse than a miss** — it teaches ignoring the tool; close each
   with its own guard. Expect ~10 false hits per real one for a text-rule guard; exceptions are
   explicit, with the reason on the line.
6. **Both OS themes** — dark-on-dark code blocks were caught by the owner, not by self-checks.
7. **Non-ASCII regexes:** in Node `\w`/`\b` are ASCII-only even with `u` — use `\p{L}` /
   `(?!\p{L})` with the `u` flag, or the guard silently misses its own language.

## Parameters and compatibility

- Sound/TTS are PARAMETERS: the voice name is a parameter, not a menu (a field machine had exactly
  one usable voice out of 185); quiet hours are mandatory, not optional.
- Industrial four on the page: **Approve / Reject-with-reason / Edit / Respond**; the payload is
  visible in full; the audit trail keeps refusals too.
- An answer's force never depends on transport: **HTML = md = chat** — all are the owner's word,
  recorded with `by`/`at` (equivalence rule, `/interview`).
- Interviews without the contour keep working exactly as before — the sugar never becomes a duty.

---

## Как это развёрнуто в KrinikCam (локальная кастомизация, 2026-07-31)

Инструмент — **`tools/owner.mjs`**, план — `plans/22_owner_reviews_contour.md`, настройки (голос,
звук, тихие часы, порт, владелец) — `tools/owner.config.json`, исключения гарда с ПРИЧИНАМИ —
`tools/owner-guard-exceptions.json`. Ноль внешних зависимостей: stdlib Node + `say`/`afplay`/
`osascript`/`open`.

```bash
node tools/owner.mjs guard     # ВСЕ висящие вопросы (в ритуалах /resume, /end-chat, лупов)
node tools/owner.mjs ask <док> # страница + браузер + звук/голос, запись ответа в три места
node tools/owner.mjs gate <док> [--q В1|--artifact <id>]   # fail-closed перед зависимой работой
node tools/owner.mjs queue <док> && node tools/owner.mjs inbox   # копить в лупах, звать раз на пачку
node tools/owner.mjs selftest  # каждому гарду скармливается ровно его дефект
```

Что здесь стоило дороже всего и не должно быть переоткрыто:

- **Парсер строится по ЖИВЫМ документам, а не по эталону.** В 15 интервью проекта нашлось четыре
  формы слота ответа и пять форм строки статуса. Узкий шаблон (только `**Ответ Криника:**`) дал по
  `interview_006` ноль вопросов и ноль пустых слотов — то есть висящее интервью было бы НЕВИДИМО и
  для страницы, и для гарда. Молчаливый пропуск — худший класс отказа гарда.
- **Главный сигнал гарда — СТРУКТУРНЫЙ (пустой слот), а не текстовый (слово в статусе).** Именно
  текстовый греп однажды промолчал, потому что `ЗАКРЫТ` совпал с «за-крыт-ие» в прозе.
- **Тег `DONE` в имени файла исключает документ из охоты за сиротами** — это не ослабление гарда, а
  честное «не ищем в том, что канон объявил закрытым». Он снял 5 ложных хитов из 11 одной строкой.
- **Частичный ответ — штатный режим, а не исключение** (поймал владелец в первые же минуты пилота).
  Сервер НЕ умирает после первой отправки; документ перед КАЖДОЙ записью перечитывается с диска,
  иначе вторая запись затирает первую моделью, снятой при рендере страницы.
- **Снятие выбора радиокнопки ловится на `click` самого input, а не на `mousedown`**: кликабельна
  вся строка `<label>`, и до кружка событие мыши не доходит.
- **Поле «кто отвечает» на странице не нужно** — отвечает всегда владелец проекта (`owner` в конфиге).
