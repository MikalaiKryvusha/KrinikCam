# plans/07 — Мультистрим MVP (YouTube + Instagram разом)

> Заведён: 2026-07-07 (дейлуп). Приоритет Криника: «минимально ценное приложение, чтобы уже стримить
> в ютуб и инстаграм». Это север ближайшей работы.

## 🔑 Ключевая находка (research, 2026-07-07)

RootEncoder **2.4.7 нативно поддерживает мультистрим** — пакет `com.pedro.library.multiple`, класс
**`MultiStream`**. ОДИН энкодер (наш GL-композитор) → НЕСКОЛЬКО RTMP/RTSP/SRT-выходов. Encode один раз,
раздача на N платформ. API (проверено javap по AAR):

```
MultiStream(context, rtmpCheckers: Array<ConnectChecker>, rtspCheckers, srtCheckers, udpCheckers,
            videoSource, audioSource)      // или без source-ов (дефолт микрофон)
startStream(MultiType.RTMP, index, url)    // старт КАЖДОГО выхода по типу+индексу
stopStream(MultiType.RTMP, index)
getStreamClient(MultiType.RTMP, index)     // bitrate/статус per-output
```

**`MultiStream` extends `StreamBase`** — тот же базовый класс, что и наш `RtmpStream`. Значит весь наш
превью/пайплайн-API ИДЕНТИЧЕН: `prepareVideo`, `prepareAudio`, `startPreview(TextureView)`,
`stopPreview`, `changeVideoSource(compositorSource)`, `getGlInterface`, `isStreaming`, `isOnPreview`.
Отличие ТОЛЬКО в подключении: конструктор берёт МАССИВ ConnectChecker'ов (по одному на выход), а
start/stop — per (type, index, url). Свап `RtmpStream → MultiStream` — минимально инвазивный.

## Дизайн MVP

- **Движок:** `RtmpStreamer` держит `MultiStream` вместо `RtmpStream`. Создаём с N RTMP-слотами
  (напр. потолок 4), стартуем только АКТИВНЫЕ.
- **Профили:** сейчас ОДИН активный профиль (`activeProfile`). Для мультистрима — НЕСКОЛЬКО активных
  (мультивыбор). `startStream()` → по каждому активному профилю `stream.startStream(RTMP, i, url+key)`.
- **Битрейт/статус:** per-output `getStreamClient(RTMP, i)`. ConnectChecker — массив (по индексу знаем,
  какая платформа отвалилась).
- **UI:** мультивыбор платформ в `StreamPlatformsOverlay` (чекбоксы «стримить сюда»); индикатор LIVE —
  на несколько платформ. (UX-детали — разумный дефолт; при судьбоносности → интервью.)

## Пошаговый план

- [x] **S1. Движок:** `RtmpStreamer` `RtmpStream → MultiStream` (N RTMP-слотов, массив ConnectChecker).
      Сохранить ОДНО-выходное поведение рабочим (регресс!). Verified: file-record + локальный RTMP-полигон.
- [x] **S2. Мультивыбор активных профилей** в модели/VM (набор активных id вместо одного).
- [x] **S3. startStream/stopStream** по всем активным профилям (per index); статусы/битрейт per-output.
- [x] **S4. UI** мультивыбора в `StreamPlatformsOverlay` + LIVE-индикатор на несколько платформ.
- [ ] **S5. Verified:** локальный RTMP-полигон (`tools/rtmp-server.mjs`) на 2 выхода + запись; финальная
      сверка настоящими ключами ютуб/инстаграм — **ДЗ Криника** (homeworks/, нужны его stream-ключи).

## Риски / заметки

- Свап движка трогает ядро стриминга — мелкими проверенными шагами, тест на харнесе (virtual-camera +
  stream-to-file + go-live на локальный RTMP). Не ломать одно-выходной путь.
- YouTube/Instagram RTMP-URL: ключ = stream key платформы. Instagram Live RTMP — уточнить актуальность
  (иногда требует Business API); в MVP — общий RTMP-выход, реальные ключи проверит Криник.
