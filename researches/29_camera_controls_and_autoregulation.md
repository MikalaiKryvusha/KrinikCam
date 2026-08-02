# 29 — Параметры камер (UVC-контролы) и фундамент под авторегулировку: разведка

> **Что это.** Ступень 1 лестницы `/plan-epic` для эпика «настройки параметров камер» (заказ Криника,
> 2026-08-02: «*нужно брать в работу настройки параметров камер. Давно хочется иметь эти «ручки», тем
> более, что они понадобятся для алгоритмов авторегулировки*»). Кода и мета-плана до этого документа
> не существует — таков канон (`AGENT_GUIDE.md` → шаг 9а, правило Криника про прио-арт).
>
> **Правило документа:** каждое утверждение о нашем коде и о библиотеке — из ПРОЧИТАННОГО в этой
> сессии (`javap` по реальным артефактам, исходник на GitHub), а не по памяти. Каждое число из
> внешнего источника — со ссылкой. Непроверенное помечено словом **НЕ ПРОВЕРЕНО**.
>
> **Главный вывод одной строкой:** то, что болит у Криника сильнее всего — **экспозиция и авто-режим
> усиления** — единственное, чего в публичном API нашей библиотеки НЕТ, хотя в нативном слое оно
> реализовано. Это и есть настоящая развилка эпика, и раньше она была не видна: `ideas/36` и
> `plans/08` прямо утверждают обратное.

---

## 1. Требования — что просил владелец

**Заказ 2026-08-02 (дословно):** «*нужно брать в работу настройки параметров камер. Давно хочется
иметь эти «ручки», тем более, что они понадобятся для алгоритмов авторегулировки*».

**Более ранний, более конкретный (2026-07-26, чат):** «*это не гонка! это плохая работа чипа усиления
Pico — нужно срочно планировать менеджер настроек параметров UVC камер*» (`plans/08`).

**Симптом, ради которого всё затевается** (`ideas/36`, `plans/08`): Emeet Piko+ лагает и «плывёт» на
старте фида — автоматика камеры (усиление/экспозиция) сама себя разгоняет, и выключить её нечем.

**Место в генплане:** `MASTER_PLAN.md` §7 → **Phase 6 «Умная авторегулировка USB-камер»** (анализ
кадра → обратная связь UVC-controls → профили Balanced/Fast/DarkPriority/LightPriority/Manual).
`GOAL.md` называет отсутствие авторегулировки у конкурента **«НОНСЕНСОМ»** — то есть это не
украшение, а заявленная сила продукта. Ручные ручки — необходимый ФУНДАМЕНТ: нельзя регулировать
автоматически то, чем не умеешь управлять вручную.

---

## 2. Отраслевой sweep — как эту задачу решает индустрия

### 2.1 Спецификация UVC: два блока контролов, шесть запросов

Контролы камеры в UVC разделены по функциональным блокам ([Linux UVC driver
docs](https://www.kernel.org/doc/html/next/userspace-api/media/drivers/uvcvideo.html),
[libuvc device controls](https://deepwiki.com/libuvc/libuvc/7-device-controls)):

- **Camera Terminal (CT)** — оптика и съёмка: экспозиция (режим, приоритет, абсолютная,
  относительная), фокус (абс./отн./авто/simple), зум, диафрагма, панорама/наклон, roll, privacy.
- **Processing Unit (PU)** — обработка сигнала: яркость, контраст, усиление (gain), баланс белого
  (температура и компоненты, каждый со своим «авто»), насыщенность, резкость, оттенок, гамма,
  компенсация подсветки, частота сети, цифровой множитель.

Каждый контрол отвечает на шесть запросов: `GET_CUR`/`SET_CUR` (текущее значение),
**`GET_MIN`/`GET_MAX`/`GET_RES`** (границы и ШАГ — по ним хост строит корректный ползунок),
`GET_DEF` (значение по умолчанию), `GET_INFO` (что вообще поддержано). То есть **диапазоны положено
брать у самой камеры, а не выдумывать** — прямо противоположно тому, что предполагал `plans/08` §S4
(«если AUSBC не отдаёт min/max — взять дефолтные/нормализованные 0–100»).

### 2.2 Эталонная открытая реализация — libuvc

[`standard-units.yaml`](https://github.com/libuvc/libuvc/blob/master/standard-units.yaml) даёт
машиночитаемую таблицу стандартных контролов — имя, блок, размер в байтах, знаковость. Существенное
для нашей модели данных:

| Контрол | Блок | Байт | Знаковый |
|---|---|---|---|
| `exposure_abs` | CT | 4 | нет |
| `exposure_rel` | CT | 1 | **да** |
| `focus_abs` / `focus_auto` | CT | 2 / 1 | нет |
| `zoom_abs` | CT | 2 | нет |
| **`brightness`** | PU | 2 | **да** |
| `contrast`, `gain`, `saturation`, `sharpness`, `gamma`, `backlight_compensation`, `white_balance_temperature` | PU | 2 | нет |
| **`hue`** | PU | 2 | **да** |
| `white_balance_component` | PU | 4 | нет |
| `power_line_frequency`, `*_auto` тумблеры | PU | 1 | нет |

**Почему знаковость важна:** яркость и оттенок ходят вокруг нуля (−64…+64 у типовой вебки), а
усиление и контраст — от нуля вверх. Модель, где «значение = int 0..N», молча испортит яркость.

### 2.3 Порядок операций, который ломает наивные реализации

Из документации libuvc ([ctrl group](https://libuvc.github.io/libuvc/group__ctrl.html)):
абсолютная экспозиция задаётся в единицах **0.0001 с** (значение 100 = 10 мс), и —
цитата — *«auto exposure should be set to manual or shutter_priority before attempting to change this
setting»*. То есть **сначала выключить авто-режим, потом ставить значение**; в обратном порядке
камера молча проигнорирует запись. Тот же порядок действует для баланса белого
([libuvc issue #10](https://github.com/ktossell/libuvc/issues/10) — «Disable auto white balance
temperature»). Это ровно наш сценарий: Криник хочет ВЫКЛЮЧИТЬ автоматику Piko+, а не подкрутить её.

### 2.4 Авторегулировка (задел под Phase 6) — что известно науке

Разведка неглубокая намеренно: Phase 6 — отдельный эпик, здесь фиксируется только то, что влияет на
ФУНДАМЕНТ, который мы кладём сейчас.

- **Гистограммный AE — рабочая классика.** Алгоритм ищет два крупнейших пика гистограммы яркости и
  считает средневзвешенную яркость (MWL) по пикселям внутри них ([Frontiers of Optoelectronics,
  «A new automatic exposure algorithm for video cameras using luminance
  histogram»](https://link.springer.com/article/10.1007/s12200-008-0064-7)).
- **Сходимость — модифицированный метод секущих.** Яркость моделируется как вогнутая/выпуклая функция
  управляющего параметра, и нужное значение находится быстрее простого шага
  ([USC MCL, «A fast and robust camera's auto exposure algorithm»](https://mcl.usc.edu/wp-content/uploads/2016/01/13.pdf)).
- **Гистерезис обязателен.** Патентная практика называет величину **≈0.5 EV** как гистерезис,
  подавляющий осцилляции AE; в литературе явление называется *tumbling* — качание картинки между
  пере- и недоэкспозицией ([US 8724017, «Auto exposure techniques for variable lighting
  conditions»](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8724017)).

> ⚠️ Число 0.5 EV — из патентной формулировки, НЕ из нашего замера. В код без собственного измерения
> не заносить (правило трёх дверей, `PHILOSOPHY.md`).

**Следствие для фундамента, которое нельзя отложить:** авторегулятору нужны **сырые значения и
реальные границы** контрола (шаг, min, max) и **скорость записи** — процентная шкала 0–100 (см. §3.4)
для него это потеря разрешения и нелинейность. Модель данных обязана хранить сырое значение камеры
рядом с процентом для UI, иначе Phase 6 придётся ломать фундамент.

---

## 3. Локальная разведка — что у нас есть на самом деле

Всё в этом разделе получено `javap` по РЕАЛЬНЫМ артефактам из кэша Gradle и чтением исходника
эталона, в этой сессии.

### 3.1 🔴 Главная находка: `ideas/36` и `plans/08` описывают API, которого НЕТ

Оба документа утверждают: «*AUSBC (libuvc) уже отдаёт get/set на весь набор: Brightness, Contrast,
Gain, Exposure(+Mode), WhiteBalance, Saturation, Sharpness, Hue, Gamma, Zoom, Focus(+Auto),
BacklightComp, PowerlineFrequency*».

**Факт** (`javap com.jiangdg.ausbc.MultiCameraClient$Camera`, libausbc 3.2.7) — весь публичный набор:

```
setAutoFocus(boolean) · setAutoWhiteBalance(boolean)
setZoom/getZoom · setGain/getGain · setGamma/getGamma · setBrightness/getBrightness
setContrast/getContrast · setSharpness/getSharpness · setSaturation/getSaturation · setHue/getHue
```

Восемь значений и два тумблера. **Нет экспозиции. Нет температуры баланса белого. Нет компенсации
подсветки, частоты сети, абсолютного фокуса. Нет min/max/def. Нет способа узнать, что камера
поддерживает.** Единственный след экспозиции во всём libausbc — поле `isContinuousAEModel` в
`CameraRequest`, то есть флаг при ОТКРЫТИИ камеры, а не рантайм-ручка.

**Почему это дорого стоит именно нам:** боль Криника — «плохая работа чипа усиления», то есть
автоматика экспозиции/усиления. Ручка, которой ему не хватает, — ровно та, которой в этом API нет.
План, написанный по этому неверному утверждению, привёл бы к «сделали 8 ползунков, а лаг остался».

### 3.2 ✅ Но арсенал КУПЛЕН — этажом ниже (урок EXP-0028 отработан)

Под AUSBC лежит `com.serenegiant.usb.UVCCamera` из артефакта `libuvc` 3.2.7 — он **уже на runtime-
classpath проекта** (`feature/usb/build.gradle.kts:57`, `compileOnly(libs.android.usb.camera.libuvc)`),
с нативными `.so` (`libuvc.so`, `libUVCCamera.so`, `libusb100.so`).

Публично он даёт заметно больше AUSBC:

```
setBrightness/getBrightness/resetBrightness · setContrast · setGain · setGamma · setSaturation
setSharpness · setHue · setWhiteBlance/setAutoWhiteBlance · setFocus/setAutoFocus · setZoom
setPowerlineFrequency/getPowerlineFrequency · checkSupportFlag(long) · updateCameraParams()
```

- **`checkSupportFlag(long)`** — штатный способ узнать поддержку контрола, вместо «пробы get»,
  которую предлагал `plans/08` S1. Работает по битовым маскам: `CTRL_*` (Camera Terminal) и `PU_*`
  (Processing Unit, старший бит выставлен). Реализация (исходник эталона):
  `if ((flag & 0x80000000) == 0x80000000) return ((mProcSupports & flag) == (flag & 0x7fffffff)); else return (mControlSupports & flag) == flag;`
- **`updateCameraParams()`** — заполняет `mBrightnessMin/Max/Def` и родню, дёргая
  `nativeUpdateBrightnessLimit(mNativePtr)` и аналоги. То есть **реальные границы камеры доступны**,
  вопреки допущению `plans/08`.

### 3.3 🔴 Экспозиция: реализована в нативном слое, но НЕ выведена наружу

`javap` по `UVCCamera` показывает нативные методы:

```
private static final native int nativeSetExposureMode(long, int) / nativeGetExposureMode(long)
private static final native int nativeSetExposure(long, int)     / nativeGetExposure(long)
private static final native int nativeSetExposurePriority(long, int) / nativeGetExposurePriority(long)
private final native int nativeUpdateExposureLimit(long) / nativeUpdateExposureModeLimit(long)
protected int mExposureMin / mExposureMax / mExposureDef (и то же для Mode и Priority)
```

…и **ни одного публичного Java-метода экспозиции**. Проверено дважды и независимо: `javap` по нашему
артефакту и чтение [исходника
эталона](https://github.com/saki4510t/UVCCamera/blob/master/libuvccamera/src/main/java/com/serenegiant/usb/UVCCamera.java)
— «*No public exposure control methods exist. The class defines exposure-related constants (`CTRL_AE`,
`CTRL_AE_PRIORITY`, `CTRL_AE_ABS`, `CTRL_AR_REL`) but provides no corresponding setter/getter*».

Функциональность есть в `.so`, лестница к ней (`mNativePtr`, private native) — закрыта. **Это
центральная развилка эпика**, и она архитектурная, а не косметическая.

### 3.4 Значения НОРМАЛИЗОВАНЫ в проценты 0–100 (а не сырые UVC)

Исходник эталона, дословно:

```java
// setBrightness
final float range = Math.abs(mBrightnessMax - mBrightnessMin);
if (range > 0) nativeSetBrightness(mNativePtr, (int)(brightness / 100.f * range) + mBrightnessMin);
// getBrightness
if (range > 0) { result = (int)((brightness_abs - mBrightnessMin) * 100.f / range); }
```

Хорошая новость для UI: единая шкала 0–100 % для всех ползунков, ничего изобретать не надо.
Плохая — для Phase 6: авторегулятор получает загрублённую и нелинейную шкалу, а шаг (`GET_RES`)
теряется вовсе. **Следствие: модель контрола обязана нести И процент (для человека), И сырое
значение с границами (для алгоритма).**

### 3.5 Куда это подключается в нашем коде

- `MultiCameraClient$Camera` держит `private com.serenegiant.usb.UVCCamera mUvcCamera` — то есть путь
  к нижнему этажу лежит через **приватное поле** обёртки.
- Наш опенер `UvcCameraOpener` (`app/streaming/CameraLayerOpeners.kt`) держит объект AUSBC-камеры и
  уже умеет спрашивать у неё возможности после открытия — в логе видно
  `UVC поддерживаемые размеры: 3840x2160, …` (снято на A51 в этой сессии). Значит место, куда
  встраивается чтение контролов, существует и работает.
- Контролы доступны **только после открытия камеры** — как и размеры превью (`bug 25`). Это уже
  известный проекту класс проблем.
- **Переоткрытие камеры сбрасывает настройки.** В этой же сессии наблюдалось, как переключение
  источника переоткрывает UVC за 40 мс (`camera closed (layer)` → `RECREATED` → `camera opened`).
  Значит персист значений — не «на потом», как предполагал `ideas/36`, а условие работоспособности:
  без него настройка слетает при каждом переключении сцены.

### 3.6 Чего мы НЕ знаем (и как узнать)

- **Что реально поддерживает Emeet Piko+ и noname 2K.** Дескрипторы с устройства снять не удалось:
  `lsusb` на Android без `-v`, `/sys/kernel/debug/usb/devices` — `Permission denied` (нужен root).
  **Единственный путь — код на устройстве:** `checkSupportFlag` + `updateCameraParams` после открытия.
  Это и есть содержание первой фазы эпика.
- ~~**Появилась ли экспозиция в свежей версии.**~~ ✅ **ПРОВЕРЕНО В ЭТОЙ ЖЕ СЕССИИ — НЕТ.**
  Артефакт `libausbc-3.3.3.aar` скачан с jitpack и вскрыт `javap`. Итог:
  - **экспозиции нет и в 3.3.3** — греп по байткоду ВСЕХ 205 классов на `exposure|AeMode` пуст;
  - контролы переехали в `com.jiangdg.ausbc.camera.CameraUVC` (наследник нового
    `MultiCameraClient$ICamera`), набор тот же — brightness, contrast, gain, zoom, autoWhiteBalance
    (+ появились `reset*`);
  - **обновление ЛОМАЮЩЕЕ:** переименованы и класс (`Camera` → `ICamera`/`CameraUVC`), и пакеты
    (`com.serenegiant.usb.UVCCamera` → `com.jiangdg.uvc.UVCCamera`, `USBMonitor` туда же) — а именно
    на `com.serenegiant.usb` завязан наш `feature/usb` (`IDeviceConnectCallBack`, `compileOnly`);
  - **`libuvc` 3.3.3 на jitpack ВООБЩЕ НЕ СОБИРАЕТСЯ** — на запрос артефакта возвращается
    `Build failed. See the log at jitpack.io`, тогда как `libausbc` 3.3.3 отдаётся нормально.

  **Вывод, снимающий целую ветку планирования:** обновление версии — НЕ путь к экспозиции. Оно
  стоит ломающей миграции пакетов, не даёт искомого и вдобавок упирается в неподнимающийся артефакт.
  Значит развилка §5.2 сужается до трёх кандидатов: рефлексия · свой JNI поверх поставляемых `.so` ·
  форк обёртки.
- **Переживёт ли Piko+ выключение авто-экспозиции** без деградации (некоторые вебки в ручном режиме
  роняют fps) — замер.
- **Реальные min/max/res** каждого контрола на наших камерах — только с устройства.

---

## 4. Что из этого следует для эпика

1. **Первая фаза — не UI, а РАЗВЕДОЧНЫЙ СПАЙК на устройстве.** Пока не снят реальный инвентарь
   («какие контролы Piko+ декларирует, с какими границами и шагом»), любой план ползунков — фантазия.
   Инвентарь — исчислимый артефакт (`AGENT_GUIDE.md` → «Инвентарь паритета»): строка на контрол.
2. **Развилка «как добыть экспозицию» решается ДО проектирования UI**, потому что от неё зависит,
   что вообще будет на экране. Ветка «просто обновиться» **уже отброшена замером** (§3.6): в 3.3.3
   экспозиции нет, миграция ломающая, артефакт `libuvc` не собирается. Остаются три:
   - **рефлексия** к приватному `mUvcCamera` и приватным `native`-методам — дёшево и быстро, но
     хрупко (молча отвалится при любом обновлении) и требует доступа к `mNativePtr`;
   - **свой тонкий JNI** поверх уже поставляемых `.so` (`libuvc.so` лежит в артефакте) — дороже,
     но честно и под нашим контролем;
   - **форк обёртки** — дороже всех, зато снимает и остальные ограничения разом.

   Выбор — с ценой и риском — выносится Кринику (§5.2), а не решается агентом: это вопрос «сколько
   вложить», а не технической истины.
3. **Модель данных проектируется сразу под Phase 6** (сырое значение + границы + шаг + процент), иначе
   авторегулировку придётся строить на загрублённой шкале или ломать фундамент.
4. **Персист по VID+PID — часть MVP, а не «потом»** (§3.5: переключение сцен переоткрывает камеру).
5. **Порядок «сначала авто → выкл, потом значение»** зашивается в слой применения, а не оставляется
   на совесть UI (§2.3).
6. **Мёртвых ползунков быть не должно:** показываем ровно то, что вернул `checkSupportFlag`
   (требование `ideas/36` и `plans/08`, теперь с механизмом).

## 5. Развилки, которые должен закрыть Криник (не агент)

1. **UX ручек** — где живут (модалка слоя / отдельный экран / on-screen шторка поверх превью), как
   выглядят, что видно сразу, а что под «ещё». Это **класс ВКУСА** → мокапы на нашем материале, а не
   вердикт агента (`AGENT_GUIDE.md`).
2. **Глубина захода за экспозицией** — сколько риска он готов принять ради главной ручки: жить на
   рефлексии (дёшево, хрупко) или вкладываться в свой JNI/форк (дорого, надёжно).
3. **Что делать с «авто» камеры по умолчанию** — оставлять как есть или гасить при первом подключении
   (его боль именно в автоматике, но молча менять картинку пользователю нельзя).

Эти вопросы уходят в `/interview` отдельным документом; работа по незаблокированным фазам идёт
параллельно (канон лестницы).

---

### Источники

UVC/драйверы: [Linux UVC driver docs](https://www.kernel.org/doc/html/next/userspace-api/media/drivers/uvcvideo.html) ·
[Microsoft UVC 1.5 extensions](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/uvc-extensions-1-5) ·
[libuvc device controls](https://deepwiki.com/libuvc/libuvc/7-device-controls) ·
[libuvc ctrl group](https://libuvc.github.io/libuvc/group__ctrl.html) ·
[standard-units.yaml](https://github.com/libuvc/libuvc/blob/master/standard-units.yaml) ·
[libuvc issue #10 (auto WB)](https://github.com/ktossell/libuvc/issues/10) ·
[uvc-util (macOS, ссылочная реализация UI-контролов)](https://github.com/jtfrey/uvc-util)
Библиотека: [saki4510t/UVCCamera UVCCamera.java](https://github.com/saki4510t/UVCCamera/blob/master/libuvccamera/src/main/java/com/serenegiant/usb/UVCCamera.java) ·
[AndroidUSBCamera releases](https://github.com/jiangdongguo/AndroidUSBCamera/releases) ·
[VERSION.md](https://github.com/jiangdongguo/AndroidUSBCamera/blob/master/VERSION.md) ·
`javap` по libausbc-3.2.7.aar и libuvc-3.2.7.aar из кэша Gradle
Авторегулировка: [Frontiers of Optoelectronics — histogram AE](https://link.springer.com/article/10.1007/s12200-008-0064-7) ·
[USC MCL — fast and robust AE](https://mcl.usc.edu/wp-content/uploads/2016/01/13.pdf) ·
[US 8724017 — AE hysteresis](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8724017) ·
[Model-based AE control](https://www.researchgate.net/publication/291954684_A_Model-based_Approach_to_Camera's_Auto_Exposure_Control)
