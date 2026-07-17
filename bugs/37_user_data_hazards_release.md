# Bug 37 — Тикающие бомбы данных юзера: destructive-миграция Room, debug-подпись release, stream-ключи в логах, переполнение versionCode

> Заведён: 2026-07-12 (ревизия кода, аудит data/gradle). Приоритет: ВЫСОКИЙ —
> ни одна не стреляет сегодня, каждая гарантированно стреляет позже и бьёт по данным Криника.
> Полный отчёт: `researches/code_audit_2026-07-12.md`.

## Четыре дефекта

### 1. `fallbackToDestructiveMigration()` — потеря всех профилей при первом же бампе версии БД
`data/profiles/.../di/ProfilesModule.kt:27` (+ `AppDatabase.kt:21` `exportSchema = false`).
БД `kcam_db` хранит stream_profiles со stream-ключами; version=1. Первое же изменение схемы
(плановые device_profiles/overlay_presets) молча сотрёт все настроенные платформы.
**Фикс:** `exportSchema = true` + каталог схем + настоящая `Migration(1,2)`; до тех пор НЕ бампить
version.

### 2. Release подписан debug-ключом — обновление сломается при смене машины сборки
`app/build.gradle.kts:58`: `signingConfig = signingConfigs.getByName("debug")`. Релизы в GitHub
Releases подписаны локальным debug-ключом этой машины. Сборка на другой машине = другой ключ =
«app not installed» при обновлении → юзер удаляет приложение → с дефектом №1 теряет все профили.
**Фикс:** настоящий release keystore + `keystore.properties` (gitignored). ⚠️ Генерация и хранение
ключа — решение Криника (interview_009): потеря ключа = невозможность обновлений навсегда.

### 3. Stream-ключи логируются открытым текстом — угон эфира
`RtmpStreamer.kt:514-516,550-551,~199`: `KLog.i(TAG, "... → $rtmpUrl")` — полный URL с секретным
ключом уходит в logcat И в персистентный FileLogger-файл, который по гайду пуллится и прикладывается
к баг-репортам/ДЗ. Утечка ключа = кто угодно стримит в канал Криника.
**Фикс:** центральный `redactRtmp(url)` (ключ → `•••`/last-4) во всех лог-путях.

### 4. versionCode переполняется на build ≥ 100
`app/build.gradle.kts:41`: `major*10000 + minor*100 + build + 1`; commit.mjs бампает build каждый
коммит (сейчас 0.6 (13)). 0.6 (100) даёт versionCode 701 == 0.7 (0); дальше «даунгрейд» — обновление
не встанет. До взрыва ~87 коммитов.
**Фикс:** `major*1_000_000 + minor*10_000 + build`.

## Смежное (тем же планом, ниже приоритетом)

- `StreamProfileEntity.kt:30` — `StreamPlatform.valueOf` крашит весь Flow профилей на неизвестном
  значении → `runCatching`+CUSTOM.
- Кривые дефолтные RTMP-URL (`StreamProfile.kt:42`): Twitch `/live` (канон `/app`), INSTAGRAM =
  endpoint Facebook, TikTok — несуществующий generic → выверить по докам платформ.
- Экспорт/импорт профилей: I/O на main thread (ANR на сетевом SAF); повторный импорт дублирует.
- Ключи открытым текстом в БД/экспорт-JSON — осознанный компромисс (allowBackup=false), но
  рассмотреть Android Keystore.

## План фикса → **plans/12_release_hygiene.md**

## Урок

→ `EXPERIENCE.md` EXP-0007: dev-дефолт с последствиями для данных юзера фиксируй тикетом в момент
создания.

## Фикс 2026-07-18 (ночной цикл, build 0.7(10)) — №1, №3, №4 [TESTED: 2026-07-18 · приёмка ниже]

- **№1 Room**: `fallbackToDestructiveMigration()` УБРАН (ProfilesModule) + `exportSchema=true` +
  `ksp room.schemaLocation` → `data/profiles/schemas/**/1.json` закоммичена. Теперь изменение схемы
  без явной Migration уронит старт (заметно в первом тесте), а не данные Криника.
- **№3 Редакция ключей**: `RtmpRedact.redactRtmpUrl()` (последний сегмент → `•••`+2 последних, или
  `••••` для коротких) вшита во ВСЕ лог-точки URL: RtmpStreamer `connecting`/`out[i]` +
  MainActivity `CMD go-live-rtmp`.
- **№4 versionCode**: формула → `major*1_000_000 + minor*10_000 + build + 1`; скачок 710→70010
  безопасен (вверх), 10 000 билдов на minor — таймер обезврежен (оставалось ~91 коммит).

**Приёмка (наблюдением):** dumpsys `versionCode=70010`; `schemas/1.json` сгенерирована; живой
полигон-прогон — в логе `…/live/••••` и `…/live/•••t2` в обеих точках + CMD-строке, сырых ключей в
свежих строках 0 (контраст со строкой 01:06 старого билда — там ключи открыты); smoke PASS
(Room без фолбэка стартует, пайплайн цел).

## №2 keystore — ПОДКЛЮЧЁН (2026-07-18, той же ночью) [TESTED: apksigner]

Ключ был сгенерирован ещё 12.07 (interview_009 Q3=A, ДЗ-06 на бэкап выдано), но gradle оставался на
debug-подписи. Подключено: `signingConfigs.release` из `keystore.properties` (gitignored) с честным
фолбэком на debug-подпись + WARNING на машине без ключа. **Приёмка apksigner:** release →
`CN=KrinikCam, OU=KOT KRINIK, L=Minsk` (настоящий ключ), debug → `CN=Android Debug`. Также закрыт
valueOf-краш профилей (runCatching → CUSTOM) + образец MIGRATION_1_2 + правило redactRtmpUrl в
AGENT_GUIDE. ⚠️ Переход: у кого стоял debug-подписанный release v0.7 — одно обновление потребует
переустановки (разные подписи), дальше вечная совместимость.

## Статус
🟡 №1/№2/№3/№4 ЗАКРЫТЫ (2026-07-18). Остаток «Смежное»: дефолтные URL платформ (Twitch/app,
Instagram/TikTok — кривые), импорт/экспорт (main thread, дедуп, диалог удаления) — plans/12 S5;
бэкап ключа — ДЗ-06 Криника (не блокирует код).
