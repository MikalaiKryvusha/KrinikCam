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
import { writeFileSync, readFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, isAbsolute, dirname } from 'path';

// JPEG quality for screenshots — full resolution kept, just compressed so the image is light
// for AI analysis (Krinik: don't downscale, compress to 80%).
const SCREENSHOT_JPEG_QUALITY = 80;

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

// ── App package + lifecycle helpers (free the USB camera between builds) ──────
const PKG_DEBUG     = 'com.kriniks.kcam.debug';   // debug build
const PKG_RELEASE   = 'com.kriniks.kcam';         // release build
const MAIN_ACTIVITY = 'com.kriniks.kcam.MainActivity';

/** Resolve a package alias ("debug"/"release"/"both") → list of full package names. */
function resolvePkgs(arg) {
  if (!arg || /^(both|all)$/i.test(arg)) return [PKG_DEBUG, PKG_RELEASE];
  if (/^debug$/i.test(arg))   return [PKG_DEBUG];
  if (/^release$/i.test(arg)) return [PKG_RELEASE];
  return [arg];  // treat as a literal package name
}

/** Synchronous sleep (no deps) — wait for the next dialog to appear / app to launch. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Set all three system animation scales (window / transition / animator). Scale 0 disables
 * animations — including Compose animations, which honor animator_duration_scale — so that
 * `uiautomator dump` can reach idle on screens with continuous motion (Bug 07).
 */
function setAnimationScale(v) {
  for (const key of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
    try { adb('shell', 'settings', 'put', 'global', key, String(v)); } catch {}
  }
}

// ── System permission / USB dialog approval ──────────────────────────────────
// Camera/microphone runtime permission dialogs and the USB "Allow access?" dialog are drawn by
// OTHER packages (permissioncontroller / systemui), so in-app FAB automation can't reach them.
// `allow` detects such a dialog and taps its positive button — letting the agent grant access
// autonomously instead of calling Krinik to the device.

// Approve-button resource-ids, in PREFERENCE order. Foreground-only first (persistent grant for
// camera/mic), then plain allow, then the generic positive dialog button (android:id/button1 —
// used by the USB access dialog). One-time is last (least persistent).
const APPROVE_IDS = [
  'permission_allow_foreground_only_button',
  'permission_allow_button',
  'permission_allow_always_button',
  'button1',
  'permission_allow_one_time_button',
];
// Same set, but one-time preferred — for `allow --once`.
const APPROVE_IDS_ONCE = [
  'permission_allow_one_time_button',
  'permission_allow_foreground_only_button',
  'permission_allow_button',
  'button1',
];
// Text fallbacks (RU/EN) when resource-ids aren't present.
const APPROVE_TEXT = /^(allow|allow only while using the app|while using the app|ok|разрешить|разрешать|ок|при использовании приложения)$/i;
const DENY_TEXT    = /(deny|don.?t allow|запретить|не разрешать|отклонить)/i;
// "Use by default for this USB device" / "always" checkbox — ticking it stops the same USB
// camera from re-prompting on every reconnect (also helps Bug 3 / interview #004).
const ALWAYS_TEXT  = /use by default|always|по умолчанию|всегда/i;

/** True if the current screen looks like a system permission / USB access dialog. */
function isPermissionContext(nodes) {
  return nodes.some(n =>
    /permissioncontroller|packageinstaller|systemui|:id\/(permission_|button1)/i.test(n.id) ||
    /\b(camera|microphone|record audio|usb|access|разреш|доступ|камер|микрофон)\b/i.test(`${n.text} ${n.desc}`)
  );
}

/** Pick the approve-button node: by resource-id priority first, then a text fallback. */
function findApproveButton(nodes, preferOnce = false) {
  const ids = preferOnce ? APPROVE_IDS_ONCE : APPROVE_IDS;
  for (const id of ids) {
    const n = nodes.find(x => x.enabled && x.id.toLowerCase().endsWith(id.toLowerCase()));
    if (n) return n;
  }
  return nodes.find(x =>
    x.enabled &&
    (APPROVE_TEXT.test(x.text.trim()) || APPROVE_TEXT.test(x.desc.trim())) &&
    !DENY_TEXT.test(`${x.text} ${x.desc}`)
  ) || null;
}

// ── UIAutomator dump ─────────────────────────────────────────────────────────

const DUMP_REMOTE = '/sdcard/ui_dump.xml';
const DUMP_LOCAL  = join(tmpdir(), 'kcam_ui_dump.xml');

/**
 * Run uiautomator dump on device and return a FRESH XML string.
 *
 * Reliability (Bug 07): `uiautomator dump` silently fails when the UI isn't idle (mid-animation,
 * just after a transition) — it prints an error but leaves the PREVIOUS /sdcard/ui_dump.xml in
 * place and exits 0. Naively pulling that file returns a STALE hierarchy (e.g. a dialog that was
 * already dismissed, or coords from a previous orientation), so taps land on nothing. This was
 * the "tool doesn't see the screen" bug.
 *
 * Fix: delete both the remote and local dump first (so a failure can't yield stale data), require
 * the success marker in the command output, verify the pulled XML, and retry a few times with a
 * short settle delay.
 */
function dumpUi(retries = 5) {
  let triedAnimFix = false;
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Wipe stale dumps up front — a failed dump must NOT leave a previous file to pull. Because we
    // deleted the old one, ANY valid file we manage to pull afterwards is guaranteed to be FRESH
    // (current screen), which is the real success signal — more reliable than parsing the command
    // output (uiautomator prints "could not get idle state" to stderr, which execSync doesn't
    // capture in its return value).
    try { adb('shell', 'rm', '-f', DUMP_REMOTE); } catch {}
    try { if (existsSync(DUMP_LOCAL)) writeFileSync(DUMP_LOCAL, ''); } catch {}

    try { adb('shell', 'uiautomator', 'dump', DUMP_REMOTE); } catch { /* error printed to stderr */ }

    try {
      adb('pull', DUMP_REMOTE, DUMP_LOCAL);
      const xml = readFileSync(DUMP_LOCAL, 'utf8');
      if (xml.includes('<hierarchy')) return xml;  // fresh, valid hierarchy
    } catch { /* no file → dump failed this round */ }

    // Failed. The usual cause is uiautomator never reaching "idle" because the screen animates
    // (e.g. the standby-screen logo pulse — a Compose infinite animation). Disabling the system
    // animation scales makes Compose animations idle (it honors animator_duration_scale), which is
    // harmless on a test device. Do it once, then give the running animation time to settle.
    if (!triedAnimFix) {
      triedAnimFix = true;
      setAnimationScale(0);
      console.error('ℹ️  UI dump failed (screen likely animating) — disabled device animations and retrying. Restore with: ui.mjs anim on');
      sleep(1500);
    } else {
      sleep(700);
    }
  }
  throw new Error('uiautomator dump failed after retries. Try again in a moment, ' +
    'or run `ui.mjs anim off` then retry.');
}

// ── XML parsing (no dependencies — pure regex) ───────────────────────────────

/**
 * Parse UIAutomator XML into array of node objects.
 * Each node has: text, desc, id, cls, bounds, center, clickable, focusable, enabled
 */
function parseNodes(xml) {
  // Match BOTH leaf nodes (<node .../>) and container open tags (<node ...>) so buttons that
  // sit inside nested containers (e.g. system permission dialogs) are also captured.
  const nodeRegex = /<node\s([^>]*?)\/?>/g;
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
    // Screen size/orientation AT DUMP TIME, derived from the widest/tallest node bounds.
    // KrinikCam's MainActivity is screenOrientation="fullSensor" → it rotates with the physical
    // device. If you dump now and tap in a SEPARATE call after the device rotated, coordinates go
    // stale (a portrait tap lands off a landscape screen). Use the atomic `tap <query>` (dumps +
    // taps in one call) and keep the device still during automated taps. (Bug 07.)
    const w = Math.max(0, ...nodes.map(n => n.bounds.x2));
    const h = Math.max(0, ...nodes.map(n => n.bounds.y2));
    console.log(`📐 screen ${w}x${h} · ${w > h ? 'landscape' : 'portrait'} — coords valid for THIS orientation only`);
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

  case 'screen': {
    // Capture a screenshot as a COMPRESSED JPEG (full resolution kept, quality 80) so the image
    // is light for AI vision analysis. Uses the `sharp` library (no native CLI dependency).
    // Default into tools/screenshots/ — a gitignored folder, so transient screenshots never
    // need manual cleanup (see .gitignore).
    const outArg = rest[0] || 'tools/screenshots/adb_screen.jpg';
    const out = isAbsolute(outArg) ? outArg : join(process.cwd(), outArg);
    mkdirSync(dirname(out), { recursive: true });
    const deviceFlag = ADB_DEVICE ? ['-s', ADB_DEVICE] : [];
    // Raw PNG bytes from the device — binary, so bypass the utf8 adb() helper.
    const png = execFileSync('adb', [...deviceFlag, 'exec-out', 'screencap', '-p'],
      { maxBuffer: 128 * 1024 * 1024 });
    const sharp = (await import('sharp')).default;
    const info = await sharp(png).jpeg({ quality: SCREENSHOT_JPEG_QUALITY }).toFile(out);
    const kb = (statSync(out).size / 1024).toFixed(0);
    console.log(`✓ screenshot → ${out}  (${info.width}x${info.height}, JPEG q${SCREENSHOT_JPEG_QUALITY}, ${kb} KB)`);
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

  case 'allow': {
    // Approve visible system permission / USB dialogs. Loops to handle a chain of dialogs
    // (e.g. camera → microphone → USB) — re-dumps after each tap until none remain.
    // `--once` prefers the "Only this time" button over the persistent grant.
    const preferOnce = rest.includes('--once');
    const MAX_ROUNDS = 6;
    let approved = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const nodes = parseNodes(dumpUi());
      if (!isPermissionContext(nodes)) {
        if (round === 0) console.log('ℹ️  No system permission / USB dialog on screen.');
        break;
      }
      // Tick "use by default for this USB device" / "always" so reconnects don't re-prompt.
      const always = nodes.find(n =>
        ALWAYS_TEXT.test(`${n.text} ${n.desc}`) && !n.checked &&
        (n.clickable || n.cls.includes('CheckBox')));
      if (always) {
        adb('shell', 'input', 'tap', String(always.center.x), String(always.center.y));
        console.log(`☑️  Ticked "${(always.text || always.desc).trim()}"`);
        sleep(300);
      }
      const btn = findApproveButton(parseNodes(dumpUi()), preferOnce);
      if (!btn) {
        console.log('⚠️  Dialog detected but no approve button found — run `dump` to inspect.');
        break;
      }
      console.log(`✅ Approving: ${label(btn)}  at (${btn.center.x},${btn.center.y})`);
      adb('shell', 'input', 'tap', String(btn.center.x), String(btn.center.y));
      approved++;
      sleep(900);  // let the next dialog appear, or the current one dismiss
    }
    console.log(approved ? `✔ Approved ${approved} dialog(s).` : 'Nothing approved.');
    break;
  }

  case 'kill': {
    // Force-stop app(s). Default: BOTH builds — frees the USB camera one build is holding so
    // the other can open it (dev ↔ release).
    const pkgs = resolvePkgs(rest[0]);
    for (const p of pkgs) {
      adb('shell', 'am', 'force-stop', p);
      console.log(`✓ force-stopped ${p}`);
    }
    console.log('📷 camera released');
    break;
  }

  case 'start': {
    const [p] = resolvePkgs(rest[0] || 'debug');
    adb('shell', 'am', 'start', '-n', `${p}/${MAIN_ACTIVITY}`);
    console.log(`✓ started ${p}`);
    break;
  }

  case 'restart': {
    // Free the camera then relaunch — handy after reinstall, or to recover a stuck camera.
    const [p] = resolvePkgs(rest[0] || 'debug');
    adb('shell', 'am', 'force-stop', p);
    sleep(600);
    adb('shell', 'am', 'start', '-n', `${p}/${MAIN_ACTIVITY}`);
    console.log(`✓ restarted ${p}`);
    break;
  }

  case 'anim': {
    // Toggle device animations. OFF (default) lets uiautomator dump reach idle on animated
    // screens; ON restores normal animations for the user.
    const on = rest[0] === 'on'
    setAnimationScale(on ? 1 : 0)
    console.log(`✓ device animations ${on ? 'ON' : 'OFF'}`)
    break
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
  node tools/ui.mjs screen [out.jpg]  — screenshot → compressed JPEG (full res, q80, light for AI)
  node tools/ui.mjs allow [--once]    — approve system permission / USB access dialog(s)
  node tools/ui.mjs kill [debug|release|both]   — force-stop app(s), free the camera (default: both)
  node tools/ui.mjs start [debug|release]       — launch app (default: debug)
  node tools/ui.mjs restart [debug|release]     — force-stop + relaunch (default: debug)
  node tools/ui.mjs anim [on|off]               — toggle device animations (off lets dump reach idle)

Examples:
  node tools/ui.mjs dump
  node tools/ui.mjs tap "go live"
  node tools/ui.mjs allow              # grant camera/mic/USB without bothering Krinik
  node tools/ui.mjs kill both          # release the camera between dev/release
  node tools/ui.mjs restart release    # relaunch the release build
`);
  }
}
