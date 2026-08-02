/**
 * UsbDeviceRepository — interface for USB camera management.
 * Decouples consumers (:feature:streaming, :app) from the AndroidUSBCamera implementation.
 * Related: UsbDeviceRepositoryImpl, UsbEvent, UsbModule
 */

package com.kriniks.kcam.feature.usb.domain

import android.hardware.usb.UsbDevice
import com.jiangdg.ausbc.MultiCameraClient
import com.kriniks.kcam.feature.usb.model.UsbEvent
import kotlinx.coroutines.flow.SharedFlow

interface UsbDeviceRepository {
    val events: SharedFlow<UsbEvent>
    fun startMonitoring()
    fun stopMonitoring()
    fun requestPermission(device: UsbDevice)
    fun getCameraForDevice(deviceId: Int): MultiCameraClient.Camera?
    /** bug 47 (харнес/Idea 22) — эмулировать отвал устройства: эмит DeviceDetached во ВСЕХ подписчиков
     *  (оба экземпляра UsbViewModel), как реальный физический отвал. Для приёмки заглушки без отключения. */
    fun simulateDetach(deviceId: Int)

    /**
     * ЭПИК «настройки камер», фаза 0 (`plans/25`) — спросить камеру НАПРЯМУЮ, какие у неё ручки.
     *
     * Разбирает её USB-дескрипторы (что она декларирует) и читает границы каждого объявленного
     * контрола запросами UVC — включая экспозицию, которой нет в API библиотеки. Результат печатается
     * в лог таблицей; это и есть инвентарь фазы 0.
     *
     * [deviceId] — устройство из уже открытых; `-1` = взять единственное открытое.
     * Возвращает короткую сводку для вызывающего (харнес печатает её в консоль).
     */
    fun dumpUvcControls(deviceId: Int = -1): String
}
