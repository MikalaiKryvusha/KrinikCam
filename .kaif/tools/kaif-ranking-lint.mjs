#!/usr/bin/env node
// kaif-ranking-lint.mjs — the OPTIONAL linter of the `/what-next` answer FORM (KAIF 2.6, epic WN;
// origin issue #53; owner decision #102). Deployed to .kaif/tools/.
//
// What it mechanizes: the rule "the newest pain is not a priority claim" stood in `/what-next` as prose,
// and a field agent quoted it and broke it in the same answer — the owner's words of the day sat on top,
// the main phase, the metric and 87 open bugs were never named. Prose does not rank; a FORM does.
// The answer of `/what-next` (and the draft the agent lints BEFORE printing it) must carry:
//   METRIC: <the main phase's acceptance metric read from the documents> (line, anywhere above the table)
//   MAIN PHASE: <the phase the plan marks as the main one now>    (line, anywhere above the table)
//   | step | moves | closes | effort |                             (the ranking table, fixed columns)
//   — every row: `moves` names the metric component it shifts or is `—`; `closes` names bugs/plans or is empty;
//   — ORDER: a row with `moves: —` and an empty `closes` never stands above a row that has at least one;
//   — row 1 in particular must move the metric or close something (the #53 defect: a fresh word on line 1);
//   <shelf line>  "Fresh owner words — not ranked by the metric" / «Свежие слова владельца — не ранжированы
//                 метрикой» (+ pointer to /fix-vision); may say "none" — but the shelf EXISTS;
//   <debt line>   "Tech debt:" / «Техдолг:» with at least one number (open bugs · red · drifted pairs).
//   <owner debt>  "Owner debt:" / «Долг перед владельцем:» (2.8, epic OW, OW3; origin issue #86, S1 — an owner's answered decision
//                 waited 11 days behind planned work): the owner's decisions awaiting application (`interview #NNN QN`) and the bugs he
//                 flagged (`bugs/NN`) — or "none". When it names any, ROW 1 closes one of them: debt preempts the plan; the #53 rule
//                 (a fresh word is ranked by the metric) is untouched — a debt is not a fresh word.
//
// Boundaries, so the linter never becomes bureaucracy (same as kaif-scenario-lint):
//   · keywords are a per-language table — a project adds a row; rules are DATA;
//   · it judges ONLY a document that STARTED a /what-next answer (a METRIC: line or a moves/closes table);
//     anything else is SKIPPED (exit 3) — "not scanned" must never read as "clean";
//   · ADVISORY: exit 1 = findings, exit 0 = scanned and clean, exit 3 = SKIPPED;
//   · fenced code and `>` quotes are invisible (a template quoted in a skill is not an answer).
//
// Commands:
//   node .kaif/tools/kaif-ranking-lint.mjs check <draft.md> [more.md…]   # exit 0 / 1 / 3
//   node .kaif/tools/kaif-ranking-lint.mjs selftest                       # every rule red on its mutation only,
//                                                                         # the #53 fixture red, the clean answer green
// [TESTED: 2026-09-05 · selftest 19 cases green (7 rules × 2 languages, mutation N → rule N only, the #53 fixture red with
//  six rules — `order` fires on it too (court RL 2.6), a plain document is not an answer); first run went red on `recency-first` because the row-1 mutation also
//  tripped `order` — `order` now judges rows 2+; sandbox suite s23 on a deployed copy: install · check #53 → 1 · fixed → 0 ·
//  foreign → 3 · usage → 1 · bundle meta 2.6 entries]
import { readFileSync, existsSync } from 'node:fs';
// OW8 (KAIF 2.8, origin issue #101): the command runs only when this file IS the program — imported by a project's own tool, the
// module stays silent and never exits the importer (the same guard as the shipped contour's review.mjs).
import { pathToFileURL as __kaifToUrl } from 'node:url';
import { resolve as __kaifResolve } from 'node:path';
const IS_MAIN = import.meta.url === __kaifToUrl(__kaifResolve(process.argv[1] || '')).href;

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const PATHS = argv.slice(1);
const EXIT_SKIPPED = 3;
const DASH = /^\s*(?:—|-|–|none|нет)?\s*$/i;   // an empty `moves` / `closes` cell

// ---------------------------------------------------------------------------
// Keywords per language — the form's anchors. Latin anchors (METRIC:, MAIN PHASE:, moves, closes) are the
// same in every language: they are the machine half of the form, the owner reads the table cells.
export const KEYWORDS = {
  en: { shelf: 'Fresh owner words', debt: 'Tech debt', ownerDebt: 'Owner debt', fixVision: '/fix-vision' },
  ru: { shelf: 'Свежие слова владельца', debt: 'Техдолг', ownerDebt: 'Долг перед владельцем', fixVision: '/fix-vision' },
};
const METRIC_RE = /^\s*\**METRIC:\**\s*(.*)$/i;
const PHASE_RE = /^\s*\**MAIN PHASE:\**\s*(.*)$/i;
const HEADER_RE = /^\s*\|.*\bmoves\b.*\|.*\bcloses\b.*\|/i;
const SEP_RE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const shelfRe = () => new RegExp('(' + Object.values(KEYWORDS).map((k) => k.shelf).join('|') + ')', 'i');
const ownerDebtRe = () => new RegExp('^\\s*\\**(?:' + Object.values(KEYWORDS).map((k) => k.ownerDebt).join('|') + ')\\**\\s*:', 'i');
// A debt item, normalised to one key in both languages: `interview #066 Q1` / «интервью №066 В1» → iv66q1 · `bugs/12` → bug12.
export const debtItems = (s) => [...String(s || '').matchAll(/(?:interview|\u0438\u043d\u0442\u0435\u0440\u0432\u044c\u044e)\s*[#\u2116]?\s*0*(\d+)\s*,?\s*(?:Q|\u0412)(\d+)|bugs\/0*(\d+)/giu)]
  .map((m) => (m[3] ? 'bug' + m[3] : 'iv' + m[1] + 'q' + m[2]));
const debtRe = () => new RegExp('^\\s*\\**(?:' + Object.values(KEYWORDS).map((k) => k.debt).join('|') + ')\\**\\s*:', 'i');

// ---------------------------------------------------------------------------
// Parsing — the answer block of a document: the lines above the table, the table rows, the lines below.
export function parseAnswer(src) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const visible = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (fence || /^\s*>/.test(l)) return;
    visible.push({ n: i + 1, t: l });
  });
  const metric = visible.find((v) => METRIC_RE.test(v.t));
  const phase = visible.find((v) => PHASE_RE.test(v.t));
  const hIdx = visible.findIndex((v) => HEADER_RE.test(v.t));
  if (!metric && hIdx < 0) return null;                     // not a /what-next answer — SKIPPED by the caller
  const rows = [];
  if (hIdx >= 0) {
    const header = visible[hIdx].t.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim().toLowerCase());
    const iMoves = header.findIndex((c) => /\bmoves\b/.test(c));
    const iCloses = header.findIndex((c) => /\bcloses\b/.test(c));
    for (let k = hIdx + 1; k < visible.length; k++) {
      const t = visible[k].t;
      if (!/^\s*\|/.test(t)) break;
      if (SEP_RE.test(t)) continue;
      const cells = t.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      rows.push({ line: visible[k].n, step: cells[0] || '', moves: cells[iMoves] || '', closes: cells[iCloses] || '' });
    }
  }
  return {
    metric: metric ? metric.t.match(METRIC_RE)[1].trim() : null,
    phase: phase ? phase.t.match(PHASE_RE)[1].trim() : null,
    table: hIdx >= 0, tableLine: hIdx >= 0 ? visible[hIdx].n : null, rows,
    shelf: visible.some((v) => shelfRe().test(v.t)),
    debt: visible.find((v) => debtRe().test(v.t)) || null,
    ownerDebt: visible.find((v) => ownerDebtRe().test(v.t)) || null,
  };
}

// ---------------------------------------------------------------------------
// The rules — data. Each: id · message · test(answer) → true when violated.
const carries = (r) => !DASH.test(r.moves) || !DASH.test(r.closes);
export const RULES = [
  { id: 'no-metric', msg: 'no METRIC: line — the answer must open with the main phase\'s acceptance metric read from the documents',
    test: (a) => !a.metric || !/\d/.test(a.metric) },
  { id: 'no-main-phase', msg: 'no MAIN PHASE: line — name the phase the plan marks as the main one now (or the first open phase, saying so)',
    test: (a) => !a.phase },
  { id: 'no-table', msg: 'no ranking table with `moves` and `closes` columns — steps are ranked in the fixed form, not in prose',
    test: (a) => !a.table || a.rows.length === 0 },
  { id: 'recency-first', msg: 'row 1 neither moves the metric nor closes anything — a fresh word on top is the #53 defect',
    test: (a) => a.rows.length > 0 && !carries(a.rows[0]) },
  { id: 'order', msg: 'a row with `moves: —` and empty `closes` stands above a row that has at least one',
    test: (a) => a.rows.some((r, i) => i > 0 && !carries(r) && a.rows.slice(i + 1).some(carries)) }, // row 1 is recency-first's
  { id: 'no-shelf', msg: 'no shelf "Fresh owner words — not ranked by the metric" (may say "none"; pointer /fix-vision)',
    test: (a) => !a.shelf },
  { id: 'no-debt', msg: 'no "Tech debt:" line with numbers (open bugs · red · drifted pairs)',
    test: (a) => !a.debt || !/\d/.test(a.debt.t) },
  { id: 'no-owner-debt', msg: 'no "Owner debt:" line — the owner\'s decisions awaiting application and the bugs he flagged (may say "none")',
    test: (a) => !a.ownerDebt },
  { id: 'owner-debt-not-first', msg: 'the owner\'s debt is named, and row 1 closes none of it — debt preempts the plan (#86)',
    // an empty row 1 is recency-first's finding — this axis judges a row 1 that carries SOMETHING else than the debt
    test: (a) => { const items = a.ownerDebt ? debtItems(a.ownerDebt.t) : []; return items.length > 0 && a.rows.length > 0 && carries(a.rows[0]) && !debtItems(a.rows[0].closes).some((k) => items.includes(k)); } },
];
export const RULE_IDS = RULES.map((r) => r.id);

export function lint(answer) {
  const findings = [];
  for (const r of RULES) if (r.test(answer)) findings.push({ id: r.id, msg: r.msg });
  return findings;
}

// ---------------------------------------------------------------------------
function check(paths) {
  if (!paths.length) { console.error('usage: node .kaif/tools/kaif-ranking-lint.mjs check <draft.md> [more.md…] | selftest'); process.exit(1); }
  for (const p of paths) if (!existsSync(p)) { console.error(`✖ path not found: ${p}`); process.exit(1); }
  let answers = 0, nF = 0;
  for (const f of paths) {
    const a = parseAnswer(readFileSync(f, 'utf8'));
    if (!a) continue;
    answers++;
    for (const x of lint(a)) { nF++; console.log(`✖ ${f}${a.tableLine ? ':' + a.tableLine : ''} — ${x.id}: ${x.msg}`); }
  }
  if (!answers) {
    console.log(`⚠ ranking-lint SKIPPED — no /what-next answer (METRIC: line or moves/closes table) in ${paths.length} file(s); nothing was linted (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  if (nF) { console.log(`✖ ranking-lint: ${nF} finding(s) in ${answers} answer(s) — an answer that is not in form ranks by recency, not by the metric`); process.exit(1); }
  console.log(`✅ ranking-lint OK — ${answers} answer(s), 0 findings`);
}

// ---------------------------------------------------------------------------
// selftest — the clean answer is green in both languages; the #53 fixture is red; each mutation of the
// clean answer reddens its rule and only it; a plain document is not an answer (SKIPPED path).
const CLEAN = {
  en: [
    'METRIC: acceptance criteria of the main phase closed 9 of 15 (2026-09-05)',
    'MAIN PHASE: Phase 2 — Reach (v2), marked as the main one now in MASTER_PLAN.md',
    '',
    '| step | moves | closes | effort |', '|---|---|---|---|',
    '| 1. Traffic series: index the catalogue | criterion 3 (Catalogue) | bugs/12 · interview #066 Q1 | 0.5 chat |',
    '| 2. Yandex verification | criterion 5 | — | 0.25 chat |',
    '| 3. Refactor the console | — | plans/40 | 1 chat |',
    '| 4. Rename the sidebar | — | — | 0.25 chat |',
    '',
    'Fresh owner words — not ranked by the metric (→ /fix-vision): "MVP of the messenger" (today), "rewrite the terms" (yesterday).',
    'Tech debt: open bugs 87 · red 30 · drifted pairs 0.',
    'Owner debt: interview #066 Q1 (answered 11 d ago, awaiting application) · bugs/12 (flagged by the owner).',
  ],
  ru: [
    'METRIC: критерии приёмки главной фазы закрыты 9 из 15 (2026-09-05)',
    'MAIN PHASE: Фаза 2 — Охват (v2), помечена «ГЛАВНОЕ СЕЙЧАС» в MASTER_PLAN.md',
    '',
    '| шаг | moves | closes | трудоёмкость |', '|---|---|---|---|',
    '| 1. Серия трафика: индексация каталога | критерий 3 (Каталог) | bugs/12 · интервью №066 В1 | 0,5 чата |',
    '| 2. Верификация Яндекса | критерий 5 | — | 0,25 чата |',
    '| 3. Рефакторинг консоли | — | plans/40 | 1 чат |',
    '| 4. Переименовать сайдбар | — | — | 0,25 чата |',
    '',
    'Свежие слова владельца — не ранжированы метрикой (→ /fix-vision): «MVP мессенджера» (сегодня), «перепись условий» (вчера).',
    'Техдолг: открытых багов 87 · красных 30 · разъехавшихся пар 0.',
    'Долг перед владельцем: интервью №066 В1 (отвечено 11 дн. назад, ждёт внесения) · bugs/12 (отмечен владельцем).',
  ],
};
// The #53 incident, as the field agent answered it: fresh words on top, no metric, no phase, no shelf, no debt line.
const FIX_53 = [
  '| step | moves | closes | effort |', '|---|---|---|---|',
  '| 1. MVP of the messenger (the owner said so today) | — | — | 2 chats |',
  '| 2. Rewrite the terms (the owner said so yesterday) | — | — | 1 chat |',
  '| 3. Traffic series: index the catalogue | criterion 3 | bugs/12 | 0.5 chat |',
];
const MUTATIONS = {
  'no-metric': (L) => L.filter((l) => !/^METRIC:/.test(l)),
  'no-main-phase': (L) => L.filter((l) => !/^MAIN PHASE:/.test(l)),
  'no-table': (L) => L.filter((l) => !/^\|/.test(l)),
  'recency-first': (L) => { const r = L.filter((l) => /^\| [0-9]\./.test(l)); return L.map((l) => l === r[0] ? r[3] : l === r[3] ? r[0] : l); },
  'order': (L) => { const r = L.filter((l) => /^\| [0-9]\./.test(l)); return L.map((l) => l === r[1] ? r[3] : l === r[3] ? r[1] : l); },
  'no-shelf': (L) => L.filter((l) => !/Fresh owner words|Свежие слова владельца/.test(l)),
  'no-debt': (L) => L.filter((l) => !/^(Tech debt|Техдолг):/.test(l)),
  'no-owner-debt': (L) => L.filter((l) => !/^(Owner debt|Долг перед владельцем):/.test(l)),
  // row 1 (closes the debt) and row 2 (moves the metric, closes nothing) swap: both carry, so `order` and `recency-first` stay silent
  'owner-debt-not-first': (L) => { const r = L.filter((l) => /^\| [0-9]\./.test(l)); return L.map((l) => l === r[0] ? r[1] : l === r[1] ? r[0] : l); },
};

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(CLEAN)) {
    const clean = parseAnswer(CLEAN[lang].join('\n') + '\n');
    const f = clean ? lint(clean) : [{ id: 'not-parsed' }];
    say(clean && f.length === 0 && clean.rows.length === 4, `${lang}: clean answer — 4 rows parsed, 0 findings${f.length ? ' (got ' + f.map((x) => x.id).join(',') + ')' : ''}`);
    for (const id of RULE_IDS) {
      const got = lint(parseAnswer(MUTATIONS[id](CLEAN[lang]).join('\n') + '\n')).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang}: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
  }
  const f53 = lint(parseAnswer(FIX_53.join('\n') + '\n')).map((x) => x.id);
  say(JSON.stringify([...f53].sort()) === JSON.stringify(['no-debt', 'no-main-phase', 'no-metric', 'no-owner-debt', 'no-shelf', 'order', 'recency-first']),
    `the #53 fixture (fresh words on top, no metric) is RED: [${f53.join(', ')}]`);
  say(parseAnswer('# A plan\n\nSome prose.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n') === null, 'a plain document with an unrelated table is not an answer (SKIPPED path)');
  say(parseAnswer('> METRIC: quoted\n```\n| step | moves | closes |\n```\n') === null, 'a quoted METRIC: line and a fenced table are invisible');
  if (failed) { console.error(`✖ ranking-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ ranking-lint selftest OK — ${cases} cases, ${RULE_IDS.length} rules × ${Object.keys(CLEAN).length} languages, every rule red on its mutation only, the #53 fixture red, the clean answer green`);
}

if (IS_MAIN) {
  if (CMD === 'check') check(PATHS);
  else if (CMD === 'selftest') selftest();
  else { console.error('usage: node .kaif/tools/kaif-ranking-lint.mjs check <draft.md> [more.md…] | selftest'); process.exit(1); }
}
