#!/usr/bin/env node
/**
 * net-chaos.mjs — TCP-прокси-дроссель между планшетом и RTMP-полигоном.
 *
 * ЗАЧЕМ. Главный сценарий живучести эфира — не «сеть умерла», а **«сеть жива, но не тянет»**
 * (по разведдоку `researches/network_resilience.md` это ~80% реальной боли Криника: класс отказа K1).
 * Заморозка приёмника (`rtmp-server.mjs freeze`) моделирует только зомби-сервер K5, а узкий канал —
 * не моделирует ВООБЩЕ: при мёртвом сокете зритель не видит ничего, тогда как слейт и адаптивный
 * битрейт нужны именно тогда, когда канал живой, но узкий.
 *
 * ПОЧЕМУ ПРОКСИ, А НЕ pfctl/dnctl. Решение владельца (interview_012, В3, дословно: «я могу тебе дать
 * судо. Но бля - нет для этого мидлвейра, который легко поставить и судо не требует?»). Прокси в
 * userspace: sudo не нужен, системные сетевые настройки Мака не трогаются, ADB-канал не задевается
 * (душится ровно одна TCP-сессия — та, что идёт на прокси), и всё это снимается закрытием процесса.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   node tools/rtmp-server.mjs start                       # полигон на :1935
 *   node tools/net-chaos.mjs start --kbps 300              # дроссель на :1936 → 127.0.0.1:1935
 *   node tools/ui.mjs cmd go-live-rtmp rtmp://<ip-мака>:1936/live/test   # ⚠️ порт 1936, не 1935
 *   node tools/net-chaos.mjs set --kbps 150                # сузить канал на живом эфире
 *   node tools/net-chaos.mjs mode blackhole                # K4: байты принимаем и ВЫБРАСЫВАЕМ
 *   node tools/net-chaos.mjs mode stall                    # K5: перестаём читать сокет вообще
 *   node tools/net-chaos.mjs mode pass                     # вернуть нормальную пересылку
 *   node tools/net-chaos.mjs cut                           # разорвать текущие соединения
 *   node tools/net-chaos.mjs status / stop
 *
 * УСТРОЙСТВО. Демон слушает --listen и на каждое входящее соединение открывает сокет к --target,
 * перекладывая байты в обе стороны. Направление «планшет → сервер» (аплинк) проходит через
 * токен-бакет: это и есть дроссель. Обратное направление не душим — у RTMP-публикации там почти
 * ничего нет, а лишнее ограничение исказило бы картину.
 *
 * Управление живым демоном — через файл состояния (демон перечитывает его раз в 200 мс), а не через
 * сигналы: так `set --kbps` работает на ходу и не требует перезапуска эфира.
 *
 * [NOT-TESTED] — до первого прогона с живым эфиром (шаг C6 в plans/21).
 */

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(__dirname, 'bin', 'net-chaos.json')
const PID_FILE = path.join(__dirname, 'bin', 'net-chaos.pid')
const LOG_FILE = path.join(__dirname, 'bin', 'net-chaos.log')

const DEFAULTS = {
  listen: 1936,
  target: '127.0.0.1:1935',
  kbps: 0,          // 0 = без ограничения
  mode: 'pass',     // pass | blackhole | stall
  cutSeq: 0,        // счётчик: увеличение = команда разорвать соединения
}

// ── состояние ───────────────────────────────────────────────────────────────

function readState() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) } }
  catch { return { ...DEFAULTS } }
}
function writeState(patch) {
  const s = { ...readState(), ...patch }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
  return s
}
function daemonAlive() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10)
    process.kill(pid, 0)
    return pid
  } catch { return 0 }
}
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  if (!process.env.NET_CHAOS_DAEMON) process.stdout.write(line)
}

// ── демон ───────────────────────────────────────────────────────────────────

function runDaemon() {
  let state = readState()
  const [tHost, tPort] = String(state.target).split(':')
  const sockets = new Set()
  let lastCutSeq = state.cutSeq

  // Перечитываем состояние на ходу — так `set --kbps` меняет полосу прямо на живом эфире.
  setInterval(() => {
    state = readState()
    if (state.cutSeq !== lastCutSeq) {
      lastCutSeq = state.cutSeq
      log(`cut: рву ${sockets.size} соединений`)
      for (const s of sockets) s.destroy()
    }
  }, 200)

  // Статистика: сколько байт ПРИНЯТО от клиента и сколько реально ПРОПУЩЕНО дальше. Без неё
  // «дроссель не душит» и «приложение не чувствует» неразличимы — а это разные диагнозы.
  let statIn = 0, statOut = 0, statQueued = 0
  setInterval(() => {
    if (!statIn && !statOut) return
    const kbpsIn = (statIn * 8 / 1000 / 5).toFixed(0)
    const kbpsOut = (statOut * 8 / 1000 / 5).toFixed(0)
    log(`стат: вход ${kbpsIn} кбит/с · выход ${kbpsOut} кбит/с · в очереди ${statQueued} чанков`)
    statIn = 0; statOut = 0
  }, 5000)

  const server = net.createServer((client) => {
    const upstream = net.connect(parseInt(tPort, 10), tHost)
    sockets.add(client); sockets.add(upstream)
    log(`+ соединение ${client.remoteAddress}:${client.remotePort} → ${state.target}`)

    // Токен-бакет для направления «планшет → сервер». Наливается непрерывно по времени, поэтому
    // средняя полоса равна заданной, а всплески ограничены размером бакета (1 секунда полосы) —
    // это ровно поведение узкого канала, а не «раз в секунду отдали пачку».
    let tokens = 0
    let lastFill = Date.now()
    const queue = []
    let draining = false

    const fill = () => {
      const now = Date.now()
      const bytesPerSec = (state.kbps > 0 ? state.kbps : 0) * 1000 / 8
      tokens += bytesPerSec * (now - lastFill) / 1000
      lastFill = now
      if (bytesPerSec > 0) tokens = Math.min(tokens, bytesPerSec)   // кап = 1 секунда полосы
    }

    const drain = () => {
      if (draining) return
      draining = true
      const step = () => {
        if (!queue.length) { draining = false; return }
        // stall (K5): перестаём читать сокет вообще — клиент упрётся в переполненное окно TCP,
        // соединение живо, но байты не движутся. Ровно «зомби-сервер».
        if (state.mode === 'stall') { setTimeout(step, 100); return }
        fill()
        const chunk = queue[0]
        const unlimited = !(state.kbps > 0)
        if (unlimited || tokens >= chunk.length) {
          queue.shift()
          if (!unlimited) tokens -= chunk.length
          // blackhole (K4): байты ПРИНИМАЕМ и молча выбрасываем — для клиента отправка «удалась»,
          // а до сервера ничего не доходит. Это «чёрная дыра», которую watchdog обязан заметить.
          if (state.mode !== 'blackhole') { upstream.write(chunk); statOut += chunk.length }
          setImmediate(step)
        } else {
          const deficit = chunk.length - tokens
          const bytesPerSec = state.kbps * 1000 / 8
          setTimeout(step, Math.max(5, Math.ceil(deficit / bytesPerSec * 1000)))
        }
      }
      step()
    }

    client.on('data', (chunk) => {
      queue.push(chunk); statIn += chunk.length; statQueued = queue.length
      // Не даём очереди расти бесконечно: при узком канале это ровно то давление, которое
      // должно дойти до приложения (переполнение окна), а не съесть память Мака.
      if (queue.length > 2048) client.pause()
      else if (client.isPaused() && queue.length < 512) client.resume()
      drain()
    })

    // Обратное направление не душим (см. шапку).
    upstream.on('data', (chunk) => { if (state.mode !== 'blackhole') client.write(chunk) })

    const close = (who) => () => {
      sockets.delete(client); sockets.delete(upstream)
      client.destroy(); upstream.destroy()
      log(`- соединение закрыто (${who})`)
    }
    client.on('close', close('клиент')); client.on('error', close('клиент/ошибка'))
    upstream.on('close', close('сервер')); upstream.on('error', close('сервер/ошибка'))
  })

  server.listen(state.listen, () => {
    log(`дроссель слушает :${state.listen} → ${state.target} (kbps=${state.kbps || '∞'}, mode=${state.mode})`)
  })
  process.on('SIGTERM', () => { log('SIGTERM — выключаюсь'); server.close(); process.exit(0) })
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const cmd = process.argv[2]

if (process.env.NET_CHAOS_DAEMON) { runDaemon() }
else if (cmd === 'start') {
  if (daemonAlive()) { console.log('уже работает (pid ' + daemonAlive() + ')'); process.exit(0) }
  const s = writeState({
    listen: parseInt(arg('listen', DEFAULTS.listen), 10),
    target: arg('target', DEFAULTS.target),
    kbps: parseInt(arg('kbps', 0), 10),
    mode: 'pass',
  })
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true, stdio: 'ignore', env: { ...process.env, NET_CHAOS_DAEMON: '1' },
  })
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))
  console.log(`✓ дроссель запущен (pid ${child.pid}) :${s.listen} → ${s.target}`)
  console.log(`  полоса: ${s.kbps ? s.kbps + ' кбит/с' : 'без ограничения'}`)
  console.log(`  публиковать на:  rtmp://<ip-мака>:${s.listen}/live/test   ← порт ДРОССЕЛЯ`)
}
else if (cmd === 'set') {
  const s = writeState({ kbps: parseInt(arg('kbps', 0), 10) })
  console.log(`✓ полоса: ${s.kbps ? s.kbps + ' кбит/с' : 'без ограничения'}`)
}
else if (cmd === 'mode') {
  const m = process.argv[3]
  if (!['pass', 'blackhole', 'stall'].includes(m)) { console.error('mode: pass | blackhole | stall'); process.exit(1) }
  writeState({ mode: m })
  console.log(`✓ режим: ${m}`)
}
else if (cmd === 'cut') {
  const s = writeState({ cutSeq: readState().cutSeq + 1 })
  console.log(`✓ команда разрыва отправлена (seq ${s.cutSeq})`)
}
else if (cmd === 'status') {
  const pid = daemonAlive()
  const s = readState()
  console.log(pid ? `✅ работает (pid ${pid}) :${s.listen} → ${s.target}` : '⛔ не запущен')
  console.log(`   полоса: ${s.kbps ? s.kbps + ' кбит/с' : 'без ограничения'} · режим: ${s.mode}`)
}
else if (cmd === 'stop') {
  const pid = daemonAlive()
  if (!pid) { console.log('не запущен'); process.exit(0) }
  process.kill(pid, 'SIGTERM')
  try { fs.unlinkSync(PID_FILE) } catch {}
  console.log(`✓ дроссель остановлен (pid ${pid})`)
}
else {
  console.log(`net-chaos.mjs — TCP-дроссель между планшетом и RTMP-полигоном (sudo не нужен)

  start [--listen 1936] [--target 127.0.0.1:1935] [--kbps N]   поднять дроссель
  set --kbps N            сменить полосу НА ХОДУ (0 = снять ограничение)
  mode pass|blackhole|stall   pass — обычная пересылка
                              blackhole (K4) — байты принимаем и выбрасываем
                              stall (K5) — перестаём читать сокет
  cut                     разорвать текущие соединения
  status | stop

Публиковать эфир НА ПОРТ ДРОССЕЛЯ: rtmp://<ip-мака>:1936/live/test`)
}
