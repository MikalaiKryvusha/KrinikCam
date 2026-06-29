/**
 * StreamViewModel — UI state for the streaming feature.
 *
 * Exposes:
 *   streamState   — current StreamState (Idle / Connecting / Live / Error)
 *   profiles      — list of all configured streaming platforms
 *   activeProfile — the profile selected for the next / current stream
 *
 * Actions (called from :app — MainScreen):
 *   setVideoSource(source)      — set the USB camera VideoSource (UvcVideoSource)
 *   startPreviewOnView(tv)      — start GL preview on a TextureView
 *   startStream() / stopStream()
 *
 * Related: StreamingRepository, RtmpStreamer, UvcVideoSource (:app), StreamPlatformsOverlay (UI)
 */

package com.kriniks.kcam.feature.streaming.ui

import android.view.TextureView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pedro.library.util.sources.video.VideoSource
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

    fun removeLayer(id: String) = repository.removeLayer(id)
    fun toggleLayerVisible(id: String) = repository.toggleLayerVisible(id)
    fun moveLayerUp(id: String) = repository.moveLayerUp(id)
    fun moveLayerDown(id: String) = repository.moveLayerDown(id)

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
     * Set the video source for the GL encoder pipeline.
     * Must be called before startPreviewOnView() when the USB camera connects,
     * or after it (changeVideoSource handles live-swap).
     */
    fun setVideoSource(source: VideoSource) {
        repository.setVideoSource(source)
        KLog.d(TAG, "VideoSource set: ${source::class.simpleName}")
    }

    /**
     * Start GL preview output on [textureView]. Also starts the VideoSource
     * (i.e. opens the USB camera if UvcVideoSource is active).
     */
    fun startPreviewOnView(textureView: TextureView) {
        repository.startPreview(textureView)
        KLog.d(TAG, "Preview started on TextureView")
    }

    fun clearVideoSource() {
        repository.clearVideoSource()
        KLog.d(TAG, "VideoSource cleared")
    }

    /** Idea 21 — задать/снять источник камеры-слоя (реальная/виртуальная камера); null = отключена. */
    fun setCameraOpener(opener: com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer.CameraOpener?) {
        repository.setCameraOpener(opener)
        KLog.d(TAG, "CameraOpener set: ${opener != null}")
    }

    /**
     * USB camera disconnected while streaming → inject the "Please stand by" placeholder into
     * the live stream so the RTMP session survives the dropout (no Broken Pipe).
     */
    fun enterStandby() {
        repository.enterStandby()
        KLog.i(TAG, "Entering standby (camera lost during stream)")
    }

    /**
     * USB camera reconnected while streaming → swap the standby frame back to the live camera.
     */
    fun exitStandby(source: VideoSource) {
        repository.exitStandby(source)
        KLog.i(TAG, "Exiting standby (camera restored): ${source::class.simpleName}")
    }

    fun stopPreview() = repository.stopPreview()

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
