/**
 * DeviceCamera — встроенные камеры устройства (Camera2) как слой-источник (Idea 24).
 *
 * Зачем: ночью USB-камера не подключена, но у планшета есть СВОИ камеры (фронт/тыл). Это даёт ИИ-агенту
 * автономный РЕАЛЬНЫЙ GL-источник для разработки/тестов модели Idea 21 (камера = слой), и проверку,
 * доходит ли реальная камера-слой (GL-продюсер Camera2) до энкодера — в отличие от виртуалки (Canvas).
 *
 *   • [DeviceCameraEnumerator] — перечисляет все камеры устройства (Camera2) → List<VideoSource.PhoneCamera>.
 *   • [DeviceCameraOpener] — открывает выбранную Camera2-камеру В SurfaceTexture слоя-камеры
 *     (как `RtmpStreamer.CameraOpener`), кадры идут GL-продюсером (как USB) в `SurfaceFilterRender`.
 *
 * Живёт в :app (бриджит Camera2 и :feature:streaming). CAMERA-permission уже запрашивается в MainActivity.
 */

package com.kriniks.kcam.streaming

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.kriniks.kcam.R
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.capture.model.VideoSource
import com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer

private const val TAG = "DeviceCamera"

/**
 * Перечисление ВСТРОЕННЫХ камер устройства через Camera2 (plans/05 S2). Берём ВЕСЬ список, который ОС
 * отдаёт приложениям (`cameraIdList`) — не только front/rear: сюда попадают все родные камеры, что
 * система показывает (селфи / тыловые ширик-основная-телефото / макро и т.п.). Пользователь выбирает
 * конкретную в свойствах слоя «Устройство захвата видео» (единый тип камеры, plans/05 §0).
 *
 * Имена делаем человекочитаемыми: фронт → «Селфи-камера», тыловые различаем по фокусному расстоянию
 * (самое короткое = сверхширик, длинное = телефото), остальное — по facing + id для однозначности.
 */
object DeviceCameraEnumerator {
    fun enumerate(context: Context): List<VideoSource.PhoneCamera> {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return emptyList()
        return try {
            // Собираем сырые характеристики, чтобы различать тыловые линзы по фокусному расстоянию.
            data class Raw(val id: String, val facing: Int?, val focal: Float?)
            val raws = cm.cameraIdList.mapNotNull { id ->
                val ch = runCatching { cm.getCameraCharacteristics(id) }.getOrNull() ?: return@mapNotNull null
                val focal = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull()
                Raw(id, ch.get(CameraCharacteristics.LENS_FACING), focal)
            }
            // Ранжируем тыловые по фокусному (короче = шире угол) — для ярлыков ширик/основная/телефото.
            val backSorted = raws.filter { it.facing == CameraCharacteristics.LENS_FACING_BACK }
                .sortedBy { it.focal ?: Float.MAX_VALUE }
            val backCount = backSorted.size

            raws.map { r ->
                val isFront = r.facing == CameraCharacteristics.LENS_FACING_FRONT
                // plans/13 — имена из РЕСУРСОВ (EN/RU по локали): у enumerate есть Context, данные
                // рождаются локализованными. Нюанс: enumerate зовётся на старте — смена локали
                // отразится на именах после перезапуска приложения (пересоздание источников).
                val name = context.getString(
                    when (r.facing) {
                        CameraCharacteristics.LENS_FACING_FRONT -> R.string.camera_front
                        CameraCharacteristics.LENS_FACING_BACK -> when {
                            backCount <= 1 -> R.string.camera_main
                            // Несколько тыловых: самая широкоугольная = сверхширик, длинная = телефото.
                            r.id == backSorted.first().id -> R.string.camera_ultrawide
                            r.id == backSorted.last().id -> R.string.camera_tele
                            else -> R.string.camera_main
                        }
                        CameraCharacteristics.LENS_FACING_EXTERNAL -> R.string.camera_external
                        else -> R.string.camera_generic
                    },
                )
                VideoSource.PhoneCamera(
                    id = "phone_${r.id}",
                    displayName = context.getString(R.string.camera_named, name, r.id),
                    cameraId = r.id,
                    isFront = isFront,
                )
            }.also { KLog.i(TAG, "Enumerated ${it.size} device camera(s): ${it.map { c -> c.displayName }}") }
        } catch (e: Exception) {
            KLog.e(TAG, "enumerate failed", e)
            emptyList()
        }
    }
}

/**
 * Открывает Camera2-камеру [cameraId] в SurfaceTexture слоя-камеры. Кадры — GL-продюсер (как USB):
 * Camera2 → CaptureSession с target = Surface(layerSurfaceTexture) → repeating preview-request.
 */
class DeviceCameraOpener(
    private val context: Context,
    private val cameraId: String,
    private val width: Int = 1920,
    private val height: Int = 1080,
    // bug 32 — сообщить композитору аспект (w/h) выбранного НАТИВНОГО размера, чтобы рисовать без растяга.
    private val onAspect: (Float) -> Unit = {},
    // bug 19 — сообщить композитору ориентацию сенсора (CW-градусы) + зеркало (фронталка), чтобы
    // выпрямить кадр («камеру вращаем сами»). UVC/виртуалка передают (0, false).
    private val onOrientation: (Int, Boolean) -> Unit = { _, _ -> },
) : RtmpStreamer.CameraOpener {

    private val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var surface: Surface? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    @SuppressLint("MissingPermission") // CAMERA выдаётся в MainActivity до старта превью
    override fun open(surfaceTexture: SurfaceTexture) {
        // close-before-open: слой может отдать НОВУЮ SurfaceTexture при реините GL (старая
        // «abandoned»). Закрываем предыдущие device/session/thread и открываемся на свежей поверхности.
        close()
        try {
            // Bug 19/29.2: диагностика ориентации сенсора + выбор НАТИВНОГО 16:9-размера (иначе Camera2
            // тянет сенсор в чужой аспект → искажение). Интервью_006: физкамера отдаёт СЫРОЙ поток,
            // ориентацию НЕ компенсируем — выпрямляет пользователь трансформой слоя.
            val (nw, nh, sensorOrient) = pickNativeSize()
            // bug 19/32 (Криник, измерено OpenCV): рисуем в РОДНОМ аспекте камеры БЕЗ растяга. Сообщаем
            // НАТИВНЫЙ аспект БУФЕРА (nw/nh). Композитор сам ВЫПРЯМЛЯЕТ кадр (поворот texMatrix на
            // SENSOR_ORIENTATION), а поворот на 90°/270° инвертирует требование к пилларбоксу обратно —
            // поэтому здесь инверсия НЕ нужна (её делает поворот в композиторе). Замер: ratio→~1.0.
            val displayAspect = nw.toFloat() / nh
            // bug 19 — зеркало для фронтальной камеры (LENS_FACING_FRONT), чтобы текст читался прямо.
            val isFront = runCatching {
                cameraManager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.LENS_FACING) ==
                    CameraCharacteristics.LENS_FACING_FRONT
            }.getOrDefault(false)
            runCatching { onAspect(displayAspect) }
            runCatching { onOrientation(sensorOrient, isFront) }
            surfaceTexture.setDefaultBufferSize(nw, nh)
            val s = Surface(surfaceTexture)
            surface = s
            val t = HandlerThread("DeviceCam").also { it.start() }
            thread = t
            val h = Handler(t.looper)
            handler = h

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    device = camera
                    try {
                        @Suppress("DEPRECATION")
                        camera.createCaptureSession(listOf(s), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(sess: CameraCaptureSession) {
                                session = sess
                                val req = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(s) }
                                runCatching { sess.setRepeatingRequest(req.build(), null, h) }
                                    .onFailure { KLog.e(TAG, "setRepeatingRequest failed", it) }
                                KLog.i(TAG, "Device camera $cameraId streaming into layer (${width}x${height})")
                            }
                            override fun onConfigureFailed(sess: CameraCaptureSession) {
                                KLog.e(TAG, "Capture session configure failed (camera $cameraId)")
                            }
                        }, h)
                    } catch (e: Exception) {
                        KLog.e(TAG, "createCaptureSession failed", e)
                    }
                }
                override fun onDisconnected(camera: CameraDevice) { KLog.w(TAG, "Device camera $cameraId disconnected"); camera.close(); device = null }
                override fun onError(camera: CameraDevice, error: Int) { KLog.e(TAG, "Device camera $cameraId error $error"); camera.close(); device = null }
            }, h)
        } catch (e: Exception) {
            KLog.e(TAG, "DeviceCameraOpener.open failed", e)
        }
    }

    // Bug 19/29.2 — выбрать поддерживаемый камерой размер вывода, максимально близкий к 16:9
    // [width]×[height], чтобы Camera2 НЕ растягивал сенсор в чужой аспект. Логируем ориентацию сенсора
    // и все 16:9-размеры (диагностика искажения). Пусто/ошибка → отдаём желаемый (как было).
    /**
     * bug 32 (указание Криника): выбираем КРУПНЕЙШИЙ НАТИВНЫЙ поддерживаемый размер (не форсим 16:9!) —
     * камеру рисуем в её родном аспекте без искажения (композитор вписывает по аспекту). Раньше при
     * отсутствии 16:9 форсили 1920×1080 → Camera2 растягивал 4:3-сенсор в 16:9-буфер (растяг).
     * Ограничиваем сверху ~площадью 1920×1080, чтобы не тянуть гигантские буферы.
     */
    private fun pickNativeSize(): Triple<Int, Int, Int> {
        return try {
            val ch = cameraManager.getCameraCharacteristics(cameraId)
            val sensorOrient = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
            val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(SurfaceTexture::class.java)?.toList().orEmpty()
            // bug 32: НАТИВНЫЙ аспект = аспект СЕНСОРА (active array). Дешёвые фронталки объявляют
            // 1920×1080, но это ГОРИЗОНТАЛЬНЫЙ РАСТЯГ 4:3-сенсора. Поэтому выбираем размер, чей аспект
            // совпадает с сенсором → без растяга; композитор впишет его (полосы, если ≠ 16:9).
            val active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
            val sensorAspect = if (active != null && active.height() > 0)
                active.width().toFloat() / active.height().toFloat() else 16f / 9f
            val wantArea = width.toLong() * height
            fun matchesSensor(s: android.util.Size) =
                kotlin.math.abs(s.width.toFloat() / s.height - sensorAspect) < 0.06f
            // Пул: размеры аспекта сенсора; если таких нет — все.
            val pool = sizes.filter { matchesSensor(it) }.ifEmpty { sizes }
            val best = pool.filter { it.width.toLong() * it.height <= wantArea }
                .maxByOrNull { it.width.toLong() * it.height }
                ?: pool.minByOrNull { it.width.toLong() * it.height }
            val w = best?.width ?: width
            val h = best?.height ?: height
            KLog.i(TAG, "Device cam $cameraId: SENSOR_ORIENTATION=$sensorOrient; сенсор-аспект " +
                "${"%.3f".format(sensorAspect)}; выбран нативный ${w}x${h} (аспект ${"%.3f".format(w.toFloat() / h)})")
            Triple(w, h, sensorOrient)
        } catch (e: Exception) {
            KLog.w(TAG, "pickNativeSize failed: ${e.message}")
            Triple(width, height, 0)
        }
    }

    override fun close() {
        runCatching { session?.close() }; session = null
        runCatching { device?.close() }; device = null
        runCatching { surface?.release() }; surface = null
        thread?.quitSafely(); thread = null; handler = null
        KLog.d(TAG, "Device camera $cameraId closed (layer)")
    }
}
