/**
 * DevSettings — lightweight persistence for the "Developer" menu toggles (Idea 07).
 *
 * Uses plain SharedPreferences (synchronous, zero extra deps) because these are simple app-level
 * dev flags that MainActivity must read at onCreate (before any Compose/Flow is up).
 *
 * ТОЛЬКО DEBUG (слово Криника 2026-10-17: «KCAM — это будет релизная сборка без дебаг меню и
 * отладочных инструментов и в R8»; прежний принцип Idea 07 «release == debug» для релиза ОТМЕНЁН).
 * В release каждый геттер отдаёт дефолт `false` — все отладочные режимы выключены, даже если в
 * SharedPreferences лежит `true` от старой сборки. [TESTED: 2026-10-17 · release-mapping: DevSettings вырезан R8
 * целиком (геттеры свернулись в константу false); release на Titan — виртуалки нет, харнес-ресиверов нет;
 * debug с данными Криника читает его `true`-тумблеры (экран «Для разработчиков»). Ветку «в release лежит true»
 * на устройстве НЕ наблюдал: release ставился начисто. testcases/reports/2026-10-17_kcam_release_r8_signing.md]
 *
 * Add new dev toggles here as simple keys; surface them in DevMenuScreen with an [i] description.
 *
 * Related: DevMenuScreen, MainActivity (applies adbRotation), SettingsScreen (long-press entry).
 */

package com.kriniks.kcam.dev

import android.content.Context
import com.kriniks.kcam.BuildConfig

object DevSettings {
    private const val PREFS = "kcam_dev"
    private const val KEY_ADB_ROTATION = "adb_rotation"
    private const val KEY_VIRTUAL_CAMERA = "virtual_camera"
    private const val KEY_VIRTUAL_STREAM = "virtual_stream"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Release (KCAM) — всегда `false`: отладочных инструментов в релизе нет. */
    private fun flag(context: Context, key: String): Boolean =
        BuildConfig.DEBUG && prefs(context).getBoolean(key, false)

    /** When ON: app stops following the physical sensor and obeys ADB rotation commands. */
    fun isAdbRotation(context: Context): Boolean =
        flag(context, KEY_ADB_ROTATION)

    fun setAdbRotation(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ADB_ROTATION, enabled).apply()
    }

    /** When ON: feed a synthetic test pattern as the camera (Idea 09) — debug without USB cam. */
    fun isVirtualCamera(context: Context): Boolean =
        flag(context, KEY_VIRTUAL_CAMERA)

    fun setVirtualCamera(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_VIRTUAL_CAMERA, enabled).apply()
    }

    /** When ON: "Go Live" records the encoder output to a file instead of RTMP (Idea 10). */
    fun isVirtualStream(context: Context): Boolean =
        flag(context, KEY_VIRTUAL_STREAM)

    fun setVirtualStream(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_VIRTUAL_STREAM, enabled).apply()
    }
}
