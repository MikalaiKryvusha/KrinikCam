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
 *   node tools/net-chaos.mjs selftest                      # ГАРД: доказать полосу независимым приёмником
 *
 * УСТРОЙСТВО. Демон слушает --listen и на каждое входящее соединение открывает сокет к --target,
 * перекладывая байты в обе стороны. Направление «планшет → сервер» (аплинк) проходит через
 * токен-бакет: это и есть дроссель. Обратное направление не душим — у RTMP-публикации там почти
 * ничего нет, а лишнее ограничение исказило бы картину.
 *
 * Управление живым демоном — через файл состояния (демон перечитывает его раз в 200 мс), а не через
 * сигналы: так `set --kbps` работает на ходу и не требует перезапуска эфира.
 *
 * ИЗВЕСТНОЕ ПОВЕДЕНИЕ (не дефект, но знать обязательно): при закрытии КЛИЕНТСКОГО сокета демон
 * уничтожает обе стороны вместе с непереданной очередью. Живой RTMP-эфир держит соединение всё
 * время сессии, поэтому для целевого сценария это безразлично; а вот синтетический зонд, который
 * «залил и закрыл», получит на приёмнике ноль — и это будет свойством ЗОНДА, а не дросселя.
 *
 * [TESTED: 2026-07-31 · `selftest` — независимый приёмник считает байты сам: 0 кбит/с (без
 * ограничения) → 193 476, 2000 → 1996, 300 → 299 кбит/с. Гард предварительно проверен НА СЛОМАННОЙ
 * версии и покраснел ровно на точке 300 (см. историю правок ниже и EXPERIENCE).]
 *
 * ИСТОРИЯ ПРАВОК. 2026-07-31 — починены два независимых дефекта, из-за которых инструмент был
 * непригоден именно на своей рабочей полосе: (1) токен-бакет требовал токенов на ЦЕЛЫЙ чанк TCP
 * при капе в одну секунду полосы, отчего всякая полоса ниже ~524 кбит/с давала ровно ноль байт;
 * (2) недостижимая цель не отличалась в логе от исправной работы. Добавлены `selftest` и пречек цели.
 */

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Суффикс файлов состояния. Нужен ровно для `selftest`: он поднимает СВОЙ экземпляр демона на
// своих портах и не имеет права затирать состояние боевого дросселя, который в этот момент может
// душить живой эфир. Пустой суффикс = боевой экземпляр.
const SUFFIX = process.env.NET_CHAOS_SUFFIX || ''
const STATE_FILE = path.join(__dirname, 'bin', `net-chaos${SUFFIX}.json`)
const PID_FILE = path.join(__dirname, 'bin', `net-chaos${SUFFIX}.pid`)
const LOG_FILE = path.join(__dirname, 'bin', `net-chaos${SUFFIX}.log`)

// Минимальный размер записи в аплинк. Без него дроссель на узкой полосе либо крутится вхолостую,
// отдавая по байту, либо (как было до 2026-07-31) не отдаёт вообще ничего. 1460 = типовой MSS,
// то есть ровно то, чем оперирует настоящий узкий канал.
const MIN_WRITE = 1460

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

        // blackhole (K4): байты ПРИНИМАЕМ и молча выбрасываем — для клиента отправка «удалась»,
        // а до сервера ничего не доходит. Это «чёрная дыра», которую watchdog обязан заметить.
        const send = (buf) => {
          if (state.mode !== 'blackhole') { upstream.write(buf); statOut += buf.length }
        }

        if (!(state.kbps > 0)) { send(queue.shift()); setImmediate(step); return }

        fill()
        const head = queue[0]
        // РЕЖЕМ чанк, а не ждём токенов на него целиком: канал — поток БАЙТ, а не поток чанков,
        // и настоящий узкий линк тоже не придерживает 64 КБ до полной оплаты.
        // Прежнее условие `tokens >= chunk.length` вставало НАМЕРТВО, когда кап бакета (одна
        // секунда полосы) оказывался меньше чанка TCP: 300 кбит/с → кап 37 500 Б < чанк 65 536 Б,
        // условие не выполнялось никогда, выход стоял в нуле. Мёртвой была всякая полоса ниже
        // ~524 кбит/с — то есть ровно рабочий диапазон сценария K1, ради которого инструмент писан.
        // (Замерено и починено 2026-07-31; стережёт `selftest`, точка kbps=300.)
        const need = Math.min(MIN_WRITE, head.length)
        if (tokens < need) {
          const bytesPerSec = state.kbps * 1000 / 8
          setTimeout(step, Math.max(5, Math.ceil((need - tokens) / bytesPerSec * 1000)))
          return
        }
        const n = Math.min(Math.floor(tokens), head.length)
        tokens -= n
        if (n === head.length) queue.shift()
        else queue[0] = head.subarray(n)          // хвост головы остаётся первым в очереди
        send(head.subarray(0, n))
        setImmediate(step)
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

    // Причину закрытия ОБЯЗАТЕЛЬНО в лог. 2026-07-29 дроссель стоял с недостижимой целью
    // (опечатка в порту), и это выглядело в логе как обычное закрытие: диагноз «цель мертва»
    // был неотличим от «дроссель душит». Мёртвая цель обязана называть себя вслух.
    const close = (who) => (err) => {
      sockets.delete(client); sockets.delete(upstream)
      client.destroy(); upstream.destroy()
      log(`- соединение закрыто (${who}${err && err.message ? ': ' + err.message : ''})`)
    }
    client.on('close', close('клиент')); client.on('error', close('клиент/ошибка'))
    upstream.on('close', close('сервер')); upstream.on('error', close('сервер/ошибка'))
  })

  server.listen(state.listen, () => {
    log(`дроссель слушает :${state.listen} → ${state.target} (kbps=${state.kbps || '∞'}, mode=${state.mode})`)
  })
  process.on('SIGTERM', () => { log('SIGTERM — выключаюсь'); server.close(); process.exit(0) })
}

// ── selftest ────────────────────────────────────────────────────────────────

/**
 * Гард дросселя: доказывает, что заданная полоса РЕАЛЬНО соблюдается — независимым приёмником,
 * а не собственной статистикой демона.
 *
 * Почему гард именно такой. 2026-07-29 дроссель отработал вживую и напечатал «выход 0 кбит/с»;
 * это неотличимо от «задушил насмерть», и дефект прожил незамеченным до 2026-07-31, когда
 * замер показал, что на 300 кбит/с не проходит НИ ОДНОГО байта (токен-бакет капился одной
 * секундой полосы — 37 500 Б — и никогда не набирал на целый TCP-чанк в 65 536 Б).
 * Собственный лог демона такой отказ показать не может ПО ПОСТРОЕНИЮ — считать обязан приёмник.
 *
 * Ключевая точка матрицы — 300 кбит/с: это рабочая полоса сценария K1 и ровно та, на которой
 * инструмент был мёртв. Проверено на сломанной версии (гард покраснел), см. EXPERIENCE.
 */
async function selfTest() {
  const LISTEN = 19936, SINK = 19999, SECONDS = 6
  const CASES = [
    { kbps: 0, min: 10_000, max: Infinity, note: 'без ограничения — должен лить свободно' },
    { kbps: 2000, min: 1500, max: 2500, note: 'широкая полоса' },
    { kbps: 300, min: 225, max: 375, note: 'УЗКАЯ полоса — рабочая точка сценария K1' },
  ]

  // Приёмник: считает байты сам. Это и есть независимость измерения.
  let received = 0
  const sink = net.createServer((s) => s.on('data', (ch) => { received += ch.length }))
  await new Promise((res, rej) => { sink.once('error', rej); sink.listen(SINK, res) })

  const { spawn } = await import('node:child_process')
  const env = { ...process.env, NET_CHAOS_DAEMON: '1', NET_CHAOS_SUFFIX: '-selftest' }
  let failures = 0

  for (const c of CASES) {
    // Свежий демон на каждый случай: полоса читается из состояния при старте соединения.
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(
      path.join(__dirname, 'bin', 'net-chaos-selftest.json'),
      JSON.stringify({ listen: LISTEN, target: `127.0.0.1:${SINK}`, kbps: c.kbps, mode: 'pass', cutSeq: 0 }))
    const daemon = spawn(process.execPath, [fileURLToPath(import.meta.url)], { env, stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 700))

    received = 0
    const t0 = Date.now()
    // Источник льёт непрерывно и НЕ закрывает сокет: на закрытии клиента демон уничтожает
    // непереданную очередь, и замер выродился бы в ноль по вине зонда, а не дросселя.
    const payload = Buffer.alloc(16 * 1024, 0x41)
    const src = net.connect(LISTEN, '127.0.0.1')
    await new Promise((r) => src.once('connect', r))
    const pump = () => {
      while (Date.now() - t0 < SECONDS * 1000) if (!src.write(payload)) { src.once('drain', pump); return }
    }
    pump()
    await new Promise((r) => setTimeout(r, SECONDS * 1000 + 500))
    const sec = (Date.now() - t0) / 1000
    const kbps = received * 8 / 1000 / sec
    src.destroy(); daemon.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 300))

    const ok = kbps >= c.min && kbps <= c.max
    if (!ok) failures++
    const want = c.kbps === 0 ? `≥ ${c.min}` : `${c.min}…${c.max}`
    console.log(`${ok ? '✅' : '❌'} kbps=${String(c.kbps).padStart(4)} → замерено ${kbps.toFixed(0).padStart(6)} кбит/с (ждали ${want}) · ${c.note}`)
  }

  sink.close()
  console.log(failures ? `\n⛔ ПРОВАЛ: ${failures} из ${CASES.length}` : `\n✅ дроссель соблюдает полосу на всех ${CASES.length} точках`)
  process.exit(failures ? 1 : 0)
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const cmd = process.argv[2]

if (process.env.NET_CHAOS_DAEMON) { runDaemon() }
else if (cmd === 'selftest') { await selfTest() }
else if (cmd === 'start') {
  if (daemonAlive()) { console.log('уже работает (pid ' + daemonAlive() + ')'); process.exit(0) }
  const s = writeState({
    listen: parseInt(arg('listen', DEFAULTS.listen), 10),
    target: arg('target', DEFAULTS.target),
    kbps: parseInt(arg('kbps', 0), 10),
    mode: 'pass',
  })
  // Пречек цели. Дроссель с недостижимой целью ведёт себя как исправный (соединения принимает,
  // байты глотает) — так 2026-07-29 опечатка в порту стоила прогона. Проверяем ДО запуска.
  const [pfHost, pfPort] = String(s.target).split(':')
  const reachable = await new Promise((res) => {
    const probe = net.connect(parseInt(pfPort, 10), pfHost)
    const done = (ok) => { probe.destroy(); res(ok) }
    probe.once('connect', () => done(true))
    probe.once('error', () => done(false))
    setTimeout(() => done(false), 1500)
  })
  if (!reachable) {
    console.error(`⛔ цель ${s.target} НЕ отвечает — дроссель бы принимал байты и выбрасывал их в никуда.`)
    console.error(`   Подними приёмник (node tools/rtmp-server.mjs start) или укажи верный --target.`)
    process.exit(1)
  }

  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true, stdio: 'ignore', env: { ...process.env, NET_CHAOS_DAEMON: '1' },
  })
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))
  console.log(`✓ дроссель запущен (pid ${child.pid}) :${s.listen} → ${s.target} (цель отвечает)`)
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
  selftest                ГАРД: независимый приёмник доказывает, что полоса реально соблюдается
                          (точки 0 / 2000 / 300 кбит/с; 300 — рабочая полоса сценария K1)

Публиковать эфир НА ПОРТ ДРОССЕЛЯ: rtmp://<ip-мака>:1936/live/test`)
}
