# Larix Broadcaster (Softvelum)

> Категория: стриминг RTMP/SRT с камеры + **частичная (премиум, экспериментальная) UVC-поддержка**.
> «Профи»-инструмент. Статус сбора: 🔬 сырьё (2026-06-29).

## Обзор

Larix Broadcaster — бесплатное (с ограничениями) приложение для лайв-стриминга от **Softvelum**
(их экосистема: SLDP, Nimble Streamer, Larix Player/Grove). Android + iOS. Ориентировано на
профессионалов и продвинутых: множество протоколов, тонкие настройки, надёжная доставка. Package id:
`com.wmspanel.larix_broadcaster`.

## Платформы и доступность

- **Android и iOS.** Multi-camera capture на **Android 11+** (фронт/тыл с live-переключением).
- Google Play: `https://play.google.com/store/apps/details?id=com.wmspanel.larix_broadcaster`
- Сайт/доки: `https://softvelum.com/larix/`

## Цены / монетизация

- **Free** — с **водяным знаком** и **лимитом времени** трансляции.
- **Larix Premium — $9.99/мес**: убирает водяной знак и лимит, открывает **несколько одновременных
  выходов (мультистрим)**, Talkback, **HEVC**, продвинутые оверлеи, ABR (адаптивный битрейт),
  auto-start, и — **ВАЖНО — поддержку UVC-камеры**.
- 🔑 То есть **USB/UVC-камера у Larix — платная (премиум) фича**, а не из коробки.

## Ключевые фичи

- Протоколы (очень богато): **SRT, RTMP/RTMPS, NDI, WebRTC, RTSP, Zixi, RIST**.
- Таргеты: YouTube Live, Facebook Live, Twitch, Amazon IVS, Dacast, Limelight, Akamai и любые RTMP/SRT.
- Talkback (обратный звук) через SRT/RTMP/Icecast.
- ABR (adaptive bitrate), HEVC, auto-start, продвинутые оверлеи (премиум).
- Multi-camera (Android 11+), портрет/ландшафт, live-переключение камер.
- Тонкие настройки битрейта/кодеков/keyframe — «профи» уровень.

## Поддержка USB/UVC (детально)

- «UVC OTG USB devices can be used as **video and audio sources**» — т.е. поддерживается и звук с USB
  (плюс относительно нас, где аудио — микрофон телефона).
- ⚠️ **«This is the experimental feature… Some devices may still not work properly.»** — официально
  помечено как ЭКСПЕРИМЕНТАЛЬНОЕ.
- ⚠️ **«overlays feature set does not work with OTG input yet»** — оверлеи НЕ работают с USB-входом.
- Включение: Advanced settings / USB Camera → enable → restart app; иногда нужно «tap ON/OFF first».
- «Most modern phones work fine», но есть отладочное меню для отправки логов (значит проблемы не редки).
- 🔑 И снова: **UVC доступен только в Premium ($9.99/мес)**.

## Протоколы и таргеты

Самый широкий набор среди конкурентов (SRT/RTMP/NDI/WebRTC/RTSP/Zixi/RIST) — сильная сторона для проф.

## UX-заметки

Мощный, но **высокий порог входа**: много протоколов и настроек, интерфейс «инженерный». Для новичка-
стримера, который просто хочет «подключить вебку и пойти в эфир», это избыточно сложно.

## Сильные стороны

- Профессиональный набор протоколов и надёжная доставка (SRT/RIST/ABR/HEVC).
- Кроссплатформенность (Android+iOS), мультистрим, multi-camera.
- Активная поддержка/доки от Softvelum.
- UVC поддерживает и звук.

## Слабые стороны и БОЛИ пользователей (для позиционирования)

- 🔑 **USB/UVC — платно (Premium $9.99/мес) и «экспериментально»** — главный контраст с нами.
- **Водяной знак + лимит времени** в бесплатной версии.
- **Оверлеи не работают с USB-входом.**
- **Сложность/порог входа** — «профи»-инструмент, не для «просто включить вебку».
- _(Свежие цитаты из Play Store/Reddit добрать при следующем заходе — поиск отзывов пока пуст.)_

## Релевантность для KrinikCam (без оскорблений)

- **Главный дифференциатор**: у нас USB-вебка + стрим — **бесплатно, из коробки, как ядро продукта**;
  у Larix это премиум + экспериментально. Мы проще и специализированы именно под этот сценарий.
- **Open-source (MIT)**, без водяного знака и лимитов времени.
- Современный, дружелюбный UX vs «инженерный» Larix.
- Где Larix объективно сильнее: протоколы (SRT/RIST/NDI/WebRTC), HEVC, ABR, talkback, кроссплатформа,
  multi-camera, аудио по USB — это ориентир для нашего roadmap (часть — Phase 2+).

## Источники

- https://softvelum.com/larix/
- https://softvelum.com/larix/usb/ (статус UVC: экспериментальный, оверлеи не работают с OTG)
- https://play.google.com/store/apps/details?id=com.wmspanel.larix_broadcaster
- Поиск (Premium $9.99/мес, UVC в премиуме, протоколы): результаты Google Play / soft112 / apkpure
