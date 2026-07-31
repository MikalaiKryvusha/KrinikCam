#!/usr/bin/env node
// kaif-provenance.mjs — the OPTIONAL provenance module for the owner's canon artifacts
// (plan 20 phase 5; owner decision #19: a separate optional module, not core).
// Deployed to .kaif/tools/kaif-provenance.mjs by the installer; does nothing until the project
// declares its canon artifacts.
//
// The convention it mechanizes (AGENT_GUIDE, shipped since 1.6): everything an AI writes into
// the OWNER'S canon artifacts (rulebooks, lore, brand texts — where the owner's word IS the
// content) carries visible paired marks [AI]…[/AI] (AI-written) / [AI-ed]…[/AI-ed] (owner text
// edited by AI). A mark is the acceptance queue: ONLY the owner's word removes it. The field
// asked for this exact cheap gate first: "without tooling the convention rots first, and agents
// start marking everything" (QA field report, 1.6).
//
// Tags quoted in inline code spans (`…`) or fenced code blocks (``` / ~~~) are DOCUMENTATION
// of the convention, not marks — the parser skips them. The deployed KAIF docs themselves quote
// the convention (AGENT_GUIDE, PHILOSOPHY, fable-judge), so the gate must stay green on a fresh
// deployment out of the box.
//
// Declare the canon in .kaif/kaif.json:   "canonArtifacts": ["rules/", "lore/canon.md"]
//   (a path ending in "/" declares a directory subtree; otherwise an exact file path)
//
// Commands:
//   node .kaif/tools/kaif-provenance.mjs report            # where AI text awaits acceptance
//   node .kaif/tools/kaif-provenance.mjs check             # the GATE (wire into your checks/CI):
//                                                          #   · every mark is correctly paired
//                                                          #   · with canonArtifacts declared:
//                                                          #     marks live ONLY in the canon
//                                                          # exit 1 on violations
//   node .kaif/tools/kaif-provenance.mjs accept <file>     # THE OWNER ACCEPTED this file's blocks:
//                                                          # move them to the acceptance registry
//                                                          # (.kaif/provenance-accepted.json) and
//                                                          # strip the marks. An agent must NEVER
//                                                          # run this without the owner's word.
//
// Roadmap (plan 17 §2.1): a git-baseline token-F1 pass (--mark: find and mark unmarked AI text
// mechanically) ships as the second stage; this grep stage is complete and useful on its own.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CMD = process.argv[2] || 'report';
const ARG = process.argv[3];
const KAIF_JSON = '.kaif/kaif.json';
const REGISTRY = '.kaif/provenance-accepted.json';
const OPEN = ['[AI]', '[AI-ed]'];
const CLOSE = { '[AI]': '[/AI]', '[AI-ed]': '[/AI-ed]' };
const TAGS = ['[AI-ed]', '[/AI-ed]', '[AI]', '[/AI]']; // longest first — see the guard in lineTags

const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const slashes = (p) => p.replaceAll('\\', '/'); // registry keys and decl entries use forward slashes

function canonDecl() {
  if (!existsSync(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = JSON.parse(readFileSync(KAIF_JSON, 'utf8').replace(/^﻿/, ''));
  return Array.isArray(j.canonArtifacts) ? j.canonArtifacts.map(slashes) : [];
}
const inCanon = (p, decl) => decl.some((d) => (d.endsWith('/') ? p.startsWith(d) : p === d));

// Mark tags on one line, ordered by COLUMN (several pairs may share a line — processing them
// by tag type instead of position produced false nesting errors on correct text). Occurrences
// inside inline code spans (`…`) are quoted documentation, not marks — skipped.
function lineTags(line) {
  const spans = [];
  const spanRe = /`[^`]*`/g;
  let m;
  while ((m = spanRe.exec(line))) spans.push([m.index, m.index + m[0].length]);
  const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
  const hits = [];
  for (const tag of TAGS) {
    let idx = -1;
    while ((idx = line.indexOf(tag, idx + 1)) !== -1) {
      // longest-match guard: a "[AI]"/"[/AI]" scan must not claim the head of "[AI-ed]"/"[/AI-ed]"
      if (tag === '[AI]' && line.slice(idx, idx + 7) === '[AI-ed]') continue;
      if (tag === '[/AI]' && line.slice(idx, idx + 8) === '[/AI-ed]') continue;
      if (inSpan(idx)) continue;
      hits.push({ tag, idx });
    }
  }
  return hits.sort((a, b) => a.idx - b.idx);
}

// Parse one file into mark blocks; returns { blocks, errors, tagSites }.
// A block: { kind, line, text } — text is EXACTLY what sits between the tags (EOL-normalized,
// so sha/excerpt are stable across CRLF and LF checkouts). tagSites — every recognized tag's
// { line, idx, len }, reused by accept's mark stripping (only real tags are stripped).
function parseMarks(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const blocks = [];
  const errors = [];
  const tagSites = [];
  let open = null; // { kind, line, si, ci } — si/ci: 0-based line / column right after the open tag
  let fence = false;
  const clean = (l) => l.replace(/\r$/, '');
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    for (const { tag, idx } of lineTags(line)) {
      tagSites.push({ line: i, idx, len: tag.length });
      if (OPEN.includes(tag)) {
        if (open) { errors.push(`${path}:${i + 1} — ${tag} opened while ${open.kind} from line ${open.line} is still open (nesting is not allowed)`); }
        else open = { kind: tag, line: i + 1, si: i, ci: idx + tag.length };
      } else {
        const wanted = open ? CLOSE[open.kind] : null;
        if (!open) errors.push(`${path}:${i + 1} — stray ${tag} with no open mark`);
        else if (tag !== wanted) errors.push(`${path}:${i + 1} — ${tag} closes ${open.kind} from line ${open.line} (expected ${wanted})`);
        else {
          const text = open.si === i
            ? line.slice(open.ci, idx)
            : [clean(lines[open.si]).slice(open.ci), ...lines.slice(open.si + 1, i).map(clean), line.slice(0, idx)].join('\n');
          blocks.push({ kind: open.kind, line: open.line, text });
          open = null;
        }
      }
    }
  }
  if (open) errors.push(`${path}:${open.line} — ${open.kind} never closed`);
  return { blocks, errors, tagSites };
}

function* walkMd(dir = '.') {
  for (const n of readdirSync(dir)) {
    const p = (dir === '.' ? '' : dir + '/') + n;
    if (['.git', 'node_modules', '.kaif'].includes(n)) continue;
    if (statSync(p).isDirectory()) { yield* walkMd(p); continue; }
    if (/\.md$/i.test(n)) yield p;
  }
}

function cmdCheck() {
  const decl = canonDecl();
  let issues = 0;
  for (const p of walkMd()) {
    const { blocks, errors } = parseMarks(p);
    for (const e of errors) { console.error('✖ ' + e); issues++; }
    // "marks live only in the canon" applies once a canon IS declared — without a declaration
    // only mark hygiene is checked (the header's "does nothing until declared" promise).
    if (blocks.length && decl.length && !inCanon(p, decl)) {
      console.error(`✖ ${p} carries ${blocks.length} provenance mark block(s) but is NOT a declared canon artifact — marks live only in canonArtifacts (declare it in .kaif/kaif.json, or remove the marks: agents must not mark everything)`);
      issues++;
    }
  }
  if (issues) die(`provenance check FAILED: ${issues} issue(s)`);
  log(`✅ provenance check OK${decl.length ? '' : ' (no canonArtifacts declared — only mark hygiene was checked)'}`);
}

function cmdReport() {
  const decl = canonDecl();
  if (!decl.length) { log('no canonArtifacts declared in .kaif/kaif.json — nothing to report'); return; }
  let total = 0;
  for (const p of walkMd()) {
    if (!inCanon(p, decl)) continue;
    const { blocks, errors } = parseMarks(p);
    for (const e of errors) console.error('⚠ ' + e);
    if (!blocks.length) continue;
    log(`${p} — ${blocks.length} block(s) awaiting the owner's acceptance:`);
    for (const b of blocks) log(`  · line ${b.line} ${b.kind} ${b.text.trim().split('\n')[0].slice(0, 80)}`);
    total += blocks.length;
  }
  log(total ? `${total} block(s) total — acceptance is the OWNER'S word, then: kaif-provenance accept <file>` : '✅ no AI text awaits acceptance in the declared canon');
}

function cmdAccept() {
  if (!ARG) die('usage: kaif-provenance accept <file>   — run ONLY after the owner said the file is accepted');
  const file = slashes(ARG);
  if (!existsSync(file)) die(`no such file: ${file}`);
  const decl = canonDecl();
  if (decl.length && !inCanon(file, decl)) console.error(`⚠ ${file} is not a declared canon artifact — accepting on the owner's word anyway, but marks normally live only in canonArtifacts`);
  const { blocks, errors, tagSites } = parseMarks(file);
  if (errors.length) { for (const e of errors) console.error('✖ ' + e); die('fix mark pairing before accepting'); }
  if (!blocks.length) die(`${file} carries no provenance marks — nothing to accept`);
  const reg = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8').replace(/^﻿/, '')) : { accepted: [] };
  const date = new Date().toISOString().slice(0, 10);
  for (const b of blocks) reg.accepted.push({ file, date, kind: b.kind, sha: sha(b.text), excerpt: b.text.trim().split('\n')[0].slice(0, 80) });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
  // Strip ONLY the tags the parser recognized (quoted documentation stays), right-to-left per
  // line; a line that was nothing but a tag disappears entirely — no blank-line scars.
  const lines = readFileSync(file, 'utf8').split('\n');
  const byLine = new Map();
  for (const s of tagSites) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
  const drop = new Set();
  for (const [ln, sites] of byLine) {
    let l = lines[ln];
    for (const s of sites.sort((a, b) => b.idx - a.idx)) l = l.slice(0, s.idx) + l.slice(s.idx + s.len);
    if (l.replace(/\r$/, '').trim()) lines[ln] = l; else drop.add(ln);
  }
  writeFileSync(file, lines.filter((_, i) => !drop.has(i)).join('\n'));
  log(`✔ accepted ${blocks.length} block(s) in ${file} — marks stripped, registry updated (${REGISTRY}). This action carries the owner's word.`);
}

({ check: cmdCheck, report: cmdReport, accept: cmdAccept }[CMD] ||
  (() => die(`unknown command: ${CMD} (report | check | accept <file>)`)))();
