/**
 * SceneProfileDao — Room DAO для набора именованных сцен (idea 40, plans/18 Фаза 1).
 * Реактивный Flow<List> → панель-менеджер сцен перерисовывается на любое изменение.
 * Related: SceneProfileEntity, AppDatabase, SceneProfileRepository.
 *
 * [NOT-TESTED] — проверяется CRUD-циклом на устройстве (создать/переключить/дублировать/удалить).
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface SceneProfileDao {

    @Query("SELECT * FROM scene_profiles ORDER BY id ASC")
    fun observeAll(): Flow<List<SceneProfileEntity>>

    @Query("SELECT * FROM scene_profiles ORDER BY id ASC")
    suspend fun getAll(): List<SceneProfileEntity>

    @Query("SELECT * FROM scene_profiles WHERE id = :id")
    suspend fun getById(id: Long): SceneProfileEntity?

    // Первая (наименьший id) — fallback для активной сцены при удалении текущей.
    @Query("SELECT * FROM scene_profiles ORDER BY id ASC LIMIT 1")
    suspend fun firstOrNull(): SceneProfileEntity?

    @Query("SELECT COUNT(*) FROM scene_profiles")
    suspend fun count(): Int

    // upsert: insert новой (id=0 → autogen, вернёт новый id) или замена существующей по id.
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SceneProfileEntity): Long

    // Точечное переименование (не трогает snapshotJson) — из диалога переименования.
    @Query("UPDATE scene_profiles SET name = :name, updatedAt = :updatedAt WHERE id = :id")
    suspend fun rename(id: Long, name: String, updatedAt: Long)

    // Точечный автосейв снапшота активной сцены (частый вызов, debounce в стримере).
    @Query("UPDATE scene_profiles SET snapshotJson = :json, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateSnapshot(id: Long, json: String, updatedAt: Long)

    @Query("DELETE FROM scene_profiles WHERE id = :id")
    suspend fun deleteById(id: Long)
}
