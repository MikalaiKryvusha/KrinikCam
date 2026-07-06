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
import com.pedro.library.base.recording.RecordController
import java.lang.ref.WeakReference
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.rtmp.RtmpStream
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.feature.streaming.gl.CompositorLayer
import com.kriniks.kcam.feature.streaming.gl.CompositorVideoSource
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isActive
import com.kriniks.kcam.feature.streaming.scene.Layer
import com.kriniks.kcam.feature.streaming.scene.LayerTransform
import com.kriniks.kcam.feature.streaming.scene.Scene
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
        // Когда композитор готовит OES-поверхность слоя-камеры — открываем туда текущий продюсер
        // (Camera2/USB/виртуалка через CameraOpener из :app); null = поверхность ушла, закрыть камеру.
        compositorSource.onCameraSurfaceReady = { st -> onCameraLayerSurfaceReady(st) }
    }

    /** Открывает/закрывает камеру в SurfaceTexture слоя-камеры. Реализуется в :app (держит AUSBC/Camera2). */
    interface CameraOpener {
        fun open(surfaceTexture: SurfaceTexture)
        fun close()
    }
    @Volatile private var cameraOpener: CameraOpener? = null
    private var cameraLayerSurface: SurfaceTexture? = null

    /**
     * :app сообщает текущий источник камеры (или null при отключении). Если слой-камеры уже отдал
     * свою SurfaceTexture — сразу открываем туда камеру; при null — закрываем предыдущую.
     * Отрыв камеры НИЧЕГО не подменяет в пайплайне: композитор продолжает рисовать сцену.
     */
    fun setCameraOpener(opener: CameraOpener?) {
        val old = cameraOpener
        cameraOpener = opener
        scope.launch {
            if (opener != null) cameraLayerSurface?.let { opener.open(it) }
            else old?.close()
        }
    }

    // Колбэк от композитора: у слоя-камеры появилась/исчезла SurfaceTexture. Открываем/закрываем камеру.
    private fun onCameraLayerSurfaceReady(st: SurfaceTexture?) {
        cameraLayerSurface = st
        val opener = cameraOpener ?: return
        scope.launch { if (st != null) opener.open(st) else opener.close() }
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

    private val connectChecker = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {
            KLog.i(TAG, "RTMP connecting → $url")
        }

        override fun onConnectionSuccess() {
            KLog.i(TAG, "RTMP connected ✓")
            _state.value = StreamState.Live()
            isStreamSetupInProgress = false
            KLog.d(TAG, "onConnectionSuccess: stream setup flag cleared")
        }

        override fun onConnectionFailed(reason: String) {
            KLog.e(TAG, "RTMP connection failed: $reason")
            isStreamSetupInProgress = false
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
        compositorSource.setCanvasRotation(normalized)
        KLog.i(TAG, "Canvas rotation set to $normalized°")
        if (wasPortrait == nowPortrait) {
            // 0↔180 или 90↔270: размер холста ТОТ ЖЕ — только матрица поворота композитора, БЕЗ
            // рестарта и БЕЗ переоткрытия камеры (нет чёрного мигания; §7 частично закрыт для этих
            // переходов). Композитор нарисует следующий кадр уже повёрнутым; превью его зеркалит.
            KLog.d(TAG, "rotation $normalized°: размер холста без изменений — matrix-only, камера не трогается")
        } else if (rtmpStream?.isOnPreview == true) {
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
            gl.setEncoderSize(encW, encH)        // портретный/ландшафтный холст под аспект
            gl.setIsPortrait(portrait)
            gl.setAspectRatioMode(AspectRatioMode.Adjust)
            gl.setCameraOrientation(0)           // повороты делает композитор (Bug 02 A)
            compositorSource.setCanvasRotation(deg)
            // Перезапустить композитор под новый размер холста — БЕЗ трогания поверхности превью.
            runCatching { stream.changeVideoSource(compositorSource) }
                .onFailure { KLog.w(TAG, "resizeCanvasInPreview: source rebind failed", it) }
            applySceneLayers()
            KLog.i(TAG, "resizeCanvasInPreview: enc ${encW}x${encH} portrait=$portrait (без пересборки превью)")
        } catch (e: Exception) {
            KLog.e(TAG, "resizeCanvasInPreview failed", e)
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
    private fun configureCaptureRotation(stream: RtmpStream, profile: StreamProfile): Boolean {
        val deg = _videoRotation.value
        val portrait = deg == 90 || deg == 270
        val (encW, encH) = rotatedDims(profile.videoWidth, profile.videoHeight, deg)
        val vp = stream.prepareVideo(encW, encH, profile.videoBitrateBps, profile.videoFps, 2)
        val gl = stream.getGlInterface()
        gl.setIsPortrait(portrait)     // full-frame viewport for the portrait canvas (no letterbox)
        gl.setCameraOrientation(0)     // library does NO rotation — the compositor owns it (Bug 02 A)
        compositorSource.setCanvasRotation(deg)
        // Restart the source so it re-allocates its producer buffer at the new encoder geometry.
        runCatching { stream.changeVideoSource(compositorSource) }
            .onFailure { KLog.w(TAG, "configureCaptureRotation: source rebind failed", it) }
        KLog.i(TAG, "configureCaptureRotation: canvas=$deg° enc ${encW}x${encH} portrait=$portrait vp=$vp")
        return vp
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
    private fun scheduleVideoSourceRetryIfNeeded(stream: RtmpStream) {
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
    private fun schedulePreviewRestoreAfterStream(stream: RtmpStream) {
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 5000) {
                delay(50)
                waited += 50
            }
            KLog.d(TAG, "schedulePreviewRestoreAfterStream: GL ${if (gl.isRunning) "ready" else "NOT ready"} after ${waited}ms")
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
    fun startStream(profile: StreamProfile): Boolean {
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startStream: no rtmpStream — call startPreview first")
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
            val videoPrepared = configureCaptureRotation(stream, profile)
            KLog.d(TAG, "startStream: prepareVideo+rotation → $videoPrepared (canvas=${_videoRotation.value}° ${profile.videoFps}fps iFrame=2s)")

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
        rtmpStream?.stopStream()
        _state.value = StreamState.Idle
        // Restore preview after stream stops — the compositor keeps rendering the scene
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
    fun startRecordToFile(profile: StreamProfile): String? {
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
            // Same rotation config as the real stream (shared helper) — record == stream.
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
        lastPreviewTextureView?.get()?.let { tv -> startPreview(tv) }
    }

    // ── Операции над сценой (Idea 19/25) ─────────────────────────────────────

    /**
     * Отдать композитору текущие слои сцены (снизу вверх, только видимые). Камера и картинки
     * равноправны и идут В ПОРЯДКЕ СЦЕНЫ (камера переставляема — истинный OBS). Каждому слою —
     * его PiP-трансформа (позиция/масштаб/альфа) и поворот содержимого (interview_006 Q3).
     * Зовётся после каждой правки сцены и на хуках (превью поднялось / GL готов / переподцеплено).
     */
    private fun applySceneLayers() {
        val layers = _scene.value.layers.filter { it.visible }.map { layer ->
            val t = layer.transform
            when (layer) {
                is Layer.Camera -> CompositorLayer.Camera(
                    scale = t.scale, cx = t.cx, cy = t.cy, alpha = t.alpha, rotation = t.rotation,
                )
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
