#!/usr/bin/env node
// tools/kaif.mjs — ручки жизненного цикла KAIF в KrinikCam (npm run kaif:* / node tools/kaif.mjs ...).
//   version | check — реализованы полностью.
//   update | fork | switch-origin | remove | remove-all — печатают уважительную процедуру и передают
//   проектно-специфичные шаги соответствующему навыку /kaif-* (навык выполняет их безопасно, в контексте).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = (process.argv[2] || 'version').toLowerCase();

// Безопасное чтение JSON: null вместо исключения (маркер может отсутствовать).
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const marker = () => readJson(join(ROOT, '.kaif', 'kaif.json'));

// Подсказка: операция выполняется агентским навыком, не скриптом.
function guide(skill, what) {
  console.log(`KAIF lifecycle — ${what}.`);
  console.log('Это проектно-специфичная уважительная операция. Запускай её через агентский навык:');
  console.log(`   /${skill}`);
  console.log('Навык выполнит шаги по порядку, сохранив проект и его контент-артефакты.');
  console.log(`(См. .claude/skills/${skill}/SKILL.md или соответствующий раздел KAIF.md в origin.)`);
}

// Валидатор развёрнутого KAIF: ключевые доки, директории знаний с README, навыки, маркер.
function check() {
  const problems = [];
  const mustExist = [
    // ключевые документы (корень)
    'AGENT_GUIDE.md', 'PHILOSOPHY.md', 'BUG_FIXING_FRAMEWORK.md', 'GOAL.md', 'STATUS.md',
    'MASTER_PLAN.md', 'PROJECT_STRUCTURE_EXTERNAL_MAP.md', 'PROJECT_ARCHITECTURE_INTERNAL_MAP.md',
    'KAIF_FRAMEWORK.md', 'CLAUDE.md', 'AGENTS.md',
    // директории знаний + их README
    ...['plans', 'ideas', 'bugs', 'researches', 'interviews', 'homeworks']
      .flatMap((d) => [d, `${d}/README.md`]),
    // маркер и навыки
    '.kaif/kaif.json',
    ...[
      'resume', 'pause', 'autoloop', 'dayloop', 'nightloop', 'refresh-context', 'check-backlog',
      'report-bug', 'bug-research', 'propose-idea', 'interview', 'revision', 'help-kaif', 'release',
      'kaif-version', 'kaif-update', 'kaif-fork', 'kaif-switch-origin', 'kaif-remove',
    ].map((s) => `.claude/skills/${s}/SKILL.md`),
  ];
  for (const rel of mustExist) if (!existsSync(join(ROOT, rel))) problems.push(`missing: ${rel}`);

  const m = marker();
  if (m) {
    for (const f of ['framework', 'version', 'released', 'origin', 'tracking', 'sphere', 'agent'])
      if (!m[f]) problems.push(`.kaif/kaif.json: field "${f}" is empty/missing`);
  }

  if (problems.length) {
    console.log(`❌ KAIF check: ${problems.length} problem(s)`);
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log(`✅ KAIF check: структура развёрнутого фреймворка в порядке (KAIF ${m?.version ?? '?'}).`);
}

switch (cmd) {
  case 'version': {
    const m = marker();
    if (m) {
      console.log(`KAIF ${m.version} (${m.released}) · tracking=${m.tracking} · origin=${m.origin}` +
        (m.sphere ? ` · sphere=${m.sphere}` : '') + (m.agent ? ` · agent=${m.agent}` : ''));
    } else {
      console.log('KAIF version unknown — нет маркера .kaif/kaif.json (KAIF не развёрнут или маркер потерян).');
    }
    console.log('Проверить origin на новый релиз — навык /kaif-version, или:');
    console.log('  gh release view --repo MikalaiKryvusha/KAIF --json tagName,publishedAt');
    break;
  }
  case 'check': check(); break;
  case 'update': guide('kaif-update', 'уважительное миграционное обновление из origin'); break;
  case 'fork': guide('kaif-fork', 'слепок KAIF в собственный репозиторий и tracking на него'); break;
  case 'switch-origin': guide('kaif-switch-origin', 'вернуть tracking на официальный origin'); break;
  case 'remove': guide('kaif-remove', 'уважительное удаление (частичное — контент-артефакты остаются)'); break;
  case 'remove-all': guide('kaif-remove', 'полное уважительное удаление (ядро + артефакты; проект цел)'); break;
  default:
    console.log('usage: node tools/kaif.mjs <version|check|update|fork|switch-origin|remove|remove-all>');
}
