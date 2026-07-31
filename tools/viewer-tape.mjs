#!/usr/bin/env node
/**
 * viewer-tape.mjs — ЛЕНТА ЗРИТЕЛЯ: что реально долетело до зрителя во время сетевого прогона.
 *
 * Зачем это отдельный инструмент. Приёмка живучести до сих пор доказывалась ЛОГОМ и ПУЛЬСОМ — это
 * честно, но не отвечает на вопрос владельца «а как это выглядит с той стороны». Скриншот телефона
 * не годится принципиально: на телефоне картинка ЖИВАЯ всегда, а зритель видит то, что вылезло из
 * сокета. Поэтому пишем НЕ с устройства, а С СЕРВЕРА-полигона.
 *
 * Как устроено (и почему не одной командой ffmpeg). При обрыве публикации ffmpeg получает EOF и
 * выходит — одной командой непрерывную ленту снять нельзя. Поэтому:
 *   1. `rec` крутит ffmpeg в цикле: каждая публикация = свой кусок part_NN.mp4, между ними пауза
 *      реальной длительности (её и видит зритель как «эфир встал»);
 *   2. `build` склеивает куски в ОДИН файл, вставляя между ними ПРОВАЛ настоящей длины — замороженный
 *      последний кадр с плашкой «эфир прервался — N.N с». Врать про длительность нельзя: провал и
 *      есть главная улика.
 *
 * Команды:
 *   node tools/viewer-tape.mjs rec [--url rtmp://127.0.0.1:1935/live/test] [--out <dir>]
 *   node tools/viewer-tape.mjs build [--out <dir>] [--file <tape.mp4>]
 *   node tools/viewer-tape.mjs stop
 *
 * Зависимости: ffmpeg (уже нужен полигону). Останов — `stop` или Ctrl-C.
 * [NOT-TESTED] — пока не прогнан на живом сценарии; снять маркер после первой собранной ленты.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(os.tmpdir(), 'krinikcam-viewer-tape');
const PID_FILE = () => path.join(outDir, 'rec.pid');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const outDir = path.resolve(opt('--out', DEFAULT_OUT));
const url = opt('--url', 'rtmp://127.0.0.1:1935/live/test');

const sh = (bin, args) => spawnSync(bin, args, { encoding: 'utf8' });
const ffprobeSec = (file) => {
  const r = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const v = parseFloat((r.stdout || '').trim());
  return Number.isFinite(v) ? v : 0;
};

// ── rec: куски + журнал стыков ────────────────────────────────────────────────────────────────
// Журнал (segments.json) хранит НАСТОЯЩИЕ метки времени начала/конца каждого куска — по ним потом
// считается длина провала. Считать её по разнице длительностей нельзя: часть времени съедает сам
// реконнект, и провал вышел бы короче, чем видел зритель.
async function rec() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(PID_FILE(), String(process.pid));
  const segFile = path.join(outDir, 'segments.json');
  const segments = [];
  let stop = false;
  const bye = () => { stop = true; };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);

  console.log(`🎬 лента зрителя: пишу с СЕРВЕРА ${url}`);
  console.log(`   куски → ${outDir}   (останов: node tools/viewer-tape.mjs stop)`);
  let i = 0;
  while (!stop) {
    const part = path.join(outDir, `part_${String(i).padStart(2, '0')}.mp4`);
    const startedAt = Date.now();
    // -c copy: пишем ровно тот битстрим, что пришёл зрителю, без перекодирования.
    // -stimeout не для RTMP; ждать публикацию нам и не надо — ffmpeg сам отвалится, и цикл повторит.
    await new Promise((resolve) => {
      const p = spawn('ffmpeg', ['-y', '-i', url, '-c', 'copy', '-movflags', '+faststart', part],
        { stdio: 'ignore' });
      p.on('close', resolve);
      p.on('error', resolve);
      const t = setInterval(() => { if (stop) { p.kill('SIGINT'); clearInterval(t); } }, 300);
      p.on('close', () => clearInterval(t));
    });
    const endedAt = Date.now();
    if (fs.existsSync(part) && fs.statSync(part).size > 20_000) {
      const dur = ffprobeSec(part);
      segments.push({ file: path.basename(part), startedAt, endedAt, durationSec: dur });
      fs.writeFileSync(segFile, JSON.stringify(segments, null, 2));
      console.log(`   · кусок ${path.basename(part)} — ${dur.toFixed(1)}с`);
      i++;
    } else {
      fs.rmSync(part, { force: true });
      await new Promise((r) => setTimeout(r, 400));   // публикации нет — ждём следующую
    }
  }
  fs.rmSync(PID_FILE(), { force: true });
  console.log(`\n✅ запись остановлена. Кусков: ${segments.length}. Сборка: node tools/viewer-tape.mjs build --out ${outDir}`);
}

/**
 * Кусок «зритель смотрит в застывший кадр»: последний кадр источника, притемнённый, с подписью
 * ЧТО ИМЕННО и СКОЛЬКО секунд. Длительность НЕ округляем вниз — эти секунды и есть цена аварии.
 */
function freezeClip(work, src, tag, sec, label) {
  const still = path.join(work, `${tag}.png`);
  sh('ffmpeg', ['-y', '-sseof', '-0.5', '-i', src, '-frames:v', '1', still]);
  if (!fs.existsSync(still)) return null;

  // Подпись рисуем PIL'ом, а не фильтром drawtext: ffmpeg из homebrew собран БЕЗ libfreetype
  // (`No such filter: 'drawtext'` — поймано на этой же машине), и без запасного пути лента молча
  // теряла бы все плашки-провалы, то есть ровно то, ради чего снимается. Заодно кириллица идёт
  // ФАЙЛОМ, а не аргументом командной строки (канон 2.1).
  const card = path.join(work, `${tag}_card.png`);
  const py = path.join(work, `${tag}.py`);
  const txt = path.join(work, `${tag}.txt`);
  fs.writeFileSync(txt, label, 'utf8');
  fs.writeFileSync(py, `# -*- coding: utf-8 -*-
import sys
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
still, card, txtfile = sys.argv[1], sys.argv[2], sys.argv[3]
label = open(txtfile, encoding='utf-8').read().strip()
im = Image.open(still).convert('RGB')
im = im.resize((1280, int(round(im.height * 1280 / im.width / 2) * 2)))
im = ImageEnhance.Brightness(im).enhance(0.45)          # застывший кадр заметно темнее живого
d = ImageDraw.Draw(im, 'RGBA')
font = None
for p in ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
          '/System/Library/Fonts/Supplemental/Arial.ttf',
          '/System/Library/Fonts/Helvetica.ttc'):
    try:
        font = ImageFont.truetype(p, 38); break
    except Exception:
        pass
if font is None: font = ImageFont.load_default()
box = d.textbbox((0, 0), label, font=font)
w, h = box[2] - box[0], box[3] - box[1]
x, y = (im.width - w) // 2, im.height - h - 70
d.rounded_rectangle([x - 26, y - 20, x + w + 26, y + h + 22], radius=14, fill=(0, 0, 0, 205))
d.text((x, y), label, font=font, fill=(255, 255, 255))
im.save(card)
`, 'utf8');
  const r = sh('python3', [py, still, card, txt]);
  const frame = fs.existsSync(card) ? card : still;   // PIL не сработал — лучше кадр без подписи, чем дыра
  if (!fs.existsSync(card)) console.log(`   ⚠️ плашка «${label}» не отрисована (${(r.stderr || '').split('\n')[0]})`);

  const out = path.join(work, `${tag}.mp4`);
  sh('ffmpeg', ['-y', '-loop', '1', '-t', String(sec), '-i', frame,
    '-f', 'lavfi', '-t', String(sec), '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', 'scale=1280:-2,fps=30', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', '-shortest', out]);
  return fs.existsSync(out) ? out : null;
}

// ── build: склейка с честными провалами ───────────────────────────────────────────────────────
function build() {
  const segFile = path.join(outDir, 'segments.json');
  if (!fs.existsSync(segFile)) { console.error(`⛔ нет ${segFile} — сначала rec`); process.exit(2); }
  const segments = JSON.parse(fs.readFileSync(segFile, 'utf8'));
  if (!segments.length) { console.error('⛔ ни одного куска не записано'); process.exit(2); }

  const tape = path.resolve(opt('--file', path.join(outDir, 'viewer_tape.mp4')));
  const work = path.join(outDir, 'work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  // Все куски приводим к ОДНОМУ формату: битрейт внутри эфира менялся, но размер кадра и fps —
  // нет, а concat-демуксер требует совпадения кодека/таймбазы. Перекодируем один раз, здесь.
  // Явные длительности обрывов (сек, через запятую) — источник правды тут ЛОГ ПРИЛОЖЕНИЯ:
  // от строки `watchdog[0]` до следующего `connected ✓`. Разница меток процессов ffmpeg для этого
  // НЕ годится: ffmpeg перезапускается мгновенно и ждёт публикацию уже ВНУТРИ следующего куска,
  // поэтому «провал» по ней получается ~0.1 с вместо настоящих секунд.
  const gapsArg = (opt('--gaps', '') || '').split(',').map((s) => parseFloat(s)).filter(Number.isFinite);

  const norm = [];
  segments.forEach((s, idx) => {
    const src = path.join(outDir, s.file);
    const dst = path.join(work, `n_${String(idx).padStart(2, '0')}.mp4`);
    sh('ffmpeg', ['-y', '-i', src, '-vf', 'scale=1280:-2,fps=30', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', '20', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', dst]);
    if (fs.existsSync(dst)) norm.push(dst);

    // ЗАМЕРШАЯ КАРТИНКА ВНУТРИ КУСКА. Кусок длится по медиа-времени меньше, чем по стенным часам,
    // ровно на то время, когда с устройства не приходило НИЧЕГО (сокет встал, watchdog ещё не
    // выстрелил). Зритель в эти секунды смотрел в застывший кадр — и склейка обязана их показать,
    // иначе лента врёт в нашу пользу: пропуск выглядит как ровный эфир.
    const wallSec = (s.endedAt - s.startedAt) / 1000;
    const frozenSec = wallSec - (s.durationSec || 0);
    if (frozenSec > 1.0) {
      const clip = freezeClip(work, src, `f_in_${idx}`, frozenSec, `картинка встала — ${frozenSec.toFixed(1)} с`);
      if (clip) norm.push(clip);
    }

    // ПРОВАЛ до следующего куска — сколько эфира не было вообще (реконнект).
    const nxt = segments[idx + 1];
    if (!nxt) return;
    const gapSec = gapsArg[idx] ?? Math.max(0.4, (nxt.startedAt - s.endedAt) / 1000);
    const clip = freezeClip(work, src, `g_${idx}`, gapSec, `эфир прервался — ${gapSec.toFixed(1)} с`);
    if (clip) norm.push(clip);
  });

  const listFile = path.join(work, 'list.txt');
  fs.writeFileSync(listFile, norm.map((f) => `file '${f}'`).join('\n'), 'utf8');
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', tape]);
  if (!fs.existsSync(tape)) { console.error('⛔ склейка не удалась — смотри куски вручную в ' + outDir); process.exit(1); }

  const total = ffprobeSec(tape);
  const gapTotal = segments.slice(0, -1)
    .reduce((n, s, i) => n + (gapsArg[i] ?? Math.max(0.4, (segments[i + 1].startedAt - s.endedAt) / 1000)), 0);
  const frozenTotal = segments
    .reduce((n, s) => n + Math.max(0, (s.endedAt - s.startedAt) / 1000 - (s.durationSec || 0)), 0);
  console.log(`\n🎞️  ЛЕНТА ЗРИТЕЛЯ: ${tape}`);
  console.log(`   длительность ${total.toFixed(1)}с · кусков эфира ${segments.length}`);
  console.log(`   застывшая картинка (сокет встал, эфир формально «идёт»): ${frozenTotal.toFixed(1)}с`);
  console.log(`   эфира не было вообще (реконнект): ${gapTotal.toFixed(1)}с в ${segments.length - 1} обрыв(ах)`);
  console.log(`   ⚠️ и то и другое зритель видит как замерший кадр. Это и есть цена аварии.`);
}

function stop() {
  const pf = PID_FILE();
  if (!fs.existsSync(pf)) { console.log('⛔ запись не идёт'); return; }
  const pid = Number(fs.readFileSync(pf, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); console.log(`✓ остановлена запись (pid ${pid})`); }
  catch { console.log('⛔ процесс уже мёртв'); fs.rmSync(pf, { force: true }); }
}

switch (cmd) {
  case 'rec': await rec(); break;
  case 'build': build(); break;
  case 'stop': stop(); break;
  default:
    console.log(`viewer-tape.mjs — что реально долетело до ЗРИТЕЛЯ (пишем с сервера, не с телефона)

  rec   [--url <rtmp>] [--out <dir>]   писать куски эфира, переживая обрывы
  build [--out <dir>] [--file <mp4>]   склеить в одну ленту с ЧЕСТНЫМИ провалами
  stop                                 остановить запись

  Дефолты: url ${url} · out ${DEFAULT_OUT}`);
}
