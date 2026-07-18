/**
 * ProfilesHygieneTest — JVM-юниты гигиены профилей (plans/12 S6; расширено plans/14).
 *
 * Покрывает ЧИСТУЮ логику без Android-зависимостей:
 *  1. valueOf-фолбэк платформы (bug 37): битое значение из БД деградирует в CUSTOM, не роняя Flow.
 *  2. Дедуп импорта (plans/12 S5): идентичность = (platform, rtmpUrl, streamKey).
 *  3. Профиль кодера (plans/14): round-trip EncoderProfile↔entity, фолбэк кодека/режима каналов,
 *     дефолты = прежнее поведение (H.264 / 128к / 44100 / стерео).
 *
 * Запуск: JAVA_HOME=<JBR> ./gradlew :data:profiles:testDebugUnitTest
 * [TESTED: 2026-07-18 · testDebugUnitTest]
 */

package com.kriniks.kcam.data.profiles

import com.kriniks.kcam.data.profiles.db.EncoderProfileEntity
import com.kriniks.kcam.data.profiles.db.StreamProfileEntity
import com.kriniks.kcam.data.profiles.db.toEntity
import com.kriniks.kcam.data.profiles.model.AudioChannelMode
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.ProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.data.profiles.model.VideoCodec
import org.junit.Assert.assertEquals
import org.junit.Test

class ProfilesHygieneTest {

    private fun entity(platform: String) = StreamProfileEntity(
        id = 1L,
        name = "n",
        platform = platform,
        rtmpUrl = "rtmp://x/app",
        streamKey = "k",
        isEnabled = true,
        encoderProfileId = 7L,
    )

    @Test
    fun `битое значение платформы деградирует в CUSTOM, поля целы`() {
        val profile = entity("GARBAGE_FROM_FUTURE").toProfile()
        assertEquals(StreamPlatform.CUSTOM, profile.platform)
        assertEquals("rtmp://x/app", profile.rtmpUrl) // ключ/URL не потеряны
        assertEquals("k", profile.streamKey)
        assertEquals(7L, profile.encoderProfileId)    // ссылка на профиль кодера цела
    }

    @Test
    fun `валидное значение платформы маппится как раньше`() {
        assertEquals(StreamPlatform.YOUTUBE, entity("YOUTUBE").toProfile().platform)
    }

    // ── Дедуп импорта ───────────────────────────────────────────────────────────────────────────

    private fun profile(platform: StreamPlatform, url: String, key: String, name: String = "p") =
        StreamProfile(name = name, platform = platform, rtmpUrl = url, streamKey = key)

    @Test
    fun `дедуп отбрасывает уже существующие профили`() {
        val existing = listOf(profile(StreamPlatform.YOUTUBE, "rtmp://a/live2", "k1"))
        val imported = listOf(
            profile(StreamPlatform.YOUTUBE, "rtmp://a/live2", "k1", name = "другое имя — всё равно дубль"),
            profile(StreamPlatform.TWITCH, "rtmp://t/app", "k2"),
        )
        val fresh = ProfilesBackupCodec.dedup(imported, existing)
        assertEquals(listOf(StreamPlatform.TWITCH), fresh.map { it.platform })
    }

    @Test
    fun `дедуп пропускает одинаковый ключ на РАЗНЫХ платформах`() {
        val a = profile(StreamPlatform.YOUTUBE, "rtmp://a/live2", "same")
        val b = profile(StreamPlatform.TWITCH, "rtmp://t/app", "same")
        assertEquals(2, ProfilesBackupCodec.dedup(listOf(a, b), emptyList()).size)
    }

    // ── Профиль кодера (plans/14) ─────────────────────────────────────────────────────────────────

    @Test
    fun `битый кодек и режим каналов деградируют в дефолт`() {
        val e = EncoderProfileEntity(
            id = 1L, name = "e", videoWidth = 1920, videoHeight = 1080, videoFps = 30,
            videoBitrateBps = 4_000_000, videoCodec = "AV99_FROM_FUTURE", adaptiveBitrate = true,
            audioBitrateBps = 128_000, audioSampleRate = 44_100, audioChannelMode = "SURROUND_9_1",
        )
        val p = e.toProfile()
        assertEquals(VideoCodec.H264, p.videoCodec)
        assertEquals(AudioChannelMode.STEREO, p.audioChannelMode)
    }

    @Test
    fun `профиль кодера переживает round-trip profile↔entity`() {
        val p = EncoderProfile(
            name = "av1", videoCodec = VideoCodec.AV1,
            audioBitrateBps = 192_000, audioSampleRate = 48_000,
            audioChannelMode = AudioChannelMode.JOINED_STEREO,
        )
        val back = p.toEntity().toProfile()
        assertEquals(VideoCodec.AV1, back.videoCodec)
        assertEquals(192_000, back.audioBitrateBps)
        assertEquals(48_000, back.audioSampleRate)
        assertEquals(AudioChannelMode.JOINED_STEREO, back.audioChannelMode)
    }

    @Test
    fun `дефолты профиля кодера повторяют прежнее захардкоженное поведение`() {
        val p = EncoderProfile()
        assertEquals(VideoCodec.H264, p.videoCodec)
        assertEquals(4_000_000, p.videoBitrateBps)
        assertEquals(128_000, p.audioBitrateBps)
        assertEquals(44_100, p.audioSampleRate)
        assertEquals(AudioChannelMode.STEREO, p.audioChannelMode)
    }
}
