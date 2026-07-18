/**
 * EncoderProfilesOverlay — менеджер ПРОФИЛЕЙ КОДЕРА (plans/14, bug 41).
 *
 * Отдельный экран настройки «как кодировать»: разрешение, FPS, битрейт видео (в Мбит/с — bug 43),
 * видеокодек (H.264/H.265/AV1 — bug 42), адаптивный битрейт, звук (битрейт, частота, режим каналов
 * Стерео/Моно/Объединённое — bug 44). Платформа лишь ССЫЛАЕТСЯ на профиль кодера (StreamPlatformsOverlay).
 *
 * Related: StreamViewModel (encoderProfiles + saveEncoderProfile/deleteEncoderProfile), EncoderProfile,
 * StreamPlatformsOverlay (пикер профиля кодера).
 */

package com.kriniks.kcam.feature.streaming.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.res.stringResource
import com.kriniks.kcam.data.profiles.model.AudioChannelMode
import com.kriniks.kcam.data.profiles.model.EncoderProfile
import com.kriniks.kcam.data.profiles.model.VideoCodec
import com.kriniks.kcam.feature.streaming.R

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
private val DropdownSurface = Color(0xFF3A3A3A)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EncoderProfilesOverlay(
    profiles: List<EncoderProfile>,
    // bug 42 — кодеки, которые устройство умеет аппаратно кодировать: в выборе показываем ТОЛЬКО их.
    supportedCodecs: List<VideoCodec>,
    onDismiss: () -> Unit,
    onSaveProfile: (EncoderProfile) -> Unit,
    onDeleteProfile: (EncoderProfile) -> Unit,
    modifier: Modifier = Modifier,
) {
    var editing by remember { mutableStateOf<EncoderProfile?>(null) }
    var showAddNew by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<EncoderProfile?>(null) }

    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        sheetState = sheetState,
        sheetMaxWidth = 720.dp,
        modifier = modifier,
    ) {
        // Раскрыт на весь экран — удаление профиля не должно схлопывать лист (держим Expanded).
        LaunchedEffect(profiles.size) {
            if (sheetState.currentValue == SheetValue.Expanded) sheetState.expand()
        }
        // Контент оборачивает высоту (wrap): мало профилей → лист минимальный; много → лист на ~половину
        // + прокрутка внутри (verticalScroll) + драг хендла до полного.
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                .navigationBarsPadding().verticalScroll(rememberScrollState()),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.encoder_profiles_title), color = Color.White,
                    fontSize = 18.sp, fontWeight = FontWeight.Bold)
                // Заметная залитая кнопка «+» (как на листе платформ).
                FilledIconButton(
                    onClick = { showAddNew = true },
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = AcidPink, contentColor = Color.White),
                ) { Icon(Icons.Default.Add, contentDescription = stringResource(R.string.encoder_profiles_add_desc)) }
            }
            Spacer(Modifier.height(12.dp))

            if (profiles.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.encoder_profiles_empty), color = Color(0xFF888888), fontSize = 14.sp)
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    profiles.forEach { p ->
                        EncoderProfileCard(p, onEdit = { editing = p }, onDelete = { confirmDelete = p })
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }

    if (editing != null || showAddNew) {
        EncoderProfileEditDialog(
            initial = editing ?: EncoderProfile(name = "H.264 1080p30"),
            supportedCodecs = supportedCodecs,
            onSave = { onSaveProfile(it); editing = null; showAddNew = false },
            onDismiss = { editing = null; showAddNew = false },
        )
    }

    confirmDelete?.let { doomed ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            containerColor = DarkSurface,
            title = { Text(stringResource(R.string.encoder_profile_delete_title), color = Color.White) },
            text = { Text(stringResource(R.string.encoder_profile_delete_text, doomed.name), color = Color.Gray) },
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
private fun EncoderProfileCard(profile: EncoderProfile, onEdit: () -> Unit, onDelete: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF232323)),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(profile.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                // Сводка «как кодирует»: разрешение · fps · Мбит · кодек · режим каналов.
                Text(
                    "${profile.videoWidth}x${profile.videoHeight} · ${profile.videoFps}fps · " +
                        "%.1f Mbit · ${profile.videoCodec.displayName} · ${profile.audioChannelMode.displayName}"
                            .format(profile.videoBitrateBps / 1_000_000f),
                    color = Color(0xFF888888), fontSize = 12.sp,
                )
            }
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
private fun EncoderProfileEditDialog(
    initial: EncoderProfile,
    supportedCodecs: List<VideoCodec>,
    onSave: (EncoderProfile) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(initial.name) }
    var resW by remember { mutableStateOf(initial.videoWidth) }
    var resH by remember { mutableStateOf(initial.videoHeight) }
    var fps by remember { mutableStateOf(initial.videoFps.toString()) }
    var bitrateBps by remember { mutableStateOf(initial.videoBitrateBps) }
    var customBitrate by remember { mutableStateOf(BITRATE_PRESETS.none { it.bps == initial.videoBitrateBps }) }
    // bug 43 — ручной ввод в Мбит/с (писать «4», а не «4000»): инициализация из bps.
    var customMbps by remember { mutableStateOf((initial.videoBitrateBps / 1_000_000f).let { if (it % 1f == 0f) it.toInt().toString() else it.toString() }) }
    var codec by remember { mutableStateOf(initial.videoCodec) }
    var adaptive by remember { mutableStateOf(initial.adaptiveBitrate) }
    var audioBitrateBps by remember { mutableStateOf(initial.audioBitrateBps) }
    var sampleRate by remember { mutableStateOf(initial.audioSampleRate) }
    var channelMode by remember { mutableStateOf(initial.audioChannelMode) }

    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(dismissOnClickOutside = false),
        containerColor = DarkSurface,
        title = {
            // Криник: заголовок формы редактора — просто «Профиль кодека» (без «Изменить <имя>»).
            Text(stringResource(R.string.encoder_profile_form_title), color = Color.White, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                KcamTextField(stringResource(R.string.field_name), name) { name = it }

                // ── Видео ─────────────────────────────────────────────
                SectionHeader(stringResource(R.string.section_video))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ResolutionDropdown(resW, resH, Modifier.weight(2f)) { w, h -> resW = w; resH = h }
                    KcamTextField(stringResource(R.string.field_fps), fps, Modifier.weight(1f)) { fps = it }
                }
                // Битрейт видео — пресеты (Мбит) + «Своё» (ручной ввод Мбит/с, bug 43).
                BitratePicker(bitrateBps, customBitrate, customMbps,
                    onPreset = { bitrateBps = it; customBitrate = false },
                    onCustomToggle = { customBitrate = true },
                    onCustomMbps = { customMbps = it })
                // Видеокодек — только те, что умеет железо (supportedCodecs) + подсказка совместимости RTMP.
                CodecDropdown(codec, supportedCodecs) { codec = it }
                when (codec) {
                    VideoCodec.H265 -> HintText(stringResource(R.string.codec_hevc_hint))
                    VideoCodec.AV1 -> HintText(stringResource(R.string.codec_av1_hint))
                    else -> {}
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(adaptive, { adaptive = it }, colors = CheckboxDefaults.colors(checkedColor = AcidPink))
                    Column {
                        Text(stringResource(R.string.field_adaptive_bitrate), color = Color.White, fontSize = 14.sp)
                        Text(stringResource(R.string.field_adaptive_bitrate_hint), color = Color(0xFF888888), fontSize = 11.sp)
                    }
                }

                // ── Звук ──────────────────────────────────────────────
                SectionHeader(stringResource(R.string.section_audio))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AudioBitrateDropdown(audioBitrateBps, Modifier.weight(1f)) { audioBitrateBps = it }
                    SampleRateDropdown(sampleRate, Modifier.weight(1f)) { sampleRate = it }
                }
                // Режим каналов: Стерео / Моно / Объединённое стерео (bug 44).
                Text(stringResource(R.string.field_channel_mode), color = Color(0xFF888888), fontSize = 12.sp)
                ChannelModeSelector(channelMode) { channelMode = it }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(initial.copy(
                        name = name.ifBlank { "${codec.displayName} ${resH}p" },
                        videoWidth = resW, videoHeight = resH,
                        videoFps = fps.toIntOrNull() ?: 30,
                        videoBitrateBps = resolveBitrate(customBitrate, customMbps, bitrateBps),
                        videoCodec = codec,
                        adaptiveBitrate = adaptive,
                        audioBitrateBps = audioBitrateBps,
                        audioSampleRate = sampleRate,
                        audioChannelMode = channelMode,
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Контролы полей профиля кодера (bug 42 AV1, bug 43 Мбит, bug 44 три режима каналов).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

@Composable
private fun HintText(text: String) = Text(text, color = Color(0xFFE0A000), fontSize = 11.sp)

@Composable
private fun SectionHeader(text: String) = Text(
    text, color = AcidPink, fontSize = 12.sp, fontWeight = FontWeight.Bold,
    modifier = Modifier.padding(top = 6.dp),
)

private data class ResPreset(val w: Int, val h: Int, val label: String)
private val RESOLUTION_PRESETS = listOf(
    ResPreset(3840, 2160, "2160p · 4K"), ResPreset(2560, 1440, "1440p · 2K"),
    ResPreset(1920, 1080, "1080p · Full HD"), ResPreset(1280, 720, "720p · HD"),
    ResPreset(854, 480, "480p"), ResPreset(640, 360, "360p"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResolutionDropdown(width: Int, height: Int, modifier: Modifier = Modifier, onSelect: (Int, Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, { expanded = it }, modifier) {
        OutlinedTextField(
            value = "${width}×${height}", onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_resolution), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            RESOLUTION_PRESETS.forEach { r ->
                DropdownMenuItem(text = { Text("${r.w}×${r.h}  ·  ${r.label}", color = Color.White) },
                    onClick = { onSelect(r.w, r.h); expanded = false })
            }
        }
    }
}

private data class BitratePreset(val bps: Int, val label: String)
private val BITRATE_PRESETS = listOf(
    BitratePreset(2_500_000, "2.5"), BitratePreset(4_500_000, "4.5"),
    BitratePreset(6_000_000, "6"), BitratePreset(9_000_000, "9"),
)

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun BitratePicker(
    bitrateBps: Int, custom: Boolean, customMbps: String,
    onPreset: (Int) -> Unit, onCustomToggle: () -> Unit, onCustomMbps: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.field_video_bitrate), color = Color(0xFF888888), fontSize = 12.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            BITRATE_PRESETS.forEach { p ->
                FilterChip(selected = !custom && bitrateBps == p.bps, onClick = { onPreset(p.bps) },
                    label = { Text(p.label) }, colors = kcamChipColors())
            }
            FilterChip(selected = custom, onClick = onCustomToggle,
                label = { Text(stringResource(R.string.bitrate_custom)) }, colors = kcamChipColors())
        }
        // bug 43 — ручной ввод в Мбит/с (дробный): достаточно «4» или «4.5».
        if (custom) KcamTextField(stringResource(R.string.field_video_bitrate_mbps), customMbps,
            keyboardType = KeyboardType.Decimal) { onCustomMbps(it) }
    }
}

/** bug 42 — в списке ТОЛЬКО [options] (кодеки, что умеет аппаратно кодировать SoC устройства). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CodecDropdown(selected: VideoCodec, options: List<VideoCodec>, onSelect: (VideoCodec) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, { expanded = it }) {
        OutlinedTextField(
            value = selected.displayName, onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_codec), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            options.forEach { c ->
                DropdownMenuItem(text = { Text(c.displayName, color = Color.White) },
                    onClick = { onSelect(c); expanded = false })
            }
        }
    }
}

private val AUDIO_BITRATE_PRESETS = listOf(96_000, 128_000, 160_000, 192_000, 256_000)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AudioBitrateDropdown(selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, { expanded = it }, modifier) {
        OutlinedTextField(
            value = "${selected / 1000} kbps", onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_audio_bitrate), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            AUDIO_BITRATE_PRESETS.forEach { b ->
                DropdownMenuItem(text = { Text("${b / 1000} kbps", color = Color.White) },
                    onClick = { onSelect(b); expanded = false })
            }
        }
    }
}

private val SAMPLE_RATES = listOf(44_100, 48_000)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SampleRateDropdown(selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, { expanded = it }, modifier) {
        OutlinedTextField(
            value = "$selected Hz", onValueChange = {}, readOnly = true,
            label = { Text(stringResource(R.string.field_sample_rate), color = Color(0xFF888888)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            colors = kcamTextFieldColors(), modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }, modifier = Modifier.background(DropdownSurface)) {
            SAMPLE_RATES.forEach { r ->
                DropdownMenuItem(text = { Text("$r Hz", color = Color.White) },
                    onClick = { onSelect(r); expanded = false })
            }
        }
    }
}

/** bug 44 — селектор из трёх режимов каналов (Стерео/Моно/Объединённое стерео) чипами. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChannelModeSelector(selected: AudioChannelMode, onSelect: (AudioChannelMode) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AudioChannelMode.entries.forEach { mode ->
            val label = when (mode) {
                AudioChannelMode.STEREO -> stringResource(R.string.channel_stereo)
                AudioChannelMode.MONO -> stringResource(R.string.channel_mono)
                AudioChannelMode.JOINED_STEREO -> stringResource(R.string.channel_joined)
            }
            FilterChip(selected = selected == mode, onClick = { onSelect(mode) },
                label = { Text(label) }, colors = kcamChipColors())
        }
    }
}

@Composable
private fun KcamTextField(
    label: String, value: String, modifier: Modifier = Modifier.fillMaxWidth(),
    keyboardType: KeyboardType = KeyboardType.Text, onValueChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange,
        label = { Text(label, color = Color(0xFF888888)) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = kcamTextFieldColors(), modifier = modifier,
    )
}

@Composable
private fun kcamTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
    focusedBorderColor = AcidPink, unfocusedBorderColor = Color(0xFF444444), cursorColor = AcidPink,
)

@Composable
private fun kcamChipColors() = FilterChipDefaults.filterChipColors(
    containerColor = Color(0xFF2A2A2A), labelColor = Color(0xFFBBBBBB),
    selectedContainerColor = AcidPink, selectedLabelColor = Color.White,
)

/** Итоговый видеобитрейт: пресет как есть, «своё» — из Мбит/с (пол 0.5 Мбит). */
private fun resolveBitrate(custom: Boolean, customMbps: String, presetBps: Int): Int =
    if (custom) ((customMbps.toFloatOrNull() ?: 4f) * 1_000_000).toInt().coerceAtLeast(500_000)
    else presetBps
