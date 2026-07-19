/**
 * SceneSnapshotRepository — оркестратор персиста ТЕКУЩЕЙ сцены (idea 40 / plans/18 Фаза 0).
 *
 * Связывает три части: SceneSnapshotMapper (Scene↔DTO), ImageOverlayStore (bitmap↔файл),
 * SceneSnapshotStore (JSON в DataStore). Единая точка save/restore для RtmpStreamer.
 *
 * Related: RtmpStreamer (зовёт save/loadOrNull), SceneSnapshotStore (:data:profiles).
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.datastore.SceneSnapshotStore
import com.kriniks.kcam.feature.streaming.scene.Scene
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SceneSnapshotRepository @Inject constructor(
    private val store: SceneSnapshotStore,
    private val overlayStore: ImageOverlayStore,
) {
    // ignoreUnknownKeys — форвард-совместимость (новые поля старым билдом не роняют restore);
    // encodeDefaults — писать и дефолтные значения (стабильный, самодостаточный JSON).
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Сохранить сцену: Scene → снапшот (оверлеи → файлы) → JSON → DataStore; затем чистка сирот-оверлеев. */
    suspend fun save(scene: Scene) {
        runCatching {
            val dto = SceneSnapshotMapper.toSnapshot(scene) { layerId, bmp -> overlayStore.ensureSaved(layerId, bmp) }
            store.saveCurrentSceneJson(json.encodeToString(SceneSnapshotDto.serializer(), dto))
            overlayStore.pruneExcept(dto.layers.mapNotNull { it.overlayPath }.toSet())
        }.onFailure { KLog.e(TAG, "save failed: ${it.message}") }
    }

    /**
     * Восстановить сцену со старта: DataStore → JSON → снапшот → Scene (оверлеи из файлов). null — нечего
     * восстанавливать / ошибка / пустой результат (стартуем с Scene.default(), старт не роняем).
     */
    suspend fun loadOrNull(): Scene? {
        val raw = store.currentSceneJson.first() ?: return null
        return runCatching {
            val dto = json.decodeFromString(SceneSnapshotDto.serializer(), raw)
            SceneSnapshotMapper.toScene(dto) { path -> overlayStore.load(path) }
        }.onFailure { KLog.e(TAG, "loadOrNull failed: ${it.message}") }
            .getOrNull()
            ?.takeIf { it.layers.isNotEmpty() }   // пустой снапшот (порча) → дефолт, а не пустая сцена
    }

    /** Харнес (scene-dump): что реально лежит в сторе — для объективной сверки до/после рестарта. */
    suspend fun persistedJson(): String? = store.currentSceneJson.first()

    companion object { private const val TAG = "SceneSnapshotRepo" }
}
