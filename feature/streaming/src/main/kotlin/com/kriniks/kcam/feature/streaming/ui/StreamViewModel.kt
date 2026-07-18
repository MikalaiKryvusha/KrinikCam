/**
 * StreamViewModel — UI state for the streaming feature.
 *
 * Exposes:
 *   streamState   — current StreamState (Idle / Connecting / Live / Error)
 *   profiles      — list of all configured streaming platforms
 *   activeProfile — the profile selected for the next / current stream
 *
 * Actions (called from :app — MainScreen):
 *   setCameraOpener(opener)     — чем открывать камеру-слой композитора (USB/встроенная/виртуалка)
 *   startPreviewOnView(tv)      — start GL preview on a TextureView
 *   startStream() / stopStream()
 *
 * Related: StreamingRepository, RtmpStreamer, CameraLayerOpeners (:app), StreamPlatformsOverlay (UI)
 */

package com.kriniks.kcam.feature.streaming.ui

import android.view.TextureView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.ProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.data.profiles.model.VideoCodec
import com.kriniks.kcam.feature.streaming.R
import com.kriniks.kcam.feature.streaming.domain.StreamingRepository
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isActive
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "StreamViewModel"

@HiltViewModel
class StreamViewModel @Inject constructor(
    private val repository: StreamingRepository,
    // Сканер аппаратных кодеров устройства (MediaCodecList) — для списка ДОСТУПНЫХ кодеков (bug 42).
    private val codecScanner: com.kriniks.kcam.feature.codec.CodecScanner,
) : ViewModel() {

    // Кодеки, которые РЕАЛЬНО умеет аппаратно кодировать SoC устройства. В выборе кодека показываем
    // ТОЛЬКО их — нельзя выбрать то, что процессор не кодирует (требование Криника). H.264 — фолбэк
    // (есть на любом устройстве). Заполняется сканом на старте.
    private val _supportedCodecs = MutableStateFlow(listOf(VideoCodec.H264))
    val supportedCodecs: StateFlow<List<VideoCodec>> = _supportedCodecs.asStateFlow()

    val streamState: StateFlow<StreamState> = repository.streamState

    /** Current manual video rotation (0/90/180/270) — drives the rotation menu in MainScreen. */
    val videoRotation: StateFlow<Int> = repository.videoRotation

    // ── Мульти-источники (Idea 19) ──────────────────────────────────────────
    /** Текущая сцена (слои) — для панели «Слои». */
    val scene: StateFlow<com.kriniks.kcam.feature.streaming.scene.Scene> = repository.scene

    // plans/03 (жесты слоёв) S1 — какой слой сейчас ВЫБРАН для редактирования жестами (null = ничего).
    // Один активный слой за раз (interview_007 Q6=A). Выбор: тап по строке панели «Слои» ИЛИ (позже,
    // S5) тап по слою на превью. Подсветка выбранного — в панели и рамкой на превью.
    private val _selectedLayerId = MutableStateFlow<String?>(null)
    val selectedLayerId: StateFlow<String?> = _selectedLayerId.asStateFlow()

    /** Выбрать слой для жестов (null = снять выбор). Тап по уже выбранному — снимает (toggle). */
    fun selectLayer(id: String?) {
        _selectedLayerId.value = if (id != null && id == _selectedLayerId.value) null else id
        KLog.d(TAG, "Selected layer: ${_selectedLayerId.value}")
    }

    /**
     * plans/03 S2/S3 — применить ЖЕСТ к выбранному слою (инкрементально, за кадр жеста):
     *   [dCx],[dCy] — сдвиг центра слоя в ДОЛЯХ кадра (pan_px / contentRect), уже с учётом поворота
     *                 холста (маппинг делает UI, S4);
     *   [zoom]      — множитель масштаба за кадр (щипок), 1 = без изменений;
     *   [dRotation] — дельта угла поворота СОДЕРЖИМОГО слоя в градусах (два пальца).
     * Читаем текущую трансформу СИНХРОННО из `scene.value` (repository — единый in-memory источник),
     * применяем дельту, клампим (§3.4) и пишем назад. Композитор перерисует сразу.
     */
    // plans/03 S6 tear-off — СЫРАЯ (незаснапленная) трансформа текущего жеста. Снап применяется ТОЛЬКО
    // к отображаемому значению, а сырое накапливает истинные дельты → слой можно «оторвать» от снапа
    // (interview_007 Q3), а не залипнуть навсегда. Сбрасывается в начале каждого жеста (beginLayerGesture).
    private var rawCx = 0f
    private var rawCy = 0f
    private var rawScale = 1f
    private var rawRot = 0f
    private var rawActive = false
    private var rawLayerId: String? = null

    /** Начало жеста (нажатие) — сбросить сырое состояние, чтобы оно переинициализировалось от слоя. */
    fun beginLayerGesture() { rawActive = false }

    fun nudgeSelectedLayer(
        dCx: Float, dCy: Float, zoom: Float, dRotation: Float,
        pivotX: Float = Float.NaN, pivotY: Float = Float.NaN,
    ) {
        val id = _selectedLayerId.value ?: return
        val layer = scene.value.layers.firstOrNull { it.id == id } ?: return
        val t = layer.transform
        // Переинициализация сырого состояния от текущей (заснапленной) трансформы на старте жеста.
        if (!rawActive || rawLayerId != id) {
            rawCx = t.cx; rawCy = t.cy; rawScale = t.scale; rawRot = t.rotation.toFloat()
            rawActive = true; rawLayerId = id
        }
        // Масштаб/поворот — накапливаем в сыром.
        rawScale = (rawScale * zoom).coerceIn(0.05f, 4.0f)
        rawRot += dRotation
        // Пивот-якорь (масштаб/поворот вокруг центроида пальцев) на СЫРЫХ координатах.
        if (!pivotX.isNaN() && !pivotY.isNaN() && (zoom != 1f || dRotation != 0f)) {
            val a = 16f / 9f
            val px = pivotX * a; val py = pivotY
            val vx = rawCx * a - px; val vy = rawCy - py
            val rad = Math.toRadians(dRotation.toDouble())
            val cos = kotlin.math.cos(rad).toFloat(); val sin = kotlin.math.sin(rad).toFloat()
            val sx = vx * zoom; val sy = vy * zoom
            rawCx = (px + (sx * cos - sy * sin)) / a
            rawCy = py + (sx * sin + sy * cos)
        }
        // idea 35: клампим шире — слой МОЖЕТ уезжать за кадр (наезды/обрезка, если оторван от снапа).
        rawCx = (rawCx + dCx).coerceIn(-0.5f, 1.5f)
        rawCy = (rawCy + dCy).coerceIn(-0.5f, 1.5f)
        // СНАП только для отображения (сырое не трогаем → tear-off возможен).
        // idea 35: снап краёв ЗАПОДЛИЦО к краю кадра (вариант A) — цели по ПОЛУРАЗМЕРУ слоя (аспект+scale):
        // левый край флеш при cx=halfW, правый при 1-halfW, центр 0.5 (аналогично по Y).
        val aFit = layerAspect(layer) / (16f / 9f)
        val halfW = if (aFit <= 1f) rawScale * aFit / 2f else rawScale / 2f
        val halfH = if (aFit <= 1f) rawScale / 2f else rawScale / aFit / 2f
        val snapCx = snapTo(rawCx, halfW, 0.5f, 1f - halfW)
        val snapCy = snapTo(rawCy, halfH, 0.5f, 1f - halfH)
        val n90 = Math.round(rawRot / 90f) * 90
        val snapRot = if (kotlin.math.abs(rawRot - n90) <= 5f) ((n90 % 360) + 360) % 360
                      else ((rawRot.toInt() % 360) + 360) % 360
        repository.setLayerTransform(id, rawScale, snapCx, snapCy, t.alpha, snapRot)
    }

    // Мягкий ЛЁГКИЙ снап значения к ближайшей цели в пределах порога (доля кадра). Порог маленький
    // (Криник: «снап должен быть лёгкий»); tear-off (сырое накопление) даёт свободно сорвать слой.
    private fun snapTo(v: Float, vararg targets: Float): Float {
        for (tg in targets) if (kotlin.math.abs(v - tg) < 0.015f) return tg
        return v
    }

    // Монотонный счётчик ТОЛЬКО для уникальных id (id не должны повторяться даже после удалений).
    private var overlayIdCounter = 0

    // Видимое ИМЯ нумеруем от количества уже существующих оверлеев-картинок (+1) — чтобы нумерация
    // начиналась заново с 1, когда оверлеев нет (Криник: «логично вновь начинать с единицы»).
    private fun nextOverlayName(): String {
        val n = scene.value.layers.count { it is com.kriniks.kcam.feature.streaming.scene.Layer.Image } + 1
        return "Overlay $n"
    }

    /** Добавить тестовый PNG-оверлей поверх сцены (быстрая проверка пайплайна без файла). */
    fun addTestOverlay() {
        overlayIdCounter += 1
        repository.addTestOverlay(id = "overlay_$overlayIdCounter", name = nextOverlayName())
        KLog.i(TAG, "Added test overlay (id #$overlayIdCounter)")
    }

    /**
     * Добавить слой-картинку из выбранного файла (фаза 1). [bitmap] уже декодирован и вписан в кадр
     * (см. ImageOverlayLoader); декод/чтение файла делает UI off-main. [displayName] — имя файла.
     */
    fun addImageOverlay(displayName: String, bitmap: android.graphics.Bitmap) {
        overlayIdCounter += 1
        repository.addImageOverlay(id = "overlay_$overlayIdCounter", name = displayName, bitmap = bitmap)
        KLog.i(TAG, "Added image overlay '$displayName' (id #$overlayIdCounter)")
    }

    /** Мульти-источники (idea 21 Фаза B): добавить ещё один слой «Устройство захвата видео». */
    fun addVideoCaptureLayer(
        source: com.kriniks.kcam.feature.streaming.scene.CaptureSource =
            com.kriniks.kcam.feature.streaming.scene.CaptureSource.None,
    ): String = repository.addVideoCaptureLayer(source)

    fun removeLayer(id: String) {
        if (_selectedLayerId.value == id) _selectedLayerId.value = null // снять выбор с удаляемого слоя
        repository.removeLayer(id)
    }

    /**
     * plans/03 S7 — контекст-меню слоя (долгий тап). «На весь экран»: сброс трансформы слоя в полный
     * кадр (scale 1, центр, поворот 0). Работает для любого слоя.
     */
    fun resetLayerFullscreen(id: String) {
        val t = scene.value.layers.firstOrNull { it.id == id }?.transform ?: return
        repository.setLayerTransform(id, 1f, 0.5f, 0.5f, t.alpha, 0)
    }

    /**
     * plans/03 S7 — дублировать слой (долгий тап → «Дублировать»). Пока для слоёв-КАРТИНОК: копия с
     * новым id, чуть смещённая, поверх стека, сразу выбрана. Дублирование камера-слоя = несколько
     * видеозахватов (Фаза B композитора, несколько OES) — ещё не поддержано, поэтому пропускаем.
     */
    fun duplicateLayer(id: String) {
        val layer = scene.value.layers.firstOrNull { it.id == id } ?: return
        if (layer is com.kriniks.kcam.feature.streaming.scene.Layer.Image) {
            overlayIdCounter += 1
            val newId = "overlay_$overlayIdCounter"
            repository.addImageOverlay(newId, layer.name + " copy", layer.bitmap)
            val t = layer.transform
            repository.setLayerTransform(
                newId, t.scale,
                (t.cx + 0.04f).coerceIn(0f, 1f), (t.cy + 0.04f).coerceIn(0f, 1f),
                t.alpha, t.rotation,
            )
            _selectedLayerId.value = newId
            KLog.i(TAG, "Duplicated image layer $id → $newId")
        } else {
            KLog.w(TAG, "Duplicate of non-image layer $id skipped (Phase B multi-capture)")
        }
    }
    fun toggleLayerVisible(id: String) = repository.toggleLayerVisible(id)
    fun moveLayerUp(id: String) = repository.moveLayerUp(id)
    fun moveLayerDown(id: String) = repository.moveLayerDown(id)
    // interview_006 Q3: [rotation] — поворот содержимого слоя внутри сцены (0/90/180/270 CW).
    fun setLayerTransform(id: String, scale: Float, cx: Float, cy: Float, alpha: Float = 1f, rotation: Int = 0) =
        repository.setLayerTransform(id, scale, cx, cy, alpha, rotation)

    /**
     * Set the manual video rotation. Blocked while streaming (changing resolution mid-RTMP breaks
     * YouTube — see Idea 06); emits a hint to the user via the snackbar in that case.
     */
    fun setVideoRotation(degrees: Int) {
        val applied = repository.setVideoRotation(degrees)
        if (!applied && streamState.value.isActive) rotationLockedHint()
    }

    /** Tell the user why rotation is unavailable (tapped the locked rotation control while live). */
    fun rotationLockedHint() {
        viewModelScope.launch { _snackbar.emit(UiText.Res(R.string.snack_stop_to_rotate)) }
    }

    val profiles: StateFlow<List<StreamProfile>> = repository.allProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    // plans/14 — профили кодера (отдельная сущность): список для менеджера и пикера в форме платформы.
    val encoderProfiles: StateFlow<List<EncoderProfile>> = repository.encoderProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _activeProfile = MutableStateFlow<StreamProfile?>(null)
    val activeProfile: StateFlow<StreamProfile?> = _activeProfile.asStateFlow()

    // plans/13 S2 — снэкбары как UiText (ресурс+аргументы): VM без Context, резолвит UI-слой.
    private val _snackbar = MutableSharedFlow<UiText>(extraBufferCapacity = 4)
    val snackbar: SharedFlow<UiText> = _snackbar.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.enabledProfiles.collect { list ->
                if (_activeProfile.value == null) {
                    _activeProfile.value = list.firstOrNull()
                }
            }
        }
        // plans/14 — гарантируем хотя бы один профиль кодера (дефолтный), чтобы пикер и резолв не были пусты.
        viewModelScope.launch { repository.ensureDefaultEncoderProfile() }
        // bug 42 — пробим железо: список кодеков в UI = ТОЛЬКО те, что SoC умеет кодировать аппаратно.
        // Весь скан в защите: любой сбой MediaCodecList не должен ронять приложение (фолбэк — H.264).
        viewModelScope.launch {
            runCatching {
                val hw = codecScanner.scan().filter { it.isHardwareAccelerated }
                buildList {
                    if (hw.any { it.isH264 }) add(VideoCodec.H264)
                    if (hw.any { it.isHevc }) add(VideoCodec.H265)
                    if (hw.any { it.isAv1 }) add(VideoCodec.AV1)
                }.ifEmpty { listOf(VideoCodec.H264) }
            }.onSuccess {
                _supportedCodecs.value = it
                KLog.i(TAG, "Аппаратные видеокодеки устройства: ${it.joinToString { c -> c.name }}")
            }.onFailure {
                KLog.e(TAG, "Скан кодеков упал — фолбэк на H.264", it)
                _supportedCodecs.value = listOf(VideoCodec.H264)
            }
        }
    }

    /**
     * Start GL preview output on [textureView] — наш композитор рисует сцену; камера-слой
     * откроется сам через CameraOpener, когда его поверхность готова (Phase 3).
     */
    fun startPreviewOnView(textureView: TextureView) {
        repository.startPreview(textureView)
        KLog.d(TAG, "Preview started on TextureView")
    }

    /**
     * Bug 40 — физический поворот устройства: TextureView ресайзнулась (поверхность жива).
     * Обновляем ТОЛЬКО вьюпорт превью — поверхность не трогаем (bug 27: гонка с HWUI).
     */
    fun onPreviewSizeChanged(w: Int, h: Int) {
        repository.onPreviewSurfaceResized(w, h)
        KLog.d(TAG, "Preview size changed → ${w}x$h")
    }

    /** Мульти-источники: задать/снять продюсера КОНКРЕТНОГО слоя-камеры [layerId]; null = источника нет. */
    fun setCameraOpener(layerId: String, opener: com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer.CameraOpener?) {
        repository.setCameraOpener(layerId, opener)
        KLog.d(TAG, "CameraOpener[$layerId] set: ${opener != null}")
    }

    /** Мульти-источники: задать источник (CaptureSource) слоя [layerId] в сцене. */
    fun setCameraLayerSource(layerId: String, source: com.kriniks.kcam.feature.streaming.scene.CaptureSource) =
        repository.setCameraLayerSource(layerId, source)

    /** bug 19 — ориентация сенсора источника слоя [layerId] (+ зеркало) для выпрямления в композиторе. */
    fun setCameraOrientation(layerId: String, degrees: Int, mirror: Boolean) =
        repository.setCameraOrientation(layerId, degrees, mirror)

    fun stopPreview() = repository.stopPreview()

    /** bug 32 — аспект источника слоя [layerId] (ширина/высота); зовёт опенер, чтобы не растягивать. */
    fun setCameraAspect(layerId: String, aspect: Float) {
        if (aspect > 0f) {
            _cameraAspect.value = aspect   // idea 35 — глобальный (совместимость)
            // Мульти-источники: аспект PER-СЛОЙ (рамка выделения UVC-слоя не должна брать аспект селфи).
            _cameraAspects.value = _cameraAspects.value.toMutableMap().apply { put(layerId, aspect) }
        }
        repository.setCameraAspect(layerId, aspect)
    }

    // idea 35 — аспект текущего источника камеры, наблюдаемый UI (адаптивная рамка выделения камера-слоя).
    private val _cameraAspect = MutableStateFlow(16f / 9f)
    val cameraAspect: StateFlow<Float> = _cameraAspect.asStateFlow()

    // Мульти-источники: аспект КАЖДОГО слоя-камеры по id (для рамки выделения per-слой).
    private val _cameraAspects = MutableStateFlow<Map<String, Float>>(emptyMap())
    val cameraAspects: StateFlow<Map<String, Float>> = _cameraAspects.asStateFlow()

    // idea 35 — аспект (ширина/высота) слоя: картинка = аспект bitmap, камера = аспект источника.
    private fun layerAspect(layer: com.kriniks.kcam.feature.streaming.scene.Layer): Float = when (layer) {
        is com.kriniks.kcam.feature.streaming.scene.Layer.Image ->
            if (layer.bitmap.height > 0) layer.bitmap.width.toFloat() / layer.bitmap.height else 16f / 9f
        else -> _cameraAspect.value
    }

    fun startStream() {
        // plans/07 S2/S4 — МУЛЬТИСТРИМ: стримим на ВСЕ включённые (isEnabled) платформы разом. Каждая
        // enabled-платформа = отдельный RTMP-выход (движок MultiStream, S1/S3). Если ни одна не включена
        // — фолбэк на выбранный профиль (обратная совместимость). Первый = основной (параметры энкодера).
        val enabled = profiles.value.filter { it.isEnabled }
        val targets = enabled.ifEmpty { listOfNotNull(_activeProfile.value) }
        val primary = targets.firstOrNull()
        // Idea 10 — virtual stream platform: record encoder output to a file instead of RTMP.
        // plans/14 — резолвим профиль кодера основной платформы (suspend) → пишем им.
        if (repository.virtualStreamToFile) {
            viewModelScope.launch {
                val encoder = repository.encoderForProfile(primary)
                val path = repository.startRecordToFile(encoder)
                _snackbar.emit(
                    if (path != null) UiText.Res(R.string.snack_record_to_file, listOf(path))
                    else UiText.Res(R.string.snack_record_failed)
                )
            }
            return
        }
        if (targets.isEmpty()) {
            viewModelScope.launch { _snackbar.emit(UiText.Res(R.string.snack_no_platforms)) }
            return
        }
        KLog.i(TAG, "Starting MULTISTREAM on ${targets.size} platform(s): ${targets.joinToString { it.name }}")
        viewModelScope.launch {
            val ok = repository.startStream(targets)
            if (!ok) _snackbar.emit(UiText.Res(R.string.snack_encoder_failed))
        }
    }

    // idea 17 — ЮЗЕР-фича «Запись»: пишем композит в файл и публикуем в галерею DCIM/KrinikCam
    // (механика и переживание отрыва камеры давно проверены; запись и эфир взаимоисключающи).
    fun startRecording() {
        // bug 51 / plans/14 — запись кодируется профилем кодера активной платформы (резолв suspend).
        viewModelScope.launch {
            val encoder = repository.encoderForProfile(_activeProfile.value)
            val path = repository.startRecordToFile(encoder)
            KLog.i(TAG, "startRecording → ${path ?: "FAILED"} (encoder='${encoder.name}')")
            _snackbar.emit(
                if (path != null) UiText.Res(R.string.snack_recording_started)
                else UiText.Res(R.string.snack_recording_failed)
            )
        }
    }

    // idea 17 — фото-кнопка: снимок КОМПОЗИТА (то, что видит зритель) в галерею DCIM/KrinikCam.
    fun capturePhoto() {
        repository.capturePhoto()
        viewModelScope.launch { _snackbar.emit(UiText.Res(R.string.snack_photo_saved)) }
    }

    fun stopStream() {
        if (repository.isRecording) {
            KLog.i(TAG, "Stopping virtual stream (record)")
            repository.stopRecordToFile()
            return
        }
        KLog.i(TAG, "Stopping stream")
        repository.stopStream()
    }

    fun selectProfile(profile: StreamProfile) {
        _activeProfile.value = profile
    }

    fun saveProfile(profile: StreamProfile) {
        viewModelScope.launch {
            repository.saveProfile(profile)
            KLog.i(TAG, "Saved profile '${profile.name}'")
        }
    }

    /**
     * Export all configured profiles to a JSON string (Idea 01). The UI writes this to a file the
     * user picks via the system document picker (SAF). Stream keys ARE included — it's the user's
     * own backup of their own config.
     */
    fun buildExportJson(): String = ProfilesBackupCodec.encode(profiles.value)

    /**
     * Import profiles from a config file's JSON (Idea 01). Tolerant: extra fields ignored, missing
     * fields defaulted. Each imported profile is saved as a NEW row (id reset to 0) so existing
     * profiles are never overwritten. Emits a snackbar with the result.
     */
    fun importProfilesFromJson(json: String) {
        val imported = ProfilesBackupCodec.decode(json)
        if (imported.isEmpty()) {
            viewModelScope.launch { _snackbar.emit(UiText.Res(R.string.snack_import_failed)) }
            return
        }
        viewModelScope.launch {
            // plans/12 S5 — дедуп: повторный импорт того же файла не плодит копии профилей.
            val fresh = ProfilesBackupCodec.dedup(imported, profiles.value)
            val skipped = imported.size - fresh.size
            fresh.forEach { repository.saveProfile(it.copy(id = 0)) } // insert as new
            KLog.i(TAG, "Imported ${fresh.size} profile(s), skipped $skipped duplicate(s)")
            _snackbar.emit(
                if (skipped == 0) UiText.Res(R.string.snack_imported, listOf(fresh.size))
                else UiText.Res(R.string.snack_imported_skipped, listOf(fresh.size, skipped))
            )
        }
    }

    fun deleteProfile(profile: StreamProfile) {
        viewModelScope.launch {
            if (profile == _activeProfile.value) _activeProfile.value = null
            repository.deleteProfile(profile)
        }
    }

    // ── Профили кодера (plans/14) ───────────────────────────────────────

    fun saveEncoderProfile(profile: EncoderProfile) {
        viewModelScope.launch {
            repository.saveEncoderProfile(profile)
            KLog.i(TAG, "Saved encoder profile '${profile.name}'")
        }
    }

    /**
     * Удаляем профиль кодера всегда (решение Криника 2026-07-18). Если на него ссылались платформы,
     * им выдаётся запасной профиль (fallback) — показываем инфо-снэкбар со сколькими это случилось.
     */
    fun deleteEncoderProfile(profile: EncoderProfile) {
        viewModelScope.launch {
            val reassigned = repository.deleteEncoderProfile(profile)
            if (reassigned > 0) _snackbar.emit(UiText.Res(R.string.snack_encoder_profile_reassigned, listOf(reassigned)))
        }
    }
}
