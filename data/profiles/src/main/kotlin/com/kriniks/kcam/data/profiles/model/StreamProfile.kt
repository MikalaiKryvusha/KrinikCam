/**
 * StreamProfile — domain model for a streaming platform target.
 *
 * Stored in Room (StreamProfileEntity) and mapped to/from it via repository.
 * Each profile is an independently configurable destination (YouTube, Twitch, etc.).
 *
 * Related: StreamProfileEntity (Room), ProfilesRepository, StreamPlatformsManager
 */

package com.kriniks.kcam.data.profiles.model

import kotlinx.serialization.Serializable

@Serializable
data class StreamProfile(
    val id: Long = 0,
    // All fields have defaults so import/export (Idea 01) is tolerant: a config file with missing
    // fields decodes with sensible defaults instead of failing (Json coerceInputValues=true).
    val name: String = "",               // display name, e.g. "My YouTube"
    val platform: StreamPlatform = StreamPlatform.CUSTOM,
    val rtmpUrl: String = "",            // full base URL, e.g. "rtmp://a.rtmp.youtube.com/live2"
    val streamKey: String = "",          // secret stream key
    val isEnabled: Boolean = true,       // user can toggle without deleting
    val videoWidth: Int = 1920,
    val videoHeight: Int = 1080,
    val videoFps: Int = 30,
    val videoBitrateBps: Int = 4_000_000,
)

enum class StreamPlatform(
    val displayName: String,
    val defaultRtmpUrl: String,
    val maxBitrateBps: Int,
) {
    YOUTUBE(
        displayName = "YouTube",
        defaultRtmpUrl = "rtmp://a.rtmp.youtube.com/live2",
        maxBitrateBps = 9_000_000,
    ),
    TWITCH(
        displayName = "Twitch",
        defaultRtmpUrl = "rtmp://live.twitch.tv/live",
        maxBitrateBps = 6_000_000,
    ),
    INSTAGRAM(
        displayName = "Instagram",
        defaultRtmpUrl = "rtmps://live-api-s.facebook.com:443/rtmp",
        maxBitrateBps = 4_000_000,
    ),
    TIKTOK(
        displayName = "TikTok",
        defaultRtmpUrl = "rtmp://push.tiktokv.com/rtmp",
        maxBitrateBps = 4_000_000,
    ),
    CUSTOM(
        displayName = "Custom RTMP",
        defaultRtmpUrl = "",
        maxBitrateBps = 20_000_000,
    ),
}
