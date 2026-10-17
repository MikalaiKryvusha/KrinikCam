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
// Commands (a bare or flags-only run prints `help` and touches NOTHING — bug 33; the full list
// with one-liners lives in the COMMANDS spec at the end of this file and in `help`):
//   node kaif-core.mjs help                        # the command list (also the bare-run default)
//   node kaif-core.mjs install --bundle <KAIF-CORE-BUNDLE.md> [options]
//   node kaif-core.mjs check                       # validate the deployed manifest (bundle must still exist) + size budgets of the re-read core (advisory)
//   node kaif-core.mjs report bugs/KAIF/NN_x.md    # deliver a KAIF-defect ticket to the origin via gh (standing authorization, issue #15) and write the URL back
//   node kaif-core.mjs verify-final               # checkpoints done? then self-clean the install artifacts
//   node kaif-core.mjs sync                        # re-sync per-system skill mirrors from .claude/skills/
//   node kaif-core.mjs diff [--source <x>]         # audit disk vs deployed templates | preview vs another version
//   node kaif-core.mjs adopt-current               # rebuild the snapshot after a MANUAL migration
//   node kaif-core.mjs version                     # report the deployed version from .kaif/kaif.json
// Unknown commands, flags and stray arguments REFUSE (exit 1) instead of being silently
// ignored — a plausible-but-wrong run is the most expensive kind (bug 33, field report Г10).
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
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, unlinkSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------- CLI
const args = process.argv.slice(2);
// A bare or flags-only run means HELP, never install (bug 33 — THE field data loss: a curious
// bare run defaulted to `install` and overwrote a live update task; the loader always names
// `install` explicitly, so nothing legitimate relied on the old default).
const IMPLICIT_CMD = !args[0] || args[0].startsWith('-');
const CMD = IMPLICIT_CMD ? 'help' : args[0];
const val = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const has = (f) => args.includes(f);

const BUNDLE = val('--bundle') || '.kaif/install/KAIF-CORE-BUNDLE.md';
// --lang takes an ISO 639-1 code — and a mistyped value used to DISABLE the language pack
// silently (bug 92.1): `--lang Russian` deployed an all-English tree, wrote "russian" into the
// marker and printed a false "no bundled template for this language yet" while the ru pack sat
// in the bundle. Every language value — CLI or inherited from a marker — passes checkedLang:
// a real code without a pack stays legal (the honest English-first note is the designed path),
// a language NAME suggests its code, anything else refuses loudly with the bundled-pack list.
const ISO_639_1 = new Set(('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu').split(' '));
const LANG_NAME_HINTS = { english: 'en', russian: 'ru', 'русский': 'ru', arabic: 'ar', german: 'de',
  deutsch: 'de', spanish: 'es', 'español': 'es', espanol: 'es', french: 'fr', 'français': 'fr',
  francais: 'fr', hindi: 'hi', japanese: 'ja', portuguese: 'pt', 'português': 'pt', portugues: 'pt',
  chinese: 'zh-Hans', mandarin: 'zh-Hans' };
function checkedLang(raw, from) {
  const v = String(raw).toLowerCase();
  if (ISO_639_1.has(v.split('-')[0])) return v;   // zh-Hans-style script/region suffixes ride on a valid base
  const hint = LANG_NAME_HINTS[v];
  die(`unknown language value from ${from}: "${raw}" — ${hint ? `that is a language NAME; its ISO 639-1 code is "${hint}"` : 'not an ISO 639-1 code'}. ${from === '--lang' ? '' : 'Heal the marker by re-running the command with an explicit --lang <code>. '}Bundled packs: en ar de es fr hi ja pt ru zh-Hans; any other real code deploys English-first with an honest note in the task.`);
}
// LANG/AGENTS/MODE are `let`: post-install commands inherit them from the project's
// .kaif/kaif.json unless explicitly overridden on the CLI (see below for MODE/ANON).
// The CLI value is validated just below the log/die helpers (checkedLang needs die live).
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
// Crash journal (field ask, plan 77 U′2): written AFTER the backup and BEFORE the first
// tree mutation of an update, deleted as the update's last act. A run killed mid-flight leaves
// either an untouched tree or a VISIBLE journal — a half-updated tree without a trace cannot
// exist by construction. `resume` restores the pre-update tree from the journal's backup.
const UPDATE_JOURNAL = '.kaif/update-journal.json';
const TASK_FILE = 'KAIF_ADAPTATION_TASK.md';
const FENCE = '`'.repeat(6);

// The canonical deploy-time placeholders (KAIF.md §11). CORE fills what it can
// detect mechanically; the rest lands in the adaptation task for the agent.
const PLACEHOLDERS = ['<PROJECT_NAME>', '<SHORT_NAME>', '<AUTHOR>', '<REPO_URL>', '<LOCAL_PATH>',
                      '<LICENSE>', '<BUILD_COMMAND>', '<TEST_HARNESS>', '<COMMIT_COMMAND>', '<YOUR AGENT/MODEL>',
                      "<YOUR AGENT'S noreply EMAIL>",   // bug 28: shipped by /end-chat (now /end-chat-soft), was invisible to the gate
                      '<OWNER_LANGUAGE>'];

// Docs seeded/owned by the OWNER after deploy — an update never touches them and never
// even lists them as "diverged" (their divergence is the whole point of their existence).
const OWNER_SEEDED = ['GOAL.md', 'STATUS.md', 'PROJECT_HISTORY.md', 'EXPERIENCE.md', 'MASTER_PLAN.md',
  'PROJECT_STRUCTURE_EXTERNAL_MAP.md', 'PROJECT_ARCHITECTURE_INTERNAL_MAP.md', 'KAIF_FRAMEWORK.md'];
// A wholesale-verdict CANDIDATE path — the same three tests classifyAndApply applies before its
// modular merge (an md file · not owner-seeded · not skipped by anonymity). `diff --source` judges
// by this ONE predicate so the rehearsal it records and the update's receipt count the same files
// (2.6, UR1; origin #42 side observation: the preview recorded 16 verdicts, the receipt 15 —
// MASTER_PLAN.md is owner-seeded and never a candidate of the update, and the canon promised the
// two lists "compare line by line").
const wholesaleCandidatePath = (p) => p.endsWith('.md') && !OWNER_SEEDED.includes(p) && !isSkippedAnon(p);
// Where update fetches the fresh machinery from (mirrors KAIF-LOADER.mjs).
const SOURCES = { release: `${ORIGIN}/releases/latest/download`,
                  main: 'https://raw.githubusercontent.com/MikalaiKryvusha/KAIF/main/dist' };
const UPDATE_TASK = 'KAIF_UPDATE_TASK.md';
// Size budgets of the RE-READ CORE (AGENT_GUIDE → Document taxonomy, tier 1), in lines. The
// STATUS target is the owner's (decision #27, 2.1: a SUMMARY of "now", not a chronicle; bugs/37 —
// the promised guard now exists as code). The other eight arrived with 2.5 (epic CN, field
// request: the context ritual costs O(canon) and the canon only grows — a 5.8k-line re-read
// core re-read hourly, STATUS at 6× its target with the debt acknowledged inside the file).
// `check` WARNS above a budget, never fails: the cure is move-out (chronicle, researches/, a
// house-rules file), not a bigger number. ONE place for the numbers — the canon points here.
// Since 2.7 (epic CB, origin issues #43/#45 + the field pain of three deployments) the budget is
// judged by the project's OWN lines, and each row carries the ADDRESS the overflow moves to: a
// warning that says "too long" without saying "where to" is a warning the agent cannot execute
// (AGENT_GUIDE → "The form of an obligation"). STATUS has its own address, because its overflow
// is closed history and the chronicle is where closed history lives.
// Since 2.8 (epic CK; a field judge's finding on the house-rules skeleton, and K16 of the 2.8 recon — STATUS had the chronicle as
// its ONLY address, while standing rules and reference tables are not closed history) every address names its FILE and the
// command that creates it: the house-rules file is copied from the shipped skeleton on first use. Plain single-quoted strings on
// purpose: the origin's budget door (tools/budget-gate.mjs → readBudgets) and the build's ceiling guard read this table as TEXT.
// Since 2.9 (epic SW, origin issue #113) the table names the FILE only: the command that creates it is added at PRINT time, and only
// while the file is absent — printed over a filled HOUSE_RULES.md, an obeyed «cp» overwrote the owner's rules with the empty skeleton
// (a field near-miss, 241 lines). Every printer of an address goes through overflowAddress().
// [TESTED: 2026-09-29 21:28 +03:00 · suite s16 (4b): with HOUSE_RULES.md present neither the warning nor the door prints «cp»; without it both do,
//  as before; red on v2.8 and on mutant M-SW4 (budget-mutants) — testcases/reports/2026-09-29_sw-delivered-wired.md]
const HOUSE_RULES_CREATE = ' (no file yet: cp .kaif/_house-rules-template.md HOUSE_RULES.md)';
const overflowAddress = (to) => (okOnDisk('HOUSE_RULES.md') ? to : String(to).replace('HOUSE_RULES.md', 'HOUSE_RULES.md' + HOUSE_RULES_CREATE));
const MOVE_OUT_ADDRESS = 'HOUSE_RULES.md for local rules, routes and tools · the chronicle PROJECT_HISTORY.md · researches/';
const DOC_BUDGETS = {
  'STATUS.md': { budget: 200, overflowTo: 'the chronicle PROJECT_HISTORY.md (move closed history VERBATIM — the /end-chat-soft bonsai trim) · HOUSE_RULES.md for standing rules and reference tables' },
  'GOAL.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'MASTER_PLAN.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'PROJECT_STRUCTURE_EXTERNAL_MAP.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'PHILOSOPHY.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'TESTING_FRAMEWORK.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'BUG_FIXING_FRAMEWORK.md': { budget: 300, overflowTo: MOVE_OUT_ADDRESS },
  'REQUIREMENTS_FRAMEWORK.md': { budget: 250, overflowTo: MOVE_OUT_ADDRESS },
  'AGENT_GUIDE.md': { budget: 1200, overflowTo: MOVE_OUT_ADDRESS },
};

// The budget RATCHET of the closing gate (2.8, epic CK; origin issue #84 — a field STATUS of 447 lines against 200, shrinking since
// the last closing, stopped every closing like a fresh overflow). The gate remembers, per document, the own lines it stood at ABOVE
// its budget at the last closing — BUDGET_BASELINE, committed with the closing, rewritten only by `check --gate-budgets`. A document
// above budget passes only while it SHRINKS, and the base tightens with it; growth stops, and so does a standstill (the origin
// owner's word the rule rests on: entropy must decrease, not increase — industry ratchets let an unchanged count pass, this one
// does not, on purpose). A document that crosses its budget with no base line stops: a new overflow is never free. The FIRST gate
// run of a version — no file yet, or one written under another version — records the debt and passes: debt that predates the
// ratchet, or that an update moved, is recorded, not punished. A document back under budget leaves the file ("the life goal of a
// baseline file is to not exist" — PHPStan); the file itself stays, because its presence is what makes the next overflow new.
// [TESTED: 2026-09-25 00:58 +03:00 · suite s16 section (6) green on the deployed copy; red on the 2.7 core through KAIF_DIST — 13 of 59,
//  every ratchet assert and only they; the six ratchet mutants M7–M12 of tools/sandbox/probes/budget-mutants.mjs red exactly on their
//  named addressees; report testcases/reports/2026-09-25_ck52-budget-ratchet.md]
const BUDGET_BASELINE = '.kaif/budget-baseline.json';
function budgetRatchet(overBudget, base, version) {
  const fresh = !base || base.version !== version;
  const was = fresh ? {} : (base.docs || {});
  const docs = {}; const verdicts = [];
  for (const o of overBudget) {
    if (fresh) { docs[o.doc] = o.own; verdicts.push({ ...o, pass: true, why: `debt recorded in ${BUDGET_BASELINE} (first gate of ${version}) — from the next closing it passes only while it shrinks` }); continue; }
    const before = was[o.doc];
    if (before === undefined) { verdicts.push({ ...o, pass: false, why: 'crossed its budget since the last closing — a new overflow is never free' }); continue; }
    docs[o.doc] = Math.min(before, o.own);
    if (o.own < before) verdicts.push({ ...o, pass: true, why: `shrinking ${before} → ${o.own} since the last closing — the base tightens` });
    else verdicts.push({ ...o, pass: false, why: o.own > before ? `grew ${before} → ${o.own} since the last closing` : `stood still at ${o.own} since the last closing — above budget every closing moves at least one line out` });
  }
  const sorted = Object.fromEntries(Object.keys(docs).sort().map((k) => [k, docs[k]]));   // canonical order: the file is diffed in review
  return { verdicts, next: { version, docs: sorted } };
}

// The budget MEASUREMENT of the re-read core (moved out of `check` in 2.8, epic CK, step CK5.6): `check` prints what it finds, and the
// update task measures the same numbers silently to name, ahead of time, where the first closing stops. `say` receives every line
// `check` prints, in order; the return value is the list the door (budgetRatchet) judges.
function budgetOverflow(say) {
  // A declared ARCHIVE of the owner (2.8, epic CK; origin issue #84 — a field owner decided his GOAL.md is the verbatim append-only
  // archive of his words and the operative layer is a separate digest; the gate's only cure, "move content out", was exactly what his
  // decision forbids the agent). `.kaif/kaif.json` → "archives": { "<core document>": "<digest path>" } or { "digest": …, "owner":
  // "<where his word lives>" } — declared only by the owner, like canonArtifacts. The budget is then judged on the DIGEST and the
  // archive's size is printed as information, never a stop; a digest that is missing or does not name its archive leaves the archive
  // judged as before (researches/33 §7, fourth item). The judge hunts an archive declared without the owner's word.
  // [TESTED: 2026-09-25 01:12 +03:00 · suite s16 section (7) green; red on the 2.7 core 5 of its 6 asserts (the sixth — an undeclared
  //  archive warns — is the old behaviour); mutants M13–M15 of tools/sandbox/probes/budget-mutants.mjs red exactly on their addressees;
  //  report testcases/reports/2026-09-25_ck53-owner-archive.md]
  let archives = {};
  try { archives = readJson(KAIF_JSON).archives || {}; } catch { archives = {}; }
  const archiveOf = (doc) => {
    const a = archives && typeof archives === 'object' ? archives[doc] : null;
    if (!a) return null;
    return typeof a === 'string' ? { digest: a, owner: '' } : { digest: String(a.digest || ''), owner: String(a.owner || '') };
  };
  const fileLines = (p) => readFileSync(p, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
  // The deployed template's length per budgeted document (2.8, epic CK, the third fork of researches/33 §7: a file translated wholesale is
  // measured in the SAME lines, and the room for it is the template's reserve — the warning names that room and where local sections go).
  // A manifest written before 2.8 has no `templateLines`: the warning then keeps its 2.7 wording, never an invented number.
  // [TESTED: 2026-09-25 01:30 +03:00 · s16 section (5): the warning of a file translated wholesale names the template's length (equal to
  //  the deployed file before translation) and the room to the budget; red on the 2.7 core; mutant M16 of tools/sandbox/probes/budget-mutants.mjs
  //  red on exactly that assert; report testcases/reports/2026-09-25_ck54-translated-measure.md]
  let templateLines = {};
  try { if (okOnDisk(DEPLOY_MANIFEST)) templateLines = readJson(DEPLOY_MANIFEST).templateLines || {}; } catch { templateLines = {}; }
  const overBudget = [];
  for (const [doc, { budget, overflowTo }] of Object.entries(DOC_BUDGETS)) {
    if (!okOnDisk(doc)) continue;
    const arch = archiveOf(doc);
    if (arch) {
      const digestOk = arch.digest && okOnDisk(arch.digest) && readFileSync(arch.digest, 'utf8').includes(doc);
      if (digestOk) {
        const dl = fileLines(arch.digest);
        say(`ℹ ${doc}: a declared archive of the owner (${fileLines(doc)} lines — information, never a stop); its digest ${arch.digest} carries the budget: ${dl} of ~${budget}${arch.owner ? '' : ` — the declaration names no owner's word: write "archives": { "${doc}": { "digest": "${arch.digest}", "owner": "<where his word lives>" } }`}`);
        if (dl <= budget) continue;
        overBudget.push({ doc, own: dl, budget, overflowTo });
        say(`⚠ ${doc}: own lines ${dl} of budget ~${budget} (the digest ${arch.digest} of a declared archive — the operative text, every line counts) — move content OUT to ${overflowAddress(overflowTo)}, rather than raise the budget (AGENT_GUIDE → Document taxonomy, tier 1)`);
        continue;
      }
      say(`ℹ ${doc}: declared an archive, but its digest ${arch.digest ? `${arch.digest} ${okOnDisk(arch.digest) ? `does not name ${doc}` : 'is missing'}` : 'is not named'} — the archive is judged as a document until the digest exists and points to it`);
    }
    const { total, own, basis } = ownLines(doc);
    if (own <= budget) continue;
    overBudget.push({ doc, own, budget, overflowTo });
    const how = basis === 'cut' ? `${total} lines on disk, ${total - own} of them arrived with KAIF and are not counted`
      : basis === 'owner-seeded' ? `${total} lines on disk, all of them yours — this is an owner-seeded document whose shipped skeleton the project wrote over, so there is no arrived canon to subtract`
      : basis === 'translated' ? `${total} lines on disk, translated wholesale — arrived canon cannot be told from your own lines, so every line counts as yours${typeof templateLines[doc] === 'number' ? `; the shipped template is ${templateLines[doc]} lines, which leaves ≈ ${Math.max(0, budget - templateLines[doc])} for your translation's growth and your own adaptation — local sections belong in HOUSE_RULES.md` : ''}`
      : `${total} lines on disk, no deployed module cut for this file — every line counts as yours`;
    say(`⚠ ${doc}: own lines ${own} of budget ~${budget} (${how}) — move content OUT to ${overflowAddress(overflowTo)}, rather than raise the budget (AGENT_GUIDE → Document taxonomy, tier 1)`);
  }
  return overBudget;
}

// Where the FIRST closing after an update stops (2.8, epic CK, step CK5.6; N12 of the 2.8 scope recon — the 2.7 update brought the
// budget door and its task never measured it, so the first closing after the update stopped on it in the field: four documents in
// one deployment, STATUS 447/200 in another). The update task runs the machine gates of the closing ritual (/end-chat-soft) over the
// tree the update just wrote, READ-ONLY, and names each verdict: the budget door through the same measurement and ratchet that
// `check --gate-budgets` uses (the base file is read, never written), and the two lint modules the ritual calls, where they are
// deployed, through their own `check` (read-only by contract; exit 1 = a stop, exit 3 = not judged). A forecast, not a gate: the
// merges ahead move the numbers, so the checkpoint measures again, and update-verify never fails on it — a budget is a reading
// cost, not a broken deployment.
// [TESTED: 2026-09-25 09:03–09:10 +03:00 · suite s16 section (10): the item names the door with the numbers `check` prints, a repeated lesson class
//  and an attribution finding as STOPS, writes no base, comes TRUE on the real gates of the same tree, the checkpoint re-measures,
//  a clean tree has no stop, and the hand-over at `checkpoint recheck`; red on the 2.7 core; mutants M21–M27 of
//  tools/sandbox/probes/budget-mutants.mjs red on their addressees; functional run — clones of four field deployments on 2.7, both
//  routes, forecast = real gate 24 of 24 (tools/sandbox/probes/ck56-field-forecast.mjs) — testcases/reports/2026-09-25_ck56-closing-gates-forecast.md]
const CLOSING_LINTS = [
  ['lesson journal', '.kaif/tools/kaif-experience-lint.mjs', null],   // its baseline never silences a repeated class — no baseline step
  ['decision attribution', '.kaif/tools/kaif-attribution-lint.mjs', '.kaif/attribution-lint.baseline.json'],
];
const CLOSING_LINT_TIMEOUT_MS = 120000;   // method constant: a lint over a large field tree takes seconds; a hung one must not hang the update
const CLOSING_LINT_SHOWN = 3;             // method constant: finding lines quoted per stopping lint — its last line always carries the count
function closingGatesForecast(version, out = {}) {
  const lines = [];
  out.unbaselined = [];
  const door = '`node .kaif/kaif-core.mjs check --gate-budgets`';
  let base = null, unreadable = false;
  if (existsSync(BUDGET_BASELINE)) { try { base = readJson(BUDGET_BASELINE); } catch { unreadable = true; } }
  if (unreadable) lines.push(`budget door (${door}) — STOPS: ${BUDGET_BASELINE} is unreadable; restore it from git`);
  else {
    const { verdicts } = budgetRatchet(budgetOverflow(() => {}), base, version);
    if (!verdicts.length) lines.push(`budget door (${door}) — open: every re-read core document is within its budget in own lines`);
    for (const v of verdicts)
      lines.push(`budget door (${door}) — ${v.doc}: own lines ${v.own} of budget ${v.budget} — ${v.pass ? 'passes' : 'STOPS'}: ${v.why}; the overflow moves to ${overflowAddress(v.overflowTo)}`);
  }
  for (const [name, mod, baseFile] of CLOSING_LINTS) {
    const cmd = `\`node ${mod} check\``;
    if (!okOnDisk(mod)) { lines.push(`${name} (${cmd}) — not deployed here: the closing has nothing to run for it`); continue; }
    const r = spawnSync(process.execPath, [mod, 'check'], { encoding: 'utf8', timeout: CLOSING_LINT_TIMEOUT_MS });
    const reds = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => l.startsWith('✖')).map((l) => l.slice(0, 240));
    if (r.status === 0) lines.push(`${name} (${cmd}) — passes`);
    else if (r.status === 1 && reds.length) {
      const shown = reds.length > CLOSING_LINT_SHOWN + 1 ? [...reds.slice(0, CLOSING_LINT_SHOWN), `… ${reds.length - CLOSING_LINT_SHOWN - 1} more`, reds[reds.length - 1]] : reds;
      lines.push(`${name} (${cmd}) — STOPS: ${shown.join(' | ')}`);
      if (baseFile && !existsSync(baseFile)) out.unbaselined.push([name, mod, baseFile]);
    }
    else if (r.status === 3) lines.push(`${name} (${cmd}) — not judged (exit 3, SKIPPED): the closing says so aloud and does not stop on it`);
    else lines.push(`${name} (${cmd}) — gave no verdict (exit ${r.status === null ? 'none — timed out' : r.status}): run it yourself before the closing`);
  }
  return lines;
}
// SW2 (2.9, origin issue #115): a lint that arrives with NO baseline stops the first closing on the project's INHERITED debt, and the
// field put that debt to the owner as a question. The module itself prescribes the cure — record the debt ONCE; the task makes that a
// step, no question: what KAIF delivers is accepted. Only where the forecast saw the lint STOP and no baseline exists yet, and only for
// a lint whose baseline IS the cure: the lesson journal's baseline never silences a repeated class, so it gets no such step.
// [TESTED: 2026-09-29 21:28 +03:00 · suite s16 (10): the lint-baselines item names the attribution lint only; its tick refuses without the
//  baseline and records with it; red on v2.8 and on mutants M-SW2 · M22; the lesson journal gets no step (the first edition named it, and the
//  suite refuted it) — testcases/reports/2026-09-29_sw-delivered-wired.md]
function lintBaselineItem(unbaselined) {
  if (!unbaselined.length) return null;
  return ['lint-baselines', `Record the project's INHERITED debt of ${unbaselined.map(([n]) => n).join(' and ')} ONCE, as the module prescribes — now, without asking the project owner (KAIF 2.9: what KAIF delivers is accepted): ${unbaselined.map(([, mod]) => `\`node ${mod} check --write-baseline\``).join(' · ')}. The lint arrived with no baseline (${unbaselined.map(([, , b]) => b).join(' · ')} absent), so the first closing would stop on lines written before this update; from here the baseline only shrinks and the closing stops on a NEW finding alone. Name the recorded counts in the field report.`];
}

const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };
// die() is right for sync paths — but process.exit() over LIVE undici handles trips a libuv
// assertion on win32, and the one real error arrives dressed as two: the printed ✖ plus an
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" banner (issue #10; probed 5/5 on
// Node v24 win32 — draining the response body alone does NOT clear it, only letting the event
// loop wind down does). Refusals that fire AFTER a network fetch die SOFTLY: same message,
// then a sentinel the dispatcher catches to set the exit code and let the loop drain (~300 ms).
const dieSoft = (s) => { console.error('✖ ' + s); const e = new Error(s); e.kaifDie = true; throw e; };
const okOnDisk = (p) => existsSync(p) && statSync(p).size > 0;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileSha = (p) => sha256(readFileSync(p));
const sh = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
// JSON reader tolerant of a UTF-8 BOM (Windows tools like PowerShell 5 write one).
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

// The CLI-passed --lang is validated the moment die() is live (bug 92.1; checkedLang above).
if (val('--lang')) LANG = checkedLang(val('--lang'), '--lang');

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
// Lines of a text the way `wc -l` counts a file that ends in a newline; the newline is taken by its code point.
const LF = String.fromCharCode(10);
const textLines = (s) => { const n = normEol(String(s)); return (n.endsWith(LF) ? n.slice(0, -1) : n).split(LF).length; };
// Two-part version compare (major.minor) — ONE definition (2.6, UR3; origin #44's own correction:
// the same closure lived twice, inside newsInterval and policyInterval, and the stale-claims
// filter that needed it had neither in scope).
const vnum = (v) => String(v || '0').split('.').map(Number);
const gt = (a, b) => { const [a1, a2 = 0] = vnum(a), [b1, b2 = 0] = vnum(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };

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

// SCRIPTS answers "is the owner's writing system present" — exact, cheap, and blind BY
// CONSTRUCTION for every language written in the Latin alphabet. Four Latin packs SHIP (de, es,
// fr, pt) and none of them had a row, so a German deployment had no protection at all: the
// wholesale net, the per-file freeze, the automatic `i18n` flag and the audit's `localized` class
// were every one of them off (bugs/66 №3). The table cannot be completed for those languages,
// because their writing system IS Latin — so the property has to be MEASURED, not looked up.
//
// The second axis measures what the net actually needs: does this text still speak the template's
// language? Prose-vocabulary overlap — the share of the disk's distinct words that also occur in
// the incoming template. Measured on the source repository before the threshold was chosen:
//   de/es/fr/pt packs vs their English source        0.059 … 0.346   (32 files)
//   English disk 2 releases old vs today's template  0.985 … 1.000   (11 files × v2.0 and v2.1)
// The threshold sits inside that gap, far from both sides. The axis runs ONLY where the table is
// silent AND the deployment is not English, so an English project keeps its previous behaviour
// byte for byte; and it errs toward "localized", i.e. toward KEEPING the owner's file, which is
// the safe direction for a net whose whole purpose is "no silent English takeover".
const OVERLAP_LOCALIZED_BELOW = 0.6;
const OVERLAP_MIN_WORDS = 12;      // below this a body carries no evidence either way — abstain
const PROSE_WORD = /[\p{L}][\p{L}\p{M}'-]{2,}/gu;
// Prose is what a HUMAN language claim can be made about; a command, a path or a flag is not
// (2.7, epic CB, plan 95 risk б). A localized skill quotes English machinery by the dozen — the
// language-mix axis strips fenced blocks and inline code spans before it counts a single token.
// BOUNDARY, observed and written down rather than assumed: an UNCLOSED fence is not stripped — the
// pattern needs the closing fence — so the code below it is counted as prose and the body can be
// named a mix. That is the fail-safe direction (a document with an unbalanced fence is broken in a
// way other gates already care about), and it is said here instead of in a claim that the axis
// "does not count code".
const stripCodeSpans = (t) => String(t)
  .replace(/^([`~]{3,})[\s\S]*?^\1[^\n]*$/gm, ' ')   // fenced blocks, closed by the same fence
  .replace(/`[^`\n]*`/g, ' ');                       // inline code spans (never across a newline)
const distinctWords = (t) => new Set(String(t).toLowerCase().match(PROSE_WORD) || []);
function proseOverlap(diskText, newText) {
  const disk = distinctWords(diskText);
  if (disk.size < OVERLAP_MIN_WORDS) return 1;          // no evidence → reads as the template
  const tpl = distinctWords(newText);
  let shared = 0;
  for (const w of disk) if (tpl.has(w)) shared++;
  return shared / disk.size;
}
function localizedAgainst(diskText, newText) {
  const re = SCRIPTS[LANG];
  if (re) return re.test(diskText) && !re.test(newText);
  if (!LANG || LANG === 'en') return false;
  return proseOverlap(diskText, newText) < OVERLAP_LOCALIZED_BELOW;
}

// The whole-file variant of the test is BLIND on skills (bug 31): machinery-appended trigger
// aliases put the owner's script into every frontmatter on BOTH sides, so no skill ever read as
// "translated" and the i18n flag protected nothing. Judge "is this file a translation" by the
// BODY only — the modules below the preamble.
function bodyLocalized(diskText, newText) {
  const body = (t) => splitModules(normEol(t)).filter((m) => m.signature !== '<preamble>').map(modText).join('\n');
  return localizedAgainst(body(diskText), body(newText));
}

// The alias tail applyLanguage appends to a skill's description is MACHINERY's, not the owner's:
// frontmatter comparisons must ignore it, or a trigger-pack change between versions makes every
// skill's preamble read as owner-edited forever — and an updated `description` never reaches the
// disk while the body merges on, leaving one file with two contradicting claims (bug 43,
// a field project's /dayloop: the routing field kept asserting the OLD rule the merged body had dropped).
const stripAliasTail = (t) => t.replace(/ Trigger aliases \([a-zA-Z-]+\): [^\n]*/g, '');

// A real translation keeps some TERM headings untranslated (a field deployment: KISS and DRY survived —
// 2 of PHILOSOPHY's 21), so the wholesale net tolerates up to this share of surviving base
// signatures instead of the old absolute "≤1" that read every real translation as English (bug 31).
const WHOLESALE_SURVIVOR_SHARE = 0.15;

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
// update-verify cannot drag a 425 KB bundle into history (field-caught in a field project, which trapped
// exactly that). The lines stay useful after self-clean — updates recur.
// [TESTED: 2026-08-07 · npm run test:core all 13 suites green — S1 (entries present right after
// install) + S4 (idempotent on update), re-run with the refresh-marker entry added]
// SW5 (2.9, origin issues #130 · #126, ideas/31 p. 5): the ROOT transients are ANCHORED (`/KAIF.md`) — an unanchored `KAIF.md` matched
// `.clinerules/kaif.md` and `.roo/rules/kaif.md` on a case-insensitive git (core.ignorecase=true, the git-for-Windows default) and any
// `sub/KAIF.md` everywhere, so a clone lost the deployed pointers; a bare line an older core wrote is rewritten IN PLACE to its anchored
// form — the owner's own lines and negations keep their order (appending `KAIF.md` at the end used to override the owner's
// `!.clinerules/kaif.md`) — and the file keeps its own line ends (K-R11). The contour's renders and its call phrase
// (`.kaif/.contour-tmp/`) and its window locks (`<decisionsDir>/*.lock`) join the set: they rode sweeping commits.
// [TESTED: 2026-09-29 21:46 +03:00 · suite s01 S9 on a git with core.ignorecase=true: the anchor, a bare line rewritten in place with the owner's
//  negation and CRLF kept, the contour's render and lock out of git status; red on v2.8; the functional run 2.8 → 2.9 — testcases/reports/2026-09-29_sw-delivered-wired.md, runs 11–13]
const IGNORE_ROOT_TRANSIENTS = ['KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK, 'KAIF_UPDATE_TASK.superseded.md', 'KAIF_ADAPTATION_TASK.superseded.md'];
function contourDecisionsDir() {
  try {
    const c = readJson(KAIF_JSON).contour;
    if (c && typeof c.decisionsDir === 'string' && c.decisionsDir.trim()) return c.decisionsDir.trim().replace(/\\/g, '/').replace(/^(\.\/)+|\/+$/g, '');
  } catch { /* no marker yet — the contour's default */ }
  return 'interviews/decisions';
}
function ignoreFirstWanted() {
  return ['.kaif/install/', ...IGNORE_ROOT_TRANSIENTS.map((n) => '/' + n),
    '.kaif/backup-*/',        // pre-update backups are rollback material, never history (field ask)
    UPDATE_JOURNAL,           // the crash journal is transient run state; it must be VISIBLE, not committed
    '.kaif/heartbeat.log',    // the guarded loop's pulse is runtime state, not history
    '.kaif/guarded-loop.json', // the guarded loop's armed boundary (2.5, CN4) — same class as the pulse; the origin once swept it into a commit
    '.kaif/refresh-marker.json',  // the context-refresh witness is session state, not history (AGENT_GUIDE → Context refresh)
    '.kaif/voice-marker.json',    // the voice-portrait load witness — the same class (2.7, epic VC: `kaif-voice-lint load`)
    '.kaif/contour-window/',      // the owner page's own browser profile IN THE PROJECT (2.7, epic LP, origin issue #66)
    '.kaif/.contour-tmp/',        // the contour's renders and the call phrase (2.9, #126) — a sweeping commit took a page of questions along
    contourDecisionsDir() + '/*.lock', // the contour's window locks (2.9, #126) — a killed server's lock stays on purpose (I29)
    '.kaif/update-rehearsal.json']; // the preview's recorded wholesale verdicts — consumed by the next update (2.5, P1)
}
function ensureIgnoreFirst() {
  const wanted = ignoreFirstWanted();
  const text = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const anchored = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (IGNORE_ROOT_TRANSIENTS.includes(s)) { lines[i] = '/' + s; anchored.push('/' + s); }
  }
  const norm = (s) => s.trim().replace(/^\//, '').replace(/\/$/, '');
  const have = new Set(lines.map(norm));
  const add = wanted.filter((w) => !have.has(norm(w)));
  if (!add.length && !anchored.length) return;
  const body = lines.join(eol).replace(/\s*$/, '');
  writeFileSync('.gitignore', (body ? body + eol : '') + (add.length ? add.join(eol) + eol : ''));
  if (anchored.length) log(`⟳ .gitignore: anchored to the project root — ${anchored.join(', ')} (an unanchored line hid a same-named file in any folder, #130)`);
  if (add.length) log(`+ .gitignore: ignore-first for ${add.join(', ')}`);
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

// The "N skills trigger-aliased" summary counts what is ON DISK, never what was planned
// (bugs/65 №1). The planning site (`applyLanguage`) cannot know the anonymity filter — that
// filter lives BELOW it, at the write — so an intent counter reported 35 while an anonymous
// install had written 31, and the same log four lines earlier admitted skipping the four
// ORIGIN_TIED skills. A counter incremented next to the write would drift again the moment a
// new filter appears between plan and write; reading the deployed skills back is the only
// form that cannot: the property is "the skill carries its alias line", so it is measured
// where that line either exists or does not.
const countAliasedOnDisk = () => {
  const dir = join('.claude', 'skills');
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, 'SKILL.md');
    if (okOnDisk(p) && readFileSync(p, 'utf8').includes(`Trigger aliases (${LANG}):`)) n++;
  }
  return n;
};

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
  // No alias counter lives here. The pack's key count was the first proxy (bug 34 / field report D3:
  // "34 skills trigger-aliased" while 23 carried aliases on disk); counting APPLIED rewrites here
  // was the second, and it drifted the same way as soon as the anonymity filter appeared below
  // this function (bugs/65 №1). The summary reads the deployed skills back — `countAliasedOnDisk`.
  for (const f of files) {
    if (f.path.startsWith('templates/languages/')) continue;          // templates are inputs, not outputs
    let entry = overrides.has(f.path) ? { path: f.path, content: overrides.get(f.path) } : { ...f };
    const skill = skillName(entry.path);
    if (skill && triggers && triggers[skill]) {
      entry.content = entry.content.replace(/^(description:[^\n]*?)(\s*)$/m,
        (_, d) => `${d.replace(/\s+$/, '')} Trigger aliases (${LANG}): ${triggers[skill]}`);
    }
    out.push(entry);
  }
  // `translated` is the pack size IN THE BUNDLE — the right input for "does a pack exist at
  // all" (the task's language item). The INSTALL SUMMARY may not print it: it counts the disk
  // via overridePaths at the summary site (bugs/99 №1 — same doctrine as countAliasedOnDisk).
  return { deploy: out, translated: overrides.size, overridePaths: [...overrides.keys()] };
}

// Frozen language packs (owner's decision #56, 2.3): eight packs stay in the bundle at their
// full 2.2 state and deploy as before, but receive no updates — en and ru are the maintained
// two. The freeze is DECLARED at deploy time, like the pack boundary below: a status the owner
// learns from the docs but not from the install that just used the pack would be a silent one.
const FROZEN_PACKS = ['ar', 'de', 'es', 'fr', 'hi', 'ja', 'pt', 'zh-hans'];

// The pack boundary is DECLARED at deploy time, not discovered post-factum (field: a new skill
// arrived as "a raw English body with a localized alias line glued on" and read as a defect;
// the packs are owner-doc-only BY DESIGN — the framework is English-first). One honest line
// names exactly what arrives in English and needs manual transfer if the owner wants it local.
//
// Since 2.7 (epic CB, criterion 3) this returns its lines instead of printing them, because WHERE
// they are printed decides how they READ. On the install road they used to be the first thing on
// the screen — before a single file was written and long before the success line — and a field
// reader took "INCOMPLETE BY DESIGN" for a refusal. cmdInstall now prints them AFTER "deployed
// mechanically": the same words, read as a note about a finished install instead of its verdict.
// The update road prints them where it always did — an update can die mid-flight, and a boundary
// declared before the tree is touched is better there than a boundary that may never be reached.
function packHonesty(files, deploy) {
  const out = [];
  if (LANG === 'en') return out;
  if (FROZEN_PACKS.includes(LANG)) {
    out.push(`⟳ language pack "${LANG}" is FROZEN at its KAIF 2.2 state (origin decision #56): it deploys as before but receives no updates — en/ru are the maintained packs. A frozen pack is revived on community demand: open an issue at the origin.`);
  }
  const prefix = `templates/languages/${LANG}/`.toLowerCase();
  let hasPack = false;
  const packed = new Set();
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    hasPack = true;
    if (lower !== prefix + 'skill-triggers.json') packed.add(f.path.slice(prefix.length));
  }
  if (!hasPack) return out;   // no pack for this language at all — the task's `language` item owns the honesty
  const enDocs = deploy.filter((f) => f.path.endsWith('.md') && !packed.has(f.path)
    && !/^\.claude\/skills\//.test(f.path) && !f.path.startsWith('.kaif/spheres/')
    && !f.path.startsWith('templates/languages/')).map((f) => f.path).sort();
  // The honest line names what ARRIVES — so it must apply the same anonymity filter the write
  // sites do (bugs/99 №2: "all 35 skill bodies" one line above "31 skills trigger-aliased" of
  // the same run; the 4 ORIGIN_TIED skills never land on an anonymous install).
  const skills = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path)).length;
  // The line names what to DO with the boundary, not only what it is (2.7, epic CB): a declared
  // limit with no address is a limit the reader can only accept. Both addresses are named — the
  // origin's tracker for a pack that should exist, and the project's own bugs/KAIF/ for a defect
  // in what did arrive, which the `report` command then delivers.
  out.push(`⟳ language pack "${LANG}" is INCOMPLETE BY DESIGN (the framework is English-first): it localizes ${packed.size} owner doc(s). Arriving in ENGLISH and needing manual transfer if you want them localized: ${enDocs.join(', ')} + all ${skills} skill bodies (their trigger aliases ARE localized).`);
  out.push(`  ↳ WHAT TO REPORT: a pack file that should exist for "${LANG}" but did not arrive, or a localized file that arrived damaged — file it as a KAIF defect in bugs/KAIF/NN_*.md and deliver it with \`node .kaif/kaif-core.mjs report bugs/KAIF/NN_*.md\`, or open it directly at ${ORIGIN}/issues. The boundary above is BY DESIGN and is not a defect — do not report it.`);
  return out;
}
const logPackHonesty = (files, deploy) => { for (const s of packHonesty(files, deploy)) log(s); };

// ---------------------------------------------------------------------------- placeholder autofill
// Detect real project values mechanically. Undetected placeholders stay literal and
// are listed in the adaptation task (they are the agent's cognitive work, not ours).
// The project's CANONICAL name lives in the CANON — the marker's `projectName`, recorded via
// the project-name command — never in a technical identifier (field: package.json/folder names
// are lowercase tech ids and landed in H1 headings: "# acme-tool — Project History" while the
// project's own canon spelled the name differently; identity is the owner's, so it is RECORDED,
// not guessed).
function canonicalName() {
  try { const n = readJson(KAIF_JSON).projectName; if (n && String(n).trim()) return String(n).trim(); }
  catch { /* not deployed yet */ }
  return null;
}

function detectValues() {
  let pkg = null;
  try { pkg = readJson('package.json'); } catch { /* none */ }
  const dir = process.cwd().replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'project';
  const name = canonicalName() || (pkg && pkg.name) || dir;
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
    // three steps, each its own tool call — an auto-mode permission classifier refuses a chain it passes step by step (2.9; origin #146)
    '<COMMIT_COMMAND>': 'git add -A, then git commit -m "<msg>", then git push — each its own tool call',
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
const stableValues = () => {
  const v = { ...detectValues(), ...snapshotValues() };
  // The canon outranks the frozen snapshot: recording `projectName` HEALS the placeholder map
  // on the next pass instead of freezing the tech id forever (the frozen-values doctrine of
  // bug 26 guards against re-DETECTION drift, not against the owner's explicit word).
  const canon = canonicalName();
  if (canon) {
    if (v['<SHORT_NAME>'] === v['<PROJECT_NAME>']) v['<SHORT_NAME>'] = canon;   // a distinct short form stays the owner's
    v['<PROJECT_NAME>'] = canon;
  }
  return v;
};

function fillPlaceholders(content, values, unresolved) {
  let out = content;
  for (const [ph, v] of Object.entries(values)) {
    if (!out.includes(ph)) continue;
    if (v) out = out.split(ph).join(v);
    else unresolved.add(ph);
  }
  return out;
}

// ── Hand-filled slots — DERIVED from the disk, never asked (2.6, UR2; origin #48 R2/R3) ────────
// Slots the machinery cannot fill at deploy time (<BUILD_COMMAND>, <TEST_HARNESS>, <YOUR AGENT/MODEL>…
// when package.json has no scripts) are filled BY HAND in the adaptation task — and from then on
// every file carrying them differed from its template, so each interval classified them as owner
// edits: three hand merges and one hand deprecation per interval for files the owner never touched,
// plus `update-verify` counting the template's slot lines as "promised upstream lines" (a weaker
// session would paste the placeholders back). The cure is arithmetic, not ceremony: read the fills
// off the disk by matching a template as a REGEX (each unfilled slot → one single-line capture
// group; a repeated slot → a back-reference to its first capture), then judge "untouched modulo
// fills" by the EXACT sha of the disk text with the fills folded back into their slots. A false
// positive is impossible by construction (the un-filled disk text IS the old template); a false
// negative lands on the safe side (the file stays "diverged", as in 2.5). The derived map is cached
// in the deploy manifest (`fills`) and re-derived when absent — an old manifest reads as before.
// [TESTED: 2026-09-05 · polygon s21 B1–B6 green (fills recognized «(2): <BUILD_COMMAND>, <TEST_HARNESS>»;
// /autoloop replaced with the fills kept and out of the task; /dayloop retired mechanically; no
// «promised upstream line … <BUILD_COMMAND>» from update-verify; `fills` in the manifest; the identity
// module equal to the incoming template makes no item) + s11 U1/U1s (a slot filled everywhere is
// filled in the declared sphere too; a slot filled nowhere still makes the placeholders item);
// red on the cb42039 core via KAIF_DIST: B1–B6 all ✖; the first draft LEARNED GARBAGE from literal
// slots (`<YOUR` / `AGENT/MODEL> …`) and matched the NEW template only — both caught by the polygon
// on the first run (s03 S10c, s21 B1/B5) and fixed here: literal-on-disk slots stay literal in the
// pattern, matching is per module and against the OLD template texts first]
const slotsIn = (text) => PLACEHOLDERS.filter((ph) => text.includes(ph));
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Match ONE template text (a module, normally) against its disk text. A slot the disk still carries
// LITERALLY is emitted as a literal, never as a capture — otherwise a lazy group happily split
// `<YOUR AGENT/MODEL> <YOUR AGENT'S noreply EMAIL>` at the space and "learned" garbage (polygon-caught
// on the first run). 2.8 (epic UP; origin issue #73): a capture MAY carry `<`/`>` — a fill like `pwsh build.ps1 -PackDir <pack>` is a
// command with its own argument placeholder, and excluding the brackets read it as no fill at all (every interval a hand merge); the
// garbage guard is exact instead: a captured value that contains a KNOWN slot token is rejected.
function matchFills(template, disk) {
  const slots = slotsIn(template);
  if (!slots.length) return null;
  const literalOnDisk = new Set(slots.filter((s) => disk.includes(s)));
  if (literalOnDisk.size === slots.length) return null;   // nothing was filled here
  const groups = new Map();
  const slotRe = new RegExp(`(${slots.map(reEscape).join('|')})`, 'g');
  let pat = '', last = 0;
  for (let m; (m = slotRe.exec(template)); ) {
    pat += reEscape(template.slice(last, m.index));
    const slot = m[1];
    if (literalOnDisk.has(slot)) pat += reEscape(slot);
    else if (groups.has(slot)) pat += `\\k<${groups.get(slot)}>`;
    else { const g = `s${groups.size}`; groups.set(slot, g); pat += `(?<${g}>[^\\n]+?)`; }
    last = m.index + slot.length;
  }
  pat += reEscape(template.slice(last));
  const hit = new RegExp(`^${pat}$`).exec(disk);
  if (!hit) return null;
  const out = {};
  for (const [slot, g] of groups) {
    const v = hit.groups[g];
    if (v && v.trim() && !slotsIn(v).length) out[slot] = v;   // never a value that carries a known slot token (2.8, #73)
  }
  return out;
}
// Fold the fills back into their slots — the inverse of fillPlaceholders for the hand-filled map.
function unfill(text, fills) {
  let out = text;
  for (const [slot, v] of Object.entries(fills || {})) if (v) out = out.split(v).join(slot);
  return out;
}
// The deployment's hand-filled map: the manifest's cached map first, then every deployed md file
// whose template still carries a slot after the deploy VALUES — matched MODULE BY MODULE (by
// signature), so an upstream change or an owner edit elsewhere in the file costs nothing. The
// template the disk was filled FROM is the OLD one (`oldTplTexts` — the previous release's own
// artifact), when in hand; the incoming template is tried as well and suffices wherever the module
// did not change. Templates that changed simply fail to match; the fills come from the ones that did not.
function deriveFills(deploy, values, cached, oldTplTexts = {}) {
  const fills = { ...(cached || {}) };
  const learn = (tplText, diskText) => {
    let diskBySig = null;
    for (const m of splitModules(tplText)) {
      const t = modText(m);
      if (!slotsIn(t).some((s) => !(s in fills))) continue;   // nothing new to learn from this module
      if (!diskBySig) diskBySig = new Map(splitModules(diskText).map((d) => [d.signature, modText(d)]));
      const d = diskBySig.get(m.signature);
      if (d == null) continue;
      for (const [s, v] of Object.entries(matchFills(t, d) || {})) if (!(s in fills)) fills[s] = v;
    }
  };
  for (const f of deploy) {
    if (!f.path.endsWith('.md') || !okOnDisk(f.path)) continue;
    let tpl = fillPlaceholders(f.content, values, new Set());
    if (ANON) tpl = anonymize(tpl);
    tpl = normEol(tpl);
    const old = oldTplTexts && oldTplTexts[f.path];
    if (!slotsIn(tpl).some((s) => !(s in fills)) && !(old != null && slotsIn(normEol(old)).some((s) => !(s in fills)))) continue;
    const disk = normEol(readFileSync(f.path, 'utf8'));
    if (old != null) learn(normEol(old), disk);
    learn(tpl, disk);
  }
  return fills;
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
// The pointer carries ONE rule of its own (2.7, epic RS — the origin owner's word): the context
// file is the first thing a session reads, and the entry ritual was named nowhere in it.
const RESUME_RULE = 'A message that opens with the word `resume` (or the /resume alias of your language) is an ORDER to run ' +
  '/resume in full before the rest of the message (`AGENT_GUIDE.md` → "A leading skill word is an order").\n';
const CONTEXT_POINTER =
  '# Agent rules\n\nThis project is KAIF-wrapped. Before every task read `AGENT_GUIDE.md` (the canon) and ' +
  '`STATUS.md` (current state); think per `PHILOSOPHY.md`; write requirements per `REQUIREMENTS_FRAMEWORK.md`; ' +
  'test per `TESTING_FRAMEWORK.md`; debug per `BUG_FIXING_FRAMEWORK.md`; execute ' +
  'tasks per the fable loop (`/fable-method`, `/fable-judge`).\n\n' + RESUME_RULE;
// Zoo Code's own pointer gained the rule in 2.9 (epic UT2, origin ticket #120: it never carried it, and its text never changed)
const ZOO_POINTER = '# KAIF\n\nRead `AGENT_GUIDE.md` before every task; keep `STATUS.md` current. ' +
  'Skills live in `.roo/commands/` (one `/command` per KAIF skill).\n\n' + RESUME_RULE;
// UT2 (2.9, criterion 17; origin ticket #120): a pointer is written ONCE (writeIfNew) and no update ever touched it again — a field jump
// 2.1 → 2.8 kept the 1.5 text in all four files, the Zoo Code pointer never got the resume rule. The texts every earlier release
// shipped — sha256 of the EOL-normalized text, taken by script from the release tags v1.5 … v2.8 (2026-10-16, session 82) — are
// UNTOUCHED pointers: the fresh core replaces them with this release's text; any other text is the owner's — never rewritten, named.
// [TESTED: 2026-10-16 11:56 +03:00 · suite s21 U2 — a v2.6 deployment from the tag updated by its own 2.6 core: recheck replaces the
//  three untouched pointers and names the edited CLAUDE.md, update-verify refuses until the owner's line is there, then every pointer
//  carries the rule; red on the dist of d5342b3 (3 of 3); probe sw-field-route over git clones of six live 2.8 deployments — the one
//  that jumped from 2.1 got all four replaced, three got the Zoo Code pointer, edited ones untouched; report
//  testcases/reports/2026-10-16_ut2-pointers-updated.md]
const POINTER_PAST_SHAS = new Set([
  'a1317e2b505c344a36428268efafb506063cd89b333eeb9c3b5387661dabc6fe',   // the pointer of v1.5–v2.1
  '1adcc50531db71683d37d40aee493a295d76171bd30c8eb8b5db7c8bb841d375',   // the pointer of v2.2–v2.6
  '3018e3139b96d01fe8dda24513b48f4f0347628b60cea5f013776f3a94870e35',   // the pointer of v2.7–v2.8 (= CONTEXT_POINTER of this release)
  '2a24ad9c5d7aff455a68ff7e7078339fd0bf5801c81837d6b61c77b8d8a23f7f',   // the Zoo Code pointer of v1.5–v2.8
]);
// The pointers this deployment's agent systems expect → [[path, this release's text]]
const pointerTexts = () => [['AGENTS.md', CONTEXT_POINTER], ...(AGENTS.includes('claude-code') ? [['CLAUDE.md', CONTEXT_POINTER]] : []),
  ...(AGENTS.includes('cline') ? [['.clinerules/kaif.md', CONTEXT_POINTER]] : []), ...(AGENTS.includes('zoo-code') ? [['.roo/rules/kaif.md', ZOO_POINTER]] : [])];
// Bring the pointers on disk up to this release: an untouched earlier text is REPLACED (its own line ends kept); an edited one without
// the resume rule is returned for the task to name — the machinery never rewrites the owner's text. `write=false` only reports.
function syncPointers(write = true) {
  const replaced = [], needRule = [];
  for (const [p, want] of pointerTexts()) {
    if (!okOnDisk(p)) continue;
    const raw = readFileSync(p, 'utf8'), text = normEol(raw);
    if (text === want) continue;
    if (POINTER_PAST_SHAS.has(normSha(text))) {
      if (write) { writeFileSync(p, raw.includes('\r\n') ? want.replace(/\n/g, '\r\n') : want); log(`↻ replaced ${p} — an untouched pointer of an earlier KAIF, now this release's text (it carries the resume rule)`); }
      replaced.push(p);
    } else if (!/\bresume\b/.test(text)) needRule.push(p);
  }
  return { replaced, needRule };
}
const POINTER_RULE_HINT = (paths) => `${paths.join(' · ')} — the context pointer(s) carry local edits and no resume rule; add this line to each (the owner's text stays as it is): «${RESUME_RULE.trim()}»`;

// Returns true when the template was actually written; false when an existing file was
// ADOPTED (kept as found). Adoption is provenance the deploy manifest must remember:
// for adopted paths the sha snapshot records the OWNER'S content, not a template — so a
// later `update` may never take "sha still matches" as permission to replace them
// (field-caught in a field project, 2026-07-17: 18 owner-adapted skills silently templated over).
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
    writeIfNew('.roo/rules/kaif.md', ZOO_POINTER);
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

// The task's placeholder item must name REAL addresses — the static text used to send the
// agent to ".claude/skills/" while the live slots sat in a sphere library or nowhere at all
// ("the first step toward ticking boxes without looking", three field reports). The scan lists
// deployed files that LITERALLY carry each slot; foreign sphere libraries are reference
// material and never gate (only the DECLARED sphere is a working surface), so only it may appear.
// The addresses come from the SAME predicate the final gate judges by (`placeholderSurfaces`,
// 2.5 — a field project's `bugs/KAIF/10`): a chronicle line quoting `<BUILD_COMMAND>` verbatim is history,
// not a slot, and the gate never asked for it — so the item must not send anyone to "fill" it.
// Canonical copies only: per-system mirrors re-sync from them at update-verify.
function unresolvedOnDisk(unresolved, deploy) {
  let declared = null;
  try { const s = readJson(KAIF_JSON).sphere; if (s && s !== 'TODO') declared = `.kaif/spheres/${s}.md`; } catch { /* no marker yet */ }
  const surfaces = [...placeholderSurfaces()].filter((p) => !/^\.(agents|grok|cline|roo)\//.test(p));
  return [...unresolved].map((ph) => {
    const paths = surfaces.filter((p) => okOnDisk(p) && readFileSync(p, 'utf8').includes(ph));
    // Issue #3 (gate-scope-wider-than-instruction): before the sphere is declared, the libraries
    // are rightly excluded above — but the ONE the agent will declare (the `sphere` item of this
    // same task) joins the placeholder gate the moment it is recorded, and a list that omits a
    // future member teaches the session to distrust the task's other lists. Name it as exactly
    // what it is: a member that joins later.
    if (!declared && deploy.some((f) => f.path.startsWith('.kaif/spheres/')
        && !f.path.endsWith('/_template.md') && f.content.includes(ph)))
      paths.push('.kaif/spheres/<sphere>.md — YOUR declared library joins this list the moment you run `sphere <name>`');
    return { ph, paths };
  }).filter((u) => u.paths.length);
}
// Honest cap per slot: name the first paths outright, count the rest (never a silent cut).
const fmtSlots = (list) => list.map((u) =>
  `${u.ph} → ${u.paths.slice(0, 6).join(', ')}${u.paths.length > 6 ? ` (+${u.paths.length - 6} more — grep it)` : ''}`).join(' · ');

// The non-machine work scopes an update must NAME (field: template-sphere sections never
// reached a locally-authored sphere; a project's own skeleton validator "knew 12 documents
// and 26 skills" two updates in a row) — computed against whatever baseline is in hand,
// silent when the baseline cannot honestly tell.
function updateScopes(old, deploy, deployedPaths, marker) {
  const oldTpl = (old && old.templateShas) || {};
  const SPHERE_TPL = '.kaif/spheres/_template.md';
  let sphereSync = null;
  const sphere = marker && marker.sphere;
  if (sphere && sphere !== 'TODO' && !deploy.some((f) => f.path === `.kaif/spheres/${sphere}.md`)
      && okOnDisk(`.kaif/spheres/${sphere}.md`) && Object.keys(oldTpl).length) {
    const tplNew = deploy.find((f) => f.path === SPHERE_TPL);
    if (tplNew && oldTpl[SPHERE_TPL] !== normSha(tplNew.content)) sphereSync = { sphere };
  }
  let skeletonDelta = null;
  const oldSkills = new Set(((old && old.paths) || []).map(skillName).filter(Boolean));
  if (oldSkills.size) {
    const newSkills = new Set(deployedPaths.map(skillName).filter(Boolean));
    const added = [...newSkills].filter((n) => !oldSkills.has(n)).sort();
    const removed = [...oldSkills].filter((n) => !newSkills.has(n)).sort();
    if (added.length || removed.length) skeletonDelta = { added, removed };
  }
  return { sphereSync, skeletonDelta };
}

// Pre-update backup (field ask): the framework surface as it stood BEFORE this interval's
// writes goes to .kaif/backup-<from>-<to>/ — zero-knowledge rollback material that works
// mid-merge too (git protects only committed states). Git-ignored (ignore-first); only the
// CURRENT interval's backup is kept — the previous one is replaced.
function backupTree(deploy, fromVer, toVer) {
  const dir = `.kaif/backup-${fromVer || 'unknown'}-${toVer}`;
  try {
    if (existsSync('.kaif')) for (const n of readdirSync('.kaif'))
      if (n.startsWith('backup-') && `.kaif/${n}` !== dir) rmSync(`.kaif/${n}`, { recursive: true, force: true });
    let copied = 0;
    for (const f of deploy) {
      if (!okOnDisk(f.path)) continue;
      const to = join(dir, f.path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(f.path));
      copied++;
    }
    if (copied) log(`+ pre-update backup: ${copied} file(s) → ${dir}/ (rollback material; git-ignored, replaced next interval)`);
  } catch (e) { log(`⚠ pre-update backup skipped: ${e.message}`); }
}

// ---------------------------------------------------------------------------- crash journal (plan 77 U′2, field ask п. 2)
// The update's writes are interleaved with classification, so a run killed mid-flight used to
// leave a HALF-UPDATED tree with no trace: marker and manifest still old, files partly new —
// and a naive re-run then classified every already-replaced file as owner-diverged. The journal
// closes that: written after the backup, BEFORE the first tree mutation; deleted as the last
// act of a successful run. While it exists, update/bootstrap REFUSE and name `resume`.
function writeUpdateJournal(from, to, source, route, deploy) {
  const born = [];
  for (const f of deploy) if (!isSkippedAnon(f.path) && !existsSync(f.path)) born.push(f.path);
  for (const p of expectedAgentArtifacts(deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path)).map((f) => skillName(f.path))))
    if (!existsSync(p)) born.push(p);
  const j = { from: from || '?', to, source, route, startedAt: localStamp(),
              backupDir: `.kaif/backup-${from || 'unknown'}-${to}`, born };
  writeFileSync(UPDATE_JOURNAL, JSON.stringify(j, null, 2) + '\n');
  log(`+ wrote ${UPDATE_JOURNAL} (crash journal — a run killed mid-flight stays visible; removed on success)`);
}
function clearUpdateJournal() {
  if (existsSync(UPDATE_JOURNAL)) { unlinkSync(UPDATE_JOURNAL); log(`- removed ${UPDATE_JOURNAL} (update completed — nothing to resume)`); }
}
function refuseOnJournal() {
  if (!okOnDisk(UPDATE_JOURNAL)) return;
  let j = {}; try { j = readJson(UPDATE_JOURNAL); } catch { /* unreadable journal is still a journal */ }
  die(`an update journal exists (${UPDATE_JOURNAL}): the previous update (${j.from || '?'} → ${j.to || '?'}, started ${j.startedAt || '?'}) died mid-flight and the tree may be half-updated. Run \`node .kaif/kaif-core.mjs resume\` to restore the pre-update tree from its backup, then re-run update — or delete the journal consciously if you already reconciled the tree by hand.`);
}

// resume — restore the pre-update tree recorded by the crash journal: every backed-up file
// returns byte-exact, files BORN by the dead run are removed, the journal is consumed.
function cmdResume() {
  if (!okOnDisk(UPDATE_JOURNAL)) die(`nothing to resume — no ${UPDATE_JOURNAL} (no crashed update is recorded here)`);
  const j = readJson(UPDATE_JOURNAL);
  const backup = j.backupDir;
  if (!backup || !existsSync(backup)) die(`the journal names backup ${backup || '(none)'}, which does not exist — mechanical restore is impossible; roll back with git (git status / git checkout) and delete ${UPDATE_JOURNAL} consciously.`);
  const walk = (dir) => {
    const out = [];
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, n.name);
      if (n.isDirectory()) out.push(...walk(p)); else out.push(p);
    }
    return out;
  };
  const backupAbs = join(process.cwd(), backup);
  let restored = 0;
  for (const src of walk(backupAbs)) {
    const rel = src.slice(backupAbs.length + 1);
    // A directory squatting on a file path (or vice versa) is an obstruction the crash may have
    // left — clear it rather than die half-way through a restore.
    if (existsSync(rel) && statSync(rel).isDirectory()) rmSync(rel, { recursive: true, force: true });
    mkdirSync(dirname(rel) || '.', { recursive: true });
    writeFileSync(rel, readFileSync(src));
    restored++;
  }
  let removed = 0;
  for (const p of j.born || []) {
    if (!existsSync(p)) continue;
    rmSync(p, { recursive: true, force: true });
    removed++;
  }
  unlinkSync(UPDATE_JOURNAL);
  log(`✔ resume: ${restored} file(s) restored byte-exact from ${backup}${removed ? `, ${removed} file(s) born by the dead run removed` : ''}; journal consumed.`);
  log(`➡ the tree is back at KAIF ${j.from || '?'} — re-run: node .kaif/kaif-core.mjs update`);
}

// ---------------------------------------------------------------------------- adaptation task
// The ONE cognitive deliverable left to the AI agent. Every item ends in a forced
// checkpoint line (the fable-method lesson: weak models follow rules at decision
// points, not rules in lists) that verify-final greps for mechanically.
// 2.8, epic CH (origin issue #78): the delivery sentence of the field-report item (install and update) — ONLY on tracking: origin, read
// from the marker; an unreadable marker omits it (the private direction). An anonymous deployment's task never reaches for the origin
// (s04 S13-M3 — the anonymous profile's invariant; the polygon caught the first edition, which wrote it for every deployment).
function fieldReportDelivery() {
  let tracking = null;
  try { tracking = readJson(KAIF_JSON).tracking; } catch { tracking = null; }
  return tracking === 'origin'
    ? " Open it with an H1 and, right under it, the line `**Delivered upstream:** NOT YET` (English, machine-read); DELIVER it in the same move — `node .kaif/kaif-core.mjs report reports/KAIF_UPDATES/<file>.md` writes the issue URL into that line (the KAIF owner's standing authorization, origin issues #15 and #78: no owner's approval is awaited)."
    : '';
}
function writeAdaptationTask(unresolvedLive, translated, meta, values = {}) {
  const needTranslate = LANG !== 'en' && translated === 0;
  const items = [];
  // 2.9 (origin tickets #143 · #145): the wired refresh timer fired on the owner's FIRST prompt after install — nothing had stamped the
  // witness; a field agent avoided it by re-reading the core during study and stamping it. The item says so; its tick EXECUTES the gate.
  items.push(['study', 'Study the project gradually and record findings (what it is, build/test commands, architecture) — this replaces the old KAIF_DEPLOYMENT_PLAN.md. Then re-read the nine re-read-core documents you deployed (AGENT_GUIDE.md → "Document taxonomy", tier 1) and stamp the refresh witness `.kaif/refresh-marker.json` — `{ "at": "<ISO now>", "docs": [<what you re-read>], "trigger": "ritual:install" }` — with the acceptance quote in the chat (AGENT_GUIDE.md → "Context refresh"): the wired refresh timer counts from it, and the tick of this item checks it.']);
  // Identity before content: the canonical name feeds every later fill, and identity is the
  // OWNER's — a lowercase package/folder name seeded into H1 headings misnames the project.
  if (!canonicalName() && values['<PROJECT_NAME>'])
    items.push(['project-name', `<PROJECT_NAME> was auto-filled with "${values['<PROJECT_NAME>']}" from a technical identifier (package.json/folder name) — a lowercase tech id is NOT the project's canonical name, and identity is the OWNER's, never the machinery's guess. Confirm the canonical name with the owner, record it: \`node .kaif/kaif-core.mjs project-name "<Name>"\` for an ASCII name, or \`--name-file <path>\` for any other script (a name in argv can be mangled by the shell; a mangled one is refused, but a wrong-yet-ASCII one would be recorded) — the marker and future fills heal; then correct any seeded headings carrying the wrong form.`]);
  // 2.8 (origin #107): a field agent filled the same slots by hand in four skill mirrors too — the checkpoint below re-syncs them
  if (unresolvedLive.length) items.push(['placeholders', `Fill the remaining placeholders at their REAL locations (each verified on disk at generation time; grep to be sure): ${fmtSlots(unresolvedLive)}. These are the canonical copies — the skill mirrors of the other agent systems re-sync from them at \`checkpoint placeholders\`, so never fill a mirror by hand.`]);
  items.push(['maps', 'Fill PROJECT_STRUCTURE_EXTERNAL_MAP.md and PROJECT_ARCHITECTURE_INTERNAL_MAP.md from your inspection. Keep them SHORT; write in 2-3 small edits, not one giant write.']);
  // Issue #4 (obligation-exists-but-no-deploy-step): the canon routes owner-text writing through
  // the voice portrait "when the project has one" — and no deployment step ever MADE the project
  // have one, so a field README shipped before the owner's voice arrived and the owner had to
  // intervene twice. The item stands BEFORE goal-plan — the first owner-facing text of the pass —
  // and the ignore decision travels in the same step (ignore-first is already canon: a public
  // repo + a quote-bearing portrait = the owner's private writing published).
  // 2.8 (origin #107): an owner with a full private portrait and its public snapshot left the agent guessing which one to install
  items.push(['owner-voice', 'Ask the owner whether a voice portrait exists (`AUTHOR_STYLOMETRY.md`; skill /owner-voice). If YES: install it at the project root (when the owner keeps two editions — a full private portrait and a public snapshot whose first line names it so — a PUBLIC repository takes the public snapshot, the edition made for publication), wire its machine minute into the build path of EVERY owner-facing text class you find (`node .kaif/tools/kaif-voice-lint.mjs check <files…>` inside the script that builds a sheet, a string table, a README section — a hit stops the build or is answered in the portrait\'s exception column; the portrait\'s §8 must be the TABLE the skeleton shows, greps as prose are SKIPPED), and when the repository is PUBLIC add it to .gitignore in the SAME step — a portrait may quote the owner\'s private writing. If NO: record the canonical line `no voice portrait` (with date) in AGENT_GUIDE.md → "Notes from the human", so no future session re-asks. Either way this item closes BEFORE any owner-facing text (GOAL wording, README) is written.']);
  items.push(['goal-plan', 'If GOAL.md is empty, seed it and ask the owner; derive MASTER_PLAN.md from GOAL.md (skill: /revision).']);
  items.push(['sphere', 'Pick the project\'s sphere (libraries ship in .kaif/spheres/; do NOT author a new document unless none fits) and record it by running `node .kaif/kaif-core.mjs sphere <name>` (e.g. `sphere programming`) — never edit .kaif/kaif.json by hand.']);
  if (needTranslate) items.push(['language', `Translate the owner-facing docs (GOAL.md, KAIF_FRAMEWORK.md, the directory READMEs) into "${LANG}" — no bundled template for this language yet. Keep agent-only docs in English.`]);
  items.push(['kaif-framework', 'Write KAIF_FRAMEWORK.md from its template: "KAIF, deployed here" + the deployment record (version, date, language, sphere, agents, mode).']);
  // Epic M (feedback loop): the install report is MANDATORY and written even when everything went
  // smoothly (deviations lead it, smooth is one line). Section SKELETON only — the genre canon
  // lives in reports/README.md; a full template body here would bloat the task (the field rake:
  // a 352-line task with 80 useful). The item names the origin ONLY on tracking: origin — fieldReportDelivery() (2.8, epic CH,
  // origin #78: there the report is delivered in the same move); an anonymous deployment's task never reaches for the origin.
  if (wantsWireHooks()) items.push(wireHooksItem());
  items.push(['field-report', `MANDATORY field install report (the framework's feedback loop — written even when the install went smoothly): create \`reports/KAIF_UPDATES/<PROJECT>_KAIF_${meta.version}_INSTALL_REPORT.md\`, strictly in English, terse. Sections (genre canon: reports/README.md): 1. Chronology with numbers · 2. Friction and rakes (verbatim evidence; an explicit framework defect/improvement also gets its own ticket — skill /report-bug, templates A/B) · 3. What confused a cold agent (top 3) · 4. Final state and judge verdict (run a /fable-judge pass over the install; every number is a command's output).${fieldReportDelivery()}`]);
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
function newsInterval(meta, fromVersion, prereleaseOf = null) {
  const byVer = meta.templateNotesByVersion;
  if (!byVer) return (meta.templateNotes || []).map((n) => `- ${n}`).join('\n') || '- (no template notes shipped with this version)';
  const vers = Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1));
  if (!vers.length) return '- (no template notes recorded for this interval)';
  // the version this tree was installed from BEFORE its release: its notes probably arrived already (2.8, origin #107); a pre-release
  // build carries the notes of that ONE version, so the versions below it keep their plain heading
  const head = (v) => (prereleaseOf && v === prereleaseOf
    ? `**${v}** (this deployment came from an unreleased build of ${prereleaseOf} — these changes are probably in place already: check each against the disk, do only what is missing):`
    : `**${v}:**`);
  return vers.map((v) => [head(v), ...byVer[v].map((n) => `- ${n}`)].join('\n')).join('\n\n');
}

// The build's identity in the deployment marker (2.8, origin #107): a field install from the origin's main between two releases
// recorded the LAST release's version, and nothing said which build it was, so the next update read the tree as plain <last release>.
// The bundle meta ships `build` — the source-tree fingerprint and `prerelease`, the version whose notes the build already carries
// while its version is raised only at that release. `install` and both update routes record both fields (a release build clears
// `prerelease`); the update to that version names the origin in its task and marks those notes as probably in place.
function recordBuild(marker, meta) {
  const b = meta && meta.build;
  if (b && b.sourceTree) marker.build = String(b.sourceTree).slice(0, 12); else delete marker.build;
  if (b && b.prerelease) marker.prerelease = String(b.prerelease); else delete marker.prerelease;
  return marker;
}
/** The pre-release a deployment came from, when this update reaches that version → { of, build } or null. */
// (light judge of #107, K-F2) only a pre-release NEWER than the marker's version counts: a field left behind — written by hand and then
// carried by a core that does not know it — never names a false origin on a later update
const prereleaseOrigin = (prev, toVersion) => (prev && prev.prerelease && gt(String(prev.prerelease), prev.version || '0')
  && !gt(prev.prerelease, toVersion) ? { of: String(prev.prerelease), build: prev.build || null } : null);

// The withdrawn-phrases item of an update task (2.8, epic CH; court RL 2.8 C-F2) — one builder for the task and for the hand-over
// at `checkpoint recheck` (light re-judge RL 2.8, J-F2: on the `update` route the task is written by the outgoing 2.7 core, which has
// no such item, so a withdrawal since 2.7 never reached a 2.7 deployment until the fresh core named it). → the item text, or null.
// The retirements (deprecations with `search` phrases) and the MOVES (a section moved to another file — `pattern`, 2.9 UT1) of the
// interval (from, to] — a withdrawal SINCE the deployment's own release counts (court RL 2.8, C-F2)
const withdrawnOf = (meta, fromVersion) => [...(meta.deprecations || []).filter((d) => Array.isArray(d.search) && d.search.length),
  ...(meta.moves || []).filter((m) => typeof m.pattern === 'string' && m.pattern)]
  .filter((d) => d.since && !gt(fromVersion || '0', d.since) && !gt(d.since, meta.version));
// UT1 (2.9, criterion 16; two field update reports): the machinery NAMES the places — a `git grep` the agent was told to run found
// nothing it was not looking for, and two long field jumps left links to a retired skill standing. One line per place of the project's
// own texts (`.md`/`.mdc` the walk sees) that still carries a retired phrase, with the successor. Not places: the records — the
// chronicle PROJECT_HISTORY.md and the field reports of past updates (reports/KAIF_UPDATES/) —, `.kaif/`, the installer's own task
// files and thin core, and a line the delivered bundle carries verbatim (upstream's own text — a retirement note). A phrase is matched
// as a WHOLE word: `/end-chat` is not a place inside `/end-chat-soft`.
// [TESTED: 2026-10-16 11:38 +03:00 · suite s04 S14d (UT1): two places named, the non-places silent (a hyphen continuation, the chronicle,
//  a past update report, `.kaif/`, 12 delivered lines with the phrase), recheck names the one left after an edit, criterion 16 — three
//  table-row pointers into a moved section and one /end-chat named, a pointer to the section itself not; red on the dist of d5342b3
//  (3 of 4) and on probes/ut1-mutants.mjs (M1 3 · M2 1); probe sw-field-route over git clones of six live 2.8 deployments — 13 · 1 · 2 ·
//  0 · 0 · 11 places, none in a record; report testcases/reports/2026-10-16_ut1-withdrawn-places.md]
const WITHDRAWN_SKIP = /^(\.kaif\/|reports\/KAIF_UPDATES\/|PROJECT_HISTORY\.md$|KAIF\.md$|KAIF_(UPDATE|ADAPTATION)_TASK(\.superseded)?\.md$)/;
const WITHDRAWN_PLACES_SHOWN = 40;          // the item prints this many places; the rest are counted, with the command that lists all
const WORD_CHAR = /[\p{L}\p{N}_]/u;
function phraseRe(p) {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${WORD_CHAR.test(p[0]) ? '(?<![\\p{L}\\p{N}_-])' : ''}${esc}${WORD_CHAR.test(p[p.length - 1]) ? '(?![\\p{L}\\p{N}_-])' : ''}`, 'u');
}
function withdrawnPlaces(meta, fromVersion) {
  const withdrawn = withdrawnOf(meta, fromVersion);
  if (!withdrawn.length) return null;
  const b = parseBundle(BUNDLE, true);
  const upstream = new Set();
  for (const f of (b && b.files) || []) for (const l of f.content.split('\n')) if (l.trim()) upstream.add(l.trim());
  // a phrase probe prints its phrase; a move probe prints the text it matched on the line
  // a move probe counts only with its `context` in the ±1-line window and without its `notWith` there, never in the `notWith` file
  const probes = withdrawn.flatMap((d) => d.pattern ? [{ p: null, re: new RegExp(d.pattern, 'u'), to: d.successor || 'none',
      ctx: d.context ? new RegExp(d.context, 'iu') : null, notWith: d.notWith || null }]
    : d.search.map((p) => ({ p, re: phraseRe(p), to: d.successor || 'none' })));
  const tree = kaifWalk(['.']);
  const places = [], succ = new Map();
  for (const f of tree.files) {
    if (!/\.mdc?$/i.test(f) || WITHDRAWN_SKIP.test(f)) continue;
    const text = readWalked(tree, f);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const win = () => lines.slice(Math.max(0, i - 1), i + 2).join(' ');
      const hit = probes.filter((q) => q.re.test(line) && (!q.notWith || (f !== q.notWith && !win().includes(q.notWith))) && (!q.ctx || q.ctx.test(win())))
        .map((q) => ({ ...q, p: q.p || line.match(q.re)[0] }));
      if (hit.length && !upstream.has(line.trim())) { places.push(`${f}:${i + 1} «${hit.map((q) => q.p).join('» · «')}»`); for (const q of hit) succ.set(q.p, q.to); }
    });
  }
  return { places, succ, notes: walkNotes(tree) };
}
// The list: one line per place, then the successor ONCE per phrase found (a long successor repeated on every line buried the places)
const fmtPlaces = (w) => !w ? '' : !w.places.length ? ' The machinery scanned the project\'s texts: no place carries these phrases.'
  : ` The machinery found ${w.places.length} place(s) (the records — the chronicle, reports of past updates — and lines the delivered templates carry verbatim are not places):\n${w.places.slice(0, WITHDRAWN_PLACES_SHOWN).map((p) => `    · ${p}`).join('\n')}${w.places.length > WITHDRAWN_PLACES_SHOWN ? `\n    · … and ${w.places.length - WITHDRAWN_PLACES_SHOWN} more — \`node .kaif/kaif-core.mjs checkpoint recheck\` lists what is left` : ''}\n${[...w.succ].map(([p, to]) => `    «${p}» → ${to}`).join('\n')}${w.notes.length ? '\n    ' + w.notes.join('\n    ') : ''}\n`;
function withdrawnPhrasesItem(meta, fromVersion) {
  const withdrawn = withdrawnOf(meta, fromVersion);
  if (!withdrawn.length) return null;
  return `Upstream WITHDREW a feature your own texts may still build on — the places are named below; give EVERY place a fate: ${withdrawn.map((d) => d.pattern ? `${d.reason} (${d.since}) — a place that sends its reader to the old section for a table row is re-pointed to ${d.successor}` : `${d.reason} (${d.since}) — search: ${d.search.map((p) => '"' + p + '"').join(', ')} → \`git grep -n -F ${d.search.map((p) => '-e "' + p + '"').join(' ')}\``).join(' · ')}. Fate by SIGNATURE: an order signed by the agent ([AI]) is removed as the agent's own decision; one signed by the owner ([OWNER]) goes to the owner as ONE question — never removed silently; a question in interviews/ the withdrawal made moot is withdrawn with \`node .kaif/tools/contour/review.mjs --mark-withdrawn <doc> <Q> --why "<the withdrawal>"\` — never answered on the owner's behalf — and a document whose every open question is withdrawn or implemented closes its status (the queue names it until then); a KAIF ticket it resolved takes \`**Delivered upstream:** resolved in origin ${meta.version}\`; a line that RECORDS the withdrawal itself (a history note, a lesson, \"the X line is no more\") stays as it is.${fmtPlaces(withdrawnPlaces(meta, fromVersion))}`;
}

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

// The "assertion surface" scan (plan 21 §3.5, field gap П9; re-cut in bugs/35 — the 2.1 field
// precision was ≈19 % and the noise trained operators to ignore the one guard written for the
// public storefront): a stale CLAIM is the FRAMEWORK's version token ADJACENT to a framework
// marker, outside the owner's quotes, dated journals and derivative mirrors.
// DELIBERATE RECALL TRADE (bugs/35 closure, L4 judge): precision is the gate here — a claim
// that is dated, quoted, parenthesized or far from the marker is now SKIPPED by construction
// (a real dated claim, a blockquote tagline, prose staleness far from the marker — the field project
// D11 "(с 1.5)" class — will be missed). The scan is an ADVISOR, not a blocker: the task item
// says "update each or state why", and the judge verdict carries the reasoning (decision #42).
function scanStaleClaims(fromVersion, toVersion, templateShas = null) {
  if (!fromVersion || fromVersion === toVersion) return [];
  // Knowledge directories and EXPERIENCE/HISTORY are JOURNALS OF THE PAST by definition — a line
  // "we updated to <old>" cannot be "updated to <new>" without lying; half the field scan's hits
  // were exactly that (bug 23 / field report K5), and a noisy guard teaches the agent to ignore it.
  // Agent-system mirrors are DERIVATIVE — the machinery itself re-syncs them from the canon,
  // yet they once ate 44 of 46 hits and the whole cap (bugs/35, field report Г4).
  const SKIP_DIRS = ['.git', 'node_modules', '.kaif', 'researches', 'interviews', 'homeworks', 'bugs', 'ideas',
                     'reports',   // dated field/audit journals — same noise class as the other knowledge dirs (bugs/35)
                     '.agents', '.grok', '.cline', '.roo'];
  // GOAL.md and the declared canon artifacts are the OWNER's documents: the scan once proposed
  // editing GOAL.md — a file the machinery itself declares untouchable (bugs/35, field report гр.3).
  // AUTHOR_STYLOMETRY.md is the same class (bugs/54): the owner's voice portrait is written by the
  // agent but ACCEPTED by the owner, and it LEGALLY carries version tokens — the corpus registry
  // names its sources' versions and the history journal records the versions the portrait changed
  // in. Declaring it in canonArtifacts also works (the line below), but that needs a manual owner
  // action and is unset by default — so the portrait is skipped by construction, not by opt-in.
  const SKIP_FILES = [UPDATE_TASK, TASK_FILE, 'KAIF.md', 'KAIF-LOADER.mjs', 'EXPERIENCE.md', 'PROJECT_HISTORY.md', 'GOAL.md', 'AUTHOR_STYLOMETRY.md'];
  try { for (const c of readJson(KAIF_JSON).canonArtifacts || []) SKIP_FILES.push(String(c).replace(/\\/g, '/')); }
  catch { /* no readable marker — nothing to widen */ }
  // A claim = the version token within a few characters of the framework marker. Mere
  // co-occurrence on one line is NOT a claim: "building Product 2.0 … KAIF leads the process"
  // is the PRODUCT's version — a project whose own version matches a KAIF release number once
  // turned this scanner into a false-positive generator (bugs/35, field report гр.3).
  // 2.6 (UR3; origin #44): the window is ANY version token strictly OLDER than the version being
  // installed — not only the one being replaced. A one-version window made the blind spot grow
  // with the age of the lie (a README badge stuck on 2.2 survived three green updates: no later
  // interval had fromVersion === "2.2"). Every exemption below stays exactly as it was; the
  // pair is judged per token found on the line (below; the 16-character window of the old adjacency rule stays, and its negative
  // guards still reject a LONGER version number — "21.6", "1.6.3", "1.60" — never a sentence period: "… KAIF 1.6." is a claim).
  const VERSION_TOKEN = /(?<!\d)(?<!\d\.)\d+\.\d+(?!\d|\.\d)/g;
  // 2.8 (epic SC; origin #75 · #91 · N3 · N4): a claim is a PAIR — the framework's word and a version that BELONGS to it. The gap between
  // them carries no other name and no conjunction: «KAIF and Acme Space 2.0» is the product's version (N3), «KAIF version 2.7» and
  // «**KAIF version** | 1.6» are claims (the Russian forms alike — the word sets below are data). A capitalized word in the gap is
  // another name unless it is a version word.
  const PAIR_CONJUNCTIONS = new Set(['и', 'или', 'а', 'с', 'and', 'or', 'with', 'vs', 'plus']);
  const PAIR_VERSION_WORDS = new Set(['v', 'ver', 'version', 'versions', 'release', 'версия', 'версии', 'версию', 'версией', 'релиз', 'релиза']);
  // `reverse` (the version BEFORE the word): a capitalized word right before KAIF is the release's codename — «2.7 «Audited KAIF»» is a
  // claim (the SC2 field run lost a real README line to the forward rule) — so there only a conjunction blocks
  // (SC4 F6) in reverse order a LOWERCASE word breaks the pair too — «2.0 on KAIF» is the product's version, the codename is capitalized;
  // «version 2.7 of KAIF» keeps its one linking word
  const pairGap = (gap, reverse = false) => !/[&+]/.test(gap) && (gap.match(/\p{L}+/gu) || []).every((w) => !PAIR_CONJUNCTIONS.has(w.toLowerCase())
    && (PAIR_VERSION_WORDS.has(w.toLowerCase()) || (reverse ? /^\p{Lu}/u.test(w) || w === 'of' : !/^\p{Lu}/u.test(w))));
  // judged from EVERY occurrence of the framework word (and of the version) separately — one regex over the line lost an overlapping
  // pair: in «/kaif-go — with KAIF 2.2» the first match took `/kaif` with the gap «-go — with KAIF » and hid the real pair (SC2 field run)
  // (SC4 F6) a capitalized non-version word RIGHT before a version names a product: «Acme Space 2.0 — KAIF-project», «The Acme 2.0
  // KAIF plugin» — the version is Acme's, whatever follows it
  const productBefore = (before) => { const w = (before.match(/(\p{L}+)\s+$/u) || [])[1]; return !!w && /^\p{Lu}/u.test(w) && !PAIR_VERSION_WORDS.has(w.toLowerCase()); };
  const pairCache = new Map();
  const isPair = (v, text) => {
    if (!pairCache.has(v)) {
      const e = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pairCache.set(v, { fwd: new RegExp(`^([^\\n]{0,16}?)${e}(?!\\d|\\.\\d)`), ver: new RegExp(`(?<!\\d)(?<!\\d\\.)${e}(?!\\d|\\.\\d)`, 'g'), rev: /^([^\n]{0,16}?)(?:kaif|каиф)/i });
    }
    const { fwd, ver, rev } = pairCache.get(v);
    for (const m of text.matchAll(/kaif|каиф/gi)) { const r = fwd.exec(text.slice(m.index + m[0].length)); if (r && pairGap(r[1])) return true; }
    for (const m of text.matchAll(ver)) { const r = rev.exec(text.slice(m.index + m[0].length)); if (r && pairGap(r[1], true) && !productBefore(text.slice(0, m.index))) return true; }
    return false;
  };
  // a script pin speaks the CODE's vocabulary (#91): a quoted old version assigned to (or compared with) an identifier that NAMES a pin —
  // `EXPECTED_VERSION`, `kaifVersion`, `REQUIRED_KAIF_VERSION`, `pinnedVersion` — in a script that names the framework; a bare `version`
  // is the product's own or an XML attribute (`'<?xml version="1.0"'` was named by the first cut on a real tree)
  // (SC4 F4) wider by the field's own spellings — FRAMEWORK_VERSION, KAIF_REQUIRED, kaifMin — and a `.version` compared with (or asserted
  // against) a quoted old version in a script that reads kaif.json: `assert.equal(marker.version, '2.7')`. The price, stated in plans/123
  // (FORK SC2, revisited): a project's own variable spelled like the framework's pin is named once and takes the marker.
  const PIN_ID = /[\w$]*(?:(?:kaif|framework)[\w$]*(?:version|required|min|pin)|(?:expected|required|pinned|min|target)[\w$]*version)[\w$]*['"]?\s*(?:[:=]|[!=]==?)/i;
  const scriptPin = (v, text, readsMarker = false) => {
    const lit = `['"\`]v?${v.replace(/\./g, '\\.')}['"\`]`;
    return (PIN_ID.test(text) && new RegExp(lit).test(text)) || (readsMarker && new RegExp(`\\.version\\s*(?:[!=]==?|,)\\s*${lit}`).test(text));
  };
  const RECORD_LABEL_FORMS = /^(?:kaif|каиф)[\s:]+(?:version|версия)(?!\p{L})|^(?:version|версия)[\s:]+(?:kaif|каиф)(?!\p{L})/iu;   // \b is ASCII-only — never after Cyrillic
  // D-F2 (court RL 2.8): the record row's label in EVERY language face of the delivery — the KAIF_FRAMEWORK.md templates of the ten
  // packs name it their own way ("KAIF-Version", "Version de KAIF", ...); a dated row under any of them is the record itself, not a
  // journal. Taken from the packs and written as escapes (no non-ASCII in the delivery's code); guard 5n of `tools/check-framework.mjs`
  // holds this list equal to the packs. `RECORD_LABEL.test` keeps its name and call — one predicate, the forms and the list together.
  const RECORD_LABELS = ['kaif version', 'kaif \u0938\u0902\u0938\u094d\u0915\u0930\u0923', 'kaif \u30d0\u30fc\u30b8\u30e7\u30f3', 'kaif \u7248\u672c', 'kaif-version', 'version de kaif', 'versi\u00f3n de kaif', 'vers\u00e3o do kaif', '\u0432\u0435\u0440\u0441\u0438\u044f kaif', '\u0625\u0635\u062f\u0627\u0631 kaif'];
  const RECORD_LABEL = { test: (label) => RECORD_LABEL_FORMS.test(label) || RECORD_LABELS.includes(label.toLowerCase()) };
  const CAP_FILES = 20;      // cap by FILES, not hits: a hit cap was once exhausted by one
  const byFile = new Map();  // directory before the walk reached the only real public claim (field report Г4)
  // 2.8 (epic SC; origin #77): the files are the ones git sees (kaifWalk) — nested copies once took the whole cap and one
  // broken link emptied the scan into "no lines found"; a skipped path and a failed walk are service lines, never silence.
  const tree = kaifWalk(['.']);
  for (const p of tree.files) {
    const n = p.slice(p.lastIndexOf('/') + 1);
    if (p.split('/').some((seg) => SKIP_DIRS.includes(seg)) || SKIP_FILES.includes(p)) continue;
    // Prose AND the project's own scripts (2.5, epic US; field wish plans/73 U2 p.4, a field
    // report p.14): a version pin in `package.json` scripts or a local guard asserting the OLD version
    // is the claim that bites hardest — it fails CI after a green update. Lock FILES carry no
    // claim of the project's own and are skipped — judged by the lock-file NAME, never by the
    // word "lock" anywhere in a name: BLOCKERS.md and lockstep.mjs are claims like any other
    // (court RL 2.5, E-H1: the by-word filter silently un-scanned prose 2.4 used to scan).
    const isProse = /\.md$/i.test(n);
    if (!isProse && !(n === 'package.json' || /\.(mjs|cjs|js|ts|sh|ps1|py|ya?ml|toml)$/i.test(n))) continue;
    if (!isProse && /lock.ya?ml$/i.test(n)) continue;   // pnpm-lock.yaml — the one lock format the script whitelist lets through
    // The chronicle's era volumes (PROJECT_HISTORY_<era>.md, the split its template prescribes)
    // are journals of the past exactly like the main file — judge-caught before the first split.
    if (/^PROJECT_HISTORY/.test(p)) continue;
    // A file byte-identical to the CURRENT template cannot carry a stale PROJECT claim — its
    // text is upstream's own prose (bug 30: ten hits were fable-judge's "added in KAIF 1.6").
    const text = readWalked(tree, p);   // unreadable → named by the walk's FAILED line, never a throw (SC4 F1)
    if (text === null) continue;
    if (templateShas && templateShas[p] && normSha(text) === templateShas[p]) continue;
    const lines = text.split('\n');
    const namesKaif = !isProse && (/kaif|каиф/i.test(p) || /kaif|каиф/i.test(text));
    const readsMarker = namesKaif && /kaif\.json/i.test(text);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(toVersion)) continue;
      // `%20` is a URL-encoded space: a shields.io badge writes `KAIF%202.2` and must read as
      // "KAIF 2.2", never as version "202.2" (origin #44's own README line, polygon-caught).
      const scan = line.replace(/%20/g, ' ');
      const older = [...new Set(scan.match(VERSION_TOKEN) || [])].filter((v) => gt(toVersion, v));
      if (!older.length) continue;
      if (/^\s*>/.test(line)) continue;          // blockquote = the owner's quoted word (bugs/35, field report Г5)
      // a 2.3 field wish (R2): a JUSTIFIED old-version mention re-flagged on EVERY interval,
      // forever ("minutes per update, forever"). The canonical marker `KAIF-VERSION-OK` (an
      // English greppable token, same family as [TESTED]/DONE) on the hit line or the line
      // right above it records the justification ONCE — <!-- KAIF-VERSION-OK: reason --> — (a TABLE ROW carries it inside the row, in
      // any cell: the line above a row is another row — 2.8, epic SC, finding K-R5) —
      // and the scan converges to zero instead of re-litigating history each time.
      // (SC4 F5) the line above a row is ANOTHER row — its marker excuses itself, never the row below it
      if (/KAIF-VERSION-OK/i.test(line) || (i > 0 && !/^\s*\|/.test(lines[i - 1]) && /KAIF-VERSION-OK/i.test(lines[i - 1]))) continue;
      // a dated record = journal/chronicle/decision row, not a claim (project B Г5, project A гр.4) // source-kept: two independent field reports
      // — judged OUTSIDE parentheses since 2.8 (origin #75): «Version KAIF 2.1 (released 2026-07-31)» in the deployment record is a claim,
      // and it lied four intervals behind the whole-line date rule
      // (SC4 F3) …and a ROW whose label names the framework's version is the record itself, whatever dates its other cells carry
      // («| **KAIF version** | 2.7 | deployed 2026-09-18 |» stayed silent in a real deployment record); in a script the date is
      // looked for outside its trailing comment (a pin with a dated comment was silenced)
      const recordRow = isProse && /^\s*\|/.test(line) && RECORD_LABEL.test(line.split('|')[1].replace(/[*_`]/g, '').trim());
      if (!recordRow && /\b\d{4}-\d{2}/.test(isProse ? scan.replace(/(?<!\])\([^)]*\)/g, '') : line.replace(/\s(?:\/\/|#).*$/, ''))) continue;
      if (p === 'STATUS.md' && /предыдущ|previous/i.test(line)) continue;   // history, not a claim
      // Attributions — "(KAIF 1.6)" naming the version a rule arrived with — are history, not
      // staleness (field report Г4: rewriting them would forge it); judge the line with its
      // parenthesized segments removed, so only unparenthesized adjacency counts as a claim.
      // In a SCRIPT parentheses are syntax, not attribution — `assert(v === 'KAIF 2.4')` IS the pin.
      // A parenthesis right after `]` is a markdown link/image TARGET, not an attribution — the
      // shields.io badge keeps its version inside exactly such a target (`![…](…KAIF%202.2…)`),
      // and stripping it hid origin #44's own README line from the scan (2.6, polygon-caught).
      let judged = isProse ? scan.replace(/(?<!\])\([^)]*\)/g, '') : scan;
      // a parenthesis WRAPPED onto the next line (N4 · K-R4: «(KAIF 2.6; origin issue #52; the» ⏎ «field owner …) and»): the head of a line
      // up to an unmatched `)` continues a parenthesis from above, and an unclosed `(` runs to the end of its line
      if (isProse) judged = judged.replace(/^[^(]*?\)/, '').replace(/(?<!\])\([^)]*$/, '');
      const claimed = older.find((v) => isPair(v, judged)) || (namesKaif ? older.find((v) => scriptPin(v, scan, readsMarker)) : undefined);
      if (!claimed) continue;
      if (!byFile.has(p)) byFile.set(p, []);
      // a token older than the one just replaced is NAMED — the reader must not assume fromVersion
      byFile.get(p).push(`${p}:${i + 1} — ${line.trim().slice(0, 100)}${claimed === fromVersion ? '' : ` (asserts ${claimed})`}`);
    }
  }
  const files = [...byFile.keys()];
  const hits = files.slice(0, CAP_FILES).flatMap((p) => byFile.get(p));
  if (files.length > CAP_FILES)   // honest truncation: "shown N of M", never a silent cut (field report Г4)
    hits.push(`shown ${CAP_FILES} of ${files.length} file(s) with hits — fix these, then re-run the scan (checkpoint stale-claims re-runs it)`);
  hits.push(...walkNotes(tree));
  return hits;
}

// Deprecations (plan 21 §3.5, field gap T10): a release may RETIRE artifacts that EARLIER
// releases deployed — the mechanism that replaced another mechanism owns the cleanup of its
// predecessor (a field project: a 1.2-era validator survived four versions printing false greens).
// Untouched instances are removed mechanically; locally edited ones go to the task.
// 2.5 (epic US; origin #32 R-D): a deprecation NAMES ITS SUCCESSOR wherever it is reported —
// "retired" without "use X instead" sent a field agent hunting — and the ones KEPT (local edits)
// are COUNTED, not just listed: the summary used to print only what was removed, so a tree that
// kept every deprecated artifact read as "nothing retired" instead of "N await you".
function handleDeprecations(meta, old, fills = null) {
  const out = { removed: 0, kept: 0, items: [] };
  for (const d of meta.deprecations || []) {
    if (!d.path || !existsSync(d.path)) continue;
    const reason = d.reason || 'deprecated upstream';
    const succ = d.successor ? ` → successor: ${d.successor}` : '';
    const tpl = (old.templateShas || {})[d.path];
    // untouched MODULO the hand-filled slots retires mechanically too (2.6, UR2; origin #48 R2: a
    // deprecated skill whose only local difference was its <BUILD_COMMAND> fill went to the hand)
    if (tpl && (fileShaNorm(d.path) === tpl || (fills && normSha(unfill(readFileSync(d.path, 'utf8'), fills)) === tpl))) {
      unlinkSync(d.path);
      out.removed++;
      log(`- retired ${d.path} (${reason})${succ}`);
    } else {
      out.kept++;
      out.items.push(`${d.path} — ${reason}${succ} (carries local edits: remove it yourself, or keep it consciously — the successor already ships)`);
    }
  }
  if (out.kept) log(`⚠ ${out.kept} deprecated artifact(s) kept — each carries local edits; the task names it with its successor`);
  return out;
}

// Policy changes in the (from, to] interval (Reference §10.6): a rule change never merges silently as an ordinary diff (field: the
// 1.6 language-policy change dissolved into a diff and the owner learned about it on an audit) — it is NAMED; since 2.9 (issue #114)
// it is accepted with the version, not put to the project owner as a question.
function policyInterval(meta, fromVersion) {
  const byVer = meta.policyChanges;
  if (!byVer) return [];
  const out = [];
  for (const v of Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1)))
    for (const p of byVer[v]) out.push(`[${v}] ${p}`);
  return out;
}

// Headings RENAMED since `fromVersion` (2.7, epic HO; origin issue #57), flattened into
// { path: [[old, new], …] }. Lower bound as for the policy changes: a tree that skipped three
// releases gets every rename of those three, in version order, so a heading renamed twice
// (A→B in 2.7, B→C in 2.8) is chased through both hops rather than read as two strangers.
// NO upper ceiling, on purpose (judge of epic HO, bugs/114): a policy note is prose and must stay
// inert until its release ships, but a rename pair is VALIDATED AGAINST THE SHIPPED TEMPLATE at
// the point of use (it only fires when the template carries the new heading and no longer the
// old one), so the ceiling bought no safety and opened a window — a tree updating from `main`
// between the rename and the version bump got the renamed headings with the map switched off,
// i.e. the very duplicate the map exists to prevent.
function renameInterval(meta, fromVersion) {
  const byVer = meta.renamesByVersion;
  if (!byVer) return {};
  const out = {};
  for (const v of Object.keys(byVer).filter((v) => gt(v, fromVersion || '0')).sort((a, b) => (gt(a, b) ? 1 : -1)))
    for (const [path, pairs] of Object.entries(byVer[v] || {}))
      for (const [o, n] of pairs) {
        out[path] = out[path] || [];
        const has = (a, b) => out[path].some(([x, y]) => x === a && y === b);
        // A heading renamed twice across the interval (A→B in one release, B→C in the next) keeps
        // BOTH hops plus the derived A→C: which one a given tree can use depends on where that tree
        // started, and only the merge (which sees the disk) can tell. Collapsing the chain here
        // would drop the hop a tree skipping only ONE release actually needs.
        const prior = out[path].find(([, mid]) => mid === o);
        if (!has(o, n)) out[path].push([o, n]);
        if (prior && !has(prior[0], n)) out[path].push([prior[0], n]);
      }
  return out;
}

// NEW files that arrived in English on a non-English deployment (2.5, epic US; field #28 R2:
// sixteen new skills landed English on a ru tree and the final line said nothing). Skills are
// agent-read and ship English by policy — the item is HONESTY about what arrived, not a defect.
function languageArrivalsOf(paths) {
  const re = LANG !== 'en' && SCRIPTS[LANG];
  if (!re) return [];
  return (paths || []).filter((p) => p.endsWith('.md') && okOnDisk(p) && !re.test(readFileSync(p, 'utf8')));
}

// ── Owner-voice snapshot sync (2.8, epic VO, the origin's plans/120 VO3; origin issue #103) ─────────────────────────────────────
// A project whose voice portrait DERIVES from the release's public voice snapshot — it names one of the markers the release's
// bundle meta lists (`ownerVoice.markers`: the public snapshot's own labels; the bundle, not the loader manifest: both update routes read it) — takes the new snapshot by REPLACEMENT, never a merge: the owner's word in issue #103
// («не мержем, а заменой»). The file's form after it: an optional LOCAL part (a project preamble, a genre shell re-derived over the
// new snapshot) ABOVE the snapshot's first line, then the snapshot byte for byte to the end — the checkpoint verifies that part by
// sha256 (LF), and the local part must carry no first line of a public snapshot (`ownerVoice.heads`): a previous snapshot kept above the
// new one is a merge (the VO4 judge kept a whole 1.x portrait above it, and the tail check alone passed it). A portrait that names none
// of the markers is not derived from the snapshot — another owner's, or a private copy of the core: no item, not a byte touched. The
// machinery reads markers and heads from the BUNDLE META and never knows whose voice it is.
// GAP: a merge that drops the previous snapshot's first line passes; a genre shell kept unchanged above the new snapshot passes — its
// re-derivation is the /owner-voice agent's judgement.
// [TESTED: 2026-09-25 17:19 +03:00 · s26 section (5) on the deployed core — the merge above the snapshot refused by the checkpoint and the hand-over, a private copy
//  untouched; mutants M9–M16 red on their addressees; field clones of three deployments: the judge's merge on a real portrait refused, a private
//  portrait kept out of git untouched on both routes; report testcases/reports/2026-09-25_vo4-epic-judge-fixes.md]
const PORTRAIT_FILE = 'AUTHOR_STYLOMETRY.md';
const lfSha256 = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
/** The part of a portrait from the snapshot's first line to the end (LF), or null when the line is absent. */
function snapshotTail(text, head) {
  // (court RL 2.8, A-F3) a leading BOM is an encoding mark, not content: with it the first line never equalled the snapshot's head,
  // and the refusal said the snapshot was missing while it was there
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const at = head ? lines.indexOf(head) : -1;
  return at < 0 ? null : lines.slice(at).join('\n');
}
/** A merge left ABOVE the snapshot: the local part — the lines before the snapshot's first line — carries the first line of a public
 *  snapshot (this release's or an earlier layout's, `pin.heads`), so a previous snapshot still sits in the file → that line, or null. */
function mergedAbove(text, pin) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const at = pin && pin.head ? lines.indexOf(pin.head) : -1;
  if (at < 0) return null;
  const heads = new Set([pin.head, ...(Array.isArray(pin.heads) ? pin.heads : [])]);
  return lines.slice(0, at).find((l) => heads.has(l)) || null;
}
/** The update's verdict on the project's portrait against the release pin → null (nothing to do) or { marker, was, … pin }. */
function portraitSync(pin) {
  if (!pin || !/^[0-9a-f]{64}$/.test(pin.sha256 || '') || !Array.isArray(pin.markers) || !pin.head || !okOnDisk(PORTRAIT_FILE)) return null;
  const text = readFileSync(PORTRAIT_FILE, 'utf8');
  const marker = pin.markers.find((m) => text.includes(m));
  if (!marker) { log(`· voice portrait: ${PORTRAIT_FILE} names none of the release snapshot's markers — not derived from it (another owner's portrait or a private copy), left untouched`); return null; }
  const tail = snapshotTail(text, pin.head);
  // NT2 (2.9, origin issue #133 — a field root file of 11 lines only POINTS at the private core, named in the marker's `voicePortrait`; it
  // names the private repository in its clone command, which is a snapshot marker, and the only passing move was to paste a 643-line copy
  // nothing reads): a root file with no snapshot line in it, while the marker names the portrait at ANOTHER path, is a POINTER — no item
  // (light judge of epic NT, F3) a file that carries the first line of an EARLIER layout's snapshot (`pin.heads`) is a portrait, not a
  // pointer; and a marker that names THIS file — by an absolute path, or in another letter case on Windows — names no other path
  // [TESTED: 2026-10-16 16:15 +03:00 · s26 «NT F3» ×2 green (100 checks); on the dist of f977156 exactly these two red]
  const carriesSnapshot = tail !== null || (Array.isArray(pin.heads) && pin.heads.some((h) => snapshotTail(text, h) !== null));
  if (!carriesSnapshot) {
    let vp = null; try { vp = readJson(KAIF_JSON).voicePortrait; } catch { vp = null; }
    const samePath = (p) => { const a = resolve(p), b = resolve(PORTRAIT_FILE); return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; };
    if (typeof vp === 'string' && vp.trim() && !samePath(vp.trim())) {
      log(`· voice portrait: ${PORTRAIT_FILE} is a POINTER — it carries no line of the release snapshot, and .kaif/kaif.json names the portrait at ${vp.trim()}; left untouched (origin issue #133)`);
      return null;
    }
  }
  const merged = mergedAbove(text, pin);
  if (tail !== null && lfSha256(tail) === pin.sha256 && !merged) { log(`✔ voice portrait: ${PORTRAIT_FILE} already carries this release's snapshot (sha ${pin.sha256.slice(0, 12)})`); return null; }
  if (merged) log(`· voice portrait: the local part of ${PORTRAIT_FILE} above the snapshot still carries «${merged}» — a merge, not a replacement`);
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const was = (new RegExp(`${esc}\\D{0,30}?(\\d+\\.\\d+)`).exec(text) || [])[1] || null;
  return { ...pin, marker, was };
}

/** The owner-voice instruction — ONE text for the task item and for the refusal of `checkpoint recheck` (the hand-over). */
function ownerVoiceInstruction(ownerVoice) {
  return `Your voice portrait \`${PORTRAIT_FILE}\` derives from this release's public voice snapshot (it names «${ownerVoice.marker}»; the core it carries: ${ownerVoice.was || 'not stated'}), and the release ships the snapshot of core ${ownerVoice.core || 'not stated'}. The owner's word (origin issue #103): REPLACE the snapshot, never merge it. (1) Fetch the release file: \`curl -fsSL ${ownerVoice.url} -o ${PORTRAIT_FILE}.release\` — its sha256 (LF) is ${ownerVoice.sha256}. (2) Keep ONLY your local part — the lines ABOVE the snapshot (a project preamble; a genre shell, re-derived over the new snapshot by /owner-voice) — and put the release file after it BYTE FOR BYTE, from its first line «${ownerVoice.head}» to the end; a project tool that stamps its own blocks INTO the portrait runs after this checkpoint. (3) Name it in the update report: \`voice portrait: core ${ownerVoice.was || 'not stated'} → ${ownerVoice.core || 'not stated'} (replaced)\`. The checkpoint verifies the snapshot part by sha256 and refuses until it matches.`;
}

function writeUpdateTask(diverged, meta, contextLine, opts = {}) {
  const { divergedModules = {}, ownerConvention = [], fromVersion = null, deprecations = [], staleClaims = [], translatedWholesale = [], unresolved = [], sphereSync = null, skeletonDelta = null, nameFallback = null, languageArrivals = [], verdictMismatches = [], modeSwitch = [], ownerVoice = null, prerelease = null, verdicts = {} } = opts;
  const policy = policyInterval(meta, fromVersion);
  const modFiles = Object.keys(divergedModules);
  // Checklists and decision tables inside framework files often carry the OWNER's recorded
  // state (ticked boxes, decision rows) — a merge that "cleans them up" erases his record.
  const OWNER_LINES = "Careful: checklists/tables in these files may carry the OWNER'S recorded state (ticked boxes, decision rows) — fold the template changes around them, never reset them.";
  const items = [];
  // SW (2.9, origin issue #114 — the KAIF owner's word in his field project: what KAIF delivers with an update is accepted without
  // questions): the rules below were decided by the author of the release and are ACCEPTED with the version — never a round of
  // questions to the project owner (three field interviews in a row answered "accept all"); what stays is the naming, so no rule is
  // merged SILENTLY, and one narrow question: a rule that collides with a decision the project owner recorded himself.
  if (policy.length) items.push(['policy-changes', `⚠ This interval CHANGES RULES of your previous version. The author of KAIF shipped them with this release, and they are ACCEPTED with the version — no question to the project owner about them (the KAIF owner's rule, 2.9). Never merge them silently: name each in the field report and in the farewell. A question to the owner is legal ONLY where a rule collides with a decision he recorded himself (an [OWNER] line), with the address of that decision in it:\n${policy.map((p) => `    · ${p}`).join('\n')}`]);
  if (modFiles.length) items.push(['merge-modules', `These MODULES need your merge — fold each diff below into your version (for ordinary files the rest was updated mechanically; for i18n-translated files NOTHING was applied — the diffs are the whole delivery; the file as YOUR language deploys it, the oracle of that hand merge: \`node .kaif/kaif-core.mjs diff --source <the receipt's source> --render <file>\`, and the same with the previous release as the source gives the base): ${modFiles.map((p) => `${p} (${divergedModules[p].length})`).join(' · ')}. ${OWNER_LINES}`]);
  // A translated-wholesale file names its upstream path and a READY diff command against the
  // origin's tags (2.5, epic US; field wish plans/73 U2 p.1, asked twice): for i18n deployments
  // the diffs ARE the delivery, and "find the upstream file yourself" was cognitive work per file.
  // The map dest → src ships in the bundle meta (`sources`); an older bundle without it degrades
  // to the note alone, never to silence.
  const upstreamOf = (p) => (meta.sources && meta.sources[p] && fromVersion)
    ? `; upstream: ${meta.sources[p]} — the same delta from the origin: git diff v${fromVersion} v${meta.version} -- ${meta.sources[p]}` : '';
  // UT4 (2.9; a field jump 1.2 → 2.8: three canon documents RETOLD in the owner's language, not one template heading in common —
  // `baseFound 0` — and the item offered only "merge by hand", 42 module diffs into the retelling): such a file names the second road
  // the field took — take this release's render whole and carry the project's facts over. A hint of the task, not a gate.
  const zeroBase = (p) => (verdicts[p] && verdicts[p].baseFound === 0)
    ? `; not one template heading survives (baseFound 0 of ${verdicts[p].baseN}) — a second road: take this release's render whole (\`node .kaif/kaif-core.mjs diff --source <the receipt's source> --render ${p}\` prints it in your language) and carry your project's facts over from the old text, when the delta below is more than you would keep` : '';
  if (diverged.length) items.push(['merge-diverged', `These framework files carry LOCAL edits and were NOT overwritten — merge the new template's changes into each by hand (real template deltas, where available, are in the Module diffs below): ${diverged.map((p) => translatedWholesale.includes(p) ? `${p} (translated wholesale — its headings are in the owner's language, a by-signature merge is impossible; its template delta ships below${upstreamOf(p)}${zeroBase(p)})` : p).join(' · ')}. ${OWNER_LINES}`]);
  // P1 (2.5, epic US; #27 R1): a file whose wholesale verdict differed between the recorded
  // rehearsal and this run was FROZEN — what the rehearsal showed the owner stays true, and both
  // number sets ride the item: the disagreement is the fingerprint of a classification that
  // depended on something other than the tree.
  const fmtVerdict = (v) => `${v.outcome} — baseFound ${v.baseFound} of ${v.baseN}, ceiling ${v.ceiling}`;
  if (verdictMismatches.length) items.push(['verdict-mismatch', `The wholesale verdict of these files DIFFERED between the recorded rehearsal and this run — each was FROZEN (kept intact; its template delta ships in the Module diffs below), so what the rehearsal showed you stays true: ${verdictMismatches.map((m) => `${m.path} (rehearsal: ${fmtVerdict(m.rehearsal)}; this run: ${fmtVerdict(m.live)})`).join(' · ')}. Merge each by hand from its diff, then file the mismatch WITH BOTH NUMBER SETS as a framework defect (skill /report-bug, template A) — it is the fingerprint of a classification that depended on something other than the tree.`]);
  if (ownerConvention.length) items.push(['owner-conventions', `The TEMPLATES of these owner documents changed their conventions in this release — carry the convention over WITHOUT touching the owner's content: ${ownerConvention.join(' · ')}`]);
  if (deprecations.length) items.push(['deprecations', `Upstream RETIRED these artifacts, but your copies carry local edits so nothing was removed mechanically — remove each yourself or keep it consciously: ${deprecations.join(' · ')}`]);
  // 2.8, epic CH (criterion 13; findings N10 · K12 · K13 · K-R1b): a WITHDRAWN feature leaves the project's own texts standing — a local
  // order built on it (signed by the agent, sometimes worn as the owner's), a question it made moot, a ticket it resolved. A deprecation
  // that retires a feature names `search` and `since`; this item lists the phrases of the (from, to] interval with each hit's fate.
  // (court RL 2.8, C-F2) a withdrawal SINCE the release this deployment is on counts too: that release's own update carried no phrase
  // search (the item arrived with 2.8), so its texts were never searched — the comparison used to be strictly newer and skipped it
  const wItem = withdrawnPhrasesItem(meta, fromVersion);
  if (wItem) items.push(['withdrawn-phrases', wItem]);
  // UT2 (2.9, criterion 17): a context pointer the owner edited is never rewritten — named, with the one line it lacks
  const ptrNeed = syncPointers(false).needRule;
  if (ptrNeed.length) items.push(['pointers', `${POINTER_RULE_HINT(ptrNeed)}. \`update-verify\` refuses while a pointer lacks it.`]);
  // P4 (2.5, epic US; #28 R3): the anonymous → origin switch cannot rewrite a file the owner edited,
  // so its text may still assert the OLD mode — name each one for a re-read instead of letting it
  // rot silently.
  if (modeSwitch.length) items.push(['mode-switch', `This run switched the deployment anonymous → origin. These files were deployed with the ANONYMOUS wording and were KEPT for local edits, so their text may still describe the old mode (no origin, no machinery core, no updates, no feedback loop): re-read each and re-point it to the standard wording — where the template itself changed, its diff is in the Module diffs below: ${modeSwitch.join(' · ')}`]);
  // New templates may arrive carrying deploy-time slots the machinery cannot fill (bug 28: the
  // update used to learn about them only when the FINAL gate failed, after "I'm done"). The
  // item names each slot's REAL on-disk addresses — the static ".claude/skills/" pointer sent
  // three field agents to files that carried no slot at all.
  if (unresolved.length) items.push(['placeholders', `New templates carry deploy-time slots the machinery could not fill — fill each at its REAL location(s), verified on disk at generation time (canonical copies; mirrors re-sync at update-verify): ${fmtSlots(unresolved)}`]);
  if (sphereSync) items.push(['sphere-sync', `Your declared sphere "${sphereSync.sphere}" is locally authored, and the framework's sphere TEMPLATE changed in this interval — the machinery never edits a local sphere: read the updated .kaif/spheres/_template.md and carry its new/changed sections into .kaif/spheres/${sphereSync.sphere}.md.`]);
  if (skeletonDelta) items.push(['local-inventories', `This release changes the framework skeleton: skills added: ${skeletonDelta.added.join(', ') || 'none'}; removed: ${skeletonDelta.removed.join(', ') || 'none'}. If this project keeps its OWN validators or inventories of the skeleton (doc/skill lists or counts in local tooling), update them — the machinery cannot know your tools; the machine-readable inventory is .kaif/deploy-manifest.json → "paths".`]);
  if (languageArrivals.length) items.push(['language-arrivals', `This deployment's language is ${LANG}, and these NEW files of the release arrived in ENGLISH: ${languageArrivals.join(' · ')}. Skills are agent-read and ship English by policy — translate only what the OWNER reads (or everything, if this project translates wholesale); leave the rest English consciously. Expect every future new file to arrive English the same way.`]);
  if (nameFallback) items.push(['project-name', `This deployment's <PROJECT_NAME> ("${nameFallback}") came from a technical identifier (package.json/folder), not from the canon — if the canonical name differs (a lowercase tech id in H1 headings is the symptom), record it: \`node .kaif/kaif-core.mjs project-name "<Name>"\` for an ASCII name, or \`--name-file <path>\` for any other script (argv can be mangled by the shell — the file form travels byte for byte), then correct mis-seeded headings (git grep the old form).`]);
  items.push(['review-news', 'Read the template news below; apply anything relevant to files this update could not touch mechanically.']);
  // stale-claims comes AFTER review-news: the news carry the history-migration instruction, and
  // the scan once flagged the very STATUS lines that migration moves two items later (bugs/35,
  // field report гр.4); the checkpoint re-runs the scanner, so the post-migration state is what counts.
  // #31 (2.5, epic US; field: the item was present in one run and absent in the next, and an
  // ABSENT item is indistinguishable from "nothing found" — a silent scanner failure would pass
  // as a clean tree): the item is UNCONDITIONAL on a version-changing update; an empty scan says so.
  // 2.8 (epic SC; origin #77): the walk's own lines (`walk: …` — a skipped broken link, a FAILED walk) ride under the claims and
  // never let "no lines found" stand for a tree the scan could not see.
  const claimHits = staleClaims.filter((h) => !h.startsWith(WALK_NOTE));
  const walkLines = staleClaims.filter((h) => h.startsWith(WALK_NOTE)).map((h) => `\n    · ${h}`).join('');
  if (fromVersion) items.push(['stale-claims', claimHits.length
    ? `These lines still assert an OLD version (older than ${meta.version}; the one just replaced is ${fromVersion} — a line stuck on an earlier one names it) — after the history migration from the news above, update each or state why it is correct. A line that is correct BY DESIGN (a rule's arrival version, a verbatim quote) gets the permanent justification marker on it or on the line above — \`<!-- KAIF-VERSION-OK: reason -->\`; in a TABLE ROW put it inside the row, in any cell (the line above a row is another row) — and stops re-flagging on every future interval:\n${claimHits.map((h) => `    · ${h}`).join('\n')}${walkLines}`
    : staleClaims.some((h) => h.includes('walk FAILED'))
      ? `the scan for claims of the OLD version (${fromVersion}) could NOT see the whole tree — this is not a clean result: fix what the walk names (a permission, a path), then re-run it (the checkpoint re-runs the scan):${walkLines}`
      : `no lines found — the scan for claims of the OLD version (${fromVersion}) ran over the tree and found nothing to update; recorded so that a silent scanner failure can never pass as a clean result (the checkpoint re-runs the scan)${walkLines}`]);
  // The closing gates, forecast (2.8, epic CK, step CK5.6 — see closingGatesForecast): UNCONDITIONAL, like stale-claims, so that
  // "nothing stops the first closing" is a printed verdict and never an absent item.
  if (ownerVoice) items.push(['owner-voice-core', ownerVoiceInstruction(ownerVoice)]);
  if (wantsWireHooks()) items.push(wireHooksItem());
  const gates = {}, forecast = closingGatesForecast(meta.version, gates);
  const baselineItem = lintBaselineItem(gates.unbaselined);
  if (baselineItem) items.push(baselineItem);
  items.push(['closing-gates', `The closing ritual (/end-chat-soft) runs these gates. Their verdicts over the tree as it stands NOW, after the mechanical pass (measured read-only — nothing was written); the merges ahead can move the numbers, and the checkpoint measures again. Where a line says STOPS, act before the first closing — move the content to the address the line names, fix the finding, or record the inherited debt with the command the lint names; a line that passes with debt recorded tells you what the NEXT closing will demand. The budget door \`node .kaif/kaif-core.mjs check --gate-budgets\` runs LAST — after \`update-verify\` has closed this task; run from inside the open task it writes nothing (UT3, 2.9):\n${forecast.map((l) => `    · ${l}`).join('\n')}`]);
  items.push(['recheck', 'Run `node .kaif/kaif-core.mjs check` — the deployed manifest must be 100% green.']);
  items.push(['judge', 'Run a /fable-judge pass over this update (versions in .kaif/kaif.json, nothing owner-authored lost, the merges real) — its verdict is quoted in the field report below and update-verify is not green without it (decision #46).']);
  // Epic M (feedback loop): the update report is MANDATORY, even for a smooth pass (deviations
  // lead it). Skeleton sections only (genre canon: reports/README.md — the 352-line-task rake);
  // sits between the judge pass and update-verify/commit so the report can QUOTE the verdict and
  // the gate greps its checkpoint. Never mentions the origin: delivery upstream is the skills'
  // business and must not leak into an anonymous deployment's task text.
  items.push(['field-report', `MANDATORY field update report (the framework's feedback loop — written even when the update went smoothly): create \`reports/KAIF_UPDATES/<PROJECT>_KAIF_${meta.version}_UPDATE_REPORT.md\`, strictly in English, terse. Sections (genre canon: reports/README.md): 1. Chronology with numbers (machinery counters, gates) · 2. Rakes — each with severity, verbatim evidence, cost, repro (an explicit framework defect/improvement also gets its own ticket — skill /report-bug, templates A/B) · 3. What was exercised vs NOT (honest list) · 4. Wishes for the next version (by cost, descending) · 5. Final state and the judge verdict quoted verbatim (decision #46).${policy.length ? ' Section 5 also names each rule of the policy-changes item above, one line per rule.' : ''} Every number is a command's output; every rake carries verbatim evidence.${fieldReportDelivery()} Then run \`node .kaif/kaif-core.mjs update-verify\`.`]);
  // 2.8 (origin #107): the tree came from a build of a version before its release — say so before the notes, never present them as news
  if (prerelease) items.push(['prerelease-origin', `This deployment was installed (or last updated) from an UNRELEASED build of ${prerelease.of}${prerelease.build ? ` (source tree ${prerelease.build})` : ''}: its marker said ${fromVersion || '?'} because a version is raised only at its release. The notes of ${prerelease.of} below describe changes that most likely arrived with that build — check each against the disk and do only what is missing; the per-module diffs of this task are computed from what was really deployed, so they stand as they are.`]);
  const news = newsInterval(meta, fromVersion, prerelease && prerelease.of);
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
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict-file <path-to-verdict.md>` (multiline, any language; or `--verdict "<ascii one-liner>"`)' : '`'}`),
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

// A bare github.com/<owner>/<repo> is the first thing a human passes as --source (three field
// projects did, issue #10) — and by itself it serves no artifacts: the old path died with an
// unhelpful 404 on <repo>/kaif-manifest.json. Resolve it to the repo's latest-release download
// base (the exact base `update`'s release channel already uses) and say so out loud.
function resolveSourceBase(src) {
  const m = src && src.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)\/?$/i);
  if (!m) return src;
  const base = `https://github.com/${m[1]}/${m[2]}/releases/latest/download`;
  log(`⟳ --source ${src} → ${base} (a bare repo URL resolves to its latest-release assets)`);
  return base;
}

// The failed-download refusal names the EXPECTED forms of --source: a 404 that prints only the
// URL it invented sends the human to guess the layout of a release page (issue #10 cost half a
// session naming one). One extra line closes that.
const SOURCE_FORMS_HINT = `  --source must be a base that serves kaif-manifest.json, KAIF-CORE.mjs and KAIF-CORE-BUNDLE.md directly:\n  a local directory with the three artifacts · ${ORIGIN}/releases/latest/download · ${ORIGIN}/releases/download/v<X.Y> · a bare https://github.com/<owner>/<repo> (auto-resolved to its latest release)`;

// Fetch one artifact for `update` (URL or local dir), mirroring the loader.
async function fetchArtifact(base, name) {
  if (!/^https?:\/\//.test(base)) {
    const p = join(base, name);
    if (!existsSync(p)) {
      // UT4 (2.9; a field long jump: `diff --source .kaif/install --render <file>` got only the generic forms): the install folder keeps
      // the bundle the loader fetched and is never a source — the refusal names the release this deployment's marker runs
      // the marker's own origin when it names one — a deployment that tracks a fork is sent to the fork's release (judge of UT+PV)
      let own = null, home = ORIGIN;
      if (resolve(base) === resolve('.kaif/install')) {
        try { const j = readJson(KAIF_JSON); own = j.version || '<X.Y>'; if (typeof j.origin === 'string' && /^https?:\/\//.test(j.origin)) home = j.origin.replace(/\/+$/, ''); }
        catch { own = '<X.Y>'; }
      }
      dieSoft(`not found in source: ${p}${own ? ` — .kaif/install/ keeps only the bundle the loader fetched and is not a source; the release this deployment's marker runs: ${home}/releases/download/v${own}` : ''}\n${SOURCE_FORMS_HINT}`);
    }
    return readFileSync(p);
  }
  let res;
  try { res = await fetch(`${base}/${name}`, { redirect: 'follow' }); }
  catch (err) {   // no-network/DNS failure: one refusal, not a raw stack (same issue #10 class)
    dieSoft(`download failed (${(err && err.cause && err.cause.code) || (err && err.message) || 'network error'}) — ${base}/${name}\n${SOURCE_FORMS_HINT}`);
  }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* draining a dead response is best-effort */ }
    dieSoft(`download failed (${res.status}) — ${base}/${name}\n${SOURCE_FORMS_HINT}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// The soft variant for OPTIONAL artifacts (the synthetic baseline): absence is an answer,
// not a death — the caller falls back to the classic path. A hung network must not hang the
// whole update for an OPTIONAL artifact (judge finding, phase L2) — hence the hard timeout.
const BASELINE_FETCH_TIMEOUT_MS = 30000;
async function fetchMaybe(base, name) {
  try {
    if (!/^https?:\/\//.test(base)) {
      const p = join(base, name);
      return existsSync(p) ? readFileSync(p) : null;
    }
    const res = await fetch(`${base}/${name}`, { redirect: 'follow', signal: AbortSignal.timeout(BASELINE_FETCH_TIMEOUT_MS) });
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* best-effort */ } return null; }   // same handle-drain as fetchArtifact
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

// The synthetic baseline (plan 21 §5.5, field gap П7): a pre-2.0 deployment carries no content
// snapshots, but the OLD version's own release artifact IS one — fetch it, run it through the
// same transform pipeline (language, fill, anonymize), and the blind adopt-everything legacy
// path becomes an ordinary modular update. Field prototype: a field project's kaif-baseline-diff.mjs.
// --baseline <dir|url> overrides the source (sandboxes; offline owners with a saved artifact).
async function buildSyntheticBaseline(legacyOld, purpose = 'baseline') {
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
    // A baseline claiming a DIFFERENT version than the deployment's own is not the previous
    // release — trusting it would silently eat real task items via the zero-delta filter
    // (judge finding, phase L2). Old-era artifacts without a manifest stay accepted as before.
    if (parsed.meta && parsed.meta.version && String(parsed.meta.version) !== String(ver)) {
      log(`⟳ baseline artifact at ${base} declares v${parsed.meta.version}, expected v${ver} — not the previous release, skipped`);
      continue;
    }
    const { deploy } = applyLanguage(parsed.files);
    const values = stableValues();   // frozen deploy values (bug 26) — the baseline must cut like the deploy did
    const un = new Set();
    const templateShas = {};
    const moduleShas = {};
    const templateTexts = {};                          // the OLD template texts — the missing half of every real diff (bug 32)
    for (const f of deploy) {
      if (isSkippedAnon(f.path)) continue;
      let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, un);
      if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
      templateShas[f.path] = normSha(content);
      templateTexts[f.path] = normEol(content);
      if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(content), (parsed.meta || {}).moduleClasses);
    }
    log(`⟳ synthetic baseline: v${ver}'s own ${name} (${Object.keys(templateShas).length} templates) — old template texts in hand for real diffs`);
    return { shas: {}, templateShas, moduleShas, templateTexts, kept: [], synthetic: true };
  }
  // The bootstrap over a SURVIVING manifest asks only for the old texts (2.6, UR5): its road stays
  // modular either way, so the honest line here is about the diffs' rendering, not about the road.
  if (purpose === 'texts') log(`⟳ no artifact of v${ver} reachable for the OLD template texts (${base}) — module diffs on this route show the incoming template only; pass --baseline <dir|url> with that version's artifacts to see −/+`);
  else log(`⟳ no baseline artifact reachable for v${ver} (${base}) — classic adopt-everything legacy path`);
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
// [TESTED: 2026-09-04 · polygon s18 U1/U1б: a pair whose BEGIN sits in a kept (diverged) H1 module
// and whose END rides a NEW prayer module comes out balanced — the prayer is rolled back and the
// task carries ONE `(anchored block KAIF:PRAYER)` item with the diff of both carriers; a new
// module whose insertion point falls inside a pair open on disk lands after the closing module
// (red on the 095c1c4 core: `PRAYER BEGIN=0 END=1` and `NEW@726 < END@5036`)]
// Anchored blocks — `<!-- KAIF:NAME:BEGIN -->` … `<!-- KAIF:NAME:END -->` (the creed, the prayer) —
// are INDIVISIBLE units (2.5, epic US; origin issue #27 R1b: a module merge landed the prayer's END
// without its BEGIN, a second field team saw upstream text arrive INSIDE a localized pair). This
// reads a document's markers fence-aware and names every pair that is unbalanced or out of order —
// exactly the shape a piecewise merge leaves behind. Returns { NAME: reason } for the bad ones only;
// the multi-line author-note comment (`KAIF:AUTHOR-NOTE`) is not a line marker and is not judged.
// ONE fence-aware scanner feeds both judges — `check`'s parity and the merge's indivisibility rule
// below (field report 10: two scanners of one thing drift apart; one predicate cannot).
function anchorMarkers(text) {
  const out = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    // a marker may carry a trailing note inside the comment (`<!-- KAIF:AUTHOR-NOTE:BEGIN — … -->`)
    const m = line.match(/^<!-- KAIF:([A-Z0-9-]+):(BEGIN|END)(?: [^\n]*)?-->$/);
    if (m) out.push({ name: m[1], kind: m[2] });
  }
  return out;
}
function unpairedAnchors(text) {
  const seen = {};
  for (const { name, kind } of anchorMarkers(text)) {
    const s = seen[name] || (seen[name] = { BEGIN: 0, END: 0, open: false, bad: null });
    s[kind]++;
    if (kind === 'BEGIN') { if (s.open) s.bad = s.bad || 'BEGIN inside an open pair'; s.open = true; }
    else { if (!s.open) s.bad = s.bad || 'END before BEGIN'; s.open = false; }
  }
  const out = {};
  for (const [name, s] of Object.entries(seen)) {
    if (s.bad) out[name] = s.bad;
    else if (s.BEGIN !== s.END) out[name] = `BEGIN=${s.BEGIN} END=${s.END}`;
  }
  return out;
}

// KAIF ticket 06 (a 2.3 field report): rewriting an EXISTING file keeps the file's dominant
// line-ending convention. On an autocrlf=true tree `update` used to write LF into a CRLF working
// tree — git normalizes on commit, so the REPO was unharmed, but any local guard comparing text
// blocks byte-exact across files on disk went transiently red right after a green mechanical
// pass ("the project stays whole at every step" broken in letter). New files stay LF: there is
// no convention to preserve. One helper covers merge and replace alike (the ticket's smallest fix).
// H10 (2.5, epic US; RL court 2.4 finding): the convention is judged by DOMINANCE, not by presence —
// one stray CRLF line used to flip a whole LF file to CRLF on the next mechanical replace (s18 U7:
// 218 of 218 lines). A tie (an evenly mixed file) keeps CRLF: the convention a Windows checkout
// would restore anyway; a file with no CRLF at all stays LF as before.
function writeMatchingEol(path, content) {
  let out = content;
  try {
    if (existsSync(path)) {
      const prev = readFileSync(path, 'utf8');
      const crlf = (prev.match(/\r\n/g) || []).length;
      const lf = (prev.match(/\n/g) || []).length - crlf;
      if (crlf > 0 && crlf >= lf) out = content.replace(/\r?\n/g, '\r\n');
    }
  } catch { /* unreadable target — write the content as-is */ }
  writeFileSync(path, out);
}

function mergeModules(path, newContent, oldMods, dryRun = false, oldTexts = null, fills = null, renames = [], prevProposed = null) {
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
  // Translated-wholesale net (bug 20 / field report K1): a file whose HEADINGS were translated matches
  // (almost) no baseline signature, so a by-signature merge would read it as "all owner-added"
  // and DOUBLE the document with the English template (field: 25 files, +6534 lines). If the
  // baseline's signatures are (all but one) gone from disk AND the disk body carries the owner's
  // script while the template body does not — this is a translation, not additions: hands off.
  // Bodies exclude <preamble> on purpose: machinery-appended trigger aliases put the owner's
  // script into every skill's frontmatter and would blind the test.
  const nonPre = (list) => list.filter((x) => x.signature !== '<preamble>');
  const bodyOf = (mods) => nonPre(mods).map(modText).join('\n');
  // The H1 is OUT of the wholesale count (bugs/100, 2.5): it is the one signature that carries a
  // deploy-time value (`# <PROJECT_NAME> — …`), and a synthetic baseline fills it from whatever
  // the folder resolves to — one tree in two folder names once got two verdicts, exactly ±1 at
  // the ceiling (the field's 20-vs-19). Bug 26 already treats an H1 mismatch as signature drift,
  // never as a translation; the count now says the same.
  const counted = (list) => nonPre(list).filter((x) => !/^# /.test(x.signature));
  const baseFound = counted(oldMods).filter((e) => diskMods.some((d) => d.signature === e.signature)).length;
  // On a TINY base (directory READMEs cut into 1 module) "≤1 matched" degenerates: an intact base
  // heading plus one owner-added section in the owner's script would read as a translation and
  // freeze the file with a lying task note (judge finding F1, s07/T6) — small bases demand that
  // NO base signature survives before the net may fire. On a real-size base the ceiling is a
  // SHARE of the base, not an absolute: real translations leave TERMS untranslated, and the old
  // "≤1" ceiling read a field project's 2-survivors-of-21 translation as English and doubled it (bug 31).
  const baseN = counted(oldMods).length;
  const wholesaleCeiling = baseN <= 2 ? 0 : Math.max(1, Math.floor(baseN * WHOLESALE_SURVIVOR_SHARE));
  // One predicate for both axes (bugs/66 №3) — the net used to re-implement the script test
  // inline, so widening `localizedAgainst` alone would have left this site Latin-blind.
  // P1 (2.5, epic US; field #27 R1: two runs on a byte-identical tree classified one file
  // differently and nobody could see WHY): the verdict carries the numbers that produced it —
  // for every candidate (a body in the owner's script), frozen or merged — so a rehearsal and the
  // live run compare line by line instead of by outcome. The freeze-on-mismatch half is US3.
  const localized = !!baseN && localizedAgainst(bodyOf(diskMods), bodyOf(newMods));
  const verdict = localized ? { baseFound, baseN, ceiling: wholesaleCeiling } : null;
  if (localized && baseFound <= wholesaleCeiling)
    return { translatedWholesale: true, verdict };
  // 2.7 (epic HO; origin issue #57): a heading RENAMED by this release. The module is addressed by
  // its signature, so without a declaration a rename reads as "removed upstream + new upstream" —
  // harmless for an untouched module (removed, then re-inserted), a silent DUPLICATE for a module
  // the owner edited, and wordless in the log either way (probe ho-rename-duplicate: 2 of 8 red).
  // The declaration is the bundle's rename map for this interval; nothing is ever guessed by
  // similarity — the same answer Django and Liquibase give to the same ambiguity.
  const renameTo = new Map();      // old signature (on disk) → new signature (in the template)
  const renameFrom = new Map();    // new signature → old, to suppress the duplicate insertion below
  const onDisk = new Set(diskMods.map((d) => d.signature));
  // Live pairs only: the template must carry the NEW heading and must no longer carry the old one
  // (both alive means two separate sections, not a rename).
  const declared = (renames || []).filter(([o, n]) => newBySig.has(n) && !newBySig.has(o));
  // Bind each target to the hop that is ACTUALLY on disk. The interval may offer several hops for
  // one target (a heading renamed twice, plus the derived end-to-end pair), and only one of them
  // names a section THIS tree has — binding by declaration order instead would pick the hop for a
  // tree that started somewhere else and leave the real section behind as a duplicate.
  for (const [o, n] of declared) if (onDisk.has(o) && !renameFrom.has(n)) { renameTo.set(o, n); renameFrom.set(n, o); }
  // 2.8 (epic UP; origin issue #72): the THIRD state of a declared pair — the old heading is gone from disk and the NEW one is already
  // there (the owner renamed the section in advance — the canon's «fix it locally first»). The pair binds too: the disk section is judged
  // against the OLD template module modulo its heading line. Until 2.8 this state lost upstream's delta silently while the log said
  // «the section arrives as new» — nothing arrived (the new heading was on disk, so the insertion loop skipped it).
  const renamedAhead = new Map();  // new signature (already on disk) → old signature (gone from disk)
  for (const [o, n] of declared) if (!onDisk.has(o) && onDisk.has(n) && !renameFrom.has(n) && !renamedAhead.has(n)) renamedAhead.set(n, o);
  const renamed = [];              // [{ from, to, outcome }] — named in the log and in the task
  // A declared rename whose OLD heading is nowhere on disk: the owner removed or translated that
  // section. Not an error and never a crash — the update says so by name (once per target) and the
  // new module takes the ordinary "new in this release" road.
  const renameMissing = declared.filter(([, n]) => !renameFrom.has(n) && !renamedAhead.has(n))
    .filter(([, n], i, a) => a.findIndex(([, m]) => m === n) === i)
    .map(([o, n]) => ({ from: o, to: n }));
  // A declaration whose OLD heading IS on this disk but whose NEW heading the template does not
  // carry (a typo in the declared pair, or a rename that was itself renamed again without a
  // record) — bugs/114, judge E4: silently dropping it hands the owner the very duplicate the map
  // exists to prevent, at exit 0. It cannot be repaired here; it is SAID, by name, and the build
  // guard upstream refuses to ship such a pair.
  const renameBroken = (renames || []).filter(([o, n]) => onDisk.has(o) && !newBySig.has(n) && !newBySig.has(o))
    .map(([o, n]) => ({ from: o, to: n }));
  let replaced = 0;
  const divergedList = [];
  const out = [];
  for (const dm of diskMods) {
    const dSha = normSha(modText(dm));
    const aheadFrom = renamedAhead.get(dm.signature);   // renamed in advance from this old heading (2.8, #72)
    const oldE = oldBySig.get(dm.signature) || (aheadFrom ? oldBySig.get(aheadFrom) : undefined);
    const asOld = aheadFrom ? modText(dm).replace(dm.signature, aheadFrom) : modText(dm);   // the disk text under its OLD heading
    const renamedTo = renameTo.get(dm.signature);
    const newM = newBySig.get(dm.signature) || (renamedTo ? newBySig.get(renamedTo) : undefined);
    // 2.8 (court UP6, R1 — Q-R4): a file merged without writes (i18n translated) keeps its old heading; the log says what the disk got
    if (renamedTo && newM) renamed.push({ from: dm.signature, to: renamedTo, outcome: oldE && dSha === oldE.sha256 ? (dryRun ? 'upstream delta in the task (i18n: translated) — nothing replaced on disk' : 'replaced') : 'kept (local edits — see the task)' });
    // Frontmatter is a named pseudo-module with one extra right (bug 43): equality with its old
    // template is judged MODULO the machinery-appended alias tail — the old text comes from the
    // baseline artifact and must agree with the deploy's own module snapshot before it is trusted.
    let untouchedMod = oldE && (dSha === oldE.sha256 || (aheadFrom && normSha(asOld) === oldE.sha256));
    // 2.6 (UR2; origin #48 R2): untouched MODULO the hand-filled slots — the module's disk text with
    // the fills folded back equals the old template module exactly (matchFills / unfill above).
    if (!untouchedMod && oldE && fills && normSha(unfill(asOld, fills)) === oldE.sha256) untouchedMod = true;
    if (!untouchedMod && oldE && dm.signature === '<preamble>' && oldTexts && oldTexts.has('<preamble>')) {
      const ot = oldTexts.get('<preamble>');
      if (normSha(ot) === oldE.sha256 && stripAliasTail(modText(dm)) === stripAliasTail(ot)) untouchedMod = true;
    }
    if (untouchedMod) {
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
        else { out.push({ signature: dm.signature, lines: [], was: dm }); replaced++; }   // empty entry = removed; `was` lets the pair rule below restore it
        continue;
      }
      const newText = fills ? fillPlaceholders(modText(newM), fills, new Set()) : modText(newM);   // the new template module with the deployment's own fills folded in (2.6, UR2)
      if (aheadFrom) renamed.push({ from: aheadFrom, to: dm.signature, outcome: dSha === normSha(newText) ? 'renamed in advance on disk — already current' : dryRun ? 'renamed in advance on disk — upstream delta in the task (i18n: translated)' : 'renamed in advance on disk — the new template module replaced it' });
      if (dSha === normSha(newText)) { out.push(dm); }                  // unchanged upstream too
      // The safety net never judges the preamble: machinery aliases make it carry the owner's
      // script by construction (bug 43) — the alias tail is preserved by the replacement below.
      else if (dm.signature !== '<preamble>' && localizedAgainst(modText(dm), newText)) {  // safety net (decision #17)
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'localized on disk — not replaced', diff: lineDiff(modText(dm), newText) });
      } else if (dryRun) {
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'upstream updated this module (not applied — i18n: translated)', diff: lineDiff(modText(dm), newText) });
      } else {
        // Replacing the frontmatter must not WIPE localization: if the disk carried an alias
        // tail and the incoming preamble has none (edge: language pack missing), carry it over.
        let text = newText;
        if (dm.signature === '<preamble>' && / Trigger aliases \(/.test(modText(dm)) && !/ Trigger aliases \(/.test(text))
          text = text.replace(/^(description:[^\n]*?)(\s*)$/m, (_, d) => d.replace(/\s+$/, '') + (modText(dm).match(/ Trigger aliases \([a-zA-Z-]+\): [^\n]*/) || [''])[0]);
        out.push({ signature: dm.signature, lines: text.split('\n'), was: dm }); replaced++;
      }
    } else {
      // owner/agent-edited, or a module the deploy never shipped (owner-added section) — keep.
      // A diff lands in the task ONLY when upstream ACTUALLY changed this module (a field update
      // report, finding F2: "diverged but upstream untouched" is zero work and must not make noise).
      out.push(dm);
      // A CONFLICT diff stays "your version → the new template" (the 2.0 canon, s02/S6): the
      // owner's edit must be visible as `-` lines right where the merge happens. Template→template
      // diffs are reserved for files whose DISK text shows nothing (translated/wholesale/absent).
      // 2.6 (UR2; origin #48 R3): a disk module ALREADY equal to the incoming template (fills folded
      // in) has nothing to merge — the sentence below used to fire when the deploy VALUES drifted
      // (project-name healing) and the task rendered an empty "upstream changed it" diff.
      const newFilled = newM ? (fills ? fillPlaceholders(modText(newM), fills, new Set()) : modText(newM)) : null;
      if (newM && dSha === normSha(newFilled)) { /* already the new template — nothing to hand over */ }
      else if (aheadFrom && newM) {
        // renamed IN ADVANCE and edited (2.8, #72): upstream's delta beyond the heading goes to the task — never lost, never inserted twice
        const upstreamChanged = normSha(modText(newM).replace(dm.signature, aheadFrom)) !== (oldE && oldE.sha256);
        renamed.push({ from: aheadFrom, to: dm.signature, outcome: upstreamChanged ? 'renamed in advance on disk AND edited — upstream delta in the task' : 'renamed in advance on disk AND edited — upstream changed only the heading, nothing to merge' });
        if (upstreamChanged) divergedList.push({ signature: dm.signature, note: `renamed IN ADVANCE on your disk (from "${aheadFrom}") AND carries local edits, and upstream changed the module — fold upstream's delta into your section by hand (nothing was inserted)`, diff: lineDiff(modText(dm), newFilled) });
      }
      else if (renamedTo && newM)
        // The renamed-and-edited case — the one the duplicate came from. Your section stays where it
        // is, under its old heading; the item carries the rename and the diff, and NOTHING is inserted.
        divergedList.push({ signature: dm.signature, note: `renamed upstream to "${renamedTo}" AND carries local edits — fold your edits into the renamed section by hand (nothing was inserted: a second copy under the new heading is exactly what this declaration prevents)`, diff: lineDiff(modText(dm), newFilled) });
      else if (oldE && newM && normSha(modText(newM)) !== oldE.sha256)
        divergedList.push({ signature: dm.signature, note: 'carries local edits AND upstream changed it', diff: lineDiff(modText(dm), newFilled) });
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
    // A renamed module is NOT new: its old heading is on disk and the loop above already decided
    // its fate (replaced in place, or kept with an item). Inserting it here is the duplicate.
    if (renameFrom.has(nm.signature) && diskMods.some((d) => d.signature === renameFrom.get(nm.signature))) continue;
    // A module absent on disk is inserted ONLY when it is genuinely NEW upstream — absent from
    // the previous release's template too. If the old template had it: unchanged upstream means
    // the absence is the OWNER's doing (translation or deletion) — never re-insert (bug 31: the
    // English doubling of translated files; the same gate kills the false "NEW module in this
    // release" items at zero upstream delta — bug 32, a field project's 19 phantoms); changed upstream
    // means the owner must reconcile — a diff, never a resurrection.
    const oldEIns = oldBySig.get(nm.signature);
    // 2.8 (epic UP; origin issue #92): absent AND unchanged upstream reads as the owner's deletion — unless the PREVIOUS update proposed
    // this very module and nobody merged it (its receipt's divergedModules): then it is offered again, never silently dropped.
    if (oldEIns && oldEIns.sha256 === normSha(modText(nm)) && prevProposed && prevProposed.has(nm.signature)) {
      divergedList.push({ signature: nm.signature, note: 'proposed by the PREVIOUS update and never merged — offered again (its absence is not your deletion: the previous task carried it)', diff: lineDiff('', modText(nm)) });
      continue;
    }
    if (oldEIns && oldEIns.sha256 === normSha(modText(nm))) continue;
    if (oldEIns) {
      const ot = oldTexts && oldTexts.has(nm.signature) && normSha(oldTexts.get(nm.signature)) === oldEIns.sha256
        ? oldTexts.get(nm.signature) : '';
      divergedList.push({ signature: nm.signature, note: dryRun
        ? 'upstream updated this module (not applied — i18n: translated)'
        : 'this module is absent from your copy (translated or removed locally) and upstream CHANGED it — reconcile by hand',
        diff: lineDiff(ot, modText(nm)) });
      continue;
    }
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
    // field report R2 (2.5, epic US): an insertion point INSIDE an anchored pair that is open at that spot
    // (a localized prayer cut into the owner's own headings) would land upstream text between the
    // owner's BEGIN and END — the point moves past the module that closes every open pair.
    at = pastOpenPairs(out, at);
    out.splice(at, 0, { signature: nm.signature, lines: modText(nm).split('\n'), inserted: true });
    replaced++;
  }
  // P2 (2.5, epic US; origin #27 R1b, field report R2): an anchored block is INDIVISIBLE. Its markers may
  // live in different modules (the prayer's BEGIN sits in the H1 module, its END in the prayer
  // module), so a by-module merge can apply one carrier and keep the other — the field got an END
  // without its BEGIN. The plan above is judged as a whole: a pair balanced on disk and unbalanced
  // in the plan rolls EVERY changed carrier back to its disk state (replaced → restored, inserted →
  // dropped, removed → restored) and the whole block goes to the task as ONE item with a "your
  // version → the new template" diff of all its carriers. A pair already broken on disk is not
  // rolled back (this merge did not break it): the item names it, and `check` stays red until the
  // block is restored by hand.
  const diskBad = unpairedAnchors(disk);
  for (const [name, reason] of Object.entries(unpairedAnchors(joinModules(out)))) {
    const carries = (m) => anchorMarkers(modText(m)).some((x) => x.name === name);
    const sigs = new Set([...newMods, ...diskMods].filter(carries).map((m) => m.signature));
    const wholeOld = diskMods.filter((m) => sigs.has(m.signature)).map(modText).join('\n');
    const wholeNew = newMods.filter((m) => sigs.has(m.signature)).map(modText).join('\n');
    if (diskBad[name]) {
      divergedList.push({ signature: `(anchored block KAIF:${name})`, note: `this anchored block is already unbalanced ON DISK (${reason}) — \`check\` stays red until it is restored; its carriers, your version → the new template`, diff: lineDiff(wholeOld, wholeNew) });
      continue;
    }
    for (let k = out.length - 1; k >= 0; k--) {
      const o = out[k];
      if (!sigs.has(o.signature)) continue;
      if (o.inserted) { out.splice(k, 1); replaced--; }
      else if (o.was) { out[k] = o.was; replaced--; }
    }
    divergedList.push({ signature: `(anchored block KAIF:${name})`, note: `anchored block KAIF:${name} is indivisible and not all of its carrier modules could be applied (a piecewise merge would leave ${reason}) — the whole block was kept as on disk; fold it in by hand from this diff of all its carriers`, diff: lineDiff(wholeOld, wholeNew) });
  }
  const merged = joinModules(out);
  return { merged, changed: !dryRun && merged !== disk, replaced, divergedList, verdict, renamed, renameMissing, renameBroken };
}
// The insertion point for a NEW module, moved past every anchored pair still open at `at`
// (field report R2); an unclosable pair (already broken on disk) leaves the point where it was.
function pastOpenPairs(mods, at) {
  const open = new Set();
  const feed = (m) => { for (const { name, kind } of anchorMarkers(modText(m))) { if (kind === 'BEGIN') open.add(name); else open.delete(name); } };
  for (let i = 0; i < at; i++) feed(mods[i]);
  let j = at;
  while (open.size && j < mods.length) feed(mods[j++]);
  return open.size ? at : j;
}

// The real delivery for a file the machinery may not touch (translated wholesale): the
// old-template → new-template delta, module by module, judged against the deploy's own module
// snapshot (bug 32; field report D12 — the costliest task section used to arrive EMPTY for exactly these
// files, and a field project counted 5 norms it would have silently lost). Old module TEXTS come from
// the baseline artifact; without one the delta is still DETECTED by the snapshot shas and the
// item says the diff is unavailable instead of staying silent — zero upstream delta = zero items.
function templateDelta(oldEntries, newContent, oldTexts) {
  const out = [];
  const newMods = splitModules(normEol(newContent).replace(/\s+$/, '\n'));
  const newBySig = new Map(newMods.map((m) => [m.signature, m]));
  const textOf = (e) => {
    const t = oldTexts && oldTexts.get(e.signature);
    return t != null && normSha(t) === e.sha256 ? t : null;
  };
  for (const e of oldEntries || []) {
    const nm = newBySig.get(e.signature);
    if (!nm) {
      const ot = textOf(e);
      out.push({ signature: e.signature, note: 'upstream REMOVED this module in this interval',
        diff: ot !== null ? lineDiff(ot, '') : '(diff unavailable — pass --baseline <dir|url> with the previous release artifacts)' });
      continue;
    }
    const nt = modText(nm);
    if (normSha(nt) === e.sha256) continue;
    const ot = textOf(e);
    out.push({ signature: e.signature, note: 'upstream updated this module (not applied — the file is translated)',
      diff: ot !== null ? lineDiff(ot, nt) : lineDiff('', nt) });
  }
  for (const nm of newMods) {
    if ((oldEntries || []).some((e) => e.signature === nm.signature)) continue;
    out.push({ signature: nm.signature, note: 'NEW module in this release (not inserted — the file is translated)', diff: lineDiff('', modText(nm)) });
  }
  return out;
}

// ONE classification for every road new templates arrive by — core update AND the legacy/
// anonymous bootstrap (plan 21 §5.5; bugs 13/14: those routes used to keep everything and dump
// the whole delta on the agent as cognitive work). Mutates f.content to the filled/anonymized
// text (derived surfaces inherit it — bug 05) and APPLIES the mechanical moves; returns the
// counters and the cognitive leftovers for the task writer. `base` (optional) is the previous
// release's synthetic baseline: template provenance for v1 manifests and old template TEXTS for
// the real old→new diffs of bug 32.
// [TESTED: 2026-07-28 · extraction verified by re-running suites S5–S12c unchanged-green]
function classifyAndApply(deploy, old, values, unresolved, cur, base = null, rehearsal = null, renames = {}) {
  const oldShas = old.shas || {};
  const oldTplShas = old.templateShas || (base && base.templateShas) || {};   // v2: what the previous deploy's TEMPLATES were
  const oldModShas = { ...((base && base.moduleShas) || {}), ...(old.moduleShas || {}) };  // v2: their per-module cut (manifest wins per path)
  const oldTplTexts = old.templateTexts || (base && base.templateTexts) || {};
  // What the previous deploy SHIPPED at all — distinguishes "provenance unknown" (v1 manifest)
  // from "genuinely NEW file in this release" (judge finding, phase L2).
  const oldPaths = new Set(
    (old.paths && old.paths.length ? old.paths : null)
    || (old.templateShas ? Object.keys(old.templateShas) : null)
    || (base && base.templateShas ? Object.keys(base.templateShas) : null)
    || []);
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
  // flag silently froze 21 untouched files forever (a field report).
  const i18nTranslated = String((cur || {}).i18n || '').toLowerCase() === 'translated';
  if (i18nTranslated) log('⟳ marker declares i18n: translated — mechanical replacement disabled for files carrying the owner\'s script; upstream changes ship as per-module diffs');
  const translatedWholesale = [];
  const addedPaths = [];                             // NEW files of this release — the language-arrivals item reads them back (2.5, epic US)
  const verdicts = {};                               // path → { baseFound, baseN, ceiling, outcome } for every wholesale candidate (P1, 2.5)
  const verdictMismatches = [];                      // files whose live verdict differed from the rehearsal's (P1, 2.5)
  const newModules = {};                             // path → [signatures NEW in this release] — update-verify checks each on disk (2.8, #92)
  const translatedFiles = [];                        // md files merged in dry-run (translated) — their new sections are named, not judged (2.8)
  // the PREVIOUS update's proposals (its receipt, read before this update overwrites it) — offered again when still absent (2.8, #92)
  let prevReceipt = null;
  try { prevReceipt = okOnDisk(LAST_UPDATE) ? readJson(LAST_UPDATE) : null; } catch { prevReceipt = null; }
  const prevProposedOf = (p) => new Set(((prevReceipt && prevReceipt.divergedModules) || {})[p] || []);
  // P1 (2.5, epic US; #27 R1): the rehearsal's verdict for this file, when one was recorded.
  const rehearsed = (p) => (rehearsal && rehearsal.verdicts && rehearsal.verdicts[p]) || null;
  const fmtV = (v) => `${v.outcome} — baseFound ${v.baseFound} of ${v.baseN}, ceiling ${v.ceiling}`;
  // 2.6 (UR2; origin #48 R2/R3): the hand-filled slots of THIS deployment, derived before the loop
  // rewrites f.content — see matchFills. Files and modules equal to "template + fills" are untouched
  // and move mechanically with the fills folded into the NEW template.
  const fills = deriveFills(deploy, values, old.fills, oldTplTexts);
  const fillsN = Object.keys(fills).length;
  if (fillsN) log(`⟳ hand-filled slots recognized (${fillsN}): ${Object.keys(fills).join(', ')} — a file equal to "template + fills" is untouched and moves mechanically, fills kept`);
  const withFills = (text) => (fillsN ? fillPlaceholders(text, fills, new Set()) : text);
  let replaced = 0, added = 0, kept = 0, mergedModules = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
    if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
    f.content = content; // derived surfaces (system skill copies) must inherit the filled text (bug 05)
    // 2.8 (epic UP; origin issue #92 · Q-R4 · K-R2a · F-F2): the sections NEW in this release — absent from the previous template's cut,
    // not a declared rename target — recorded for update-verify, which reds on any of them that never arrived on disk.
    if (f.path.endsWith('.md') && oldModShas[f.path] && !OWNER_SEEDED.includes(f.path)) {
      const oldSigs = new Set(oldModShas[f.path].map((e) => e.signature));
      const renTargets = new Set((renames[f.path] || []).map(([, n]) => n));
      // the H1 carries the project's name — a filled or re-recorded name is not a new section (the build skips H1 the same way; court UP6, F8)
      const nw = splitModules(normEol(content)).map((m) => m.signature).filter((s) => s !== '<preamble>' && !/^# /.test(s) && !oldSigs.has(s) && !renTargets.has(s));
      if (nw.length) newModules[f.path] = nw;
    }
    if (OWNER_SEEDED.includes(f.path)) {
      // A MISSING owner doc is seeded from the template (a 1.2-era tree predates EXPERIENCE.md —
      // the classified legacy path must seed it exactly like a fresh install would; sandbox-caught).
      if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; addedPaths.push(f.path); continue; }
      kept++;                                                            // owner's — never in scope
      // …but the TEMPLATE may have changed a CONVENTION (field: EXPERIENCE gained Repro:/Not for:
      // and no project could learn it) — surface the fact, touch nothing.
      if (oldTplShas[f.path] && oldTplShas[f.path] !== normSha(content)) ownerConvention.push(f.path);
      continue;
    }
    if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; addedPaths.push(f.path); continue; }
    // Authority to replace comes ONLY from matching the previous TEMPLATE (bug 12): the template
    // sha never mutates with the disk, so "restored by hand at update N" can no longer read as
    // "untouched" at update N+1. v1 manifests (no templateShas) keep the old byte-sha + kept-guard.
    const untouched = oldTplShas[f.path]
      ? (fileShaNorm(f.path) === oldTplShas[f.path]
         || (fillsN && normSha(unfill(readFileSync(f.path, 'utf8'), fills)) === oldTplShas[f.path]))   // untouched MODULO the hand-filled slots (2.6, UR2)
      : (!adoptedBefore.has(f.path) && oldShas[f.path] && fileSha(f.path) === oldShas[f.path]);
    if (untouched) {
      // An untouched file IS the old template — replacing it with the new one is right even
      // under the i18n flag (the flag protects the owner's translation, and an untouched file
      // carries none; s07 T2 guards this for pure-EN files on translated deployments).
      // The replacement carries the deployment's own fills folded into the NEW template (2.6, UR2).
      const want = f.path.endsWith('.mjs') ? content : withFills(content);
      if (fileShaNorm(f.path) === normSha(want)) { kept++; continue; } // upstream didn't change it either
      // A rename inside an UNTOUCHED file lands correctly by wholesale replacement — but it must
      // still be SAID (2.7, epic HO; origin #57): silence here is what leaves the owner unable to
      // tell a renamed section from a deleted one plus a new one. The module merge below says it
      // for diverged files; this is the same sentence for the file-level road.
      if (renames[f.path] && okOnDisk(f.path)) {
        const before = normEol(readFileSync(f.path, 'utf8'));
        const after = normEol(want);
        for (const [o, n] of renames[f.path])
          if (before.includes(o + '\n') && !after.includes(o + '\n') && after.includes(n + '\n'))
            log(`↻ renamed: ${f.path} :: ${o} → ${n} (replaced with the file — it carried no local edits)`);
      }
      writeMatchingEol(f.path, want); log(`↻ replaced ${f.path}${want !== content ? ' (fills kept)' : ''}`); replaced++; continue;
    }
    // bugs/32 (all four 2.1 field reports): a diverged/translated file whose TEMPLATE did not
    // change in this interval has NOTHING to deliver — it stays as-is and never makes a task
    // item ("zero upstream delta = zero items"; project A: 77% of the task was diffs nobody needed, // source-kept: two independent field measurements
    // project D: 8 of 23 merge-diverged items were byte-identical between the releases). // source-kept: two independent field measurements
    if (oldTplShas[f.path] && oldTplShas[f.path] === normSha(content)) { kept++; adopted.push(f.path); continue; }
    // The flag freezes only files that ARE a translation — judged by the BODY, because
    // machinery-appended aliases put the owner's script into every skill's frontmatter on both
    // sides and blinded the whole-file test for all 34 skills (bug 31; re-cut of bug 20/K2).
    const fileTranslated = i18nTranslated && f.path.endsWith('.md')
      && bodyLocalized(readFileSync(f.path, 'utf8'), content);
    if (fileTranslated) translatedFiles.push(f.path);
    // Diverged file → the MODULAR merge when the previous deploy left a module cut (v2, md only):
    // untouched modules move mechanically, edited ones are kept and handed over with diffs.
    // A translated file goes through the SAME merge in dry-run: analysis without writes (K2).
    if (f.path.endsWith('.md') && oldModShas[f.path]) {
      const oldTexts = oldTplTexts[f.path] != null
        ? new Map(splitModules(normEol(oldTplTexts[f.path])).map((m) => [m.signature, modText(m)])) : null;
      const res = mergeModules(f.path, content, oldModShas[f.path], fileTranslated, oldTexts, fillsN ? fills : null, renames[f.path] || [], prevProposedOf(f.path));
      // The rename is SAID, always — an update that silently swaps a heading leaves the owner unable
      // to tell a rename from a delete-plus-add (2.7, epic HO; origin #57).
      for (const r of (res && res.renamed) || []) log(`↻ renamed: ${f.path} :: ${r.from} → ${r.to} (${r.outcome})`);
      // a file merged WITHOUT writes (i18n translated) gets nothing inserted — both lines say what the disk got (court UP6b, C1)
      for (const r of (res && res.renameMissing) || []) log(`⚠ rename anchor not found on disk: ${f.path} :: ${r.from} (upstream renamed it to ${r.to}; ${fileTranslated ? 'nothing inserted — the file is translated, the new module is in the task' : 'the section arrives as new'})`);
      for (const r of (res && res.renameBroken) || []) log(`⚠ rename declaration broken: ${f.path} :: ${r.from} → ${r.to} — the incoming template carries no such heading; ${fileTranslated ? 'nothing is inserted into a translated file — merge it by hand from the task' : 'this section may arrive DOUBLED (your old one kept + a new one inserted)'} — fold it by hand and report the declaration upstream (bugs/114)`);
      if (res && res.translatedWholesale) {
        // headings translated — merging would double the document (bug 20/K1); hands off. The
        // task item now carries the REAL old→new template delta instead of "fold the news in
        // by hand" with nothing attached (bug 32 / field report D12).
        diverged.push(f.path); translatedWholesale.push(f.path); kept++; adopted.push(f.path);
        const delta = templateDelta(oldModShas[f.path], content, oldTexts);
        if (delta.length) divergedModules[f.path] = delta;
        const v = { ...(res.verdict || {}), outcome: 'frozen' };
        verdicts[f.path] = v;
        log(`⟳ ${f.path}: baseFound ${v.baseFound} of ${v.baseN}, ceiling ${v.ceiling} → frozen (translated wholesale — its headings are in the owner's script; kept intact, the template delta ships in the task)`);
        // The safe side of a mismatch: frozen stays frozen — but the disagreement is still NAMED,
        // because it is the fingerprint of the non-determinism the origin is hunting (P1).
        const rv = rehearsed(f.path);
        if (rv && rv.outcome !== 'frozen') { verdictMismatches.push({ path: f.path, rehearsal: rv, live: v }); log(`⚠ ${f.path}: the rehearsal said ${fmtV(rv)} — this run says frozen; the file stays frozen (verdict mismatch — see the task)`); }
        continue;
      }
      if (res) {
        // the same decision printed for the OTHER outcome: a body in the owner's script whose surviving
        // template headings sit ABOVE the ceiling merges by signature — say so with the numbers (P1)
        if (res.verdict) {
          const v = { ...res.verdict, outcome: 'merged' };
          verdicts[f.path] = v;
          log(`⟳ ${f.path}: baseFound ${v.baseFound} of ${v.baseN}, ceiling ${v.ceiling} → merged (the body carries the owner's script, but enough template headings survive for a by-signature merge)`);
          // P1 freeze-on-mismatch (2.5, epic US; #27 R1: the rehearsal froze AGENT_GUIDE, the live
          // run merged it and appended 416 English lines to a Russian canon). A rehearsal that said
          // "frozen" is a promise the owner read — this run keeps it: the file stays intact, the
          // template delta ships in the task, and the mismatch is named with both number sets.
          const rv = rehearsed(f.path);
          if (rv && rv.outcome === 'frozen') {
            verdicts[f.path] = { ...v, outcome: 'frozen', mismatch: rv };
            verdictMismatches.push({ path: f.path, rehearsal: rv, live: v });
            diverged.push(f.path); kept++; adopted.push(f.path);
            const delta = templateDelta(oldModShas[f.path], content, oldTexts);
            if (delta.length) divergedModules[f.path] = delta;
            log(`⚠ ${f.path}: the rehearsal said ${fmtV(rv)} — this run says merged → FROZEN (verdict mismatch; kept intact, the template delta ships in the task)`);
            continue;
          }
        }
        if (fileTranslated) {
          if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; }
          kept++; adopted.push(f.path);
          continue;
        }
        if (res.changed) { writeMatchingEol(f.path, res.merged); mergedModules += res.replaced;
          // a 2.3 field wish: NAME the kept modules by signature — "1 kept for you" made the
          // answer require a sandbox diff, and the answer should not require a sandbox.
          log(`↻ merged ${res.replaced} module(s) into ${f.path}${res.divergedList.length ? ` (kept for you: ${res.divergedList.map((d) => d.signature).join(' · ')})` : ''}`); }
        if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; kept++; adopted.push(f.path); }
        continue;
      }
    }
    diverged.push(f.path); kept++; adopted.push(f.path);
    // No module cut for this file (v1-era manifest or a pathological split) — the template delta
    // is delivered whole-file when the baseline is in hand, and NAMED honestly when it is not:
    // an empty merge-diverged item is indistinguishable from "nothing changed" (bug 32).
    if (f.path.endsWith('.md') && oldTplTexts[f.path] != null && normEol(oldTplTexts[f.path]) !== normEol(content)) {
      divergedModules[f.path] = [{ signature: '(whole file — template delta)',
        note: 'the template changed in this interval; your copy carries local edits — fold the delta into it by hand',
        diff: lineDiff(normEol(oldTplTexts[f.path]).replace(/\n$/, ''), normEol(content).replace(/\n$/, '')) }];
    } else if (f.path.endsWith('.md') && oldTplShas[f.path] && oldTplShas[f.path] !== normSha(content)) {
      divergedModules[f.path] = [{ signature: '(whole file)',
        note: 'the template changed in this interval, but no baseline artifact is reachable to render the diff — pass --baseline <dir|url>, or fold the template news in by hand',
        diff: '(unavailable)' }];
    } else if (f.path.endsWith('.md') && oldPaths.size && !oldPaths.has(f.path)) {
      // A file NEW in this release collided with an existing file of the owner's — there is no
      // old template to diff against, so the incoming template ships whole: an empty item is
      // indistinguishable from "nothing to do" (bug 32, judge finding).
      divergedModules[f.path] = [{ signature: '(new file in this release)',
        note: 'this release ships a NEW file, but a file with this name already exists in your project and was kept — adopt what you need from the incoming template below',
        diff: lineDiff('', normEol(content).replace(/\n$/, '')) }];
    }
    if (f.path.endsWith('.md') && localizedAgainst(readFileSync(f.path, 'utf8'), content))
      log(`⟳ ${f.path} is localized on disk — kept (no silent English takeover)`);
  }
  return { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale, addedPaths, verdicts, verdictMismatches, fills, newModules, translatedFiles };
}

// ---------------------------------------------------------------------------- update (idea 14 / plan 15)
// Mechanical respectful update: untouched framework files are replaced with the new
// templates; diverged ones are kept and handed to the agent; owner content is never
// in scope at all. Requires the deploy manifest with `shas` (installs since 1.5).
async function cmdUpdate() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  refuseOnJournal();   // a crashed previous update stays LOUD until resumed or consciously discarded
  const cur = readJson(KAIF_JSON);
  if (cur.tracking === 'anonymous') die('anonymous install tracks no origin — update by dropping a fresh thin KAIF.md and re-running the bootstrap (the surviving deploy manifest makes that pass mechanical since 2.0)');
  if (!val('--lang') && cur.language) LANG = checkedLang(cur.language, 'the deploy marker');   // a poisoned pre-92.1 marker refuses with the healing flag named
  if (!val('--agents') && Array.isArray(cur.agents) && cur.agents.length) AGENTS = cur.agents;
  // A mistyped channel VALUE must refuse, not silently become "release" (judge finding, L3 —
  // the same bug-33 class one level below the flag whitelist: form was validated, values not).
  const chan = (val('--channel') || 'release').toLowerCase();
  if (!(chan in SOURCES)) die(`unknown channel: ${chan} — known: ${Object.keys(SOURCES).join(' | ')}`);
  const base = val('--source') ? resolveSourceBase(val('--source')) : SOURCES[chan];   // bare repo URL → release assets (issue #10)
  log(`update: checking ${base}`);
  const man = JSON.parse((await fetchArtifact(base, 'kaif-manifest.json')).toString('utf8').replace(/^\uFEFF/, ''));
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
    if (got !== man.sha256[name]) dieSoft(`sha256 mismatch for ${name}: expected ${man.sha256[name]}, got ${got}`);   // post-fetch refusal: soft (issue #10)
  }
  const bundlePath = '.kaif/install/KAIF-CORE-BUNDLE.md';
  writeFileSync(bundlePath, bufs['KAIF-CORE-BUNDLE.md']);

  // classify against the install-time snapshots — ONE shared classification, whatever road the
  // new templates arrived by (plan 21 §5.5)
  const old = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : { paths: [], agents: [], shas: {} };
  const { files, meta } = parseBundle(bundlePath);
  const { deploy } = applyLanguage(files);           // LANG defaults handled below
  logPackHonesty(files, deploy);                     // the pack boundary is declared, not discovered
  const values = stableValues();                     // frozen deploy values win over re-detection (bug 26)
  const unresolved = new Set();
  // The previous release's own artifact provides the OLD template texts — the missing half of
  // every real "old template → new template" diff in the task (bug 32). Optional by design:
  // absence degrades to sha-detected notes, never to silence, and never blocks the update.
  const oldBase = await buildSyntheticBaseline(cur);
  const rehearsal = loadRehearsal(cur.version, man.version);   // P1 (2.5): a recorded rehearsal verdict binds this run — loaded BEFORE the backup/journal so a bad --rehearsal path refuses cleanly
  // Before/after file sizes: the honest way to SEE a K1-class mangling instantly (field ask —
  // "the doubling is visible in a size summary at once, and invisible in 43 merged-lines").
  const sizeBefore = {};
  for (const f of deploy) if (okOnDisk(f.path)) sizeBefore[f.path] = statSync(f.path).size;
  backupTree(deploy, cur.version, man.version);      // rollback material BEFORE anything is written
  writeUpdateJournal(cur.version, man.version, base, 'core-update', deploy);   // crash journal: after the backup, before the first mutation
  const { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale, addedPaths, verdicts, verdictMismatches, fills, newModules, translatedFiles } =
    classifyAndApply(deploy, old, values, unresolved, cur, oldBase, rehearsal, renameInterval(meta, cur.version));
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
  syncPointers();   // UT2 (2.9, #120): an untouched pointer of an earlier release is replaced; an edited one without the rule — a task item

  // swap the core itself + refresh manifests (same shape and guarantees as install's:
  // sha snapshots + adoption provenance in `kept` + the pristine marker snapshot that
  // backs the final self-heal).
  // An honest log line: "replaced" on byte-identical machinery sent a field agent hunting a
  // phantom swap failure (bug 10 facet, a field deployment) — when the shas match, say so instead.
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
  const templateLines = {};   // 2.8, epic CK: the deployed template's length — the budget warning of a file translated wholesale names the room it left
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
    if (f.path in DOC_BUDGETS) templateLines[f.path] = textLines(f.content);
  }
  const marker = recordBuild({ ...cur, version: man.version, released: man.released }, meta);
  const prerelease = prereleaseOrigin(cur, man.version);   // 2.8, origin #107
  if (prerelease) log(`ℹ this deployment came from an unreleased build of ${prerelease.of}${prerelease.build ? ` (source tree ${prerelease.build})` : ''} — the task says so and marks the ${prerelease.of} notes as probably in place`);
  // Seed the canonArtifacts key on updates of older deployments too (bug 34 — see cmdInstall).
  if (!('canonArtifacts' in marker)) marker.canonArtifacts = [];
  // field report D2 (bug 31): pre-2.0 translated deployments carry no i18n key, so the per-file freeze
  // is off for them. When the wholesale net just recognized translated files on a non-English
  // deployment, record the fact — every future update protects them by FLAG, not only by net.
  if (LANG !== 'en' && translatedWholesale.length && String(cur.i18n || '').toLowerCase() !== 'translated') {
    marker.i18n = 'translated';
    log(`⟳ marker: "i18n": "translated" recorded (${LANG} deployment; ${translatedWholesale.length} translated-wholesale file(s) recognized)`);
  }
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, templateLines, kept: adopted,
    values: persistValues(values), fills, marker }, null, 2) + '\n');   // `fills` — the hand-filled slots, derived (2.6, UR2)

  const dep = handleDeprecations(meta, old, fills);
  // The marker and the manifest are already written: a scan that throws must become a named item of the task, never a stack
  // trace that leaves the journal behind (SC4 F1).
  let staleClaims;
  try { staleClaims = scanStaleClaims(cur.version, man.version, templateShas); }
  catch (e) { staleClaims = [`${WALK_NOTE}the tree walk FAILED — the scan itself stopped (${e.code || e.message}); the scan is INCOMPLETE, not clean — re-run: node .kaif/kaif-core.mjs stale-claims`]; }
  // The task lists only slots that are LITERALLY on disk after the pass (judge finding: the raw
  // `unresolved` set collects every null-valued slot seen in incoming templates — on a fully
  // filled deployment that would put a phantom `placeholders` item into EVERY update task, and
  // a noisy guard teaches the agent to ignore it), each with its real addresses.
  const liveUnresolved = unresolvedOnDisk(unresolved, deploy);
  const scopes = updateScopes(old, deploy, deployedPaths, marker);
  const nameFallback = !canonicalName() && values['<PROJECT_NAME>'] ? values['<PROJECT_NAME>'] : null;
  const nModDiverged = Object.values(divergedModules).reduce((a, l) => a + l.length, 0);
  // The honest size of the work (field ask: the log said "161 modules merged", the task said
  // "2 await you" — the real answer to "how much do I read" is "the framework changed N of M").
  const oldTpl = old.templateShas || {};
  const changedCnt = Object.keys(oldTpl).length
    ? deploy.filter((f) => !isSkippedAnon(f.path) && (!oldTpl[f.path] || oldTpl[f.path] !== normSha(f.content))).length : null;
  writeUpdateTask(diverged, { ...meta, version: man.version },
    `${changedCnt !== null ? `the framework changed ${changedCnt} of ${deploy.length} shipped files in this interval; ` : ''}mechanical pass done: ${replaced} files replaced, ${mergedModules} modules merged in-place, ${added} added, ${kept} kept (owner/diverged${nModDiverged ? `; ${nModDiverged} modules await your merge — diffs below` : ''})${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}${dep.kept ? `; ${dep.kept} deprecated artifact(s) KEPT with local edits — see the deprecations item` : ''}. Sanity-check with git diff: replaced content must carry NO owner edits`,
    { divergedModules, ownerConvention, fromVersion: cur.version, deprecations: dep.items, staleClaims, translatedWholesale, unresolved: liveUnresolved, languageArrivals: languageArrivalsOf(addedPaths), verdictMismatches, verdicts,
      sphereSync: scopes.sphereSync, skeletonDelta: scopes.skeletonDelta, nameFallback, ownerVoice: portraitSync(meta.ownerVoice), prerelease });

  // The permanent receipt (plan 21 §3.4; field: "update-verify passed" was unfalsifiable a day
  // later — a field report, §4). Survives self-clean; update-verify stamps it when the gates pass.
  writeReceipt({ from: cur.version, to: man.version, route: 'core-update',
    source: base,   // where THIS update came from — the previous delta stays recomputable (field ask №3)
    counters: { replaced, mergedModules, added, kept },
    diverged, divergedModules: Object.fromEntries(Object.entries(divergedModules).map(([p, l]) => [p, l.map((d) => d.signature)])),
    ownerConvention, verdicts,      // the verdicts with their numbers: a later run (or the origin) compares receipts, not outcomes (P1, 2.5)
    newModules, translatedFiles: [...new Set([...translatedFiles, ...translatedWholesale])],   // update-verify checks every new section (2.8, #92)
    deprecations: { retired: dep.removed, kept: dep.kept } });   // the kept ones are a debt the receipt must confess (#32 R-D, 2.5)
  consumeRehearsal(rehearsal);
  appendHistory(marker, cur.version, man.version, 'core-update');
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  clearUpdateJournal();   // the LAST act: from here there is nothing left to resume
  log(`\n✅ KAIF updated mechanically to ${man.version} — finish ${UPDATE_TASK}, then: node .kaif/kaif-core.mjs update-verify`);
}

// A stamp carries the DATE AND THE TIME (AGENT_GUIDE → Document & text hygiene): a bare date
// loses the ordering INSIDE the day, and forensics on a busy day is exactly where these receipts
// are read. Local ISO 8601 with the offset — the owner's own clock, not UTC: a receipt is read by
// the human whose day it belongs to. Node has no local-ISO formatter, so the offset is composed
// from getTimezoneOffset (minutes WEST of UTC — hence the inverted sign).
function localStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
         `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const LAST_UPDATE = '.kaif/last-update.json';
const REHEARSAL = '.kaif/update-rehearsal.json';
// 2.8 (epic UP; finding N17): the fingerprint of THIS core — the file the process runs, line endings normalized. A rehearsal record
// carries the fingerprint of the core that wrote it: its verdicts come from that core's logic, so it binds only runs of the same core.
const SELF_SHA = (() => { try { return lfSha256(readFileSync(process.argv[1], 'utf8')); } catch { return null; } })();
// P1 (2.5, epic US; #27 R1): the verdicts a rehearsal recorded — `diff --source` over THIS tree
// (auto-consumed) or an update's receipt from a sandbox copy (`--rehearsal <path>`). A record binds
// only the same interval: one for another from→to is named and ignored, never applied to the wrong
// run; an explicit path that cannot be read REFUSES (the owner named it — silence would be a lie).
// [TESTED: 2026-09-04 · polygon s18 U3б: `diff --source` prints check-backlog → frozen and
// propose-idea → merged and records both; the record tampered to say propose-idea = frozen makes
// the update KEEP that file (no upstream line lands, the owner's translated section survives),
// name the mismatch in the log and the `verdict-mismatch` task item with both number sets, carry
// every verdict in the receipt, and consume the record; red on the 46a5ba7 core (8 of 8: the old
// core merged the file)]
function loadRehearsal(from, to) {
  const explicit = val('--rehearsal');
  const path = explicit || REHEARSAL;
  if (!existsSync(path)) { if (explicit) die(`--rehearsal: no such file: ${explicit}`); return null; }
  let r;
  // an unreadable AUTOMATIC record binds nothing and is removed like a foreign one; a receipt the owner NAMED for another interval is
  // the wrong file — refused, never silently ignored (court UP6b, C6); an automatic record for another interval may be a rehearsal of a
  // different planned update and stays
  try { r = readJson(path); } catch { if (explicit) die(`--rehearsal: not readable JSON: ${explicit}`); try { unlinkSync(path); } catch { /* already gone */ } log(`⚠ ${path} is not readable JSON — rehearsal ignored and removed`); return null; }
  if (String(r.from) !== String(from) || String(r.to) !== String(to)) {
    if (explicit) die(`--rehearsal ${explicit}: it rehearsed ${r.from} → ${r.to}, and this update is ${from} → ${to} — name the receipt of THIS interval, or re-run the rehearsal`);
    log(`⚠ rehearsal record ${path} is for ${r.from} → ${r.to}; this update is ${from} → ${to} — ignored`); return null;
  }
  // 2.8 (N17): another core's record (or an unsigned one, written before 2.8) is named and ignored; an explicit --rehearsal the owner
  // named that another core SIGNED refuses; an unsigned explicit one (a pre-2.8 copy's receipt) is applied with a warning — he named it.
  if (!r.core || (SELF_SHA && r.core !== SELF_SHA)) {
    const why = r.core ? `written by another core (${String(r.core).slice(0, 12)}…, this core ${String(SELF_SHA).slice(0, 12)}…)` : 'written by a core that did not sign it (before 2.8)';
    if (explicit && r.core) die(`--rehearsal ${explicit}: ${why} — its verdicts come from other logic; re-run the rehearsal (the sandbox copy) with this core`);
    if (!explicit) {   // one-shot like a consumed record: left on disk it binds nothing and every agent deleted it by hand (court UP6, F4)
      try { unlinkSync(path); } catch { /* already gone */ }
      log(`⚠ rehearsal record ${path} ${why} — ignored and removed: its verdicts come from other logic`); return null;
    }
    log(`⚠ --rehearsal ${explicit}: ${why} — applied because you named it`);
  }
  const verdicts = r.verdicts || {};
  log(`⟳ rehearsal verdicts loaded from ${path} (${Object.keys(verdicts).length} file(s)) — a file whose live verdict differs is frozen`);
  return { path, explicit: !!explicit, verdicts };
}
// The auto record is one-shot: consumed by the update it rehearsed (the receipt now carries the
// live verdicts); an explicit --rehearsal file is the owner's and is left alone.
// UT3 (2.9, criterion 18; a field update named its receipt with --rehearsal and the automatic record of the rehearsal stayed on disk
// after the update it rehearsed): with an explicit receipt the automatic record is consumed too, said aloud.
// [TESTED: 2026-10-16 12:08 +03:00 · suite s21 U3: explicit --rehearsal — the automatic record removed with the log line, the named
//  receipt intact; red on the dist of d5342b3 — report testcases/reports/2026-10-16_ut3-long-jump-honest.md]
function consumeRehearsal(r) {
  if (r && !r.explicit) { try { unlinkSync(r.path); } catch { /* already gone */ } }
  if (r && r.explicit && existsSync(REHEARSAL) && resolve(r.path) !== resolve(REHEARSAL)) {
    try { unlinkSync(REHEARSAL); log(`- removed ${REHEARSAL} — the automatic rehearsal record; this update applied the receipt you named (${r.path})`); } catch { /* already gone */ }
  }
}
function writeReceipt(r) {
  const receipt = { ...r, date: localStamp(), core: SELF_SHA };   // the receipt of a sandbox copy is a rehearsal too (--rehearsal) — signed (2.8, N17)
  writeFileSync(LAST_UPDATE, JSON.stringify(receipt, null, 2) + '\n');
  log(`+ wrote ${LAST_UPDATE} (the update receipt — proof that outlives the self-clean)`);
}
// The marker keeps a compact update history (field ask T9): where the deployment came from and
// by which route — /kaif-version gets real memory, forensics gets a machine-readable trail.
function appendHistory(marker, from, to, route) {
  marker.history = [...(marker.history || []), { from: from || '?', to, route, date: localStamp() }];
}

// ---------------------------------------------------------------------------- package.json splice (issue #16)
// The kaif:* wiring used to mutate the parsed object and write JSON.stringify(pkg, null, 2)
// back — re-serializing EVERY key: 24 whitespace-only diff lines in the owner's hand-formatted
// manifest under a log line promising an additive edit ("+ wired kaif:* handles"), on the
// deployment's very first commit (field: issue #16; the same tool-diff-wider-than-intent class
// as bug 22's CRLF rewrite). The wiring now SPLICES only what it adds into the file's own text,
// so everything outside the inserted entries survives byte-exact (indentation, key order,
// compact one-line values, a missing final newline). A shape the splicer cannot PROVE itself on
// falls back to the full re-serialize — and then the log says so instead of promising additivity.

// Top-level tokenizer for a JSON OBJECT text. Returns { entries: [{ key, keyStart, valueStart,
// valueEnd }], rootOpenIdx, rootCloseIdx } or null when the shape defeats it. The input has
// already passed JSON.parse, so the null branches are belt-and-suspenders, not a real path.
function jsonTopLevel(text) {
  const n = text.length;
  let i = text.indexOf('{');
  if (i < 0) return null;
  const rootOpenIdx = i;
  i++;
  const entries = [];
  const ws = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  const skipWs = () => { while (i < n && ws(text[i])) i++; };
  const readString = () => {          // at '"'; leaves i just past the closing quote
    i++;
    while (i < n) { if (text[i] === '\\') i += 2; else if (text[i] === '"') { i++; return true; } else i++; }
    return false;
  };
  const skipValue = () => {           // at the value's first char; leaves i just past its last char
    const c = text[i];
    if (c === '"') return readString();
    if (c === '{' || c === '[') {
      let d = 0;
      while (i < n) {
        const ch = text[i];
        if (ch === '"') { if (!readString()) return false; continue; }
        if (ch === '{' || ch === '[') d++;
        else if (ch === '}' || ch === ']') { d--; if (!d) { i++; return true; } }
        i++;
      }
      return false;
    }
    while (i < n && !ws(text[i]) && text[i] !== ',' && text[i] !== '}') i++;   // number/true/false/null
    return true;
  };
  while (i < n) {
    skipWs();
    if (text[i] === '}') return { entries, rootOpenIdx, rootCloseIdx: i };
    if (text[i] === ',') { i++; continue; }
    if (text[i] !== '"') return null;
    const keyStart = i;
    if (!readString()) return null;
    let key; try { key = JSON.parse(text.slice(keyStart, i)); } catch { return null; }
    skipWs();
    if (text[i] !== ':') return null;
    i++; skipWs();
    const valueStart = i;
    if (!skipValue()) return null;
    entries.push({ key, keyStart, valueStart, valueEnd: i });
  }
  return null;
}

// Splice the missing kaif:* entries (and optionally a missing "name") into package.json TEXT.
// Returns the new text, or null when the file's shape is not splice-safe (caller falls back).
function splicePackageJson(raw, addName, addScripts) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let out = raw;
  const lastSolid = (s, from) => { let j = from - 1; while (j >= 0 && /\s/.test(s[j])) j--; return j; };
  const lineIndent = (s, idx) => { const ls = s.lastIndexOf('\n', idx - 1) + 1; return (s.slice(ls, idx).match(/^[ \t]*/) || [''])[0]; };
  const pairs = Object.entries(addScripts).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);

  if (pairs.length) {
    const top = jsonTopLevel(out);
    if (!top) return null;
    const scripts = top.entries.find((e) => e.key === 'scripts');
    if (scripts) {
      const closeAbs = scripts.valueEnd - 1;                       // index of the scripts object's '}'
      const j = lastSolid(out, closeAbs);                          // last solid char before it
      if (j === scripts.valueStart) {                              // "scripts": {} — empty object
        const keyIndent = lineIndent(out, scripts.keyStart);
        const entryIndent = keyIndent + (keyIndent || '  ');
        out = out.slice(0, scripts.valueStart)
          + `{${eol}${entryIndent}${pairs.join(',' + eol + entryIndent)}${eol}${keyIndent}}`
          + out.slice(scripts.valueEnd);
      } else if (out.slice(scripts.valueStart, scripts.valueEnd).includes('\n')) {   // multiline object
        const entryIndent = lineIndent(out, j);                    // match the LAST entry's own line
        out = out.slice(0, j + 1) + `,${eol}${entryIndent}${pairs.join(',' + eol + entryIndent)}` + out.slice(j + 1);
      } else {                                                     // compact one-line object with entries
        out = out.slice(0, j + 1) + `, ${pairs.join(', ')}` + out.slice(j + 1);
      }
    } else {
      const j = lastSolid(out, top.rootCloseIdx);
      if (j === top.rootOpenIdx) return null;                      // empty {} root — nothing to preserve
      const rootIndent = top.entries.length ? lineIndent(out, top.entries[0].keyStart) : '  ';
      const step = rootIndent || '  ';
      out = out.slice(top.rootOpenIdx, top.rootCloseIdx).includes('\n')
        ? out.slice(0, j + 1) + `,${eol}${rootIndent}"scripts": {${eol}${rootIndent + step}${pairs.join(',' + eol + rootIndent + step)}${eol}${rootIndent}}` + out.slice(j + 1)
        : out.slice(0, j + 1) + `, "scripts": { ${pairs.join(', ')} }` + out.slice(j + 1);
    }
  }
  if (addName) {
    const top = jsonTopLevel(out);                                 // re-scan: offsets moved above
    if (!top || !top.entries.length) return null;
    const e0 = top.entries[0];
    const sep = out.slice(top.rootOpenIdx, top.rootCloseIdx).includes('\n')
      ? `,${eol}${lineIndent(out, e0.keyStart)}` : ', ';
    out = out.slice(0, e0.keyStart) + `"name": ${JSON.stringify(addName)}${sep}` + out.slice(e0.keyStart);
  }
  return out;
}

// ---------------------------------------------------------------------------- final gates
// The closing guarantees are a property of the DEPLOYED TREE, not of the road taken to it:
// install's verify-final and update's update-verify run the SAME gate sequence (field-caught
// in a field project, 2026-07-17 — the update path used to skip these, so owner-side merges made between
// the mechanical pass and the final check never reached the per-system skill copies).

// placeholder scan on the canon + skills across EVERY deployed surface (GOAL/maps may
// legitimately hold template slots for the owner). Scanning only .claude/ let literal
// <BUILD_COMMAND> live in the .agents/.grok/.cline/.roo copies and .kaif/spheres/ for a
// whole release while the gate stayed green (bug 11, three field reports).
// ONE predicate for both readers of "where may a slot still sit" — the gate below and the task's
// `placeholders` item (2.5, epic US; a field project's `bugs/KAIF/10`): the generator used to name EVERY
// deployed file carrying the token, chronicle quotes included, while the gate judged only these
// surfaces — an instruction wider than its gate sends a weak session to "fill" a verbatim quote
// in the history. The surfaces: the canon, every skill (canonical + per-system mirrors), and the
// DECLARED sphere only — foreign sphere libraries carry template slots BY DESIGN (bugs/36).
function placeholderSurfaces() {
  const scan = new Set(['AGENT_GUIDE.md']);
  for (const base of ['.claude/skills', '.agents/skills', '.grok/skills', '.cline/skills'])
    if (existsSync(base)) for (const n of readdirSync(base)) { const p = `${base}/${n}/SKILL.md`; if (existsSync(p)) scan.add(p); }
  if (existsSync('.roo/commands')) for (const n of readdirSync('.roo/commands').filter((f) => f.endsWith('.md'))) scan.add(`.roo/commands/${n}`);
  // Sphere libraries: only the DECLARED sphere is a working surface — the others are reference
  // libraries that carry template slots BY DESIGN (bugs/36, field report Г11: a literal <BUILD_COMMAND>
  // in a FOREIGN sphere's library blocked the whole acceptance).
  try {
    const declared = readJson(KAIF_JSON).sphere;
    if (declared && declared !== 'TODO' && okOnDisk(`.kaif/spheres/${declared}.md`)) scan.add(`.kaif/spheres/${declared}.md`);
  } catch { /* no readable marker — no sphere surface to scan */ }
  return scan;
}
function scanPlaceholders() {
  let issues = 0;
  for (const p of placeholderSurfaces()) {
    const t = readFileSync(p, 'utf8');
    for (const ph of PLACEHOLDERS) if (t.includes(ph)) { console.error(`✖ placeholder ${ph} still in ${p}`); issues++; }
  }
  return issues;
}

// The declared sphere must EXIST as a library: fable-method calls the sphere's minimum
// evidence set binding, yet a marker could point into the void with every gate green
// (bug 11, a field project: sphere "game-design" with no .kaif/spheres/game-design.md).
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
    let t;
    try { t = readFileSync(p, 'utf8'); } catch (e) { leaks.push(`${p} could not be read (${e.code || e.message}) — the scan is incomplete, not clean`); return; }
    for (const tok of active) if (t.includes(tok)) { leaks.push(`${p} → "${tok}"`); break; }
  };
  let manifestPaths = null;
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try { const m = readJson(DEPLOY_MANIFEST); manifestPaths = [...(m.paths || []), ...(m.agents || [])]; } catch { /* fall back to the walk */ }
  }
  if (manifestPaths) { for (const p of manifestPaths) scanFile(p); }
  else {
    // no manifest to scope the scan — the conservative whole-tree walk (the files git sees, 2.8 SC), transients excluded;
    // a walk that could not see part of the tree is a refusal, never a clean anonymity result
    const TRANSIENT = ['KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK, '.kaif/install', '.kaif/kaif-core.mjs', DEPLOY_MANIFEST];
    const tree = kaifWalk(['.']);
    for (const p of tree.files) if (!TRANSIENT.some((t) => p === t || p.startsWith(t + '/'))) scanFile(p);
    for (const note of walkNotes(tree)) log('⚠ anonymity scan ' + note);
    if (tree.failed.length) leaks.push(`the tree walk FAILED (${tree.failed.slice(0, 3).join(', ')}) — the scan is incomplete, not clean`);
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
    // Content comparison, not string comparison: `{...snap, ...cur}` reorders keys whenever
    // the snapshot lacks a field the live marker gained later (history, projectName), and a
    // plain stringify-compare then logged "restored fields lost" on a perfectly healthy
    // marker — a false alarm on the healthy path is the same lie class this delivery hunts
    // (epic-judge finding). Canonical deep key order per the project rule.
    const canon = (v) => Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    if (JSON.stringify(canon(healed)) !== JSON.stringify(canon(cur))) {
      writeFileSync(KAIF_JSON, JSON.stringify(healed, null, 2) + '\n');
      log('↻ self-healed .kaif/kaif.json (restored fields lost to a rewrite)');
    }
  } catch { /* marker unreadable — leave for the check to flag */ }
}

// One mirror write — the ONLY way this file writes a per-system copy (bugs/58, family 12
// "a refusal that does not name the right move"). Two guarantees, both paid for by a live repro:
//   1. the DIRECTORY is created here, the same way writeIfNew does it (line 407). The canon
//      instructs every project to author its own skills in .claude/skills/ (KAIF_REFERENCE §7.3);
//      for such a skill the mirror directory is created by NOBODY — deployAgentSystems mkdirs
//      only for skills that came from the bundle, while resyncCopies walks .claude/skills/ whole.
//   2. a write that still fails is reported as a NAMED path plus the command that repairs it —
//      never as a raw ENOENT thrown out of a final gate, which left the install with nothing at
//      all to close it (`sync`, both checkpoints and BOTH final gates died on one stacktrace).
// The canonical skills are never at risk here: this function only propagates them outward.
function writeMirror(to, content, failures) {
  try { mkdirSync(dirname(to) || '.', { recursive: true }); writeFileSync(to, content); return true; }
  catch (e) { failures.push(`${to} (${e.code || e.message})`); return false; }
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
  const failed = [];
  for (const [sys, base] of Object.entries(copies)) {
    if (!agents.includes(sys)) continue;
    for (const f of canon) if (writeMirror(f.path.replace('.claude/skills', base), f.content, failed)) synced++;
  }
  if (agents.includes('zoo-code')) for (const f of canon) {
    const n = skillName(f.path);
    if (n && writeMirror(`.roo/commands/${n}.md`, f.content.replace(/^name:[^\n]*\n/m, ''), failed)) synced++;
  }
  if (synced) log(`↻ re-synced ${synced} system skill copies from the canon`);
  // The refusal names the right move (bugs/58): what failed, and the one command that retries it.
  if (failed.length) log(`⚠ ${failed.length} system skill cop${failed.length === 1 ? 'y' : 'ies'} could not be written — the canonical skills in .claude/skills/ are intact, only these mirrors lag: ${failed.join(' · ')}. Fix the path or permission, then re-run \`node .kaif/kaif-core.mjs sync\`.`);
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

/**
 * Objective predicate of the field report: the report FILE exists in reports/KAIF_UPDATES/ under
 * the version THIS pass delivered. Writing it well is the agent's judgement; existing is not.
 * Version pin: a stale report from a PREVIOUS interval must not satisfy this pass.
 * Lives in one place because two callers need it — the checkpoint and the final gates.
 */
function fieldReportOnDisk(tag) {
  const kind = tag === 'KAIF-UPDATE' ? 'UPDATE' : 'INSTALL';
  let ver = null;
  try { ver = tag === 'KAIF-UPDATE' ? readJson(LAST_UPDATE).to : readJson(KAIF_JSON).version; }
  catch { /* no receipt/marker readable — the pin relaxes to the kind suffix below */ }
  const dir = join('reports', 'KAIF_UPDATES');
  const pin = ver
    ? new RegExp(`_KAIF_${String(ver).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${kind}_REPORT\\.md$`)
    : new RegExp(`_${kind}_REPORT\\.md$`);
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => pin.test(f)) : [];
  return { found, dir, ver, kind };
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
    if (!new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) { console.error(`✖ checkpoint missing: ${tag}: ${id} done  (record it: node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict-file <path-to-verdict.md>' : ''})`); missing++; }
  // THE FIELD REPORT IS REQUIRED BY THE DELIVERED VERSION, NOT BY THE TASK'S PROSE.
  // The required-checkpoint list above is derived from the task TEXT — and on the normal update
  // route that text is written by the OLD, already-deployed core, which knows nothing about an
  // item introduced later. So a 2.0/2.1 → 2.2 update produced a task WITHOUT `field-report` and
  // verified green without any report: the mandatory feedback loop of 2.2 silently skipped the
  // whole existing fleet — exactly the class where a proxy (what the prose happens to list)
  // replaces the property (what this version demands). The core running this gate IS the
  // delivered one — `update` swaps `.kaif/kaif-core.mjs` before `update-verify` runs — so it can
  // and must state its own requirement. Only when the task never asked for it: otherwise the
  // loop above already covers the tick, and this would double-report the same miss.
  if (!/kaif-core\.mjs checkpoint field-report/.test(task)) {
    const r = fieldReportOnDisk(tag);
    if (!r.found.length) {
      console.error(`✖ field report missing: no *_KAIF_${r.ver || '<version>'}_${r.kind}_REPORT.md in ${r.dir}/`);
      console.error(`  (mandatory since 2.2, decision #46 — this ${verb} was driven by an older core whose task did not list the item; the requirement comes from the version you just installed, not from that task. Genre canon: reports/README.md)`);
      missing++;
    } else {
      log(`✔ field report on disk: ${join(r.dir, r.found[0])} (required by the delivered version, not by the task text)`);
    }
  }
  // The judge tick must carry its verdict (bug 17: four free ticks used to pass the gate).
  if (task.includes('checkpoint judge') && new RegExp(`^${tag}: judge done$`, 'm').test(task) &&
      !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
    console.error(`✖ judge checkpoint has no verdict line — record it: node .kaif/kaif-core.mjs checkpoint judge --verdict-file <path-to-verdict.md> (or --verdict "<ascii one-liner>")`);
    missing++;
  }
  // 2.8 (epic UP; origin issue #92 · Q-R4 · K-R2a · court F-F2): EVERY section new in this release is checked on disk — not only what
  // the task happened to carry. A new section absent on disk is RED and named: the previous template never had it, so its absence is
  // no deletion of the owner's. A translated file is only NAMED for a hand check — its headings are in the owner's language and the
  // English signature cannot be found there by construction (FORK C, plans/122 UP2).
  // Is THIS file a translation? (court UP6, R2 · F7): the receipt's own list when it has one; without it (the field route — the
  // outgoing core wrote the receipt) the file is judged against this release's template, body only, as the update judges it — the
  // deployment's flag alone called English files "translated" and silenced both checks below for them.
  const rcV = okOnDisk(LAST_UPDATE) ? (() => { try { return readJson(LAST_UPDATE); } catch { return null; } })() : null;
  const trKnown = !!(rcV && Array.isArray(rcV.translatedFiles));
  const trList = new Set((rcV && rcV.translatedFiles) || []);
  let deployTranslated = false;
  try { const j = okOnDisk(KAIF_JSON) ? readJson(KAIF_JSON) : {}; deployTranslated = String(j.i18n || '').toLowerCase() === 'translated'; if (j.language && ISO_639_1.has(String(j.language).toLowerCase().split('-')[0])) LANG = String(j.language).toLowerCase(); } catch { deployTranslated = false; }   // a gate never dies on the marker's language — `check` names a poisoned one
  let tplTexts = null;
  const tplOf = (p) => { if (!tplTexts) { try { const b = parseBundle(BUNDLE, true); tplTexts = new Map(((b && b.files) || []).map((f) => [f.path, f.content])); } catch { tplTexts = new Map(); } } return tplTexts.get(p); };
  const fileTranslated = (p) => {
    if (trKnown) return trList.has(p);
    if (!deployTranslated || !okOnDisk(p)) return false;
    const t = tplOf(p);
    return t != null && bodyLocalized(readFileSync(p, 'utf8'), t);
  };
  try {
    const rc = rcV;
    const expected = {};   // path → Set(signatures) — the receipt's own list and the bundle's (below)
    const addAll = (per) => { for (const [p, sigs] of Object.entries(per || {})) if (Array.isArray(sigs)) { expected[p] = expected[p] || new Set(); for (const s of sigs) expected[p].add(s); } };
    if (rc && rc.newModules && typeof rc.newModules === 'object') addAll(rc.newModules);
    // the bundle's list (built against the previous release's module map): the FIELD route, where the outgoing core ran the update and its
    // receipt knows nothing of the new sections — applied when this deployment came from that release or earlier
    let sn = null;
    try { const bb = okOnDisk(BUNDLE) ? parseBundle(BUNDLE, true) : null; sn = bb && bb.meta && bb.meta.sectionsNew; } catch { sn = null; }
    if (rc && sn && sn.prev && sn.files && !gt(String(rc.from || '0'), String(sn.prev).replace(/^v/, ''))) addAll(sn.files);
    if (Object.keys(expected).length) {
      for (const [p, sigSet] of Object.entries(expected)) {
        const sigs = [...sigSet];
        if (!okOnDisk(p)) continue;
        const diskText = normEol(readFileSync(p, 'utf8'));
        const onDiskSigs = new Set(splitModules(diskText).map((m) => m.signature));
        const blocks = anchoredBlocks(templateOf(p) || '');
        for (const s of sigs) {
          if (onDiskSigs.has(s)) continue;
          // UT3: the heading of an anchored block — the block arrived when its anchor stands on disk (in whatever language)
          const blk = blocks.find((b) => b.heading === s.trim());
          if (blk && diskText.includes(blk.begin)) continue;
          if (fileTranslated(p)) { console.error(`⚠ a section new in this release — check it by hand (the file is translated; its English signature cannot be matched): ${p} :: ${s} — the new template as your language deploys it: node .kaif/kaif-core.mjs diff --source <the update's source> --render ${p}`); continue; }
          console.error(`✖ a section of this release did not arrive: ${p} :: ${s} — the update delivered it (the previous template never had it, so its absence is not your deletion); merge it from the task, or restore it`);
          missing++;
        }
      }
    }
  } catch { /* an unreadable receipt is named by its own gate */ }
  // Substance check (bug 17 / field report 08's 209-line method): every '+' line the update task
  // promised in its module diffs should exist on disk once the agent merged. A WARNING list, not
  // a failure — translated wrappers legitimately merge meanings, not bytes.
  // 2.8 (court UP6, R2 — the #92 incident: a whole interval's canon missing for 25 days while this gate was green on an i18n
  // deployment): the promised lines are judged PER FILE — only a file that is itself a translation is skipped, never an English one.
  if (task.includes('## Module diffs')) {
    let curFile = null, inDiff = false, unmergedLines = 0, editedLines = 0, skipSection = false;
    const perFile = new Map();
    // 2.6 (UR2; origin #48 R2): a promised line that carries a hand-filled slot is on disk in its
    // FILLED form — judge it with the deployment's fills folded in, never tell the agent to paste
    // `<BUILD_COMMAND>` back over `npm run build`.
    let fills = {};
    try { fills = (okOnDisk(DEPLOY_MANIFEST) && readJson(DEPLOY_MANIFEST).fills) || {}; } catch { fills = {}; }
    // UT3 (2.9, criterion 18; a field update 2.1 → 2.8: 236 false «not found»): a promised line is judged against the file's TEXT, not
    // its lines — a paragraph the merge re-wrapped is the same text (white space collapsed on both sides); a line of an anchored block
    // whose anchor stands on disk is the owner's rendition of that block (anchoredBlocks above), never an unmerged line
    const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
    const flatOf = new Map(), blocksOf = new Map(), slotsOf = new Map();
    // UT3 (the real route 2.1 → 2.9 on a field clone): a promised line carries the deployment's VALUES and fills (the creed's <AUTHOR>),
    // the template blocks and instruction slots do not — the lookups below fold them back into their slots first
    const slotVals = { ...persistValues(stableValues()), ...fills };
    for (const line of task.split('\n')) {
      const h = line.match(/^### (.+)$/);
      if (h) { curFile = h[1].trim(); continue; }
      // A module the safety net kept localized is EXPECTED to lack the English '+' lines —
      // demanding them would spam warnings at a correctly-behaving localized deployment.
      if (line.startsWith('**module:**')) { skipSection = line.includes('localized on disk'); continue; }
      if (line.startsWith('```')) { inDiff = line === '```diff'; continue; }
      if (skipSection || (curFile && fileTranslated(curFile))) continue;
      if (inDiff && curFile && line.startsWith('+ ') && line.length > 12 && okOnDisk(curFile)) {
        if (!perFile.has(curFile)) { perFile.set(curFile, readFileSync(curFile, 'utf8')); flatOf.set(curFile, flat(perFile.get(curFile))); blocksOf.set(curFile, anchoredBlocks(templateOf(curFile) || '')); slotsOf.set(curFile, instructionSlotLines(templateOf(curFile) || '')); }
        const promised = line.slice(2), filled = fillPlaceholders(promised, fills, new Set());
        const bare = unfill(promised, slotVals).trim();
        const inBlock = blocksOf.get(curFile).find((b) => b.lines.has(promised.trim()) || b.lines.has(bare));
        if (inBlock && perFile.get(curFile).includes(inBlock.begin)) continue;
        if (slotsOf.get(curFile).has(promised.trim()) || slotsOf.get(curFile).has(bare)) continue;   // an instruction slot: the project's own text replaces it
        if (!flatOf.get(curFile).includes(flat(promised)) && !flatOf.get(curFile).includes(flat(filled))) {
          // UT3 (the field clone of the jump 2.1 → 2.8: of 102 residual lines 94 stood on disk with the project's own edits — «ladder
          // FIRST», an inserted clause): a line whose words stand on ONE disk line (or two joined) is labelled as edited, never hidden
          const near = nearestLine(filled, perFile.get(curFile));
          if (near) { console.error(`⚠ promised upstream line stands on disk with local edits (line ${near.line}, ${near.pct}% of its words): ${curFile} :: ${line.slice(2, 80)}`); editedLines++; continue; }
          console.error(`⚠ promised upstream line not found on disk (unmerged?): ${curFile} :: ${line.slice(2, 80)}`);
          unmergedLines++;
        }
      }
    }
    if (unmergedLines) console.error(`⚠ ${unmergedLines} upstream line(s) from the module diffs are absent on disk — merge them or state why in the judge verdict`);
    if (editedLines) console.error(`⚠ ${editedLines} upstream line(s) stand on disk with local edits — the project's wording; read each: an edit that drops meaning (a removed «not») is merged by hand`);
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
  // Re-snapshot the DISK shas now that every merge landed (plan 21 §3.2; field: a deployment caught
  // the manifest asserting pre-merge shas forever). templateShas stay untouched — they are the
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

// OWN lines of a budgeted document (2.7, epic CB; origin issues #43/#45, three field reports): the
// size budget used to count EVERY line, so a deployment whose AGENT_GUIDE.md ran 1655 lines with 300
// of them byte-equal to the shipped template was warned about canon it never wrote — and the only
// executable answer, "move YOUR content out", was invisible under the arrived text. The carrier
// already existed and is REUSED here rather than invented: moduleAudit() compares the disk's module
// cut against `moduleShas` of the deploy manifest by the pair (signature, sha256). A disk module
// whose pair is in the deployed cut ARRIVED; every other line is the project's own.
//
// Three honest fallbacks, each of them said aloud in the warning, never silently:
//   • no manifest, or no cut for this file → every line counts as own (the fail-safe direction: the
//     budget keeps working exactly as it did before 2.7 rather than going quiet);
//   • the file was translated WHOLESALE — not ONE template signature survives on disk, so
//     by-signature comparison is not applicable BY CONSTRUCTION (bugs/36, and `i18n: translated` is
//     real state on two field deployments) → every line counts as own, and the line says the arrived
//     canon cannot be told apart from the project's own text. The predicate is the SHAPE of the loss,
//     not the marker: a file whose every template signature is gone cannot be cut either way, and the
//     arithmetic is the same in both branches — the flag only chooses which sentence is printed.
// The same shape has TWO causes, and calling them both "translated" is a lie the run on real state
// caught: an OWNER-SEEDED document (STATUS, GOAL, MASTER_PLAN, the external map) ships a skeleton the
// project then writes over completely, so its template signatures are gone in every healthy
// deployment — nothing was translated, the document is simply the project's own. Same arithmetic,
// honest sentence: the branch splits on OWNER_SEEDED, which the core already knows.
// Returns { total, own, arrived, basis } — `basis` is what the warning says about itself.
function ownLines(doc) {
  const raw = readFileSync(doc, 'utf8');
  const total = raw.replace(/\r?\n$/, '').split(/\r?\n/).length;
  let cut = null;
  try { if (okOnDisk(DEPLOY_MANIFEST)) cut = (readJson(DEPLOY_MANIFEST).moduleShas || {})[doc] || null; }
  catch { cut = null; }                                   // unreadable manifest — the marker gate flags it separately
  if (!cut || !cut.length) return { total, own: total, arrived: 0, basis: 'no-cut' };
  const disk = splitModules(normEol(raw));
  const diskSigs = new Set(disk.map((d) => d.signature));
  // `<preamble>` is machinery's, not the owner's (bug 43): it survives every translation and so
  // carries no evidence about whether this file was translated.
  const judged = cut.filter((e) => e.signature !== '<preamble>');
  if (judged.length && !judged.some((e) => diskSigs.has(e.signature)))
    return { total, own: total, arrived: 0, basis: OWNER_SEEDED.includes(doc) ? 'owner-seeded' : 'translated' };
  // The key is sha FIRST: a sha256 is 64 hex characters of fixed length, so concatenating it with an
  // arbitrary signature is unambiguous and needs no separator byte at all. (A raw NUL separator here
  // cost nothing at runtime and made this whole file read as BINARY to grep — caught by the judge.)
  const arrivedPairs = new Set(cut.map((e) => `${e.sha256}${e.signature}`));
  let arrived = 0;
  disk.forEach((m, i) => {
    if (!arrivedPairs.has(`${normSha(modText(m))}${m.signature}`)) return;
    let n = m.lines.length;
    // the last module carries the empty tail the final newline produces — `total` strips it too
    if (i === disk.length - 1 && n && m.lines[n - 1] === '') n--;
    arrived += n;
  });
  return { total, own: Math.max(0, total - arrived), arrived, basis: 'cut' };
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
  // i18n: translated (bugs/36): a wholesale-translated file matches NO template signature BY
  // CONSTRUCTION — 218/290/216 "MODULE ABSENT" lines in three field projects were 100 % false
  // and indistinguishable from a real loss ("teaches the operator to ignore the audit"). A file
  // whose absences coincide with a body in the owner's script is classified `localized`;
  // absence in a file that stayed English remains a REAL loss and stays visible.
  // The audit sees only the disk file — there is no incoming template here, so the prose axis
  // (which needs BOTH sides) cannot run. For a language the table does not know, the computed
  // substitute is the SHAPE of the absence: a wholesale translation loses every template
  // signature by construction, while a damaged English file loses some of them. Demanding
  // totality keeps real losses visible instead of hiding them behind a language flag (bugs/66 №3).
  let script = null, translatedDeploy = false;
  try {
    const j = readJson(KAIF_JSON);
    translatedDeploy = String(j.i18n || '').toLowerCase() === 'translated';
    if (translatedDeploy) script = SCRIPTS[String(j.language || '').toLowerCase()] || null;
  } catch { /* marker unreadable — the audit stays literal */ }
  let identical = 0, differs = 0, absent = 0, ours = 0, localized = 0;
  const lines = [];
  for (const [p, mods] of Object.entries(m.moduleShas)) {
    if (!okOnDisk(p)) continue;
    const raw = readFileSync(p, 'utf8');
    const disk = splitModules(normEol(raw));
    const diskBySig = new Map(disk.map((d) => [d.signature, normSha(modText(d))]));
    let fileClean = true, absentInFile = 0;
    const fileLines = [];
    for (const e of mods) {
      const got = diskBySig.get(e.signature);
      if (got === undefined) { absentInFile++; fileClean = false; fileLines.push(`  MODULE ABSENT: ${p} :: ${e.signature} (${e.class})`); }
      else if (got !== e.sha256) { differs++; fileClean = false; }
    }
    // `<preamble>` is machinery's, not the owner's (bug 43): translations keep it byte for byte,
    // so it never counts toward totality.
    const judged = mods.filter((e) => e.signature !== '<preamble>').length;
    const localizedFile = translatedDeploy && (script ? script.test(raw) : judged > 0 && absentInFile >= judged);
    if (absentInFile && localizedFile) {
      // the owner's script on disk + template signatures gone = a translation, not a loss;
      // its own headings are the translation itself, so they are not counted as "yours" either
      localized++;
      lines.push(`  localized: ${p} — translated wholesale, by-signature comparison not applicable (${absentInFile} template signature(s) absent by construction)`);
    } else {
      absent += absentInFile;
      lines.push(...fileLines);
      for (const d of disk) if (!mods.some((e) => e.signature === d.signature)) { ours++; fileClean = false; }
    }
    if (fileClean) identical++;
  }
  log(`module audit: ${identical} files match their deployed cut; ${differs} modules differ, ${absent} template modules absent, ${ours} modules are yours${localized ? `, ${localized} file(s) localized (translated — not a defect)` : ''}`);
  for (const l of lines.slice(0, 10)) log(l);
  if (absent) log('  (an ABSENT template module usually means its signature drifted — see bug 26; eyeball the file)');
 } catch (e) { log(`⚠ module audit skipped: ${e.message}`); }
}

// UT3 (2.9, criterion 18; a field update 2.1 → 2.8 with the prayer in the owner's language): an ANCHORED block of a template
// (`<!-- KAIF:<NAME>:BEGIN -->` … `<!-- KAIF:<NAME>:END -->`) is addressed by its ANCHOR — its text, heading included, legally stands
// in the owner's language, so «a section did not arrive: ## 🙏 THE PRAYER BEFORE WORK» over «## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ» and its lines
// counted as «promised upstream line not found» were false. → [{ begin, heading, lines }] of one template text.
// [TESTED: 2026-10-16 12:08 +03:00 · suite s21 U3 — the prayer heading and line in the owner's language with the anchor: no «did not
//  arrive», no «not found»; without the anchor the heading is «did not arrive» again (control); red on the dist of d5342b3; the real
//  route 2.1 → 2.9 is not walked yet — report testcases/reports/2026-10-16_ut3-long-jump-honest.md]
// The disk line that carries a promised line WITH LOCAL EDITS: at least NEAR_LINE_SHARE of the promised line's words (letters and
// digits, any script, case folded; a line of fewer than NEAR_LINE_MIN_WORDS words is never judged near) stand on one disk line or on
// two consecutive lines joined (a re-wrap). → { line, pct } | null. Only a label: the line is still printed — nothing is hidden.
// [TESTED: 2026-10-16 13:45 +03:00 · suite s21 U3b (red on c833219) + the field clone of the jump 2.1 → 2.8, probe ut3-long-jump-route —
//  report testcases/reports/2026-10-16_ut3-real-route.md]
const NEAR_LINE_SHARE = 0.8, NEAR_LINE_MIN_WORDS = 4;
function nearestLine(promised, diskText) {
  const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const want = words(promised);
  if (want.length < NEAR_LINE_MIN_WORDS) return null;
  const disk = normEol(diskText).split('\n');
  let best = null;
  for (let i = 0; i < disk.length; i++) {
    for (const span of [disk[i], `${disk[i]} ${disk[i + 1] || ''}`]) {
      const have = new Set(words(span));
      const share = want.filter((w) => have.has(w)).length / want.length;
      if (share >= NEAR_LINE_SHARE && (!best || share > best.share)) best = { line: i + 1, share };
    }
  }
  return best ? { line: best.line, pct: Math.round(best.share * 100) } : null;
}
// The lines of a template's INSTRUCTION slots — a `` `<…>` `` span over one or more lines ("`<State your branching policy …>`") that the
// deploying agent replaces with the project's own text. Demanding such a line back is demanding the placeholder: on the field clone of the
// jump 2.1 → 2.8 eight of the residual «not found» were exactly these. → Set of trimmed lines.
// [TESTED: 2026-10-16 13:45 +03:00 · suite s21 U3b (red on c833219) + the field clone of the jump 2.1 → 2.8, probe ut3-long-jump-route —
//  report testcases/reports/2026-10-16_ut3-real-route.md]
function instructionSlotLines(content) {
  const out = new Set();
  let open = false;
  for (const l of normEol(content).split('\n')) {
    const t = l.trim();
    // a slot opens at «`<» whose code span does NOT close on the same line ("`<SLOT>` text" is a mention, not a slot) or closes the line
    if (!open && t.startsWith('`<') && (t.endsWith('>`') || t.indexOf('`', 1) < 0)) open = true;
    if (open) { if (t) out.add(t); if (t.endsWith('>`')) open = false; }
  }
  return out;
}
function anchoredBlocks(content) {
  const out = []; let cur = null;
  for (const l of normEol(String(content)).split('\n')) {
    const t = l.trim(), b = /^<!-- KAIF:([A-Z][A-Z0-9-]*):BEGIN -->$/.exec(t);
    if (b) { cur = { begin: t, end: `<!-- KAIF:${b[1]}:END -->`, heading: null, lines: new Set() }; out.push(cur); continue; }
    if (!cur) continue;
    if (t === cur.end) { cur = null; continue; }
    if (!cur.heading && /^#{1,6} /.test(t)) cur.heading = t;
    if (t) cur.lines.add(t);
  }
  return out;
}
// The template text of a deployed path, from the bundle this update brought (null when absent)
function templateOf(p) {
  try { const b = okOnDisk(BUNDLE) ? parseBundle(BUNDLE, true) : null; const f = b && b.files.find((x) => x.path === p); return f ? f.content : null; }
  catch { return null; }
}

function cmdUpdateVerify() {
  // The update from the previous release is run by the DEPLOYED core, whose ignore list may lack this release's
  // lines (court of 2.7, D-F1: `.kaif/contour-window/` never reached .gitignore on 2.6 -> 2.7); update-verify is
  // run by THIS core on every route, so ignore-first is re-asserted here, before any gate. Idempotent.
  ensureIgnoreFirst();
  // UT2 (2.9, criterion 17; origin ticket #120): the same two-author route — an update run by the previous core left its pointers as
  // they were; this core brings the untouched ones up and refuses while an edited one lacks the resume rule, naming file and line
  const ptr = syncPointers();
  if (ptr.needRule.length) die(`update-verify REFUSED — ${POINTER_RULE_HINT(ptr.needRule)}; then re-run \`node .kaif/kaif-core.mjs update-verify\``);
  runFinalGates(UPDATE_TASK, 'KAIF-UPDATE', 'update-verify');
  moduleAudit();
  // Stamp the receipt: the proof of a verified update must outlive the self-clean (bug 17).
  if (okOnDisk(LAST_UPDATE)) {
    try {
      const r = readJson(LAST_UPDATE);
      r.verifiedAt = localStamp();
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
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = checkedLang(j.language, 'the deploy marker'); } catch { /* CLI default stands */ }
  }
  const { deploy, translated, overridePaths } = applyLanguage(files);
  // The pack boundary is declared, not discovered post-factum — but AFTER the success line, never
  // before it (2.7, epic CB, criterion 3): printed first, "INCOMPLETE BY DESIGN" is the opening
  // sentence of an install that has not yet written a file, and the field read it as a refusal.
  const packNotes = packHonesty(files, deploy);
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
  // ONE flag must not split into two behaviours (issue #8): the legacy branch used to honour an
  // explicit --mode for FILE deployment while the marker inherited the old tracking — a standard
  // tree labeled anonymous, and every consumer of the marker believed the marker (`version`
  // answered anonymous, `update` refused, the feedback contour kept signals local). An explicit
  // --mode either performs a NAMED transition (anonymous → origin, written at the marker below)
  // or refuses here, BEFORE any write. The implicit default still inherits the marker (bug 11).
  if (legacyOld && val('--mode') && ANON && (legacyOld.tracking || 'origin') !== 'anonymous') {
    die(`--mode anonymous contradicts the deployed marker (tracking: ${legacyOld.tracking || 'origin'}) — a tracked deployment cannot be anonymized by install: its origin-tied skills are already on disk, and no command performs tracked → anonymous. Re-run without --mode to keep the deployment as it is; anonymity is a fresh-deployment choice.`);
  }
  if (legacyOld) refuseOnJournal();   // a crashed previous update/bootstrap stays LOUD until resumed
  // A legacy bootstrap must not silently WIDEN the deployment: the old default (all five
  // systems) handed a two-system project ~80 unrequested files (bug 14, a field project). Inherit the
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
  let rehearsal = null;   // the recorded rehearsal this bootstrap is bound to (2.6, UR1) — consumed at the end, like cmdUpdate's
  if (!legacyOld && val('--rehearsal'))
    die('--rehearsal binds an update-by-bootstrap over an EXISTING deployment to a sandbox copy\'s receipt — this tree carries no .kaif/kaif.json, so there is nothing to rehearse against');
  // 2.8 (court UP6, F5): the rehearsal is loaded BEFORE the backup and the crash journal — a refused --rehearsal used to leave a journal
  // that blocked the next update as "died mid-flight" (cmdUpdate has loaded it first since 2.5)
  const earlyRehearsal = legacyOld ? loadRehearsal(legacyOld.version, meta.version) : null;
  if (legacyOld) {
    if (legacyOld.version !== meta.version) {
      backupTree(deploy, legacyOld.version, meta.version); // rollback material BEFORE any write
      writeUpdateJournal(legacyOld.version, meta.version, BUNDLE, 'bootstrap', deploy);   // crash journal: same contract as core-update
    }
    let baseline = null;
    if (okOnDisk(DEPLOY_MANIFEST)) {
      try { const mOld = readJson(DEPLOY_MANIFEST); if (mOld.templateShas) baseline = mOld; } catch { /* unreadable — try synthetic */ }
    }
    if (!baseline) baseline = await buildSyntheticBaseline(legacyOld);
    if (baseline) {
      // 2.6 (UR5; origin #41 wish 3): the surviving manifest holds SHAS, never TEXTS — so a module
      // absent on disk rendered as an all-`+` block on this route while the core-update route
      // showed the real −/+ (its synthetic baseline carries the old template texts). Fetch the old
      // release's own artifact for the TEXTS only (modules and shas stay the manifest's — it wins
      // per path in classifyAndApply); absence degrades to the 2.5 rendering and never blocks.
      // `--baseline <dir|url>` is the same switch as on every other road.
      const texts = baseline.synthetic ? null : await buildSyntheticBaseline(legacyOld, 'texts');
      // 2.6 (UR1; origin #42, three field trees in one day): `--rehearsal <receipt>` reaches this
      // route now (the flag is in install's whitelist AND the loader's), and the auto record is
      // CONSUMED below exactly like cmdUpdate's — all three trees found it still on disk after
      // the update it rehearsed.
      rehearsal = earlyRehearsal;
      cls = classifyAndApply(deploy, baseline, values, unresolved, legacyOld, texts, rehearsal, renameInterval(meta, legacyOld.version));
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
  if (legacyOld) syncPointers();   // UT2 (2.9, #120): an update by bootstrap brings untouched pointers of an earlier release up too

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
        sphere: 'TODO', agents: AGENTS, language: LANG,
        canonArtifacts: [] };
  // The canonArtifacts key is SEEDED empty (bug 34: /derive-styleguide instructs declaring it,
  // but no deployment ever created the key — "the instruction was dead"; an empty declaration
  // is the conscious "no canon yet" state the provenance gate distinguishes from unconfigured).
  if (!('canonArtifacts' in marker)) marker.canonArtifacts = [];
  // 2.8 (origin #107): the build's identity goes into the marker; a bootstrap update names the pre-release the tree came from
  const legacyPrerelease = legacyOld ? prereleaseOrigin(legacyOld, meta.version) : null;
  recordBuild(marker, meta);
  if (marker.prerelease) log(`ℹ this build is a PRE-RELEASE of KAIF ${marker.prerelease}${marker.build ? ` (source tree ${marker.build})` : ''}: it already carries the ${marker.prerelease} notes, and its version stays ${meta.version} until ${marker.prerelease} is released — recorded in ${KAIF_JSON} as "prerelease": "${marker.prerelease}"; the update to ${marker.prerelease} will say so`);
  if (legacyPrerelease) log(`ℹ this deployment came from an unreleased build of ${legacyPrerelease.of} — the task says so and marks the ${legacyPrerelease.of} notes as probably in place`);
  // Superseded marker fields: `{...legacyOld}` carries EVERYTHING forward, so renamed fields
  // of past schemas pile up (bug 19.3: agentsSupported from 1.4 living next to agents).
  // `agents` is always written above — the old spellings are safe to drop unconditionally.
  if (legacyOld) for (const stale of ['agent', 'agentsSupported']) delete marker[stale];
  // The other half of issue #8: an EXPLICIT --mode standard on the legacy branch WRITES the
  // transition instead of dropping the flag for the marker while honouring it for files — the
  // run whose banner says "mode standard" leaves a marker that says the same. `fork` tracking
  // is untouched (a fork IS a standard deployment; severing it is /kaif-switch-origin's job).
  let modeSwitch = [];   // P4 (2.5): kept files that were deployed with the ANONYMOUS wording
  if (legacyOld && val('--mode') && !ANON && legacyOld.tracking === 'anonymous') {
    marker.tracking = 'origin';
    marker.origin = ORIGIN;
    log('⟳ marker: tracking anonymous → origin (explicit --mode standard — version checks, updates and the feedback loop are live from here)');
    // P4 (2.5, epic US; #28 R3): the switch rewrites what it may — but a file KEPT for local edits
    // still carries the wording the anonymous deploy gave it (no origin, no core, no updates),
    // and nothing used to name those files. Anonymity-conditioned = the anonymizer changes the
    // template's text; kept = the disk text is NOT the standard template after this pass (owner
    // documents, diverged files, module merges with kept modules — every road that leaves the
    // old wording in place).
    modeSwitch = deploy.filter((f) => f.path.endsWith('.md') && !isSkippedAnon(f.path) && okOnDisk(f.path)
      && anonymize(f.content) !== f.content && fileShaNorm(f.path) !== normSha(f.content)).map((f) => f.path).sort();
    if (modeSwitch.length) log(`⚠ ${modeSwitch.length} kept file(s) were deployed with the anonymous wording — the task names each for a re-read`);
  }
  // Same auto-record as cmdUpdate (field report D2, bug 31): a legacy bootstrap that just recognized
  // translated-wholesale files on a non-English deployment writes the i18n fact down.
  if (legacyOld && cls && LANG !== 'en' && cls.translatedWholesale.length && String(legacyOld.i18n || '').toLowerCase() !== 'translated') {
    marker.i18n = 'translated';
    log(`⟳ marker: "i18n": "translated" recorded (${LANG} deployment; ${cls.translatedWholesale.length} translated-wholesale file(s) recognized)`);
  }
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  log(`+ wrote ${KAIF_JSON}`);
  // Respectful wiring: NEVER clobber an existing package.json we cannot parse —
  // an unreadable file means "skip the handles and say so", not "overwrite the user's file".
  // Anonymous installs get no kaif:* handles at all (they point at the origin-carrying core,
  // which verify-final removes) — the version stays readable in .kaif/kaif.json.
  let pkg = null, pkgRaw = null;
  if (ANON) { /* no handles by design */ }
  else if (existsSync('package.json')) {
    try { pkgRaw = readFileSync('package.json', 'utf8'); pkg = JSON.parse(pkgRaw.replace(/^\uFEFF/, '')); }
    catch { pkg = null; console.error('⚠ package.json exists but is not parseable JSON — kaif:* handles NOT wired (add them by hand)'); }
  } else pkg = {};
  if (pkg) {
    // Write ONLY when something was actually added: an unconditional rewrite re-serialized the
    // user's file (CRLF→LF) into a phantom whole-file diff on every install (bug 22 / field report K4).
    // And when something IS added, it is SPLICED into the owner's text (issue #16): the old
    // JSON.stringify(pkg) rewrite restyled every hand-formatted key under a log line that
    // promised an additive edit — the exact diff class the git-hygiene canon tells agents to stop on.
    const handles = { 'kaif:version': 'node .kaif/kaif-core.mjs version', 'kaif:check': 'node .kaif/kaif-core.mjs check',
                      'kaif:update': 'node .kaif/kaif-core.mjs update' };
    const addScripts = Object.entries(handles).filter(([k]) => !(pkg.scripts && pkg.scripts[k]));
    const addName = pkg.name ? null : values['<PROJECT_NAME>'].toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!addScripts.length && !addName) log('= kaif:* handles already wired — package.json untouched');
    else if (pkgRaw == null) {
      // the file did not exist — a fresh minimal manifest is ours to format
      writeFileSync('package.json', JSON.stringify({ name: addName, scripts: Object.fromEntries(addScripts) }, null, 2) + '\n');
      log('+ wired kaif:* handles into package.json');
    } else {
      const next = splicePackageJson(pkgRaw, addName, Object.fromEntries(addScripts));
      // The splice must PROVE itself before it ships: parsed result carries exactly the additions,
      // and with them removed it deep-equals the original. Anything less falls back honestly.
      const sane = (() => {
        if (next == null) return false;
        try {
          const orig = JSON.parse(pkgRaw.replace(/^\uFEFF/, ''));
          const chk = JSON.parse(next.replace(/^\uFEFF/, ''));
          for (const [k, v] of addScripts) { if (!chk.scripts || chk.scripts[k] !== v) return false; delete chk.scripts[k]; }
          if (addName) { if (chk.name !== addName) return false; delete chk.name; }
          if (addScripts.length && !orig.scripts) { if (Object.keys(chk.scripts).length) return false; delete chk.scripts; }
          return JSON.stringify(chk) === JSON.stringify(orig);
        } catch { return false; }
      })();
      if (sane) { writeFileSync('package.json', next); log('+ wired kaif:* handles into package.json'); }
      else {
        if (addName) pkg.name = addName;
        pkg.scripts = pkg.scripts || {};
        for (const [k, v] of addScripts) pkg.scripts[k] = v;
        writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
        log('+ wired kaif:* handles into package.json (file re-serialized — its shape was not splice-safe; whitespace-only diffs outside scripts are expected)');
      }
    }
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
  const templateLines = {};   // 2.8, epic CK: the deployed template's length — the budget warning of a file translated wholesale names the room it left
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
    if (f.path in DOC_BUDGETS) templateLines[f.path] = textLines(f.content);
  }
  // `marker` — a pristine snapshot of .kaif/kaif.json: weak models sometimes REWRITE the
  // marker instead of adding a key (field-caught, ДЗ-02 run 5), losing version/agents/language;
  // the final gates self-heal from this snapshot.
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, templateLines, kept: adopted,
    values: persistValues(values), fills: cls ? cls.fills : {}, marker }, null, 2) + '\n');   // `fills` — hand-filled slots, derived on a classified bootstrap (2.6, UR2)

  // 5) the final cognitive task for the agent: fresh install → adaptation;
  //    install over an OLDER deployed KAIF (legacy 1.4-style project bootstrapped
  //    with the thin KAIF.md) → an UPDATE task instead (existing files were kept).
  if (legacyOld) {
    // Receipt/history are written only for a REAL version move: a same-version re-run must not
    // pad the history with `X → X` noise, and must never clobber a previous update's verified
    // receipt — that receipt is the permanent proof bug 17 exists to provide (review-caught).
    // The route label answers "HOW was this classified", not "how old is the deployment"
    // (field: a 2.0→2.1 pass with a LIVE manifest v2 got labeled legacy-bootstrap, and "the
    // next session reading the receipt draws the wrong conclusion about the route"). A
    // bootstrap that classified with the fresh core against the SURVIVING manifest took the
    // ordinary modular road — 'bootstrap'; 'legacy-bootstrap' stays reserved for the weaker
    // grounds (synthetic baseline / adopt-everything), which the receipt must confess.
    const bootRoute = cls && cls.baselineOld && !cls.baselineOld.synthetic ? 'bootstrap' : 'legacy-bootstrap';
    if (legacyOld.version !== meta.version) {
      writeReceipt({ from: legacyOld.version, to: meta.version, route: bootRoute,
        counters: cls ? { replaced: cls.replaced, mergedModules: cls.mergedModules, added: cls.added, kept: cls.kept, adopted: adopted.length }
                      : { adopted: adopted.length },
        classified: !!cls, verdicts: cls ? cls.verdicts : {},
        divergedModules: cls ? Object.fromEntries(Object.entries(cls.divergedModules || {}).map(([p, l]) => [p, l.map((d) => d.signature)])) : {},
        newModules: cls ? cls.newModules : {}, translatedFiles: cls ? [...new Set([...(cls.translatedFiles || []), ...(cls.translatedWholesale || [])])] : [] });
      appendHistory(marker, legacyOld.version, meta.version, bootRoute);
      writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
    }
    // A re-run must not clobber recorded progress (bug 14, field: a second bootstrap wiped the
    // checkpoints and wrote a meaningless "legacy update 1.6 → 1.6" context line).
    // The question this branch answers is "is this the SAME interval?", never "are there
    // checkpoints?" (bugs/57): keyed on checkpoints alone it also swallowed a NEW interval —
    // the previous interval's task was kept, the new interval's delivery (policy changes, news,
    // conflicting-module diffs) was written NOWHERE, while marker, receipt and history had
    // already moved, so update-verify then went green against a FOREIGN checklist. A
    // checkpointed task from an OLDER interval takes the superseded road below, like any other.
    if (legacyOld.version === meta.version
        && existsSync(UPDATE_TASK) && /^KAIF-UPDATE: /m.test(readFileSync(UPDATE_TASK, 'utf8'))) {
      log(`= kept existing ${UPDATE_TASK} (it carries recorded checkpoints — not overwritten)`);
    } else if (existsSync(UPDATE_TASK) && legacyOld.version === meta.version) {
      // Bug 33 / field report Г1 — THE field data loss: a same-version re-run used to REGENERATE
      // the task even when it carried NO checkpoints yet, silently dropping its module diffs
      // and release news (the regenerated task is computed against the post-update manifest
      // and carries neither). An unfinished task IS the delivery: it survives byte-exact;
      // delete the file consciously to regenerate.
      log(`= kept existing ${UPDATE_TASK} (unfinished — its module diffs and news are the delivery; work it, or delete the file consciously to regenerate)`);
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
        // Since bugs/57 this road also carries tasks that ALREADY have checkpoints, so the line
        // says which kind was set aside: recorded items are work someone did, and a session that
        // reads "unfinished" alone would redo them. A previous aside that was never mined is
        // replaced here — say so out loud rather than let a second interval erase it silently.
        const had = /^KAIF-UPDATE: /m.test(normEol(readFileSync(UPDATE_TASK, 'utf8')));
        const over = existsSync(aside) ? ` (this REPLACES an earlier ${aside} that was never mined — recover it from git if it mattered)` : '';
        writeFileSync(aside, readFileSync(UPDATE_TASK));
        log(`⚠ an unfinished ${UPDATE_TASK}${had ? ' WITH recorded checkpoints' : ''} from a previous interval was preserved as ${aside}${over} — mine it for unmerged diffs${had ? ' and for the items it already records' : ''}, then delete it`);
      }
      const nMod = cls ? Object.values(cls.divergedModules).reduce((a, l) => a + l.length, 0) : 0;
      const why = legacyOld.tracking === 'anonymous'
        ? 'this anonymous deployment kept no content snapshots'
        : 'this deployment has no content snapshots (pre-1.5 deployments never wrote them)';
      const dep = cls ? handleDeprecations(meta, cls.baselineOld || {}, cls.fills) : { removed: 0, items: [] };
      const staleClaims = rerun ? [] : scanStaleClaims(legacyOld.version, meta.version,
        okOnDisk(DEPLOY_MANIFEST) ? (() => { try { return readJson(DEPLOY_MANIFEST).templateShas || null; } catch { return null; } })() : null);
      // Only slots literally on disk make the task item (judge finding — see cmdUpdate),
      // each with its real addresses; scopes/name mirror the core-update road.
      const liveUnresolved = unresolvedOnDisk(unresolved, deploy);
      const scopes = updateScopes(cls ? cls.baselineOld : null, deploy, deployedPaths, marker);
      const nameFallback = !canonicalName() && values['<PROJECT_NAME>'] ? values['<PROJECT_NAME>'] : null;
      // A CLASSIFIED bootstrap (surviving manifest / synthetic baseline) hands over exactly what
      // a core update would: per-module diffs and honest counters — not "merge everything".
      writeUpdateTask(cls ? cls.diverged : [], meta, rerun
        ? `re-run on ${meta.version}: the tree already carries this version — verify the previous merge rather than redoing it`
        : cls
          ? `bootstrap update ${legacyOld.version || '?'} → ${meta.version}, classified mechanically: ${cls.replaced} replaced, ${cls.mergedModules} modules merged in-place, ${cls.added} added, ${cls.kept} kept${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}${dep.kept ? `; ${dep.kept} deprecated artifact(s) KEPT with local edits — see the deprecations item` : ''}${nMod ? `; ${nMod} module(s) await your merge — diffs below` : ''}`
          : `legacy update ${legacyOld.version || '?'} → ${meta.version}: ${why}, so every kept framework file may carry local edits — merge the template news below into them pointwise`,
        cls ? { divergedModules: cls.divergedModules, ownerConvention: cls.ownerConvention, fromVersion: legacyOld.version, deprecations: dep.items, staleClaims, translatedWholesale: cls.translatedWholesale, unresolved: liveUnresolved, languageArrivals: languageArrivalsOf(cls.addedPaths), verdictMismatches: cls.verdictMismatches, verdicts: cls.verdicts, modeSwitch,
                sphereSync: scopes.sphereSync, skeletonDelta: scopes.skeletonDelta, nameFallback, ownerVoice: rerun ? null : portraitSync(meta.ownerVoice), prerelease: rerun ? null : legacyPrerelease }
            : { fromVersion: legacyOld.version, staleClaims, unresolved: liveUnresolved, nameFallback, ownerVoice: rerun ? null : portraitSync(meta.ownerVoice), prerelease: rerun ? null : legacyPrerelease });
    }
    if (existsSync(TASK_FILE)) {
      // Judge finding (L3): an adaptation IN PROGRESS (recorded checkpoints/verdict) must not
      // vanish because a bootstrap re-ran mid-flight — the same doctrine that protects
      // UPDATE_TASK above (bugs 14/33). Preserved aside: the update flow owns the task slot.
      if (/^KAIF-ADAPT: /m.test(normEol(readFileSync(TASK_FILE, 'utf8')))) {
        const asideAdapt = 'KAIF_ADAPTATION_TASK.superseded.md';
        writeFileSync(asideAdapt, readFileSync(TASK_FILE));
        unlinkSync(TASK_FILE);
        log(`⚠ ${TASK_FILE} carried recorded checkpoints — preserved as ${asideAdapt} (mine it, then delete); this bootstrap continues as an update`);
      } else { unlinkSync(TASK_FILE); log(`- removed stale ${TASK_FILE} (this is an update, not an adaptation)`); }
    }
  } else {
    writeAdaptationTask(unresolvedOnDisk(unresolved, deploy), translated, meta, values);
    if (existsSync(UPDATE_TASK)) { unlinkSync(UPDATE_TASK); log(`- removed stale ${UPDATE_TASK}`); }
  }

  // 6) validate what we just did (the required task file depends on the mode)
  const bad = validate(deploy, skillFiles, legacyOld ? UPDATE_TASK : TASK_FILE);
  if (bad) die(`install INCOMPLETE: ${bad} artifacts missing — re-run, or fix and \`check\``);
  const aliased = countAliasedOnDisk();   // read back AFTER validate(): every write is done by here
  // "N owner docs templated" counts what is ON DISK, never the pack size in the bundle
  // (bugs/99 №1 — the same doctrine as `aliased` above): an install over existing owner docs
  // keeps them (`= kept existing`), and the plan-sized counter claimed localization the disk
  // never received. A doc counts when its disk bytes carry THIS run's localized template.
  const translatedOnDisk = (overridePaths || []).filter((p) => {
    const f = deploy.find((d) => d.path === p);
    if (!f || !okOnDisk(p)) return false;
    let want = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, new Set());
    if (ANON && !f.path.endsWith('.mjs')) want = anonymize(want);
    return normEol(readFileSync(p, 'utf8')) === normEol(want);
  }).length;
  consumeRehearsal(rehearsal);   // 2.6 (UR1): one-shot on THIS route too — the auto record used to survive the bootstrap it rehearsed (origin #42)
  clearUpdateJournal();   // bootstrap road completed — nothing left to resume
  log(`\n✅ KAIF ${meta.version} deployed mechanically (lang ${LANG}${translatedOnDisk ? ` · ${translatedOnDisk} owner docs templated` : ''}${aliased ? ` · ${aliased} skills trigger-aliased` : ''}, mode ${MODE}, agents ${AGENTS.join(',')}).`);
  for (const s of packNotes) log(s);   // the pack boundary reads as a note on a finished install, never as its verdict (2.7, CB)
  // #145 §2.3 (2.9): the project's own ignore rules are judged HERE, in the summary the agent reads before its first commit — on a live
  // project that commit is the one that would silently drop what git ignores; `check` keeps the same scan
  const ignoredNow = gitIgnoredDeployed([...deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path),
    ...expectedAgentArtifacts((skillFiles || []).map((f) => skillName(f.path)))]);
  if (ignoredNow.length) {
    log(`⚠ ${ignoredNow.length} deployed file(s) are git-ignored by this project's rules — the first commit would leave them out:`);
    for (const f of ignoredNow) log('  ' + f.line);
  }
  // Agent clients read their command list ONCE at startup: skills that appeared on disk after that
  // are absent from it, and the first thing the human sees when trying one is "no such command" —
  // which reads as "the install failed". Saying it HERE costs one line and prevents that diagnosis.
  // #143 §2.1 (2.9): a greenfield folder without git — the deploy ends with a commit, and nothing said what to do; the agent ran `git init`
  // on its own. The thin KAIF.md does not grow (decision #8), so the machinery says it where the agent reads the outcome.
  if (!inGitWorkTree()) log(`⚠ this folder is not a git repository, and the deploy ends with a commit — run \`git init\` now; commit the owner's own files first, exactly as they are (his originals are committed before any edit), then the deploy commit.`);
  if (skillFiles && skillFiles.length) log(`➡ Restart your agent client so the ${skillFiles.length} skills appear in its command list (clients read that list at startup — until then a new skill answers "no such command", which is a stale list, not a failed install).`);
  if (legacyOld) log(`➡ ONE cognitive step remains — open ${UPDATE_TASK} and work it, then run: node .kaif/kaif-core.mjs update-verify`);
  else log(`➡ ONE cognitive step remains — open ${TASK_FILE} and work it, then run: node .kaif/kaif-core.mjs verify-final`);
}

// SW5 (2.9, origin issue #130) · #145 §2.3: a DEPLOYED artifact that git ignores is lost by every clone — `.clinerules/kaif.md` under an
// unanchored `KAIF.md` on a case-insensitive git made a fresh clone's `check` red; a live project's own pre-KAIF `tools/` line hid the 13
// shipped modules under `.kaif/tools/`, and only a later `check` said so — the first commit after the install would have dropped them.
// Judged against the repository's own ignore rules (and its core.ignorecase); one finding per ignored file: `own` — the rule is a line
// KAIF writes itself. Outside a git work tree there is nothing to judge (empty list).
// [TESTED: 2026-09-29 21:46 +03:00 · suite s01 S9: KAIF's own line → ✖ with the cure, the owner's rule → ⚠ with `!<file>`; red on v2.8 — testcases/reports/2026-09-29_sw-delivered-wired.md]
// Is the current folder inside a git work tree? (false also when git itself is absent)
function inGitWorkTree() {
  try { const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }); return r.status === 0 && String(r.stdout).trim() === 'true'; }
  catch { return false; }
}
function gitIgnoredDeployed(candidates) {
  const out = [];
  try {
    if (!inGitWorkTree()) return out;
    const deployed = [...new Set(candidates)].filter((p) => okOnDisk(p));
    const r = spawnSync('git', ['check-ignore', '--no-index', '-v', '--stdin'], { input: deployed.join('\n') + '\n', encoding: 'utf8' });
    const kaifLines = new Set(ignoreFirstWanted().map((w) => w.replace(/^\//, '')));
    for (const l of String(r.stdout || '').split(/\r?\n/).filter(Boolean)) {
      const m = /^(.*?):(\d+):(.*?)\t(.*)$/.exec(l);
      if (!m || m[3].startsWith('!')) continue;               // a negation that matched keeps the file — not ignored
      const [, src, ln, pat, file] = m;
      const own = kaifLines.has(pat.replace(/^\//, ''));
      out.push({ own, file, line: own
        ? `✖ deployed artifact is git-ignored by KAIF's own line ${src}:${ln} «${pat}»: ${file} — a clone would lose it; \`checkpoint recheck\` of an update task or the next \`update\` anchors the line to the root (or write \`/${pat.replace(/^\//, '')}\` there now)`
        : `⚠ deployed artifact is git-ignored by ${src}:${ln} «${pat}»: ${file} — a clone of this project will not have it; add \`!${file}\` after that line if it should travel` });
    }
  } catch { /* no git here — nothing to judge */ }
  return out;
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
    // (2.9, judge of UT+PV) a corrupt manifest is a named refusal, never a Node stack trace
    try { ({ paths, agents } = readJson(DEPLOY_MANIFEST)); }
    catch (e) { die(`${DEPLOY_MANIFEST} is unreadable as JSON (${e.message}) — restore it from git: git checkout -- ${DEPLOY_MANIFEST}`); }
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
    // `archives` (2.8, epic CK): optional; an object of "<re-read core document>": "<digest>" | { digest, owner }
    if ('archives' in j) {
      if (!j.archives || typeof j.archives !== 'object' || Array.isArray(j.archives)) schemaIssues.push('archives is not an object of "<core document>": "<digest>" | { "digest", "owner" }');
      else for (const [k, v] of Object.entries(j.archives)) {
        if (!(k in DOC_BUDGETS)) schemaIssues.push(`archives names "${k}", which is not a document of the re-read core`);
        const d = typeof v === 'string' ? v : v && typeof v === 'object' ? v.digest : null;
        if (typeof d !== 'string' || !d) schemaIssues.push(`archives["${k}"] names no digest`);
      }
    }
    // `hooks` (2.9, epic SW): optional; the only legal value is "off" — the owner's opt-out of the wiring of the delivered hooks
    if ('hooks' in j && j.hooks !== 'off') schemaIssues.push(`hooks is ${JSON.stringify(j.hooks)} — the only legal value is "off" (drop the key to have the delivered hooks wired)`);
    for (const s of schemaIssues) { console.error(`✖ marker schema: ${s} (Reference §12.1)`); missing++; }
  } catch { console.error('✖ marker unreadable as JSON'); missing++; }
  // SW (2.9, origin issue #115): a DELIVERED hook that is not wired is named — a warning, never a failure (the hooks are the mechanical
  // half of rules the markdown carries in full); the fix is one command, the opt-out one marker key
  try {
    const hw = hookWiringState();
    if (hw.state === 'missing' && hw.missing.length) console.error(`⚠ ${missingScripts(hw).length} delivered hook(s) not wired in ${HOOK_SETTINGS}: ${missingScripts(hw).join(' · ')} — run \`node .kaif/kaif-core.mjs wire-hooks\` (the owner opts out with "hooks": "off" in .kaif/kaif.json)`);
    // WH (2.9, origin ticket #144): a RETIRED hook still wired is named — in the project file `wire-hooks` removes it; the personal
    // settings.local.json and an opted-out project are the owner's to edit
    if ((hw.retired || []).length) console.error(`⚠ ${HOOK_SETTINGS} still runs ${hw.retired.length} hook(s) KAIF retired in 2.9: ${hw.retired.join(' · ')} — ${hw.state === 'off' ? 'remove the entry by hand ("hooks": "off": KAIF does not write the file)' : 'run `node .kaif/kaif-core.mjs wire-hooks` (it removes them; if your harness refuses that write, give the owner that one command)'}`);
    if ((hw.retiredLocal || []).length) console.error(`⚠ ${HOOK_SETTINGS_LOCAL} still runs ${hw.retiredLocal.length} hook(s) KAIF retired in 2.9: ${hw.retiredLocal.join(' · ')} — remove the entry by hand (KAIF never edits the personal file)`);
    else if (hw.state === 'unreadable') console.error(`⚠ ${hw.file}: ${hw.error} — the delivered hooks cannot be wired into it; fix the file, then run \`node .kaif/kaif-core.mjs wire-hooks\``);
  } catch (e) { console.error(`⚠ the hook wiring could not be read (${e.message}) — run \`node .kaif/kaif-core.mjs wire-hooks\` to see why`); }
  // SW5 (2.9, origin issue #130): a DEPLOYED artifact that git ignores is lost by every clone — the scan lives in gitIgnoredDeployed(),
  // shared with the install summary (#145 §2.3); a line KAIF wrote itself is a failure here (the next update anchors it), the owner's own
  // rule a warning with the cure.
  for (const f of gitIgnoredDeployed([...paths, ...agents])) { console.error(f.line); if (f.own) missing++; }
  // Two-headed deployed docs (bug 31; field: project D's /pause and /kaif-remove, project C's doubled // source-kept: two independent field projects
  // PHILOSOPHY): a broken merge that ever leaves a SECOND H1 in a framework-owned .md means two
  // documents living in one file — and both `check` and `update-verify` were green on it.
  // Every deployed non-owner .md is in scope (a zero-delta update legally skips a file, so the
  // damage of a PAST broken merge must be visible HERE — judge finding, phase L2); owner-seeded
  // docs are exempt: their content is the owner's business. Fence-aware count via the splitter.
  for (const p of paths.filter((x) => x.endsWith('.md') && !OWNER_SEEDED.includes(x))) {
    if (!okOnDisk(p)) continue;
    const text = normEol(readFileSync(p, 'utf8'));
    const h1 = splitModules(text).filter((m) => /^# /.test(m.signature)).length;
    if (h1 > 1) { console.error(`✖ two-headed document (${h1} H1 headings): ${p} — a broken merge left two documents in one file; reconcile by hand`); missing++; }
    // Anchored blocks are INDIVISIBLE (2.5 epic US, origin issue #27 R1b + a second field team's
    // "arrived inside the pair"): a module merge once landed `KAIF:PRAYER:END` without its BEGIN
    // and without the creed at all — /resume had nothing to recite and no gate said a word. An
    // END without a BEGIN (or the reverse, or END before BEGIN) is a structurally invalid document,
    // judged here with the same weight as a two-headed one. Fenced code is not a marker.
    // @guard anchor-parity
    // THREAT:         a module merge lands an anchored block in pieces — END without BEGIN (origin issue
    //                 #27 R1b) or upstream text inside a localized pair — and /resume has nothing to
    //                 recite while every gate stays green
    // PROVED-AGAINST: sandbox s18 U9 — PHILOSOPHY.md with a bare `KAIF:TEST:END` → check exit ≠ 0 naming
    //                 the file and the pair; the same marker inside a code fence stays green (2026-09-04);
    //                 the field shape itself is reproduced by s18 U1 (PRAYER BEGIN=0 END=1 after a merge)
    // GAP:            judges the document AFTER the fact — the merge that produces the shape is the subject
    //                 of the unit rule in mergeModules (plans/86 US2b); a pair with both markers present
    //                 but a replaced BODY is not this guard's threat
    // ON-REAL-PATH:   NOT YET — the path is a field deployment's own `check` after the 2.5 update
    for (const [name, bad] of Object.entries(unpairedAnchors(text)))
      { console.error(`✖ unpaired anchor block KAIF:${name} (${bad}): ${p} — an anchored block arrived in pieces; restore the whole BEGIN…END pair by hand (the pair is indivisible)`); missing++; }
  }
  if (missing) die(`INCOMPLETE: ${missing} artifacts missing`);
  // Content gate (warning, not failure): a mirror that EXISTS but drifted from its canon
  // skill passed the old existence-only check for a whole release (bug 11; nine days of five
  // systems on stale skills, a field project). Non-fatal by design: between `update` and `update-verify`
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
  // Language mix (2.5, epic US; field #32 R-C: a ru deployment's own skill directory was already
  // bilingual — 18 of 45 skills English — and no gate said a word). Skills are agent-read and stay
  // English by policy; the count is HONESTY about the tree, not a defect: a warning, never a failure.
  // Since 2.7 (epic CB, criterion 2) MIX is judged by the SHARE of foreign-script prose tokens, not
  // by a single occurrence of a script: `re.test(body)` made one English word in a Russian skill
  // indistinguishable from an English skill, and — the other way round — a fully English skill with
  // three stray Cyrillic words read as localized and was invisible to the count. Two states, one
  // named threshold:
  //   • not ONE token in the owner's script → ENGLISH (exactly the old predicate, by tokens) — the
  //     count below, unchanged in wording, because English arrival is policy and not a defect;
  //   • the owner's script present AND the foreign share at or above the threshold → MIXED, named
  //     with its percentage, because that is a half-finished translation and nothing said a word.
  // Below the threshold the skill is localized and this axis stays silent.
  // Code is NOT prose (plan 95 risk б): a Russian skill quotes commands, paths and flags by the
  // dozen, and counting them would redden every legitimate localized skill — fenced blocks and
  // inline code spans are removed before tokenizing.
  // The threshold was MEASURED, not chosen: over the origin's own 37-skill ru layer (2026-09-18), of the
  // 29 skills carrying the owner's script 28 run 0.003 … 0.130 foreign share and ONE (English body,
  // three stray Cyrillic words) sits at 0.993 — invisible to the old predicate and named as a mix by
  // this one; the 8 English ones run 1.000. The threshold sits inside that gap, far from both sides,
  // and below one half, so a body whose paragraphs are half English is named.
  const LANGUAGE_MIX_FOREIGN_SHARE = 0.35;
  try {
    const lang = String(readJson(KAIF_JSON).language || 'en').toLowerCase();
    const re = SCRIPTS[lang];
    if (lang !== 'en' && re && existsSync('.claude/skills')) {
      let total = 0, english = 0;
      const mixed = [];
      for (const n of readdirSync('.claude/skills')) {
        const p = `.claude/skills/${n}/SKILL.md`;
        if (!okOnDisk(p)) continue;
        total++;
        const body = splitModules(normEol(readFileSync(p, 'utf8'))).filter((m) => m.signature !== '<preamble>').map(modText).join('\n');
        const tokens = stripCodeSpans(body).match(PROSE_WORD) || [];
        let own = 0;
        for (const t of tokens) if (re.test(t)) own++;
        const share = tokens.length ? (tokens.length - own) / tokens.length : 0;
        if (!own) { english++; continue; }
        if (share >= LANGUAGE_MIX_FOREIGN_SHARE) mixed.push(`${n} (${Math.round(share * 100)} % foreign)`);
      }
      // The ENGLISH count speaks only on a deployment whose wrapper is translated wholesale (`i18n: translated`): there an English
      // skill stands out. Elsewhere English skills are the policy, and the line printed "37 of 37 skills are English" on every run
      // of every deployment with a language pack — noise that buried the lines that matter (2.8, epic CK; K14 of the 2.8 recon).
      // The MIX line below is a defect wherever it appears and stays unconditional.
      const translatedWrapper = String(readJson(KAIF_JSON).i18n || '').toLowerCase() === 'translated';
      if (english && translatedWrapper) console.error(`⚠ language mix: ${english} of ${total} skills are English (language: ${lang}) — skills are agent-read and arrive English by policy; translate on demand, and expect NEW skills to arrive English too`);
      if (mixed.length) console.error(`⚠ language mix: ${mixed.length} of ${total} skills are a MIX — at or above ${Math.round(LANGUAGE_MIX_FOREIGN_SHARE * 100)} % of their prose tokens are not ${lang} while the rest is: ${mixed.slice(0, 5).join(', ')}${mixed.length > 5 ? ` (${mixed.length - 5} more)` : ''} — a half-finished translation reads as two documents to an agent; finish it or leave the skill English`);
    }
  } catch { /* unreadable marker — the marker gate flags it separately */ }
  warnSphereLibrary();
  // NT3 (2.9, origin issue #141 — a field closing ritual named no build command: its step was still the template's instruction slot
  // «`<Run the project build …>`», nothing asked to fill it, and a red suite went unnoticed for 18 days): a deployed closing or release skill
  // whose step is still such a slot is named with the step and the cure. A warning, never a failure — the ritual still runs its other steps.
  // The slot is opened as instructionSlotLines() opens one: «`<» whose code span does not close on the line (a mention stays silent) —
  // plus the form the light judge of epic NT found unseen in the release template (F5): the slot that opens MID-line («… skeleton.
  // `<If the project has a storefront linter…»). A mention closed on its line («(`<PROJECT> X.Y`)», «`<!-- class-ok … -->`») stays
  // silent in all three templates. The judge's second form, «`<COMMIT_COMMAND>` with …», never reaches a deployment: the install fills
  // that placeholder from its map (detectValues), so no rule is spent on it.
  // [TESTED: 2026-10-16 16:15 +03:00 · s25 NT3 (#141) and NT F5 green (81 checks); on the dist of f977156 exactly «NT F5» red]
  const RITUAL_SKILLS = ['end-chat-soft', 'end-chat-force', 'release'];
  const slotAt = (t) => {
    if (t.startsWith('`<') && (t.endsWith('>`') || t.indexOf('`', 1) < 0)) return 0;
    const i = t.lastIndexOf('`<');   // an OPENING backtick (an even count before it) whose span does not close on the line
    return i > 0 && (t.slice(0, i).split('`').length - 1) % 2 === 0 && t.indexOf('`', i + 1) < 0 ? i : -1;
  };
  for (const n of RITUAL_SKILLS) {
    const p = `.claude/skills/${n}/SKILL.md`;
    if (!okOnDisk(p)) continue;
    let step = null;
    for (const l of normEol(readFileSync(p, 'utf8')).split('\n')) {
      const t = l.trim();
      if (/^#{1,6} /.test(t)) { step = t.replace(/^#+\s*/, ''); continue; }
      const at = slotAt(t);
      if (at >= 0)
        console.error(`⚠ ${p}: the step «${step || '?'}» is still the template's instruction slot «${t.slice(at, at + 60)}…» — write this project's own command there, or the ritual runs nothing at that step`);
    }
  }
  // The size-budget guard over the re-read core (STATUS: bugs/37, decision #27 — the 2.1 release
  // PROMISED a warning at the ~200-line soft target and shipped prose only, field STATUS files
  // grew to 1647/1928 lines because "there was no one to warn"; the other eight: 2.5, epic CN).
  // A warning, never a failure; each warning names the budget it measured against.
  // Since 2.7 (epic CB) the number judged is the project's OWN lines — see ownLines() — and each
  // warning carries the ADDRESS its overflow moves to, from the one table above. `--gate-budgets`
  // turns the advice into a DOOR for the closing ritual (origin issue #71, proposal 3: "three core
  // documents above budget, the warning printed for weeks and acted on once"); with no flag the
  // behaviour is exactly what it was — a warning and exit 0, because a warning that can fail a
  // mid-update `check` would block work the budget was never meant to block.
  // @guard doc-budgets
  // THREAT:         the re-read core grows past what a session can hold and nobody warns (field: a 5.8k-line core re-read hourly, STATUS at
  //                 6× its target); since 2.7 also: the warning counted ARRIVED canon as the project's own lines, so a deployment was told to
  //                 shorten text it never wrote (field: AGENT_GUIDE.md 1661 lines, 596 of them arrived), and it cost nothing to ignore —
  //                 three core documents above budget, the line printed for weeks and acted on once (origin issue #71)
  // PROVED-AGAINST: sandbox s16 on a deployed copy, 44 asserts — a fresh install padded with OWN modules is SILENT while over budget in total
  //                 lines and under it in own lines; padded past the OWN budget it is named `own lines N of budget ~M`, own+arrived adds up to
  //                 wc -l, and it carries its address (STATUS: the chronicle); wholesale-translated, owner-seeded and no-module-cut each say
  //                 which they are; a deployment INSIDE its budgets keeps the gate open (exit 0, nothing printed) while an overflow closes it
  //                 with exit 1 from the DOOR and not from an unrecognised flag; bare `check` stays 0; an unknown flag still refuses. Red: the
  //                 2.6 core (KAIF_DIST) 27 of 44; five mutants of THIS block's predicates on a COPY of dist — own-lines returns the whole file
  //                 (3 red), the gate never closes (5), the mix threshold at 0 (2) and at 1 (4), owner-seeded folded into translated (2); none invisible.
  //                 Since 2.8 the door is a ratchet (budgetRatchet): s16 section (6) — first gate records and passes, standstill / growth / new
  //                 overflow stop, a shrink passes and tightens the base, a document under budget leaves it, a version change re-records, an
  //                 unreadable base stops; red on the 2.7 core 13 of 59; six mutants of its predicates, each red on its own asserts
  // GAP:            it counts LINES, not weight — a document under its own-line budget can still be unreadably long; a MODULE edited by one
  //                 character counts WHOLE, the unit of the deployed cut being the module; a translated or owner-seeded file is judged as if
  //                 every line were its own — honest but over-naming, and the line says so; the gate fires only where ASKED FOR, so a ritual
  //                 that never runs the flag is as toothless as the warning was, and nothing here sees that; the ratchet's base is a
  //                 committed file an agent can delete or rewrite by hand — the next gate then records the debt afresh, and only the
  //                 review of that file (and the judge) sees it
  // ON-REAL-PATH:   NOT YET — the path is a field deployment's own `check` after the 2.7 update. Observed instead, and it is seeded state, not that
  //                 path: the command over two field deployments' manifest-listed files copied into a temp tree — 3 and 4 PRINTED numbers read back
  //                 against wc -l and their own moduleShas, 0 disagreements, the other 6 and 5 documents silent on both sides, sources re-hashed
  //                 unchanged; the cross-check re-implements the same algorithm, so it catches an assembly error and never one of the algorithm.
  //                 It paid for itself anyway: it is what showed an owner-seeded document reading as "translated wholesale"
  const overBudget = budgetOverflow((s) => console.error(s));
  // The ENTRY COST of a chat in tokens (2.8, epic CK, step CK5.9; origin issue #99 — a field /resume read about 230k tokens and
  // nothing ever said so; the owner chose the cheap half: the line is REFERENCE, it never stops a closing). Lines are the
  // budget's unit, tokens are what the model pays: /resume reads the nine re-read core documents, and HOUSE_RULES.md where it
  // exists. Two named rates: ASCII at 2.5 characters per token (the model page: "1M tokens ~ 2.5M characters"); any other
  // character at 1.9 (the ticket's own measurement on a mostly Cyrillic core document: 140,597 bytes = 40,880 tokens, 29,203
  // ASCII + 55,246 other characters; the origin keeps the probe tools/sandbox/probes/ck59-token-calibration.mjs). One
  // calibration point, so the line says "~"; the window is 1M tokens, and the line names it in words instead of hiding it.
  // [TESTED: 2026-09-25 · s16 section (9): the thousands and the share equal an independent recount from disk, a house-rules file of
  //  known weight adds its tokens; red on the 2.7 core; mutants M19/M20 red on exactly those asserts; functional run on copies of a
  //  field deployment's nine documents: "~ 225k tokens — 23 % of a 1M-token model window" — testcases/reports/2026-09-25_ck59a-entry-cost.md]
  const ASCII_CHARS_PER_TOKEN = 2.5, OTHER_CHARS_PER_TOKEN = 1.9, MODEL_WINDOW_TOKENS = 1000000;
  const entryCore = Object.keys(DOC_BUDGETS).filter((d) => okOnDisk(d));
  const entryHouse = okOnDisk('HOUSE_RULES.md');
  if (entryCore.length) {
    let entryTokens = 0;
    for (const d of entryHouse ? [...entryCore, 'HOUSE_RULES.md'] : entryCore) {
      let ascii = 0, other = 0;
      for (const ch of readFileSync(d, 'utf8')) { if (ch.charCodeAt(0) < 128) ascii++; else other++; }
      entryTokens += ascii / ASCII_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN;
    }
    console.error(`ℹ entry cost: /resume reads ${entryCore.length} re-read core document(s)${entryHouse ? ' + HOUSE_RULES.md' : ''} ~ ${Math.round(entryTokens / 1000)}k tokens — ${Math.round((entryTokens * 100) / MODEL_WINDOW_TOKENS)} % of a 1M-token model window (reference, never a stop; ~ ${ASCII_CHARS_PER_TOKEN} ASCII / ${OTHER_CHARS_PER_TOKEN} other characters per token)`);
  }
  // The re-read core ↔ the /resume ritual (2.7, epic TR; origin issue #59 + the 2.7 scope recon: a
  // field /resume opened 5 of the 9 re-read core documents and nobody said a word — the skill's
  // list and the documents on disk drift silently). The core is the budgeted nine above (ONE
  // place — AGENT_GUIDE → Document taxonomy, tier 1); the ritual's list is every `- `NAME.md``
  // bullet of the deployed /resume skill (its Step 1; quotes and numbered items are not bullets).
  // A warning, never a failure — a localized or owner-edited /resume must not block update-verify;
  // each line names the documents, so the fix is one bullet per name.
  // @guard resume-covers-core
  // THREAT:         the /resume list drifts from the re-read core (a document dropped from the skill, or a
  //                 core document the ritual never opened) and every session resumes with a hole exactly there
  // PROVED-AGAINST: sandbox s25 — a deployed copy whose /resume lost the `GOAL.md` bullet → check prints the
  //                 warning naming GOAL.md and "1 of the 9"; the intact copy prints nothing; the 2.6 core
  //                 (KAIF_DIST seam) prints nothing on the mutant → ✖
  // GAP:            a document named in the list but skipped by the session is not visible here — the
  //                 refresh-marker witness and the judge's refresh-witness hunt cover the execution half
  // ON-REAL-PATH:   NOT YET — the path is a field deployment's own `check` after the 2.7 update
  const RESUME_SKILL = '.claude/skills/resume/SKILL.md';
  if (okOnDisk(RESUME_SKILL)) {
    const named = new Set();
    for (const m of readFileSync(RESUME_SKILL, 'utf8').matchAll(/^\s*- `([A-Za-z0-9_./-]+\.md)`/gm)) named.add(m[1]);
    const core = Object.keys(DOC_BUDGETS);
    const unnamed = core.filter((d) => !named.has(d));
    if (unnamed.length)
      console.error(`⚠ /resume does not name ${unnamed.length} of the ${core.length} re-read core documents: ${unnamed.join(', ')} — add each as a bullet to ${RESUME_SKILL} Step 1 (AGENT_GUIDE → Document taxonomy, tier 1; a field ritual once opened 5 of 9 and nothing said a word)`);
    const absent = [...named].filter((d) => !okOnDisk(d));
    if (absent.length)
      console.error(`⚠ /resume names ${absent.length} document(s) missing on disk: ${absent.join(', ')} — restore the file or drop the bullet`);
  }
  // The undelivered SIGNAL on an origin-tracked deployment (2.7, epic SD; origin issue #65 — a recurrence of #37:
  // two tickets sat "waiting to be sent" for ~40 minutes until the owner said "send" a second time; the carve-out
  // lived as prose and lost twice to the broad "confirm outward actions" reflex). The carve-out now stands in the
  // AUTH gate's own line (AGENT_GUIDE → the fable loop) and /report-bug files and delivers in ONE step; this axis
  // is the machine behind both. It is an ALLOWLIST: a numbered KAIF ticket is silent ONLY on positive evidence of
  // delivery — an issue (URL `…/issues/N` or `#NN`) and no `not yet` in its `**Delivered upstream:**` paragraph, read
  // by deliveryState(), the one reading `report` shares. Every other state is named with the next step. Why not "warn
  // on NOT YET": the delivery lines of the field's own tickets come in more shapes than the template's — the field
  // name translated into the project language (the #65 incident itself committed «Сигнал в исток: ждёт отправки»),
  // a promise instead of an address ("⏳ being sent by this session"), a delivery claimed in words with no issue
  // ("✅ this issue — sent", "folded into the field report"), no line at all; a check that looked only for NOT YET
  // was silent on every one of them (fail-safe defaults — Saltzer & Schroeder 1975: "a design or implementation
  // mistake in a mechanism that explicitly excludes access tends to fail by allowing access, a failure which may go
  // unnoticed in normal use"). A warning, never a failure — the debt is the agent's, and an owner-edited tree must
  // not fail update-verify on it; on tracking: anonymous the axis is silent, because a local signal is legal there.
  // @guard undelivered-signal
  // THREAT:         a KAIF-defect ticket filed locally on an origin-tracked deployment and never sent — the origin
  //                 never learns, and the owner discovers it by asking "did you file that?" (field: #37, #65)
  // PROVED-AGAINST: sandbox s17 on a deployed copy — NOT YET → named with the report command; the field name
  //                 translated (no `**Delivered upstream:**` line) and a promise value → named "no readable delivery
  //                 state" with both legal forms; NOT YET plus an issue URL → named by check AND refused by report
  //                 (one reading); delivered through the gh stand-in → silent; tracking: anonymous → silent; README in
  //                 bugs/KAIF → silent. Red: the 2.6 core (KAIF_DIST); the first, NOT-YET-only build of this axis;
  //                 three mutants of this block — the tracking gate removed (anonymous → ✖), the delivered branch
  //                 removed (delivered → ✖), the NN_*.md filter widened (README → ✖). Real state: the 46 ticket files
  //                 of four field deployments copied into fresh installs (plans/109, run report 2026-09-13 SD)
  //                 2.8, epic CH (origin #78): the same axis reads the field reports of 2.8+ in reports/KAIF_UPDATES — s17 CH1:
//                 NOT YET named with the report command, delivered through the gh stand-in → silent, no line → named, a 2.7
//                 report → silent, tracking: anonymous → silent
// GAP:            a ticket never written at all is invisible here (the judge's "signal filed, not delivered" hunt
  //                 covers that side); an issue number that points at the WRONG issue reads as delivered — the axis
  //                 sees that an issue is named, not that it is the right one; a `#NN` in the project language's own
  //                 words ("в истоке #37") is not recognised and gets named — the fail-safe direction
  // ON-REAL-PATH:   observed on four field deployments tracking the origin, each on its own first `check` after the 2.7 update (field
  //                 reports #76, #79, #83, #93): one named 13 tickets with no readable delivery state, and 0 signal warnings after they were
  //                 fixed; one stayed silent because all four of its tickets carried an issue URL; one named 9 of 18 tickets, 3 of them
  //                 delivered and unreadable; one found a ticket filed locally and never sent, which it then sent (origin bugs/117 → DONE)
  try {
    const jm = readJson(KAIF_JSON);
    const KAIF_BUGS = 'bugs/KAIF';
    const FIELD_REPORTS = 'reports/KAIF_UPDATES';  // 2.8, epic CH (origin #78): an update/install field report is a signal too
    const FIELD_REPORT_SINCE = [2, 8];             // older reports were local by the canon of their time («A report stays LOCAL…»)
    if (jm.tracking === 'origin' && existsSync(KAIF_BUGS)) {
      for (const f of readdirSync(KAIF_BUGS).filter((n) => /^\d+_.*\.md$/i.test(n)).sort()) {   // tickets are bugs/KAIF/NN_*.md
        const p = KAIF_BUGS + '/' + f;
        const ds = deliveryState(readFileSync(p, 'utf8'));
        if (ds.state === 'not-yet')
          console.error(`⚠ undelivered KAIF signal: ${p} — "Delivered upstream: NOT YET" on tracking: origin is a debt with an owner, not a resting state (origin issue #65): node .kaif/kaif-core.mjs report ${p}`);
        else if (ds.state !== 'delivered' && ds.state !== 'resolved')
          console.error(`⚠ KAIF signal with no readable delivery state: ${p} — ${ds.state === 'missing' ? 'no `**Delivered upstream:**` line (the field name is machine-read: it stays verbatim in English in any project language)' : ds.state === 'ambiguous' ? `"${ds.line.trim().slice(0, 120)}" says NOT YET and names an issue (${ds.evidence}) at once` : `"${ds.line.trim().slice(0, 120)}" is neither NOT YET nor an issue URL or #NN`}; delivered → write only \`**Delivered upstream:** <issue URL or #NN>\`; not sent → write \`**Delivered upstream:** NOT YET — <why>\` with no issue URL or #NN and run node .kaif/kaif-core.mjs report ${p}; resolved by the origin without an issue → write \`**Delivered upstream:** resolved in origin <version>\` (origin issue #65; 2.8)`);
        else if (ds.state === 'resolved') {
          // judge CH5 F4: «resolved» is silent only with substance behind it — a version, and not newer than this deployment
          const rv = (ds.line.match(/resolved in (?:the )?origin\s+v?(\d+\.\d+)/i) || [])[1];
          if (!rv) console.error(`⚠ KAIF signal resolved in origin with no version: ${p} — write \`**Delivered upstream:** resolved in origin <version>\` (the release that resolved it)`);
          else if (jm.version && gt(rv, String(jm.version))) console.error(`⚠ KAIF signal resolved in origin ${rv} — newer than this deployment (${jm.version}): the resolution has not reached this tree yet: ${p}`);
        }
      }
    }
    // the field reports of 2.8+ — the version is read from the report's own file name (<PROJECT>_KAIF_<X.Y>_<UPDATE|INSTALL>_REPORT.md) or,
    // when the name does not date it, the report's own delivery line makes it a 2.8+ signal (C-F1); the same one reading of the delivery
    // line (deliveryState) as the tickets above
    if (jm.tracking === 'origin' && existsSync(FIELD_REPORTS)) {
      for (const f of readdirSync(FIELD_REPORTS).sort()) {
        if (!/\.md$/i.test(f)) continue;
        const v = f.match(/_KAIF_(\d+)\.(\d+)_(?:UPDATE|INSTALL)_REPORT\.md$/i);
        if (v && Number(v[1]) * 1000 + Number(v[2]) < FIELD_REPORT_SINCE[0] * 1000 + FIELD_REPORT_SINCE[1]) continue;
        const p = FIELD_REPORTS + '/' + f;
        const ds = deliveryState(readFileSync(p, 'utf8'));
        // (court RL C-F1) a report its file name does not date is judged by its own delivery line: the line arrived with 2.8, so a report
        // that carries it is a 2.8+ signal whatever the file is called; one with neither the canonical name nor the line stays silent
        if (!v && ds.state === 'missing') continue;
        if (ds.state === 'not-yet')
          console.error(`⚠ undelivered KAIF field report: ${p} — a field report is a KAIF signal, delivered in the same move as it is written (origin issues #15, #78; no owner's approval is awaited): node .kaif/kaif-core.mjs report ${p}`);
        else if (ds.state !== 'delivered' && ds.state !== 'resolved')
          console.error(`⚠ KAIF field report with no readable delivery state: ${p} — ${ds.state === 'missing' ? 'no `**Delivered upstream:**` line' : `"${ds.line.trim()}" is not NOT YET or a single issue URL or #NN`}: open the report with an H1 and \`**Delivered upstream:** NOT YET\`, then run node .kaif/kaif-core.mjs report ${p}`);
      }
    }
  } catch { /* unreadable marker or directory — the marker gate flags it separately */ }
  // The GENERATED team constitution against the TEMPLATE it came from (2.7, epic FR; origin issue #68 — a field
  // seat finished its half of a smoke, reported, and stopped while `STATUS.md` named three tickets "claimed by
  // nobody" and a second seat sat idle on the board; the owner ended the idling himself). The obligation existed —
  // as a trailing clause of the rule about blockers — and it did not survive GENERATION: the project's
  // `TEAM_CONSTITUTION.md` carried 5 rules where the template carried 9, template rules 4-7 simply absent, and no
  // gate said a word, because "a shorter document looks like editorial tightening rather than loss". This axis is
  // the gate the ticket asked for, and it generalises past its own rule: ANY obligation a skill's template carries
  // can be dropped in generation or translation, and until now nothing noticed.
  // WHAT AN OBLIGATION IS HERE: the bold anchor of every numbered item of § 2 (the communication regimen — where
  // the rules that bind a seat live) plus the nine invariant `## N.` section headings. Sections are matched by
  // their NUMBER, which survives translation; § 2 rules by their English anchor — and when NOT ONE anchor matches,
  // the document is translated, so the axis says so and falls back to COUNTING the items instead of judging a
  // translated document against English strings it never had. A warning, never a failure: the constitution is the
  // owner's document, and an owner-edited tree must not fail its own `check`. A deliberate omission is DECLARED,
  // not argued with — `<!-- constitution-ok: <why> -->` beside the item (or naming it) exempts that obligation.
  // No constitution on disk, or no template beside it, and the axis is silent: there is nothing to compare.
  // @guard constitution-keeps-obligations
  // THREAT:         an obligation of a skill's template is dropped when the skill GENERATES (or translates) the
  //                 project's document and nothing notices — the field constitution kept 5 of the template's 9 § 2
  //                 rules, "a free seat asks for work" among the four that vanished (origin issue #68)
  // PROVED-AGAINST: sandbox s25 on a deployed copy — constitution copied from the template → silent; the same file
  //                 with § 2 rules 4-7 cut (the field's own shape) → each of the four named by its anchor; a
  //                 translated copy whose § 2 holds five items → the counting warning "10 expected in §2, 5 found";
  //                 a deleted `## 7.` heading → named by number; a declared `<!-- constitution-ok: … -->` → that one
  //                 not named; no constitution → silent. Red: the 2.6 core (KAIF_DIST seam) silent on the cut file;
  //                 a mutant whose anchor parser returns nothing, silent on the same loss. Real state: a live field
  //                 team's own constitution copied into a fresh install (plans/113, run report 2026-09-18)
  // GAP:            it judges ANCHORS, not meaning — a bold lead over a gutted body reads as present; a PARTIALLY
  //                 translated § 2 (one English anchor surviving) is judged by anchors and over-names, the fail-safe
  //                 direction; only § 2 and the nine headings are compared, so a loss in § 5 or § 7 is invisible;
  //                 whether a seat OBEYS the rule belongs to the judge's two hunts, never here
  // ON-REAL-PATH:   NOT YET — the path is a field team's own `check` after the 2.7 update (a seeded copy of a real
  //                 constitution is not that path)
  try {
    const CONSTITUTION = 'TEAM_CONSTITUTION.md';
    const tplPath = ['.claude/skills', '.agents/skills', '.grok/skills', '.cline/skills']
      .map((b) => `${b}/team-deployment/references/team-constitution-template.md`).find((p) => okOnDisk(p));
    if (okOnDisk(CONSTITUTION) && tplPath) {
      const tpl = normEol(readFileSync(tplPath, 'utf8')), doc = normEol(readFileSync(CONSTITUTION, 'utf8'));
      const sections = (t) => Object.fromEntries([...t.matchAll(/^## (\d+)\.[ \t]*(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
      // § 2 of a document — its numbered items are the rules that bind a seat
      const regimen = (t) => { const i = t.search(/^## 2\./m); if (i < 0) return ''; const r = t.slice(i + 3); const j = r.search(/^## /m); return j < 0 ? r : r.slice(0, j); };
      const anchors = (t) => [...regimen(t).matchAll(/^[ \t]*\d+\.[ \t]+(?:[^\sA-Za-z*]+[ \t]*)?\*\*(.+?)\*\*/gm)].map((m) => m[1].trim());
      const tplSections = sections(tpl), docSections = sections(doc);
      const tplAnchors = anchors(tpl), docAnchors = anchors(doc);
      const exempt = [...doc.matchAll(/<!--[ \t]*constitution-ok:([\s\S]*?)-->/g)].map((m) => m[1].trim());
      const declared = (s) => exempt.some((e) => e.includes(s));
      const lost = [];
      for (const [n, title] of Object.entries(tplSections))
        if (!(n in docSections) && !declared(title)) lost.push(`§${n} "${title}"`);
      // An obligation is KEPT only when it stands where obligations stand — as the anchor of a numbered item of
      // § 2. Matching the anchor anywhere in the text would let a constitution that MENTIONS a rule it deleted
      // (an appendix of dropped rules, or the `constitution-ok` comment itself) read as compliant; that mistake
      // was caught by the mutant that ignores the exemption and changed nothing (plans/113 FR6).
      const kept = (a) => docAnchors.includes(a);
      // Translated: not ONE English anchor of § 2 survived, yet § 2 has numbered items — judge by COUNT, say so.
      const translated = tplAnchors.length > 0 && docAnchors.length > 0 && !tplAnchors.some(kept);
      if (!translated) for (const a of tplAnchors) if (!kept(a) && !declared(a)) lost.push(`§2 "${a}"`);
      const hint = `restore them, or declare the omission beside the item with \`<!-- constitution-ok: <why> -->\` (origin issue #68; template: ${tplPath})`;
      if (lost.length)
        console.error(`⚠ ${CONSTITUTION} lost ${lost.length} obligation(s) of the template: ${lost.join(', ')} — ${hint}`);
      if (translated) {
        const found = docAnchors.length + exempt.length;
        if (found < tplAnchors.length)
          console.error(`⚠ ${CONSTITUTION} cannot match translated anchors: ${tplAnchors.length} expected in §2, ${found} found — ${tplAnchors.length - found} obligation(s) of the template are missing from the communication regimen (the template's own order: ${tplAnchors.map((a, i) => `${i + 1} "${a}"`).join(', ')}) — ${hint}`);
      }
    }
  } catch { /* unreadable constitution or template — nothing to compare, and no other gate depends on it */ }
  // The budget DOOR of the closing ritual (2.7, epic CB6; origin issue #71 proposal 3 — the owner's
  // own audit: "three core documents above budget, the warning printed for weeks and executed once").
  // It stands HERE, after every other axis has spoken, so the run that fails on it still reports
  // everything else it saw; and it is opt-in by flag, because a budget is a reading cost, not a
  // broken deployment — `update-verify` and `verify-final` must never fail on it.
  // Since 2.8 the door is a RATCHET (budgetRatchet above): it reads and rewrites BUDGET_BASELINE on every run, including a green one —
  // the file's presence is what makes a later overflow a new one. An unreadable base is never a free pass: restore it from git.
  if (has('--gate-budgets')) {
    let base = null;
    if (existsSync(BUDGET_BASELINE)) {
      try { base = readJson(BUDGET_BASELINE); }
      catch { die(`--gate-budgets: ${BUDGET_BASELINE} is unreadable — restore it from git (\`git checkout -- ${BUDGET_BASELINE}\`); an unreadable baseline is never a free pass`); }
    }
    let version = null; try { version = readJson(KAIF_JSON).version || null; } catch { version = null; }
    const { verdicts, next } = budgetRatchet(overBudget, base, version);
    const body = JSON.stringify({ _note: `The budget ratchet of the closing gate (KAIF 2.8): own lines of each re-read-core document that stood ABOVE its budget at the last closing. Rewritten by \`node .kaif/kaif-core.mjs check --gate-budgets\` — commit it with the closing, never edit it by hand.`, version: next.version, docs: next.docs }, null, 2) + '\n';
    // UT3 (2.9, criterion 18; two field updates wrote the base mid-update — the door run from inside an open task recorded the debt of a
    // half-merged tree, and the next closing judged against it): while an update task is open the door judges and writes NOTHING
    // [TESTED: 2026-10-16 12:17 +03:00 · suites s21 U3 and s16 (UT3): open task — no base, the line says «run the door LAST»; closed task —
    //  the base is written; red on the dist of d5342b3 — report testcases/reports/2026-10-16_ut3-long-jump-honest.md]
    if (okOnDisk(UPDATE_TASK)) log(`ℹ --gate-budgets: ${UPDATE_TASK} is open — the base ${BUDGET_BASELINE} is not written mid-update; run the door LAST, after \`update-verify\` (the closing-gates item says so)`);
    else if (!existsSync(BUDGET_BASELINE) || readFileSync(BUDGET_BASELINE, 'utf8') !== body) writeFileSync(BUDGET_BASELINE, body);
    for (const v of verdicts)
      console.error(`${v.pass ? '↳' : '✖'} ${v.doc}: own lines ${v.own} of budget ${v.budget} → ${overflowAddress(v.overflowTo)} — ${v.why}`);
    const stops = verdicts.filter((v) => !v.pass);
    if (stops.length)
      die(`--gate-budgets: ${stops.length} document(s) of the re-read core are over their budget in the project's OWN lines and did not shrink — move the content out to the address named on each line, then run this again (raising a budget is not the cure; origin issue #71)`);
  }
  log(`✅ manifest satisfied: ${paths.length} files + ${agents.length} agent artifacts present${drifted ? ` (⚠ ${drifted} drifted mirrors — see above)` : ''}`);
}

// sync — the standalone handle over resyncCopies(): mirror drift accumulates BETWEEN updates,
// where the re-sync used to be unreachable (bug 11 facet; asked for by the field report).
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

// report <ticket> — deliver a local KAIF-defect ticket (bugs/KAIF/NN_*.md, /report-bug templates
// A/B) to the framework's origin through `gh`, then write the issue URL into the ticket's
// `**Delivered upstream:**` line.
// WHY MACHINERY (2.5, epic SG; field ticket "report-bug delivery module vs agent-system
// classifier", reproduced on two versions): the delivery step of /report-bug as PROSE could not
// even be WRITTEN to disk on one mainstream agent system — its safety classifier reacts to the
// subject matter ("post to the internet"), not to the wording. One command that the human's
// permission layer allowlists ONCE, while the skill only says "run it", is the smallest change
// left standing. AUTHORIZATION: the KAIF owner's standing rule (origin issue #15) — every KAIF
// defect an agent finds is reported by the agent to the KAIF GitHub, signed by the agent; the
// AGENT_GUIDE authorization gate names this carve-out inline (origin issue #37). TRANSPORT and
// AUTHORSHIP are two independent axes: the transport is whatever account `gh` holds (usually
// the owner's — normal); the AUTHOR is named by the trailer this command appends to the body.
// If the agent system's permission layer asks a human to confirm the call — let it ask: the
// prompt and the standing authorization compose, they never conflict.
// Outcomes, each named: tracking ≠ origin → exit 2 (the signal stays LOCAL; `NOT YET` is legal
// there) · `gh` missing or unauthenticated → exit 2 with the cure · already delivered → exit 0,
// prints the URL, never a second issue (idempotent) · not a KAIF ticket (no H1 or no
// `Delivered upstream:` line) → exit 1 · gh refused → exit 2 with gh's own words · TIMEOUT →
// exit 3 "OUTCOME UNKNOWN" — never reported as a refusal, because the issue may already exist
// and a blind repeat creates a duplicate (the send-outbound form of the origin repo).
// `--dry-run` prints title, repo and body path and calls nothing.
const GH_TIMEOUT_MS = Number(process.env.KAIF_GH_TIMEOUT_MS) || 60000;
function ghSpawn(ghArgs) {
  // Test seam (sandbox s17): KAIF_GH names a stand-in for `gh` — the polygon never performs an
  // outward action. A .mjs/.js path runs under this node; anything else is spawned as-is.
  const seam = process.env.KAIF_GH;
  const [cmd, pre] = seam ? (/\.m?js$/.test(seam) ? [process.execPath, [seam]] : [seam, []]) : ['gh', []];
  return spawnSync(cmd, [...pre, ...ghArgs], { encoding: 'utf8', timeout: GH_TIMEOUT_MS });
}
const refuse = (msg, code) => { console.error('✖ ' + msg); process.exit(code); };
// deliveryState(text) — the ONE reading of a ticket's delivery contract, shared by `report` (idempotency,
// refusals) and `check` (the undelivered-signal axis), so the two can never disagree about the same line
// (2.7, epic SD). The contract is read as a PARAGRAPH (2.6 UR4; origin #40) — the line plus its wrapped
// continuations up to a blank line or the next `**field**` (a hand-delivered field ticket wrote `origin **#37**`
// on the next line). Evidence of delivery is an ISSUE — an issue URL (`…/issues/N`), or `#NN` that stands as the
// value itself (`**Delivered upstream:** #37`, `✅ #37`) or right after the word origin/issue (`origin #37`,
// `origin **#37**`) — never any URL and never any `#digits` ("see step #2 of the skill" is not a delivery).
// States: delivered (an issue, no `not yet`) · not-yet (`not yet` in any case, no issue) · ambiguous (`not yet`
// AND an issue: "NOT YET — a recurrence of …/issues/37" must not read as sent, "…/issues/40 — fix not yet
// released" must not be sent twice, so both commands name it and neither guesses) · unrecognized · missing.
// Until 2.7 `report` let ANY URL win over `not yet` — a NOT YET ticket quoting a link could never be sent.
function deliveryState(text) {
  const t = normEol(text);
  const line = (t.match(/^\*\*Delivered upstream:\*\*[^\n]*$/m) || [])[0];
  if (!line) return { state: 'missing' };
  const para = (t.match(/^\*\*Delivered upstream:\*\*[^\n]*(?:\n(?![ \t]*$)(?!\*\*)[^\n]*)*/m) || [line])[0];
  const notYet = /not yet/i.test(para);
  const issue = para.match(/https?:\/\/[^\s)*]*\/issues\/\d+/)
    || para.match(/^\*\*Delivered upstream:\*\*[ \t]*(?:✅[ \t]*)?(?:\*\*)?(#\d+)\b/)
    || para.match(/\b(?:origin|issue)[ \t]+(?:\*\*)?(#\d+)\b/i);
  if (issue && issue[1]) issue[0] = issue[1];   // evidence prints as `#NN`, not with the words around it
  if (issue && !notYet) return { state: 'delivered', line, evidence: issue[0] };
  // 2.8, epic CH (criterion 13; finding K-R3b): a ticket the ORIGIN resolved without an issue (a withdrawal, a fix that shipped) is a
  // legal resting state — silent in `check`, «nothing to send» in `report`; never read as a delivery (no issue) nor as NOT YET
  if (!issue && !notYet && /\bresolved in (?:the )?origin\b/i.test(para)) return { state: 'resolved', line };
  if (issue) return { state: 'ambiguous', line, evidence: issue[0] };
  return { state: notYet ? 'not-yet' : 'unrecognized', line };
}
function cmdReport() {
  const ticket = args.slice(1).find((a) => !a.startsWith('-')); // the flag may precede the path (court RL 2.5, C-H2)
  if (!ticket || ticket.startsWith('--')) die('usage: kaif-core report <path to bugs/KAIF/NN_*.md or reports/KAIF_UPDATES/*_REPORT.md> [--dry-run]');
  const dryRun = args.includes('--dry-run');
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
  if (j.tracking !== 'origin')
    refuse(`tracking is "${j.tracking || 'none'}", not "origin" — the signal stays LOCAL and \`Delivered upstream: NOT YET\` is legal here; to deliver, tie the deployment to the origin first (/kaif-switch-origin)`, 2);
  const repo = String(j.origin || ORIGIN).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) die(`origin "${j.origin}" is not a github.com/<owner>/<repo> URL`);
  if (!okOnDisk(ticket)) die(`ticket not found: ${ticket}`);
  const text = readFileSync(ticket, 'utf8');
  const h1 = (text.match(/^# (.+?)\s*$/m) || [])[1];
  const lineRe = /^\*\*Delivered upstream:\*\*[^\n]*$/m;
  // The contract is read by deliveryState() — the same reading the `check` axis uses (see its comment for the
  // paragraph rule). A delivered ticket fires the idempotency branch instead of a refusal, so a ticket delivered
  // by hand can never be sent twice; a refusal names BOTH legal forms and the edit.
  const ds = deliveryState(text);
  if (!h1 || ds.state === 'missing')
    die(`${ticket} is not a KAIF ticket: it needs an H1 title and a \`**Delivered upstream:**\` line (/report-bug templates A/B; the field name stays verbatim in English in any project language)`);
  if (ds.state === 'delivered') { log(`✔ already delivered: ${ds.evidence} — nothing sent (idempotent; edit the line by hand only if that issue is gone)`); return; }
  if (ds.state === 'resolved') { log(`✔ resolved in the origin: "${ds.line.trim()}" — nothing to send (2.8, epic CH)`); return; }
  if (ds.state === 'ambiguous')
    die(`the Delivered upstream line says NOT YET and names an issue (${ds.evidence}) at once: "${ds.line.trim()}" — nothing sent: a delivered ticket must never be sent twice, and an undelivered one must never read as sent. Delivered by hand → keep only \`**Delivered upstream:** <issue URL or #NN>\`; not sent → keep \`**Delivered upstream:** NOT YET — <why it waits>\` without an issue URL or #NN (name a related issue in the body), then re-run`);
  if (ds.state === 'unrecognized')
    die(`the Delivered upstream line is neither NOT YET nor a delivery: "${ds.line.trim()}" — write it in one of the legal forms and re-run: \`**Delivered upstream:** NOT YET — <why it waits>\` (undelivered; the case of "not yet" does not matter), \`**Delivered upstream:** <issue URL or #NN>\` (delivered by hand) or \`**Delivered upstream:** resolved in origin <version>\` (the origin resolved it without an issue, 2.8)`);
  // The body is the ticket itself plus the authorship trailer — transport ≠ author (#15).
  const trailer = '\n\n---\nFiled by the project\'s agent under the KAIF owner\'s standing authorization (origin issue #15); ' +
    'transport — the `gh` account of the deploying machine. Delivered by `kaif-core report` (KAIF ' + (j.version || '?') + ').\n';
  const bodyDir = mkdtempSync(join(tmpdir(), 'kaif-report-'));   // unique by construction (bugs/59)
  const bodyPath = join(bodyDir, 'body.md');
  writeFileSync(bodyPath, text.replace(/\r\n/g, '\n').replace(lineRe, '**Delivered upstream:** (this issue)') + trailer);
  const cleanup = () => { try { rmSync(bodyDir, { recursive: true, force: true }); } catch { /* temp — best effort */ } };
  if (dryRun) { log(`DRY-RUN: would run \`gh issue create --repo ${repo} --title "${h1}" --body-file ${bodyPath}\` — nothing sent; the body is kept there for inspection`); return; }
  let r = ghSpawn(['auth', 'status']);
  if (r.error && r.error.code === 'ENOENT') { cleanup(); refuse('`gh` is not on PATH — install GitHub CLI (https://cli.github.com), run `gh auth login`, then repeat; on tracking: origin the ticket\'s NOT YET is a debt with an owner, not a resting state', 2); }
  if (r.error || r.status !== 0) { cleanup(); refuse(`gh is not ready (\`gh auth status\` → ${r.error ? r.error.code : 'exit ' + r.status}): ${((r.stderr || r.stdout || '').trim() || 'no output')} — run \`gh auth login\` and repeat`, 2); }
  r = ghSpawn(['issue', 'create', '--repo', repo, '--title', h1, '--body-file', bodyPath]);
  if (r.error || r.status === null) {
    if ((r.error && r.error.code === 'ETIMEDOUT') || r.signal) {
      console.error(`⚠ OUTCOME UNKNOWN: gh gave no answer within ${GH_TIMEOUT_MS} ms — the issue MAY already exist. CHECK before repeating (a blind repeat creates a duplicate): gh issue list --repo ${repo} --search "${h1}"; then write the URL into ${ticket} by hand. Body kept at ${bodyPath}`);
      process.exit(3);
    }
    cleanup(); die(`gh could not be started (${(r.error && r.error.code) || 'unknown'})`);
  }
  if (r.status !== 0) { cleanup(); refuse(`gh refused (exit ${r.status}): ${((r.stderr || r.stdout || '').trim() || 'no output')} — the ticket stays NOT YET`, 2); }
  const url = ((r.stdout || '').match(/https?:\/\/\S+/) || [])[0];
  if (!url) { cleanup(); die(`gh returned no issue URL: ${(r.stdout || '').trim() || 'no output'}`); }
  writeMatchingEol(ticket, text.replace(lineRe, `**Delivered upstream:** ${url}`));
  cleanup();
  log(`✔ delivered: ${url} — written into ${ticket} (Delivered upstream)`);
}

// project-name "<Name>" — the file-edit-free way to record the project's CANONICAL name
// (identity belongs to the owner: <PROJECT_NAME> used to be seeded from package.json/folder —
// a lowercase tech id — and landed in H1 headings; "# my-shop" while the project's canon said
// My Shop). Heals the deploy manifest's frozen fill map too, or the tech id tiles forever.
// ── ONE door for every piece of HUMAN text on the command line (bugs/75) ─────────────────────
// The canon rule binds the ARGUMENT, not the document: "TEXT TRAVELS THROUGH FILES, NEVER THROUGH
// COMMAND-LINE ARGUMENTS." It had been applied to ONE command (`checkpoint --verdict`) and never
// became a property of the CLASS — so `project-name`, born later, arrived uncovered, and its own
// help text says the value is the OWNER's ("confirm it with the owner, never guess"). A mangled
// name here is not merely lost, it is WRITTEN DOWN: into the deploy marker, into the
// <PROJECT_NAME>/<SHORT_NAME> fill map and into every document seeded from it.
//
// Every human-text input goes through this door, so the NEXT such command is covered on the day
// it is written instead of on the day someone remembers the rule.
//   · file variant wins and is BOM-tolerant, EOL-normalized — it honours the canon;
//   · inline variant WARNS on non-ASCII, never refuses: ASCII one-liners are legitimate, and
//     refusing would break field flows that already work on shells where argv survives;
//   · both at once is an error — two sources of one truth is the drift class itself.
function readOwnerText(inline, filePath, what) {
  if (filePath && inline) die(`pass either --${what}-file or the inline value, not both — two sources of one truth drift apart`);
  if (filePath) {
    if (!existsSync(filePath)) die(`${what} file not found: ${filePath}`);
    const full = normEol(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')).trim();
    if (!full) die(`${what} file is empty: ${filePath}`);
    return { full, firstLine: full.split('\n').find((l) => l.trim()).trim(), fromFile: true };
  }
  // P5 (2.5, epic US; #28 R4): a value that ARRIVED mangled (replacement characters, or nothing
  // but question marks — the two shapes a shell's argv conversion leaves) is refused BEFORE the
  // act: recording it would seed the damage into the marker and every fill. The guidance itself
  // reaches the agent earlier still — the task items name the file form next to the argv form.
  if (inline && (/�/.test(inline) || /^[?\s]+$/.test(inline))) {
    die(`the ${what} argument arrived MANGLED by the shell ("${inline}") — nothing recorded; non-ASCII text travels through files: --${what}-file <path>`);
  }
  if (inline && /[^\x20-\x7E]/.test(inline)) {
    log(`⚠ non-ASCII text in the ${what} argument travels through the shell and can be silently mangled on some profiles (PowerShell 5.1, MSYS2 argv conversion) — prefer --${what}-file: text travels through files`);
  }
  return { full: inline || null, firstLine: inline || null, fromFile: false };
}

function cmdProjectName() {
  const { full: name } = readOwnerText(
    args[1] && !args[1].startsWith('--') ? args[1] : null, val('--name-file'), 'name');
  if (!name) die('usage: kaif-core project-name "<Canonical Name>" | --name-file <path>   (the OWNER\'s form, e.g. "My Shop" — confirm it with the owner, never guess; non-ASCII belongs in a file)');
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
  j.projectName = name;
  writeFileSync(KAIF_JSON, JSON.stringify(j, null, 2) + '\n');
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try {
      const m = readJson(DEPLOY_MANIFEST);
      m.values = m.values || {};
      if (m.values['<SHORT_NAME>'] === m.values['<PROJECT_NAME>']) m.values['<SHORT_NAME>'] = name;
      m.values['<PROJECT_NAME>'] = name;
      if (m.marker) m.marker.projectName = name;   // the pristine snapshot must not resurrect the tech id (healMarker)
      writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
    } catch { /* unreadable manifest — `check` flags it separately */ }
  }
  log(`✔ canonical project name recorded: ${name} — future fills use it; already-seeded headings need your correction (git grep the old form)`);
}

// checkpoint <id> — the file-edit-free way to record a finished task item (field lesson,
// ДЗ-02 run 4: weak models corrupt files when forced to edit them via diff tools; a shell
// command they run reliably). Appends the forced line to the live task file itself.
function cmdCheckpoint() {
  const id = args[1];
  if (!id || id.startsWith('--')) die('usage: kaif-core checkpoint <item-id> [--verdict-file <path> | --verdict "<ascii one-liner>"]');
  const file = okOnDisk(UPDATE_TASK) ? UPDATE_TASK : okOnDisk(TASK_FILE) ? TASK_FILE : null;
  if (!file) die('no task file found — nothing to checkpoint');
  const tag = file === UPDATE_TASK ? 'KAIF-UPDATE' : 'KAIF-ADAPT';
  const task = normEol(readFileSync(file, 'utf8'));   // bug 24: $-anchors vs a CRLF-resaved task
  if (!task.includes(`kaif-core.mjs checkpoint ${id}`) && !task.includes(`${tag}: ${id} done`))
    die(`unknown item id "${id}" — it is not named in ${file}`);
  // Checkpoints EXECUTE their own gate where one exists (bug 17: recording a tick used to be
  // free — a weak model could stamp all four without doing anything; bug 34 / field report D5: the
  // scanners for placeholders and stale-claims EXISTED and re-running them at tick time costs
  // zero — a tick that skips an existing scanner is self-attestation):
  //   recheck      — re-syncs the mirrors (closes the drift window — field report Г11), then runs the
  //                  actual `check` and refuses to record on failure; on a task written by a core older than
  //                  2.8 (no closing-gates item) it first names where the first closing stops (the hand-over);
  //   closing-gates — measures the closing gates again over the merged tree for VISIBILITY, never refuses;
  //   placeholders — runs the placeholder scanner and refuses while literal slots remain
  //                  (the item's contract is "fill each" — an unfilled slot is objective);
  //   stale-claims — re-runs the scanner for VISIBILITY (its contract allows "state why a
  //                  line is correct", so remaining hits warn, never refuse);
  //   judge        — requires a verdict with evidence (file or one-liner; recorded next to
  //                  the tick, and into the committable receipt — decision #42).
  if (id === 'recheck') {
    // The mirror re-sync used to live only in update-verify, leaving five agent systems on
    // contradicting skills for the whole merge window (bug 34, field report Г11) — close it here.
    resyncCopies();
    // SW5 (2.9, #130 · #126) — the same hand-over for ignore-first: `update` ran the DEPLOYED core's set (a 2.8 core leaves the bare
    // `KAIF.md` line and no `.kaif/.contour-tmp/`), so this tick — the FRESH core, in the task of every version — brings the set to its
    // own form before `check` judges it (the functional run over an update 2.8 → 2.9 found the route: check red, a render in git status).
    // [TESTED: 2026-09-29 21:46 +03:00 · suite s01 S9, the route over an older core (red on a mutant without this line), and the functional run,
    //  run 12 — testcases/reports/2026-09-29_sw-delivered-wired.md]
    ensureIgnoreFirst();
    // The hand-over of the closing-gates forecast (2.8, epic CK, step CK5.6): `update` writes its task with the core that was
    // DEPLOYED when it ran (the fresh core is swapped in at the end — /kaif-update, the route note), so a task written by a core older
    // than 2.8 has no closing-gates item. This tick runs the FRESH core, and `recheck` stands in the task of every version — so the
    // fresh core names where the first closing stops here, over the merged tree (found by the functional run over a field clone).
    if (tag === 'KAIF-UPDATE' && !task.includes('kaif-core.mjs checkpoint closing-gates')) {
      let version = null; try { version = readJson(KAIF_JSON).version || null; } catch { version = null; }
      log('ℹ closing gates — this task was written by the previous core, which had no closing-gates item; where the first closing stops, measured now over the merged tree (read-only):');
      for (const l of closingGatesForecast(version)) log('    · ' + l);
    }
    // The hand-over of the withdrawn-phrases item (light re-judge RL 2.8, J-F2) — the same two-author route: a task written by a core
    // older than 2.8 has no such item, so a withdrawal SINCE the deployment's own release (court C-F2) never reached it. The fresh core
    // reads the deprecations from the bundle this update brought and the interval from the marker's history, and names the item here.
    // UT2 (2.9, criterion 17): the update by the previous core never touched the pointers — this tick (the fresh core) replaces the
    // untouched ones and names an edited one that lacks the resume rule (update-verify refuses until it has it)
    if (tag === 'KAIF-UPDATE') {
      const ptr = syncPointers();
      if (ptr.needRule.length) log(`⚠ pointers — ${POINTER_RULE_HINT(ptr.needRule)}; \`update-verify\` refuses until then`);
    }
    // UT1 (2.9): a task WITH the item but written by a core before 2.9 lists no places — and even this core's list is the state at
    // writing; the tick names the places LEFT now, over the merged tree, so the agent sees its own progress (read-only).
    if (tag === 'KAIF-UPDATE') {
      const bw = parseBundle('.kaif/install/KAIF-CORE-BUNDLE.md', true);
      let from = null; try { const h = readJson(KAIF_JSON).history || []; from = h.length ? h[h.length - 1].from : null; } catch { from = null; }
      if (!task.includes('- **withdrawn-phrases**')) {
        const item = bw && bw.meta && from ? withdrawnPhrasesItem(bw.meta, from) : null;
        if (item) log(`ℹ withdrawn phrases — this task was written by the previous core, which had no withdrawn-phrases item; do it as part of this update (${from} → ${bw.meta.version}): ${item}`);
      } else if (bw && bw.meta && from) {
        const w = withdrawnPlaces(bw.meta, from);
        if (w) log(`ℹ withdrawn phrases (${from} → ${bw.meta.version}) — places left now:${fmtPlaces(w) || ' none'}`);
      }
    }
    // The hand-over of the owner-voice snapshot sync (2.8, epic VO, VO3) — the same two-author route: a task written by a core older
    // than 2.8 has no owner-voice-core item. The fresh core reads the release pin from the bundle this update brought and REFUSES
    // while a derived portrait is not the release snapshot — the owner's word is a requirement, not a forecast (origin issue #103).
    if (tag === 'KAIF-UPDATE' && !task.includes('kaif-core.mjs checkpoint owner-voice-core')) {
      const b = parseBundle('.kaif/install/KAIF-CORE-BUNDLE.md', true);
      const ov = b && b.meta ? portraitSync(b.meta.ownerVoice) : null;
      if (ov) die(`checkpoint recheck REFUSED — this task was written by the previous core, which had no owner-voice-core item; the release requires it: ${ownerVoiceInstruction(ov)} After the replacement re-run \`node .kaif/kaif-core.mjs checkpoint recheck\`.`);
    }
    // spawnSync + process.execPath: no shell (paths with $/backticks survive on POSIX),
    // no PATH lookup (the same node binary that runs this process runs the check).
    // BOTH streams are surfaced: `check` writes its warnings to STDERR and exits 0, and a green run used to print its stdout only —
    // on the update route of an older core `recheck` said «check ran green» over six delivered hooks that were not wired, the line
    // `check` itself prints (2.9, epic SW, J-SW2: the functional run of the field route 2.8 → 2.9, probe sw-field-route.mjs).
    // [TESTED: 2026-10-14 11:26 · s01 S9 SW2 «recheck names the delivered hooks that are not wired»; red on the mutant W9 of hooks-mutants
    //  and on the build 41c6c7d (the field-route probe, 6 of 6 subjects); report testcases/reports/2026-10-14_sw-field-route.md]
    const chk = spawnSync(process.execPath, [process.argv[1], 'check'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (chk.stdout) process.stdout.write(chk.stdout);
    if (chk.stderr) process.stderr.write(chk.stderr);
    if (chk.status !== 0) die('checkpoint recheck REFUSED: `check` failed' + (chk.error ? ` (${chk.error.message})` : '') + ' — fix the issues above, then re-run');
    log('✔ check ran green (executed by the checkpoint itself)');
  }
  if (id === 'placeholders') {
    // Mirrors legally lag the canon until a re-sync (bug 27: the verify gate re-syncs BEFORE
    // scanning for exactly this reason) — the checkpoint's scan honors the same order, or a
    // correctly-filled canon would be refused over its own stale mirrors.
    resyncCopies();
    const bad = scanPlaceholders();
    if (bad) die(`checkpoint placeholders REFUSED: ${bad} literal placeholder(s) remain on disk (listed above) — fill them in the canonical copies, then re-run`);
    log('✔ placeholder scan ran clean (executed by the checkpoint itself; mirrors re-synced first)');
  }
  if (id === 'project-name') {
    // The item's contract is "record the canonical name" — an unrecorded name is objective,
    // exactly like an unfilled placeholder (identity is the owner's; the tick may not attest it).
    let recorded = null;
    try { recorded = readJson(KAIF_JSON).projectName; } catch { /* refused below */ }
    if (!recorded) die('checkpoint project-name REFUSED: no projectName in .kaif/kaif.json — confirm the canonical name with the owner and record it first: node .kaif/kaif-core.mjs project-name "<Canonical Name>"');
    log(`✔ canonical name on record: ${recorded} (executed by the checkpoint itself)`);
  }
  if (id === 'owner-voice') {
    // The item's contract is objective on both branches (issue #4): either the portrait is
    // INSTALLED, or the "owner has none" fact is RECORDED where the next session reads it —
    // a bare tick attests neither. The record is a canonical English line (like the DONE tag
    // and the [TESTED] markers) so the gate greps it in any project language; the ignore half
    // stays the agent's judgement (public vs private repository).
    const hasPortrait = okOnDisk('AUTHOR_STYLOMETRY.md');
    const recorded = existsSync('AGENT_GUIDE.md') && readFileSync('AGENT_GUIDE.md', 'utf8').includes('no voice portrait');
    if (!hasPortrait && !recorded)
      die('checkpoint owner-voice REFUSED: neither AUTHOR_STYLOMETRY.md on disk nor a `no voice portrait` record in AGENT_GUIDE.md — install the portrait (skill /owner-voice) or record the owner\'s "none" first (canonical line: `no voice portrait`, with date, under "Notes from the human")');
    log(hasPortrait ? '✔ owner voice portrait on disk: AUTHOR_STYLOMETRY.md (executed by the checkpoint itself)'
                    : '✔ `no voice portrait` recorded in AGENT_GUIDE.md (executed by the checkpoint itself)');
  }
  if (id === 'stale-claims') {
    try {
      const rec = okOnDisk(LAST_UPDATE) ? readJson(LAST_UPDATE) : null;
      const man = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : null;
      if (rec && rec.from && rec.to) {
        const hits = scanStaleClaims(rec.from, rec.to, man && man.templateShas);
        // the "shown N of M" truncation notice is a service line, not a hit — count real ones
        const real = hits.filter((h) => !h.startsWith('shown ') && !h.startsWith(WALK_NOTE)).length;
        const walkFailed = hits.some((h) => h.startsWith(WALK_NOTE) && h.includes('walk FAILED'));
        if (real) { log(`⚠ stale-claims scan re-ran: ${real} line(s) still assert the old version — the tick records anyway (stating why a line is correct is a legal completion):`); for (const h of hits) log('    · ' + h); }
        else if (walkFailed) { log('⚠ stale-claims scan re-ran but could NOT see the whole tree — not a clean result (the tick records on your word):'); for (const h of hits) log('    · ' + h); }
        else { log('✔ stale-claims scan ran clean (executed by the checkpoint itself)'); for (const h of hits) log('    · ' + h); }
      } else log('⚠ stale-claims scan skipped: no update receipt with from/to versions — tick records on your word');
    } catch (e) { log(`⚠ stale-claims scan errored (${e.message}) — tick records on your word`); }
  }
  if (id === 'owner-voice-core') {
    // The item names the release pin in its own text (sha256 and the snapshot's first line): the tick verifies the snapshot part of
    // the portrait against it and refuses until it matches — «заменой», checked by bytes, not attested (2.8, epic VO; issue #103).
    const item = (task.match(/^- \*\*owner-voice-core\*\* — [^\n]*/m) || [''])[0];
    const want = (item.match(/its sha256 \(LF\) is ([0-9a-f]{64})/) || [])[1];
    const head = (item.match(/from its first line «([^»\n]+)»/) || [])[1];
    if (!want || !head) die('checkpoint owner-voice-core REFUSED: the task item carries no release pin (sha256 / first line) — the task is not one this core wrote');
    if (!okOnDisk(PORTRAIT_FILE)) die(`checkpoint owner-voice-core REFUSED: ${PORTRAIT_FILE} is not on disk — the release snapshot replaces it, never deletes it`);
    const tail = snapshotTail(readFileSync(PORTRAIT_FILE, 'utf8'), head);
    if (tail === null) die(`checkpoint owner-voice-core REFUSED: ${PORTRAIT_FILE} has no line «${head}» — the release snapshot is not in it yet (fetch it and put it after your local part, byte for byte)`);
    const got = lfSha256(tail);
    let heads = [];
    try { const b = parseBundle('.kaif/install/KAIF-CORE-BUNDLE.md', true); heads = (b && b.meta && b.meta.ownerVoice && b.meta.ownerVoice.heads) || []; } catch { heads = []; }
    const merged = mergedAbove(readFileSync(PORTRAIT_FILE, 'utf8'), { head, heads });
    if (merged) die(`checkpoint owner-voice-core REFUSED: the local part of ${PORTRAIT_FILE} above «${head}» still carries «${merged}» — the first line of a public snapshot: the previous portrait is still in the file; replace, do not merge (keep only your local part above the release snapshot)`);
    if (got !== want) die(`checkpoint owner-voice-core REFUSED: the snapshot part of ${PORTRAIT_FILE} (from «${head}» to the end) has sha256 ${got}, the release pins ${want} — replace, do not merge; a tool that stamps blocks into it runs after this checkpoint`);
    log(`✔ voice portrait: the snapshot part of ${PORTRAIT_FILE} equals the release snapshot byte for byte (sha ${want.slice(0, 12)}) — executed by the checkpoint itself`);
  }
  if (id === 'closing-gates') {
    // The item is a forecast (2.8, epic CK, step CK5.6): the tick measures the gates again over the MERGED tree, for visibility, and
    // records anyway — acting on a STOPS line or carrying it into the closing is the agent's call, and update-verify never fails on a
    // budget. The version is the deployed one: after the update the marker already carries it.
    let version = null; try { version = readJson(KAIF_JSON).version || null; } catch { version = null; }
    const now = closingGatesForecast(version);
    const stops = now.filter((l) => / — STOPS: /.test(l)).length;
    log(stops ? `⚠ closing gates measured again: ${stops} line(s) still STOP the first closing — the tick records anyway:` : '✔ closing gates measured again: nothing stops the first closing (executed by the checkpoint itself):');
    for (const l of now) log('    · ' + l);
  }
  if (id === 'field-report') {
    // Epic M / decision #46: an update or install is not green without its field report. The
    // item's contract is objective — the report FILE exists in reports/KAIF_UPDATES/ under the
    // version this pass delivered (writing it well is the agent's judgement; existing is not).
    // Version pin: a stale report from a PREVIOUS interval must not satisfy this pass's tick.
    const r = fieldReportOnDisk(tag);
    if (!r.found.length)
      die(`checkpoint field-report REFUSED: no *_KAIF_${r.ver || '<version>'}_${r.kind}_REPORT.md in ${r.dir}/ — write the field report first (its sections are in the task item; genre canon: reports/README.md)`);
    log(`✔ field report on disk: ${join(r.dir, r.found[0])} (executed by the checkpoint itself)`);
    // 2.8 (court RL C-F1): on the update route the task was written by the OUTGOING core, whose field-report item never said "deliver"
    // (the delivery sentence arrived with 2.8, epic CH) — this checkpoint runs on the DELIVERED core, so it states the delivery itself.
    // A warning, never a refusal: an update without a network must still finish; the `check` axis names the report again (FORK B, plans/125).
    try {
      if (readJson(KAIF_JSON).tracking === 'origin') {
        const rp = `${r.dir.replace(/\\/g, '/')}/${r.found[0]}`;
        const ds = deliveryState(readFileSync(rp, 'utf8'));
        if (ds.state !== 'delivered' && ds.state !== 'resolved')
          console.error(`⚠ the field report is not delivered to KAIF yet — a field report is a KAIF signal, delivered in the same move (the KAIF owner's standing authorization, origin issues #15 · #78; no owner's approval is awaited): ${ds.state === 'missing' ? 'open it with an H1 and `**Delivered upstream:** NOT YET` right under it, then run ' : 'run '}node .kaif/kaif-core.mjs report ${rp}`);
      }
    } catch { /* an unreadable marker or report — the check axis names it */ }
  }
  let verdictLine = null;
  if (id === 'study') {
    // 2.9 (origin tickets #143 · #145): the item EXECUTES its gate — the refresh witness is on disk, names what was re-read and is from
    // this hour (the timer's own interval); a stale, empty or unreadable one is not a witness.
    // [TESTED: 2026-10-16 10:17 · s14 «study» — no marker / 90 min old refused, fresh recorded; red on the build a81cc95; mutant W13 red on
    //  its addressees (33/33); polygon 28/28 with s03 · s04 · s07 stamping first; report testcases/reports/2026-10-16_study-refresh-witness.md]
    const STUDY_MARKER = '.kaif/refresh-marker.json', STUDY_MARKER_MAX_MIN = 60, STUDY_MARKER_FUTURE_MIN = 5;
    let m = null; try { m = readJson(STUDY_MARKER); } catch { m = null; }
    const age = m && typeof m.at === 'string' ? (Date.now() - Date.parse(m.at)) / 60000 : NaN;
    const why = !m ? `${STUDY_MARKER} is missing or not JSON` : !Array.isArray(m.docs) || !m.docs.length ? `${STUDY_MARKER} names no re-read document ("docs")`
      : Number.isNaN(age) ? `${STUDY_MARKER} has no readable "at"` : age > STUDY_MARKER_MAX_MIN ? `${STUDY_MARKER} is ${Math.round(age)} min old`
      : age < -STUDY_MARKER_FUTURE_MIN ? `${STUDY_MARKER} is stamped in the future` : null;
    if (why) die(`${why} — re-read the nine re-read-core documents and stamp the refresh witness (the study item says how), then tick again: without it the wired refresh timer fires at the owner's first prompt (origin tickets #143 · #145)`);
  }
  if (id === 'wire-hooks') {
    // SW (2.9, origin issue #115): the item EXECUTES its gate — wired, opted out ("hooks": "off"), or no system here that reads
    // .claude/settings.json → recorded; hooks NOT wired → only with the words of the refusal, never silently (the harness may refuse
    // the write, and that refusal is not worked around — origin research 37)
    const hw = hookWiringState();
    if (!['wired', 'off', 'no-system'].includes(hw.state)) {
      const { firstLine: v } = readOwnerText(val('--verdict'), val('--verdict-file'), 'verdict');
      const why = hw.state === 'missing' ? wiringWork(hw).join(' · ') : hw.state === 'unreadable' ? `${hw.file}: ${hw.error}` : `${HOOK_FRAGMENT} missing`;
      if (!v) die(`the delivered hooks are NOT wired (${why}) — run \`node .kaif/kaif-core.mjs wire-hooks\`; if your harness REFUSED that write, do not work around it: record its words — \`checkpoint wire-hooks --verdict "<the refusal>"\` — and give the owner that one command in the farewell and in the field report`);
      verdictLine = `${tag}: wire-hooks NOT wired (${why}): ${v}`;
    }
  }
  if (id === 'lint-baselines') {
    // SW2 (2.9, origin issue #115): the item EXECUTES its gate — every lint the task named has its baseline on disk now
    const absent = CLOSING_LINTS.filter(([, mod, b]) => b && task.includes(`node ${mod} check --write-baseline`) && !existsSync(b));
    if (absent.length) die(`no baseline yet: ${absent.map(([, mod, b]) => `${b} — run \`node ${mod} check --write-baseline\``).join(' · ')}`);
  }
  if (id === 'judge') {
    // Same door as project-name (bugs/75): the warning and the file variant belong to the CLASS
    // of human text, not to one command that happened to be written first.
    const { full: fullText, firstLine: v } = readOwnerText(val('--verdict'), val('--verdict-file'), 'verdict');
    if (!v) die('checkpoint judge requires --verdict-file <path> (multiline, any language — text travels through files, never through command-line arguments) or --verdict "<ascii one-liner>" — an unevidenced tick is exactly the fraud /fable-judge hunts');
    verdictLine = `${tag}: judge verdict: ${v}`;
    // Decision #42: the verdict rides the COMMITTABLE receipt — the task file is transient.
    if (okOnDisk(LAST_UPDATE)) {
      try { const r = readJson(LAST_UPDATE); r.judgeVerdict = fullText || v; writeFileSync(LAST_UPDATE, JSON.stringify(r, null, 2) + '\n'); log(`+ verdict recorded into the receipt (${LAST_UPDATE})`); }
      catch { /* unreadable receipt — the verdict still lives in the task line */ }
    }
  }
  const line = `${tag}: ${id} done`;
  if (new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) {
    // A judge tick that exists WITHOUT its verdict (e.g. hand-written — the exact bug-17 move)
    // must still be repairable by the very command the failing gate recommends (review-caught
    // deadlock: "already recorded" used to discard the verdict and the gate stayed red forever).
    if (id === 'judge' && verdictLine && !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
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
// 113/160 stale shas and killed the mechanical path forever — field report №10). Every path that
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
  if (!src && val('--render')) die('--render prints a file as install of a SOURCE writes it — name the source: diff --source <dir|url> --render <file>');   // court UP6b, C7
  if (!src) {
    if (!m.templateShas)
      die('this deployment carries a v1 manifest (no template provenance) — the audit would report a hollow green. Run the next `update` (it upgrades the manifest to v2), then `diff` works.');
    let match = 0, missing = 0;
    const divFiles = [];
    const fills = m.fills || {};   // "template + fills" is a MATCH in the audit too (2.6, UR2)
    const hasFills = Object.keys(fills).length > 0;
    for (const p of m.paths || []) {
      const tpl = (m.templateShas || {})[p];
      if (!tpl) continue;
      if (!okOnDisk(p)) { missing++; continue; }
      if (fileShaNorm(p) === tpl || (hasFills && normSha(unfill(readFileSync(p, 'utf8'), fills)) === tpl)) match++; else divFiles.push(p);
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
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = checkedLang(j.language, 'the deploy marker'); } catch { /* default stands */ }
  }
  const srcBase = resolveSourceBase(src);   // bare github.com/<o>/<r> → its latest-release assets (issue #10)
  const man2 = JSON.parse((await fetchArtifact(srcBase, 'kaif-manifest.json')).toString('utf8').replace(/^\uFEFF/, ''));
  mkdirSync('.kaif/install', { recursive: true });
  const tmp = '.kaif/install/DIFF-BUNDLE.md';
  writeFileSync(tmp, await fetchArtifact(srcBase, 'KAIF-CORE-BUNDLE.md'));
  const { files, meta } = parseBundle(tmp);
  unlinkSync(tmp);
  const { deploy: otherDeploy } = applyLanguage(files);
  const values = stableValues();   // preview must fill exactly like the deploy did (bug 26)
  // 2.8 (court UP6, R3 — K-R2a: three field deployments built the same three-way comparison by hand, because nothing printed the
  // file as it deploys in THEIR language): `--render <file>` prints ONLY that file as `install` of this source writes it for THIS
  // deployment — its language (override and trigger aliases), its fills, its mode. The oracle of a hand merge: render the old source
  // and the new one, compare both with the disk. Nothing is written, no rehearsal is recorded.
  const renderPath = val('--render');
  if (renderPath) {
    const want = renderPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (isSkippedAnon(want)) die(`--render ${renderPath}: this deployment is anonymous and install never writes this origin-tied skill here`);
    const f = otherDeploy.find((x) => x.path === want);
    if (!f) die(`--render ${renderPath}: the ${man2.version} bundle does not ship this file (name it by its deployed path — AGENT_GUIDE.md, .claude/skills/<name>/SKILL.md, .kaif/KAIF_REFERENCE.md)`);
    let text = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, new Set());
    // the deployment's HAND fills fold in exactly as the update folds them (`withFills`) — without them the render showed
    // `<BUILD_COMMAND>` where the update writes `npm run build` (court UP6b, C4)
    const handFills = m.fills || {};
    if (!f.path.endsWith('.mjs') && Object.keys(handFills).length) text = fillPlaceholders(text, handFills, new Set());
    if (ANON && !f.path.endsWith('.mjs')) text = anonymize(text);
    process.stdout.write(text);
    return;
  }
  // A v1 manifest has no module provenance, and the loop below would skip every file and print
  // a hollow "0 files / 0 nothing to do" — worse than an honest refusal, and it hit exactly the
  // first-ever update, the moment of highest risk (bug 21 / field report K3). Build the deployed
  // version's SYNTHETIC baseline instead (same code as the legacy bootstrap; --baseline works).
  let mineModShas = m.moduleShas;
  if (!mineModShas || !Object.keys(mineModShas).length) {
    const curVer = okOnDisk(KAIF_JSON) ? (() => { try { return readJson(KAIF_JSON).version; } catch { return null; } })() : null;
    const synth = await buildSyntheticBaseline({ version: curVer });
    if (!synth) dieSoft(`this deployment carries a v1 manifest (no template provenance) and no baseline artifact for v${curVer || '?'} is reachable — pass --baseline <dir|url> with that version's release artifacts, or run the next update (it upgrades the manifest to v2)`);   // post-fetch refusal: soft (issue #10)
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
  // P1 rehearsal (2.5, epic US; #27 R1): the preview prints the SAME wholesale verdict the update
  // would print — file by file, with its numbers — and records it in .kaif/update-rehearsal.json;
  // the next `update` over this tree freezes any file whose live verdict differs, so what the
  // rehearsal showed the owner stays true. The candidate set mirrors classifyAndApply's skips
  // (untouched file → mechanical replace; zero template delta → nothing to judge), so the two
  // lists compare line by line. A rehearsal in a sandbox COPY leaves the same numbers in that
  // copy's receipt: hand it to the live run as `update --rehearsal <copy>/.kaif/last-update.json`.
  const fromVer = okOnDisk(KAIF_JSON) ? (() => { try { return readJson(KAIF_JSON).version; } catch { return null; } })() : null;
  const tplShas = m.templateShas || {};
  const fills = deriveFills(otherDeploy, values, m.fills);   // the same fills-aware skips as the update (2.6, UR2)
  const fillsN = Object.keys(fills).length;
  const verdicts = {};
  for (const f of otherDeploy) {
    if (!wholesaleCandidatePath(f.path) || !mineModShas[f.path] || !okOnDisk(f.path)) continue;   // one predicate with classifyAndApply (2.6, UR1)
    let filled = fillPlaceholders(f.content, values, new Set());
    if (ANON) filled = anonymize(filled);
    if (tplShas[f.path] && (fileShaNorm(f.path) === tplShas[f.path] || tplShas[f.path] === normSha(filled)
        || (fillsN && normSha(unfill(readFileSync(f.path, 'utf8'), fills)) === tplShas[f.path]))) continue;
    let res = null;
    try { res = mergeModules(f.path, filled, mineModShas[f.path], true, null, fillsN ? fills : null); } catch { /* unreadable — no verdict */ }
    if (!res || !res.verdict) continue;
    const outcome = res.translatedWholesale ? 'frozen' : 'merged';
    verdicts[f.path] = { ...res.verdict, outcome };
    log(`⟳ ${f.path}: baseFound ${res.verdict.baseFound} of ${res.verdict.baseN}, ceiling ${res.verdict.ceiling} → ${outcome}`);
  }
  writeFileSync(REHEARSAL, JSON.stringify({ from: fromVer, to: man2.version, source: srcBase, at: localStamp(), core: SELF_SHA, verdicts }, null, 2) + '\n');
  log(`⟳ rehearsal recorded: ${Object.keys(verdicts).length} wholesale verdict(s) → ${REHEARSAL} — the next update over this tree freezes any file whose verdict differs`);
}

// stale-claims — re-run the scan for lines asserting an OLDER version, READ-ONLY (2.8, epic SC). The task item says "fix these, then
// re-run the scan", and until now only `checkpoint stale-claims` re-ran it (ticking the item on the way); the origin's build also runs
// it over the shipped templates (check-framework 5m). The interval defaults to the last update receipt. Exit 1 only when the walk
// FAILED — a scan that could not see part of the tree is never a clean result.
// [TESTED: 2026-09-26 02:36:32 +03:00 · run by the delivered core on copies of four real 2.7 deployments after their own update — the
//  interval taken from the receipt, exit 0, every line read (report testcases/reports/2026-09-26_sc2-claim-is-a-pair.md)]
function cmdStaleClaims() {
  let from = val('--from'), to = val('--to');
  if (!from || !to) {
    const rc = okOnDisk(LAST_UPDATE) ? (() => { try { return readJson(LAST_UPDATE); } catch { return null; } })() : null;
    const mk = okOnDisk(KAIF_JSON) ? (() => { try { return readJson(KAIF_JSON); } catch { return null; } })() : null;
    from = from || (rc && rc.from);
    to = to || (rc && rc.to) || (mk && mk.version);
  }
  if (!from || !to) die('stale-claims: name the interval — --from <old version> --to <new version> (the defaults come from the last update receipt, and this tree has none)');
  const man = okOnDisk(DEPLOY_MANIFEST) ? (() => { try { return readJson(DEPLOY_MANIFEST); } catch { return null; } })() : null;
  const hits = scanStaleClaims(String(from), String(to), man && man.templateShas);
  const claims = hits.filter((h) => !h.startsWith('shown ') && !h.startsWith(WALK_NOTE));
  const failed = hits.some((h) => h.startsWith(WALK_NOTE) && h.includes('walk FAILED'));
  for (const h of hits) log('  · ' + h);
  log(`stale-claims ${from} → ${to}: ${claims.length} line(s) assert an older version${failed ? ' — the walk FAILED: the result is incomplete, not clean' : ''} (read-only; a correct line takes <!-- KAIF-VERSION-OK: reason --> on it or on the line above — in a table row, inside the row)`);
  if (failed) process.exit(1);
}

function cmdVerifyFinal() {
  runFinalGates(TASK_FILE, 'KAIF-ADAPT', 'verify-final');
  log('✅ verify-final passed — KAIF install is complete and self-cleaned. Commit: chore: deploy KAIF');
}

function cmdVersion() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
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

// ---------------------------------------------------------------------------- dispatch (bug 33)
// ONE spec drives the dispatcher, the argv validation and the help text. Flags map to
// "takes a value?"; `pos` is the number of allowed positional arguments after the command.
// MUTATING commands are marked — a bare run and unknown input never reach them.
// ── SW (2.9, origin issues #115 · #114; origin research 37): the delivered refresh hooks are WIRED, not left for an opt-in ──────────
// The KAIF owner's rule (his word in two field projects, #115): what KAIF delivers is wired — no question to the project owner. The
// write belongs to the AGENT and is OPEN to its harness: `wire-hooks` is a command that says what it does, the install and update
// tasks tell the agent to run it, and the harness judges it (Claude Code protects `.claude/` in every mode but bypass, and its
// classifier calls hook changes in `.claude/settings*.json` the user's decision) — never hidden inside `update`, which would be the
// "shell indirection" the vendor calls a bypass. A refusal is not worked around: the task records it and the owner gets one command.
// Additive: the owner's entries and their order stay; a script already wired for the event (in the project file OR in the personal
// settings.local.json) is left alone; a repeat run changes nothing. The owner opts out with "hooks": "off" in .kaif/kaif.json.
// [TESTED: 2026-09-29 21:41 +03:00 · suite s14 SW2 (the owner's hook kept, a repeat, off/on, BOM + CRLF, a broken file, settings.local.json,
//  no Claude Code, the tick); red on v2.8; mutants W1–W8 (hooks-mutants), each red on its own case; the functional run 2.8 → 2.9 — testcases/reports/2026-09-29_sw-delivered-wired.md,
//  runs 11–12. A live refusal of the harness on the write of .claude/settings.json is NOT observed — only the vendor's rules (origin research 37)]
const HOOK_FRAGMENT = '.kaif/hooks/settings-fragment.json';
const HOOK_SETTINGS = '.claude/settings.json';
const HOOK_SETTINGS_LOCAL = '.claude/settings.local.json';
// the system whose hook contract was read (.kaif/hooks/README.md capability table); Grok Build reads the same file, but its injection is
// not verified — a Grok-only deployment is not wired, one with Claude Code shares the wired file
const HOOK_SYSTEMS = ['claude-code'];
const HOOK_SCRIPT_RE = /[\\/]hooks[\\/]([\w.-]+\.mjs)/;
const hookScriptOf = (h) => { const m = HOOK_SCRIPT_RE.exec([h && h.command, ...(h && Array.isArray(h.args) ? h.args : [])].join(' ')); return m ? m[1] : null; };
// WH (2.9, origin ticket #144 — the KAIF owner's verdict on the field, rendered from Russian: "remove this from KAIF entirely"): hooks
// KAIF shipped and RETIRED. An update retires their untouched scripts (DEPRECATIONS of the build); `wire-hooks` removes the entries that
// run them from .claude/settings.json, `check` names one left — in settings.local.json too, which the machinery never edits. Without its
// script a wired hook only exits 1: Claude Code calls that a non-blocking error, but prints a hook-error notice in the transcript.
// [TESTED: 2026-10-16 09:52 · s14 «WH» cases green on HEAD, 13 red on the build a81cc95; mutants W11 · W12 of hooks-mutants red on their
//  addressees (32/32); probe sw-field-route on git clones of five live v2.8 deployments — one retired entry removed on each, the owner's
//  other lines kept in order (161 OK; 13 BAD on a81cc95); report testcases/reports/2026-10-16_wh-owner-word-hooks-withdrawn.md]
const RETIRED_HOOKS = ['pretool-owner-word.mjs', 'stop-owner-answer.mjs'];
const isRetiredHook = (h) => RETIRED_HOOKS.includes(hookScriptOf(h));
// `event → script` of every entry in a settings object that runs a retired hook
function retiredIn(settings) {
  const out = [];
  for (const [event, groups] of Object.entries((settings && settings.hooks) || {}))
    for (const g of (Array.isArray(groups) ? groups : [])) for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) if (isRetiredHook(h)) out.push(`${event} → ${hookScriptOf(h)}`);
  return out;
}
// a copy of a settings object without the retired entries; a group or an event emptied BY THIS removal goes too (one the owner left
// empty stays as he wrote it)
function withoutRetired(settings) {
  const next = JSON.parse(JSON.stringify(settings));
  if (!next.hooks || typeof next.hooks !== 'object') return next;
  for (const event of Object.keys(next.hooks)) {
    const groups = next.hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks) || !g.hooks.some(isRetiredHook)) { kept.push(g); continue; }
      const hooks = g.hooks.filter((h) => !isRetiredHook(h));
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) next.hooks[event] = kept;
    else if (groups.length) delete next.hooks[event];
  }
  return next;
}
// the hook scripts a settings object already runs for one event
function hookScriptsIn(settings, event) {
  const set = new Set();
  const groups = settings && settings.hooks && Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  for (const g of groups) for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) { const s = hookScriptOf(h); if (s) set.add(s); }
  return set;
}
// a settings file as { raw, obj } — raw null when absent; `error` when it cannot be merged into without guessing its shape
function readHookSettings(p) {
  if (!existsSync(p)) return { raw: null, obj: {} };
  const raw = readFileSync(p, 'utf8');
  let obj;
  try { obj = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch (e) { return { raw, error: 'not parseable JSON (' + e.message + ')' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { raw, error: 'the top level is not a JSON object' };
  if ('hooks' in obj && (!obj.hooks || typeof obj.hooks !== 'object' || Array.isArray(obj.hooks))) return { raw, error: '"hooks" is not an object' };
  for (const [ev, g] of Object.entries(obj.hooks || {})) if (!Array.isArray(g)) return { raw, error: `"hooks.${ev}" is not an array` };
  return { raw, obj };
}
// Where wiring stands here — read-only; shared by `wire-hooks`, `check` and the wire-hooks checkpoint
function hookWiringState() {
  let marker = {};
  try { marker = readJson(KAIF_JSON); } catch { /* no marker — the agent list of the run stands */ }
  // WH: retired entries are read in every state that can read the files — an opted-out project wired by hand is named too
  const retiredOf = (p) => { try { const s = readHookSettings(p); return s.error ? [] : retiredIn(s.obj); } catch { return []; } };
  const retiredLocal = retiredOf(HOOK_SETTINGS_LOCAL);
  if (marker.hooks === 'off') return { state: 'off', retired: retiredOf(HOOK_SETTINGS), retiredLocal };
  const agents = Array.isArray(marker.agents) && marker.agents.length ? marker.agents : AGENTS;
  if (!agents.some((a) => HOOK_SYSTEMS.includes(a))) return { state: 'no-system', agents };
  if (!okOnDisk(HOOK_FRAGMENT)) return { state: 'no-fragment' };
  const fragment = readJson(HOOK_FRAGMENT);
  const project = readHookSettings(HOOK_SETTINGS), local = readHookSettings(HOOK_SETTINGS_LOCAL);
  for (const [file, s] of [[HOOK_SETTINGS, project], [HOOK_SETTINGS_LOCAL, local]]) if (s.error) return { state: 'unreadable', file, error: s.error };
  const retired = retiredIn(project.obj);
  const missing = [];
  let total = 0;
  for (const [event, groups] of Object.entries(fragment.hooks || {})) {
    const have = new Set([...hookScriptsIn(project.obj, event), ...hookScriptsIn(local.obj, event)]);
    for (const g of groups) {
      const want = (g.hooks || []).filter((h) => hookScriptOf(h));
      total += want.length;
      const miss = want.filter((h) => !have.has(hookScriptOf(h)));
      if (miss.length) missing.push({ event, group: { ...g, hooks: miss } });
    }
  }
  // 'missing' = `wire-hooks` has work: a delivered hook to add or a retired one to remove from the project file
  return { state: missing.length || retired.length ? 'missing' : 'wired', missing, total, project, retired, retiredLocal };
}
const missingScripts = (st) => st.missing.flatMap(({ event, group }) => group.hooks.map((h) => `${event} → ${hookScriptOf(h)}`));
// what `wire-hooks` still has to do, in one line for `check` and the checkpoint
const wiringWork = (st) => [...missingScripts(st).map((s) => `not wired: ${s}`), ...(st.retired || []).map((s) => `retired, still wired: ${s}`)];
// SW (2.9, origin issues #115 · #114): the task item that wires the delivered hooks — the same text in the install and the update task
const wireHooksItem = () => ['wire-hooks', 'Wire the delivered refresh hooks: run `node .kaif/kaif-core.mjs wire-hooks` now, WITHOUT asking the owner (KAIF 2.9: what KAIF delivers is wired; the owner opts out with `"hooks": "off"` in .kaif/kaif.json). The same run REMOVES the entries of hooks KAIF retired (2.9: `pretool-owner-word.mjs`, `stop-owner-answer.mjs` — origin ticket #144). The write is yours and open to your harness: if it asks, that prompt is the owner\'s click; if it REFUSES, do not work around it (never a script that writes the file for you) — record its words with `node .kaif/kaif-core.mjs checkpoint wire-hooks --verdict "<the refusal>"` and give the owner that one command in the farewell and in the field report. Name what was wired in the field report.'];
const wantsWireHooks = () => { try { if (readJson(KAIF_JSON).hooks === 'off') return false; } catch { /* no marker yet — the run\'s agent list decides */ } return AGENTS.some((a) => HOOK_SYSTEMS.includes(a)); };

function cmdWireHooks() {
  const st = hookWiringState();
  const localNote = (s) => { if (s.retiredLocal && s.retiredLocal.length) console.error(`⚠ ${HOOK_SETTINGS_LOCAL} (personal, never edited by KAIF) still runs a hook KAIF retired: ${s.retiredLocal.join(' · ')} — remove that entry by hand`); };
  if (st.state === 'off') {
    log('= "hooks": "off" in .kaif/kaif.json — the owner opted out; ' + HOOK_SETTINGS + ' untouched');
    if (st.retired.length) console.error(`⚠ ${HOOK_SETTINGS} still runs a hook KAIF retired: ${st.retired.join(' · ')} — remove that entry by hand (opted out: KAIF does not write the file)`);
    localNote(st);
    return;
  }
  if (st.state === 'no-system') { log(`= no agent system of this deployment reads ${HOOK_SETTINGS} (agents: ${st.agents.join(', ')}) — nothing to wire`); return; }
  if (st.state === 'no-fragment') die(`${HOOK_FRAGMENT} not found — the refresh-hooks module is not deployed here (run \`node .kaif/kaif-core.mjs check\`)`);
  if (st.state === 'unreadable') {
    console.error(`⚠ ${st.file}: ${st.error} — hooks NOT wired and the file is untouched: fix it, or merge ${HOOK_FRAGMENT} into it by hand`);
    process.exit(1);
  }
  if (st.state === 'wired') { log(`= all ${st.total} KAIF hooks already wired — ${HOOK_SETTINGS} untouched`); localNote(st); return; }
  const { raw } = st.project;
  const orig = raw == null ? {} : JSON.parse(raw.replace(/^\uFEFF/, ''));
  // WH: the retired entries go first; the proof below compares against the owner's file WITHOUT them
  const base = st.retired.length ? withoutRetired(orig) : orig;
  const next = JSON.parse(JSON.stringify(base));
  const createdEvents = [];
  if (!next.hooks) next.hooks = {};
  for (const { event, group } of st.missing) {
    if (!next.hooks[event]) { next.hooks[event] = []; createdEvents.push(event); }
    next.hooks[event].push(group);
  }
  // the file's own indent, line ends, byte-order mark and one-line arrays (keepArrayStyle below); a new file is ours to format
  const indentM = raw == null ? null : /\n([ \t]+)"/.exec(raw);
  const indent = indentM ? (indentM[1].includes('\t') ? '\t' : indentM[1].length) : 2;
  const added = new Set();
  const collect = (v) => { if (Array.isArray(v)) { if (v.length && v.every((x) => typeof x === 'string')) added.add(JSON.stringify(v)); v.forEach(collect); } else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
  for (const m of st.missing) collect(m.group);
  let text = keepArrayStyle(JSON.stringify(next, null, indent), raw, added) + '\n';
  if (raw != null && raw.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  if (raw != null && raw.startsWith('\uFEFF')) text = '\uFEFF' + text;
  // PROOF before the write (the package.json precedent, issue #16): the result minus the additions is the owner's file, value for value
  const back = JSON.parse(text.replace(/^\uFEFF/, ''));
  for (let i = st.missing.length - 1; i >= 0; i--) back.hooks[st.missing[i].event].pop();
  for (const ev of createdEvents) delete back.hooks[ev];
  if (!base.hooks) delete back.hooks;
  if (JSON.stringify(back) !== JSON.stringify(base)) die(`the merged ${HOOK_SETTINGS} would change the owner's own entries — refusing; merge ${HOOK_FRAGMENT} by hand`);
  // …and what was removed is exactly the retired entries: nothing else of the owner's file is gone
  if (st.retired.length && (JSON.stringify(withoutRetired(orig)) !== JSON.stringify(base) || retiredIn(base).length)) die(`the retired hooks could not be removed from ${HOOK_SETTINGS} without touching other entries — refusing; remove ${st.retired.join(' · ')} by hand`);
  mkdirSync(dirname(HOOK_SETTINGS), { recursive: true });
  writeFileSync(HOOK_SETTINGS, text);
  for (const s of st.retired) log(`- ${HOOK_SETTINGS}: removed ${s} (retired by KAIF 2.9 — origin ticket #144)`);
  for (const s of missingScripts(st)) log(`+ ${HOOK_SETTINGS}: wired ${s}`);
  log(`  ${st.missing.reduce((n, m) => n + m.group.hooks.length, 0)} of ${st.total} KAIF hooks added; ${raw == null ? 'a new file' : 'the owner\'s entries kept'}${raw != null && keepArrayStyle(JSON.stringify(orig, null, indent), raw, new Set()) + '\n' !== raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') ? ' (the file was re-serialized with its own indent — values unchanged, proven before the write)' : ''}; opt out: "hooks": "off" in .kaif/kaif.json`);
  if (st.retired.length) log(`  ${st.retired.length} entr${st.retired.length === 1 ? 'y' : 'ies'} of retired KAIF hooks removed — the owner's other entries and their order kept, values proven before the write`);
  localNote(st);
}

// The owner's array style in the file `wire-hooks` writes (2.9, epic SW judge J-SW2 — the functional run over clones of five real v2.8
// deployments): the shipped sample writes arrays of strings on one line (`"args": ["…"]`), owners copied it, and a bare JSON.stringify
// unfolded every such array — six rewritten hunks in the owner's diff around ONE added hook (values unchanged). An unfolded array of strings
// folds back to the owner's own spelling when his file holds that very array on one line; an array KAIF adds (`added`, compact JSON) folds
// to one line only when the file writes some array of strings on one line; every other line stays as JSON.stringify writes it — a file of
// mixed style keeps its unfolded arrays unfolded. The proof before the write (values, not text) is not touched by this.
// [TESTED: 2026-10-14 11:26 · s14 SW2 (2b) «a file in the sample's style — a pure addition»; red on the mutant W10 of hooks-mutants and on
//  the build 41c6c7d (two of five live deployments); report testcases/reports/2026-10-14_sw-field-route.md]
const INLINE_STR_ARRAY_RE = /\[ *"(?:[^"\\\n]|\\.)*"(?: *, *"(?:[^"\\\n]|\\.)*")* *\]/g;
const UNFOLDED_STR_ARRAY_RE = /\[\n[ \t]*("(?:[^"\\\n]|\\.)*"(?:,\n[ \t]*"(?:[^"\\\n]|\\.)*")*)\n[ \t]*\]/g;
function keepArrayStyle(text, raw, added) {
  if (raw == null) return text;
  const inline = new Map();
  for (const m of raw.replace(/\r\n/g, '\n').match(INLINE_STR_ARRAY_RE) || []) {
    try { const k = JSON.stringify(JSON.parse(m)); if (!inline.has(k)) inline.set(k, m); } catch { /* not a JSON array of strings — the owner's text stays his */ }
  }
  if (!inline.size) return text;
  return text.replace(UNFOLDED_STR_ARRAY_RE, (all, body) => {
    let k; try { k = JSON.stringify(JSON.parse('[' + body + ']')); } catch { return all; }
    if (inline.has(k)) return inline.get(k);
    if (added.has(k)) return '[' + body.split(/,\n[ \t]*/).join(', ') + ']';
    return all;
  });
}

const COMMANDS = {
  help:            { fn: cmdHelp,         desc: 'this list (also the bare-run and --help default)', flags: {}, pos: 0 },
  version:         { fn: cmdVersion,      desc: 'report the deployed version from .kaif/kaif.json', flags: {}, pos: 0 },
  check:           { fn: cmdCheck,        desc: 'validate the deployed manifest (marker schema, mirrors, two-headed docs); --gate-budgets makes the size budgets of the re-read core a DOOR — exit 1 on a document over budget in the project\'s OWN lines (the closing ritual runs it)', flags: { '--bundle': true, '--agents': true, '--mode': true, '--lang': true, '--gate-budgets': false }, pos: 0 },
  diff:            { fn: cmdDiff,         desc: 'audit disk vs deployed templates; --source <x> previews another version; --source <x> --render <file> prints that file as install of <x> writes it here (language, fills, mode) — the oracle of a hand merge', flags: { '--source': true, '--baseline': true, '--lang': true, '--render': true }, pos: 0 },
  modules:         { fn: cmdModules,      desc: 'print the module cut of a bundle as JSON (audit surface)', flags: { '--bundle': true }, pos: 0 },
  'stale-claims':  { fn: cmdStaleClaims,  desc: 're-run the scan for lines asserting an older version, read-only — --from <v> --to <v> (default: the last update receipt); exit 1 only when the walk failed', flags: { '--from': true, '--to': true }, pos: 0 },
  install:         { fn: cmdInstall,      mutating: true, desc: 'deploy KAIF from a bundle (the loader calls this explicitly); over an existing deployment it is an update-by-bootstrap — --rehearsal <receipt> binds it to a sandbox copy\'s verdicts', flags: { '--bundle': true, '--lang': true, '--mode': true, '--agents': true, '--baseline': true, '--force': false, '--rehearsal': true }, pos: 0 },
  update:          { fn: cmdUpdate,       mutating: true, desc: 'respectful mechanical update from the origin/release; --rehearsal <receipt> binds the run to a sandbox copy\'s verdicts', flags: { '--source': true, '--channel': true, '--lang': true, '--agents': true, '--baseline': true, '--rehearsal': true }, pos: 0 },
  resume:          { fn: cmdResume,       mutating: true, desc: 'restore the pre-update tree after a crashed update (per .kaif/update-journal.json)', flags: {}, pos: 0 },
  'update-verify': { fn: cmdUpdateVerify, mutating: true, desc: 'final gates of an update; self-cleans on green', flags: {}, pos: 0 },
  'verify-final':  { fn: cmdVerifyFinal,  mutating: true, desc: 'final gates of an install; self-cleans on green', flags: {}, pos: 0 },
  checkpoint:      { fn: cmdCheckpoint,   mutating: true, desc: 'record a finished task item (recheck/placeholders/project-name EXECUTE their gates)', flags: { '--verdict': true, '--verdict-file': true }, pos: 1 },
  sphere:          { fn: cmdSphere,       mutating: true, desc: "record the project's sphere in the deploy marker", flags: {}, pos: 1 },
  report:          { fn: cmdReport,       mutating: true, desc: 'deliver a KAIF-defect ticket to the origin via gh (standing authorization, issue #15) and write the URL into it; --dry-run calls nothing', flags: { '--dry-run': false }, pos: 1 },
  'project-name':  { fn: cmdProjectName,  mutating: true, desc: "record the project's CANONICAL name (identity is the owner's; heals the marker and the fill map)", flags: { '--name-file': true }, pos: 1 },
  sync:            { fn: cmdSync,         mutating: true, desc: 're-sync per-system skill mirrors from .claude/skills/', flags: {}, pos: 0 },
  'wire-hooks':    { fn: cmdWireHooks,    mutating: true, desc: 'wire the delivered refresh hooks into .claude/settings.json — additive, the owner\'s entries kept, a repeat run changes nothing; "hooks": "off" in .kaif/kaif.json opts out (2.9, issue #115)', flags: {}, pos: 0 },
  'adopt-current': { fn: cmdAdoptCurrent, mutating: true, desc: 'rebuild the snapshot after a manual migration', flags: {}, pos: 0 },
};

function cmdHelp() {
  log('KAIF-CORE — the deployed KAIF machinery (.kaif/kaif-core.mjs). Commands (⚠ = mutates the tree):\n');
  for (const [name, c] of Object.entries(COMMANDS))
    log(`  ${name.padEnd(15)}${c.mutating ? '⚠ ' : '  '}${c.desc}`);
  log('\nA bare or flags-only run prints this help and touches NOTHING (bug 33: the old default was');
  log('`install`, and a curious bare run once overwrote a live update task in the field). Unknown');
  log('flags and arguments REFUSE instead of being silently ignored — name the command explicitly.');
}

// Unknown argv REFUSES before any command runs (bug 33: `sync --dry-run` once silently ran a
// REAL sync of 145 files, and `diff PHILOSOPHY.md` printed the full audit as if asked).
function validateArgv(spec) {
  const errs = [];
  let positionals = 0;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (!(a in spec.flags)) { errs.push(`unknown flag for ${CMD}: ${a}`); continue; }
      if (spec.flags[a]) {
        const v = args[i + 1];
        if (!v || v.startsWith('-')) errs.push(`flag ${a} needs a value`);
        else i++;
      }
    } else {
      positionals++;
      if (positionals > spec.pos)
        errs.push(`unexpected argument for ${CMD}: "${a}"${['diff', 'modules'].includes(CMD) ? ' — a per-file argument is not supported; run the bare command for the full audit' : ''}`);
    }
  }
  if (errs.length) {
    for (const e of errs) console.error('✖ ' + e);
    die(`refusing to run ${CMD} with input it does not understand — a silently ignored flag executes something you did not ask for (bug 33). Known flags: ${Object.keys(spec.flags).join(' ') || '(none)'}${spec.pos ? ` · up to ${spec.pos} positional argument(s)` : ''}. Run \`help\` for the command list.`);
  }
}

const spec = COMMANDS[CMD];
if (!spec) { cmdHelp(); die(`unknown command: ${CMD}`); }
if (CMD === 'help') {
  // Explicit `help` honors the same doctrine it prints: `help install` refuses instead of
  // silently showing the generic list as if it were per-command help (judge finding, L3).
  if (!IMPLICIT_CMD) validateArgv(spec);
  cmdHelp();
  // `--lang ru`-style flags-only runs used to mean `install` — a script relying on that must
  // NOTICE its install did not happen: loud note + exit 1. Bare/--help/-h stay a clean 0.
  if (IMPLICIT_CMD && args.length && !['--help', '-h', 'help'].includes(args[0]))
    die(`no command given — nothing was executed (flags seen: ${args.join(' ')}). The old bare-run default was \`install\`; say the command explicitly.`);
} else {
  validateArgv(spec);
  try { await spec.fn(); }
  catch (e) {
    if (!(e && e.kaifDie)) throw e;   // real bugs keep their stack — only the soft-die sentinel is expected
    // Message already printed by dieSoft. Mark the failure and let the event loop drain
    // naturally: process.exit() here would trip the win32 libuv assertion the sentinel exists
    // to avoid (issue #10) — the pooled fetch handles unref within ~300 ms on their own.
    process.exitCode = 1;
  }
}
