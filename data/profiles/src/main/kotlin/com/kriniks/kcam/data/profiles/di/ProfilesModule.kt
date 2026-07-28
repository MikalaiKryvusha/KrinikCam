/**
 * ProfilesModule — Hilt module wiring Room database and DataStore for profile data.
 * Related: AppDatabase, ProfilesDataStore, ProfilesRepository
 */

package com.kriniks.kcam.data.profiles.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.kriniks.kcam.data.profiles.db.AppDatabase
import com.kriniks.kcam.data.profiles.db.EncoderProfileDao
import com.kriniks.kcam.data.profiles.db.SceneProfileDao
import com.kriniks.kcam.data.profiles.db.StreamProfileDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object ProfilesModule {

    // plans/12 S1 — правило: бампишь version в AppDatabase → пишешь Migration(N,N+1) здесь и
    // добавляешь в .addMigrations(...); JSON старых схем лежит в data/profiles/schemas/.
    // idea 37 — ПЕРВАЯ настоящая миграция: v2 добавляет тумблер адаптивного битрейта (дефолт ВКЛ).
    // Профили (stream-ключи Криника!) обязаны пережить апдейт без потерь.
    private val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE stream_profiles ADD COLUMN adaptiveBitrate INTEGER NOT NULL DEFAULT 1")
        }
    }

    // Профиль кодера — v3: видеокодек + полноценный аудио-блок. DEFAULT'ы каждой колонки повторяют
    // прежнее захардкоженное поведение (H.264, 128 кбит, 44100 Гц, стерео), поэтому существующие
    // профили Криника после апгрейда звучат/кодируются ровно как раньше — сюрпризов нет.
    private val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE stream_profiles ADD COLUMN videoCodec TEXT NOT NULL DEFAULT 'H264'")
            db.execSQL("ALTER TABLE stream_profiles ADD COLUMN audioBitrateBps INTEGER NOT NULL DEFAULT 128000")
            db.execSQL("ALTER TABLE stream_profiles ADD COLUMN audioSampleRate INTEGER NOT NULL DEFAULT 44100")
            db.execSQL("ALTER TABLE stream_profiles ADD COLUMN audioStereo INTEGER NOT NULL DEFAULT 1")
        }
    }

    // plans/14 (bug 41) — v4: профиль кодера ВЫНОСИТСЯ в отдельную таблицу encoder_profiles; платформа
    // теряет кодер-поля и получает encoderProfileId. Данные Криника обязаны пережить (правило bug 37):
    //  1. создаём encoder_profiles;
    //  2. для КАЖДОЙ платформы создаём профиль кодера с ТЕМ ЖЕ id и её текущими кодер-значениями
    //     (audioStereo 1/0 → 'STEREO'/'MONO'), так encoderProfileId = собственный id платформы;
    //  3. пересоздаём stream_profiles без кодер-полей, с encoderProfileId (SQLite на API 33 не умеет
    //     DROP COLUMN — идём каноническим путём recreate+copy+rename, чтобы схема совпала с entity).
    private val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            // 1. Таблица профилей кодера (форма = EncoderProfileEntity, exportSchema сверит хеш).
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS encoder_profiles (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    videoWidth INTEGER NOT NULL,
                    videoHeight INTEGER NOT NULL,
                    videoFps INTEGER NOT NULL,
                    videoBitrateBps INTEGER NOT NULL,
                    videoCodec TEXT NOT NULL,
                    adaptiveBitrate INTEGER NOT NULL,
                    audioBitrateBps INTEGER NOT NULL,
                    audioSampleRate INTEGER NOT NULL,
                    audioChannelMode TEXT NOT NULL
                )""".trimIndent()
            )
            // 2. Перенос кодер-значений каждой платформы в свой профиль кодера (id совпадает).
            db.execSQL(
                """INSERT INTO encoder_profiles
                    (id, name, videoWidth, videoHeight, videoFps, videoBitrateBps, videoCodec,
                     adaptiveBitrate, audioBitrateBps, audioSampleRate, audioChannelMode)
                   SELECT id, name || ' — кодер', videoWidth, videoHeight, videoFps, videoBitrateBps,
                          videoCodec, adaptiveBitrate, audioBitrateBps, audioSampleRate,
                          CASE WHEN audioStereo = 1 THEN 'STEREO' ELSE 'MONO' END
                   FROM stream_profiles""".trimIndent()
            )
            // 3. Пересоздаём stream_profiles без кодер-полей (recreate → copy → drop → rename).
            db.execSQL(
                """CREATE TABLE stream_profiles_new (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    rtmpUrl TEXT NOT NULL,
                    streamKey TEXT NOT NULL,
                    isEnabled INTEGER NOT NULL,
                    encoderProfileId INTEGER NOT NULL
                )""".trimIndent()
            )
            db.execSQL(
                """INSERT INTO stream_profiles_new
                    (id, name, platform, rtmpUrl, streamKey, isEnabled, encoderProfileId)
                   SELECT id, name, platform, rtmpUrl, streamKey, isEnabled, id FROM stream_profiles"""
                    .trimIndent()
            )
            db.execSQL("DROP TABLE stream_profiles")
            db.execSQL("ALTER TABLE stream_profiles_new RENAME TO stream_profiles")
        }
    }

    // idea 40 / plans/18 Фаза 1 — v5: добавляем таблицу набора именованных сцен. Чисто аддитивная
    // миграция (новая таблица, существующие данные не трогаются). Форма = SceneProfileEntity
    // (exportSchema сверит хеш schemas/5.json). Ф0-персист «одной текущей сцены» (DataStore
    // kcam_scene) остаётся — из него SceneProfileRepository ОДИН РАЗ засевает первую именованную сцену.
    private val MIGRATION_4_5 = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS scene_profiles (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    snapshotJson TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL
                )""".trimIndent()
            )
        }
    }

    // plans/18 Фаза 2 (Криник) — переходы между сценами: у каждой сцены свой тип эффекта и его
    // длительность. Аддитивная миграция с ДЕФОЛТАМИ = существующие сцены Криника переживают апгрейд
    // без потери и сразу получают мягкий фейд вместо чёрной склейки. [NOT-TESTED]
    private val MIGRATION_5_6 = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE scene_profiles ADD COLUMN transitionType TEXT NOT NULL DEFAULT 'FADE'")
            db.execSQL("ALTER TABLE scene_profiles ADD COLUMN transitionDurationMs INTEGER NOT NULL DEFAULT 400")
        }
    }

    // plans/21 работа A (Р7 интервью 011, В5 интервью 012) — v7: пол адаптивного битрейта переезжает
    // из хардкода `RtmpStreamer.ADAPTIVE_FLOOR_BPS = 1_000_000` в профиль кодера.
    //
    // ⚠️ Дефолт 250 000 СОЗНАТЕЛЬНО НЕ повторяет прежнее поведение (обычное правило миграций в этом
    // файле — «DEFAULT = как было»). Здесь прежнее поведение И ЕСТЬ починяемый дефект: пол 1 Мбит/с
    // выше полосы плохого 3G, поэтому адаптив упирался в него, канал не вытягивал и эфир глох.
    // Апгрейд обязан ЛЕЧИТЬ существующие профили Криника, а не консервировать их болезнь.
    // [TESTED: 2026-07-28 · апгрейд поверх ЖИВОЙ базы Криника: PRAGMA user_version 6→7, колонка с
    //  дефолтом 250000, три профиля кодера целы с прежними именами и битрейтами, 2 платформы и
    //  3 сцены не пострадали — журнал researches/network_resilience.md §14.2 A3]
    private val MIGRATION_6_7 = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE encoder_profiles ADD COLUMN minVideoBitrateBps INTEGER NOT NULL DEFAULT 250000")
        }
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "kcam_db")
            // bug 37 №1 — fallbackToDestructiveMigration УБРАН: он молча стирал бы все профили
            // (включая stream-ключи) при первом же бампе версии БД. Теперь при изменении схемы
            // ОБЯЗАТЕЛЬНА явная Migration(N,N+1) через .addMigrations(...) — забытая миграция
            // даст IllegalStateException на старте (заметно в первом же тесте), а не потерю данных.
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7)
            .build()

    @Provides
    fun provideStreamProfileDao(db: AppDatabase): StreamProfileDao = db.streamProfileDao()

    @Provides
    fun provideEncoderProfileDao(db: AppDatabase): EncoderProfileDao = db.encoderProfileDao()

    @Provides
    fun provideSceneProfileDao(db: AppDatabase): SceneProfileDao = db.sceneProfileDao()
}
