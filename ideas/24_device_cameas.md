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

## ✅ Обновление (dayloop, утро 2026-06-30) — БЛОКЕР СНЯТ GL-композитором (Idea 25)

Реальная встроенная камера (Camera2) **доходит до энкодера через наш GL-композитор**: `cmd compositor
on` + `cmd device-camera back` + запись → файл 1.3 МБ с реальной сценой. Старый «Surface abandoned»
(bug 18, путь `SurfaceFilterRender`) больше НЕ возникает — компоновщик сам владеет OES SurfaceTexture
слоя-камеры, opener (`DeviceCameraOpener`) пишет в неё. Встроенные камеры = рабочий автономный реальный
источник для ИИ-агента (модель Idea 21/25). **Осталось:** поворот сенсора (камера приходит повёрнутой
на 90° — `SENSOR_ORIENTATION` не применяется, см. `bugs/19_*`) и «добавление камер как медиаисточников
в слои» из UI (несколько камер — естественно ложится на модель слоёв композитора). Поворот сцеплён с
моделью ориентации (`interviews/interview_006_*`).