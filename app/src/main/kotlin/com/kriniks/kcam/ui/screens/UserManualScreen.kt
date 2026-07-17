/**
 * UserManualScreen — встроенное «Пользовательское руководство» (Idea 32 / plans/06).
 *
 * Каркас с оглавлением (TOC) и ТЕЗИСНЫМ наполнением для двух читателей: новичок («как пользоваться»)
 * и прошаренный («как под капотом», раздел 10). Ведётся СОПРОВОДИТЕЛЬНО: развили/переделали фичу —
 * синхронно правим соответствующий раздел (конвенция в AGENT_GUIDE).
 *
 * Локализация (plans/13 S3, СДЕЛАНО): контент в ресурсах um_strings.xml — res/values (EN дефолт)
 * и res/values-ru; здесь — пары id и сшивка. Открывается из Settings.
 *
 * Related: SettingsScreen (кнопка входа), NavGraph (route user_manual), plans/06, ideas/32.
 */

package com.kriniks.kcam.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.R
import kotlinx.coroutines.launch

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
private val DarkBg = Color(0xFF0D0D0D)

/** Один раздел руководства: заголовок + абзацы/тезисы (строки, показываются списком). */
private data class ManualSection(val title: String, val body: List<String>)

// Каркас содержания (plans/06 §4) — тезисно; детализируем по мере развития фич.
// plans/13 S3 — контент руководства живёт в РЕСУРСАХ (res/values*/um_strings.xml, EN дефолт + RU):
// здесь только пары (title, body) для сшивки. Новая секция = пара сюда + строки в ОБА файла ресурсов.
private val manualSectionRes: List<Pair<Int, Int>> = listOf(
    R.string.um_title_1 to R.array.um_body_1,
    R.string.um_title_2 to R.array.um_body_2,
    R.string.um_title_3 to R.array.um_body_3,
    R.string.um_title_4 to R.array.um_body_4,
    R.string.um_title_5 to R.array.um_body_5,
    R.string.um_title_6 to R.array.um_body_6,
    R.string.um_title_7 to R.array.um_body_7,
    R.string.um_title_8 to R.array.um_body_8,
    R.string.um_title_9 to R.array.um_body_9,
    R.string.um_title_10 to R.array.um_body_10,
    R.string.um_title_11 to R.array.um_body_11,
)

/** Секции руководства из ресурсов ТЕКУЩЕЙ локали (composable → живо реагирует на смену языка). */
@Composable
private fun manualSections(): List<ManualSection> = manualSectionRes.map { (title, body) ->
    ManualSection(stringResource(title), stringArrayResource(body).toList())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserManualScreen(onBack: () -> Unit) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val manualSections = manualSections() // из ресурсов текущей локали (plans/13 S3)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.um_screen_title), color = Color.White, fontWeight = FontWeight.Bold) },
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
        // Элемент 0 = шапка+оглавление; далее по одному элементу на раздел (индекс раздела i → item i+1).
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Column {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.um_intro),
                        color = Color(0xFFBBBBBB), fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(14.dp))
                    // Оглавление — тап по пункту прокручивает к разделу.
                    Text(stringResource(R.string.um_toc), color = AcidPink, fontSize = 11.sp,
                        fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                    Spacer(Modifier.height(6.dp))
                    manualSections.forEachIndexed { i, s ->
                        Text(
                            s.title,
                            color = AcidPink, fontSize = 14.sp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { scope.launch { listState.animateScrollToItem(i + 1) } }
                                .padding(vertical = 6.dp),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
            itemsIndexed(manualSections) { _, section ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkSurface),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(section.title, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        section.body.forEach { line ->
                            Row(modifier = Modifier.padding(vertical = 3.dp)) {
                                Text("•  ", color = AcidPink, fontSize = 14.sp)
                                Text(line, color = Color(0xFFCCCCCC), fontSize = 14.sp, lineHeight = 20.sp)
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}
