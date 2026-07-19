/**
 * MainScreen — fullscreen scene viewfinder with floating overlay controls (Phase 3: единый композитор).
 *
 * Layout:
 *   Layer 0: fullscreen viewfinder — ВСЕГДА живой TextureView, зеркалит композит (сцена = слои)
 *   Заглушка «нет сигнала» — ВНУТРИ слоя-камеры композитора (CompositorVideoSource/StandbyImage),
 *     а не Compose-оверлей: живёт в квадрате слоя, попадает в эфир/запись (указание Криника)
 *   Layer 1: Rotation hot button (top-right, всегда) — глобальный поворот холста (interview_006)
 *   Layer 2: Live status indicator (top-left when streaming)
 *   Layer 4: FloatingRadialMenu (bottom-right FAB + radial actions)
 *   Layer 5/6: StreamPlatformsOverlay / StreamLayersOverlay (modals, shown on demand)
 *
 * Camera → compositor bridge (Phase 3):
 *   1. Источник появился (USB/встроенная/виртуалка) → LaunchedEffect отдаёт стримеру CameraOpener
 *   2. TextureView готов → streamViewModel.startPreviewOnView(tv) → композитор+GL стартуют
 *   3. Композитор создаёт OES-поверхность слоя-камеры → CameraOpener открывает в неё камеру
 *   4. Кадры камеры → слой сцены → композит → превью TextureView + энкодер при стриме
 *   5. User presses Go Live → streamViewModel.startStream()
 *
 * Both orderings handled (camera before TextureView, and TextureView before camera).
 *
 * Related: UsbViewModel, StreamViewModel, CameraLayerOpeners, DeviceManager, FloatingRadialMenu
 */

package com.kriniks.kcam.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import com.kriniks.kcam.R
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Movie
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.feature.capture.model.VideoSource
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.model.OutputPhase
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.streaming.model.isLive
import com.kriniks.kcam.feature.streaming.ui.StreamLayersOverlay
import com.kriniks.kcam.feature.streaming.ui.SourceOption
import com.kriniks.kcam.feature.streaming.ui.EncoderProfilesOverlay
import com.kriniks.kcam.feature.streaming.ui.ImportReportDialog
import com.kriniks.kcam.feature.streaming.ui.StreamPlatformsOverlay
import androidx.compose.ui.platform.LocalContext
import com.kriniks.kcam.streaming.DeviceCameraOpener
import com.kriniks.kcam.streaming.UvcCameraOpener
import com.kriniks.kcam.streaming.VirtualCameraOpener
import com.kriniks.kcam.feature.streaming.ui.StreamViewModel
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import com.kriniks.kcam.ui.overlay.FloatingActionMenu
import com.kriniks.kcam.ui.overlay.FloatingPanelMenu
import com.kriniks.kcam.ui.overlay.PanelInfoRow
import com.kriniks.kcam.ui.overlay.RotationMenu

private val LiveRed = Color(0xFFFF1A1A)

/**
 * plans/03 S5/S7 — хиттест слоя под экранной точкой ([px],[py] в пикселях вью [w]×[h]). Переводит
 * точку экран→сцена (леттербокс + разворот на −canvasRotation вокруг центра) и ищет ВЕРХНИЙ видимый
 * слой, чей axis-aligned габарит (scale) содержит точку. null — вне контента или нет слоя.
 */
private fun hitTestLayer(px: Float, py: Float, w: Float, h: Float, rotation: Int, layers: List<Layer>): String? {
    val portrait = rotation == 90 || rotation == 270
    val aspect = if (portrait) 9f / 16f else 16f / 9f
    val cW = minOf(w, h * aspect); val cH = cW / aspect
    val left = (w - cW) / 2f; val top = (h - cH) / 2f
    val fx = (px - left) / cW; val fy = (py - top) / cH
    if (fx !in 0f..1f || fy !in 0f..1f) return null
    // CW-поворот холста (композитор +deg): screen→scene. 90↔270 относительно старого CCW-варианта.
    val (sx, sy) = when (rotation) {
        90 -> fy to (1f - fx)
        180 -> (1f - fx) to (1f - fy)
        270 -> (1f - fy) to fx
        else -> fx to fy
    }
    return layers.asReversed().firstOrNull { l ->
        l.visible &&
            kotlin.math.abs(sx - l.transform.cx) <= l.transform.scale / 2f &&
            kotlin.math.abs(sy - l.transform.cy) <= l.transform.scale / 2f
    }?.id
}

@Composable
fun MainScreen(
    onNavigateToSettings: () -> Unit,
    deviceManager: DeviceManager,
    usbViewModel: UsbViewModel = hiltViewModel(),
    streamViewModel: StreamViewModel = hiltViewModel(),
) {
    val usbState by usbViewModel.uiState.collectAsStateWithLifecycle()
    val streamState by streamViewModel.streamState.collectAsStateWithLifecycle()
    val profiles by streamViewModel.profiles.collectAsStateWithLifecycle()
    val activeProfile by streamViewModel.activeProfile.collectAsStateWithLifecycle()
    // plans/14 — профили кодера для пикера в форме платформы и менеджера.
    val encoderProfiles by streamViewModel.encoderProfiles.collectAsStateWithLifecycle()
    // bug 42 — кодеки, поддерживаемые железом устройства (для списка выбора кодека).
    val supportedCodecs by streamViewModel.supportedCodecs.collectAsStateWithLifecycle()
    val activeSource by deviceManager.activeVideoSource.collectAsStateWithLifecycle()
    val videoRotation by streamViewModel.videoRotation.collectAsStateWithLifecycle()
    // Idea 19 — текущая сцена (слои) для панели «Слои».
    val scene by streamViewModel.scene.collectAsStateWithLifecycle()
    // plans/03 — выбранный для жестов слой (подсветка в панели «Слои», позже — рамка на превью).
    val selectedLayerId by streamViewModel.selectedLayerId.collectAsStateWithLifecycle()
    // idea 35 — аспект источника камеры для АДАПТИВНОЙ рамки выделения камера-слоя (картинки — по bitmap).
    val cameraAspect by streamViewModel.cameraAspect.collectAsStateWithLifecycle()
    val cameraAspects by streamViewModel.cameraAspects.collectAsStateWithLifecycle()  // мульти-источники: аспект per-слой
    // plans/05 S4 — доступные источники для пикера в панели «Слои» (все встроенные + UVC + виртуалка).
    val availableSources by deviceManager.availableSources.collectAsStateWithLifecycle()

    // Idea 24 — для DeviceCameraOpener (Camera2) нужен Context.
    val appContext = LocalContext.current

    var showPlatformsOverlay by remember { mutableStateOf(false) }
    var showLayersOverlay by remember { mutableStateOf(false) }
    // idea 40 / plans/18 Ф0 — панель сцен (список в стиле слоёв, от левого края). Ф0: текущая сцена + сброс.
    var showScenesOverlay by remember { mutableStateOf(false) }
    // plans/14 — менеджер профилей кодера (открывается из формы платформы кнопкой «Управление…»).
    var showEncoderOverlay by remember { mutableStateOf(false) }
    // plans/03 S7 — контекст-меню слоя (долгий тап на превью): id целевого слоя и точка вызова.
    var contextMenuLayerId by remember { mutableStateOf<String?>(null) }
    var contextMenuOffset by remember { mutableStateOf(Offset.Zero) }
    // Слой, ожидающий подтверждения удаления из контекст-меню (модалка).
    var contextDeleteLayer by remember { mutableStateOf<Pair<String, String>?>(null) }


    // Bridge USB events → DeviceManager (keeps :feature:usb decoupled from :feature:capture)
    LaunchedEffect(usbState.activeCameraId) {
        val id = usbState.activeCameraId
        if (id != null) {
            val device = usbState.connectedDevices.firstOrNull { it.deviceId == id }
            if (device != null) {
                deviceManager.notifyUvcConnected(
                    VideoSource.UvcCamera(
                        id          = id.toString(),
                        displayName = device.productName ?: "USB Camera",
                        vendorId    = device.vendorId,
                        productId   = device.productId,
                    )
                )
            }
        }
    }
    LaunchedEffect(usbState.connectedDevices.size) {
        val active = usbState.activeCameraId ?: return@LaunchedEffect
        if (usbState.connectedDevices.none { it.deviceId == active }) {
            deviceManager.notifyUvcDisconnected(active.toString())
        }
    }

    // Wire источник камеры → слой композитора (Phase 3).
    // Здесь мы лишь сообщаем стримеру, ЧЕМ открывать слой-камеру (реальная UVC / встроенная /
    // виртуальная / нет источника). OES-поверхность слоя создаёт сам композитор; открытие камеры
    // происходит, когда поверхность готова (RtmpStreamer.onCameraSurfaceReady → CameraOpener.open).
    // startPreview триггерится ТОЛЬКО из onTextureViewReady (двойной вызов стартовал/гасил GL — RC1).
    // Plan 05 (S3): активный источник (`activeSource` из DeviceManager) — ЕДИНСТВЕННЫЙ источник правды.
    // Раньше «camera != null → UVC» побеждало всегда → нельзя было выбрать встроенную при воткнутой
    // вебке. Теперь opener выбирается ПО activeSource: пользователь ЯВНО задаёт источник камера-слоя
    // (front/rear/UVC/none), без магии приоритета. Для UVC берём AUSBC-объект камеры из usbState.
    // ДЕФОЛТНЫЙ слой-камера id="camera": источник по глобальному activeSource (backward-compat: select-source,
    // авто-UVC на старте). ДОПОЛНИТЕЛЬНЫЕ слои-камеры (id != "camera") — по их СОБСТВЕННОМУ источнику из сцены
    // (см. LaunchedEffect ниже). Так мульти-источники: разные фиды на разных слоях (idea 21 Фаза B).
    LaunchedEffect(activeSource, usbState.activeCamera) {
        val lid = "camera"
        when (val src = activeSource) {
            is VideoSource.UvcCamera -> {
                val camera = usbState.activeCamera
                if (camera != null) {
                    val w = usbState.activeCameraWidth.takeIf { it > 0 } ?: 1920
                    val h = usbState.activeCameraHeight.takeIf { it > 0 } ?: 1080
                    streamViewModel.setCameraOpener(lid, UvcCameraOpener(camera, previewWidth = w, previewHeight = h,
                        onAspect = { streamViewModel.setCameraAspect(lid, it) },
                        onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) },
                        sourceKey = "uvc:${src.id}"))  // bug 58 — ключ физ-устройства (запрет дубля на 2 слоя)
                } else {
                    streamViewModel.setCameraOpener(lid, null) // UVC выбрана, но объект камеры ещё не готов
                }
            }
            is VideoSource.Virtual -> streamViewModel.setCameraOpener(lid,
                VirtualCameraOpener(onAspect = { streamViewModel.setCameraAspect(lid, it) },
                    onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) }))
            is VideoSource.PhoneCamera -> streamViewModel.setCameraOpener(lid,
                DeviceCameraOpener(appContext, src.cameraId, onAspect = { streamViewModel.setCameraAspect(lid, it) },
                    onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) },
                    // bug 60 — HAL не тянет фронт+тыл разом: конфликт → честный статус + откат источника слоя.
                    onConflict = {
                        streamViewModel.postWarning(com.kriniks.kcam.feature.streaming.ui.UiText.Res(R.string.camera_conflict_builtin))
                        streamViewModel.onBuiltinCameraConflict(lid)
                    }))
            is VideoSource.None -> streamViewModel.setCameraOpener(lid, null)
        }
    }

    // Мульти-источники (idea 21 Фаза B): ДОПОЛНИТЕЛЬНЫЕ слои-камеры (id != "camera") — свой источник из
    // свойства слоя (Layer.VideoCapture.source), маппим CaptureSource → opener независимо для каждого.
    // Для UVC берём AUSBC-объект из usbState (одно физ. устройство). Тест: вебка + фронталка-селфи.
    val extraCameraLayers = scene.layers.filterIsInstance<com.kriniks.kcam.feature.streaming.scene.Layer.VideoCapture>()
        .filter { it.id != "camera" }
    LaunchedEffect(extraCameraLayers.map { it.id to it.source }, usbState.activeCamera) {
        for (layer in extraCameraLayers) {
            val lid = layer.id
            val opener: com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer.CameraOpener? =
                when (val cs = layer.source) {
                    is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Uvc -> usbState.activeCamera?.let { cam ->
                        val w = usbState.activeCameraWidth.takeIf { it > 0 } ?: 1920
                        val h = usbState.activeCameraHeight.takeIf { it > 0 } ?: 1080
                        UvcCameraOpener(cam, previewWidth = w, previewHeight = h,
                            onAspect = { streamViewModel.setCameraAspect(lid, it) },
                            onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) },
                            sourceKey = "uvc:${cs.deviceId}")  // bug 58 — ключ физ-устройства (запрет дубля)
                    }
                    is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Builtin -> DeviceCameraOpener(
                        appContext, cs.cameraId, onAspect = { streamViewModel.setCameraAspect(lid, it) },
                        onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) },
                        // bug 60 — HAL не тянет две встроенные разом: конфликт → честный статус + откат источника слоя.
                        onConflict = {
                            streamViewModel.postWarning(com.kriniks.kcam.feature.streaming.ui.UiText.Res(R.string.camera_conflict_builtin))
                            streamViewModel.onBuiltinCameraConflict(lid)
                        })
                    is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Virtual -> VirtualCameraOpener(
                        onAspect = { streamViewModel.setCameraAspect(lid, it) },
                        onOrientation = { d, m -> streamViewModel.setCameraOrientation(lid, d, m) })
                    is com.kriniks.kcam.feature.streaming.scene.CaptureSource.None -> null
                }
            streamViewModel.setCameraOpener(lid, opener)
        }
    }

    // bug 64 (Криник) — приложение вернулось на передний план: если другое приложение (Instagram/камера)
    // забрало камеру, пока KrinikCam был свёрнут, — переоткрываем её (мёртвые камеры), фид восстанавливается
    // без заморозки/заглушки. Пока KrinikCam на переднем плане, ОС уже не даёт фоновым приложениям забрать камеру.
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
        streamViewModel.onAppResumed()
    }

    // Фон ПРОЗРАЧНЫЙ (bug 49): вынесенное в MainActivity превью просвечивает из-под NavHost.
    Box(modifier = Modifier.fillMaxSize()) {

        // ── Layer 0: Viewfinder ВЫНЕСЕН в MainActivity (ВЫШЕ NavHost) — bug 49 ──
        // Превью-TextureView здесь БОЛЬШЕ НЕТ: оно живёт в `MainActivity.setContent` ПОД NavHost, чтобы
        // навигация в Settings и обратно не диспоузила/пересоздавала его поверхность (краш оконного HWUI
        // «drawRenderNode ... no surface», bug 49, семья 27/31). Корневой Box здесь ПРОЗРАЧНЫЙ — превью
        // просвечивает из-под NavHost, а контролы-слои ниже рисуются поверх него (тот же визуальный z-order).

        // ── Заглушка «нет сигнала» теперь ВНУТРИ слоя-камеры GL-композитора ──────
        // Указание Криника: «заглушка живёт ВНУТРИ слоя, а не поверх экрана; отвал одного источника не
        // рушит всю сцену». Раньше здесь был полноэкранный Compose-оверлей StandbyPlaceholder — он
        // накрывал ВСЮ сцену, не двигался со слоем и жил только в превью (в эфир/запись не попадал).
        // Теперь заглушку рисует сам композитор В КВАДРАТЕ слоя-камеры (CompositorVideoSource: hold
        // последнего кадра STANDBY_HOLD_MS → плавный фейд STANDBY_FADE_MS; StandbyImage). Она двигается
        // и масштабируется со слоем, попадает в эфир и запись, и появляется только в отвалившемся слое.
        // Здесь, в Compose-слое поверх превью, заглушке делать больше нечего.

        // ── Layer 0.7: Жест-оверлей слоёв (plans/03 S2/S3/S4/S5) ──
        // ВСЕГДА активен. Тап (S5) — хиттест: выбрать верхний видимый слой под точкой (или снять).
        // Когда слой ВЫБРАН — перетаскивание/щипок/два пальца двигают его (nudgeSelectedLayer).
        // Стоит НИЖЕ контролов (кнопка поворота/FAB/меню добавлены позже → они сверху и кликабельны).
        run {
            val gestureRotation = videoRotation
            // Перевод точки/дельты ЭКРАН→СЦЕНА и обратно (учёт леттербокса и поворота холста).
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(selectedLayerId, gestureRotation) {
                        detectTransformGestures { centroid, pan, zoom, rotation ->
                            if (selectedLayerId == null) return@detectTransformGestures
                            val w = size.width.toFloat(); val h = size.height.toFloat()
                            val portrait = gestureRotation == 90 || gestureRotation == 270
                            val aspect = if (portrait) 9f / 16f else 16f / 9f
                            val contentW = minOf(w, h * aspect); val contentH = contentW / aspect
                            val left = (w - contentW) / 2f; val top = (h - contentH) / 2f
                            val fx = pan.x / contentW; val fy = pan.y / contentH
                            // S4 — экранный pan → координаты НЕПОВЁРНУТОЙ сцены (двухпроходный FBO;
                            // знаки подтверждены live-свайпом, учтён Y-флип текстур прохода 2).
                            val (dCx, dCy) = when (gestureRotation) {
                                90 -> fy to -fx
                                180 -> -fx to -fy
                                270 -> -fy to fx
                                else -> fx to fy
                            }
                            // ПИВОТ (центроид пальцев) экран→scene (как хиттест S5) — чтобы масштаб/поворот
                            // шли вокруг точки между пальцами (Криник: интуитивнее, как в фоторедакторах).
                            val gfx = ((centroid.x - left) / contentW).coerceIn(0f, 1f)
                            val gfy = ((centroid.y - top) / contentH).coerceIn(0f, 1f)
                            val (pvx, pvy) = when (gestureRotation) {
                                90 -> gfy to (1f - gfx)
                                180 -> (1f - gfx) to (1f - gfy)
                                270 -> (1f - gfy) to gfx
                                else -> gfx to gfy
                            }
                            // rotation как есть: проверено инъекцией на tear-off сборке — пальцы по
                            // часовой → контент по часовой (совпадает). Спин контента и орбита пивота
                            // используют один знак → согласованы (жёсткий поворот вокруг центроида).
                            streamViewModel.nudgeSelectedLayer(dCx, dCy, zoom, rotation, pvx, pvy)
                        }
                    }
                    .pointerInput(gestureRotation, scene) {
                        // S5 — тап по превью: хиттест верхнего видимого слоя; S7 — долгий тап → меню.
                        detectTapGestures(
                            // S6 tear-off — на КАЖДОМ нажатии сбрасываем сырое состояние жеста, чтобы
                            // оно переинициализировалось от текущей трансформы (иначе снап залипает).
                            onPress = { streamViewModel.beginLayerGesture() },
                            onTap = { pos ->
                                val hit = hitTestLayer(pos.x, pos.y, size.width.toFloat(), size.height.toFloat(),
                                    gestureRotation, scene.layers)
                                streamViewModel.selectLayer(hit) // null = снять выбор (тап по полю)
                            },
                            onLongPress = { pos ->
                                // S7 — контекст-меню слоя под точкой (удалить/дублировать/на весь экран).
                                val hit = hitTestLayer(pos.x, pos.y, size.width.toFloat(), size.height.toFloat(),
                                    gestureRotation, scene.layers)
                                if (hit != null) {
                                    if (selectedLayerId != hit) streamViewModel.selectLayer(hit) // без toggle-off
                                    contextMenuLayerId = hit
                                    contextMenuOffset = pos
                                }
                            },
                        )
                    },
            )
        }

        // ── Layer 0.8: Рамка выделенного слоя на превью (plans/03 S5) ──
        // Тонкая розовая рамка вокруг выбранного слоя (interview_007 Q2=B), чтобы блогер ВИДЕЛ, что
        // выбрано. Неинтерактивная (без pointerInput). Габарит слоя (scale, cx,cy) переводим scene→
        // экран с учётом леттербокса и поворота холста (обратно к хиттесту S5). Поворот СОДЕРЖИМОГО
        // слоя рамка пока не отражает (axis-aligned, первый заход) — этого достаточно «увидеть выбор».
        selectedLayerId?.let { selId ->
            val sel = scene.layers.firstOrNull { it.id == selId }
            if (sel != null && sel.visible) {
                val gestureRotation = videoRotation
                // idea 35 — АСПЕКТ слоя (картинка = bitmap, камера = cameraAspect) → полуразмеры слоя в
                // scene-долях (для адаптивной рамки И детекции снапа краёв заподлицо).
                val selAspect = when (sel) {
                    is com.kriniks.kcam.feature.streaming.scene.Layer.Image ->
                        if (sel.bitmap.height > 0) sel.bitmap.width.toFloat() / sel.bitmap.height else 16f / 9f
                    // Мульти-источники: аспект ИМЕННО этого слоя-камеры (не глобальный — иначе рамка UVC
                    // берёт аспект селфи). Фолбэк на глобальный/16:9, пока опенер слоя не сообщил свой.
                    else -> cameraAspects[sel.id] ?: cameraAspect
                }
                val aFit = selAspect / (16f / 9f)
                val halfW = if (aFit <= 1f) sel.transform.scale * aFit / 2f else sel.transform.scale / 2f
                val halfH = if (aFit <= 1f) sel.transform.scale / 2f else sel.transform.scale / aFit / 2f
                // plans/03 S6 + idea 35 — состояние снапа (значение уже защёлкнуто в nudge). Край = слой
                // прилип ЗАПОДЛИЦО к краю кадра (cx=halfW или 1-halfW), центр = 0.5.
                val eps = 0.001f
                val cxCenter = kotlin.math.abs(sel.transform.cx - 0.5f) < eps
                val cyCenter = kotlin.math.abs(sel.transform.cy - 0.5f) < eps
                val cxEdge = kotlin.math.abs(sel.transform.cx - halfW) < eps || kotlin.math.abs(sel.transform.cx - (1f - halfW)) < eps
                val cyEdge = kotlin.math.abs(sel.transform.cy - halfH) < eps || kotlin.math.abs(sel.transform.cy - (1f - halfH)) < eps
                val rotSnapped = sel.transform.rotation % 90 == 0 && sel.transform.rotation != 0
                // Haptic-тик при НОВОМ защёлкивании любого снапа (лёгкая вибрация, interview_007 Q4).
                val view = LocalView.current
                val anySnap = cxCenter || cyCenter || cxEdge || cyEdge || rotSnapped
                LaunchedEffect(anySnap) {
                    if (anySnap) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                }
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val w = size.width; val h = size.height
                    val portrait = gestureRotation == 90 || gestureRotation == 270
                    val aspect = if (portrait) 9f / 16f else 16f / 9f
                    val cW = minOf(w, h * aspect); val cH = cW / aspect
                    val left = (w - cW) / 2f; val top = (h - cH) / 2f
                    val t = sel.transform
                    val a = 16f / 9f
                    // idea 35 — рамка АДАПТИВНА под аспект слоя: полуразмеры halfW/halfH (посчитаны выше по
                    // аспекту+scale) вместо квадратного half. Квадратная картинка → квадратная рамка, текст
                    // (низкий-широкий) → широкая низкая, камера 4:3 → 4:3 и т.д.
                    // Поворот содержимого слоя (CW-визуально для +rotation, как в композиторе), аспект-
                    // корректно: локальный угол в аспект-пространстве (x·a) → поворот → обратно.
                    val rot = Math.toRadians(t.rotation.toDouble())
                    val cosR = kotlin.math.cos(rot).toFloat(); val sinR = kotlin.math.sin(rot).toFloat()
                    fun corner(dx: Float, dy: Float): Pair<Float, Float> {
                        val ax = dx * a; val ay = dy
                        val rx = ax * cosR - ay * sinR
                        val ry = ax * sinR + ay * cosR
                        return (t.cx + rx / a) to (t.cy + ry)
                    }
                    // 4 угла слоя (по часовой) в scene-координатах, уже повёрнутые.
                    val sc = listOf(
                        corner(-halfW, -halfH), corner(halfW, -halfH),
                        corner(halfW, halfH), corner(-halfW, halfH),
                    )
                    // scene → доля экранного контента (обратно к S5-развороту точки), затем → пиксели.
                    fun toScreen(sx: Float, sy: Float): Offset {
                        val (fx, fy) = when (gestureRotation) {
                            90 -> (1f - sy) to sx
                            180 -> (1f - sx) to (1f - sy)
                            270 -> sy to (1f - sx)
                            else -> sx to sy
                        }
                        return Offset(left + fx * cW, top + fy * cH)
                    }
                    val pts = sc.map { toScreen(it.first, it.second) }
                    // Рамкой обводим повёрнутый прямоугольник (полигон), а не axis-aligned габарит.
                    for (i in pts.indices) {
                        drawLine(
                            color = Color(0xFFFF1A8C),
                            start = pts[i], end = pts[(i + 1) % pts.size],
                            strokeWidth = 4f,
                        )
                    }

                    // ── S6: направляющие снапа (голубые) — блогер видит, к чему прилип слой ──
                    // idea 35: линии ЛЁГКИЕ/полупрозрачные (Криник: яркие сильно отвлекали) — видно, но
                    // ненавязчиво. Альфа ~45%, тоньше.
                    val guide = Color(0x7300E5FF)
                    // Центр холста: вертикальная / горизонтальная линия через середину кадра.
                    if (cxCenter) drawLine(guide, toScreen(0.5f, 0f), toScreen(0.5f, 1f), strokeWidth = 2.5f)
                    if (cyCenter) drawLine(guide, toScreen(0f, 0.5f), toScreen(1f, 0.5f), strokeWidth = 2.5f)
                    // idea 35 — прижатие КРАЯ слоя ЗАПОДЛИЦО к краю кадра: линия по тому краю кадра, к
                    // которому слой прилип (левый край слоя у cx=halfW → линия по левому краю кадра, и т.д.).
                    if (kotlin.math.abs(sel.transform.cx - halfW) < eps) drawLine(guide, toScreen(0f, 0f), toScreen(0f, 1f), strokeWidth = 2.5f)
                    if (kotlin.math.abs(sel.transform.cx - (1f - halfW)) < eps) drawLine(guide, toScreen(1f, 0f), toScreen(1f, 1f), strokeWidth = 2.5f)
                    if (kotlin.math.abs(sel.transform.cy - halfH) < eps) drawLine(guide, toScreen(0f, 0f), toScreen(1f, 0f), strokeWidth = 2.5f)
                    if (kotlin.math.abs(sel.transform.cy - (1f - halfH)) < eps) drawLine(guide, toScreen(0f, 1f), toScreen(1f, 1f), strokeWidth = 2.5f)
                    // Штриховая ось через ЦЕНТР слоя при снапе угла к кратному 90° (interview_007 Q3).
                    if (rotSnapped) {
                        val dash = PathEffect.dashPathEffect(floatArrayOf(22f, 16f), 0f)
                        val midL = Offset((pts[0].x + pts[3].x) / 2f, (pts[0].y + pts[3].y) / 2f)
                        val midR = Offset((pts[1].x + pts[2].x) / 2f, (pts[1].y + pts[2].y) / 2f)
                        val midT = Offset((pts[0].x + pts[1].x) / 2f, (pts[0].y + pts[1].y) / 2f)
                        val midB = Offset((pts[2].x + pts[3].x) / 2f, (pts[2].y + pts[3].y) / 2f)
                        drawLine(guide, midL, midR, strokeWidth = 2.5f, pathEffect = dash)
                        drawLine(guide, midT, midB, strokeWidth = 2.5f, pathEffect = dash)
                    }
                }
            }
        }

        // ── Layer 0.9: Контекст-меню слоя (plans/03 S7, долгий тап) ──
        contextMenuLayerId?.let { ctxId ->
            val ctxLayer = scene.layers.firstOrNull { it.id == ctxId }
            Box(modifier = Modifier.offset {
                IntOffset(contextMenuOffset.x.roundToInt(), contextMenuOffset.y.roundToInt())
            }) {
                DropdownMenu(expanded = true, onDismissRequest = { contextMenuLayerId = null }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.layer_menu_fullscreen)) },
                        onClick = { streamViewModel.resetLayerFullscreen(ctxId); contextMenuLayerId = null },
                    )
                    // Дублирование — пока только для картинок (камера = Фаза B мультизахвата).
                    if (ctxLayer is Layer.Image) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.layer_menu_duplicate)) },
                            onClick = { streamViewModel.duplicateLayer(ctxId); contextMenuLayerId = null },
                        )
                    }
                    // Удаление — не для камеры-базы; через модалку подтверждения.
                    if (ctxLayer != null && ctxLayer !is Layer.VideoCapture) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_delete), color = Color(0xFFCC5555)) },
                            onClick = { contextDeleteLayer = ctxId to ctxLayer.name; contextMenuLayerId = null },
                        )
                    }
                }
            }
        }
        // Модалка подтверждения удаления из контекст-меню.
        contextDeleteLayer?.let { (id, name) ->
            AlertDialog(
                onDismissRequest = { contextDeleteLayer = null },
                title = { Text(stringResource(R.string.layer_delete_title), color = Color.White) },
                text = { Text(stringResource(R.string.layer_delete_text, name), color = Color(0xFFCCCCCC)) },
                confirmButton = {
                    TextButton(onClick = { streamViewModel.removeLayer(id); contextDeleteLayer = null }) {
                        Text(stringResource(R.string.common_delete), color = Color(0xFFCC5555))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { contextDeleteLayer = null }) { Text(stringResource(R.string.common_cancel), color = Color(0xFF999999)) }
                },
            )
        }

        // ── Layer 1: Rotation menu (top-right) — ВСЕГДА виден (bug 21) ──────
        // Розовая кнопка глобального поворота ХОЛСТА над сценой (interview_006): 0/90/180/270,
        // 90/270 = портретный 9:16 выход. Композитор живёт всегда → кнопка тоже всегда на месте.
        // Locked while streaming (changing resolution mid-RTMP breaks YouTube) — tap shows a hint.
        RotationMenu(
            currentRotation = videoRotation,
            enabled = !streamState.isActive,
            onSelectRotation = { streamViewModel.setVideoRotation(it) },
            onLockedTap = { streamViewModel.rotationLockedHint() },
            modifier = Modifier.fillMaxSize(),
        )

        // ── Layer 2: Live indicator (top-left) ───────────────────────
        // idea 39 — сводка кодера для развёрнутого статус-виджета: «H.264 · 1080p30» (кодек резолвится как
        // в стримере — по активному профилю с фолбэком на первый).
        val activeEncoder = encoderProfiles.firstOrNull { it.id == activeProfile?.encoderProfileId }
            ?: encoderProfiles.firstOrNull()
        val encoderSummary = activeEncoder?.let {
            // Криник — битрейт компактно к нотации: «H.264 • 1080p30 • 4M» (M = Mbps).
            val mbps = it.videoBitrateBps / 1_000_000f
            val mbpsStr = if (mbps == mbps.toInt().toFloat()) "${mbps.toInt()}" else "%.1f".format(mbps)
            "${it.videoCodec.displayName.substringBefore(" /").trim()} • ${it.videoHeight}p${it.videoFps} • ${mbpsStr}M"
        }
        AnimatedVisibility(
            visible = streamState.isLive,
            enter = fadeIn() + slideInHorizontally(),
            exit = fadeOut() + slideOutHorizontally(),
            modifier = Modifier.align(Alignment.TopStart).padding(16.dp),
        ) {
            StreamStatusWidget(streamState, encoderSummary)
        }

        // ── Layer 3: Snackbar for stream errors / warnings ───────────
        val snackbarHostState = remember { SnackbarHostState() }
        // plans/13 — VM эмитит UiText (ресурс+аргументы), резолвим здесь (у UI есть Context).
        val snackbarContext = LocalContext.current
        LaunchedEffect(Unit) {
            streamViewModel.snackbar.collect { msg ->
                snackbarHostState.showSnackbar(msg.resolve(snackbarContext), duration = SnackbarDuration.Short)
            }
        }
        // Криник — снэкбары ВВЕРХУ: внизу их перекрывали FAB/панели, было не видно. Ставим под строкой
        // статуса (ниже LIVE-бейджа/кнопки поворота), по центру, с боковыми отступами.
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 72.dp, start = 16.dp, end = 16.dp),
        )

        // ── Layer 4: Главное меню действий (FAB внизу-справа + список) ──
        // Криник 2026-07-19: «всё в список, радиалка грузит» — веер заменён панелью-списком (FloatingPanelMenu).
        FloatingActionMenu(
            streamState = streamState,
            onStartStream = { streamViewModel.startStream() },
            onStopStream = { streamViewModel.stopStream() },
            // idea 17 — юзер-кнопки записи/фото (механика давно готова, это только UI-обвязка).
            onRecord = { streamViewModel.startRecording() },
            onPhoto = { streamViewModel.capturePhoto() },
            onOpenPlatforms = { showPlatformsOverlay = true },
            // Криник — профили кодера прямо из меню (второй из трёх входов).
            onOpenEncoderProfiles = { showEncoderOverlay = true },
            onOpenSettings = onNavigateToSettings,
            modifier = Modifier.fillMaxSize(),
        )

        // ── Layer 4.5: Отдельный маленький FAB «Слои» внизу-слева (Криник 2026-07-06, plans/05 S6) ──
        SmallFloatingActionButton(
            onClick = { showLayersOverlay = true },
            containerColor = Color(0xFF232323),
            contentColor = Color(0xFFFF1A8C),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(16.dp),
        ) {
            Icon(Icons.Default.Layers, contentDescription = stringResource(R.string.main_layers_desc))
        }

        // ── Layer 4.6: FAB «Сцены» РЯДОМ с FAB слоёв (idea 40 / plans/18 Ф0) ──
        // Та же форма/тон, что у FAB слоёв. Тап → панель-список сцен (как у слоёв, от левого края).
        SmallFloatingActionButton(
            onClick = { showScenesOverlay = true },
            containerColor = Color(0xFF232323),
            contentColor = Color(0xFFFF1A8C),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 76.dp, bottom = 16.dp),
        ) {
            Icon(Icons.Default.Movie, contentDescription = stringResource(R.string.main_scenes_desc))
        }
    }

    // ── Панель сцен (idea 40 / plans/18 Ф0) — список в стиле слоёв, от левого края ──
    // Ф0: индикатор текущей сцены (сцена автосейвится и переживает рестарт под капотом). Фаза 1: список
    // именованных сцен (тап = переключить) + «＋ Новая / Дублировать / Переименовать / Удалить».
    if (showScenesOverlay) {
        FloatingPanelMenu(
            onDismiss = { showScenesOverlay = false },
            alignment = Alignment.BottomStart,
            modifier = Modifier.fillMaxSize(),
        ) {
            PanelInfoRow(
                title = stringResource(R.string.scenes_current, scene.layers.size),
                icon = Icons.Default.Movie,
            )
        }
    }

    // ── Layer 5: Platforms modal overlay ────────────────────────────
    if (showPlatformsOverlay) {
        StreamPlatformsOverlay(
            profiles = profiles,
            activeProfileId = activeProfile?.id,
            encoderProfiles = encoderProfiles,
            onManageEncoders = { showEncoderOverlay = true },
            onDismiss = { showPlatformsOverlay = false },
            onSelectProfile = { streamViewModel.selectProfile(it) },
            onSaveProfile = { streamViewModel.saveProfile(it) },
            onDeleteProfile = { streamViewModel.deleteProfile(it) },
            onStartStream = { streamViewModel.startStream(); showPlatformsOverlay = false },
            buildExportJson = { streamViewModel.buildExportJson() },
            onImportJson = { streamViewModel.importProfilesFromJson(it) },
        )
    }

    // ── plans/14 — менеджер профилей кодера (поверх формы платформы) ──
    if (showEncoderOverlay) {
        EncoderProfilesOverlay(
            profiles = encoderProfiles,
            supportedCodecs = supportedCodecs,
            onDismiss = { showEncoderOverlay = false },
            onSaveProfile = { streamViewModel.saveEncoderProfile(it) },
            onDeleteProfile = { streamViewModel.deleteEncoderProfile(it) },
            // Криник — экспорт/импорт профилей кодера (универсальный импорт с отчётом).
            buildExportJson = { streamViewModel.buildEncoderExportJson() },
            onImportJson = { streamViewModel.importEncoderProfilesFromJson(it) },
        )
    }

    // Криник — универсальный отчёт импорта: модалка «Понял» при замечаниях (недостающие/неизвестные значения).
    val importReport by streamViewModel.importReport.collectAsStateWithLifecycle()
    importReport?.let { rep ->
        ImportReportDialog(report = rep, onDismiss = { streamViewModel.dismissImportReport() })
    }

    // ── Layer 6: Scene layers modal overlay (Idea 19 — мульти-источники) ──
    if (showLayersOverlay) {
        // Мульти-источники: id источника ЛЮБОГО слоя-камеры. Дефолтная 'camera' — по глобальному
        // activeSource (гибрид, backward-compat); доп. слои — по их CaptureSource из сцены. Один
        // источник правды и для подсветки текущего, и для запрета дубля источника на 2 слоя (bug 58).
        fun sourceIdOf(layer: Layer): String? =
            if (layer.id == "camera") activeSource.id
            else when (val cs = (layer as? com.kriniks.kcam.feature.streaming.scene.Layer.VideoCapture)?.source) {
                is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Uvc -> cs.deviceId
                is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Builtin ->
                    availableSources.filterIsInstance<com.kriniks.kcam.feature.capture.model.VideoSource.PhoneCamera>()
                        .firstOrNull { it.cameraId == cs.cameraId }?.id
                is com.kriniks.kcam.feature.streaming.scene.CaptureSource.Virtual -> "virtual"
                is com.kriniks.kcam.feature.streaming.scene.CaptureSource.None -> "none"
                else -> null
            }
        // Обратный маппинг id пункта пикера → CaptureSource слоя (для доп. слоёв). Общий для выбора
        // источника (onSelectSource) и добавления слоя сразу с источником (bug 57).
        fun captureSourceOf(optId: String): com.kriniks.kcam.feature.streaming.scene.CaptureSource =
            when (val vs = availableSources.firstOrNull { it.id == optId }) {
                is com.kriniks.kcam.feature.capture.model.VideoSource.UvcCamera ->
                    com.kriniks.kcam.feature.streaming.scene.CaptureSource.Uvc(vs.id, vs.displayName)
                is com.kriniks.kcam.feature.capture.model.VideoSource.PhoneCamera ->
                    com.kriniks.kcam.feature.streaming.scene.CaptureSource.Builtin(vs.cameraId, vs.displayName)
                is com.kriniks.kcam.feature.capture.model.VideoSource.Virtual ->
                    com.kriniks.kcam.feature.streaming.scene.CaptureSource.Virtual
                else -> com.kriniks.kcam.feature.streaming.scene.CaptureSource.None
            }
        StreamLayersOverlay(
            scene = scene,
            onDismiss = { showLayersOverlay = false },
            onAddTestOverlay = { streamViewModel.addTestOverlay() },
            // bug 57 — добавляем слой видео СРАЗУ с выбранным в модалке источником (маппим id → CaptureSource).
            onAddVideoCaptureWithSource = { optId -> streamViewModel.addVideoCaptureLayer(captureSourceOf(optId)) },
            onAddImage = { name, bitmap -> streamViewModel.addImageOverlay(name, bitmap) },
            onToggleVisible = { streamViewModel.toggleLayerVisible(it) },
            onRemove = { streamViewModel.removeLayer(it) },
            onMoveUp = { streamViewModel.moveLayerUp(it) },
            onMoveDown = { streamViewModel.moveLayerDown(it) },
            selectedLayerId = selectedLayerId,
            onSelect = { streamViewModel.selectLayer(it) },
            // plans/05 S4 — источники: все доступные + «Нет источника»; текущий = activeSource.
            // plans/13 — «модельные» источники (Virtual/None — объекты без Context) локализуем на
            // UI-слое по известным id; остальные displayName рождаются локализованными (enumerator).
            sourceOptions = availableSources.map {
                SourceOption(
                    it.id,
                    if (it.id == "virtual") stringResource(R.string.source_virtual) else it.displayName,
                )
            } + SourceOption("none", stringResource(R.string.source_none)),
            // Мульти-источники: подсветка источника PER-СЛОЙ (см. sourceIdOf выше). bug 58 — ОДИН источник
            // можно класть на НЕСКОЛЬКО слоёв (шаринг фида: композитор открывает устройство один раз и
            // раздаёт кадр в слои-зеркала), поэтому дизейбла «занято» больше НЕТ — выбирай свободно.
            currentSourceIdOf = { sourceIdOf(it) },
            // Выбор источника ИМЕННО этому слою. 'camera' → глобальный (гибрид); доп. слои → CaptureSource слоя.
            onSelectSource = { layerId, optId ->
                if (layerId == "camera") {
                    val src = availableSources.firstOrNull { it.id == optId }
                        ?: com.kriniks.kcam.feature.capture.model.VideoSource.None
                    deviceManager.selectVideoSource(src)
                } else {
                    streamViewModel.setCameraLayerSource(layerId, captureSourceOf(optId))
                }
            },
        )
    }
}

@Composable
private fun StreamStatusWidget(state: StreamState, encoderSummary: String?) {
    // idea 39 (Криник) — статус эфира/записи. СВЁРНУТ: компактная пилюля «● LIVE • 12:34 • 4.2 Mbps» —
    // цвет точки = здоровье канала (зелёный/жёлтый/красный). Тап → РАЗВОРОТ (нежно-розовый низ): кодек/
    // разрешение/FPS, дропы, статус КАЖДОЙ платформы мультистрима. Метка ЭФИР vs ЗАПИСЬ по isRecording.
    val live = state as? StreamState.Live ?: return
    var expanded by remember { mutableStateOf(false) }

    val sec = live.durationMs / 1000
    val durationText =
        if (sec >= 3600) "%d:%02d:%02d".format(sec / 3600, (sec % 3600) / 60, sec % 60)
        else "%02d:%02d".format(sec / 60, sec % 60)
    // Битрейт показываем ВСЕГДА (0.0 пока не измерен) — сегмент не появляется/исчезает → ширина стабильна.
    val bitrateText = "%.1f Mbps".format(live.bitrateKbps / 1000f)
    val healthColor = when {
        live.outputs.any { it.phase == OutputPhase.Reconnecting || it.phase == OutputPhase.Failed } -> Color(0xFFFF1744)
        live.outputs.any { it.congested } -> Color(0xFFFFD600)
        else -> Color(0xFF00E676)
    }
    // bug 53 / Криник — табличные цифры: символы не пляшут при смене чисел.
    val tnum = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum")
    val label = stringResource(if (live.isRecording) R.string.fab_rec_badge else R.string.fab_live_badge)

    // Криник — ХОЧУ так: шапка = самостоятельная скруглённая ПИЛЮЛЯ (все 4 угла), а развёрнутый низ —
    // ОТДЕЛЬНАЯ карточка ЧУТЬ УЖЕ, «выпадающая» из-под шапки. От яркой шапки идём в ТЁМНЫЙ, БОРДОВО-красный
    // тон (не светлее — темнее). Радиус постоянный (8dp). Свёрнут — компактно (tnum + битрейт всегда).
    val detailBordeaux = Color(0xFF8A1524)

    Column(
        modifier = Modifier.width(IntrinsicSize.Max).clickable { expanded = !expanded },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ── Шапка — скруглённая пилюля (кислый красный), во всю ширину виджета, ПОВЕРХ выпадайки (zIndex) ──
        Surface(
            color = LiveRed, shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth().zIndex(1f),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    Modifier.size(9.dp)
                        .border(1.dp, Color.White, androidx.compose.foundation.shape.CircleShape)
                        .padding(1.dp)
                        .background(healthColor, androidx.compose.foundation.shape.CircleShape),
                )
                Text(
                    text = "$label • $durationText • $bitrateText",
                    color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, style = tnum,
                    maxLines = 1,
                )
            }
        }
        // ── Выпадайка — ЧУТЬ уже шапки (по 6dp с боков), растёт вниз НЕОТДЕЛИМО: тукается ПОД шапку
        //    (offset -6, шапка сверху по zIndex) → нет чёрной щели, шапка «держит» её сверху. ──
        AnimatedVisibility(visible = expanded, modifier = Modifier.fillMaxWidth().zIndex(0f)) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp)) {
                Surface(
                    color = detailBordeaux, shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().offset(y = (-6).dp),
                ) {
                    Column(
                        Modifier.padding(horizontal = 10.dp).padding(top = 11.dp, bottom = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                    encoderSummary?.let { StatusDetailRow(stringResource(R.string.status_encoder), it, tnum) }
                    if (live.droppedFrames > 0)
                        StatusDetailRow(stringResource(R.string.status_dropped), live.droppedFrames.toString(), tnum)
                    // Статус каждой платформы мультистрима (для записи outputs пуст). Пункты через «•».
                    live.outputs.sortedBy { it.index }.forEach { out ->
                        val phaseLabel = outputPhaseLabel(out.phase)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(7.dp).background(outputColor(out.phase, out.congested), androidx.compose.foundation.shape.CircleShape))
                            val parts = buildString {
                                append(out.name); append(" • "); append(phaseLabel)
                                if (out.phase == OutputPhase.Live) { append(" • "); append("%.1f Mbps".format(out.bitrateKbps / 1000f)) }
                            }
                            Text(parts, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, style = tnum, maxLines = 1)
                            if (out.congested)
                                Text("• " + stringResource(R.string.status_net_congested), color = Color(0xFFFFD600), fontSize = 11.sp)
                        }
                    }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusDetailRow(label: String, value: String, tnum: androidx.compose.ui.text.TextStyle) {
    // На красном фоне: подпись — приглушённо-белая, значение — белое жирное. Пункты в значении — через «•».
    // Криник — ЦЕНТРИРУЕМ по высоте (был дефолт Top → метка/значение несимметричны).
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Криник — важные поля с двоеточием («Кодер:»).
        Text("$label:", color = Color(0xCCFFFFFF), fontSize = 11.sp)
        Text(value, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, style = tnum)
    }
}

// Цвет точки per-платформа: зелёный жив, жёлтый затык/подключение, красный реконнект/ошибка, серый стоп.
private fun outputColor(phase: OutputPhase, congested: Boolean): Color = when (phase) {
    OutputPhase.Live -> if (congested) Color(0xFFFFD600) else Color(0xFF00E676)
    OutputPhase.Connecting -> Color(0xFFFFD600)
    OutputPhase.Reconnecting, OutputPhase.Failed -> Color(0xFFFF1744)
    OutputPhase.Stopped -> Color(0xFF888888)
}

@Composable
private fun outputPhaseLabel(phase: OutputPhase): String = stringResource(
    when (phase) {
        OutputPhase.Live -> R.string.status_phase_live
        OutputPhase.Connecting -> R.string.status_phase_connecting
        OutputPhase.Reconnecting -> R.string.status_phase_reconnecting
        OutputPhase.Failed -> R.string.status_phase_failed
        OutputPhase.Stopped -> R.string.status_phase_stopped
    },
)
