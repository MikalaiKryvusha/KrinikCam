/**
 * SettingsScreen — app-wide settings panel.
 *
 * Phase 1 sections:
 *   1. Streaming Platforms — same data as StreamPlatformsOverlay (Q3 answer),
 *      modifications are instantly reflected in the overlay and vice versa.
 *   2. Debug — share latest log file button.
 *   3. About — version, GitHub link, author.
 *
 * Related: StreamViewModel (profiles sync), FileLogger (:core:logging), NavGraph
 */

package com.kriniks.kcam.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kriniks.kcam.BuildConfig
import com.kriniks.kcam.core.logging.FileLogger
import com.kriniks.kcam.feature.streaming.ui.StreamPlatformsOverlay
import com.kriniks.kcam.feature.streaming.ui.StreamViewModel

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
private val DarkBg = Color(0xFF0D0D0D)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    fileLogger: FileLogger,
    streamViewModel: StreamViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val profiles by streamViewModel.profiles.collectAsStateWithLifecycle()
    val activeProfile by streamViewModel.activeProfile.collectAsStateWithLifecycle()
    var showPlatforms by remember { mutableStateOf(false) }
    var showProjectInfo by remember { mutableStateOf(false) }
    var showAuthorInfo by remember { mutableStateOf(false) }

    // Build identity shown as a gray aux line under "KrinikCam" — lets the user (and bug reports)
    // see exactly which build is running, in every build type. BUILD_TIME is injected at build
    // time via buildConfigField (see app/build.gradle.kts).
    val buildInfo = "${BuildConfig.BUILD_TYPE} · v${BuildConfig.VERSION_NAME} · ${BuildConfig.BUILD_TIME}"

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", color = Color.White, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBg),
            )
        },
        containerColor = DarkBg,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            // ── Streaming Platforms ───────────────────────────────────
            SettingsSection(title = "Streaming") {
                SettingsRow(
                    icon = Icons.Default.Wifi,
                    title = "Platforms",
                    subtitle = if (profiles.isEmpty()) "No platforms configured"
                               else "${profiles.size} platform${if (profiles.size > 1) "s" else ""} · tap to manage",
                    onClick = { showPlatforms = true },
                )
                if (activeProfile != null) {
                    SettingsRow(
                        icon = Icons.Default.PlayArrow,
                        title = "Active profile",
                        subtitle = activeProfile!!.name,
                        onClick = { showPlatforms = true },
                    )
                }
            }

            // ── Debug / Logging ───────────────────────────────────────
            SettingsSection(title = "Debug") {
                SettingsRow(
                    icon = Icons.Default.BugReport,
                    title = "Share log file",
                    subtitle = "Send today's debug log for analysis",
                    onClick = {
                        val intent = fileLogger.shareIntent()
                        context.startActivity(Intent.createChooser(intent, "Share KrinikCam log"))
                    },
                )
            }

            // ── About ─────────────────────────────────────────────────
            SettingsSection(title = "About") {
                SettingsRow(
                    icon = Icons.Default.Info,
                    title = "KrinikCam",
                    subtitle = "Open-source USB webcam streamer · MIT License",
                    // Second gray aux line — build identity (type · version · build time).
                    subtitle2 = buildInfo,
                    onClick = { showProjectInfo = true },
                )
                SettingsRow(
                    icon = Icons.Default.Person,
                    title = "Author",
                    subtitle = "Mikalai Kryvusha aka KOT KRINIK",
                    onClick = { showAuthorInfo = true },
                )
            }
        }
    }

    // Platforms overlay — same component as FloatingRadialMenu opens (Q3 answer)
    if (showPlatforms) {
        StreamPlatformsOverlay(
            profiles = profiles,
            activeProfileId = activeProfile?.id,
            onDismiss = { showPlatforms = false },
            onSelectProfile = { streamViewModel.selectProfile(it) },
            onSaveProfile = { streamViewModel.saveProfile(it) },
            onDeleteProfile = { streamViewModel.deleteProfile(it) },
            onStartStream = {},
        )
    }

    // Tap "KrinikCam" → project info + GitHub link.
    if (showProjectInfo) {
        ProjectInfoDialog(buildInfo = buildInfo, onDismiss = { showProjectInfo = false })
    }
    // Tap "Author" → author info + clickable social links.
    if (showAuthorInfo) {
        AuthorInfoDialog(onDismiss = { showAuthorInfo = false })
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column {
        Text(
            text = title.uppercase(),
            color = AcidPink,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp, top = 4.dp),
        )
        Card(
            colors = CardDefaults.cardColors(containerColor = DarkSurface),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
        ) {
            Column { content() }
        }
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    subtitle2: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = AcidPink, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (subtitle != null) {
                Text(subtitle, color = Color(0xFF888888), fontSize = 12.sp)
            }
            // Optional second gray aux line (e.g. build identity under "KrinikCam").
            if (subtitle2 != null) {
                Text(subtitle2, color = Color(0xFF666666), fontSize = 11.sp)
            }
        }
        if (onClick != null) {
            Icon(Icons.Default.ChevronRight, null, tint = Color(0xFF555555))
        }
    }
}

/** Open a URL in the browser / relevant app. */
private fun openUrl(context: android.content.Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}

/** Project info dialog — opened by tapping the "KrinikCam" row. */
@Composable
private fun ProjectInfoDialog(buildInfo: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        title = { Text("KrinikCam", color = Color.White, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Open-source Android app that turns a USB webcam (via OTG) into a live " +
                        "streaming camera for YouTube, Twitch and more. Built by a streamer, for streamers.",
                    color = Color(0xFFBBBBBB), fontSize = 13.sp,
                )
                Text("MIT License · © 2026 Mikalai Kryvusha", color = Color(0xFF888888), fontSize = 12.sp)
                Text(buildInfo, color = Color(0xFF666666), fontSize = 11.sp)
                LinkRow(Icons.Default.Code, "github.com/MikalaiKryvusha/KrinikCam") {
                    openUrl(context, "https://github.com/MikalaiKryvusha/KrinikCam")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close", color = AcidPink) }
        },
    )
}

/** Author info dialog — opened by tapping the "Author" row. Social links are clickable. */
@Composable
private fun AuthorInfoDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        title = { Text("Mikalai Kryvusha", color = Color.White, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("aka KOT KRINIK · Николай Кривуша, Кот Криник", color = Color(0xFF888888), fontSize = 12.sp)
                Spacer(Modifier.height(4.dp))
                LinkRow(Icons.Default.Code, "GitHub — Mikalai Kryvusha") {
                    openUrl(context, "https://github.com/MikalaiKryvusha")
                }
                LinkRow(Icons.Default.PhotoCamera, "Instagram — @kotkrinik") {
                    openUrl(context, "https://instagram.com/kotkrinik")
                }
                LinkRow(Icons.Default.PlayCircle, "YouTube — @kotkrinik") {
                    openUrl(context, "https://youtube.com/@kotkrinik")
                }
                LinkRow(Icons.Default.Send, "Telegram — @kotkrinik") {
                    openUrl(context, "https://t.me/kotkrinik")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close", color = AcidPink) }
        },
    )
}

/** A single clickable link row (icon + acid-pink text) used inside the About dialogs. */
@Composable
private fun LinkRow(icon: ImageVector, text: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = AcidPink, modifier = Modifier.size(20.dp))
        Text(text, color = AcidPink, fontSize = 14.sp)
    }
}
