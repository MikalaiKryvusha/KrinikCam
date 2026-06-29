/**
 * VirtualVideoSource — debug virtual USB camera (Idea 09). A RootEncoder VideoSource that pushes a
 * synthetic 16:9 test pattern into the GL pipeline, so the whole app (preview, rotation, encoding,
 * streaming) can be developed/debugged WITHOUT a physical camera connected.
 *
 * Draws VirtualFrameRenderer's STATIC pattern (circle/grid/markers — for distortion checks) plus a
 * MOVING overlay every frame: a vertical sweep bar gliding left→right and a live frame counter +
 * elapsed clock. The motion proves the stream is LIVE (not a frozen frame) and makes frame-rate /
 * freeze issues visible — also useful when analysing recorded frames (Idea 10).
 *
 * Same mechanism as StandbyVideoSource: wrap the encoder's GL SurfaceTexture in a producer Surface
 * and draw with a software Canvas on a HandlerThread; each post → onFrameAvailable → encoder+preview.
 *
 * Related: VirtualFrameRenderer, StandbyVideoSource, DeviceManager (VideoSource.Virtual), DevMenuScreen
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.kriniks.kcam.core.logging.KLog
import com.pedro.library.util.sources.video.VideoSource

private const val TAG = "VirtualVideoSource"

// 30 fps — matches a real webcam's cadence (Bug 11 / Krinik's request).
private const val VIRTUAL_FPS = 30L
private const val FRAME_INTERVAL_MS = 1000L / VIRTUAL_FPS
private const val ACID_PINK = 0xFFFF1A8C.toInt()

class VirtualVideoSource : VideoSource(), RotatableSource, LastFrameProvider {

    // Interview #004: the prerendered pattern serves as the "last frame" to freeze on at a source
    // drop. (The moving sweep bar isn't included, but a frozen circle/grid is a fine freeze frame.)
    override fun lastFrame(): Bitmap? = staticFrame

    private var surface: Surface? = null
    private var drawThread: HandlerThread? = null
    private var drawHandler: Handler? = null
    @Volatile private var running = false

    private var staticFrame: Bitmap? = null
    private var frameCount = 0L
    private var startMs = 0L

    // Bug 10 (variant C): desired output rotation. The "sensor" content is ALWAYS landscape 16:9;
    // for 90/270 we rotate it geometrically into the portrait buffer ourselves (see drawOnce).
    @Volatile private var outputRotation = 0

    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACID_PINK; alpha = 180 }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = Paint.Align.CENTER
    }

    override fun setOutputRotation(degrees: Int) {
        outputRotation = ((degrees % 360) + 360) % 360
        KLog.d(TAG, "outputRotation = $outputRotation")
    }

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    override fun start(surfaceTexture: SurfaceTexture) {
        // Buffer = the size RootEncoder requested (the encoder canvas). For 90/270 the streamer asks
        // for a PORTRAIT canvas (1080×1920); for 0/180 it's landscape (1920×1080). The producer
        // Surface buffer matches the encoder 1:1, so with encoder rotation=0 the GL maps it without
        // any scale → no distortion (Bug 10 variant C).
        // The virtual "sensor" is ALWAYS 16:9 landscape (like a real webcam): render at LONG×SHORT.
        val reqW = if (width > 0) width else 1920
        val reqH = if (height > 0) height else 1080
        val sensorW = maxOf(reqW, reqH)
        val sensorH = minOf(reqW, reqH)
        // The SOURCE is authoritative on its output geometry (variant C): for 90/270 we emit a PORTRAIT
        // buffer (1080×1920) holding the landscape frame rotated; for 0/180 a landscape buffer. This
        // must NOT depend on the init dims (which may still be landscape from preview) — otherwise the
        // rotated frame is drawn into a landscape buffer and gets clipped/letterboxed (Bug 10 regress).
        val portrait = outputRotation == 90 || outputRotation == 270
        val bufW = if (portrait) sensorH else sensorW
        val bufH = if (portrait) sensorW else sensorH
        try {
            staticFrame = VirtualFrameRenderer.renderStatic(sensorW, sensorH)
            textPaint.textSize = sensorH * 0.045f

            surfaceTexture.setDefaultBufferSize(bufW, bufH)
            surface = Surface(surfaceTexture)
            running = true
            startMs = SystemClock.elapsedRealtime()

            val thread = HandlerThread("VirtualCamDraw").also { it.start() }
            val handler = Handler(thread.looper)
            drawThread = thread
            drawHandler = handler

            val loop = object : Runnable {
                override fun run() {
                    if (!running) return
                    drawOnce(bufW, bufH, sensorW, sensorH)
                    if (running) handler.postDelayed(this, FRAME_INTERVAL_MS)
                }
            }
            handler.post(loop)
            KLog.d(TAG, "Virtual camera started — buffer ${bufW}x${bufH}, sensor ${sensorW}x${sensorH} @ ${VIRTUAL_FPS}fps")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start virtual camera", e)
            running = false
        }
    }

    /**
     * Draw the landscape 16:9 sensor frame (+ live overlay) into the buffer, geometrically rotated by
     * [outputRotation] so a portrait buffer is FILLED by the rotated landscape content with NO scale
     * distortion (Bug 10 variant C). We always draw in SENSOR (landscape) coords; the canvas transform
     * maps that to fill the buffer. Verified rotation mapping (90 CW): sensor (sx,sy) → (bufW−sy, sx).
     */
    private fun drawOnce(bufW: Int, bufH: Int, sensorW: Int, sensorH: Int) {
        val s = surface ?: return
        val bmp = staticFrame ?: return
        try {
            // ВАЖНО (Idea 21): когда виртуалка кормит СЛОЙ-камеру (SurfaceFilterRender), его
            // SurfaceTexture — GL-consumer и НЕ принимает софтверный lockCanvas (→ null → чёрный кадр,
            // bug 18). lockHardwareCanvas() рисует через GPU (RenderThread) → буфер совместим с
            // GL-consumer. Фолбэк на software lockCanvas — для поверхностей, не поддерживающих hardware.
            val canvas = (runCatching { s.lockHardwareCanvas() }.getOrNull() ?: s.lockCanvas(null)) ?: return
            canvas.save()
            when (outputRotation) {
                90 -> { canvas.translate(bufW.toFloat(), 0f); canvas.rotate(90f) }
                270 -> { canvas.translate(0f, bufH.toFloat()); canvas.rotate(270f) }
                180 -> { canvas.translate(bufW.toFloat(), bufH.toFloat()); canvas.rotate(180f) }
                else -> {} // 0° — draw landscape directly (buffer == sensor)
            }
            // From here everything is drawn in landscape SENSOR space (sensorW×sensorH).
            canvas.drawBitmap(bmp, 0f, 0f, null)

            // Moving vertical sweep bar (left→right, wraps). Proves the frame is live.
            val barW = sensorW * 0.012f
            val period = 3000f // ms for a full sweep
            val elapsed = (SystemClock.elapsedRealtime() - startMs).toFloat()
            val bx = ((elapsed % period) / period) * sensorW
            canvas.drawRect(bx, 0f, bx + barW, sensorH.toFloat(), barPaint)

            // Live counter: target FPS + frame # + elapsed seconds at the very bottom (Bug 11).
            val secs = elapsed / 1000f
            canvas.drawText("%d FPS · frame %d · %.1fs".format(VIRTUAL_FPS, frameCount, secs), sensorW / 2f, sensorH * 0.96f, textPaint)

            canvas.restore()
            s.unlockCanvasAndPost(canvas)
            frameCount++
        } catch (e: Exception) {
            KLog.w(TAG, "Virtual frame draw failed: ${e.message}")
        }
    }

    override fun stop() {
        running = false
        drawHandler?.removeCallbacksAndMessages(null)
        drawThread?.quitSafely()
        drawThread = null
        drawHandler = null
        surface?.release()
        surface = null
        staticFrame?.recycle()
        staticFrame = null
        KLog.d(TAG, "Virtual camera stopped")
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
