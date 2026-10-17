#!/usr/bin/env node
// core.mjs — the CORE of the shipped interactive contour (KAIF 2.6, epic IC; plans/93 IC3).
// [TESTED: 2026-09-05 · `review.mjs --selftest` 45 checks green (parse rules, pre-flight red on #051 / green on
//  list · table · declared free field · answered, records in three places, follow-up never overwrites); pre-flight over
//  the origin's live corpus (27 interviews + homework) — 0 red; polygon `all 22 suites green` (s12 + s22)]
//
// A generalisation of the origin's contour core (tools/lib/review-core.mjs, 534 lines, field-proven
// since 2.2) — the same functions, minus the origin's constants: every project parameter is READ at
// runtime from `.kaif/kaif.json` (owner rule #97 — a mechanic ships only complete, it never asks the
// owner for its parameters). Zero dependencies. One library for BOTH sides (the page and any
// sending gate): "four faces — one hash", `checkApproval` is one for all.
//
// Contract lines living here (the long form is the /owner-reviews skill; the one-page executable
// contract is .kaif/INTERACTIVE_CONTOUR_SPEC.md):
//   C3  — normalize: BOM → CRLF/CR to LF → trailing blanks cut → exactly one final newline;
//         hash = sha256(normalize). Four faces of one text give ONE hash.
//   C4  — five parsing rules of a living text (a `---` rule closes the block · a counter-question is
//         not an answer · an option is multi-line · closedness is the document STATUS · \p{L} with u).
//   C6/I2 — the answer is written to THREE places with derived names; the owner's answer is
//         untouchable — new text only as a dated follow-up; a whole-document comment — a dated block.
//   C7/I4 — checkApproval: refuses on any doubt, never throws; the gate is fail-closed.
//   I6  — quiet hours with a window ACROSS midnight.
//   I22/I23 — provenance in two forms (ISO for the machine · local time in words for the human).
//   I24 — the renderer strips HTML comments OUTSIDE code blocks (inside fenced they are content).
//   P8  — markdown mini-renderer, zero dependencies, escaping is the FIRST action.
//   §2 of the spec — PRE-FLIGHT: a question with no options in list/table form and no declared free
//         field must not open (the #51 defect: options typed as paragraphs → a page without radios).
//   §2, second axis (2.7, origin issue #70) — ARCHAEOLOGY: a LIVE question of a document dated on or
//         after ARCHAEOLOGY_SINCE must not open without the attestation of the search that was run
//         (`<!-- archaeology: … → N hits · read: … · prior: … -->`); the refusal prints the READY grep.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { PARSER, texts } from './texts.mjs';

// ── Defaults (named, never magic) ─────────────────────────────────────────────────────────────
export const DEFAULT_DECISIONS_DIR = 'interviews/decisions';   // canon of /owner-reviews
export const DEFAULT_OWNER = 'owner';                           // when no identity row is found
export const DEFAULT_LANGUAGE = 'en';
export const KAIF_JSON = '.kaif/kaif.json';
export const AGENT_GUIDE = 'AGENT_GUIDE.md';
export const MIN_OPTIONS = 2;                                   // spec §2: fewer = not a fork
const HEAD_LINES = 30;                                          // the document head the status line lives in
const ARCHIVE_SUBDIR = 'archive';

const stripBom = (s) => String(s).replace(/^\uFEFF/, '');
const readJson = (p) => { try { return JSON.parse(stripBom(readFileSync(p, 'utf8'))); } catch { return null; } };

// ── Configuration — read, derived, never asked (#97) ──────────────────────────────────────────
/**
 * Owner name from the identity table of AGENT_GUIDE.md: the row whose first cell is the owner label
 * (both scripts). The cell is cleaned of bold marks; a "·"-separated list keeps its first entry.
 */
export function ownerFromIdentityTable(root) {
  const p = resolve(root, AGENT_GUIDE);
  if (!existsSync(p)) return null;
  const re = new RegExp('^\\|\\s*\\*{0,2}(?:' + PARSER.identityOwnerLabels + ')\\*{0,2}\\s*\\|\\s*([^|]+)\\|', 'imu');
  const m = stripBom(readFileSync(p, 'utf8')).match(re);
  if (!m) return null;
  const cell = m[1].replace(/\*\*/g, '').replace(/`/g, '').split(' · ')[0].trim();
  return cell && !/^<[A-Z_]+>$/.test(cell) ? cell : null; // an unfilled `<AUTHOR>` placeholder is not a name
}

/**
 * The contour configuration of a project root. Every field has a derived default; `.kaif/kaif.json`
 * may override any of them under `contour: { … }`. Nothing here asks a human.
 */
// OW4 (2.8, origin issues #95 · #98): the CALLING SESSION's name — with several workspaces of one project the owner hears which window
// calls. Derived, never typed per call: KAIF_SESSION_NAME wins; a linked workspace (its .git is a FILE) is named by its directory
// (`<project>-team-<role>` → `<role>`, the /team-deployment naming invariant); the main copy is "main" when other workspaces exist (its
// .git/worktrees/ lists them); one workspace → no name (nothing to tell apart). Read from the file system — no git program is started.
// [TESTED: 2026-09-25 20:15–20:24 · selftest: a linked workspace → its role, the main copy with others → main, one workspace → none, the env
//  var wins; on the origin (8 worktrees) → «main»; s22 F on two deployed workspaces; mutant «the workspace not read» red exactly on its case;
//  report testcases/reports/2026-09-25_ow4-call-names-session.md]
export function sessionName(root, env = process.env) {
  const own = String(env.KAIF_SESSION_NAME || '').trim();
  if (own) return own;
  const dotGit = resolve(root, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  if (st.isFile()) { const base = basename(resolve(root)); const m = base.match(/-team-(.+)$/u); return m ? m[1] : base; }
  if (!st.isDirectory()) return null;
  try { return readdirSync(resolve(dotGit, 'worktrees')).length > 0 ? 'main' : null; } catch { return null; }
}

export function loadContourConfig(root) {
  const marker = readJson(resolve(root, KAIF_JSON)) || {};
  const c = (marker.contour && typeof marker.contour === 'object') ? marker.contour : {};
  const language = String(c.language || marker.language || DEFAULT_LANGUAGE).toLowerCase().slice(0, 2);
  const projectName = String(c.projectName || marker.projectName || basename(resolve(root))).trim();
  const ownerName = String(c.ownerName || ownerFromIdentityTable(root) || DEFAULT_OWNER).trim();
  const decisionsDir = String(c.decisionsDir || DEFAULT_DECISIONS_DIR).replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    root: resolve(root), language, projectName, ownerName,
    callName: String(c.callName || ownerName).trim(),        // how the voice addresses the owner
    spokenProjectName: String(c.spokenProjectName || projectName).trim(), // how the voice names the project
    decisionsDir, archiveDir: decisionsDir + '/' + ARCHIVE_SUBDIR,
    quietFrom: c.quietFrom || null, quietTo: c.quietTo || null, // I6: none by default
    closeQuietMs: Number(c.closeQuietMs) > 0 ? Number(c.closeQuietMs) : null, // LP (2.7, #66): `--close` refuses while the owner typed less than this ago (default in the generator: 180 s)
    markerFound: existsSync(resolve(root, KAIF_JSON)),
    session: sessionName(root), // OW4 (2.8): the calling session — named in every call and in the page window's title
  };
}

// ── C3: normalisation and hash — one function for both sides ──────────────────────────────────
export function normalize(s) {
  return stripBom(s)
    .replace(/\r\n?/g, '\n')       // CRLF and lone CR → LF
    .replace(/[ \t\n]+$/, '')      // trailing whitespace garbage and blank lines
    + '\n';                        // exactly one final newline
}
export const bodyHash = (s) => createHash('sha256').update(normalize(s), 'utf8').digest('hex');
export const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ── I22/I23: provenance in two representations ────────────────────────────────────────────────
export function provenance(now = new Date(), language = DEFAULT_LANGUAGE) {
  const T = texts(language);
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -now.getTimezoneOffset();
  const off = (offMin >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(offMin) / 60)) + ':' + pad(Math.abs(offMin) % 60);
  const atHuman = now.getDate() + ' ' + T.months[now.getMonth()] + ' ' + now.getFullYear() + ', ' +
    pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' (' + off + ')'; // local time in words — for the human
  return { at: now.toISOString(), atHuman };
}

// ── I6: quiet hours — the window may cross midnight ───────────────────────────────────────────
export function inQuietHours(now = new Date(), from = null, to = null) {
  if (!from || !to) return false; // no window — no quiet hours
  const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const n = now.getHours() * 60 + now.getMinutes();
  const f = mins(from), t = mins(to);
  return f <= t ? (n >= f && n < t) : (n >= f || n < t); // second branch — across midnight
}

// ── Document metadata (name contract): a fenced block at the head of the document ─────────────
// ```owner-review\n title: … \n kind: … \n artifacts:\n  - id: …\n    target: …\n    format: …\n    body_file: …\n```
export function parseMetaBlock(md) {
  const m = normalize(md).match(/^```owner-review\n([\s\S]*?)\n```/m);
  if (!m) return null;
  const meta = { artifacts: [] };
  let cur = null;
  for (const raw of m[1].split('\n')) {
    const art = raw.match(/^\s*-\s+id:\s*(.+)$/u);
    if (art) { cur = { id: art[1].trim() }; meta.artifacts.push(cur); continue; }
    const kv = raw.match(/^(\s*)([\w_]+):\s*(.*)$/u);
    if (!kv) continue;
    if (kv[1].length > 0 && cur) cur[kv[2]] = kv[3].trim();
    else if (kv[2] !== 'artifacts') meta[kv[2]] = kv[3].trim();
  }
  return meta;
}

// ── Document status (C4 rule 4: closedness is the STATUS, not the fullness of fields) ─────────
// The marker is looked for ONLY in the status line (markup, never a bare word); a document is
// LIVE by default — only explicit markup without a negation closes it (bugs/70 of the origin).
const STATUS_LINE_RE = new RegExp('^\\s*>?\\s*\\*{0,2}(?:' + PARSER.statusLabels + ')\\s*:?\\*{0,2}\\s*(.*)$', 'imu');
const STATUS_CLOSED_RE = new RegExp(PARSER.statusClosed, 'iu');
const STATUS_WAITING_RE = new RegExp(PARSER.statusWaiting, 'iu');
const STATUS_NEGATION_RE = new RegExp(PARSER.statusNegation, 'iu');
const STATUS_CLOSED_WORD_RE = new RegExp(PARSER.statusClosedWord, 'iu');   // CP (2.9, #109 · #121 R3)
const STATUS_PENDING_RE = new RegExp(PARSER.statusPending, 'iu');           // the light re-judge of epic CP, F5
const WAITING_NEGATED_RE = new RegExp(PARSER.statusWaitingNegation + '\\s+$', 'iu');
// a waiting marker counts unless a negation stands right before it («no longer awaiting» — the document is closed)
function waitsUnnegated(line) {
  const re = new RegExp(PARSER.statusWaiting, 'giu');
  for (let m; (m = re.exec(line));) if (!WAITING_NEGATED_RE.test(line.slice(Math.max(0, m.index - 24), m.index))) return true;
  return false;
}

// OW3 (2.8, origin issue #86): the whole STATUS BLOCK — the status line and the quote lines that continue it — says the answers await
// application. A field marks it on a continuation line under a ticked "answered" (its S1: an 11-day-old decision stayed invisible);
// the canonical sign (every question answered, the status not closed) misses that form, so the debt view reads both.
const AWAITING_APPLICATION_RE = new RegExp(PARSER.awaitingApplication, 'iu');
export function statusBlockAwaitsApplication(md) {
  const lines = normalize(md).split('\n').slice(0, HEAD_LINES);
  const at = lines.findIndex((l) => STATUS_LINE_RE.test(l));
  if (at < 0) return false;
  const block = [lines[at]];
  for (let i = at + 1; i < lines.length && /^\s*>/.test(lines[i]) && !STATUS_LINE_RE.test(lines[i]) && !/^\s*>\s*\*{0,2}[\p{L} ]{2,30}:\*{0,2}/u.test(lines[i].replace(/^\s*>\s*·\s*/, '> ')); i++) block.push(lines[i]);
  return AWAITING_APPLICATION_RE.test(block.join(' '));
}
export function docStatus(md) {
  const head = normalize(md).split('\n').slice(0, HEAD_LINES).join('\n');
  const m = head.match(STATUS_LINE_RE);
  if (!m) return 'none';                                 // no status line — the document is LIVE
  const line = m[1];
  // an explicit closing word FIRST outranks an explanation after it (#109) — but not an explicit, unnegated WAITING marker or a NOT-YET
  // mark on the same line: a partial status «closed Q1; Q2 awaits an answer / is not yet answered» still waits (the light judges of epic
  // CP, F5 and its re-judge); «closed — no longer awaiting an answer» closes
  if (STATUS_CLOSED_WORD_RE.test(line)) return waitsUnnegated(line) || STATUS_PENDING_RE.test(line) ? 'waiting' : 'closed';
  if (STATUS_NEGATION_RE.test(line)) return 'waiting';   // negation outranks the tick
  if (STATUS_CLOSED_RE.test(line)) return 'closed';
  if (STATUS_WAITING_RE.test(line)) return 'waiting';
  return 'none';
}

// ── C4: parsing the questions of a living text ────────────────────────────────────────────────
const L = PARSER.letters;
const QUESTION_HEADING_RE = new RegExp('^(#{2,4})\\s+((?:' + PARSER.questionPrefixes + ')\\d+)\\.?\\s*(.*)$', 'u');
// the modifier bracket allows ONE level of nesting: "(follow-up, 8 August 2026, 06:48 (+03:00))"
const ANSWER_LABEL_RE = new RegExp('^\\s*\\*{0,2}(?:' + PARSER.answerLabels + ')\\s*(?:\\((?<mod>(?:[^()]|\\([^()]*\\))*)\\))?\\s*:\\*{0,2}\\s*(?<rest>.*)$', 'iu');
const COUNTER_LABEL_RE = new RegExp(PARSER.counterQuestion, 'iu');      // rule 2: a counter-question is NOT an answer
const COMMENT_LABEL_RE = new RegExp('^\\s*\\*{0,2}(?:' + PARSER.commentLabels + ')', 'iu');
const TARGET_LABEL_RE = new RegExp('^\\s*\\*{0,2}(?:' + PARSER.targetLabels + ')\\s*:?\\*{0,2}\\s*(.*)$', 'iu');
// CP (2.9, origin ideas/31 p. 28): the label may close its own bold before the letter — «**Agent's recommendation:** A» was read as none
const RECOMMEND_RE = new RegExp('(?:' + PARSER.recommendLabels + ')(?:\\s|[:—–-]|\\*){0,6}([' + L + '])(?![\\p{L}\\d])', 'u');
// FIRST legal option form — a list item `- **A)** …` (a note in brackets after the letter is legal). 2.9, epic CP (origin issue #127): the
// list form speaks the TABLE form's dictionary — `- **A:**`, `- **A.**`, `- **A (note):**` and a bold letter alone `- **A** — …` are options too. A field project's live corpus
// was written that way: 169 of 1941 options recognised, 47 of 107 interviews invisible. The donor contours' recon recorded the fate in
// advance ("a richer letter rule — at the first mismatch of the count", origin researches/17 §4 p. 4); #127 is that mismatch.
export const OPTION_START_RE = new RegExp('^\\s*-\\s+\\*\\*([' + L + '])(?:\\)|[:.](?![\\p{L}\\d])|\\s*\\([^)]*\\)\\s*[:.)]?|(?=\\*\\*))', 'u');
// A list item that OPENS with a bold single letter — what the author meant as an option, whether or not the form is recognised. The
// door counts these against the parsed options: a letter the parse did not see is named, never lost in silence (#127).
const AUTHORED_LETTER_RE = new RegExp('^\\s*-\\s+\\*\\*\\s*([' + L + '])(?![\\p{L}\\d])', 'u');
// (light judge of epic CP, F4) an option written as a PARAGRAPH — `**C.** three`, the #51 form, no list dash — is a letter authored
// too: two list options plus a paragraph C used to show A and B and lose C in silence. Only a letter with its mark (. ) :) counts, so
// prose that merely opens with a bold letter ("**B** costs more") is not taken for an option. The re-judge: the list form's dash
// (`**C** — three`, the bold closed before a dash) is a mark too.
const AUTHORED_PARA_LETTER_RE = new RegExp('^\\s*\\*\\*\\s*([' + L + '])\\s*(?:[.):]|\\*\\*\\s*[\\u2014\\u2013-](?=\\s))', 'u');
const authoredLetter = (l) => AUTHORED_LETTER_RE.test(l) || AUTHORED_PARA_LETTER_RE.test(l);
// SECOND legal form — a TABLE ROW `| **A** | … |` (bugs/51 of the origin): a one-letter cell (bold
// optional, dot/bracket optional, a bracketed note on either side of the bold) + at least one
// content cell to the right. A header row and the `---` separator do not match and drop out.
export const OPTION_ROW_RE = new RegExp('^\\s*\\|\\s*\\*{0,2}([' + L + '])[.)]?(?:\\s*\\([^)]*\\))?\\*{0,2}(?:\\s*\\([^)]*\\))?\\s*\\|(.+)$', 'u');
const FREE_FIELD_RE = new RegExp(PARSER.freeFieldMarker, 'u');
const isOptionLine = (line) => OPTION_START_RE.test(line) || OPTION_ROW_RE.test(line);
// Light judge of epic NT, F1, and its twins (2.9): text the owner typed into a multi-line field — the own answer (NT1, #139) and the
// comments, which were textareas before it — lands as LINES of the file, and a continuation line that reads as structure was read back
// as structure: a fence swallowed the rest of the file, a heading made a phantom question, a rule, an option, a table row or a label
// cut the answer. The writer puts a markdown backslash escape before such a line (after its indent) and the reader takes it off; a line
// the owner himself began with a backslash before structure gets one more, so the round trip returns exactly what he typed.
// [TESTED: 2026-10-16 16:09 +03:00 · contour selftest case «NT F1» (twelve forms + a multi-line comment; Q2 kept, read back as typed);
//  tools/sandbox/probes/nt1-contour-mutants.mjs M3 (no escape) and M4 (no unescape) red exactly on it]
// Court RL 2.9, E-F1: a STATUS line is structure too — in a document with no status line of its own, an answer line «Status: done»
// within the head closed the whole document and hid its open questions; E-F2: the reader judges a line without the provenance mark the
// writer appends to the last line («\--- <!-- owner-review … -->» used to read back with its backslash).
const STRUCTURE_LINE_RES = [/^\s*(```|~~~)/, /^#{1,6}\s/, /^---\s*$/, /^\s*\|/, OPTION_START_RE, AUTHORED_LETTER_RE,
  AUTHORED_PARA_LETTER_RE, ANSWER_LABEL_RE, TARGET_LABEL_RE, COMMENT_LABEL_RE, STATUS_LINE_RE];
const ESCAPED_RE = /^(\s*)\\/;
const dropEscape = (l) => l.replace(ESCAPED_RE, (m, indent) => indent);
const dropMark = (l) => l.replace(/\s*<!--[\s\S]*?-->\s*$/, '');
const readsAsStructure = (l) => STRUCTURE_LINE_RES.some((re) => re.test(l)) || (ESCAPED_RE.test(l) && readsAsStructure(dropEscape(l)));
const escapeStructure = (l) => (readsAsStructure(l) ? l.replace(/^\s*/, (indent) => indent + '\\') : l);
export const unescapeStructure = (l) => (ESCAPED_RE.test(l) && readsAsStructure(dropMark(dropEscape(l))) ? dropEscape(l) : l);
// the owner's text as lines of the file: trailing blanks trimmed, every line after the first escaped where it reads as structure; blank
// lines are dropped (an answer is read back as a paragraph up to a blank line) unless `keepBlank` — a comment is never read back
export const ownerTextLines = (text, { keepBlank = false } = {}) => {
  const ls = String(text).split(/\r?\n/).map((s) => s.replace(/\s+$/, ''));
  while (ls.length && !ls[0].trim()) ls.shift();
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  const kept = keepBlank ? ls : ls.filter((s) => s.trim());
  return kept.length ? kept.map((s, i) => (i ? escapeStructure(s) : s)) : [''];
};

export function parseQuestions(md) {
  const lines = normalize(md).split('\n');
  const closed = docStatus(md) === 'closed';
  const questions = [];
  let cur = null, curLevel = 0, inFence = false;
  const flush = () => { if (cur) { finishQuestion(cur, closed); questions.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; if (cur) cur.body.push(line); continue; }
    if (inFence) { if (cur) cur.body.push(line); continue; }
    const qh = line.match(QUESTION_HEADING_RE);
    const anyHeading = line.match(/^(#{1,6})\s/);
    if (/^---\s*$/.test(line)) { flush(); continue; }             // rule 1: a rule closes the block
    if (qh) { flush(); cur = { id: qh[2], title: qh[3].trim(), line: i + 1, body: [] }; curLevel = qh[1].length; continue; }
    if (anyHeading && anyHeading[1].length <= curLevel) { flush(); continue; }
    if (cur) cur.body.push(line);
  }
  flush();
  return questions;
}

// Option tables are parsed BEFORE the line loop — one decision for the whole block, so the radios
// and the card prose see the same thing (rows that became options leave the prose). The threshold
// "≥ 2 option rows in one contiguous block" filters out a data table whose first cell is a letter.
function scanOptionTables(body) {
  const lines = new Set();
  const options = [];
  let run = [];
  const flushRun = () => {
    const rows = run.filter((r) => r.m);
    if (rows.length >= MIN_OPTIONS) {
      for (const r of run) lines.add(r.j);                    // the whole block, header and separator included
      for (const r of rows) {
        const cells = r.m[2].replace(/\|\s*$/, '').split('|').map((c) => c.trim()).filter(Boolean);
        options.push({ letter: r.m[1], lines: [], row: cells });
      }
    }
    run = [];
  };
  for (let j = 0; j < body.length; j++) {
    if (/^\s*\|/.test(body[j])) { run.push({ j, m: body[j].match(OPTION_ROW_RE) }); continue; }
    flushRun();
  }
  flushRun();
  return { lines, options };
}

function finishQuestion(q, docClosed) {
  const table = scanOptionTables(q.body);
  q.optionTableLines = table.lines;   // the page card reads it too — one parse for all
  q.options = [...table.options];
  q.answers = [];
  q.target = null;
  q.freeField = q.body.some((l) => FREE_FIELD_RE.test(l)); // spec §1: a declared free field
  let curOpt = null;
  let targetOpen = false;
  for (let j = 0; j < q.body.length; j++) {
    const line = q.body[j];
    const opt = line.match(OPTION_START_RE);
    if (opt) { curOpt = { letter: opt[1], lines: [line] }; q.options.push(curOpt); continue; } // rule 3: multi-line
    if (q.optionTableLines.has(j)) { curOpt = null; continue; }
    if (curOpt && /^\s{2,}\S/.test(line)) { curOpt.lines.push(line); continue; }
    curOpt = null;
    const t = line.match(TARGET_LABEL_RE);                 // several addressees accumulate, never overwrite
    if (t) { const v = t[1].trim(); q.target = q.target ? q.target + '\n' + v : v; targetOpen = true; continue; }
    if (targetOpen && /^\s{2,}\S/.test(line)) { q.target += '\n' + line.trim(); continue; }
    targetOpen = false;
    const a = line.match(ANSWER_LABEL_RE);
    if (a && !COUNTER_LABEL_RE.test(line)) {
      // 2.9, epic CP (origin #123, #127 p. 5): the answer is a PARAGRAPH — the label's rest and every line below it up to a blank line
      // or the next label (an owner who wraps his answer was read by its first line only); an HTML comment is cut before the answer
      // is judged — a comment under an empty label ("<!-- write here -->") made a live question look answered.
      const noComment = (t) => t.replace(/<!--[\s\S]*?-->/g, '').trim();
      // a label bolded TOGETHER with the answer ("**Answer: A — the choice.** more") leaves the rest with one unpaired "**" — dropped
      const rest0 = noComment(a.groups.rest || '');
      const rest = /^\s*\*\*/.test(line) && !/:\*\*/.test(line) && (rest0.match(/\*\*/g) || []).length % 2 === 1 ? rest0.replace('**', '') : rest0;
      const parts = [rest].filter(Boolean);
      const lines = [j];   // court RL 2.9, E-F3: the body lines this answer took — the page card leaves them out of the question's prose
      for (let k = j + 1; k < q.body.length; k++) {
        const raw = q.body[k];
        if (ANSWER_LABEL_RE.test(raw) || TARGET_LABEL_RE.test(raw) || isOptionLine(raw) || COMMENT_LABEL_RE.test(raw)) break; // an owner's comment is NOT the answer
        const nl = noComment(unescapeStructure(raw)); // NT F1: a continuation line escaped by the writer reads back as the owner typed it
        if (!raw.trim()) { if (parts.length) break; continue; } // a blank line ends the answer — or precedes it
        if (nl) { parts.push(nl); lines.push(k); }
      }
      q.answers.push({ line: j, lines, text: parts.join('\n'), followUp: Boolean(a.groups.mod) });
    }
  }
  for (const o of q.options) {
    if (o.row) { // table form: the LETTER MUST STAY in the option text (the human picks by name)
      o.label = o.letter + ')';
      o.text = '**' + o.letter + ')** ' + o.row.join(' — ');
      continue;
    }
    const full = o.lines.join('\n');
    const label = full.match(/\*\*([^*]+)\*\*/u);
    o.label = label ? label[1].trim() : o.letter + ')';
    o.text = full.replace(/^\s*-\s+/, '');
  }
  // AQ (2.7): where the options START — the archaeology attestation lives ABOVE this line, between
  // the heading and the first option (a question with no options keeps its whole body as the zone).
  q.firstOptionLine = -1;
  for (let j = 0; j < q.body.length; j++) {
    if (!q.optionTableLines.has(j) && !OPTION_START_RE.test(q.body[j])) continue;
    q.firstOptionLine = j; break;
  }
  // the recommended letter is taken from the prose OUTSIDE the options and hung on the option itself
  const proseLines = q.body.filter((l, j) => !q.optionTableLines.has(j) && !OPTION_START_RE.test(l));
  const rec = proseLines.join('\n').match(RECOMMEND_RE);
  q.recommended = rec && q.options.some((o) => o.letter === rec[1]) ? rec[1] : null;
  q.answered = docClosed || q.answers.some((a) => a.text); // rule 4
}

// ── AQ (2.7, origin issue #70): ARCHAEOLOGY — the question is a CLAIM, and the claim is verified ──
// A question to the owner says "this is not settled yet". Nothing verified it: the field brought one
// owner the same question thirteen times, once 44 days after he had answered it ("you are asking ME?
// did you look into GOAL.md, smart guy, before asking?"). So every LIVE question of a document dated
// on or after the threshold carries an attestation of the search that was actually run, between the
// question heading and its first option:
//   <!-- archaeology: grep -rniE "<nouns>" interviews/ GOAL.md MASTER_PLAN.md plans/ → N hits · read: <files|none> · prior: <none | "<prior answer>" + address> -->
// The axis judges FORWARD, by the document's header date (the `Created` line when there is one, else
// the first ISO date of the head): the field's old interviews must never turn red, and a document
// without a date is not provably new. Exempt: answered questions, documents with no questions, and a
// declared exception `<!-- archaeology: n/a — <reason> -->` (a naming question, the taste class).
// The axis does not promise the search FINDS anything — it promises the agent searched and recorded
// with what; `N = 0` is a legal, honest attestation. What it does refuse is `N > 0` with `prior: none`:
// hits were found and the prior answer is not named (legal: `prior: unrelated — <why>`).
export const ARCHAEOLOGY_SINCE = '2026-09-18';       // the day the door was shipped; older documents stay silent
export const ARCHAEOLOGY_PATHS = 'interviews/ GOAL.md MASTER_PLAN.md plans/';
export const ARCHAEOLOGY_MIN_LETTERS = 4;            // a searchable word of the heading — 4+ letters, machine, no judgement
export const ARCHAEOLOGY_MIN_LETTERS_FALLBACK = 3;   // a heading of short words only still gets a command
export const ARCHAEOLOGY_MAX_WORDS = 6;              // the printed command stays one readable line
// A word of 6+ letters is searched by its STEM — the last two characters are cut. Languages that
// inflect (the origin's own documents are Russian) would otherwise search for one case form and miss
// the prior answer written in another; the cut costs extra hits, and an extra hit only asks the agent
// to read and say `prior: unrelated — <why>`, while a missed hit is exactly the defect of issue #70.
// A stem never gets shorter than ARCHAEOLOGY_STEM_MIN. The first functional run cut two six-letter words
// down to four characters, and that command returned 895 hits over the origin's own tree; five characters
// keep the inflections and cost less (measured on the same question, same tree: 895 → 844 hits, 135 files).
// The axis does not promise a NARROW command — it promises the search happened and the attestation says
// what was read; a heading whose words are the project's own subject will always hit a lot.
export const ARCHAEOLOGY_STEM_FROM = 6;
export const ARCHAEOLOGY_STEM_CUT = 2;
export const ARCHAEOLOGY_STEM_MIN = 5;
const ARCHAEOLOGY_RE = /<!--\s*archaeology:([\s\S]*?)-->/u;
const ARCHAEOLOGY_NA_RE = /<!--\s*archaeology:\s*n\/a\s*[-—–:]*\s*\S/u;
const ARCHAEOLOGY_HITS_RE = /(?:→|->)\s*(\d+)\s*hits/iu;
const ARCHAEOLOGY_PRIOR_RE = /prior:\s*([\s\S]*)$/iu;
const ARCHAEOLOGY_PRIOR_NONE_RE = /^\s*none(?![\p{L}\d])/iu;
const ARCHAEOLOGY_READ_NONE_RE = /read:\s*none(?![\p{L}\d])/iu;   // OW5 (2.8, #74): hits found and NOTHING read — refused
const ARCHAEOLOGY_PLACEHOLDER_RE = /<[^<>]*>/u;   // judge OW10 H3: a `<…>` of the template left unfilled is not an attestation
const STOP_WORDS = new Set(String(PARSER.archaeologyStopWords || '').split('|').filter(Boolean));

/** The document's header date: the `Created` line of the head when present, else its first ISO date. */
export function headerDate(md) {
  const head = normalize(md).split('\n').slice(0, HEAD_LINES);
  const createdRe = new RegExp('^\\s*>?\\s*\\*{0,2}(?:' + PARSER.createdLabels + ')', 'iu');
  for (const line of head) {                            // the creation date OUTRANKS an answer date above it
    if (!createdRe.test(line)) continue;
    const m = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (m) return m[1];
  }
  return (head.join('\n').match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || null;
}

/** The searchable words of a question heading — MACHINE: letters only, 4+ long, stop words dropped. */
export function archaeologyWords(title) {
  const bare = String(title || '').replace(/`[^`]*`/gu, ' ').replace(/[*_]/gu, ' ');
  const pick = (min) => {
    const out = [];
    for (const w of bare.match(new RegExp('[\\p{L}]{' + min + ',}', 'gu')) || []) {
      const t = w.toLowerCase();
      if (STOP_WORDS.has(t)) continue;
      const stem = t.length >= ARCHAEOLOGY_STEM_FROM
        ? t.slice(0, Math.max(ARCHAEOLOGY_STEM_MIN, t.length - ARCHAEOLOGY_STEM_CUT)) : t;
      if (out.includes(stem)) continue;
      out.push(stem);
    }
    return out;
  };
  const words = pick(ARCHAEOLOGY_MIN_LETTERS);
  return (words.length ? words : pick(ARCHAEOLOGY_MIN_LETTERS_FALLBACK)).slice(0, ARCHAEOLOGY_MAX_WORDS);
}

/** The READY command for a question heading — the door prints it, the agent copies and runs it. The UTF-8 locale is part of the command:
 *  Git Bash's `grep -i` without it misses a capital Cyrillic letter (origin issue #74). The door can also search itself — archaeologySearch. */
export function archaeologyGrep(title) {
  const words = archaeologyWords(title);
  return words.length ? 'LC_ALL=C.UTF-8 grep -rniE "' + words.join('|') + '" ' + ARCHAEOLOGY_PATHS : null;
}
// OW5 (2.8, origin issues #74 · #82): the door SEARCHES itself — in Node, Unicode-aware and case-insensitive, so no shell and no locale
// decides whether a capital Cyrillic letter is found. Same words, same paths as the printed command; hits are LINES, like `grep -rn`.
// [TESTED: 2026-09-25 19:07–19:10 · selftest 83 · s22 E on the deployed copy (red on v2.7) · mutant «search case-sensitive» red exactly on its
//  case · on the origin in Git Bash without a locale the door found 473 lines = grep with LC_ALL=C.UTF-8, 30 more than a bare grep -i;
//  report testcases/reports/2026-09-25_ow5-archaeology-any-transport.md]
export function archaeologySearch(root, words, paths = ARCHAEOLOGY_PATHS) {
  const out = { hits: 0, files: [], lines: [] };
  if (!words.length) return out;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'iu');
  const files = [];
  const walk = (p) => { if (!existsSync(p)) return; if (statSync(p).isDirectory()) { for (const f of readdirSync(p).sort()) walk(join(p, f)); } else if (/\.md$/i.test(p)) files.push(p); };
  for (const rel of paths.split(/\s+/).filter(Boolean)) walk(resolve(root, rel));
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    let n = 0;
    lines.forEach((l, i) => { if (re.test(l)) { n++; out.lines.push({ file: f, line: i + 1, text: l.trim().slice(0, 100) }); } });
    if (n) { out.hits += n; out.files.push(f); }
  }
  return out;
}

/** The attestation of ONE question: what stands between its heading and its first option. */
export function archaeologyOf(q) {
  const body = q.body || [];
  const zone = (q.firstOptionLine >= 0 ? body.slice(0, q.firstOptionLine) : body).join('\n');
  if (ARCHAEOLOGY_NA_RE.test(zone)) return { exempt: true };
  const m = zone.match(ARCHAEOLOGY_RE);
  if (!m) return { present: false };
  const hits = m[1].match(ARCHAEOLOGY_HITS_RE);
  const prior = m[1].match(ARCHAEOLOGY_PRIOR_RE);
  if (!hits || !prior) return { present: true, formOk: false };
  if (ARCHAEOLOGY_PLACEHOLDER_RE.test(m[1])) return { present: true, formOk: false, placeholder: true }; // the search's ready line pasted unfilled
  return { present: true, formOk: true, hits: Number(hits[1]), priorNone: ARCHAEOLOGY_PRIOR_NONE_RE.test(prior[1]), readNone: ARCHAEOLOGY_READ_NONE_RE.test(m[1]) };
}

/**
 * The archaeology of a whole document: judged only FORWARD by the header date. Problems are DATA
 * (the shipped door prints them in English, the origin's guard in the owner's language) — one parse
 * for both sides, so the two never hold two truths about one question.
 */
export function archaeology(md) {
  const date = headerDate(md);
  const out = { judged: Boolean(date) && date >= ARCHAEOLOGY_SINCE, since: ARCHAEOLOGY_SINCE,
    headerDate: date, live: 0, attested: 0, exempt: 0, problems: [] };
  const live = parseQuestions(md).filter((q) => !q.answered);
  out.live = live.length;
  if (!out.judged) return out;
  for (const q of live) {
    const grep = archaeologyGrep(q.title);
    const a = archaeologyOf(q);
    if (a.exempt) { out.exempt++; continue; }
    if (!a.present) {
      if (grep) out.problems.push({ id: q.id, kind: 'missing', grep });
      else out.exempt++;                                 // no searchable word in the heading — no command to print
      continue;
    }
    if (!a.formOk) { out.problems.push({ id: q.id, kind: a.placeholder ? 'placeholder' : 'malformed', grep }); continue; }
    out.attested++;
    if (a.hits > 0 && a.readNone) out.problems.push({ id: q.id, kind: 'hits-unread', hits: a.hits, grep });   // OW5 (#74)
    else if (a.hits > 0 && a.priorNone) out.problems.push({ id: q.id, kind: 'hits-without-prior', hits: a.hits, grep });
  }
  return out;
}

/** The problem lines of the archaeology axis, in the machinery's own language (like the #51 refusal). */
function archaeologyProblems(md) {
  const ARCH = (grep) => '<!-- archaeology: ' + (grep || 'grep -rniE "<nouns>" ' + ARCHAEOLOGY_PATHS)
    + ' → N hits · read: <files|none> · prior: <none | "<prior answer>" + address> -->';
  return archaeology(md).problems.map((p) => {
    if (p.kind === 'placeholder')
      return p.id + ': the archaeology line still carries the template\'s <…> placeholders — fill what you READ (files or `none`) and the prior'
        + ' answer (`none`, the prior answer with its address, or `unrelated — <why>`); an unfilled line attests nothing.';
    if (p.kind === 'hits-unread')
      return p.id + ': archaeology says ' + p.hits + ' hits and `read: none` — the search FOUND something and nothing was read. Read the hits'
        + ' (the door searches for you: review.mjs --search "<the question>") and name what you read, then the prior answer or `prior: unrelated — <why>`.';
    if (p.kind === 'hits-without-prior')
      return p.id + ': archaeology says ' + p.hits + ' hits and `prior: none` — the search FOUND something and no prior'
        + ' answer is named. Read the hits and name the prior answer with its address, or write `prior: unrelated — <why>`'
        + ' (origin issue #70: the same question came back to one owner thirteen times).';
    if (p.kind === 'malformed')
      return p.id + ': the archaeology line is not in the form — it must carry `→ N hits` and `prior: …`: ' + ARCH(p.grep);
    return p.id + ': no archaeology line — a question to the owner CLAIMS "this is not settled yet", and the claim is'
      + ' unverified. Run the search:  ' + p.grep + '  — read the hits, then put the attestation between the question'
      + ' heading and its first option: ' + ARCH(p.grep)
      + ' (a prior answer found → drop the question and carry the decision over, or reformulate it as "the prior answer'
      + ' was X; Y changed"). Declared exception: <!-- archaeology: n/a — <reason> -->.';
  });
}

// ── Spec §2: PRE-FLIGHT — the form of every open question, judged before any page opens ───────
/**
 * Problems of a document's question form. Empty = the page may open. Each problem names the
 * question and the fix (the #51 defect: options typed as paragraphs `**A. …**` are NOT options).
 * Answered questions are exempt (they render grey, no radios needed); a declared free field is legal.
 */
// ── 2.9, epic CP (origin issue #124): the THIRD axis of the door — the question is SELF-CONTAINED ────────────────
// The canon says "the subject of the decision lives INSIDE the question; a reference INSTEAD of the content is a defect, guarded
// mechanically" — and the shipped door did not guard it (the executor lived only in the origin's wrapper; a field owner's standing rule,
// quoted verbatim in the issue: write the proposal right in the question, he will not scroll a long document for "that formula"). Every LIVE question's
// heading and stem (the lines before its first option or answer field) is read: a backward or sideways reference refuses the door;
// the addressee and origin lines carry legal addresses and are skipped, HTML comments are cut; the declared exception is
// <!-- ref-ok: <reason> --> on the line (an empty reason is itself a violation). Judged FORWARD by the header date, like archaeology.
export const REFERENCES_SINCE = '2026-09-28';        // the day the axis was shipped; older documents stay silent
const REF_BACK_RE = new RegExp(PARSER.refBack, 'iu');
const REF_OK_RE = /<!--\s*ref-ok:\s*([\s\S]*?)\s*-->/u;
const ORIGIN_LABEL_RE = new RegExp('^\\s*[>*\\s]*(?:' + PARSER.originLabels + ')\\s*:', 'iu');
export function referenceProblems(md) {
  const date = headerDate(md);
  if (!date || date < REFERENCES_SINCE) return [];
  const out = [];
  for (const q of parseQuestions(md)) {
    if (q.answered || q.freeField) continue;
    const answerAt = q.answers.length ? q.answers[0].line : q.body.length;
    const end = q.firstOptionLine >= 0 ? Math.min(q.firstOptionLine, answerAt) : answerAt;
    const lines = [q.title, ...q.body.slice(0, end)];
    for (const line of lines) {
      if (TARGET_LABEL_RE.test(line) || ORIGIN_LABEL_RE.test(line)) continue;
      const ok = REF_OK_RE.exec(line);
      if (ok) { if (!ok[1].trim()) out.push(q.id + ': a <!-- ref-ok: --> marker without a reason declares nothing — name why the reference stays: ' + line.trim().slice(0, 80)); continue; }
      const clean = line.replace(/<!--[\s\S]*?-->/g, '');
      if (REF_BACK_RE.test(clean))
        out.push(q.id + ': the question sends the owner OUTSIDE itself for its own content — «' + clean.trim().slice(0, 90) + '». Put the content'
          + ' right in the question (the formula, the list, the numbers — a reference may stand NEXT to it, never instead of it);'
          + ' declared exception on the line: <!-- ref-ok: <reason> -->');
    }
  }
  return out;
}

export function preflight(md) {
  const problems = [];
  for (const q of parseQuestions(md)) {
    if (q.answered || q.freeField) continue;
    const authored = q.body.filter(authoredLetter).length;   // CP (2.9, #127): a letter written but not parsed is named
    const parsedList = q.options.filter((o) => !o.row).length;
    if (authored > parsedList)
      problems.push(q.id + ': letters authored ' + authored + ', recognised ' + parsedList + ' — an option the page would not show; write it'
        + ' - **A)** · - **A:** · - **A.** · - **A (note):** (or a table row | **A** | … |): '
        + q.body.filter((l) => authoredLetter(l) && !OPTION_START_RE.test(l)).map((l) => l.trim().slice(0, 40)).join(' | '));
    if (q.options.length < MIN_OPTIONS)
      problems.push(q.id + ': ' + q.options.length + ' option(s) in list form and no declared free field' +
        ' — the page would open without radio buttons; fix the form: - **A)** … (or a table row | **A** | … |),' +
        ' or declare a free field: <!-- questions-guard:no-scenario <reason> -->');
  }
  // AQ (2.7, origin issue #70): the SECOND axis of the same door — the question's archaeology. A free
  // field exempts the FORM, never the claim: a free-form question to the owner is a claim too.
  problems.push(...archaeologyProblems(md));
  problems.push(...referenceProblems(md));   // CP (2.9, #124): the third axis — the question is self-contained
  return problems;
}

// ── QL1 (2.7, origin issue #56): the form check WITHOUT a page — one parse for `--check` and for the show ──
// A candidate block is a level 2–4 heading that is a recognised question OR looks like one: a numbered
// or LETTERED heading ending with `?` (`## 2. …?`, `## A. …?`, `### A1. …?` — the #56 document used letters,
// court of 2.7, finding A-F1), or `Question <n>` / its localized word. A letter heading WITHOUT `?` stays out:
// field interviews use `### A.` for option sections and `## A.` for chapters (11 such headings measured in two
// deployments, none ending with `?`). An unrecognised candidate is the #56 class: the page would open WITHOUT
// that question and nobody would notice until the owner did.
const CANDIDATE_Q_RE = new RegExp('^#{2,4}\\s+(?:(?:\\d+[.)]?|\\p{L}\\d*[.)])\\s+.*\\?\\s*$|(?:' + PARSER.questionWords + ')\\s*\\d+)', 'iu');
export function checkForm(md) {
  const lines = normalize(md).split('\n');
  const questions = parseQuestions(md);
  const known = new Set(questions.map((q) => q.line));
  const candidates = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    if (known.has(i + 1)) candidates.push({ line: i + 1, text: line.trim(), recognised: true });
    else if (CANDIDATE_Q_RE.test(line)) candidates.push({ line: i + 1, text: line.trim(), recognised: false });
  });
  return { blocks: candidates.length, questions, recognised: questions.map((q) => q.id),
    unrecognised: candidates.filter((c) => !c.recognised), problems: preflight(md),
    archaeology: archaeology(md) }; // AQ (2.7): the door says out loud what it judged and what it did not
}

// ── P8 + I24: markdown mini-renderer (escaping is the FIRST action) ───────────────────────────
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
    // a single star INSIDE bold is text ("kaif-*" in a bold phase list — origin #123, interview 018 of the origin): only a pair closes
    .replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\p{L}\d])\*([^*]+)\*(?!\*)/gu, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
// 2.9, epic CP (origin #123): the owner's own answer shown on the page keeps its own markup (bold, code) — escaped first, then inline
export const renderInline = (s) => inline(escapeHtml(s));
export function renderMd(md) {
  const src = normalize(md).split('\n');
  const out = [];
  let inFence = false, fenceBuf = [], listOpen = false, quoteOpen = false, tableBuf = [];
  // 2.9, epic CP (origin #123): the unit of markdown is the PARAGRAPH, not the line — a hard-wrapped paragraph came out as one <p> per
  // line and a bold span across the wrap stayed raw "**", which also made the page's own self-check refuse a legal wrapped option.
  // Lines of a paragraph, of a list item (its continuation lines — CommonMark "lazy continuation") and of a quote paragraph are
  // collected and joined with a newline before inline markup; a blank line, a heading, a rule, a table and a fence end them.
  let para = [], item = null, qpara = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(escapeHtml(para.join('\n'))) + '</p>'); para = []; } };
  const flushItem = () => { if (item) { out.push('<li>' + inline(escapeHtml(item.join('\n'))) + '</li>'); item = null; } };
  const flushQuotePara = () => { if (qpara.length) { out.push('<p>' + inline(escapeHtml(qpara.join('\n'))) + '</p>'); qpara = []; } };
  const closeList = () => { flushItem(); if (listOpen) { out.push('</ul>'); listOpen = false; } };
  const closeQuote = () => { flushQuotePara(); if (quoteOpen) { out.push('</blockquote>'); quoteOpen = false; } };
  const closeAll = () => { flushPara(); closeList(); closeQuote(); };
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
    let html = '<table>';
    rows.forEach((cells, ri) => {
      if (ri === 1 && cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
      const tag = ri === 0 ? 'th' : 'td';
      html += '<tr>' + cells.map((c) => '<' + tag + '>' + inline(escapeHtml(c)) + '</' + tag + '>').join('') + '</tr>';
    });
    out.push(html + '</table>');
    tableBuf = [];
  };
  for (const raw of src) {
    if (/^\s*```/.test(raw)) {
      if (!inFence) closeAll();
      if (inFence) { out.push('<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>'); fenceBuf = []; }
      inFence = !inFence;
      continue;
    }
    if (inFence) { fenceBuf.push(raw); continue; } // inside fenced, comments are content (I24)
    const line = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+$/, ''); // I24: comments outside code are cut
    if (/^\s*\|.*\|\s*$/.test(line)) { closeAll(); tableBuf.push(line); continue; }
    flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeAll(); out.push('<h' + h[1].length + '>' + inline(escapeHtml(h[2])) + '</h' + h[1].length + '>'); continue; }
    if (/^---+\s*$/.test(line)) { closeAll(); out.push('<hr>'); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); closeList(); if (!quoteOpen) { out.push('<blockquote>'); quoteOpen = true; } if (q[1].trim()) qpara.push(q[1]); else flushQuotePara(); continue; }
    closeQuote();
    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) { flushPara(); flushItem(); if (!listOpen) { out.push('<ul>'); listOpen = true; } item = [li[1]]; continue; }
    if (item && line.trim()) { item.push(line.trim()); continue; } // a continuation line of the list item
    closeList();
    if (line.trim()) para.push(line); else flushPara();
  }
  flushTable(); closeAll();
  return out.join('\n');
}

/**
 * Paragraph blocks of a document for the proofreading face: each block is a run of non-empty lines
 * outside fences (a fenced block is one paragraph). Ids are `p<N>` in document order.
 */
export function splitParagraphs(md) {
  const lines = normalize(md).split('\n');
  const paras = [];
  let buf = [], inFence = false;
  const flush = () => { if (buf.length) { paras.push({ id: 'p' + (paras.length + 1), text: buf.join('\n') }); buf = []; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (!inFence) flush(); buf.push(line); if (inFence) flush(); inFence = !inFence; continue; }
    if (inFence) { buf.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    buf.push(line);
  }
  flush();
  return paras;
}

// ── C6/I2: the decision is written to THREE places with derived names ─────────────────────────
const docBase = (docPath) => basename(docPath).replace(/\.[^.]+$/u, '');
export function decisionPaths(root, docPath, cfg = loadContourConfig(root)) {
  const base = docBase(docPath);
  return {
    decision: resolve(root, cfg.decisionsDir, base + '.decision.json'),
    archive: (at) => resolve(root, cfg.archiveDir, base + '--' + at.replace(/[:.]/g, '-') + '.json'),
  };
}

/**
 * Record a decision. `payload`: { kind, by, comment, answers: { Q1: { choice, text, comment } },
 * artifacts, comments: { p1: text } (proofreading), read (notice) }. Place 1 is the source md —
 * only when the source IS markdown and there is something to write (an empty rewrite would strip
 * a BOM and stamp the owner's file's mtime); places 2 and 3 are the decision file and its archive.
 */
export function recordDecision(root, docPath, payload, cfg = loadContourConfig(root), now = new Date()) {
  const T = texts(cfg.language);
  const { at, atHuman } = provenance(now, cfg.language);
  const abs = resolve(root, docPath);
  const record = {
    kind: payload.kind || 'interview',
    document: docPath.replace(/\\/g, '/'),
    by: payload.by || cfg.ownerName,
    at, atHuman,
    comment: payload.comment || '',
    ...(payload.answers ? { answers: payload.answers } : {}),
    ...(payload.artifacts ? { artifacts: payload.artifacts } : {}),
    ...(payload.comments ? { comments: payload.comments } : {}),
    ...(payload.noRemarks ? { noRemarks: true } : {}), // bugs/113: "looked, no remarks" — a legal verdict on an artifact
    ...(payload.recovered ? { recovered: true } : {}), // LP (2.7, #66): the answer was saved on the owner's computer while the server was gone and picked up by the agent
    ...(payload.staleRevision ? { staleRevision: true } : {}), // OW6 (2.8): made against an older revision — kept as data, not written into the document
  };
  const isMd = extname(abs).toLowerCase() === '.md' && !payload.staleRevision; // OW6: an older revision's answer never lands by question numbers
  if (isMd) {
    const src = readFileSync(abs, 'utf8');
    const eol = /\r\n/.test(src) ? '\r\n' : '\n';
    const lines = stripBom(src).split(/\r?\n/);
    const questions = parseQuestions(src);
    const prov = '<!-- owner-review: by ' + record.by + ' · ' + atHuman + (record.recovered ? ' · ' + T.wb.recovered : '') + ' -->';
    let touched = false;
    // questions are processed BOTTOM-UP: a splice never shifts positions still to be processed above
    const entries = Object.entries(payload.answers || {})
      .map(([qid, ans]) => ({ qid, ans, q: questions.find((x) => x.id === qid) }))
      .filter((e) => e.q)
      .sort((a, b) => b.q.line - a.q.line);
    // the owner's text as lines of the file with the provenance mark at the end of the last (NT F1 — ownerTextLines above)
    const marked = (text, opts) => { const ls = ownerTextLines(text, opts); ls[ls.length - 1] += ' ' + prov; return ls; };
    for (const { ans, q } of entries) {
      const answerText = [ans.choice ? ans.choice + ')' : '', ans.text || ''].filter(Boolean).join(' — ').trim();
      const qStart = q.line; // 1-based line of the question heading
      if (ans.comment) { // the comment FIRST (end of block): a splice below the answer line does not shift it
        const cl = marked(ans.comment, { keepBlank: true });
        lines.splice(qStart + q.body.length, 0, '', '**' + T.wb.ownerComment(atHuman) + '** ' + cl[0], ...cl.slice(1), '');
        touched = true;
      }
      if (!answerText) continue; // "comment only" is NOT an answer — the question stays open
      const emptyAns = q.answers.find((a) => !a.text);
      touched = true;
      // NT1 (2.9, origin issue #139): an answer of several lines is written as several LINES of the file (the file's own line ends), the
      // first on the label, the provenance mark at the end of the last; blank lines are dropped — the answer is read back as a paragraph
      // up to a blank line, and a blank line inside would cut it
      const [first, ...rest] = marked(answerText);
      if (emptyAns !== undefined) {
        lines[qStart + emptyAns.line] = lines[qStart + emptyAns.line].replace(/\s*$/, '') + ' ' + first;
        if (rest.length) lines.splice(qStart + emptyAns.line + 1, 0, ...rest);
      } else { // the owner's answer is UNTOUCHABLE: new text only as a dated follow-up (I2)
        const lastAns = q.answers[q.answers.length - 1];
        // CP (2.9, #127 p. 3): a follow-up goes to the END of the question's block — below an applied-mark line ("Applied: …") — never
        // right under the answer line, which also cut a multi-line answer in two; trailing blank lines of the block stay last.
        let endAt = q.body.length; while (endAt > 0 && !q.body[endAt - 1].trim()) endAt--;
        const insertAt = lastAns ? qStart + endAt : qStart + q.body.length;
        lines.splice(insertAt, 0, '', '**' + T.wb.followUp(atHuman) + '** ' + first, ...rest);
      }
    }
    const tail = [];
    if (record.comments && Object.keys(record.comments).length) { // proofreading: a dated block at the END
      tail.push('**' + T.wb.proofread(atHuman) + '** ' + prov, '');
      for (const [pid, text] of Object.entries(record.comments)) {
        if (!String(text).trim()) continue;
        const pl = ownerTextLines(text, { keepBlank: true });
        tail.push('- **' + pid + '** — ' + pl[0], ...pl.slice(1));
      }
    }
    if (record.comment) {
      const dl = marked(record.comment, { keepBlank: true });
      tail.push(...(tail.length ? [''] : []), '**' + T.wb.ownerComment(atHuman) + '** ' + dl[0], ...dl.slice(1));
    }
    if (tail.length) {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push('', '---', '', ...tail, '');
      touched = true;
    }
    if (touched) writeFileSync(abs, lines.join(eol), 'utf8');
  }
  const p = decisionPaths(root, docPath, cfg);
  // OW6 (2.8, the KAIF owner's word — answers are saved ONE AT A TIME in every project): a record from the SAME page — its `rev` is
  // the document revision the previous record left (`revAfter`) — MERGES into the decision; a new revision of the document starts a
  // new decision (old answers never land on renumbered questions). The archive (place 3) keeps every record as it came.
  // [TESTED: 2026-09-25 19:37–20:01 · selftest: two records of one page merge, another revision starts a new decision; s22 D (7) on the
  //  deployed copy: records 2 after two saves; mutant «merge removed» red exactly on both cases; report testcases/reports/2026-09-25_ow6-partial-save-revision.md]
  if (payload.rev) record.rev = payload.rev;
  if (isMd) record.revAfter = bodyHash(readFileSync(abs, 'utf8'));
  const prev = existsSync(p.decision) ? readJson(p.decision) : null;
  const decision = { ...record };                          // place 2 — merged; the archive and the caller get THIS record as it came
  if (prev && payload.rev && prev.revAfter === payload.rev && (prev.kind || 'interview') === record.kind) {
    if (prev.answers || record.answers) decision.answers = { ...(prev.answers || {}), ...(record.answers || {}) };
    if (prev.artifacts || record.artifacts) decision.artifacts = { ...(prev.artifacts || {}), ...(record.artifacts || {}) };
    if (!record.comment && prev.comment) decision.comment = prev.comment;
    decision.records = (prev.records || 1) + 1;
  }
  mkdirSync(resolve(root, cfg.archiveDir), { recursive: true });
  writeFileSync(p.decision, JSON.stringify(decision, null, 2) + '\n', 'utf8');    // place 2
  writeFileSync(p.archive(at), JSON.stringify(record, null, 2) + '\n', 'utf8');   // place 3 — never rewritten
  return record;
}

export function readDecision(root, docPath, cfg = loadContourConfig(root)) {
  const p = decisionPaths(root, docPath, cfg).decision;
  if (!existsSync(p)) return null;
  return readJson(p);
}

// ── C7/I4: the sending gate — one function for both sides, never throws ───────────────────────
export function checkApproval(root, docPath, artifactId, cfg = loadContourConfig(root)) {
  try {
    const decision = readDecision(root, docPath, cfg);
    if (!decision) return { ok: false, reason: 'no decision — the review has not taken place' };
    const art = (decision.artifacts || {})[artifactId];
    if (!art) return { ok: false, reason: 'artifact "' + artifactId + '" is not declared in the decision' };
    if (art.status !== 'approved') return { ok: false, reason: 'artifact status is "' + art.status + '", not approved' };
    const meta = parseMetaBlock(readFileSync(resolve(root, docPath), 'utf8'));
    const decl = (meta && meta.artifacts.find((a) => a.id === artifactId)) || null;
    if (!decl || !decl.body_file) return { ok: false, reason: 'artifact not declared in the document meta block, or without body_file' };
    const bodyPath = resolve(root, decl.body_file);
    if (!existsSync(bodyPath)) return { ok: false, reason: 'artifact body is missing: ' + decl.body_file };
    const actual = bodyHash(readFileSync(bodyPath, 'utf8'));
    if (actual !== art.sha256) return { ok: false, reason: 'the text changed after approval — the approval is VOID (I3)' };
    return { ok: true, reason: 'approved, hash matches' };
  } catch (e) {
    return { ok: false, reason: 'unexpected error while checking: ' + e.message }; // any doubt = refusal
  }
}

// ── Where the temporary renders of this contour live (ignored by git BEFORE the tool exists) ──
export const TMP_DIR = '.kaif/.contour-tmp';
export const tmpDirOf = (root) => join(resolve(root), ...TMP_DIR.split('/'));
