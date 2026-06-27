/**
 * UvcVideoSource — RootEncoder VideoSource adapter for AndroidUSBCamera.
 *
 * RootEncoder's StreamBase calls start(surfaceTexture) when its GL pipeline is ready.
 * We forward the SurfaceTexture to the USB camera: the camera writes its frames directly
 * into the GL input SurfaceTexture, bypassing the phone's Camera1/Camera2 API entirely.
 *
 * This is the bridge that fixes the Go Live crash (BUG 1 from Phase 1 testing):
 *   Before: RtmpCamera1 → openCamera() via Camera1 API → conflicts with UVC → native crash
 *   After:  RtmpStream + UvcVideoSource → camera renders to GL SurfaceTexture → safe
 *
 * Lives in :app because it bridges :feature:usb (MultiCameraClient) and
 * :feature:streaming (VideoSource) — two feature modules that cannot depend on each other.
 */

package com.kriniks.kcam.streaming

import android.graphics.SurfaceTexture
import com.jiangdg.ausbc.MultiCameraClient
import com.jiangdg.ausbc.camera.bean.CameraRequest
import com.pedro.library.util.sources.video.VideoSource
import com.kriniks.kcam.core.logging.KLog

private const val TAG = "UvcVideoSource"

class UvcVideoSource(
    private val camera: MultiCameraClient.Camera,
    private val previewWidth: Int = 1920,
    private val previewHeight: Int = 1080,
) : VideoSource() {

    private var running = false

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    /**
     * Called by RootEncoder's GL pipeline when its input SurfaceTexture is ready.
     * The USB camera renders its frames into [surfaceTexture] — the GL pipeline
     * reads them for both preview display and RTMP encoding.
     */
    override fun start(surfaceTexture: SurfaceTexture) {
        try {
            camera.openCamera(
                surfaceTexture,
                CameraRequest.Builder()
                    .setPreviewWidth(previewWidth)
                    .setPreviewHeight(previewHeight)
                    .setFrontCamera(false)
                    .create(),
            )
            running = true
            KLog.d(TAG, "USB camera opened via GL SurfaceTexture (${previewWidth}x${previewHeight})")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to open USB camera via SurfaceTexture", e)
        }
    }

    override fun stop() {
        try {
            camera.closeCamera()
            running = false
            KLog.d(TAG, "USB camera closed")
        } catch (e: Exception) {
            KLog.e(TAG, "Error closing USB camera", e)
        }
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
