# KrinikCam — Внутренняя карта архитектуры

> **Что это.** Внутренняя карта: ключевые абстракции приложения и то, как они взаимодействуют —
> модель, которую агент должен держать в голове, когда меняет код. Где какие файлы лежат — во внешней
> карте `PROJECT_STRUCTURE_EXTERNAL_MAP.md`.
> Живой справочник (KAIF) — ведёт агент. Тегом DONE не помечается.

---

## Модули и правило зависимостей

```
:app                    ← главный модуль, зависит от ВСЕХ feature/core/data
:core:common            ← базовые утилиты, DI-диспетчеры (нет внешних зависимостей)
:core:ui                ← Compose тема, цвета (AcidPink #FF1A8C), типографика
:core:logging           ← KLog + FileLogger (файл + share intent, ротация 7 дней)
:data:profiles          ← Room DB + DataStore (StreamProfile, DeviceProfile, backup)
:feature:usb            ← AndroidUSBCamera: hot-plug, permission, UvcPreviewView
:feature:capture        ← DeviceManager (реестр источников: UVC→phone→none)
:feature:codec          ← CodecScanner (MediaCodecList → DeviceProfile)
:feature:streaming      ← RootEncoder RTMP, VideoSource'ы, Scene-композитор, StreamViewModel
```

**ПРАВИЛО:** feature-модули НЕ зависят друг от друга. Только `:app` зависит от всех.
Мосты между feature — через `:app` (например, `LaunchedEffect` в `MainScreen.kt`,
`app/streaming/CameraLayerOpeners.kt`, `DeviceCamera.kt`).

---

## Ключевые абстракции

| Абстракция | Модуль | Роль |
|------------|--------|------|
| `UsbDeviceRepository(-Impl)` | `:feature:usb` | обёртка AndroidUSBCamera: hot-plug, permission, открытие камеры → `UsbEvent` |
| `DeviceManager` | `:feature:capture` | реестр видео/аудио-источников, приоритет UVC → задняя → фронт → None |
| `CodecScanner` | `:feature:codec` | скан MediaCodecList → `DeviceProfile` (HW/SW кодеки устройства) |
| `RtmpStreamer` | `:feature:streaming` | RootEncoder `RtmpStream` + кастомные источники; RTMP + запись в файл |
| `CompositorVideoSource` | `:feature:streaming/gl` | **ЕДИНСТВЕННЫЙ** базовый VideoSource (Phase 3): наш GL-композитор рисует ВСЮ сцену (чёрная база + слои) в кадр энкодера/превью; глобальный поворот холста 0/90/180/270 (interview_006). Мульти-источники: `CameraSlot` per первичный слой (OES/продюсер/снапшот/заглушка); `CompositorLayer.Camera.mirrorOf` — слой-ЗЕРКАЛО рисует слот первичного (шаринг фида, bug 58) |
| `Scene` / `Layer` / `LayerTransform` | `:feature:streaming/scene` | доменная модель сцены «мобильный OBS»: упорядоченные слои (z-order), трансформа слоя = позиция/масштаб/альфа/поворот содержимого; `Layer.VideoCapture.source` (`CaptureSource`: Uvc/Builtin/Virtual/None) — какой источник питает слой |
| `CameraOpener`-семейство | `:app/streaming` | `UvcCameraOpener` (AUSBC), `DeviceCameraOpener` (Camera2), `VirtualCameraOpener` (тест-паттерн) — открывают продюсера в SurfaceTexture слоя-камеры; отдают СЫРОЙ 16:9 поток без поворотов. `sourceKey` (физ-ключ устройства) — RtmpStreamer группирует слои: один источник = один open, остальные слои зеркалят (`openedLayers`/`cameraLayerMirrors`; закрывает только владелец, EXP-0019) |
| `Egl`/`GlQuadRenderer` | `:feature:streaming/gl` | GL-инфраструктура композитора (EGL-контекст, текстурированные квады с матрицами) |
| `StreamViewModel` | `:feature:streaming/ui` | состояние стрима (`StreamState`), профили, активная платформа |
| `ProfilesRepository` | `:data:profiles` | фасад Room DAO + DataStore (StreamProfile CRUD, DeviceProfile, backup/restore) |
| `DevSettings` + CMD-receiver | `:app` | скрытое dev-меню (лонг-тап в Settings→About) + DEBUG-only broadcast `com.kriniks.kcam.CMD` — толстый слой харнеса `ui.mjs cmd` |

---

## Ключевые потоки данных

### USB Camera → Preview → Stream

```
USB device plugged
  → UsbDeviceRepositoryImpl (USBMonitor callback)
  → UsbEvent.DeviceAttached → auto-request permission (ui.mjs allow — сам одобряет диалог)
  → UsbEvent.PermissionGranted → openCamera()
  → UsbEvent.PreviewStarted
    → UsbViewModel → DeviceManager.notifyUvcConnected()
      → DeviceManager._activeVideoSource = UvcCamera
        → MainScreen observes activeSource → рисует превью
          → StreamViewModel.attachPreviewSurface(...)
            → RtmpStreamer: CompositorVideoSource (сцена) → GL → encoder; камера = слой

User taps FAB → "Go Live" (или ui.mjs cmd go-live)
  → StreamViewModel.startStream()
    → StreamingRepository.startStream(activeProfile)
      → RtmpStreamer.startStream(profile)
        → RtmpStream.prepareVideo(w, h, BITRATE, fps, iFrame, rotation) ← битрейт 3-й, fps 4-й!
        → glInterface.setCameraOrientation(0)  ← после prepareVideo, иначе поворот+растяжение (Bug 02)
        → RtmpStream.startStream("rtmp://...")
          → ConnectChecker.onConnectionSuccess() → streamState = Live
```

### Слоистая сцена (Phase 3 — композитор ЕДИНСТВЕННЫЙ пайплайн, дефолт)

```
Scene (логический холст 16:9, о повороте НЕ знает) = список Layer (z-order снизу вверх)
  Layer: камера (продюсер через CameraOpener из :app) | оверлей-картинка | (будущее: видео и др.)
  LayerTransform: позиция/масштаб/альфа + ПОВОРОТ СОДЕРЖИМОГО слоя (0/90/180/270, «как в Photoshop»)
  → CompositorVideoSource рисует слои GL-квадами (GlQuadRenderer, Egl) в кадр энкодера/превью
    → ГЛОБАЛЬНЫЙ ПОВОРОТ ХОЛСТА (interview_006): НАД сценой, 0/90/180/270; на 90/270 холст
      энкодера свапается в 9:16 (1080×1920) — истинный портрет, вся композиция целиком на боку
  RootEncoder ничего не крутит: setCameraOrientation(0) ВСЕГДА (Bug 02 A)
```

### Камера отвалилась во время стрима/записи

```
USB device unplugged
  → UsbEvent.DeviceDetached → DeviceManager → MainScreen LaunchedEffect
    → streamViewModel.setCameraOpener(null) → слой-камеры пустеет
      → композитор ПРОДОЛЖАЕТ рисовать сцену (чёрная база + остальные слои)
        → RTMP жив; запись в файл НЕ рвётся (источник не подменяется — MediaMuxer цел)
```

---

## Инварианты и правила модели

- **Только `RtmpStream` + кастомный VideoSource.** НЕ `RtmpCamera1` — тот открывает Camera1/2 API
  → конфликт с USB UVC → краш.
- **`prepareVideo`: битрейт — 3-й параметр, fps — 4-й.** Перепутать = пустой видеотрек (Bug 02).
- **После `prepareVideo` — `setCameraOrientation(0)` ВСЕГДА**: все повороты (холст + слой) делает
  наш композитор (interview_006), библиотека не крутит ничего.
- **Физические камеры отдают СЫРОЙ поток**: никакой компенсации ориентации устройства в openers;
  «лежащую» камеру выпрямляет пользователь трансформой слоя (rotation).
- **Камера — разделяемый ресурс.** Перед тестом освобождай: `ui.mjs kill` (debug и release сборки
  дерутся за камеру).
- **Dev-функционал — только в скрытое Developer-меню** (лонг-тап), НЕ в `BuildConfig.DEBUG`-ветки UI;
  release == debug по фичам. CMD-receiver — единственное DEBUG-only исключение (харнес).
- **UI-тексты — через `strings.xml`** (`stringResource`), логи/теги — нет (Idea 14).
- **Профили платформ** живут в Room (`stream_profiles`), выбор активного — в DataStore.

---

## Ключевые решения, зашитые в архитектуру

| Решение | Почему | Где зафиксировано |
|---------|--------|-------------------|
| USB через AndroidUSBCamera 3.2.7 | готовый UVC-стек (hot-plug, permission, preview) | interview_002, `feature/usb` |
| RTMP через RootEncoder `RtmpStream` | единственный путь совместить UVC-источник и RTMP | Bug 02, `RtmpStreamer` |
| «Камера = слой» GL-композитора — ЕДИНСТВЕННЫЙ пайплайн | OBS-модель: z-order, PiP, живучесть при отрыве; legacy SurfaceFilterRender-путь снесён | Idea 21/25 + interview_006 (Phase 3), `scene/` + `gl/` |
| Поворот = свойство ХОЛСТА над сценой + поворот содержимого слоя | «как в компьютерном OBS» — сцена не знает о повороте | interview_006, `CompositorVideoSource` |
| Харнес: виртуалка + запись в файл | тестирование без живой камеры/стрима и без Криника | Idea 09/10/22, `ui.mjs` |
| Профили: Room + DataStore | реактивный CRUD платформ + простые key-value настройки | interview_002, `data/profiles` |
