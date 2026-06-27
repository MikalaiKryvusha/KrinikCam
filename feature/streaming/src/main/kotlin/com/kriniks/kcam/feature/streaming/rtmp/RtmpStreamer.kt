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
import com.pedro.common.ConnectChecker
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

    // Singleton lives for app lifetime — scope is appropriate here.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val connectChecker = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {
            KLog.i(TAG, "RTMP connecting → $url")
        }

        override fun onConnectionSuccess() {
            KLog.i(TAG, "RTMP connected")
            _state.value = StreamState.Live()
        }

        override fun onConnectionFailed(reason: String) {
            KLog.e(TAG, "RTMP connection failed: $reason")
            _state.value = StreamState.Error(reason)
            rtmpStream?.stopStream()
        }

        override fun onNewBitrate(bitrate: Long) {
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
     * changeVideoSource() handles both cases: live-swap while running, or pre-swap before start.
     */
    fun setVideoSource(source: VideoSource) {
        currentVideoSource = source
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
     * Attach the preview TextureView. Starts the GL pipeline and opens the USB camera
     * (via the active VideoSource). Must be called from the main thread.
     */
    fun startPreview(tv: TextureView) {
        val stream = ensureStream()
        try {
            KLog.d(TAG, "startPreview: tv=${tv.width}x${tv.height} isOnPreview=${stream.isOnPreview} glRunning=${stream.getGlInterface().isRunning}")
            if (stream.isOnPreview) stream.stopPreview()
            stream.startPreview(tv)
            stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust)
            KLog.d(TAG, "startPreview: done — glRunning=${stream.getGlInterface().isRunning}")
            scheduleVideoSourceRetryIfNeeded(stream)
        } catch (e: Exception) {
            KLog.e(TAG, "Failed to start preview", e)
        }
    }

    /**
     * Race condition fix: StreamBase.startPreview() calls videoSource.start(getSurfaceTexture())
     * BEFORE the GL render loop sets running=true. GlStreamInterface.onFrameAvailable() drops
     * all frames while isRunning=false. Once GL is ready, we re-trigger changeVideoSource() so
     * the camera reopens with the now-valid SurfaceTexture and frames flow through.
     */
    private fun scheduleVideoSourceRetryIfNeeded(stream: RtmpStream) {
        val src = currentVideoSource ?: return
        if (stream.getGlInterface().isRunning) return  // already up, no retry needed
        scope.launch {
            val gl = stream.getGlInterface()
            var waited = 0
            while (!gl.isRunning && waited < 3000) {
                delay(50)
                waited += 50
            }
            if (gl.isRunning) {
                KLog.d(TAG, "GL ready after ${waited}ms — re-triggering VideoSource")
                try {
                    stream.changeVideoSource(src)
                } catch (e: Exception) {
                    KLog.e(TAG, "Failed to re-trigger VideoSource after GL ready", e)
                }
            } else {
                KLog.w(TAG, "GL still not running after 3000ms — giving up")
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
     * Prepares video/audio encoders and connects to the RTMP server.
     */
    fun startStream(profile: StreamProfile): Boolean {
        val stream = rtmpStream ?: run {
            KLog.e(TAG, "startStream: no stream — call setVideoSource/startPreview first")
            return false
        }

        if (stream.isStreaming) {
            KLog.w(TAG, "Already streaming — ignoring startStream")
            return true
        }

        val rtmpUrl = "${profile.rtmpUrl}/${profile.streamKey}"
        KLog.i(TAG, "Starting RTMP stream → $rtmpUrl")

        val prepared = stream.prepareVideo(
            profile.videoWidth,
            profile.videoHeight,
            profile.videoFps,
            profile.videoBitrateBps,
        ) && stream.prepareAudio(
            44100,
            true,
            128_000,
        )

        return if (prepared) {
            _state.value = StreamState.Connecting
            stream.startStream(rtmpUrl)
            true
        } else {
            val msg = "Failed to prepare encoder — check device codec support"
            KLog.e(TAG, msg)
            _state.value = StreamState.Error(msg)
            false
        }
    }

    fun stopStream() {
        KLog.i(TAG, "Stopping RTMP stream")
        _state.value = StreamState.Stopping
        rtmpStream?.stopStream()
        _state.value = StreamState.Idle
    }

    /**
     * Inject a "Please stand by" image into the RTMP stream when USB camera disconnects.
     * Phase 2: implemented via GL filter (BaseFilterRender with a static bitmap).
     */
    fun sendStandbyFrame(bitmap: Bitmap) {
        KLog.d(TAG, "sendStandbyFrame: not yet implemented (Phase 2 P1)")
    }

    fun clearStandbyFrame() {
        // Phase 2: remove standby GL filter
    }

    val isStreaming: Boolean get() = rtmpStream?.isStreaming == true
    val isOnPreview: Boolean get() = rtmpStream?.isOnPreview == true
}
