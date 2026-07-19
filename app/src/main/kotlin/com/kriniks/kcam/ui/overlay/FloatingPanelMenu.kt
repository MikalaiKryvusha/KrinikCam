/**
 * FloatingPanelMenu — ОБЩАЯ панель-меню в стиле StreamLayersOverlay (Криник, 2026-07-19: «всё в список,
 * радиалка сильно грузит»).
 *
 * Прозрачный скрим (тап вовне → закрыть) + компактный вертикальный список, растущий ВВЕРХ от угла
 * [alignment] (низ-лево / низ-право), прижатый к краю экрана; полупрозрачные ряды (сквозь них видно
 * превью); скролл при переполнении. **БЕЗ покадровой анимации** — в отличие от прежней радиалки, не
 * грузит GPU поверх живого TextureView-превью (та лагала именно из-за длинной пружинной анимации веера).
 *
 * Ряды строит каллер слотом [content] — см. [PanelActionRow] (кликабельное действие) и [PanelInfoRow]
 * (некликабельный индикатор). FAB-триггер каллер рисует отдельно (как у панели слоёв).
 *
 * Related: FloatingActionMenu (главное меню), MainScreen (меню сцен), StreamLayersOverlay (слои).
 */

package com.kriniks.kcam.ui.overlay

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Акцент приложения + полупрозрачная подложка ряда (как ItemBg в StreamLayersOverlay).
private val PanelAccent = Color(0xFFFF1A8C)
private val ItemBg = Color(0x66151515)
private val InfoSubtitle = Color(0xFFB0B0B0)

@Composable
fun FloatingPanelMenu(
    onDismiss: () -> Unit,
    alignment: Alignment,
    modifier: Modifier = Modifier,
    // Отступ снизу = место под сам FAB-триггер. Главный FAB (60dp) выше малого FAB слоёв/сцен (40dp),
    // поэтому его меню нужно поднять сильнее — иначе нижний ряд «цепляет» FAB (замечание Криника).
    bottomPadding: Dp = 84.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val isStart = alignment == Alignment.BottomStart || alignment == Alignment.TopStart || alignment == Alignment.CenterStart
    Box(modifier = modifier.fillMaxSize()) {
        // Прозрачный скрим — тап вне списка закрывает (как у панели слоёв).
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                )
        )
        // Список: якорь у угла [alignment], растёт вверх, прижат к краю; ширина по контенту; скролл.
        Column(
            horizontalAlignment = if (isStart) Alignment.Start else Alignment.End,
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .align(alignment)
                // top=40 — под индикатор эфира; bottom — под FAB-триггер (см. [bottomPadding]).
                .padding(start = 12.dp, end = 12.dp, bottom = bottomPadding, top = 40.dp)
                .width(IntrinsicSize.Max)
                .widthIn(max = 340.dp)
                .heightIn(max = 560.dp)
                .verticalScroll(rememberScrollState()),
            content = content,
        )
    }
}

/**
 * PanelActionRow — кликабельный ряд-действие: иконка + подпись. [primary] = залитый акцентом (первичное
 * действие, как «＋ Добавить слой»); иначе — полупрозрачная подложка.
 */
@Composable
fun PanelActionRow(
    icon: ImageVector?,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Color.White,
    accent: Color = PanelAccent,
    primary: Boolean = false,
) {
    Surface(
        color = if (primary) accent else ItemBg,
        shape = RoundedCornerShape(10.dp),
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = if (primary) Color.White else tint, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
            }
            Text(
                label,
                color = Color.White,
                fontSize = 14.sp,
                fontWeight = if (primary) FontWeight.SemiBold else FontWeight.Medium,
            )
        }
    }
}

/** PanelInfoRow — некликабельный индикатор (напр. текущая сцена): подложка как у действия, но без клика. */
@Composable
fun PanelInfoRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
) {
    Surface(color = ItemBg, shape = RoundedCornerShape(10.dp), modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = PanelAccent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
            }
            Column {
                Text(title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                if (subtitle != null) Text(subtitle, color = InfoSubtitle, fontSize = 12.sp)
            }
        }
    }
}
