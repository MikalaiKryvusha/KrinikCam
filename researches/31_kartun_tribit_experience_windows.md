# 31 — Опыт KARTUN и Krinik Tribit на Windows-машине: сборка, контур, голос, хуки, автоматизация тестов, управление ADB/HTTP/MCP

**Создан:** 2026-10-17 · **Родитель:** переезд разработки KrinikCam на Windows-машину (чат 2026-10-17) · **Статус:** живой справочник · **Вовне:** нет

Разведка только чтением: исходные проекты не менялись. Источники: `D:\work\ai_sandbox\KARTUN`, `D:\work\ai_sandbox\KrinikTribit`,
для сравнения `KAST`, `KAGO`, `KUMM`, `KUIPS`, транскрипты `C:\Users\krinik\.claude\projects\d--work-ai-sandbox-{KARTUN,KrinikTribit}\`.
Единственная проверочная команда в KrinikCam — `review.mjs --check` на `interviews/interview_025_camera_controls_epic.md`; она только
проверяет и ничего не пишет. Пункт 9 собран по сводкам двух субагентов, которые тоже только читали.

## 1. Проекты, стек, сборка на этой машине

**KARTUN** (`D:\work\ai_sandbox\KARTUN`) — Android-приложение, которое увеличивает фото нейросетью.
- Модули: `:app` (Compose), `:engine` (NCNN/Vulkan через JNI), `:probe` (тестовый APK).
- Стек: AGP 9.4.1, Kotlin 2.4.21, Compose BOM 2026.09.00, Gradle 9.8.1, compile/targetSdk 37, minSdk 34, `ndkVersion = "29.0.14206865"`. `jvmToolchain` нет.
- KAIF: `.kaif/kaif.json` → `"version": "2.8"`, `"prerelease": "2.9"`, `"build": "a63c651356bc"`, блока `contour` нет.
- Темп: 296 коммитов за 2,5 дня — от GOAL.md (10-14 13:28) до релиза 1.0 (10-16 23:50).

**KrinikTribit** — две части:
- Пропатченный форк APK Tribit. Собирается `bash build.sh` (apktool/smali). JDK в скрипте: `JAVA_HOME="${JAVA_HOME_KRINIK:-C:/Program Files/Microsoft/jdk-21.0.11.10-hotspot}"`. `zipalign` и `apksigner` берутся полным путём из `C:/Android/Sdk/build-tools/36.0.0`.
- Своё приложение на Kotlin/Compose на стеке KARTUN (AGP 9.4.1, compileSdk 37, minSdk 33). Сборка: `.\gradlew.bat assembleDebug`, JDK 21, `GRADLE_USER_HOME=C:\Android\gradle-home`.
- KAIF тот же: 2.8, prerelease 2.9, build a63c651356bc.

**Рецепт сборки соседей** (`KARTUN/AGENT_GUIDE.md` → Build; образец в `KAST/HOUSE_RULES.md`, строка 233):
```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot'; $env:ANDROID_HOME='C:\Android\Sdk'; $env:GRADLE_USER_HOME='C:\Android\gradle-home'; .\gradlew.bat assembleDebug --console=plain
```
В обоих проектах `local.properties` = `sdk.dir=C\:\\Android\\Sdk`. У KrinikCam `local.properties` нет.

**Факты машины, проверенные 2026-10-17, которые касаются KrinikCam:**
- **`JAVA_HOME`.** Значение User = `C:\Users\krinik\.bubblewrap\jdk\jdk-17.0.11+9`, каталога нет (`Test-Path` → False). Значение Machine = `C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\`. User перекрывает Machine, и процесс агента видит мёртвый путь.
- **JDK 17 есть:** `C:\Android\jdk-17` (Temurin 17.0.20.1, 2026-08-18). Соседи его не используют: им на AGP 9 хватает JDK 21.
  - У KrinikCam `jvmToolchain(17)`, а foojay-резолвера в `settings.gradle.kts` нет. Значит, Gradle либо запускается на этом JDK (`JAVA_HOME=C:\Android\jdk-17`), либо получает `org.gradle.java.installations.paths=C:/Android/jdk-17`.
  - Новый неотслеживаемый `KrinikCam/tools/env.mjs` (изменён в 20:17) уже ставит `C:\Android\jdk-17` первым кандидатом.
- **Android SDK `C:\Android\Sdk`:**
  - platforms только `android-36` и `android-37.0` — **`android-35` нет**, а у KrinikCam compileSdk 35;
  - build-tools 35.0.0 и 36.0.0; AGP 8.7.x, насколько известно, по умолчанию берёт 34.0.0 (не проверено) — подкачается при принятой лицензии или ставить вручную;
  - NDK `27.0.12077973` и `29.0.14206865`; r27, насколько известно, — NDK по умолчанию для AGP 8.7, так что `.so` от libuvc стрипнутся без явного `ndkVersion` (не проверено);
  - cmake 3.31.6, `licenses/android-sdk-license` на месте;
  - эмулятора, system-images и Android Studio **нет** — только реальные устройства.
- **Установка пакетов SDK:** через `/`, а не `;` — `.bat` режет `;`. Пример: `sdkmanager.bat --sdk_root=C:\Android\Sdk platforms/android-35` (KAST EXP-0003, досье KARTUN).
- **Gradle home.** В `C:\Android\gradle-home\wrapper\dists` лежат 8.13 и 9.8.1. **Gradle 8.10 скачан 2026-10-17 в 20:07 в `C:\Users\krinik\.gradle`** — значит, сборка KrinikCam шла без `GRADLE_USER_HOME`, и кэши разъехались по двум местам.
- **Концы строк.** `core.autocrlf=true` системный. В рабочем дереве KrinikCam `gradlew` с CRLF (`git ls-files --eol` → `i/lf w/crlf`), поэтому `./gradlew` из Git Bash сломается — только `gradlew.bat` (`tools/build.mjs` так и делает на win32). `.gitattributes` нет.
- **adb.**
  - Первым в PATH стоит `C:\adb\adb.exe` 1.0.32; рабочий — `C:\Android\Sdk\platform-tools\adb.exe` 1.0.41 (37.0.1).
  - Старый adb убивает сервер нового, и Wi-Fi-связь с Титаном падает (KARTUN EXP-0026, Tribit EXP-0006).
  - В раздельном туннелировании NordVPN исключён только SDK-adb, поэтому `C:\adb` может не дойти до адресов Tailscale `100.x`.
  - В `.claude/settings.local.json` KrinikTribit разрешён `C:/Android/Sdk/platform-tools/adb.exe *` и запрещены `kill-server`, `reboot`, `tcpip`.
- **Титан общий для всех проектов:** `192.168.1.3:5555` в LAN, адрес Tailscale (в публичный репо не пишем — см. HOUSE_RULES соседей) (в `PROJECT_HISTORY` KrinikCam тот же `192.168.1.3:5555`). UI-агент принимает одного клиента; порты заняты так: 8378 Титан, 8379 A51, 8381 и 8391–8394 — прогоны RC.

**Грабли Windows, которые соседи оплатили:**
- **Git Bash переписывает пути.** `/sdcard/...` превращается в `C:/Program Files/Git/...`. Лечится `MSYS_NO_PATHCONV=1` или вызовом adb из Node `spawnSync` (EXP-0002).
- **Windows-путь в строке Python/JS внутри heredoc.** `\a`, `\f`, `\u` превращаются в управляющие байты. Нужны инструменты Write/Edit, `path.join` и страж `ctrl-char-guard` (EXP-0003, EXP-0017; Tribit EXP-0007).
- **Инструмент Bash и длинные скрипты.** Heredoc с кавычками падает, `\\` схлопывается в `\`, команда длиннее ~9 КБ молча режется, фоновая задача живёт не больше 10 минут. Скрипты писать файлом (EXP-0027 и досье KAST).
- **PowerShell 5.1.** `.ps1` без BOM читается в cp1251, кириллица ломает разбор, поэтому `.ps1` только ASCII (EXP-0025). `Set-Content` без `-Encoding` пишет ANSI.
- **Кириллица в Python:** нужны `PYTHONUTF8=1` и `PYTHONIOENCODING=utf-8`.
- **`sed -i`** превращает файлы с CRLF в LF. Песочница обновления KAIF собирается так: `git -c core.autocrlf=false archive`, `core.longpaths true`, `tar --force-local`.
- **`Copy-Item` сохраняет mtime**, и ninja не видит изменения. Сборку «с правкой» доказывать хешем артефакта (EXP-0022).
- **Остановка фоновой задачи** убивает только обёртку: процесс Git Bash продолжал жать на Титан 7 минут (EXP-0024).
- **Классификатор auto-mode Claude Code.**
  - Цепочка `git add && commit && push` → отказ `[Instruction Poisoning]`. Правило: одно git-действие на вызов, `git commit -m` прямо в строке (не `-F` из scratchpad), `push` отдельно (память `C:\Users\krinik\.claude\projects\d--work-ai-sandbox-KARTUN\memory\commit-always-allowed.md`).
  - Правка своих хуков (`wire-hooks`) → `[Self-Modification]`; её выполняет владелец.
- **Предупреждение «Unable to strip»** встречается в 11 сессиях KARTUN; лечится явным `ndkVersion`.
- **Не найдено в транскриптах** (0 совпадений): «being used by another process», «Filename too long», «daemon disappeared». Блокировок файлов и проблем с демоном не было. Переполнение диска C временными песочницами KAIF (KAIF#110) лечится часовой задачей KAST.

## 2. Досье окружения (с 2.8 оно в `HOUSE_RULES.md` §4, а не в AGENT_GUIDE)

Сводная таблица по `KARTUN/HOUSE_RULES.md` §4, `KrinikTribit/HOUSE_RULES.md` §4, `KAST/HOUSE_RULES.md` (около строк 185–220, самая полная) и пробам на 2026-10-17:

| Факт | Значение | Проба |
|---|---|---|
| ОС | Windows 11 Pro 10.0.26200; ОЗУ 31,9 ГБ | `ver`; `Get-CimInstance Win32_ComputerSystem` |
| Оболочки | Git Bash (bash 5.2.21, MSYS 3.4.9), Windows PowerShell 5.1, cmd; `pwsh` нет | `$PSVersionTable`; `uname -a` |
| Кодовые страницы | ACP 1251, OEMCP 866; PowerShell агента 65001; ANSI по умолчанию windows-1251 | `chcp`; `[Text.Encoding]::Default.WebName` |
| Локаль | Git Bash `LC_CTYPE=C.UTF-8`; PowerShell `Get-Culture` ru-RU (запятая в дробях) | `locale`; `Get-Culture` |
| Node / Python | v24.15.0; Python 3.14.4 (`C:\Python314`), в PATH Git Bash вторым стоит 3.10 | `node -v`; `type -a python` |
| Java в PATH | JDK 21.0.11 (Microsoft) | `java -version` |
| `JAVA_HOME` | ⚠ User → удалённый `.bubblewrap\jdk-17.0.11+9`, перекрывает Machine (JDK 21) | `[Environment]::GetEnvironmentVariable('JAVA_HOME','User')` |
| JDK 17 | `C:\Android\jdk-17` (Temurin 17.0.20.1) | `cat /c/Android/jdk-17/release` |
| Android SDK | `C:\Android\Sdk`, `ANDROID_HOME` не задан; platforms 36 и 37.0; build-tools 35.0.0 и 36.0.0; NDK 27.0.12077973 и 29.0.14206865; cmake 3.31.6 | `ls /c/Android/Sdk/{platforms,build-tools,ndk}` |
| Gradle | только обёртки; `gradle` в PATH нет; кэш соседей — `C:\Android\gradle-home` | `type -a gradle` |
| Android Studio / эмулятор | нет / нет | `ls "C:/Program Files/Android"`; `ls /c/Android/Sdk/emulator` |
| adb | первым `C:\adb\adb.exe` 1.0.32, дальше scrcpy и `C:\Program Files\adb`; рабочий — SDK 1.0.41 | `type -a adb`; `adb version` |
| Пути устройства в Git Bash | ставить `MSYS_NO_PATHCONV=1` | `node -e "console.log(process.argv[1])" /data/local/tmp` |
| Git | 2.43.0; `core.autocrlf=true`; `credential.helper=manager` + `gh auth git-credential` | `git config --show-origin --get core.autocrlf` |
| gh / ImageMagick | `gh` 2.95.0; `magick` 7.1.2-27 | `gh --version`; `magick -version` |
| tar/curl/find в PowerShell | `tar` = bsdtar; `curl` = псевдоним `Invoke-WebRequest` (настоящий — `curl.exe`); `find` = `find.exe` Windows | `Get-Command tar,curl,find -All` |
| Пакетные менеджеры | winget 1.29, choco 1.3.0; scoop нет | `winget --version` |
| Голосовые переменные | `KAIF_VOICE_TOOL`, `KAIF_VOICE` заданы в User (не Machine); в сессии 2026-10-17 процесс их видит | `$env:KAIF_VOICE_TOOL` |

## 3. Интерактивный контур владельца

**Соседи пользуются поставляемым генератором** `.kaif/tools/contour/review.mjs` (вместе с `core.mjs` и `texts.mjs`); самодельного у них нет. Блока `contour` в `kaif.json` нет, поэтому действуют умолчания из `core.mjs` `loadContourConfig`:
- `ownerName` берётся из строки «Author / owner» AGENT_GUIDE = «Mikalai Kryvusha», `callName` = он же — голос так и говорил: «Mikalai Kryvusha, накопилось в KARTUN…»;
- `decisionsDir = interviews/decisions`;
- тихих часов нет.

Как настроено в других проектах:
- KAST: `{"callName":"Николай","spokenProjectName":"КАСТ","quietFrom":"00:00","quietTo":"08:00"}`;
- ndim: `{"ownerName":"Николай Кривуша","callName":"Николай","spokenProjectName":"Эндим Спейс","quietFrom":"23:00","quietTo":"09:00"}`.

**У KrinikCam свой контур** — `tools/owner.mjs` и `tools/owner.config.json`. Он заточен под macOS: `say`, `afplay`, `osascript`, голос Milena, `venv/bin/python`. Конфиг (решения из интервью 017 и 021): owner «Криник», тихие часы 23:00–09:00, `neuralSpeaker` eugene. Поставляемый контур пишет в те же `interviews/decisions/<док>.decision.json`, форма файлов почти совпадает. Очередь у KrinikCam — `_queue.json`, у поставляемого — `queue.json`, так что они не столкнутся.

**Форма интервью, которую принимает `review.mjs --check`** (`texts.mjs` строки 26–75):
- Вопрос — заголовок `### Q1.` или `### В1.` (префиксы `Q|В`). Проверка: старое `interview_025` KrinikCam с `## В1.` и `**Ответ Криника:**` → «блоков 3, узнано 3… отвечено 3… проверка OK».
- Поле ответа: `**Answer:**`, `**Ответ:**` или `**Ответ владельца:**`.
- Варианты: список `- **A) (recommended) …**` (буквы `A-ZА-Я`) или таблица `| **A** |`; последний вариант — `- **D) your own answer** —`. В KARTUN под каждым вариантом сценарий из четырёх строк: Situation / Action / Result / Check.
- Метки: `**Answer target:**` (или «Адресат ответа»), `**Origin:**` (или «Источник»). Шапка: `> Created:` (или `**Создан:**`) и `> Status:`.
- **Строка археологии стоит НАД вариантами:**
  `<!-- archaeology: LC_ALL=C.UTF-8 grep -rniE "<слова>" interviews/ GOAL.md MASTER_PLAN.md plans/ → N hits · read: <файлы|none> · prior: <none | ответ + адрес> -->`
  Допустима и форма `<!-- archaeology: n/a — <причина> -->`.
  - Проверяется только у документов с датой в шапке не раньше 2026-09-18.
  - Отказ, если «N hits» стоит рядом с `read: none` или `prior: none`, если остались `<…>`, а с 2.9 — и на ссылки назад («выше», «см.», «в разделе»).
  - Слова для поиска даёт `node .kaif/tools/contour/review.mjs --search "<слова>"`.

**Запуск из Claude Code** (по транскриптам):
- `node .kaif/tools/contour/review.mjs interviews/<док>.md --silent` с `run_in_background: true`;
- `node .kaif/tools/contour/review.mjs --queue` — тоже в фоне;
- разовые команды: `--check`, `--queue --list`, `--search`, `--call "<фраза>"` (последнюю запускали под `timeout 60`).
- **`--wait` ни в одном из двух проектов не использовался** (0 совпадений).
- В 2.9 действует `WAIT_NO_CONTOUR_MS = 60000`: если за минуту живого контура нет, выход с кодом 2. Ритуал велит сначала поднимать ожидающего.

**Проблемы:**
- **EXP-0028 KARTUN.** `timeout 60 node … review.mjs --queue` убил локальный сервер страницы. Владелец написал «упал твой контур» и вставил JSON ответа со страницы в чат; в `decision.json` записано `"transport": "chat (… killed by the agent's timeout 60)"`.
- Как пришли ответы: в KARTUN 4 из 5 интервью — через страницу; в Tribit 1 через страницу, 002–004 — в чате.
- `.kaif/contour-window/` — профиль окна Edge `--app` внутри проекта, больше 4 МБ. Он должен быть в ignore.

## 4. Голос

- `KAIF_VOICE_TOOL=F:\KLAS\tools\voice-say.mjs` и `KAIF_VOICE=eugene` заданы на уровне User, не Machine. `KAIF_SAPI_VOICE` не задан.
- **Работает.** В транскриптах 18 раз: «CALL: voice — eugene via KAIF_VOICE_TOOL; fallback — system voice of culture …». KAST: через удалённый стол «слышу четко».
- **Что такое `voice-say.mjs`.** Это «РОТ» проекта KLAS: русский TTS Silero, офлайн, на процессоре.
  - Работает через Python-сайдкар: `F:\KLAS\voice\venv\Scripts\python.exe` + `tools/voice/silero_say.py`.
  - Вызов: `node F:\KLAS\tools\voice-say.mjs "<текст>" --voice eugene --play [--out f.wav]`.
  - Пишет wav в `F:\KLAS\voice\out\say-<ts>.wav` и проигрывает его через PowerShell `Media.SoundPlayer.PlaySync()`.
  - Код выхода 2 — «нечего произносить». Голоса: aidar (по умолчанию), baya, kseniya, xenia, eugene, random.
- **Грабли:**
  - KAST: процесс агента, запущенный раньше, чем заданы переменные User, их не видит. Тогда передавать явно: `$env:KAIF_VOICE_TOOL='F:\KLAS\tools\voice-say.mjs'; $env:KAIF_VOICE='eugene'; node .kaif/tools/contour/review.mjs --call "<фраза>"`; флаг `--dry-run` печатает фразу без звука.
  - Без `contour.callName` русский голос зовёт «Mikalai Kryvusha» — задать имя обращения.
  - Голосовой тракт самого KrinikCam (`tools/owner-voice`, venv и модель вне git) на этой машине отсутствует.

## 5. Хуки

- **У соседей** `.claude/settings.json` = 4 хука:
  - SessionStart `compact|clear` → `session-start-refresh.mjs`;
  - UserPromptSubmit → `prompt-refresh-timer.mjs` и `prompt-resume-word.mjs`;
  - Stop → `stop-status-guard.mjs`.
- **Два хука сняты по слову владельца** — `pretool-owner-word` и `stop-owner-answer`. Слова от 2026-10-14 ≈ 20:38: «Убрать это!!!! ИЗ КАИФ НАХУЙ УБРАТ!» и «откуда эта стрелка? … почему ты стоишь и не делаешь» (KAIF#144). Снял их **сам владелец** скриптом `tools/unwire-owner-word-hooks.mjs`: агенту править собственные хуки нельзя.
- **В 2.9 эти два хука удалены.** В `KrinikCam/.kaif/hooks` их нет, а неотслеживаемый `KrinikCam/.claude/settings.json` уже содержит те же 4 хука.
- **Проблемы:**
  - Таймер обновления срабатывает сразу после установки: маркера ещё нет. Tribit лечил перечитыванием канона и штампом `.kaif/refresh-marker.json` (#143, #145).
  - У `checkpoint wire-hooks` нет отказа от отдельных хуков, поэтому только `--verdict`.
  - KAGO 2.9: `wire-hooks` отказан классификатором `[Self-Modification]`. Удалённый хук остался в настройках и падал с node-ошибкой на каждом вызове инструмента, пока владелец не запустил `node .kaif/kaif-core.mjs wire-hooks` сам (#154).
  - KUMM R3: дымовая проверка из README хуков с `printf '…\\n…'` через инструмент Bash даёт ложный отрицательный результат. JSON для неё строить через `node -e`.

## 6. Как прошло обновление KAIF

**Соседи на 2.9 НЕ обновлялись.** Оба поставили 2.8 сборкой WIP 2.9:
- `KARTUN/reports/KAIF_UPDATES/KARTUN_KAIF_2.8_INSTALL_REPORT.md` → issue #143;
- `KrinikTribit/reports/KAIF_UPDATES/Krinik_Tribit_KAIF_2.8_INSTALL_REPORT.md` → issue #145.

Настоящие обновления до 2.9 на этой машине: `D:\work\ai_sandbox\KAGO\reports\KAIF_UPDATES\KAGO_KAIF_2.9_UPDATE_REPORT.md` (2.8 → 2.9, 2026-10-17, #155) и `D:\work\ai_sandbox\KUMM\reports\KAIF_UPDATES\KUMM_KAIF_2.9_UPDATE_REPORT.md` (2.7 → 2.9, #153). Это лучшие образцы.

- **Маршрут.** Оба выбрали bootstrap: загрузчик с `--source <проверенные по sha256 ассеты v2.9>` и прогон в песочнице с `--rehearsal <песочница>/.kaif/last-update.json`. Причина: маршрут `update` запускает задачу старого ядра без списка мест.
  - KrinikCam уже прошёл `core-update` 2.1 → 2.9 (`.kaif/last-update.json`: replaced 13, mergedModules 16, added 38, kept 49; diverged — 25 файлов). Места, которые строятся на отозванном, называет `node .kaif/kaif-core.mjs checkpoint recheck` нового ядра.
- **merge-diverged переведённых файлов.**
  - KAGO: построил рендеры шаблона v2.8 и v2.9, взял чистую разницу между ними и вложил её в локальный русский текст; местные правила сохранил.
  - KUMM: перенёс английские таблицы в русский HOUSE_RULES. Заголовки русские, английское имя секции в скобках (на английские имена ссылаются руководство и навыки); команды, пути и цитаты — дословно.
  - Независимый судья нашёл перевод, переворачивающий логику, и около 34 языковых дефектов. Судья обязателен.
- **end-chat → end-chat-soft / force.** `check` в 2.9 называет незаполненные шаблонные места: `/end-chat-soft` шаги 3–4, `/end-chat-force` шаг 2, `/release` шаги 2, 3, 4, 6. Их заполняют командами проекта (git — отдельными вызовами).
  - Отозванные фразы в зеркалах лечит `node .kaif/kaif-core.mjs sync`.
  - Записи о прошлом (PROJECT_HISTORY, закрытые интервью, журнал решений, EXPERIENCE) остаются как есть, хотя recheck продолжает их перечислять (KUMM R2, #148).
- **stale-claims.** KAGO: 17 строк → 0. Версия в README и в строке KAIF_FRAMEWORK → 2.9; исторические строки помечены `KAIF-VERSION-OK`.
- **placeholders.** `checkpoint placeholders` отвечает «re-synced 175 system skill copies from the canon».
- **Полевой отчёт.**
  - Файл: `reports/KAIF_UPDATES/<Проект>_KAIF_2.9_UPDATE_REPORT.md`. Отправляется `node .kaif/kaif-core.mjs report <файл>` в тот же ход, без вопроса: постоянное разрешение #15/#78. Первой строкой — `**Delivered upstream:** <URL issue>`.
  - Структура: хронология с числами; грабли (тяжесть, дословные доказательства, цена, воспроизведение); что проверено и что НЕТ; пожелания; итог; дословный вердикт судьи; список принятых правил.
- **Базовая линия attribution-lint.** У KrinikCam нет ни `.kaif/attribution-lint.baseline.json`, ни `.kaif/budget-baseline.json`.
  - Пункт `lint-baselines`: `node .kaif/tools/kaif-attribution-lint.mjs check --write-baseline` один раз, без вопроса. Без `--adopt-new` команда отказывается принимать НОВЫЕ находки; KUMM обосновал 6 таких цитатами вместо принятия, у KAGO в долг записано 92.
  - Бюджеты: `node .kaif/kaif-core.mjs check --gate-budgets`.
- **policy-changes.** Правила версии принимаются вместе с версией и перечисляются в отчёте и в прощании. Вопрос владельцу — только при столкновении с его записанным решением; KAGO добавил, что и с памятью агента.
  - **Важно:** владелец в KAGO (addendum §6) — «не нужно начинать с моих слов, это БАГ КАИФ … Его задача - ОТВЕТИТЬ НЕЗАМЕДЛИТЕЛЬНО ВЛАДЕЛЬЦУ и ПРОДОЛЖИТЬ РАБОТУ» (#156).
  - Проверить, что после слияния в `AGENT_GUIDE.md` KrinikCam не осталось «opening with his words». На 2026-10-17 grep даёт 0.
- **Закрытие:** `node .kaif/kaif-core.mjs update-verify` и проход судьи-субагента в чистом контексте. У KUMM первый вердикт был REFUTED, после исправлений — VERIFIED WITH CAVEATS.
- **Грабли установки:**
  - строка `tools/` без якоря в `.gitignore` прятала `.kaif/tools/` (Tribit) — проверять `git check-ignore -v`;
  - строка `KAIF.md` без якоря прятала `.clinerules/kaif.md` и `.roo/rules/kaif.md`; 2.9 переписывает её в `/KAIF.md`;
  - `kaif-voice-lint load` печатает 58–64 КБ — направлять в файл, а не в `head -c`.

## 7. Главные уроки (EXPERIENCE.md)

1. **KARTUN EXP-0026 (#adb).** «only `C:\Android\Sdk\platform-tools\adb.exe` may touch the device — and tools that call bare `adb` inherit PATH, so the PATH is part of the call». Repro: `C:\adb\adb.exe devices`, затем SDK `adb.exe devices` → «version mismatch» и пустой список.
2. **Tribit EXP-0006.** Та же ловушка ударила второй раз. Теперь скрипты зовут adb полным путём; в разовой строке PowerShell SDK ставится первым в PATH в той же строке. Repro: `grep -n '"adb"' tools/*.py testcases/*.py` → пусто.
3. **KARTUN EXP-0002 (#shell).** «any argv word that starts with `/` is a Windows path to Git Bash». Repro: `export MSYS_NO_PATHCONV=1; C:/Android/Sdk/platform-tools/adb.exe shell ls -la /data/local/tmp`.
4. **KARTUN EXP-0017 / EXP-0003, Tribit EXP-0007 (#escaping).** Windows-путь в строковом литерале скрипта — минное поле: «platform-tools<BEL>db.exe». Repro: `node tools/ctrl-char-guard.mjs <файл>` → `CONTROL 0x07`, exit 1. Страж стоит в pre-commit.
5. **KARTUN EXP-0027 (#bash).** «a script longer than a few lines, or one with quotes of its own, travels as a FILE (Write → run), never as a heredoc». Repro: `python - <<'EOF'` с `'''` → parse error, exit 2.
6. **KARTUN EXP-0025 (#powershell #windows).** «A `.ps1` is ASCII-only unless saved UTF-8 WITH BOM». Repro: `.ps1` с кириллицей без BOM → `TerminatorExpectedAtEndOfString`.
7. **KARTUN EXP-0028 (#contour).** «the queue command SERVES the page — run it in the background … never under `timeout`». Repro: `timeout 60 … review.mjs --queue`, ответ через 60 с не уходит.
8. **KARTUN EXP-0033 (#mutation).** «a mutation is undone from a copy taken right before it, in a `finally`, never by `git checkout`». Repro: при непустом `git diff --stat <file>` checkout стёр бы незакоммиченную работу.
9. **KARTUN EXP-0024 и EXP-0030 (#device #owner).** Касание чужого устройства законно только после проверки фокуса. Слепые касания трижды открыли NDim владельца, а выключение экрана заблокировало его планшет. Repro: `adb shell dumpsys window | grep mCurrentFocus` и `| grep isKeyguardShowing`. Механизировано в `tools/titan-tap.mjs`.
10. **KARTUN EXP-0022 (#build).** «a build "with the change" is proved by the artifact's own content … never by the build exiting 0». Repro: `sha256sum a.apk b.apk` должны различаться.
11. **KARTUN EXP-0015 (#harness).** Прежде чем назвать что-то медленным или сломанным, исключить сам стенд. Repro: `dumpsys gfxinfo <pkg> reset; sleep 3; … | grep 'Total frames'` → 0 означает, что виноват стенд.
12. **KARTUN EXP-0035 (#release #guard).** Второе попадание в один класс за день означает, что первая правка закрыла случай, а не класс. Замороженный RC поверх `[NOT-TESTED]` упал на каждой свежей установке. Страж — `InitLastGuardTest`.
13. **Tribit EXP-0008 (#testing).** «tick "tested" only for what the run walked … to the END of the feature». Механизировано: `tools/check_tested_ticks.py`.
14. **Tribit EXP-0005.** Перед работой с устройством читать house rules соседей: UI-агент уже был описан в KARTUN §6.

Память Claude у KARTUN (`C:\Users\krinik\.claude\projects\d--work-ai-sandbox-KARTUN\memory\`), три записи:
- вопрос владельца посреди работы — сразу текстовый ответ; «Тестирование — ЭТО ТВОЯ ОБЯЗАННОСТЬ»;
- коммит и пуш всегда разрешены, по одному действию на вызов;
- UI водить только по локаторам. Слова владельца: «Ты нажимал на экран тупо по пикселям — это неправильно!».

## 8. Почему KARTUN дошёл до полного приложения

- **Лестница планирования.**
  - `researches/` (разведка до кода) → `MASTER_PLAN.md` с журналом решений `[OWNER]` → `plans/01_EPIC_mvp.md`.
  - Эпик держит цель, пронумерованные критерии приёмки с проверкой у каждого, фазы и ворота, технические решения, риски.
  - Детализируется только ближайшая фаза (`plans/02_epic01_F0…`, `03_epic01_F2…`). Развилки уходят в интервью с вариантами-сценариями.
- **Дизайн.** HTML-макеты в `design/` → снимки Playwright (`tools/shoot-mockups.mjs`) → владелец выбирает.
- **Тесты.** Всё проверяется на реальных устройствах: Титан, Redmi Note 12 Pro+, S21 FE, A52, A51. Эмулятора здесь нет.
  - `testcases/TC_*.md` (таблица ID / Case / Steps / Expected) → отчёты `testcases/reports/` (39 штук). Разделы отчёта: Work / Contour / Runs / Checks / Found / Traces / Verdict. Проверяются `kaif-testrun-lint` (219 вызовов) и `kaif-scenario-lint`.
  - Дымовой прогон RC: «раздай тест кейсы субагентам» — по субагенту на устройство, у каждого свой порт UI-агента (8391–8394) и свой scratch `%TEMP%\rc4\<устройство>`.
  - RC1–RC7 на замороженном APK; `versionCode` = число коммитов.
- **Правила владельца R1–R7** записаны в HOUSE_RULES с дословными цитатами `[OWNER]`. Журнал крешей встроен в приложение. Каждый документ для агентов проверяется свежим субагентом (EXP-0032).

## 9. Разведдоки (researches/, plans/)

**KARTUN** (все `D:\work\ai_sandbox\KARTUN\researches\`, 2026-10-14…16):
- **01_krinikcam_style_and_stack (10-14) — ПРЯМО применимо: это разведка самого KrinikCam**, HEAD d33c055.
  - Стиль: акцент `#FF1A8C`, фон `#0D0D0D`, поверхности `#1A1A1A`/`#2A2A2A`, радиус 10dp, отступ 16dp, `tnum`, снекбары сверху, кнопка [i] у каждой настройки.
  - Найденный дрейф: экраны хардкодят цвета мимо темы (`#888888` — 30 раз); нет Slider и индикаторов прогресса; иконка без monochrome-слоя; нет проверки полноты переводов. Список «Adapt» оттуда — готовый беклог.
- **03_engine_licenses_and_android_platform (10-14) — частично (§D/E прямо).**
  - FGS `mediaProcessing`: лимит 6 ч на 24 ч, обязателен `onTimeout`.
  - `PARTIAL_WAKE_LOCK` дольше 2 ч за 24 ч Play vitals помечает.
  - Android 17 Memory Limiter: процесс с FGS считается невидимым.
  - Google Play: targetSdk 36 обязателен с 2026-08-31, продление до 11-01; страницы памяти 16 KB.
  - Языки: `generateLocaleConfig = true`, поддержка RTL.
- **05_large_results_streaming (10-14) — не применимо.** Построчные кодеры, `BitmapRegionDecoder`.
- **06_agent_station (10-14) — ПРЯМО.**
  - `adb shell content call` даёт синхронный ответ (Bundle).
  - Сервер в LAN держать в FGS `connectedDevice`.
  - Android 17 при targetSdk 37: входящий TCP требует `ACCESS_LOCAL_NETWORK`. Проверить, нужно ли оно для исходящего RTMP/SRT на LAN-адреса.
- **09_lossless_scaling_and_video (10-15) — частично (видео прямо).**
  - Цепочка без ffmpeg: MediaExtractor → MediaCodec (декодер) → MediaCodec (HEVC) → MediaMuxer.
  - **ffmpeg-kit закрыт в 2025**, бинарники сняты.
  - H.264 в HD — только SHOULD: проверять `VideoCapabilities.areSizeAndRateSupported`.
- **10_agent_api_recon (10-16) — ПРЯМО** (подробности в п. 11).
  - `am start-foreground-service` из shell разрешён в фоне; защита сервиса — `permission=DUMP`.
  - Статус задания — атомарный JSON, читать `exec-out cat`; logcat отвергнут.
  - Ktor CIO не умеет серверный TLS; у NanoHTTPD CVE-2020-13697 и CVE-2022-21230.
- **Не применимо:** 02 (Upscayl, AGPL — только поведение), 04 (выжимка GOAL; переносима только практика «выжимка над архивом владельца»), 07, 08 (DAT2/ncnn; урок «проверять на реальном GPU»), 11, 12, 13 (модели).
- **plans/ с практиками:**
  - `06_EPIC_agent_api.md` §4–§6;
  - `07_epic06_A_adb_api.md` — протокол, шаг 1 «Device spike», риски Wi-Fi-adb;
  - `01_EPIC_mvp.md` §4–§5;
  - `04_epic01_F1` шаг 3 — замер PSS через `dumpsys meminfo` до кода;
  - `08_release_1_0.md` — `apksigner verify --print-certs`, ключи в `.env` вне git, versionCode = число коммитов.

**KrinikTribit** (все 2026-10-15/16):
- **08_ui_ux_beauty_recon — ПРЯМО: стиль Криника и Material 3.**
  - Мерка красоты владельца: «глаз не видит швов»; 7 классов проверки экрана K1–K7.
  - Цель касания 48dp; контраст текста ≥ 4.5:1, контролов ≥ 3:1.
  - Edge-to-edge принудителен при targetSdk 35 на Android 15.
  - Выбор вида — только листом HTML-макетов со снимками Playwright.
- **11_own_app — ПРЯМО (§4.5, §4a, §4b).**
  - Скорость Compose: R8, Baseline Profile, ключи в lazy-списках, холодный старт через `am start -S -W`.
  - Модель KARTUN: одна activity, enum-роутер, `BackHandler`, один поток движка.
  - Жизненный цикл подключения: приёмники в onStart/onStop, без слепых циклов переподключения, одна команда в полёте, явная машина состояний, FGS `connectedDevice`. Ложится на USB UVC.
- **05_layouts_and_defects — частично.** Каталог анти-паттернов переподключения и вёрстки под планшет и альбомную ориентацию; `WindowInsets` против кнопок под нав-баром.
- **09_likes_dislikes — частично.** Чек-лист: плюралы, одна система сообщений, без обрезки многоточием, без логов тел запросов в релизе.
- **04_locales_externalization — частично.** Генератор и валидатор `values-xx`, проверка «0 литералов в коде».
- **02_languages — частично.** Метод выбора языков (уровни посчитаны для рынка Tribit).
- **Не применимо:** 01, 03, 06 (полезно только если появятся трекинговые SDK: флаги Firebase), 07, 10, 12.
- **plans/:**
  - `05_epic04_phase1` шаги 8–11 — Bluetooth «done right»; StrictMode в debug нашёл чтение диска 115 мс на главном потоке;
  - `07_epic04_phase3` — родные компоненты M3, `BoxWithConstraints`, `configChanges` для полноэкранного редактора.
- **Нет** разведки по WindowSizeClass, LocaleManager, Hilt и многомодульности, жизненному циклу FGS.

## 10. Инструменты автоматизации тестов KARTUN (полный список)

**Архитектура.** Единого CLI нет. Есть набор маленьких инструментов на Node и Python, и у них общие правила:
- шапка `[TESTED: дата · доказательство]` или `[NOT-TESTED]`;
- adb всегда полным путём через `spawnSync`, без shell;
- на стороне приложения — дверь только для debug (интент-экстры) плюс JSON-строки в logcat плюс файлы в `files/` приложения;
- сценарии в `testcases/TC_*.md`, отчёты на каждое устройство в `testcases/reports/`.

**Инвентарь** (файл → что делает → вызов → среда → что наблюдает):

| Инструмент | Что делает | Вызов | Среда | Что наблюдает |
|---|---|---|---|---|
| UI-агент `C:\Android\private\ui-agent\ui.py` + APK `evegf.app.macrobenchmark`, описание `UI_AGENT.md` | на устройстве живёт агент UiAutomation, держит сокет через adb forward; 10–50 мс на команду; `wait` возвращается по accessibility-событию, а не опросом; водит любое приложение | `$env:PATH="C:\Android\Sdk\platform-tools;$env:PATH"; $env:PYTHONUTF8="1"; python C:\Android\private\ui-agent\ui.py --serial <s> [--port N] --start ping`, дальше `"wait <т> [ms]"`, `"waitGone"`, `"find"`, `"tapText <т>"`, `"tap x y"`, `"type"`, `"input"`, `"back"`, `labels`, `tree`, `"shot f"`; Python: `from ui import Agent` | устройство | дерево доступности, подписи |
| `tools/titan-probe.mjs` | отладочная проба движка: `am start -S -n <pkg>/.MainActivity --es in … --es model … --ez gpu … --ei tile …` (`app/src/debug/.../DebugTools.kt` читает экстры) | `node tools/titan-probe.mjs --in test256.png --model … --gpu true --tile 200 [--ref x.png]` | устройство + ПК | ждёт JSON-строку `{"ok":true,…}` через `logcat -d -T <since> -s KARTUN_PROBE:* AndroidRuntime:E` (без `logcat -c`); тянет результат; PSNR через `magick compare -metric PSNR`; при выходе возвращает интерфейс (EXP-0010) |
| `tools/kartun-cli.mjs` | клиент API для агентов (п. 11), он же e2e-драйвер | `info`, `models`, `upscale`, `status`, `cancel` | устройство | одна строка JSON, коды выхода 0/1/2/3 |
| `tools/format-matrix.mjs` | 16 форматов, сделанных ImageMagick, → через CLI → сравнение с PNG | `KARTUN_SERIAL=… node tools/format-matrix.mjs <фото> <папка>` | устройство + ПК | PSNR; exit 1, если формат не открылся или формат без потерь дал другой результат |
| `tools/shoot-readme.mjs` | проходит путь пользователя по тексту и content-desc из дерева uiautomator; фото вводит через `ACTION_VIEW` с id MediaStore; чистый статус-бар через demo mode; переключает язык | `node tools/shoot-readme.mjs --lang all` | устройство | WebP 540 px |
| `tools/titan-tap.mjs` | касание со страховкой: проверяет `mWakefulness=Awake`, `isKeyguardShowing=false`, `mCurrentFocus` = KARTUN, иначе exit 2 | `node tools/titan-tap.mjs x y` | устройство | — |
| `tools/a11y-scan.py` | `uiautomator dump`: у каждого кликабельного или фокусируемого узла должно быть имя (TalkBack) | `python -I tools/a11y-scan.py --serial …` | устройство | exit 1 со списком безымянных узлов |
| `seam-check.py`, `tile-replay.py`, `dat-blob-stats.py` (сверка с logcat `blobstat`), `compare-models.py`, `blind-sheet.py` | метрики изображений движка | — | ПК | численные метрики |
| `shoot-mockups.mjs`, `shoot-processing-variants.mjs` | снимки HTML-макетов | — | браузер (Playwright) | снимки |
| `check-app-names.mjs`, `ctrl-char-guard.mjs`, `stamp-guard.mjs` | стражи в `.git/hooks/pre-commit` | — | ПК | — |
| `catalogue.mjs --check`, `make-translations.py --check`, `make-vector-icon.py --check`, `stage-models.mjs` | стражи дрейфа сгенерированных файлов (последний — SHA-256 моделей) | — | ПК | — |

**Наблюдатели внутри приложения:**
- `DeviceBench.kt` пишет в logcat `{"bench":true,"gpu_ms":…}`.
- `CrashLog.kt` ведёт журнал в `files/crashes/`: tombstone и ANR из `ApplicationExitInfo`, `engine-stderr.log`.
- `AgentService` — это ещё и тестовая поверхность.
- Модуль `probe/` — APK с другим uid для проверки отказа в разрешении.

**JUnit:** 19 файлов в `app/src/test`, запуск `.\gradlew.bat testDebugUnitTest`. Среди них стражи, которые читают исходники: `InitLastGuardTest`, `EngineThreadGuardTest`.

**Команды-метрики:**
- `am start -S -W` — холодный старт;
- `dumpsys gfxinfo | grep 'Total frames'`; `dumpsys meminfo` — PSS;
- `dumpsys activity activities | grep topResumedActivity` — до и после;
- `logcat -b crash`;
- `content query --uri content://media/external/images/media` — сохранённые файлы;
- `cmd locale set-app-locales <pkg> --locales ar`; `settings put system user_rotation 1`; `cmd power set-mode 1`.

**Снимки экрана:** `adb exec-out screencap -p | magick png:- -resize 500x -quality 80 x.webp` (правило R4: WebP, не PNG). OCR, компьютерного зрения и записи видео **не найдено**.

**Добавки Tribit:**
- `tools/screen_profile.py apply titan --land | reset` — превращает телефон в экран другого устройства (`wm size`, density, поворот) и возвращает родной режим поворота;
- `testcases/snap.py <папка> <имя> "<команда агента>"` — один шаг прогона: действие, снимок WebP, подписи экрана;
- `tools/check_tested_ticks.py` — галочка «проверено» должна называть существующий отчёт.

**Как доказывают, что тест умеет краснеть:**
- Заголовок `@guard` с полями `THREAT / PROVED-AGAINST / GAP / ON-REAL-PATH`; его проверяет `kaif-guard-lint`.
- Мутант: PowerShell-скрипт портит файл, гоняет тест и восстанавливает текст в `finally` (печатает `restored: True`, EXP-0033).
- Страж прогоняют против исторически плохого коммита: `InitLastGuardTest` краснеет на 3c8ca15.
- Мутант от судьи (KUMM).

**Что взять в KrinikCam, по ценности:**
1. Подключить UI-агента с C: как основной движок `tools/ui.mjs`: сейчас там `uiautomator dump` по ~3 с. Риск — живое превью камеры: проверить, что `wait`/`labels` работают при постоянной перерисовке.
2. Отладочный и API-вход со статусом в JSON-файле, записанном атомарно, и чтение через `exec-out cat`. Логи читать через `logcat -T <since>`, никогда не `logcat -c`.
3. `testcases/TC_*` плюс отчёты на устройство с `kaif-testrun-lint`; параллельные субагенты по устройствам, у каждого свой порт UI-агента.
4. Касание со страховкой (бодрствует, не заблокирован, фокус наш) — Титан общий.
5. `screen_profile.py` для ландшафта на телефоне (bugs/81).
6. `a11y-scan.py`.
7. Журнал крешей через `ApplicationExitInfo` в приложении — у KrinikCam нативный libuvc.
8. JUnit-стражи с `@guard` и pre-commit-стражи (`ctrl-char`, `stamp`).
9. Метрики: `am start -W`, gfxinfo, PSS, `topResumedActivity` до и после.
10. Матрица по образцу `format-matrix` для `smoke.mjs`: разрешения, кодеки, битрейты и `VideoCapabilities`, с ассертами ffprobe.
11. Проверка документа для агентов свежим субагентом.
12. Шаблон мутанта с восстановлением в `finally`.

## 11. Управление KARTUN снаружи: ADB, HTTP, MCP

**(а) ADB — СДЕЛАНО** (фаза A, 2026-10-16). Отчёты: `testcases/reports/2026-10-16_epic06_A_*.md`.
- Сервис в манифесте:
  ```xml
  <service android:name=".agent.AgentService" android:exported="true"
           android:permission="android.permission.DUMP"
           android:foregroundServiceType="mediaProcessing|dataSync" />
  ```
  Разрешение `DUMP` есть только у adb shell. Дверь есть в обеих сборках (интервью #005, Q3 = A).
- Команды: `adb shell am start-foreground-service -n <pkg>/com.kriniks.kartun.agent.AgentService -a com.kriniks.kartun.agent.{INFO|UPSCALE|CANCEL} --es job <id> --es in <job>.in.jpg --es model default --ei scale 4 --es format png --ei quality 92 [--ez gpu]`.
- Обмен файлами в `/sdcard/Android/data/<pkg>/files/agent/`: вход — `push`; статус `<job>.json` пишется атомарно (`.tmp` + rename) и читается `adb exec-out cat` раз в 0,5 с; результат — `pull`; `info.json`. Через 24 ч приложение само чистит файлы.
- Устройство сервиса (`AgentService.kt`, 332 строки):
  - `startForeground` вызывается первым делом — обещание 10 секунд;
  - id задания `[A-Za-z0-9_-]{8,64}`;
  - один поток движка, очередь FIFO, больше 8 в очереди → `busy`;
  - `onTimeout` → `quota`.
- Коды ошибок: `bad_request`, `input_missing`, `decode_failed`, `too_big`, `model_not_installed`, `engine_failed`, `busy`, `quota`, `internal`.
- ПК: `tools/kartun-cli.mjs` (258 строк, только встроенные модули Node). Документ: `docs/agent-api.md` (157 строк) — сырой протокол для агентов без Node.
- **Почему такой путь** (`researches/10`, `06`):
  - `am broadcast` не может запустить FGS из фона;
  - `am start` отнимает экран;
  - `am start-foreground-service` от shell разрешён в фоне и даже при убитом приложении;
  - logcat отвергнут: требует `logcat -c` и переполняется;
  - `content call` даёт синхронный Bundle — рассматривался.
- **Грабли:**
  - EXP-0031: `run-as` проверяет свой же uid, а видимость пакетов прячет релизную сборку. Отказ доказан только отдельным `probe/` APK с `<queries>` → `Permission Denial … requires android.permission.DUMP`.
  - `adb push` сохраняет mtime ПК, поэтому чистка ориентируется на статус-файл, записанный приложением.
  - EXP-0030: выключение экрана блокирует устройство владельца.
  - Doze глушит сеть даже у FGS.
  - Wi-Fi-adb рвётся, когда засыпает Wi-Fi устройства.
- Критерии A1–A10, среди них: A4 — без экрана, сверка `topResumedActivity` до и после; A7 — отказ чужому uid; A8 — свежий субагент работает по одному документу.

**(б) HTTP в локальной сети — НЕ реализован.** Спроектирован в `plans/06_EPIC_agent_api.md` (фаза B, §4.6–4.7, §6), отложен словом владельца 2026-10-16 ≈ 16:10: «давай после. Пока хватит в 1.0 ADB API».
- Проект: Ktor (Apache-2.0) внутри FGS `connectedDevice`; переключатель «Станция для ИИ-агентов» в Настройках показывает IP:порт; порт по умолчанию `[AI]` 8765.
- Эндпоинты: `GET /` описывает API; `curl --data-binary @x.png "http://<ip>:<порт>/v1/upscale?scale=4&wait=1" -o out.png`; `/v1/jobs/<128-битный id>` (списка заданий нет).
- Тот же JSON, что и в ADB-статусе; в CLI появляется `--host <ip>:<порт>`.
- Android 17 требует `ACCESS_LOCAL_NETWORK`; на Android 16 то же поведение включается флагом `RESTRICT_LOCAL_NETWORK`.
- Ответы владельца в #005:
  - HTTP без TLS;
  - ключа по умолчанию нет, есть переключатель «Требовать ключ» (Bearer);
  - станция есть в обеих сборках;
  - переключатель помнит состояние и поднимает сервер при запуске;
  - «локальная сеть» = частные диапазоны плюс Tailscale `100.64.0.0/10`.
- Грабли из разведки: Ktor CIO без серверного TLS (нужен Netty); CVE у NanoHTTPD; права `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `CHANGE_NETWORK_STATE` и `CHANGE_WIFI_STATE`.

**(в) MCP — в KARTUN НЕ реализован.** План — фаза C, «MCP-сервер поверх CLI» (§6.6). Владелец сначала ответил «сразу после A», затем отложил до после 1.0. Критерий в интервью: `claude mcp list` показывает `kartun`, вызов инструмента возвращает путь к PNG. `.mcp.json` в KARTUN нет; в `~/.claude.json` глобально стоит только `posthog`.
- **Рабочий образец MCP на машине — KUIPS:**
  - `D:\work\ai_sandbox\KUIPS\src\mcp.mjs` — 194 строки, stdio, ноль зависимостей;
  - поддерживает две эпохи протокола: 2026-07-28 без рукопожатия (`server/discover`, `_meta`) и старую с `initialize`;
  - инструменты `kuips_build`, `kuips_check`, `kuips_layout`, `kuips_screens`, `kuips_shoot`, `kuips_crop`;
  - тест `test/mcp.test.mjs`, разведка `researches/02_mcp_spec_recon.md`;
  - подключение — `.mcp.json` проекта: `{"mcpServers":{"kuips":{"command":"node","args":["bin/kuips.mjs","mcp","--root","examples/brewlog"]}}}`;
  - слово владельца там: «API, CLI, MCP — Все три в 1.0».
- Для KrinikCam напрашивается та же форма: Node-мост `tools/<cli>.mjs mcp` поверх adb- и HTTP-дверей.
