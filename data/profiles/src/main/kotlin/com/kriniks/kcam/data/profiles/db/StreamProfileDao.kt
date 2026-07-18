/**
 * StreamProfileDao — Room DAO for streaming platform profiles.
 * Exposes reactive Flow<List> so UI re-renders on any change.
 * Related: StreamProfileEntity, AppDatabase, ProfilesRepository
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface StreamProfileDao {

    @Query("SELECT * FROM stream_profiles ORDER BY id ASC")
    fun observeAll(): Flow<List<StreamProfileEntity>>

    @Query("SELECT * FROM stream_profiles WHERE isEnabled = 1 ORDER BY id ASC")
    fun observeEnabled(): Flow<List<StreamProfileEntity>>

    @Query("SELECT * FROM stream_profiles WHERE id = :id")
    suspend fun getById(id: Long): StreamProfileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: StreamProfileEntity): Long

    @Delete
    suspend fun delete(entity: StreamProfileEntity)

    @Query("DELETE FROM stream_profiles WHERE id = :id")
    suspend fun deleteById(id: Long)

    // plans/14 — при удалении профиля кодера переназначаем ссылавшиеся платформы на запасной (fallback).
    @Query("UPDATE stream_profiles SET encoderProfileId = :newId WHERE encoderProfileId = :oldId")
    suspend fun repointEncoder(oldId: Long, newId: Long): Int
}
