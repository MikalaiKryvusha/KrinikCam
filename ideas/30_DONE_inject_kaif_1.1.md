- Я работал над этим проектом в паре с Claude Opus - я учился взаимодействовать с ним, а он - со мной. Мы вайбкодили проект KrinikCam. По мере моего знакомства с Claude Opus я нарабатывал опыт того, как его эффективно направлять по работе над программированием KrinikCam.
В результате такого нашего сотрудничества родился побочный продукт - методология работы - фреймворк, который я назвал KAIF.
То, как мы работали с Claude Opus над KrinikCam было дистилировано и обобщено на любой проект для любых доменов человеческой деятельности. Структуированные правила и договорённости были названы Krinik AI Framework - KAIF.

KAIF теперь оформлен как самостоятельный продукт по адресу:
https://github.com/MikalaiKryvusha/KAIF

- Задача в рамках 30_inject_kaif_1.1: 
    - изучить, что такое KAIF
    - изучить текущее состояние проекта KrinikCam в части того, как в нём сейчас в "сыром старом виде" реализовано то, что ещё не было KAIF, но из чего родился KAIF.
    - выполнить миграцию проекта KrinikCam на уже существующий полноценно и формально оформленный KAIF 1.1
## ✅ СТАТУС: DONE (2026-07-02)

Что сделано — миграция KrinikCam («родины» KAIF) на формальный KAIF 1.1 из origin
(https://github.com/MikalaiKryvusha/KAIF, изучен целиком: KAIF.md §0–14 + framework/):

1. **Реструктуризация под канон** (`git mv`, история сохранена): `plans/goal.md`→`GOAL.md`,
   `plans/master_plan.md`→`MASTER_PLAN.md`, `plans/ideas/`→`ideas/`, `plans/research/`→`researches/`
   (+ `context.md`→`researches/competitor_context_usb_camera_shenyao.md`),
   `plans/homework_*`→`homeworks/NN_*`, девайс-логи→`homeworks/logs/` (gitignored, вслед за purge
   Криника от 2026-07-01); `plans/github.md` удалён (дублировал AGENT_GUIDE).
2. **Карты**: старый `project_map.md` → `PROJECT_STRUCTURE_EXTERNAL_MAP.md` (актуализирован) +
   написана новая `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (абстракции, потоки, инварианты).
3. **README** во всех 6 директориях знаний (русская адаптация канона KAIF).
4. **7 недостающих навыков**: `/revision`, `/help-kaif`, `/kaif-version`, `/kaif-update`,
   `/kaif-fork`, `/kaif-switch-origin`, `/kaif-remove` (русская адаптация под KrinikCam).
   Существующие 12 навыков сохранены как локальные кастомизации (они и есть прото-KAIF).
5. **Жизненный цикл**: `.kaif/kaif.json` (v1.1, tracking=origin, sphere=programming,
   agent=claude-code), `tools/kaif.mjs` (version + check-валидатор структуры + guide-ручки),
   npm-скрипты `kaif:*` в `tools/package.json`.
6. **`KAIF_FRAMEWORK.md`** (запись о развёртывании + заметка автора) и связка **`CLAUDE.md`** /
   **`AGENTS.md`** → `AGENT_GUIDE.md` (адаптер claude-code + универсальный фолбэк).
7. **AGENT_GUIDE.md** — секция «Фреймворк KAIF»; все старые пути (`plans/ideas` и т.п.) переписаны
   по всем md проекта; STATUS.md — запись о миграции.

Как проверено: `node tools/kaif.mjs check` — ✅ структура полная; навыки зарегистрированы в
агентской системе; ссылки на старые пути — grep-чисто (историческая переписка в закрытых доках
обновлена той же заменой).
