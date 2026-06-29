# Bug 03 — Превью уезжает в левый нижний угол в ландшафтной ориентации

**Status:** ✅ ИСПРАВЛЕНО (2026-06-28, итерация 1)

**Финальная проверка:** Криник физически крутил устройство туда-сюда ~10 раз во время активного
стрима — каждый поворот дал `startPreview: re-attached during streaming` с правильными размерами,
превью заполняло экран в обеих ориентациях, стрим прожил >4 мин на ~5000 kbps без обрывов и крашей.

**Тест-устройство:** Headwolf Titan 1 (model "Titan 1", device F8), **Android 16 / SDK 36** (ландшафт 2560×1600)
**Веб-камера:** EMEET Piko+ 4K (USB UVC)

> ⚠️ Версию устройства всегда проверять по ADB: `adb shell getprop ro.build.version.release`
> (Android 16, SDK 36) — НЕ полагаться на старые заметки (там ошибочно стояло Android 14).

---

## Симптом

При повороте Android-устройства в ландшафтную ориентацию превью с камеры:
- ✅ Без искажений, правильные пропорции 16:9
- ❌ Ужато в **левый нижний угол** (~половина экрана), сверху и справа большие чёрные поля
- Должно: растягиваться/вписываться на весь экран устройства (letterbox по необходимости, но по центру и максимального размера)

Скриншот: `tools/adb_screen.png` (12:36, ландшафт, во время стрима LIVE 4118 kbps).

---

## История

Этот баг уже чинился ранее — коммит `58d24fe fix: landscape preview — restart GL on TextureView
resize after rotation`. Вернулся после фиксов Bug 02 (сессия 2026-06-28):
- `setCameraOrientation(0)` в startStream
- `onSurfaceDestroyed → stopPreview()`
- skip избыточного `setVideoSource`

Нужно проверить, какой из этих фиксов (или их взаимодействие с поворотом) сломал ландшафт.

---

## Гипотезы (до диагностики)

1. **Preview resolution не обновляется в ландшафте.** GL рисует превью в viewport
   `setPreviewResolution(width, height)`. Если при повороте размеры остаются портретными
   (1600×2560), а surface стал ландшафтным (2560×1600) — AspectRatioMode.Adjust впишет картинку
   в портретный viewport в углу (GL origin = bottom-left) → маленькое изображение слева внизу.

2. **Во время стрима startPreview() выходит рано** (`if (stream.isStreaming) return`) → при повороте
   `onSurfaceTextureSizeChanged → startPreviewOnView` не переконфигурирует превью под новый размер.

3. **`setCameraOrientation(0)`** мог сбить расчёт ориентации превью (previewOrientation vs streamOrientation).

---

## RootEncoder: путь рендера превью (из исходников 2.4.7)

`GlStreamInterface.draw()` → preview-ветка:
```kotlin
val w = if (previewWidth == 0) encoderWidth else previewWidth
val h = if (previewHeight == 0) encoderHeight else previewHeight
mainRender.drawScreenPreview(w, h, orientation, aspectRatioMode, previewOrientation, ...)
```
- `previewWidth/Height` ← `setPreviewResolution()` ← TextureView.width/height в `startPreview()`
- `orientation` (isPortrait) ← из rotation энкодера
- `aspectRatioMode` ← `setAspectRatioMode(Adjust)`

`StreamBase.startPreview(textureView)` → `startPreview(surface, textureView.width, textureView.height)`
→ `glInterface.setPreviewResolution(width, height)`.

→ Значит ключ: при повороте надо заново вызвать startPreview с НОВЫМИ размерами TextureView.

---

## План диагностики

1. Остановить стрим, воспроизвести в чистом превью (изолировать от streaming-状态).
2. Повернуть устройство, снять логи: какие width/height приходят в startPreview.
3. Проверить, вызывается ли `onSurfaceTextureSizeChanged` и с какими размерами.
4. Точечный фикс → билд → тест.

---

## Диагностика (итерация 1) — ПОДТВЕРЖДЕНА гипотеза #2

**Чистое превью (стрим остановлен):** ландшафт работает идеально — картинка на весь экран.
**Во время стрима:** баг воспроизводится. Лог при повороте во время стрима:
```
12:35:16.644  SurfaceTexture size changed: 2560x1600 — restarting preview
12:35:16.644  startPreview: streaming active — TV ref updated, GL restart skipped   ← БАГ
```
`onSurfaceTextureSizeChanged` приходит с правильным размером (2560×1600), но `startPreview`
выходил рано (`if (stream.isStreaming) return`) → превью не переконфигурировалось под ландшафт.

**Почему вообще не показывалось живое превью в стриме:** после Go Live `startStream()` делал
`stopPreview()` (deAttachPreview) и НЕ привязывал превью обратно (наследие Bug 02, где ошибочно
считали, что startPreview во время стрима ломает энкодер). На самом деле энкодер ломал bitrate-баг.

**Проверка по исходнику RootEncoder `StreamBase.startPreview`:**
```kotlin
if (!glInterface.isRunning) glInterface.start()      // во время стрима уже running → skip
if (!videoSource.isRunning()) videoSource.start(...) // во время стрима уже running → skip (камера НЕ переоткрывается!)
glInterface.attachPreview(surface)                    // просто привязка surface
glInterface.setPreviewResolution(width, height)
```
→ `startPreview` во время стрима БЕЗОПАСЕН: камера не трогается, энкодер не трогается.

## Фикс (итерация 1)

1. **`schedulePreviewRestoreAfterStream`**: после старта стрима привязывает ЖИВОЕ превью
   (`stream.startPreview(tv)`) — теперь видно картинку во время трансляции.
2. **`startPreview` (ветка `isStreaming`)**: вместо раннего выхода — пере-привязка превью с новыми
   размерами TextureView (`stopPreview()` + `startPreview(tv)`), что чинит поворот в ландшафт.

**Результат (проверено на устройстве, Android 16, ландшафт):**
- ✅ Превью заполняет весь экран во время стрима в ландшафте (скриншот 12:45)
- ✅ Лог: `live preview attached during streaming (tv=2560x1600)`
- ✅ Битрейт стабильный ~5000 kbps, энкодер не сломался, нет Broken Pipe
- ⏳ Переход поворота портрет↔ландшафт во время стрима — на проверке Криником (физический поворот)
