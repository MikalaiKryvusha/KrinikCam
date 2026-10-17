# 32 — KUIPS для KrinikCam: что это и как внедрять

**Создан:** 2026-10-17 · **Родитель:** слово Криника 2026-10-17 «там есть инструмент верстки макетов KUIPS - его тоже взять в работу» · **Статус:** живой справочник · **Вовне:** нет

> Разведка только чтением. Запускались лишь читающие команды: `kuips version` и `kuips check` на примере Brewlog,
> оба зелёные.

**Главный вывод.** KUIPS — это не доска для слепого сравнения вариантов макета. Это лист-развёртка экранов приложения
со связями между ними («локальная фигма»). Слепых меток и доски вариантов A/B/C в версии 1.0 нет, они записаны в планы
«после 1.0». С контуром владельца KUIPS не связан. Но для вопросов вкуса его можно приспособить: один ряд — один
вопрос, экраны подписаны «1…4», ключ лежит отдельным файлом. KARTUN так уже делал на версии 0.9.

## 1. Что такое KUIPS

- **Что это.** «Krinik User Interface Prototyping System: a local Figma-like sheet where AI agents lay out app screens
  and the wiring between them» (`D:\work\ai_sandbox\KUIPS\package.json`).
  - Версия 1.0.0, сборка 27, коммит `96a4411`, дата 2026-10-16 (`version.json`).
  - Лицензия MIT. Публичный репозиторий https://github.com/MikalaiKryvusha/KUIPS, теги `v0.9.0` и `v1.0.0`.
  - KAIF 2.9 (как и в KrinikCam).
- **Стек.** Чистый Node ESM (нужен Node 18+), единственная зависимость — `playwright ^1.61.1`.
- **Интерфейсы.** CLI `bin/kuips.mjs`, API `src/index.mjs`, MCP `src/mcp.mjs`.
- **Статус** (`STATUS.md` KUIPS).
  - «KUIPS 1.0.0 опубликован 2026-10-16», открытых багов нет: в `bugs/` только README.
  - `npm test` — 68 pass (это заявление из их STATUS, не перепроверено).
  - Следующая версия 1.1 — CRUD экранов, связей и мест (`kuips screen|link|place`).
- **Что выдаёт.**
  - Один самодостаточный HTML: `design/flow-map.html`. Кадры вшиты как data:URI, есть зум и панорама, связи рисуются
    цветными «трубами», экраны стоят рядами по процессам.
  - Страницы «Компоненты» и «Дизайн-схема».
  - Кадры экранов в WebP (по умолчанию) или PNG.
  - Figma, Compose и PNG всего листа он не выдаёт.
- **Мобильные экраны.** Экраны любого размера на одном листе: «phones of 390 × 900 px and 390 × 860 px, landscape
  860 × 390 px, tablets» (README §1 п.4).
  - Размер задаётся общим ключом `screen`/`экран` или у каждого экрана свой `width`/`height`.
  - Кадр не обрезается. Пропорции кадра должны совпадать с размером экрана с допуском 2 %
    (`src/check.mjs:42 ДОПУСК_ПРОПОРЦИЙ = 0.02`), иначе дефект `aspect-mismatch`.
- **Рамок устройства (корпус, вырез, статус-бар) нет.** Каждый экран лежит в карточке: сверху имя и адрес, в середине
  кадр, снизу заметка и пути «→ куда ведёт / ← откуда приходят».
- **Откуда берутся кадры.**
  - Съёмщик — Playwright Chromium. Он снимает живой веб-адрес или страницу HTML-макетов, где каждый экран — элемент
    `[data-screen="<id>"]`.
  - Снимать Android-устройство через adb KUIPS не умеет. Но поле экрана `file`/`файл` принимает любой
    png/jpg/webp/gif/svg/avif (`src/build.mjs` MIME), поэтому снимок `adb screencap` можно положить на лист.

## 2. Как проект подключает KUIPS

**Установка** (README §2 и `docs/ru/upgrade-1.0.md`):

```
npm install --save-dev github:MikalaiKryvusha/KUIPS#v1.0.0
npx playwright install chromium
npx kuips version        # → KUIPS 1.0.0 · сборка 27 (96a4411)
```

Установку из GitHub в чистую папку агент KUIPS проверял (это видно в его транскрипте). До публикации был запасной путь:
`npm install --save-dev D:/work/ai_sandbox/KUIPS`.

**Формат входа** — JSON-манифест `design/flow-map/flow-map.json`, ключи по-русски или по-английски. Пример:

```json
{ "kuips":"1.0", "название":"…", "язык":"ru", "экран":{"ширина":390,"высота":900},
  "съёмка":{"адрес":"design/mockups.html","формат":"webp","плотность":2,"папка":"design/flow-map/screens"},
  "экраны":[{"id":"home","имя":"Главная","адрес":"…","селектор":"[data-screen=\"home\"]","заметка":"…","ширина":860,"высота":390}],
  "связи":[{"от":"home","к":"timer","подпись":"Старт"}],
  "раскладка":[{"имя":"Ряд","места":[["home",0,0],["timer",1,0]]}] }
```

- В `места` три числа: id экрана, колонка (шаг пути), ярус (±1 — альтернативное состояние).
- Связи необязательны.
- Готовый пример: `D:\work\ai_sandbox\KUIPS\examples\brewlog\design\` (`mockups.html`, `flow-map/flow-map.json`,
  собранный `flow-map.html`, 457 КБ). Там есть и альбомный экран 860×390.

**Команды:**

```
kuips init [--lang ru|en] [--title T]
kuips shoot [--base URL] [--only id,…]
kuips library
kuips layout
kuips build
kuips check [--max-age-days N]
kuips mcp
kuips version
```

- Общие флаги у всех: `--root DIR`, `--manifest P`, `--out P`, `--json`.
- Коды возврата: 0 — готово, 1 — дефекты, 2 — неверный вызов.
- Куда пишется: кадры в `design/flow-map/screens/*.webp`, лист в `design/flow-map.html`.

**MCP.** Подключается так:

```json
{"mcpServers":{"kuips":{"command":"node","args":["node_modules/kuips/bin/kuips.mjs","mcp"]}}}
```

- Шесть инструментов: `kuips_build`, `kuips_check`, `kuips_layout`, `kuips_screens`, `kuips_shoot`, `kuips_crop`.
- `kuips_crop` возвращает PNG одной карточки или ряда, но только внутри ответа MCP: на диск он не пишет, а в CLI команды
  crop нет.

**Как показывать владельцу.** По README лист открывается двойным щелчком. С контуром KAIF связи нет:

- `.kaif/tools/contour/review.mjs <image> --mockup` принимает только одну картинку (png/jpg/gif/webp/svg) с полем
  комментария и кнопкой «Готово» (`review.mjs:618-634`). HTML-лист туда не передать, выбора буквой нет.
- Собственный контур KrinikCam `node tools/owner.mjs ask interviews/<док>.md` (`AGENT_GUIDE.md:397`) вшивает в страницу
  `![подпись](файл.webp)` как картинку. Ссылку `[подпись](x.html)` он вшивает как iframe `sandbox="allow-same-origin"`
  без `allow-scripts` и с пределом 6 МБ (`tools/owner.mjs:582-640`). Значит, внутри страницы зум и панорама листа
  работать не будут. Кнопка «открыть отдельным окном» переписывает лист в новое окно через `document.write` — там
  скрипты, по идее, оживут. Это вывод из кода, не проверено.

**Варианты и слепые метки — в 1.0 их нет.** В `D:\work\ai_sandbox\KUIPS\researches\01_kuips_users_experience.md:65-69`
в разделе «После 1.0»: «Доска вариантов „сейчас + A/B/C“ и слепой ряд с ключом; пара „макет ↔ сборка“». В MASTER_PLAN
KUIPS, фаза 6, пока только CRUD.

## 3. Реальные пользователи

- **KARTUN** — единственное реальное использование, причём ещё версии 0.9.
  - Лист собран 2026-10-14 сборщиком NDim прямо из его дерева: `node D:/work/ai_sandbox/ndim/tools/build-flow-map.mjs`
    (`KARTUN/HOUSE_RULES.md:144-145`).
  - Свой манифест `KARTUN/design/flow-map/flow-map.json` и свой съёмщик `tools/shoot-mockups.mjs`. Он снимает
    `design/kartun-mockups.html?shot=<id>` с элемента `.phone-wrap[data-id] .screen`, в PNG 390×900.
  - Варианты A–D стояли на листе рядами; после выбора владельца B–D с листа сняли.
  - Дальнейшие вопросы вкуса KARTUN решал уже не на KUIPS, а своими страницами:
    - `design/processing-variants.html` вместе с `tools/shoot-processing-variants.mjs` (схема «сейчас + A/B/C» одним
      WebP);
    - `tools/blind-sheet.py` — слепой ряд: номера в случайном порядке, `key.json` рядом и со страницы не связан.
  - Задание `TASK_KUIPS_1.0.md` закоммичено (`053c68f`), но в `package.json` пакета kuips нет — на 1.0 KARTUN не
    перешёл.
- **Krinik Tribit.**
  - Свой лист вариантов `design/mockups-v1.html` и съёмщик `tools/shoot-mockups.mjs`. Playwright он берёт из
    `node_modules` KARTUN, WebP делает через `magick`.
  - `TASK_KUIPS_1.0.md` лежит неотслеженным (untracked), KUIPS не установлен.
- **NDim** — исток версии 0.9 (`ndim/tools/build-flow-map.mjs` и ещё три прибора). `TASK_KUIPS_1.0.md` неотслежен.
- **KAGO, KUMM, KAST, KPOT, KOSM, KARMA, SvarogsDream, ndim-studio** — упоминаний KUIPS ноль.
- **KAIF** — слова KUIPS нет ни в одном файле. Есть только общий канон «taste class»
  (`KAIF/framework/AGENT_GUIDE.md:950-960`: один материал, слепые метки, ключ рядом).
- **Навыка KAIF для KUIPS нет.** В самом KUIPS его упоминают только собственные `end-chat-soft` и `release`.
- **KrinikCam** — до этой разведки упоминаний KUIPS ноль.

## 4. Ограничения и ловушки на этой машине

- **Окружение подходит.** Node v24.15.0, npm 10.8.2. В `%LOCALAPPDATA%\ms-playwright` уже лежат `chromium-1228` и
  `chromium_headless_shell-1228` — ровно та ревизия, что у playwright 1.61.1 (`browsers.json`: 149.0.7827.55). Папка
  общая для всех проектов, так что `playwright install` ничего качать не будет.
  - Edge, Chrome, puppeteer и sharp KUIPS не использует. WebP делается внутри браузера через `canvas.toDataURL`
    (`src/shoot.mjs`).
  - Roboto в `C:\Windows\Fonts` установлен.
- **EXP-0001 KUIPS: Git Bash съедает обратные косые и обратные кавычки** в `node -e` и heredoc. Код и тексты нужно
  писать в файлы инструментом Write.
- **EXP-0003 KUIPS:** MCP считается рабочим только после того, как настоящий клиент Claude Code вывел список
  инструментов (`/mcp` → kuips → Reconnect).
- **Корневой `node_modules/` в KrinikCam не игнорируется.** В `.gitignore:30` стоит только `tools/node_modules/`. Если
  ставить KUIPS в корень, git покажет весь `node_modules` как неотслеженный.
  - Сейчас `tools/node_modules` вообще отсутствует, поэтому `tools/ui.mjs screen` (ему нужен sharp) не заработает без
    `cd tools && npm install`.
- **`kuips shoot` без `--only` переснимает все экраны и перезаписывает их `файл`, включая снимки с устройства.** У
  экрана без `селектора`, чей адрес не начинается с `/ ? #`, будет снята базовая страница. В файл с расширением не
  `.webp` запишутся сырые байты PNG — например, в `.jpg` (`shoot.mjs`, строка
  `writeFileSync(… === '.webp' ? вWebp : кадр)`).
- **Пропорции 2 %.** Снимок A51 в ландшафте — 2400×1080 (`bugs/assets/81_fab_menu_landscape.jpg`), поэтому экрану
  ставить 860×387. В тексте bugs/81 видимая область названа 2312×1041 — пропорции мерить по самому файлу.
- **Чего KUIPS не умеет.** Нет анимации и видео, нет вырезки через CLI, нет экспорта всего листа в картинку, нет
  оформления листа в цвета бренда (акцент нейтральный).

## 5. Пошаговый план для KrinikCam

1. **Установить в `tools/`** (там `node_modules` уже в игноре):

   ```
   cd tools
   npm install
   npm install --save-dev github:MikalaiKryvusha/KUIPS#v1.0.0
   ```

   Проверка из корня: `node tools/node_modules/kuips/bin/kuips.mjs version` → «KUIPS 1.0.0 · сборка 27».
   - Дальше все команды запускать из корня как `node tools/node_modules/kuips/bin/kuips.mjs <cmd>` (по умолчанию
     `--root` — текущая папка).
   - Можно добавить в `tools/package.json` скрипт `"kuips": "node node_modules/kuips/bin/kuips.mjs --root .."`.
   - По желанию `.mcp.json` в корне:

     ```json
     {"mcpServers":{"kuips":{"command":"node","args":["tools/node_modules/kuips/bin/kuips.mjs","mcp","--root","."]}}}
     ```

     Затем Reconnect, чтобы работал `kuips_crop`.
2. **Манифест:**

   ```
   node tools/node_modules/kuips/bin/kuips.mjs init --lang ru --title "KrinikCam — макеты на вкус"
   ```

   Получится `design/flow-map/flow-map.json`. Один ряд — один вопрос вкуса; связи не нужны.
3. **Первый макет — bugs/81** (как показать, что FAB-меню прокручивается). Это лучший кандидат: картинка статичная,
   альбомная, способы заданы в самом документе, §5 Ф2: «полоса прокрутки · затухание-градиент у края · намеренно
   „недорезанный“ ряд».
   - **Материал.** Свежий снимок с A51 при `font_scale 1.1` (имеющийся снят при 1.5):

     ```
     export ADB_DEVICE=192.168.1.41:5555
     node tools/ui.mjs orient landscape
     node tools/ui.mjs tap "Меню"
     node tools/ui.mjs screen design/mockups/bug81/base.jpg
     ```

   - **Страница вариантов** `design/mockups/bug81.html`: четыре блока `<section data-screen="v1…v4">` размером 860×387.
     Фон у каждого — `base.jpg`, поверх в HTML дорисована только подсказка прокрутки. Один блок — «сейчас», без
     подсказки. Текст в HTML не рисовать, он уже есть на настоящем снимке.
   - **Ключи манифеста:**
     - `"экран":{"ширина":860,"высота":387}`
     - `"съёмка":{"адрес":"design/mockups/bug81.html","формат":"webp","плотность":2}`
     - у каждого экрана `"селектор":"[data-screen=\"v1\"]"` и слепое `"имя":"1"` (дальше «2», «3», «4»)
     - `"раскладка":[{"имя":"bugs/81 — как показать прокрутку","места":[["v1",0,0],["v2",1,0],["v3",2,0],["v4",3,0]]}]`
   - **Ключ** «номер → вариант» положить в `design/mockups/bug81/key.json` и со страницы не ссылаться.
   - **Сборка:**

     ```
     node tools/node_modules/kuips/bin/kuips.mjs shoot --only v1,v2,v3,v4
     node tools/node_modules/kuips/bin/kuips.mjs layout
     node tools/node_modules/kuips/bin/kuips.mjs build
     node tools/node_modules/kuips/bin/kuips.mjs check     # ждём «дефектов 0»
     ```

   - Перед тем как отдавать, самому посмотреть кадры WebP.
   - **Более честный вариант:** варианты под отладочным флагом в самом приложении, снять `ui.mjs screen` и вписать в
     `файл` экранов. Тогда `kuips shoot` для этих экранов не запускать.
4. **Передать владельцу.**
   - Завести `homeworks/NN_…md` с двумя полями: «что готово посмотреть прямо сейчас» (пути к `design/flow-map.html` и
     к кадрам WebP) и «уже вынесенные вердикты».
   - Завести интервью `interviews/interview_0NN_bug81_scroll_hint.md` в форме `interview_014`: варианты 1–4 плюс
     свободное поле. Кадры вставить как `![1](design/mockups/bug81/v1.webp)` — `owner.mjs` вшивает картинки. Лист дать
     ссылкой: в iframe он будет мёртвым, отсюда кнопка «отдельным окном».
   - Запустить в фоне `node tools/owner.mjs ask interviews/…md`.
   - Если нужен только комментарий к одной картинке: `node .kaif/tools/contour/review.mjs <файл.webp> --mockup`.
   - Вердикт записать в bugs/81 как канон.
5. **Следующие вопросы.**
   - **ideas/45** (подложка меню на чёрном). Сначала заполнить таблицу инвентаря в самом документе («нет строки
     инвентаря, нет кода»). Потом четыре варианта из документа: нейтральный тёмный с розовой кромкой · розовый 3 % ·
     розовый 6 % · градиент — на настоящем чёрном кадре и в обеих темах.
   - **bugs/52** (рамка выбранного слоя): 1.5 dp сплошная против 1 dp с alpha 0.4 / 0.5 / 0.6. Снимать увеличенный
     кусок панели слоёв с `плотность` 3, иначе разницы не видно.
   - **bugs/53 на KUIPS не годится.** Мерцание — это про время, а KUIPS даёт статичные кадры. Измеримая часть по
     документу уже закрыта (ширина 383 px в 10 пробах). Владельцу нужен живой эфир на устройстве или запись
     `adb screenrecord`.

## Чего не нашёл

- ни одного проекта, который уже работает на KUIPS 1.0;
- навыка KAIF для KUIPS и интеграции с контуром владельца;
- слепого режима и доски вариантов;
- рамок устройства, съёмки Android через adb и экспорта в Figma или Compose;
- в транскрипте KUIPS — никаких проблем Windows, кроме двух уроков выше (EXP-0001 и EXP-0003).
