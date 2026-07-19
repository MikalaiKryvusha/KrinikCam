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
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import com.kriniks.kcam.R
import com.kriniks.kcam.core.logging.FileLogger
import com.kriniks.kcam.feature.streaming.ui.EncoderProfilesOverlay
import com.kriniks.kcam.feature.streaming.ui.ImportReportDialog
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
    onOpenDeveloper: () -> Unit = {},   // long-press on "KrinikCam" → hidden Developer menu (Idea 07)
    onOpenManual: () -> Unit = {},      // plans/06 — встроенное руководство пользователя
    streamViewModel: StreamViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val profiles by streamViewModel.profiles.collectAsStateWithLifecycle()
    val activeProfile by streamViewModel.activeProfile.collectAsStateWithLifecycle()
    // plans/14 — профили кодера для пикера/менеджера.
    val encoderProfiles by streamViewModel.encoderProfiles.collectAsStateWithLifecycle()
    // bug 42 — кодеки, поддерживаемые железом устройства.
    val supportedCodecs by streamViewModel.supportedCodecs.collectAsStateWithLifecycle()
    var showPlatforms by remember { mutableStateOf(false) }
    var showEncoderOverlay by remember { mutableStateOf(false) }
    var showProjectInfo by remember { mutableStateOf(false) }
    var showAuthorInfo by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    // bug 46 — текущий язык приложения (per-app locale, Android 13+). null = следовать системе.
    // Смена локали пересоздаёт Activity → SettingsScreen перечитает значение свежим.
    val currentLangTag = appLanguageTag(context)
    val currentLangName = when (currentLangTag) {
        "en" -> stringResource(R.string.lang_english)
        "ru" -> stringResource(R.string.lang_russian)
        else -> stringResource(R.string.lang_follow_system)
    }

    // Build identity shown as a gray aux line under "KrinikCam" — lets the user (and bug reports)
    // see exactly which build is running, in every build type. BUILD_TIME is injected at build
    // time via buildConfigField (see app/build.gradle.kts).
    val buildInfo = "${BuildConfig.BUILD_TYPE} · v${BuildConfig.VERSION_NAME} · ${BuildConfig.BUILD_TIME}"
    // Resolved in composition (stringResource can't be called inside the onClick lambda below).
    val shareChooserTitle = stringResource(R.string.settings_share_log_chooser)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title), color = Color.White, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, stringResource(R.string.action_back), tint = Color.White)
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
            SettingsSection(title = stringResource(R.string.settings_section_streaming)) {
                SettingsRow(
                    icon = Icons.Default.Wifi,
                    title = stringResource(R.string.settings_platforms),
                    subtitle = if (profiles.isEmpty()) stringResource(R.string.settings_no_platforms)
                               // plans/13 — честная плюрализация вместо ручного "s" (в RU три формы).
                               else pluralStringResource(R.plurals.settings_platforms_count, profiles.size, profiles.size),
                    onClick = { showPlatforms = true },
                )
                // Криник — строка «Активный профиль» УБРАНА: легаси одиночного стрима. При мультистриме
                // вещают ВСЕ включённые платформы разом, «активного профиля» нет; строка дублировала вход
                // в «Платформы» и путала.
                // Криник — прямой вход в профили кодера (третий из трёх путей; большая кнопка из «Платформ» убрана).
                SettingsRow(
                    icon = Icons.Default.Memory, // Криник — «цифровая/кодек» иконка (см. FloatingRadialMenu)
                    title = stringResource(R.string.settings_encoder_profiles),
                    subtitle = stringResource(R.string.settings_encoder_profiles_sub),
                    onClick = { showEncoderOverlay = true },
                )
            }

            // ── Permissions ───────────────────────────────────────────
            // Re-grant camera/microphone if they were denied in the OS (from Krinik's feedback).
            PermissionsSection()

            // ── Debug / Logging ───────────────────────────────────────
            SettingsSection(title = stringResource(R.string.settings_section_debug)) {
                SettingsRow(
                    icon = Icons.Default.BugReport,
                    title = stringResource(R.string.settings_share_log),
                    subtitle = stringResource(R.string.settings_share_log_sub),
                    onClick = {
                        val intent = fileLogger.shareIntent()
                        context.startActivity(Intent.createChooser(intent, shareChooserTitle))
                    },
                )
            }

            // ── Руководство (plans/06 / Idea 32) ──────────────────────
            SettingsSection(title = stringResource(R.string.settings_section_help)) {
                SettingsRow(
                    icon = Icons.Default.MenuBook,
                    title = stringResource(R.string.settings_manual_title),
                    subtitle = stringResource(R.string.settings_manual_subtitle),
                    onClick = onOpenManual,
                )
            }

            // ── Язык приложения (bug 46) ──────────────────────────────
            SettingsSection(title = stringResource(R.string.settings_section_language)) {
                SettingsRow(
                    icon = Icons.Default.Language,
                    title = stringResource(R.string.settings_language),
                    subtitle = currentLangName,
                    onClick = { showLanguageDialog = true },
                )
            }

            // ── About ─────────────────────────────────────────────────
            SettingsSection(title = stringResource(R.string.settings_section_about)) {
                SettingsRow(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.app_name),
                    subtitle = stringResource(R.string.settings_about_app_sub),
                    // Second gray aux line — build identity (type · version · build time).
                    subtitle2 = buildInfo,
                    onClick = { showProjectInfo = true },
                    // Hidden entry (Idea 07): long-press opens the Developer menu. Discoverable only
                    // to those who know — normal users just tap for the project info dialog.
                    onLongClick = onOpenDeveloper,
                )
                SettingsRow(
                    icon = Icons.Default.Person,
                    title = stringResource(R.string.settings_author),
                    subtitle = stringResource(R.string.settings_author_sub),
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
            encoderProfiles = encoderProfiles,
            onManageEncoders = { showEncoderOverlay = true },
            onDismiss = { showPlatforms = false },
            onSelectProfile = { streamViewModel.selectProfile(it) },
            onSaveProfile = { streamViewModel.saveProfile(it) },
            onDeleteProfile = { streamViewModel.deleteProfile(it) },
            onStartStream = {},
            buildExportJson = { streamViewModel.buildExportJson() },
            onImportJson = { streamViewModel.importProfilesFromJson(it) },
        )
    }

    // plans/14 — менеджер профилей кодера.
    if (showEncoderOverlay) {
        EncoderProfilesOverlay(
            profiles = encoderProfiles,
            supportedCodecs = supportedCodecs,
            onDismiss = { showEncoderOverlay = false },
            onSaveProfile = { streamViewModel.saveEncoderProfile(it) },
            onDeleteProfile = { streamViewModel.deleteEncoderProfile(it) },
            // Криник — экспорт/импорт профилей кодера (универсальный импорт с отчётом).
            buildExportJson = { streamViewModel.buildEncoderExportJson() },
            onImportJson = { streamViewModel.importEncoderProfilesFromJson(it) },
        )
    }

    // Криник — универсальный отчёт импорта: модалка «Понял» при замечаниях (недостающие/неизвестные значения).
    val importReport by streamViewModel.importReport.collectAsStateWithLifecycle()
    importReport?.let { rep ->
        ImportReportDialog(report = rep, onDismiss = { streamViewModel.dismissImportReport() })
    }

    // Tap "KrinikCam" → project info + GitHub link.
    if (showProjectInfo) {
        ProjectInfoDialog(buildInfo = buildInfo, onDismiss = { showProjectInfo = false })
    }
    // Tap "Author" → author info + clickable social links.
    if (showAuthorInfo) {
        AuthorInfoDialog(onDismiss = { showAuthorInfo = false })
    }
    // bug 46 — выбор языка приложения (следовать системе / English / Русский).
    if (showLanguageDialog) {
        LanguageDialog(
            current = currentLangTag,
            onSelect = { tag -> setAppLanguage(context, tag); showLanguageDialog = false },
            onDismiss = { showLanguageDialog = false },
        )
    }
}

/**
 * bug 46 — диалог выбора языка приложения. Применяется через LocaleManager (Android 13+): пустой
 * список локалей = следовать системе; конкретный тег = принудительный язык. Система сама пересоздаёт
 * Activity с новой локалью, поэтому доп. рестарт не нужен.
 */
@Composable
private fun LanguageDialog(current: String?, onSelect: (String?) -> Unit, onDismiss: () -> Unit) {
    val options: List<Pair<String?, Int>> = listOf(
        null to R.string.lang_follow_system,
        "en" to R.string.lang_english,
        "ru" to R.string.lang_russian,
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1A1A1A),
        title = { Text(stringResource(R.string.settings_language), color = Color.White) },
        text = {
            Column {
                options.forEach { (tag, res) ->
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { onSelect(tag) }.padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = current == tag,
                            onClick = { onSelect(tag) },
                            colors = RadioButtonDefaults.colors(selectedColor = Color(0xFFFF1A8C)),
                        )
                        Text(stringResource(res), color = Color.White)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel), color = Color.Gray) }
        },
    )
}

/** bug 46 — текущий язык приложения (per-app locale). Возвращает "en"/"ru" или null (следовать системе). */
private fun appLanguageTag(context: android.content.Context): String? {
    val locales = context.getSystemService(android.app.LocaleManager::class.java).applicationLocales
    return if (locales.isEmpty) null else locales[0]?.language
}

/** bug 46 — задать язык приложения. tag=null → следовать системе; "en"/"ru" → принудительно. */
private fun setAppLanguage(context: android.content.Context, tag: String?) {
    val lm = context.getSystemService(android.app.LocaleManager::class.java)
    lm.applicationLocales = if (tag == null) android.os.LocaleList.getEmptyLocaleList()
                            else android.os.LocaleList.forLanguageTags(tag)
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

    val statusLine = stringResource(
        R.string.settings_perm_status,
        if (cameraGranted) "✓" else "✗",
        if (micGranted) "✓" else "✗",
    )

    SettingsSection(title = stringResource(R.string.settings_section_permissions)) {
        SettingsRow(
            icon = if (allGranted) Icons.Default.CheckCircle else Icons.Default.Lock,
            title = if (allGranted) stringResource(R.string.settings_permissions_granted) else stringResource(R.string.settings_permissions_grant),
            subtitle = if (allGranted) stringResource(R.string.settings_perm_subtitle_granted, statusLine)
                       else stringResource(R.string.settings_perm_subtitle_grant, statusLine),
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    subtitle2: String? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,   // optional long-press (e.g. hidden Developer menu)
) {
    val rowContent = @Composable {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // combinedClickable supports both tap and long-press; fall back to plain row if neither.
                .then(
                    if (onClick != null || onLongClick != null)
                        Modifier.combinedClickable(onClick = { onClick?.invoke() }, onLongClick = onLongClick)
                    else Modifier
                )
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

    // Idea 14/18: opening the hidden Developer menu requires a LONGER long-press so it isn't
    // triggered accidentally. combinedClickable reads longPressTimeoutMillis from LocalViewConfiguration
    // (default ~500ms), so for rows with a long-press we provide an override. Idea 18: 2000ms felt too
    // long → lowered to 1000ms (still deliberate, but snappy). NOTE: ui.mjs `longpress` must hold ≥1s.
    if (onLongClick != null) {
        val longPressCfg = object : ViewConfiguration by LocalViewConfiguration.current {
            override val longPressTimeoutMillis: Long get() = 1000L
        }
        CompositionLocalProvider(LocalViewConfiguration provides longPressCfg) { rowContent() }
    } else {
        rowContent()
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
        title = { Text(stringResource(R.string.app_name), color = Color.White, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(R.string.about_description),
                    color = Color(0xFFBBBBBB), fontSize = 13.sp,
                )
                Text(stringResource(R.string.dialog_license), color = Color(0xFF888888), fontSize = 12.sp)
                Text(buildInfo, color = Color(0xFF666666), fontSize = 11.sp)
                LinkRow(Icons.Default.Code, "github.com/MikalaiKryvusha/KrinikCam") {
                    openUrl(context, "https://github.com/MikalaiKryvusha/KrinikCam")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close), color = AcidPink) }
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
                Text(stringResource(R.string.author_name), color = Color.White, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.author_aka), color = Color.White, fontSize = 14.sp)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                // Russian aux line only.
                Text(stringResource(R.string.author_ru), color = Color(0xFF888888), fontSize = 12.sp)
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
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close), color = AcidPink) }
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
