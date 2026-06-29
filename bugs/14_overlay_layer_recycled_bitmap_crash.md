# Bug 14 — Краш при перестановке слоя-картинки: «trying to use a recycled bitmap»

**Статус:** ✅ ИСПРАВЛЕН (2026-06-29)
**Версия:** debug, Idea 19 фаза 1 (слой-картинка из файла)
**Симптом (Криник):** добавил PNG-картинку в сцену → нажал «поменять местами со слоем камеры» → краш.

---

## Стек (crash-файл `crash_20260629_205121.txt`, поток main)

```
java.lang.RuntimeException: Canvas: trying to use a recycled bitmap android.graphics.Bitmap@...
  at android.graphics.BaseCanvas.throwIfCannotDraw
  at androidx.compose.ui.graphics.painter.BitmapPainter.onDraw   ← миниатюра слоя в панели «Scene layers»
  at ...LayoutNodeDrawScope.draw → NodeCoordinator.draw → GraphicsLayer.record → dispatchDraw
```

Падало в Compose-отрисовке миниатюры слоя (`Image(layer.bitmap.asImageBitmap())`) — битмап слоя
оказался уже переработан (recycled).

---

## Root cause

`SceneCompositor.apply()` передавал в `ImageObjectFilterRender.setImage(...)` **тот же объект**
`layer.bitmap`, что хранит доменный слой. А **RootEncoder при `clearFilters()`/release фильтра
РЕЦИКЛИТ битмап**, переданный в `setImage`. Сценарий:

1. Добавили картинку → `apply()` №1: создан фильтр, `setImage(layer.bitmap)`.
2. Нажали «переставить» → новая `Scene` → `apply()` №2: `clearFilters()` освобождает старый фильтр
   и **рециклит `layer.bitmap`** → создаётся новый фильтр уже с мёртвым битмапом, И панель
   перерисовывает миниатюру тем же мёртвым `layer.bitmap` → `RuntimeException` на main.

Баг был **латентным**: при toggle видимости раньше не падало только потому, что панель была закрыта
в момент повторного `apply()` (миниатюра не рисовалась). Перестановка же делается ПРИ ОТКРЫТОЙ панели
→ перерисовка мёртвого битмапа → краш гарантирован.

---

## Фикс

`SceneCompositor.apply()` отдаёт фильтру **КОПИЮ** битмапа, а не сам `layer.bitmap`:

```kotlin
ImageObjectFilterRender().apply { setImage(layer.bitmap.copy(Bitmap.Config.ARGB_8888, false)) }
```

Теперь RootEncoder рециклит СВОЮ копию (его собственность), а `layer.bitmap` остаётся живым —
им владеет домен/UI (миниатюра + источник истины + будущие повторные `apply`). Утечки нет: каждый
`apply` создаёт новую копию, старую RootEncoder перерабатывает на `clearFilters`.

**Проверено на устройстве:** добавление тест-оверлея + перестановка ↑↓ + двойной toggle видимости —
процесс жив (PID не меняется), оверлей корректно компонуется. Краш не воспроизводится.

---

## Уроки / на будущее

- **Чужая библиотека может владеть и рециклить переданный ей `Bitmap`.** Если объект разделяется с
  UI/доменом — передавай КОПИЮ, не общий ссыльный объект. (RootEncoder `ImageObjectFilterRender`
  рециклит битмап из `setImage` при release/clearFilters.)
- **Латентные краши в путях перерисовки.** Тест toggle «прошёл» лишь потому, что панель была закрыта;
  надо гонять операции слоёв ПРИ ОТКРЫТОЙ панели (миниатюры в кадре отрисовки).
- **Семантический нюанс (не баг):** камера сейчас всегда базовый слой (низ), оверлеи — фильтры
  поверх; перестановка камеры/оверлея в списке пока не меняет фактический порядок рендера. Полноценный
  слой-камера в стеке — будущая фаза мульти-источников.
