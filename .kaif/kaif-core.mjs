#!/usr/bin/env node
// KAIF-CORE.mjs — the heavy KAIF installer machinery (thin-install architecture; version-neutral:
// the deployed version lives in the bundle manifest and .kaif/kaif.json, never in this header —
// a baked-in version here shipped stale twice, bug 10).
// Downloaded by KAIF-LOADER.mjs from the origin repo; does EVERYTHING mechanizable
// about deploying KAIF so the AI agent's cognitive work shrinks to one short final
// adaptation task. Successor of kaif-unpack.mjs (which stays embedded in the
// offline KAIF-FULL.md); this file lives on at .kaif/kaif-core.mjs after install
// and backs the kaif:* npm handles (version/check).
//
// Commands:
//   node kaif-core.mjs install --bundle <KAIF-CORE-BUNDLE.md> [options]
//   node kaif-core.mjs check                       # validate the deployed manifest (bundle must still exist)
//   node kaif-core.mjs verify-final                # checkpoints done? then self-clean the install artifacts
//   node kaif-core.mjs sync                        # re-sync per-system skill mirrors from .claude/skills/
//   node kaif-core.mjs diff [--source <x>]         # audit disk vs deployed templates | preview vs another version
//   node kaif-core.mjs adopt-current               # rebuild the snapshot after a MANUAL migration
//   node kaif-core.mjs version                     # report the deployed version from .kaif/kaif.json
//
// Install options:
//   --lang <code>       owner's working language (default: en). Owner-facing docs come from the
//                       bundle's language templates when present; otherwise English + a translation
//                       item in the adaptation task.
//   --mode <m>          standard (default) | anonymous — anonymous skips origin-tied skills and
//                       writes no origin field (anonymity by design; no prose scrubbing needed).
//   --agents <list>     comma list to narrow the target systems (default: all five:
//                       claude-code,codex,grok-build,cline,zoo-code). AGENTS.md is always written.
//   --force             overwrite existing non-empty files.
//
// Exit code 0 = the step is 100% satisfied; non-zero = incomplete (fix and re-run).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------- CLI
const args = process.argv.slice(2);
const CMD = args[0] && !args[0].startsWith('--') ? args[0] : 'install';
const val = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const has = (f) => args.includes(f);

const BUNDLE = val('--bundle') || '.kaif/install/KAIF-CORE-BUNDLE.md';
// LANG/AGENTS/MODE are `let`: post-install commands inherit them from the project's
// .kaif/kaif.json unless explicitly overridden on the CLI (see below for MODE/ANON).
let LANG = (val('--lang') || 'en').toLowerCase();
let MODE = (val('--mode') || 'standard').toLowerCase();
let ANON = MODE === 'anonymous';
const FORCE = has('--force');
const ALL_AGENTS = ['claude-code', 'codex', 'grok-build', 'cline', 'zoo-code'];
let AGENTS = (val('--agents') || ALL_AGENTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const ORIGIN = 'https://github.com/MikalaiKryvusha/KAIF';
// Skills skipped on anonymous installs. kaif-version included since 1.5: its template
// references the origin repo, and anonymity is BY DESIGN now — the version stays readable
// in .kaif/kaif.json directly.
const ORIGIN_TIED = ['kaif-update', 'kaif-switch-origin', 'kaif-fork', 'kaif-version'];
// Author identity tokens, grouped in transliteration CLUSTERS: anonymous installs strip marked
// regions, de-expand the brand acronym, and the final gates grep the DEPLOYED paths for these.
// Clusters matter because the scan must excuse the PROJECT OWNER's own name across scripts:
// an owner named Кривуша writes Latin "Kryvusha" into git config — both spellings are his,
// neither is a leak (bug 13, field blocker: 44 false hits froze an update).
const AUTHOR_TOKEN_CLUSTERS = [['Kryvusha', 'Кривуша', 'MikalaiKryvusha'], ['KRINIK', 'Krinik', 'Криник']];
const ACRONYM_EXPANSIONS = ['KAIF (Krinik AI Framework)', 'Krinik AI Framework (KAIF)', 'Krinik AI Framework'];
const KAIF_JSON = '.kaif/kaif.json';
const DEPLOY_MANIFEST = '.kaif/deploy-manifest.json'; // persisted path list — `check` works after the bundle is cleaned
const TASK_FILE = 'KAIF_ADAPTATION_TASK.md';
const FENCE = '`'.repeat(6);

// The canonical deploy-time placeholders (KAIF.md §11). CORE fills what it can
// detect mechanically; the rest lands in the adaptation task for the agent.
const PLACEHOLDERS = ['<PROJECT_NAME>', '<SHORT_NAME>', '<AUTHOR>', '<REPO_URL>', '<LOCAL_PATH>',
                      '<LICENSE>', '<BUILD_COMMAND>', '<TEST_HARNESS>', '<COMMIT_COMMAND>', '<YOUR AGENT/MODEL>',
                      "<YOUR AGENT'S noreply EMAIL>",   // bug 28: shipped by /end-chat, was invisible to the gate
                      '<OWNER_LANGUAGE>'];

// Docs seeded/owned by the OWNER after deploy — an update never touches them and never
// even lists them as "diverged" (their divergence is the whole point of their existence).
const OWNER_SEEDED = ['GOAL.md', 'STATUS.md', 'PROJECT_HISTORY.md', 'EXPERIENCE.md', 'MASTER_PLAN.md',
  'PROJECT_STRUCTURE_EXTERNAL_MAP.md', 'PROJECT_ARCHITECTURE_INTERNAL_MAP.md', 'KAIF_FRAMEWORK.md'];
// Where update fetches the fresh machinery from (mirrors KAIF-LOADER.mjs).
const SOURCES = { release: `${ORIGIN}/releases/latest/download`,
                  main: 'https://raw.githubusercontent.com/MikalaiKryvusha/KAIF/main/dist' };
const UPDATE_TASK = 'KAIF_UPDATE_TASK.md';

const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };
const okOnDisk = (p) => existsSync(p) && statSync(p).size > 0;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileSha = (p) => sha256(readFileSync(p));
const sh = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
// JSON reader tolerant of a UTF-8 BOM (Windows tools like PowerShell 5 write one).
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));

// Anonymity is a property of the DEPLOYMENT, not of the CLI call (bug 11 / GH issue #1,
// reproduced by three field reports): a bare `check` on an anonymous install reported the
// deliberately-skipped origin-tied skills as MISSING, and the red gate pushed weak models
// toward "fixing" it by deploying them — breaking anonymity. When --mode is not passed,
// inherit `tracking` from the deployed marker — the same pattern `check` already uses for agents.
// [TESTED: 2026-07-27 · sandbox S2: bare `check` green on an anonymous install with the bundle
// alive; explicit `--mode standard` still red (CLI override wins)]
if (!val('--mode') && okOnDisk(KAIF_JSON)) {
  try { if (readJson(KAIF_JSON).tracking === 'anonymous') { MODE = 'anonymous'; ANON = true; } }
  catch { /* unreadable marker — the CLI default stands */ }
}

// ---------------------------------------------------------------------------- modules (plan 21)
// A MODULE is a logical section of a template — the atom of diffing and replacement (KAIF 2.0).
// The splitter/classifier MIRROR tools/module-map-lib.mjs at the origin (the core must stay one
// self-contained file); the build's check pins the two implementations behaviorally: the `modules`
// command output must equal dist/kaif-module-map.json for the same bundle.
const normEol = (s) => s.replace(/\r\n/g, '\n');
const normSha = (data) => sha256(normEol(String(data)));           // EOL-normalized sha: CRLF never
const fileShaNorm = (p) => normSha(readFileSync(p, 'utf8'));       // fakes a divergence (bug 12)

function splitModules(content) {
  const lines = content.split('\n');
  const modules = [];
  let cur = { signature: '<preamble>', lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) inFence = !inFence;    // headings inside fences are not anchors
    if (!inFence && /^#{1,3} /.test(line)) { modules.push(cur); cur = { signature: line, lines: [] }; }
    cur.lines.push(line);
  }
  modules.push(cur);
  return modules.filter((m) => m.signature !== '<preamble>' || m.lines.join('').length > 0);
}
const joinModules = (mods) => mods.flatMap((m) => m.lines).join('\n');
const modText = (m) => m.lines.join('\n');

// Computed classes (plan 21 §3.1): owner files are never in scope; a module carrying a canonical
// placeholder (or a skill frontmatter) is adaptive — replaced WITH value transfer; the rest is
// static — upstream-owned, mechanically replaceable. `overrides` ship in the bundle meta.
function classifyModule(dest, mod, overrides) {
  const eff = dest.replace(/^templates\/languages\/[^/]+\//, '');
  const o = (overrides || {})[eff] || (overrides || {})[dest];
  if (o && o.modules && o.modules[mod.signature]) return o.modules[mod.signature];
  if (o && o.default) return o.default;
  if (OWNER_SEEDED.includes(eff)) return 'owner';
  const text = modText(mod);
  if (PLACEHOLDERS.some((ph) => text.includes(ph))) return 'adaptive';
  if (mod.signature === '<preamble>' && /^\.claude\/skills\//.test(eff) && /^description:/m.test(text)) return 'adaptive';
  return 'static';
}
const moduleEntries = (dest, content, overrides) => splitModules(content).map((m) => ({
  signature: m.signature, class: classifyModule(dest, m, overrides), sha256: normSha(modText(m)) }));

// The owner's writing system, for the localization safety net (decision #17): a disk module in
// the owner's script must never be silently replaced by a template that carries none of it.
const SCRIPTS = { ru: /[А-Яа-яЁё]/, uk: /[А-Яа-я]/, be: /[А-Яа-я]/, 'zh-hans': /[一-鿿]/,
                  zh: /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, ar: /[؀-ۿ]/,
                  hi: /[ऀ-ॿ]/ };
function localizedAgainst(diskText, newText) {
  const re = SCRIPTS[LANG];
  return !!re && re.test(diskText) && !re.test(newText);
}

// A tiny line-level LCS diff — modules are small (median 9 lines), so O(n·m) is nothing.
// Renders the "old template → new template" delta the field asked for in 7 of 8 reports.
function lineDiff(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n');
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push('  ' + a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push('- ' + a[i]); i++; }
    else { out.push('+ ' + b[j]); j++; }
  }
  while (i < a.length) out.push('- ' + a[i++]);
  while (j < b.length) out.push('+ ' + b[j++]);
  return out.join('\n');
}

// Ignore-first (canon 1.6, bug 18): the transient installer artifacts enter .gitignore BEFORE
// they hit the tree, so a `git add -A` during the manual-merge window between update and
// update-verify cannot drag a 425 KB bundle into history (field-caught on NDim, which trapped
// exactly that). The lines stay useful after self-clean — updates recur.
// [TESTED: 2026-07-27 · sandboxes S1 (entries present right after install) + S4 (idempotent on update)]
function ensureIgnoreFirst() {
  const wanted = ['.kaif/install/', 'KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK,
                  'KAIF_UPDATE_TASK.superseded.md',
                  '.kaif/heartbeat.log'];   // the guarded loop's pulse is runtime state, not history
  let text = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).map((s) => s.trim()));
  const add = wanted.filter((w) => !have.has(w) && !have.has(w.replace(/\/$/, '')));
  if (!add.length) return;
  writeFileSync('.gitignore', text.replace(/\s*$/, text ? '\n' : '') + add.join('\n') + '\n');
  log(`+ .gitignore: ignore-first for ${add.join(', ')}`);
}

// ---------------------------------------------------------------------------- bundle parsing
// The bundle uses the proven KAIF.md block format: `> **FILE: \`path\`** …` + 6-backtick fence.
// One special block, FILE: `kaif-bundle-manifest.json`, carries per-file metadata
// (audience/adaptation notes) and the version stamp — it is data, never written to disk.
// `loose` (plan 21 §5.5): a synthetic-baseline source may be an OLD-era artifact (KAIF-FULL.md,
// a 1.4 KAIF.md) with FILE: blocks but no bundle manifest — return what parses instead of dying.
function parseBundle(src, loose = false) {
  if (!existsSync(src)) { if (loose) return null; die(`bundle not found: ${src} (pass --bundle <path>)`); }
  const text = readFileSync(src, 'utf8');
  const re = new RegExp('^> \\*\\*FILE: `([^`]+)`\\*\\*[^\\n]*\\r?\\n\\r?\\n' + FENCE + '\\w*\\r?\\n([\\s\\S]*?)\\r?\\n' + FENCE + '\\s*$', 'gm');
  const files = [];
  for (let m; (m = re.exec(text)); ) files.push({ path: m[1], content: m[2].replace(/\r\n/g, '\n') + '\n' });
  if (!files.length) { if (loose) return null; die('no FILE: blocks found — is this a KAIF-CORE-BUNDLE.md?'); }
  const metaBlock = files.find((f) => f.path === 'kaif-bundle-manifest.json');
  if (!metaBlock) { if (loose) return { files, meta: {} }; die('bundle manifest block (kaif-bundle-manifest.json) missing'); }
  const meta = JSON.parse(metaBlock.content);
  return { files: files.filter((f) => f.path !== 'kaif-bundle-manifest.json'), meta };
}

const skillName = (p) => (p.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/) || [])[1] || null;
const isSkippedAnon = (p) => ANON && ORIGIN_TIED.includes(skillName(p) || '');

// Language templates live in the bundle under templates/languages/<lang>/<dest-path>.
// For the chosen language they OVERRIDE the English default at <dest-path> (owner-facing
// docs: GOAL.md, KAIF_FRAMEWORK.md, the directory READMEs). A special member,
// templates/languages/<lang>/skill-triggers.json, maps skill → localized trigger aliases:
// the machinery appends them to each skill's `description:` line so the agent keeps
// matching commands in the owner's language while the skills stay English.
function applyLanguage(files) {
  // Case-insensitive prefix match: --lang is normalized to lowercase, but pack
  // directories may carry canonical casing (zh-Hans). Verified by the zh sandbox.
  const prefix = `templates/languages/${LANG}/`.toLowerCase();
  const overrides = new Map();
  let triggers = null;
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    if (lower === prefix + 'skill-triggers.json') { try { triggers = JSON.parse(f.content); } catch { die(`bad JSON in ${f.path}`); } }
    else overrides.set(f.path.slice(prefix.length), f.content);
  }
  const out = [];
  for (const f of files) {
    if (f.path.startsWith('templates/languages/')) continue;          // templates are inputs, not outputs
    let entry = overrides.has(f.path) ? { path: f.path, content: overrides.get(f.path) } : { ...f };
    const skill = skillName(entry.path);
    if (skill && triggers && triggers[skill])
      entry.content = entry.content.replace(/^(description:[^\n]*?)(\s*)$/m,
        (_, d) => `${d.replace(/\s+$/, '')} Trigger aliases (${LANG}): ${triggers[skill]}`);
    out.push(entry);
  }
  return { deploy: out, translated: overrides.size, aliased: triggers ? Object.keys(triggers).length : 0 };
}

// ---------------------------------------------------------------------------- placeholder autofill
// Detect real project values mechanically. Undetected placeholders stay literal and
// are listed in the adaptation task (they are the agent's cognitive work, not ours).
function detectValues() {
  let pkg = null;
  try { pkg = readJson('package.json'); } catch { /* none */ }
  const dir = process.cwd().replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'project';
  const name = (pkg && pkg.name) || dir;
  const licenseFile = existsSync('LICENSE') ? readFileSync('LICENSE', 'utf8').split(/\r?\n/, 1)[0].trim() : '';
  return {
    '<PROJECT_NAME>': name,
    '<SHORT_NAME>': name,
    '<AUTHOR>': sh('git config user.name') || null,
    '<REPO_URL>': sh('git remote get-url origin') || null,
    '<LOCAL_PATH>': process.cwd(),
    '<LICENSE>': (pkg && pkg.license) || licenseFile || null,
    '<BUILD_COMMAND>': pkg && pkg.scripts && pkg.scripts.build ? 'npm run build' : null,
    '<TEST_HARNESS>': pkg && pkg.scripts && pkg.scripts.test ? 'npm test' : null,
    '<COMMIT_COMMAND>': 'git add -A && git commit -m "<msg>" && git push',
    '<YOUR AGENT/MODEL>': null, // depends on the running agent — always the agent's to fill
    "<YOUR AGENT'S noreply EMAIL>": null, // same — the agent signs its own commits (bug 28)
    '<OWNER_LANGUAGE>': LANG,   // the language-policy note in AGENT_GUIDE (idea 12: two audiences, two languages)
  };
}

// Placeholder values are FROZEN at deploy time (bug 26 / field: <PROJECT_NAME> re-detected on
// every run drifted when package.json appeared later, and the drifted signature made the modular
// merge mangle the canon's H1). The deploy manifest carries the snapshot; every later pass builds
// on it and re-detects only what the deploy left unresolved.
const persistValues = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x));
function snapshotValues() {
  try { return okOnDisk(DEPLOY_MANIFEST) ? (readJson(DEPLOY_MANIFEST).values || {}) : {}; }
  catch { return {}; }
}
const stableValues = () => ({ ...detectValues(), ...snapshotValues() });

function fillPlaceholders(content, values, unresolved) {
  let out = content;
  for (const [ph, v] of Object.entries(values)) {
    if (!out.includes(ph)) continue;
    if (v) out = out.split(ph).join(v);
    else unresolved.add(ph);
  }
  return out;
}

// Anonymous install: strip marked author regions and de-expand the brand acronym —
// mechanically, so no cognitive "scrubbing" pass is needed (anonymity by design).
function anonymize(content) {
  let out = content.replace(/<!-- KAIF:AUTHOR-NOTE:BEGIN[\s\S]*?KAIF:AUTHOR-NOTE:END -->\n?/g, '');
  for (const exp of ACRONYM_EXPANSIONS) out = out.split(exp).join('KAIF');
  return out;
}

// ---------------------------------------------------------------------------- agent systems wiring
// Verified conventions (adapters catalog; Grok Build web-verified 2026-07-16):
//   claude-code: .claude/skills/<n>/SKILL.md (canonical layout) + CLAUDE.md context file
//   codex:       .agents/skills/<n>/SKILL.md (Agent Skills standard, copy as-is) + native AGENTS.md
//   grok-build:  .grok/skills/<n>/SKILL.md (SKILL.md standard; also auto-reads .claude/ + AGENTS.md)
//   cline:       .cline/skills/<n>/SKILL.md (≥3.48; also reads .claude/skills/) + .clinerules/kaif.md
//   zoo-code:    .roo/commands/<n>.md (drop `name:`; filename = command) + .roo/rules/kaif.md
const CONTEXT_POINTER =
  '# Agent rules\n\nThis project is KAIF-wrapped. Before every task read `AGENT_GUIDE.md` (the canon) and ' +
  '`STATUS.md` (current state); think per `PHILOSOPHY.md`; debug per `BUG_FIXING_FRAMEWORK.md`; execute ' +
  'tasks per the fable loop (`/fable-method`, `/fable-judge`).\n';

// Returns true when the template was actually written; false when an existing file was
// ADOPTED (kept as found). Adoption is provenance the deploy manifest must remember:
// for adopted paths the sha snapshot records the OWNER'S content, not a template — so a
// later `update` may never take "sha still matches" as permission to replace them
// (field-caught on ndim, 2026-07-17: 18 owner-adapted skills silently templated over).
function writeIfNew(path, content) {
  if (okOnDisk(path) && !FORCE) { log(`= kept existing ${path}`); return false; }
  mkdirSync(dirname(path) || '.', { recursive: true });
  writeFileSync(path, content);
  log(`+ wrote ${path}`);
  return true;
}

function deployAgentSystems(skillFiles, refFiles) {
  const copies = { codex: '.agents/skills', 'grok-build': '.grok/skills', cline: '.cline/skills' };
  for (const [sys, base] of Object.entries(copies)) {
    if (!AGENTS.includes(sys)) continue;
    for (const { path, content } of skillFiles) writeIfNew(`${base}/${skillName(path)}/SKILL.md`, content);
    // skill reference files (e.g. fable-method/references/*) travel with their skill
    for (const { path, content } of refFiles) writeIfNew(path.replace('.claude/skills', base), content);
  }
  if (AGENTS.includes('zoo-code')) {
    for (const { path, content } of skillFiles)
      writeIfNew(`.roo/commands/${skillName(path)}.md`, content.replace(/^name:[^\n]*\n/m, ''));
    writeIfNew('.roo/rules/kaif.md', '# KAIF\n\nRead `AGENT_GUIDE.md` before every task; keep `STATUS.md` current. ' +
      'Skills live in `.roo/commands/` (one `/command` per KAIF skill).\n');
  }
  if (AGENTS.includes('cline')) writeIfNew('.clinerules/kaif.md', CONTEXT_POINTER);
  if (AGENTS.includes('claude-code')) writeIfNew('CLAUDE.md', CONTEXT_POINTER);
  writeIfNew('AGENTS.md', CONTEXT_POINTER); // universal fallback, always
}

// Expected per-system artifact list for validation (mirrors deployAgentSystems).
function expectedAgentArtifacts(skillNames) {
  const want = ['AGENTS.md'];
  const per = { codex: (n) => `.agents/skills/${n}/SKILL.md`, 'grok-build': (n) => `.grok/skills/${n}/SKILL.md`,
                cline: (n) => `.cline/skills/${n}/SKILL.md`, 'zoo-code': (n) => `.roo/commands/${n}.md` };
  for (const sys of AGENTS) if (per[sys]) for (const n of skillNames) want.push(per[sys](n));
  if (AGENTS.includes('zoo-code')) want.push('.roo/rules/kaif.md');
  if (AGENTS.includes('cline')) want.push('.clinerules/kaif.md');
  if (AGENTS.includes('claude-code')) want.push('CLAUDE.md');
  return want;
}

// ---------------------------------------------------------------------------- adaptation task
// The ONE cognitive deliverable left to the AI agent. Every item ends in a forced
// checkpoint line (the fable-method lesson: weak models follow rules at decision
// points, not rules in lists) that verify-final greps for mechanically.
function writeAdaptationTask(unresolved, translated, meta) {
  const needTranslate = LANG !== 'en' && translated === 0;
  const items = [];
  items.push(['study', 'Study the project gradually and record findings (what it is, build/test commands, architecture) — this replaces the old KAIF_DEPLOYMENT_PLAN.md.']);
  if (unresolved.size) items.push(['placeholders', `Fill the remaining placeholders everywhere they occur (grep each): ${[...unresolved].join(' ')}`]);
  items.push(['maps', 'Fill PROJECT_STRUCTURE_EXTERNAL_MAP.md and PROJECT_ARCHITECTURE_INTERNAL_MAP.md from your inspection. Keep them SHORT; write in 2-3 small edits, not one giant write.']);
  items.push(['goal-plan', 'If GOAL.md is empty, seed it and ask the owner; derive MASTER_PLAN.md from GOAL.md (skill: /revision).']);
  items.push(['sphere', 'Pick the project\'s sphere (libraries ship in .kaif/spheres/; do NOT author a new document unless none fits) and record it by running `node .kaif/kaif-core.mjs sphere <name>` (e.g. `sphere programming`) — never edit .kaif/kaif.json by hand.']);
  if (needTranslate) items.push(['language', `Translate the owner-facing docs (GOAL.md, KAIF_FRAMEWORK.md, the directory READMEs) into "${LANG}" — no bundled template for this language yet. Keep agent-only docs in English.`]);
  items.push(['kaif-framework', 'Write KAIF_FRAMEWORK.md from its template: "KAIF, deployed here" + the deployment record (version, date, language, sphere, agents, mode).']);
  items.push(['verify', 'Run `node .kaif/kaif-core.mjs verify-final` — it checks these checkpoints and self-cleans the installer. Then commit `chore: deploy KAIF`.']);

  const lines = [
    '# KAIF adaptation task — the final (and only) cognitive step',
    '',
    '> Machinery has deployed everything mechanical. What remains is understanding — yours.',
    `> For each finished item: tick its checkbox AND append its checkpoint line at the bottom, verbatim.`,
    `> Then run \`node .kaif/kaif-core.mjs verify-final\` (it greps the checkpoints; missing = not done).`,
    '>',
    '> Working rules for THIS task (they exist because weak models break here): write files in SMALL',
    '> pieces (a short skeleton first, then extend) — never one giant write; in every file-writing tool',
    '> call, pass the file PATH as its own parameter (never glue "path:" into the content text); edit',
    '> only the files an item names. Do NOT edit THIS file at all — record each finished item by running',
    '> the command shown next to it; the machinery appends the checkpoint for you.',
    '',
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}\``),
    '',
    `Install parameters: version ${meta.version} · lang ${LANG} · mode ${MODE} · agents ${AGENTS.join(',')}`,
    '',
    '## Checkpoints (append below as you finish items)',
    '',
  ];
  writeFileSync(TASK_FILE, lines.join('\n'));
  log(`+ wrote ${TASK_FILE} (${items.length} items)`);
  return items.map(([id]) => id);
}

// The cognitive task after an UPDATE: only the genuinely diverged places + what's new.
// Same forced-checkpoint discipline as the adaptation task. Since plan 21 the heavy lifting is
// per-module: `opts.divergedModules` renders "your version → new template" diffs right in the
// task, so the agent merges MEANING, never reconstructs deltas by hand (the top field gap, П1).
// Version-interval news (plan 21 §3.4, field gap T2): a 1.2→2.0 jump prints the UNION of every
// release's notes in (from, to], newest last — single-release notes left long jumpers blind.
function newsInterval(meta, fromVersion) {
  const byVer = meta.templateNotesByVersion;
  if (!byVer) return (meta.templateNotes || []).map((n) => `- ${n}`).join('\n') || '- (no template notes shipped with this version)';
  const vnum = (v) => String(v || '0').split('.').map(Number);
  const gt = (a, b) => { const [a1, a2 = 0] = vnum(a), [b1, b2 = 0] = vnum(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };
  const vers = Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1));
  if (!vers.length) return '- (no template notes recorded for this interval)';
  return vers.map((v) => [`**${v}:**`, ...byVer[v].map((n) => `- ${n}`)].join('\n')).join('\n\n');
}

// The "assertion surface" scan (plan 21 §3.5, field gap П9 — Unliminium counted 12 documents
// still asserting the OLD version after a green update, 3 of them on the public storefront):
// any line that mentions KAIF together with the old version number and not the new one is a
// stale claim the machinery can FIND for the agent, even in files it does not own.
function scanStaleClaims(fromVersion, toVersion, templateShas = null) {
  if (!fromVersion || fromVersion === toVersion) return [];
  const hits = [];
  // Knowledge directories and EXPERIENCE/HISTORY are JOURNALS OF THE PAST by definition — a line
  // "we updated to <old>" cannot be "updated to <new>" without lying; half the field scan's hits
  // were exactly that (bug 23 / ndim K5), and a noisy guard teaches the agent to ignore it.
  const SKIP_DIRS = ['.git', 'node_modules', '.kaif', 'researches', 'interviews', 'homeworks', 'bugs', 'ideas'];
  const SKIP_FILES = [UPDATE_TASK, TASK_FILE, 'KAIF.md', 'KAIF-LOADER.mjs', 'EXPERIENCE.md', 'PROJECT_HISTORY.md'];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = (dir === '.' ? '' : dir + '/') + n;
      if (SKIP_DIRS.includes(n) || SKIP_FILES.includes(p)) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.md$/i.test(n)) continue;
      // The chronicle's era volumes (PROJECT_HISTORY_<era>.md, the split its template prescribes)
      // are journals of the past exactly like the main file — judge-caught before the first split.
      if (/^PROJECT_HISTORY/.test(p)) continue;
      // A file byte-identical to the CURRENT template cannot carry a stale PROJECT claim — its
      // text is upstream's own prose (bug 30: ten hits were fable-judge's "added in KAIF 1.6").
      if (templateShas && templateShas[p] && fileShaNorm(p) === templateShas[p]) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (p === 'STATUS.md' && /предыдущ|previous/i.test(lines[i])) continue;   // history, not a claim
        if (/kaif|каиф/i.test(lines[i]) && lines[i].includes(fromVersion) && !lines[i].includes(toVersion)) {
          hits.push(`${p}:${i + 1} — ${lines[i].trim().slice(0, 100)}`);
          if (hits.length >= 40) return hits;
        }
      }
    }
    return hits;
  };
  try { walk('.'); } catch { /* best-effort scan */ }
  return hits;
}

// Deprecations (plan 21 §3.5, field gap T10): a release may RETIRE artifacts that EARLIER
// releases deployed — the mechanism that replaced another mechanism owns the cleanup of its
// predecessor (KLAS: a 1.2-era validator survived four versions printing false greens).
// Untouched instances are removed mechanically; locally edited ones go to the task.
function handleDeprecations(meta, old) {
  const out = { removed: 0, items: [] };
  for (const d of meta.deprecations || []) {
    if (!d.path || !existsSync(d.path)) continue;
    const tpl = (old.templateShas || {})[d.path];
    if (tpl && fileShaNorm(d.path) === tpl) {
      unlinkSync(d.path);
      out.removed++;
      log(`- retired ${d.path} (${d.reason || 'deprecated upstream'})`);
    } else {
      out.items.push(`${d.path} — ${d.reason || 'deprecated upstream'} (carries local edits: remove it yourself, or keep it consciously)`);
    }
  }
  return out;
}

// Policy changes in the (from, to] interval (Reference §10.6): a rule change is OWNER territory
// and never merges silently as an ordinary diff (field: the 1.6 language-policy change dissolved
// into a diff and the owner learned about it on an audit).
function policyInterval(meta, fromVersion) {
  const byVer = meta.policyChanges;
  if (!byVer) return [];
  const vnum = (v) => String(v || '0').split('.').map(Number);
  const gt = (a, b) => { const [a1, a2 = 0] = vnum(a), [b1, b2 = 0] = vnum(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };
  const out = [];
  for (const v of Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1)))
    for (const p of byVer[v]) out.push(`[${v}] ${p}`);
  return out;
}

function writeUpdateTask(diverged, meta, contextLine, opts = {}) {
  const { divergedModules = {}, ownerConvention = [], fromVersion = null, deprecations = [], staleClaims = [], translatedWholesale = [], unresolved = [] } = opts;
  const policy = policyInterval(meta, fromVersion);
  const modFiles = Object.keys(divergedModules);
  const items = [];
  if (policy.length) items.push(['policy-changes', `⚠ This interval CHANGES RULES of your previous version — these are the OWNER'S decisions, never merge them silently; put each in front of the owner and record the choice:\n${policy.map((p) => `    · ${p}`).join('\n')}`]);
  if (modFiles.length) items.push(['merge-modules', `These MODULES need your merge — fold each diff below into your version (for ordinary files the rest was updated mechanically; for i18n-translated files NOTHING was applied — the diffs are the whole delivery): ${modFiles.map((p) => `${p} (${divergedModules[p].length})`).join(' · ')}`]);
  if (diverged.length) items.push(['merge-diverged', `These framework files carry LOCAL edits and were NOT overwritten — merge the new template's changes into each by hand (see the template news below): ${diverged.map((p) => translatedWholesale.includes(p) ? `${p} (translated wholesale — its headings are in the owner's language, a by-signature merge is impossible; fold the news in by hand)` : p).join(' · ')}`]);
  if (ownerConvention.length) items.push(['owner-conventions', `The TEMPLATES of these owner documents changed their conventions in this release — carry the convention over WITHOUT touching the owner's content: ${ownerConvention.join(' · ')}`]);
  if (deprecations.length) items.push(['deprecations', `Upstream RETIRED these artifacts, but your copies carry local edits so nothing was removed mechanically — remove each yourself or keep it consciously: ${deprecations.join(' · ')}`]);
  if (staleClaims.length) items.push(['stale-claims', `These lines still assert the OLD version (${fromVersion}) — update each or state why it is correct:\n${staleClaims.map((h) => `    · ${h}`).join('\n')}`]);
  // New templates may arrive carrying deploy-time slots the machinery cannot fill (bug 28: the
  // update used to learn about them only when the FINAL gate failed, after "I'm done").
  if (unresolved.length) items.push(['placeholders', `New templates carry deploy-time slots the machinery could not fill — fill each in the canonical .claude/skills/ copy (mirrors re-sync at update-verify): ${unresolved.join(' · ')}`]);
  items.push(['review-news', 'Read the template news below; apply anything relevant to files this update could not touch mechanically.']);
  items.push(['recheck', 'Run `node .kaif/kaif-core.mjs check` — the deployed manifest must be 100% green.']);
  items.push(['judge', 'Run a /fable-judge pass over this update (versions in .kaif/kaif.json, nothing owner-authored lost, the merges real), then run `node .kaif/kaif-core.mjs update-verify`.']);
  const news = newsInterval(meta, fromVersion);
  const diffSections = [];
  for (const p of modFiles) {
    diffSections.push(`### ${p}`, '');
    for (const d of divergedModules[p]) {
      diffSections.push(`**module:** \`${d.signature}\` — ${d.note}`, '', '```diff', d.diff, '```', '');
    }
  }
  writeFileSync(UPDATE_TASK, [
    `# KAIF update task — finish the update to ${meta.version}`,
    '',
    `> ${contextLine}.`,
    '> Do NOT edit this file. When an item is finished, record it by running the command shown next to',
    '> it — the machinery appends the checkpoint for you. Then run `node .kaif/kaif-core.mjs update-verify`.',
    '',
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict "<VERDICT: one line of evidence>"' : ''}\``),
    '',
    "## What's new in the templates",
    '',
    news,
    '',
    ...(diffSections.length ? ['## Module diffs (your version → the new template)', '', ...diffSections] : []),
    '## Checkpoints (append below as you finish items)',
    '',
  ].join('\n'));
  log(`+ wrote ${UPDATE_TASK} (${items.length} items${diverged.length ? `, ${diverged.length} diverged files` : ''}${modFiles.length ? `, ${modFiles.length} files with module diffs` : ''})`);
}

// Fetch one artifact for `update` (URL or local dir), mirroring the loader.
async function fetchArtifact(base, name) {
  if (!/^https?:\/\//.test(base)) {
    const p = join(base, name);
    if (!existsSync(p)) die(`not found in source: ${p}`);
    return readFileSync(p);
  }
  const res = await fetch(`${base}/${name}`, { redirect: 'follow' });
  if (!res.ok) die(`download failed (${res.status}) — ${base}/${name}`);
  return Buffer.from(await res.arrayBuffer());
}

// The soft variant for OPTIONAL artifacts (the synthetic baseline): absence is an answer,
// not a death — the caller falls back to the classic path.
async function fetchMaybe(base, name) {
  try {
    if (!/^https?:\/\//.test(base)) {
      const p = join(base, name);
      return existsSync(p) ? readFileSync(p) : null;
    }
    const res = await fetch(`${base}/${name}`, { redirect: 'follow' });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

// The synthetic baseline (plan 21 §5.5, field gap П7): a pre-2.0 deployment carries no content
// snapshots, but the OLD version's own release artifact IS one — fetch it, run it through the
// same transform pipeline (language, fill, anonymize), and the blind adopt-everything legacy
// path becomes an ordinary modular update. Field prototype: KLAS's kaif-baseline-diff.mjs.
// --baseline <dir|url> overrides the source (sandboxes; offline owners with a saved artifact).
async function buildSyntheticBaseline(legacyOld) {
  const ver = legacyOld && legacyOld.version;
  if (!ver) return null;
  const base = val('--baseline') || `${ORIGIN}/releases/download/v${ver}`;
  for (const name of ['KAIF-CORE-BUNDLE.md', 'KAIF-FULL.md', 'KAIF.md']) {
    const buf = await fetchMaybe(base, name);
    if (!buf) continue;
    mkdirSync('.kaif/install', { recursive: true });
    const tmp = '.kaif/install/BASELINE.md';
    writeFileSync(tmp, buf);
    const parsed = parseBundle(tmp, true);
    unlinkSync(tmp);
    if (!parsed || !parsed.files.length) continue;
    const { deploy } = applyLanguage(parsed.files);
    const values = stableValues();   // frozen deploy values (bug 26) — the baseline must cut like the deploy did
    const un = new Set();
    const templateShas = {};
    const moduleShas = {};
    for (const f of deploy) {
      if (isSkippedAnon(f.path)) continue;
      let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, un);
      if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
      templateShas[f.path] = normSha(content);
      if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(content), (parsed.meta || {}).moduleClasses);
    }
    log(`⟳ synthetic baseline: v${ver}'s own ${name} (${Object.keys(templateShas).length} templates) — the legacy path is no longer blind`);
    return { shas: {}, templateShas, moduleShas, kept: [], synthetic: true };
  }
  log(`⟳ no baseline artifact reachable for v${ver} (${base}) — classic adopt-everything legacy path`);
  return null;
}

// The modular merge (plan 21 §3.3) — the owner's metaphor made mechanical: a module whose disk
// text still equals what THIS deployment's template shipped is swapped for the new template's
// module; a module the owner/agent edited is kept and handed over WITH a diff; modules the owner
// ADDED to a framework file survive in place (reconstruction starts from the DISK order, so
// custom insertions keep their position). Returns null when the disk file cannot be cut cleanly.
// [TESTED: 2026-07-31 · polygon s02 S5-S8 + s07 T1/T2/T6: localized module survives TWO update
// cycles while its file's upstream modules merge mechanically; conflict module → diff in the
// task; upstream-untouched divergence makes no noise; a translated-wholesale file is kept intact
// (no doubling); dryRun analyzes without writes; owner-added sections never trip the net]
function mergeModules(path, newContent, oldMods, dryRun = false) {
  const disk = normEol(readFileSync(path, 'utf8'));
  const diskMods = splitModules(disk);
  if (joinModules(diskMods) !== disk) return null;                      // pathological file — file-level fallback
  // Duplicate signatures on DISK (the owner wrote a second identically-titled heading) would
  // silently collapse in the by-signature maps below and misclassify both copies — such a file
  // gets the safe file-level treatment instead (review-caught).
  const dupCheck = (mods) => { const s = mods.map((m) => m.signature); return new Set(s).size !== s.length; };
  const newMods = splitModules(newContent.replace(/\s+$/, '\n'));
  if (dupCheck(diskMods) || dupCheck(newMods)) return null;
  const newBySig = new Map(newMods.map((m) => [m.signature, m]));
  const oldBySig = new Map(oldMods.map((e) => [e.signature, e]));
  // Translated-wholesale net (bug 20 / ndim K1): a file whose HEADINGS were translated matches
  // (almost) no baseline signature, so a by-signature merge would read it as "all owner-added"
  // and DOUBLE the document with the English template (field: 25 files, +6534 lines). If the
  // baseline's signatures are (all but one) gone from disk AND the disk body carries the owner's
  // script while the template body does not — this is a translation, not additions: hands off.
  // Bodies exclude <preamble> on purpose: machinery-appended trigger aliases put the owner's
  // script into every skill's frontmatter and would blind the test.
  const nonPre = (list) => list.filter((x) => x.signature !== '<preamble>');
  const script = SCRIPTS[LANG];
  const bodyOf = (mods) => nonPre(mods).map(modText).join('\n');
  const baseFound = nonPre(oldMods).filter((e) => diskMods.some((d) => d.signature === e.signature)).length;
  // On a TINY base (directory READMEs cut into 1 module) "≤1 matched" degenerates: an intact base
  // heading plus one owner-added section in the owner's script would read as a translation and
  // freeze the file with a lying task note (judge finding F1, s07/T6) — small bases demand that
  // NO base signature survives before the net may fire.
  const wholesaleCeiling = nonPre(oldMods).length <= 2 ? 0 : 1;
  if (nonPre(oldMods).length && baseFound <= wholesaleCeiling && script && script.test(bodyOf(diskMods)) && !script.test(bodyOf(newMods)))
    return { translatedWholesale: true };
  let replaced = 0;
  const divergedList = [];
  const out = [];
  for (const dm of diskMods) {
    const dSha = normSha(modText(dm));
    const oldE = oldBySig.get(dm.signature);
    const newM = newBySig.get(dm.signature);
    if (oldE && dSha === oldE.sha256) {
      // untouched since deploy — upstream's to move (in dryRun nothing moves: the change ships
      // as a diff instead — bug 20/K2, the "don't replace" and "don't analyze" split)
      if (!newM) {
        if (dryRun) { out.push(dm); divergedList.push({ signature: dm.signature, note: 'upstream REMOVED this module (not applied — i18n: translated)', diff: lineDiff(modText(dm), '') }); }
        else if (/^# /.test(dm.signature)) {
          // A release never removes the document's H1 — its "absence" in the template means the
          // SIGNATURE drifted (placeholder values changed between deploys, bug 26). Keep it.
          out.push(dm);
          divergedList.push({ signature: dm.signature, note: 'the document H1 is absent from the incoming template — treated as placeholder-signature drift, kept (bug 26)', diff: '' });
        }
        else replaced++;
        continue;
      }
      const newText = modText(newM);
      if (dSha === normSha(newText)) { out.push(dm); }                  // unchanged upstream too
      else if (localizedAgainst(modText(dm), newText)) {                // safety net (decision #17)
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'localized on disk — not replaced', diff: lineDiff(modText(dm), newText) });
      } else if (dryRun) {
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'upstream updated this module (not applied — i18n: translated)', diff: lineDiff(modText(dm), newText) });
      } else { out.push({ signature: dm.signature, lines: newText.split('\n') }); replaced++; }
    } else {
      // owner/agent-edited, or a module the deploy never shipped (owner-added section) — keep.
      // A diff lands in the task ONLY when upstream ACTUALLY changed this module (KPOT F2:
      // "diverged but upstream untouched" is zero work and must not make noise).
      out.push(dm);
      if (oldE && newM && normSha(modText(newM)) !== oldE.sha256)
        divergedList.push({ signature: dm.signature, note: 'carries local edits AND upstream changed it', diff: lineDiff(modText(dm), modText(newM)) });
      else if (oldE && !newM)
        divergedList.push({ signature: dm.signature, note: 'upstream REMOVED this module; your edited version kept', diff: lineDiff(modText(dm), '') });
    }
  }
  // modules NEW in this release (absent on disk): insert by template order — right after the
  // nearest preceding template sibling that exists in the reconstruction, else append.
  // In dryRun they are REPORTED, never inserted (a translated file must not grow English text).
  for (let i = 0; i < newMods.length; i++) {
    const nm = newMods[i];
    if (diskMods.some((d) => d.signature === nm.signature)) continue;
    if (dryRun) { divergedList.push({ signature: nm.signature, note: 'NEW module in this release (not inserted — i18n: translated)', diff: lineDiff('', modText(nm)) }); continue; }
    // An H1 module is never INSERTED into a document that already carries one: a "new" H1 is a
    // drifted placeholder signature, and inserting it appends a duplicate header to the end of
    // the canon (bug 26, field: AGENT_GUIDE grew a second title under another project name).
    if (/^# /.test(nm.signature) && out.some((o) => /^# /.test(o.signature))) {
      divergedList.push({ signature: nm.signature, note: 'an H1 module may not be inserted next to an existing H1 — placeholder-signature drift, reconcile by hand (bug 26)', diff: lineDiff('', modText(nm)) });
      continue;
    }
    let at = out.length;
    for (let k = i - 1; k >= 0; k--) {
      const pos = out.findIndex((o) => o.signature === newMods[k].signature);
      if (pos >= 0) { at = pos + 1; break; }
    }
    out.splice(at, 0, { signature: nm.signature, lines: modText(nm).split('\n') });
    replaced++;
  }
  const merged = joinModules(out);
  return { merged, changed: !dryRun && merged !== disk, replaced, divergedList };
}

// ONE classification for every road new templates arrive by — core update AND the legacy/
// anonymous bootstrap (plan 21 §5.5; bugs 13/14: those routes used to keep everything and dump
// the whole delta on the agent as cognitive work). Mutates f.content to the filled/anonymized
// text (derived surfaces inherit it — bug 05) and APPLIES the mechanical moves; returns the
// counters and the cognitive leftovers for the task writer.
// [TESTED: 2026-07-28 · extraction verified by re-running suites S5–S12c unchanged-green]
function classifyAndApply(deploy, old, values, unresolved, cur) {
  const oldShas = old.shas || {};
  const oldTplShas = old.templateShas || {};          // v2: what the previous deploy's TEMPLATES were
  const oldModShas = old.moduleShas || {};            // v2: their per-module cut
  // Provenance gate: paths the previous deploy ADOPTED (kept as found, never written from a
  // template) are not replace-eligible even when the disk sha still matches the snapshot —
  // for them the snapshot IS the owner's content.
  const adoptedBefore = new Set(old.kept || []);
  const diverged = [];
  const divergedModules = {};                        // path → [{signature, note, diff}]
  const ownerConvention = [];                        // owner docs whose TEMPLATE changed shape
  const adopted = [];
  // i18n intent (decision #17, re-cut by bug 20/K2): a project that declared `"i18n": "translated"`
  // translated its wrapper — but the flag protects PER FILE, and only files that actually carry
  // the owner's script where the template does not (machinery-appended skill aliases are not a
  // translation). Protected files are never written; upstream changes ship as per-module diffs
  // (a dry-run merge). Pure-English files keep their mechanical updates — the old all-or-nothing
  // flag silently froze 21 untouched files forever (ndim field report).
  const i18nTranslated = String((cur || {}).i18n || '').toLowerCase() === 'translated';
  if (i18nTranslated) log('⟳ marker declares i18n: translated — mechanical replacement disabled for files carrying the owner\'s script; upstream changes ship as per-module diffs');
  const translatedWholesale = [];
  let replaced = 0, added = 0, kept = 0, mergedModules = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
    if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
    f.content = content; // derived surfaces (system skill copies) must inherit the filled text (bug 05)
    if (OWNER_SEEDED.includes(f.path)) {
      // A MISSING owner doc is seeded from the template (a 1.2-era tree predates EXPERIENCE.md —
      // the classified legacy path must seed it exactly like a fresh install would; sandbox-caught).
      if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; continue; }
      kept++;                                                            // owner's — never in scope
      // …but the TEMPLATE may have changed a CONVENTION (field: EXPERIENCE gained Repro:/Not for:
      // and no project could learn it) — surface the fact, touch nothing.
      if (oldTplShas[f.path] && oldTplShas[f.path] !== normSha(content)) ownerConvention.push(f.path);
      continue;
    }
    if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; continue; }
    // Authority to replace comes ONLY from matching the previous TEMPLATE (bug 12): the template
    // sha never mutates with the disk, so "restored by hand at update N" can no longer read as
    // "untouched" at update N+1. v1 manifests (no templateShas) keep the old byte-sha + kept-guard.
    const untouched = oldTplShas[f.path]
      ? fileShaNorm(f.path) === oldTplShas[f.path]
      : (!adoptedBefore.has(f.path) && oldShas[f.path] && fileSha(f.path) === oldShas[f.path]);
    // The flag freezes only files that ARE a translation: owner's script on disk, none in the
    // incoming template (bug 20/K2 — aliases in frontmatter make every skill Cyrillic, so the
    // judgment is localizedAgainst the NEW content, not bare script presence).
    const fileTranslated = i18nTranslated && f.path.endsWith('.md')
      && localizedAgainst(normEol(readFileSync(f.path, 'utf8')), content);
    if (untouched && !fileTranslated) {
      if (fileShaNorm(f.path) === normSha(content)) { kept++; continue; } // upstream didn't change it either
      writeFileSync(f.path, content); log(`↻ replaced ${f.path}`); replaced++; continue;
    }
    // Diverged file → the MODULAR merge when the previous deploy left a module cut (v2, md only):
    // untouched modules move mechanically, edited ones are kept and handed over with diffs.
    // A translated file goes through the SAME merge in dry-run: analysis without writes (K2).
    if (f.path.endsWith('.md') && oldModShas[f.path]) {
      const res = mergeModules(f.path, content, oldModShas[f.path], fileTranslated);
      if (res && res.translatedWholesale) {
        // headings translated — merging would double the document (bug 20/K1); hands off, task item
        diverged.push(f.path); translatedWholesale.push(f.path); kept++; adopted.push(f.path);
        log(`⟳ ${f.path} is translated wholesale (its headings are in the owner's script) — kept intact; fold the template news in by hand`);
        continue;
      }
      if (res) {
        if (fileTranslated) {
          if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; }
          kept++; adopted.push(f.path);
          continue;
        }
        if (res.changed) { writeFileSync(f.path, res.merged); mergedModules += res.replaced;
          log(`↻ merged ${res.replaced} module(s) into ${f.path}${res.divergedList.length ? ` (${res.divergedList.length} kept for you)` : ''}`); }
        if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; kept++; adopted.push(f.path); }
        continue;
      }
    }
    diverged.push(f.path); kept++; adopted.push(f.path);
    if (f.path.endsWith('.md') && localizedAgainst(readFileSync(f.path, 'utf8'), content))
      log(`⟳ ${f.path} is localized on disk — kept (no silent English takeover)`);
  }
  return { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale };
}

// ---------------------------------------------------------------------------- update (idea 14 / plan 15)
// Mechanical respectful update: untouched framework files are replaced with the new
// templates; diverged ones are kept and handed to the agent; owner content is never
// in scope at all. Requires the deploy manifest with `shas` (installs since 1.5).
async function cmdUpdate() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const cur = readJson(KAIF_JSON);
  if (cur.tracking === 'anonymous') die('anonymous install tracks no origin — update by dropping a fresh thin KAIF.md and re-running the bootstrap (the surviving deploy manifest makes that pass mechanical since 2.0)');
  if (!val('--lang') && cur.language) LANG = String(cur.language).toLowerCase();
  if (!val('--agents') && Array.isArray(cur.agents) && cur.agents.length) AGENTS = cur.agents;
  const base = val('--source') || SOURCES[(val('--channel') || 'release').toLowerCase()] || SOURCES.release;
  log(`update: checking ${base}`);
  const man = JSON.parse((await fetchArtifact(base, 'kaif-manifest.json')).toString('utf8'));
  if (man.version === cur.version) { log(`✅ already up to date (KAIF ${cur.version})`); return; }
  // Fail-closed on an unfinished previous update (bug 25, judge two-hop repro: clobbering the
  // task silently discarded un-merged module diffs of a translated file — forever, without a
  // trace). The task is the delivery; it must be consumed or discarded CONSCIOUSLY.
  if (okOnDisk(UPDATE_TASK)) die(`${UPDATE_TASK} exists — the previous update was never verified, and its module diffs may be unmerged. Finish it (work the items, then \`node .kaif/kaif-core.mjs update-verify\`), or delete the file consciously to discard its guidance, then re-run update.`);
  log(`update: ${cur.version} → ${man.version}`);

  // fetch + verify the machinery pair (ignore-first BEFORE anything lands in the tree)
  ensureIgnoreFirst();
  mkdirSync('.kaif/install', { recursive: true });
  const bufs = {};
  for (const name of ['KAIF-CORE.mjs', 'KAIF-CORE-BUNDLE.md']) {
    bufs[name] = await fetchArtifact(base, name);
    const got = sha256(bufs[name]);
    if (got !== man.sha256[name]) die(`sha256 mismatch for ${name}: expected ${man.sha256[name]}, got ${got}`);
  }
  const bundlePath = '.kaif/install/KAIF-CORE-BUNDLE.md';
  writeFileSync(bundlePath, bufs['KAIF-CORE-BUNDLE.md']);

  // classify against the install-time snapshots — ONE shared classification, whatever road the
  // new templates arrived by (plan 21 §5.5)
  const old = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : { paths: [], agents: [], shas: {} };
  const { files, meta } = parseBundle(bundlePath);
  const { deploy } = applyLanguage(files);           // LANG defaults handled below
  const values = stableValues();                     // frozen deploy values win over re-detection (bug 26)
  const unresolved = new Set();
  // Before/after file sizes: the honest way to SEE a K1-class mangling instantly (field ask —
  // "the doubling is visible in a size summary at once, and invisible in 43 merged-lines").
  const sizeBefore = {};
  for (const f of deploy) if (okOnDisk(f.path)) sizeBefore[f.path] = statSync(f.path).size;
  const { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale } =
    classifyAndApply(deploy, old, values, unresolved, cur);
  const sizeJumps = deploy
    .filter((f) => sizeBefore[f.path] && okOnDisk(f.path))
    .map((f) => ({ path: f.path, before: sizeBefore[f.path], after: statSync(f.path).size }))
    .filter((s) => s.after > s.before * 1.5 && s.after - s.before > 400)
    .sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 5);
  for (const s of sizeJumps) log(`⚠ size jump: ${s.path} ${s.before} → ${s.after} bytes — eyeball it (a mangled merge is visible here first)`);
  // agent-system artifacts: same classification via the copies' snapshots
  const skillFiles = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path));
  const refFiles = deploy.filter((f) => /^\.claude\/skills\/[^/]+\/references\//.test(f.path));
  deployAgentSystems(skillFiles, refFiles); // writeIfNew semantics: new appear; existing kept (their canonical .claude source got classified above)

  // swap the core itself + refresh manifests (same shape and guarantees as install's:
  // sha snapshots + adoption provenance in `kept` + the pristine marker snapshot that
  // backs the final self-heal).
  // An honest log line: "replaced" on byte-identical machinery sent a field agent hunting a
  // phantom swap failure (bug 10 facet, KPOT) — when the shas match, say so instead.
  if (okOnDisk('.kaif/kaif-core.mjs') && fileSha('.kaif/kaif-core.mjs') === sha256(bufs['KAIF-CORE.mjs'])) {
    log('= .kaif/kaif-core.mjs unchanged in this release');
  } else {
    writeFileSync('.kaif/kaif-core.mjs', bufs['KAIF-CORE.mjs']);
    log('↻ replaced .kaif/kaif-core.mjs (the machinery itself)');
  }
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  const templateShas = {};
  const moduleShas = {};
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
  }
  const marker = { ...cur, version: man.version, released: man.released };
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, kept: adopted,
    values: persistValues(values), marker }, null, 2) + '\n');

  const dep = handleDeprecations(meta, old);
  const staleClaims = scanStaleClaims(cur.version, man.version, templateShas);
  // The task lists only slots that are LITERALLY on disk after the pass (judge finding: the raw
  // `unresolved` set collects every null-valued slot seen in incoming templates — on a fully
  // filled deployment that would put a phantom `placeholders` item into EVERY update task, and
  // a noisy guard teaches the agent to ignore it).
  const liveUnresolved = [...unresolved].filter((ph) =>
    deploy.some((f) => f.path.endsWith('.md') && okOnDisk(f.path) && readFileSync(f.path, 'utf8').includes(ph)));
  const nModDiverged = Object.values(divergedModules).reduce((a, l) => a + l.length, 0);
  // The honest size of the work (field ask: the log said "161 modules merged", the task said
  // "2 await you" — the real answer to "how much do I read" is "the framework changed N of M").
  const oldTpl = old.templateShas || {};
  const changedCnt = Object.keys(oldTpl).length
    ? deploy.filter((f) => !isSkippedAnon(f.path) && (!oldTpl[f.path] || oldTpl[f.path] !== normSha(f.content))).length : null;
  writeUpdateTask(diverged, { ...meta, version: man.version },
    `${changedCnt !== null ? `the framework changed ${changedCnt} of ${deploy.length} shipped files in this interval; ` : ''}mechanical pass done: ${replaced} files replaced, ${mergedModules} modules merged in-place, ${added} added, ${kept} kept (owner/diverged${nModDiverged ? `; ${nModDiverged} modules await your merge — diffs below` : ''})${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}. Sanity-check with git diff: replaced content must carry NO owner edits`,
    { divergedModules, ownerConvention, fromVersion: cur.version, deprecations: dep.items, staleClaims, translatedWholesale, unresolved: liveUnresolved });

  // The permanent receipt (plan 21 §3.4; field: "update-verify passed" was unfalsifiable a day
  // later — Unliminium §4). Survives self-clean; update-verify stamps it when the gates pass.
  writeReceipt({ from: cur.version, to: man.version, route: 'core-update',
    source: base,   // where THIS update came from — the previous delta stays recomputable (field ask №3)
    counters: { replaced, mergedModules, added, kept },
    diverged, divergedModules: Object.fromEntries(Object.entries(divergedModules).map(([p, l]) => [p, l.map((d) => d.signature)])),
    ownerConvention });
  appendHistory(marker, cur.version, man.version, 'core-update');
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  log(`\n✅ KAIF updated mechanically to ${man.version} — finish ${UPDATE_TASK}, then: node .kaif/kaif-core.mjs update-verify`);
}

const LAST_UPDATE = '.kaif/last-update.json';
function writeReceipt(r) {
  const receipt = { ...r, date: new Date().toISOString().slice(0, 10) };
  writeFileSync(LAST_UPDATE, JSON.stringify(receipt, null, 2) + '\n');
  log(`+ wrote ${LAST_UPDATE} (the update receipt — proof that outlives the self-clean)`);
}
// The marker keeps a compact update history (field ask T9): where the deployment came from and
// by which route — /kaif-version gets real memory, forensics gets a machine-readable trail.
function appendHistory(marker, from, to, route) {
  marker.history = [...(marker.history || []), { from: from || '?', to, route, date: new Date().toISOString().slice(0, 10) }];
}

// ---------------------------------------------------------------------------- final gates
// The closing guarantees are a property of the DEPLOYED TREE, not of the road taken to it:
// install's verify-final and update's update-verify run the SAME gate sequence (field-caught
// on ndim, 2026-07-17 — the update path used to skip these, so owner-side merges made between
// the mechanical pass and the final check never reached the per-system skill copies).

// placeholder scan on the canon + skills across EVERY deployed surface (GOAL/maps may
// legitimately hold template slots for the owner). Scanning only .claude/ let literal
// <BUILD_COMMAND> live in the .agents/.grok/.cline/.roo copies and .kaif/spheres/ for a
// whole release while the gate stayed green (bug 11, three field reports).
function scanPlaceholders() {
  let issues = 0;
  const scan = new Set(['AGENT_GUIDE.md']);
  for (const base of ['.claude/skills', '.agents/skills', '.grok/skills', '.cline/skills'])
    if (existsSync(base)) for (const n of readdirSync(base)) { const p = `${base}/${n}/SKILL.md`; if (existsSync(p)) scan.add(p); }
  if (existsSync('.roo/commands')) for (const n of readdirSync('.roo/commands').filter((f) => f.endsWith('.md'))) scan.add(`.roo/commands/${n}`);
  if (existsSync('.kaif/spheres')) for (const n of readdirSync('.kaif/spheres').filter((f) => f.endsWith('.md'))) scan.add(`.kaif/spheres/${n}`);
  for (const p of scan) {
    const t = readFileSync(p, 'utf8');
    for (const ph of PLACEHOLDERS) if (t.includes(ph)) { console.error(`✖ placeholder ${ph} still in ${p}`); issues++; }
  }
  return issues;
}

// The declared sphere must EXIST as a library: fable-method calls the sphere's minimum
// evidence set binding, yet a marker could point into the void with every gate green
// (bug 11, Unliminium: sphere "game-design" with no .kaif/spheres/game-design.md).
// A loud warning, not a failure: legitimate mid-adaptation states pass through here.
// [TESTED: 2026-07-27 · sandbox S2: `sphere game-design` without a library → check exit 0 + the warning]
function warnSphereLibrary() {
  if (!okOnDisk(KAIF_JSON)) return;
  try {
    const s = readJson(KAIF_JSON).sphere;
    if (s && s !== 'TODO' && !okOnDisk(`.kaif/spheres/${s}.md`))
      console.error(`⚠ sphere "${s}" has no library at .kaif/spheres/${s}.md — author it from .kaif/spheres/_template.md (binding for /fable-method and /fable-judge)`);
  } catch { /* marker unreadable — the check gate flags that separately */ }
}

// anonymous deployments: grep for author identity BEFORE cleanup. Two bug-13 lessons baked in:
// (1) scan ONLY the paths the machinery deployed (manifest paths+agents) — a whole-tree walk
//     once flagged the owner's name in his own JIRA dumps 44 times and froze the update;
// (2) exclude token clusters matching the PROJECT OWNER's identity (git user.name — the same
//     value the machinery itself substitutes for <AUTHOR>): the owner's name is not a leak,
//     and the author deploying his own framework is the guaranteed collision case.
function anonLeakScan() {
  const ownerId = sh('git config user.name').toLowerCase();
  const active = [];
  const excluded = [];
  for (const cluster of AUTHOR_TOKEN_CLUSTERS) {
    if (ownerId && cluster.some((t) => ownerId.includes(t.toLowerCase()))) excluded.push(...cluster);
    else active.push(...cluster);
  }
  if (excluded.length) log(`⟳ owner-identity tokens excluded from the anonymity scan: ${excluded.join(', ')} (the owner's own name is not a leak)`);
  const leaks = [];
  const scanFile = (p) => {
    if (!okOnDisk(p) || !/\.(md|json|txt|mjs|js)$/i.test(p)) return;
    const t = readFileSync(p, 'utf8');
    for (const tok of active) if (t.includes(tok)) { leaks.push(`${p} → "${tok}"`); break; }
  };
  let manifestPaths = null;
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try { const m = readJson(DEPLOY_MANIFEST); manifestPaths = [...(m.paths || []), ...(m.agents || [])]; } catch { /* fall back to the walk */ }
  }
  if (manifestPaths) { for (const p of manifestPaths) scanFile(p); }
  else {
    // no manifest to scope the scan — the conservative whole-tree walk, transients excluded
    const TRANSIENT = ['KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK, '.kaif/install', '.kaif/kaif-core.mjs', DEPLOY_MANIFEST];
    const walk = (dir) => {
      for (const n of readdirSync(dir)) {
        const p = (dir === '.' ? '' : dir + '/') + n;
        if (['.git', 'node_modules'].includes(n) || TRANSIENT.some((t) => p === t || p.startsWith(t + '/'))) continue;
        if (statSync(p).isDirectory()) { walk(p); continue; }
        scanFile(p);
      }
    };
    walk('.');
  }
  for (const l of leaks) console.error(`✖ anonymity leak: ${l}`);
  if (leaks.length) console.error('  (if a flagged name belongs to the PROJECT OWNER, it is not a leak — set `git config user.name` to the owner\'s name so the scan can excuse it, or adjust the text with the owner)');
  return leaks.length;
}

// Self-heal the deploy marker: a weak model may have rewritten .kaif/kaif.json losing
// fields (field-caught, ДЗ-02 run 5). Merge the pristine snapshot with whatever is there
// now — current values win where present, lost fields come back.
function healMarker() {
  if (!okOnDisk(DEPLOY_MANIFEST) || !okOnDisk(KAIF_JSON)) return;
  try {
    const snap = readJson(DEPLOY_MANIFEST).marker;
    if (!snap) return;
    const cur = readJson(KAIF_JSON);
    const healed = { ...snap, ...cur };
    if (JSON.stringify(healed) !== JSON.stringify(cur)) {
      writeFileSync(KAIF_JSON, JSON.stringify(healed, null, 2) + '\n');
      log('↻ self-healed .kaif/kaif.json (restored fields lost to a rewrite)');
    }
  } catch { /* marker unreadable — leave for the check to flag */ }
}

// Re-sync the per-system skill copies from the canonical .claude/skills/ — cognitive work
// (adaptation fills, update merges, owner customizations) lands in the canon only; machinery
// propagates it so no copy is ever edited by hand (bug 05 and its empty-project tail).
function resyncCopies() {
  if (!existsSync('.claude/skills')) return;
  const agents = okOnDisk(KAIF_JSON) ? (readJson(KAIF_JSON).agents || []) : [];
  const canon = [];
  for (const n of readdirSync('.claude/skills')) {
    // On an anonymous deployment the origin-tied skills were deliberately skipped — the
    // re-sync must not smuggle them back into the mirrors (bug 13 facet, QA field report).
    if (ANON && ORIGIN_TIED.includes(n)) continue;
    const p = `.claude/skills/${n}/SKILL.md`;
    if (okOnDisk(p)) canon.push({ path: p, content: readFileSync(p, 'utf8') });
    const rd = `.claude/skills/${n}/references`;
    if (existsSync(rd)) for (const r of readdirSync(rd).filter((f) => f.endsWith('.md')))
      canon.push({ path: `${rd}/${r}`, content: readFileSync(`${rd}/${r}`, 'utf8') });
  }
  const copies = { codex: '.agents/skills', 'grok-build': '.grok/skills', cline: '.cline/skills' };
  let synced = 0;
  for (const [sys, base] of Object.entries(copies)) {
    if (!agents.includes(sys)) continue;
    for (const f of canon) { writeFileSync(f.path.replace('.claude/skills', base), f.content); synced++; }
  }
  if (agents.includes('zoo-code')) for (const f of canon) {
    const n = skillName(f.path);
    if (n) { writeFileSync(`.roo/commands/${n}.md`, f.content.replace(/^name:[^\n]*\n/m, '')); synced++; }
  }
  if (synced) log(`↻ re-synced ${synced} system skill copies from the canon`);
}

// self-clean: the deployment step is done; the project is driven by the skills from here on.
function selfCleanArtifacts(taskFile, anonDeploy) {
  for (const p of [taskFile, 'KAIF.md', 'KAIF-LOADER.mjs']) if (existsSync(p)) { unlinkSync(p); log(`- removed ${p}`); }
  if (existsSync('.kaif/install')) { rmSync('.kaif/install', { recursive: true, force: true }); log('- removed .kaif/install/'); }
  if (anonDeploy) {
    // Anonymity contradicts two CONSTANTS, not the file (bug 29, third 2.0 field report: deleting
    // the core also deleted check/sync/diff/adopt-current — exactly what 2.0 added — and the field
    // audited 96 mirror copies with a hand-rolled script). Same doctrine as the manifest ("carries
    // no origin at all … SURVIVES", plan 21 §5.5): keep an ANONYMIZED core — the origin URL and
    // the owner's account token are stripped; origin-dependent commands degrade gracefully
    // (`update` already refuses on an anonymous marker before touching the network).
    const CORE = '.kaif/kaif-core.mjs';
    if (existsSync(CORE)) {
      try {
        // Strip longest strings first (expansions contain the bare tokens); placeholders are
        // NON-token literals so the stripped text can never re-trip a leak grep (judge F4).
        // Idempotent by construction: a second pass finds none of the originals.
        const owner = (ORIGIN.match(/github\.com\/([^/]+)/) || [])[1];
        let src = readFileSync(CORE, 'utf8').split(ORIGIN).join('<origin-removed>');
        if (owner) src = src.split(owner).join('<owner-removed>');
        for (const exp of ACRONYM_EXPANSIONS) src = src.split(exp).join('KAIF');
        for (const cluster of AUTHOR_TOKEN_CLUSTERS) for (const t of cluster) src = src.split(t).join('<removed>');
        writeFileSync(CORE, src);
        // process.execPath, not a PATH lookup (judge F5 — same rule the recheck checkpoint follows)
        execFileSync(process.execPath, ['--check', CORE], { stdio: 'ignore' });
        log(`↻ kept an anonymized ${CORE} (origin, account and author tokens stripped) — check/sync/diff/adopt-current/checkpoint stay available`);
      } catch {
        unlinkSync(CORE);
        log(`- removed ${CORE} (anonymization failed the syntax check — fell back to removal)`);
      }
    }
  }
}

// Shared closing sequence: checkpoint grep on the live task file, then the gates, in order.
function runFinalGates(taskFile, tag, verb) {
  if (!okOnDisk(taskFile)) die(`${taskFile} not found — nothing to verify (or already cleaned)`);
  // EOL-normalized read (bug 24): a CRLF-resaved task (Windows editor) breaks `$`-anchored
  // checkpoint regexes — JS `$` in multiline mode matches before \n but never before \r, so
  // every recorded checkpoint would read as "missing" and the gate would lie red.
  const task = normEol(readFileSync(taskFile, 'utf8'));
  let missing = 0;
  // Anchored to the COMMAND form: a bare /checkpoint (\w+)/ scan once matched the word "for"
  // inside the task's own prose ("appends the checkpoint for you") and demanded a bogus tick
  // (sandbox-caught the day it was written).
  for (const id of [...new Set([...task.matchAll(/kaif-core\.mjs checkpoint ([a-z-]+)/g)].map((m) => m[1]))])
    if (!new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) { console.error(`✖ checkpoint missing: ${tag}: ${id} done  (record it: node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict "<VERDICT: one line of evidence>"' : ''})`); missing++; }
  // The judge tick must carry its verdict (bug 17: four free ticks used to pass the gate).
  if (task.includes('checkpoint judge') && new RegExp(`^${tag}: judge done$`, 'm').test(task) &&
      !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
    console.error(`✖ judge checkpoint has no verdict line — record it: node .kaif/kaif-core.mjs checkpoint judge --verdict "<verdict + proof>"`);
    missing++;
  }
  // Substance check (bug 17 / field report 08's 209-line method): every '+' line the update task
  // promised in its module diffs should exist on disk once the agent merged. A WARNING list, not
  // a failure — translated wrappers legitimately merge meanings, not bytes.
  const i18nTranslated = okOnDisk(KAIF_JSON) && (() => { try { return String(readJson(KAIF_JSON).i18n || '').toLowerCase() === 'translated'; } catch { return false; } })();
  if (!i18nTranslated && task.includes('## Module diffs')) {
    let curFile = null, inDiff = false, unmergedLines = 0, skipSection = false;
    const perFile = new Map();
    for (const line of task.split('\n')) {
      const h = line.match(/^### (.+)$/);
      if (h) { curFile = h[1].trim(); continue; }
      // A module the safety net kept localized is EXPECTED to lack the English '+' lines —
      // demanding them would spam warnings at a correctly-behaving localized deployment.
      if (line.startsWith('**module:**')) { skipSection = line.includes('localized on disk'); continue; }
      if (line.startsWith('```')) { inDiff = line === '```diff'; continue; }
      if (skipSection) continue;
      if (inDiff && curFile && line.startsWith('+ ') && line.length > 12 && okOnDisk(curFile)) {
        if (!perFile.has(curFile)) perFile.set(curFile, readFileSync(curFile, 'utf8'));
        if (!perFile.get(curFile).includes(line.slice(2))) {
          console.error(`⚠ promised upstream line not found on disk (unmerged?): ${curFile} :: ${line.slice(2, 80)}`);
          unmergedLines++;
        }
      }
    }
    if (unmergedLines) console.error(`⚠ ${unmergedLines} upstream line(s) from the module diffs are absent on disk — merge them or state why in the judge verdict`);
  }
  // Mirrors are re-synced from the canon BEFORE the placeholder gate (bug 27, field: the agent
  // fixed the canon, the gate went red on four stale MIRRORS, and the shortest visible path was
  // hand-editing copies — exactly what the canon forbids). The step is mechanical and idempotent;
  // whatever still fails after it is a genuine canon-side problem.
  resyncCopies();
  missing += scanPlaceholders();
  const anonDeploy = okOnDisk(KAIF_JSON) && readJson(KAIF_JSON).tracking === 'anonymous';
  if (anonDeploy) missing += anonLeakScan();
  if (missing) die(`${verb} FAILED: ${missing} issues — finish them and re-run`);
  warnSphereLibrary();
  healMarker();
  // Re-snapshot the DISK shas now that every merge landed (plan 21 §3.2; field: KPOT caught the
  // manifest asserting pre-merge shas forever). templateShas stay untouched — they are the
  // release's truth, not the disk's.
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try {
      const m = readJson(DEPLOY_MANIFEST);
      for (const p of [...(m.paths || []), ...(m.agents || [])]) if (okOnDisk(p)) m.shas[p] = fileSha(p);
      writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
      log('↻ refreshed the disk snapshot in the deploy manifest (post-merge)');
    } catch { /* unreadable manifest — check flags it separately */ }
  }
  selfCleanArtifacts(taskFile, anonDeploy);
}

// The module audit (field proposal A, third 2.0 report §5): re-cut the DISK with the same
// splitter and compare per-signature against the manifest — it catches the class the module
// machinery itself can break ("a module lost its identity"), which no line-level check sees.
// Informational: divergence is often legitimate (owner edits); the value is making it VISIBLE.
function moduleAudit() {
 try {   // informational by doctrine — it must never be able to burn the receipt (judge F2)
  if (!okOnDisk(DEPLOY_MANIFEST)) return;
  let m; try { m = readJson(DEPLOY_MANIFEST); } catch { return; }
  if (!m.moduleShas) return;
  let identical = 0, differs = 0, absent = 0, ours = 0;
  const lines = [];
  for (const [p, mods] of Object.entries(m.moduleShas)) {
    if (!okOnDisk(p)) continue;
    const disk = splitModules(normEol(readFileSync(p, 'utf8')));
    const diskBySig = new Map(disk.map((d) => [d.signature, normSha(modText(d))]));
    let fileClean = true;
    for (const e of mods) {
      const got = diskBySig.get(e.signature);
      if (got === undefined) { absent++; fileClean = false; lines.push(`  MODULE ABSENT: ${p} :: ${e.signature} (${e.class})`); }
      else if (got !== e.sha256) { differs++; fileClean = false; }
    }
    for (const d of disk) if (!mods.some((e) => e.signature === d.signature)) { ours++; fileClean = false; }
    if (fileClean) identical++;
  }
  log(`module audit: ${identical} files match their deployed cut; ${differs} modules differ, ${absent} template modules absent, ${ours} modules are yours`);
  for (const l of lines.slice(0, 10)) log(l);
  if (absent) log('  (an ABSENT template module usually means its signature drifted — see bug 26; eyeball the file)');
 } catch (e) { log(`⚠ module audit skipped: ${e.message}`); }
}

function cmdUpdateVerify() {
  runFinalGates(UPDATE_TASK, 'KAIF-UPDATE', 'update-verify');
  moduleAudit();
  // Stamp the receipt: the proof of a verified update must outlive the self-clean (bug 17).
  if (okOnDisk(LAST_UPDATE)) {
    try {
      const r = readJson(LAST_UPDATE);
      r.verifiedAt = new Date().toISOString().slice(0, 10);
      writeFileSync(LAST_UPDATE, JSON.stringify(r, null, 2) + '\n');
      log(`↻ stamped ${LAST_UPDATE} (verifiedAt)`);
    } catch { /* unreadable receipt — nothing to stamp */ }
  }
  log('✅ update-verify passed — the update is complete and self-cleaned. Commit: chore: update KAIF');
}

// ---------------------------------------------------------------------------- commands
async function cmdInstall() {
  const { files, meta } = parseBundle(BUNDLE);
  // A legacy bootstrap inherits the OWNER'S LANGUAGE from the marker (like agents below):
  // re-running a ru-deployment's bootstrap without --lang used to silently apply English
  // templates and aliases (the same silent-widening class as bug 14's five systems).
  if (okOnDisk(KAIF_JSON) && !val('--lang')) {
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = String(j.language).toLowerCase(); } catch { /* CLI default stands */ }
  }
  const { deploy, translated, aliased } = applyLanguage(files);
  const values = stableValues();   // a re-run/bootstrap over an existing deploy keeps ITS values (bug 26)
  const unresolved = new Set();

  // Legacy/update detection: ANY existing deploy marker means this project already runs
  // KAIF — this bootstrap is an update-by-bootstrap (idea 14), never a fresh install:
  // existing files are kept (below), new entities added, marker fields preserved, and the
  // final task is an update merge, not adaptation. Version EQUALITY does not opt out
  // (field-caught in ДЗ-03: a 1.4 project updating onto a pre-release 1.4 bundle was
  // mis-detected as fresh and had its marker clobbered).
  let legacyOld = null;
  if (okOnDisk(KAIF_JSON)) {
    try { legacyOld = readJson(KAIF_JSON); } catch { /* unreadable marker — treat as fresh */ }
    if (legacyOld) log(`⟳ existing KAIF ${legacyOld.version || '?'} detected — running as an UPDATE to ${meta.version} (existing files are kept, new ones added)`);
  }
  // A legacy bootstrap must not silently WIDEN the deployment: the old default (all five
  // systems) handed a two-system project ~80 unrequested files (bug 14, KLAS). Inherit the
  // marker's agents — the 1.4-era singular `agent` included — and always say what was chosen.
  if (legacyOld && !val('--agents')) {
    const inherited = Array.isArray(legacyOld.agents) && legacyOld.agents.length ? legacyOld.agents
      : legacyOld.agent ? [legacyOld.agent] : null;
    if (inherited) AGENTS = inherited;
    log(`⟳ target agent systems: ${AGENTS.join(', ')} (${inherited ? 'inherited from the existing marker' : 'default — no agents in the old marker'}; override with --agents)`);
  }
  ensureIgnoreFirst(); // ignore-first before any transient artifact can be staged

  // 1) write every deployable file (placeholder-filling the text ones; anonymizing on --mode anonymous).
  //    The filled/anonymized content is written BACK into the deploy entry so every derived
  //    surface (the .roo/.agents/.grok/.cline skill copies) inherits it — deriving copies from
  //    the raw template shipped placeholders to the other agent systems (bug 05, field-caught).
  //    Since plan 21 §5.5 a bootstrap over an EXISTING deployment is classified exactly like a
  //    core update whenever a baseline exists: the surviving deploy manifest (anonymous installs
  //    keep an origin-free one now) or a SYNTHETIC baseline cut from the old version's own
  //    release artifact. Only with no baseline at all does classic adopt-everything run.
  let adopted = [];
  let cls = null;
  if (legacyOld) {
    let baseline = null;
    if (okOnDisk(DEPLOY_MANIFEST)) {
      try { const mOld = readJson(DEPLOY_MANIFEST); if (mOld.templateShas) baseline = mOld; } catch { /* unreadable — try synthetic */ }
    }
    if (!baseline) baseline = await buildSyntheticBaseline(legacyOld);
    if (baseline) {
      cls = classifyAndApply(deploy, baseline, values, unresolved, legacyOld);
      cls.baselineOld = baseline; // deprecations later need the OLD template shas (step 5)
      adopted = cls.adopted;
      log(`⟳ bootstrap classified against ${baseline.synthetic ? `a synthetic baseline of v${legacyOld.version}` : 'the surviving deploy manifest'}: ${cls.replaced} replaced, ${cls.mergedModules} modules merged in-place, ${cls.added} added, ${cls.kept} kept`);
    }
  }
  if (!cls) {
    for (const f of deploy) {
      if (isSkippedAnon(f.path)) { log(`⊘ anonymous — skipped ${f.path}`); continue; }
      let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
      if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
      f.content = content;
      if (!writeIfNew(f.path, content)) adopted.push(f.path);
    }
  }

  // 2) skills for all target agent systems (from the canonical .claude/skills/ set)
  const skillFiles = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path));
  const refFiles = deploy.filter((f) => /^\.claude\/skills\/[^/]+\/references\//.test(f.path));
  deployAgentSystems(skillFiles, refFiles);

  // 3) wiring: deploy marker + npm handles (respectful: existing scripts untouched).
  //    On a legacy update the old marker's owner-level fields (sphere, language, tracking)
  //    survive; only version/released/agents move forward.
  mkdirSync('.kaif', { recursive: true });
  // Update over an existing deployment: start from the OLD marker so every field survives —
  // including custom ones (e.g. `deployed`, ДЗ-03 field lesson) — and move only what this
  // install owns (version/released/agents; language only if explicitly passed).
  const marker = legacyOld
    ? { ...legacyOld, framework: 'KAIF', version: meta.version, released: meta.released,
        agents: AGENTS, language: val('--lang') ? LANG : (legacyOld.language || LANG) }
    : { framework: 'KAIF', version: meta.version, released: meta.released,
        ...(ANON ? { tracking: 'anonymous' } : { origin: ORIGIN, tracking: 'origin' }),
        sphere: 'TODO', agents: AGENTS, language: LANG };
  // Superseded marker fields: `{...legacyOld}` carries EVERYTHING forward, so renamed fields
  // of past schemas pile up (bug 19.3: agentsSupported from 1.4 living next to agents).
  // `agents` is always written above — the old spellings are safe to drop unconditionally.
  if (legacyOld) for (const stale of ['agent', 'agentsSupported']) delete marker[stale];
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  log(`+ wrote ${KAIF_JSON}`);
  // Respectful wiring: NEVER clobber an existing package.json we cannot parse —
  // an unreadable file means "skip the handles and say so", not "overwrite the user's file".
  // Anonymous installs get no kaif:* handles at all (they point at the origin-carrying core,
  // which verify-final removes) — the version stays readable in .kaif/kaif.json.
  let pkg = null;
  if (ANON) { /* no handles by design */ }
  else if (existsSync('package.json')) {
    try { pkg = readJson('package.json'); }
    catch { console.error('⚠ package.json exists but is not parseable JSON — kaif:* handles NOT wired (add them by hand)'); }
  } else pkg = {};
  if (pkg) {
    // Write ONLY when something was actually added: an unconditional rewrite re-serialized the
    // user's file (CRLF→LF) into a phantom whole-file diff on every install (bug 22 / ndim K4).
    let wired = 0;
    if (!pkg.name) { pkg.name = values['<PROJECT_NAME>'].toLowerCase().replace(/[^a-z0-9-]+/g, '-'); wired++; }
    pkg.scripts = pkg.scripts || {};
    const handles = { 'kaif:version': 'node .kaif/kaif-core.mjs version', 'kaif:check': 'node .kaif/kaif-core.mjs check',
                      'kaif:update': 'node .kaif/kaif-core.mjs update' };
    for (const [k, v] of Object.entries(handles)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; wired++; }
    if (wired) {
      writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
      log('+ wired kaif:* handles into package.json');
    } else log('= kaif:* handles already wired — package.json untouched');
  }

  // 4) persist the deploy manifest so `check` outlives the bundle's cleanup.
  //    MANIFEST v2 (plan 21 §3.2): THREE snapshots with distinct provenance —
  //    `shas`         what is ON DISK (byte-exact; refreshed by the final gates post-merge);
  //    `templateShas` what THIS FRAMEWORK VERSION deploys (post-fill, EOL-normalized) — the ONLY
  //                   snapshot that authorizes a mechanical replace: it never mutates with the
  //                   disk, so an adaptation that survived one update can't die in the next (bug 12);
  //    `moduleShas`   the per-module cut of every md template (signature anchors + classes) —
  //                   the base for modular merges on the next update.
  //    `kept` records PROVENANCE: paths adopted as found (not written from a template) —
  //    their snapshot is owner content, so sha-match alone never authorizes replacing them.
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  const templateShas = {};
  const moduleShas = {};
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
  }
  // `marker` — a pristine snapshot of .kaif/kaif.json: weak models sometimes REWRITE the
  // marker instead of adding a key (field-caught, ДЗ-02 run 5), losing version/agents/language;
  // the final gates self-heal from this snapshot.
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, kept: adopted,
    values: persistValues(values), marker }, null, 2) + '\n');

  // 5) the final cognitive task for the agent: fresh install → adaptation;
  //    install over an OLDER deployed KAIF (legacy 1.4-style project bootstrapped
  //    with the thin KAIF.md) → an UPDATE task instead (existing files were kept).
  if (legacyOld) {
    // Receipt/history are written only for a REAL version move: a same-version re-run must not
    // pad the history with `X → X` noise, and must never clobber a previous update's verified
    // receipt — that receipt is the permanent proof bug 17 exists to provide (review-caught).
    if (legacyOld.version !== meta.version) {
      writeReceipt({ from: legacyOld.version, to: meta.version, route: 'legacy-bootstrap',
        counters: cls ? { replaced: cls.replaced, mergedModules: cls.mergedModules, added: cls.added, kept: cls.kept, adopted: adopted.length }
                      : { adopted: adopted.length },
        classified: !!cls });
      appendHistory(marker, legacyOld.version, meta.version, 'legacy-bootstrap');
      writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
    }
    // A re-run must not clobber recorded progress (bug 14, field: a second bootstrap wiped the
    // checkpoints and wrote a meaningless "legacy update 1.6 → 1.6" context line).
    if (existsSync(UPDATE_TASK) && /^KAIF-UPDATE: /m.test(readFileSync(UPDATE_TASK, 'utf8'))) {
      log(`= kept existing ${UPDATE_TASK} (it carries recorded checkpoints — not overwritten)`);
    } else {
      // The context line derives the REASON from the actual deployment state — "pre-1.5 project"
      // was a false model on anonymous installs, whose snapshots were removed by self-clean.
      const rerun = legacyOld.version === meta.version;
      // bugs/25, bootstrap facet (judge F1): a checkpoint-less unfinished task from a PREVIOUS
      // interval carries undelivered module diffs — for anonymous deployments the bootstrap is
      // the ONLY update road, so clobbering it here would lose them without a trace. Preserve
      // it aside; a same-version re-run regenerates the equivalent task and needs no ceremony.
      if (!rerun && existsSync(UPDATE_TASK)) {
        const aside = 'KAIF_UPDATE_TASK.superseded.md';
        writeFileSync(aside, readFileSync(UPDATE_TASK));
        log(`⚠ an unfinished ${UPDATE_TASK} from a previous interval was preserved as ${aside} — mine it for unmerged diffs, then delete it`);
      }
      const nMod = cls ? Object.values(cls.divergedModules).reduce((a, l) => a + l.length, 0) : 0;
      const why = legacyOld.tracking === 'anonymous'
        ? 'this anonymous deployment kept no content snapshots'
        : 'this deployment has no content snapshots (pre-1.5 deployments never wrote them)';
      const dep = cls ? handleDeprecations(meta, cls.baselineOld || {}) : { removed: 0, items: [] };
      const staleClaims = rerun ? [] : scanStaleClaims(legacyOld.version, meta.version,
        okOnDisk(DEPLOY_MANIFEST) ? (() => { try { return readJson(DEPLOY_MANIFEST).templateShas || null; } catch { return null; } })() : null);
      // Only slots literally on disk make the task item (judge finding — see cmdUpdate).
      const liveUnresolved = [...unresolved].filter((ph) =>
        deploy.some((f) => f.path.endsWith('.md') && okOnDisk(f.path) && readFileSync(f.path, 'utf8').includes(ph)));
      // A CLASSIFIED bootstrap (surviving manifest / synthetic baseline) hands over exactly what
      // a core update would: per-module diffs and honest counters — not "merge everything".
      writeUpdateTask(cls ? cls.diverged : [], meta, rerun
        ? `re-run on ${meta.version}: the tree already carries this version — verify the previous merge rather than redoing it`
        : cls
          ? `bootstrap update ${legacyOld.version || '?'} → ${meta.version}, classified mechanically: ${cls.replaced} replaced, ${cls.mergedModules} modules merged in-place, ${cls.added} added, ${cls.kept} kept${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}${nMod ? `; ${nMod} module(s) await your merge — diffs below` : ''}`
          : `legacy update ${legacyOld.version || '?'} → ${meta.version}: ${why}, so every kept framework file may carry local edits — merge the template news below into them pointwise`,
        cls ? { divergedModules: cls.divergedModules, ownerConvention: cls.ownerConvention, fromVersion: legacyOld.version, deprecations: dep.items, staleClaims, translatedWholesale: cls.translatedWholesale, unresolved: liveUnresolved }
            : { fromVersion: legacyOld.version, staleClaims, unresolved: liveUnresolved });
    }
    if (existsSync(TASK_FILE)) { unlinkSync(TASK_FILE); log(`- removed stale ${TASK_FILE} (this is an update, not an adaptation)`); }
  } else {
    writeAdaptationTask(unresolved, translated, meta);
    if (existsSync(UPDATE_TASK)) { unlinkSync(UPDATE_TASK); log(`- removed stale ${UPDATE_TASK}`); }
  }

  // 6) validate what we just did (the required task file depends on the mode)
  const bad = validate(deploy, skillFiles, legacyOld ? UPDATE_TASK : TASK_FILE);
  if (bad) die(`install INCOMPLETE: ${bad} artifacts missing — re-run, or fix and \`check\``);
  log(`\n✅ KAIF ${meta.version} deployed mechanically (lang ${LANG}${translated ? ` · ${translated} owner docs templated` : ''}${aliased ? ` · ${aliased} skills trigger-aliased` : ''}, mode ${MODE}, agents ${AGENTS.join(',')}).`);
  if (legacyOld) log(`➡ ONE cognitive step remains — open ${UPDATE_TASK} and work it, then run: node .kaif/kaif-core.mjs update-verify`);
  else log(`➡ ONE cognitive step remains — open ${TASK_FILE} and work it, then run: node .kaif/kaif-core.mjs verify-final`);
}

function validate(deploy, skillFiles, taskFile = TASK_FILE) {
  let missing = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    if (!okOnDisk(f.path)) { console.error(`✖ MISSING or empty: ${f.path}`); missing++; }
  }
  for (const p of expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path))))
    if (!okOnDisk(p)) { console.error(`✖ MISSING agent artifact: ${p}`); missing++; }
  for (const p of [KAIF_JSON, taskFile]) if (!okOnDisk(p)) { console.error(`✖ MISSING: ${p}`); missing++; }
  return missing;
}

function cmdCheck() {
  // Prefer the live bundle (pre-cleanup); after verify-final fall back to the persisted manifest.
  // Expected agent systems come from the DEPLOYED marker, not the CLI default — a narrowed
  // install (--agents a,b) must not be judged against all five systems.
  if (!val('--agents') && okOnDisk(KAIF_JSON)) {
    try { const j = readJson(KAIF_JSON); if (Array.isArray(j.agents) && j.agents.length) AGENTS = j.agents; } catch { /* marker unreadable — CLI default stands */ }
  }
  let paths, agents;
  if (existsSync(BUNDLE)) {
    const { files } = parseBundle(BUNDLE);
    const { deploy } = applyLanguage(files);
    paths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
    agents = expectedAgentArtifacts(deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path)).map((f) => skillName(f.path)));
  } else if (okOnDisk(DEPLOY_MANIFEST)) {
    ({ paths, agents } = readJson(DEPLOY_MANIFEST));
  } else die(`neither ${BUNDLE} nor ${DEPLOY_MANIFEST} found — is KAIF deployed here?`);
  let missing = 0;
  for (const p of [...paths, ...agents, KAIF_JSON])
    if (!okOnDisk(p)) { console.error(`✖ MISSING or empty: ${p}`); missing++; }
  // Marker SCHEMA (bugs/11 tail; the schema is Reference §12.1): the 1.5 agent→agents rename
  // passed every gate invisibly — "exists and non-empty" is not a schema check.
  try {
    const j = readJson(KAIF_JSON);
    const schemaIssues = [];
    if (j.framework !== 'KAIF') schemaIssues.push(`framework is "${j.framework}", expected "KAIF"`);
    if (typeof j.version !== 'string' || !j.version) schemaIssues.push('version missing or not a string');
    if (!['origin', 'anonymous', 'fork'].includes(j.tracking)) schemaIssues.push(`tracking "${j.tracking}" is not origin|anonymous|fork`);
    if (!Array.isArray(j.agents) || !j.agents.length) schemaIssues.push('agents is not a non-empty array');
    if (typeof j.language !== 'string' || !j.language) schemaIssues.push('language missing');
    for (const k of ['agent', 'agentsSupported']) if (k in j) schemaIssues.push(`superseded field "${k}" present (an older schema — update should have dropped it)`);
    for (const s of schemaIssues) { console.error(`✖ marker schema: ${s} (Reference §12.1)`); missing++; }
  } catch { console.error('✖ marker unreadable as JSON'); missing++; }
  if (missing) die(`INCOMPLETE: ${missing} artifacts missing`);
  // Content gate (warning, not failure): a mirror that EXISTS but drifted from its canon
  // skill passed the old existence-only check for a whole release (bug 11; nine days of five
  // systems on stale skills, NDim). Non-fatal by design: between `update` and `update-verify`
  // the mirrors legitimately lag the canon until the re-sync runs.
  let drifted = 0;
  if (existsSync('.claude/skills')) {
    const mirrors = { codex: (n) => [`.agents/skills/${n}/SKILL.md`, (t) => t],
                      'grok-build': (n) => [`.grok/skills/${n}/SKILL.md`, (t) => t],
                      cline: (n) => [`.cline/skills/${n}/SKILL.md`, (t) => t],
                      'zoo-code': (n) => [`.roo/commands/${n}.md`, (t) => t.replace(/^name:[^\n]*\n/m, '')] };
    for (const n of readdirSync('.claude/skills')) {
      const canonPath = `.claude/skills/${n}/SKILL.md`;
      if (!okOnDisk(canonPath)) continue;
      const canonText = readFileSync(canonPath, 'utf8');
      for (const sys of AGENTS) {
        if (!mirrors[sys]) continue;
        const [p, transform] = mirrors[sys](n);
        // One line per drifted mirror flooded the mid-update check with 44 warnings (bug 30.5,
        // field: "normal state until re-sync") — show a sample, summarize the rest.
        if (okOnDisk(p) && readFileSync(p, 'utf8') !== transform(canonText)) { if (drifted < 3) console.error(`⚠ mirror drifted from canon: ${p}`); drifted++; }
      }
    }
    if (drifted) console.error(`⚠ ${drifted} mirror copies lag the canon${drifted > 3 ? ` (${drifted - 3} more not listed)` : ''} — normal until re-sync; run \`node .kaif/kaif-core.mjs sync\` (update-verify re-syncs automatically)`);
  }
  warnSphereLibrary();
  log(`✅ manifest satisfied: ${paths.length} files + ${agents.length} agent artifacts present${drifted ? ` (⚠ ${drifted} drifted mirrors — see above)` : ''}`);
}

// sync — the standalone handle over resyncCopies(): mirror drift accumulates BETWEEN updates,
// where the re-sync used to be unreachable (bug 11 facet; asked for by the KrinikCam report).
function cmdSync() {
  resyncCopies();
  log('✅ sync done — the per-system mirrors now equal the canon .claude/skills/');
}

// sphere <name> — the file-edit-free way to record the project's sphere (field lesson,
// ДЗ-02 run 5: a weak model REPLACED .kaif/kaif.json with {"sphere":…}, losing every other
// field). Merges the key; never lets the model touch the marker by hand.
function cmdSphere() {
  const name = args[1];
  if (!name || name.startsWith('--')) die('usage: kaif-core sphere <name>   (e.g. sphere programming)');
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
  j.sphere = name;
  writeFileSync(KAIF_JSON, JSON.stringify(j, null, 2) + '\n');
  log(`✔ sphere recorded: ${name}`);
}

// checkpoint <id> — the file-edit-free way to record a finished task item (field lesson,
// ДЗ-02 run 4: weak models corrupt files when forced to edit them via diff tools; a shell
// command they run reliably). Appends the forced line to the live task file itself.
function cmdCheckpoint() {
  const id = args[1];
  if (!id || id.startsWith('--')) die('usage: kaif-core checkpoint <item-id> [--verdict "<judge verdict + one line of proof>"]');
  const file = okOnDisk(UPDATE_TASK) ? UPDATE_TASK : okOnDisk(TASK_FILE) ? TASK_FILE : null;
  if (!file) die('no task file found — nothing to checkpoint');
  const tag = file === UPDATE_TASK ? 'KAIF-UPDATE' : 'KAIF-ADAPT';
  const task = normEol(readFileSync(file, 'utf8'));   // bug 24: $-anchors vs a CRLF-resaved task
  if (!task.includes(`kaif-core.mjs checkpoint ${id}`) && !task.includes(`${tag}: ${id} done`))
    die(`unknown item id "${id}" — it is not named in ${file}`);
  // Checkpoints EXECUTE their own gate where one exists (bug 17: recording a tick used to be
  // free — a weak model could stamp all four without doing anything):
  //   recheck — runs the actual `check` and refuses to record on failure;
  //   judge   — requires a verdict line with evidence (recorded next to the tick; the final
  //             gates verify its presence).
  if (id === 'recheck') {
    // execFileSync + process.execPath: no shell (paths with $/backticks survive on POSIX),
    // no PATH lookup (the same node binary that runs this process runs the check).
    try {
      const out = execFileSync(process.execPath, [process.argv[1], 'check'], { stdio: 'pipe' });
      if (out && out.length) process.stdout.write(out.toString()); // surface check's warnings too
    } catch (e) {
      console.error((e.stdout || '').toString() + (e.stderr || '').toString());
      die('checkpoint recheck REFUSED: `check` failed — fix the issues above, then re-run');
    }
    log('✔ check ran green (executed by the checkpoint itself)');
  }
  let verdictLine = null;
  if (id === 'judge') {
    const v = val('--verdict');
    if (!v) die('checkpoint judge requires --verdict "<VERDICT: one line of evidence>" — an unevidenced tick is exactly the fraud /fable-judge hunts');
    verdictLine = `${tag}: judge verdict: ${v}`;
  }
  const line = `${tag}: ${id} done`;
  if (new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) {
    // A judge tick that exists WITHOUT its verdict (e.g. hand-written — the exact bug-17 move)
    // must still be repairable by the very command the failing gate recommends (review-caught
    // deadlock: "already recorded" used to discard the verdict and the gate stayed red forever).
    if (verdictLine && !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
      writeFileSync(file, task.replace(/\s*$/, '\n') + verdictLine + '\n');
      log('✔ verdict recorded for the already-ticked judge checkpoint');
      return;
    }
    log(`= already recorded: ${line}`);
    return;
  }
  writeFileSync(file, task.replace(/\s*$/, '\n') + (verdictLine ? verdictLine + '\n' : '') + line + '\n');
  log(`✔ recorded: ${line}${verdictLine ? ' (+ verdict)' : ''}`);
}

// adopt-current — rebuild the snapshot after a MANUAL migration (field: one hand-made pass left
// 113/160 stale shas and killed the mechanical path forever — KrinikCam №10). Every path that
// now diverges from its deployed template is adopted (protected); disk shas and the marker
// snapshot are refreshed. Respectful by definition: it only RECORDS reality, changes no content.
function cmdAdoptCurrent() {
  if (!okOnDisk(DEPLOY_MANIFEST)) die('no deploy manifest — nothing to adopt (deploy KAIF first)');
  const m = readJson(DEPLOY_MANIFEST);
  m.shas = m.shas || {};
  const keptSet = new Set(m.kept || []);
  let adoptedNow = 0;
  for (const p of m.paths || []) {
    if (!okOnDisk(p)) continue;
    // "Manually changed" is judged BEFORE the disk sha is refreshed. On a v2 manifest the
    // authority is the template sha; on a v1 manifest the only baseline is the OLD disk sha —
    // refreshing it first would relabel every manual edit as "untouched" and hand the next
    // update a license to clobber exactly the files this command exists to protect
    // (review-caught blocker before this ever shipped).
    const tpl = (m.templateShas || {})[p];
    const changed = tpl ? fileShaNorm(p) !== tpl : (m.shas[p] && fileSha(p) !== m.shas[p]);
    if (changed && !keptSet.has(p)) { keptSet.add(p); adoptedNow++; log(`⟳ adopted (manual change recorded): ${p}`); }
    m.shas[p] = fileSha(p);
  }
  for (const p of m.agents || []) if (okOnDisk(p)) m.shas[p] = fileSha(p);
  m.kept = [...keptSet];
  if (okOnDisk(KAIF_JSON)) { try { m.marker = readJson(KAIF_JSON); } catch { /* keep old snapshot */ } }
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
  log(`✔ adopt-current: snapshot rebuilt — ${adoptedNow} newly adopted path(s), disk shas and marker snapshot refreshed. The mechanical update path is live again.`);
}

// diff — the machine version-delta the field reinvented seven times (П1). Two modes:
//   bare `diff`            — audit: disk vs the DEPLOYED templates (protected / replace-eligible);
//   `diff --source <x>`    — preview: ANOTHER version's bundle vs this deployment, per static module.
async function cmdDiff() {
  if (!okOnDisk(DEPLOY_MANIFEST)) die('no deploy manifest — deploy KAIF first');
  const m = readJson(DEPLOY_MANIFEST);
  const src = val('--source');
  if (!src) {
    if (!m.templateShas)
      die('this deployment carries a v1 manifest (no template provenance) — the audit would report a hollow green. Run the next `update` (it upgrades the manifest to v2), then `diff` works.');
    let match = 0, missing = 0;
    const divFiles = [];
    for (const p of m.paths || []) {
      const tpl = (m.templateShas || {})[p];
      if (!tpl) continue;
      if (!okOnDisk(p)) { missing++; continue; }
      if (fileShaNorm(p) === tpl) match++; else divFiles.push(p);
    }
    log(`diff (audit vs deployed templates): ${divFiles.length} diverged file(s) — protected from replacement; ${match} match — replace-eligible on update${missing ? `; ${missing} missing` : ''}`);
    for (const p of divFiles) log('  ≠ ' + p);
    return;
  }
  // the preview must judge in DEPLOYED space: the other bundle goes through the SAME transforms
  // an actual update would apply (language overrides/aliases + placeholder fill) — comparing raw
  // templates against a deployed manifest reported phantom deltas (a heading containing
  // <PROJECT_NAME> changes its own signature when filled; sandbox-caught).
  if (!val('--lang') && okOnDisk(KAIF_JSON)) {
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = String(j.language).toLowerCase(); } catch { /* default stands */ }
  }
  const man2 = JSON.parse((await fetchArtifact(src, 'kaif-manifest.json')).toString('utf8'));
  mkdirSync('.kaif/install', { recursive: true });
  const tmp = '.kaif/install/DIFF-BUNDLE.md';
  writeFileSync(tmp, await fetchArtifact(src, 'KAIF-CORE-BUNDLE.md'));
  const { files, meta } = parseBundle(tmp);
  unlinkSync(tmp);
  const { deploy: otherDeploy } = applyLanguage(files);
  const values = stableValues();   // preview must fill exactly like the deploy did (bug 26)
  // A v1 manifest has no module provenance, and the loop below would skip every file and print
  // a hollow "0 files / 0 nothing to do" — worse than an honest refusal, and it hit exactly the
  // first-ever update, the moment of highest risk (bug 21 / ndim K3). Build the deployed
  // version's SYNTHETIC baseline instead (same code as the legacy bootstrap; --baseline works).
  let mineModShas = m.moduleShas;
  if (!mineModShas || !Object.keys(mineModShas).length) {
    const curVer = okOnDisk(KAIF_JSON) ? (() => { try { return readJson(KAIF_JSON).version; } catch { return null; } })() : null;
    const synth = await buildSyntheticBaseline({ version: curVer });
    if (!synth) die(`this deployment carries a v1 manifest (no template provenance) and no baseline artifact for v${curVer || '?'} is reachable — pass --baseline <dir|url> with that version's release artifacts, or run the next update (it upgrades the manifest to v2)`);
    mineModShas = synth.moduleShas;
  }
  let changedFiles = 0, sameFiles = 0;
  const lines = [];
  for (const f of otherDeploy) {
    if (!f.path.endsWith('.md')) continue;
    const mine = mineModShas[f.path];
    if (!mine) continue; // not deployed here
    const filled = fillPlaceholders(f.content, values, new Set());
    const other = moduleEntries(f.path, normEol(filled).replace(/\s+$/, '\n'), meta.moduleClasses);
    const mineBySig = new Map(mine.map((e) => [e.signature, e]));
    let chg = 0;
    for (const om of other) {
      if (om.class !== 'static') continue;
      const me = mineBySig.get(om.signature);
      if (!me || me.sha256 !== om.sha256) chg++;
    }
    for (const me of mine) if (me.class === 'static' && !other.some((o) => o.signature === me.signature)) chg++;
    if (chg) { changedFiles++; lines.push(`  Δ ${f.path} — ${chg} static module(s) differ`); }
    else sameFiles++;
  }
  log(`diff vs ${man2.version}: ${changedFiles} file(s) carry upstream static-module changes; ${sameFiles} — nothing to do`);
  for (const l of lines) log(l);
}

function cmdVerifyFinal() {
  runFinalGates(TASK_FILE, 'KAIF-ADAPT', 'verify-final');
  log('✅ verify-final passed — KAIF install is complete and self-cleaned. Commit: chore: deploy KAIF');
}

function cmdVersion() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = JSON.parse(readFileSync(KAIF_JSON, 'utf8'));
  log(`KAIF ${j.version} (released ${j.released}) · tracking: ${j.tracking} · lang: ${j.language} · agents: ${(j.agents || []).join(',')}`);
}

// modules — print this core's module cut of a bundle as JSON (audit surface). The origin's
// self-check compares it against dist/kaif-module-map.json: the core's vendored splitter and
// the build's library are thereby pinned to identical behavior (plan 21 — no silent drift).
function cmdModules() {
  const { files, meta } = parseBundle(val('--bundle') || BUNDLE);
  const out = {};
  let count = 0;
  for (const f of files) {
    if (!f.path.endsWith('.md')) continue;
    out[f.path] = moduleEntries(f.path, f.content.replace(/\s+$/, '\n'), meta.moduleClasses);
    count += out[f.path].length;
  }
  console.log(JSON.stringify({ moduleCount: count, files: out }, null, 2));
}

await ({ install: cmdInstall, check: cmdCheck, 'verify-final': cmdVerifyFinal, version: cmdVersion,
         update: cmdUpdate, 'update-verify': cmdUpdateVerify, checkpoint: cmdCheckpoint, sphere: cmdSphere,
         sync: cmdSync, modules: cmdModules, diff: cmdDiff, 'adopt-current': cmdAdoptCurrent }[CMD] ||
  (() => die(`unknown command: ${CMD} (install | check | verify-final | update | update-verify | checkpoint | sphere | sync | modules | diff | adopt-current | version)`)))();
