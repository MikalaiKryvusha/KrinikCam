# Phase 2 P2 — "Please stand by" кадр в RTMP-поток

> Статус: **✅ РАБОТАЕТ — подтверждено на устройстве 2026-06-28 (Криник видел заглушку на YouTube)**
> Дата: 2026-06-28

## ✅ Результат живого теста (2026-06-28)

Два полных цикла отключения/подключения USB-камеры во время стрима на YouTube — оба успешны:

```
13:31:33 DeviceDetached → Entered standby → Standby source drawing 1920x1080 @ 5fps
         (22 секунды в standby — заглушка видна на YouTube, поток НЕ оборвался)
13:31:55 Exited standby — live camera restored
13:32:59 DeviceDetached → Entered standby (цикл 2)
13:33:05 Exited standby — live camera restored
```

- **Главный риск снят:** `lockCanvas` на GL-привязанной SurfaceTexture работает — 0 ошибок
  отрисовки, 0 GL-ошибок, кадры дошли до энкодера (Криник подтвердил заглушку на YouTube).
- **Битрейт во время standby:** ~130-143 kbps. Это НОРМА: статичный кадр @ 5fps после keyframe
  сжимается почти в ноль (≈ только аудио 128 kbps + крошечная видео-дельта). Первый сэмпл после
  отключения — 543 kbps (burst keyframe со снимком заглушки), затем спад. Поток прожил 22 с
  (намного дольше 15-с порога Broken Pipe из Бага 02) и чисто восстановился до ~5 Mbps.
- **Никаких `Broken pipe`, `FATAL`, GL crash.**

---

## Задача

Когда USB-камера отключается **во время активного стрима**, в RTMP-поток должен инжектироваться
статичный кадр «Please stand by», чтобы поток на YouTube не оборвался. Без этого энкодер
перестаёт получать кадры → YouTube роняет соединение через ~15 с (`Broken Pipe`).

## Почему это нетривиально

RootEncoder 2.4.7 **не имеет** готового bitmap-источника видео. Доступны только:
`Camera1Source`, `Camera2Source`, `ScreenSource`, `VideoFileSource`, `NoVideoSource`.

Фильтр (`ImageObjectFilterRender` и т.п.) **не решает проблему**: GL render loop в
`GlStreamInterface` управляется коллбэком `onFrameAvailable` от SurfaceTexture камеры. Когда
камера отвалилась — кадры не приходят, loop не тикает, фильтр не на чем рисовать. Нужен
**источник, который сам активно толкает кадры**.

## Архитектура решения

```
Камера отвалилась (usbState.activeCamera → null) при streaming
  → MainScreen LaunchedEffect → StreamViewModel.enterStandby()
    → StreamingRepository.enterStandby()
      → RtmpStreamer.enterStandby()
        → stream.changeVideoSource(StandbyVideoSource(bitmap))
           (changeVideoSource: stop+release мёртвого UvcVideoSource,
            init нового источника размерами энкодера,
            start() на ЖИВОЙ GL SurfaceTexture энкодера)
          → StandbyVideoSource рисует bitmap в Surface через lockCanvas @ 5 fps
            → onFrameAvailable → GL → энкодер → RTMP остаётся живым

Камера вернулась (activeCamera снова != null) при streaming
  → StreamViewModel.exitStandby(uvcSource)
    → RtmpStreamer.exitStandby() → changeVideoSource(новый UvcVideoSource)
```

### Ключевой механизм — `StreamBase.changeVideoSource(new)` (проверено через javap)

1. `wasRunning = oldSource.isRunning()`
2. если `oldSource.created`: `new.init(encoderW, encoderH, fps, rotation)` — размеры берутся
   из **видеоэнкодера** (т.е. при стриме это 1920×1080 — то что надо)
3. `oldSource.stop()` + `oldSource.release()`
4. если `wasRunning`: `new.start(glInterface.getSurfaceTexture())` — на **живой** GL-поверхности
5. `videoSource = new`

Это ровно то, что нужно для горячей подмены источника без остановки энкодера.

## Файлы

| Файл | Что |
|------|-----|
| `feature/streaming/.../rtmp/StandbyFrameRenderer.kt` | **NEW** — рисует bitmap 1920×1080 (тёмный фон, "KrinikCam" acid pink, мультиязычные строки) — дизайн как у Compose `StandbyPlaceholder` |
| `feature/streaming/.../rtmp/StandbyVideoSource.kt` | **NEW** — `VideoSource`, рисует bitmap в GL Surface через `lockCanvas`/`unlockCanvasAndPost` на `HandlerThread` @ 5 fps |
| `feature/streaming/.../rtmp/RtmpStreamer.kt` | `enterStandby()` / `exitStandby(source)`, флаг `inStandby`, сброс в `stopStream()`/`onConnectionFailed()` |
| `feature/streaming/.../domain/StreamingRepository.kt` | проброс enter/exit |
| `feature/streaming/.../ui/StreamViewModel.kt` | проброс enter/exit |
| `app/.../ui/screens/MainScreen.kt` | `LaunchedEffect(activeCamera, isActive)`: камера null + стрим → enterStandby; камера есть + стрим → exitStandby |

### Почему `StandbyVideoSource` в `:feature:streaming`, а не в `:app`

`UvcVideoSource` живёт в `:app`, потому что ему нужен `MultiCameraClient` (AUSBC). Standby-источнику
не нужно ничего из `:app` — только `VideoSource` (библиотека) + Android `Surface`/`Bitmap`. Поэтому
он полностью внутри `:feature:streaming`, а `:app`-glue остаётся тонким (просто enter/exit).

## Защита от гонок

- `inStandby` — двойной `enterStandby` / `exitStandby` = no-op (LaunchedEffect может пере-сработать).
- `enterStandby` срабатывает только при `stream.isStreaming` (не во время Connecting).
- `exitStandby` при `!inStandby` делегирует в `setVideoSource` (который заблокирован гардом во время
  стрима — сохраняет существующее поведение).
- `inStandby` сбрасывается в `stopStream()` и `onConnectionFailed()` — новый стрим всегда стартует
  из чистого состояния.

## РИСК / что проверить на устройстве

**Главный риск:** `Surface.lockCanvas()` на SurfaceTexture, привязанной к GL-консьюмеру. Технически
это валидный software-producer для BufferQueue (так делают многие), но надо подтвердить на железе,
что кадры реально доходят до энкодера. Если `lockCanvas` падает — энкодер всё равно голодает.

## План живого теста (нужны руки Криника)

1. Подключить USB-камеру, дождаться превью.
2. Настроить профиль с валидным YouTube stream key (Platforms overlay).
3. Go Live → убедиться что стрим идёт (LIVE badge, битрейт ~5 Mbps, картинка на YouTube).
4. **Физически выдернуть USB-камеру.**
5. Ожидаемо: на устройстве — Compose StandbyPlaceholder; на YouTube — кадр «Please stand by»,
   поток НЕ обрывается, битрейт держится (низкий, ~5 fps статики — это норма).
6. **Вставить камеру обратно**, выдать USB permission.
7. Ожидаемо: на YouTube живая картинка с камеры возвращается, поток ни разу не прервался.

### Что смотреть в логах (`node tools/adb.mjs logcat`)

- `RtmpStreamer: Entered standby — placeholder frame now feeding the stream`
- `StandbyVideoSource: Standby source started — drawing 1920x1080 ...`
- `onNewBitrate` продолжает тикать (не падает в ноль) → поток жив
- `RtmpStreamer: Exited standby — live camera restored`
- НЕ должно быть: `onConnectionFailed: ... Broken pipe`
