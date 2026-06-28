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

**С чего продолжить в следующей сессии:**
1. Phase 2 P2: "Please stand by" кадр в RTMP-поток при отключении камеры (GL-фильтр, `sendStandbyFrame`)
2. Графика: app icon (`ic_launcher.svg` → mipmap-*), standby bitmap, notification icon
3. Мелкие улучшения UX из фидбэка Криника:
   - FAB закрытие тапом снаружи
   - USB permission "запомнить" (`PendingIntent` с флагом)
   - Dropdown платформ — контраст цветов
   - Задержка перед standby (5 сек буфер + fade)

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
- Кнопка "повторно запросить разрешения" в Settings (если запрещены в ОС)
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
