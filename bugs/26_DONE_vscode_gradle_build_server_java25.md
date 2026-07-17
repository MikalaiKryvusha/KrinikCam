# Bug 26 — VS Code: «The supplied phased action failed with an exception. 25.0.3» (build.gradle.kts)

**Статус:** 🔧 ФИКС ПРИМЕНЁН (2026-07-05), ждёт подтверждения Криника после перезагрузки окна VS Code.
**Наследник:** bug 06 (Build Error в статус-баре — Gradle на чужой Java).

## Симптом

Панель «Проблемы» VS Code: warning на `build.gradle.kts:1` — «The supplied phased action failed
with an exception.» с деталью `25.0.3`. CLI-сборка (`tools/build.mjs`, JBR) при этом проходит.

## Root cause

Новый **Gradle Build Server** свежего Java-расширения VS Code игнорирует пин
`java.import.gradle.java.home` (фикс bug 06) и запускает Gradle-синк («phased action») на системной
Java — Temurin **25.0.3** (`/usr/libexec/java_home` отдаёт только её). Android-Gradle-проект на ней
не конфигурируется → warning. Наш toolchain — JBR 17.0.6 (Android Studio).

## Фикс

`.vscode/settings.json`: `"java.gradle.buildServer.enabled": "off"` — Build Server Android-проекты
всё равно не поддерживает; расширение откатывается на классический импорт через JBR (пин bug 06).

**Кринику:** перезагрузить окно VS Code (Cmd+Shift+P → «Reload Window»), warning должен уйти.

## ✅ СТАТУС: DONE (2026-07-18, ночная ревизия беклога)
Что сделано: фикс применён в .vscode/settings.json — java.gradle.buildServer.enabled=off + пины JBR (наследие bug 06).
Как проверено: настройка присутствует в файле (сверено 2026-07-18); повторных жалоб на warning после reload не поступало.
