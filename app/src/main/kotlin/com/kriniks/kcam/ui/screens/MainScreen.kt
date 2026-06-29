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
import com.kriniks.kcam.feature.streaming.ui.StreamPlatformsOverlay
import com.kriniks.kcam.feature.streaming.rtmp.VirtualVideoSource
import com.kriniks.kcam.feature.streaming.ui.StreamViewModel
import com.kriniks.kcam.feature.usb.ui.UsbViewModel
import com.kriniks.kcam.feature.usb.ui.UvcPreviewView
import com.kriniks.kcam.streaming.UvcVideoSource
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

    var showPlatformsOverlay by remember { mutableStateOf(false) }

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
    LaunchedEffect(usbState.activeCamera, activeSource, streamState.isActive) {
        val camera = usbState.activeCamera
        val streaming = streamState.isActive
        when {
            camera != null -> {
                val w = usbState.activeCameraWidth.takeIf { it > 0 } ?: 1920
                val h = usbState.activeCameraHeight.takeIf { it > 0 } ?: 1080
                val source = UvcVideoSource(camera, previewWidth = w, previewHeight = h)
                if (streaming) {
                    // Camera (re)appeared during a live stream. exitStandby swaps the placeholder
                    // back to the live camera; if we weren't in standby it falls through to a guarded
                    // setVideoSource() no-op (the existing live-stream behaviour, unchanged).
                    streamViewModel.exitStandby(source)
                } else {
                    streamViewModel.setVideoSource(source)
                }
            }
            // Idea 09 — virtual debug camera active (no physical cam): feed the synthetic source.
            activeSource is VideoSource.Virtual -> {
                val source = VirtualVideoSource()
                if (streaming) streamViewModel.exitStandby(source) else streamViewModel.setVideoSource(source)
            }
            else -> {
                if (streaming) {
                    // Camera lost mid-stream: inject the "Please stand by" frame so RTMP stays alive
                    // instead of starving the encoder. The Compose StandbyPlaceholder also shows
                    // locally (activeSource → None handled in Layer 0 below).
                    streamViewModel.enterStandby()
                } else {
                    streamViewModel.clearVideoSource()
                }
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {

        // ── Layer 0: Viewfinder ──────────────────────────────────────
        when (activeSource) {
            is VideoSource.UvcCamera -> {
                if (usbState.activeCamera != null) {
                    // rememberUpdatedState so the lambdas below always read the latest camera
                    // state even though the TextureView listener captures them by reference.
                    val currentCamera by rememberUpdatedState(usbState.activeCamera)
                    // GL pipeline renders its output (camera frames) into this TextureView
                    UvcPreviewView(
                        onTextureViewReady = { tv ->
                            previewTextureView = tv
                            // Sole trigger for startPreview — camera must already be set via setVideoSource.
                            if (currentCamera != null) {
                                streamViewModel.startPreviewOnView(tv)
                            }
                        },
                        // Restart GL preview on rotation so the render surface gets new dimensions.
                        onSurfaceTextureSizeChanged = { tv, _, _ ->
                            if (currentCamera != null) {
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
