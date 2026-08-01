#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/owner-voice/speak.py — ЛОКАЛЬНЫЙ НЕЙРОГОЛОС контура согласований (`/owner-reviews`).

ЗАЧЕМ. Решение Криника (interview_017, В3=б): звать владельца локальным нейросетевым синтезатором
(Silero v4_ru, офлайн, на процессоре), с ОТКАТОМ на системный `say`, если тракта нет. Никакой сети
в рантайме: модель лежит файлом рядом (`model/v4_ru.pt`, ~38 МБ), venv — рядом (gitignored).

КОНТРАКТ (его знает tools/owner.mjs):
    python speak.py --in <текст.utf8> --out <звук.wav> [--speaker baya] [--rate 48000]
    exit 0 — файл записан · exit 2 — говорить нечего · exit 1 — тракт не готов/ошибка
Текст приезжает ФАЙЛОМ, а не аргументом: не-ASCII в argv портится молча (канон проекта).

НОРМАЛИЗАЦИЯ ТЕКСТА — не украшение, а четыре ОПЛАЧЕННЫХ бага голосового тракта соседнего проекта
(researches/28 §5). Каждый стоил часа триажа, и каждый закрыт здесь:
  1) текст без букв и цифр → синтезатор падает или мычит   → выходим с кодом 2, «говорить нечего»;
  2) кракозябры кодировки                                  → читаем и пишем строго UTF-8;
  3) МОЛЧА ПРОГЛОЧЕННЫЕ ЦИФРЫ («56» не произносится вовсе) → разворачиваем числа в слова;
  4) разметка, утекающая в речь («звёздочка звёздочка»)    → снимаем markdown и пути до синтеза.

[NOT-TESTED] на момент написания — проверяется прогоном `--selftest` и ушами владельца.
"""

import argparse
import os
import re
import sys
import wave

# ── 1. Числа словами. Silero сам их НЕ разворачивает: без этого «17» просто пропадает из речи ────
ONES_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
ONES_F = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
         'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят',
        'восемьдесят', 'девяносто']
HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот',
            'восемьсот', 'девятьсот']


def _triad(n, feminine=False):
    """Одна тройка разрядов словами (до 999). Род важен: «одна тысяча», но «один рубль»."""
    ones = ONES_F if feminine else ONES_M
    out = []
    if n >= 100:
        out.append(HUNDREDS[n // 100])
        n %= 100
    if 10 <= n <= 19:
        out.append(TEENS[n - 10])
        n = 0
    elif n >= 20:
        out.append(TENS[n // 10])
        n %= 10
    if n:
        out.append(ones[n])
    return out


def _plural(n, forms):
    """Русская форма множественного числа: (1, 2-4, 5-20) — «тысяча / тысячи / тысяч»."""
    n = abs(n) % 100
    if 11 <= n <= 19:
        return forms[2]
    n %= 10
    if n == 1:
        return forms[0]
    if 2 <= n <= 4:
        return forms[1]
    return forms[2]


def number_to_words(num):
    """Целое число словами. 0 → «ноль», 56 → «пятьдесят шесть», 1017 → «одна тысяча семнадцать»."""
    num = int(num)
    if num == 0:
        return 'ноль'
    parts = []
    if num < 0:
        parts.append('минус')
        num = -num
    scales = [
        (10 ** 9, ('миллиард', 'миллиарда', 'миллиардов'), False),
        (10 ** 6, ('миллион', 'миллиона', 'миллионов'), False),
        (10 ** 3, ('тысяча', 'тысячи', 'тысяч'), True),
    ]
    for base, forms, feminine in scales:
        if num >= base:
            chunk = num // base
            num %= base
            parts += _triad(chunk, feminine)
            parts.append(_plural(chunk, forms))
    if num:
        parts += _triad(num)
    return ' '.join(p for p in parts if p)


# ── 2. Снятие разметки и путей: иначе в речь утекают звёздочки, слэши и обратные кавычки ─────────
MD_LINK = re.compile(r'\[([^\]]+)\]\([^)]*\)')
MD_MARKS = re.compile(r'[*_`~#>|]+')
PATHISH = re.compile(r'\S*[/\\]\S*')          # пути и URL произносить бессмысленно
EMOJI = re.compile('[\U0001F000-\U0001FAFF←-➿️⬀-⯿]')
NUMBER = re.compile(r'(?<!\w)(\d+)(?!\w)')
HAS_SPEECH = re.compile(r'[\wЀ-ӿ]', re.UNICODE)


def normalize(text):
    """Текст → то, что не стыдно отдать синтезатору. Пустая строка = говорить нечего."""
    t = MD_LINK.sub(r'\1', text)
    t = EMOJI.sub(' ', t)
    t = PATHISH.sub(' ', t)
    t = MD_MARKS.sub(' ', t)
    t = NUMBER.sub(lambda m: number_to_words(m.group(1)), t)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\s*\n\s*', '. ', t).strip()
    t = re.sub(r'\.{2,}', '.', t)
    if not HAS_SPEECH.search(t):
        return ''
    return t


# ── 3. Синтез. Модель — ЛОКАЛЬНЫЙ файл: ни одного сетевого запроса в рантайме ────────────────────
def synth(text, out_path, model_path, speaker, rate):
    import torch                                   # импорт внутри: без синтеза он не нужен
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    model = torch.package.PackageImporter(model_path).load_pickle('tts_models', 'model')
    model.to(torch.device('cpu'))
    audio = model.apply_tts(text=text, speaker=speaker, sample_rate=rate)
    pcm = (audio.numpy() * 32767).astype('<i2').tobytes()
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return len(pcm) // 2 / rate


def selftest():
    """Каждому правилу нормализации скармливаем ровно его баг (канон: гард обязан уметь краснеть)."""
    cases = [
        ('56', 'пятьдесят шесть'),
        ('интервью 017', 'интервью семнадцать'),
        ('накопилось 3 решения', 'накопилось три решения'),
        ('**жирный** и `код`', 'жирный и код'),
        ('[ссылка](http://x/y)', 'ссылка'),
        ('файл interviews/interview_017.md', 'файл'),
        ('1017', 'одна тысяча семнадцать'),
    ]
    failed = 0
    for src, want in cases:
        got = normalize(src)
        good = want in got
        print(('✅' if good else '❌') + f' «{src}» → «{got}»')
        failed += 0 if good else 1
    empty = normalize('🔔 ⏳ ✅')
    print(('✅' if empty == '' else '❌') + f' текст без букв и цифр → «{empty}» (говорить нечего)')
    failed += 0 if empty == '' else 1
    print(('❌ провалено: %d' % failed) if failed else '✅ нормализация речи: все проверки зелёные')
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description='Локальный нейроголос контура (Silero v4_ru)')
    ap.add_argument('--in', dest='src', help='файл с текстом (UTF-8)')
    ap.add_argument('--out', dest='dst', help='куда записать wav')
    ap.add_argument('--model', default=os.path.join(os.path.dirname(__file__), 'model', 'v4_ru.pt'))
    ap.add_argument('--speaker', default='baya')
    ap.add_argument('--rate', type=int, default=48000)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()

    if a.selftest:
        sys.exit(selftest())
    if not a.src or not a.dst:
        print('нужны --in и --out', file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(a.model):
        print(f'нет модели: {a.model}', file=sys.stderr)
        sys.exit(1)

    with open(a.src, encoding='utf-8') as f:          # строго UTF-8 — иначе кракозябры (баг №2)
        text = normalize(f.read())
    if not text:
        print('говорить нечего (в тексте нет ни букв, ни цифр)', file=sys.stderr)
        sys.exit(2)
    try:
        secs = synth(text, a.dst, a.model, a.speaker, a.rate)
        print(f'{a.dst} · {secs:.1f} c · голос {a.speaker}')
    except Exception as e:                            # откат на системный синтезатор делает вызывающий
        print(f'синтез не удался: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
