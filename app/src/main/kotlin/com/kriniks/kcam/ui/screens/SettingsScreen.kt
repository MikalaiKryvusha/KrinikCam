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

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
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
                // Bug 08: in landscape the sections overflow the viewport — make the whole
                // settings list scrollable so every row stays reachable in any orientation.
                .verticalScroll(rememberScrollState())
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

            // ── Permissions ───────────────────────────────────────────
            // Re-grant camera/microphone if they were denied in the OS (from Krinik's feedback).
            PermissionsSection()

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

            // Bottom breathing room so the last row clears the screen edge when scrolled.
            Spacer(Modifier.height(16.dp))
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

/**
 * Permissions section — lets the user re-grant CAMERA / microphone if they were
 * denied in the OS (from Krinik's feedback). Shows a live status line and adapts
 * the tap action:
 *   • permission still askable (denied once, not "Don't ask again") → runtime dialog;
 *   • permission permanently denied, or all already granted → deep-link to the
 *     system app-settings page (the only way back once permanently denied).
 *
 * Note: USB-camera access is a *per-device* grant Android asks on connect — it is
 * not a runtime permission and can't be re-requested from here.
 */
@Composable
private fun PermissionsSection() {
    val context = LocalContext.current
    val activity = context as? Activity
    val lifecycleOwner = LocalLifecycleOwner.current

    // Re-read permission state whenever the screen resumes (e.g. the user returns
    // from the system settings page) or right after a runtime request returns.
    var refreshTick by remember { mutableStateOf(0) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshTick++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Helper: is a runtime permission currently granted?
    fun granted(perm: String) =
        ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED

    // Recomputed on every refreshTick bump (keyed remember) so the row stays in sync.
    val cameraGranted = remember(refreshTick) { granted(Manifest.permission.CAMERA) }
    val micGranted = remember(refreshTick) { granted(Manifest.permission.RECORD_AUDIO) }
    val allGranted = cameraGranted && micGranted

    // Runtime request launcher — bumps refreshTick so the status updates on answer.
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { refreshTick++ }

    val statusLine = "Camera ${if (cameraGranted) "✓" else "✗"} · Mic ${if (micGranted) "✓" else "✗"}"

    SettingsSection(title = "Permissions") {
        SettingsRow(
            icon = if (allGranted) Icons.Default.CheckCircle else Icons.Default.Lock,
            title = if (allGranted) "Permissions granted" else "Grant permissions",
            subtitle = if (allGranted) "$statusLine · tap to manage in system settings"
                       else "$statusLine · tap to grant camera & microphone",
            onClick = {
                // Which required runtime permissions are still missing?
                val missing = buildList {
                    if (!cameraGranted) add(Manifest.permission.CAMERA)
                    if (!micGranted) add(Manifest.permission.RECORD_AUDIO)
                }
                // "Askable" = the OS will still show the runtime dialog. After
                // "Don't ask again" shouldShow returns false → dialog never appears,
                // so the system settings page is the only path back.
                val askable = activity != null && missing.any {
                    ActivityCompat.shouldShowRequestPermissionRationale(activity, it)
                }
                when {
                    missing.isEmpty() -> openAppSettings(context) // all granted → manage/revoke
                    askable -> launcher.launch(missing.toTypedArray())
                    else -> openAppSettings(context) // permanently denied → settings
                }
            },
        )
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

/**
 * Deep-link to this app's system settings page, where the user can grant or
 * revoke permissions even when they were permanently denied in the OS.
 */
private fun openAppSettings(context: android.content.Context) {
    runCatching {
        val intent = Intent(
            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", context.packageName, null),
        )
        context.startActivity(intent)
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
        title = {
            // Name + "· aka KOT KRINIK", both light (white) like the title, separated by a bullet.
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Mikalai Kryvusha", color = Color.White, fontWeight = FontWeight.Bold)
                Text("· aka KOT KRINIK", color = Color.White, fontSize = 14.sp)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                // Russian aux line only.
                Text("Николай Кривуша · Кот Криник", color = Color(0xFF888888), fontSize = 12.sp)
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
