/**
 * EncoderProfileEntity — Room table row for a codec (encoder) profile.
 * Maps 1:1 to EncoderProfile domain model. Table encoder_profiles (schema v4, plans/14).
 *
 * Related: AppDatabase, EncoderProfileDao, EncoderProfile (domain), StreamProfileEntity (ссылается).
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.kriniks.kcam.data.profiles.model.AudioChannelMode
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.VideoCodec

@Entity(tableName = "encoder_profiles")
data class EncoderProfileEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val videoWidth: Int,
    val videoHeight: Int,
    val videoFps: Int,
    val videoBitrateBps: Int,
    val videoCodec: String,          // VideoCodec.name()
    val adaptiveBitrate: Boolean,
    val audioBitrateBps: Int,
    val audioSampleRate: Int,
    val audioChannelMode: String,    // AudioChannelMode.name()
) {
    fun toProfile() = EncoderProfile(
        id              = id,
        name            = name,
        videoWidth      = videoWidth,
        videoHeight     = videoHeight,
        videoFps        = videoFps,
        videoBitrateBps = videoBitrateBps,
        // Мягкий фолбэк (как у платформы): неизвестный кодек/режим (даунгрейд/битый импорт) → дефолт.
        videoCodec      = runCatching { VideoCodec.valueOf(videoCodec) }.getOrDefault(VideoCodec.H264),
        adaptiveBitrate = adaptiveBitrate,
        audioBitrateBps = audioBitrateBps,
        audioSampleRate = audioSampleRate,
        audioChannelMode = runCatching { AudioChannelMode.valueOf(audioChannelMode) }.getOrDefault(AudioChannelMode.STEREO),
    )
}

fun EncoderProfile.toEntity() = EncoderProfileEntity(
    id              = id,
    name            = name,
    videoWidth      = videoWidth,
    videoHeight     = videoHeight,
    videoFps        = videoFps,
    videoBitrateBps = videoBitrateBps,
    videoCodec      = videoCodec.name,
    adaptiveBitrate = adaptiveBitrate,
    audioBitrateBps = audioBitrateBps,
    audioSampleRate = audioSampleRate,
    audioChannelMode = audioChannelMode.name,
)
