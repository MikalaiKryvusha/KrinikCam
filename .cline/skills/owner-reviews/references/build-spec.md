# Build spec — the owner-review contour, step by step

> **What this is.** The executable half of `/owner-reviews`. `SKILL.md` says what must hold; this
> file says what to type. It is a CONTRACT, not a retelling: follow the steps in order, keep the
> fixed values fixed, and you get the same tool two other projects already run. Deviating from a
> fixed value needs the owner's word, not your taste.
>
> **Provenance.** Distilled from three independent builds of the same contour (Nogamelabs → NDim →
> KrinikCam) and the field report written after the second one. Every ⚠️ below is a defect somebody
> already paid for; every 🔴 is a defect the OWNER caught, not the tests.
>
> Code samples are JavaScript because the reference implementations are Node with zero dependencies.
> Port them; do not re-derive the logic they encode.

---

## 0. The shape of what you build

```
tools/
  owner.mjs                 (or <name>.mjs) single entry point, all commands
  owner.config.json         owner name · voice · quiet hours · port · accent colour
  owner-guard-exceptions.json   explicit false-alarm suppressions, each WITH A REASON
  owner-guard-baseline.json     snapshot of inherited debt (the ratchet)
  owner-pages/              rendered HTML — DERIVED, gitignored
interviews/
  decisions/                machine memory of decisions (versioned!)
    <doc>.decision.json
    archive/<doc>--<ISO>.json
    _queue.json
```

Commands (names are yours, semantics are not):

| Command | Semantics |
|---|---|
| `guard [--json]` | every hanging question + the debt number. Exit 1 on NEW violations |
| `render <doc>` | build the page only. No browser, no sound, no server |
| `ask <doc> [...]` | page → browser → signal → **first save wakes you** (I8). Exit 0 = something recorded |
| `gate <doc> [--q <id>\|--artifact <id>]` | fail-closed check before dependent work |
| `queue <doc>` / `inbox [--no-serve]` | accumulate in loops · call once per batch |
| `selftest` | core: every guard is fed exactly its own defect |
| `verify` | QA with a REAL browser (see `qa-suite.md`) |
| `baseline` | (re)snapshot the debt; print the delta; the number must go down |

**Nothing here needs a dependency.** Markdown mini-renderer ≈ 120 lines. Local HTTP server: stdlib.
Sound: synthesized WAV. Browser: the one already installed.

---

## 1. Step 0 — measure the debt before writing a line

```bash
grep -rniE "ждёт (ответа|криника)|вопрос(ы)? к владельцу|нужен ответ|на ревю" plans bugs ideas researches
```

Sort the hits BY HAND into real and false. Write both numbers down. They decide two things:

- **the guard's construction** — if the real count is >0 (it always is; the field saw 26 and 4), the
  guard needs a baseline from day one, or it is red from birth and teaches itself to be ignored;
- **the honest payoff claim** — "the tool found N lost questions" only means something against this
  number.

Expect roughly as many false hits as real ones. That ratio is the reason the patterns below are
narrow.

---

## 2. Step 1 — the guard (first, because it pays first)

### 2.1. What to catch — two strong tells, not ten weak ones

1. **A queue heading** — `## ⛔ Ждёт владельца`, `## Открытые вопросы владельцу`. The cheapest and
   strongest signal: a section of questions inside a bug or a plan is literally what the canon bans.
2. **A direct address to the owner**, matched over the WHOLE line — "waiting for an answer/decision
   from <owner>", "ask <owner>", "on <owner>'s review", an answer slot outside the place of questions.

🔴 **A heuristic refuted in the field — do not import it blind.** The obvious narrowing is "the
marker must sit in the first ~40 characters of the line: a hanging question announces itself
immediately, a mention of one sits deep in prose". It sounds right and it silently dropped **two of
three real** hanging questions on the next project, because there they were written as the tail of a
status sentence ("Implementation has not started — waiting for the owner's answers on…", marker at
character 75). Match the whole line and kill false alarms with the baseline (2.2) and explicit
exceptions (2.4) instead. The rule above the rule: **validate any imported heuristic against the
questions you ALREADY KNOW are hanging — a guard that misses those is not a guard.**

**Do NOT catch:** prose mid-paragraph; lines that already point at the place of questions (contain
`interviews/` or "интервью №") — the question got where it belongs; files whose name carries the
canon's closed tag (`DONE`) — a question inside a closed document is history. That tag alone removed
5 false hits out of 11 in the field.

⚠️ **Non-ASCII word boundaries.** `\w` and `\b` in Node are ASCII-only even under the `u` flag. Use
`(?<!\p{L})…(?!\p{L})` with `u`, or the guard is silently blind to its own language. This is also
how you avoid the substring trap that once hid a hanging interview because the prose contained
"за**крыт**ие" and the guard was grepping for `ЗАКРЫТ`.

### 2.2. The debt ratchet (mandatory)

```json
// owner-guard-baseline.json
{ "generated": "2026-08-01T12:00:00+03:00",
  "items": [ { "key": "ideas/38_restream.md:9f2c1a…", "file": "ideas/38_restream.md", "why": "…" } ] }
```

- **Key = file + sha1(trimmed line text)**, never the line number. Editing the question means
  somebody got to it, and it legitimately re-enters the rule.
- The guard fails (exit 1) **only on keys absent from the baseline**.
- Every run prints `унаследованный долг: N` — and N must go down. Print it even when green.
- `baseline` regenerates the snapshot and prints the delta; a GROWN baseline is reported loudly, not
  silently accepted.

### 2.3. The second half of the guard — inside the place of questions

Read every interview and classify it. The declared truth is the STATUS line; the observed truth is
the emptiness of the answer slots. Disagreement between them is itself the finding:

| status says | empty slots | verdict | guard |
|---|---|---|---|
| waiting | > 0 | **hanging** — normal, this is the report | printed, exit 1 |
| waiting | 0 | 🔴 **STALE STATUS** — answered, still screaming "waiting" | printed, exit 1 (an agent fixes it in one edit) |
| answered / closed | > 0 | **partial** — legitimate, the owner skipped some | printed as info, exit unaffected |
| answered / closed | 0 | closed | silent |
| none | > 0 | hanging | printed, exit 1 |

🔴 The stale-status row is not theory: in the field it hid an interview for two days with twelve
answers already written into it, and it hid a second one that the contour itself had just answered.
An unanswered interview is NOT a violation — it is the report. A LYING status is a defect.

### 2.4. Exceptions

`{"exceptions":[{"file":"…","why":"…"}]}` — **a marker with an empty reason is itself a violation**,
otherwise the exception file becomes the way to shut the guard up. Prove it in the self-test.

### 2.5. Prove the guard with mutations (minimum three)

new violation → red · exception with a reason → green · exception with an EMPTY reason → red.

---

## 3. Step 2 — the core

### 3.1. Normalization and hash (write this FIRST, before either side exists)

```js
function normalizeBody(s) {
  return String(s)
    .replace(/^﻿/, '')                 // 1. BOM
    .replace(/\r\n?/g, '\n')                // 2. CRLF / CR → LF
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')   // 3. trailing blanks per line
    .replace(/^\n+/, '').replace(/\n+$/, '')                     // 4. blank lines at both ends
    + '\n';                                 // 5. exactly one final newline
}
const sha256 = t => crypto.createHash('sha256').update(normalizeBody(t), 'utf8').digest('hex');
```

**One function, one module, both sides call it.** ⚠️ The costliest defect of this contour was a page
hashing file bytes while the sender hashed normalized text: both self-tests green, the gate refusing
every artifact forever, and only an end-to-end pilot on real data found it.

Self-test obligation: **four faces of the same text produce ONE hash** (CRLF · BOM · extra trailing
blank lines · missing final newline), and a changed text produces a different one.

### 3.2. Parsing the document — where you will get burned

Write the parser against an INVENTORY of live files, never against one sample. The field inventory:
four shapes of the answer slot and five shapes of the status line in fifteen files.

- **A question block is closed by a heading OR by a horizontal rule (`---`).** ⚠️ Without the rule,
  the rule itself lands inside the answer text and an empty question reads as answered — across ten
  live interviews that produced a triumphant "0 unanswered".
- **A slot labelled as a counter-question** (`**Ответ (вопрос владельца):**`) is NOT an answer slot.
  ⚠️ In the field this made the wave's only blocking question look closed.
- **A following list item is not an answer.** A greedy "everything until the next heading" scan
  counts the next bullet as the answer to the previous one.
- **Answer options are parsed MULTI-LINE.** Assemble the logical item first — the line plus its
  indented continuations — and only then look for the closing `**`:

  ```js
  // ⚠️ single-line matching silently DROPS an option whose bold label wrapped to line 2.
  // The one that vanished in the field was the recommended one, and every check said "options rendered".
  function logicalItems(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) { out.push({ i, text: lines[i] }); continue; }
      let text = lines[i];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) &&
             !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1])) text += ' ' + lines[++i].trim();
      out.push({ i, text });
    }
    return out;
  }
  ```

- **Count, do not look.** Keep a `candidates` counter — a SECOND, deliberately naive, line-based
  implementation of the same syntax — and assert `candidates === parsedOptions` (compare the count
  BEFORE de-duplication on both sides) **across ALL live documents**. Two rules make it work:
  **(a) the two implementations must be independent** — if both call one function the check is a
  tautology and proves nothing; **(b) the key must be a STANDALONE TOKEN at the start of the bold**
  (`(а)` · `A)` · `б.`), otherwise every bold word beginning with a letter (`**Вариант A — …**`,
  `**Q1.**`, `**Камера (USB UVC)**`) becomes a false candidate, and a false alarm teaches ignoring.
  In the field this one check found three live shapes that were losing options silently — including
  a table cell written as `| **A (выбрано)** | …` and `| **(б) до победы** | …`, where the narrow
  "the cell equals the key" template dropped the option without a word.
- **Regexes over your own language** use `\p{L}` with the `u` flag (see 2.1).
- **The body hash excludes the answer** — otherwise the answer breaks its own hash and the gate
  closes on the very decision it was supposed to open.

### 3.3. Recording a decision — into THREE places

1. **Back into the source md**, signed with provenance:
   `_recorded by the contour `/owner-reviews` · by <owner> · at <ISO>_`
2. **`<doc-basename>.decision.json` beside it** — the file the gate reads. The name is DERIVED from
   the document name; a shared decision file is overwritten by the next interview.
3. **A copy in `archive/<doc-basename>--<ISO>.json`** — append-only, never overwritten.

```json
{ "kind": "interview", "document": "interviews/interview_017_x.md",
  "by": "Криник", "at": "2026-08-01T18:22:03+03:00",
  "answers":   { "В1": { "choice": "а", "text": "", "comment": "", "sha256": "…", "at": "…" } },
  "artifacts": { "release-notes": { "status": "approved", "sha256": "…", "comment": "" } },
  "document_comment": [ { "at": "…", "text": "…" } ] }
```

🔴 **The owner's already-written words are NEVER overwritten.** A re-answer arrives as a separate
dated clarification block under the original; the original stays verbatim. The document-wide comment
is appended as its own dated block at the END of the file and comments accumulate. (The neighbouring
rule from the same class: the owner's source document is committed VERBATIM before the agent edits
anything — one project destroyed uncommitted owner answers with a single `git checkout --`.)

⚠️ **Re-read the document from disk before EVERY write.** The model captured at render time goes
stale the moment the first answer lands, and the second write silently reverts the first.

⚠️ **Reproduce the slot's own shape when writing.** If the owner writes `- Ответ Криника:` without
bold, the contour's answer must not turn it bold. The document is the owner's artifact; it does not
change style because the answer arrived from a page.

---

## 4. Step 3 — the page

### 4.1. Non-negotiables

- **Self-contained.** Zero external loads: no CDN, no web font, no remote image. It must open offline
  from a file. Assert this in the self-test with a regex over the built HTML.
- **Both OS themes** via `prefers-color-scheme`, all colours as variables, plus a manual toggle that
  sets `data-theme` on the root and WINS over the media query in both directions.
- **No horizontal scroll of the body.** Tables, code blocks and media scroll inside their own
  `overflow-x:auto` container.
- **Embed an empty favicon** (`<link rel="icon" href="data:,">`). Without it the browser asks for
  `/favicon.ico`, gets a 404 from your tiny server and logs an error — and then your "clean console"
  check is either red for a non-reason or, worse, quietly relaxed until it stops meaning anything.

### 4.2. The element set (this is the "same tool everywhere" part)

```
┌ header ────────────────────────────────────────────────────────────┐
│ H1 document title                                    [тема]        │
│ path/to/document.md                       (monospace, dimmed)      │
│ asked by the agent · <date>   ⟨ждут вас: N⟩ ⟨отвечено: M⟩          │
└────────────────────────────────────────────────────────────────────┘
┌ intro card — the document's PREAMBLE (everything before question 1) ┐
│ why this is being asked · mock-ups · audio samples · constraints    │
└────────────────────────────────────────────────────────────────────┘
┃ ← 4–5 px STATE STRIPE, colour = state
┃ ┌ question card ───────────────────────────────────────────────┐
┃ │ (В1)  Heading of the question              ⟨ждёт вас⟩        │
┃ │ …rendered markdown body: prose, tables, quotes, code…        │
┃ │ [ embedded media, if any: audio / image / srcdoc frame ]     │
┃ │ ─ Твой выбор ── (повторный клик снимает)                     │
┃ │ ( ) (а) option one            ⟨рекомендация агента⟩          │
┃ │ (•) (б) option two                                           │
┃ │ ─ Свой ответ / уточнение ──                                  │
┃ │ [ textarea                                              ]    │
┃ │ ─ Комментарий ──                                             │
┃ │ [ textarea                                              ]    │
┃ └──────────────────────────────────────────────────────────────┘
┌ outro card — the document's EPILOGUE (everything after the last ---)┐
│ the key to a blind comparison · caveats · where this came from      │
└────────────────────────────────────────────────────────────────────┘
┌ document-wide comment ─────────────────────────────────────────────┐
│ «ответов нет, но есть что сказать» — legitimate outcome on its own │
└────────────────────────────────────────────────────────────────────┘
┌ fixed bottom bar ──────────────────────────────────────────────────┐
│           [ Записать ответы ]   [ Готово, закрыть ]                │
└────────────────────────────────────────────────────────────────────┘
```

**There is NO "who is answering" field.** The owner answers; the server writes `by` from config.

🔴 **Render the PREAMBLE and the EPILOGUE, not only the question cards.** A page built from question
sections alone silently drops everything before the first question and after the last one — which is
exactly where the CONTEXT of the decision lives: why it is being asked, the mock-ups, the audio
samples, the key to a blind comparison. Caught on two live interviews where the owner would have
seen zero of the images and zero of the sound he was asked to judge. Convention: preamble = from the
top (minus the H1 title and the metadata block) to the first question; epilogue = everything after
the final `---` that follows the last answer slot.

State tag and stripe colour, one table for both:

| state | tag | stripe |
|---|---|---|
| waiting for the owner | `ждёт вас` | warn (amber) |
| already answered in the document | `отвечено` | ok (green) |
| recorded during this session | `записано ✅` | ok (green) |

### 4.3. Style tokens (fixed; only `--accent` is the project's own)

```css
:root{--bg:#f7f7f9;--fg:#16161a;--muted:#5d5d6b;--card:#fff;--line:#e3e3ea;
      --code-bg:#f0f0f4;--ok:#12855b;--warn:#b45309;--accent:<project brand colour>}
@media (prefers-color-scheme:dark){:root{--bg:#131317;--fg:#ececf0;--muted:#a0a0b0;--card:#1c1c22;
      --line:#2e2e38;--code-bg:#26262f;--ok:#3ddc9a;--warn:#f0b429}}
:root[data-theme=light]{ …light values… }   /* the toggle must win over the media query */
:root[data-theme=dark] { …dark values…  }
```

Card: `border-radius:14px`, `padding:18px 20px`, 1 px `--line` border, left stripe as
`border-left:5px solid <state colour>`. Body font: system stack, 16px/1.6. Content column
`max-width:940px`. Buttons: primary filled `--accent`, secondary ghost.

### 4.4. 🔴 The deselect mechanic (defect #1 in every field build)

**Rule: listen for `click` ON THE INPUT and remember whether it was selected BEFORE this click.**

```js
// A native radio cannot be deselected. Partial answering is the normal mode, so this is mandatory.
document.querySelectorAll('input[type=radio]').forEach(r => {
  r.addEventListener('click', () => {
    // At click time the browser has ALREADY applied the selection; dataset.on is the previous state.
    if (r.dataset.on === '1') { r.checked = false; r.dataset.on = ''; sync(r); return; }  // 2nd click clears
    document.getElementsByName(r.name).forEach(o => { o.dataset.on = ''; });
    r.dataset.on = '1'; sync(r);
  });
});
```

Why exactly this and not the two obvious alternatives:

- ⚠️ **`mousedown` on the input does not fire when the owner clicks the label text** — and the whole
  row is a `<label>`, which is the point. One project shipped `mousedown` and the owner reported the
  selection could not be cleared.
- ⚠️ **A listener on the label (or on the document) fires TWICE** for one click on the text: once for
  the label, once for the synthetic click the label dispatches to its input. Two toggles = no toggle.
  If you must listen higher up, skip events whose target is the label.
- `sync(r)` re-paints the chosen row's highlight — that highlight is the ONLY feedback the choice
  needs.
- 🔴 **No separate "clear" button, and no focus ring on the radio.** Both were shipped and both were
  rejected by the owner within minutes of the first live page: the extra button is clutter next to a
  mechanic that already works, and the accent-coloured focus outline draws *«маленький розовый
  квадратик»* around the circle — «напрягает». Scope the focus outline to text fields only
  (`textarea:focus, input[type=text]:focus`) and set `input[type=radio]{outline:none}`. The generic
  `input:focus` selector is the trap: it silently includes radios.

**Verify this in a real browser** (`qa-suite.md` §2): click → selected · click again → cleared ·
third click → selected · neighbour clears the previous. An agent cannot see a browser by reasoning.

### 4.5. Embedded media — because taste is not judged from a description

Whatever the owner must JUDGE is embedded, not linked. A `file://` link from a page served over http
is blocked by the browser, so embedding is not a luxury — it is the only working path.

- **audio** → `<audio controls src="data:audio/wav;base64,…">`. Blind labels, key at the end of the
  document. Somebody judging a sound needs the sound, not an adjective.
- **images** → `<img src="data:image/png;base64,…">`, inside a scrolling container.
- **live mock-up** → `<iframe srcdoc="…" sandbox>`. Two buttons on the frame: *открыть отдельным
  окном* (the script opens it, so the script can close it) and *во весь экран*.
- ⚠️ The owner's own boundary, worth quoting: *«макеты-выборы среди 4 вариантов можно и отдельным
  экраном открывать, а внутри вопросов быстрый просмотр каких-то более мелких решений»* — an inline
  frame is for a quick look; a choice among four mock-ups gets its own window.

### 4.6. Submit, wake-up and auto-close

```
[Записать ответы] → POST /submit
   ├ nothing filled            → toast "пока нечего отправлять", page stays
   ├ recorded (full OR partial) → server writes 3 places, answers {ok, recorded[], remaining, autoClose}
   │     → cards flip to «записано ✅»
   │     → final screen: "Записано. Закрываю окно…" + 2 s countdown
   │     → autoClose ? window.close() : honest "браузер не даст закрыть эту вкладку — можно закрыть её"
   │     → SERVER CLOSES AND THE PROCESS EXITS 0  ← I8, this is the whole point
   └ error                     → toast with the reason, page stays, nothing lost
[Готово, закрыть] → POST /done → nothing self-approves; exit 8; the guard will show the rest
```

- **Auto-close works only in an app window.** A browser lets `window.close()` succeed only on a
  window opened by script. In a normal tab, promise nothing: say so plainly. Detect the failure —
  call `close()`, then after 300 ms check `document.visibilityState`/still-alive and swap in the
  honest message.
- **Partial answers do not keep the contour alive.** The owner answers what they are ready to decide;
  the contour records it, closes, and wakes the agent. Whatever is left is re-opened BY THE AGENT.
  ⚠️ This is the exact opposite of "let the page hang, they will answer when they feel like it" — the
  field version did that and the answer lay on disk for 12 minutes with nobody coming for it.

### 4.7. Launching the browser — the ladder

1. Find an app-window-capable browser (Chrome / Chromium / Edge / Brave — first one present).
2. Launch: `open -na "Google Chrome" --args --app=http://127.0.0.1:<port>/`
   (Linux: `google-chrome --app=…`; Windows: `start "" chrome --app=…`). Set `autoClose = true`.
3. **Wait for the first GET of the page** — up to ~3.5 s. The browser fetching it is the proof it is
   on screen; "we asked the OS to open it" is not.
4. No GET in time → fall back to the default browser (`open <url>`), set `autoClose = false`.
5. Only now signal (I5).

---

## 5. Step 4 — the gate (fail-closed)

One function `checkApproval(document, target)` called by BOTH the gate command and the real sender.
Refuse — non-zero, distinct exit codes — when: no decision file · no answer for this question/artifact
· status not `approved` · the artifact vanished from the document · the body file is gone · **the hash
drifted** · any unexpected error. It never throws; it returns a refusal.

The sender must have a REAL addressee (a release, a ticket, a post) and must refuse **even under an
explicit `--apply`**. Without a real consumer the gate is decoration.

Suggested exit codes: `0 ok · 2 no decision · 3 no answer · 4 rejected · 5 drifted · 6 no document`.

---

## 6. Step 5 — the signal

### 6.1. Order

**page on screen → sound → voice**, notification fired in parallel. The sound is mandatory and comes
first: OS notification settings mute native banners SILENTLY and with a success exit code. Print the
call in plain text to the console too — an exit code does not prove a human heard anything.

⚠️ **The signal must never hold the page.** Spawn detached and do not wait; chain sound → voice on
the process `close` event so they do not overlap. One field version ran them synchronously and the
owner listened to an invitation to a page that was not open yet: *«страница не открылась, пока голос
не проигрался — тупо»*.

### 6.2. The sound is FIXED: three beeps, 880 / 660 / 990 Hz

Synthesize it; do not pick a system file (they differ per OS and per machine, and the owner asked for
ONE sound everywhere). 120 ms per tone, 60 ms gap, 8 ms fade in/out (a hard edge clicks), amplitude
~0.35, 44100 Hz, 16-bit mono PCM:

```js
function beepWav(freqs = [880, 660, 990], toneMs = 120, gapMs = 60, rate = 44100, amp = 0.35) {
  const s = [], fade = Math.round(rate * 0.008);
  freqs.forEach((f, k) => {
    const n = Math.round(rate * toneMs / 1000);
    for (let i = 0; i < n; i++) s.push(Math.sin(2 * Math.PI * f * i / rate) * amp * Math.min(1, i / fade, (n - i) / fade));
    if (k < freqs.length - 1) for (let i = 0; i < Math.round(rate * gapMs / 1000); i++) s.push(0);
  });
  const data = Buffer.alloc(s.length * 2);
  s.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
// play: macOS `afplay f.wav` · Linux `aplay -q f.wav` · Windows PowerShell (New-Object Media.SoundPlayer f.wav).PlaySync()
```

The same buffer, base64-embedded, is what the page uses for its own confirmation blip if you add one.

### 6.3. The voice — a parameter, and a ladder

1. **Local neural TTS of a neighbouring project on the same machine** (e.g. Silero v5, offline, CPU),
   invoked as a COMMAND. Never copy the model or the venv: a copy gives two truths and two places to
   fix. If the neighbour is absent, fall through silently.
2. **System synthesizer** — `say -v <voice> -f <file>` (macOS) · `spd-say`/`espeak` (Linux) ·
   SAPI via PowerShell (Windows).
3. Nothing available → sound only, and say so in the console.

What is spoken is the owner's call; a working default is *type of document + its title*
("вас зовёт интервью: …"), where the type comes from the metadata block or from the directory.

⚠️ **The text goes to the synthesizer as a FILE, never as a command-line argument.** Non-ASCII in
`argv`, in `python -c`, in `echo "…" >` is mangled before the program ever sees it. The command line
itself stays ASCII.

⚠️ If you borrow a neighbour's voice path, read its `bugs/` in full first. Four closed bugs there
(text with no letters or digits; cp1251 garbling; digits silently swallowed until "56 → fifty-six"
normalization; markup leaking into speech) each equal one hour of your own triage.

### 6.4. Quiet hours (I6)

```js
const inQuiet = (now, from, to) => {           // the window CROSSES MIDNIGHT
  const m = s => { const [h, x] = String(s).split(':').map(Number); return h * 60 + (x || 0); };
  const c = now.getHours() * 60 + now.getMinutes(), f = m(from), t = m(to);
  return f === t ? false : (f < t ? (c >= f && c < t) : (c >= f || c < t));   // ← the second branch IS midnight
};
```
Self-test it on both sides of midnight and on a normal window: 23:30 quiet · 08:00 quiet · 12:00 loud
· 22:59 loud · normal 09:00–23:00 at 12:00 quiet. Quiet hours override an explicitly requested voice.

---

## 7. Step 6 — accumulation and the wake-up (one design)

- The queue is a **state file** listing document paths. ⚠️ Do NOT move live documents into a
  `pending/` folder: it breaks every link to them from status, plans and bugs. The "loops accumulate,
  never block" invariant holds without moving anything.
- `inbox` opens ONE page for the whole batch: one card per document, one call for all of them.
- **I8 applies to the batch too:** the owner answers one document, the contour records, closes and
  wakes the agent. If the queue still has items, the AGENT re-opens it. A batch page that lives for
  hours is the bug this invariant exists for.
- ⚠️ **Any command that by design holds a server needs `--no-serve`** ("build and exit"). Otherwise
  every synchronous caller — your own QA run first of all — hangs forever, and you get orphaned
  processes. Give every child call inside the guard a hard deadline for the same reason.

Exit-code contract for `ask`/`inbox`: `0` something was recorded (the agent may continue) · `7`
timeout, nothing recorded · `8` the owner closed the page without recording. **Nothing self-approves
by timeout, ever.**

---

## 8. Step 7 — pilot on real data (the handover condition)

- Run `render` over **every** live document in the place of questions. Zero crashes, and no answered
  interview reporting "questions: 0".
- Run the option-count assertion over the same set (§3.2).
- Hand the page to the owner and watch. In the field, twenty minutes of a live owner produced four
  defects that were invisible from the inside — including two of the four in this skill's fixed list.
- Then, and only then, write the executable command into the rituals (`/resume`, `/end-chat`, the
  loops). **A tool is adopted when a ritual carries its command**, not when it works.

---

## 9. Platform traps (cost measured in hours)

| Trap | Symptom | Rule |
|---|---|---|
| Non-ASCII through `argv` / `python -c` / `echo >` | `SyntaxError: (unicode error)`, or worse: silently mangled text in the file | text travels as a FILE, the command line stays ASCII |
| Backticks inside double quotes in a shell | shell command substitution eats a chunk, prints "ok", leaves HOLES in the document | never; and RE-READ the result after any machine edit of a non-ASCII document |
| A backtick in a comment INSIDE a template literal (JS) | the page string terminates early, the module dies | keep page CSS/JS free of stray backticks |
| CRLF | git hands you `\r\n`, `\n`-anchored regexes miss silently | normalize first (§3.1) |
| Finding a process by command-line substring | the search finds itself | filter by process NAME first |
| A synchronous call to a server-holding command | hangs forever, orphaned children | `--no-serve` + hard deadlines (§7) |

---

## 10. Sizing (for planning)

One session, including seven defects and six owner corrections along the way: ~1 700 lines in five
files, zero dependencies; 118 live-browser checks + 40 core self-tests, proven by 5 mutations. What
paid off first, before the first page existed: **the guard**.

> The one line worth carrying out of here: **a contour that accepts the human's answer but does not
> wake the waiting agent is half-built — and the missing half is invisible to every check.** When you
> design any human → agent contour, do not ask "did it reach the disk"; ask **"what physically wakes
> the one who is waiting"**, and guard exactly that.
