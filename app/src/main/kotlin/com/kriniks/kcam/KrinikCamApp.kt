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
                defaultHandler?.uncaughtException(thread, throwable)
            }
        }
    }
}
