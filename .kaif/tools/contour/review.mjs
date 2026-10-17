#!/usr/bin/env node
// review.mjs — the SHIPPED interactive contour generator: three faces (interview · proofreading ·
// mockup review) + notice + queue, one page shell, one server, one call (KAIF 2.6, epic IC; plans/93
// IC3; owner decision #101 revising #34: the contour ships, projects run it — they do not build it).
// [TESTED: 2026-09-05 · `--selftest` 45 checks green; acceptance probe tools/sandbox/probes/ic3-contour-generator.mjs
//  11/11 on a fresh install from the bundle (#051 → exit 3 naming Q1 and `- **A)**`, canonical doc → --no-serve exit 0
//  + RENDER IS NOT YET A SHOW, --mark-shown writes shown.json); suite s22 (fresh install · pre-flight · three faces ·
//  shown fact · update route with the project's own tools/review.mjs untouched); polygon `all 22 suites green`.
//  NOT observed yet: a live browser window (origin's verify-contour — step IC5), the macOS fallback]
//
//   node .kaif/tools/contour/review.mjs <doc.md>                 # interview: radio per option, free field, Save
//   node .kaif/tools/contour/review.mjs <doc.md> --notice        # something to TELL — "OK, read" is the outcome
//   node .kaif/tools/contour/review.mjs <doc.md> --proofread     # a comment field under every paragraph, Done
//   node .kaif/tools/contour/review.mjs <image>  --mockup        # the image + a comment field, Done
//   node .kaif/tools/contour/review.mjs --queue [--include-stale] | --queue --list | --enqueue <doc> [--notice]
//   node .kaif/tools/contour/review.mjs --mark-shown <doc> --transport chat | <doc> --no-serve | --selftest
//   flags: --no-open (serve, do not open a window — the call STILL sounds) · --silent (no call) · --timeout N (seconds; automation only)
//   node .kaif/tools/contour/review.mjs <doc.md> --check   # the form check WITHOUT a page (QL1, #56): parse + pre-flight + self-check,
//                                                          # prints `blocks N, recognised M`, exit 3/0; never serves, never calls, never records a showing
//
// Parameters are READ from .kaif/kaif.json (`language`, `projectName`, optional `contour.*`) — never
// asked (owner rule #97). The one-page contract this file implements: .kaif/INTERACTIVE_CONTOUR_SPEC.md.
//
// ⚠️ T7 (platform trap): NO backtick may appear inside the template strings of this file — a backtick
// in the page body breaks the module with a syntax error SOMEWHERE ELSE. Page JS is written with
// single quotes and concatenation; page texts come from texts.mjs by the deployment language.
//
// Exit codes (spec §5): 0 decision recorded (or notice read) · 2 page closed without an answer ·
// 130 interrupted · 3 pre-flight refused to open (a question without options in list/table form
// and no declared free field — the #51 defect) or the page self-check failed (radio groups ≠ questions).
//
// Contract lines living here: I1 md source / HTML derived · I5 call AFTER the page is up · I6 quiet
// hours · I7 queue is a STATE file · I8 the recorded decision ENDS the process · I9 infinite patience
// · I10–I13 loud refusal, rescue ring, browser draft, /alive pulse · I14 /closed beacon + silence
// watch · I25 three outcomes · I26/I27 app window, auto-close is an attempt · I29/I30 lock / free
// port · I32 the call never blocks · I33/I34 beeps first · I35/I36 voice by language, honest
// fallback · I37/I38 notice class · I39 stale queue · I40–I42 the fact of SHOWING · M8 render ≠ show.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync, readdirSync, openSync, closeSync, lstatSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve, basename, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadContourConfig, normalize, bodyHash, provenance, inQuietHours, parseMetaBlock, parseQuestions,
  docStatus, OPTION_START_RE, renderMd, renderInline, splitParagraphs, recordDecision, preflight, REFERENCES_SINCE, checkForm, escapeHtml, tmpDirOf, TMP_DIR,
  headerDate, ARCHAEOLOGY_PATHS, // AQ (2.7, #70): the archaeology axis of the same door
  unescapeStructure, // court RL 2.9, B-F2: the card shows an owner's escaped comment line as he typed it
  decisionPaths, // OW3 (2.8, #86): the age of an answer is read from its decision record
  statusBlockAwaitsApplication, // OW3 (2.8, #86): the field's form — the status block says «awaiting application»
  archaeologyWords, archaeologySearch, // OW5 (2.8, #74 · #82): the door searches itself — also for a question in the chat
  sessionName, // OW4 (2.8, #95 · #98): the calling session's name
  readDecision, // OW6 (2.8): a repeated save is recognised against the decision it already made
} from './core.mjs';
import { texts, PARSER } from './texts.mjs';

// ── Constants (canonical defaults DEF; the owner's envelope — depart only by the owner's word) ─
const ALIVE_INTERVAL_MS = 15000;      // DEF4: page→server pulse, envelope 10–60 s
const AUTOCLOSE_DELAY_MS = 2000;      // DEF2: window.close() attempt after the save
const AUTOCLOSE_RESERVE_MS = 2000;    // DEF2: reserve for a refused close → an honest request
const SERVER_DEATH_MS = 2500;         // DEF3: server death after the save (the window has time to go)
const BEACON_RELOAD_GRACE_MS = 3000;  // DEF6/T3: ~3 s after the beacon — reload vs close
const WAIT_POLL_MS = 2000;            // OW6 (2.8): the waiter polls the decision file(s) — the field device the KAIF owner pointed to polls every 2 s
const WAIT_NO_CONTOUR_MS = 60000;     // B-F1 (2.8): no live contour seen within a minute → exit 2 (a page comes up in seconds; the ritual starts the waiter first)
const CLICK_OF_PRESS_MS = 800;        // CP (2.9, #128): a click this soon after a taken pointerdown on the same label is that press's own click
const WORDS_QUOTE_CHARS = 160;      // CP (2.9, #128 c.2): how much of the owner's text and comments the waiter's line and the log quote
const QH_LEN = 12;                    // OW6: hex chars of a question's fingerprint in a draft key (title + body of the question)
// 2.8, origin issue #106 (a field owner's explicit word, three requests in one evening): owner-facing pages render at 1.7x the browser
// base — the WHOLE page through CSS zoom, as Ctrl+Plus does (raising font-size alone turned the fixed radio circles into dots and slid
// the title under the button) — and the primary Save button at 1.5x (its own zoom SAVE_SCALE / PAGE_SCALE). Media queries measure the
// viewport, which CSS zoom does not change, so a width breakpoint travels multiplied by PAGE_SCALE: the two constants move together.
export const PAGE_SCALE = 1.7;
export const SAVE_SCALE = 1.5;
const NARROW_PX = 560;                // the narrow-window breakpoint at scale 1 (rendered as NARROW_PX * PAGE_SCALE)
// CP6 (2.9, origin issue #125): the floating Save column. The header and the banner keep FAB_COLUMN_PX free on the right; the button
// floats FAB_EDGE_PX from the edge; the status pill under it is at most the column minus the edge and a gap wide — so it wraps
// INSIDE the column and never lies over the document title (it used to grow to 60vw and covered the title in a 1100x900 window).
// One source for the three: the pill's width is derived, never a second literal that drifts from the header's padding.
const FAB_COLUMN_PX = 230, FAB_EDGE_PX = 16;            // regular window
const FAB_COLUMN_NARROW_PX = 170, FAB_EDGE_NARROW_PX = 8; // narrow window (NARROW_PX)
const FAB_GAP_PX = 4;                                    // air between the pill and the title column
const pillMaxPx = (column, edge) => column - edge - FAB_GAP_PX;
// CP (2.9, #125 — the light judges' findings F1 and N1): a narrow pill wraps a long message into lines that fall past the header onto
// the document's own title. So the pill holds at most PILL_LINES lines (CSS line-clamp) — a pill of two lines ends above the first
// line of the page — and a status that does not fit them, MEASURED on the page (a count of characters is a proxy that differs per
// font, language and window), goes to the BAR above the page (in the flow, it keeps the Save column free), the pill a short label.
const PILL_LINES = 2;
// Silence-watch thresholds may be TIGHTENED by the environment — and only tightened.
const stricterMs = (envName, canon) => {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v > 0 && v < canon ? v : canon;
};
const SILENCE_THRESHOLD_MS = stricterMs('KAIF_CONTOUR_SILENCE_MS', 180000); // DEF6: 3 min (background tabs throttle)
const SILENCE_TICK_MS = stricterMs('KAIF_CONTOUR_TICK_MS', 15000);          // DEF5: watch tick
const SILENCE_STRIKES_TO_DIE = 2;     // DEF6/T5: two strikes against a sleeping machine
const BEEP_DEADLINE_MS = 8000;        // DEF7: hard deadline of the beep child
const VOICE_TIMEOUT_MS = 60000;       // DEF7: voice timeout (a cold first call may take seconds)
const WINDOW_SIZE = '1100,900';       // DEF8
const EXIT_DECIDED = 0, EXIT_CLOSED = 2, EXIT_INTERRUPTED = 130, EXIT_PREFLIGHT = 3; // I25 + spec §2
// LP (2.7, origin issue #66 — "the contour closed while I WAS TYPING"): a live owner page is closed only by `--close`,
// which reads the lock (port · pid · title · last input · draft state) and REFUSES while the owner typed less than
// CLOSE_QUIET_MS ago or a draft is unsaved. DEF6's own silence threshold (3 min) is the envelope: shorter would close
// a typing owner, longer keeps a dead window alive for nothing. Overridable by the owner: `contour.closeQuietMs`.
const CLOSE_QUIET_MS_DEFAULT = 180000;
const EXIT_NOT_CLOSED = 4;            // LP: --close refused — the owner is typing or the draft is unsaved
// LP (2.7, #66; interview 032 Q2 = D — "JS writes the file to the computer, into the project folder"): the app window
// runs on ITS OWN Chromium profile inside the project (ignore-first), so the browser draft and a locally saved answer
// live on the owner's disk in the project — and a headless run of the SAME profile on the SAME port can read them
// back when the server is gone (the origin is host:port, so the port must be the lock's).
const WINDOW_PROFILE_DIR = '.kaif/contour-window';
const PROFILE_QUIET_FLAGS = ['--no-first-run', '--no-default-browser-check',
  '--disable-features=msImplicitSignin,msEdgeSyncConsent,msEdgeFirstSyncOnFirstRun']; // EXP-0134: a NEW Edge profile silently signs into the OS account without these
const RECOVER_TIMEOUT_MS = 20000;     // LP: hard deadline of the headless recovery run
const FLUSH_GRACE_MS = 6000;          // LP: Chromium commits localStorage in batches (~5 s); killing the headless run sooner would lose the CLEAR of the picked-up keys and record the answer twice next time (probe 2026-09-13 run 1: a kill 1.5 s after a write lost it)
const ACCOUNT_CHECK_DELAY_MS = 5000;  // LP: read the profile's Preferences after the window came up (EXP-0134)
const SUBMITTED_KEY = '__submitted';  // LP: localStorage key (under the draft prefix) of an answer saved while the server was gone
const EXIT_NEVER_SHOWN = 2;           // I42: a never-shown waiting document reddens `--queue --list`
const STALE_QUEUE_DAYS = Number(process.env.KAIF_STALE_QUEUE_DAYS) > 0 ? Number(process.env.KAIF_STALE_QUEUE_DAYS) : 14; // I39
const DAY_MS = 86400000;
const QUEUE_FILE = 'queue.json';      // under decisionsDir (I7)
const SHOWN_FILE = 'shown.json';      // under decisionsDir (I40)
const IMPLEMENTED_FILE = 'implemented.json'; // under decisionsDir (I44 — 2.7 QL2, origin issue #54)
const KIND_NOTICE = 'notice';
const FACES = ['interview', 'proofread', 'mockup'];
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const IS_WIN = platform() === 'win32', IS_MAC = platform() === 'darwin';
const CLI_NAME = 'node .kaif/tools/contour/review.mjs'; // how the rituals call it
// LP (2.7): every flag the CLI knows. An unknown flag REFUSES before any page, sound or call (the core's bug-33 rule):
// the 2.6 generator passed `--close` through to the show and raised the page — with the owner's voice call behind it.
const KNOWN_FLAGS = ['--search', '--wait', '--call', '--dry-run', '--no-serve', '--no-open', '--silent', '--timeout', '--check', '--notice', '--proofread', '--mockup',
  '--queue', '--list', '--include-stale', '--enqueue', '--selftest', '--mark-shown', '--transport', '--mark-implemented', '--mark-withdrawn', '--why',
  '--where', '--close', '--force', '--owner-word'];
const EXIT_UNKNOWN_FLAG = 1;          // same code as the core and the loader (bugs/33): a usage error, never a show

// ── Configuration per root (cached: AGENT_GUIDE is read once per process) ─────────────────────
const CFG_CACHE = new Map();
export function cfgOf(root) {
  const key = resolve(root);
  if (!CFG_CACHE.has(key)) CFG_CACHE.set(key, loadContourConfig(key));
  return CFG_CACHE.get(key);
}
export const T = (cfg) => texts(cfg.language);
const stripBom = (s) => String(s).replace(/^\uFEFF/, '');
const readJsonOr = (p, dflt) => { if (!existsSync(p)) return dflt; try { return JSON.parse(stripBom(readFileSync(p, 'utf8'))); } catch { return dflt; } };
const relDoc = (root, docPath) => relative(root, resolve(root, docPath)).replace(/\\/g, '/');
const decisionsAbs = (root, cfg = cfgOf(root)) => resolve(root, cfg.decisionsDir);
const esc = (s) => String(s).replace(/</g, '&lt;');

// OW4 (2.8, #98): the session's name as the voice says it — the language pack's words and numbers ("dev2" → "dev two"; the Russian
// pack has its own word for "dev" and "main"); an unknown word stays as written
export function spokenSession(name, cfg) {
  const sp = T(cfg).spoken || {}, ones = sp.ones || [], tens = sp.tens || [], words = new Map(sp.words || []);
  const num = (n) => (n < 20 && ones[n] ? ones[n]
    : n < 100 && tens[Math.floor(n / 10)] ? tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
      : String(n).split('').map((d) => ones[Number(d)] || d).join(' '));
  return String(name).split(/[-_\s.]+/u).filter(Boolean).flatMap((part) => part.match(/\d+|\D+/gu) || [])
    .map((tok) => (/^\d+$/u.test(tok) ? num(Number(tok)) : (words.get(tok.toLowerCase()) || tok))).join(' ');
}
// OW4 (2.8, #98): «<owner>, this is <session>. …» — the calling session right after the owner's name, in every call; no session, no change
// [TESTED: 2026-09-25 20:15–20:24 · selftest «this is dev two»; the origin's dry run named «main» in the Russian pack's words; s22 F — «dev two» /
//  «main» in the Russian pack on two deployed workspaces; mutant «the name removed» red exactly on its case; report testcases/reports/2026-09-25_ow4-call-names-session.md]
export function introduce(phrase, cfg) {
  if (!cfg.session) return phrase;
  const intro = T(cfg).call.from(spokenSession(cfg.session, cfg)), head = cfg.callName + ', ';
  if (!phrase.startsWith(head)) return intro + '. ' + phrase;
  const rest = phrase.slice(head.length);
  return head + intro + '. ' + rest.charAt(0).toUpperCase() + rest.slice(1);
}
// OW4 (2.8, #95): the owner's hands or a quick answer outside a page — the CALL, never a line left in the chat he does not watch while the
// agent works; `dryRun` prints the phrase and the banner and makes no sound
export function callDoor(root, text, { dryRun = false, log = console.log } = {}) {
  const cfg = cfgOf(root);
  const phrase = introduce(cfg.callName + ', ' + String(text).trim(), cfg);
  if (dryRun) { log('CALL' + (cfg.session ? ' · ' + cfg.session : '') + ' (dry run, no sound): ' + phrase); return phrase; }
  signalCall(root, phrase, { log });
  return phrase;
}

// ── The call phrase — a PURE function (its content is judged by the selftest, not by ear) ─────
export function callPhrase(ctx, cfg) { return introduce(callPhraseBare(ctx, cfg), cfg); } // OW4: the session named in every call
function callPhraseBare(ctx, cfg) {
  const t = T(cfg), o = cfg.callName, p = cfg.spokenProjectName; // the voice says the spoken form
  if (ctx.notice) return t.call.notice(o, p, ctx.title);
  if (ctx.batch) {
    const parts = [t.call.parts.docs(ctx.nDocs), t.call.parts.questions(ctx.nQuestions)];
    if (ctx.nNotices > 0) parts.push(t.call.parts.notices(ctx.nNotices));
    return t.call.batch(o, p, parts);
  }
  if (ctx.face === 'proofread') return t.call.proofread(o, p, ctx.title);
  if (ctx.face === 'mockup') return t.call.mockup(o, p, ctx.title);
  return t.call.interview(o, p, ctx.kind, ctx.title, ctx.nWait);
}

// ── The signal (C8/I33): beeps → console → voice; quiet hours on top (I6) ─────────────────────
// The rich voice engine is a MACHINE resource reached through the environment (KAIF_VOICE_TOOL — a
// node script taking `<phrase> --play --voice <name>`; KAIF_VOICE; KAIF_SAPI_VOICE) — never a path
// inside the project. Without it the contour drops to the system voice of the deployment language
// (Windows SAPI by culture · macOS `say`), and without that — to beeps + banner, saying so.
export function signalCall(root, rawPhrase, { quiet = null, log = console.log } = {}) {
  const cfg = cfgOf(root);
  const isQuiet = quiet === null ? inQuietHours(new Date(), cfg.quietFrom, cfg.quietTo) : quiet;
  log('CALL' + (cfg.session ? ' · ' + cfg.session : '') + ': ' + rawPhrase); // C8: plain text to the console — an exit code does not prove a human heard it; OW4: the session
  const phrase = rawPhrase.replace(/[*_`#>[\]()«»"]/g, ' ').replace(/\s{2,}/g, ' ').trim(); // no markup in speech
  if (isQuiet) { log('Quiet hours (I6) — beeps and voice suppressed; the page is up silently.'); return; }
  const voice = () => {
    const lang = cfg.language;
    const systemVoice = () => {
      if (IS_WIN) {
        const dir = tmpDirOf(root);
        mkdirSync(dir, { recursive: true });
        const phraseFile = join(dir, 'call-phrase.txt');
        writeFileSync(phraseFile, '\uFEFF' + phrase, 'utf8'); // UTF-8 with BOM — PowerShell reads the encoding by BOM
        const pref = process.env.KAIF_SAPI_VOICE || '';
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
          'Add-Type -AssemblyName System.Speech; ' +
          '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
          "$c = '" + lang + "'; $pref = '" + pref.replace(/'/g, "''") + "'; " +
          '$vs = @($s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.ToLower().StartsWith($c) }); ' +
          'if ($vs.Count -eq 0) { exit 3 }; ' +
          '$v = @($vs | Where-Object { $_.VoiceInfo.Name -eq $pref }); if ($v.Count -eq 0) { $v = $vs }; ' +
          '$s.SelectVoice($v[0].VoiceInfo.Name); ' +
          "$s.Speak([IO.File]::ReadAllText('" + phraseFile.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'))"],
          { stdio: 'ignore', timeout: VOICE_TIMEOUT_MS });
        ps.on('exit', (code) => { if (code === 3) log('CALL: no system voice of culture "' + lang + '" on this machine — the phrase was not spoken; beeps and banner did the call (I35).'); });
        ps.on('error', () => log('CALL: system voice — engine not installed; beeps and banner did the call (I36).'));
        return;
      }
      if (IS_MAC) {
        const say = spawn('say', [phrase], { stdio: 'ignore', timeout: VOICE_TIMEOUT_MS });
        say.on('error', () => log('CALL: system voice — engine not installed; beeps and banner did the call (I36).'));
        return;
      }
      log('CALL: system voice — engine not installed on this platform; beeps and banner did the call (I36).');
    };
    const tool = process.env.KAIF_VOICE_TOOL;
    if (!tool) { log('CALL: voice — system voice of culture "' + lang + '" (no KAIF_VOICE_TOOL in the environment, I35).'); systemVoice(); return; }
    try {
      log('CALL: voice — ' + (process.env.KAIF_VOICE || 'default') + ' via KAIF_VOICE_TOOL; fallback — system voice of culture "' + lang + '" (I35).');
      const rich = spawn(process.execPath, [tool, phrase, '--play', '--voice', process.env.KAIF_VOICE || 'default'],
        { stdio: 'ignore', timeout: VOICE_TIMEOUT_MS });
      rich.on('exit', (code) => { if (code !== 0) systemVoice(); });
      rich.on('error', systemVoice);
    } catch { systemVoice(); }
  };
  // Beeps — through the sound card (I34), ASCII command, hard deadline DEF7; then the voice.
  if (IS_WIN) {
    const beep = spawn('powershell.exe',
      ['-NoProfile', '-Command', '[console]::beep(880,160);[console]::beep(660,160);[console]::beep(990,260)'],
      { stdio: 'ignore', timeout: BEEP_DEADLINE_MS });
    beep.on('exit', voice);
    beep.on('error', () => { log('CALL: beeps failed (no PowerShell?) — voice next.'); voice(); }); // the signal never drops the contour (I32)
  } else {
    try { process.stdout.write('\u0007'); } catch { /* no terminal — nothing to ring */ }
    log('CALL: no sound-card beep on this platform — terminal bell only; voice next.');
    voice();
  }
}

// ── The queue (I7): a state file; living documents stay where they are ───────────────────────
// OW7 (2.8, epic OW; origin issue #100): the queue file of ANOTHER shape — a project's own, earlier contour keeps `{ items: [...] }` under
// the same name — reads as no items of THIS contour (the living documents are still scanned in interviews/), is announced in one line, and
// is NEVER written: "foreign reads as empty" alone would turn --enqueue and the notice mark into an overwrite of the project's queue.
// [TESTED: 2026-09-25 18:26 +03:00 · selftest and s22 (`{"items":[]}` → the one line, exit not 1; --enqueue refused, the file byte for byte), red on the 2.7
//  core, mutants «read without the shape check» · «write over a foreign queue»; on a clone of the #86 field deployment: exit 0, the line,
//  no trace (was: TypeError); report testcases/reports/2026-09-25_ow3-ow7-owner-debt-foreign-queue.md]
export function queueShape(root, cfg = cfgOf(root)) {
  const p = join(decisionsAbs(root, cfg), QUEUE_FILE);
  if (!existsSync(p)) return 'none';
  return Array.isArray(readJsonOr(p, undefined)) ? 'ours' : 'foreign';   // unreadable JSON is foreign too: never overwritten
}
export class ForeignQueueError extends Error {}
export function readQueue(root, cfg = cfgOf(root)) { const v = readJsonOr(join(decisionsAbs(root, cfg), QUEUE_FILE), []); return Array.isArray(v) ? v : []; }
export function writeQueue(root, items, cfg = cfgOf(root)) {
  if (queueShape(root, cfg) === 'foreign') throw new ForeignQueueError(T(cfg).list.foreignWrite(cfg.decisionsDir + '/' + QUEUE_FILE));
  mkdirSync(decisionsAbs(root, cfg), { recursive: true });
  writeFileSync(join(decisionsAbs(root, cfg), QUEUE_FILE), JSON.stringify(items, null, 2) + '\n', 'utf8');
}
export const isNoticeItem = (item) => item.kind === KIND_NOTICE; // items without kind are questions (legacy)

export function enqueue(root, docPath, { kind = 'question' } = {}) {
  const items = readQueue(root);
  const rel = relDoc(root, docPath);
  const found = items.find((i) => i.doc === rel);
  if (found) {
    if (kind === KIND_NOTICE) { // a repeated notice on the same document is a NEW delivery (I38)
      found.kind = KIND_NOTICE; delete found.readAt; found.addedAt = provenance().at;
      writeQueue(root, items);
    }
    return items;
  }
  items.push({ doc: rel, kind, addedAt: provenance().at });
  writeQueue(root, items);
  return items;
}

// I38: the "read" mark is the ONLY proof of delivery; it lives in the state file, not in the document.
export function markNoticeRead(root, docPath, now = new Date()) {
  const items = readQueue(root);
  const item = items.find((i) => i.doc === relDoc(root, docPath) && isNoticeItem(i));
  if (!item) return false;
  item.readAt = provenance(now).at;
  writeQueue(root, items);
  return true;
}

export function pendingNotices(root) {
  return readQueue(root)
    .filter((i) => isNoticeItem(i) && !i.readAt && existsSync(resolve(root, i.doc)))
    .map((i) => ({ doc: i.doc, addedAt: i.addedAt }));
}

// bugs/125 (2.8): the revision of the QUEUE — what the entry page shows (documents with their unanswered counts, notices). The entry page
// asks for it on focus and reloads only when it changed: a reload that finds the same revision cannot start another one (the page used
// to reload on EVERY focus, and a focused tab fires focus after each load — an endless reload that ended the contour as "page closed").
export function queueRev(docs, notices) {
  return bodyHash(JSON.stringify([docs.map((d) => [d.doc, d.unanswered]), notices.map((n) => n.doc)]));
}

// Every document with unanswered QUESTIONS: a scan of interviews/ (living documents in place) + the queue.
export function pendingDocs(root) {
  const noticeDocs = new Set(readQueue(root).filter(isNoticeItem).map((i) => i.doc));
  const implAll = readImplemented(root); // I44 (QL2, #54): an open question already IMPLEMENTED is not owed to the owner
  const seen = new Set();
  const out = [];
  const push = (rel) => {
    if (seen.has(rel) || noticeDocs.has(rel) || !existsSync(resolve(root, rel))) return;
    seen.add(rel);
    const md = readFileSync(resolve(root, rel), 'utf8');
    const qs = parseQuestions(md);
    const st = implStateOf(rel, qs, implAll);
    if (st.open > 0 || docStatus(md) === 'waiting')
      out.push({ doc: rel, unanswered: st.unanswered, questions: qs.length, implementedOpen: st.implementedOpen });
  };
  const ivDir = resolve(root, 'interviews');
  if (existsSync(ivDir))
    for (const f of readdirSync(ivDir).filter((x) => /^interview_\d+.*\.md$/.test(x)).sort()) push('interviews/' + f);
  for (const item of readQueue(root)) if (!isNoticeItem(item)) push(item.doc);
  return out;
}

// ── I39: stale queue positions — the agent's debt, not the owner's page ───────────────────────
export function queueDocAgeDays(root, rel, now = new Date()) {
  const item = readQueue(root).find((i) => i.doc === rel && i.addedAt);
  let at = item ? Date.parse(item.addedAt) : NaN;
  if (Number.isNaN(at)) {
    const p = resolve(root, rel);
    if (!existsSync(p)) return 0;
    const head = stripBom(readFileSync(p, 'utf8')).split(/\r?\n/).slice(0, 30).join('\n');
    const m = head.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    at = m ? Date.parse(m[1] + 'T00:00:00Z') : NaN;
  }
  return Number.isNaN(at) ? 0 : Math.floor((now.getTime() - at) / DAY_MS);
}
export function staleQueueDocs(root, docs, now = new Date()) {
  return docs.map((d) => ({ ...d, days: queueDocAgeDays(root, d.doc, now) })).filter((d) => d.days > STALE_QUEUE_DAYS);
}
// The owner's showcase: what waits for HIM — fully answered documents leave; "waits by status" stays; stale leaves.
export function ownerDocs(root, { includeStale = false, now = new Date() } = {}) {
  const live = pendingDocs(root).filter((d) => !(d.questions > 0 && d.unanswered === 0));
  if (includeStale) return live;
  const stale = new Set(staleQueueDocs(root, live, now).map((d) => d.doc));
  return live.filter((d) => !stale.has(d.doc));
}

// ── I40–I42: the fact of SHOWING, the queue with ages, the gate by exit code ──────────────────
export function readShown(root, cfg = cfgOf(root)) { return readJsonOr(join(decisionsAbs(root, cfg), SHOWN_FILE), {}); }
// Written AT THE MOMENT of showing (window open / question asked in chat) — not when the agent remembered.
export function recordShown(root, rels, transport, now = new Date()) {
  const map = readShown(root);
  for (const r of rels) map[String(r).replace(/\\/g, '/')] = { at: now.toISOString(), transport };
  mkdirSync(decisionsAbs(root), { recursive: true });
  writeFileSync(join(decisionsAbs(root), SHOWN_FILE), JSON.stringify(map, null, 2) + '\n', 'utf8');
  return map;
}
// ── I44/I45 (2.7 QL2, origin issue #54): the FOURTH fact — IMPLEMENTED, with an address. The field raised an
// already-implemented question again and manufactured a false second decision that read as the owner's will.
// The fact is written by the agent's hand at the moment the decision lands (never inferred); a document whose
// every open question is implemented is never raised — the queue says so out loud and exits 2 until the status closes.
export function readImplemented(root, cfg = cfgOf(root)) { return readJsonOr(join(decisionsAbs(root, cfg), IMPLEMENTED_FILE), {}); }
// judge CH5 F10: a machine receipt is LOCAL ISO with its offset (the stamp canon) — toISOString() wrote UTC and the page's date slice
// showed yesterday after midnight
const localIso = (d) => { const p = (n) => String(n).padStart(2, '0'); const o = -d.getTimezoneOffset();
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    + (o >= 0 ? '+' : '-') + p(Math.floor(Math.abs(o) / 60)) + ':' + p(Math.abs(o) % 60); };
export function recordImplemented(root, rel, qid, where, now = new Date(), extra = {}) {
  const map = readImplemented(root);
  const key = String(rel).replace(/\\/g, '/');
  map[key] = map[key] || {};
  map[key][qid] = { at: localIso(now), where, ...extra };   // extra: { withdrawn: true, why } — 2.8, epic CH
  mkdirSync(decisionsAbs(root), { recursive: true });
  writeFileSync(join(decisionsAbs(root), IMPLEMENTED_FILE), JSON.stringify(map, null, 2) + '\n', 'utf8');
  return map;
}
export function implStateOf(rel, qs, implAll) {
  const impl = implAll[String(rel).replace(/\\/g, '/')] || {};
  const open = qs.filter((q) => !q.answered);
  return { open: open.length, unanswered: open.filter((q) => !impl[q.id]).length, implementedOpen: open.filter((q) => impl[q.id]).map((q) => q.id) };
}
// 2.8, epic CH (criterion 13; finding K13): a question a withdrawal made moot is WITHDRAWN by the agent with its reason — the implemented
// fact with withdrawn: true (the queue then never raises it, the page says «withdrawn — <reason>»); an ANSWERED question is the owner's
// word and is refused (exit 1, nothing recorded): a withdrawal is never an answer on the owner's behalf.
export function markWithdrawn(root, doc, qid, why, cfg = cfgOf(root)) {
  const qs = parseQuestions(readFileSync(resolve(root, doc), 'utf8'));
  const q = qs.find((x) => x.id === qid);
  if (!q) return { code: 1, line: T(cfg).impl.noSuch(doc, qid, qs.map((x) => x.id)) };
  if (q.answered) return { code: 1, line: T(cfg).impl.answeredNotWithdrawn(doc, qid) };
  recordImplemented(root, relDoc(root, doc), qid, 'withdrawn — ' + why, new Date(), { withdrawn: true, why });
  return { code: 0, line: T(cfg).impl.withdrawn(doc, qid, why, cfg.decisionsDir + '/' + IMPLEMENTED_FILE) };
}
// Lines of the gate: documents whose EVERY open question is implemented (I45) — printed by the queue and the show.
export function implementedGate(root) {
  const t = T(cfgOf(root));
  return pendingDocs(root).filter((d) => d.implementedOpen.length > 0 && d.unanswered === 0).map((d) => ({ doc: d.doc, line: t.impl.gate(d.doc, d.implementedOpen) }));
}

// OW3 (2.8, epic OW; origin issue #86, S1): the AGENT's debt — a document whose every question is answered while its status is not
// closed (the /interview canon closes the status LAST, after the propagation, so this state IS "answered, not applied"). A field owner
// found an 11-day-old decision of his unapplied himself: a view folded old answers into one counter behind a date. Here it is named,
// with the days since the answer, with NO date cutoff — and first in the list, ahead of the owner's queue.
// [TESTED: 2026-09-25 18:26 +03:00 · selftest (debt named first with the age since the answer; a stale document named), s22 on the deployed copy, red on the
//  2.7 core, mutants «canonical matcher finds nothing» · «stale silent again» · «status-block words ignored»; corrected 2026-09-25 18:52 +03:00: the first
//  edition was blind to the #86 field's form (a ticked status, «awaiting application» on a continuation line) — after the FORK B finish the
//  field clone at its S1-era state names the #86 decision «answered 17 d ago»; report testcases/reports/2026-09-25_ow3-ow7-owner-debt-foreign-queue.md]
export function answeredAgeDays(root, rel, now = new Date()) {
  let at = NaN;
  try { at = Date.parse(JSON.parse(stripBom(readFileSync(decisionPaths(root, rel).decision, 'utf8'))).at); } catch { at = NaN; }
  return Number.isNaN(at) ? queueDocAgeDays(root, rel, now) : Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}
export function awaitingApplication(root, now = new Date()) {
  const canon = pendingDocs(root).filter((d) => d.questions > 0 && d.unanswered === 0 && d.implementedOpen.length === 0).map((d) => d.doc);
  // the field's form (FORK B of plans/119 OW3): the status block itself says the answers await application — read from each interview
  const ivDir = resolve(root, 'interviews');
  const said = existsSync(ivDir) ? readdirSync(ivDir).filter((x) => /^interview_\d+.*\.md$/.test(x)).map((f) => 'interviews/' + f)
    .filter((rel) => statusBlockAwaitsApplication(readFileSync(resolve(root, rel), 'utf8'))) : [];
  return [...new Set([...canon, ...said])].map((doc) => ({ doc, days: answeredAgeDays(root, doc, now) }))
    .sort((a, b) => b.days - a.days || a.doc.localeCompare(b.doc));
}

// The LOCAL calendar day of a stored moment — receipts keep UTC ISO; a badge is read by a person in his own zone, and the first ten
// characters of a UTC moment are YESTERDAY between midnight and the zone's offset (the shown and applied badges read a night answer as
// the day before — probe tools/sandbox/probes/contour-badge-date.mjs, 2.8). An unparsable value keeps its old form.
export function localDay(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function listQueue(root, { now = new Date(), includeStale = false } = {}) {
  const t = T(cfgOf(root));
  const shown = readShown(root);
  const docs = ownerDocs(root, { includeStale, now }).map((d) => {
    const s = shown[d.doc] || null;
    const shownDays = s ? Math.floor((now.getTime() - Date.parse(s.at)) / DAY_MS) : null;
    return { ...d, waitDays: queueDocAgeDays(root, d.doc, now), shown: s, shownDays };
  });
  docs.sort((a, b) => (a.shown ? 1 : 0) - (b.shown ? 1 : 0) || (b.shownDays ?? 0) - (a.shownDays ?? 0) || a.doc.localeCompare(b.doc));
  const never = docs.filter((d) => !d.shown);
  const lines = docs.map((d) => (d.shown ? '🟡 ' : '⛔ ') + d.doc + ' — ' + t.list.waits(d.waitDays) +
    (d.shown ? ' · ' + t.list.shown(localDay(d.shown.at), d.shownDays, d.shown.transport) : ' · ' + t.list.never));
  if (!docs.length) lines.push(t.list.empty);
  if (never.length) {
    lines.push('🔴 ' + t.list.gate(never.length));
    lines.push('   ' + t.list.how(CLI_NAME));
    lines.push('   ' + t.list.dead);
  }
  const implGate = implementedGate(root); // I45: implemented-but-open is a gate of the same class as never-shown
  for (const g of implGate) lines.push('🔴 ' + g.line);
  // #86: a stale queue document is NAMED — it left the owner's showcase (I39), it never leaves the agent's sight
  const stale = includeStale ? [] : staleQueueDocs(root, ownerDocs(root, { includeStale: true, now }), now);
  for (const d of stale) lines.push('! ' + t.list.stale(d.doc, d.days, STALE_QUEUE_DAYS, CLI_NAME));
  if (queueShape(root) === 'foreign') lines.push('ℹ ' + t.list.foreign(cfgOf(root).decisionsDir + '/' + QUEUE_FILE)); // OW7 (#100): one line, no trace
  const awaiting = awaitingApplication(root, now); // #86: the agent's debt — FIRST, by name, no date cutoff
  const head = awaiting.length ? ['🔴 ' + t.list.awaiting(awaiting.length), ...awaiting.map((a) => '   ' + a.doc + ' — ' + t.list.answered(a.days))] : [];
  return { docs, never, lines: [...head, ...lines], implGate, awaiting, stale, exitCode: never.length || implGate.length ? EXIT_NEVER_SHOWN : 0 };
}

// ── Building pages (I1: only from documents) ──────────────────────────────────────────────────
const docTitle = (md, docPath, meta = parseMetaBlock(md)) =>
  (meta && meta.title) || (normalize(md).match(/^#\s+(.+)$/m) || [])[1] || basename(docPath);
const docKind = (root, rel, meta) => {
  const t = T(cfgOf(root));
  return (meta && meta.kind) || (rel.startsWith('interviews/') ? t.kind.interview : rel.startsWith('homeworks/') ? t.kind.homework : t.kind.document);
};
const ANSWER_LINE_RE = new RegExp('^\\s*\\*{0,2}(?:' + PARSER.answerLabels + ')\\s*(?:\\([^)]*\\))?\\s*:', 'iu');
const TARGET_LINE_RE = new RegExp('^\\s*\\*{0,2}(?:' + PARSER.targetLabels + ')\\s*:', 'iu');
const OPTION_LINE_RE = OPTION_START_RE; // CP (2.9, #127): one option regex for the parse and the card prose — the copy is gone
const QSECTION_RE = new RegExp('^#{1,3}\\s+(?:' + PARSER.questionsSectionHeadings + ')(?![\\p{L}\\d])', 'iu');

export function buildPage(root, docPath) {
  const cfg = cfgOf(root), t = T(cfg);
  const md = readFileSync(resolve(root, docPath), 'utf8');
  const meta = parseMetaBlock(md);
  const rel = relDoc(root, docPath);
  const kind = docKind(root, rel, meta);
  const title = docTitle(md, docPath, meta);
  const parsed = parseQuestions(md);
  const implMap = readImplemented(root)[rel] || {}; // I44: an implemented open question renders as settled, with its address
  // The card carries the WHOLE question body except the options and the answer fields — those are interactive.
  const proseOf = (q) => {
    const keep = [];
    let inOpt = false;
    // court RL 2.9, E-F3: the continuation lines of an answer paragraph are the answer, shown below as «answered:» — never as prose
    const answerLines = new Set((q.answers || []).flatMap((a) => a.lines || []));
    for (let j = 0; j < q.body.length; j++) {
      const line = q.body[j];
      if (answerLines.has(j)) continue;
      if (q.optionTableLines && q.optionTableLines.has(j)) { inOpt = false; continue; }
      if (OPTION_LINE_RE.test(line)) { inOpt = true; continue; }
      if (inOpt && /^\s{2,}\S/.test(line)) continue;
      inOpt = false;
      if (ANSWER_LINE_RE.test(line)) continue;
      if (TARGET_LINE_RE.test(line)) continue;
      keep.push(unescapeStructure(line));
    }
    return renderMd(keep.join('\n'));
  };
  const questions = parsed.map((q) => ({
    doc: rel, id: q.id, title: q.title, answered: q.answered || Boolean(implMap[q.id]), target: q.target,
    qh: bodyHash(q.title + '\n' + (q.body || []).join('\n')).slice(0, QH_LEN), // OW6: the draft key's fingerprint of THIS question
    bodyHtml: proseOf(q), recommended: q.recommended,
    options: q.options.map((o) => ({ letter: o.letter, html: renderMd(o.text), recommended: o.letter === q.recommended })),
    existing: [...q.answers.filter((a) => a.text).map((a) => a.text.replace(/<!--[\s\S]*?-->/g, '').trim()).filter(Boolean),
      ...(implMap[q.id] ? [implMap[q.id].withdrawn ? t.impl.withdrawnBadge(implMap[q.id].why, localDay(implMap[q.id].at))
        : t.impl.badge(implMap[q.id].where, localDay(implMap[q.id].at))] : [])],
  }));
  const docHash = bodyHash(md);
  // question blocks are CUT from the prose render — the cards below are the only form of questions
  const normLines = normalize(md).split('\n');
  const drop = new Set();
  for (const q of parsed) for (let i = q.line - 1; i <= q.line - 1 + q.body.length && i < normLines.length; i++) drop.add(i);
  normLines.forEach((l, i) => { if (QSECTION_RE.test(l)) drop.add(i); });
  if (meta) { // the meta block is machine markup — never shown to a human
    for (let i = 0; i < normLines.length; i++) {
      if (!/^```owner-review\s*$/.test(normLines[i])) continue;
      for (let j = i; j < normLines.length; j++) { drop.add(j); if (j > i && /^```\s*$/.test(normLines[j])) break; }
      break;
    }
  }
  const body = renderMd(normLines.filter((_, i) => !drop.has(i)).join('\n'));
  // outbound artifacts: the SERVER hashes the body — what is approved is a concrete text (I3)
  const artifacts = ((meta && meta.artifacts) || []).map((a) => {
    const abs = a.body_file ? resolve(root, a.body_file) : null;
    const exists = !!(abs && existsSync(abs));
    const text = exists ? readFileSync(abs, 'utf8') : '';
    return { doc: rel, id: a.id, target: a.target || '', format: a.format || '', bodyFile: a.body_file || '',
      exists, sha256: exists ? bodyHash(text) : null, bodyHtml: exists ? renderMd(text) : '', bytes: exists ? Buffer.byteLength(text, 'utf8') : 0 };
  });
  const nAns = questions.filter((q) => q.answered).length;
  const nWait = questions.length - nAns;
  const summary = questions.length
    ? ' <span class="tag done">' + t.tag.answeredN(nAns) + '</span>' +
      (nWait ? ' <span class="tag you">' + t.tag.waitN(nWait) + '</span>' : ' <span class="tag done">' + t.tag.allAnswered + '</span>')
    : '';
  const artSection = artifacts.length ? '<h2>' + t.head.outbound + '</h2>' + artifacts.map((a) => aCard(a, t)).join('\n') : '';
  const qSection = questions.length
    ? '<h2>' + t.head.questions + '</h2>' + questions.map((q) => qCard(q, t)).join('\n')
    : (artifacts.length ? '' : '<h2>' + t.head.questions + '</h2><p>' + t.head.noQuestions + '</p>');
  const unrec = checkForm(md).unrecognised.length; // QL1 (#56): the header says when the page knows only part of the blocks
  const formNote = unrec ? ' <span class="langnote">' + esc(t.check.partialHead(unrec)) + '</span>' : '';
  // QL3 (2.7, origin issue #54: 18 535 characters of settled matter above the one live question): the READING VIEW —
  // live questions first; everything answered and the document text below as ONE collapsed archive. Nothing is
  // removed, only the order of reading changes; a document with no settled questions keeps the plain order.
  const live = questions.filter((q) => !q.answered), settled = questions.filter((q) => q.answered);
  const mainHtml = live.length && settled.length
    ? '<h2>' + t.head.questions + '</h2>' + live.map((q) => qCard(q, t)).join('\n') + artSection +
      '<details class="archive"><summary>' + esc(t.head.archive(settled.length)) + '</summary><div class="doc">' + body + '</div>' +
      settled.map((q) => qCard(q, t)).join('\n') + '</details>' + docCommentBlock(rel, t)
    : '<div class="doc">' + body + '</div>' + artSection + qSection + docCommentBlock(rel, t);
  const html = pageShell(cfg, {
    title, kind, heading: '<span class="kind">' + esc(kind) + '</span><span>' + renderInline(title) + '</span>' + summary + formNote,
    main: mainHtml,
    questions, artifacts, face: 'interview', rev: docHash,
  });
  return { html, questions, artifacts, docHash, kind, title, rel, face: 'interview' };
}

// I37: the NOTICE page — the whole document, an optional comment, the EXPLICIT "read" mark.
export function buildNoticePage(root, docPath) {
  const cfg = cfgOf(root), t = T(cfg);
  const md = readFileSync(resolve(root, docPath), 'utf8');
  const rel = relDoc(root, docPath);
  const title = docTitle(md, docPath);
  const html = pageShell(cfg, {
    title, kind: t.kind.notice,
    heading: '<span class="kind">' + t.kind.notice + '</span><span>' + renderInline(title) + '</span> <span class="tag notice">' + t.tag.noAnswerNote + '</span>',
    main: '<div class="doc">' + renderMd(md) + '</div>' + noticeCommentBlock(rel, t),
    questions: [], notices: [rel], noticeDoc: rel, face: 'notice', rev: bodyHash(md),
  });
  return { html, questions: [], docHash: bodyHash(md), kind: t.kind.notice, title, rel, face: 'notice' };
}

// The PROOFREADING face (new in 2.6, owner scenario B of interview #024): every paragraph of the
// document with a comment field under it and one Done button. Record: kind "proofread", comments { p<N> }.
export function buildProofreadPage(root, docPath) {
  const cfg = cfgOf(root), t = T(cfg);
  const md = readFileSync(resolve(root, docPath), 'utf8');
  const rel = relDoc(root, docPath);
  const title = docTitle(md, docPath);
  const paras = splitParagraphs(md);
  const cards = paras.map((p) =>
    '<section class="pcard" id="' + p.id + '"><div class="pid">' + p.id + '</div><div class="ptext">' + renderMd(p.text) + '</div>' +
    '<p><textarea data-draft data-doc="' + esc(rel) + '" name="para:' + esc(rel) + ':' + p.id + '" rows="2" placeholder="' + esc(t.ph.paragraph) + '"></textarea></p></section>').join('\n');
  const html = pageShell(cfg, {
    title, kind: t.kind.proofread,
    heading: '<span class="kind">' + t.kind.proofread + '</span><span>' + renderInline(title) + '</span> <span class="tag you">' + t.tag.you + '</span>',
    main: '<h2>' + t.head.paragraphs + ' (' + paras.length + ')</h2>' + cards + docCommentBlock(rel, t) + '<p class="muted">' + esc(t.ph.noRemarks) + '</p>',
    questions: [], face: 'proofread', faceDoc: rel, paragraphs: paras.map((p) => p.id), rev: bodyHash(md),
  });
  return { html, questions: [], docHash: bodyHash(md), kind: t.kind.proofread, title, rel, paragraphs: paras.length, face: 'proofread' };
}

// The MOCKUP face (new in 2.6): the image embedded as a data URI (works with --no-serve too) + one
// comment field + Done. Record: kind "mockup". First version — no region markup; field tickets extend it.
export function buildMockupPage(root, imagePath) {
  const cfg = cfgOf(root), t = T(cfg);
  const abs = resolve(root, imagePath);
  const rel = relDoc(root, imagePath);
  const mime = IMAGE_MIME[extname(abs).toLowerCase()];
  if (!mime) throw new Error('not an image for the mockup face (png/jpg/gif/webp/svg): ' + rel);
  const data = readFileSync(abs);
  const src = 'data:' + mime + ';base64,' + data.toString('base64');
  const title = basename(imagePath);
  const html = pageShell(cfg, {
    title, kind: t.kind.mockup,
    heading: '<span class="kind">' + t.kind.mockup + '</span><span>' + renderInline(title) + '</span> <span class="tag you">' + t.tag.you + '</span>',
    main: '<h2>' + t.head.mockup + '</h2><div class="mock"><img src="' + src + '" alt="' + esc(title) + '"></div>' +
      '<p><textarea data-draft data-doc="' + esc(rel) + '" name="doccomment:' + esc(rel) + '" rows="5" placeholder="' + esc(t.ph.mockup) + '"></textarea></p>' + '<p class="muted">' + esc(t.ph.noRemarks) + '</p>',
    questions: [], face: 'mockup', faceDoc: rel, rev: bodyHash(data.toString('base64')),
  });
  return { html, questions: [], docHash: bodyHash(data.toString('base64')), kind: t.kind.mockup, title, rel, face: 'mockup' };
}

// The batch page "N accumulated" (I7): a card per document; notices go STRICTLY UNDER the questions.
export function buildQueuePage(root, docs, notices = pendingNotices(root)) {
  const cfg = cfgOf(root), t = T(cfg);
  const groups = docs.map(({ doc }) => {
    const page = buildPage(root, doc);
    return { doc, title: page.title, kind: page.kind, pending: page.questions.filter((q) => !q.answered) };
  });
  const total = groups.reduce((s, g) => s + g.pending.length, 0);
  const questionsMain = groups.map((g) =>
    '<section class="group"><h2>' + renderInline(g.title) + ' <small class="kind">' + esc(g.doc) + '</small></h2>' +
    (g.pending.map((q) => qCard(q, t)).join('\n') || '<p>' + t.head.noPending + '</p>') + docCommentBlock(g.doc, t) +
    '<p><button type="button" class="savedoc" data-doc="' + esc(g.doc) + '">' + t.btn.saveDoc + '</button></p></section>').join('\n<hr>\n');
  const noticesMain = notices.length
    ? '\n<hr>\n<h2 class="noticehead">' + t.head.noticeGroup + ' (' + notices.length + ')</h2>\n' +
      notices.map(({ doc }) => {
        const md = readFileSync(resolve(root, doc), 'utf8');
        return '<section class="group notice"><h3>' + esc(docTitle(md, doc)) + ' <small class="kind">' + esc(doc) + '</small></h3>' +
          '<div class="doc">' + renderMd(md) + '</div>' + noticeCommentBlock(doc, t) +
          '<p><button type="button" class="savedoc" data-doc="' + esc(doc) + '">' + t.btn.read + '</button></p></section>';
      }).join('\n<hr>\n')
    : '';
  const questions = groups.flatMap((g) => g.pending);
  const counts = t.count.docs(docs.length + notices.length) + ' · ' + t.count.questions(total) + (notices.length ? ' · ' + t.count.notices(notices.length) : '');
  const html = pageShell(cfg, {
    title: t.head.accumulated + ': ' + counts, kind: t.kind.queue,
    heading: '<span class="kind">' + t.kind.queue + '</span><span>' + t.head.accumulated + ': ' + esc(counts) + '</span>',
    main: questionsMain + noticesMain, questions, batch: true, notices: notices.map((n) => n.doc), face: 'interview',
  });
  return { html, questions, total, notices: notices.length };
}

// The ENTRY page of the queue: cards only; each opens its document in a separate window (/d/<rel>).
export function buildIndexPage(root, docs, notices = []) {
  const cfg = cfgOf(root), t = T(cfg);
  const card = (rel, kindLabel, pendingLabel, cls) => {
    const md = readFileSync(resolve(root, rel), 'utf8');
    return '<a class="card ' + cls + '" href="/d/' + encodeURIComponent(rel) + '" target="_blank" rel="noopener">' +
      '<span class="ckind">' + esc(kindLabel) + '</span><span class="ctitle">' + esc(docTitle(md, rel)) + '</span>' +
      '<span class="cmeta">' + esc(rel) + '</span><span class="cpend">' + esc(pendingLabel) + '</span><span class="cgo">' + t.count.open + '</span></a>';
  };
  const qCards = docs.map((d) => card(d.doc, t.kind.interview, d.unanswered > 0 ? t.count.pendingQ(d.unanswered) : t.count.waitsByStatus, 'wait'));
  const nCards = notices.map((n) => card(n.doc, t.kind.notice, t.count.unread, 'notice'));
  const total = docs.reduce((s, d) => s + d.unanswered, 0);
  const counts = t.count.docs(docs.length + notices.length) + ' · ' + t.count.questions(total) + (notices.length ? ' · ' + t.count.notices(notices.length) : '');
  const main = '<div class="cards">' + qCards.join('\n') +
    (nCards.length ? '<h2 class="noticehead">' + t.head.noticeGroup + ' (' + nCards.length + ')</h2>' + nCards.join('\n') : '') + '</div>' +
    (qCards.length + nCards.length === 0 ? '<p>' + t.head.queueEmpty + '</p>' : '');
  const html = pageShell(cfg, {
    title: t.head.accumulated + ': ' + counts, kind: t.kind.queue,
    heading: '<span class="kind">' + t.kind.queue + '</span><span>' + t.head.accumulated + ': ' + esc(counts) + '</span>',
    main, questions: [], index: true, face: 'interview', qrev: queueRev(docs, notices), // bugs/125: what this list was built from
  });
  return { html, questions: [], total, notices: notices.length };
}

// ── Spec §2 second half: the page SELF-CHECK — radio groups == questions with options ─────────
/** Distinct radio groups of the interview form in a rendered page (the same name = one group). */
export function radioGroupsOf(html) {
  const names = new Set();
  const re = /<input type="radio"[^>]*name="(choice:[^"]+)"/g;
  let m; while ((m = re.exec(html))) names.add(m[1]);
  return names.size;
}
/** { ok, groups, expected } — expected = questions that carry options (answered ones keep theirs, disabled). */
export function selfCheck(page) {
  const expected = page.questions.filter((q) => q.options && q.options.length > 0).length;
  const groups = radioGroupsOf(page.html);
  // QL4 (#60): the RENDER is judged too — the Save control floats at the top right (no bottom bar), option labels carry no raw markdown
  const fabOk = /\.fab \{[^}]*position:fixed/.test(page.html) && !/bottom:0/.test(page.html) && !/class="bar"/.test(page.html);
  const labelsOk = !(page.html.match(/<label class="opt[^"]*">[\s\S]*?<\/label>/g) || []).some((l) => l.includes('**'));
  return { ok: groups === expected && fabOk && labelsOk, groups, expected, fabOk, labelsOk };
}

const docCommentBlock = (rel, t) =>
  '<h3>' + t.head.docComment + '</h3>' +
  '<p><textarea data-draft data-doc="' + esc(rel) + '" name="doccomment:' + esc(rel) + '" rows="3" placeholder="' + esc(t.ph.docComment) + '"></textarea></p>';
const noticeCommentBlock = (rel, t) =>
  '<h3>' + t.head.optComment + '</h3>' +
  '<p><textarea data-draft data-doc="' + esc(rel) + '" name="doccomment:' + esc(rel) + '" rows="3" placeholder="' + esc(t.ph.noticeComment(t.btn.read)) + '"></textarea></p>';

function qCard(q, t) {
  const tag = q.answered ? '<span class="tag done">' + t.tag.answered + '</span>'
    : '<span class="tag wait">' + t.tag.unanswered + '</span> <span class="tag you">' + t.tag.you + '</span>';
  const letterRe = new RegExp('^([' + PARSER.letters + '])\\)', 'u');
  const chosenLetter = q.answered && q.existing[0] ? (q.existing[0].match(letterRe) || [])[1] || null : null;
  const opts = q.options.map((o) =>
    '<label class="opt' + (o.recommended ? ' rec' : '') + '"><input type="radio" ' +
    (q.answered ? 'disabled' + (o.letter === chosenLetter ? ' checked' : '') : 'data-draft') +
    ' name="choice:' + esc(q.doc) + ':' + q.id + '" value="' + o.letter + '">' +
    '<div>' + (o.recommended ? '<span class="tag rec">' + t.tag.rec + '</span> ' : '') + o.html + '</div></label>').join('');
  const existing = q.existing.map((x) => '<p><strong>' + t.tag.answered + ':</strong> ' + renderInline(x) + '</p>').join(''); // CP (#123): his markup, not raw stars
  const inputs = q.answered
    ? '<p class="addcomment"><textarea data-draft name="comment:' + esc(q.doc) + ':' + q.id + '" rows="2" placeholder="' + esc(t.ph.addComment) + '"></textarea></p>'
    // NT1 (2.9, origin issue #139): the owner's own answer is a TEXTAREA — Enter starts a new line, a pasted text keeps its lines
    : '<p><textarea data-draft name="text:' + esc(q.doc) + ':' + q.id + '" rows="2" placeholder="' + esc(t.ph.own) + '"></textarea></p>' +
      '<p><textarea data-draft name="comment:' + esc(q.doc) + ':' + q.id + '" rows="2" placeholder="' + esc(t.ph.comment) + '"></textarea></p>';
  const meta = q.target ? '<div class="qmeta">' + esc(q.target).replace(/`/g, '') + '</div>' : '';
  return '<section class="qcard' + (q.answered ? ' done' : '') + '">' +
    // light judge of epic CP, F6: a title carries the owner's markup too ("Take **B** or `C`?") — rendered, not shown raw
    '<div><strong>' + q.id + '.</strong> ' + renderInline(q.title) + ' ' + tag + '</div>' +
    (q.bodyHtml ? '<div class="qbody">' + q.bodyHtml + '</div>' : '') + meta + existing + opts + inputs + '</section>';
}

// The card of an OUTBOUND artifact: "reject" is one click, like "approve" — silence is never a decision.
function aCard(a, t) {
  const where = a.target ? '<span class="tag you">' + esc(a.target).replace(/`/g, '') + '</span>' : '';
  if (!a.exists) {
    return '<section class="qcard danger"><div><strong>' + esc(a.id) + '.</strong> ' + where + ' <span class="tag wait">' + t.tag.noBody + '</span></div>' +
      '<p>' + t.art.missing(esc(a.bodyFile)) + '</p></section>';
  }
  const opt = (val, label, cls) =>
    '<label class="opt' + (cls ? ' ' + cls : '') + '"><input type="radio" data-draft name="art:' + esc(a.doc) + ':' + esc(a.id) + '" value="' + val + '"><div>' + label + '</div></label>';
  return '<section class="qcard"><div><strong>' + esc(a.id) + '.</strong> ' + t.art.goesOut + ' ' + where + ' <span class="tag wait">' + t.tag.you + '</span></div>' +
    '<div class="qmeta">' + esc(a.format || 'markdown') + ' · ' + a.bytes + ' ' + t.art.bytes + ' · ' + esc(a.bodyFile) + '</div>' +
    '<div class="qbody outbox">' + a.bodyHtml + '</div>' + opt('approved', t.btn.approve, 'rec') + opt('rejected', t.btn.reject) +
    '<p><textarea data-draft name="artcomment:' + esc(a.doc) + ':' + esc(a.id) + '" rows="2" placeholder="' + esc(t.ph.artComment) + '"></textarea></p></section>';
}

function pageShell(cfg, { title, kind, heading, main, questions, artifacts = [], batch = false, notices = [], noticeDoc = null,
  index = false, face = 'interview', faceDoc = null, paragraphs = [], rev = null, qrev = null }) {
  const t = T(cfg);
  const qjson = JSON.stringify(questions).replace(/</g, '\\u003c');
  const singleDoc = batch ? null : ((questions[0] && questions[0].doc) || (artifacts[0] && artifacts[0].doc) || noticeDoc || faceDoc || null);
  const cfgJson = JSON.stringify({
    batch, index, face, aliveMs: ALIVE_INTERVAL_MS, closeMs: AUTOCLOSE_DELAY_MS, reserveMs: AUTOCLOSE_RESERVE_MS,
    rev, doc: singleDoc, // OW6 (2.8): the revision this page was built from — every save carries it, the pulse compares it
    qrev, // bugs/125 (2.8): the queue revision the ENTRY page was built from — on focus it reloads only when the pulse names another
    notices, paragraphs,
    artifacts: artifacts.map((a) => ({ doc: a.doc, id: a.id, exists: a.exists, sha256: a.sha256 })),
    expectRadioGroups: questions.filter((q) => q.options && q.options.length > 0).length, // spec §2 self-check
    draftKey: 'owner-review:' + (singleDoc || (index ? 'index' : title)), // per DOCUMENT, never per batch
    txt: { draft: t.st.draft(0).replace('0', '{n}'), saving: t.st.saving, saved: t.st.saved('{w}'), nothing: t.st.nothing,
      needArt: t.st.needArt, err: t.st.err('{m}'), serverGone: t.st.serverGone, serverGoneLocal: t.st.serverGoneLocal, savedLocally: t.st.savedLocally, closeYourself: t.st.closeYourself,
      savedLocallyShort: t.st.savedLocallyShort, pillOk: t.st.pillOk, pillErr: t.st.pillErr,
      copied: t.st.copied, copyManually: t.st.copyManually, selfcheck: t.st.selfcheck('{r}', '{q}'), tabnote: t.st.tabnote,
      left: t.st.left('{n}'), stale: t.st.stale, rewritten: t.st.rewritten, orphan: t.st.orphan, reloadRev: t.btn.reloadRev }, // OW6
  }).replace(/</g, '\\u003c');
  // P5: both themes via prefers-color-scheme; colours are variables; contrast is built into the pairs.
  const css = `
  :root { --bg:#f7f7f5; --card:#ffffff; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9de;
    --wait:#d97706; --done:#16a34a; --you:#2563eb; --danger:#dc2626; --accent:#2563eb; --okbar:#15803d;
    --tagink:#0b1020; --tagwait:#fbbf24; --tagdone:#4ade80; --tagyou:#93c5fd; --tagrec:#86efac; --recbg:rgba(22,163,74,.10); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#17171a; --card:#212126; --ink:#ececf0; --muted:#a0a0a8; --line:#3a3a42;
      --wait:#f59e0b; --done:#22c55e; --you:#60a5fa; --danger:#f87171; --accent:#60a5fa; --okbar:#15803d;
      --tagink:#0b1020; --tagwait:#f59e0b; --tagdone:#22c55e; --tagyou:#60a5fa; } }
  html { zoom:${PAGE_SCALE} } /* #106: the whole page at PAGE_SCALE, like Ctrl+Plus */
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, "Segoe UI", sans-serif; }
  /* The header SCROLLS WITH THE PAGE — the owner's word (2026-09-05): not sticky. Only the emergency banner may pin. */
  header { position:static; background:var(--card); border-bottom:1px solid var(--line); padding:10px ${FAB_COLUMN_PX}px 10px 20px; display:flex; gap:12px; align-items:baseline; z-index:5; flex-wrap:wrap }
  header .project { font-weight:700; color:var(--accent) } .kind { color:var(--muted) } .langnote { font-size:12px; color:var(--muted) }
  main { max-width:900px; margin:0 auto; padding:16px 20px 40px }
  .doc { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 22px; overflow-x:auto }
  .doc pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; overflow-x:auto }
  .doc code { background:var(--bg); padding:1px 4px; border-radius:4px }
  .doc table { border-collapse:collapse; margin:8px 0 } .doc th,.doc td { border:1px solid var(--line); padding:4px 8px }
  .doc blockquote { border-left:3px solid var(--line); margin:8px 0; padding:2px 12px; color:var(--muted) }
  .qcard { background:var(--card); border:1px solid var(--line); border-left:5px solid var(--wait); border-radius:10px; padding:12px 16px; margin:14px 0 }
  .qcard.done { border-left-color:var(--done) } .qcard.done > * { opacity:.72 } .qcard.done .addcomment { opacity:1 }
  .tag { font-size:12px; padding:2px 8px; border-radius:99px; color:var(--tagink); font-weight:600 }
  .tag.wait { background:var(--tagwait) } .tag.done { background:var(--tagdone) } .tag.you { background:var(--tagyou) } .tag.rec { background:var(--tagrec) }
  .opt.rec { background:var(--recbg); border-radius:10px; padding:6px 10px; margin-left:-10px }
  .tag.notice { background:var(--muted) }
  .noticehead { margin-top:28px; padding-top:10px; border-top:2px solid var(--line) }
  .group.notice { border-left:5px solid var(--muted); border-radius:10px; padding-left:14px }
  .cards { display:grid; gap:14px }
  .card { display:grid; gap:6px; padding:18px 20px; background:var(--card); border:1px solid var(--line); border-left:6px solid var(--wait); border-radius:12px; text-decoration:none; color:var(--ink) }
  .card:hover { border-color:var(--accent); border-left-color:var(--accent) } .card.notice { border-left-color:var(--you) }
  .ckind { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted) } .ctitle { font-size:19px; font-weight:600; line-height:1.35 }
  .cmeta { font-size:13px; color:var(--muted); font-family:ui-monospace,Consolas,monospace } .cpend { font-size:14px; color:var(--wait); font-weight:600 }
  .card.notice .cpend { color:var(--you) } .cgo { font-size:14px; color:var(--accent) }
  .opt { display:flex; gap:12px; align-items:flex-start; margin:10px 0; cursor:pointer }
  .opt input[type=radio] { width:22px; height:22px; flex:0 0 auto; margin-top:0; accent-color:var(--accent); cursor:pointer }
  .opt div p { margin:2px 0 } .qbody p { margin:6px 0 } .qmeta { font-size:13px; color:var(--muted); margin:6px 0 }
  .outbox { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin:10px 0; max-height:60vh; overflow:auto }
  .qcard.danger { border-left-color:var(--danger) }
  details.archive { margin:22px 0 } details.archive > summary { cursor:pointer; color:var(--muted); font-weight:600; padding:8px 0 } /* QL3 (#54): the settled below, one fold */
  /* proofreading: paragraph cards with their id in the margin; mockup: the image at page width */
  .pcard { background:var(--card); border:1px solid var(--line); border-left:5px solid var(--you); border-radius:10px; padding:10px 16px; margin:12px 0 }
  .pid { font-size:12px; color:var(--muted); font-family:ui-monospace,Consolas,monospace } .ptext p { margin:6px 0 }
  .mock { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; margin:10px 0; text-align:center }
  .mock img { max-width:100%; height:auto }
  textarea, input[type=text] { width:100%; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:8px; font:inherit }
  /* QL4 (2.7, origin issue #60 — the owner's word: the Save button is a FAB at the top right): a control pinned to the
     BOTTOM edge is unreachable when the window is taller than the screen (remote desktop, phone) — the owner typed
     the answers and could not press the button. The FAB is fixed at the top right, visible at any scroll and any
     height; the status is a pill under it on its own background, gone when empty. A bottom bar is FORBIDDEN (spec §4). */
  .fab { position:fixed; top:12px; right:${FAB_EDGE_PX}px; z-index:50; display:flex; flex-direction:column; align-items:flex-end; gap:6px; max-width:60vw }
  .fab button { border-radius:999px; box-shadow:0 4px 14px rgba(0,0,0,.28); padding:10px 20px }
  .fab #save { zoom:${+(SAVE_SCALE / PAGE_SCALE).toFixed(3)} } /* #106: the primary Save button renders at SAVE_SCALE of the base */
  .fab #status { background:var(--card); border:1px solid var(--line); border-radius:15px; padding:4px 12px; font-size:13px; text-align:right; max-width:${pillMaxPx(FAB_COLUMN_PX, FAB_EDGE_PX)}px; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${PILL_LINES}; overflow:hidden } .fab #status:empty { display:none }
  @media (max-width:${Math.round(NARROW_PX * PAGE_SCALE)}px) { .fab { top:8px; right:${FAB_EDGE_NARROW_PX}px } .fab button { padding:8px 14px } .fab #status { max-width:${pillMaxPx(FAB_COLUMN_NARROW_PX, FAB_EDGE_NARROW_PX)}px } header, #banner { padding-right:${FAB_COLUMN_NARROW_PX}px } }
  .muted{opacity:.7;font-size:.95em;margin:4px 0 0} /* bugs/113: the no-remarks hint under the field */
  button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:9px 18px; font:inherit; cursor:pointer } button:disabled { opacity:.5; cursor:default }
  button.ghost { background:transparent; color:var(--accent); border:1px solid var(--accent) }
  .err { color:var(--danger); font-weight:600 } .okmsg { color:var(--done); font-weight:600 }
  #rescue { display:none; border:2px solid var(--danger); border-radius:10px; padding:12px; margin:14px 0 }
  #banner { display:none; position:sticky; top:0; background:var(--danger); color:#fff; padding:8px ${FAB_COLUMN_PX}px 8px 20px; font-weight:600; z-index:6 } /* OW6: room for the floating Save button, as the header has */
  #banner.ok { background:var(--okbar) } /* CP (2.9, #125): a long GOOD message — the answer saved on this computer — rides the bar too */
  /* I26 (#64): the page found itself in a TAB, not in the contour's own window — a yellow note, never the red banner:
     the answer still goes through; what is at risk is the draft (it lives in this tab) and the auto-close. */
  #tabnote { display:none; background:#fde68a; color:#1d1d1f; padding:8px 20px; font-weight:600; border-bottom:1px solid #f59e0b }`;

  // Page JS — single quotes and concatenation, NOT ONE backtick (T7). Texts come from CFG.txt.
  const js = [
    "var CFG=" + cfgJson + ";var QS=" + qjson + ";",
    "var $=function(s){return document.querySelector(s)};var TX=CFG.txt;",
    "function fmt(s,o){for(var k in o)s=s.replace('{'+k+'}',o[k]);return s}",
    // CP (2.9, #125; the light judges' F1 and N1): a status that does not fit the pill's lines → the bar (green `ok` for good news, red
    // `err` for trouble), the pill a short label. The bar has FOUR owners, each named by its class and each clearing only its own: a
    // status (`ok`/`err` — cleared by the next status that fits the pill), the pulse (`gone` — cleared by an alive pulse, which puts
    // back the status bar it covered), a new revision (`rev`) and the self-check (`broken`) — those two stay until the page reloads and
    // are never covered. N1: the pulse used to hide every bar not classed ok, and the pill kept pointing at a bar that was gone.
    "var barMsg=null,barCls='';function barFree(){var c=$('#banner').className;return c!=='rev'&&c!=='broken'}",
    "function showBar(){var b=$('#banner');b.textContent=barMsg;b.className=barCls;b.style.display='block'}",
    "function status(msg,cls,short){var s=$('#status');var b=$('#banner');s.className=cls||'';s.textContent=msg||'';",
    " if(msg&&s.scrollHeight>s.clientHeight+1){s.textContent=short||(cls==='err'?TX.pillErr:TX.pillOk);barMsg=msg;barCls=cls==='err'?'err':'ok';if(barFree())showBar()}",
    " else{barMsg=null;if(b.className==='ok'||b.className==='err'){b.style.display='none';b.className=''}}}",
    // I12: the browser draft — every field in localStorage, restored with a note
    "var DK=CFG.draftKey+':';",
    // OW6 (2.8): a draft key carries the FINGERPRINT of its question — in a new revision of the document a draft comes back only onto
    // the same question; a draft of a changed or removed question (or of a page before 2.8) is shown as «draft of a previous revision»
    "function qhOf(n){var p=n.split(':');if(p.length<3)return'';var id=p[p.length-1],d=p.slice(1,p.length-1).join(':');for(var i=0;i<QS.length;i++)if(QS[i].doc===d&&QS[i].id===id)return QS[i].qh||'';return''}",
    "function dkey(n){var h=qhOf(n);return DK+n+(h?'#'+h:'')}",
    "function saveDraft(el){try{localStorage.setItem(dkey(el.name),el.type==='radio'?(el.checked?el.value:''):el.value)}catch(e){}}",
    "function restoreDraft(){var n=0;var els=document.querySelectorAll('[data-draft]');",
    " for(var i=0;i<els.length;i++){var el=els[i];var v=null;try{v=localStorage.getItem(dkey(el.name))}catch(e){}",
    "  if(v===null||v==='')continue;",
    "  if(el.type==='radio'){if(el.value===v&&!el.checked){el.checked=true;n++}}else if(!el.value){el.value=v;n++}}",
    " var orph=[];try{for(var j=0;j<localStorage.length;j++){var k=localStorage.key(j);if(k.indexOf(DK)!==0)continue;var nm=k.slice(DK.length).split('#')[0];",
    "  if(nm.indexOf('__')===0)continue;var ov=localStorage.getItem(k);if(ov&&k!==dkey(nm))orph.push(nm+': '+ov)}}catch(e){}",
    " if(orph.length){var od=document.createElement('section');od.className='qcard danger';var op=document.createElement('p');op.className='err';op.textContent=TX.orphan;",
    "  var ot=document.createElement('textarea');ot.rows=Math.min(12,orph.length*2+1);ot.value=orph.join(String.fromCharCode(10));od.appendChild(op);od.appendChild(ot);",
    "  var mn=document.querySelector('main');if(mn)mn.insertBefore(od,mn.firstChild)}",
    " if(n>0)status(fmt(TX.draft,{n:n}),'okmsg')}",
    // P3: a radio cleared by a second click; activation taken over on pointerdown. 2.9, epic CP (origin ticket #128 — the owner, twice:
    // "the radio buttons do not clear on a second tap"): preventDefault on pointerdown does NOT cancel the click the same press
    // produces, and that click re-checked what pointerdown had cleared. The capture listener below swallows exactly that click (same
    // label, within CLICK_OF_PRESS_MS); a keyboard click comes without a pointerdown and stays native.
    "var pdAt=0,pdLab=null;",
    "document.addEventListener('click',function(e){if(!pdLab||Date.now()-pdAt>" + CLICK_OF_PRESS_MS + ")return;",
    " var lab=e.target&&e.target.closest?e.target.closest('label.opt'):null;if(lab!==pdLab)return;pdLab=null;e.preventDefault()},true);",
    "document.addEventListener('pointerdown',function(e){var lab=e.target&&e.target.closest?e.target.closest('label.opt'):null;",
    " if(!lab)return;var inp=lab.querySelector('input[type=radio]');if(!inp||inp.disabled)return;",
    " e.preventDefault();var was=inp.checked;pdAt=Date.now();pdLab=lab;",
    " if(e.target===inp){inp.checked=!was}else if(!was){inp.checked=true}",
    " lastInput=Date.now();saveDraft(inp);pulseSoon()});",
    "document.addEventListener('input',function(e){if(e.target&&e.target.hasAttribute&&e.target.hasAttribute('data-draft')){lastInput=Date.now();saveDraft(e.target);pulseSoon()}});",
    // LP (#66, found by the live run): the lock learned of typing only at the next 15-s pulse — a `--close` three seconds
    // after the first keystroke found "no input" and closed the page. The first keystroke after a pause pulses within a second.
    "var pulseTimer=null;function pulseSoon(){if(pulseTimer)return;pulseTimer=setTimeout(function(){pulseTimer=null;pulse()},800)}",
    "function fieldVal(name){var el=document.getElementsByName(name)[0];return el?el.value:''}",
    "function collect(doc){var answers={};for(var i=0;i<QS.length;i++){var q=QS[i];",
    " if(q.doc!==doc)continue;",
    " var com=fieldVal('comment:'+doc+':'+q.id);",
    " if(q.answered){if(com.trim())answers[q.id]={choice:'',text:'',comment:com.trim()};continue}", // an answered question yields only its extra comment
    " var chosen='';var rs=document.getElementsByName('choice:'+doc+':'+q.id);",
    " for(var j=0;j<rs.length;j++)if(rs[j].checked)chosen=rs[j].value;",
    " var own=fieldVal('text:'+doc+':'+q.id);",
    " if(chosen||own.trim()||com.trim())answers[q.id]={choice:chosen,text:own.trim(),comment:com.trim()}}",
    " var arts={};var A=CFG.artifacts||[];",
    " for(var k=0;k<A.length;k++){var a=A[k];if(a.doc!==doc||!a.exists)continue;",
    "  var st='';var ars=document.getElementsByName('art:'+doc+':'+a.id);",
    "  for(var m=0;m<ars.length;m++)if(ars[m].checked)st=ars[m].value;",
    "  var ac=fieldVal('artcomment:'+doc+':'+a.id).trim();",
    "  if(st||ac)arts[a.id]={status:st,sha256:a.sha256,comment:ac}}", // a remark without a status is kept too (I10)
    " var p={doc:doc,answers:answers,comment:fieldVal('doccomment:'+doc),face:CFG.face};",
    " for(var z in arts){p.artifacts=arts;break}",
    // proofreading: one comment per paragraph, empty ones dropped
    " if(CFG.face==='proofread'){var cm={};for(var pi=0;pi<CFG.paragraphs.length;pi++){var pid=CFG.paragraphs[pi];var pv=fieldVal('para:'+doc+':'+pid).trim();if(pv)cm[pid]=pv}p.comments=cm}",
    " return p}",
    // I10/I11: loud refusal + rescue ring; buttons active again, the text returns to the human
    "function rescue(payload,msg){status(fmt(TX.err,{m:msg}),'err');var r=$('#rescue');r.style.display='block';",
    " $('#rescuetext').value=JSON.stringify(payload,null,2);enableButtons(true)}",
    "function enableButtons(on){var bs=document.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].disabled=!on}",
    "var saved=false,closeTimer=null,lastPayload=null,saving=false;",
    // LP (#66): input state for the pulse (`--close` reads it from the lock) and the local save when the server is gone
    "var lastInput=0,lsOk=true,submittedLocally=false;try{localStorage.setItem(DK+'__probe','1');localStorage.removeItem(DK+'__probe')}catch(e){lsOk=false}",
    // RL D-F2 (2.7, court of the version): the answer survives a dead server ONLY in the contour's own --app window — it runs
    // on the project profile the agent reads back. A TAB lives in some other browser profile the agent never reads, so
    // there the page must not promise the pick-up: it falls back to the rescue ring (the text · Copy · Retry). The window
    // is OBSERVED by the page (display-mode: standalone — true only for --app, measured headed and headless:
    // tools/sandbox/probes/display-mode-headless.mjs), never assumed from what the launcher tried to open.
    "var inApp=false;try{inApp=!!(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)}catch(e){}",
    "function draftCount(){var n=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.indexOf(DK)===0&&k!==DK+'__submitted'&&k!==DK+'__probe')n++}}catch(e){}return n}",
    // The SUBMITTED answer's PRIMARY carrier is IndexedDB (it wins at pick-up; a copy goes to localStorage, written synchronously just before): measured on this class of machine, IndexedDB is on disk 0.5 s after the
    // write under a hard kill of the browser, localStorage only after ~6 s (the recon's table of kills at 0.5–15 s). A copy
    // stays in localStorage for a browser without IndexedDB; only when BOTH fail does the rescue ring come back.
    "function idbPut(k,v,cb){try{var r=indexedDB.open('kaif-contour',1);r.onupgradeneeded=function(){r.result.createObjectStore('kv')};",
    " r.onsuccess=function(){try{var tx=r.result.transaction('kv','readwrite');tx.objectStore('kv').put(v,k);tx.oncomplete=function(){cb(true)};tx.onerror=function(){cb(false)};tx.onabort=function(){cb(false)}}catch(e){cb(false)}};",
    " r.onerror=function(){cb(false)}}catch(e){cb(false)}}",
    "function saveLocally(p,e){var js=JSON.stringify(p);var ls=false;if(lsOk){try{localStorage.setItem(DK+'__submitted',js);ls=true}catch(e2){}}",
    " idbPut(DK+'__submitted',js,function(okIdb){if(!okIdb&&!ls){rescue(p,String(e));return}",
    "  submittedLocally=true;saved=true;$('#rescue').style.display='none';status(TX.savedLocally,'okmsg',TX.savedLocallyShort);enableButtons(false)})}",
    "function isNotice(doc){var n=CFG.notices||[];for(var i=0;i<n.length;i++)if(n[i]===doc)return true;return false}",
    "function hasArtifacts(doc){var A=CFG.artifacts||[];for(var i=0;i<A.length;i++)if(A[i].doc===doc&&A[i].exists)return true;return false}",
    "function hasComments(p){for(var k in (p.comments||{}))return true;return false}",
    // OW6 (2.8): after a partial save the drafts of the SAVED questions go (the others stay); a save against another revision, or a
    // pulse that sees one, turns saving off and offers the new revision — the owner's text stays on the page
    "function clearSaved(p){var ids=Object.keys(p.answers||{});try{var ks=[];for(var i=0;i<localStorage.length;i++)ks.push(localStorage.key(i));",
    " for(var k=0;k<ks.length;k++){if(ks[k].indexOf(DK)!==0)continue;var nm=ks[k].slice(DK.length).split('#')[0];",
    "  if(p.comment&&nm==='doccomment:'+p.doc)localStorage.removeItem(ks[k]);",
    "  for(var j=0;j<ids.length;j++)if(nm==='choice:'+p.doc+':'+ids[j]||nm==='text:'+p.doc+':'+ids[j]||nm==='comment:'+p.doc+':'+ids[j])localStorage.removeItem(ks[k])}}catch(e){}}",
    "function newRevision(msg){var b=$('#banner');b.className='rev';b.style.display='block';b.textContent='';var bt=document.createElement('button');bt.type='button';",
    " bt.style.background='#fff';bt.style.color='#1d1d1f';bt.style.marginRight='10px';bt.textContent=TX.reloadRev;bt.onclick=function(){location.reload()};b.appendChild(bt);b.appendChild(document.createTextNode(msg));",
    " var sv=document.querySelectorAll('#save,.savedoc,#retry');for(var i=0;i<sv.length;i++)sv[i].disabled=true}",
    "function staleSave(p){rescue(p,TX.stale);status('','');newRevision(TX.stale)}", // the banner and the ring carry the message — the pill never covers the button
    "function doSave(doc){var p=collect(doc);if(isNotice(doc))p.read=true;p.rev=CFG.rev;lastPayload=p;",
    // bugs/113: on the proofreading and mockup faces "Done" with empty fields is a LEGAL outcome — "looked, no remarks"
    // (the most frequent verdict on an artifact); only the interview face still needs an answer or a comment.
    " var quiet=CFG.face==='proofread'||CFG.face==='mockup';",
    " if(quiet&&!(p.comment||'').trim()&&!hasComments(p))p.noRemarks=true;",
    " if(!p.read&&!quiet&&Object.keys(p.answers).length===0&&!(p.comment||'').trim()&&!p.artifacts&&!hasComments(p)){",
    "  status(hasArtifacts(doc)?TX.needArt:TX.nothing,'err');return}",
    " enableButtons(false);status(TX.saving);saving=true;",
    " fetch('/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)})",
    " .then(function(r){return r.json().then(function(j){return{ok:r.ok,st:r.status,j:j}})})",
    " .then(function(res){saving=false;if(res.st===409){staleSave(p);return}if(!res.ok||!res.j.ok){rescue(p,res.j.reason||'server refused');return}",
    // OW6 (2.8): questions left → the page STAYS: the saved answers' drafts go, the page re-reads itself (a fresh build, I1 — the answered
    // question moves to the settled fold, the other drafts come back) and says how many are left
    "  if(res.j.rev)CFG.rev=res.j.rev;",
    "  if(CFG.face==='interview'&&res.j.left>0){clearSaved(p);try{sessionStorage.setItem(DK+'__left',String(res.j.left))}catch(e){}location.reload();return}",
    // the light re-judge of epic CP (QA7v): a ring left by an earlier refused save goes with the answer recorded — as on the local path
    "  saved=true;$('#rescue').style.display='none';status(fmt(TX.saved,{w:res.j.written}),'okmsg');",
    "  try{var ks=[];for(var i=0;i<localStorage.length;i++)ks.push(localStorage.key(i));",
    "   for(var k=0;k<ks.length;k++)if(ks[k].indexOf(DK)===0)localStorage.removeItem(ks[k])}catch(e){}",
    // I27/DEF2: auto-close is an ATTEMPT; a refusal → an honest request; cancelled by pagehide
    "  setTimeout(function(){window.close();closeTimer=setTimeout(function(){status(TX.closeYourself,'err')},CFG.reserveMs)},CFG.closeMs)})",
    " .catch(function(e){saving=false;if(inApp)saveLocally(p,e);else rescue(p,TX.serverGone)})}", // LP (#66): the server is gone → in the app window the answer is saved on this computer, no dialog; in a tab — the rescue ring (RL D-F2)
    "document.addEventListener('click',function(e){var t=e.target;",
    " if(t&&t.classList&&t.classList.contains('savedoc'))doSave(t.getAttribute('data-doc'));",
    " if(t&&t.id==='retry'&&lastPayload)doSave(lastPayload.doc)});",
    "var single=$('#save');if(single)single.addEventListener('click',function(){doSave(single.getAttribute('data-doc'))});",
    "var cp=$('#copybtn');if(cp)cp.addEventListener('click',function(){var t=$('#rescuetext');t.select();",
    " try{document.execCommand('copy');status(TX.copied,'okmsg')}catch(e){status(TX.copyManually,'err')}});",
    // I13/DEF4: page→server pulse — the human learns of a dead server AT ONCE and out loud
    // LP (#66): the pulse carries the input state — i: ms since the last keystroke (-1 = none), d: draft fields, s: saved
    "function pulse(){fetch('/alive?i='+(lastInput?Date.now()-lastInput:-1)+'&d='+draftCount()+'&s='+(saved?1:0)+'&doc='+encodeURIComponent(CFG.doc||'')).then(function(r){if(!r.ok)throw 0;var b=$('#banner');if(b.className==='gone'){if(barMsg)showBar();else{b.style.display='none';b.className=''}}return r.json().catch(function(){return null})})",
    // OW6 (2.8): the pulse names the document's revision on disk — another one than this page was built from → saving off, the new revision offered
    // bugs/125 (2.8): the entry page rebuilds itself only when the QUEUE changed (a document answered in another window) — never on focus alone
    " .then(function(j){if(CFG.index&&j&&j.qrev&&CFG.qrev&&j.qrev!==CFG.qrev){location.reload();return}",
    "  if(j&&j.rev&&CFG.rev&&j.rev!==CFG.rev&&!saving&&!saved)newRevision(TX.rewritten)})",
    // after the LAST answer the server ends by design (I8) — a dead pulse then is no news, never «the answer will NOT be sent»
    " .catch(function(){var b=$('#banner');if(submittedLocally||saved||!barFree())return;b.className='gone';b.style.display='block';b.textContent=(lsOk&&inApp)?TX.serverGoneLocal:TX.serverGone;",
    "  if(!(lsOk&&inApp)){var r=$('#rescue');r.style.display='block';if(lastPayload)$('#rescuetext').value=JSON.stringify(lastPayload,null,2)}",
    "  if(!submittedLocally)enableButtons(true)})}",
    "setInterval(pulse,CFG.aliveMs);pulse();",
    // I14/DEF6: closing the page is an EVENT for the server (fast path — the beacon names the window role)
    "window.addEventListener('pagehide',function(){if(closeTimer)clearTimeout(closeTimer);",
    " try{navigator.sendBeacon('/closed',(CFG.index?'index':'doc')+':'+(saved?'saved':'unsaved'))}catch(e){}});",
    // bugs/125 (2.8): focus asks the pulse (above) — a reload on EVERY focus looped in a tab, which fires focus after each load
    "if(CFG.index)window.addEventListener('focus',pulse);",
    // spec §2: the page SELF-CHECK — radio groups == questions with options; a mismatch is LOUD, never silent
    "var selfBroken=false;(function(){if(CFG.face!=='interview'||CFG.index)return;var rs=document.querySelectorAll('input[type=radio]');var names={};",
    " for(var i=0;i<rs.length;i++)if(rs[i].name.indexOf('choice:')===0)names[rs[i].name]=1;var n=Object.keys(names).length;",
    " if(n!==CFG.expectRadioGroups){selfBroken=true;var b=$('#banner');b.className='broken';b.style.display='block';b.textContent=fmt(TX.selfcheck,{r:n,q:CFG.expectRadioGroups});enableButtons(false)}})();",
    // I26 (origin issue #64): the page knows whether it lives in the contour's own --app window or in a TAB of the
    // owner's working browser — `display-mode: standalone` is true only in the app window (measured on Chrome, headed
    // and headless; locationbar.visible is true everywhere and useless). A tab → a yellow note to the owner + one
    // POST so the agent's log says it too. The window the launcher opened is the agent's claim; this is the observation.
    "(function(){if(inApp)return;var tn=$('#tabnote');if(tn){tn.style.display='block';tn.textContent=TX.tabnote}",
    " try{fetch('/tab',{method:'POST'})}catch(e){}})();",
    "restoreDraft();",
    "try{var lf=sessionStorage.getItem(DK+'__left');if(lf!==null){sessionStorage.removeItem(DK+'__left');status(fmt(TX.left,{n:lf}),'okmsg')}}catch(e){}", // OW6
  ].join('\n');

  const saveLabel = face === 'proofread' || face === 'mockup' ? t.btn.done : t.btn.save;
  const saveBar = index
    ? '<div class="fab" style="display:none"><div id="status"></div></div>'
    : noticeDoc
      ? '<div class="fab"><button id="save" type="button" data-doc="' + esc(noticeDoc) + '">' + t.btn.read + '</button><div id="status">' + t.st.noticeHint + '</div></div>'
      : '<div class="fab"><button id="save" type="button" data-doc="' + esc(singleDoc || '') + '">' + saveLabel + '</button><div id="status"></div></div>';
  const langNote = t.fallbackFrom ? '<span class="langnote">' + esc(t.head.langFallback(t.fallbackFrom)) + '</span>' : '';

  return '<!doctype html>\n<html lang="' + esc(cfg.language) + '"><head><meta charset="utf-8">' +
    '<title>' + esc(cfg.projectName) + ' · ' + esc(title) + (cfg.session ? ' · ' + esc(cfg.session) : '') + '</title>' + // OW4: which workspace's window
    '<link rel="icon" href="data:,"><style>' + css + '</style></head><body>' +
    '<header><span class="project">' + esc(cfg.projectName) + '</span>' + heading + langNote + '</header>' + // P9
    '<div id="banner"></div><div id="tabnote"></div><main>' + main +
    '<div id="rescue"><p class="err">' + t.st.rescue + '</p><textarea id="rescuetext" rows="8"></textarea>' +
    '<p><button class="ghost" id="copybtn" type="button">' + t.btn.copy + '</button> <button class="ghost" id="retry" type="button">' + t.btn.retry + '</button></p></div>' +
    '</main>' + saveBar + '<script>' + js + '</script></body></html>';
}

// ── The window (DEF8): an app window when a Chromium browser is found, else the default browser,
// else an honest "open it yourself: URL" — the contour never pretends a window opened. ───────
// LP (2.7, #66): the app window runs on its OWN profile inside the project (`.kaif/contour-window/`, ignore-first) with
// the three EXP-0134 flags — the draft and a locally saved answer then live on the owner's disk IN THE PROJECT, and the
// agent can read them back headless on the same profile. Verified on Edge (Windows); Chrome/macOS take the same
// flags and are NOT verified — said so in the run report, never promised.
// Linux is NOT supported (2.9, the owner's word 2026-10-03 — remove the contour's Linux code entirely): no launch is attempted
// there, the contour prints the honest NO WINDOW line with the URL and serves the page as everywhere else.
const profileDir = (root) => resolve(root, WINDOW_PROFILE_DIR);
const profileArgs = (root) => ['--user-data-dir=' + profileDir(root), ...PROFILE_QUIET_FLAGS];
function openWindow(url, log = console.log, root = process.cwd()) {
  const tryCmd = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: BEEP_DEADLINE_MS }).status === 0; } catch { return false; } };
  const prof = profileArgs(root);
  // light judge of epic CP, F7: the machine's own browser (`KAIF_BROWSER`, the first entry of the one browser list) raises the window too —
  // before, only the answer recovery honoured it
  const own = process.env.KAIF_BROWSER;
  if (IS_WIN) {
    const tryApp = (exe) => tryCmd('cmd.exe', ['/c', 'start', '', exe, '--app=' + url, '--window-size=' + WINDOW_SIZE, ...prof]);
    if (own && tryApp(own)) return 'KAIF_BROWSER --app';
    if (tryApp('msedge')) return 'edge --app';
    if (tryApp('chrome')) return 'chrome --app';
    if (tryCmd('cmd.exe', ['/c', 'start', '', url])) { log('Could not raise an app window — opened a plain tab in the default browser (no project profile: a draft there cannot be recovered by the agent); please close it yourself (DEF8).'); return 'tab'; }
  } else if (IS_MAC) {
    if (own && tryCmd('open', ['-na', own, '--args', '--app=' + url, '--window-size=' + WINDOW_SIZE, ...prof])) return 'KAIF_BROWSER --app';
    if (tryCmd('open', ['-na', 'Google Chrome', '--args', '--app=' + url, '--window-size=' + WINDOW_SIZE, ...prof])) return 'chrome --app';
    if (tryCmd('open', [url])) { log('Could not raise an app window — opened the default browser; please close it yourself (DEF8).'); return 'browser'; }
  } else {
    log('NO WINDOW OPENED — open it yourself: ' + url + ' (this platform is not supported by the contour window — Windows and macOS only; the page is served until you answer or close it).');
    return 'none';
  }
  log('NO WINDOW OPENED — open it yourself: ' + url + ' (no browser found on this machine; the page is served until you answer or close it).');
  return 'none';
}

// LP / EXP-0134: after the window came up, read the profile's Preferences — a Chromium of the OS vendor may sign the
// NEW profile into the OS account despite the flags; the agent says it out loud instead of the owner discovering it.
function checkProfileAccount(root, log = console.log, attempt = 0) {
  const prefs = join(profileDir(root), 'Default', 'Preferences');
  const delays = [ACCOUNT_CHECK_DELAY_MS, 3 * ACCOUNT_CHECK_DELAY_MS, 6 * ACCOUNT_CHECK_DELAY_MS]; // Preferences appears seconds after the window (live run: not yet at 5 s)
  const t = setTimeout(() => {
    try {
      if (!existsSync(prefs)) {
        if (attempt + 1 < delays.length) { checkProfileAccount(root, log, attempt + 1); return; }
        log('Profile check: ' + WINDOW_PROFILE_DIR + '/Default/Preferences not written within ' + (delays[attempt] / 1000) + ' s — sign-in state unknown (EXP-0134)'); return;
      }
      const signed = /account_info"\s*:\s*\[\s*\{/.test(readFileSync(prefs, 'latin1'));
      log(signed
        ? 'PROFILE SIGNED IN: ' + WINDOW_PROFILE_DIR + ' carries account_info — the browser ignored the sign-in flags (EXP-0134); report it, the profile holds account data'
        : 'Profile check: ' + WINDOW_PROFILE_DIR + ' has no account_info — the window profile did not sign into the OS account (EXP-0134)');
    } catch (e) { log('Profile check failed: ' + e.message); }
  }, delays[attempt]);
  t.unref();
}

// ── The lock "one document — one window" (I29) ────────────────────────────────────────────────
// CP (2.9, origin #128 comment 2): the waiter's line and the server log name the WHOLE decision — the choice, the owner's text, his
// comment on the question and on the document. Before, a choice hid the text and both comments ("Q2 = A"), and a defect the owner
// had written into them went unread until a judge found it.
function decisionWords(d) {
  const q = (t) => { const one = String(t).replace(/\s+/g, ' ').trim(); return '«' + one.slice(0, WORDS_QUOTE_CHARS) + (one.length > WORDS_QUOTE_CHARS ? '…' : '') + '»'; };
  const parts = Object.entries(d.answers || {}).map(([k, a]) =>
    k + ' = ' + ([a.choice, a.text ? 'text ' + q(a.text) : '', a.comment ? 'comment ' + q(a.comment) : ''].filter(Boolean).join(' + ') || '—'));
  if (d.comment) parts.push('document comment ' + q(d.comment));
  return parts.join(', ');
}
const lockPath = (root, key) => join(decisionsAbs(root), key.replace(/\.[^.]+$/u, '') + '.lock');
function checkLock(root, key) {
  const p = lockPath(root, key);
  if (!existsSync(p)) return null;
  let lock;
  try { lock = JSON.parse(stripBom(readFileSync(p, 'utf8'))); } catch { rmSync(p, { force: true }); return null; } // unreadable → gone
  try { process.kill(lock.pid, 0); return lock; }                          // alive → the live address (I29)
  catch (e) {
    if (e.code === 'EPERM') return lock;                                   // alive under another user → still live
    // I29 mechanized (origin issue #64): the process is GONE but the lock is KEPT — it remembers the PORT of the window
    // that may still stand in front of the owner with his draft in it; serveContour comes up on that port first and
    // names the loss when it cannot (the port is part of the web origin — a fresh port orphans the draft).
    return { ...lock, stale: true };
  }
}

// ── The server: raise → show → call → wait → record → die (I8) ───────────────────────────────
// OW6 (2.8): the revision of a document — the hash its page is built from (the text; the base64 of an image)
function docRev(root, rel) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) return null;
  return IMAGE_MIME[extname(abs).toLowerCase()] ? bodyHash(readFileSync(abs).toString('base64')) : bodyHash(readFileSync(abs, 'utf8'));
}
// OW6: how many questions of a document are still unanswered (0 for anything that is not markdown)
function leftIn(root, rel) {
  const abs = resolve(root, rel);
  if (!/\.md$/i.test(abs) || !existsSync(abs)) return 0;
  return parseQuestions(readFileSync(abs, 'utf8')).filter((q) => !q.answered).length;
}
// OW6 (2.8; the KAIF owner's word — answers are saved one at a time in every project; the field device he pointed to wakes its agent
// by a separate waiter): the WAITER — the process the agent starts to be woken by the next recorded answer while the page stays open
// (I8: the agent learns of an event by the END of a process it started). Exit 0 on a new record — it names the document, the answers
// so far and the questions left; exit 2 when the contour it saw ended without one — its lock gone, or (CP6, 2.9, #125) its server's
// process dead while the lock stays. Patience is infinite (I9). No document → the queue.
// [TESTED: 2026-09-25 19:37–20:01 · selftest: exit 0 on a partial record, exit 2 when the lock it saw is gone; s22 D (7): a separate
//  process on the deployed copy printed «Recorded: … — Q1 = A · questions left: 2» and exited 0; report testcases/reports/2026-09-25_ow6-partial-save-revision.md]
// (court RL 2.8, B-F1) a waiter that never sees a live contour — the page closed before it started, or was never raised — ends with 2
// after WAIT_NO_CONTOUR_MS instead of waiting forever; the window lets it start BEFORE the page, as the ritual says (the page comes up
// within seconds). An answer recorded before the waiter started is on disk — `--queue --list` names it.
export function waitForRecord(root, docPath = null, { log = console.log, pollMs = WAIT_POLL_MS, graceMs = WAIT_NO_CONTOUR_MS } = {}) {
  const cfg = cfgOf(root), dir = decisionsAbs(root, cfg);
  const files = () => (docPath ? [decisionPaths(root, docPath, cfg).decision]
    : (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.decision.json')).map((f) => join(dir, f)) : []));
  const stamp = (f) => { try { const s = lstatSync(f); return s.size + ':' + s.mtimeMs; } catch { return null; } };
  const start = new Map(files().map((f) => [f, stamp(f)]));
  const lock = lockPath(root, docPath ? basename(docPath) : '_queue');
  // (light re-judge RL 2.8, J-F1) the QUEUE page shows this document too: a document waiter next to a live queue page waits — the
  // queue server holds the `_queue` lock, never the document's own, and the B-F1 window used to end such a waiter with a false line
  const queueLock = docPath ? lockPath(root, '_queue') : null;
  // CP6 (2.9, origin issue #125): a KILLED server leaves its lock on purpose (I29 — the next run reuses its port), so the lock's
  // existence is not life: its pid is judged too. Read-only (checkLock removes an unreadable lock — a waiter must never delete what
  // the server may be writing); a lock that cannot be judged (being written, no pid) counts as live, as before.
  // [TESTED: 2026-09-29 · selftest (4d) a SIGKILLed server's lock → exit 2 with the line, (4e) a dead lock at the start keeps the window —
  //  both red on the v2.8 rule (mutant «lock exists = live»); verify-contour QA7: the real page server killed with SIGKILL, the waiter
  //  started as a separate process exited 2 with «server is gone … --queue --list»; report testcases/reports/2026-09-28_cp-question-page.md]
  const lockState = (p) => {
    if (!existsSync(p)) return 'none';
    let held; try { held = JSON.parse(stripBom(readFileSync(p, 'utf8'))); } catch { return 'live'; }
    if (!Number.isInteger(held && held.pid) || held.pid <= 0) return 'live';
    try { process.kill(held.pid, 0); return 'live'; } catch (e) { return e.code === 'EPERM' ? 'live' : 'dead'; }
  };
  const states = () => [lockState(lock), queueLock !== null ? lockState(queueLock) : 'none'];
  const live = () => states().includes('live');
  const gone = () => { const s = states(); return !s.includes('live') && s.includes('dead'); };
  const goneLine = () => 'The page\'s server is gone (its process is not running; the lock stays for the next run, I29) — nothing was recorded '
    + 'through it; an answer the owner saved in the window is kept on this computer: run ' + CLI_NAME + ' --queue --list to pick it up.';
  let lockSeen = live();
  const startedAt = Date.now();
  log('Waiting for the next recorded answer' + (docPath ? ' on ' + relDoc(root, docPath) : ' in the queue') + ' — exit 0 when one is recorded (OW6, I8).');
  return new Promise((done) => {
    const tick = setInterval(() => {
      for (const f of files()) {
        const s = stamp(f);
        if (s === null || start.get(f) === s) continue;
        clearInterval(tick);
        let d = {};
        try { d = JSON.parse(stripBom(readFileSync(f, 'utf8'))); } catch { /* a record being written — named by its file below */ }
        const rel = d.document || relDoc(root, f);
        const answers = decisionWords(d);
        log('Recorded: ' + rel + (answers ? ' — ' + answers : '') + ' · questions left: ' + leftIn(root, rel)
          + ' — apply it; while questions are left, start --wait again (the page stays open).');
        done(0);
        return;
      }
      if (live()) lockSeen = true;
      else if (lockSeen) {
        clearInterval(tick);
        log(gone() ? goneLine() : 'The contour ended without a new record — nothing to apply (the page was closed or the contour stopped).');
        done(2);
      } else if (Date.now() - startedAt > graceMs) {
        // a lock of a dead server found at the start is an old crash, not this page: the window still lets a new page come up on it
        clearInterval(tick);
        if (gone()) { log(goneLine()); done(2); return; }
        log('No live contour' + (docPath ? ' for ' + relDoc(root, docPath) : ' for the queue') + ' within ' + Math.round(graceMs / 1000)
          + ' s — nothing to wait for: the page was never raised, or it ended before the waiter started; an answer already recorded is on disk ('
          + CLI_NAME + ' --queue --list names it).');
        done(2);
      }
    }, pollMs);
  });
}

export function serveContour(root, { docPath = null, batch = false, notice = false, face = 'interview' }, opts = {}) {
  const cfg = cfgOf(root), t = T(cfg);
  const { open = true, signal = true, timeoutMs = 0, log = console.log, includeStale = false } = opts; // I9: default 0 — no timeout
  // A single document with no recognised questions and no outbound is served as a NOTICE automatically
  // (a page where no action is legal is a defect — origin bugs/105); the interview face only.
  if (docPath && !batch && !notice && face === 'interview') {
    try {
      const mdAuto = readFileSync(resolve(root, docPath), 'utf8');
      const metaAuto = parseMetaBlock(mdAuto);
      if (parseQuestions(mdAuto).length === 0 && !(metaAuto && metaAuto.artifacts && metaAuto.artifacts.length)) {
        notice = true;
        log('The document has no recognised questions and no outbound — showing it as a notice (I37).');
      }
      const cfAuto = checkForm(mdAuto); // QL1 (#56): a page that knows only PART of the blocks says so out loud
      if (cfAuto.unrecognised.length) log(t.check.partial(cfAuto.unrecognised.length));
    } catch { /* an unreadable document fails below with its own voice */ }
  }
  return new Promise((resolveP) => {
    const forOwner = () => ownerDocs(root, { includeStale });
    const build = () => batch ? buildIndexPage(root, forOwner(), pendingNotices(root))
      : notice ? buildNoticePage(root, docPath)
        : face === 'proofread' ? buildProofreadPage(root, docPath)
          : face === 'mockup' ? buildMockupPage(root, docPath) : buildPage(root, docPath);
    const buildDoc = (rel) => (readQueue(root).some((i) => i.doc === rel && isNoticeItem(i)) ? buildNoticePage(root, rel) : buildPage(root, rel));
    const first = build();
    const lockKey = batch ? '_queue' : basename(docPath);
    const held = checkLock(root, lockKey);
    if (held && !held.stale) {
      log('Already open by this contour: ' + held.url + ' (pid ' + held.pid + ') — not raising a second window (I29).');
      resolveP({ outcome: 'already-open', url: held.url, exitCode: EXIT_DECIDED });
      return;
    }
    // #64: the previous run's port, when its process is gone — tried FIRST (same web origin → the draft is restored)
    const stalePort = held && held.stale ? (Number((String(held.url).match(/:(\d+)\/?$/) || [])[1]) || 0) : 0;
    let outcome = null, beaconTimer = null, lastAlive = Date.now(), strikes = 0, tabReported = false;
    const startedAt = Date.now();
    // LP (#66): what `--close` reads — written at listen and refreshed by every pulse
    let inputState = { lastInputAt: null, draftFields: 0, saved: false };
    let lockUrl = null;
    const closeToken = randomBytes(16).toString('hex'); // `--close` proves it read THIS lock, and the server ends itself — no pid from a file is ever killed
    const startedIso = provenance().at; // ONCE: the page's age is measured from here by `--close` — a stamp taken per pulse would reset it (found by the debug run 09:14)
    const writeLock = () => {
      if (!lockUrl) return;
      try {
        mkdirSync(decisionsAbs(root), { recursive: true });
        writeFileSync(lockPath(root, lockKey), JSON.stringify({ pid: process.pid, url: lockUrl, startedAt: startedIso,
          doc: batch ? '_queue' : relDoc(root, docPath), title: first.title, closeToken, ...inputState }) + '\n', 'utf8');
      } catch { /* a lock that cannot be written is reported by the listen step, not here */ }
    };
    const noticeMode = notice && !batch;
    let savedInRun = 0; // OW6 (judge OW10 H6): answers already recorded by this page — a close after them loses nothing and says so
    const unreadOutcome = () => (noticeMode ? 'notice left unread'
      : savedInRun > 0 ? 'page closed after ' + savedInRun + ' saved answer(s) — recorded, nothing lost' : 'page closed without an answer');
    const unreadSuffix = noticeMode ? ' The notice is NOT delivered (no "' + t.btn.read + '" mark, I38) — it repeats in the next batch.' : '';
    // OW6 (2.8): the pulse is answered with the revision on disk — only for a document this contour shows
    const pulseRev = (d) => (d && (batch ? pendingDocs(root).some((x) => x.doc === d) : d === relDoc(root, docPath)) ? docRev(root, d) : null);
    const server = createServer((req, res) => {
      const ok = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(build().html); // I1: always a fresh build from the source
      } else if (req.method === 'GET' && batch && req.url.startsWith('/d/')) {
        const rel = decodeURIComponent(req.url.slice('/d/'.length)); // only documents of the current queue
        const allowed = pendingDocs(root).some((d) => d.doc === rel) || pendingNotices(root).some((n) => n.doc === rel);
        if (!allowed) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not in the queue: ' + rel); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildDoc(rel).html);
      } else if (req.method === 'GET' && req.url.startsWith('/alive')) {
        lastAlive = Date.now(); strikes = 0;
        if (beaconTimer) { clearTimeout(beaconTimer); beaconTimer = null; } // the page came back (T3)
        // LP (#66): the pulse carries the INPUT state — ms since the last keystroke (-1 = none yet), draft fields in
        // localStorage, whether the answer was saved — and the lock carries it on, so `--close` in ANOTHER process can
        // refuse while the owner is typing. The lock is rewritten on every pulse (15 s; a few bytes).
        const q = new URL(req.url, 'http://x').searchParams;
        const sinceInput = Number(q.get('i')); const draftFields = Number(q.get('d')); const savedFlag = q.get('s') === '1';
        if (Number.isFinite(sinceInput)) {
          inputState = { lastInputAt: sinceInput >= 0 ? Date.now() - sinceInput : inputState.lastInputAt, draftFields: Number.isFinite(draftFields) ? draftFields : 0, saved: savedFlag };
          writeLock();
        }
        // OW6: the page compares its revision with the document on disk; bugs/125: the entry page compares the queue's
        ok({ ok: true, rev: pulseRev(q.get('doc')), qrev: batch ? queueRev(forOwner(), pendingNotices(root)) : null });
      } else if (req.method === 'POST' && req.url === '/tab') { // I26 (#64): the page says it is a TAB, not the app window
        if (!tabReported) {
          tabReported = true;
          log('Window check: the page reports it is NOT in an app window (display-mode: browser) — it opened as a TAB in a browser (I26); auto-close will not work there and the draft lives in that tab only — do not raise a second window, let the owner finish there.');
        }
        ok({ ok: true });
      } else if (req.method === 'POST' && req.url === '/decide') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { // I10: any refusal is loud, with the reason on the page
            const payload = JSON.parse(body);
            const doc = batch ? payload.doc : relDoc(root, docPath);
            // OW6 (2.8; the S1 of a neighbour field project — an old tab wrote answers into a rewritten document by question numbers):
            // the page answers the REVISION it was built from; another revision — or none (a page of an older contour) — is refused
            // loudly and the text stays on the page; the same save repeated after a lost response is recognised, never written twice
            const revNow = docRev(root, doc);
            if (payload.rev !== revNow) {
              const prevDec = readDecision(root, doc, cfg);
              const same = (a, b) => Boolean(a && b) && ['choice', 'text', 'comment'].every((k) => (a[k] || '') === (b[k] || ''));
              const dup = Boolean(payload.rev) && Boolean(prevDec) && prevDec.rev === payload.rev && Object.keys(payload.answers || {}).length > 0
                && Object.entries(payload.answers).every(([q, a]) => same(a, (prevDec.answers || {})[q]));
              if (dup) {
                ok({ ok: true, duplicate: true, written: doc + ' (' + t.st.duplicate + ')', left: leftIn(root, doc), rev: revNow, doc });
                log('Save repeated — already recorded (' + doc + '), nothing written twice (OW6).');
                return;
              }
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, stale: true, rev: revNow, reason: t.st.stale }));
              log('SAVE REFUSED (409): the page was built from another revision of ' + doc + (payload.rev ? '' : ' (no revision — a page of an older contour)')
                + ' — nothing written; the owner has the text on the page (OW6).');
              return;
            }
            const hasAnswers = payload.answers && Object.keys(payload.answers).length > 0;
            // NON-EMPTY ANSWERS OUTRANK ANY CLASSIFICATION (origin bugs/106): the owner's work is never dropped.
            const asNotice = !hasAnswers && ((notice && !batch) || readQueue(root).some((i) => i.doc === doc && isNoticeItem(i)));
            if (asNotice) { // I37: the "read" mark is a NORMAL outcome, exit 0
              const record = recordDecision(root, doc, { kind: KIND_NOTICE, comment: payload.comment }, cfg);
              markNoticeRead(root, doc); // I38: delivery is proven by the mark, and only by it
              const withComment = record.comment ? ' + comment' : '';
              ok({ ok: true, written: t.kind.notice + ' — ' + doc + withComment });
              outcome = 'notice read';
              const restN = pendingNotices(root).length;
              log('Outcome: notice read (' + doc + ', by ' + record.by + withComment + ') — ending the contour (I8).' +
                (restN > 0 ? ' Unread notices left: ' + restN + ' — restarting the batch is the agent\'s duty.' : ''));
              setTimeout(finish, SERVER_DEATH_MS, EXIT_DECIDED);
              return;
            }
            if (!batch && (face === 'proofread' || face === 'mockup')) {
              // bugs/113: empty fields on these faces = "no remarks" — a recorded decision, exit 0 (never a refusal)
              const noRemarks = Boolean(payload.noRemarks) && !(payload.comment || '').trim() && Object.keys(payload.comments || {}).length === 0;
              const record = recordDecision(root, doc, { kind: face, comment: payload.comment, comments: payload.comments, ...(noRemarks ? { noRemarks: true } : {}) }, cfg);
              const n = Object.keys(record.comments || {}).length;
              const what = noRemarks ? t.st.noRemarksWritten : (face === 'proofread' ? n + ' paragraph comment(s)' : 'mockup comment');
              ok({ ok: true, written: doc + ' + decision.json + archive (' + what + ')' });
              outcome = 'decision recorded';
              log('Outcome: ' + face + ' recorded (' + doc + ', ' + (noRemarks ? 'no remarks' : (face === 'proofread' ? n + ' paragraph comments' : 'comment')) + ', by ' + record.by + ') — ending the contour (I8).');
              setTimeout(finish, SERVER_DEATH_MS, EXIT_DECIDED);
              return;
            }
            const record = recordDecision(root, doc, { answers: payload.answers, comment: payload.comment, artifacts: payload.artifacts, rev: payload.rev }, cfg);
            const left = leftIn(root, doc); // OW6: the page stays while this is above zero
            const nAns = Object.keys(record.answers || {}).length;
            savedInRun += nAns;
            const arts = Object.entries(record.artifacts || {});
            const nApproved = arts.filter(([, a]) => a.status === 'approved').length;
            const rest = batch ? pendingDocs(root).filter((d) => d.unanswered > 0).length : 0;
            const artWord = arts.length ? ', outbound decided ' + arts.length + ' (approved ' + nApproved + ')' : '';
            ok({ ok: true, written: doc + ' + decision.json + archive (' + nAns + ' answer(s)' + artWord + ')', more: rest, doc, left, rev: docRev(root, doc) });
            outcome = 'decision recorded';
            const answersWord = decisionWords(record);
            if (arts.length) log('Outbound decision: ' + arts.map(([id, a]) => id + ' — ' + a.status).join(', ') + '. Sending is a separate agent step through a gate that calls the same checkApproval.');
            if (rest > 0) { // the batch does NOT end on the first document (origin bugs/52)
              log('Recorded: ' + doc + ' (' + answersWord + ', by ' + record.by + '). Documents left in the queue: ' + rest + ' — the page STAYS open, the contour waits.');
              outcome = null;
              return;
            }
            if (left > 0) { // OW6 (2.8, the KAIF owner's word — answers one at a time; I8): the page STAYS while anything is unanswered
              log('Recorded: ' + doc + ' (' + (answersWord || 'comment only') + ', by ' + record.by + '). Questions left: ' + left
                + ' — the page STAYS open; the waiter (--wait) wakes the agent (OW6, I8).');
              outcome = null;
              return;
            }
            log('Outcome: decision recorded (' + doc + ': ' + (answersWord || 'comment only') + ', by ' + record.by + ') — ending the contour (I8).');
            setTimeout(finish, SERVER_DEATH_MS, EXIT_DECIDED); // DEF3: the window has time to close
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: String(e.message || e) }));
            log('SAVE ERROR (the page shows the rescue ring): ' + e.message);
          }
        });
      } else if (req.method === 'POST' && req.url.startsWith('/close?')) { // LP (#66): the checked command asks the page's own server to end
        const q = new URL(req.url, 'http://x').searchParams;
        if (q.get('t') !== closeToken) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'wrong close token' })); return; }
        ok({ ok: true, pid: process.pid });
        if (outcome) return;
        outcome = 'closed by the agent (--close)';
        log('Outcome: closed by the checked command (--close)' + (q.get('keep') === '1' ? ' — the lock is KEPT: an unsaved draft lives in the window' : '') + ' — ending the contour.' + unreadSuffix);
        setTimeout(finish, 100, EXIT_CLOSED, q.get('keep') === '1');
      } else if (req.method === 'POST' && req.url === '/closed') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          ok({ ok: true });
          if (outcome) return; // already recorded — death on schedule (DEF3)
          if (batch && !String(body).startsWith('index')) { log('A document window closed — the queue entry page stays, the contour waits.'); return; }
          if (beaconTimer) clearTimeout(beaconTimer);
          beaconTimer = setTimeout(() => { // T3: ~3 s — does the page come back after a reload?
            outcome = unreadOutcome();
            log('Outcome: ' + outcome + ' — ending the contour (I14, beacon fast path).' + unreadSuffix);
            finish(EXIT_CLOSED);
          }, BEACON_RELOAD_GRACE_MS);
        });
      } else { res.writeHead(404); res.end(); }
    });
    // I14/DEF6: the silence watch — patience lives while the page lives; two strikes against sleep (T5)
    const watch = setInterval(() => {
      if (outcome) return;
      if (Date.now() - lastAlive > SILENCE_THRESHOLD_MS) {
        strikes += 1;
        if (strikes >= SILENCE_STRIKES_TO_DIE) {
          outcome = unreadOutcome();
          log('Outcome: the page has been silent longer than ' + (SILENCE_THRESHOLD_MS / 60000) + ' min (two strikes) — ending the contour (I14, silence watch).' + unreadSuffix);
          finish(EXIT_CLOSED);
        }
      } else strikes = 0;
      if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) { // DEF5: automation only
        outcome = unreadOutcome();
        log('Outcome: tolerated SILENCE exhausted (--timeout, automation only; not a deadline for thinking) — ending.' + unreadSuffix);
        finish(EXIT_CLOSED);
      }
    }, SILENCE_TICK_MS);
    const finish = (code, keepLock = false) => {
      clearInterval(watch);
      if (!keepLock) rmSync(lockPath(root, lockKey), { force: true });
      server.close(() => resolveP({ outcome, exitCode: code }));
      setTimeout(() => resolveP({ outcome, exitCode: code }), 1000).unref();
    };
    process.once('SIGINT', () => { // I25: the third outcome — interrupted by the human
      outcome = 'interrupted by the human';
      log('Outcome: interrupted by the human (SIGINT).');
      finish(EXIT_INTERRUPTED);
    });
    // I30: a free port, never a fixed one — and the PREVIOUS run's port FIRST when its process is gone (I29 mechanized,
    // origin issue #64): the port is part of the web origin, so coming up on the same port restores the draft the owner
    // typed in the window that outlived the process; taken by something else → a fresh port, and the loss is said by name.
    let retried = false;
    server.on('error', (e) => {
      if (stalePort && e.code === 'EADDRINUSE' && !retried) {
        retried = true;
        log('Port ' + stalePort + ' of the previous run is taken by another process — a fresh port follows; a draft written in the previous window is NOT visible here (I29): open that window if it is still there, or copy the text from it.');
        server.listen(0, '127.0.0.1');
      } else throw e;
    });
    server.once('listening', () => {
      const url = 'http://127.0.0.1:' + server.address().port + '/';
      if (stalePort && server.address().port === stalePort)
        log('Port ' + stalePort + ' reused from the previous run (its process ' + held.pid + ' is gone) — same web origin, so a draft written in that window is restored on load (I29/I12).');
      lockUrl = url; writeLock(); // LP: the lock carries doc · title · input state (read by `--close`)
      log('Page is up: ' + url + (batch ? ' (queue)' : ' (' + first.title + ')'));
      if (open) { // showing is the agent's action (I15) — and the claim is never wider than the observation (#63):
        // the launcher's exit code says a process was started, not that a window stands on the owner's screen
        const launcher = openWindow(url, log, root);
        log('Window: ' + launcher + (launcher === 'none' ? '' : " — the launcher returned 0; whether a window is on the owner's screen this line does not verify (a screenshot does)"));
        if (launcher.endsWith('--app')) checkProfileAccount(root, log); // EXP-0134: a new profile must not have signed in
      }
      if (open) { // I40: the fact of showing — at the moment of the open window
        const shownRels = batch ? forOwner().map((d) => d.doc) : [relDoc(root, docPath)];
        recordShown(root, shownRels, batch ? t.transport.batch : t.transport.page);
        log('Shown recorded (I40): ' + shownRels.length + ' doc(s) → ' + cfg.decisionsDir + '/' + SHOWN_FILE);
      }
      if (signal) { // I5: the call — AFTER the page is up; I32: it never blocks the contour
        const nWait = first.questions ? first.questions.filter((q) => !q.answered).length : 0;
        signalCall(root, callPhrase({
          batch, notice: noticeMode, face, kind: first.kind, title: first.title, nWait,
          nDocs: batch ? forOwner().length + (first.notices || 0) : 1, nQuestions: first.total || 0, nNotices: first.notices || 0,
        }, cfg), { log });
      }
      serveContour._onUp && serveContour._onUp(url); // hook for a QA run
    });
    server.listen(stalePort || 0, '127.0.0.1');
  });
}

// ── LP (2.7, origin issue #66): `--close <doc>` — the ONLY legal way to end a live owner page from outside ──────
// The field case: a neighbour session said "close that page" and an agent killed the process while the owner was
// typing into it. The command reads the lock (port · pid · title · input state) and REFUSES while the owner typed
// less than the quiet threshold ago or a draft is unsaved; `--force` needs the owner's words verbatim and logs them.
/** POST to a local contour server with a hard deadline — plain http, no AbortSignal (a native crash was once seen near it, origin bug 109). */
function postLocal(url, ms = 3000) {
  return new Promise((res) => {
    let settled = false; const end = (v) => { if (!settled) { settled = true; res(v); } };
    try {
      const rq = httpRequest(url, { method: 'POST', timeout: ms }, (r) => { r.resume(); r.on('end', () => end({ status: r.statusCode })); });
      rq.on('timeout', () => { rq.destroy(); end({ error: 'no answer within ' + ms + ' ms' }); });
      rq.on('error', (e) => end({ error: e.code || e.message }));
      rq.end();
    } catch (e) { end({ error: e.message }); }
  });
}
export async function closeContour(root, docPath, { force = false, ownerWord = null, log = console.log, now = Date.now() } = {}) {
  const cfg = cfgOf(root);
  const isQueue = docPath === '--queue';
  const key = isQueue ? '_queue' : basename(docPath);
  const rel = isQueue ? '(queue)' : relDoc(root, docPath);
  const lock = checkLock(root, key);
  if (!lock) { log('no live page for ' + rel + ' — nothing to close (no lock)'); return EXIT_DECIDED; }
  const port = (String(lock.url).match(/:(\d+)\/?$/u) || [])[1] || '?';
  log('live page: ' + lock.url + ' · port ' + port + ' · pid ' + lock.pid + ' · title "' + (lock.title || '?') + '" — compare with the window you were told about before touching it');
  if (lock.stale) { log('the process ' + lock.pid + ' is already gone; the lock is kept for the draft in that window (I29) — nothing to close'); return EXIT_DECIDED; }
  const quietMs = cfg.closeQuietMs || CLOSE_QUIET_MS_DEFAULT;
  const sinceInput = lock.lastInputAt ? now - Number(lock.lastInputAt) : null;
  // A page YOUNGER than the quiet threshold is never closed without the owner's word either: the owner may be reading
  // it, about to type — the live run of 2026-09-18 closed a page three seconds after the first keystroke because the
  // lock had not yet heard of it. Age counts from the lock's startedAt; an unreadable stamp counts as "just now".
  const startedMs = Date.parse(lock.startedAt || '') || now;
  const age = now - startedMs;
  const unsaved = Number(lock.draftFields) > 0 && !lock.saved;
  if (!force) {
    if (sinceInput !== null && sinceInput < quietMs) {
      log('last input ' + Math.round(sinceInput / 1000) + ' s ago — the owner is typing; not closed (exit ' + EXIT_NOT_CLOSED + '; the quiet threshold is ' + Math.round(quietMs / 1000) + ' s, contour.closeQuietMs)');
      return EXIT_NOT_CLOSED;
    }
    if (age < quietMs) {
      log('the page came up ' + Math.round(age / 1000) + ' s ago — younger than the quiet threshold (' + Math.round(quietMs / 1000) + ' s): the owner may be reading it; not closed (exit ' + EXIT_NOT_CLOSED + '; --force --owner-word "<quote>" if the owner said so)');
      return EXIT_NOT_CLOSED;
    }
    if (unsaved) { log('draft of ' + lock.draftFields + ' field(s) not saved — the owner\'s text would be orphaned; not closed (exit ' + EXIT_NOT_CLOSED + ')'); return EXIT_NOT_CLOSED; }
  } else {
    if (!ownerWord || !String(ownerWord).trim()) { log('refusing --force: it needs --owner-word "<the owner\'s words, verbatim>" — a neighbour session\'s word is not evidence'); return EXIT_UNKNOWN_FLAG; }
    log('FORCE close by the owner\'s word: "' + ownerWord + '"' + (sinceInput !== null && sinceInput < quietMs ? ' — last input ' + Math.round(sinceInput / 1000) + ' s ago' : '') + (unsaved ? ' — draft of ' + lock.draftFields + ' field(s) NOT saved' : ''));
  }
  // The page's OWN server is asked to end (token from the lock): a pid read from a file may belong to another process by
  // now, and a killed process exits with a code the contract does not know. Only --force may fall back to the pid.
  const asked = await postLocal(String(lock.url).replace(/\/?$/u, '/') + 'close?t=' + encodeURIComponent(lock.closeToken || '') + (unsaved ? '&keep=1' : ''));
  let how = null;
  if (asked.status === 200) { how = 'its own server ended it (exit 2 for the waiting agent)'; if (!unsaved) rmSync(lockPath(root, key), { force: true }); } // the server removes its lock too — idempotent
  else if (!force) {
    log('the page at ' + lock.url + ' did not accept the close request (' + (asked.error || 'HTTP ' + asked.status) + ') — pid ' + lock.pid + ' was NOT killed: a pid from a file may belong to another process by now; a hung or pre-2.7 contour is ended with --force --owner-word "<quote>" (exit ' + EXIT_NOT_CLOSED + ')');
    return EXIT_NOT_CLOSED;
  } else {
    try { process.kill(lock.pid); } catch (e) { log('could not end the process ' + lock.pid + ': ' + e.message); return EXIT_NOT_CLOSED; }
    how = 'the process was killed by pid (forced; the page did not answer: ' + (asked.error || 'HTTP ' + asked.status) + ')';
    if (!unsaved) rmSync(lockPath(root, key), { force: true });
  }
  if (unsaved) log('the lock is KEPT (stale): the unsaved draft lives in that window\'s origin on port ' + port + ' — the next show reuses the port (I29) and the recovery run reads the project profile');
  log('closed ' + rel + ' (port ' + port + ', pid ' + lock.pid + ') — ' + how + '; the browser window itself is not touched: it shows the server-gone line and keeps its draft on the project profile');
  return EXIT_DECIDED;
}

// ── LP (2.7, #66): pick up an answer the owner saved on his computer while the server was gone ────────────────
// A dead process leaves a STALE lock with the window's port; the page wrote the answer into localStorage of the
// PROJECT profile. A headless run of the same browser on the same profile and the SAME port (the origin is host:port)
// reads it back and posts it here; the agent records it as the owner's decision and says so. Runs only when the
// project profile exists (a window once ran) — a sandbox tree never has one, so no browser is ever launched there.
// 2.9, epic CP: ONE browser list — the origin's test tools import it from here (they kept two copies of their own). `KAIF_BROWSER`
// names the machine's browser first (a stand whose Chromium lives off the standard paths). Linux has no list — not supported (owner's
// word 2026-10-03).
export const BROWSER_EXES = [...(process.env.KAIF_BROWSER ? [process.env.KAIF_BROWSER] : []), ...(IS_WIN
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
     'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  : IS_MAC ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : [])];
export const findBrowser = () => BROWSER_EXES.find((p) => existsSync(p)) || null;
function recordRecovered(root, doc, payload, cfg) {
  const face = payload.face || 'interview';
  if (payload.read) { const r = recordDecision(root, doc, { kind: KIND_NOTICE, comment: payload.comment, recovered: true }, cfg); markNoticeRead(root, doc); return r; }
  if (face === 'proofread' || face === 'mockup') {
    const noRemarks = Boolean(payload.noRemarks) && !(payload.comment || '').trim() && Object.keys(payload.comments || {}).length === 0;
    return recordDecision(root, doc, { kind: face, comment: payload.comment, comments: payload.comments, ...(noRemarks ? { noRemarks: true } : {}), recovered: true }, cfg);
  }
  // OW6 (2.8): an answer saved on the owner's machine for an OLDER revision of the document is NOT written into it by question numbers —
  // it is recorded as data (the decision and its archive) and named out loud by the caller
  const staleRevision = Boolean(payload.rev) && payload.rev !== docRev(root, doc);
  return recordDecision(root, doc, { answers: payload.answers, comment: payload.comment, artifacts: payload.artifacts, recovered: true,
    rev: payload.rev, ...(staleRevision ? { staleRevision: true } : {}) }, cfg);
}
function recoverOne(root, key, lock, exe, log, result) {
  const cfg = cfgOf(root);
  const doc = lock.doc;
  const port = Number((String(lock.url).match(/:(\d+)\/?$/u) || [])[1]) || 0;
  if (!doc || doc === '_queue' || !port) {
    log('recovery: lock ' + key + ' — ' + (doc === '_queue' ? 'a queue page: its draft lives under the page title, not per document — reopen the queue on the same port (I29); nothing picked up' : 'no document or port in the lock; nothing to pick up'));
    return Promise.resolve();
  }
  const DK = 'owner-review:' + doc + ':';
  const page = '<!doctype html><meta charset="utf-8"><script>' +
    'var DK=' + JSON.stringify(DK) + ';var SK=DK+"' + SUBMITTED_KEY + '";var out={submitted:null,store:null,drafts:{}};' +
    'function fin(){fetch("/done",{method:"POST"})}' +
    'function readLs(){try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.indexOf(DK)!==0)continue;var v=localStorage.getItem(k);var f=k.slice(DK.length);' +
    'if(k===SK){if(!out.submitted){try{out.submitted=JSON.parse(v);out.store="localStorage"}catch(e){}}}else if(f!=="__probe"&&v)out.drafts[f]=v}}catch(e){out.error=String(e)}}' +
    'function send(db){readLs();fetch("/recovered",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(out)}).then(function(r){return r.json()}).then(function(j){' +
    'if(!(j&&j.clear)){fin();return}' +
    'try{var ks=[];for(var i=0;i<localStorage.length;i++)ks.push(localStorage.key(i));for(var k=0;k<ks.length;k++)if(ks[k].indexOf(DK)===0)localStorage.removeItem(ks[k])}catch(e){}' +
    'if(!db){fin();return}try{var tx=db.transaction("kv","readwrite");tx.objectStore("kv").delete(SK);tx.oncomplete=fin;tx.onerror=fin;tx.onabort=fin}catch(e){fin()}}).catch(function(){})}' +
    'try{var r=indexedDB.open("kaif-contour",1);r.onupgradeneeded=function(){r.result.createObjectStore("kv")};' +
    'r.onsuccess=function(){var db=r.result;try{var g=db.transaction("kv").objectStore("kv").get(SK);' +
    'g.onsuccess=function(){if(g.result){try{out.submitted=JSON.parse(g.result);out.store="indexedDB"}catch(e){}}send(db)};g.onerror=function(){send(db)}}catch(e){send(db)}};' +
    'r.onerror=function(){send(null)}}catch(e){send(null)}</script>';
  let got = null, child = null, timer = null, recorded = null;
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const ok = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/recover') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
      if (req.method === 'POST' && req.url === '/recovered') {
        let body = ''; req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { got = JSON.parse(body); } catch { got = { error: 'unreadable' }; }
          let clear = false;
          if (got && got.submitted) {
            try { recorded = recordRecovered(root, doc, got.submitted, cfg); clear = true; } catch (e) { log('recovery: could not record ' + doc + ': ' + e.message); }
          }
          ok({ ok: true, clear });
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/done') { ok({ ok: true }); setTimeout(finish, got && got.submitted ? FLUSH_GRACE_MS : 200); return; } // the clear must reach the disk before the kill
      res.writeHead(404); res.end();
    });
    const finish = () => {
      clearTimeout(timer);
      if (child) { // taskkill by ABSOLUTE path: a quiet (empty-PATH) environment still ends the browser tree
        try {
          const tk = IS_WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe') : null;
          if (tk && existsSync(tk)) spawnSync(tk, ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); else child.kill();
        } catch { /* already gone */ }
        child = null;
      }
      if (server.closeAllConnections) server.closeAllConnections(); // the port must be FREE before the show that follows reuses it (I29) — a lingering keep-alive socket would orphan the draft's origin
      server.close(() => done());
      setTimeout(done, 5000).unref(); // a fallback only: `done` of a settled promise is a no-op
    };
    server.on('error', (e) => { log('recovery: port ' + port + ' of the dead window is taken (' + e.code + ') — the local save keeps its origin and cannot be read on another port; nothing picked up for ' + doc); done(); });
    server.listen(port, '127.0.0.1', () => {
      child = spawn(exe, ['--headless=new', ...profileArgs(root), '--disable-gpu', 'http://127.0.0.1:' + port + '/recover'], { stdio: 'ignore' });
      child.on('error', (e) => { log('recovery: could not start the headless browser ' + exe + ': ' + e.message); finish(); });
      timer = setTimeout(() => { log('recovery: the headless browser did not answer within ' + (RECOVER_TIMEOUT_MS / 1000) + ' s — nothing picked up for ' + doc); finish(); }, RECOVER_TIMEOUT_MS);
    });
  }).then(() => {
    const nDrafts = got && got.drafts ? Object.keys(got.drafts).length : 0;
    if (recorded) {
      const n = Object.keys(recorded.answers || {}).length;
      log('answer recovered from the owner\'s machine: ' + doc + ' — ' + (recorded.kind === KIND_NOTICE ? 'read mark' : n + ' answer(s)' + (recorded.comment ? ' + comment' : '')) + ' → recorded (by ' + recorded.by + '; from ' + (got.store || '?') + '; decision.json · archive · the document) — the lock is released. TELL THE OWNER in your next message that his answer was picked up from his computer (I47): the provenance comment in the document is invisible on a rendered page');
      rmSync(lockPath(root, key), { force: true });
      result.recovered.push({ doc, record: recorded });
    } else if (nDrafts > 0) {
      log('draft found on the owner\'s machine: ' + doc + ' — ' + nDrafts + ' field(s), NOT saved; the page restores it when reopened on port ' + port + ' (I29) — nothing recorded, the lock is kept');
      result.drafts.push({ doc, fields: nDrafts });
    } else if (got) {
      log('recovery: nothing saved on the owner\'s machine for ' + doc + (got.error ? ' (' + got.error + ')' : '') + ' — the lock is released');
      rmSync(lockPath(root, key), { force: true });
    }
  });
}
/** Is a browser running on the project profile right now? Windows Chromium keeps `lockfile` open with no sharing; on macOS `SingletonLock` marks it (not verified — said in the returned reason). */
function profileHeld(root) {
  const d = profileDir(root);
  if (IS_WIN) {
    const lf = join(d, 'lockfile');
    if (!existsSync(lf)) return null;
    try { closeSync(openSync(lf, 'r+')); return null; } catch (e) { return 'lockfile busy: ' + e.code; } // opens → a leftover of a dead browser
  }
  try { lstatSync(join(d, 'SingletonLock')); return 'SingletonLock present (platform not verified)'; } catch { return null; }
}
export function recoverFromWindow(root, { log = console.log } = {}) {
  const result = { recovered: [], drafts: [] };
  if (!existsSync(profileDir(root))) return Promise.resolve(result); // no window ever ran on the project profile — nothing to pick up, no browser launched
  const dir = decisionsAbs(root);
  const locks = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.lock')).map((f) => ({ key: f.replace(/\.lock$/u, ''), lock: checkLock(root, f.replace(/\.lock$/u, '')) })).filter((x) => x.lock && x.lock.stale)
    : [];
  if (!locks.length) return Promise.resolve(result);
  const heldBy = profileHeld(root);
  if (heldBy) { log('recovery deferred: a browser still holds the project profile (' + heldBy + ') — the owner\'s window is open; a second browser on a held profile would hand its page to THAT window. The answer stays where it is and is picked up after the window closes (' + locks.length + ' stale lock(s) kept)'); return Promise.resolve(result); }
  const exe = findBrowser();
  if (!exe) { log('recovery: ' + locks.length + ' stale lock(s), but no Chromium at a known path — an answer saved on this computer stays in ' + WINDOW_PROFILE_DIR + ' until a browser is found'); return Promise.resolve(result); }
  return locks.reduce((chain, { key, lock }) => chain.then(() => recoverOne(root, key, lock, exe, log, result)), Promise.resolve()).then(() => result);
}

// ── Pre-flight + self-check as one gate (spec §2), used by the CLI before any page opens ───────
/** Returns null when the document may open, else the lines to print before exit 3. */
export function gateForOpen(root, docPath) {
  const md = readFileSync(resolve(root, docPath), 'utf8');
  const problems = preflight(md);
  if (problems.length) return ['PRE-FLIGHT REFUSED TO OPEN (spec §2, exit 3):', ...problems.map((p) => '  ' + p)];
  const meta = parseMetaBlock(md);
  if (parseQuestions(md).length === 0 && !(meta && meta.artifacts && meta.artifacts.length)) return null; // notice class, no radios owed
  const page = buildPage(root, docPath);
  const sc = selfCheck(page);
  if (!sc.ok) return ['PAGE SELF-CHECK FAILED (spec §2, exit 3): radio groups ' + sc.groups + ' for ' + sc.expected + ' question(s) with options'
    + (sc.fabOk ? '' : '; the Save control is not a floating top-right button (a bottom bar is forbidden — spec §4, origin issue #60)')
    + (sc.labelsOk ? '' : '; an option label carries raw markdown (**)') + ' — a broken page is never shown silently.'];
  return null;
}

// ── QL1 (2.7, origin issue #56 — EXP-0123): `--check <doc>` — the form check WITHOUT a page. The field's only
// check of a document was the show (`--no-open` still SERVES and CALLS), and the origin itself called its
// owner by voice at midnight to an answered interview while "checking". This door parses, runs the pre-flight
// and the render self-check, prints what was recognised and what was not, and exits 3/0 — no server, no sound,
// no call, no `shown.json`. One parse (`checkForm`) serves both this door and the warning printed at a real show.
export function checkDoc(root, docPath, log = console.log) {
  const cfg = cfgOf(root), t = T(cfg);
  const rel = relDoc(root, docPath);
  const md = readFileSync(resolve(root, docPath), 'utf8');
  const cf = checkForm(md);
  log(t.check.summary(rel, cf.blocks, cf.recognised));
  if (cf.unrecognised.length) { log(t.check.unrecognised(cf.unrecognised.length)); for (const u of cf.unrecognised) log(t.check.line(u.line, u.text)); }
  const nAns = cf.questions.filter((q) => q.answered).length;
  log(t.check.counts(cf.questions.length - nAns, nAns));
  // AQ (2.7, origin issue #70): the archaeology axis speaks in BOTH directions — how many live
  // questions carry their attestation, or why the document is not judged at all.
  const arch = cf.archaeology;
  if (cf.questions.length) log(arch.judged
    ? t.check.archaeology(arch.attested, arch.live, arch.exempt)
    : t.check.archaeologyOld(arch.headerDate, arch.since));
  const gate = gateForOpen(root, docPath); // pre-flight + render self-check — the same gate the show runs
  if (gate) for (const l of gate) log(l);
  if (gate || cf.unrecognised.length) { log(t.check.refused); return EXIT_PREFLIGHT; }
  log(t.check.ok);
  return EXIT_DECIDED;
}

// ── Selftest (no browser): pre-flight red on the "options as paragraphs" fixture, green on the
// canonical forms; the three faces render; records land in three places; the fact of showing ────
export async function selftest(log = console.log) {
  let n = 0, bad = 0;
  const ok = (cond, name) => { n++; if (!cond) { bad++; log('  x ' + name); } else log('  v ' + name); };
  // CP (2.9, #128 comment 2): the waiter's line names the whole decision — a choice no longer hides the owner's text and comments
  const words = decisionWords({ answers: { Q1: { choice: 'A' }, Q2: { choice: 'B', text: 'take B,\n  but later', comment: 'the radio does not clear' }, Q3: { text: 'free' } }, comment: 'bug on the page' });
  ok(words === 'Q1 = A, Q2 = B + text «take B, but later» + comment «the radio does not clear», Q3 = text «free», document comment «bug on the page»',
    'CP #128: the waiter\'s line names choice · text · comment · document comment (a choice alone stays "Q1 = A")');
  // CP (2.9, #123): a hard-wrapped paragraph, list item and quote render as ONE block each; bold across the wrap is bold, not raw "**"
  ok(renderMd('a **b\nc** d') === '<p>a <strong>b\nc</strong> d</p>' && !renderMd('- **A)** text **bold across\n  the wrap** end').includes('**')
    && renderMd('> one\n> two') === '<blockquote>\n<p>one\ntwo</p>\n</blockquote>' && renderMd('**P (rename kaif-*) → W**') === '<p><strong>P (rename kaif-*) → W</strong></p>'
    && renderInline('B — one file, **no cuts**') === 'B — one file, <strong>no cuts</strong>',
    'CP #123: paragraph, list item and quote are joined before inline markup; a single star inside bold is text; the owner\'s answer keeps its markup');
  // CP (2.9, #123 · #127 p. 5): the owner's answer is its whole paragraph; an HTML comment under an empty label is not an answer
  const aDoc = (ans) => '# Interview #001\n\n> Status: awaiting\n\n### Q1. Pick?\n\n- **A)** one\n- **B)** two\n\n' + ans + '\n';
  const wrapped = parseQuestions(aDoc('**Answer:** B) — take it, on one condition: first\nthe order of steps.'))[0];
  const commented = parseQuestions(aDoc('**Answer:**\n<!-- write here -->'))[0];
  ok(wrapped.answers[0].text === 'B) — take it, on one condition: first\nthe order of steps.' && commented.answered === false,
    'CP #123/#127: a wrapped answer is read whole; a comment under an empty label leaves the question LIVE');
  { // CP (2.9, #124): the third axis of the door — a live question sends the owner nowhere for its own content
    const rDoc = (date, stem, ans = '') => '# Interview #001\n\n> **Created:** ' + date + '\n> **Status:** awaiting\n\n### Q1. Which formula do we take?\n\n' + stem
      + '\n\n<!-- archaeology: n/a — selftest -->\n\n- **A)** one\n- **B)** two\n\n**Answer:**' + ans + '\n';
    const n = (date, stem, ans) => preflight(rDoc(date, stem, ans)).filter((p) => /OUTSIDE itself|ref-ok/.test(p)).length;
    ok(n(REFERENCES_SINCE, 'The formula — see above.') === 1 && n(REFERENCES_SINCE, '\u0424\u043e\u0440\u043c\u0443\u043b\u0430 — \u0441\u043c. \u0432\u044b\u0448\u0435.') === 1 && n(REFERENCES_SINCE, 'As §3 says.') === 1
      && n(REFERENCES_SINCE, '\u0424\u043e\u0440\u043c\u0443\u043b\u0430 — \u0441\u043c. \u0432\u044b\u0448\u0435. <!-- ref-ok: -->') === 1,
      'CP #124: «see above» · «\u0441\u043c. \u0432\u044b\u0448\u0435» · «§3» in a live question refuse the door; a ref-ok marker without a reason refuses too');
    ok(n(REFERENCES_SINCE, 'The formula — see above. <!-- ref-ok: the formula is quoted in full below -->') === 0 && n(REFERENCES_SINCE, '\u0412\u0430\u0440\u0438\u0430\u043d\u0442\u044b — \u0441\u043c. \u043d\u0438\u0436\u0435.') === 0
      && n(REFERENCES_SINCE, 'The formula — see above.', ' A') === 0 && n('2026-09-20', 'The formula — see above.') === 0
      && n(REFERENCES_SINCE, '**Answer target:** plans/24 §B8') === 0,
      'CP #124: a reasoned ref-ok, a forward «\u0441\u043c. \u043d\u0438\u0436\u0435», an answered question, a document older than the axis and the addressee line stay silent');
    ok(n(REFERENCES_SINCE, '\u041d\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0432\u044b\u0448\u0435 80% \u2014 \u0431\u0435\u0440\u0451\u043c B.') === 0 && n(REFERENCES_SINCE, 'B \u0432\u044b\u0448\u0435, \u0447\u0435\u043c A, \u043f\u043e \u0446\u0435\u043d\u0435.') === 0 && n(REFERENCES_SINCE, 'Load above 80% takes B.') === 0 && n(REFERENCES_SINCE, '\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u2014 \u0441\u043c. \u0442\u0430\u0431\u043b\u0438\u0446\u0443 \u043d\u0438\u0436\u0435.') === 0 && n(REFERENCES_SINCE, '\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u0446\u0435\u043b\u0438\u043a\u043e\u043c: x = 2y; \u0441\u043c. \u0442\u0430\u043a\u0436\u0435 plans/12.') === 0
      && n(REFERENCES_SINCE, '\u041a\u0430\u043a \u0443\u043a\u0430\u0437\u0430\u043d\u043e \u0432\u044b\u0448\u0435, \u0431\u0435\u0440\u0451\u043c B.') === 1 && n(REFERENCES_SINCE, 'As listed above, B wins.') === 1,
      'CP F3 (light judge): a comparison ("load above 80%", "B is higher than A"), a forward "see the table below" and a "see also" next to the content stay silent; "as listed above" still refuses');
    ok(['\u0422\u0430\u043a \u043a\u0430\u043a \u043d\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0432\u044b\u0448\u0435 80%, \u0431\u0435\u0440\u0451\u043c B.', '\u0423\u043a\u0430\u0437\u0430\u043d\u043d\u0430\u044f \u043d\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0432\u044b\u0448\u0435 80%.', 'As load goes above 80%, B wins.', '\u0426\u0435\u043d\u0430 \u0432\u044b\u0448\u0435 \u043d\u0430 5% \u2014 \u0431\u0435\u0440\u0451\u043c B.'].every((s) => n(REFERENCES_SINCE, s) === 0)
      && ['\u0411\u0435\u0440\u0451\u043c \u0444\u043e\u0440\u043c\u0443\u043b\u0443 \u0432\u044b\u0448\u0435?', '\u0412\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u0432 \u0442\u0430\u0431\u043b\u0438\u0446\u0435 \u0432\u044b\u0448\u0435.', 'Pick from the list above.', 'The above decides.'].every((s) => n(REFERENCES_SINCE, s) === 1),
      'CP N2 (light re-judge): "above" is a comparison only before a number or "than" (through "as" or a participle too); a noun form ("the formula above", "the list above") refuses');
  }
  { // CP (2.9, #109 · #121 R3): an explicit closing word at the start of the status closes the document, whatever the explanation after it says
    const st = (v) => docStatus('# I\n\n> **Status:** ' + v + '\n');
    ok(st('\u26d4 \u0421\u041d\u042f\u0422\u041e 2026-08-28 \u0440\u0435\u0448\u0435\u043d\u0438\u0435\u043c \u2116058') === 'closed' && st('\u043f\u0435\u0440\u0435\u043d\u0435\u0441\u0435\u043d\u043e \u0432 2.10') === 'closed'
      && st('\u2705 **\u0417\u0410\u041a\u0420\u042b\u0422\u041e 2026-08-30 — \u0412\u041e\u041f\u0420\u041e\u0421 \u0421\u041d\u042f\u0422 \u0410\u0413\u0415\u041d\u0422\u041e\u041c, \u0410 \u041d\u0415 \u041e\u0422\u0412\u0415\u0427\u0415\u041d \u0412\u041b\u0410\u0414\u0415\u041b\u042c\u0426\u0415\u041c.**') === 'closed' && st('\u26d4 WITHDRAWN 2026-08-28') === 'closed',
      'CP #109/#121 R3: \u0421\u041d\u042f\u0422\u041e · \u043f\u0435\u0440\u0435\u043d\u0435\u0441\u0435\u043d\u043e · \u0417\u0410\u041a\u0420\u042b\u0422\u041e with a negation after it · WITHDRAWN — the document is closed, not in the owner queue');
    ok(st('\u2705 \u043e\u0442\u0432\u0435\u0442\u044b \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u044b — \u043f\u043e\u043a\u0430 \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0435\u043d\u043e \u0434\u0432\u0430') === 'waiting' && st('\u0441\u043d\u044f\u0442\u0438\u0435 \u0444\u043b\u0430\u0433\u0430 — \u0436\u0434\u0451\u0442 \u043e\u0442\u0432\u0435\u0442\u0430') === 'waiting',
      'CP #109: a negation still outranks a bare tick (bugs/70); a noun that starts like a closing word is no closing word');
    ok(st('\u0417\u0430\u043a\u0440\u044b\u0442 Q1; Q2 \u0436\u0434\u0451\u0442 \u043e\u0442\u0432\u0435\u0442\u0430') === 'waiting' && st('\u2705 \u0417\u0410\u041a\u0420\u042b\u0422\u041e \u2014 \u0412\u041e\u041f\u0420\u041e\u0421 \u0421\u041d\u042f\u0422 \u0410\u0413\u0415\u041d\u0422\u041e\u041c, \u0410 \u041d\u0415 \u041e\u0422\u0412\u0415\u0427\u0415\u041d \u0412\u041b\u0410\u0414\u0415\u041b\u042c\u0426\u0415\u041c') === 'closed',
      'CP F5 (light judge): a partial status (closed Q1; Q2 awaits an answer) waits — an explicit waiting marker outranks the closing word; a negation alone does not');
    ok(st('\u2705 \u0417\u0410\u041a\u0420\u042b\u0422\u041e \u2014 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435 \u0436\u0434\u0451\u0442 \u043e\u0442\u0432\u0435\u0442\u0430') === 'closed' && st('CLOSED — no longer awaiting the owner') === 'closed'
      && st('\u0417\u0430\u043a\u0440\u044b\u0442 Q1, Q2 \u2014 \u0435\u0449\u0451 \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0435\u043d') === 'waiting' && st('CLOSED Q1; Q2 not yet answered') === 'waiting',
      'CP F5 (light re-judge): a NEGATED waiting marker ("no longer awaiting") leaves the document closed; a not-yet mark after the closing word waits');
  }
  { // CP (2.9, #127 · ideas/31 p. 28): the list form speaks the table form's dictionary; a letter written but not parsed is named
    const q3 = (form) => '# I\n\n> **Status:** awaiting\n\n' + [1, 2, 3].map((n) => '### Q' + n + '. Pick ' + n + '?\n\n' + ['A', 'B', 'C', 'D'].map((l) => '- **' + form(l) + '** option ' + l).join('\n') + '\n\n**Answer:**\n').join('\n');
    const count = (md) => parseQuestions(md).reduce((n, q) => n + q.options.length, 0);
    ok(count(q3((l) => l + ':')) === 12 && count(q3((l) => l + '.')) === 12 && count(q3((l) => l + ' (\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u044e):')) === 12 && count(q3((l) => l + ')')) === 12,
      'CP #127: 3 questions × 4 options in the forms A: · A. · A (note): · A) — 12 options each');
    ok(count(q3((l) => l)) === 12 && preflight(q3((l) => l + ' ' + String.fromCharCode(0x2014))).some((p) => /letters authored 4, recognised 0/.test(p)),
      'CP #127: a bold letter alone (- **A** …) is an option like the table form | **A** |; an unknown shape (- **A —** …) is named «letters authored 4, recognised 0», never lost in silence');
    const para = (extra) => '# I\n\n> **Status:** awaiting\n\n### Q1. Pick?\n\n- **A)** one\n- **B)** two\n\n' + extra + '\n\n**Answer:**\n';
    ok(preflight(para('**C.** three')).some((p) => /letters authored 3, recognised 2/.test(p) && p.includes('**C.** three'))
      && !preflight(para('**B** costs more than A.')).some((p) => /letters authored/.test(p)),
      'CP F4 (light judge): a paragraph option «**C.** three» next to two list options is named «letters authored 3, recognised 2»; prose opening with a bold letter («**B** costs more») is not an option');
    ok(preflight(para('**C** ' + String.fromCharCode(0x2014) + ' three')).some((p) => /letters authored 3, recognised 2/.test(p)),
      'CP F4 (light re-judge): a paragraph option with the list form\'s dash («**C** — three») is named too');
    ok(parseQuestions('# I\n\n> **Status:** awaiting\n\n### Q1. Pick?\n\n**\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0438\u044f \u0430\u0433\u0435\u043d\u0442\u0430:** B\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n')[0].recommended === 'B',
      'CP ideas/31 p. 28: «**\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0438\u044f \u0430\u0433\u0435\u043d\u0442\u0430:** B» — the letter is read after the label closes its own bold');
    const ru = mkdtempSync(join(tmpdir(), 'kaif-contour-ru-'));
    mkdirSync(join(ru, '.kaif'), { recursive: true }); mkdirSync(join(ru, 'interviews'), { recursive: true });
    writeFileSync(join(ru, '.kaif', 'kaif.json'), JSON.stringify({ framework: 'KAIF', version: '2.9', language: 'ru', projectName: '\u041f\u0440\u043e\u0431\u0430' }) + '\n');
    writeFileSync(join(ru, 'interviews', 'interview_001_ru.md'), '# \u0418\u043d\u0442\u0435\u0440\u0432\u044c\u044e #001\n\n> **\u0421\u0442\u0430\u0442\u0443\u0441:** \u2705 \u041e\u0422\u0412\u0415\u0427\u0415\u041d\u041e\n\n### Q1. \u0411\u0435\u0440\u0451\u043c?\n\n- **A)** \u0434\u0430\n- **B)** \u043d\u0435\u0442\n\n**\u041e\u0442\u0432\u0435\u0442:** A\n\n\u2705 \u0412\u043d\u0435\u0441\u0435\u043d\u043e: plans/12 \u0448\u0430\u0433 3 (\u043a\u043e\u043c\u043c\u0438\u0442 abc123).\n');
    recordDecision(ru, 'interviews/interview_001_ru.md', { answers: { Q1: { choice: 'B', text: '\u043f\u0435\u0440\u0435\u0434\u0443\u043c\u0430\u043b', comment: '' } } }, loadContourConfig(ru), new Date(2026, 8, 28, 10, 0));
    const ruDoc = readFileSync(join(ru, 'interviews', 'interview_001_ru.md'), 'utf8');
    rmSync(ru, { recursive: true, force: true });
    ok(ruDoc.indexOf('**\u041e\u0442\u0432\u0435\u0442 (\u0434\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435, ') > ruDoc.indexOf('\u0412\u043d\u0435\u0441\u0435\u043d\u043e:') && !ruDoc.includes('Answer (\u0434\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435'),
      'CP #127: a follow-up in a Russian document is labelled in Russian and lands BELOW the applied-mark line');
  }
  { // the legal wrapped option form (spec §1, the /interview template) passes the page self-check instead of refusing to open
    const wr = mkdtempSync(join(tmpdir(), 'kaif-contour-wrap-'));
    mkdirSync(join(wr, 'interviews'), { recursive: true });
    writeFileSync(join(wr, 'interviews', 'interview_001_wrap.md'), '# Interview #001\n\n> Status: awaiting\n\n### Q1. Which?\n\n- **A) (recommended)** **Title that wraps\n  onto the next line.**\n- **B)** The other one.\n\n**Answer:**\n');
    const refused = gateForOpen(wr, 'interviews/interview_001_wrap.md');
    rmSync(wr, { recursive: true, force: true });
    ok(refused === null, 'CP #123: a wrapped option label opens — the page self-check no longer refuses it for raw ** (' + (refused || []).join(' ').slice(0, 80) + ')');
  }
  const root = mkdtempSync(join(tmpdir(), 'kaif-contour-'));
  mkdirSync(join(root, '.kaif'), { recursive: true });
  mkdirSync(join(root, 'interviews'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  // parameters are READ (#97): language + project name from the marker, owner from the identity table
  writeFileSync(join(root, '.kaif', 'kaif.json'), JSON.stringify({ framework: 'KAIF', version: '2.6', language: 'en', projectName: 'Probe Project' }) + '\n');
  writeFileSync(join(root, 'AGENT_GUIDE.md'), '# Guide\n\n| Field | Value |\n|---|---|\n| **Author / owner** | Jane Owner aka **JO** · second form |\n');
  const cfg = cfgOf(root);
  ok(cfg.projectName === 'Probe Project' && cfg.ownerName === 'Jane Owner aka JO' && cfg.language === 'en' && cfg.decisionsDir === 'interviews/decisions',
    'config is read, never asked: project name from kaif.json, owner from the identity table, canon decisions dir');
  ok(texts('de').fallbackFrom === 'de' && texts('ru').lang === 'ru' && texts('ru').btn.save !== texts('en').btn.save,
    'texts: RU and EN ship, an unknown language falls back to EN and says so');

  // C3: four faces — one hash
  const base = 'Line one\nLine two\n';
  const faces = ['\uFEFF' + base, base.replace(/\n/g, '\r\n'), base + '\n\n', base.replace(/\n$/, '')];
  ok(new Set(faces.map(bodyHash)).size === 1 && bodyHash('other') !== bodyHash(base), 'normalisation: four faces (BOM/CRLF/tail/no newline) — one hash');
  // I6: quiet hours across midnight
  const at = (h, m) => new Date(2026, 7, 7, h, m);
  ok(inQuietHours(at(23, 30), '23:00', '09:00') && inQuietHours(at(3, 0), '23:00', '09:00') && !inQuietHours(at(12, 0), '23:00', '09:00'),
    'quiet hours: 23:30 and 03:00 inside 23:00–09:00, noon outside');
  ok(!inQuietHours(at(3, 0), null, null), 'quiet hours: no window — never quiet');

  // C4: parsing rules
  const fx = '# Interview #099\n\n> Status: awaiting\n\n### Q1. Which?\n\n- **A) (Recommended)** first line\n  second line of the option\n- **B)** short\n\n**Answer:**\n\n---\ntail after the rule\n\n### Q2. Second?\n\n**Counter-question:** why?\n\n**Answer:** A\n';
  const qs = parseQuestions(fx);
  ok(qs.length === 2 && qs[0].options.length === 2 && qs[0].options[0].text.includes('second line'), 'parse: two questions, a multi-line option (rule 3)');
  ok(!qs[0].answered && qs[1].answered && qs[1].answers.length === 1, 'parse: empty Answer is open, the rule closed the block, a counter-question is not an answer (rules 1–2)');
  ok(parseQuestions(fx.replace('awaiting', 'ANSWERS RECEIVED'))[0].answered, 'parse: a closed status closes an empty question too (rule 4)');
  ok(!parseQuestions('# I\n\n> Status: awaiting\n\n### Q1. Q?\n\n**Answer:**\n\n**Owner\'s comment (today):** a thought, not an answer\n')[0].answered,
    'parse: an owner comment under an empty Answer is NOT the answer');
  const fxTable = '# I\n\n> Status: awaiting\n\n### Q1. Q?\n\n| Option | Meaning | Price |\n|---|---|---|\n| **A (Recommended)** | note inside bold | a |\n| **B** (note) | note after bold | b |\n| **C** | bare letter | c |\n\n**Answer:**\n';
  ok(parseQuestions(fxTable)[0].options.map((o) => o.letter).join('') === 'ABC', 'parse: table rows are options, notes in brackets on either side of the bold');
  ok(parseQuestions('# I\n\n### Q1. Q?\n\n| System | State |\n|---|---|\n| **Antigravity** | alive |\n| **Basis** | alive |\n\n**Answer:**\n')[0].options.length === 0,
    'parse: a data table with bold words is NOT a fork');
  ok(docStatus('> Status: not answered yet') !== 'closed' && docStatus('> Status: no ANSWERS RECEIVED yet') !== 'closed' && docStatus('> Status: DONE, ANSWERS RECEIVED') === 'closed',
    'status: a negation outranks the tick; markup, not a bare word');
  ok(docStatus('# I\n\n### Q1. Q?\n') === 'none', 'status: no status line — the document is LIVE by default');
  const html = renderMd('# Title <b>\n\ntext <!-- secret --> on\n\n```\ninside <!-- content -->\n```\n');
  ok(html.includes('&lt;b&gt;') && !html.includes('secret') && html.includes('inside &lt;!-- content --&gt;'), 'render: escaping first, comments cut outside code and kept inside (I24)');

  // spec §2: PRE-FLIGHT — the #51 fixture "options as paragraphs" is RED (exit 3 in the CLI)
  const BAD = 'interviews/interview_051_paragraphs.md';
  writeFileSync(join(root, BAD), '# Interview #051 — the field defect\n\n> Status: awaiting the owner\n\n### Q1. Which one?\n\n**A. First option** — typed as a paragraph, not a list item.\n\n**B. Second option** — also a paragraph.\n\n**Answer:**\n');
  const pre = preflight(readFileSync(join(root, BAD), 'utf8'));
  // light judge of epic CP, F4: the paragraph letters are named too — two lines of the door, the letters it saw and the fix form
  ok(pre.length === 2 && pre.some((p) => /^Q1: letters authored 2, recognised 0/.test(p) && p.includes('**A. First option**')) && pre.some((p) => /^Q1: 0 option/.test(p) && p.includes('- **A)**')),
    'pre-flight is RED on the "options as paragraphs" fixture (#051): Q1 named, the paragraph letters named, the fix form printed (exit 3)');
  writeFileSync(join(root, 'interviews', 'interview_990_title.md'), '# I\n\n> **Status:** awaiting\n\n### Q1. Take **B** or `C`?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
  const titled = buildPage(root, 'interviews/interview_990_title.md').html;
  rmSync(join(root, 'interviews', 'interview_990_title.md'), { force: true });
  ok(titled.includes('<strong>Q1.</strong> Take <strong>B</strong> or <code>C</code>? <span class="tag'),
    'CP F6 (light judge): a question title carries the owner\'s markup rendered — no raw ** or backticks on the card');
  const gate = gateForOpen(root, BAD);
  ok(Array.isArray(gate) && gate[0].includes('exit 3'), 'the open gate refuses the #051 fixture before any page');
  const GOOD = 'interviews/interview_052_canonical.md';
  writeFileSync(join(root, GOOD), '# Interview #052 — canonical\n\n> Status: awaiting the owner\n\n### Q1. Which one?\n\nAgent\'s recommendation: B\n\n- **A)** first\n- **B)** second\n- **C)** your own answer\n\n**Answer:**\n\n### Q2. Name it?\n\n<!-- questions-guard:no-scenario naming question, taste -->\n\n**Answer:**\n');
  ok(preflight(readFileSync(join(root, GOOD), 'utf8')).length === 0, 'pre-flight is GREEN on list options and on a declared free field');
  ok(preflight(fxTable).length === 0, 'pre-flight is GREEN on table options');
  ok(preflight(fx.replace('awaiting', 'ANSWERS RECEIVED').replace(/- \*\*[AB]\)[^\n]*\n(  [^\n]*\n)?/g, '')).length === 0, 'pre-flight exempts answered questions (closed document)');

  // the interview page: a radio per option, the recommended chip, header static, self-check green
  const page = buildPage(root, GOOD);
  ok(radioGroupsOf(page.html) === 1 && (page.html.match(/type="radio"/g) || []).length === 3, 'interview page: one radio group of three for Q1, none for the free-field Q2');
  ok(selfCheck(page).ok && gateForOpen(root, GOOD) === null, 'self-check: radio groups == questions with options → the gate opens');
  // QL1 (#56): --check — the form door without a page: candidates vs recognised, exit 3/0, no show, no call, no shown.json
  const fxCheck = '# Interview #098\n\n> Status: awaiting\n\n### Q1. Which?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n\n### 2. And what about this one?\n\nprose\n\n### Question 3\n\nmore prose\n\n## 4. Context\n\nnot a question\n';
  const cf = checkForm(fxCheck);
  ok(cf.blocks === 3 && cf.recognised.join() === 'Q1' && cf.unrecognised.length === 2 && cf.unrecognised[0].line === 12 && cf.unrecognised[1].line === 16,
    'checkForm: Q1 recognised; a numbered heading ending with ? and a `Question 3` heading are unrecognised candidates; `## 4. Context` is not one');
  // A-F1 (court of 2.7): the #56 document lettered its questions — a letter heading ending with `?` is a candidate
  // (Latin and Cyrillic), a letter chapter without `?` is not (field interviews use `## A.` for chapters).
  const cfLetters = checkForm('# Interview #099\n\n> Status: awaiting\n\n### Q1. Which?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n\n## B. Which one comes first?\n\nprose\n\n## \u04101. \u041A\u0430\u043A\u043E\u0439 \u043F\u0435\u0440\u0432\u044B\u0439?\n\nprose\n\n## C. Context\n\nnot a question\n');
  ok(cfLetters.blocks === 3 && cfLetters.recognised.join() === 'Q1' && cfLetters.unrecognised.length === 2 && cfLetters.unrecognised[0].line === 12 && cfLetters.unrecognised[1].line === 16,
    `checkForm: lettered headings ending with ? (Latin and Cyrillic) are unrecognised candidates; \`## C. Context\` is not one (got blocks ${cfLetters.blocks}, unrecognised ${cfLetters.unrecognised.map((u) => u.line)})`);
  const CHK = 'interviews/interview_098_check.md';
  writeFileSync(join(root, CHK), fxCheck);
  const lines = []; const cap = (l) => lines.push(String(l));
  const codeUnrec = checkDoc(root, CHK, cap);
  ok(codeUnrec === 3 && lines.some((l) => /blocks 3, recognised 1: Q1/.test(l)) && lines.some((l) => /line 12/.test(l)) && lines.some((l) => /REFUSED/.test(l)),
    '--check: partial recognition → exit 3, names the unrecognised lines (the #56 class)');
  lines.length = 0;
  ok(checkDoc(root, BAD, cap) === 3 && lines.some((l) => /PRE-FLIGHT REFUSED/.test(l)), '--check: the options-as-paragraphs fixture → exit 3 with the pre-flight refusal');
  lines.length = 0;
  ok(checkDoc(root, GOOD, cap) === 0 && lines.some((l) => /check OK/.test(l)) && !lines.some((l) => /Page is up|CALL:|Shown recorded/.test(l)),
    '--check: the canonical document → exit 0, "check OK", and no line of a show or a call');
  ok(!existsSync(join(root, 'interviews', 'decisions', 'shown.json')), '--check never records a showing (shown.json absent)');
  const partialPage = buildPage(root, CHK);
  ok(partialPage.html.includes('not recognised: 2 question-like block(s)'), 'the page header says out loud that 2 question-like blocks are not on it');
  rmSync(join(root, CHK), { force: true }); // the fixture must not join the queue counted by the batch cases below
  // AQ (2.7, origin issue #70): the SECOND axis of the same door — the archaeology of a live question.
  // Both answers of every rule: red without the attestation (and the READY command printed), green with
  // it; red on hits-without-prior, green on `prior: unrelated`; silent on an answered question, on a
  // declared n/a and on a document whose header date is before the threshold (it says which).
  const AQD = 'interviews/interview_099_archaeology.md';
  const aqHead = (date) => '# Interview #099\n\n> Status: awaiting\n> Created: ' + date + '\n\n';
  const aqQ = (attestation, answer) => '### Q1. What do we name the game currency?\n\n' + attestation
    + '| Option | Meaning |\n|---|---|\n| **A** | crystals |\n| **B** | coins |\n\n**Answer:**' + (answer || '') + '\n';
  // the printed command carries the UTF-8 locale since 2.8 (OW5, #74: Git Bash's grep -i missed a capital Cyrillic letter without it)
  const AQ_CMD = 'LC_ALL=C.UTF-8 grep -rniE "name|game|curren" ' + ARCHAEOLOGY_PATHS; // 6+ letters are searched by their stem
  const AQ_OK = '<!-- archaeology: ' + AQ_CMD + ' → 0 hits · read: none · prior: none -->\n\n';
  const aqCheck = (body) => { writeFileSync(join(root, AQD), body); lines.length = 0; return checkDoc(root, AQD, cap); };
  ok(aqCheck(aqHead('2026-09-18') + aqQ('')) === 3 && lines.some((l) => /Q1: no archaeology line/.test(l)) && lines.some((l) => l.includes(AQ_CMD)),
    'archaeology: a live question of a document dated on the threshold without the attestation → exit 3, and the door prints the READY grep of the heading nouns');
  ok(aqCheck(aqHead('2026-09-18') + aqQ(AQ_OK)) === 0 && lines.some((l) => /archaeology: 1 of 1 live question/.test(l)),
    'archaeology: the attestation with 0 hits and `prior: none` → exit 0, and --check says 1 of 1 attested (N = 0 is honest, the axis never promises a find)');
  // the hits are READ in both fixtures below (since 2.8 OW5 `read: none` with hits is refused first) — each case guards its own rule
  const AQ_READ = (s) => s.replace('read: none', 'read: plans/03_shop.md');
  ok(aqCheck(aqHead('2026-09-18') + aqQ(AQ_READ(AQ_OK.replace('0 hits', '3 hits')))) === 3 && lines.some((l) => /3 hits and `prior: none`/.test(l)),
    'archaeology: hits found and no prior answer named → exit 3 (the #70 class: the owner had answered it already)');
  ok(aqCheck(aqHead('2026-09-18') + aqQ(AQ_READ(AQ_OK.replace('0 hits', '3 hits').replace('prior: none', 'prior: unrelated — the hits are about the shop layout')))) === 0,
    'archaeology: `prior: unrelated — <why>` is a legal answer to hits');
  ok(aqCheck(aqHead('2026-09-18') + aqQ('<!-- archaeology: searched a bit -->\n\n')) === 3 && lines.some((l) => /not in the form/.test(l)),
    'archaeology: an attestation without `N hits` and `prior:` is NOT an attestation → exit 3 (fail-closed, never a silent pass)');
  ok(aqCheck(aqHead('2026-09-18') + aqQ('<!-- archaeology: n/a — a naming question, the taste class -->\n\n')) === 0,
    'archaeology: the declared exception `n/a — <reason>` → exit 0');
  ok(aqCheck(aqHead('2026-09-18') + aqQ('', ' A) crystals')) === 0,
    'archaeology: an ANSWERED question is out of the axis (nothing is owed to the owner any more)');
  ok(aqCheck(aqHead('2026-09-01') + aqQ('')) === 0 && lines.some((l) => /not judged/.test(l) && /2026-09-01/.test(l)),
    'archaeology: a document dated before the threshold → exit 0, and the door says out loud it was NOT judged and why');
  ok(headerDate('# I\n\n> Status: answered 2026-09-18 10:00\n> Created: 2026-09-13 09:47\n') === '2026-09-13',
    'archaeology: the header date is the CREATION line — an answer date standing above it never ages an old document forward');
  rmSync(join(root, AQD), { force: true });
  // OW5 (2.8, origin issues #74 · #82): the door SEARCHES itself — a CAPITAL Cyrillic word is found with no shell and no locale (Git
  // Bash's grep -i without the UTF-8 locale missed it); `N hits · read: none` is refused — the search found something and nothing was
  // read. The fixtures are escaped: the payload source stays ASCII (build guard), the strings are Cyrillic at run time.
  const OW5_PRIOR = 'interviews/interview_006_prior.md';
  writeFileSync(join(root, OW5_PRIOR), '# Interview #006\n\n> Status: answered\n\n### Q1. \u0412\u0418\u0422\u0420\u0418\u041d\u0410 \u2014 \u043a\u0430\u043a\u043e\u0439 \u043f\u0435\u0440\u0432\u044b\u0439 \u044d\u043a\u0440\u0430\u043d?\n\n**Answer:** A\n');
  const ow5 = archaeologySearch(root, archaeologyWords('\u0412\u0438\u0442\u0440\u0438\u043d\u0430 \u0438\u043b\u0438 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0438\u0439?'));
  ok(ow5.files.some((f) => f.endsWith('interview_006_prior.md')) && ow5.hits >= 1,
    'archaeology search: the door\'s own search finds a CAPITAL Cyrillic word — no shell, no locale decides (OW5, #74)');
  ok(aqCheck(aqHead('2026-09-20') + aqQ(AQ_OK.replace('0 hits', '2 hits').replace('prior: none', 'prior: unrelated — a different screen'))) === 3
    && lines.some((l) => /2 hits and `read: none`/.test(l)),
    'archaeology: `N hits · read: none` → exit 3 even with a legal `prior: unrelated` — the search found something and nothing was read (OW5, #74)');
  ok(aqCheck(aqHead('2026-09-20') + aqQ(AQ_OK.replace('0 hits', '2 hits').replace('read: none', 'read: ' + OW5_PRIOR)
    .replace('prior: none', 'prior: unrelated — a different screen'))) === 0,
    'archaeology: hits with the file READ and `prior: unrelated — <why>` → exit 0 (the door refuses the unread find, never the find)');
  // judge OW10 H3: the ready line `--search` prints, pasted UNFILLED (its <…> placeholders) — refused, never «attested»
  ok(aqCheck(aqHead('2026-09-20') + aqQ('<!-- archaeology: search "name|game|curren" → 2 hits · read: <what you read | none> · prior: <none | "<prior answer>" + address | unrelated — why> -->\n\n')) === 3
    && lines.some((l) => /template's <…> placeholders/.test(l)),
    'archaeology: the search\'s ready attestation pasted UNFILLED (<…> placeholders) → exit 3 — an unfilled line attests nothing (judge OW10 H3)');
  rmSync(join(root, OW5_PRIOR), { force: true }); rmSync(join(root, AQD), { force: true });
  // I44/I45 (QL2, #54): the fourth fact — implemented; the queue and the show refuse what is already implemented
  const IMPL = 'interviews/interview_097_impl.md';
  writeFileSync(join(root, IMPL), '# Interview #097\n\n> Status: awaiting\n\n### Q1. Which?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
  ok(ownerDocs(root).some((d) => d.doc === IMPL) && listQueue(root).implGate.length === 0, 'an open question is owed to the owner before the implemented mark');
  recordImplemented(root, IMPL, 'Q1', 'commit abc123');
  const implMap = JSON.parse(stripBom(readFileSync(join(root, 'interviews', 'decisions', 'implemented.json'), 'utf8')));
  ok(implMap[IMPL] && implMap[IMPL].Q1.where === 'commit abc123' && /^\d{4}-/.test(implMap[IMPL].Q1.at), 'implemented.json carries the fact with its address and its moment (I44)');
  const lq = listQueue(root);
  ok(!ownerDocs(root).some((d) => d.doc === IMPL) && lq.exitCode === 2 && lq.lines.some((l) => l.includes(IMPL) && /Q1/.test(l) && /implemented, but open/.test(l)),
    'a document whose every open question is implemented is NOT raised; the queue names it with Q1 and exits 2 (I45)');
  const implPage = buildPage(root, IMPL);
  ok(implPage.questions[0].answered && implPage.html.includes('implemented → commit abc123'), 'the page renders an implemented question as settled, with its address');
  // 2.8, epic CH (criterion 13): a question a withdrawal made moot — the same fact with withdrawn: true; the page says «withdrawn», the
  // queue does not raise it; the CLI refuses an ANSWERED question (the owner's word stays)
  {
    const WD = 'interviews/interview_096_withdrawn.md';
    writeFileSync(join(root, WD), '# Interview #096\n\n> Status: awaiting\n\n### Q1. Print the delivery line?\n\n- **A)** yes\n- **B)** no\n\n**Answer:**\n\n### Q2. Keep it?\n\n- **A)** yes\n- **B)** no\n\n**Answer:** A\n');
    const w1 = markWithdrawn(root, WD, 'Q1', 'the delivery line is withdrawn in 2.7');
    const wmap = JSON.parse(stripBom(readFileSync(join(root, 'interviews', 'decisions', 'implemented.json'), 'utf8')));
    ok(w1.code === 0 && wmap[WD] && wmap[WD].Q1.withdrawn === true && wmap[WD].Q1.why === 'the delivery line is withdrawn in 2.7' && !ownerDocs(root).some((d) => d.doc === WD),
      'a question a withdrawal made moot: --mark-withdrawn records withdrawn: true with the reason, and the queue no longer raises it (2.8, criterion 13)');
    ok(buildPage(root, WD).html.includes('withdrawn — the delivery line is withdrawn in 2.7') && !buildPage(root, WD).html.includes('implemented → withdrawn'),'the page renders a withdrawn question as «withdrawn — <reason>», never as implemented');
    const w2 = markWithdrawn(root, WD, 'Q2', 'moot');
    ok(w2.code === 1 && /ANSWERED/.test(w2.line) && !JSON.parse(stripBom(readFileSync(join(root, 'interviews', 'decisions', 'implemented.json'), 'utf8')))[WD].Q2,
      'an ANSWERED question is refused (exit 1, nothing recorded) — a withdrawal is never an answer over the owner\'s word');
    rmSync(join(root, WD), { force: true }); rmSync(join(root, 'interviews', 'decisions', 'implemented.json'), { force: true });
    // judge CH5 F2: the Russian pack carries its own form of each new text — a missing key falls back to English on an owner's page
    ok(['withdrawnBadge', 'withdrawn', 'answeredNotWithdrawn'].every((k) => String(texts('ru').impl[k]('Q1', 'x', 'y', 'z')) !== String(texts('en').impl[k]('Q1', 'x', 'y', 'z'))),
      'the Russian pack renders the three withdrawn texts in Russian (no English fallback on the owner\'s page)');
  }
  rmSync(join(root, IMPL), { force: true }); rmSync(join(root, 'interviews', 'decisions', 'implemented.json'), { force: true });
  // QL3 (#54): the reading view — live first, the settled and the text in one fold; nothing removed
  const ARCH = 'interviews/interview_096_arch.md';
  const qa = (i) => '### Q' + i + '. Settled ' + i + '?\n\n| Option | Meaning |\n|---|---|\n| **A** | one |\n| **B** | two |\n\n**Answer:** A — yes\n\n';
  writeFileSync(join(root, ARCH), '# Interview #096\n\n> Status: awaiting\n\nLong context prose.\n\n' + qa(1) + qa(2) + qa(3) + '### Q4. Live?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
  const archPage = buildPage(root, ARCH);
  const iLive = archPage.html.indexOf('<strong>Q4.</strong>'), iFold = archPage.html.indexOf('<details class="archive">'), iProse = archPage.html.indexOf('Long context prose'), iQ1 = archPage.html.indexOf('<strong>Q1.</strong>');
  ok(iLive > 0 && iFold > iLive && iProse > iFold && iQ1 > iFold && (archPage.html.match(/<section class="qcard/g) || []).length === 4 && archPage.html.includes('Archive of the settled — 3'),
    'reading view: the live question stands first, the prose and the 3 settled questions sit inside one fold below it, all 4 cards present');
  ok(selfCheck(archPage).ok, 'the render self-check counts the folded radios too (radio groups == questions with options)');
  const plainPage = buildPage(root, GOOD);
  ok(!plainPage.html.includes('<details class="archive">'), 'a document with nothing settled keeps the plain order (no fold)');
  // QL4 (#60): the Save control is a floating top-right button; the self-check reddens on a bottom bar and on raw markdown in a label
  ok(/\.fab \{[^}]*position:fixed[^}]*top:12px[^}]*right:16px/.test(plainPage.html) && !/bottom:0/.test(plainPage.html) && plainPage.html.includes('<div class="fab"><button id="save"'),
    'the Save button floats at the top right (position:fixed; top; right) and no bottom bar exists on the page');
  { // CP6 (2.9, origin issue #125): the status pill wraps INSIDE the button's column — its width plus the edge and the gap never exceeds
    // the room the header keeps free on the right, in the regular and in the narrow window (the layout itself — verify-contour QA7)
    const px = (re) => Number((plainPage.html.match(re) || [])[1]);
    const pill = px(/\.fab #status \{ background:[^}]*max-width:(\d+)px/), head = px(/header \{[^}]*padding:10px (\d+)px/), edge = px(/\.fab \{[^}]*right:(\d+)px/);
    const narrow = /@media[^{]*\{ \.fab \{ top:8px; right:(\d+)px \}[^@]*?\.fab #status \{ max-width:(\d+)px \}[^@]*?padding-right:(\d+)px/.exec(plainPage.html);
    ok(pill > 0 && head > 0 && pill + edge + FAB_GAP_PX <= head && narrow && Number(narrow[2]) + Number(narrow[1]) + FAB_GAP_PX <= Number(narrow[3]),
      'the status pill is no wider than the button column the header keeps free — regular and narrow window (CP6, #125; got pill '
      + pill + ' + edge ' + edge + ' vs header ' + head + (narrow ? '; narrow ' + narrow.slice(1).join('/') : '; narrow rule missing') + ')');
  }
  // CP, the light re-judge's N1 (the layout and the pulse — verify-contour QA7v in a live browser): the pill holds at most two lines,
  // a status that does not fit goes to the bar; an alive pulse clears only the dead pulse's bar and puts back the status bar it covered
  ok(new RegExp('\\.fab #status \\{[^}]*-webkit-line-clamp:' + PILL_LINES + '; overflow:hidden').test(plainPage.html) && PILL_LINES === 2,
    'N1/F1: the status pill holds at most two lines (line-clamp) — a status that does not fit them goes to the bar, measured on the page');
  ok(plainPage.html.includes("if(b.className==='gone'){if(barMsg)showBar();") && plainPage.html.includes("if(submittedLocally||saved||!barFree())return;b.className='gone'"),
    'N1: an alive pulse clears only the dead pulse\'s bar and restores the status bar; after the last saved answer a dead pulse says nothing');
  ok(!selfCheck({ ...plainPage, html: plainPage.html.replace('.fab { position:fixed;', '.fab { position:static;') }).ok, 'self-check goes RED when the button stops floating (mutation on a copy)');
  ok(!selfCheck({ ...plainPage, html: plainPage.html.replace('.fab { position:fixed;', '.bar { position:fixed; bottom:0;') }).ok, 'self-check goes RED on a bar pinned to the bottom edge (the #60 page)');
  ok(!selfCheck({ ...plainPage, html: plainPage.html.replace('<label class="opt"><input', '<label class="opt">**leak**<input') }).ok, 'self-check goes RED when an option label carries raw markdown');
  // #106 (2.8): the page at 1.7x the browser base through zoom, the Save button at 1.5x, the narrow breakpoint scaled with the page
  ok(plainPage.html.includes('html { zoom:1.7 }') && !/body \{[^}]*font:(?!15px)/.test(plainPage.html),
    'the page renders at 1.7x the browser base through html zoom (the whole page, like Ctrl+Plus), the body font stays the 15px base (#106)');
  ok(plainPage.html.includes('.fab #save { zoom:0.882 }') && Math.abs(PAGE_SCALE * 0.882 - SAVE_SCALE) < 0.01,
    'the primary Save button carries its own zoom 1.5 / 1.7 = 0.882 — it renders at 1.5x the base (#106)');
  ok(plainPage.html.includes('@media (max-width:952px)') && !plainPage.html.includes('max-width:560px'),
    'the narrow-window breakpoint travels with the zoom: 560 x 1.7 = 952px, the unscaled 560px is gone (#106)');
  rmSync(join(root, ARCH), { force: true });
  ok(!selfCheck({ ...page, html: page.html.replace(/<input type="radio"[^>]*>/g, '') }).ok, 'self-check goes RED on a page whose radios were stripped (mutation on a copy)');
  ok(/header \{ position:static;/.test(page.html) && page.html.includes('<html lang="en">') && page.html.includes('Probe Project'), 'page: header scrolls with the page (position:static), lang and project name from the marker');
  // LP (#66): the pulse now carries the input state — `/alive?i=<ms since input>&d=<draft fields>&s=<saved>`
  ok(page.html.includes('class="tag rec"') && page.html.includes('id="rescue"') && page.html.includes("localStorage") && page.html.includes("fetch('/alive?i='"), 'page: recommendation chip, rescue ring, browser draft, /alive pulse with the input state (LP)');
  ok(page.html.includes("localStorage.setItem(DK+'__submitted'") && page.html.includes("indexedDB.open('kaif-contour'") && page.html.includes('TX.savedLocally'), 'page: an answer saved while the server is gone lands in localStorage of the project profile, no dialog (LP, #66)');
  ok(!/`/.test(page.html.slice(page.html.indexOf('<script>'))), 'T7: no backtick in the page script');

  // C6/I2: the decision lands in THREE places; the owner's answer is written back; by = owner from the table
  const rec = recordDecision(root, GOOD, { answers: { Q1: { choice: 'B', text: '', comment: 'fine' } }, comment: 'overall ok' }, cfg, new Date(2026, 8, 5, 22, 0));
  const after = readFileSync(join(root, GOOD), 'utf8');
  ok(/\*\*Answer:\*\* B\) <!-- owner-review: by Jane Owner aka JO/.test(after) && after.includes("Owner's comment (5 September 2026, 22:00"), 'record: the answer and the dated comment are written back into the md, by the owner from the table');
  ok(existsSync(join(root, 'interviews', 'decisions', 'interview_052_canonical.decision.json')) && readdirSync(join(root, 'interviews', 'decisions', 'archive')).length === 1 && rec.by === 'Jane Owner aka JO',
    'record: decision.json + one archive copy');
  ok(parseQuestions(after)[0].answered && buildPage(root, GOOD).html.includes('disabled checked'), 'after the record the question is answered and the page shows the chosen radio, disabled');
  const rec2 = recordDecision(root, GOOD, { answers: { Q1: { choice: 'A', text: '', comment: '' } } }, cfg, new Date(2026, 8, 5, 22, 1));
  ok(readFileSync(join(root, GOOD), 'utf8').includes('**Answer (follow-up, 5 September 2026, 22:01') && rec2.at !== rec.at, 'a second answer never overwrites the first — a dated follow-up (I2)');
  { // NT1 (2.9, origin issue #139): the own-answer field is multi-line, and an answer of two lines (a blank line between) is written as two
    // lines and read back whole
    // its own root beside the fixture's: the queue cases below count the fixture's documents and must not see this one
    const mlRoot = mkdtempSync(join(root, '..', 'kaif-contour-ml-'));
    mkdirSync(join(mlRoot, 'interviews'), { recursive: true });
    const ML = 'interviews/interview_053_multiline.md';
    writeFileSync(join(mlRoot, ML), '# Interview #053 — multiline\n\n> Status: awaiting\n\n### Q1. Pick?\n\n<!-- archaeology: n/a — selftest -->\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
    const pageML = buildPage(mlRoot, ML).html;
    recordDecision(mlRoot, ML, { answers: { Q1: { choice: '', text: 'first line\n\nsecond line', comment: '' } } }, cfg, new Date(2026, 8, 5, 22, 2));
    const mlAfter = readFileSync(join(mlRoot, ML), 'utf8'), mlQ = parseQuestions(mlAfter)[0];
    rmSync(mlRoot, { recursive: true, force: true });
    ok(pageML.includes('<textarea data-draft name="text:' + ML + ':Q1"') && !pageML.includes('<input type="text" data-draft name="text:')
      && /\*\*Answer:\*\* first line\nsecond line <!-- owner-review:/.test(mlAfter) && mlQ.answered && mlQ.answers[0].text === 'first line\nsecond line',
      'NT1 #139: the own answer is a textarea; an answer of two lines lands as two lines (no blank inside, the mark at the end) and reads back whole');
  }
  { // light judge of epic NT, F1 (2.9): a continuation line that reads as STRUCTURE — a fence, a heading, a rule, a table row, an option,
    // a bold letter, a label — must not be parsed as structure; the same for a multi-line comment (its twin, older than NT1). Each form is
    // its own continuation line of ONE answer; Q2 below must survive with its two options, and the answer must read back as typed.
    const fRoot = mkdtempSync(join(root, '..', 'kaif-contour-f1-'));
    mkdirSync(join(fRoot, 'interviews'), { recursive: true });
    const F1 = 'interviews/interview_054_structure.md';
    const q2 = '### Q2. Second?\n\n<!-- archaeology: n/a — selftest -->\n\n- **A)** yes\n- **B)** no\n\n**Answer:**\n';
    writeFileSync(join(fRoot, F1), '# Interview #054 — structure\n\n> Status: awaiting\n\n### Q1. Pick?\n\n<!-- archaeology: n/a — selftest -->\n\n'
      + '- **A)** one\n- **B)** two\n\n**Answer:**\n\n' + q2);
    const forms = ['```', '### Q2. fake', '---', '| **A** | x |', '- **A)** actually this', '- **C** bold letter', '**C.** paragraph letter',
      '**Answer:** x', "Owner's comment: y", 'Addressee: z', '  ~~~ indented fence', '\\- **A)** typed with a backslash'];
    const typed = ['my pick', ...forms].join('\n');
    recordDecision(fRoot, F1, { answers: { Q1: { choice: '', text: typed, comment: 'see:\n```\ncode\n\n### Q9. fake' } } }, cfg, new Date(2026, 8, 5, 22, 3));
    const fAfter = readFileSync(join(fRoot, F1), 'utf8'), fQs = parseQuestions(fAfter);
    rmSync(fRoot, { recursive: true, force: true });
    const fQ1 = fQs.find((q) => q.id === 'Q1'), fQ2 = fQs.find((q) => q.id === 'Q2');
    const readBack = typed.split('\n').map((s) => s.trim()).join('\n'); // the reader trims each line of a paragraph (CP), as before NT1
    ok(fQs.length === 2 && fQ1 && fQ1.options.length === 2 && fQ1.answers.length === 1 && fQ1.answers[0].text === readBack
      && fQ2 && fQ2.options.length === 2 && !fQ2.answered,
      'NT F1: an own answer and a comment whose lines read as structure keep Q2 and read back as typed (questions ' + fQs.length
      + ', Q1 options ' + (fQ1 && fQ1.options.length) + ', answers ' + (fQ1 && fQ1.answers.length) + ', Q2 options ' + (fQ2 && fQ2.options.length) + ')');
  }
  { // court RL 2.9, E-F1 · E-F2 · E-F3: a document with NO status line of its own — an answer line «Status: done» must not close it; a
    // rule `---` as the LAST answer line (the provenance mark follows it) reads back without its escape; the card of the answered
    // question shows the answer once, below — its continuation lines are not prose
    const gRoot = mkdtempSync(join(root, '..', 'kaif-contour-e1-'));
    mkdirSync(join(gRoot, 'interviews'), { recursive: true });
    const G = 'interviews/interview_055_nostatus.md';
    writeFileSync(join(gRoot, G), '# Interview #055 — no status line\n\n### Q1. Pick?\n\n<!-- archaeology: n/a — selftest -->\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n\n'
      + '### Q2. Second?\n\n<!-- archaeology: n/a — selftest -->\n\n- **A)** yes\n- **B)** no\n\n**Answer:**\n');
    const gTyped = 'my pick\nStatus: ✅ done\n### not a heading\n---';   // «✅ done» closes a document whose head carries it (the judge's form)
    recordDecision(gRoot, G, { answers: { Q1: { choice: '', text: gTyped, comment: 'see:\n- **A:** a fallback' } } }, cfg, new Date(2026, 8, 5, 22, 4));
    const gAfter = readFileSync(join(gRoot, G), 'utf8'), gQs = parseQuestions(gAfter);
    const gHtml = buildPage(gRoot, G).html;
    rmSync(gRoot, { recursive: true, force: true });
    const gQ1 = gQs.find((q) => q.id === 'Q1'), gQ2 = gQs.find((q) => q.id === 'Q2');
    // the page puts LIVE questions first — the card of the answered Q1 is found by its own title, never by its place
    const q1At = gHtml.indexOf('<strong>Q1.</strong>'), card1 = gHtml.slice(gHtml.lastIndexOf('<section', q1At), gHtml.indexOf('</section>', q1At));
    const shownOnce = card1.split('not a heading').length - 1 === 1;   // E-F3: the answer below «answered:» — never also as prose
    ok(docStatus(gAfter) === 'none' && gQ2 && !gQ2.answered && gQ1 && gQ1.answers[0] && gQ1.answers[0].text === gTyped
      && shownOnce && !/qbody[^<]*<p>[^<]*\\###/.test(gHtml) && !gHtml.includes('\\---') && !gHtml.includes('\\- <strong>') && gHtml.includes('a fallback'),
      'RL E-F1/F2/F3 · B-F2: an answer line «Status: done» keeps a status-less document open, a last line `---` reads back without its escape, the card shows no escaped answer line (status ' + docStatus(gAfter) + ', Q2 answered ' + (gQ2 && gQ2.answered) + ', read back ' + JSON.stringify(gQ1 && gQ1.answers[0] && gQ1.answers[0].text) + ')');
  }

  // I37/I38: the notice class — state machine, page form, batch order
  const NOTICE = 'docs/report.md';
  writeFileSync(join(root, NOTICE), '\uFEFF# Night report\r\n\r\nThree backlog items closed.\r\n');
  const beforeN = readFileSync(join(root, NOTICE), 'utf8');
  enqueue(root, NOTICE, { kind: KIND_NOTICE });
  ok(pendingNotices(root).length === 1 && !pendingDocs(root).some((d) => d.doc === NOTICE), 'notice: registered in its own group, never among the questions');
  const np = buildNoticePage(root, NOTICE);
  ok(np.html.includes(texts('en').btn.read) && !np.html.includes('type="radio"') && np.html.includes('Three backlog items'), 'notice page: the read mark, no radios, the body rendered');
  recordDecision(root, NOTICE, { kind: KIND_NOTICE, comment: '' }, cfg);
  ok(readFileSync(join(root, NOTICE), 'utf8') === beforeN, 'a read mark without a comment does NOT touch the owner\'s document (BOM and CRLF intact)');
  ok(markNoticeRead(root, NOTICE) && pendingNotices(root).length === 0, 'the read mark is the proof of delivery — the notice leaves the redelivery queue (I38)');
  writeFileSync(join(root, 'interviews', 'interview_053_open.md'), '# Interview #053\n\n> Status: awaiting\n\n### Q1. Q?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
  enqueue(root, NOTICE, { kind: KIND_NOTICE });
  const qp = buildQueuePage(root, pendingDocs(root));
  ok(qp.html.lastIndexOf('class="qcard') < qp.html.indexOf(texts('en').head.noticeGroup) && qp.total === 3 && qp.notices === 1, 'batch page: the notice group sits UNDER the last question card; both classes counted apart (three open questions across three documents, one notice)');
  const ip = buildIndexPage(root, ownerDocs(root), pendingNotices(root));
  ok((ip.html.match(/class="card /g) || []).length === 4 && ip.html.includes('/d/interviews%2Finterview_053_open.md'), 'entry page: one card per document (three interviews + one notice), each opening in its own window');

  // the PROOFREADING face: a comment field under every paragraph; the record carries comments { p<N> }
  const DRAFT = 'docs/DRAFT.md';
  writeFileSync(join(root, DRAFT), '# Draft\n\nFirst paragraph.\n\nSecond paragraph\nstill second.\n\n```\ncode block\n```\n\nFourth.\n');
  const pp = buildProofreadPage(root, DRAFT);
  ok(pp.paragraphs === 5 && (pp.html.match(/name="para:docs\/DRAFT\.md:p\d"/g) || []).length === 5 && pp.html.includes(texts('en').btn.done) && !pp.html.includes('type="radio"'),
    'proofreading page: five paragraphs (heading, two prose, one fenced block, one more), a field under each, Done, no radios');
  const pr = recordDecision(root, DRAFT, { kind: 'proofread', comments: { p2: 'tighten', p5: 'drop' }, comment: '' }, cfg, new Date(2026, 8, 5, 22, 2));
  ok(pr.kind === 'proofread' && pr.comments.p2 === 'tighten' && /- \*\*p2\*\* — tighten/.test(readFileSync(join(root, DRAFT), 'utf8')) && existsSync(join(root, 'interviews', 'decisions', 'DRAFT.decision.json')),
    'proofreading record: kind proofread, comments by paragraph id, a dated block at the end of the md');

  // the MOCKUP face: the image embedded, one comment field; the record never touches the image
  const PNG = 'docs/mock.png';
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(root, PNG), pngBytes);
  const mp = buildMockupPage(root, PNG);
  ok(mp.html.includes('<img src="data:image/png;base64,') && mp.html.includes('name="doccomment:docs/mock.png"') && mp.html.includes(texts('en').btn.done), 'mockup page: the image as a data URI, a comment field, Done');
  const mr = recordDecision(root, PNG, { kind: 'mockup', comment: 'move the logo left' }, cfg);
  ok(mr.kind === 'mockup' && readFileSync(join(root, PNG)).equals(pngBytes) && existsSync(join(root, 'interviews', 'decisions', 'mock.decision.json')), 'mockup record: kind mockup, the image byte-identical, decision.json named after the image');
  let threw = false; try { buildMockupPage(root, DRAFT); } catch { threw = true; }
  ok(threw, 'mockup face refuses a non-image loudly');
  // bugs/113: "Done" with no remarks is a RECORDED decision on the mockup and proofreading faces (never a refusal)
  const nr = recordDecision(root, PNG, { kind: 'mockup', comment: '', comments: {}, noRemarks: true }, cfgOf(root));
  ok(nr.noRemarks === true && JSON.parse(stripBom(readFileSync(join(root, 'interviews', 'decisions', 'mock.decision.json'), 'utf8'))).noRemarks === true,
    'mockup face: Done with empty fields records noRemarks: true (bugs/113)');
  ok(mp.html.includes(texts('en').ph.noRemarks) && mp.html.includes("p.noRemarks=true") && !mp.html.includes("CFG.face==='mockup'&&!(p.comment"),
    'mockup page carries the no-remarks hint and the client gate no longer refuses an empty mockup/proofreading record (bugs/113)');

  // I40–I42: the fact of showing, never-shown first, the gate by exit code
  const now = new Date('2026-09-05T12:00:00Z');
  const lq1 = listQueue(root, { now, includeStale: true });
  ok(lq1.exitCode === EXIT_NEVER_SHOWN && lq1.never.length >= 1 && lq1.lines[0].startsWith('⛔'), 'queue without a browser: a never-shown waiting document → ⛔ first, exit 2 (I41/I42)');
  recordShown(root, lq1.never.map((d) => d.doc), texts('en').transport.chat, now);
  const lq2 = listQueue(root, { now, includeStale: true });
  ok(lq2.exitCode === 0 && lq2.lines.every((l) => !l.includes(texts('en').list.never)) && readShown(root)[lq1.never[0].doc].transport === 'chat', 'after the fact of showing: exit 0, the transport is kept per document (I40)');
  // I39: a stale position is the agent's debt, not the owner's page
  const OLD = 'interviews/interview_002_old.md';
  writeFileSync(join(root, OLD), '# Interview #002\n\n> Status: awaiting\n> Created: 2026-01-01\n\n### Q1. Q?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n');
  ok(queueDocAgeDays(root, OLD, now) > STALE_QUEUE_DAYS && !ownerDocs(root, { now }).some((d) => d.doc === OLD) && ownerDocs(root, { now, includeStale: true }).some((d) => d.doc === OLD),
    'stale queue position leaves the owner\'s showcase; --include-stale brings it back on purpose (I39)');
  // OW7 (2.8, #100): a queue file of another shape — read as no items with one line, never written (the project's file byte for byte)
  const qf = join(decisionsAbs(root), QUEUE_FILE);
  const ourQueue = existsSync(qf) ? readFileSync(qf) : null;
  const FOREIGN_Q = '{"items":[{"doc":"interviews/interview_002_old.md","queued":"2026-09-05T06:45:00.000Z"}]}\n';
  writeFileSync(qf, FOREIGN_Q);
  let lqF = null, thrown = null;
  try { lqF = listQueue(root, { now }); } catch (e) { thrown = e; }
  ok(!thrown && queueShape(root) === 'foreign' && lqF.lines.some((l) => l.startsWith('ℹ ') && l.includes(QUEUE_FILE)), 'a queue file of another shape: the list prints one line about the project\'s own queue, no TypeError (OW7, #100)');
  let refused = false;
  try { enqueue(root, 'interviews/interview_002_old.md'); } catch (e) { refused = e instanceof ForeignQueueError; }
  ok(refused && readFileSync(qf, 'utf8') === FOREIGN_Q, 'a write into the foreign queue is REFUSED and the project\'s file stays byte for byte (OW7 twin)');
  if (ourQueue) writeFileSync(qf, ourQueue); else rmSync(qf, { force: true });
  // #86 (2.8, OW3): the agent's debt — every question answered, the status not closed — named FIRST with the age since the answer and
  // NO date cutoff (the document itself is older than the stale threshold); a stale queue document is named in the list, never silent.
  const DEBT = 'interviews/interview_003_answered.md';
  writeFileSync(join(root, DEBT), '# Interview #003\n\n> Status: awaiting\n> Created: 2026-08-01\n\n### Q1. Q?\n\n- **A)** one\n- **B)** two\n\n**Answer:** A\n');
  const dp = decisionPaths(root, DEBT);
  mkdirSync(resolve(dp.decision, '..'), { recursive: true });
  writeFileSync(dp.decision, JSON.stringify({ kind: 'interview', document: DEBT, at: new Date(now.getTime() - 11 * DAY_MS).toISOString(), answers: { Q1: { choice: 'A' } } }));
  const lq3 = listQueue(root, { now });
  ok(lq3.awaiting.some((d) => d.doc === DEBT && d.days === 11) && lq3.lines[0].startsWith('🔴') && lq3.lines.some((l) => l.includes(DEBT) && l.includes(texts('en').list.answered(11))),
    'answered, status not closed → the agent\'s debt named FIRST with its age since the answer (11 d), no date cutoff (#86)');
  ok(lq3.stale.some((d) => d.doc === OLD) && lq3.lines.some((l) => l.includes(OLD) && l.startsWith('! ')), 'a stale queue document is NAMED in the list without a browser, never silent (#86)');
  rmSync(join(root, DEBT), { force: true }); rmSync(dp.decision, { force: true });
  // the field's form (#86 S1): a ticked «answered» status whose continuation line says the answers await application, question headings the
  // canon parser does not read — named all the same (FORK B of plans/119 OW3: the field's own proven matcher reads the status block)
  const FIELD = 'interviews/interview_004_field_form.md';
  writeFileSync(join(root, FIELD), '# Interview #004\n\n> **Status:** ✅ answered by the owner 2026-08-20 (both fields).\n> · **AWAITING APPLICATION**: the plane is populated only by its own kind.\n\n### A1. The plane?\n\n**Answer:** A\n');
  const lq4 = listQueue(root, { now });
  ok(lq4.awaiting.some((d) => d.doc === FIELD) && lq4.lines.some((l) => l.includes(FIELD)), 'the field form — a ticked status whose status block says «awaiting application» — named as the agent\'s debt (#86, FORK B)');
  rmSync(join(root, FIELD), { force: true });

  // the call phrase names the class and the numbers; the owner is addressed by callName
  ok(callPhrase({ notice: true, title: 'Report' }, cfg).startsWith('Jane Owner aka JO, a Probe Project notice') && callPhrase({ batch: true, nDocs: 2, nQuestions: 1, nNotices: 1 }, cfg).includes('unread notices 1'),
    'call phrase: the owner\'s name, the project, the class and both numbers');
  ok(!callPhrase({ batch: true, nDocs: 1, nQuestions: 3, nNotices: 0 }, cfg).includes('notices'), 'call phrase: no notices — no mention of them');
  { // OW4 (2.8, origin issues #95 · #98): the calling session is named — derived from the workspace, spoken in the deployment language
    const ws = (name, dotGit) => { const d = join(root, 'ws', name); mkdirSync(d, { recursive: true }); if (dotGit === 'file') writeFileSync(join(d, '.git'), 'gitdir: x\n');
      else if (dotGit) { mkdirSync(join(d, '.git', dotGit === 'main+' ? 'worktrees/probe-team-dev2' : 'objects'), { recursive: true }); } return d; };
    ok(sessionName(ws('probe-team-dev2', 'file'), {}) === 'dev2' && sessionName(ws('probe', 'main+'), {}) === 'main' && sessionName(ws('solo', 'main'), {}) === null
      && sessionName(ws('none', null), {}) === null && sessionName(ws('solo2', 'main'), { KAIF_SESSION_NAME: 'reviewer' }) === 'reviewer',
      'session name: a linked workspace <project>-team-dev2 → dev2 · the main copy with others → main · one workspace → none · KAIF_SESSION_NAME wins (OW4, #98)');
    const ru = { ...cfg, language: 'ru' }, sp = T(ru).spoken;
    ok(spokenSession('dev2', cfg) === 'dev two' && spokenSession('dev12', cfg) === 'dev twelve' && spokenSession('dev2', ru) === new Map(sp.words).get('dev') + ' ' + sp.ones[2]
      && spokenSession('main', ru) === new Map(sp.words).get('main') && spokenSession('qa-lead', cfg) === 'qa lead',
      'session name, spoken: dev2 → "dev two" · dev12 → "dev twelve" · the Russian pack\'s words and numbers (OW4, #98)');
    const named = { ...cfg, session: 'dev2' };
    ok(callPhrase({ notice: true, title: 'Report' }, named).startsWith('Jane Owner aka JO, this is dev two. A Probe Project notice')
      && callPhrase({ notice: true, title: 'Report' }, cfg).startsWith('Jane Owner aka JO, a Probe Project notice'),
      'call phrase: «<owner>, this is dev two. …» when the session is named; unchanged when there is one workspace (OW4, #98)');
    ok(pageShell(named, { title: 'T', kind: 'k', heading: '', main: '', questions: [] }).includes('<title>Probe Project · T · dev2</title>')
      && pageShell(cfg, { title: 'T', kind: 'k', heading: '', main: '', questions: [] }).includes('<title>Probe Project · T</title>'),
      'page window title: « · dev2» when the session is named (OW4, #98)');
    const dl = []; const dp = callDoor(root, 'the test phone needs unlocking', { dryRun: true, log: (l) => dl.push(l) });
    ok(dp === 'Jane Owner aka JO, the test phone needs unlocking' && dl.length === 1 && /^CALL \(dry run, no sound\): Jane Owner aka JO, the test phone/.test(dl[0]),
      'call door --dry-run: the phrase and the banner line printed, no sound; one workspace — no session named (OW4, #95)');
    rmSync(join(root, 'ws'), { recursive: true, force: true });
  }

  { // OW6 (2.8, the KAIF owner's word — answers are saved one at a time in every project). (1) The decision MERGES the records of one
  // page (its rev = the revision the previous record left); a record of another revision starts a new decision; the archive keeps each.
  const MQ = (k) => '### Q' + k + '. Pick ' + k + '?\n\n- **A)** one\n- **B)** two\n\n**Answer:**\n';
  const three = '# Interview #008\n\n> Status: awaiting\n\n' + MQ(1) + '\n' + MQ(2) + '\n' + MQ(3);
  const MD = 'interviews/interview_008_merge.md';
  writeFileSync(join(root, MD), three);
  const decOf = (d) => JSON.parse(stripBom(readFileSync(decisionPaths(root, d, cfg).decision, 'utf8')));
  const rec1 = recordDecision(root, MD, { answers: { Q1: { choice: 'A' } }, rev: bodyHash(three) }, cfg);
  const rec2 = recordDecision(root, MD, { answers: { Q2: { choice: 'B' } }, rev: decOf(MD).revAfter }, cfg);
  const d2 = decOf(MD);
  ok(rec1.answers.Q1 && !rec2.answers.Q1 && d2.answers.Q1 && d2.answers.Q2 && d2.records === 2,
    'decision: the second record of the same page MERGES — Q1 and Q2 in decision.json (records 2); the record itself carries only Q2 (OW6)');
  recordDecision(root, MD, { answers: { Q3: { choice: 'A' } }, rev: 'another-revision' }, cfg);
  const d3 = decOf(MD);
  ok(d3.answers.Q3 && !d3.answers.Q1 && !d3.records, 'decision: a record of ANOTHER revision starts a new decision — old answers never ride along (OW6)');
  rmSync(join(root, MD), { force: true });
  // (2) The page carries its revision into every save, re-reads itself after a partial save, keys drafts by the question's fingerprint
  writeFileSync(join(root, MD), three);
  const pg = buildPage(root, MD);
  ok(pg.html.includes('"rev":"' + bodyHash(three) + '"') && pg.html.includes('p.rev=CFG.rev') && pg.html.includes("sessionStorage.setItem(DK+'__left'")
    && pg.html.includes("String(res.j.left))}catch(e){}location.reload();return}") && pg.questions.every((q) => /^[0-9a-f]{12}$/.test(q.qh)) && pg.html.includes("return DK+n+(h?'#'+h:'')"),
    'page: the revision rides in every save; a partial save re-reads the page; a draft key carries its question\'s fingerprint (OW6)');
  // (3) The LIVE server: three questions; Q1 saved → 2 left, the process LIVES, the waiter wakes (0); a save of the OLD revision → 409;
  // the same save repeated → 200 duplicate; Q2 → the decision merges; Q3 → the contour ends with exit 0
  const sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const slog = [];
  const served = serveContour(root, { docPath: MD }, { open: false, signal: false, log: (l) => slog.push(String(l)) });
  let ended = null; served.then((v) => { ended = v; });
  let url = null;
  for (let i = 0; i < 100 && !url; i++) { url = (slog.join('\n').match(/Page is up: (http:\/\/127\.0\.0\.1:\d+\/)/) || [])[1] || null; if (!url) await sl(50); }
  const post = (body) => fetch(url + 'decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, j: await r.json() })).catch((e) => ({ status: 0, j: { reason: String(e) } }));
  if (!url) ok(false, 'live server: the page is up (OW6)');
  else {
    // a real page pulses; without it a quiet environment (the polygon's: silence 0.9 s) ends the server between two saves
    const beat = setInterval(() => { fetch(url + 'alive?i=-1&d=0&s=0').catch(() => {}); }, 200);
    const rev0 = bodyHash(three);
    const waiter = waitForRecord(root, MD, { log: () => {}, pollMs: 100 });
    const a1 = { doc: MD, answers: { Q1: { choice: 'A', text: '', comment: '' } }, comment: '', face: 'interview', rev: rev0 };
    const r1 = await post(a1);
    const w1 = await Promise.race([waiter, sl(3000).then(() => 'timeout')]);
    await sl(SERVER_DEATH_MS + 300);
    ok(r1.status === 200 && r1.j.left === 2 && r1.j.rev && r1.j.rev !== rev0 && ended === null && slog.some((l) => /Questions left: 2 — the page STAYS open/.test(l)),
      'live server: a partial save (Q1 of three) → «left 2», a new revision, the process LIVES and says the page stays (OW6, I8)');
    ok(w1 === 0, 'live server: the waiter wakes with exit 0 on the partial record — the agent learns without the page closing (OW6)');
    const r2 = await post({ ...a1, answers: { Q2: { choice: 'B', text: '', comment: '' } } });
    ok(r2.status === 409 && r2.j.stale && !decOf(MD).answers.Q2, 'live server: a save of the OLD revision → 409, nothing written (OW6, the stale-tab gap)');
    const r2d = await post(a1);
    ok(r2d.status === 200 && r2d.j.duplicate && r2d.j.left === 2, 'live server: the same save repeated after a lost response → 200 «duplicate», not written twice (OW6)');
    const r3 = await post({ ...a1, answers: { Q2: { choice: 'B', text: '', comment: '' } }, rev: r1.j.rev });
    const d4 = decOf(MD);
    ok(r3.status === 200 && r3.j.left === 1 && d4.answers.Q1 && d4.answers.Q2 && d4.records === 2, 'live server: the second partial save MERGES the decision — Q1 and Q2 (OW6)');
    const r4 = await post({ ...a1, answers: { Q3: { choice: 'A', text: '', comment: '' } }, rev: r3.j.rev });
    for (let i = 0; i < 80 && ended === null; i++) await sl(50);
    ok(r4.status === 200 && r4.j.left === 0 && ended && ended.exitCode === 0, 'live server: the LAST answer ends the contour with exit 0 (I8)');
    clearInterval(beat);
  }
  if (ended === null) { try { await fetch(url + 'close?t=x', { method: 'POST' }); } catch { /* best effort */ } }
  rmSync(join(root, MD), { force: true });
  // (4) The waiter ends with 2 when the contour it saw ended without a new record — its lock gone (the page closed; the beacon path of
  // the server itself is proved by s22 and verify-contour)
  const LK = lockPath(root, basename(MD));
  writeFileSync(LK, '{}\n');
  const waiter2 = waitForRecord(root, MD, { log: () => {}, pollMs: 50 });
  await sl(200); rmSync(LK, { force: true });
  const w2 = await Promise.race([waiter2, sl(3000).then(() => 'timeout')]);
  ok(w2 === 2, 'waiter: the contour it saw ended without a new record (its lock gone) → exit 2, nothing to apply (OW6)');
  // (4b) court RL 2.8, B-F1: a waiter that never sees a live contour (the page closed before it started) ends with 2 after its window
  const waiter3 = waitForRecord(root, MD, { log: () => {}, pollMs: 50, graceMs: 300 });
  const w3 = await Promise.race([waiter3, sl(3000).then(() => 'timeout')]);
  ok(w3 === 2, 'waiter: no live contour seen within its window → exit 2, never an eternal wait (B-F1)');
  // (4c) light re-judge RL 2.8, J-F1: the document's waiter next to a live QUEUE page (the `_queue` lock only) waits past its window;
  // when the queue page ends without a record for it → exit 2 «ended without a new record»
  const QLK = lockPath(root, '_queue');
  writeFileSync(QLK, '{}\n');
  let w4 = 'pending';
  const waiter4 = waitForRecord(root, MD, { log: () => {}, pollMs: 50, graceMs: 300 }).then((c) => { w4 = c; return c; });
  await sl(700);
  const waitedPastWindow = w4 === 'pending';
  rmSync(QLK, { force: true });
  const w4end = await Promise.race([waiter4, sl(3000).then(() => 'timeout')]);
  ok(waitedPastWindow && w4end === 2, 'waiter: a document waiter next to a live QUEUE page waits past its window, and ends with 2 when the queue page ends (J-F1)');
  // (4d) CP6 (2.9, origin issue #125): the page's server is KILLED and its lock STAYS (I29) — the waiter judges the lock's pid: it waits
  // while the process lives, and ends with 2 and the «server is gone → --queue --list» line once it is dead (v2.8 waited forever)
  const srv = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const srvExit = new Promise((r) => srv.once('exit', r));
  writeFileSync(LK, JSON.stringify({ pid: srv.pid, url: 'http://127.0.0.1:1/' }) + '\n');
  const wlog5 = [];
  let w5 = 'pending';
  const waiter5 = waitForRecord(root, MD, { log: (l) => wlog5.push(String(l)), pollMs: 50, graceMs: 300 }).then((c) => { w5 = c; return c; });
  await sl(500);
  const waitedWhileAlive = w5 === 'pending';
  srv.kill('SIGKILL'); await srvExit;
  const w5end = await Promise.race([waiter5, sl(3000).then(() => 'timeout')]);
  ok(waitedWhileAlive && w5end === 2 && existsSync(LK) && wlog5.some((l) => /server is gone/.test(l) && /--queue --list/.test(l)),
    'waiter: the page\'s server killed, its lock kept → exit 2 «the page\'s server is gone … --queue --list»; while it lived — waiting (CP6, #125)');
  // (4e) CP6: a lock of a DEAD server found at the start is an old crash — the waiter still gives a new page its window, then ends with 2
  // and the same line (never an eternal wait on a lock that nobody holds)
  let w6 = 'pending';
  const wlog6 = [];
  const waiter6 = waitForRecord(root, MD, { log: (l) => wlog6.push(String(l)), pollMs: 50, graceMs: 400 }).then((c) => { w6 = c; return c; });
  await sl(150);
  const gaveWindow = w6 === 'pending';
  const w6end = await Promise.race([waiter6, sl(3000).then(() => 'timeout')]);
  ok(gaveWindow && w6end === 2 && wlog6.some((l) => /server is gone/.test(l)),
    'waiter: a dead server\'s lock at the start — the window is kept for a new page, then exit 2 «server is gone» (CP6)');
  rmSync(LK, { force: true });
  // (5) judge OW10 H11: an answer picked up from the owner's machine for an OLDER revision is recorded as data, never written by numbers
  writeFileSync(join(root, MD), three);
  const recS = recordRecovered(root, MD, { answers: { Q1: { choice: 'B', text: '', comment: '' } }, rev: 'an-older-revision' }, cfg);
  ok(recS.staleRevision === true && readFileSync(join(root, MD), 'utf8') === three && decOf(MD).answers.Q1.choice === 'B',
    'recovery: an answer saved for an OLDER revision is kept as data (staleRevision), the document is untouched (OW6, judge OW10 H11)');
  const recF = recordRecovered(root, MD, { answers: { Q1: { choice: 'A', text: '', comment: '' } }, rev: bodyHash(three) }, cfg);
  ok(!recF.staleRevision && /A\)/.test(readFileSync(join(root, MD), 'utf8')), 'recovery, control: the same revision is written into the document (OW6)');
  rmSync(join(root, MD), { force: true });
  // (6) judge OW10 H6: a page closed after partial saves says the answers are recorded — never «without an answer»
  writeFileSync(join(root, MD), three);
  const slog3 = [];
  const served3 = serveContour(root, { docPath: MD }, { open: false, signal: false, log: (l) => slog3.push(String(l)) });
  let url3 = null;
  for (let i = 0; i < 100 && !url3; i++) { url3 = (slog3.join('\n').match(/Page is up: (http:\/\/127\.0\.0\.1:\d+\/)/) || [])[1] || null; if (!url3) await sl(50); }
  if (url3) await fetch(url3 + 'decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: MD, answers: { Q1: { choice: 'A', text: '', comment: '' } }, comment: '', face: 'interview', rev: bodyHash(three) }) }).catch(() => null);
  if (url3) await fetch(url3 + 'closed', { method: 'POST', body: 'doc:unsaved' }).catch(() => null);
  const e3 = await Promise.race([served3, sl(BEACON_RELOAD_GRACE_MS + 3000).then(() => null)]);
  ok(e3 && e3.exitCode === 2 && /page closed after 1 saved answer\(s\) — recorded, nothing lost/.test(e3.outcome || ''),
    'a page closed after a partial save: exit 2 and «closed after 1 saved answer(s) — recorded, nothing lost» (OW6, judge OW10 H6)');
  rmSync(join(root, MD), { force: true });
  } // OW6

  rmSync(root, { recursive: true, force: true });
  log(bad ? 'SELFTEST RED: ' + bad + ' of ' + n : 'contour selftest green: ' + n + ' checks (pre-flight red on the "options as paragraphs" fixture, three faces, records, showing)');
  if (bad) process.exit(1);
}

// ── Entry point (T9: executes only when run directly; `main` is exported so an origin wrapper can run
// the very same CLI in-process — the origin eats its own shipment, plans/93 IC5) ──────────────────
export function main(args = process.argv.slice(2), root = process.cwd()) {
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  // LP (2.7, #66; the core's bug-33 rule): an unknown flag REFUSES before any page, sound or call. The 2.6 generator let
  // `--close` fall through to the show — a page and a voice call for a flag nobody meant.
  const valueFlags = ['--timeout', '--transport', '--mark-shown', '--mark-implemented', '--mark-withdrawn', '--why', '--where', '--owner-word', '--call', '--search'];
  const unknown = args.filter((a, i) => a.startsWith('--') && !KNOWN_FLAGS.includes(a) && !valueFlags.includes(args[i - 1]));
  if (unknown.length) {
    console.error('✖ unknown flag' + (unknown.length > 1 ? 's' : '') + ': ' + unknown.join(' ') + ' — refusing BEFORE any page, sound or call (bug 33: a silently ignored flag shows something you did not ask for). Known flags: ' + KNOWN_FLAGS.join(' '));
    process.exitCode = EXIT_UNKNOWN_FLAG; // exitCode, not exit(): Windows pipes are asynchronous and exit() would drop the line
    return;
  }
  const docPath = args.find((a, i) => !a.startsWith('--') && !valueFlags.includes(args[i - 1]));
  const opts = {
    open: !args.includes('--no-open'),
    signal: !args.includes('--silent'),
    timeoutMs: Number(opt('--timeout') || 0) * 1000, // I9: default 0 — the machine's patience is infinite
    includeStale: args.includes('--include-stale'),
  };
  const asNotice = args.includes('--notice');
  const face = args.includes('--proofread') ? 'proofread' : args.includes('--mockup') ? 'mockup' : 'interview';
  const usage = () => {
    console.error('usage: ' + CLI_NAME + ' <doc.md> [--no-serve|--no-open|--silent|--timeout N]\n' +
      '       ' + CLI_NAME + ' <doc.md> --check         (the form check WITHOUT a page: no server, no sound, no call, no showing; exit 3 = fix the form)\n' +
      '       --no-open serves the page and STILL CALLS the owner (the window is just not opened) — a form check is --check, not --no-open\n' +
      '       ' + CLI_NAME + ' <doc.md> --notice        (something to tell; "read" is the outcome)\n' +
      '       ' + CLI_NAME + ' <doc.md> --proofread     (a comment field under every paragraph)\n' +
      '       ' + CLI_NAME + ' <image> --mockup         (the image + comments)\n' +
      '       ' + CLI_NAME + ' --queue [--include-stale] | --queue --list | --enqueue <doc.md> [--notice] | --selftest\n' +
      '       ' + CLI_NAME + ' --mark-shown <doc.md> [--transport chat]\n' +
      '       ' + CLI_NAME + ' --wait [<doc.md>]      (the waiter: exit 0 on the next recorded answer, 2 when the contour ended without one)\n' +
      '       ' + CLI_NAME + ' --call "<what is needed>" [--dry-run]   (call the owner — hands or a quick answer; names the calling session)\n' +
      '       ' + CLI_NAME + ' --mark-implemented <doc.md> <Q> --where <commit|file>   (the fourth fact, I44: the decision landed — never raise it again)\n' +
      '       ' + CLI_NAME + ' --mark-withdrawn <doc.md> <Q> --why <reason>   (an OPEN question a withdrawal made moot — never an answer on the owner\'s behalf, 2.8)\n' +
      '       ' + CLI_NAME + ' <doc.md> --close [--force --owner-word "<quote>"]   (the ONLY way to end a live page: prints port · pid · title, refuses while the owner is typing or a draft is unsaved — exit 4)\n' +
      'Exit codes: 0 recorded · 2 closed without an answer · 130 interrupted · 3 pre-flight refused (fix the form) · 4 --close refused · 1 usage / unknown flag.\n' +
      'Run it as a TRACKED background task (I31). Contract: .kaif/INTERACTIVE_CONTOUR_SPEC.md');
    process.exit(1);
  };
  const cfg = cfgOf(root);
  if (!cfg.markerFound) console.log('note: no .kaif/kaif.json here — defaults in use (project "' + cfg.projectName + '", owner "' + cfg.ownerName + '", language ' + cfg.language + ').');
  if (args.includes('--selftest')) { selftest().then(() => process.exit(0)); return; }
  if (args.includes('--call')) { // OW4 (2.8, #95 · #98): the owner's hands or a quick answer — the CALL, naming the calling session
    const text = opt('--call');
    if (!text) usage();
    callDoor(root, text, { dryRun: args.includes('--dry-run') });
    return; // the voice runs in a child process; this one ends when it does
  }
  if (args.includes('--wait')) { // OW6 (2.8): the waiter — started by the agent next to a live page; ends on the next recorded answer
    waitForRecord(root, docPath || null).then((code) => { process.exitCode = code; });
    return;
  }
  if (args.includes('--enqueue')) {
    if (!docPath) usage();
    let items;
    try { items = enqueue(root, docPath, { kind: asNotice ? KIND_NOTICE : 'question' }); }
    catch (e) { if (e instanceof ForeignQueueError) { console.log('✖ ' + e.message); process.exit(1); } throw e; }
    console.log('Queued: ' + items.length + ' position(s)' + (asNotice ? ' (notice)' : '') + ' — shown as a batch by: ' + CLI_NAME + ' --queue');
    process.exit(0);
  }
  if (args.includes('--mark-shown')) { // I40: the question was asked pointedly in chat — the agent's hand records the fact
    const doc = opt('--mark-shown');
    if (!doc) usage();
    const transport = opt('--transport') || T(cfg).transport.chat;
    recordShown(root, [doc], transport);
    console.log('Shown recorded (I40): ' + doc + ' · ' + transport + ' → ' + cfg.decisionsDir + '/' + SHOWN_FILE);
    process.exit(0);
  }
  if (args.includes('--close')) { // LP (#66): the only legal way to end a live owner page from outside
    if (!docPath && !args.includes('--queue')) usage();
    // exitCode, not process.exit(): on Windows stdout to a PIPE is asynchronous, and an immediate exit drops the last lines
    closeContour(root, docPath || '--queue', { force: args.includes('--force'), ownerWord: opt('--owner-word') }).then((code) => { process.exitCode = code; });
    return;
  }
  // LP (#66): before the queue, the check or a show — pick up what the owner saved while a server was gone
  const afterRecovery = (fn) => recoverFromWindow(root, { log: console.log }).then(fn, (e) => { console.log('recovery failed: ' + e.message); fn(); });
  if (args.includes('--search')) { // OW5 (2.8, #82 · #74): the archaeology of a question in ANY transport — a chat question too
    const text = opt('--search');
    if (!text) usage();
    const words = archaeologyWords(text);
    const r = archaeologySearch(root, words);
    console.log('archaeology search: "' + words.join('|') + '" → ' + r.hits + ' hits in ' + r.files.length + ' file(s)');
    for (const h of r.lines.slice(0, 12)) console.log('  ' + relDoc(root, h.file) + ':' + h.line + ': ' + h.text);
    if (r.lines.length > 12) console.log('  … ' + (r.lines.length - 12) + ' more');
    console.log('attest: <!-- archaeology: search "' + words.join('|') + '" → ' + r.hits + ' hits · read: <what you read | none> · prior: <none | "<prior answer>" + address | unrelated — why> -->');
    process.exit(0);
  }
  if (args.includes('--check')) { // QL1 (#56): the form check is a DOOR of its own — never the show
    if (!docPath) usage();
    afterRecovery(() => process.exit(checkDoc(root, docPath)));
    return;
  }
  if (args.includes('--mark-withdrawn')) { // 2.8, epic CH (criterion 13): see markWithdrawn()
    const i = args.indexOf('--mark-withdrawn');
    const doc = args[i + 1], qid = args[i + 2], why = opt('--why');
    if (!doc || !qid || qid.startsWith('--') || !why) usage();
    const r = markWithdrawn(root, doc, qid, why, cfg);
    console.log(r.line);
    process.exit(r.code);
  }
  if (args.includes('--mark-implemented')) { // I44 (QL2, #54): the fourth fact — the agent's hand, at the moment of implementing, with an address
    const i = args.indexOf('--mark-implemented');
    const doc = args[i + 1], qid = args[i + 2], where = opt('--where');
    if (!doc || !qid || qid.startsWith('--') || !where) usage();
    const ids = parseQuestions(readFileSync(resolve(root, doc), 'utf8')).map((q) => q.id);
    if (!ids.includes(qid)) { console.log(T(cfg).impl.noSuch(doc, qid, ids)); process.exit(1); }
    recordImplemented(root, relDoc(root, doc), qid, where);
    console.log(T(cfg).impl.marked(doc, qid, where, cfg.decisionsDir + '/' + IMPLEMENTED_FILE));
    process.exit(0);
  }
  if (args.includes('--queue') && args.includes('--list')) {
    afterRecovery(() => {
      const r = listQueue(root, { includeStale: opts.includeStale });
      for (const l of r.lines) console.log(l);
      process.exit(r.exitCode);
    });
    return;
  }
  afterRecovery(() => mainShow(args, root, { opt, docPath, opts, asNotice, face, usage, cfg }));
}

// The show half of main() — runs after the recovery step (LP): the queue page, a notice, a face, the interview.
function mainShow(args, root, { opt, docPath, opts, asNotice, face, usage, cfg }) {
  if (args.includes('--queue')) {
    const stale = opts.includeStale ? [] : staleQueueDocs(root, ownerDocs(root, { includeStale: true }));
    for (const d of stale) console.log('! stale in the queue (' + d.days + ' d > ' + STALE_QUEUE_DAYS + '): ' + d.doc + ' — NOT shown; close it by status or show it on purpose: --include-stale');
    const implGate = implementedGate(root); // I45: said out loud before any page, exit 2 when nothing else waits
    for (const g of implGate) console.log('🔴 ' + g.line);
    const docs = ownerDocs(root, opts);
    const notices = pendingNotices(root);
    if (docs.length === 0 && notices.length === 0) { console.log('No unanswered questions and no unread notices — the queue is empty, no page needed.'); process.exit(implGate.length ? EXIT_NEVER_SHOWN : 0); }
    for (const d of docs) { // spec §2: a batch never carries a page that would open without radios
      const g = gateForOpen(root, d.doc);
      if (g) { for (const l of g) console.log(l); console.log('  in: ' + d.doc); process.exit(EXIT_PREFLIGHT); }
    }
    serveContour(root, { batch: true }, opts).then((r) => process.exit(r.exitCode));
  } else if (!docPath) {
    usage();
  } else if (asNotice) {
    enqueue(root, docPath, { kind: KIND_NOTICE });
    serveContour(root, { docPath, notice: true }, opts).then((r) => process.exit(r.exitCode));
  } else {
    if (face === 'interview') { // spec §2: pre-flight + self-check BEFORE any page opens
      const stImpl = implStateOf(relDoc(root, docPath), parseQuestions(readFileSync(resolve(root, docPath), 'utf8')), readImplemented(root));
      if (stImpl.implementedOpen.length && stImpl.unanswered === 0) { // I45: never raise what is already implemented
        console.log('🔴 ' + T(cfg).impl.gate(relDoc(root, docPath), stImpl.implementedOpen));
        process.exit(EXIT_NEVER_SHOWN);
      }
      const g = gateForOpen(root, docPath);
      if (g) { for (const l of g) console.log(l); process.exit(EXIT_PREFLIGHT); }
    }
    if (args.includes('--no-serve')) { // C9: "build and exit" — a synchronous caller must not hang
      const page = face === 'proofread' ? buildProofreadPage(root, docPath) : face === 'mockup' ? buildMockupPage(root, docPath) : buildPage(root, docPath);
      const outDir = tmpDirOf(root);
      mkdirSync(outDir, { recursive: true });
      const out = join(outDir, basename(docPath).replace(/\.[^.]+$/u, '') + '.html');
      writeFileSync(out, page.html, 'utf8');
      console.log('Render written: ' + out);
      console.log('RENDER IS NOT YET A SHOW'); // M8: the reminder at the point of temptation to hand over a path
      console.log('Showing is an action: ' + CLI_NAME + ' ' + docPath + (face === 'interview' ? '' : ' --' + face));
      process.exit(0);
    }
    serveContour(root, { docPath, face }, opts).then((r) => process.exit(r.exitCode));
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) main();
