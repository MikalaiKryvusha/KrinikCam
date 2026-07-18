/**
 * EncoderProfileDao — Room DAO for codec (encoder) profiles.
 * Reactive Flow<List> so UI re-renders on any change.
 * Related: EncoderProfileEntity, AppDatabase, ProfilesRepository
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface EncoderProfileDao {

    @Query("SELECT * FROM encoder_profiles ORDER BY id ASC")
    fun observeAll(): Flow<List<EncoderProfileEntity>>

    @Query("SELECT * FROM encoder_profiles WHERE id = :id")
    suspend fun getById(id: Long): EncoderProfileEntity?

    @Query("SELECT * FROM encoder_profiles ORDER BY id ASC LIMIT 1")
    suspend fun firstOrNull(): EncoderProfileEntity?

    @Query("SELECT COUNT(*) FROM encoder_profiles")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: EncoderProfileEntity): Long

    @Delete
    suspend fun delete(entity: EncoderProfileEntity)

    // Сколько платформ ссылается на этот профиль кодера (для запрета удаления «занятого», bug 41 S5).
    @Query("SELECT COUNT(*) FROM stream_profiles WHERE encoderProfileId = :encoderId")
    suspend fun referencingPlatforms(encoderId: Long): Int
}
