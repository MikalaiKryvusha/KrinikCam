# KrinikCam

[![Build](https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING/actions/workflows/build.yml/badge.svg)](https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF1A8C.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%2013%2B-3DDC84.svg)](https://developer.android.com)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.1.0-7F52FF.svg)](https://kotlinlang.org)
[![Version](https://img.shields.io/badge/Version-0.2%20(dev)-FF1A8C.svg)](https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING/releases)

**An open-source Android app for streamers and bloggers.**  
Plug in a USB webcam via OTG → see a full-screen preview → go live on YouTube, Instagram, Twitch, or TikTok — all at once.

> **Status:** Active development · Phase 1 complete — USB preview + RTMP stream working · Phase 2 (multi-platform) next

---

## Features

| Feature | Status |
|---------|--------|
| USB webcam preview (UVC, any brand) | ✅ Phase 1 |
| Fullscreen viewfinder with phone camera fallback | ✅ Phase 1 |
| RTMP stream to YouTube / Twitch / custom | ✅ Phase 1 |
| Stream profiles (Room DB + DataStore) | ✅ Phase 1 |
| Hardware codec scanner (H.264 / HEVC / AV1) | ✅ Phase 1 |
| File-based debug logger (shareable logs) | ✅ Phase 1 |
| Simultaneous multi-platform streaming | 📅 Phase 2 |
| Phone camera fallback (Camera2) | 📅 Phase 2 |
| Auto image regulation (exposure, white balance) | 📅 Phase 3 |
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
Go to [Releases](https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING/releases) and download the latest `KrinikCam-vX.Y.apk`.

Enable **Install from unknown sources** in your Android settings, then open the APK.

### Build from source
```bash
git clone https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING.git
cd KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING
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
:app                    entry point, navigation
:core:common            shared models, utils, DI dispatchers
:core:ui                Design System — Material3, KrinikCam brand theme
:core:logging           file-based debug logger (shareable logs)
:feature:usb            UVC camera detection, hot-plug, preview
:feature:capture        Device Manager — video/audio source registry
:feature:codec          MediaCodec scanner (HW codec capabilities)
:feature:streaming      RTMP client (RootEncoder), platform profiles
:data:profiles          Room DB + DataStore (stream profiles, device config)
```

**Key libraries:**
- [AndroidUSBCamera](https://github.com/jiangdongguo/AndroidUSBCamera) — UVC driver
- [RootEncoder](https://github.com/pedroSG94/RootEncoder) — RTMP/SRT/RTSP streaming, HW codecs
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

**Открытое Android-приложение для стримеров и блогеров.**  
Подключи USB-вебкамеру через OTG → видишь превью во весь экран → жмёшь кнопку → стрим идёт на YouTube, Instagram, Twitch или TikTok — одновременно.

> **Статус:** Активная разработка · Phase 1 завершена — USB превью + RTMP стрим работают · Phase 2 (мультиплатформа) следующая

---

## Возможности

| Функция | Статус |
|---------|--------|
| Превью USB-вебкамеры (UVC, любой бренд) | ✅ Phase 1 |
| Fullscreen видеоискатель, фолбэк на камеру телефона | ✅ Phase 1 |
| RTMP-стрим на YouTube / Twitch / custom | ✅ Phase 1 |
| Профили стримов (Room DB + DataStore) | ✅ Phase 1 |
| Сканер кодеков (H.264 / HEVC / AV1) | ✅ Phase 1 |
| Файловый логгер с возможностью отправки | ✅ Phase 1 |
| Одновременный стрим на несколько платформ | 📅 Phase 2 |
| Фолбэк на камеру телефона (Camera2) | 📅 Phase 2 |
| Умная авторегулировка (экспозиция, баланс белого) | 📅 Phase 3 |
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
Открой [Releases](https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING/releases) и скачай последний `KrinikCam-vX.Y.apk`.

Включи **Установку из неизвестных источников** в настройках Android, открой APK.

### Сборка из исходников
```bash
git clone https://github.com/MikalaiKryvusha/KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING.git
cd KRINIK-S-ANDROID-USB-WEB-CAMERA-FOR-STREAMING
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
