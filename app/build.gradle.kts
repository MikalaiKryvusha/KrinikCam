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

// Подписи двух сборок — из `.env` в корне (GITIGNORED; слово Криника 2026-10-17: «в .env заведите
// ключи для двух сборок: Debug KCAM, KCAM — это будет релизная сборка без дебаг меню и отладочных
// инструментов и в R8», «.env ВНЕ ГИТА!!!»). Прежние ключи (keystore.properties + ~/keystores, bug 37
// №2) остались на старой машине — «настрать на сигнатуры», заведены новые.
//   KCAM_DEBUG_*   → подпись debug («Debug KCAM»): одна на все машины, чтобы `adb install -r` вставал
//                    поверх сборки с другого компьютера (машинный debug.keystore у каждой свой).
//   KCAM_RELEASE_* → подпись release («KCAM»).
// Ключи: *_STORE_FILE (путь от корня репо или абсолютный, прямые слэши), *_STORE_PASSWORD,
// *_KEY_ALIAS, *_KEY_PASSWORD. Переменная окружения с тем же именем ПЕРЕБИВАЕТ .env (CI).
// Без .env сборка НЕ падает: debug — машинным ключом, release — debug-ключом с WARNING (только для
// локальной отладки, не публиковать). [TESTED: 2026-10-17 · Windows: обе сборки собраны, apksigner — debug CN=Debug KCAM,
// release CN=KCAM; testcases/reports/2026-10-17_kcam_release_r8_signing.md]
val dotEnv: Map<String, String> = rootProject.file(".env").let { f ->
    if (!f.exists()) emptyMap() else f.readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim() }
}
fun envKey(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() } ?: dotEnv[name]
fun signingFrom(prefix: String): Map<String, String>? {
    val keys = listOf("STORE_FILE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD")
    val values = keys.associateWith { envKey("KCAM_${prefix}_$it") }
    if (values.values.any { it == null }) return null
    return if (rootProject.file(values["STORE_FILE"]!!).exists()) values.mapValues { it.value!! } else null
}
val debugSigning = signingFrom("DEBUG")
val releaseSigning = signingFrom("RELEASE")

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
        // Подписи из .env (см. dotEnv/signingFrom выше).
        debugSigning?.let { s ->
            create("kcamDebug") {
                storeFile = rootProject.file(s.getValue("STORE_FILE"))
                storePassword = s.getValue("STORE_PASSWORD")
                keyAlias = s.getValue("KEY_ALIAS")
                keyPassword = s.getValue("KEY_PASSWORD")
            }
        }
        releaseSigning?.let { s ->
            create("release") {
                storeFile = rootProject.file(s.getValue("STORE_FILE"))
                storePassword = s.getValue("STORE_PASSWORD")
                keyAlias = s.getValue("KEY_ALIAS")
                keyPassword = s.getValue("KEY_PASSWORD")
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
            // Ключ «KCAM» из .env, если он есть; иначе debug-фолбэк с WARNING.
            signingConfig = if (releaseSigning != null) {
                signingConfigs.getByName("release")
            } else {
                logger.warn("WARNING: KCAM_RELEASE_* в .env не найдены — release будет подписан DEBUG-ключом (только для локальной отладки, НЕ публиковать!)")
                signingConfigs.getByName("debug")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // «Debug KCAM» — общий ключ из .env; без него — машинный ~/.android/debug.keystore.
            if (debugSigning != null) signingConfig = signingConfigs.getByName("kcamDebug")
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
