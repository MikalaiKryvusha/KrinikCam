#!/usr/bin/env node
/**
 * env.mjs — the ONE place that prepares the toolchain environment for every KrinikCam tool.
 *
 * Why this file exists (2026-10-17, development moved to a Windows machine):
 * the build/test tools each carried their own copy of "where is Java" — a hard-coded macOS path to
 * Android Studio's JBR in smoke.mjs and avd.mjs, an `if (!JAVA_HOME)` guess in build.mjs, nothing at
 * all in release.mjs — and every `adb` call took whatever `adb` came first on PATH. On the Windows
 * machine all three broke at once: the user-level JAVA_HOME points at a DELETED JDK (it is set, so
 * the old "only if unset" check kept it), no macOS path exists, and the first `adb` on PATH is an
 * ancient 1.0.32 in C:\adb that fights the SDK's adb server for port 5037. Copies of one decision
 * drift apart; this module is the single decision, imported for its side effect.
 *
 * What it does, once, at import (mutates process.env so every child process inherits it):
 *   1. JAVA_HOME → the first candidate whose bin/java exists. JDK 17 is preferred because the
 *      project compiles with `jvmToolchain(17)` and the JVM that launches Gradle is always a
 *      toolchain candidate — so a JDK 17 launcher needs no toolchain discovery at all (EXP-0020).
 *      Explicit override: KCAM_JAVA_HOME.
 *   2. ANDROID_HOME → an existing SDK (env first, then the known machine locations).
 *   3. PATH → <sdk>/platform-tools first, so a bare `adb` is the SDK's adb.
 *
 * Usage:
 *   import './env.mjs'              — side effect only (build.mjs, release.mjs, smoke.mjs, device.mjs…)
 *   node tools/env.mjs              — print what was chosen and why (diagnostics)
 *
 * [NOT-TESTED] — written 2026-10-17; flips to [TESTED] after a real Gradle build on the Windows
 * machine launched through build.mjs.
 */

import { existsSync, readdirSync } from 'fs'
import { join, delimiter } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const IS_WIN = process.platform === 'win32'
const JAVA_BIN = IS_WIN ? 'java.exe' : 'java'
// Snapshot BEFORE this module mutates process.env — the diagnostics must show what the operator had.
const ORIGINAL = { JAVA_HOME: process.env.JAVA_HOME, ANDROID_HOME: process.env.ANDROID_HOME, ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT }

/** A JDK home is usable only if its java binary is really there (a set-but-dead JAVA_HOME is the trap). */
const isJdk = (home) => !!home && existsSync(join(home, 'bin', JAVA_BIN))

/** macOS keeps JDKs as <name>/Contents/Home under ~/Library/Java/JavaVirtualMachines (EXP-0020). */
function macJdk17Homes() {
  const root = join(homedir(), 'Library', 'Java', 'JavaVirtualMachines')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((d) => /(^|[^0-9])17([^0-9]|$)/.test(d))
    .sort()                                      // deterministic pick when several 17s are installed
    .map((d) => join(root, d, 'Contents', 'Home'))
}

/** Ordered candidates: explicit override → JDK 17 → the operator's JAVA_HOME → bundled/system JDKs. */
function javaCandidates() {
  return [
    ['KCAM_JAVA_HOME (explicit override)', process.env.KCAM_JAVA_HOME],
    ['JDK 17 at C:\\Android\\jdk-17 (Windows machine resource)', IS_WIN ? 'C:\\Android\\jdk-17' : null],
    ...macJdk17Homes().map((h) => ['JDK 17 in ~/Library/Java/JavaVirtualMachines', h]),
    ['JAVA_HOME from the environment', ORIGINAL.JAVA_HOME],
    ['Android Studio JBR (macOS)', '/Applications/Android Studio.app/Contents/jbr/Contents/Home'],
    ['Android Studio JBR (Windows)', IS_WIN ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : null],
    ['Microsoft JDK 21 (Windows)', IS_WIN ? 'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot' : null],
  ]
}

/** Ordered SDK candidates: the environment first, then where this project's machines keep it. */
function sdkCandidates() {
  return [
    ['ANDROID_HOME', ORIGINAL.ANDROID_HOME],
    ['ANDROID_SDK_ROOT', ORIGINAL.ANDROID_SDK_ROOT],
    ['C:\\Android\\Sdk (Windows machine resource)', IS_WIN ? 'C:\\Android\\Sdk' : null],
    ['%LOCALAPPDATA%\\Android\\Sdk', IS_WIN && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null],
    ['~/Library/Android/sdk (macOS)', join(homedir(), 'Library', 'Android', 'sdk')],
  ]
}

const pick = (cands, ok) => cands.find(([, p]) => p && ok(p)) || null

export const chosenJava = pick(javaCandidates(), isJdk)
export const chosenSdk = pick(sdkCandidates(), (p) => existsSync(join(p, 'platform-tools')))

if (chosenJava) process.env.JAVA_HOME = chosenJava[1]
if (chosenSdk) {
  process.env.ANDROID_HOME = chosenSdk[1]
  const pt = join(chosenSdk[1], 'platform-tools')
  const parts = (process.env.PATH || '').split(delimiter).filter((p) => p && p !== pt)
  process.env.PATH = [pt, ...parts].join(delimiter)
}

// Diagnostics when run directly: say what was chosen AND what was rejected, so a wrong pick is visible.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Java candidates:')
  for (const [why, p] of javaCandidates()) if (p) console.log(`  ${isJdk(p) ? 'ok  ' : 'dead'} ${p}  — ${why}`)
  console.log(`→ JAVA_HOME    = ${chosenJava ? chosenJava[1] : '(none found — install JDK 17)'}`)
  console.log(`→ ANDROID_HOME = ${chosenSdk ? chosenSdk[1] : '(none found)'}`)
  console.log(`→ adb          = ${chosenSdk ? join(chosenSdk[1], 'platform-tools', IS_WIN ? 'adb.exe' : 'adb') : '(PATH default)'}`)
  if (!chosenJava) process.exit(1)
}
