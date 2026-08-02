# QA suite — proving the contour, including the half a self-test cannot see

> **Why this file exists.** Every defect this contour ever shipped was green in its own self-tests.
> Three were caught only by live documents, two only by the owner's eyes, and one — the wake-up —
> by nothing at all until the owner said *«я дал тебе там ответы, но оно не дёрнуло тебя»*.
> A page is behaviour, and behaviour is observed in a browser, not inferred from source.

## 0. Two rules that outrank the whole check list

1. **Never write a check that cannot fail.** `check('server is up', … || true)` is not "good enough
   for now" — it ASSERTS, and it sends the next diagnosis in the wrong direction. Grep your own QA
   for `|| true`, `catch {}` and unconditional `pass()`.
2. **Never bind a check to the changing state of live data.** "Question Р5 is waiting" went red the
   hour the owner answered it. Rules belong in self-tests on fixtures; live runs assert STRUCTURE
   (counts, absence of crashes, no external loads), never content.

---

## 1. The check set that caught everything

| Block | What it asserts |
|---|---|
| **Core self-test** | normalization (four faces → one hash) · quiet hours across midnight · parsing (empty slot, `---` boundary, counter-question slot, multi-line options) · md rendering · metadata block · decision write-back |
| **BEFORE the click** | the answer is present in NONE of the three places ← without this pair, "answer found" paints any pre-existing history green |
| **Gate before approval** | refuses; the real sender refuses too, even under `--apply` |
| **Page × 2 themes × 2 widths** | cards render · options render · tables render · the state stripe is there BY PIXELS AND BY COLOUR · text/background contrast · no horizontal overflow of the body · console clean |
| **State tags** | every unanswered question carries `ждёт вас`; every answered one carries `отвечено`; the header counters equal the actual card counts |
| **Selection** | click highlights · **second click clears** · third selects again · a neighbour clears the previous · the `× сбросить` control does the same · clicking the LABEL TEXT behaves identically to clicking the circle |
| **Answer in one click** | reached all three places · provenance `by`/`at` present · **the original text is not overwritten** · a re-answer lands as a separate dated clarification |
| **🔴 Wake-up (I8)** | the contour TERMINATED BY ITSELF after the save, exit 0 — assert the process exit, not the file |
| **🔴 Endless wait (I9)** | with the default (no deadline) the contour ANNOUNCES it waits as long as needed and is still alive well past the old default · the repeated call fires ≥ 2 times under `--remind 2` and names how many questions remain · `SIGTERM` still ends it cleanly with code 10 (no orphans). Prove absence-of-death, not the infinity itself · wait for the "waiting" LINE, not for the URL — asserting right after the URL is a race with the output, and it will go red for the wrong reason |
| **Heartbeat vs. sleep** | pure-function cases: never fetched → no verdict · fresh beat → alive · silent past the tolerance → gone · **our own tick overslept → grace, not death** · after the grace the page must prove itself again |
| **Auto-close** | in an app window the page closes ~2 s after recording; in a plain tab the honest message appears instead of a silent hang. The platform truth underneath (`window.close()` really closes a `--app=` window) is only meaningful HEADFUL — run it headful once and **announce the skip out loud** otherwise: "green because we did not run it" is a lie, not a result |
| **Gate after approval** | passes · a text drift voids it · **CRLF + BOM do NOT break it** |
| **Option count** | candidate lines === parsed options **across ALL live documents** |
| **Live document** | a real interview, not a fixture; zero external loads in the built HTML |
| **Signal** | the WAV is three tones at 880/660/990 Hz (assert on the buffer, not on the ear) · quiet hours silence it · the signal does not delay the page (measure the gap between "page fetched" and "signal started") |
| **Guard** | new violation → red · exception with a reason → green · exception with an EMPTY reason → red · stale status → red · debt number printed |
| **Cleanup** | the run writes into decisions and REMOVES ITS OWN TRACE, with a check that the trace is gone |

---

## 2. Driving a real browser with zero dependencies

Node ≥ 22 has a global `WebSocket`, and every Chromium browser speaks the DevTools protocol over it.
That is the whole toolchain — no Playwright, no Puppeteer.

```js
// 1. launch                                            (headless for CI, headful to watch it work)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-qa-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dp}`,
  `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' });

// 2. wait for the debugger, then open a tab on our page
await until(() => fetch(`http://127.0.0.1:${dp}/json/version`).then(r => r.ok).catch(() => false));
const target = await (await fetch(`http://127.0.0.1:${dp}/json/new?${pageUrl}`, { method: 'PUT' })).json();

// 3. talk to it
const ws = new WebSocket(target.webSocketDebuggerUrl);
const send = (method, params) => new Promise(res => { /* id → resolve on matching response */ });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

// 4. assert facts, not impressions
const { result } = await send('Runtime.evaluate', { expression: `(${fn})()`, returnByValue: true });
```

Notes that save an hour each:

- **Console errors** arrive as `Runtime.consoleAPICalled` (level `error`) and `Log.entryAdded`.
  Collect both from the moment the tab opens; a clean console is a real check, not decoration.
- **A trusted click** is `Input.dispatchMouseEvent` (`mousePressed` + `mouseReleased`) at the centre
  of `getBoundingClientRect()`. Use it at least once **on the option's TEXT**, not on the circle:
  that is the exact path that broke the deselect mechanic in the field.
- **Colours** come from `getComputedStyle(el).borderLeftColor` / `backgroundColor` — deterministic
  and diffable, unlike a screenshot. Use `Page.captureScreenshot` only when a human will look.
- **Themes**: force with `Emulation.setEmulatedMedia {media:'page', features:[{name:'prefers-color-scheme',value:'dark'}]}`,
  then repeat the paint checks. Also flip the page's own toggle and assert it WINS over the media query.
- **Widths**: `Emulation.setDeviceMetricsOverride` at ~1440 and ~420 CSS px; assert
  `document.documentElement.scrollWidth <= clientWidth` (no horizontal escape of the body).
- **Contrast**: compute relative luminance of `--fg` over `--bg` and of code-block text over its own
  background; require ≥ 4.5:1. Dark-on-dark code blocks were caught by an owner, never by a self-test.
- ⚠️ **Kill the browser and remove its profile directory in a `finally`.** A QA run that leaves four
  orphaned processes is how the field learned that server-holding commands need `--no-serve`.

---

## 3. Mutations — a check that never failed proves nothing

Break the code on purpose, confirm the SPECIFIC checks go red, restore. Minimum five:

| Mutation | Must produce |
|---|---|
| Remove the dark-theme block | targeted failures in the dark-theme paint checks only |
| Disable the write-back into md | failures in "three places" and in "original not overwritten" |
| Restore single-line option parsing | failure of the option-count check — and note WHICH live document loses an option (in the field this mutation revealed the defect had also been eating an option in a second interview) |
| Introduce a NEW question outside the place of questions | the guard goes red on it and NOT on the baseline debt |
| Empty the `why` of a guard exception | the guard goes red on the exception itself |

Also mutate the wake-up: make `/submit` record and keep the server alive — the I8 check must go red.
This is the mutation nobody wrote in the field, which is why the defect shipped.

And mutate the sleep grace: delete the "our tick overslept" branch of the heartbeat verdict — exactly
one self-test case must go red ("the machine slept 8 hours ≠ the page died"). Without this mutation
the branch is a comment, not a guard: no other check in the suite can reach it, because no test can
put the machine to sleep.

---

## 4. Reporting the run

Print, in this order: total checks · failures with the exact assertion text · the debt number ·
what was left `[NOT-TESTED]` and why. Honesty here is load-bearing: the marker `[TESTED: date · how]`
is a claim `/fable-judge` will try to reproduce, and a check the agent cannot perform (the owner
hearing the signal from another room) stays openly unproven until a human confirms it — an exit code
is not a human.
