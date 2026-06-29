/**
 * VideoSource — sealed interface for all video input sources KrinikCam can use.
 *
 * Implementations:
 *   UvcCameraSource  — USB UVC webcam (:feature:usb manages the actual camera object)
 *   PhoneCameraSource — device's built-in camera (Camera2 API)
 *   NoneSource        — no video source available (shows black frame / placeholder)
 *
 * DeviceManager picks the best available source according to user priority.
 * Related: AudioSource, DeviceManager, :feature:usb
 */

package com.kriniks.kcam.feature.capture.model

sealed interface VideoSource {
    val id: String
    val displayName: String
    val isAvailable: Boolean

    /** USB UVC camera detected via Android UsbManager */
    data class UvcCamera(
        override val id: String,
        override val displayName: String,
        val vendorId: Int,
        val productId: Int,
    ) : VideoSource {
        override val isAvailable = true
    }

    /** Built-in phone / tablet camera via Camera2 */
    data class PhoneCamera(
        override val id: String,
        override val displayName: String,
        val cameraId: String,    // Camera2 logical camera ID
        val isFront: Boolean,
    ) : VideoSource {
        override val isAvailable = true
    }

    /**
     * Virtual debug camera (Idea 09) — a synthetic 16:9 test pattern fed into the pipeline so the
     * app can run/be debugged WITHOUT a physical USB camera. Enabled via the Developer menu.
     */
    object Virtual : VideoSource {
        override val id = "virtual"
        override val displayName = "Virtual camera (debug)"
        override val isAvailable = true
    }

    /** No video source — app shows black screen + standby placeholder */
    object None : VideoSource {
        override val id = "none"
        override val displayName = "No camera"
        override val isAvailable = false
    }
}
