# База знаний — свой GL-композитор слоёв (Idea 25)

> Ресёрч 2026-06-30 (ночь) под задачу «камера = слой, как в OBS» через собственный GL-композитор.
> Вывод: **готового drop-in OBS-композитора слоёв для Android-стриминга нет** — строим сами по
> канону Google **grafika** (GLES + MediaCodec input surface). Ниже — что нашёл и как делать.

## Что есть в существующих либах (и почему не подходит как есть)

- **RootEncoder (наш)**: поддерживает несколько ИСТОЧНИКОВ (Camera1/2, Screen, File, Bitmap, CameraX,
  CameraUvc, custom VideoSource) и **фильтры** (Image/Gif/Text/GL real-time). НО: только ОДИН базовый
  VideoSource + фильтры ПОВЕРХ. Камера-как-фильтр (`SurfaceFilterRender`) до энкодера у нас не доходила
  (bugs/18). Готового «N равноправных слоёв-источников (камера среди них)» нет.
- **StreamPack (ThibaultBee)**: современная либа (SRT/RTMP), есть **`ISurfaceProcessorInternal`** —
  кастомная обработка кадров перед энкодером, DualStreamer/StreamerPipeline (несколько выходов). Ближе к
  нашей нужде по «processor», но смена стрим-либы = большой риск/объём; пока НЕ меняем. Держим в уме как
  референс/опцию.
- **OBS**: десктоп, не Android-либа. Только концептуальный референс (сцены/слои/источники).

## Канон сборки (Google grafika) — наши строительные блоки

grafika (`google/grafika`, gles-пакет) — эталон «камера → GL → MediaCodec input surface»:
- **`EglCore`** — создаёт EGLContext/EGLDisplay; для энкодерной поверхности флаг **`FLAG_RECORDABLE`**
  (иначе MediaCodec не примет буферы).
- **`WindowSurface`** — оборачивает выходной `Surface`/`SurfaceTexture` в EGLSurface (рисуем в энкодер).
- **`Texture2dProgram`** — шейдер-программа двух типов: `TEXTURE_2D` (обычные bitmap-текстуры) и
  **`TEXTURE_EXT`** (внешние OES, `samplerExternalOES`, для кадров камеры/SurfaceTexture).
- **`FullFrameRect`** — рисует текстуру на весь кадр (квад) выбранной программой.
- **`GlUtil`** — матрицы/util.

### Ключевые факты про OES / SurfaceTexture (Android arch)
- Кадры камеры (Camera2/CameraX/UVC) и любого Surface-продюсера приходят в **`SurfaceTexture`** и
  доступны как **`GL_TEXTURE_EXTERNAL_OES`** (НЕ `TEXTURE_2D`). Нужен шейдер с
  `#extension GL_OES_EGL_image_external` и `samplerExternalOES`.
- На новый кадр: `surfaceTexture.updateTexImage()` (на GL-потоке, с текущим EGLContext) + забрать
  `getTransformMatrix()` и применить к UV (иначе поворот/зеркало/кроп неверны).
- `setOnFrameAvailableListener` → сигнал «есть новый кадр» → рендер.

## Наша архитектура (вписывание в RootEncoder без замены либы)

`CompositorVideoSource : VideoSource` (RootEncoder) — наш единственный базовый источник, который САМ
композитит сцену и отдаёт готовый кадр в SurfaceTexture энкодера. Для RootEncoder это один источник →
композит тривиально идёт и в энкодер, и в превью.

Рендер (свой поток + EglCore + WindowSurface(encoderSurfaceTexture)):
1. На кадр (по таймеру ~30fps ИЛИ по `onFrameAvailable` камеры): `makeCurrent`.
2. `glClear` чёрным (пустая база OBS).
3. Для каждого ВИДИМОГО слоя сцены СНИЗУ ВВЕРХ:
   - камера → OES-текстура: `updateTexImage`, рисуем `FullFrameRect(TEXTURE_EXT)` с transform-матрицей
     SurfaceTexture + нашей трансформой слоя (позиция/масштаб/поворот/альфа);
   - картинка → 2D-текстура (загруженный bitmap), `FullFrameRect(TEXTURE_2D)`.
4. `setPresentationTime` + `swapBuffers` → кадр уходит в энкодер (и превью).

Слой-камера удаляется/прячется = просто не рисуем её квад → видно нижние слои / чёрную базу. z-order =
порядок отрисовки. Это и есть истинный OBS-слой.

### Где взять камеру в OES
- **Camera2 / UVC (AUSBC)**: продюсер пишет в нашу `SurfaceTexture(oesTexId)`; мы её сэмплим как OES.
- **Виртуалка**: рисуем тест-паттерн в нашу `SurfaceTexture` (через её Surface, Canvas/lockHardwareCanvas)
  ИЛИ напрямую 2D-текстурой/шейдером.

## Гочи / на что заложиться
- `EglCore` для энкодерного surface — обязательно `FLAG_RECORDABLE`.
- OES шейдер ≠ 2D шейдер: нужны ДВЕ программы (TEXTURE_EXT и TEXTURE_2D).
- `updateTexImage()` строго на GL-потоке с нашим контекстом; transform-матрица обязательна.
- Один `SurfaceTexture` = один потребитель; камера-продюсер один.
- Поворот/портрет (Bug 10) — наша матрица на квадах (проще, чем борьба с RootEncoder).
- Превью: RootEncoder сам блитит базовый источник в превью → наш композит виден и там.
- Синхронизация старт/стоп слоёв со сменой источника камеры (Camera2 async open) — close-before-open.

## План реализации — см. `ideas/25_gl_compositor.md` (инкрементально, тест на харнесе+ffprobe).

## Источники
- grafika: https://github.com/google/grafika (gles: EglCore, WindowSurface, Texture2dProgram, FullFrameRect)
- Texture2dProgram.java: https://github.com/google/grafika/blob/master/app/src/main/java/com/android/grafika/gles/Texture2dProgram.java
- Android SurfaceTexture arch (OES, updateTexImage, transform): https://source.android.com/docs/core/graphics/arch-st
- Camera→MediaCodec пример: https://github.com/PhilLab/Android-MediaCodec-Examples/blob/master/CameraToMpegTest.java
- RootEncoder (custom VideoSource, фильтры): https://github.com/pedroSG94/RootEncoder/wiki
- StreamPack (SurfaceProcessor, опция-референс): https://github.com/ThibaultBee/StreamPack
