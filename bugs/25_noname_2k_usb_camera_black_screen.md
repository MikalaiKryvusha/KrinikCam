# Bug 25 — Чёрный экран вместо видео с noname «2K USB Camera»

**Статус:** 🔴 ОТКРЫТ — репорт Криника, ждёт репро на новом едином пайплайне (Phase 3).
**Версия:** установленный билд на момент репорта ~0.5 (32), СТАРЫЙ двойной пайплайн (до Phase 3).
**Дата:** 2026-07-05 (вечер).

## Симптом (со слов Криника)

Подключил к планшету ДРУГУЮ вебку (не Emeet Piko+) — видео нет, чёрный экран вместо потока.

## Устройство-камера (снято агентом по ADB, dumpsys usb)

- `product_name=2K USB Camera`, `manufacturer_name=04014008_P040300_SN0002` (noname 2K-модуль).
- VID/PID уточнить при репро (`adb shell dumpsys usb`).

## Контекст

- Репорт пришёл ВО ВРЕМЯ работ Phase 3 (plans/02): старый legacy-путь (SurfaceFilterRender)
  сносится, камера всегда идёт слоем нашего GL-композитора. Диагностировать чёрный экран на
  старом билде смысла мало — сначала перепроверить на новом.
- Похожие открытые симптомы на физических камерах: bug 24 (Emeet: фриз первого кадра при
  compositor on, оживает после поворота устройства) — возможно общий корень (открытие камеры в
  SurfaceTexture слоя / negotiation формата).

## Форензика (снята 2026-07-06, logcat старта приложения с воткнутой 2K-камерой)

VID=11231 (0x2BCF) PID=641 (0x0281), class 239/2/1 (UVC), `mHasVideoCapture=true`.
USB attach → permission granted → `UvcCameraOpener.open(1920x1080)` → **нативная негоциация падает:**

```
E/UVCCamera: [UVCCamera.cpp:172:connect]: could not open camera:err=-99
E/UsbDeviceRepository: open failed:result=-99 ... venderId=11231;productId=641
E/UsbDeviceRepository: Camera error: unsupported preview size
I/libUVCCamera: [UVCPreview.cpp:285]: PIXEL_FORMAT_YUV20SP
E/libUVCCamera: [UVCPreview.cpp:524:prepare_preview]: could not negotiate with camera:err=-9
I/UsbDeviceRepository: USB disconnected → Camera closed
```

## Root cause (ПОДТВЕРЖДЁН — гипотеза 1)

Наш `UvcCameraOpener` жёстко просит превью **1920×1080** (`CameraRequest.setPreviewWidth/Height`).
Noname «2K USB Camera» этот размер в YUV НЕ поддерживает → `err=-99 unsupported preview size` →
`could not negotiate err=-9` → камера закрывается → **чёрный экран**. «То чёрный, то работает» =
негоциация иногда проходит на повторной попытке AUSBC (в Phase 3-прогонах 2026-07-06 камера в итоге
ожила и дошла до композитора — см. plans/02 §5).

Опасный побочный эффект: при закрытии камеры в этом состоянии ловили нативный SIGABRT в
`UVCCamera.stopPreview/close/destroy` (crash-буфер 2026-07-05 23:44) — процесс умирал.

## План фикса

- [ ] `UvcCameraOpener`: перед `openCamera` читать поддерживаемые размеры (AUSBC
      `getAllPreviewSizes`/`getSuitableSize`) и выбирать ближайший к 1920×1080 поддерживаемый (или
      MJPEG-режим, если YUV нет), вместо жёсткого хардкода.
- [ ] Зафиксировать поддерживаемые режимы 2K-камеры в этом доке (снять `getAllPreviewSizes`).
- [ ] Проверить нативный краш на close при неудачной негоциации (guard/задержка перед close).
- Приоритет: ПОСЛЕ Phase 3 (единый пайплайн). Не блокирует — Phase 3 верифицирован живой камерой.
