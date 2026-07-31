# KrinikCam

[![Build](https://github.com/MikalaiKryvusha/KrinikCam/actions/workflows/build.yml/badge.svg)](https://github.com/MikalaiKryvusha/KrinikCam/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF1A8C.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%2013%2B-3DDC84.svg)](https://developer.android.com)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.1.0-7F52FF.svg)](https://kotlinlang.org)
[![Version](https://img.shields.io/badge/Version-0.8-FF1A8C.svg)](https://github.com/MikalaiKryvusha/KrinikCam/releases)
[![Framework: KAIF 2.1](https://img.shields.io/badge/Framework-KAIF%202.1-6E56CF.svg)](https://github.com/MikalaiKryvusha/KAIF)

<a name="english"></a>
**English** · [Русский](#русский)

**An open-source Android app for streamers and bloggers — a mobile OBS.**  
Plug in a USB webcam via OTG (or use the device's built-in cameras) → compose a scene from layers → go live on YouTube, Instagram, Twitch, or TikTok.

> **Status:** Active development · Phase 1 ✅ USB preview · Phase 2 ✅ RTMP confirmed on device (portrait + landscape) · **Phase 3 ✅ GL compositor "camera = layer" is the default pipeline** — multi-source scene with **multiple independent camera feeds** and **feed sharing** (one camera on several layers, OBS-style), encoder profiles (H.264/HEVC/AV1), adaptive bitrate + live telemetry, record to gallery

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
| **Multiple independent camera feeds** on separate layers (UVC + selfie at once) | ✅ v0.8 |
| **Feed sharing** — one camera on several layers (OBS-style "duplicate source", PiP) | ✅ v0.8 |
| Source picker modal when adding a video layer + per-layer source selection | ✅ v0.8 |
| **Scene profiles** — named scenes, save/restore across restart, switch, duplicate, rename (manager panel) | ✅ v0.8 |
| **Scene transitions** — per-scene effect played when the scene is switched on: instant / fade / slide, duration 0.2–1.5 s (chosen in the scene editing dialog) | ✅ v0.8 |
| The outgoing scene stays **live** during a transition — its cameras keep streaming until the effect finishes (a built-in camera freezes instead, since the SoC cannot run two at once) | ✅ v0.8 |
| No black frame on scene switch — the last frame of the previous scene is held until the new scene actually produces an image | ✅ v0.8 |
| Honest recording indicator — “PREPARING” until the first frame is really written; the REC badge and timer start at the real start | ✅ v0.8 |
| **Encoder profiles** — separate manager (H.264 / HEVC / AV1, bitrate in Mbps, stereo / mono / joined audio) | ✅ v0.7 |
| **Adaptive bitrate** + live stream telemetry (health badge, −20% on congestion / +10% recovery) | ✅ v0.7 |
| **Record composite to gallery** (DCIM/KrinikCam .mp4) + photo capture | ✅ v0.7 |
| Manual UI language + "follow system" (EN / RU) | ✅ v0.7 |
| Simultaneous multi-platform streaming (YouTube + Instagram…) | ✅ engine stabilized — per-output failure isolation + auto-reconnect (backoff); live multi-key check pending |
| **A broadcast ends only when you stop it** — unlimited reconnection with jittered backoff, the foreground service survives the outage, loud on-screen and notification status ("off air 00:28 · try 7") | ✅ v0.8 — verified live: a 3-minute outage, the stream came back on its own |
| **Adaptive bitrate floor is configurable** — the minimum video bitrate lives in the encoder profile (default 250 kbps, presets 150…1000). The previous hard-coded 1 Mbps floor was above the capacity of a poor 3G uplink, so the stream stalled instead of degrading | ✅ **0.8-dev, not yet in the v0.8 release** — verified on the test rig: the outgoing bitrate settles at 373–404 kbps (≈250 video + 128 audio) with zero dropped frames. Behaviour on a real narrow uplink is not measured yet |
| **Stalled-sender watchdog** — a frozen socket (the receiver keeps the connection but stops reading) is turned into a reconnect instead of a silent "green LIVE" that used to last for minutes while the whole stream was lost | ✅ **0.8-dev, not yet in the v0.8 release** — verified on a frozen ingest: ~14 s from the receiver freezing to the reconnect (a 6-second stall threshold counted from the moment the sender counters stop moving), self-recovery 3 s after the receiver returned |
| Screen stays on while live (keep-screen-on) | ✅ v0.7 |
| **Background streaming** — Foreground Service (stream survives screen-off / app in background) + wake lock | ✅ v0.7 |
| Auto image regulation (exposure, white balance) | 📅 Phase 4 |
| Picture-in-Picture, GPU filters | 📅 Phase 4 |
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

### Download APK
Download the latest **[KrinikCam-v0.8.apk](https://github.com/MikalaiKryvusha/KrinikCam/releases/latest)** — or browse all builds on the [Releases](https://github.com/MikalaiKryvusha/KrinikCam/releases) page.

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
        → producer per physical source → OES texture of a camera slot
  → CompositorVideoSource (OpenGL ES)     // draws ALL layers bottom-up into one frame
        each camera layer maps to a producer by sourceKey: different sources = independent feeds,
        the SAME source shared across layers (mirror slots — one open, drawn into many quads)
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

<a name="русский"></a>
# KrinikCam

[English](#english) · **Русский**

**Открытое Android-приложение для стримеров и блогеров — мобильный OBS.**  
Подключи USB-вебкамеру через OTG (или используй встроенные камеры устройства) → собери сцену из слоёв → выходи в эфир на YouTube, Instagram, Twitch или TikTok.

> **Статус:** Активная разработка · Phase 1 ✅ USB превью · Phase 2 ✅ RTMP подтверждён на устройстве (портрет + ландшафт) · **Phase 3 ✅ GL-композитор «камера = слой» — основной пайплайн** — мультиисточниковая сцена с **несколькими независимыми камерами** и **шарингом фида** (одна камера на нескольких слоях, как в OBS), профили кодера (H.264/HEVC/AV1), адаптивный битрейт + живая телеметрия, запись в галерею

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
| **Несколько независимых камер** на разных слоях (UVC + селфи одновременно) | ✅ v0.8 |
| **Шаринг фида** — одна камера на нескольких слоях (как OBS «дублировать источник», PiP) | ✅ v0.8 |
| **Профили сцен** — именованные сцены, сохранение/восстановление между запусками, переключение, дублирование, переименование (панель-менеджер) | ✅ v0.8 |
| **Переходы сцен** — у каждой сцены свой эффект при включении: мгновенно / плавно / выезд, длительность 0.2–1.5 с (выбирается в модалке редактирования сцены) | ✅ v0.8 |
| Уходящая сцена остаётся **живой** во время перехода — её камеры продолжают стримить до конца эффекта (встроенная камера вместо этого замирает: SoC не тянет две одновременно) | ✅ v0.8 |
| Нет чёрного кадра при переключении сцен — последний кадр прошлой сцены держится, пока новая реально не даст картинку | ✅ v0.8 |
| Честная индикация записи — «ПОДГОТОВКА» до первого реально записанного кадра; бейдж и таймер стартуют по факту | ✅ v0.8 |
| Модалка выбора источника при добавлении слоя + выбор источника пер-слой | ✅ v0.8 |
| **Профили кодера** — отдельный менеджер (H.264 / HEVC / AV1, битрейт в Мбит/с, стерео / моно / объединённый звук) | ✅ v0.7 |
| **Адаптивный битрейт** + живая телеметрия эфира (health-бейдж, −20% при затыке / +10% восстановление) | ✅ v0.7 |
| **Запись композита в галерею** (DCIM/KrinikCam .mp4) + фотоснимок | ✅ v0.7 |
| Ручной выбор языка UI + «следовать системе» (EN / RU) | ✅ v0.7 |
| Одновременный стрим на несколько платформ (YouTube + Instagram…) | ✅ движок стабилизирован — изоляция сбоя выхода + авто-реконнект (бэкофф); сверка живыми ключами впереди |
| **Эфир завершает только кнопка Стоп** — реконнект без потолка попыток с джиттером, foreground-сервис переживает обрыв, громкая индикация на экране и в уведомлении («эфир не идёт 00:28 · попытка 7») | ✅ v0.8 — проверено живьём: обрыв 3 минуты, эфир вернулся сам |
| **Пол адаптивного битрейта настраивается** — минимальный битрейт видео живёт в профиле кодера (по умолчанию 250 кбит/с, пресеты 150…1000). Прежний хардкод 1 Мбит/с был выше полосы плохого 3G, из-за чего эфир вставал вместо того, чтобы деградировать | ✅ **0.8-dev, в релиз v0.8 ещё НЕ вошло** — проверено на полигоне: исходящий битрейт садится на 373–404 кбит/с (≈250 видео + 128 звук), потерянных кадров нет. Поведение на реальном узком канале пока не измерено |
| **Watchdog замершего отправителя** — замерший сокет (приёмник держит соединение, но не читает) превращается в реконнект вместо молчаливого зелёного LIVE, который раньше держался минутами, пока терялся весь поток | ✅ **0.8-dev, в релиз v0.8 ещё НЕ вошло** — проверено на замороженном приёмнике: ~14 с от заморозки до реконнекта (порог 6 с отсчитывается с момента, когда счётчики отправки перестают расти), самовосстановление через 3 с после возврата приёмника |
| Экран не гаснет во время эфира (keep-screen-on) | ✅ v0.7 |
| **Фоновый режим стриминга** — Foreground Service (эфир переживает гашение экрана / сворачивание) + wake lock | ✅ v0.7 |
| Умная авторегулировка (экспозиция, баланс белого) | 📅 Phase 4 |
| Картинка-в-картинке, GPU-фильтры | 📅 Phase 4 |
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

### Скачать APK
Скачай последний **[KrinikCam-v0.8.apk](https://github.com/MikalaiKryvusha/KrinikCam/releases/latest)** — или посмотри все сборки на странице [Releases](https://github.com/MikalaiKryvusha/KrinikCam/releases).

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
