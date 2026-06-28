#!/usr/bin/env node
/**
 * ui.mjs — UI automation tool for KrinikCam testing via ADB + UIAutomator.
 *
 * Replaces the slow screenshot → coordinate estimation loop with:
 *   1. Dump device UI hierarchy (uiautomator dump → XML)
 *   2. Parse nodes by text / content-desc / resource-id
 *   3. Compute exact center coordinates from bounds
 *   4. Execute ADB tap/input commands
 *
 * Commands:
 *   node tools/ui.mjs dump              — show all visible/clickable elements + coords
 *   node tools/ui.mjs find <query>      — find element(s) matching text/desc/id
 *   node tools/ui.mjs tap <query>       — find and tap element (first match)
 *   node tools/ui.mjs tap-all <query>   — list all matches and tap the first
 *   node tools/ui.mjs dump-xml          — print raw UIAutomator XML
 *
 * <query> matches (case-insensitive, partial) against: text, content-desc, resource-id
 *
 * Usage in bug-fixing / testing workflow:
 *   # 1. See what's on screen:
 *   node tools/ui.mjs dump
 *
 *   # 2. Find the Go Live button and tap it:
 *   node tools/ui.mjs tap "go live"
 *
 *   # 3. Check if specific element exists:
 *   node tools/ui.mjs find "platforms"
 *
 * Device: ADB_DEVICE env or first connected device.
 */

import { execSync, execFileSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── ADB device detection ────────────────────────────────────────────────────

const ADB_DEVICE = process.env.ADB_DEVICE || (() => {
  try {
    const lines = execSync('adb devices', { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .filter(l => l.trim() && !l.startsWith('*') && l.includes('device'));
    if (!lines.length) throw new Error('No ADB devices connected');
    return lines[0].split('\t')[0].trim();
  } catch {
    return null;
  }
})();

function adb(...args) {
  const deviceFlag = ADB_DEVICE ? ['-s', ADB_DEVICE] : [];
  return execSync(['adb', ...deviceFlag, ...args].join(' '), { encoding: 'utf8' });
}

// ── UIAutomator dump ─────────────────────────────────────────────────────────

const DUMP_REMOTE = '/sdcard/ui_dump.xml';
const DUMP_LOCAL  = join(tmpdir(), 'kcam_ui_dump.xml');

/**
 * Run uiautomator dump on device and return XML string.
 * Dumps current screen UI hierarchy — call this right before parsing.
 */
function dumpUi() {
  adb('shell', 'uiautomator', 'dump', DUMP_REMOTE);
  adb('pull', DUMP_REMOTE, DUMP_LOCAL);
  return readFileSync(DUMP_LOCAL, 'utf8');
}

// ── XML parsing (no dependencies — pure regex) ───────────────────────────────

/**
 * Parse UIAutomator XML into array of node objects.
 * Each node has: text, desc, id, cls, bounds, center, clickable, focusable, enabled
 */
function parseNodes(xml) {
  const nodeRegex = /<node\s([^>]+?)\/>/g;
  const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
  const nodes = [];

  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrs = {};
    let attr;
    while ((attr = attrRegex.exec(match[1])) !== null) {
      attrs[attr[1]] = attr[2];
    }
    attrRegex.lastIndex = 0;

    const bounds = parseBounds(attrs['bounds'] || '');
    if (!bounds) continue;

    nodes.push({
      text:       attrs['text'] || '',
      desc:       attrs['content-desc'] || '',
      id:         attrs['resource-id'] || '',
      cls:        attrs['class'] || '',
      bounds,
      center:     {
        x: Math.round((bounds.x1 + bounds.x2) / 2),
        y: Math.round((bounds.y1 + bounds.y2) / 2),
      },
      clickable:  attrs['clickable'] === 'true',
      focusable:  attrs['focusable'] === 'true',
      enabled:    attrs['enabled'] === 'true',
      checked:    attrs['checked'] === 'true',
    });
  }

  return nodes;
}

/** Parse "[x1,y1][x2,y2]" → { x1, y1, x2, y2 } */
function parseBounds(s) {
  const m = s.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

/** Find nodes matching query (case-insensitive, partial match) */
function findNodes(nodes, query) {
  const q = query.toLowerCase();
  return nodes.filter(n =>
    n.text.toLowerCase().includes(q) ||
    n.desc.toLowerCase().includes(q) ||
    n.id.toLowerCase().includes(q)
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

function label(n) {
  const parts = [];
  if (n.text) parts.push(`text="${n.text}"`);
  if (n.desc) parts.push(`desc="${n.desc}"`);
  if (n.id)   parts.push(`id="${n.id}"`);
  return parts.join(' ') || `<${n.cls.split('.').pop()}>`;
}

function formatNode(n) {
  const flags = [
    n.clickable  ? 'clickable' : '',
    n.focusable  ? 'focusable' : '',
    !n.enabled   ? 'DISABLED'  : '',
    n.checked    ? 'checked'   : '',
  ].filter(Boolean).join(' ');

  return `  center=(${n.center.x},${n.center.y})  bounds=[${n.bounds.x1},${n.bounds.y1}][${n.bounds.x2},${n.bounds.y2}]  ${flags}\n  ${label(n)}\n  class: ${n.cls}`;
}

// ── Commands ─────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

switch (cmd) {

  case 'dump': {
    console.log('⏳ Dumping UI hierarchy...');
    const xml = dumpUi();
    const nodes = parseNodes(xml);
    const visible = nodes.filter(n => n.enabled && (n.clickable || n.focusable || n.text || n.desc));
    console.log(`\n📱 ${visible.length} visible/interactive elements on screen:\n`);
    visible.forEach((n, i) => {
      console.log(`[${i}] ${formatNode(n)}\n`);
    });
    break;
  }

  case 'dump-xml': {
    console.log('⏳ Dumping UI XML...');
    const xml = dumpUi();
    // Pretty-print by adding newlines before <node
    console.log(xml.replace(/<node /g, '\n<node '));
    break;
  }

  case 'find': {
    if (!rest[0]) { console.error('Usage: ui.mjs find <query>'); process.exit(1); }
    const query = rest.join(' ');
    console.log(`⏳ Dumping UI and searching for "${query}"...`);
    const xml = dumpUi();
    const nodes = parseNodes(xml);
    const matches = findNodes(nodes, query);
    if (!matches.length) {
      console.log(`❌ No elements found matching "${query}"`);
    } else {
      console.log(`✅ ${matches.length} match(es) for "${query}":\n`);
      matches.forEach((n, i) => console.log(`[${i}] ${formatNode(n)}\n`));
    }
    break;
  }

  case 'tap': {
    if (!rest[0]) { console.error('Usage: ui.mjs tap <query>'); process.exit(1); }
    const query = rest.join(' ');
    console.log(`⏳ Dumping UI and tapping "${query}"...`);
    const xml = dumpUi();
    const nodes = parseNodes(xml);
    const matches = findNodes(nodes, query);
    if (!matches.length) {
      console.log(`❌ No elements found matching "${query}"`);
      process.exit(1);
    }
    const target = matches[0];
    console.log(`🎯 Tapping: ${label(target)}  at (${target.center.x}, ${target.center.y})`);
    adb('shell', 'input', 'tap', String(target.center.x), String(target.center.y));
    console.log('✅ Tap sent');
    break;
  }

  case 'tap-all': {
    if (!rest[0]) { console.error('Usage: ui.mjs tap-all <query>'); process.exit(1); }
    const query = rest.join(' ');
    console.log(`⏳ Dumping UI and searching "${query}"...`);
    const xml = dumpUi();
    const nodes = parseNodes(xml);
    const matches = findNodes(nodes, query);
    if (!matches.length) {
      console.log(`❌ No elements found matching "${query}"`);
      process.exit(1);
    }
    console.log(`Found ${matches.length} match(es):`);
    matches.forEach((n, i) => console.log(`  [${i}] ${label(n)} → (${n.center.x}, ${n.center.y})`));
    const target = matches[0];
    console.log(`\n🎯 Tapping first match at (${target.center.x}, ${target.center.y})`);
    adb('shell', 'input', 'tap', String(target.center.x), String(target.center.y));
    console.log('✅ Tap sent');
    break;
  }

  default: {
    console.log(`
KrinikCam UI Automation Tool
Usage:
  node tools/ui.mjs dump              — show all visible elements with exact coordinates
  node tools/ui.mjs find <query>      — find element(s) by text / content-desc / resource-id
  node tools/ui.mjs tap  <query>      — find and tap first matching element
  node tools/ui.mjs tap-all <query>   — list all matches and tap first
  node tools/ui.mjs dump-xml          — print raw UIAutomator XML

Examples:
  node tools/ui.mjs dump
  node tools/ui.mjs tap "menu"
  node tools/ui.mjs tap "go live"
  node tools/ui.mjs tap "platforms"
  node tools/ui.mjs find "live"
  node tools/ui.mjs tap "settings"
`);
  }
}
