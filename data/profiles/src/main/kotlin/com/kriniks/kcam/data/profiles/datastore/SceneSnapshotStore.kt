/**
 * SceneSnapshotStore — DataStore-хранилище снапшота ТЕКУЩЕЙ сцены (idea 40 / plans/18 Фаза 0).
 *
 * Хранит ОПАКОВУЮ JSON-строку сцены (сериализация/десериализация — в :feature:streaming, который знает
 * доменные типы сцены; этот модуль их не знает). По образцу DeviceProfile-as-JSON в ProfilesDataStore:
 * одиночный конфиг → DataStore, без Room и миграций. Отдельный файл `kcam_scene` (изолирован от
 * `kcam_profiles`); Фаза 1 добавит рядом Room-таблицу набора именованных сцен.
 *
 * Related: ProfilesDataStore (тот же приём), SceneSnapshotRepository (:feature:streaming, оркестратор).
 */

package com.kriniks.kcam.data.profiles.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.sceneDataStore: DataStore<Preferences> by preferencesDataStore(name = "kcam_scene")

@Singleton
class SceneSnapshotStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val KEY_CURRENT_SCENE = stringPreferencesKey("current_scene_json")

    /** JSON снапшота текущей сцены (null — ещё ничего не сохраняли). */
    val currentSceneJson: Flow<String?> = context.sceneDataStore.data
        .catch { emit(emptyPreferences()) }
        .map { it[KEY_CURRENT_SCENE] }

    suspend fun saveCurrentSceneJson(json: String) {
        context.sceneDataStore.edit { it[KEY_CURRENT_SCENE] = json }
    }

    suspend fun clear() {
        context.sceneDataStore.edit { it.remove(KEY_CURRENT_SCENE) }
    }
}
