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
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.capture.model.VideoSource
import com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer

private const val TAG = "DeviceCamera"

/** Перечисление встроенных камер устройства через Camera2. */
object DeviceCameraEnumerator {
    fun enumerate(context: Context): List<VideoSource.PhoneCamera> {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return emptyList()
        return try {
            cm.cameraIdList.mapNotNull { id ->
                val ch = runCatching { cm.getCameraCharacteristics(id) }.getOrNull() ?: return@mapNotNull null
                val facing = ch.get(CameraCharacteristics.LENS_FACING)
                val isFront = facing == CameraCharacteristics.LENS_FACING_FRONT
                val name = when (facing) {
                    CameraCharacteristics.LENS_FACING_FRONT -> "Front camera"
                    CameraCharacteristics.LENS_FACING_BACK -> "Rear camera"
                    else -> "Camera $id"
                }
                VideoSource.PhoneCamera(id = "phone_$id", displayName = "$name (id $id)", cameraId = id, isFront = isFront)
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
            surfaceTexture.setDefaultBufferSize(width, height)
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

    override fun close() {
        runCatching { session?.close() }; session = null
        runCatching { device?.close() }; device = null
        runCatching { surface?.release() }; surface = null
        thread?.quitSafely(); thread = null; handler = null
        KLog.d(TAG, "Device camera $cameraId closed (layer)")
    }
}
