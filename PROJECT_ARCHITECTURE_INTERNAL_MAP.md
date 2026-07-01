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
`app/streaming/CameraLayerOpeners.kt`, `UvcVideoSource.kt`, `DeviceCamera.kt`).

---

## Ключевые абстракции

| Абстракция | Модуль | Роль |
|------------|--------|------|
| `UsbDeviceRepository(-Impl)` | `:feature:usb` | обёртка AndroidUSBCamera: hot-plug, permission, открытие камеры → `UsbEvent` |
| `DeviceManager` | `:feature:capture` | реестр видео/аудио-источников, приоритет UVC → задняя → фронт → None |
| `CodecScanner` | `:feature:codec` | скан MediaCodecList → `DeviceProfile` (HW/SW кодеки устройства) |
| `RtmpStreamer` | `:feature:streaming` | RootEncoder `RtmpStream` + кастомные источники; RTMP + запись в файл |
| `VideoSource`-семейство | `:feature:streaming/rtmp` | `UvcVideoSource` (в `:app`), `VirtualVideoSource` (тест-паттерн), `BlackVideoSource`, `StandbyVideoSource`/`FreezeStandby` (стендбай-кадр), `RotatableSource` (поворот) |
| `Scene` / `Layer` / `SceneCompositor` | `:feature:streaming/scene` | GL-композитор «мобильный OBS»: чёрная база + камера/оверлеи как равноправные слои с z-order и трансформой (Idea 21/25) |
| `CompositorVideoSource` + `Egl`/`GlQuadRenderer` | `:feature:streaming/gl` | GL-инфраструктура: рендер сцены в текстуру энкодера/превью |
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
            → RtmpStreamer: источник (UvcVideoSource / SceneCompositor) → GL → encoder

User taps FAB → "Go Live" (или ui.mjs cmd go-live)
  → StreamViewModel.startStream()
    → StreamingRepository.startStream(activeProfile)
      → RtmpStreamer.startStream(profile)
        → RtmpStream.prepareVideo(w, h, BITRATE, fps, iFrame, rotation) ← битрейт 3-й, fps 4-й!
        → glInterface.setCameraOrientation(0)  ← после prepareVideo, иначе поворот+растяжение (Bug 02)
        → RtmpStream.startStream("rtmp://...")
          → ConnectChecker.onConnectionSuccess() → streamState = Live
```

### Слоистая сцена (композитор, Idea 21/25 — за dev-флагом `compositor on`)

```
Scene = чёрная база (BlackVideoSource-семантика) + список Layer (z-order, трансформа)
  Layer: камера (UVC/устройства через CameraLayerOpeners) | оверлей-картинка | (будущее: видео и др.)
  → SceneCompositor рендерит слои GL-квадами (GlQuadRenderer, Egl)
    → CompositorVideoSource отдаёт итоговую текстуру в RtmpStream (encoder + preview)
  Отрыв источника НЕ роняет стрим: слой камеры пропадает/замещается, база остаётся (Bug 13/20)
```

### Камера отвалилась во время стрима

```
USB device unplugged
  → UsbEvent.DeviceDetached
  → UsbViewModel → DeviceManager.notifyUvcDisconnected()
    → активный источник = PhoneCamera или None
      → стрим продолжается стендбай-кадром (Standby/FreezeStandbyVideoSource) / базой сцены
```

---

## Инварианты и правила модели

- **Только `RtmpStream` + кастомный VideoSource.** НЕ `RtmpCamera1` — тот открывает Camera1/2 API
  → конфликт с USB UVC → краш.
- **`prepareVideo`: битрейт — 3-й параметр, fps — 4-й.** Перепутать = пустой видеотрек (Bug 02).
- **После `prepareVideo` — `setCameraOrientation(0)`** для USB-камеры (она уже отдаёт landscape).
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
| «Камера = слой» GL-композитора | OBS-модель: z-order, PiP, живучесть при отрыве источника | Idea 21/25, `scene/` |
| Харнес: виртуалка + запись в файл | тестирование без живой камеры/стрима и без Криника | Idea 09/10/22, `ui.mjs` |
| Профили: Room + DataStore | реактивный CRUD платформ + простые key-value настройки | interview_002, `data/profiles` |
