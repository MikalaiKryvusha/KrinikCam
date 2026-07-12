# План 12 — Release-гигиена и защита данных юзера (фикс bug 37)

> Чинит **bugs/37** (высокий). Почти всё автономно; п. S2 (release keystore) требует решения
> Криника — interview_009 Q3.

## S1 — Room по-взрослому (до второй таблицы!)

- `exportSchema = true` + `room.schemaLocation` (каталог `data/profiles/schemas/` в git).
- Убрать `fallbackToDestructiveMigration()`; заготовка `MIGRATION_1_2` (пока пустая, как образец) +
  правило в комментарии: «бамп version только с миграцией».
- `StreamProfileEntity.toModel`: `runCatching { StreamPlatform.valueOf(...) }.getOrDefault(CUSTOM)`.

## S2 — Подпись release (✅ interview_009 Q3=A: агент генерирует, Кринику — инструкция-домашка)

Keystore: `~/keystores/krinikcam.keystore` (ВНЕ репо), пароль в `keystore.properties` в корне репо
(gitignored); `signingConfigs.release` из свойств с фолбэком на debug при отсутствии файла (чтобы
чужая машина собирала debug-подписанный RC с WARNING в логе сборки). Инструкция по бэкапу для
Криника — `homeworks/06_keystore_backup.md` (потеря = конец обновлений).

## S3 — Секреты в логах

Хелпер `redactRtmp(url)` в core:logging (ключ → last-4); применить во всех лог-путях RtmpStreamer
(:514-516, :550-551, ~199) и на будущее — правило в AGENT_GUIDE «URL с ключом в лог только через
redactRtmp».

## S4 — versionCode и версии

`app/build.gradle.kts:41` → `major*1_000_000 + minor*10_000 + build` (до взрыва старой формулы
~87 коммитов). Монотонность при переходе сохраняется: старая формула для 0.6 (13) даёт 614, новая —
60_013 > 614, апдейт встанет. Зафиксировать это сравнение комментарием у формулы.

## S5 — RTMP-дефолты и импорт/экспорт

- Выверить дефолтные ingest-URL по актуальным докам платформ: Twitch `rtmp://live.twitch.tv/app`,
  YouTube ок, Instagram/TikTok — либо честный «требуется свой URL» (CUSTOM-подсказка), либо убрать
  кривые пресеты (сейчас Instagram указывает на Facebook-endpoint, TikTok — несуществующий).
- Экспорт/импорт профилей: I/O в `Dispatchers.IO` (ViewModel), дедуп при импорте по
  (platform,rtmpUrl,streamKey); предупреждение в UI «файл содержит секретные ключи».
- Удаление профиля: подтверждающий диалог (сейчас корзина = мгновенная безвозвратная потеря ключа) +
  чистка висячего activeProfileId.

## S6 — Приёмка

Сборка обеих конфигураций; юнит на valueOf-фолбэк; ручной прогон экспорт→импорт без дублей;
`tools/smoke.mjs` PASS; grep логов эфира — ключей нет.

## Статус
📋 План готов (2026-07-12, из ревизии). Реализация не начата. S1/S3/S4 — быстрые и автономные
(кандидаты в автономный пул), S2 ждёт Криника, S5 — полдня.
