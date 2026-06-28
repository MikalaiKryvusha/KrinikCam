import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

fun readVersion(): Triple<Int, Int, Int> {
    val versionFile = rootProject.file("version.json")
    if (!versionFile.exists()) return Triple(0, 1, 0)
    val text = versionFile.readText()
    val major = Regex(""""major"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toInt() ?: 0
    val minor = Regex(""""minor"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toInt() ?: 1
    val build = Regex(""""build"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toInt() ?: 0
    return Triple(major, minor, build)
}

val (vMajor, vMinor, vBuild) = readVersion()

// Build timestamp (computed at configuration time) — baked into BuildConfig.BUILD_TIME and shown
// in Settings → About. Refreshes whenever version.json changes (every commit/release bumps it).
val buildTime: String = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())

android {
    namespace = "com.kriniks.kcam"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kriniks.kcam"
        minSdk = 33
        targetSdk = 35
        // versionCode must be >= 1; formula: major*10000 + minor*100 + build + 1
        // ensures monotonic increase across all version bumps
        versionCode = vMajor * 10000 + vMinor * 100 + vBuild + 1
        versionName = "$vMajor.$vMinor ($vBuild)"

        // BUILD_TIME (see top-level `buildTime`) — shown in Settings → About so the user and bug
        // reports can see exactly which build is running.
        buildConfigField("String", "BUILD_TIME", "\"$buildTime\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

// Use Kotlin toolchain instead of deprecated kotlinOptions { jvmTarget }
kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:ui"))
    implementation(project(":core:logging"))
    implementation(project(":feature:usb"))
    implementation(project(":feature:capture"))
    implementation(project(":feature:codec"))
    implementation(project(":feature:streaming"))
    implementation(project(":data:profiles"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.timber)
    implementation(libs.coroutines.android)

    debugImplementation(libs.androidx.ui.tooling)
}
