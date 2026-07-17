# План 10 — Эфир переживает экран и фон: foreground service + keep-screen-on + wake lock (фикс bug 36)

> Чинит **bugs/36** (критический для стримера). Автономно проверяемо на полигоне + `adb shell input
> keyevent KEYCODE_POWER` — камера-виртуалка, Криник не нужен.

## S1 — Keep-screen-on (самый дешёвый большой выигрыш)

Пока `streamState` активен (Live/Connecting/Reconnecting или запись в файл):
`window.addFlags(FLAG_KEEP_SCREEN_ON)` (снимать при стопе). Экран не гаснет во время эфира —
закрывает 80% боли одним флагом ДО появления сервиса.

## S2 — StreamForegroundService

- `<service android:name=".streaming.StreamForegroundService"
  android:foregroundServiceType="camera|microphone|connectedDevice">` (разрешения уже в манифесте).
- Старт: при Go Live / записи в файл — `startForegroundService` + `startForeground(NOTIF_ID, notif,
  типы)`. Стоп: stopStream/stopRecord → `stopSelf`.
- Нотификация «🔴 KrinikCam LIVE — <платформы>» (акцент #FF1A8C), тап → MainActivity, кнопка Stop.
- Сервис ТОНКИЙ: держит процесс foreground, владение пайплайном остаётся как есть (Hilt-синглтоны
  RtmpStreamer/DeviceManager живут в процессе — сервису достаточно существовать).
- Runtime-запрос `POST_NOTIFICATIONS` при первом Go Live (разрешение уже объявлено, но не
  запрашивается — мёртвое).

## S3 — Доводка фона

- PARTIAL_WAKE_LOCK на время эфира (страховка от Doze при выключенном экране), release на стопе.
- Проверить: сворачивание (HOME) во время эфира, выключение экрана кнопкой, автоблокировка.
- User Manual: раздел «Эфир в фоне» (конвенция AGENT_GUIDE).

## S4 — Автономная приёмка

Полигон + виртуалка: go-live → `input keyevent KEYCODE_POWER` (экран выкл) → 5 мин → записи полигона
непрерывны (ffprobe); HOME → 5 мин → эфир жив; нотификация появляется/уходит корректно;
`tools/smoke.mjs` PASS.

## СТАТУС ПЛАНА: ✅ ЗАВЕРШЁН (2026-07-18, ночной цикл)

S1 — ранее (v0.7). S2+S3 — StreamForegroundService (динамические FGS-типы, wake lock,
POST_NOTIFICATIONS, нотификация «LIVE» с Stop, UM §7). S4 — приёмка ПРОЙДЕНА наблюдением:
экран-выкл 5 мин (385/339+339 кадров), HOME-фон (355+355), нотификация появляется/снимается,
smoke PASS. Протокол приёмки и урок про валидацию connectedDevice (EXP-0014) — в bugs/36 (DONE).
