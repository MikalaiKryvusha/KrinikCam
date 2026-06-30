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
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.streaming.DeviceCameraEnumerator
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var deviceManager: DeviceManager
    @Inject lateinit var fileLogger: FileLogger
    @Inject lateinit var streamingRepository: com.kriniks.kcam.feature.streaming.domain.StreamingRepository

    // UsbViewModel is owned here so we can start monitoring after permissions are granted.
    // It is also passed into MainScreen via the Compose tree (hiltViewModel picks it up).
    private lateinit var usbViewModel: UsbViewModel

    // Receiver that lets the AI automation tool force the app's orientation over ADB. Registered
    // only while the "ADB rotation" dev toggle is ON (Idea 07) — available in ANY build, not just debug.
    private var adbOrientationReceiver: BroadcastReceiver? = null

    // Receiver that lets the AI harness simulate the virtual camera connecting/disconnecting over ADB
    // (Interview #004 testing): SET_VIRTUAL_CAM state=off → source drop → standby/freeze; state=on →
    // source back → exitStandby. Lets us test the dropout flow WITHOUT a physical USB camera.
    private var virtualCamReceiver: BroadcastReceiver? = null

    // Idea 22 — ЕДИНЫЙ debug-command-receiver автоматизатора (`com.kriniks.kcam.CMD`). Принимает
    // `--es action <name>` (+ доп. extras) и диспетчеризует напрямую в deviceManager/streamingRepository
    // (минуя UI) → надёжно/быстро/детерминированно для автономных тестов на харнесе. DEBUG-ONLY.
    private var cmdReceiver: BroadcastReceiver? = null

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
                    // Idea 10 — "stream to file" dev toggle → StreamingRepository.
                    onVirtualStreamChanged = { streamingRepository.setVirtualStreamToFile(it) },
                )
            }
        }

        requestRequiredPermissions()
        // Apply persisted dev preferences (Idea 07/09). Defaults OFF.
        setAdbRotationEnabled(DevSettings.isAdbRotation(this))
        deviceManager.setVirtualCamera(DevSettings.isVirtualCamera(this))
        streamingRepository.setVirtualStreamToFile(DevSettings.isVirtualStream(this))
        // Idea 24 — перечислить встроенные камеры устройства (Camera2) и зарегистрировать их как
        // источники. Приоритет в DeviceManager сам поднимет телефонную камеру, если нет UVC и виртуалки.
        deviceManager.registerPhoneCameras(DeviceCameraEnumerator.enumerate(this))
        registerVirtualCamControl()
        if (BuildConfig.DEBUG) registerCmdControl() // Idea 22 — broadcast-команды только в debug
    }

    /**
     * Idea 22 — единый debug-command-receiver автоматизатора. Одна команда уровня НАМЕРЕНИЯ меняет
     * состояние приложения детерминированно, без навигации по UI. Расширяется новыми `action`.
     *
     * ADB: `adb shell am broadcast -a com.kriniks.kcam.CMD --es action <name> [--es arg <v>] -p <pkg.debug>`
     * Команды:
     *   virtual-camera  arg=on|off     — вкл/выкл виртуальную дебаг-камеру
     *   stream-to-file  arg=on|off     — режим записи в файл вместо RTMP (harness)
     *   go-live         [arg=<height>] — старт (в harness — запись в MP4); arg = высота кадра (1080/2160)
     *   stop                           — остановить запись/стрим
     *   set-rotation    arg=0|90|180|270 — поворот видео (портрет/ландшафт)
     *   add-overlay                    — добавить тестовый PNG-оверлей
     *   rotation-mode   arg=on|off     — режим «вращение по ADB» (для SET_ORIENTATION)
     */
    private fun registerCmdControl() {
        if (cmdReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.getStringExtra("action") ?: return
                val arg = intent.getStringExtra("arg")
                KLog.i("MainActivity", "CMD: action=$action arg=$arg")
                when (action) {
                    "virtual-camera" -> deviceManager.setVirtualCamera(arg == "on")
                    "stream-to-file" -> streamingRepository.setVirtualStreamToFile(arg == "on")
                    "go-live" -> {
                        // arg = высота кадра (опц.); строим профиль с 16:9-шириной, иначе дефолт.
                        val h = arg?.toIntOrNull()
                        val profile = if (h != null) StreamProfile(videoWidth = h * 16 / 9, videoHeight = h)
                                      else StreamProfile()
                        val path = streamingRepository.goLiveHarness(profile)
                        KLog.i("MainActivity", "CMD go-live → ${path ?: "(rtmp)"}")
                    }
                    "stop" -> streamingRepository.stopAll()
                    // Idea 17 — снять фото (кадр композита) в галерею DCIM/KrinikCam.
                    "photo" -> streamingRepository.capturePhoto()
                    "set-rotation" -> arg?.toIntOrNull()?.let { streamingRepository.setVideoRotation(it) }
                    "add-overlay" -> streamingRepository.addTestOverlay(
                        id = "overlay_cmd_${System.currentTimeMillis()}", name = "Overlay",
                    )
                    "rotation-mode" -> setAdbRotationEnabled(arg == "on")
                    // Idea 25 — переключить базу энкодера на наш GL-композитор (мобильный OBS).
                    "compositor" -> streamingRepository.setUseCompositor(arg != "off")
                    // Тонкая команда: переключить видимость слоя по id (напр. camera) — для тестов OBS-поведения.
                    "toggle-layer" -> arg?.let { streamingRepository.toggleLayerVisible(it) }
                    "layer-up" -> arg?.let { streamingRepository.moveLayerUp(it) }
                    "layer-down" -> arg?.let { streamingRepository.moveLayerDown(it) }
                    // Idea 25 шаг 4 — PiP-трансформа слоя. arg = "<id> <scale> <cx> <cy> [alpha]"
                    // (id — напр. camera; scale доля кадра; cx,cy центр в [0,1] (0,0=верх-лево); alpha опц.).
                    "set-transform" -> arg?.split(Regex("[,\\s]+"))?.let { p ->
                        if (p.size >= 4) streamingRepository.setLayerTransform(
                            id = p[0],
                            scale = p[1].toFloatOrNull() ?: 1f,
                            cx = p[2].toFloatOrNull() ?: 0.5f,
                            cy = p[3].toFloatOrNull() ?: 0.5f,
                            alpha = p.getOrNull(4)?.toFloatOrNull() ?: 1f,
                        ) else KLog.w("MainActivity", "set-transform: need '<id> <scale> <cx> <cy> [alpha]'")
                    }
                    // Idea 24 — выбрать встроенную камеру устройства как источник (front|back|off).
                    "device-camera" -> when (arg) {
                        "front" -> deviceManager.selectPhoneCamera(isFront = true)
                        "off" -> deviceManager.selectVideoSource(com.kriniks.kcam.feature.capture.model.VideoSource.None)
                        else -> deviceManager.selectPhoneCamera(isFront = false) // back / default
                    }
                    else -> KLog.w("MainActivity", "CMD: unknown action '$action'")
                }
            }
        }
        ContextCompat.registerReceiver(
            this, receiver,
            IntentFilter("com.kriniks.kcam.CMD"),
            ContextCompat.RECEIVER_EXPORTED,
        )
        cmdReceiver = receiver
    }

    /**
     * Harness control (Interview #004): toggle the virtual camera over ADB to simulate a source
     * disconnect/reconnect without a physical USB camera.
     *   adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state off -p <pkg>   # drop
     *   adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state on  -p <pkg>   # restore
     * state=off → activeSource None → RtmpStreamer.enterStandby (freeze→timeout→standby);
     * state=on  → virtual source back → exitStandby (live).
     */
    private fun registerVirtualCamControl() {
        if (virtualCamReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val on = intent?.getStringExtra("state") == "on"
                KLog.i("MainActivity", "ADB virtual-cam: ${if (on) "ON (reconnect)" else "OFF (disconnect)"}")
                deviceManager.setVirtualCamera(on)
            }
        }
        ContextCompat.registerReceiver(
            this, receiver,
            IntentFilter("com.kriniks.kcam.SET_VIRTUAL_CAM"),
            ContextCompat.RECEIVER_EXPORTED,
        )
        virtualCamReceiver = receiver
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
        virtualCamReceiver?.let { runCatching { unregisterReceiver(it) } }
        cmdReceiver?.let { runCatching { unregisterReceiver(it) } }
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
