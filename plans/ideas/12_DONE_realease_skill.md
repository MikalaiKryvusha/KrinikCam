> ✅ РЕАЛИЗОВАНО 2026-06-29 — навык `.claude/skills/release/SKILL.md` (`/release`). Оркестрирует вокруг
> готового `tools/release.mjs`: пречек (чистое дерево/main/gh auth) → актуализация README (EN/RU) →
> README.pdf → контрольная сборка → коммит README → подтверждение Криника → `release.mjs` (бамп
> minor/major + assembleRelease + тег + пуш + `gh release create`) → проверка `gh release view`.
> Релиз выпускается ТОЛЬКО по явной просьбе Криника (не в автономном режиме).

Сделать скил слеш команды / для выполнения сборки RC релизного билда, с обновлением README файлов, комит, пуш, и создание нового релиза в Github.