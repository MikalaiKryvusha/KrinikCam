/**
 * RotationMenu — top-right expanding menu to pick the video rotation angle (Idea 06).
 *
 * Mirrors FloatingRadialMenu's interaction: tap the rotation FAB → angle options (0° / 90° /
 * 180° / 270°) radiate downward; pick one → applies + collapses; tap outside → collapses.
 * Rotation changes the OUTGOING aspect (90/270 → portrait 9:16), so it's only allowed before
 * going live — during a stream the FAB is locked and a tap surfaces a hint instead of expanding.
 *
 * Related: StreamViewModel.videoRotation / setVideoRotation, RtmpStreamer, MainScreen
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material3.Icon
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val AcidPink = Color(0xFFFF1A8C)

// The four supported angles, shown top→bottom under the rotation FAB.
private val ROTATION_ANGLES = listOf(0, 90, 180, 270)

@Composable
fun RotationMenu(
    currentRotation: Int,
    enabled: Boolean,                 // false while streaming → rotation is locked
    onSelectRotation: (Int) -> Unit,
    onLockedTap: () -> Unit,          // invoked when tapped while locked (shows a hint)
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    // Collapse automatically if streaming starts while the menu is open.
    LaunchedEffect(enabled) { if (!enabled) expanded = false }

    Box(modifier = modifier) {

        // Tap-outside-to-dismiss scrim (transparent, only while expanded).
        if (expanded) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { expanded = false },
            )
        }

        // FAB cluster anchored top-end; angle options drop DOWN below the FAB.
        Column(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 16.dp, end = 16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── Rotation FAB (the always-visible button) ──────────────────
            SmallFloatingActionButton(
                onClick = { if (enabled) expanded = !expanded else onLockedTap() },
                containerColor = (if (enabled) AcidPink else Color(0xFF555555)).copy(alpha = 0.85f),
                contentColor = Color.White,
            ) {
                if (!enabled) {
                    Icon(Icons.Filled.Lock, contentDescription = "Rotation locked (streaming)")
                } else if (currentRotation == 0) {
                    Icon(Icons.Filled.ScreenRotation, contentDescription = "Rotate video")
                } else {
                    // Show the active angle so the chosen rotation is obvious at a glance.
                    Text("${currentRotation}°", color = Color.White, fontSize = 13.sp,
                        fontWeight = FontWeight.Bold)
                }
            }

            // ── Angle options (animate in when expanded) ──────────────────
            ROTATION_ANGLES.forEachIndexed { index, angle ->
                val scale by animateFloatAsState(
                    targetValue = if (expanded) 1f else 0f,
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessLow,
                        visibilityThreshold = 0.01f,
                    ),
                    label = "scale_$index",
                )
                val alpha by animateFloatAsState(
                    targetValue = if (expanded) 1f else 0f,
                    animationSpec = tween(150, delayMillis = index * 30),
                    label = "alpha_$index",
                )

                if (scale > 0.01f) {
                    val isActive = angle == currentRotation
                    // Single sizeable option button: "<angle>° · <aspect>". Active angle filled
                    // acid-pink, others dark. Aspect label: 16:9 for 0/180, 9:16 for 90/270.
                    val orientationLabel = if (angle % 180 == 0) "16:9" else "9:16"
                    Surface(
                        color = if (isActive) AcidPink else Color(0xCC2A2A2A),
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                        modifier = Modifier
                            .alpha(alpha)
                            .scale(scale)
                            .heightIn(min = 48.dp)
                            .clickable { onSelectRotation(angle); expanded = false },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = "${angle}° · $orientationLabel",
                                color = Color.White,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
