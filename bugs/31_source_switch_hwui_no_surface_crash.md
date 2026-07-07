# Bug 31 — Краш HWUI «no surface» при свитче источника UVC→virtual

> Заведён: 2026-07-06 (агент, при тесте жестов plans/03). Устройство: Titan 1 @ 192.168.1.3,
> сборка `com.kriniks.kcam.debug` 0.5(40). Камера: 2K USB Camera (воткнута).

## Симптом
При выполнении `cmd select-source virtual`, когда активным источником была УВЛ-вебка (2K USB,
активно кормила поток), приложение падает и вылетает на домашний экран.

## Краш (logcat -b crash)
```
signal 6 (SIGABRT) ... name: RenderThread >>> com.kriniks.kcam.debug <<<
Abort message: 'drawRenderNode called on a context with no surface!'
  #04 libhwui.so android::uirenderer::skiapipeline::SkiaOpenGLPipeline::getFrame()
  #05 libhwui.so CanvasContext::draw(bool)
  #07 libhwui.so RenderThread::threadLoop()
```
Это НЕ AUSBC-краш (bug 28). Это системный HWUI RenderThread: рисование в поверхность окна, которой
уже нет. Семейство bug 27 (EGL_BAD_CONTEXT на повороте) — гонка «поверхность исчезла ↔ HWUI рисует».

## Гипотезы (проверить)
1. Свитч opener (UVC→virtual) закрывает камеру/пересобирает GL, и в этот момент окно/превью-TextureView
   на миг остаётся без surface, а HWUI постит кадр → abort. Возможно, close UVC (AUSBC) роняет surface
   окна или дёргает реинит превью.
2. Триггерится именно при АКТИВНОЙ 2K-вебке (её негоциация/закрытие проблемные — bug 25/28). На чистом
   старте virtual/none свитчи проходили без краша (см. STATUS 2026-07-06 вечер, f_none/f_virtual OK).
3. Возможна связь с быстрым `set-transform`/оверлеем прямо перед свитчем (гонка перерисовки).

## Как воспроизвести
1. Старт с воткнутой 2K USB-вебкой (активный источник UVC).
2. `node tools/ui.mjs cmd select-source virtual`.
3. Наблюдать вылет на домашний экран; `adb logcat -b crash` → сообщение выше.

## Заметки к фиксу
- Смотреть путь смены `CameraOpener` (setCameraOpener → close old opener) и реинит превью-поверхности в
  `RtmpStreamer`/`CompositorVideoSource` при активном UVC. Возможно, нужно НЕ трогать поверхность окна
  при смене источника (как в фиксе bug 27 `resizeCanvasInPreview` — менять содержимое, не поверхность).
- Не блокер для жестов слоёв (plans/03): там источник не свитчится. Отдельная задача.

## Расследование (2026-07-07, офис, живой 2K-лимон)

**Воспроизведён надёжно** серией быстрых свитчей `uvc↔virtual` (2с интервал) — падает на 1-2 цикле.
Стек полностью нативный HWUI, без кадров приложения:
```
SkiaOpenGLPipeline::getFrame()  ← 'drawRenderNode called on a context with no surface!'
CanvasContext::draw → DrawFrameTask::postAndWait → RenderThread::threadLoop
```
Общий RenderThread приложения. Кадров Compose/наших нет → рисование в abandoned-поверхность.

**Две подозреваемые гонки (по коду):**
1. **`VirtualCameraOpener.lockHardwareCanvas`** (drawOnce, HandlerThread 30fps) рисует в `Surface(layerSurfaceTexture)` через ХАРДВАРНЫЙ канвас = использует общий HWUI RenderThread. При свитче композитор/close рвут слой-SurfaceTexture под ним → getFrame() без surface → abort. Наиболее вероятный корень.
2. **Лишний reopen-Thread у `UvcCameraOpener`**: фоновый Thread (sleep 1.5с, Фаза-2 bug 25) НЕ отменяется в `close()`. При быстром свитче просыпается ПОСЛЕ close и переоткрывает камеру в уже отданную/рвущуюся поверхность. Латентный баг независимо от bug 31.
3. `setCameraOpener` гоняет `old.close()`+`open()` на **главном потоке** (`Dispatchers.Main.immediate`) — тяжёлый нативный AUSBC-close 2K на UI-потоке = стопор/гонка перерисовки.

**Направление фикса:** (а) в `VirtualCameraOpener.drawOnce` — guard: не рисовать, если surface невалиден/после close; ловить `Surface.OutOfResourcesException`/проверять `surface.isValid`. (б) отменять reopen-Thread в `UvcCameraOpener.close()`. (в) при свопе opener'а — атомарно останавливать старый producer до отдачи поверхности новому.

## Статус
🔴 ОТКРЫТ — воспроизведён, гипотезы сузаны (выше). Приоритет: средний (свитч источника — базовый
сценарий выбора источника, plans/05). Смежное: bug 27 (HWUI/EGL гонка поверхности), bug 25/28 (2K-вебка).
