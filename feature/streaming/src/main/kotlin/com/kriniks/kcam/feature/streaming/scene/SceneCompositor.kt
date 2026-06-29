/**
 * SceneCompositor — стейтфул-адаптер «доменная [Scene] → стек фильтров RootEncoder» (Idea 21).
 *
 * Новая модель (камера = обычный слой над ЧЁРНОЙ базой):
 *   • базовый VideoSource энкодера = BlackVideoSource (чёрный кадр, задаёт каденс);
 *   • КАЖДЫЙ слой сцены = фильтр поверх базы:
 *       - камера → `SurfaceFilterRender` (камеру в него открывает :app через callback onCameraSurface);
 *       - картинка → `ImageObjectFilterRender`.
 *   • Где слои не перекрывают — виден чёрный (пустой канвас, как в OBS). Скрытие/удаление камеры =
 *     удаление её фильтра → видна чёрная база + оверлеи (естественно, без костыля-покрывала Bug 15).
 *
 * ⚠️ ПОЧЕМУ СТЕЙТФУЛ И БЕЗ `clearFilters` (Bug-урок): `clearFilters`/пересоздание камеры-фильтра
 * каждый apply → повторный `surfaceReady` → переоткрытие камеры (шторм/мерцание). Поэтому держим
 * инстанс камеры-фильтра СТАБИЛЬНЫМ и трогаем его только при смене ВИДИМОСТИ камеры, а оверлеи
 * пересобираем отдельно (дёшево, камеры не касается).
 *
 * Первый милстоун (Шаг 2): камера ПРИШПИЛЕНА вниз (index 0), оверлеи поверх в порядке сцены.
 * Произвольный reorder камеры среди оверлеев — Шаг 4 (ограничение churn RootEncoder).
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import com.kriniks.kcam.core.logging.KLog
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.encoder.input.gl.render.filters.`object`.SurfaceFilterRender
import com.pedro.library.view.GlStreamInterface

private const val TAG = "SceneCompositor"

/**
 * @param onCameraSurface вызывается, когда у камеры-слоя появляется SurfaceTexture (открыть камеру)
 *        или когда слой камеры убирается (null → закрыть камеру). Реализуется в :app (AUSBC).
 */
class SceneCompositor(
    private val onCameraSurface: (SurfaceTexture?) -> Unit,
) {
    // Стабильный инстанс фильтра камеры (создаётся при появлении видимого слоя камеры).
    private var cameraFilter: SurfaceFilterRender? = null
    // Фильтры-картинки по id слоя (пересобираются на каждый apply — дёшево, камеры не касается).
    private val imageFilters = LinkedHashMap<String, ImageObjectFilterRender>()

    /**
     * Привести стек фильтров [gl] к текущей сцене. No-op до запуска GL.
     */
    fun apply(gl: GlStreamInterface?, scene: Scene) {
        gl ?: return
        try {
            reconcileCamera(gl, scene)
            reconcileOverlays(gl, scene)
        } catch (e: Exception) {
            KLog.e(TAG, "apply failed", e)
        }
    }

    // Камера-фильтр: создаём при видимом слое камеры, убираем при скрытии/отсутствии. Пришпилен вниз.
    private fun reconcileCamera(gl: GlStreamInterface, scene: Scene) {
        val cameraVisible = scene.layers.any { it is Layer.Camera && it.visible }
        if (cameraVisible && cameraFilter == null) {
            // surfaceReady прилетит на GL-потоке после инициализации фильтра → откроем туда камеру.
            val filter = SurfaceFilterRender { st -> onCameraSurface(st) }
            cameraFilter = filter
            gl.addFilter(0, filter) // index 0 = ниже всех оверлеев
            KLog.d(TAG, "camera layer → SurfaceFilterRender added (index 0)")
        } else if (!cameraVisible && cameraFilter != null) {
            onCameraSurface(null) // закрыть камеру до снятия фильтра
            runCatching { gl.removeFilter(cameraFilter!!) }
            cameraFilter = null
            KLog.d(TAG, "camera layer hidden/removed → SurfaceFilterRender removed")
        }
    }

    // Оверлеи-картинки: снимаем все текущие и заново добавляем видимые в порядке сцены (поверх камеры).
    private fun reconcileOverlays(gl: GlStreamInterface, scene: Scene) {
        if (imageFilters.isNotEmpty()) {
            imageFilters.values.forEach { runCatching { gl.removeFilter(it) } }
            imageFilters.clear()
        }
        val visibleImages = scene.layers.filterIsInstance<Layer.Image>().filter { it.visible }
        visibleImages.forEach { layer ->
            // КОПИЯ битмапа: RootEncoder рециклит переданный в setImage (Bug 14) — отдаём не layer.bitmap.
            val filter = ImageObjectFilterRender().apply { setImage(layer.bitmap.copy(Bitmap.Config.ARGB_8888, false)) }
            imageFilters[layer.id] = filter
            gl.addFilter(filter) // поверх (камера уже на index 0)
        }
        KLog.d(TAG, "overlays synced: ${visibleImages.size} image layer(s) (camera=${cameraFilter != null})")
    }

    /** Сбросить всё состояние (например, при пересоздании стрима). Камеру закрываем. */
    fun reset(gl: GlStreamInterface?) {
        runCatching { onCameraSurface(null) }
        gl?.let { runCatching { it.clearFilters() } }
        cameraFilter = null
        imageFilters.clear()
    }
}
