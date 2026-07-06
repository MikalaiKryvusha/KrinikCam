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
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.kriniks.kcam.core.logging.KLog
import com.pedro.library.util.sources.video.VideoSource
import java.nio.ByteBuffer
import java.nio.ByteOrder

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
    /** Поворот СОДЕРЖИМОГО слоя внутри сцены, градусы CW (interview_006 Q3: «слои как в Photoshop»). */
    val rotation: Int

    /** Слой камеры (OES external texture, кадры от камеры-продюсера). */
    data class Camera(
        override val scale: Float = 1f,
        override val cx: Float = 0.5f,
        override val cy: Float = 0.5f,
        override val alpha: Float = 1f,
        override val rotation: Int = 0,
    ) : CompositorLayer

    /** Слой-картинка (2D-текстура из bitmap). */
    data class Image(
        val bitmap: android.graphics.Bitmap,
        override val scale: Float = 1f,
        override val cx: Float = 0.5f,
        override val cy: Float = 0.5f,
        override val alpha: Float = 1f,
        override val rotation: Int = 0,
    ) : CompositorLayer
}

class CompositorVideoSource : VideoSource() {

    private var surface: Surface? = null
    // Bug 29.3: держим ССЫЛКУ на выходную SurfaceTexture энкодера, чтобы РЕСАЙЗИТЬ её буфер на смене
    // поворота БЕЗ пересоздания (и без рестарта композитора → камера не переоткрывается).
    private var outputSurfaceTexture: SurfaceTexture? = null
    private var eglCore: EglCore? = null
    private var eglSurface: EGLSurface? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var running = false
    private var encW = 1920
    private var encH = 1080

    private var renderer: GlQuadRenderer? = null

    // ── Двухпроходный рендер через FBO (bug 29.2, отвязка камеры от холста) ──────────────
    // Проход 1: рисуем сцену (камера в НАТИВНОМ 16:9-буфере + оверлеи) в ФИКСИРОВАННЫЙ 16:9 FBO —
    // аспект-корректно, БЕЗ поворота холста. Проход 2: блитим FBO-текстуру в выходной кадр (encW×encH)
    // с поворотом холста (поворот тексов: FBO 1920×1080 повёрнутый 90° = 1080×1920 = портретный выход,
    // 1:1, без искажения). Камера ВСЕГДА 16:9, не сжимается; поворот — отдельный финальный шаг.
    private var sceneFbo = 0
    private var sceneTex = 0
    private val canvasTexM = FloatArray(16) // матрица поворота тексов для прохода 2 (переиспользуем)

    // Упорядоченный список слоёв (z-order СНИЗУ ВВЕРХ) — из Scene. Камера и картинки РАВНОПРАВНЫ
    // и идут в порядке сцены (камера переставляема, как в OBS).
    @Volatile private var requestedLayers: List<CompositorLayer> = emptyList()
    private val uploaded = ArrayList<Pair<Bitmap, Int>>() // (bitmap, texId) для картинок-слоёв

    // ── Поворот ХОЛСТА (interview_006, Phase 3) ─────────────────────────────
    // Глобальный поворот НАД сценой: сцена всегда компонуется в логическом 16:9, а весь готовый
    // композит ворочается на 0/90/180/270 (90/270 → выходной кадр 9:16, encW/encH уже свапнуты
    // стримером через prepareVideo). Сцена о повороте «не знает» — слои крутятся вместе с холстом.
    @Volatile private var canvasRotation = 0

    // bug 32 / указание Криника — АСПЕКТ камеры-источника (ширина/высота). Камеру рисуем в её РОДНОМ
    // аспекте, без искажения: если он ≠ аспекту сцены (16:9), вписываем камеру-квад с полосами
    // (пилларбокс/леттербокс). UVC 16:9 → 16/9 → без изменений. Ставит опенер через setCameraAspect.
    @Volatile private var cameraAspect = SCENE_ASPECT

    /** bug 32 — сообщить аспект текущего источника камеры (ширина/высота). Опенер зовёт при open(). */
    fun setCameraAspect(aspect: Float) {
        if (aspect > 0f) cameraAspect = aspect
    }

    /** Задать глобальный поворот холста (0/90/180/270, CW). Применяется со следующего кадра. */
    fun setCanvasRotation(degrees: Int) {
        canvasRotation = ((degrees % 360) + 360) % 360
        KLog.i(TAG, "canvasRotation = $canvasRotation°")
    }

    /**
     * Bug 29.3 — сменить РАЗМЕР холста (портрет↔пейзаж) БЕЗ рестарта композитора и БЕЗ переоткрытия
     * камеры. Криник: «камера ВООБЩЕ не должна знать, что канвас ворочают — поток непрерывный».
     * На GL-потоке: ресайзим буфер ВЫХОДНОЙ поверхности и буфер камеры (тот же аспект, что и раньше —
     * камера-буфер = размеру холста, это load-bearing для аспект-корректности, см. drawFrame), обновляем
     * encW/encH (viewport). SurfaceTexture НЕ пересоздаём → камера-продюсер продолжает писать, НЕ
     * закрывается. Никакого onCameraSurfaceReady. Вызывается вместо changeVideoSource на смене поворота.
     */
    fun resizeCanvasKeepingCamera(w: Int, h: Int) {
        if (w <= 0 || h <= 0) return
        handler?.post {
            if (!running) return@post
            encW = w
            encH = h
            // Ресайзим ТОЛЬКО выходной буфер энкодера (проход 2 рисует в encW×encH). Камера-буфер и
            // FBO-сцена ФИКСИРОВАНЫ 16:9 (проход 1) — их НЕ трогаем: камера не сжимается и не
            // переоткрывается, поток непрерывен (bug 29.2/29.3).
            runCatching { outputSurfaceTexture?.setDefaultBufferSize(w, h) }
            KLog.i(TAG, "resizeCanvasKeepingCamera → выход ${w}x${h} (камера/FBO 16:9 неизменны)")
        } ?: KLog.w(TAG, "resizeCanvasKeepingCamera: handler null (композитор не запущен)")
    }

    // Переиспользуемые матрицы кадра (аллоцируем один раз — рисуем 30 раз в секунду).
    private val canvasM = FloatArray(16)
    private val layerM = FloatArray(16)
    private val finalM = FloatArray(16)

    // ── Слой-камера (OES) ────────────────────────────────────────────────────
    // Компоновщик САМ создаёт OES-текстуру + SurfaceTexture; в неё пишет камера-продюсер (Camera2/USB/
    // виртуалка) через CameraOpener. Каждый кадр: updateTexImage + рисуем OES-квад на позиции слоя камеры.
    private var cameraOesTex = 0
    private var cameraSurfaceTexture: SurfaceTexture? = null
    @Volatile private var newCameraFrame = false
    private val cameraTexMatrix = FloatArray(16)
    // Вызывается, когда у слоя-камеры готова/исчезла SurfaceTexture (RtmpStreamer → откроет камеру).
    @Volatile var onCameraSurfaceReady: ((SurfaceTexture?) -> Unit)? = null

    // Idea 17 — отложенный захват фото: callback выполняется на GL-потоке после отрисовки кадра.
    @Volatile private var pendingCapture: ((Bitmap?) -> Unit)? = null

    /**
     * Idea 17 — захватить ТЕКУЩИЙ композит-кадр (то, что видит зритель) в Bitmap. Чтение пикселей
     * (`glReadPixels`) делается на GL-потоке сразу после отрисовки слоёв, [onResult] вызывается оттуда же
     * (RtmpStreamer публикует в галерею в IO-корутине). null — если композитор не запущен/ошибка.
     */
    fun capturePhoto(onResult: (Bitmap?) -> Unit) {
        if (!running) { onResult(null); return }
        pendingCapture = onResult
    }

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
        outputSurfaceTexture = surfaceTexture   // держим для live-ресайза (bug 29.3)
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
            // FBO логической сцены — фиксированный 16:9 (проход 1 рисует сюда).
            val (fbo, tex) = r.createFramebuffer(SCENE_W, SCENE_H)
            sceneFbo = fbo
            sceneTex = tex
            // OES-текстура + SurfaceTexture для камеры (создаём в нашем GL-контексте).
            cameraOesTex = r.createOesTexture()
            val camSt = SurfaceTexture(cameraOesTex)
            camSt.setDefaultBufferSize(SCENE_W, SCENE_H)   // НАТИВНЫЙ 16:9-буфер камеры (не зависит от холста)
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
        val r = renderer ?: return
        try {
            core.makeCurrent(es)

            // Забрать свежий кадр камеры (даже если слой камеры скрыт — чтобы не копить очередь).
            val camSt = cameraSurfaceTexture
            if (camSt != null && newCameraFrame) {
                runCatching { camSt.updateTexImage(); camSt.getTransformMatrix(cameraTexMatrix) }
                newCameraFrame = false
            }

            // ── ПРОХОД 1: сцена в 16:9 FBO (аспект-корректно, БЕЗ поворота холста) ──────────
            // Камера в нативном 16:9-буфере рисуется в 16:9 FBO → не сжимается. Поворот холста здесь
            // НЕ применяется (canvasM = identity): он отдельным финальным шагом в проходе 2.
            r.bindFramebuffer(sceneFbo)
            GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
            GLES20.glClearColor(0f, 0f, 0f, 1f)               // пустая база OBS — чёрный
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            android.opengl.Matrix.setIdentityM(canvasM, 0)     // в проходе 1 холст НЕ повёрнут
            for (layer in requestedLayers) {
                layerMatrixOf(layer)                           // T·S·PhysRot слоя (в координатах сцены)
                when (layer) {
                    is CompositorLayer.Camera -> if (cameraOesTex != 0)
                        r.draw(cameraOesTex, oes = true, texMatrix = cameraTexMatrix, posMatrix = finalM, alpha = layer.alpha)
                    is CompositorLayer.Image -> {
                        val texId = uploaded.firstOrNull { it.first === layer.bitmap }?.second
                        if (texId != null) r.draw(texId, oes = false, posMatrix = finalM, alpha = layer.alpha)
                    }
                }
            }

            // ── ПРОХОД 2: блит FBO в выходной кадр (encW×encH) с поворотом ХОЛСТА ────────────
            // Поворачиваем ТЕКСТУРНЫЕ координаты FBO на canvasRotation вокруг центра. FBO 1920×1080,
            // повёрнутый на 90°, точно = 1080×1920 = портретный выход → 1:1, без искажения. Квад — во
            // весь выходной кадр (posMatrix identity), так что аспект-коррекция не нужна.
            r.bindFramebuffer(0)
            GLES20.glViewport(0, 0, encW, encH)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            canvasTexMatrix(canvasRotation)
            r.draw(sceneTex, oes = false, texMatrix = canvasTexM, posMatrix = null, alpha = 1f)

            // Idea 17 — захват фото: читаем готовый ВЫХОДНОЙ кадр ДО swap (то, что видит зритель, с поворотом).
            val cap = pendingCapture
            if (cap != null) {
                pendingCapture = null
                val bmp = runCatching { readPixelsToBitmap(encW, encH) }
                    .onFailure { KLog.w(TAG, "capturePhoto: glReadPixels failed: ${it.message}") }
                    .getOrNull()
                cap(bmp)
            }
            core.setPresentationTime(es, SystemClock.elapsedRealtimeNanos())
            core.swapBuffers(es)
        } catch (e: Exception) {
            KLog.w(TAG, "drawFrame failed: ${e.message}")
        }
    }

    // Матрица поворота ТЕКСТУРНЫХ координат FBO на [deg]° (CW) вокруг центра (0.5,0.5) для прохода 2.
    // FBO — 2D-текстура (в GlQuadRenderer 2D-путь домножает V-flip внутри), поэтому здесь только поворот.
    // Знак минус: положительный canvasRotation = по часовой (как розовая кнопка, Bug 10).
    private fun canvasTexMatrix(deg: Int) {
        android.opengl.Matrix.setIdentityM(canvasTexM, 0)
        android.opengl.Matrix.translateM(canvasTexM, 0, 0.5f, 0.5f, 0f)
        android.opengl.Matrix.rotateM(canvasTexM, 0, -deg.toFloat(), 0f, 0f, 1f)
        android.opengl.Matrix.translateM(canvasTexM, 0, -0.5f, -0.5f, 0f)
    }

    // Прочитать текущий кадр из GL (RGBA) в Bitmap. GL-начало координат — снизу-слева, поэтому
    // переворачиваем по вертикали. Вызывать ТОЛЬКО на GL-потоке с текущим контекстом.
    private fun readPixelsToBitmap(w: Int, h: Int): Bitmap {
        val buf = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder())
        GLES20.glReadPixels(0, 0, w, h, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
        buf.rewind()
        val raw = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        raw.copyPixelsFromBuffer(buf)
        val flip = Matrix().apply { postScale(1f, -1f, w / 2f, h / 2f) }
        val out = Bitmap.createBitmap(raw, 0, 0, w, h, flip, false)
        if (out !== raw) raw.recycle()
        return out
    }

    // Сцена компонуется в логическом 16:9 (interview_006 Q2: «сцена = слои в холсте 16 на 9»).
    // Нужен для аспект-корректного поворота СОДЕРЖИМОГО слоя в clip-space (units не квадратные).
    private companion object {
        const val SCENE_ASPECT = 16f / 9f
        // Фиксированный логический холст сцены (проход 1) + нативный буфер камеры — ВСЕГДА 16:9,
        // НЕ зависит от ориентации выходного кадра. Отсюда камера не сжимается ни в портрете, ни в пейзаже.
        const val SCENE_W = 1920
        const val SCENE_H = 1080
    }

    /**
     * Собрать в [finalM] полную матрицу слоя: R_canvas × T(cx,cy) × S(scale) × PhysRot(rotation).
     *
     * • T/S — PiP-трансформа: полноэкранный квад [-1..1] масштабируется на scale и сдвигается в
     *   центр (cx,cy)∈[0,1]; экранный Y (сверху-вниз) → clip-Y флипается (cy=0 → ty=+1).
     * • PhysRot — поворот СОДЕРЖИМОГО слоя (interview_006 Q3, «как в Photoshop»): в clip-space
     *   единицы не квадратные, поэтому поворот заворачивается в аспект-коррекцию
     *   S(1/a,1)·R(−deg)·S(a,1), a = 16/9 — иначе повёрнутый слой сплющится. Повёрнутый на 90°
     *   полнокадровый слой ВЫХОДИТ за холст по вертикали (честная Photoshop-семантика) — блогер
     *   ужимает его scale'ом.
     * • R_canvas — поворот холста (уже в [canvasM], считается раз на кадр).
     * android.opengl.Matrix пост-умножает: цепочка I→translate→scale→rotate даёт T·S·R (R первым к вершине).
     */
    private fun layerMatrixOf(layer: CompositorLayer) {
        val tx = 2f * layer.cx - 1f
        val ty = 1f - 2f * layer.cy
        android.opengl.Matrix.setIdentityM(layerM, 0)
        android.opengl.Matrix.translateM(layerM, 0, tx, ty, 0f)
        android.opengl.Matrix.scaleM(layerM, 0, layer.scale, layer.scale, 1f)
        if (layer.rotation != 0) {
            android.opengl.Matrix.scaleM(layerM, 0, 1f / SCENE_ASPECT, 1f, 1f)
            android.opengl.Matrix.rotateM(layerM, 0, -layer.rotation.toFloat(), 0f, 0f, 1f)
            android.opengl.Matrix.scaleM(layerM, 0, SCENE_ASPECT, 1f, 1f)
        }
        // bug 32 — вписываем КАМЕРУ в её квад с сохранением РОДНОГО аспекта (без растяга). Если аспект
        // источника ≠ 16:9 сцены — ужимаем квад по одной оси (полосы), а не тянем. Innermost (к вершине
        // первым): сырой квад → аспект-фит → [поворот] → масштаб → сдвиг. UVC 16:9 → фактор 1, no-op.
        if (layer is CompositorLayer.Camera && kotlin.math.abs(cameraAspect - SCENE_ASPECT) > 0.01f) {
            val a = cameraAspect / SCENE_ASPECT
            if (a < 1f) android.opengl.Matrix.scaleM(layerM, 0, a, 1f, 1f)      // уже 16:9 → полосы по бокам
            else android.opengl.Matrix.scaleM(layerM, 0, 1f, 1f / a, 1f)        // шире 16:9 → полосы сверху/снизу
        }
        android.opengl.Matrix.multiplyMM(finalM, 0, canvasM, 0, layerM, 0)
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
            runCatching { if (sceneFbo != 0) renderer?.deleteFramebuffer(sceneFbo) }
            runCatching { if (sceneTex != 0) renderer?.deleteTexture(sceneTex) }
            sceneFbo = 0; sceneTex = 0
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
        outputSurfaceTexture = null
        KLog.d(TAG, "Compositor stopped")
    }

    override fun release() = stop()

    override fun isRunning(): Boolean = running
}
