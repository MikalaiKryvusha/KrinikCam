# KrinikCam — AI Agent Guide

Этот файл читается AI-агентом перед каждой задачей.

> 🧠 **ГЛАВНЫЙ ПРИНЦИП — ПРОСТОТА (читай `PHILOSOPHY.md`).** Если что-то долго не получается — это НЕ
> сложная задача и НЕ баг библиотеки, а агент ДЕЛАЕТ СЛИШКОМ СЛОЖНО, потому что НЕ ПОНЯЛ ЗАДАЧУ.
> Всё должно делаться просто (KISS + Бритва Оккама). Не получается → переосмысли понимание задачи,
> ищи штатный простой путь, НЕ усложняй. Затык ≠ «копать сложнее», затык = «упростить понимание».

> 🤖 **АВТОНОМНЫЙ РЕЖИМ — сам запускай `/autoloop`.** Если Криник отошёл / дал автономию и нет
> активной интерактивной задачи, а в `STATUS.md` есть незакрытый «🤖 АВТОНОМНЫЙ ПУЛ ЗАДАЧ» (задачи без
> камеры/стрима/Криника) и устройство доступно — агент ДОЛЖЕН сам, по своей инициативе, войти в навык
> **`/autoloop`** (через Skill-инструмент) и грайндить пул серией, коммитя прогресс и самоперезапуская
> цикл после каждой задачи. Останавливайся только когда пул исчерпан, нужна камера/стрим/Криник, или
> Криник сказал стоп. Не уходи в луп, если Криник дал конкретную интерактивную задачу прямо сейчас.

---

## Перед каждой задачей — чеклист

```
1. Прочитать STATUS.md                # текущий статус: что сделано, где находимся, что дальше
2. git status                         # что изменено, что не закоммичено
3. git log --oneline -5               # где находимся в истории
4. Прочитать MEMORY.md                # /memory/MEMORY.md — профиль пользователя, ключевые решения
5. Прочитать нужный план из plans/    # если задача связана с конкретной фичей
6. Запустить build (если трогаешь код)# JAVA_HOME=AS_JBR node tools/build.mjs --no-ui
7. Для тестирования приложения — ОБЯЗАТЕЛЬНО загляни в `tools/UI_AUTOMATION_GUIDE.md` и активно
   пользуйся `tools/ui.mjs` (dump/tap/find + `allow` — сам одобряет системные диалоги
   разрешений, `kill/start/restart` — освобождает камеру между dev/release, `screen` — JPEG-скрин).
   Инструмент активно развивай под нужды тестирования.
8. Обязательное комментирование кода, отдельных его блоков, классов, модулей, важных строк.
9. Сбор знаний, обдумывание и рефлексия по багам, которые фикшу, в отдельных md файлах по каждому багу в директории bugs. Руководствоваться гайдлайном BUG_FIXING_FRAMEWORK.md при фиксинге багов.
10. Регулярно перечитывать ключевые гайдлайн документы:
- PHILOSOPHY.md  ← принцип простоты (KISS + Оккам); если застрял — сначала сюда
- AGENT_GUIDE.md
- STATUS.md
- BUG_FIXING_FRAMEWORK.md
При необходимости их редактировать, чтобы повысить эффективность автономной работы ИИ агента над проектом в условиях периодического забывания контекста между отдельными сессиями работы ИИ агента. Ключевые гайдлайн документы нужно обновлять и наполнять, чтобы они были полезны эффективно включиться в работу и контекст проекта даже с пустым начальным контекстом новой сессии работы ИИ агента.
11. В процессе работы хоть немного но писать в чат на естественном языке о том, что сейчас делаю, чтобы давать Кринику понимание того, над чем работаю.
12. Документы от Криника с идеями, багами, фичами и прочим - читай, правь опечатки, минимально редактируй под структурный ИИ формат для оптимального понимания ИИ агентами таких документов. После реализации фичи или фикса баго по таким документам, пиши в документах статус, дату реализации.
```

→ **`STATUS.md`** — главный файл состояния проекта. Обновляй его после каждой значимой задачи.


---

## Цель проекта

KrinikCam — Android-приложение (Kotlin, Compose) для Mikalai Kryvusha (KOT KRINIK, стример).
Подключает USB-вебкамеру через OTG → fullscreen превью → RTMP-стрим на YouTube/Twitch/etc.

---

## Названия и идентификаторы (КАНОН — используй эти, не выдумывай)

| Где | Имя |
|-----|-----|
| **Имя приложения / бренд** (UI, README, доки, тексты) | **KrinikCam** |
| **Краткое имя** | KCam |
| **GitHub репозиторий** | `KrinikCam` → https://github.com/MikalaiKryvusha/KrinikCam |
| **Android package** | `com.kriniks.kcam` |
| **Gradle rootProject.name** | `KrinikCam` |
| **Локальная папка проекта** | `KrinikCam` → `/Users/kryvusha/ai_sandbox/KrinikCam` |

> ⚠️ Старое длинное имя `KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING` (слаг репо) и
> `KRINIKS_ANDROID_USB_WEB_CAMERA_FOR_STREAMING` (старое имя папки) **больше не используются** —
> и репозиторий, и локальная папка переименованы в `KrinikCam` (2026-06-28). В новых текстах/URL/путях
> пиши только `KrinikCam`. Если встретишь старое имя в исторических доках — можно заменить на `KrinikCam`.

---

## Текущее состояние

| Фаза | Статус | Что сделано |
|------|--------|-------------|
| Phase 0 | ✅ done | Gradle skeleton, CI, build-ui tool |
| Phase 1 | ✅ done | USB UVC preview, RTMP stream, DeviceManager, Room/DataStore profiles, CodecScanner, logging, UI (MainScreen, radial FAB, Platforms overlay, StandbyPlaceholder) |
| Phase 2 MVP | ✅ done | RTMP от USB-камеры работает (Go Live → YouTube ✅, подтверждено 2026-06-28). Bug 02 закрыт. |
| Phase 2 P1+ | 🔲 todo | Standby-кадр в поток (BaseFilterRender), multi-stream, Camera2 fallback, UX-улучшения |

---

## Архитектура — модули

```
:app                    ← главный модуль, зависит от всех feature
:core:common            ← базовые утилиты (нет внешних зависимостей)
:core:ui                ← Compose тема, цвета, типографика
:core:logging           ← KLog + FileLogger (write-to-file + share intent)
:data:profiles          ← Room DB + DataStore (StreamProfile, DeviceProfile)
:feature:usb            ← AndroidUSBCamera, USB hot-plug, UvcPreviewView
:feature:capture        ← DeviceManager (приоритет источника: UVC→phone→none)
:feature:codec          ← CodecScanner (MediaCodecList → DeviceProfile)
:feature:streaming      ← RootEncoder RTMP, StreamViewModel, StreamPlatformsOverlay
```

**ПРАВИЛО:** feature-модули не зависят друг от друга. Только `:app` зависит от всех.
Мосты между feature — через `:app` (например, `LaunchedEffect` в `MainScreen.kt`).

---

## Сборка

```bash
# ВАЖНО: system java_home может вернуть Java 25 (Temurin) — она сломает сборку
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
node tools/build.mjs --no-ui        # headless (для скриптов)
node tools/build.mjs                # с UI прогресс-баром в браузере
```

Проверить только ошибки:
```bash
export JAVA_HOME="..." && node tools/build.mjs --no-ui 2>&1 | grep "^e:"
```

---

## Ключевые библиотеки и их особенности

### AndroidUSBCamera 3.2.7 (`com.github.jiangdongguo.AndroidUSBCamera:libausbc`)
- Класс камеры: `MultiCameraClient.Camera` (не `CameraUVC` — её нет в 3.x)
- Callback: `com.jiangdg.ausbc.callback.IDeviceConnectCallBack` (не вложен в `MultiCameraClient`)
- Опечатка в API: `onDetachDec` / `onDisConnectDec` (не `Dev`)
- Состояние: `ICameraStateCallBack.State` (OPENED/CLOSED/ERROR), не `Code`
- Открыть превью: `camera.openCamera(textureView, cameraRequest?)`
- `libuvc` нужен как `compileOnly` — в POM он `runtime`, но его тип торчит в публичном интерфейсе

### RootEncoder 2.4.7 (`com.github.pedroSG94.RootEncoder:library`)
- Мы используем `RtmpStream` (`com.pedro.library.rtmp.RtmpStream`) + кастомный `UvcVideoSource`,
  а НЕ `RtmpCamera1` (RtmpCamera1 открывает Camera1/Camera2 API → конфликт с USB UVC → краш)
- Интерфейс: `com.pedro.common.ConnectChecker`
- Коллбэки без суффикса: `onConnectionSuccess()`, `onConnectionFailed(reason)`, etc.
- ⚠️ **`RtmpStream` (StreamBase).prepareVideo: `(width, height, bitrate, fps=30, iFrameInterval=2, rotation=0, ...)`**
  — BITRATE 3-й параметр, FPS 4-й! НЕ путать со старым `RtmpCamera1.prepareVideo(w,h,fps,bitrate,rotation)`.
  Перепутанный порядок (fps↔bitrate) = энкодер с битрейтом ~30 бит/с = пустой видеотрек =
  YouTube получает только звук = Broken Pipe через 15с. **(Баг 02, исправлен 2026-06-28.)**
- ⚠️ **Ориентация для USB-камеры:** `prepareVideo(rotation=0)` внутри зовёт
  `glInterface.setCameraOrientation(270)` (поворот входа камеры на 90° CCW — для телефонных
  сенсоров). USB-вебка уже выдаёт ровный landscape → после `prepareVideo` обязательно
  `stream.getGlInterface().setCameraOrientation(0)`, иначе стрим повёрнут и растянут. **(Баг 02 A.)**
- `setCustomImageToStream()` удалён → используй `glInterface.setFilter(BaseFilterRender)` для статик-кадра
- GL-поток рисует в encoder через `streamOrientation` (`setStreamRotation`), в preview — через
  `previewOrientation` (`setPreviewRotation`); `setCameraOrientation` крутит общий вход камеры (оба)

### Compose Material3
- `ExposedDropdownMenuBox` и `menuAnchor()` — экспериментальные, нужен `@OptIn(ExperimentalMaterial3Api::class)`

---

## Интервью перед каждой новой фичей

Перед реализацией каждой Phase — проводи интервью с Krinik по шаблону:
`interviews/interview_NNN_<phase_name>.md`

Задай конкретные закрытые вопросы (A/B/C варианты), получи ответы, зафиксируй решения, потом пиши код. Никогда не делай UI/UX решения без подтверждения.

---

## Меню «Для разработчиков» (dev-функционал) — Idea 07

В приложении есть СКРЫТЫЙ экран **Developer**: открывается **лонг-тапом** по строке «KrinikCam» в
Settings → About. Доступен в ЛЮБОЙ сборке (release == debug; никакой «магии» только в debug).

**Правило:** любой отладочный/разработческий функционал выноси СЮДА (тумблеры в стиле приложения +
кнопка [i] с описанием), а НЕ делай его debug-only через `BuildConfig.DEBUG`. Так release и debug
не расходятся по фичам — кто знает про лонг-тап, тот найдёт; остальные не догадаются.

Файлы: `dev/DevSettings.kt` (персист через SharedPreferences), `ui/screens/DevMenuScreen.kt` (UI),
роут `developer` в `NavGraph.kt`. Первый пункт — тумблер «Вращение по ADB» (см. `ui.mjs orient`).

---

## Git-воркфлоу (решение Криника 2026-06-30)

**Работаем ТОЛЬКО в `main`. Feature-ветки НЕ заводим.** Криник смотрит дерево файлов и теряется при
переключении веток (файлы «пропадают»). Поэтому:
- Вся работа коммитится в `main`, инкрементально и часто.
- Нужно откатиться — смотрим историю git (`git log`, `git revert <hash>`, `git checkout <hash> -- file`),
  а не отдельные ветки.
- Допустимо WIP в `main` (Криник принял этот компромисс ради простоты и видимости всех файлов).
- Тестируем на харнесе (вирт.камера + стрим в файл), прежде чем считать готовым.

## Коммиты

Стиль: `feat:`, `fix:`, `docs:`, `refactor:`, `ci:` + одна строка что сделано.
Тег при завершении фазы: `v0.N` (Phase 0 = v0.1, Phase 1 = v0.2, ...).

## Push / аутентификация в GitHub (git + gh)

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

---

## Инструменты проекта

| Команда | Что делает |
|---------|------------|
| `node tools/build.mjs` | сборка с браузерным UI для того, чтобы Криник видел процесс сборки |
| `node tools/build.mjs --no-ui` | headless сборка |
| `node tools/graphics/render.mjs --input x.svg --output x.png --width N --height N` | SVG→PNG |
| `node tools/graphics/batch.mjs --input x.svg --android` | SVG→Android mipmap set |
| `node tools/ui.mjs cmd <action> [arg]` | **⭐ ТОЛСТАЯ debug-команда (Idea 22), минует UI** — `virtual-camera on\|off`, `stream-to-file on\|off`, `go-live [1080\|2160]`, `stop`, `set-rotation 0\|90\|180\|270`, `add-overlay`, `device-camera front\|back\|off` (Idea 24, камера устройства), `rotation-mode on\|off`. Надёжно загнать приложение в нужное состояние на харнесе |
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
| `node tools/adb.mjs tap <x> <y>` | тап по координатам (устарело — используй ui.mjs tap) |
| `node tools/adb.mjs logcat [tag] [lines]` | дамп logcat с устройства |
| `node tools/adb.mjs install` | установить debug APK |
| `node tools/adb.mjs start` | запустить MainActivity |
| `node tools/adb.mjs stop` | force-stop приложения |

> **Полное руководство по UI автоматизации:** [tools/UI_AUTOMATION_GUIDE.md](tools/UI_AUTOMATION_GUIDE.md)

### 🧭 Правило автоматизации (Idea 22) — как агенту действовать в приложении

Хочешь что-то сделать/проверить в приложении — выбирай слой инструмента СВЕРХУ ВНИЗ:
1. **Толстый `ui.mjs cmd <action>`** (debug-broadcast) — загнать в нужное СОСТОЯНИЕ надёжно/быстро,
   минуя навигацию. Это путь по умолчанию для тестов на харнесе.
2. **Тонкий `dump`/`tap`/`swipe`/`longpress`** — только если (а) проверяешь САМ UI, или
   (б) толстой команды для действия ещё НЕТ.
3. **После тонкого пути — ДОРАБОТАЙ инструмент:** добавь новую `cmd`-команду (action в CMD-receiver
   `MainActivity` + ветка в `ui.mjs cmd` + строка в таблицах AGENT_GUIDE/UI_AUTOMATION_GUIDE), чтобы
   впредь это делалось толстым слоем. Инструмент — живой, активно расширяем и документируем.

CMD-receiver — **DEBUG-only** (`BuildConfig.DEBUG`), action `com.kriniks.kcam.CMD`. Камеры на ночь
нет → харнес = виртуалка + запись в файл + `ffprobe`/кадры.

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

---

## Карта проекта

Полная карта файлов и потоки данных — `plans/project_map.md`.
План Phase 1 — `plans/phase_1_mvp.md`.
План graphics tool — `plans/graphics_tool.md`.

---

## Бэклог: bugs/ и plans/ideas/ — тег DONE в имени файла (Idea 15)

Чтобы по списку файлов сразу видеть, что закрыто, а что в работе — **в имя выполненного файла после
номера вставляется слово `DONE`**:

```
bugs/04_platforms_modal.md            →  bugs/04_DONE_platforms_modal.md
plans/ideas/07_developer_menu.md      →  plans/ideas/07_DONE_developer_menu.md
```

**Правило (делать ВСЯКИЙ РАЗ при работе с файлами багов и идей):**
- Закончил баг/идею и она ПОДТВЕРЖДЕНА закрытой (статус ✅/ЗАКРЫТ/РЕАЛИЗОВАНО/ИСПРАВЛЕНО, проверено) —
  сразу переименуй файл, добавив `DONE` после номера: `git mv <NN>_<name>.md <NN>_DONE_<name>.md`.
- Файл в работе / частично / только исследование — НЕ помечай `DONE` (статус 🔧/🟡/🔬 = ещё не готово).
- Используй `git mv` (сохраняет историю). Не меняй номер.
- Периодически пробегайся по `bugs/` и `plans/ideas/` и помечай накопившиеся закрытые файлы.

**Навык ревизии беклога — `/check-backlog`:** чтобы не делать это руками, есть навык `/check-backlog`.
Он пробегается по `bugs/` и `plans/` (включая `plans/ideas/`), собирает всё без тега `DONE` как
открытый беклог к реализации, а реально закрытым файлам проставляет `DONE` в имени (`git mv`) и
дописывает внутрь секцию статуса «что было сделано». Референсные доки в `plans/` (master_plan,
project_map и т.п.) он не трогает. Вызывай его периодически (а в автолупах он подключается из
`/refresh-context` и из самих циклов).

---

## Стиль кода

- Активно комментируем все блоки и модули кода.
- Compose: никаких `preview` в продакшн-файлах, разбивай на мелкие `@Composable`
- Hilt везде — никакого ручного DI
- Flow/StateFlow — никогда LiveData
- Никаких magic numbers — константы с понятными именами
- Цвет бренда: `#FF1A8C` (acid pink)
- **Локализация (грунт, Idea 14):** USER-FACING UI-текст выносим в `app/src/main/res/values/strings.xml`
  и используем `stringResource(R.string.x)` (импорт `androidx.compose.ui.res.stringResource` +
  `com.kriniks.kcam.R`). НЕ выносим: лог-сообщения, `KLog`-теги, технические константы. `stringResource`
  зовётся только в `@Composable`-скоупе — для строк внутри `onClick`/лямбд резолвь заранее
  (`val x = stringResource(...)`). Приложение пока English-only; будущие локали = `values-<lang>/`.
  Конвертированы: SettingsScreen, DevMenuScreen, RotationMenu. Остаток (FAB-меню, MainScreen,
  feature-модули, длинные dev-инфо-абзацы) — по тому же паттерну при касании этих файлов.


## Руководство от Криника:
- Каждый раз, когда читаешь логи, проверь текущее время и проверь время лог-файла - чтобы не читать старые логи, а читать только свежие актуальные логи.
- Напоминаю, что моё Android устройство и ты в одной локальной сети, веб камера подключена - ты можешь собирать билды, накатывать их на устройство, запускать приложение, снимать с устройства любые логи, управлять устройством, снимать скриншоты - работать с ним любым образом, который позволит тебе выполнить задачу по фиксингу бага и реализации фичей.
- **`BUG_FIXING_FRAMEWORK.md`** — если нужно починить дефект, провести дебаг, отловить баг и пофиксить его, то руководствуйся этим фреймворком работы.
- В процессе работы хоть немного но пиши естественным языком в чат о том, что ты сейчас делаешь, чтобы я хоть иногда видел и понимал, в каком процессе мы находимся.
- По всем, даже мелким багам в процессе работы над ними, рефлексируй и собирай знания в отдельных mdдокументах в директории bugs.
- Старайся работать автономно без интерактивных вопросов. Если есть нужда получить от меня информацию, то создай для этого документ md с очередным интервью (пример уже проведённых интервью найди в директории interviews), а затем напиши для меня сообщение в чат, что тебе нужны от меня данные, что ты составил интервью и поставь задачу на паузу, остановить - когда ты ставишься на паузу, VS Code воспроизводит звуковой сигнал - я его слышу, где бы я ни был в доме и чем бы не занимался - я подойду к компьютеру, прочитаю твоё сообщение и отвечу на твоё интервью.
- Если находишь баги в бибилиотеках других разработкивок, то оформляй им в Github через консольное приложение gh от моего имени баг-репорт тикеты.
- Активно тестируй разрабатываемое приложение. Для этого активно пользуйся ADB для связи с Андроид устройством, и устанавливай и пользуйся любыми консольными приложениями коммандной строки, которые позолят тебе управлять Андроид устройством для эффективного тестирования.
- Регулярно перечитывай файлы своих руководств AGENT_GUIDE.md, STATUS.md - при необходимости, редактируй их, дописывай важные на твой взгляд руководства, чтобы ИИ агент мог эффективно работать в разных ссесиях, между которыми теряется контекст. Старайся сам руководить собой и настраивать себя для максимальной эффективности и автономности. Глобально цель поставлена - разработать приложения. ВИдение Криника описано - можно автономно стремиться к этой цели с минимальным привлечением Криника.
