#!/usr/bin/env node
/**
 * tools/owner-verify.mjs — QA-ПРОГОН КОНТУРА ЖИВЫМ БРАУЗЕРОМ (навык `/owner-reviews`,
 * спецификация: .claude/skills/owner-reviews/references/qa-suite.md).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Страница — это ПОВЕДЕНИЕ, а поведение наблюдают в браузере, а не выводят
 * из исходника. Ровно поэтому в прошлой версии контура строка «снятие выбора» честно висела
 * `[NOT-TESTED]`: агент браузер не видел. Здесь он его видит — Chrome по протоколу DevTools через
 * ВСТРОЕННЫЙ в Node WebSocket. Ноль зависимостей: ни Playwright, ни Puppeteer.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ (и почему именно это):
 *   · снятие выбора повторным кликом — правка Криника 1.1, дефект №1 всех полевых сборок;
 *   · клик по ТЕКСТУ подписи, а не по кружку — ровно тот путь, на котором механика ломалась;
 *   · теги состояния и счётчики — правка Криника 1.5;
 *   · полоса состояния ПИКСЕЛЯМИ и ЦВЕТОМ, обе темы, отсутствие горизонтального уезда, чистая консоль;
 *   · 🔴 ПОБУДКА (I8): контур обязан ЗАВЕРШИТЬСЯ САМ после записи — проверяем КОД ВЫХОДА процесса,
 *     а не наличие файла. Именно этой проверки не было ни у кого, и именно этот дефект уехал в поле;
 *   · ответ доехал в ТРИ места, первоисточник владельца НЕ затёрт, повтор лёг уточнением;
 *   · гейт до/после, дрейф текста, гард краснеет на новом нарушении и на протухшем статусе;
 *   · уборка за собой с проверкой «след убран».
 *
 * Запуск: node tools/owner.mjs verify [--headful] [--keep]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseDoc, gate, GATE_EXIT, decisionPathFor, ARCHIVE_DIR, PAGES_DIR, ROOT, findAppBrowser,
} from './owner.mjs';

const appLauncher = findAppBrowser();

const HEADFUL = process.argv.includes('--headful');
const KEEP = process.argv.includes('--keep');
const SANDBOX = path.join(PAGES_DIR, '.verify');
const FIXTURE = path.join(SANDBOX, 'interview_990_verify.md');
const PORT = 8899;
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p) => fs.existsSync(p));

let failed = 0, total = 0;
const ok = (name, cond, extra = '') => {
  total++;
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); }
  return false;
}

// ── Фикстура. НИКОГДА не гоняем запись по живым документам владельца: их мы только читаем. ──────
// В фикстуре собраны ровно те формы, которые ломались в поле: таблица вариантов, многострочный
// жирный заголовок варианта, уже отвеченный вопрос (проверка «не затёрли») и пустой слот.
const FIXTURE_MD = [
  '# Интервью 990 — QA-прогон контура (фикстура, удаляется после прогона)',
  '',
  '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА',
  '',
  'ПРЕАМБУЛА-МАЯК: контекст решения живёт ДО первого вопроса — мокапы, образцы звука, объяснение',
  'зачем всё это. Страница, показывающая только карточки вопросов, молча его выбрасывает.',
  '',
  '## В1. Первый вопрос — варианты таблицей?',
  '',
  'Тело вопроса с `кодом`, ссылкой и таблицей.',
  '',
  '| # | Вариант | Смысл |',
  '|---|---|---|',
  '| **(а)** | Первый вариант | раз |',
  '| **(б)** | Второй вариант | два |',
  '',
  '**Ответ Криника:**',
  '',
  '>',
  '',
  '---',
  '',
  '## В2. Второй вопрос — варианты списком, один с переносом жирного?',
  '',
  '- **(а) Вариант, у которого жирный заголовок перенесён',
  '  на вторую строку** — именно он молча пропадал в поле',
  '- **(б)** Обычный короткий вариант',
  '',
  '**Ответ Криника:**',
  '',
  '>',
  '',
  '---',
  '',
  '## В3. Третий вопрос — уже отвечен владельцем ранее?',
  '',
  '**Ответ Криника:** ПЕРВОИСТОЧНИК ВЛАДЕЛЬЦА — эта строка не смеет исчезнуть',
  '',
  '---',
  '',
  'ХВОСТ-МАЯК: ключ слепого сравнения и оговорки живут ПОСЛЕ последнего вопроса.',
  '',
].join('\n');

// ── Минимальный клиент DevTools Protocol на встроенном в Node WebSocket ─────────────────────────
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.waiting = new Map(); this.events = []; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) { this.waiting.get(msg.id)(msg); this.waiting.delete(msg.id); }
      else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 15000);
      this.waiting.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Выполнить выражение в странице и вернуть ЗНАЧЕНИЕ (а не описатель объекта). */
  async evalJs(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS error');
    return r.result.value;
  }
  /** Настоящий клик мышью по центру элемента — не el.click(), а путь живого пользователя. */
  async clickSelector(selector) {
    const box = await this.evalJs(`(function(){var e=document.querySelector(${JSON.stringify(selector)});
      if(!e) return null; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (!box) throw new Error(`нет элемента: ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await sleep(60);
  }
  consoleErrors() {
    return this.events.filter((e) =>
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) => e.params.entry?.text || (e.params.args || []).map((a) => a.value).join(' '));
  }
}

// ── Прогон ──────────────────────────────────────────────────────────────────────────────────────
let child, chrome, profileDir;

async function run() {
  if (!CHROME) { console.error('⛔ не найден Chrome/Chromium — QA живым браузером невозможен'); return 1; }

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  // Прогон обязан начинаться с ЧИСТОГО состояния СВОЕЙ песочницы: упавший прошлый прогон оставляет
  // хвосты в архиве, и следующий краснеет не по делу («в архиве уже есть копия»). Чистим только
  // собственное пространство имён фикстур — живые решения владельца не трогаем НИКОГДА.
  if (fs.existsSync(ARCHIVE_DIR)) {
    fs.readdirSync(ARCHIVE_DIR).filter((f) => /^interview_99[01]_verify/.test(f))
      .forEach((f) => fs.rmSync(path.join(ARCHIVE_DIR, f), { force: true }));
  }
  fs.writeFileSync(FIXTURE, FIXTURE_MD, 'utf8');
  const relFixture = path.relative(ROOT, FIXTURE);
  const decisionPath = decisionPathFor(relFixture);
  fs.rmSync(decisionPath, { force: true });

  // ── БЛОК 1. ДО КЛИКА: ответа нет НИ В ОДНОМ из трёх мест ─────────────────────────────────────
  // Без этой пары «ответ найден» красит зелёным любую предысторию.
  const before = parseDoc(FIXTURE);
  ok('до клика: файла решения нет', !fs.existsSync(decisionPath));
  ok('до клика: в архиве нет копии по этому документу',
    !fs.existsSync(ARCHIVE_DIR) || !fs.readdirSync(ARCHIVE_DIR).some((f) => f.startsWith('interview_990_verify--')));
  ok('до клика: в md два пустых слота из трёх', before.slotsEmpty === 2 && before.slotsTotal === 3);
  ok('до клика: гейт ЗАКРЫТ (решения нет)', gate(relFixture, { quiet: true }) === GATE_EXIT.NO_DECISION);
  ok('разбор фикстуры: счётчики вариантов сходятся',
    before.optionCandidates === before.optionsParsed, `${before.optionCandidates} = ${before.optionsParsed}`);

  // ── БЛОК 2. Поднимаем контур ОТДЕЛЬНЫМ ПРОЦЕССОМ — иначе проверить побудку нечем ─────────────
  child = spawn(process.execPath, [path.join(ROOT, 'tools', 'owner.mjs'), 'ask', relFixture,
    '--no-open', '--no-signal', '--port', String(PORT), '--timeout', '120'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let childOut = '';
  let childExit = null;
  child.stdout.on('data', (c) => { childOut += c; });
  child.stderr.on('data', (c) => { childOut += c; });
  child.on('exit', (code) => { childExit = code; });

  const up = await until(() => /http:\/\/127\.0\.0\.1:(\d+)\//.test(childOut), 10000);
  ok('контур поднял страницу и напечатал адрес', up, childOut.split('\n')[0]);
  if (!up) return 1;
  const url = childOut.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];

  // ── БЛОК 3. Живой браузер ────────────────────────────────────────────────────────────────────
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-qa-'));
  const dp = 9333;
  chrome = spawn(CHROME, [
    ...(HEADFUL ? [] : ['--headless=new']),
    `--remote-debugging-port=${dp}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank',
  ], { stdio: 'ignore' });

  const dbg = await until(async () => (await fetch(`http://127.0.0.1:${dp}/json/version`)).ok, 15000);
  ok('браузер отдал отладочный порт', dbg);
  if (!dbg) return 1;

  const target = await (await fetch(`http://127.0.0.1:${dp}/json/new?${url}`, { method: 'PUT' })).json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
  await until(() => cdp.evalJs('document.readyState==="complete" && !!document.querySelector(".q")'), 10000);

  // 3.1. Набор элементов и теги состояния (правка Криника 1.5)
  const shape = await cdp.evalJs(`({
    cards: document.querySelectorAll('.q').length,
    waitTags: [...document.querySelectorAll('.q .tag')].filter(t=>t.textContent.trim()==='ждёт вас').length,
    doneTags: [...document.querySelectorAll('.q .tag')].filter(t=>t.textContent.trim()==='отвечено').length,
    counterWait: (document.querySelector('.meta .chip.wait')||{}).textContent,
    counterDone: (document.querySelector('.meta .chip.ok')||{}).textContent,
    options: document.querySelectorAll('input[type=radio]').length,
    tables: document.querySelectorAll('table').length,
    whoField: document.querySelectorAll('.who, input[name=by]').length,
    docComment: document.querySelectorAll('.doccomment-text').length,
    externals: document.querySelectorAll('[src^="http"],link[href^="http"],script[src]').length,
    hasPreamble: document.body.innerText.includes('ПРЕАМБУЛА-МАЯК'),
    hasEpilogue: document.body.innerText.includes('ХВОСТ-МАЯК')
  })`);
  ok('страница: три карточки вопросов', shape.cards === 3, `найдено ${shape.cards}`);
  ok('страница: теги «ждёт вас» на двух неотвеченных', shape.waitTags === 2, `найдено ${shape.waitTags}`);
  ok('страница: тег «отвечено» на уже отвеченном', shape.doneTags === 1);
  ok('страница: счётчик «ждут вас: 2» в шапке', /ждут вас: 2/.test(shape.counterWait || ''), shape.counterWait);
  ok('страница: счётчик «отвечено: 1» в шапке', /отвечено: 1/.test(shape.counterDone || ''), shape.counterDone);
  ok('страница: варианты отрисованы (2+2)', shape.options === 4, `найдено ${shape.options}`);
  ok('страница: таблица вопроса отрисована', shape.tables === 1);
  ok('страница: поля «кто отвечает» НЕТ (правка Криника 1.2)', shape.whoField === 0);
  ok('страница: поле общего комментария по документу есть', shape.docComment === 1);
  // Контекст решения и хвост документа обязаны быть НА СТРАНИЦЕ, а не только в md: без них
  // владелец судит вслепую (поймано на живых интервью 020/021 — мокапы и образцы звука пропадали).
  ok('страница: преамбула документа отрисована', shape.hasPreamble === true);
  ok('страница: хвост документа (после последнего ---) отрисован', shape.hasEpilogue === true);
  ok('страница: НИ ОДНОЙ внешней загрузки', shape.externals === 0, `найдено ${shape.externals}`);

  // 3.2. Полоса состояния — ПИКСЕЛЯМИ и ЦВЕТОМ (а не «полоса вроде есть»)
  const stripes = await cdp.evalJs(`(function(){
    var q=[...document.querySelectorAll('.q')];
    return q.map(function(c){var s=getComputedStyle(c);
      return {w:parseFloat(s.borderLeftWidth), color:s.borderLeftColor, state:c.dataset.state};});})()`);
  ok('полоса состояния: ширина 4–6 px у всех карточек', stripes.every((s) => s.w >= 4 && s.w <= 6),
    stripes.map((s) => s.w).join('/'));
  ok('полоса состояния: у ждущих и отвеченных РАЗНЫЙ цвет',
    new Set(stripes.map((s) => s.color)).size === 2, stripes.map((s) => s.state + ':' + s.color).join(' '));

  // 3.3. 🔴 СНЯТИЕ ВЫБОРА — кликаем по ТЕКСТУ подписи, а не по кружку: ломалось именно здесь
  // Ищем кнопки ВНУТРИ карточки: имя радиогруппы теперь включает документ (фикс перекрёстного
  // гашения ответов в пачке), и глобальный getElementsByName('В1') больше не работает.
  const state = () => cdp.evalJs(`(function(){
    var c=document.querySelector('section.q[data-qid="В1"]');
    var r=[...c.querySelectorAll('input[type=radio]')];
    return {a:r[0].checked,b:r[1].checked};})()`);
  const optText = 'section.q[data-qid="В1"] label.opt:nth-of-type(1) span';
  const optText2 = 'section.q[data-qid="В1"] label.opt:nth-of-type(2) span';
  await cdp.clickSelector(optText);
  let s1 = await state();
  ok('выбор: клик по ТЕКСТУ варианта выбирает его', s1.a === true && s1.b === false);
  await cdp.clickSelector(optText);
  let s2 = await state();
  ok('🔴 выбор: ПОВТОРНЫЙ клик СНИМАЕТ выделение (правка Криника 1.1)', s2.a === false && s2.b === false);
  await cdp.clickSelector(optText);
  let s3 = await state();
  ok('выбор: третий клик снова выбирает', s3.a === true);
  await cdp.clickSelector(optText2);
  let s4 = await state();
  ok('выбор: сосед гасит прежний', s4.a === false && s4.b === true);
  // Кнопки «× сбросить» на странице БЫТЬ НЕ ДОЛЖНО (правка Криника 2026-08-02): выбор снимается
  // повторным кликом по самому варианту, отдельная кнопка — лишний элемент.
  ok('страница: кнопки «сбросить» нет (правка Криника)',
    (await cdp.evalJs('document.querySelectorAll(".reset").length')) === 0);
  // возвращаем выбор (а) — с ним и пойдёт запись
  await cdp.clickSelector('section.q[data-qid="В1"] label.opt:nth-of-type(1) input');
  const s6 = await state();
  ok('выбор: клик по САМОМУ кружку работает так же', s6.a === true);

  // 🔴 Розовый квадратик вокруг радиокнопки (правка Криника 2026-08-02): рамка фокуса на radio
  // не рисуется. Проверяем ФАКТИЧЕСКИЙ вычисленный стиль СФОКУСИРОВАННОГО элемента, а не CSS-текст.
  const focusRing = await cdp.evalJs(`(function(){
    var r=document.querySelector('section.q[data-qid="В1"] input[type=radio]');
    r.focus();
    var s=getComputedStyle(r);
    return {w:s.outlineWidth, style:s.outlineStyle, shadow:s.boxShadow};})()`);
  ok('🔴 радиокнопка: розового квадратика (рамки фокуса) нет',
    (parseFloat(focusRing.w) === 0 || focusRing.style === 'none') && (focusRing.shadow === 'none' || !focusRing.shadow),
    `outline ${focusRing.w}/${focusRing.style}, shadow ${focusRing.shadow}`);
  // а у текстового поля рамка фокуса ОСТАЁТСЯ — иначе не видно, куда печатаешь
  const textRing = await cdp.evalJs(`(function(){
    var t=document.querySelector('section.q[data-qid="В1"] .free'); t.focus();
    var s=getComputedStyle(t); return {w:s.outlineWidth, style:s.outlineStyle};})()`);
  ok('текстовое поле: рамка фокуса на месте', parseFloat(textRing.w) > 0 && textRing.style !== 'none',
    `outline ${textRing.w}/${textRing.style}`);

  // 3.4. Обе темы и отсутствие горизонтального уезда на двух ширинах
  const paint = async () => cdp.evalJs(`(function(){var s=getComputedStyle(document.body);
    return {bg:s.backgroundColor, fg:s.color, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};})()`);
  await cdp.send('Emulation.setEmulatedMedia', { media: 'page', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(120);
  const light = await paint();
  await cdp.send('Emulation.setEmulatedMedia', { media: 'page', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(120);
  const dark = await paint();
  ok('темы: тёмная и светлая дают РАЗНЫЙ фон', light.bg !== dark.bg, `${light.bg} vs ${dark.bg}`);
  ok('темы: контраст текста к фону ≥ 4.5:1 в обеих', contrast(light.fg, light.bg) >= 4.5 && contrast(dark.fg, dark.bg) >= 4.5,
    `светлая ${contrast(light.fg, light.bg).toFixed(1)}:1 · тёмная ${contrast(dark.fg, dark.bg).toFixed(1)}:1`);
  ok('ширина 1440: горизонтального уезда нет', light.overflow <= 0 && dark.overflow <= 0);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  const narrow = await paint();
  ok('ширина 420: горизонтального уезда нет', narrow.overflow <= 0, `уехало на ${narrow.overflow}px`);
  // ручной тумблер обязан ПЕРЕБИТЬ системную тему
  await cdp.clickSelector('#themeBtn');
  const toggled = await cdp.evalJs('document.documentElement.getAttribute("data-theme")');
  const afterToggle = await paint();
  ok('темы: ручной тумблер перебивает системную', toggled === 'light' && afterToggle.bg === light.bg,
    `data-theme=${toggled}`);
  await cdp.clickSelector('#themeBtn');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Кадры для ГЛАЗ владельца (вкус судит человек, не агент)
  for (const [name, value] of [['light', 'light'], ['dark', 'dark']]) {
    await cdp.send('Emulation.setEmulatedMedia', { media: 'page', features: [{ name: 'prefers-color-scheme', value }] });
    await cdp.evalJs('document.documentElement.removeAttribute("data-theme")');
    await sleep(150);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SANDBOX, `page-${name}.png`), Buffer.from(shot.data, 'base64'));
  }

  // 3.5. Заполняем ответы: В2 свободным текстом, В3 — повторный ответ на УЖЕ отвеченный вопрос
  await cdp.evalJs(`(function(){
    document.querySelector('section.q[data-qid="В2"] .free').value='свободный ответ QA';
    document.querySelector('section.q[data-qid="В1"] .comment').value='комментарий QA';
    document.querySelector('section.q[data-qid="В3"] .free').value='передумал, теперь вот так';
    document.querySelector('.doccomment-text').value='общий комментарий QA по документу';
    return true;})()`);

  const errsBefore = cdp.consoleErrors();
  ok('консоль браузера чиста до отправки', errsBefore.length === 0, errsBefore.join(' | '));

  // ── БЛОК 4. 🔴 ПОБУДКА (I8): запись обязана ЗАВЕРШИТЬ контур ────────────────────────────────
  await cdp.clickSelector('#send');
  const finished = await until(() => cdp.evalJs('!!document.querySelector(".done")'), 8000);
  ok('страница: показан финальный экран «Записано»', finished);
  const closing = await cdp.evalJs('(document.querySelector("#closing")||{}).textContent').catch(() => '');
  ok('страница: сказано про автозакрытие ИЛИ честно про его невозможность',
    /Закрываю окно через|не даёт|не дал/.test(closing || ''), (closing || '').slice(0, 60));

  const woke = await until(() => childExit !== null, 12000);
  ok('🔴 ПОБУДКА (I8): контур ЗАВЕРШИЛСЯ САМ после записи', woke, `код выхода ${childExit}`);
  ok('🔴 ПОБУДКА (I8): код выхода 0 — агент вправе продолжать работу', childExit === 0, String(childExit));
  ok('контур напечатал, что будит агента', /будит агента/.test(childOut));

  // ── БЛОК 5. Ответ доехал в ТРИ места, первоисточник цел ─────────────────────────────────────
  const md = fs.readFileSync(FIXTURE, 'utf8');
  ok('три места (1/3): ответ в исходном md', /\*\*\(а\)\*\*/.test(md) && /свободный ответ QA/.test(md));
  ok('три места (1/3): провенанс by/at в документе', /_записано контуром .*by .*at 20/.test(md));
  ok('три места (2/3): файл решения рядом', fs.existsSync(decisionPath));
  const dec = fs.existsSync(decisionPath) ? JSON.parse(fs.readFileSync(decisionPath, 'utf8')) : {};
  ok('три места (2/3): в решении есть by (сервер проставил сам)', !!dec.by, dec.by);
  ok('три места (2/3): в решении есть sha ответов', !!dec.answers?.['В1']?.sha256);
  const archived = fs.existsSync(ARCHIVE_DIR) && fs.readdirSync(ARCHIVE_DIR).filter((f) => f.startsWith('interview_990_verify--'));
  ok('три места (3/3): копия в архиве', archived && archived.length === 1, String(archived && archived.length));
  ok('🔴 первоисточник владельца НЕ затёрт', md.includes('ПЕРВОИСТОЧНИК ВЛАДЕЛЬЦА — эта строка не смеет исчезнуть'));
  ok('повторный ответ лёг ОТДЕЛЬНЫМ датированным уточнением',
    /_уточнение · by .*at 20.*передумал, теперь вот так/.test(md));
  ok('комментарий по документу целиком дописан в конец',
    /## Комментарий владельца · 20/.test(md) && /общий комментарий QA по документу/.test(md));
  ok('комментарий к вопросу попал в документ', /комментарий QA/.test(md));

  // ── БЛОК 5б. 🔴 ПАЧКА: ответы РАЗНЫХ документов не должны гасить друг друга ─────────────────
  // Дефект, пойманный ВЛАДЕЛЬЦЕМ 2026-08-02 (дважды подряд): имя радиогруппы было просто «В1», и на
  // странице-пачке одноимённые вопросы ЧЕТЫРЁХ интервью становились ОДНОЙ группой — ответ на В1 в
  // одном документе молча снимал ответ на В1 в другом. Проверка утверждает ФАКТ независимости.
  const fixtureB = path.join(SANDBOX, 'interview_991_verify_batch.md');
  fs.writeFileSync(fixtureB, [
    '# Интервью 991 — второй документ пачки (фикстура)', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Тот же номер вопроса, что и в соседнем документе?', '',
    '- **(а)** Первый вариант', '- **(б)** Второй вариант', '',
    '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  const relB = path.relative(ROOT, fixtureB);
  const decB = decisionPathFor(relB);
  fs.rmSync(decB, { force: true });
  // Фикстуру A перезаписываем заново: прошлый блок уже записал в неё ответы
  fs.writeFileSync(FIXTURE, FIXTURE_MD, 'utf8');
  fs.rmSync(decisionPath, { force: true });

  const child2 = spawn(process.execPath, [path.join(ROOT, 'tools', 'owner.mjs'), 'ask', relFixture, relB,
    '--no-open', '--no-signal', '--port', '8901', '--timeout', '90'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out2 = '', exit2 = null;
  child2.stdout.on('data', (c) => { out2 += c; });
  child2.stderr.on('data', (c) => { out2 += c; });
  child2.on('exit', (c) => { exit2 = c; });
  const up2 = await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(out2), 10000);
  ok('пачка: страница на два документа поднялась', up2);
  if (up2) {
    const url2 = out2.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    const t2 = await (await fetch(`http://127.0.0.1:${dp}/json/new?${url2}`, { method: 'PUT' })).json();
    const cdp2 = new CDP(t2.webSocketDebuggerUrl);
    await cdp2.connect(); await cdp2.send('Runtime.enable'); await cdp2.send('Page.enable');
    await until(() => cdp2.evalJs('document.querySelectorAll(".doc").length===2'), 10000);

    const names = await cdp2.evalJs(`(function(){
      var n=[...document.querySelectorAll('input[type=radio]')].map(function(r){return r.name;});
      return {unique: new Set(n).size, total: n.length,
              perDoc: [...document.querySelectorAll('.doc')].map(function(d){
                return [...d.querySelectorAll('input[type=radio]')].map(function(r){return r.name;});})};})()`);
    const crossTalk = names.perDoc[0].some((n) => names.perDoc[1].includes(n));
    ok('🔴 пачка: радиогруппы РАЗНЫХ документов не пересекаются', crossTalk === false,
      `имён ${names.unique} на ${names.total} кнопок`);

    // Кликаем «В1» в ОБОИХ документах и требуем, чтобы оба остались выбранными
    await cdp2.clickSelector('.doc:nth-of-type(1) section.q[data-qid="В1"] label.opt:nth-of-type(1) span');
    await cdp2.clickSelector('.doc:nth-of-type(2) section.q[data-qid="В1"] label.opt:nth-of-type(1) span');
    const both = await cdp2.evalJs(`(function(){
      var d=[...document.querySelectorAll('.doc')];
      return d.map(function(x){var r=x.querySelector('section.q[data-qid="В1"] input[type=radio]:checked');
        return r? r.value : null;});})()`);
    ok('🔴 пачка: ответ на В1 во ВТОРОМ документе НЕ снимает ответ в первом',
      both[0] === 'а' && both[1] === 'а', JSON.stringify(both));

    await cdp2.clickSelector('#send');
    await until(() => exit2 !== null, 12000);
    const dA = fs.existsSync(decisionPath) ? JSON.parse(fs.readFileSync(decisionPath, 'utf8')) : {};
    const dB = fs.existsSync(decB) ? JSON.parse(fs.readFileSync(decB, 'utf8')) : {};
    ok('🔴 пачка: ОБА ответа доехали в свои файлы решений',
      dA.answers?.['В1']?.choice === 'а' && dB.answers?.['В1']?.choice === 'а',
      `A=${dA.answers?.['В1']?.choice} B=${dB.answers?.['В1']?.choice}`);
    fs.rmSync(decB, { force: true });
    const archB = fs.existsSync(ARCHIVE_DIR) ? fs.readdirSync(ARCHIVE_DIR).filter((f) => f.startsWith('interview_991_verify_batch--')) : [];
    archB.forEach((f) => fs.rmSync(path.join(ARCHIVE_DIR, f), { force: true }));
  }
  try { child2.kill('SIGKILL'); } catch {}
  fs.rmSync(fixtureB, { force: true });

  // ── БЛОК 6. Гейт ПОСЛЕ ответа и дрейф текста ────────────────────────────────────────────────
  ok('гейт: после ответа ОТКРЫТ по В1', gate(relFixture, { question: 'В1', quiet: true }) === GATE_EXIT.OK);
  fs.writeFileSync(FIXTURE, md.replace('## В1. Первый вопрос — варианты таблицей?',
    '## В1. Первый вопрос — варианты таблицей? (формулировка изменена ПОСЛЕ ответа)'), 'utf8');
  ok('гейт: дрейф текста после ответа аннулирует его',
    gate(relFixture, { question: 'В1', quiet: true }) === GATE_EXIT.DRIFTED);

  // ── БЛОК 7. МУТАЦИИ ГАРДА: гард, который ни разу не краснел, ничего не доказывает ───────────
  const guardRun = () => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'owner.mjs'), 'guard'],
    { encoding: 'utf8', timeout: 60000 });
  // ⚠️ Проверки гарда НЕ привязываем к живому состоянию репозитория (в нём в любой момент может
  // законно висеть интервью — и тогда «гард зелёный» покраснеет не по делу; это ровно тот
  // анти-паттерн, о котором предупреждает qa-suite). Судим ОТНОСИТЕЛЬНО исходного состояния:
  // мутация обязана ДОБАВИТЬ свою находку, а уборка — вернуть всё как было.
  const clean = guardRun();
  ok('гард: печатает число унаследованного долга ВСЕГДА', /унаследованный долг/.test(clean.stdout));

  const mutantOrphan = path.join(ROOT, 'plans', '_verify_mutant_question.md');
  fs.writeFileSync(mutantOrphan, '# Мутант\n\nЭто заведомо новое нарушение — ждёт ответа Криника по развилке.\n', 'utf8');
  const m1 = guardRun();
  ok('мутация 1: НОВОЕ нарушение делает гард красным',
    m1.status === 1 && m1.stdout.includes('_verify_mutant_question.md'), `exit ${m1.status}`);
  fs.rmSync(mutantOrphan, { force: true });

  const mutantStale = path.join(ROOT, 'interviews', '_verify_mutant_stale.md');
  fs.writeFileSync(mutantStale, ['# Мутант — протухший статус', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Вопрос?', '', '**Ответ Криника:** давно отвечено', '', ''].join('\n'), 'utf8');
  const m2 = guardRun();
  ok('мутация 2: ПРОТУХШИЙ СТАТУС делает гард красным',
    m2.status === 1 && /СТАТУС ПРОТУХ/.test(m2.stdout), `exit ${m2.status}`);
  fs.rmSync(mutantStale, { force: true });

  const m3 = guardRun();
  ok('мутация 3: после уборки мутантов находки исчезли, состояние вернулось к исходному',
    !m3.stdout.includes('_verify_mutant') && !/СТАТУС ПРОТУХ/.test(m3.stdout) && m3.status === clean.status,
    `exit ${m3.status} (исходный ${clean.status})`);

  // ── БЛОК 8. АВТОЗАКРЫТИЕ (правка Криника 1.4) — проверяем платформенную правду, на которой оно
  // держится: браузер разрешает window.close() ТОЛЬКО окну, которое открыл сам скрипт/ключ --app.
  // Проверка осмысленна лишь в НЕ headless-режиме, поэтому под --headful; иначе честно пропускаем
  // (пропуск объявляем вслух — «зелено, потому что не гоняли» это ложь, а не результат).
  ok('автозакрытие: лаунчер окна-приложения найден и команда собрана верно',
    !!appLauncher && appLauncher.args('http://x/').join(' ').includes('--app=http://x/'),
    appLauncher ? appLauncher.label : 'браузера нет');
  if (HEADFUL) {
    const appProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-app-'));
    const pageFile = path.join(SANDBOX, 'appwin.html');
    fs.writeFileSync(pageFile, '<!doctype html><title>appwin</title><body>окно-приложение</body>', 'utf8');
    const appChrome = spawn(CHROME, [`--app=file://${pageFile}`, '--remote-debugging-port=9334',
      `--user-data-dir=${appProfile}`, '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
    try {
      await until(async () => (await fetch('http://127.0.0.1:9334/json/version')).ok, 15000);
      const list = await (await fetch('http://127.0.0.1:9334/json/list')).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes('appwin.html'));
      ok('автозакрытие: окно-приложение поднялось', !!t);
      if (t) {
        const c2 = new CDP(t.webSocketDebuggerUrl);
        await c2.connect(); await c2.send('Runtime.enable');
        await c2.send('Runtime.evaluate', { expression: 'window.close()' });
        const gone = await until(async () => {
          const l = await (await fetch('http://127.0.0.1:9334/json/list')).json();
          return !l.some((x) => x.url.includes('appwin.html'));
        }, 6000);
        ok('🔴 автозакрытие: window.close() РЕАЛЬНО закрывает окно-приложение', gone);
      }
    } finally {
      try { appChrome.kill('SIGKILL'); } catch {}
      fs.rmSync(appProfile, { recursive: true, force: true });
    }
  } else {
    console.log('⏭  автозакрытие в окне-приложении НЕ проверялось (нужен --headful) — так и записываем');
  }

  // ── БЛОК 9. Уборка за собой — и ПРОВЕРКА, что след убран ────────────────────────────────────
  if (!KEEP) {
    fs.rmSync(decisionPath, { force: true });
    // Архив пересканируем ЗДЕСЬ: прогон пачки дописал в него новые копии уже после первого замера,
    // и уборка по устаревшему списку оставляла хвост (поймано самой проверкой «след убран»).
    fs.readdirSync(ARCHIVE_DIR)
      .filter((f) => /^interview_99[01]_verify/.test(f))
      .forEach((f) => fs.rmSync(path.join(ARCHIVE_DIR, f), { force: true }));
    fs.rmSync(FIXTURE, { force: true });
    const traceGone = !fs.existsSync(decisionPath) && !fs.existsSync(FIXTURE) &&
      !fs.readdirSync(ARCHIVE_DIR).some((f) => /^interview_99[01]_verify/.test(f)) &&
      !fs.existsSync(mutantOrphan) && !fs.existsSync(mutantStale);
    ok('уборка: след прогона убран полностью', traceGone);
  } else {
    console.log(`ℹ️  --keep: фикстура и кадры остались в ${path.relative(ROOT, SANDBOX)}`);
  }
  console.log(`🖼  кадры страницы для глаз владельца: ${path.relative(ROOT, SANDBOX)}/page-light.png · page-dark.png`);
  return failed ? 1 : 0;
}

// Контраст по WCAG: относительная яркость двух цветов вида "rgb(r, g, b)".
function contrast(fg, bg) {
  const lum = (c) => {
    const [r, g, b] = (c.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ⚠️ Осиротевшие процессы уже были в поле: всё, что мы запустили, убиваем в finally.
try {
  const code = await run();
  console.log(failed
    ? `\n❌ QA ЖИВЫМ БРАУЗЕРОМ: провалено ${failed} из ${total}`
    : `\n✅ QA ЖИВЫМ БРАУЗЕРОМ: все ${total} проверок зелёные`);
  process.exitCode = code;
} catch (e) {
  console.error('💥 QA-прогон упал:', e.message);
  process.exitCode = 1;
} finally {
  try { child?.kill('SIGKILL'); } catch {}
  try { chrome?.kill('SIGKILL'); } catch {}
  if (profileDir) { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }
}
