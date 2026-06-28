# UI Automation Tool — tools/ui.mjs

Инструмент для автоматизации тестирования KrinikCam через ADB без скриншотов.

**Проблема, которую решает**: снимать скриншоты и угадывать координаты — медленно и ненадёжно.
Этот инструмент читает DOM структуру экрана напрямую и вычисляет точные координаты элементов.

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

## Исходный код

[tools/ui.mjs](ui.mjs) — ~250 строк JS, без зависимостей.
