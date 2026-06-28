#!/usr/bin/env node
/**
 * adb.mjs — AI agent vision and interaction tool for the debug device.
 *
 * Usage:
 *   node tools/adb.mjs screen [output.png]     — capture screenshot (reads image → AI can see screen)
 *   node tools/adb.mjs tap <x> <y>             — tap at device coordinates
 *   node tools/adb.mjs swipe <x1> <y1> <x2> <y2> [ms]
 *   node tools/adb.mjs key <keycode>            — send key event (HOME=3, BACK=4, ENTER=66, ...)
 *   node tools/adb.mjs text <string>            — type text
 *   node tools/adb.mjs logcat [tag] [lines]     — dump recent logcat (default: 80 lines, all tags)
 *   node tools/adb.mjs install [apk]            — install debug APK (default: app/build/outputs/apk/debug/app-debug.apk)
 *   node tools/adb.mjs start [activity]         — start MainActivity
 *   node tools/adb.mjs stop                     — force-stop the app
 *   node tools/adb.mjs devices                  — list connected ADB devices
 *
 * All paths relative to project root. Screenshot saves to tools/adb_screen.png by default.
 */

import { execSync, spawnSync } from 'child_process'
import { mkdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const APP_ID = 'com.kriniks.kcam.debug'
const MAIN_ACTIVITY = `${APP_ID}/com.kriniks.kcam.MainActivity`
const DEFAULT_APK = resolve(ROOT, 'app/build/outputs/apk/debug/app-debug.apk')
// Gitignored folder for transient screenshots — no manual cleanup needed (see .gitignore).
const SCREEN_OUT = resolve(ROOT, 'tools/screenshots/adb_screen.jpg')
// Screenshots are compressed to JPEG at this quality (full resolution kept) so the image is
// light for AI vision analysis. Compression via the `sharp` library (see tools/package.json).
const SCREENSHOT_JPEG_QUALITY = 80

function run(cmd, { silent = false } = {}) {
  try {
    const result = execSync(cmd, { encoding: 'utf8' })
    if (!silent) process.stdout.write(result)
    return result.trim()
  } catch (e) {
    console.error(`✗ ${cmd}\n${e.stderr || e.message}`)
    process.exit(1)
  }
}

const [,, command, ...rest] = process.argv

switch (command) {
  case 'screen': {
    const out = rest[0] ? resolve(ROOT, rest[0]) : SCREEN_OUT
    mkdirSync(dirname(out), { recursive: true })
    const result = spawnSync('adb', ['exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 })
    if (result.status !== 0) { console.error('✗ screencap failed'); process.exit(1) }
    // Compress PNG → JPEG (full resolution, quality 80) so the image is light for AI vision.
    const sharp = (await import('sharp')).default
    const info = await sharp(result.stdout).jpeg({ quality: SCREENSHOT_JPEG_QUALITY }).toFile(out)
    const size = (statSync(out).size / 1024).toFixed(0)
    console.log(`✓ screenshot saved → ${out} (${info.width}x${info.height}, JPEG q${SCREENSHOT_JPEG_QUALITY}, ${size} KB)`)
    break
  }

  case 'tap': {
    const [x, y] = rest
    if (!x || !y) { console.error('Usage: tap <x> <y>'); process.exit(1) }
    run(`adb shell input tap ${x} ${y}`, { silent: true })
    console.log(`✓ tap (${x}, ${y})`)
    break
  }

  case 'swipe': {
    const [x1, y1, x2, y2, ms = '300'] = rest
    run(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, { silent: true })
    console.log(`✓ swipe (${x1},${y1}) → (${x2},${y2}) ${ms}ms`)
    break
  }

  case 'key': {
    run(`adb shell input keyevent ${rest[0]}`, { silent: true })
    console.log(`✓ key ${rest[0]}`)
    break
  }

  case 'text': {
    const escaped = rest.join(' ').replace(/\s+/g, '%s').replace(/['"]/g, '')
    run(`adb shell input text "${escaped}"`, { silent: true })
    console.log(`✓ typed text`)
    break
  }

  case 'logcat': {
    const tag = rest[0] && !rest[0].match(/^\d+$/) ? rest[0] : ''
    const lines = parseInt(rest.find(r => r.match(/^\d+$/)) ?? '80')
    const filter = tag ? `-s ${tag}` : '*:W'
    const out = run(`adb logcat -d ${filter} 2>&1 | tail -${lines}`)
    console.log(out)
    break
  }

  case 'install': {
    const apk = rest[0] ? resolve(ROOT, rest[0]) : DEFAULT_APK
    run(`adb install -r "${apk}"`)
    console.log(`✓ installed ${apk}`)
    break
  }

  case 'start': {
    const activity = rest[0] ?? MAIN_ACTIVITY
    run(`adb shell am start -n ${activity}`, { silent: true })
    console.log(`✓ started ${activity}`)
    break
  }

  case 'stop': {
    run(`adb shell am force-stop ${APP_ID}`, { silent: true })
    console.log(`✓ force-stopped ${APP_ID}`)
    break
  }

  case 'devices': {
    run('adb devices -l')
    break
  }

  default: {
    console.log(`
adb.mjs — AI agent ADB vision + interaction tool

  screen [out.png]                  capture screenshot
  tap <x> <y>                       tap at coordinates
  swipe <x1> <y1> <x2> <y2> [ms]   swipe gesture
  key <keycode>                     key event (3=HOME 4=BACK 66=ENTER)
  text <string>                     type text
  logcat [tag] [lines]              dump recent logs
  install [apk]                     install APK
  start [activity]                  start app
  stop                              force-stop app
  devices                           list ADB devices
`)
  }
}
