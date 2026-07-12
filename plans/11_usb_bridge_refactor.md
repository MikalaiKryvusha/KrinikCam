# План 11 — Мост USB→DeviceManager вне Compose + детерминированный жизненный цикл камер (фикс bug 35)

> Чинит **bugs/35** (высокий кластер), усиливает bug 33 (дубли запросов) и bug 28/31 (нативные
> крахи от двойных open). Частично проверяемо автономно (виртуалка + select-source), hot-plug-часть
> требует живого втыкания камеры.

## S1 — Application-scoped мост событий (ядро фикса)

Новый `UsbSourceBridge` (Hilt @Singleton, собственный scope на Main): коллектит
`UsbDeviceRepository.events` и зовёт `DeviceManager.notifyUvcConnected/Disconnected` НАПРЯМУЮ —
детач АКТИВНОЙ камеры больше не теряется (сейчас `notifyUvcDisconnected` мёртв: VM зануляет
activeCameraId до перезапуска LaunchedEffect). Из `MainScreen.kt:139-160` мост УДАЛИТЬ;
LaunchedEffect остаётся только для UI-реакций (превью-поверхность).

## S2 — Дедупы и идемпотентность

- `UsbViewModel`: `connectedDevices` дедуп по deviceId (attach-спам AUSBC).
- `DeviceManager.notifyUvcConnected`: замена по id (`filter { it.id != source.id } + source`);
  RMW через `MutableStateFlow.update {}` + комментарий-контракт «только main».
- `UsbDeviceRepositoryImpl.startMonitoring`: guard `if (multiCameraClient != null) return` (иначе
  утечка USBMonitor-receiver + дубли событий → вклад в bug 33).
- Дебаунс requestPermission: `Map<deviceId, timestamp>` вместо одноместного слота.
- Один владелец UsbViewModel: убрать route-scoped `hiltViewModel()` из MainScreen, передавать
  activity-инстанс (или state в репозиторий).

## S3 — Детерминированное открытие камеры (вместо sleep+reopen)

`CameraLayerOpeners` (UVC): open → дождаться OPENED/PreviewStarted (сигнал уже эмитится) →
`getAllPreviewSizes` → если best ≠ current: `closeCamera` → дождаться CLOSED → `openCamera(best)`.
Убрать `Thread.sleep(1500)` и второй `openCamera` без close (по байткоду AUSBC первая нативная
сессия иначе живёт вечно). Кэш негоциированного best per-device (vid/pid) в DevSettings — со второго
подключения открываемся сразу правильно, вообще без reopen. Общий lock close()↔reopen (добить
TOCTOU-хвост bug 31).

## S4 — Мелочи кластера

- `UsbDeviceRepositoryImpl.initCamera`: перед put — `openCameras.remove(id)?.closeCamera()`.
- `DeviceCamera` (Camera2): `@Volatile closed`; в onOpened `if (closed) { camera.close(); return }`;
  в onDisconnected/onError — полный cleanup (session/thread) + error наверх.
- `UsbEvent.Error` (err=-9/-99): чистить openCameras, пробрасывать в UI-state (строка статуса слоя —
  стыкуется с idea 20 «не молчать»), дёргать фолбэк источника.
- `CodecScanner`: try/catch вокруг `getSupportedFrameRatesFor` (невалидная пара upper×upper).

## S5 — Приёмка

Автономно: select-source virtual↔builtin↔uvc 10× — без фантомов в availableSources (dump);
пересоздание Activity (`am start` с recreate) — события не дублируются (лог). Живое (Криник или
локально с Piko+): hot-plug 5× — источник появляется/исчезает из списка, авто-фолбэк работает,
`Surface.release`-варнингов в логе нет. Стресс bug 31 (uvc↔virtual 12×) не регрессировал.

## Статус
📋 План готов (2026-07-12, из ревизии). Реализация не начата. Оценка: 1-1.5 дня. S1-S2 — сначала
(маленькие и системные), S3 — отдельным коммитом (трогает нативный путь — тестировать с Piko+).
