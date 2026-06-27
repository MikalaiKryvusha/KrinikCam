# KrinikCam Graphics Tool

AI-агент пишет SVG-код → консоль рендерит в PNG.

## Быстрый старт

```bash
cd tools && npm install          # один раз
node graphics/render.mjs \
  --input  ../../assets/graphics/src/ic_launcher.svg \
  --output ../../assets/graphics/out/ic_launcher_192.png \
  --width  192
```

## Команды

| Команда | Что делает |
|---------|------------|
| `node graphics/render.mjs --input X --output Y --width N` | SVG → PNG заданного размера |
| `node graphics/batch.mjs --input X --name N --sizes 48,72,96` | SVG → несколько PNG |
| `node graphics/batch.mjs --input X --name N --android` | SVG → все Android mipmap-* размеры |

Или через npm scripts из `tools/`:
```bash
npm run draw -- --input ../../assets/... --output ../../assets/... --width 192
npm run draw:batch -- --input ../../assets/... --name ic_launcher --android
```

## Инструкция для AI агента

### 1. Написать SVG

Создай `assets/graphics/src/<name>.svg`. Шаблон:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">

  <defs>
    <!-- градиенты, маски, clipPath -->
  </defs>

  <!-- фон -->
  <rect width="100" height="100" fill="#000000" rx="18"/>

  <!-- контент -->

</svg>
```

**Правила SVG:**
- `viewBox="0 0 100 100"` — удобные координаты 0–100
- Только встроенные шрифты: `font-family="monospace"` или `font-family="sans-serif"`
- Никаких внешних ресурсов (`xlink:href` на URL запрещён)
- Бренд-цвет: `#FF1A8C` (acid pink), фон: `#000000`
- Для иконок: скруглённые углы `rx="18"` на 100×100 viewBox

### 2. Отрендерить

```bash
cd tools
node graphics/render.mjs \
  --input  ../assets/graphics/src/<name>.svg \
  --output ../assets/graphics/out/<name>_512.png \
  --width  512
```

### 3. Android-иконки

```bash
node graphics/batch.mjs \
  --input ../assets/graphics/src/ic_launcher.svg \
  --name  ic_launcher \
  --android
```

Файлы попадут в `app/src/main/res/mipmap-*/ic_launcher.png`.

## Технология

Рендерер: [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) — Rust/WASM, без системных зависимостей.
