# Phase 0 — Foundation

**Статус:** ✅ Реализовано (2026-06-27)
**Цель:** Базовая структура проекта компилируется, инструменты работают, GitHub связан.

---

## Что создано

### Android-проект (Gradle multi-module, Kotlin DSL)

| Файл / папка                                  | Назначение                                              |
|-----------------------------------------------|---------------------------------------------------------|
| `settings.gradle.kts`                         | Объявление модулей: `:app`, `:core:common`, `:core:ui`  |
| `build.gradle.kts` (root)                     | Применение плагинов на уровне проекта                   |
| `gradle.properties`                           | JVM heap, parallel build, configuration cache           |
| `gradle/libs.versions.toml`                   | Единый version catalog для всех зависимостей            |
| `gradle/wrapper/gradle-wrapper.properties`    | Gradle 8.10, скачивается автоматически                  |
| `version.json`                                | Единый источник правды для SemVer версии                |
| `app/build.gradle.kts`                        | Настройки приложения, чтение версии из version.json     |
| `app/src/main/AndroidManifest.xml`            | Разрешения: INTERNET, RECORD_AUDIO, USB host, etc.      |
| `app/src/main/kotlin/.../KrinikCamApp.kt`     | Application класс, инициализация Hilt + Timber          |
| `app/src/main/kotlin/.../MainActivity.kt`     | Единственная Activity, точка входа для NavHost          |
| `app/src/main/res/values/themes.xml`          | XML-тема для Activity (окно, статус-бар)                |
| `core/common/build.gradle.kts`                | Модуль shared utilities (Hilt, Coroutines, Serialization)|
| `core/common/.../di/DispatchersModule.kt`     | Hilt binding для IO/Main/Default CoroutineDispatcher    |
| `core/ui/build.gradle.kts`                    | Модуль Design System (Compose, Material3)               |
| `core/ui/.../theme/Color.kt`                  | Цветовая палитра: AcidPink (#FF1A8C) + тёмная тема      |
| `core/ui/.../theme/Type.kt`                   | Типографика: шкала размеров под streaming UI            |
| `core/ui/.../theme/Theme.kt`                  | KrinikCamTheme: dark/light ColorScheme + Material3      |
| `app/proguard-rules.pro`                      | ProGuard: сохранение Hilt, Room, Serialization классов  |
| `LICENSE`                                     | MIT License                                             |
| `.gitignore`                                  | Android + Gradle + Node.js + macOS                      |

### Node.js инструменты автоматизации (`/tools`)

| Файл                  | Запуск                                   | Что делает                                              |
|-----------------------|------------------------------------------|---------------------------------------------------------|
| `tools/setup.mjs`     | `node tools/setup.mjs`                   | Первоначальная настройка: JDK, Gradle wrapper, npm deps |
| `tools/version.mjs`   | _(импортируется другими инструментами)_   | Чтение/запись version.json, форматирование версий       |
| `tools/build.mjs`     | `node tools/build.mjs [--release]`       | Сборка APK через Gradle                                 |
| `tools/commit.mjs`    | `node tools/commit.mjs "message"`        | Bump build → git add -A → commit → push                 |
| `tools/release.mjs`   | `node tools/release.mjs [--major] [--dry-run]` | Bump minor → build release → tag → GitHub Release |
| `tools/readme-pdf.mjs`| `node tools/readme-pdf.mjs`             | Конвертация README.md → README.pdf (brand styling)      |
| `tools/package.json`  | `npm install` (в папке tools/)           | Зависимости: md-to-pdf                                  |

### GitHub Actions CI/CD

| Файл                                  | Триггер              | Что делает                                          |
|---------------------------------------|----------------------|-----------------------------------------------------|
| `.github/workflows/build.yml`         | push/PR → main       | Компиляция debug APK, upload артефакта              |
| `.github/workflows/release.yml`       | push tag `v*`        | Release APK → GitHub Release с авто-примечаниями   |

---

## Инструкция: первый запуск после клонирования

```bash
# 1. Сгенерировать Gradle wrapper и установить зависимости
node tools/setup.mjs

# 2. Подключить gh CLI к GitHub (один раз)
gh auth login

# 3. Настроить remote
git remote add origin https://github.com/MikalaiKryvusha/KrinikCam.git

# 4. Проверить сборку
node tools/build.mjs
```

---

## Инструкция: рабочий цикл

```bash
# Разработка, внесение изменений...

# Commit + bump build + push
node tools/commit.mjs "feat: add USB camera detection"

# Когда готов к релизу:
node tools/release.mjs         # → minor bump (0.1 → 0.2)
node tools/release.mjs --major # → major bump (0.x → 1.0)
node tools/release.mjs --dry-run # → симуляция без деплоя
```

---

## Что НЕ сделано (требует ручного шага)

- [ ] `gh auth login` — аутентификация GitHub CLI (нужна один раз, интерактивно)
- [ ] `git remote add origin ...` — привязка к GitHub репозиторию
- [ ] `gradle wrapper` — генерация бинарного gradle-wrapper.jar (через `node tools/setup.mjs`)
- [ ] Иконка приложения (placeholder, hot pink KCam) — Phase 1
- [ ] README.md — Phase 7

---

## Следующий шаг: Phase 1

→ [phase_1_mvp.md](phase_1_mvp.md) _(будет создан перед началом Phase 1)_

USB камера → превью → стрим на YouTube.
