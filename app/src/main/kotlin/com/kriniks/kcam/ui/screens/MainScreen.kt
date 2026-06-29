/**
 * MainScreen — fullscreen camera viewfinder with floating overlay controls.
 *
 * Layout:
 *   Layer 0: fullscreen viewfinder (UVC preview via GL pipeline or black screen)
 *   Layer 1: StandbyPlaceholder (when no source available)
 *   Layer 2: Live status indicator (top-left when streaming)
 *   Layer 3: Rotation hot button (top-right, when camera active)
 *   Layer 4: FloatingRadialMenu (bottom-right FAB + radial actions)
 *   Layer 5: StreamPlatformsOverlay (modal, shown on demand)
 *
 * Camera → RTMP bridge (Phase 2 architecture):
 *   1. USB camera connects → UsbViewModel.activeCamera is set
 *   2. MainScreen creates UvcVideoSource(camera) and calls streamViewModel.setVideoSource()
 *   3. TextureView becomes available → streamViewModel.startPreviewOnView(tv)
 *   4. GL pipeline starts: UvcVideoSource.start(glSurfaceTexture) opens USB camera
 *      Camera frames → GL input → GL preview on TextureView + encoder when streaming
 *   5. User presses Go Live → streamViewModel.startStream()
 *
 * Both orderings handled (camera before TextureView, and TextureView before camera).
 *
 * Related: UsbViewModel, StreamViewModel, UvcVideoSource, DeviceManager, FloatingRadialMenu
 */

package com.kriniks.kcam.ui.screens

import android.view.TextureView
import androidx.compose.animation.*
import androidx.compose.foundation.background
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

    // Wire USB camera → RtmpStream GL pipeline.
    // Only calls setVideoSource — startPreview is triggered solely from onTextureViewReady.
    // Having two startPreview callers caused stopPreview() to cancel GL init (RC1 double-trigger bug).
    //
    // streamState.isActive is a second key so that when streaming stops (isActive: true→false),
    // this effect re-runs and re-calls setVideoSource() even if the camera object didn't change.
    // Without this, AUSBC may reconnect the SAME camera object during streaming (so activeCamera
    // ref doesn't change), setVideoSource() is blocked by the guard, and preview stays black
    // after streaming ends because nothing triggers a re-bind.
    // Idea 21 — камера = обычный СЛОЙ над чёрной базой. Здесь мы лишь сообщаем стримеру, ЧЕМ открывать
    // слой-камеру (реальная UVC / виртуальная / нет источника). Сам слой-фильтр и его SurfaceTexture
    // создаёт SceneCompositor; открытие камеры происходит, когда у слоя готова поверхность.
    LaunchedEffect(usbState.activeCamera, activeSource) {
        val camera = usbState.activeCamera
        when {
            camera != null -> {
                val w = usbState.activeCameraWidth.takeIf { it > 0 } ?: 1920
                val h = usbState.activeCameraHeight.takeIf { it > 0 } ?: 1080
                streamViewModel.setCameraOpener(UvcCameraOpener(camera, previewWidth = w, previewHeight = h))
            }
            // Idea 09 — виртуальная дебаг-камера (нет физической): кормим слой тест-паттерном.
            activeSource is VideoSource.Virtual -> streamViewModel.setCameraOpener(VirtualCameraOpener())
            // Нет источника камеры → снять opener (камера-слой станет пустым → видна чёрная база/нижние слои).
            else -> streamViewModel.setCameraOpener(null)
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {

        // ── Layer 0: Viewfinder ──────────────────────────────────────
        when (activeSource) {
            is VideoSource.UvcCamera -> {
                // Показываем GL-превью, когда физическая камера есть, ЛИБО пока идёт стрим. Во время
                // стрима GL-пайплайн продолжает рисовать КОМПОЗИТ (заглушка вместо камеры + оверлеи),
                // и превью обязано его ЗЕРКАЛИТЬ — иначе при пропаже камеры Compose-StandbyPlaceholder
                // на весь экран рушит TextureView и прячет все слои (хотя в стрим композит идёт верно).
                if (usbState.activeCamera != null || streamState.isActive) {
                    // rememberUpdatedState so the lambdas below always read the latest camera
                    // state even though the TextureView listener captures them by reference.
                    val currentCamera by rememberUpdatedState(usbState.activeCamera)
                    // GL pipeline renders its output (camera frames) into this TextureView
                    UvcPreviewView(
                        onTextureViewReady = { tv ->
                            previewTextureView = tv
                            // (Пере)подцепить превью: при наличии камеры — обычный старт; во время
                            // стрима с пропавшей камерой startPreview просто переподцепляет surface к
                            // уже работающему GL энкодера → показывает композит заглушка+оверлеи.
                            if (currentCamera != null || streamState.isActive) {
                                streamViewModel.startPreviewOnView(tv)
                            }
                        },
                        // Restart GL preview on rotation so the render surface gets new dimensions.
                        onSurfaceTextureSizeChanged = { tv, _, _ ->
                            if (currentCamera != null || streamState.isActive) {
                                streamViewModel.startPreviewOnView(tv)
                            }
                        },
                        // Stop GL preview when surface is destroyed (navigation to Settings,
                        // backgrounding). Prevents GL_OUT_OF_MEMORY crash from drawing to a dead
                        // surface. Safe during streaming: stopPreview() is a no-op when isOnPreview=false.
                        onSurfaceDestroyed = { streamViewModel.stopPreview() },
                        // Display-only preview rotation (Idea 06) — letterboxed via TextureView matrix.
                        // While streaming the GL scene itself is rotated (for the portrait encoder),
                        // so the matrix must be identity (0) to avoid double-rotating the preview.
                        rotationDegrees = if (streamState.isActive) 0 else videoRotation,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    StandbyPlaceholder(modifier = Modifier.fillMaxSize())
                }
            }
            is VideoSource.Virtual -> {
                // Idea 09 — virtual debug camera: same GL preview path as UVC (synthetic frames).
                UvcPreviewView(
                    onTextureViewReady = { tv ->
                        previewTextureView = tv
                        streamViewModel.startPreviewOnView(tv)
                    },
                    onSurfaceTextureSizeChanged = { tv, _, _ -> streamViewModel.startPreviewOnView(tv) },
                    onSurfaceDestroyed = { streamViewModel.stopPreview() },
                    rotationDegrees = if (streamState.isActive) 0 else videoRotation,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            is VideoSource.PhoneCamera -> {
                StandbyPlaceholder(
                    message = "Phone camera preview coming soon",
                    modifier = Modifier.fillMaxSize(),
                )
            }
            VideoSource.None -> {
                StandbyPlaceholder(
                    message = "Connect a USB webcam via OTG,\nor check Settings for help",
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        // ── Layer 1: Rotation menu (top-right, camera active only) ──────────
        // Tap → pick angle (0/90/180/270). 90/270 = portrait 9:16 stream (Idea 06). Locked while
        // streaming (changing resolution mid-RTMP breaks YouTube) — tap then shows a hint.
        if (usbState.activeCamera != null || activeSource is VideoSource.Virtual) {
            RotationMenu(
                currentRotation = videoRotation,
                enabled = !streamState.isActive,
                onSelectRotation = { streamViewModel.setVideoRotation(it) },
                onLockedTap = { streamViewModel.rotationLockedHint() },
                modifier = Modifier.fillMaxSize(),
            )
        }

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
