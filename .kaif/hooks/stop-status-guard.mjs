#!/usr/bin/env node
// stop-status-guard.mjs — the STATUS freshness guard hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: Stop. The ONLY blocking
// hook of the module — and even it blocks softly: once per session, with a reason that asks
// for an update or an explicit "nothing changed", never a hard wall.
//
// What it does: STATUS.md is the handover between sessions — a tree that changed while STATUS
// stayed untouched hands the next session a stale summary. When the agent is about to finish its
// turn, this hook checks what it can OBSERVE: is the worktree dirty or did a commit land within the
// staleness window, while STATUS.md stayed untouched longer than that window? If yes — one soft
// block with the reminder, naming what it saw (it cannot tell whose work that was — 2.9, bug 120).
//
// Predicate (anti-noise): (dirty git worktree OR last commit within STALE_HOURS) AND
// STATUS.md mtime older than STALE_HOURS. Cooldown: once per session — a state file keyed by
// session_id in the OS temp dir (ephemeral session state; never pollutes the project tree).
// No git / no STATUS.md → silent: the guard never reddens a project it does not understand.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `session_id`, `cwd`; blocking output —
// top-level {"decision": "block", "reason": "…"}. A hook must never break the session: any
// internal error → exit 0 silently.
// [TESTED: 2026-08-07 · polygon s14: dirty tree + old STATUS → block JSON once; same session again → silent (cooldown); fresh STATUS → silent; no git → silent]
//
// 2.9, epic HK (origin ticket #94, bugs 119 no. 1 and 120 no. 2): STATUS.md and git are read in the PROJECT ROOT, not in the event's
// `cwd` — from a subfolder the guard fell silent, indistinguishable from an unwired module. The reason names what was OBSERVED (the
// worktree's uncommitted changes, or a recent commit) — "this session changed the tree" claimed work of a session the guard never
// watched, on a tree that could have been dirty for days — and names STATUS.md by its full path.
// [TESTED: 2026-09-28 · suite s14: an event from <root>/src/deep gives the same soft block as the root, STATUS.md by its full path;
//  the reason says "the worktree has uncommitted changes" or "a commit landed within the last 3 h"; another session of the same
//  project is blocked again; red on v2.8; mutants M27-M28; report testcases/reports/2026-09-28_hk-hooks-project-root.md (origin repository)]
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const STALE_HOURS = 3;        // STATUS older than this while work happened → remind
const STATUS_FILE = 'STATUS.md';
const DEPLOYMENT = join('.kaif', 'kaif.json');  // the deployment marker: its directory IS the project root

// The project root, not the event's `cwd` — twin of prompt-refresh-timer.mjs (the reasoning is there).
function projectRoot(cwd) {
  for (let d = resolve(cwd); ;) {
    if (existsSync(join(d, DEPLOYMENT))) return d;
    const up = dirname(d);
    if (up === d) return cwd;
    d = up;
  }
}

try {
  let cwd = process.cwd();
  let sessionId = 'unknown-session';
  try {
    // A leading U+FEFF is dropped before the parse (Windows PowerShell 5.1 puts it in front of any
    // string piped into a native command; RFC 8259 §8.1 lets a parser ignore it) — origin bug 119.
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}');
    if (input.cwd) cwd = String(input.cwd);
    if (input.session_id) sessionId = String(input.session_id);
  } catch { /* unreadable stdin — defaults keep the guard functional */ }

  // Cooldown: one reminder per session. The state file lives in the OS temp dir — session
  // state never pollutes the project tree (the refresh marker earned its .gitignore line;
  // this one does not even need that).
  const cooldownPath = join(tmpdir(), `kaif-status-guard-${sessionId.replace(/[^\w.-]/g, '_')}`);
  if (existsSync(cooldownPath)) process.exit(0);

  const root = projectRoot(cwd);
  const statusPath = join(root, STATUS_FILE);
  if (!existsSync(statusPath)) process.exit(0);   // no STATUS.md — nothing to guard
  const statusAgeH = (Date.now() - statSync(statusPath).mtimeMs) / 3600000;
  if (statusAgeH <= STALE_HOURS) process.exit(0); // STATUS is fresh — silence is the normal state

  // Did this session actually do work? Dirty worktree or a commit within the window.
  // Any git failure (not a repo, git missing) → silent: never redden what we cannot observe.
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let observed = '';   // what the guard SAW — the reason says exactly this, never more (bug 120)
  try {
    if (git(['status', '--porcelain'])) observed = 'the worktree has uncommitted changes';
    else {
      const lastCommitSec = Number(git(['log', '-1', '--format=%ct']));
      if (lastCommitSec && (Date.now() / 1000 - lastCommitSec) / 3600 < STALE_HOURS) observed = `a commit landed within the last ${STALE_HOURS} h`;
    }
  } catch { process.exit(0); }
  if (!observed) process.exit(0);

  writeFileSync(cooldownPath, new Date().toISOString());
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `KAIF STATUS guard (fires once per session): ${observed}, but ${STATUS_FILE} was last ` +
      `touched ~${Math.round(statusAgeH)} h ago. Update ${statusPath} with the current state — or state explicitly ` +
      `in the chat why nothing in it changed — then finish.`,
  }));
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
