package com.kriniks.kcam.feature.usb.uvc

import android.hardware.usb.UsbDeviceConnection
import com.kriniks.kcam.core.logging.KLog

/**
 * UvcControlProbe — РАЗГОВОР С КАМЕРОЙ НАПРЯМУЮ по протоколу UVC (эпик `plans/24`, фаза 0).
 *
 * Зачем это существует, если есть библиотека. Публичный API AUSBC даёт 8 контролов и НЕ даёт
 * экспозиции — главной ручки, ради которой эпик и начат (`researches/29` §3.1–3.3). Криник указал
 * путь в обход посредника (`interviews/interview_025` В2, дословно): «*камеры отдают список своих
 * переменных, если их спросить… спросить камеру, какие у неё есть ручки, распарсить ответ…
 * изменения посылаются в камеру*». Здесь это и реализовано — целиком публичным Android USB API:
 *
 *  1. `UsbControlBlock.getRawDescriptors()` → разбор дескрипторов → КТО у камеры есть (Camera
 *     Terminal и Processing Unit, их ID) и ЧТО она декларирует (битовые маски `bmControls`);
 *  2. `UsbDeviceConnection.controlTransfer()` → чтение `GET_CUR/MIN/MAX/RES/DEF` по каждому
 *     объявленному контролу.
 *
 * Что это даёт сверх библиотеки: экспозицию, СЫРЫЕ значения (библиотека нормализует в проценты
 * 0–100 и теряет точность) и настоящий ШАГ (`GET_RES`) — то есть ровно тот фундамент, которого
 * требует будущая авторегулировка (`MASTER_PLAN` Phase 6).
 *
 * Источники констант — ПЕРВИЧНЫЕ, не пересказы:
 *  · коды запросов и селекторы — заголовок ядра Linux `include/uapi/linux/usb/video.h` (A.8, A.9.4,
 *    A.9.5);
 *  · смещения полей дескрипторов — спецификация UVC (Camera Terminal: `bControlSize` на 14,
 *    `bmControls` с 15; Processing Unit: `bControlSize` на 7, `bmControls` с 8);
 *  · позиции БИТОВ в `bmControls` независимо подтверждены битовыми масками `CTRL_*`/`PU_*` из
 *    `com.serenegiant.usb.UVCCamera` (сняты `javap`) — два несвязанных источника сошлись.
 *
 * [NOT-TESTED] — свежий код фазы 0; проверяется прогоном на живой камере (`plans/25` Ф0.3–Ф0.4).
 */
object UvcControlProbe {

    private const val TAG = "UvcControlProbe"

    // ── Коды запросов UVC (Linux uapi video.h, A.8) ──────────────────────────────────────────────
    private const val GET_CUR = 0x81
    private const val GET_MIN = 0x82
    private const val GET_MAX = 0x83
    private const val GET_RES = 0x84
    private const val GET_DEF = 0x87

    // Направление и адресат: класс-специфичный запрос к ИНТЕРФЕЙСУ, чтение (device→host).
    private const val REQ_TYPE_GET_IF = 0xA1

    // ── Разбор дескрипторов ─────────────────────────────────────────────────────────────────────
    private const val DESC_TYPE_INTERFACE = 0x04
    private const val DESC_TYPE_CS_INTERFACE = 0x24
    private const val CLASS_VIDEO = 0x0E
    private const val SUBCLASS_VIDEOCONTROL = 0x01
    private const val VC_INPUT_TERMINAL = 0x02
    private const val VC_PROCESSING_UNIT = 0x05
    private const val ITT_CAMERA = 0x0201

    /** Блок, в котором живёт контрол: оптика (Camera Terminal) или обработка (Processing Unit). */
    enum class Unit { CAMERA_TERMINAL, PROCESSING_UNIT }

    /**
     * Описание одного контрола в каталоге: чем он является ПО СПЕКЕ.
     * [bit] — позиция в `bmControls` своего блока; [selector] — код для `wValue`;
     * [size] — сколько байт занимает значение; [signed] — знаковое ли оно (яркость и оттенок — да,
     * и перепутать это значит молча испортить яркость, `researches/29` §2.2).
     */
    data class Spec(
        val name: String,
        val unit: Unit,
        val bit: Int,
        val selector: Int,
        val size: Int,
        val signed: Boolean,
    )

    /**
     * КАТАЛОГ стандартных контролов UVC. Порядок — как в спецификации, чтобы таблицу инвентаря было
     * удобно сверять глазами со спекой.
     */
    val CATALOG: List<Spec> = listOf(
        // Camera Terminal (A.9.4) — оптика и съёмка. Экспозиция ЗДЕСЬ.
        Spec("scanning_mode", Unit.CAMERA_TERMINAL, 0, 0x01, 1, false),
        Spec("auto_exposure_mode", Unit.CAMERA_TERMINAL, 1, 0x02, 1, false),
        Spec("auto_exposure_priority", Unit.CAMERA_TERMINAL, 2, 0x03, 1, false),
        Spec("exposure_time_absolute", Unit.CAMERA_TERMINAL, 3, 0x04, 4, false),
        Spec("exposure_time_relative", Unit.CAMERA_TERMINAL, 4, 0x05, 1, true),
        Spec("focus_absolute", Unit.CAMERA_TERMINAL, 5, 0x06, 2, false),
        Spec("focus_relative", Unit.CAMERA_TERMINAL, 6, 0x07, 2, false),
        Spec("iris_absolute", Unit.CAMERA_TERMINAL, 7, 0x09, 2, false),
        Spec("iris_relative", Unit.CAMERA_TERMINAL, 8, 0x0A, 1, false),
        Spec("zoom_absolute", Unit.CAMERA_TERMINAL, 9, 0x0B, 2, false),
        Spec("zoom_relative", Unit.CAMERA_TERMINAL, 10, 0x0C, 3, false),
        Spec("pantilt_absolute", Unit.CAMERA_TERMINAL, 11, 0x0D, 8, true),
        Spec("pantilt_relative", Unit.CAMERA_TERMINAL, 12, 0x0E, 4, true),
        Spec("roll_absolute", Unit.CAMERA_TERMINAL, 13, 0x0F, 2, true),
        Spec("roll_relative", Unit.CAMERA_TERMINAL, 14, 0x10, 2, true),
        Spec("focus_auto", Unit.CAMERA_TERMINAL, 17, 0x08, 1, false),
        Spec("privacy", Unit.CAMERA_TERMINAL, 18, 0x11, 1, false),
        // Processing Unit (A.9.5) — обработка сигнала.
        Spec("brightness", Unit.PROCESSING_UNIT, 0, 0x02, 2, true),
        Spec("contrast", Unit.PROCESSING_UNIT, 1, 0x03, 2, false),
        Spec("hue", Unit.PROCESSING_UNIT, 2, 0x06, 2, true),
        Spec("saturation", Unit.PROCESSING_UNIT, 3, 0x07, 2, false),
        Spec("sharpness", Unit.PROCESSING_UNIT, 4, 0x08, 2, false),
        Spec("gamma", Unit.PROCESSING_UNIT, 5, 0x09, 2, false),
        Spec("white_balance_temperature", Unit.PROCESSING_UNIT, 6, 0x0A, 2, false),
        Spec("white_balance_component", Unit.PROCESSING_UNIT, 7, 0x0C, 4, false),
        Spec("backlight_compensation", Unit.PROCESSING_UNIT, 8, 0x01, 2, false),
        Spec("gain", Unit.PROCESSING_UNIT, 9, 0x04, 2, false),
        Spec("power_line_frequency", Unit.PROCESSING_UNIT, 10, 0x05, 1, false),
        Spec("hue_auto", Unit.PROCESSING_UNIT, 11, 0x10, 1, false),
        Spec("white_balance_temperature_auto", Unit.PROCESSING_UNIT, 12, 0x0B, 1, false),
        Spec("white_balance_component_auto", Unit.PROCESSING_UNIT, 13, 0x0D, 1, false),
        Spec("digital_multiplier", Unit.PROCESSING_UNIT, 14, 0x0E, 2, false),
        Spec("digital_multiplier_limit", Unit.PROCESSING_UNIT, 15, 0x0F, 2, false),
        Spec("analog_video_standard", Unit.PROCESSING_UNIT, 16, 0x11, 1, false),
        Spec("analog_lock_status", Unit.PROCESSING_UNIT, 17, 0x12, 1, false),
        Spec("contrast_auto", Unit.PROCESSING_UNIT, 18, 0x13, 1, false),
    )

    /** Что нашлось в дескрипторах: адреса блоков и их декларации. */
    data class Topology(
        val vcInterface: Int,
        val cameraTerminalId: Int,
        val cameraTerminalControls: Long,
        val processingUnitId: Int,
        val processingUnitControls: Long,
    )

    /** Снятое с камеры состояние одного контрола. `null` в поле = камера на этот запрос не ответила. */
    data class Reading(
        val spec: Spec,
        val declared: Boolean,
        val cur: Int?,
        val min: Int?,
        val max: Int?,
        val res: Int?,
        val def: Int?,
        val error: String? = null,
    )

    /**
     * Разбор сырых дескрипторов устройства.
     *
     * Дескрипторы лежат подряд: у каждого первый байт — длина, второй — тип. Идём по цепочке и
     * ищем VideoControl-интерфейс, а внутри него — Camera Terminal (input terminal с типом
     * `ITT_CAMERA`) и Processing Unit. `bmControls` — битовая маска переменной длины (`bControlSize`).
     *
     * Возвращает `null`, если VideoControl-интерфейса нет вовсе (устройство не UVC).
     */
    fun parseTopology(raw: ByteArray): Topology? {
        var i = 0
        var vcInterface = -1
        var inVideoControl = false
        var ctId = -1
        var ctControls = 0L
        var puId = -1
        var puControls = 0L

        while (i + 1 < raw.size) {
            val len = raw[i].toInt() and 0xFF
            if (len < 2) break // защита от порчи: нулевая длина = бесконечный цикл
            val type = raw[i + 1].toInt() and 0xFF

            if (type == DESC_TYPE_INTERFACE && i + 6 < raw.size) {
                val number = raw[i + 2].toInt() and 0xFF
                val cls = raw[i + 5].toInt() and 0xFF
                val sub = raw[i + 6].toInt() and 0xFF
                inVideoControl = cls == CLASS_VIDEO && sub == SUBCLASS_VIDEOCONTROL
                if (inVideoControl) vcInterface = number
            } else if (type == DESC_TYPE_CS_INTERFACE && inVideoControl && i + 2 < raw.size) {
                when (raw[i + 2].toInt() and 0xFF) {
                    VC_INPUT_TERMINAL -> {
                        // Camera Terminal — это input terminal, у которого wTerminalType == ITT_CAMERA.
                        // У прочих input-терминалов (микрофон, композит) полей bmControls нет вовсе.
                        if (i + 5 < raw.size) {
                            val termType = readLe(raw, i + 4, 2).toInt()
                            if (termType == ITT_CAMERA && i + 14 < raw.size) {
                                ctId = raw[i + 3].toInt() and 0xFF
                                val ctrlSize = raw[i + 14].toInt() and 0xFF
                                ctControls = readLe(raw, i + 15, ctrlSize.coerceAtMost(8))
                            }
                        }
                    }
                    VC_PROCESSING_UNIT -> {
                        if (i + 7 < raw.size) {
                            puId = raw[i + 3].toInt() and 0xFF
                            val ctrlSize = raw[i + 7].toInt() and 0xFF
                            puControls = readLe(raw, i + 8, ctrlSize.coerceAtMost(8))
                        }
                    }
                }
            }
            i += len
        }
        if (vcInterface < 0) return null
        return Topology(vcInterface, ctId, ctControls, puId, puControls)
    }

    /**
     * Спросить камеру про все контролы каталога.
     *
     * Читаем ТОЛЬКО то, что камера объявила в `bmControls`: слать запросы по необъявленным контролам
     * бессмысленно и на некоторых камерах вызывает залипание. Необъявленные попадают в результат
     * строкой `declared=false` — их отсутствие тоже факт инвентаря.
     */
    fun probe(conn: UsbDeviceConnection, topo: Topology, timeoutMs: Int = 300): List<Reading> =
        CATALOG.map { spec ->
            val unitId = if (spec.unit == Unit.CAMERA_TERMINAL) topo.cameraTerminalId else topo.processingUnitId
            val mask = if (spec.unit == Unit.CAMERA_TERMINAL) topo.cameraTerminalControls else topo.processingUnitControls
            val declared = unitId >= 0 && (mask shr spec.bit) and 1L == 1L
            if (!declared) {
                Reading(spec, declared = false, cur = null, min = null, max = null, res = null, def = null)
            } else {
                // Тумблеры «авто» (1 байт) по спеке не обязаны отвечать на MIN/MAX/RES — не считаем
                // это ошибкой, просто оставляем поля пустыми.
                val cur = request(conn, GET_CUR, spec, unitId, topo.vcInterface, timeoutMs)
                val min = request(conn, GET_MIN, spec, unitId, topo.vcInterface, timeoutMs)
                val max = request(conn, GET_MAX, spec, unitId, topo.vcInterface, timeoutMs)
                val res = request(conn, GET_RES, spec, unitId, topo.vcInterface, timeoutMs)
                val def = request(conn, GET_DEF, spec, unitId, topo.vcInterface, timeoutMs)
                Reading(
                    spec, declared = true,
                    cur = cur.value, min = min.value, max = max.value, res = res.value, def = def.value,
                    // Код возврата в улику: −1 = отказ транспорта (устройство занято / интерфейс не
                    // захвачен), 0 = устройство приняло запрос, но данных не дало, >0 но меньше
                    // ожидаемого = ответ короче, чем требует спека для этого контрола.
                    error = if (cur.value == null) "нет ответа (rc: cur=${cur.rc} min=${min.rc} max=${max.rc})" else null,
                )
            }
        }

    /**
     * Один запрос к камере. `wValue` = селектор в СТАРШЕМ байте, `wIndex` = (unit << 8) | интерфейс.
     * Возвращает `null`, если камера не ответила — молчаливых нулей тут быть не должно: ноль есть
     * законное значение, и путать его с отказом нельзя (класс тихих дефектов, `bugs/80`).
     */
    /**
     * Результат одного запроса: значение (или `null`) И КОД ВОЗВРАТА.
     * Код обязателен: `controlTransfer` отказывает молча (−1), и без него отказ неотличим от
     * «камера ответила пусто» — ровно тот класс тихих дефектов, что стоил нам `bugs/80`.
     */
    private data class Answer(val value: Int?, val rc: Int)

    private fun request(
        conn: UsbDeviceConnection,
        req: Int,
        spec: Spec,
        unitId: Int,
        iface: Int,
        timeoutMs: Int,
    ): Answer {
        val buf = ByteArray(spec.size)
        val n = conn.controlTransfer(
            REQ_TYPE_GET_IF,
            req,
            spec.selector shl 8,
            (unitId shl 8) or iface,
            buf,
            spec.size,
            timeoutMs,
        )
        if (n < spec.size) return Answer(null, n)
        val v = readLe(buf, 0, spec.size)
        return Answer(if (spec.signed) signExtend(v, spec.size) else v.toInt(), n)
    }

    /** Little-endian чтение [len] байт начиная с [off]. UVC везде little-endian. */
    private fun readLe(a: ByteArray, off: Int, len: Int): Long {
        var v = 0L
        for (k in 0 until len) {
            if (off + k >= a.size) break
            v = v or ((a[off + k].toLong() and 0xFF) shl (8 * k))
        }
        return v
    }

    /** Знаковое расширение: у яркости и оттенка диапазон идёт через ноль (напр. −64…+64). */
    private fun signExtend(v: Long, sizeBytes: Int): Int {
        val bits = sizeBytes * 8
        if (bits >= 64) return v.toInt()
        val signBit = 1L shl (bits - 1)
        return if (v and signBit != 0L) (v - (1L shl bits)).toInt() else v.toInt()
    }

    /**
     * Печать инвентаря в лог — то, ради чего вся фаза 0. Формат специально плоский и греп-дружелюбный:
     * его читает и человек, и следующая сессия.
     */
    fun dumpToLog(label: String, topo: Topology?, readings: List<Reading>) {
        if (topo == null) {
            KLog.e(TAG, "инвентарь[$label]: VideoControl-интерфейс НЕ НАЙДЕН — устройство не UVC или дескрипторы не прочитаны")
            return
        }
        KLog.i(
            TAG,
            "инвентарь[$label]: vcIface=${topo.vcInterface} " +
                "cameraTerminal=id${topo.cameraTerminalId}/маска0x${topo.cameraTerminalControls.toString(16)} " +
                "processingUnit=id${topo.processingUnitId}/маска0x${topo.processingUnitControls.toString(16)}",
        )
        val declared = readings.count { it.declared }
        KLog.i(TAG, "инвентарь[$label]: объявлено контролов ${declared} из ${readings.size}")
        for (r in readings) {
            if (!r.declared) continue
            KLog.i(
                TAG,
                "инвентарь[$label] ${r.spec.name} (${if (r.spec.unit == Unit.CAMERA_TERMINAL) "CT" else "PU"}) " +
                    "cur=${r.cur} min=${r.min} max=${r.max} res=${r.res} def=${r.def}" +
                    (r.error?.let { " ОШИБКА: $it" } ?: ""),
            )
        }
        val silent = readings.filter { it.declared && it.error != null }
        if (silent.isNotEmpty()) {
            KLog.w(TAG, "инвентарь[$label]: объявлены, но молчат — ${silent.joinToString { it.spec.name }}")
        }
    }
}
