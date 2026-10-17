/**
 * build-ui.mjs — Browser-based build progress UI.
 *
 * Starts a local HTTP server, opens a browser tab, and streams
 * Gradle build output via Server-Sent Events (SSE) to a live
 * progress bar + log view styled in KrinikCam brand colours.
 *
 * Called automatically by build.mjs unless --no-ui is passed.
 * Server shuts down 30s after success, 2 min after failure.
 *
 * Related: build.mjs (entry point), version.mjs (version info)
 */

import { createServer }  from 'http'
import { spawn, exec }   from 'child_process'
import { existsSync }    from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')

// ─── HTML page ────────────────────────────────────────────────────────────────
// Full UI embedded as a string — no external dependencies needed in the browser.

const buildHtml = (flavor, vStr) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KrinikCam — Building ${flavor}</title>
  <style>
    :root {
      --pink:    #FF1A8C;
      --pink-dk: #CC0070;
      --bg:      #0d0d0d;
      --surf:    #1a1a1a;
      --surf2:   #232323;
      --txt:     #f0f0f0;
      --dim:     #777;
      --ok:      #4caf50;
      --err:     #ef5350;
      --warn:    #ff9800;
      --r:       10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--txt);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      padding: 28px 24px 40px;
      min-height: 100vh;
    }

    /* ── Header ── */
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 26px;
    }
    .logo {
      font-size: 26px;
      font-weight: 900;
      color: var(--pink);
      letter-spacing: -0.5px;
      line-height: 1;
    }
    .logo em { color: var(--txt); font-style: normal; }
    .badge {
      background: var(--surf);
      color: var(--dim);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      padding: 3px 9px;
      border-radius: 20px;
      text-transform: uppercase;
    }
    .badge.pink { background: rgba(255,26,140,0.15); color: var(--pink); }

    /* ── Progress card ── */
    .card {
      background: var(--surf);
      border-radius: var(--r);
      padding: 20px;
      margin-bottom: 14px;
    }

    .progress-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 14px;
      gap: 12px;
    }
    #statusText {
      font-size: 13px;
      font-family: 'SF Mono', 'Menlo', monospace;
      color: var(--dim);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #timer {
      font-size: 13px;
      font-family: 'SF Mono', 'Menlo', monospace;
      color: var(--pink);
      font-weight: 700;
      white-space: nowrap;
    }

    /* Progress bar track */
    .track {
      height: 10px;
      border-radius: 100px;
      background: #2c2c2c;
      overflow: hidden;
      position: relative;
    }
    #bar {
      height: 100%;
      border-radius: 100px;
      width: 0%;
      transition: width 0.9s cubic-bezier(0.4,0,0.2,1);
      background: linear-gradient(90deg, var(--pink), var(--pink-dk));
      position: relative;
      overflow: hidden;
    }
    /* Shimmer overlay — visible while build is running */
    #bar.running::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255,255,255,0.25) 50%,
        transparent 100%
      );
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer {
      from { transform: translateX(-100%); }
      to   { transform: translateX(200%); }
    }
    #bar.ok   { background: linear-gradient(90deg, #43a047, #2e7d32); }
    #bar.fail { background: linear-gradient(90deg, var(--err), #b71c1c); }

    /* ── Task counter ── */
    #taskCount {
      margin-top: 10px;
      font-size: 12px;
      color: var(--dim);
      text-align: right;
    }

    /* ── Result banner ── */
    #result {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 14px 20px;
      border-radius: var(--r);
      margin-bottom: 14px;
      font-weight: 700;
      font-size: 15px;
    }
    #result.ok   { display: flex; background: rgba(76,175,80,.12); border: 1px solid rgba(76,175,80,.3); color: var(--ok); }
    #result.fail { display: flex; background: rgba(239,83,80,.12); border: 1px solid rgba(239,83,80,.3); color: var(--err); }

    /* ── Log ── */
    .log-card {
      background: var(--surf);
      border-radius: var(--r);
      overflow: hidden;
    }
    .log-head {
      padding: 10px 16px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--dim);
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      justify-content: space-between;
    }
    #log {
      font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
      font-size: 11.5px;
      line-height: 1.65;
      padding: 12px 16px;
      height: 340px;
      overflow-y: auto;
      color: #aaa;
      scroll-behavior: smooth;
    }
    #log .t  { color: var(--pink); }    /* task line */
    #log .ok { color: var(--ok);   }    /* BUILD SUCCESSFUL */
    #log .er { color: var(--err);  }    /* error */
    #log .w  { color: var(--warn); }    /* warning */
    #log .d  { color: #444;        }    /* dim/noise */
  </style>
</head>
<body>

  <header>
    <div class="logo">Krinik<em>Cam</em></div>
    <div class="badge pink">${flavor}</div>
    <div class="badge">${vStr}</div>
  </header>

  <div id="result"></div>

  <div class="card">
    <div class="progress-meta">
      <div id="statusText">Initialising Gradle…</div>
      <div id="timer">0s</div>
    </div>
    <div class="track"><div id="bar" class="running"></div></div>
    <div id="taskCount"></div>
  </div>

  <div class="log-card">
    <div class="log-head">
      <span>Build Output</span>
      <span id="logCount">0 lines</span>
    </div>
    <div id="log"></div>
  </div>

  <script>
    const bar        = document.getElementById('bar')
    const statusText = document.getElementById('statusText')
    const timerEl   = document.getElementById('timer')
    const logEl      = document.getElementById('log')
    const result     = document.getElementById('result')
    const taskCount  = document.getElementById('taskCount')
    const logCount   = document.getElementById('logCount')

    let lineCount  = 0
    let tasksDone  = 0
    const startTime = Date.now()

    // ── Timer ──────────────────────────────────────────────────────────
    const timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000)
      timerEl.textContent = s >= 60 ? Math.floor(s/60) + 'm ' + (s%60) + 's' : s + 's'
    }, 500)

    // ── Estimated progress (asymptotic time-based curve) ──────────────
    // Approaches 95% over ~2 minutes, snaps to 100% on completion.
    const progInt = setInterval(() => {
      const s = (Date.now() - startTime) / 1000
      const pct = 95 * (1 - Math.exp(-s / 80))
      bar.style.width = pct + '%'
    }, 400)

    // ── Log helper ─────────────────────────────────────────────────────
    const MAX_LINES = 300
    function addLine(text) {
      const d = document.createElement('div')
      if      (text.includes('> Task :'))        d.className = 't'
      else if (text.includes('BUILD SUCCESSFUL')) d.className = 'ok'
      else if (/error:/i.test(text))             d.className = 'er'
      else if (/^w:|warning:/i.test(text))       d.className = 'w'
      else if (!text.trim() || text.startsWith('Download'))  d.className = 'd'
      d.textContent = text
      logEl.appendChild(d)
      if (logEl.children.length > MAX_LINES) logEl.removeChild(logEl.firstChild)
      logEl.scrollTop = logEl.scrollHeight
      lineCount++
      logCount.textContent = lineCount + ' lines'
    }

    // ── SSE ────────────────────────────────────────────────────────────
    const es = new EventSource('/events')

    es.addEventListener('task', e => {
      tasksDone++
      statusText.textContent = e.data
      taskCount.textContent = tasksDone + ' tasks'
    })

    es.addEventListener('log', e => {
      addLine(e.data)
    })

    es.addEventListener('done', e => {
      const data = JSON.parse(e.data)
      clearInterval(progInt)
      clearInterval(timerInt)
      bar.classList.remove('running')
      timerEl.textContent = data.duration

      if (data.success) {
        bar.style.width  = '100%'
        bar.classList.add('ok')
        statusText.textContent  = 'Build successful'
        result.className        = 'ok'
        result.textContent      = '✅  BUILD SUCCESSFUL  ·  ' + data.duration + (data.tasks ? '  ·  ' + data.tasks : '')
      } else {
        bar.style.width  = '100%'
        bar.classList.add('fail')
        statusText.textContent  = 'Build failed — check the log below'
        result.className        = 'fail'
        result.textContent      = '❌  BUILD FAILED  ·  ' + data.duration
      }
      es.close()
    })
  </script>
</body>
</html>`

// ─── SSE helpers ─────────────────────────────────────────────────────────────

const clients   = new Set()
const replay    = []          // buffered events for late-joining clients

function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
  replay.push(line)
  for (const res of clients) {
    try { res.write(line) } catch { clients.delete(res) }
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

export function runWithUi({ flavor, vStr, gradlew, root, env }) {
  return new Promise((resolve, reject) => {

    const PORT = 7001
    const html = buildHtml(flavor, vStr)

    const server = createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(200, {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
        })
        res.write(': hi\n\n')
        // Replay all buffered events so late clients see full log
        for (const line of replay) res.write(line)
        clients.add(res)
        req.on('close', () => clients.delete(res))
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      }
    })

    server.listen(PORT, '127.0.0.1', () => {
      const url = `http://localhost:${PORT}`
      console.log(`\n🌐 Build UI → ${url}\n`)
      // Open browser (macOS: open, Linux: xdg-open, Windows: start)
      const openCmd = process.platform === 'darwin' ? `open "${url}"`
                    : process.platform === 'win32'  ? `start "${url}"`
                    : `xdg-open "${url}"`
      exec(openCmd)
    })

    // ─── Gradle process ───────────────────────────────────────────────
    const startMs = Date.now()
    // Windows: a .bat cannot be spawned without a shell (Node ≥18.20 refuses with EINVAL), and the
    // path is absolute + quoted (NoDefaultCurrentDirectoryInExePath) — see build.mjs (2026-10-17).
    const isWin   = process.platform === 'win32'
    const gradle  = spawn(isWin ? `"${gradlew}"` : gradlew, [`assemble${flavor}`, '--no-daemon'], {
      cwd: root, env, shell: isWin,
    })

    let leftover = ''
    function handleChunk(chunk) {
      const text = leftover + chunk.toString()
      const lines = text.split('\n')
      leftover = lines.pop()               // incomplete last line
      for (const line of lines) {
        // Escape HTML so the browser renders it safely
        const safe = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        broadcast('log', safe)
        if (line.startsWith('> Task :')) {
          broadcast('task', line.replace('> Task :', '').trim())
        }
        process.stdout.write(line + '\n')  // also print to terminal
      }
    }

    gradle.stdout.on('data', handleChunk)
    gradle.stderr.on('data', handleChunk)

    gradle.on('close', code => {
      if (leftover) handleChunk(leftover + '\n')

      const elapsed  = Math.round((Date.now() - startMs) / 1000)
      const duration = elapsed >= 60 ? `${Math.floor(elapsed/60)}m ${elapsed%60}s` : `${elapsed}s`
      const success  = code === 0

      // Try to extract "N actionable tasks" summary from buffered log
      const logLines = replay.filter(l => l.startsWith('event: log'))
                              .map(l => l.split('\ndata: ')[1]?.split('\n')[0] ?? '')
      const taskLine = [...logLines].reverse().find(l => /actionable task/.test(l)) ?? ''
      const tasks    = taskLine.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim()

      broadcast('done', { success, duration, tasks })
      console.log(`\n${success ? '✅' : '❌'} Build ${success ? 'SUCCESSFUL' : 'FAILED'} in ${duration}\n`)

      // Keep server alive so user can read the result, then exit
      const delay = success ? 30_000 : 120_000
      setTimeout(() => {
        server.close()
        if (success) resolve() ; else reject(new Error('Build failed'))
      }, delay)
    })
  })
}
