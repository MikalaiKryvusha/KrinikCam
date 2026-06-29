/**
 * SceneCompositor — адаптер «доменная [Scene] → backend рендера» (Idea 19, interview_005).
 *
 * Backend компоновки оверлеев = штатный стек фильтров RootEncoder (`GlStreamInterface`):
 *   • базовый слой (камера) рисуется самим пайплайном как VideoSource — компоновщик его не трогает;
 *   • каждый видимый слой-картинка → `ImageObjectFilterRender`, добавленный в стек фильтров;
 *   • порядок добавления = z-order (нижний оверлей добавляется первым), как в [Scene.layers].
 *
 * Применяется идемпотентно: на каждый вызов [apply] полностью пересобираем стек фильтров под
 * текущую сцену (clearFilters → addFilter по порядку). Вызовы редкие (старт превью, готовность GL,
 * старт стрима, правка сцены пользователем) — не на каждый кадр, поэтому пересборка дешева и проста
 * (KISS). Если позже потребуется минимизировать churn — кэшировать рендеры по id слоя.
 *
 * Потокобезопасность: add/clearFilters в RootEncoder сами постятся на GL-поток через рендер-хендлер,
 * звать можно с main. Если GL ещё не запущен — просто выходим (повторно применится на следующем хуке).
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.Color
import com.kriniks.kcam.core.logging.KLog
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.library.view.GlStreamInterface

private const val TAG = "SceneCompositor"

object SceneCompositor {

    // Мастер-битмап непрозрачного чёрного «покрывала» во весь кадр. Используется, когда слой камеры
    // ВЫКЛЮЧЕН: камера-источник физически всегда базовый (низ пайплайна RootEncoder), поэтому, чтобы
    // «спрятать» её, кладём поверх непрозрачный чёрный фильтр — визуально получается пустой чёрный
    // канвас, а включённые оверлеи рисуются уже поверх него. Ленивая инициализация, копия отдаётся
    // фильтру (как и оверлеям — RootEncoder рециклит переданный битмап, см. Bug 14).
    private val blackCover: Bitmap by lazy {
        Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
    }

    /**
     * Привести стек фильтров [gl] в соответствие со сценой [scene]: убрать все оверлеи и заново
     * добавить видимые слои-картинки в порядке снизу вверх. No-op до запуска GL.
     */
    fun apply(gl: GlStreamInterface?, scene: Scene) {
        gl ?: return
        try {
            // Полная пересборка стека под текущую сцену.
            gl.clearFilters()
            // Если слой камеры ВЫКЛЮЧЕН — кладём непрозрачное чёрное покрывало поверх камеры-источника
            // (первым фильтром, т.е. ниже всех оверлеев) → визуально пустой чёрный канвас. Камера при
            // этом физически продолжает кормить базу, но её не видно.
            val cameraHidden = scene.layers.any { it is Layer.Camera && !it.visible }
            if (cameraHidden) {
                gl.addFilter(ImageObjectFilterRender().apply { setImage(blackCover.copy(Bitmap.Config.ARGB_8888, false)) })
            }
            val overlays = scene.visibleImageOverlays()
            overlays.forEach { layer ->
                // ВАЖНО (Bug 14): отдаём фильтру КОПИЮ битмапа, НЕ сам layer.bitmap. RootEncoder
                // при clearFilters/release РЕЦИКЛИТ переданный в setImage битмап; если отдать общий
                // layer.bitmap — он умрёт, и следующий apply (после reorder/toggle) + миниатюра слоя
                // в Compose нарисуют переработанный битмап → краш «trying to use a recycled bitmap».
                // Копия принадлежит фильтру (его и переработают), а layer.bitmap остаётся живым.
                val render = ImageObjectFilterRender().apply {
                    setImage(layer.bitmap.copy(Bitmap.Config.ARGB_8888, false))
                }
                // addFilter без индекса = добавить на верх стека; идём снизу вверх → корректный z-order.
                gl.addFilter(render)
            }
            KLog.d(TAG, "apply: ${overlays.size} overlay layer(s) → filter stack (total layers=${scene.layers.size})")
        } catch (e: Exception) {
            KLog.e(TAG, "apply: failed to sync overlay filters", e)
        }
    }
}
