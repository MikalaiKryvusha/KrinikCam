/**
 * StreamProfileEntity — Room table row for a streaming platform profile.
 * Maps 1:1 to StreamProfile domain model via toProfile() / StreamProfile.toEntity().
 * Related: AppDatabase, StreamProfileDao, StreamProfile (domain model)
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.StreamProfile

@Entity(tableName = "stream_profiles")
data class StreamProfileEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val platform: String,           // StreamPlatform.name()
    val rtmpUrl: String,
    val streamKey: String,
    val isEnabled: Boolean,
    val videoWidth: Int,
    val videoHeight: Int,
    val videoFps: Int,
    val videoBitrateBps: Int,
    // idea 37 — версия схемы 2 (MIGRATION_1_2): адаптивный битрейт, дефолт ВКЛ.
    val adaptiveBitrate: Boolean = true,
) {
    fun toProfile() = StreamProfile(
        id             = id,
        name           = name,
        // bug 37 (смежное) / plans/12 S1 — неизвестное значение платформы (даунгрейд приложения,
        // битый импорт) раньше роняло valueOf → IllegalArgumentException → падал ВЕСЬ Flow профилей.
        // Теперь деградируем мягко в CUSTOM: профиль жив, URL/ключ сохранены.
        platform       = runCatching { StreamPlatform.valueOf(platform) }.getOrDefault(StreamPlatform.CUSTOM),
        rtmpUrl        = rtmpUrl,
        streamKey      = streamKey,
        isEnabled      = isEnabled,
        videoWidth     = videoWidth,
        videoHeight    = videoHeight,
        videoFps       = videoFps,
        videoBitrateBps = videoBitrateBps,
        adaptiveBitrate = adaptiveBitrate,
    )
}

fun StreamProfile.toEntity() = StreamProfileEntity(
    id              = id,
    name            = name,
    platform        = platform.name,
    rtmpUrl         = rtmpUrl,
    streamKey       = streamKey,
    isEnabled       = isEnabled,
    videoWidth      = videoWidth,
    videoHeight     = videoHeight,
    videoFps        = videoFps,
    videoBitrateBps = videoBitrateBps,
    adaptiveBitrate = adaptiveBitrate,
)
