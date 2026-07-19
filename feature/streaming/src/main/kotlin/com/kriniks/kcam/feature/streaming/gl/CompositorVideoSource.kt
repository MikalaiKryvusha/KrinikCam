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
// bug 62 — свежесозданному слоту (go-live/stop РЕИНИТит GL → слот пересоздаётся с hasEverHadFrame=false)
// даём время догнать ПЕРВЫЙ кадр ПЕРЕД показом заглушки. Иначе на старте/стопе трансляции заглушка мигает,
// пока камера-продюсер переоткрывается. Для слота без кадров это окно = время с момента его создания (initGl).
private const val STANDBY_STARTUP_GRACE_MS = 2500L
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

    /**
     * Слой камеры (OES external texture). [id] — id слоя сцены: ключ per-слойного ресурса камеры
     * (CameraSlot: своя OES/SurfaceTexture/снапшот/заглушка). Несколько Camera-слоёв с разными id =
     * НЕЗАВИСИМЫЕ камеры одновременно (мульти-источники, idea 21 Фаза B).
     *
     * [mirrorOf] (bug 58 / шаринг фида) — если задан, слой НЕ держит своего продюсера, а РИСУЕТ кадр
     * слота слоя-ПЕРВИЧНОГО [mirrorOf] со СВОЕЙ трансформой (как OBS «дублировать источник»). Так один
     * физический источник (одно открытие устройства) раздаётся в несколько слоёв — без второго open
     * того же устройства (который крешил, bug 58). null = слой сам первичный (свой слот/продюсер).
     */
    data class Camera(
        val id: String = "camera",
        val mirrorOf: String? = null,
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

    // Колбэк «отрисован первый кадр НОВОГО размера» — для синхронизации превью-GL RootEncoder с ресайзом
    // холста (портрет↔ландшафт) без прыжка: RootEncoder переключает вьюпорт только после готового кадра.
    @Volatile private var onResizedFrameReady: (() -> Unit)? = null

    // #3 (Криник) — флаг «есть СВЕЖИЙ кадр хотя бы у одного слоя-камеры». Обновляется на GL-потоке в
    // drawFrame; читается снаружи (schedulePreviewRestoreAfterStream), чтобы ОТЛОЖИТЬ re-attach превью до
    // живого кадра и не цеплять его на чёрный кадр (интермиттентное мигание в чёрный на старте эфира).
    @Volatile private var anyLiveCameraFrame = false

    /** #3 — есть ли живой кадр камеры (или слоёв-камер нет вовсе — ждать нечего). Читается извне. */
    fun hasLiveCameraContent(): Boolean = anyLiveCameraFrame

    /**
     * CameraSlot — ВСЁ per-слой состояние камеры (мульти-источники, idea 21 Фаза B). У каждого слоя-камеры
     * (по id) — своя OES-текстура + SurfaceTexture (свой продюсер), свой пинг-понг снапшот (два кадра, держим
     * предпоследний хороший), своя заглушка (свежесть/заморозка/фейд/пульс), свой sensor-поворот и аспект.
     * Раньше это был единый набор полей → все слои-камеры делили одну камеру; теперь независимо.
     * Ресурсы создаются/удаляются СТРОГО на GL-потоке (create/recreate/release зовём оттуда).
     */
    private inner class CameraSlot(val id: String) {
        var oesTex = 0
        var surfaceTexture: SurfaceTexture? = null
        @Volatile var newFrame = false
        val texMatrix = FloatArray(16)
        val drawTexMatrix = FloatArray(16)
        private val slotTexRot = FloatArray(16)
        @Volatile var sensorRotation = 0
        @Volatile var mirror = false
        @Volatile var aspect = SCENE_ASPECT
        // Пинг-понг снапшот (см. большой коммент про требования Криника а/б/в).
        var freezeFbo = 0
        var freezeReadTex = 0
        var freezeWriteTex = 0
        var hasSnapshot = false
        // Свежесть/заглушка per-слой.
        var lastFrameAtMs = 0L
        var hasEverHadFrame = false
        @Volatile var frozen = false
        var standbyAlpha = 0f
        var standbyPulse = 1f
        var lastFadeClockMs = 0L

        /** Создать OES+SurfaceTexture + FBO-снапшот. Зовём на GL-потоке. */
        fun initGl(r: GlQuadRenderer) {
            oesTex = r.createOesTexture()
            val st = SurfaceTexture(oesTex)
            st.setDefaultBufferSize(SCENE_W, SCENE_H)
            st.setOnFrameAvailableListener { newFrame = true }
            surfaceTexture = st
            val (ffb, ftx) = r.createFramebuffer(SCENE_W, SCENE_H)
            freezeFbo = ffb; freezeReadTex = ftx
            freezeWriteTex = r.createColorTexture(SCENE_W, SCENE_H)
            hasSnapshot = false
            for (t in intArrayOf(freezeReadTex, freezeWriteTex)) {
                r.setFramebufferColor(freezeFbo, t)
                GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
                GLES20.glClearColor(0f, 0f, 0f, 1f); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            }
            lastFrameAtMs = SystemClock.elapsedRealtime()
            hasEverHadFrame = false; standbyAlpha = 0f; lastFadeClockMs = 0L; frozen = false
        }

        /** Пересоздать OES+SurfaceTexture (чистое окно новому продюсеру; bug 31/реконнект). Снапшот держит кадр. */
        fun recreate(r: GlQuadRenderer) {
            runCatching { surfaceTexture?.setOnFrameAvailableListener(null) }
            runCatching { surfaceTexture?.release() }
            if (oesTex != 0) runCatching { GLES20.glDeleteTextures(1, intArrayOf(oesTex), 0) }
            oesTex = r.createOesTexture()
            val st = SurfaceTexture(oesTex)
            st.setDefaultBufferSize(SCENE_W, SCENE_H)
            st.setOnFrameAvailableListener { newFrame = true }
            surfaceTexture = st
            newFrame = false; frozen = false
        }

        private fun buildDrawTexMatrix() {
            android.opengl.Matrix.setIdentityM(slotTexRot, 0)
            android.opengl.Matrix.translateM(slotTexRot, 0, 0.5f, 0.5f, 0f)
            if (sensorRotation != 0) android.opengl.Matrix.rotateM(slotTexRot, 0, sensorRotation.toFloat(), 0f, 0f, 1f)
            if (mirror) android.opengl.Matrix.scaleM(slotTexRot, 0, -1f, 1f, 1f)
            android.opengl.Matrix.translateM(slotTexRot, 0, -0.5f, -0.5f, 0f)
            android.opengl.Matrix.multiplyMM(drawTexMatrix, 0, texMatrix, 0, slotTexRot, 0)
        }

        private fun snapshot(r: GlQuadRenderer) {
            if (oesTex == 0 || freezeFbo == 0) return
            val tmp = freezeReadTex; freezeReadTex = freezeWriteTex; freezeWriteTex = tmp
            r.setFramebufferColor(freezeFbo, freezeWriteTex)
            GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
            GLES20.glClearColor(0f, 0f, 0f, 1f); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            r.draw(oesTex, oes = true, texMatrix = drawTexMatrix, posMatrix = null, alpha = 1f)
            hasSnapshot = true
        }

        /** Раз в кадр: забрать свежий кадр (если не frozen) → снапшот → tex-матрица → обновить альфу/пульс заглушки. */
        fun prepare(r: GlQuadRenderer, nowMs: Long) {
            val st = surfaceTexture
            var consumed = false
            if (st != null && newFrame && !frozen) {
                runCatching { st.updateTexImage(); st.getTransformMatrix(texMatrix) }
                newFrame = false
                lastFrameAtMs = nowMs
                hasEverHadFrame = true
                consumed = true
            }
            buildDrawTexMatrix()
            if (consumed) snapshot(r)
            // Заглушка: цель по свежести, плавный фейд + пульс «дыхания» (как было в едином варианте).
            // bug 62 — свежий слот (после go-live/stop реинита GL) НЕ показывает заглушку сразу: даём
            // камере STANDBY_STARTUP_GRACE_MS догнать первый кадр. Иначе на старте/стопе трансляции
            // заглушка мигала, пока продюсер переоткрывается. lastFrameAtMs у слота без кадров = момент initGl.
            val waited = nowMs - lastFrameAtMs
            val wantStandby = if (hasEverHadFrame) waited >= STANDBY_HOLD_MS else waited >= STANDBY_STARTUP_GRACE_MS
            val target = if (wantStandby) 1f else 0f
            val dt = if (lastFadeClockMs == 0L) FRAME_MS.toFloat() else (nowMs - lastFadeClockMs).toFloat()
            lastFadeClockMs = nowMs
            val step = (dt / STANDBY_FADE_MS).coerceIn(0f, 1f)
            standbyAlpha =
                if (target > standbyAlpha) (standbyAlpha + step).coerceAtMost(target)
                else (standbyAlpha - step).coerceAtLeast(target)
            val phase = (nowMs % STANDBY_PULSE_MS.toLong()) / STANDBY_PULSE_MS
            val wave = 0.5f + 0.5f * kotlin.math.sin(phase * 2f * Math.PI.toFloat())
            standbyPulse = STANDBY_PULSE_MIN + (1f - STANDBY_PULSE_MIN) * wave
        }

        fun release(r: GlQuadRenderer?) {
            runCatching { surfaceTexture?.setOnFrameAvailableListener(null) }
            runCatching { surfaceTexture?.release() }
            surfaceTexture = null
            if (oesTex != 0) runCatching { r?.deleteTexture(oesTex) }
            oesTex = 0
            if (freezeFbo != 0) runCatching { r?.deleteFramebuffer(freezeFbo) }
            if (freezeReadTex != 0) runCatching { r?.deleteTexture(freezeReadTex) }
            if (freezeWriteTex != 0) runCatching { r?.deleteTexture(freezeWriteTex) }
            freezeFbo = 0; freezeReadTex = 0; freezeWriteTex = 0; hasSnapshot = false
        }
    }

    // Слоты камер по id слоя (мульти-источники). Живут строго на GL-потоке (создание/удаление/рендер).
    private val cameraSlots = LinkedHashMap<String, CameraSlot>()

    /** bug 32 — аспект источника КОНКРЕТНОГО слоя-камеры [layerId] (ширина/высота). Опенер зовёт при open(). */
    fun setCameraAspect(layerId: String, aspect: Float) {
        if (aspect > 0f) handler?.post { cameraSlots[layerId]?.aspect = aspect }
    }

    /** bug 19 — ориентация сенсора + зеркало КОНКРЕТНОГО слоя-камеры [layerId] (опенер при open). */
    fun setCameraOrientation(layerId: String, degrees: Int, mirror: Boolean) {
        handler?.post {
            cameraSlots[layerId]?.let {
                it.sensorRotation = ((degrees % 360) + 360) % 360
                it.mirror = mirror
            }
        }
        KLog.i(TAG, "cameraSlot[$layerId] sensor=$degrees° mirror=$mirror")
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
    fun resizeCanvasKeepingCamera(w: Int, h: Int, rotation: Int, onFrameReady: (() -> Unit)? = null) {
        if (w <= 0 || h <= 0) return
        handler?.post {
            if (!running) { onFrameReady?.invoke(); return@post }
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
            // Синхронизация с превью-GL RootEncoder: НЕ дёргаем его размер сразу (тогда старый кадр
            // композитора отрисуется в НОВОМ вьюпорте → прыжок). Взводим колбэк, который сработает ПОСЛЕ
            // того, как композитор реально отрисует кадр НОВОГО размера (см. конец drawFrame). Тогда
            // RootEncoder переключит вьюпорт уже под готовый новый кадр — рассинхрон минимален.
            onResizedFrameReady = onFrameReady
            KLog.i(TAG, "resizeCanvasKeepingCamera → выход ${w}x${h}, поворот ${canvasRotation}° (атомарно; уведомлю превью-GL после первого нового кадра)")
        } ?: KLog.w(TAG, "resizeCanvasKeepingCamera: handler null (композитор не запущен)")
    }

    // Переиспользуемые матрицы кадра (аллоцируем один раз — рисуем 30 раз в секунду).
    private val canvasM = FloatArray(16)
    private val layerM = FloatArray(16)
    private val finalM = FloatArray(16)
    private val standbyM = FloatArray(16)   // finalM + контр-поворот заглушки против поворота холста

    /**
     * Матрица для ТЕКСТА заглушки: как finalM слоя, но с КОНТР-поворотом, чтобы текст не лежал НАБОК в
     * портрете (90/270), но при этом 90 и 270 отличались на 180° друг от друга (как и всё, что крутится
     * с холстом — Криник). Контр-поворот ФИКСИРОВАННЫЙ -90° для портрета (не -canvasRotation!), 0° для
     * ландшафта → итоговая ориентация заглушки в выходе: 0°/0°/180°/180° для холста 0/90/180/270. Значит
     * текст всегда горизонтальный (не набок), а 0/90 «прямо» vs 180/270 «перевёрнуто» — совпадает с
     * физическим переворотом холста на 180. Поворот аспект-корректный (сцена 16:9) — как у layer.rotation.
     * Кадр камеры/снапшот крутится с холстом как видео (finalM); контр-поворот — ТОЛЬКО у текста заглушки.
     */
    private fun buildStandbyMatrix(cx: Float, cy: Float) {
        val counter = if (canvasRotation == 90 || canvasRotation == 270) 90 else 0
        if (counter == 0) { System.arraycopy(finalM, 0, standbyM, 0, 16); return }
        // Контр-поворот вокруг ЦЕНТРА СЛОЯ (а не сцены): T(P)·[S(1/a)·R·S(a)]·T(-P)·finalM, P — центр
        // слоя в clip. Иначе (rotate вокруг origin) у PiP-слоя смещается позиция заглушки и инвертируется
        // направление её перетаскивания относительно рамки/видео (Криник: заглушка едет не за пальцем).
        val px = 2f * cx - 1f
        val py = 1f - 2f * cy
        android.opengl.Matrix.setIdentityM(standbyM, 0)
        android.opengl.Matrix.translateM(standbyM, 0, px, py, 0f)
        android.opengl.Matrix.scaleM(standbyM, 0, 1f / SCENE_ASPECT, 1f, 1f)
        android.opengl.Matrix.rotateM(standbyM, 0, counter.toFloat(), 0f, 0f, 1f)
        android.opengl.Matrix.scaleM(standbyM, 0, SCENE_ASPECT, 1f, 1f)
        android.opengl.Matrix.translateM(standbyM, 0, -px, -py, 0f)
        android.opengl.Matrix.multiplyMM(standbyM, 0, standbyM, 0, finalM, 0)
    }

    // Матрица без флипа для рисования снапшота-камеры (2D FBO-текстура read) — как sceneTex. Глобальна.
    private val snapIdentity = FloatArray(16).also { android.opengl.Matrix.setIdentityM(it, 0) }

    // ── Заглушка «нет сигнала» — ОБЩИЙ бренд-битмап для ВСЕХ слоёв-камер (текстуры глобальные; альфа/пульс
    // per-слой в CameraSlot). Рисуется ВНУТРИ квадрата каждого слоя, когда у ЕГО камеры нет свежих кадров.
    // Два текстур-слоя: ЗАГОЛОВОК (пульсирует альфой — Криник) + ПОДПИСЬ (статична). plans/sourses_timeout.
    @Volatile private var standbyTitleBitmap: Bitmap? = null
    @Volatile private var standbyBodyBitmap: Bitmap? = null
    private var standbyTitleTex = 0
    private var standbyBodyTex = 0

    /** Источник слоя [layerId] удалён — заморозить его OES на последнем хорошем кадре (Криник: держать кадр). */
    fun enterCameraStandby(layerId: String) {
        handler?.post { cameraSlots[layerId]?.frozen = true }
        KLog.i(TAG, "enterCameraStandby[$layerId] — держим последний кадр слоя")
    }

    /** Источник слоя [layerId] вернулся — снова забираем кадры (сбрасываем stale-кадр, ждём живой). */
    fun exitCameraStandby(layerId: String) {
        handler?.post { cameraSlots[layerId]?.let { it.frozen = false; it.newFrame = false } }
        KLog.i(TAG, "exitCameraStandby[$layerId] — возобновляем живые кадры слоя")
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

    /**
     * Вызывается, когда у КОНКРЕТНОГО слоя-камеры [layerId] готова/исчезла SurfaceTexture. RtmpStreamer
     * откроет продюсера ЭТОГО слоя в эту поверхность (st != null), либо закроет (st == null). Мульти-источники.
     */
    @Volatile var onCameraSurfaceReady: ((layerId: String, SurfaceTexture?) -> Unit)? = null

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
        handler?.post { syncTextures(); syncCameraSlots() }
    }

    // GL-поток: привести набор CameraSlot к слоям-камерам в requestedLayers. Новый Camera(id) → создать
    // слот (OES/ST/снапшот) + onCameraSurfaceReady(id, surface) (RtmpStreamer откроет продюсера этого слоя).
    // Слой-камера ушёл → освободить слот + onCameraSurfaceReady(id, null) (закрыть продюсера). Мульти-источники.
    private fun syncCameraSlots() {
        val r = renderer ?: return
        // Слот (продюсер+OES+снапшот) держат ТОЛЬКО ПЕРВИЧНЫЕ слои-камеры (mirrorOf == null). Зеркала
        // (mirrorOf != null) рисуют слот первичного — своего продюсера НЕ открывают (шаринг фида, bug 58).
        val wantIds = requestedLayers.filterIsInstance<CompositorLayer.Camera>()
            .filter { it.mirrorOf == null }.map { it.id }.toSet()
        // Удалить слоты слоёв, которых больше нет.
        val it = cameraSlots.iterator()
        while (it.hasNext()) {
            val (id, slot) = it.next()
            if (id !in wantIds) {
                runCatching { onCameraSurfaceReady?.invoke(id, null) } // закрыть продюсера слоя
                slot.release(r)
                it.remove()
            }
        }
        // Создать слоты для новых слоёв-камер.
        for (id in wantIds) {
            if (cameraSlots[id] == null) {
                val slot = CameraSlot(id).also { s -> s.initGl(r) }
                cameraSlots[id] = slot
                onCameraSurfaceReady?.invoke(id, slot.surfaceTexture) // откроют продюсера в неё
            }
        }
    }

    /**
     * Пересоздать OES+SurfaceTexture КОНКРЕТНОГО слоя-камеры [layerId] для НОВОГО продюсера (чистый
     * BufferQueue): при закрытии/отвале старый продюсер оставляет очередь поверхности в состоянии, из
     * которого новый не доставляет кадры (bug 31/реконнект). Бесшовность держит снапшот слота (свежую
     * чёрную OES на экран не выводим). Продюсер должен быть уже ЗАКРЫТ вызывающим.
     */
    fun recreateCameraSurface(layerId: String) {
        val h = handler ?: return
        h.post {
            if (!running) return@post
            val r = renderer ?: return@post
            val slot = cameraSlots[layerId] ?: return@post
            runCatching { eglSurface?.let { eglCore?.makeCurrent(it) } }
            slot.recreate(r)
            KLog.d(TAG, "CameraSlot[$layerId] OES/SurfaceTexture RECREATED (чистое окно; снапшот держит кадр)")
            onCameraSurfaceReady?.invoke(layerId, slot.surfaceTexture)
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
        anyLiveCameraFrame = false // #3 — на рестарте нет живого кадра, пока камера не переоткрылась и не отдала
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
            syncTextures() // залить уже запрошенные слои-картинки
            uploadStandby() // залить текстуры бренд-заглушки (общие для всех слоёв)
            // Мульти-источники: создать CameraSlot для КАЖДОГО текущего слоя-камеры + сообщить наверх, что
            // его поверхность готова (RtmpStreamer откроет продюсера ЭТОГО слоя). Слоты пересоздаются на
            // каждом ре-ините GL (превью-рестарт): старые GL-ресурсы уже недействительны.
            cameraSlots.clear()
            syncCameraSlots()
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

            // Мульти-источники: подготовить КАЖДЫЙ слот-камеру (забрать свежий кадр, снапшот, tex-матрица,
            // альфа/пульс заглушки) — независимо, ДО прохода 1. Слоты существуют per слой-камеру (по id).
            val nowMs = SystemClock.elapsedRealtime()
            for (slot in cameraSlots.values) slot.prepare(r, nowMs)
            // #3 — считаем на GL-потоке: есть ли живой кадр (или слоёв-камер нет — ждать нечего). Флаг
            // читает schedulePreviewRestoreAfterStream, чтобы не пере-цеплять превью на чёрный кадр.
            anyLiveCameraFrame = cameraSlots.isEmpty() ||
                cameraSlots.values.any { it.hasEverHadFrame && (nowMs - it.lastFrameAtMs) < 1000 }

            // ── ПРОХОД 1: сцена в 16:9 FBO (аспект-корректно, БЕЗ поворота холста) ──────────
            // Камера в нативном 16:9-буфере рисуется в 16:9 FBO → не сжимается. Поворот холста здесь
            // НЕ применяется (canvasM = identity): он отдельным финальным шагом в проходе 2.
            r.bindFramebuffer(sceneFbo)
            GLES20.glViewport(0, 0, SCENE_W, SCENE_H)
            GLES20.glClearColor(0f, 0f, 0f, 1f)               // пустая база OBS — чёрный
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            android.opengl.Matrix.setIdentityM(canvasM, 0)     // в проходе 1 холст НЕ повёрнут
            for (layer in requestedLayers) {
                when (layer) {
                    is CompositorLayer.Camera -> {
                        // Шаринг фида (bug 58): зеркало рисует слот ПЕРВИЧНОГО (mirrorOf), первичный — свой.
                        val slot = cameraSlots[layer.mirrorOf ?: layer.id]
                        // Видео камеры — в РОДНОМ аспекте источника (пилларбокс/леттербокс под квад, bug 32).
                        layerMatrixOf(layer, slot?.aspect ?: SCENE_ASPECT)
                        // Рисуем СНАПШОТ ЭТОГО слота (read = предпоследний ХОРОШИЙ кадр), а НЕ сырой OES: при
                        // отвале держим хороший кадр (битый последний — в write, на экран не выходит), при
                        // реконнекте показываем его же, пока новый поток не обновит снапшот (без чёрной склейки).
                        // Кадр ГАСНЕТ под заглушкой (frameAlpha=1−standbyAlpha) — заглушка per-слой (свой альфа/пульс).
                        if (slot != null && slot.hasSnapshot && slot.freezeReadTex != 0) {
                            val frameAlpha = layer.alpha * (1f - slot.standbyAlpha)
                            if (frameAlpha > 0.001f)
                                r.draw(slot.freezeReadTex, oes = false, texMatrix = snapIdentity, posMatrix = finalM, alpha = frameAlpha)
                        }
                        // Заглушка (только текст) В КВАДРАТЕ ЭТОГО слоя. КОНТР-поворот (standbyM) держит текст
                        // вертикально правильным и в портрете. Заголовок пульсирует альфой (per-слой standbyPulse).
                        val sa = slot?.standbyAlpha ?: 0f
                        if (sa > 0.001f) {
                            // bug 61 — ЗАГЛУШКА уже 16:9 (SCENE_ASPECT): рисуем её в аспекте СЦЕНЫ, а НЕ в
                            // аспекте камеры. Иначе аспект-фит источника (напр. 4:3 основной камеры) сжимал
                            // заглушку по горизонтали. finalM/standbyM пересчитываем под 16:9 ТОЛЬКО для неё.
                            layerMatrixOf(layer, SCENE_ASPECT)
                            buildStandbyMatrix(layer.cx, layer.cy)
                            val base = sa * layer.alpha
                            if (standbyBodyTex != 0)
                                r.draw(standbyBodyTex, oes = false, posMatrix = standbyM, alpha = base)
                            if (standbyTitleTex != 0)
                                r.draw(standbyTitleTex, oes = false, posMatrix = standbyM, alpha = base * (slot?.standbyPulse ?: 1f))
                        }
                    }
                    is CompositorLayer.Image -> {
                        // Картинка — в аспекте своего bitmap (idea 35), без растяга.
                        val imgAspect = if (layer.bitmap.height > 0) layer.bitmap.width.toFloat() / layer.bitmap.height else SCENE_ASPECT
                        layerMatrixOf(layer, imgAspect)
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

            // Синхронизация превью-GL: кадр НОВОГО размера уже отрисован и выложен (swap) → теперь можно
            // безопасно переключить вьюпорт RootEncoder под него (иначе прыжок при портрет↔ландшафт).
            onResizedFrameReady?.let { cb -> onResizedFrameReady = null; runCatching { cb() } }
        } catch (e: Exception) {
            KLog.w(TAG, "drawFrame failed: ${e.message}")
        }
    }

    // Матрица поворота ТЕКСТУРНЫХ координат FBO на [deg]° вокруг центра (0.5,0.5) для прохода 2.
    // FBO — 2D-текстура (в GlQuadRenderer 2D-путь домножает V-flip внутри), поэтому здесь только поворот.
    // Знак ПЛЮС: canvasRotation крутит композит ПО ЧАСОВОЙ (Криник: 90° = по часовой; было -deg → шло CCW).
    private fun canvasTexMatrix(deg: Int) {
        android.opengl.Matrix.setIdentityM(canvasTexM, 0)
        android.opengl.Matrix.translateM(canvasTexM, 0, 0.5f, 0.5f, 0f)
        android.opengl.Matrix.rotateM(canvasTexM, 0, deg.toFloat(), 0f, 0f, 1f)
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
    private fun layerMatrixOf(layer: CompositorLayer, contentAspect: Float) {
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
        // bug 32 / idea 35 — вписываем СОДЕРЖИМОЕ слоя в его квад с сохранением его РОДНОГО аспекта
        // [contentAspect] (без растяга). Аспект передаёт ВЫЗЫВАЮЩИЙ: камера = аспект источника слота;
        // картинка = аспект bitmap; ЗАГЛУШКА = 16:9 сцены (bug 61 — не сжимать её под аспект камеры).
        // ≠16:9 → ужимаем квад по одной оси (полосы), а не тянем. Innermost (к вершине первым): сырой
        // квад → аспект-фит → [поворот] → масштаб → сдвиг. 16:9-содержимое → фактор 1, no-op.
        if (kotlin.math.abs(contentAspect - SCENE_ASPECT) > 0.01f) {
            val a = contentAspect / SCENE_ASPECT
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
        // Освобождаем GL на рендер-потоке, затем гасим поток. Закрыть продюсеров ВСЕХ слоёв-камер.
        runCatching { cameraSlots.keys.toList().forEach { onCameraSurfaceReady?.invoke(it, null) } }
        handler?.post {
            runCatching { uploaded.forEach { renderer?.deleteTexture(it.second) } }
            uploaded.clear()
            runCatching { if (sceneFbo != 0) renderer?.deleteFramebuffer(sceneFbo) }
            runCatching { if (sceneTex != 0) renderer?.deleteTexture(sceneTex) }
            sceneFbo = 0; sceneTex = 0
            runCatching { if (standbyTitleTex != 0) renderer?.deleteTexture(standbyTitleTex) }
            runCatching { if (standbyBodyTex != 0) renderer?.deleteTexture(standbyBodyTex) }
            standbyTitleTex = 0; standbyBodyTex = 0
            // Мульти-источники: освободить ВСЕ слоты камер (OES/ST/снапшот-FBO).
            runCatching { cameraSlots.values.forEach { it.release(renderer) } }
            cameraSlots.clear()
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
