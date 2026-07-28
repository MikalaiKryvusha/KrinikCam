# Разведдок: ЗОЛОТЫЕ СТАНДАРТЫ ДОГОНА СТРИМА (индустрия, наука, код)

> **Что это.** Разведартефакт по канону KAIF 1.6: ответ на прямой заказ Криника — «какие есть в сфере
> ЗОЛОТЫЕ СТАНДАРТЫ нагонки стрима — у скайпа, у зума, у телеграма, у гугл мита. Научные работы,
> технические имплементации, псевдокод».
>
> **Заказ владельца:** `ideas/43_stream_keepalive_respectful.md` (дополнения 2 и 4),
> решения Р9/Р9.1/Р10/Р11 в `interviews/interview_011_network_resilience.md`.
> **Смежный документ:** `researches/network_resilience.md` §13 — там АРХИТЕКТУРА догона в нашем
> проекте (пути A/B, блокер PTS, буфер, звук). Здесь — ВНЕШНЯЯ ПРАВДА: что делает индустрия,
> с какими числами и почему. Документы не дублируют друг друга, а сходятся в §6 этого файла.
>
> **Метод.** 6 углов разведки (исходники WebRTC/NetEQ, научная классика, вендоры Zoom/Meet/Teams,
> Telegram/Skype/Opus, плееры HLS/DASH/Media3 + IRL-стриминг, инструменты time-stretch) — и на
> КАЖДЫЙ угол отдельный агент-скептик, который заново открывал все URL и сверял каждое число по
> первоисточнику. **В §3 попали только числа, подтверждённые скептиком.** Всё, что скептик
> опроверг, из документа ВЫБРОШЕНО, а не смягчено (список выброшенного — в §7.2, чтобы никто не
> внёс это обратно).
>
> Заведён: 2026-07-28.

---

## 1. Главный вывод (если читать только один абзац)

**Золотой стандарт догона существует, он называется «adaptive playout scheduling с растяжением
времени», его каноническая реализация — WebRTC NetEQ (Google, открытые исходники), и интуиция
Криника про гистерезис совпала с этим каноном не приблизительно, а буквально.** NetEQ не имеет
одного порога «есть долг → жмём»: у него ДВА разных порога с мёртвой зоной между ними, где не
делается ничего; ширина этой зоны не константа, а «худший наблюдённый разброс за последние 2 секунды
плюс гранулярность одной коррекции»; поверх зоны стоит рефрактерный период (после успешной коррекции
следующая запрещена 50 мс); и отдельно — аварийная ветка, которая включается только при
четырёхкратном превышении верхнего порога и рефрактерный период игнорирует. То же самое, другими
словами, есть у всех: Liang/Färber/Girod (IEEE TMM 2003) вводят асимметричные пороги сжатия и
растяжения и называют это словом *hysteresis* в тексте статьи; Moon/Kurose/Towsley (1998) входят в
спайк-режим при `d̂ > 4·p̂`, а выходят при `d̂ ≤ 2·old_d` — классический триггер Шмитта; dash.js имеет
отдельный режим `liveCatchupModeStep` с РАЗНЫМИ окнами старта и остановки и документацией «prevents
instability… should be tuned to prevent overshooting the target»; Media3/ExoPlayer (наш стек) держит
мёртвую зону 20 мс и такт не чаще одной смены скорости в секунду; патент Enounce US6598228B2
описывает пороги буфера `T_L`/`T_H` и прямо оговаривает, что изменения между ними «do not cause any
change in playback rate». Тринадцать независимых подтверждений, четыре из них — из работающего
продакшн-кода. **Вторая новость хуже: весь этот канон — про ПРИЁМНИК, и ни у кого из проверенных
(Zoom, Meet, Teams, Telegram, Skype, OBS, BELABOX, Moblin) догон на ОТПРАВИТЕЛЕ не сделан вообще.**
Прямого отраслевого образца нашей схемы не существует — переносится не механизм, а закон управления
(§5). И третья: **числа канона на порядок мягче, чем 1.5×** (Media3 ±3 %, Shaka 0.95–1.1, NetEQ
~100 мс/с на обычной ветке), при этом 1.5 совпадает ровно с дефолтным потолком dash.js, лежит внутри
«качественной» зоны всех движков растяжения (< 2×) — но выше всего, что вообще измеряли на людях
(максимум протестированного в рецензируемом исследовании — 1.3).

---

## 2. Как это устроено у них

### 2.1 NetEQ — канон, из которого всё остальное является частным случаем

NetEQ (`modules/audio_coding/neteq` в libwebrtc) — приёмный адаптивный jitter buffer. Каждые 10 мс
воспроизведения он выбирает ровно одну операцию из списка `kNormal, kMerge, kExpand, kAccelerate,
kFastAccelerate, kPreemptiveExpand, kRfc3389Cng, kRfc3389CngNoPacket, kCodecInternalCng, kDtmf`
([api/neteq/neteq.h](https://webrtc.googlesource.com/src/+/refs/heads/main/api/neteq/neteq.h)).
Официальное описание модуля формулирует решающее правило одной фразой: *«Compare the current delay
estimate (filtered buffer level) with the target delay and time stretch (accelerate or decelerate)
the contents of the sync buffer if the buffer level is too high or too low»*
([g3doc/index.md](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/g3doc/index.md)).

Ядро гистерезиса — дословно из
[decision_logic.cc](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/decision_logic.cc)
(строки 264–286), сверено скептиком посимвольно на двух независимых зеркалах:

```cpp
NetEq::Operation DecisionLogic::ExpectedPacketAvailable(NetEqController::NetEqStatus status) {
  if (!disallow_time_stretching_ && status.last_mode != NetEq::Mode::kExpand && !status.play_dtmf) {
    const int playout_delay_ms = GetPlayoutDelayMs(status);        // НЕсглаженная величина
    const int64_t low_limit  = TargetLevelMs();                    // НИЖНИЙ порог
    const int64_t high_limit = low_limit
                             + packet_arrival_history_->GetMaxDelayMs()   // окно 2000 мс
                             + kDelayAdjustmentGranularityMs;             // = 20
    if (playout_delay_ms >= high_limit * 4) {
      return NetEq::Operation::kFastAccelerate;      // аварийный догон, БЕЗ рефрактерного периода
    }
    if (TimescaleAllowed()) {                        // рефрактерный период 5 тиков = 50 мс
      if (playout_delay_ms >= high_limit) return NetEq::Operation::kAccelerate;      // догоняем
      if (playout_delay_ms <  low_limit)  return NetEq::Operation::kPreemptiveExpand; // копим
    }
  }
  return NetEq::Operation::kNormal;                  // МЁРТВАЯ ЗОНА: не делаем ничего
}
```

Пять свойств этого куска, которые и есть «золотой стандарт»:

1. **Мёртвая зона `[low_limit, high_limit)`.** Между порогами не делается НИЧЕГО. Это буквально то,
   что просил Криник: «не гоняем часто, иногда немного копим».
2. **Ширина зоны АДАПТИВНАЯ.** Она равна задержке самого «опоздавшего» пакета за окно 2000 мс
   (`kPacketHistorySizeMs`) плюс 20 мс. Чем сильнее трясёт сеть — тем шире зона молчания. Порог не
   выдуман константой, он ВЫВОДИТСЯ из наблюдения.
   Источник: [packet_arrival_history.cc](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/packet_arrival_history.cc).
3. **Рефрактерный период.** `kMinTimescaleInterval = 5` тиков × 10 мс = 50 мс, и штраф начисляется
   ТОЛЬКО за успешную растяжку: `prev_time_scale_ = prev_time_scale_ && IsTimestretch(last_mode)`,
   где `IsTimestretch()` включает лишь `*Success`/`*LowEnergy`, но не `*Fail`. Неудачная попытка
   штрафа не даёт. В коде рядом стоит комментарий-обоснование:
   *«The value 5 sets maximum time-stretch rate to about 100 ms/s»*
   ([decision_logic.h](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/decision_logic.h)).
4. **Аварийная ветка стоит ДО рефрактерного периода.** При `d ≥ 4·high_limit` возвращается
   `kFastAccelerate`, и ограничитель частоты не проверяется вовсе. То есть «коэффициент зависит от
   размера долга» — тоже канон, а не наша выдумка. Важно: цифра «~100 мс/с» ограничивает ТОЛЬКО
   обычную ветку; аварийная её обходит (это отдельно перепроверено скептиком, см. §7.2).
5. **Решение принимается по НЕСГЛАЖЕННОЙ величине.** В актуальном коде порог сравнивается с
   `GetPlayoutDelayMs()` напрямую. `BufferLevelFilter` (однополюсный IIR) в контуре решения больше
   не участвует — его выход используется только для статистики. Стабильность обеспечивают адаптивная
   мёртвая зона и рефрактерный период, а не фильтр. (Раньше, в Chrome M91/M103, было наоборот — см.
   §7.2, п. 1.)

Ещё три уровня гистерезиса в том же файле — все подтверждены:

- **Выход из голодания.** `PostponeDecode()`: пока в буфере меньше `kPostponeDecodingLevel = 50 %`
  от целевой задержки, NetEQ продолжает маскировку (Expand/CNG) и НЕ возобновляет нормальное
  декодирование, даже если пакет уже пришёл. То есть после провала сначала докапливаем до половины
  цели, потом играем.
- **Прыжок вперёд.** `FuturePacketAvailable()`: порог `TargetLevelMs() + kTargetLevelWindowMs/2`
  (= target + 50 мс) — ниже него продолжаем маскировку, а не прыгаем.
- **Комфортный шум.** При `excess_waiting_time > optimal_level/2` делается fast-forward; комментарий
  в коде: *«The waiting time for this packet will be longer than 1.5 times the wanted buffer delay»*.

**Целевая задержка — не константа и не среднее, а 95-й перцентиль ЗАБЫВАЮЩЕЙ гистограммы.** Это
второй по важности приём канона (`delay_manager.*`, `underrun_optimizer.cc`, `histogram.cc`):

```python
# выведено из delay_manager.{h,cc} + underrun_optimizer.cc + histogram.cc (main)
kStartDelayMs = 80; kDelayBuckets = 100; kBucketSizeMs = 20      # потолок регистрации 2000 мс
quantile = 0.95; forget_factor = 0.983; start_forget_weight = 2; resample_interval_ms = 500

def Update(relative_delay_ms):
    max_in_interval = max(max_in_interval, relative_delay_ms)
    if stopwatch.ElapsedMs() > resample_interval_ms:        # раз в 500 мс
        histogram.Add(max_in_interval // kBucketSizeMs)     # в гистограмму идёт МАКСИМУМ окна
        max_in_interval = 0
        optimal_delay_ms = (1 + histogram.Quantile(0.95)) * kBucketSizeMs

def Histogram.Add(value):                                   # экспоненциальное забывание
    for b in buckets: b = (b * forget_factor) >> 15
    buckets[value] += (32768 - forget_factor) << 15
    renormalize()
    # разгон: сразу после Reset forget_factor = 0 и растёт -> быстрая сходимость на старте
```

Три приёма, которые стоит забрать целиком: (а) в гистограмму попадает МАКСИМУМ за окно 500 мс, а не
каждое наблюдение — один выброс не размывается сотней спокойных; (б) старое экспоненциально
забывается; (в) сразу после сброса забывание отключено, чтобы быстро сойтись, и включается потом.

**Сама растяжка — не «плейбек ×1.5».** `TimeStretch::Process` + `Accelerate::CheckCriteriaAndStretch`
вырезают ровно ОДИН период основного тона и заглаживают шов линейным кроссфейдом длиной в этот же
период. Порог качества склейки — нормированная кросс-корреляция > 0.9 (`kCorrelationThreshold =
14746` в Q14); если не проходит и это активная речь — операция ОТМЕНЯЕТСЯ (`kNoStretch`), данные идут
как есть. **Качество важнее догона.** В аварийном режиме порог сознательно роняется до 0.5 (`8192`),
и за одну операцию вырезается столько целых периодов, сколько влезает в 15 мс
(`peak_index = (fs_mult_120 / peak_index) * peak_index`) — то есть локально темп может быть
существенно выше «100 мс/с».

> Название алгоритма в исходниках NetEQ НЕ заявлено. Слов WSOLA/SOLA/PSOLA там нет ни одного
> (проверено грепом дважды, независимо) — только комментарий «Do accelerate operation by overlap
> add». По механике это pitch-synchronous overlap-add. **Утверждать «в NetEQ WSOLA» нельзя.**

**Асимметрия догона и накопления.** У `PreemptiveExpand` (замедление) быстрого режима нет вообще —
в коде явный комментарий `const bool kFastMode = false;  // Fast mode is not available for PE Expand.`
Догонять канон разрешает агрессивно, копить — только осторожно.

### 2.2 Вендоры: у кого что реально опубликовано

| Вендор | Что есть в первоисточниках | Уровень |
|---|---|---|
| **Google Meet** | Официально: *«Clients use WebRTC to communicate with Meet servers»*, обязательный кодек Opus. Следовательно механика догона = NetEQ (исходники открыты). **Прямого документа Google «Meet использует NetEQ» не существует** — связка сильная, но косвенная. | спека + вывод |
| **Telegram** | tgcalls **не пишет своей логики вообще**: `CustomNetEqFactory` вызывает стоковую `webrtc::DefaultNetEqFactory()`, единственная правка конфига — `sample_rate_hz = 48000`. Вся настройка — два флага: `audio_jitter_buffer_fast_accelerate = true` и `audio_jitter_buffer_min_delay_ms = 50` (групповые звонки). То есть Telegram намеренно ВКЛЮЧАЕТ аварийный догон, который в WebRTC выключен по умолчанию. | код |
| **Telegram (трансляции!)** | Самое интересное. Плеер живых трансляций (`StreamingMediaContext`) — это неинтерактивный поток, то есть НАШ случай по природе, — **не растягивает время вообще**. Сегменты 1000 мс, целевой буфер 2000 мс, старт с якорем «серверное время − 2000 мс», при отставании — ресинк с выбросом всех pending-сегментов, при опустошении — тишина (`memset`). Схема документирована ОФИЦИАЛЬНО на core.telegram.org/api/group-calls. **Догон = сбросить долг, а не проиграть его быстрее.** | код + спека |
| **Skype** | Кодек SILK буфера не содержит вовсе (декодер лишь принимает `SKP_int action, /* I Action from Jitter Buffer */`). Единственный технический первоисточник — патент US8855145B2/US9246644B2 (Vafin, Nilsson, Andersen, Jefremov, приоритет 2011-10-25), и он честно называет цену догона: *«Increasing or decreasing the jitter buffer delay means that a part of the signal has to be played out at the receiver slower or faster than intended, which can result in quality degradations»*. Предлагаемое решение — **обратное нашему**: пусть ОТПРАВИТЕЛЬ подстраивает битрейт/FEC/пакетизацию под состояние буфера приёмника, чтобы растягивать не пришлось. Числовых параметров в патенте нет. | патент |
| **Microsoft Teams** | Своего стека не открывают. Первоисточник по механике — патент US7596488B2 (Florencio, Chou, He, 2003): решение принимается по СОДЕРЖИМОМУ буфера, а не по таймингу пакетов, растяжение распределяется ОБРАТНО пропорционально энергии сегментов («80 % энергии в будущем → будущее тянем на 20 % нужных сэмплов»), приоритет сжатия: voiced и silence → нетранзиентные unvoiced → смешанные и транзиенты. **Прямой ответ на «микро-рывки»: догонять надо в паузах, а не посреди фразы.** | патент |
| **Zoom** | **Ни одной инженерной публикации про jitter buffer не найдено.** Единственный релевантный патент — US11711322B2 (2021): буфер уезжает на СЕРВЕР, и там «speed buffer» — *«acts as a pacer to output the encoded RTP packets at a consistent interval»*. Это ПЕЙСИНГ (равномерная выдача), а не догон: долг не сокращается. Проверено прицельно — сжатия времени в патенте нет. | патент |

**Ходячий миф, который надо похоронить:** число «jitter buffer Zoom растёт до 400 мс» гуляет по
блогам, но в документах Zoom и в патентах Zoom его нет. Использовать нельзя.

### 2.3 Плееры — единственное место, где догон скоростью реально работает в продакшене

Четыре топовых плеера решают задачу одинаково по СТРУКТУРЕ и по-разному по числам. Общий шаблон
(синтез четырёх реализаций, самого такого файла нет ни в одном репозитории):

```
каждый ТИК:
  1. ИЗМЕРЬ ДОЛГ            debt = currentLatency - targetLatency
  2. АДАПТИРУЙ ЦЕЛЬ         при ребуфере target += INCREMENT (Media3 0.5с, Shaka 0.5с, hls.js 1с)
                            при стабильности N сек target ползёт обратно (Shaka 60с; Media3 через 3σ)
  3. ESCAPE HATCH           если debt > MAX_DRIFT -> НЕ догоняем, а прыгаем/выбрасываем (dash.js 12с)
  4. ДЕДБЕНД                если |debt| < DEADBAND -> скорость ровно 1.0
                            (Media3 20мс | hls.js 50мс | Shaka 500мс | dash.js LoL+ 2% от target)
  5. БУФЕРНАЯ ЗАЩИТА        если впереди мало данных -> 1.0 (hls.js >1с; dash.js bufferLevel>target/2)
  6. ЗАКОН + КЛИП           rate = clamp(f(debt), MIN, MAX)
                            f = сигмоида (hls.js, dash.js) | 1+k*debt (Media3) | константа (Shaka)
  7. ГИСТЕРЕЗИС ПРИМЕНЕНИЯ  если |rate - currentRate| < MIN_STEP -> не трогать актуатор
                            (dash.js 0.02 | hls.js квантование 0.05 | Media3 такт 1000 мс)
```

Три реализации закона, все три подтверждены дословно:

```javascript
// hls.js — сигмоида + дедбенд + квантование (src/controller/latency-controller.ts, onTimeupdate)
if (inLiveRange && d > 0.05 && forwardBufferLength > 1) {
    max  = Math.min(2, Math.max(1.0, maxLiveSyncPlaybackRate));       // потолок 2.0
    rate = Math.round((2 / (1 + Math.exp(-0.75 * d - edgeStalled))) * 20) / 20;  // шаг 0.05
    media.playbackRate = Math.min(max, Math.max(1, rate));
} else if (media.playbackRate !== 1 && media.playbackRate !== 0) {
    media.playbackRate = 1;
}
// численно: d=0.05с -> 1.00 | 0.5с -> 1.20 | 1с -> 1.35 | 2с -> 1.65 | 4с -> 1.90 | 8с -> 2.00
// (таблица пересчитана скептиком независимо, все шесть значений сошлись)
```

```javascript
// dash.js — сигмоида + escape hatch + минимальный шаг применения (CatchupController.js)
if (maxDrift > 0 && deltaLatency > maxDrift) { seekToCurrentLive(); return; }   // 12 с -> ПРЫЖОК
if (playbackStalled) newRate = 1.0;                    // недавно был пустой буфер -> не гоним
else {
    cpr = (deltaLatency < 0) ? |cpr_min| : cpr_max;    // 0.5 -> коридор [0.5, 1.5]
    newRate = (1 - cpr) + (cpr * 2) / (1 + Math.exp(-deltaLatency * 5));
}
minPlaybackRateChange = isSafari ? 0.25 : 0.02 / (0.5 / cpr_max);
if (Math.abs(currentPlaybackRate - newRate) >= minPlaybackRateChange || newRate === 1.0)
    setPlaybackRate(newRate);   // комментарий в коде: "don't overload element with playbackrate changes"
// численно при cpr=0.5: 0 -> 1.000 | 0.1с -> 1.122 | 0.2с -> 1.231 | 0.5с -> 1.424 | 1.0с -> 1.493
```

```java
// Media3 / ExoPlayer — НАШ СТЕК. P-регулятор + дедбенд + такт + отступление после ребуфера
// (DefaultLivePlaybackSpeedControl.java)
// ВНИМАНИЕ: в Builder'е коэффициент переводится в микросекунды:
//   proportionalControlFactorUs = proportionalControlFactor / C.MICROS_PER_SECOND
// то есть 0.1 — это 0.1 НА СЕКУНДУ ошибки. Записывать формулу в микросекундах НЕЛЬЗЯ.
if (now - lastUpdateMs < minUpdateIntervalMs /*1000*/) return adjustedPlaybackSpeed;  // ТАКТ
adjustTargetLiveOffsetUs(liveOffsetUs);
error = liveOffsetUs - currentTargetLiveOffsetUs;
if (Math.abs(error) < maxLiveOffsetErrorUsForUnitSpeed /*20 мс*/) speed = 1f;         // ДЕДБЕНД
else speed = clamp(1f + 0.1f_per_sec * errorSec, 0.97f, 1.03f);                       // ЗАКОН+КЛИП

void notifyRebuffer() { currentTargetLiveOffsetUs += 500_000; }   // СЕТИ ПЛОХО -> ОТСТУПАЕМ
// цель держится на 3 сигма от минимально возможной задержки; комментарий в коде:
// "Stay in a safe distance (3 standard deviations = >99%) to the minimum possible live offset"
```

**Что важнее конкретных чисел:** у dash.js есть отдельный режим `liveCatchupModeStep` с ДВУМЯ
раздельными окнами — `step.start` (когда начать) и `step.stop` (когда вернуться к 1.0), и скорость в
нём БИНАРНАЯ. Документация к нему — это готовое обоснование решения Криника Р9.1:
*«The stop window… sets the point at which playback should return to unity… This parameter prevents
instability when using higher min and max playback rates and should be tuned to prevent overshooting
the target.»* Схема Криника «выбрали k и держим до победы + гистерезис включения/выключения» — это
буквально dash.js step mode.

### 2.4 IRL-стриминг (наш класс задач): догона НЕТ ни у кого

Проверены BELABOX/belacoder, BELABOX/srtla, Moblin (iOS), OBS. Везде одна и та же тройка: **фиксированный
буфер задержки + адаптивный битрейт + дроп опоздавшего.** Ускоренной отдачи накопленного нет нигде.

Зато у belacoder — эталон асимметричного регулятора на ОТПРАВИТЕЛЕ, и его структуру стоит скопировать
целиком (пороги считаются не от мгновенных значений, а от скользящих средних + джиттер):

```c
// belacoder.c, update_bitrate() — ВНИЗ агрессивно, ВВЕРХ осторожно
bs_th1 = max(50, bs_avg + bs_jitter*2.5);
bs_th2 = min(max(50, bs_avg + max(bs_jitter*3.0, bs_avg)), RTT_TO_BS(srt_latency/2));
bs_th3 = (bs_avg + bs_jitter) * 4;
rtt_th_max = rtt_avg + max(rtt_jitter*4, rtt_avg*15/100);
rtt_th_min = rtt_min + max(1, rtt_jitter*2);

if (bitrate > min_bitrate && (rtt >= srt_latency/3 || bs > bs_th3)) bitrate = min_bitrate;  // АВАРИЯ
else if (now > next_decr && (rtt > srt_latency/5 || bs > bs_th2)) bitrate -= 100000 + bitrate/10;
else if (now > next_decr && (rtt > rtt_th_max || bs > bs_th1)) bitrate -= 100000;
else if (now > next_incr && rtt < rtt_th_min && rtt_avg_delta < 0.01) bitrate += 30000 + bitrate/30;
//                          ^^^ вверх ТОЛЬКО если RTT около минимума И НЕ РАСТЁТ
```

И критически важный факт для любой схемы «накопил → отдал быстрее» по SRT: **ускоренная ОТПРАВКА
не сокращает задержку зрителя.** Документация Haivision дословно: TSBPD работает *«with strict goal
of keeping the time interval between two consecutive packets on the receiver side identical to what
they were at the sender side»*, `PTS[N] = ETS[N] + LATENCY`, и *«if the packet arrives early, it must
wait in the receiver buffer»*. Это независимое подтверждение вывода §13.1 нашего `network_resilience.md`
про «путь B не работает».

---

## 3. Таблица параметров индустрии (только подтверждённое скептиком)

> Правило таблицы: каждая строка перепроверена независимым агентом-скептиком по первоисточнику.
> Опровергнутое сюда НЕ попало (см. §7.2). Значения приведены как в источнике, без пересчётов;
> где пересчёт есть — он помечен.

### 3.1 WebRTC NetEQ — решающая логика

| Параметр | Значение | Где именно |
|---|---|---|
| Нижний порог (включение НАКОПЛЕНИЯ) | `low_limit = TargetLevelMs()` | [decision_logic.cc:269](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/decision_logic.cc) |
| Верхний порог (включение ДОГОНА) | `high_limit = low_limit + GetMaxDelayMs() + 20 мс` | decision_logic.cc:270-272 |
| Гранулярность порога | `kDelayAdjustmentGranularityMs = 20` (комментарий: реальная гранулярность коррекции 15 мс, округлено вверх из-за 10-мс тика) | decision_logic.cc:35-37 |
| Окно наблюдения разброса | `kPacketHistorySizeMs = 2000` | decision_logic.cc:38 |
| Порог аварийного догона | `playout_delay_ms >= high_limit * 4` → `kFastAccelerate`, **без** проверки `TimescaleAllowed()` | decision_logic.cc:273-275 |
| Рефрактерный период | `kMinTimescaleInterval = 5` тиков × 10 мс/тик = **50 мс** | [decision_logic.h:113](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/decision_logic.h) + [tick_timer.h:75](https://webrtc.googlesource.com/src/+/refs/heads/main/api/neteq/tick_timer.h) |
| Заявленный в коде потолок темпа (обычная ветка) | комментарий: *«The value 5 sets maximum time-stretch rate to about 100 ms/s»* | decision_logic.h:112 |
| Штраф только за успех | `IsTimestretch()` = только `kAccelerateSuccess/LowEnergy`, `kPreemptiveExpandSuccess/LowEnergy`; режимы `*Fail` не входят | decision_logic.cc:41-46, 111 |
| Порог возобновления после голодания | `kPostponeDecodingLevel = 50` (процентов от целевой задержки) | decision_logic.cc:33, 330-331 |
| Порог mute-фактора для продолжения PLC | `expand_mutefactor < 16384/2` (16384 = 1.0 в Q14) | decision_logic.cc:347-351 |
| Окно допуска «прыгать вперёд или маскировать» | `kTargetLevelWindowMs = 100` → `target + 50 мс` | decision_logic.cc:34, 296 |
| Fast-forward комфортного шума | `excess_waiting_time > optimal_level/2`; комментарий: *«longer than 1.5 times the wanted buffer delay»* | decision_logic.cc:226-234 |
| Таймаут комфортного шума | `kCngTimeoutMs = 1000` | decision_logic.cc:39 |

### 3.2 WebRTC NetEQ — расчёт целевой задержки

| Параметр | Значение | Где именно |
|---|---|---|
| Config по умолчанию | `quantile = 0.95`, `forget_factor = 0.983`, `start_forget_weight = 2`, `resample_interval_ms = 500`, `use_reorder_optimizer = true`, `reorder_forget_factor = 0.9993`, `ms_per_loss_percent = 20` | [delay_manager.h:33-40](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/delay_manager.h) |
| Стартовая цель | `kStartDelayMs = 80` | delay_manager.cc:27 |
| Гистограмма | `kDelayBuckets = 100`, `kBucketSizeMs = 20` (потолок 2000 мс); `optimal = (1 + Quantile(0.95)) * 20 мс` | [underrun_optimizer.cc:22-23, 58-64](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/underrun_optimizer.cc) |
| Что попадает в гистограмму | МАКСИМУМ задержки за окно ресемплинга 500 мс, а не каждое наблюдение | underrun_optimizer.cc:43-50 |
| Измеряемая величина | ОТНОСИТЕЛЬНАЯ задержка: `max(0, (t_arr − t_arr_min) − (rtp − rtp_min))`, база — лучший пакет окна | [packet_arrival_history.cc:99-112](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/packet_arrival_history.cc) |
| Жёсткие ограничения цели | потолок 75 % ёмкости буфера (`3 * max_packets * packet_len / 4`); база min-задержки 0…10000 мс | [delay_constraints.cc:20-21, 36-40](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/delay_constraints.cc) |
| Дефолты подсистемы | `sample_rate_hz = 48000`, `max_packets_in_buffer = 200`, `enable_fast_accelerate = false` | [api/neteq/neteq.h:133-140](https://webrtc.googlesource.com/src/+/refs/heads/main/api/neteq/neteq.h) |

### 3.3 WebRTC NetEQ — сама растяжка (DSP)

| Параметр | Значение | Где именно |
|---|---|---|
| Требуемый объём на одну операцию | `240 * fs_mult` = ровно **30 мс** (комментарий «Must have 30 ms») | [neteq_impl.cc:1524-1525](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/neteq_impl.cc) |
| Поиск периода основного тона | `kCorrelationLen = 50`, `kMinLag = 10`, `kMaxLag = 60` (домен 4 кГц) → полоса **66.7…400 Гц** (пересчёт) | [time_stretch.h:85-90](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/time_stretch.h) |
| Порог качества склейки | `kCorrelationThreshold = 14746` = **0.9** в Q14; в fast-режиме **8192** = 0.5 | time_stretch.h:90, [accelerate.cc:58-59](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/accelerate.cc) |
| VAD внутри растяжки | не активная речь, если `(E1+E2)/(2*peak) <= 8 * энергия_фонового_шума`; при неинициализированной оценке порог 75000 | time_stretch.cc:184-200 |
| Величина одного шага коррекции | один период тона: **2.5 мс ≤ P ≤ ~14.9 мс** (выведено из DCHECK'ов) | time_stretch.cc:80-84 |
| Кроссфейд | линейный в Q14, длина = ровно один период; первые 15 мс не трогаются | [audio_vector.cc:267-292](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/audio_vector.cc) |
| Fast-режим | вырезается столько целых периодов, сколько влезает в 15 мс: `peak_index = (fs_mult_120 / peak_index) * peak_index` | accelerate.cc:71 |
| Асимметрия | у `PreemptiveExpand` быстрого режима НЕТ: `const bool kFastMode = false;  // Fast mode is not available for PE Expand.` | [preemptive_expand.cc:41](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/preemptive_expand.cc) |
| Отмены ускорения | если осталось ≥10 мс несыгранного и кадр ≥30 мс → понижение до `kNormal` (*«Avoid decoding more data as it might overflow the playout buffer»*) | neteq_impl.cc:1099-1110 |

### 3.4 Плееры live-стриминга

| Плеер | Коридор скорости | Дедбенд | Гистерезис применения | Escape hatch / отступление |
|---|---|---|---|---|
| **Media3 / ExoPlayer** (наш стек) | **0.97 … 1.03** | 20 мс | такт 1000 мс между сменами | +500 мс к цели на каждый ребуфер; возврат — не ближе 3σ от минимально возможной задержки; сглаживание 0.999 |
| **Shaka Player** | 0.95 … 1.1 (дока: *«recommended to use a value between 1 and 2»*) | ±0.5 с (`targetLatencyTolerance` при `targetLatency` 0.5 с) | bang-bang, промежуточных скоростей нет | `panicMode` 60 с принудительного замедления после ребуфера; цель +0.5 с за ребуфер, максимум 10 раз, потолок 4 с, возврат после 60 с стабильности |
| **hls.js** | **по умолчанию ВЫКЛЮЧЕН** (`maxLiveSyncPlaybackRate = 1`), диапазон 1…2 | 0.05 с + требование >1 с в буфере впереди | квантование к шагу 0.05 | +1 с к цели за каждый стол, но не больше одной `targetduration` |
| **dash.js** | **0.5 … 1.5** (дефолт `cpr = 0.5`); абсолютные лимиты 0.5…2.0 | LoL+: 2 % от целевой задержки | `minPlaybackRateChange = 0.02` (Safari 0.25, из-за webkit bug 208142) | `maxDrift = 12 с` → **seek на live** вместо догона; при недавнем столе — скорость ровно 1.0 |

| Прочие ориентиры плееров | Значение | Источник |
|---|---|---|
| Media3 HLS: цель по умолчанию | `startOffset → PART-HOLD-BACK → HOLD-BACK → 3 × targetDuration` (комментарий: «Fallback, see RFC 8216, Section 4.4.3.8») | HlsMediaSource.java |
| Media3 DASH: фолбэк цели | `DEFAULT_FALLBACK_TARGET_LIVE_OFFSET_MS = 30_000` | DashMediaSource.java |
| HLS spec | `HOLD-BACK` MUST ≥ 3 × Target Duration (отсутствие подразумевает ровно 3×); `PART-HOLD-BACK` MUST ≥ 2×, SHOULD ≥ 3× Part Target Duration. **Требований к playback rate в спеке НЕТ вообще** | draft-pantos-hls-rfc8216bis-18, §4.4.3.8 |
| DASH-IF LL | *«should play the content within 500ms tolerance of the target latency»*; `PlaybackRate@min/@max` только качественно, **числовых рекомендаций нет** | CR-Low-Latency-Live-r8, §9.X |
| BBC R&D, практический коэффициент | `maxDrift = 5 с`, `playbackRate = 0.17` (→ **1.17×**): *«at maximum rate, the stream would catch up approximately 5 seconds within a 30 second window»* | arXiv:2304.13551, §2.2 |

### 3.5 Наука: восприятие и классические алгоритмы

| Что | Значение | Источник |
|---|---|---|
| JND темпа речи | **≈ 5 %** | Quené (2007), J. Phonetics 35(3):353–362 — прочитано ЧЕРЕЗ цитирование в открытой Plug & Smith (2021) |
| Незаметное ЗАМЕДЛЕНИЕ | 0.9 — незаметно (DMOS 4.7); 0.8 — незаметно для половины контента; 0.6–0.7 — так же плохо, как ребуферинг | «Drop or Stop», §V.B / Conclusion |
| УСКОРЕНИЕ 1.2 | средний MOS **3.9–4.0** (три условия) | «Drop or Stop», §V.B |
| Рампа скорости | для целевой **1.3**: +0.2 MOS при нарастании 0.1/с и **+0.4** при 0.05/с; *«the more gentle gradual changes of 0.05/s were perceived better»*. Для 1.2 выигрыша практически нет — авторы сами пишут, что эффект зависит от скорости и контента | «Drop or Stop», §V.A–V.B |
| Что вообще тестировали | **только 0.7 / 0.8 / 1.2 / 1.3**, 120 участников, 102 последовательности | «Drop or Stop», §V |
| Compressed speech: понимание | норма 165 wpm → 25.85/36; 1.25× (206 wpm) → 24.05; **1.67× (275 wpm) → 19.45** (минус ~25 %) | Sticht, ERIC ED066080, Table I (280 испытуемых) |
| «Незаметно до 25 %» | *«Informal subjective tests have shown that slowing the playout rate of video and audio up to 25% is often un-noticeable»* — **НЕФОРМАЛЬНЫЕ тесты, и речь о ЗАМЕДЛЕНИИ** | Kalman/Steinbach/Girod, ISCAS'02 |
| Бытовой прецедент | кино 24 fps в PAL показывают на 25 fps = ускорение **4.17 %**, зрители не замечают | ISCAS'02, §2 |
| Liang'03: клампы масштабирования | `L_max = 2.3·L_0`, `L_min = 0.3·L_0`; **во время ПАУЗ ограничения не действуют** | IEEE TMM 5(4):532–543, §III-B |
| **Liang'03: главное число для нас** | реально применявшиеся коэффициенты доходили до 0.35–2.3, но масштабировано было лишь **17.8 % / 18.4 % / 24.1 %** пакетов, и DMOS вышел **4.7 / 4.5 / 4.6** при контроле 4.8. Авторы прямо: *«packets actually do not have to be scaled very frequently»* | Table III + §VII |
| Moon'98: спайк-гистерезис | вход `d̂ > head·p̂` при **head = 4**, выход `d̂ ≤ tail·old_d` при **tail = 2**; алгоритм нечувствителен при head 2…10 и tail 1…3 | Multimedia Systems 6:17–28, §4.2 |
| Moon'98: диагноз агрессивности | *«Algorithm 2 attempts to track the network delays too closely and loses packets whenever its delay estimate is small»* | §4.4 |
| Ramjee'94: асимметрия | при РОСТЕ задержки β = **0.75** (быстро), при спаде α = **0.998002** (почти не двигаемся) | INFOCOM'94, §3.2 |
| WSOLA: рекомендуемые параметры | длина кадра N ≈ **50 мс**, допуск Δmax ≈ **25 мс** | Driedger & Müller (2016), §4.3 |
| WSOLA: риск ИМЕННО нашего режима | *«transient skipping usually happens when the signal is compressed (α < 1)»* — при ускорении пропадают резкие атаки; лечится локальной фиксацией `H_a = H_s` возле транзиента | Driedger & Müller (2016), §4.2 |

### 3.6 Патенты, где догон делает отдающая сторона (единственные найденные прецеденты)

| Патент | Что делает | Числа |
|---|---|---|
| **US6598228B2** (Hejna, Enounce → Virentem, приоритет 1999) | «Variable Rate Broadcaster»: СЕРВЕР гонит клиенту поток с изменённой скоростью, пока тот не сольётся с live | диапазон **0.5×…2.0×**, примеры ставок **5/3** (догон) и **5/8** (подождать); пороги буфера `T_L`/`T_H`, и дословно: *«changes in the amount of data… which remain between low threshold level T_L and high threshold level T_H do not cause any change in playback rate»* |
| **US20160105473A1** (Klingbeil, Marks, Amazon, 2014) | Ровно «накопили → отдали быстрее», но на ПРИЁМНИКЕ: при событии задержки воспроизведение останавливают, буфер раздувают до refill level, затем возобновляют УСКОРЕННОЕ воспроизведение | `refill level = LatenessDuration × refill factor`, *«typically between 1.0-3.0»*; порог «хорошей сети» по вариации queuing delay — например 100 мс; порог комфорта разговора — 250 мс |

### 3.7 Инструмент растяжения для Android (что реально брать в код)

| Параметр | Значение | Источник |
|---|---|---|
| Рекомендуемый движок | **Sonic** (Bill Cox), лицензия **Apache 2.0**, в AOSP как `platform/external/sonic` | github.com/waywardgeek/sonic + android.googlesource.com |
| Готовая обёртка | `androidx.media3.common.audio.SonicAudioProcessor` (`@UnstableApi`, публичный), артефакт **`media3-common`** | androidx/media |
| Алгоритм ниже 2× | **PICOLA**: *«For speech rates below 2X, sonic uses PICOLA, which I find to be the best algorithm available»* | doc/index.md |
| Полоса основного тона | `MINIMUM_PITCH = 65`, `MAXIMUM_PITCH = 400` Гц — **совпадает с полосой NetEQ 66.7…400 Гц** | Sonic.java / sonic.h |
| Задержка | заявлено 31 мс; из кода `maxRequiredFrameCount = 2 * sampleRate/65` → **30.75 мс** @48 кГц и @16 кГц, 30.748 мс @44.1 кГц. **Не зависит ни от sample rate, ни от коэффициента** | Sonic.java (пересчёт скептиком подтверждён) |
| Цена CPU | тяжёлый поиск периода идёт на даунсемпле до 4 кГц (`AMDF_FREQUENCY = 4000`, на 48 кГц `skip = 12`), ветка short — целочисленная | Sonic.java |
| Накопление ошибки | `accumulatedSpeedAdjustmentError` копит дробный остаток → **длительность не «плывёт»** при дробных k | Sonic.java, skipPitchPeriod/insertPitchPeriod |
| Доля НЕтронутого звука | `copy = period·(2−k)/(k−1)`: k=1.15 → 5.67 периода; k=1.25 → 3.0; **k=1.5 → 1.0**; k=2.0 → 0 | выведено из Sonic.java (пересчитано скептиком) |
| Границы AOSP для голосового режима | `TIMESTRETCH_SONIC_SPEED_MIN 0.1f`, `MAX 6.0f` (общесистемные 0.01…20.0) | system/audio.h:2268-2270 |
| Системный «антидребезг» | `AUDIO_TIMESTRETCH_SPEED_MIN_DELTA 0.0001f` — *«minimum absolute speed difference that might trigger a parameter update»* | system/audio.h:2254 |
| Порог no-op в Media3 | `CLOSE_THRESHOLD = 0.0001f`; в самом Sonic `MINIMUM_SPEEDUP_RATE = 1.00001f` — вне окрестности единицы буфер просто копируется. **Скорость 1.0 бесплатна** | SonicAudioProcessor.java / Sonic.java |
| **ЛОВУШКА** | `SpeedChangingAudioProcessor.updateSpeed()` делает `setSpeed(x)` И `setPitch(x)`, а внутри `s = speed/pitch` → при равных значениях растяжение ВЫКЛЮЧАЕТСЯ, остаётся чистый ресемплинг (тембр уезжает). Нужен голый `SonicAudioProcessor.setSpeed(k)` при `pitch = 1f` | SpeedChangingAudioProcessor.java:395-401 |
| Цена смены скорости | `setSpeed` ставит `pendingSonicRecreation = true`; Media3 после каждой смены зовёт `flush()`. **Частая смена k = частый сброс состояния Sonic** — прямой инженерный аргумент за гистерезис | SonicAudioProcessor.java |
| SoundTouch — почему нет | LGPL v2.1 + «commercial license alternative… contact author»; WSOLA-like; дефолты автором объявлены музыкальными, под речь есть отдельный ключ `-speech` | surina.net/soundtouch/README.html |
| ffmpeg atempo (для сверки) | диапазон [0.5, 100.0]; *«tempo greater than 2 will skip some samples rather than blend them in»* → **до 2× качество деградирует плавно** | ffmpeg-filters, §8.65 |

### 3.8 Протокол: что ограничивает нас по времени

| Что | Значение | Источник |
|---|---|---|
| Единица времени RTMP | *«Timestamps in RTMP are given as an integer number of milliseconds»*; дельты тоже в мс, 24 или 32 бита | RTMP 1.0 spec, §4 |
| Откат времени назад | chunk header Type 0 *«MUST be used… whenever the stream timestamp goes backward»* — сжимать дельты можно, двигать время назад дорого. **Догон обязан быть монотонным** | RTMP 1.0, §5.3.1.2.1 |
| Расширенный timestamp | при ≥ 16777215 (0xFFFFFF) включается Extended Timestamp | RTMP 1.0, §5.3.1.3 |
| Переполнение | 32-битные таймстемпы *«roll over every 49 days, 17 hours, 2 minutes and 47.296 seconds»*, требуется serial-арифметика RFC1982 | RTMP 1.0, §4 |
| FLV composition time | SI24, *«The offset in an FLV file is always in milliseconds»* | enhanced-rtmp-v2 |
| fps в метаданных H.264 | живёт в VUI SPS (`tick_rate = time_scale / num_units_in_tick`, `fixed_frame_rate_flag`) и правится без перекодирования (`h264_metadata` bsf). При сжатии PTS поток становится внутренне противоречивым, если SPS не поправить | ffmpeg-bitstream-filters |
| SRT: ускоренная отдача НЕ помогает | TSBPD *«strict goal of keeping the time interval… identical to what they were at the sender side»*, `PTS[N] = ETS[N] + LATENCY`, ранний пакет ЖДЁТ в приёмном буфере | Haivision/srt, docs/features/latency.md |
| Единственное официальное sender-side «догоняющее» средство | ffmpeg `-readrate_catchup` — ускоряет ДОСТАВКУ, но не таймлайн (PTS не меняются) | ffmpeg.html |

---

## 4. Научная база

**Три работы образуют линию, и наша задача стоит на третьей из них.**

**Ramjee, Kurose, Towsley, Schulzrinne (INFOCOM'94)** — фундамент. Playout-точка первого пакета
фразы: `p_i = t_i + d̂_i + 4·v̂_i` (уравнение 1), дальше внутри фразы строго периодически
`p_j = p_i + (t_j − t_i)` (уравнение 2). **Внутри фразы задержка не подстраивается вообще** — весь
ресурс адаптации это ТИШИНА: *«Compression or expansion of silence by a small amount is not
noticeable in the played-out speech»*. Победитель статьи — Алгоритм 4 с детектором спайков: внутри
спайка оценка не сглаживается, а следует за фактом один-в-один (`d̂_i = d̂_{i−1} + n_i − n_{i−1}`).
Урок для нас: **аварийный режим должен отключать сглаживание, а не усиливать его.**

> Осторожно, если кто-то откроет PDF: в опубликованном тексте уравнение (3) напечатано с опечаткой
> (`|d̂_i − n_1|` вместо `n_i`), а рисунок с псевдокодом Алгоритма 2 подписан «Figure 4: Algorithm 4».
> Обе опечатки — первоисточника, подтверждены двумя независимыми проверками.

**Moon, Kurose, Towsley (Multimedia Systems 6:17–28, 1998)** — замена экспоненциального фильтра на
ГИСТОГРАММУ задержек с заданной перцентилью (прямой предок NetEQ DelayManager) плюс двухрежимный
спайк-детектор с РАЗНЫМИ порогами входа и выхода (head = 4, tail = 2). Формула playout обобщена до
`p̂_k = û + β·v̂`, где β — единственная ручка наружу, которой рулят компромиссом «задержка против
потерь». Отдельная ценность: авторы вычислили теоретический оптимум offline и показали, что верхняя
и нижняя границы близки при потерях ≥ 1 % — то есть у онлайн-алгоритмов есть бенчмарк.

**Liang, Färber, Girod (IEEE Trans. Multimedia 5(4):532–543, 2003)** — ближайший научный аналог
задачи Криника: подстройка идёт ВНУТРИ фразы, каждый пакет масштабируется индивидуально
однопакетной WSOLA без добавочной задержки. Их закон управления — это буквально то, что нам нужно:

```
// Figure 4 статьи, дословно:
 1  Receive packet i;
 2  Estimate and set the playout time for packet i+1, t̂_p^{i+1};
 3  Calculate the desired length of packet i, L̂^i = t̃_p^{i+1} − t_p^i;
 4  if L̂^i − L_0 > expansion_threshold
 5      Scale packet i with target length min(L̂^i, L_max);      // L_max = 2.3·L_0
 6  elseif L̂^i − L_0 < −compression_threshold
 7      Scale packet i with target length max(L̂^i, L_min);      // L_min = 0.3·L_0
 8  else
 9      Keep packet i without modification;                     // <-- МЁРТВАЯ ЗОНА
10  endif
11  Output packet i with actual length L^i;
12  Update the playout time of packet i+1, t_p^{i+1} = t_p^i + L^i;
```

Слово *hysteresis* — авторское, не притянутое: *«The compression threshold is usually greater than a
typical pitch period… smaller expansion thresholds are defined, which might be smaller than a pitch
period. This asymmetry results in a hysteresis… The introduced hysteresis also results in smoothed
playout jitter.»* **Числовые значения порогов в статье НЕ приведены — только качественно.** То есть
даже канон не даёт готовых чисел для главной ручки; их придётся калибровать.

Самый важный для нас результат этой статьи — субъективный (ITU-T P.800 DCR, 18 слушателей):
деградация *«between inaudible and not annoying, even for extreme cases»*, DMOS 4.5–4.7 против
контрольных 4.8 — **притом что коэффициенты доходили до 0.35…2.3**. Объяснение авторов прямое:
*«packets actually do not have to be scaled very frequently»* — масштабировалось 17.8–24.1 % пакетов.
**Вывод, который стоит всей статьи: качество определяет ЧАСТОТА вмешательства, а не его величина.**

Отдельно — режим быстрой адаптации на спайках (§IV-B): при скачке задержки алгоритм ЗАМОРАЖИВАЕТ
статистику, жертвует одним пакетом, а по возвращении к норме **ВОССТАНАВЛИВАЕТ сохранённое состояние,
накопленное до спайка**, а не переучивается. Аварийный эпизод не должен отравлять долговременную
статистику — это прямо переносится на нас.

**Инструментальная база (Driedger & Müller, Applied Sciences 6(2):57, 2016, open access)** — полный
вывод OLA и WSOLA. Ключевой шаг WSOLA:

```
Δ_{m+1} = argmax_{Δ ∈ [−Δmax : Δmax]}  c( x̃_m , x⁺_{m+1} , Δ )     // взаимная корреляция
y_{m+1}(r) = w(r) · x(r + (m+1)·H_a + Δ_{m+1}) / Σ_n w(r − n·H_s)
α = H_s / H_a       // α < 1 — УСКОРЕНИЕ, наш случай
```
Рекомендации: N ≈ 50 мс, Δmax ≈ 25 мс. И предупреждение прямо про наш режим: при сжатии (α < 1)
возникает **transient skipping** — пропадают резкие атаки; лечится тем, что возле транзиента
`H_a` временно приравнивается `H_s`, а расхождение компенсируется между атаками.

**Восприятие.** JND темпа речи ≈ 5 % (Quené 2007 — прочитано только через цитирование в открытой
Plug & Smith 2021, детали эксперимента не проверены). То есть **любой догон быстрее ~1.05 слушатель
в принципе способен заметить**; вопрос не «незаметно», а «терпимо». Данные о терпимости: 1.2 → MOS
3.9–4.0 («Drop or Stop», 120 участников); 1.25× почти не вредит пониманию, 1.67× стоит четверти
понимания (Sticht, 280 испытуемых). Для 1.5 данных нет ни у кого.

> **Чего в науке НЕТ:** ни одной рецензируемой работы, где догон делается на ОТПРАВИТЕЛЕ живого
> стрима. Весь класс adaptive media playout — приёмный. Скептик отдельно отметил, что смежный
> патентный пласт (US 10785511 «Catch-up pacing for video streaming», US 8285886, US 7237254) не
> просмотрен и формулировка «нет прецедента вообще» переуверенна — но ни один из этих патентов на
> предмет временного сжатия у отправителя не проверялся, поэтому в выводы они не входят.

---

## 5. Ключевое различие приёмник / отправитель — и что нам с этого

Задача ставилась прямо: проверить, где приёмы переносимы, а где нет. Ответ честный и он делится на
три части.

### 5.1 Что НЕ переносится — и это половина канона

**1. Вся машинерия оценки задержки нам не нужна вообще.** Экспоненциальные фильтры Ramjee,
гистограммы Moon, порядковые статистики Liang, перцентильный `DelayManager` NetEQ, вычитание
базовой линии в `packet_arrival_history` — всё это существует ровно потому, что приёмник НЕ ЗНАЕТ,
сколько данных «должно» быть, и вынужден оценивать это по статистике прибытия с чужими часами.
**Наш долг измеряется напрямую и точно**: мы знаем, сколько миллисекунд медиавремени лежит в нашем
буфере. Шума измерения нет — шум только в сети. Это значит, что сглаживание сигнала решения нам не
нужно (и текущий NetEQ его тоже не делает — см. §7.2), а перцентильная гистограмма нужна не для
оценки долга, а только для оценки РАЗБРОСА, чтобы вывести ширину мёртвой зоны.

**2. DSP-часть NetEQ не переносится в архитектуре «буферим закодированное».** `Accelerate` и
`PreemptiveExpand` работают по декодированному PCM 30-мс блоками (`const int16_t*`). Если мы копим
уже закодированные AAC-кадры, применить это без `decode → stretch → encode` нельзя. У нас это уже
зафиксировано независимо в `network_resilience.md` §13.5: кадр AAC-LC — ровно 1024 сэмпла, деление
PTS на 1.5 даёт дрейф ~0.5 с рассинхрона на секунду эфира. Канон это подтверждает с другой стороны.

**3. Половина NetEQ нам не нужна вовсе.** `Expand`, `Merge`, `Rfc3389Cng` — это маскировка потерь:
«нечего играть». У нас проблема обратная — «накопилось слишком много». Аналог `PreemptiveExpand` на
отправителе вырождается: «не отдавать быстрее, чем снимаем» выполняется само собой.

**4. Опора на тишину не переносится.** У Ramjee и Moon тишина — единственный ресурс подстройки.
Патент Microsoft US7596488B2 строит на этом весь приоритет (voiced и silence сжимаем первыми,
транзиенты последними). NetEQ имеет встроенный VAD и ОТКАЗЫВАЕТСЯ растягивать активную речь с
низкой корреляцией. **У Sonic такого отказа нет — он растянет всё, что дадут.** У стримера с музыкой
и уличным шумом надёжного детектора тишины нет. Это реальный, неснятый риск качества (§7.1).

**5. У приёмника есть обратная связь, у нас её нет.** NetEQ знает свой буфер до playout; плеер знает
`liveOffset`. Мы не знаем ничего о буфере YouTube/Twitch. Единственный «сендерный» рычаг, который
вообще существует в отрасли, — RTP-расширение `playout-delay` (12 бит на min и max, 0–40950 мс, шаг
10 мс), но это ПРОСЬБА к приёмнику, и в RTMP-ингесте его нет.

**6. Риск двойного догона.** Плеер зрителя на YouTube/Twitch тоже подтягивается к live-краю — это
делают ВСЕ четыре изученных плеера. Если мы сожмём таймлайн у себя, а их плеер параллельно ускорится,
эффекты сложатся, и зритель получит рывок, которым мы не управляем. Алгоритмы плееров YouTube и
Twitch закрыты — первоисточника нет.

**7. Видео.** У NetEQ нет видео-аналога `Accelerate` вообще: видео-jitter-buffer — другой модуль, и
растяжения времени в нём нет. Канонического ответа на «как синхронно догонять видео» индустрия не
даёт. У Liang масштабируется ТОЛЬКО звук — приёмник сам подгоняет видео. Нам придётся решать это
самим (в нашей архитектуре — через «ускоренный плейбек» буфера композитором, см.
`network_resilience.md` §13.2).

### 5.2 Что переносится один-в-один

Закон управления нейтрален к тому, где стоит актуатор. Переносится целиком:

1. **Два порога с мёртвой зоной вместо одного порога** — NetEQ, Liang, dash.js step, Enounce.
2. **Адаптивная ширина зоны от наблюдаемого разброса** (`GetMaxDelayMs()` за окно + гранулярность).
3. **Рефрактерный период** между коррекциями — NetEQ 50 мс, Media3 1000 мс.
4. **Минимальный шаг применения** — dash.js 0.02, hls.js квантование 0.05, AOSP 0.0001.
5. **Отдельная аварийная ветка при большом долге, обходящая ограничитель частоты** — NetEQ ×4.
6. **Отступление после аварии**: цель растёт на каждый сбой и медленно возвращается — Media3 +500 мс
   и 3σ, Shaka +0.5 с / потолок 4 с / возврат после 60 с стабильности, hls.js +1 с за стол.
7. **Не начинать, пока нечем**: буферная защита hls.js (>1 с впереди), dash.js (`bufferLevel >
   target/2`), NetEQ `PostponeDecode` (50 % цели), belacoder (вверх только если RTT не растёт).
8. **Escape hatch**: при слишком большом долге НЕ догонять, а прыгать — dash.js `maxDrift = 12 с`,
   Telegram `ResyncNeeded` → `discardAllPendingSegments()`.
9. **Замораживать статистику на время аварии и ВОССТАНАВЛИВАТЬ её после** — Liang §IV-B.
10. **Сам инструмент растяжения** — Sonic/PICOLA для речи, с теми же границами полосы тона
    (65…400 Гц у Sonic, 66.7…400 Гц у NetEQ — два независимых движка сошлись).
11. **Правило «качество важнее догона»** — NetEQ отменяет операцию при плохой корреляции.
12. **Правило «частота важнее величины»** — Liang, Table III.

### 5.3 Что в нашей схеме дороже, чем у них

- **У них догон бесплатен по битрейту, у нас — нет** (в архитектуре «переклейка PTS»). Отдавая
  1.5× кадров в секунду настенного времени, мы поднимаем мгновенный битрейт в аплинк ровно в 1.5 раза
  — то есть нагружаем ровно тот канал, который только что был узким. Это НАШ вывод, не цитата.
  В архитектуре «ускоренный плейбек с перекодированием» (`network_resilience.md` §13.2) битрейт
  остаётся профильным — это ещё один довод в её пользу, независимо пришедший из канона.
- **У них вырезанный кусок слышит один зритель, у нас — все и навсегда.** У приёмника ошибка
  растяжки стоит одного искажённого периода у одного слушателя. У нас всё уходит в архив
  трансляции.
- **У них шаг коррекции 2.5–15 мс, у нас — минуты.** NetEQ гасит десятки миллисекунд; мы обсуждаем
  долг в десятки секунд. Все числа канона придётся масштабировать по порядку величины, и именно
  поэтому их нельзя копировать как константы — копировать надо ФОРМУЛЫ.

---

## 6. Конкретное предложение для KrinikCam

> Решения владельца, от которых отталкиваемся (interview_011, Р9/Р9.1/Р10):
> потолок `k` = **1.5**, `k` адаптивный от размера долга, **догоняем ВЕСЬ долг** (пол «последние
> 10 с» ОТКЛОНЁН, цель — пустой буфер), включение/выключение — через **гистерезис**, конкретные
> пороги — **калибровать наблюдением, а не выдумывать**. Буфер 1 ГБ, дисковый.
>
> Всё ниже — `[NOT-TESTED]`. Числа даны либо ФОРМУЛОЙ, либо как **кандидат, требует замера**.

### 6.1 Отображение канона на нашу задачу

Ключевая подстановка, которая делает всю схему выводимой, а не выдуманной:

| NetEQ (приёмник) | KrinikCam (отправитель) |
|---|---|
| `playout_delay_ms` — оценка задержки | `D` — долг: миллисекунды медиавремени в буфере (**измеряется точно**) |
| `TargetLevelMs()` — цель, 95-й перцентиль | `D_off` = **0** — «в идеале буфер пустой» (решение Криника) |
| `high_limit = target + GetMaxDelayMs() + 20 мс` | `D_on = D_off + W`, где `W` — ширина мёртвой зоны, выводится из наблюдения |
| `kMinTimescaleInterval` = 50 мс | `T_refr` — минимальный интервал между сменами `k` |
| `kFastAccelerate` при `d ≥ 4·high_limit` | аварийная ступень лестницы `k = 1.5` |
| `PostponeDecode` (50 % цели) | гейт стабильности: не стартуем догон, пока линк не доказал устойчивость |
| Растяжка отменяется при корреляции < 0.9 | (у Sonic аналога нет — см. §7.1, открытый риск) |

Формула ширины мёртвой зоны — прямой перенос NetEQ:

```
W = max( G , J_recent )                                        // ширина мёртвой зоны
      где G       — гранулярность: минимальный долг, ради которого вообще стоит включаться
          J_recent — худший наблюдённый всплеск долга за окно T_hist

D_on  = D_off + W       // порог ВКЛЮЧЕНИЯ догона
D_off = 0               // порог ВЫКЛЮЧЕНИЯ (решение Криника: буфер пустой)
```

Кандидаты (**все требуют калибровки замером**):
- `G` — канон NetEQ берёт «размер одной коррекции, округлённый вверх до такта часов». Наш аналог —
  длительность одного сегмента буфера. В `network_resilience.md` §13.4 предложены сегменты ~10 с;
  тогда `G` **кандидат ≈ длительность сегмента**. Если сегменты станут короче — `G` уменьшится вслед.
- `T_hist` — у NetEQ 2000 мс при шаге коррекции 10 мс, то есть **200 тактов регулятора**. Наш такт
  на три порядка длиннее, поэтому `T_hist` **кандидат: 30–120 с, требует замера** на реальных
  трассах Криника (метро, лифт, улица).
- `J_recent` — считать так же, как NetEQ: не среднее, а МАКСИМУМ по окну, с экспоненциальным
  забыванием (`forget_factor` NetEQ = 0.983 на такт 500 мс — у нас такт другой, коэффициент
  пересчитывается под наш такт и **требует замера**).

### 6.2 Алгоритм

```
// [NOT-TESTED] — синтез канона под решения Криника. Все ЗАГЛАВНЫЕ параметры = кандидаты.

СОСТОЯНИЕ:
  D          — долг в мс (медиавремя в буфере), измеряется точно
  mode       ∈ {IDLE, ARMED, CATCHUP, PANIC}
  k_cur      — текущий коэффициент, стартует с 1.0
  k_target   — куда стремимся
  last_change_ms, outage_count

каждый ТАКТ (T_tick — кандидат 1000 мс, канон Media3 DEFAULT_MIN_UPDATE_INTERVAL_MS):

  // ---------- 0. ОБНОВИТЬ НАБЛЮДЕНИЕ (не решение!) ----------
  J_recent = max_over_window(D, T_hist) с экспоненциальным забыванием   // канон: NetEQ Histogram
  W        = max(G, J_recent)
  D_on     = D_off + W

  // ---------- 1. ESCAPE HATCH (канон: dash.js maxDrift, Telegram ResyncNeeded) ----------
  if D > D_panic:                          // D_panic — ПРОДУКТОВОЕ решение Криника, не техническое
      mode = PANIC                          // «догонять 30-минутный долг = 1.5 ч сломанного эфира»
      -> спросить владельца / выбросить хвост / писать в архив, но НЕ гнать вслепую
      k_cur = 1.0; continue

  // ---------- 2. ГЕЙТ СТАБИЛЬНОСТИ (канон: NetEQ PostponeDecode, OBS 4 c, belacoder, Shaka panic) ----------
  // Догон повышает нагрузку ровно на тот канал, который только что упал.
  if сеть_восстановилась_недавно и НЕ (линк стабилен T_stable подряд):
      mode = ARMED; k_cur = 1.0; continue    // копим дальше, но НЕ догоняем

  // ---------- 3. ГИСТЕРЕЗИС ВКЛЮЧЕНИЯ/ВЫКЛЮЧЕНИЯ (канон: NetEQ dead zone, dash.js step) ----------
  if mode != CATCHUP and D >= D_on:  mode = CATCHUP; k_target = ladder(D)   // ВХОД
  if mode == CATCHUP and D <= D_off: mode = IDLE;    k_target = 1.0         // ВЫХОД
  // между D_off и D_on при mode == IDLE не делаем НИЧЕГО — это «иногда немного копим»

  // ---------- 4. ЛЕСТНИЦА С ЗАПАЗДЫВАНИЕМ (решение Криника: k держится до победы) ----------
  // k_target ПЕРЕСЧИТЫВАЕТСЯ ТОЛЬКО ВВЕРХ, пока долг не погашен:
  if mode == CATCHUP: k_target = max(k_target, ladder(D))
  // вниз k возвращается один раз — в шаге 3, при D <= D_off.
  // Это канон Ramjee'94 §3.2: на рост реагируем быстро (β=0.75), на спад — почти не двигаемся.

  // ---------- 5. РЕФРАКТЕРНЫЙ ПЕРИОД + МИНИМАЛЬНЫЙ ШАГ (канон: NetEQ 50 мс, Media3 1000 мс, dash.js 0.02) ----------
  if now - last_change_ms < T_refr:            continue
  if |k_target - k_cur| < DELTA_K_MIN:         continue

  // ---------- 6. РАМПА (канон: «Drop or Stop», 0.05/с лучше 0.1/с и лучше скачка) ----------
  k_cur = step_towards(k_cur, k_target, RAMP_PER_SEC * T_tick)
  last_change_ms = now

  // ---------- 7. ПРИМЕНИТЬ ----------
  audio:  SonicAudioProcessor.setSpeed(k_cur)   // pitch = 1f !!! иначе тембр уедет
  video:  композитор читает буфер со скоростью k_cur (путь «ускоренный плейбек», §13.2)

ladder(D):                       // решение Криника: k зависит от размера долга, потолок 1.5
    // ГРАНИЦЫ СТУПЕНЕЙ — КАНДИДАТЫ, ТРЕБУЮТ ЗАМЕРА. Форма — из interview_011 Р9.1.
    // Каждая граница ступени тоже двойная: вверх по B_i, вниз не переходим вовсе (шаг 4).
```

### 6.3 Параметры: формулы, кандидаты и откуда они

| Параметр | Что это | Значение | Основание |
|---|---|---|---|
| `D_off` | порог выключения | **0** (пустой буфер) | решение Криника Р9.1 |
| `D_on` | порог включения | **формула** `D_off + max(G, J_recent)` | NetEQ `high_limit` |
| `G` | гранулярность | **кандидат** = длительность сегмента буфера, требует замера | NetEQ `kDelayAdjustmentGranularityMs` (там = размер одной коррекции, округлённый вверх) |
| `T_hist` | окно наблюдения разброса | **кандидат 30–120 с, требует замера** | NetEQ 2000 мс = 200 тактов; наш такт на 3 порядка длиннее |
| `T_tick` | такт регулятора | **кандидат 1000 мс** | Media3 `DEFAULT_MIN_UPDATE_INTERVAL_MS = 1000` |
| `T_refr` | рефрактерный период | **кандидат ≥ T_tick, требует замера** | NetEQ 50 мс при такте 10 мс = 5 тактов → наш аналог 5·T_tick — верхняя граница кандидата |
| `DELTA_K_MIN` | минимальный шаг k | **кандидат 0.02…0.05** | dash.js `minPlaybackRateChange = 0.02`; hls.js квантование 0.05 |
| `RAMP_PER_SEC` | скорость нарастания k | **кандидат 0.05/с** | «Drop or Stop»: 0.05/с лучше 0.1/с и лучше скачка (для k=1.3; для 1.2 эффекта почти нет — **проверить на нашем k**) |
| `k_max` | потолок | **1.5** | решение Криника; совпадает с дефолтным потолком dash.js; < 2× (граница качества Sonic/atempo) |
| `T_stable` | гейт стабильности | **кандидат, требует замера** | OBS `DBR_INC_TIMER = 4 с`; belacoder «вверх только если RTT не растёт»; Shaka `panicThreshold = 60 с` |
| `D_panic` | escape hatch | **продуктовое решение Криника**, не техническое | dash.js `maxDrift = 12 с` → seek; Telegram → `discardAllPendingSegments()` |
| Отступление после аварии | `D_off` растёт на N-й аварии? | **развилка для Криника** (см. ниже) | Media3 +500 мс/ребуфер, Shaka +0.5 с (max 4 с, возврат после 60 с), hls.js +1 с/стол |

**Развилка, которую канон ставит, а мы ещё не решали.** Все четыре плеера на каждый сбой
УВЕЛИЧИВАЮТ целевую задержку и возвращают её обратно только после долгой стабильности. Решение
Криника «догоняем ВЕСЬ долг, цель — пустой буфер» этому противоречит: при рецидивирующей сети мы
будем догонять, снова падать, снова догонять — и эфир превратится в чередование перемоток. Канон
предлагает вместо этого после N-го сбоя подряд перестать целиться в ноль и осесть на некотором
`D_off > 0`. Это ровно то, что владелец назвал «иногда немного копим», только автоматически.
**Требуется решение Криника: разрешаем ли системе самой отказываться от полного догона при
повторяющихся сбоях.**

### 6.4 Чем это отличается от наивной схемы «есть долг → жмём 1.5×»

| # | Наивная схема | Что ломается | Что даёт канон |
|---|---|---|---|
| 1 | один порог | дребезг: долг колеблется вокруг порога → k прыгает 1.0↔1.5 каждый такт | мёртвая зона `[D_off, D_on)`, ширина ВЫВЕДЕНА из наблюдаемого разброса |
| 2 | пересчёт k каждый такт | каждая смена `setSpeed` в Sonic = `pendingSonicRecreation` + `flush()` = сброс состояния = **ровно те микро-рывки, которых боится Криник** | рефрактерный период + `DELTA_K_MIN` + лестница «только вверх до победы» |
| 3 | мгновенный скачок k | скачок темпа воспринимается хуже плавного | рампа 0.05/с (единственное измеренное на людях улучшение) |
| 4 | нет гейта стабильности | стартуем догон в сеть, которая только что упала; в архитектуре «переклейка PTS» ещё и с ×1.5 битрейтом | `PostponeDecode` / OBS 4 с / belacoder «вверх только если RTT не растёт» |
| 5 | нет escape hatch | 30-минутный лаг = 1.5 часа сломанного эфира | dash.js: при `> maxDrift` не догоняем, а прыгаем |
| 6 | цель = константа | рецидивирующая сеть даёт бесконечное чередование перемоток | адаптивная цель, растущая на каждый сбой (Media3/Shaka/hls.js) |
| 7 | «догон = скорость» | внимание уходит на величину k | **Liang: качество определяет ЧАСТОТА вмешательства** (DMOS 4.5–4.7 при коэффициентах до 2.3, потому что трогали <25 % материала) |
| 8 | растягиваем всё подряд | ускорение посреди фразы слышнее, чем в паузе | Microsoft US7596488B2: сжимать в первую очередь тишину и voiced; NetEQ: отменять операцию при плохой корреляции |
| 9 | `setSpeed(k)` + `setPitch(k)` | тембр уедет: внутри Sonic `s = speed/pitch = 1` → растяжение выключается, остаётся ресемплинг | `setSpeed(k)` при `pitch = 1f` |

### 6.5 Что канон говорит про сам коэффициент 1.5

Честный итог, без подгонки под ответ:

- **Технически 1.5 безопасен.** Он ниже 2× — границы, на которой и Sonic переключает ветку, и ffmpeg
  `atempo` начинает выбрасывать сэмплы вместо смешивания. Он глубоко внутри AOSP-границ голосового
  режима (0.1…6.0). Он ровно равен дефолтному потолку dash.js. При k = 1.5 Sonic оставляет
  нетронутым ровно один период тона на каждую склейку (пересчёт по формуле из кода) — то есть
  «трогаем примерно половину звука».
- **Перцептивно 1.5 не измерен НИКЕМ.** Максимум, протестированный в рецензируемом исследовании, —
  1.3. При 1.2 MOS 3.9–4.0. При 1.67× понимание падает на четверть (Sticht). JND ≈ 5 %.
  1.5 лежит между «заметно» и «дорого», и где именно — неизвестно.
- **Канон приёмной стороны на порядок мягче** (Media3 ±3 %, Shaka 0.95–1.1, BBC 1.17, NetEQ ~100 мс/с
  на обычной ветке) — но противопоставлять «1.1 у взрослых / 1.5 у нас» НЕЛЬЗЯ: аварийная ветка
  NetEQ обходит ограничитель частоты и локально режет до нескольких периодов за операцию, а Liang
  реально применял коэффициенты до 2.3. Индустрия мягкая В СРЕДНЕМ, а не в пике.
- **Главный рычаг снижения вреда по данным Liang — не понижать потолок, а понижать ЧАСТОТУ и ДОЛЮ
  затронутого материала.** Для нас это переводится буквально: лучше редко и на 1.5, чем постоянно
  на 1.15. Что, приятным образом, совпадает с решением Криника «держим k до победы» и с гистерезисом.

---

## 7. Чего мы НЕ знаем

### 7.1 Открытые вопросы и чем их закрыть

| # | Вопрос | Почему открыт | Как закрыть замером |
|---|---|---|---|
| 1 | **Как звучит 1.5× на голосе Криника** | верхняя измеренная на людях граница — 1.3; для 1.5 данных нет ни в одной работе | взять его же архивную запись, прогнать `SonicAudioProcessor` на 1.1/1.2/1.3/1.5, слепое A/B самим Криником + 5–10 зрителей из чата. **Это дешевле любого спора** |
| 2 | **Как Sonic ведёт себя на НЕречи** | PICOLA ищет период основного тона; фоновая музыка, улица, аплодисменты ломают это допущение. NetEQ в такой ситуации ОТКАЗЫВАЕТСЯ растягивать (корреляция < 0.9), **у Sonic такого отказа нет** | прогнать те же коэффициенты на записи с музыкой/улицей/тишиной; если артефакты слышны — рассмотреть перенос VAD-условия NetEQ (`(E1+E2)/(2·P) ≤ 8·bg_noise`) как гейта «здесь не ускоряем» |
| 3 | **Цена Sonic по CPU и батарее на Titan 1** | **бенчмарков Sonic на ARM не существует нигде** — ни у автора, ни в AOSP, ни в Media3. Есть только качественное «works well on ARM CPUs without FPUs» и косвенное доказательство (AOSP держит его в аудиотракте) | прямой замер на устройстве: % ядра и мВт при k=1.0 (no-op) и k=1.5, одновременно с энкодером и композитором |
| 4 | **Примет ли YouTube/Twitch сжатые PTS** | документально закрыто только для Azure (там это ПРИЧИНА дисконнекта, `MPE_CAPACITY_LIMIT_REACHED`). Для YouTube/Twitch первоисточника нет ни у одного из шести углов разведки | **уже согласовано с Криником (Р11)**: скрытая трансляция, ffmpeg-поток на 1.2/1.5/2.0×, смотрим дисконнекты, здоровье и итоговый архив. Ставить ДО разработки догона |
| 5 | **Двойной догон** | плеер зрителя тоже тянется к live-краю; алгоритмы YouTube/Twitch закрыты | в том же эксперименте Р11 смотреть глазами зрителя: складываются ли ускорения |
| 6 | **Пороги гистерезиса числами** | канон даёт ФОРМУЛЫ, но не числа: у Liang значения `expansion_threshold`/`compression_threshold` в статье **не приведены вообще**, только качественно | снять трассы долга на реальных маршрутах Криника (метро/лифт/улица/дом), посчитать `J_recent` и распределение всплесков, вывести `W` и `T_hist` из данных. Криник это уже утвердил: «пороги агент откалибрует наблюдением, а не выдумает» |
| 7 | **Отступать ли после повторных сбоев** | канон единодушен (все 4 плеера отступают), решение Криника «догоняем всё» — против | **развилка для владельца**, см. §6.3 |
| 8 | **`D_panic`** | все плееры имеют escape hatch; у нас его нет, а буфер 1 ГБ (≈13 мин при 10 Мбит/с) при k=1.5 = ~26 мин догона | **развилка для владельца** |
| 9 | **Риск апгрейда RootEncoder** | в 2.4.7 (наша версия) ресинка таймстемпов нет; он появляется **в 2.6.0** (`if (clockPts - tsBuffer > 500_000) tsBuffer = clockPts;`) и сломает схему догона | зафиксировать как условие апгрейда; при переходе на ≥2.6.0 — перепроверить `AudioEncoder.calculatePts` |
| 10 | **ETSI TS 103 285 (DVB-DASH), clause 10.20.6 «catch-up modes»** | это ЕДИНСТВЕННЫЙ нормативный отраслевой документ про догон, на который ссылается DASH-IF. **etsi.org отдаёт 403/404** — не прочитан ни разведкой, ни скептиком | если понадобится нормативная опора — искать через библиотечный доступ; сейчас в выводы не входит |
| 11 | **ACM TOMM 10.1145/3410449 «Improved Jitter Buffer Management for WebRTC»** | dl.acm.org отдаёт 403. Статья существует (авторы и выходные данные подтверждены через DOI), содержание не проверено | ни одного числа оттуда не процитировано и цитировать нельзя |
| 12 | **PICOLA, первоисточник** (Morita & Itakura, ASJ 1986) | в открытом доступе не найден, работа японоязычная | формулы PICOLA взяты из РЕАЛИЗАЦИИ (код Sonic), библиография не воспроизводится |
| 13 | **Quené (2007), JND 5 %** | Elsevier и репозиторий отдают 403; значение подтверждено только через цитирование в открытой Plug & Smith (2021) | опираться на «≈5 %» как на округлённую цитату из вторых рук, не как на точную границу |
| 14 | **Sender-side патентный пласт** | US 10785511 «Catch-up pacing for video streaming», US 8285886, US 7237254 — не просмотрены. Утверждение «прецедента нет вообще» из-за этого переуверенно | отдельная короткая разведка по патентам, если решение о догоне будет принято |

### 7.2 ВЫБРОШЕНО скептиками — не вносить обратно

Список ошибок, найденных на этапе проверки. Он здесь, чтобы никто (включая будущего агента без
контекста) не втащил их назад из старых конспектов или из блогов.

1. **«NetEQ сглаживает уровень буфера IIR-фильтром перед сравнением с порогами»** — НЕВЕРНО для
   актуального кода. Решение принимается по НЕсглаженной относительной задержке; `BufferLevelFilter`
   используется только для статистики (`UnderTargetLevel()` — мёртвый код). Сглаживание было
   решающим в Chrome M91/M103 и удалено.
2. **«low_limit = max(target·3/4, target − 85 мс)»** — это код 2021 года (Chrome M91/M103), он НЕ
   работает ни в актуальном WebRTC, ни в сборке, которую отгружает Telegram (там
   `enable_stable_delay_mode = true`). Ловушка: зеркало `chromium.googlesource.com/external/webrtc`
   имеет ветку с именем `main`, отдаёт HTTP 200 и выглядит актуальным, но заморожено на коммите от
   2021-06-28.
3. **«DelayManager: квантиль 0.97, 100 корзин, forget_factor 0.9993»** — неверно. Актуально:
   **квантиль 0.95, forget_factor 0.983**; 0.9993 — это `reorder_forget_factor`, другой параметр.
4. **«Потолок догона в индустрии ~1.1×, значит 1.5 вне золотого стандарта»** — ОПРОВЕРГНУТО.
   Комментарий «~100 ms/s» ограничивает только обычную ветку `kAccelerate`; ветка `kFastAccelerate`
   стоит ДО гейта `TimescaleAllowed()` и его обходит, а в fast-режиме вырезается несколько целых
   периодов за операцию.
5. **«Рекомендация DASH-IF: PlaybackRate min 0.96 / max 1.04»** — таких чисел в
   CR-Low-Latency-Live-r8 НЕТ (проверено грепом по полному тексту). Гуляет только по вторичным
   пересказам.
6. **«Jitter buffer Zoom растёт до 400 мс»** — первоисточника не существует.
7. **Формула ExoPlayer `speed = 1 + 0.1 × (liveOffsetUs − targetUs)`** — опасный баг: множитель
   переводится в микросекунды в Builder'е (`proportionalControlFactorUs = factor / MICROS_PER_SECOND`).
   Реализованная буквально в микросекундах, эта формула даст `speed ≈ 10001` при ошибке 100 мс.
   Правильно: `speed = 1 + 0.1 × errorSec`.
8. **Liang, уравнение (4): `число_итераций = ⌊L̂/W⌋`** — в статье `⌊L̂/W⌋ − 1`. Без «−1» расчёт
   бюджета CPU завышается на итерацию и противоречит собственному числу статьи («at most three
   iterations»).
9. **«Liang'03 — первая работа с подстройкой внутри talkspurt»** — приоритет не подтверждается: у тех
   же авторов есть ICASSP'01 (DOI 10.1109/icassp.2001.941202) с той же идеей.
10. **«В NetEQ используется WSOLA»** — утверждать нельзя: слов WSOLA/SOLA/PSOLA в исходниках нет.
11. **RootEncoder 2.4.7: `TimestampMode` enum и ресинк 500 000 мкс** — В НАШЕЙ ВЕРСИИ ИХ НЕТ.
    `TimestampMode.kt` появляется в 2.5.5, порог 500 мс — в 2.6.0. В 2.4.7 есть только
    `boolean tsModeBuffer` и `pts = 1000000 * bytesRead / 2 / channels / sampleRate`.
12. **«RootEncoder берёт PTS от стенных часов»** — неточно: в 2.4.7 это `System.nanoTime()/1000`, а
    на master — `SystemClock.elapsedRealtimeNanos()/1000`. Оба МОНОТОННЫ и не прыгают от NTP. Зато
    есть `BaseEncoder.fixTimeStamp()`, который принудительно давит немонотонность — это более
    релевантный механизм для схемы догона, чем мифический ресинк.
13. **«В спеке RTMP не написано, что время в миллисекундах»** — написано, §4:
    *«Timestamps in RTMP are given as an integer number of milliseconds»*.
14. **Moblin — «iOS/Android»** — только iOS (README: «A free iOS app for IRL streaming»).
15. **Утверждение, что телеграмовские трансляции не документированы** — документированы:
    `core.telegram.org/api/group-calls` содержит и сегмент 1000 мс, и якорь −2000 мс, и правило
    «TIME_TOO_BIG → подождать 100 мс», и «любая другая ошибка → discard pending chunks and restart».

---

## 8. Источники

### Уровень 1 — исходный код и официальные спеки

**WebRTC NetEQ** (все файлы прочитаны целиком, сверены на двух зеркалах + три исторических среза
branch-heads):
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/decision_logic.cc (+ `.h`)
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/delay_manager.cc (+ `.h`)
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/underrun_optimizer.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/histogram.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/packet_arrival_history.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/delay_constraints.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/time_stretch.cc (+ `.h`)
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/accelerate.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/preemptive_expand.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/neteq_impl.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/audio_vector.cc
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/neteq/g3doc/index.md
- https://webrtc.googlesource.com/src/+/refs/heads/main/api/neteq/neteq.h , `tick_timer.h`
- https://webrtc.googlesource.com/src/+/refs/heads/main/media/engine/webrtc_voice_engine.cc
- https://webrtc.googlesource.com/src/+/main/docs/native-code/rtp-hdrext/playout-delay/README.md
- https://webrtc.googlesource.com/src/+/refs/heads/main/modules/pacing/g3doc/index.md
- ⚠️ https://chromium.googlesource.com/external/webrtc/+/branch-heads/4472 (M91), `/5060` (M103), `/5735` (M114) — исторические срезы. **Ветка `main` того же зеркала заморожена на 2021-06-28 — не использовать как актуальную.**
- https://chromiumdash.appspot.com/fetch_milestones (сопоставление branch-heads и версий Chrome)

**Telegram / Opus / SILK:**
- https://github.com/TelegramMessenger/tgcalls — ветка `development` (HEAD 2faee3b); `tgcalls/group/GroupInstanceCustomImpl.cpp`, `tgcalls/group/StreamingMediaContext.cpp`, `tgcalls/MediaManager.cpp`. **Ссылки на `/blob/master/` дают другой файл — использовать `development` или SHA.**
- https://core.telegram.org/api/group-calls — официальная спека Stream mode / RTMP mode
- https://core.telegram.org/constructor/groupCallStreamChannel , `/method/phone.getGroupCallStreamRtmpUrl`
- https://github.com/DrKLO/Telegram — вендорённый WebRTC (то, что Telegram реально собирает)
- https://www.rfc-editor.org/rfc/rfc6716.txt — §4.4.1 Clock Drift Compensation
- https://raw.githubusercontent.com/xiph/opus/main/include/opus_defines.h — `OPUS_GET_PITCH`
- https://www.ietf.org/archive/id/draft-vos-silk-02.txt — референсная реализация SILK

**Плееры:**
- https://raw.githubusercontent.com/androidx/media/release/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultLivePlaybackSpeedControl.java
- https://raw.githubusercontent.com/androidx/media/release/libraries/exoplayer_hls/.../HlsMediaSource.java , `.../dash/DashMediaSource.java`
- https://raw.githubusercontent.com/video-dev/hls.js/master/src/controller/latency-controller.ts , `src/config.ts` , `docs/API.md`
- https://raw.githubusercontent.com/Dash-Industry-Forum/dash.js/development/src/streaming/controllers/CatchupController.js , `models/MediaPlayerModel.js` , `core/Settings.js`
- https://raw.githubusercontent.com/shaka-project/shaka-player/main/lib/player.js , `lib/util/player_configuration.js` , `externs/shaka/player.js`
- https://developer.android.com/media/media3/exoplayer/live-streaming
- https://www.ietf.org/archive/id/draft-pantos-hls-rfc8216bis-18.txt

**Протоколы и IRL:**
- https://veovera.org/docs/legacy/rtmp-v1-0-spec.pdf ; https://github.com/veovera/enhanced-rtmp/blob/main/docs/enhanced/enhanced-rtmp-v2.md
- https://raw.githubusercontent.com/Haivision/srt/master/docs/features/latency.md , `docs/API/API-socket-options.md`
- https://raw.githubusercontent.com/BELABOX/belacoder/master/belacoder.c ; https://raw.githubusercontent.com/BELABOX/srtla/master/README.md
- https://raw.githubusercontent.com/obsproject/obs-studio/master/plugins/obs-outputs/rtmp-stream.c
- https://raw.githubusercontent.com/eerimoq/moblin/main/README.md
- https://ffmpeg.org/ffmpeg.html , https://ffmpeg.org/ffmpeg-filters.html , https://ffmpeg.org/ffmpeg-bitstream-filters.html

**Time-stretch для Android:**
- https://github.com/waywardgeek/sonic/blob/master/doc/index.md , `sonic.h`
- https://android.googlesource.com/platform/external/sonic/ (Apache 2.0)
- https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/media/libaudioprocessing/BufferProviders.cpp
- https://android.googlesource.com/platform/system/media/+/refs/heads/main/audio/include/system/audio.h
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/media/java/android/media/PlaybackParams.java
- https://github.com/androidx/media/blob/release/libraries/common/src/main/java/androidx/media3/common/audio/Sonic.java , `SonicAudioProcessor.java` , `SpeedChangingAudioProcessor.java`
- https://www.surina.net/soundtouch/README.html (SoundTouch — LGPL, отклонён)
- https://github.com/pedroSG94/RootEncoder — теги 2.4.7 / 2.5.5 / 2.6.0 (сверка версий)

### Уровень 2 — рецензируемые статьи и патенты

- Ramjee, Kurose, Towsley, Schulzrinne, «Adaptive playout mechanisms for packetized audio applications in wide-area networks», IEEE INFOCOM'94 — http://www.cs.columbia.edu/~hgs/papers/Ramj94_Adaptive.pdf
- Moon, Kurose, Towsley, «Packet audio playout delay adjustment: performance bounds and algorithms», Multimedia Systems 6:17–28 (1998) — https://www.comp.nus.edu.sg/~cs5248/0405S1/l04/moon98playout.pdf
- Liang, Färber, Girod, «Adaptive playout scheduling and loss concealment for voice communication over IP networks», IEEE Trans. Multimedia 5(4):532–543 (2003) — https://web.stanford.edu/~bgirod/pdfs/LiangMM2003.pdf
- Driedger & Müller, «A Review of Time-Scale Modification of Music Signals», Applied Sciences 6(2):57 (2016), open access — https://www.audiolabs-erlangen.com/content/05_fau/professor/00_mueller/06_projects/90_siamus/2016_DriedgerMueller_TSMOverview_AppliedSciences_ePrint.pdf
- Kalman, Steinbach, Girod, «Adaptive Playout for Real-Time Media Streaming», IEEE ISCAS'02 — https://web.stanford.edu/~bgirod/pdfs/kalmanISCAS02.pdf
- Lyko, Elkhatib, Ramdhany, Race, «Drop or Stop: Investigating the Impact of Playback Rate on QoE in Adaptive Video Streaming» — https://eprints.lancs.ac.uk/id/eprint/220500/3/drop_or_stop_accepted.pdf
- O'Hanlon & Aslam (BBC R&D), «Latency Target based Analysis of the DASH.js Player», MMSys'23 — https://arxiv.org/pdf/2304.13551
- Sticht, «Mental Aptitude and Comprehension of Time-Compressed and Compressed-Expanded Listening Selections», ERIC ED066080 — https://files.eric.ed.gov/fulltext/ED066080.pdf
- Plug & Smith, J. Phonetics 86:101040 (2021) — https://eprints.gla.ac.uk/238038/2/238038.pdf (использовано как открытое подтверждение JND ≈5 % из Quené 2007)
- Verhelst & Roelands, WSOLA, ICASSP'93 — https://researchportal.vub.be/en/publications/an-overlap-add-technique-based-on-waveform-similarity-wsola-for-h/ (полный текст за пейволлом; формулы взяты из открытого обзора Driedger & Müller)
- Chang, Varvello, Hao, Mukherjee (Nokia Bell Labs), «Can You See Me Now?», IMC'21 — https://ar5iv.labs.arxiv.org/html/2109.13113
- Патенты: https://patents.google.com/patent/US7596488B2/en (Microsoft), https://www.freepatentsonline.com/9246644.html и https://patents.google.com/patent/US8855145B2/en (Skype/Microsoft), https://patents.google.com/patent/US9270722B2/en (Skype), https://patents.google.com/patent/US11711322B2/en (Zoom), https://patents.google.com/patent/US6598228B2/en (Enounce/Virentem), https://patents.google.com/patent/US20160105473A1/en (Amazon)

### Уровень 3 — вендорские блоги и вторичное (использовано ограниченно)

- https://research.google/blog/improving-audio-quality-in-duo-with-waveneteq/ (статистика деградаций Duo, границы PLC)
- https://developers.google.com/meet/media-api/guides/overview , `/workspace/meet/media-api/guides/concepts` (подтверждение WebRTC-природы Meet)
- https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/ (независимое подтверждение части параметров DelayManager; порогов догона в статье НЕТ)
- https://learn.microsoft.com/en-us/previous-versions/skypeforbusiness/optimizing-your-network/media-quality-and-network-connectivity-performance — ⚠️ **АРХИВНАЯ** страница (`is_retired: true`, ms.date 2017-11-28): пороги RTT/jitter/loss для Teams/SfB. Это админ-дока, а не спека.
- https://learn.microsoft.com/en-us/microsoftteams/prepare-network (полоса для аудио; порогов latency/jitter там больше нет)
- https://dashif.org/docs/CR-Low-Latency-Live-r8.pdf (допуск 500 мс; числовых рекомендаций по скорости НЕТ)

### Недоступное (перечислено, чтобы не искали заново)

- ETSI TS 103 285 (DVB-DASH), clause 10.20.4 / 10.20.6 «catch-up modes» — 403/404 у ETSI
- ACM TOMM 10.1145/3410449 — 403 у dl.acm.org
- Quené (2007), J. Phonetics 35(3) — 403 у Elsevier и у репозитория Утрехта
- Morita & Itakura (PICOLA, ASJ 1986) — в открытом доступе нет
- История коммитов webrtc.googlesource.com (`+log`) — 403 «Please sign in»
- Verhelst & Roelands ICASSP'93 полный текст — пейволл IEEE; открытая версия Eurospeech'93 на isca-archive является СКАНОМ без OCR

---

## 9. Что делать дальше (порядок, а не список)

1. **E4 (Р11, уже согласован Криником).** Скрытая трансляция + ffmpeg на 1.2/1.5/2.0× → примут ли
   YouTube и Twitch сжатые PTS. **Без этого ответа догон проектировать нельзя** — если ingest режет,
   вся ветка закрыта, и мы сэкономили недели.
2. **Слепое A/B по коэффициенту** на голосе Криника (вопрос 1 из §7.1). Дешёвое, закрывает главный
   продуктовый спор объективно.
3. **Замер Sonic на Titan 1** (CPU/батарея, k=1.0 и k=1.5) — вопрос 3.
4. **Трассы долга на реальных маршрутах** → калибровка `W`, `T_hist`, границ лестницы — вопрос 6.
   Криник уже утвердил: пороги калибруются наблюдением.
5. **Две развилки владельцу:** `D_panic` (когда перестаём догонять и выбрасываем) и «отступаем ли
   после повторных сбоев» (§6.3).
6. Только после этого — код по §6.2.
