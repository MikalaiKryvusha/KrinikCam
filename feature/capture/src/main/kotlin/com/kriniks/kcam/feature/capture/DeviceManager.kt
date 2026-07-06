/**
 * DeviceManager — registry of all available video and audio sources.
 *
 * Exposes StateFlows that :feature:usb and :app can observe.
 * :feature:usb calls notifyUvcConnected/Disconnected when USB devices appear.
 * :app's MainViewModel observes activeVideoSource to decide what to render.
 *
 * Source priority (Q1 answer):
 *   1. UVC camera (if connected)
 *   2. Primary rear camera
 *   3. Front (selfie) camera
 *   4. Any other phone camera
 *   5. None → black screen + "Please stand by"
 *
 * Related: VideoSource, AudioSource, UsbModule (:feature:usb), CaptureModule
 */

package com.kriniks.kcam.feature.capture

import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.capture.model.AudioSource
import com.kriniks.kcam.feature.capture.model.VideoSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "DeviceManager"

@Singleton
class DeviceManager @Inject constructor() {

    // ── Video sources ────────────────────────────────────────────────────

    private val _uvcSources = MutableStateFlow<List<VideoSource.UvcCamera>>(emptyList())
    val uvcSources: StateFlow<List<VideoSource.UvcCamera>> = _uvcSources.asStateFlow()

    private val _phoneCameras = MutableStateFlow<List<VideoSource.PhoneCamera>>(emptyList())
    val phoneCameras: StateFlow<List<VideoSource.PhoneCamera>> = _phoneCameras.asStateFlow()

    /** Best available video source following the priority chain */
    private val _activeVideoSource = MutableStateFlow<VideoSource>(VideoSource.None)
    val activeVideoSource: StateFlow<VideoSource> = _activeVideoSource.asStateFlow()

    // Idea 09 — virtual debug camera toggle (Developer menu). When ON and no real UVC camera is
    // connected, the active source becomes VideoSource.Virtual (synthetic test pattern).
    private var virtualEnabled = false

    /**
     * plans/05 S2 — единый список ДОСТУПНЫХ источников для UI выбора в свойствах слоя «Устройство
     * захвата видео»: все подключённые UVC-вебки + все встроенные камеры ОС + виртуалка (дебаг).
     * Порядок = как показываем в меню (UVC сверху — обычно основной рабочий источник Криника).
     * `None` в список НЕ кладём: «нет источника» — это отдельная явная опция в UI, не устройство.
     */
    private val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val availableSources: StateFlow<List<VideoSource>> =
        combine(_uvcSources, _phoneCameras) { uvc, phone ->
            buildList<VideoSource> {
                addAll(uvc)
                addAll(phone)
                add(VideoSource.Virtual)
            }
        }.stateIn(managerScope, SharingStarted.Eagerly, listOf(VideoSource.Virtual))

    // ── Audio sources ────────────────────────────────────────────────────

    private val _activeAudioSource = MutableStateFlow<AudioSource>(AudioSource.PhoneMic())
    val activeAudioSource: StateFlow<AudioSource> = _activeAudioSource.asStateFlow()

    // ── Registration ─────────────────────────────────────────────────────

    /** Called by :feature:usb when a UVC device is opened */
    fun notifyUvcConnected(source: VideoSource.UvcCamera) {
        KLog.i(TAG, "UVC connected: ${source.displayName}")
        _uvcSources.value = _uvcSources.value + source
        updateActiveSource()
    }

    /** Called by :feature:usb when a UVC device is disconnected */
    fun notifyUvcDisconnected(deviceId: String) {
        KLog.i(TAG, "UVC disconnected: $deviceId")
        _uvcSources.value = _uvcSources.value.filter { it.id != deviceId }
        updateActiveSource()
    }

    /** Called by :app on startup with Camera2 enumeration results */
    fun registerPhoneCameras(cameras: List<VideoSource.PhoneCamera>) {
        _phoneCameras.value = cameras
        updateActiveSource()
    }

    fun selectVideoSource(source: VideoSource) {
        KLog.d(TAG, "User selected video source: ${source.displayName}")
        _activeVideoSource.value = source
    }

    /**
     * Idea 24 — выбрать встроенную камеру устройства (фронт/тыл) активным источником. Для автономных
     * тестов модели слоёв (Idea 21) реальной камерой, когда USB не подключена. null-результат если
     * камер нужного типа нет.
     */
    fun selectPhoneCamera(isFront: Boolean): Boolean {
        val cam = _phoneCameras.value.firstOrNull { it.isFront == isFront }
            ?: _phoneCameras.value.firstOrNull() ?: return false
        KLog.i(TAG, "Select device camera: ${cam.displayName}")
        _activeVideoSource.value = cam
        return true
    }

    /**
     * plans/05 S5 — выбрать КОНКРЕТНУЮ встроенную камеру по Camera2-id (напр. «0», «1», «2»…).
     * Для теста автоматизацией любой родной камеры ОС (ширик/телефото/макро), не только front/rear.
     * false, если камеры с таким id в реестре нет.
     */
    fun selectPhoneCameraById(cameraId: String): Boolean {
        val cam = _phoneCameras.value.firstOrNull { it.cameraId == cameraId } ?: return false
        KLog.i(TAG, "Select device camera by id=$cameraId: ${cam.displayName}")
        _activeVideoSource.value = cam
        return true
    }

    /** plans/05 S5 — выбрать виртуальную дебаг-камеру источником (включает её и делает активной). */
    fun selectVirtual() {
        setVirtualCamera(true)
        KLog.i(TAG, "Select virtual source")
        _activeVideoSource.value = VideoSource.Virtual
    }

    /** Plan 05 — явно выбрать подключённую UVC-вебку как источник камера-слоя. null если вебок нет. */
    fun selectUvc(): Boolean {
        val uvc = _uvcSources.value.firstOrNull() ?: return false
        KLog.i(TAG, "Select UVC source: ${uvc.displayName}")
        _activeVideoSource.value = uvc
        return true
    }

    /** Idea 09 — enable/disable the virtual debug camera (Developer menu). */
    fun setVirtualCamera(enabled: Boolean) {
        if (virtualEnabled == enabled) return
        virtualEnabled = enabled
        KLog.i(TAG, "Virtual camera ${if (enabled) "ENABLED" else "disabled"}")
        // Force re-evaluation: a Virtual source is not a UvcCamera, so clear the guard by resetting.
        if (!enabled && _activeVideoSource.value is VideoSource.Virtual) {
            _activeVideoSource.value = VideoSource.None
        }
        updateActiveSource()
    }

    fun selectAudioSource(source: AudioSource) {
        KLog.d(TAG, "User selected audio source: ${source.displayName}")
        _activeAudioSource.value = source
    }

    // ── Priority logic ────────────────────────────────────────────────────

    private fun updateActiveSource() {
        val current = _activeVideoSource.value
        // Don't override an explicit user selection if it's still available
        if (current is VideoSource.UvcCamera && current in _uvcSources.value) return
        // Явно выбранную встроенную камеру (selectPhoneCamera) тоже не перебиваем, если она ещё есть.
        if (current is VideoSource.PhoneCamera && current in _phoneCameras.value) return

        // Приоритет авто-выбора (жалоба Криника 2026-07-06): USB-вебка → виртуалка (дебаг) → НЕТ.
        // ВСТРОЕННУЮ камеру устройства по умолчанию НЕ выбираем — иначе при запуске (пока USB-вебка
        // ещё не определилась) на превью лезет встроенная камера вместо вебки. Встроенная доступна
        // ТОЛЬКО по явному выбору (selectPhoneCamera / cmd device-camera / будущий UI выбора источника).
        val best: VideoSource = _uvcSources.value.firstOrNull()
            ?: (if (virtualEnabled) VideoSource.Virtual else null)  // debug virtual cam (Idea 09)
            ?: VideoSource.None

        _activeVideoSource.value = best
        KLog.d(TAG, "Active source updated: ${best.displayName}")
    }
}
