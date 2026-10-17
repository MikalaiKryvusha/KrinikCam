#!/usr/bin/env node
// kaif-canon-lint.mjs — the OPTIONAL canon-artifact linter (plan 20 phase 5;
// plan 17 §3 / ideas 15 §2.6). Deployed to .kaif/tools/kaif-canon-lint.mjs.
//
// The discipline it mechanizes: every REVOKED decision becomes a FORBIDDEN wording; every
// ACCEPTED decision becomes a GUARDED full unique line. The linter GROWS with every fix —
// "closed a defect → add a guard for its whole class". Guard with FULL UNIQUE LINES, never
// short substrings: a short pattern happily matches someone else's text and stays green while
// the real thing rots (field-caught: a guard for "= 50" greened on an unrelated line).
//
// Rules live in the PROJECT at .kaif/canon-lint-rules.json and are owned by its agent+owner:
// {
//   "forbidden": [ { "pattern": "<regex>", "files": "rules/", "message": "why it is banned" } ],
//   "required":  [ { "line": "<FULL unique line>", "file": "rules/combat.md", "message": "what it guards" } ]
// }
//   forbidden.files — a "dir/" subtree or an exact path; omitted = all .md files.
//
// Commands:
//   node .kaif/tools/kaif-canon-lint.mjs check       # the gate: forbidden absent, required present
//   node .kaif/tools/kaif-canon-lint.mjs selftest    # PROVE the guards: every required line is
//                                                    # verified findable, every forbidden pattern
//                                                    # is verified to MATCH its own example
//                                                    # ("a guard that never went red proves nothing")
// selftest needs forbidden rules to carry "example": a string the pattern MUST match.
//
// Exit codes: 0 = the configured rules ran green · 1 = a guard fired (real failure) ·
//             3 = SKIPPED, not configured / zero rules — nothing was proven (bug 34: an
//             unconfigured guard must never read as a passed one).
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

const CMD = process.argv[2] || 'check';
const RULES = '.kaif/canon-lint-rules.json';
const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };

// "Not configured" must be DISTINGUISHABLE from "checked and passed" (bug 34, three field
// projects independently: an unconfigured guard exiting 0 wires a forever-green gate into CI —
// "the proof is absent but looks like success"). Exit 3 = SKIPPED: nothing was proven; exit 1
// stays reserved for real guard failures; exit 0 means the configured rules actually ran.
// (Supersedes the bug 30.2 compromise — the field showed its price.)
const EXIT_SKIPPED = 3;
if (!existsSync(RULES)) {
  console.log(`⊘ SKIPPED — ${RULES} not found: canon lint is not configured, nothing was proven (optional module; seed it — see this file's header for the format). Exit code 3 keeps an unconfigured guard from reading as a passed one (bug 34).`);
  process.exit(EXIT_SKIPPED);
}
const rules = JSON.parse(readFileSync(RULES, 'utf8').replace(/^\uFEFF/, ''));
if (!(rules.forbidden || []).length && !(rules.required || []).length) {
  console.log(`⊘ SKIPPED — ${RULES} carries zero rules: nothing to prove (exit 3; add forbidden/required rules — the linter grows with every fix).`);
  process.exit(EXIT_SKIPPED);
}

// The machinery's own transients (tasks, the thin entry point) legally QUOTE conventions and
// forbidden wordings while describing them — scanning them is self-inflicted red (bug 34 class).
const TRANSIENTS = ['KAIF.md', 'KAIF_UPDATE_TASK.md', 'KAIF_ADAPTATION_TASK.md', 'KAIF_UPDATE_TASK.superseded.md'];
// 2.8 (epic SC; origin #77 · Q-R1′): the files git sees (kaifWalk above) — a broken link is skipped with a name, never a stack
// trace; a walk that could not see part of the tree is an issue, never a clean pass.
const TREE = { skipped: [], failed: [] };
function* walkMd(dir = '.') {
  const tree = kaifWalk([dir]);
  TREE.skipped.push(...tree.skipped); TREE.failed.push(...tree.failed);
  for (const p of tree.files) {
    const segs = p.split('/');
    if (segs.some((s) => ['.git', 'node_modules', '.kaif'].includes(s))) continue;
    if (segs.length === 1 && TRANSIENTS.includes(p)) continue;
    if (/\.md$/i.test(p)) yield p;
  }
}
// files in rules may be written with backslashes on Windows — walkMd always yields forward slashes
const inScope = (p, files) => !files || ((files = files.replaceAll('\\', '/')).endsWith('/') ? p.startsWith(files) : p === files);
// CRLF checkouts and PS5.1 Out-File BOMs are the documented Windows profile of real projects:
// read EOL/BOM-normalized, or required lines false-redden and $-anchored forbidden patterns
// false-GREEN (the worst failure direction).
// an unreadable file is part of the tree the lint did not see — the walk's FAILED line names it (SC4 F1)
const readLines = (p) => { const t = readWalked(TREE, p); return t === null ? null : t.replace(/^\uFEFF/, '').split(/\r?\n/); };
// A broken regex must red the run with a clear message, not a raw stack trace.
const compileRule = (r) => { try { return new RegExp(r.pattern); } catch (e) { console.error(`✖ invalid regex in forbidden rule: ${r.pattern} — ${e.message}`); return null; } };

function cmdCheck() {
  let issues = 0;
  const mdFiles = [...walkMd()];
  for (const r of rules.forbidden || []) {
    const re = compileRule(r);
    if (!re) { issues++; continue; }
    for (const p of mdFiles) {
      if (!inScope(p, r.files)) continue;
      const lines = readLines(p);
      if (!lines) continue;
      for (let i = 0; i < lines.length; i++)
        if (re.test(lines[i])) { console.error(`✖ forbidden in ${p}:${i + 1} — ${r.message || r.pattern}`); issues++; }
    }
  }
  for (const r of rules.required || []) {
    if (!r.file || !existsSync(r.file)) { console.error(`✖ required-line file missing: ${r.file} — ${r.message || ''}`); issues++; continue; }
    const req = readLines(r.file);
    if (!req) { issues++; continue; }
    if (!req.includes(r.line)) { console.error(`✖ guarded line MISSING from ${r.file} — ${r.message || ''}\n    wanted: ${r.line}`); issues++; }
  }
  for (const n of walkNotes(TREE)) console.error((n.includes('walk FAILED') ? '✖ ' : '⚠ ') + n);
  if (TREE.failed.length) issues++;
  if (issues) die(`canon lint FAILED: ${issues} issue(s)`);
  log(`✅ canon lint OK (${(rules.forbidden || []).length} forbidden + ${(rules.required || []).length} required rules)`);
}

// A guard is proven, not assumed: required lines must be full and unique; forbidden patterns
// must actually match their own recorded example (else the guard would green forever).
function cmdSelftest() {
  let issues = 0;
  for (const r of rules.required || []) {
    if (!r.line || r.line.trim().length < 12) { console.error(`✖ required line too short to be unique (guard with FULL lines): "${r.line}"`); issues++; continue; }
    // A guard pointing at a missing file cannot fire — selftest's own promise ("every required
    // line is verified findable") demands a red here, not a silent skip (judge finding, L3).
    if (!r.file || !existsSync(r.file)) { console.error(`✖ required-line file missing: ${r.file || '(none)'} — a guard pointing at nothing cannot fire`); issues++; continue; }
    const hits = readLines(r.file).filter((l) => l === r.line).length;
    if (hits > 1) { console.error(`✖ required line is NOT unique in ${r.file} (${hits} hits): "${r.line.slice(0, 60)}…"`); issues++; }
  }
  for (const r of rules.forbidden || []) {
    if (!r.example) { console.error(`✖ forbidden rule has no "example" to prove it on: ${r.pattern}`); issues++; continue; }
    const re = compileRule(r);
    if (!re) { issues++; continue; }
    if (!re.test(r.example)) { console.error(`✖ forbidden pattern does NOT match its own example (a guard that never reddens proves nothing): ${r.pattern}`); issues++; }
  }
  if (issues) die(`canon lint selftest FAILED: ${issues} issue(s)`);
  log(`✅ canon lint selftest OK — every guard is proven able to fire`);
}

({ check: cmdCheck, selftest: cmdSelftest }[CMD] || (() => die(`unknown command: ${CMD} (check | selftest)`)))();
