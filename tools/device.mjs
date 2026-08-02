#!/usr/bin/env node
/**
 * device.mjs — the single place that answers "which device does the harness talk to?"
 *
 * Why this file exists (KrinikCam device park grew to two devices on 2026-08-02):
 * ui.mjs and smoke.mjs each used to resolve the target as "ADB_DEVICE env, or the FIRST connected
 * device". With one device that is correct. With a park (Headwolf Titan 1 = the ceiling, Samsung
 * Galaxy A51 = the floor / our minSdk) it becomes a silent wrong-target bug: adb's ordering decides
 * where the APK is installed and which hardware the numbers came from, and nothing in the output
 * says which device was actually used. A run that measures the wrong device is worse than a run that
 * fails, because it is believed.
 *
 * The rule implemented here: explicit beats implicit, and ambiguity is an ERROR, never a guess.
 *   · ADB_DEVICE set        → use it verbatim (the operator has spoken)
 *   · exactly one connected → use it (no ambiguity to resolve)
 *   · several connected     → STOP and print how to choose (never pick one silently)
 *   · none connected        → null (callers already handle "no device" their own way)
 *
 * Usage:
 *   import { resolveDevice, adbArgs } from './device.mjs'
 *   node tools/device.mjs list        — print the park as the harness sees it
 *   node tools/device.mjs selftest    — prove the guard can go RED (see the note on chooseDevice)
 */

import { execSync } from 'child_process';

/**
 * Parse `adb devices -l` into structured rows. [TESTED: 2026-08-02 · `node tools/device.mjs list`
 * on the live A51 printed serial/state/model matching `adb devices -l`]
 *
 * Only `state === 'device'` rows are usable; `unauthorized` / `offline` rows are returned too so
 * callers can EXPLAIN a missing device instead of just saying "not found" (an unauthorized device
 * is a very different problem from an absent one — it cost a session's start on 2026-08-02).
 */
export function listDevices() {
  let out;
  try {
    out = execSync('adb devices -l', { encoding: 'utf8' });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .slice(1)                                    // drop the "List of devices attached" header
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('*'))      // '*' lines are adb daemon chatter
    .map((line) => {
      const [serial, ...rest] = line.split(/\s+/);
      const state = rest[0] || 'unknown';
      // `model:SM_A515F` in the -l tail; purely cosmetic, used to make messages human-readable.
      const model = (line.match(/\bmodel:(\S+)/) || [])[1] || '';
      return { serial, state, model };
    })
    .filter((d) => d.serial);
}

/**
 * The decision itself, kept PURE so it can be tested without a device park.
 *
 * Separating this from listDevices() is the whole point of the design: the dangerous case
 * (several devices connected) is exactly the case that is hard to stage on demand, so the guard
 * would otherwise be a check that has never failed — and per BUG_FIXING_FRAMEWORK a guard that has
 * never gone red proves nothing. Here `selftest` feeds it that case directly.
 *
 * Returns { serial } on success, or { error } describing why no single target could be chosen.
 * [TESTED: 2026-08-02 · `node tools/device.mjs selftest` — 6/6, including the ambiguous-park case]
 */
export function chooseDevice(devices, env = {}) {
  if (env.ADB_DEVICE) return { serial: env.ADB_DEVICE };

  const ready = devices.filter((d) => d.state === 'device');
  if (ready.length === 1) return { serial: ready[0].serial };

  if (ready.length > 1) {
    const rows = ready.map((d) => `     ADB_DEVICE=${d.serial}${d.model ? `   # ${d.model}` : ''}`);
    return {
      error:
        `подключено устройств: ${ready.length} — какое из них имелось в виду, неизвестно.\n` +
        `   Молча взять первое = прогнать тест не на том железе и поверить числам.\n` +
        `   Назови устройство явно:\n${rows.join('\n')}`,
    };
  }

  // Nothing ready. If something IS attached but not usable, say WHAT is wrong — the fix differs.
  const stuck = devices.filter((d) => d.state !== 'device');
  if (stuck.length) {
    const rows = stuck.map((d) => `     ${d.serial} → ${d.state}`);
    return {
      error:
        `нет готовых устройств, но подключены нерабочие:\n${rows.join('\n')}\n` +
        `   'unauthorized' = на устройстве не подтверждена отладка (разблокируй экран, режим USB\n` +
        `   «Передача файлов», при нужде «Отозвать разрешения для отладки по USB» и передёрнуть кабель).`,
    };
  }
  return { error: null };   // genuinely nothing attached — callers decide if that is fatal
}

/**
 * Harness-facing wrapper: resolve the target or die loudly.
 * `required: false` keeps the old contract (null when no device at all) for callers that cope.
 * Ambiguity, however, is ALWAYS fatal — that is the defect this module exists to prevent.
 * [TESTED: 2026-08-02 · used live by ui.mjs/smoke.mjs on the A51, smoke → PASS]
 */
export function resolveDevice({ required = false } = {}) {
  const { serial, error } = chooseDevice(listDevices(), process.env);
  if (serial) return serial;
  if (error) {
    console.error(`\n❌ ADB: ${error}\n`);
    process.exit(1);
  }
  if (required) {
    console.error('\n❌ ADB: не подключено ни одного устройства (adb devices).\n');
    process.exit(1);
  }
  return null;
}

/** `['-s', serial]` or `[]` — the flag every adb call should carry. */
export function adbArgs(serial) {
  return serial ? ['-s', serial] : [];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * selftest — each case feeds the guard the exact defect it must catch.
 * [TESTED: 2026-08-02 · 6/6 passed; verified it goes RED by temporarily returning the first device
 * on the ambiguous case, which made case 3 fail as expected]
 */
function selftest() {
  const A = { serial: 'AAA', state: 'device', model: 'Titan_1' };
  const B = { serial: 'BBB', state: 'device', model: 'SM_A515F' };
  const U = { serial: 'CCC', state: 'unauthorized', model: '' };

  const cases = [
    ['одно устройство → берём его',        chooseDevice([A], {}),            (r) => r.serial === 'AAA'],
    ['ADB_DEVICE перекрывает всё',         chooseDevice([A, B], { ADB_DEVICE: 'ZZZ' }), (r) => r.serial === 'ZZZ'],
    ['ДВА устройства → отказ, не догадка', chooseDevice([A, B], {}),         (r) => !r.serial && /подключено устройств: 2/.test(r.error)],
    ['в отказе названы оба серийника',     chooseDevice([A, B], {}),         (r) => /AAA/.test(r.error) && /BBB/.test(r.error)],
    ['только unauthorized → объясняем',    chooseDevice([U], {}),            (r) => !r.serial && /unauthorized/.test(r.error)],
    ['пусто → не ошибка, а null',          chooseDevice([], {}),             (r) => !r.serial && r.error === null],
  ];

  let bad = 0;
  for (const [name, result, ok] of cases) {
    const pass = ok(result);
    if (!pass) bad++;
    console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  }
  console.log(bad ? `\n❌ selftest: ${bad} провал(ов)` : `\n✅ selftest: ${cases.length}/${cases.length}`);
  process.exit(bad ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === 'selftest') selftest();
else if (cmd === 'list') {
  const devices = listDevices();
  if (!devices.length) console.log('нет подключённых устройств');
  for (const d of devices) console.log(`  ${d.serial}\t${d.state}\t${d.model}`);
  const { serial, error } = chooseDevice(devices, process.env);
  console.log(serial ? `\n→ харнес возьмёт: ${serial}` : `\n→ харнес НЕ выберет сам: ${error || 'устройств нет'}`);
}
