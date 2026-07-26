# Архив STATUS.md — история сессий (вынесено из STATUS.md при /revision 2026-07-02)

> **Что это.** Полная история сессий и закрытых работ, накопившаяся в STATUS.md за 2026-06-27..07-02.
> Вынесена сюда при ревизии, чтобы STATUS.md оставался КОРОТКИМ живым срезом (правило: STATUS —
> экран текста, история — здесь, append-only). Форензика конкретных багов — в bugs/NN_*, детали
> идей — в ideas/NN_*.

---

# KrinikCam — Текущий статус проекта

> Этот файл читается AI-агентом перед каждой задачей.
> Обновляй его при каждом значимом изменении состояния.
> Читай описание твоего рабочего фреймворка в AGENT_GUIDE.md
> 🧠 Главный принцип мышления — `PHILOSOPHY.md` (ПРОСТОТА: KISS + Оккам). Затык = делаешь слишком
>    сложно, не понял задачу → упрости понимание, не усложняй решение.

---

## Что сделано

### Phase 0 — Skeleton (v0.1) ✅
- Gradle multi-module проект (`:app`, 5 feature-модулей, 3 core-модуля, 1 data-модуль)
- CI на GitHub Actions (build + lint)
- `tools/build.mjs` — сборка с браузерным прогресс-баром (`build-ui.mjs`)

### Phase 1 — USB Preview → RTMP Stream (v0.2) ✅
- **`:core:logging`** — `KLog` + `FileLogger` (7-дневная ротация, share через FileProvider)
- **`:data:profiles`** — Room DB (`stream_profiles`) + DataStore (`DeviceProfile`, active profile ID)
- **`:feature:codec`** — `CodecScanner` (MediaCodecList → DeviceProfile с HW/SW кодеками)
- **`:feature:capture`** — `DeviceManager` (приоритет: UVC → задняя → передняя → любая → None)
- **`:feature:usb`** — `UsbDeviceRepositoryImpl` обёртка над AndroidUSBCamera 3.2.7, `UvcPreviewView`
- **`:feature:streaming`** — `RtmpStreamer` (RootEncoder 2.4.7), `StreamViewModel`, `StreamPlatformsOverlay`
- **`:app`** — `MainScreen` (fullscreen viewfinder + радиальное FAB-меню), `SettingsScreen`, `StandbyPlaceholder`, `NavGraph`
- `README.md` (двуязычный EN/RU), `PROJECT_STRUCTURE_EXTERNAL_MAP.md`, `plans/phase_1_mvp.md`
- Интервью #002 по Phase 1 — все решения зафиксированы
- Тикеты разработчикам: AndroidUSBCamera #756, RootEncoder #2118

### Tools ✅
- `tools/graphics/render.mjs` — SVG → PNG рендерер (`@resvg/resvg-js`)
- `tools/graphics/batch.mjs` — пакетный рендер → Android mipmap-*
- `tools/adb.mjs` — ADB vision + interaction tool (screen/tap/logcat/install/start/stop)
- `AGENT_GUIDE.md` — инструкция для AI-агента
- `plans/graphics_tool.md` — план graphics tool

### Device Testing ✅
Три бага найдено и исправлено на устройстве (Headwolf Titan1, Android 14):

1. **`SecurityException: RECEIVER_NOT_EXPORTED`** — `USBMonitor.register()` вызывал `registerReceiver()` без флагов Android 13+.
   Фикс: `ReceiverFlagFixContext` (ContextWrapper) в `feature/usb`.

2. **`UsbUserPermissionManager: Camera permission required for UVC`** — Android 14 блокирует USB UVC без `CAMERA` permission.
   Фикс: добавлен `<uses-permission android:name="android.permission.CAMERA"/>`, runtime request в `MainActivity`, мониторинг запускается после выдачи прав.

3. **`IllegalArgumentException: surfaceTexture must not be null`** — `openCamera()` вызывался в `factory {}` до рендера `TextureView`.
   Фикс: перенос `openCamera()` в `TextureView.SurfaceTextureListener.onSurfaceTextureAvailable`.

**Результат: USB-камера Emeet Piko+ 4K показывает live preview на Headwolf Titan1. ✅**

### Tools ✅
- `tools/adb.mjs` — ADB vision + interaction (screen/tap/logcat/install/start/stop)
- ADB WiFi режим: `adb tcpip 5555` → `adb connect 192.168.1.3:5555`

---

## 🤖 АВТОНОМНЫЙ ПУЛ ЗАДАЧ (без камеры и без Криника) — ФОКУС СЕЙЧАС

> **Камера сейчас НЕ подключена к устройству — с ней пока не работаем.** Важно собрать и вести пул
> задач, которые ИИ-агент делает ПОЛНОСТЬЮ АВТОНОМНО: пишет код → собирает билд → ставит на
> устройство → запускает → смотрит UI через `ui.mjs dump/screen` → тапает/свайпает → фиксит. Без
> видеопотока с камеры и без участия Криника. Вошли в цикл работы над этим пулом.
>
> Когда камера НЕ подключена, приложение показывает `StandbyPlaceholder` («Connect a USB webcam…») —
> весь UI (Settings, Platforms overlay, FAB-меню, диалоги, навигация, dev-меню) доступен для теста.

### 🔥 НОВЫЙ ПРИОРИТЕТ — фундаментальная связка 08/09/10 (дев-харнесс)

Взаимосвязаны и фундаментально важны. 09+10 = автономный дев-харнесс (вирт. камера → пайплайн →
вирт. стрим в файл → анализ кадров), который снимает блокеры «нет камеры/Криника/YouTube» и позволит
детерминированно добивать даже Bug 10. Все три автономны (анализ + софтверные заглушки + файл).

0a. ✅ **Idea 08 — один экземпляр энкодера** — ПРОАНАЛИЗИРОВАНО 2026-06-29: уже сделано правильно
    (один `RtmpStream`/MediaCodec, превью = GL-блит без encode, в preview-only encode не работает).
    Менять не нужно. Доказательства в `ideas/08_*`. На будущее: мультистрим — от одного энкодера.
0b. ✅ **Idea 09 — виртуальная камера-заглушка** — СДЕЛАНО 2026-06-29. Тумблер «Виртуальная камера»
    в dev-меню → `VirtualVideoSource` рисует 16:9 тест-паттерн (круг/сетка/TOP + движущаяся полоса +
    счётчик) в GL вместо физ. камеры. Проверено БЕЗ камеры на устройстве. Снимает блокер «нет камеры».
    `VirtualFrameRenderer/VirtualVideoSource`, `VideoSource.Virtual`, `DeviceManager.setVirtualCamera`.
0c. ✅ **Idea 10 — виртуальная стрим-платформа в файл** — СДЕЛАНО 2026-06-29. Тумблер «Стрим в файл»
    в dev-меню → Go Live пишет энкодер в MP4 (`startRecordToFile`) вместо RTMP. Проверено: записал,
    `ffprobe` 1920×1080, кадр → круг круглый. **Связка 09+10 = автономный дев-харнесс** (вирт.камера →
    запись → анализ кадров ffmpeg) — позволит детерминированно добить Bug 10 (портрет) БЕЗ YouTube.

### ✅ В пул (можно делать автономно, камера не нужна)

1. ✅ **Idea 07 — Меню «Для разработчиков»** (`ideas/07_developer_menu.md`) — СДЕЛАНО 2026-06-29.
   Экран Developer (лонг-тап по «KrinikCam» в Settings), тумблер «Вращение по ADB» + [i], работает в
   любой сборке (DEBUG-гейт убран). Проверено на устройстве (лонг-тап → меню; ON → orient ворочает;
   OFF → сенсор). Добавлена команда `ui.mjs longpress`. Сюда выносим весь будущий dev-функционал.
2. ✅ **Idea 01 — Импорт/экспорт конфига профилей** — СДЕЛАНО 2026-06-29. Кнопки Export/Import в
   Platforms overlay (SAF, без рантайм-пермиссий), JSON `{app,version,profiles[]}`, толерантный парс.
   Проверено на устройстве (export→файл→import round-trip). `ProfilesBackup.kt`, VM-методы, overlay.
3. 🔬 **Idea 05 — SEO README + таблица конкурентов** — ЧЕРНОВИК готов 2026-06-29
   (`researches/readme_seo_draft.md`: SEO-ресёрч, таблица, позиционирование, GitHub Topics).
   Публикация в README — НА РЕВЮ Криника (публичный бренд + имена конкурентов). Сырьё:
   `researches/competitors/`.
4. **UI/UX-полировка и качество кода** — 🟢 любые правки экранов/диалогов/навигации (тестятся без
   камеры), `/code-review` и `/simplify` по свежим изменениям, юнит-тесты несетевой логики
   (профили, codec-scanner, математика поворота).
5. **StandbyPlaceholder polish** — 🟢 экран «нет камеры» виден прямо сейчас → можно полировать/тестить.
6. ✅ **Idea 13** — уголки виртуалки отодвинуты вглубь (2026-06-29).
7. ✅ **Idea 11** — запись вирт-стрима → публичный DCIM/KrinikCam (2026-06-29).
8. ✅ **Idea 12** — навык `/release` (2026-06-29).
9. ✅ **Idea 14** — дев-меню EN + лонг-тап 2с + убрана серая строка (2026-06-29).

> 🔄 **Обновление 2026-06-29:** автономный пул по сути исчерпан — закрыты idea 07/01/08/09/10/11/12/
> 13/14/15. Остаток (idea 05 SEO — на бренд-ревью Криника; idea 06 поворот — частично; Bug 10 реальный
> RTMP) требует камеру/YouTube/Криника. Для автолупа новых камера-независимых задач сейчас нет.

### ⛔ НЕ в пул сейчас (нужна камера/стрим или Криник)

- **Bug 10** — портретный стрим 9:16 (нужна камера + RTMP + глаза Криника на YouTube).
- Таймаут источника (разрыв камеры в эфире), USB-permission «запомнить» (нужна USB-камера),
  мультистрим, Camera2 fallback, живая RTMP-проверка чего-либо — всё требует камеру/стрим/Криника.
- App icon / notification icon — дизайн = вкус Криника (нужен его вход); можно лишь черновик на ревью.

### Порядок входа в цикл (рекомендация)

Idea 07 (dev-меню, конкретно и закрывает наш ADB-поворот по-чистому) → затем Idea 01 (import/export)
или Idea 05 (SEO, чистый текст). Работаем по `BUG_FIXING_FRAMEWORK.md` + `PHILOSOPHY.md` (просто!).

---

## Текущая позиция

**🧩 2026-07-02 — ПРОЕКТ МИГРИРОВАН НА KAIF 1.1 (Idea 30 ✅).** KrinikCam — родина KAIF — теперь
формально обвязан фреймворком: `GOAL.md`/`MASTER_PLAN.md`/карты в корне, директории знаний
`ideas/ researches/ homeworks/` (бывш. `plans/ideas`, `plans/research`, `plans/homework_*`) с README,
19 навыков (добавлены `/revision` `/help-kaif` `/kaif-version` `/kaif-update` `/kaif-fork`
`/kaif-switch-origin` `/kaif-remove`), маркер `.kaif/kaif.json`, ручки `tools/kaif.mjs` (`kaif:*`),
`KAIF_FRAMEWORK.md` + `CLAUDE.md`/`AGENTS.md`. Старые пути в доках переписаны. Детали — `ideas/30_DONE_*`.

**Phase 2 MVP РАБОТАЕТ ✅ — Go Live стримит в YouTube корректно (подтверждено Криником 2026-06-28).**

Превью ✅ · RTMP-стрим ✅ (~5 Mbps стабильно) · ориентация ✅ · превью после стрима ✅ · без крашей ✅
· **standby-кадр при отключении камеры ✅** (Phase 2 P2, подтверждено на устройстве 2026-06-28)

**Сделано в сессии 2026-06-29 (НОЧЬ) — ПОСЛЕДНЯЯ (текущая):**
- ✅ **Idea 18** — лонг-тап открытия dev-меню сокращён 2000→1000 мс (`SettingsRow`). Проверено Криником.
- ✅ **Bug 13 — краш при детаче USB в эфире — ЗАКРЫТ, подтверждён ЖИВЫМ тестом.** Причина: AUSBC на
  потоке `USBMonitor` зовёт `getSerialNumber()` (отозванный USB-permission) → необработанный
  `SecurityException` убивал процесс (+ нативный SIGSEGV libuvc). Фикс: узкий перехват в `KrinikCamApp`.
  Криник проверил в эфире (детач/реплаг ×N): приложение выжило, стрим держался на заглушке. `bugs/13_*`.
- ✅ **Idea 19 — ФУНДАМЕНТ МУЛЬТИ-ИСТОЧНИКОВ (минимальный срез + фаза 1).** Интервью #005. Backend =
  штатные фильтры RootEncoder (НЕ свой композитор): `addFilter`=z-order, `ImageObjectFilterRender`=PNG.
  `scene/{Layer,Scene,SceneCompositor,OverlayTestImage,ImageOverlayLoader}.kt`, держатель сцены в
  `RtmpStreamer` + переприменение оверлеев на хуках GL, проброс repo/VM, панель **«Scene layers»**
  (FAB→Layers: список, видимость, порядок ↑↓, удаление, добавить картинку из файла через SAF +
  миниатюра слоя). Проверено вживую: оверлеи компонуются в GL-пайплайн энкодера.
- ✅ **Bug 14** — краш «recycled bitmap» при reorder (фильтру отдаём КОПИЮ битмапа).
- ✅ **Bug 15** — z-order камеры + чёрный канвас при выключении камеры (интерим в текущей модели).
- ✅ **Превью зеркалит стрим** при пропаже камеры (не кроет всё Compose-заглушкой) — `MainScreen`.
- 🟡 **Bug 17** (качество заглушки: последний кадр = весь композит/сплющ/рваный фейд) — поточечно
  поправлен сплющ+фейд, но **решено НЕ латать симптомы** (решение Криника): корень — кривая база.
- 📐 **Bug 16 + Idea 21** заведены: камера сейчас «особенная» (база энкодера) — отсюда Bug 15/16/17.

> ✅🌙 **ОКОНЧАТЕЛЬНОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ (Криник, ночь 2026-06-30): КАМЕРА = ОДИН ИЗ СЛОЁВ (OBS),**
> **НЕ базовый источник. Откат камеры в базу ОТВЕРГНУТ.** Делаем свой **GL-КОМПОЗИТОР** (Idea 25,
> `ideas/25_*`): наш VideoSource рисует ВСЕ слои (камера-OES + картинки + …) в ОДНУ SurfaceTexture
> и отдаёт RootEncoder как единственный базовый источник → камера = обычный слой В НАШЕМ композиторе,
> RootEncoder кодирует готовый композит (доходит до энкодера тривиально, без фильтр-костылей).
> Работаем ТОЛЬКО в `main`. Путь `SurfaceFilterRender` (камера-фильтр) — тупик (не доходил до энкодера,
> Surface abandoned), отброшен в пользу своего композитора. История блокера/находок — `bugs/18_*`.
> Попутно: `lockHardwareCanvas` (виртуалка в слой), перечисление камер устройства Camera2 (Idea 24).
>
> 🎉 **МОБИЛЬНЫЙ OBS-КОМПОЗИТОР ДОКАЗАН на харнесе (ночь 2026-06-30), за флагом `cmd compositor on`:**
> `EglCore`/`GlQuadRenderer`/`CompositorVideoSource` (`feature/streaming/.../gl/`) — наш GL-композитор
> рисует все слои в один кадр и отдаётся RootEncoder базовым VideoSource (камера = слой ВНУТРИ него).
> Записью+ffprobe подтверждено (шаги 1-4 в `ideas/25_*`):
>   • чёрная база ✅ • слой-картинка (2D, upright, альфа) ✅ • **слой-КАМЕРА (OES) ДОХОДИТ до энкодера И
>     превью ✅ (круг круглый) — РЕШАЕТ bug 18** • **z-order ✅** (камера-снизу→оверлей сверху; камера
>     поднял над оверлеем→перекрыла; скрыл камеру→чёрный+оверлеи) — камера = РАВНОПРАВНЫЙ слой (OBS!).
> Тест: `ui.mjs cmd compositor on; cmd virtual-camera on; cmd add-overlay; cmd stream-to-file on; cmd
> go-live 1080; …; cmd stop` → `adb pull` MP4 + ffprobe. Тонкие команды слоёв: `cmd toggle-layer|layer-up|
> layer-down <id>`.
> **ОСТАЛОСЬ (для использования как продукт):** ~~трансформа слоёв (PiP)~~ ✅ СДЕЛАНО (утро 2026-06-30,
> см. ниже); сделать компоновщик ОСНОВНЫМ режимом (убрать флаг + старый SurfaceFilterRender-путь);
> **поворот/портрет (Bug 10) на матрицах композитора**; проверить реальную USB-камеру. ⚠️ НЕ делать
> дефолтом, пока не сверены ПОРТРЕТ и реальная USB (нужен Криник). Это следующий заход.
> 📌 git push на auth починен (gh auth setup-git) — ночные коммиты ушли, push работает.

**Сделано в сессии 2026-06-30 (УТРО, dayloop — текущая):**
- ✅ **Idea 25 шаг 4 — ТРАНСФОРМА СЛОЁВ (PiP) ДОКАЗАНА на харнесе.** Каждый слой (камера и картинки
  равноправно) рисуется квадом с модельной матрицей позиции: `LayerTransform(scale,cx,cy,alpha)` в
  домене (`scene/Layer.kt`+`Scene.setTransform`), uniform `uPosMatrix` в вершинном шейдере
  (`GlQuadRenderer`), `posMatrixOf` в `CompositorVideoSource`, `RtmpStreamer.setLayerTransform`→repo/VM.
  Тонкая команда `ui.mjs cmd set-transform <id> <scale> <cx> <cy> [alpha]` (arg через запятую — shell
  на устройстве иначе рвёт по пробелам). Записью+кадром доказано: камера-PiP в угол на чёрном (круг
  КРУГЛЫЙ, аспект сохранён); классическая OBS — оверлей фоном на весь кадр + камера-PiP сверху в углу
  (z-order и трансформа работают ВМЕСТЕ). «Лицо в углу» = есть. Детали: `ideas/25_*` (шаг 4b).
- ✅ **Idea 24 — реальная ВСТРОЕННАЯ камера планшета доходит до энкодера через композитор** (снят
  блокер bug 18 для device-камер!). `cmd compositor on` + `cmd device-camera back` + запись → 1.3 МБ
  реальной сцены. Встроенные камеры = автономный РЕАЛЬНЫЙ источник для агента.
- 🟡 **Bug 19 воспроизведён+корень найден:** device-камера приходит повёрнутой на 90°
  (`SENSOR_ORIENTATION` не применяется в `DeviceCameraOpener`). Слепой фикс не делаю — поворот сцеплён
  с моделью ориентации (interview_006, Q3 про поворот камеры-слоя). План фикса в `bugs/19_*`.
- ✅ Закоммичен навык `/check-backlog` (ревизия беклога) + ссылки в day/night/refresh + AGENT_GUIDE.
- ❓ **НА РЕВЮ КРИНИКА (interview_006):** портрет в модели «камера = слой». Факт: `compositor on` +
  `set-rotation 90` даёт портрет 1080×1920, круг круглый, НО `setCameraOrientation(deg)` крутит весь
  композит → **оверлей тоже поворачивается** (в OBS он должен быть upright). Развилка «что значит
  портрет, когда камера — слой» (портретный холст + upright-слои / глобальный поворот / ориентация в
  профиле сцены / отдельный угол камеры-слоя) — UX/архитектурное, не решаю сам. `interviews/interview_006_*`.
- 🟡 **Idea 17 — финализация файла при отрыве камеры во время ЗАПИСИ реализована** (`enterStandby`:
  запись → `stopRecordToFile`, без подмены источника — защита MediaMuxer; решение Криника). Сквозная
  проверка блокирована bug 20.
- 🔴 **Bug 20 (реальный краш) — НО только в deprecated пути; КОМПОЗИТОР переживает.** При отрыве
  источника в превью (`SET_VIRTUAL_CAM off`) НЕ-композиторный (default) путь падает нативным SIGABRT
  (HWUI `EGL_BAD_ALLOC`), а **в режиме `compositor on` приложение ВЫЖИВАЕТ** (прямое сравнение на
  харнесе). Артефакт старого SurfaceFilterRender-пути (churn EGL-поверхностей). Закроется сам с
  переводом композитора в дефолт (Idea 25 шаг 5), как bugs 15/18. Форензика в `bugs/20_*`.
- ✅ **Idea 17-концерн снят АРХИТЕКТУРНО (в композиторе).** Запись + отрыв камеры на лету (отрыв
  подтверждён в логе) + стоп → файл ВАЛИДЕН (122 кадра/4.23с, без порчи MediaMuxer): база
  `CompositorVideoSource` не подменяется при отрыве. Слой-камеры на отрыв замораживает последний кадр
  (интерим; чистая очистка/standby-слой — будущее, Idea 19 Q4). Спец-финализация не нужна.
- 🔎 **Находка: `enterStandby` (standby-подмена источника, interview_004) — ОРФАН** (никто не зовёт
  после рефактора на слои). В модели слоёв заглушка = fallback-СЛОЙ (Idea 19 Q4), не подмена базы.
- ✅ **Idea 17 — ФОТО-ЗАХВАТ сделан:** `cmd photo` снимает кадр композита (`glReadPixels` на GL-потоке
  компоновщика) → JPEG в `DCIM/KrinikCam`. Проверено: композит (оверлей+камера-PiP) 1920×1080, круг
  круглый, upright. Работает на GL-композиторе (Idea 25). UI-кнопки + запись ВИДЕО как явная фича — за
  дизайном Криника (механизм записи уже есть: `stream-to-file`+`go-live`).
- ✅ **Ревизия беклога** (`/check-backlog`): DONE багам 13/14/15/18 и идеям 19/21/22/23/26.
- 📌 **Автономный НЕ-заблокированный пул исчерпан.** Остаток упирается в Криника: главное — ответ по
  `interview_006` (портрет в OBS-модели) + проверка реальной USB-камеры/портрета на ЖИВОМ YouTube с
  `compositor on` (ДЗ → `homeworks/04_compositor_default.md`). Это разблокирует дефолт композитора
  (Idea 25 шаг 5/6) и закрытие bugs 15/16/18/20 + idea 17. Прочее открытое — UX-дизайн Криника
  (idea 20 выбор источника, кнопки записи/фото) или SEO/мультистрим на его ревью.

### 📋 Открытый беклог после утренней ревизии (для следующего захода)
- 🔴 **bug 20** — краш превью при отрыве источника (TOP: реальный краш, блокирует idea 17; bug-research).
- 🟡 **bug 19** — device-камера повёрнута на 90° (ждёт модели ориентации interview_006).
- ⏸️ **bug 17** — качество заглушки (отложено, корень = база; пересмотреть на композиторе).
- 🟡 **bug 16** — нет удаления камеры-слоя в UI (нужен idea 20 «выбор источника», чтобы вернуть).
- **ideas:** 05 SEO (ревью Криника), 16 мультистрим ч.2 (интервью), 17 запись (после bug 20),
  20 выбор источника (UX Криника), 24 device-камеры (ориентация → interview_006), 25 композитор
  (шаги 5/6 — после interview_006 и сверки портрета/USB Криником).
- ❓ **На ревью Криника:** interview_006 (портрет в OBS-модели) — разблокирует bug19 + idea24 + idea25 шаг6.
>
> ✅ **Idea 22 — инструмент-автоматизатор РАБОТАЕТ:** `ui.mjs cmd virtual-camera|stream-to-file|go-live|
> stop|set-rotation|add-overlay` + CMD-receiver (DEBUG-only). Доказал себя — воспроизвёл/локализовал
> блокер. Гайд `tools/UI_AUTOMATION_GUIDE.md` (правило: толстый `cmd` → тонкий tap только если нет
> команды → потом доработать инструмент). Idea 22/23 + скилл `/nightloop` заведены. ⚙️ Java 25 ломала
> Gradle-синк IDE → запинен JBR17 (`org.gradle.java.home` в `~/.gradle/gradle.properties`).
>
> 🌿 **(устар. — теперь всё в main) IDEA 21 — журнал на ветке** (main НЕ трогаем — там рабочий портрет).
> Живой журнал: **`plans/idea21_camera_as_layer_worklog.md`** (читать первым завтра). Сделано: Шаг 1
> (`BlackVideoSource`) + Шаг 2 (камера = `SurfaceFilterRender`-слой над чёрной базой) — подтверждено на
> обвязке (камера реал+вирт рисуется слоем, оверлей композится, запись 4К — круг круглый). **🔴 СТОП-БАГ
> для старта завтра: виртуалка мигает и исчезает → чёрный канвас при заходе в запись** (гипотеза:
> SurfaceTexture камеры-слоя пересоздаётся при реините GL, а камера не переоткрывается — детали и план
> диагностики в журнале). Идея 22 (высокоуровневый UI-автоматизатор) заведена. ⚠️ UI-тапы по тумблерам
> ненадёжны — виртуалку включать ADB-броадкастом `SET_VIRTUAL_CAM`.
>
> Прежний план (актуален как ориентир) — Idea 21 (`ideas/21_*`): переделать базу слоёв —
> **неявная ЧЁРНАЯ подложка + ВСЕ слои (включая камеру) равноправны поверх неё; камера через**
> **`SurfaceFilterRender` как обычный слой (удаляемая/переставляемая).** Это естественно закрывает
> Bug 15/16/17 и «штаны через голову». ⚠️ Трогает хрупкое: поворот/портрет (Bug 10) и standby —
> вести аккуратно (worktree), сверять портрет на ЖИВОМ YouTube перед мержем. Критерии приёмки — в
> `ideas/21_*`. Симптомные правки Bug 15/16/17 заморожены до этой переделки.

**Сделано в сессии 2026-06-29 (ранее, вечер):**
- 🟡 **Bug 13 — краш при детаче USB в эфире, фикс №1 реализован, ждёт live-проверки.** Причина (полная
  форензика с устройства, `bugs/13_*`): при отвале камеры библиотека AUSBC на своём потоке `USBMonitor`
  зовёт `getSerialNumber()` (требует отозванный USB-permission) → необработанный `SecurityException`
  убивает процесс; + нативный SIGSEGV в `libuvc`. Фикс: узкий перехват в `KrinikCamApp` (поток
  USBMonitor + SecurityException + стек com.serenegiant) — логируем, НЕ роняем процесс. Проверка: нужен
  физический реплаг камеры в эфире (ADB-харнесс этот путь не воспроизводит). Нативный SIGSEGV закроется
  чистой остановкой источника (ляжет на мульти-источники).
- ✅ **Idea 19 — ФУНДАМЕНТ МУЛЬТИ-ИСТОЧНИКОВ, минимальный срез доказан ВЖИВУЮ.** Интервью #005
  проведено (Q1=A срез, Q3=A панель «Слои», Q4 заглушка=особый источник в профиле сцены). Архитектура:
  backend = штатные фильтры RootEncoder (НЕ свой GL-композитор) — `addFilter`=z-order, `clearFilters`=
  пересборка, `ImageObjectFilterRender`=PNG; готовые рендереры покроют текст/видео/2-ю камеру/браузер.
  Сделано: `scene/{Layer,Scene,SceneCompositor,OverlayTestImage}.kt`, держатель сцены в `RtmpStreamer`
  + переприменение оверлеев на хуках GL, проброс repo/VM, панель **«Scene layers»** (FAB→Layers: список,
  «глаз», порядок ↑↓, удаление, + оверлей). Проверено на устройстве с РЕАЛЬНОЙ камерой: оверлей в
  GL-пайплайне энкодера (доказано рекурсией), toggle добавляет/убирает фильтр. Дорожная карта фаз +
  ответ про виртуалку-как-источник → `ideas/19_*`.
- ✅ **Idea 19 фаза 1 — слой-картинка из ФАЙЛА (SAF) + миниатюра слоя.** `ImageOverlayLoader` (декод+
  даунсемпл, вписывание в кадр 16:9 с сохранением пропорций — logo не растягивается до трансформы
  фазы 4). Панель: «Add image overlay» (SAF image/*), миниатюра содержимого в строке. Тест-путь +
  миниатюра проверены; реальный SAF-пик — за Криником. **Дальше по карте: фаза 2 — слой «ЗАГЛУШКА
  KrinikCam» (Q4, заодно добивает storm-сценарий Bug 13).**

**Сделано в сессии 2026-06-29 (день):**
- ✅ **Idea 16 п.1** — дроп-даун 16:9-разрешений в форме платформы (вместо ручных Width/Height):
  пресеты 2160p/1440p/1080p/720p/480p/360p + поле FPS. `StreamPlatformsOverlay.ResolutionDropdown`.
  Проверено на устройстве. (п.2 — битрейт/профили кодирования/мультистрим — архитектура, отдельно.)
- ✅ **Idea 14 грунт локализации** — user-facing строки 3 экранов (Settings/Developer/Rotation) вынесены
  в `app/res/values/strings.xml` + `stringResource`; конвенция в AGENT_GUIDE. App пока English-only.
- 🟡 **interview_004 — таймаут источника РЕАЛИЗОВАН (код), ждёт live-проверки.** `FreezeStandbyVideoSource`:
  при разрыве источника держит ПОСЛЕДНИЙ кадр 5с (`LastFrameProvider`; для камеры fallback на превью) →
  cross-fade 500мс → standby-карта. Возврат в пределах 5с (exitStandby) — бесшовно. 10fps (безопасно
  для 4К). enterStandby/exitStandby теперь и при записи (isRecording). Заморозка ЗАВОДИТСЯ (лог).
  **+ ADB-харнесс симуляции разрыва БЕЗ камеры (идея Криника):**
  `adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --es state off|on -p com.kriniks.kcam.debug`
  (MainActivity receiver → deviceManager.setVirtualCamera). Визуальная проверка — на ЖИВОМ RTMP (запись
  в файл при подмене источника даёт битый MP4 — артефакт MediaMuxer, не баг фичи).
- ✅ **Idea 17 (план)** — фича записи видео/фото в файл: проверено, что **4К-запись работает** (136
  кадров, валидно — 4К не тяжёлый); битый файл был из-за подмены источника во время записи (ломает
  MediaMuxer). Решение Криника: заглушка — только для СТРИМА; для записи при разрыве — чисто
  финализировать файл (без подмены, без standby в записи). Детали: `ideas/17_*`.
- 🚀 **Релиз v0.5 опубликован** → https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/v0.5
  (APK `KrinikCam-v0.5.apk`). Примечание: v0.4 пропущена из-за бага `release.mjs` (`--dry-run` писал
  version.json до проверки → двойной бамп). **Баг починен** — теперь dry-run не мутирует version.json.
- 🏆🎉 **Bug 10 — портретный стрим ПОБЕЖДЁН ПОЛНОСТЬЮ, подтверждён ЖИВЬЁМ на YouTube** (idea 06 тоже
  закрыта). Виртуальная камера → реальный RTMP → YouTube: портрет 9:16 ✅ (круг круглый, заполняет),
  ландшафт 16:9 ✅, горячие повороты девайса в эфире не рвут стрим ✅. Решение (по модели Криника
  «мы виртуально ворочаем 16:9», ≈10 попыток + декомпиляция): **`RtmpStreamer.configureCaptureRotation`**
  (общий хелпер для startStream и startRecordToFile) — портретный канвас 1080×1920 для 90/270 + **КЛЮЧ
  `setIsPortrait(true)`** (иначе `calculateViewPortEncoder` леттербоксит 1080×607) + поворот В ИСТОЧНИКЕ
  (`RotatableSource`: VirtualVideoSource крутит сам Canvas-ом, энкодер rotation=0 → getScale=1,1) ЛИБО
  `setCameraOrientation(deg)` для реальной камеры (GL OES). БЕЗ `(360-x)`-инверсии/`setStreamRotation`.
  Полная эпопея → `bugs/10_DONE_*` (раздел «🏆 ЭПОПЕЯ»).
- ✅ **Bug 12** — превью теряло ручной поворот после поворота девайса туда-обратно — исправлен
  (stale-capture в SurfaceTextureListener → `rememberUpdatedState`). `UvcPreviewView`.
- ✅ **Bug 11** — текст виртуалки наползал + 30 FPS-метка — исправлен.
- ✅ **Idea 14** — дев-меню на английском, убрана серая строка, лонг-тап открытия = 2с
  (`LocalViewConfiguration.longPressTimeoutMillis` в `SettingsRow`; `ui.mjs longpress` дефолт 2500мс).
- ✅ **Idea 13** — уголки виртуалки отодвинуты вглубь кадра (отступ 6% каждой оси).
- ✅ **Idea 11** — запись вирт-стрима публикуется в публичный `DCIM/KrinikCam` через MediaStore
  (заготовка под будущую фичу сохранения видео/фото в галерею). `RtmpStreamer.publishRecordingToDcim`.
- ✅ **Idea 12** — навык `/release` (`.claude/skills/release/`) — оркестратор вокруг `tools/release.mjs`.
- ✅ **Idea 15** — тег `DONE` в именах закрытых файлов `bugs/`/`ideas/` + правило в AGENT_GUIDE.
- 🛠 **Новые скиллы/процессы:** `/bug-research` (после 3 неудачных попыток — исследование без кода),
  `/autoloop` (длительная автономная серия по пулу), `PHILOSOPHY.md` (KISS + Оккам).
- 📌 **ADB-девайс динамический IP** (Headwolf Titan 1, serial `DHF8256GB25442874`, Android 16/SDK 36):
  IP меняется с сетью (видели 192.168.1.3 и 192.168.50.188). Переподнятие — через USB:
  `adb -s <serial> tcpip 5555` → `adb connect <ip>:5555`. См. память device_test_target.

**Сделано в сессии 2026-06-28 (поздний вечер):**
- ✅ **Поворот видео — ПРЕВЬЮ и ЛАНДШАФТНЫЙ стрим готовы**, ❌ **портретный СТРИМ искажён (Bug 10, открыт).**
  - ✅ Превью-поворот — все 8 комбинаций (девайс ландшафт/портрет × угол 0/90/180/270), подтверждено
    на устройстве. Реализация: display-only матрица на TextureView (`UvcPreviewView.applyPreviewRotation`,
    масштаб через 16:9-rect камеры). Меню углов `RotationMenu.kt`, блок в эфире.
  - ✅ Ландшафтный RTMP-стрим (0°) — подтверждён ЖИВЬЁМ на YouTube, стабильно ~5 Mbps, переживает
    повороты девайса в эфире (превью переподцепляется, Bug 03 fix).
  - ❌ **Портретный стрим 9:16 (90/270) — искажён** (сжат/растянут). 5 попыток разными API RootEncoder,
    все с искажением аспекта. Полный разбор + база знаний research + анализ кода → `bugs/10_portrait_stream_squished.md`.
  - Дизайн/решения/YouTube-research фичи → `ideas/06_video_rotation.md`.
  - Новый инструмент: `ui.mjs orient <auto|portrait|landscape|…>` (вращение приложения по ADB через
    debug-broadcast-приёмник в `MainActivity`, перебивает fullSensor).
- **Bug 09** — USB-диалог доступа к камере при каждом реплаге ✅ закрыт (подтверждено Криником с
  чистого старта: камера поднимается без диалога вообще). Добавлен `USB_DEVICE_ATTACHED` intent-filter
  + `res/xml/device_filter.xml` (UVC class 239/2 + 14) в `app` → Android авто-выдаёт доступ при
  запуске по attach (грант персистентен), навязчивость убрана полностью. Закрывает старый Bug 3.
  Фикс #2: `launchMode="singleTask"` — без него intent-filter плодил по экземпляру MainActivity на
  каждый attach (стопка ~15 диалогов); singleTask → 1 экземпляр. `bugs/09_*`.
- **Bug 08** — Settings не скроллился в ландшафте ✅ исправлен: `verticalScroll` корневому Column в
  `SettingsScreen.kt` + нижний Spacer. Также добавлена команда `ui.mjs swipe <dir> [frac] [ms]` для
  тестирования прокрутки. Проверено на устройстве (ландшафт 2560×1600). `bugs/08_*`.
- **Bug 06** — «Build Error» в статус-баре VS Code ✅ закрыт. Причина: VS Code/Buildship гонял Gradle
  на встроенной Java 21 и не находил JDK 17 для `jvmToolchain(17)`. Фикс: `~/.gradle/gradle.properties`
  → `org.gradle.java.installations.paths` = Android Studio JBR (Java 17). Подтверждено Криником
  (ошибка в статус-баре исчезла). Пост-мортем: `bugs/06_gradle_vs_code_warnings.md`.
- **UX: кнопка ре-запроса разрешений** ✅ — секция «Permissions» в `SettingsScreen.kt`: живой статус
  Camera/Mic, умный тап (askable → системный диалог; навсегда запрещено/всё выдано → App Info через
  `ACTION_APPLICATION_DETAILS_SETTINGS`). Проверено на устройстве: обе ветки + ре-грант микрофона.

**Сделано в сессии 2026-06-28 (вечер):**
- Phase 2 P2 «Please stand by» кадр в RTMP — реализован и подтверждён живым тестом (2 цикла
  отключения/подключения USB во время стрима, поток не оборвался). Файлы: `StandbyFrameRenderer.kt`,
  `StandbyVideoSource.kt`, `RtmpStreamer.enterStandby/exitStandby`, glue в Repository/VM/MainScreen.
- Интервью #004 (таймаут источника + USB permission) — проведено и закрыто, готово к реализации.
- Новый скилл `/interview` (`.claude/skills/interview/`) — для редких UI/UX/бренд/архитектурных решений.

### Закрытые баги (Phase 2)

**Bug 01 — Чёрный экран** ✅ ЗАКРЫТ — полный post-mortem в `bugs/01_black_screen_gl_pipeline.md`
- Root cause: `encoderSize=0` в `GlStreamInterface` до вызова `prepareVideo()` → `initGl(0,0)` крашится → `secureSubmit()` глотает исключение → `isRunning` навсегда `false`
- Фиксы: `setEncoderSize(1920,1080)` до `startPreview`; устранение двойного триггера; retry VideoSource после GL готов

**Bug 03 — Ориентация** ✅ ЗАКРЫТ — полный post-mortem в `bugs/03_landscape_preview_corner.md`
- Root cause: GL render surface не пересоздавался при ротации; `autoHandleOrientation=true` добавлял лишний поворот
- Фиксы: `onSurfaceTextureSizeChanged` → перезапуск `startPreview(tv)`; `AspectRatioMode.Adjust` для letterbox

**Bug 02 — Go Live / RTMP** ✅ ЗАКРЫТ — полный post-mortem в `bugs/02_streaming_bugs_go_live.md`
- Root cause: `prepareVideo` — перепутан порядок (fps↔bitrate) → энкодер с 30 бит/с → только звук
- Фиксы: правильный порядок args; `setCameraOrientation(0)`; `onSurfaceDestroyed → stopPreview()`

**Phase 2 P2 — "Please stand by" кадр в RTMP** ✅ ЗАКРЫТ — подтверждено на устройстве 2026-06-28
- Полный дизайн + план теста: `plans/phase2_standby_frame.md`
- Подход: при отключении USB-камеры во время стрима — горячая подмена `VideoSource` на
  `StandbyVideoSource` (рисует bitmap в GL Surface @ 5 fps через `lockCanvas`), поток не рвётся.
- НЕ фильтр: RootEncoder 2.4.7 не имеет bitmap-источника; фильтр не работает без тика onFrameAvailable.
- Новые файлы: `StandbyFrameRenderer.kt`, `StandbyVideoSource.kt` (оба в `:feature:streaming`).
- `RtmpStreamer.enterStandby()`/`exitStandby()` через `changeVideoSource` (проверено javap).
- Сборка ✅, установка ✅, превью без регрессий ✅. **Нужен живой тест:** Go Live + физическое
  отключение/подключение USB-камеры (нужны руки Криника + валидный stream key).
- ⚠️ Главный риск: `lockCanvas` на GL-привязанной SurfaceTexture — подтвердить на железе.

**Bug 05 — Краш release-сборки при старте камеры** ✅ ЗАКРЫТ (2026-06-28) — `bugs/05_release_0.3_build_crash.md`
- Root cause: R8 (`minifyEnabled`+`shrinkResources`) переименовал/вырезал JNI-классы/методы
  (`com.serenegiant.usb.UVCCamera.nativeSetStatusCallback`, `IStatusCallback`) → `NoSuchMethodError`
  при `System.loadLibrary` нативной UVC-либы. Только release (debug не минифицируется).
- Фикс: keep-правила в `app/proguard-rules.pro` для `com.serenegiant.**` / `com.jiangdg.**` /
  `com.pedro.**` + `-keepclasseswithmembernames ... native <methods>`.
- Подтверждено на устройстве: release-превью ✅ + RTMP-стрим ~5 Mbps ✅, без крашей.

**Bug 04 — Модалка платформ: 3 дефекта** ✅ ЗАКРЫТ (2026-06-28) — `bugs/04_platforms_modal.md`
- 04.1 Name автоподстановка после 1-й смены платформы (сравнивал с `initial`, не со всем списком).
- 04.2 Тап мимо dropdown закрывал всю форму (`dismissOnClickOutside=false`).
- 04.3 Поля Width/Height/FPS пустые в ландшафте (вертикальный клиппинг → `verticalScroll`).
- Все три проверены на устройстве через ui.mjs + скриншоты.

**Bug 06 — «Build Error» в статус-баре VS Code** ✅ ИСПРАВЛЕН (2026-06-28) — `bugs/06_gradle_vs_code_warnings.md`
- Root cause: Gradle/Java-расширение VS Code запускало Gradle на встроенной Java 21 и не находило
  JDK 17 для `jvmToolchain(17)` → таск `:app:compileDebugAndroidTestJavaWithJavac` не конфигурировался.
  CLI-сборка не страдала (там `JAVA_HOME` = JBR 17).
- Фикс: `~/.gradle/gradle.properties` → `org.gradle.java.installations.paths` = Android Studio JBR
  (Java 17). Делает JDK 17 видимым для авто-детекта toolchain у любого Gradle (даже демона IDE на
  Java 21). `.vscode/settings.json` (`java.import.gradle.java.home`) НЕ помог — Buildship его игнорит.
  Проверено: падавший таск конфигурируется даже на Java 21. После Reload Window `Build Error` в
  статус-баре исчез — подтверждено Криником 2026-06-28. ✅

**Релиз v0.3** ✅ ОПУБЛИКОВАН (2026-06-28) — https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/v0.3
- Latest, с APK `KrinikCam-v0.3.apk`. Включает: standby-кадр, UX-фиксы, Bug 04, Bug 05.
- version.json теперь {0,3,0}. Следующий релиз: `node tools/release.mjs` даст v0.4 (Phase 3+).
- Заметка для будущего: `release.mjs` делает `git add -A` — следи, чтобы дерево было чистым перед
  релизом (иначе подметает мусор; `*.apk` и `.kotlin/` теперь в .gitignore).

**С чего продолжить в следующей сессии:**
0. ✅ **Bug 10 / Idea 06 — ЗАКРЫТЫ** (портрет + ландшафт стрим на YouTube подтверждены живьём, повороты
   в эфире ок). Реальная камера через `startStream` использует `setCameraOrientation(deg)` — путь
   написан и принципиален, НО вживую тестировался с ВИРТУАЛЬНОЙ камерой; при первом стриме с ФИЗИЧЕСКОЙ
   UVC-камерой стоит разок сверить портрет (на всякий — реальная камера идёт через GL OES, не Canvas).
1. 🟡 **interview_004 — таймаут источника: LIVE-ПРОВЕРКА на YouTube** (код готов, заводится). Сценарий:
   стрим (можно виртуалкой через реальный RTMP) → `adb ... SET_VIRTUAL_CAM --es state off` (разрыв) →
   ждать ~2с → должна быть ЗАМОРОЗКА последнего кадра → `... state on` в пределах 5с → бесшовный возврат
   к live; ИЛИ ждать >5с → cross-fade в «Please stand by». Проверить, что 4К-стрим НЕ рвётся при разрыве
   (freeze-источник 10fps software-draw на 4К — подтвердить, что энкодер не голодает; если голодает —
   перевести standby/freeze на GL-рисование вместо lockCanvas). `FreezeStandbyVideoSource`,
   `RtmpStreamer.enterStandby`. Плавный фейд заглушка→камера (Q2) — отдельным шагом позже.
2. 🟡 **Idea 16 п.2 — мультистрим + профили кодирования** (Phase 2 headline). Архитектура: где живёт
   битрейт, модель профилей кодирования и привязка к платформам, 1 энкодер→N платформ vs N энкодеров,
   виртуальные стрим-каналы для сравнения. Рекомендуется ИНТЕРВЬЮ перед кодом. `ideas/16_*`.
3. 📅 **Idea 17 — запись видео/фото в файл** (4К-запись проверена ✅). При разрыве камеры во время
   записи — финализировать файл (НЕ подменять источник). `ideas/17_*`.
4. Графика: app icon (`ic_launcher.svg` → mipmap-*), standby bitmap, notification icon
5. Мелкие улучшения UX из фидбэка Криника:
   - ✅ FAB закрытие тапом снаружи (2026-06-28) — прозрачный scrim в `FloatingRadialMenu`
   - ✅ Dropdown платформ — контраст цветов (2026-06-28) — `DropdownSurface` 0xFF3A3A3A в `StreamPlatformsOverlay`
   - USB permission "запомнить" (`PendingIntent` с флагом) — см. интервью #004
   - Задержка перед standby (5 сек буфер + fade) — см. интервью #004
   - ✅ Кнопка "повторно запросить разрешения" в Settings (2026-06-28) — секция Permissions в
     `SettingsScreen.kt`: живой статус Camera/Mic, умный тап (askable → системный диалог; навсегда
     запрещено/всё выдано → App Info через ACTION_APPLICATION_DETAILS_SETTINGS). Проверено на
     устройстве (обе ветки + ре-грант микрофона).

Графика приложения ещё не создана:
- [ ] App icon (`ic_launcher.svg` → mipmap-*)
- [ ] "Please stand by" bitmap (`standby.svg` → 1920×1080)
- [ ] Notification icon

---

## Результаты тестирования на устройстве (Krinik, 27.06.2026)

Полный отчёт: `homeworks/01_before_phase2.md`

### Работает хорошо ✅
- Превью: чёткая картинка, автоэкспозиция работает, задержка минимальная
- Standby при отключении камеры — мгновенно, без краша
- FAB-меню (3 кнопки: Go Live, Platforms, Settings) — красивая анимация
- Platforms overlay (bottom sheet) — открывается, поля работают, профили сохраняются
- Settings экран — открывается, Share logs работает
- Повторное подключение камеры — работает после выдачи USB permission

### Баги ❌

**БАГ 1 — КРИТИЧЕСКИЙ: RTMP краш → архитектурно исправлен, тестируется**
- Оригинальная причина: `RtmpCamera1` открывал Camera1/Camera2 API → конфликт с USB-камерой → краш
- Фикс: `RtmpCamera1` → `RtmpStream` + `UvcVideoSource` (VideoSource API). Камера открывается через AUSBC прямо в GL SurfaceTexture, Camera API не используется.
- **Чёрный экран (текущий баг, фикс написан, не протестирован)**:
  - Причина: race condition в RootEncoder. `StreamBase.startPreview()` вызывает `videoSource.start(getSurfaceTexture())` сразу после `glInterface.start()` — до того как GL render loop установил `running=true`. `GlStreamInterface.onFrameAvailable()` дропает кадры пока `isRunning()=false`.
  - Фикс: `RtmpStreamer.scheduleVideoSourceRetryIfNeeded()` — после `startPreview()` ждёт (корутина, 50ms intervals) пока `glInterface.isRunning=true`, затем вызывает `stream.changeVideoSource(src)` для пересоздания камеры с корректной SurfaceTexture.
  - Файл: `feature/streaming/src/main/kotlin/com/kriniks/kcam/feature/streaming/rtmp/RtmpStreamer.kt`

**БАГ 2: Видео повёрнуто / растянуто** ✅ ИСПРАВЛЕН (портрет + ландшафт)
- GL pipeline рестартует при повороте через `onSurfaceTextureSizeChanged`
- `AspectRatioMode.Adjust` обеспечивает letterbox без искажений
- Портрет: ✅ Ландшафт: ✅ (проверено на устройстве 28.06.2026)

**БАГ 3: USB permission диалог каждый раз при переподключении**
- При каждом reconnect камеры — системный диалог "Разрешить доступ к USB?"
- Нужен флаг "не спрашивать снова" (`PendingIntent` с флагом)

**Мелкие улучшения (из фидбека Криника):**
- FAB не закрывается тапом снаружи
- Dropdown платформ плохой контраст (цвет похож на фон)
- Задержку перед standby при отключении камеры (5 сек буфер + плавный fade)
- ✅ Кнопка "повторно запросить разрешения" в Settings (если запрещены в ОС) — сделано 2026-06-28
- Горячая кнопка поворота видео в real-time

---

## Backlog Phase 2

- **"Please stand by" кадр** — GL-фильтр при отключении камеры (`sendStandbyFrame` в `RtmpStreamer`)
- **Одновременный стрим** на несколько платформ
- **Camera2 fallback** — телефонная камера как источник
- **USB permission** — флаг "запомнить" устройство (`PendingIntent` с флагом)
- **Улучшение UI** — FAB тап снаружи, контраст dropdown, задержка standby, кнопка ре-запроса разрешений

---

## Важные решения, принятые пользователем

| Тема | Решение |
|------|---------|
| Камера при запуске | Fullscreen сразу, приоритет: UVC → задняя → передняя → любая → чёрный экран |
| UI | Радиальное FAB-меню (стиль Sims 3) |
| Платформы | Модальный overlay (не отдельный экран) |
| Аудио | Микрофон телефона в Phase 1 |
| Профили видео | Запрашивать нативные размеры через USB bus |
| Заглушка | "Please stand by" инжектируется в RTMP поток |
| Логирование | Обязательный file-logger с шарингом через FileProvider |
| Кодеки | CodecScanner как фундаментальный модуль |
| Новые фичи | Интервью перед каждой Phase |


# ═══ Ночной цикл 2026-07-18 (полные детали, вынесено из STATUS по правилу размера) ═══

## 🌙 Ночной цикл 2026-07-18 — bug 33 фикс · bugs 34/36/38/39 DONE (эфир живёт в фоне!)
- ✅ **bug 38 ЗАКРЫТ** — в release ни одного exported-ресивера (SET_VIRTUAL_CAM/SET_ORIENTATION/CMD
  под BuildConfig.DEBUG); приёмка: release глух к броадкастам, debug реагирует (контроль).
- ✅ **bug 39 ЗАКРЫТ** — CMD-протокол един ([,\s]+ во всех 8 точках), select-source builtin и
  gesture-pinch направление/frac починены, ui.mjs pinch/twist на комма-протоколе, доки
  синхронизированы, В smoke добавлен КОНТРАКТ-ШАГ протокола (рассинхрон теперь валит smoke).
- 🌍 **plans/13 ЛОКАЛИЗАЦИЯ ЗАВЕРШЕНА ЦЕЛИКОМ** (включая S3): User Manual — все 11 секций в
  ресурсах с академичным EN-переводом (values-ru = оригинал 1-в-1), имена камер-источников
  локализованы. Приёмка обеих локалей живьём (dump), smoke PASS. Канон: новый UI-текст — ключом
  сразу в values и values-ru.
- 🌍 **plans/13 (история захода): S1+S2+S4 сделаны** — приложение говорит на EN (дефолт) и RU (values-ru)
  вместо прежней мешанины; снэкбары через UiText (VM без Context); приёмка: обе локали живьём в
  dump, smoke PASS. Планшет системно русский → у Криника теперь РУССКИЙ интерфейс. Остаток: S3
  User Manual (этап B) + displayName источников из :feature:capture (русский хардкод в данных).
- ✅ **plans/12 ЗАВЕРШЁН + bug 37 DONE ЦЕЛИКОМ** (S5/S6): Twitch-ingest → канон /app,
  Instagram/TikTok — честные пустые дефолты; SAF импорт/экспорт в IO; дедуп импорта; диалог
  подтверждения удаления (UI-приёмка живьём: диалог/Cancel/Delete); предупреждение о ключах;
  чистка activeProfileId. **Первые юниты проекта: 5/5 зелёные** (:data:profiles:testDebugUnitTest).
- 🔐 **bug 37 №2: RELEASE ТЕПЕРЬ ПОДПИСЫВАЕТСЯ НАСТОЯЩИМ КЛЮЧОМ** (apksigner: CN=KrinikCam,
  OU=KOT KRINIK; ключ лежал с 12.07, gradle не был подключён). Фолбэк на debug с WARNING на машине
  без ключа. ⚠️ Кто ставил debug-подписанный release v0.7 — одно обновление через переустановку.
  **Бэкап ключа — ДЗ-06, критично.** plans/12: S1-S4 сделаны, остаток S5+юнит.
- ✅ **bug 37: 3 из 4 бомб данных обезврежены** — №1 Room: destructive-фолбэк убран + схема в git;
  №3 stream-ключи в логах теперь `•••` (RtmpRedact во всех точках, проверено полигоном); №4 формула
  versionCode → major*1M+minor*10K+build (переполнение на сотом билде обезврежено, 710→70010).
  **Остаток №2: keystore — ждёт Криника** (interview_009 + homeworks/06).
- 🧹 **Ревизия беклога (/check-backlog):** +DONE багам 20 (репро-прогон 01:28: отрыв источника при
  записи — процесс жив, запись росла), 22, 24 (верифицированы живьём 06.07, Phase 3), 26 (фикс в
  .vscode сверен). **Открытый остаток bugs/:** 16, 17, 23 (нужна вебка/руки — день), 29 (частично,
  сверить симптомы 2-3), 33 (ждёт ДЗ-07 Криника), 35 (день, hot-plug), 37 (беру следующим).
  plans/ глубоко не ревизовал (ночь) — дневному /refresh-context: 01/04/05/07/08/11/12/13.
- ✅ **bug 36 ЗАКРЫТ, plans/10 ЗАВЕРШЁН** — StreamForegroundService: эфир переживает выключенный
  экран (5 мин на полигоне, 2 выхода, пуллы 385/339+339 кадров) и сворачивание HOME (355+355),
  нотификация «🔴 LIVE» с кнопкой Stop появляется/снимается, wake lock, POST_NOTIFICATIONS оживлён,
  UM §7 дополнен. Урок EXP-0014: FGS-типы Android 14+ валидируются живой капабилити — connectedDevice
  добавляем только при реальном USB-гранте (краш пойман приёмкой). Экран больше не выключаем по
  просьбе Криника (пароль) — HOME-тест сделан вместо второго цикла экрана.
- 🟡 **bug 33 (USB-диалог на каждое подключение)** — фикс закодирован и стоит на планшете (0.7(3)):
  S1 UVC-фильтр в `onAttachDev` (не-камеры: ни диалога, ни фантома в списке) + S2 лечение гонки
  автогранта (поллинг hasPermission до 900мс, диалог только по таймауту). Smoke PASS, судья
  VERIFIED WITH CAVEATS ([NOT-TESTED] живой hot-plug — ночью нечего втыкать).
  **❓ ДЗ Кринику на утро: `homeworks/07_usb_dialog_acceptance.md`** (мышь → тишина; камера → диалог
  1 раз С ГАЛОЧКОЙ «всегда»; передёрнуть → тишина) → после ✅ пометить bug 33 DONE.
- ✅ Селфи-камера проверена живьём (00:47, кадр с фронталки рендерится — виден мак Криника).
- ✅ **bug 34 ЗАКРЫТ, plans/09 ЗАВЕРШЁН** — финальный пункт матрицы S5 (п.2, два живых выхода)
  пройден на полигоне: оба `connected ✓`, сервер держит обе публикации (H264+AAC), параллельные
  ffmpeg-пуллы сняли по 472 кадра/3.5 МБ с каждого пути за одно окно, 0 сбоев, стоп чистый.
  Мультистрим-стабилизация принята ЦЕЛИКОМ. Остался только тест на живых ключах (homeworks/05).


---

# Архив срезов STATUS (унесено 2026-07-26 при паузе — правило размера STATUS)

## 🎬 2026-07-19 — ЭПИК «Профили сцен» (idea 40 / plans/18): ФАЗА 0 СДЕЛАНА (персист сцены + FAB)
По указанию Криника («напиши план с фазами, по каждой отдельный техплан; фазу 0 — делаем»). Дорожная
карта эпика перекроена «по ценности» (`plans/18_scene_profiles.md` + отдельные `18_phase0..3_*.md`).
**Ф0 = MVP: настроенная сцена переживает перезапуск приложения + видимый FAB «Сцены».**
- **Персист (без Room, без миграций):** снапшот текущей сцены → JSON в DataStore (`kcam_scene`, приём
  как у `DeviceProfile`); оверлеи-картинки → PNG-файлы (`filesDir/overlays/<id>.png`), в снапшоте — путь.
  Restore в `RtmpStreamer.init` (после scope), автосейв `scene.drop(1).debounce(400)`.
- **Файлы:** `scene/persist/{SceneSnapshotDto,SceneSnapshotMapper,ImageOverlayStore,SceneSnapshotRepository}`
  (:feature:streaming) + `SceneSnapshotStore` (:data:profiles). Маппер чистый (лямбды bitmap↔файл) →
  round-trip юнит на pure-JVM (`:feature:streaming:testDebugUnitTest` зелёный). id `camera_N`/`overlay_N`
  переведены на скан сцены (не коллидят после restore).
- **UI (по правкам Криника в чате):** FAB «Сцены» рядом с FAB слоёв (внизу-слева, ТА ЖЕ форма/тон —
  тёмный корпус + кислотный розовый). Тап → **панель-список в стиле StreamLayersOverlay** (от левого
  края, растёт вверх). Ф0-панель: «Текущая сцена · N сл.» (индикатор). Список именованных сцен — Фаза 1.
- **МЕНЮ → СПИСКИ (Криник: «радиалка сильно грузит»):** ГЛАВНОЕ меню тоже переведено с радиалки на
  панель-список (`FloatingActionMenu` + общий `FloatingPanelMenu`): В эфир (акцент) / Запись / Фото /
  Платформы / Кодер / Настройки, растёт вверх от FAB низ-право, без покадровой анимации веера (та лагала
  поверх живого TextureView). Радиальные файлы удалены. Главное меню поднято, чтобы нижний ряд не цеплял FAB.
- ✅ **ПРОВЕРЕНО ХАРНЕСОМ:** сцена 4 слоя (база + 2 оверлея с трансформами + доп. камера `virtual`) →
  `scene-save` → `am force-stop` → запуск → `Scene restored: 4 layers`, дамп «после» == «до» 1:1;
  PNG-оверлеи записаны/загружены; сироты чистятся; 0 крашей. Оба меню-списка проверены скриншотами живьём.
- 🟡 **По дизайну не в Ф0:** источник БАЗОВОГО слоя идёт через `DeviceManager.activeSource` (не сцену) —
  после рестарта база на авто-выборе; полное устранение дуализма (источник базы в сцене) — Фаза 1.
- ✅ **bug 49 (краш при возврате из Settings) — ПОФИКШЕН + проверено живьём Криником («не крешит»):**
  нативный HWUI-abort `drawRenderNode ... no surface` — превью-**TextureView** пересоздавался при
  навигации (жил в MAIN-destination Nav). Фикс: **вынес `UvcPreviewView` в `MainActivity` ВЫШЕ NavHost**
  — превью не диспоузится/не пересоздаётся, Settings рисуется поверх. GL-код не тронут. Быстрый фикс
  (отключить Nav-анимации) НЕ помог — откачен. Форензика — `bugs/49`.
- 🟢 Часть закоммичена (0.8(5): Ф0 + меню-списки). **Фикс bug 49 — ждёт коммита** (Криник на звонке).
  🟡 Ждёт живой приёмки сцен Криником (реальная вебка + оверлеи).

## 🚀 2026-07-19 — РЕЛИЗ v0.8 «Мультиисточники, шаринг фида, профессиональное кодирование»
Выпущен [v0.8](https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/v0.8) (APK приложен, ноты EN/RU
с переключателями). Итог цикла после v0.7:
- **Мультиисточники (idea 21 Фаза B):** несколько НЕЗАВИСИМЫХ камер на разных слоях одновременно
  (UVC + селфи). Разные `sourceKey` → независимые фиды.
- **Шаринг фида (bug 58 DONE, Вариант 2):** ОДНУ камеру на НЕСКОЛЬКО слоёв — устройство открывается
  один раз, кадр раздаётся в слои-ЗЕРКАЛА (`mirrorOf`), как OBS «дублировать источник» (крупно + PiP).
  UVC-нюанс: опенер зеркала делит физ-объект с первичным → его close() нельзя (гард `openedLayers`,
  EXP-0019). Приёмка живьём для фронталки И UVC (PSNR зеркала подтвердил живость).
- **bug 57 DONE:** модалка выбора источника при добавлении слоя + выбор пер-слой; **bug 59 DONE:** дедуп
  UVC в списке по VID+PID (физприёмка Криника); радиокнопка пикера отражает актуальный выбор.
- В README/фичах отражены и более ранние 0.7-фичи: профили кодера, адаптивный битрейт+телеметрия,
  запись в галерею+фото, выбор языка, локализация EN/RU + User Manual.
- **Дальше:** приёмка per-layer standby/reconnect на живых мультиисточниках; хвост UVC-реконнекта той же
  вебки (bug 45/54 семья); мультистрим на живых ключах (ДЗ-05); беклог bugs/ideas.

## 🖼️ Вечер 2026-07-18 — Заглушка «нет сигнала» = СОСТОЯНИЕ слоя-камеры (bugs 17+47 DONE)
По указанию Криника «заглушка живёт ВНУТРИ слоя, а не поверх экрана». Старый полноэкранный
Compose-оверлей `StandbyPlaceholder` УДАЛЁН (накрывал всю сцену, не двигался со слоем, только в превью).
Теперь заглушку рисует GL-композитор (`CompositorVideoSource` + `StandbyImage`) В КВАДРАТЕ слоя-камеры:
- **Per-слой:** двигается/масштабируется со слоем, попадает в эфир/запись; отвал одного источника
  показывает заглушку ТОЛЬКО в его слое, остальная сцена цела.
- **Hold замороженного кадра КАМЕРЫ** (не всего композита — закрывает bug 17): `enterCameraStandby`
  замораживает OES на последнем ХОРОШЕМ кадре (не забираем чёрный кадр закрытия AUSBC), держим до 10с.
- **Кросс-фейд:** кадр гаснет → остаётся только ПРОЗРАЧНЫЙ текст (без чёрной плашки); возврат источника
  (`exitCameraStandby`) плавно убирает заглушку. Фейд 500мс, сглаживание по dt.
- **Стиль:** розовый заголовок «KrinikCam» ПУЛЬСИРУЕТ (дыхание, как старое превью); подпись «Please
  stand by / Пожалуйста, подождите» — жирный белый с чёрным контуром (обе строки в одном стиле).
- ✅ **ПРОВЕРЕНО ЖИВЬЁМ** (планшет, скриншоты): hold держит кадр камеры в квадрате слоя → кадр гаснет →
  только текст на прозрачном → двигал слой (заглушка едет с ним) → возврат источника убрал заглушку →
  пульс заголовка (сверил яркость по фазам). Подтверждено Криником: «теперь правильно», «всё красиво».
- 🟡 Возврат ТОЙ ЖЕ UVC (none→uvc) не переотдаёт кадры (заглушка не уходит) — отдельный нюанс
  changeVideoSource UVC (bug 45/54 семья), НЕ регресс заглушки; через смену типа (virtual) возврат чистый.

## 🧩 Вечер 2026-07-18 — РЕФАКТОР: профиль кодера = ОТДЕЛЬНАЯ сущность (plans/14, bugs 41-44+51)
По правке Криника: настройки кодера вынесены из платформы в отдельный **менеджер профилей кодера**;
платформа лишь ссылается на профиль по id (правка профиля задевает все платформы, без снимков).
- **Модель/Room v3→v4:** новая `EncoderProfile` (таблица encoder_profiles) + `StreamProfile.encoderProfileId`;
  `VideoCodec` +AV1 (bug 42); `AudioChannelMode` Стерео/Моно/Объединённое (bug 44); битрейт «Своё» в
  Мбит/с (bug 43). `MIGRATION_3_4` вытаскивает кодер-поля каждой платформы в свой профиль кодера.
- **Проводка:** стример/репозиторий/VM/харнес резолвят `encoderProfileId → EncoderProfile`; запись в
  файл кодируется профилем активной платформы (bug 51). Юниты 8/8, schema 4.json в git.
- **UI:** новый `EncoderProfilesOverlay` (CRUD профилей кодера, AV1, Мбит, 3 режима каналов);
  форма платформы теперь только пикер профиля + «Управление профилями кодера».
- ✅ **ПРОВЕРЕНО ЖИВЬЁМ:** миграция v3→v4 на РЕАЛЬНОМ профиле (сид kcam_v3 «YouTube» → пережил: платформа
  цела, encoderProfileId=2, создан профиль кодера «YouTube — кодер» H264/4Mbit/44100/STEREO, 0 ошибок
  Room); ffprobe записи `720,H265,48000,joined` → hevc/1280×720/48000/2ch, 864 кадра — профиль кодера
  реально доходит до энкодера через новый путь.
- 🟡 **[NOT-TESTED] живьём:** сам новый UI-менеджера (создание/правка профиля кодера через диалог,
  пикер в форме платформы) — СКОМПИЛИРОВАН и провязан, но кликами на устройстве не гонялся. Ждёт
  живой UI-приёмки Криника.
- 🟡 **Остаток bug 44:** JOINED_STEREO пока стерео-passthrough (2 канала), истинный даунмикс L+R→оба
  канала (L=R) требует PCM-фильтра RootEncoder — помечено TODO в коде и bug 44. STEREO/MONO корректны.
- 🟡 **bug 42 AV1:** код готов (enum+маппинг+UI), но запись именно AV1 ffprobe'ом не сверена (нужен
  аппаратный AV1-энкодер устройства) — проверить отдельно.
**Догон (день, тестирование/полировка):**
- ✅ **bug 42 — выбор кодека ТОЛЬКО по железу:** `CodecScanner` (MediaCodecList) → в дропдауне лишь
  кодеки, что SoC умеет кодировать. Проверено: Dimensity 8300 = H.264+H.265, **AV1-энкодера НЕТ**
  (лог + скриншот дропдаука без AV1). Убрано предупреждение «только если» — теперь это запрет.
- 🔴→✅ **Краш на старте (моя регрессия):** `CodecScanner.getSupportedFrameRatesFor` кидал
  `IllegalArgumentException` у части кодеков → приложение падало через ~1с после запуска (выкидывало на
  лаунчер). Обёрнуто в защиту + кэш скана. Проверено: приложение живо 6с+, FATAL нет.
- ✅ **UI-полировка листа:** Импорт/Экспорт → компактные иконки; кнопка «+» → заметная залитая;
  `sheetMaxWidth`; лист wrap-высоты (мало → минимально, много → ≤половины + скролл + драг до полного —
  проверено скриншотами); заголовок редактора → «Профиль кодека». **LaunchedEffect «держать раскрытым
  при удалении» — ПРОВЕРЕН ЖИВЬЁМ** (драг до полного → удалил платформу → лист остался на весь экран;
  скриншот+дамп: заголовок на y=180). ✅
- 🔴 **bug 54 (ВЫСОКИЙ, открыт):** чёрное превью + интермиттентный НАТИВНЫЙ краш записи
  (`prepareVideo→isBitrateModeSupported`). Стектрейс пойман живьём, но в контролируемых тестах НЕ
  воспроизведён (запись работает: H264 харнес ✓, UVC-превью во время записи ✓). Гипотеза: пере-открытие
  UVC при старте (`changeVideoSource`, связь с bug 45) + MediaTek-флакость. Нужен детерминированный repro.
🟢 Не закоммичено (коммичу этим заходом). Девайс: сид-профиль «YouTube», тестовые платформы почищены.

## 🎛️ День 2026-07-18 (интерактив с Криником) — ПРОФИЛЬ КОДЕРА (первый заход, переработан выше)
Криник: «битрейт словно всегда хардкод 5000, хочу настраиваемые профили — разрешение/битрейт/fps/звук».
Проверка кода: хардкода 5000 давно нет (битрейт/разрешение/fps уже из профиля → энкодер), НО две дыры —
**битрейт не редактировался в UI** (лил дефолт 4 Мбит) и **звук был захардкожен** `prepareAudio(44100,true,128k)`.
Закрыто (решение Криника: битрейт+звук+кодек, ввод битрейта пресеты+«своё»):
- **Модель:** +`videoCodec`(H264/H265) +`audioBitrateBps/audioSampleRate/audioStereo`; enum `VideoCodec`.
- **Room v2→3** (`MIGRATION_2_3`, дефолты = прежнее поведение) — **ВТОРАЯ живая миграция**: на планшете
  build 23(v2)→новый(v3), профиль «YouTube» ПЕРЕЖИЛ апгрейд, новые колонки с дефолтами, 0 крашей.
- **Энкодер:** `setVideoCodec` до prepareVideo; `prepareAudio` из профиля (эфир и запись).
- **UI редактора:** битрейт (чипы-пресеты Мбит + «Своё» кбит), кодек-дропдаун (+подсказка HEVC/RTMP),
  битрейт/частота звука дропдауны, моно/стерео; секции «Видео»/«Звук». Строки EN/RU, UM §8, юниты +4.
- **Приёмка ffprobe** (запись профиля `720,H265,192,48000,mono` через харнес): `hevc` + `48000Hz` +
  `mono/1ch` + `191993bps` — каждое НЕдефолтное значение профиля дошло до энкодера (3206 кадров валидн.).
- Харнес: `go-live` теперь несёт `height[,codec][,audioKbps][,sampleRate][,mono|stereo]` (контракт CMD цел).
🟠 **РЕВЬЮ КРИНИКА (2026-07-18): структура фичи забракована** — заведены баги правок (см. ниже,
bugs 41-47). Главное: настройки кодера НЕ должны жить в профиле платформы — нужен ОТДЕЛЬНЫЙ менеджер
профилей кодера, платформа только ВЫБИРАЕТ профиль (bug 41). 🟢 Код профиля кодера не закоммичен.

## 🌙 НОЧНОЙ ЦИКЛ 2026-07-18 (00:50–03:10) — ИТОГ: 10 багов закрыто, 5 планов завершено, 3 идеи

**Закрыто:** bugs 34 (мультистрим принят ЦЕЛИКОМ), 36 (эфир живёт при выкл. экране/в фоне — FGS+
нотификация LIVE), 37 (все 4 «бомбы» данных; release подписан НАСТОЯЩИМ ключом CN=KrinikCam),
38 (exported-ресиверы), 39 (CMD-протокол + контракт-тест в smoke) + ревизией 20/22/24/26.
**Планы ЗАВЕРШЕНЫ:** 09 (мультистрим), 10 (FGS), 12 (release-гигиена), 13 (локализация EN/RU
ЦЕЛИКОМ вкл. User Manual; у планшета теперь русский UI), 01 (unblock — его инструменты отработали ночь).
**Идеи:** 37 DONE (адаптивный битрейт: 4000→1310→восстановление по логам; телеметрия «ЭФИР 12:34 ·
4,7 Mbps» + точка здоровья; ПЕРВАЯ миграция Room 1→2 живьём), 28 DONE (tools/avd.mjs — эмулятор как
тест-девайс, smoke на нём PASS), 38 — скелет-ресёрч готов (researches/restream_server.md).
**Инфраструктура:** первые юниты (5/5), smoke: контракт CMD + --min-fps, EXP-0014…0016.
**🟡 Ждёт приёмки:** bug 33 — фикс USB-диалога на планшете, ДЗ-07 (+ заодно замер bug 29.2).
Подробности ночи — `researches/status_archive.md` (2026-07-18).

## 🧰 2026-07-17 — KAIF обновлён до 1.5 «Tested KAIF» (бутстрап из KAIF.md)
Update-by-bootstrap: машинерия KAIF-CORE (sha256 ✓) сама распознала легаси 1.4; кастомизации и
артефакты сохранены, гейты пройдены (check зелёный, judge VERIFIED), установщик самоочистился.
Новое в проекте: `TESTING_FRAMEWORK.md` (7 принципов + маркеры `[NOT-TESTED]`/`[TESTED: …]`);
fable-навыки `/fable-method` `/fable-loop` `/fable-judge` `/fable-domain` — **judge-проход теперь
ОБЯЗАТЕЛЕН в лупах и `/release`**; intent gate + twin check в `BUG_FIXING_FRAMEWORK.md`; сферы
`.kaif/spheres/`; навыки для 5 агентских систем (`.agents/` `.grok/` `.cline/` `.roo/`); ручки
`kaif:*` → `.kaif/kaif-core.mjs` (корневой `npm run kaif:*`).

## 🚀 РЕЛИЗ v0.7 (2026-07-12, дневной цикл, добро Криника)
Выпущен: https://github.com/MikalaiKryvusha/KrinikCam/releases/tag/v0.7 (`KrinikCam-v0.7.apk`).
Накопление с v0.6: **мультистрим стал боевым** (bug 34: стоп/рестарт S1, изоляция сбоя выхода S3,
авто-реконнект с бэкоффом S4 — всё проверено живьём на полигоне), bug 40 (поворот), keep-screen-on
(bug 36 S1), bug 27 регресс, idea 35 (снап), хвост-краш разобран (сетевой блип).
⚠️ **Оговорка (не регресс, как в v0.6):** release-APK всё ещё подписан debug-ключом; настоящий keystore
не подключён в gradle (plans/12 S2, ждёт пароля Криника / homeworks/06).

## 🔧 Дневной цикл 2026-07-12 — plans/09 S1-S4 ГОТОВЫ (bug 34 почти закрыт) + хвост разобран
- ✅ **ХВОСТ-КРАШ РАЗОБРАН** — краш после долгого эфира = СЕТЕВОЙ БЛИП (bitrate→0, sender завис на
  write(), превью держит 28fps → GL/энкодер живы; сервер read-timeout → Broken pipe). На build 19 фикс
  S1 корректно восстановил превью, КРАША НЕТ. Прошлый краш на build 16 = тот же блип в старом стопе.
  Форензика bugs/34, урок EXP-0012.
- ✅ **plans/09 S2** — per-output ConnectChecker (`Array{i->makeConnectChecker(i)}`, сверено байткодом:
  выход i → checker[i]) + `outputStates: Map<Int,OutputStatus>` + агрегат в `StreamState.Live.outputs`.
- ✅ **plans/09 S3** — изоляция сбоя выхода (`onOutputFailed(i)` стопит только упавший, живые целы;
  упал последний → гасим энкодер + превью). Проверено: [0]полигон Live + [1]кривой URL изолирован.
- ✅ **plans/09 S4** — реконнект с бэкоффом (1→2→4→8с, потолок 5). **КОРЕНЬ (байткод):** `reTry`→
  `shouldRetry` требует `reTries>0`, а счётчик по умолчанию 0 → без `setReTries(n)` эфир умирал на
  ЛЮБОМ блипе. Фикс: `setReTries` перед каждой попыткой. Проверено живьём: убил полигон → attempt
  1/2/3 → `connected ✓` когда вернулся, 0 крашей.
- 🔄 **plans/09 S5** — приёмка пройдена: стоп/рестарт, кривой URL (изоляция), убийство полигона
  (реконнект), smoke. **Остаток:** пункт 2 матрицы (ДВА живых выхода растут разом — полигон, 2 пути
  `live/test`+`live/test2`) → затем **DONE bug 34** и S5 из plans/07 (живые ключи, homeworks/05).

## 🔧 Вечер 2026-07-12 (дом родителей, Titan 1 @ 192.168.2.109, виртуалка/Piko+) — plans/09 S1 + bug 40 DONE

- ✅ **bug 40 DONE (сверено живьём Криником)** — физический поворот планшета пейзаж↔портрет: превью
  вписывается целиком, НЕ уезжает; краша нет (bug 27 не регрессировал). Причина была: билд с фиксом
  (0.6(16)) не стоял на планшете — предыдущий агент не смог накатить (планшет был в другой сети).
  **Урок:** перед выводом «фикс не работает» — сверять `versionName` на устройстве с version.json.
- ✅ **plans/09 S1 (bug 34, КРИТ) — СДЕЛАНО и ПРОВЕРЕНО на реальном RTMP.** Корень: no-arg
  `StreamBase.stopStream()` делегирует в ПУСТОЙ `MultiStream.rtpStopStream()` → `RtmpClient.disconnect()`
  не звался → сокеты живы, `isStreaming=true` → 2-й Go Live мёртв (`shouldStartEncoder=false`, `connect()`
  no-op). Всё сверено байткодом RootEncoder 2.4.7. **Фикс** (`RtmpStreamer.disconnectAllOutputs`): нужны
  ОБА шага — per-index `stopStream(RTMP,i)` по `activeRtmpOutputs` (единственный путь к disconnect) +
  затем no-arg (гасит энкодер: per-index его не трогает, т.к. `allStopped` считается ДО disconnect).
  `onConnectionFailed` теперь идёт этим же корректным путём. **Приёмка:** полигон MediaMTX,
  start→stop→start×3 — все 3 `connected ✓`, сервер 3× `is publishing`, приложение живо. Коммит 0.6(17).
- ✅ **Харнес-CMD `go-live-rtmp <url1,url2>`** (MainActivity) — старт НАСТОЯЩЕГО RTMP-мультистрима на
  заданные URL (для автономной приёмки на полигоне; `go-live` в харнесе = запись в MP4, RTMP-путь не
  трогает). Каждый url режется на базу+ключ по последнему `/`.
- ✅ **Инструмент `tools/rtmp-server.mjs` починен** (Node 23: `openSync` fd вместо `createWriteStream`
  в stdio) — полигон поднимается: `node tools/rtmp-server.mjs start` → `rtmp://<мак>:1935/live/test`.
  Сервер запускается с cwd=tools/bin, чтобы его авто-сертификаты (`auto.crt/auto.key`, самоподписанный
  TLS для RTMPS/WebRTC — НАМИ НЕ используются) не мусорили в корне. Оба gitignored. Коммит 0.6(18).
- ✅ **ХВОСТ РАЗОБРАН (дневной цикл 2026-07-12, build 19, полигон).** Краш после долгого эфира НЕ
  воспроизвёлся за 2 долгих прогона (~2 мин каждый). Что реально случилось (run 2, ~85с эфира): битрейт
  → 0, видео+аудио RTMP-пакеты встали ОДНОВРЕМЕННО (sender завис на `write()`), превью держало ~28 fps
  (GL/энкодер живы) → сервер отвалил по read-таймауту → `Broken pipe`. Диагноз: **СЕТЕВОЙ БЛИП** (WiFi
  планшет↔мак подвис на 5+ Мбит/с). На build 19 фикс S1 корректно восстановил превью — **краша нет**.
  Прошлый «краш» на build 16 = тот же блип в СТАРОМ сломанном пути стопа. Остаток (эфир завершается без
  авто-восстановления) = мотивация **S4 (реконнект)**, теперь подтверждённая живьём. Форензика: bugs/34,
  урок EXP-0012. ✅ Заодно перепроверен S1 на build 19: стоп→рестарт → `connected ✓`, полигон publishing.
- 💡 **Ликбез Кринику:** MediaMTX = зародыш Self-Hosted ReStream Server из **idea 38** (принять 1 поток
  → раздать на N платформ). Тестовый инструмент оказался proof-of-concept продуктовой идеи.



## 🔍 День 2026-07-12 (дом родителей, Titan 1 @ 192.168.1.3, Piko+ воткнута) — БОЛЬШАЯ РЕВИЗИЯ

- ✅ **KAIF 1.2 → 1.4 «Savvied»** (по просьбе Криника, /kaif-update): + `EXPERIENCE.md` (журнал
  уроков агента, засеян 11 реальными уроками) + навык `/experience`, контекст-роутер в AGENT_GUIDE,
  принцип «Учись один раз» в PHILOSOPHY, вшивки в чеклист/лупы/resume/refresh-context/BUG_FIXING.
- ✅ **Ревизия кода 4 аудиторами** (streaming · usb/capture · app/core · data/tools; спорное
  поведение библиотек сверялось по байткоду). Полный отчёт: `researches/code_audit_2026-07-12.md`.
  Главное:
  - 🔴 **bug 34 (КРИТИЧЕСКИЙ)** — мультистрим сломан в бою: после Stop второй Go Live мёртв до
    перезапуска приложения (`MultiStream.rtpStopStream()` в RootEncoder ПУСТОЙ — disconnect не
    зовётся); падение одной платформы гасит ВСЕ выходы; реконнекта нет. **plans/07 S5 (живые ключи)
    НЕ запускать до фикса.** План: **plans/09**.
  - 🔴 **bug 36 (КРИТИЧЕСКИЙ для стримера)** — эфир умирает при выключении экрана/сворачивании:
    foreground service отсутствует (разрешения в манифесте мёртвые), keep-screen-on/wake lock нет
    вообще. План: **plans/10** (S1 keep-screen-on = час работы).
  - 🔴 **bug 35 (высокий)** — мост USB→UI на LaunchedEffect: детач активной камеры теряется
    (фантомные источники копятся), startMonitoring не идемпотентен (дубли событий — вклад в bug 33),
    двойной openCamera без close (нативные утечки). План: **plans/11**.
  - 🔴 **bug 37 (высокий)** — данные юзера: destructive-миграция Room (бамп версии сотрёт профили),
    release подписан debug-ключом, stream-ключи в логах открытым текстом, versionCode переполнится
    через ~87 коммитов. План: **plans/12**.
  - 🔴 **bug 38** — SET_VIRTUAL_CAM/SET_ORIENTATION экспортированы в release (любое приложение может
    уронить камеру в эфире); **bug 39** — CMD-протокол харнеса: `select-source builtin <id>` сломан,
    `gesture-pinch in` делает OUT. Оба — дешёвые фиксы, кандидаты в автономный пул.
  - ✅ Перепроверено, дефектов НЕТ: порядок prepareVideo (bug 02), setCameraOrientation(0), teardown
    ресиверов, bug 27/31-фиксы держатся.
- 🩺 **bug 33**: root cause УТОЧНЁН байткодом — USBMonitor сам чекает hasPermission; диалог на каждом
  replug = грант не персистит (нужна галка «Открывать по умолчанию») + гонка автогранта ATTACHED.
  Скорректированный план в тикете. Билд 0.6(12) с диагностикой НАКАЧЕН на планшет — ⏳ нужен живой
  hot-plug Криника (лог `hasPermission=`).
- ✅ **interview_009 ОТВЕЧЕН Криником (все A)** — решения зафиксированы:
  порядок работ = plans/10 S1 → plans/09 → plans/10 FGS → plans/08 UVC; язык UI = EN-дефолт +
  values-ru (план: plans/13); release-keystore сгенерирован (`~/keystores/krinikcam.keystore`,
  пароль в gitignored keystore.properties) — **ДЗ Кринику: homeworks/06 (спрятать ключ+пароль)**;
  хуки KAIF не включаем; **idea 37 ОДОБРЕНА** (после plans/09).

_Пред. срез: 2026-07-07 (вечер, пауза) · 0.6 (11)_

## 🏢 День 2026-07-07 (офис, интерактив с Криником, 2K USB-вебка воткнута)
- ✅ **bug 19 DONE (FIXED)** — встроенные камеры устройства (селфи/тыл) выходили РАСТЯНУТЫМИ и
  ПОВЁРНУТЫМИ на бок. Устранено **и то, и другое** (orientation-aware композитор): опенер шлёт
  `SENSOR_ORIENTATION`+`isFront` по цепочке `onOrientation` (opener→VM→repo→streamer→
  `CompositorVideoSource.setCameraOrientation`); композитор выпрямляет кадр поворотом OES-texMatrix +
  зеркалит фронталку; аспект сообщается нативный. Диагноз коэффициента: **1.67 = (16:9÷4:3)²** (рассинхрон
  оси растяга и пилларбокс-компенсации из-за неучтённого поворота). Приёмка **объективным замером
  OpenCV** (`tools/measure_stretch.py`): растяг 1.67@90° → 1.03@диаг (круг), обе камеры вертикальные,
  текст читается.
- ✅ **bug 25 DONE** — 2K USB-камера: чёрный экран устранён, живое видео. Потолок 640×360 подтверждён
  на USB-протоколе (`UVC_SET_CUR err=-9` на 1080) — физика камеры. Остаток «не молчать при провале
  негоциации» → idea 20.
- ✅ **bug 31 DONE (FIXED)** — краш HWUI «no surface» при свитче UVC↔virtual. Пересоздание
  SurfaceTexture слоя при смене ТИПА продюсера (`recreateCameraSurface` + `lastOpenedKind`). Verified
  стресс-циклами (uvc↔virtual 12× чисто).
- ✅ **idea 34 DONE** — панель слоёв: bottom-sheet → **вертикальное меню** (растёт вверх от FAB,
  полупрозрачные компактные пункты, тап-раскрытие с 👁/↑↓/⚙/🗑, модалка настроек per-type, 2-я строка =
  источник мягким розовым). interview_008 отвечён. Verified.
- ✅ **Инструмент + правило KAIF** — `tools/measure_stretch.py` (объективный замер линейного искажения
  кадра, OpenCV) + правило в AGENT_GUIDE: **линейные искажения мерить инструментом, не на глаз**.
- ✅ **User Manual** переписан нейтральным энциклопедическим языком (все секции), + добавлена цепочка
  `opener→VM→repo→streamer→compositor` в раздел «под капотом». Конвенция стиля в AGENT_GUIDE.
- ⏳ **idea 35 (layers_snap)** — п.1/п.2/п.3 сделаны (адаптивная рамка по аспекту слоя, снап края
  заподлицо, лёгкие направляющие). Снап слоёв друг-к-другу — сахар на потом.

## 🌆 Вечер 2026-07-07 (дома, Piko+, дейлуп автономный)
- ✅ **bug 27 РЕГРЕСС исправлен** — EGL_BAD_CONTEXT-краш при ФИЗИЧЕСКОМ повороте устройства (fullSensor):
  `onSurfaceTextureSizeChanged` больше не зовёт `startPreview` (teardown поверхности = гонка HWUI) → no-op.
  ⏳ ждёт живой сверки Криника поворотом планшета (ADB даёт мягкий путь, не воспроизводит).
- ✅ **МУЛЬТИСТРИМ (plans/07 S1-S4) — движок + обвязка готовы.** RootEncoder 2.4.7 нативно умеет
  `MultiStream` (1 энкодер→N RTMP). Стриминг переведён на MultiStream (S1); `startStream(List)` стартует
  каждую платформу на своём выходе (S3); `startStream()` стримит на ВСЕ включённые (isEnabled) профили
  (S2/S4 — мультивыбор уже был в StreamPlatformsOverlay: Switch на профиль). Одно-выходной путь цел
  (smoke PASS). Осталось: **S5 живая сверка ключами → ДЗ homeworks/05**.
- 💡 **idea 36 + plans/08 — UVC-контролы источника** (ОДОБРЕНО Криником, MVP-приоритет): управление
  параметрами камеры (яркость/gain/экспозиция/ББ…) динамическим меню + кнопка «Настройки источника» в
  слое. AUSBC отдаёт полный get/set-набор. НЕ реализовано — план S1-S5 в plans/08. (Piko+ лагает,
  настроить нельзя — это и решит.)
- 🐛 **bug 33 (высокий) — навязчивый USB-диалог разрешения на КАЖДОМ hot-plug камеры.** Тикет заведён,
  добавлена **диагностика** (лог `hasPermission` на attach). ⏳ ждёт живого hot-plug Криника: лог покажет,
  персистит ли грант → прицельный фикс (plans/04 §29.1 S1).
- ❓ **на ревью Криника:** UI мультивыбора платформ — чекбоксы «стримить сюда» уже есть (Switch); ок?
  homeworks/05 — stream-ключи ИЛИ разрешить локальный RTMP-полигон для автономной проверки мультистрима.

## ▶️ Порядок работ (interview_009 Q1=A, зафиксирован Криником 2026-07-12)
1. ✅ **plans/10 S1** — keep-screen-on во время эфира — ГОТОВО (0.6(16)).
2. ✅ **plans/09** — стабилизация мультистрима (bug 34): **S1-S4 ГОТОВЫ+ПРОВЕРЕНЫ живьём на полигоне
   (v0.7)**. Хвост-краш разобран (сетевой блип). Остаток: **S5 пункт 2** (два живых выхода растут
   разом) → **DONE bug 34** → S5 из plans/07 (живые ключи Криника, homeworks/05). ← СЛЕДУЮЩАЯ (короткая).
3. **plans/10 S2-S4** — foreground service + wake lock (bug 36).
4. **plans/08** — UVC-контролы источника (idea 36, интерактив с Криником).
5. **Автономный пул** (циклы): bug 38, bug 39, plans/11, plans/12 (S2 — gradle-подхват keystore),
   plans/13 (локализация EN/RU), idea 37 (после п.2).
6. **Живые сверки Криника**: ✅ поворот (bug 40/27 закрыт); hot-plug — лог `hasPermission=` (bug 33);
   ДЗ homeworks/06 (спрятать keystore). Хвосты: idea 20, plans/05 S7, idea 35.

### Как продолжить plans/09 в новой сессии (пустой контекст)
- Код мультистрима: `feature/streaming/.../rtmp/RtmpStreamer.kt` (connectChecker ~197, startStream ~518,
  stopStream/disconnectAllOutputs ~590). Библ-факты сверены байткодом (`javap` из ~/.gradle кеша 2.4.7).
- Полигон: `node tools/rtmp-server.mjs start` → URL `rtmp://<мак-ip>:1935/live/test`. Прогон:
  `node tools/ui.mjs cmd go-live-rtmp <url1>[,<url2>]` → `... cmd stop`. Кривой выход для теста изоляции:
  `rtmp://127.0.0.1:9/dead`. Лог сервера: `tools/bin/mediamtx.log`. Логи app: `adb logcat | grep RtmpStreamer`.
- Мак-IP: `ipconfig getifaddr en0` (сейчас был 192.168.2.112). Планшет: `adb connect 192.168.2.109:5555`.

---

_Пред. обновление: 2026-07-06 (ночной цикл, ~04:51) · 0.5 (32)_

## 🏢 День 2026-07-06 (офис, интерактив) — bug 29 + порядок работ

Устройство: **Titan 1 @ 192.168.50.187**. Разобрались с камерами: приложение показывало ВСТРОЕННУЮ
камеру (SENSOR_ORIENTATION=270), потому что USB 2K-вебка валит негоциацию (bug 25) → тихий fallback.

- ✅ **bug 29.3 — камера НЕ замирает на повороте.** `CompositorVideoSource.resizeCanvasKeepingCamera`:
  поворот холста ресайзит холст композитора БЕЗ рестарта → камера-продюсер не переоткрывается, поток
  непрерывен. Проверено визуально (портрет/пейзаж). Требование Криника «камера не знает о повороте».
- 🟡 **bug 29.2 — искажение = встроенная камера** (ориентация сенсора). Фикс = отвязать камеру от
  холста (plans/04 S1/S2). — ЗАДАЧА 1.
- ✅ **bug 30** — фантомная Emeet в `dumpsys usb` (системный кэш, приложение не затрагивает).

### ▶️ Порядок работ (согласовано с Криником)
1. ✅ **Raw-фикс камеры (камера↔холст рефактор)** — ГОТОВО (2026-07-06): двухпроходный FBO-рендер.
   Камера в фикс. нативном 16:9-буфере/FBO, поворот холста = финальный блит (матрица тексов). Камера
   аспект-корректна в пейзаже И портрете (нет растяга, 29.2) и НЕ переоткрывается на повороте (29.3).
   Проверено записью+скринами на всех углах 0/90/180/270. plans/04.
2. **USB-вебки (bug 25)** ← **ТЕКУЩАЯ.** 2K валит негоциацию → приложение молча падает на встроенную.
   Сделать, чтобы вебка работала как источник (выбор поддерживаемого размера/MJPEG) И не было тихого
   fallback. bugs/25.
3. **bug 29.1** — стопка системных USB-диалогов: дебаунс сделан (S2), device_filter проверен (S3);
   остаток `hasPermission` для hot-plug при открытом приложении (S1). plans/04 §Фикс 29.1.

Планы: `plans/04_bug29_camera_pipeline.md` (задачи 1 и 3), `bugs/25_*` (задача 2), жесты слоёв —
`plans/03` + `interviews/interview_007` (после bug 29).

### Слой «Устройство захвата видео» (idea 20, plans/05) — В РАБОТЕ (2026-07-06 вечер, дома @192.168.1.3)
**Архитектурное решение принято (plans/05 §0):** ОДИН тип слоя «Устройство захвата видео» для ВСЕХ
камер; конкретное устройство (виртуалка/UVC/любая встроенная ОС-камера) — полиморфное свойство
`CaptureSource`. НЕ три отдельных типа. Обоснование: тип слоя = поведение рендера, источник = способ
добычи кадров (уже вынесен в `CameraOpener`). Мультиинстанс (потолок ~10). Заглушка/фейд — состояние
слоя, не отдельный тип. Будущие Браузер/Видео/Текст/Картинка — отдельные типы.

Сделано и запушено: **S1** модель (`Layer.VideoCapture` + `CaptureSource` Builtin/Uvc/Virtual/None,
`Scene.setSource`); **S2** полный реестр встроенных камер ОС (все `cameraIdList`, ширик/основная/
телефото по фокусному) + `DeviceManager.availableSources`; **S5** `select-source virtual|builtin <id>`
доп. к front/rear/uvc/none; **S3-фикс** явный выбор источника — король (`userSelected` подавляет
авто-приоритет; чинит дефект, когда connect-спам 2K-вебки откатывал выбор на UVC).
**Верифицировано live** (com.kriniks.kcam.**debug**): none→заглушка, virtual→тест-паттерн, uvc→вебка.
⚠️ На планшете ДВА варианта (`com.kriniks.kcam` старый + `.debug`) — ui.mjs/CMD работают с `.debug`.
ОСТАЛОСЬ: **S4** UI выбора источника в панели «Слои», **S6** Слои→FAB внизу-слева, **S7** фейд-заглушка
как состояние слоя (bug 17), Фаза B (мультиинстанс в композиторе).

### User Manual (idea 32, plans/06) — КАРКАС (2026-07-06)
Встроенное руководство в Settings (новичок + «под капотом»). Каркас содержания и арх.тезисы —
`plans/06`. Конвенция в AGENT_GUIDE (канон + чеклист): развил/переделал фичу → веди раздел синхронно.

---

## ☀️ Утро 2026-07-06 (интерактив с Криником) — крашы на живом устройстве

Ночью Phase 3 верифицировался, пока планшет НЕ спал (после ~5 утра он был выключен → мои поздние
скрины чёрные). Утром на ЖИВОМ устройстве вылезли 2 краша — оба ПОЧИНЕНЫ:

- ✅ **bug 27 — EGL_BAD_CONTEXT на повороте портрет↔пейзаж.** Смена размера холста пересобирала
  поверхность превью в гонке с системным HWUI. Фикс: `resizeCanvasInPreview` меняет размер холста, НЕ
  трогая поверхность превью. Проверено: поворот + стресс-цикл — крашей нет.
- ✅ **bug 28 — нативный SIGABRT AUSBC на старте (закрытие 2K-камеры).** Гипотеза Криника подтвердилась:
  приложение стартовало на залипшей в DevSettings виртуалке → свитч virtual→UVC + провал негоциации
  2K → нативный краш при закрытии камеры. Фикс: CMD `virtual-camera off` теперь ПЕРСИСТИТ → старт
  сразу на реальной камере, свитча нет, краш исчез.
- **Искажение видео** — оказалось ТРАНЗИЕНТНЫМ (2K-камера на грубом старте 640×480→640×360 на миг тянет
  кадр), устаканивается в чистый кадр (Криник подтвердил). Это хвост bug 25 (кривая негоциация 2K).

**2K USB-камера — проблемный модуль:** негоциация падает 640×480→640×360 (низкое разрешение),
транзиентный растяг/чёрный на старте, нативный краш AUSBC на закрытии (bug 25/28). Рекомендация:
для чистого теста — Emeet Piko+ (давала 1080p ровно); для этого модуля — фикс негоциации (bug 25).

**Открыто для Криника:** `interviews/interview_007_layer_gestures.md` (развилки жестов слоёв, Q1–Q6).

---

## 🌙 Итоги ночного цикла 2026-07-06 (для утра Криника)

**Phase 3 закрыта в ядре и запушена.** Композитор — единственный видеопайплайн; модель поворота
из interview_006 реализована и верифицирована на живом планшете (2K USB воткнута).

- ✅ **Композитор = дефолт**, legacy снесён (8 файлов). Поворот = свойство ХОЛСТА над сценой
  (0/90/180/270, вся композиция целиком) + поворот СОДЕРЖИМОГО слоя (как в Photoshop). Физкамеры
  отдают сырой поток. Верификация записью+ffprobe: вся матрица 0/90/180/270 + поворот слоя + PiP +
  фото + превью переживает поворот устройства — всё PASS (plans/02 §5-6).
- ✅ **Оптимизация поворота:** 0↔180 и 90↔270 теперь мгновенные без переоткрытия камеры (matrix-only).
- ✅ **`tools/smoke.mjs`** — смоук-тест пайплайна одной кнопкой (plans/01 B1).
- 🟡 **`tools/rtmp-server.mjs`** — локальный RTMP-полигон (MediaMTX). Код готов, но ПЕРВЫЙ ЗАПУСК ждёт
  тебя: `node tools/rtmp-server.mjs start` (разово одобрить скачивание стороннего бинаря).
- 🐛 **bug 25** (noname «2K USB Camera» чёрный/640×360): root cause — YUV-превью камеры max 640×360
  (2K только в MJPEG); AUSBC сам падает на фолбэк. Фикс (MJPEG) отложен (риск native).

**Что нужно от тебя утром:**
1. Глянуть Phase 3 на СВОИХ камерах (Emeet + 2K) — портрет/пейзаж/поворот слоя. Если ок — я сниму
   DONE-теги с bug 20/22/23/24 (держу до твоей сверки).
2. Разок запустить `node tools/rtmp-server.mjs start` (одобрить бинарь) → откроет автономный тест
   стрима.

---


---

## ▶️ С чего продолжить следующую сессию (утро 2026-07-18, после ночного цикла)

**УТРЕННИЕ ДЗ Криника (по убыванию срочности):**
1. ✅ **ДЗ-06 — бэкап ключа подписи** — ГОТОВО (2026-07-18): ключ+пароль в личном Google Drive, шеринг
   убран. `homeworks/06_DONE_keystore_backup.md`.
2. 🔌 **ДЗ-07 — приёмка USB-диалога** (`homeworks/07`, ~3 мин): мышь → тишина; вебка → диалог 1 раз
   С ГАЛОЧКОЙ «всегда»; передёрнуть → тишина. ✅ → bug 33 DONE. Заодно: круглый предмет перед вебкой →
   я сам сниму кадр и прогоню `measure_stretch` (закроет bug 29 и plans/04).
3. 📺 **ДЗ-05 — живые ключи** (`homeworks/05`): мультистрим на реальные YouTube/Twitch — единственное
   не пройденное испытание мультистрима (полигон пройден целиком).

**Дневной беклог агента (нужна вебка/руки Криника рядом):**
- **bug 35 + plans/11** — рефактор USB-моста (фантомы, дедуп, идемпотентность) + живой hot-plug 5×.
- **bugs 16/17/23** — проверка на живой вебке (удаляемость камеры-слоя, заглушка, вирт→реальная).
- **plans/05/07/08 хвосты** — UVC-контролы (plans/08, нужна вебка), idea 16 (мультиплатформенные
  улучшения — сверить пункты), idea 20 (сверить: выбор источника реализован в свойствах слоя — что
  осталось из идеи), idea 17 (запись как ЮЗЕР-фича — UX-кнопка).
- **plans/02 хвост** — портрет↔пейзаж без переоткрытия камеры (кандидаты A/B в плане; GL-работа).

**❓ На ревью Криника:** idea 38 — ресёрч готов (`researches/restream_server.md`), 4 развилки в §5
(ядро MediaMTX-vs-Restreamer, где правда о платформах, server/ в репо?, RTMP-vs-SRT в MVP) ·
idea 33 — мини-вопрос UX кропа (жест-ручки или слайдеры?) · idea 05 — SEO-драфт ждёт ревью бренда.
**Автономный пул (без камеры):** idea 33 МЕХАНИКА кропа (после UX-ответа) · idea 33
(кроп слоя: МЕХАНИКА (crop-инсеты в композиторе + CMD set-crop) автономна, UI-жест — после
мини-интервью «ручки или слайдеры?») · idea 05 (SEO — драфт готов, ждёт ревью бренда Криником).
✅ Ночью закрыты из пула: idea 37 (адаптив+телеметрия), idea 28 (AVD-эмулятор: tools/avd.mjs,
смоук на эмуляторе PASS — агент больше не блокируется отсутствием планшета).

**Харнес-шпаргалка:** `ui.mjs cmd virtual-camera on; stream-to-file on; go-live; stop` → ffprobe;
реальный RTMP: `rtmp-server.mjs start` + `go-live-rtmp <url1,url2>`; смоук: `smoke.mjs --skip-build`.

---
