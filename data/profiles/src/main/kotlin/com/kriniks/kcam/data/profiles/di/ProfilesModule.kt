/**
 * ProfilesModule — Hilt module wiring Room database and DataStore for profile data.
 * Related: AppDatabase, ProfilesDataStore, ProfilesRepository
 */

package com.kriniks.kcam.data.profiles.di

import android.content.Context
import androidx.room.Room
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

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "kcam_db")
            // bug 37 №1 — fallbackToDestructiveMigration УБРАН: он молча стирал бы все профили
            // (включая stream-ключи) при первом же бампе версии БД. Теперь при изменении схемы
            // ОБЯЗАТЕЛЬНА явная Migration(N,N+1) через .addMigrations(...) — забытая миграция
            // даст IllegalStateException на старте (заметно в первом же тесте), а не потерю данных.
            .build()

    @Provides
    fun provideStreamProfileDao(db: AppDatabase): StreamProfileDao = db.streamProfileDao()
}
