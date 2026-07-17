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
import android.hardware.usb.UsbConstants
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "UsbDeviceRepository"

// bug 33 — подкласс 2 у класса Miscellaneous (239) = Interface Association Descriptor (IAD):
// так энумерируются современные композитные UVC-вебки (видео-интерфейсы class 14 внутри).
// Константы для подкласса в UsbConstants нет — заводим свою (зеркало res/xml/device_filter.xml).
private const val USB_MISC_SUBCLASS_IAD = 2

// bug 33 — окно ожидания автогранта после attach: система применяет персистентный грант
// (галочка «всегда открывать» + intent-filter USB_DEVICE_ATTACHED) асинхронно и может успеть
// ПОЗЖЕ, чем AUSBC доставит onAttachDev. Поллим грант шагами, диалог показываем только по таймауту.
private const val GRANT_POLL_STEP_MS = 150L
private const val GRANT_POLL_TIMEOUT_MS = 900L

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
                // bug 33 [NOT-TESTED] — класс-фильтр: дальше по конвейеру (UI-список → авто-
                // requestPermission → системный диалог) пропускаем ТОЛЬКО UVC-камеры. Раньше attach
                // ЛЮБОГО USB-устройства (мышь, флешка, хаб, ethernet) доходил до requestPermission →
                // модальный диалог «разрешить доступ к устройству?» на каждое подключение чего угодно
                // (жалоба Криника 2026-07-18). Не-камеры игнорируем целиком: ни диалога, ни фантома
                // в списке источников (смежно bug 35). USB-микрофоны не страдают: аудио-класс
                // обслуживает сама ОС, приложению USB-разрешение для них не нужно.
                if (!isUvcCamera(device)) {
                    KLog.i(
                        TAG,
                        "USB attached — не UVC, игнорируем: ${device.deviceName} " +
                            "class=${device.deviceClass}/${device.deviceSubclass} " +
                            "VID=${device.vendorId} PID=${device.productId} (bug 33)",
                    )
                    return
                }
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

    // Bug 29.1 — дебаунс повторных запросов разрешения. `DeviceAttached` от AUSBC/hot-plug может
    // прилетать НЕСКОЛЬКО раз подряд для одного устройства → стопка системных USB-диалогов. Гасим
    // дубликаты в коротком окне (не меняя семантику: первый запрос проходит, повторы за 3с — нет).
    private var lastPermDeviceId = -1
    private var lastPermTime = 0L

    // bug 33 — UsbManager для проверки уже выданного разрешения (S1) + диагностики.
    private val usbManager by lazy { context.getSystemService(Context.USB_SERVICE) as android.hardware.usb.UsbManager }

    override fun requestPermission(device: UsbDevice) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (device.deviceId == lastPermDeviceId && now - lastPermTime < 3000L) {
            KLog.d(TAG, "requestPermission: дубликат для device ${device.deviceId} — дебаунс (bug 29.1)")
            return
        }
        lastPermDeviceId = device.deviceId
        lastPermTime = now
        // bug 33 [NOT-TESTED] — лечение гонки автогранта. По байткоду AUSBC 3.2.7:
        // USBMonitor.requestPermission САМ проверяет hasPermission и при true идёт сразу в
        // processConnect БЕЗ диалога. Значит наша задача — НЕ звать его раньше, чем система успела
        // применить персистентный грант от манифест-интента USB_DEVICE_ATTACHED (галочка «всегда
        // открывать», bug 09). Поэтому: грант уже есть → просим сразу (диалога не будет); гранта нет →
        // поллим до GRANT_POLL_TIMEOUT_MS и только по таймауту зовём requestPermission с диалогом —
        // один, легитимный (первое знакомство с устройством или галочку не ставили).
        scope.launch {
            var has = runCatching { usbManager.hasPermission(device) }.getOrDefault(false)
            var waitedMs = 0L
            while (!has && waitedMs < GRANT_POLL_TIMEOUT_MS) {
                delay(GRANT_POLL_STEP_MS)
                waitedMs += GRANT_POLL_STEP_MS
                has = runCatching { usbManager.hasPermission(device) }.getOrDefault(false)
            }
            KLog.i(
                TAG,
                "requestPermission: device ${device.deviceId} vid=${device.vendorId} " +
                    "pid=${device.productId} hasPermission=$has ожидание=${waitedMs}мс " +
                    "(bug 33: true → без диалога, false → диалог)",
            )
            multiCameraClient?.requestPermission(device)
        }
    }

    // bug 33 — «это UVC-камера?» по USB-дескрипторам; зеркало res/xml/device_filter.xml.
    // Уровень устройства: Miscellaneous/IAD-композит (239/2 — так видятся современные вебки,
    // вкл. EMEET Piko+) или class 14 (Video прямо на девайсе). Композиты с deviceClass=0
    // объявляют видео только на интерфейсах — сканируем и их.
    private fun isUvcCamera(device: UsbDevice): Boolean {
        if (device.deviceClass == UsbConstants.USB_CLASS_MISC && device.deviceSubclass == USB_MISC_SUBCLASS_IAD) return true
        if (device.deviceClass == UsbConstants.USB_CLASS_VIDEO) return true
        for (i in 0 until device.interfaceCount) {
            if (device.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_VIDEO) return true
        }
        return false
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
