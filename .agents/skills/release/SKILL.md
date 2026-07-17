---
name: release
description: Собрать релиз-кандидат KrinikCam и выложить в GitHub Releases — пречек, актуализация README (EN/RU), сборка README.pdf, бамп версии + сборка release-APK + тег + пуш + GitHub Release через tools/release.mjs. Используй когда Криник говорит "сделай релиз", "выпусти релиз", "собери RC", "залей новую версию в GitHub", "release", "ship it".
---

# /release — выпуск релиза в GitHub

Криник просит выпустить новую версию KrinikCam. Это **необратимое внешнее действие** (публичный тег +
GitHub Release). Выполняй рутину **по порядку**, между шагами коротко пиши в чат, что делаешь. Если шаг
падает — остановись, покажи ошибку, НЕ продолжай вслепую.

Все пути относительно корня проекта (`/Users/kryvusha/ai_sandbox/KrinikCam`).

> ⚠️ **ПОДТВЕРЖДЕНИЕ ОБЯЗАТЕЛЬНО.** Перед самим выпуском (шаг 7) покажи Кринику: какая версия будет
> (текущая → новая), что дерево чистое, что собралось. Жми «релизим» только с его явного «да». Релиз =
> публичный тег и Release, откатывать неприятно. В автономном режиме (/autoloop) релиз НЕ выпускать.

## Шаг 0. Решить тип бампа

`tools/release.mjs` по умолчанию бампит **minor** (0.3 → 0.4), с флагом `--major` — мажор (0.x → 1.0).
Спроси Криника (или подтверди дефолт): minor или major. RC по умолчанию = minor.

## Шаг 1. Пречек окружения (не выпускаем на грязном/сломанном)

```bash
git status --short                      # дерево должно быть ЧИСТЫМ (кроме gitignored apk/pdf)
git branch --show-current               # должно быть main
git pull --rebase                       # подтянуть, чтобы пуш прошёл fast-forward
gh auth status                          # gh залогинен (нужен для GitHub Release)
node tools/version.mjs                  # показать текущую версию
```
Если дерево грязное — сначала закоммить/разберись (можно через `/pause` или `commit.mjs`). На грязном
дереве `release.mjs` закоммитит лишнее в `release: X.Y`.

## Шаг 2. Актуализировать README.md (EN/RU)

Открой `README.md` и приведи в соответствие с реальным состоянием: статус фаз, рабочие фичи,
инструкции. README двуязычный (EN/RU) — поддержи оба. Не выдумывай — отражай только то, что реально
сделано и проверено (сверься со `STATUS.md` и закрытыми `bugs/`*_DONE_*, `ideas/`*_DONE_*).

## Шаг 3. Собрать README.pdf

```bash
node tools/readme-pdf.mjs
```
Создаёт `README.pdf` в корне (gitignored). Если падает на `md-to-pdf` — `node tools/setup.mjs` один раз.

## Шаг 4. Контрольная сборка (до релиза)

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/build.mjs --no-ui
```
> ВАЖНО: без `JAVA_HOME` на JBR system java_home может вернуть Java 25 и сломать сборку. Должно
> закончиться `BUILD SUCCESSFUL`. `release.mjs` всё равно соберёт `assembleRelease` сам, но эта проверка
> ловит ошибки ДО бампа версии (чтобы не оставить полу-выпущенную версию).

## Шаг 5. Зафиксировать README-изменения

README обновлён на шаге 2 → закоммить ДО релиза, чтобы `release: X.Y` был чистым бампом версии:
```bash
node tools/commit.mjs "docs: README к релизу X.Y"
```
(`commit.mjs` сам бампит build-номер, add -A, коммит, пуш. README.pdf/APK gitignored — не попадут.)

## Шаг 6. Judge-проход по релиз-кандидату (ОБЯЗАТЕЛЕН, KAIF 1.5)

Прогони `/fable-judge` по собственным заявлениям релиз-кандидата: каждое утверждение в README/нотах
о том, что работает, должно быть подкреплено НАБЛЮДЕНИЕМ (харнес `ui.mjs`, смоук `tools/smoke.mjs`,
свежие логи, закрытые `bugs/*_DONE_*`), а не памятью сессии. Найдено неподтверждённое заявление или
фрод — сначала фикс и повторный judge, потом выпуск. Релиз — тот артефакт, чьи ложные заявления
увидит весь мир.

## Шаг 7. Выпуск (после подтверждения Криника)

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/release.mjs              # minor (0.3 → 0.4)
# или:
node tools/release.mjs --major      # major (0.x → 1.0)
```
`release.mjs` делает всё разом: бамп `version.json` (minor/major), `assembleRelease`, переименование APK
в `KrinikCam-vX.Y.apk`, коммит `release: X.Y` + тег `vX.Y`, пуш коммита и тега, `gh release create` с
авто-нотами, очистка APK из корня после загрузки.

> Совет: `node tools/release.mjs --dry-run` покажет, какая версия/тег будут, без сборки и пуша — удобно
> показать Кринику перед реальным выпуском.

## Шаг 8. Проверка и итог

```bash
gh release view vX.Y                # релиз создан, APK приложен
git log --oneline -3                # виден commit release: X.Y + тег
```
Кратко отчитайся Кринику: версия, ссылка на релиз
(`https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/vX.Y`), что приложен APK. Готово.

---

## Заметки

- `release.mjs` бампит **minor/major**, а `commit.mjs` — только **build**-номер (`version.json.build`).
  Релиз = новая minor/major; обычные коммиты по ходу = build.
- Если пуш отклонён (non-fast-forward) — `git pull --rebase` и повтори. На шаге 6 это критично: тег уже
  мог создаться локально — проверь `git tag` и при необходимости `git tag -d vX.Y` перед повтором.
- `gh` должен быть залогинен (`gh auth login`). Без него шаг 6 упадёт на `gh release create`.
- НИКОГДА не делай force-push и не удаляй чужие теги/релизы. Если что-то пошло не так на выпуске —
  остановись и покажи Кринику, не «чини» вслепую.
- Не выпускай релиз в автономном режиме (/autoloop) — только по явной просьбе Криника.
