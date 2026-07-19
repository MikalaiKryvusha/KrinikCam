# План 18 · Фаза 0 — MVP: сцена переживает рестарт + FAB-якорь «Сцены»

> Часть эпика [[idea 40]] / дорожная карта — [18_scene_profiles.md](18_scene_profiles.md).
> Определение готово Криником: **«UI добавляем FAB и научаемся сохранять настроенную сцену между
> сессиями запуска приложения» (2026-07-19).**

## Определение «готово» (Definition of Done)

1. Настроил сцену (камера + оверлеи, подвигал/масштабировал слои) → **закрыл приложение (даже убил
   процесс) → открыл → сцена ровно та же** (слои, источники, трансформы, z-order, видимость, оверлеи).
2. На экране виден **отдельный FAB «Сцены»** рядом с FAB слоёв (внизу-слева); тап открывает минимальное
   меню сцен (Фаза 0: индикатор текущей сцены + «Сбросить сцену»). Полный менеджер набора — Фаза 1.
3. Автосейв — незаметный: работа не теряется, даже если явно не «сохранял».

## Скоуп

**В скоупе (Ф0):**
- Сериализация ОДНОЙ текущей сцены в JSON-снапшот; оверлеи-картинки → файлы.
- Автосохранение текущей сцены (debounce) + восстановление на старте приложения.
- Устранение дуализма источника дефолтного слоя `camera` (источник попадает в `scene.source`).
- FAB «Сцены» (якорь) + минимальное меню («Сбросить сцену»).
- Unit-тест round-trip + харнес-CMD для автономной приёмки рестарта.

**ВНЕ скоупа (позже):**
- Несколько ИМЕНОВАННЫХ сцен, переключение между ними, менеджер (→ Фаза 1).
- Переключение в эфире (→ Фаза 2). Экспорт/импорт (→ Фаза 3). Полная радиалка сцен (→ Фаза 1).

## Архитектура (поток данных)

```
             ┌─────────────── :feature:streaming ───────────────┐
  правка ──▶ RtmpStreamer._scene (StateFlow<Scene>)              │
  сцены      │  ├─ mutateScene{} → applySceneLayers() (как есть) │
             │  ├─ АВТОСЕЙВ: scene.drop(1).debounce → save()      │
             │  └─ RESTORE (init): loadOrNull() → _scene.value    │
             │                                                    │
             │  SceneSnapshotRepository (оркестратор)             │
             │   ├─ SceneSnapshotMapper: Scene ↔ SceneSnapshotDto │
             │   │     (Layer.Image.bitmap ↔ файл-путь)           │
             │   └─ ImageOverlayStore: filesDir/overlays/*.png    │
             └───────────────────────┬────────────────────────────┘
                                     │ JSON-строка (опаковая)
             ┌───────────────────────▼──── :data:profiles ───────┐
             │  SceneSnapshotStore (DataStore "kcam_scene")       │
             │   currentSceneJson: Flow<String?> / save / clear   │
             └────────────────────────────────────────────────────┘
```

Ключ: `:data:profiles` НЕ знает про типы сцены — хранит ОПАКОВУЮ JSON-строку (как `DeviceProfile`).
Сериализация/десериализация и оверлей-файлы — в `:feature:streaming`, который уже зависит от `:data:profiles`.

## Модель сериализации (DTO)

Новый файл `feature/streaming/.../scene/persist/SceneSnapshotDto.kt` (kotlinx.serialization):

```kotlin
@Serializable
data class SceneSnapshotDto(
    val version: Int = 1,                 // версия формата снапшота (форвард-совместимость)
    val layers: List<LayerDto> = emptyList(),
)

@Serializable
data class LayerDto(
    val kind: String,                     // "video_capture" | "image"
    val id: String,
    val name: String,
    val visible: Boolean = true,
    val transform: TransformDto = TransformDto(),
    val source: CaptureSourceDto? = null, // только для video_capture
    val overlayPath: String? = null,      // только для image — путь к PNG в filesDir
)

@Serializable
data class TransformDto(
    val scale: Float = 1f, val cx: Float = 0.5f, val cy: Float = 0.5f,
    val alpha: Float = 1f, val rotation: Int = 0,
)

@Serializable
data class CaptureSourceDto(
    val kind: String,                     // "builtin" | "uvc" | "virtual" | "none"
    val id: String? = null,               // cameraId (builtin) / deviceId (uvc)
    val displayName: String = "",
)
```

Замечания:
- `LayerDto` плоский с `kind`-дискриминатором (проще миграций, чем sealed-полиморфизм kotlinx).
- Мягкий фолбэк на десериализации (как у `EncoderProfileEntity.toProfile`): неизвестный `kind`/битое
  поле → слой пропускается или дефолт (не роняем restore).
- `CaptureSourceDto.displayName` сохраняем для UI (список источников), но опенер резолвится по `kind`+`id`.

## Мапперы (`SceneSnapshotMapper.kt`)

- `Scene.toSnapshot(store: ImageOverlayStore): SceneSnapshotDto` — для каждого `Layer.Image`
  гарантирует PNG-файл (`store.ensureSaved(layerId, bitmap)` → путь) и кладёт `overlayPath`; для
  `Layer.VideoCapture` мапит `source` → `CaptureSourceDto`.
- `SceneSnapshotDto.toScene(store: ImageOverlayStore): Scene` — `image` грузит bitmap из `overlayPath`
  (`store.load(path)`, off-main, через `BitmapFactory`); если файла нет — слой пропускаем (сирота удалена).
  `video_capture` мапит `CaptureSourceDto` → `CaptureSource` (Builtin/Uvc/Virtual/None).

## Хранилище файлов оверлеев (`ImageOverlayStore.kt`)

`@Singleton`, инжектит `@ApplicationContext`. Директория `context.filesDir/overlays/`.
- `ensureSaved(layerId, bitmap): String` — если `overlays/<layerId>.png` уже есть → вернуть путь (слой
  иммутабелен, не переписываем); иначе `bitmap.compress(PNG, 100, out)` (PNG — альфа!) → путь.
- `load(path): Bitmap?` — `BitmapFactory.decodeFile(path)` (или null).
- `pruneExcept(paths: Set<String>)` — удалить файлы `overlays/*.png`, которых нет в актуальном наборе
  (чистка сирот после remove/reset). Вызывается из `SceneSnapshotRepository.save` после записи снапшота.

## Хранилище снапшота (`:data:profiles/datastore/SceneSnapshotStore.kt`)

Отдельный DataStore-файл `kcam_scene` (изолирован от `kcam_profiles`; Фаза 1 добавит рядом Room-таблицу):

```kotlin
@Singleton class SceneSnapshotStore @Inject constructor(@ApplicationContext ctx) {
    val currentSceneJson: Flow<String?>            // KEY_CURRENT_SCENE
    suspend fun saveCurrentSceneJson(json: String)
    suspend fun clear()
}
```

## Оркестратор (`:feature:streaming/.../scene/persist/SceneSnapshotRepository.kt`)

`@Singleton`, инжектит `SceneSnapshotStore` + `ImageOverlayStore`:
- `suspend fun save(scene: Scene)` — `scene.toSnapshot(overlayStore)` → `Json.encodeToString` →
  `store.saveCurrentSceneJson(json)`; затем `overlayStore.pruneExcept(активные overlayPath)`.
- `suspend fun loadOrNull(): Scene?` — `store.currentSceneJson.first()` → `Json.decodeFromString` →
  `dto.toScene(overlayStore)`; при любой ошибке — `null` (стартуем с `Scene.default()`, не роняем старт).

## Проводка в `RtmpStreamer`

1. Добавить в конструктор `private val snapshotRepo: SceneSnapshotRepository` (`@Inject`, Hilt соберёт).
2. **Restore на старте** (в `init` или отдельном `startRestore()`), СТРОГО до автосейва:
   ```kotlin
   scope.launch(Dispatchers.IO) {
       snapshotRepo.loadOrNull()?.let { restored ->
           withContext(Dispatchers.Main.immediate) { _scene.value = restored; applySceneLayers() }
       }
       // автосейв ПОСЛЕ restore: drop(1) пропускает восстановленное/дефолтное значение,
       // debounce гасит спам от жестов (mutateScene зовётся каждый кадр перетаскивания).
       scene.drop(1).debounce(400).collect { snapshotRepo.save(it) }
   }
   ```
   (`@OptIn(FlowPreview::class)` для `debounce`.)
3. **Reset** для FAB: `fun resetScene() = mutateScene { Scene.default() }` (автосейв подхватит и почистит
   сироты-оверлеи через `pruneExcept`).

Замечания по восстановлению:
- `_scene.value` ставится на Main → `applySceneLayers()` толкает слои композитору; MainScreen всё равно
  переприменяет слои на подъёме превью (существующие хуки). Камера-опенеры восстановятся через
  `LaunchedEffect(extraCameraLayers.map { id to source })` в MainScreen (маппинг `CaptureSource → opener`).
- Оверлей-bitmap грузятся из файлов на IO ДО постинга в `_scene` (внутри `toScene`).

## Дуализм источника дефолтного слоя `camera` (ИССЛЕДОВАНО — рефактор ОТЛОЖЕН на Ф1)

**Факт (код прочитан 2026-07-19):** дефолтный слой `camera` (id="camera") управляется ГЛОБАЛЬНЫМ
`DeviceManager._activeVideoSource` (тип `VideoSource`), а НЕ `scene.source` — см. `MainScreen` L190-219
(спец-`LaunchedEffect` по `activeSource`). Реальный выбор источника базовой камеры идёт через
`deviceManager.selectUvc()/selectVirtual()/selectPhoneCamera*()/selectVideoSource()`. ДОПОЛНИТЕЛЬНЫЕ
слои-камеры (id != "camera") — по `scene.source` (`extraCameraLayers`, L221-254), они restore'ятся штатно.

**Решение для Ф0 (минимальность + нулевой регресс):** НЕ рефакторим базовый слой. Причины: путь выбора
источника выстрадан багами (25/45/58/60), унификация задевает авто-выбор, таймаут-заглушку, шаринг фида,
таймингы регистрации устройств — это НЕ минимальная задача.
- Ф0 сериализует сцену КАК ЕСТЬ (`scene.source["camera"]` может быть `None`, если юзер не трогал панель —
  это не мешает: опенер базы идёт через `activeSource`).
- На restore **базовая камера восстанавливается СУЩЕСТВУЮЩИМ авто-выбором** (воткнут UVC → авто-UVC;
  виртуалка персистится по bug 28). Оверлеи / PiP-слои / трансформы / z-order — восстанавливаются полностью.
- **Известное ограничение Ф0:** если юзер РУЧНУЮ выбрал не-авто базовую камеру (напр. фронталку при
  воткнутой вебке), после рестарта база вернётся к авто-источнику. Полное устранение дуализма (источник
  базового слоя ЖИВЁТ в сцене) — **Фаза 1** (там именованные сцены требуют источник базы в снапшоте).
- Приёмка Ф0 по камере: базовый слой на старте показывает штатный авто-источник (не чёрный, не краш);
  ДОП. камера-слой (PiP UVC/виртуалка) — restore'ится из сцены.

## UI: FAB «Сцены» (`MainScreen.kt`)

- Рядом с FAB слоёв (сейчас: `SmallFloatingActionButton` в `Alignment.BottomStart`, строки ~584-595).
  Ставим второй маленький FAB в `BottomStart`, СМЕЩЁННЫЙ выше (больший `padding(bottom=…)`), чтобы
  «Сцены» стояли НАД «Слоями». Иконка — что-то «сцены/кадры» (`Icons.Default.Movie` /
  `Icons.Default.ViewCarousel` / `Icons.Default.Dashboard` — выбрать при реализации, отличную от `Layers`).
- Тап → **минимальное меню** (Ф0): пункт-индикатор «Текущая сцена» (не действие) + «Сбросить сцену»
  (`streamViewModel.resetScene()`). Реализация — лёгкая (компактный `DropdownMenu` или
  раскрывающийся столбик по образцу меню слоёв); ПОЛНАЯ радиалка с веером сцен — Фаза 1.
- Строки в `strings.xml` (EN + RU): `main_scenes_desc`, `scenes_current`, `scenes_reset`.
  (Учесть открытый bug 65 — строки должны уважать выбранную локаль; не регрессировать.)

## Проводка VM / репозитория

- `StreamingRepository`: `fun resetScene() = rtmpStreamer.resetScene()`.
- `StreamViewModel`: `fun resetScene() = repository.resetScene()` (+ `viewModelScope` при необходимости).

## Харнес-CMD (`MainActivity.kt`) — для автономной приёмки рестарта

- `scene-dump` — вывести текущий снапшот сцены (JSON) в лог (объективная сверка «до/после рестарта»).
- `scene-save` — форсировать немедленный save (обойти debounce для детерминизма теста).
- `scene-reset` — сбросить сцену к дефолту (проверка FAB-действия без тапов).
(Debug-gate как у прочих CMD — bug 38: не экспортировать в release.)

## Пошаговый план

- **S1.** DTO + мапперы + `ImageOverlayStore` (+ unit round-trip тест: Scene→DTO→JSON→DTO→Scene,
  сверка всего кроме пиксельного bitmap — сверяем путь). Собрать, юнит зелёный.
- **S2.** `SceneSnapshotStore` (:data:profiles) + `SceneSnapshotRepository` (:feature:streaming). Собрать.
- **S3.** Проводка в `RtmpStreamer` (restore + debounce-автосейв + `resetScene`). Собрать, установить.
- **S4.** Дуализм источника дефолтного слоя — исследовать и (если надо) фикс. Собрать.
- **S5.** Харнес-CMD `scene-dump/scene-save/scene-reset`. Автономная приёмка: собрать сцену (камера +
  2 оверлея, подвигать) → `scene-save` → `am force-stop` → запуск → `scene-dump` + скриншот → сверка 1:1.
- **S6.** FAB «Сцены» + минимальное меню + строки EN/RU. Собрать, установить, тапнуть на устройстве.
- **S7.** Живая приёмка Криника (реальная вебка/оверлеи): собери сцену → закрой → открой → на месте.

## Приёмка Ф0

1. **Unit:** round-trip `Scene ↔ SceneSnapshotDto ↔ JSON` — слои/порядок/видимость/трансформы/источник
   точны; для картинки сверяется путь-файл.
2. **Харнес (автономно):** сцена 3+ слоёв с разными трансформами → `am force-stop` → запуск →
   `scene-dump` совпадает + скриншот совпадает; файлы `overlays/*.png` на месте, сирот нет.
3. **Дуализм:** UVC на дефолтном слое → рестарт → источник камеры восстановлен (не None).
4. **UI:** FAB «Сцены» виден, тап открывает меню, «Сбросить сцену» очищает до дефолта.
5. **Живьё (Криник):** реальная сцена с оверлеями переживает полный перезапуск.

## Риски / внимание

- **Debounce обязателен** — `mutateScene` (жест трансформы) зовётся каждый кадр; без debounce — спам
  записи и просадка жестов. 400 мс — компромисс (работа не теряется, записи редки).
- **Restore ДО автосейва** — иначе дефолтная сцена перезапишет сохранённую раньше загрузки.
- **Bitmap с IO** — грузить оверлеи в `toScene` на `Dispatchers.IO`, ставить `_scene` на Main.
- **Сироты-оверлеи** — `pruneExcept` после каждого save (remove/reset не должны копить PNG).
- **Дуализм источника** — если авто-выбор идёт мимо сцены, restore камеры неполный (см. раздел выше).
- **Не сломать существующее** — путь `applySceneLayers`, шаринг фида (bug 58), жесты — не трогаем логику,
  только добавляем restore/save поверх.
- **Room не трогаем** — Ф0 на DataStore, БЕЗ бампа версии БД и миграций (риск нулевой).

## Статус
✅ **РЕАЛИЗОВАНО + ПРОВЕРЕНО (харнес, 2026-07-19).** Сборка зелёная, unit round-trip зелёный
(`:feature:streaming:testDebugUnitTest`).

**Приёмка пройдена автономно (харнес):**
- Сцена из 4 слоёв (база + 2 оверлея с разными трансформами + доп. камера-слой `source=virtual`) →
  `scene-save` → `am force-stop` (убийство ПРОЦЕССА) → запуск → лог `Scene restored from snapshot:
  4 layers`, `scene-dump` «после» ИДЕНТИЧЕН «до» 1:1 (трансформы/источники/z-order/видимость).
- Оверлеи-картинки записаны файлами (`files/overlays/ov1.png`, `ov2.png`, 24КБ) и загружены на restore.
- `scene-reset` → 1 слой + **сироты-оверлеи почищены** (`files/overlays/` пуст).
- FAB «Сцены» виден НАД FAB слоёв (голубая иконка); тап → меню «Текущая сцена · N сл.» + «Сбросить сцену»
  (RU-строки корректны). 0 крашей (FATAL нет за весь прогон).

**Как реализовано (файлы):** DTO `scene/persist/SceneSnapshotDto`, чистый маппер `SceneSnapshotMapper`
(лямбды bitmap↔файл — pure-JVM тест), `ImageOverlayStore` (PNG в `filesDir/overlays`, ensureSaved/load/
pruneExcept), `SceneSnapshotStore` (DataStore `kcam_scene`, :data:profiles), оркестратор
`SceneSnapshotRepository`. Проводка: `RtmpStreamer` (restore в init ПОСЛЕ scope + автосейв
`scene.drop(1).debounce(400)`, `resetScene/saveSceneNow/dumpSceneToLog`), `StreamingRepository`/
`StreamViewModel` (`resetScene`), `MainScreen` (FAB + меню), CMD `scene-save/scene-dump/scene-reset`,
строки EN/RU. Генерация id `camera_N`/`overlay_N` переведена на СКАН сцены (устойчивость к restore).

**Остаток (по дизайну — не в Ф0):** источник БАЗОВОГО слоя `camera` живёт в `DeviceManager.activeSource`,
не в сцене → после рестарта база на авто-выборе (см. раздел «Дуализм»). Полное устранение — Фаза 1.

**UI переработан по правкам Криника в чате (2026-07-19):** радиалка сцен → **панель-список в стиле
`StreamLayersOverlay`** (от левого края, растёт вверх — «меню будет разрастаться»). Заодно ГЛАВНОЕ меню
переведено с радиалки на список: **радиалка сильно грузила** (длинная покадровая анимация веера поверх
живого TextureView лагала). Общий компонент `FloatingPanelMenu`; главное — `FloatingActionMenu`;
радиальные файлы удалены. FAB сцен = форма/тон FAB слоёв. «Сбросить сцену» из панели убран (Криник);
`resetScene` живёт для CMD-харнеса. Ф0-панель сцен: индикатор «Текущая сцена · N сл.».

🟡 **Ждёт живой приёмки Криника** (реальная вебка + оверлеи из файлов): собрать сцену → закрыть → открыть.
🔴 По ходу пойман **bug 49** (краш при возврате из Settings) — НЕ регрессия сцен, стектрейс снят (`bugs/49`).
