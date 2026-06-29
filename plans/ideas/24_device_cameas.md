Реализуем работу с камерами устройства.
Находим их все, перечисляем - их можно добавиться на слои как медиа источник - это позволит работать с использованием селфи камеры автономно ИИ агенту наз идеей 21.

---

## Статус (ночь 2026-06-30, /nightloop)

🟡 ЧАСТИЧНО. Сделано:
- **Перечисление камер устройства (Camera2)** — `DeviceCameraEnumerator.enumerate()` →
  `List<VideoSource.PhoneCamera>` (фронт/тыл/прочие), регистрируется в `DeviceManager` на старте.
  Приоритет источников сам поднимает телефонную камеру, если нет USB и виртуалки.
- **`DeviceCameraOpener` (Camera2)** — открывает выбранную камеру устройства в SurfaceTexture
  слоя-камеры (как `RtmpStreamer.CameraOpener`). Проводка: `MainScreen` (PhoneCamera → opener +
  GL-превью), `DeviceManager.selectPhoneCamera(front/back)`, CMD `ui.mjs cmd device-camera front|back|off`.

🔴 БЛОКЕР: при открытии Camera2 в SurfaceTexture слоя — `IllegalArgumentException: Surface was abandoned`
(поверхность слоя-`SurfaceFilterRender` пересоздаётся при реините GL). Это часть общего блокера
**bug 18** (камера-как-`SurfaceFilterRender`-слой нестабильна с RootEncoder). Зависит от архитектурного
решения по Idea 21 (см. `bugs/18_*`; рекомендация — вернуть камеру в базу). Перечисление камер и opener
останутся полезны при варианте «свой GL-композитор».