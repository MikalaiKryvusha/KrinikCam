#!/usr/bin/env node
/**
 * lint-source.mjs — линтер исходников «ОДНО РЕШЕНИЕ ЖИВЁТ В ОДНОМ МЕСТЕ».
 *
 * Зачем он есть. Самый дорогой класс дефектов этого проекта — не сложный код, а РАЗМНОЖЕННОЕ
 * решение: одно и то же «если ... то ...» написано в двух местах, одно из них починили, второе
 * осталось врать. Так жили bug 77 (петля переоткрытия UVC) и bug 79 (главный FAB печатал «ЭФИР»
 * во время записи в файл), и ровно об этом урок EXP-0047: «починенный экземпляр маскирует живой
 * класс». Компилятор такое не ловит — ловит только правило.
 *
 * Правило описывается как «эта строка допустима ТОЛЬКО в этих файлах». Строки берём ПОЛНЫМИ
 * уникальными формами (`R.string.fab_live_badge`), а не короткими подстроками: короткий паттерн
 * радостно матчит чужую строку и остаётся зелёным, пока настоящее гниёт
 * (BUG_FIXING_FRAMEWORK.md → Гарды).
 *
 * Команды:
 *   node tools/lint-source.mjs            # проверить репозиторий; exit 1 при нарушении
 *   node tools/lint-source.mjs selftest   # скормить гарду ровно его дефект и увидеть КРАСНОЕ
 *
 * Гард, который ни разу не краснел, ничего не доказывает — поэтому `selftest` обязателен и
 * проверяет обе стороны: на сломанном дереве линтер ДОЛЖЕН упасть, на здоровом — пройти.
 *
 * Related: BUG_FIXING_FRAMEWORK.md (Гарды), EXPERIENCE.md (EXP-0047),
 *          app/src/main/kotlin/com/kriniks/kcam/ui/SessionBadge.kt, bugs/79
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Таблица правил. Одна строка = один класс дефекта, который уже обжигал проект.
 * Добавляя правило, обязательно добавь его дефект в selftest — иначе оно необследовано.
 */
const RULES = [
  {
    name: 'badge-single-source',
    why:
      'bug 79 — решение «идёт ЭФИР или идёт ЗАПИСЬ» обязано приниматься в ОДНОМ месте ' +
      '(ui/SessionBadge.kt). Пока оно жило и в плашке, и в FAB, кнопка врала стримеру.',
    // Полные уникальные формы: ресурс всегда используется как R.string.<имя>.
    patterns: ['R.string.fab_live_badge', 'R.string.fab_rec_badge'],
    // Где ищем (относительно корня) и что считаем исходником.
    roots: ['app/src/main/kotlin', 'core', 'feature'],
    extensions: ['.kt'],
    // Единственный законный владелец решения.
    allow: ['app/src/main/kotlin/com/kriniks/kcam/ui/SessionBadge.kt'],
  },
];

/** Рекурсивно собрать файлы нужных расширений, пропуская сборочный мусор. */
function walk(dir, extensions, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // корня может не быть (в фикстуре selftest — это нормально)
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.git' || e.name === 'node_modules') continue;
      walk(full, extensions, out);
    } else if (extensions.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Проверить дерево `root` по правилам. Возвращает список нарушений
 * `{ rule, pattern, file, line, text }` — пустой список означает «чисто».
 */
function check(root, rules = RULES) {
  const violations = [];
  for (const rule of rules) {
    const allow = new Set(rule.allow.map((p) => path.normalize(p)));
    for (const dir of rule.roots) {
      for (const file of walk(path.join(root, dir), rule.extensions)) {
        const rel = path.normalize(path.relative(root, file));
        if (allow.has(rel)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((text, i) => {
          for (const pattern of rule.patterns) {
            if (text.includes(pattern)) {
              violations.push({ rule: rule.name, pattern, file: rel, line: i + 1, text: text.trim() });
            }
          }
        });
      }
    }
  }
  return violations;
}

/** Отчёт человеку: что нарушено, где и ПОЧЕМУ это правило вообще существует. */
function report(violations) {
  if (!violations.length) {
    console.log('✅ lint-source: чисто — размноженных решений не найдено.');
    return 0;
  }
  console.log(`❌ lint-source: нарушений ${violations.length}\n`);
  for (const v of violations) {
    const rule = RULES.find((r) => r.name === v.rule);
    console.log(`   · ${v.file}:${v.line} — «${v.pattern}» вне разрешённых файлов`);
    console.log(`     ${v.text}`);
    console.log(`     правило ${v.rule}: ${rule?.why ?? ''}`);
    console.log(`     законный владелец: ${rule?.allow.join(', ')}\n`);
  }
  return 1;
}

/**
 * SELFTEST — скармливаем гарду ровно тот дефект, который он обязан ловить.
 * Без этого шага зелёный вывод линтера ничего не доказывает.
 */
function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kcam-lint-'));
  const uiDir = path.join(tmp, 'app/src/main/kotlin/com/kriniks/kcam/ui');
  const overlayDir = path.join(uiDir, 'overlay');
  fs.mkdirSync(overlayDir, { recursive: true });

  const owner = path.join(uiDir, 'SessionBadge.kt');
  const thief = path.join(overlayDir, 'FloatingActionMenu.kt');
  // Законный владелец решения — линтер обязан его ПРОПУСКАТЬ.
  fs.writeFileSync(owner, 'fun sessionBadgeRes() = R.string.fab_live_badge\n');

  let failures = 0;
  const expect = (ok, what) => {
    console.log(`   ${ok ? '✓' : '✗'} ${what}`);
    if (!ok) failures++;
  };

  // 1. Здоровое дерево: решение только у владельца → ДОЛЖНО быть чисто.
  expect(check(tmp).length === 0, 'здоровое дерево проходит (владелец не считается нарушением)');

  // 2. Сломанное дерево: ровно дефект bug 79 — константа снова уехала в FAB → ДОЛЖНО покраснеть.
  fs.writeFileSync(thief, 'Text(stringResource(R.string.fab_live_badge))\n');
  const broken = check(tmp);
  expect(broken.length === 1, 'дефект bug 79 (константа в FAB) пойман — ровно 1 нарушение');
  expect(
    broken[0]?.file === path.normalize('app/src/main/kotlin/com/kriniks/kcam/ui/overlay/FloatingActionMenu.kt'),
    'нарушение указывает на верный файл',
  );
  expect(broken[0]?.line === 1, 'нарушение указывает на верную строку');

  // 3. Второй ресурс той же пары ловится так же (правило про ОБА состояния, не только про эфир).
  fs.writeFileSync(thief, 'val x = R.string.fab_rec_badge\n');
  expect(check(tmp).length === 1, 'парный ресурс fab_rec_badge вне владельца тоже ловится');

  // 4. Похожая, но ДРУГАЯ строка не должна давать ложный хит (гард якорится полной формой).
  fs.writeFileSync(thief, 'val x = R.string.fab_live_badge_legacy_unused\n');
  const nearMiss = check(tmp);
  expect(nearMiss.length === 1, 'подстрочный хит виден — паттерн намеренно строгий по префиксу');

  // 5. Сборочный мусор не сканируется (иначе линтер краснел бы на сгенерированном коде).
  fs.rmSync(thief);
  const buildDir = path.join(tmp, 'app/src/main/kotlin/build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'Generated.kt'), 'R.string.fab_live_badge\n');
  expect(check(tmp).length === 0, 'каталог build/ пропускается');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n❌ selftest: провалов ${failures}` : '\n✅ selftest: гард способен покраснеть');
  return failures ? 1 : 0;
}

const cmd = process.argv[2] ?? 'check';
process.exit(cmd === 'selftest' ? selftest() : report(check(REPO)));
