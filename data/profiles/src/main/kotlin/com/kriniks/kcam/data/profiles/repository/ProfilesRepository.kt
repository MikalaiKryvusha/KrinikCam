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
import com.kriniks.kcam.data.profiles.db.StreamProfileDao
import com.kriniks.kcam.data.profiles.db.toEntity
import com.kriniks.kcam.data.profiles.model.DeviceProfile
import com.kriniks.kcam.data.profiles.model.StreamProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProfilesRepository @Inject constructor(
    private val dao: StreamProfileDao,
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

    // ── Device profile (DataStore) ──────────────────────────────────────

    val deviceProfile: Flow<DeviceProfile?> = dataStore.deviceProfile

    suspend fun saveDeviceProfile(profile: DeviceProfile) =
        dataStore.saveDeviceProfile(profile)

    // ── Active profile selection ────────────────────────────────────────

    val activeProfileId: Flow<Long?> = dataStore.activeProfileId

    suspend fun setActiveProfile(id: Long) =
        dataStore.setActiveProfileId(id)
}
