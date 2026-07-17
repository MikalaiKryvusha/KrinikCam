/**
 * StreamPlatformsOverlay — modal bottom-sheet for managing streaming platforms.
 *
 * Shows a list of configured platform profiles (YouTube, Twitch, etc.)
 * each with enable/disable toggle, edit action, and delete swipe.
 * Opening the edit form lets the user change stream key, RTMP URL, resolution.
 *
 * Settings in this overlay are identical to those in SettingsScreen (Q3 answer).
 * Both read/write the same ProfilesRepository — changes are instant and synced.
 *
 * Related: StreamViewModel, StreamProfile (:data:profiles), SettingsScreen
 */

package com.kriniks.kcam.feature.streaming.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.res.stringResource
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.feature.streaming.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
// Dropdown popup needs a LIGHTER surface than the sheet/cards behind it (0xFF1A1A1A / 0xFF232323),
// otherwise the open menu blends into the background and reads as low-contrast.
private val DropdownSurface = Color(0xFF3A3A3A)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StreamPlatformsOverlay(
    profiles: List<StreamProfile>,
    activeProfileId: Long?,
    onDismiss: () -> Unit,
    onSelectProfile: (StreamProfile) -> Unit,
    onSaveProfile: (StreamProfile) -> Unit,
    onDeleteProfile: (StreamProfile) -> Unit,
    onStartStream: () -> Unit,
    // Idea 01 — config import/export. buildExportJson() returns the JSON to write to the file the
    // user picks; onImportJson(text) receives the JSON read from a picked file.
    buildExportJson: () -> String = { "" },
    onImportJson: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var editingProfile by remember { mutableStateOf<StreamProfile?>(null) }
    var showAddNew by remember { mutableStateOf(false) }
    // plans/12 S5 — подтверждение удаления: корзина была мгновенной безвозвратной потерей ключа.
    var confirmDelete by remember { mutableStateOf<StreamProfile?>(null) }
    val ioScope = rememberCoroutineScope()

    // SAF "create document" — user picks where to save; we write the export JSON there (no runtime
    // storage permission needed). Default filename suggested via the launch() call below.
    // plans/12 S5 — файловый I/O в Dispatchers.IO: SAF-uri может быть сетевым/медленным провайдером,
    // запись на main-потоке ловила бы ANR. JSON строится на main (снимок state), пишутся байты в IO.
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri != null) {
            val payload = buildExportJson().toByteArray()
            ioScope.launch(Dispatchers.IO) {
                runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(payload) } }
            }
        }
    }
    // SAF "open document" — user picks a config file; we read its text and hand it to the importer.
    // Чтение — в IO; onImportJson безопасен из фона (ViewModel сам уводит работу в viewModelScope).
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) ioScope.launch(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { onImportJson(it.readBytes().decodeToString()) }
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .navigationBarsPadding(),
        ) {
            // ── Header ─────────────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.platforms_title),
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
                IconButton(onClick = { showAddNew = true }) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.platforms_add_desc), tint = AcidPink)
                }
            }

            // ── Import / Export config (Idea 01) ──────────────────────
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { exportLauncher.launch("krinikcam_profiles.json") },
                    enabled = profiles.isNotEmpty(),
                    modifier = Modifier.weight(1f),
                ) { Text(stringResource(R.string.platforms_export), color = AcidPink) }
                OutlinedButton(
                    onClick = { importLauncher.launch(arrayOf("application/json", "text/*", "application/octet-stream")) },
                    modifier = Modifier.weight(1f),
                ) { Text(stringResource(R.string.platforms_import), color = AcidPink) }
            }
            // plans/12 S5 — честное предупреждение: экспорт-файл несёт секретные stream-ключи.
            Text(
                text = stringResource(R.string.platforms_keys_warning),
                color = Color.Gray,
                fontSize = 11.sp,
                modifier = Modifier.padding(top = 4.dp),
            )

            Spacer(Modifier.height(12.dp))

            // ── Profile list ──────────────────────────────────────────
            if (profiles.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.platforms_empty),
                        color = Color(0xFF888888),
                        fontSize = 14.sp,
                    )
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(profiles, key = { it.id }) { profile ->
                        PlatformCard(
                            profile = profile,
                            isActive = profile.id == activeProfileId,
                            onSelect = { onSelectProfile(profile) },
                            onEdit = { editingProfile = profile },
                            onToggle = { onSaveProfile(profile.copy(isEnabled = !profile.isEnabled)) },
                            // plans/12 S5 — сначала подтверждение (диалог ниже), потом удаление.
                            onDelete = { confirmDelete = profile },
                        )
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }

    // ── Edit / New profile form ────────────────────────────────────────
    if (editingProfile != null || showAddNew) {
        ProfileEditDialog(
            initial = editingProfile ?: StreamProfile(
                name = "YouTube",
                platform = StreamPlatform.YOUTUBE,
                rtmpUrl = StreamPlatform.YOUTUBE.defaultRtmpUrl,
                streamKey = "",
            ),
            onSave = { profile ->
                onSaveProfile(profile)
                editingProfile = null
                showAddNew = false
            },
            onDismiss = {
                editingProfile = null
                showAddNew = false
            },
        )
    }

    // ── plans/12 S5 — подтверждение удаления профиля ───────────────────
    // Корзина была мгновенной: тап = безвозвратная потеря stream-ключа. Теперь — явный вопрос.
    confirmDelete?.let { doomed ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            containerColor = DarkSurface,
            title = { Text(stringResource(R.string.profile_delete_title), color = Color.White) },
            text = {
                Text(
                    stringResource(R.string.profile_delete_text, doomed.name),
                    color = Color.Gray,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onDeleteProfile(doomed)
                    confirmDelete = null
                }) { Text(stringResource(R.string.common_delete), color = AcidPink) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text(stringResource(R.string.common_cancel), color = Color.Gray) }
            },
        )
    }
}

@Composable
private fun PlatformCard(
    profile: StreamProfile,
    isActive: Boolean,
    onSelect: () -> Unit,
    onEdit: () -> Unit,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
) {
    val borderColor = if (isActive) AcidPink else Color(0xFF2A2A2A)
    Card(
        onClick = onSelect,
        colors = CardDefaults.cardColors(containerColor = Color(0xFF232323)),
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(
            if (isActive) 2.dp else 1.dp, borderColor,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(profile.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                Text(
                    "${profile.platform.displayName}  ·  ${profile.videoWidth}x${profile.videoHeight}",
                    color = Color(0xFF888888),
                    fontSize = 12.sp,
                )
            }
            Switch(
                checked = profile.isEnabled,
                onCheckedChange = { onToggle() },
                colors = SwitchDefaults.colors(checkedThumbColor = AcidPink, checkedTrackColor = AcidPink.copy(alpha = 0.4f)),
            )
            IconButton(onClick = onEdit) {
                Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.profile_edit_desc), tint = Color(0xFF888888))
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.profile_delete_desc), tint = Color(0xFF555555))
            }
        }
    }
}

@Composable
private fun ProfileEditDialog(
    initial: StreamProfile,
    onSave: (StreamProfile) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(initial.name) }
    var platform by remember { mutableStateOf(initial.platform) }
    var rtmpUrl by remember { mutableStateOf(initial.rtmpUrl) }
    var streamKey by remember { mutableStateOf(initial.streamKey) }
    var keyVisible by remember { mutableStateOf(false) }
    // Idea 16: resolution is now picked from a dropdown of standard 16:9 presets instead of typed by
    // hand. Stored landscape (16:9); portrait 9:16 is produced by the rotation feature at stream time.
    var resW by remember { mutableStateOf(initial.videoWidth) }
    var resH by remember { mutableStateOf(initial.videoHeight) }
    var fps by remember { mutableStateOf(initial.videoFps.toString()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        // Bug 04.2: don't dismiss the whole form on an outside tap. When the platform dropdown
        // is open, tapping outside it used to bubble to the dialog scrim and close the entire
        // form. Disabling click-outside dismiss means the outside tap only closes the dropdown
        // (its own popup), and the form is closed deliberately via Cancel/Save (back press still
        // works). Bonus: prevents accidental loss of a half-filled form.
        properties = DialogProperties(dismissOnClickOutside = false),
        containerColor = DarkSurface,
        title = {
            Text(if (initial.id == 0L) stringResource(R.string.profile_new_title) else stringResource(R.string.profile_edit_title, initial.name),
                color = Color.White, fontWeight = FontWeight.Bold)
        },
        text = {
            // Bug 04.3: the Width/Height/FPS row rendered as empty boxes (no label, no value)
            // in landscape — the dialog caps its height, the tall field stack overflowed, and the
            // bottom row got compressed to ~0 height so its OutlinedTextField labels/values clipped
            // away. verticalScroll lets every field keep its natural height; the user scrolls to
            // reach the resolution/FPS fields instead of them being squashed into invisibility.
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                // Platform picker
                PlatformDropdown(selected = platform, onSelect = { p ->
                    platform = p
                    rtmpUrl = p.defaultRtmpUrl
                    // Auto-fill Name from the chosen platform ONLY while Name still holds a
                    // default value — i.e. it's blank or equals SOME platform's display name
                    // (Bug 04.1). Checking against the full platform list (not just `initial`)
                    // is what makes auto-fill keep working after the 2nd, 3rd… change. If the
                    // user typed a custom name, it won't match any default → we leave it intact.
                    val isDefaultName = name.isBlank() ||
                        StreamPlatform.entries.any { it.displayName == name }
                    if (isDefaultName) name = p.displayName
                })

                KcamTextField(stringResource(R.string.field_name), name) { name = it }
                KcamTextField(stringResource(R.string.field_rtmp_url), rtmpUrl) { rtmpUrl = it }

                // Stream key with show/hide toggle
                OutlinedTextField(
                    value = streamKey,
                    onValueChange = { streamKey = it },
                    label = { Text(stringResource(R.string.field_stream_key), color = Color(0xFF888888)) },
                    singleLine = true,
                    visualTransformation = if (keyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { keyVisible = !keyVisible }) {
                            Icon(
                                if (keyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = null, tint = AcidPink,
                            )
                        }
                    },
                    colors = kcamTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )

                // Resolution preset (16:9) + FPS. Width/Height are no longer typed by hand (Idea 16).
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ResolutionDropdown(
                        width = resW, height = resH,
                        modifier = Modifier.weight(2f),
                    ) { w, h -> resW = w; resH = h }
                    KcamTextField(stringResource(R.string.field_fps), fps, Modifier.weight(1f)) { fps = it }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(initial.copy(
                        name = name.ifBlank { platform.displayName },
                        platform = platform,
                        rtmpUrl = rtmpUrl.ifBlank { platform.defaultRtmpUrl },
                        streamKey = streamKey,
                        videoWidth = resW,
                        videoHeight = resH,
                        videoFps = fps.toIntOrNull() ?: 30,
                    ))
                },
                colors = ButtonDefaults.buttonColors(containerColor = AcidPink),
            ) { Text(stringResource(R.string.common_save)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel), color = Color(0xFF888888)) }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlatformDropdown(selected: StreamPlatform, onSelect: (StreamPlatform) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected.displayName,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.field_platform), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(),
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false },
            modifier = Modifier.background(DropdownSurface)) {
            StreamPlatform.entries.forEach { platform ->
                DropdownMenuItem(
                    text = { Text(platform.displayName, color = Color.White) },
                    onClick = { onSelect(platform); expanded = false },
                )
            }
        }
    }
}

/** Standard 16:9 resolution presets (Idea 16). Stored landscape; portrait is via rotation at stream time. */
private data class ResPreset(val w: Int, val h: Int, val label: String)
private val RESOLUTION_PRESETS = listOf(
    ResPreset(3840, 2160, "2160p · 4K"),
    ResPreset(2560, 1440, "1440p · 2K"),
    ResPreset(1920, 1080, "1080p · Full HD"),
    ResPreset(1280, 720, "720p · HD"),
    ResPreset(854, 480, "480p"),
    ResPreset(640, 360, "360p"),
)

/**
 * Resolution picker (Idea 16) — dropdown of standard 16:9 presets instead of hand-typed Width/Height.
 * Shows "W×H"; a profile with a non-preset size still displays its raw W×H until the user picks one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResolutionDropdown(width: Int, height: Int, modifier: Modifier = Modifier, onSelect: (Int, Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = "${width}×${height}",
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.field_resolution), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(),
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false },
            modifier = Modifier.background(DropdownSurface)) {
            RESOLUTION_PRESETS.forEach { r ->
                DropdownMenuItem(
                    text = { Text("${r.w}×${r.h}  ·  ${r.label}", color = Color.White) },
                    onClick = { onSelect(r.w, r.h); expanded = false },
                )
            }
        }
    }
}

@Composable
private fun KcamTextField(label: String, value: String, modifier: Modifier = Modifier.fillMaxWidth(), onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, color = Color(0xFF888888)) },
        singleLine = true,
        colors = kcamTextFieldColors(),
        modifier = modifier,
    )
}

@Composable
private fun kcamTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedBorderColor = AcidPink,
    unfocusedBorderColor = Color(0xFF444444),
    cursorColor = AcidPink,
)
