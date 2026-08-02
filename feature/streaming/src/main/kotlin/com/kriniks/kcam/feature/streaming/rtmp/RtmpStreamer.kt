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
import com.kriniks.kcam.feature.streaming.scene.CaptureSource
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.LayerTransform
import com.kriniks.kcam.feature.streaming.scene.Scene
import com.kriniks.kcam.feature.streaming.scene.StandbyImage
import com.kriniks.kcam.feature.streaming.scene.SceneProfileMeta
// plans/18 Ф2 — тип перехода сцены (модалка редактирования → сюда → композитор).
import com.kriniks.kcam.feature.streaming.scene.SceneTransition
import com.kriniks.kcam.feature.streaming.scene.persist.SceneProfileRepository
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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "RtmpStreamer"

// idea 40 / plans/18 Ф0 — окно debounce автосейва сцены: работа не теряется, но записи редки (жест
// трансформы шлёт правку каждый кадр — сохраняем только после паузы ~0.4с).
private const val SCENE_AUTOSAVE_DEBOUNCE_MS = 400L

// idea 37 — адаптивный битрейт: шаг снижения при затыке канала и шаг плавного восстановления к
// целевому (проценты от значения). ПОЛ деградации здесь больше НЕ живёт: он переехал в профиль
// кодера (`EncoderProfile.minVideoBitrateBps`, Room v7) по решению Криника Р7 — прежний хардкод
// 1 Мбит/с был ВЫШЕ полосы плохого 3G и потому сам ломал вижн «эфир не умирает» (plans/21 работа A).
// Абсолютный нижний предел санитайзера (защита от импорта с нулём/мусором) — [FLOOR_HARD_MIN_BPS].
private const val ADAPTIVE_DECREASE_PERCENT = 20
// interview_015 В2 (ответ Криника — вариант «в») — ВОССТАНОВЛЕНИЕ ПРИВЕДЕНО К ТОЙ ЖЕ ФОРМЕ, ЧТО И
// СНИЖЕНИЕ: процент от ТЕКУЩЕГО битрейта, а не от ЦЕЛИ. Прежние «+10% от цели» при цели 4000 давали
// шаг +400 — с пола 250 первый же шаг вверх выводил на 650, прыжок ×2.6 на канале, который только
// что не вытянул 250. Именно эта асимметрия (вниз — мультипликативно от current, вверх —
// аддитивно от target) и порождала «пилу», замеренную в plans/21 A4b. Теперь с пола 250 шаг = 300.
// 20% выбраны симметрично снижению; −20% и +20% при этом НЕ обратны друг другу (0.8 × 1.2 = 0.96),
// то есть подъём чуть консервативнее спуска — асимметрия, оставшаяся в нашу пользу.
private const val ADAPTIVE_RECOVER_PERCENT = 20
// interview_015 В2 — вторая половина ответа «в»: ПАУЗА ПОСЛЕ КАЖДОГО ОБРЫВА. Сколько эфир обязан
// идти БЕЗ обрывов, прежде чем лестница снова пойдёт вверх («даём каналу устояться»).
// Число выведено из watchdog, а не из головы: обречённый эфир умирает через [WATCHDOG_STALL_MS]
// (6 с) после того, как отправка встала, — значит пауза обязана быть ДЛИННЕЕ этого окна, иначе мы
// начинаем разгонять поток, который ещё не доказал, что вообще живёт. 10 с = окно watchdog 6 с +
// запас на дискретность шага адаптива (он ходит раз в 2 с).
private const val ADAPTIVE_RECOVER_HOLD_MS = 10_000L
// interview_016 В1 (ответ Криника — вариант «а») — КРЫША ЛЕСТНИЦЫ + ПРОБНЫЕ ШАГИ. Без крыши эфир
// на узком канале рвался раз в ~55 с (замер bugs/75 §10): лестница не помнила, что канал только что
// не вытянул, уходила выше его ёмкости в 5.7 раза и убивала собственный сокет. Крыша — это память
// «выше вот этого мы уже пробовали, и не вышло»; проба — «а вдруг канал починился».
// Период пробы — слово владельца дословно: «можно раз в минуту пробовать».
private const val ADAPTIVE_PROBE_MS = 60_000L
// interview_016 В1, вторая половина ответа дословно: «запоминаем битрейт, на котором эфир прожил
// БЕЗ ЗАТЫКА N СЕКУНД». Это N. Оно обязано быть БОЛЬШЕ задержки обнаружения затыка, иначе «доказан»
// будет уровень, на котором затык просто ещё не успел проявиться: замер (bugs/75 §10) дал задержку
// ~20 с при небольшом перелёте ёмкости. 30 с — заведомо больше, и при этом достаточно быстро, чтобы
// уровень успел стать доказанным между двумя пробами (те раз в минуту).
private const val ADAPTIVE_PROVEN_MS = 30_000L
// Абсолютный минимум пола (санитайзер). Профиль хранит НАМЕРЕНИЕ и может прийти из импорта с нулём
// или мусором; ниже этого значения видео перестаёт быть видео вообще.
private const val FLOOR_HARD_MIN_BPS = 50_000
// Период тикера телеметрии эфира; шаг адаптера — каждый второй тик (2с), чтобы не дёргать энкодер.
private const val LIVE_TICK_MS = 1000L
// Живучесть, УРОВЕНЬ 3 — сколько отправка может стоять при НЕПУСТОЙ очереди, прежде чем считать эфир
// мёртвым. Число из замера K5 (researches/network_resilience.md §14.1): очередь забивается за 3 с,
// с 7-й секунды теряется весь поток. 6 с = запас на легальные паузы и всё ещё < 1/10 окна платформы.
private const val WATCHDOG_STALL_MS = 6_000L

// ── Живучесть, УРОВЕНЬ 4 — пороги политики слейта (plans/21 работа C, шаг C3) ─────────────────
// Сколько эфир должен молчать, прежде чем зритель увидит замерший кадр и ленту. Число — РЕШЕНИЕ
// АГЕНТА, не владельца (в plans/21 §8 п.11 это записано прямо), и калибруется наблюдением:
// слишком мало — плашка мигает на каждом сетевом чихе, слишком много — зритель успевает уйти.
// 3 с выбраны как «заведомо больше одного пропущенного тика (1 с) и заведомо меньше, чем время,
// за которое зритель решает, что трансляция сломалась».
private const val SLATE_ENTER_OFFLINE_MS = 3_000L
// Вторая дверь входа: битрейт УЖЕ на полу адаптива и выход всё равно в затыке столько тиков подряд.
// Смысл — «лестница адаптива упёрлась, лучше картинки не будет»; один тик был бы шумом.
private const val SLATE_ENTER_CONGESTED_TICKS = 3

// ── ЖИВУЧЕСТЬ ЭФИРА (idea 43 «эфир завершает только кнопка Стоп», researches/network_resilience.md) ──
// УРОВЕНЬ 0 — гигиена библиотеки. Сглаживание onNewBitrate самой библиотекой: показания битрейта
// перестают скакать посекундно, адаптер битрейта (idea 37) видит тренд, а не шум.
private const val BITRATE_EXPONENTIAL_FACTOR = 0.5f

// УРОВЕНЬ 1 — бэкофф реконнекта. Экспонента 1.5 (модель OBS: reconnect_retry_exp) вместо 2: попытки
// учащённее в первые секунды, где блип чаще всего и лечится. Кап 15с — верхний темп «ждём сеть
// вечно, но не жжём батарею». Джиттер ±[RECONNECT_JITTER_PERCENT]% обязателен: без него 4 выхода
// мультистрима реконнектятся В ОДНУ секунду («стадо») и бьют в узкий аплинк одновременно.
private const val RECONNECT_BACKOFF_BASE_MS = 1000.0
private const val RECONNECT_BACKOFF_EXP = 1.5
private const val RECONNECT_BACKOFF_CAP_MS = 15_000L
private const val RECONNECT_JITTER_PERCENT = 10

// bug 45 — через сколько после нажатия «Запись» отсутствие первого записанного семпла считается
// подозрительным и попадает в лог предупреждением (сам бейдж при этом честно висит «ПОДГОТОВКА»).
private const val RECORD_START_WARN_MS = 5000L

// bug 45 S3 — «подталкивание» ключевого кадра на старте записи. MediaMuxer добавляет видеотрек ТОЛЬКО
// на КЛЮЧЕВОМ кадре и лишь когда известны ОБА формата (видео+аудио) — сверено байткодом
// AndroidMuxerRecordController.recordVideo. Первый IDR энкодера проскакивает, пока аудиоформат ещё не
// пришёл, а следующий по GOP — через iFrameInterval (2с) → запись реально начиналась на ~2.3с позже
// нажатия. Поэтому дёргаем requestKeyframe() серией коротких попыток, пока статус не станет RECORDING:
// как только оба формата на месте, ближайший запрошенный IDR открывает файл.
private const val KEYFRAME_NUDGE_ATTEMPTS = 12
private const val KEYFRAME_NUDGE_INTERVAL_MS = 150L

// plans/20 — страховка: сироты-продюсеры уходящей сцены не живут дольше, чем кап удержания
// (3с в композиторе) + длительность эффекта + запас. Если переход почему-то не доиграл — гасим сами.
private const val TRANSITION_WATCHDOG_BASE_MS = 3500L

@Singleton
class RtmpStreamer @Inject constructor(
    @ApplicationContext private val context: Context,
    // idea 40 / plans/18 Фаза 1 — набор ИМЕНОВАННЫХ сцен: restore активной на старте, автосейв, переключение,
    // CRUD. Разовый сев первой сцены из легаси Ф0-снапшота — внутри репозитория (SceneSnapshotRepository).
    private val sceneProfileRepo: SceneProfileRepository,
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
    // bug 45 — момент НАЖАТИЯ «Запись» (elapsedRealtime). Живёт от startRecordToFile до первого
    // RECORDING: по нему считается честный прогрев старта записи в лог. 0 = записи не запрашивали.
    private var recordStartRequestedAtMs = 0L
    // Текущий/целевой битрейт видео (бит/с). target = из профиля; current ходит вниз при затыке
    // канала и плавно восстанавливается к target на свободном канале (setVideoBitrateOnFly).
    private var currentVideoBitrateBps = 0
    private var targetVideoBitrateBps = 0
    // Пол адаптива (Р7): берётся из профиля кодера в startStream, санитайзится там же. 0 = эфир не
    // запущен. ВАЖНО: пол резолвится из профиля ПЕРВОГО выхода и действует на ОДИН общий энкодер
    // всех выходов (Р3 «консервативно» — один энкодер на мультистрим).
    private var floorVideoBitrateBps = 0
    // interview_015 В2 — момент (elapsedRealtime), с которого эфир идёт БЕЗ обрывов. 0 = эфира нет
    // ЛИБО он только что рвался. Лестница адаптива идёт ВВЕРХ только когда с этого момента прошло
    // [ADAPTIVE_RECOVER_HOLD_MS]. Обнуляется на КАЖДОМ обрыве живого выхода — в том числе когда
    // соседние выходы мультистрима остались живы: энкодер-то один на всех (Р3).
    private var adaptiveLiveSinceMs = 0L
    // interview_016 В1 — КРЫША: выше этого лестница не поднимается. 0 = крыши нет (в этом эфире
    // затыков ещё не было, ограничивать нечем и незачем — на широком канале поведение прежнее).
    // Ставится ровно там, где канал сам себя показал: при затыке крыша = тот уровень, на который мы
    // снизились. Обрыв крышу НЕ трогает — она уже хранит доказанное, а не догадку.
    private var adaptiveCeilingBps = 0
    // interview_016 В1 — момент, с которого ТЕКУЩИЙ УРОВЕНЬ битрейта держится без затыка
    // (elapsedRealtime); 0 = уровень только что менялся, эфира нет или идёт затык. Один счётчик на
    // две работы, и обе про «этот уровень стоит»: доказательство уровня ([ADAPTIVE_PROVEN_MS]) и
    // пробный шаг крыши ([ADAPTIVE_PROBE_MS]). Отличается от [adaptiveLiveSinceMs]: тот считает
    // «эфир без ОБРЫВОВ» (пауза В2) и переживает смену уровня.
    private var adaptiveLevelSinceMs = 0L
    // interview_016 В1 — ДОКАЗАННЫЙ УРОВЕНЬ: самый высокий битрейт, который эфир реально держал
    // [ADAPTIVE_PROVEN_MS] без затыка. 0 = ничего ещё не доказано. Это и есть «память канала», ради
    // которой владелец выбрал вариант (а): после обрыва выше доказанного не лезем.
    private var adaptiveProvenBps = 0

    // Живучесть, УРОВЕНЬ 4 — состояние политики слейта (plans/21 C3).
    // `slateOverride` — принуждение от харнеса (ВХОД политики, не второй писатель);
    // `slateActive`   — что политика реально применила (чтобы логировать только СМЕНУ состояния);
    // `slateCongestedTicks` — сколько тиков подряд держится «пол адаптива + затык» (дверь «б»).
    private var slateOverride = false
    private var slateActive = false
    private var slateCongestedTicks = 0

    // Живучесть, УРОВЕНЬ 3 — состояние watchdog замершего отправителя (plans/21 работа B).
    // Синхронизация не нужна: scope = Dispatchers.Main.immediate, колбэки библиотеки приходят туда же,
    // то есть тикер и колбэки сериализованы одним потоком.
    private val watchdogSentLast = HashMap<Int, Long>()      // индекс выхода → последняя сумма sentV+sentA
    private val watchdogFrozenSince = HashMap<Int, Long>()   // индекс выхода → когда счётчик замер (elapsedRealtime)
    private var watchdogLastTickAtMs = 0L                    // когда тикер отработал в прошлый раз
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

    // Живучесть, УРОВЕНЬ 1 (idea 43): потолка попыток БОЛЬШЕ НЕТ — раньше здесь стояло 5, и эфир
    // умирал НАВСЕГДА через ~23с пропажи сети (5 попыток × бэкофф). Теперь реконнект идёт, пока
    // пользователь не нажал Стоп; темп задаёт бэкофф с капом. Это значение осталось только как
    // аргумент библиотечного setReTries (её ВНУТРЕННИЙ счётчик должен быть > 0, см. onOutputFailed) —
    // терминальным условием оно больше не является.
    private val libraryReTriesBudget = 5

    // Живучесть, УРОВЕНЬ 1 — СЕССИЯ эфира/записи (в отличие от СОСТОЯНИЯ). Раньше FGS поднимался по
    // `state.isActive`: уход в Error гасил сервис и отпускал wake lock ровно тогда, когда мы
    // восстанавливаемся, — приложение само отрезало себе шанс вернуться в эфир. Теперь сессия жива от
    // Go Live до Стоп (или до изоляции ВСЕХ выходов) и переживает любые Error/Reconnecting внутри.
    private val _sessionActive = MutableStateFlow(false)
    val sessionActive: StateFlow<Boolean> = _sessionActive.asStateFlow()

    // Живучесть, УРОВЕНЬ 1 — момент, когда эфир перестал идти (нет ни одного живого выхода), для
    // честного счётчика «эфир не идёт: NN с» в статус-виджете. 0 = эфир идёт нормально.
    private var offlineSinceMs = 0L
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
        // plans/20 D3 — «переход доиграл» → гасим продюсеров уходящей сцены, которых держали живыми
        // (Криник: источники стримят, ПОКА идёт переход, и гаснут только после него).
        compositorSource.onTransitionFinished = {
            scope.launch(Dispatchers.Main.immediate) { flushRetiredProducers("переход доиграл") }
        }
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
        /**
         * plans/20 (Криник: «уходящий слой жив, пока не зафейдится») — погасить ОТЛОЖЕННЫЕ действия
         * продюсера (напр. reopen Фазы-2 у UVC, bug 25), НЕ закрывая камеру. Нужно, когда слой ушёл из
         * сцены, но его продюсер намеренно оставлен живым до конца перехода: проснувшийся reopen не
         * должен переоткрыть общий AUSBC-объект в уходящую поверхность. Дефолт — пусто (не у всех есть).
         */
        fun cancelPendingReopen() {}
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
        // bug 68 — БЕСШОВНОЕ переключение сцен: :app пересоздаёт опенер на каждую смену набора слоёв
        // (switchScene), и для UVC/встроенной это раньше значило close()+open() ФИЗ-камеры (AUSBC-реинит
        // ~1.5с и флакий → чёрный прямоугольник / заглушка Pico+, редко успевает стартовать). Если НОВЫЙ
        // опенер целит в ТОТ ЖЕ физ-источник (sourceKey совпал), а старый ещё ЖИВ — НЕ переоткрываем:
        // оставляем живого продюсера, его слот продолжает получать кадры без разрыва. Так две сцены на одном
        // Pico+ переключаются бесшовно. (Смена физ-источника или мёртвый продюсер — идём обычным путём ниже.)
        if (opener != null && old != null && old.isAlive &&
            opener.sourceKey != null && opener.sourceKey == old.sourceKey) {
            KLog.d(TAG, "setCameraOpener[$layerId]: тот же физ-источник (${opener.sourceKey}) и продюсер жив — БЕЗ переоткрытия (bug 68)")
            return
        }
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
                    cameraLayerSurfaces[layerId]?.let { openProducer(layerId, opener, it) }
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
            if (st != null) openProducer(layerId, opener, st)
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

    // idea 40 / plans/18 Фаза 1 — набор именованных сцен для UI: список сцен + активная. stateIn на [scope]
    // (Singleton живёт всё время приложения). Панель-менеджер и харнес читают отсюда.
    val scenesList: StateFlow<List<SceneProfileMeta>> =
        sceneProfileRepo.observeScenes().stateIn(scope, SharingStarted.Eagerly, emptyList())
    val activeSceneId: StateFlow<Long?> =
        sceneProfileRepo.activeSceneId.stateIn(scope, SharingStarted.Eagerly, null)

    // idea 40 / plans/18 Ф0/Ф1 — персист сцены. ОТДЕЛЬНЫЙ init ПОСЛЕ [scope] (init-блоки и инициализаторы
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
        // Живучесть, УРОВЕНЬ 1 — засекаем НАЧАЛО молчания эфира: как только не осталось ни одного
        // живого выхода. Пока хоть один в эфире — счётчик снят (0). Читается статус-виджетом, чтобы
        // Криник видел не безликое «подключение», а честное «эфир не идёт: NN с».
        offlineSinceMs = when {
            anyLive -> 0L
            offlineSinceMs != 0L -> offlineSinceMs
            else -> android.os.SystemClock.elapsedRealtime()
        }
        _state.value = when {
            anyLive -> StreamState.Live(
                // idea 37 — durationMs ПЕРЕНОСИМ из текущего Live (иначе каждый пересчёт обнулял бы
                // таймер эфира); битрейт = сумма живых выходов.
                durationMs = (_state.value as? StreamState.Live)?.durationMs ?: 0,
                bitrateKbps = outs.filter { it.phase == OutputPhase.Live }.sumOf { it.bitrateKbps },
                outputs = outs,
            )
            // bug 45 — Connecting стал data class (эфир: isRecording=false); живучесть ур.1 — та же
            // фаза несёт номер попытки реконнекта и длительность молчания эфира.
            anyPending -> StreamState.Connecting(
                reconnectAttempt = outs.maxOfOrNull { it.attempt } ?: 0,
                offlineMs = if (offlineSinceMs == 0L) 0L
                    else android.os.SystemClock.elapsedRealtime() - offlineSinceMs,
            )
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
                // Живучесть, УРОВЕНЬ 0 — заодно снимаем ЖИВЫЕ счётчики библиотеки: сколько кадров
                // реально ушло, сколько дропнуто, сколько пакетов застряло в очереди отправки.
                // Это и есть пульс: по нему (и только по нему) видно, идёт ли эфир на самом деле.
                val stream = rtmpStream
                var droppedTotal = 0L
                // Живучесть, УРОВЕНЬ 3 — общий для всех выходов признак «сам тикер проспал»: процесс
                // мог быть заморожен системой (doze/freezer) — elapsedRealtime в это время идёт, а
                // корутина тикера нет. Без этой проверки первое же пробуждение выглядело бы как
                // многоминутная тишина отправителя и дало бы мгновенный ложный реконнект.
                val now = android.os.SystemClock.elapsedRealtime()
                val tickGapMs = if (watchdogLastTickAtMs == 0L) 0L else now - watchdogLastTickAtMs
                watchdogLastTickAtMs = now
                val tickerOverslept = tickGapMs > 2 * LIVE_TICK_MS
                if (tickerOverslept) {
                    KLog.w(TAG, "watchdog: тикер проспал ${tickGapMs}мс (заморозка процесса?) — состояние сброшено")
                    watchdogSentLast.clear()
                    watchdogFrozenSince.clear()
                }
                if (stream != null) {
                    outputStates.keys.toList().forEach { i ->
                        val live = outputStates[i]?.phase == OutputPhase.Live
                        val client = runCatching { stream.getStreamClient(MultiType.RTMP, i) }.getOrNull()
                        if (live) {
                            val congested = simulatedCongestion ||
                                runCatching { client?.hasCongestion() ?: false }.getOrDefault(false)
                            updateOutput(i) { it.copy(congested = congested) }
                        }
                        // Метрики снимаем ОДИН раз в переменные — и в лог, и в watchdog идут ОДНИ И ТЕ
                        // ЖЕ числа. Иначе возможна ситуация «в логе одно, в решении другое», при которой
                        // разбор инцидента по логу вводит в заблуждение.
                        // Не полагаемся на getCacheSize(): в 2.4.7 он врёт после resizeCache (починено
                        // только в 2.8.0) — мерим ТОЛЬКО фактическое число пакетов в очереди.
                        val cache = runCatching { client?.getItemsInCache() ?: -1 }.getOrDefault(-1)
                        val sentV = runCatching { client?.getSentVideoFrames() ?: -1L }.getOrDefault(-1L)
                        // sentA (уровень 3): видео и звук тянет ОДИН consumer-цикл из ОДНОЙ очереди
                        // (RtmpSender, проверено байткодом), поэтому затык сокета морозит ОБА счётчика,
                        // а смерть видеоисточника — только видео. Сумма отличает одно от другого.
                        val sentA = runCatching { client?.getSentAudioFrames() ?: -1L }.getOrDefault(-1L)
                        val dropV = runCatching { client?.getDroppedVideoFrames() ?: -1L }.getOrDefault(-1L)
                        droppedTotal += dropV.coerceAtLeast(0L)
                        // Пульс пишем по КАЖДОМУ выходу отдельно — в мультистриме тонет обычно один.
                        val st2 = outputStates[i]
                        if (st2 != null) {
                            // bug 80 — `src` = возраст последнего кадра самого протухшего слоя-камеры.
                            // Все остальные числа пульса про СЕТЬ; это единственное про ИСТОЧНИК.
                            // Отказ источника при здоровой сети (Live, cache=0, dropV=0, а в эфире
                            // брендовая заглушка) виден только здесь — растущий `src` и есть улика.
                            KLog.i(TAG, "пульс[$i] ${st2.phase} bitrate=${st2.bitrateKbps}kbps " +
                                "cache=$cache sentV=$sentV sentA=$sentA dropV=$dropV " +
                                "congested=${st2.congested} attempt=${st2.attempt} " +
                                "src=${compositorSource.oldestFrameAgeMs}мс")
                        }
                        // Живучесть, УРОВЕНЬ 3 — детектор замершего отправителя. Стоит ЗДЕСЬ, сразу
                        // после пульса, чтобы судить ровно по опубликованным числам.
                        if (!tickerOverslept) senderWatchdogStep(i, st2?.phase, cache, sentV, sentA, now)
                    }
                }
                // Живучесть, УРОВЕНЬ 4 — политика слейта. Стоит ПОСЛЕ цикла по выходам: решение
                // принимается по состоянию ВСЕХ выходов сразу (один живой выход отменяет слейт).
                if (!tickerOverslept) updateSlatePolicy(now)
                if (st is StreamState.Live) {
                    val outs = outputStates.values.sortedBy { it.index }
                    // bug 70 — у битрейта ДВА разных источника правды, и зависят они от РЕЖИМА:
                    //   • эфир   → сумма живых RTMP-выходов (idea 37, честный суммарный аплинк);
                    //   • ЗАПИСЬ в файл → колбэк RecordController (`recordListener.onNewBitrate`).
                    // При записи RTMP-выходов нет вовсе, поэтому сумма по пустому множеству давала 0 и
                    // РАЗ В СЕКУНДУ затирала честное значение записи → пилюля мигала «0,0 Mbps».
                    // Пустой набор выходов = режим записи → битрейт не трогаем, его ведёт колбэк.
                    // (`droppedFrames` при этом честно 0: дропов RTMP в режиме записи и не существует,
                    //  а состояние Live для записи создаётся заново — старое значение не протекает.)
                    val recordingOnly = outs.isEmpty()
                    _state.value = st.copy(
                        durationMs = android.os.SystemClock.elapsedRealtime() - streamStartedAtMs,
                        bitrateKbps = if (recordingOnly) st.bitrateKbps
                                      else outs.filter { it.phase == OutputPhase.Live }.sumOf { it.bitrateKbps },
                        // Живучесть, УРОВЕНЬ 0 — дропы БОЛЬШЕ НЕ ВРУТ: поле годами было константным
                        // нулём (никто не читал getDroppedVideoFrames), и развёрнутая карточка статуса
                        // молчала о потерях. Теперь это факт от библиотеки, а не заглушка.
                        droppedFrames = droppedTotal.toInt(),
                        outputs = outs,
                    )
                } else if (st is StreamState.Connecting) {
                    // Живучесть, УРОВЕНЬ 1 — пока эфир восстанавливается, состояние тоже обязано
                    // тикать: иначе счётчик «эфир не идёт: NN с» замрёт на первой секунде.
                    recomputeAggregateState()
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
     * Живучесть, УРОВЕНЬ 3 — WATCHDOG ЗАМЕРШЕГО ОТПРАВИТЕЛЯ (plans/21 работа B).
     *
     * Закрывает классы отказа K4 («чёрная дыра»: TCP-запись висит, ошибки нет) и K5 («зомби-сервер»:
     * приёмник держит соединение, но не читает). Оба маскируются под «всё хорошо»: замер 2026-07-28
     * показал, что за 3.6 МИНУТЫ полной блокировки записи библиотека не прислала НИ ОДНОГО события,
     * а UI держал зелёный Live — при том что уже с 7-й секунды терялся весь поток целиком
     * (researches/network_resilience.md §14.1). Именно эти минуты съедают окно платформы (~60 с у
     * YouTube), ради которого вся живучесть и делается.
     *
     * Порядок гардов важен — каждый отсекает СВОЙ вид законной тишины:
     *  1. фаза не Live — Connecting/Reconnecting молчат легально;
     *  2. счётчик отправки сдвинулся — эфир идёт, отметить время и выйти (сравнение строго на
     *     неравенство, НЕ «меньше»: RtmpSender.stop() обнуляет счётчики, и новая эпоха стартует с нуля);
     *  3. очередь ПУСТА — отправлять просто нечего. Это единственный гард законных пауз, и он
     *     закрывает сразу три случая: старт эфира до первого ключевого кадра, молчащий источник
     *     (сломался GL/камера — реконнект это не лечит и убил бы ЖИВОЙ звук) и заморозку процесса;
     *  4. замерло, но ещё не дольше порога — ждём.
     *
     * Порог [WATCHDOG_STALL_MS] — из замера, а не из головы: очередь забивается за 3 с, к 7-й секунде
     * поток теряется полностью, поэтому 6 с дают запас на легальные паузы и всё ещё оставляют
     * платформе больше 50 с её окна.
     *
     * Своего лечения тут НЕТ намеренно: срабатывание уходит в [onOutputFailed] с retriable=true, где
     * уже живут бэкофф, setReTries, reTry, гард сессии и агрегат состояния (уровень 1).
     * [TESTED: 2026-07-28 · B4 — freeze приёмника: срабатывание через 6 с после замирания счётчиков,
     * реконнект пошёл, после thaw эфир вернулся за 3 с; B6 — 11 минут чистого эфира и легальные паузы
     * (5× scene-switch, 45 с затыка, 2 минуты в фоне с погашенным экраном) дали 0 ложных срабатываний.
     * НЕ проверено: мультистрим/изоляция по индексу (bugs/74 блокирует полигон)]
     */
    private fun senderWatchdogStep(index: Int, phase: OutputPhase?, cache: Int, sentV: Long, sentA: Long, now: Long) {
        if (phase != OutputPhase.Live) {
            watchdogSentLast.remove(index); watchdogFrozenSince.remove(index); return
        }
        val sentTotal = sentV + sentA
        if (watchdogSentLast[index] != sentTotal) {
            watchdogSentLast[index] = sentTotal
            watchdogFrozenSince[index] = now
            return
        }
        // cache <= 0 покрывает и «очередь пуста», и «счётчик не прочитался» (-1): при неизвестной
        // очереди рвать живой эфир нельзя — недоказанная авария не повод для реконнекта.
        if (cache <= 0) { watchdogFrozenSince[index] = now; return }
        val since = watchdogFrozenSince.getOrPut(index) { now }
        val stalledMs = now - since
        if (stalledMs < WATCHDOG_STALL_MS) return
        KLog.e(TAG, "watchdog[$index]: отправка стоит ${stalledMs / 1000}с при непустой очереди " +
            "(cache=$cache sentV=$sentV sentA=$sentA) — считаем эфир мёртвым, идём в реконнект")
        watchdogSentLast.remove(index); watchdogFrozenSince.remove(index)
        onOutputFailed(index, "watchdog: нет отправки ${stalledMs / 1000}с", retriable = true)
    }

    /**
     * Шаг адаптера битрейта (idea 37): затык ЛЮБОГО живого выхода → минус
     * [ADAPTIVE_DECREASE_PERCENT]% от ТЕКУЩЕГО (пол — [floorVideoBitrateBps] из профиля кодера, Р7);
     * канал чист и current < target → плюс [ADAPTIVE_RECOVER_PERCENT]% от ТЕКУЩЕГО (потолок target).
     * Энкодер ОДИН на все выходы → правим глобально setVideoBitrateOnFly. Деградируем КАЧЕСТВОМ,
     * а не плавностью.
     *
     * ОБЕ СТОРОНЫ ЛЕСТНИЦЫ — ОДНОЙ ФОРМЫ, и это ответ владельца, а не вкус агента (interview_015 В2,
     * вариант «в»). Раньше вниз шли мультипликативно от current, а вверх — аддитивно от ЦЕЛИ, и эта
     * асимметрия сама по себе давала пилу: с пола 250 первый же шаг вверх при цели 4000 выводил на
     * 650 — в 2.6 раза выше канала, который только что не вытянул 250 (замер plans/21 A4b).
     * Вторая половина того же ответа — ПАУЗА: вверх лестница трогается, только когда эфир прожил
     * без обрывов [ADAPTIVE_RECOVER_HOLD_MS] (часы [adaptiveLiveSinceMs]). Снижение паузы НЕ знает
     * и знать не должно: реагировать на затык надо немедленно, ждут только с подъёмом.
     *
     * У ЛЕСТНИЦЫ ЕСТЬ КРЫША (interview_016 В1, ответ владельца «а») — [adaptiveCeilingBps]. Без неё
     * замер дал петлю с периодом ~55 с даже после В1/В2 (bugs/75 §10): лестница шла к цели, потому
     * что ей нечем было вспомнить, что канал этого уже не вытянул. Три правила, и все три —
     * наблюдение, а не догадка:
     *  • крышу ставит САМ ЗАТЫК (уровень после снижения) — «выше того, где поймали затык, не лезем»;
     *  • пока затыка не было ни разу, крыши НЕТ (0) — на широком канале ничего не меняется;
     *  • раз в [ADAPTIVE_PROBE_MS] спокойного эфира крыша поднимается на один шаг (проба «а вдруг
     *    канал починился»); часы спокойствия — [adaptiveCalmSinceMs], их сбивает и затык, и обрыв.
     * Крыша живёт один эфир: Стоп → Старт снимает её (сеть могла смениться целиком).
     *
     * Про пол (важно для будущих сессий): он берётся из профиля кодера ПЕРВОГО выхода и действует на
     * общий энкодер всех выходов — следствие решения Р3 «мультистрим консервативно, один энкодер».
     * Логи печатают НАМЕРЕНИЕ: `setVideoBitrateOnFly` молча выходит, если энкодер не запущен
     * (проверено байткодом, plans/21 Ш0), поэтому факт доказывает только пульс/приёмник.
     *
     * ОБЕ ветки требуют живого выхода — и это не симметрия ради красоты (bug 75, 2026-07-31).
     * Пока гард `phase == Live` стоял только в ветке снижения, в фазе Reconnecting выходило так:
     * живых выходов нет → `anyCongested = false` → управление проваливалось в ветку восстановления
     * и растило битрейт НА ОСНОВАНИИ ОТСУТСТВИЯ СВЕДЕНИЙ, печатая при этом «канал чист» про канал,
     * о котором ничего не известно. На узком живом канале (класс K1) это давало несходящуюся петлю:
     * эфир умирал, за время реконнекта адаптив возвращался на ПОТОЛОК, эфир воскресал на 4000 кбит/с
     * в трубу на 300 и ложился снова — цикл ~12 с без конца, прямо против вижна «эфир завершает
     * только кнопка Стоп». Замер и форензика — bugs/75.
     */
    private fun adaptiveBitrateStep() {
        if (!adaptiveBitrateEnabled || targetVideoBitrateBps <= 0) return
        val stream = rtmpStream ?: return
        // Нет ни одного живого выхода — о канале НИЧЕГО не известно, и это не повод ни снижать,
        // ни поднимать. Молчание источника данных ≠ хорошая новость.
        val anyLive = outputStates.values.any { it.phase == OutputPhase.Live }
        val anyCongested = outputStates.values.any { it.phase == OutputPhase.Live && it.congested }
        // interview_015 В2 — часы «эфир идёт без обрывов». Ведём их ЗДЕСЬ, а не в колбэках: шаг
        // адаптива — единственный, кто ими пользуется. Обрыв обнуляет часы в [onLiveOutputBroken];
        // здесь же ловится и случай «выход перестал быть Live без сбоя» (штатные фазы Connecting).
        // Цена простоты: шаг ходит раз в 2 тика, поэтому фактическая пауза равна 10–12 с, а не ровно
        // 10 — для «дать каналу устояться» дискретность в один шаг несущественна.
        val now = android.os.SystemClock.elapsedRealtime()
        if (!anyLive) adaptiveLiveSinceMs = 0L
        else if (adaptiveLiveSinceMs == 0L) adaptiveLiveSinceMs = now
        val settled = adaptiveLiveSinceMs != 0L && now - adaptiveLiveSinceMs >= ADAPTIVE_RECOVER_HOLD_MS

        // interview_016 В1 — сколько ТЕКУЩИЙ уровень держится без затыка. Из этого числа растут обе
        // половины ответа владельца: доказательство уровня и пробный шаг крыши.
        if (!anyLive || anyCongested) adaptiveLevelSinceMs = 0L
        else if (adaptiveLevelSinceMs == 0L) adaptiveLevelSinceMs = now
        val heldMs = if (adaptiveLevelSinceMs == 0L) 0L else now - adaptiveLevelSinceMs

        // «Запоминаем битрейт, на котором эфир прожил без затыка N секунд» — вот он.
        if (heldMs >= ADAPTIVE_PROVEN_MS && currentVideoBitrateBps > adaptiveProvenBps) {
            KLog.i(TAG, "adaptive: уровень ${currentVideoBitrateBps / 1000} kbps ДОКАЗАН " +
                "(держится ${heldMs / 1000}с без затыка) — ниже него после обрыва не падаем")
            adaptiveProvenBps = currentVideoBitrateBps
        }
        // Проба идёт ДО расчёта шага, чтобы поднятая крыша сработала тем же тиком, а не через два.
        if (adaptiveCeilingBps > 0 && heldMs >= ADAPTIVE_PROBE_MS && adaptiveCeilingBps < targetVideoBitrateBps) {
            val raised = (adaptiveCeilingBps + adaptiveCeilingBps * ADAPTIVE_RECOVER_PERCENT / 100)
                .coerceAtMost(targetVideoBitrateBps)
            KLog.i(TAG, "adaptive: крыша ${adaptiveCeilingBps / 1000}→${raised / 1000} kbps " +
                "(проба: ${ADAPTIVE_PROBE_MS / 1000}с спокойного эфира — вдруг канал починился, interview_016)")
            adaptiveCeilingBps = raised
            adaptiveLevelSinceMs = now     // следующая проба — через минуту ПОСЛЕ этой, а не сразу
        }
        // Потолок подъёма: цель профиля, а при живой крыше — она (крыша всегда ниже или равна цели).
        val climbLimit = if (adaptiveCeilingBps > 0) minOf(targetVideoBitrateBps, adaptiveCeilingBps)
                         else targetVideoBitrateBps

        val next = when {
            anyCongested ->
                (currentVideoBitrateBps * (100 - ADAPTIVE_DECREASE_PERCENT) / 100)
                    .coerceAtLeast(floorVideoBitrateBps)
            anyLive && settled && currentVideoBitrateBps < climbLimit ->
                (currentVideoBitrateBps + currentVideoBitrateBps * ADAPTIVE_RECOVER_PERCENT / 100)
                    .coerceAtMost(climbLimit)
            else -> currentVideoBitrateBps
        }
        // interview_016 В1 — крышу ставит САМ ЗАТЫК: уровень, с которого мы только что снизились,
        // канал доказанно не тянет, значит выше нового значения лезть больше не за чем. Пока затык
        // держится, крыша едет вниз вместе с лестницей — и в пределе садится на пол.
        if (anyCongested && next != adaptiveCeilingBps) {
            KLog.i(TAG, "adaptive: крыша ${if (adaptiveCeilingBps == 0) "—" else "${adaptiveCeilingBps / 1000}"}" +
                "→${next / 1000} kbps (затык на ${currentVideoBitrateBps / 1000} — выше не лезем, interview_016)")
            adaptiveCeilingBps = next
        }
        if (next != currentVideoBitrateBps) {
            KLog.i(TAG, "adaptive: битрейт ${currentVideoBitrateBps / 1000}→${next / 1000} kbps " +
                "(${if (anyCongested) "затык канала — снижаем" else "канал чист ${(now - adaptiveLiveSinceMs) / 1000}с — восстанавливаем"})")
            currentVideoBitrateBps = next
            adaptiveLevelSinceMs = now     // уровень сменился — «сколько держится» считаем заново
            runCatching { stream.setVideoBitrateOnFly(next) }
                .onFailure { KLog.w(TAG, "adaptive: setVideoBitrateOnFly не прошёл: ${it.message}") }
        }
    }

    /**
     * interview_015 В1 (ответ Криника — вариант «а») — ЖИВОЙ выход [index] оборвался: эфир
     * возобновляем **с ПОЛА профиля кодера**, а не с того битрейта, на котором он умер.
     *
     * Зачем. Даже с гардом bug 75 (лестница не растёт, пока эфира нет) поток воскресал ровно на том
     * битрейте, на котором лёг — в замере 2048 кбит/с в канал на 300, — и ложился снова. Пол следует
     * из вижна «эфир завершает только кнопка Стоп» (idea 43): приоритет у того, чтобы поток НЕ
     * рвался, а не у того, чтобы он был красивым.
     *
     * ЧЕСТНАЯ ГРАНИЦА, ЗАМЕРЕННАЯ 2026-07-31 (bugs/75 §10): петлю это НЕ убирает, а замедляет —
     * период разрыва 12 с → 53–59 с на полосе 450. Эфир на полу действительно живёт, но через
     * [ADAPTIVE_RECOVER_HOLD_MS] лестница снова уходит к цели, перелетает ёмкость канала в ~5.7
     * раза и убивает сокет заново. Причина — у лестницы нет памяти о доказанном уровне; развилка
     * «крыша после обрыва» у владельца (interviews/interview_016). Не считать это место закрытым.
     *
     * Цена названа владельцу и им принята: случайный обрыв (моргнул Wi-Fi) тоже уронит картинку на
     * пол, и лестница будет выкарабкиваться десятки секунд. Отличить «канал не тянет» от «сервер
     * перезагрузился» приложению в момент обрыва НЕЧЕМ, а ошибаться безопаснее в сторону стоящего
     * эфира. Правило поэтому одно и без спец-случаев: оборвался живой выход — идём на пол.
     *
     * Правим ЗДЕСЬ, в момент обрыва, а не на успехе реконнекта: retriable-путь энкодер не гасит, он
     * продолжает работать всю фазу Reconnecting, поэтому воскресший сокет с первого же пакета
     * получает поток на полу — и между фазами ничего не надо помнить (нет новой сущности-памяти,
     * которую владелец отклонил вариантом «в»).
     *
     * Мультистрим: энкодер ОДИН на все выходы (Р3 «консервативно»), поэтому обрыв одного выхода
     * роняет битрейт и живым соседям. Это та же принятая цена, что у ветки снижения и у слейта, —
     * и, как там, она обязана быть видна в логе.
     */
    private fun onLiveOutputBroken(index: Int, reason: String) {
        // interview_015 В2 — «пауза после каждого обрыва»: часы «эфир идёт без обрывов» сброшены,
        // подъём лестницы отложен на ADAPTIVE_RECOVER_HOLD_MS ПОСЛЕ возвращения эфира.
        adaptiveLiveSinceMs = 0L
        // interview_016 — обрыв обнуляет часы уровня: и доказательство, и минута до пробы считаются
        // заново, иначе крыша поднялась бы сразу после возвращения эфира, ничего не доказавшего.
        adaptiveLevelSinceMs = 0L
        // interview_016 В1 — КРЫША САДИТСЯ НА ДОКАЗАННЫЙ УРОВЕНЬ. Обрыв означает ровно одно: всё,
        // что выше доказанного, этот канал сейчас не держит. Замер без этого правила (лог k1e):
        // крыша сползала по одному шагу за затык, эфир успевал умереть раньше, чем она доходила до
        // рабочего уровня, — 2048 → 951 → … за обрыв каждые ~39 с. С правилом путь короче: обрыв
        // сажает крышу сразу на то, что канал ДОКАЗАННО тянул.
        // Если доказать ничего не успели (обрыв в первые секунды) — крыша = пол: самый безопасный
        // уровень, который вообще есть, а пробы поднимут её обратно раз в минуту.
        val proven = maxOf(adaptiveProvenBps, floorVideoBitrateBps)
        if (adaptiveCeilingBps == 0 || adaptiveCeilingBps > proven) {
            KLog.i(TAG, "adaptive: крыша ${if (adaptiveCeilingBps == 0) "—" else "${adaptiveCeilingBps / 1000}"}" +
                "→${proven / 1000} kbps (обрыв: выше доказанного не лезем" +
                "${if (adaptiveProvenBps == 0) ", доказанного нет — берём пол" else ""}, interview_016)")
            adaptiveCeilingBps = proven
        }
        // Адаптив выключен в профиле = приложение битрейтом не управляет вовсе. Тогда и здесь не лезем.
        if (!adaptiveBitrateEnabled || floorVideoBitrateBps <= 0) return
        if (currentVideoBitrateBps <= floorVideoBitrateBps) return
        val stream = rtmpStream ?: return
        KLog.i(TAG, "adaptive: битрейт ${currentVideoBitrateBps / 1000}→${floorVideoBitrateBps / 1000} kbps " +
            "(обрыв живого выхода[$index]: $reason — возобновляем с пола профиля, interview_015 В1)")
        currentVideoBitrateBps = floorVideoBitrateBps
        runCatching { stream.setVideoBitrateOnFly(floorVideoBitrateBps) }
            .onFailure { KLog.w(TAG, "adaptive: setVideoBitrateOnFly не прошёл: ${it.message}") }
    }

    /** Debug-харнес (CMD simulate-congestion, idea 37): наблюдаемая приёмка петли без плохой сети. */
    fun setSimulatedCongestion(on: Boolean) {
        simulatedCongestion = on
        KLog.i(TAG, "simulate-congestion: ${if (on) "ON — адаптер увидит затык" else "OFF — канал «чист»"}")
    }

    /**
     * Debug-харнес (CMD simulate-slate, plans/21 работа C): ПРИНУДИТЕЛЬНО включить сетевой слейт,
     * не дожидаясь настоящей просадки сети. На этой ручке держится вся приёмка C1/C2.
     *
     * Это **ВХОД политики**, а не второй писатель: итог считает `updateSlatePolicy` как
     * `want = override || policy`. Иначе политика, которая крутится в тикере раз в секунду, молча
     * затёрла бы override меньше чем за секунду — и приёмка ловила бы собственный хвост.
     * `off` не «выключает слейт», а снимает принуждение: дальше решает политика.
     *
     * [TESTED: 2026-07-29 · слейт включался и выключался этой командой на живом эфире, наблюдалось
     *  кадрами с сервера (PSNR 23→68→15 дБ, лента появлялась и исчезала).]
     */
    fun setSimulatedSlate(on: Boolean) {
        slateOverride = on
        KLog.i(TAG, "simulate-slate: ${if (on) "ON — принудительный слейт" else "OFF — решает политика"}")
        // Применяем немедленно, не дожидаясь следующего тика: приёмка снимает кадр через пару секунд.
        updateSlatePolicy(android.os.SystemClock.elapsedRealtime())
    }

    /**
     * Живучесть, УРОВЕНЬ 4 — ПОЛИТИКА СЛЕЙТА (plans/21 работа C, шаг C3).
     * Решает, должен ли зритель сейчас видеть замерший кадр с лентой. Зовётся раз в тик из
     * `startLiveTicker` и из [setSimulatedSlate].
     *
     * ДВЕ ДВЕРИ ВХОДА (обе — про «лучше уже не будет»):
     *  (а) **молчание** — ни одного выхода в фазе Live дольше [SLATE_ENTER_OFFLINE_MS];
     *  (б) **пол адаптива + затык** — битрейт уже упёрся в пол профиля кодера, а живой выход всё
     *      равно сообщает `congestion` [SLATE_ENTER_CONGESTED_TICKS] тиков подряд.
     *
     * ВЫХОД — НЕМЕДЛЕННЫЙ, на первом же тике, где условия отпали. Никакого «N чистых тиков»:
     * сокет либо есть, либо нет, а лишний дебаунс стоит зрителю секунд фриза на уже воскресшем эфире.
     *
     * Чего здесь НЕТ и быть не должно: собственного битрейта слейта. Битрейтом владеет одна лестница
     * адаптива с полом из работы A — второй контроллер дал бы автоколебание «слейт вкл/выкл» и
     * вечную деградацию при выключенном адаптиве (plans/21, раздел «что НЕ делаем»).
     *
     * [TESTED: 2026-07-29 · полигон MediaMTX, живой эфир с виртуалки. (1) НЕГАТИВ: на чистом эфире
     *  `grep -c 'слейт ВКЛ'` = 0 — ложных входов нет. (2) ВХОД: `rtmp-server stop` → через 3 с в логе
     *  «слейт ВКЛ — эфир молчит 3с». (3) ВЫХОД: `rtmp-server start` → «слейт ВЫКЛ — эфир снова идёт»
     *  в ту же секунду, когда сервер напечатал `is publishing`. Прогон повторён дважды.
     *  Дверь (б) «пол адаптива + затык» этим прогоном НЕ проверена — для неё нужен узкий канал
     *  (дроссель `tools/net-chaos.mjs`, которого ещё нет); остаётся на C6.]
     */
    private fun updateSlatePolicy(now: Long) {
        // Запись в файл слейта не касается: там нет ни сети, ни выходов (bug 70 — тот же признак режима).
        if (outputStates.isEmpty()) {
            slateCongestedTicks = 0
            if (slateActive) applySlate(false, "режим записи — слейт не применяется")
            return
        }
        val anyLive = outputStates.values.any { it.phase == OutputPhase.Live }

        // Дверь (а): эфир молчит дольше порога. offlineSinceMs ведёт recomputeAggregateState.
        val offlineFor = if (offlineSinceMs == 0L) 0L else now - offlineSinceMs
        val byOffline = !anyLive && offlineFor >= SLATE_ENTER_OFFLINE_MS

        // Дверь (б): лестница адаптива на полу, а затык не уходит. Считаем ТОЛЬКО когда есть живой
        // выход — иначе это дверь (а), и смешивать их нельзя.
        val onFloor = floorVideoBitrateBps > 0 && currentVideoBitrateBps in 1..floorVideoBitrateBps
        val congestedLive = outputStates.values.firstOrNull { it.phase == OutputPhase.Live && it.congested }
        slateCongestedTicks = if (anyLive && onFloor && congestedLive != null) slateCongestedTicks + 1 else 0
        val byCongestion = slateCongestedTicks >= SLATE_ENTER_CONGESTED_TICKS

        val want = slateOverride || byOffline || byCongestion
        if (want == slateActive) return
        // В лог — ПО ЧЬЕЙ вине. Р3 («консервативно», решение Криника) означает, что один тонущий выход
        // включает слейт для ВСЕХ: это принятая цена, но она обязана быть видна, иначе читается как баг.
        // Причину ВЫКЛючения считаем отдельно: подставлять сюда описание двери входа — значит писать в
        // лог заведомую неправду («выход[null] в затыке» в момент, когда эфир как раз восстановился).
        val why = if (!want) {
            if (anyLive) "эфир снова идёт" else "условия слейта отпали"
        } else when {
            slateOverride -> "принудительно (harness)"
            byOffline -> "эфир молчит ${offlineFor / 1000}с"
            else -> "выход[${congestedLive?.index}] в затыке на полу ${currentVideoBitrateBps / 1000}кбит/с"
        }
        applySlate(want, why)
    }

    /** Единственная точка, где политика двигает слейт: держит [slateActive] и композитор синхронно. */
    private fun applySlate(active: Boolean, why: String) {
        slateActive = active
        compositorSource.setNetworkSlate(active)
        KLog.i(TAG, "слейт ${if (active) "ВКЛ" else "ВЫКЛ"} — $why")
    }

    /**
     * Живучесть, УРОВЕНЬ 0 — гигиена RTMP-клиента выхода [index] ПЕРЕД подключением.
     * Обе ручки штатные (RootEncoder 2.4.7), обе раздаются строго по индексу выхода:
     *  • `setLogs(false)` — библиотека по умолчанию пишет Log.i на КАЖДЫЙ отправленный пакет
     *    (~80 строк в секунду на выход). В мультистриме это забивает logcat так, что наш собственный
     *    пульс и форензика обрыва тонут — а именно по логу мы диагностируем сеть (EXP-0012).
     *  • `setBitrateExponentialFactor` — сглаживание отдаваемого битрейта: показание перестаёт
     *    скакать, адаптер (idea 37) реагирует на тренд, а не на секундный шум.
     * [NOT-TESTED]
     */
    private fun tuneOutputClient(stream: MultiStream, index: Int) {
        val client = runCatching { stream.getStreamClient(MultiType.RTMP, index) }.getOrNull() ?: run {
            KLog.w(TAG, "RTMP[$index] tune: клиент недоступен — пропускаем гигиену")
            return
        }
        runCatching {
            client.setLogs(false)
            client.setBitrateExponentialFactor(BITRATE_EXPONENTIAL_FACTOR)
        }.onFailure { KLog.w(TAG, "RTMP[$index] tune не прошёл", it) }
        KLog.i(TAG, "RTMP[$index] tune: логи библиотеки ВЫКЛ, сглаживание битрейта=$BITRATE_EXPONENTIAL_FACTOR")
    }

    /**
     * plans/09 S4 + живучесть УРОВЕНЬ 1 — пауза перед попыткой [attempt] (1-я попытка = 1).
     * Экспонента 1.5 (модель OBS) с капом [RECONNECT_BACKOFF_CAP_MS]: 1.0 → 1.5 → 2.3 → 3.4 → 5.1 →
     * 7.6 → 11.4 → 15с (дальше держим 15с СКОЛЬКО УГОДНО ДОЛГО — потолка попыток больше нет).
     * Сверху ±[RECONNECT_JITTER_PERCENT]% случайного разброса: 4 выхода мультистрима, упавшие
     * одновременно (общая сеть), иначе ломились бы в аплинк одной и той же секундой.
     */
    private fun reconnectBackoffMs(attempt: Int): Long {
        val exp = Math.pow(RECONNECT_BACKOFF_EXP, (attempt - 1).coerceAtLeast(0).toDouble())
        val base = (RECONNECT_BACKOFF_BASE_MS * exp).toLong().coerceAtMost(RECONNECT_BACKOFF_CAP_MS)
        val jitter = (base * RECONNECT_JITTER_PERCENT / 100.0 * (Math.random() * 2 - 1)).toLong()
        return (base + jitter).coerceAtLeast(250L)
    }

    /**
     * plans/09 S3+S4 + живучесть УРОВЕНЬ 1 — обработка сбоя ОДНОГО выхода [index].
     *
     * ВИЖН КРИНИКА (idea 43): «валидным завершением трансляции является ТОЛЬКО кнопка Стоп».
     * Поэтому для восстановимых причин потолка попыток НЕТ — выход уходит в Reconnecting и пробует
     * снова, пока сессия жива. Раньше здесь стояло `attempt <= 5`, и эфир умирал навсегда через
     * ~23 секунды пропажи сети, хотя платформа держит окно 60–180с (см. разведдок §3).
     *
     *  • Восстановимо: фаза Reconnecting + `getStreamClient(RTMP,i).reTry(backoff)` — ЖИВЫЕ выходы не
     *    трогаем, энкодер НЕ гасим. Сетевой блип не конец эфира; долгий обрыв — тоже.
     *  • Невосстановимо (auth-ошибка = кривой ключ, «Endpoint malformed» = кривой URL): реконнект
     *    бессмыслен по существу — фаза Failed, стопим ТОЛЬКО этот индекс; если это был ПОСЛЕДНИЙ
     *    активный выход — гасим энкодер и восстанавливаем превью (фикс чёрного экрана из bug 34).
     */
    private fun onOutputFailed(index: Int, reason: String, retriable: Boolean) {
        val stream = rtmpStream ?: return
        // Живучесть, УРОВЕНЬ 1 — сессии нет (пользователь нажал Стоп / все выходы уже изолированы):
        // приходящие следом колбэки обрыва — эхо ШТАТНОГО отключения, а не авария. Без этого гарда
        // бесконечный реконнект воскрешал бы только что остановленный эфир.
        if (!_sessionActive.value) {
            KLog.d(TAG, "RTMP[$index] сбой после конца сессии ($reason) — игнорируем, реконнекта нет")
            return
        }
        isStreamSetupInProgress = false
        val attempt = (outputStates[index]?.attempt ?: 0) + 1
        // interview_015 В1/В2 — фазу читаем ДО updateOutput: через две строки она уже Reconnecting,
        // и «оборвался ли ЖИВОЙ эфир» отличить будет не по чему.
        val wasLive = outputStates[index]?.phase == OutputPhase.Live

        // Авто-реконнект этого выхода с бэкоффом — БЕЗ потолка попыток (уровень 1).
        if (retriable) {
            // Обрыв живого эфира: возобновляем с пола профиля и ставим лестницу на паузу.
            if (wasLive) onLiveOutputBroken(index, reason)
            val backoff = reconnectBackoffMs(attempt)
            // Битрейт обнуляем ЯВНО: выход не отправляет ни байта, и оставшееся от эфира число
            // (последняя EMA) выглядело бы в пульсе и в UI как живой поток. Тот же принцип честной
            // индикации, что и в bug 45: показываем факт, а не последнее приятное значение.
            updateOutput(index) {
                it.copy(phase = OutputPhase.Reconnecting, reason = reason, attempt = attempt,
                    bitrateKbps = 0, congested = false)
            }
            recomputeAggregateState()
            val client = runCatching { stream.getStreamClient(MultiType.RTMP, index) }.getOrNull()
            // КРИТИЧНО (сверено байткодом 2.4.7, перепроверено 2026-07-28): `reTry` →
            //   `shouldRetry(reason)` = `doingRetry && !reason.contains("Endpoint malformed") && reTries > 0`.
            // Счётчик `reTries` по умолчанию 0 → без setReTries reTry ВСЕГДА возвращает false (эфир
            // умирал на любом блипе — воспроизведено на полигоне убийством сервера). Поэтому держим
            // библиотечный бюджет > 0 перед КАЖДОЙ попыткой — наш счётчик [attempt] служит только
            // темпу бэкоффа и индикации, терминальным условием он больше не является.
            // ⚠️ ИСПРАВЛЕНИЕ ПРЕЖНЕГО КОММЕНТАРИЯ (он утверждал обратное и вводил в заблуждение):
            // `doingRetry` ставится в `RtmpClient.connect(url, isRetry=false)`, то есть при ПЕРВОЙ ЖЕ
            // попытке подключения, а НЕ «при установленном коннекте». Следствие: мёртвый хост тоже
            // проходит в reTry и будет переподключаться бесконечно — что для вижна как раз ВЕРНО
            // (сеть может подняться), а по-настоящему безнадёжные случаи отсекают auth-ошибка и
            // «Endpoint malformed», которые сюда не попадают / возвращают false.
            // Верифицировано: javap RtmpClient.connect(String,boolean) → `putfield doingRetry` при
            // isRetry==false; javap MultiStream.getStreamClient(MultiType,int) → rtmpStreamClients.get(i),
            // то есть все ручки строго ПО ИНДЕКСУ выхода (мультистрим не путает выходы).
            runCatching { client?.setReTries(libraryReTriesBudget) }
                .onFailure { KLog.w(TAG, "RTMP[$index] setReTries failed", it) }
            val scheduled = runCatching { client?.reTry(backoff, reason) ?: false }
                .getOrElse { KLog.w(TAG, "RTMP[$index] reTry threw", it); false }
            KLog.i(TAG, "RTMP[$index] реконнект попытка $attempt через ${backoff}ms " +
                "(scheduled=$scheduled, потолка попыток нет — держим эфир до кнопки Стоп)")
            if (scheduled) return
            // reTry не назначился (Endpoint malformed / клиент не в состоянии ретрая) → изоляция ниже.
            KLog.e(TAG, "RTMP[$index] reTry НЕ назначен библиотекой — причина неустранима клиентом")
        }

        // Изоляция выхода: Failed + стоп ТОЛЬКО этого индекса, живые не трогаем.
        KLog.e(TAG, "RTMP[$index] FAILED (reason=$reason) — изолируем выход, живые продолжают")
        updateOutput(index) { it.copy(phase = OutputPhase.Failed, reason = reason, bitrateKbps = 0, congested = false) }
        runCatching { stream.stopStream(MultiType.RTMP, index) }
            .onFailure { KLog.w(TAG, "RTMP[$index] stopStream(RTMP,$index) failed", it) }
        activeRtmpOutputs.remove(index)
        // Живучесть, УРОВЕНЬ 3 — выход изолирован: его записи в watchdog больше не про что.
        watchdogSentLast.remove(index); watchdogFrozenSince.remove(index)

        // Упал ПОСЛЕДНИЙ активный выход? Тогда гасим энкодер и восстанавливаем превью.
        if (activeRtmpOutputs.isEmpty()) {
            KLog.w(TAG, "RTMP: последний выход изолирован — гасим энкодер, восстанавливаем превью")
            runCatching { stream.stopStream() }
                .onFailure { KLog.w(TAG, "no-arg stopStream (encoder) failed", it) }
            // bug 48/63 — НЕ startPreview(tv): пересборка живой поверхности TextureView гонится с
            // системным HWUI RenderThread (EGL_BAD_SURFACE → SIGABRT). Трогаем поверхность, только
            // если она реально отвалилась. Это был крашевый путь ровно на гибели эфира.
            restorePreviewIfDetached()
            // Живучесть, УРОВЕНЬ 1 — все выходы мертвы по НЕустранимой причине: сессия честно
            // закончилась (только здесь, а не на каждом сетевом Error) → FGS отпускается.
            _sessionActive.value = false
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

            _state.value = StreamState.Connecting()  // bug 45 — эфир: подготовка/хендшейк (isRecording=false)
            // plans/09 S2 — свежая сессия: сбрасываем per-output состояние прошлого эфира.
            activeRtmpOutputs.clear()
            outputStates.clear()
            // Живучесть, УРОВЕНЬ 3 — watchdog чистится ТАМ ЖЕ, где outputStates: его состояние
            // ключуется индексом выхода, а индексы переиспользуются между сессиями.
            watchdogSentLast.clear(); watchdogFrozenSince.clear(); watchdogLastTickAtMs = 0L
            // Живучесть, УРОВЕНЬ 4 — и слейт тоже: новый эфир обязан начинаться с ЖИВОЙ картинки,
            // даже если прошлый закончился на просевшей сети. Принуждение харнеса тоже снимаем —
            // иначе забытый `simulate-slate on` молча испортил бы следующую сессию.
            slateOverride = false; slateCongestedTicks = 0
            if (slateActive) applySlate(false, "старт новой сессии")
            // Живучесть, УРОВЕНЬ 1 — СЕССИЯ открыта: с этой секунды и до кнопки Стоп приложение
            // обязано держать эфир (FGS + wake lock живут по этому флагу, а не по состоянию).
            offlineSinceMs = 0L
            _sessionActive.value = true
            // plans/07 S3 — стартуем КАЖДЫЙ выход на своём индексе (ютуб=0, инстаграм=1, …);
            // plans/09 S2 — сразу заводим статус выхода (имя платформы + фаза Connecting) для UI.
            outputs.forEachIndexed { i, p ->
                val url = "${p.rtmpUrl}/${p.streamKey}"
                // bug 37 №3 — в лог редактированный URL; полный (с ключом) идёт ТОЛЬКО в библиотеку.
                KLog.i(TAG, "startStream: RTMP out[$i] '${p.name}' → ${redactRtmpUrl(url)}")
                outputStates[i] = OutputStatus(index = i, name = p.name, phase = OutputPhase.Connecting)
                tuneOutputClient(stream, i)   // живучесть, УРОВЕНЬ 0 — гигиена ДО подключения
                stream.startStream(MultiType.RTMP, i, url)
                activeRtmpOutputs.add(i)
            }
            KLog.d(TAG, "startStream: запущено выходов=${outputs.size} — ждём GL + ConnectChecker")

            // idea 37 — телеметрия + адаптер: цель = битрейт профиля КОДЕРА (энкодер один на все
            // выходы); адаптив — свойство профиля кодера (plans/14); тикер сам умрёт по концу эфира.
            targetVideoBitrateBps = encoder.videoBitrateBps
            currentVideoBitrateBps = targetVideoBitrateBps
            adaptiveBitrateEnabled = encoder.adaptiveBitrate
            // interview_015 В2 — новый эфир начинает часы «идёт без обрывов» с нуля: чужая пауза от
            // прошлой сессии не должна ни тормозить лестницу, ни, наоборот, отпускать её досрочно.
            adaptiveLiveSinceMs = 0L
            // interview_016 — крыша живёт РОВНО ОДИН ЭФИР. Криник нажал Стоп и Старт заново = он
            // вправе рассчитывать на полное качество: сеть с прошлого раза могла смениться целиком
            // (ушёл из метро, переключился на домашний Wi-Fi), и старая крыша была бы враньём.
            adaptiveCeilingBps = 0
            adaptiveLevelSinceMs = 0L
            adaptiveProvenBps = 0
            // Р7 — пол из профиля, санитайзится ДВУМЯ шагами (не coerceIn!): coerceIn бросает
            // IllegalArgumentException при min > max, а состояние «цель 500к, пол 1000к из импорта»
            // достижимо и не должно ронять старт эфира.
            floorVideoBitrateBps = encoder.minVideoBitrateBps
                .coerceAtLeast(FLOOR_HARD_MIN_BPS)
                .coerceAtMost(targetVideoBitrateBps)
            KLog.i(TAG, "idea37: target=${targetVideoBitrateBps / 1000}kbps floor=${floorVideoBitrateBps / 1000}kbps " +
                "adaptive=$adaptiveBitrateEnabled (профиль кодера «${encoder.name}»)")
            startLiveTicker()

            // Wait for GL to start, re-attach preview TextureView
            schedulePreviewRestoreAfterStream(stream)
            return true

        } catch (e: Exception) {
            KLog.e(TAG, "startStream: exception during setup", e)
            _state.value = StreamState.Error("Stream setup crashed: ${e.message}")
            isStreamSetupInProgress = false
            // Сессия не состоялась — держать FGS не за что (живучесть ур.1).
            _sessionActive.value = false
            lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
            return false
        }
    }

    fun stopStream() {
        KLog.i(TAG, "stopStream: stopping RTMP stream")
        isStreamSetupInProgress = false
        _state.value = StreamState.Stopping
        // Живучесть, УРОВЕНЬ 1 — ЕДИНСТВЕННОЕ валидное завершение эфира (вижн Криника): сессия
        // закрывается по кнопке Стоп. Ставим ДО disconnect, чтобы приходящие следом колбэки сбоя
        // (обрыв во время остановки) не приняли штатный стоп за аварию и не начали реконнект.
        _sessionActive.value = false
        offlineSinceMs = 0L
        rtmpStream?.let { disconnectAllOutputs(it) }
        activeRtmpOutputs.clear()
        outputStates.clear()   // plans/09 S2 — сбрасываем per-output состояние
        watchdogSentLast.clear(); watchdogFrozenSince.clear(); watchdogLastTickAtMs = 0L  // уровень 3
        // Живучесть, УРОВЕНЬ 4 — снять слейт по кнопке Стоп: композитор обязан вернуться к живой
        // картинке, иначе превью останется замороженным уже ПОСЛЕ конца эфира.
        slateOverride = false; slateCongestedTicks = 0
        if (slateActive) applySlate(false, "эфир остановлен")
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
            // bug 45 S2 — ЧЕСТНАЯ ИНДИКАЦИЯ ЗАПИСИ. RECORDING = мухер стартовал и ПЕРВЫЙ семпл реально
            // записан (байткод AndroidMuxerRecordController: статус выставляется в recordVideo() перед
            // первым write). Только ЗДЕСЬ поднимаем бейдж «ЗАПИСЬ» и запускаем таймер — до этого висит
            // «ПОДГОТОВКА», поэтому Криник не начинает фразу в пустоту. Идемпотентно: промоутим только
            // из фазы подготовки записи (повторный RECORDING/RESUMED не обнулит таймер).
            // [TESTED: 2026-07-25 · живьём: таймер бейджа пошёл с 00:00 в момент реального старта]
            if (status == RecordController.Status.RECORDING) {
                val st = _state.value
                if (st is StreamState.Connecting && st.isRecording) {
                    val warmupMs = if (recordStartRequestedAtMs > 0)
                        android.os.SystemClock.elapsedRealtime() - recordStartRequestedAtMs else -1
                    KLog.i(TAG, "Record: первый семпл записан — бейдж ЗАПИСЬ поднят по ФАКТУ " +
                            "(прогрев ${warmupMs}ms от нажатия, bug 45)")
                    recordStartRequestedAtMs = 0L
                    _state.value = StreamState.Live(isRecording = true)
                    startLiveTicker()   // таймер считает РЕАЛЬНОЕ время записи, а не время подготовки
                }
            }
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
            // bug 45 S1 — ЗАМЕР прогрева записи по ФАЗАМ. Криник жал «Запись», бейдж загорался, а файл
            // начинался позже → начало фразы терялось. Чтобы чинить причину, а не гадать, каждая
            // дорогая фаза старта отмечается временем; итоговая Δ до первого реально записанного
            // семпла считается в recordListener (RECORDING). Логи постоянные — дешёвые и диагностические.
            val t0 = android.os.SystemClock.elapsedRealtime()
            fun since() = android.os.SystemClock.elapsedRealtime() - t0
            recordStartRequestedAtMs = t0

            if (stream.isOnPreview) stream.stopPreview()
            val tStopPreview = since()
            // bug 51 — запись кодируется ВЫБРАННЫМ профилем кодера (тот же путь, что эфир: record == stream).
            val vp = configureCaptureRotation(stream, encoder)
            val tVideo = since()
            val ap = prepareAudioFor(stream, encoder)
            val tAudio = since()
            if (!vp || !ap) {
                KLog.e(TAG, "startRecordToFile: prepare failed (video=$vp audio=$ap)")
                isStreamSetupInProgress = false
                recordStartRequestedAtMs = 0L
                lastPreviewTextureView?.get()?.let { startPreview(it) }
                return null
            }
            // bug 45 S2 — ЧЕСТНАЯ ИНДИКАЦИЯ: здесь запись ещё НЕ идёт (мухер не получил ни одного
            // семпла), поэтому состояние = ПОДГОТОВКА, а не Live. В Live (бейдж «ЗАПИСЬ» + таймер)
            // переводит ТОЛЬКО recordListener по первому реальному RecordController.Status.RECORDING
            // — библиотека отдаёт его из recordVideo() ровно когда первый видеосемпл записан
            // (сверено байткодом AndroidMuxerRecordController 2.4.7).
            // [TESTED: 2026-07-25 · видеозахват экрана: пилюля «ПОДГОТОВКА» → бейдж «ЗАПИСЬ • 00:00»]
            _state.value = StreamState.Connecting(isRecording = true)
            // Живучесть, УРОВЕНЬ 1 — запись тоже СЕССИЯ: FGS/wake lock теперь поднимаются по этому
            // флагу, и без него запись потеряла бы фоновую защиту (bug 36) вместе с эфиром.
            _sessionActive.value = true
            lastRecordPath = path              // Idea 11: published to DCIM on STOPPED
            // idea 37/17 — тикер эфира нужен и ЗАПИСИ (таймер на бейдже; пойман приёмкой кнопки
            // Record: стоял 0:00). Адаптер битрейта при записи ВЫКЛЮЧЕН (target=0 → no-op: канала
            // нет, RTMP-клиентов нет — congestion-поллинг по пустым outputStates безопасен).
            // bug 45 — тикер стартует НЕ здесь, а по факту RECORDING: иначе таймер считал бы время
            // подготовки, т.е. врал бы вместе с бейджем.
            targetVideoBitrateBps = 0
            adaptiveBitrateEnabled = false
            stream.startRecord(path, recordListener)
            KLog.i(TAG, "startRecordToFile → $path (canvas=${_videoRotation.value}°) · прогрев: " +
                    "stopPreview=${tStopPreview}ms video(prepare+changeSource)=${tVideo - tStopPreview}ms " +
                    "audio=${tAudio - tVideo}ms startRecord=${since() - tAudio}ms — ждём первый семпл (bug 45)")
            schedulePreviewRestoreAfterStream(stream)
            // bug 45 S3 — СОКРАЩЕНИЕ ПРОГРЕВА: не ждём следующий ключевой кадр по GOP (2с), а просим его
            // сами. Серия коротких попыток нужна из-за гонки с аудиоформатом: IDR, пришедший раньше
            // аудиоформата, мухер выбрасывает. Цикл сам останавливается, когда состояние ушло из фазы
            // подготовки записи (т.е. RECORDING пришёл).
            // [TESTED: 2026-07-25 · замер по логам на виртуалке: прогрев 2769/2468ms → 559/605ms]
            scope.launch {
                repeat(KEYFRAME_NUDGE_ATTEMPTS) {
                    if (_state.value.let { st -> st !is StreamState.Connecting || !st.isRecording }) return@launch
                    runCatching { stream.requestKeyframe() }
                        .onFailure { KLog.w(TAG, "requestKeyframe failed (bug 45)", it) }
                    delay(KEYFRAME_NUDGE_INTERVAL_MS)
                }
            }
            // bug 45 — страховка наблюдаемости: если первый семпл не пришёл за RECORD_START_WARN_MS,
            // это НЕ молчаливая ложь бейджа (он честно висит «ПОДГОТОВКА»), но в логе будет след.
            scope.launch {
                delay(RECORD_START_WARN_MS)
                if (_state.value.let { it is StreamState.Connecting && it.isRecording })
                    KLog.w(TAG, "startRecordToFile: за ${RECORD_START_WARN_MS}ms не пришёл RECORDING — " +
                            "мухер не получил ни видео, ни аудио семплов (bug 45)")
            }
            return path
        } catch (e: Exception) {
            KLog.e(TAG, "startRecordToFile: exception", e)
            _state.value = StreamState.Error("Record setup crashed: ${e.message}")
            isStreamSetupInProgress = false
            _sessionActive.value = false   // сессия не состоялась (живучесть ур.1)
            lastPreviewTextureView?.get()?.let { startPreview(it) }
            return null
        }
    }

    /** Stop the file recording (Idea 10) and restore preview. */
    fun stopRecordToFile() {
        KLog.i(TAG, "stopRecordToFile: stopping record")
        isStreamSetupInProgress = false
        recordStartRequestedAtMs = 0L   // bug 45 — сессия записи закрыта, замер прогрева сброшен
        _sessionActive.value = false    // живучесть ур.1 — сессия записи закрыта пользователем
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
            // Фаза 1: гарантируем непустой набор именованных сцен (первый запуск — сеем сцену из
            // легаси Ф0-снапшота, чтобы не потерять текущую работу Криника), затем восстанавливаем АКТИВНУЮ.
            sceneProfileRepo.ensureSeeded()
            sceneProfileRepo.loadActive()?.let { restored ->
                withContext(Dispatchers.Main.immediate) {
                    _scene.value = restored
                    applySceneLayers()
                    KLog.i(TAG, "Scene restored from active profile: ${restored.layers.size} layers")
                }
            }
            // Автосейв активной сцены. drop(1) — не сохранять восстановленное/дефолтное значение;
            // debounce — жест трансформы шлёт правку каждый кадр (иначе спам записи и просадка жестов).
            scene.drop(1).debounce(SCENE_AUTOSAVE_DEBOUNCE_MS).collect { sceneProfileRepo.saveActive(it) }
        }
    }

    /** Ф0 — сбросить АКТИВНУЮ сцену к дефолту. Автосейв сохранит и почистит сироты-оверлеи сцены. */
    fun resetScene() = mutateScene { Scene.default() }

    /** Ф0 — форс-сейв активной сцены (харнес scene-save: детерминизм теста без ожидания debounce). */
    fun saveSceneNow() { scope.launch(Dispatchers.IO) { sceneProfileRepo.saveActive(_scene.value) } }

    /** Ф0 — залогировать активную сцену (харнес scene-dump: объективная сверка до/после рестарта). */
    fun dumpSceneToLog() {
        scope.launch(Dispatchers.IO) {
            KLog.i(TAG, "scene-dump: layers=${_scene.value.layers.size} activeId=${sceneProfileRepo.activeSceneId.first()}")
        }
    }

    /** Фаза 1 — залогировать набор сцен (харнес scene-list): id:имя (активная помечена *). */
    fun dumpScenesToLog() {
        scope.launch(Dispatchers.IO) {
            val active = sceneProfileRepo.activeSceneId.first()
            val list = scenesList.value.joinToString(", ") { "${it.id}:${it.name}${if (it.id == active) "*" else ""}" }
            KLog.i(TAG, "scene-list: active=$active count=${scenesList.value.size} [$list]")
        }
    }

    // ── idea 40 / plans/18 Фаза 1 — управление НАБОРОМ именованных сцен ────────────────────────
    /**
     * Переключить активную сцену на [id]. Сначала ФЛАШИМ текущую активную (её последние правки могли ещё
     * не сброситься debounce'ом), затем меняем активную и загружаем целевую в композитор. Бесшовность в
     * эфире (без разрыва энкодера) — задача Фазы 2; здесь смена происходит через тот же live `setLayers`.
     */
    fun switchScene(id: Long) {
        scope.launch(Dispatchers.IO) {
            sceneProfileRepo.saveActive(_scene.value)   // флаш текущей (active ещё старая)
            val loaded = sceneProfileRepo.load(id) ?: Scene.default()
            // plans/18 Фаза 2 (Криник) — переход принадлежит сцене, НА которую переключаемся (как в OBS).
            val (transition, durationMs) = sceneProfileRepo.transitionOf(id)
            sceneProfileRepo.setActive(id)
            withContext(Dispatchers.Main.immediate) {
                // Незавершённая прошлая эпоха закрывается СИНХРОННО: иначе вердикт ниже считался бы по
                // ложной картине (продюсеры прошлого перехода ещё числятся живыми).
                flushRetiredProducers("новое переключение сцены")

                // ── plans/20 (правка Криника): кто из уходящих слоёв останется ЖИВЫМ на время перехода ──
                val oldLayers = _scene.value.layers.filter { it.visible }.filterIsInstance<Layer.VideoCapture>()
                val newKeys = loaded.layers.filter { it.visible }.filterIsInstance<Layer.VideoCapture>()
                    .associate { it.id to sourceKeyOf(it.source) }
                // (1) СЛОЙ ОСТАЛСЯ САМ СОБОЙ: тот же id И то же физустройство → его слот живёт дальше в
                //     общем наборе, продюсера вообще не трогаем (гард bug 68).
                val liveIds = oldLayers
                    .filter { cameraLayerMirrors[it.id] == null }          // владелец, а не зеркало
                    .filter { cameraOpeners[it.id]?.isAlive == true }      // продюсер честно жив (коммит A)
                    .filter { val k = layerSourceKeys[it.id]; k != null && newKeys[it.id] == k }
                    .map { it.id }.toSet()
                // (2) СЛОЙ УХОДИТ: решаем — оставить его продюсера живым до конца перехода или гасить сразу.
                //     Развилка Криника (дословно): «если две не тянет - то исключение развилка. В текущий
                //     сцене замирает старый кадр, а в новой запускается новая камера». Поэтому ЛЮБАЯ
                //     встроенная камера гасится немедленно (HAL Titan 1 не тянет две сразу, bug 60), а
                //     виртуалка и UVC остаются живыми, если новая сцена не целит в то же семейство.
                val newWantsUvc = newKeys.values.any { it != null && it.startsWith("uvc:") }
                // Криник 2026-07-26 (регресс «селфи замирает на переходе»): встроенную камеру гасим НЕ
                // всегда, а только когда новая сцена ТОЖЕ просит встроенную — вот их HAL Titan 1 не тянет
                // вдвоём (bug 60). Селфи + вебка живут одновременно (это боевая фича мультиисточников),
                // поэтому при уходе селфи в сцену с вебкой селфи остаётся ЖИВОЙ до конца перехода.
                val newWantsBuiltin = newKeys.values.any { it != null && it.startsWith("builtin:") }
                val newHasUnsetSource = loaded.layers.filter { it.visible }.filterIsInstance<Layer.VideoCapture>()
                    .any { sourceKeyOf(it.source) == null && it.source !is CaptureSource.Virtual }
                val retireIds = LinkedHashSet<String>()
                for (layer in oldLayers) {
                    if (layer.id in liveIds) continue
                    if (cameraLayerMirrors[layer.id] != null) continue      // зеркало продюсера не держит
                    val opener = cameraOpeners[layer.id] ?: continue
                    if (opener.isAlive != true) continue
                    val key = layerSourceKeys[layer.id]
                    val keepAlive = when {
                        key == null -> true                                  // виртуалка — конфликтовать нечем
                        key.startsWith("uvc:") -> !newWantsUvc && !newHasUnsetSource
                        // builtin — живой, ПОКА новая сцена не просит встроенную (HAL тянет одну, bug 60).
                        // Неизвестный источник (None → авто-сев) тоже считаем риском: класс заранее не знаем.
                        key.startsWith("builtin:") -> !newWantsBuiltin && !newHasUnsetSource
                        else -> false
                    }
                    if (!keepAlive) continue
                    opener.cancelPendingReopen()                             // коммит A4: без reopen в уходящую поверхность
                    retireIds.add(layer.id)
                    retiredProducers.add(Retired(layer.id, key, opener))
                    // Карты RtmpStreamer с этого момента описывают ТОЛЬКО новую сцену → коллизии id нет,
                    // и штатная точка гашения в setCameraOpener этого продюсера уже не увидит.
                    cameraOpeners.remove(layer.id); cameraLayerSurfaces.remove(layer.id)
                    lastOpenedKinds.remove(layer.id); layerSourceKeys.remove(layer.id)
                    cameraLayerMirrors.remove(layer.id); openedLayers.remove(layer.id)
                }
                if (retireIds.isNotEmpty() || liveIds.isNotEmpty())
                    KLog.i(TAG, "переход: живыми остаются слои $liveIds, отложенно гасим $retireIds " +
                            "(новой сцене нужен uvc=$newWantsUvc builtin=$newWantsBuiltin неизвестный=$newHasUnsetSource)")

                // ВАЖЕН ПОРЯДОК: снимок старого композита берём ДО отдачи новых слоёв — обе операции
                // летят в один GL-handler, поэтому FIFO гарантирует «снял старое → показал новое».
                // Снимок работает БАЗОЙ, а живые уходящие слои дорисовываются поверх него каждый кадр.
                compositorSource.beginTransition(transition, durationMs, liveIds, retireIds)
                _scene.value = loaded
                applySceneLayers()
                KLog.i(TAG, "Scene switched → id=$id (${loaded.layers.size} layers, переход=$transition ${durationMs}мс)")
                // Страховка: если переход по любой причине не доиграет, сироты не должны жить вечно.
                scope.launch {
                    delay(TRANSITION_WATCHDOG_BASE_MS + durationMs)
                    withContext(Dispatchers.Main.immediate) { flushRetiredProducers("watchdog") }
                }
            }
        }
    }

    /**
     * plans/20 D3 — продюсер уходящей сцены, оставленный ЖИВЫМ до конца перехода (Криник: «чтобы
     * текущие источники текущего слоя стримили, пока ещё идёт переход»). Гасится по сигналу
     * композитора «переход доиграл» либо watchdog'ом.
     */
    // [TESTED: 2026-07-26 · живьём на Titan 1: вебка→селфи уходящий слой +42 кадра за переход (живой), селфи→вебка встроенная замирает (retired=0), одна вебка в обеих сценах live=1 без касания камеры; стресс 4 переключений подряд — 4 begin/4 finish, сироты погашены, 0 крашей; худший кадр 10мс]
    private class Retired(val layerId: String, val key: String?, val opener: CameraOpener)

    private val retiredProducers = ArrayList<Retired>()

    /** Погасить отложенных продюсеров и освободить их слоты. Идемпотентно (звать можно из любой точки). */
    private fun flushRetiredProducers(reason: String) {
        if (retiredProducers.isEmpty()) { compositorSource.releaseRetiredSlots(); return }
        val list = retiredProducers.toList()
        retiredProducers.clear()
        list.forEach { runCatching { it.opener.close() } }
        compositorSource.releaseRetiredSlots()
        KLog.i(TAG, "переход: погасил отложенных продюсеров — $reason (${list.size})")
    }

    /**
     * plans/20 D5 — ЕДИНСТВЕННАЯ точка открытия продюсера слоя. Перед открытием проверяет, не держит ли
     * ОТЛОЖЕННЫЙ продюсер уходящей сцены конфликтующее физустройство: если держит — переход обрывается
     * немедленно и сироты гасятся, иначе новая камера не откроется вовсе (класс bug 58/60). Деградация
     * ровно в прежнее поведение: уходящая сцена замирает, входящая стартует.
     */
    private fun openProducer(layerId: String, opener: CameraOpener, st: SurfaceTexture) {
        val key = opener.sourceKey
        if (key != null && retiredProducers.any { keysConflict(key, it.key) }) {
            KLog.i(TAG, "переход оборван: новая сцена просит $key, а его держит уходящая — гашу сейчас")
            compositorSource.abortTransition()
            flushRetiredProducers("конфликт физустройства перед открытием")
        }
        openedLayers.add(layerId)
        opener.open(st)
    }

    /**
     * plans/20 D5 — конфликтуют ли два ФИЗ-ключа: одно устройство, две UVC-камеры (общий AUSBC-объект)
     * или две встроенные (HAL тянет одну, bug 60). Последняя линия обороны перед open().
     */
    private fun keysConflict(a: String?, b: String?): Boolean =
        a != null && b != null && (a == b ||
            (a.startsWith("uvc:") && b.startsWith("uvc:")) ||
            (a.startsWith("builtin:") && b.startsWith("builtin:")))

    /** Ключ физустройства источника — формат обязан совпадать с опенерами (:app) и расчётом liveIds. */
    private fun sourceKeyOf(source: CaptureSource): String? = when (source) {
        is CaptureSource.Uvc -> "uvc:${source.deviceId}"
        is CaptureSource.Builtin -> "builtin:${source.cameraId}"
        else -> null
    }

    /**
     * plans/18 Фаза 2 — задать ПЕРЕХОД сцены (тип + длительность) из модалки редактирования сцены.
     * Пишется отдельным апдейтом, чтобы частый автосейв снапшота не затирал настройку.
     */
    fun setSceneTransition(id: Long, transition: SceneTransition, durationMs: Int) {
        scope.launch(Dispatchers.IO) {
            sceneProfileRepo.setTransition(id, transition, durationMs)
            KLog.i(TAG, "Scene $id: переход = $transition, ${durationMs}мс")
        }
    }

    /** Создать НОВУЮ сцену (дефолтная, имя «Сцена N») и переключиться на неё. Флашим текущую до создания. */
    fun createNewScene(name: String? = null) {
        scope.launch(Dispatchers.IO) {
            sceneProfileRepo.saveActive(_scene.value)
            val sceneName = name?.takeIf { it.isNotBlank() } ?: sceneProfileRepo.defaultNewName()
            sceneProfileRepo.createScene(sceneName, Scene.default())  // createScene делает её активной
            withContext(Dispatchers.Main.immediate) {
                _scene.value = Scene.default()
                applySceneLayers()
                KLog.i(TAG, "Scene created: '$sceneName' (активная)")
            }
        }
    }

    /** Дублировать сцену [id] (копия оверлеев в свой сабдир) и переключиться на копию. */
    fun duplicateScene(id: Long) {
        scope.launch(Dispatchers.IO) {
            sceneProfileRepo.saveActive(_scene.value)                 // флаш текущей активной (её актуальное состояние)
            val newId = sceneProfileRepo.duplicate(id) ?: return@launch
            val loaded = sceneProfileRepo.load(newId) ?: _scene.value
            withContext(Dispatchers.Main.immediate) {
                _scene.value = loaded
                applySceneLayers()
                KLog.i(TAG, "Scene duplicated: $id → $newId (активная)")
            }
        }
    }

    /** Переименовать сцену [id] в [name] (только имя, содержимое не трогаем). */
    fun renameScene(id: Long, name: String) {
        scope.launch(Dispatchers.IO) { sceneProfileRepo.rename(id, name) }
    }

    /**
     * Удалить сцену [id] (строка + сабдир оверлеев). Если удаляли активную — активной становится первая
     * оставшаяся; загружаем её в композитор. Набор не должен пустеть (ensureSeeded на следующем старте
     * пересеет), но на всякий случай при опустевшем наборе создаём дефолтную.
     */
    fun deleteScene(id: Long) {
        scope.launch(Dispatchers.IO) {
            val wasActive = sceneProfileRepo.activeSceneId.first() == id
            val newActive = sceneProfileRepo.delete(id)
            if (!wasActive) return@launch
            val loaded = when {
                newActive != null -> sceneProfileRepo.load(newActive) ?: Scene.default()
                else -> { sceneProfileRepo.createScene(sceneProfileRepo.defaultNewName(), Scene.default()); Scene.default() }
            }
            withContext(Dispatchers.Main.immediate) {
                _scene.value = loaded
                applySceneLayers()
                KLog.i(TAG, "Scene deleted: $id → active=$newActive")
            }
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
        // plans/20 D6 — конфликт всплыл РУНТАЙМОМ (камера не подключилась): сперва обрываем переход и
        // гасим отложенных продюсеров, иначе они продолжали бы держать устройство и слой остался бы
        // мёртвым навсегда. Глухо подавлять откат нельзя.
        if (retiredProducers.isNotEmpty()) {
            compositorSource.abortTransition()
            flushRetiredProducers("конфликт при подключении камеры")
        }
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

    /**
     * Удалить слой по id (камеру UI удалять не предлагает — первый заход).
     *
     * Лог печатает ФАКТ, а не намерение (поймано 2026-07-31 на живой отладке: восемь команд
     * `remove-layer` напечатали восемь «removed layer id=…», а в сцене не изменилось НИЧЕГО — id
     * были не те, и лог уверенно врал). Это тот же класс, что root cause bugs/75 и лог слейта на
     * шаге C3: утверждение о состоянии печатается там, где состояние не проверено. Здесь оно стоит
     * ровно одной проверки списка слоёв до и после.
     */
    fun removeLayer(id: String) {
        val existed = _scene.value.layers.any { it.id == id }
        mutateScene { it.remove(id) }
        if (existed) KLog.i(TAG, "Scene: removed layer id=$id")
        else KLog.w(TAG, "Scene: слоя id=$id в сцене НЕТ — удалять нечего " +
            "(есть: ${_scene.value.layers.joinToString { it.id }})")
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
