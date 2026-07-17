#!/usr/bin/env node
// KAIF-CORE.mjs — the heavy KAIF installer machinery (KAIF 1.5 — Tested KAIF; thin-install architecture).
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
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------- CLI
const args = process.argv.slice(2);
const CMD = args[0] && !args[0].startsWith('--') ? args[0] : 'install';
const val = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const has = (f) => args.includes(f);

const BUNDLE = val('--bundle') || '.kaif/install/KAIF-CORE-BUNDLE.md';
// LANG/AGENTS are `let`: `update` inherits them from the project's .kaif/kaif.json
// unless explicitly overridden on the CLI.
let LANG = (val('--lang') || 'en').toLowerCase();
const MODE = (val('--mode') || 'standard').toLowerCase();
const ANON = MODE === 'anonymous';
const FORCE = has('--force');
const ALL_AGENTS = ['claude-code', 'codex', 'grok-build', 'cline', 'zoo-code'];
let AGENTS = (val('--agents') || ALL_AGENTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const ORIGIN = 'https://github.com/MikalaiKryvusha/KAIF';
// Skills skipped on anonymous installs. kaif-version included since 1.5: its template
// references the origin repo, and anonymity is BY DESIGN now — the version stays readable
// in .kaif/kaif.json directly.
const ORIGIN_TIED = ['kaif-update', 'kaif-switch-origin', 'kaif-fork', 'kaif-version'];
// Author identity tokens: anonymous installs strip marked regions, de-expand the brand
// acronym, and verify-final greps the deployed tree for these before declaring success.
const AUTHOR_TOKENS = ['Kryvusha', 'KRINIK', 'Krinik', 'MikalaiKryvusha', 'Кривуша', 'Криник'];
const ACRONYM_EXPANSIONS = ['KAIF (Krinik AI Framework)', 'Krinik AI Framework (KAIF)', 'Krinik AI Framework'];
const KAIF_JSON = '.kaif/kaif.json';
const DEPLOY_MANIFEST = '.kaif/deploy-manifest.json'; // persisted path list — `check` works after the bundle is cleaned
const TASK_FILE = 'KAIF_ADAPTATION_TASK.md';
const FENCE = '`'.repeat(6);

// The 8 canonical deploy-time placeholders (KAIF.md §11). CORE fills what it can
// detect mechanically; the rest lands in the adaptation task for the agent.
const PLACEHOLDERS = ['<PROJECT_NAME>', '<SHORT_NAME>', '<AUTHOR>', '<REPO_URL>', '<LOCAL_PATH>',
                      '<LICENSE>', '<BUILD_COMMAND>', '<TEST_HARNESS>', '<COMMIT_COMMAND>', '<YOUR AGENT/MODEL>',
                      '<OWNER_LANGUAGE>'];

// Docs seeded/owned by the OWNER after deploy — an update never touches them and never
// even lists them as "diverged" (their divergence is the whole point of their existence).
const OWNER_SEEDED = ['GOAL.md', 'STATUS.md', 'EXPERIENCE.md', 'MASTER_PLAN.md',
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

// ---------------------------------------------------------------------------- bundle parsing
// The bundle uses the proven KAIF.md block format: `> **FILE: \`path\`** …` + 6-backtick fence.
// One special block, FILE: `kaif-bundle-manifest.json`, carries per-file metadata
// (audience/adaptation notes) and the version stamp — it is data, never written to disk.
function parseBundle(src) {
  if (!existsSync(src)) die(`bundle not found: ${src} (pass --bundle <path>)`);
  const text = readFileSync(src, 'utf8');
  const re = new RegExp('^> \\*\\*FILE: `([^`]+)`\\*\\*[^\\n]*\\r?\\n\\r?\\n' + FENCE + '\\w*\\r?\\n([\\s\\S]*?)\\r?\\n' + FENCE + '\\s*$', 'gm');
  const files = [];
  for (let m; (m = re.exec(text)); ) files.push({ path: m[1], content: m[2].replace(/\r\n/g, '\n') + '\n' });
  if (!files.length) die('no FILE: blocks found — is this a KAIF-CORE-BUNDLE.md?');
  const metaBlock = files.find((f) => f.path === 'kaif-bundle-manifest.json');
  if (!metaBlock) die('bundle manifest block (kaif-bundle-manifest.json) missing');
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
    '<OWNER_LANGUAGE>': LANG,   // the language-policy note in AGENT_GUIDE (idea 12: two audiences, two languages)
  };
}

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
// Same forced-checkpoint discipline as the adaptation task.
function writeUpdateTask(diverged, meta, contextLine) {
  const items = [];
  if (diverged.length) items.push(['merge-diverged', `These framework files carry LOCAL edits and were NOT overwritten — merge the new template's changes into each by hand (see the template news below): ${diverged.join(' · ')}`]);
  items.push(['review-news', 'Read the template news below; apply anything relevant to files this update could not touch mechanically.']);
  items.push(['recheck', 'Run `node .kaif/kaif-core.mjs check` — the deployed manifest must be 100% green.']);
  items.push(['judge', 'Run a /fable-judge pass over this update (versions in .kaif/kaif.json, nothing owner-authored lost, the merges real), then run `node .kaif/kaif-core.mjs update-verify`.']);
  const news = (meta.templateNotes || []).map((n) => `- ${n}`).join('\n') || '- (no template notes shipped with this version)';
  writeFileSync(UPDATE_TASK, [
    `# KAIF update task — finish the update to ${meta.version}`,
    '',
    `> ${contextLine}.`,
    '> Do NOT edit this file. When an item is finished, record it by running the command shown next to',
    '> it — the machinery appends the checkpoint for you. Then run `node .kaif/kaif-core.mjs update-verify`.',
    '',
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}\``),
    '',
    "## What's new in the templates",
    '',
    news,
    '',
    '## Checkpoints (append below as you finish items)',
    '',
  ].join('\n'));
  log(`+ wrote ${UPDATE_TASK} (${items.length} items${diverged.length ? `, ${diverged.length} diverged files` : ''})`);
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

// ---------------------------------------------------------------------------- update (idea 14 / plan 15)
// Mechanical respectful update: untouched framework files are replaced with the new
// templates; diverged ones are kept and handed to the agent; owner content is never
// in scope at all. Requires the deploy manifest with `shas` (installs since 1.5).
async function cmdUpdate() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const cur = readJson(KAIF_JSON);
  if (cur.tracking === 'anonymous') die('anonymous install tracks no origin — update by dropping a fresh thin KAIF.md and re-running the bootstrap');
  if (!val('--lang') && cur.language) LANG = String(cur.language).toLowerCase();
  if (!val('--agents') && Array.isArray(cur.agents) && cur.agents.length) AGENTS = cur.agents;
  const base = val('--source') || SOURCES[(val('--channel') || 'release').toLowerCase()] || SOURCES.release;
  log(`update: checking ${base}`);
  const man = JSON.parse((await fetchArtifact(base, 'kaif-manifest.json')).toString('utf8'));
  if (man.version === cur.version) { log(`✅ already up to date (KAIF ${cur.version})`); return; }
  log(`update: ${cur.version} → ${man.version}`);

  // fetch + verify the machinery pair
  mkdirSync('.kaif/install', { recursive: true });
  const bufs = {};
  for (const name of ['KAIF-CORE.mjs', 'KAIF-CORE-BUNDLE.md']) {
    bufs[name] = await fetchArtifact(base, name);
    const got = sha256(bufs[name]);
    if (got !== man.sha256[name]) die(`sha256 mismatch for ${name}: expected ${man.sha256[name]}, got ${got}`);
  }
  const bundlePath = '.kaif/install/KAIF-CORE-BUNDLE.md';
  writeFileSync(bundlePath, bufs['KAIF-CORE-BUNDLE.md']);

  // classify against the install-time snapshots
  const old = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : { paths: [], agents: [], shas: {} };
  const oldShas = old.shas || {};
  // Provenance gate: paths the previous deploy ADOPTED (kept as found, never written from a
  // template) are not replace-eligible even when the disk sha still matches the snapshot —
  // for them the snapshot IS the owner's content. "Unchanged since the snapshot" only
  // authorizes replacement when the snapshot itself was template-authored.
  const adoptedBefore = new Set(old.kept || []);
  const { files, meta } = parseBundle(bundlePath);
  const { deploy } = applyLanguage(files);           // LANG defaults handled below
  const values = detectValues();
  const unresolved = new Set();
  const diverged = [];
  const adopted = [];
  let replaced = 0, added = 0, kept = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    if (OWNER_SEEDED.includes(f.path)) { kept++; continue; }              // owner's — never in scope
    const content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
    f.content = content; // derived surfaces (system skill copies) must inherit the filled text (bug 05)
    if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; continue; }
    if (!adoptedBefore.has(f.path) && oldShas[f.path] && fileSha(f.path) === oldShas[f.path]) {
      writeFileSync(f.path, content); log(`↻ replaced ${f.path}`); replaced++;
    } else { diverged.push(f.path); kept++; adopted.push(f.path); }
  }
  // agent-system artifacts: same classification via the copies' snapshots
  const skillFiles = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path));
  const refFiles = deploy.filter((f) => /^\.claude\/skills\/[^/]+\/references\//.test(f.path));
  deployAgentSystems(skillFiles, refFiles); // writeIfNew semantics: new appear; existing kept (their canonical .claude source got classified above)

  // swap the core itself + refresh manifests (same shape and guarantees as install's:
  // sha snapshots + adoption provenance in `kept` + the pristine marker snapshot that
  // backs the final self-heal).
  writeFileSync('.kaif/kaif-core.mjs', bufs['KAIF-CORE.mjs']);
  log('↻ replaced .kaif/kaif-core.mjs (the machinery itself)');
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  const marker = { ...cur, version: man.version, released: man.released };
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ paths: deployedPaths, agents: agentPaths, shas, kept: adopted, marker }, null, 2) + '\n');

  writeUpdateTask(diverged, { ...meta, version: man.version }, `mechanical pass done: ${replaced} replaced, ${added} added, ${kept} kept (owner/diverged). Sanity-check with git diff: replaced files must carry NO owner edits — anything you meant to keep belongs in merge-diverged below`);
  log(`\n✅ KAIF updated mechanically to ${man.version} — finish ${UPDATE_TASK}, then: node .kaif/kaif-core.mjs update-verify`);
}

// ---------------------------------------------------------------------------- final gates
// The closing guarantees are a property of the DEPLOYED TREE, not of the road taken to it:
// install's verify-final and update's update-verify run the SAME gate sequence (field-caught
// on ndim, 2026-07-17 — the update path used to skip these, so owner-side merges made between
// the mechanical pass and the final check never reached the per-system skill copies).

// placeholder scan on the canon + skills (GOAL/maps may legitimately hold template slots for the owner)
function scanPlaceholders() {
  let issues = 0;
  const scan = ['AGENT_GUIDE.md', ...(existsSync('.claude/skills') ?
    readdirSync('.claude/skills').map((n) => `.claude/skills/${n}/SKILL.md`).filter(existsSync) : [])];
  for (const p of scan) {
    const t = readFileSync(p, 'utf8');
    for (const ph of PLACEHOLDERS) if (t.includes(ph)) { console.error(`✖ placeholder ${ph} still in ${p}`); issues++; }
  }
  return issues;
}

// anonymous deployments: grep the tree for author identity BEFORE cleanup —
// transient installer files (removed by the cleanup below) are excluded from the scan.
function anonLeakScan() {
  const TRANSIENT = ['KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK, '.kaif/install', '.kaif/kaif-core.mjs', DEPLOY_MANIFEST];
  const leaks = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = (dir === '.' ? '' : dir + '/') + n;
      if (['.git', 'node_modules'].includes(n) || TRANSIENT.some((t) => p === t || p.startsWith(t + '/'))) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(md|json|txt|mjs|js)$/i.test(n)) continue;
      const t = readFileSync(p, 'utf8');
      for (const tok of AUTHOR_TOKENS) if (t.includes(tok)) { leaks.push(`${p} → "${tok}"`); break; }
    }
  };
  walk('.');
  for (const l of leaks) console.error(`✖ anonymity leak: ${l}`);
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
    // the core itself and its manifest carry the origin URL — an anonymous project keeps neither,
    // nor the kaif:* handles that point at them (version stays readable in .kaif/kaif.json).
    for (const p of ['.kaif/kaif-core.mjs', DEPLOY_MANIFEST]) if (existsSync(p)) { unlinkSync(p); log(`- removed ${p} (anonymous)`); }
    try {
      const pkg = readJson('package.json');
      if (pkg.scripts) { delete pkg.scripts['kaif:version']; delete pkg.scripts['kaif:check']; delete pkg.scripts['kaif:update']; }
      writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
      log('- unwired kaif:* handles (anonymous)');
    } catch { /* no package.json — nothing to unwire */ }
  }
}

// Shared closing sequence: checkpoint grep on the live task file, then the gates, in order.
function runFinalGates(taskFile, tag, verb) {
  if (!okOnDisk(taskFile)) die(`${taskFile} not found — nothing to verify (or already cleaned)`);
  const task = readFileSync(taskFile, 'utf8');
  let missing = 0;
  for (const id of [...new Set([...task.matchAll(/checkpoint ([a-z-]+)`/g)].map((m) => m[1]))])
    if (!new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) { console.error(`✖ checkpoint missing: ${tag}: ${id} done  (record it: node .kaif/kaif-core.mjs checkpoint ${id})`); missing++; }
  missing += scanPlaceholders();
  const anonDeploy = okOnDisk(KAIF_JSON) && readJson(KAIF_JSON).tracking === 'anonymous';
  if (anonDeploy) missing += anonLeakScan();
  if (missing) die(`${verb} FAILED: ${missing} issues — finish them and re-run`);
  healMarker();
  resyncCopies();
  selfCleanArtifacts(taskFile, anonDeploy);
}

function cmdUpdateVerify() {
  runFinalGates(UPDATE_TASK, 'KAIF-UPDATE', 'update-verify');
  log('✅ update-verify passed — the update is complete and self-cleaned. Commit: chore: update KAIF');
}

// ---------------------------------------------------------------------------- commands
function cmdInstall() {
  const { files, meta } = parseBundle(BUNDLE);
  const { deploy, translated, aliased } = applyLanguage(files);
  const values = detectValues();
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

  // 1) write every deployable file (placeholder-filling the text ones; anonymizing on --mode anonymous).
  //    The filled/anonymized content is written BACK into the deploy entry so every derived
  //    surface (the .roo/.agents/.grok/.cline skill copies) inherits it — deriving copies from
  //    the raw template shipped placeholders to the other agent systems (bug 05, field-caught).
  const adopted = [];
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) { log(`⊘ anonymous — skipped ${f.path}`); continue; }
    let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
    if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
    f.content = content;
    if (!writeIfNew(f.path, content)) adopted.push(f.path);
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
  if (legacyOld && legacyOld.agent && !legacyOld.agents) delete marker.agent; // 1.4 singular field superseded by `agents`
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
    pkg.name = pkg.name || values['<PROJECT_NAME>'].toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    pkg.scripts = pkg.scripts || {};
    const handles = { 'kaif:version': 'node .kaif/kaif-core.mjs version', 'kaif:check': 'node .kaif/kaif-core.mjs check',
                      'kaif:update': 'node .kaif/kaif-core.mjs update' };
    for (const [k, v] of Object.entries(handles)) if (!pkg.scripts[k]) pkg.scripts[k] = v;
    writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    log('+ wired kaif:* handles into package.json');
  }

  // 4) persist the deploy manifest so `check` outlives the bundle's cleanup.
  //    `shas` snapshots what is ON DISK right after install — `update` later tells
  //    "untouched since install" (disk sha == snapshot → safe mechanical replace)
  //    from "diverged" (agent/owner edited → hands off, cognitive merge).
  //    `kept` records PROVENANCE: paths adopted as found (not written from a template) —
  //    their snapshot is owner content, so sha-match alone never authorizes replacing them.
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  // `marker` — a pristine snapshot of .kaif/kaif.json: weak models sometimes REWRITE the
  // marker instead of adding a key (field-caught, ДЗ-02 run 5), losing version/agents/language;
  // the final gates self-heal from this snapshot.
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ paths: deployedPaths, agents: agentPaths, shas, kept: adopted, marker }, null, 2) + '\n');

  // 5) the final cognitive task for the agent: fresh install → adaptation;
  //    install over an OLDER deployed KAIF (legacy 1.4-style project bootstrapped
  //    with the thin KAIF.md) → an UPDATE task instead (existing files were kept).
  if (legacyOld) {
    writeUpdateTask([], meta, `legacy update ${legacyOld.version || '?'} → ${meta.version}: pre-1.5 project has no content snapshots, so every kept framework file may carry local edits — merge the 1.5 template news below into them pointwise`);
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
  if (missing) die(`INCOMPLETE: ${missing} artifacts missing`);
  log(`✅ manifest satisfied: ${paths.length} files + ${agents.length} agent artifacts present`);
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
  if (!id || id.startsWith('--')) die('usage: kaif-core checkpoint <item-id>');
  const file = okOnDisk(UPDATE_TASK) ? UPDATE_TASK : okOnDisk(TASK_FILE) ? TASK_FILE : null;
  if (!file) die('no task file found — nothing to checkpoint');
  const tag = file === UPDATE_TASK ? 'KAIF-UPDATE' : 'KAIF-ADAPT';
  const task = readFileSync(file, 'utf8');
  if (!task.includes(`checkpoint ${id}`) && !task.includes(`${tag}: ${id} done`))
    die(`unknown item id "${id}" — it is not named in ${file}`);
  const line = `${tag}: ${id} done`;
  if (new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) { log(`= already recorded: ${line}`); return; }
  writeFileSync(file, task.replace(/\s*$/, '\n') + line + '\n');
  log(`✔ recorded: ${line}`);
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

await ({ install: cmdInstall, check: cmdCheck, 'verify-final': cmdVerifyFinal, version: cmdVersion,
         update: cmdUpdate, 'update-verify': cmdUpdateVerify, checkpoint: cmdCheckpoint, sphere: cmdSphere }[CMD] ||
  (() => die(`unknown command: ${CMD} (install | check | verify-final | update | update-verify | checkpoint | sphere | version)`)))();
