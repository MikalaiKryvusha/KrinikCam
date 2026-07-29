/**
 * NetworkSlateImage — «нижняя лента» сетевого слейта (живучесть эфира, УРОВЕНЬ 4; plans/21 работа C, шаг C2).
 *
 * Что это. Когда сеть просела и эфир не идёт, зритель видит ЗАМЕРШИЙ последний кадр (шаг C1) плюс эту
 * ленту с текстом «связь восстанавливается». Решение Криника — interview_011 Р1 = «в» (гибрид: замерший
 * кадр + плашка), внешний вид выбран им же из четырёх мокапов (interview_014, В1: вариант C, дословно
 * «C - только сделать фон темнее, и размер ленты чуть больше»).
 *
 * Почему битмап в композиторе, а не Compose-оверлей: плашка обязана попасть В ЭФИР и В ЗАПИСЬ, а Compose
 * живёт только в превью и о геометрии кадра энкодера не знает. Этот урок уже оплачен (EXP-0018: первую
 * заглушку пришлось переносить из Compose в GL по прямому указанию Криника).
 *
 * Почему размеры в ДОЛЯХ от высоты кадра, а не в пикселях мокапа. Мокап нарисован для 1920×1080, но
 * холст энкодера при глобальном повороте становится портретным 1080×1920 (interview_006). Растяни мы
 * битмап 16:9 на портретный холст — лента и текст поехали бы. Поэтому битмап рисуется ПОД ФАКТИЧЕСКИЙ
 * размер выходного кадра, а все величины взяты долями от него: пропорции сохраняются в любой ориентации.
 *
 * Эталон (assets/graphics/mockups/network_slate/slate_C.svg), числа для 1920×1080 → доли:
 *   лента           y=812  h=268  → 0.7519 / 0.2481 высоты
 *   градиент        alpha 0 → 0.86 (на 30% высоты ленты) → 0.985 у нижней кромки
 *   брендовая линия h=3   → 0.00278, цвет #FF1A8C alpha 0.92
 *   индикатор       cy=925 r=12, ореол r=23 alpha 0.28
 *   текст 1         48px bold  белый,         baseline y=940
 *   текст 2         33px medium белый a=0.90, baseline y=992
 *
 * [TESTED: 2026-07-29 · кадры вытянуты ffmpeg'ом С RTMP-СЕРВЕРА на живом эфире (скриншот телефона
 *  ничего не доказал бы — плашка обязана быть В ЭФИРЕ). Ландшафт 1920×1080: лента внизу, брендовая
 *  линия и индикатор на месте, обе строки читаются. Портрет 1080×1920 (`set-rotation 90`): текст
 *  ГОРИЗОНТАЛЕН и умещается целиком. Две ошибки поймались именно этой приёмкой и исправлены:
 *  (1) лента уезжала наверх с текстом вверх ногами — лишний `texMatrix = snapIdentity` на отрисовке;
 *  (2) в портрете строка обрезалась («Связь восстанавливаетс…») — кегль считался от высоты кадра,
 *  добавлена подгонка по ширине.]
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface

object NetworkSlateImage {

    private const val BRAND = 0xFFFF1A8C.toInt()  // acid pink — цвет бренда

    // Двуязычие зеркалит StandbyImage: пара «англ. / рус.» уже принята Криником и «выглядит хорошо».
    private const val LINE_RU = "Связь восстанавливается"
    private const val LINE_EN = "Reconnecting…"

    // Доли от ВЫСОТЫ кадра — см. таблицу в шапке файла.
    private const val BAND_TOP_F    = 0.7519f
    private const val BAND_H_F      = 0.2481f
    private const val BRAND_LINE_F  = 0.00278f
    private const val DOT_CY_F      = 0.85648f
    private const val DOT_R_F       = 0.01111f
    private const val DOT_HALO_R_F  = 0.02130f
    private const val TEXT1_SIZE_F  = 0.04444f
    private const val TEXT2_SIZE_F  = 0.03056f
    private const val TEXT1_BASE_F  = 0.87037f
    private const val TEXT2_BASE_F  = 0.91852f
    private const val DOT_GAP_F     = 0.0204f   // зазор «точка → текст» (44px при H=1080)

    // Кэш по размеру кадра: пересоздаём битмап только когда холст реально сменил размер
    // (портрет↔ландшафт), а не на каждый кадр — рисование Canvas'ом дороже, чем сравнение двух чисел.
    @Volatile private var cached: Bitmap? = null
    @Volatile private var cachedW = 0
    @Volatile private var cachedH = 0

    /** Прозрачный битмап [w]×[h] с лентой внизу. Кэшируется; при смене размера рисуется заново. */
    fun band(w: Int, h: Int): Bitmap? {
        if (w <= 0 || h <= 0) return null
        cached?.let { if (cachedW == w && cachedH == h && !it.isRecycled) return it }
        val bmp = render(w, h)
        cached = bmp; cachedW = w; cachedH = h
        return bmp
    }

    /** Освободить кэш (реинит GL / stop): битмап переживать сессию не должен. */
    fun clear() {
        cached?.let { if (!it.isRecycled) it.recycle() }
        cached = null; cachedW = 0; cachedH = 0
    }

    private fun render(w: Int, h: Int): Bitmap {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.TRANSPARENT)

        val bandTop = h * BAND_TOP_F
        val bandBottom = h.toFloat()

        // 1. Лента: вертикальный градиент чёрного. Именно он — та самая «тёмная тень», ради которой
        //    Криник выбрал этот вариант: подложка сама создаётся под текстом, поэтому текст читается
        //    на любом контенте, а не только на удобном (проверено на светлом и тёмном кадре).
        val bandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, bandTop, 0f, bandBottom,
                intArrayOf(
                    Color.argb(0, 0, 0, 0),
                    Color.argb((0.86f * 255).toInt(), 0, 0, 0),
                    Color.argb((0.985f * 255).toInt(), 0, 0, 0),
                ),
                floatArrayOf(0f, 0.30f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        c.drawRect(0f, bandTop, w.toFloat(), bandBottom, bandPaint)

        // 2. Брендовая линия по верхней кромке ленты.
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = BRAND; alpha = (0.92f * 255).toInt()
        }
        c.drawRect(0f, bandTop, w.toFloat(), bandTop + h * BRAND_LINE_F, linePaint)

        // 3. Текст. Ширину МЕРЯЕМ и центруем блок «точка + текст» по кадру: в SVG координаты подбирались
        //    на глаз, а здесь длина строки зависит от шрифта устройства и от будущей локализации.
        val t1 = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = h * TEXT1_SIZE_F
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val t2 = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; alpha = (0.90f * 255).toInt()
            textSize = h * TEXT2_SIZE_F
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        var dotR = h * DOT_R_F
        var haloR = h * DOT_HALO_R_F
        var gap = h * DOT_GAP_F
        var textW = maxOf(t1.measureText(LINE_RU), t2.measureText(LINE_EN))
        var blockW = haloR * 2f + gap + textW

        // ПОДГОНКА ПО ШИРИНЕ. Кегль задан долей от ВЫСОТЫ кадра (так пропорции ленты совпадают с
        // утверждённым мокапом), но в ПОРТРЕТЕ высота 1920 при ширине 1080 — и строка, посчитанная
        // от высоты, вылезает за кадр: «Связь восстанавливаетс…» (поймано кадром с сервера 2026-07-29).
        // Поэтому если блок шире безопасного поля — ужимаем ВСЁ пропорционально. Это же спасёт будущие
        // локализации, где строка длиннее русской (немецкий, испанский).
        val maxBlockW = w * 0.92f
        if (blockW > maxBlockW) {
            val fit = maxBlockW / blockW
            t1.textSize *= fit
            t2.textSize *= fit
            dotR *= fit; haloR *= fit; gap *= fit
            textW = maxOf(t1.measureText(LINE_RU), t2.measureText(LINE_EN))
            blockW = haloR * 2f + gap + textW
        }
        val blockLeft = (w - blockW) / 2f
        val dotCx = blockLeft + haloR
        val textX = blockLeft + haloR * 2f + gap

        // 4. Индикатор: точка с ореолом (в живой плашке ореол пульсирует альфой — как пульсирует
        //    розовый заголовок брендовой заглушки, который Криник назвал «вообще красота»).
        val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = BRAND; alpha = (0.28f * 255).toInt() }
        val dot  = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = BRAND }
        c.drawCircle(dotCx, h * DOT_CY_F, haloR, halo)
        c.drawCircle(dotCx, h * DOT_CY_F, dotR, dot)

        c.drawText(LINE_RU, textX, h * TEXT1_BASE_F, t1)
        c.drawText(LINE_EN, textX, h * TEXT2_BASE_F, t2)
        return bmp
    }
}
