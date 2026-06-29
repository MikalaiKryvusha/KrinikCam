/**
 * CompositorVideoSource — НАШ GL-композитор слоёв как единственный базовый VideoSource RootEncoder
 * (Idea 25, «мобильный OBS»). Сам рисует ВСЕ слои сцены (камера-OES + картинки + …) в SurfaceTexture
 * энкодера; RootEncoder кодирует готовый композит и блитит его в превью. Камера тут — обычный слой
 * ВНУТРИ композитора (удаляемый/переставляемый), а не «особенный» базовый источник.
 *
 * Почему так (см. bugs/18 + plans/ideas/25): путь «камера = SurfaceFilterRender-фильтр RootEncoder» не
 * доходил до энкодера. Свой композитор отдаёт ОДИН готовый кадр базовым источником → доходит тривиально.
 *
 * ШАГ 1 (сейчас): EGL→энкодер, рисуем ЧЁРНЫЙ кадр @30fps (пустая база OBS). Дальше слои:
 * картинка (2D-текстура), камера (OES external texture), z-order/трансформа.
 *
 * Весь GL — на одном выделенном потоке (EglCore создаётся и используется только там).
 */

package com.kriniks.kcam.feature.streaming.gl

import android.graphics.SurfaceTexture
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.kriniks.kcam.core.logging.KLog
import com.pedro.library.util.sources.video.VideoSource

private const val TAG = "CompositorVideoSource"
private const val FPS = 30L
private const val FRAME_MS = 1000L / FPS

class CompositorVideoSource : VideoSource() {

    private var surface: Surface? = null
    private var eglCore: EglCore? = null
    private var eglSurface: EGLSurface? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var running = false
    private var encW = 1920
    private var encH = 1080

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    override fun start(surfaceTexture: SurfaceTexture) {
        // RootEncoder может звать start повторно (retry после готовности GL) — чистимся перед стартом.
        if (running || thread != null) stop()
        encW = if (width > 0) width else 1920
        encH = if (height > 0) height else 1080
        surfaceTexture.setDefaultBufferSize(encW, encH)
        val s = Surface(surfaceTexture)
        surface = s
        val t = HandlerThread("CompositorGL").also { it.start() }
        thread = t
        val h = Handler(t.looper)
        handler = h
        running = true
        h.post { initGl(s) }
        h.post(renderLoop)
        KLog.d(TAG, "Compositor started — ${encW}x${encH} @ ${FPS}fps (GL black base, шаг 1)")
    }

    // Инициализация EGL/GL строго на рендер-потоке.
    private fun initGl(s: Surface) {
        try {
            val core = EglCore()
            eglCore = core
            val es = core.createWindowSurface(s)
            eglSurface = es
            core.makeCurrent(es)
            GLES20.glDisable(GLES20.GL_DEPTH_TEST)
            GLES20.glDisable(GLES20.GL_CULL_FACE)
        } catch (e: Exception) {
            // Ожидаемо, если start вызван ДО готовности GL RootEncoder (SurfaceTexture ещё невалидна):
            // RootEncoder ретраит changeVideoSource после готовности GL → следующий start пройдёт.
            KLog.w(TAG, "initGl deferred (surface not ready yet, will retry): ${e.message}")
            running = false
        }
    }

    private val renderLoop = object : Runnable {
        override fun run() {
            if (!running) return
            drawFrame()
            handler?.postDelayed(this, FRAME_MS)
        }
    }

    private fun drawFrame() {
        val core = eglCore ?: return
        val es = eglSurface ?: return
        try {
            core.makeCurrent(es)
            GLES20.glViewport(0, 0, encW, encH)
            // Пустая база OBS — сплошной чёрный. (Слои рисуются поверх следующими шагами.)
            // ✅ Шаг 1 ДОКАЗАН: этот GL-кадр реально доходит до энкодера (проверено розовой заливкой).
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            core.setPresentationTime(es, SystemClock.elapsedRealtimeNanos())
            core.swapBuffers(es)
        } catch (e: Exception) {
            KLog.w(TAG, "drawFrame failed: ${e.message}")
        }
    }

    override fun stop() {
        running = false
        handler?.removeCallbacksAndMessages(null)
        // Освобождаем GL на рендер-потоке, затем гасим поток.
        handler?.post {
            runCatching { eglSurface?.let { eglCore?.releaseSurface(it) } }
            runCatching { eglCore?.release() }
            eglSurface = null
            eglCore = null
        }
        thread?.quitSafely()
        thread = null
        handler = null
        runCatching { surface?.release() }
        surface = null
        KLog.d(TAG, "Compositor stopped")
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
