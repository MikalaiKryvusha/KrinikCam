# KrinikCam — AI Agent Guide

Этот файл читается AI-агентом перед каждой задачей.

---

## Перед каждой задачей — чеклист

```
1. Прочитать STATUS.md                # текущий статус: что сделано, где находимся, что дальше
2. git status                         # что изменено, что не закоммичено
3. git log --oneline -5               # где находимся в истории
4. Прочитать MEMORY.md                # /memory/MEMORY.md — профиль пользователя, ключевые решения
5. Прочитать нужный план из plans/    # если задача связана с конкретной фичей
6. Запустить build (если трогаешь код)# JAVA_HOME=AS_JBR node tools/build.mjs --no-ui
```

→ **`STATUS.md`** — главный файл состояния проекта. Обновляй его после каждой значимой задачи.

---

## Цель проекта

KrinikCam — Android-приложение (Kotlin, Compose) для Mikalai Kryvusha (KOT KRINIK, стример).
Подключает USB-вебкамеру через OTG → fullscreen превью → RTMP-стрим на YouTube/Twitch/etc.

---

## Текущее состояние

| Фаза | Статус | Что сделано |
|------|--------|-------------|
| Phase 0 | ✅ done | Gradle skeleton, CI, build-ui tool |
| Phase 1 | ✅ done | USB UVC preview, RTMP stream, DeviceManager, Room/DataStore profiles, CodecScanner, logging, UI (MainScreen, radial FAB, Platforms overlay, StandbyPlaceholder) |
| Phase 2 | 🔲 todo | Multi-stream, Camera2 fallback, standby filter via BaseFilterRender |

---

## Архитектура — модули

```
:app                    ← главный модуль, зависит от всех feature
:core:common            ← базовые утилиты (нет внешних зависимостей)
:core:ui                ← Compose тема, цвета, типографика
:core:logging           ← KLog + FileLogger (write-to-file + share intent)
:data:profiles          ← Room DB + DataStore (StreamProfile, DeviceProfile)
:feature:usb            ← AndroidUSBCamera, USB hot-plug, UvcPreviewView
:feature:capture        ← DeviceManager (приоритет источника: UVC→phone→none)
:feature:codec          ← CodecScanner (MediaCodecList → DeviceProfile)
:feature:streaming      ← RootEncoder RTMP, StreamViewModel, StreamPlatformsOverlay
```

**ПРАВИЛО:** feature-модули не зависят друг от друга. Только `:app` зависит от всех.
Мосты между feature — через `:app` (например, `LaunchedEffect` в `MainScreen.kt`).

---

## Сборка

```bash
# ВАЖНО: system java_home может вернуть Java 25 (Temurin) — она сломает сборку
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/build.mjs --no-ui        # headless (для скриптов)
node tools/build.mjs                # с UI прогресс-баром в браузере
```

Проверить только ошибки:
```bash
export JAVA_HOME="..." && node tools/build.mjs --no-ui 2>&1 | grep "^e:"
```

---

## Ключевые библиотеки и их особенности

### AndroidUSBCamera 3.2.7 (`com.github.jiangdongguo.AndroidUSBCamera:libausbc`)
- Класс камеры: `MultiCameraClient.Camera` (не `CameraUVC` — её нет в 3.x)
- Callback: `com.jiangdg.ausbc.callback.IDeviceConnectCallBack` (не вложен в `MultiCameraClient`)
- Опечатка в API: `onDetachDec` / `onDisConnectDec` (не `Dev`)
- Состояние: `ICameraStateCallBack.State` (OPENED/CLOSED/ERROR), не `Code`
- Открыть превью: `camera.openCamera(textureView, cameraRequest?)`
- `libuvc` нужен как `compileOnly` — в POM он `runtime`, но его тип торчит в публичном интерфейсе

### RootEncoder 2.4.7 (`com.github.pedroSG94.RootEncoder:library`)
- Пакет: `com.pedro.library.rtmp.RtmpCamera1` (не `rtplibrary`)
- Интерфейс: `com.pedro.common.ConnectChecker`
- Коллбэки без суффикса: `onConnectionSuccess()`, `onConnectionFailed(reason)`, etc.
- `prepareVideo(w, h, fps, bitrate, rotation)` — последний параметр `rotation: Int`, не Facing
- `setCustomImageToStream()` удалён → используй `glInterface.setFilter(BaseFilterRender)` для статик-кадра

### Compose Material3
- `ExposedDropdownMenuBox` и `menuAnchor()` — экспериментальные, нужен `@OptIn(ExperimentalMaterial3Api::class)`

---

## Интервью перед каждой новой фичей

Перед реализацией каждой Phase — проводи интервью с Krinik по шаблону:
`interviews/interview_NNN_<phase_name>.md`

Задай конкретные закрытые вопросы (A/B/C варианты), получи ответы, зафиксируй решения, потом пиши код. Никогда не делай UI/UX решения без подтверждения.

---

## Коммиты

Стиль: `feat:`, `fix:`, `docs:`, `refactor:`, `ci:` + одна строка что сделано.
Тег при завершении фазы: `v0.N` (Phase 0 = v0.1, Phase 1 = v0.2, ...).

---

## Инструменты проекта

| Команда | Что делает |
|---------|------------|
| `node tools/build.mjs` | сборка с браузерным UI |
| `node tools/build.mjs --no-ui` | headless сборка |
| `node tools/graphics/render.mjs --input x.svg --output x.png --width N --height N` | SVG→PNG |
| `node tools/graphics/batch.mjs --input x.svg --android` | SVG→Android mipmap set |

---

## Карта проекта

Полная карта файлов и потоки данных — `plans/project_map.md`.
План Phase 1 — `plans/phase_1_mvp.md`.
План graphics tool — `plans/graphics_tool.md`.

---

## Стиль кода

- Kotlin, никаких лишних комментариев — только WHY, никогда WHAT
- Compose: никаких `preview` в продакшн-файлах, разбивай на мелкие `@Composable`
- Hilt везде — никакого ручного DI
- Flow/StateFlow — никогда LiveData
- Никаких magic numbers — константы с понятными именами
- Цвет бренда: `#FF1A8C` (acid pink)
