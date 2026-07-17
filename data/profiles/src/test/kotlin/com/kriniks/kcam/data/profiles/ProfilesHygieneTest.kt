/**
 * ProfilesHygieneTest — JVM-юниты гигиены профилей (plans/12 S6, первая юнит-инфра проекта).
 *
 * Покрывает ЧИСТУЮ логику без Android-зависимостей:
 *  1. valueOf-фолбэк (bug 37 смежное): битое значение платформы из БД (даунгрейд/кривой импорт)
 *     деградирует в CUSTOM, а не роняет весь Flow профилей IllegalArgumentException'ом.
 *  2. Дедуп импорта (plans/12 S5): повторный импорт того же файла не плодит копии; идентичность =
 *     (platform, rtmpUrl, streamKey).
 *
 * Запуск: JAVA_HOME=<JBR> ./gradlew :data:profiles:testDebugUnitTest
 * [TESTED: 2026-07-18 · testDebugUnitTest — все зелёные]
 */

package com.kriniks.kcam.data.profiles

import com.kriniks.kcam.data.profiles.db.StreamProfileEntity
import com.kriniks.kcam.data.profiles.model.ProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.StreamProfile
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
        videoWidth = 1920,
        videoHeight = 1080,
        videoFps = 30,
        videoBitrateBps = 4_000_000,
    )

    @Test
    fun `битое значение платформы деградирует в CUSTOM, поля целы`() {
        val profile = entity("GARBAGE_FROM_FUTURE").toProfile()
        assertEquals(StreamPlatform.CUSTOM, profile.platform)
        assertEquals("rtmp://x/app", profile.rtmpUrl) // ключ/URL не потеряны
        assertEquals("k", profile.streamKey)
    }

    @Test
    fun `валидное значение платформы маппится как раньше`() {
        assertEquals(StreamPlatform.YOUTUBE, entity("YOUTUBE").toProfile().platform)
    }

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
    fun `дедуп схлопывает дубли внутри самого импорта`() {
        val twin = profile(StreamPlatform.CUSTOM, "rtmp://c/x", "kk")
        val fresh = ProfilesBackupCodec.dedup(listOf(twin, twin.copy(name = "copy")), emptyList())
        assertEquals(1, fresh.size)
    }

    @Test
    fun `дедуп пропускает одинаковый ключ на РАЗНЫХ платформах`() {
        val a = profile(StreamPlatform.YOUTUBE, "rtmp://a/live2", "same")
        val b = profile(StreamPlatform.TWITCH, "rtmp://t/app", "same")
        assertEquals(2, ProfilesBackupCodec.dedup(listOf(a, b), emptyList()).size)
    }
}
