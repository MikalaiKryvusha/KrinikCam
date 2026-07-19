/**
 * FloatingActionMenu — главное меню действий (низ-право). Раньше было радиальным веером
 * (FloatingRadialMenu); переведено в ПАНЕЛЬ-СПИСОК (Криник, 2026-07-19: «всё в список, радиалка сильно
 * грузит»). Тот же FAB-триггер (розовый круг +/✕, LIVE-бейдж в эфире), но по тапу разворачивается
 * список действий в стиле панели слоёв (общий [FloatingPanelMenu]) — без покадровой анимации веера,
 * которая лагала поверх живого TextureView-превью.
 *
 * Действия: Go Live / Stop (первичное, залито акцентом) · Запись · Фото · Платформы · Профиль кодера ·
 * Настройки. FAB остаётся внизу-справа, список растёт вверх от него.
 *
 * Related: FloatingPanelMenu, StreamState, StreamPlatformsOverlay, MainScreen
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.R
import com.kriniks.kcam.feature.streaming.model.StreamState
import com.kriniks.kcam.feature.streaming.model.isLive

private val AcidPink = Color(0xFFFF1A8C)
private val LiveRed = Color(0xFFFF1A1A)

@Composable
fun FloatingActionMenu(
    streamState: StreamState,
    onStartStream: () -> Unit,
    onStopStream: () -> Unit,
    onOpenPlatforms: () -> Unit,
    onOpenSettings: () -> Unit,
    // idea 17 — юзер-фичи записи/фото (механика готова, это UI-обвязка).
    onRecord: () -> Unit = {},
    onPhoto: () -> Unit = {},
    // Криник — вход в менеджер профилей кодера (один из трёх путей).
    onOpenEncoderProfiles: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    // Внешний Box на весь экран (каллер даёт fillMaxSize): под скрим панели и якорь FAB внизу-справа.
    Box(modifier = modifier) {

        // Список действий (только когда раскрыто) — растёт вверх от FAB, низ-право. Главный FAB крупный
        // (60dp) → поднимаем меню выше (bottomPadding), чтобы нижний ряд не цеплял FAB (Криник).
        if (expanded) {
            FloatingPanelMenu(onDismiss = { expanded = false }, alignment = Alignment.BottomEnd, bottomPadding = 108.dp) {
                if (streamState.isLive) {
                    PanelActionRow(
                        Icons.Default.StopCircle, stringResource(R.string.fab_stop),
                        onClick = { onStopStream(); expanded = false }, accent = LiveRed, primary = true,
                    )
                } else {
                    PanelActionRow(
                        Icons.Default.RadioButtonChecked, stringResource(R.string.fab_go_live),
                        onClick = { onStartStream(); expanded = false }, accent = AcidPink, primary = true,
                    )
                    // idea 17 — запись доступна вне эфира.
                    PanelActionRow(
                        Icons.Default.FiberManualRecord, stringResource(R.string.fab_record),
                        onClick = { onRecord(); expanded = false }, tint = LiveRed,
                    )
                }
                // idea 17 — фото композита (и в эфире).
                PanelActionRow(Icons.Default.PhotoCamera, stringResource(R.string.fab_photo),
                    onClick = { onPhoto(); expanded = false })
                PanelActionRow(Icons.Default.Wifi, stringResource(R.string.fab_platforms),
                    onClick = { onOpenPlatforms(); expanded = false })
                PanelActionRow(Icons.Default.Memory, stringResource(R.string.fab_encoder),
                    onClick = { onOpenEncoderProfiles(); expanded = false })
                PanelActionRow(Icons.Default.Settings, stringResource(R.string.fab_settings),
                    onClick = { onOpenSettings(); expanded = false })
            }
        }

        // Главный FAB — всегда виден, внизу-справа, ПОВЕРХ скрима (тап по нему = свернуть/развернуть).
        val fabColor = if (streamState.isLive) LiveRed else AcidPink
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 32.dp, end = 24.dp),
        ) {
            FloatingActionButton(
                onClick = { expanded = !expanded },
                containerColor = fabColor,
                contentColor = Color.White,
                shape = CircleShape,
                modifier = Modifier.size(60.dp),
            ) {
                if (streamState.isLive && !expanded) {
                    // LIVE-бейдж вместо иконки в эфире.
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
                    Icon(
                        if (expanded) Icons.Default.Close else Icons.Default.Add,
                        contentDescription = stringResource(R.string.fab_menu_desc),
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
        }
    }
}
