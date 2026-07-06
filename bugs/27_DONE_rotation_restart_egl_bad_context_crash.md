# Bug 27 — Краш (SIGABRT / EGL_BAD_CONTEXT) на смене поворота портрет↔пейзаж (живой девайс)

**Статус:** 🔴 ОТКРЫТ — воспроизведён на живом устройстве Криника (2026-07-06 утро), 2K USB-камера
активна, экран включён.
**Версия:** debug 0.5 (32), Phase 3 (композитор = дефолт).
**Связь:** тот же КЛАСС, что bug 20/23 (системный RenderThread EGL-краш при пересборке поверхности).
Phase 3 закрыл ветку `when(activeSource)`, но НЕ путь смены поворота.

## Симптом / репро

1. Приложение открыто, реальная камера (2K USB) кормит превью, экран ВКЛючён (HWUI активно рисует).
2. Сменить глобальный поворот через портрет↔пейзаж: `ui.mjs cmd set-rotation 90` (из 0).
3. **Приложение падает** (нативный SIGABRT), процесс умирает, видно домашний экран.

Ночью НЕ всплывало: экран спал/был выключен → HWUI не рисовал TextureView → гонки не было.
На живом экране с активной отрисовкой — падает.

## Форензика (logcat -b crash, 09:36:58, uptime 141s)

```
F libc  : Fatal signal 6 (SIGABRT) in tid RenderThread, pid niks.kcam.debug
F DEBUG : Abort message: 'Failed to make current on surface 0x0, error=EGL_BAD_CONTEXT'
#04 libhwui EglManager::makeCurrent(void*, int*, bool)
#05 libhwui EglManager::destroySurface(void*)
#06 libhwui SkiaOpenGLPipeline::setSurface(ANativeWindow*, SwapBehavior)
#07 libhwui CanvasContext::setupPipelineSurface()
#08 libhwui CanvasContext::setSurface(ANativeWindow*, bool)
#10 libhwui RenderThread::threadLoop()
```

Краш — на СИСТЕМНОМ RenderThread (HWUI/Compose), при `setSurface`/`destroySurface` поверхности
TextureView. `EGL_BAD_CONTEXT` при make-current на surface 0x0.

## Root cause (гипотеза)

Смена поворота портрет↔пейзаж требует ДРУГОГО размера холста энкодера (1920×1080 ↔ 1080×1920), из-за
чего `setVideoRotation` дёргает `startPreview` → `stream.stopPreview()` + `setEncoderSize` +
`stream.startPreview(tv)`. Это пере-подцепляет RootEncoder GL к SurfaceTexture того же TextureView,
которым ОДНОВРЕМЕННО владеет системный HWUI RenderThread (Compose AndroidView). Гонка «кто держит
EGL-контекст поверхности» → HWUI делает make-current на уже разрушенной/невалидной поверхности →
`EGL_BAD_CONTEXT` → abort.

Матрица-only переходы (0↔180, 90↔270) НЕ рестартят превью → НЕ падают (проверено). Падает только
портрет↔пейзаж (там нужен новый размер холста → рестарт).

## План фикса

Совпадает с REFINEMENT §7 плана `plans/02` — **устранить пересборку поверхности превью на смене
поворота**. Варианты:
- (A) Не трогать поверхность TextureView при рестарте: менять размер холста энкодера БЕЗ
  `stopPreview`/`startPreview` на том же TextureView (если RootEncoder API позволяет resize без
  reattach), ИЛИ отвязать превью на время резайза аккуратно (без гонки с HWUI).
- (B) Держать холст ПРЕВЬЮ фиксированным (1920×1080), поворот в превью — только матрицей композитора
  (портрет = pillarbox), а портретный размер энкодера ставить лишь на go-live. Тогда смена поворота в
  превью НИКОГДА не рестартит поверхность → крашу неоткуда взяться. Минус: превью портрета мельче.
- (C) Синхронизация: гарантировать, что HWUI не рисует TextureView в момент reattach (сложно — HWUI
  системный).

Рекомендация: (B) — самый надёжный против краша (превью-поверхность вообще не пересобирается на
повороте), WYSIWYG-точность превью портрета приносим в жертву стабильности. Обсудить с Криником
(UX-развилка: точное превью портрета vs. нулевой риск краша).

---

## ✅ ФИКС ПРИМЕНЁН (2026-07-06)

`setVideoRotation` для перехода портрет↔пейзаж больше **НЕ зовёт** `startPreview`
(stopPreview/startPreview на TextureView). Вместо этого — новый `resizeCanvasInPreview()`: меняет
размер GL-холста (`setEncoderSize`) + `setIsPortrait` + `setCanvasRotation` + перезапускает ТОЛЬКО
источник-композитор (`changeVideoSource`), НЕ трогая поверхность превью. Поверхность TextureView не
пересобирается → нет гонки с системным HWUI RenderThread → **нет EGL_BAD_CONTEXT-краша**.

**Проверено на живом устройстве Криника (2K USB, экран вкл):** `set-rotation 90` (та самая транзиция,
что роняла) + стресс-цикл 0↔90 ×5 — приложение ЖИВО, crash-буфер пуст. ✅

**Остаток (НЕ этот баг):** переход портрет↔пейзаж перезапускает композитор → камера-слой кратко
переоткрывается (чёрный кадр во время ренеготиации). На быстрой камере — миг; на флаки noname
2K-камере после многих быстрых циклов застревает в чёрном (это bug 25 — её медленная негоциация, не
краш). Полное устранение (композитор live-resize без переоткрытия камеры) — REFINEMENT §7 plans/02
(candidate A), аккуратная задача.

## ✅ СТАТУС: DONE (2026-07-06)
Починено: смена размера холста на повороте больше НЕ пересобирает поверхность превью (resizeCanvasInPreview) → гонки с HWUI нет. Проверено стресс-циклом поворота.
