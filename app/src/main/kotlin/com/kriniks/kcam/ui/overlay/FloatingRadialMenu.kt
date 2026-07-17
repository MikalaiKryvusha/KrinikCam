/**
 * FloatingRadialMenu — expanding circular action menu, Sims 3 style (Q2 answer).
 *
 * A FAB in the bottom-right corner. Single tap → 3-5 action items radiate outward
 * in a semi-circle above the button. Each action item is a smaller circular button.
 * Tap outside or on the FAB again → menu collapses.
 *
 * Phase 1 items:
 *   🔴 Go Live / ⬛ Stop  (toggles based on stream state)
 *   📡 Platforms           (opens StreamPlatformsOverlay)
 *   ⚙️  Settings           (navigates to SettingsScreen)
 *
 * Full radial animation + more items (filters, sources, etc.) in Phase 4.
 *
 * Related: StreamState, StreamPlatformsOverlay, MainScreen
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.R
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isLive

private val AcidPink = Color(0xFFFF1A8C)
private val LiveRed = Color(0xFFFF1A1A)

data class RadialAction(
    val icon: ImageVector,
    val label: String,
    val tint: Color = Color.White,
    val onClick: () -> Unit,
)

@Composable
fun FloatingRadialMenu(
    streamState: StreamState,
    onStartStream: () -> Unit,
    onStopStream: () -> Unit,
    onOpenPlatforms: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    // plans/13 — подписи из ресурсов (buildList выполняется в composable-скоупе, resolve законен).
    val actions = buildList {
        if (streamState.isLive) {
            add(RadialAction(Icons.Default.StopCircle, stringResource(R.string.fab_stop), LiveRed, onStopStream))
        } else {
            add(RadialAction(Icons.Default.RadioButtonChecked, stringResource(R.string.fab_go_live), AcidPink, onStartStream))
        }
        // Слои вынесены в ОТДЕЛЬНЫЙ FAB внизу-слева (Криник 2026-07-06) — здесь их больше нет.
        add(RadialAction(Icons.Default.Wifi, stringResource(R.string.fab_platforms), Color.White, onOpenPlatforms))
        add(RadialAction(Icons.Default.Settings, stringResource(R.string.fab_settings), Color.White, onOpenSettings))
    }

    // Outer Box fills the whole screen (caller passes Modifier.fillMaxSize()) so the
    // tap-catcher scrim can cover everything. The FAB cluster itself is anchored bottom-end.
    Box(modifier = modifier) {

        // ── Tap-outside-to-dismiss scrim ──────────────────────────────
        // Present ONLY while the menu is expanded, and fully transparent (no dimming),
        // so it never intercepts touches to the live preview when the menu is closed.
        // indication = null → no ripple flash across the screen on tap.
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

        // ── FAB cluster (radial action items + main FAB), anchored bottom-end ──
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 32.dp, end = 24.dp),
            contentAlignment = Alignment.BottomEnd,
        ) {
            // ── Action items (radiate upward when expanded) ───────────────
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(bottom = 72.dp),
            ) {
                actions.forEachIndexed { index, action ->
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

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.End,
                        modifier = Modifier
                            .alpha(alpha)
                            .scale(scale),
                    ) {
                        // Label pill — clickable so tapping the text works same as tapping the icon button
                        Surface(
                            color = Color(0xDD1A1A1A),
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .padding(end = 10.dp)
                                .clickable { action.onClick(); expanded = false },
                        ) {
                            Text(
                                text = action.label,
                                color = Color.White,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                            )
                        }
                        // Action button
                        SmallFloatingActionButton(
                            onClick = { action.onClick(); expanded = false },
                            containerColor = Color(0xFF2A2A2A),
                            contentColor = action.tint,
                            shape = CircleShape,
                        ) {
                            Icon(action.icon, contentDescription = action.label, tint = action.tint)
                        }
                    }
                }
            }

            // ── Main FAB ─────────────────────────────────────────────────
            val fabColor = when {
                streamState.isLive -> LiveRed
                else -> AcidPink
            }
            val fabIcon = if (expanded) Icons.Default.Close else Icons.Default.Add

            FloatingActionButton(
                onClick = { expanded = !expanded },
                containerColor = fabColor,
                contentColor = Color.White,
                shape = CircleShape,
                modifier = Modifier.size(60.dp),
            ) {
                // Live dot badge
                if (streamState.isLive && !expanded) {
                    Box(
                        Modifier
                            .size(60.dp)
                            .background(fabColor, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(stringResource(R.string.fab_live_badge), color = Color.White, fontSize = 13.sp,
                            style = MaterialTheme.typography.labelMedium)
                    }
                } else {
                    Icon(fabIcon, contentDescription = stringResource(R.string.fab_menu_desc), modifier = Modifier.size(28.dp))
                }
            }
        }
    }
}
