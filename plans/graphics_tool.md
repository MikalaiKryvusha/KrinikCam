# KrinikCam — AI Vector Graphics Tool

## Цель

Дать AI-агенту возможность генерировать графику для проекта: SVG-код пишется агентом напрямую, затем консольный инструмент рендерит его в растр (PNG) нужного размера. Никаких внешних AI-сервисов — агент сам знает SVG.

## Принцип работы

```
AI агент пишет SVG
       ↓
 assets/graphics/src/name.svg
       ↓  (node tools/graphics/render.mjs)
 assets/graphics/out/name_WxH.png
       ↓  (при необходимости)
 app/src/main/res/drawable*/ic_*.png
```

## Когда использовать

- App icon (ic_launcher: 48/72/96/144/192 px)
- "Please stand by" placeholder bitmap (потоковая заглушка)
- Notification icon
- Splash screen
- Любая другая графика для приложения

## Файловая структура

```
tools/
  graphics/
    render.mjs        ← CLI рендерер SVG → PNG
    batch.mjs         ← пакетный рендер (один SVG → много размеров)
    README.md         ← инструкция для AI агента

assets/
  graphics/
    src/              ← SVG-исходники (хранятся в git)
    out/              ← PNG результаты (можно в .gitignore)
```

## CLI

```bash
# Один файл
node tools/graphics/render.mjs \
  --input  assets/graphics/src/ic_launcher.svg \
  --output assets/graphics/out/ic_launcher_192.png \
  --width  192 --height 192

# Пакетный рендер для всех Android dpi
node tools/graphics/batch.mjs \
  --input assets/graphics/src/ic_launcher.svg \
  --name  ic_launcher \
  --sizes 48,72,96,144,192
```

## Зависимость

`@resvg/resvg-js` — Rust/WASM рендерер SVG, работает без системных зависимостей (не нужен браузер или librsvg).

## Инструкция для AI агента: как рисовать

### Шаг 1 — написать SVG
Создай файл `assets/graphics/src/<name>.svg`. SVG должен иметь чёткий `viewBox`, все координаты нормализованы.

Пример шаблона:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- рисунок здесь -->
</svg>
```

Советы для агента:
- Используй `viewBox="0 0 100 100"` — удобные координаты
- Для иконок используй `width="100%" height="100%"` в SVG
- Текст: `font-family="monospace"` — безопасный шрифт без внешних зависимостей
- Цвет бренда: `#FF1A8C` (acid pink), чёрный фон: `#000000`
- Градиенты через `<linearGradient>` / `<radialGradient>` в `<defs>`
- Не используй внешние шрифты и изображения (`xlink:href` на внешние URL)

### Шаг 2 — отрендерить
```bash
cd tools && npm install   # один раз
node tools/graphics/render.mjs --input assets/graphics/src/<name>.svg \
  --output assets/graphics/out/<name>.png --width 512 --height 512
```

### Шаг 3 — скопировать в Android res
Для иконок — через batch.mjs с флагом `--android`:
```bash
node tools/graphics/batch.mjs --input assets/graphics/src/ic_launcher.svg \
  --name ic_launcher --android
```
Это раскладывает PNG по `app/src/main/res/mipmap-*/`.

## Примеры графики для KrinikCam

| Файл | Размеры | Назначение |
|------|---------|------------|
| `ic_launcher.svg` | 48/72/96/144/192 px | App icon |
| `standby.svg` | 1920×1080 px | "Please stand by" RTMP заглушка |
| `ic_notification.svg` | 24 dp → mdpi/hdpi/xhdpi | Статус-бар иконка |
| `splash.svg` | match_parent | Заставка при запуске |

## Связанные файлы

- `tools/graphics/render.mjs` — рендерер
- `tools/graphics/batch.mjs` — пакетный рендер
- `app/src/main/kotlin/.../ui/overlay/StandbyPlaceholder.kt` — использует standby bitmap
- `tools/package.json` — зависимость `@resvg/resvg-js`
