package com.kriniks.kcam

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.kriniks.kcam.core.logging.FileLogger
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
