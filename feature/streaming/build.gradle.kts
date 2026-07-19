// :feature:streaming — RTMP client (RootEncoder), StreamPlatformsManager.
// Phase 1: single YouTube RTMP stream. Designed for multi-platform in Phase 2.
// Related: RtmpStreamer, StreamPlatformsManager, StreamViewModel, StreamPlatformsOverlay

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.kriniks.kcam.feature.streaming"
    compileSdk = 35

    defaultConfig {
        minSdk = 33
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:ui"))
    implementation(project(":core:logging"))
    implementation(project(":feature:codec"))
    implementation(project(":data:profiles"))

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // RTMP / streaming engine — api so :app can use VideoSource for UvcVideoSource
    api(libs.root.encoder)

    // JVM-юниты (idea 40 / plans/18 Ф0 — round-trip персиста сцены). Pure-JVM, без Robolectric.
    testImplementation(libs.junit)
}
