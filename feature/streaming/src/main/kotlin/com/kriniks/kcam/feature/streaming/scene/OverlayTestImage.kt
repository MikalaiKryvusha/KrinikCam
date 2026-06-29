/**
 * OverlayTestImage — программно рисует тестовый PNG-оверлей для первого захода мульти-источников
 * (Idea 19, Q1=A). Нужен, чтобы доказать пайплайн компоновки БЕЗ файлов/SAF и БЕЗ рук Криника:
 * добавляем такой слой-картинку поверх (виртуальной) камеры и через ADB-скриншот убеждаемся, что
 * оверлей реально лёг в кадр (и в превью, и в энкодер). Реальный выбор PNG из файла (SAF) — следующий
 * шаг; здесь самодостаточный битмап.
 *
 * Рисуем на ПРОЗРАЧНОМ полотне 16:9 яркий бренд-бейдж (#FF1A8C) с текстом в левом-верхнем углу и
 * тонкую рамку по периметру — так оверлей однозначно виден поверх тест-паттерна виртуалки.
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF

object OverlayTestImage {

    // Цвет бренда (acid pink) — см. стиль кода в AGENT_GUIDE.
    private const val BRAND = 0xFFFF1A8C.toInt()
    private const val W = 1920
    private const val H = 1080

    /** Полнокадровый прозрачный битмап с бренд-бейджем и рамкой — тестовый оверлей. */
    fun render(): Bitmap {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        // Прозрачный фон — видна камера под оверлеем.
        canvas.drawColor(Color.TRANSPARENT)

        // Рамка по периметру кадра (чтобы было видно, что оверлей растянут на весь кадр).
        val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 10f
            color = BRAND
        }
        canvas.drawRect(20f, 20f, W - 20f, H - 20f, border)

        // Текст бейджа — сначала измеряем, чтобы плашка точно села по тексту (не обрезала его).
        val label = "KrinikCam · overlay"
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 84f
            isFakeBoldText = true
        }
        val textW = text.measureText(label)
        val fm = text.fontMetrics
        val textH = fm.descent - fm.ascent
        // Внутренние отступы плашки и её положение в левом-верхнем углу.
        val padX = 40f
        val padY = 24f
        val badgeLeft = 60f
        val badgeTop = 60f
        val badgeRect = RectF(
            badgeLeft, badgeTop,
            badgeLeft + textW + padX * 2,
            badgeTop + textH + padY * 2,
        )
        val badge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = BRAND }
        canvas.drawRoundRect(badgeRect, 28f, 28f, badge)

        // Базовая линия текста: верх плашки + паддинг − ascent (ascent отрицателен).
        val baseline = badgeTop + padY - fm.ascent
        canvas.drawText(label, badgeLeft + padX, baseline, text)
        return bmp
    }
}
