/**
 * SceneSnapshotMapperTest — JVM-юниты round-trip персиста сцены (idea 40 / plans/18 Фаза 0).
 *
 * Проверяет, что источники / трансформы / z-order / видимость переживают Scene→DTO→JSON→DTO→Scene 1:1,
 * а битые/неизвестные слои мягко пропускаются. Image-слои (Bitmap = Android) в pure-JVM не создаём —
 * их путь bitmap↔файл проверяется живьём на харнесе (см. plans/18_phase0_mvp.md, приёмка S5/S7).
 *
 * Запуск: JAVA_HOME=<JBR> ./gradlew :feature:streaming:testDebugUnitTest
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import com.kriniks.kcam.feature.streaming.scene.CaptureSource
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.LayerTransform
import com.kriniks.kcam.feature.streaming.scene.Scene
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneSnapshotMapperTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun roundTrip_videoCaptureLayers_preservesSourceTransformOrderVisibility() {
        val scene = Scene(
            listOf(
                Layer.VideoCapture(
                    id = "camera", name = "База", visible = true,
                    transform = LayerTransform(scale = 1f, cx = 0.5f, cy = 0.5f, alpha = 1f, rotation = 0),
                    source = CaptureSource.Uvc("uvc-42", "Piko+"),
                ),
                Layer.VideoCapture(
                    id = "camera_1", name = "PiP", visible = false,
                    transform = LayerTransform(scale = 0.3f, cx = 0.8f, cy = 0.2f, alpha = 0.9f, rotation = 90),
                    source = CaptureSource.Builtin("1", "Селфи"),
                ),
                Layer.VideoCapture(id = "camera_2", source = CaptureSource.Virtual),
                Layer.VideoCapture(id = "camera_3", source = CaptureSource.None),
            ),
        )

        // Image-слоёв нет → лямбды работы с bitmap не должны вызываться.
        val dto = SceneSnapshotMapper.toSnapshot(scene) { _, _ -> error("no image layers expected") }
        val encoded = json.encodeToString(SceneSnapshotDto.serializer(), dto)
        val decoded = json.decodeFromString(SceneSnapshotDto.serializer(), encoded)
        val restored = SceneSnapshotMapper.toScene(decoded) { error("no image layers expected") }

        assertEquals(scene.layers.size, restored.layers.size)
        scene.layers.forEachIndexed { i, orig ->
            val o = orig as Layer.VideoCapture
            val r = restored.layers[i] as Layer.VideoCapture
            assertEquals("id[$i]", o.id, r.id)
            assertEquals("name[$i]", o.name, r.name)
            assertEquals("visible[$i]", o.visible, r.visible)
            assertEquals("transform[$i]", o.transform, r.transform)   // data class equals по значениям
            assertEquals("source[$i]", o.source, r.source)
        }
    }

    @Test
    fun toScene_skipsImageLayerWithMissingFile() {
        val dto = SceneSnapshotDto(
            layers = listOf(
                LayerDto(kind = LayerDto.KIND_IMAGE, id = "overlay_1", name = "Логотип", overlayPath = "/nope/gone.png"),
                LayerDto(
                    kind = LayerDto.KIND_VIDEO_CAPTURE, id = "camera", name = "База",
                    source = CaptureSourceDto(CaptureSourceDto.KIND_VIRTUAL),
                ),
            ),
        )
        // readOverlay = null (файл-сирота) → Image-слой пропускается, камера остаётся.
        val scene = SceneSnapshotMapper.toScene(dto) { null }
        assertEquals(1, scene.layers.size)
        assertTrue(scene.layers[0] is Layer.VideoCapture)
    }

    @Test
    fun toScene_skipsUnknownLayerKind() {
        val dto = SceneSnapshotDto(
            layers = listOf(
                LayerDto(kind = "future_browser_layer", id = "x", name = "?"),
                LayerDto(kind = LayerDto.KIND_VIDEO_CAPTURE, id = "camera", name = "База"),
            ),
        )
        val scene = SceneSnapshotMapper.toScene(dto) { null }
        assertEquals(1, scene.layers.size)   // неизвестный тип пропущен
    }
}
