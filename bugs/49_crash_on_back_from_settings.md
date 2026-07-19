# Bug 49 — Краш при возврате из Settings на главный экран стрелкой «назад»

> Заведён: 2026-07-18 (Криник, живое тестирование). Приоритет: ВЫСОКИЙ — краш на базовой навигации.

## Симптом

Криник зашёл в Settings, нажал стрелку «назад» для возврата на главный экран → **приложение упало.**

## Репро

1. Главный экран → Settings (шестерёнка).
2. Стрелка «назад» (верхний левый угол / системная) → возврат на MainScreen.
3. Наблюдать краш.

> ⚠️ Root cause БЕЗ стектрейса не утверждать — первый шаг — снять logcat.

## Root cause — ГИПОТЕЗЫ (нужен стектрейс)

Возврат на MainScreen пересобирает превью-пайплайн: `startPreview(TextureView)` заново цепляет
поверхность, композитор/GL реинициализируются. Кандидаты:
- **Гонка пересоздания GL/поверхности** (родня bug 27/31): TextureView возвращаемого экрана
  цепляется, пока старая поверхность/EGL-контекст не убраны → EGL_BAD_* / «no surface».
- **Повторный `startMonitoring()` / двойной UsbViewModel** (bug 35 root cause №5/№6): возврат на
  экран заново инициирует USB-мониторинг без idempotency → возможен краш/утечка.
- **Compose lifecycle / Nav** — коллектор/эффект переживает диспоуз и трогает мёртвый стример.
- Возможно всплыло/усугубилось после правок 2026-07-18 (профиль кодера ничего в навигации не трогал,
  но проверить, не связан ли краш с состоянием стрима/превью).

## План фикса

1. **Снять стектрейс** краша (`adb logcat`) — класс/строка исключения, нативное это или Kotlin/Compose.
2. По стеку — точечный фикс: защитить re-attach превью при возврате (не трогать живую поверхность —
   паттерн bug 27), идемпотентность мониторинга, корректный dispose коллекторов.
3. **Приёмка:** Settings → назад → главный экран 10× подряд (в превью, в эфире, при записи) → 0
   крашей, превью живо после возврата, эфир/запись не прерваны.

## Связи

Родственно bug 27/31 (пересборка поверхности) и bug 35 (двойной мониторинг/UsbViewModel).

## 🔬 СТЕКТРЕЙС СНЯТ (2026-07-19) — нативный HWUI-abort

Краш воспроизведён (навигация Main↔Settings) и пойман:
```
F HWUI  : drawRenderNode called on a context with no surface!
F libc  : Fatal signal 6 (SIGABRT) in tid RenderThread, pid niks.kcam.debug
F DEBUG : Abort message: 'drawRenderNode called on a context with no surface!'
  #04 libhwui.so android::uirenderer::skiapipeline::SkiaOpenGLPipeline::getFrame()
  #05 libhwui.so android::uirenderer::renderthread::CanvasContext::draw(bool)
  #06 libhwui.so ...DrawFrameTask::postAndWait()
  #07 libhwui.so RenderThread::threadLoop()
```
Это НЕ Kotlin-исключение, а **abort ОКОННОГО HWUI RenderThread приложения** (не GL-поток RootEncoder):
`CanvasContext::draw` вызван, когда у окна нет валидной поверхности. Триггер — обновления
превью-**TextureView** (камера/GL шлёт кадры в его SurfaceTexture → инвалидация окна → redraw), которые
попадают в момент, когда поверхность окна отсутствует (гонка жизненного цикла при навигации). Семья
bug 27/31/48 (TextureView/EGL/HWUI). Интермиттентно: в серии из 6 циклов Main↔Settings упало 1 раз.

## ❌ Гипотеза «анимация переходов Nav» — ОПРОВЕРГНУТА (2026-07-19)

Пробовал отключить анимации Compose-Navigation (`enter/exit/popEnter/popExitTransition = None` у NavHost).
**Краш ПОВТОРИЛСЯ** (тот же abort в серии Main↔Settings). Значит причина НЕ в анимации перехода —
правка откачена. Сужает к: обновление TextureView во время смены композиции экрана (dispose/recreate
AndroidView) гонится с redraw окна.

## Кандидаты РЕАЛЬНОГО фикса (нужен focused-заход, не тривиально)

1. **Превью выше NavHost:** держать viewfinder (TextureView) в MainActivity ПОД контентом навигации,
   не диспоузить при уходе в Settings (сейчас MAIN-composable удаляется → AndroidView(TextureView)
   пересоздаётся). Живёт одна поверхность — гонки dispose/recreate нет.
2. **SurfaceView вместо TextureView:** SurfaceView рендерит в СВОЮ поверхность (не через HWUI-RenderNode
   окна) → путь «no surface» окна не задевается; каноничный выбор для превью камеры. Крупная правка
   пайплайна (RootEncoder умеет и SurfaceView).
3. **Полная остановка продюсера ДО dispose:** гарантировать, что камера/GL не шлёт кадры в мёртвую
   SurfaceTexture в окне гонки (усилить onSurfaceTextureDestroyed→stopPreview, синхронно).

## Статус
🔴 ОТКРЫТ (высокий). **Стектрейс снят, root cause сужен** (оконный HWUI-abort «no surface» от
TextureView-превью при навигации). Быстрый фикс (отключить Nav-анимации) НЕ помог. Нужен focused-заход
по одному из 3 кандидатов (превью выше NavHost / SurfaceView / синхронный stop продюсера). НЕ регрессия
эпика сцен (правки сцен — Compose-оверлеи, поверхность превью не трогают).
