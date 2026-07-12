# Bug 38 — Ресиверы SET_VIRTUAL_CAM и SET_ORIENTATION экспортированы в release: любое приложение может уронить камеру во время эфира

> Заведён: 2026-07-12 (ревизия кода, аудит app; независимо подтверждён аудитом tools).
> Приоритет: ВЫСОКИЙ (безопасность). Полный отчёт: `researches/code_audit_2026-07-12.md`.

## Симптом / угроза

Любое стороннее приложение на устройстве, без каких-либо прав, может послать broadcast:
- `com.kriniks.kcam.SET_VIRTUAL_CAM` → `deviceManager.setVirtualCamera(false)` — **выключить
  камеру-слой прямо во время эфира**;
- `com.kriniks.kcam.SET_ORIENTATION` → крутить ориентацию Activity (активен при включённом
  dev-тумблере «ADB rotation», который доступен и в release через лонг-тап).

## Форензика

- `MainActivity.kt:93` — `registerVirtualCamControl()` вызывается в onCreate БЕЗУСЛОВНО (не под
  `BuildConfig.DEBUG`, в отличие от cmdReceiver на строке 94).
- `MainActivity.kt:322` и `:359` — оба регистрируются с `ContextCompat.RECEIVER_EXPORTED`.
- CMD-receiver (`com.kriniks.kcam.CMD`) корректно debug-only, но тоже EXPORTED в debug-сборке —
  осознать (умеет стрим/запись/жесты).

## План фикса (маленький, точечный)

- [ ] Свести SET_VIRTUAL_CAM и SET_ORIENTATION в существующий CMD-receiver (он лучше спроектирован)
      ИЛИ гейтить их `BuildConfig.DEBUG` так же, как cmdReceiver.
- [ ] ADB-путь при этом сохраняется: `am broadcast` от shell проходит и в NOT_EXPORTED с явным
      `-p <pkg>`? — НЕТ, для ADB-доставки в debug оставить EXPORTED допустимо; в release наружу не
      должно торчать НИ ОДНОГО exported receiver.
- [ ] Обновить `tools/ui.mjs` (ветки virtual-camera / orient), если action переезжает в CMD.
- [ ] Опционально: signature-permission как страховка для debug.

## Приёмка

`adb shell am broadcast -a com.kriniks.kcam.SET_VIRTUAL_CAM --ez enabled false` на **release**-сборке
→ никакой реакции; harness-команды ui.mjs на debug работают как раньше.

## Статус
🔴 ОТКРЫТ (высокий, фикс дешёвый — хороший кандидат в автономный пул).
