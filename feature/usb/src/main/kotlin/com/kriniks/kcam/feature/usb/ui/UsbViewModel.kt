/**
 * UsbViewModel — UI state for USB camera detection and lifecycle.
 *
 * Exposes uiState as a StateFlow. The :app module observes this and wires
 * the connected cameras into DeviceManager (:feature:capture) — keeping the
 * USB feature independent of other feature modules.
 *
 * Related: UsbDeviceRepository (data), UsbUiState, MainScreen (:app)
 */

package com.kriniks.kcam.feature.usb.ui

import android.hardware.usb.UsbDevice
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jiangdg.ausbc.MultiCameraClient
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.feature.usb.domain.UsbDeviceRepository
import com.kriniks.kcam.feature.usb.model.UsbEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "UsbViewModel"

data class UsbUiState(
    val connectedDevices: List<UsbDevice> = emptyList(),
    val pendingPermissionDevice: UsbDevice? = null,
    val activeCameraId: Int? = null,
    val activeCamera: MultiCameraClient.Camera? = null,
    val activeCameraWidth: Int = 0,
    val activeCameraHeight: Int = 0,
    /** Manual rotation offset in 90° steps; 0 = auto-correct only. */
    val previewRotationOffset: Int = 0,
)

@HiltViewModel
class UsbViewModel @Inject constructor(
    private val repository: UsbDeviceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(UsbUiState())
    val uiState: StateFlow<UsbUiState> = _uiState.asStateFlow()

    init {
        observeEvents()
    }

    fun startMonitoring() {
        repository.startMonitoring()
    }

    fun restartMonitoring() {
        repository.stopMonitoring()
        repository.startMonitoring()
    }

    /** Cycle rotation by +90° for the manual hot button. */
    fun rotatePreview() {
        _uiState.value = _uiState.value.copy(
            previewRotationOffset = _uiState.value.previewRotationOffset + 1,
        )
    }

    private fun observeEvents() {
        viewModelScope.launch {
            repository.events.collect { event ->
                KLog.d(TAG, "USB event: $event")
                when (event) {
                    is UsbEvent.DeviceAttached -> {
                        _uiState.value = _uiState.value.copy(
                            connectedDevices = _uiState.value.connectedDevices + event.device,
                        )
                        // Auto-request permission on attach
                        repository.requestPermission(event.device)
                    }

                    is UsbEvent.DeviceDetached -> {
                        val remaining = _uiState.value.connectedDevices
                            .filter { it.deviceId != event.deviceId }
                        val wasActive = _uiState.value.activeCameraId == event.deviceId
                        _uiState.value = _uiState.value.copy(
                            connectedDevices = remaining,
                            activeCameraId   = if (wasActive) null else _uiState.value.activeCameraId,
                            activeCamera     = if (wasActive) null else _uiState.value.activeCamera,
                        )
                    }

                    is UsbEvent.PermissionGranted -> {
                        // Camera is initialised (ctrlBlock + state callback wired) but not yet opened.
                        // UvcPreviewView will call camera.openCamera(textureView, request) when rendered.
                        _uiState.value = _uiState.value.copy(
                            pendingPermissionDevice = null,
                            activeCameraId = event.device.deviceId,
                            activeCamera   = event.camera,
                        )
                    }

                    is UsbEvent.PermissionDenied -> {
                        KLog.w(TAG, "Permission denied for ${event.device.deviceName}")
                        _uiState.value = _uiState.value.copy(pendingPermissionDevice = null)
                    }

                    is UsbEvent.PreviewStarted -> {
                        // Camera opened successfully; update actual resolution in state
                        _uiState.value = _uiState.value.copy(
                            activeCameraWidth  = event.width,
                            activeCameraHeight = event.height,
                        )
                    }

                    is UsbEvent.Error -> {
                        KLog.e(TAG, "USB error: ${event.message}", event.cause)
                    }

                    else -> {}
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        repository.stopMonitoring()
    }
}
