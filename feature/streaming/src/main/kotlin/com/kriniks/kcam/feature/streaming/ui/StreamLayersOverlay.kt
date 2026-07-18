/**
 * StreamLayersOverlay — панель управления слоями сцены (idea 34, interview_008).
 *
 * НЕ модальный bottom-sheet (устарел, удалён), а компактный **вертикальный список**, растущий ВВЕРХ
 * от FAB «Слои» (внизу-слева). Принцип Криника: управление слоями быстрое и наглядное, не перекрывая
 * кадр; детальные настройки слоя — в модальном диалоге.
 *
 *   • Пункты полупрозрачные и компактные — сквозь них видно превью.
 *   • Список растёт вверх; если не влезает по высоте — скроллится.
 *   • Тап по пункту РАСКРЫВАЕТ его (мини-кнопки 👁 видимость / 🗑 удалить / ↕ вверх / ↕ вниз / ⚙
 *     настройки); повторный тап — сворачивает.
 *   • ⚙ открывает модалку настроек слоя (per-type: камера → выбор источника; картинка → …).
 *   • Внизу (у FAB) — обязательная кнопка «＋ Добавить слой» (выбор типа источника).
 *   • Закрытие — тап вовне (по кадру/FAB) ИЛИ повторный тап FAB (обрабатывается в MainScreen).
 *
 * Related: StreamViewModel, Scene/Layer (scene package), CompositorVideoSource (gl)
 */

package com.kriniks.kcam.feature.streaming.ui

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.feature.streaming.scene.ImageOverlayLoader
import com.kriniks.kcam.feature.streaming.scene.Layer
import androidx.compose.ui.res.stringResource
import com.kriniks.kcam.feature.streaming.R
import com.kriniks.kcam.feature.streaming.scene.Scene
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val AcidPink = Color(0xFFFF1A8C)
// Мягкий розовый для подписи-источника 2-й строкой (правка Криника) — приглушённый, не кислотный.
private val SoftPink = Color(0xFFE68FB4)
private val DarkSurface = Color(0xFF1A1A1A)
// Полупрозрачные подложки пунктов — сквозь них видно превью (interview_008 Q2). Прозрачности дано
// больше (указание Криника): свёрнутый ~40% непрозрачности, раскрытый плотнее для читаемости кнопок.
private val ItemBg = Color(0x66151515)
private val ItemBgExpanded = Color(0xCC151515)

/**
 * plans/05 S4 — вариант источника для слоя «Устройство захвата видео» в UI выбора. Лёгкий DTO (id +
 * человекочитаемое имя), чтобы :feature:streaming не зависел от VideoSource (:feature:capture).
 * :app строит список из DeviceManager.availableSources и маппит выбор обратно.
 */
data class SourceOption(val id: String, val label: String)

@Composable
fun StreamLayersOverlay(
    scene: Scene,
    onDismiss: () -> Unit,
    onAddTestOverlay: () -> Unit,
    // Фаза 1: добавить слой-картинку из файла. [bitmap] уже декодирован и вписан в кадр.
    onAddImage: (name: String, bitmap: android.graphics.Bitmap) -> Unit,
    onToggleVisible: (String) -> Unit,
    onRemove: (String) -> Unit,
    onMoveUp: (String) -> Unit,
    onMoveDown: (String) -> Unit,
    // plans/03 S1 — выбор слоя для жестов: id выбранного (null = ничего) и колбэк тапа по строке.
    selectedLayerId: String? = null,
    onSelect: (String) -> Unit = {},
    // plans/05 S4 — выбор источника камера-слоя: доступные источники, текущий id, колбэк выбора.
    sourceOptions: List<SourceOption> = emptyList(),
    currentSourceId: String? = null,
    onSelectSource: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Какой пункт РАСКРЫТ (показывает мини-кнопки). null = все свёрнуты. Тап по пункту — тоггл.
    var expandedId by remember { mutableStateOf<String?>(null) }
    // Слой, ожидающий ПОДТВЕРЖДЕНИЯ удаления (Криник: удаление только через модалку). null = нет.
    var pendingDelete by remember { mutableStateOf<Pair<String, String>?>(null) }
    // Слой, чьи НАСТРОЙКИ открыты в модалке (⚙). null = закрыта.
    var settingsFor by remember { mutableStateOf<Layer?>(null) }
    // Раскрыто ли меню кнопки «＋ Добавить слой».
    var addMenuOpen by remember { mutableStateOf(false) }

    // plans/13 — фолбэк-имя слоя резолвим ЗАРАНЕЕ: коллбэк лаунчера не composable-скоуп.
    val imageFallbackName = stringResource(R.string.layer_image_fallback)
    // SAF «open document» для картинок: пользователь выбирает файл, читаем и декодируем off-main,
    // вписываем в кадр (ImageOverlayLoader) и добавляем слой. Имя слоя = имя файла.
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: return@runCatching null
                    ImageOverlayLoader.loadOverlay(bytes)
                }.getOrNull()
            }
            val name = runCatching {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            }.getOrNull() ?: imageFallbackName
            if (bitmap != null) onAddImage(name, bitmap)
        }
    }

    // Полноэкранный оверлей: прозрачный скрим (тап вовне → закрыть) + список внизу-слева над FAB.
    Box(modifier = modifier.fillMaxSize()) {
        // Скрим на весь экран — прозрачный, но перехватывает тапы «вовне списка» → закрытие.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                )
        )

        // Список слоёв: якорь внизу-слева, растёт ВВЕРХ; скроллится при переполнении.
        // Порядок сверху вниз по экрану: верхний z-слой (рисуется поверх) → нижний; внизу — «Добавить».
        val topToBottom = scene.layers.asReversed()
        Column(
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .align(Alignment.BottomStart)
                // отступ снизу оставляет место для самого FAB «Слои» (внизу-слева).
                .padding(start = 12.dp, end = 12.dp, bottom = 84.dp, top = 40.dp)
                .widthIn(min = 200.dp, max = 340.dp)
                .heightIn(max = 560.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            topToBottom.forEachIndexed { index, layer ->
                // Вторая строка-подпись: КРАТКО что настроено в слое (указание Криника). Для камера-слоя
                // — текущий выбранный источник (напр. «2K USB Camera»), чтобы с ходу понимать содержимое.
                val subtitle = if (layer is Layer.VideoCapture)
                    sourceOptions.firstOrNull { it.id == currentSourceId }?.label else null
                LayerItem(
                    layer = layer,
                    subtitle = subtitle,
                    isTop = index == 0,
                    isBottom = index == topToBottom.lastIndex,
                    expanded = expandedId == layer.id,
                    selected = layer.id == selectedLayerId,
                    onTap = {
                        // Тап по пункту: раскрыть/свернуть (interview_008 Q3) + выбрать для жестов.
                        expandedId = if (expandedId == layer.id) null else layer.id
                        onSelect(layer.id)
                    },
                    onToggleVisible = { onToggleVisible(layer.id) },
                    onMoveUp = { onMoveUp(layer.id) },
                    onMoveDown = { onMoveDown(layer.id) },
                    onRemove = { pendingDelete = layer.id to layer.name },
                    onOpenSettings = { settingsFor = layer },
                )
            }

            // ＋ Добавить слой (обязательная кнопка) — у самого низа, ближе к FAB. Меню выбора типа.
            Box {
                Surface(
                    color = AcidPink,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.clickable { addMenuOpen = true },
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = Color.White)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.layers_add), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    }
                }
                DropdownMenu(expanded = addMenuOpen, onDismissRequest = { addMenuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.layers_add_image)) },
                        leadingIcon = { Icon(Icons.Default.AddPhotoAlternate, contentDescription = null) },
                        onClick = { addMenuOpen = false; imagePicker.launch(arrayOf("image/*")) },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.layers_add_test_overlay)) },
                        leadingIcon = { Icon(Icons.Default.BugReport, contentDescription = null) },
                        onClick = { addMenuOpen = false; onAddTestOverlay() },
                    )
                }
            }
        }

        // ── Модалка подтверждения удаления слоя ──
        pendingDelete?.let { (id, name) ->
            AlertDialog(
                onDismissRequest = { pendingDelete = null },
                containerColor = DarkSurface,
                title = { Text(stringResource(R.string.layer_delete_title), color = Color.White) },
                text = { Text(stringResource(R.string.layer_delete_text, name), color = Color(0xFFCCCCCC)) },
                confirmButton = {
                    TextButton(onClick = { onRemove(id); pendingDelete = null }) {
                        Text(stringResource(R.string.common_delete), color = Color(0xFFCC5555))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDelete = null }) {
                        Text(stringResource(R.string.common_cancel), color = Color(0xFF999999))
                    }
                },
            )
        }

        // ── Модалка настроек слоя (⚙) — per-type содержимое (interview_008 Q5) ──
        settingsFor?.let { layer ->
            LayerSettingsDialog(
                layer = layer,
                onDismiss = { settingsFor = null },
                sourceOptions = sourceOptions,
                currentSourceId = currentSourceId,
                onSelectSource = onSelectSource,
            )
        }
    }
}

/**
 * Один компактный пункт слоя в вертикальном списке. Свёрнутый — миниатюра/иконка + имя. Раскрытый
 * (interview_008 Q3) — плюс ряд мини-кнопок: видимость / z-вверх / z-вниз / удалить / настройки.
 */
@Composable
private fun LayerItem(
    layer: Layer,
    subtitle: String? = null,   // краткая подпись 2-й строкой (что настроено в слое, напр. источник)
    isTop: Boolean,
    isBottom: Boolean,
    expanded: Boolean,
    selected: Boolean,
    onTap: () -> Unit,
    onToggleVisible: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val isCamera = layer is Layer.VideoCapture
    val shape = RoundedCornerShape(10.dp)
    Surface(
        color = if (expanded) ItemBgExpanded else ItemBg,
        shape = shape,
        modifier = Modifier
            .fillMaxWidth()
            // bug 52 — рамка выбранного слоя: тоньше (1 dp) и полупрозрачная (кислый розовый мягче,
            // не кричит). Выбор всё ещё очевиден, но не бьёт по глазам.
            .then(if (selected) Modifier.border(1.dp, AcidPink.copy(alpha = 0.5f), shape) else Modifier)
            .clickable(onClick = onTap),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 3.dp)) {
            // Верхняя строка: превью/иконка + имя.
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                if (layer is Layer.Image) {
                    Image(
                        bitmap = layer.bitmap.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .size(40.dp, 24.dp)                // 16:9-миниатюра
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF111111)),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.Videocam,
                        contentDescription = null,
                        tint = if (layer.visible) Color.White else Color(0xFF666666),
                    )
                }
                Spacer(Modifier.width(10.dp))
                // Плотная колонка имя+подпись: tight lineHeight, чтобы строки не расползались (правка Криника).
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        layer.name,
                        color = if (layer.visible) Color.White else Color(0xFF888888),
                        fontSize = 14.sp,
                        lineHeight = 15.sp,
                    )
                    // Подпись 2-й строкой: что настроено в слое (мелким серым). Скрыта, если пусто.
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            subtitle,
                            color = SoftPink,
                            fontSize = 11.sp,
                            lineHeight = 12.sp,
                        )
                    }
                }
                // Компактный шеврон-индикатор раскрытия.
                Icon(
                    if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = Color(0xFF888888),
                )
            }

            // Раскрытый пункт — ряд мини-кнопок (interview_008 Q3).
            if (expanded) {
                Spacer(Modifier.height(2.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    // Видимость.
                    IconButton(onClick = onToggleVisible) {
                        Icon(
                            if (layer.visible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                            contentDescription = stringResource(R.string.layer_visibility_desc),
                            tint = if (layer.visible) AcidPink else Color(0xFF888888),
                        )
                    }
                    // Z-порядок: вверх/вниз (interview_008 Q4=B — две стрелки).
                    IconButton(onClick = onMoveUp, enabled = !isTop) {
                        Icon(Icons.Default.KeyboardArrowUp, stringResource(R.string.layer_up_desc),
                            tint = if (isTop) Color(0xFF555555) else Color.White)
                    }
                    IconButton(onClick = onMoveDown, enabled = !isBottom) {
                        Icon(Icons.Default.KeyboardArrowDown, stringResource(R.string.layer_down_desc),
                            tint = if (isBottom) Color(0xFF555555) else Color.White)
                    }
                    Spacer(Modifier.weight(1f))
                    // Настройки (⚙) → модалка per-type.
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, stringResource(R.string.layer_settings_desc), tint = Color.White)
                    }
                    // Удаление — только для НЕ-камеры (камеру-базу в первом заходе не убираем).
                    if (!isCamera) {
                        IconButton(onClick = onRemove) {
                            Icon(Icons.Default.Delete, stringResource(R.string.common_delete), tint = Color(0xFFCC5555))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Модальный диалог детальных настроек слоя (interview_008 Q5). Содержимое зависит от ТИПА слоя (как в
 * OBS): камера → выбор источника; картинка → пока информационно (расширим по мере надобности).
 */
@Composable
private fun LayerSettingsDialog(
    layer: Layer,
    onDismiss: () -> Unit,
    sourceOptions: List<SourceOption>,
    currentSourceId: String?,
    onSelectSource: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        title = { Text(stringResource(R.string.layer_settings_title, layer.name), color = Color.White, fontSize = 17.sp) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                when (layer) {
                    is Layer.VideoCapture -> {
                        Text(stringResource(R.string.layer_source_video), color = Color(0xFF999999), fontSize = 13.sp)
                        Spacer(Modifier.height(8.dp))
                        // Список доступных источников — выбор подсвечивает текущий.
                        sourceOptions.forEach { opt ->
                            val isCurrent = opt.id == currentSourceId
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onSelectSource(opt.id) }
                                    .padding(horizontal = 8.dp, vertical = 10.dp),
                            ) {
                                Icon(
                                    if (isCurrent) Icons.Default.RadioButtonChecked else Icons.Default.RadioButtonUnchecked,
                                    contentDescription = null,
                                    tint = if (isCurrent) AcidPink else Color(0xFF777777),
                                    modifier = Modifier.size(20.dp),
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    opt.label,
                                    color = if (isCurrent) Color.White else Color(0xFFCCCCCC),
                                    fontSize = 14.sp,
                                )
                            }
                        }
                    }
                    is Layer.Image -> {
                        Text(
                            stringResource(R.string.layer_image_settings_hint),
                            color = Color(0xFFAAAAAA), fontSize = 13.sp,
                        )
                    }
                    else -> {
                        Text(stringResource(R.string.layer_settings_hint), color = Color(0xFFAAAAAA), fontSize = 13.sp)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_done), color = AcidPink) }
        },
    )
}
