/**
 * release.mjs — Build a Release Candidate, tag it, and deploy to GitHub Releases.
 *
 * Usage:
 *   node tools/release.mjs               → bumps minor version (0.1 → 0.2)
 *   node tools/release.mjs --major       → bumps major version (0.x → 1.0)
 *   node tools/release.mjs --dry-run     → simulate without building or pushing
 *
 * What it does:
 *   1. Bumps minor (or major) version in version.json
 *   2. Builds release APK via Gradle
 *   3. Renames APK to KrinikCam-vX.Y.apk
 *   4. Commits the version bump and tags the commit (vX.Y)
 *   5. Pushes commit + tag to GitHub
 *   6. Creates GitHub Release via gh CLI with auto-generated release notes
 *
 * Prerequisites: gh CLI installed and authenticated (gh auth login)
 *
 * Related: build.mjs (build only), commit.mjs (commit without release), version.mjs
 */

import { execSync } from 'child_process'
import { existsSync, renameSync, unlinkSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bumpMinor, bumpMajor, readVersion, formatVersion, formatTag } from './version.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const isMajor = args.includes('--major')
const isDryRun = args.includes('--dry-run')
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'

// --- Version (compute WITHOUT mutating, so --dry-run has NO side effect) ---
// Bug fix: previously this called bumpMinor()/bumpMajor() (which WRITE version.json) BEFORE the
// dry-run check → a `--dry-run` followed by a real run bumped the minor TWICE and skipped a version
// (e.g. 0.3 → dry-run wrote 0.4 → real run wrote 0.5, v0.4 never released). Now we only PEEK here;
// the real, writing bump happens below only on a real run.
const current = readVersion()
const next = isMajor
  ? { major: current.major + 1, minor: 0, build: 0 }
  : { major: current.major, minor: current.minor + 1, build: 0 }
const vStr = formatVersion(next)
const tag = formatTag(next)

console.log(`\n🚀 KrinikCam — Release ${vStr}  (tag: ${tag})\n`)

if (isDryRun) {
  console.log('🔍 Dry run — skipping build, commit, and GitHub deploy. (version.json NOT modified)')
  console.log(`   Would release: ${vStr}  tag: ${tag}`)
  process.exit(0)
}

// --- Real run: NOW actually bump + write version.json ---
const v = isMajor ? bumpMajor() : bumpMinor()

// --- Build ---
const gradlewPath = resolve(ROOT, gradlew)
if (!existsSync(gradlewPath)) {
  console.error(`\n❌ Gradle wrapper not found. Run: node tools/setup.mjs first\n`)
  process.exit(1)
}

try {
  console.log('📦 Building release APK...')
  execSync(`${gradlew} assembleRelease`, { cwd: ROOT, stdio: 'inherit' })
} catch {
  console.error('\n❌ Gradle build failed.\n')
  process.exit(1)
}

// --- Rename APK ---
const apkSrc = resolve(ROOT, 'app/build/outputs/apk/release/app-release.apk')
const apkDest = resolve(ROOT, `KrinikCam-${tag}.apk`)

if (!existsSync(apkSrc)) {
  console.error(`\n❌ APK not found at: ${apkSrc}\n`)
  process.exit(1)
}
renameSync(apkSrc, apkDest)

try {
  // --- Commit version bump ---
  console.log('\n📝 Committing version bump...')
  execSync('git add -A', { cwd: ROOT, stdio: 'inherit' })
  execSync(`git commit -m "release: ${vStr}"`, { cwd: ROOT, stdio: 'inherit' })
  execSync(`git tag ${tag}`, { cwd: ROOT, stdio: 'inherit' })
  execSync('git push && git push --tags', { cwd: ROOT, stdio: 'inherit' })

  // --- GitHub Release ---
  console.log('\n📡 Creating GitHub Release...')
  execSync(
    `gh release create ${tag} "${apkDest}" --title "KrinikCam ${vStr}" --generate-notes`,
    { cwd: ROOT, stdio: 'inherit' }
  )

  console.log(`\n✅ Released: ${vStr}`)
  console.log(`   → https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/${tag}\n`)
} catch (e) {
  console.error('\n❌ Release failed:', e.message)
  process.exit(1)
} finally {
  // Clean up the renamed APK from root after upload
  if (existsSync(apkDest)) unlinkSync(apkDest)
}
