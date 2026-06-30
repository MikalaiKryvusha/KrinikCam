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

import android.graphics.Bitmap
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

/**
 * Описание слоя для GL-композитора (z-order = порядок в списке, снизу вверх).
 *
 * Трансформа (PiP, Idea 25 шаг 4) — нормализована к кадру: [scale] доля кадра, [cx],[cy] центр в [0,1]
 * (0,0=верх-лево), [alpha] прозрачность. Дефолт — во весь кадр по центру (как было до трансформы).
 */
sealed interface CompositorLayer {
    val scale: Float
    val cx: Float
    val cy: Float
    val alpha: Float

    /** Слой камеры (OES external texture, кадры от камеры-продюсера). */
    data class Camera(
        override val scale: Float = 1f,
        override val cx: Float = 0.5f,
        override val cy: Float = 0.5f,
        override val alpha: Float = 1f,
    ) : CompositorLayer

    /** Слой-картинка (2D-текстура из bitmap). */
    data class Image(
        val bitmap: android.graphics.Bitmap,
        override val scale: Float = 1f,
        override val cx: Float = 0.5f,
        override val cy: Float = 0.5f,
        override val alpha: Float = 1f,
    ) : CompositorLayer
}

class CompositorVideoSource : VideoSource() {

    private var surface: Surface? = null
    private var eglCore: EglCore? = null
    private var eglSurface: EGLSurface? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var running = false
    private var encW = 1920
    private var encH = 1080

    private var renderer: GlQuadRenderer? = null
    // Упорядоченный список слоёв (z-order СНИЗУ ВВЕРХ) — из Scene. Камера и картинки РАВНОПРАВНЫ
    // и идут в порядке сцены (камера переставляема, как в OBS).
    @Volatile private var requestedLayers: List<CompositorLayer> = emptyList()
    private val uploaded = ArrayList<Pair<Bitmap, Int>>() // (bitmap, texId) для картинок-слоёв

    // ── Слой-камера (OES) ────────────────────────────────────────────────────
    // Компоновщик САМ создаёт OES-текстуру + SurfaceTexture; в неё пишет камера-продюсер (Camera2/USB/
    // виртуалка) через CameraOpener. Каждый кадр: updateTexImage + рисуем OES-квад на позиции слоя камеры.
    private var cameraOesTex = 0
    private var cameraSurfaceTexture: SurfaceTexture? = null
    @Volatile private var newCameraFrame = false
    private val cameraTexMatrix = FloatArray(16)
    // Вызывается, когда у слоя-камеры готова/исчезла SurfaceTexture (RtmpStreamer → откроет камеру).
    @Volatile var onCameraSurfaceReady: ((SurfaceTexture?) -> Unit)? = null

    /**
     * Idea 25 — задать упорядоченный список слоёв сцены (снизу вверх). Камера и картинки равноправны;
     * порядок = z. Вызывается из RtmpStreamer при изменении сцены.
     */
    fun setLayers(layers: List<CompositorLayer>) {
        requestedLayers = layers
        handler?.post { syncTextures() }
    }

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
            val r = GlQuadRenderer()
            renderer = r
            // OES-текстура + SurfaceTexture для камеры (создаём в нашем GL-контексте).
            cameraOesTex = r.createOesTexture()
            val camSt = SurfaceTexture(cameraOesTex)
            camSt.setDefaultBufferSize(encW, encH)
            camSt.setOnFrameAvailableListener { newCameraFrame = true }
            cameraSurfaceTexture = camSt
            syncTextures() // залить уже запрошенные слои-картинки
            // Сообщить наверх, что поверхность камеры готова → откроют камеру в неё (Camera2/USB/вирт).
            onCameraSurfaceReady?.invoke(camSt)
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
            val r = renderer
            if (r != null) {
                // Забрать свежий кадр камеры (даже если слой камеры скрыт — чтобы не копить очередь).
                val camSt = cameraSurfaceTexture
                if (camSt != null && newCameraFrame) {
                    runCatching { camSt.updateTexImage(); camSt.getTransformMatrix(cameraTexMatrix) }
                    newCameraFrame = false
                }
                // Рисуем слои в порядке сцены (снизу вверх). Камера и картинки равноправны.
                // Каждому слою — своя модельная матрица позиции (PiP-трансформа) и альфа.
                for (layer in requestedLayers) {
                    val pos = posMatrixOf(layer.scale, layer.cx, layer.cy)
                    when (layer) {
                        is CompositorLayer.Camera -> if (cameraOesTex != 0)
                            r.draw(cameraOesTex, oes = true, texMatrix = cameraTexMatrix, posMatrix = pos, alpha = layer.alpha)
                        is CompositorLayer.Image -> {
                            val texId = uploaded.firstOrNull { it.first === layer.bitmap }?.second
                            if (texId != null) r.draw(texId, oes = false, posMatrix = pos, alpha = layer.alpha)
                        }
                    }
                }
            }
            core.setPresentationTime(es, SystemClock.elapsedRealtimeNanos())
            core.swapBuffers(es)
        } catch (e: Exception) {
            KLog.w(TAG, "drawFrame failed: ${e.message}")
        }
    }

    // Модельная матрица позиции квада в clip-space по нормализованной трансформе слоя (PiP).
    // Полноэкранный квад [-1..1] масштабируем на [scale] и сдвигаем в центр (cx,cy)∈[0,1]
    // (Y экранный сверху-вниз → clip-Y флипается: cy=0 (верх) → ty=+1). Column-major float[16].
    private fun posMatrixOf(scale: Float, cx: Float, cy: Float): FloatArray {
        val tx = 2f * cx - 1f
        val ty = 1f - 2f * cy
        return floatArrayOf(
            scale, 0f, 0f, 0f,
            0f, scale, 0f, 0f,
            0f, 0f, 1f, 0f,
            tx, ty, 0f, 1f,
        )
    }

    // GL-поток: привести залитые текстуры к requestedBitmaps (удалить ушедшие, залить новые, порядок=z).
    private fun syncTextures() {
        val r = renderer ?: return
        val want = requestedLayers.filterIsInstance<CompositorLayer.Image>().map { it.bitmap }
        val it = uploaded.iterator()
        while (it.hasNext()) {
            val (bmp, tex) = it.next()
            if (want.none { w -> w === bmp }) { r.deleteTexture(tex); it.remove() }
        }
        val ordered = ArrayList<Pair<Bitmap, Int>>(want.size)
        for (bmp in want) {
            val existing = uploaded.firstOrNull { it2 -> it2.first === bmp }
            ordered.add(existing ?: (bmp to r.uploadBitmap(bmp)))
        }
        uploaded.clear(); uploaded.addAll(ordered)
    }

    override fun stop() {
        running = false
        handler?.removeCallbacksAndMessages(null)
        // Освобождаем GL на рендер-потоке, затем гасим поток.
        runCatching { onCameraSurfaceReady?.invoke(null) } // закрыть камеру-продюсер
        handler?.post {
            runCatching { uploaded.forEach { renderer?.deleteTexture(it.second) } }
            uploaded.clear()
            runCatching { cameraSurfaceTexture?.release() }
            cameraSurfaceTexture = null
            runCatching { if (cameraOesTex != 0) renderer?.deleteTexture(cameraOesTex) }
            cameraOesTex = 0
            renderer = null
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
