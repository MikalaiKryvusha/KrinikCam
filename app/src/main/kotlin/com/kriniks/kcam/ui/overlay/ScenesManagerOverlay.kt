/**
 * ScenesManagerOverlay — панель-менеджер НАБОРА именованных сцен (idea 40 / plans/18 Фаза 1).
 *
 * Стиль — панель-список (FloatingPanelMenu, от левого края, растёт вверх), как решил Криник в
 * interview_010 (НЕ радиалка). Возможности: список сцен (тап по имени = переключить активную, активная
 * подсвечена), per-строке иконки «Переименовать / Дублировать / Удалить», внизу первичное «＋ Новая сцена».
 * Переименование — модальный диалог (имя новой сцены даёт репозиторий: «Сцена N»); удаление — подтверждение.
 *
 * Данные/операции приходят колбэками (ViewModel → StreamingRepository → RtmpStreamer → SceneProfileRepository).
 * Related: MainScreen (монтирует), FloatingPanelMenu (шаблон панели), SceneProfileMeta.
 *
 * [NOT-TESTED] — свежий UI; проверяется живыми тапами на устройстве (Фаза 1 приёмка).
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.R
import com.kriniks.kcam.feature.streaming.scene.SceneProfileMeta
// plans/18 Ф2 — тип перехода сцены (модалка редактирования).
import com.kriniks.kcam.feature.streaming.scene.SceneTransition

// Пресеты длительности перехода: быстрый / средний / плавный. Ручной ввод не нужен — Криник выбирает
// тапом, а границы всё равно зажимает репозиторий (SCENE_TRANSITION_MIN/MAX_MS).
private val DURATION_PRESETS_MS = listOf(200, 400, 800, 1500)

/** Подпись типа перехода в UI. Локализованные строки — в strings.xml (EN/RU). */
@Composable
private fun transitionLabel(t: SceneTransition): String = stringResource(
    when (t) {
        SceneTransition.NONE -> R.string.scenes_transition_none
        SceneTransition.FADE -> R.string.scenes_transition_fade
        SceneTransition.SLIDE -> R.string.scenes_transition_slide
    }
)

/**
 * Криник 2026-07-26: ВЫБРАННЫЙ пункт диалога — брендовый кислотный розовый (дефолтный M3-чип красил
 * выбор бледно-серым и выпадал из стиля приложения). Невыбранный остаётся тёмным-прозрачным.
 * [TESTED: 2026-07-26 · скриншот модалки на планшете: выбранные «Плавно» и «0,4 с» — кислотный розовый,
 *  невыбранные с приглушённой розовой обводкой]
 */
@Composable
private fun scenesChipColors() = FilterChipDefaults.filterChipColors(
    containerColor = Color(0x66151515),
    labelColor = Color(0xCCFFFFFF),
    selectedContainerColor = Color(0xFFFF1A8C),
    selectedLabelColor = Color.White,
)

/** Обводка чипа: у выбранного её нет (заливка сама акцент), у невыбранного — приглушённая. */
@Composable
private fun scenesChipBorder(selected: Boolean) =
    if (selected) null
    else androidx.compose.foundation.BorderStroke(1.dp, Color(0x33FF1A8C))

private val ScenesAccent = Color(0xFFFF1A8C)
private val ScenesItemBg = Color(0x66151515)
private val ScenesActiveBg = Color(0x33FF1A8C)   // активная сцена — лёгкая акцентная подложка

@Composable
fun ScenesManagerOverlay(
    scenes: List<SceneProfileMeta>,
    activeSceneId: Long?,
    onSwitch: (Long) -> Unit,
    onNew: () -> Unit,
    onDuplicate: (Long) -> Unit,
    onRename: (Long, String) -> Unit,
    // plans/18 Ф2 (Криник) — сохранить ПЕРЕХОД сцены: тип эффекта + длительность (модалка редактирования).
    onSetTransition: (Long, SceneTransition, Int) -> Unit,
    onDelete: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    // Локальный UI-стейт панели: какую сцену переименовываем / удаляем (null = диалога нет).
    var renameTarget by remember { mutableStateOf<SceneProfileMeta?>(null) }
    var deleteTarget by remember { mutableStateOf<SceneProfileMeta?>(null) }

    FloatingPanelMenu(
        onDismiss = onDismiss,
        alignment = Alignment.BottomStart,
        modifier = Modifier.fillMaxSize(),
    ) {
        // Заголовок панели.
        PanelInfoRow(title = stringResource(R.string.scenes_title), icon = Icons.Default.Movie)

        // Список сцен (тап по строке = переключить; активная подсвечена; трейлинг-иконки — действия).
        scenes.forEach { s ->
            SceneRow(
                scene = s,
                active = s.id == activeSceneId,
                onSwitch = { onSwitch(s.id) },
                onRename = { renameTarget = s },
                onDuplicate = { onDuplicate(s.id) },
                onDelete = { deleteTarget = s },
            )
        }

        // Первичное действие: новая сцена (репозиторий даст имя «Сцена N»).
        PanelActionRow(
            icon = Icons.Default.Add,
            label = stringResource(R.string.scenes_new),
            onClick = onNew,
            primary = true,
        )
    }

    // Модалка РЕДАКТИРОВАНИЯ сцены (Криник, plans/18 Ф2): имя + ПЕРЕХОД (тип эффекта и его
    // длительность). Переход принадлежит сцене, на которую переключаются — как в OBS.
    renameTarget?.let { target ->
        var text by remember(target.id) { mutableStateOf(target.name) }
        var transition by remember(target.id) { mutableStateOf(target.transition) }
        var durationMs by remember(target.id) { mutableIntStateOf(target.transitionDurationMs) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.scenes_edit_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        singleLine = true,
                        label = { Text(stringResource(R.string.scenes_name_label)) },
                    )
                    // Тип перехода — три чипа в ряд (без дропдауна: вариантов мало, тап в один шаг).
                    Text(
                        stringResource(R.string.scenes_transition_label),
                        color = Color(0xCCFFFFFF), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SceneTransition.entries.forEach { t ->
                            FilterChip(
                                selected = transition == t,
                                onClick = { transition = t },
                                label = { Text(transitionLabel(t), fontSize = 12.sp) },
                                colors = scenesChipColors(),
                                border = scenesChipBorder(transition == t),
                            )
                        }
                    }
                    // Длительность — пресеты в секундах; для NONE неактуальна (эффекта нет).
                    Text(
                        stringResource(R.string.scenes_transition_duration_label),
                        color = Color(0xCCFFFFFF), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DURATION_PRESETS_MS.forEach { ms ->
                            FilterChip(
                                selected = durationMs == ms,
                                onClick = { durationMs = ms },
                                enabled = transition != SceneTransition.NONE,
                                // bug 65 Ш4 — суффикс единицы был вшит по-русски прямо здесь, поэтому
                                // на английском интерфейсе чип всё равно писал «с». Теперь ресурс.
                                // [NOT-TESTED] — сборка зелёная и ресурс есть в values/ и values-ru/,
                                //   но САМ чип глазами не проверен: он доступен только при выбранном
                                //   переходе (enabled ниже), а до этой ветки UI дойти не успели.
                                //   Проверять: Сцены → выбрать переход → чипы длительности; на ru_RU
                                //   ожидается «0,5 с», при английском языке приложения — «0.5 s».
                                label = { Text(stringResource(R.string.duration_seconds_fmt, ms / 1000f), fontSize = 12.sp) },
                                colors = scenesChipColors(),
                                border = scenesChipBorder(durationMs == ms),
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (text.isNotBlank() && text.trim() != target.name) onRename(target.id, text.trim())
                    if (transition != target.transition || durationMs != target.transitionDurationMs)
                        onSetTransition(target.id, transition, durationMs)
                    renameTarget = null
                }) { Text(stringResource(R.string.scenes_save)) }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) { Text(stringResource(R.string.scenes_cancel)) }
            },
        )
    }

    // Подтверждение удаления (защита от случайной потери сцены).
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.scenes_delete_title)) },
            text = { Text(stringResource(R.string.scenes_delete_confirm, target.name)) },
            confirmButton = {
                TextButton(onClick = {
                    onDelete(target.id)
                    deleteTarget = null
                }) { Text(stringResource(R.string.scenes_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text(stringResource(R.string.scenes_cancel)) }
            },
        )
    }
}

/** Ряд одной сцены: имя (тап = переключить, активная подсвечена) + иконки-действия. */
@Composable
private fun SceneRow(
    scene: SceneProfileMeta,
    active: Boolean,
    onSwitch: () -> Unit,
    onRename: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        color = if (active) ScenesActiveBg else ScenesItemBg,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        ) {
            // Имя сцены — тап по этой области переключает активную сцену.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onSwitch)
                    .padding(vertical = 7.dp),
            ) {
                Icon(
                    Icons.Default.Movie,
                    contentDescription = null,
                    tint = if (active) ScenesAccent else Color.White,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    scene.name,
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                )
            }
            // Действия над сценой.
            IconButton(onClick = onRename, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.scenes_rename), tint = Color.White, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = onDuplicate, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.ContentCopy, contentDescription = stringResource(R.string.scenes_duplicate), tint = Color.White, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.scenes_delete), tint = Color(0xFFFF8080), modifier = Modifier.size(18.dp))
            }
        }
    }
}
