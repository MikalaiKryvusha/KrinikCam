#!/usr/bin/env node
// kaif-voice-lint.mjs — the OPTIONAL owner-voice tool (2.7, epic VC; AGENT_GUIDE.md → the fable loop's
// fourth KAIF obligation and "Showing is an action"; origin issue #61 — the owner's word: "that you write
// texts and do not use the stylometry is a GLARING methodology bug"). Deployed to .kaif/tools/.
//
// The owner's contract it serves (his statement, rendered from Russian): the agent WRITES the text by the
// voice and the rules the owner's stylometry prescribes — WITH THE STYLOMETRY IN ITS WORKING CACHE — then,
// by that same stylometry, runs an INDEPENDENT check of what it wrote, fixes it, and only then counts the
// text as written and brings it to the owner. Two commands, one for each half:
//   load  — prints the portrait (AUTHOR_STYLOMETRY.md) into the agent's working context BEFORE the first
//           word and leaves the witness .kaif/voice-marker.json (the moments are taken by the tool from the
//           system clock; the marker is session state, ignored by git like the refresh marker). Since 2.8
//           (epic CK; origin issue #99 p. 3 — a field portrait weighed ~170k tokens and was loaded whole for
//           every unit) a bare `load` prints the WRITING sections: the head before the first H2 and the H2
//           sections numbered 0 · 1 · 2 · 5 · 6 · 7 (2.8 epic VO: + §1; `--genre essay` + §3) with their subsections — 2-C among them (the owner's bans, the
//           rules, the lexicon, the anti-portrait, the before/after pairs, the checklist), prints what that costs in tokens, and names
//           every section it left out with its weight and a ready ASCII-only `--sections` command; `--all`
//           prints the whole portrait; a portrait with no numbered writing section is printed whole, said aloud;
//   check — the MACHINE HALF of the independent check: the stop-patterns and required positives the
//           portrait keeps as a TABLE in §8, run over the written text; plus the witness — a text with no
//           load witness, last written BEFORE the portrait was first loaded, or written MORE THAN AN HOUR
//           after the last load (the hour rule of context refresh: the portrait had left the working
//           context), is "written past the portrait" and a finding. The semantic half is the
//           clean-instance pass §7B (not this module).
// The portrait is the single source of the patterns (the owner edits them where he reads them); this
// module carries no pattern of its own, and `check` is not the writing step.
//
// What it does NOT do, said aloud: it does not judge likeness — "sounds like the owner" is the taste
// class and the owner's verdict (AGENT_GUIDE.md → the taste class); it catches only the EXPLICIT patterns
// of the portrait's §8 table. It never lints the portrait itself (every pattern would hit its own row).
// A portrait whose §8 is prose is honestly SKIPPED — a silent green over an unread §8 would be a false
// check, which is the very class this module exists to close. And the witness is a MARKER, with the
// marker class's boundary: it proves that `load` ran and when, not that the agent read what it printed —
// a copied marker or a re-saved file can forge it; the judge's re-run (open the named modules, compare
// the lexicon's turns with the text) is what judges the reading, exactly as with the refresh marker.
//
// The table (portrait §8; the skeleton .kaif/_owner-voice-template.md carries the form):
//   | pattern | class | hint | legal exception |      (RU header: паттерн · класс · подсказка · исключение)
//   pattern   — a regular expression in a code span, word forms spelled out for inflected languages;
//               `\|` inside the cell is alternation (GFM escapes the pipe); a bare pattern is case-sensitive
//               like ripgrep, `/…/i` opts into case-folding; `\b`, `\B` and `\w`/`\W` are Unicode-aware
//               here — JavaScript's own are blind to non-ASCII letters, a paid-for lesson (EXP-0082);
//               the one gap: `\W` INSIDE a character class stays ASCII (u-mode cannot nest a class) —
//               write `[^\p{L}\p{N}_]` there explicitly
//   class     — `stop` (a hit is a finding) or `positive` (its ABSENCE in the whole file is a warning)
//   hint      — what to write instead, in the owner's own words (printed with every hit)
//   exception — `/regex/` silences a hit whose LINE matches; prose is printed beside the hit for the reader
//   a row whose pattern cell is a placeholder `<…>` or empty is not a rule (the skeleton's example rows)
//
// The witness (.kaif/voice-marker.json): { at, firstAt, loads[], portrait, sha256, sections, lines } —
// `load` appends the moment to `loads` (a history, kept for one portrait path; a different portrait
// starts a new witness); `check` judges every file against it: no witness, or a witness for another
// portrait → finding; no load before the file's last write → finding; the last load before the write
// older than STALE_MINUTES → finding (the hour rule); the portrait changed since the last load (sha) →
// warning. `--warn` never mutes the witness — calibration is for patterns, not for the contract.
//
// Exit codes — ADVISORY, like the sibling modules: 1 = findings, 0 = judged and clean, 3 = SKIPPED (no
// portrait · no §8 section · no pattern table in §8 · a table with no rule — "not judged" must never read
// as "clean"), 2 = usage (no files, a named file missing, `--sections` without a value or matching no
// section, `--all` together with `--sections` — then nothing is loaded and no witness is written).
//
// Commands:
//   node .kaif/tools/kaif-voice-lint.mjs load [--all | --sections <regex>] [--out <file>]   # print the writing sections into
//                                                                        # your context (--all: the whole portrait;
//                                                                        # --sections: the head + the H2 sections
//                                                                        # matching) + write the witness — BEFORE
//                                                                        # the first word
//   node .kaif/tools/kaif-voice-lint.mjs check <files…> [--genre <genre>] [--warn]  # a row labelled [work]/[document]/[prose] (or RU) judges only its genres; portrait: AUTHOR_STYLOMETRY.md at the
//                                                                        # project root, or .kaif/kaif.json → voicePortrait
//   node .kaif/tools/kaif-voice-lint.mjs selftest                        # PROVE every answer on in-memory fixtures (EN + RU)
// [TESTED: 2026-09-12 · selftest 48 cases green in 2 languages (a hit named 7:«Remember that» / 7:«Помни, что» with the row's
//  hint and its prose exception; the clean text silent; fence, inline code and HTML comment invisible; a /regex/ exception
//  silences; a bare pattern is case-sensitive and /…/i folds; \b is Unicode-aware — «ты» inside «открыты» is not a hit, \B
//  fires inside «открытый» and not on a standalone «ты»; an absent positive is a warning; a prose §8 → no-table, no §8 →
//  no-section, foreign columns → no-table naming the header, a third language found by its number, the shipped skeleton
//  unfilled → no-rules; the witness — no marker → finding, another portrait → finding, written before the first load →
//  finding with both moments in the local zone, written 90 min after the last load → finding, a re-load 10 min before the
//  write → clean, a changed portrait → warning, a pre-history marker still read; --sections keeps the head and the matching
//  sections and reports zero matches); live on the origin — `load --sections "^8"` printed 381 lines of the generated
//  portrait and left .kaif/voice-marker.json (ignored by git), `check` — SKIPPED exit 3 naming the two measurement tables of
//  its §8; sandbox suite s26 observed: EN and RU projects — check without a witness → "no load witness" (exit 1, also under
//  --warn), load prints the portrait and the witness, a hit named on `sheet/steps.md:7` with the hint, clean green with the
//  load moment, a file written before the load → "written past the portrait", --warn exit 0 on patterns, fence invisible,
//  --sections "^8" with the load history, --sections without a match or a value → usage with the witness untouched, prose
//  §8 and no portrait SKIPPED for check and load, the marker path honoured, a witness for another portrait → finding, usage
//  exit 2, deployed copy — module and skeleton (both commands + the table) arrive, deployed load, an unfilled skeleton copy
//  SKIPPED, one filled row fires with the "changed since it was last loaded" warning; polygon `all 25 suites green`; red
//  proven on the 2.6 dist via KAIF_DIST (7 of 47 addressed to the absent module and skeleton form); the first suite run
//  caught a line-count defect of this module (the file's trailing newline counted as a line), the epic's judge caught the
//  witness that refused only once per tree, the mute --warn, the empty --sections load, the mixed time zones and the
//  untranslated \B — all fixed before commit; the origin's run report: testcases/reports/2026-09-12_polygon-2.7-VC.md]
// [TESTED: 2026-09-25 · 2.8, epic CK, step CK5.9 (b) — the writing selection of a bare `load`: selftest 57 cases (numbers with
//  their subsections — a Cyrillic «2-С», «6)», «6Б», «2.1» in and «4.1» out; ASCII ready regexes, the end anchor, one whole shape
//  said aloud; a portrait with no writing section loaded whole; the token rates); suite s26 54/54 (section (3) judges the DEPLOYED
//  module), red on the 2.7 dist 7 of 54 exactly on the new asserts; tools/sandbox/probes/voice-mutants.mjs — six mutants red exactly
//  on their addressees; functional run tools/sandbox/probes/ck59b-load-field.mjs over copies of eight real portraits — the bare
//  load equals an independent cut, 142 printed regexes run and exact, --all whole (origin 991 of 3957 lines, ~37k of ~169k tokens);
//  the functional run found an unanchored regex that loaded two sections and a field «6Б» the first rule missed — both fixed before
//  commit; polygon `all 27 suites green`; report testcases/reports/2026-09-25_ck59b-portrait-writing-sections.md]
// [TESTED: 2026-09-25 15:39 +03:00 · 2.8, epic VO, step VO2 (origin issue #102) — genre labels and §1: selftest 62 cases (+5: labels in both languages,
//  the applicability of all six genres equal to the core storage tool's rule, the check filter, the essay load); s26 on the DEPLOYED
//  module 61 of 61 (on dist v2.7 — 14 red, the 7 new genre asserts among them); mutants M7 «labels ignored» and M8 «§1 not a writing
//  section» red exactly on their addressees; differential probe vo2-genre-parity — 126 verdicts, 0 disagreements with the storage tool;
//  functional run on the owner's own prose (7 excerpts of the private prose module, counts only): no genre — 4 hits, all from [работа]
//  rows; --genre essay — 0, green; --genre ticket — 4; eight real portraits load §1 with every ready regex exact; report testcases/reports/2026-09-25_vo2-genre-labels.md]
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// OW8 (KAIF 2.8, origin issue #101): the command runs only when this file IS the program — imported by a project's own tool, the
// module stays silent and never exits the importer (the same guard as the shipped contour's review.mjs).
import { pathToFileURL as __kaifToUrl } from 'node:url';
import { resolve as __kaifResolve } from 'node:path';
const IS_MAIN = import.meta.url === __kaifToUrl(__kaifResolve(process.argv[1] || '')).href;

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const WARN = argv.includes('--warn');
const ALL = argv.includes('--all');
const SECTIONS_AT = argv.indexOf('--sections');
const SECTIONS_ARG = SECTIONS_AT >= 0 ? argv[SECTIONS_AT + 1] : null;
const GENRE_AT = argv.indexOf('--genre');
const GENRE_ARG = GENRE_AT >= 0 ? argv[GENRE_AT + 1] : null;
// `load --out <file>` (2.9; origin tickets #143 §2.3 · #145 §2.4): a client that caps tool output by BYTES cut the ~60 KB print inside a
// UTF-8 sequence and the loaded text ended in U+FFFD — the selection is written to the file instead, and the agent reads that file whole
const OUT_AT = argv.indexOf('--out');
const OUT_ARG = OUT_AT >= 0 ? argv[OUT_AT + 1] : null;
const FILES = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--sections' && all[i - 1] !== '--genre' && all[i - 1] !== '--out');
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;
const EXIT_SKIPPED = 3;
const MARKER = '.kaif/kaif.json';
const VOICE_MARKER = '.kaif/voice-marker.json';
const DEFAULT_PORTRAIT = 'AUTHOR_STYLOMETRY.md';
const FRAGMENT_MAX = 80;
const LOADS_KEPT = 100;               // the load history a witness keeps (the oldest fall off)
export const STALE_MINUTES = 60;      // the hour rule of context refresh: an older load is no longer "in the cache"
export const BOUNDARY = 'likeness is not judged — that verdict is the owner\'s (the taste class); the linter catches only the explicit patterns of the portrait\'s §8 table';
const USAGE = 'usage: node .kaif/tools/kaif-voice-lint.mjs load [--all | --sections <regex>] [--genre <genre>] [--out <file>] | check <files…> [--genre <genre>] [--warn] | selftest';
// The WRITING sections a bare `load` prints (2.8, epic CK; the origin's plan names the decision and its sources): the numbered
// H2 sections the canon's fourth obligation and the portrait's own "how to use" name for writing — §0 the bans the owner dictated,
// §1 how to read the portrait (a 2.x core: the order of work and its terms — the core tells the writer to keep §0–§3 in context;
// epic VO), §2 the rules, §5 the anti-portrait, §6 the before/after pairs, §7 the checklist run before handing a text over — each
// WITH its lettered or dotted subsections: §2-C the lexicon (a Cyrillic «2-С» as well — a field portrait types it so), a field
// «6Б» of more pairs, a «2.1»; «4.1» stays with its §4. §3 — the second register, free prose — joins with `--genre essay`.
// A title opens with its label: digits, then subsection parts, then «.» or «)» and a space.
export const WRITING_SECTIONS = ['0', '1', '2', '5', '6', '7'];
export const PROSE_SECTION = '3';
// Genres and genre labels (2.8, epic VO; origin ticket #102) — the SAME genre names and the SAME rule as the tool of the owner's core
// storage (its `voice-check.mjs`), so one label means one thing in both: a §8 row whose hint OPENS with a label judges only its
// genres — [работа]/[work] every genre but essay, [документ]/[document] only document, [проза]/[prose] only essay; a row without a
// label judges every text. A bracketed word that is not a label (a «[see §5]») is left in the hint and labels nothing.
export const GENRES = ['document', 'ticket', 'comment', 'message', 'reply', 'essay'];
const LABEL_WORDS = { work: /^(?:работа|work)$/i, document: /^(?:документ|document)$/i, prose: /^(?:проза|prose)$/i };
const HINT_LABELS = /^\s*((?:\[[^\]\n]+\]\s*)+)/;
export function labelsOf(hint) {
  const m = HINT_LABELS.exec(hint || '');
  if (!m) return [];
  return [...m[1].matchAll(/\[([^\]]+)\]/g)]
    .map((x) => Object.keys(LABEL_WORDS).find((k) => LABEL_WORDS[k].test(x[1].trim())))
    .filter(Boolean);
}
export function applies(rule, genre) {
  if (!genre || !rule.labels || !rule.labels.length) return true;
  return rule.labels.some((l) => (l === 'work' && genre !== 'essay') || (l === 'document' && genre === 'document') || (l === 'prose' && genre === 'essay'));
}
const WRITING_LABEL = /^((\d+)(?:-?[A-Za-zА-Яа-яЁё]|\.\d+)*)[.)]\s/u;
// Tokens at the SAME two rates as the entry-cost line of the core's `check` (KAIF-CORE.mjs; the origin's build holds the pair):
// ASCII at 2.5 characters per token (the model page: "1M tokens ~ 2.5M characters"), any other character at 1.9 (origin issue
// #99's measurement on a mostly Cyrillic document). One calibration point — every number printed carries "~".
const ASCII_CHARS_PER_TOKEN = 2.5, OTHER_CHARS_PER_TOKEN = 1.9;

// ---------------------------------------------------------------------------
// Words the parser recognises, per shipped language: the §8 heading and the four column headers. A project
// whose owner writes in another language adds a row; the engine does not change. The heading is also found
// by its NUMBER (`## 8. …`) so a portrait in a third language is not lost.
export const KEYWORDS = {
  en: { section: /machine heuristics/i,
        columns: { pattern: /^pattern/i, class: /^class/i, hint: /^hint/i, exception: /^(?:legal\s+)?exception/i } },
  ru: { section: /машинн\S*\s+эвристик/i,
        columns: { pattern: /^паттерн/i, class: /^класс/i, hint: /^подсказк/i, exception: /^(?:законн\S*\s+)?исключен/i } },
};
const SECTION_NUMBER = /^8[.)]\s/;
const H2 = /^##\s+(.+?)\s*$/;
const ANY_H2 = /^##\s/;
const TABLE_ROW = /^\s*\|/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const PLACEHOLDER_CELL = /^<[\s\S]*>$/;
const DASH_CELL = /^[—–-]+$/;
const POSITIVE_CLASS = /^(?:positive|обязательн|позитив)/i;   // anything else is `stop`
const REGEX_CELL = /^\/(.+)\/([a-z]*)$/;

// Split a GFM table row into cells: an unescaped `|` separates, `\|` is a literal pipe — alternation in a
// regex is written `\|` in the portrait and read back as `|` here. A cell wrapped in a code span is unwrapped.
const cellsOf = (row) => {
  const cells = row.trim().split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
};
const unspan = (cell) => { const m = /^`([\s\S]*)`$/.exec(cell); return m ? m[1].trim() : cell; };

// Translate the ripgrep/PCRE habits of a portrait into JavaScript `u`-mode: `\b`, `\B` and `\w`/`\W` are
// ASCII-only in JavaScript and would either miss a Cyrillic word or split it at every letter. Outside a
// character class `\b` → a Unicode word boundary, `\B` → its negation, `\w` → [\p{L}\p{N}_], `\W` → the
// negated class; inside a class `\w` → \p{L}\p{N}_ (a negated set cannot be nested there — the named gap).
const W = '[\\p{L}\\p{N}_]';
const UNI_B = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const UNI_NB = `(?:(?<=${W})(?=${W})|(?<!${W})(?!${W}))`;
export function unicodeBody(src) {
  let out = '', inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (!inClass && n === 'b') { out += UNI_B; i++; continue; }
      if (!inClass && n === 'B') { out += UNI_NB; i++; continue; }
      if (n === 'w') { out += inClass ? '\\p{L}\\p{N}_' : W; i++; continue; }
      if (!inClass && n === 'W') { out += '[^\\p{L}\\p{N}_]'; i++; continue; }
      out += c + n; i++; continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return out;
}
// A pattern cell → RegExp (throws on a pattern that does not compile — the caller reports the row and skips it).
export function compilePattern(cell, extraFlags = 'g') {
  const raw = unspan(cell);
  const m = REGEX_CELL.exec(raw);
  const body = m ? m[1] : raw;
  const flags = extraFlags + 'u' + ((m && m[2].includes('i')) ? 'i' : '');
  return new RegExp(unicodeBody(body), flags);
}

// ---------------------------------------------------------------------------
// parsePortrait(text) → { status: ok | no-section | no-table | no-rules, rules, notes, tables }
// rule = { line, source, re, cls: stop | positive, hint, exception (prose or regex text), excRe }
export function parsePortrait(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = H2.exec(lines[i]);
    if (!m) continue;
    if (Object.values(KEYWORDS).some((k) => k.section.test(m[1])) || SECTION_NUMBER.test(m[1])) { start = i; break; }
  }
  if (start < 0) return { status: 'no-section', rules: [], notes: [], tables: 0 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (ANY_H2.test(lines[i])) { end = i; break; }
  const rules = [], notes = [];
  let tables = 0, recognised = 0, i = start + 1;
  while (i < end) {
    if (!TABLE_ROW.test(lines[i])) { i++; continue; }
    const block = [];
    while (i < end && TABLE_ROW.test(lines[i])) block.push({ n: i + 1, s: lines[i++] });
    if (block.length < 2 || !SEPARATOR_ROW.test(block[1].s)) continue;     // a lone `|` line is not a table
    tables++;
    const header = cellsOf(block[0].s);
    const col = {};
    header.forEach((h, idx) => {
      for (const k of Object.values(KEYWORDS))
        for (const [role, re] of Object.entries(k.columns)) if (re.test(h) && !(role in col)) col[role] = idx;
    });
    if (!('pattern' in col) || !('hint' in col)) {
      notes.push(`a table in §8 (line ${block[0].n}) lacks the pattern/hint columns — its header: ${header.join(' · ')}`);
      continue;
    }
    recognised++;
    for (const row of block.slice(2)) {
      const c = cellsOf(row.s);
      const source = unspan(c[col.pattern] || '');
      if (!source || PLACEHOLDER_CELL.test(source)) continue;                // an example row is not a rule
      const hint = c[col.hint] || '';
      const cls = POSITIVE_CLASS.test(unspan(c[col.class] ?? '')) ? 'positive' : 'stop';
      const excRaw = 'exception' in col ? unspan(c[col.exception] || '') : '';
      const exception = excRaw && !PLACEHOLDER_CELL.test(excRaw) && !DASH_CELL.test(excRaw) ? excRaw : '';
      let re;
      try { re = compilePattern(c[col.pattern]); }
      catch (e) { notes.push(`row at line ${row.n}: the pattern «${source}» does not compile — ${e.message}`); continue; }
      let excRe = null;
      const em = REGEX_CELL.exec(exception);
      if (em) {
        try { excRe = new RegExp(unicodeBody(em[1]), 'u' + (em[2].includes('i') ? 'i' : '')); }
        catch (e) { notes.push(`row at line ${row.n}: the exception regex does not compile — ${e.message}`); }
      }
      rules.push({ line: row.n, source, re, cls, hint, exception, excRe, labels: labelsOf(hint) });
    }
  }
  if (!recognised) return { status: 'no-table', rules: [], notes, tables };
  if (!rules.length) return { status: 'no-rules', rules: [], notes, tables };
  return { status: 'ok', rules, notes, tables };
}

// A portrait cut into its head (the lines before the first H2) and its H2 sections, in file order: { head, sections: [{ title, lines }] }.
export function h2Sections(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = [], sections = [];
  for (const l of lines) {
    const m = H2.exec(l);
    if (m) sections.push({ title: m[1], lines: [l] });
    else (sections.length ? sections[sections.length - 1].lines : head).push(l);
  }
  return { head, sections };
}
const joinCut = (head, kept) => head.concat(...kept.map((s) => s.lines)).join('\n');

// The H2 sections of a portrait whose title matches `re` (for `load --sections`) → { text, matched }; the
// head before the first H2 always rides along so the portrait's binding note is never dropped. `matched` = 0
// means nothing of the body was selected — the caller refuses to write a witness.
export function sectionsMatching(text, re) {
  const { head, sections } = h2Sections(text);
  const kept = sections.filter((s) => re.test(s.title));
  return { text: joinCut(head, kept), matched: kept.length };
}

// The WRITING selection of a bare `load` → { text, matched, kept: [{ title, label }], left: [{ title, tokens }] }: the head plus the
// H2 sections whose label's leading number is one of WRITING_SECTIONS. `matched` = 0 — a portrait with no numbered writing section:
// the caller prints it whole and says so (a portrait missing from the working context costs more than a heavy one).
export function writingSelection(text, extra = []) {
  const { head, sections } = h2Sections(text);
  const kept = [], left = [];
  const numbers = [...WRITING_SECTIONS, ...extra];
  for (const s of sections) {
    const m = WRITING_LABEL.exec(s.title.trim());
    if (m && numbers.includes(m[2])) kept.push({ ...s, label: m[1] });
    else left.push({ ...s, tokens: tokensOf(s.lines.join('\n')) });
  }
  return { text: joinCut(head, kept), matched: kept.length, kept, left };
}

// The model's price of a text, at the two rates above; printed "~Nk" (or "~N" below a thousand).
export const tokensOf = (s) => {
  let ascii = 0, other = 0;
  for (const ch of s) { if (ch.charCodeAt(0) < 128) ascii++; else other++; }
  return ascii / ASCII_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN;
};
export const fmtTokens = (t) => (t < 1000 ? `~${Math.round(t)}` : `~${Math.round(t / 1000)}k`);

// The ready `--sections` regex for ONE section, ASCII-only: every character that is not a Latin letter, a digit or a space becomes
// `.` — the command then carries no Cyrillic, no quote and no backslash through a shell (AGENT_GUIDE.md → text goes through files,
// not through command-line arguments) — and the shortest prefix that selects this title alone among the portrait's H2 titles is
// taken → { sel, also: 0 }. When no prefix is enough, the whole shape anchored at its end (`$` — «Пунктуация и ритм» against
// «Морфология и грамматика»: both second words are ten letters long); two titles of one WHOLE shape cannot be told apart in ASCII —
// then `also` counts the other sections the regex loads with it, and the caller says so.
export function selectorFor(title, titles) {
  const shape = '^' + [...title].map((c) => (/[A-Za-z0-9 ]/.test(c) ? c : '.')).join('');
  const hits = (src) => { const re = new RegExp(src, 'iu'); return titles.filter((t) => re.test(t)).length; };
  for (let n = 2; n <= shape.length; n++) if (hits(shape.slice(0, n)) === 1) return { sel: shape.slice(0, n), also: 0 };
  return { sel: shape + '$', also: hits(shape + '$') - 1 };
}

// ---------------------------------------------------------------------------
// The invisible regions of a judged file: fenced code blocks, inline code spans and HTML comments are not the
// owner's prose. They are blanked with spaces so line numbers stay true.
export function visibleLines(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();   // the newline that ends a file is not a line
  let fence = null;
  return lines.map((l) => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = null; return ''; }
    if (fence) return '';
    return l.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)).replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  });
}

// lintText(name, text, rules) → { findings, warnings, silenced, judged }
export function lintText(name, text, rules) {
  const lines = visibleLines(text);
  const findings = [], warnings = [];
  let silenced = 0;
  for (const r of rules) {
    if (r.cls === 'positive') {
      const present = lines.some((l) => { r.re.lastIndex = 0; return r.re.test(l); });
      if (!present) warnings.push({ file: name, rule: r, msg: `required positive «${r.source}» not found in the file → ${r.hint}` });
      continue;
    }
    lines.forEach((l, i) => {
      for (const m of l.matchAll(r.re)) {
        if (r.excRe && r.excRe.test(l)) { silenced++; continue; }
        findings.push({ file: name, line: i + 1, fragment: m[0].slice(0, FRAGMENT_MAX), rule: r });
      }
    });
  }
  return { findings, warnings, silenced, judged: lines.length };
}
export const fmt = (f) => `${f.file}:${f.line} — «${f.fragment}» → ${f.rule.hint}` +
  (f.rule.exception && !f.rule.excRe ? ` (exception: ${f.rule.exception})` : '');

// ---------------------------------------------------------------------------
// The witness — was the portrait in the working context WHILE the text was written?
// witness(marker, portrait, portraitSha, fileMtimeMs) → { findings: [msg…], warnings: [msg…] }
const pad = (n, w = 2) => String(n).padStart(w, '0');
export const localIso = (d) => {
  const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
export const NO_WITNESS = (portrait) => `written past the portrait — no load witness for ${portrait} (${VOICE_MARKER}): run \`node .kaif/tools/kaif-voice-lint.mjs load\` BEFORE the first word, write with the portrait in your working context, then check`;
export function loadsOf(marker) {
  if (!marker) return [];
  const raw = Array.isArray(marker.loads) ? marker.loads : [marker.firstAt, marker.at].filter(Boolean);
  return raw.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
}
export function witness(marker, portrait, portraitSha, fileMtimeMs) {
  const findings = [], warnings = [];
  const loads = loadsOf(marker);
  if (!marker || !loads.length) return { findings: [NO_WITNESS(portrait)], warnings };
  if (marker.portrait && marker.portrait !== portrait)
    return { findings: [`written past the portrait — the load witness is for another portrait (${marker.portrait}), not ${portrait}: load it first`], warnings };
  const before = loads.filter((t) => t <= fileMtimeMs);
  const at = localIso(new Date(fileMtimeMs));
  if (!before.length)
    findings.push(`written past the portrait — the file was last written at ${at}, the portrait was first loaded at ${localIso(new Date(loads[0]))}: the text was written without the portrait in the working context — rewrite it BY the portrait (load first)`);
  else {
    const last = before[before.length - 1], gap = fileMtimeMs - last;
    if (gap > STALE_MINUTES * 60 * 1000)
      findings.push(`written past the portrait — the last load before this text was ${Math.round(gap / 60000)} min earlier (${localIso(new Date(last))}; the file was last written at ${at}): the portrait had left the working context (the hour rule) — reload it and rewrite the text BY it`);
  }
  if (portraitSha && marker.sha256 && marker.sha256 !== portraitSha)
    warnings.push('the portrait changed since it was last loaded (sha differs) — reload it before the next unit');
  return { findings, warnings };
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// An untouched template is not a text anyone wrote (2.8, origin #107 — a field agent ran check over the owner documents right after the
// install, and GOAL.md, never edited, was named "written past the portrait" because the install wrote it before the first load): a file
// whose text equals the TEMPLATE this release shipped for its path — `.kaif/deploy-manifest.json` → `templateShas`, the release's truth,
// EOL-normalized the way the core computes it — gets a warning naming it, never the witness finding; its lines are still judged by the
// table. (light judge of #107, K-F1: the first cut compared with `shas`, the DISK snapshot every update, update-verify and adopt-current
// refresh, so after any update an agent's own text read as "an untouched template" and exited 0.) → true | false
export function untouchedTemplate(relPath, bytes, templateShas) {
  const want = templateShas && templateShas[String(relPath).replace(/\\/g, '/').replace(/^\.\//, '')];
  return !!want && sha256(String(bytes).replace(/\r\n/g, '\n')) === want;
}
const DEPLOY_MANIFEST = join('.kaif', 'deploy-manifest.json');
function readTemplateShas() {
  try { return JSON.parse(readFileSync(DEPLOY_MANIFEST, 'utf8').replace(/^\uFEFF/, '')).templateShas || null; } catch { return null; }
}
function readMarker() {
  try { return JSON.parse(readFileSync(VOICE_MARKER, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

// ---------------------------------------------------------------------------
function portraitPath() {
  try {
    const j = JSON.parse(readFileSync(MARKER, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof j.voicePortrait === 'string' && j.voicePortrait.trim()) return j.voicePortrait.trim();
  } catch { /* no marker or unreadable — the default name stands */ }
  return DEFAULT_PORTRAIT;
}
function skipped(reason) {
  console.log(`⚠ voice-lint SKIPPED — ${reason}; nothing was judged — ${BOUNDARY} (exit ${EXIT_SKIPPED})`);
  process.exit(EXIT_SKIPPED);
}
function usage(msg) { console.error(`✖ voice-lint: ${msg}\n${USAGE}`); process.exit(EXIT_USAGE); }
function load() {
  const portrait = portraitPath();
  if (!existsSync(portrait)) skipped(`no portrait at ${portrait} (${DEFAULT_PORTRAIT} at the project root, or ${MARKER} → voicePortrait) — nothing to load`);
  const text = readFileSync(portrait, 'utf8');
  if (ALL && SECTIONS_AT >= 0) usage('--all and --sections exclude each other — nothing loaded, no witness written');
  if (GENRE_AT >= 0 && !GENRES.includes(GENRE_ARG)) usage(`--genre is one of: ${GENRES.join(' · ')} — nothing loaded, no witness written`);
  const extra = GENRE_ARG === 'essay' ? [PROSE_SECTION] : [];   // the free-prose register joins the writing sections of an essay
  let filter = null;
  if (SECTIONS_AT >= 0) {
    if (!SECTIONS_ARG || SECTIONS_ARG.startsWith('--')) usage('--sections needs a regex — nothing loaded, no witness written');
    try { filter = new RegExp(SECTIONS_ARG, 'iu'); } catch (e) { usage(`--sections is not a regex (${e.message}) — nothing loaded, no witness written`); }
  }
  // Three selections: --sections (the head + the matching sections) · --all (the whole portrait) · bare = the WRITING sections,
  // falling back to the whole portrait, said aloud, when none of them is numbered in it.
  let printed = text, sections = 'all', why = '', left = [];
  if (filter) {
    const sel = sectionsMatching(text, filter);
    if (!sel.matched) usage(`no H2 section of ${portrait} matches --sections ${SECTIONS_ARG} — nothing loaded, no witness written`);
    printed = sel.text; sections = filter.source;
  } else if (!ALL) {
    const sel = writingSelection(text, extra);
    if (sel.matched) { printed = sel.text; sections = extra.length ? `writing, genre ${GENRE_ARG}` : 'writing'; left = sel.left; why = ` — the head and ${sel.kept.map((s) => '§' + s.label).join(' · ')}`; }
    else why = ` — no writing section (${[...WRITING_SECTIONS, ...extra].map((n) => '§' + n).join(' · ')} or their subsections) is numbered in this portrait, so the whole of it is loaded`;
  }
  printed = printed.replace(/\s*$/, '');
  if (OUT_AT >= 0) {
    if (!OUT_ARG || OUT_ARG.startsWith('--')) usage('--out needs a file path — nothing loaded, no witness written');
    // the copy may be of a PRIVATE portrait: inside a git work tree it goes only where git ignores it, or it rides the next commit
    const outDir = dirname(resolve(OUT_ARG));
    const inTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: existsSync(outDir) ? outDir : '.', encoding: 'utf8' });
    if (inTree.status === 0 && String(inTree.stdout).trim() === 'true'
        && spawnSync('git', ['check-ignore', '-q', '--no-index', resolve(OUT_ARG)], { cwd: existsSync(outDir) ? outDir : '.' }).status !== 0)
      usage(`--out ${OUT_ARG} is inside this git work tree and git does not ignore it — the copy of the portrait would ride the next commit; write it outside the project (your scratchpad, the OS temp folder) or to an ignored path — nothing loaded, no witness written`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(OUT_ARG, printed + '\n', 'utf8');
  } else process.stdout.write(printed + '\n');
  const now = new Date(), prev = readMarker();
  const same = prev && prev.portrait === portrait;                     // another portrait starts a new witness
  const loads = (same ? (Array.isArray(prev.loads) ? prev.loads : [prev.firstAt].filter(Boolean)) : []).concat(localIso(now)).slice(-LOADS_KEPT);
  const marker = {
    at: localIso(now), firstAt: loads[0], loads,
    portrait, sha256: sha256(text), sections,
    lines: printed.split(/\r?\n/).length,
    note: 'the moments are taken by the tool from the system clock; session state, ignored by git; a witness proves the load ran, not that the print was read',
  };
  mkdirSync(dirname(VOICE_MARKER), { recursive: true });
  writeFileSync(VOICE_MARKER, JSON.stringify(marker, null, 2) + '\n');
  // The price of the load (origin issue #99 p. 3: the load "prints its own token cost"): lines and tokens, of the whole when a part.
  const whole = text.replace(/\s*$/, ''), part = printed !== whole;
  const size = part ? `${marker.lines} of ${whole.split(/\r?\n/).length} line(s)` : `${marker.lines} line(s)`;
  const cost = part ? `${fmtTokens(tokensOf(printed))} of ${fmtTokens(tokensOf(whole))} tokens` : `${fmtTokens(tokensOf(whole))} tokens`;
  if (OUT_AT >= 0) console.log(`✅ voice-lint load — ${portrait} (${size}, sections: ${sections}${why}; ${cost}) written to ${OUT_ARG} (${Buffer.byteLength(printed + '\n', 'utf8')} bytes, UTF-8); witness ${VOICE_MARKER} at ${marker.at} (${loads.length} load(s) on record) — READ THAT FILE WHOLE NOW: until you have, the portrait is not in your working context; then write BY it and \`check\``);
  else console.log(`\n✅ voice-lint load — ${portrait} (${size}, sections: ${sections}${why}; ${cost}) is now in your working context; witness ${VOICE_MARKER} at ${marker.at} (${loads.length} load(s) on record) — write BY it, then \`check\``);
  if (!left.length) return;
  // Every section the writing selection left out, by name, weight and a ready command — the unit that needs one loads it.
  const titles = h2Sections(text).sections.map((s) => s.title);
  console.log(`ℹ not loaded — ${left.length} section(s), ${fmtTokens(left.reduce((a, s) => a + s.tokens, 0))} tokens; the whole portrait: \`node .kaif/tools/kaif-voice-lint.mjs load --all\`; one section: \`node .kaif/tools/kaif-voice-lint.mjs load --sections "<regex>"\` with its regex below`);
  for (const s of left) {
    const { sel, also } = selectorFor(s.title, titles);
    console.log(`   ${fmtTokens(s.tokens).padStart(5)} tokens  «${s.title}» — --sections "${sel}"${also ? ` (loads ${also} more section(s) of the same shape with it)` : ''}`);
  }
}
function check() {
  if (!FILES.length) usage('check needs at least one file');
  const missing = FILES.filter((f) => !existsSync(f));
  if (missing.length) usage(`no such file — ${missing.join(', ')}`);
  const portrait = portraitPath();
  if (!existsSync(portrait)) skipped(`no portrait at ${portrait} (${DEFAULT_PORTRAIT} at the project root, or ${MARKER} → voicePortrait)`);
  const portraitText = readFileSync(portrait, 'utf8');
  const p = parsePortrait(portraitText);
  for (const n of p.notes) console.log(`⚠ ${portrait}: ${n}`);
  if (p.status === 'no-section') skipped(`${portrait} has no §8 "Machine heuristics" section`);
  if (p.status === 'no-table') skipped(`§8 of ${portrait} carries no pattern table (${p.tables ? 'its table lacks the pattern/hint columns' : 'prose only'}) — nothing for the linter to read; put the greps into the table pattern · class · hint · exception (the shipped skeleton .kaif/_owner-voice-template.md shows the form)`);
  if (p.status === 'no-rules') skipped(`the §8 table of ${portrait} holds no rule — placeholders are not rules`);
  if (GENRE_AT >= 0 && !GENRES.includes(GENRE_ARG)) usage(`--genre is one of: ${GENRES.join(' · ')}`);
  const genre = GENRE_AT >= 0 ? GENRE_ARG : null;
  // A row labelled for another genre stays silent on this text (origin ticket #102: a portrait's work-only rows stopped the owner's
  // own prose 214 times of 217); without --genre every row judges every text, as before, and the run says the labels exist.
  const rules = p.rules.filter((r) => applies(r, genre));
  const labelled = p.rules.filter((r) => r.labels.length).length;
  if (!genre && labelled) console.log(`ℹ ${labelled} rule(s) of ${portrait} §8 carry a genre label — without --genre every rule judges every text; name the text's genre: --genre ${GENRES.join('|')}`);
  const stops = rules.filter((r) => r.cls === 'stop').length;
  const positives = rules.length - stops;
  const marker = readMarker(), pSha = sha256(portraitText), templateShas = readTemplateShas();
  const names = FILES.map((f) => f.replace(/\\/g, '/'));
  let nHits = 0, nWitness = 0, nW = 0, judged = 0, silenced = 0;
  // The witness of the whole run first: no witness at all (or one for another portrait) is said ONCE,
  // naming every file, not once per file.
  const runWitness = witness(marker, portrait, pSha, Infinity);
  const perFile = !(runWitness.findings.length && (!loadsOf(marker).length || (marker && marker.portrait && marker.portrait !== portrait)));
  if (!perFile) { nWitness += FILES.length; console.log(`✖ ${runWitness.findings[0]} — ${FILES.length} file(s): ${names.join(', ')}`); }
  FILES.forEach((f, i) => {
    const r = lintText(names[i], readFileSync(f, 'utf8'), rules);
    for (const x of r.findings) { nHits++; console.log(`${WARN ? '⚠' : '✖'} ${fmt(x)}`); }
    for (const w of r.warnings) { nW++; console.log(`⚠ ${w.file} — ${w.msg}`); }
    if (perFile) {
      const wv = witness(marker, portrait, pSha, statSync(f).mtimeMs);
      if (wv.findings.length && untouchedTemplate(relative(process.cwd(), resolve(f)), readFileSync(f, 'utf8'), templateShas)) {
        nW++; console.log(`⚠ ${names[i]} — equal to the template this release shipped (${DEPLOY_MANIFEST.replace(/\\/g, '/')} → templateShas): an untouched template, not a text written past the portrait — the load witness does not judge it (its lines are judged above); write the owner's text BY the portrait over it`);
      } else for (const x of wv.findings) { nWitness++; console.log(`✖ ${names[i]} — ${x}`); }
      if (i === 0) for (const x of wv.warnings) { nW++; console.log(`⚠ ${x}`); }
    }
    judged += r.judged; silenced += r.silenced;
  });
  const scope = `${FILES.length} file(s), ${judged} line(s) against ${portrait} §8 (${stops} stop rule(s) · ${positives} positive(s)` +
    (genre ? ` · genre ${genre}: ${p.rules.length - rules.length} rule(s) of other genres silent` : '') +
    (silenced ? ` · ${silenced} hit(s) silenced by a row's exception` : '') + ')';
  const nF = nHits + nWitness;
  if (nF && !(WARN && !nWitness)) {
    console.log(`✖ voice-lint: ${nF} finding(s) in ${scope}${nWitness ? ` — ${nWitness} of them the witness (never muted by --warn)` : ''} — rewrite by the hint, or answer the hit in the portrait's exception column; ${BOUNDARY}`);
    process.exit(EXIT_FINDINGS);
  }
  if (nF) { console.log(`⚠ voice-lint (warn mode): ${nF} hit(s) in ${scope} — calibration, exit 0`); return; }
  console.log(`✅ voice-lint OK — 0 findings${nW ? `, ${nW} warning(s)` : ''} in ${scope}; loaded ${marker.at}; ${BOUNDARY}`);
}

// ---------------------------------------------------------------------------
// selftest — every answer proven on in-memory fixtures, in both shipped languages: the table parses (a
// placeholder row and a broken row are skipped, said aloud), a hit is named with line, fragment and hint, the
// clean text is silent, fenced/inline code is invisible, a `/regex/` exception silences and prose is printed,
// a bare pattern is case-sensitive and `/…/i` folds, `\b` and `\B` are Unicode-aware, `\|` is alternation, a
// positive is warned when absent; a prose §8, a missing §8, a placeholder-only table and a table with foreign
// columns are SKIPPED statuses; the shipped skeleton, unfilled, parses to `no-rules`; the witness: no marker
// → finding, another portrait → finding, a file written before the first load → finding, more than an hour
// after the last load → finding, within the hour of a later load → clean, a changed portrait → warning; the
// `--sections` filter keeps the head and the matching sections and reports zero matches.
const FIX = {
  en: {
    portrait: `# The Owner's Voice Portrait — fixture\n\n## 7. The self-check checklist (layered)\n\n7A — the machine minute.\n\n## 8. Machine heuristics\n\nProse above the table is invisible to the linter.\n\n| pattern | class | hint | legal exception |\n|---|---|---|---|\n| \`<regular expression>\` | \`<stop / positive>\` | \`<what to write instead>\` | \`<…>\` |\n| \`\\b(Remember that\\|Note that)\\b\` | stop | state the rule; the reader is not reminded | a quoted line — |\n| \`/\\bjust\\b/i\` | stop | drop the softener | \`/^>/\` |\n| \`[unbalanced\` | stop | never reached | — |\n| \`/\\bthe rule\\b/i\` | positive | name the rule at least once | — |\n\n### E9 — prose after the table, invisible\n\n## 9. Portrait journal\n`,
    hit: 'One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nRemember that the rule is stated once.\n',
    hitLine: 7, hitFragment: 'Remember that', hitHint: 'state the rule; the reader is not reminded', hitException: 'a quoted line —',
    alternation: 'Note that the rule stands.\n',
    clean: 'The rule is stated once. Nothing else.\n',
    fenced: '```\nRemember that\n```\nThe rule stands.\n',
    inline: 'Run `Remember that` here. The rule stands.\n',
    comment: '<!-- Remember that -->\nThe rule stands.\n',
    silenced: '> just a quote\nThe rule stands.\n',
    folded: 'Just say it. The rule stands.\n',
    caseSensitive: 'note that x. The rule stands.\n',
    positiveMissing: 'Nothing named here.\n',
  },
  ru: {
    portrait: `# Портрет голоса владельца — фикстура\n\n## 7. Чек-лист самопроверки\n\n7A — машинная минута.\n\n## 8. Машинные эвристики\n\nПроза над таблицей линтеру невидима.\n\n| паттерн | класс | подсказка | законное исключение |\n|---|---|---|---|\n| \`<регулярное выражение>\` | \`<стоп / обязательный позитив>\` | \`<что писать вместо>\` | \`<…>\` |\n| \`\\b(Помни, что\\|Не забывай)\\b\` | стоп | правило называется, читателю не напоминают | строка-цитата — |\n| \`\\bты\\b\` | стоп | второе лицо в кодексе не звучит — безличная процедура | \`/^>/\` |\n| \`[незакрытый\` | стоп | не дойдёт | — |\n| \`/\\bправило\\b/i\` | обязательный позитив | назови правило хотя бы раз | — |\n\n## 9. Журнал портрета\n`,
    hit: 'Раз.\nДва.\nТри.\nЧетыре.\nПять.\nШесть.\nПомни, что правило одно.\n',
    hitLine: 7, hitFragment: 'Помни, что', hitHint: 'правило называется, читателю не напоминают', hitException: 'строка-цитата —',
    alternation: 'Не забывай: правило одно.\n',
    clean: 'Правило названо один раз. Больше ничего.\n',
    fenced: '```\nПомни, что\n```\nПравило названо.\n',
    inline: 'Запусти `Помни, что` здесь. Правило названо.\n',
    comment: '<!-- Помни, что -->\nПравило названо.\n',
    silenced: '> ты здесь\nПравило названо.\n',
    folded: 'Здесь ты один. Правило названо.\n',
    caseSensitive: 'Двери открыты. Правило названо.\n',   // `\bты\b` must not fire inside «открыты» — a Unicode boundary
    positiveMissing: 'Ничего не названо.\n',
  },
};
const PROSE_S8 = '# P\n\n## 8. Machine heuristics\n\n≥10 grep patterns … graduate into a project guard.\n\n```\nrg -n "Remember that" rules/\n```\n';
const NO_S8 = '# P\n\n## 7. Checklist\n\nnothing\n';
const FOREIGN_COLUMNS = '# P\n\n## 8. Машинные эвристики\n\n| Правило линтера | Паттерн (ripgrep) | Комментарий |\n|---|---|---|\n| Обращение на «ты» | `\\b(ты\\|тебя)\\b` | 0 в кодексе |\n';
const NUMBERED_ONLY = '# P\n\n## 8. Heuristiques machine\n\n| pattern | class | hint | exception |\n|---|---|---|---|\n| `\\bdonc\\b` | stop | drop it | — |\n';
const NB_PORTRAIT = '# P\n\n## 8. Machine heuristics\n\n| pattern | class | hint | exception |\n|---|---|---|---|\n| `\\Bты\\B` | stop | inside a word only | — |\n';
// The writing selection (2.8): numbered writing sections among unnumbered modules and other numbers, «2-С» with a CYRILLIC letter,
// Cyrillic modules of one opening («Правила: …») that the ready regex must still tell apart — two of them differ only after an
// equally long word (the origin's own portrait: the end anchor), two share one whole shape (said aloud, never silently merged).
const WRITING_FIX = ['# Portrait — head line', 'the binding note', '', '## Corpus registry', 'rows', '## 0. Six bans', 'ban',
  '## 1. How to read', 'read', '## 2. The portrait — register PRIMARY', 'rule', '## 2.1. Sub-rules', 'sub', '## Правила: Синтаксис и период', 'синтаксис',
  '## Правила: Пунктуация и ритм', 'пунктуация', '## Правила: Морфология и грамматика', 'морфология',
  '## Правила: Лексика', 'лексика', '## Правила: Графика', 'графика', '## 2-С. Словник', 'оборот', '## 4.1. Where the owner equals the school', 'school',
  '## 5. The anti-portrait', 'marker', '## 6) BEFORE/AFTER pairs', 'pair', '## 6Б. ДО/ПОСЛЕ, регистр ЛОР', 'пара',
  '## 7. The self-check checklist', 'check', '## 8. Machine heuristics', 'table', '## 9. Portrait journal', 'row', ''].join('\n');

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(FIX)) {
    const F = FIX[lang];
    const p = parsePortrait(F.portrait);
    say(p.status === 'ok' && p.rules.length === 3, `${lang}: the §8 table parses to 3 rules — the placeholder row and the broken row are not rules (got ${p.status}, ${p.rules.length})`);
    say(p.notes.length === 1 && /does not compile/.test(p.notes[0]), `${lang}: the broken row is named aloud, not swallowed (notes: ${p.notes.length})`);
    say(p.rules.filter((r) => r.cls === 'positive').length === 1, `${lang}: the positive class is recognised`);
    const hit = lintText('sheet/steps.md', F.hit, p.rules);
    say(hit.findings.length === 1 && hit.findings[0].line === F.hitLine && hit.findings[0].fragment === F.hitFragment,
      `${lang}: a hit is named with its line and fragment (got ${hit.findings.map((f) => f.line + ':' + f.fragment).join(',')})`);
    say(hit.findings.length === 1 && fmt(hit.findings[0]) === `sheet/steps.md:${F.hitLine} — «${F.hitFragment}» → ${F.hitHint} (exception: ${F.hitException})`,
      `${lang}: the printed line carries file:line — «fragment» → hint (exception: prose)`);
    say(hit.judged === 7, `${lang}: the trailing newline of a file is not a line (judged ${hit.judged})`);
    say(lintText('a.md', F.alternation, p.rules).findings.length === 1, `${lang}: \\| inside the cell is alternation`);
    say(lintText('a.md', F.clean, p.rules).findings.length === 0, `${lang}: the clean text is silent`);
    say(lintText('a.md', F.fenced, p.rules).findings.length === 0, `${lang}: a fenced code block is invisible`);
    say(lintText('a.md', F.inline, p.rules).findings.length === 0, `${lang}: an inline code span is invisible`);
    say(lintText('a.md', F.comment, p.rules).findings.length === 0, `${lang}: an HTML comment is invisible`);
    const sil = lintText('a.md', F.silenced, p.rules);
    say(sil.findings.length === 0 && sil.silenced === 1, `${lang}: a /regex/ exception silences the hit on its line (silenced ${sil.silenced})`);
    say(lintText('a.md', F.folded, p.rules).findings.length === 1, `${lang}: ${lang === 'en' ? '/…/i folds case' : 'the bare second-person pattern fires on a whole word'}`);
    say(lintText('a.md', F.caseSensitive, p.rules).findings.length === 0, `${lang}: ${lang === 'en' ? 'a bare pattern is case-sensitive' : '\\b is Unicode-aware — «ты» inside «открыты» is not a hit'}`);
    const pm = lintText('a.md', F.positiveMissing, p.rules);
    say(pm.findings.length === 0 && pm.warnings.length === 1 && /required positive/.test(pm.warnings[0].msg), `${lang}: an absent positive is a warning, never a finding`);
    say(lintText('a.md', F.clean, p.rules).warnings.length === 0, `${lang}: a present positive is silent`);
  }
  say(parsePortrait(PROSE_S8).status === 'no-table', 'a prose §8 (greps in a fence, no table) → no-table');
  say(parsePortrait(NO_S8).status === 'no-section', 'a portrait without §8 → no-section');
  const fc = parsePortrait(FOREIGN_COLUMNS);
  say(fc.status === 'no-table' && fc.tables === 1 && fc.notes.length === 1 && /lacks the pattern\/hint columns/.test(fc.notes[0]), 'a §8 table without the hint column → no-table, and the header is named');
  say(parsePortrait(NUMBERED_ONLY).status === 'ok', 'a §8 in a third language is found by its number');
  const nb = parsePortrait(NB_PORTRAIT).rules;
  say(lintText('a.md', 'открытый\n', nb).findings.length === 1 && lintText('a.md', 'а ты б\n', nb).findings.length === 0, '\\B is Unicode-aware — «ты» inside «открытый» is a hit, a standalone «ты» is not');
  // the witness — pure verdicts on synthetic moments
  const T = Date.parse('2026-09-12T14:00:00.000+03:00'), MIN = 60000, P = 'AUTHOR_STYLOMETRY.md';
  const mk = (loads, sha = 'abc', portrait = P) => ({ portrait, loads: loads.map((t) => new Date(t).toISOString()), firstAt: new Date(loads[0]).toISOString(), at: new Date(loads[loads.length - 1]).toISOString(), sha256: sha });
  say(witness(null, P, 'abc', T + MIN).findings.length === 1 && /no load witness/.test(witness(null, P, 'abc', T + MIN).findings[0]), 'witness: no marker → finding "no load witness"');
  say(/another portrait/.test((witness(mk([T], 'abc', 'voice/OTHER.md'), P, 'abc', T + MIN).findings[0] || '')), 'witness: a marker for another portrait → finding');
  say(witness(mk([T]), P, 'abc', T + MIN).findings.length === 0 && witness(mk([T]), P, 'abc', T + MIN).warnings.length === 0, 'witness: loaded, then written within the hour → clean');
  // the expected moment is computed in THIS machine's zone (2.9: a literal «13:59» held only at +03:00 — red in a UTC container and in any
  // field project west or east of the origin)
  say((witness(mk([T]), P, 'abc', T - MIN).findings[0] || '').includes('the file was last written at ' + localIso(new Date(T - MIN)).slice(0, 16)), 'witness: written BEFORE the first load → finding, both moments in the local zone');
  say(/(\d+) min earlier/.test(witness(mk([T]), P, 'abc', T + 90 * MIN).findings[0] || ''), 'witness: written 90 min after the last load → finding (the hour rule)');
  say(witness(mk([T, T + 80 * MIN]), P, 'abc', T + 90 * MIN).findings.length === 0, 'witness: a re-load 10 min before the write → clean (the load history counts)');
  say(witness(mk([T]), P, 'other', T + MIN).warnings.some((w) => /changed since it was last loaded/.test(w)), 'witness: the portrait changed since the load → warning "reload"');
  say(loadsOf({ firstAt: new Date(T).toISOString(), at: new Date(T + MIN).toISOString() }).length === 2, 'witness: a pre-history marker (firstAt/at only) is still read');
  // 2.8, origin #107: a file equal to the release's template (templateShas, EOL-normalized) is an untouched template — named, never
  // "written past the portrait"
  const TPL = Buffer.from('# Goal\n\n<the owner writes the goal here>\n'), TPLSHA = sha256(TPL);
  say(untouchedTemplate('GOAL.md', TPL, { 'GOAL.md': TPLSHA }) && untouchedTemplate('.\\GOAL.md', TPL, { 'GOAL.md': TPLSHA })
    && untouchedTemplate('GOAL.md', Buffer.from('# Goal\r\n\r\n<the owner writes the goal here>\r\n'), { 'GOAL.md': TPLSHA }),
    'untouched template: equal to the template sha (either path spelling, CRLF on disk) → recognised');
  say(!untouchedTemplate('GOAL.md', Buffer.from('# Goal\n\nThe owner wrote this.\n'), { 'GOAL.md': TPLSHA }) && !untouchedTemplate('STATUS.md', TPL, { 'GOAL.md': TPLSHA })
    && !untouchedTemplate('GOAL.md', TPL, null), 'untouched template: an edited file, another path or no deploy manifest → not a template (the witness judges it)');
  const sec = sectionsMatching(FIX.en.portrait, /^8\./);
  say(sec.matched === 1 && /^# The Owner's Voice Portrait/.test(sec.text) && /## 8\. Machine heuristics/.test(sec.text) && !/## 7\./.test(sec.text) && !/## 9\./.test(sec.text), '--sections keeps the head and the matching sections only');
  say(sectionsMatching(FIX.en.portrait, /^zzz/).matched === 0, '--sections that matches nothing reports zero (the caller refuses to load)');
  // the writing selection of a bare load (2.8)
  const w = writingSelection(WRITING_FIX);
  say(w.kept.map((s) => s.label).join(' ') === '0 1 2 2.1 2-С 5 6 6Б 7', `the writing selection keeps §0 · §1 · §2 · §5 · §6 · §7 with their subsections in file order — a dotted 2.1, a Cyrillic «2-С», «6)» and a field «6Б» (got ${w.kept.map((s) => s.label).join(' ')})`);
  say(/^# Portrait — head line\nthe binding note/.test(w.text) && /## 1\. How to read/.test(w.text) && !/## Corpus registry|## 4\.1|## 8\.|## 9\.|## Правила/.test(w.text), 'the writing text carries the head and §1 (how to read) and never the registry, §4.1, §8, §9 or the unnumbered modules');
  say(w.left.map((s) => s.title).join(' | ') === 'Corpus registry | Правила: Синтаксис и период | Правила: Пунктуация и ритм | Правила: Морфология и грамматика | Правила: Лексика | Правила: Графика | 4.1. Where the owner equals the school | 8. Machine heuristics | 9. Portrait journal', `every left-out section is named, in file order (got ${w.left.map((s) => s.title).join(' | ')})`);
  // genre (2.8, epic VO; origin ticket #102): labels, the applicability rule of the core's storage tool, the check filter, the essay load
  const lab = (h) => labelsOf(h).join('+');
  say(lab('[работа] Назови') === 'work' && lab('[документ] x') === 'document' && lab('[prose] y') === 'prose' && lab('[Work][document] z') === 'work+document',
    `a label opening the hint is read in both languages and in either case, several in a row (got ${lab('[работа] Назови')} · ${lab('[Work][document] z')})`);
  say(lab('[see §5] the rule') === '' && lab('the rule [работа]') === '' && lab('no label') === '', 'a bracketed word that is not a label, a label not OPENING the hint, no brackets — no label');
  const matrix = { work: 'document ticket comment message reply', document: 'document', prose: 'essay', none: 'document ticket comment message reply essay' };
  const got = Object.keys(matrix).map((l) => GENRES.filter((g) => applies({ labels: l === 'none' ? [] : [l] }, g)).join(' '));
  say(JSON.stringify(got) === JSON.stringify(Object.values(matrix)) && applies({ labels: ['work'] }, null),
    `applicability equals the storage tool's rule for every label and each of the six genres; no genre — every row (got ${got.join(' | ')})`);
  const GP = '# P\n\n## 8. Machine heuristics\n\n| pattern | class | hint |\n|---|---|---|\n| `Remember that` | stop | [work] state the rule |\n| `Note that` | stop | say it plainly |\n';
  const gp = parsePortrait(GP);
  const onEssay = lintText('e.md', 'Remember that. Note that.\n', gp.rules.filter((r) => applies(r, 'essay')));
  const onTicket = lintText('t.md', 'Remember that. Note that.\n', gp.rules.filter((r) => applies(r, 'ticket')));
  say(gp.rules[0].labels.join() === 'work' && onEssay.findings.map((f) => f.fragment).join() === 'Note that' && onTicket.findings.length === 2,
    `a [work] row is silent on an essay and names its hit on a ticket; an unlabelled row judges both (essay: ${onEssay.findings.map((f) => f.fragment).join()}; ticket: ${onTicket.findings.length})`);
  const PF = [...WRITING_FIX.slice(0, 7), '## 3. The second register — prose', 'prose rule', ...WRITING_FIX.slice(7)].join('\n');
  const plain = writingSelection(PF), essay = writingSelection(PF, [PROSE_SECTION]);
  say(!plain.kept.some((s) => s.label === '3') && plain.left.some((s) => s.title.startsWith('3.')) && essay.kept.some((s) => s.label === '3') && /prose rule/.test(essay.text),
    'a bare load leaves §3 (free prose) out and names it; the load of an essay keeps it');
  const titles = h2Sections(WRITING_FIX).sections.map((s) => s.title);
  const sels = w.left.map((s) => ({ title: s.title, ...selectorFor(s.title, titles) }));
  say(sels.every((x) => /^[\x20-\x7e]+$/.test(x.sel) && !/["'`\\]/.test(x.sel) && !/\$./.test(x.sel)), `the ready regexes are ASCII with no quote or backslash, a dollar only as the end anchor (got ${sels.map((x) => x.sel).join(' , ')})`);
  say(sels.every((x) => { const r = sectionsMatching(WRITING_FIX, new RegExp(x.sel, 'iu')); return r.matched === 1 + x.also && r.text.includes('## ' + x.title); }), 'each ready regex, run as --sections, loads its own section and exactly as many more as it says');
  const punct = sels.find((x) => /Пунктуация/.test(x.title)), same = sels.filter((x) => /Лексика|Графика/.test(x.title));
  say(punct.also === 0 && punct.sel.endsWith('$'), `two titles that differ only after an equally long word are told apart by the end anchor (got ${punct.sel}, also ${punct.also})`);
  say(same.length === 2 && same.every((x) => x.also === 1), 'two titles of one whole shape cannot be told apart in ASCII — each regex says it loads one more section');
  say(writingSelection(FIX.en.portrait.replace('## 7. ', '## ')).matched === 0 && writingSelection(FIX.en.portrait).matched === 1, 'a portrait with no numbered writing section → zero (the caller loads it whole and says so); the same with its §7 numbered → one');
  say(Math.abs(tokensOf('abcde') - 2) < 1e-9 && Math.abs(tokensOf('абв') - 3 / 1.9) < 1e-9, 'tokens at the core\'s two rates: 5 ASCII characters = 2 tokens, 3 Cyrillic = 3/1.9');
  const here = dirname(fileURLToPath(import.meta.url));
  const tmpl = [join(here, '..', '_owner-voice-template.md'), join(here, '..', 'templates', '_owner-voice-template.md')].find((p) => existsSync(p));
  if (tmpl) {
    const p = parsePortrait(readFileSync(tmpl, 'utf8'));
    say(p.status === 'no-rules' && p.tables === 1, `the shipped skeleton, unfilled → no-rules (its example rows are placeholders; got ${p.status})`);
  } else console.log('  · the shipped skeleton is not beside the module — its unfilled proof skipped (not a failure)');
  if (failed) { console.error(`✖ voice-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ voice-lint selftest OK — ${cases} cases, ${Object.keys(FIX).length} languages: a hit is named with line, fragment and hint; code and comments are invisible; exceptions silence or print; a prose §8 is SKIPPED, never green; a text written before the first load or more than an hour after the last one is written past the portrait`);
}

if (IS_MAIN) {
  if (CMD === 'check') check();
  else if (CMD === 'load') load();
  else if (CMD === 'selftest') selftest();
  else usage(`unknown command "${CMD}"`);
}
