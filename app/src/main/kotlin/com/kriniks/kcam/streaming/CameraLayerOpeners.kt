/**
 * CameraLayerOpeners — мост «слой-камера ↔ реальный источник кадров» (Phase 3: единый композитор).
 *
 * Камера — обычный СЛОЙ нашего GL-композитора. Композитор (в :feature:streaming) создаёт
 * OES-текстуру + SurfaceTexture слоя, но НЕ умеет открывать камеры (AUSBC/Camera2 живут в :app).
 * Поэтому :app передаёт в `RtmpStreamer` реализацию `CameraOpener`, которая открывает конкретный
 * источник в эту SurfaceTexture.
 *
 *   • [UvcCameraOpener] — реальная USB-камера (AUSBC) рендерит прямо в SurfaceTexture слоя.
 *   • [VirtualCameraOpener] — виртуальная дебаг-камера (тест-паттерн) рисует в SurfaceTexture слоя
 *     сама (Canvas-петля) — для разработки/тестов без реальной камеры.
 *   • [DeviceCameraOpener] (DeviceCamera.kt) — встроенная камера устройства через Camera2.
 *
 * ВАЖНО (interview_006): все openers отдают СЫРОЙ 16:9-поток «как с сенсора» — никаких поворотов
 * от ориентации устройства. Поворотами занимается KrinikCam: глобальный поворот холста + поворот
 * содержимого слоя (LayerTransform.rotation).
 *
 * Живут в :app, т.к. бриджат AUSBC (:feature:usb) и RootEncoder/Streaming (:feature:streaming).
 */

package com.kriniks.kcam.streaming

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.jiangdg.ausbc.MultiCameraClient
import com.jiangdg.ausbc.camera.bean.CameraRequest
import com.jiangdg.ausbc.camera.bean.PreviewSize
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer
import com.kriniks.kcam.feature.streaming.rtmp.VirtualFrameRenderer

private const val TAG = "CameraLayerOpeners"

/**
 * Открывает реальную USB-камеру [camera] в SurfaceTexture слоя камеры.
 *
 * Просим 1920×1080. Если камера этот размер в YUV не тянет (noname «2K USB Camera»: 2K только в
 * MJPEG, YUV-превью максимум 640×360), AUSBC логирует `err=-99 unsupported preview size`, затем САМ
 * падает на ближайший поддерживаемый YUV-размер и стартует превью (наблюдали фолбэк на 640×360).
 * Разрешение камеры-СЛОЯ не критично для качества выхода: композитор рендерит холст 1920×1080 и
 * масштабирует текстуру камеры в GL. Полноценный best-size/MJPEG-выбор — задача bug 25 (нужен
 * пост-open reopen; отложено из-за риска нативного краша AUSBC на close). `getAllPreviewSizes` ДО
 * открытия пуст (дескрипторы ещё не прочитаны) — пред-запрос смысла не имеет.
 */
class UvcCameraOpener(
    private val camera: MultiCameraClient.Camera,
    private val previewWidth: Int = 1920,
    private val previewHeight: Int = 1080,
) : RtmpStreamer.CameraOpener {

    // Bug 25 — переоткрывали ли уже на выбранном из списка размере (чтобы не зациклиться).
    private var reopenedAtBest = false

    private fun openAt(surfaceTexture: SurfaceTexture, w: Int, h: Int) {
        camera.openCamera(
            surfaceTexture,
            CameraRequest.Builder()
                .setPreviewWidth(w)
                .setPreviewHeight(h)
                .setFrontCamera(false)
                .create(),
        )
        KLog.d(TAG, "UVC camera opened into layer SurfaceTexture (запрошено ${w}x${h})")
    }

    override fun open(surfaceTexture: SurfaceTexture) {
        try {
            // Фаза 1: первый open (дескрипторы UVC читаются только ПОСЛЕ открытия → getAllPreviewSizes
            // до open пуст). Просим желаемый размер; AUSBC негоциирует что сможет.
            openAt(surfaceTexture, previewWidth, previewHeight)

            // Фаза 2 (bug 25, указание Криника «ставить размер ИЗ поддерживаемых камерой, не от балды»):
            // после негоциации опрашиваем реальный список размеров и, если камера негоциировала мелкий
            // (напр. 640×360), а поддерживает больше — ПЕРЕОТКРЫВАЕМ на лучшем 16:9 ИЗ СПИСКА. Один раз.
            Thread {
                runCatching { Thread.sleep(1500) }
                if (reopenedAtBest) return@Thread
                val sizes: List<PreviewSize> = runCatching { camera.getAllPreviewSizes(null) }.getOrNull().orEmpty()
                KLog.i(TAG, "UVC поддерживаемые размеры: " + sizes.joinToString { "${it.width}x${it.height}" })
                // Лучший поддерживаемый 16:9, не крупнее желаемого (напр. 1920×1080); иначе самый большой 16:9.
                val wantArea = previewWidth.toLong() * previewHeight
                fun is169(s: PreviewSize) = kotlin.math.abs(s.width.toFloat() / s.height - 16f / 9f) < 0.02f
                fun area(s: PreviewSize) = s.width.toLong() * s.height
                val best = sizes.filter { is169(it) && area(it) <= wantArea }.maxByOrNull { area(it) }
                    ?: sizes.filter { is169(it) }.maxByOrNull { area(it) }
                // Переоткрываем ТОЛЬКО если лучший поддерживаемый ОТЛИЧАЕТСЯ от уже запрошенного —
                // помогает камерам, чей максимум < запрошенного (напр. max 1280×720), выбрать их
                // реальный потолок. Если best == запрошенному (или список пуст) — не трогаем (без
                // лишнего churn/риска нативного close-краша bug 28). Для 2K-лимона best=1920×1080=
                // запрошенному → no-op (её практический потолок 640×360 = bandwidth/FPS-лимит AUSBC API).
                if (best != null && (best.width != previewWidth || best.height != previewHeight)) {
                    reopenedAtBest = true
                    KLog.i(TAG, "UVC: переоткрываю на выбранном из списка ${best.width}x${best.height} (запрошено было ${previewWidth}x${previewHeight})")
                    runCatching { openAt(surfaceTexture, best.width, best.height) }
                        .onFailure { KLog.e(TAG, "UVC reopen failed", it) }
                }
            }.start()
        } catch (e: Exception) {
            KLog.e(TAG, "UvcCameraOpener.open failed", e)
        }
    }

    override fun close() {
        reopenedAtBest = false
        try {
            camera.closeCamera()
            KLog.d(TAG, "UVC camera closed (layer)")
        } catch (e: Exception) {
            KLog.e(TAG, "UvcCameraOpener.close failed", e)
        }
    }
}

/**
 * Открывает виртуальную дебаг-камеру (тест-паттерн, Idea 09) в SurfaceTexture слоя камеры.
 *
 * Самостоятельный «сенсор»: HandlerThread рисует в Surface слоя 30fps-петлёй — статический паттерн
 * VirtualFrameRenderer (круг/сетка — для проверки искажений) + живой оверлей (бегущая штанга и
 * счётчик кадров/секунд — доказывает, что поток живой, Bug 11). Всегда ЛАНДШАФТ 16:9 «как с
 * сенсора» (interview_006) — все повороты делает композитор, не источник.
 *
 * Урок bug 18: SurfaceTexture слоя — GL-consumer, софтверный lockCanvas отдаёт null/чёрный кадр.
 * Рисуем через lockHardwareCanvas (GPU), с фолбэком на software для прочих поверхностей.
 */
class VirtualCameraOpener : RtmpStreamer.CameraOpener {

    private companion object {
        const val SENSOR_W = 1920
        const val SENSOR_H = 1080
        const val FPS = 30L
        const val FRAME_INTERVAL_MS = 1000L / FPS
        const val ACID_PINK = 0xFFFF1A8C.toInt()
    }

    private var surface: Surface? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var running = false

    private var staticFrame: Bitmap? = null
    private var frameCount = 0L
    private var startMs = 0L

    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACID_PINK; alpha = 180 }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = SENSOR_H * 0.045f
    }

    override fun open(surfaceTexture: SurfaceTexture) {
        close() // close-before-open: слой мог отдать НОВУЮ SurfaceTexture при реините GL
        try {
            staticFrame = VirtualFrameRenderer.renderStatic(SENSOR_W, SENSOR_H)
            surfaceTexture.setDefaultBufferSize(SENSOR_W, SENSOR_H)
            val s = Surface(surfaceTexture)
            surface = s
            running = true
            startMs = SystemClock.elapsedRealtime()
            val t = HandlerThread("VirtualCamDraw").also { it.start() }
            thread = t
            val h = Handler(t.looper)
            handler = h
            val loop = object : Runnable {
                override fun run() {
                    if (!running) return
                    drawOnce()
                    if (running) h.postDelayed(this, FRAME_INTERVAL_MS)
                }
            }
            h.post(loop)
            KLog.d(TAG, "Virtual camera opened into layer — ${SENSOR_W}x${SENSOR_H} @ ${FPS}fps (raw landscape)")
        } catch (e: Exception) {
            KLog.e(TAG, "VirtualCameraOpener.open failed", e)
            running = false
        }
    }

    // Нарисовать один кадр «сенсора»: статический паттерн + живая штанга + счётчик (Bug 11).
    private fun drawOnce() {
        val s = surface ?: return
        val bmp = staticFrame ?: return
        try {
            // bug 18: hardware canvas для GL-consumer поверхности; software — фолбэк.
            val canvas = (runCatching { s.lockHardwareCanvas() }.getOrNull() ?: s.lockCanvas(null)) ?: return
            canvas.drawBitmap(bmp, 0f, 0f, null)

            // Бегущая вертикальная штанга (слева направо, с циклом) — доказывает живой поток.
            val barW = SENSOR_W * 0.012f
            val period = 3000f // мс на полный проход
            val elapsed = (SystemClock.elapsedRealtime() - startMs).toFloat()
            val bx = ((elapsed % period) / period) * SENSOR_W
            canvas.drawRect(bx, 0f, bx + barW, SENSOR_H.toFloat(), barPaint)

            // Живой счётчик: целевой FPS + номер кадра + секунды (Bug 11).
            val secs = elapsed / 1000f
            canvas.drawText(
                "%d FPS · frame %d · %.1fs".format(FPS, frameCount, secs),
                SENSOR_W / 2f, SENSOR_H * 0.96f, textPaint,
            )

            s.unlockCanvasAndPost(canvas)
            frameCount++
        } catch (e: Exception) {
            KLog.w(TAG, "Virtual frame draw failed: ${e.message}")
        }
    }

    override fun close() {
        running = false
        handler?.removeCallbacksAndMessages(null)
        thread?.quitSafely()
        thread = null
        handler = null
        surface?.release()
        surface = null
        staticFrame?.recycle()
        staticFrame = null
        KLog.d(TAG, "Virtual camera closed (layer)")
    }
}
