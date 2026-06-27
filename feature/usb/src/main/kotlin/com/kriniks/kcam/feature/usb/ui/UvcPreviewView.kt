/**
 * UvcPreviewView — Compose wrapper that provides a TextureView for the GL preview pipeline.
 *
 * In Phase 2, the USB camera no longer renders directly into this TextureView.
 * Instead, the GL pipeline (RtmpStream / StreamBase) renders its output here.
 * The camera writes to the GL pipeline's input SurfaceTexture (via UvcVideoSource in :app).
 *
 * Usage:
 *   UvcPreviewView(
 *       onTextureViewReady = { tv -> streamViewModel.startPreviewOnView(tv) }
 *   )
 *
 * When the TextureView's surface is ready, [onTextureViewReady] is called so the
 * caller can start the GL preview pipeline (which in turn opens the USB camera).
 *
 * Rotation / AR: handled by the GL pipeline (GlStreamInterface.setAutoHandleOrientation).
 * No Matrix transform needed here — it's now done at the GL level.
 *
 * Related: UsbViewModel, UvcVideoSource (:app), RtmpStreamer (:feature:streaming)
 */

package com.kriniks.kcam.feature.usb.ui

import android.graphics.SurfaceTexture
import android.view.TextureView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import com.kriniks.kcam.core.logging.KLog

private const val TAG = "UvcPreviewView"

/**
 * TextureView container that notifies [onTextureViewReady] when the surface is available.
 * The GL preview pipeline (RtmpStream) renders into this TextureView.
 */
@Composable
fun UvcPreviewView(
    onTextureViewReady: (TextureView) -> Unit = {},
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    AndroidView(
        factory = { context ->
            TextureView(context).also { tv ->
                tv.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, w: Int, h: Int) {
                        KLog.d(TAG, "SurfaceTexture available: ${w}x${h}")
                        onTextureViewReady(tv)
                    }

                    override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {
                        KLog.d(TAG, "SurfaceTexture size changed: ${w}x${h}")
                    }

                    override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                        KLog.d(TAG, "SurfaceTexture destroyed")
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
