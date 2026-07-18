/**
 * ProfilesRepository — single entry point for all profile data operations.
 *
 * Combines Room (StreamProfileDao) and DataStore (ProfilesDataStore) behind
 * a clean API that callers don't need to care about the storage backend.
 *
 * Related: StreamProfileDao, ProfilesDataStore, ProfilesModule (Hilt binding)
 */

package com.kriniks.kcam.data.profiles.repository

import com.kriniks.kcam.data.profiles.datastore.ProfilesDataStore
import com.kriniks.kcam.data.profiles.db.EncoderProfileDao
import com.kriniks.kcam.data.profiles.db.StreamProfileDao
import com.kriniks.kcam.data.profiles.db.toEntity
import com.kriniks.kcam.data.profiles.model.DeviceProfile
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.StreamProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProfilesRepository @Inject constructor(
    private val dao: StreamProfileDao,
    private val encoderDao: EncoderProfileDao,
    private val dataStore: ProfilesDataStore,
) {
    // ── Stream profiles (Room) ──────────────────────────────────────────

    fun observeAllProfiles(): Flow<List<StreamProfile>> =
        dao.observeAll().map { list -> list.map { it.toProfile() } }

    fun observeEnabledProfiles(): Flow<List<StreamProfile>> =
        dao.observeEnabled().map { list -> list.map { it.toProfile() } }

    suspend fun saveProfile(profile: StreamProfile): Long =
        dao.upsert(profile.toEntity())

    suspend fun deleteProfile(profile: StreamProfile) {
        dao.delete(profile.toEntity())
        // plans/12 S5 — чистим висячий указатель: если удалили АКТИВНЫЙ профиль, снимаем выбор в
        // DataStore (иначе activeProfileId вечно указывает на несуществующую строку). Единая точка:
        // все пути удаления проходят здесь.
        if (dataStore.activeProfileId.first() == profile.id) dataStore.clearActiveProfileId()
    }

    // ── Encoder (codec) profiles (Room) — plans/14 ─────────────────────

    fun observeEncoderProfiles(): Flow<List<EncoderProfile>> =
        encoderDao.observeAll().map { list -> list.map { it.toProfile() } }

    suspend fun saveEncoderProfile(profile: EncoderProfile): Long =
        encoderDao.upsert(profile.toEntity())

    suspend fun getEncoderProfile(id: Long): EncoderProfile? =
        encoderDao.getById(id)?.toProfile()

    /** Сколько платформ ссылается на профиль кодера. */
    suspend fun encoderProfileReferences(id: Long): Int =
        encoderDao.referencingPlatforms(id)

    /**
     * Удалить профиль кодера (решение Криника 2026-07-18: удалять МОЖНО всегда, даже если на него
     * ссылаются платформы). Ссылавшиеся платформы переназначаются на ЗАПАСНОЙ профиль (fallback):
     * первый оставшийся, а если удалили последний — создаётся дефолтный. Возвращает число
     * переназначенных платформ (для инфо-снэкбара). Так ни платформа, ни эфир не остаются без профиля.
     */
    suspend fun deleteEncoderProfile(profile: EncoderProfile): Int {
        encoderDao.delete(profile.toEntity())
        val affected = encoderDao.referencingPlatforms(profile.id)  // платформы, всё ещё смотрящие на удалённый id
        if (affected > 0) {
            val fallbackId = ensureDefaultEncoderProfile()          // первый оставшийся или новый дефолт
            dao.repointEncoder(oldId = profile.id, newId = fallbackId)
        }
        return affected
    }

    /**
     * Резолв профиля кодера для эфира/записи: по id, иначе — первый доступный, иначе — создаём и
     * возвращаем дефолтный («1080p30 H.264»). Гарантирует, что энкодер всегда получит валидный профиль
     * (StreamProfile.encoderProfileId=0 или битая ссылка не роняют старт).
     */
    suspend fun resolveEncoderProfile(id: Long): EncoderProfile {
        encoderDao.getById(id)?.let { return it.toProfile() }
        encoderDao.firstOrNull()?.let { return it.toProfile() }
        val defaultId = ensureDefaultEncoderProfile()
        return encoderDao.getById(defaultId)!!.toProfile()
    }

    /**
     * Гарантировать наличие хотя бы одного профиля кодера (дефолтного). Вызывается при старте UI и при
     * резолве. Возвращает id первого/созданного дефолта.
     */
    suspend fun ensureDefaultEncoderProfile(): Long {
        encoderDao.firstOrNull()?.let { return it.id }
        return encoderDao.upsert(
            EncoderProfile(name = "1080p30 · H.264").toEntity()
        )
    }

    // ── Device profile (DataStore) ──────────────────────────────────────

    val deviceProfile: Flow<DeviceProfile?> = dataStore.deviceProfile

    suspend fun saveDeviceProfile(profile: DeviceProfile) =
        dataStore.saveDeviceProfile(profile)

    // ── Active profile selection ────────────────────────────────────────

    val activeProfileId: Flow<Long?> = dataStore.activeProfileId

    suspend fun setActiveProfile(id: Long) =
        dataStore.setActiveProfileId(id)
}
