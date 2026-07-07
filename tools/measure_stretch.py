#!/usr/bin/env python
"""tools/measure_stretch.py — ОБЪЕКТИВНОЕ измерение линейного искажения (растяг/сжатие) кадра.

ЗАЧЕМ: агент НЕ должен оценивать «на глаз», растянут ли кадр — глаз ненадёжен (особенно на повёрнутых/
зеркальных кадрах и кривых предметах). Нужен инструмент. Идея: физический КРУГ, снятый ФАС
(перпендикулярно оси камеры), на матрице должен остаться кругом. Если пайплайн растягивает по оси —
круг становится эллипсом. cv2.fitEllipse даёт длины большой/малой осей и угол:
  ratio = major/minor = коэффициент растяга;  angle = направление (0°/90° = осевой пайплайн-растяг;
  диагональ = обычно физ. наклон предмета, а не наш баг). Согласованность нескольких кругов
  (один ratio+angle) = систематическое искажение пайплайна (перспектива/наклон дали бы разброс).

НАСТРОЙКА (разово): python3 -m venv .venv && .venv/bin/pip install opencv-python-headless numpy
ЗАПУСК: .venv/bin/python tools/measure_stretch.py <img.png> [x y w h]
  (x y w h — необязательный кроп области вокруг круга; допуск: env MEASURE_TOL, по умолч. 0.12)
Кадр снять: adb exec-out screencap -p > frame.png

Родился при фиксе bug 19 (растяг встроенных камер): замер дал 1.67× = (16:9÷4:3)² — логичный
коэффициент, указавший на причину (неучтённый SENSOR_ORIENTATION), а не «магию». См. bugs/19_DONE_*.
"""
import sys, cv2, numpy as np

img = cv2.imread(sys.argv[1])
if img is None:
    print("не открылось:", sys.argv[1]); sys.exit(1)
H, W = img.shape[:2]
crop = None
if len(sys.argv) >= 6:
    x, y, w, h = map(int, sys.argv[2:6])
    crop = (x, y, w, h)
    img = img[y:y+h, x:x+w]

gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
gray = cv2.GaussianBlur(gray, (5, 5), 0)

# Кандидаты-контуры: Canny + внешние контуры. Фильтр по площади и «круглости».
edges = cv2.Canny(gray, 40, 120)
edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

cand = []
area_min = 0.02 * img.shape[0] * img.shape[1]   # ≥2% площади кропа
for c in cnts:
    a = cv2.contourArea(c)
    if a < area_min or len(c) < 20:
        continue
    per = cv2.arcLength(c, True)
    if per == 0:
        continue
    circ = 4 * np.pi * a / (per * per)          # 1.0 = идеальный круг
    if circ < 0.45:                              # отсекаем явно некруглое
        continue
    (cx, cy), (MA, ma_), ang = cv2.fitEllipse(c)  # MA,ma = ОСИ (не радиусы) — full lengths
    major, minor = max(MA, ma_), min(MA, ma_)
    if minor < 5:
        continue
    cand.append((a, circ, cx, cy, major, minor, ang))

# Доп. путь: Otsu-порог + контуры (хорошо для простого фона).
_, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
for thr in (th, 255 - th):
    cnts2, _ = cv2.findContours(thr, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    for c in cnts2:
        a = cv2.contourArea(c)
        if a < area_min or len(c) < 20:
            continue
        per = cv2.arcLength(c, True)
        if per == 0:
            continue
        circ = 4 * np.pi * a / (per * per)
        if circ < 0.45:
            continue
        (cx, cy), (MA, ma_), ang = cv2.fitEllipse(c)
        major, minor = max(MA, ma_), min(MA, ma_)
        if minor >= 5:
            cand.append((a, circ, cx, cy, major, minor, ang))

if not cand:
    print("Круглых контуров не найдено — нужен круглый предмет ФАС к камере на простом фоне."); sys.exit(2)

cand.sort(key=lambda t: t[0], reverse=True)      # крупнейший
a, circ, cx, cy, major, minor, ang = cand[0]
ratio = major / minor
# Допуск на погрешность (Криник): реальный предмет не идеальный круг + лёгкий наклон/перспектива дают
# небольшой эллипс. TOL — порог, ниже которого считаем «круг в пределах погрешности» (растяга нет).
# По умолчанию 12% (env MEASURE_TOL переопределяет). Итог < 1+TOL = ок; выше = систематический растяг.
import os
TOL = float(os.environ.get("MEASURE_TOL", "0.12"))
print(f"Изображение: {sys.argv[1]}  (crop={crop})")
print(f"Найден округлый контур: площадь={a:.0f}px, круглость={circ:.3f}")
print(f"Эллипс: большая ось={major:.1f}px, малая ось={minor:.1f}px, угол={ang:.1f}°")
print(f">>> Соотношение осей (major/minor) = {ratio:.3f}  (допуск ±{TOL*100:.0f}% → порог {1+TOL:.2f})")
if ratio <= 1 + TOL:
    print(f">>> Растяг: НЕТ — круг в пределах погрешности")
else:
    print(f">>> Растяг: ДА ~{ratio:.2f}x вдоль угла {ang:.0f}° (сверх допуска)")

# Аннотированный вывод.
out = img.copy()
cv2.ellipse(out, ((cx, cy), (major, minor), ang), (0, 0, 255), 3)
cv2.circle(out, (int(cx), int(cy)), 4, (0, 255, 0), -1)
outpath = sys.argv[1].rsplit(".", 1)[0] + "_measured.png"
cv2.imwrite(outpath, out)
print("аннотация:", outpath)
