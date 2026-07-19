/**
 * StreamPlatformsOverlay — modal bottom-sheet for managing streaming platforms.
 *
 * Платформа = «куда» стримить: имя, платформа, RTMP URL, ключ, вкл/выкл, и ССЫЛКА на профиль кодера
 * (как кодировать). Сам профиль кодера настраивается в отдельном менеджере (EncoderProfilesOverlay,
 * plans/14 / bug 41) — здесь только ВЫБОР профиля из выпадашки + кнопка «Управление профилями кодера».
 *
 * Settings in this overlay are identical to those in SettingsScreen (Q3 answer): both read/write the
 * same ProfilesRepository — changes are instant and synced.
 *
 * Related: StreamViewModel, StreamProfile / EncoderProfile (:data:profiles), EncoderProfilesOverlay
 */

package com.kriniks.kcam.feature.streaming.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.StreamPlatform
import com.kriniks.kcam.data.profiles.model.StreamProfile
import com.kriniks.kcam.feature.streaming.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
// Dropdown popup needs a LIGHTER surface than the sheet/cards behind it, otherwise the open menu
// blends into the background and reads as low-contrast.
private val DropdownSurface = Color(0xFF3A3A3A)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StreamPlatformsOverlay(
    profiles: List<StreamProfile>,
    activeProfileId: Long?,
    // plans/14 — список профилей кодера для пикера в форме платформы + резолва имени на карточке.
    encoderProfiles: List<EncoderProfile>,
    onManageEncoders: () -> Unit,
    onDismiss: () -> Unit,
    onSelectProfile: (StreamProfile) -> Unit,
    onSaveProfile: (StreamProfile) -> Unit,
    onDeleteProfile: (StreamProfile) -> Unit,
    onStartStream: () -> Unit,
    // Idea 01 — config import/export.
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

    // SAF "create document" — user picks where to save; write export JSON there (no runtime perm).
    // plans/12 S5 — файловый I/O в Dispatchers.IO: SAF-uri может быть сетевым/медленным провайдером.
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
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) ioScope.launch(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { onImportJson(it.readBytes().decodeToString()) }
            }
        }
    }

    // Лендскейп: контент листа ПРОКРУЧИВАЕТСЯ внутри (verticalScroll ниже) — ничего не режется; за
    // драг-хендл лист тянется на весь экран (nested-scroll связывает скролл контента с раскрытием листа).
    // sheetMaxWidth ограничивает ширину на широком экране (лист по центру, не на всю ширину).
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        sheetState = sheetState,
        sheetMaxWidth = 720.dp,
        modifier = modifier,
    ) {
        // Если лист РАСКРЫТ на весь экран, изменение списка (удаление платформы) меняет высоту контента
        // и ModalBottomSheet пере-усаживается на partial — лист «схлопывается». Держим Expanded:
        // при изменении числа платформ, если были раскрыты, возвращаем на весь экран.
        LaunchedEffect(profiles.size) {
            if (sheetState.currentValue == SheetValue.Expanded) sheetState.expand()
        }
        // Контент ОБОРАЧИВАЕТ высоту (wrap): мало платформ → лист минимальный; много (контент > пол-
        // экрана) → ModalBottomSheet сам встаёт на ~половину (partiallyExpanded), verticalScroll даёт
        // прокрутку внутри, драг хендла раскрывает до полного. Вложенный LazyColumn в скролле нельзя
        // (краш) → карточки обычной Column.
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                .navigationBarsPadding().verticalScroll(rememberScrollState()),
        ) {
            // ── Header: заголовок + компактные действия (Экспорт/Импорт иконками + заметный «+») ──
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.platforms_title), color = Color.White,
                    fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    // Компактные иконки вместо широких кнопок (радикально меньше места — просьба Криника).
                    IconButton(onClick = { exportLauncher.launch("krinikcam_profiles.json") }, enabled = profiles.isNotEmpty()) {
                        Icon(Icons.Default.FileUpload, contentDescription = stringResource(R.string.platforms_export), tint = AcidPink)
                    }
                    IconButton(onClick = { importLauncher.launch(arrayOf("application/json", "text/*", "application/octet-stream")) }) {
                        Icon(Icons.Default.FileDownload, contentDescription = stringResource(R.string.platforms_import), tint = AcidPink)
                    }
                    // «+ Добавить платформу» — ОДНА ИЗ ГЛАВНЫХ кнопок: залитая розовая, заметная (не тусклый ghost).
                    FilledIconButton(
                        onClick = { showAddNew = true },
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = AcidPink, contentColor = Color.White),
                    ) { Icon(Icons.Default.Add, contentDescription = stringResource(R.string.platforms_add_desc)) }
                }
            }
            // plans/12 S5 — предупреждение про секретные ключи в экспорт-файле.
            Text(stringResource(R.string.platforms_keys_warning), color = Color.Gray, fontSize = 11.sp,
                modifier = Modifier.padding(top = 4.dp))

            // Криник — большая кнопка «Управление профилями кодера» отсюда УБРАНА. Вход в менеджер профилей
            // кодера теперь в трёх местах: модалка настройки платформы (ниже, ProfileEditDialog), радиальное
            // меню FAB и экран Settings. onManageEncoders всё ещё нужен модалке редактора платформы.

            Spacer(Modifier.height(12.dp))

            // ── Profile list ──────────────────────────────────────────
            if (profiles.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.platforms_empty), color = Color(0xFF888888), fontSize = 14.sp)
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    profiles.forEach { profile ->
                        PlatformCard(
                            profile = profile,
                            // Имя профиля кодера. Криник — если id не найден (импорт с чужим/0 id), резолвим
                            // так же, как редактор/стример: ФОЛБЭК на дефолтный (первый) профиль — тот, что
                            // реально применится. Иначе карточка показывала «—», а редактор/эфир — дефолт (рассинхрон).
                            encoderName = (encoderProfiles.firstOrNull { it.id == profile.encoderProfileId }
                                ?: encoderProfiles.firstOrNull())?.name ?: "—",
                            isActive = profile.id == activeProfileId,
                            onSelect = { onSelectProfile(profile) },
                            onEdit = { editingProfile = profile },
                            onToggle = { onSaveProfile(profile.copy(isEnabled = !profile.isEnabled)) },
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
                // Новый профиль ссылается на первый доступный профиль кодера (гарантирован init'ом VM).
                encoderProfileId = encoderProfiles.firstOrNull()?.id ?: 0,
            ),
            encoderProfiles = encoderProfiles,
            onManageEncoders = onManageEncoders,
            onSave = { profile -> onSaveProfile(profile); editingProfile = null; showAddNew = false },
            onDismiss = { editingProfile = null; showAddNew = false },
        )
    }

    // ── plans/12 S5 — подтверждение удаления профиля ───────────────────
    confirmDelete?.let { doomed ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            containerColor = DarkSurface,
            title = { Text(stringResource(R.string.profile_delete_title), color = Color.White) },
            text = { Text(stringResource(R.string.profile_delete_text, doomed.name), color = Color.Gray) },
            confirmButton = {
                TextButton(onClick = { onDeleteProfile(doomed); confirmDelete = null }) {
                    Text(stringResource(R.string.common_delete), color = AcidPink)
                }
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
    encoderName: String,
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
        border = androidx.compose.foundation.BorderStroke(if (isActive) 2.dp else 1.dp, borderColor),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(profile.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                // Платформа · привязанный профиль кодера (plans/14).
                Text("${profile.platform.displayName}  ·  $encoderName",
                    color = Color(0xFF888888), fontSize = 12.sp)
            }
            Switch(
                checked = profile.isEnabled, onCheckedChange = { onToggle() },
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
    encoderProfiles: List<EncoderProfile>,
    onManageEncoders: () -> Unit,
    onSave: (StreamProfile) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(initial.name) }
    var platform by remember { mutableStateOf(initial.platform) }
    var rtmpUrl by remember { mutableStateOf(initial.rtmpUrl) }
    var streamKey by remember { mutableStateOf(initial.streamKey) }
    var keyVisible by remember { mutableStateOf(false) }
    // plans/14 — платформа хранит только ССЫЛКУ на профиль кодера (id). Кодер-полей тут больше нет.
    var encoderProfileId by remember {
        mutableStateOf(initial.encoderProfileId.takeIf { id -> encoderProfiles.any { it.id == id } }
            ?: encoderProfiles.firstOrNull()?.id ?: 0L)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        // Bug 04.2: outside tap must not dismiss the whole form (only close an open dropdown).
        properties = DialogProperties(dismissOnClickOutside = false),
        containerColor = DarkSurface,
        title = {
            Text(if (initial.id == 0L) stringResource(R.string.profile_new_title) else stringResource(R.string.profile_edit_title, initial.name),
                color = Color.White, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                PlatformDropdown(selected = platform, onSelect = { p ->
                    platform = p
                    rtmpUrl = p.defaultRtmpUrl
                    // Auto-fill Name only while it still holds a default (Bug 04.1).
                    val isDefaultName = name.isBlank() || StreamPlatform.entries.any { it.displayName == name }
                    if (isDefaultName) name = p.displayName
                })

                KcamTextField(stringResource(R.string.field_name), name) { name = it }
                KcamTextField(stringResource(R.string.field_rtmp_url), rtmpUrl) { rtmpUrl = it }

                OutlinedTextField(
                    value = streamKey, onValueChange = { streamKey = it },
                    label = { Text(stringResource(R.string.field_stream_key), color = Color(0xFF888888)) },
                    singleLine = true,
                    visualTransformation = if (keyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { keyVisible = !keyVisible }) {
                            Icon(if (keyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = null, tint = AcidPink)
                        }
                    },
                    colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth(),
                )

                // plans/14 — ВЫБОР профиля кодера (как кодировать) + кнопка перехода в менеджер.
                EncoderProfilePicker(encoderProfiles, encoderProfileId) { encoderProfileId = it }
                TextButton(onClick = onManageEncoders, modifier = Modifier.align(Alignment.End)) {
                    Text(stringResource(R.string.encoder_manage), color = AcidPink, fontSize = 12.sp)
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
                        encoderProfileId = encoderProfileId,
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

/** plans/14 — пикер профиля кодера, привязываемого к платформе. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EncoderProfilePicker(profiles: List<EncoderProfile>, selectedId: Long, onSelect: (Long) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selectedName = profiles.firstOrNull { it.id == selectedId }?.name ?: "—"
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selectedName, onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_codec_profile), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            profiles.forEach { p ->
                DropdownMenuItem(text = { Text(p.name, color = Color.White) },
                    onClick = { onSelect(p.id); expanded = false })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlatformDropdown(selected: StreamPlatform, onSelect: (StreamPlatform) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected.displayName, onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_platform), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            StreamPlatform.entries.forEach { platform ->
                DropdownMenuItem(text = { Text(platform.displayName, color = Color.White) },
                    onClick = { onSelect(platform); expanded = false })
            }
        }
    }
}

@Composable
private fun KcamTextField(label: String, value: String, modifier: Modifier = Modifier.fillMaxWidth(), onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange,
        label = { Text(label, color = Color(0xFF888888)) }, singleLine = true,
        colors = kcamTextFieldColors(), modifier = modifier,
    )
}

@Composable
private fun kcamTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
    focusedBorderColor = AcidPink, unfocusedBorderColor = Color(0xFF444444), cursorColor = AcidPink,
)
