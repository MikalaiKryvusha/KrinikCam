/**
 * SceneSnapshotMapper — ЧИСТЫЙ маппер `Scene` ↔ `SceneSnapshotDto` (idea 40 / plans/18 Фаза 0).
 *
 * Специально БЕЗ Android-зависимостей в самой логике: работу с `Bitmap` вынесли в ДВЕ лямбды —
 * `writeOverlay` (bitmap → путь к PNG) и `readOverlay` (путь → bitmap?). Их подставляет
 * SceneSnapshotRepository (реальный ImageOverlayStore), а unit-тест — стабы. Так round-trip
 * источников/трансформ/z-order/видимости тестируется на pure-JVM без Robolectric.
 *
 * Мягкая десериализация (как у EncoderProfileEntity.toProfile): неизвестный тип слоя или пропавший
 * файл-оверлей → слой пропускается, а не роняет restore.
 *
 * Related: SceneSnapshotDto, SceneSnapshotRepository, ImageOverlayStore.
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import android.graphics.Bitmap
import com.kriniks.kcam.feature.streaming.scene.CaptureSource
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.LayerTransform
import com.kriniks.kcam.feature.streaming.scene.Scene

object SceneSnapshotMapper {

    /** Scene → DTO. [writeOverlay] сохраняет bitmap слоя-картинки и возвращает путь (вызывается только для Image). */
    fun toSnapshot(scene: Scene, writeOverlay: (layerId: String, bitmap: Bitmap) -> String): SceneSnapshotDto {
        val layers = scene.layers.map { layer ->
            val t = layer.transform.toDto()
            when (layer) {
                is Layer.VideoCapture -> LayerDto(
                    kind = LayerDto.KIND_VIDEO_CAPTURE,
                    id = layer.id, name = layer.name, visible = layer.visible,
                    transform = t, source = layer.source.toDto(),
                )
                is Layer.Image -> LayerDto(
                    kind = LayerDto.KIND_IMAGE,
                    id = layer.id, name = layer.name, visible = layer.visible,
                    transform = t, overlayPath = writeOverlay(layer.id, layer.bitmap),
                )
            }
        }
        return SceneSnapshotDto(version = 1, layers = layers)
    }

    /** DTO → Scene. [readOverlay] грузит bitmap по пути (null → файл-сирота, слой-картинка пропускается). */
    fun toScene(dto: SceneSnapshotDto, readOverlay: (path: String) -> Bitmap?): Scene {
        val layers = dto.layers.mapNotNull { l ->
            when (l.kind) {
                LayerDto.KIND_VIDEO_CAPTURE -> Layer.VideoCapture(
                    id = l.id, name = l.name, visible = l.visible,
                    transform = l.transform.toModel(),
                    source = l.source?.toModel() ?: CaptureSource.None,
                )
                LayerDto.KIND_IMAGE -> {
                    val path = l.overlayPath ?: return@mapNotNull null
                    val bmp = readOverlay(path) ?: return@mapNotNull null   // сирота/битый файл → пропуск
                    Layer.Image(
                        id = l.id, name = l.name, visible = l.visible,
                        transform = l.transform.toModel(), bitmap = bmp,
                    )
                }
                else -> null   // неизвестный тип слоя (форвард-совместимость новых типов) — пропускаем
            }
        }
        return Scene(layers = layers)
    }

    // ── Конвертеры трансформы ──────────────────────────────────────────────
    private fun LayerTransform.toDto() = TransformDto(scale, cx, cy, alpha, rotation)
    private fun TransformDto.toModel() = LayerTransform(scale, cx, cy, alpha, rotation)

    // ── Конвертеры источника (CaptureSource ↔ DTO) ─────────────────────────
    private fun CaptureSource.toDto(): CaptureSourceDto = when (this) {
        is CaptureSource.Builtin -> CaptureSourceDto(CaptureSourceDto.KIND_BUILTIN, cameraId, displayName)
        is CaptureSource.Uvc -> CaptureSourceDto(CaptureSourceDto.KIND_UVC, deviceId, displayName)
        CaptureSource.Virtual -> CaptureSourceDto(CaptureSourceDto.KIND_VIRTUAL, null, displayName)
        CaptureSource.None -> CaptureSourceDto(CaptureSourceDto.KIND_NONE, null, displayName)
    }

    private fun CaptureSourceDto.toModel(): CaptureSource = when (kind) {
        CaptureSourceDto.KIND_BUILTIN -> CaptureSource.Builtin(id ?: "", displayName.ifEmpty { "Камера" })
        CaptureSourceDto.KIND_UVC -> CaptureSource.Uvc(id ?: "", displayName.ifEmpty { "USB-камера" })
        CaptureSourceDto.KIND_VIRTUAL -> CaptureSource.Virtual
        else -> CaptureSource.None                                   // none + любой неизвестный kind → None
    }
}
