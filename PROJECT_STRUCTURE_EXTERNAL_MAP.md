# KrinikCam — Карта проекта

> Всё где находится, зачем нужно и как связано.
> Обновляется после каждой Phase.

---

## Дерево файлов

```
KrinikCam/
│
├── 📋 plans/                         ← документация и планы
│   ├── goal.md                       — исходный vision проекта (read-only)
│   ├── context.md                    — описание существующего приложения-конкурента
│   ├── github.md                     — ссылка на GitHub репо
│   ├── master_plan.md                — генеральный план всего проекта
│   ├── project_map.md                — этот файл
│   ├── phase_0_foundation.md         — что было сделано в Phase 0
│   └── phase_1_mvp.md                — план и статус Phase 1
│
├── 🎤 interviews/                    ← решения принятые с Криником
│   ├── interview_001_vision_and_foundation.md   — Phase 0 решения
│   └── interview_002_phase1_usb_preview_youtube.md — Phase 1 решения
│
├── 🛠 tools/                         ← Node.js инструменты автоматизации
│   ├── build.mjs      — сборка APK (открывает браузер с прогресс-баром)
│   ├── build-ui.mjs   — HTTP сервер + SSE UI для build.mjs
│   ├── commit.mjs     — bump build → git commit → push
│   ├── release.mjs    — bump minor → release APK → GitHub Release
│   ├── version.mjs    — read/write/format version.json
│   ├── setup.mjs      — первичная настройка окружения
│   ├── readme-pdf.mjs — README.md → README.pdf
│   └── package.json   — npm скрипты и зависимости
│
├── 📱 app/                           ← :app — точка входа приложения
│   └── src/main/
│       ├── kotlin/com/kriniks/kcam/
│       │   ├── KrinikCamApp.kt       — @HiltAndroidApp, Timber.plant
│       │   ├── MainActivity.kt       — @AndroidEntryPoint, setContent
│       │   ├── NavGraph.kt           — Compose Navigation routes
│       │   └── ui/
│       │       ├── screens/
│       │       │   ├── MainScreen.kt      — fullscreen viewfinder + overlay layers
│       │       │   └── SettingsScreen.kt  — настройки + debug share
│       │       └── overlay/
│       │           ├── FloatingRadialMenu.kt  — FAB с радиальным меню (Sims 3 style)
│       │           └── StandbyPlaceholder.kt  — "Please stand by" заглушка
│       ├── AndroidManifest.xml       — permissions, FileProvider, MainActivity
│       └── res/
│           ├── drawable/             — ic_launcher_background/foreground
│           ├── mipmap-anydpi-v26/    — adaptive icons
│           ├── values/themes.xml     — Material3 NoActionBar theme
│           └── xml/file_provider_paths.xml — пути для share log intent
│
├── 🧩 core/
│   ├── common/                       ← :core:common
│   │   └── src/main/kotlin/.../core/common/
│   │       └── di/DispatchersModule.kt — @IoDispatcher, @MainDispatcher, @DefaultDispatcher
│   │
│   ├── ui/                           ← :core:ui — Design System
│   │   └── src/main/kotlin/.../core/ui/theme/
│   │       ├── Color.kt              — AcidPink=#FF1A8C, DarkBackground, StreamLive и др.
│   │       ├── Type.kt               — KrinikCamTypography
│   │       └── Theme.kt              — KrinikCamTheme(darkTheme, dynamicColor)
│   │
│   └── logging/                      ← :core:logging — файловый логгер
│       └── src/main/kotlin/.../core/logging/
│           ├── KLog.kt               — единый API: KLog.d/i/w/e(tag, msg)
│           ├── FileLogger.kt         — пишет в /logs/kcam_YYYY-MM-DD.log, ротация 7 дней
│           └── di/LoggingModule.kt   — Hilt провайдер FileLogger
│
├── ⚡ feature/
│   ├── usb/                          ← :feature:usb — всё про USB камеры
│   │   └── src/main/kotlin/.../feature/usb/
│   │       ├── model/
│   │       │   ├── UsbEvent.kt       — sealed class событий USB (attach/detach/permission/preview)
│   │       │   └── UvcDevice.kt      — доменная модель UVC камеры + UvcVideoProfile
│   │       ├── domain/
│   │       │   └── UsbDeviceRepository.kt   — интерфейс управления USB
│   │       ├── data/
│   │       │   └── UsbDeviceRepositoryImpl.kt — реализация через AndroidUSBCamera
│   │       ├── ui/
│   │       │   ├── UvcPreviewView.kt  — Compose AndroidView обёртка TextureView
│   │       │   └── UsbViewModel.kt    — USB события → DeviceManager + UI state
│   │       └── di/UsbModule.kt        — Hilt: binds UsbDeviceRepositoryImpl
│   │
│   ├── capture/                      ← :feature:capture — DeviceManager (источники)
│   │   └── src/main/kotlin/.../feature/capture/
│   │       ├── model/
│   │       │   ├── VideoSource.kt    — sealed: UvcCamera | PhoneCamera | None
│   │       │   └── AudioSource.kt    — sealed: PhoneMic | UvcMic | None
│   │       ├── DeviceManager.kt      — реестр источников, приоритет UVC→задняя→фронт
│   │       └── di/CaptureModule.kt   — Hilt провайдер DeviceManager
│   │
│   ├── codec/                        ← :feature:codec — сканер MediaCodec
│   │   └── src/main/kotlin/.../feature/codec/
│   │       ├── model/CodecInfo.kt    — данные одного кодека (mime, HW, maxRes, FPS, bitrate)
│   │       ├── CodecScanner.kt       — MediaCodecList scan → List<CodecInfo> + DeviceProfile
│   │       └── di/CodecModule.kt     — Hilt провайдер CodecScanner
│   │
│   └── streaming/                    ← :feature:streaming — RTMP + управление платформами
│       └── src/main/kotlin/.../feature/streaming/
│           ├── model/
│           │   └── StreamState.kt    — Idle | Connecting | Live(bitrate) | Error | Stopping
│           ├── domain/
│           │   └── StreamingRepository.kt — бизнес-логика между VM и RtmpStreamer
│           ├── rtmp/
│           │   └── RtmpStreamer.kt   — RootEncoder RtmpCamera1 обёртка + standby frame
│           ├── ui/
│           │   ├── StreamViewModel.kt       — state: streamState, profiles, activeProfile
│           │   └── StreamPlatformsOverlay.kt — модальный список платформ с add/edit/delete
│           └── di/StreamingModule.kt
│
└── 💾 data/
    └── profiles/                     ← :data:profiles — Room DB + DataStore
        └── src/main/kotlin/.../data/profiles/
            ├── model/
            │   ├── StreamProfile.kt  — доменная модель платформы + StreamPlatform enum
            │   └── DeviceProfile.kt  — возможности устройства (HW кодеки, макс. разрешение)
            ├── db/
            │   ├── AppDatabase.kt    — Room, version=1, table: stream_profiles
            │   ├── StreamProfileDao.kt — CRUD + Flow<List> для реактивного UI
            │   └── StreamProfileEntity.kt — Room entity + toProfile()/toEntity()
            ├── datastore/
            │   └── ProfilesDataStore.kt — DataStore для DeviceProfile + active profile ID
            ├── repository/
            │   └── ProfilesRepository.kt — фасад над DAO + DataStore
            └── di/ProfilesModule.kt  — Hilt: Room database + DAO
```

---

## Внешние зависимости (ключевые)

| Библиотека | Где используется | Назначение |
|------------|-----------------|-----------|
| `jiangdongguo/AndroidUSBCamera` | `:feature:usb` | UVC камера: USBMonitor, CameraUVC, preview |
| `pedroSG94/RootEncoder` | `:feature:streaming` | RTMP клиент + H.264 кодирование |
| Hilt | все модули | DI фреймворк |
| Room | `:data:profiles` | SQLite ORM для StreamProfile |
| DataStore | `:data:profiles` | key-value: DeviceProfile, active ID |
| Navigation Compose | `:app` | экранная навигация |
| Timber | `:core:logging` | консольный логгер |

---

## Ключевые потоки данных

### USB Camera → Preview → Stream

```
USB device plugged
  → UsbDeviceRepositoryImpl (USBMonitor callback)
  → UsbEvent.DeviceAttached → auto-request permission
  → UsbEvent.PermissionGranted → openCamera()
  → UsbEvent.PreviewStarted
    → UsbViewModel → DeviceManager.notifyUvcConnected()
      → DeviceManager._activeVideoSource = UvcCamera
        → MainScreen observes activeSource
          → renders UvcPreviewView(camera)
            → TextureView created → onSurfaceReady(tv)
              → StreamViewModel.attachPreviewSurface(tv)
                → RtmpStreamer.attachTextureView(tv)

User taps FAB → "Go Live"
  → StreamViewModel.startStream()
    → StreamingRepository.startStream(activeProfile)
      → RtmpStreamer.startStream(profile)
        → RtmpCamera1.prepareVideo() + prepareAudio()
        → RtmpCamera1.startStream("rtmp://...")
          → ConnectChecker.onConnectionSuccessRtmp()
            → streamState = Live
```

### Camera disconnects during stream

```
USB device unplugged
  → UsbEvent.DeviceDetached
  → UsbViewModel → DeviceManager.notifyUvcDisconnected()
    → DeviceManager._activeVideoSource = PhoneCamera or None
      → MainScreen: if streaming → show StandbyPlaceholder
        → (Future): RtmpStreamer.sendStandbyFrame(standbyBitmap)
```

### Log sharing

```
User: Settings → "Share log file"
  → FileLogger.shareIntent()
    → FileProvider: external-files/logs/kcam_YYYY-MM-DD.log
      → Intent.ACTION_SEND → share sheet
```

---

## Инструменты (команды)

```bash
# Сборка
node tools/build.mjs              # debug + открывает браузер с прогресс-баром
node tools/build.mjs --release    # release APK
node tools/build.mjs --no-ui      # headless (для CI)

# Версионирование и деплой
node tools/commit.mjs "feat: ..." # bump build → commit → push
node tools/release.mjs            # bump minor → release APK → GitHub Release

# Документация
node tools/readme-pdf.mjs         # README.md → README.pdf
```

---

## Где что менять

| Хочу изменить | Где смотреть |
|--------------|-------------|
| Цвета / шрифты | `core/ui/src/.../theme/Color.kt`, `Type.kt` |
| Новый экран | Добавить в `app/NavGraph.kt`, создать в `app/ui/screens/` |
| Новая RTMP платформа | `data/profiles/model/StreamProfile.kt` → `StreamPlatform` enum |
| USB камера перестала работать | `feature/usb/data/UsbDeviceRepositoryImpl.kt` |
| Стриминг не подключается | `feature/streaming/rtmp/RtmpStreamer.kt` |
| Логи не пишутся | `core/logging/FileLogger.kt` |
| Новая версия зависимости | `gradle/libs.versions.toml` |
| CI pipeline | `.github/workflows/build.yml`, `release.yml` |
