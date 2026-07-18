/**
 * CodecScanner — discovers available hardware and software video encoders
 * via MediaCodecList. Run once on first launch; result cached in DeviceProfile.
 *
 * Scans for: H.264 (video/avc), HEVC (video/hevc), AV1 (video/av01).
 * Reports max resolution, FPS, bitrate per codec.
 *
 * Related: CodecInfo (model), DeviceProfile (:data:profiles), CodecModule (Hilt)
 */

package com.kriniks.kcam.feature.codec

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import com.kriniks.kcam.core.logging.KLog
import com.kriniks.kcam.data.profiles.model.DeviceProfile
import com.kriniks.kcam.feature.codec.model.CodecInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "CodecScanner"

@Singleton
class CodecScanner @Inject constructor() {

    // Mimes we care about in priority order
    private val targetMimes = listOf("video/avc", "video/hevc", "video/av01")

    // Кэш результата скана: перечень кодеков устройства НЕИЗМЕНЕН за сессию, а запросы к MediaCodecList
    // (getCapabilitiesForType/isBitrateModeSupported) на некоторых MediaTek нативно капризны — гоняем
    // скан ОДИН раз, дальше отдаём кэш. Меньше обращений к кодек-сервису = меньше шанс нативного затыка.
    @Volatile private var cached: List<CodecInfo>? = null

    /**
     * Scans all available encoders and returns a list of supported video codecs.
     * Must be called from a non-main thread (IO). Результат кэшируется (скан выполняется один раз).
     */
    suspend fun scan(): List<CodecInfo> {
        cached?.let { return it }
        return doScan().also { cached = it }
    }

    private suspend fun doScan(): List<CodecInfo> = withContext(Dispatchers.Default) {
        val list = MediaCodecList(MediaCodecList.ALL_CODECS)
        val results = mutableListOf<CodecInfo>()

        for (codecInfo in list.codecInfos) {
            if (!codecInfo.isEncoder) continue

            for (mime in codecInfo.supportedTypes) {
                if (mime !in targetMimes) continue

                val caps = try {
                    codecInfo.getCapabilitiesForType(mime)
                } catch (e: IllegalArgumentException) {
                    KLog.w(TAG, "Failed to get caps for ${codecInfo.name} / $mime", e)
                    continue
                }

                val videoCaps = caps.videoCapabilities ?: continue
                val isHw = codecInfo.isHardwareAccelerated

                // Clamp to sane streaming maximums
                val maxW = minOf(videoCaps.supportedWidths.upper, 3840)
                val maxH = minOf(videoCaps.supportedHeights.upper, 2160)
                // getSupportedFrameRatesFor(w,h) КИДАЕТ IllegalArgumentException «unsupported size», если
                // конкретная пара (maxW,maxH) не входит в допустимую область кодека (напр. у некоторых
                // secure/SW-энкодеров максимумы ширины и высоты не сочетаются). Раньше это роняло весь
                // скан (и приложение). Теперь — безопасный дефолт 30, кодек не теряем.
                val maxFps = try {
                    minOf(videoCaps.getSupportedFrameRatesFor(maxW, maxH).upper.toInt(), 60)
                } catch (e: IllegalArgumentException) {
                    KLog.w(TAG, "getSupportedFrameRatesFor(${maxW}x${maxH}) не поддержан у ${codecInfo.name} — fps→30")
                    30
                }
                val maxBitrate = minOf(videoCaps.bitrateRange.upper, 50_000_000)

                val info = CodecInfo(
                    name = codecInfo.name,
                    mimeType = mime,
                    isHardwareAccelerated = isHw,
                    maxWidth = maxW,
                    maxHeight = maxH,
                    maxFps = maxFps,
                    maxBitrateBps = maxBitrate,
                )
                results.add(info)
                KLog.d(TAG, "Found: ${info.label} — ${codecInfo.name}")
            }
        }

        // Prefer HW over SW; within same HW status prefer by mime priority
        results.sortWith(compareByDescending<CodecInfo> { it.isHardwareAccelerated }
            .thenBy { targetMimes.indexOf(it.mimeType) })

        KLog.i(TAG, "Scan complete — ${results.size} video encoders found")
        results
    }

    /**
     * Runs a full scan and maps the result into a DeviceProfile.
     * Called by :feature:codec Hilt module on first launch.
     */
    suspend fun buildDeviceProfile(): DeviceProfile {
        val codecs = scan()
        val h264 = codecs.firstOrNull { it.isH264 && it.isHardwareAccelerated }
            ?: codecs.firstOrNull { it.isH264 }
        val hevc = codecs.firstOrNull { it.isHevc && it.isHardwareAccelerated }
        val av1  = codecs.firstOrNull { it.isAv1  && it.isHardwareAccelerated }

        return DeviceProfile(
            deviceModel       = android.os.Build.MODEL,
            deviceSoc         = android.os.Build.HARDWARE,
            hasHwH264         = h264?.isHardwareAccelerated == true,
            hasHwHevc         = hevc != null,
            hasHwAv1          = av1 != null,
            maxH264WidthPx    = h264?.maxWidth ?: 1920,
            maxH264HeightPx   = h264?.maxHeight ?: 1080,
            maxH264FPS        = h264?.maxFps ?: 30,
            maxH264BitrateBps = h264?.maxBitrateBps ?: 4_000_000,
            preferredCodecMime = when {
                av1  != null -> "video/av01"
                hevc != null -> "video/hevc"
                else         -> "video/avc"
            },
        )
    }
}
