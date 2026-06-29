package com.kriniks.kcam

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.kriniks.kcam.core.logging.FileLogger
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.core.ui.theme.KrinikCamTheme
import com.kriniks.kcam.dev.DevSettings
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var deviceManager: DeviceManager
    @Inject lateinit var fileLogger: FileLogger

    // UsbViewModel is owned here so we can start monitoring after permissions are granted.
    // It is also passed into MainScreen via the Compose tree (hiltViewModel picks it up).
    private lateinit var usbViewModel: UsbViewModel

    // Receiver that lets the AI automation tool force the app's orientation over ADB. Registered
    // only while the "ADB rotation" dev toggle is ON (Idea 07) — available in ANY build, not just debug.
    private var adbOrientationReceiver: BroadcastReceiver? = null

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        // Start/restart USB monitoring regardless — user may have granted CAMERA but not AUDIO,
        // or vice versa. USB monitoring will work as long as CAMERA is granted.
        usbViewModel.restartMonitoring()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        usbViewModel = androidx.lifecycle.ViewModelProvider(this)[UsbViewModel::class.java]

        setContent {
            KrinikCamTheme {
                KrinikCamNavGraph(
                    deviceManager = deviceManager,
                    fileLogger = fileLogger,
                    // Dev menu toggle (Idea 07) applies the ADB-rotation mode live.
                    onAdbRotationChanged = ::setAdbRotationEnabled,
                )
            }
        }

        requestRequiredPermissions()
        // Apply persisted dev preferences (Idea 07/09). Defaults OFF.
        setAdbRotationEnabled(DevSettings.isAdbRotation(this))
        deviceManager.setVirtualCamera(DevSettings.isVirtualCamera(this))
    }

    /**
     * Enable/disable "ADB rotation" mode (Idea 07 Developer menu). Works in ANY build (no debug gate).
     *
     * ON  → register a broadcast receiver that obeys `ui.mjs orient` ADB commands and LOCK the app
     *       orientation (requestedOrientation=LOCKED) so it stops following the physical sensor.
     * OFF → unregister the receiver and restore FULL_SENSOR (follow the physical sensor as usual).
     *
     * The app is screenOrientation="fullSensor" in the manifest, so OFF is the natural default.
     *
     * ADB usage when ON: adb shell am broadcast -a com.kriniks.kcam.SET_ORIENTATION --es mode landscape -p <pkg>
     *   mode = portrait | landscape | reversePortrait | reverseLandscape | auto (back to fullSensor)
     */
    fun setAdbRotationEnabled(enabled: Boolean) {
        if (enabled) {
            if (adbOrientationReceiver == null) {
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(context: Context?, intent: Intent?) {
                        val mode = intent?.getStringExtra("mode") ?: return
                        requestedOrientation = when (mode) {
                            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                            "reverseLandscape" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                            "reversePortrait" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
                            else -> ActivityInfo.SCREEN_ORIENTATION_LOCKED // "auto" within ADB-mode = lock current
                        }
                        KLog.i("MainActivity", "ADB orientation: $mode")
                    }
                }
                // RECEIVER_EXPORTED so `adb shell am broadcast` can reach it (Android 13+ requires a flag).
                ContextCompat.registerReceiver(
                    this, receiver,
                    IntentFilter("com.kriniks.kcam.SET_ORIENTATION"),
                    ContextCompat.RECEIVER_EXPORTED,
                )
                adbOrientationReceiver = receiver
            }
            // Stop following the sensor — lock to current until an ADB command sets a specific angle.
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LOCKED
            KLog.i("MainActivity", "ADB rotation mode ENABLED (sensor off, listening to ADB)")
        } else {
            adbOrientationReceiver?.let { runCatching { unregisterReceiver(it) } }
            adbOrientationReceiver = null
            // Resume following the physical sensor (manifest default).
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            KLog.i("MainActivity", "ADB rotation mode DISABLED (following physical sensor)")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        adbOrientationReceiver?.let { runCatching { unregisterReceiver(it) } }
    }

    private fun requestRequiredPermissions() {
        val required = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        val missing = required.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            usbViewModel.startMonitoring()
        } else {
            permissionsLauncher.launch(missing.toTypedArray())
        }
    }
}
