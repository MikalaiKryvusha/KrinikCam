#!/usr/bin/env node
// kaif-requirements-lint.mjs — the OPTIONAL stop-word linter for requirements (2.2, epic N;
// REQUIREMENTS_FRAMEWORK.md § "The stop-word dictionary"). Deployed to .kaif/tools/.
//
// What it mechanizes: the dictionary of unverifiable words (NASA Appendix C black list +
// requirements smells) as a grep step over REQUIREMENT LINES. A hit means "rewrite measurably
// or justify explicitly in place" — the linter CONSULTS, it is never a Definition-of-Ready
// turnstile: it lints what was written, it does not forbid starting work (the anti-pattern
// boundary in REQUIREMENTS_FRAMEWORK.md).
//
// Scope discipline (precision over reach — a noisy advisor trains everyone to ignore it):
//   by default only lines inside REQUIREMENT SECTIONS are scanned — a section whose heading
//   matches /готово, когда|критери\w+ приёмки|вектор цели|acceptance criteria|goal vector|
//   done when|requirements/i — from that heading to the next heading of the same-or-higher
//   level. `--all` widens the scan to whole files.
// Legal by construction (never flagged):
//   quotation lines (`>`), ❌-example lines, fenced code blocks, inline code spans, and lines
//   carrying a named justification — `(justified: …)` or `(оправдано: …)`.
//
// Commands:
//   node .kaif/tools/kaif-requirements-lint.mjs check [paths…]   # default paths: plans/ bugs/ ideas/
//   node .kaif/tools/kaif-requirements-lint.mjs check --all [paths…]
//   node .kaif/tools/kaif-requirements-lint.mjs selftest         # PROVE the dictionary: every class
//                                                                # matches its own ❌ example and
//                                                                # stays silent on a clean ✅ line
// Exit codes: 0 = scanned and clean · 1 = findings (or selftest failure) ·
//             3 = SKIPPED, nothing to scan — "not scanned" must never read as "clean" (bug 34).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const ALL = argv.includes('--all');
const PATHS = argv.slice(1).filter((a) => a !== '--all');
const EXIT_SKIPPED = 3;
const die = (s) => { console.error('✖ ' + s); process.exit(1); };

// ---------------------------------------------------------------------------
// The dictionary. Six classes, EN+RU (the shipped canon; REQUIREMENTS_FRAMEWORK.md carries the
// EN table — this file is the executable RU+EN form). A project in another working language
// extends WORDS with its own mirrors: the class, not the wording, is the dictionary.
// EN patterns ride \b word boundaries; RU stems ride Unicode-letter lookarounds (\b is
// ASCII-only in JS and silently never fires inside Cyrillic — a guard that cannot fire).
const ru = (stem) => `(?<!\\p{L})(?:${stem})`;
const WORDS = [
  { cls: 'perception', re: /\b(user-friendly|easy|convenient|intuitive|seamless|flexible|robust|beautiful)\b/iu,
    ruRe: new RegExp(ru('удобн|интуитивн|бесшовн|гибк|надёжн|надежн|красив|прост(?:ой|ая|ое|ые|ых|ым|ого|ому|ую|ыми?)'), 'iu'),
    example: 'Интерфейс должен быть удобным и интуитивно понятным.', exampleEn: 'The interface shall be easy and intuitive.' },
  { cls: 'unbounded', re: /\b(fast|quickly|efficient(?:ly)?|optimal|adequate|sufficient|significant|minimal|best)\b/iu,
    ruRe: new RegExp(ru('быстр|эффективн|оптимальн|достаточн|значительн|минимальн|лучш'), 'iu'),
    example: 'Система должна работать быстро.', exampleEn: 'The system shall be fast.' },
  { cls: 'escape', re: /\b(as appropriate|as applicable|if possible|as needed|where practicable)\b/iu,
    ruRe: new RegExp(ru('по возможности|при необходимости|по мере необходимости|где применимо'), 'iu'),
    example: 'Логи ротируются при необходимости.', exampleEn: 'Logs are rotated as appropriate.' },
  { cls: 'open-ended', re: /(\betc\.|\band so on\b|\bincluding but not limited to\b|\band\/or\b)/iu,
    ruRe: new RegExp(ru('и т\\.\\s?д\\.|и так далее|и т\\.\\s?п\\.|и/или'), 'iu'),
    example: 'Форма содержит имя, email и т.д.', exampleEn: 'The form contains name, email, etc.' },
  { cls: 'vague-verb', re: /\b(support|handle|process|manage|improve|maximize|minimize)\b/iu,
    ruRe: new RegExp(ru('поддержива|обрабатыва|управля|улучш|максимизир|минимизир'), 'iu'),
    example: 'Система должна поддерживать большие файлы.', exampleEn: 'The system shall support large files.' },
  { cls: 'placeholder', re: /\b(TBD|TBS|TBR)\b/u,
    ruRe: new RegExp(ru('уточняется|будет определено'), 'iu'),
    example: 'Формат экспорта уточняется.', exampleEn: 'The export format is TBD.' },
];
// Clean fit-criterion lines every class must stay SILENT on (the ✅ side of the selftest).
const CLEAN = [
  'Время отклика поиска по каталогу — не более 200 мс при нагрузке до 500 RPS.',
  'A purchase completes in at most 3 clicks from the cart page.',
];

// ---------------------------------------------------------------------------
// Line legality: quotations, ❌ examples, code, and named justifications are citations of the
// convention, not requirements — the guard hunts unverifiable REQUIREMENTS, not vocabulary.
const isLegal = (line) =>
  /^\s*>/.test(line) || line.includes('❌') ||
  /\(\s*(justified|оправдано)\s*:/iu.test(line);
// Inline code spans AND «…»/"…" quoted segments are citations — a line DISCUSSING a stop word
// (the dictionary quoting itself) is not a requirement using one. «…» quotations WRAP across
// lines in prose, so the two HALVES are citations too: a lone « opens a quote that closes on a
// later line (everything after it is quoted), a lone » closes one opened earlier (everything
// before it is quoted). The per-line pair strip cannot see across lines — handle halves
// explicitly, or every wrapped owner quote becomes a false finding.
function stripCodeSpans(line) {
  line = line.replace(/`[^`]*`/g, '`code`').replace(/«[^»]*»/g, '«quote»').replace(/"[^"]*"/g, '"quote"');
  const close = line.indexOf('»');
  if (close >= 0 && (line.indexOf('«') < 0 || close < line.indexOf('«'))) line = '«quote»' + line.slice(close + 1);
  const open = line.lastIndexOf('«');
  if (open >= 0 && line.lastIndexOf('»') < open) line = line.slice(0, open) + '«quote»';
  return line;
}

// Requirement-section detection (default scope): heading matches → lines until the next
// heading of the same-or-higher level are in scope.
const SECTION_RE = /готово,\s*когда|критери\p{L}*\s+приёмки|вектор\p{L}*\s+цел|acceptance criteria|goal vector|done when|requirements/iu;
function scopedLines(text) {
  const lines = text.split(/\r?\n/);
  const out = []; // [lineNo, line]
  let inFence = false, inScope = false, scopeLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = l.match(/^(#{1,6})\s/);
    if (h) {
      if (inScope && h[1].length <= scopeLevel) inScope = false;
      if (SECTION_RE.test(l)) { inScope = true; scopeLevel = h[1].length; continue; }
    }
    if (ALL || inScope) out.push([i + 1, l]);
  }
  return out;
}

// 2.8 (epic SC; origin #77 · Q-R1′): the files git sees (kaifWalk above) — a broken link is skipped with a name, never a stack
// trace; a walk that could not see part of the tree is a finding, never a clean pass.
const TREE = { skipped: [], failed: [] };
function* walkMd(dir) {
  const tree = kaifWalk([dir]);
  TREE.skipped.push(...tree.skipped); TREE.failed.push(...tree.failed);
  for (const p of tree.files) {
    if (walkRel(dir, p).split('/').some((s) => ['.git', 'node_modules', '.kaif'].includes(s))) continue;
    if (/\.md$/i.test(p)) yield p;
  }
}

function cmdCheck() {
  const roots = PATHS.length ? PATHS : ['plans', 'bugs', 'ideas'];
  const files = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    if (statSync(r).isDirectory()) files.push(...walkMd(r));
    else files.push(r);
  }
  if (!files.length) {
    console.log(`⊘ SKIPPED — nothing to scan under: ${roots.join(', ')} (exit ${EXIT_SKIPPED}; "not scanned" must never read as "clean")`);
    process.exit(EXIT_SKIPPED);
  }
  let findings = 0;
  for (const f of files) {
    const raw = readWalked(TREE, f);   // unreadable → the walk's FAILED line (SC4 F1)
    if (raw === null) continue;
    const text = raw.replace(/^\uFEFF/, '');
    for (const [no, raw] of scopedLines(text)) {
      if (isLegal(raw)) continue;
      const line = stripCodeSpans(raw);
      for (const w of WORDS) {
        const hit = line.match(w.re) || line.match(w.ruRe);
        if (hit) { console.error(`✖ ${f}:${no} — "${hit[0]}" (${w.cls}): rewrite measurably or add (justified: …)`); findings++; }
      }
    }
  }
  for (const n of walkNotes(TREE)) console.error((n.includes('walk FAILED') ? '✖ ' : '⚠ ') + n);
  if (TREE.failed.length) findings++;
  if (findings) die(`requirements lint: ${findings} unverifiable-word finding(s) — advisory: rewrite or justify in place`);
  console.log(`✅ requirements lint OK — ${files.length} file(s), ${WORDS.length} word classes, 0 findings`);
}

// The dictionary is proven, never assumed: every class must MATCH its own ❌ examples (RU and
// EN) and stay SILENT on the clean fit-criterion lines — a guard that never reddens proves
// nothing, and one that fires on a measurable criterion is noise by construction.
function cmdSelftest() {
  let issues = 0;
  for (const w of WORDS) {
    if (!(w.ruRe.test(w.example))) { console.error(`✖ class "${w.cls}" does NOT match its own RU example: ${w.example}`); issues++; }
    if (!(w.re.test(w.exampleEn))) { console.error(`✖ class "${w.cls}" does NOT match its own EN example: ${w.exampleEn}`); issues++; }
  }
  for (const clean of CLEAN)
    for (const w of WORDS)
      if (w.re.test(clean) || w.ruRe.test(clean)) { console.error(`✖ class "${w.cls}" FIRES on a clean fit-criterion line (noise by construction): ${clean}`); issues++; }
  if (issues) die(`requirements lint selftest FAILED: ${issues} issue(s)`);
  console.log(`✅ requirements lint selftest OK — ${WORDS.length} classes match their ❌ examples and stay silent on clean ✅ lines`);
}

({ check: cmdCheck, selftest: cmdSelftest }[CMD] || (() => die(`unknown command: ${CMD} (check | selftest)`)))();
