/**
 * DevSettings — lightweight persistence for the "Developer" menu toggles (Idea 07).
 *
 * Uses plain SharedPreferences (synchronous, zero extra deps) because these are simple app-level
 * dev flags that MainActivity must read at onCreate (before any Compose/Flow is up). Available in
 * BOTH debug and release builds — the Developer menu is just hidden behind a long-press, so there
 * is no "magic" debug-only behaviour (Idea 07 principle: release == debug feature-wise).
 *
 * Add new dev toggles here as simple keys; surface them in DevMenuScreen with an [i] description.
 *
 * Related: DevMenuScreen, MainActivity (applies adbRotation), SettingsScreen (long-press entry).
 */

package com.kriniks.kcam.dev

import android.content.Context

object DevSettings {
    private const val PREFS = "kcam_dev"
    private const val KEY_ADB_ROTATION = "adb_rotation"
    private const val KEY_VIRTUAL_CAMERA = "virtual_camera"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** When ON: app stops following the physical sensor and obeys ADB rotation commands. */
    fun isAdbRotation(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ADB_ROTATION, false)

    fun setAdbRotation(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ADB_ROTATION, enabled).apply()
    }

    /** When ON: feed a synthetic test pattern as the camera (Idea 09) — debug without USB cam. */
    fun isVirtualCamera(context: Context): Boolean =
        prefs(context).getBoolean(KEY_VIRTUAL_CAMERA, false)

    fun setVirtualCamera(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_VIRTUAL_CAMERA, enabled).apply()
    }
}
