/**
 * StreamState — current state of the RTMP streaming session.
 * Observed by StreamViewModel and the UI overlay.
 * Related: RtmpStreamer, StreamViewModel, FloatingRadialMenu
 */

package com.kriniks.kcam.feature.streaming.model

sealed class StreamState {
    object Idle : StreamState()                     // not streaming
    object Connecting : StreamState()               // TCP handshake in progress
    data class Live(                                // streaming successfully
        val durationMs: Long = 0,
        val bitrateKbps: Int = 0,
        val droppedFrames: Int = 0,
        // Криник — запись в файл переиспользует Live-состояние; этот флаг отличает ЗАПИСЬ от ЭФИРА,
        // чтобы статус-виджет писал «ЗАПИСЬ», а не «ЭФИР» (запись ≠ стрим). copy() сохраняет флаг.
        val isRecording: Boolean = false,
        // plans/09 S2 — статусы КАЖДОГО RTMP-выхода мультистрима (YouTube/Twitch/…) для UI.
        // Аддитивно (дефолт пуст) — одно-выходной путь и существующий `.copy(bitrateKbps=…)` целы.
        val outputs: List<OutputStatus> = emptyList(),
    ) : StreamState()
    data class Error(val message: String) : StreamState()   // connection lost
    object Stopping : StreamState()                 // stopping in progress
}

/**
 * plans/09 S2 — фаза ОДНОГО RTMP-выхода мультистрима (по индексу). Мультистрим = один энкодер на N
 * выходов; каждый выход живёт своей жизнью (может упасть/реконнектиться независимо от остальных).
 */
enum class OutputPhase {
    Connecting,     // идёт TCP/RTMP-хендшейк этого выхода
    Live,           // выход в эфире
    Reconnecting,   // выход упал, идёт авто-реконнект с бэкоффом (S4)
    Failed,         // выход изолирован (реконнект исчерпан / кривой ключ) — живые не трогаем (S3)
    Stopped,        // выход штатно остановлен
}

/**
 * plans/09 S2 — статус одного RTMP-выхода: индекс, имя платформы, фаза, битрейт и (для Reconnecting/
 * Failed) причина + номер попытки. UI показывает список этих статусов («Twitch упал, YouTube в эфире»).
 */
data class OutputStatus(
    val index: Int,
    val name: String,
    val phase: OutputPhase,
    val bitrateKbps: Int = 0,
    val reason: String? = null,
    val attempt: Int = 0,
    // idea 37 — затык КАНАЛА этого выхода (StreamClient.hasCongestion): очередь отправки пухнет,
    // сеть не вывозит. Жёлтый индикатор health и триггер адаптивного битрейта. Аддитивно (дефолт false).
    val congested: Boolean = false,
)

val StreamState.isLive: Boolean get() = this is StreamState.Live
val StreamState.isActive: Boolean get() = this is StreamState.Live || this is StreamState.Connecting
