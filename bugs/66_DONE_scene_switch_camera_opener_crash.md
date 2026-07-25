# Bug 66 — Краш при переключении сцены: гонка async-колбэка Camera2-опенера

> Заведён: 2026-07-25 (найден живьём при реализации Фазы 1 «Профили сцен», plans/18). Приоритет: ВЫСОКИЙ
> (нативный FATAL при штатной операции — переключение сцены со встроенной камерой). Статус: ✅ ИСПРАВЛЕН.

## Симптом

Переключение активной сцены (`scene-switch`), когда целевая ИЛИ исходная сцена содержит слой-камеру со
встроенной (Camera2) камерой, роняет приложение с диалогом «В работе приложения KrinikCam произошёл сбой».

## Пойманный стектрейс (10:06:27, live)

```
FATAL EXCEPTION: DeviceCam
java.lang.IllegalStateException: CameraDevice was already closed
  at android.hardware.camera2.impl.CameraDeviceImpl.checkIfCameraClosedOrInError(CameraDeviceImpl.java:2912)
  at android.hardware.camera2.impl.CameraDeviceImpl.createCaptureRequest(CameraDeviceImpl.java:1111)
  at com.kriniks.kcam.streaming.DeviceCameraOpener$open$5$onOpened$1.onConfigured(DeviceCamera.kt:185)
```

## Root cause

`DeviceCameraOpener` открывает Camera2 асинхронно: `openCamera → onOpened → createCaptureSession →
onConfigured`. Колбэки `onOpened`/`onConfigured` приходят ПОЗЖЕ на handler-треде `DeviceCam` и НЕ обёрнуты
в синхронный `try` (в отличие от вызова `createCaptureSession` в `onOpened`).

Переключение сцены меняет набор слоёв → мост `:app` (LaunchedEffect в MainScreen) реконсилит опенеры →
у старого слоя-камеры зовётся `opener.close()` → `camera.close()`. Если это происходит МЕЖДУ `onOpened` и
`onConfigured` (окно ~сотни мс, легко попасть при быстром переключении), то `onConfigured` дёргает
`camera.createCaptureRequest(...)` на УЖЕ ЗАКРЫТОМ `CameraDevice` → `IllegalStateException: already closed`
→ необёрнутое исключение в колбэке валит handler-тред → FATAL.

Латентный дефект опенера (семья bug 62/63); Фаза 1 (переключение сцен) — первый штатный триггер быстрой
смены источников, который его вскрыл.

## Фикс

`DeviceCamera.kt` — гард гонки закрытия:
1. `@Volatile private var closed` — застолбить в `close()` ПЕРЕД закрытием device.
2. `onOpened`: если `closed` — сразу `camera.close()` и выход (иначе повиснет открытый device — утечка + блок камеры).
3. `onConfigured`: ранний выход при `closed || device == null` (закрыть сессию); тело `createCaptureRequest +
   setRepeatingRequest` обёрнуто в `runCatching` — необёрнутый колбэк больше не роняет тред.

## TWINS

`TWINS: искал Camera2 async-колбэки (createCaptureSession/onConfigured/StateCallback) без гарда закрытия —
найдено 1 место (DeviceCamera.kt). UVC (AUSBC) и Virtual опенеры не используют Camera2-сессии.` Класс закрыт.

## Приёмка (наблюдение, 2026-07-25)

- ✅ Стресс-переключение 1→2→1→3→1 на сцене со встроенной камерой (в standby) — приложение живо (pid не
  менялся), **новых FATAL в logcat нет** (в буфере только СТАРЫЙ краш 10:06 до фикса; стресс 10:09–10:10 чист).
- ✅ Слой встроенной камеры при недоступности источника корректно показывает GL-заглушку (standby) вместо краша.

## Связи
plans/18 Фаза 1 (переключение сцен — триггер), bug 62/63 (семья GL/камер-lifecycle при смене источника),
EXP-0021 (урок: async-колбэки камеры гардить флагом закрытия).
