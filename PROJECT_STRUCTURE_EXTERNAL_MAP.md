# KrinikCam — Внешняя карта проекта (структура)

> **Что это.** Внешняя карта: где что лежит, зачем нужно и как связано — директории, файлы, ссылки.
> Внутреннее устройство (абстракции, потоки данных) — в `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`.
> Живой справочник (KAIF) — ведёт агент, обновляется после каждой значимой перестройки. Тегом DONE не помечается.

---

## Дерево файлов

```
KrinikCam/
│
│  ── КЛЮЧЕВЫЕ ДОКУМЕНТЫ (KAIF) ──
├── AGENT_GUIDE.md                        — КАНОН: правила, команды, соглашения (читать перед каждой задачей)
├── PHILOSOPHY.md                         — как агент мыслит: ПРОСТОТА (KISS + Оккам + набор принципов)
├── BUG_FIXING_FRAMEWORK.md               — как агент чинит баги (цикл фикс→сборка→тест, правило 3 попыток)
├── TESTING_FRAMEWORK.md                  — канон тестирования: 7 принципов + маркеры [NOT-TESTED]/[TESTED]
├── EXPERIENCE.md                         — журнал уроков агента (вспомнить до задачи, записать после)
├── GOAL.md                               — видение Криника (владелец пишет, агент читает)
├── STATUS.md                             — живая СВОДКА настоящего (~200 строк): где мы, что дальше
├── PROJECT_HISTORY.md                    — append-only летопись закрытого (сессии, фазы, релизы);
│                                           бывший researches/status_archive.md влит сюда 2026-07-31
├── MASTER_PLAN.md                        — генеральный план: фазы от текущего состояния к GOAL
├── PROJECT_STRUCTURE_EXTERNAL_MAP.md     — этот файл (внешняя карта)
├── PROJECT_ARCHITECTURE_INTERNAL_MAP.md  — внутренняя карта (абстракции и взаимодействия)
├── KAIF_FRAMEWORK.md                     — «KAIF, развёрнутый здесь» + запись о развёртывании
├── CLAUDE.md / AGENTS.md                 — авто-контекст агентских систем → указывают на AGENT_GUIDE.md
├── README.md / README.pdf                — витрина проекта (EN+RU) и её PDF-рендер
│
│  ── ДИРЕКТОРИИ ЗНАНИЙ (KAIF; в каждой README.md с правилами) ──
├── plans/                                — детальные планы работ (фазы, фичи, worklog'и)
├── ideas/                                — идеи/фичи (в основном от Криника; агент — через /propose-idea)
├── bugs/                                 — по документу на дефект (симптом → форензика → фикс)
├── researches/                           — база знаний: конкуренты, GL-композитор, SEO и т.п.
├── interviews/                           — решения уровня владельца (Криник отвечает в документе)
├── homeworks/                            — ДЗ Кринику (то, что агент не может сделать без человека)
│   └── logs/                             — девайс-логи с ДЗ (gitignored — в git НЕ коммитим)
│
│  ── ФРЕЙМВОРК И ИНСТРУМЕНТЫ ──
├── .kaif/kaif.json                       — маркер развёртывания KAIF (версия, sphere, agents, tracking, history)
├── .kaif/kaif-core.mjs                   — машинерия жизненного цикла (check/diff/modules/update/adopt-current…)
├── .kaif/KAIF_REFERENCE.md               — полный справочник механики фреймворка (§1–16), цитирует /help-kaif
├── .kaif/deploy-manifest.json            — манифест развёртывания v2 (sha шаблонов ОТДЕЛЬНО от sha на диске)
├── .kaif/last-update.json                — квитанция последнего обновления (что во что, каким маршрутом)
├── .kaif/spheres/                        — библиотека сфер (у нас активна programming)
├── .kaif/tools/                          — опциональные модули: гейт провенанса [AI], линтер канона
├── .claude/skills/                       — навыки-ритуалы, 34 шт. (/resume, /pause, /end-chat, лупы, /plan-*, /kaif-*)
├── tools/                                — Node.js-инструменты автоматизации:
│   ├── build.mjs / build-ui.mjs          —   сборка APK (+браузерный прогресс-бар)
│   ├── commit.mjs                        —   bump build → git commit → push
│   ├── release.mjs / version.mjs         —   релиз в GitHub Releases / версия version.json
│   ├── ui.mjs                            —   ⭐ UI-автоматизация на девайсе (cmd/dump/tap/allow/screen…)
│   ├── adb.mjs                           —   ADB: screen/tap/logcat/install/start/stop
│   ├── owner.mjs + owner-verify.mjs      —   ⭐ контур согласований «агент ↔ Криник» (`/owner-reviews`):
│   │                                     —   guard/baseline/ask/gate/queue/inbox/selftest + QA живым браузером
│   ├── owner.config.json                 —   настройки контура (владелец, голос, тихие часы, порт, акцент)
│   ├── owner-guard-*.json                —   исключения гарда С ПРИЧИНАМИ и базовая линия долга (ратчет)
│   ├── kaif.mjs                          —   ручки жизненного цикла KAIF (npm run kaif:*)
│   ├── readme-pdf.mjs / setup.mjs        —   README.pdf / первичная настройка окружения
│   ├── graphics/ (render.mjs, batch.mjs) —   SVG→PNG, SVG→Android mipmap set
│   ├── UI_AUTOMATION_GUIDE.md            —   полное руководство по UI-автоматизации
│   └── package.json                      —   npm-скрипты (build/commit/release/kaif:* и др.)
│
│  ── КОД ПРИЛОЖЕНИЯ (Android, Kotlin + Compose; детали → внутренняя карта) ──
├── app/                                  — :app — точка входа, экраны, навигация, dev-меню, мосты фич
├── core/                                 — :core:common (утилиты/DI), :core:ui (тема), :core:logging (KLog)
├── data/profiles/                        — :data:profiles — Room DB + DataStore (профили стрима/устройства)
├── feature/                              — :feature:usb / capture / codec / streaming (см. внутреннюю карту)
│
│  ── СБОРКА / CI ──
├── build.gradle.kts, settings.gradle.kts, gradle/, gradlew — Gradle multi-module (JBR из Android Studio!)
├── version.json                          — версия приложения: major.minor (build)
├── assets/                               — исходники графики (SVG и т.п.)
└── .github/workflows/                    — CI: build.yml, release.yml
```

---

## Внешние зависимости (ключевые)

| Библиотека | Где используется | Назначение |
|------------|-----------------|-----------|
| `jiangdongguo/AndroidUSBCamera` 3.2.7 | `:feature:usb` | UVC-камера: USBMonitor, MultiCameraClient.Camera, preview |
| `pedroSG94/RootEncoder` 2.4.7 | `:feature:streaming` | RTMP-клиент + кодирование (RtmpStream + кастомные VideoSource) |
| Hilt | все модули | DI-фреймворк |
| Room | `:data:profiles` | SQLite ORM для StreamProfile |
| DataStore | `:data:profiles` | key-value: DeviceProfile, active profile ID |
| Navigation Compose | `:app` | экранная навигация |
| Timber | `:core:logging` | консольный логгер (KLog поверх) |

---

## Инструменты (команды)

```bash
# Сборка (ВАЖНО: JAVA_HOME = JBR из Android Studio, иначе сборка ломается)
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/build.mjs              # debug + браузерный прогресс-бар
node tools/build.mjs --release    # release APK
node tools/build.mjs --no-ui      # headless (для скриптов/CI)

# Версионирование и деплой
node tools/commit.mjs "feat: ..." # bump build → commit → push
node tools/release.mjs            # bump minor → release APK → GitHub Release

# Тестирование на девайсе (полное руководство: tools/UI_AUTOMATION_GUIDE.md)
node tools/ui.mjs cmd <action>    # ⭐ толстая debug-команда (состояние приложения, минуя UI)
node tools/ui.mjs dump|tap|find|swipe|allow|kill|start|screen ...

# Документация и KAIF
node tools/readme-pdf.mjs         # README.md → README.pdf
node tools/kaif.mjs version|check # версия / проверка развёрнутого KAIF (или cd tools && npm run kaif:*)
```

---

## Где что менять

| Хочу изменить | Где смотреть |
|--------------|-------------|
| Цвета / шрифты | `core/ui/src/.../theme/Color.kt`, `Type.kt` |
| Новый экран | Добавить в `app/NavGraph.kt`, создать в `app/ui/screens/` |
| Новая RTMP-платформа | `data/profiles/model/StreamProfile.kt` → `StreamPlatform` enum |
| USB-камера перестала работать | `feature/usb/data/UsbDeviceRepositoryImpl.kt` |
| Стриминг не подключается | `feature/streaming/rtmp/RtmpStreamer.kt` |
| Слои/композитор (камера как слой) | `feature/streaming/scene/` (Scene, Layer) + `feature/streaming/gl/` (CompositorVideoSource, GlQuadRenderer, Egl) |
| Dev-меню / debug-тумблеры | `app/dev/DevSettings.kt`, `app/ui/screens/DevMenuScreen.kt` |
| Логи не пишутся | `core/logging/FileLogger.kt` |
| Новая версия зависимости | `gradle/libs.versions.toml` |
| CI pipeline | `.github/workflows/build.yml`, `release.yml` |
| Толстая debug-команда харнеса | CMD-receiver в `app/MainActivity.kt` + ветка в `tools/ui.mjs cmd` |
