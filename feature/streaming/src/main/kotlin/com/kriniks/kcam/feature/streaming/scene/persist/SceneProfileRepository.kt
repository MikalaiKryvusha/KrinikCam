/**
 * SceneProfileRepository — набор ИМЕНОВАННЫХ сцен (idea 40 / plans/18 Фаза 1).
 *
 * Расширяет Ф0 (одна текущая сцена в DataStore) до НЕСКОЛЬКИХ именованных сцен в Room-таблице
 * scene_profiles. Автосейв активной сцены, переключение, CRUD (создать/дублировать/переименовать/удалить),
 * разовый сев первой сцены из легаси Ф0-снапшота (не потерять текущую работу Криника).
 *
 * ИЗОЛЯЦИЯ ОВЕРЛЕЕВ: каждая сцена держит PNG-оверлеи в СВОЁМ сабдире `overlays/scene_<id>/` (namespace),
 * иначе одинаковые layerId между сценами коллидят и pruning одной сцены удаляет файлы другой.
 *
 * Оркестрацию состояния сцены (`_scene`) держит RtmpStreamer — здесь ТОЛЬКО данные (Room + DataStore +
 * файлы). Related: SceneProfileDao/ProfilesDataStore (:data:profiles), SceneSnapshotMapper, ImageOverlayStore,
 * SceneSnapshotRepository (легаси Ф0, используется для разового сева), RtmpStreamer.
 *
 * [NOT-TESTED] — проверяется живым CRUD + рестартом на устройстве (Фаза 1 приёмка).
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.datastore.ProfilesDataStore
import com.kriniks.kcam.data.profiles.db.SceneProfileDao
import com.kriniks.kcam.data.profiles.db.SceneProfileEntity
import com.kriniks.kcam.feature.streaming.scene.Scene
import com.kriniks.kcam.feature.streaming.scene.SceneProfileMeta
// plans/18 Ф2 — тип перехода сцены и границы его длительности.
import com.kriniks.kcam.feature.streaming.scene.SceneTransition
import com.kriniks.kcam.feature.streaming.scene.SCENE_TRANSITION_MIN_MS
import com.kriniks.kcam.feature.streaming.scene.SCENE_TRANSITION_MAX_MS
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SceneProfileRepository @Inject constructor(
    private val sceneDao: SceneProfileDao,
    private val dataStore: ProfilesDataStore,
    private val overlayStore: ImageOverlayStore,
    private val legacyRepo: SceneSnapshotRepository,   // разовый сев из Ф0 current_scene_json
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Список сцен для UI (реактивно). */
    fun observeScenes(): Flow<List<SceneProfileMeta>> =
        sceneDao.observeAll().map { rows ->
            rows.map {
                // plans/18 Ф2 — настройки перехода едут в UI вместе с метой (модалка редактирования сцены).
                SceneProfileMeta(
                    id = it.id,
                    name = it.name,
                    transition = SceneTransition.fromStorage(it.transitionType),
                    transitionDurationMs = it.transitionDurationMs,
                )
            }
        }

    /** Активная сцена набора (id). */
    val activeSceneId: Flow<Long?> = dataStore.activeSceneId

    // ── namespace оверлеев конкретной сцены ────────────────────────────────
    private fun ns(sceneId: Long) = "scene_$sceneId"

    // ── сериализация сцены с оверлеями в сабдире сцены ─────────────────────
    private fun encode(sceneId: Long, scene: Scene): String {
        val dto = SceneSnapshotMapper.toSnapshot(scene) { layerId, bmp ->
            overlayStore.ensureSaved(ns(sceneId), layerId, bmp)
        }
        overlayStore.pruneNamespaceExcept(ns(sceneId), dto.layers.mapNotNull { it.overlayPath }.toSet())
        return json.encodeToString(SceneSnapshotDto.serializer(), dto)
    }

    private fun decode(rawJson: String): Scene? = runCatching {
        val dto = json.decodeFromString(SceneSnapshotDto.serializer(), rawJson)
        SceneSnapshotMapper.toScene(dto) { path -> overlayStore.load(path) }
    }.onFailure { KLog.e(TAG, "decode failed: ${it.message}") }
        .getOrNull()
        ?.takeIf { it.layers.isNotEmpty() }

    /** Активный id, разрешённый к реальной строке: DataStore → первая сцена (fallback). */
    private suspend fun resolveActiveId(): Long? {
        val stored = dataStore.activeSceneId.first()
        if (stored != null && sceneDao.getById(stored) != null) return stored
        return sceneDao.firstOrNull()?.id
    }

    /**
     * Гарантировать, что набор непуст и активный id валиден. Зовётся ОДИН РАЗ на старте стримера ДО
     * восстановления. Пустой набор → сеем первую сцену из легаси Ф0-снапшота (текущая работа Криника не
     * теряется) либо из дефолта; затем чистим легаси плоские оверлеи (они уже скопированы в сабдир сцены).
     */
    suspend fun ensureSeeded() {
        if (sceneDao.count() > 0) {
            // Набор есть — только вылечим висячий/пустой активный id.
            val active = dataStore.activeSceneId.first()
            if (active == null || sceneDao.getById(active) == null) {
                sceneDao.firstOrNull()?.let { dataStore.setActiveSceneId(it.id) }
            }
            return
        }
        val seed = legacyRepo.loadOrNull() ?: Scene.default()
        createScene(FIRST_SCENE_NAME, seed)                 // сохранит оверлеи в scene_<id>/ и сделает активной
        overlayStore.pruneExcept(emptySet())                // разовая чистка легаси плоских overlays/*.png
        KLog.i(TAG, "seeded first scene from ${if (legacyRepo.persistedJson() != null) "Ф0 snapshot" else "default"}")
    }

    /** Загрузить активную сцену (для restore на старте / после переключения). */
    suspend fun loadActive(): Scene? {
        val id = resolveActiveId() ?: return null
        if (dataStore.activeSceneId.first() != id) dataStore.setActiveSceneId(id)  // залечить fallback
        val row = sceneDao.getById(id) ?: return null
        return decode(row.snapshotJson)
    }

    /** Автосейв активной сцены (частый, debounce в стримере). Пишет только snapshotJson активной строки. */
    suspend fun saveActive(scene: Scene) {
        val id = resolveActiveId() ?: return
        runCatching { sceneDao.updateSnapshot(id, encode(id, scene), now()) }
            .onFailure { KLog.e(TAG, "saveActive failed: ${it.message}") }
    }

    /** Загрузить сцену по id (для переключения). */
    suspend fun load(id: Long): Scene? = sceneDao.getById(id)?.let { decode(it.snapshotJson) }

    /** Сделать сцену активной. */
    suspend fun setActive(id: Long) = dataStore.setActiveSceneId(id)

    /**
     * Создать новую сцену [name] со сценой-содержимым [scene] и сделать её активной. Двухшагово: сперва
     * вставляем строку (получить autogen id), затем кодируем оверлеи ПОД этим id (namespace) и обновляем
     * snapshotJson. Возвращает новый id.
     */
    suspend fun createScene(name: String, scene: Scene = Scene.default()): Long {
        val ts = now()
        val id = sceneDao.upsert(SceneProfileEntity(id = 0, name = name, snapshotJson = "", createdAt = ts, updatedAt = ts))
        sceneDao.updateSnapshot(id, encode(id, scene), ts)
        setActive(id)
        return id
    }

    /**
     * Дублировать сцену [sourceId]: грузим её содержимое (bitmap'ы оверлеев в память) и создаём новую сцену
     * — createScene пере-кодирует оверлеи в НОВЫЙ сабдир (файлы не шарятся между сценами). Новая = активная.
     */
    suspend fun duplicate(sourceId: Long): Long? {
        val row = sceneDao.getById(sourceId) ?: return null
        val scene = decode(row.snapshotJson) ?: Scene.default()
        return createScene(uniqueName("${row.name} — копия"), scene)
    }

    /** Переименовать сцену. */
    suspend fun rename(id: Long, name: String) {
        sceneDao.rename(id, name.ifBlank { defaultNewName() }, now())
    }

    /**
     * plans/18 Фаза 2 (Криник) — задать ПЕРЕХОД сцены: тип эффекта + длительность. Правится в модалке
     * редактирования сцены рядом с именем. Длительность зажимается в разумные границы, чтобы кривое
     * значение (0 / 10с) не превратило переключение в мельтешение или в застывший экран.
     */
    suspend fun setTransition(id: Long, transition: SceneTransition, durationMs: Int) {
        val clamped = durationMs.coerceIn(SCENE_TRANSITION_MIN_MS, SCENE_TRANSITION_MAX_MS)
        runCatching { sceneDao.updateTransition(id, transition.name, clamped, now()) }
            .onFailure { KLog.e(TAG, "setTransition failed: ${it.message}") }
    }

    /** Настройки перехода сцены [id] (для композитора в момент переключения). Нет строки → дефолт. */
    suspend fun transitionOf(id: Long): Pair<SceneTransition, Int> {
        val row = sceneDao.getById(id) ?: return SceneTransition.FADE to 400
        return SceneTransition.fromStorage(row.transitionType) to row.transitionDurationMs
    }

    /**
     * Удалить сцену: строка + сабдир оверлеев. Если удаляли активную — активной становится первая
     * оставшаяся (или снимаем выбор, если набор опустел — но набор не должен пустеть: гарант ensureSeeded).
     * Возвращает id новой активной сцены (или null, если набор опустел).
     */
    suspend fun delete(id: Long): Long? {
        val wasActive = dataStore.activeSceneId.first() == id
        sceneDao.deleteById(id)
        overlayStore.deleteNamespace(ns(id))
        if (!wasActive) return dataStore.activeSceneId.first()
        val next = sceneDao.firstOrNull()?.id
        if (next != null) dataStore.setActiveSceneId(next) else dataStore.clearActiveSceneId()
        return next
    }

    /** Имя следующей новой сцены по умолчанию — «Сцена N» (N = max существующий +1). */
    suspend fun defaultNewName(): String {
        val names = sceneDao.getAll().map { it.name }
        val maxN = names.mapNotNull { NAME_N.matchEntire(it.trim())?.groupValues?.get(1)?.toIntOrNull() }.maxOrNull() ?: 0
        return "$SCENE_WORD ${maxN + 1}"
    }

    // Уникализировать имя (для дубля) — если такое уже есть, добавляем счётчик.
    private suspend fun uniqueName(base: String): String {
        val names = sceneDao.getAll().map { it.name }.toSet()
        if (base !in names) return base
        var i = 2
        while ("$base $i" in names) i++
        return "$base $i"
    }

    private fun now() = System.currentTimeMillis()

    companion object {
        private const val TAG = "SceneProfileRepo"
        private const val SCENE_WORD = "Сцена"
        private const val FIRST_SCENE_NAME = "$SCENE_WORD 1"
        private val NAME_N = Regex("$SCENE_WORD (\\d+)")
    }
}
