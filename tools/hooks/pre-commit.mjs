#!/usr/bin/env node
/**
 * pre-commit.mjs — git pre-commit guard of KrinikCam (registered via `git config core.hooksPath .githooks`).
 *
 * PROJECT RULE (Криник, 2026-10-17, verbatim): «все скриншоты темстовые ВСЕГДА ПОД ГИТИГНОРОМ», «это
 * правило проекта!», «ХУК НАПИСАТЬ НА ЭТО И ЗАРЕГИСТРИРОВАТЬ!». Test frames show the owner's real
 * surroundings; the repository is public. .gitignore keeps them out of `git add -A`, but `git add -f`, a
 * new folder name or an agent's slip still reaches the index — this hook is the second wall.
 * Same wall for the signing secrets: «.env ВНЕ ГИТА!!!» (2026-10-17).
 *
 * Refuses the commit (exit 1) when the STAGED set (added/copied/modified/renamed) contains:
 *   · any image/video under testcases/  (png jpg jpeg webp gif mp4)
 *   · any file under a `screenshots/` folder anywhere
 *   · .env / .env.* · *.jks / *.keystore · keystores/ · keystore.properties
 *
 * @guard test-frames-and-secrets-out-of-git
 * THREAT:         a test screenshot of the owner's room (or a signing secret) pushed to the public repo
 * PROVED-AGAINST: `git add -f` of a .jpg under testcases/reports/assets/ → commit refused, exit 1 (2026-10-17)
 * GAP:            frames committed OUTSIDE testcases/ and screenshots/ (e.g. bugs/assets/) are not judged —
 *                 those need the owner's eye; a hook skipped with --no-verify is not stopped
 * ON-REAL-PATH:   2026-10-17 — the amend of commit 066d222 ran through it (pass on a clean index)
 */
import { execSync } from 'child_process'

const RULES = [
  { re: /^testcases\/.*\.(png|jpe?g|webp|gif|mp4)$/i, why: 'тестовый кадр (правило проекта: тестовые скриншоты ВСЕГДА под .gitignore)' },
  { re: /(^|\/)screenshots\//i, why: 'папка screenshots/ — тестовые кадры не коммитятся' },
  { re: /(^|\/)\.env(\..*)?$/i, why: '.env — секреты подписи вне git' },
  { re: /\.(jks|keystore)$/i, why: 'ключ подписи' },
  { re: /(^|\/)keystores\//i, why: 'папка ключей подписи' },
  { re: /(^|\/)keystore\.properties$/i, why: 'пароли ключа подписи' },
]

let staged = []
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean)
} catch {
  process.exit(0) // not a git context we understand — never break the commit on our own error
}

const hits = []
for (const f of staged) for (const r of RULES) if (r.re.test(f)) { hits.push(`  ✖ ${f} — ${r.why}`); break }

if (hits.length) {
  console.error('\n🚫 pre-commit: коммит ОТКЛОНЁН — в индексе то, что не должно попасть в публичный репозиторий:\n')
  console.error(hits.join('\n'))
  console.error('\nУбери из индекса: git rm --cached <файл>  (файл на диске останется). Обход --no-verify запрещён правилом проекта.\n')
  process.exit(1)
}
process.exit(0)
