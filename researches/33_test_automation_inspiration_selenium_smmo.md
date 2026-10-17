# 33 — Автоматизация тестирования: подходы из проектов Криника (SMMO, Selenium Page Object, instagram_automation на Appium)

**Создан:** 2026-10-17 · **Родитель:** слово Криника 2026-10-17 «вдохновляться можно подходами автоматизации оттуда, и из проектов николая по автоматизации Селениум и SMMO» · **Статус:** живой справочник · **Вовне:** нет

Разведка read-only: репозитории `SMMO_automation`, `stepik-selenium-page-object`, `selenium_test_items`,
`stepik-auto-tests-course` (публичные) и приватный `instagram_automation` (Appium/Android — описан ниже
только паттернами). Код из репозиториев не запускался, в проекте ничего не менялось.

## 1. Репозитории

### 1.1 SMMO_automation (Python, дек 2022, 46 коммитов, публичный)
- **Структура:** монолит `main.py` (1316 строк) + `mail.py`; `images/` — эталоны кнопок, `jobs/`, `quests/`;
  `images/captchas/{names(39), icons/<слово>/(39), unknown(95), to_process_later(99)}` — **автосбор
  нераспознанных капч**; `log.dat` 92 МБ. Самый длинный прогон в логе: 17 ч 45 мин, 8697 ходов, 52 капчи
  (по логу 172 раза капчу решил скрипт, 5 — человек).
- **Наблюдение экрана:** `pyautogui.locateOnScreen(img, confidence=c, region=r)` + **лестница confidence**:
  ```python
  def wait_and_click(image, timeout=10, int_conf=0.9, sleep_time=1, conf_lowering_step=0.02, ...):
      ...  except: timeout -= 1; time.sleep(sleep_time); confidence -= conf_lowering_step
  ```
  Для капч — списки `[0.9 … 0.75]`, для «трудных» иконок `[0.8 … 0.6]`; `region` для скорости
  (коммит «faster icon searching (use region)»).
- **Ожидания:** `wait_until_appears(img, limit)`, `check_if_there_is_no(img, timeout)`,
  `wait_until_one_of_few_appears_and_return_it_name([...])` — ждать ЛЮБОЙ из исходов и вернуть, какой;
  на этом построены ветвления «бой/зависание/ошибка».
- **Диспетчер событий:** после шага `special_events_detection()` по приоритету проверяет кнопки и
  возвращает `('battle'|'ore'|'machine_error'|…, точка)` → сценарий. Зависание → возврат на «домашний
  якорь»: `"Battle in game is hanging! Leave battle to stepping screen..."` → `wait_and_click('travel_button')`.
- **Зов человека:** капча — до `captcha_solving_attempts_max = 3` попыток; не распознал слово / исчерпал
  попытки →
  ```python
  def call_for_human_help(do_printscreen=True, reason=None):
      mail_me(); play_help_quote()            # SMTP-письмо + gTTS «Вашему герою нужна помощь!»
      if do_printscreen: take_new_captcha_screenshoot(reason=reason)   # имя = время + причина
  ```
  после чего бот **ждёт исход действия человека** (успех/провал на экране) и считает его в статистике
  («solved by human» отдельно от «solved by script»).
- **Статистика/телеметрия:** каждый ход ~34 строки в окно Tkinter (`update_tk_window`) и в `log.dat`:
  проценты по типам событий, uptime, время хода, прогноз темпа (мин/час/день/неделя/месяц), «Average time
  between Machine Errors», «Current time without Machine Error (N% от среднего)». stdout тиражируется в файл
  (`class Logger`), каждая строка с `time.ctime()`. Срез выбросов: ход > 10× среднего, интервал ошибок
  > 1.5× среднего.
- **Безопасность:** `have_internet()` перед каждым ходом (нет сети → ждать 10 с, затем обновить страницу);
  **защитное окно** — если «время без ошибки» подходит к среднему интервалу ошибок, рискованные действия
  пропускаются (`"To risky to battle, because time without Machine Error"`); рандом пропусков и «ночных» часов.
- **Честные поправки к README:** «moving standard deviations to predict optimal wait times» в коде нет —
  «среднее» это RMS (`sqrt(sum_sq/n)`), паузы фиксированные; реальная адаптивность = лестница confidence +
  защитное окно. `pyttsx3` импортирован, но не используется; `pywin32` нет в requirements.
- **Безопасность репозитория:** в публичном репо была найдена утечка учётных данных SMTP — устранена 2026-10-17.

### 1.2 stepik-selenium-page-object (2021, учебный курс Stepik 575, архив)
- `pages/base_page.py`, `locators.py`, `main/login/product/basket_page.py`, `conftest.py`, `pytest.ini`, 2 файла тестов.
- Локаторы — классами: `class ProductPageLocators: ADD_TO_BASKET_BUTTON = (By.CSS_SELECTOR, "button.btn-add-to-basket")`.
- `BasePage.__init__(browser, url, timeout=10)` + `implicitly_wait`; два разных негатива:
  ```python
  def is_not_element_present(self, how, what, timeout=4):   # НЕ появится за timeout
      WebDriverWait(self.browser, timeout).until(EC.presence_of_element_located((how, what)))
  def is_disappeared(self, how, what, timeout=4):            # ИСЧЕЗНЕТ за timeout
      WebDriverWait(self.browser, timeout, 1, TimeoutException).until_not(...)
  ```
- Проверки — методы страниц `should_be_login_page()` → `assert ..., f"Element {LOC[1]} is not presented"`.
- pytest: `pytest_addoption` (`--browser_name`, `--language`), фикстура `browser` с `yield`/quit; `autouse`-фикстура
  `setup` в классе (регистрация пользователя с уникальным email из `time.time()`); `@pytest.mark.parametrize('link',
  [... offer0..9])` с **xfail прямо в матрице**: `pytest.param(link7, marks=pytest.mark.xfail)`; маркеры
  `need_review`, `login_guest` в `pytest.ini`.

### 1.3 selenium_test_items + stepik-auto-tests-course (2021, учебные, архив)
- Тот же `conftest.py` (браузер × язык), `pytest.ini` с `smoke`/`regression`; уроки по `xfail(strict=True)`,
  `skip`, `autouse`, `scope`, rerun (плагина в requirements нет), `WebDriverWait(...).until(EC.text_to_be_present_in_element(...))`.
- Повторяющийся самописный хелпер `wait_for_locator(driver, css, timeout)` — опрос раз в секунду,
  `raise Exception("Timeout!")`; рядом ещё живые `time.sleep(3)` (учебный период).

### 1.4 instagram_automation (приватный, янв 2022, Appium + Android) — ближе всех к нам
Описан только паттернами.
- **Screen Object:** базовый класс экрана с общими действиями; конкретный экран — наследник, где локаторы
  заданы атрибутами-кортежами `(метод, значение)`; значение может быть **списком запасных вариантов** —
  `get_element` перебирает их до первого найденного. Сценарий — отдельный класс поверх экранов, тест —
  поверх сценария (три слоя: экран → сценарий → тест).
- **Ожидания с говорящими ошибками:** `wait_visible`, `wait_for_text`, `wait_for_one_of_the_locators(list) → какой
  найден`, `wait_until_the_locator_disappears`, `check_for_the_absence_of_a_locator(checking_time)` (держит
  отсутствие N секунд); ошибки вида `'Element never became visible: <метод> (<значение>)'`.
- **Ассерт по logcat — прямой аналог нужного нам:** `adb logcat -c` → пауза 3 с → `adb logcat -d --pid=<pidof
  приложения>` → посчитать маркер воспроизведения плеера; «≥ секунд × число плееров» = видео реально играет.
  Повторы при сбоях adb — с лимитом попыток.
- Драйвер: Appium Remote, `waitForIdleTimeout: 100` (ускоряет поиск на динамических экранах), запуск через
  `adb shell am start`. Много защитных `sleep` в жестах. В зависимостях — `pytest-html`, `gtts`, `playsound`
  (голосовые оповещения и тут планировались). Часть ссылок (логгер, переменные окружения) не определена —
  фрагмент большой рабочей системы.

## 2. Стиль и ценности автора
1. **Наблюдаемость прежде всего** — живое окно, лог каждого шага с меткой времени, скриншоты с причиной в
   имени, итоговые проценты.
2. **Статистика как основа решений** — средние, выбросы, прогнозы, «% от среднего интервала ошибок»,
   доля успехов скрипт/человек: автоматизация измеряет собственную надёжность.
3. **Адаптивность вместо жёстких констант** — ступени confidence, регионы, рандомизация; эмпирический
   тюнинг по замерам (лог коммитов: «confidenses tune», «avg time fix»).
4. **Человек в контуре — запланированная ветка, не авария**: N попыток → голос+почта → ждать исход →
   посчитать.
5. **Безопасность и откат** — защитное окно, проверка сети, детектор зависаний с возвратом на «домашний
   якорь», лимиты попыток.
6. **Самопополняемый датасет** нераспознанного (`unknown/`, `to_process_later/`).
7. **Прагматизм**: структуру (Page Object, фикстуры) знает и применяет, но личный бот — один файл с
   копипастой; ценность — работающая наблюдаемость, а не архитектура. Честность: README прямо пишет
   «аккаунт забанен — урок усвоен».

## 3. Переносы в харнес KrinikCam (по приоритету; предложения, [NOT-TESTED])

**Состояние на 2026-10-17:** `tools/ui.mjs` — CLI-switch без экспортов (`smoke.mjs` дёргает его через
`execSync`); в `smoke.mjs` 8 фиксированных `sleep` по 1–6 с (кроме длительности записи), в
`UI_AUTOMATION_GUIDE.md` — `sleep N`; в Kotlin **0 использований `testTag`** → локаторы только текст/desc;
готовый источник телеметрии — строка пульса `RtmpStreamer.kt:657`: `пульс[i] phase bitrate=…kbps cache=
sentV= sentA= dropV= congested= attempt= src=…мс`.

**П1. Явные ожидания вместо `sleep`** (SMMO + instagram; максимальная отдача).
Вынести `dumpUi/parseNodes/findNodes` из `ui.mjs` в `tools/lib/ui-core.mjs` (CLI — тонкая обёртка). API:
`waitFor(q,{timeout,poll})`, `waitGone(q)`, `holdAbsent(q,sec)`, `waitAny({goLive:'Go Live', perm:'Allow',
err:/ошибк/i}) → 'perm'`, `waitLog(tag, /Compositor started/, {timeout, count})` (logcat `-c`/`-d`, как в
instagram). В `smoke.mjs`: `sleep(6000) // дать GL подняться` → `waitLog('CompositorVideoSource', /Compositor
started/)`; `sleep(3000) // muxer` → ждать стабилизации размера файла / лог-маркера закрытия. Ошибка —
«never became visible: <q>» + путь к дампу и скрину. Ценность: быстрее, меньше флаков, понятная причина.

**П2. Слой Screen Object** (instagram + stepik `pages/`). `tools/screens/{main,settings,scenes,layers,addSource}.mjs`:
`export const Main = { goLive: ['Go Live','В эфир'], menu: {desc:'FAB'}, async open(){…}, async shouldBeLive(){…} }`.
Локатор — список запасных значений (RU/EN), как в `get_element(list)`; лестница строгости в духе SMMO:
точный resource-id → точный текст → частичный → desc, с логом сработавшей ступени (сигнал дрейфа вёрстки).
Для стабильности — `Modifier.testTag` + `testTagsAsResourceId` в приложении (правка кода приложения —
решение Криника). Ценность: тест читается как сценарий, правка текста UI — в одном месте.

**П3. Раннер с фикстурами и матрицей** (pytest). KISS: встроенный `node:test` (`describe/it/before/after`,
`--test-name-pattern`) вместо своего раннера; `tests/*.test.mjs` + `tools/lib/fixtures.mjs`. Фикстуры с
setup/teardown (аналог `yield`): `device` (resolveDevice + `anim off` / `kill`), `harness` (virtual-camera +
stream-to-file), `rtmp` (`rtmp-server start/stop`), `chaos(kbps)`. Матрица: `for (const c of matrix({device,
source:['virtual','back','usb'], height:[1080,2160], rotation:[0,90]}))` + пометка известного бага в матрице
(`xfail:'bugs/81'`, как `pytest.param(..., marks=xfail)`). Метки `smoke/regression/long/needs-hands`;
опции `--device --locale` (как `pytest_addoption`). Отчёт: один экран PASS/FAIL/XFAIL/XPASS +
`reports/runs/<ts>/results.json`.

**П4. Живая телеметрия прогона** (Tkinter-окно SMMO). `tools/telemetry.mjs`: tail `adb logcat -s
RtmpStreamer:I` → парсинг пульса → перерисовка панели в терминале раз в секунду: uptime, bitrate
(avg/σ/min), dropV %, `src` мс, доля congested, reconnect-попытки, «время без инцидента» и «среднее между
инцидентами» (ровно как Machine Errors в SMMO), прогноз на час; параллельно `telemetry.jsonl` (аналог
`log.dat`). HTML-вид через `owner-pages` — позже, терминал сначала. Ценность: soak- и chaos-прогоны с цифрами.

**П5. Адаптивные таймауты по замерам** (средние SMMO). `tools/lib/timing.mjs`: замер каждого шага (дамп,
tap→смена экрана, go-live→первый пульс) по serial; Welford mean/σ в `.cache/timing-<serial>.json`;
таймаут = mean + 4σ (с нижним полом), срез выбросов как в SMMO; адаптивный интервал опроса под длительность
дампа. Ценность: никаких ручных подборов `sleep` под разные устройства; видна деградация.

**П6. Зов владельца** (`call_for_human_help`). `tools/lib/alert.mjs` → `callOwner(reason, {shot:true})`:
скрин + дамп + хвост logcat в `reports/runs/<ts>/<reason>/`, затем
`node .kaif/tools/contour/review.mjs --call "<что нужно>"` (сигнал уже есть — SMTP/TTS не тащить).
Триггеры: нужны руки (USB/permission-диалог, который `allow` не одобряет; отвалилась физическая камера;
устройство заблокировано/offline), длинный прогон упал, исчерпаны N попыток. Как в SMMO — после зова
`waitAny([успех, провал])` и счётчик «починено человеком».

**П7. Правила аномального стопа** (защитное окно + `have_internet` SMMO). `tools/lib/guards.mjs`, preflight
каждой итерации: adb online, экран вкл/разблокирован, `dumpsys battery`/`thermalservice`, свободное место,
`pidof` приложения, нет `FATAL EXCEPTION` в logcat → пауза/стоп + `callOwner`; bounded retries
(`maxAttempts=3` → человек). Для soak — пороги в конфиге теста: dropV% > X, `src` > Y мс дольше Z с,
рост attempt.

**П8. Банк неизвестных экранов + сквозной лог** (`captchas/unknown` SMMO). Если ни один Screen Object не
узнал текущий дамп → `reports/unknown-screens/<ts>_<причина>.{jpg,xml}` и стоп; все шаги тиражируются в
`run.log` с метками времени (аналог `Logger`). Ценность: датасет для новых Screen Object, разбор ночных прогонов.

## 4. Не найдено / вне охвата
- Нет CI, отчётов pytest-html/allure, rerun-плагина, Appium-конфигов ни в одном репо (в instagram
  `pytest-html` только в requirements).
- В SMMO нет тестов и конфиг-файла (все настройки — локальные переменные в `main_loop`).
- instagram_automation ссылается на отсутствующие части (логгер, переменные окружения, фикстура
  capabilities) — большой фреймворк-источник нигде не выложен.
- Три Selenium-репо — задания курса Stepik (стандартные паттерны курса, не авторская система).
- Остальные репо Криника (KAGO, KAST, KLAS, KARTUN, KAIF) на тест-автоматизацию не просматривались
  (KAGO по описанию тоже про «measured safety margin» — тот же стиль, код не читался).
