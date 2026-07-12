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
🔄 **S1-S4 РЕАЛИЗОВАНЫ и ПРОВЕРЕНЫ живьём на полигоне (2026-07-12, дневной цикл, build 21+).**

- ✅ **S1** — корректный стоп (per-index disconnect + no-arg энкодер). Перепроверен на build 19:
  стоп→рестарт → `connected ✓`, полигон republishing.
- ✅ **S2** — per-output ConnectChecker: `Array(maxRtmpOutputs){ i -> makeConnectChecker(i) }`, каждый
  знает свой индекс (сверено байткодом: `MultiStream` строит `rtmpClients[i]=RtmpClient(checker[i])`).
  Per-output состояние `outputStates: Map<Int,OutputStatus>` (Connecting/Live/Reconnecting/Failed/Stopped
  + имя платформы + битрейт + попытка). Агрегат в `StreamState` через `recomputeAggregateState()`
  (Live=хоть один живой; список выходов приложен к `StreamState.Live.outputs`).
- ✅ **S3** — изоляция сбоя: `onOutputFailed(i)` стопит ТОЛЬКО упавший индекс, живые не трогает; упал
  последний → гасим энкодер + восстанавливаем превью. **Проверено:** 2 выхода [0]=полигон [1]=кривой
  `127.0.0.1:9/dead` → [0] в эфире (publishing), [1] изолирован (ECONNREFUSED), [0] цел.
- ✅ **S4** — реконнект с экспоненциальным бэкоффом (1с→2с→4с→8с, потолок 5 попыток) через
  `getStreamClient(RTMP,i).reTry(backoff,reason)`. **КОРЕНЬ (сверено байткодом):** `reTry` →
  `shouldRetry = doingRetry && !reason.contains("Endpoint malformed") && reTries>0`; счётчик `reTries`
  по умолчанию **0** → без `setReTries(n)` реконнект НИКОГДА не срабатывал (эфир умирал на любом блипе).
  Фикс: `setReTries(maxReconnectAttempts)` перед каждой попыткой. **Проверено живьём:** эфир → убил
  полигон → attempt 1(1с)→2(2с)→4с → полигон вернулся → **`connected ✓`**, republishing, 0 крашей.
- 🔄 **S5** — приёмка: пройдены пункты 1 (стоп/рестарт), 3 (кривой URL — изоляция), 4 (убийство
  полигона — реконнект), 5 (smoke одно-выходного пути цел, стоп чист, превью восстановлено). Остаток:
  пункт 2 (ДВА живых выхода растут одновременно — полигон MediaMTX, 2 пути `live/test`+`live/test2`).
  Затем DONE bug 34 и S5 из plans/07 (живые ключи Криника, homeworks/05).

Оценка остатка: пункт 2 матрицы (~15 мин на полигоне) → DONE bug 34.
