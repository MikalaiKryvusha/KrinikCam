# Bug 20 — Краш (SIGABRT) при отрыве источника в ПРЕВЬЮ: EGL_BAD_ALLOC → «context with no surface»

**Статус:** 🔴 ОТКРЫТ — пред-существующий, воспроизведён детерминированно на харнесе (dayloop 2026-06-30).
**Версия:** debug `0.5 (16)`.

## Симптом / репро (детерминированно, БЕЗ записи и БЕЗ стрима)

1. Запуск приложения, `ui.mjs cmd virtual-camera on` → виртуалка в превью.
2. Отрыв источника: `adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state off -p <pkg>`
   (deviceManager → `activeVideoSource = None`).
3. **Приложение падает** (нативный SIGABRT), процесс умирает.

То же происходит, если отрыв во время ЗАПИСИ (harness record) — поэтому **этот краш блокирует проверку
Idea 17** (чистая финализация файла при отрыве камеры: процесс умирает до/во время финализации).

## Форензика (logcat -b crash + system)

```
E libEGL  : eglCreateWindowSurfaceTmpl:702 error 3003 (EGL_BAD_ALLOC)
F DEBUG   : Abort message: 'drawRenderNode called on a context with no surface!'
#04 libhwui.so android::uirenderer::skiapipeline::SkiaOpenGLPipeline::getFrame()+48
#05 libhwui.so CanvasContext::draw(bool)
#07 libhwui.so RenderThread::threadLoop()
```

Краш — на СИСТЕМНОМ RenderThread (HWUI/Compose-отрисовка), не на нашем GL-потоке. При исчезновении
источника `MainScreen` `when(activeSource)` переключается с ветки превью (`UvcPreviewView` + TextureView,
аппаратный SurfaceView/GL) на `VideoSource.None` → `StandbyPlaceholder`. В переходный момент система
пытается создать EGL window surface и получает `EGL_BAD_ALLOC` (нехватка/конфликт графической памяти
или surface used-after-destroy) → следующий `getFrame()` рисует в контекст без поверхности → abort.

## Гипотезы причины (для будущего фикса — НЕ латать вслепую)

1. **Утечка/неосвобождение EGL-поверхностей нашего пайплайна** при отрыве источника: наш preview-GL
   (RootEncoder `GlStreamInterface`) и/или компоновщик держат surface/контексты, и резкий снос TextureView
   + подъём `StandbyPlaceholder` в тот же кадр исчерпывает графические ресурсы для системного UI-surface.
2. **Двойной surface в переходный момент**: старый preview-TextureView ещё не уничтожен, а новый
   Compose-узел уже запрашивает аппаратную поверхность → EGL не может аллоцировать.
3. В `MainScreen` УЖЕ есть обход для случая СТРИМА (комментарий: «Compose-StandbyPlaceholder на весь
   экран рушит TextureView и прячет слои» → во время стрима превью ЗЕРКАЛИТ композит, а не показывает
   StandbyPlaceholder). Тот же механизм рушит и в превью-only при `Virtual/UvcCamera/PhoneCamera → None`.

## Возможное направление (план, не реализовано)

- Не сносить `UvcPreviewView`/TextureView резко при `→ None`: оставлять GL-превью и рисовать в нём
  чёрный/standby-кадр (как при стриме «зеркалит композит»), а `StandbyPlaceholder` показывать ПОВЕРХ
  Compose-слоем, не вместо TextureView. Тогда нет сноса/пересоздания аппаратной поверхности.
- Либо гарантировать освобождение EGL-поверхностей превью ДО подъёма StandbyPlaceholder (порядок).
- Проверить, нет ли утечки surface (несколько EGL window surface на один TextureView).
- Воспроизводить и мерить через харнесс (`SET_VIRTUAL_CAM off`), это детерминированно.

## Связь
- Блокирует сквозную проверку **Idea 17** (финализация файла при отрыве во время записи).
- Похожий по духу на bug 13 (краш при отрыве USB), но ДРУГОЙ слой: там JVM `SecurityException` в либе
  AUSBC (исправлен), здесь — системный HWUI/EGL на UI-render-потоке при смене превью-узла.

## ✅ КЛЮЧЕВАЯ НАХОДКА (dayloop 2026-06-30): краш ТОЛЬКО в deprecated не-композиторном пути

Прямое сравнение на харнесе (тот же отрыв `SET_VIRTUAL_CAM off` в превью):
- **НЕ-композитор (default, старый SurfaceFilterRender-путь): КРАШ** (SIGABRT, как выше).
- **Композитор (`cmd compositor on`, Idea 25): приложение ВЫЖИВАЕТ** (pid жив, краша нет).

Значит bug 20 — артефакт старого пути (несколько EGL-поверхностей: preview-GL RootEncoder + камера-слой
`SurfaceFilterRender` + churn TextureView). У композитора свой EGL-контекст владеет всем композитом и
рисует в поверхность энкодера; снос превью-TextureView не рушит систему. **Этот баг закроется сам с
переводом композитора в дефолт (Idea 25 шаг 5, ждёт interview_006 + сверки портрета/USB Криником)** —
как и bugs 15/18. Оставляю ОТКРЫТЫМ (в дефолтном билде краш ещё воспроизводится), но фикс = шаг 5, не
точечная правка хрупкого старого пути.

## Заметка: standby-on-drop (enterStandby) сейчас ОРФАН
По ходу выяснено: `RtmpStreamer.enterStandby()` (подмена источника на freeze/standby при отрыве,
interview_004) НИКТО не вызывает — проводка отвалилась при рефакторе на слои (Idea 21/25). В модели
слоёв заглушка = особый fallback-СЛОЙ (Idea 19 Q4), а не подмена базового источника. Поэтому в
композиторе запись/стрим переживают отрыв БЕЗ подмены (база-compositorSource не меняется) — см. idea 17.

## ✅ СТАТУС: DONE (2026-07-18, ночная ревизия беклога)
Что сделано: закрыт архитектурно Phase 3 (композитор = единственный пайплайн; отрыв источника не
трогает базу — bugs/22 верификация «закрывает bug 20/23»).
Как проверено: живой репро-прогон 2026-07-18 01:28 на харнесе — запись в файл → SET_VIRTUAL_CAM off
→ 5с → on → stop: процесс жив (pid 29259), crash-буфер ПУСТ за окно репро, запись валидна и росла
сквозь отрыв (971 КБ), initGl deferred штатно восстановился. Остаточная заметка про орфан
enterStandby учтена в bug 17/Idea 21.
