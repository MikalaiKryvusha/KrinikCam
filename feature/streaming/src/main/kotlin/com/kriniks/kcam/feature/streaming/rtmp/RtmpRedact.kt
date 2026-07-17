/**
 * RtmpRedact — редакция секретного stream-ключа в RTMP-URL для ЛЮБОГО лог-вывода (bug 37 №3).
 *
 * Полный URL вида rtmp://host/app/STREAMKEY уходил открытым текстом в logcat и в персистентный
 * файл FileLogger, который по гайду пуллится с устройства и прикладывается к баг-репортам/ДЗ —
 * утечка ключа = кто угодно стримит в канал Криника. Ключ — ПОСЛЕДНИЙ сегмент пути RTMP-URL
 * (конвенция всех платформ: YouTube/Twitch/TikTok...); базовая часть остаётся видимой — она
 * нужна для диагностики (хост/приложение), секрет маскируется.
 *
 * Related: RtmpStreamer (лог-точки connect/start), MainActivity (лог CMD go-live-rtmp).
 * [TESTED: 2026-07-18 · приёмка bug 37 — в логе «•••t2» вместо ключей, сырых URL нет]
 */

package com.kriniks.kcam.feature.streaming.rtmp

/**
 * Маскирует stream-ключ (последний сегмент пути) RTMP-URL: длинный ключ → `•••` + последние 2
 * символа (достаточно сверить «тот ли ключ», не раскрывая его), короткий (≤4) — целиком `••••`.
 * Не-URL / URL без пути возвращается как есть (нечего прятать).
 */
fun redactRtmpUrl(url: String): String {
    val schemeEnd = url.indexOf("://").let { if (it < 0) 0 else it + 3 }
    val cut = url.lastIndexOf('/')
    if (cut <= schemeEnd) return url // нет сегмента ключа (rtmp://host или мусор)
    val base = url.substring(0, cut)
    val key = url.substring(cut + 1)
    if (key.isEmpty()) return url
    return if (key.length > 4) "$base/•••${key.takeLast(2)}" else "$base/••••"
}
