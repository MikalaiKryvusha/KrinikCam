/**
 * VirtualFrameRenderer — builds the STATIC part of the debug virtual-camera test pattern (Idea 09).
 *
 * Why: to develop/debug the whole video pipeline (input handling, rotation, encoding, streaming)
 * WITHOUT a physical USB camera, we feed a synthetic 16:9 landscape frame — exactly what a real
 * 4K/1080p UVC webcam would output. The pattern is designed to make DISTORTION obvious:
 *   - a centred CIRCLE: must stay a circle; if it becomes an oval → the frame is stretched/squished;
 *   - a uniform GRID: bends/uneven spacing reveal scaling issues;
 *   - corner L-markers + a "TOP" label: reveal rotation / crop / mirroring;
 *   - "16:9" + wordmark for context.
 * The MOVING bits (sweep bar + live clock/frame counter) are drawn per-frame by VirtualCameraOpener (:app).
 *
 * Software Canvas → bitmap. Lives in :feature:streaming (no :app deps).
 *
 * Related: VirtualCameraOpener (:app — draws this + moving overlay into the camera layer)
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

private const val ACID_PINK = 0xFFFF1A8C.toInt()
private const val BG_DARK = 0xFF101418.toInt()
private const val GRID = 0x33FFFFFF        // faint white grid
private const val WHITE_DIM = 0xCCFFFFFF.toInt()

object VirtualFrameRenderer {

    /**
     * Render the static test pattern at [width]x[height] (16:9; defaults to 1080p — a real webcam
     * would output the same aspect, just at 4K). ARGB_8888 bitmap, drawn once and reused per frame.
     */
    fun renderStatic(width: Int = 1920, height: Int = 1080): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(BG_DARK)

        val cx = width / 2f
        val cy = height / 2f

        // ── Grid (uniform spacing → distortion is visible if it warps) ──────
        val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GRID; strokeWidth = height * 0.002f }
        val step = height / 9f   // 9 rows → squares are square only if aspect is preserved
        var x = step
        while (x < width) { c.drawLine(x, 0f, x, height.toFloat(), gridPaint); x += step }
        var y = step
        while (y < height) { c.drawLine(0f, y, width.toFloat(), y, gridPaint); y += step }

        // ── Centred circle (the key squish/stretch detector) ────────────────
        val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ACID_PINK; style = Paint.Style.STROKE; strokeWidth = height * 0.01f
        }
        val r = height * 0.32f   // big circle; oval ⇒ aspect wrong
        c.drawCircle(cx, cy, r, circlePaint)
        // Small crosshair at centre
        c.drawLine(cx - r * 0.1f, cy, cx + r * 0.1f, cy, circlePaint)
        c.drawLine(cx, cy - r * 0.1f, cx, cy + r * 0.1f, circlePaint)

        // ── Corner L-markers (orientation / crop detector) ──────────────────
        val cornerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = height * 0.008f
        }
        val m = height * 0.05f
        // Idea 13: pull the L-markers DEEPER inside the frame (was 3% of height ≈ hugging the edges,
        // so they hid under the status bar / FAB / rotate button). 6% of EACH axis keeps them clearly
        // inside and balanced (horizontal inset proportional to width, vertical to height).
        val padX = width * 0.06f
        val padY = height * 0.06f
        // TL
        c.drawLine(padX, padY, padX + m, padY, cornerPaint); c.drawLine(padX, padY, padX, padY + m, cornerPaint)
        // TR
        c.drawLine(width - padX, padY, width - padX - m, padY, cornerPaint); c.drawLine(width - padX, padY, width - padX, padY + m, cornerPaint)
        // BL
        c.drawLine(padX, height - padY, padX + m, height - padY, cornerPaint); c.drawLine(padX, height - padY, padX, height - padY - m, cornerPaint)
        // BR
        c.drawLine(width - padX, height - padY, width - padX - m, height - padY, cornerPaint); c.drawLine(width - padX, height - padY, width - padX, height - padY - m, cornerPaint)

        // ── "TOP" label (orientation) ───────────────────────────────────────
        val topPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ACID_PINK; textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); textSize = height * 0.06f
        }
        c.drawText("▲ TOP", cx, padY + height * 0.10f, topPaint)

        // ── Wordmark + aspect ───────────────────────────────────────────────
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = WHITE_DIM; textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL); textSize = height * 0.04f
        }
        // Поднято ближе к кругу (Bug 11): низ кадра занимает движущийся счётчик из VirtualCameraOpener,
        // поэтому статичную подпись держим выше, чтобы не накладывались.
        c.drawText("KrinikCam · VIRTUAL CAM · 16:9", cx, cy + r + height * 0.06f, labelPaint)

        return bmp
    }
}
