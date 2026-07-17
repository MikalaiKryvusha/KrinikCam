# План 13 — Локализация: английский дефолт + русская локаль (interview_009 Q2=A)

> Решение Криника 2026-07-12: канон языка UI — **EN дефолт** (`values/strings.xml`) + **RU локаль**
> (`values-ru/strings.xml`), обе сразу. Закрывает массовое нарушение конвенции Idea 14, найденное
> ревизией (UI говорит на двух языках вперемешку). Полностью автономная задача (проверка — dump/скрин
> + смена локали `adb shell am start -a android.settings.LOCALE_SETTINGS` не нужна: forceLocale через
> `adb shell settings`/per-app locale). Хороший груз для автономных циклов, можно частями.

## Принципы (из AGENT_GUIDE / Idea 14)

- Выносим ТОЛЬКО user-facing текст; KLog-теги, технические константы, CMD-actions — НЕ трогаем.
- `stringResource(R.string.x)` только в @Composable-скоупе; для лямбд — резолвить заранее.
- Плюрализация — `plurals` (аудит: ручная «platform(s)» в SettingsScreen:116).
- User Manual: контент-модель остаётся, но строки через ресурсы (учтено в plans/06; можно этапом B).

## S1 — Инвентаризация и каркас

`values/strings.xml` уже существует (SettingsScreen/DevMenuScreen/RotationMenu сконвертированы).
Создать `values-ru/strings.xml` с переводами существующих ключей. Прогнать grep по хардкодам
(список из аудита): MainScreen (231, 419-451, 509, 543), FloatingRadialMenu (65-71),
StreamPlatformsOverlay (целиком), снэкбары StreamViewModel (RU/EN вперемешку), SettingsScreen
(116, 147-152, 249-256, 386-389).

## S2 — Конверсия по файлам (маленькими коммитами)

Порядок: FloatingRadialMenu → MainScreen → StreamPlatformsOverlay → снэкбары StreamViewModel
(строки из VM — через UiText/resId, НЕ Context в VM) → SettingsScreen остатки → feature-модули.
Каждый файл: EN-ключ + RU-перевод сразу.

## S3 — User Manual (этап B, большой)

Секции руководства → string-ресурсы (или структурированные ресурсы по секциям), RU-перевод.
Отдельными коммитами, после S2.

## S4 — Приёмка

Сборка; `ui.mjs dump` на EN-локали — русских строк в дереве нет; per-app locale ru (Android 13+:
`adb shell cmd locale set-app-locales com.kriniks.kcam.debug --locales ru`) — UI по-русски;
smoke PASS.

## Статус
🔄 **S1+S2+S4 СДЕЛАНЫ (2026-07-18, ночной цикл, коммиты 2a4c171+1560876):**
- app-модуль: FloatingRadialMenu, MainScreen, SettingsScreen (вкл. plurals для «N платформ»),
  values-ru со всеми переводами. feature:streaming: свой res (≈40 ключей EN+RU), оба оверлея
  целиком, снэкбары VM → **UiText** (Res+args, резолв в UI — Context из VM изгнан).
- **S4-приёмка наблюдением:** per-app locale en → dump 0 русских («Rotate video/Menu/Layers»);
  locale ru → «Повернуть видео/Меню/Слои», оверлей платформ по-русски целиком; override сброшен
  (система планшета ru → UI русский); smoke PASS.
**Остаток:** S3 — User Manual (11 секций, этап B, большой отдельный заход) + хвост: displayName
ИСТОЧНИКОВ приходят из данных `:feature:capture` (DeviceCameraEnumerator: «Селфи-камера (id 1)» —
русский хардкод в данных, нужен отдельный заход по модели SourceOption).
