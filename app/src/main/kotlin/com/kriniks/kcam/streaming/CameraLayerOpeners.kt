/**
 * CameraLayerOpeners — мост «слой-камера ↔ реальный источник кадров» для модели Idea 21.
 *
 * В новой модели камера — это слой-`SurfaceFilterRender`, а не базовый VideoSource. Компоновщик
 * (в :feature:streaming) создаёт фильтр и отдаёт его `SurfaceTexture`, но НЕ умеет открывать камеру
 * (AUSBC живёт в :app). Поэтому :app передаёт в `RtmpStreamer` реализацию `CameraOpener`, которая
 * открывает конкретный источник в эту SurfaceTexture.
 *
 *   • [UvcCameraOpener] — реальная USB-камера (AUSBC) рендерит прямо в SurfaceTexture слоя.
 *   • [VirtualCameraOpener] — виртуальная дебаг-камера (тест-паттерн) рисует в SurfaceTexture слоя
 *     (для разработки/тестов поворотов без реальной камеры).
 *
 * Живут в :app, т.к. бриджат AUSBC (:feature:usb) и RootEncoder/Streaming (:feature:streaming).
 */

package com.kriniks.kcam.streaming

import android.graphics.SurfaceTexture
import com.jiangdg.ausbc.MultiCameraClient
import com.jiangdg.ausbc.camera.bean.CameraRequest
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer
import com.kriniks.kcam.feature.streaming.rtmp.VirtualVideoSource

private const val TAG = "CameraLayerOpeners"

/** Открывает реальную USB-камеру [camera] в SurfaceTexture слоя камеры. */
class UvcCameraOpener(
    private val camera: MultiCameraClient.Camera,
    private val previewWidth: Int = 1920,
    private val previewHeight: Int = 1080,
) : RtmpStreamer.CameraOpener {

    override fun open(surfaceTexture: SurfaceTexture) {
        try {
            camera.openCamera(
                surfaceTexture,
                CameraRequest.Builder()
                    .setPreviewWidth(previewWidth)
                    .setPreviewHeight(previewHeight)
                    .setFrontCamera(false)
                    .create(),
            )
            KLog.d(TAG, "UVC camera opened into layer SurfaceTexture (${previewWidth}x${previewHeight})")
        } catch (e: Exception) {
            KLog.e(TAG, "UvcCameraOpener.open failed", e)
        }
    }

    override fun close() {
        try {
            camera.closeCamera()
            KLog.d(TAG, "UVC camera closed (layer)")
        } catch (e: Exception) {
            KLog.e(TAG, "UvcCameraOpener.close failed", e)
        }
    }
}

/** Открывает виртуальную дебаг-камеру (тест-паттерн) в SurfaceTexture слоя камеры. */
class VirtualCameraOpener : RtmpStreamer.CameraOpener {
    private var source: VirtualVideoSource? = null

    override fun open(surfaceTexture: SurfaceTexture) {
        try {
            val s = VirtualVideoSource()
            source = s
            s.start(surfaceTexture) // рисует тест-паттерн прямо в SurfaceTexture слоя
            KLog.d(TAG, "Virtual camera opened into layer SurfaceTexture")
        } catch (e: Exception) {
            KLog.e(TAG, "VirtualCameraOpener.open failed", e)
        }
    }

    override fun close() {
        source?.stop()
        source = null
        KLog.d(TAG, "Virtual camera closed (layer)")
    }
}
