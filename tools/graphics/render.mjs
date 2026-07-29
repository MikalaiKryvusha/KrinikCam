/**
 * render.mjs — SVG → PNG рендерер для KrinikCam
 *
 * Использование:
 *   node tools/graphics/render.mjs \
 *     --input  assets/graphics/src/ic_launcher.svg \
 *     --output assets/graphics/out/ic_launcher_192.png \
 *     --width  192 --height 192
 *
 *   # SVG с ТЕКСТОМ (мокапы, плашки, подписи) — нужны системные шрифты:
 *   node tools/graphics/render.mjs --input x.svg --output x.png --width 1920 --system-fonts
 *
 * Все пути — относительно корня проекта.
 *
 * ⚠️ ШРИФТЫ. По умолчанию системные шрифты НЕ грузятся (`loadSystemFonts: false`) — так рендер
 * иконок воспроизводим на любой машине и в CI. Обратная сторона: любой <text> в SVG отрисуется
 * ПУСТЫМ МЕСТОМ, молча и без ошибки (поймано 2026-07-29 на мокапах плашки — фигура нарисовалась,
 * текст исчез). Поэтому для SVG с текстом передавай `--system-fonts`; такой рендер зависит от
 * шрифтов машины и для коммитимых иконок не годится.
 *
 * [TESTED: 2026-07-29 · три прогона наблюдением: (1) `--system-fonts --width 400` → 400×225, то есть
 *  булев флаг НЕ съедает соседний аргумент; (2) тот же флаг последним → 400×225; (3) без флага →
 *  400×225, но файл 2798 Б против 4507 Б с флагом, то есть текст действительно отрисовывается
 *  только с системными шрифтами. Старый путь (иконки без текста) не изменился.]
 */

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, basename, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1]
      // Булев флаг (`--system-fonts`) не имеет значения: он опознаётся по тому, что дальше идёт
      // либо конец списка, либо следующий ключ. Иначе флаг СЪЕЛ БЫ соседний аргумент и, например,
      // `--system-fonts --width 1920` потеряло бы ширину.
      if (next === undefined || next.startsWith('--')) {
        args[argv[i].slice(2)] = true
      } else {
        args[argv[i].slice(2)] = next
        i++
      }
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (!args.input) {
  console.error('Usage: node render.mjs --input <svg> --output <png> [--width N] [--height N]')
  process.exit(1)
}

const inputPath  = resolve(ROOT, args.input)
const width      = args.width  ? parseInt(args.width)  : undefined
const height     = args.height ? parseInt(args.height) : undefined

// Default output: same dir as input, same name but .png and WxH suffix
const defaultOut = resolve(
  ROOT,
  'assets', 'graphics', 'out',
  basename(args.input, extname(args.input)) +
    (width ? `_${width}x${height ?? width}` : '') + '.png'
)
const outputPath = args.output ? resolve(ROOT, args.output) : defaultOut

// ── Render ──────────────────────────────────────────────────────────────────

const svgData = readFileSync(inputPath, 'utf-8')

// Системные шрифты — только по явному флагу `--system-fonts`: без них любой <text> рендерится
// пустым местом (см. предупреждение в шапке файла), а с ними рендер перестаёт быть воспроизводимым.
const useSystemFonts = args['system-fonts'] !== undefined

const resvg = new Resvg(svgData, {
  fitTo: width
    ? { mode: 'width', value: width }
    : { mode: 'original' },
  font: useSystemFonts
    ? { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }
    : { loadSystemFonts: false },  // reproducible renders — no system font side-effects
})

const rendered = resvg.render()
const pngData  = rendered.asPng()

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, pngData)

console.log(`✓ ${basename(inputPath)} → ${basename(outputPath)} (${rendered.width}×${rendered.height} px)`)
