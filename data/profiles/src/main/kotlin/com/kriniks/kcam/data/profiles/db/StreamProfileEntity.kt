/**
 * StreamProfileEntity — Room table row for a streaming platform profile.
 * Maps 1:1 to StreamProfile domain model via toProfile() / StreamProfile.toEntity().
 *
 * Поля кодера вынесены в encoder_profiles (EncoderProfileEntity); здесь только ссылка
 * encoderProfileId (bug 41 / plans/14, schema v4).
 *
 * Related: AppDatabase, StreamProfileDao, StreamProfile (domain model), EncoderProfileEntity
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
    // schema v4 (plans/14): ссылка на профиль кодера (encoder_profiles.id). Кодер-поля больше не тут.
    val encoderProfileId: Long = 0,
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
        encoderProfileId = encoderProfileId,
    )
}

fun StreamProfile.toEntity() = StreamProfileEntity(
    id              = id,
    name            = name,
    platform        = platform.name,
    rtmpUrl         = rtmpUrl,
    streamKey       = streamKey,
    isEnabled       = isEnabled,
    encoderProfileId = encoderProfileId,
)
