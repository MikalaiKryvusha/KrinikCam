#!/usr/bin/env node
/**
 * watchdog.mjs — the external guard for /guarded-loop.
 *
 * Why an external process at all: a hung agent cannot run its own health check. This process is
 * deliberately dumb and independent — it only watches the freshness of `.kaif/heartbeat.log` and
 * the run deadline, and it POKES the agent by EXITING (the harness re-invokes the agent when a
 * background task finishes, so a clean exit is the wake-up signal).
 *
 * Contract implemented (each line exists because its absence burned a real run — see the skill):
 *   · single-instance guard — a lock file with the pid, so two watchdogs never double-restart;
 *   · debounce — acts only after N CONSECUTIVE stale checks, because a long legitimate step
 *     (build + install + smoke on this project measures a few minutes) must not look like a hang;
 *   · a hard deadline — the run ends by itself even if nobody remembers to stop it;
 *   · disarm — `stop` removes the lock, and every exit path clears it.
 *
 * Thresholds are MEASURED, not invented: the longest single observed step in KrinikCam is
 * build(~25s) + install(~10s) + smoke(~70s) + judge ≈ 3 min, so 10 min of silence is genuinely
 * anomalous, and the 2-check debounce puts the real trigger at ~11 min.
 *
 * Usage:
 *   node tools/watchdog.mjs arm --deadline "11:47" [--stale-min 10] [--debounce 2]
 *   node tools/watchdog.mjs stop
 *   node tools/watchdog.mjs status
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PULSE = resolve(ROOT, '.kaif/heartbeat.log');
const LOCK = resolve(ROOT, '.kaif/watchdog.lock');

const argv = process.argv.slice(2);
const cmd = argv[0];
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const now = () => new Date();
const stamp = () => now().toISOString().slice(11, 19);

/** Is another watchdog already running? A stale lock (dead pid) is not a live instance. */
function liveLock() {
  if (!existsSync(LOCK)) return null;
  const pid = parseInt(readFileSync(LOCK, 'utf8').trim(), 10);
  try { process.kill(pid, 0); return pid; } catch { return null; }   // ESRCH → stale lock
}

function disarm() {
  if (existsSync(LOCK)) unlinkSync(LOCK);
}

if (cmd === 'stop') {
  const pid = liveLock();
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} console.log(`✓ вахтёр остановлен (pid ${pid})`); }
  else console.log('вахтёр не был вооружён');
  disarm();
  process.exit(0);
}

if (cmd === 'status') {
  const pid = liveLock();
  const age = existsSync(PULSE) ? Math.round((Date.now() - statSync(PULSE).mtimeMs) / 1000) : null;
  console.log(`вахтёр: ${pid ? `вооружён (pid ${pid})` : 'не вооружён'}`);
  console.log(`пульс:  ${age === null ? 'файла нет' : `${age} с назад`}`);
  if (existsSync(PULSE)) console.log(`последняя строка: ${readFileSync(PULSE, 'utf8').trim().split('\n').pop()}`);
  process.exit(0);
}

if (cmd !== 'arm') {
  console.log('usage: node tools/watchdog.mjs arm --deadline HH:MM [--stale-min 10] [--debounce 2] | stop | status');
  process.exit(1);
}

// ── arm ──────────────────────────────────────────────────────────────────────

const existing = liveLock();
if (existing) { console.error(`❌ вахтёр уже вооружён (pid ${existing}) — двух не бывает`); process.exit(1); }

const STALE_MIN = parseInt(val('--stale-min', '10'), 10);
const DEBOUNCE = parseInt(val('--debounce', '2'), 10);
const deadlineArg = val('--deadline', null);
if (!deadlineArg) { console.error('❌ --deadline HH:MM обязателен: цикл без границы не заканчивается сам'); process.exit(1); }

const [dh, dm] = deadlineArg.split(':').map(Number);
const deadline = now();
deadline.setHours(dh, dm, 0, 0);
if (deadline <= now()) deadline.setDate(deadline.getDate() + 1);   // деадлайн за полночь

writeFileSync(LOCK, String(process.pid));
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { disarm(); process.exit(0); });

console.log(`🐕 вахтёр вооружён: дедлайн ${deadlineArg}, тревога при молчании пульса ${STALE_MIN} мин × ${DEBOUNCE} проверки`);

let stale = 0;
const tick = setInterval(() => {
  if (now() >= deadline) {
    clearInterval(tick); disarm();
    console.log(`⏰ ДЕДЛАЙН ${deadlineArg} — час вышел, цикл пора закрывать.`);
    process.exit(0);
  }
  const ageMin = existsSync(PULSE) ? (Date.now() - statSync(PULSE).mtimeMs) / 60000 : Infinity;
  if (ageMin > STALE_MIN) {
    stale++;
    console.log(`[${stamp()}] пульс молчит ${ageMin === Infinity ? '(файла нет)' : ageMin.toFixed(1) + ' мин'} — стойка ${stale}/${DEBOUNCE}`);
    if (stale >= DEBOUNCE) {
      clearInterval(tick); disarm();
      console.log(`🚨 ПУЛЬС ПРОТУХ — агент, вероятно, завис. Восстановление: /resume + последняя строка .kaif/heartbeat.log`);
      process.exit(0);
    }
  } else if (stale) {
    console.log(`[${stamp()}] пульс вернулся (${ageMin.toFixed(1)} мин) — стойка сброшена`);
    stale = 0;
  }
}, 60_000);
