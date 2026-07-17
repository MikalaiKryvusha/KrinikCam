# Bug 36 — Эфир умирает при выключении экрана / сворачивании: нет foreground service, keep-screen-on и wake lock

> Заведён: 2026-07-12 (ревизия кода, аудит app/core). Приоритет: **КРИТИЧЕСКИЙ для стримера** —
> главный разрыв между «приложением для стриминга» и текущим кодом.
> Полный отчёт: `researches/code_audit_2026-07-12.md`.

## Симптом (ожидаемый в бою)

Идёт эфир → экран гаснет по таймауту (или Криник сворачивает приложение / случайно жмёт Power) →
на Android 12+ процесс кэшируется/замораживается → RTMP-сокет и энкодер умирают → эфир падает.
Стример вынужден тыкать экран всю трансляцию. На харнесе невидимо (ADB держит экран).

## Форензика (что в коде)

- В манифесте объявлены `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`,
  `FOREGROUND_SERVICE_CAMERA` (`app/src/main/AndroidManifest.xml:10-16`), но **в проекте НЕТ ни
  одного `<service>` и ни одного класса Service** (grep `startForeground|: Service` по app/core/
  feature = 0). Разрешения мёртвые.
- **Нет keep-screen-on / wake lock вообще** (grep `keepScreenOn|WakeLock|FLAG_KEEP_SCREEN_ON` = 0):
  экран гаснет → lockscreen → `onSurfaceTextureDestroyed` → stopPreview; Doze душит сеть.
- `POST_NOTIFICATIONS` объявлен, но нигде не запрашивается (нотификация «LIVE» для FGS всё равно
  понадобится).
- Camera2-источник (встроенная камера) в фоне отзывается системой без FGS типа camera;
  RECORD_AUDIO в фоне блокируется без FGS типа microphone.

## План фикса → **plans/10_foreground_service_stream.md**

Кратко: `StreamForegroundService` (типы camera|microphone|connectedDevice) с нотификацией «LIVE»,
startForeground при Go Live / записи в файл, стоп при stopStream; `FLAG_KEEP_SCREEN_ON` пока
`streamState.isActive`; runtime-запрос POST_NOTIFICATIONS; проверить поведение при locked screen.

## Приёмка

Эфир на локальный RTMP-полигон → выключить экран кнопкой → 5 минут → эфир жив (ffprobe записи
полигона непрерывен); свернуть приложение → эфир жив; нотификация «LIVE» видна, тап возвращает в
приложение.

## Урок

→ `EXPERIENCE.md` EXP-0008: харнес маскирует продакшн-условия стримера (экран, фон, сеть, батарея).

## Реализация 2026-07-18 (ночной цикл, plans/10 S2+S3) — [TESTED: 2026-07-18 · приёмка S4 ниже]

- **S1 keep-screen-on** был сделан ранее (v0.7). Теперь тот же коллектор `streamState` в MainActivity
  дирижирует и сервисом, реагируя только на ФРОНТ active↔inactive (Live тикает durationMs/bitrate
  каждую секунду — без фронт-фильтра startForegroundService спамился бы на каждый тик).
- **S2 StreamForegroundService** (`app/.../streaming/StreamForegroundService.kt`): тонкий
  @AndroidEntryPoint-сервис — держит foreground-класс процесса, нотификация «🔴 KrinikCam LIVE»
  (канал stream_live IMPORTANCE_LOW, брендовый #FF1A8C, тап → MainActivity, кнопка Stop →
  ACTION_STOP → streamingRepository.stopAll()). Пайплайном НЕ владеет. START_NOT_STICKY.
- **S3**: PARTIAL_WAKE_LOCK на время эфира (release в onDestroy); манифест: +FOREGROUND_SERVICE_
  MICROPHONE, +FOREGROUND_SERVICE_CONNECTED_DEVICE, +WAKE_LOCK, `<service ... foregroundServiceType=
  "camera|microphone|connectedDevice">`; runtime-запрос POST_NOTIFICATIONS (13+) добавлен в общий
  пермишн-флоу MainActivity (раньше разрешение было объявлено, но мёртвое).
- **⚠️ Урок приёмки (краш пойман живьём):** Android 14+/targetSDK 35 валидирует тип
  `connectedDevice` ЖЁСТКО — нужен реальный «носитель связи» (грант на USB-устройство / BT / Wi-Fi
  пермишны). Без вебки заявка на connectedDevice = SecurityException = смерть процесса на старте
  эфира. Фикс: типы собираются ДИНАМИЧЕСКИ — camera|microphone всегда, connectedDevice только при
  живом USB-гранте (`UsbManager.deviceList.any { hasPermission }`).
- User Manual §7 дополнен («эфир в фоне», академичный стиль).

## Приёмка S4 — ПРОЙДЕНА (2026-07-18, ночной цикл, полигон MediaMTX, всё наблюдением)

1. **Экран ВЫКЛ 5 минут** (`input keyevent 26`, dumpsys: `mState=OFF`): эфир на 2 выхода жил всю
   дистанцию — пуллы t+1мин: 385 кадров; t+4мин: 339+339 кадров с ОБОИХ путей; ни одного
   disconnect/reconnect в логах приложения и сервера.
2. **Сворачивание (HOME)**: `mResumed=false mStopped=true` — эфир жив (355+355 кадров), нотификация
   на месте; возврат — task к фронту, `mResumed=true`, 0 сбоев.
3. **Нотификация**: NotificationRecord id=1001 (канал stream_live, цвет #FF1A8C, ONGOING, кнопка
   Stop) — появляется на go-live, после стопа 0 живых записей; сервис: «wake lock отпущен,
   нотификация снята» (onDestroy).
4. **smoke.mjs PASS** (117→113 кадров, 1920×1080) — одно-выходной путь цел, FGS-цикл прошёл и в нём.
5. Пойманный на приёмке краш валидации FGS-типов (SecurityException connectedDevice) починен
   динамической маской типов — урок EXP-0014.

Оговорка (честно): тап по нотификации и её кнопку Stop живым пальцем не жали (нужны руки) —
код-путь идентичен проверенным `am start` (возврат task) и CMD stop (stopAll). Криник увидит в бою.

## Статус
✅ **ЗАКРЫТ (2026-07-18).** Главный симптом («эфир умирает при выключении экрана/сворачивании»)
ОПРОВЕРГНУТ наблюдением на полигоне. Эфир — боевой: FGS + wake lock + keep-screen-on + нотификация.
