package com.kriniks.kcam

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.WindowManager
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
import com.kriniks.kcam.streaming.StreamForegroundService
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import androidx.lifecycle.lifecycleScope
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
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

    // Receiver that lets the AI harness simulate the virtual camera connecting/disconnecting over ADB:
    // SET_VIRTUAL_CAM state=off → camera layer's producer drops (composited scene keeps rendering);
    // state=on → producer back. Lets us test the dropout flow WITHOUT a physical USB camera (Phase 3:
    // no source swap happens — the compositor survives the dropout by design).
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
        keepScreenOnWhileStreaming()
    }

    /**
     * Bug 36 / plans/10 S1+S2 — эфир переживает экран и фон. Один дирижёр на streamState:
     *  • S1: FLAG_KEEP_SCREEN_ON пока стрим активен (экран не гаснет; флаг на ОКНЕ Activity —
     *    переживает уход на экран Settings), снимаем на Idle/Error/Stopping.
     *  • S2: StreamForegroundService — процесс в foreground-классе (Android 12+ не заморозит при
     *    выключении экрана/сворачивании: RTMP-сокет и энкодер живут), нотификация «LIVE» + wake lock.
     * Реагируем только на ФРОНТ перехода active↔inactive: Live(durationMs/bitrateKbps) тикает каждую
     * секунду, и без фронт-фильтра startForegroundService спамился бы на каждый тик.
     * [TESTED: 2026-07-18 · приёмка S4 на полигоне — эфир пережил экран-выкл 5 мин и HOME-фон;
     * сервис поднялся один раз на go-live и корректно погас на stop (0 живых нотификаций)]
     */
    private fun keepScreenOnWhileStreaming() {
        lifecycleScope.launch {
            var wasActive = false
            streamingRepository.streamState.collect { state ->
                val active = state.isActive
                if (active == wasActive) return@collect // тик внутри той же фазы — не дёргаемся
                wasActive = active
                if (active) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    StreamForegroundService.start(this@MainActivity)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    StreamForegroundService.stop(this@MainActivity)
                }
            }
        }
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
     *   set-rotation    arg=0|90|180|270 — глобальный поворот ХОЛСТА над сценой (interview_006):
     *                    90/270 → выход 9:16 портрет; вся композиция ворочается целиком
     *   add-overlay                    — добавить тестовый PNG-оверлей
     *   set-transform   arg="<id> <scale> <cx> <cy> [alpha] [rotation]" — трансформа слоя
     *   rotation-mode   arg=on|off     — режим «вращение по ADB» (для SET_ORIENTATION)
     * (Phase 3: команда `compositor` УДАЛЕНА — композитор всегда включён, второго пайплайна нет.)
     */
    private fun registerCmdControl() {
        if (cmdReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.getStringExtra("action") ?: return
                val arg = intent.getStringExtra("arg")
                KLog.i("MainActivity", "CMD: action=$action arg=$arg")
                when (action) {
                    "virtual-camera" -> {
                        // ПЕРСИСТ (гипотеза Криника): CMD-переключение виртуалки должно ПЕРЕЖИВАТЬ
                        // рестарт, иначе на следующем старте DevSettings снова поднимет её и она
                        // вмешается в кейс с реальной камерой (лишний virtual→UVC close-churn →
                        // провоцирует нативный краш AUSBC на закрытии 2K-камеры, bug 28).
                        val on = arg == "on"
                        deviceManager.setVirtualCamera(on)
                        DevSettings.setVirtualCamera(this@MainActivity, on)
                    }
                    "stream-to-file" -> {
                        val on = arg == "on"
                        streamingRepository.setVirtualStreamToFile(on)
                        DevSettings.setVirtualStream(this@MainActivity, on)
                    }
                    "go-live" -> {
                        // arg = высота кадра (опц.); строим профиль с 16:9-шириной, иначе дефолт.
                        val h = arg?.toIntOrNull()
                        val profile = if (h != null) StreamProfile(videoWidth = h * 16 / 9, videoHeight = h)
                                      else StreamProfile()
                        val path = streamingRepository.goLiveHarness(profile)
                        KLog.i("MainActivity", "CMD go-live → ${path ?: "(rtmp)"}")
                    }
                    // plans/09 S5 — старт РЕАЛЬНОГО RTMP-мультистрима на заданные URL для автономной
                    // приёмки бага 34 на локальном полигоне (MediaMTX). arg = "url1,url2,…"; каждый url
                    // режем на базу+ключ по последнему '/'. В ОТЛИЧИЕ от go-live (харнес → запись в MP4)
                    // это НАСТОЯЩИЙ сетевой RTMP-путь (connect/publish/disconnect) — только он
                    // воспроизводит стоп/рестарт и изоляцию сбоя выходов.
                    "go-live-rtmp" -> {
                        val urls = arg?.split(Regex("[,\\s]+"))?.filter { it.isNotBlank() } ?: emptyList()
                        val profiles = urls.mapIndexed { i, u ->
                            val cut = u.lastIndexOf('/')
                            val base = if (cut > 0) u.substring(0, cut) else u
                            val key = if (cut > 0) u.substring(cut + 1) else "test"
                            StreamProfile(name = "polygon$i", rtmpUrl = base, streamKey = key)
                        }
                        if (profiles.isEmpty()) KLog.w("MainActivity", "go-live-rtmp: нужен url (или url1,url2)")
                        else streamingRepository.startStream(profiles)
                    }
                    "stop" -> streamingRepository.stopAll()
                    // Idea 17 — снять фото (кадр композита) в галерею DCIM/KrinikCam.
                    "photo" -> streamingRepository.capturePhoto()
                    "set-rotation" -> arg?.toIntOrNull()?.let { streamingRepository.setVideoRotation(it) }
                    // add-overlay [id] — тестовый оверлей. Опц. id: предсказуемый для харнес-тестов
                    // жестов (напр. `add-overlay ov1` → потом `gesture-drag ov1 ...`). Без id — timestamp.
                    "add-overlay" -> streamingRepository.addTestOverlay(
                        id = arg?.trim()?.takeIf { it.isNotEmpty() } ?: "overlay_cmd_${System.currentTimeMillis()}",
                        name = "Overlay",
                    )
                    "rotation-mode" -> setAdbRotationEnabled(arg == "on")
                    // Phase 3: команда `compositor` удалена — композитор ВСЕГДА единственный пайплайн.
                    "compositor" -> KLog.w("MainActivity", "CMD compositor: DEPRECATED — композитор всегда включён (Phase 3), команда игнорируется")
                    // Тонкая команда: переключить видимость слоя по id (напр. camera) — для тестов OBS-поведения.
                    "toggle-layer" -> arg?.let { streamingRepository.toggleLayerVisible(it) }
                    "layer-up" -> arg?.let { streamingRepository.moveLayerUp(it) }
                    "layer-down" -> arg?.let { streamingRepository.moveLayerDown(it) }
                    // Трансформа слоя. arg = "<id> <scale> <cx> <cy> [alpha] [rotation]"
                    // (id — напр. camera; scale доля кадра; cx,cy центр в [0,1] (0,0=верх-лево); alpha опц.;
                    // rotation — поворот СОДЕРЖИМОГО слоя 0/90/180/270 CW, interview_006 Q3).
                    // plans/03 S8 — харнес-автоматизация ЖЕСТОВ (Криник: агент сам тестит имплементацию).
                    // Эмулируют кадр жеста поверх текущей трансформы слоя (тот же путь, что пальцы →
                    // repository.nudgeLayer). arg: "<id> <value>". Тестовый прогон: gesture-drag camera 0.2 0.1.
                    "gesture-drag" -> arg?.split(Regex("[,\\s]+"))?.let { p ->
                        if (p.size >= 3) streamingRepository.nudgeLayer(p[0],
                            p[1].toFloatOrNull() ?: 0f, p[2].toFloatOrNull() ?: 0f, 1f, 0f)
                        else KLog.w("MainActivity", "gesture-drag: '<id> <dCx> <dCy>' (доли кадра)")
                    }
                    "gesture-scale" -> arg?.split(Regex("[,\\s]+"))?.let { p ->
                        if (p.size >= 2) streamingRepository.nudgeLayer(p[0], 0f, 0f,
                            p[1].toFloatOrNull() ?: 1f, 0f)
                        else KLog.w("MainActivity", "gesture-scale: '<id> <factor>' (напр. 1.5)")
                    }
                    "gesture-rotate" -> arg?.split(Regex("[,\\s]+"))?.let { p ->
                        if (p.size >= 2) streamingRepository.nudgeLayer(p[0], 0f, 0f, 1f,
                            p[1].toFloatOrNull() ?: 0f)
                        else KLog.w("MainActivity", "gesture-rotate: '<id> <deg>' (дельта угла)")
                    }
                    "set-transform" -> arg?.split(Regex("[,\\s]+"))?.let { p ->
                        if (p.size >= 4) streamingRepository.setLayerTransform(
                            id = p[0],
                            scale = p[1].toFloatOrNull() ?: 1f,
                            cx = p[2].toFloatOrNull() ?: 0.5f,
                            cy = p[3].toFloatOrNull() ?: 0.5f,
                            alpha = p.getOrNull(4)?.toFloatOrNull() ?: 1f,
                            rotation = p.getOrNull(5)?.toIntOrNull() ?: 0,
                        ) else KLog.w("MainActivity", "set-transform: need '<id> <scale> <cx> <cy> [alpha] [rotation]'")
                    }
                    // Idea 24 — выбрать встроенную камеру устройства как источник (front|back|off).
                    "device-camera" -> when (arg) {
                        "front" -> deviceManager.selectPhoneCamera(isFront = true)
                        "off" -> deviceManager.selectVideoSource(com.kriniks.kcam.feature.capture.model.VideoSource.None)
                        else -> deviceManager.selectPhoneCamera(isFront = false) // back / default
                    }
                    // Plan 05 (S5) — явный выбор источника слоя «Устройство захвата видео» для тестов
                    // автоматизацией. front — селфи · rear — тыл · uvc — вебка · virtual — дебаг-паттерн ·
                    // none — нет источника · builtin <cameraId> — конкретная встроенная камера ОС по id.
                    "select-source" -> {
                        val parts = arg?.trim()?.split(Regex("\\s+")) ?: emptyList()
                        when (parts.firstOrNull()) {
                            "front" -> deviceManager.selectPhoneCamera(isFront = true)
                            "rear" -> deviceManager.selectPhoneCamera(isFront = false)
                            "uvc" -> deviceManager.selectUvc()
                            "virtual" -> deviceManager.selectVirtual()
                            "none" -> deviceManager.selectVideoSource(com.kriniks.kcam.feature.capture.model.VideoSource.None)
                            "builtin" -> parts.getOrNull(1)?.let { deviceManager.selectPhoneCameraById(it) }
                                ?: KLog.w("MainActivity", "select-source builtin <cameraId>")
                            else -> KLog.w("MainActivity", "select-source: front|rear|uvc|virtual|none|builtin <id>")
                        }
                    }
                    // plans/03 S8 — двухпальцевые жесты для АГЕНТА (устройство без рута, sendevent
                    // запрещён → инъектируем синтетические 2-пальцевые MotionEvent в СВОЙ decorView,
                    // прогоняя настоящий Compose-жест над выбранным слоем). Криник просил.
                    "gesture-pinch" -> {
                        val dir = arg?.trim()?.split(Regex("\\s+"))?.firstOrNull() ?: "out"
                        injectTwoFinger(if (dir == "in") "pinch-in" else "pinch-out", 0f)
                    }
                    "gesture-twist" -> {
                        val deg = arg?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.toFloatOrNull() ?: 45f
                        injectTwoFinger("twist", deg)
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
     * plans/03 S8 — проиграть СИНТЕТИЧЕСКИЙ двухпальцевый жест (щипок/поворот) поверх превью: диспатчим
     * последовательность MotionEvent (2 указателя) в свой `decorView`. Права на инъекцию в СВОИ вьюхи
     * есть без рута — жест проходит настоящий Compose-пайплайн (detectTransformGestures) над выбранным
     * слоем. [kind] = pinch-in|pinch-out|twist; [amount] — градусы для twist. Центр — центр экрана.
     */
    private fun injectTwoFinger(kind: String, amount: Float) {
        val root = window.decorView
        if (root.width == 0 || root.height == 0) return
        val cx = root.width / 2f
        val cy = root.height / 2f
        val minDim = minOf(root.width, root.height).toFloat()
        val steps = 24
        val stepMs = 16L
        // Начальный/конечный радиус разведения и угол (рад): щипок меняет радиус, twist — угол.
        val r0: Float; val r1: Float; val a0: Float; val a1: Float
        when (kind) {
            "pinch-in"  -> { r0 = minDim * 0.30f; r1 = minDim * 0.10f; a0 = 0f; a1 = 0f }
            "pinch-out" -> { r0 = minDim * 0.10f; r1 = minDim * 0.30f; a0 = 0f; a1 = 0f }
            else        -> { r0 = minDim * 0.22f; r1 = minDim * 0.22f; a0 = 0f
                             a1 = Math.toRadians(amount.toDouble()).toFloat() } // twist
        }
        val downTime = SystemClock.uptimeMillis()
        val handler = Handler(Looper.getMainLooper())
        val props = arrayOf(
            MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER },
            MotionEvent.PointerProperties().apply { id = 1; toolType = MotionEvent.TOOL_TYPE_FINGER },
        )
        // Два пальца симметрично: A в (cx+r·cosθ, cy+r·sinθ), B — напротив.
        fun coords(r: Float, a: Float): Array<MotionEvent.PointerCoords> {
            val dx = (r * kotlin.math.cos(a)); val dy = (r * kotlin.math.sin(a))
            val c0 = MotionEvent.PointerCoords().apply { x = cx + dx; y = cy + dy; pressure = 1f; size = 1f }
            val c1 = MotionEvent.PointerCoords().apply { x = cx - dx; y = cy - dy; pressure = 1f; size = 1f }
            return arrayOf(c0, c1)
        }
        fun dispatch(eventTime: Long, action: Int, count: Int, cs: Array<MotionEvent.PointerCoords>) {
            val ev = MotionEvent.obtain(
                downTime, eventTime, action, count,
                props.copyOfRange(0, count), cs.copyOfRange(0, count),
                0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0,
            )
            runCatching { root.dispatchTouchEvent(ev) }
            ev.recycle()
        }
        // DOWN (палец 0) → POINTER_DOWN (палец 1) → MOVE×steps → POINTER_UP → UP. Разносим по времени.
        handler.postDelayed({ dispatch(downTime, MotionEvent.ACTION_DOWN, 1, coords(r0, a0)) }, 0)
        handler.postDelayed({
            val act = MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            dispatch(downTime + stepMs, act, 2, coords(r0, a0))
        }, stepMs)
        for (i in 1..steps) {
            val frac = i.toFloat() / steps
            val r = r0 + (r1 - r0) * frac; val a = a0 + (a1 - a0) * frac
            val off = (i + 1) * stepMs
            handler.postDelayed({ dispatch(downTime + off, MotionEvent.ACTION_MOVE, 2, coords(r, a)) }, off)
        }
        val upOff = (steps + 2) * stepMs
        handler.postDelayed({
            val act = MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            dispatch(downTime + upOff, act, 2, coords(r1, a1))
        }, upOff)
        handler.postDelayed({ dispatch(downTime + upOff + stepMs, MotionEvent.ACTION_UP, 1, coords(r1, a1)) }, upOff + stepMs)
        KLog.i("MainActivity", "injectTwoFinger $kind amount=$amount (steps=$steps)")
    }

    /**
     * Harness control (Interview #004): toggle the virtual camera over ADB to simulate a source
     * disconnect/reconnect without a physical USB camera.
     *   adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state off -p <pkg>   # drop
     *   adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state on  -p <pkg>   # restore
     * state=off → activeSource None → CameraOpener снимается, слой-камера пустеет (сцена живёт);
     * state=on  → виртуальный продюсер снова кормит слой (Phase 3: без подмен источника).
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
        // POST_NOTIFICATIONS (13+) — для нотификации «LIVE» foreground-сервиса эфира (bug 36):
        // разрешение было объявлено в манифесте, но НЕ запрашивалось (мёртвое). Просим вместе с
        // остальными одним системным флоу (на харнесе одобряет `ui.mjs allow`).
        val required = buildList {
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.RECORD_AUDIO)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
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
