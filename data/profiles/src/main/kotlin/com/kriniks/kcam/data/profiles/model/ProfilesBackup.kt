/**
 * ProfilesBackup — import/export container for streaming platform profiles (Idea 01).
 *
 * Human-readable, script-friendly JSON. Tolerant by design (see ProfilesBackupCodec):
 *   - unknown/extra fields are ignored;
 *   - missing fields fall back to StreamProfile defaults.
 *
 * Wrapped in a versioned object (app/version) so the format can evolve without breaking old files.
 *
 * Related: StreamProfile, ProfilesBackupCodec, StreamViewModel (export/import actions)
 */

package com.kriniks.kcam.data.profiles.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class ProfilesBackup(
    val app: String = "KrinikCam",
    val version: Int = 1,
    val profiles: List<StreamProfile> = emptyList(),
)

/** Encode/decode [ProfilesBackup] JSON. Tolerant decode (ignore extra, default missing). */
object ProfilesBackupCodec {

    private val json = Json {
        prettyPrint = true          // human-readable export
        ignoreUnknownKeys = true    // лишние поля игнорируем
        coerceInputValues = true    // недостающие/невалидные → дефолты модели
        isLenient = true
        encodeDefaults = true       // пишем все поля, чтобы файл был полным и читаемым
    }

    /** Serialize the given profiles to a pretty JSON string. */
    fun encode(profiles: List<StreamProfile>): String =
        json.encodeToString(ProfilesBackup(profiles = profiles))

    /**
     * Parse a config file's JSON into a list of profiles. Returns empty list on unparseable input
     * (caller decides what to do). Each profile keeps its fields; the caller should reset `id` to 0
     * before saving so imports are inserted as NEW rows (no id collisions / overwrites).
     */
    fun decode(text: String): List<StreamProfile> =
        runCatching { json.decodeFromString<ProfilesBackup>(text).profiles }.getOrDefault(emptyList())

    /**
     * plans/12 S5 — дедупликация импорта: повторный импорт того же файла не плодит копии.
     * «Тот же профиль» = совпали (platform, rtmpUrl, streamKey) — имя/битрейт не считаем
     * идентичностью (их правят). Дедуп и против существующих, и ВНУТРИ импортируемого списка.
     * Чистая функция — покрыта юнитом (plans/12 S6).
     */
    fun dedup(imported: List<StreamProfile>, existing: List<StreamProfile>): List<StreamProfile> {
        val seen = existing.map { Triple(it.platform, it.rtmpUrl, it.streamKey) }.toMutableSet()
        return imported.filter { seen.add(Triple(it.platform, it.rtmpUrl, it.streamKey)) }
    }
}
