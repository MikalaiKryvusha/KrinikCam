/**
 * AppDatabase — Room database for KrinikCam.
 *
 * Currently holds: stream_profiles table.
 * Future tables: device_profiles (Phase 3), overlay_presets (Phase 6).
 *
 * Version history:
 *   1 — initial schema (stream_profiles)
 *   2 — +adaptiveBitrate (idea 37)
 *   3 — +videoCodec, +audioBitrateBps, +audioSampleRate, +audioStereo (профиль кодера, на stream_profiles)
 *   4 — профиль кодера ВЫНЕСЕН в отдельную таблицу encoder_profiles; stream_profiles теряет кодер-поля
 *       и получает encoderProfileId (bug 41 / plans/14) — MIGRATION_3_4
 *
 * Related: StreamProfileDao, EncoderProfileDao, ProfilesModule (Hilt), DeviceProfile (DataStore)
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [StreamProfileEntity::class, EncoderProfileEntity::class],
    // v2 (idea 37): +adaptiveBitrate — MIGRATION_1_2. v3 (профиль кодера на платформе) — MIGRATION_2_3.
    // v4 (plans/14): профиль кодера = отдельная таблица encoder_profiles, платформа ссылается по id.
    version = 4,
    // bug 37 №1 — схема экспортируется (schemas/ в git): фундамент для честных миграций.
    // Меняешь entity → бампни version И напиши Migration(N,N+1) в ProfilesModule; destructive-
    // фолбэка больше НЕТ, забытая миграция уронит сборку/старт, а не данные Криника.
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun streamProfileDao(): StreamProfileDao
    abstract fun encoderProfileDao(): EncoderProfileDao
}
