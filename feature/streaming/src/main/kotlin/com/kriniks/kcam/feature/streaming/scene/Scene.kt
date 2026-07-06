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
    // Phase 3: хелпер visibleImageOverlays() удалён вместе с legacy-backend'ом RootEncoder-фильтров —
    // теперь ВСЕ видимые слои (камера и картинки равноправны, в порядке сцены) рисует наш композитор
    // (RtmpStreamer.applySceneLayers → CompositorVideoSource.setLayers).

    /** Добавить слой НА ВЕРХ стека (поверх остальных). */
    fun addOnTop(layer: Layer): Scene = copy(layers = layers + layer)

    /** Удалить слой по id (камеру в первом заходе не удаляем — UI это не предлагает). */
    fun remove(layerId: String): Scene = copy(layers = layers.filterNot { it.id == layerId })

    /** Переключить видимость слоя по id. */
    fun toggleVisible(layerId: String): Scene = copy(
        layers = layers.map { if (it.id == layerId) it.withVisible(!it.visible) else it },
    )

    /** Задать трансформу (позиция/масштаб/альфа, PiP) слою по id — Idea 25 шаг 4. */
    fun setTransform(layerId: String, transform: LayerTransform): Scene = copy(
        layers = layers.map { if (it.id == layerId) it.withTransform(transform) else it },
    )

    /** Сменить источник кадров слою «Устройство захвата видео» по id (plans/05: выбор источника). */
    fun setSource(layerId: String, source: CaptureSource): Scene = copy(
        layers = layers.map {
            if (it.id == layerId && it is Layer.VideoCapture) it.copy(source = source) else it
        },
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
        /** Сцена по умолчанию — один слой видеозахвата (минимальный срез). Оверлеи стример добавляет сам. */
        fun default(): Scene = Scene(listOf(Layer.VideoCapture()))
    }
}

// Иммутабельное копирование слоя со сменой флага видимости (sealed-тип → when по подтипам).
private fun Layer.withVisible(value: Boolean): Layer = when (this) {
    is Layer.VideoCapture -> copy(visible = value)
    is Layer.Image -> copy(visible = value)
}

// Иммутабельное копирование слоя со сменой трансформы.
private fun Layer.withTransform(value: LayerTransform): Layer = when (this) {
    is Layer.VideoCapture -> copy(transform = value)
    is Layer.Image -> copy(transform = value)
}
