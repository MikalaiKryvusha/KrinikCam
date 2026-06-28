/**
 * StreamViewModel — UI state for the streaming feature.
 *
 * Exposes:
 *   streamState   — current StreamState (Idle / Connecting / Live / Error)
 *   profiles      — list of all configured streaming platforms
 *   activeProfile — the profile selected for the next / current stream
 *
 * Actions (called from :app — MainScreen):
 *   setVideoSource(source)      — set the USB camera VideoSource (UvcVideoSource)
 *   startPreviewOnView(tv)      — start GL preview on a TextureView
 *   startStream() / stopStream()
 *
 * Related: StreamingRepository, RtmpStreamer, UvcVideoSource (:app), StreamPlatformsOverlay (UI)
 */

package com.kriniks.kcam.feature.streaming.ui

import android.view.TextureView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pedro.library.util.sources.video.VideoSource
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.feature.streaming.domain.StreamingRepository
import com.kriniks.kcam.feature.streaming.model.StreamState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "StreamViewModel"

@HiltViewModel
class StreamViewModel @Inject constructor(
    private val repository: StreamingRepository,
) : ViewModel() {

    val streamState: StateFlow<StreamState> = repository.streamState

    val profiles: StateFlow<List<StreamProfile>> = repository.allProfiles
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _activeProfile = MutableStateFlow<StreamProfile?>(null)
    val activeProfile: StateFlow<StreamProfile?> = _activeProfile.asStateFlow()

    private val _snackbar = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val snackbar: SharedFlow<String> = _snackbar.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.enabledProfiles.collect { list ->
                if (_activeProfile.value == null) {
                    _activeProfile.value = list.firstOrNull()
                }
            }
        }
    }

    /**
     * Set the video source for the GL encoder pipeline.
     * Must be called before startPreviewOnView() when the USB camera connects,
     * or after it (changeVideoSource handles live-swap).
     */
    fun setVideoSource(source: VideoSource) {
        repository.setVideoSource(source)
        KLog.d(TAG, "VideoSource set: ${source::class.simpleName}")
    }

    /**
     * Start GL preview output on [textureView]. Also starts the VideoSource
     * (i.e. opens the USB camera if UvcVideoSource is active).
     */
    fun startPreviewOnView(textureView: TextureView) {
        repository.startPreview(textureView)
        KLog.d(TAG, "Preview started on TextureView")
    }

    fun clearVideoSource() {
        repository.clearVideoSource()
        KLog.d(TAG, "VideoSource cleared")
    }

    /**
     * USB camera disconnected while streaming → inject the "Please stand by" placeholder into
     * the live stream so the RTMP session survives the dropout (no Broken Pipe).
     */
    fun enterStandby() {
        repository.enterStandby()
        KLog.i(TAG, "Entering standby (camera lost during stream)")
    }

    /**
     * USB camera reconnected while streaming → swap the standby frame back to the live camera.
     */
    fun exitStandby(source: VideoSource) {
        repository.exitStandby(source)
        KLog.i(TAG, "Exiting standby (camera restored): ${source::class.simpleName}")
    }

    fun stopPreview() = repository.stopPreview()

    fun startStream() {
        val profile = _activeProfile.value
        if (profile == null) {
            viewModelScope.launch { _snackbar.emit("No streaming platform configured") }
            return
        }
        KLog.i(TAG, "Starting stream on profile '${profile.name}'")
        val ok = repository.startStream(profile)
        if (!ok) {
            viewModelScope.launch { _snackbar.emit("Failed to start encoder — check device support") }
        }
    }

    fun stopStream() {
        KLog.i(TAG, "Stopping stream")
        repository.stopStream()
    }

    fun selectProfile(profile: StreamProfile) {
        _activeProfile.value = profile
    }

    fun saveProfile(profile: StreamProfile) {
        viewModelScope.launch {
            repository.saveProfile(profile)
            KLog.i(TAG, "Saved profile '${profile.name}'")
        }
    }

    fun deleteProfile(profile: StreamProfile) {
        viewModelScope.launch {
            if (profile == _activeProfile.value) _activeProfile.value = null
            repository.deleteProfile(profile)
        }
    }
}
