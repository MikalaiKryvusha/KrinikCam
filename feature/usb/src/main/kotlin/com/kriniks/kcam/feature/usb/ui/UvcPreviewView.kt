/**
 * UvcPreviewView — Compose wrapper for AndroidUSBCamera's TextureView preview.
 *
 * AndroidUSBCamera renders frames into an Android TextureView (not a Compose surface),
 * so we use AndroidView to embed it. When the factory runs, we call camera.openCamera()
 * which starts USB negotiation, opens the UVC pipeline, and renders into the texture.
 *
 * The ICameraStateCallBack.OPENED event fires (on the camera object in the repository)
 * after openCamera completes successfully — UsbViewModel updates activeCameraWidth/Height.
 *
 * For streaming, RtmpStreamer reads from the same SurfaceTexture via a shared Surface.
 *
 * Related: UsbViewModel, RtmpStreamer (:feature:streaming), StandbyPlaceholder
 */

package com.kriniks.kcam.feature.usb.ui

import android.graphics.SurfaceTexture
import android.view.TextureView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import com.jiangdg.ausbc.MultiCameraClient
import com.jiangdg.ausbc.camera.bean.CameraRequest
import com.kriniks.kcam.core.logging.KLog

private const val TAG = "UvcPreviewView"

@Composable
fun UvcPreviewView(
    camera: MultiCameraClient.Camera,
    modifier: Modifier = Modifier.fillMaxSize(),
    onSurfaceReady: (TextureView) -> Unit = {},
) {
    AndroidView(
        factory = { context ->
            TextureView(context).also { tv ->
                // SurfaceTexture is null until the view is laid out — wait for the callback.
                tv.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, w: Int, h: Int) {
                        try {
                            camera.openCamera(
                                tv,
                                CameraRequest.Builder()
                                    .setPreviewWidth(1920)
                                    .setPreviewHeight(1080)
                                    .setFrontCamera(false)
                                    .create(),
                            )
                            KLog.d(TAG, "openCamera called: 1920x1080")
                            onSurfaceReady(tv)
                        } catch (e: Exception) {
                            KLog.e(TAG, "Failed to open camera", e)
                        }
                    }
                    override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {}
                    override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                        camera.closeCamera()
                        return true
                    }
                    override fun onSurfaceTextureUpdated(s: SurfaceTexture) {}
                }
            }
        },
        modifier = modifier,
    )
}

/** Shown when no camera is connected — black background */
@Composable
fun NoSourceView(modifier: Modifier = Modifier.fillMaxSize()) {
    Box(
        modifier = modifier.background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        // Content handled by StandbyPlaceholder in :app overlay layer
    }
}
