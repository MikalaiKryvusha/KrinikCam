# KrinikCam — контекст для Claude Code

Проект обвязан фреймворком **KAIF 2.1 — Strong KAIF** (см. `KAIF_FRAMEWORK.md`). Канон здесь НЕ
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
   значимого успеха/провала (навык `/experience`; с 2.1 строка `Repro:` обязательна).
7. Карты: `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (где что лежит) и
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (как устроено).
8. **`PROJECT_HISTORY.md`** (2.1) — append-only летопись закрытого (сессии, фазы, релизы). В
   обязательный минимум чтения НЕ входит: открывай только под археологию. STATUS сбрасывает сюда своё
   прошлое, оставаясь сводкой настоящего.

Директории знаний: `plans/` `ideas/` `bugs/` `researches/` `interviews/` `homeworks/` — в каждой
README с правилами. Закрытое помечается тегом `DONE` в имени файла. **Место вопросов к Кринику —
только `interviews/`** (жёсткое правило 2.1; исключение — один точечный вопрос уровня задачи в чате).

Навыки (`.claude/skills/`, 34): `/resume` `/pause` (мягкая парковка) `/end-chat` (полное закрытие с
эстафетой) `/autoloop` `/dayloop` `/nightloop` `/guarded-loop` (цикл под вахтёром) `/refresh-context`
`/check-backlog` `/code-revision` `/report-bug` `/bug-research` `/propose-idea` `/experience`
`/interview` `/owner-voice` `/owner-reviews` `/derive-styleguide` `/plan-task` `/plan-epic` `/revision`
`/fix-vision` `/what-next` `/help-kaif` `/release` `/fable-method` `/fable-loop` `/fable-judge`
`/fable-domain` (дисциплина исполнения, 1.5: задачи — по fable-циклу, judge-проход обязателен в лупах
и `/release`; 1.6: и перед КАЖДЫМ push/деплоем, +6 guardrail-охот судьи, разведартефакты до кода,
правило одного шага, git-гигиена, провенанс-марки `[AI]…[/AI]`, секция «Решения, принятые без
владельца» при закрытии задач; 2.1: лестница планирования перед тяжёлой работой, класс ВКУСА —
мокап и ДЗ вместо вердикта агента, нейминг не решается агентом, текст ходит файлами)
`/kaif-version` `/kaif-update` `/kaif-fork` `/kaif-switch-origin` `/kaif-remove`.
