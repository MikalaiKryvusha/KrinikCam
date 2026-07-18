#!/usr/bin/env node
/**
 * avd.mjs — Android Virtual Device как тест-девайс агента (Idea 28). [TESTED: 2026-07-18 · см. idea 28]
 *
 * Зачем: когда физический планшет Криника недоступен (не в сети / занят), агент поднимает
 * ЭМУЛЯТОР и продолжает автономно собирать/ставить/тестировать: у AVD есть эмулированные
 * front/back камеры — приложение видит их как настоящие Camera2-устройства (слой «Устройство
 * захвата видео» работает), а весь харнес (ui.mjs/smoke.mjs) заводится через ADB_DEVICE=emulator-5554.
 *
 * Команды:
 *   node tools/avd.mjs create   — создать AVD kcam_test (API 34, arm64, google_apis; идемпотентно)
 *   node tools/avd.mjs start    — запустить headless (без окна; screencap через adb работает) и
 *                                 дождаться полной загрузки (sys.boot_completed)
 *   node tools/avd.mjs stop     — погасить эмулятор
 *   node tools/avd.mjs status   — состояние (создан? запущен? serial?)
 *   node tools/avd.mjs smoke    — прогнать tools/smoke.mjs на эмуляторе (ADB_DEVICE=emulator-5554)
 *
 * Практика: харнес на эмуляторе = `ADB_DEVICE=emulator-5554 node tools/ui.mjs ...`;
 * системная камера эмулятора = `ui.mjs cmd select-source builtin,<id>` (или device-camera front).
 * Related: ideas/28, tools/ui.mjs, tools/smoke.mjs, AGENT_GUIDE «Инструменты».
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, openSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SDK = join(homedir(), 'Library/Android/sdk');
const AVDMANAGER = join(SDK, 'tools/bin/avdmanager'); // легаси-путь (cmdline-tools не установлены)
const EMULATOR = join(SDK, 'emulator/emulator');
const ADB = join(SDK, 'platform-tools/adb');
// Дефолт — ГОТОВЫЙ AVD Android Studio (API 35 ≥ minSdk 33 приложения); переопределяется env KCAM_AVD.
// Своё создание через легаси tools/bin/avdmanager НЕВОЗМОЖНО на JBR 17 (javax.xml.bind удалён в
// Java 11+; поймано живьём 2026-07-18) — новые AVD создаёт Android Studio, скрипт их использует.
const AVD_NAME = process.env.KCAM_AVD || 'Pixel_7_Pro_Android_15';
const SERIAL = 'emulator-5554'; // первый свободный порт эмулятора — наш единственный AVD
const LOG_DIR = join(import.meta.dirname, 'bin');
const EMU_LOG = join(LOG_DIR, 'emulator.log');

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const log = (m) => console.log(m);
const die = (m) => { console.error(`✖ avd: ${m}`); process.exit(1); };

// JBR — тот же Java, что для сборки; легаси-avdmanager работает на нём (проверено живьём).
const JAVA_HOME = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const envWithJava = { ...process.env, JAVA_HOME, ANDROID_SDK_ROOT: SDK, ANDROID_HOME: SDK };

function exists() {
  // Без avdmanager (Java-грабля выше): смотрим прямо в ~/.android/avd.
  return existsSync(join(homedir(), '.android/avd', `${AVD_NAME}.ini`));
}

function running() {
  try { return sh(`"${ADB}" devices`).includes(`${SERIAL}\tdevice`); } catch { return false; }
}

function create() {
  if (exists()) { log(`✓ AVD ${AVD_NAME} уже есть (Android Studio)`); return; }
  const avds = sh(`ls "${join(homedir(), '.android/avd')}"`).split('\n')
    .filter((f) => f.endsWith('.ini')).map((f) => f.replace(/\.ini$/, ''));
  die(`AVD «${AVD_NAME}» не найден. Создай в Android Studio (Device Manager) или укажи существующий\n` +
    `  через KCAM_AVD=<имя>. Доступные: ${avds.join(', ') || '(нет)'}`);
}

function start() {
  if (running()) { log(`✓ эмулятор уже запущен (${SERIAL})`); return; }
  if (!exists()) create();
  mkdirSync(LOG_DIR, { recursive: true });
  // Стейл-локи: убитый инстанс оставляет *.lock в каталоге AVD → следующий запуск отказывается
  // («Running multiple emulators with the same AVD», поймано живьём 2026-07-18). Если реального
  // qemu-процесса нет — локи мусор, чистим.
  const qemuAlive = (() => {
    try { return sh('pgrep -f qemu-system').trim().length > 0; } catch { return false; }
  })();
  if (!qemuAlive) {
    const avdDir = join(homedir(), '.android/avd', `${AVD_NAME}.avd`);
    try { sh(`rm -f "${avdDir}"/*.lock`, { shell: '/bin/zsh' }); log('… стейл-локи AVD почищены'); }
    catch { /* нет локов — ок */ }
  }
  log(`▶ Запускаю ${AVD_NAME} headless (лог: ${EMU_LOG})…`);
  const out = openSync(EMU_LOG, 'a');
  // -no-window: экран не нужен (скрины идут через adb screencap); swiftshader — стабильный
  // софт-GPU для headless; -no-snapshot — чистый старт (детерминизм харнеса).
  const child = spawn(EMULATOR, [
    '-avd', AVD_NAME, '-no-window', '-no-audio', '-no-boot-anim',
    '-gpu', 'swiftshader_indirect', '-no-snapshot',
  ], { env: envWithJava, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  // Ждём полной загрузки Android (boot_completed), максимум ~3 мин.
  log('… жду sys.boot_completed (до 180с)');
  // -s обязателен: на машине обычно ещё планшет (USB+Wi-Fi) — без серийника adb падает.
  sh(`"${ADB}" -s ${SERIAL} wait-for-device`, { timeout: 120_000 });
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      if (sh(`"${ADB}" -s ${SERIAL} shell getprop sys.boot_completed`).trim() === '1') break;
    } catch { /* ещё поднимается */ }
    if (Date.now() > deadline) die('эмулятор не загрузился за 180с (см. лог)');
    execSync('sleep 3');
  }
  log(`✅ эмулятор загружен: ${SERIAL} (ADB_DEVICE=${SERIAL} для ui.mjs/smoke.mjs)`);
}

function stop() {
  if (!running()) { log('✓ эмулятор и так не запущен'); return; }
  sh(`"${ADB}" -s ${SERIAL} emu kill`);
  log('✓ эмулятор остановлен');
}

function status() {
  log(`AVD создан:   ${exists() ? 'да' : 'нет'} (${AVD_NAME})`);
  log(`Запущен:      ${running() ? `да (${SERIAL})` : 'нет'}`);
}

function smoke() {
  if (!running()) start();
  log('▶ smoke на эмуляторе…');
  // --min-fps 3: софт-GPU эмулятора рендерит ~4-5 fps — проверяем функциональность, не скорость.
  execSync(`node ${join(import.meta.dirname, 'smoke.mjs')} --skip-build --duration 10 --min-fps 3`, {
    stdio: 'inherit',
    env: { ...envWithJava, ADB_DEVICE: SERIAL, ANDROID_SERIAL: SERIAL },
  });
}

const cmd = process.argv[2] || 'status';
// Не через `?.() ?? die`: void-команда возвращает undefined и ложно роняла die после успеха.
const fn = ({ create, start, stop, status, smoke })[cmd];
if (!fn) die(`неизвестная команда: ${cmd} (create|start|stop|status|smoke)`);
fn();
