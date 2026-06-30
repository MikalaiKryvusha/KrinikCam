/**
 * RtmpStreamer — RTMP streaming engine using RootEncoder's RtmpStream.
 *
 * Why RtmpStream (not RtmpCamera1): RtmpCamera1 internally opens Camera1/Camera2 API,
 * which crashes when a USB UVC camera is already in use. RtmpStream accepts any VideoSource,
 * so we inject UvcVideoSource (from :app) that renders USB frames directly into the
 * GL pipeline's SurfaceTexture — no Camera API involved.
 *
 * Lifecycle:
 *   setVideoSource(source)     — call when USB camera connects (or changes)
 *   startPreview(textureView)  — call when UI TextureView is ready; starts GL + camera
 *   stopPreview()              — call when UI is gone
 *   startStream(profile)       — prepares encoder + connects RTMP
 *   stopStream()               — graceful stop
 *
 * GL pipeline (RootEncoder internal):
 *   UvcVideoSource.start(surfaceTexture) → camera renders to GL input SurfaceTexture
 *   GL thread → encodes to MediaCodec → RTMP packets
 *   GL thread → renders to preview TextureView
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
import com.pedro.library.base.recording.RecordController
import java.lang.ref.WeakReference
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.rtmp.RtmpStream
import com.pedro.library.util.sources.video.NoVideoSource
import com.pedro.library.util.sources.video.VideoSource
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.Scene
import com.kriniks.kcam.feature.streaming.scene.SceneCompositor
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "RtmpStreamer"

@Singleton
class RtmpStreamer @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val _state = MutableStateFlow<StreamState>(StreamState.Idle)
    val state: StateFlow<StreamState> = _state.asStateFlow()

    private var rtmpStream: RtmpStream? = null
    private var currentVideoSource: VideoSource? = null
    // Weak ref so we don't leak the TextureView; used to restore preview after startStream
    private var lastPreviewTextureView: WeakReference<TextureView>? = null

    // Guard flag: prevents clearVideoSource() during startStream() critical window.
    // stopPreview() briefly closes the camera (which can trigger AUSBC reconnect events).
    // Without this guard, LaunchedEffect reacts and calls clearVideoSource() mid-setup.
    @Volatile private var isStreamSetupInProgress = false

    // Standby state: true while a StandbyVideoSource is feeding the encoder in place of the
    // (disconnected) USB camera. Guards against double-enter / double-exit when MainScreen's
    // LaunchedEffect re-fires. The bitmap is rendered once and cached for reuse across dropouts.
    @Volatile private var inStandby = false
    private var standbyBitmap: Bitmap? = null

    // Manual video rotation in degrees (0/90/180/270). Two effects, applied together (Bug/Idea 06):
    //   1. setCameraOrientation(deg) rotates the GL camera-input texture (preview + encoder).
    //   2. The encoder/GL canvas is RESIZED to the rotated aspect: 0/180 → landscape (e.g. 1920×1080),
    //      90/270 → portrait (1080×1920). So the OUTGOING stream is a true 9:16 portrait, not a
    //      letterboxed landscape. For vertical Reels/Shorts streams + future local file recording.
    // Default 0 — a USB webcam already outputs an upright landscape frame (see Bug 02 A).
    // Rotation can only be changed while NOT streaming (research: changing resolution on a live RTMP
    // connection breaks YouTube — see plans/ideas/06_video_rotation.md). Re-applied on every GL
    // (re)init so the chosen angle survives preview restarts, stream start, and standby swaps.
    private val _videoRotation = MutableStateFlow(0)
    val videoRotation: StateFlow<Int> = _videoRotation.asStateFlow()

    // ── Мульти-источники (Idea 19) ──────────────────────────────────────────
    // Текущая рабочая область (сцена) — упорядоченный список слоёв. Камера = базовый слой (низ),
    // слои-картинки = оверлеи поверх (мапятся на стек фильтров RootEncoder через SceneCompositor).
    // UI наблюдает этот StateFlow; правки идут через методы ниже, каждая переприменяет оверлеи.
    private val _scene = MutableStateFlow(Scene.default())
    val scene: StateFlow<Scene> = _scene.asStateFlow()

    // ── Idea 21 — камера как обычный слой над ЧЁРНОЙ базой ───────────────────
    // Базовый VideoSource энкодера = чёрный кадр (задаёт каденс GL). Камера и картинки — слои-фильтры
    // поверх (см. SceneCompositor). Камеру в её слой-фильтр открывает :app через CameraOpener (модульность
    // AUSBC). cameraLayerSurface — последняя выданная фильтром камеры SurfaceTexture.
    private val blackSource = BlackVideoSource()
    private val sceneCompositor = SceneCompositor(onCameraSurface = { st -> onCameraLayerSurfaceReady(st) })

    // ── Idea 25 — НАШ GL-композитор (мобильный OBS) как базовый источник ──────
    // Мигрируем с «камера = SurfaceFilterRender-фильтр» (не доходил до энкодера, bugs/18) на свой
    // GL-композитор: он рисует все слои в один кадр и отдаётся базовым VideoSource. useCompositor —
    // флаг-мост на время миграции (cmd compositor on). Когда композитор закроет все шаги — станет
    // единственным режимом, а blackSource/SurfaceFilterRender-камера уйдут.
    private val compositorSource = com.kriniks.kcam.feature.streaming.gl.CompositorVideoSource()
    @Volatile private var useCompositor = false
    fun setUseCompositor(enabled: Boolean) {
        useCompositor = enabled
        KLog.i(TAG, "useCompositor = $enabled")
        // Когда компоновщик готовит OES-поверхность камеры — отдаём её существующему opener'у (:app
        // откроет туда Camera2/USB/виртуалку). Та же точка onCameraLayerSurfaceReady, что и раньше.
        compositorSource.onCameraSurfaceReady = { st -> onCameraLayerSurfaceReady(st) }
        // Перезапустить превью, чтобы база переключилась вживую (ensureBlackBase подхватит флаг).
        if (rtmpStream?.isStreaming != true) {
            lastPreviewTextureView?.get()?.let { tv -> scope.launch { startPreview(tv) } }
        }
    }

    /** Открывает/закрывает камеру в SurfaceTexture слоя-камеры. Реализуется в :app (держит AUSBC-камеру). */
    interface CameraOpener {
        fun open(surfaceTexture: SurfaceTexture)
        fun close()
    }
    @Volatile private var cameraOpener: CameraOpener? = null
    private var cameraLayerSurface: SurfaceTexture? = null

    /**
     * :app сообщает текущую USB-камеру (или null при отключении). Если слой-камеры уже отдал свою
     * SurfaceTexture — сразу открываем туда камеру; при null — закрываем предыдущую.
     */
    fun setCameraOpener(opener: CameraOpener?) {
        val old = cameraOpener
        cameraOpener = opener
        scope.launch {
            if (opener != null) cameraLayerSurface?.let { opener.open(it) }
            else old?.close()
        }
    }

    // Колбэк от компоновщика: у слоя-камеры появилась/исчезла SurfaceTexture. Открываем/закрываем камеру.
    private fun onCameraLayerSurfaceReady(st: SurfaceTexture?) {
        cameraLayerSurface = st
        val opener = cameraOpener ?: return
        scope.launch { if (st != null) opener.open(st) else opener.close() }
    }

    // Гарантировать, что базой энкодера выставлен чёрный источник (Idea 21). Камера базой больше НЕ бывает.
    private fun ensureBlackBase() {
        // Idea 25: базой может быть наш GL-композитор (useCompositor) либо простой чёрный источник.
        val base: VideoSource = if (useCompositor) compositorSource else blackSource
        if (currentVideoSource !== base) {
            currentVideoSource = base
            runCatching { ensureStream().changeVideoSource(base) }
                .onFailure { KLog.e(TAG, "ensureBlackBase: changeVideoSource failed", it) }
            KLog.d(TAG, "ensureBlackBase: base set to ${base.javaClass.simpleName}")
        }
    }

    // Base (landscape-reference) encoder size used for the live preview before a stream profile is
    // applied. rotatedDims() swaps it to portrait for 90/270.
    private val basePreviewWidth = 1920
    private val basePreviewHeight = 1080

    // Singleton lives for app lifetime — scope is appropriate here.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val connectChecker = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {
            KLog.i(TAG, "RTMP connecting → $url")
        }

        override fun onConnectionSuccess() {
            KLog.i(TAG, "RTMP connected ✓")
            _state.value = StreamState.Live()
            isStreamSetupInProgress = false
            KLog.d(TAG, "onConnectionSuccess: stream setup flag cleared")
            // NOTE: changeVideoSource re-bind removed — caused double stop()/release() on same
            // UvcVideoSource object → async race: camera closed AFTER start() → no video.
            // AUSBC normally resumes writing to the original GL SurfaceTexture after its internal
            // hardware close/reopen cycle. schedulePreviewRestoreAfterStream handles re-bind
            // with a proper delay if needed.
        }

        override fun onConnectionFailed(reason: String) {
            KLog.e(TAG, "RTMP connection failed: $reason")
            isStreamSetupInProgress = false
            inStandby = false
            _state.value = StreamState.Error(reason)
            rtmpStream?.stopStream()
        }

        override fun onNewBitrate(bitrate: Long) {
            // Log bitrate every update to diagnose video-only vs audio-only streams.
            // Audio-only (no video frames) shows ~132 kbps; full video shows 2000-6000 kbps.
            KLog.d(TAG, "onNewBitrate: ${bitrate / 1000} kbps (${bitrate} bps)")
            val current = _state.value
            if (current is StreamState.Live) {
                _state.value = current.copy(bitrateKbps = (bitrate / 1000).toInt())
            }
        }

        override fun onDisconnect() {
            KLog.w(TAG, "RTMP disconnected")
            if (_state.value.isActive) {
                _state.value = StreamState.Error("Disconnected from server")
            }
        }

        override fun onAuthError() {
            KLog.e(TAG, "RTMP auth error")
            _state.value = StreamState.Error("Authentication failed — check stream key")
        }

        override fun onAuthSuccess() {
            KLog.i(TAG, "RTMP auth OK")
        }
    }

    private fun ensureStream(): RtmpStream =
        rtmpStream ?: RtmpStream(context, connectChecker).also { rtmpStream = it }

    /**
     * Swap the video source (e.g. when USB camera connects / changes).
     * Blocked entirely while streaming is active or stream setup is in progress.
     *
     * Why block during streaming:
     *   AUSBC does a hardware close/reopen cycle after openCamera() — this is normal UVC
     *   firmware behaviour (configure → close → reopen at new params). The cycle fires
     *   LaunchedEffect(activeCamera) → setVideoSource(UvcVideoSource) → changeVideoSource()
     *   which would stop+start the camera on a DIFFERENT GL surface than the encoder is using
     *   → camera writes to wrong surface → encoder gets no frames → audio-only RTMP stream
     *   → YouTube Broken Pipe after 15 seconds.
     *
     * Re-binding the camera to the encoder GL surface is done explicitly in onConnectionSuccess()
     * via a direct stream.changeVideoSource() call, bypassing this guard.
     */
    fun setVideoSource(source: VideoSource) {
        if (isStreamSetupInProgress || rtmpStream?.isStreaming == true) {
            // Block ALL source changes during setup and while actively streaming.
            KLog.d(TAG, "setVideoSource: blocked (setup=$isStreamSetupInProgress streaming=${rtmpStream?.isStreaming}) — ${source::class.simpleName}")
            return
        }
        // Break the AUSBC reconnect storm: opening the camera fires AUSBC's PreviewStarted event,
        // which bubbles up to LaunchedEffect(activeCamera) → setVideoSource() again. If the camera
        // is already open and feeding the GL preview, that redundant call would changeVideoSource()
        // → close+reopen the camera → rapid reopen fails (result=-99 "unsupported preview size")
        // → black screen. Skip it. First attach (currentVideoSource == null) and clearing
        // (NoVideoSource) still proceed normally.
        val isRealSource = source !is NoVideoSource
        if (isRealSource && currentVideoSource != null && rtmpStream?.isOnPreview == true) {
            KLog.d(TAG, "setVideoSource: skipped — camera already attached & preview running (avoid AUSBC storm)")
            return
        }
        currentVideoSource = if (source is NoVideoSource) null else source
        try {
            ensureStream().changeVideoSource(source)
            KLog.d(TAG, "VideoSource set: ${source::class.simpleName}")
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to set video source", e)
        }
    }

    /** Reset to no video source (e.g. when USB camera disconnects). */
    fun clearVideoSource() = setVideoSource(NoVideoSource())

    /**
     * Set the manual video rotation to [degrees] (normalized to 0/90/180/270).
     *
     * BLOCKED while streaming / during stream setup: changing the encoder resolution on a live
     * RTMP connection breaks YouTube (see research in plans/ideas/06_video_rotation.md). The UI
     * also disables the rotation control during a live stream; this is the safety net. To rotate:
     * stop the stream → rotate → start again.
     *
     * When idle: stores the angle, then restarts the preview so the GL/encoder canvas is rebuilt
     * at the rotated aspect (portrait for 90/270) and the camera input is rotated to fill it.
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
        _videoRotation.value = normalized
        KLog.i(TAG, "Video rotation set to $normalized°")
        // Preview display rotation is handled by the TextureView matrix (UvcPreviewView reacts to
        // the videoRotation StateFlow). Here we only sync the stream rotation on the GL interface.
        applyVideoRotation()
        return true
    }

    /**
     * Re-apply the rotation to the GL pipeline (Idea 06). The GL scene is SHARED by preview and
     * encoder, so we rotate it only while STREAMING; in preview-only mode the on-screen rotation is
     * done by the TextureView matrix in UvcPreviewView (display-only) and the GL stays upright.
     *
     *   • Streaming → setCameraOrientation(deg): rotates the camera INTO the portrait encoder canvas
     *     (set via prepareVideo's swapped dims), so the rotated 16:9 frame fills 9:16 — a true
     *     portrait stream (not stretched, not squished).
     *   • Preview-only → setCameraOrientation(0): GL upright; the TextureView matrix letterboxes the
     *     display rotation. (During a portrait stream the device preview follows the GL rotation;
     *     that's fine — rotation is locked mid-stream and the user watches the stream output.)
     *
     * Safe before GL is up (caught). Called after every GL (re)init so the angle persists.
     */
    private fun applyVideoRotation() {
        try {
            val gl = rtmpStream?.getGlInterface() ?: return
            val streaming = rtmpStream?.isStreaming == true || isStreamSetupInProgress
            when {
                // Preview-only: GL upright, TextureView matrix does the display rotation.
                !streaming -> gl.setCameraOrientation(0)
                // Streaming at 0°: Bug 02 A — prepareVideo(0) wrongly sets 270 for the USB cam, force 0.
                _videoRotation.value == 0 -> gl.setCameraOrientation(0)
                // Streaming at 90/270: the rotation is baked into prepareVideo(rotation=) — do NOT
                // touch setCameraOrientation here or we'd undo it.
                else -> { /* leave prepareVideo's rotation in place */ }
            }
        } catch (e: Exception) {
            KLog.e(TAG, "applyVideoRotation failed", e)
        }
    }

    /**
     * Bug 10 / Idea 06 — configure the encoder + source for the current rotation. Used by BOTH
     * [startStream] (real RTMP) and [startRecordToFile] (virtual stream / harness) so preview, stream
     * and record stay IDENTICAL. Returns whether prepareVideo succeeded.
     *
     * For 90/270 the encoder canvas is PORTRAIT (1080×1920) and `setIsPortrait(true)` makes
     * `SizeCalculator.calculateViewPortEncoder` use the FULL frame (no letterbox — decompiled). The
     * actual rotation depends on the source kind:
     *  • [RotatableSource] (e.g. VirtualVideoSource — drawn via Canvas) rotates its OWN frame, so the
     *    encoder does NO rotation (rotation=0 → getScale returns 1,1 → zero distortion). We restart the
     *    source so it re-allocates its producer buffer at the new (portrait) geometry.
     *  • A real camera (UvcVideoSource — writes its frame straight into the GL OES texture, can't
     *    Canvas-rotate) → let the library rotate the camera INPUT via `setCameraOrientation(deg)`
     *    (CameraRender path) into the portrait canvas.
     * NO `setStreamRotation`, NO `(360-deg)` inversion — those distorted our custom source.
     */
    private fun configureCaptureRotation(stream: RtmpStream, profile: StreamProfile): Boolean {
        val deg = _videoRotation.value
        val portrait = deg == 90 || deg == 270
        val encW = if (portrait) profile.videoHeight else profile.videoWidth // 90/270 → 1080
        val encH = if (portrait) profile.videoWidth else profile.videoHeight // 90/270 → 1920
        val src = currentVideoSource
        (src as? RotatableSource)?.setOutputRotation(deg)
        val vp = stream.prepareVideo(encW, encH, profile.videoBitrateBps, profile.videoFps, 2)
        val gl = stream.getGlInterface()
        gl.setIsPortrait(portrait)        // full-frame viewport for the portrait canvas (no letterbox)
        if (src is RotatableSource) {
            gl.setCameraOrientation(0)    // custom source already rotated its own frame
        } else {
            gl.setCameraOrientation(deg)  // real camera: library rotates the input texture into canvas
        }
        // Restart the source so it re-allocates its buffer at the new geometry (RotatableSource sizes
        // its buffer from outputRotation; camera reopens at the requested orientation).
        src?.let {
            try { stream.changeVideoSource(it) } catch (e: Exception) { KLog.w(TAG, "configureCaptureRotation: source rebind failed", e) }
        }
        KLog.i(TAG, "configureCaptureRotation: uiRot=$deg enc ${encW}x${encH} portrait=$portrait src=${src?.javaClass?.simpleName} vp=$vp")
        return vp
    }

    /**
     * Attach the preview TextureView. Starts the GL pipeline and opens the USB camera
     * (via the active VideoSource). Must be called from the main thread.
     *
     * Guarded: if streaming is already active, UI callbacks (LaunchedEffect, onTextureViewReady)
     * must NOT restart the GL/camera — the encoder is running and any restart causes distortion.
     * In that case we just update the TextureView reference so stopStream() can restore it later.
     */
    fun startPreview(tv: TextureView) {
        val stream = ensureStream()

        // Always update the ref — stopStream() uses it to restart preview after stream ends
        lastPreviewTextureView = WeakReference(tv)

        if (stream.isStreaming) {
            // During streaming, RE-ATTACH the preview surface with the CURRENT TextureView size.
            // This is what fixes Bug 03 (landscape preview stuck in the corner): on rotation the
            // TextureView resizes (onSurfaceTextureSizeChanged → startPreviewOnView), and we must
            // re-attach the preview at the new dimensions, otherwise GL keeps drawing it at the
            // old (portrait) resolution → small image anchored bottom-left.
            //
            // Safe during streaming: StreamBase.startPreview skips videoSource.start() and
            // glInterface.start() because both are already running for the encoder. The camera is
            // NOT reopened or redirected (the audio-only issue in Bug 02 was the prepareVideo
            // bitrate bug, now fixed — not the preview).
            try {
                if (stream.isOnPreview) stream.stopPreview()  // detach old-size preview surface
                stream.startPreview(tv)                        // re-attach at new tv size
                stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust)
                applyVideoRotation()                           // keep manual rotation sticky on rotate
                KLog.d(TAG, "startPreview: re-attached during streaming — tv=${tv.width}x${tv.height}")
            } catch (e: Exception) {
                KLog.e(TAG, "startPreview: failed to re-attach during streaming", e)
            }
            return
        }

        try {
            KLog.d(TAG, "startPreview: tv=${tv.width}x${tv.height} isOnPreview=${stream.isOnPreview} glRunning=${stream.getGlInterface().isRunning}")
            // Idea 21: базой энкодера всегда чёрный источник; камера придёт слоем-фильтром (compositor).
            ensureBlackBase()
            if (stream.isOnPreview) stream.stopPreview()
            // Bug 10: IDLE preview rotates via the TextureView matrix (UvcPreviewView), with a LANDSCAPE
            // source + canvas. Reset the source's own rotation (it was set portrait during streaming/
            // recording) so we DON'T double-rotate — source 90° + matrix 90° = 180° (the "extra 90°
            // after stopping the stream" bug Krinik saw). One rotation in idle = the matrix only.
            (currentVideoSource as? RotatableSource)?.setOutputRotation(0)
            stream.getGlInterface().setIsPortrait(false)
            // GL init lambda (start$lambda$5) calls mainRender.initGl(encoderWidth, encoderHeight).
            // encoderWidth/Height are 0 until prepareVideo() is called, which makes initGl crash.
            // The crash is swallowed silently by secureSubmit → running.set(true) never fires.
            // Fix: set non-zero encoder size directly so GL can init before Go Live is pressed.
            //
            // PREVIEW keeps the LANDSCAPE canvas (1920×1080) regardless of rotation (Idea 06):
            // setCameraOrientation rotates the camera input, and AspectRatioMode.Adjust letterboxes
            // the rotated frame as a centered vertical strip (same working path as Bug 03) — no
            // distortion. The PORTRAIT 9:16 aspect is applied only to the OUTGOING stream, in
            // prepareVideo() at startStream (where the encoder canvas swaps to 1080×1920).
            val glSize = stream.getGlInterface().encoderSize
            if (glSize.x == 0 || glSize.y == 0) {
                KLog.d(TAG, "startPreview: encoderSize=0 — setting ${basePreviewWidth}x${basePreviewHeight} default so GL can init")
                stream.getGlInterface().setEncoderSize(basePreviewWidth, basePreviewHeight)
            }
            stream.startPreview(tv)
            stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust)
            // autoHandleOrientation=false: USB webcam is physically fixed — sensor rotation
            // should NOT rotate the video feed. AspectRatioMode.Adjust handles letterboxing.
            applyVideoRotation()  // apply any manual rotation chosen via the rotation menu
            applySceneOverlays()  // Idea 19: re-apply scene overlay layers onto the GL filter stack
            KLog.d(TAG, "startPreview: done — glRunning=${stream.getGlInterface().isRunning}")
            scheduleVideoSourceRetryIfNeeded(stream)
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start preview", e)
        }
    }

    /**
     * Race condition fix: StreamBase.startPreview() calls videoSource.start(getSurfaceTexture())
     * synchronously before the GL render loop sets running=true. Frames are dropped while
     * isRunning=false. Once GL is ready, re-trigger changeVideoSource() so the camera reopens
     * with the now-valid SurfaceTexture.
     *
     * Read currentVideoSource INSIDE the coroutine (not captured at schedule time) so a
     * camera reconnect between schedule and retry picks up the fresh source.
     */
    private fun scheduleVideoSourceRetryIfNeeded(stream: RtmpStream) {
        if (stream.getGlInterface().isRunning) return  // already up, no retry needed
        currentVideoSource ?: return  // no source attached at all — nothing to retry
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 3000) {
                delay(50)
                waited += 50
            }
            val src = currentVideoSource ?: return@launch  // read at retry time, not schedule time
            if (gl.isRunning) {
                KLog.d(TAG, "GL ready after ${waited}ms — re-triggering VideoSource")
                try {
                    stream.changeVideoSource(src)
                    applyVideoRotation()  // re-apply manual rotation once GL is up
                    applySceneOverlays()  // Idea 19: re-apply scene overlays once GL is up
                } catch (e: Exception) {
                    KLog.e(TAG, "Failed to re-trigger VideoSource after GL ready", e)
                }
            } else {
                KLog.w(TAG, "GL still not running after 3000ms — giving up")
            }
        }
    }

    /**
     * After startStream() launches the GL pipeline, log GL readiness.
     *
     * CRITICAL FINDING: calling stream.startPreview(tv) during active streaming redirects the
     * camera from the ENCODER surface to a PREVIEW surface. The encoder then gets no frames →
     * RTMP sends only audio (~132 kbps instead of 4Mbps) → YouTube drops the connection after
     * 15 seconds ("Error send packet, Broken pipe").
     *
     * Therefore: we intentionally do NOT call startPreview() here. The camera continues feeding
     * the encoder surface set up by startStream(). Preview (TextureView display) is restored
     * when stopStream() is called.
     *
     * TODO: find the correct RootEncoder API to add a preview surface WITHOUT redirecting the
     * camera. Candidates: GlStreamInterface.addPreview(), or a separate render path.
     */
    private fun schedulePreviewRestoreAfterStream(stream: RtmpStream) {
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 5000) {
                delay(50)
                waited += 50
            }
            KLog.d(TAG, "schedulePreviewRestoreAfterStream: GL ${if (gl.isRunning) "ready" else "NOT ready"} after ${waited}ms")
            // Attach a LIVE preview surface during streaming so the user sees the feed (and so
            // rotation works — Bug 03). Safe now: StreamBase.startPreview skips videoSource.start()
            // and glInterface.start() because both already run for the encoder, so the camera is
            // not reopened or redirected. (The audio-only regression once blamed on this was
            // actually the prepareVideo bitrate-arg bug, fixed in Bug 02.)
            val tv = lastPreviewTextureView?.get()
            if (tv != null && gl.isRunning && !stream.isOnPreview) {
                try {
                    stream.startPreview(tv)
                    gl.setAspectRatioMode(AspectRatioMode.Adjust)
                    applyVideoRotation()  // keep manual rotation after stream-start preview re-attach
                    applySceneOverlays()  // Idea 19: keep scene overlays after preview re-attach
                    KLog.d(TAG, "schedulePreviewRestoreAfterStream: live preview attached during streaming (tv=${tv.width}x${tv.height})")
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
     *  1. Set isStreamSetupInProgress=true to guard against USB reconnect storm
     *  2. Stop preview (so prepareVideo doesn't throw IllegalStateException)
     *  3. prepareVideo + prepareAudio — configure MediaCodec encoders
     *  4. stream.startStream(url) — start RTMP + GL pipeline
     *  5. schedulePreviewRestoreAfterStream — re-attach TextureView once GL is ready,
     *     then clear isStreamSetupInProgress
     */
    fun startStream(profile: StreamProfile): Boolean {
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startStream: no rtmpStream — call setVideoSource/startPreview first")
            return false
        }

        if (stream.isStreaming) {
            KLog.w(TAG, "startStream: already streaming — ignoring")
            return true
        }

        val rtmpUrl = "${profile.rtmpUrl}/${profile.streamKey}"
        KLog.i(TAG, "startStream: profile='${profile.name}' ${profile.videoWidth}x${profile.videoHeight}" +
                " ${profile.videoFps}fps ${profile.videoBitrateBps}bps → $rtmpUrl")
        KLog.d(TAG, "startStream: isOnPreview=${stream.isOnPreview}" +
                " glRunning=${stream.getGlInterface().isRunning}" +
                " videoSource=${currentVideoSource?.javaClass?.simpleName}")

        // Block spurious clearVideoSource() calls that come from AUSBC reacting to stopPreview()
        isStreamSetupInProgress = true

        try {
            // prepareVideo() throws IllegalStateException if isOnPreview=true — stop first
            if (stream.isOnPreview) {
                KLog.d(TAG, "startStream: stopPreview() before prepareVideo")
                stream.stopPreview()
            }

            // CRITICAL: RootEncoder StreamBase.prepareVideo signature is
            //   prepareVideo(width, height, bitrate, fps = 30, iFrameInterval = 2, ...)
            // i.e. BITRATE is the 3rd param and FPS the 4th. (Old RtmpCamera1 order was w,h,fps,bitrate
            // → encoder got bitrate=30bps → audio-only → Broken Pipe. Fixed.) iFrameInterval=2 = 2s GOP.
            //
            // Bug 10 / Idea 06 — portrait/landscape rotation via the SHARED helper (identical to the
            // virtual-stream/record path that's verified by the harness): portrait canvas for 90/270 +
            // setIsPortrait + source-side rotation (custom) OR setCameraOrientation (real camera). NO
            // (360-deg) inversion, NO setStreamRotation, NO applyVideoRotation juggling — those distorted.
            val videoPrepared = configureCaptureRotation(stream, profile)
            KLog.d(TAG, "startStream: prepareVideo+rotation → $videoPrepared (uiRot=${_videoRotation.value}° ${profile.videoFps}fps iFrame=2s)")

            val audioPrepared = stream.prepareAudio(44100, true, 128_000)
            KLog.d(TAG, "startStream: prepareAudio → $audioPrepared (44100Hz stereo 128kbps)")

            if (!videoPrepared || !audioPrepared) {
                val msg = "Failed to prepare encoder (video=$videoPrepared audio=$audioPrepared)"
                KLog.e(TAG, msg)
                _state.value = StreamState.Error(msg)
                isStreamSetupInProgress = false
                lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
                return false
            }

            _state.value = StreamState.Connecting
            KLog.i(TAG, "startStream: calling stream.startStream() ...")
            stream.startStream(rtmpUrl)
            KLog.d(TAG, "startStream: stream.startStream() returned — waiting for GL + ConnectChecker callbacks")

            // Wait for GL to start, re-attach preview TextureView, then clear the guard flag
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
        // Clear standby: stopStream() releases whatever source is active (camera or standby);
        // the next stream must start from a clean (non-standby) state.
        inStandby = false
        _state.value = StreamState.Stopping
        rtmpStream?.stopStream()
        _state.value = StreamState.Idle
        // Restore preview after stream stops — camera is still physically connected
        lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
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
            val current = _state.value
            if (current is StreamState.Live) _state.value = current.copy(bitrateKbps = (bitrate / 1000).toInt())
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
     */
    fun startRecordToFile(profile: StreamProfile): String? {
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startRecordToFile: no rtmpStream — start preview/source first")
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
            // Bug 10 / Idea 06 — same rotation config as the real stream (shared helper).
            val vp = configureCaptureRotation(stream, profile)
            val ap = stream.prepareAudio(44100, true, 128_000)
            if (!vp || !ap) {
                KLog.e(TAG, "startRecordToFile: prepare failed (video=$vp audio=$ap)")
                isStreamSetupInProgress = false
                lastPreviewTextureView?.get()?.let { startPreview(it) }
                return null
            }
            _state.value = StreamState.Live()  // reuse Live state so the UI shows the LIVE badge
            lastRecordPath = path              // Idea 11: published to DCIM on STOPPED
            stream.startRecord(path, recordListener)
            KLog.i(TAG, "startRecordToFile → $path (uiRot=${_videoRotation.value}°)")
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
        lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
    }

    /**
     * Inject the "Please stand by" placeholder into the LIVE stream when the USB camera
     * disconnects. Swaps the (now-dead) camera VideoSource for a StandbyVideoSource that keeps
     * drawing a static frame into the encoder's GL surface — so the RTMP session stays alive
     * instead of YouTube dropping it after ~15s of frame starvation.
     *
     * No-op unless we're actively streaming and not already in standby. While not streaming,
     * a camera dropout is handled in the UI by the Compose StandbyPlaceholder, so no swap needed.
     */
    fun enterStandby() {
        val stream = rtmpStream ?: return
        if (!stream.isStreaming && !stream.isRecording) {
            KLog.d(TAG, "enterStandby: not streaming/recording — ignoring")
            return
        }
        // Idea 17 (решение Криника): при ЗАПИСИ В ФАЙЛ источник на лету подменять НЕЛЬЗЯ —
        // changeVideoSource во время активного MediaMuxer бьёт таймлайн/индекс MP4 (битый файл).
        // Заглушка/заморозка нужна ТОЛЬКО для СТРИМА (там нет muxer'а — подмена безопасна и держит RTMP
        // живым). Для записи на отрыв камеры — чисто финализируем уже записанный файл (валидное видео до
        // момента разрыва сохраняется), без подмены и без «Please stand by». Запись и стрим
        // взаимоисключающи (см. startRecordToFile), так что эта ветка покрывает кейс записи целиком.
        if (stream.isRecording) {
            KLog.i(TAG, "enterStandby: recording — финализирую файл чисто (без подмены источника, защита MediaMuxer)")
            stopRecordToFile()
            return
        }
        if (inStandby) {
            KLog.d(TAG, "enterStandby: already in standby — ignoring")
            return
        }
        // Render the placeholder once at the encoder size, then cache for future dropouts.
        val bmp = standbyBitmap ?: StandbyFrameRenderer.render().also { standbyBitmap = it }
        // Interview #004: grab the LAST visible frame so we can FREEZE on it for 5s instead of jumping
        // straight to the standby card — a brief dropout then looks like a frozen picture, and if the
        // source returns within 5s (exitStandby) the viewer never sees the standby card at all.
        // Prefer the source's own last frame (reliable; the preview TextureView is often already torn
        // down by the UI on a drop → getBitmap() null). Fall back to the preview, then to no-freeze.
        val frozen = (currentVideoSource as? LastFrameProvider)?.lastFrame()
            ?: runCatching { lastPreviewTextureView?.get()?.bitmap }.getOrNull()
        try {
            // With a captured frame → freeze→timeout→fade source; without one → instant standby card.
            val src = if (frozen != null) FreezeStandbyVideoSource(frozen, bmp) else StandbyVideoSource(bmp)
            // changeVideoSource: stops/releases the dead camera source and starts this one on the
            // live GL SurfaceTexture, inited with the encoder's dimensions.
            stream.changeVideoSource(src)
            // changeVideoSource re-applies the encoder rotation to the source; restore the user's
            // chosen rotation (same fix as Bug 02 A — base is upright, no implicit 270°).
            applyVideoRotation()
            currentVideoSource = src
            inStandby = true
            KLog.i(TAG, "Entered standby — ${if (frozen != null) "freezing last frame 5s then" else ""} placeholder feeding the stream")
        } catch (e: Exception) {
            KLog.e(TAG, "enterStandby: failed to swap to standby source", e)
        }
    }

    /**
     * Leave standby and restore the live camera [source] — called when the USB camera reconnects
     * during streaming. If we're not in standby this delegates to the normal setVideoSource path
     * (a guarded no-op during streaming), so it's safe to call unconditionally on reconnect.
     */
    fun exitStandby(source: VideoSource) {
        val stream = rtmpStream
        if (stream == null || !inStandby) {
            setVideoSource(source)
            return
        }
        try {
            stream.changeVideoSource(source)
            applyVideoRotation()
            currentVideoSource = source
            inStandby = false
            KLog.i(TAG, "Exited standby — live camera restored into the stream")
        } catch (e: Exception) {
            KLog.e(TAG, "exitStandby: failed to restore camera source", e)
        }
    }

    // ── Мульти-источники: операции над сценой (Idea 19) ─────────────────────

    /**
     * Переприменить оверлеи текущей сцены на стек фильтров GL. Зовётся на тех же хуках, что и
     * [applyVideoRotation] (превью поднялось / GL готов / превью переподцеплено при стриме), а также
     * после каждой правки сцены. No-op до запуска GL — переприменится на следующем хуке.
     */
    private fun applySceneOverlays() {
        // Idea 25: при нашем GL-композиторе слои рисует ОН сам (в базовый кадр) — фильтры RootEncoder не
        // используем, чистим их. Иначе — прежний путь (камера/картинки как фильтры поверх чёрной базы).
        if (useCompositor) {
            sceneCompositor.reset(rtmpStream?.getGlInterface()) // фильтры RootEncoder не используем
            // Слои рисует наш GL-композитор: отдаём ему видимые картинки сцены (снизу вверх).
            // Камера и картинки равноправны: отдаём композитору слои В ПОРЯДКЕ СЦЕНЫ (снизу вверх),
            // только видимые. Камера переставляема как обычный слой (истинный OBS).
            val layers = _scene.value.layers.filter { it.visible }.mapNotNull { layer ->
                val t = layer.transform // PiP-трансформа слоя (позиция/масштаб/альфа) → композитору
                when (layer) {
                    is com.kriniks.kcam.feature.streaming.scene.Layer.Camera ->
                        com.kriniks.kcam.feature.streaming.gl.CompositorLayer.Camera(
                            scale = t.scale, cx = t.cx, cy = t.cy, alpha = t.alpha,
                        )
                    is com.kriniks.kcam.feature.streaming.scene.Layer.Image ->
                        com.kriniks.kcam.feature.streaming.gl.CompositorLayer.Image(
                            bitmap = layer.bitmap, scale = t.scale, cx = t.cx, cy = t.cy, alpha = t.alpha,
                        )
                }
            }
            compositorSource.setLayers(layers)
            return
        }
        sceneCompositor.apply(rtmpStream?.getGlInterface(), _scene.value)
    }

    // Общий помощник: применить трансформацию к сцене, опубликовать и переприменить оверлеи.
    private fun mutateScene(transform: (Scene) -> Scene) {
        _scene.value = transform(_scene.value)
        applySceneOverlays()
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
     * Idea 25 шаг 4 — задать PiP-трансформу слоя (масштаб/позиция/альфа). Работает в нашем GL-композиторе
     * (useCompositor): композитор рисует слой квадом в подпрямоугольнике кадра. [scale] доля кадра,
     * [cx],[cy] центр в [0,1] (0,0=верх-лево), [alpha] прозрачность.
     */
    fun setLayerTransform(id: String, scale: Float, cx: Float, cy: Float, alpha: Float = 1f) {
        mutateScene {
            it.setTransform(
                id,
                com.kriniks.kcam.feature.streaming.scene.LayerTransform(scale = scale, cx = cx, cy = cy, alpha = alpha),
            )
        }
        KLog.i(TAG, "Scene: set transform of layer id=$id → scale=$scale cx=$cx cy=$cy alpha=$alpha")
    }

    val isStreaming: Boolean get() = rtmpStream?.isStreaming == true
    val isOnPreview: Boolean get() = rtmpStream?.isOnPreview == true
}
