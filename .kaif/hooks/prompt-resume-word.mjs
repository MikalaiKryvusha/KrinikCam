#!/usr/bin/env node
// prompt-resume-word.mjs — the "leading word is an order" hook (KAIF 2.7, epic RS; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: UserPromptSubmit.
//
// What it does: mechanizes the canon rule "A leading skill word is an order" (AGENT_GUIDE.md →
// next to "The form of an obligation"). The owner opens a chat with the bare word `resume` (or
// its Russian shorthand, "rezyum…") and writes the task below it; a session that reads the word as
// a TOPIC starts the task and skips the entry ritual — it then works without the canon, the
// owner's queue, the creed and the prayer. This hook reads the FIRST WORD of the prompt and, when
// it is the resume word, injects an ORDER: run /resume in full BEFORE any work on the rest of the
// message. Any other message → no output at all: silence is the normal state.
//
// Predicate (anti-noise): the prompt's first word is `/resume`, `resume` or the Russian shorthand
// "rezyum…" (any case; leading whitespace tolerated). The word ANYWHERE ELSE in the message is prose — the kick's
// boundary ("a command word mid-sentence is not a command", /kaif-go) holds unchanged, and the hook
// never fires on it. No cooldown: every message that opens with the word is a separate order (the
// owner writes it once per chat by design). No `prompt` field in the event → silent: a predicate
// over text cannot be guessed without the text, and a guess would fire on every prompt.
//
// Field origin (the origin's owner, 2026-09-18, rendered from Russian): "when I start a chat and
// just write the word resume at the top and below it what we do, agents often do not run the
// resume skill — and that is exactly why I write it there. If I write it, I REQUIRE the agent to
// run that skill before starting the work."
//
// Contract (Claude Code — the sibling hooks' contract was live-fetched 2026-08-07; the
// UserPromptSubmit event carries the user's message text in `prompt`): stdin — JSON with
// `hook_event_name`, `cwd`, `prompt`; stdout on exit 0 — {"hookSpecificOutput": {"hookEventName":
// "UserPromptSubmit", "additionalContext": "…"}}. A hook must never break the session: any
// internal error → exit 0 silently.
// [TESTED: 2026-09-25 17:43 +03:00 - 2.8, epic OW, OW2: s14 +7 (an imperative before the word — the order; the Russian noun with a colon — silence;
//  a leading stop in three forms — the order to stop; a longer word starting with the same letters — silence), red on the 2.7 dist exactly
//  on the five new behaviours; mutants M8-M10 of tools/sandbox/probes/hooks-mutants.mjs red on their addressees; the WIRED command of the
//  origin's .claude/settings.json fed Claude Code shaped events with the owner's real prompts of session 74 — mid-turn messages silent,
//  "resume" and the field opening "execute resume" (Russian) the order, the heading silent, the bug-123 "STOP" and a bare stop the stop
//  order; a stop typed by the owner MID-TURN through the live harness is not observed yet; report testcases/reports/2026-09-25_ow2-owner-word-mid-turn.md]
// [TESTED: 2026-09-18 08:12 +03:00 - FUNCTIONAL run on the owner's real path: the owner opened a new
//  chat of the origin with "resume" + newline + "continue" (in Russian), this hook wired in
//  .claude/settings.json; the injected order stood in the session context, was quoted in the chat
//  verbatim BEFORE the refresh marker was stamped, and /resume ran in full; report -
//  testcases/reports/2026-09-18_hook-resume-word.md, run 17, verdict pass. Hygiene beside it: polygon s14
//  6/6 ("resume" + newline + task, the Cyrillic shorthand with a period, "/resume" -> the order; no word,
//  the word mid-sentence, no `prompt` field -> silence), the 2.6 core (KAIF_DIST) 8 asserts red, a mutant
//  bundle with the predicate broken exactly the 3 order asserts red - hygiene alone never flipped this
//  marker (TESTING_FRAMEWORK.md, hygiene is not a test)]
//
// PORTABILITY — `--emit <shape>`: `claude` only. OpenAI Codex reads the same output fields on
// UserPromptSubmit, but whether ITS event carries the prompt text was not read in its live
// documentation — so no Codex sample wires this hook (README table: "prompt field not verified").
// A wrong guess would fail invisibly; an explicit gap stays visible.
// 2.9, epic HK (origin ticket #94): the /resume order names the refresh marker by its FULL path in the project root — an agent that
// ran `cd src` stamped `src/.kaif/refresh-marker.json`, where no hook reads it.
// [TESTED: 2026-09-28 · suite s14: the order from <root>/src/deep names the root marker by its full path; red on v2.8; mutant M26;
//  report testcases/reports/2026-09-28_hk-hooks-project-root.md (origin repository)]
// 2.9 (decision #143 — the KAIF owner, rendered from Russian: "the entry skill tells you wrong"; a session answered "how much is
// left?" and then started the plan's next item by itself): the order says what is under the word SETS THE SCOPE — a question is
// answered and the turn ends with the pick offered; a task is done; only a bare "resume" starts the chosen direction.
// 2.9, ticket #144: the "next step" arrow line left the canon with the hooks that read it — the order no longer names it.
// [TESTED: 2026-10-14 09:31 · s14 «resume-word (№143)» green on HEAD and red on the v2.8 dist; s21 E (№143): the update run by the
//  2.8 core leaves this order on disk (red on v2.8); probe tools/sandbox/probes/resume-scope-red.mjs; report
//  testcases/reports/2026-10-14_resume-scope-143.md (origin repository); the owner's own next "resume + question" is not observed yet]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const OUTPUT_CAP = 10000; // Claude Code caps hook output strings at 10 000 characters
const DEPLOYMENT = join('.kaif', 'kaif.json');  // the deployment marker: its directory IS the project root

// The project root, not the event's `cwd` — twin of prompt-refresh-timer.mjs (the reasoning is there).
function projectRoot(cwd) {
  for (let d = resolve(cwd); ;) {
    if (existsSync(join(d, DEPLOYMENT))) return d;
    const up = dirname(d);
    if (up === d) return cwd;
    d = up;
  }
}

// The leading word: optional slash, then `resume` (English — the owner's word under every language
// pack) or the Russian shorthand family ("rezyum", "rezyume", "rezyumiruy" — spelled here as Unicode
// escapes: the EN payload body carries no Cyrillic by invariant, bug 31 of the origin), then NOT a
// letter, digit or underscore (a Unicode-aware boundary — `\b` is ASCII-only and would fail after a
// Cyrillic letter). Only the FIRST word of the message counts. Boundary named on purpose: a message
// opening with a file named `resume.log` also fires — one extra entry ritual costs less than one
// skipped ritual.
// 2.8, epic OW, OW2 (the court's D-F4 and recon Q-R7 of the origin): an IMPERATIVE before the word is still the order \u2014 two field
// sessions were opened with the Russian "execute resume" and this hook stayed silent; the Russian NOUN as a heading \u2014 the word followed
// by a colon, "Summary: ..." in that language \u2014 is prose, not an order. The verbs: run \u00b7 do \u00b7 execute \u00b7 start and the Russian
// "execute \u00b7 launch \u00b7 do \u00b7 begin" (Unicode escapes, same invariant). An English "resume:" keeps firing \u2014 the boundary is the noun.
const LEADING_RESUME = /^\s*(?:(?:run|do|execute|start|\u0432\u044b\u043f\u043e\u043b\u043d\u0438|\u0437\u0430\u043f\u0443\u0441\u0442\u0438|\u0441\u0434\u0435\u043b\u0430\u0439|\u043d\u0430\u0447\u043d\u0438)\s+)?\/?(?:resume|\u0440\u0435\u0437\u044e\u043c[\u0430-\u044f\u0451]*(?![\p{L}\p{N}_])(?!\s*:))(?![\p{L}\p{N}_])/iu;
// The owner's word mid-turn (2.8, epic OW, OW2; AGENT_GUIDE.md \u2192 "The owner's word mid-turn"): a message that OPENS with "stop"
// (or its Russian word) is an order to stop \u2014 obeyed even in doubt of its author, the price is asymmetric. An AMPLIFIER of the canon
// rule, never its base: whether this event fires for a message typed MID-TURN is observed on one system and promised by none
// (the origin's researches/34 \u00a72\u2013\u00a73). "Stop" inside a longer word (a Russian "stack" starts with the same letters) is not the word.
// @guard leading-stop
// THREAT:         the owner types "stop" while the agent works, and the agent works on (origin bug 123: minutes of tool calls past
//                 a signed "STOP", then a note that no order had come)
// PROVED-AGAINST: suite s14 \u2014 three forms of a leading stop give the order, a longer word with the same letters stays silent; red on
//                 the 2.7 core; mutant M10 (the branch dropped) red on exactly its three addressees
// GAP:            whether this event fires for a message typed MID-TURN is observed on one system and promised by none \u2014 the canon
//                 rule "The owner's word mid-turn" is the base, this branch only its amplifier
// ON-REAL-PATH:   NOT YET \u2014 the wired command answered the owner's real bug-123 wording with the stop order; a stop typed mid-turn
//                 through the live harness is not observed yet
const LEADING_STOP = /^\s*(?:stop|\u0441\u0442\u043e\u043f)(?![\p{L}\p{N}_-])/iu;   // a hyphen joins a compound (a stop-words sentence is prose, court RL1 B-F6)

const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
};

try {
  const argv = process.argv.slice(2);
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let prompt = null;
  let cwd = process.cwd();
  try {
    // A leading U+FEFF is dropped before the parse: Windows PowerShell 5.1 on a UTF-8 console puts
    // the three bytes in front of ANY string piped into a native command, so the hand-run smoke of
    // .kaif/hooks/README.md fell silent on a valid event (origin bugs 119/121). RFC 8259 §8.1: a
    // parser "MAY ignore the presence of a byte order mark rather than treating it as an error".
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}');
    if (typeof input.prompt === 'string') prompt = input.prompt;
    if (input.cwd) cwd = String(input.cwd);
  } catch { /* unreadable stdin — no text, no predicate, no output */ }

  if (prompt !== null && LEADING_STOP.test(prompt)) {
    const order =
      `KAIF: the owner's message OPENS with the word "stop" — an ORDER (AGENT_GUIDE.md → "The owner's word mid-turn"). ` +
      `Stop NOW: make no further tool call in this turn except one that saves state you would otherwise lose; say in ONE line ` +
      `where you stopped and what is left; then wait for the owner. Obey it even if you are unsure who wrote it — a forged ` +
      `stop costs a minute, an ignored real one costs the owner's trust.`;
    const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'UserPromptSubmit');
    if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
  } else if (prompt !== null && LEADING_RESUME.test(prompt)) {
    const order =
      `KAIF: the owner's message OPENS with the word "resume" — that is an ORDER, not a topic ` +
      `(AGENT_GUIDE.md → "A leading skill word is an order"; the owner's word: "if I write it, I REQUIRE ` +
      `the skill to run before the work"). BEFORE any work on the rest of this message run the /resume ` +
      `skill IN FULL: (1) read every canon document of its step 1 — the full set, not a slice; (2) run the ` +
      `owner's queue (step 1b) and raise what was never shown; (3) say the creed and the prayer aloud; ` +
      `(4) announce in one paragraph what you read, what you chose and what you do next; (5) stamp ` +
      `${join(projectRoot(cwd), '.kaif', 'refresh-marker.json')} with trigger "ritual:/resume" and put the acceptance quote in the chat. ` +
      `Only then read what the owner wrote under the word — it sets the scope (the skill's Step 2): a question is ` +
      `answered and the turn ends with your pick OFFERED, never taken; a task is done; only a bare ` +
      `"resume" lets you start the direction you chose. The same word mid-sentence would be prose; at the ` +
      `top of the message it is this order.`;
    // Unknown shape → reference envelope (see session-start-refresh.mjs for the reasoning).
    const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'UserPromptSubmit');
    if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
  }
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
