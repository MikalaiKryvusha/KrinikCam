#!/usr/bin/env node
// prompt-refresh-timer.mjs — the hourly refresh timer hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: UserPromptSubmit.
//
// What it does: mechanizes trigger 1 of the refresh canon ("refresh at least once an hour" —
// AGENT_GUIDE.md → "Context refresh"). On every prompt it reads the AGE of the refresh witness
// `.kaif/refresh-marker.json`; if the last refresh is older than the interval (or the marker is
// missing — this session never refreshed), it injects an ORDER to refresh before starting the
// work. A fresh marker → no output at all: silence is the normal state.
//
// Predicate (anti-noise): marker age > REFRESH_INTERVAL_MIN. Cooldown: the marker itself —
// only the FACT of a refresh (agent re-stamps the marker) resets the clock, so the order
// repeats on every prompt until obeyed, by design: a reminder that goes away unobeyed teaches
// that it can be ignored.
//
// Interval: 60 minutes (the canon's "at least once an hour"); override per project with
// `--minutes N` in the hook's args if the owner wants a different cadence.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `hook_event_name`, `cwd`; stdout on
// exit 0 — {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext":
// "…"}}. A hook must never break the session: any internal error → exit 0 silently.
// [TESTED: 2026-08-07 · polygon s14: fresh marker → silent; missing marker → order ("no refresh
//  witness"); marker older than the interval → order naming the age; MALFORMED marker → judged by
//  the file's mtime instead, so malformed+fresh is SILENT and malformed+old speaks — the "old" half
//  was claimed here before any assert fed it; s14 asserts it since 2026-09-18 (origin bug 121), along
//  with a BOM-led event and a BOM-led marker reading exactly like their clean twins; report of those
//  runs - testcases/reports/2026-09-18_hooks-optin-smoke.md (origin repository), runs 4, 5 and 9]
//
// PORTABILITY — `--emit <shape>` (epic O phase O5, contracts live-fetched 2026-08-07). The
// timer is the hook systems disagree about MOST: only two of the surveyed systems let a
// per-turn hook inject context at all.
//   claude (default) — Claude Code AND OpenAI Codex (identical field names, `UserPromptSubmit`)
//   antigravity      — Google Antigravity CLI, event `PreInvocation` (fires before each model
//                      call): {"injectSteps": [{"ephemeralMessage": "…"}]} — the array holds
//                      objects, and `ephemeralMessage` is the right member for an order that
//                      must steer this turn without settling into the transcript.
// Cursor (`beforeSubmitPrompt` → only `continue`/`user_message`) and GitHub Copilot
// (`additionalContext` is not permitted on `userPromptSubmitted`) cannot carry this hook at
// all — they ship the session-start hook only, and .kaif/hooks/README.md says so per system.
//
// 2.9, epic HK (origin ticket #94, bugs 119 no. 1-2): the marker is read in the PROJECT ROOT, not in the event's `cwd` — one `cd src`
// by the agent moved `cwd` and the timer answered every prompt with "no refresh witness" while the root marker was fresh; the order
// names the marker by its FULL path, so the agent stamps it where this hook reads it. A marker `at` later than now is no witness: a
// zone slip stamped "…Z" over local digits lies hours ahead, and a future `at` used to silence the timer until that moment came.
// [TESTED: 2026-09-28 · suite s14: an event from <root>/src/deep reads like one from the root (fresh marker - silent, 2 h - the
//  order with the age), the order names the marker by its full path, an `at` 30 min ahead with a fresh mtime gives the order, 30 s
//  ahead stays silent; red on the v2.8 core; mutants M22-M23; on the live origin tree an event from tools/sandbox with the root
//  marker 21 min old - silent, where the v2.8 timer printed "no refresh witness found"; report testcases/reports/2026-09-28_hk-hooks-project-root.md (origin repository)]
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const OUTPUT_CAP = 10000;           // Claude Code caps hook output strings at 10 000 characters
const DEFAULT_INTERVAL_MIN = 60;    // the canon's "refresh at least once an hour"
const MARKER = '.kaif/refresh-marker.json';
const DEPLOYMENT = join('.kaif', 'kaif.json');  // the deployment marker: its directory IS the project root
const FUTURE_TOLERANCE_MIN = 2;     // an `at` further ahead than this is no witness (two processes of one machine share a clock;
                                    // a zone slip is whole hours, so two minutes separates the two without false alarms)

// The project root, not the event's `cwd`: the nearest ancestor of `cwd` (itself included) that holds the deployment marker;
// none → `cwd` itself, as before. Twins — the same function in stop-status-guard.mjs, session-start-refresh.mjs and
// prompt-resume-word.mjs (the module keeps self-contained scripts; suite s14 feeds each an event from a subfolder).
function projectRoot(cwd) {
  for (let d = resolve(cwd); ;) {
    if (existsSync(join(d, DEPLOYMENT))) return d;
    const up = dirname(d);
    if (up === d) return cwd;
    d = up;
  }
}

// Same order, different envelope per system — see the PORTABILITY note above.
const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
  antigravity: (order) => ({ injectSteps: [{ ephemeralMessage: order }] }),
};

try {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--minutes');
  const intervalMin = mi !== -1 && Number(argv[mi + 1]) > 0 ? Number(argv[mi + 1]) : DEFAULT_INTERVAL_MIN;
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let cwd = process.cwd();
  try {
    // A leading U+FEFF is dropped before the parse (Windows PowerShell 5.1 puts it in front of any
    // string piped into a native command; RFC 8259 §8.1 lets a parser ignore it) — origin bug 119.
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}');
    if (input.cwd) cwd = String(input.cwd);
  } catch { /* unreadable stdin — fall back to process.cwd() */ }

  const markerPath = join(projectRoot(cwd), MARKER);
  // Age of the last refresh: the marker's own `at` field is the truth; a malformed field falls
  // back to the file mtime; a missing file means "never refreshed" → infinitely stale.
  let ageMin = Infinity;
  try {
    let at = NaN;
    // (same BOM tolerance as stdin: a marker written by `Set-Content -Encoding UTF8` carries one, and a
    // parse failure here would silently swap the marker's own `at` for the file mtime)
    try { at = Date.parse(JSON.parse(readFileSync(markerPath, 'utf8').replace(/^\uFEFF/, '')).at); } catch { /* malformed JSON/at */ }
    if (Number.isNaN(at)) at = statSync(markerPath).mtimeMs;
    ageMin = (Date.now() - at) / 60000;
  } catch { /* no marker at all — stays Infinity */ }

  const future = ageMin < -FUTURE_TOLERANCE_MIN;
  if (future || ageMin > intervalMin) {
    const ageLabel = future ? `the marker "at" lies ${Math.ceil(-ageMin)} min in the future - no witness`
      : ageMin === Infinity ? 'no refresh witness found this session' : `last refresh ${Math.round(ageMin)} min ago`;
    const order =
      `KAIF context refresh (timer: ${ageLabel}, interval ${intervalMin} min). Before starting on this prompt: ` +
      `re-read the re-read core (AGENT_GUIDE.md → "Context refresh"), re-stamp ${markerPath} ` +
      `{ "at": "<ISO>", "docs": [...], "trigger": "hour" } and put the acceptance quote in the chat — one concrete ` +
      `line from what you re-read, relevant to the task. This reminder repeats until the marker is actually refreshed.`;
    // Unknown shape → reference envelope (see session-start-refresh.mjs for the reasoning).
    const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'UserPromptSubmit');
    if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
  }
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
