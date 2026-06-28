/**
 * StandbyFrameRenderer — builds the "Please stand by" placeholder bitmap that gets
 * injected into the live RTMP stream when the USB camera disconnects.
 *
 * Why a bitmap (not a Compose overlay): the RTMP encoder pulls frames from the GL pipeline.
 * When the USB camera dies it stops feeding the GL SurfaceTexture → the encoder starves →
 * YouTube drops the connection after ~15s (Broken Pipe). To keep the session alive we need a
 * VideoSource that actively pushes frames; StandbyVideoSource draws THIS bitmap on a timer.
 *
 * The design mirrors the on-screen Compose StandbyPlaceholder (:app) so the local preview and
 * the streamed frame look identical: dark background, acid-pink "KrinikCam" wordmark, a divider,
 * and the multilingual "please stand by" lines.
 *
 * Related: StandbyVideoSource, RtmpStreamer.enterStandby(), StandbyPlaceholder (:app overlay)
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

// Brand palette — kept in sync with :core:ui Color.kt and the Compose StandbyPlaceholder.
private const val ACID_PINK = 0xFFFF1A8C.toInt()
private const val DARK_BG = 0xFF0D0D0D.toInt()

// "Please stand by" in the 5 priority languages — same list as StandbyPlaceholder (Q6 decision).
private val STANDBY_LINES = listOf(
    "Please stand by",        // EN
    "Пожалуйста, подождите",  // RU
    "Por favor, espere",      // ES
    "Bitte warten",           // DE
    "请稍候",                  // ZH
)

object StandbyFrameRenderer {

    /**
     * Render the standby placeholder at [width] x [height] (defaults to 1080p — the standard
     * encoder size). Returns an ARGB_8888 bitmap ready to be drawn into the GL Surface.
     *
     * All sizing is scaled off the frame height so the layout looks right at any resolution.
     */
    fun render(width: Int = 1920, height: Int = 1080): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(DARK_BG)

        val cx = width / 2f
        // Vertical layout anchored slightly above centre so the multilingual block sits balanced.
        val centerY = height / 2f

        // ── Wordmark: "KrinikCam" ────────────────────────────────────────────
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ACID_PINK
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textSize = height * 0.11f   // ~118px at 1080p
        }
        val titleY = centerY - height * 0.12f
        canvas.drawText("KrinikCam", cx, titleY, titlePaint)

        // ── Divider line under the wordmark ──────────────────────────────────
        val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ACID_PINK
            alpha = 102   // ~0.4 * 255, matches the Compose divider
        }
        val dividerW = width * 0.06f
        val dividerY = titleY + height * 0.04f
        val dividerH = height * 0.004f
        canvas.drawRect(cx - dividerW / 2f, dividerY, cx + dividerW / 2f, dividerY + dividerH, dividerPaint)

        // ── Multilingual "please stand by" lines ─────────────────────────────
        val primaryPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            alpha = 230   // ~0.9
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            textSize = height * 0.045f   // ~48px at 1080p
        }
        val secondaryPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            alpha = 128   // ~0.5
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            textSize = height * 0.036f   // ~39px at 1080p
        }

        var lineY = dividerY + height * 0.10f
        STANDBY_LINES.forEachIndexed { index, line ->
            val paint = if (index == 0) primaryPaint else secondaryPaint
            canvas.drawText(line, cx, lineY, paint)
            // Advance by the line's own height plus a small gap.
            lineY += paint.textSize * 1.5f
        }

        return bitmap
    }
}
