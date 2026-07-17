import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Properties

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

// bug 37 №2 / plans/12 S2 (interview_009 Q3=A) — настоящая подпись release. Пароли в
// keystore.properties (корень репо, GITIGNORED), сам ключ ~/keystores/krinikcam.keystore (вне репо;
// бэкап — homeworks/06). На машине БЕЗ этих файлов сборка НЕ падает: release честно откатывается
// на debug-подпись с WARNING в логе (такой APK — только для локальной отладки, не для релиза).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// storeFile в properties — АБСОЛЮТНЫЙ путь (gradle file() не разворачивает `~`).
val releaseStoreFile = keystoreProps.getProperty("storeFile")?.let { rootProject.file(it) }
val hasReleaseKeystore = releaseStoreFile?.exists() == true

android {
    namespace = "com.kriniks.kcam"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kriniks.kcam"
        minSdk = 33
        targetSdk = 35
        // versionCode must be >= 1; formula: major*1_000_000 + minor*10_000 + build + 1.
        // bug 37 №4: старая формула major*10000+minor*100+build давала переполнение разряда build
        // на сотом коммите (0.7 (100) == 0.8 (0) → «даунгрейд», обновление не встаёт). Новая даёт
        // 10 000 билдов на minor; скачок versionCode вверх (710 → 70010) безопасен для обновлений.
        versionCode = vMajor * 1_000_000 + vMinor * 10_000 + vBuild + 1
        versionName = "$vMajor.$vMinor ($vBuild)"

        // BUILD_TIME (see top-level `buildTime`) — shown in Settings → About so the user and bug
        // reports can see exactly which build is running.
        buildConfigField("String", "BUILD_TIME", "\"$buildTime\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // bug 37 №2 — release-подпись из keystore.properties (см. keystoreProps выше).
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // bug 37 №2 — настоящий ключ, если он есть на машине; иначе debug-фолбэк с WARNING.
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                logger.warn("WARNING: keystore.properties/keystore не найдены — release будет подписан DEBUG-ключом (только для локальной отладки, НЕ публиковать!)")
                signingConfigs.getByName("debug")
            }
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
