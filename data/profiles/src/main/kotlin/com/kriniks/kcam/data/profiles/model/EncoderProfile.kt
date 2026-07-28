/**
 * EncoderProfile — профиль КОДЕРА: как кодировать видео/звук (разрешение, битрейт, fps, кодек,
 * параметры звука). Отдельная сущность от StreamProfile (платформы) — решение Криника 2026-07-18
 * (bug 41 / plans/14): платформа лишь ССЫЛАЕТСЯ на профиль кодера по id, а сам кодек настраивается в
 * отдельном менеджере. Один профиль кодера переиспользуется многими платформами (без дублирования
 * параметров энкодера).
 *
 * Хранится в Room (EncoderProfileEntity, таблица encoder_profiles). Related: StreamProfile (ссылается
 * через encoderProfileId), EncoderProfileDao, ProfilesRepository, RtmpStreamer (резолвит и кодирует).
 */

package com.kriniks.kcam.data.profiles.model

import kotlinx.serialization.Serializable

@Serializable
data class EncoderProfile(
    val id: Long = 0,
    // Все поля с дефолтами: импорт/экспорт (Idea 01) толерантен, а недостающее поле в файле → дефолт.
    val name: String = "",                 // имя профиля кодера, напр. "1080p30 H.264"
    val videoWidth: Int = 1920,
    val videoHeight: Int = 1080,
    val videoFps: Int = 30,
    val videoBitrateBps: Int = 4_000_000,
    val videoCodec: VideoCodec = VideoCodec.H264,
    // idea 37 — адаптивный битрейт: при затыке канала плавно снижать битрейт вместо фризов.
    val adaptiveBitrate: Boolean = true,
    // Р7 (решение Криника, interview_011) — ПОЛ адаптива: ниже этого значения видеобитрейт не
    // опускается. Раньше был хардкод 1 Мбит/с в RtmpStreamer, и это ЛОМАЛО вижн «эфир не умирает»:
    // 1 Мбит/с ВЫШЕ реальной полосы плохого 3G (~400 кбит/с), поэтому адаптив упирался в пол, канал
    // не вытягивал даже минимум, очередь копилась и эфир глох (класс K1, researches/network_resilience.md).
    // Дефолт 250 кбит/с подтверждён Криником (интервью 012, В5): 250 видео + 128 звук ≈ 380 кбит/с —
    // влезает в плохой 3G, а 300+128=428 уже нет. Значение — НАМЕРЕНИЕ; кламп живёт в точке применения
    // (RtmpStreamer), чтобы временное снижение цели не переписало пол в БД навсегда.
    // [TESTED: 2026-07-28 · §14.2 A4/A6 — на полу 250 полка исходящего битрейта 373–404 кбит/с при
    //  dropV=0; сквозной путь UI→Room→эфир проверен отдельно значением 500 (полка 624–646 кбит/с)]
    val minVideoBitrateBps: Int = 250_000,
    // Звук. Дефолты = прежнее захардкоженное поведение (44100/стерео/128к).
    val audioBitrateBps: Int = 128_000,
    val audioSampleRate: Int = 44_100,     // 44100 / 48000 Гц
    val audioChannelMode: AudioChannelMode = AudioChannelMode.STEREO,
)

/**
 * VideoCodec — видеокодек профиля кодера.
 *
 * H264 — универсальный: принимают ВСЕ RTMP-платформы, всегда безопасен.
 * H265 (HEVC) — примерно вдвое эффективнее по битрейту, НО по классическому RTMP его берут не все
 *   (enhanced-RTMP): YouTube — да, многие приёмники — нет. Для записи в файл безопасен всегда.
 * AV1 — ещё эффективнее H265, но по RTMP принимают ЕДИНИЦЫ площадок; для записи в файл — ок, если у
 *   устройства есть аппаратный AV1-энкодер (иначе prepareVideo вернёт false).
 *
 * Маппится в библиотечный com.pedro.common.VideoCodec на уровне :feature:streaming. Хранится как имя.
 */
@Serializable
enum class VideoCodec(val displayName: String) {
    H264("H.264 / AVC"),
    H265("H.265 / HEVC"),
    AV1("AV1"),
}

/**
 * AudioChannelMode — режим каналов звука (bug 44, решение Криника 2026-07-18). Три варианта, чтобы
 * покрыть все запросы площадок/стримеров:
 *
 * STEREO        — истинное стерео: L и R независимы (как с источника). 2 канала.
 * MONO          — одноканальная дорожка (1 канал = даунмикс L+R, не «только левый»). Меньше битрейта.
 * JOINED_STEREO — «объединённое стерео»: 2 канала, но ОБА несут одинаковый даунмикс L+R (L == R). Для
 *                 площадок, что ТРЕБУЮТ стерео-контейнер при моно-источнике.
 *
 * Дефолт — STEREO. Маппинг в параметры энкодера + PCM-даунмикс — в :feature:streaming.
 */
@Serializable
enum class AudioChannelMode(val displayName: String) {
    STEREO("stereo"),
    MONO("mono"),
    JOINED_STEREO("joined-stereo"),
}
