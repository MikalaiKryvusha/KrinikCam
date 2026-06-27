/**
 * UsbDeviceRepositoryImpl — manages UVC camera lifecycle via AndroidUSBCamera library.
 *
 * Responsibilities:
 *   - Monitor USB attach/detach via MultiCameraClient
 *   - Request Android USB permission for UVC devices
 *   - Create and configure Camera objects when permission is granted
 *   - Emit events via SharedFlow so multiple observers can react
 *
 * Camera open flow:
 *   1. onConnectDev fires (permission granted) → create Camera, set ctrlBlock + state callback
 *   2. Emit PermissionGranted(device, camera) — camera is ready but NOT yet opened
 *   3. UvcPreviewView receives the camera and calls camera.openCamera(textureView, request)
 *   4. ICameraStateCallBack.OPENED fires → emit PreviewStarted with actual dimensions
 *
 * Lifecycle: tied to the Application — started once, survives activity recreation.
 * Related: UsbEvent, UvcDevice, UsbModule
 */

package com.kriniks.kcam.feature.usb.data

import android.content.Context
import android.hardware.usb.UsbDevice
import com.jiangdg.ausbc.MultiCameraClient
import com.jiangdg.ausbc.callback.ICameraStateCallBack
import com.jiangdg.ausbc.callback.IDeviceConnectCallBack
import com.jiangdg.ausbc.camera.bean.CameraRequest
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.usb.domain.UsbDeviceRepository
import com.kriniks.kcam.feature.usb.model.UsbEvent
import com.kriniks.kcam.feature.usb.model.UvcDevice
import com.kriniks.kcam.feature.usb.model.UvcFormat
import com.kriniks.kcam.feature.usb.model.UvcVideoProfile
import com.serenegiant.usb.USBMonitor
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "UsbDeviceRepository"

@Singleton
class UsbDeviceRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
) : UsbDeviceRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _events = MutableSharedFlow<UsbEvent>(replay = 0, extraBufferCapacity = 32)
    override val events: SharedFlow<UsbEvent> = _events.asSharedFlow()

    // MultiCameraClient manages hot-plug and multi-camera support
    private var multiCameraClient: MultiCameraClient? = null

    // Camera objects keyed by device ID — created on permission grant, opened by UvcPreviewView
    private val openCameras = mutableMapOf<Int, MultiCameraClient.Camera>()

    override fun startMonitoring() {
        KLog.i(TAG, "Starting USB monitor")
        multiCameraClient = MultiCameraClient(ReceiverFlagFixContext(context), object : IDeviceConnectCallBack {

            override fun onAttachDev(device: UsbDevice?) {
                device ?: return
                KLog.i(TAG, "USB attached: ${device.deviceName} VID=${device.vendorId}")
                emit(UsbEvent.DeviceAttached(device))
            }

            // Note: library method name is "Dec" not "Dev"
            override fun onDetachDec(device: UsbDevice?) {
                device ?: return
                KLog.i(TAG, "USB detached: ${device.deviceName}")
                openCameras.remove(device.deviceId)?.closeCamera()
                emit(UsbEvent.DeviceDetached(device.deviceId))
            }

            override fun onConnectDev(device: UsbDevice?, ctrlBlock: USBMonitor.UsbControlBlock?) {
                device ?: return
                KLog.i(TAG, "USB permission granted: ${device.deviceName}")
                initCamera(device, ctrlBlock)
            }

            // Note: library method name is "Dec" not "Dev"
            override fun onDisConnectDec(device: UsbDevice?, ctrlBlock: USBMonitor.UsbControlBlock?) {
                device ?: return
                KLog.i(TAG, "USB disconnected: ${device.deviceName}")
            }

            override fun onCancelDev(device: UsbDevice?) {
                device ?: return
                KLog.w(TAG, "USB permission cancelled: ${device.deviceName}")
                emit(UsbEvent.PermissionDenied(device))
            }
        })
        multiCameraClient?.register()
    }

    override fun stopMonitoring() {
        KLog.i(TAG, "Stopping USB monitor")
        openCameras.values.forEach { it.closeCamera() }
        openCameras.clear()
        multiCameraClient?.unRegister()
        multiCameraClient?.destroy()
        multiCameraClient = null
    }

    override fun requestPermission(device: UsbDevice) {
        multiCameraClient?.requestPermission(device)
    }

    // ── Camera initialisation ───────────────────────────────────────────

    /**
     * Creates a Camera, wires up the control block and state callback, stores it, then
     * emits PermissionGranted so UvcPreviewView can call camera.openCamera(textureView, request).
     */
    private fun initCamera(device: UsbDevice, ctrlBlock: USBMonitor.UsbControlBlock?) {
        val camera = MultiCameraClient.Camera(context, device)

        camera.setUsbControlBlock(ctrlBlock)

        camera.setCameraStateCallBack(object : ICameraStateCallBack {
            override fun onCameraState(
                self: MultiCameraClient.Camera,
                code: ICameraStateCallBack.State,
                msg: String?,
            ) {
                when (code) {
                    ICameraStateCallBack.State.OPENED -> {
                        KLog.i(TAG, "Camera opened: ${device.deviceName}")
                        val size = self.getPreviewSize()
                        val w = size?.width ?: 1920
                        val h = size?.height ?: 1080
                        emit(UsbEvent.PreviewStarted(device.deviceId, w, h))
                    }
                    ICameraStateCallBack.State.ERROR -> {
                        KLog.e(TAG, "Camera error: ${device.deviceName} — $msg")
                        emit(UsbEvent.Error("Camera failed: $msg"))
                    }
                    ICameraStateCallBack.State.CLOSED -> {
                        KLog.i(TAG, "Camera closed: ${device.deviceName}")
                    }
                }
            }
        })

        openCameras[device.deviceId] = camera
        emit(UsbEvent.PermissionGranted(device, camera))
    }

    override fun getCameraForDevice(deviceId: Int): MultiCameraClient.Camera? =
        openCameras[deviceId]

    private fun emit(event: UsbEvent) {
        scope.launch { _events.emit(event) }
    }
}
