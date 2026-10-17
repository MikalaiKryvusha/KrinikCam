package com.kriniks.kcam.core.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * KrinikCam brand colour palette.
 *
 * Brand identity: "acid / hot pink" as primary colour — bold, energetic, streamer aesthetic.
 * Dark theme is the default — suits streaming environments (dim rooms, stage lighting).
 *
 * Used by: Theme.kt to build Material3 ColorScheme.
 */

// --- Brand ---
val AcidPink = Color(0xFFFF1A8C)        // Primary brand colour — "кислый розовый"
val AcidPinkDark = Color(0xFFCC0070)    // Darker variant for pressed/focused states
val AcidPinkLight = Color(0xFFFF6BBD)   // Lighter variant for containers

// --- Dark theme ---
val DarkBackground = Color(0xFF0D0D0D)  // Near-black — maximises camera preview contrast
val DarkSurface = Color(0xFF1A1A1A)
val DarkSurfaceVariant = Color(0xFF2A2A2A)
val DarkOnSurface = Color(0xFFF0F0F0)
val DarkOnBackground = Color(0xFFF0F0F0)
// [AI] [NOT-TESTED] Серый второстепенный текст: подписи строк, хинты полей, иконки-действия, «Отмена».
// Значение дословно то, что экраны хардкодили как Color(0xFF888888) (~30 мест) — пиксели не меняются. [/AI]
val TextSecondary = Color(0xFF888888)

// --- Light theme (secondary, for settings screens) ---
val LightBackground = Color(0xFFFAFAFA)
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFF3F3F3)

// --- Semantic ---
val ErrorRed = Color(0xFFCF6679)
val SuccessGreen = Color(0xFF4CAF50)
val WarningAmber = Color(0xFFFF9800)

// --- Stream status indicators ---
val StreamLive = Color(0xFFFF1A1A)      // Red "LIVE" dot
val StreamReady = SuccessGreen          // Green "READY" dot
val StreamError = ErrorRed             // Error state
