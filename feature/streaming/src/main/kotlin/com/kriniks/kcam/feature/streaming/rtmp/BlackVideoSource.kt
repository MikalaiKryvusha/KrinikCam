/**
 * BlackVideoSource — постоянная ЧЁРНАЯ база энкодера для модели мульти-источников (Idea 21).
 *
 * В новой модели камера перестаёт быть базовым VideoSource и становится обычным слоем
 * (`SurfaceFilterRender`). Базой энкодера становится этот источник — он рисует сплошной чёрный кадр.
 * Поверх него по z-order компонуются слои-фильтры (камера, картинки). Где слои не перекрывают — виден
 * чёрный (как пустой канвас OBS).
 *
 * ⚠️ ВАЖНО — КАДЕНС: в RootEncoder GL-рендер (и наложение фильтров) происходит на КАЖДЫЙ кадр БАЗОВОГО
 * источника (его `onFrameAvailable`). Поэтому чёрная база обязана тикать на ЦЕЛЕВОЙ частоте (~30 fps),
 * иначе весь стрим (включая камеру-слой) ограничится частотой базы. `drawColor(BLACK)` — это memset,
 * дёшев даже на 4К. Если на тяжёлых профилях начнётся голодание — уменьшить буфер базы (чёрный
 * масштабируется без потерь) или поднять источник на GL.
 *
 * Механика рисования — как у [StandbyVideoSource]: оборачиваем GL-SurfaceTexture энкодера в Surface и
 * заливаем чёрным через software-Canvas на отдельном HandlerThread. Ничего от :app (AUSBC) не нужно.
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.graphics.Color
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.kriniks.kcam.core.logging.KLog
import com.pedro.library.util.sources.video.VideoSource

private const val TAG = "BlackVideoSource"

// Целевая частота базы — задаёт каденс всего GL-рендера (см. примечание выше). 30 fps по умолчанию.
private const val BASE_FPS = 30L
private const val FRAME_INTERVAL_MS = 1000L / BASE_FPS

class BlackVideoSource : VideoSource() {

    private var surface: Surface? = null
    private var drawThread: HandlerThread? = null
    private var drawHandler: Handler? = null
    @Volatile private var running = false

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    override fun start(surfaceTexture: SurfaceTexture) {
        // ⚡ Оптимизация каденса: база — СПЛОШНОЙ чёрный, ей НЕ нужен полный размер энкодера. Берём
        // крошечный буфер — GL растянет чёрный на весь канвас (чёрный на чёрном, аспект неважен). Это
        // убирает дорогой lockCanvas+drawColor на 4К каждый кадр (был ~20fps на 4К → должно дать ~30).
        val w = 64
        val h = 36
        try {
            surfaceTexture.setDefaultBufferSize(w, h)
            surface = Surface(surfaceTexture)
            running = true

            val thread = HandlerThread("BlackBaseDraw").also { it.start() }
            val handler = Handler(thread.looper)
            drawThread = thread
            drawHandler = handler

            val loop = object : Runnable {
                override fun run() {
                    if (!running) return
                    drawOnce()
                    if (running) handler.postDelayed(this, FRAME_INTERVAL_MS)
                }
            }
            handler.post(loop)
            KLog.d(TAG, "Black base started — ${w}x${h} @ ${BASE_FPS}fps (drives GL cadence)")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start black base source", e)
            running = false
        }
    }

    private fun drawOnce() {
        val s = surface ?: return
        try {
            val canvas = s.lockCanvas(null) ?: return
            canvas.drawColor(Color.BLACK)
            s.unlockCanvasAndPost(canvas)
        } catch (e: Exception) {
            KLog.w(TAG, "Black base draw failed: ${e.message}")
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
        KLog.d(TAG, "Black base source stopped")
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
