/**
 * EncoderProfilesBackup — import/export профилей КОДЕРА (Криник, 2026-07-19; по образцу [ProfilesBackup]).
 *
 * Экспорт — человекочитаемый JSON в обёртке {app, version, encoderProfiles:[...]}. Импорт — через
 * УНИВЕРСАЛЬНЫЙ [JsonImportReader] с отчётом [ImportReport]: чего не хватило / что неизвестно → какой
 * fallback поставили (модалка «Понял» в UI). Тот же контракт `decodeWithReport`, что и у платформ.
 *
 * Related: EncoderProfile, ImportReport/JsonImportReader, EncoderProfilesBackupCodec, StreamViewModel.
 */

package com.kriniks.kcam.data.profiles.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

@Serializable
data class EncoderProfilesBackup(
    val app: String = "KrinikCam",
    val version: Int = 1,
    val encoderProfiles: List<EncoderProfile> = emptyList(),
)

object EncoderProfilesBackupCodec {

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    /** Экспорт профилей кодера в pretty JSON. */
    fun encode(profiles: List<EncoderProfile>): String =
        json.encodeToString(EncoderProfilesBackup(encoderProfiles = profiles))

    /**
     * Импорт С ОТЧЁТОМ: парсим дерево и валидируем КАЖДОЕ поле через [JsonImportReader] (недостающее/
     * кривое/неизвестное → fallback + замечание). id всегда 0 (импорт вставляется как НОВЫЕ строки).
     * Возвращает (профили, отчёт). Непарсибельный ввод → (пусто, пустой отчёт).
     */
    fun decodeWithReport(text: String): Pair<List<EncoderProfile>, ImportReport> {
        val root = runCatching { json.parseToJsonElement(text) }.getOrNull()
            ?: return emptyList<EncoderProfile>() to ImportReport()
        val arr = JsonImportReader.arrayField(root, "encoderProfiles")
            ?: return emptyList<EncoderProfile>() to ImportReport()
        val issues = mutableListOf<ImportIssue>()
        val def = EncoderProfile()
        val profiles = arr.mapIndexedNotNull { i, el ->
            val o = el as? JsonObject ?: return@mapIndexedNotNull null
            val label = JsonImportReader.labelOf(o, i)
            val r = JsonImportReader(o, label, issues)
            EncoderProfile(
                id = 0,
                name = r.string("name", def.name.ifBlank { "Импорт $label" }),
                videoWidth = r.int("videoWidth", def.videoWidth),
                videoHeight = r.int("videoHeight", def.videoHeight),
                videoFps = r.int("videoFps", def.videoFps),
                videoBitrateBps = r.int("videoBitrateBps", def.videoBitrateBps),
                videoCodec = r.enumByName("videoCodec", VideoCodec.values(), def.videoCodec),
                adaptiveBitrate = r.bool("adaptiveBitrate", def.adaptiveBitrate),
                audioBitrateBps = r.int("audioBitrateBps", def.audioBitrateBps),
                audioSampleRate = r.int("audioSampleRate", def.audioSampleRate),
                audioChannelMode = r.enumByName("audioChannelMode", AudioChannelMode.values(), def.audioChannelMode),
            )
        }
        return profiles to ImportReport(issues = issues, imported = profiles.size)
    }

    /**
     * Дедуп импорта: повторный импорт того же файла не плодит копии. «Тот же профиль кодера» = совпали
     * ВСЕ значимые параметры (кроме id/имени было бы неверно — имя правят, но параметры и есть суть кодера;
     * берём и имя тоже, чтобы «1080p H.264» и его копия с другим именем считались разными по желанию юзера).
     */
    fun dedup(imported: List<EncoderProfile>, existing: List<EncoderProfile>): List<EncoderProfile> {
        fun sig(p: EncoderProfile) = listOf(
            p.name, p.videoWidth, p.videoHeight, p.videoFps, p.videoBitrateBps, p.videoCodec,
            p.adaptiveBitrate, p.audioBitrateBps, p.audioSampleRate, p.audioChannelMode,
        )
        val seen = existing.map { sig(it) }.toMutableSet()
        return imported.filter { seen.add(sig(it)) }
    }
}
