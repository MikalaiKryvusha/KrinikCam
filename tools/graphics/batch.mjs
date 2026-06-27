/**
 * batch.mjs — рендерит один SVG в набор PNG разных размеров.
 *
 * Обычный режим:
 *   node tools/graphics/batch.mjs \
 *     --input assets/graphics/src/ic_launcher.svg \
 *     --name  ic_launcher \
 *     --sizes 48,72,96,144,192
 *
 * Android mipmap режим (раскладывает по app/src/main/res/mipmap-*/):
 *   node tools/graphics/batch.mjs \
 *     --input  assets/graphics/src/ic_launcher.svg \
 *     --name   ic_launcher \
 *     --android
 */

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, basename, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

const ANDROID_SIZES = {
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--android') { args.android = true; continue }
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++ }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (!args.input || !args.name) {
  console.error('Usage: node batch.mjs --input <svg> --name <name> [--sizes 48,72,96] [--android]')
  process.exit(1)
}

const inputPath = resolve(ROOT, args.input)
const svgData   = readFileSync(inputPath, 'utf-8')
const name      = args.name

// Build render targets
const targets = args.android
  ? Object.entries(ANDROID_SIZES).map(([dir, size]) => ({
      outputPath: resolve(ROOT, 'app', 'src', 'main', 'res', dir, `${name}.png`),
      size,
      label: dir,
    }))
  : (args.sizes ?? '192').split(',').map(s => {
      const size = parseInt(s.trim())
      return {
        outputPath: resolve(ROOT, 'assets', 'graphics', 'out', `${name}_${size}x${size}.png`),
        size,
        label: `${size}×${size}`,
      }
    })

// Render each target
for (const { outputPath, size, label } of targets) {
  const resvg   = new Resvg(svgData, { fitTo: { mode: 'width', value: size } })
  const pngData = resvg.render().asPng()
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, pngData)
  console.log(`✓ ${label.padEnd(20)} → ${outputPath.replace(ROOT + '/', '')}`)
}

console.log(`\nDone — ${targets.length} files from ${basename(inputPath)}`)
