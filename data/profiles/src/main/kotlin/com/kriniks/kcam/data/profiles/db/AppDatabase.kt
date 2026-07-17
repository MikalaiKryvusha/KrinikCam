/**
 * AppDatabase — Room database for KrinikCam.
 *
 * Currently holds: stream_profiles table.
 * Future tables: device_profiles (Phase 3), overlay_presets (Phase 6).
 *
 * Version history:
 *   1 — initial schema (stream_profiles)
 *
 * Related: StreamProfileDao, ProfilesModule (Hilt), DeviceProfile (DataStore, not Room)
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [StreamProfileEntity::class],
    // v2 (idea 37): +adaptiveBitrate INTEGER NOT NULL DEFAULT 1 — см. MIGRATION_1_2 в ProfilesModule.
    version = 2,
    // bug 37 №1 — схема экспортируется (schemas/ в git): фундамент для честных миграций.
    // Меняешь entity → бампни version И напиши Migration(N,N+1) в ProfilesModule; destructive-
    // фолбэка больше НЕТ, забытая миграция уронит сборку/старт, а не данные Криника.
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun streamProfileDao(): StreamProfileDao
}
