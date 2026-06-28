# KrinikCam — Текущий статус проекта

> Этот файл читается AI-агентом перед каждой задачей.
> Обновляй его при каждом значимом изменении состояния.
> Читай описание твоего рабочего фреймворка в AGENT_GUIDE.md

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

## Текущая позиция

**Phase 2 MVP РАБОТАЕТ ✅ — Go Live стримит в YouTube корректно (подтверждено Криником 2026-06-28).**

Превью ✅ · RTMP-стрим ✅ (~5 Mbps стабильно) · ориентация ✅ · превью после стрима ✅ · без крашей ✅
· **standby-кадр при отключении камеры ✅** (Phase 2 P2, подтверждено на устройстве 2026-06-28)

**Сделано в сессии 2026-06-28 (поздний вечер) — текущая:**
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
0. 🔧 **Bug 10 — портретный стрим 9:16 искажён (сжат/растянут).** ПРИОРИТЕТ, focused-сессия.
   Полная база знаний + анализ в `bugs/10_portrait_stream_squished.md`. Главная гипотеза: (а)
   encoder-вьюпорт RootEncoder НЕ держит аспект (`AspectRatioMode` есть только у preview-отрисовки,
   не у `drawScreenEncoder`), (б) наш `UvcVideoSource.create()` игнорирует переданные энкодером
   width/height/rotation и всегда отдаёт 1920×1080. С чего начать:
   - Декомпилировать `scratchpad/classes.jar` → `SizeCalculator.calculateViewPortEncoder`,
     `MainRender.drawScreenEncoder`.
   - Починить `UvcVideoSource.create()` (уважать размеры/поворот, возможно `setDefaultBufferSize`).
   - УТОЧНИТЬ у Криника: для 16:9-сенсора в портрете нужен геометрический поворот физ-повёрнутой
     камеры ИЛИ center-crop 9:16? (влияет на подход).
   - Проверять энкодер по скрину УСТРОЙСТВА в эфире (матрица=0), сверяя ФОРМУ предметов (круг≠овал).
   - Превью и ландшафтный стрим НЕ трогать — работают.
1. ⭐ **Таймаут источника + USB permission** — интервью #004 закрыто, готово к коду.
   План: `interviews/interview_004_source_timeout_and_usb_permission.md` + идея `plans/sourses_timeout.md`.
   Решения: заморозка последнего кадра 5000мс при микро-разрыве USB (вместо мгновенной заглушки);
   возврат камеры в пределах 5с → мгновенно живое видео; таймаут вышел → фейд 500мс в заглушку;
   работает И в стриме И в превью; USB permission через intent-filter + device_filter (любая UVC) —
   диалог один раз с «использовать по умолчанию», закрывает Bug 3; фейд заглушка→камера — позже.
2. Графика: app icon (`ic_launcher.svg` → mipmap-*), standby bitmap, notification icon
3. Мелкие улучшения UX из фидбэка Криника:
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
