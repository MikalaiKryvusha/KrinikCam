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
import com.kriniks.kcam.data.profiles.model.ProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.StreamProfile
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
) : ViewModel() {

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
        rawCx = (rawCx + dCx).coerceIn(-0.1f, 1.1f)
        rawCy = (rawCy + dCy).coerceIn(-0.1f, 1.1f)
        // СНАП только для отображения (сырое не трогаем → tear-off возможен).
        val snapCx = snapTo(rawCx, 0f, 0.5f, 1f)
        val snapCy = snapTo(rawCy, 0f, 0.5f, 1f)
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
        viewModelScope.launch { _snackbar.emit("Stop the stream to change rotation") }
    }

    val profiles: StateFlow<List<StreamProfile>> = repository.allProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _activeProfile = MutableStateFlow<StreamProfile?>(null)
    val activeProfile: StateFlow<StreamProfile?> = _activeProfile.asStateFlow()

    private val _snackbar = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val snackbar: SharedFlow<String> = _snackbar.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.enabledProfiles.collect { list ->
                if (_activeProfile.value == null) {
                    _activeProfile.value = list.firstOrNull()
                }
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

    /** Phase 3 — задать/снять источник камеры-слоя (USB/встроенная/виртуальная); null = отключена. */
    fun setCameraOpener(opener: com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer.CameraOpener?) {
        repository.setCameraOpener(opener)
        KLog.d(TAG, "CameraOpener set: ${opener != null}")
    }

    fun stopPreview() = repository.stopPreview()

    /** bug 32 — аспект текущего источника камеры (ширина/высота); зовёт опенер, чтобы не растягивать. */
    fun setCameraAspect(aspect: Float) = repository.setCameraAspect(aspect)

    fun startStream() {
        val profile = _activeProfile.value
        // Idea 10 — virtual stream platform: record encoder output to a file instead of RTMP.
        // No stream key needed; use the active profile's video params, or defaults if none.
        if (repository.virtualStreamToFile) {
            val p = profile ?: StreamProfile()
            val path = repository.startRecordToFile(p)
            viewModelScope.launch {
                _snackbar.emit(if (path != null) "Virtual stream → file: $path" else "Record failed")
            }
            return
        }
        if (profile == null) {
            viewModelScope.launch { _snackbar.emit("No streaming platform configured") }
            return
        }
        KLog.i(TAG, "Starting stream on profile '${profile.name}'")
        val ok = repository.startStream(profile)
        if (!ok) {
            viewModelScope.launch { _snackbar.emit("Failed to start encoder — check device support") }
        }
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
            viewModelScope.launch { _snackbar.emit("Import failed — no valid profiles in file") }
            return
        }
        viewModelScope.launch {
            imported.forEach { repository.saveProfile(it.copy(id = 0)) } // insert as new
            KLog.i(TAG, "Imported ${imported.size} profile(s)")
            _snackbar.emit("Imported ${imported.size} profile(s)")
        }
    }

    fun deleteProfile(profile: StreamProfile) {
        viewModelScope.launch {
            if (profile == _activeProfile.value) _activeProfile.value = null
            repository.deleteProfile(profile)
        }
    }
}
