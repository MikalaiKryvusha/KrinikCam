/**
 * UserManualScreen — встроенное «Пользовательское руководство» (Idea 32 / plans/06).
 *
 * Каркас с оглавлением (TOC) и ТЕЗИСНЫМ наполнением для двух читателей: новичок («как пользоваться»)
 * и прошаренный («как под капотом», раздел 10). Ведётся СОПРОВОДИТЕЛЬНО: развили/переделали фичу —
 * синхронно правим соответствующий раздел (конвенция в AGENT_GUIDE).
 *
 * Локализация (на будущее): тексты пока inline на русском (первый заход — один язык, plans/06 S3).
 * Позже вынести [manualSections] в строковые ресурсы / модель под перевод. Открывается из Settings.
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private val AcidPink = Color(0xFFFF1A8C)
private val DarkSurface = Color(0xFF1A1A1A)
private val DarkBg = Color(0xFF0D0D0D)

/** Один раздел руководства: заголовок + абзацы/тезисы (строки, показываются списком). */
private data class ManualSection(val title: String, val body: List<String>)

// Каркас содержания (plans/06 §4) — тезисно; детализируем по мере развития фич.
private val manualSections: List<ManualSection> = listOf(
    ManualSection(
        "1. Что такое KrinikCam",
        listOf(
            "Мобильный OBS: превращает планшет/телефон в студию для прямых трансляций.",
            "Камеры и другие источники — это СЛОИ, которые накладываются друг на друга и собираются в один кадр.",
            "Готовый кадр идёт в эфир на YouTube/Twitch и др., одновременно виден в превью.",
        ),
    ),
    ManualSection(
        "2. Быстрый старт",
        listOf(
            "Подключи USB-вебку через OTG-переходник — или выбери встроенную камеру устройства.",
            "Открой панель «Слои» (кнопка внизу-слева) → у слоя «Устройство захвата видео» выбери источник.",
            "Проверь картинку в превью, при нужде поверни холст (кнопка справа-сверху) и жми «В эфир».",
        ),
    ),
    ManualSection(
        "3. Источники видео",
        listOf(
            "Один тип слоя «Устройство захвата видео» — для ВСЕХ камер.",
            "Конкретное устройство выбирается в свойствах слоя: любая встроенная камера ОС (селфи/основная/ширик…), UVC-вебка, виртуальная (для теста) или «нет источника».",
            "Можно добавить несколько таких слоёв (напр. вебка + селфи в углу).",
        ),
    ),
    ManualSection(
        "4. Слои и сцена",
        listOf(
            "Слой — один источник в кадре (камера, картинка; позже — видео, текст, браузер).",
            "Порядок в списке = порядок наложения: верхний рисуется поверх остальных.",
            "У каждого слоя: видимость («глаз»), позиция/размер/поворот (трансформа), удаление.",
            "Панель «Слои»: список + «+ Добавить слой»; удаление — через подтверждение.",
        ),
    ),
    ManualSection(
        "5. Жесты слоёв (компоновка пальцами)",
        listOf(
            "Тап по слою на превью (или по строке в панели) — выбрать; вокруг слоя появляется рамка.",
            "Один палец — перетащить; щипок двумя пальцами — масштаб; два пальца крутить — поворот (вокруг точки между пальцами).",
            "Снап: слой мягко прилипает к центру холста, краям и углам, кратным 90°; показываются направляющие + лёгкая вибрация. Двинь сильнее — сорвётся со снапа.",
            "Долгий тап по слою — меню: на весь экран / дублировать / удалить.",
        ),
    ),
    ManualSection(
        "6. Поворот",
        listOf(
            "Поворот ХОЛСТА (кнопка справа-сверху): 0/90/180/270 — весь кадр, портрет или пейзаж на выходе.",
            "Поворот СОДЕРЖИМОГО слоя (жестом) — как в фоторедакторе, отдельно от холста.",
            "Физические камеры отдают «сырой» кадр; повороты делает KrinikCam, а не камера.",
        ),
    ),
    ManualSection(
        "7. Запись и эфир",
        listOf(
            "«В эфир» — трансляция на выбранную платформу по RTMP.",
            "Есть режим записи в файл (для теста без интернета).",
            "Разрешение выхода — 1080p/2160p; смена разрешения на лету во время эфира заблокирована.",
        ),
    ),
    ManualSection(
        "8. Платформы",
        listOf(
            "Профиль платформы = URL + ключ трансляции; профили сохраняются и переключаются.",
            "Можно экспортировать/импортировать профили (свой бэкап конфигурации).",
            "Мультистрим (несколько платформ разом) — по этой же модели профилей.",
        ),
    ),
    ManualSection(
        "9. Настройки и меню разработчика",
        listOf(
            "Настройки: платформы, разрешения (камера/микрофон), это руководство, «О приложении».",
            "Скрытое меню «Для разработчиков» — долгий тап по строке «KrinikCam» в «О приложении».",
            "Там: виртуальная камера (тест без железа), диагностика, шаринг лог-файла.",
        ),
    ),
    ManualSection(
        "10. Как это работает под капотом",
        listOf(
            "КОМПОЗИТОР (OpenGL ES) — единственный видеопайплайн. Собирает итоговый кадр из слоёв снизу вверх, каждый слой рисуется квадом с трансформой (позиция/масштаб/поворот/прозрачность).",
            "Двухпроходный рендер (FBO): камера в фиксированном 16:9-буфере; поворот холста — финальный блит, поэтому камера аспект-корректна на всех углах.",
            "Потоки данных: UVC-камера (библиотека AndroidUSBCamera) и встроенная (Camera2) отдают кадры в OES-текстуру слоя → композитор → энкодер (RootEncoder) → RTMP + зеркало в превью. Звук — микрофон устройства.",
            "Тип слоя определяет РЕНДЕР (все камеры рисуются одинаково), а конкретное устройство — лишь способ добычи кадров. Поэтому камеры = один тип слоя с выбором источника.",
        ),
    ),
    ManualSection(
        "11. Нюансы и FAQ",
        listOf(
            "Некоторые USB-вебки капризны в негоциации размера (напр. 2K-модель отдаёт высокое разрешение только в MJPEG) — выбирай поддерживаемый режим.",
            "Встроенные камеры могут иметь иной аспект — возможен лёгкий подгон кадра.",
            "USB-камера подключается через OTG; при первом подключении ОС спросит разрешение на доступ.",
        ),
    ),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserManualScreen(onBack: () -> Unit) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Руководство", color = Color.White, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Назад", tint = Color.White)
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
                        "Пользовательское руководство KrinikCam — как пользоваться и как оно устроено. " +
                            "Раздел «Как это работает под капотом» — для любознательных.",
                        color = Color(0xFFBBBBBB), fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(14.dp))
                    // Оглавление — тап по пункту прокручивает к разделу.
                    Text("ОГЛАВЛЕНИЕ", color = AcidPink, fontSize = 11.sp,
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
