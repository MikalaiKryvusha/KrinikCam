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

    // Диалог переименования (модальный, поле ввода с текущим именем).
    renameTarget?.let { target ->
        var text by remember(target.id) { mutableStateOf(target.name) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.scenes_rename_title)) },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.scenes_name_label)) },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (text.isNotBlank()) onRename(target.id, text.trim())
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
