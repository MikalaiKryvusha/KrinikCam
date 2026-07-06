/**
 * MainScreen — fullscreen scene viewfinder with floating overlay controls (Phase 3: единый композитор).
 *
 * Layout:
 *   Layer 0: fullscreen viewfinder — ВСЕГДА живой TextureView, зеркалит композит (сцена = слои)
 *   Layer 0.5: StandbyPlaceholder — оверлей-подсказка ПОВЕРХ превью, когда нет ни одного источника
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

import android.view.TextureView
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.feature.capture.model.VideoSource
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.streaming.model.isLive
import com.kriniks.kcam.feature.streaming.ui.StreamLayersOverlay
import com.kriniks.kcam.feature.streaming.ui.StreamPlatformsOverlay
import androidx.compose.ui.platform.LocalContext
import com.kriniks.kcam.streaming.DeviceCameraOpener
import com.kriniks.kcam.streaming.UvcCameraOpener
import com.kriniks.kcam.streaming.VirtualCameraOpener
import com.kriniks.kcam.feature.streaming.ui.StreamViewModel
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import com.kriniks.kcam.feature.usb.ui.UvcPreviewView
import com.kriniks.kcam.ui.overlay.FloatingRadialMenu
import com.kriniks.kcam.ui.overlay.RotationMenu
import com.kriniks.kcam.ui.overlay.StandbyPlaceholder

private val LiveRed = Color(0xFFFF1A1A)

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
    val activeSource by deviceManager.activeVideoSource.collectAsStateWithLifecycle()
    val videoRotation by streamViewModel.videoRotation.collectAsStateWithLifecycle()
    // Idea 19 — текущая сцена (слои) для панели «Слои».
    val scene by streamViewModel.scene.collectAsStateWithLifecycle()
    // plans/03 — выбранный для жестов слой (подсветка в панели «Слои», позже — рамка на превью).
    val selectedLayerId by streamViewModel.selectedLayerId.collectAsStateWithLifecycle()

    // Idea 24 — для DeviceCameraOpener (Camera2) нужен Context.
    val appContext = LocalContext.current

    var showPlatformsOverlay by remember { mutableStateOf(false) }
    var showLayersOverlay by remember { mutableStateOf(false) }

    // TextureView from UvcPreviewView — held so we can re-start preview when camera connects
    var previewTextureView by remember { mutableStateOf<TextureView?>(null) }

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
    LaunchedEffect(activeSource, usbState.activeCamera) {
        when (val src = activeSource) {
            is VideoSource.UvcCamera -> {
                val camera = usbState.activeCamera
                if (camera != null) {
                    val w = usbState.activeCameraWidth.takeIf { it > 0 } ?: 1920
                    val h = usbState.activeCameraHeight.takeIf { it > 0 } ?: 1080
                    streamViewModel.setCameraOpener(UvcCameraOpener(camera, previewWidth = w, previewHeight = h))
                } else {
                    streamViewModel.setCameraOpener(null) // UVC выбрана, но объект камеры ещё не готов
                }
            }
            // Idea 09 — виртуальная дебаг-камера (нет физической): кормим слой тест-паттерном.
            is VideoSource.Virtual -> streamViewModel.setCameraOpener(VirtualCameraOpener())
            // Idea 24 — встроенная камера устройства (Camera2) как слой-источник (реальный GL-продюсер).
            is VideoSource.PhoneCamera -> streamViewModel.setCameraOpener(DeviceCameraOpener(appContext, src.cameraId))
            // Нет источника → снять opener (камера-слой пуст → видна чёрная база/нижние слои).
            is VideoSource.None -> streamViewModel.setCameraOpener(null)
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {

        // ── Layer 0: Viewfinder — ВСЕГДА живой (Phase 3) ─────────────────────
        // Композитор рисует сцену всегда (чёрная база + слои), с камерой или без — превью-TextureView
        // живёт постоянно и зеркалит композит. Это убирает ветвление when(activeSource), которое
        // пересоздавало/рушило TextureView при смене источника — корень крашей bug 20/23 (EGL_BAD_ALLOC
        // на системном RenderThread) и исчезновения превью (bug 22). Превью повёрнутого холста
        // (портрет 9:16) леттербоксится самим GL (AspectRatioMode.Adjust) — матрицы TextureView нет.
        UvcPreviewView(
            onTextureViewReady = { tv ->
                previewTextureView = tv
                streamViewModel.startPreviewOnView(tv)
            },
            // Restart GL preview on device rotation so the render surface gets new dimensions.
            onSurfaceTextureSizeChanged = { tv, _, _ -> streamViewModel.startPreviewOnView(tv) },
            // Stop GL preview when surface is destroyed (navigation to Settings, backgrounding).
            // Prevents GL_OUT_OF_MEMORY crash from drawing to a dead surface (bug 02). Safe during
            // streaming: stopPreview() is a no-op when isOnPreview=false.
            onSurfaceDestroyed = { streamViewModel.stopPreview() },
            modifier = Modifier.fillMaxSize(),
        )

        // ── Layer 0.5: подсказка «нет источника» ПОВЕРХ живого превью ────────
        // Раньше StandbyPlaceholder ЗАМЕНЯЛ превью (рушил TextureView — bug 20/23); теперь это
        // просто оверлей поверх живого чёрного холста, пока нет ни одного источника камеры.
        if (activeSource is VideoSource.None && !streamState.isActive) {
            StandbyPlaceholder(
                message = "Connect a USB webcam via OTG,\nor check Settings for help",
                modifier = Modifier.fillMaxSize(),
            )
        }

        // ── Layer 0.7: Жест-оверлей трансформы выбранного слоя (plans/03 S2/S3) ──
        // Активен ТОЛЬКО когда выбран слой. Перетаскивание/щипок/два пальца → nudgeSelectedLayer.
        // Стоит НИЖЕ контролов (кнопка поворота/FAB/меню добавлены позже в Box → они сверху и
        // остаются кликабельны); жест ловится в остальной площади. Тап по пустому = снять выбор.
        if (selectedLayerId != null) {
            val gestureRotation = videoRotation // canvas rotation (S4 учтёт в маппинге)
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(selectedLayerId, gestureRotation) {
                        detectTransformGestures { _, pan, zoom, rotation ->
                            // contentRect: композит вписан в экран по аспекту (леттербокс). Для
                            // canvas 0/180 — 16:9, для 90/270 — 9:16 (S4 обобщит повороты pan).
                            val w = size.width.toFloat()
                            val h = size.height.toFloat()
                            val portrait = gestureRotation == 90 || gestureRotation == 270
                            val aspect = if (portrait) 9f / 16f else 16f / 9f
                            val contentW = minOf(w, h * aspect)
                            val contentH = contentW / aspect
                            // S2: pan в доли кадра. Поворот холста в маппинге pan — задача S4.
                            streamViewModel.nudgeSelectedLayer(
                                dCx = pan.x / contentW,
                                dCy = pan.y / contentH,
                                zoom = zoom,
                                dRotation = rotation,
                            )
                        }
                    }
                    .pointerInput(selectedLayerId) {
                        // Тап по пустому месту — снять выбор (пока нет хиттеста превью, S5).
                        detectTapGestures(onTap = { streamViewModel.selectLayer(null) })
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
        AnimatedVisibility(
            visible = streamState.isLive,
            enter = fadeIn() + slideInHorizontally(),
            exit = fadeOut() + slideOutHorizontally(),
            modifier = Modifier.align(Alignment.TopStart).padding(16.dp),
        ) {
            LiveBadge(streamState)
        }

        // ── Layer 3: Snackbar for stream errors / warnings ───────────
        val snackbarHostState = remember { SnackbarHostState() }
        LaunchedEffect(Unit) {
            streamViewModel.snackbar.collect { msg ->
                snackbarHostState.showSnackbar(msg, duration = SnackbarDuration.Short)
            }
        }
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 100.dp),
        )

        // ── Layer 4: Radial FAB menu (bottom-right) ──────────────────
        FloatingRadialMenu(
            streamState = streamState,
            onStartStream = { streamViewModel.startStream() },
            onStopStream = { streamViewModel.stopStream() },
            onOpenPlatforms = { showPlatformsOverlay = true },
            onOpenLayers = { showLayersOverlay = true },
            onOpenSettings = onNavigateToSettings,
            modifier = Modifier.fillMaxSize(),
        )
    }

    // ── Layer 5: Platforms modal overlay ────────────────────────────
    if (showPlatformsOverlay) {
        StreamPlatformsOverlay(
            profiles = profiles,
            activeProfileId = activeProfile?.id,
            onDismiss = { showPlatformsOverlay = false },
            onSelectProfile = { streamViewModel.selectProfile(it) },
            onSaveProfile = { streamViewModel.saveProfile(it) },
            onDeleteProfile = { streamViewModel.deleteProfile(it) },
            onStartStream = { streamViewModel.startStream(); showPlatformsOverlay = false },
            buildExportJson = { streamViewModel.buildExportJson() },
            onImportJson = { streamViewModel.importProfilesFromJson(it) },
        )
    }

    // ── Layer 6: Scene layers modal overlay (Idea 19 — мульти-источники) ──
    if (showLayersOverlay) {
        StreamLayersOverlay(
            scene = scene,
            onDismiss = { showLayersOverlay = false },
            onAddTestOverlay = { streamViewModel.addTestOverlay() },
            onAddImage = { name, bitmap -> streamViewModel.addImageOverlay(name, bitmap) },
            onToggleVisible = { streamViewModel.toggleLayerVisible(it) },
            onRemove = { streamViewModel.removeLayer(it) },
            onMoveUp = { streamViewModel.moveLayerUp(it) },
            onMoveDown = { streamViewModel.moveLayerDown(it) },
            selectedLayerId = selectedLayerId,
            onSelect = { streamViewModel.selectLayer(it) },
        )
    }
}

@Composable
private fun LiveBadge(state: StreamState) {
    val bitrateText = if (state is StreamState.Live && state.bitrateKbps > 0)
        "  ${state.bitrateKbps} kbps" else ""

    Surface(
        color = LiveRed,
        shape = RoundedCornerShape(6.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                Modifier
                    .size(8.dp)
                    .background(Color.White, shape = androidx.compose.foundation.shape.CircleShape),
            )
            Text(
                text = "LIVE$bitrateText",
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
