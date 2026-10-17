/**
 * StandbyPlaceholder — "Please stand by" overlay shown when video source is unavailable.
 *
 * Displayed in two scenarios:
 *   1. No camera is connected at all (first launch)
 *   2. USB camera disconnected during a live stream (Q6 answer)
 *
 * Shows the KrinikCam logo + multilingual "Please stand by" text.
 * When streaming, this composable draws to a Bitmap that RtmpStreamer injects
 * as a static frame so the RTMP session stays alive (Q6 decision).
 *
 * Related: RtmpStreamer.sendStandbyFrame(), MainScreen, UsbViewModel
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.core.ui.theme.AcidPink
import com.kriniks.kcam.core.ui.theme.DarkBackground
import com.kriniks.kcam.core.ui.theme.TextSecondary

// "Please stand by" in 5 major languages (Q6 answer)
private val standbyLines = listOf(
    "Please stand by",   // EN
    "Пожалуйста, подождите",  // RU
    "Por favor, espere",      // ES
    "Bitte warten",           // DE
    "请稍候",                  // ZH
)

@Composable
fun StandbyPlaceholder(
    message: String? = null,
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    // Pulse animation on the logo text
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "logoAlpha",
    )

    Box(
        modifier = modifier.background(DarkBackground),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            // Logo
            Text(
                text = "KrinikCam",
                color = AcidPink,
                fontSize = 36.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.alpha(alpha),
            )

            // Divider
            Box(
                modifier = Modifier
                    .width(60.dp)
                    .height(2.dp)
                    .background(AcidPink.copy(alpha = 0.4f)),
            )

            // Multilingual "please stand by"
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                standbyLines.forEachIndexed { index, line ->
                    Text(
                        text = line,
                        color = Color.White.copy(alpha = if (index == 0) 0.9f else 0.5f),
                        fontSize = if (index == 0) 16.sp else 13.sp,
                        fontWeight = if (index == 0) FontWeight.Medium else FontWeight.Normal,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            // Optional custom message (e.g. "Connect a USB camera")
            if (message != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = message,
                    color = TextSecondary,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                )
            }
        }
    }
}
