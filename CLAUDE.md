# KrinikCam — контекст для Claude Code

Проект обвязан фреймворком **KAIF 1.5 — Tested KAIF** (см. `KAIF_FRAMEWORK.md`). Канон здесь НЕ
дублируется — читай первоисточники:

1. **`AGENT_GUIDE.md`** — КАНОН: правила, имена, команды, соглашения (+контекст-роутер: какой срез
   доков читать под тип задачи). Читать перед каждой задачей.
2. **`STATUS.md`** — живое состояние: что сделано, где мы, что дальше.
3. **`PHILOSOPHY.md`** — главный принцип: ПРОСТОТА (KISS + Оккам). Затык = не понял задачу → упрости.
4. **`BUG_FIXING_FRAMEWORK.md`** — как чинить дефекты (цикл фикс→сборка→тест, правило 3 попыток,
   intent gate + twin check).
5. **`TESTING_FRAMEWORK.md`** — канон тестирования (7 принципов + маркеры `[NOT-TESTED]`/`[TESTED: …]`
   на всём, что генерирует агент; ложный `[TESTED]` = фрод, который ловит `/fable-judge`).
6. **`EXPERIENCE.md`** — журнал уроков агента: вспомни (grep по тегу) до задачи, зафиксируй урок после
   значимого успеха/провала (навык `/experience`).
7. Карты: `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (где что лежит) и
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (как устроено).

Директории знаний: `plans/` `ideas/` `bugs/` `researches/` `interviews/` `homeworks/` — в каждой
README с правилами. Закрытое помечается тегом `DONE` в имени файла.

Навыки (`.claude/skills/`): `/resume` `/pause` `/autoloop` `/dayloop` `/nightloop` `/refresh-context`
`/check-backlog` `/report-bug` `/bug-research` `/propose-idea` `/experience` `/interview` `/revision` `/fix-vision` `/what-next` `/help-kaif`
`/release` `/fable-method` `/fable-loop` `/fable-judge` `/fable-domain` (дисциплина исполнения, 1.5:
задачи — по fable-циклу, judge-проход обязателен в лупах и `/release`)
`/kaif-version` `/kaif-update` `/kaif-fork` `/kaif-switch-origin` `/kaif-remove`.
