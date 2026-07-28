#!/usr/bin/env node
/**
 * rtmp-server.mjs — локальный RTMP-полигон на Маке (plans/01 §C). Опенсорс-бинарь MediaMTX (MIT):
 * один самодостаточный сервер, принимающий RTMP на :1935 без конфигурации. Даёт АВТОНОМНЫЙ тест
 * реального стрим-пути (connect/publish), которого раньше не было без YouTube + Криника.
 *
 * Зачем: `stream-to-file` (Idea 10) проверяет ЭНКОДЕР (кадры → MP4), но НЕ сетевой RTMP-путь
 * (RtmpStream.startStream → connect → publish). Локальный сервер закрывает эту дыру и служит
 * фундаментом Phase 5 (reconnect, деградация сети, буферизация).
 *
 * Команды:
 *   node tools/rtmp-server.mjs start     — (скачать при первом запуске и) поднять MediaMTX на :1935
 *   node tools/rtmp-server.mjs stop      — погасить сервер
 *   node tools/rtmp-server.mjs status    — работает ли + URL для публикации с планшета
 *   node tools/rtmp-server.mjs url       — напечатать rtmp://<ip-мака>:1935/live/test
 *   node tools/rtmp-server.mjs freeze    — ЗАМОРОЗИТЬ сервер (SIGSTOP): TCP жив, байты не читаются
 *   node tools/rtmp-server.mjs thaw      — разморозить (SIGCONT)
 *
 * Про freeze/thaw (plans/21 Ш0, класс отказа K5 «зомби-сервер»): замороженный процесс ПЕРЕСТАЁТ
 * читать сокет, но соединение остаётся установленным. Ядро добивает приёмный буфер, TCP-окно
 * закрывается, и `write()` у клиента блокируется — с точки зрения приложения это неотличимо от
 * «чёрной дыры» (K4). Именно так проверяется, за сколько мы замечаем замерший эфир и выходит ли
 * `reTry()` из заблокированной записи. В отличие от `stop` (обрыв, ошибка приходит сразу) здесь
 * ошибки НЕ приходит вовсе — это и есть самый опасный класс, ради которого делается watchdog.
 * Sudo не нужен, ADB-канал не задевается — сигнал уходит локальному процессу на Маке.
 *
 * Бинарь качается в tools/bin/ (gitignored). Публикация с планшета: профиль «Local Test» с URL из
 * `url`. Проверка приёма: `ffprobe rtmp://<ip>:1935/live/test` или запись сервером.
 */

import { execSync, spawn } from 'child_process';
// createWriteStream нужен download() ниже. Его отсутствие в этом списке — спящий дефект (найден
// разведкой сети 2026-07-26): на машине, где бинарь MediaMTX уже скачан, ветка download() не
// выполняется, поэтому ReferenceError не проявлялся; на ЧИСТОЙ машине первый `start` падал.
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync, createWriteStream } from 'fs';
import { join } from 'path';
import { get } from 'https';

const MEDIAMTX_VERSION = 'v1.19.2';
const RTMP_PORT = 1935;
const BIN_DIR = join(import.meta.dirname, 'bin');
const BIN = join(BIN_DIR, 'mediamtx');
const CFG = join(BIN_DIR, 'mediamtx.yml');
const PIDFILE = join(BIN_DIR, 'mediamtx.pid');
const STREAM_PATH = 'live/test';

// ── Платформа → ассет релиза MediaMTX ─────────────────────────────────────────
function assetName() {
  const arch = process.arch === 'arm64' ? 'arm64' : (process.arch === 'x64' ? 'amd64' : process.arch);
  const os = process.platform === 'darwin' ? 'darwin' : (process.platform === 'linux' ? 'linux' : process.platform);
  return `mediamtx_${MEDIAMTX_VERSION}_${os}_${arch}.tar.gz`;
}

// LAN-IP Мака в подсети планшета (192.168.1.x) — планшет по нему достучится до сервера.
function macIp() {
  try {
    const ip = execSync("ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null", { encoding: 'utf8' }).trim().split(/\s+/)[0];
    return ip || '127.0.0.1';
  } catch { return '127.0.0.1'; }
}

const ingestUrl = () => `rtmp://${macIp()}:${RTMP_PORT}/${STREAM_PATH}`;

// Скачать файл по HTTPS (следуя редиректам GitHub) в [dest].
function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'krinikcam-rtmp' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} для ${url}`)); }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

// Убедиться, что бинарь MediaMTX на месте (скачать+распаковать при первом запуске).
async function ensureBinary() {
  if (existsSync(BIN)) return;
  mkdirSync(BIN_DIR, { recursive: true });
  const asset = assetName();
  const url = `https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${asset}`;
  const tgz = join(BIN_DIR, asset);
  console.log(`▶ скачиваю MediaMTX ${MEDIAMTX_VERSION} (${asset})…`);
  await download(url, tgz);
  console.log('▶ распаковываю…');
  execSync(`tar -xzf "${tgz}" -C "${BIN_DIR}" mediamtx`, { stdio: 'inherit' });
  execSync(`chmod +x "${BIN}"`);
  unlinkSync(tgz);
  // Минимальный конфиг: только RTMP на :1935 (HLS/WebRTC/RTSP выключаем — не нужны полигону).
  writeFileSync(CFG, [
    'rtmp: yes',
    `rtmpAddress: :${RTMP_PORT}`,
    'hls: no',
    'webrtc: no',
    'rtsp: no',
    'srt: no',
    'api: no',
    'metrics: no',
    'logLevel: info',
    'paths:',
    '  all_others:',
  ].join('\n') + '\n');
  console.log(`✓ MediaMTX установлен → ${BIN}`);
}

// Работает ли сервер (по pidfile + живости процесса).
function runningPid() {
  if (!existsSync(PIDFILE)) return null;
  const pid = parseInt(readFileSync(PIDFILE, 'utf8').trim(), 10);
  if (!pid) return null;
  try { process.kill(pid, 0); return pid; } catch { return null; }
}

async function start() {
  if (runningPid()) { console.log(`уже работает (pid ${runningPid()}). URL: ${ingestUrl()}`); return; }
  await ensureBinary();
  const logOut = join(BIN_DIR, 'mediamtx.log');
  // Node 23: createWriteStream в stdio ещё не имеет открытого fd на момент spawn → ERR_INVALID_ARG_VALUE.
  // Открываем fd файла синхронно и передаём число — надёжно для detached-процесса (stdout+stderr в лог).
  const logFd = openSync(logOut, 'w');
  // cwd = BIN_DIR: MediaMTX генерит auto.crt/auto.key в текущую папку — держим их в (gitignored)
  // tools/bin/, чтобы не мусорить в корне репозитория.
  const child = spawn(BIN, [CFG], { cwd: BIN_DIR, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  writeFileSync(PIDFILE, String(child.pid));
  execSync('sleep 1');
  if (!runningPid()) { console.error(`✖ сервер не поднялся — смотри ${logOut}`); process.exit(1); }
  console.log(`✅ RTMP-полигон поднят (pid ${child.pid}) на :${RTMP_PORT}`);
  console.log(`   Публикация с планшета: ${ingestUrl()}`);
  console.log(`   Проверка приёма:       ffprobe ${ingestUrl()}`);
  console.log(`   Лог сервера:           ${logOut}`);
}

function stop() {
  const pid = runningPid();
  if (!pid) { console.log('сервер не запущен'); return; }
  try { process.kill(pid, 'SIGTERM'); } catch {}
  try { unlinkSync(PIDFILE); } catch {}
  console.log(`✓ RTMP-полигон остановлен (pid ${pid})`);
}

// Состояние процесса по ps: 'T' = остановлен сигналом (заморожен), 'S'/'R'/'I' = живой.
// Возвращает первую букву кода состояния BSD (у macOS бывает 'S+', 'Ss', 'T' и т.п.).
// [TESTED: 2026-07-28 · прогон start→status(S)→freeze→status(T)→thaw→status(S) на живом MediaMTX]
function procState(pid) {
  try {
    const s = execSync(`ps -o state= -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
    return s ? s[0] : null;
  } catch { return null; }
}

const isFrozen = (pid) => procState(pid) === 'T';

function status() {
  const pid = runningPid();
  if (pid) {
    const frozen = isFrozen(pid);
    console.log(`${frozen ? '🧊 ЗАМОРОЖЕН' : '✅ работает'} (pid ${pid}, состояние ${procState(pid) ?? '?'}) на :${RTMP_PORT}`);
    if (frozen) console.log('   сокет открыт, но байты НЕ читаются — модель K5 (node tools/rtmp-server.mjs thaw)');
    console.log(`   URL для публикации: ${ingestUrl()}`);
  } else {
    console.log('⭕ не запущен  (node tools/rtmp-server.mjs start)');
  }
}

// ── freeze/thaw — модель «зомби-сервера» K5 (plans/21 Ш0) ─────────────────────
// SIGSTOP нельзя перехватить или проигнорировать: процесс гарантированно снимается с планировщика
// целиком (вместе со всеми потоками), поэтому это ЧЕСТНАЯ модель приёмника, который держит
// соединение, но не разбирает входящие байты.
// [TESTED: 2026-07-28 · freeze дал состояние T, thaw вернул S; поведение эфира — журнал §14 разведдока]
function freeze() {
  const pid = runningPid();
  if (!pid) { console.log('сервер не запущен — замораживать нечего'); process.exit(1); }
  if (isFrozen(pid)) { console.log(`уже заморожен (pid ${pid})`); return; }
  process.kill(pid, 'SIGSTOP');
  console.log(`🧊 сервер ЗАМОРОЖЕН (pid ${pid}, состояние ${procState(pid) ?? '?'})`);
  console.log('   соединение живо, байты не читаются → клиент упрётся в блокирующий write()');
  console.log('   разморозить: node tools/rtmp-server.mjs thaw');
}

function thaw() {
  const pid = runningPid();
  if (!pid) { console.log('сервер не запущен — размораживать нечего'); process.exit(1); }
  if (!isFrozen(pid)) { console.log(`сервер не заморожен (pid ${pid}, состояние ${procState(pid) ?? '?'})`); return; }
  process.kill(pid, 'SIGCONT');
  console.log(`✓ сервер размо́рожен (pid ${pid}, состояние ${procState(pid) ?? '?'})`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': stop(); break;
  case 'status': status(); break;
  case 'url': console.log(ingestUrl()); break;
  case 'freeze': freeze(); break;
  case 'thaw': thaw(); break;
  default:
    console.log('Usage: node tools/rtmp-server.mjs <start|stop|status|url|freeze|thaw>');
    console.log(`  Локальный RTMP-полигон (MediaMTX ${MEDIAMTX_VERSION}) для автономного теста стрим-пути.`);
}
