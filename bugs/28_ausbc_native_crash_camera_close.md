# Bug 28 — Нативный краш (SIGABRT) в AUSBC при ЗАКРЫТИИ 2K USB-камеры

**Статус:** 🔴 ОТКРЫТ — воспроизведён на живом устройстве Криника (2026-07-06 утро), 2K USB-камера.
**Версия:** debug 0.5 (32), Phase 3.
**Тип:** нативный краш в БИБЛИОТЕКЕ AUSBC (`com.serenegiant.usb.UVCCamera`), спровоцированный этой
конкретной noname 2K-камерой (связь с bug 25 — её проблемная негоциация).

## Симптом / репро

1. Приложение стартует (в DevSettings залипла виртуалка → активна виртуальная камера).
2. Подключена реальная 2K USB-камера → источник переключается virtual→UVC.
3. Негоциация 2K падает (`PreviewSize 640×480` → `result=-99 unsupported`), затем стартует на 640×360.
4. Вскоре камера ЗАКРЫВАЕТСЯ (AUSBC error-recovery / churn) → **нативный SIGABRT**, процесс умирает.

## Форензика (logcat -b crash, 09:56:06)

```
F libc  : Fatal signal 6 (SIGABRT) in tid <AUSBC HandlerThread>, pid niks.kcam.debug
#10 base.apk com.serenegiant.usb.UVCCamera.stopPreview
#14 base.apk com.serenegiant.usb.UVCCamera.close
#18 base.apk com.serenegiant.usb.UVCCamera.destroy
#22 base.apk com.jiangdg.ausbc.MultiCameraClient$Camera.closeCameraInternal
#26 base.apk com.jiangdg.ausbc.MultiCameraClient$Camera.handleMessage
```

Краш — на AUSBC-HandlerThread камеры, в НАТИВНОМ `UVCCamera.stopPreview/close/destroy`
(libUVCCamera.so). Т.е. AUSBC вызвал закрытие камеры, и нативный destroy этой камеры упал.
(Тот же стек ловили ночью 23:44 — воспроизводимо на закрытии 2K-камеры.)

## Root cause (гипотеза)

Нативный `UVCCamera.destroy` в AUSBC 3.2.7 **SIGABRT-ит при закрытии ЭТОЙ 2K-камеры** — вероятно,
после неудачной негоциации/в состоянии, где нативные ресурсы уже частично освобождены (double-free
или close на невалидном дескрипторе). Любой close этой камеры (свитч источника, поворот с
переоткрытием, отключение) рискует упасть. Провоцируется bug 25 (кривая негоциация 2K) + churn от
переключений источника.

Гипотеза Криника (подтверждена как усугубляющий фактор): старт на ВИРТУАЛКЕ → лишний свитч
virtual→UVC → лишний close-цикл → выше шанс поймать нативный краш. Для реальной камеры дебаг-виртуалку
надо гасить.

## План / митигации

- [x] **Персист виртуалки** (2026-07-06): CMD `virtual-camera off` теперь пишет в DevSettings →
      приложение не стартует на виртуалке после теста → нет virtual→UVC churn. (MainActivity.)
- [ ] **Снизить close-churn камеры:** §7 plans/02 (не переоткрывать камеру на повороте) — меньше
      закрытий = реже триггерим нативный краш.
- [ ] **Репорт апстрим:** завести issue в `jiangdongguo/AndroidUSBCamera` (gh) с этим стеком и
      VID/PID 0x2BCF/0x0281 (2K USB Camera) — нативный SIGABRT в UVCCamera.destroy после failed
      negotiation.
- [ ] **Проверить на ДРУГОЙ камере** (Emeet Piko+ / стандартная MJPEG-вебка): если не падает —
      подтверждает, что дело в этом конкретном 2K-модуле + AUSBC, а не в нашем коде.
- [ ] Обёртка close в try/catch НЕ помогает (нативный SIGABRT не ловится JVM). Единственный путь —
      не доводить камеру до крашащего close (меньше churn) + фикс/обход в библиотеке.

## Заметка
Приложение НЕ виновато в самом нативном падении (это AUSBC/libUVCCamera + железо камеры), но обязано
МИНИМИЗИРОВАТЬ закрытия камеры и не стартовать на виртуалке при реальной камере. Композитор-архитектура
Phase 3 уже держит стрим/запись живыми без подмены источника — осталось убрать переоткрытие на повороте.
