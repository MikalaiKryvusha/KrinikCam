# Bug 35 — Мост USB→UI на LaunchedEffect: фантомные источники, потерянные детачи, дубли мониторинга

> Заведён: 2026-07-12 (ревизия кода, аудиты usb/capture и app). Приоритет: ВЫСОКИЙ —
> кластер, из которого растут «странности» hot-plug (родственен bug 29/33).
> Полный отчёт: `researches/code_audit_2026-07-12.md`.

## Симптомы (наблюдаемые следствия)

- После отключения АКТИВНОЙ USB-камеры она остаётся в списке источников; авто-фолбэк на
  виртуалку/None не срабатывает; при каждом replug в реестре копятся «фантомы».
- Дубли системных событий (attach/permission) после пересоздания Activity.
- Быстрый swap камер (A выдернул, B воткнул) теряет отключение A.

## Root cause — системная логика висит на жизненном цикле Compose

1. **`notifyUvcDisconnected` фактически мёртв** (`MainScreen.kt:155-160` + `UsbViewModel.kt:72-81`):
   VM в `DeviceDetached` одним `copy()` зануляет `activeCameraId` И убирает девайс из списка;
   `LaunchedEffect(connectedDevices.size)` перезапускается уже на НОВОМ состоянии →
   `activeCameraId == null` → return ДО вызова. Единственный caller не вызывается никогда →
   `DeviceManager._uvcSources` копит фантомы (deviceId при replug новый), `activeVideoSource`
   залипает на мёртвом UVC.
2. **Ключ эффекта по РАЗМЕРУ списка** — detach+attach между рекомпозициями коалесцируются, size
   не меняется, эффект не перезапускается.
3. **`connectedDevices + event.device` без дедупа** (`UsbViewModel.kt:64-70`) — AUSBC шлёт дубли
   attach (register-энумерация + broadcast) → дубликаты девайса в state.
4. **`notifyUvcConnected` без дедупа** (`DeviceManager.kt:86-90`) — пересоздание композиции с тем же
   activeCameraId добавляет дубликат источника.
5. **`startMonitoring()` не идемпотентен** (`UsbDeviceRepositoryImpl.kt:64-101`) — повторный вызов
   (пересоздание MainActivity → onCreate → requestRequiredPermissions) затирает `multiCameraClient`
   без `unRegister()` старого → утечка USBMonitor-receiver + ДУБЛИ attach/permission-событий
   (вероятный вклад в bug 33).
6. Смежное: ДВА экземпляра UsbViewModel (activity-scoped в MainActivity:41 и route-scoped
   hiltViewModel в MainScreen:106) — работает случайно, onCleared любого стопит мониторинг для всех.

## Смежные утечки жизненного цикла камер (тот же кластер, чинится тем же планом)

- `UsbDeviceRepositoryImpl.kt:174` — `initCamera` перезаписывает `openCameras[deviceId]` без закрытия
  старого → утечка нативного UVC-хендла при connect-спаме.
- `CameraLayerOpeners.kt:93-116` — reopen фазы-2 зовёт `openCamera()` второй раз без close (по
  байткоду AUSBC первая нативная сессия не останавливается никогда) + `Thread.sleep(1500)` как
  тайминг + TOCTOU-дырка bug 31 (109-113).
- `DeviceCamera.kt:139-162` — Camera2: гонка close() vs onOpened → встроенная камера может остаться
  захваченной до убийства процесса.

## План фикса → **plans/11_usb_bridge_refactor.md**

Кратко: application-scoped коллектор `repository.events` → DeviceManager (мост ВНЕ Compose;
LaunchedEffect остаётся только для UI-реакций); дедупы по deviceId; идемпотентный startMonitoring;
один владелец UsbViewModel; последовательность open→OPENED→close→open(best) с кэшем best per-device
вместо sleep+reopen; @Volatile closed в DeviceCamera.

## Урок

→ `EXPERIENCE.md` EXP-0009: системную логику не вешать на жизненный цикл композиции.

## Статус
🔴 ОТКРЫТ (высокий). Найден аудитом; фантомы источников воспроизводимы hot-plug'ом.
