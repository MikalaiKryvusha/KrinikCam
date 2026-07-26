# План 20 — ЖИВАЯ уходящая сцена во время перехода (правка Криника 2026-07-25)

> Реализует правку Криника (чат 2026-07-25, дословно):
> «сейчас у тебя при переходе текущая сцена замирает - источники видео замирают на последнем кадре.
> А можешь сделать так, чтобы текущий уходящий слой жив был, пока он полностью не зафейдится? чтобы
> текущие источники текущего слоя стримили, пока ещё идёт переход»
>
> И его решение по развилке конфликта железа (дословно):
> «если две не тянет - то исключение развилка. В текущий сцене замирает старый кадр, а в новой
> запускается новая камера»
>
> Часть эпика [[idea 40]] / Фаза 2 — см. `18_phase2_live_switch.md` (там же сделанное: переходы
> FADE/SLIDE/NONE + удержание снимка, bug 71).
>
> **Происхождение документа:** выведен многоагентной разведкой по коду (4 разведчика: композитор,
> путь переключения, ограничения железа, поверхность регрессий) + 3 независимых подхода + 6
> состязательных вердиктов (2 линзы на подход) + синтез. Оценки подходов: А 5.25, Б 4.5, В 3.75
> (фатальных нет). Итог — гибрид: ядро А, фазовость В, приём Б («снимок = база, живые слои поверх»).
> Полные разборы — журнал воркфлоу в `.claude/projects/.../workflows/wf_c60466d6-7c4/journal.jsonl`.
>
> ✅ **РЕАЛИЗОВАНО И ПРОВЕРЕНО ЖИВЬЁМ 2026-07-26** (коммиты A→B→C→D исполнены одним заходом; ниже —
> исходный план, он же остаётся описанием архитектуры). Итоги приёмки на Titan 1 (Pico+ воткнута):
>
> | Ветка переключения | Ожидание | Факт (телеметрия перехода) |
> |---|---|---|
> | вебка → селфи (главный кейс жалобы) | уходящая вебка ЖИВАЯ весь переход | `retired=1`, `camera: +42 кадра` за 2.1с перехода, гашение ПОСЛЕ финиша |
> | селфи → вебка (уходит встроенная) | развилка Криника: замирает | `retired=0`, снимок-база, входящая вебка стартовала сразу (готова через 340мс) |
> | одна вебка в обеих сценах | живая без касания камеры | `live=1 retired=0`, готова через 46мс, `camera: +22` |
> | стресс 4 переключений подряд | эпохи не копятся, сироты гасятся | 4 begin / 4 finish, «перебит новым переходом», 0 крашей |
>
> Производительность: худший кадр за переход **10мс** (бюджет 30fps = 33мс) — удвоение проходов fps не
> роняет, опциональный шаг C6 (пропуск прохода 1 в фазе удержания) НЕ понадобился.
> Регрессии: `smoke.mjs` PASS (1920×1080, 172 кадра), юниты `:feature:streaming`/`:data:profiles`
> зелёные, ни одного `FATAL`/`SIGABRT`/`EGL_BAD`/`GL_OUT_OF_MEMORY` за все прогоны.

---

## 1. ВЫБОР

**Берём за основу подход А (раздельные наборы: живой `cameraSlots` + приватный `retiringSlots`, отложенное закрытие продюсеров по сигналу `onTransitionFinished`)** — только он не плодит дуализм ключей/эпох и не заставляет править шесть мап `RtmpStreamer` по `layerId`, а `newSceneHasContent()` остаётся корректным по построению. **Но исполняем его в порядке подхода В (разбиение на фазы) и с приёмом подхода Б (снимок остаётся БАЗОЙ, а живые слои дорисовываются поверх)** — это даёт рабочий результат уже на первом коммите, без единой правки жизненного цикла продюсеров, и гарантирует деградацию ровно в сегодняшнее поведение везде, где живость физически невозможна.

Заимствуем: у Б — «снимок как база + живая перерисовка поверх» и правило `producersToCloseOnSwitch`; у В — фазовое разбиение и явное правило «класс физресурса, а не sourceKey»; у судей — блокеры: **встроенную камеру живой НЕ ретайрим никогда**, единый чокпоинт открытия с форс-финишем перехода, идемпотентный `close()` UVC, телеметрия ПЕРЕД фичей.

Порядок коммитов: **A** (гигиена опенеров) → **B** (наблюдаемость) → **C** (живая перерисовка, композитор) → **D** (ретайр-слоты + отложенное закрытие). Каждый собирается, ставится и принимается отдельно.

---

## 2. ШАГИ РЕАЛИЗАЦИИ

### КОММИТ A — гигиена опенеров (самостоятельная ценность, класс bug 28/68)

**A1.** `/Users/kryvusha/ai_sandbox/KrinikCam/app/src/main/kotlin/com/kriniks/kcam/streaming/CameraLayerOpeners.kt`, `UvcCameraOpener.close()` (стр. 124): первой строкой `if (closed) return`. Ниже НЕ сбрасывать `reopenedAtBest = false` (закрытый опенер больше не переиспользуется; сброс только маскирует повторный вход). Причина: после коммита D `close()` может прийти из трёх мест, а второй `camera.closeCamera()` на закрытом AUSBC-объекте = неперехватываемый SIGABRT.

**A2.** Там же: добавить `override val isAlive: Boolean get() = !closed`. Сегодня UVC всегда рапортует `isAlive=true`, из-за чего гард bug 68 (`RtmpStreamer.kt:256-260`) может рано вернуться на УЖЕ закрытом продюсере.

**A3.** `/Users/kryvusha/ai_sandbox/KrinikCam/app/src/main/kotlin/com/kriniks/kcam/streaming/DeviceCamera.kt`, `DeviceCameraOpener.close()` (стр. 277-285): добавить `alive = false` (сейчас поле трогают только 205/218/223).

**A4.** `CameraLayerOpeners.kt` + `RtmpStreamer.CameraOpener` (`RtmpStreamer.kt:204-220`): новый метод интерфейса `fun cancelPendingReopen() {}` (дефолт — пусто). В `UvcCameraOpener`: `closed`-подобный флаг `suspendReopen = true` + `reopenThread?.interrupt()`; в `open()` Фаза-2 проверяет его рядом с `closed` (стр. 97 и 111). Нужен в коммите D: иначе поток из `CameraLayerOpeners.kt:95-118` проснётся через 1500 мс посреди перехода и переоткроет ОБЩИЙ AUSBC-объект в старую поверхность.

### КОММИТ B — наблюдаемость (делаем ДО фичи, иначе `[TESTED]` будет фродом)

**B1.** `/Users/kryvusha/ai_sandbox/KrinikCam/app/src/main/kotlin/com/kriniks/kcam/MainActivity.kt`, CMD-диспетчер рядом со стр. 300: ветка
`"scene-transition" -> { parts = arg.split(...); id.toLongOrNull(), SceneTransition.fromStorage(parts[1]), parts[2].toIntOrNull() → streamingRepository.setSceneTransition(id, type, ms) }`, при битом аргументе — `KLog.w` с usage (не молчаливый no-op).

**B2.** `/Users/kryvusha/ai_sandbox/KrinikCam/tools/ui.mjs` — строка в help (рядом с `scene-*`, стр. ~623). `/Users/kryvusha/ai_sandbox/KrinikCam/tools/smoke.mjs` — добавить `scene-transition` (и заодно `scene-switch`, `scene-list`) в список CONTRACT (стр. ~97-112), чтобы рассинхрон ui.mjs↔ресивер ловился smoke (bug 39).

**B3.** `CompositorVideoSource.kt`: поля телеметрии `private val transFramesAtBegin = HashMap<String, Int>()`, `private var transBeganAtMs = 0L`, `private var transEffectStartLogMs = 0L`, `private var transMaxFrameMs = 0L`. В `renderLoop` (стр. 592-598) замерить длительность `drawFrame()` и, пока `transActive`, копить максимум в `transMaxFrameMs` (**каденцию postDelayed НЕ менять** — это отдельная задача беклога). Лог в единой точке завершения (см. C6): режим, `heldMs`, `effectMs`, `maxFrameMs`, и по КАЖДОМУ слоту `id: +N кадров` (дельта `framesConsumed` от `transFramesAtBegin`). Ноль у уходящего слоя = сцена всё-таки замерла.

### КОММИТ C — живая перерисовка уходящих слоёв (композитор + 1 расчёт в RtmpStreamer)

Файл: `/Users/kryvusha/ai_sandbox/KrinikCam/feature/streaming/src/main/kotlin/com/kriniks/kcam/feature/streaming/gl/CompositorVideoSource.kt`.

**C1. Убрать гонку списка слоёв (обязательно — без этого `beginTransition` схватит уже НОВЫЕ слои).**
Новое GL-only поле `private var sceneLayers: List<CompositorLayer> = emptyList()`.
`setLayers` (стр. 443-446) → `requestedLayers = layers; handler?.post { sceneLayers = layers; syncTextures(); syncCameraSlots() }`.
Все чтения перевести на `sceneLayers`: `drawFrame` (стр. 624), `syncCameraSlots` (стр. 455), `syncTextures` (стр. 817). В `initGl` (стр. 577-583) добавить `sceneLayers = requestedLayers` ПЕРЕД `syncTextures()`/`syncCameraSlots()`. Volatile `requestedLayers` остаётся только как «последний запрошенный набор» для `initGl`.

**C2. Второй буфер для уходящего композита.** Поле `private var transBaseTex = 0`. В `initGl` рядом со стр. 573-575: `transBaseTex = r.createColorTexture(SCENE_W, SCENE_H)`. В `stop()` (стр. 843-845) удалить его вместе с `transTex`. **Зачем:** `transTex` теперь перерисовывается каждый кадр, а статичный снимок нужен как БАЗА (в нём слои, чьи слоты уже мертвы). Рисовать поверх `transTex` без базы нельзя — полупрозрачные слои (`layer.alpha<1`, фейд заглушки) накапливали бы альфу и «уплотнялись» за время перехода.

**C3. Вынести цикл слоёв в функцию.** Тело стр. 624-664 → `private fun drawLayerSet(r: GlQuadRenderer, layers: List<CompositorLayer>, fromIndex: Int = 0, outgoing: Boolean = false)`. Внутри — как было, кроме резолва слота:
```
val key = layer.mirrorOf ?: layer.id
val slot = if (!outgoing) cameraSlots[key]
           else retiringSlots[key] ?: cameraSlots[key]?.takeIf { key in transLiveIds }
if (outgoing && slot == null) continue   // не наш продюсер — оставляем то, что дал снимок-база
```
(`retiringSlots` в коммите C — пустая мапа-заглушка, наполняется в D.) Матрицы `canvasM/layerM/finalM/standbyM` остаются полями класса: вызовы строго последовательные.

**C4. Состояние уходящего набора.** Поля: `private var outgoingLayers: List<CompositorLayer> = emptyList()`, `private var transLiveIds: Set<String> = emptySet()`, `private var outgoingFrom = 0`, `private val retiringSlots = LinkedHashMap<String, CameraSlot>()`.

**C5. `beginTransition(type, durationMs, liveIds: Set<String>)`** (стр. 486-508). В посте:
- `if (transActive) finishTransition("перебит новым переходом")` (политика: максимум ОДНА уходящая эпоха);
- снимок как сегодня, но в `transBaseTex`: `r.setFramebufferColor(transFbo, transBaseTex)` + viewport + clear + `r.draw(sceneTex, …)`;
- `outgoingLayers = sceneLayers` (здесь ещё СТАРЫЙ список — FIFO гарантирует, что пост `setLayers` встанет позже);
- `transLiveIds = liveIds.filter { cameraSlots[it] != null }.toSet()`;
- `outgoingFrom` = индекс самого нижнего слоя в `outgoingLayers`, который Camera и чей `(mirrorOf ?: id) ∈ transLiveIds`; если такого нет → `outgoingLayers = emptyList()` (ровно сегодняшнее поведение);
- `transFramesAtBegin` = снимок `framesConsumed` по ВСЕМ `cameraSlots` (нужно для C7) + `transBeganAtMs`, `transMaxFrameMs = 0`;
- как сегодня: `transActive=true; transStarted=false; transType; transDurationMs; transHoldStartMs`. Поле `transHasFrame` заменить на проверку `transBaseTex != 0`.

**C6. Порядок кадра в `drawFrame`.** После цикла `prepare` (стр. 610) и ДО прохода 1:
```
if (transActive && outgoingLayers.isNotEmpty()) {
    r.setFramebufferColor(transFbo, transTex)
    glViewport(0,0,SCENE_W,SCENE_H); clear black
    Matrix.setIdentityM(canvasM, 0)                      // ВАЖНО: до drawLayerSet
    r.draw(transBaseTex, oes=false, texMatrix=snapIdentity, posMatrix=null, alpha=1f)   // база-снимок
    drawLayerSet(r, outgoingLayers, outgoingFrom, outgoing = true)                      // живые слои поверх
}
```
Дальше проход 1 (без изменений, но `drawLayerSet(r, sceneLayers)`), затем существующий блок перехода стр. 668-703 (в условии `transActive && transTex != 0`), затем проход 2/фото/swap — **НЕ трогаем**. Смешение остаётся ДО поворота холста → поворот, live-ресайз и `capturePhoto` работают как раньше.
В ветке `p >= 1f` (стр. 699-702) вместо `transActive = false` → `finishTransition("доиграл")`.
*Опционально (делать, только если `maxFrameMs` из B3 > 25 мс):* в фазе УДЕРЖАНИЯ (`transActive && !transStarted`) рисовать базу+живые слои прямо в `sceneFbo` и пропускать проход 1 — зритель всё равно видит только старую сцену.

**C7. Честное удержание (иначе регресс bug 71 на совпадающих id).** `newSceneHasContent()` (стр. 512-513):
```
cameraSlots.isEmpty() || cameraSlots.all { (id, s) ->
    s.framesConsumed - (transFramesAtBegin[id] ?: 0) >= VISIBLE_FRAME_LAG }
```
Причина: слот с совпавшим id («camera» есть в обеих сценах) не пересоздаётся мгновенно — `recreate()` приходит на 1-3 кадра позже через `LaunchedEffect → setCameraOpener`, и плоское `>= 2` схлопывает удержание в ноль.

**C8. Заглушка не всплывает внутри перехода.** В `CameraSlot.prepare` (стр. 267-275): пока `transActive` — НЕ менять `standbyAlpha` (target = текущее значение), но `lastFadeClockMs` и `standbyPulse` обновлять как обычно. Закрывает окно 500 мс между `STANDBY_STARTUP_GRACE_MS=2500` и `TRANSITION_HOLD_CAP_MS=3000`. Константы НЕ трогаем.

**C9. Единая точка финиша.** `private fun finishTransition(reason: String)`: `transActive=false; transStarted=false; outgoingLayers=emptyList(); transLiveIds=emptySet(); transFramesAtBegin.clear();` лог телеметрии (B3); `syncTextures(); syncCameraSlots()`. Звать также: в `initGl` ПЕРВОЙ строкой (до `cameraSlots.clear()`, стр. 582) и в `stop()` до цикла стр. 835.

**C10. Картинки уходящей сцены.** `syncTextures` (стр. 815-829): `want` = картинки `sceneLayers` + `outgoingLayers`, **дедуп по идентичности** (`distinctBy { System.identityHashCode(it) }` / ручной проход по `===`), иначе один и тот же Bitmap даст две записи и позже двойной `deleteTexture`.

**C11. `anyLiveCameraFrame`** (стр. 613-614): считать по `cameraSlots.values + retiringSlots.values` — во время перехода картинку даёт уходящий набор, и выходной кадр реально не чёрный.

**C12. Расчёт `liveIds`** — `/Users/kryvusha/ai_sandbox/KrinikCam/feature/streaming/src/main/kotlin/com/kriniks/kcam/feature/streaming/rtmp/RtmpStreamer.kt`, `switchScene` (стр. 1382-1400), на `Main.immediate` ПЕРЕД `beginTransition`. Локальный приватный хелпер (домен НЕ трогаем — судьи):
```
private fun keyOf(s: CaptureSource): String? = when (s) {
    is CaptureSource.Uvc -> "uvc:${s.deviceId}"
    is CaptureSource.Builtin -> "builtin:${s.cameraId}"
    else -> null }
```
(формат обязан совпадать с `MainScreen.kt:207` и `DeviceCamera.kt:114`).
```
val newKeys = loaded.layers.filter{it.visible}.filterIsInstance<Layer.VideoCapture>().associate { it.id to keyOf(it.source) }
val liveIds = _scene.value.layers.filter{it.visible}.filterIsInstance<Layer.VideoCapture>()
    .filter { cameraLayerMirrors[it.id] == null }                       // владелец, а не зеркало
    .filter { cameraOpeners[it.id]?.isAlive == true }                   // продюсер жив (после коммита A — честно)
    .filter { val k = layerSourceKeys[it.id]; k != null && newKeys[it.id] == k }  // тот же id И тот же ФИЗ-ключ
    .map { it.id }.toSet()
compositorSource.beginTransition(transition, durationMs, liveIds)
```
`openedLayers` НЕ используем — оно наполняется внутри `scope.launch` и может быть неактуальным.

### КОММИТ D — ретайр-слоты и отложенное закрытие (кейс «вебка → селфи»)

**D1. Композитор:** `beginTransition(type, durationMs, liveIds, retireIds: Set<String>)`. В посте после C5: `for (id in retireIds) cameraSlots.remove(id)?.let { retiringSlots[id] = it }`. В `drawFrame` добавить второй цикл `for (slot in retiringSlots.values) slot.prepare(r, nowMs)` — **вот здесь уходящая сцена и остаётся живой**. `outgoingFrom` считать по объединению `transLiveIds ∪ retireIds`. `syncCameraSlots`/`newSceneHasContent` НЕ трогаем — `retiringSlots` вне `cameraSlots`, поэтому `onCameraSurfaceReady(id,null)` по ним не летит и гейт готовности не отравляется.

**D2. Композитор:** `@Volatile var onTransitionFinished: (() -> Unit)? = null` (рядом с `onCameraSurfaceReady`, стр. 424) и `fun releaseRetiredSlots()` (пост в GL: `retiringSlots.values.forEach { it.release(renderer) }; retiringSlots.clear()`). В `finishTransition`: сначала `retiringSlots.values.forEach { it.frozen = true; runCatching { it.surfaceTexture?.setOnFrameAvailableListener(null) } }`, затем `runCatching { onTransitionFinished?.invoke() }` — **release НЕ здесь** (живой AUSBC/Camera2 не должен писать в освобождённую SurfaceTexture, bug 28). Ранние выходы `beginTransition` (`handler == null`, `!running`, `renderer == null`) обязаны немедленно дёрнуть `onTransitionFinished` — контракт «ровно один finish на каждый принятый begin».

**D3. RtmpStreamer — хранилище сирот:**
```
private class Retired(val layerId: String, val key: String?, val opener: CameraOpener)
private val retiredProducers = ArrayList<Retired>()
private fun flushRetiredProducers(reason: String) {   // идемпотентен
    if (retiredProducers.isEmpty()) { compositorSource.releaseRetiredSlots(); return }
    val list = retiredProducers.toList(); retiredProducers.clear()
    list.forEach { runCatching { it.opener.close() } }
    compositorSource.releaseRetiredSlots(); KLog.i(TAG, "retired flush: $reason (${list.size})")
}
```
В `init`: `compositorSource.onTransitionFinished = { scope.launch(Dispatchers.Main.immediate) { flushRetiredProducers("переход доиграл") } }`.

**D4. Вердикт ретайра** (в `switchScene`, сразу после `liveIds`). Первым действием — **синхронный** `flushRetiredProducers("новый switch")`, чтобы план не считался по ложной картине. Затем для каждого видимого слоя-камеры СТАРОЙ сцены, который первичный, имеет опенера и НЕ в `liveIds`:
- `key == null` (виртуалка) → **RETIRE_LIVE**;
- `key.startsWith("uvc:")` **и** в новой сцене нет ни одного `uvc:`-ключа **и** нет ни одного видимого слоя-камеры с `source = None` (его авто-засеет `MainScreen.kt:231-242`, класс заранее неизвестен) → **RETIRE_LIVE**;
- **всё остальное, включая ЛЮБОЙ `builtin:`** → **FREEZE_NOW** = ничего не делаем, сегодняшний путь (слот удалится в `syncCameraSlots`, продюсер закроется в t=0, слой возьмётся из снимка-базы).

Для RETIRE_LIVE: `opener.cancelPendingReopen()`; убрать записи слоя из `cameraOpeners`/`cameraLayerSurfaces`/`lastOpenedKinds`/`layerSourceKeys`/`cameraLayerMirrors`/`openedLayers`; `retiredProducers += Retired(id, key, opener)`. Дальше `beginTransition(..., liveIds, retireIds)`. После этого карты `RtmpStreamer` описывают ТОЛЬКО новую сцену → коллизия id `camera`↔`camera` не возникает, а точка гашения `RtmpStreamer.kt:274` обезврежена (`old == null`).
Watchdog: `scope.launch { delay(TRANSITION_HOLD_CAP_MS + durationMs + 500); flushRetiredProducers("watchdog") }`.

**D5. Единый чокпоинт открытия (последняя линия обороны от bug 58).** Приватный `private fun openProducer(layerId: String, opener: CameraOpener, st: SurfaceTexture)`, вызываемый И из `setCameraOpener` (стр. 288), И из `onCameraLayerSurfaceReady` (стр. 303). Перед `open`:
```
val k = opener.sourceKey
if (k != null && retiredProducers.any { conflicts(k, it.key) }) {
    compositorSource.abortTransition(); flushRetiredProducers("конфликт физключа перед open") }
openedLayers.add(layerId); opener.open(st)
```
`private fun conflicts(a: String?, b: String?) = a != null && b != null && (a == b || (a.startsWith("uvc:") && b.startsWith("uvc:")) || (a.startsWith("builtin:") && b.startsWith("builtin:")))`.
`abortTransition()` в композиторе = пост `{ if (transActive) finishTransition("оборван конфликтом") }`. Никаких очередей отложенных открытий — форс-финиш детерминирован, деградация = сегодняшнее замирание.

**D6.** `revertConflictingCameraLayer` (стр. 1512-1522): если переход активен — сперва `compositorSource.abortTransition(); flushRetiredProducers("конфликт")`, потом существующая логика без изменений (глухое подавление запрещено — оставит слой мёртвым навсегда).

---

## 3. ГРАНИЦЫ БЕЗОПАСНОСТИ

**НЕ трогаем вообще:** проход 2 (блит + `canvasTexMatrix`), `capturePhoto`, `resizeCanvasKeepingCamera`, энкодер/битрейт/`postDelayed(FRAME_MS)` (каденция — отдельная задача беклога), пороги `STANDBY_*`, `TRANSITION_HOLD_CAP_MS`, `VISIBLE_FRAME_LAG`, домен `CaptureSource`/`Layer`/`Scene`, шесть мап `RtmpStreamer` остаются по `layerId` (никаких эпох в ключах), `MainScreen.kt` (кроме ничего — он вне радиуса), кеш локейшенов `GlQuadRenderer` (отдельная задача).

**Гарды, которые обязаны выжить:**
- **bug 58** (второй open одного устройства): держится тремя слоями — вердикт D4 (builtin никогда не ретайрим; uvc не ретайрим, если новая сцена целит в uvc или имеет `source=None`), `conflicts()`-гард в единственной точке открытия D5, и механика зеркал (`cameraLayerMirrors`), которую не меняем.
- **bug 60/63** (две встроенные + реестр `openBuiltinIds` без refcount): **встроенная камера НИКОГДА не остаётся живой в уходящей сцене** — вердикт FREEZE_NOW безусловно. Её слой замирает на последнем кадре (сегодняшнее поведение) — честная деградация. Реестр не переписываем.
- **bug 62** (заглушка на старте): грейс 2500 мс не трогаем, C8 только замораживает альфу на время перехода.
- **bug 66/69** (гонки жизненного цикла Camera2, отравление флага `closed`): `DeviceCamera` правим ровно на одну строку `alive = false` в `close()`; `closed`-семантику не трогаем; `UvcCameraOpener.close()` становится идемпотентным, но `closed` НЕ сбрасывается на живом объекте (опенер пересоздаётся `LaunchedEffect`).
- **bug 68** (бесшовность двух сцен на одном Pico+): ранний return в `setCameraOpener` (стр. 256-260) остаётся как есть; такие слои попадают в `liveIds` и оживают БЕЗ единого касания продюсера.
- **bug 71** (чёрный прямоугольник): фаза УДЕРЖАНИЯ сохранена, C7 делает её честной и на совпадающих id.

**Деградация при конфликте устройств** (по возрастанию): совпал id+ключ → живём бесплатно (C); ключ не конфликтует → живём через ретайр (D); ключ конфликтует или это builtin → слой берётся из статичного снимка (сегодня); конфликт всплыл в рантайме → форс-финиш перехода + флаш сирот (мгновенная склейка вместо краха).

---

## 4. ПРИЁМКА

**Оракул №1 — телеметрия (дешёвый, обязательный на каждом прогоне).** Лог `finishTransition`: `heldMs`, `effectMs`, `maxFrameMs`, `id: +N кадров` по каждому слоту.
- Живой уходящий слой: `N ≈ (heldMs + effectMs)/33` (для 1500 мс → ~45 кадров). `N == 0` = сцена замерла → фича не работает, `[TESTED]` ставить НЕЛЬЗЯ.
- `maxFrameMs` > 33 = удвоение draw'ов роняет fps → включить опциональный шаг C6 (пропуск прохода 1 в фазе удержания).

**Оракул №2 — видео (объективный, DRM не мешает: пишет сам энкодер).** Фикстура на ВИРТУАЛЬНЫХ источниках (у виртуалки в кадре бегущая штанга + счётчик кадров, `sourceKey=null` → физконфликтов нет):
```
node tools/ui.mjs cmd virtual-camera on
node tools/ui.mjs cmd scene-new A ; cmd set-layer-source camera virtual
node tools/ui.mjs cmd scene-new B ; cmd set-layer-source camera virtual
node tools/ui.mjs cmd scene-list                 # взять id из лога
node tools/ui.mjs cmd scene-transition <idB> slide 1500
node tools/ui.mjs cmd scene-transition <idA> slide 1500
node tools/ui.mjs cmd stream-to-file on ; cmd go-live 1080
# пауза 3с (грейс bug 62), затем: scene-switch <idB> → 3с → scene-switch <idA> → 3с → stop
adb pull /sdcard/Android/data/<pkg>/files/rec/<last>.mp4 /tmp/rec.mp4
ffmpeg -i /tmp/rec.mp4 -vf "crop=iw*0.15:ih:0:0,freezedetect=n=0.001:d=0.15" -f null -
```
При SLIDE левая полоса кадра — ЧИСТАЯ уходящая сцена. **До фикса — по одному freeze-интервалу на каждое переключение; после — ни одного.** Контрольный отрицательный прогон (обе сцены на ОДНОЙ вебке при вердикте FREEZE_NOW / builtin): freeze-интервал **обязан быть** — это доказывает, что деградация работает, а не что тест сломан.
Каденция: `ffprobe -select_streams v:0 -show_entries frame=pkt_pts_time -of csv /tmp/rec.mp4` — нет разрывов > 2 интервалов кадра на переходе.

**Регрессии на железе (Headwolf Titan 1, для UVC — 3 стабильных повтора, EXP-0005):**
1. Вебка → селфи и обратно (главный кейс жалобы, коммит D): уходящая вебка ЖИВАЯ, `+N` кадров > 0, крашей нет.
2. Две сцены на одном Pico+ (коммит C, вердикт live): нет 1.5 с черноты, `heldMs` мал, картинка не замирает.
3. Селфи → основная (FREEZE_NOW): уходящий слой замирает, но НЕ чернеет; снэкбар `camera_conflict_builtin` НЕ всплыл; `cmd scene-dump` до/после — источник слоя новой сцены НЕ переписался (проверка на порчу автосейва).
4. **Краш-репро:** в эфире, с воткнутой вебкой, сцена A (UVC) → свежесозданная сцена B (`Scene.default`, `source=None`, авто-сев выберет UVC) ×5 — проверить, что нет SIGABRT и второго `openCamera` (grep лога по `UVC camera opened` против `UVC camera closed`).
5. Два переключения ВНУТРИ перехода (A→B→C) и `go-live`/`stop` РОВНО во время перехода ×3: в логе число `retired flush` = числу `beginTransition`, сирот нет, вебка открывается со следующей попытки.
6. Свернуть/развернуть приложение через 5 с после перехода: аспект/ориентация слоёв не поехали (`reopenDeadCameras`).

---

## 5. РИСКИ И ОТКАТ

| Риск | Митигация | Откат |
|---|---|---|
| Нативный краш AUSBC (bug 58/28) от двух живых UVC-путей | Вердикт D4 + `conflicts()`-гард в единой точке открытия D5 + идемпотентный `close()` (A1) + `cancelPendingReopen` (A4) | `git revert` коммита D — коммит C живёт сам по себе |
| Регресс bug 60/63 (реестр встроенных) | Встроенную не ретайрим НИКОГДА (вердикт всегда FREEZE_NOW) | — (не вводится) |
| Порча сцены пользователя (`revertConflictingCameraLayer` + автосейв) | Форс-финиш перехода перед откатом (D6); вердикт не ретайрит при `source=None` в новой сцене | revert D6 |
| Просадка fps на переходе (удвоение проходов) | `maxFrameMs` в телеметрии + опциональный пропуск прохода 1 в фазе удержания | Опциональный шаг включается/выключается одной строкой |
| +8 МБ GL-памяти (`transBaseTex`), класс bug 20 EGL_BAD_ALLOC | Удаляется в `stop()` рядом с `transTex`; ретайр-слоты живут максимум 6 с и освобождаются по `releaseRetiredSlots` + watchdog | revert C2 |
| Артефакт z-порядка: неживой слой-камера НАД живым в уходящей сцене не рисуется (дыра) | Редкий кейс (мультикамерные сцены); зеркала одного ключа тоже попадают в `transLiveIds`, поэтому типовой набор покрыт | Задать `outgoingFrom = outgoingLayers.size` (выключает перерисовку) |
| Изменение семантики `isAlive` у UVC (A2) может повлиять на гард bug 68 | Отдельный ранний коммит, отдельная приёмка на Pico+ | `git revert` коммита A |

**Быстрый аварийный откат без revert:** в `RtmpStreamer.switchScene` передать `liveIds = emptySet()` и `retireIds = emptySet()` — композитор сразу же схлопывается в сегодняшнее поведение (статичный снимок), продюсеры закрываются в t=0, как раньше. Одна строка.