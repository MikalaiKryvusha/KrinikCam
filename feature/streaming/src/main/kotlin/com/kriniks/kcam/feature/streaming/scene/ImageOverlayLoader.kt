/**
 * ImageOverlayLoader — превращает выбранный пользователем файл-картинку в полнокадровый PNG-оверлей
 * (Idea 19, фаза 1 дорожной карты: реальная картинка из файла вместо тест-PNG).
 *
 * Почему «полнокадровый»: пока нет UI трансформы слоя (позиция/масштаб — фаза 4), оверлей рисуется во
 * весь кадр (`ImageObjectFilterRender`, доказанный путь). Если подать сырой логотип — он растянется на
 * весь экран с искажением. Поэтому здесь мы ВПИСЫВАЕМ картинку с сохранением пропорций по ЦЕНТРУ
 * прозрачного полотна 16:9 (letterbox-fit) и отдаём это полотно как оверлей: логотип виден правильно,
 * а путь рендера остаётся прежним. Когда появится трансформа — перейдём на setScale/setPosition и
 * перестанем пред-компоновать.
 *
 * Декод с даунсемплом, чтобы большие фото не съедали память и совпадали с размером кадра энкодера.
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.kriniks.kcam.core.logging.KLog

private const val TAG = "ImageOverlayLoader"

object ImageOverlayLoader {

    // Размер кадра-референса (как у OverlayTestImage и базового превью) — 16:9.
    private const val FRAME_W = 1920
    private const val FRAME_H = 1080

    /**
     * Декодировать байты картинки и вписать её по центру прозрачного полотна 16:9 с сохранением
     * пропорций. Возвращает полнокадровый ARGB_8888-битмап (готовый оверлей) или null при ошибке.
     */
    fun loadOverlay(bytes: ByteArray): Bitmap? {
        // idea 35 (Криник): БОЛЬШЕ НЕ вписываем в 16:9-полотно — отдаём картинку в её РОДНОМ аспекте.
        // Теперь слой хранит нативный bitmap (квадрат/текст/любой), а композитор вписывает его по
        // аспекту (как камеру, пилларбокс/леттербокс), рамка выделения и снап тоже адаптивны по аспекту.
        return decodeDownsampled(bytes, maxDim = FRAME_W)
    }

    /** Декод с inSampleSize так, чтобы большая сторона не превышала [maxDim] (степень двойки). */
    private fun decodeDownsampled(bytes: ByteArray, maxDim: Int): Bitmap? {
        // 1-й проход: только размеры, без аллокации пикселей.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            KLog.e(TAG, "decode: invalid image bounds ${bounds.outWidth}x${bounds.outHeight}")
            return null
        }
        // Подбираем inSampleSize (1,2,4,…), пока обе стороны не влезут в maxDim.
        var sample = 1
        while (bounds.outWidth / sample > maxDim || bounds.outHeight / sample > maxDim) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888 // сохраняем альфу (прозрачные PNG)
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }

}
