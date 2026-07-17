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
    version = 1,
    // bug 37 №1 — схема экспортируется (schemas/ в git): фундамент для честных миграций.
    // Меняешь entity → бампни version И напиши Migration(N,N+1) в ProfilesModule; destructive-
    // фолбэка больше НЕТ, забытая миграция уронит сборку/старт, а не данные Криника.
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun streamProfileDao(): StreamProfileDao
}
