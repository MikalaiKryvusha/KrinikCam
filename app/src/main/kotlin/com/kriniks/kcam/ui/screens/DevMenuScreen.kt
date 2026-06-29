/**
 * DevMenuScreen — «Для разработчиков» (Idea 07).
 *
 * Скрытый экран: открывается ЛОНГ-ТАПОМ по строке «KrinikCam» в Settings → About. Доступен в ЛЮБОЙ
 * сборке (debug и release) — кто знает про лонг-тап, тот найдёт; остальные не догадаются. Сюда
 * выносим весь отладочный/разработческий функционал, чтобы release и debug не отличались «магией».
 *
 * Каждая опция — тумблер в стиле приложения + кнопка [i] с описанием, что она делает.
 * Первый пункт: «Вращение по ADB» (вкл → app слушает ADB-команды поворота вместо физ-датчика).
 *
 * Related: DevSettings (персист), MainActivity (применяет adbRotation), SettingsScreen (вход), NavGraph
 */

package com.kriniks.kcam.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.dev.DevSettings

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
private val DarkBg = Color(0xFF0D0D0D)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevMenuScreen(
    onBack: () -> Unit,
    onAdbRotationChanged: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    // Read current persisted value once; toggles write back to DevSettings + apply live.
    var adbRotation by remember { mutableStateOf(DevSettings.isAdbRotation(context)) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Developer", color = Color.White, fontWeight = FontWeight.Bold) },
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
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Скрытое меню для отладки. Доступно во всех сборках. Опции применяются сразу.",
                color = Color(0xFF888888), fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
            )

            DevSection(title = "Orientation") {
                DevToggleRow(
                    title = "Вращение по ADB",
                    info = "Когда включено, приложение перестаёт следовать физическому датчику " +
                        "поворота и слушает ADB-команды ориентации (ui.mjs orient). Удобно для " +
                        "автономного тестирования ориентаций без физического поворота устройства. " +
                        "Выключено — обычное поведение: поворот по датчику.",
                    checked = adbRotation,
                    onCheckedChange = {
                        adbRotation = it
                        DevSettings.setAdbRotation(context, it) // персист
                        onAdbRotationChanged(it)                // применить в MainActivity сразу
                    },
                )
            }
        }
    }
}

@Composable
private fun DevSection(title: String, content: @Composable ColumnScope.() -> Unit) {
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
            shape = RoundedCornerShape(10.dp),
        ) { Column { content() } }
    }
}

/** Один dev-тумблер: заголовок + кнопка [i] (описание в диалоге) + Switch. */
@Composable
private fun DevToggleRow(
    title: String,
    info: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    var showInfo by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f))
        IconButton(onClick = { showInfo = true }, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Default.Info, contentDescription = "Info", tint = Color(0xFF888888))
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = AcidPink,
            ),
        )
    }
    if (showInfo) {
        AlertDialog(
            onDismissRequest = { showInfo = false },
            containerColor = DarkSurface,
            title = { Text(title, color = Color.White, fontWeight = FontWeight.Bold) },
            text = { Text(info, color = Color(0xFFBBBBBB), fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = { showInfo = false }) { Text("OK", color = AcidPink) }
            },
        )
    }
}
