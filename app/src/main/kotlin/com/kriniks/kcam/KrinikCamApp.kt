package com.kriniks.kcam

import android.app.Application
import android.content.Context
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@HiltAndroidApp
class KrinikCamApp : Application() {

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        installCrashCatcher(base)
    }

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
    }

    companion object {
        /**
         * Installed BEFORE Hilt initialises (attachBaseContext fires before onCreate).
         * Writes the full stacktrace to external storage so it survives the crash
         * and can be read even without ADB.
         *
         * File location: /storage/emulated/0/Android/data/<appId>/files/crash_<timestamp>.txt
         * Remove this handler once the crash is diagnosed.
         */
        private fun installCrashCatcher(context: Context) {
            val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                try {
                    val sw = StringWriter()
                    throwable.printStackTrace(PrintWriter(sw))
                    val ts = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                    val dir = context.getExternalFilesDir(null) ?: context.filesDir
                    val file = File(dir, "crash_$ts.txt")
                    file.writeText(
                        "Thread: ${thread.name}\n" +
                        "Time: $ts\n\n" +
                        sw.toString()
                    )
                } catch (_: Exception) { /* don't recurse */ }

                // Bug 13: горячий детач/реплаг USB-камеры в эфире роняет процесс из ВНУТРЕННЕГО
                // потока библиотеки AndroidUSBCamera ("USBMonitor"): её UsbControlBlock-конструктор
                // зовёт UsbDevice.getSerialNumber(), требующий USB-permission, который к этому моменту
                // уже отозван при отвале устройства → SecurityException без try/catch в библиотеке →
                // необработанное исключение убивает приложение прямо во время стрима.
                // Мы НЕ можем пропатчить чужой поток, поэтому ловим именно этот узкий случай и
                // проглатываем его (логируем, но НЕ форвардим в defaultHandler) → процесс и живой
                // RTMP-стрим выживают. Условие максимально узкое (имя потока + тип + пакет в стеке),
                // чтобы не глотать настоящие краши приложения.
                if (isBenignUsbDetachCrash(thread, throwable)) {
                    return@setDefaultUncaughtExceptionHandler
                }
                defaultHandler?.uncaughtException(thread, throwable)
            }
        }

        /**
         * Распознаёт безопасный-к-проглатыванию краш из библиотеки AndroidUSBCamera при детаче USB
         * (Bug 13): SecurityException об отозванном доступе к USB-устройству, прилетевший с
         * внутреннего потока "USBMonitor" из стека com.serenegiant.usb.*.
         *
         * ВАЖНО (компромисс): проглоченное исключение уже размотало looper потока "USBMonitor", т.е.
         * сам хот-плаг-монитор после этого мёртв до перезапуска мониторинга/приложения. Но это
         * несравнимо лучше падения всего процесса во время эфира — стрим (со standby-источником)
         * продолжается. Перезапуск мониторинга для повторного attach — отдельным шагом.
         */
        private fun isBenignUsbDetachCrash(thread: Thread, throwable: Throwable): Boolean {
            if (thread.name != "USBMonitor") return false
            if (throwable !is SecurityException) return false
            // Убедимся, что исключение действительно из USB-стека библиотеки, а не случайный
            // SecurityException нашего кода на одноимённом потоке.
            return throwable.stackTrace.any { it.className.startsWith("com.serenegiant.usb.") }
        }
    }
}
