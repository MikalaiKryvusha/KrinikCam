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

**Phase 2 в работе. БАГ 1 (RTMP краш) архитектурно исправлен. Тестируется на устройстве.**

**С чего продолжить в следующей сессии:**
1. Собрать и установить APK: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug`
2. Установить на Headwolf Titan1, подключить Emeet Piko+ 4K
3. Проверить: появляется ли превью камеры на экране (GL pipeline fix)
4. Если превью работает → тестировать "Go Live" кнопку
5. Если чёрный экран — смотреть logcat: ищи `scheduleVideoSourceRetryIfNeeded` и `GL ready after Xms`

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

**БАГ 2: Видео повёрнуто / растянуто** ✅ ИСПРАВЛЕН (портрет)
- `TextureView.setTransform(Matrix)` с letterbox AR-фиксом в `UvcPreviewView`
- Портрет: `baseDegrees=0f` → 1600×900 стрип, letterboxed, без дистortion ✅
- Ландшафт: `baseDegrees=-90f` → не тестировался (кнопка ротации для ручного фикса если нужно)

**БАГ 3: USB permission диалог каждый раз при переподключении**
- При каждом reconnect камеры — системный диалог "Разрешить доступ к USB?"
- Нужен флаг "не спрашивать снова" (`PendingIntent` с флагом)

**Мелкие улучшения (из фидбека Криника):**
- FAB не закрывается тапом снаружи
- Dropdown платформ плохой контраст (цвет похож на фон)
- Задержку перед standby при отключении камеры (5 сек буфер + плавный fade)
- Кнопка "повторно запросить разрешения" в Settings (если запрещены в ОС)
- Горячая кнопка поворота видео в real-time

---

## Что делать дальше

### Следующая сессия — приоритеты
1. **Провести интервью Phase 2** → `interviews/interview_003_phase2.md`
2. **Архитектура RTMP для USB** — перейти на `GenericStream` или frame push подход (БАГ 1)

### Phase 2 (не начато)
- **RTMP от USB камеры**: `GenericStream` + захват кадров из `SurfaceTexture`
- Одновременный стрим на несколько платформ
- Camera2 fallback (телефонная камера как источник)
- "Please stand by" frame в RTMP поток
- USB permission: флаг "запомнить" устройство
- Улучшение UI (см. баги выше)

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
