/**
 * SceneSnapshotDto — СЕРИАЛИЗУЕМЫЙ слепок сцены (idea 40 / plans/18 Фаза 0).
 *
 * Доменная `Scene`/`Layer` НЕ сериализуется напрямую: `Layer.Image` держит `Bitmap` в памяти (пиксели
 * нельзя класть в JSON) → в снапшоте вместо битмапа хранится ПУТЬ к PNG-файлу (см. ImageOverlayStore),
 * а конкретный тип слоя кодируется плоским полем `kind` (проще миграций, чем sealed-полиморфизм kotlinx).
 *
 * Формат версионируется полем [SceneSnapshotDto.version] — форвард-совместимость (неизвестные типы
 * слоёв на десериализации пропускаются, а не роняют restore; см. SceneSnapshotMapper).
 *
 * Related: SceneSnapshotMapper (Scene ↔ DTO), SceneSnapshotRepository (JSON+файлы), ImageOverlayStore.
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import kotlinx.serialization.Serializable

@Serializable
data class SceneSnapshotDto(
    val version: Int = 1,                          // версия формата снапшота
    val layers: List<LayerDto> = emptyList(),      // z-order снизу вверх (как в Scene.layers)
)

@Serializable
data class LayerDto(
    val kind: String,                              // KIND_VIDEO_CAPTURE | KIND_IMAGE
    val id: String,
    val name: String,
    val visible: Boolean = true,
    val transform: TransformDto = TransformDto(),
    val source: CaptureSourceDto? = null,          // только для video_capture
    val overlayPath: String? = null,               // только для image — путь к PNG в filesDir
) {
    companion object {
        const val KIND_VIDEO_CAPTURE = "video_capture"
        const val KIND_IMAGE = "image"
    }
}

@Serializable
data class TransformDto(
    val scale: Float = 1f,
    val cx: Float = 0.5f,
    val cy: Float = 0.5f,
    val alpha: Float = 1f,
    val rotation: Int = 0,
)

@Serializable
data class CaptureSourceDto(
    val kind: String,                              // builtin | uvc | virtual | none
    val id: String? = null,                        // cameraId (builtin) / deviceId (uvc)
    val displayName: String = "",
) {
    companion object {
        const val KIND_BUILTIN = "builtin"
        const val KIND_UVC = "uvc"
        const val KIND_VIRTUAL = "virtual"
        const val KIND_NONE = "none"
    }
}
