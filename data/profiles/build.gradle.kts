// :data:profiles — Room database + DataStore for stream profiles and device config.
// Single source of truth for all user settings that persist across sessions.
// Related: AppDatabase, StreamProfileDao, StreamProfileEntity, ProfilesDataStore

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.kriniks.kcam.data.profiles"
    compileSdk = 35

    defaultConfig {
        minSdk = 33
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

// bug 37 №1 — Room экспортирует JSON-схемы БД в schemas/ (коммитятся в git): это база для настоящих
// Migration(N,N+1) вместо fallbackToDestructiveMigration, который молча стирал бы профили Криника
// (stream-ключи!) при первом же бампе версии БД.
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:logging"))

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    // Room — stream profiles persistent storage
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    // DataStore — lightweight key-value store for active config
    implementation(libs.datastore.preferences)

    implementation(libs.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // plans/12 S6 — JVM-юниты на чистую логику модуля (valueOf-фолбэк, дедуп импорта)
    testImplementation(libs.junit)
}
