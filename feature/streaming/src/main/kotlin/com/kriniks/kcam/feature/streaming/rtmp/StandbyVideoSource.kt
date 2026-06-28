/**
 * StandbyVideoSource — a RootEncoder VideoSource that pushes a single static bitmap into the
 * GL pipeline at a low frame rate.
 *
 * Why this exists: RootEncoder 2.4.7 ships Camera1/Camera2/Screen/VideoFile/NoVideoSource but
 * NO bitmap source. When the USB webcam disconnects mid-stream it stops feeding the GL
 * SurfaceTexture, the encoder starves, and YouTube drops the RTMP connection (~15s → Broken Pipe).
 * To survive a camera dropout we swap the live source for this one (RtmpStreamer.enterStandby),
 * which keeps drawing the "Please stand by" frame so the encoder stays fed and the session alive.
 *
 * How it draws: RootEncoder's GlStreamInterface hands us its input SurfaceTexture (the GL
 * consumer). We wrap it in a producer Surface and draw the bitmap with a software Canvas
 * (lockCanvas / unlockCanvasAndPost) on a dedicated HandlerThread. Each post triggers the GL
 * thread's onFrameAvailable → the frame flows to both the encoder and the preview, exactly like
 * camera frames. 5 fps is plenty for a static card and keeps RTMP timestamps moving.
 *
 * This source needs nothing from :app (no AUSBC), so it lives in :feature:streaming — unlike
 * UvcVideoSource which must bridge MultiCameraClient and therefore sits in :app.
 *
 * Related: StandbyFrameRenderer (builds the bitmap), RtmpStreamer.enterStandby/exitStandby
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.graphics.Bitmap
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.kriniks.kcam.core.logging.KLog
import com.pedro.library.util.sources.video.VideoSource

private const val TAG = "StandbyVideoSource"

// Redraw cadence for the static frame. A standby card doesn't move, so a low rate is enough to
// keep the encoder fed and RTMP timestamps advancing without wasting CPU.
private const val STANDBY_FPS = 5L
private const val FRAME_INTERVAL_MS = 1000L / STANDBY_FPS

class StandbyVideoSource(
    private val bitmap: Bitmap,
) : VideoSource() {

    private var surface: Surface? = null
    private var drawThread: HandlerThread? = null
    private var drawHandler: Handler? = null
    @Volatile private var running = false

    // VideoSource.create() is called by init() before start(); we have nothing to pre-allocate.
    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    /**
     * Called by changeVideoSource() with the encoder's live GL SurfaceTexture. We size the
     * buffer to the encoder dimensions (set on us via init()) and begin the draw loop.
     */
    override fun start(surfaceTexture: SurfaceTexture) {
        // width/height come from VideoSource.init() (encoder size). Fall back to the bitmap's own
        // size if we were somehow started without init (e.g. encoder not yet configured).
        val w = if (width > 0) width else bitmap.width
        val h = if (height > 0) height else bitmap.height

        try {
            surfaceTexture.setDefaultBufferSize(w, h)
            surface = Surface(surfaceTexture)
            running = true

            val thread = HandlerThread("StandbyDraw").also { it.start() }
            val handler = Handler(thread.looper)
            drawThread = thread
            drawHandler = handler

            // Destination rect = full frame; the bitmap is stretched to fill the encoder surface.
            val dst = Rect(0, 0, w, h)
            val src = Rect(0, 0, bitmap.width, bitmap.height)

            val drawRunnable = object : Runnable {
                override fun run() {
                    if (!running) return
                    drawOnce(src, dst)
                    // Re-post for the next frame while we remain in standby.
                    if (running) handler.postDelayed(this, FRAME_INTERVAL_MS)
                }
            }
            handler.post(drawRunnable)
            KLog.d(TAG, "Standby source started — drawing ${bitmap.width}x${bitmap.height} into ${w}x${h} @ ${STANDBY_FPS}fps")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start standby source", e)
            running = false
        }
    }

    /** Draw one frame: lock the Surface canvas, blit the bitmap, post it to the GL consumer. */
    private fun drawOnce(src: Rect, dst: Rect) {
        val s = surface ?: return
        try {
            val canvas = s.lockCanvas(null) ?: return
            canvas.drawBitmap(bitmap, src, dst, null)
            s.unlockCanvasAndPost(canvas)
        } catch (e: Exception) {
            // A transient lock failure (surface being torn down) is not fatal — log and continue.
            KLog.w(TAG, "Standby frame draw failed: ${e.message}")
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
        KLog.d(TAG, "Standby source stopped")
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
