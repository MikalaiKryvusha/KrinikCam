# KrinikCam — контекст для Claude Code

Проект обвязан фреймворком **KAIF 1.1** (см. `KAIF_FRAMEWORK.md`). Канон здесь НЕ дублируется —
читай первоисточники:

1. **`AGENT_GUIDE.md`** — КАНОН: правила, имена, команды, соглашения. Читать перед каждой задачей.
2. **`STATUS.md`** — живое состояние: что сделано, где мы, что дальше.
3. **`PHILOSOPHY.md`** — главный принцип: ПРОСТОТА (KISS + Оккам). Затык = не понял задачу → упрости.
4. **`BUG_FIXING_FRAMEWORK.md`** — как чинить дефекты (цикл фикс→сборка→тест, правило 3 попыток).
5. Карты: `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (где что лежит) и
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (как устроено).

Директории знаний: `plans/` `ideas/` `bugs/` `researches/` `interviews/` `homeworks/` — в каждой
README с правилами. Закрытое помечается тегом `DONE` в имени файла.

Навыки (`.claude/skills/`): `/resume` `/pause` `/autoloop` `/dayloop` `/nightloop` `/refresh-context`
`/check-backlog` `/report-bug` `/bug-research` `/propose-idea` `/interview` `/revision` `/help-kaif`
`/release` `/kaif-version` `/kaif-update` `/kaif-fork` `/kaif-switch-origin` `/kaif-remove`.
