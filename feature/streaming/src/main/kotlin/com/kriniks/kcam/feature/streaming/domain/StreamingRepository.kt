/**
 * StreamingRepository — business logic layer between ViewModel and RtmpStreamer.
 *
 * Loads stream profiles from :data:profiles, validates them, and delegates
 * to RtmpStreamer for the actual encoding + transport.
 *
 * Related: RtmpStreamer, ProfilesRepository (:data:profiles), StreamViewModel
 */

package com.kriniks.kcam.feature.streaming.domain

import android.view.TextureView
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.data.profiles.repository.ProfilesRepository
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "StreamingRepository"

@Singleton
class StreamingRepository @Inject constructor(
    private val rtmpStreamer: RtmpStreamer,
    private val profilesRepository: ProfilesRepository,
) {
    val streamState: StateFlow<StreamState> = rtmpStreamer.state
    val allProfiles: Flow<List<StreamProfile>> = profilesRepository.observeAllProfiles()
    val enabledProfiles: Flow<List<StreamProfile>> = profilesRepository.observeEnabledProfiles()

    /** Current manual video rotation in degrees (0/90/180/270) — for the rotation menu UI. */
    val videoRotation: StateFlow<Int> = rtmpStreamer.videoRotation

    /** Set the manual video rotation (preview + stream aspect). No-op while streaming. */
    fun setVideoRotation(degrees: Int): Boolean = rtmpStreamer.setVideoRotation(degrees)

    // ── Мульти-источники (Idea 19) ──────────────────────────────────────────
    /** Текущая сцена (список слоёв) — для панели «Слои». */
    val scene: StateFlow<com.kriniks.kcam.feature.streaming.scene.Scene> = rtmpStreamer.scene

    /**
     * Добавить тестовый PNG-оверлей (первый заход, Q1=A): генерим бренд-бейдж и кладём слоем поверх.
     * Доказывает пайплайн компоновки без файлов/SAF. [id]/[name] задаёт вызывающий (VM генерит id).
     */
    fun addTestOverlay(id: String, name: String) {
        val bmp = com.kriniks.kcam.feature.streaming.scene.OverlayTestImage.render()
        rtmpStreamer.addImageOverlay(id, name, bmp)
    }

    /** Добавить слой-картинку с уже готовым (декодированным/вписанным) [bitmap] — реальный PNG из файла. */
    fun addImageOverlay(id: String, name: String, bitmap: android.graphics.Bitmap) =
        rtmpStreamer.addImageOverlay(id, name, bitmap)

    fun removeLayer(id: String) = rtmpStreamer.removeLayer(id)
    fun toggleLayerVisible(id: String) = rtmpStreamer.toggleLayerVisible(id)
    fun moveLayerUp(id: String) = rtmpStreamer.moveLayerUp(id)
    fun moveLayerDown(id: String) = rtmpStreamer.moveLayerDown(id)
    // interview_006 Q3: [rotation] — поворот СОДЕРЖИМОГО слоя внутри сцены (0/90/180/270 CW).
    fun setLayerTransform(id: String, scale: Float, cx: Float, cy: Float, alpha: Float = 1f, rotation: Int = 0) =
        rtmpStreamer.setLayerTransform(id, scale, cx, cy, alpha, rotation)

    /**
     * plans/03 (жесты слоёв) — применить ИНКРЕМЕНТАЛЬНУЮ дельту жеста к слою [id]: [dCx],[dCy] — сдвиг
     * центра в долях кадра; [zoom] — множитель масштаба; [dRotation] — дельта угла содержимого (°).
     *
     * ПИВОТ (Криник 2026-07-06: «в фоторедакторах вращается по-другому, интуитивнее»): масштаб и
     * поворот происходят вокруг [pivotX],[pivotY] — точки между пальцами (центроид жеста) в
     * scene-координатах [0,1]. Так слой «держится за пальцы», а не орбитит вокруг своего центра.
     * Если пивот не задан (NaN — путь харнеса CMD gesture-*), крутим/масштабируем вокруг центра слоя.
     * Аспект-коррекция (a=16/9) — чтобы поворот был рИгидным в ПИКСЕЛЯХ, а не в неквадратных clip-осях.
     *
     * Читает трансформу синхронно из `scene.value`, применяет, клампит (§3.4) и пишет назад.
     */
    fun nudgeLayer(
        id: String, dCx: Float, dCy: Float, zoom: Float, dRotation: Float,
        pivotX: Float = Float.NaN, pivotY: Float = Float.NaN,
    ) {
        val layer = scene.value.layers.firstOrNull { it.id == id } ?: return
        val t = layer.transform
        val newScale = (t.scale * zoom).coerceIn(0.05f, 4.0f)
        val newRot = ((((t.rotation + dRotation) % 360f) + 360f) % 360f).toInt()

        var cx = t.cx
        var cy = t.cy
        // Пивот-якорь: сдвигаем центр так, чтобы точка под центроидом пальцев осталась на месте при
        // масштабе/повороте. Считаем в аспект-скорректированном пространстве (x·a), где поворот рИгиден.
        if (!pivotX.isNaN() && !pivotY.isNaN() && (zoom != 1f || dRotation != 0f)) {
            val a = 16f / 9f
            val px = pivotX * a
            val py = pivotY
            val vx = cx * a - px
            val vy = cy - py
            // Поворот CW на dRotation (система Y-вниз, как у содержимого слоя: +° = по часовой).
            val rad = Math.toRadians(dRotation.toDouble())
            val cos = kotlin.math.cos(rad).toFloat()
            val sin = kotlin.math.sin(rad).toFloat()
            val sx = vx * zoom
            val sy = vy * zoom
            val rx = sx * cos - sy * sin
            val ry = sx * sin + sy * cos
            cx = (px + rx) / a
            cy = py + ry
        }
        // Плюс трансляция центроида (перетаскивание) — уже в scene-долях (маппинг поворота холста в UI).
        // idea 35: клампим шире (слой МОЖЕТ уезжать за кадр — наезды/обрезка, если оторван от снапа).
        var newCx = (cx + dCx).coerceIn(-0.5f, 1.5f)
        var newCy = (cy + dCy).coerceIn(-0.5f, 1.5f)

        // plans/03 S6 + idea 35 — СНАП для удобной компоновки (Криник): центр холста (0.5) и КРАЯ по
        // краю КАДРА ЗАПОДЛИЦО (вариант A) — прилипает КРАЙ слоя, слой целиком в кадре. Цели зависят от
        // ПОЛУРАЗМЕРА слоя (аспект+scale): левый край флеш при cx=halfW, правый при cx=1-halfW, центр 0.5.
        // Мягко (порог), с tear-off. Угол — к кратным 90°.
        val aFit = layerAspect(layer) / (16f / 9f)
        val halfW = if (aFit <= 1f) newScale * aFit / 2f else newScale / 2f
        val halfH = if (aFit <= 1f) newScale / 2f else newScale / aFit / 2f
        newCx = snapTo(newCx, SNAP_POS, halfW, 0.5f, 1f - halfW)
        newCy = snapTo(newCy, SNAP_POS, halfH, 0.5f, 1f - halfH)
        val nearest90 = ((Math.round(newRot / 90f) * 90) % 360 + 360) % 360
        val snappedRot = if (kotlin.math.abs(newRot - Math.round(newRot / 90f) * 90) <= SNAP_ANGLE) nearest90 else newRot

        rtmpStreamer.setLayerTransform(id, newScale, newCx, newCy, t.alpha, snappedRot)
    }

    private companion object {
        const val SNAP_POS = 0.025f   // порог позиционного снапа (доля кадра)
        const val SNAP_ANGLE = 5      // порог углового снапа к 90° (градусы, interview_007 Q3)
    }

    /** Мягкий снап: если [v] в пределах [th] от одной из [targets] — возвращает цель, иначе [v]. */
    private fun snapTo(v: Float, th: Float, vararg targets: Float): Float {
        for (t in targets) if (kotlin.math.abs(v - t) < th) return t
        return v
    }
    fun capturePhoto() = rtmpStreamer.capturePhoto()

    /** bug 32 — аспект источника камеры (ширина/высота) для рендера без растяга. */
    fun setCameraAspect(aspect: Float) {
        if (aspect > 0f) lastCameraAspect = aspect   // idea 35 — кешируем для адаптивного снапа камера-слоя
        rtmpStreamer.setCameraAspect(aspect)
    }

    // idea 35 — последний известный аспект камеры-источника (для снапа краёв камера-слоя по его размеру).
    @Volatile private var lastCameraAspect = 16f / 9f

    // idea 35 — аспект (ширина/высота) конкретного слоя: картинка = аспект bitmap, камера = cameraAspect.
    private fun layerAspect(layer: com.kriniks.kcam.feature.streaming.scene.Layer): Float = when (layer) {
        is com.kriniks.kcam.feature.streaming.scene.Layer.Image ->
            if (layer.bitmap.height > 0) layer.bitmap.width.toFloat() / layer.bitmap.height else 16f / 9f
        else -> lastCameraAspect
    }

    /** bug 19 — ориентация сенсора камеры (+ зеркало фронталки) для выпрямления в композиторе. */
    fun setCameraOrientation(degrees: Int, mirror: Boolean) = rtmpStreamer.setCameraOrientation(degrees, mirror)

    // ── Idea 10 — virtual stream platform (record to file instead of RTMP) ──
    // Dev toggle: when ON, "Go Live" records the encoder output to a file instead of pushing RTMP.
    @Volatile var virtualStreamToFile: Boolean = false
        private set
    fun setVirtualStreamToFile(enabled: Boolean) { virtualStreamToFile = enabled }

    val isRecording: Boolean get() = rtmpStreamer.isRecording

    // ── Idea 22 — удобства для debug-команд автоматизатора (harness) ─────────
    /**
     * «Go Live» для харнеса: если включён stream-to-file — пишем энкодер в MP4 (вернёт путь), иначе —
     * пушим RTMP по [profile] (в харнесе обычно не используем). [profile] задаёт разрешение/битрейт
     * (по умолчанию — дефолтный профиль). Вызывается из CMD-receiver автоматизатора.
     */
    fun goLiveHarness(profile: StreamProfile = StreamProfile()): String? =
        if (virtualStreamToFile) rtmpStreamer.startRecordToFile(profile)
        else { rtmpStreamer.startStream(profile); null }

    /** Остановить активный вывод (запись или стрим). */
    fun stopAll() {
        if (rtmpStreamer.isRecording) rtmpStreamer.stopRecordToFile() else rtmpStreamer.stopStream()
    }
    fun startRecordToFile(profile: StreamProfile): String? = rtmpStreamer.startRecordToFile(profile)
    fun stopRecordToFile() = rtmpStreamer.stopRecordToFile()

    /**
     * Start the GL preview pipeline (наш композитор) and display it on [textureView].
     * Композитор сам откроет камеру-слой через CameraOpener, когда его поверхность готова.
     */
    fun startPreview(textureView: TextureView) {
        rtmpStreamer.startPreview(textureView)
    }

    /**
     * Phase 3 — задать/снять источник камеры-слоя (USB/встроенная/виртуальная); null = камеры нет.
     * Отрыв камеры ничего не подменяет: композитор продолжает рисовать сцену (стрим/запись живут).
     */
    fun setCameraOpener(opener: RtmpStreamer.CameraOpener?) {
        rtmpStreamer.setCameraOpener(opener)
    }

    fun stopPreview() {
        rtmpStreamer.stopPreview()
    }

    fun startStream(profile: StreamProfile): Boolean = startStream(listOf(profile))

    /** plans/07 — МУЛЬТИСТРИМ: запуск на несколько платформ разом (профили с непустым ключом). */
    fun startStream(profiles: List<StreamProfile>): Boolean {
        val valid = profiles.filter { it.streamKey.isNotBlank() }
        if (valid.isEmpty()) {
            KLog.w(TAG, "startStream: нет профилей с ключом (all blank)")
            return false
        }
        if (valid.size < profiles.size) {
            KLog.w(TAG, "startStream: пропущены профили с пустым ключом (${profiles.size - valid.size})")
        }
        return rtmpStreamer.startStream(valid)
    }

    fun stopStream() = rtmpStreamer.stopStream()

    suspend fun saveProfile(profile: StreamProfile) = profilesRepository.saveProfile(profile)

    suspend fun deleteProfile(profile: StreamProfile) = profilesRepository.deleteProfile(profile)
}
