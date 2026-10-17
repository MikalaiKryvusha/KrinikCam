#!/usr/bin/env node
// kaif-attribution-lint.mjs — the OPTIONAL authorship linter (2.7, epic AW; AGENT_GUIDE.md →
// "Authorship of a decision"; origin issue #55 — the owner's word, rendered from Russian: "you write
// some nonsense yourself, then read it back and interpret it as MY word"). Deployed to .kaif/tools/.
//
// What it mechanizes: a line that ATTRIBUTES a decision or a will to the owner — "the owner's
// decision", "решение владельца", "the owner decided", "владелец велел", or the owner's signature
// `[OWNER]` / `[ВЛАДЕЛЕЦ]` — must carry, within a window of WINDOW lines around it, one of:
//   · a verbatim quote of the owner — «…», “…” or "…" — or a `>` quote line;
//   · the address of the interview that holds the verbatim text — `interviews/…`, `интервью №NNN`,
//     `interview #NNN`, `interview_NNN`;
//   · the number of a RECORDED decision (`решение №109`, `decision #12`, `MASTER_PLAN §7 №95`) — a
//     number counts only with a registry word on the same line: a bare `№55` is an issue, a page, anything;
//   · ON THE ATTRIBUTION'S OWN LINE: the address of the commit that holds the owner's words verbatim — "commit" / «коммит»
//     next to a hash of 7+ hex digits with at least one digit (2.8, epic CK, origin issue #89: the rulebook takes the rule,
//     the verbatim words stay at the source — `[OWNER] <date> · verbatim in commit <hash>`);
//   · the declared exception on the line — `<!-- attribution-ok: <where the quote lives> -->`;
// or the line is signed as the AGENT's own decision ([AI] / [AI-ed] / the localized `aiMarks` pair of
// .kaif/kaif.json) — a signed agent decision is no attribution. A "Decisions made without the owner"
// section (any language — see SELF_SECTION) is the agent's signature block-wise: its lines are skipped.
//
// Why a linter and not a paragraph: the canon already said "quote the owner verbatim"; a prose rule
// holds until the session tires — in one deployment 430 of 1083 references to the owner's will carried
// no quote, and one of them ("the owner's decision P1: wait, no threshold" — his actual word was "do as
// you see fit") held a run for 119 s while the owner's machine died.
//
// Boundaries, so the linter never becomes bureaucracy:
//   · patterns are DATA per language (ATTRIBUTION) — a project adds a row, the engine does not change;
//   · invisible by construction: fenced code, `>` quote lines (they are EVIDENCE for their neighbours,
//     never findings themselves), inline code spans, HTML comments, lines carrying ❌ (the canon's own
//     counter-examples);
//   · DEBT, not a turnstile: findings already recorded in the baseline (.kaif/attribution-lint.baseline.json,
//     keys `file:sha16(line)` → the COUNT of such lines, never their text — 2.9, epic PV) are printed as debt and exit 0; only NEW
//     findings exit 1 (a copy beyond the recorded count is new); a write limited to paths rewrites only their entries; the baseline is
//     written once on adoption (`--write-baseline`) and ONLY SHRINKS after that: a rewrite that would turn
//     a NEW finding into debt is REFUSED (exit 1) unless `--adopt-new` is passed explicitly — the count of
//     adopted lines is printed, never silent; a baselined line that changed or vanished is pruned;
//   · exit 3 = SKIPPED: no markdown in scope — "not scanned" must never read as "clean" (bug 34 class);
//   · it cannot see an attribution phrased outside the table ("as agreed", "как договаривались"), it
//     cannot judge whether a quote is genuine, and non-markdown files (code comments) are out of scope —
//     those stay with `/fable-judge` (the hunt "an agent decision worn as the owner's word").
//
// Commands:
//   node .kaif/tools/kaif-attribution-lint.mjs check [paths…] [--write-baseline [--adopt-new]] [--baseline <file>]
//         # default paths: plans bugs ideas interviews researches homeworks reports + the root *.md
//   node .kaif/tools/kaif-attribution-lint.mjs selftest
//         # PROVE both answers on in-memory fixtures (RU + EN): the field line without a quote → finding;
//         # with a quote / a `>` quote line / an interview address / a decision number / an agent signature /
//         # the marker → clean; the owner's signature without his words → finding; invisible zones stay
//         # silent; the baseline swallows old debt and reddens on a new line only.
//
// @guard kaif-attribution-lint
// THREAT:         an agent's own choice recorded as "the owner's decision" without his words becomes
//                 unrevisable and is obeyed by later sessions (origin #55: a run held for 119 s while
//                 the owner's machine died)
// PROVED-AGAINST: selftest — the field line «Решение владельца П1 (plans/81 §3): ЖДАТЬ, порога не
//                 заводить» with no quote within ±2 lines → 1 finding; the same line with «давай как ты
//                 считаешь» beside it → 0; the EN twin "the owner's decision P1: wait, no threshold" → 1;
//                 the ticket's own mutant «[ВЛАДЕЛЕЦ] без цитаты» → 1
// GAP:            an attribution phrased outside the pattern table is invisible; a fabricated quote
//                 passes as a quote (the judge's half); non-markdown files — code comments — are out of
//                 scope; an incidental quote or decision number within the window grounds a neighbour
// ON-REAL-PATH:   the origin's own knowledge directories and root documents — first live run
//                 2026-09-12 (epic AW), baseline written; see the [TESTED] line below
// [TESTED: 2026-09-12 · selftest green (RU + EN, 26 cases); sandbox suite s24 — bad fixture exit 1 with
//  both languages named, clean fixture exit 0, baseline swallows the old debt and reddens on the new
//  line only, a rewrite with a NEW finding present is refused unless --adopt-new, empty tree SKIPPED
//  (exit 3); live run over the origin — see STATUS "Инструменты"]
// 2.8, epic CK (origin issue #89) — a COMMIT address grounds an attribution ON ITS OWN LINE: selftest 34 cases (the CK4 judge's
// forms: `commit: <hash>`, a commit URL → clean; `recommit`, an all-hex word, a hash on a neighbour line → findings); proven against the NAMED 2.7
// edition (≈ 2026-09-24 21:57 +03:00): the field form «[OWNER] 2026-09-22 · verbatim in commit 6411a9ed» → 1 finding under the 2.7
// module, 0 under this one; "verbatim in the commit above" (no hash) and a bare hash without the commit word stay findings.
// [NOT-TESTED] as a functional run for the new axis — the field path is a deployment's /fix-vision writing a rule into house rules.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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
const FLAGS = new Set(argv.filter((a) => a.startsWith('--')));
const baselineFlagAt = argv.indexOf('--baseline');
const BASELINE = baselineFlagAt >= 0 && argv[baselineFlagAt + 1] ? argv[baselineFlagAt + 1] : '.kaif/attribution-lint.baseline.json';
const PATHS = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--baseline');
const EXIT_SKIPPED = 3;
const WINDOW = 2;                       // lines before and after an attribution that may carry the evidence
const DEFAULT_DIRS = ['plans', 'bugs', 'ideas', 'interviews', 'researches', 'homeworks', 'reports'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kaif', 'dist', 'vendor', 'framework']);
// The machinery's own transients legally QUOTE conventions while describing them (bug 34 class).
const TRANSIENTS = new Set(['KAIF.md', 'KAIF_UPDATE_TASK.md', 'KAIF_ADAPTATION_TASK.md', 'KAIF_UPDATE_TASK.superseded.md']);
const KAIF_JSON = '.kaif/kaif.json';

const log = (s) => console.log(s);
const sha16 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// Patterns — DATA per language. Cyrillic word boundaries are lookarounds on the Cyrillic range
// (JavaScript `\b` is blind to non-ASCII letters — a paid-for lesson).
const CYR = '[А-Яа-яЁё]';
const cyr = (src) => new RegExp(`(?<!${CYR})(?:${src})(?!${CYR})`, 'iu');
// Only forms that ASSERT a decision or an order are attributions. A bare mention of the concept
// ("the owner's word is the source of truth", "a candidate for the owner's word") is prose about the
// rule, not a claim about a choice — it stays invisible, or the linter reddens on every canon page.
export const ATTRIBUTION = {
  ru: [
    cyr('(?:решени[еяю]|приказ[аеу]?|вердикт[аеу]?|распоряжени[еяю])\\s+(?:владельца|заказчика|автора)'),
    cyr('(?:владелец|заказчик|автор)\\s+(?:решил|велел|сказал|выбрал|попросил|потребовал|постановил|утвердил|запретил|разрешил|заказал|отверг|принял|одобрил)'),
    cyr('по\\s+(?:решению|слову|воле|приказу|требованию|распоряжению)\\s+(?:владельца|заказчика|автора)'),
  ],
  en: [
    /\bthe owner['’]?s\s+(?:decision|order|verdict|ruling|instruction)\b/i,
    /\b(?:the\s+)?owner\s+(?:decided|said|chose|ordered|asked|demanded|ruled|approved|forbade|allowed|rejected|accepted)\b/i,
    /\b(?:per|by|under|on)\s+the\s+owner['’]?s\s+(?:decision|word|will|order|instruction)\b/i,
    /\bdecided by the owner\b/i,
  ],
  // The owner's SIGNATURE (AGENT_GUIDE → "Authorship of a decision") is itself an attribution: `[OWNER]`
  // without his words beside it is the ticket's own acceptance mutant (#55 "как проверить починку").
  any: [/\[(?:OWNER|ВЛАДЕЛЕЦ)\]/u],
};
// Evidence that the attribution is grounded — any of these within the window.
// An opening guillemet or curly quote anywhere in the window counts: prose wraps at ~100 columns, so a
// verbatim quote often opens on one line and closes on the next; the ASCII pair must close on its line
// (a lone " is code and JSON as often as it is speech). A `>` quote line is evidence too — the most
// natural quoting form of a markdown document.
const QUOTE_RE = /«|“|"[^"\n]{3,}"/u;
const QUOTE_LINE_RE = /^\s*>/;
// An interview address — a pointer into the registry that holds the words.
const INTERVIEW_RE = /interviews\/|интервью\s*№\s*\d|interview\s*#\s*\d|interview_\d{3}/iu;
// The NUMBER of a recorded decision (`решение №109`, `decision #12`, `MASTER_PLAN §7 №95`) — a pointer into
// the decision journal. The number alone is NOT evidence (`issue №55`, a page, a bug): it must sit on a line
// that also carries a registry word. A plan or section address alone is not evidence either: the field
// line "the owner's decision P1 (plans/81 §3)" pointed at a plan whose "decision" was the agent's own.
// The registry word must sit NEXT to the number ("решение №105", "№105 (решение", "decision #12",
// "§7 №95", "MASTER_PLAN … №95"): the attribution line itself says "решение владельца", so a word
// anywhere on the line would ground a bare "(issue №55)" through the attribution's own wording.
const DECISION_ADDRESS_RE = /(?:решени[а-яё]*\s+(?:владельца\s+)?№\s*\d+|№\s*\d+\s*\(?\s*решени|decision\s*#\s*\d+|№\s*\d+\s*\(?\s*decision|§\s*7\s*№\s*\d+|MASTER_PLAN[^\n]{0,40}№\s*\d+|журнал[а-яё]*\s+решений[^\n]{0,20}№\s*\d+)/iu;
const decisionAddress = (l) => DECISION_ADDRESS_RE.test(l);
// A COMMIT address (2.8, epic CK; origin issue #89): the owner's standing rule enters the rulebook as a rule, and his verbatim words
// stay at the source — most often the "commit the original verbatim first" commit. The commit word must sit NEXT to a hash of 7+ hex
// digits ("verbatim in commit 6411a9ed", "коммит `2d897c5`"): a bare hash is anything, and "the commit above" names nothing.
// Left: not a letter ("recommit" is not the word). Between word and hash: spaces, `:`, `#`, `/`, a backtick — "commit: 3c2da82",
// ".../commit/3c2da82". The hash carries at least one DIGIT, so an all-hex English word ("defaced") is not a hash. It grounds only
// the attribution's OWN line (see lintText): the provenance form is one line, and hashes stand everywhere in plans and reports.
const COMMIT_ADDRESS_RE = /(?<!\p{L})(?:commits?|коммит[а-яё]*)[\s:#/`]*(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![0-9a-z])/iu;
const OK_MARK_RE = /<!--\s*attribution-ok:/iu;
// The agent's own signature on the line — a signed agent decision is not an attribution.
const DEFAULT_AGENT_MARKS = ['[AI]', '[AI-ed]', '[ИИ]', '[ИИ-ред]'];
// A "decisions made without the owner" section is the agent's signature block-wise (any language).
const SELF_SECTION = /(Decisions made without the owner|Решения, принятые агентом без владельца|Решения без владельца|Decisions without the owner)/iu;

function agentMarks(root = '.') {
  const marks = [...DEFAULT_AGENT_MARKS];
  const p = join(root, KAIF_JSON);
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
      if (Array.isArray(j.aiMarks)) for (const m of j.aiMarks) if (typeof m === 'string') marks.push(m);
    } catch { /* a malformed marker is the provenance gate's business, not this linter's */ }
  }
  return marks;
}

// Strip what must not be judged: HTML comments and inline code spans (the text stays for evidence).
const stripInvisible = (line) => line.replace(/<!--.*?-->/g, ' ').replace(/`[^`]*`/g, ' ');
const headingLevel = (l) => { const m = l.match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
const grounds = (l) => QUOTE_RE.test(l) || QUOTE_LINE_RE.test(l) || INTERVIEW_RE.test(l) || decisionAddress(l);

/** Findings of one document: [{ line, text }] — text is the exact source line (trimmed). */
export function lintText(src, marks = DEFAULT_AGENT_MARKS) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let fence = false;
  let selfUntil = -1;   // inside a "decisions without the owner" section until this heading level closes it
  let selfLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const h = headingLevel(raw);
    if (h) {
      if (selfUntil >= 0 && h <= selfLevel) selfUntil = -1;
      if (SELF_SECTION.test(raw)) { selfUntil = i; selfLevel = h; continue; }
    }
    if (selfUntil >= 0) continue;                       // the agent's own decisions, signed block-wise
    if (QUOTE_LINE_RE.test(raw)) continue;              // a quote line — evidence for neighbours, never a finding
    if (raw.includes('❌')) continue;                    // the canon's counter-example
    const text = stripInvisible(raw);
    const attributes = Object.values(ATTRIBUTION).some((rules) => rules.some((re) => re.test(text)));
    if (!attributes) continue;
    if (OK_MARK_RE.test(raw)) continue;                 // the declared exception names where the quote lives
    if (marks.some((m) => raw.includes(m))) continue;   // signed as the agent's decision
    const lo = Math.max(0, i - WINDOW), hi = Math.min(lines.length - 1, i + WINDOW);
    let grounded = COMMIT_ADDRESS_RE.test(raw);         // a commit address grounds its own line only
    for (let j = lo; j <= hi && !grounded; j++) if (grounds(lines[j])) grounded = true;
    if (grounded) continue;
    out.push({ line: i + 1, text: raw.trim() });
  }
  return out;
}

// 2.8 (epic SC; origin #77 · Q-R1′): the files git sees (kaifWalk above) — a broken link is skipped with a name, never a stack
// trace; a walk that could not see part of the tree is named, never a clean pass.
const TREE = { skipped: [], failed: [] };
function* walkMd(dir, root) {
  if (!existsSync(dir)) return;
  const tree = kaifWalk([dir]);
  TREE.skipped.push(...tree.skipped); TREE.failed.push(...tree.failed);
  for (const p of tree.files) {
    const segs = walkRel(dir, p).split('/');
    if (segs.some((s) => SKIP_DIRS.has(s))) continue;
    if (/\.md$/i.test(segs[segs.length - 1])) yield p;
  }
}
function scopeFiles(root, paths) {
  const files = [];
  if (paths.length) {
    for (const p of paths) {
      const full = join(root, p);
      if (!existsSync(full)) continue;
      if (statSync(full).isDirectory()) files.push(...walkMd(full, root)); else if (/\.md$/i.test(full)) files.push(full);
    }
  } else {
    for (const d of DEFAULT_DIRS) files.push(...walkMd(join(root, d), root));
    // PV1 (2.9; origin issue #111 — a root file git ignores, the owner's private voice portrait, was read from disk and its line went
    // into the committed baseline): the root *.md come from the same git-seen walk as the directories — an ignored root file is not
    // in the set; without git the walk lists the disk, as before
    const top = kaifWalk([root]);
    TREE.skipped.push(...top.skipped.filter((s) => !walkRel(root, s).includes('/'))); TREE.failed.push(...top.failed);
    for (const p of top.files) { const r = walkRel(root, p); if (!r.includes('/') && /\.md$/i.test(r) && !TRANSIENTS.has(r)) files.push(p); }
  }
  return files.map((f) => f.replaceAll('\\', '/')).sort();
}
const rel = (root, f) => f.replaceAll('\\', '/').replace(root.replaceAll('\\', '/').replace(/\/?$/, '/'), '').replace(/^\.\//, '');

function readBaseline(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

/** The check over a root: { findings: [{file, line, text, key}], scanned } */
export function runCheck(root, paths = []) {
  TREE.skipped.length = 0; TREE.failed.length = 0;
  const marks = agentMarks(root);
  const files = scopeFiles(root, paths);
  const findings = [];
  for (const f of files) {
    const r = rel(root, f);
    const text = readWalked(TREE, f);   // unreadable → the walk's FAILED line (SC4 F1)
    if (text === null) continue;
    for (const x of lintText(text, marks)) findings.push({ file: r, line: x.line, text: x.text, key: `${r}:${sha16(x.text)}` });
  }
  return { findings, scanned: files.length, walk: walkNotes(TREE), walkFailed: TREE.failed.length > 0 };
}

// The baseline (2.9, epic PV): `entries` maps `file:sha16(line)` to the COUNT of findings with that key — a fingerprint and a number,
// never the text (origin #121 R7: the text of a line went into a committed file, and nothing ever read it back). A baseline written
// before 2.9 carries the text as the value: its keys stay debt for any number of copies (the old reading, so no recorded debt is lost
// on the first closing after the update), and the next write drops the text.
const LEGACY = Infinity;
const LEGACY_VALUE = 'recorded before 2.9';   // what a pre-2.9 text value becomes when a path-limited write carries it over: no text, same reading
const countOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : LEGACY);
const fileOfKey = (k) => k.slice(0, k.lastIndexOf(':'));
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
/** Is a baselined file inside the scope of this run (no paths = the whole default scope)? */
export function inScope(file, paths = []) {
  if (!paths.length) return true;
  return paths.map(normPath).some((p) => p === '.' || file === p || file.startsWith(p + '/'));
}
/** The findings above what the baseline records, key by key: the (count+1)-th copy of a recorded line is NEW (origin #112 — a third
 *  identical line used to be swallowed as debt, `new 0 · debt 3`). */
export function freshFindings(findings, baseline) {
  const known = (baseline && baseline.entries) || {};
  const seen = {};
  return findings.filter((f) => { seen[f.key] = (seen[f.key] || 0) + 1; return !(f.key in known) || seen[f.key] > countOf(known[f.key]); });
}
/** The baseline a write leaves (PV3; origin #112 — `check <path> --write-baseline` wrote the scope's findings as the WHOLE baseline and
 *  erased the debt of every other file): entries of files outside the scope stay as they are; inside it, the counts of this run. */
export function nextBaseline(findings, baseline, paths = []) {
  const entries = {};
  // an entry outside the scope keeps its debt; a 2.8 text value keeps its reading (debt for any number of copies) but loses the text —
  // the judge of epic PV: a deployment that only ever writes with a path kept the text of every other file forever
  for (const [k, v] of Object.entries((baseline && baseline.entries) || {})) if (!inScope(fileOfKey(k), paths)) entries[k] = typeof v === 'number' ? v : LEGACY_VALUE;
  for (const f of findings) entries[f.key] = (typeof entries[f.key] === 'number' ? entries[f.key] : 0) + 1;
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));   // canonical order: the file is reviewed in diffs
  const count = Object.values(sorted).reduce((n, v) => n + (typeof v === 'number' ? v : 1), 0);
  return { written: new Date().toISOString(), count, entries: sorted };
}
/** Recorded entries of the scope that this run no longer finds (fully or in part) — the "rewrite it" hint counts only these. */
export function prunableEntries(findings, baseline, paths = []) {
  const now = {};
  for (const f of findings) now[f.key] = (now[f.key] || 0) + 1;
  return Object.entries((baseline && baseline.entries) || {})
    .filter(([k, v]) => inScope(fileOfKey(k), paths) && (now[k] || 0) < (countOf(v) === LEGACY ? 1 : countOf(v))).length;
}
function writeBaseline(next) {
  const dir = dirname(BASELINE);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });   // a bare file name has no directory to create
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
}

function cmdCheck() {
  const root = '.';
  const { findings, scanned, walk, walkFailed } = runCheck(root, PATHS);
  for (const n of walk) console.error((n.includes('walk FAILED') ? '✖ ' : '⚠ ') + n);
  if (walkFailed) { console.error('✖ attribution-lint: the tree walk failed — not scanned is not clean'); process.exit(1); }
  if (!scanned) { log(`⊘ SKIPPED — no markdown in scope (${PATHS.length ? PATHS.join(' ') : DEFAULT_DIRS.join(' ') + ' + root *.md'}): nothing was proven (exit 3).`); process.exit(EXIT_SKIPPED); }
  const baseline = readBaseline(BASELINE);
  const fresh = freshFindings(findings, baseline);
  if (FLAGS.has('--write-baseline')) {
    // Adoption writes the whole picture once. After that the baseline ONLY SHRINKS: a rewrite that would
    // launder a NEW finding into debt is refused — growth is an explicit, printed act (--adopt-new).
    if (baseline && fresh.length && !FLAGS.has('--adopt-new')) {
      for (const f of fresh) console.error(`✖ NEW, not baselined: ${f.file}:${f.line} — «${f.text.slice(0, 100)}»`);
      console.error(`✖ baseline NOT rewritten: ${fresh.length} NEW finding(s) would become debt — ground them (quote · address · [AI]) or pass --adopt-new to record them on purpose`);
      process.exit(1);
    }
    const pruned = baseline ? prunableEntries(findings, baseline, PATHS) : 0;
    const next = nextBaseline(findings, baseline, PATHS);
    writeBaseline(next);
    const kept = Object.keys(next.entries).filter((k) => !inScope(fileOfKey(k), PATHS)).length;
    log(`baseline written: ${BASELINE} — ${findings.length} finding(s) recorded as debt${baseline ? ` (${fresh.length} adopted as NEW on purpose, ${pruned} pruned)` : ''}${kept ? `; ${kept} entr${kept === 1 ? 'y' : 'ies'} of files outside ${PATHS.join(' ')} kept as they were` : ''} (it only shrinks from here; a changed or vanished line is pruned on the next write; the file holds fingerprints and counts, never the text)`);
    return;
  }
  const debt = findings.length - fresh.length;
  for (const f of fresh) console.error(`✖ ${f.file}:${f.line} — attribution to the owner without his words: «${f.text.slice(0, 120)}» (no verbatim quote, quote line, interview address or decision number within ±${WINDOW} lines, and no commit address on the line itself; sign it [AI] if it is the agent's, for his standing rule write "[OWNER] <date> · verbatim in commit <hash>", quote him if it is his decision, or mark <!-- attribution-ok: … -->)`);
  const prunable = baseline ? prunableEntries(findings, baseline, PATHS) : 0;
  const tail = baseline ? ` · debt ${debt} (baseline ${BASELINE}${prunable > 0 ? `, ${prunable} entr${prunable === 1 ? 'y' : 'ies'} no longer found — rewrite it` : ''})` : (findings.length ? ' · no baseline yet — adopt with --write-baseline' : '');
  if (fresh.length) { console.error(`✖ attribution-lint: ${fresh.length} NEW finding(s) in ${scanned} file(s)${tail}`); process.exit(1); }
  log(`✅ attribution-lint OK — ${scanned} file(s) scanned, new 0${tail}`);
}

// ---------------------------------------------------------------------------
// selftest — both answers on in-memory fixtures, then the baseline behaviour on a temp tree.
function cmdSelftest() {
  let n = 0, bad = 0;
  const expect = (name, src, want, marks = DEFAULT_AGENT_MARKS) => {
    n++;
    const got = lintText(src, marks).length;
    const ok = got === want;
    if (!ok) bad++;
    log(`${ok ? '✅' : '❌'} ${name} — findings ${got}, expected ${want}`);
  };
  const FIELD_LINE = '* ⚡ Ш5 — ОЖИДАНИЕ РАСПИСКИ РУКИ 2. Решение владельца П1 (plans/81 §3): ЖДАТЬ, порога не заводить.';
  expect('RU: the field line, no quote → finding', `# x\n\n${FIELD_LINE}\n\nТекст.\n`, 1);
  expect('RU: the same line with the mandate quoted beside it → clean', `${FIELD_LINE}\nСлово владельца дословно: «давай как ты считаешь».\n`, 0);
  expect('RU: a `>` quote line beside it → clean', `Решение владельца — ждать.\n> давай как ты считаешь\n`, 0);
  expect('RU: an interview address in the window → clean', `Решение владельца — ждать.\nИсточник: интервью №031, Q1.\n`, 0);
  expect('RU: a decision number WITH a registry word → clean', `По слову владельца порог снят (решение №105).\n`, 0);
  expect('RU: a bare number without a registry word (an issue) → finding', `Решение владельца П1: ждать (issue №55).\n`, 1);
  expect('RU: signed as the agent\'s decision → clean', `[ИИ] по мандату — «давай как ты считаешь»: ждать расписки; решение владельца не требовалось.\n`, 0);
  expect('RU: the declared exception on the line → clean', `Решение владельца П1: ждать. <!-- attribution-ok: plans/81 §3 -->\n`, 0);
  expect('RU: "владелец велел" without words → finding', `Владелец велел убрать порог.\n`, 1);
  expect('RU: "по слову владельца" with a quote two lines away → clean', `По слову владельца порог снят.\n\n«порога не заводить» — его слова 2026-09-08.\n`, 0);
  expect('RU: a quote THREE lines away is outside the window → finding', `По слову владельца порог снят.\n\n\n«порога не заводить».\n`, 1);
  expect('RU: the owner\'s signature without his words → finding (the ticket\'s mutant)', `[ВЛАДЕЛЕЦ] ждать, порога не заводить · 2026-09-08 — не пересматривать.\n`, 1);
  expect('RU: the owner\'s signature with his words → clean', `[ВЛАДЕЛЕЦ] «давай как ты считаешь» · 2026-09-08.\n`, 0);
  expect('EN: the owner\'s decision without words → finding', `The owner's decision P1: wait, no threshold.\n`, 1);
  expect('EN: with the interview address → clean', `The owner's decision (interview #031, Q1): wait.\n`, 0);
  expect('EN: "the owner decided" with a quote → clean', `The owner decided: "do as you see fit".\n`, 0);
  expect('EN: with a decision number and the registry word → clean', `Per the owner's decision (decision #12): wait.\n`, 0);
  expect('EN: signed [AI] by mandate → clean', `[AI] by mandate — "do as you see fit": wait for the receipt; the owner's decision is not claimed.\n`, 0);
  expect('EN: the owner\'s signature without his words → finding', `[OWNER] wait, no threshold · 2026-09-08 — not to be revisited.\n`, 1);
  expect('EN: the owner\'s signature with his words → clean', `[OWNER] "do as you see fit" · 2026-09-08.\n`, 0);
  // 2.8, epic CK (origin issue #89): the rulebook takes the RULE, the verbatim words stay at the source — a commit address grounds it.
  expect('EN: the owner\'s rule with the commit address of his verbatim words → clean (#89 field form)', `[OWNER] 2026-09-22 · verbatim in commit 6411a9ed\n`, 0);
  expect('RU: правило владельца с адресом коммита → clean', `[ВЛАДЕЛЕЦ] 2026-09-22 · дословно — коммит \`2d897c5\`\n`, 0);
  expect('EN: "verbatim in the commit" with no hash → finding', `[OWNER] 2026-09-22 · verbatim in the commit above.\n`, 1);
  expect('EN: a bare hash without the commit word → finding', `[OWNER] 2026-09-22 · 6411a9ed\n`, 1);
  // CK4 judge: the forms a real line uses, and the three loose matches of the first edition
  expect('EN: "commit: <hash>" and a commit URL → clean', `[OWNER] 2026-09-22 · verbatim in commit: 3c2da82\n\n\n\n[OWNER] 2026-09-23 · https://github.com/o/r/commit/3c2da82\n`, 0);
  expect('EN: "recommit 1234567" is not the commit word → finding', `[OWNER] 2026-09-22 · recommit 1234567\n`, 1);
  expect('EN: an all-hex English word is not a hash ("commit defaced") → finding', `[OWNER] 2026-09-22 · commit defaced\n`, 1);
  expect('EN: a commit hash on a NEIGHBOUR line grounds nothing', `The owner decided to drop the Android build.\nFixed in commit 80a18eb.\n`, 1);
  expect('invisible: ❌ counter-example → clean', `❌ the owner's decision with no quote — the bad form.\n`, 0);
  expect('invisible: inline code and a fenced block → clean', 'Use `the owner\'s decision` and `[OWNER]` as the pattern.\n\n```\nthe owner\'s decision P1: wait\n```\n', 0);
  expect('invisible: a `>` quote line is never a finding → clean', `> Решение владельца П1: ждать — цитата из старого документа.\n`, 0);
  expect('block signature: a "decisions without the owner" section is skipped, the next section is not', `## Decisions made without the owner\n\n1. По решению владельца ждать — нет, это выбор агента.\n\n## Links\n\nПо решению владельца ждать.\n`, 1);
  expect('localized aiMarks from kaif.json are a signature too', `[КИ] по мандату: ждать; решение владельца не требовалось.\n`, 0, [...DEFAULT_AGENT_MARKS, '[КИ]']);

  // baseline behaviour on a temp tree: adopt → clean; a NEW line → exit 1 naming it only
  const root = mkdtempSync(join(tmpdir(), 'kaif-attribution-'));
  try {
    mkdirSync(join(root, 'plans'), { recursive: true });
    writeFileSync(join(root, 'plans', '01.md'), `# P\n\n${FIELD_LINE}\n`);
    const first = runCheck(root);
    const entries = {}; for (const f of first.findings) entries[f.key] = f.text;
    writeFileSync(join(root, 'baseline.json'), JSON.stringify({ entries }));
    writeFileSync(join(root, 'plans', '01.md'), `# P\n\n${FIELD_LINE}\n\nВладелец велел убрать порог.\n`);
    const second = runCheck(root);
    const fresh = second.findings.filter((f) => !(f.key in entries));
    n++;
    const ok = second.findings.length === 2 && fresh.length === 1 && /велел/.test(fresh[0].text);
    if (!ok) bad++;
    log(`${ok ? '✅' : '❌'} baseline: the old line is debt, only the new line is NEW — findings ${second.findings.length}, new ${fresh.length}`);
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 2.9, epic PV (criterion 19 of the origin's plan; origin #111 · #112 · #121 R7) — four cases, each red on the 2.8 module
  const pv = (name, ok, got) => { n++; if (!ok) bad++; log(`${ok ? '✅' : '❌'} PV: ${name}${ok ? '' : ` — got ${got}`}`); };
  const proot = mkdtempSync(join(tmpdir(), 'kaif-attribution-pv-'));
  try {
    // (1) a root file git ignores is not read (#111) — needs git; without it the walk lists the disk, and the case says so
    const g = spawnSync('git', ['init', '-q'], { cwd: proot, encoding: 'utf8' });
    writeFileSync(join(proot, '.gitignore'), 'NOTES.md\n');
    writeFileSync(join(proot, 'NOTES.md'), '# Notes\n\nThe owner decided to keep the recipe of his grandmother here.\n');
    writeFileSync(join(proot, 'STATUS.md'), '# S\n\nThe owner decided to wait.\n');
    if (g.status === 0) {
      const r = runCheck(proot);
      pv('a root file git ignores is not read (#111)', r.findings.length === 1 && r.findings[0].file === 'STATUS.md', r.findings.map((f) => f.file).join(','));
    } else log('⊘ PV: a root file git ignores — SKIPPED (no git here: the walk lists the disk)');
    // (2) the baseline holds fingerprints and counts, never the text (#121 R7)
    const b1 = nextBaseline(runCheck(proot).findings, null);
    const raw = JSON.stringify(b1);
    pv('the baseline holds no text of a finding (#121 R7)', !/decided|wait|recipe/.test(raw) && Object.values(b1.entries).every((v) => typeof v === 'number'), raw.slice(0, 160));
    // (3) a write limited to a path keeps the debt of the other files (#112)
    mkdirSync(join(proot, 'plans'), { recursive: true }); mkdirSync(join(proot, 'ideas'), { recursive: true });
    writeFileSync(join(proot, 'plans', '01.md'), '# P\n\nThe owner decided to drop it.\n');
    writeFileSync(join(proot, 'ideas', '02.md'), '# I\n\nThe owner decided to keep it.\n');
    const whole = nextBaseline(runCheck(proot).findings, null);
    const narrowed = nextBaseline(runCheck(proot, ['plans']).findings, whole, ['plans']);
    pv('a write limited to plans/ keeps the debt of ideas/ (#112)', Object.keys(narrowed.entries).some((k) => k.startsWith('ideas/02.md:')) && Object.keys(narrowed.entries).some((k) => k.startsWith('plans/01.md:')), Object.keys(narrowed.entries).join(','));
    // (4) a third identical line beside two recorded is NEW (#112)
    const twice = '# P\n\nThe owner decided to drop it.\n\n\n\n\nThe owner decided to drop it.\n';
    writeFileSync(join(proot, 'plans', '01.md'), twice);
    const rec2 = nextBaseline(runCheck(proot).findings, null);
    writeFileSync(join(proot, 'plans', '01.md'), twice + '\n\n\n\n\nThe owner decided to drop it.\n');
    const third = runCheck(proot).findings;
    const fresh3 = freshFindings(third, rec2);
    pv('a third identical line beside two recorded is NEW (#112)', fresh3.length === 1 && fresh3[0].file === 'plans/01.md', `${fresh3.length} new of ${third.length}`);
    // and the reading of a 2.8 baseline (text as the value) keeps every copy as debt — no recorded debt is lost on the first closing
    const legacy = { entries: Object.fromEntries(third.map((f) => [f.key, `${f.file}:${f.line} ${f.text}`])) };
    pv('a 2.8 baseline (text values) still reads as debt for every copy', freshFindings(third, legacy).length === 0, freshFindings(third, legacy).length);
    // the judge of PV: a write limited to a path carries the OTHER files' 2.8 entries over without their text, and with their debt
    const legacyIdeas = { entries: { 'ideas/02.md:0123456789abcdef': 'ideas/02.md:3 The owner decided to keep it.', ...legacy.entries } };
    const carried = nextBaseline(runCheck(proot, ['plans']).findings, legacyIdeas, ['plans']);
    pv('a path-limited write drops the 2.8 text of the entries it carries over', !/decided|keep it/.test(JSON.stringify(carried)) && 'ideas/02.md:0123456789abcdef' in carried.entries && freshFindings([{ key: 'ideas/02.md:0123456789abcdef' }, { key: 'ideas/02.md:0123456789abcdef' }], carried).length === 0, JSON.stringify(carried.entries).slice(0, 200));
  } finally { rmSync(proot, { recursive: true, force: true }); }

  if (bad) { console.error(`✖ selftest FAILED — ${bad} of ${n} cases`); process.exit(1); }
  log(`✅ selftest OK — ${n} cases (RU + EN; both answers on every fixture; baseline proven)`);
}

if (IS_MAIN) {
  ({ check: cmdCheck, selftest: cmdSelftest }[CMD] || (() => { console.error(`✖ unknown command: ${CMD} (check [paths…] [--write-baseline [--adopt-new]] [--baseline <file>] | selftest)`); process.exit(1); }))();
}
