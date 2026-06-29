# UI Automation Tool — tools/ui.mjs

Инструмент автоматизации/управления KrinikCam через ADB для ИИ-агента (без скриншотов и угадывания).

**Проблема, которую решает**: загонять приложение в нужное состояние и тестировать его — медленно и
ненадёжно, если кликать по координатам/тумблерам вслепую.

---

## 🧭 ГЛАВНОЕ ПРАВИЛО ДЛЯ ИИ-АГЕНТА (Idea 22) — как пользоваться инструментом

У инструмента ДВА слоя. Выбирай по задаче, СВЕРХУ ВНИЗ:

1. **⭐ ТОЛСТЫЙ слой — `ui.mjs cmd <action>` (debug-broadcast).** Команды уровня НАМЕРЕНИЯ меняют
   состояние приложения ДЕТЕРМИНИРОВАННО, минуя UI-навигацию. **Это предпочтительный способ** «загнать
   приложение в нужное состояние» (90% автономных тестов на харнесе: вирт.камера, запись в файл,
   поворот, оверлей). Надёжно и быстро.
2. **ТОНКИЙ слой — `dump`/`tap`/`swipe`/`longpress`.** Атомарные действия по реальному UI. Используй,
   только когда (а) цель — проверить САМ UI (что кнопка/навигация работают для пользователя), ИЛИ
   (б) толстой команды для нужного действия ещё НЕТ.

**Рабочий цикл (обязательно):** хочешь что-то сделать в приложении →
сначала ищи готовую `cmd`-команду (см. таблицу ниже) → нет её → делаешь тонким уровнем (tap/swipe) →
**после этого ДОРАБОТАЙ инструмент**: добавь новую `cmd`-команду (broadcast-action в `MainActivity`
CMD-receiver + ветку в `ui.mjs cmd`), чтобы в следующий раз это делалось толстым слоем. Документируй
новую команду здесь. Так инструмент со временем становится всё мощнее, а агент тратит меньше усилий.

### `ui.mjs cmd` — толстые debug-команды (через broadcast `com.kriniks.kcam.CMD`, DEBUG-only)

| Команда | Действие |
|---------|----------|
| `cmd virtual-camera on\|off` | вкл/выкл виртуальную дебаг-камеру (тест-паттерн) |
| `cmd stream-to-file on\|off` | режим записи энкодера в MP4 вместо RTMP (harness) |
| `cmd go-live [1080\|2160\|…]` | старт (в harness — запись в файл); arg = высота кадра (16:9) |
| `cmd stop` | остановить запись/стрим |
| `cmd set-rotation 0\|90\|180\|270` | поворот видео (портрет/ландшафт) |
| `cmd add-overlay` | добавить тестовый PNG-оверлей |
| `cmd rotation-mode on\|off` | режим «вращение по ADB» (нужен для `orient`) |

Диспетчер: `registerCmdControl()` в `MainActivity` (только `BuildConfig.DEBUG`). Расширяется новыми
`action` — добавь ветку в `when(action)` там и строку в этой таблице.

Типичный харнес-сценарий (всё толстым слоем, без UI):
```bash
node tools/ui.mjs cmd virtual-camera on
node tools/ui.mjs cmd stream-to-file on
node tools/ui.mjs cmd go-live 1080      # запись в /sdcard/Android/data/<pkg>/files/rec/*.mp4
sleep 6
node tools/ui.mjs cmd stop
# затем adb pull + ffprobe записанного MP4
```

---

## Как работает

1. Запускает `adb shell uiautomator dump` — Android создаёт XML с иерархией UI
2. Скачивает XML на Mac и парсит все `<node>` элементы
3. Берёт атрибуты `bounds="[x1,y1][x2,y2]"` и вычисляет центр каждого элемента
4. Матчит по `text`, `content-desc`, `resource-id` (case-insensitive, partial)
5. Отправляет `adb shell input tap x y` в нужную точку

---

## Установка

Ничего не нужно устанавливать. Всё уже есть — Node.js + ADB.

```bash
# Проверить, что ADB видит устройство
adb devices

# Если устройство по WiFi (как у нас)
adb connect 192.168.1.3:5555
```

---

## Команды

```bash
# Показать все интерактивные элементы на экране (текст, координаты, clickable)
node tools/ui.mjs dump

# Найти элемент по тексту / content-desc / resource-id
node tools/ui.mjs find <query>

# Найти и тапнуть первый совпадающий элемент
node tools/ui.mjs tap <query>

# Показать все совпадения и тапнуть первое
node tools/ui.mjs tap-all <query>

# Распечатать сырой UIAutomator XML (полезно для дебага)
node tools/ui.mjs dump-xml
```

---

## Примеры

```bash
# Посмотреть что сейчас на экране
node tools/ui.mjs dump

# Открыть меню (FAB)
node tools/ui.mjs tap "menu"

# Нажать Go Live
node tools/ui.mjs tap "go live"

# Проверить, есть ли кнопка настроек
node tools/ui.mjs find "settings"

# Выбрать платформу YouTube
node tools/ui.mjs tap "youtube"
```

---

## Переменная ADB_DEVICE

По умолчанию берётся первое устройство из `adb devices`.
Можно явно задать:

```bash
ADB_DEVICE=192.168.1.3:5555 node tools/ui.mjs dump
```

---

## Формат вывода dump

```
[0]   center=(1438,2374)  bounds=[1352,2329][1523,2419]  clickable
  desc="Menu"
  class: android.widget.ImageView

[1]   center=(1265,1816)  bounds=[1205,1780][1324,1852]  clickable focusable
  text="Go Live"
  class: android.widget.TextView
```

- `center=(x,y)` — координаты для `adb shell input tap`
- `bounds=[x1,y1][x2,y2]` — границы элемента
- `clickable`, `focusable`, `DISABLED`, `checked` — флаги состояния
- `text`, `desc`, `id` — атрибуты для поиска

---

## Workflow для тестирования

```bash
# 1. Что на экране прямо сейчас?
node tools/ui.mjs dump

# 2. Нажать FAB-меню
node tools/ui.mjs tap "menu"
sleep 1

# 3. Что появилось? (радиальное меню)
node tools/ui.mjs dump

# 4. Нажать Go Live
node tools/ui.mjs tap "go live"
sleep 2

# 5. Сразу смотреть логи
adb -s 192.168.1.3:5555 pull /sdcard/Android/data/com.kriniks.kcam.debug/files/logs/kcam_$(date +%Y-%m-%d).log /tmp/kcam_fresh.log
grep -E "startStream|RTMP|Broken|blocked|stream setup" /tmp/kcam_fresh.log | tail -30
```

---

## Полный тест-сценарий "Go Live"

```bash
# Убедиться что приложение на переднем плане
adb -s 192.168.1.3:5555 shell am start -n com.kriniks.kcam.debug/com.kriniks.kcam.MainActivity

sleep 3

# Открыть радиальное меню
node tools/ui.mjs tap "menu"
sleep 1.5

# Нажать Go Live
node tools/ui.mjs tap "go live"
sleep 1

# Смотреть что выбрали платформу (может появиться overlay платформ)
node tools/ui.mjs dump
# Если появился список платформ — тапнуть YouTube
node tools/ui.mjs tap "youtube" 2>/dev/null || true
sleep 1

# Тапнуть финальную кнопку "Go Live" в диалоге подтверждения
node tools/ui.mjs tap "go live"
```

---

## Важные координаты (Headwolf Titan1, 1600×2560)

| Элемент | Центр | Примечание |
|---------|-------|------------|
| FAB Menu | (1438, 2374) | Всегда в правом нижнем углу |
| Go Live (TextView) | (1265, 1816) | В радиальном меню |
| Go Live (View/Icon) | (1456, 1816) | Кликабельная область |

> Эти координаты специфичны для данного устройства. При смене устройства — делать `dump` заново.

---

## Troubleshooting

**Элемент не найден:**
```bash
node tools/ui.mjs dump-xml  # смотреть сырой XML
node tools/ui.mjs dump      # смотреть все элементы
# Искать по другому атрибуту или уточнить запрос
```

**Тап не срабатывает:**
- Элемент может быть перекрыт другим view
- Проверить флаг `clickable` в выводе `dump`
- Попробовать `tap-all` чтобы увидеть все варианты

**ADB не видит устройство:**
```bash
adb connect 192.168.1.3:5555
adb devices
```

---

## Системные диалоги, скриншоты, освобождение камеры (2026-06-28)

Эти команды позволяют ИИ-агенту тестировать автономно, не зовя Криника к устройству.

### `allow` — сам одобрить системный диалог разрешений
Диалоги CAMERA / микрофон / USB рисуются СИСТЕМОЙ (`permissioncontroller` / `systemui`), а не
приложением — внутри-аппный tap до них не дотянется. `allow` находит такой диалог и жмёт
позитивную кнопку. Кнопки ищутся по `resource-id` (не зависит от языка — работает и на русском
диалоге), с текстовым фолбэком RU/EN.

```bash
node tools/ui.mjs allow          # одобрить (предпочтёт «При использовании» — постоянный грант)
node tools/ui.mjs allow --once   # предпочесть «Только в этот раз»
```
- Обрабатывает цепочку диалогов (camera → mic → USB) в цикле.
- Если есть чекбокс «использовать по умолчанию для USB» — ставит его (меньше повторных запросов).
- Триггернуть диалог CAMERA для теста: `adb shell pm revoke com.kriniks.kcam.debug android.permission.CAMERA` → перезапустить.

### `kill` / `start` / `restart` — освобождение камеры между сборками
USB-камеру держит та сборка, что открыла её первой. Чтобы передать камеру другой сборке:
```bash
node tools/ui.mjs kill both       # force-stop обеих сборок → камера свободна
node tools/ui.mjs kill release    # только release (или debug)
node tools/ui.mjs start debug     # запустить (по умолчанию debug)
node tools/ui.mjs restart release # force-stop + запуск
```

### `screen` — скриншот в сжатый JPEG
Полное разрешение, качество 80, через библиотеку `sharp` — лёгкий файл для анализа ИИ
(2.9 МБ PNG → ~0.4 МБ JPEG). `adb.mjs screen` теперь тоже отдаёт JPEG.
```bash
node tools/ui.mjs screen                 # → tools/screenshots/adb_screen.jpg (папка gitignored)
node tools/ui.mjs screen tools/x.jpg
```

### Надёжность дампа на анимированных экранах (Bug 07)

`uiautomator dump` падает («could not get idle state»), если на экране непрерывная анимация
(напр. пульс логотипа в standby-экране — Compose infinite animation). `dumpUi()` это лечит сам:
удаляет старый дамп (чтобы не вернуть устаревший), при провале **временно** выключает системные
анимации (`animator_duration_scale=0`, Compose их уважает), повторяет, и **восстанавливает прежнее
состояние анимаций при выходе** (устройство остаётся «как было»). Ручное управление:
```bash
node tools/ui.mjs anim off   # выключить анимации (не авто-восстанавливается)
node tools/ui.mjs anim on    # вернуть анимации
```
⚠️ Приложение `fullSensor` — крутится за устройством. Координаты из `dump` валидны только для
ориентации на момент дампа (в выводе печатается `📐 screen WxH · portrait/landscape`). Поэтому
используй **атомарный** `ui.mjs tap <query>` (dump+tap в одном вызове), не переноси координаты
между отдельными вызовами, и держи устройство неподвижно во время автотестов.

---

## Исходный код

[tools/ui.mjs](ui.mjs) — JS, зависимость: `sharp` (сжатие скриншотов, в `tools/package.json`).
