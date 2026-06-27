package com.kriniks.kcam.feature.usb.data

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

// USBMonitor (libuvc) calls registerReceiver() without RECEIVER_EXPORTED/RECEIVER_NOT_EXPORTED,
// which crashes on Android 13+. This wrapper injects RECEIVER_NOT_EXPORTED transparently.
@SuppressLint("UnspecifiedRegisterReceiverFlag")
internal class ReceiverFlagFixContext(base: Context) : ContextWrapper(base) {
    override fun registerReceiver(receiver: BroadcastReceiver?, filter: IntentFilter): Intent? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            super.registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            super.registerReceiver(receiver, filter)
        }
    }
}
