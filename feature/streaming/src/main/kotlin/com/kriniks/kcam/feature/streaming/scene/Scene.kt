/**
 * Scene — рабочая область KrinikCam: упорядоченный список слоёв (фундамент мульти-источников, Idea 19).
 *
 * Порядок в [layers] = z-order СНИЗУ ВВЕРХ: index 0 рисуется первым (низ), последний — поверх всех.
 * Камера-слой по конвенции стоит на дне (index 0). Все операции иммутабельны (возвращают новую Scene)
 * — удобно для StateFlow и будущего undo / профилей сцены.
 *
 * Будущее (Q4): сюда же ляжет особый слой «ЗАГЛУШКА KrinikCam» (fallback при отвале камеры) и
 * сериализация в «профиль сцены» с импортом/экспортом — по аналогии с профилями платформ (Idea 01).
 */

package com.kriniks.kcam.feature.streaming.scene

data class Scene(
    val layers: List<Layer> = emptyList(),
) {
    /**
     * Видимые слои-картинки, лежащие ВЫШЕ камеры в z-order — именно их кладёт компоновщик поверх кадра.
     *
     * Почему «выше камеры»: видео камеры — НЕПРОЗРАЧНЫЙ слой во весь канвас (базовый источник энкодера).
     * Всё, что ниже него в списке, физически перекрыто этим видео → рисовать не нужно (и нельзя — в
     * backend RootEncoder фильтры всегда поверх базового источника). Поэтому корректная семантика
     * z-order: оверлеи ВЫШЕ камеры видны (фильтры поверх), оверлеи НИЖЕ камеры скрыты (перекрыты).
     * Камера сверху всех → ни один оверлей не виден (камера заполняет кадр). Если камеры в сцене нет
     * (edge case) — считаем базой «дно» и рисуем все видимые картинки.
     */
    fun visibleImageOverlays(): List<Layer.Image> {
        val cameraIndex = layers.indexOfFirst { it is Layer.Camera } // -1 если камеры нет
        return layers
            .filterIndexed { index, layer -> index > cameraIndex && layer is Layer.Image && layer.visible }
            .filterIsInstance<Layer.Image>()
    }

    /** Добавить слой НА ВЕРХ стека (поверх остальных). */
    fun addOnTop(layer: Layer): Scene = copy(layers = layers + layer)

    /** Удалить слой по id (камеру в первом заходе не удаляем — UI это не предлагает). */
    fun remove(layerId: String): Scene = copy(layers = layers.filterNot { it.id == layerId })

    /** Переключить видимость слоя по id. */
    fun toggleVisible(layerId: String): Scene = copy(
        layers = layers.map { if (it.id == layerId) it.withVisible(!it.visible) else it },
    )

    /** Сдвинуть слой по id на одну позицию выше в z-order (ближе к зрителю). */
    fun moveUp(layerId: String): Scene = swap(layerId, +1)

    /** Сдвинуть слой по id на одну позицию ниже в z-order. */
    fun moveDown(layerId: String): Scene = swap(layerId, -1)

    // Обмен соседних элементов списка; индексы за границами игнорируются (no-op).
    private fun swap(layerId: String, delta: Int): Scene {
        val i = layers.indexOfFirst { it.id == layerId }
        val j = i + delta
        if (i < 0 || j < 0 || j > layers.lastIndex) return this
        val mutable = layers.toMutableList()
        mutable[i] = layers[j]
        mutable[j] = layers[i]
        return copy(layers = mutable)
    }

    companion object {
        /** Сцена по умолчанию — только камера (минимальный срез). Оверлеи стример добавляет сам. */
        fun default(): Scene = Scene(listOf(Layer.Camera()))
    }
}

// Иммутабельное копирование слоя со сменой флага видимости (sealed-тип → when по подтипам).
private fun Layer.withVisible(value: Boolean): Layer = when (this) {
    is Layer.Camera -> copy(visible = value)
    is Layer.Image -> copy(visible = value)
}
