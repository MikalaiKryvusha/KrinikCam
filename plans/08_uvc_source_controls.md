# plans/08 — UVC-контролы источника (idea 36)

> Заведён: 2026-07-07. Приоритет Криника: MVP, «срочно, хотя бы в сыром виде» (Piko+ лагает, настроить
> нельзя). Реализация idea 36. Связано: idea 34 (модалка настроек слоя), CameraLayerOpeners (UVC).

## Что даёт AUSBC (проверено по seeds/proguard)

`MultiCameraClient.Camera` / UVCCamera (libuvc) отдаёт get/set на UVC-контролы:
Brightness, Contrast, Gain, Exposure (+ ExposureMode/Priority/Rel), WhiteBalance (+Auto), Saturation,
Sharpness, Hue, Gamma, Zoom (+Rel), Focus (+AutoFocus/Rel), BacklightComp, PowerlineFrequency.

Значения — int; диапазоны (min/max) в API явно не выражены (уточнить пробой/дескрипторами). Контролы
доступны ПОСЛЕ открытия камеры (как размеры превью, bug 25).

## Архитектура (пробрасываем управление слой→опенер→AUSBC)

Камера-опенер (`UvcCameraOpener`, :app) держит AUSBC-объект камеры. Нужен мост UI→опенер для чтения/
записи контролов:
- **Модель контрола** (доменная, :feature:capture/streaming): `CameraControl(id, label, type=SLIDER|
  TOGGLE, value, min, max, supported)`.
- **Интерфейс источника-контролов** на `CameraOpener` (или отдельный `CameraControls`): `list(): List<
  CameraControl>`, `set(id, value)`. UVC реализует через AUSBC get/set; Device/Virtual — пусто (нет UVC).
- Провод: UI (модалка слоя) → VM → repository → streamer → текущий opener (как onAspect/onOrientation,
  но в ОБРАТНУЮ сторону — команда set + запрос списка).

## Пошаговый план

- [ ] **S1. Мост + модель.** `CameraControl` DTO + метод у `UvcCameraOpener` «прочитать поддержанные
      контролы» (проба get на каждый; supported=успех) и «set(id,value)». AUSBC get/set.
- [ ] **S2. Проводка UI↔opener.** Через VM/repository/streamer достучаться до текущего UVC-опенера:
      `getCameraControls(): List<CameraControl>` и `setCameraControl(id, value)`.
- [ ] **S3. UI «Настройки источника»** в модалке настроек слоя (idea 34): для камера-слоя, если источник
      UVC и есть контролы — раздел с ползунками (SLIDER) / тоглами (TOGGLE), set вживую. Динамически по
      списку из S1 (только поддержанные).
- [ ] **S4. Диапазоны.** Если AUSBC отдаёт min/max — использовать; иначе дефолт на контрол (напр. gain/
      exposure 0–100, WB как есть). Уточнить эмпирически на Piko+.
- [ ] **S5. Verified на живой Piko+** — снизить gain/exposure, увидеть эффект на превью (убрать лаг/серый
      кадр Криника). Харнес-команда `ui.mjs cmd cam-control <id> <value>` для теста без рук (доб. в CMD).

## Риски / заметки

- Контролы читаются ПОСЛЕ open камеры (chicken-and-egg как bug 25) — запрашивать список после
  PreviewStarted.
- Не все камеры отдают все контролы — динамика обязательна (не хардкодить набор).
- Осторожно с потоками: AUSBC get/set — возможно, требуют своего потока (как open). Оборачивать безопасно.
- Персист (сохранять значения на камеру/профиль) — вне MVP, отдельно.
