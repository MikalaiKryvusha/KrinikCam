# План 09 — Стабилизация мультистрима (фикс bug 34): стоп/рестарт, изоляция выходов, реконнект

> Чинит **bugs/34** (критический). Предшествует S5 из plans/07 (живая сверка ключами) — в текущем
> виде мультистрим в бой выпускать нельзя. Библиотечные факты подтверждены javap RootEncoder 2.4.7.
> Автономно проверяемо на локальном RTMP-полигоне (`tools/rtmp-server.mjs`) — камера не нужна
> (виртуалка), Криник не нужен.

## S1 — Правильный стоп: per-index disconnect

`RtmpStreamer.stopStream()` (:570-579): перед no-arg `stopStream()` пройтись по
`activeRtmpOutputs` и вызвать `rtmpStream.stopStream(MultiType.RTMP, i)` для каждого — это
единственный путь к `RtmpClient.disconnect()` (no-arg через пустой `MultiStream.rtpStopStream()`
клиентов НЕ отключает). Затем no-arg — гасит энкодер. Исправить лживый комментарий.
⚠️ Только per-index тоже недостаточно (остановка последнего выхода энкодер не гасит) — нужны ОБА шага.
Чистить `activeRtmpOutputs` на всех путях (stop, failed, частичный старт).

## S2 — Per-output ConnectChecker + состояние по выходам

`Array(maxRtmpOutputs) { i -> makeChecker(i) }` вместо одного инстанса; `Map<Int, OutputState>`
(Connecting/Live/Reconnecting/Failed/Stopped). Агрегат для UI: Live = хотя бы один живой;
per-output статусы наружу (StreamState расширить списком выходов: имя платформы + статус + битрейт).

## S3 — Изоляция сбоя одного выхода

`onConnectionFailed(i)` / `onAuthError(i)`: стопить ТОЛЬКО упавший индекс
(`stopStream(RTMP, i)`), живые не трогать; state выхода → Failed с причиной; снэкбар «Twitch упал:
<reason>, YouTube в эфире». Частичный старт (S3 из :548-567): catch в цикле старта откатывает уже
запущенные индексы. Превью: в failed-путь добавить восстановление превью как в stopStream()
(:450-471) — фикс чёрного экрана.

## S4 — Реконнект с экспоненциальным бэкоффом

На onConnectionFailed/onDisconnect выхода: если `getStreamClient(RTMP,i).shouldRetry(reason)` →
state Reconnecting(attempt), `reTry(delayMs, reason)` с бэкоффом 1с→2с→4с→8с (потолок 5 попыток,
потом Failed). Сетевой блип больше не конец эфира.

## S5 — Автономная приёмка на полигоне (обязательна перед DONE)

`node tools/rtmp-server.mjs start` (MediaMTX, 2 пути). Матрица:
1. start→stop→start (один выход) — второй эфир живой (ffprobe записи полигона).
2. Два выхода, оба живые — обе записи растут.
3. Два выхода, один кривой URL — живой продолжает, UI показывает Failed только для кривого.
4. Убить полигон на 3с во время эфира → Reconnecting → эфир восстановился.
5. `tools/smoke.mjs` — одно-выходной путь не сломан.
Затем — S5 из plans/07 (живые ключи Криника, homeworks/05).

## Статус
📋 План готов (2026-07-12, из ревизии). Реализация не начата. Оценка: S1-S3 — день, S4 — полдня,
S5 — полдня.
