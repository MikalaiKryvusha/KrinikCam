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

        val best: VideoSource = _uvcSources.value.firstOrNull()
            ?: (if (virtualEnabled) VideoSource.Virtual else null)  // debug virtual cam (Idea 09)
            ?: _phoneCameras.value.firstOrNull { !it.isFront }   // rear
            ?: _phoneCameras.value.firstOrNull { it.isFront }    // front
            ?: _phoneCameras.value.firstOrNull()                  // any
            ?: VideoSource.None

        _activeVideoSource.value = best
        KLog.d(TAG, "Active source updated: ${best.displayName}")
    }
}
