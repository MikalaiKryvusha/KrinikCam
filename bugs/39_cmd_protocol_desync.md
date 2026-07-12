# Bug 39 — Рассинхрон CMD-протокола харнеса: select-source с аргументами сломан, gesture-pinch выполняет обратное направление

> Заведён: 2026-07-12 (ревизия кода, аудит tools). Приоритет: СРЕДНИЙ (ломает автономное
> тестирование — толстый слой Idea 22 частично не работает).
> Полный отчёт: `researches/code_audit_2026-07-12.md`.

## Симптомы

- `node tools/ui.mjs cmd select-source builtin 2` — НЕ работает: уходит в else-warning ресивера.
- `node tools/ui.mjs cmd gesture-pinch in 0.5` — выполняет pinch-**OUT** (обратное направление).
- `[frac]`/`[radiusFrac]` из help ресивером вообще не используются.

## Root cause — два разных соглашения о разделителе аргументов

`ui.mjs cmd` склеивает хвост аргументов ЗАПЯТОЙ (`rest.slice(1).join(',')` — ui.mjs:622), потому что
`am broadcast --es` рвёт значение по пробелам. Ресивер (`MainActivity.kt:121-224`) парсит:
- gesture-drag/scale/rotate/set-transform — `Regex("[,\\s]+")` → ✅ ок;
- `select-source` — ТОЛЬКО `Regex("\\s+")` (MainActivity.kt:202) → получает `"builtin,2"` → мимо;
- `gesture-pinch`/`gesture-twist` — читают первый токен по `\s+`: `"in,0.5" != "in"` → ветка else =
  противоположное направление; доп. аргументы игнорируются (MainActivity.kt:217-224).
- Отдельный путь `ui.mjs pinch` (473-478) шлёт arg С ПРОБЕЛОМ — противоречит собственному
  комма-протоколу.

## План фикса (маленький)

- [ ] В CMD-ресивере унифицировать ВСЕ split на `Regex("[,\\s]+")` (select-source, gesture-pinch,
      gesture-twist) + использовать заявленные `[frac]`/`[radiusFrac]`.
- [ ] `ui.mjs pinch` — комма-джойн как у cmd.
- [ ] Синхронизировать доку: usage/help ui.mjs (нет select-source, gesture-*), KDoc ресивера
      (отстал сильнее), таблицы AGENT_GUIDE/UI_AUTOMATION_GUIDE.
- [ ] **Контрактный тест протокола**: шаг в `smoke.mjs`, прогоняющий каждый action из help через
      ресивер и грепающий logcat на `unknown action`/warning — рассинхронов больше не будет.

## Приёмка

`ui.mjs cmd select-source builtin <id>` переключает источник (лог DeviceManager);
`gesture-pinch in 0.5` уменьшает выбранный слой; smoke-шаг протокола PASS.

## Статус
🔴 ОТКРЫТ (средний, фикс дешёвый — кандидат в автономный пул; камера для проверки select-source
builtin не нужна — есть virtual).
