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

## Статус
🔴 ОТКРЫТ (высокий). №4 — таймер на ~87 коммитов; №2 требует решения Криника по ключу (interview_009).
