/**
 * RtmpStreamer — RTMP streaming engine using RootEncoder's RtmpStream.
 *
 * Phase 3 (interview_006): the ONLY video pipeline is our own GL compositor
 * ([CompositorVideoSource], «мобильный OBS»). The camera is an ordinary LAYER inside the
 * compositor's scene — never a "special" base VideoSource. The legacy path (camera as the base
 * source / SurfaceFilterRender filters / standby source swaps / RotatableSource) is REMOVED.
 *
 * Why RtmpStream (not RtmpCamera1): RtmpCamera1 internally opens Camera1/Camera2 API,
 * which crashes when a USB UVC camera is already in use. RtmpStream accepts any VideoSource,
 * so we inject our compositor which renders the whole scene into the encoder's SurfaceTexture.
 *
 * Rotation model (interview_006, Krinik's decision):
 *   • The SCENE is always composed on a logical 16:9 canvas and knows NOTHING about rotation.
 *   • Global CANVAS rotation (0/90/180/270) lives ABOVE scenes (the pink button top-right):
 *     it rotates the whole composed frame; 90/270 → the OUTPUT becomes a true 9:16 portrait
 *     (encoder canvas 1080×1920). Layers rotate together with the canvas (composition preserved).
 *   • Each layer additionally has its own CONTENT rotation inside the scene (LayerTransform.rotation,
 *     Photoshop-like) — e.g. to straighten a "lying" device camera.
 *   • Physical cameras deliver their RAW stream; ALL rotation is done by the compositor.
 *
 * Lifecycle:
 *   setCameraOpener(opener)    — tell the compositor HOW to open the camera layer's producer
 *   startPreview(textureView)  — attach UI TextureView; compositor + GL start
 *   stopPreview()              — detach when UI is gone
 *   startStream(profile)       — prepares encoder + connects RTMP
 *   stopStream()               — graceful stop
 *
 * Camera dropout: nothing is swapped — the compositor keeps rendering the scene (black base +
 * remaining layers), so RTMP stays alive AND file recording keeps its MediaMuxer intact (the old
 * standby source-swap корёжил MP4 при записи — теперь сам класс проблемы исчез).
 */

package com.kriniks.kcam.feature.streaming.rtmp

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.provider.MediaStore
import android.view.TextureView
import java.io.File
import com.pedro.common.ConnectChecker
// Профиль кодера — библиотечный enum кодеков RootEncoder; домен-модель VideoCodec маппится в него.
import com.pedro.common.VideoCodec as PedroVideoCodec
import com.pedro.library.base.recording.RecordController
import java.lang.ref.WeakReference
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.multiple.MultiStream
import com.pedro.library.multiple.MultiType
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.AudioChannelMode
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.data.profiles.model.VideoCodec
import com.kriniks.kcam.feature.streaming.gl.CompositorLayer
import com.kriniks.kcam.feature.streaming.gl.CompositorVideoSource
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.OutputPhase
import com.kriniks.kcam.feature.streaming.model.OutputStatus
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.LayerTransform
import com.kriniks.kcam.feature.streaming.scene.Scene
import com.kriniks.kcam.feature.streaming.scene.StandbyImage
import com.kriniks.kcam.feature.streaming.scene.persist.SceneSnapshotRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "RtmpStreamer"

// idea 40 / plans/18 Ф0 — окно debounce автосейва сцены: работа не теряется, но записи редки (жест
// трансформы шлёт правку каждый кадр — сохраняем только после паузы ~0.4с).
private const val SCENE_AUTOSAVE_DEBOUNCE_MS = 400L

// idea 37 — адаптивный битрейт: пол деградации (ниже не опускаемся — картинка теряет смысл),
// шаг снижения при затыке канала и шаг плавного восстановления к целевому (проценты от значения).
private const val ADAPTIVE_FLOOR_BPS = 1_000_000
private const val ADAPTIVE_DECREASE_PERCENT = 20
private const val ADAPTIVE_RECOVER_PERCENT = 10
// Период тикера телеметрии эфира; шаг адаптера — каждый второй тик (2с), чтобы не дёргать энкодер.
private const val LIVE_TICK_MS = 1000L

@Singleton
class RtmpStreamer @Inject constructor(
    @ApplicationContext private val context: Context,
    // idea 40 / plans/18 Ф0 — персист текущей сцены (restore на старте + автосейв).
    private val snapshotRepo: SceneSnapshotRepository,
) {
    private val _state = MutableStateFlow<StreamState>(StreamState.Idle)
    val state: StateFlow<StreamState> = _state.asStateFlow()

    // plans/07 — движок МУЛЬТИСТРИМА: MultiStream (extends StreamBase, тот же превью/энкодер-API, что и
    // RtmpStream) раздаёт ОДИН энкодер на N RTMP-выходов. S1: используем как одно-выходной (index 0),
    // мультивыход включим в S2-S4. Имя поля оставлено `rtmpStream` для минимума churn.
    private var rtmpStream: MultiStream? = null

    // plans/07 — сколько RTMP-выходов держит MultiStream (потолок платформ одновременно). Стартуем
    // только активные; массив ConnectChecker'ов такого размера задаёт число слотов.
    private val maxRtmpOutputs = 4
    // Индексы РТМП-выходов, реально запущенных сейчас (живые ИЛИ реконнектящиеся) — для корректной
    // остановки и решения «упал последний выход → гасим энкодер». Failed-выход отсюда убирается (S3).
    private val activeRtmpOutputs = mutableSetOf<Int>()

    // ── idea 37 — телеметрия эфира + адаптивный битрейт ─────────────────
    // Тикер раз в секунду ПОКА эфир жив (самозавершается на Idle/Error): тикает durationMs,
    // поллит hasCongestion() по живым выходам, каждый второй тик — шаг адаптера битрейта.
    private var liveTicker: Job? = null
    private var streamStartedAtMs = 0L
    // Текущий/целевой битрейт видео (бит/с). target = из профиля; current ходит вниз при затыке
    // канала и плавно восстанавливается к target на свободном канале (setVideoBitrateOnFly).
    private var currentVideoBitrateBps = 0
    private var targetVideoBitrateBps = 0
    // Адаптив включён, если ВСЕ активные профили эфира просят его (энкодер один на все выходы —
    // консервативно: выключил у одного = выключен весь; контроль у стримера).
    private var adaptiveBitrateEnabled = true
    // Debug-харнес (CMD simulate-congestion): заставить адаптер видеть затык без реальной плохой
    // сети — единственный способ наблюдаемо принять петлю деградации/восстановления на полигоне.
    @Volatile private var simulatedCongestion = false

    // plans/09 S2 — статус КАЖДОГО RTMP-выхода по индексу (имя платформы, фаза, битрейт, попытки
    // реконнекта). Источник правды для агрегата StreamState и для per-output UI («Twitch упал, YouTube
    // в эфире»). Пишется из per-output ConnectChecker'ов; читается recomputeAggregateState().
    private val outputStates = mutableMapOf<Int, OutputStatus>()

    // plans/09 S4 — потолок попыток авто-реконнекта одного выхода; дальше выход → Failed (изоляция S3).
    private val maxReconnectAttempts = 5
    // Weak ref so we don't leak the TextureView; used to restore preview after startStream
    private var lastPreviewTextureView: WeakReference<TextureView>? = null

    // Guard flag: prevents preview/source churn during startStream() critical window.
    // stopPreview() briefly restarts GL, and UI LaunchedEffects can react mid-setup.
    @Volatile private var isStreamSetupInProgress = false

    // ── Canvas rotation (interview_006) ──────────────────────────────────────
    // Global rotation ABOVE scenes, degrees CW (0/90/180/270). Two effects, applied together:
    //   1. compositorSource.setCanvasRotation(deg) — the compositor rotates the whole composed frame.
    //   2. The encoder/GL canvas is RESIZED to the rotated aspect: 0/180 → landscape (1920×1080),
    //      90/270 → portrait (1080×1920) — so the outgoing stream is a TRUE 9:16, not letterboxed.
    // Rotation can only change while NOT streaming (changing resolution on a live RTMP connection
    // breaks YouTube — researched in ideas/06_video_rotation.md). Re-applied on every GL (re)init.
    private val _videoRotation = MutableStateFlow(0)
    val videoRotation: StateFlow<Int> = _videoRotation.asStateFlow()

    // ── Scene (Idea 19/25) ───────────────────────────────────────────────────
    // Рабочая область: упорядоченный список слоёв (z снизу вверх), камера — обычный слой.
    // UI наблюдает StateFlow; правки через методы ниже, каждая переприменяет слои композитору.
    private val _scene = MutableStateFlow(Scene.default())
    val scene: StateFlow<Scene> = _scene.asStateFlow()

    // ── НАШ GL-композитор — ЕДИНСТВЕННЫЙ базовый VideoSource (Phase 3) ───────
    // Рисует все слои сцены (чёрная база + камера-OES + картинки) в один кадр для энкодера/превью.
    private val compositorSource = CompositorVideoSource()

    init {
        // Когда композитор готовит OES-поверхность КОНКРЕТНОГО слоя-камеры (по id) — открываем туда
        // продюсера ЭТОГО слоя (Camera2/USB/виртуалка через CameraOpener из :app); null = закрыть его.
        compositorSource.onCameraSurfaceReady = { layerId, st -> onCameraLayerSurfaceReady(layerId, st) }
        // plans/sourses_timeout — бренд-заглушка «нет сигнала» как СОСТОЯНИЕ слоя-камеры: композитор
        // сам рисует её В КВАДРАТЕ слоя, когда у камеры нет свежих кадров (hold→фейд). Не Compose-оверлей.
        // Два слоя: заголовок (пульсирует) + подпись (статична).
        compositorSource.setStandbyBitmaps(StandbyImage.title(), StandbyImage.body())
    }

    /** Открывает/закрывает камеру в SurfaceTexture слоя-камеры. Реализуется в :app (держит AUSBC/Camera2). */
    interface CameraOpener {
        /**
         * bug 58 — стабильный ключ ФИЗИЧЕСКОГО устройства-источника: одно устройство = один ключ
         * ("uvc:<id>", "builtin:<cameraId>"). null = источник шарится без конфликта (виртуалка рисует
         * свой паттерн в свою поверхность). [setCameraOpener] не даёт открыть один exclusive-ключ на
         * двух слоях одновременно (второй open того же устройства = нативный краш/зависание).
         */
        val sourceKey: String? get() = null
        /**
         * bug 64 — жив ли продюсер (камера открыта и отдаёт кадры). false = отвалился: другое приложение
         * (Instagram/камера) забрало камеру, пока KrinikCam был свёрнут. На ВОЗВРАТЕ такие переоткрываем
         * ([reopenDeadCameras]); живые (UVC/виртуалка/работающая Camera2) НЕ трогаем. По умолчанию — жив.
         */
        val isAlive: Boolean get() = true
        fun open(surfaceTexture: SurfaceTexture)
        fun close()
    }
    // Мульти-источники (idea 21 Фаза B): продюсер/поверхность/тип — PER СЛОЙ-КАМЕРУ (по id слоя).
    private val cameraOpeners = HashMap<String, CameraOpener>()
    private val cameraLayerSurfaces = HashMap<String, SurfaceTexture>()
    // Bug 31 — тип последнего ОТКРЫТОГО продюсера per слой. На реконнекте пересоздаём поверхность слоя.
    private val lastOpenedKinds = HashMap<String, String>()
    // bug 58 / ШАРИНГ ФИДА — ФИЗ-ключ источника per слой (из опенера, «uvc:<id>»/«builtin:<id>»; null=
    // виртуалка/нет источника) и вычисленная карта «слой X зеркалит слой Y» (layerId → mirrorOf; значение
    // null = слой ПЕРВИЧНЫЙ, держит своего продюсера). Обновляются в setCameraOpener/applySceneLayers.
    private val layerSourceKeys = HashMap<String, String>()
    private val cameraLayerMirrors = HashMap<String, String?>()
    // bug 58/UVC-шаринг — layerId, чей опенер РЕАЛЬНО открыл продюсера (owns). Закрывать (opener.close())
    // разрешаем ТОЛЬКО их: опенер ЗЕРКАЛА продюсера не открывал, а для UVC он делит ФИЗ-объект камеры с
    // первичным — его close() убил бы первичного (гас весь фид). Так гасим только настоящего владельца.
    private val openedLayers = HashSet<String>()

    /** bug 32 — опенер слоя [layerId] сообщает аспект источника; композитор рисует камеру без растяга. */
    fun setCameraAspect(layerId: String, aspect: Float) = compositorSource.setCameraAspect(layerId, aspect)

    /** bug 19 — ориентация сенсора источника слоя [layerId] (+ зеркало фронталки) для выпрямления. */
    fun setCameraOrientation(layerId: String, degrees: Int, mirror: Boolean) =
        compositorSource.setCameraOrientation(layerId, degrees, mirror)

    /**
     * :app сообщает продюсера ДЛЯ КОНКРЕТНОГО слоя-камеры [layerId] (или null при отключении источника
     * этого слоя). Каждый слой независим: у него своя SurfaceTexture (по id) и свой продюсер.
     */
    fun setCameraOpener(layerId: String, opener: CameraOpener?) {
        val old = cameraOpeners[layerId]
        if (old === opener) return
        if (opener == null) cameraOpeners.remove(layerId) else cameraOpeners[layerId] = opener
        // bug 58 / ШАРИНГ ФИДА — запоминаем ФИЗ-ключ источника слоя (из опенера) и пересчитываем карту
        // первичный/зеркало: слои с ОДИНАКОВЫМ ключом делят ОДНОГО продюсера (первый в порядке сцены —
        // первичный, держит открытие; остальные ЗЕРКАЛЯТ его слот, рисуя тот же кадр своей трансформой).
        // Так один источник кладётся на несколько слоёв БЕЗ второго open того же устройства (краш bug 58 снят).
        if (opener?.sourceKey == null) layerSourceKeys.remove(layerId) else layerSourceKeys[layerId] = opener.sourceKey!!
        applySceneLayers()  // обновит cameraLayerMirrors под новый набор ключей
        // plans/sourses_timeout — заморозка/разморозка последнего кадра ЭТОГО слоя при удалении/возврате источника.
        if (opener == null) compositorSource.enterCameraStandby(layerId) else compositorSource.exitCameraStandby(layerId)
        scope.launch {
            // Закрываем СТАРОГО продюсера этого слоя, ТОЛЬКО если он был реально ОТКРЫТ (owned): опенер
            // зеркала продюсера не открывал, а для UVC делит ФИЗ-объект с первичным → его close() убил бы
            // первичного. Гасим только настоящего владельца (openedLayers).
            if (openedLayers.remove(layerId)) runCatching { old?.close() }
            // Открываем ТОЛЬКО если слой ПЕРВИЧНЫЙ (не зеркало): зеркало своего продюсера не держит — его
            // слот рисует первичный (шаринг). Первичный слот открывается ещё и по колбэку onCameraSurfaceReady
            // (создание слота композитором); здесь — для СМЕНЫ источника на уже существующем слоте (без нового колбэка).
            if (opener != null && cameraLayerMirrors[layerId] == null) {
                // Bug 31 + реконнект: при ЛЮБОМ повторном открытии продюсера этого слоя даём СВЕЖУЮ
                // поверхность (чистый BufferQueue) — recreateCameraSurface(layerId). Первое открытие идёт
                // в поверхность из слота напрямую (она уже свежая).
                val kind = opener::class.simpleName ?: "opener"
                val reopen = lastOpenedKinds[layerId] != null
                lastOpenedKinds[layerId] = kind
                if (reopen) {
                    compositorSource.recreateCameraSurface(layerId) // reopen из onCameraSurfaceReady (там пометим owned)
                } else {
                    cameraLayerSurfaces[layerId]?.let { openedLayers.add(layerId); opener.open(it) }
                }
            }
        }
    }

    // Колбэк от композитора: у слоя-камеры [layerId] появилась/исчезла SurfaceTexture. Открыть/закрыть его продюсера.
    private fun onCameraLayerSurfaceReady(layerId: String, st: SurfaceTexture?) {
        if (st != null) cameraLayerSurfaces[layerId] = st else cameraLayerSurfaces.remove(layerId)
        val opener = cameraOpeners[layerId] ?: return
        // Зеркало продюсера не держит — его опенер НЕ открываем и НЕ закрываем (для UVC он делит ФИЗ-объект
        // с первичным; close() зеркала при переходе первичный→зеркало убил бы первичного — фид гас). Слот
        // зеркала композитор и так удаляет; сюда с null приходит именно этот случай.
        if (cameraLayerMirrors[layerId] != null) return
        scope.launch {
            if (st != null) { openedLayers.add(layerId); opener.open(st) }
            else if (openedLayers.remove(layerId)) opener.close()
        }
    }

    /**
     * bug 64 (Криник) — другое приложение (Instagram/камера) забрало камеру, пока KrinikCam был свёрнут →
     * продюсер отвалился (`onDisconnected`), и на ВОЗВРАТЕ в приложение он сам не переоткрывается (поверхность
     * превью в фоне не пересоздавалась → TextureView-путь reopen не срабатывает). Здесь на onResume переоткрываем
     * ОТВАЛИВШИЕСЯ камеры первичных слоёв. `recreateCameraSurface` держит последний кадр в снапшоте → без
     * чёрного/заглушки. Живые openers (UVC/виртуалка/работающая Camera2, `isAlive==true`) НЕ трогаем — без churn.
     */
    fun reopenDeadCameras() {
        _scene.value.layers.filterIsInstance<Layer.VideoCapture>().forEach { layer ->
            val opener = cameraOpeners[layer.id] ?: return@forEach
            if (cameraLayerMirrors[layer.id] == null && !opener.isAlive) {
                KLog.i(TAG, "reopenDeadCameras: слой ${layer.id} — камера отобрана другим приложением, переоткрываю")
                compositorSource.recreateCameraSurface(layer.id)
            }
        }
    }

    // Гарантировать, что базой энкодера выставлен композитор (единственный режим, Phase 3).
    private fun ensureCompositorBase() {
        runCatching { ensureStream().changeVideoSource(compositorSource) }
            .onFailure { KLog.e(TAG, "ensureCompositorBase: changeVideoSource failed", it) }
    }

    // Base (landscape-reference) encoder size used for the live preview before a stream profile is
    // applied. rotatedDims() swaps it to portrait for 90/270.
    private val basePreviewWidth = 1920
    private val basePreviewHeight = 1080

    // Размер холста энкодера для заданного поворота: 90/270 свапают ширину/высоту (портрет 9:16).
    private fun rotatedDims(w: Int, h: Int, deg: Int): Pair<Int, Int> =
        if (deg == 90 || deg == 270) h to w else w to h

    // Singleton lives for app lifetime — scope is appropriate here.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // idea 40 / plans/18 Ф0 — персист сцены. ОТДЕЛЬНЫЙ init ПОСЛЕ [scope] (init-блоки и инициализаторы
    // полей исполняются в порядке объявления — здесь scope уже создан, в отличие от init выше).
    init { startScenePersistence() }

    /**
     * plans/09 S2 — ФАБРИКА per-output ConnectChecker'а. Каждый RTMP-выход `i` получает СВОЙ инстанс,
     * замыкающий свой [index] → события (`connected`/`failed`/`bitrate`/`auth`) атрибутируются к
     * конкретной платформе. Сверено байткодом 2.4.7: `MultiStream` строит `rtmpClients[i] =
     * RtmpClient(checker[i])` в цикле по массиву — значит выход i зовёт именно checker[i].
     */
    private fun makeConnectChecker(index: Int) = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {
            // bug 37 №3 — URL в лог только с редакцией ключа (полный уходил в logcat + FileLogger).
            KLog.i(TAG, "RTMP[$index] connecting → ${redactRtmpUrl(url)}")
            updateOutput(index) { it.copy(phase = OutputPhase.Connecting) }
            recomputeAggregateState()
        }

        override fun onConnectionSuccess() {
            KLog.i(TAG, "RTMP[$index] connected ✓")
            // Успех выхода: сбрасываем счётчик реконнекта (S4), фаза Live, причина снята.
            updateOutput(index) { it.copy(phase = OutputPhase.Live, attempt = 0, reason = null) }
            isStreamSetupInProgress = false
            recomputeAggregateState()
        }

        override fun onConnectionFailed(reason: String) {
            KLog.e(TAG, "RTMP[$index] connection failed: $reason")
            // S3/S4: сбой изолирован по индексу — сначала пробуем реконнект с бэкоффом, живые не трогаем.
            scope.launch { onOutputFailed(index, reason, retriable = true) }
        }

        override fun onNewBitrate(bitrate: Long) {
            // Битрейт КОНКРЕТНОГО выхода. Аудио-only (нет видеокадров) ≈132 kbps; полное видео 2-6 Mbps.
            val kbps = (bitrate / 1000).toInt()
            // bug 53 — сглаживаем ПОКАЗАНИЕ (EMA), чтобы плашка не мерцала/не «плясала» шириной от
            // посекундных скачков. На реальное кодирование не влияет — только на отображаемое число.
            updateOutput(index) { it.copy(bitrateKbps = if (it.bitrateKbps == 0) kbps else (it.bitrateKbps * 3 + kbps) / 4) }
            // Дёшево обновляем агрегат без полного пересчёта фаз: если в эфире — освежаем список выходов.
            // idea 37 — битрейт агрегата = СУММА живых выходов (честный суммарный аплинк стримера).
            val current = _state.value
            if (current is StreamState.Live) {
                val outs = outputStates.values.sortedBy { it.index }
                _state.value = current.copy(
                    bitrateKbps = outs.filter { it.phase == OutputPhase.Live }.sumOf { it.bitrateKbps },
                    outputs = outs,
                )
            }
        }

        override fun onDisconnect() {
            KLog.w(TAG, "RTMP[$index] disconnected")
        }

        override fun onAuthError() {
            KLog.e(TAG, "RTMP[$index] auth error")
            // Auth-ошибка = кривой ключ платформы — реконнект бессмыслен: сразу изоляция (Failed).
            scope.launch { onOutputFailed(index, "Authentication failed — check stream key", retriable = false) }
        }

        override fun onAuthSuccess() {
            KLog.i(TAG, "RTMP[$index] auth OK")
        }
    }

    // plans/09 S2 — обновить статус выхода [index] (создаёт запись, если её ещё нет).
    private fun updateOutput(index: Int, transform: (OutputStatus) -> OutputStatus) {
        val cur = outputStates[index] ?: OutputStatus(index, "out$index", OutputPhase.Connecting)
        outputStates[index] = transform(cur)
    }

    /**
     * plans/09 S2 — свести per-output статусы в ОДИН [StreamState] для UI:
     *  • хоть один Live → Live (битрейт = максимум по живым; список всех выходов приложен);
     *  • иначе хоть один Connecting/Reconnecting → Connecting;
     *  • иначе все Failed → Error (первой ненулевой причиной);
     *  • иначе (пусто/Stopped) — не трогаем (Idle/Stopping ставятся явно в stop-путях).
     */
    private fun recomputeAggregateState() {
        val outs = outputStates.values.sortedBy { it.index }
        val anyLive = outs.any { it.phase == OutputPhase.Live }
        val anyPending = outs.any { it.phase == OutputPhase.Connecting || it.phase == OutputPhase.Reconnecting }
        _state.value = when {
            anyLive -> StreamState.Live(
                // idea 37 — durationMs ПЕРЕНОСИМ из текущего Live (иначе каждый пересчёт обнулял бы
                // таймер эфира); битрейт = сумма живых выходов.
                durationMs = (_state.value as? StreamState.Live)?.durationMs ?: 0,
                bitrateKbps = outs.filter { it.phase == OutputPhase.Live }.sumOf { it.bitrateKbps },
                outputs = outs,
            )
            anyPending -> StreamState.Connecting
            outs.isNotEmpty() && outs.all { it.phase == OutputPhase.Failed } ->
                StreamState.Error(outs.firstOrNull { it.reason != null }?.reason ?: "All outputs failed")
            else -> _state.value
        }
    }

    // ── idea 37 — тикер телеметрии + адаптер битрейта ───────────────────

    /**
     * Запустить секундный тикер эфира. Самозавершается, когда стрим кончился (Idle/Error/Stopping) —
     * поэтому его НЕ нужно глушить из каждого stop-пути. Каждый тик: durationMs++, поллинг
     * hasCongestion() по живым выходам (или симуляция с харнеса), каждый второй тик — шаг адаптера.
     */
    private fun startLiveTicker() {
        liveTicker?.cancel()
        streamStartedAtMs = android.os.SystemClock.elapsedRealtime()
        liveTicker = scope.launch {
            var tick = 0
            while (true) {
                delay(LIVE_TICK_MS)
                val st = _state.value
                if (st !is StreamState.Live && st !is StreamState.Connecting) break // эфир кончился
                tick++
                // Поллинг затыка канала по каждому ЖИВОМУ выходу (клиент индексный, plans/09).
                val stream = rtmpStream
                if (stream != null) {
                    outputStates.keys.toList().forEach { i ->
                        val live = outputStates[i]?.phase == OutputPhase.Live
                        if (live) {
                            val congested = simulatedCongestion ||
                                runCatching { stream.getStreamClient(MultiType.RTMP, i).hasCongestion() }
                                    .getOrDefault(false)
                            updateOutput(i) { it.copy(congested = congested) }
                        }
                    }
                }
                if (st is StreamState.Live) {
                    val outs = outputStates.values.sortedBy { it.index }
                    _state.value = st.copy(
                        durationMs = android.os.SystemClock.elapsedRealtime() - streamStartedAtMs,
                        bitrateKbps = outs.filter { it.phase == OutputPhase.Live }.sumOf { it.bitrateKbps },
                        outputs = outs,
                    )
                }
                // bug 64 — пока идёт эфир/запись: если камеру ОТОБРАЛИ (Instagram и т.п.), непрерывно
                // пытаемся её вернуть. Как только вор освободит камеру — фид восстановится САМ, не дожидаясь
                // возврата в приложение. Гейт !isAlive внутри → на живой камере это no-op (без churn).
                if (tick % 2 == 0) { adaptiveBitrateStep(); reopenDeadCameras() }
            }
            KLog.d(TAG, "liveTicker: эфир завершён, тикер остановлен (idea 37)")
        }
    }

    /**
     * Шаг адаптера битрейта (idea 37): затык ЛЮБОГО живого выхода → минус
     * [ADAPTIVE_DECREASE_PERCENT]% (пол [ADAPTIVE_FLOOR_BPS]); канал чист и current < target →
     * плюс [ADAPTIVE_RECOVER_PERCENT]% от target (потолок target). Энкодер ОДИН на все выходы →
     * правим глобально setVideoBitrateOnFly. Деградируем КАЧЕСТВОМ, а не плавностью.
     */
    private fun adaptiveBitrateStep() {
        if (!adaptiveBitrateEnabled || targetVideoBitrateBps <= 0) return
        val stream = rtmpStream ?: return
        val anyCongested = outputStates.values.any { it.phase == OutputPhase.Live && it.congested }
        val next = when {
            anyCongested ->
                (currentVideoBitrateBps * (100 - ADAPTIVE_DECREASE_PERCENT) / 100)
                    .coerceAtLeast(ADAPTIVE_FLOOR_BPS)
            currentVideoBitrateBps < targetVideoBitrateBps ->
                (currentVideoBitrateBps + targetVideoBitrateBps * ADAPTIVE_RECOVER_PERCENT / 100)
                    .coerceAtMost(targetVideoBitrateBps)
            else -> currentVideoBitrateBps
        }
        if (next != currentVideoBitrateBps) {
            KLog.i(TAG, "adaptive: битрейт ${currentVideoBitrateBps / 1000}→${next / 1000} kbps " +
                "(${if (anyCongested) "затык канала — снижаем" else "канал чист — восстанавливаем"})")
            currentVideoBitrateBps = next
            runCatching { stream.setVideoBitrateOnFly(next) }
                .onFailure { KLog.w(TAG, "adaptive: setVideoBitrateOnFly не прошёл: ${it.message}") }
        }
    }

    /** Debug-харнес (CMD simulate-congestion, idea 37): наблюдаемая приёмка петли без плохой сети. */
    fun setSimulatedCongestion(on: Boolean) {
        simulatedCongestion = on
        KLog.i(TAG, "simulate-congestion: ${if (on) "ON — адаптер увидит затык" else "OFF — канал «чист»"}")
    }

    // plans/09 S4 — экспоненциальный бэкофф реконнекта: 1с→2с→4с→8с (потолок 8с).
    private fun reconnectBackoffMs(attempt: Int): Long = (1000L shl (attempt - 1)).coerceAtMost(8000L)

    /**
     * plans/09 S3+S4 — обработка сбоя ОДНОГО выхода [index] (сеть/кривой ключ):
     *  • S4 (retriable, попытки не исчерпаны): фаза Reconnecting + `getStreamClient(RTMP,i).reTry(backoff)`
     *    — ЖИВЫЕ выходы не трогаем, энкодер НЕ гасим. Сетевой блип больше не конец эфира.
     *  • S3 (реконнект исчерпан / auth-ошибка): фаза Failed, стопим ТОЛЬКО этот индекс
     *    (`stopStream(RTMP,i)`); если это был ПОСЛЕДНИЙ активный выход — гасим энкодер (no-arg) и
     *    восстанавливаем превью (фикс чёрного экрана из bug 34).
     */
    private fun onOutputFailed(index: Int, reason: String, retriable: Boolean) {
        val stream = rtmpStream ?: return
        isStreamSetupInProgress = false
        val attempt = (outputStates[index]?.attempt ?: 0) + 1

        // S4 — попытка авто-реконнекта этого выхода с бэкоффом.
        if (retriable && attempt <= maxReconnectAttempts) {
            val backoff = reconnectBackoffMs(attempt)
            updateOutput(index) { it.copy(phase = OutputPhase.Reconnecting, reason = reason, attempt = attempt) }
            recomputeAggregateState()
            val client = runCatching { stream.getStreamClient(MultiType.RTMP, index) }.getOrNull()
            // КРИТИЧНО (сверено байткодом 2.4.7): `reTry` → `shouldRetry(reason)` =
            //   `doingRetry && !reason.contains("Endpoint malformed") && reTries > 0`.
            // Счётчик `reTries` по умолчанию 0 → без setReTries reTry ВСЕГДА возвращает false (эфир
            // умирал на любом блипе — воспроизведено на полигоне убийством сервера). Держим reTries>0
            // перед КАЖДОЙ попыткой; истинный потолок попыток задаёт НАШ attempt-счётчик + бэкофф.
            // `doingRetry` библиотека ставит true при установленном коннекте → мёртвый URL (не
            // подключался) сюда не пройдёт (shouldRetry=false) и корректно изолируется ниже.
            runCatching { client?.setReTries(maxReconnectAttempts) }
                .onFailure { KLog.w(TAG, "RTMP[$index] setReTries failed", it) }
            val scheduled = runCatching { client?.reTry(backoff, reason) ?: false }
                .getOrElse { KLog.w(TAG, "RTMP[$index] reTry threw", it); false }
            KLog.i(TAG, "RTMP[$index] reconnect attempt $attempt через ${backoff}ms (scheduled=$scheduled)")
            if (scheduled) return
            // reTry не назначился (нет установленного коннекта / Endpoint malformed) → изоляция ниже.
        }

        // S3 — изоляция выхода: Failed + стоп ТОЛЬКО этого индекса, живые не трогаем.
        KLog.e(TAG, "RTMP[$index] FAILED (reason=$reason) — изолируем выход, живые продолжают")
        updateOutput(index) { it.copy(phase = OutputPhase.Failed, reason = reason) }
        runCatching { stream.stopStream(MultiType.RTMP, index) }
            .onFailure { KLog.w(TAG, "RTMP[$index] stopStream(RTMP,$index) failed", it) }
        activeRtmpOutputs.remove(index)

        // Упал ПОСЛЕДНИЙ активный выход? Тогда гасим энкодер и восстанавливаем превью.
        if (activeRtmpOutputs.isEmpty()) {
            KLog.w(TAG, "RTMP: последний выход упал — гасим энкодер, восстанавливаем превью")
            runCatching { stream.stopStream() }
                .onFailure { KLog.w(TAG, "no-arg stopStream (encoder) failed", it) }
            lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
        }
        recomputeAggregateState()
    }

    private fun ensureStream(): MultiStream =
        rtmpStream ?: MultiStream(
            context,
            // plans/09 S2 — per-output ConnectChecker'ы: свой инстанс на каждый слот-выход, знающий свой
            // индекс → статусы платформ различаются (S3 изоляция, S4 реконнект). RTSP/SRT/UDP не используем.
            Array(maxRtmpOutputs) { i -> makeConnectChecker(i) },
            emptyArray(), emptyArray(), emptyArray(),
        ).also { rtmpStream = it }

    /**
     * Set the global CANVAS rotation to [degrees] (normalized to 0/90/180/270) — interview_006.
     *
     * BLOCKED while streaming / during stream setup: changing the encoder resolution on a live
     * RTMP connection breaks YouTube. The UI also disables the rotation control during a live
     * stream; this is the safety net. To rotate: stop the stream → rotate → start again.
     *
     * When idle: stores the angle, tells the compositor, then restarts the preview so the
     * GL/encoder canvas is rebuilt at the rotated aspect (portrait for 90/270). The preview then
     * mirrors the ALREADY-ROTATED composite — no TextureView matrix tricks anywhere.
     *
     * @return true if the rotation was applied, false if blocked (streaming) or unchanged.
     */
    fun setVideoRotation(degrees: Int): Boolean {
        if (rtmpStream?.isStreaming == true || isStreamSetupInProgress) {
            KLog.w(TAG, "setVideoRotation: blocked — cannot change rotation while streaming")
            return false
        }
        val normalized = ((degrees % 360) + 360) % 360
        if (normalized == _videoRotation.value) return false
        // Меняется ли ОРИЕНТАЦИЯ холста (портрет↔пейзаж)? Только тогда нужен другой размер энкодера
        // (1920×1080 ↔ 1080×1920) → пересборка GL → рестарт превью (переоткрытие камеры, §7).
        val wasPortrait = _videoRotation.value == 90 || _videoRotation.value == 270
        val nowPortrait = normalized == 90 || normalized == 270
        _videoRotation.value = normalized
        KLog.i(TAG, "Canvas rotation set to $normalized°")
        if (wasPortrait == nowPortrait) {
            // 0↔180 или 90↔270: размер холста ТОТ ЖЕ — только матрица поворота композитора, БЕЗ
            // рестарта и БЕЗ переоткрытия камеры (нет чёрного мигания; §7 частично закрыт для этих
            // переходов). Композитор нарисует следующий кадр уже повёрнутым; превью его зеркалит.
            // Поворот применяем СРАЗУ (размер не меняется → рассинхрона нет).
            compositorSource.setCanvasRotation(normalized)
            KLog.d(TAG, "rotation $normalized°: размер холста без изменений — matrix-only, камера не трогается")
        } else if (rtmpStream?.isOnPreview == true) {
            // Портрет↔ландшафт: поворот НЕ применяем здесь — resizeCanvasInPreview применит поворот И
            // новый размер выхода АТОМАРНО (иначе кадры с новым поворотом в старом размере → прыжок).
            // Портрет↔пейзаж: нужен ДРУГОЙ размер холста энкодера. КРИТИЧНО (bug 27): НЕ пересобираем
            // поверхность превью через stopPreview/startPreview — это гонка с системным HWUI
            // RenderThread за EGL-контекст поверхности TextureView → SIGABRT EGL_BAD_CONTEXT (Криник
            // словил на живом экране). Вместо этого меняем размер холста и перезапускаем ТОЛЬКО
            // композитор (ре-инит GL под новый размер; камера-слой кратко переоткроется, §7), оставляя
            // поверхность превью ПРИВЯЗАННОЙ (её не трогаем — HWUI спокоен).
            scope.launch { resizeCanvasInPreview() }
        }
        return true
    }

    /**
     * Bug 27 — сменить размер холста энкодера под текущий поворот (портрет↔пейзаж) БЕЗ пересборки
     * поверхности превью. Ключ: НИКАКИХ `stopPreview`/`startPreview` на TextureView (иначе гонка с
     * системным HWUI RenderThread → EGL_BAD_CONTEXT-краш). Меняем размер GL-холста и перезапускаем
     * ТОЛЬКО источник-композитор (он ре-инитит свою GL-поверхность под новый размер), поверхность
     * превью остаётся привязанной. Только для превью (не во время стрима — там поворот заблокирован).
     */
    private fun resizeCanvasInPreview() {
        val stream = rtmpStream ?: return
        if (stream.isStreaming || !stream.isOnPreview) return
        try {
            val deg = _videoRotation.value
            val portrait = deg == 90 || deg == 270
            val (encW, encH) = rotatedDims(basePreviewWidth, basePreviewHeight, deg)
            val gl = stream.getGlInterface()
            // Bug 29.3: НЕ рестартим композитор (changeVideoSource переоткрывал бы камеру → freeze).
            // Ресайзим холст композитора вживую (камера-продюсер продолжает писать в ту же поверхность) +
            // поворот АТОМАРНО в одном GL-посте. Вьюпорт превью-GL RootEncoder переключаем НЕ сразу, а в
            // колбэке — ПОСЛЕ того, как композитор отрисовал первый кадр НОВОГО размера. Иначе RootEncoder
            // рисует старый кадр в новом вьюпорте несколько кадров → сцена «прыгает» вбок (портрет↔ландшафт).
            compositorSource.resizeCanvasKeepingCamera(encW, encH, deg) {
                scope.launch {
                    gl.setEncoderSize(encW, encH)        // портретный/ландшафтный холст под аспект
                    gl.setIsPortrait(portrait)
                    gl.setAspectRatioMode(AspectRatioMode.Adjust)
                    gl.setCameraOrientation(0)           // повороты делает композитор (Bug 02 A)
                    KLog.i(TAG, "превью-GL синхронизирован под новый размер ${encW}x${encH} (после готового кадра)")
                }
            }
            applySceneLayers()
            KLog.i(TAG, "resizeCanvasInPreview: enc ${encW}x${encH} portrait=$portrait (камера не трогается)")
        } catch (e: Exception) {
            KLog.e(TAG, "resizeCanvasInPreview failed", e)
        }
    }

    /**
     * Bug 40 — ФИЗИЧЕСКИЙ поворот устройства (fullSensor): TextureView ресайзится, но её
     * SurfaceTexture ЖИВЁТ (поверхность не пересоздаётся) — трогать её нельзя (bug 27: гонка с HWUI
     * → EGL_BAD_CONTEXT). Однако GL-превью считает вьюпорт из полей previewWidth/previewHeight
     * (проверено по байткоду GlStreamInterface.draw → drawScreenPreview), которые выставляются
     * только при startPreview — после ресайза они СТАРЫЕ → композит «уезжает и обрезается».
     * Фикс: обновить ТОЛЬКО числа вьюпорта (setPreviewResolution) — без stop/startPreview,
     * без пересборки поверхности. Безопасно и в превью, и во время стрима.
     */
    fun onPreviewSurfaceResized(w: Int, h: Int) {
        val stream = rtmpStream ?: return
        if (!stream.isOnPreview || w <= 0 || h <= 0) return
        try {
            stream.getGlInterface().setPreviewResolution(w, h)
            KLog.i(TAG, "onPreviewSurfaceResized: preview viewport → ${w}x${h} (поверхность не тронута)")
        } catch (e: Exception) {
            KLog.e(TAG, "onPreviewSurfaceResized failed", e)
        }
    }

    /**
     * Phase 3 — configure the encoder for the current canvas rotation. Used by BOTH [startStream]
     * (real RTMP) and [startRecordToFile] (harness) so preview, stream and record stay IDENTICAL.
     *
     * For 90/270 the encoder canvas is PORTRAIT (e.g. 1080×1920) and `setIsPortrait(true)` makes
     * `SizeCalculator.calculateViewPortEncoder` use the FULL frame (no letterbox — decompiled).
     * The ROTATION itself is done ENTIRELY by our compositor (setCanvasRotation) — the library
     * must NOT rotate anything: `setCameraOrientation(0)` ALWAYS (prepareVideo(rotation=0) would
     * otherwise sneak in 270° for "phone sensors" — Bug 02 A). No RotatableSource, no
     * setStreamRotation — those legacy mechanisms are gone. Returns whether prepareVideo succeeded.
     */
    private fun configureCaptureRotation(stream: MultiStream, encoder: EncoderProfile): Boolean {
        val deg = _videoRotation.value
        val portrait = deg == 90 || deg == 270
        val (encW, encH) = rotatedDims(encoder.videoWidth, encoder.videoHeight, deg)
        // Профиль кодера — видеокодек задаётся ДО prepareVideo (RootEncoder кэширует выбор в
        // videoEncoder.type перед конфигом MediaCodec; после prepare менять поздно). H.264 —
        // безопасный дефолт; H.265/AV1 экономят битрейт, но RTMP-приёмник должен их принять.
        stream.setVideoCodec(encoder.videoCodec.toPedro())
        val vp = stream.prepareVideo(encW, encH, encoder.videoBitrateBps, encoder.videoFps, 2)
        val gl = stream.getGlInterface()
        gl.setIsPortrait(portrait)     // full-frame viewport for the portrait canvas (no letterbox)
        gl.setCameraOrientation(0)     // library does NO rotation — the compositor owns it (Bug 02 A)
        compositorSource.setCanvasRotation(deg)
        // Restart the source so it re-allocates its producer buffer at the new encoder geometry.
        runCatching { stream.changeVideoSource(compositorSource) }
            .onFailure { KLog.w(TAG, "configureCaptureRotation: source rebind failed", it) }
        KLog.i(TAG, "configureCaptureRotation: canvas=$deg° enc ${encW}x${encH} portrait=$portrait codec=${encoder.videoCodec.name} vp=$vp")
        return vp
    }

    /** Профиль кодера — маппинг домен-модели кодека в библиотечный enum RootEncoder. */
    private fun VideoCodec.toPedro(): PedroVideoCodec = when (this) {
        VideoCodec.H264 -> PedroVideoCodec.H264
        VideoCodec.H265 -> PedroVideoCodec.H265
        VideoCodec.AV1  -> PedroVideoCodec.AV1
    }

    /**
     * Профиль кодера — подготовка звука по режиму каналов (bug 44).
     *  STEREO        — 2 канала, L/R как с источника (prepareAudio isStereo=true).
     *  MONO          — 1 канал (isStereo=false); AudioRecord с одним каналом даёт микс микрофона.
     *  JOINED_STEREO — 2 канала (isStereo=true). Истинный даунмикс L+R в оба канала (L=R) требует
     *                  своей PCM-обработки — TODO (сейчас стерео-контейнер, passthrough). Помечено в
     *                  plans/14 / bug 44 как остаток; STEREO/MONO работают корректно уже сейчас.
     */
    private fun prepareAudioFor(stream: MultiStream, encoder: EncoderProfile): Boolean {
        val isStereo = encoder.audioChannelMode != AudioChannelMode.MONO
        if (encoder.audioChannelMode == AudioChannelMode.JOINED_STEREO) {
            KLog.w(TAG, "prepareAudioFor: JOINED_STEREO — даунмикс L+R→оба канала ещё не реализован " +
                    "(PCM-фильтр), пока стерео-passthrough. TODO plans/14/bug44")
        }
        val ok = stream.prepareAudio(encoder.audioSampleRate, isStereo, encoder.audioBitrateBps)
        KLog.d(TAG, "prepareAudioFor → $ok (${encoder.audioSampleRate}Hz " +
                "${encoder.audioChannelMode.name} ${encoder.audioBitrateBps / 1000}kbps)")
        return ok
    }

    /**
     * Attach the preview TextureView. Starts the GL pipeline and the compositor (which opens the
     * camera layer's producer via CameraOpener). Must be called from the main thread.
     *
     * Guarded: if streaming is already active, UI callbacks (LaunchedEffect, onTextureViewReady)
     * must NOT restart the GL — the encoder is running; we only re-attach the preview surface.
     */
    fun startPreview(tv: TextureView) {
        val stream = ensureStream()

        // Always update the ref — stopStream() uses it to restart preview after stream ends
        lastPreviewTextureView = WeakReference(tv)

        if (stream.isStreaming) {
            // During streaming, RE-ATTACH the preview surface with the CURRENT TextureView size
            // (Bug 03: on device rotation the TextureView resizes and the preview must re-attach
            // at the new dimensions). Safe during streaming: StreamBase.startPreview skips
            // videoSource.start() and glInterface.start() because both already run for the encoder.
            try {
                if (stream.isOnPreview) stream.stopPreview()  // detach old-size preview surface
                stream.startPreview(tv)                        // re-attach at new tv size
                stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust)
                KLog.d(TAG, "startPreview: re-attached during streaming — tv=${tv.width}x${tv.height}")
            } catch (e: Exception) {
                KLog.e(TAG, "startPreview: failed to re-attach during streaming", e)
            }
            return
        }

        try {
            KLog.d(TAG, "startPreview: tv=${tv.width}x${tv.height} isOnPreview=${stream.isOnPreview} glRunning=${stream.getGlInterface().isRunning}")
            // Phase 3: базой энкодера всегда наш композитор; камера приходит его слоем.
            ensureCompositorBase()
            if (stream.isOnPreview) stream.stopPreview()
            // Холст превью = холст энкодера с учётом поворота (interview_006): превью зеркалит
            // УЖЕ ПОВЁРНУТЫЙ композит (портретный канвас на 90/270), AspectRatioMode.Adjust
            // леттербоксит его в TextureView. Никаких матриц TextureView.
            val deg = _videoRotation.value
            val portrait = deg == 90 || deg == 270
            val (encW, encH) = rotatedDims(basePreviewWidth, basePreviewHeight, deg)
            // GL init lambda calls mainRender.initGl(encoderWidth, encoderHeight); size 0 → crash
            // (swallowed) → GL never runs. Set the canvas size BEFORE startPreview (also handles
            // the rotated-aspect rebuild after setVideoRotation).
            val glSize = stream.getGlInterface().encoderSize
            if (glSize.x != encW || glSize.y != encH) {
                KLog.d(TAG, "startPreview: encoder canvas ${glSize.x}x${glSize.y} → ${encW}x${encH}")
                stream.getGlInterface().setEncoderSize(encW, encH)
            }
            stream.getGlInterface().setIsPortrait(portrait)
            compositorSource.setCanvasRotation(deg)
            stream.startPreview(tv)
            stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust)
            // Library does NO input rotation ever — the compositor owns rotation (Bug 02 A safety).
            stream.getGlInterface().setCameraOrientation(0)
            applySceneLayers()  // отдать композитору текущие слои сцены
            KLog.d(TAG, "startPreview: done — glRunning=${stream.getGlInterface().isRunning}")
            scheduleVideoSourceRetryIfNeeded(stream)
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start preview", e)
        }
    }

    /**
     * Race condition fix: StreamBase.startPreview() calls videoSource.start(getSurfaceTexture())
     * synchronously before the GL render loop sets running=true. The compositor's initGl defers
     * itself when the surface isn't ready. Once GL is up, re-trigger changeVideoSource() so the
     * compositor restarts on the now-valid SurfaceTexture.
     */
    private fun scheduleVideoSourceRetryIfNeeded(stream: MultiStream) {
        if (stream.getGlInterface().isRunning) return  // already up, no retry needed
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 3000) {
                delay(50)
                waited += 50
            }
            if (gl.isRunning) {
                KLog.d(TAG, "GL ready after ${waited}ms — re-triggering compositor source")
                try {
                    stream.changeVideoSource(compositorSource)
                    applySceneLayers()  // re-hand the scene layers once GL is up
                } catch (e: Exception) {
                    KLog.e(TAG, "Failed to re-trigger compositor after GL ready", e)
                }
            } else {
                KLog.w(TAG, "GL still not running after 3000ms — giving up")
            }
        }
    }

    /**
     * After startStream()/startRecordToFile() launches the GL pipeline, wait for GL readiness and
     * re-attach the LIVE preview surface so the user sees the composite while streaming/recording.
     * Safe: StreamBase.startPreview skips videoSource.start()/glInterface.start() when already
     * running for the encoder — the compositor is not restarted or redirected.
     */
    private fun schedulePreviewRestoreAfterStream(stream: MultiStream) {
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 5000) {
                delay(50)
                waited += 50
            }
            // #3 (Криник) — ждём ПЕРВЫЙ живой кадр камеры перед re-attach превью, чтобы оно не цеплялось
            // на ЧЁРНЫЙ кадр (после go-live композитор реинитит GL → снапшот чёрный, пока камера-продюсер
            // не переоткрылся). Интермиттентное мигание в чёрный на старте эфира. Кап 1200мс — не зависаем,
            // если источник не отдаёт кадры (тогда цепляемся как раньше). TextureView держит последний кадр
            // пока превью отцеплено, поэтому ожидание не показывает чёрного — только оттягивает live-картинку.
            var wf = 0
            while (!compositorSource.hasLiveCameraContent() && wf < 1200) { delay(50); wf += 50 }
            KLog.d(TAG, "schedulePreviewRestoreAfterStream: GL ${if (gl.isRunning) "ready" else "NOT ready"} after ${waited}ms, live-frame wait ${wf}ms")
            val tv = lastPreviewTextureView?.get()
            if (tv != null && gl.isRunning && !stream.isOnPreview) {
                try {
                    stream.startPreview(tv)
                    gl.setAspectRatioMode(AspectRatioMode.Adjust)
                    applySceneLayers()  // keep scene layers after preview re-attach
                    KLog.d(TAG, "schedulePreviewRestoreAfterStream: live preview attached (tv=${tv.width}x${tv.height})")
                } catch (e: Exception) {
                    KLog.e(TAG, "schedulePreviewRestoreAfterStream: failed to attach preview", e)
                }
            }
        }
    }

    fun stopPreview() {
        rtmpStream?.let { stream ->
            if (stream.isOnPreview) stream.stopPreview()
        }
    }

    /**
     * Start RTMP stream to the given profile.
     *
     * Flow:
     *  1. Set isStreamSetupInProgress=true to guard against UI churn during setup
     *  2. Stop preview (so prepareVideo doesn't throw IllegalStateException)
     *  3. prepareVideo (via configureCaptureRotation) + prepareAudio — configure MediaCodec encoders
     *  4. stream.startStream(url) — start RTMP + GL pipeline
     *  5. schedulePreviewRestoreAfterStream — re-attach TextureView once GL is ready
     */
    /** Одно-профильный запуск (обёртка над мультивыходом). [encoder] — профиль кодера (plans/14). */
    fun startStream(profile: StreamProfile, encoder: EncoderProfile): Boolean =
        startStream(listOf(profile), encoder)

    /**
     * plans/07 S3 — МУЛЬТИСТРИМ: запустить трансляцию на НЕСКОЛЬКО платформ разом (ютуб+инстаграм…).
     * Один энкодер (наш композитор) кодирует ОДИН раз; каждый профиль платформы = отдельный RTMP-выход.
     * Параметры энкодера берём из [encoder] (профиль кодера, plans/14 — резолвится в репозитории по
     * encoderProfileId первого выхода). Ограничение — [maxRtmpOutputs] выходов.
     */
    fun startStream(profiles: List<StreamProfile>, encoder: EncoderProfile): Boolean {
        val profile = profiles.firstOrNull() ?: run {
            KLog.e(TAG, "startStream: пустой список профилей")
            return false
        }
        val outputs = profiles.take(maxRtmpOutputs)
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startStream: no rtmpStream — call startPreview first")
            return false
        }

        if (stream.isStreaming) {
            KLog.w(TAG, "startStream: already streaming — ignoring")
            return true
        }

        val rtmpUrl = "${profile.rtmpUrl}/${profile.streamKey}"
        KLog.i(TAG, "startStream: platform='${profile.name}' encoder='${encoder.name}' " +
                "${encoder.videoWidth}x${encoder.videoHeight} ${encoder.videoFps}fps " +
                "${encoder.videoBitrateBps}bps ${encoder.videoCodec.name} → $rtmpUrl")
        KLog.d(TAG, "startStream: isOnPreview=${stream.isOnPreview}" +
                " glRunning=${stream.getGlInterface().isRunning}")

        isStreamSetupInProgress = true

        try {
            // prepareVideo() throws IllegalStateException if isOnPreview=true — stop first
            if (stream.isOnPreview) {
                KLog.d(TAG, "startStream: stopPreview() before prepareVideo")
                stream.stopPreview()
            }

            // CRITICAL: RootEncoder StreamBase.prepareVideo signature is
            //   prepareVideo(width, height, bitrate, fps = 30, iFrameInterval = 2, ...)
            // i.e. BITRATE is the 3rd param and FPS the 4th (Bug 02). iFrameInterval=2 = 2s GOP.
            val videoPrepared = configureCaptureRotation(stream, encoder)
            KLog.d(TAG, "startStream: prepareVideo+rotation → $videoPrepared (canvas=${_videoRotation.value}° ${encoder.videoFps}fps iFrame=2s)")

            // Профиль кодера — звук из профиля кодера (частота/режим каналов/битрейт), а не хардкод.
            val audioPrepared = prepareAudioFor(stream, encoder)

            if (!videoPrepared || !audioPrepared) {
                val msg = "Failed to prepare encoder (video=$videoPrepared audio=$audioPrepared)"
                KLog.e(TAG, msg)
                _state.value = StreamState.Error(msg)
                isStreamSetupInProgress = false
                lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
                return false
            }

            _state.value = StreamState.Connecting
            // plans/09 S2 — свежая сессия: сбрасываем per-output состояние прошлого эфира.
            activeRtmpOutputs.clear()
            outputStates.clear()
            // plans/07 S3 — стартуем КАЖДЫЙ выход на своём индексе (ютуб=0, инстаграм=1, …);
            // plans/09 S2 — сразу заводим статус выхода (имя платформы + фаза Connecting) для UI.
            outputs.forEachIndexed { i, p ->
                val url = "${p.rtmpUrl}/${p.streamKey}"
                // bug 37 №3 — в лог редактированный URL; полный (с ключом) идёт ТОЛЬКО в библиотеку.
                KLog.i(TAG, "startStream: RTMP out[$i] '${p.name}' → ${redactRtmpUrl(url)}")
                outputStates[i] = OutputStatus(index = i, name = p.name, phase = OutputPhase.Connecting)
                stream.startStream(MultiType.RTMP, i, url)
                activeRtmpOutputs.add(i)
            }
            KLog.d(TAG, "startStream: запущено выходов=${outputs.size} — ждём GL + ConnectChecker")

            // idea 37 — телеметрия + адаптер: цель = битрейт профиля КОДЕРА (энкодер один на все
            // выходы); адаптив — свойство профиля кодера (plans/14); тикер сам умрёт по концу эфира.
            targetVideoBitrateBps = encoder.videoBitrateBps
            currentVideoBitrateBps = targetVideoBitrateBps
            adaptiveBitrateEnabled = encoder.adaptiveBitrate
            KLog.i(TAG, "idea37: target=${targetVideoBitrateBps / 1000}kbps adaptive=$adaptiveBitrateEnabled")
            startLiveTicker()

            // Wait for GL to start, re-attach preview TextureView
            schedulePreviewRestoreAfterStream(stream)
            return true

        } catch (e: Exception) {
            KLog.e(TAG, "startStream: exception during setup", e)
            _state.value = StreamState.Error("Stream setup crashed: ${e.message}")
            isStreamSetupInProgress = false
            lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
            return false
        }
    }

    fun stopStream() {
        KLog.i(TAG, "stopStream: stopping RTMP stream")
        isStreamSetupInProgress = false
        _state.value = StreamState.Stopping
        rtmpStream?.let { disconnectAllOutputs(it) }
        activeRtmpOutputs.clear()
        outputStates.clear()   // plans/09 S2 — сбрасываем per-output состояние
        _state.value = StreamState.Idle
        // bug 48/63 — превью восстанавливаем ТОЛЬКО если оно отвалилось (не пере-цепляем живую поверхность).
        restorePreviewIfDetached()
    }

    /**
     * bug 48/63 — вернуть превью ТОЛЬКО если поверхность реально отвалилась. Во время эфира/записи превью
     * уже вернул [schedulePreviewRestoreAfterStream] → на стопе оно ПРИВЯЗАНО. Повторный
     * `startPreview(tv)` внутри делает `stopPreview()`+`startPreview()` на TextureView — пересборка её
     * поверхности гонится с СИСТЕМНЫМ HWUI RenderThread → `EGL_BAD_SURFACE` (SIGABRT в RenderThread,
     * краш на 2-3 цикле go-live/stop — семья bug 27/31/48). Композитор рисует в уже живую поверхность,
     * поэтому если превью на месте — НЕ трогаем поверхность, лишь освежаем слои/аспект.
     */
    private fun restorePreviewIfDetached() {
        val stream = rtmpStream
        val tv = lastPreviewTextureView?.get()
        if (stream != null && stream.isOnPreview) {
            runCatching { stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust) }
            applySceneLayers() // поверхность жива — без churn, только слои сцены
            KLog.d(TAG, "restorePreviewIfDetached: превью уже привязано — поверхность НЕ трогаем (bug 48/63)")
        } else if (tv != null) {
            startPreview(tv)
        }
    }

    /**
     * Bug 34 (plans/09 S1) — КОРРЕКТНАЯ остановка мультистрима. Нужны ОБА шага (сверено байткодом
     * RootEncoder 2.4.7):
     *  1. per-index `stopStream(MultiType.RTMP, i)` по КАЖДОМУ активному выходу — единственный путь к
     *     `RtmpClient.disconnect()`. no-arg `StreamBase.stopStream()` делегирует в
     *     `MultiStream.rtpStopStream()`, а тот ПУСТОЙ (`Code: 0: return`) → сокеты остаются открытыми,
     *     `RtmpClient.isStreaming=true` → следующий Go Live: `shouldStartEncoder=false` + `connect()`
     *     no-op → второй эфир мёртв до перезапуска приложения. Это корень бага 34.
     *  2. затем no-arg `stopStream()` — гасит энкодер (`stopSources()` + `prepareEncoders()`). Сам
     *     per-index его НЕ трогает: флаг `allStopped` в `stopStream(RTMP,i)` считается ДО `disconnect`,
     *     при ещё живом выходе он =false → `StreamBase.stopStream()` внутри не зовётся. Отсюда «ОБА шага».
     * Идемпотентно: пустой `activeRtmpOutputs` → только no-arg (безопасен, если уже не стримим).
     */
    private fun disconnectAllOutputs(stream: MultiStream) {
        activeRtmpOutputs.toList().forEach { i ->
            runCatching { stream.stopStream(MultiType.RTMP, i) }
                .onFailure { KLog.w(TAG, "disconnectAllOutputs: stopStream(RTMP,$i) failed", it) }
        }
        runCatching { stream.stopStream() }
            .onFailure { KLog.w(TAG, "disconnectAllOutputs: no-arg stopStream (encoder) failed", it) }
    }

    // ── Idea 10 — virtual stream platform (record to file) ──────────────────

    /** Absolute path of the in-progress recording (app-private). Published to DCIM on STOPPED. */
    private var lastRecordPath: String? = null

    /** Record status callback. On STOPPED → publish the finished file to the public DCIM/KrinikCam. */
    private val recordListener = object : RecordController.Listener {
        override fun onStatusChange(status: RecordController.Status) {
            KLog.i(TAG, "Record status: $status")
            // Idea 11: the file is finalized (moov written) when status becomes STOPPED — only then
            // copy it to the PUBLIC DCIM/KrinikCam so Krinik can see/analyse recordings in the gallery.
            if (status == RecordController.Status.STOPPED) {
                lastRecordPath?.let { publishRecordingToDcim(it) }
            }
        }
        override fun onNewBitrate(bitrate: Long) {
            val raw = (bitrate / 1000).toInt()
            val current = _state.value
            // bug 53 — сглаживаем показание записи (EMA), чтобы плашка не дёргалась.
            if (current is StreamState.Live) {
                val smoothed = if (current.bitrateKbps == 0) raw else (current.bitrateKbps * 3 + raw) / 4
                _state.value = current.copy(bitrateKbps = smoothed)
            }
        }
    }

    /**
     * Idea 11 — copy a finished recording from the app-private dir into the PUBLIC DCIM/KrinikCam
     * folder via MediaStore (scoped storage, minSdk 33 — no direct file path to public dirs). The file
     * then shows up in the gallery / Files app, visible to Krinik. This MediaStore pipeline is also the
     * groundwork for the future "save video/photo to gallery" feature.
     */
    private fun publishRecordingToDcim(srcPath: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val src = File(srcPath)
                if (!src.exists() || src.length() == 0L) {
                    KLog.w(TAG, "publishToDcim: source missing/empty — $srcPath")
                    return@launch
                }
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, src.name)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "DCIM/KrinikCam")
                    put(MediaStore.Video.Media.IS_PENDING, 1) // hide until the copy finishes
                }
                val resolver = context.contentResolver
                val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val uri = resolver.insert(collection, values)
                if (uri == null) {
                    KLog.e(TAG, "publishToDcim: MediaStore insert returned null")
                    return@launch
                }
                resolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
                values.clear()
                values.put(MediaStore.Video.Media.IS_PENDING, 0) // publish (make visible)
                resolver.update(uri, values, null, null)
                KLog.i(TAG, "publishToDcim: → DCIM/KrinikCam/${src.name} ($uri)")
            } catch (e: Exception) {
                KLog.e(TAG, "publishToDcim failed", e)
            }
        }
    }

    /**
     * Idea 17 — снять ФОТО (один кадр композита) и сохранить JPEG в публичную галерею DCIM/KrinikCam.
     * Композитор рисует итоговый кадр (то, что видит зритель); захват — на GL-потоке (`glReadPixels`),
     * публикация — в IO-корутине.
     */
    fun capturePhoto() {
        compositorSource.capturePhoto { bmp ->
            if (bmp != null) publishPhotoToDcim(bmp)
            else KLog.w(TAG, "capturePhoto: получен null-кадр")
        }
    }

    // Idea 17 — сохранить Bitmap-кадр как JPEG в публичную DCIM/KrinikCam (MediaStore, как publishRecordingToDcim).
    private fun publishPhotoToDcim(bmp: Bitmap) {
        scope.launch(Dispatchers.IO) {
            try {
                val name = "krinikcam_photo_${System.currentTimeMillis()}.jpg"
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/KrinikCam")
                    put(MediaStore.Images.Media.IS_PENDING, 1) // скрыть до завершения записи
                }
                val resolver = context.contentResolver
                val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val uri = resolver.insert(collection, values)
                if (uri == null) { KLog.e(TAG, "publishPhotoToDcim: MediaStore insert returned null"); return@launch }
                resolver.openOutputStream(uri)?.use { out -> bmp.compress(Bitmap.CompressFormat.JPEG, 95, out) }
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0) // опубликовать
                resolver.update(uri, values, null, null)
                KLog.i(TAG, "capturePhoto: → DCIM/KrinikCam/$name ($uri)")
            } catch (e: Exception) {
                KLog.e(TAG, "publishPhotoToDcim failed", e)
            } finally {
                runCatching { bmp.recycle() }
            }
        }
    }

    val isRecording: Boolean get() = rtmpStream?.isRecording == true

    /**
     * Idea 10 — "virtual stream platform": record the SAME encoder output to an MP4 file instead of
     * pushing RTMP. Runs the full encode path (one MediaCodec, same dimensions/rotation as a real
     * stream), so the recorded file == what would be streamed. Extract frames from it later to verify
     * distortion deterministically — no real YouTube / no Krinik needed.
     *
     * File goes to the app's external files dir (adb-pullable):
     *   /sdcard/Android/data/<pkg>/files/rec/krinikcam_rec_<ts>.mp4
     * Returns the path, or null on failure.
     *
     * Camera dropout mid-record is now HARMLESS (Phase 3): no source swap happens, the compositor
     * keeps feeding the encoder (black base + layers) and the MediaMuxer timeline stays intact.
     */
    fun startRecordToFile(encoder: EncoderProfile): String? {
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startRecordToFile: no rtmpStream — start preview first")
            return null
        }
        if (stream.isStreaming || stream.isRecording) {
            KLog.w(TAG, "startRecordToFile: already streaming/recording — ignoring")
            return null
        }
        val dir = File(context.getExternalFilesDir(null), "rec").apply { mkdirs() }
        val path = File(dir, "krinikcam_rec_${System.currentTimeMillis()}.mp4").absolutePath

        isStreamSetupInProgress = true
        try {
            if (stream.isOnPreview) stream.stopPreview()
            // bug 51 — запись кодируется ВЫБРАННЫМ профилем кодера (тот же путь, что эфир: record == stream).
            val vp = configureCaptureRotation(stream, encoder)
            val ap = prepareAudioFor(stream, encoder)
            if (!vp || !ap) {
                KLog.e(TAG, "startRecordToFile: prepare failed (video=$vp audio=$ap)")
                isStreamSetupInProgress = false
                lastPreviewTextureView?.get()?.let { startPreview(it) }
                return null
            }
            _state.value = StreamState.Live(isRecording = true)  // reuse Live-состояние, но помечаем как ЗАПИСЬ (Криник)
            lastRecordPath = path              // Idea 11: published to DCIM on STOPPED
            // idea 37/17 — тикер эфира нужен и ЗАПИСИ (таймер на бейдже; пойман приёмкой кнопки
            // Record: стоял 0:00). Адаптер битрейта при записи ВЫКЛЮЧЕН (target=0 → no-op: канала
            // нет, RTMP-клиентов нет — congestion-поллинг по пустым outputStates безопасен).
            targetVideoBitrateBps = 0
            adaptiveBitrateEnabled = false
            startLiveTicker()
            stream.startRecord(path, recordListener)
            KLog.i(TAG, "startRecordToFile → $path (canvas=${_videoRotation.value}°)")
            schedulePreviewRestoreAfterStream(stream)
            return path
        } catch (e: Exception) {
            KLog.e(TAG, "startRecordToFile: exception", e)
            _state.value = StreamState.Error("Record setup crashed: ${e.message}")
            isStreamSetupInProgress = false
            lastPreviewTextureView?.get()?.let { startPreview(it) }
            return null
        }
    }

    /** Stop the file recording (Idea 10) and restore preview. */
    fun stopRecordToFile() {
        KLog.i(TAG, "stopRecordToFile: stopping record")
        isStreamSetupInProgress = false
        _state.value = StreamState.Stopping
        rtmpStream?.let { if (it.isRecording) it.stopRecord() }
        _state.value = StreamState.Idle
        // bug 48/63 — превью восстанавливаем ТОЛЬКО если оно отвалилось (не пере-цепляем живую поверхность).
        restorePreviewIfDetached()
    }

    // ── Операции над сценой (Idea 19/25) ─────────────────────────────────────

    /**
     * Отдать композитору текущие слои сцены (снизу вверх, только видимые). Камера и картинки
     * равноправны и идут В ПОРЯДКЕ СЦЕНЫ (камера переставляема — истинный OBS). Каждому слою —
     * его PiP-трансформа (позиция/масштаб/альфа) и поворот содержимого (interview_006 Q3).
     * Зовётся после каждой правки сцены и на хуках (превью поднялось / GL готов / переподцеплено).
     */
    private fun applySceneLayers() {
        // bug 58 / ШАРИНГ ФИДА — считаем первичный/зеркало по ФИЗ-ключу источника (layerSourceKeys):
        // первый ВИДИМЫЙ слой с данным ключом — первичный (mirrorOf=null, держит продюсера), следующие с
        // тем же ключом — зеркала его слота (mirrorOf=первичный). Ключ null (виртуалка/нет источника) —
        // свой независимый слот. Порядок — как в сцене (снизу вверх). cameraLayerMirrors кэшируем для
        // setCameraOpener (открывать только первичный).
        val primaryByKey = HashMap<String, String>()
        cameraLayerMirrors.clear()
        val layers = _scene.value.layers.filter { it.visible }.map { layer ->
            val t = layer.transform
            when (layer) {
                is Layer.VideoCapture -> {
                    val key = layerSourceKeys[layer.id]
                    val mirrorOf = if (key != null) {
                        primaryByKey[key] ?: run { primaryByKey[key] = layer.id; null }
                    } else null
                    cameraLayerMirrors[layer.id] = mirrorOf
                    CompositorLayer.Camera(
                        id = layer.id, mirrorOf = mirrorOf,
                        scale = t.scale, cx = t.cx, cy = t.cy, alpha = t.alpha, rotation = t.rotation,
                    )
                }
                is Layer.Image -> CompositorLayer.Image(
                    bitmap = layer.bitmap,
                    scale = t.scale, cx = t.cx, cy = t.cy, alpha = t.alpha, rotation = t.rotation,
                )
            }
        }
        compositorSource.setLayers(layers)
    }

    // Общий помощник: применить трансформацию к сцене, опубликовать и переприменить слои.
    private fun mutateScene(transform: (Scene) -> Scene) {
        _scene.value = transform(_scene.value)
        applySceneLayers()
    }

    // ── idea 40 / plans/18 Ф0 — персист сцены (restore на старте + автосейв) ──────────────────
    /**
     * Запустить персист сцены: сначала ВОССТАНОВИТЬ сохранённую сцену (строго ДО автосейва — иначе
     * дефолт перезапишет сохранённое), затем автосейв на каждую правку. Автосейв — с debounce (`mutateScene`
     * зовётся каждый кадр жеста трансформы → без debounce был бы спам записи и просадка жестов), и с
     * `drop(1)` (пропускаем восстановленное/дефолтное значение — его сохранять не нужно).
     */
    @OptIn(FlowPreview::class)
    private fun startScenePersistence() {
        scope.launch(Dispatchers.IO) {
            snapshotRepo.loadOrNull()?.let { restored ->
                withContext(Dispatchers.Main.immediate) {
                    _scene.value = restored
                    applySceneLayers()
                    KLog.i(TAG, "Scene restored from snapshot: ${restored.layers.size} layers")
                }
            }
            scene.drop(1).debounce(SCENE_AUTOSAVE_DEBOUNCE_MS).collect { snapshotRepo.save(it) }
        }
    }

    /** Ф0 — сбросить сцену к дефолту (FAB «Сцены» → «Сбросить сцену»). Автосейв сохранит и почистит сироты. */
    fun resetScene() = mutateScene { Scene.default() }

    /** Ф0 — форс-сейв текущей сцены (харнес scene-save: детерминизм теста без ожидания debounce). */
    fun saveSceneNow() { scope.launch(Dispatchers.IO) { snapshotRepo.save(_scene.value) } }

    /** Ф0 — залогировать персистнутый снапшот (харнес scene-dump: объективная сверка до/после рестарта). */
    fun dumpSceneToLog() {
        scope.launch(Dispatchers.IO) {
            KLog.i(TAG, "scene-dump: layers=${_scene.value.layers.size} persisted=${snapshotRepo.persistedJson()}")
        }
    }

    // Мульти-источники (idea 21 Фаза B): УНИКАЛЬНЫЙ id слоя видеозахвата. Дефолтная камера сцены —
    // id "camera"; добавляемые — "camera_1", "camera_2", … Считаем по СКАНУ текущей сцены (МАКС суффикс
    // +1), а не монотонным счётчиком от 0 — иначе после restore (plans/18 Ф0) новый слой коллидил бы с
    // восстановленными "camera_N".
    private fun nextVideoCaptureLayerId(): String {
        val max = _scene.value.layers
            .filter { it.id.startsWith("camera_") }
            .mapNotNull { it.id.removePrefix("camera_").toIntOrNull() }
            .maxOrNull() ?: 0
        return "camera_${max + 1}"
    }

    /**
     * Добавить ещё один слой «Устройство захвата видео» НА ВЕРХ сцены (мульти-источники). bug 57 —
     * источник задаётся СРАЗУ при создании ([source], пикер-модалка спросила его до добавления);
     * дефолт None (харнес add-video-capture / обратная совместимость). id уникален, возвращается наверх.
     */
    fun addVideoCaptureLayer(
        source: com.kriniks.kcam.feature.streaming.scene.CaptureSource =
            com.kriniks.kcam.feature.streaming.scene.CaptureSource.None,
    ): String {
        val id = nextVideoCaptureLayerId()
        mutateScene { it.addOnTop(Layer.VideoCapture(id = id, source = source)) }
        KLog.i(TAG, "Scene: added video-capture layer id=$id source=${source::class.simpleName} (мульти-источники)")
        return id
    }

    // Криник / bug 60 — предыдущий источник слоя (для ОТКАТА, если новая встроенная камера не подключилась).
    private val prevLayerSource = HashMap<String, com.kriniks.kcam.feature.streaming.scene.CaptureSource>()

    /** Мульти-источники: задать источник (CaptureSource) слоя «Устройство захвата видео» [layerId]. */
    fun setCameraLayerSource(layerId: String, source: com.kriniks.kcam.feature.streaming.scene.CaptureSource) {
        // Запоминаем текущий источник ДО смены — на случай отката конфликтной встроенной камеры (bug 60).
        val cur = _scene.value.layers.filterIsInstance<Layer.VideoCapture>().firstOrNull { it.id == layerId }?.source
        if (cur != null && cur != source) prevLayerSource[layerId] = cur
        mutateScene { it.setSource(layerId, source) }
        KLog.i(TAG, "Scene: layer $layerId source → ${source::class.simpleName}")
    }

    /**
     * Криник / bug 60 — вторую встроенную камеру подключить НЕЛЬЗЯ (HAL-лимит фронт+тыл): НЕ оставляем
     * слой «висящим» на неподключаемой камере. Откатываем источник слоя к ПРЕДЫДУЩЕМУ (или None, если
     * предыдущего нет / он тоже встроенная). Зовётся из :app по колбэку конфликта опенера (onConflict).
     */
    fun revertConflictingCameraLayer(layerId: String) {
        val cur = _scene.value.layers.filterIsInstance<Layer.VideoCapture>().firstOrNull { it.id == layerId }?.source
        // Откатываем ТОЛЬКО если сейчас на слое реально стоит встроенная камера (иначе конфликт уже снят —
        // не зациклимся: safe-источник встроенной не бывает, значит повторный onConflict не придёт).
        if (cur !is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Builtin) return
        val prev = prevLayerSource[layerId]
        val safe = if (prev == null || prev is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Builtin)
            com.kriniks.kcam.feature.streaming.scene.CaptureSource.None else prev
        KLog.i(TAG, "Scene: layer $layerId — встроенная не подключилась (конфликт), откат источника → ${safe::class.simpleName}")
        mutateScene { it.setSource(layerId, safe) }
    }

    /**
     * Добавить слой-картинку (PNG-оверлей) НА ВЕРХ сцены. [bitmap] уже готов (из файла или
     * сгенерирован). [id] должен быть уникальным (для toggle/remove/reorder).
     */
    fun addImageOverlay(id: String, name: String, bitmap: Bitmap) {
        mutateScene { it.addOnTop(Layer.Image(id = id, name = name, bitmap = bitmap)) }
        KLog.i(TAG, "Scene: added image overlay '$name' (id=$id)")
    }

    /** Удалить слой по id (камеру UI удалять не предлагает — первый заход). */
    fun removeLayer(id: String) {
        mutateScene { it.remove(id) }
        KLog.i(TAG, "Scene: removed layer id=$id")
    }

    /** Переключить видимость слоя по id (включает/выключает его в компоновке). */
    fun toggleLayerVisible(id: String) {
        mutateScene { it.toggleVisible(id) }
        KLog.d(TAG, "Scene: toggled visibility of layer id=$id")
    }

    /** Поднять слой на одну позицию выше в z-order (ближе к зрителю). */
    fun moveLayerUp(id: String) = mutateScene { it.moveUp(id) }

    /** Опустить слой на одну позицию ниже в z-order. */
    fun moveLayerDown(id: String) = mutateScene { it.moveDown(id) }

    /**
     * Задать трансформу слоя (Idea 25 шаг 4 + interview_006 Q3): [scale] доля кадра, [cx],[cy]
     * центр в [0,1] (0,0=верх-лево), [alpha] прозрачность, [rotation] поворот СОДЕРЖИМОГО слоя
     * внутри сцены (0/90/180/270 CW, «как в Photoshop»).
     */
    fun setLayerTransform(id: String, scale: Float, cx: Float, cy: Float, alpha: Float = 1f, rotation: Int = 0) {
        mutateScene {
            it.setTransform(
                id,
                LayerTransform(scale = scale, cx = cx, cy = cy, alpha = alpha, rotation = rotation),
            )
        }
        KLog.i(TAG, "Scene: set transform of layer id=$id → scale=$scale cx=$cx cy=$cy alpha=$alpha rot=$rotation°")
    }

    val isStreaming: Boolean get() = rtmpStream?.isStreaming == true
    val isOnPreview: Boolean get() = rtmpStream?.isOnPreview == true
}
