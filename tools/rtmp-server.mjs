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
 *
 * Бинарь качается в tools/bin/ (gitignored). Публикация с планшета: профиль «Local Test» с URL из
 * `url`. Проверка приёма: `ffprobe rtmp://<ip>:1935/live/test` или запись сервером.
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync } from 'fs';
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

function status() {
  const pid = runningPid();
  if (pid) {
    console.log(`✅ работает (pid ${pid}) на :${RTMP_PORT}`);
    console.log(`   URL для публикации: ${ingestUrl()}`);
  } else {
    console.log('⭕ не запущен  (node tools/rtmp-server.mjs start)');
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': stop(); break;
  case 'status': status(); break;
  case 'url': console.log(ingestUrl()); break;
  default:
    console.log('Usage: node tools/rtmp-server.mjs <start|stop|status|url>');
    console.log(`  Локальный RTMP-полигон (MediaMTX ${MEDIAMTX_VERSION}) для автономного теста стрим-пути.`);
}
