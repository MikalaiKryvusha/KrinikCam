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
- `README.md` (двуязычный EN/RU), `plans/project_map.md`, `plans/phase_1_mvp.md`
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
    Менять не нужно. Доказательства в `plans/ideas/08_*`. На будущее: мультистрим — от одного энкодера.
0b. ✅ **Idea 09 — виртуальная камера-заглушка** — СДЕЛАНО 2026-06-29. Тумблер «Виртуальная камера»
    в dev-меню → `VirtualVideoSource` рисует 16:9 тест-паттерн (круг/сетка/TOP + движущаяся полоса +
    счётчик) в GL вместо физ. камеры. Проверено БЕЗ камеры на устройстве. Снимает блокер «нет камеры».
    `VirtualFrameRenderer/VirtualVideoSource`, `VideoSource.Virtual`, `DeviceManager.setVirtualCamera`.
0c. ✅ **Idea 10 — виртуальная стрим-платформа в файл** — СДЕЛАНО 2026-06-29. Тумблер «Стрим в файл»
    в dev-меню → Go Live пишет энкодер в MP4 (`startRecordToFile`) вместо RTMP. Проверено: записал,
    `ffprobe` 1920×1080, кадр → круг круглый. **Связка 09+10 = автономный дев-харнесс** (вирт.камера →
    запись → анализ кадров ffmpeg) — позволит детерминированно добить Bug 10 (портрет) БЕЗ YouTube.

### ✅ В пул (можно делать автономно, камера не нужна)

1. ✅ **Idea 07 — Меню «Для разработчиков»** (`plans/ideas/07_developer_menu.md`) — СДЕЛАНО 2026-06-29.
   Экран Developer (лонг-тап по «KrinikCam» в Settings), тумблер «Вращение по ADB» + [i], работает в
   любой сборке (DEBUG-гейт убран). Проверено на устройстве (лонг-тап → меню; ON → orient ворочает;
   OFF → сенсор). Добавлена команда `ui.mjs longpress`. Сюда выносим весь будущий dev-функционал.
2. ✅ **Idea 01 — Импорт/экспорт конфига профилей** — СДЕЛАНО 2026-06-29. Кнопки Export/Import в
   Platforms overlay (SAF, без рантайм-пермиссий), JSON `{app,version,profiles[]}`, толерантный парс.
   Проверено на устройстве (export→файл→import round-trip). `ProfilesBackup.kt`, VM-методы, overlay.
3. 🔬 **Idea 05 — SEO README + таблица конкурентов** — ЧЕРНОВИК готов 2026-06-29
   (`plans/research/readme_seo_draft.md`: SEO-ресёрч, таблица, позиционирование, GitHub Topics).
   Публикация в README — НА РЕВЮ Криника (публичный бренд + имена конкурентов). Сырьё:
   `plans/research/competitors/`.
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

**Phase 2 MVP РАБОТАЕТ ✅ — Go Live стримит в YouTube корректно (подтверждено Криником 2026-06-28).**

Превью ✅ · RTMP-стрим ✅ (~5 Mbps стабильно) · ориентация ✅ · превью после стрима ✅ · без крашей ✅
· **standby-кадр при отключении камеры ✅** (Phase 2 P2, подтверждено на устройстве 2026-06-28)

**Сделано в сессии 2026-06-29 — ПОСЛЕДНЯЯ (текущая):**
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
  финализировать файл (без подмены, без standby в записи). Детали: `plans/ideas/17_*`.
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
- ✅ **Idea 15** — тег `DONE` в именах закрытых файлов `bugs/`/`plans/ideas/` + правило в AGENT_GUIDE.
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
  - Дизайн/решения/YouTube-research фичи → `plans/ideas/06_video_rotation.md`.
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
   виртуальные стрим-каналы для сравнения. Рекомендуется ИНТЕРВЬЮ перед кодом. `plans/ideas/16_*`.
3. 📅 **Idea 17 — запись видео/фото в файл** (4К-запись проверена ✅). При разрыве камеры во время
   записи — финализировать файл (НЕ подменять источник). `plans/ideas/17_*`.
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

Полный отчёт: `plans/homework_before_phase2.md`

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
