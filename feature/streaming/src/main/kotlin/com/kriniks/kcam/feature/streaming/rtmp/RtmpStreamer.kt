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

import android.content.Context
import android.graphics.Bitmap
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
            // i.e. BITRATE is the 3rd param and FPS the 4th — NOT (w, h, fps, bitrate) like the
            // old RtmpCamera1 API. The migration kept the old order, so we were configuring the
            // video encoder with bitrate=30 bps and fps=4_000_000 → encoder produced an empty
            // video track → YouTube received audio only (~132 kbps) → Broken Pipe after 15s.
            // iFrameInterval=2 → 2-second GOP, which YouTube expects.
            // Idea 06 portrait stream — use RootEncoder's INTENDED portrait mechanism: pass the
            // SOURCE landscape dims + the rotation as prepareVideo's 6th param. The library then
            // rotates AND sets the output to portrait (1080×1920 for 90/270) with aspect preserved.
            // (Manual size-swap squished; setStreamRotation kept 16:9 dims → stretched. The rotation
            // param is the canonical path — see plans/ideas/06_video_rotation.md.)
            // Attempt 5: prepareVideo(rotation=90) made the output canvas portrait (good) but rotated
            // the content the WRONG way (90° CCW) + stretched. RootEncoder's rotation appears opposite
            // to our convention for this custom UvcVideoSource, so invert: UI 90° → prepareVideo 270.
            val streamRotation = (360 - _videoRotation.value) % 360
            val videoPrepared = stream.prepareVideo(
                profile.videoWidth,
                profile.videoHeight,
                profile.videoBitrateBps,  // bitrate (3rd param)
                profile.videoFps,         // fps (4th param)
                2,                        // iFrameInterval (seconds) — YouTube wants ~2s keyframes
                streamRotation,           // rotation (6th param), inverted to match our convention
            )
            KLog.d(TAG, "startStream: prepareVideo → $videoPrepared (${profile.videoWidth}x${profile.videoHeight} src, uiRot=${_videoRotation.value}° prepareRot=${streamRotation}° ${profile.videoFps}fps iFrame=2s)")

            // Fix Bug A (stream rotated 90° CCW + stretched): prepareVideo(rotation=0) internally
            // calls glInterface.setCameraOrientation(270), which rotates the camera input texture
            // 270° (= 90° CCW). That's correct for phone camera sensors (mounted at 90°) but WRONG
            // for a USB webcam, which already outputs an upright landscape frame. Override back to
            // the user's chosen rotation: setCameraOrientation(deg) rotates the camera into the
            // (now portrait, for 90/270) encoder canvas → correct 9:16 stream.
            applyVideoRotation()
            KLog.d(TAG, "startStream: stream rotation applied = ${_videoRotation.value}°")

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

    /** Record status callback (logging only). */
    private val recordListener = object : RecordController.Listener {
        override fun onStatusChange(status: RecordController.Status) {
            KLog.i(TAG, "Record status: $status")
        }
        override fun onNewBitrate(bitrate: Long) {
            val current = _state.value
            if (current is StreamState.Live) _state.value = current.copy(bitrateKbps = (bitrate / 1000).toInt())
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
            // Bug 10 — variant C: the SOURCE rotates its own 16:9 frame into a portrait buffer; the
            // encoder does NO rotation (rotation=0 → SizeCalculator.getScale returns 1,1 → zero
            // distortion). We just set a PORTRAIT encoder canvas for 90/270 and tell the source which
            // way to rotate. No setStreamRotation / encoder rotation — that path distorts our
            // non-camera source. (Krinik's model: WE virtually rotate the incoming stream.)
            val deg = _videoRotation.value
            val portrait = deg == 90 || deg == 270
            val encW = if (portrait) profile.videoHeight else profile.videoWidth // 90/270 → 1080
            val encH = if (portrait) profile.videoWidth else profile.videoHeight // 90/270 → 1920
            (currentVideoSource as? RotatableSource)?.setOutputRotation(deg)
            val vp = stream.prepareVideo(
                encW, encH, profile.videoBitrateBps, profile.videoFps, 2,
            )
            stream.getGlInterface().setCameraOrientation(0) // Bug 02 A: keep source upright (no input rot)
            // Bug 10 — THE missing piece: prepareVideo(rotation=0) sets isPortrait=false, and for a
            // portrait canvas (w<h) SizeCalculator.calculateViewPortEncoder then LETTERBOXES the
            // source (viewport 1080×607 centered) → black bars + squished. Force isPortrait to match
            // the canvas so the viewport is the FULL frame (0,0,1080,1920) → our portrait source
            // passes through 1:1, no letterbox, no distortion. (Decompiled from SizeCalculator.)
            stream.getGlInterface().setIsPortrait(portrait)
            // Restart the source so it re-allocates its producer buffer at the NEW geometry (portrait
            // for 90/270). Without this the source keeps the landscape buffer from preview → the
            // rotated frame is clipped/letterboxed (Bug 10 regression). changeVideoSource = stop()+start();
            // start() reads the outputRotation we just set and sizes the buffer to match the encoder.
            currentVideoSource?.let {
                try { stream.changeVideoSource(it) } catch (e: Exception) { KLog.w(TAG, "source rebind failed", e) }
            }
            val ap = stream.prepareAudio(44100, true, 128_000)
            if (!vp || !ap) {
                KLog.e(TAG, "startRecordToFile: prepare failed (video=$vp audio=$ap)")
                isStreamSetupInProgress = false
                lastPreviewTextureView?.get()?.let { startPreview(it) }
                return null
            }
            _state.value = StreamState.Live()  // reuse Live state so the UI shows the LIVE badge
            stream.startRecord(path, recordListener)
            KLog.i(TAG, "startRecordToFile → $path (uiRot=${deg}° via source-rotation/variant C, enc ${encW}x${encH})")
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
        if (!stream.isStreaming) {
            KLog.d(TAG, "enterStandby: not streaming — ignoring")
            return
        }
        if (inStandby) {
            KLog.d(TAG, "enterStandby: already in standby — ignoring")
            return
        }
        // Render the placeholder once at the encoder size, then cache for future dropouts.
        val bmp = standbyBitmap ?: StandbyFrameRenderer.render().also { standbyBitmap = it }
        try {
            val src = StandbyVideoSource(bmp)
            // changeVideoSource: stops/releases the dead camera source and starts this one on the
            // live GL SurfaceTexture, inited with the encoder's dimensions.
            stream.changeVideoSource(src)
            // changeVideoSource re-applies the encoder rotation to the source; restore the user's
            // chosen rotation (same fix as Bug 02 A — base is upright, no implicit 270°).
            applyVideoRotation()
            currentVideoSource = src
            inStandby = true
            KLog.i(TAG, "Entered standby — placeholder frame now feeding the stream")
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

    val isStreaming: Boolean get() = rtmpStream?.isStreaming == true
    val isOnPreview: Boolean get() = rtmpStream?.isOnPreview == true
}
