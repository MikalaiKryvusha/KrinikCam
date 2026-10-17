#!/usr/bin/env node
// kaif-testrun-lint.mjs — the OPTIONAL run-report linter (2.7, epic TR; TESTING_FRAMEWORK.md →
// "An executed run produces its report"; origin issue #59 — the owner-QA's word: "THERE WAS NO
// TESTING"). Deployed to .kaif/tools/.
//
// What it mechanizes: the report an EXECUTED run leaves behind in the project's test-doc home,
// as a catalog by date — `<testdocs>/reports/<YYYY-MM-DD>_<work>.md` — keeps its FORM: seven
// fields (Work · Contour · Runs · Checks · Found · Traces · Verdict), none empty; Runs with a
// command in a code span and a moment per run; Found as a list or an explicit "none"; a Verdict
// named by one of four words. The canon requires the report; this linter judges the shape of one
// that was written.
//
// What it does NOT do, said aloud: it cannot see a report that was never written — a `[TESTED: …]`
// claim about a run with no report behind it is the judge's hunt ("tested without a run report"),
// never this linter's finding; and it does not verify that the commands ran — the judge re-executes
// one, this linter only checks that they are there to re-execute.
//
// Boundaries, so the linter never becomes bureaucracy:
//   · field keywords are a per-language table (like the scenario form); a project adds a row;
//   · rules are DATA (one engine + rules-as-data): a new rule is a table row, not a new script;
//   · ADVISORY: exit 1 = findings, exit 0 = judged and clean, exit 3 = SKIPPED (no reports catalog
//     in the home — "not judged" must never read as "clean");
//   · placeholders `<…>` (multi-line, one level nested) and table header/separator rows are not content:
//     an unfilled copy of the template reddens with `empty-field` naming all seven fields, and a copy
//     with ONE field filled reddens naming the other six — one filled row is not a report;
//   · word boundaries are lookarounds on Unicode letters — JavaScript `\b` is blind to non-ASCII
//     letters, a paid-for lesson.
//
// Commands:
//   node .kaif/tools/kaif-testrun-lint.mjs check [home]   # home: .kaif/kaif.json → testdocs, default testcases/
//   node .kaif/tools/kaif-testrun-lint.mjs bug <report>   # 2.8: the tester's bug report — Description · Steps to reproduce ·
//                                                         # Expected result · Actual result + Build · Environment · Evidence; a
//                                                         # «not reproduced» report needs a hunt of ≥ 3 variants (template C, /report-bug)
//   node .kaif/tools/kaif-testrun-lint.mjs selftest       # PROVE every rule on in-memory fixtures (EN + RU):
//                                                         # mutation N reddens rule N and only N, the clean
//                                                         # report yields 0; the shipped template, unfilled, reddens
// [TESTED: 2026-09-12 · selftest 45 cases green (8 rules × 2 languages, mutation N → rule N only; "Functional run:
//  NONE" under pass → pass-without-functional-run only, under partial → clean; a bare label, the template's own
//  placeholder and "NONE (see below)" ABOVE a filled table under pass → the rule (judge of epic CL: `\s*` after the
//  colon had swallowed the newline and the table read as the value); the shipped template unfilled →
//  empty-field naming all seven fields — the bare `Hygiene:`/`Functional run:` labels are scaffold; the template
//  with only Runs filled → empty-field naming the other six); the CL probe BEFORE the rule: a hygiene-only "pass —
//  all 25 closed, all tested" report → exit 0, 0 findings (the loophole #62 measured), AFTER → red by name; the
//  origin's three earlier 2.7 reports reddened until their two lines were added by the facts of their runs;
//  sandbox suite s25 observed: two clean reports (full · NONE under partial) exit 0, nine mutations exit 1 with
//  every rule named (10 findings in 9 reports), no catalog SKIPPED, home read from .kaif/kaif.json → testdocs,
//  deployed copy — template and module arrive, an unfilled copy reddens, a hygiene-only pass reddens by name; red
//  proven on the 2.6 dist via KAIF_DIST («8 of 32») — the origin's run reports: testcases/reports/2026-09-12_polygon-2.7-TR.md
//  (epic TR) and testcases/reports/2026-09-12_polygon-2.7-CL.md (epic CL, this rule)]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// OW8 (KAIF 2.8, origin issue #101): the command runs only when this file IS the program — imported by a project's own tool, the
// module stays silent and never exits the importer (the same guard as the shipped contour's review.mjs).
import { pathToFileURL as __kaifToUrl } from 'node:url';
import { resolve as __kaifResolve } from 'node:path';
const IS_MAIN = import.meta.url === __kaifToUrl(__kaifResolve(process.argv[1] || '')).href;

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const ARG = argv[1];
const EXIT_SKIPPED = 3;
const MARKER = '.kaif/kaif.json';
const DEFAULT_HOME = 'testcases';
const REPORTS_DIR = 'reports';

// ---------------------------------------------------------------------------
// The seven fields per language, in the canonical order of the template. A project whose owner
// writes in another language adds a row; the engine does not change. Rules address fields by ROLE.
export const KEYWORDS = {
  en: ['Work', 'Contour', 'Runs', 'Checks', 'Found', 'Traces', 'Verdict'],
  ru: ['Работа', 'Контур', 'Прогоны', 'Проверки', 'Найдено', 'Следы', 'Вердикт'],
};
export const ROLES = ['work', 'contour', 'runs', 'checks', 'found', 'traces', 'verdict'];
// The two lines that open Checks (2.7, epic CL; origin issue #62 — the owner-QA recounted "25 tested" as 3):
// hygiene (lint · unit · selftest · mutation) and the FUNCTIONAL RUN on the real product by the user's path,
// its result read. Never summed: a Verdict `pass` with no functional run behind it is the loophole the ticket
// measured — hygiene alone is `partial`. Keywords per language, like the fields.
export const LINES = {
  en: { hygiene: 'Hygiene', functional: 'Functional run' },
  ru: { hygiene: 'Гигиена', functional: 'Функциональный прогон' },
};
const LINE_LABELS = Object.values(LINES).flatMap((l) => [l.hygiene, l.functional]);
const LINE_LABEL_RE = new RegExp(`^\\s*(?:${LINE_LABELS.join('|')})\\s*:`, 'iu');
// Whitespace after the colon is LINE-BOUND (`[^\S\n]*`, never `\s*`): under the `u` flag `\s*` spans newlines, so an
// empty value would swallow the next non-blank line — the Checks table — as its "value" (judge of epic CL: a report with a
// bare `Functional run:` or the template's own placeholder above a filled table passed green).
const FUNCTIONAL_LINE = new RegExp(`^[^\\S\\n]*(?:${Object.values(LINES).map((l) => l.functional).join('|')})[^\\S\\n]*:[^\\S\\n]*(.*)$`, 'imu');
// NONE as the whole value or followed only by punctuation — "NONE (see below)", "нет — см. ниже" — or nothing at all;
// "None of the walked flows failed …" is a filled line, not NONE (a word after it is prose, not a qualifier).
const NONE_VALUE = /^(?:(?:none|нет|ноль|n\/a|—|-)(?:\s*$|\s*[(\[—–:;,.])|$)/iu;
const CATALOG_NAME = /^\d{4}-\d{2}-\d{2}_.+\.md$/;              // the date-first name IS the index
const MOMENT = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;                 // a timestamp per run
const CODE_SPAN = /`[^`\n]+`/;                                    // a command the reader can re-run
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/m;                  // one item per defect
const EXPLICIT_NONE = /(?<![\p{L}\p{N}/.])(none|zero|0|ноль|нет)(?![\p{L}\p{N}])/iu;
const VERDICT_WORD = /(?<![\p{L}\p{N}])(pass|fail|blocked|partial)(?![\p{L}\p{N}])/iu;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// Scaffolding is not content: placeholders `<…>` (multi-line and one level nested — the shipped
// template's own placeholders span lines and carry `<feature>` inside), table separator rows and
// table HEADER rows (the row right above a separator). What is left must carry a LETTER: a row
// number or a bare date is not a filled field. (Judge of epic TR: the first cut stripped only
// single-line placeholders, so the unfilled template reddened for the wrong reason and a copy with
// one filled row passed green.)
const PLACEHOLDER = /<(?:[^<>]|<[^<>]*>)*>/g;
const stripScaffold = (s) => {
  const lines = s.replace(PLACEHOLDER, '').split(/\r?\n/);
  return lines.filter((l, i) => !SEPARATOR_ROW.test(l) &&
    !(/^\s*\|/.test(l) && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]))).join('\n');
};
// The two labels of Checks with nothing after the colon are scaffold too (the unfilled template carries them):
// a bare `Hygiene:` is a label, not a filled field.
const hasContent = (s) => /\p{L}/u.test(stripScaffold(s).split(/\r?\n/).filter((l) => !(LINE_LABEL_RE.test(l) && /:\s*$/.test(l))).join('\n'));
// The functional-run line of Checks: absent → null; present → its value after the colon (scaffold stripped).
// Fenced code is not the line (judge of epic CL: a label hidden inside ``` … ``` satisfied the rule).
const functionalRun = (r) => { const m = FUNCTIONAL_LINE.exec(r.text('checks').replace(/```[\s\S]*?```/g, '')); return m ? m[1].trim() : null; };
const verdictIsPass = (r) => { const m = VERDICT_WORD.exec(r.text('verdict')); return !!m && m[1].toLowerCase() === 'pass'; };

// ---------------------------------------------------------------------------
// The rules — data. Each: id · test(report) → true when violated · msg(report).
// report = { name, lang, keys, fields: {role → text}, missing: [keyword…], empty: [keyword…], has(role), text(role) }
export const RULES = [
  { id: 'outside-catalog', test: (r) => !CATALOG_NAME.test(r.name),
    msg: () => 'the report is outside the date catalog — name it <YYYY-MM-DD>_<work>.md (the date-first name is the index)' },
  { id: 'missing-field', test: (r) => r.missing.length > 0,
    msg: (r) => `missing field(s): ${r.missing.join(', ')} — the seven fields are ${r.keys.join(' · ')}` },
  { id: 'empty-field', test: (r) => r.empty.length > 0,
    msg: (r) => `empty field(s): ${r.empty.join(', ')} — placeholders are not content` },
  { id: 'runs-no-command', test: (r) => r.has('runs') && !CODE_SPAN.test(r.text('runs')),
    msg: () => 'Runs carries no command in a code span — the reader must be able to re-run it' },
  { id: 'runs-no-moment', test: (r) => r.has('runs') && !MOMENT.test(r.text('runs')),
    msg: () => 'Runs carries no moment (YYYY-MM-DD HH:MM) — when did it run?' },
  { id: 'found-not-explicit', test: (r) => r.has('found') && !LIST_ITEM.test(r.text('found')) && !EXPLICIT_NONE.test(r.text('found')),
    msg: () => 'Found is neither a list of defects nor an explicit "none" — zero is a finding, silence is not' },
  { id: 'verdict-not-named', test: (r) => r.has('verdict') && !VERDICT_WORD.test(r.text('verdict')),
    msg: () => 'Verdict names none of pass · fail · blocked · partial' },
  // CL (2.7, #62): `pass` is a claim about the product; hygiene alone does not back it. The functional-run line
  // must be there and must not say NONE — NONE itself is honest (fixed, not tested); `pass` above it is the fraud.
  { id: 'pass-without-functional-run', test: (r) => verdictIsPass(r) && (functionalRun(r) === null || NONE_VALUE.test(functionalRun(r))),
    msg: (r) => `Verdict says pass while Checks ${functionalRun(r) === null ? 'carries no' : 'says NONE on the'} "${LINES[r.lang].functional}:" line — hygiene alone is partial, never pass: name what was walked on the real product, on which contour and what was READ, or write partial` },
];
export const RULE_IDS = RULES.map((r) => r.id);

// ---------------------------------------------------------------------------
// Parsing — the H2 headings of a report (`## 3. Runs`, `## Runs`, `## 3) <localized keyword> …`) and their bodies.
const roleOf = (title) => {
  for (const [lang, keys] of Object.entries(KEYWORDS))
    for (let i = 0; i < keys.length; i++)
      if (new RegExp(`^${keys[i]}(?![\\p{L}])`, 'iu').test(title)) return { lang, role: ROLES[i] };
  return null;
};

export function parseReport(name, src) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const fields = {};
  let lang = null, cur = null, fence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) { fence = !fence; if (cur) fields[cur] += l + '\n'; continue; }
    const m = !fence && /^##\s+(?:\d+[.)]\s*)?(.+?)\s*$/.exec(l);
    if (m) {
      const hit = roleOf(m[1]);
      if (hit) { lang = lang || hit.lang; cur = hit.role; fields[cur] = fields[cur] || ''; continue; }
      cur = null; continue;                                          // a foreign H2 — its body is nobody's
    }
    if (cur) fields[cur] += l + '\n';
  }
  lang = lang || 'en';
  const keys = KEYWORDS[lang];
  const missing = ROLES.filter((r) => !(r in fields)).map((r) => keys[ROLES.indexOf(r)]);
  const empty = ROLES.filter((r) => r in fields && !hasContent(fields[r])).map((r) => keys[ROLES.indexOf(r)]);
  return { name, lang, keys, fields, missing, empty,
           has: (role) => role in fields && hasContent(fields[role]),
           text: (role) => stripScaffold(fields[role] || '') };
}

export function lint(name, src) {
  const r = parseReport(name, src);
  return RULES.filter((rule) => rule.test(r)).map((rule) => ({ id: rule.id, msg: rule.msg(r) }));
}

// ---------------------------------------------------------------------------
// The SECOND genre (2.8, epic TB; origin issue #105 — the owner-QA: the tester's bug report is Description · Steps to reproduce ·
// Expected result · Actual result, and exact steps are «an important part of the QA activity»): the report a tester hands to a
// developer. Four H2 sections, three bold lines, the steps a numbered list (the user's path, one action per item), and — when the
// report says the defect did NOT reproduce — a reproduction hunt of at least three variants with their outcomes. Same engine, rules
// as data, keywords per language; `bug <report>` judges one file.
// [TESTED: 2026-09-26 · selftest 95 cases after the TB3 and court RL1 fixes (67 at TB1); s25 section 5 on the deployed copy (a report built from the delivered template C, six
//  answers); four field deployments updated by their own 2.7 core — `bug` on two of them read; 7 mutants on their addressees;
//  report testcases/reports/2026-09-26_tb1-tester-report-and-hunt.md]
export const BUG_KEYWORDS = {
  en: { sections: ['Description', 'Steps to reproduce', 'Expected result', 'Actual result'], hunt: 'Reproduction hunt', lines: ['Build', 'Environment', 'Evidence'],
        match: { sections: ['description', 'steps to reproduce|reproduction steps', 'expected results?|expected behaviou?r', 'actual results?|actual behaviou?r'], hunt: 'reproduction hunt', lines: ['build', 'environment', 'evidence'] },
        // a negation, up to two words, then the stem (court RL1 D-F1: «Cannot be reproduced», «Doesn't reproduce», «No repro», «Not able to
        // reproduce» passed the first list of phrases) — and the adjective forms
        notReproduced: [`(?:not|never|no|cannot|can['’]t|couldn['’]t|doesn['’]t|don['’]t|didn['’]t|won['’]t|wasn['’]t|isn['’]t|unable\\s+to|failed\\s+to)(?:\\s+\\p{L}+){0,2}?\\s+repro`, '(?:ir|un|non-?)reproduc'] },
  ru: { sections: ['Описание', 'Шаги воспроизведения', 'Ожидаемый результат', 'Фактический результат'], hunt: 'Охота за шагами', lines: ['Сборка', 'Окружение', 'Улики'],
        match: { sections: ['описание', 'шаги воспроизведения', `ожидаем\\p{L}* результат\\p{L}*`, `фактическ\\p{L}* результат\\p{L}*`], hunt: 'охота за (?:шагами|воспроизведением)', lines: ['сборка', 'окружение|среда', 'улики|доказательства|свидетельства'] },
        // «не», up to two words, then the stem (не удаётся · не смог · не получилось воспроизвести); the reverse order; the adjective; «не повторяется»
        notReproduced: ['не(?:\\s+\\p{L}+){0,2}?\\s+воспроизв', 'воспроизв\\p{L}*\\s+не\\s', 'невоспроизв', 'не\\s+повтор'] },
};
export const BUG_ROLES = ['description', 'steps', 'expected', 'actual'];
export const HUNT_MIN = 3;
const NUMBERED_ITEM = /^\s*\d+[.)]\s+\S/m;
// the verdict «did not reproduce» in both languages, by negation-around-the-stem patterns (TB3 F1: one phrase per language let «не
// воспроизводится» pass; court RL1 D-F1: a longer list of phrases still let 14 of 18 forms pass — the very failure of issue #105)
const NOT_REPRO = new RegExp(`(?<![\\p{L}])(?:${Object.values(BUG_KEYWORDS).flatMap((k) => k.notReproduced).join('|')})`, 'iu');
const STATUS_LINE = /\*\*(?:status|статус):?\*\*:?([^\n]*)/iu;
export function parseBug(src) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const fields = {};
  let lang = null, cur = null, fence = false, outside = '';   // `outside` — the text beyond the hunt: its rows legally carry «not reproduced»
  const roleOfBug = (title) => {
    for (const [lg, kw] of Object.entries(BUG_KEYWORDS)) {
      const i = kw.match.sections.findIndex((k) => new RegExp(`^(?:${k})(?![\\p{L}])`, 'iu').test(title));
      if (i >= 0) return { lang: lg, role: BUG_ROLES[i] };
      if (new RegExp(`^(?:${kw.match.hunt})(?![\\p{L}])`, 'iu').test(title)) return { lang: lg, role: 'hunt' };
    }
    return null;
  };
  for (const l of lines) {
    if (/^\s*```/.test(l)) { fence = !fence; if (cur) fields[cur] += l + '\n'; continue; }
    const m = !fence && /^#{2,3}\s+(?:\d+[.)]?\s+)?(.+?)\s*$/.exec(l);
    // (court RL 2.8, D-F6) a bold heading «## **Description**» is the same section
    if (m) { const hit = roleOfBug(m[1].replace(/^[*_]+\s*|\s*[*_]+$/g, '')); if (hit) { lang = lang || hit.lang; cur = hit.role; fields[cur] = fields[cur] || ''; } else cur = null; continue; }
    if (cur) fields[cur] += l + '\n';
    if (cur !== 'hunt' && !fence) outside += l + '\n';
  }
  lang = lang || 'en';
  const kw = BUG_KEYWORDS[lang];
  const body = src.replace(/```[\s\S]*?```/g, '');
  const missing = BUG_ROLES.filter((r) => !(r in fields)).map((r) => kw.sections[BUG_ROLES.indexOf(r)]);
  const empty = BUG_ROLES.filter((r) => r in fields && !hasContent(fields[r])).map((r) => kw.sections[BUG_ROLES.indexOf(r)]);
  // A line counts only when its VALUE — up to the next " · **Label" or the line end — carries a letter or a digit: with the
  // placeholders stripped, the unfilled template's "**Build:**  · **Environment:** …" would otherwise pass on the "·" alone.
  const bare = body.replace(PLACEHOLDER, '');
  // (court RL 2.8, D-F6) a label alone on its line takes its value from the NEXT line («**Build:**» ⏎ «2.8.1 (a1b2c3d)») — only when
  // nothing follows the label on its own line, and never a heading or another bold label
  const lineValue = (label) => {
    const m = new RegExp(`\\*\\*(?:${label}):?\\*\\*:?([^\\n]*?)(?=\\s+·\\s+\\*\\*|\\r?\\n|$)`, 'iu').exec(bare);
    if (!m) return undefined;
    const after = bare.slice(m.index + m[0].length);
    if (/[\p{L}\p{N}]/u.test(m[1]) || !/^[ \t]*\r?\n/.test(after)) return m[1];
    const next = after.split(/\r?\n/)[1] || '';
    return /^\s*(?:#|\*\*[^*\n]+\*\*)/.test(next) ? m[1] : next;
  };
  const missingLines = kw.lines.filter((label, i) => !/[\p{L}\p{N}]/u.test(lineValue(kw.match.lines[i]) || ''));
  const status = STATUS_LINE.exec(outside.replace(PLACEHOLDER, ''));
  const notRepro = status ? NOT_REPRO.test(status[1]) : NOT_REPRO.test(outside.replace(/`[^`\n]*`/g, ''));
  // a variant is a row of a REAL table (a separator row under its header) whose last cell — the outcome — says something (TB3 F4:
  // nested sub-items, a header without a separator and rows with an empty outcome were counted; court RL 2.8, D-F5: a list item carries
  // no outcome of its own and was counted — the template's form is the table `| # | variant (axis: value) | outcome |`)
  const rawHunt = fields.hunt || '';
  const realTable = rawHunt.split(/\r?\n/).some((l) => SEPARATOR_ROW.test(l));
  const huntText = stripScaffold(rawHunt);
  const outcome = (l) => { const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()); return cells.length >= 2 && /[\p{L}\p{N}]/u.test(cells[cells.length - 1]); };
  const variants = huntText.split(/\r?\n/).filter((l) => realTable && /^\s*\|/.test(l) && outcome(l)).length;
  return { lang, kw, fields, missing, empty, missingLines, notRepro, variants,
           has: (role) => role in fields && hasContent(fields[role]), text: (role) => stripScaffold(fields[role] || '') };
}
export const BUG_RULES = [
  { id: 'missing-section', test: (b) => b.missing.length > 0,
    msg: (b) => `missing section(s): ${b.missing.join(', ')} — a tester's report is ${b.kw.sections.join(' · ')}` },
  { id: 'empty-section', test: (b) => b.empty.length > 0,
    msg: (b) => `empty section(s): ${b.empty.join(', ')} — placeholders are not content` },
  { id: 'missing-line', test: (b) => b.missingLines.length > 0,
    msg: (b) => `missing line(s): ${b.missingLines.map((l) => `**${l}:**`).join(' · ')} — the developer needs the build, the environment and the evidence` },
  { id: 'steps-not-a-path', test: (b) => b.has('steps') && !NUMBERED_ITEM.test(b.text('steps')),
    msg: (b) => `${b.kw.sections[1]} is not a numbered list — the steps are the user's path in the product, one action per item` },
  { id: 'hunt-too-short', test: (b) => b.notRepro && b.variants < HUNT_MIN,
    msg: (b) => `the report says the defect did not reproduce, and «${b.kw.hunt}» lists ${b.variants} variant(s) — fewer than ${HUNT_MIN} tried: one attempt is never a verdict (TESTING_FRAMEWORK.md → Hunt the reproduction); a variant is a row of the table | # | variant (axis: value) | outcome | with its outcome filled` },
];
export const BUG_RULE_IDS = BUG_RULES.map((r) => r.id);
export function lintBug(src) {
  const b = parseBug(src);
  return BUG_RULES.filter((rule) => rule.test(b)).map((rule) => ({ id: rule.id, msg: rule.msg(b) }));
}
function bugCheck(file) {
  // (court RL 2.8, D-F6) the words a report may use per language — the template in English cannot carry them, the linter prints them
  if (file === '--keywords') {
    for (const [lg, kw] of Object.entries(BUG_KEYWORDS))
      console.log(`${lg}: sections ${kw.sections.map((s) => `## ${s}`).join(' · ')} · hunt ## ${kw.hunt} · lines ${kw.lines.map((l) => `**${l}:**`).join(' · ')}`);
    return;
  }
  if (!file || !existsSync(file)) { console.error(`✖ testrun-lint bug: no such report: ${file || '(none named)'} — usage: kaif-testrun-lint.mjs bug <report.md>`); process.exit(1); }
  if (!statSync(file).isFile()) { console.error(`✖ testrun-lint bug: ${file} is not a file — name ONE report: kaif-testrun-lint.mjs bug <report.md>`); process.exit(1); }
  const found = lintBug(readFileSync(file, 'utf8'));
  for (const x of found) console.log(`✖ ${file.replace(/\\/g, '/')} — ${x.id}: ${x.msg}`);
  if (found.length) { console.log(`✖ testrun-lint bug: ${found.length} finding(s) — a report the developer cannot act on goes back to the tester`); process.exit(1); }
  console.log(`✅ testrun-lint bug OK — ${file.replace(/\\/g, '/')}: four sections, three lines, the steps a path${parseBug(readFileSync(file, 'utf8')).notRepro ? `, a hunt of ${parseBug(readFileSync(file, 'utf8')).variants} variants` : ''}`);
}

// ---------------------------------------------------------------------------
function homeOf(arg) {
  if (arg) return arg;
  try {
    const j = JSON.parse(readFileSync(MARKER, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof j.testdocs === 'string' && j.testdocs.trim()) return j.testdocs.trim();
  } catch { /* no marker or unreadable — the default home stands */ }
  return DEFAULT_HOME;
}

function check(arg) {
  const home = homeOf(arg);
  const dir = join(home, REPORTS_DIR);
  const shown = dir.replace(/\\/g, '/') + '/';
  const files = existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => /\.md$/i.test(f) && statSync(join(dir, f)).isFile()).sort() : [];
  if (!files.length) {
    console.log(`⚠ testrun-lint SKIPPED — no reports catalog at ${shown} (home "${home}"${arg ? '' : ` — ${MARKER} → testdocs, default ${DEFAULT_HOME}/`}); nothing was judged — an unwritten report is invisible to this linter (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  let nF = 0;
  for (const f of files)
    for (const x of lint(f, readFileSync(join(dir, f), 'utf8'))) { nF++; console.log(`✖ ${shown}${f} — ${x.id}: ${x.msg}`); }
  if (nF) { console.log(`✖ testrun-lint: ${nF} finding(s) in ${files.length} report(s) under ${shown} — a run without a report in form is a run the owner cannot see`); process.exit(1); }
  console.log(`✅ testrun-lint OK — ${files.length} report(s) under ${shown}, 0 findings`);
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures, in both shipped languages:
// mutation N reddens rule N and only N; the clean report yields 0; the shipped template, unfilled, reddens.
const CLEAN = {
  en: {
    work: 'The polygon of the deploy/update machinery against `plans/104` criteria 7–8; case set — the 24 suites of `tools/sandbox-suite.mjs`.',
    contour: 'Machinery `KAIF-CORE.mjs` + tool modules; stand — a clean checkout at `231c063`, Node v24, Windows 11; no production involved.',
    runs: '| # | Moment | Command | Exit / outcome |\n|---|---|---|---|\n| 1 | 2026-09-12 11:05 +03:00 | `npm run test:core` | 0 — all 24 suites green |',
    checks: 'Hygiene: selftest 31/31 · s25 27/27\nFunctional run: the deployed copy under s25 — `.kaif/kaif-core.mjs check` and the deployed linter run as the user of the shipment, their output READ (the warning names GOAL.md; the unfilled copy reddens)\n\n| Case | Status | Observation |\n|---|---|---|\n| s25 linter half | pass | selftest OK, bad fixture exit 1 with 7 rules named |',
    found: '- none',
    traces: '- the polygon log: `run.log` in the session scratchpad',
    verdict: 'pass — every suite green on the first run after the build.',
  },
  ru: {
    work: 'Полигон машинерии развёртывания и обновления против критериев 7–8 `plans/104`; набор кейсов — 24 свода `tools/sandbox-suite.mjs`.',
    contour: 'Машинерия `KAIF-CORE.mjs` + tool-модули; стенд — чистый чекаут `231c063`, Node v24, Windows 11; продакшена нет.',
    runs: '| # | Момент | Команда | Код / исход |\n|---|---|---|---|\n| 1 | 2026-09-12 11:05 +03:00 | `npm run test:core` | 0 — все 24 свода зелёные |',
    checks: 'Гигиена: selftest 31/31 · s25 27/27\nФункциональный прогон: развёрнутая копия под s25 — `.kaif/kaif-core.mjs check` и развёрнутый линтер запущены как пользователь поставки, вывод ПРОЧИТАН (предупреждение называет GOAL.md; незаполненная копия краснеет)\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| половина линтера s25 | pass | selftest OK, плохая фикстура exit 1 с 7 правилами |',
    found: 'ноль',
    traces: '- лог полигона: `run.log` в скретчпаде сессии',
    verdict: 'pass — все своды зелёные с первого прогона после сборки.',
  },
};
// Each mutation is a role → replacement body (null = drop the section); the name mutation is separate.
const MUTATIONS = {
  en: {
    'missing-field': ['contour', null],
    'empty-field': ['contour', '<the stand it ran on>'],
    'runs-no-command': ['runs', '| 1 | 2026-09-12 11:05 +03:00 | ran the polygon by hand | 0 |'],
    'runs-no-moment': ['runs', '| 1 | this morning | `npm run test:core` | 0 |'],
    'found-not-explicit': ['found', 'We looked at the output and everything seemed fine.'],
    'verdict-not-named': ['verdict', 'Everything went well, no worries.'],
    'pass-without-functional-run': ['checks', 'Hygiene: unit 5/5 · selftest 14/14 · mutation K4 2 red on target\n\n| Case | Status | Observation |\n|---|---|---|\n| unit | pass | 5/5 |'],
  },
  ru: {
    'missing-field': ['contour', null],
    'empty-field': ['contour', '<стенд, на котором гоняли>'],
    'runs-no-command': ['runs', '| 1 | 2026-09-12 11:05 +03:00 | гоняли полигон руками | 0 |'],
    'runs-no-moment': ['runs', '| 1 | утром | `npm run test:core` | 0 |'],
    'found-not-explicit': ['found', 'Смотрели вывод, всё выглядело спокойно.'],
    'verdict-not-named': ['verdict', 'Всё прошло хорошо.'],
    'pass-without-functional-run': ['checks', 'Гигиена: юнит 5/5 · селфтест 14/14 · мутация К4 2 красных адресно\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| юнит | pass | 5/5 |'],
  },
};
// The second skin of the same rule — the line is there and says NONE — and the legal pair beside it: NONE with `partial`.
const NONE_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: NONE', ru: 'Гигиена: юнит 5/5\nФункциональный прогон: NONE' };
// Judge of epic CL: the label with NO value above a filled table, and the template's own placeholder above it, must not
// read as a filled line — the whitespace after the colon is line-bound.
const TABLE = { en: '\n\n| Case | Status | Observation |\n|---|---|---|\n| unit | pass | 5/5 |', ru: '\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| юнит | pass | 5/5 |' };
const BARE_LINE = { en: 'Hygiene: unit 5/5\nFunctional run:' + TABLE.en, ru: 'Гигиена: юнит 5/5\nФункциональный прогон:' + TABLE.ru };
const PLACEHOLDER_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: <what was walked · on which contour · what was READ — or NONE>' + TABLE.en,
                           ru: 'Гигиена: юнит 5/5\nФункциональный прогон: <что пройдено · на каком контуре · что ПРОЧИТАНО — или NONE>' + TABLE.ru };
const NONE_PREFIX_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: NONE (see below)' + TABLE.en, ru: 'Гигиена: юнит 5/5\nФункциональный прогон: нет (см. ниже)' + TABLE.ru };
// …and a real line that merely STARTS with the word is content, never NONE (judge of epic CL: "None of the flows failed").
const NONE_WORD_CONTENT = { en: 'Hygiene: unit 5/5\nFunctional run: None of the 12 walked flows failed — stage, as the user, every screen read' + TABLE.en,
                            ru: 'Гигиена: юнит 5/5\nФункциональный прогон: нет ни одного упавшего из 12 пройденных путей — стейдж, как пользователь, каждый экран прочитан' + TABLE.ru };
const PARTIAL_VERDICT = { en: 'partial — fixed, not tested: hygiene green, no functional run yet.', ru: 'partial — починено, не протестировано: гигиена зелёная, функционального прогона ещё не было.' };
const CLEAN_NAME = '2026-09-12_polygon.md';
const render = (lang, bodies) => {
  const keys = KEYWORDS[lang];
  let out = `# Test run report — polygon\n\n**Created:** 2026-09-12 11:20 +03:00\n\n`;
  ROLES.forEach((role, i) => { if (bodies[role] === null) return; out += `## ${i + 1}. ${keys[i]}\n\n${bodies[role]}\n\n`; });
  return out;
};

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(CLEAN)) {
    const clean = lint(CLEAN_NAME, render(lang, CLEAN[lang]));
    say(clean.length === 0, `${lang}: clean report — 0 findings${clean.length ? ' (got ' + clean.map((x) => x.id).join(',') + ')' : ''}`);
    const outside = lint('smoke.md', render(lang, CLEAN[lang])).map((x) => x.id);
    say(outside.length === 1 && outside[0] === 'outside-catalog', `${lang}: mutation outside-catalog → exactly [outside-catalog] (got [${outside.join(',')}])`);
    for (const id of RULE_IDS) {
      if (id === 'outside-catalog') continue;
      const mut = MUTATIONS[lang][id];
      say(!!mut, `${lang}: rule ${id} has a mutation`);
      if (!mut) continue;
      const got = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], [mut[0]]: mut[1] })).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang}: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
    // CL (#62): the line present and saying NONE under a `pass` → the same rule; NONE under `partial` → clean.
    const none = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_LINE[lang] })).map((x) => x.id);
    say(none.length === 1 && none[0] === 'pass-without-functional-run', `${lang}: "Functional run: NONE" under pass → exactly [pass-without-functional-run] (got [${none.join(',')}])`);
    const partial = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_LINE[lang], verdict: PARTIAL_VERDICT[lang] })).map((x) => x.id);
    say(partial.length === 0, `${lang}: "Functional run: NONE" under partial → clean — fixed, not tested, said honestly (got [${partial.join(',')}])`);
    for (const [name, body] of [['bare label above a filled table', BARE_LINE[lang]], ["the template's own placeholder above a filled table", PLACEHOLDER_LINE[lang]], ['"NONE (see below)" — NONE as the first word', NONE_PREFIX_LINE[lang]]]) {
      const got = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: body })).map((x) => x.id);
      say(got.length === 1 && got[0] === 'pass-without-functional-run', `${lang}: ${name} under pass → exactly [pass-without-functional-run] (got [${got.join(',')}])`);
    }
    const wordContent = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_WORD_CONTENT[lang] })).map((x) => x.id);
    say(wordContent.length === 0, `${lang}: a filled line that merely starts with the word none/нет under pass → clean (got [${wordContent.join(',')}])`);
    const fenced = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: '```\n' + LINES[lang].functional + ': walked, read\n```' + TABLE[lang] })).map((x) => x.id);
    say(fenced.length === 1 && fenced[0] === 'pass-without-functional-run', `${lang}: the label only inside a code fence under pass → exactly [pass-without-functional-run] (got [${fenced.join(',')}])`);
  }
  // A report whose headings are recognised in neither language names all seven fields missing.
  const foreign = lint(CLEAN_NAME, '# Report\n\n## Summary\n\nfine\n').map((x) => x.id);
  say(foreign.length === 1 && foreign[0] === 'missing-field', `unrecognised headings → [missing-field] naming all seven (got [${foreign.join(',')}])`);
  // The shipped template, copied unfilled, reddens — placeholders are not content.
  const here = dirname(fileURLToPath(import.meta.url));
  const tmpl = [join(here, '..', '_testrun-report-template.md'), join(here, '..', 'templates', '_testrun-report-template.md')].find((p) => existsSync(p));
  if (tmpl) {
    const text = readFileSync(tmpl, 'utf8');
    const got = lint(CLEAN_NAME, text);
    const allSeven = got.length === 1 && got[0].id === 'empty-field' && KEYWORDS.en.every((k) => got[0].msg.includes(k));
    say(allSeven, `the shipped template, unfilled → exactly [empty-field] naming all seven fields (got [${got.map((x) => x.id).join(',')}])`);
    // One filled field is not a report: the copy with a real Runs row and nothing else names the other six.
    const runsOnly = text.replace(/## 3\. Runs[\s\S]*?(?=## 4\. )/, `## 3. Runs\n\n${CLEAN.en.runs}\n\n`);
    const six = lint(CLEAN_NAME, runsOnly);
    say(six.length === 1 && six[0].id === 'empty-field' && !six[0].msg.includes('Runs') &&
        KEYWORDS.en.filter((k) => k !== 'Runs').every((k) => six[0].msg.includes(k)),
      `the template with only Runs filled → [empty-field] naming the other six (got [${six.map((x) => x.id).join(',')}])`);
  } else console.log('  · the shipped template is not beside the module — its unfilled-copy proof skipped (not a failure)');
  // The second genre (2.8, TB): the tester's bug report — clean → 0; each rule red on its own mutation only; the hunt rule at 2 and 3.
  const BUG = {
    en: { title: '# The Pay button does not answer a second tap', lines: '**Build:** 2.8.1 (a1b2c3d) · **Environment:** Android 14, Chrome 129, stage, a fresh account · **Evidence:** screen recording `cart-pay-2nd-tap.mp4`',
          description: 'In the cart, a second tap on «Pay» does nothing once the first payment was cancelled.',
          steps: '1. Open the cart with one item.\n2. Tap «Pay», then cancel on the payment screen.\n3. Tap «Pay» again.',
          expected: 'The payment screen opens again (requirement CART-12).', actual: 'Nothing happens; the console shows `TypeError: order is null`.',
          status: '**Status:** not reproduced after the variants below', row: (i, out) => `| ${i} | position: the cart scrolled to item ${i} | ${out} |`, head: '| # | variant | outcome |\n|---|---|---|' },
    ru: { title: '# Кнопка «Оплатить» не отвечает на второе нажатие', lines: '**Сборка:** 2.8.1 (a1b2c3d) · **Окружение:** Android 14, Chrome 129, стейдж, свежая учётная запись · **Улики:** запись экрана `cart-pay-2nd-tap.mp4`',
          description: 'В корзине второе нажатие «Оплатить» ничего не делает, если первую оплату отменили.',
          steps: '1. Открыть корзину с одним товаром.\n2. Нажать «Оплатить», на экране оплаты — отмена.\n3. Нажать «Оплатить» снова.',
          expected: 'Экран оплаты открывается снова (требование CART-12).', actual: 'Ничего не происходит; в консоли `TypeError: order is null`.',
          status: '**Статус:** не воспроизвелось на вариантах ниже', row: (i, out) => `| ${i} | позиция: корзина прокручена до товара ${i} | ${out} |`, head: '| # | вариант | исход |\n|---|---|---|' },
  };
  const renderBug = (lang, over = {}, huntRows = null, notRepro = false) => {
    const f = { ...BUG[lang], ...over }; const k = BUG_KEYWORDS[lang].sections;
    let out = `${f.title}\n\n${f.lines}\n${notRepro || over.status ? f.status + '\n' : ''}\n`;
    ['description', 'steps', 'expected', 'actual'].forEach((role, i) => { if (f[role] !== null) out += `## ${k[i]}\n\n${f[role]}\n\n`; });
    if (huntRows) out += `## ${BUG_KEYWORDS[lang].hunt}\n\n${f.head}\n${huntRows.join('\n')}\n`;
    return out;
  };
  const BUG_MUT = {
    'missing-section': (lang) => renderBug(lang, { expected: null }),
    'empty-section': (lang) => renderBug(lang, { actual: '<what happens — the exact text, screen, log line>' }),
    'missing-line': (lang) => renderBug(lang, { lines: BUG[lang].lines.replace(/ · \*\*[^*]+:\*\* [^·]+$/, '') }),
    'steps-not-a-path': (lang) => renderBug(lang, { steps: lang === 'en' ? 'Tap Pay twice after a cancel.' : 'Дважды нажать «Оплатить» после отмены.' }),
    'hunt-too-short': (lang) => renderBug(lang, {}, [BUG[lang].row(1, 'not reproduced'), BUG[lang].row(2, 'not reproduced')], true),
  };
  for (const lang of Object.keys(BUG)) {
    const clean = lintBug(renderBug(lang)).map((x) => x.id);
    say(clean.length === 0, `${lang} bug: the clean tester's report — 0 findings (got [${clean.join(',')}])`);
    for (const id of BUG_RULE_IDS) {
      const got = lintBug(BUG_MUT[id](lang)).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang} bug: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
    // TB3 F1: every form of the verdict reddens a one-variant hunt; the Status line decides when present; inline code is no verdict
    // court RL1 D-F1: the eighteen forms of the judge (fourteen of them passed the first edition with one variant)
    const FORMS = { en: ['Could not reproduce', 'cannot reproduce', 'not reproducible', 'Cannot be reproduced', 'Could not be reproduced', 'Does not reproduce', "Doesn't reproduce", 'No repro', "Can't repro", 'Not reproducing', 'Not able to reproduce'],
      ru: ['не воспроизводится', 'не удалось воспроизвести', 'не воспроизведено', 'не удаётся воспроизвести', 'не смог воспроизвести', 'не получилось воспроизвести', 'воспроизвести не получилось', 'невоспроизводимо', 'не повторяется'] };
    for (const form of FORMS[lang]) {
      const one = lintBug(renderBug(lang, { status: `**${lang === 'en' ? 'Status' : 'Статус'}:** ${form}` }, [BUG[lang].row(1, form)], true)).map((x) => x.id);
      say(one.length === 1 && one[0] === 'hunt-too-short', `${lang} bug: «${form}» with one variant → exactly [hunt-too-short] (got [${one.join(',')}])`);
    }
    const bodyWord = lintBug(renderBug(lang, { status: `**${lang === 'en' ? 'Status' : 'Статус'}:** ${lang === 'en' ? 'reproduced on Android' : 'воспроизводится на Android'}`, actual: lang === 'en' ? 'Nothing happens (it was not reproduced on iOS).' : 'Ничего не происходит (на iOS не воспроизводится).' }, null, true)).map((x) => x.id);
    say(bodyWord.length === 0, `${lang} bug: the Status line says reproduced — a «not reproduced» in the body is no verdict (got [${bodyWord.join(',')}])`);
    const inCode = lintBug(renderBug(lang, { actual: lang === 'en' ? 'The log prints `not reproduced`.' : 'Лог печатает `не воспроизведено`.' })).map((x) => x.id);
    say(inCode.length === 0, `${lang} bug: «not reproduced» inside inline code — no verdict (got [${inCode.join(',')}])`);
    // TB3 F4: a row with an empty outcome and a nested sub-item are no variants
    const holes = lintBug(renderBug(lang, {}, [BUG[lang].row(1, 'not reproduced'), BUG[lang].row(2, 'not reproduced'), `| 3 | ${lang === 'en' ? 'network: offline' : 'сеть: офлайн'} |  |`], true)).map((x) => x.id);
    say(holes.length === 1 && holes[0] === 'hunt-too-short', `${lang} bug: a hunt row with an empty outcome is not a variant → [hunt-too-short] (got [${holes.join(',')}])`);
    // TB3 F5: plural headings, a number without its dot and an H3 hunt are the same sections
    const heads = lintBug(renderBug(lang, {}, [1, 2, 3].map((i) => BUG[lang].row(i, 'not reproduced')), true)
      .replace(/^## (Expected result|Ожидаемый результат)$/m, (h, t) => (lang === 'en' ? '## 3 Expected results' : '## 3 Ожидаемые результаты'))
      .replace(/^## (Reproduction hunt|Охота за шагами)$/m, (h, t) => `### ${t}`)).map((x) => x.id);
    say(heads.length === 0, `${lang} bug: «## 3 Expected results» and an H3 hunt — the same sections (got [${heads.join(',')}])`);
    // court RL 2.8, D-F5: a list of three tries carries no outcome of its own — no variants → [hunt-too-short]
    const listHunt = lintBug(renderBug(lang, {}, null, true) + `## ${BUG_KEYWORDS[lang].hunt}\n\n- ${lang === 'en' ? 'network: offline' : 'сеть: офлайн'}\n- ${lang === 'en' ? 'position: item 3' : 'позиция: товар 3'}\n- ${lang === 'en' ? 'account: fresh' : 'учётка: свежая'}\n`).map((x) => x.id);
    say(listHunt.length === 1 && listHunt[0] === 'hunt-too-short', `${lang} bug: a hunt of three LIST items without outcomes → [hunt-too-short] (got [${listHunt.join(',')}])`);
    // court RL 2.8, D-F6: bold headings are the same sections; a label alone on its line takes the next line as its value; labels
    // stacked with nothing under them still name all three
    const boldHeads = lintBug(renderBug(lang).replace(/^## (.+)$/gm, '## **$1**')).map((x) => x.id);
    say(boldHeads.length === 0, `${lang} bug: «## **${BUG_KEYWORDS[lang].sections[0]}**» — the same sections (got [${boldHeads.join(',')}])`);
    const nextLine = lintBug(renderBug(lang, { lines: BUG_KEYWORDS[lang].lines.map((l) => `**${l}:**\n${l === BUG_KEYWORDS[lang].lines[0] ? '2.8.1 (a1b2c3d)' : 'Android 14 · stage'}\n`).join('\n') })).map((x) => x.id);
    say(nextLine.length === 0, `${lang} bug: a label alone on its line, the value on the next → clean (got [${nextLine.join(',')}])`);
    const stacked = lintBug(renderBug(lang, { lines: BUG_KEYWORDS[lang].lines.map((l) => `**${l}:**`).join('\n') }));
    say(stacked.length === 1 && stacked[0].id === 'missing-line', `${lang} bug: three labels stacked with no values → exactly [missing-line] (got [${stacked.map((x) => x.id).join(',')}])`);
    // The unfilled template's lines row — labels with placeholders only — names all three lines, never passes on the separators.
    const bareLines = lintBug(renderBug(lang, { lines: BUG_KEYWORDS[lang].lines.map((l) => `**${l}:** <${l.toLowerCase()}>`).join(' · ') }));
    say(bareLines.length === 1 && bareLines[0].id === 'missing-line' && BUG_KEYWORDS[lang].lines.every((l) => bareLines[0].msg.includes(`**${l}:**`)),
      `${lang} bug: the lines row with placeholders only → exactly [missing-line] naming all three (got [${bareLines.map((x) => x.id).join(',')}])`);
    const three = lintBug(renderBug(lang, {}, [1, 2, 3].map((i) => BUG[lang].row(i, 'not reproduced')), true)).map((x) => x.id);
    say(three.length === 0, `${lang} bug: not reproduced with a hunt of three variants → clean (got [${three.join(',')}])`);
    const found = lintBug(renderBug(lang, {}, [BUG[lang].row(1, 'not reproduced'), BUG[lang].row(2, 'reproduced')], false)).map((x) => x.id);
    say(found.length === 0, `${lang} bug: REPRODUCED after two tries — the hunt's own «not reproduced» rows are not the verdict (got [${found.join(',')}])`);
  }
  if (failed) { console.error(`✖ testrun-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ testrun-lint selftest OK — ${cases} cases, ${RULE_IDS.length} run-report rules and ${BUG_RULE_IDS.length} bug-report rules × ${Object.keys(CLEAN).length} languages, every rule red on its mutation only and silent on the clean report`);
}

if (IS_MAIN) {
  if (CMD === 'check') check(ARG);
  else if (CMD === 'selftest') selftest();
  else if (CMD === 'bug') bugCheck(ARG);
  else { console.error('usage: node .kaif/tools/kaif-testrun-lint.mjs check [home] | bug <report.md> | selftest'); process.exit(1); }
}
