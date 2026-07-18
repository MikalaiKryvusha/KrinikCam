/**
 * StandbyImage — программно рисует бренд-заглушку KrinikCam «нет сигнала» как ПРОЗРАЧНЫЕ 16:9-битмапы для
 * GL-композитора (plans/sourses_timeout; указание Криника: «заглушка живёт ВНУТРИ слоя, а не поверх экрана»).
 *
 * Почему битмап, а не Compose-оверлей: заглушка — это СОСТОЯНИЕ СЛОЯ сцены, а не UI поверх всего экрана.
 * Раньше StandbyPlaceholder был полноэкранным Compose-оверлеем: он накрывал ВСЮ сцену, не двигался со
 * слоем и жил только в превью (в эфир/запись не попадал). Теперь композитор рисует ЭТИ битмапы квадом
 * ВНУТРИ квадрата слоя-камеры: двигаются/масштабируются со слоем, попадают в эфир и запись, и если в
 * сцене несколько источников — заглушка появляется ТОЛЬКО в отвалившемся слое, остальная сцена цела.
 *
 * ДВА слоя (Криник: «пульс на розовом заголовке — вообще красота»): [title] (вордмарк + разделитель)
 * рисуется отдельно, чтобы композитор ПУЛЬСИРОВАЛ его прозрачностью, а [body] (многоязычное «подождите»)
 * — статичен. Оба ПРОЗРАЧНЫЕ (только текст с мягкой тенью, без чёрной плашки), рисуются один раз и кэшируются.
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

object StandbyImage {

    private const val W = 1920
    private const val H = 1080
    private const val BRAND = 0xFFFF1A8C.toInt()  // acid pink — цвет бренда

    // «Пожалуйста, подождите» на языках Криника (зеркалит многоязычие Compose-заглушки).
    private val lines = listOf("Please stand by", "Пожалуйста, подождите")

    @Volatile private var cachedTitle: Bitmap? = null
    @Volatile private var cachedBody: Bitmap? = null

    /** Заголовок «KrinikCam» + разделитель — отдельный прозрачный 16:9 битмап (композитор пульсирует альфой). */
    fun title(): Bitmap = cachedTitle ?: renderTitle().also { cachedTitle = it }

    /** Подпись «Please stand by / …» — отдельный прозрачный 16:9 битмап (без пульса). */
    fun body(): Bitmap = cachedBody ?: renderBody().also { cachedBody = it }

    private fun blank(): Bitmap = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)

    private fun renderTitle(): Bitmap {
        val bmp = blank()
        val c = Canvas(bmp)
        c.drawColor(Color.TRANSPARENT)   // прозрачно — под заголовком ничего (только текст)
        val cx = W / 2f
        // Бренд-вордмарк по центру-вверх (мягкая тень — читаемо поверх любого кадра).
        val brand = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = BRAND
            textSize = 140f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            setShadowLayer(16f, 0f, 4f, 0xCC000000.toInt())
        }
        c.drawText("KrinikCam", cx, H * 0.44f, brand)
        // Тонкий разделитель под вордмарком.
        val div = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = BRAND; alpha = 150
            setShadowLayer(10f, 0f, 3f, 0xAA000000.toInt())
        }
        c.drawRect(cx - 90f, H * 0.49f, cx + 90f, H * 0.49f + 4f, div)
        return bmp
    }

    private fun renderBody(): Bitmap {
        val bmp = blank()
        val c = Canvas(bmp)
        c.drawColor(Color.TRANSPARENT)
        val cx = W / 2f
        // Многоязычное «подождите» — ЖИРНЫЙ белый с чёрным КОНТУРОМ (Криник: мягкая тень убивала
        // читаемость белого текста; обе строки в ОДНОМ стиле — «Пожалуйста, подождите» как «Please stand
        // by»). Обводка (STROKE) читается поверх любого кадра лучше тени: рисуем каждую строку дважды —
        // сначала толстый чёрный контур, потом белая заливка. Одинаковый размер/жирность/яркость строк.
        val size = 56f
        val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textAlign = Paint.Align.CENTER
            textSize = size
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            style = Paint.Style.STROKE
            strokeWidth = size * 0.16f
            strokeJoin = Paint.Join.ROUND
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = size
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            style = Paint.Style.FILL
        }
        var y = H * 0.58f
        lines.forEach { line ->
            c.drawText(line, cx, y, outline)
            c.drawText(line, cx, y, fill)
            y += 82f
        }
        return bmp
    }
}
