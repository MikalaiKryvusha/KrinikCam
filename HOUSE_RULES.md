# Правила дома — KrinikCam

> Местный закон проекта KrinikCam — ярус 4 таксономии документов (`AGENT_GUIDE.md` → «Таксономия документов»):
> постоянные правила Криника, внешние системы, стенды и устройства, факты машины, маршруты, рецепты и инструменты, с
> которыми агент работает ЗДЕСЬ. `AGENT_GUIDE.md` отвечает, КАК агент работает (метод KAIF); этот файл — С ЧЕМ он
> работает в KrinikCam. Скопирован 2026-10-17 из скелета `.kaif/_house-rules-template.md` (KAIF 2.8); бюджета размера
> нет; `/resume` читает его на входе, а контекст-роутер шлёт сюда первой задачу на уже тронутой поверхности.
> Обновление KAIF этот файл не трогает — он проекта.

**Создан:** 2026-10-17 · **Владелец:** Криник (Mikalai Kryvusha) · **Перенесено из руководства (2026-10-17, KAIF 2.8,
дословно):** «Инструменты проекта» (таблица) → §6 · «Push / аутентификация в GitHub (git + gh)» → §5 · «UI Automation —
быстрый старт» и «ADB workflow для отладки на девайсе» → §3 · «Ключевые библиотеки и их особенности» → §7

## 1. Постоянные правила Криника (The owner's standing rules)

Каждое правило — строгим правилом в словах агента (повелительно, нумеровано, с исключениями) плюс ОДНА строка
провенанса; дословные слова Криника остаются в источнике (`AGENT_GUIDE.md` → «Авторство решения», п. 5). Правила
Криника, записанные до 2026-10-17, живут в `AGENT_GUIDE.md` и остаются там: «Руководство от Криника», «Git-воркфлоу
(решение Криника 2026-06-30)», 🔴 «в ЧАТЕ с Криником — ТОЛЬКО РУССКИЙ», 🔬 разведка прио-арта перед эпиком, 📐
искажения кадра — измерять инструментом. Новые — сюда.

### R1. Ключи подписи двух сборок — только в `.env`, вне git

1. Ключи «Debug KCAM» (`KCAM_DEBUG_*`) и «KCAM» (`KCAM_RELEASE_*`) — `*_STORE_FILE`, `*_STORE_PASSWORD`,
   `*_KEY_ALIAS`, `*_KEY_PASSWORD` — лежат в `.env` в корне репозитория; читает их `app/build.gradle.kts`.
2. Перед коммитом, трогающим сборку, проверь: `git check-ignore -v .env` → строка `.gitignore` (`.env`, `.env.*`,
   `keystores/` — игнор-строки стоят с 2026-10-17).
3. Значения ключей не пишутся НИКУДА — ни в доки, ни в логи, ни в коммиты, ни в чат, ни в отчёты.
- **Исключение:** нет.

[OWNER] 2026-10-17 · чат; дословно: «в .env заведите ключи для двух сборок: Debug KCAM; KCAM - это тудет релизная
зборка без дебаг меню и отладочных инструментов и в R8», «.env ВНЕ ГИТА!!!» (повторено в `AGENT_GUIDE.md` → «Сборка»)

### R2. Релизная сборка «KCAM» — R8 и без меню разработчика и отладочных инструментов

1. `release` собирается с R8 (минификация включена).
2. В `release` нет меню «Для разработчиков» и отладочных инструментов; отладочное — только в «Debug KCAM».
- **Исключение:** нет. Прежнее правило `AGENT_GUIDE.md` → «Меню для разработчиков» («доступен в ЛЮБОЙ сборке») этим
  словом пересмотрено.

[OWNER] 2026-10-17 · чат; дословно: «KCAM - это тудет релизная зборка без дебаг меню и отладочных инструментов и в R8»

### R3. Тестовые скриншоты — ВСЕГДА под `.gitignore`, в публичный репозиторий не идут

[OWNER] 2026-10-17, дословно: «все скриншоты темстовые ВСЕГДА ПОД ГИТИГНОРОМ», «это правило проекта!»,
«ХУК НАПИСАТЬ НА ЭТО И ЗАРЕГИСТРИРОВАТЬ!»; раньше в тот же день: «только кадры моей страшной комнаты не
публикуйте. Если нужно что-то из кадров - найдите фото свободные блогеров».

- Кадры прогонов живут только локально: `.gitignore` → `testcases/**/*.{png,jpg,jpeg,webp,gif,mp4}`,
  `testcases/**/assets/`, плюс прежнее `tools/screenshots/`.
- Вторая стена — git-хук `pre-commit` (`tools/hooks/pre-commit.mjs`, обёртка `.githooks/pre-commit`): отклоняет
  коммит кадра из `testcases/` или `screenshots/`, а также `.env`/ключей. Регистрация в КАЖДОМ клоне:
  `git config core.hooksPath .githooks` (на этой машине сделано 2026-10-17). Обход `--no-verify` запрещён.
- Картинки для README/релизов — без обстановки владельца: превью камеры закрывается свободной фотографией
  (лицензия без отчислений, источник в Credits) или кадр снимается с источником «Нет источника».

## 2. Внешние системы и доступ (External systems and access)

| Система | Что агент там делает | Точка входа | Где учётные данные |
|---|---|---|---|
| GitHub — репозиторий KrinikCam | push в `main`; релизы — только по слову Криника (`/release`, `node tools/release.mjs`) | https://github.com/MikalaiKryvusha/KrinikCam · `git` · `gh` | токен `gh` в хранилище учётных данных Windows (аккаунт `MikalaiKryvusha`); `git` берёт его через `gh auth git-credential` |
| GitHub — origin KAIF | тикеты о дефектах KAIF (`bugs/KAIF/`) и полевые отчёты обновлений — `node .kaif/kaif-core.mjs report <файл>` | https://github.com/MikalaiKryvusha/KAIF | тот же `gh` |
| YouTube / Twitch (RTMP) | эфир — только по задаче Криника; тестовый эфир — на локальный полигон (§3) | RTMP-URL в профилях стрима приложения | stream-ключи — в приложении на устройстве (по карте модулей — `:data:profiles`); в лог — только через `redactRtmpUrl()` |
| Подпись APK | сборка debug / release | `app/build.gradle.kts` | `.env` в корне, вне git (§1 R1) |

## 3. Стенды, окружения и устройства (Stands, environments and devices)

Команды харнеса — здесь, принцип харнеса — в `AGENT_GUIDE.md` («Правило автоматизации», «Тестирование»). Полное
руководство по UI-автоматизации — `tools/UI_AUTOMATION_GUIDE.md`.

| Стенд / устройство | Зачем | Как агент до него дотягивается | Известные ловушки |
|---|---|---|---|
| Android-устройства Криника (парк с 2026-08-02 — два) | основной стенд: сборка → установка → харнес → логи | `node tools/device.mjs list` → `ADB_DEVICE=<serial> node tools/ui.mjs …`; `node tools/smoke.mjs` | при нескольких устройствах без `ADB_DEVICE` инструменты отказываются гадать; на Windows первым в PATH стоит `adb` 1.0.32 (`tools/env.mjs` ставит SDK-шный первым); путь `/sdcard/…` в Git Bash — только с `MSYS_NO_PATHCONV=1` (§4) |
| Харнес «виртуальная камера + запись в файл» | автономные тесты без камеры и Криника | `node tools/ui.mjs cmd virtual-camera on` · `stream-to-file on` + `ffprobe` | CMD-receiver есть только в debug-сборке |
| Локальный RTMP-полигон (MediaMTX) | настоящий эфир без YouTube; «зомби-сервер» `freeze`/`thaw` | `node tools/rtmp-server.mjs start\|stop\|status\|url\|freeze\|thaw` | ⚠️ на Windows-машине НЕ запускался; по чтению кода (2026-10-17): имя ассета собирается как `mediamtx_v1.19.2_win32_amd64.tar.gz`, `freeze`/`thaw` — `SIGSTOP`/`SIGCONT`, LAN-IP — `ipconfig getifaddr en0` (macOS) — проверить до опоры |
| Эмулятор (AVD, Idea 28) | тест-девайс без железа | `node tools/avd.mjs create\|start\|stop\|status\|smoke` | в SDK Windows-машины нет `emulator` и `system-images` (проба 2026-10-17) — стенд не готов |

### UI Automation — быстрый старт

```bash
# ПРАВИЛО: никогда не угадывать координаты из скриншота — всегда использовать ui.mjs dump

# Что сейчас на экране?
node tools/ui.mjs dump

# Нажать кнопку
node tools/ui.mjs tap "go live"
node tools/ui.mjs tap "menu"
node tools/ui.mjs tap "youtube"

# Найти без тапа (проверить наличие элемента)
node tools/ui.mjs find "platforms"
```

### ADB workflow для отладки на девайсе

```bash
# 1. Видеть экран (DOM, точные координаты)
node tools/ui.mjs dump         # предпочтительно
node tools/adb.mjs screen      # резерв, если нужно визуально

# 2. Нажать кнопку по тексту
node tools/ui.mjs tap "go live"

# 3. Запустить и поймать краш
node tools/adb.mjs stop && node tools/adb.mjs start && sleep 3 && node tools/adb.mjs logcat AndroidRuntime 40

# 4. Пересобрать и переустановить
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/build.mjs --no-ui && node tools/adb.mjs install && node tools/adb.mjs start
```

> На Windows-машине строка `export JAVA_HOME=…` из шага 4 не нужна: Java, SDK и `adb` выбирает `tools/env.mjs`
> (`AGENT_GUIDE.md` → «Сборка»); `sleep` и `&&` работают в Git Bash, в PowerShell 5.1 `&&` нет.

## 4. Досье окружения — факты машины (Environment dossier)

Правило — `AGENT_GUIDE.md` → «Досье окружения»; `/refresh-context` пересобирает эту таблицу (шаг досье). Шесть осей
снимаются **в каждой доступной оболочке отдельно** — разные оболочки дают разные ответы:

1. **ОС и железо** — версия ОС, ядра, память.
2. **Оболочки и кодировки** — какие оболочки есть, кодовая страница консоли, кодировка ANSI, в которой пишет
   перенаправление, локаль каждой оболочки.
3. **Инструменты** — среды выполнения, сборка, контроль версий и их версии; ЧТО значат `tar` / `curl` / `find` в каждой
   оболочке (системная программа, инструмент GNU или псевдоним на другую вещь — проверять ТИП команды, не только путь).
4. **Политики Git** — концы строк, помощник учётных данных.
5. **Пакетные менеджеры** — чем можно ставить.
6. **Причуды поведения** — ССЫЛКИ на оплаченные уроки (`EXPERIENCE.md`), без копий.

Одна строка — один факт: **факт → значение → команда пробы**. Факт без пробы пишется `— ещё не снято —`: пропущенный
факт честен, выдуманный — дефект (`PHILOSOPHY.md` → три двери).

> **Досье окружения.** Снято: 2026-10-17 20:35 +03:00 (Git Bash и Windows PowerShell 5.1, машина `krinikspc`, проект
> `D:\work\ai_sandbox\KrinikCam`) · Пересборка: `/refresh-context` → шаг досье (повторить пробы из третьей колонки,
> переписать значения и эту дату) · **Устаревание: факты старше четырёх недель — ГИПОТЕЗЫ, перед опорой снять заново.**
> Прежняя машина (macOS, zsh, до 2026-10-17) досье не имела; её известное — `AGENT_GUIDE.md` → «Сборка», EXP-0020.

| Факт | Значение | Проба |
|---|---|---|
| ОС | Windows 11 Pro 25H2, сборка 10.0.26200; имя машины `krinikspc` | PowerShell: `(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion` и `.CurrentBuild`; Git Bash: `uname -a` → `MINGW64_NT-10.0-26200 krinikspc` |
| Процессор / память | AMD Ryzen 7 5700G — 8 ядер, 16 потоков; 31,9 ГБ | PowerShell: `(Get-CimInstance Win32_Processor).NumberOfCores`, `(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory`; Git Bash: `nproc` → 16 |
| Оболочки | Git Bash — bash 5.2.21, MSYS 3.4.9 (инструмент Bash агента); Windows PowerShell 5.1.26100.9444 (инструмент PowerShell агента); PowerShell 7 (`pwsh`) нет | `echo $BASH_VERSION`; `$PSVersionTable.PSVersion`; `pwsh -v` → нет команды |
| Кодовые страницы | PowerShell агента: `chcp` 65001, `[Console]::OutputEncoding` 65001; cmd, вызванный из Git Bash, — 866 (его вывод в Git Bash — кракозябры, читать через `\| iconv -f CP866 -t UTF-8`); система: ACP 1251, OEMCP 866 | PowerShell: `chcp`, `[Console]::OutputEncoding.CodePage`, `Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage'`; Git Bash: `cmd //c chcp` |
| Кодировка ANSI по умолчанию | windows-1251: в ней пишут `Set-Content`/`Add-Content` PowerShell 5.1 без `-Encoding` и в ней он читает `.ps1` без BOM | PowerShell: `[System.Text.Encoding]::Default.WebName` |
| Локаль — Git Bash | `LC_CTYPE=C.UTF-8`, `LANG` не задан | `locale`; `echo $LANG` |
| Локаль — PowerShell 5.1 | `Get-Culture` ru-RU (дробь через запятую: `31,9`), `Get-UICulture` en-US, `Get-WinSystemLocale` ru-RU | `Get-Culture`, `Get-UICulture`, `Get-WinSystemLocale` |
| Node.js | v24.15.0, `C:\Program Files\nodejs\node.exe` в обеих оболочках | `node -v`; Git Bash: `type -a node`; PowerShell: `Get-Command node -All` |
| Java в PATH | первым в обеих оболочках — Microsoft JDK 21.0.11 (`C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin\java.exe`) | `type -a java`; `Get-Command java -All`; `java -version` |
| JDK 17 для сборки | Temurin 17.0.20.1 в `C:\Android\jdk-17` — его выбирает `tools/env.mjs` (проект: `jvmToolchain(17)`) | `/c/Android/jdk-17/bin/java -version`; `node tools/env.mjs` |
| `JAVA_HOME` | User: `C:\Users\krinik\.bubblewrap\jdk\jdk-17.0.11+9` — каталога НЕТ, и он перекрывает Machine (`C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\`); голый `gradlew.bat` с ним падает «JAVA_HOME is set to an invalid directory» | PowerShell: `[Environment]::GetEnvironmentVariable('JAVA_HOME','User')` и `'Machine'`, `Test-Path $env:JAVA_HOME` → False; Git Bash: `echo $JAVA_HOME` |
| Android SDK | `C:\Android\Sdk` (`ANDROID_HOME` / `ANDROID_SDK_ROOT` не заданы ни в User, ни в Machine): platforms `android-35`, `android-36`, `android-37.0`; build-tools `34.0.0`, `35.0.0`, `36.0.0`; NDK `27.0.12077973`, `29.0.14206865`; CMake `3.31.6`; `cmdline-tools`, `platform-tools`; **нет `emulator` и `system-images`** | Git Bash: `ls /c/Android/Sdk`, `ls /c/Android/Sdk/{platforms,build-tools,ndk,cmake}`; PowerShell: `[Environment]::GetEnvironmentVariable('ANDROID_HOME','User')` |
| Gradle и SDK проекта | обёртка Gradle 8.10 (`gradle` в PATH нет); `compileSdk`/`targetSdk` 35, `minSdk` 33, `jvmToolchain(17)` | `gradle/wrapper/gradle-wrapper.properties` → `distributionUrl`; `app/build.gradle.kts`; `type -a gradle` |
| `adb` в PATH | первым в обеих оболочках — `C:\adb\adb.exe` **1.0.32**; дальше `adb` из scrcpy 3.3.4 (winget) и `C:\Program Files\adb\adb.exe` 1.0.41; рабочий — `C:\Android\Sdk\platform-tools\adb.exe` 1.0.41 (`tools/env.mjs` ставит его первым) | Git Bash: `type -a adb`, `<путь>/adb version`; PowerShell: `Get-Command adb -All` |
| `NoDefaultCurrentDirectoryInExePath` | `1` в процессе агента (в User и Machine не задана — её ставит среда агента): cmd не ищет программу в текущей папке, голый `gradlew.bat` → «не является внутренней или внешней командой»; работает `.\gradlew.bat` или абсолютный путь; переменная действует при ЛЮБОМ значении, пустом тоже | PowerShell: `$env:NoDefaultCurrentDirectoryInExePath`, `[Environment]::GetEnvironmentVariable('NoDefaultCurrentDirectoryInExePath','User')`; Git Bash: `cmd //c "gradlew.bat --version"` против `env -u NoDefaultCurrentDirectoryInExePath cmd //c "gradlew.bat --version"` |
| MSYS: пути в аргументах | Git Bash переписывает `/sdcard/Android/data` в `C:/Program Files/Git/sdcard/Android/data`; `MSYS_NO_PATHCONV=1` отключает переписывание (тогда и локальный `/tmp/x` уходит как `D:\tmp\x`) | Git Bash: `node -e "console.log(process.argv[1])" /sdcard/Android/data` — с `MSYS_NO_PATHCONV=1` и без |
| Git | 2.43.0.windows.1; `core.autocrlf=true` (системный gitconfig) — рабочее дерево в CRLF; `core.ignorecase=true` (`.git/config`); `core.longpaths` не задан | `git --version`; `git config --show-origin --get core.autocrlf` (и `core.ignorecase`, `core.longpaths`) |
| Учётные данные Git | системный `credential.helper=manager`; для `https://github.com` и `gist.github.com` — `gh auth git-credential` (`~/.gitconfig`, после `gh auth setup-git`) | `git config --show-origin --get-regexp '^credential'` |
| GitHub CLI | `gh` 2.95.0; вошёл как `MikalaiKryvusha` (keyring), протокол https, scopes `gist`, `read:org`, `repo`, `workflow` | `gh --version`; `gh auth status` |
| Python | первым — 3.14.4 (`C:\Python314\python`), дальше 3.10 (`…\AppData\Local\Programs\Python\Python310`) и заглушка WindowsApps; `python3` — только заглушка WindowsApps | Git Bash: `type -a python python3`; PowerShell: `Get-Command python -All`; `python --version` |
| `tar` / `curl` / `find` — Git Bash | `/usr/bin/tar` — GNU tar 1.35 · `/mingw64/bin/curl` — curl 8.4.0 · `/usr/bin/find` — GNU findutils 4.9.0 (программы `C:\Windows\system32` стоят в PATH дальше) | `type -a tar curl find`; `tar --version`, `curl --version`, `find --version` |
| `tar` / `curl` / `find` — PowerShell 5.1 | `tar` → `C:\Windows\system32\tar.exe` (bsdtar 3.8.8) · `curl` → ПСЕВДОНИМ `Invoke-WebRequest`, программа curl 8.21.0 — только как `curl.exe` · `find` → `C:\Windows\system32\find.exe` (поиск строки в файле, НЕ GNU find) | `Get-Command tar,curl,find -All`; `tar --version`; `curl.exe --version` |
| Медиа-инструменты | `ffprobe`/`ffmpeg` в PATH (пакет winget `yt-dlp.FFmpeg`, сборка N-124279); `scrcpy` 3.3.4 (winget); ImageMagick `magick` 7.1.2; `mediamtx` в PATH нет | Git Bash: `type -a ffprobe ffmpeg scrcpy magick mediamtx` |
| Пакетные менеджеры | winget v1.29.380; Chocolatey 1.3.0; scoop нет; npm — вместе с Node | `winget --version`; `choco -v`; `scoop --version` → нет команды |
| Причуды, оплаченные уроками | два требования к Java (JVM запуска Gradle ≠ тулчейн 17) — EXP-0020; у агента нет чувства времени, время — пробой — EXP-0058; cwd персистит между вызовами Bash — EXP-0015 | `EXPERIENCE.md` (grep по номеру) |

## 5. Маршруты, рецепты и соглашения — указатель своих работ (Routes, recipes and conventions)

Задача на поверхности из этого списка начинается с открытия записи и цитаты из неё (`AGENT_GUIDE.md` → шаг 2 чеклиста).

| Поверхность | Где лежит работа | Что покрывает |
|---|---|---|
| Push и аутентификация в GitHub | подраздел ниже (перенесён дословно) + состояние на Windows-машине | вход `git`/`gh`, восстановление при отказе push; при non-fast-forward — `git pull --rebase`, повтор |
| Сборка на Windows-машине | `AGENT_GUIDE.md` → «Сборка»; `node tools/env.mjs` | выбор JDK 17 / SDK / `adb`, подписи двух сборок |
| Контур согласований с Криником | `AGENT_GUIDE.md` → «Интервью перед каждой новой фичей»; `.kaif/INTERACTIVE_CONTOUR_SPEC.md`; `plans/22`, `plans/23` | страницы вопросов, очередь, ждун, закрытие, гард вопросов вне `interviews/` |
| Пары «источник ↔ зеркало» | `AGENT_GUIDE.md` → «Гигиена документов и текста» → реестр пар | что с чем должно совпадать и команда проверки |

### Push / аутентификация в GitHub (git + gh)

Remote — HTTPS (`https://github.com/MikalaiKryvusha/KrinikCam.git`). `gh` CLI авторизован
(аккаунт `MikalaiKryvusha`, токен в keyring, scopes `repo`/`workflow`/`gist`/`read:org`), но
**git напрямую кредов не видит** и в неинтерактивной среде падает с
`fatal: could not read Username for 'https://github.com': Device not configured`.

**Фикс (выполнен 2026-06-30, разовый):**
```bash
gh auth setup-git    # прописывает gh как git credential-helper для github.com
git push origin main # дальше пушит без интерактива, токеном gh
```
- Это НЕ про 2FA: двухфакторка HTTPS-пуш не чинит и не ломает — нужен именно токен/credential-helper.
- Если снова `could not read Username` — повтори `gh auth setup-git`; проверь `gh auth status`.
- При `non-fast-forward` — `git pull --rebase`, затем повтор `git push`.
- `node tools/commit.mjs "..."` бампит build-номер, коммитит и пушит (использует тот же git/gh).

**Состояние на Windows-машине (проба 2026-10-17):** `gh auth status` → вошёл как `MikalaiKryvusha` (keyring), протокол
https; `~/.gitconfig` уже держит `gh auth git-credential` для `https://github.com` — `gh auth setup-git` здесь сделан.
Push с этой машины в рамках этой пробы не выполнялся.

## 6. Инструменты проекта (Tools of this project)

Каждый инструмент автоматизации проекта — строкой в день его рождения (`AGENT_GUIDE.md` → «Инструменты проекта»).
Таблица перенесена дословно 2026-10-17; строка `tools/env.mjs` добавлена в тот же день.

| Команда | Что делает |
|---------|------------|
| `node tools/build.mjs` | сборка с браузерным UI для того, чтобы Криник видел процесс сборки |
| `node tools/build.mjs --no-ui` | headless сборка |
| `node tools/smoke.mjs [--skip-build] [--portrait\|--rotation N] [--pip] [--duration N]` | **смоук-тест пайплайна одной кнопкой**: build→install→harness→запись→ffprobe-ассерты (валидный MP4 + размер кадра под поворот + кадры) → PASS/FAIL (exit 0/1). Прогонять после правок видеопайплайна вместо ручной цепочки |
| `node tools/rtmp-server.mjs start\|stop\|status\|url\|freeze\|thaw` | **локальный RTMP-полигон** (MediaMTX): приём настоящего эфира без YouTube и Криника. `freeze`/`thaw` (SIGSTOP/SIGCONT) моделируют **«зомби-сервер» K5**: соединение живо, байты не читаются → `write()` клиента блокируется, ошибка НЕ приходит вовсе. Это единственный дешёвый способ воспроизвести класс отказа, в котором приложение слепо минуты (`plans/21` Ш0/B) |
| `node tools/graphics/render.mjs --input x.svg --output x.png --width N --height N` | SVG→PNG |
| `node tools/graphics/batch.mjs --input x.svg --android` | SVG→Android mipmap set |
| `node tools/ui.mjs cmd <action> [arg]` | **⭐ ТОЛСТАЯ debug-команда (Idea 22), минует UI** — `virtual-camera on\|off`, `stream-to-file on\|off`, `go-live [1080\|2160]`, `go-live-rtmp <url1[,url2…]>` (настоящий RTMP-мультистрим на полигон), `stop`, `photo`, `set-rotation 0\|90\|180\|270` (глобальный поворот ХОЛСТА над сценой, interview_006), `add-overlay [id]`, `set-transform <id> <scale> <cx> <cy> [alpha] [rotation]` (трансформа слоя + поворот содержимого), `select-source front\|rear\|uvc\|virtual\|none\|builtin <id>`, `device-camera front\|back\|off` (Idea 24), `toggle-layer\|layer-up\|layer-down <id>`, `gesture-drag\|scale\|rotate <id> …` и `gesture-pinch in\|out [frac]` / `gesture-twist <deg> [radiusFrac]` (двухпальцевый мультитач), `rotation-mode on\|off`. Протокол аргументов bug 39: хвост клеится ЗАПЯТОЙ, ресивер парсит `[,\s]+`; контракт-шаг в smoke.mjs ловит рассинхрон. Надёжно загнать приложение в нужное состояние на харнесе |
| `node tools/ui.mjs dump` | dump DOM-иерархии с точными координатами (тонкий слой — для проверки самого UI) |
| `node tools/ui.mjs tap <query>` | найти элемент по тексту и тапнуть (без скриншота!) |
| `node tools/ui.mjs find <query>` | найти все элементы, совпадающие с query |
| `node tools/ui.mjs swipe <up\|down\|left\|right> [frac] [ms]` | жест свайпа для прокрутки экранов (ориентационно-корректный) |
| `node tools/ui.mjs orient <auto\|portrait\|landscape\|0..3>` | вращать/фиксировать ориентацию девайса по ADB (для теста ориентаций без рук) |
| `node tools/ui.mjs allow [--once]` | **сам одобрить** системный диалог разрешений (CAMERA/микрофон/USB) — без Криника |
| `node tools/ui.mjs kill [debug\|release\|both]` | force-stop сборок; по умолчанию обе → освобождает камеру |
| `node tools/ui.mjs start\|restart [debug\|release]` | запуск/перезапуск нужной сборки |
| `node tools/ui.mjs screen [out.jpg]` | скриншот → `tools/screenshots/adb_screen.jpg` (сжатый JPEG q80, full-res; папка gitignored) |
| `node tools/adb.mjs screen` | скриншот → `tools/screenshots/adb_screen.jpg` (тоже JPEG q80, через `sharp`) |
| `node tools/device.mjs list\|selftest` | **кого харнес считает целью** (парк с 2026-08-02 — ДВА устройства). Один общий разрешатель для `ui.mjs`/`smoke.mjs`/`adb.mjs`: `ADB_DEVICE` → одно подключённое → **при НЕСКОЛЬКИХ отказывается гадать** и печатает готовые строки `ADB_DEVICE=<serial>`. Раньше копии этой логики жили в двух файлах и выбирали независимо — smoke мог мерить одно железо, а `ui.mjs` тыкать в другое, и никто бы не заметил. `selftest` (6 проверок) скармливает гарду ровно его дефект — проверено и на СЛОМАННОЙ версии (краснеет) |
| `node tools/adb.mjs tap <x> <y>` | тап по координатам (устарело — используй ui.mjs tap) |
| `node tools/adb.mjs logcat [tag] [lines]` | дамп logcat с устройства |
| `node tools/avd.mjs create\|start\|stop\|status\|smoke` | **эмулятор как тест-девайс (Idea 28)**: планшет недоступен → headless AVD (Pixel_7_Pro_Android_15; KCAM_AVD=<имя> для другого) + smoke на нём (функциональный порог --min-fps 3; софт-GPU медленный). Харнес: `ADB_DEVICE=emulator-5554 node tools/ui.mjs …` |
| `node tools/adb.mjs install` | установить debug APK |
| `node tools/adb.mjs start` | запустить MainActivity |
| `node tools/adb.mjs stop` | force-stop приложения |
| `node tools/owner.mjs guard\|baseline\|ask\|gate\|queue\|inbox\|selftest\|verify` | **контур согласований «агент ↔ Криник»** (`/owner-reviews`, `plans/22`+`plans/23`): `guard` — ВСЕ висящие вопросы + число унаследованного долга (в ритуалы!; краснеет только на НОВЫХ нарушениях и на ПРОТУХШЕМ статусе); `baseline` — снять/пересобрать базовую линию долга; `ask` — открыть интервью окном-приложением, позвать тремя писками и голосом, записать ответ в три места и **разбудить агента** (I8); `gate` — fail-closed перед зависимой работой; `queue`+`inbox` — копить в лупах и звать раз на пачку (`--no-serve` = собрать и выйти); `selftest` — ядро (58 проверок); `verify` — **QA ЖИВЫМ браузером** через Chrome+CDP (57 проверок: снятие выбора, теги, цвета, побудка). Настройки — `tools/owner.config.json`; спецификация сборки — `.claude/skills/owner-reviews/references/build-spec.md` |
| `python tools/measure_stretch.py <img.png> [x y w h]` | **ОБЪЕКТИВНО измерить линейное искажение (растяг/сжатие)** кадра по круглому объекту: fitEllipse → ratio осей + угол. Для оценки геометрии видео — НЕ на глаз (см. правило ниже). venv-настройка в шапке скрипта |
| `node tools/env.mjs` | **один общий выбор окружения для всех инструментов** (2026-10-17, переезд на Windows): `JAVA_HOME` → первый живой JDK (JDK 17 `C:\Android\jdk-17` впереди; перебивка `KCAM_JAVA_HOME`), `ANDROID_HOME` → существующий SDK, `platform-tools` SDK первым в PATH; импортируют `build`/`release`/`smoke`/`device`/`avd`; запуск без аргументов печатает, что выбрано и почему |

## 7. Знания о продукте (Product knowledge)

Факты предметки, которые агент не выводит заново. Перенесено дословно из `AGENT_GUIDE.md` → «Ключевые библиотеки и их
особенности» (2026-10-17).

### AndroidUSBCamera 3.2.7 (`com.github.jiangdongguo.AndroidUSBCamera:libausbc`)
- Класс камеры: `MultiCameraClient.Camera` (не `CameraUVC` — её нет в 3.x)
- Callback: `com.jiangdg.ausbc.callback.IDeviceConnectCallBack` (не вложен в `MultiCameraClient`)
- Опечатка в API: `onDetachDec` / `onDisConnectDec` (не `Dev`)
- Состояние: `ICameraStateCallBack.State` (OPENED/CLOSED/ERROR), не `Code`
- Открыть превью: `camera.openCamera(textureView, cameraRequest?)`
- `libuvc` нужен как `compileOnly` — в POM он `runtime`, но его тип торчит в публичном интерфейсе

### RootEncoder 2.4.7 (`com.github.pedroSG94.RootEncoder:library`)
- Мы используем `RtmpStream` (`com.pedro.library.rtmp.RtmpStream`) + наш `CompositorVideoSource`
  (единственный базовый источник, Phase 3 — камера идёт СЛОЕМ композитора),
  а НЕ `RtmpCamera1` (RtmpCamera1 открывает Camera1/Camera2 API → конфликт с USB UVC → краш)
- Интерфейс: `com.pedro.common.ConnectChecker`
- Коллбэки без суффикса: `onConnectionSuccess()`, `onConnectionFailed(reason)`, etc.
- ⚠️ **`RtmpStream` (StreamBase).prepareVideo: `(width, height, bitrate, fps=30, iFrameInterval=2, rotation=0, ...)`**
  — BITRATE 3-й параметр, FPS 4-й! НЕ путать со старым `RtmpCamera1.prepareVideo(w,h,fps,bitrate,rotation)`.
  Перепутанный порядок (fps↔bitrate) = энкодер с битрейтом ~30 бит/с = пустой видеотрек =
  YouTube получает только звук = Broken Pipe через 15с. **(Баг 02, исправлен 2026-06-28.)**
- ⚠️ **Ориентация (Phase 3):** `prepareVideo(rotation=0)` внутри зовёт
  `glInterface.setCameraOrientation(270)` (поворот входа для телефонных сенсоров). У нас ВСЕ
  повороты делает СВОЙ композитор (глобальный поворот холста + поворот слоя, interview_006) →
  после `prepareVideo` ВСЕГДА `setCameraOrientation(0)`, библиотека ничего не крутит. **(Баг 02 A.)**
- `setCustomImageToStream()` удалён → используй `glInterface.setFilter(BaseFilterRender)` для статик-кадра
- GL-поток рисует в encoder через `streamOrientation` (`setStreamRotation`), в preview — через
  `previewOrientation` (`setPreviewRotation`); `setCameraOrientation` крутит общий вход камеры (оба)

### Compose Material3
- `ExposedDropdownMenuBox` и `menuAnchor()` — экспериментальные, нужен `@OptIn(ExperimentalMaterial3Api::class)`
