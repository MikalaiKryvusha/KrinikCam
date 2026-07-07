# Bug 31 — Краш HWUI «no surface» при свитче источника UVC→virtual

## ✅ FIXED (2026-07-07, офис) — пересоздание SurfaceTexture слоя при смене типа продюсера

**Фикс:** при смене ТИПА видео-продюсера камера-слой получает СВЕЖУЮ SurfaceTexture.
`CompositorVideoSource.recreateCameraSurface()` (на GL-потоке: release старой ST + OES-тек → новая
OES-тек + ST → `onCameraSurfaceReady(new)`). `RtmpStreamer.setCameraOpener` отслеживает `lastOpenedKind`
(класс opener) и на смене типа зовёт recreate вместо open-в-ту-же-поверхность; reopen идёт из колбэка
`onCameraLayerSurfaceReady`. None не трогает `lastOpenedKind` → тип помнится через None.

**Почему так:** корень — нативный AUSBC (UVC) оставляет BufferQueue ОБЩЕЙ SurfaceTexture в состоянии,
несовместимом с последующим HWUI `lockHardwareCanvas` (виртуалка). Свежая поверхность рвёт связь со
старым продюсером — грубо, но надёжно (указание Криника: «надёжно, не обязательно красиво/идеально»).

**Верифицировано на живом железе (2K-лимон + встроенные):**
- `uvc↔virtual` — **12 циклов чисто** (было: краш на 1-2 цикле);
- `uvc↔none→virtual→none` — 5 циклов чисто (edge через none закрыт);
- регресс `uvc↔front`, `virtual↔front` — чисто; UVC после свитча реально пере-негоциирует
  (PreviewStarted 640×360) и рисует живой кадр (скрин 12:12, не чёрное).

Доп. фикс по ходу: `UvcCameraOpener.close()` отменяет «висячий» reopen-Thread Фазы-2 (bug 25) — иначе
он просыпался после close и переоткрывал камеру в чужую поверхность (латентный баг).

**Статус:** ✅ FIXED — verified инъекцией стресс-циклов на живом устройстве.

---

_Исходный репорт (для истории):_


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

## Сужение масштаба + попытки фикса (2026-07-07, офис) — ⬇️ ПОНИЖЕН ДО DEBUG-ONLY

Матрица свитчей (стресс-циклы на живом 2K + встроенных камерах):

| Свитч | Результат |
|---|---|
| **uvc ↔ front** (обе реальные камеры) | ✅ чисто (8 циклов) |
| **virtual ↔ front** | ✅ чисто (6 циклов) |
| **uvc ↔ virtual** | ❌ краш (1-2 цикл) |

**Падает ТОЛЬКО прямой UVC-вебка ↔ виртуальная дебаг-камера.** Уникальное: виртуалка — **HWUI-продюсер**
(`lockHardwareCanvas`), UVC — **нативный AUSBC-продюсер**; их конфликт на ОБЩЕЙ SurfaceTexture слоя. Как
только AUSBC подключился к BufferQueue поверхности, последующий HWUI-рендер виртуалки на ней рвётся
(«no surface»). `virtual↔front(Camera2)` и `uvc↔front` — оба нативные/смешанные — чисты. **Реальные
пользователи НЕ затронуты**: виртуалка = dev-инструмент (Idea 09, дебаг-билд); все свитчи между
настоящими камерами (uvc↔front↔rear) безопасны.

**Проверенные и НЕ сработавшие фиксы (правило 3 попыток исчерпано):**
1. Guard в `VirtualCameraOpener` (замок draw↔close, join draw-потока, `Surface.isValid`) — не помог (откачено).
2. Отмена «висячего» reopen-Thread у `UvcCameraOpener` в close() — **оставлено** (реальный латентный
   фикс: иначе Фаза-2 reopen просыпалась после close), но саму гонку не лечит.
3. Settle-задержка 250мс между close/open в `setCameraOpener` — сдвинула краш с 1-го цикла на 2-й, не убрала (откачено).
4. **Гард-прокладка через `none`** (`uvc→none→virtual`) — ПРОВЕРЕНО, тоже падает на 2-м цикле. Значит
   `none` не сбрасывает producer-state BufferQueue. Гард не реализован (не работает).

**Вывод (указание Криника 2026-07-07):** частые горячие camera↔virtual — редкость, до идеала не
доводить. Корень = AUSBC↔HWUI lifecycle-гонка на общем BufferQueue, устойчива к простым патчам; чинить
по-настоящему = отдельная поверхность/продюсер под виртуалку ИЛИ явный disconnect нативного продюсера
(тема для /bug-research, если понадобится). Пока НЕ инвестируем — production-путь безопасен.

## Статус
✅ **FIXED** (2026-07-07) — пересоздание SurfaceTexture слоя на смене типа продюсера (см. секцию FIXED
вверху). Verified стресс-циклами на живом железе. Ранее сужали до debug-only, но по указанию Криника
(«починить надёжно») сделан полноценный фикс. Смежное: bug 27 (HWUI/EGL гонка), bug 25/28 (2K-вебка).
