# Задание Криника — Phase 2, тест GL preview + RTMP

> APK уже собран: `app/build/outputs/apk/debug/app-debug.apk`
> Установи через ADB или перетащи на устройство.
>
> Выполни это до следующей сессии с AI.
> Всё что находишь — описывай прямо здесь, ниже каждого пункта.
> Логи сохраняй в `plans/logs/`, скриншоты в `tools/screenshots/`.

---

## Контекст (для понимания что мы фиксили)

В прошлых сессиях архитектура RTMP была полностью переписана:
- **Было**: `RtmpCamera1` → открывал телефонную камеру API → краш при USB
- **Стало**: `RtmpStream` + `UvcVideoSource` → USB камера рендерит напрямую в GL SurfaceTexture

Новый баг: после переписывания — экран чёрный, хотя камера подключалась (было видно в логах).

**Причина (найдена в bytecode RootEncoder):** Race condition. `startPreview()` вызывает `videoSource.start()` до того, как GL render loop установил `running=true`. `onFrameAvailable()` дропает все кадры пока `isRunning=false`.

**Фикс**: После `startPreview()` запускается корутина, которая ждёт пока `glInterface.isRunning=true` (с шагом 50ms, максимум 3 секунды), затем вызывает `changeVideoSource()` — перезапускает камеру с уже корректно инициализированной GL SurfaceTexture.

---

## 1. Превью камеры — главный тест

Подключи Emeet Piko+ 4K, открой приложение.

**Что проверить:**
- [ ] Видна ли живая картинка камеры на экране?
- [ ] Если да — сколько секунд ждал до появления? (ожидаем: 0–2 сек)
- [ ] Или всё равно чёрный экран?
- [ ] При чёрном экране: пробовал ли ждать 3+ секунды?

**Твои наблюдения:**
> Нет, картинки с камеры нет, чёрный экран. Ждал дольше трёх секунд. Снял для тебя logcat по твоей просьбе. Ты хотел увидеть
GL ready after Xms в logcat.

kryvusha@Kryvushas-MacBook-Pro ~ % adb -s 192.168.1.3:5555 logcat | grep -E "RtmpStreamer|UvcVideoSource"

06-27 18:35:43.813 11652 11652 E AndroidRuntime: 	at com.kriniks.kcam.feature.streaming.rtmp.RtmpStreamer.startStream(RtmpStreamer.kt:194)
06-27 18:38:42.970 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:42.970 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:42.971 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:38:42.971 12023 12023 D RtmpStreamer: VideoSource set: UvcVideoSource
06-27 18:38:42.971 12023 12023 D StreamViewModel: VideoSource set: UvcVideoSource
06-27 18:38:42.971 12023 12023 D RtmpStreamer: startPreview: tv=1600x2560 isOnPreview=true glRunning=false
06-27 18:38:42.972 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:43.018 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:38:43.022 12023 12023 D RtmpStreamer: startPreview: done — glRunning=false
06-27 18:38:43.055 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:43.055 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:43.055 12023 12023 D RtmpStreamer: VideoSource set: NoVideoSource
06-27 18:38:44.274 12023 12023 D RtmpStreamer: startPreview: tv=1600x2560 isOnPreview=true glRunning=false
06-27 18:38:44.301 12023 12023 D RtmpStreamer: startPreview: done — glRunning=false
06-27 18:38:44.308 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:38:44.308 12023 12023 D RtmpStreamer: VideoSource set: UvcVideoSource
06-27 18:38:44.309 12023 12023 D StreamViewModel: VideoSource set: UvcVideoSource
06-27 18:38:44.310 12023 12023 D RtmpStreamer: startPreview: tv=1600x2560 isOnPreview=true glRunning=false
06-27 18:38:44.310 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:38:44.332 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:38:44.337 12023 12023 D RtmpStreamer: startPreview: done — glRunning=false
06-27 18:38:46.177 12023 12023 W RtmpStreamer: GL still not running after 3000ms — giving up
06-27 18:38:47.337 12023 12023 W RtmpStreamer: GL still not running after 3000ms — giving up
06-27 18:38:47.376 12023 12023 W RtmpStreamer: GL still not running after 3000ms — giving up
06-27 18:39:26.443 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:39:26.449 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:39:26.450 12023 12023 D RtmpStreamer: VideoSource set: NoVideoSource
06-27 18:39:32.422 12023 12023 D RtmpStreamer: startPreview: tv=1600x2560 isOnPreview=true glRunning=false
06-27 18:39:32.442 12023 12023 D RtmpStreamer: startPreview: done — glRunning=false
06-27 18:39:32.446 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:39:32.446 12023 12023 D RtmpStreamer: VideoSource set: UvcVideoSource
06-27 18:39:32.446 12023 12023 D StreamViewModel: VideoSource set: UvcVideoSource
06-27 18:39:32.447 12023 12023 D RtmpStreamer: startPreview: tv=1600x2560 isOnPreview=true glRunning=false
06-27 18:39:32.448 12023 12023 D UvcVideoSource: USB camera closed
06-27 18:39:32.467 12023 12023 D UvcVideoSource: USB camera opened via GL SurfaceTexture (1920x1080)
06-27 18:39:32.473 12023 12023 D RtmpStreamer: startPreview: done — glRunning=false
06-27 18:39:35.462 12023 12023 W RtmpStreamer: GL still not running after 3000ms — giving up
06-27 18:39:35.488 12023 12023 W RtmpStreamer: GL still not running after 3000ms — giving up

---

## 2. Logcat — что говорят логи

Подключи устройство через USB/WiFi ADB и запусти:
```
adb logcat | grep -E "RtmpStreamer|UvcVideoSource|GlStream"
```

Или через `tools/adb.mjs`:
```
node tools/adb.mjs logcat RtmpStreamer
```

**Что искать в логах (скопируй сюда нужные строки):**

После подключения камеры должно быть примерно так:
```
VideoSource set: UvcVideoSource
startPreview: tv=2560x1600 isOnPreview=false glRunning=false
USB camera opened via GL SurfaceTexture (1920x1080)
startPreview: done — glRunning=false (или true)
GL ready after Xms — re-triggering VideoSource   ← это ключевая строка!
```

- [ ] Строка `GL ready after Xms` присутствует? Если да — сколько ms?
- [ ] Или строка `GL still not running after 3000ms`?
- [ ] Или `glRunning=true` уже в `startPreview: done`?

**Скопируй сюда блок логов от подключения камеры:**
```
(вставь logcat сюда) - cскинул выше

Ещё снял локи из приложения через Settings.
Свежий файл логов вот: /Users/kryvusha/ai_sandbox/KrinikCam/plans/logs/kcam_2026-06-27-2.log
```

---

## 3. RTMP стрим — попытка "Go Live"

Если превью работает — попробуй нажать Go Live с рабочим YouTube профилем.

**Что проверить:**
- [ ] Краш (как раньше)?
- [ ] Или появляется "Connecting..." / индикатор загрузки?
- [ ] Появился LIVE индикатор в верхнем левом углу?
- [ ] YouTube Studio показывает входящий поток?
- [ ] Кнопка Stop работает?

**Твои наблюдения:**
> Превью не работает, кнопка [Go Live] по-прежнему приводит к крешу приложения.

---

## 4. Если превью чёрное — дополнительная диагностика

Если картинка всё равно не появляется:

**Тест 1: Подожди 5 секунд** после подключения камеры. Появилось что-нибудь?
- [ ] Да, через сколько секунд?
- [ ] Нет

**Тест 2: Перезапусти приложение** пока камера уже подключена (не вставляй/вытаскивай камеру — просто свернул/открыл или force stop + открыл):
- [ ] Появилось превью при перезапуске?

**Тест 3: Сохрани полный logcat** от запуска приложения до момента когда должно появиться превью:
```
adb logcat -d > plans/logs/gl_preview_debug.txt
```

Положи файл в `plans/logs/gl_preview_debug.txt`.

> Вот этот файл:  /Users/kryvusha/ai_sandbox/KrinikCam/plans/logs/gl_preview_debug.txt

**Твои наблюдения:**
> Ты долго работал над фиксами, и ничего пофиксить не получилось, и только сломал видео, которое раньше работало =) 

---

## 5. Общее впечатление от Phase 2

**Что изменилось по сравнению с предыдущей версией:**
> Сломали видео

**Что мешает / раздражает:**
> Долго работаеешь, непонятно, что делаешь, не пишешь чётких планов по тому, что собираешься делать. Виши планы MD по твоим исследования проблем, рефлексируй в файлы - так будет проще прослеживать историю фиксинга и быстрее и качественне получится их фиксить.

**Самое важное для следующей сессии:**
> Пофиксить видео
> Пофиксить креш при попытке [Go Live]
> Собрать MPV с этими фиксами, выполнить успешный тестовый стрим в YouTube
