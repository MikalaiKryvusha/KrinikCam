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
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const CMD = process.argv[2] || 'check';
const RULES = '.kaif/canon-lint-rules.json';
const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };

// "Not configured" is NOT "a guard failed to fire" (bug 30.2, field: a fresh deployment's red
// selftest is exactly what agents chase). Absence of the rules file exits 0 with a hint — the
// module is optional and unconfigured by design; exit 1 stays reserved for real guard failures.
if (!existsSync(RULES)) {
  log(`= ${RULES} not found — canon lint is not configured yet (optional module). Seed it (see this file's header for the format); the linter grows with every fix.`);
  process.exit(0);
}
const rules = JSON.parse(readFileSync(RULES, 'utf8').replace(/^﻿/, ''));

function* walkMd(dir = '.') {
  for (const n of readdirSync(dir)) {
    const p = (dir === '.' ? '' : dir + '/') + n;
    if (['.git', 'node_modules', '.kaif'].includes(n)) continue;
    if (statSync(p).isDirectory()) { yield* walkMd(p); continue; }
    if (/\.md$/i.test(n)) yield p;
  }
}
// files in rules may be written with backslashes on Windows — walkMd always yields forward slashes
const inScope = (p, files) => !files || ((files = files.replaceAll('\\', '/')).endsWith('/') ? p.startsWith(files) : p === files);
// CRLF checkouts and PS5.1 Out-File BOMs are the documented Windows profile of real projects:
// read EOL/BOM-normalized, or required lines false-redden and $-anchored forbidden patterns
// false-GREEN (the worst failure direction).
const readLines = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
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
      for (let i = 0; i < lines.length; i++)
        if (re.test(lines[i])) { console.error(`✖ forbidden in ${p}:${i + 1} — ${r.message || r.pattern}`); issues++; }
    }
  }
  for (const r of rules.required || []) {
    if (!r.file || !existsSync(r.file)) { console.error(`✖ required-line file missing: ${r.file} — ${r.message || ''}`); issues++; continue; }
    if (!readLines(r.file).includes(r.line)) { console.error(`✖ guarded line MISSING from ${r.file} — ${r.message || ''}\n    wanted: ${r.line}`); issues++; }
  }
  if (issues) die(`canon lint FAILED: ${issues} issue(s)`);
  log(`✅ canon lint OK (${(rules.forbidden || []).length} forbidden + ${(rules.required || []).length} required rules)`);
}

// A guard is proven, not assumed: required lines must be full and unique; forbidden patterns
// must actually match their own recorded example (else the guard would green forever).
function cmdSelftest() {
  let issues = 0;
  for (const r of rules.required || []) {
    if (!r.line || r.line.trim().length < 12) { console.error(`✖ required line too short to be unique (guard with FULL lines): "${r.line}"`); issues++; continue; }
    if (r.file && existsSync(r.file)) {
      const hits = readLines(r.file).filter((l) => l === r.line).length;
      if (hits > 1) { console.error(`✖ required line is NOT unique in ${r.file} (${hits} hits): "${r.line.slice(0, 60)}…"`); issues++; }
    }
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
