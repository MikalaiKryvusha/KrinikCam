/**
 * StreamForegroundService — foreground-сервис эфира (bug 36 / plans/10 S2+S3).
 * [TESTED: 2026-07-18 · приёмка S4 на RTMP-полигоне: экран ВЫКЛ 5 мин — пуллы 385 и 339+339 кадров;
 * HOME-фон (mStopped=true) — 355+355 кадров; нотификация появляется/снимается (0 записей после
 * стопа); wake lock захвачен/отпущен; smoke PASS. Кнопку Stop и тап живым пальцем покажет Криник —
 * код-путь тот же, что CMD stop / am start.]
 *
 * ЗАЧЕМ: без foreground-сервиса Android 12+ кэширует/замораживает процесс при выключении экрана
 * или сворачивании — умирают RTMP-сокет и энкодер, эфир падает. Сервис держит процесс в
 * foreground-классе на время эфира/записи и показывает нотификацию «LIVE» с кнопкой Stop.
 *
 * АРХИТЕКТУРА — сервис ТОНКИЙ (plans/10): пайплайном НЕ владеет. Hilt-синглтоны
 * (RtmpStreamer/DeviceManager/StreamingRepository) живут в процессе приложения — сервису достаточно
 * СУЩЕСТВОВАТЬ, чтобы процесс не замораживался. Старт/стоп сервиса дирижирует MainActivity по
 * фронтам streamState.isActive (та же точка, что keep-screen-on S1).
 *
 * S3: PARTIAL_WAKE_LOCK на время эфира — страховка от Doze при выключенном экране (CPU не спит,
 * GL/энкодер продолжают молотить). Release на стопе; таймаут не ставим — эфир может идти часами.
 *
 * Related: MainActivity.keepScreenOnWhileStreaming (дирижёр), StreamingRepository.stopAll (кнопка
 * Stop), plans/10, bugs/36.
 */

package com.kriniks.kcam.streaming

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.kriniks.kcam.MainActivity
import com.kriniks.kcam.R
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.streaming.domain.StreamingRepository
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

private const val TAG = "StreamFgService"

@AndroidEntryPoint
class StreamForegroundService : Service() {

    // Кнопка Stop в нотификации бьёт напрямую в репозиторий (стоп эфира и записи) — тот же путь,
    // что CMD stop. Дальше MainActivity увидит Idle по streamState и штатно погасит сервис.
    @Inject lateinit var streamingRepository: StreamingRepository

    // PARTIAL_WAKE_LOCK (S3) — CPU живёт при выключенном экране. Экран сервису не нужен.
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                // Пользователь нажал Stop в нотификации: гасим эфир; сервис остановит MainActivity
                // по фронту streamState (или мы сами ниже — на случай, если активити убита).
                KLog.i(TAG, "ACTION_STOP из нотификации → stopAll")
                streamingRepository.stopAll()
                stopForegroundAndSelf()
            }
            else -> startAsForeground()
        }
        // Пересоздание убитого системой сервиса без активного эфира не нужно — не липнем.
        return START_NOT_STICKY
    }

    /** Поднять сервис в foreground с нотификацией «LIVE» и захватить wake lock. */
    private fun startAsForeground() {
        createChannel()
        // Android 14+ требует явные типы FGS; они же дают доступ к камере/микрофону в фоне.
        // ⚠️ Типы собираем ДИНАМИЧЕСКИ (краш приёмки 2026-07-18, SecurityException): системная
        // валидация пускает тип connectedDevice только при живой «связи» — грант на USB-устройство,
        // BT/Wi-Fi-пермишны и т.п. Без вебки (харнес, виртуалка) заявка на connectedDevice убивает
        // процесс. Поэтому camera|microphone — всегда (runtime CAMERA/RECORD_AUDIO запрашиваются на
        // старте приложения), connectedDevice — только когда РЕАЛЬНО держим грант на USB-девайс.
        val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (hasGrantedUsbDevice()) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            t
        } else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types)
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KrinikCam:stream").apply {
                setReferenceCounted(false)
                acquire() // без таймаута: эфир может идти часами; release гарантирован в onDestroy
            }
        }
        KLog.i(TAG, "startForeground: LIVE-нотификация показана, wake lock захвачен")
    }

    /** Нотификация «🔴 KrinikCam LIVE»: тап → приложение (singleTask), кнопка Stop → ACTION_STOP. */
    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, StreamForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.notif_live_title))
            .setContentText(getString(R.string.notif_live_text))
            .setColor(BRAND_PINK)
            .setOngoing(true)
            .setContentIntent(openApp)
            .addAction(0, getString(R.string.notif_live_stop), stop)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    /** Канал IMPORTANCE_LOW — без звука/вибры: эфир и так на глазах у стримера. */
    private fun createChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel_stream), NotificationManager.IMPORTANCE_LOW),
        )
    }

    /** Есть ли на руках грант хотя бы на одно USB-устройство (условие типа connectedDevice). */
    private fun hasGrantedUsbDevice(): Boolean = runCatching {
        val um = getSystemService(Context.USB_SERVICE) as android.hardware.usb.UsbManager
        um.deviceList.values.any { um.hasPermission(it) }
    }.getOrDefault(false)

    private fun stopForegroundAndSelf() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        wakeLock?.let { runCatching { if (it.isHeld) it.release() } }
        wakeLock = null
        KLog.i(TAG, "onDestroy: wake lock отпущен, нотификация снята")
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "stream_live"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_STOP = "com.kriniks.kcam.action.STOP_STREAM"
        // Акцент бренда #FF1A8C (см. AGENT_GUIDE «Стиль кода») — нотификация в цветах приложения.
        private const val BRAND_PINK = 0xFFFF1A8C.toInt()

        /** Запустить сервис эфира (идемпотентно: повторный старт лишь обновит нотификацию). */
        fun start(context: Context) {
            context.startForegroundService(Intent(context, StreamForegroundService::class.java))
        }

        /** Погасить сервис эфира (идемпотентно: на незапущенном — no-op). */
        fun stop(context: Context) {
            context.stopService(Intent(context, StreamForegroundService::class.java))
        }
    }
}
