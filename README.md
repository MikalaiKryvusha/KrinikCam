# KrinikCam

[![Build](https://github.com/MikalaiKryvusha/KrinikCam/actions/workflows/build.yml/badge.svg)](https://github.com/MikalaiKryvusha/KrinikCam/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF1A8C.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%2013%2B-3DDC84.svg)](https://developer.android.com)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.1.0-7F52FF.svg)](https://kotlinlang.org)
[![Version](https://img.shields.io/badge/Version-0.6-FF1A8C.svg)](https://github.com/MikalaiKryvusha/KrinikCam/releases)

**An open-source Android app for streamers and bloggers — a mobile OBS.**  
Plug in a USB webcam via OTG (or use the device's built-in cameras) → compose a scene from layers → go live on YouTube, Instagram, Twitch, or TikTok.

> **Status:** Active development · Phase 1 ✅ USB preview · Phase 2 ✅ RTMP confirmed on device (portrait + landscape) · **Phase 3 ✅ GL compositor "camera = layer" is the default pipeline** (multi-source scene, layer gestures, unified rotation model)

---

## Features

| Feature | Status |
|---------|--------|
| USB webcam preview (UVC, any brand) | ✅ Phase 1 |
| Fullscreen viewfinder (radial FAB menu) | ✅ Phase 1 |
| Stream profiles (Room DB + DataStore) | ✅ Phase 1 |
| Hardware codec scanner (H.264 / HEVC / AV1) | ✅ Phase 1 |
| File-based debug logger (shareable logs) | ✅ Phase 1 |
| RTMP stream to YouTube / Twitch / custom | ✅ Phase 2 |
| "Please stand by" frame on camera disconnect | ✅ Phase 2 |
| Re-grant camera / mic permissions from Settings | ✅ Phase 2 |
| Import / export stream profiles (JSON) | ✅ Phase 2 |
| USB permission — remember device (no re-ask) | ✅ Phase 2 |
| **GL compositor "camera = layer" (mobile OBS)** | ✅ Phase 3 default |
| Manual canvas rotation (0° / 90° / 180° / 270°) + per-layer content rotation | ✅ Phase 3 |
| Multi-source scene layers (camera + image overlays, z-order, visibility) | ✅ Phase 3 |
| Layer gestures — drag / pinch-zoom / two-finger rotate + magnetic snap | ✅ Phase 3 |
| Built-in device cameras as a source (Camera2, correct orientation & aspect) | ✅ Phase 3 |
| Vertical layer menu (per-layer settings dialog, source label) | ✅ Phase 3 |
| Built-in User Manual (Settings) | ✅ Phase 3 |
| Simultaneous multi-platform streaming | 📅 Phase 4 |
| Auto image regulation (exposure, white balance) | 📅 Phase 4 |
| Picture-in-Picture, GPU filters | 📅 Phase 4 |
| Background streaming (Foreground Service) | 📅 Phase 5 |
| Stickers, reactions, video overlays | 📅 Phase 6 |
| 10-language localization | 📅 Phase 7 |

---

## Requirements

- **Android 13+** (API 33) — 64-bit device
- **OTG cable** (USB-A or USB-C to USB-A/C adapter)
- **UVC-compatible USB webcam** (most webcams work: Logitech, Emeet, Razer, etc.)
- Tested on: Headwolf Titan1 (Dimensity 8300), Samsung Galaxy S21 FE
- Test camera: Emeet Piko+ 4K

---

## Installation

### Download APK (when available)
Go to [Releases](https://github.com/MikalaiKryvusha/KrinikCam/releases) and download the latest `KrinikCam-vX.Y.apk`.

Enable **Install from unknown sources** in your Android settings, then open the APK.

### Build from source
```bash
git clone https://github.com/MikalaiKryvusha/KrinikCam.git
cd KrinikCam
node tools/setup.mjs          # first-time setup
node tools/build.mjs          # opens browser with build progress
```
Requires: JDK 17+, Android SDK (API 35), Node.js 18+

---

## Quick Start

1. Connect USB webcam to phone via OTG adapter
2. Open KrinikCam → tap **Allow** for USB and microphone access
3. See full-screen camera preview
4. Tap the floating button → **Platforms** → add your YouTube stream key
5. Tap **Go Live** — you're live 🎬

---

## Architecture

Multi-module Android project (Kotlin DSL, Jetpack Compose, Hilt DI):

```
:app                    entry point, navigation, UvcVideoSource bridge
:core:common            shared models, utils, DI dispatchers
:core:ui                Design System — Material3, KrinikCam brand theme
:core:logging           file-based debug logger (shareable logs)
:feature:usb            UVC camera detection, hot-plug, preview
:feature:capture        Device Manager — video/audio source registry
:feature:codec          MediaCodec scanner (HW codec capabilities)
:feature:streaming      RtmpStream (RootEncoder), VideoSource pipeline, profiles
:data:profiles          Room DB + DataStore (stream profiles, device config)
```

**Phase 3 pipeline — the GL compositor is the single video path (camera = layer):**
```
Sources (opener per type)                 Compose UI → ViewModel → Repository → Streamer → Compositor
  • UVC webcam    (AndroidUSBCamera)         a fact discovered by an opener (aspect, sensor
  • built-in cam  (Camera2)                  orientation) travels up this chain to the compositor
  • virtual cam   (debug test pattern)
        → OES texture of the camera layer
  → CompositorVideoSource (OpenGL ES)     // draws ALL layers bottom-up into one frame
        two-pass FBO render: scene in a fixed 16:9 buffer, canvas rotation as a final blit
  → MediaCodec encoder (RootEncoder) → RTMP packets  +  mirror to on-screen preview
```

**Key libraries:**
- [AndroidUSBCamera 3.2.7](https://github.com/jiangdongguo/AndroidUSBCamera) — UVC driver (AUSBC)
- [RootEncoder 2.4.7](https://github.com/pedroSG94/RootEncoder) — RTMP/SRT/RTSP, GL pipeline, HW codecs
- Jetpack Compose + Material3, Hilt, Room, DataStore, Navigation

---

## Development

```bash
node tools/build.mjs               # debug build (opens browser UI with progress bar)
node tools/build.mjs --release     # release build
node tools/commit.mjs "feat: ..."  # bump build version, commit, push
node tools/release.mjs             # bump minor version, create GitHub Release

# Graphics (SVG → PNG)
node tools/graphics/render.mjs --input assets/graphics/src/foo.svg --output out.png --width 512
node tools/graphics/batch.mjs  --input assets/graphics/src/ic_launcher.svg --name ic_launcher --android
```

---

## License

[MIT License](LICENSE) — © 2026 Mikalai Kryvusha

---

---

# KrinikCam (на русском)

**Открытое Android-приложение для стримеров и блогеров — мобильный OBS.**  
Подключи USB-вебкамеру через OTG (или используй встроенные камеры устройства) → собери сцену из слоёв → выходи в эфир на YouTube, Instagram, Twitch или TikTok.

> **Статус:** Активная разработка · Phase 1 ✅ USB превью · Phase 2 ✅ RTMP подтверждён на устройстве (портрет + ландшафт) · **Phase 3 ✅ GL-композитор «камера = слой» — основной пайплайн** (мультиисточниковая сцена, жесты слоёв, единая модель поворота)

---

## Возможности

| Функция | Статус |
|---------|--------|
| Превью USB-вебкамеры (UVC, любой бренд) | ✅ Phase 1 |
| Fullscreen видеоискатель (радиальное FAB-меню) | ✅ Phase 1 |
| Профили стримов (Room DB + DataStore) | ✅ Phase 1 |
| Сканер кодеков (H.264 / HEVC / AV1) | ✅ Phase 1 |
| Файловый логгер с возможностью отправки | ✅ Phase 1 |
| RTMP-стрим на YouTube / Twitch / custom | ✅ Phase 2 |
| Заглушка "Please stand by" при отключении | ✅ Phase 2 |
| Ре-запрос разрешений камера / микрофон из Settings | ✅ Phase 2 |
| Импорт / экспорт профилей стримов (JSON) | ✅ Phase 2 |
| USB permission — запомнить устройство | ✅ Phase 2 |
| **GL-композитор «камера = слой» (мобильный OBS)** | ✅ Phase 3 (дефолт) |
| Поворот холста (0° / 90° / 180° / 270°) + поворот содержимого слоя | ✅ Phase 3 |
| Слои-источники сцены (камера + картинки-оверлеи, z-order, видимость) | ✅ Phase 3 |
| Жесты слоёв — перетаскивание / щипок / поворот двумя пальцами + магнитный снап | ✅ Phase 3 |
| Встроенные камеры устройства как источник (Camera2, верные ориентация и аспект) | ✅ Phase 3 |
| Вертикальное меню слоёв (диалог настроек слоя, подпись источника) | ✅ Phase 3 |
| Встроенное руководство пользователя (Настройки) | ✅ Phase 3 |
| Одновременный стрим на несколько платформ | 📅 Phase 4 |
| Умная авторегулировка (экспозиция, баланс белого) | 📅 Phase 4 |
| Картинка-в-картинке, GPU-фильтры | 📅 Phase 4 |
| Фоновый режим стриминга (Foreground Service) | 📅 Phase 5 |
| Стикеры, реакции, видео-оверлеи | 📅 Phase 6 |
| Локализация на 10 языков | 📅 Phase 7 |

---

## Требования

- **Android 13+** (API 33) — 64-битное устройство
- **OTG-кабель** (переходник USB-A или USB-C)
- **UVC-совместимая USB-камера** (работает большинство: Logitech, Emeet, Razer и др.)
- Тест-устройства: Headwolf Titan1 (Dimensity 8300), Samsung Galaxy S21 FE
- Тест-камера: Emeet Piko+ 4K

---

## Установка

### Скачать APK (когда будет доступно)
Открой [Releases](https://github.com/MikalaiKryvusha/KrinikCam/releases) и скачай последний `KrinikCam-vX.Y.apk`.

Включи **Установку из неизвестных источников** в настройках Android, открой APK.

### Сборка из исходников
```bash
git clone https://github.com/MikalaiKryvusha/KrinikCam.git
cd KrinikCam
node tools/setup.mjs          # первичная настройка
node tools/build.mjs          # открывает браузер с прогрессом сборки
```
Требования: JDK 17+, Android SDK (API 35), Node.js 18+

---

## Быстрый старт

1. Подключи USB-камеру к телефону через OTG-переходник
2. Открой KrinikCam → нажми **Разрешить** для USB и микрофона
3. Видишь превью с камеры во весь экран
4. Тап на плавающую кнопку → **Платформы** → добавь ключ стрима YouTube
5. Нажми **В эфир** — стрим пошёл 🎬

---

## Лицензия

[MIT License](LICENSE) — © 2026 Mikalai Kryvusha

Автор: [Mikalai Kryvusha](https://github.com/MikalaiKryvusha) aka **KOT KRINIK**
