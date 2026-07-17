#!/usr/bin/env node
/**
 * smoke.mjs — one-button smoke test of the KrinikCam video pipeline (plans/01 §B1).
 *
 * Кодифицирует цепочку ручной верификации: (build) → install → launch → harness (виртуалка +
 * запись в файл + оверлей + поворот) → запись N сек → adb pull → ffprobe-ассерты → PASS/FAIL одним
 * экраном. Phase 3: композитор — единственный пайплайн (команды `compositor` больше нет).
 *
 * Что проверяет (ассерты):
 *   1. Валидный MP4 (ffprobe читает width/height — значит muxer закрылся, moov на месте).
 *   2. Размер кадра соответствует повороту: 0/180 → 1920×1080 (пейзаж), 90/270 → 1080×1920 (портрет).
 *   3. Достаточно закодированных кадров (≥ duration·fps·0.5) — энкодер реально получал кадры.
 *   WARN (не fail): подозрительно маленький файл → вероятно чёрный кадр (камера не кормит) — пайплайн
 *   валиден и без камеры (композитор рисует чёрную базу), поэтому это предупреждение, а не провал.
 *
 * Использование:
 *   node tools/smoke.mjs                  # build + smoke, поворот 0 (пейзаж)
 *   node tools/smoke.mjs --skip-build     # без сборки (быстро, если APK уже стоит)
 *   node tools/smoke.mjs --rotation 90    # портрет 9:16 (или --portrait)
 *   node tools/smoke.mjs --duration 8     # длительность записи, сек (по умолчанию 6)
 *   node tools/smoke.mjs --pip            # + PiP-трансформа камеры (в угол) — проверка трансформы слоя
 *   node tools/smoke.mjs --keep           # не удалять вытянутый MP4/кадр (для ручного разбора)
 *
 * Exit code: 0 = PASS, 1 = FAIL (для CI/автолупов). Требует: adb, ffprobe, ffmpeg в PATH.
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Аргументы ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const SKIP_BUILD = has('--skip-build');
const KEEP = has('--keep');
const PIP = has('--pip');
const DURATION = parseInt(val('--duration', '6'), 10);
const ROTATION = has('--portrait') ? 90 : parseInt(val('--rotation', '0'), 10);

const PKG = 'com.kriniks.kcam.debug';
const REC_DIR = `/sdcard/Android/data/${PKG}/files/rec`;
const JBR = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';

// ── ADB (то же разрешение устройства, что в ui.mjs) ───────────────────────────
const ADB_DEVICE = process.env.ADB_DEVICE || (() => {
  try {
    const lines = execSync('adb devices', { encoding: 'utf8' }).split('\n').slice(1)
      .filter((l) => l.trim() && !l.startsWith('*') && l.includes('\tdevice'));
    return lines.length ? lines[0].split('\t')[0].trim() : null;
  } catch { return null; }
})();
const adb = (...a) => execSync(['adb', ...(ADB_DEVICE ? ['-s', ADB_DEVICE] : []), ...a].join(' '), { encoding: 'utf8' });
const ui = (...a) => execSync(`node ${join(import.meta.dirname, 'ui.mjs')} ${a.join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const log = (m) => console.log(m);
const sleep = (ms) => execSync(`sleep ${ms / 1000}`); // синхронная пауза (harness детерминирован)

function fail(msg) { console.error(`\n❌ SMOKE FAIL: ${msg}`); process.exit(1); }

// ── Пайплайн ─────────────────────────────────────────────────────────────────
function main() {
  if (!ADB_DEVICE) fail('нет подключённого ADB-устройства (adb devices)');
  log(`▶ smoke: device=${ADB_DEVICE} rotation=${ROTATION}° duration=${DURATION}s pip=${PIP} build=${!SKIP_BUILD}`);

  if (!SKIP_BUILD) {
    log('▶ build (JBR)…');
    try {
      execFileSync('node', ['tools/build.mjs', '--no-ui'], { stdio: 'inherit', env: { ...process.env, JAVA_HOME: JBR } });
    } catch { fail('сборка упала (см. вывод выше)'); }
    log('▶ install…');
    try { adb('install', '-r', 'app/build/outputs/apk/debug/app-debug.apk'); }
    catch { fail('adb install не прошёл'); }
  }

  log('▶ launch (kill+start)…');
  try { ui('kill', 'both'); } catch {}
  sleep(1000);
  adb('shell', 'am', 'start', '-n', `${PKG}/com.kriniks.kcam.MainActivity`);
  sleep(6000); // дать GL/композитору и (если есть) камере подняться

  log('▶ harness: stream-to-file + virtual-camera + overlay…');
  ui('cmd', 'stream-to-file', 'on');
  ui('cmd', 'virtual-camera', 'on');
  ui('cmd', 'add-overlay');
  if (PIP) ui('cmd', 'set-transform', 'camera', '0.4', '0.75', '0.75');
  ui('cmd', 'set-rotation', String(ROTATION));
  sleep(3000); // дать источнику/повороту устаканиться

  // ── Контракт CMD-протокола (bug 39): каждый параметризованный action из help прогоняется через
  // ресивер с безобидными аргументами; затем лог приложения проверяется на «unknown action» и
  // warn-подсказки usage (они значат, что ресивер НЕ понял аргументы → протокол разошёлся).
  // Новый action → добавь сюда строку, иначе рассинхрон ui.mjs↔ресивера снова уползёт в тень.
  log('▶ contract: CMD-протокол (все actions с аргументами)…');
  const CONTRACT = [
    ['add-overlay', 'contract_ov'],
    ['set-transform', 'contract_ov', '0.25', '0.8', '0.8', '0.6', '0'],
    ['layer-up', 'contract_ov'],
    ['layer-down', 'contract_ov'],
    ['gesture-drag', 'contract_ov', '0.01', '0'],
    ['gesture-scale', 'contract_ov', '1.0'],
    ['gesture-rotate', 'contract_ov', '0'],
    ['gesture-pinch', 'out', '0.05'],
    ['gesture-twist', '2', '0.5'],
    ['select-source', 'virtual'],
    ['rotation-mode', 'on'],
    ['rotation-mode', 'off'],
    ['toggle-layer', 'contract_ov'], // спрятать контрактный оверлей, чтобы не влиял на запись
  ];
  for (const c of CONTRACT) ui('cmd', ...c);
  sleep(1500);
  const contractLog = adb('shell', `"tail -100 /sdcard/Android/data/${PKG}/files/logs/kcam_$(date +%Y-%m-%d).log 2>/dev/null"`);
  const desync = contractLog.split('\n').filter((l) =>
    /CMD: unknown action/.test(l) ||
    /select-source: front\|rear/.test(l) ||          // usage-warn = аргументы не поняты
    /gesture-(drag|scale|rotate): '/.test(l) ||
    /set-transform: need/.test(l));
  if (desync.length) fail(`контракт CMD-протокола разошёлся:\n  ${desync.join('\n  ')}`);
  log('  ✓ контракт: все actions поняты ресивером');

  log(`▶ record ${DURATION}s…`);
  ui('cmd', 'go-live');
  sleep(DURATION * 1000);
  ui('cmd', 'stop');
  sleep(3000); // дать muxer'у финализировать (moov)

  // Вытянуть последнюю запись.
  const name = adb('shell', `ls -t ${REC_DIR} | head -1`).trim();
  if (!name) fail('в rec-директории нет файлов записи');
  const tmp = mkdtempSync(join(tmpdir(), 'kcam-smoke-'));
  const local = join(tmp, name);
  adb('pull', `${REC_DIR}/${name}`, local);
  if (!existsSync(local)) fail('adb pull записи не удался');
  const bytes = statSync(local).size;

  // ── ffprobe-ассерты (JSON — надёжный доступ к полям по имени, а не по позиции) ──
  let stream;
  try {
    const json = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,duration -of json "${local}"`,
      { encoding: 'utf8' },
    );
    stream = JSON.parse(json).streams?.[0] || {};
  } catch { fail(`битый MP4 (ffprobe не читает) — ${local} (${bytes} B)`); }

  const width = parseInt(stream.width, 10), height = parseInt(stream.height, 10);
  // nb_frames в MP4 иногда N/A → фолбэк: считаем кадры точно через nb_read_packets.
  let frames = parseInt(stream.nb_frames, 10);
  if (!Number.isFinite(frames)) {
    frames = parseInt(execSync(
      `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${local}"`,
      { encoding: 'utf8' },
    ).trim(), 10) || 0;
  }
  const portrait = ROTATION === 90 || ROTATION === 270;
  const expW = portrait ? 1080 : 1920, expH = portrait ? 1920 : 1080;

  const results = [];
  const check = (ok, label) => { results.push({ ok, label }); return ok; };

  check(width === expW && height === expH, `размер кадра ${width}×${height} == ожидаемый ${expW}×${expH} (поворот ${ROTATION}°)`);
  const minFrames = Math.floor(DURATION * 30 * 0.5);
  check(frames >= minFrames, `кадров ${frames} ≥ порог ${minFrames} (энкодер получал кадры)`);

  // WARN на вероятно-чёрный (камера не кормит): для ~6с 1080p контент > ~300 КБ, чёрное < ~150 КБ.
  const perSec = bytes / Math.max(DURATION, 1);
  const likelyBlack = perSec < 30_000; // ~30 КБ/с — эвристика чёрного кадра

  // ── Отчёт ────────────────────────────────────────────────────────────────
  log('\n── Результаты ─────────────────────────────');
  for (const r of results) log(`  ${r.ok ? '✅' : '❌'} ${r.label}`);
  log(`  ${likelyBlack ? '⚠️ ' : '✅'} размер ${(bytes / 1024).toFixed(0)} КБ (${(perSec / 1024).toFixed(0)} КБ/с)` +
      `${likelyBlack ? ' — вероятно ЧЁРНЫЙ кадр (камера не кормит; пайплайн валиден)' : ''}`);
  log(`  файл: ${KEEP ? local : '(удалён; --keep чтобы оставить)'}`);

  if (!KEEP) execSync(`rm -rf "${tmp}"`);

  const passed = results.every((r) => r.ok);
  if (passed) { log(`\n✅ SMOKE PASS${likelyBlack ? ' (с предупреждением о чёрном кадре)' : ''}\n`); process.exit(0); }
  fail('часть ассертов не прошла (см. выше)');
}

main();
