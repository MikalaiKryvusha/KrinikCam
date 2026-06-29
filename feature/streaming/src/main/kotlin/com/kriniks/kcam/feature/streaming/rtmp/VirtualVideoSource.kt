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
import android.graphics.Rect
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

class VirtualVideoSource : VideoSource() {

    private var surface: Surface? = null
    private var drawThread: HandlerThread? = null
    private var drawHandler: Handler? = null
    @Volatile private var running = false

    private var staticFrame: Bitmap? = null
    private var frameCount = 0L
    private var startMs = 0L

    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACID_PINK; alpha = 180 }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = Paint.Align.CENTER
    }

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    override fun start(surfaceTexture: SurfaceTexture) {
        val w = if (width > 0) width else 1920
        val h = if (height > 0) height else 1080
        try {
            // Pre-render the static pattern once at the encoder size (no per-frame re-render cost).
            staticFrame = VirtualFrameRenderer.renderStatic(w, h)
            textPaint.textSize = h * 0.045f

            surfaceTexture.setDefaultBufferSize(w, h)
            surface = Surface(surfaceTexture)
            running = true
            startMs = SystemClock.elapsedRealtime()

            val thread = HandlerThread("VirtualCamDraw").also { it.start() }
            val handler = Handler(thread.looper)
            drawThread = thread
            drawHandler = handler

            val src = Rect(0, 0, w, h)
            val dst = Rect(0, 0, w, h)
            val loop = object : Runnable {
                override fun run() {
                    if (!running) return
                    drawOnce(src, dst, w, h)
                    if (running) handler.postDelayed(this, FRAME_INTERVAL_MS)
                }
            }
            handler.post(loop)
            KLog.d(TAG, "Virtual camera started — ${w}x${h} @ ${VIRTUAL_FPS}fps")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start virtual camera", e)
            running = false
        }
    }

    /** Draw static pattern + moving sweep bar + live counter. */
    private fun drawOnce(src: Rect, dst: Rect, w: Int, h: Int) {
        val s = surface ?: return
        val bmp = staticFrame ?: return
        try {
            val canvas = s.lockCanvas(null) ?: return
            canvas.drawBitmap(bmp, src, dst, null)

            // Moving vertical sweep bar (left→right, wraps). Proves the frame is live.
            val barW = w * 0.012f
            val period = 3000f // ms for a full sweep
            val elapsed = (SystemClock.elapsedRealtime() - startMs).toFloat()
            val bx = ((elapsed % period) / period) * w
            canvas.drawRect(bx, 0f, bx + barW, h.toFloat(), barPaint)

            // Live counter: target FPS + frame # + elapsed seconds at the very bottom (Bug 11:
            // below the static label). FPS label lets you see the virtual framerate at a glance.
            val secs = elapsed / 1000f
            canvas.drawText("%d FPS · frame %d · %.1fs".format(VIRTUAL_FPS, frameCount, secs), w / 2f, h * 0.96f, textPaint)

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
