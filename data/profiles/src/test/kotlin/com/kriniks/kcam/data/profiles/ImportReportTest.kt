/**
 * ImportReportTest — JVM-юниты УНИВЕРСАЛЬНОГО менеджера импорта (Криник, 2026-07-19).
 *
 * Проверяет честный отчёт [ImportReport] при импорте: недостающее поле → MissingField+дефолт;
 * известный ключ с неизвестным значением enum → UnknownValue+fallback. И для профилей кодера, и для
 * платформ (общий контракт `decodeWithReport`). Чистая логика без Android.
 *
 * Запуск: JAVA_HOME=<JBR> ./gradlew :data:profiles:testDebugUnitTest
 */

package com.kriniks.kcam.data.profiles

import com.kriniks.kcam.data.profiles.model.EncoderProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.ImportIssue
import com.kriniks.kcam.data.profiles.model.ProfilesBackupCodec
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.VideoCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportReportTest {

    @Test
    fun encoder_missingField_and_unknownCodec_reported_with_fallbacks() {
        // videoFps ОТСУТСТВУЕТ; videoCodec = "H999" (неизвестно). Остальное валидно.
        val json = """
            {"encoderProfiles":[
              {"name":"Test 720p","videoWidth":1280,"videoHeight":720,
               "videoBitrateBps":2000000,"videoCodec":"H999",
               "adaptiveBitrate":true,"audioBitrateBps":128000,
               "audioSampleRate":48000,"audioChannelMode":"MONO"}
            ]}
        """.trimIndent()

        val (profiles, report) = EncoderProfilesBackupCodec.decodeWithReport(json)

        assertEquals(1, profiles.size)
        // Валидные поля сохранены.
        assertEquals(1280, profiles[0].videoWidth)
        // Недостающее поле → дефолт 30.
        assertEquals(30, profiles[0].videoFps)
        // Неизвестный кодек → fallback H264.
        assertEquals(VideoCodec.H264, profiles[0].videoCodec)

        assertTrue(report.hasIssues)
        assertTrue("ждём MissingField videoFps",
            report.issues.any { it is ImportIssue.MissingField && it.field == "videoFps" && it.fallback == "30" })
        assertTrue("ждём UnknownValue videoCodec H999→H264",
            report.issues.any { it is ImportIssue.UnknownValue && it.field == "videoCodec" && it.received == "H999" && it.fallback == "H264" })
    }

    @Test
    fun platform_unknownPlatform_and_missingKey_reported() {
        // platform неизвестна; streamKey/isEnabled/encoderProfileId отсутствуют.
        val json = """{"profiles":[{"name":"X","platform":"MYSPACE","rtmpUrl":"rtmp://x/live"}]}"""

        val (profiles, report) = ProfilesBackupCodec.decodeWithReport(json)

        assertEquals(1, profiles.size)
        assertEquals("rtmp://x/live", profiles[0].rtmpUrl)
        // Неизвестная платформа → CUSTOM.
        assertEquals(StreamPlatform.CUSTOM, profiles[0].platform)
        assertTrue(report.hasIssues)
        assertTrue("ждём UnknownValue platform",
            report.issues.any { it is ImportIssue.UnknownValue && it.field == "platform" && it.received == "MYSPACE" })
        assertTrue("ждём MissingField streamKey",
            report.issues.any { it is ImportIssue.MissingField && it.field == "streamKey" })
    }

    @Test
    fun clean_import_has_no_issues() {
        // Полный валидный профиль кодера — замечаний быть не должно.
        val json = EncoderProfilesBackupCodec.encode(
            listOf(com.kriniks.kcam.data.profiles.model.EncoderProfile(name = "Full", videoFps = 60)),
        )
        val (profiles, report) = EncoderProfilesBackupCodec.decodeWithReport(json)
        assertEquals(1, profiles.size)
        assertEquals(60, profiles[0].videoFps)
        assertEquals(false, report.hasIssues)
    }
}
