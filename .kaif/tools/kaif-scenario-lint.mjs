#!/usr/bin/env node
// kaif-scenario-lint.mjs — the OPTIONAL scenario-form linter (2.5, epic SF; REQUIREMENTS_FRAMEWORK.md
// → "The scenario form"; origin issue #39). Deployed to .kaif/tools/.
//
// What it mechanizes: an acceptance criterion written as the four-line scenario —
//   - Situation. <the state of the world, with concrete values — not an action>
//   - Action.    <exactly one action of the user / the system / the agent>
//   - Result.    <what is SEEN from outside — never "works correctly">
//   - Check.     <a runnable command or query of the repository + its expected output>
// — keeps its FORM. The stop-word dictionary (`kaif-requirements-lint`) judges WORDS; this linter
// judges the SHAPE of a scenario and duplicates nothing from the dictionary (one boundary, one
// guard). A field deployment proved the seven rules on a live backlog for one night before this
// module was distilled from it: "Result. Works correctly" passes every word linter and fails here.
//
// What counts as a scenario: a list item that starts with the first keyword of a language
// (`- Situation.` / `- Ситуация.`, bold allowed) and the sibling items that follow it; continuation
// lines (indented, no bullet) glue to the current item. Everything else is invisible — the linter
// never demands a scenario (not a Definition-of-Ready gate), it guards the form where one was
// STARTED. Invisible by construction: fenced code, `>` quotes, lines carrying ❌ (the canon's own
// counter-examples).
//
// Boundaries, so the linter never becomes bureaucracy:
//   · keywords are a per-language table (like the stop-word dictionary) — a project adds a row;
//   · rules are DATA (one engine + rules-as-data): a new rule is a table row, not a new script;
//   · ADVISORY: exit 1 = findings, exit 0 = scanned and clean, exit 3 = SKIPPED (no scenario found —
//     "not scanned" must never read as "clean");
//   · an EMPTY Check line is a warning, not a finding: the owner may leave it for the agent to fill;
//     an agent-written empty Check is a defect the judge hunts, not this linter.
//   · Cyrillic word boundaries are lookarounds on the Cyrillic range — JavaScript `\b` is blind to
//     non-ASCII letters, a paid-for lesson.
//
// Commands:
//   node .kaif/tools/kaif-scenario-lint.mjs check [paths…]   # default: plans/ bugs/ ideas/
//   node .kaif/tools/kaif-scenario-lint.mjs selftest         # PROVE every rule on in-memory fixtures:
//                                                            # rule N reddens on scenario N and only N,
//                                                            # the clean set yields 0 — in both languages
// [TESTED: 2026-09-04 · selftest 33 cases green (7 rules × 2 languages, mutation N → rule N only; empty
//  Check = warning; fenced template / ❌ example / quoted line invisible); sandbox suite s19 observed:
//  broken fixture exit 1 with 14 findings in 14 scenarios (each rule named twice — EN + RU), clean
//  fixture exit 0 with 1 warning, template-only and empty trees SKIPPED (exit 3); the origin's own
//  plans/bugs/ideas (233 files) — SKIPPED: no scenario started there]
// [TESTED: 2026-09-25 · 2.8 (a finding of the CK epic judge): a numbered item «N. **[rule]**» closes the scenario block — the
//  origin's meta-plan of 2.8 lists its criteria so, and the linter read 6 scenarios with 5 false «order» findings that hid 4 real
//  ones; now 21 scenarios and exactly the 4 real findings (criteria 10, 13 ×2, 17); selftest 35 cases with the new case «a numbered
//  list of criteria without blank lines» in both languages, red on a copy without the break (2 of 35 — exactly the new case)]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// OW8 (KAIF 2.8, origin issue #101): the command runs only when this file IS the program — imported by a project's own tool, the
// module stays silent and never exits the importer (the same guard as the shipped contour's review.mjs).
import { pathToFileURL as __kaifToUrl } from 'node:url';
import { resolve as __kaifResolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// ── KAIF-WALK:BEGIN — ONE safe tree walker (2.8, epic SC; origin #77 · Q-R1′). The set of files is the one git sees
// (`ls-files --cached --others --exclude-standard`: tracked plus untracked, never ignored); without git, a walk that skips
// .git, node_modules and nested copies. A nested repository (a `.claude/worktrees/*` copy) is not this project; a broken
// link is SKIPPED WITH A NAME, never a crash; an unreadable directory is FAILED — a scan that could not see part of the tree
// must never read as clean (the old `try { walk() } catch {}` printed "no lines found" after one broken link). This block
// in the core is the source: every tool module that walks the tree carries a byte-identical copy (a deployed module cannot
// import the core), and the build refuses a drifted copy (check-framework 5l; `node tools/sync-walker.mjs` rewrites them).
// [TESTED: 2026-09-26 01:42:55 +03:00 · s29 W1 (git, 20 worktrees, two broken links) · W2 (no git) · W3 (the FAILED branch on the block
//  with an injected file system); red on v2.7 (6); five mutants on their addressees; four field trees walked read-only;
//  report testcases/reports/2026-09-26_sc1-one-safe-walker.md]
// [TESTED: 2026-09-26 04:22 +03:00 · SC4 part A: the read side (readWalked) and a nested copy judged below the root — s29 W4a–W4f,
//  red on the dist of 4b06b28; sc-mutants M13; report testcases/reports/2026-09-26_sc4-read-side-fixes.md]
function kaifWalk(roots) {
  const files = [], skipped = [], failed = [];
  // A nested copy is judged BELOW the walked root (SC4 F9): a project that itself lives under `.claude/worktrees/<agent>/`, walked by
  // an absolute root, lost every file to this test and read as "nothing to scan".
  let base = '.';
  const nested = (p) => /(^|\/)\.claude\/worktrees(\/|$)/.test(base === '.' ? p : p.slice(base.length + 1));
  const take = (p) => {
    if (nested(p)) return;
    let st;
    try { st = statSync(p); } catch (e) { skipped.push(`${p} (${e.code || 'unreadable'})`); return; }
    if (st.isFile()) files.push(p);             // a link to a directory is not entered (git does not enter it either)
  };
  const walk = (dir) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch (e) { failed.push(`${dir} (${e.code || e.message})`); return; }
    for (const d of ents) {
      const p = dir === '.' ? d.name : `${dir}/${d.name}`;
      if (d.name === '.git' || d.name === 'node_modules' || nested(p)) continue;
      if (d.isDirectory()) walk(p); else take(p);
    }
  };
  for (const r0 of roots) {
    const r = walkRoot(r0);
    base = r;
    let st;
    try { st = statSync(r); } catch (e) {           // an absent root is the caller's business; a root that IS a broken link is named
      const cut = r.lastIndexOf('/');
      try { if (readdirSync(cut < 0 ? '.' : r.slice(0, cut) || '/').includes(r.slice(cut + 1))) skipped.push(`${r} (${e.code || 'unreadable'})`); }
      catch { /* its parent is gone too — absent */ }
      continue;
    }
    if (!st.isDirectory()) { take(r); continue; }
    const git = spawnSync('git', ['-C', r, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (git.status !== 0) { walk(r); continue; }   // not a work tree, or no git on PATH
    for (const rel of git.stdout.split('\0')) {
      if (!rel || rel.endsWith('/')) continue;      // a nested repository is listed as a directory — not this project
      take(r === '.' ? rel : `${r}/${rel}`);
    }
    // git names what it could not open: "No such file" is a broken link (skipped with a name); any other reason is part of the
    // tree the scan did not see (failed)
    for (const m of String(git.stderr || '').matchAll(/could not open directory '([^']+)': ([^\r\n]+)/g))
      (/no such file/i.test(m[2]) ? skipped : failed).push(`${r === '.' ? '' : r + '/'}${m[1].replace(/\/$/, '')} (${m[2].trim()})`);
  }
  return { files: [...new Set(files)].sort(), skipped, failed };
}
// A root as the walk writes it (forward slashes, no leading ./, no trailing /) — a caller strips `walkRoot(dir) + '/'` from a
// returned path to judge only the segments BELOW its root (a root inside a skipped directory is still walked when named).
function walkRoot(r0) { return String(r0).replace(/\\/g, '/').replace(/^\.\/(?=.)/, '').replace(/(?<=.)\/$/, ''); }
function walkRel(dir, p) { const r = walkRoot(dir); return r === '.' ? p : p.slice(r.length + 1); }
// The walk's service lines, one wording for every scanner — `walk: ` opens each, so a reader of a scanner's hits tells them
// from findings: a FAILED walk is never a clean result; a skipped path is counted and named.
const WALK_NOTE = 'walk: ';
function walkNotes(tree) {
  const out = [];
  if (tree.failed.length) out.push(`${WALK_NOTE}the tree walk FAILED at ${tree.failed.slice(0, 3).join(', ')}${tree.failed.length > 3 ? ` and ${tree.failed.length - 3} more` : ''} — the scan is INCOMPLETE, not clean`);
  if (tree.skipped.length) out.push(`${WALK_NOTE}skipped ${tree.skipped.length} unreadable path(s) — a broken link, or a file git lists that the disk lacks: ${tree.skipped.slice(0, 3).join(', ')}${tree.skipped.length > 3 ? ', …' : ''}`);
  return out;
}
// A walked file is READ through the walk too (SC4 F1): an unreadable file — a read deny, a lock another process holds — lands in
// `failed` (part of the tree the scan did not see) and never throws past its scanner: an EPERM stack trace ended `update` after
// the marker was written. Returns the text, or null for a file the caller skips; one failure is recorded once.
function readWalked(tree, p) {
  try { return readFileSync(p, 'utf8'); }
  catch (e) { if (!tree.failed.some((f) => f.startsWith(`${p} (`))) tree.failed.push(`${p} (${e.code || e.message})`); return null; }
}
// ── KAIF-WALK:END
const IS_MAIN = import.meta.url === __kaifToUrl(__kaifResolve(process.argv[1] || '')).href;

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const PATHS = argv.slice(1);
const EXIT_SKIPPED = 3;
const DEFAULT_PATHS = ['plans', 'bugs', 'ideas'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kaif', 'dist', 'vendor']);

// ---------------------------------------------------------------------------
// Keywords per language — the four lines in their canonical order. A project whose owner writes in
// another language adds a row; the engine does not change.
export const KEYWORDS = {
  en: ['Situation', 'Action', 'Result', 'Check'],
  ru: ['Ситуация', 'Действие', 'Результат', 'Проверка'],
};
const CYR = '[А-Яа-яЁё]';
// Word-bounded alternative for a Cyrillic OR Latin list: lookarounds for Cyrillic, `\b` for Latin.
const cyr = (alts) => new RegExp(`(?<!${CYR})(?:${alts})(?!${CYR})`, 'i');
const lat = (alts) => new RegExp(`\\b(?:${alts})\\b`, 'i');

// ---------------------------------------------------------------------------
// The rules — data. Each: id · message · test(block) → true when the rule is violated.
// block = { lang, situation, action, result, check } (texts without the keyword).
export const RULES = [
  { id: 'one-action', msg: 'two actions in one Action line — split into two scenarios',
    test: (b) => lat('then|afterwards|after which|after that').test(b.action) ||
                 cyr('затем|потом|после чего').test(b.action) },
  { id: 'vague-result', msg: 'a vague Result — name what is seen from outside (a number, an output line, a file)',
    test: (b) => lat('correctly|properly|works|working|successfully|as expected|fine|ok').test(b.result) ||
                 /(корректн|правильн|работает|успешн|как ожидал|нормальн)/i.test(b.result) },
  { id: 'implementation-leak', msg: 'implementation words in Situation/Action — that is the language of the Check line',
    test: (b) => { const t = b.situation + ' ' + b.action;
      return lat('function|variable|array|selector|endpoint|callback').test(t) ||
             /(функци|переменн|массив|селектор)/i.test(t) || /\b(JSON|SQL)\b/.test(t); } },
  { id: 'first-person', msg: 'first person — a scenario is written in the third person (the user, the player, the agent)',
    test: (b) => [b.situation, b.action, b.result, b.check].some((t) =>
      /\b(I|me|my|mine)\b/.test(t) || cyr('я|мне|мой|моя|мои|меня').test(t)) },
  { id: 'no-command', msg: 'the Check line has no runnable command or query with its expected output',
    test: (b) => { const p = b.check; if (!p.trim()) return false;   // empty — a warning, not this rule
      return !/(`|npm run|node |grep|→|prints|печатает|exit|==|≥|>=|\$ )/.test(p); } },
  { id: 'no-concrete-value', msg: 'no concrete value in Situation/Action (a number, a "quoted" value, a `code` token)',
    test: (b) => !/[0-9]|«[^»]+»|`[^`]+`|"[^"]+"/.test(b.situation + ' ' + b.action) },
];
export const RULE_IDS = ['order', ...RULES.map((r) => r.id)];

// ---------------------------------------------------------------------------
// Parsing — blocks of a document.
const FIRST_KEYS = Object.entries(KEYWORDS).map(([lang, k]) => ({ lang, key: k[0] }));
const START = new RegExp(`^(\\s*)- \\*{0,2}(${FIRST_KEYS.map((f) => f.key).join('|')})\\*{0,2}\\.\\s*(.*)$`);
const langOf = (firstKey) => FIRST_KEYS.find((f) => f.key === firstKey).lang;

export function parseScenarios(src) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence || /^\s*>/.test(l) || l.includes('❌')) continue;
    const m = START.exec(l);
    if (!m) continue;
    const indent = m[1].length;
    const lang = langOf(m[2]);
    const keys = KEYWORDS[lang];
    const item = new RegExp(`^\\s{${indent}}- \\*{0,2}(${keys.join('|')}|[A-Z][a-z]+|[А-ЯЁ][а-яё]+)\\*{0,2}\\.\\s*(.*)$`);
    const block = { line: i + 1, lang, keys: [m[2]], text: { [m[2]]: m[3] } };
    let cur = m[2];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j];
      if (!t.trim()) break;                                            // blank line — end of block
      const it = item.exec(t);
      if (it) { cur = it[1]; block.keys.push(cur); block.text[cur] = it[2]; continue; }
      // another list, a heading — or the next NUMBERED item (2.8: a list of criteria «N. **[rule]**» with its scenario indented below
      // and no blank line between items merged every criterion into one «order» finding and hid the real ones behind it)
      if (/^\s*- /.test(t) || /^\s*\d+[.)]\s/.test(t) || /^\s*\*\*/.test(t) || /^#/.test(t)) break;
      block.text[cur] = (block.text[cur] || '') + ' ' + t.trim();        // continuation line
    }
    out.push(block);
    i = j - 1;
  }
  return out;
}

export function lint(block) {
  const findings = [], warnings = [];
  const keys = KEYWORDS[block.lang];
  if (block.keys.join('|') !== keys.join('|')) {
    findings.push({ id: 'order', msg: `line order ${block.keys.join(' · ')} — expected ${keys.join(' · ')}` });
    return { findings, warnings };                                     // one rule for a broken order (addressivity)
  }
  const b = { lang: block.lang, situation: block.text[keys[0]] || '', action: block.text[keys[1]] || '',
              result: block.text[keys[2]] || '', check: block.text[keys[3]] || '' };
  for (const r of RULES) if (r.test(b)) findings.push({ id: r.id, msg: r.msg });
  if (!b.check.trim()) warnings.push({ id: 'empty-check', msg: 'empty Check — legal when the OWNER wrote it; the agent must fill it before "done"' });
  return { findings, warnings };
}

// ---------------------------------------------------------------------------
// 2.8 (epic SC; origin #77 · Q-R1′): the files git sees (kaifWalk above) — a broken link is skipped with a name, never a stack
// trace; a walk that could not see part of the tree is named, never a clean pass.
const TREE = { skipped: [], failed: [] };
function collect(paths) {
  const files = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const tree = kaifWalk([p]);
    TREE.skipped.push(...tree.skipped); TREE.failed.push(...tree.failed);
    for (const f of tree.files) {
      const segs = walkRel(p, f).split('/');
      if (segs.slice(0, -1).some((s) => SKIP_DIRS.has(s))) continue;
      if (/\.md$/i.test(f)) files.push(f);
    }
  }
  return files;
}

function check(paths) {
  for (const p of PATHS) if (!existsSync(p)) { console.error(`✖ path not found: ${p}`); process.exit(1); }
  const files = collect(paths);
  let scenarios = 0, nF = 0, nW = 0;
  for (const f of files) {
    const text = readWalked(TREE, f);   // unreadable → the walk's FAILED line (SC4 F1)
    if (text === null) continue;
    for (const bl of parseScenarios(text)) {
      scenarios++;
      const { findings, warnings } = lint(bl);
      for (const x of findings) { nF++; console.log(`✖ ${f}:${bl.line} — ${x.id}: ${x.msg}`); }
      for (const x of warnings) { nW++; console.log(`⚠ ${f}:${bl.line} — ${x.id}: ${x.msg}`); }
    }
  }
  for (const n of walkNotes(TREE)) console.log((n.includes('walk FAILED') ? '✖ ' : '⚠ ') + n);
  if (TREE.failed.length) { console.log('✖ scenario-lint: the tree walk failed — not scanned is not clean'); process.exit(1); }
  if (!scenarios) {
    console.log(`⚠ scenario-lint SKIPPED — no scenario block in ${files.length} file(s) under ${paths.join(' ')}; nothing was linted (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  const w = nW ? `, ${nW} warning(s)` : '';
  if (nF) { console.log(`✖ scenario-lint: ${nF} finding(s) in ${scenarios} scenario(s)${w} — a criterion that is not in form is not a check`); process.exit(1); }
  console.log(`✅ scenario-lint OK — ${files.length} file(s), ${scenarios} scenario(s), 0 findings${w}`);
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures, in both shipped languages:
// broken scenario N reddens rule N and only N; the clean set yields 0 findings.
const FIX = {
  en: {
    clean: [
      ['The hero has Wisdom 70; the dice fall 17, 31, 62.', 'The player rolls the chain link by link.',
       'Chain length L = 2; the game log shows three rolls: 17, 31, 62.', '`node tools/chain.mjs --rolls 17,31,62 --wisdom 70` prints `2`.'],
      ['Two players named "Ann" and "Bob" have joined room 7.', 'Ann presses "Start".',
       'The board shows round 1 and the turn belongs to Ann.', '`npm run sim -- --room 7` prints `round 1 · turn Ann`.'],
    ],
    broken: {
      'order': ['The hero has Wisdom 70.', 'The player rolls.', null, '`node x` prints `2`.'],     // Result missing → order
      'one-action': ['The hero has Wisdom 70.', 'The player rolls the chain and then equips the sword.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'vague-result': ['The hero has Wisdom 70.', 'The player rolls the chain.', 'The chain is computed correctly.', '`node x` prints `2`.'],
      'implementation-leak': ['The `players` array holds 2 objects.', 'The player rolls the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'first-person': ['The hero has Wisdom 70.', 'I roll the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'no-command': ['The hero has Wisdom 70.', 'The player rolls the chain.', 'Chain length L = 2.', 'Verify by hand.'],
      'no-concrete-value': ['The hero has high Wisdom.', 'The player rolls the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
    },
  },
  ru: {
    clean: [
      ['У героя Мудрость 70; кости ложатся 17, 31, 62.', 'Игрок бросает цепочку звено за звеном.',
       'Длина цепочки L = 2; в логе партии три броска: 17, 31, 62.', '`node tools/chain.mjs --rolls 17,31,62 --wisdom 70` печатает `2`.'],
      ['В комнате 7 два игрока — «Аня» и «Боб».', 'Аня нажимает «Старт».',
       'На доске раунд 1, ход у Ани.', '`npm run sim -- --room 7` печатает `round 1 · turn Аня`.'],
    ],
    broken: {
      'order': ['У героя Мудрость 70.', 'Игрок бросает.', null, '`node x` печатает `2`.'],
      'one-action': ['У героя Мудрость 70.', 'Игрок бросает цепочку и затем надевает меч.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'vague-result': ['У героя Мудрость 70.', 'Игрок бросает цепочку.', 'Цепочка считается правильно.', '`node x` печатает `2`.'],
      'implementation-leak': ['Массив игроков держит 2 объекта.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'first-person': ['У героя Мудрость 70.', 'Я бросаю цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'no-command': ['У героя Мудрость 70.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', 'Проверить вручную.'],
      'no-concrete-value': ['У героя высокая Мудрость.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
    },
  },
};
const render = (lang, lines) => KEYWORDS[lang].map((k, i) => lines[i] === null ? null : `- ${k}. ${lines[i]}`)
  .filter(Boolean).join('\n') + '\n';

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(FIX)) {
    const clean = FIX[lang].clean.map((l) => render(lang, l)).join('\n');
    const blocks = parseScenarios(clean);
    const f = blocks.flatMap((b) => lint(b).findings);
    say(blocks.length === FIX[lang].clean.length && f.length === 0,
      `${lang}: clean set — ${blocks.length} scenario(s) parsed, 0 findings${f.length ? ' (got ' + f.map((x) => x.id).join(',') + ')' : ''}`);
    for (const id of RULE_IDS) {
      const mut = FIX[lang].broken[id];
      say(!!mut, `${lang}: rule ${id} has a mutation`);
      if (!mut) continue;
      const got = parseScenarios(render(lang, mut)).flatMap((b) => lint(b).findings).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang}: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
    // The warning path: an empty Check is a warning, never a finding.
    const w = parseScenarios(render(lang, [...FIX[lang].clean[0].slice(0, 3), ''])).flatMap((b) => lint(b));
    say(w.length === 1 && w[0].findings.length === 0 && w[0].warnings.length === 1, `${lang}: empty Check — a warning, not a finding`);
    // A numbered list of criteria, each scenario indented under its item, NO blank line between items: two scenarios, no «order».
    const listed = FIX[lang].clean.map((l, i) => `${i + 1}. **[rule ${i + 1}]**\n` + render(lang, l).trimEnd().split('\n').map((x) => '   ' + x).join('\n')).join('\n') + '\n';
    const lb = parseScenarios(listed);
    const lf = lb.flatMap((b) => lint(b).findings);
    say(lb.length === FIX[lang].clean.length && lf.length === 0, `${lang}: a numbered list of criteria without blank lines — ${lb.length} scenario(s), 0 findings${lf.length ? ' (got ' + lf.map((x) => x.id).join(',') + ')' : ''}`);
  }
  // Invisibility: a fenced template and a ❌ counter-example are not scenarios.
  const inv = parseScenarios('```\n' + render('en', FIX.en.clean[0]) + '```\n❌ Result. Works correctly.\n> - Situation. quoted\n');
  say(inv.length === 0, 'fenced template, ❌ example and quoted line are invisible');
  if (failed) { console.error(`✖ scenario-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ scenario-lint selftest OK — ${cases} cases, ${RULE_IDS.length} rules × ${Object.keys(FIX).length} languages, every rule red on its mutation only and silent on the clean set`);
}

if (IS_MAIN) {
  if (CMD === 'check') check(PATHS.length ? PATHS : DEFAULT_PATHS.filter((p) => existsSync(p)));
  else if (CMD === 'selftest') selftest();
  else { console.error(`usage: node .kaif/tools/kaif-scenario-lint.mjs check [paths…] | selftest`); process.exit(1); }
}
