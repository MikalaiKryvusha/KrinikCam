/**
 * ProfilesDataStore — DataStore wrapper for lightweight key-value preferences.
 *
 * Stores:
 *   - DeviceProfile (JSON, auto-detected on first launch)
 *   - Active stream profile ID
 *
 * Using DataStore instead of Room for these because they're single-object configs
 * that don't need relational queries.
 *
 * Related: DeviceProfile, ProfilesRepository, ProfilesModule
 */

package com.kriniks.kcam.data.profiles.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.kriniks.kcam.data.profiles.model.DeviceProfile
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "kcam_profiles")

@Singleton
class ProfilesDataStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val KEY_DEVICE_PROFILE = stringPreferencesKey("device_profile")
    private val KEY_ACTIVE_PROFILE_ID = longPreferencesKey("active_profile_id")

    val deviceProfile: Flow<DeviceProfile?> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { prefs ->
            prefs[KEY_DEVICE_PROFILE]?.let { json ->
                runCatching { Json.decodeFromString<DeviceProfile>(json) }.getOrNull()
            }
        }

    val activeProfileId: Flow<Long?> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { it[KEY_ACTIVE_PROFILE_ID] }

    suspend fun saveDeviceProfile(profile: DeviceProfile) {
        context.dataStore.edit { it[KEY_DEVICE_PROFILE] = Json.encodeToString(profile) }
    }

    suspend fun setActiveProfileId(id: Long) {
        context.dataStore.edit { it[KEY_ACTIVE_PROFILE_ID] = id }
    }

    // plans/12 S5 — снять выбор активного профиля (например, он удалён): ключ удаляется целиком,
    // подписчики activeProfileId получают null. Без этого удалённый профиль оставался «активным»
    // висячим id в DataStore.
    suspend fun clearActiveProfileId() {
        context.dataStore.edit { it.remove(KEY_ACTIVE_PROFILE_ID) }
    }
}
