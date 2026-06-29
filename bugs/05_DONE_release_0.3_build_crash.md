# Bug 05 — Release-сборка крашится при старте камеры (R8 ломает JNI)

> Статус: **✅ ЗАКРЫТ** (2026-06-28)
> Симптом нашёл: Криник (тест release-APK ~14:51, 2026-06-28)
> Тип: release-only краш (debug не воспроизводит)

---

## Симптом

`./gradlew assembleRelease` собирается успешно, APK ставится и запускается, но приложение
**мгновенно крашится, как только должна появиться картинка с USB-камеры** (старт превью/стрима).
Debug-сборка работает идеально. Из-за этого нельзя выпустить релиз 0.3 на GitHub.

## Стектрейс (из crash-файла на устройстве)

```
java.lang.NoSuchMethodError: no static or non-static method
  "Lcom/serenegiant/usb/UVCCamera;.nativeSetStatusCallback(JLcom/serenegiant/usb/IStatusCallback;)I"
    at java.lang.Runtime.nativeLoad(Native Method)
    at java.lang.System.loadLibrary(System.java:1765)
    at com.serenegiant.usb.UVCCamera.<clinit>(SourceFile:21)
```

## Root cause

USB-камера тянет нативную библиотеку `libUVCCamera.so`. При `System.loadLibrary()` (в статическом
инициализаторе `UVCCamera.<clinit>`) нативный код через JNI **привязывается к Java-методам по их
ТОЧНОЙ сигнатуре** `класс + имя метода + дескриптор` (`RegisterNatives` / `nativeLoad`).

Release-сборка включает R8: `isMinifyEnabled = true` + `isShrinkResources = true`. R8
**переименовал/удалил** метод `nativeSetStatusCallback` и/или интерфейс
`com.serenegiant.usb.IStatusCallback`, потому что со стороны Kotlin/Java на них нет явных ссылок —
их «видит» только нативный код, который R8 не анализирует. В результате нативная привязка не
находит метод → `NoSuchMethodError` в момент загрузки .so.

Debug-сборка не минифицируется → сигнатуры целы → краша нет. Отсюда «release-only».

## Почему это не всплыло раньше

Phase 1 release (v0.2) собирался, но тогда никто не запускал камеру в release-сборке на устройстве.
Краш проявляется только при фактической загрузке нативной либы (открытие камеры), а не при старте app.

## Фикс

`app/proguard-rules.pro` — keep-правила, запрещающие R8 трогать нативные классы и JNI-методы:

```proguard
# Никогда не переименовывать native-методы (сохраняет JNI-сигнатуры).
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
# serenegiant USB/UVC native stack (libUVCCamera) + JNI-колбэки
# (IStatusCallback / IButtonCallback / IFrameCallback).
-keep class com.serenegiant.** { *; }
-dontwarn com.serenegiant.**
# AndroidUSBCamera (обёртка над serenegiant, рефлексия).
-keep class com.jiangdg.** { *; }
-dontwarn com.jiangdg.**
# RootEncoder (нативный транспорт + рефлексия выбора кодека).
-keep class com.pedro.** { *; }
-dontwarn com.pedro.**
```

`-keepclasseswithmembernames ... native <methods>` — ключевое: сохраняет имена всех native-методов
в проекте. `-keep class com.serenegiant.** { *; }` — гарантирует, что классы и интерфейсы, которые
ищет нативная либа, не вырезаны и не переименованы.

## Проверка (на устройстве, release-APK, 2026-06-28 ~17:00)

- `libUVCCamera.so ... ok` в nativeloader, `UVCPreview.cpp frameSize=(1920,1080)@MJPEG`,
  активные `get_frame` — нативная UVCCamera загрузилась и гонит кадры.
- Живое превью с USB-камеры в release ✅ (Криник подтвердил: «запустилось»).
- Go Live в release — без краша, без `NoSuchMethodError`/`UnsatisfiedLink`/`FATAL`.
- Краш-файлов после фикса не появилось.

> Open camera — общий путь для превью И стрима, поэтому фикс закрывает обе формулировки симптома
> («video about to appear» и «при попытке начать стрим»).

## Уроки

1. **Любая нативная (JNI) либа = обязательные keep-правила в ProGuard.** R8 не видит ссылок из
   нативного кода и спокойно вырезает «неиспользуемые» методы/классы. Симптом — `NoSuchMethodError`
   / `UnsatisfiedLinkError` в release, чисто в debug.
2. **Тестировать release-сборку на устройстве — отдельный обязательный шаг**, особенно фичи на
   рефлексии/JNI (камера, кодеки, сериализация). Зелёная сборка ≠ рабочее приложение.
3. На будущее: при добавлении новой нативной зависимости сразу добавлять `-keep` для её пакета.

## TODO для релиза 0.3

Фикс готов. Перед публикацией: поставить `version.json` minor=2 (чтобы `release.mjs` дал **v0.3**,
а не v0.2 — тег v0.2 уже занят Phase 1), затем `node tools/release.mjs`. Перед публикацией —
прогнать живой стрим в release на устройстве.
