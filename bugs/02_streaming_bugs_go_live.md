# Bug 02 — Стриминг: три бага при нажатии Go Live

**Status:** ✅ ИСПРАВЛЕНО (2026-06-28, итерация 6 — подтверждено в YouTube Криником)

## 🎯 ИТОГ: корневые причины и фиксы

| # | Баг | Корневая причина | Фикс |
|---|-----|------------------|------|
| B | YouTube не получает видео, Broken Pipe через 15с | **Перепутан порядок аргументов `prepareVideo`**: `(w,h,fps,bitrate)` вместо `(w,h,bitrate,fps)` → энкодер с битрейтом 30 бит/с → пустой видеотрек → только звук | Поправлен порядок: bitrate 3-й, fps 4-й (Fix 6.1) |
| A | Видео повёрнуто на 90° CCW + растянуто до 16:9 | `prepareVideo(rotation=0)` зовёт `glInterface.setCameraOrientation(270)` (для телефонных сенсоров); USB-вебка уже ровная | `setCameraOrientation(0)` после prepareVideo (Fix 6.2) |
| C | Краш при стриме / навигации | GL_OUT_OF_MEMORY: GL рисует в уничтоженный surface | `onSurfaceDestroyed` → `stopPreview()` (Fix 5.1) |
| D | Чёрный экран превью | AUSBC reconnect storm (петля openCamera→событие→setVideoSource→openCamera) | skip избыточного setVideoSource (Fix 5.2) |
| E | Тап по тексту кнопок не работал | Кликабельна была только иконка | `.clickable` на лейбле (Fix 4.4) |

**Проверено на устройстве:** стрим в YouTube ~5000 kbps, стабильно >90с без обрыва,
видео ровное и правильных пропорций (подтвердил Криник). Превью восстанавливается после стрима.
Тап по тексту "Stop" работает. Навигация Main↔Settings без краша.

**Главный урок:** баг B жил долго и маскировался под «AUSBC storm» — на самом деле это была
тривиальная перестановка аргументов при миграции с `RtmpCamera1` на `RtmpStream`
(у них РАЗНЫЕ сигнатуры prepareVideo). Записано в AGENT_GUIDE, чтобы не повторилось.

---

## История (до финального диагноза)

**Status:** 🔧 В работе (2026-06-28, итерация 4 — код написан, билд не собран)

**Версия кода:** после фикса Bug 01 (GL pipeline — ✅ исправлен)
**Тест-устройство:** Headwolf Titan1, Android 14
**Веб-камера:** EMEET Piko+ 4K (USB UVC)

---

## Три бага (из репорта Криника)

| # | Симптом | Приоритет | Статус |
|---|---------|-----------|--------|
| A | Видео искажено / повёрнуто при активной трансляции | Высокий | ⏳ нужен тест YouTube |
| B | Приложение показывает "идёт трансляция", YouTube не получает данных | Критический | ⏳ нужен тест YouTube |
| C | Краш приложения при попытке запустить трансляцию | Критический | ✅ Fix1/2/5.1 (проверено) |
| D | Чёрный экран превью после/во время стрима ("опять нет видео") | Высокий | ✅ Fix5.2 (проверено) |
| E | Тап по тексту кнопок Menu/Go Live не работает (только иконка) | Низкий | ✅ Fix4.4 (проверено) |

---

## Диагноз (подтверждён логами 2026-06-28)

### Что произошло при нажатии Go Live в 08:17

```
08:17:54.153  startStream: profile='YouTube' 1920x1080 30fps 4Mbps
08:17:54.153  startStream: isOnPreview=true glRunning=true videoSource=UvcVideoSource
08:17:54.154  startStream: stopPreview() before prepareVideo
08:17:54.154  USB camera closed                              ← stopPreview закрыл камеру
08:17:54.282  startStream: prepareVideo → true
08:17:54.301  startStream: prepareAudio → true
08:17:54.311  USB camera opened via GL SurfaceTexture        ← startStream() внутри открыл камеру
08:17:54.356  GL ready after 0ms — attaching preview TV      ← schedulePreviewRestoreAfterStream запустился
                                                             ← isStreamSetupInProgress = false TOO EARLY ← БАГ
08:17:54.383  USB disconnected                               ← AUSBC cascade storm!
08:17:54.384  Camera closed                                  ← changeVideoSource() закрыл камеру
08:17:54.565  Camera opened                                  ← снова открылась
08:17:54.792  RTMP connected ✓                               ← соединение есть
08:18:10.089  RTMP connection failed: Error send packet, Broken pipe  ← YouTube сбросил через 15с
```

### Корневая причина — AUSBC Reconnect Storm

1. `stream.startStream()` внутренне вызывает `UvcVideoSource.start()` → камера открывается (08:17:54.311)
2. AUSBC асинхронно кидает `PreviewStarted` событие → `UsbDeviceRepositoryImpl` обновляет `activeCamera`
3. Compose `LaunchedEffect(activeCamera)` срабатывает → `setVideoSource(UvcVideoSource(camera))`
4. `stream.changeVideoSource(UvcVideoSource)` → **закрывает** старую камеру (08:17:54.383) и открывает новую (08:17:54.565)
5. В момент 08:17:54.383–08:17:54.565 (182ms) GL энкодер не получает кадры

**Флаг `isStreamSetupInProgress` должен был это блокировать**, но:
- В старом коде флаг блокировал только `source is NoVideoSource`, а реальный источник пропускал
- Флаг сбрасывался после 0ms ожидания GL (GL уже running) — до того, как AUSBC cascade дошёл до `setVideoSource()`

**Результат**: YouTube получает ~15 секунд искажённых/пустых кадров → разрывает соединение `Broken pipe`.

### Почему видео искажено (Баг A)

Множественные открытия камеры за ~250ms:
1. Исходное открытие (stopPreview закрыл, startStream открыл) — 08:17:54.311
2. AUSBC storm close/reopen — 08:17:54.383-565
3. LaunchedEffect срабатывает повторно → `setVideoSource()` → ещё один `changeVideoSource()`

GL пайплайн между этими событиями в нестабильном состоянии → искажённые пиксели в буфере → визуальный артефакт.

### Предыдущие крэши (Баг C)

**crash 07:01** (`IllegalStateException: Stream, record and preview must be stopped before prepareVideo`):
- Старый код не вызывал `stopPreview()` перед `prepareVideo()`
- **Исправлено** в итерации 1 (обязательный `stopPreview()` перед `prepareVideo()`)

**crash 07:40** (`GL error: 1285` — GL_OUT_OF_MEMORY):
- RootEncoder GL pipeline исчерпал GPU память во время кодирования
- Происходит в `GlStreamInterface.draw()` → `ScreenRender.drawEncoder()`
- Вероятно из-за того, что камера открывалась несколько раз → несколько GL surface аллоцированы
- С исправлением storm этот краш должен уйти

---

## История итераций

### Итерация 1 (2026-06-28 07:00-08:00, старая сборка)

**Изменения:**
- Добавлен `stopPreview()` перед `prepareVideo()`
- Добавлен флаг `isStreamSetupInProgress` — блокировал только `NoVideoSource`
- Добавлены диагностические логи в `startStream()`
- `autoHandleOrientation` убран из streaming-пути

**Результат:** Краш `IllegalStateException` устранён. Но `Broken pipe` через 15с остался.

### Итерация 2 (2026-06-28 08:00-08:30)

**Строил новую сборку (08:03). Криник нажал Go Live в 08:17.**

Логи подтвердили: RTMP коннект проходит, но AUSBC storm рвёт камеру сразу после старта.

**Выявлен точный корень:** флаг `isStreamSetupInProgress` сбрасывается слишком рано (0ms после GL ready) и не блокирует реальные источники.

### Итерация 3 (2026-06-28 08:29-...)

**Три конкретных фикса:**

```kotlin
// Fix 1: setVideoSource() теперь блокирует ВСЕ изменения, не только NoVideoSource
fun setVideoSource(source: VideoSource) {
    if (isStreamSetupInProgress) {
        // блокируем UvcVideoSource тоже — иначе AUSBC cascade переоткроет камеру
        KLog.d(TAG, "setVideoSource: blocked during stream setup — ${source::class.simpleName}")
        return
    }
    ...
}

// Fix 2: флаг сбрасывается только в onConnectionSuccess/Failed — после RTMP handshake
override fun onConnectionSuccess() {
    _state.value = StreamState.Live()
    isStreamSetupInProgress = false  // ← теперь здесь, не в schedulePreviewRestoreAfterStream
}
override fun onConnectionFailed(reason: String) {
    isStreamSetupInProgress = false  // ← тоже здесь
    ...
}

// Fix 3: startPreview() не перезапускает GL/камеру когда streaming активен
fun startPreview(tv: TextureView) {
    lastPreviewTextureView = WeakReference(tv)
    if (stream.isStreaming) {
        KLog.d(TAG, "startPreview: streaming active — TV ref updated, GL restart skipped")
        return
    }
    // ... обычный запуск превью
}
```

**APK установлен в 08:30.** Ожидаем результат Go Live.

---

## Ожидаемые логи после Fix 3

```
08:XX:XX.311  USB camera opened via GL SurfaceTexture
08:XX:XX.383  setVideoSource: blocked during stream setup — UvcVideoSource  ← ЗАБЛОКИРОВАНО ✓
08:XX:XX.792  RTMP connected ✓
08:XX:XX.792  onConnectionSuccess: stream setup flag cleared
              ← только теперь разрешаем AUSBC events
              ← камера стабильна, кадры идут нормально
```

---

## Критерии приёмки

- [ ] Go Live → LIVE-индикатор появляется в приложении
- [ ] YouTube Studio → входящий поток виден, видео идёт
- [ ] Видео в YouTube правильно ориентировано (не повёрнуто, не растянуто)
- [ ] Несколько попыток запуска → нет краша
- [ ] В логах: `setVideoSource: blocked during stream setup — UvcVideoSource` появляется
- [ ] В логах: нет `USB disconnected` между `startStream()` и `RTMP connected`

---

### Итерация 4 (2026-06-28, конец сессии)

**Анализ лога теста 08:49 (сборка 08:48) выявил race condition двойного закрытия камеры:**

```
08:49:01.771  onConnectionSuccess: re-binding UvcVideoSource to GL encoder surface
08:49:01.771  USB camera closed (UvcVideoSource.stop)   ← stop()
08:49:01.771  USB camera closed (UvcVideoSource.stop)   ← release() = stop() ОПЯТЬ!
08:49:01.774  USB camera opened via GL SurfaceTexture    ← start()
08:49:01.774  camera re-bound — encoder should now receive frames
08:49:01.863  Camera closed (AUSBC hardware reconnect)
08:49:01.863  Camera opened
08:49:01.864  Camera closed AGAIN  ← async второй release() прилетел ПОСЛЕ start()!
08:49:01.863  USB disconnected
08:49:16    RTMP connection failed: Error send packet, Broken pipe
```

**Корень race condition:**
`changeVideoSource(src)`, вызванный в `onConnectionSuccess()` с ТЕМ ЖЕ объектом `UvcVideoSource`
(old == new), заставляет RootEncoder вызвать `stop()` + `release()` на старом источнике.
А `UvcVideoSource.release() = stop()` → оба зовут `camera.closeCamera()`. Второй (асинхронный)
close прилетает ПОСЛЕ `start()` → камера в итоге закрыта → энкодер не получает кадры →
RTMP шлёт только аудио (~132 kbps) → YouTube рвёт через 15с.

**Три фикса итерации 4:**

```kotlin
// Fix 4.1 (RtmpStreamer.kt): УБРАН changeVideoSource re-bind из onConnectionSuccess()
// Он вызывал двойной stop()/release() → камера закрывалась после start().
// AUSBC сам возобновляет запись в исходную GL SurfaceTexture после своего hardware-цикла.
override fun onConnectionSuccess() {
    _state.value = StreamState.Live()
    isStreamSetupInProgress = false
    // re-bind убран — см. комментарий в коде
}

// Fix 4.2 (RtmpStreamer.kt): добавлен лог в onNewBitrate для диагностики
// audio-only (~132 kbps) vs полное видео (2000-6000 kbps)
override fun onNewBitrate(bitrate: Long) {
    KLog.d(TAG, "onNewBitrate: ${bitrate / 1000} kbps (${bitrate} bps)")
    ...
}

// Fix 4.3 (MainScreen.kt): streamState.isActive добавлен вторым ключом LaunchedEffect.
// Это фиксит ЧЁРНЫЙ ЭКРАН после стрима ("опять нет видео с камеры"):
// когда стрим останавливается (isActive true→false), эффект ре-ранится и зовёт
// setVideoSource() снова, даже если объект камеры не менялся → превью переподключается.
LaunchedEffect(usbState.activeCamera, streamState.isActive) { ... }

// Fix 4.4 (FloatingRadialMenu.kt): лейбл-пилюля кнопок Menu/Go Live теперь .clickable
// Раньше кликабельна была только иконка SmallFloatingActionButton, текст — нет.
Surface(modifier = Modifier.padding(end = 10.dp).clickable { action.onClick(); expanded = false })
```

**ВАЖНО:** билд НЕ собирался и НЕ тестировался в этой сессии. Это первое, что нужно сделать дальше.

**Открытый вопрос для следующей сессии:**
Гипотеза Fix 4.1 — что AUSBC сам возобновляет запись кадров в GL SurfaceTexture после своего
hardware reconnect — НЕ ПРОВЕРЕНА. Если после удаления re-bind видео всё равно не идёт
(`onNewBitrate` ~132 kbps), значит SurfaceTexture теряется и нужен ДРУГОЙ способ re-bind:
- Вариант A: создать НОВЫЙ объект `UvcVideoSource` для re-bind (избежать double-close, т.к. old != new)
- Вариант B: убрать `release() = stop()` из `UvcVideoSource` (release должен освобождать, а не stop)
- Вариант C: вызвать `camera.openCamera(surfaceTexture)` напрямую с GL SurfaceTexture без changeVideoSource

---

### Итерация 5 (2026-06-28, 12:00 — сборка + тест на устройстве) ✅ частично

**Собрал билд с фиксами итерации 4, протестировал на устройстве. Краш + чёрный экран исправлены.**

**Новый краш найден при навигации Main→Settings:**
```
12:03:00.339  FATAL EXCEPTION: pool-5-thread-1
  java.lang.RuntimeException: drawScreen end. GL error: 1285   ← GL_OUT_OF_MEMORY
    at ScreenRender.draw(ScreenRender.java:156)
    at ScreenRender.drawPreview(ScreenRender.java:128)
    at MainRender.drawScreenPreview(MainRender.kt:78)
    at GlStreamInterface.onFrameAvailable(GlStreamInterface.kt:230)
```
**Причина:** при уходе с MainScreen TextureView уничтожается, но `onSurfaceTextureDestroyed`
просто возвращал `true` — GL render-поток RootEncoder продолжал рисовать в уже мёртвый
preview surface → GL_OUT_OF_MEMORY → краш.

**Fix 5.1 (UvcPreviewView.kt + MainScreen.kt):** проброшен колбэк `onSurfaceDestroyed`
→ вызывает `streamViewModel.stopPreview()` ДО освобождения surface. GL-поток останавливается.
Безопасно во время стрима: `stopPreview()` = no-op при `isOnPreview=false`.
**Результат: ✅ навигация Main↔Settings без краша (проверено).**

**Чёрный экран при возврате из Settings — найдена ТА ЖЕ корневая причина, что и Broken Pipe:**
```
12:03:16.879  USB camera opened (open #1, из startPreview)
12:03:16.898  UVC connected: EMEET Piko+          ← AUSBC PreviewStarted событие
12:03:16.900  VideoSource set → USB camera opened (open #2, из LaunchedEffect→setVideoSource)
12:03:16.936  ERROR: open camera failed result=-99 / unsupported preview size  ← шторм!
```
**Причина (ПОДТВЕРЖДЁННЫЙ КОРЕНЬ ВСЕГО БАГА):** открытие камеры порождает событие AUSBC
`PreviewStarted` → `activeCamera` меняется → `LaunchedEffect(activeCamera)` → `setVideoSource()`
→ `changeVideoSource()` → камера закрывается и переоткрывается → быстрое переоткрытие падает
с `result=-99` → чёрный экран. Это петля обратной связи: открытие камеры запускает второе открытие.

**Fix 5.2 (RtmpStreamer.setVideoSource):** разорвана петля — `setVideoSource()` пропускается,
если камера уже открыта и превью работает (`currentVideoSource != null && isOnPreview`).
Первое подключение (currentVideoSource==null) и очистка (NoVideoSource) проходят нормально.
```kotlin
val isRealSource = source !is NoVideoSource
if (isRealSource && currentVideoSource != null && rtmpStream?.isOnPreview == true) {
    KLog.d(TAG, "setVideoSource: skipped — camera already attached & preview running (avoid AUSBC storm)")
    return
}
```
**Результат: ✅ возврат из Settings — превью восстанавливается, одно открытие камеры,
в логах `setVideoSource: skipped`, нет `result=-99` (проверено).**

**ВАЖНАЯ ГИПОТЕЗА для Go Live:** Fix 5.2 разрывает ту же петлю AUSBC-шторма, которая,
предположительно, рвёт видео в Go Live (камера переоткрывается → энкодер теряет кадры →
audio-only → Broken Pipe). Есть шанс, что Go Live теперь тоже отдаёт видео.
**Требуется тест с включённым YouTube (Криник проверяет вручную).**

**Проверено в итерации 5:**
- [x] Баг C (краш) — навигация Main↔Settings без краша
- [x] Баг D (чёрный экран превью) — превью восстанавливается после Settings
- [x] Баг E (тап по тексту) — тап по тексту "Settings" открыл экран (Fix 4.4 работает)
- [ ] Баг A (искажение) — нужен тест Go Live с YouTube
- [ ] Баг B (Broken Pipe) — нужен тест Go Live с YouTube + проверка `onNewBitrate` (2000+ kbps = видео идёт)

---

## Если Fix 3 не поможет — следующие шаги

1. **GL_OUT_OF_MEMORY**: снизить битрейт до 2Mbps или разрешение до 1280x720
2. **Broken pipe от YouTube**: проверить keyframe interval — YouTube требует ~2сек GOP. Добавить `stream.prepareVideo(..., iFrameInterval = 2)`
3. **startPreview() during streaming**: если TextureView не отображает превью после Fix 3, нужно отдельно разобраться с API `GlStreamInterface.addPreview()`
