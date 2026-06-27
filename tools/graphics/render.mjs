/**
 * render.mjs — SVG → PNG рендерер для KrinikCam
 *
 * Использование:
 *   node tools/graphics/render.mjs \
 *     --input  assets/graphics/src/ic_launcher.svg \
 *     --output assets/graphics/out/ic_launcher_192.png \
 *     --width  192 --height 192
 *
 * Все пути — относительно корня проекта.
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
      args[argv[i].slice(2)] = argv[i + 1]
      i++
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

const resvg = new Resvg(svgData, {
  fitTo: width
    ? { mode: 'width', value: width }
    : { mode: 'original' },
  font: {
    loadSystemFonts: false,  // reproducible renders — no system font side-effects
  },
})

const rendered = resvg.render()
const pngData  = rendered.asPng()

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, pngData)

console.log(`✓ ${basename(inputPath)} → ${basename(outputPath)} (${rendered.width}×${rendered.height} px)`)
