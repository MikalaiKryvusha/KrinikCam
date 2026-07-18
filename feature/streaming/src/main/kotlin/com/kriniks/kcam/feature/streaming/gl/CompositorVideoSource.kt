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

// plans/sourses_timeout — заглушка «нет сигнала» как СОСТОЯНИЕ слоя-камеры (Криник: «живёт ВНУТРИ слоя»).
private const val STANDBY_HOLD_MS = 10_000L   // держим последний кадр до показа заглушки (Криник: до 10с)
private const val STANDBY_FADE_MS = 500f      // плавный фейд появления/исчезновения заглушки
private const val STANDBY_PULSE_MS = 1600f    // период «дыхания» заголовка (пульс альфы, как старое превью)
private const val STANDBY_PULSE_MIN = 0.55f   // минимальная альфа заголовка в пульсе (макс = 1.0)

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

    // bug 19 (Криник: «камеру вращаем сами» → композитор знает ориентацию сенсора) — базовый поворот
    // КОНТЕНТА камеры до вертикали + зеркало фронталки. Встроенные Camera2-камеры отдают буфер в
    // координатах сенсора (SENSOR_ORIENTATION, у фронталки + зеркало). Приводим к «прямому» виду ЗДЕСЬ,
    // поворачивая ТЕКСТУРНЫЕ координаты OES вокруг центра (0.5,0.5). UVC/виртуалка: deg=0, mirror=false.
    @Volatile private var cameraSensorRotation = 0
    @Volatile private var cameraMirror = false

    /** bug 19 — ориентация сенсора камеры-источника (CW, чтобы выпрямить) + зеркало (фронталка). */
    fun setCameraOrientation(degrees: Int, mirror: Boolean) {
        cameraSensorRotation = ((degrees % 360) + 360) % 360
        cameraMirror = mirror
        KLog.i(TAG, "cameraSensorRotation=$cameraSensorRotation° mirror=$mirror")
    }

    // Эффективная tex-матрица камеры = базовая (от SurfaceTexture) с поворотом на sensorRotation и
    // зеркалом вокруг центра texcoord (0.5,0.5). Пересобирается на GL-потоке каждый кадр.
    private val cameraDrawTexMatrix = FloatArray(16)
    private val texRot = FloatArray(16)
    private fun buildCameraDrawTexMatrix() {
        android.opengl.Matrix.setIdentityM(texRot, 0)
        android.opengl.Matrix.translateM(texRot, 0, 0.5f, 0.5f, 0f)
        if (cameraSensorRotation != 0)
            android.opengl.Matrix.rotateM(texRot, 0, cameraSensorRotation.toFloat(), 0f, 0f, 1f)
        if (cameraMirror) android.opengl.Matrix.scaleM(texRot, 0, -1f, 1f, 1f)
        android.opengl.Matrix.translateM(texRot, 0, -0.5f, -0.5f, 0f)
        // Сначала базовая tex-матрица SurfaceTexture, затем наш поворот/зеркало вокруг центра.
        android.opengl.Matrix.multiplyMM(cameraDrawTexMatrix, 0, cameraTexMatrix, 0, texRot, 0)
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
    fun resizeCanvasKeepingCamera(w: Int, h: Int, rotation: Int) {
        if (w <= 0 || h <= 0) return
        handler?.post {
            if (!running) return@post
            // АТОМАРНО (в одном GL-посте): поворот холста И новый размер выхода. Иначе поворот (volatile-
            // поле, применяется сразу) обгонял отложенный ресайз → несколько кадров рендерились с НОВЫМ
            // поворотом, но СТАРЫМ размером выхода (портрет-поворот в ландшафт-буфер) → сцена (видео И
            // заглушка) «прыгала» вбок и возвращалась. Теперь один и тот же drawFrame видит оба изменения.
            canvasRotation = ((rotation % 360) + 360) % 360
            encW = w
            encH = h
            // Ресайзим ТОЛЬКО выходной буфер энкодера (проход 2 рисует в encW×encH). Камера-буфер и
            // FBO-сцена ФИКСИРОВАНЫ 16:9 (проход 1) — их НЕ трогаем: камера не сжимается и не
            // переоткрывается, поток непрерывен (bug 29.2/29.3).
            runCatching { outputSurfaceTexture?.setDefaultBufferSize(w, h) }
            KLog.i(TAG, "resizeCanvasKeepingCamera → выход ${w}x${h}, поворот ${canvasRotation}° (атомарно; камера/FBO 16:9 неизменны)")
        } ?: KLog.w(TAG, "resizeCanvasKeepingCamera: handler null (композитор не запущен)")
    }

    // Переиспользуемые матрицы кадра (аллоцируем один раз — рисуем 30 раз в секунду).
    private val canvasM = FloatArray(16)
    private val layerM = FloatArray(16)
    private val finalM = FloatArray(16)
    private val standbyM = FloatArray(16)   // finalM + контр-поворот заглушки против поворота холста

    /**
     * Матрица для ТЕКСТА заглушки: как finalM слоя, но с КОНТР-поворотом против поворота холста (pass-2),
     * чтобы текст оставался ВЕРТИКАЛЬНО ПРАВИЛЬНЫМ и в портрете (90/270), а не лежал набок (Криник).
     * Кадр камеры/снапшот крутится с холстом как видео (finalM); контр-поворот — ТОЛЬКО у текста заглушки.
     * Поворот аспект-корректный (сцена 16:9, единицы clip-space не квадратные) — как у layer.rotation.
     */
    private fun buildStandbyMatrix() {
        if (canvasRotation == 0) { System.arraycopy(finalM, 0, standbyM, 0, 16); return }
        android.opengl.Matrix.setIdentityM(standbyM, 0)
        android.opengl.Matrix.scaleM(standbyM, 0, 1f / SCENE_ASPECT, 1f, 1f)
        android.opengl.Matrix.rotateM(standbyM, 0, -canvasRotation.toFloat(), 0f, 0f, 1f)
        android.opengl.Matrix.scaleM(standbyM, 0, SCENE_ASPECT, 1f, 1f)
        android.opengl.Matrix.multiplyMM(standbyM, 0, standbyM, 0, finalM, 0)
    }

    // ── Слой-камера (OES) ────────────────────────────────────────────────────
    // Компоновщик САМ создаёт OES-текстуру + SurfaceTexture; в неё пишет камера-продюсер (Camera2/USB/
    // виртуалка) через CameraOpener. Каждый кадр: updateTexImage + рисуем OES-квад на позиции слоя камеры.
    private var cameraOesTex = 0
    private var cameraSurfaceTexture: SurfaceTexture? = null
    @Volatile private var newCameraFrame = false
    private val cameraTexMatrix = FloatArray(16)

    // ── Пинг-понг снапшот кадра камеры (требования Криника а/б/в — стрим-заглушка без косяков) ──────────
    // Держим ДВА последних кадра камеры в 2D-текстурах и меняем read↔write на каждый живой кадр так, что
    // READ = ПРЕДПОСЛЕДНИЙ кадр. Слой-камеры ВСЕГДА рисует READ-снапшот (не сырой OES):
    //   • живое — кадр с лагом в 1 фрейм (незаметно);
    //   • отвал вебки (б) — держим ХОРОШИЙ кадр; битый/чёрный ПОСЛЕДНИЙ кадр закрытия всегда попадает в
    //     WRITE и на экран НЕ выходит (показываем предпоследний хороший);
    //   • реконнект ≤3с (а) — во время прогрева новой (чёрной) OES показываем снапшот, не чёрную склейку;
    //   • выход из заглушки (в) — снапшот обновляется ПЕРВЫМ свежим кадром вебки ДО того, как заглушка
    //     погаснет, поэтому заглушка фейдит именно в свежий поток, а не в старый кадр буфера.
    private var freezeFbo = 0
    private var freezeReadTex = 0
    private var freezeWriteTex = 0
    private var hasSnapshot = false
    private val snapIdentity = FloatArray(16).also { android.opengl.Matrix.setIdentityM(it, 0) }

    // ── Заглушка слоя-камеры «нет сигнала» (plans/sourses_timeout) ───────────────────────────────
    // Рисуется ВНУТРИ квадрата слоя-камеры (двигается/масштабируется со слоем, попадает в эфир/запись),
    // когда у камеры нет свежих кадров. Логика по СВЕЖЕСТИ КАДРОВ (source-агностично, без плюмбинга сцены):
    //   • НИКОГДА не было кадра → заглушка сразу (холодный старт без камеры / явный «Нет источника»);
    //   • кадры были и пропали (hot-detach UVC) → держим последний кадр STANDBY_HOLD_MS (бесшовно, если
    //     камера вернулась быстро — зритель заглушку не увидит), затем плавно фейдим заглушку;
    //   • кадры вернулись → плавно фейдим заглушку обратно к живому видео.
    // Всё — плавным STANDBY_FADE_MS. Битмап задаёт RtmpStreamer через setStandbyBitmap (StandbyImage).
    // Два текстур-слоя заглушки: ЗАГОЛОВОК (пульсирует альфой — Криник) + ПОДПИСЬ (статична).
    @Volatile private var standbyTitleBitmap: Bitmap? = null
    @Volatile private var standbyBodyBitmap: Bitmap? = null
    private var standbyTitleTex = 0
    private var standbyBodyTex = 0
    private var lastCameraFrameAtMs = 0L     // elapsedRealtime последнего забранного кадра камеры
    private var hasEverHadFrame = false      // был ли ХОТЬ ОДИН кадр (иначе — заглушка сразу, без hold)
    private var standbyAlpha = 0f            // текущая (сглаженная) прозрачность заглушки 0..1
    private var standbyPulse = 1f            // множитель альфы заголовка (пульс «дыхания») 0.55..1.0
    private var lastFadeClockMs = 0L         // для dt фейда, независимого от джиттера рендер-цикла

    // Заморозка кадра при УДАЛЕНИИ источника (Криник: «держать последний кадр, а не черноту»). Плавное
    // закрытие продюсера (select None / смена источника) при closeCamera ПУШИТ чёрный кадр в OES — если
    // его забрать, «замёрзнет» чернота. Поэтому при удалении источника приложение зовёт enterCameraStandby:
    // перестаём ЗАБИРАТЬ кадры (updateTexImage) → OES держит ПОСЛЕДНИЙ ХОРОШИЙ кадр, а чёрный кадр
    // закрытия остаётся в очереди непрочитанным. exitCameraStandby (источник вернулся) — снова забираем.
    @Volatile private var cameraFrozen = false

    /** Источник камеры-слоя удалён — заморозить OES на последнем хорошем кадре (не забирать чёрный кадр закрытия). */
    fun enterCameraStandby() {
        handler?.post { cameraFrozen = true } ?: run { cameraFrozen = true }
        KLog.i(TAG, "enterCameraStandby — держим последний кадр слоя-камеры (plans/sourses_timeout)")
    }

    /** Источник камеры-слоя вернулся — снова забираем кадры (заглушка плавно уйдёт по свежести). */
    fun exitCameraStandby() {
        // Сбрасываем флаг «есть новый кадр»: в очереди мог остаться непрочитанный чёрный кадр закрытия —
        // не забираем его, ждём первый ЖИВОЙ кадр нового продюсера (иначе мелькнёт чернота при возврате).
        handler?.post { cameraFrozen = false; newCameraFrame = false } ?: run { cameraFrozen = false }
        KLog.i(TAG, "exitCameraStandby — возобновляем живые кадры слоя-камеры")
    }

    /** plans/sourses_timeout — задать битмапы заглушки: [title] пульсирует, [body] статична. RtmpStreamer при init. */
    fun setStandbyBitmaps(title: Bitmap, body: Bitmap) {
        standbyTitleBitmap = title
        standbyBodyBitmap = body
        handler?.post { uploadStandby() }
    }

    // GL-поток: залить/перезалить текстуры заглушки (заголовок + подпись).
    private fun uploadStandby() {
        val r = renderer ?: return
        standbyTitleBitmap?.let { if (standbyTitleTex != 0) r.deleteTexture(standbyTitleTex); standbyTitleTex = r.uploadBitmap(it) }
        standbyBodyBitmap?.let { if (standbyBodyTex != 0) r.deleteTexture(standbyBodyTex); standbyBodyTex = r.uploadBitmap(it) }
    }
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

    /**
     * Пересоздать OES+SurfaceTexture слоя-камеры для НОВОГО продюсера (чистый BufferQueue).
     *
     * Зачем (bug 31 + реконнект): старый продюсер (AUSBC/HWUI/Camera2) при закрытии/отвале оставляет
     * BufferQueue поверхности в состоянии, из которого новый продюсер НЕ доставляет кадры до консюмера-OES
     * (превью мёрзло) либо ловится HWUI-краш «no surface». Свежая OES+ST = чистое окно новому продюсеру.
     *
     * Бесшовность обеспечивает НЕ эта функция, а пинг-понг СНАПШОТ (см. поля freeze*): слой рисует не
     * сырой (свежий чёрный) OES, а снапшот с последним хорошим кадром — пока новый продюсер не отдаст
     * живой кадр (который обновит снапшот). Поэтому свежую чёрную OES можно смело пересоздавать здесь —
     * на экран она не попадёт. Таймер свежести НЕ трогаем: если показана заглушка, она держится, пока не
     * придёт первый живой кадр нового потока (тогда снапшот обновится и заглушка фейдит в свежий поток).
     * Продюсер должен быть уже ЗАКРЫТ вызывающим.
     */
    fun recreateCameraSurface() {
        val h = handler ?: return
        h.post {
            if (!running) return@post
            val r = renderer ?: return@post
            runCatching { eglSurface?.let { eglCore?.makeCurrent(it) } }
            runCatching { cameraSurfaceTexture?.setOnFrameAvailableListener(null) }
            runCatching { cameraSurfaceTexture?.release() }
            if (cameraOesTex != 0) runCatching { GLES20.glDeleteTextures(1, intArrayOf(cameraOesTex), 0) }
            cameraOesTex = r.createOesTexture()
            val camSt = SurfaceTexture(cameraOesTex)
            camSt.setDefaultBufferSize(SCENE_W, SCENE_H)
            camSt.setOnFrameAvailableListener { newCameraFrame = true }
            cameraSurfaceTexture = camSt
            newCameraFrame = false
            cameraFrozen = false
            KLog.d(TAG, "Camera layer OES/SurfaceTexture RECREATED (чистое окно новому продюсеру; снапшот держит кадр)")
            onCameraSurfaceReady?.invoke(camSt)
        }
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
            // Пинг-понг снапшот кадра камеры: один FBO + две 2D-текстуры (read/write), обе в чёрный.
            freezeFbo = r.createFramebuffer(SCENE_W, SCENE_H).let { (ffb, ftx) -> freezeReadTex = ftx; ffb }
            freezeWriteTex = r.createColorTexture(SCENE_W, SCENE_H)
            hasSnapshot = false
            for (ftex in intArrayOf(freezeReadTex, freezeWriteTex)) {
                r.setFramebufferColor(freezeFbo, ftex)
                GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
                GLES20.glClearColor(0f, 0f, 0f, 1f); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            }
            // OES-текстура + SurfaceTexture для камеры (создаём в нашем GL-контексте).
            cameraOesTex = r.createOesTexture()
            val camSt = SurfaceTexture(cameraOesTex)
            camSt.setDefaultBufferSize(SCENE_W, SCENE_H)   // НАТИВНЫЙ 16:9-буфер камеры (не зависит от холста)
            camSt.setOnFrameAvailableListener { newCameraFrame = true }
            cameraSurfaceTexture = camSt
            syncTextures() // залить уже запрошенные слои-картинки
            // Заглушка «нет сигнала»: залить текстуру + сбросить таймеры свежести на старте композитора.
            uploadStandby()
            lastCameraFrameAtMs = SystemClock.elapsedRealtime()
            hasEverHadFrame = false
            standbyAlpha = 0f
            lastFadeClockMs = 0L
            cameraFrozen = false
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

    /**
     * Пинг-понг снапшот текущего кадра камеры (вызывать на GL-потоке после забора кадра + сборки
     * cameraDrawTexMatrix). Меняем read↔write, затем рисуем текущий OES в write-текстуру. После вызова:
     * READ = предыдущий кадр (предпоследний), WRITE = текущий. Слой рисует READ — так последний (возможно
     * битый/чёрный) кадр не выходит на экран (он в write). Ориентация: рисуем OES с cameraDrawTexMatrix во
     * весь FBO (posMatrix=null), позже слой рисует read-текстуру с snapIdentity+finalM — как sceneTex.
     */
    private fun snapshotCameraFrame(r: GlQuadRenderer) {
        if (cameraOesTex == 0 || freezeFbo == 0) return
        val tmp = freezeReadTex; freezeReadTex = freezeWriteTex; freezeWriteTex = tmp
        r.setFramebufferColor(freezeFbo, freezeWriteTex)
        GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        r.draw(cameraOesTex, oes = true, texMatrix = cameraDrawTexMatrix, posMatrix = null, alpha = 1f)
        hasSnapshot = true
    }

    private fun drawFrame() {
        val core = eglCore ?: return
        val es = eglSurface ?: return
        val r = renderer ?: return
        try {
            core.makeCurrent(es)

            // Забрать свежий кадр камеры (даже если слой камеры скрыт — чтобы не копить очередь).
            val camSt = cameraSurfaceTexture
            // cameraFrozen: источник удалён софтом — не забираем кадры (держим последний OES/снапшот/таймер).
            var consumedFrame = false
            if (camSt != null && newCameraFrame && !cameraFrozen) {
                runCatching { camSt.updateTexImage(); camSt.getTransformMatrix(cameraTexMatrix) }
                newCameraFrame = false
                // Заглушка: отметить приход живого кадра (сбрасывает hold-таймер, снимает «не было кадра»).
                lastCameraFrameAtMs = SystemClock.elapsedRealtime()
                hasEverHadFrame = true
                consumedFrame = true
            }
            // bug 19 — собрать эффективную tex-матрицу камеры (базовая + sensor-поворот + зеркало).
            buildCameraDrawTexMatrix()

            // Пинг-понг снапшот: на КАЖДЫЙ забранный кадр рисуем текущий OES в write-снапшот и меняем
            // read↔write, так что READ = ПРЕДПОСЛЕДНИЙ кадр. Слой рисует READ → битый/чёрный последний
            // кадр (напр. teardown при физическом отвале) остаётся в WRITE и на экран не выходит
            // (требования Криника а/б/в: держим хороший кадр, реконнект без чёрной склейки).
            if (consumedFrame) snapshotCameraFrame(r)

            // ── Заглушка «нет сигнала»: цель прозрачности по свежести кадров, плавно едем к ней ──────
            // wantStandby: не было ни одного кадра (сразу) ИЛИ кадров нет дольше HOLD_MS (после hold).
            // standbyAlpha сглаживаем с шагом dt/FADE_MS — фейд ровно STANDBY_FADE_MS в обе стороны.
            run {
                val nowMs = SystemClock.elapsedRealtime()
                val wantStandby = !hasEverHadFrame || (nowMs - lastCameraFrameAtMs) >= STANDBY_HOLD_MS
                val target = if (wantStandby) 1f else 0f
                val dt = if (lastFadeClockMs == 0L) FRAME_MS.toFloat() else (nowMs - lastFadeClockMs).toFloat()
                lastFadeClockMs = nowMs
                val step = (dt / STANDBY_FADE_MS).coerceIn(0f, 1f)
                standbyAlpha =
                    if (target > standbyAlpha) (standbyAlpha + step).coerceAtMost(target)
                    else (standbyAlpha - step).coerceAtLeast(target)
                // Пульс «дыхания» заголовка: синус по времени, альфа STANDBY_PULSE_MIN..1.0 (как старое превью).
                val phase = (nowMs % STANDBY_PULSE_MS.toLong()) / STANDBY_PULSE_MS
                val wave = 0.5f + 0.5f * kotlin.math.sin(phase * 2f * Math.PI.toFloat())
                standbyPulse = STANDBY_PULSE_MIN + (1f - STANDBY_PULSE_MIN) * wave
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
                    is CompositorLayer.Camera -> {
                        // Рисуем СНАПШОТ (read = предпоследний ХОРОШИЙ кадр), а НЕ сырой OES: при отвале
                        // держим хороший кадр (битый последний — в write, на экран не выходит), при
                        // реконнекте показываем его же, пока новый поток не обновит снапшот (без чёрной
                        // склейки). Кадр ГАСНЕТ под заглушкой (frameAlpha=1−standbyAlpha): hold → кадр виден,
                        // текста нет; после hold → кадр угасает, остаётся только текст (Криник: «заглушка БЕЗ кадра»).
                        if (hasSnapshot && freezeReadTex != 0) {
                            val frameAlpha = layer.alpha * (1f - standbyAlpha)
                            if (frameAlpha > 0.001f)
                                r.draw(freezeReadTex, oes = false, texMatrix = snapIdentity, posMatrix = finalM, alpha = frameAlpha)
                        }
                        // Заглушка (только текст) В КВАДРАТЕ ЭТОГО слоя — двигается/масштабируется со слоем,
                        // попадает в эфир/запись. КОНТР-поворот (standbyM) держит текст вертикально правильным
                        // и в портрете (90/270). Подпись — статична; ЗАГОЛОВОК пульсирует альфой (standbyPulse).
                        if (standbyAlpha > 0.001f) {
                            buildStandbyMatrix()
                            val base = standbyAlpha * layer.alpha
                            if (standbyBodyTex != 0)
                                r.draw(standbyBodyTex, oes = false, posMatrix = standbyM, alpha = base)
                            if (standbyTitleTex != 0)
                                r.draw(standbyTitleTex, oes = false, posMatrix = standbyM, alpha = base * standbyPulse)
                        }
                    }
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
        // bug 32 / idea 35 — вписываем слой в его квад с сохранением РОДНОГО аспекта (без растяга).
        // Если аспект слоя ≠ 16:9 сцены — ужимаем квад по одной оси (полосы), а не тянем. Аспект:
        // камера = cameraAspect; картинка = аспект bitmap (idea 35: картинки больше не letterbox'ятся
        // в 16:9, ведём родной аспект). Innermost (к вершине первым): сырой квад → аспект-фит →
        // [поворот] → масштаб → сдвиг. 16:9-слой → фактор 1, no-op.
        val layerAspect = when (layer) {
            is CompositorLayer.Camera -> cameraAspect
            is CompositorLayer.Image ->
                if (layer.bitmap.height > 0) layer.bitmap.width.toFloat() / layer.bitmap.height else SCENE_ASPECT
        }
        if (kotlin.math.abs(layerAspect - SCENE_ASPECT) > 0.01f) {
            val a = layerAspect / SCENE_ASPECT
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
            runCatching { if (standbyTitleTex != 0) renderer?.deleteTexture(standbyTitleTex) }
            runCatching { if (standbyBodyTex != 0) renderer?.deleteTexture(standbyBodyTex) }
            standbyTitleTex = 0; standbyBodyTex = 0
            runCatching { cameraSurfaceTexture?.release() }
            cameraSurfaceTexture = null
            runCatching { if (cameraOesTex != 0) renderer?.deleteTexture(cameraOesTex) }
            cameraOesTex = 0
            // Пинг-понг снапшот: освободить FBO + обе текстуры.
            runCatching { if (freezeFbo != 0) renderer?.deleteFramebuffer(freezeFbo) }
            runCatching { if (freezeReadTex != 0) renderer?.deleteTexture(freezeReadTex) }
            runCatching { if (freezeWriteTex != 0) renderer?.deleteTexture(freezeWriteTex) }
            freezeFbo = 0; freezeReadTex = 0; freezeWriteTex = 0; hasSnapshot = false
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
