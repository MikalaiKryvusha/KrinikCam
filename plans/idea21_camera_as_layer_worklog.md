# Idea 21 — Рабочий журнал: камера как обычный слой над чёрной базой

> Живой журнал переделки фундамента слоёв. Ведётся ПО ХОДУ: знания, решения, статус по шагам.
> Цель — чтобы новый сеанс ИИ-агента (пустой контекст) мог включиться мгновенно.
> Ветка разработки: **`idea-21-camera-as-layer`** (main защищён — там рабочий портретный стрим).
> Дизайн-первоисточник: `ideas/21_layers_black_base_camera_as_layer.md`.

## Правило тестирования (от Криника)

Разрабатываем и тестируем на **виртуальном стриме в ФАЙЛ** (dev-тумблер «Стрим в файл» → запись MP4),
НЕ на YouTube. Камеру можно использовать реальную (подключена). Анализ кадров — `ffprobe`/`ffmpeg`
по записанному MP4 (`/sdcard/Android/data/com.kriniks.kcam.debug/files/rec/…` → `adb pull`).
YouTube — только когда фича готова end-to-end и проверена на обвязке.

## Цель

Сейчас камера = БАЗОВЫЙ VideoSource энкодера (всегда низ, особенная). Цель: **неявная чёрная база +
ВСЕ слои (камера, картинки, …) равноправны поверх неё по z-order; камера — обычный слой**
(удаляемый/переставляемый/выключаемый). Закрывает Bug 15/16/17 естественно.

---

## ПРОВЕРЕННЫЕ ЗНАНИЯ (матчасть, декомпиляция RootEncoder/AUSBC)

- **Backend компоновки = фильтры RootEncoder.** `GlStreamInterface`: `addFilter([i,]render)`,
  `setFilter(i,render)`, `removeFilter(i|render)`, `clearFilters()`, `filtersCount()`. Порядок = z
  (фильтр поверх базового VideoSource; первый добавленный — ниже).
- **Камера как слой → `SurfaceFilterRender`** (`com.pedro.encoder.input.gl.render.filters.object`):
  - `getSurfaceTexture(): SurfaceTexture`, `getSurface(): Surface`, ctor с
    `SurfaceReadyCallback.surfaceReady(SurfaceTexture)`.
  - extends `BaseObjectFilterRender` → `setScale/ setPosition/ setRotation/ setAlpha` (трансформа +
    поворот слоя — пригодится для портрета/PiP).
- **AUSBC open в произвольную поверхность:** `MultiCameraClient.Camera.openCamera(Object, CameraRequest)`
  принимает Object (SurfaceTexture/TextureView/Surface) → камеру направляем в
  `surfaceFilterRender.getSurfaceTexture()`.
- **Картинка-слой → `ImageObjectFilterRender.setImage(Bitmap)`** (уже используется). ВАЖНО (Bug 14):
  RootEncoder РЕЦИКЛИТ переданный в setImage битмап при release/clearFilters → передавать КОПИЮ.
- **База-источник** сейчас: `UvcVideoSource`/`VirtualVideoSource`/`Standby*` (рисуют в SurfaceTexture
  энкодера). Для новой модели нужна **`BlackVideoSource`** (рисует сплошной чёрный) как постоянная база.
- **Поворот/портрет (Bug 10, ХРУПКОЕ):** сейчас `prepareVideo` со свопнутыми w/h (портрет 1080×1920)
  + `setIsPortrait(true)` + поворот ВХОДА камеры (`setCameraOrientation(deg)` для реальной, или
  RotatableSource крутит свой Canvas для виртуалки). С камерой-как-фильтром поворот надо решать иначе
  (поворот слоя через `SurfaceFilterRender.setRotation`/трансформу ИЛИ поворот входа камеры). ⚠️ Это
  главный риск — проверять портрет на записи в файл (ffprobe: размеры; глаз: круг круглый).

---

## ПЛАН ПО ШАГАМ (статус ведём здесь)

### Шаг 1 — `BlackVideoSource` (чёрная база). ⏳ В РАБОТЕ
Рисующий источник: сплошной чёрный кадр в SurfaceTexture энкодера, низкий fps (по образцу
`StandbyVideoSource`). Тест: сделать базой → запись в файл → кадр чёрный (+ оверлеи поверх работают).

### Шаг 2 — Камера как `SurfaceFilterRender`-слой (ЛАНДШАФТ). ⏳ В РАБОТЕ (дизайн зафиксирован)

**Находка (байткод):** фильтры идут через `filterQueue` (`FilterAction` ADD/ADD_INDEX/SET_INDEX/
REMOVE/REMOVE_INDEX/CLEAR), обработка на GL-потоке. ⚠️ `clearFilters` каждый apply НЕЛЬЗЯ — пересоздаст
камеру-`SurfaceFilterRender` → её `surfaceReady` снова → переоткрытие камеры (шторм/мерцание). Нужен
ИНКРЕМЕНТАЛЬНЫЙ компоновщик со стабильным инстансом камеры-фильтра. (Открытый вопрос: re-init ли
`SurfaceFilterRender` при REMOVE/SET_INDEX — выяснить эмпирически по логам surfaceReady.)

**Дизайн (зафиксирован):**
- `SceneCompositor` → СТЕЙТФУЛ-класс (инстанс в `RtmpStreamer`), хранит фильтры по id слоя:
  `imageFilters: Map<id, ImageObjectFilterRender>`, `cameraFilter: SurfaceFilterRender?`.
- apply(scene): диффим текущий стек → желаемый (видимые слои bottom→top). Картинки add/remove/reorder
  свободно (дёшево). Камеру-фильтр НЕ трогаем, если её присутствие не изменилось (только overlay-changes
  → камеру не переоткрываем). Первый милстоун: камера ВНИЗУ (index 0), оверлеи поверх; произвольный
  reorder камеры — позже (ограничение RootEncoder на churn). Это уже даёт: камера удаляемая/скрываемая
  (скрыл → чёрная база + оверлеи), без переоткрытия на overlay-changes.
- **Glue открытия камеры (модульность):** `MultiCameraClient.Camera` живёт в :app (AUSBC). Поэтому
  `RtmpStreamer` выставляет `var onCameraLayerSurface: (SurfaceTexture?) -> Unit` (ставит :app). Когда
  компоновщик создаёт/удаляет камеру-фильтр → `RtmpStreamer` зовёт callback с
  `cameraFilter.getSurfaceTexture()` (или null). :app: `st!=null → camera.openCamera(st,req)`,
  `st==null → camera.closeCamera()`. База энкодера = `BlackVideoSource` (ставится в ensureStream/preview).
- Тест (реальная камера, landscape 0°): запись в файл → камера над чёрной базой + оверлеи; ffprobe
  ~30fps (проверить, что чёрная база не режет каденс).

### Шаг 3 — Поворот/портрет для камеры-слоя. ⬜ (⚠️ риск, Bug 10)
Перенести логику портрета на новую модель; проверить запись 9:16 (ffprobe 1080×1920, круг круглый),
ландшафт 16:9, повороты. БЕЗ регрессий относительно текущего портрета.
**Тест поворотов — включать ВИРТУАЛЬНУЮ камеру** (совет Криника): её тест-паттерн (круг/сетка/TOP +
движущаяся полоса) сразу показывает искажения аспекта и угол поворота. Удобнее реальной для этого.

### Шаг 4 — Камера = обычный слой в `Scene`/UI. ⬜
Удаление/reorder/видимость камеры; убрать костыли Bug 15 (чёрное покрывало) и Bug 16 (запрет удаления).
Скрытие/удаление верхней камеры → видны нижние слои/чёрная база.

### Шаг 5 — Заглушка «ЗАГЛУШКА KrinikCam» (Q4) как слой. ⬜
Standby/freeze → замена ИМЕННО слоя камеры; оверлеи живые; закрывает Bug 17 (кадр только камеры,
без сплюща/чёрных полос). Сохранить storm-фикс Bug 13.

### Шаг 6 — Мерж в main. ⬜
Только после end-to-end проверки на файловой обвязке. Финальная сверка портрета — на ЖИВОМ YouTube
перед/после мержа (с Криником).

---

## ЖУРНАЛ (хронология находок и решений)

- 2026-06-29 — ветка `idea-21-camera-as-layer` создана. Матчасть подтверждена декомпиляцией.
- 2026-06-29 — Шаг 1 ✅ `BlackVideoSource`. Шаг 2 — РЕАЛИЗОВАН и ЧАСТИЧНО проверен на обвязке:
  - Стейтфул `SceneCompositor` (камера = `SurfaceFilterRender` index 0, оверлеи поверх, без
    `clearFilters`). `RtmpStreamer`: база = `BlackVideoSource`, glue `CameraOpener` (открыть камеру в
    SurfaceTexture слоя). :app — `UvcCameraOpener`/`VirtualCameraOpener`, LaunchedEffect шлёт
    `setCameraOpener`. Сборка ✅.
  - ✅ ПОДТВЕРЖДЕНО на устройстве: камера (реальная И виртуальная) рендерится как СЛОЙ над чёрной
    базой; оверлей-картинка композится поверх; запись в файл 4К — **круг виртуалки КРУГЛЫЙ** (ландшафт,
    без сплюща). Цепочка: ensureBlackBase → camera SurfaceFilterRender added → surfaceReady →
    UvcCameraOpener/VirtualCameraOpener open. Скрины `tools/screenshots/idea21_0{1,2}*`, кадр записи —
    круг ровный.
  - ⚠️ Каденс: запись 4К дала ~20fps (чёрная база через lockCanvas на 4К тяжела). Оптимизация: буфер
    базы уменьшен до 64×36 (чёрный растягивается GL). Пере-замер каденса НЕ доделан.

### 🔴 СТОП-БАГ (старт завтра отсюда): виртуалка мигает и исчезает → пустой чёрный канвас
После оптимизации базы (64×36) + при заходе в запись: виртуальная камера-слой показывается на мгновение
и пропадает, остаётся чёрный канвас. **Гипотеза:** при старте записи/стрима `configureCaptureRotation`
зовёт `changeVideoSource(blackSource)` → GL реинициализируется → у камеры-`SurfaceFilterRender` может
смениться SurfaceTexture (повторный `surfaceReady`), НО `cameraFilter != null` → `reconcileCamera`
ничего не делает → камера НЕ переоткрывается в новую поверхность → источник (virtual/uvc) рисует в
мёртвую SurfaceTexture → чёрный. ЛИБО 64×36 база тут ни при чём, а дело в реините GL при записи.
**Что проверить завтра:**
1. Логи `surfaceReady`/`UvcCameraOpener/VirtualCameraOpener open` ДО и ПОСЛЕ старта записи — пере-
   фаerr ли surfaceReady и переоткрылась ли камера.
2. Если SurfaceTexture камеры-слоя пересоздаётся при реините GL — компоновщик должен ловить новый
   `surfaceReady` камеры-фильтра и ПЕРЕОТКРЫВАТЬ камеру (onCameraSurface с новой ST). Возможно
   `SurfaceFilterRender` всегда зовёт callback при init — тогда onCameraLayerSurfaceReady должен
   корректно переоткрывать (закрыть старую, открыть в новую). Проверить, что не глотаем повторный вызов.
3. Также проверить, что оптимизация 64×36 не сломала каденс/картинку (откатить буфер на полный размер
   как контрольный опыт, если нужно).
4. Откат-проверка: вернуть базу на полный размер — исчезает ли баг? (изолировать причину).
