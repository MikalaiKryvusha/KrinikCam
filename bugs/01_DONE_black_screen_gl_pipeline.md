# Bug 01 — Чёрный экран: GL pipeline не запускается + искажение при ротации

**Статус:** ✅ ИСПРАВЛЕН (2026-06-28)  
**Затронутые билды:** Phase 2 rewrite (с момента перехода с RtmpCamera1 на RtmpStream + UvcVideoSource)  
**Устройство:** Headwolf Titan1, Android 14. Камера: Emeet Piko+ 4K, USB UVC.

---

## Симптомы

**Баг 1 — Чёрный экран:**
- Камера подключается, в логах видно `USB camera opened via GL SurfaceTexture`
- Но экран остаётся полностью чёрным
- В логах бесконечно: `GL still not running after 3000ms — giving up`

**Баг 2 — Краш при нажатии Go Live:**
```
IllegalStateException: Stream, record and preview must be stopped before prepareVideo
at RtmpStreamer.startStream:194
```

**Баг 3 — Ландшафт (обнаружен в процессе):**
- При повороте устройства в landscape видео уходило в верхний левый угол и обрезалось
- Либо (с `setAutoHandleOrientation(true)`) — видео было повёрнуто на 90° боком

---

## Путь расследования

### Шаг 1 — Изучение логов с устройства

Криник снял logcat и прислал. Ключевой паттерн:
```
startPreview: tv=1600x2560 isOnPreview=true glRunning=false
startPreview: done — glRunning=false
GL still not running after 3000ms — giving up
```

`isOnPreview=true` при каждом вызове `startPreview` — значит внутри сразу вызывается `stopPreview()`.

### Шаг 2 — Декомпиляция байткода RootEncoder 2.4.7

Не имея исходников библиотеки, декомпилировали JAR из gradle-кэша (`~/.gradle/caches/8.10/transforms/`):

```bash
jar xf library-2.4.7-runtime.jar com/pedro/library/view/GlStreamInterface.class
javap -p -c GlStreamInterface.class
```

**Ключевые находки из байткода:**

1. `GlStreamInterface.stop()` делает `threadQueue.clear()` — это **отменяет pending лямбды** в очереди
2. `GlStreamInterface.start()` создаёт новый executor и отправляет лямбду в `threadQueue`
3. `running.set(true)` вызывается **внутри лямбды**, после `EglSetup()` — асинхронно
4. `secureSubmit()` в `ExtensionsKt` — оборачивает вызов лямбды в try/catch, **глотает все исключения молча**

### Шаг 3 — Поиск двойного триггера

В `MainScreen.kt` обнаружено: `startPreviewOnView(tv)` вызывается из **двух мест** одновременно:

```kotlin
// Место 1: при подключении камеры
LaunchedEffect(usbState.activeCamera) {
    streamViewModel.setVideoSource(source)
    previewTextureView?.let { tv -> streamViewModel.startPreviewOnView(tv) }  // ← УДАЛЕНО
}

// Место 2: когда TextureView становится доступен
UvcPreviewView(onTextureViewReady = { tv ->
    streamViewModel.startPreviewOnView(tv)  // ← ЕДИНСТВЕННЫЙ правильный триггер
})
```

Когда камера уже подключена в момент запуска UI, оба места срабатывают почти одновременно.
Второй вызов → `startPreview()` → `if (isOnPreview) stopPreview()` → `threadQueue.clear()` → GL лямбда отменена.

### Шаг 4 — Поиск реального root cause (encoderSize = 0)

После устранения двойного триггера логи улучшились:
```
startPreview: tv=1600x2560 isOnPreview=false glRunning=false   ← улучшение: isOnPreview=false
SurfaceManager: GL already released
SurfaceManager: GL initialized
startPreview: done — glRunning=false                           ← GL всё ещё не работает!
GL still not running after 3000ms — giving up
```

GL thread запустился (`GL initialized` в потоке 29659), но `running` так и не стал `true`.

Декомпилировали `start$lambda$5` (основная GL init лямбда):

```
surfaceManager.release()        → "GL already released"
surfaceManager.eglSetup()       → "GL initialized"
surfaceManager.makeCurrent()
mainRender.initGl(ctx, encoderWidth, encoderHeight, ...)   ← ПАДАЕТ здесь!
surfaceManagerPhoto.eglSetup(encoderWidth, encoderHeight, ...)
running.set(true)               ← никогда не достигается
```

`encoderWidth` и `encoderHeight` — `private int` поля в `GlStreamInterface`, по умолчанию = **0**.
Они заполняются через `setEncoderSize()`, который вызывается из `prepareVideo()`.

`prepareVideo()` никогда не вызывалась — пользователь ещё не нажал Go Live.  
`mainRender.initGl(ctx, 0, 0, 0, 0)` — бросает исключение.  
`secureSubmit()` глотает его.  
`running.set(true)` — недостижимо.  
**`isRunning` навсегда остаётся `false`.**

### Шаг 5 — Ландшафтная ориентация

После фикса черного экрана обнаружили: при повороте в ландшафт видео съезжало в угол.

Причина: GL render surface инициализировался с портретными размерами TextureView (1600×2560).
При ротации TextureView менял размер до 2560×1600, но GL pipeline не перезапускался.
GL рендерил в портретный сурфейс, который ландшафтный TextureView отображал лишь частично.

Попытка #1: `setAutoHandleOrientation(true)` — **неправильно**.  
Этот флаг вращает видео-аутпут по показаниям акселерометра. Для встроенных камер телефона это
нужно (компенсирует поворот устройства). Для **фиксированной USB-камеры** — это добавляет лишние
90° к видео, делая картинку боком.

Правильный подход: перезапускать `startPreview(tv)` при `onSurfaceTextureSizeChanged` — тогда
GL пересоздаёт render surface с актуальными размерами. `AspectRatioMode.Adjust` сам правильно
вписывает 16:9 поток в любую ориентацию экрана.

---

## Исправления

### Fix 1 — Устранение двойного триггера (`MainScreen.kt`)

Убрали `startPreviewOnView(tv)` из `LaunchedEffect(usbState.activeCamera)`.  
Теперь preview стартует **только** из `onTextureViewReady`.  
`LaunchedEffect` отвечает только за `setVideoSource()`.

### Fix 2 — Реальный root cause: encoder size перед GL инитом (`RtmpStreamer.kt`)

```kotlin
// В startPreview(), до stream.startPreview(tv):
val glSize = stream.getGlInterface().encoderSize
if (glSize.x == 0 || glSize.y == 0) {
    KLog.d(TAG, "startPreview: encoderSize=0 — setting 1920x1080 default so GL can init")
    stream.getGlInterface().setEncoderSize(1920, 1080)
}
```

`prepareVideo()` при нажатии Go Live перезапишет эти размеры актуальными из профиля.

### Fix 3 — Retry читает `currentVideoSource` в момент срабатывания (`RtmpStreamer.kt`)

`scheduleVideoSourceRetryIfNeeded()` раньше захватывал `src` при планировании.  
Если камера переподключалась за 3 секунды ожидания — использовался устаревший источник.  
Теперь `currentVideoSource` читается **внутри корутины после ожидания**.

### Fix 4 — Stop preview перед prepareVideo + восстановление после (`RtmpStreamer.kt`)

```kotlin
// startStream():
if (stream.isOnPreview) stream.stopPreview()  // иначе prepareVideo() бросит
val prepared = stream.prepareVideo(...) && stream.prepareAudio(...)
stream.startStream(rtmpUrl)
schedulePreviewRestoreAfterStream(stream)     // восстановить TextureView когда GL готов
```

`schedulePreviewRestoreAfterStream()` ждёт `gl.isRunning=true`, потом вызывает `stream.startPreview(tv)`.  
Поскольку GL уже запущен `startStream()`, `startPreview()` только добавляет TextureView как цель рендера — двойного старта GL не происходит.

### Fix 5 — Перезапуск GL при ротации (`UvcPreviewView.kt` + `MainScreen.kt`)

```kotlin
// UvcPreviewView — новый callback:
override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {
    onSurfaceTextureSizeChanged(tv, w, h)
}

// MainScreen — обработчик:
onSurfaceTextureSizeChanged = { tv, _, _ ->
    if (currentCamera != null) streamViewModel.startPreviewOnView(tv)
}
```

`rememberUpdatedState(usbState.activeCamera)` используется чтобы callback всегда читал актуальное состояние камеры (не замкнутое на момент создания TextureView).

---

## Ключевые инсайты о RootEncoder 2.4.7

| Факт | Последствие |
|------|-------------|
| `GlStreamInterface.stop()` вызывает `threadQueue.clear()` | Любой `stop()` пока GL инициализируется = `isRunning` навсегда `false` |
| `secureSubmit()` глотает все исключения из GL лямбды | Падение в `initGl()` невидимо — нет лога, нет стектрейса |
| `encoderWidth/Height = 0` до `prepareVideo()` | Нельзя вызвать `startPreview()` до `prepareVideo()` без явного `setEncoderSize()` |
| `prepareVideo()` требует `isOnPreview=false` | Порядок: `stopPreview → prepareVideo → startPreview → startStream` |
| `setAutoHandleOrientation(true)` для встроенных камер | Для USB-камер — неправильно, добавляет лишний поворот |

---

## Подтверждение в логах (финальный успешный запуск)

```
RtmpStreamer: startPreview: encoderSize=0 — setting 1920x1080 default so GL can init
SurfaceManager: GL already released
SurfaceManager: GL initialized
RtmpStreamer: startPreview: done — glRunning=true        ← GL ЗАПУСТИЛСЯ
RtmpStreamer: GL ready after 0ms — re-triggering VideoSource
UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
```

---

## Файлы изменены

| Файл | Что изменено |
|------|-------------|
| `app/.../ui/screens/MainScreen.kt` | Убран двойной триггер; добавлен restart по `onSurfaceTextureSizeChanged` |
| `feature/streaming/.../rtmp/RtmpStreamer.kt` | `setEncoderSize`, retry fix, `startStream` fix, `schedulePreviewRestoreAfterStream` |
| `feature/usb/.../ui/UvcPreviewView.kt` | Новый `onSurfaceTextureSizeChanged` callback |

**Коммиты:**
- `6c39c44` — fix: black screen — GL init crash due to encoderSize=0 before prepareVideo
- `58d24fe` — fix: landscape preview — restart GL on TextureView resize after rotation

---

## Статус тестирования

- [x] Камера подключается → превью появляется мгновенно (`glRunning=true`)
- [x] Лог: `GL ready after 0ms` — без 3000ms ожидания
- [x] Портрет → правильный 16:9 letterbox ✅
- [x] Ландшафт → видео заполняет экран корректно ✅ (подтверждено Криником)
- [ ] Go Live → нет краша `IllegalStateException` — фикс реализован, тест pending
- [ ] Go Live → RTMP стрим подключается → LIVE индикатор — pending
