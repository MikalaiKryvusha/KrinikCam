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

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "kcam_db")
            // bug 37 №1 — fallbackToDestructiveMigration УБРАН: он молча стирал бы все профили
            // (включая stream-ключи) при первом же бампе версии БД. Теперь при изменении схемы
            // ОБЯЗАТЕЛЬНА явная Migration(N,N+1) через .addMigrations(...) — забытая миграция
            // даст IllegalStateException на старте (заметно в первом же тесте), а не потерю данных.
            .addMigrations(MIGRATION_1_2)
            .build()

    @Provides
    fun provideStreamProfileDao(db: AppDatabase): StreamProfileDao = db.streamProfileDao()
}
