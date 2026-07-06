/**
 * UvcPreviewView — Compose wrapper that provides a TextureView for the GL preview pipeline.
 *
 * Phase 3 (единый композитор): наш GL-композитор рендерит ГОТОВЫЙ композит сцены (чёрная база +
 * камера-слой + оверлеи) — и в энкодер, и сюда в превью. Камера пишет в SurfaceTexture СЛОЯ
 * композитора (через CameraOpener в :app), а не в этот TextureView.
 *
 * Rotation: превью зеркалит УЖЕ ПОВЁРНУТЫЙ композит (глобальный поворот холста — interview_006 —
 * делается внутри композитора; на 90/270 GL-канвас сам портретный 9:16). Никаких матриц
 * TextureView здесь больше нет — леттербокс делает AspectRatioMode.Adjust на GL-уровне.
 *
 * Usage:
 *   UvcPreviewView(
 *       onTextureViewReady = { tv -> streamViewModel.startPreviewOnView(tv) }
 *   )
 *
 * When the TextureView's surface is ready, [onTextureViewReady] is called so the
 * caller can start the GL preview pipeline (which in turn opens the camera layer's producer).
 *
 * Related: UsbViewModel, CameraLayerOpeners (:app), RtmpStreamer / CompositorVideoSource (:feature:streaming)
 */

package com.kriniks.kcam.feature.usb.ui

import android.graphics.SurfaceTexture
import android.view.TextureView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.kriniks.kcam.core.logging.KLog

private const val TAG = "UvcPreviewView"

/**
 * TextureView container for the GL preview pipeline (RtmpStream).
 *
 * [onTextureViewReady] — called when the surface first becomes available (attach GL pipeline).
 * [onSurfaceTextureSizeChanged] — called on device rotation so the caller can restart the GL
 * pipeline with the new surface dimensions (portrait ↔ landscape).
 * [onSurfaceDestroyed] — called when the surface is destroyed (navigation away / backgrounding)
 * so the caller can stop the GL preview BEFORE the surface is released. Without this, the
 * RootEncoder GL render thread keeps drawing to the dead surface → GL error 1285
 * (GL_OUT_OF_MEMORY) → crash on pool-*-thread (see bug 02).
 */
@Composable
fun UvcPreviewView(
    onTextureViewReady: (TextureView) -> Unit = {},
    onSurfaceTextureSizeChanged: (TextureView, Int, Int) -> Unit = { _, _, _ -> },
    onSurfaceDestroyed: () -> Unit = {},
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

                    // Device rotated — TextureView resized. Restart the GL pipeline with the new
                    // surface dimensions (preview re-attaches at the new size — Bug 03).
                    override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {
                        KLog.d(TAG, "SurfaceTexture size changed: ${w}x${h} — restarting preview")
                        onSurfaceTextureSizeChanged(tv, w, h)
                    }

                    override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                        // Stop GL preview BEFORE returning true (which releases the surface).
                        // Otherwise the RootEncoder GL render thread draws to the dead surface
                        // → GL error 1285 (GL_OUT_OF_MEMORY) → crash. See bug 02.
                        KLog.d(TAG, "SurfaceTexture destroyed — stopping GL preview")
                        onSurfaceDestroyed()
                        return true
                    }

                    override fun onSurfaceTextureUpdated(s: SurfaceTexture) {}
                }
            }
        },
        modifier = modifier,
    )
}
