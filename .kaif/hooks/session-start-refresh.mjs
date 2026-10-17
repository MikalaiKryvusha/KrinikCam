#!/usr/bin/env node
// session-start-refresh.mjs — the "canon after compaction" hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: SessionStart, matcher
// `compact|clear` (the sample config in .kaif/hooks/README.md wires exactly that).
//
// What it does: after a context compaction or /clear the session holds a RETELLING of the
// canon, not the canon — this hook injects an ORDER to re-read the re-read core and stamp the
// two-part refresh witness (AGENT_GUIDE.md → "Context refresh"). It injects the ORDER only,
// never document bodies: additionalContext is capped at 10 000 characters, and pasting docs
// would spend the very context the refresh is meant to restore.
//
// Predicate (anti-noise): none beyond the config matcher — compaction/clear is itself a rare
// event, so every firing is signal. Cooldown: the refresh marker; a session that obeys the
// order resets the timer hook's clock as a side effect.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `hook_event_name`, `source`, `cwd`;
// stdout on exit 0 — {"hookSpecificOutput": {"hookEventName": "SessionStart",
// "additionalContext": "…"}}. A hook must never break the session: any internal error → exit 0
// silently.
//
// PORTABILITY — `--emit <shape>` (epic O phase O5, contracts live-fetched 2026-08-07): the
// PREDICATE and the order text are identical everywhere; only the JSON envelope differs per
// agent system, so the shape is named EXPLICITLY by the sample config rather than guessed from
// stdin. A hook must exit silently on anything unclear, so a wrong guess would fail invisibly —
// an explicit flag fails loudly at review time instead. Shapes:
//   claude (default) — Claude Code AND OpenAI Codex: both read
//                      {"hookSpecificOutput": {"hookEventName": …, "additionalContext": …}}
//   cursor           — {"additional_context": …} (flat, snake_case; `sessionStart` only)
//   copilot          — {"additionalContext": …}  (flat, camelCase; `sessionStart` only)
// Systems whose session-start event cannot inject at all (Windsurf, Cline) get no sample: see
// .kaif/hooks/README.md. Unknown shape → treated as `claude`, never as silence.
// [TESTED: 2026-08-07 · polygon s14: stdin JSON piped in → stdout order names the re-read core, the marker and the quote; length under the cap]
//
// 2.9, epic HK (origin bugs 120 no. 1, 119 no. 1, ticket #94): the order says what HAPPENED, by the event's `source` — `compact` →
// "compacted" and trigger `compaction`, `clear` → "cleared" and `ritual:/clear`; `startup`, `resume`, any other value and an event
// without the field → "(re)started" and `ritual:session-start` (the canon's trigger list is closed, its `ritual:` prefix is the open
// door). Before, every source but `clear` was told "the context was just compacted" — a lie on each session start of the systems whose
// sample wires no matcher (Cursor, Copilot). The marker is named by its FULL path in the project root.
// [TESTED: 2026-09-28 · suite s14: startup, resume and an event without `source` - "(re)started" and ritual:session-start, compact
//  from <root>/src/deep - "compacted", compaction and the root marker by its full path; red on v2.8; mutants M24-M25; report testcases/reports/2026-09-28_hk-hooks-project-root.md (origin repository)]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const OUTPUT_CAP = 10000; // Claude Code caps hook output strings at 10 000 characters
const DEPLOYMENT = join('.kaif', 'kaif.json');  // the deployment marker: its directory IS the project root
// source → [what happened, the trigger the agent stamps]; anything else → SESSION_START
const WORDING = { compact: ['The context was just compacted', 'compaction'], clear: ['The context was just cleared', 'ritual:/clear'] };
const SESSION_START = ['The session just (re)started', 'ritual:session-start'];

// The project root, not the event's `cwd` — twin of prompt-refresh-timer.mjs (the reasoning is there).
function projectRoot(cwd) {
  for (let d = resolve(cwd); ;) {
    if (existsSync(join(d, DEPLOYMENT))) return d;
    const up = dirname(d);
    if (up === d) return cwd;
    d = up;
  }
}

// One order string, four envelopes. Keeping this table next to the writer (rather than in a
// shared lib) keeps the module at three self-contained scripts — a fourth file would have to be
// registered through the whole delivery circle for six lines of JSON shaping.
const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
  cursor: (order) => ({ additional_context: order }),
  copilot: (order) => ({ additionalContext: order }),
};

try {
  const argv = process.argv.slice(2);
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let source = '';   // unreadable event or no `source` field → the neutral wording: an unknown event is not a compaction (bug 120)
  let cwd = process.cwd();
  try {
    // A leading U+FEFF is dropped before the parse (Windows PowerShell 5.1 puts it in front of any
    // string piped into a native command; RFC 8259 §8.1 lets a parser ignore it). Unstripped, a
    // `clear` event fell back to the default and ordered the WRONG trigger stamp — origin bug 119.
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}');
    if (input.source) source = String(input.source);
    if (input.cwd) cwd = String(input.cwd);
  } catch { /* unreadable stdin — the neutral wording; the order still stands */ }

  // The words and the trigger value follow the ACTUAL event: a marker stamped "compaction" after a
  // /clear or on a plain session start would misreport why the refresh happened.
  const [happened, trigger] = Object.prototype.hasOwnProperty.call(WORDING, source) ? WORDING[source] : SESSION_START;
  const markerPath = join(projectRoot(cwd), '.kaif', 'refresh-marker.json');
  const order =
    `KAIF context refresh (SessionStart${source ? ':' + source : ''}). ${happened}: ` +
    `what this session now remembers of the canon is a retelling, not the canon. BEFORE task work: ` +
    `(1) re-read the re-read core (tier 1 of the document taxonomy — see AGENT_GUIDE.md → "Context refresh"); ` +
    `(2) stamp ${markerPath} { "at": "<ISO>", "docs": [...], "trigger": "${trigger}" }; ` +
    `(3) put the acceptance quote in the chat — one concrete line from what you re-read, relevant to the current task. ` +
    `A marker without the quote is fraud of the false-[TESTED] class (/fable-judge hunts it).`;

  // Unknown shape falls back to the reference envelope: printing SOMETHING the reference system
  // understands beats printing nothing, and a typo in a sample config stays visible.
  const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'SessionStart');
  if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
