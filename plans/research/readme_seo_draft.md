# README SEO-оптимизация + сравнение конкурентов — ЧЕРНОВИК (на ревью Криника)

> ⚠️ Это ЧЕРНОВИК для Idea 05. Публичный README + сравнение конкурентов — бренд/outward-facing,
> поэтому НЕ публикую единолично: нужно ревью/добро Криника, особенно тон и публичное упоминание
> конкурентов. Сырьё по конкурентам — `plans/research/competitors/`.
> Статус: 🔬 черновик (2026-06-29, автономный цикл).

---

## 1. SEO-анализ (как чаще попадать в поиск)

**Что реально гуглят** (по web-research) — фразы-намерения:
- «android stream usb webcam to youtube / twitch»
- «use phone / tablet as webcam for streaming», «turn android into webcam»
- «OTG UVC camera android stream RTMP», «usb camera android live stream»
- «stream external camera android no root», «android usb capture card stream»
- «DSLR / camcorder to phone live stream»

**Пробелы текущего README (SEO):**
- Нет насыщенного ключевиками описания в первых строках (GitHub индексирует начало README + поле About).
- Не заданы **GitHub Topics** (это сильный сигнал для поиска по GitHub/Google).
- Нет слов, которые ищут новички: «no root», «OTG», «UVC», «capture card», «external camera»,
  «webcam streaming app», «RTMP».
- Нет сравнения/«alternatives to …» — люди ищут «CameraFi alternative», «free streaming app».

**Рекомендации:**
1. **GitHub → About / Description** (короткое, ключевое):
   `Open-source Android app to stream a USB webcam (UVC, via OTG) live to YouTube, Twitch, etc. — no root, made by a streamer for streamers.`
2. **GitHub Topics** (добавить в репозиторий):
   `android`, `kotlin`, `jetpack-compose`, `streaming`, `rtmp`, `usb-camera`, `uvc`, `webcam`,
   `otg`, `youtube-live`, `twitch`, `live-streaming`, `camera`, `open-source`, `androidusbcamera`,
   `rootencoder`.
3. **Первый абзац README** — переписать ключевиками (вариант ниже).
4. Добавить секции «Why KrinikCam», сравнительную таблицу, «Use cases», FAQ с естественными
   формулировками запросов (например «How to stream a USB webcam on Android without root?»).

---

## 2. Предлагаемый SEO-абзац (замена текущего intro)

> **KrinikCam — open-source Android app that turns a USB webcam into a live streaming camera.**
> Plug any UVC webcam, capture card, camcorder or DSLR into your Android phone or tablet via an OTG
> cable, get a full-screen preview, and go live to **YouTube, Twitch, Instagram or TikTok over RTMP** —
> **no root, no watermark, no subscription.** Built by a streamer, for streamers: just plug in and go
> live, focus on your content — not on fighting software.
>
> Keywords (естественно вплести): USB webcam streaming · UVC · OTG · external camera · capture card ·
> RTMP · YouTube Live · Twitch · no root · Android 13+.

---

## 3. Сравнительная таблица (черновик; тон — уважительный, факты из research)

> Принцип Idea 05: конкурентов НЕ принижаем. Акцент — у KrinikCam это **бесплатно, open-source,
> без водяного знака, USB-вебка как ядро, и проще** (сделано стримером для стримеров).

| Возможность | **KrinikCam** | CameraFi Live | Larix Broadcaster | PRISM Live | Streamlabs Mobile |
|---|---|---|---|---|---|
| USB/UVC-вебка как основной источник | ✅ ядро | ✅ | ⚠️ premium, experimental | ⚠️ как доп. мульти-кам | ❌ только телефон |
| RTMP-стрим (YouTube/Twitch/…) | ✅ | ✅ | ✅ (+SRT/др.) | ✅ | ✅ |
| Без водяного знака | ✅ | ❌ (платно убрать) | ❌ (premium) | ⚠️ | ❌ (Ultra) |
| Цена | **бесплатно** | free + IAP | $9.99/мес | free + Plus | $27/мес |
| Open-source (MIT) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Фокус / простота | ✅ «включил вебку → в эфир» | комбайн | про-инструмент | комбайн | экосистема |
| Standby-кадр при обрыве камеры | ✅ | — | — | — | — |

> ⚠️ Цифры/статусы — на момент research 2026-06-29 (см. `plans/research/competitors/*`), перед
> публикацией перепроверить (особенно цены/water­mark/UVC-статусы — меняются).

---

## 4. «Why KrinikCam» (черновик секции для README)

- 🆓 **Бесплатно и open-source (MIT)** — без подписок, без водяного знака, без рекламы.
- 🔌 **USB-вебка — это ядро, а не доп. функция.** Подключи качественную UVC-камеру/камкордер/4K-вебку
  через OTG — то, чего нет у «телефонных» стримеров (Streamlabs) и что у других платно/экспериментально.
- 🎯 **Просто.** «Включил вебку → пошёл в эфир», без возни с настройками и железом — думай о контенте.
- 🛟 **Надёжно.** Standby-кадр при отключении камеры (поток не рвётся) — там, где у других чёрный экран.
- 💜 **Сделано стримером для стримеров.** Современный UI (Material 3), не раздутый комбайн.

## 5. Что ещё (на будущее, для SEO/README)

- Скриншоты/GIF демо (GitHub любит визуал; повышает вовлечённость и косвенно ранжирование).
- FAQ с вопросами-запросами (How to … USB webcam Android stream no root?).
- Раздел «Alternatives» с честным сравнением (ловит запросы «CameraFi alternative»).
- README двуязычный (EN/RU) — SEO-абзац и таблицу продублировать на русском.

---

## К Кринику (на ревью)

1. Ок ли публично сравнивать с конкурентами в README (тон уважительный)? Или сделать обобщённо
   («many apps…») без имён?
2. Утвердить SEO-описание и список GitHub Topics — я добавлю в README/репозиторий.
3. Перепроверить цены/факты конкурентов перед публикацией (они меняются).
