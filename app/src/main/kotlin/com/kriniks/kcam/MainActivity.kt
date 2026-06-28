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

    // Debug-only receiver that lets the AI automation tool force the app's orientation over ADB.
    private var debugOrientationReceiver: BroadcastReceiver? = null

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
                )
            }
        }

        requestRequiredPermissions()
        registerDebugOrientationReceiver()
    }

    /**
     * Debug-only: register a broadcast receiver so the AI automation tool (`ui.mjs orient`) can
     * force the app's orientation over ADB. Our MainActivity is screenOrientation="fullSensor",
     * which follows the PHYSICAL sensor and ignores the system rotation lock — so a stationary
     * tablet can't be flipped via `settings put system user_rotation`. Setting requestedOrientation
     * at runtime overrides fullSensor and rotates the app regardless of the physical sensor.
     * Never registered in release builds (BuildConfig.DEBUG gate).
     *
     * Usage: adb shell am broadcast -a com.kriniks.kcam.SET_ORIENTATION --es mode landscape -p <pkg>
     *   mode = portrait | landscape | reversePortrait | reverseLandscape | auto (restores fullSensor)
     */
    private fun registerDebugOrientationReceiver() {
        if (!BuildConfig.DEBUG) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val mode = intent?.getStringExtra("mode") ?: return
                requestedOrientation = when (mode) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    "reverseLandscape" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                    "reversePortrait" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
                    else -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR // "auto" — restore default
                }
                KLog.i("MainActivity", "Debug orientation forced: $mode")
            }
        }
        // RECEIVER_EXPORTED so `adb shell am broadcast` can reach it (Android 13+ requires a flag).
        ContextCompat.registerReceiver(
            this, receiver,
            IntentFilter("com.kriniks.kcam.SET_ORIENTATION"),
            ContextCompat.RECEIVER_EXPORTED,
        )
        debugOrientationReceiver = receiver
    }

    override fun onDestroy() {
        super.onDestroy()
        debugOrientationReceiver?.let { runCatching { unregisterReceiver(it) } }
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
