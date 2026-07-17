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

## Фикс 2026-07-18 (ночной цикл, build 0.7(8)) — [TESTED: 2026-07-18 · приёмка ниже]

- **Ресивер**: ВСЕ split унифицированы на `Regex("[,\\s]+")` (TWINS-скан: 8/8 точек) —
  select-source, gesture-pinch, gesture-twist приведены к общему протоколу; заявленные `[frac]`
  (интенсивность щипка, кламп 0.01..1, дефолт 1 = прежний полный ход) и `[radiusFrac]` (радиус
  разведения пальцев twist) теперь реально работают в `injectTwoFinger`.
- **ui.mjs**: `pinch`/`twist`-шорткаты клеят аргументы ЗАПЯТОЙ, как весь cmd-протокол; usage-строка
  дополнена всеми actions.
- **Доки синхронизированы**: KDoc ресивера (полный список + правило протокола), таблицы
  UI_AUTOMATION_GUIDE (+7 строк) и AGENT_GUIDE.
- **Контракт-шаг в smoke.mjs**: все параметризованные actions прогоняются через ресивер, лог
  проверяется на `unknown action` и usage-warn'ы — рассинхрон отныне валит smoke, а не тихо гниёт.

**Приёмка (наблюдением):** `select-source builtin,1` → лог «Select device camera by id=1:
Селфи-камера» (раньше else-warning); `pinch in 0.5` → «injectTwoFinger pinch-in amount=0.5»
(раньше pinch-OUT с игнором frac); smoke PASS с зелёным контракт-шагом («все actions поняты»).

## Статус
✅ **ЗАКРЫТ (2026-07-18).** Протокол един (запятая/пробел ≡), параметры help честные, контрактный
тест стоит на страже в smoke.
