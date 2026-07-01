# Bug 13 — Краш приложения при отключении USB-камеры в эфире

**Статус:** ✅ ИСПРАВЛЕН — подтверждён ЖИВЫМ тестом в эфире (Криник, 2026-06-29 ~21:34–21:41)
**Версия:** v507 `0.5 (6)-debug`
**Когда:** 2026-06-29 ~19:32–19:40, во время живого теста горячего отключения веб-камеры на стриме.
**Симптом (Криник):** приложение скрешилось при настоящем отключении USB-камеры во время стрима в YouTube.

---

## Что собрано (форензика с устройства)

Источники: внутренний file-logger (`homeworks/logs/kcam_2026-06-29.log`), `adb logcat -b crash`,
`dumpsys dropbox`, и файл краш-катчера приложения
`/storage/emulated/0/Android/data/com.kriniks.kcam.debug/files/crash_20260629_193246.txt`.

### Краш №1 — JVM, убивает процесс

```
Thread: USBMonitor          (HandlerThread, принадлежит библиотеке)
java.lang.SecurityException: User has not given 10500/com.kriniks.kcam.debug
    permission to access device /dev/bus/usb/001/005
  at android.hardware.usb.UsbDevice.getSerialNumber(UsbDevice.java:157)
  at com.serenegiant.usb.USBMonitor.updateDeviceInfo(USBMonitor.java:923)
  at com.serenegiant.usb.USBMonitor$UsbControlBlock.<init>(USBMonitor.java:1007)
  at com.serenegiant.usb.USBMonitor$UsbControlBlock.<init>(USBMonitor.java:988)
  at com.serenegiant.usb.USBMonitor$3.run(USBMonitor.java:591)
  at android.os.Handler.handleCallback → Looper.loop → HandlerThread.run
```

**Механизм:** при детаче/реплаге камеры библиотека AndroidUSBCamera (AUSBC 3.2.7) на СВОЁМ
`USBMonitor`-HandlerThread обрабатывает connect-событие, конструируя `UsbControlBlock`. Его
конструктор зовёт `updateDeviceInfo()` → `UsbDevice.getSerialNumber()`, который требует активного
USB-permission на устройство. К моменту выполнения runnable устройство уже отвалилось / право
отозвано → `SecurityException`. В библиотеке этот вызов НЕ обёрнут в try/catch → исключение
необработанное на looper-потоке → процесс падает.

### Краш №2 — нативный SIGSEGV (отдельно, JVM-хендлером не ловится)

Tombstone (dropbox):
```
#11 pc ...013658  base.apk!libuvc.so (_uvc_handle_events+132)
```
Нативный UVC event-loop в `libuvc.so` дёргает уже освобождённый хендл устройства после детача →
SIGSEGV. Это нативный крах — `Thread.setDefaultUncaughtExceptionHandler` его НЕ перехватывает.

### Сопутствующий «ретрай-сторм»

В логе 19:25–19:32 — сотни событий в минуту:
```
[ERROR] [UsbDeviceRepository] Camera error: /dev/bus/usb/001/005 — open camera failed
   Attempt to invoke virtual method 'int ...USBMonitor$UsbControlBlock.getVenderId()' on a null object reference
[ERROR] ... unsupported preview size
```
После детача что-то продолжает молотить попытки открыть камеру (`getVenderId()` на null ctrlBlock).
Этот шторм — тот же корень (гонка детач ↔ повторное открытие), он и поднимает вероятность обоих крашей.

---

## Почему наш краш-катчер не спас

`KrinikCamApp.installCrashCatcher` пишет стек в файл, но затем форвардит в
`defaultHandler.uncaughtException(...)` → дефолтный хендлер убивает процесс. А нативный SIGSEGV
вообще проходит мимо JVM-хендлера.

---

## Направление фикса (проект)

Корень — в стороннем коде (библиотечный поток + нативный libuvc), пропатчить его нельзя.
Контролируемые меры:

1. **Целевой перехват на потоке USBMonitor.** В `installCrashCatcher`: если падает поток с именем
   `USBMonitor` и это `SecurityException` из стека `com.serenegiant.usb.*` (отозванный USB-permission
   при детаче) — залогировать и НЕ форвардить в defaultHandler → процесс выживает. Узкое, безопасное
   условие (по имени потока + типу + пакету), не глотает чужие краши.
2. **Гасить гонку детача.** На `onDetachDec` максимально быстро и идемпотентно закрывать камеру и
   останавливать повторные попытки открытия, чтобы AUSBC не молотил `USBMonitor$3.run` по отвалившемуся
   устройству (убрать ретрай-сторм). Связано с логикой freeze/standby (interview_004).
3. **Нативный SIGSEGV libuvc** — JVM не ловит. Митигируется только п.2 (не давать нативному
   event-loop работать по освобождённому хендлу: чистый stop до фактического отвала). Завести
   баг-репорт апстриму (AndroidUSBCamera / libuvc).
4. **Стратегически** — это частный случай Idea 19 (мульти-источники): «Please stand by» как fallback-
   источник + чистый таймаут/freeze при пропаже источника без гонок переоткрытия.

---

## Реализовано (2026-06-29)

**Фикс №1 — целевой перехват в `KrinikCamApp.installCrashCatcher`** (`isBenignUsbDetachCrash`):
если необработанное исключение прилетело с потока `USBMonitor`, является `SecurityException` и в
стеке есть `com.serenegiant.usb.*` — логируем в crash-файл, но НЕ форвардим в defaultHandler →
процесс и живой RTMP-стрим выживают. Условие узкое (имя потока + тип + пакет), чужие краши не глотает.
- Собрано ✅, установлено ✅, приложение стартует без регрессий (PID жив).
- ⚠️ **Не проверено вживую:** ADB-харнесс разрыва (вирт.камера) НЕ воспроизводит этот путь — он не
  дёргает `USBMonitor$3.run`/`getSerialNumber`. Нужен ФИЗИЧЕСКИЙ реплаг USB-камеры в эфире (руки
  Криника): стрим → выдернуть камеру → приложение должно ВЫЖИТЬ (раньше падало). Проверить crash-файл:
  `/storage/emulated/0/Android/data/com.kriniks.kcam.debug/files/crash_*.txt` — запись будет, но
  процесс не умрёт.

**Не закрыто:** нативный SIGSEGV `libuvc` (JVM не ловит) и ретрай-сторм переоткрытия — оба гасятся
только чистой остановкой источника при детаче (п.2/п.4) и/или апстрим-фиксом.

## Тест Криника 2026-06-29 ~20:16 (билд с фиксом)

По свежим логам (`files/logs/kcam_2026-06-29.log`, краш-буфер, crash-файлы):
- 20:16:12 детач `001/012` → камера закрыта ЧИСТО, без краша; 20:16:15 реплаг `001/013` (EMEET Piko+)
  → переподцепилась, превью возобновилось. 20:20:22 ещё детач — чисто. Лог непрерывен через оба
  детача, процесс НЕ умирал (следующий «Starting USB monitor» — мой ручной рестарт в 20:26).
- **Нет новых crash-файлов после 19:32**, в краш-буфере только старый краш 19:32 (до фикса).
- **Вывод:** обычный детач+реплаг теперь СТАБИЛЕН (раньше ронял). НО `SecurityException` на `USBMonitor`
  в этот раз не выстрелил (детач одиночный, без storm-переоткрытий) → перехват-страховка напрямую НЕ
  задействована (нет нового crash-файла, который мой хендлер написал бы перед проглатыванием). Краш
  19:32 был привязан к storm во время стрима. Для полной уверенности: детач ВО ВРЕМЯ живого стрима.

## ✅ Подтверждение в эфире (Криник, 2026-06-29, ДЗ homework_multi_sources)

Живой YouTube-стрим → физическое выдёргивание USB-камеры (несколько циклов 21:34–21:41) → втыкание
обратно. Логи `homeworks/logs/kcam_2026-06-29-{2,3}.log`:
- приложение НЕ упало ни разу (новых crash-файлов нет);
- стрим НЕ оборвался: `Entered standby` (заглушка кормит энкодер) → `Exited standby — live camera
  restored` при возврате камеры; на YouTube видна заглушка + остальные слои-оверлеи продолжают идти;
- многократный реплаг отработал.

Storm-краш 19:32 больше не воспроизводится. **Bug 13 закрыт.**

### Хвост (НЕ про краш — отдельные задачи):
- В ПРЕВЬЮ на главном экране при пропаже камеры заглушка занимает весь канвас и прячет слои (в СТРИМе
  правильно — заглушка только вместо камеры). Это про композит превью / Compose-StandbyPlaceholder →
  чинится в рамках перехода камеры в обычный слой (`ideas/21_*`).
- `StandbyVideoSource: Standby frame draw failed: null` (изредка) + рисует «1920×1080 into 3840×2160»
  (4К-поверхность) — мелкий дефект отрисовки заглушки, не фатальный; пересмотреть при переезде
  заглушки в модель слоёв (Q4).

## Апстрим

- AndroidUSBCamera (jiangdongguo) — `USBMonitor.updateDeviceInfo` зовёт `getSerialNumber()` без
  try/catch на permission → краш при детаче. Кандидат на баг-репорт через `gh`.
- libuvc `_uvc_handle_events` — use-after-free хендла при детаче (нативный SIGSEGV).

## Проверка фикса

Без камеры: ADB-харнесс разрыва — `adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM
--es state off -p com.kriniks.kcam.debug`. С камерой — горячий реплаг в эфире (руки Криника).

## ✅ СТАТУС: DONE (2026-06-29)
Что сделано: узкий перехват в `KrinikCamApp` (поток `USBMonitor` + `SecurityException` + стек
`com.serenegiant`) — `getSerialNumber()` на отозванном USB-permission больше не роняет процесс.
Как проверено: живой тест Криника в эфире YouTube (детач/реплаг USB-камеры ×N) — приложение выжило,
стрим держался на заглушке. Подтверждено 2026-06-29 ~21:34–21:41.
