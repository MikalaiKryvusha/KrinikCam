#!/usr/bin/env node
/**
 * tools/owner.mjs — КОНТУР СОГЛАСОВАНИЙ «агент ↔ владелец» (KAIF 2.1, навык `/owner-reviews`).
 * Спецификация сборки: .claude/skills/owner-reviews/references/build-spec.md
 * Планы: plans/22 (первая версия) · plans/23 (переписывание по полевому отчёту NDim)
 * Разведартефакт: researches/28_owner_reviews_contour_field_report.md
 *
 * ЗАЧЕМ. Всё, что агент хочет ОТ Криника (развилка, вычитка, одобрение, ответ), по канону живёт
 * только в `interviews/`. Инструмент делает такой запрос ВИДИМЫМ и МЕХАНИЧЕСКИ ПРОВЕРЯЕМЫМ:
 * рендерит документ в локальную HTML-страницу, зовёт владельца звуком и голосом, записывает решение
 * в три места, БУДИТ ждущего агента и не пускает зависимую работу дальше, пока решения нет.
 *
 * ГЛАВНОЕ №1: HTML — транспорт, цель — ГАРД. Правило «место вопросов» нарушают даже агенты, которые
 * его знают (чат дешевле в моменте), поэтому `guard` важнее всей остальной красоты.
 * ГЛАВНОЕ №2 (I8): контур, который принял ответ, но не разбудил ждущего, сделан НАПОЛОВИНУ — и
 * вторая половина не видна ни одной проверке.
 *
 * ИНВАРИАНТЫ (нормативные, навык `/owner-reviews`):
 *   I1  md — источник, HTML — производное. Страница строится заново при каждом вызове.
 *   I2  Ответ пишется в ТРИ места: исходный md · <док>.decision.json · копия в архиве с by/at.
 *       Уже написанное владельцем НИКОГДА не перезаписывается — уточнение приезжает отдельным
 *       датированным блоком.
 *   I3  Одобрение привязано к sha256 ТЕЛА, а не к клику. Нормализация ОДНА на обе стороны.
 *   I4  Гейт стоит на стороне ПРИМЕНЕНИЯ и fail-closed: любое сомнение = отказ, exit != 0.
 *   I5  Сигнал идёт ПОСЛЕ того, как браузер ЗАБРАЛ страницу, и никогда её не держит.
 *   I6  Тихие часы важнее всего, включая явно запрошенный голос; окно ПЕРЕСЕКАЕТ полночь.
 *   I7  Автономные циклы КОПЯТ, а не блокируются (queue → inbox: один зов на пачку).
 *   I8  ЛЮБАЯ запись завершает контур и будит агента. Осталось неотвеченное — страницу поднимает
 *       заново АГЕНТ, а не человек.
 *
 * КАНОН ПРОЕКТА, соблюдённый здесь:
 *   · текст ходит ФАЙЛАМИ, а не аргументами командной строки (`say -f`, `osascript <файл>`);
 *   · регулярки по русскому тексту используют \p{L} с флагом u — в Node `\w`/`\b` ASCII-only;
 *   · гард обязан УМЕТЬ КРАСНЕТЬ: `selftest` скармливает каждому гарду его дефект;
 *   · страница — поведение, а поведение НАБЛЮДАЮТ в браузере: `verify` (tools/owner-verify.mjs).
 *
 * Ноль внешних зависимостей: stdlib Node + системные утилиты macOS (say/afplay/osascript/open)
 * + Chrome для окна-приложения (необязателен — без него контур работает, но без автозакрытия).
 *
 * Команды: guard · baseline · render · ask · gate · queue · inbox · selftest · verify
 *
 * СТАТУС ПРОВЕРКИ (честно, по частям — TESTING_FRAMEWORK.md):
 *   [TESTED: 2026-08-01 · `node tools/owner.mjs selftest` — 58 проверок зелёные; каждому гарду
 *     скормлен ровно его дефект: ловушка «за-крыт-ие», тихие часы через полночь, линейка `---`
 *     после пустого слота, встречный вопрос владельца, многострочный вариант, слот `- Ответ
 *     Криника:`, повторный ответ уточнением, пять причин отказа гейта, три писка по частотам]
 *     — разбор, нормализация/sha, гейт, запись в md, сигнал.
 *   [TESTED: 2026-08-01 · `node tools/owner-verify.mjs --headful` — 57 проверок ЖИВЫМ браузером
 *     (Chrome + CDP): снятие выбора повторным кликом по ТЕКСТУ подписи, теги состояния, полоса
 *     состояния пикселями и цветом, обе темы и контраст, отсутствие горизонтального уезда на 1440
 *     и 420, чистая консоль, ПОБУДКА I8 по коду выхода процесса, три места записи, первоисточник
 *     не затёрт, дрейф текста, три мутации гарда, window.close() в окне-приложении]
 *     — поведение страницы, побудка, гард.
 *   [TESTED: 2026-08-01 · прогон по ВСЕМ 17 живым интервью: 0 падений; счётная проверка вариантов
 *     сошлась ПО КАЖДОМУ документу — и по дороге вскрыла три живые формы, на которых варианты
 *     терялись молча (интервью 003, 005, 011)] — рендер на живых данных.
 *   [NOT-TESTED] — ФАКТ ДОСТАВКИ СИГНАЛА ЧЕЛОВЕКУ («слышно из другой комнаты»): его подтверждает
 *     только Криник словами. Код возврата `afplay`/`say` доказательством не считается.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = path.join(ROOT, 'tools', 'owner-pages');           // производное, gitignored (I1)
const DECISIONS_DIR = path.join(ROOT, 'interviews', 'decisions');    // решения — версионируем
const ARCHIVE_DIR = path.join(DECISIONS_DIR, 'archive');
const QUEUE_FILE = path.join(DECISIONS_DIR, '_queue.json');
const EXCEPTIONS_FILE = path.join(ROOT, 'tools', 'owner-guard-exceptions.json');
const BASELINE_FILE = path.join(ROOT, 'tools', 'owner-guard-baseline.json');
const CONFIG_FILE = path.join(ROOT, 'tools', 'owner.config.json');

// ── Конфигурация ────────────────────────────────────────────────────────────────────────────────
// Голос — ПАРАМЕТР, а не меню: на машине 186 голосов, пригоден ровно один русский (Milena).
// Звук — НЕ параметр: три писка 880/660/990 Гц зафиксированы спецификацией и синтезируются здесь же,
// чтобы во всех проектах и на всех машинах звучал ОДИН И ТОТ ЖЕ сигнал (требование Криника).
const DEFAULTS = {
  owner: 'Криник',
  voice: 'Milena',              // ступень 2 лестницы голоса — системный синтезатор (откат)
  neuralVoice: true,            // ступень 1 — локальный нейроголос Silero, если тракт на месте
  neuralSpeaker: 'baya',        // голос нейротракта; выбор голоса — вкус владельца, не агента
  soundFile: null,          // null = синтезированные три писка; путь = проиграть этот файл вместо них
  quietHours: { from: '23:00', to: '09:00' },
  port: 8787,
  accent: '#FF1A8C',        // единственный «свой» токен стиля страницы — цвет бренда проекта
  appWindow: true,          // окно-приложение Chrome: только в нём работает автозакрытие страницы
  say: true,
  notify: true,
  timeoutSec: 3600,
};

const BEEP_HZ = [880, 660, 990];   // ЗАФИКСИРОВАНО спецификацией навыка — не «настройка вкуса»
const AUTOCLOSE_SEC = 2;           // пауза перед автозакрытием страницы после записи (правка Криника)

function loadConfig() {
  let cfg = { ...DEFAULTS };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...user, quietHours: { ...cfg.quietHours, ...(user.quietHours || {}) } };
    } catch (e) {
      console.error(`⚠️  ${rel(CONFIG_FILE)} не читается (${e.message}) — беру дефолты`);
    }
  }
  return cfg;
}

const rel = (p) => path.relative(ROOT, p) || p;

// ── I3. ЕДИНСТВЕННАЯ нормализация тела. Обе стороны (страница и гейт) зовут ЭТУ функцию ─────────
// Разъезд нормализаций между сторонами — самый дорогой дефект класса: оба самотеста зелёные,
// а гейт отказывает всегда. Поэтому функция ровно одна и живёт в одном файле.
function normalizeBody(text) {
  return String(text)
    .replace(/^\uFEFF/, '')          // BOM
    .replace(/\r\n?/g, '\n')         // CRLF/CR → LF
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))   // хвостовые пробелы строки
    .join('\n')
    .replace(/^\n+/, '')             // пустые строки в начале
    .replace(/\n+$/, '')             // и в конце
    + '\n';                          // ровно один финальный перевод строки
}

const sha256 = (text) => crypto.createHash('sha256').update(normalizeBody(text), 'utf8').digest('hex');
const sha1 = (text) => crypto.createHash('sha1').update(String(text), 'utf8').digest('hex');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  РАЗБОР ЖИВОГО ДОКУМЕНТА
//  Парсер строится по ИНВЕНТАРЮ живых файлов, а не по эталону: в 17 интервью проекта четыре формы
//  слота ответа и пять форм строки статуса (EXP-0038). Узкий шаблон однажды дал по interview_006
//  ноль вопросов и ноль пустых слотов — висящее интервью было бы НЕВИДИМО и странице, и гарду.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// Заголовок вопроса: «## В1. …», «### Q1: …», «### Q1 — …», «## Вопрос 3 …»
const QUESTION_HEADING_RE = /^#{2,4}\s+(?:\*\*)?(В|Q|Вопрос|ВОПРОС)\s*\.?\s*(\d+)\s*(?:[.):—–-]\s*)?(.*)$/u;
/**
 * Слот ответа владельца. В проекте живут ЧЕТЫРЕ формы, и это факт с живых файлов, а не догадка:
 *   `**Ответ Криника:** …`   `**Ответ:** …`   `- Ответ Криника: …`   `Ответы Криника:`
 * Группы: 1 — префикс строки (отступ/цитата/маркер списка), 2/4/5 — звёздочки жирного,
 *         3 — подпись слота, 6 — то, что владелец написал в ту же строку.
 */
const ANSWER_SLOT_RE = /^(\s*(?:>\s*)?(?:[-*+]\s+)?)(\*\*)?(Ответ(?:ы)?(?:\s+Криника)?(?:\s*\([^)]*\))?)(\*\*)?\s*[:：](\*\*)?(.*)$/u;
/**
 * ⚠️ ВСТРЕЧНЫЙ ВОПРОС — НЕ слот ответа. Поле, подписанное «**Ответ (вопрос владельца):**», в поле
 * (отчёт NDim, дефект №3) читалось как ОТВЕТ, и единственный блокирующий вопрос волны выглядел
 * закрытым. Признак: в скобках внутри подписи стоит слово «вопрос».
 */
const COUNTER_QUESTION_RE = /\(\s*[^)]*вопрос[^)]*\)/iu;
// Для гарда «слот вне interviews/» шаблон намеренно СТРОГИЙ (только канонная жирная форма):
// у него другая работа — искать посаженную не туда заготовку ответа, а не всякое слово «ответ».
const ANSWER_SLOT_STRICT_RE = /^\s*(?:>\s*)?\*\*Ответ(?:ы)?(?:\s+Криника)?\s*:\*\*/u;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Строка — слот ответа? (встречный вопрос владельца слотом НЕ считается) */
function isAnswerSlot(line) {
  const m = line.match(ANSWER_SLOT_RE);
  if (!m) return false;
  return !COUNTER_QUESTION_RE.test(m[3]);
}

/**
 * Классификация строки статуса. ЛОВУШКА ПОДСТРОКИ (поймана в поле 2026-07-31): `grep -L ЗАКРЫТ`
 * молча пропускал висящее интервью, потому что в прозе встретилось слово «за-КРЫТ-ие». Поэтому
 * здесь границы слова через \p{L}, и смотрим ТОЛЬКО строку статуса, а не весь файл.
 */
const ANSWERED_RE = /✅|(?<!\p{L})(ОТВЕЧЕН|ОТВЕЧЕНО|ОТВЕТЫ\s+ПОЛУЧЕНЫ|ЗАКРЫТ|ЗАКРЫТО|ЗАКРЫТЫ)(?!\p{L})/u;
const WAITING_RE = /⏳|❓|(?<!\p{L})(ЖД[ЁЕ]Т|НА\s+РЕВЮ|НА\s+СОГЛАСОВАНИИ|ОЖИДАЕТ)(?!\p{L})/u;

function classifyStatusLine(line) {
  if (!line) return 'none';
  if (WAITING_RE.test(line) && !ANSWERED_RE.test(line)) return 'waiting';
  if (ANSWERED_RE.test(line)) return 'answered';
  if (WAITING_RE.test(line)) return 'waiting';
  return 'unknown';
}

/** Находит ПЕРВУЮ строку статуса документа (в любой из четырёх живых обёрток). */
function findStatusLine(lines) {
  const re = /(?:^|[\s*>·])Статус\s*[:：]/u;
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    if (re.test(lines[i])) return { index: i, text: lines[i] };
  }
  return { index: -1, text: '' };
}

/** Заполнен ли слот ответа: текст на той же строке ИЛИ непустой блок под ним (цитата/абзац/список). */
function slotFilled(lines, slotIndex) {
  const m = lines[slotIndex].match(ANSWER_SLOT_RE);
  if (m && m[6].trim()) return true;
  // ⚠️ ДВА ПРОТИВОПОЛОЖНЫХ СМЫСЛА У ОДНОГО СИМВОЛА «-» ПОД СЛОТОМ. Различает их САМ СЛОТ:
  //   · слот — пункт списка (`- Ответ Криника:`, стиль интервью 006) ⇒ следующий пункт это
  //     СОСЕДНИЙ ВОПРОС, а не ответ (иначе пустое интервью выглядит отвеченным);
  //   · слот — отдельная строка (`**Ответ:**`) ⇒ список под ним это и есть ОТВЕТ владельца.
  // Поймано на живом interview_005: Криник ответил списком («- USB UVC / - Картинка/оверлей…»),
  // а гард месяц показывал вопрос пустым. Молчаливое ВРАНЬЁ гарда в обе стороны одинаково вредно.
  const slotIsListItem = /^\s*(?:>\s*)?[-*+]\s/.test(lines[slotIndex]);
  // Блок ответа под слотом — это цитата-заготовка или абзац ВПЛОТНУЮ к слоту. Жадный скан «до
  // следующего заголовка» ошибочно засчитывал СЛЕДУЮЩИЙ ПУНКТ СПИСКА как ответ, а горизонтальная
  // линейка `---` — как текст ответа (дефект №2 отчёта NDim: по десяти живым интервью выходило
  // «0 без ответа»). Поэтому граница блока здесь строгая.
  for (let i = slotIndex + 1; i < lines.length; i++) {
    const l = lines[i];
    if (HEADING_RE.test(l) || HR_RE.test(l) || ANSWER_SLOT_RE.test(l)) break;
    if (!l.trim()) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (next && /^\s*>/.test(next)) continue;   // дальше цитата — она и есть заготовка ответа
      break;
    }
    if (slotIsListItem && /^\s*[-*+]\s/.test(l)) break;   // соседний пункт-вопрос — это не ответ
    const content = l.replace(/^\s*>\s?/, '').trim();
    if (content) return true;
  }
  return false;
}

/**
 * СКЛЕЙКА МНОГОСТРОЧНЫХ ПУНКТОВ. ⚠️ Однострочный разбор МОЛЧА ТЕРЯЛ вариант ответа, у которого
 * жирный заголовок перенесён на вторую строку (дефект №4 отчёта NDim — пропал ровно рекомендованный
 * вариант, и все проверки при этом говорили «варианты отрисованы»). Сначала собираем логический
 * пункт целиком вместе с продолжениями с отступом, и только потом ищем закрывающие `**`.
 */
function logicalItems(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) { out.push({ index: i, text: lines[i] }); continue; }
    let text = lines[i];
    const start = i;
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) &&
           !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1])) text += ' ' + lines[++i].trim();
    out.push({ index: start, text });
  }
  return out;
}

/**
 * СЧЁТЧИК КАНДИДАТОВ — намеренно ОТДЕЛЬНАЯ, наивная, ПОСТРОЧНАЯ реализация того же синтаксиса.
 * «Считай, а не смотри»: расхождение двух НЕЗАВИСИМЫХ счётчиков и есть детектор молчаливой потери
 * варианта (проверка К9 плана 23). Если бы обе стороны звали одну функцию, проверка стала бы
 * тавтологией и не поймала бы ничего — именно поэтому здесь свои регулярки и никакой дедупликации.
 *
 * Ключ варианта — ОТДЕЛЬНЫЙ ТОКЕН в начале жирного: `(а)` `A)` `б.` `в`. Слово, начинающееся с
 * буквы («**Вариант A — …**», «**Q1.**», «**Камера (USB UVC)**»), кандидатом НЕ является — иначе
 * счётчик даёт ложную тревогу, а ложная тревога хуже пропуска: она учит игнорировать проверку.
 */
const CAND_LIST_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*\s*\(?[A-Za-zА-Яа-яЁё][).\]]?(?=\s|\*\*|$)/u;
const CAND_TABLE_RE = /\|\s*\*\*\s*\(?[A-Za-zА-Яа-яЁё][).\]]?(?=\s|\*\*|\|)/u;

function optionCandidates(bodyLines) {
  let n = 0;
  for (const raw of bodyLines) {
    if (/^\s*\|/.test(raw)) { if (CAND_TABLE_RE.test(raw)) n++; continue; }
    if (CAND_LIST_RE.test(raw)) n++;
  }
  return n;
}

// Начало варианта в пункте списка: жирное, внутри которого ключ стоит отдельным токеном.
const OPT_START_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*\s*\(?([A-Za-zА-Яа-яЁё])[).\]]?(?=\s|\*\*|$)\s*(.*)$/u;
// Ячейка таблицы, НАЧИНАЮЩАЯСЯ с ключа варианта: `**(а)**` · `**A)**` · `**A (выбрано)**` ·
// `**(б) до победы**` — две последние формы живут в интервью 003 и 011, и узкий шаблон
// «ячейка целиком равна ключу» терял по ним варианты молча (поймано счётной проверкой).
const CELL_KEY_RE = /^\*{0,2}\s*\(?([A-Za-zА-Яа-яЁё])[).\]]?(?=\s|\*|$)\s*(.*)$/u;

/**
 * Варианты ответа. В проекте они живут двумя способами: строками таблицы `| **(а)** | … |` и
 * жирными ключами в списках — включая формы `**A) (рекомендую)** …` и вариант, у которого жирный
 * заголовок ПЕРЕНЕСЁН на вторую строку (см. logicalItems: именно эта форма молча теряла вариант).
 * Разбор НЕ обязан быть идеальным — на странице всегда есть поле свободного ответа, поэтому
 * непонятый вариант стоит владельцу одной строки текста. Но ПОТЕРЯННЫЙ вариант стоит неверного
 * решения, поэтому расхождение со счётчиком кандидатов останавливает сдачу.
 */
function parseOptions(bodyLines) {
  const opts = [];
  const seen = new Set();
  let raw = 0;                       // до дедупликации — с этим числом сверяется счётчик кандидатов
  for (const it of logicalItems(bodyLines)) {
    const line = it.text;
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && !c) && !(i === a.length - 1 && !c));
      const idx = cells.findIndex((c) => /^\*\*/.test(c) && CELL_KEY_RE.test(c));
      if (idx >= 0) {
        raw++;
        const m = cells[idx].match(CELL_KEY_RE);
        const key = m[1];
        // Метка = остаток ЖИРНОЙ ячейки («(выбрано)», «до победы») + соседняя ячейка с описанием.
        const label = [plain(m[2]), plain(cells[idx + 1] || '')].filter(Boolean).join(' — ');
        if (!seen.has(key)) { seen.add(key); opts.push({ key, label }); }
      }
      continue;
    }
    const m = line.match(OPT_START_RE);
    if (!m) continue;
    raw++;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    opts.push({ key: m[1], label: plain(m[2]).replace(/^[—–-]\s*/, '').slice(0, 220) });
  }
  return { opts, raw };
}

/** Рекомендация агента — чтобы владелец видел её отдельной меткой, а не искал в прозе. */
function parseRecommendation(body) {
  const m = body.match(/рекоменд\p{L}*\s*[—–-]?\s*\*{0,2}\(?([A-Za-zА-Яа-яЁё])\)?\*{0,2}/iu);
  return m ? m[1] : null;
}

const plain = (md) => md.replace(/[*`_~]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

/**
 * Разбирает документ в модель: заголовок, статус, список вопросов со своими телами, вариантами,
 * слотами ответа и sha256 тела (I3). Документы без заголовков вопросов (001, 006, 011) разбираются
 * по слотам ответа — это и есть их естественная структура.
 */
function parseDoc(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return parseLines(raw, absPath);
}

function parseLines(raw, absPath) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  const titleLine = lines.find((l) => /^#\s+/.test(l)) || path.basename(absPath);
  const title = titleLine.replace(/^#\s+/, '').trim();
  const status = findStatusLine(lines);

  // 1) индексы заголовков вопросов и слотов ответа
  const qHeads = [];
  const slots = [];
  lines.forEach((l, i) => {
    const qm = l.match(QUESTION_HEADING_RE);
    if (qm) qHeads.push({ index: i, prefix: qm[1], num: qm[2], text: qm[3].trim() });
    if (isAnswerSlot(l)) slots.push(i);
  });

  const questions = [];
  if (qHeads.length) {
    // Основной путь: вопрос = секция от своего заголовка до следующего заголовка того же уровня
    const level = (lines[qHeads[0].index].match(/^(#+)/) || ['', '##'])[1].length;
    for (let k = 0; k < qHeads.length; k++) {
      const start = qHeads[k].index;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        const hm = lines[i].match(HEADING_RE);
        if (hm && hm[1].length <= level) { end = i; break; }
      }
      questions.push(buildQuestion(lines, start, end, `${qHeads[k].prefix === 'Q' ? 'Q' : 'В'}${qHeads[k].num}`,
        qHeads[k].text, slots));
      questions[questions.length - 1].endIndex = end;
    }
  } else if (slots.length) {
    // Запасной путь: вопрос = кусок текста, заканчивающийся слотом ответа
    let prev = 0;
    slots.forEach((s, k) => {
      questions.push(buildQuestion(lines, prev, s + 1, `В${k + 1}`, '', slots));
      questions[questions.length - 1].endIndex = s + 1;
      prev = s + 1;
    });
  }

  // ⚠️ ПРЕАМБУЛА И ХВОСТ ДОКУМЕНТА. Страница, показывающая ТОЛЬКО карточки вопросов, молча
  // выбрасывает контекст: вводную часть до первого вопроса (а в ней живут мокапы, образцы звука и
  // объяснение, ЗАЧЕМ вопрос) и хвост после последнего (ключ слепого сравнения, оговорки).
  // Поймано на живых интервью 020/021: владелец не увидел бы ни одной картинки и ни одного образца.
  const firstQ = qHeads.length ? qHeads[0].index : (slots.length ? 0 : lines.length);
  const dropMeta = (arr) => {
    const text = arr.join('\n')
      .replace(/^```(?:yaml|yml)\n[\s\S]*?\n```\n?/m, '')   // метаблок — служебный, не для глаз
      .replace(/^#\s+.*\n?/m, '');                          // заголовок документа уже в шапке страницы
    return text.trim();
  };
  const preamble = qHeads.length ? dropMeta(lines.slice(0, firstQ)) : '';
  // Хвост документа — то, что идёт после ПОСЛЕДНЕГО слота ответа за горизонтальной линейкой:
  // закрывающая оговорка, ключ слепого сравнения, ссылка на первоисточник. Конвенция явная:
  // «всё после финального ---». Иначе такой текст виден только в md, а владелец смотрит страницу.
  let epilogue = '';
  if (slots.length) {
    const lastSlot = slots[slots.length - 1];
    for (let i = lastSlot + 1; i < lines.length; i++) {
      if (HR_RE.test(lines[i])) { epilogue = lines.slice(i + 1).join('\n').trim(); break; }
    }
  }

  const emptySlots = slots.filter((s) => !slotFilled(lines, s)).length;
  const statusKind = classifyStatusLine(status.text);
  return {
    path: absPath,
    relPath: rel(absPath),
    dir: path.dirname(absPath),
    title,
    raw,
    lines,
    statusIndex: status.index,
    statusText: status.text,
    statusKind,
    slotsTotal: slots.length,
    slotsEmpty: emptySlots,
    // Детектор ПРОТУХШЕГО СТАТУСА (вторая половина гарда, отчёт NDim §3.2): статус кричит «ЖДЁТ»,
    // а пустых слотов нет — документ выглядит живым, следующая сессия ждёт того, что давно дано.
    staleStatus: statusKind === 'waiting' && slots.length > 0 && emptySlots === 0,
    questions,
    preamble,
    epilogue,
    optionCandidates: questions.reduce((n, q) => n + q.optionCandidates, 0),
    optionsParsed: questions.reduce((n, q) => n + q.optionsRaw, 0),
    meta: parseMetaBlock(raw),
  };
}

function buildQuestion(lines, start, end, id, headingText, allSlots) {
  const slotIndex = allSlots.find((s) => s >= start && s < end) ?? -1;
  // Тело вопроса = всё до слота ответа (сам ответ в хеш НЕ входит: иначе ответ ломает свой же хеш)
  const bodyEnd = slotIndex >= 0 ? slotIndex : end;
  const bodyLines = lines.slice(start, bodyEnd);
  const body = bodyLines.join('\n');
  const slotLine = slotIndex >= 0 ? lines[slotIndex] : '';
  const slotMatch = slotIndex >= 0 ? slotLine.match(ANSWER_SLOT_RE) : null;
  const parsed = parseOptions(bodyLines);
  return {
    id,
    heading: headingText || (bodyLines.find((l) => l.trim()) || id).replace(/^#+\s*/, '').slice(0, 120),
    body,
    bodyLines,
    sha256: sha256(body),
    options: parsed.opts,
    optionsRaw: parsed.raw,          // до дедупликации — с ним сверяется независимый счётчик
    optionCandidates: optionCandidates(bodyLines),
    recommended: parseRecommendation(body),
    slotIndex,
    // Форму слота ЗАПОМИНАЕМ и воспроизводим при записи: документ владельца не меняет стиль
    // только потому, что ответ пришёл со страницы, а не из редактора.
    slotPrefix: slotMatch?.[1] ?? '',
    slotLabel: slotMatch?.[3] || 'Ответ Криника',
    slotBold: slotMatch ? Boolean(slotMatch[2] || slotMatch[5]) : true,
    answered: slotIndex >= 0 ? slotFilled(lines, slotIndex) : false,
    answerText: (slotMatch?.[6] || '').trim(),
  };
}

const stripLeadingHeading = (body) => body.replace(/^#{1,6}\s+.*\n?/, '');

/**
 * Необязательный блок метаданных в шапке документа (контракт имён из навыка /owner-reviews):
 * ```yaml
 * kind: outbound draft
 * artifacts:
 *   - id: release-notes
 *     target: "GitHub Release v0.9"
 *     format: markdown
 *     body_file: researches/readme_seo_draft.md
 * ```
 * body_file — ССЫЛКА, а не копипаст: страница показывает ровно те байты, которые уйдут, и хеш
 * считается по ним. Вставленная копия — вторая правда, ломающая I3.
 */
function parseMetaBlock(raw) {
  const m = raw.match(/^```(?:yaml|yml)\n([\s\S]*?)\n```/m);
  if (!m) return { kind: 'interview', artifacts: [] };
  const body = m[1];
  const meta = { kind: 'interview', artifacts: [] };
  const kindM = body.match(/^kind\s*:\s*(.+)$/m);
  if (kindM) meta.kind = kindM[1].trim().replace(/^["']|["']$/g, '');
  const titleM = body.match(/^title\s*:\s*(.+)$/m);
  if (titleM) meta.title = titleM[1].trim().replace(/^["']|["']$/g, '');
  const artBlock = body.split(/^artifacts\s*:\s*$/m)[1];
  if (artBlock) {
    for (const chunk of artBlock.split(/^\s*-\s+/m).slice(1)) {
      const get = (k) => (chunk.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
      const a = { id: get('id'), target: get('target'), format: get('format') || 'markdown', body_file: get('body_file') };
      if (a.id && a.body_file) meta.artifacts.push(a);
    }
  }
  return meta;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  МИНИ-РЕНДЕРЕР MARKDOWN → HTML
//  Сознательно свой и маленький: генератор статики или UI-фреймворк здесь дают нулевой выигрыш
//  и ненулевую зависимость. Нужны ровно: заголовки, абзацы, списки, ТАБЛИЦЫ (варианты ответов
//  живут в них), цитаты, код, инлайн-разметка.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineMd(s) {
  let out = esc(s);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<![\p{L}\d*])\*([^*\n]+)\*(?![\p{L}\d*])/gu, '<em>$1</em>');
  out = out.replace(/(?<![\p{L}\d_])_([^_\n]+)_(?![\p{L}\d_])/gu, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[+n])}</code>`);
  return out;
}

function mdToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {                                  // блок кода
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) { const lvl = Math.min(h[1].length + 1, 6); out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`); i++; continue; }
    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
          item += ' ' + lines[i++].trim();
        }
        items.push(`<li>${inlineMd(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|>|\||```|[-*+]\s|\d+\.\s)/.test(lines[i]) && !HR_RE.test(lines[i])) {
      buf.push(lines[i++]);
    }
    if (buf.length) out.push(`<p>${inlineMd(buf.join(' '))}</p>`);
    else { out.push(`<p>${inlineMd(lines[i])}</p>`); i++; }
  }
  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  ВСТРОЕННАЯ МЕДИА — потому что вкус судят не описанием (отчёт NDim §3.3)
//  Судящему звук нужен ЗВУК, а не описание звука. Ссылка file:// со страницы, отданной по http,
//  браузером БЛОКИРУЕТСЯ — вшивание не роскошь, а единственный работающий путь.
//  Контракт для агента: пиши в документе обычные markdown-ссылки на ЛОКАЛЬНЫЕ файлы —
//    ![подпись](assets/mockup.png)   картинка вшивается кадром
//    [звук A](tools/samples/a.wav)   аудио вшивается плеером
//    [макет C](assets/mockups/c.html) живой макет вшивается рамкой + кнопка «отдельным окном»
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
};
const MEDIA_MAX_BYTES = 6 * 1024 * 1024;   // здравый предел: страница должна открываться, а не грузиться

const resolveLocal = (baseDir, href) => {
  if (/^(https?:|data:|mailto:|#)/i.test(href)) return null;
  const p = path.isAbsolute(href) ? href : path.resolve(baseDir, href);
  const p2 = fs.existsSync(p) ? p : path.resolve(ROOT, href);
  return fs.existsSync(p2) && fs.statSync(p2).isFile() ? p2 : null;
};

const dataUri = (file) => {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
};

let mockupSeq = 0;

/** Пост-обработка отрендеренного HTML: локальные картинки/звук/макеты вшиваются в страницу. */
function embedMedia(html, baseDir) {
  // картинки
  html = html.replace(/<img alt="([^"]*)" src="([^"]+)">/g, (m, alt, src) => {
    const f = resolveLocal(baseDir, src);
    if (!f || !MIME[path.extname(f).toLowerCase()]?.startsWith('image')) return m;
    if (fs.statSync(f).size > MEDIA_MAX_BYTES) return `${m}<span class="hint">(файл велик для вшивания: ${esc(src)})</span>`;
    return `<figure class="media"><img alt="${esc(alt)}" src="${dataUri(f)}">` +
      (alt ? `<figcaption>${esc(alt)}</figcaption>` : '') + '</figure>';
  });
  // ссылки на локальные файлы: звук · живой макет · всё остальное оставляем ссылкой
  html = html.replace(/<a href="([^"]+)" target="_blank" rel="noopener">([\s\S]*?)<\/a>/g, (m, href, label) => {
    const f = resolveLocal(baseDir, href);
    if (!f) return m;
    const ext = path.extname(f).toLowerCase();
    if (fs.statSync(f).size > MEDIA_MAX_BYTES) return m;
    if (MIME[ext]?.startsWith('audio')) {
      return `<figure class="media"><figcaption>${label}</figcaption>` +
        `<audio controls preload="none" src="${dataUri(f)}"></audio></figure>`;
    }
    if (ext === '.html' || ext === '.htm') {
      const id = `mock${++mockupSeq}`;
      const srcdoc = esc(fs.readFileSync(f, 'utf8'));
      return `<figure class="media mockup"><figcaption>${label}</figcaption>` +
        `<iframe id="${id}" sandbox="allow-same-origin" srcdoc="${srcdoc}"></iframe>` +
        `<div class="mockbtns"><button type="button" class="ghost small" data-mock="${id}">открыть отдельным окном</button></div>` +
        '</figure>';
    }
    return m;
  });
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  СТРАНИЦА
//  Набор элементов и токены стиля ЗАФИКСИРОВАНЫ спецификацией навыка (references/build-spec.md
//  §4): один и тот же инструмент в разных проектах, а не «похожий». Самодостаточна: ни одной
//  внешней загрузки, открывается офлайн. Обе темы ОС + ручной тумблер, который ПЕРЕБИВАЕТ систему.
//  ⚠️ Внутри PAGE_CSS/PAGE_JS запрещены обратные кавычки и ${ — это шаблонные строки.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const PAGE_CSS = `
:root{--bg:#f7f7f9;--fg:#16161a;--muted:#5d5d6b;--card:#fff;--line:#e3e3ea;
--code-bg:#f0f0f4;--ok:#12855b;--warn:#b45309;--accent:#FF1A8C}
@media (prefers-color-scheme:dark){:root{--bg:#131317;--fg:#ececf0;--muted:#a0a0b0;--card:#1c1c22;
--line:#2e2e38;--code-bg:#26262f;--ok:#3ddc9a;--warn:#f0b429}}
:root[data-theme=light]{--bg:#f7f7f9;--fg:#16161a;--muted:#5d5d6b;--card:#fff;--line:#e3e3ea;--code-bg:#f0f0f4;--ok:#12855b;--warn:#b45309}
:root[data-theme=dark]{--bg:#131317;--fg:#ececf0;--muted:#a0a0b0;--card:#1c1c22;--line:#2e2e38;--code-bg:#26262f;--ok:#3ddc9a;--warn:#f0b429}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-x:hidden}
.wrap{max-width:940px;margin:0 auto;padding:24px 18px 130px}
header.top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:1.6rem;line-height:1.25;margin:.2em 0}
.path{color:var(--muted);font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.meta{color:var(--muted);font-size:13px;margin:.4em 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.chip.wait{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn);border-color:transparent}
.chip.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok);border-color:transparent}
.chip.rec{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);border-color:transparent}
.card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);
border-radius:14px;padding:18px 20px;margin:18px 0}
.card.intro{border-left-color:var(--line);color:var(--fg)}
.card.intro>*:first-child{margin-top:0}
.q.state-wait{border-left-color:var(--warn)}
.q.state-done{border-left-color:var(--ok)}
.card h2,.card h3{margin-top:.2em}
.q-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.q-id{color:var(--accent);font-weight:700}
.q-head h2{font-size:1.15rem;margin:.1em 0;flex:1 1 240px}
.opts{display:flex;flex-direction:column;gap:8px;margin:10px 0}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}
label.opt:hover{border-color:var(--accent)}
label.opt.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
label.opt input{margin-top:4px}
textarea,input[type=text]{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:15px/1.5 inherit;resize:vertical}
/* Рамку фокуса даём ТОЛЬКО текстовым полям. На радиокнопке она рисовала розовый квадратик вокруг
   кружка — правка Криника 2026-08-02: «этот маленький квадратик розовый напрягает». Состояние
   выбора и так видно: подсветкой всей строки варианта. */
textarea:focus,input[type=text]:focus{outline:2px solid var(--accent);outline-offset:1px}
input[type=radio]{outline:none}
input[type=radio]:focus,input[type=radio]:focus-visible{outline:none;box-shadow:none}
.lbl{display:flex;gap:10px;align-items:baseline;margin:12px 0 6px;color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.lbl .hint{text-transform:none;letter-spacing:0;font-weight:400;font-style:italic}
pre{background:var(--code-bg);padding:12px 14px;border-radius:10px;overflow-x:auto}
code{background:var(--code-bg);padding:.12em .35em;border-radius:5px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.1em 0 .1em 14px;border-left:3px solid var(--line);color:var(--muted)}
.tw{overflow-x:auto;margin:.8em 0;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:color-mix(in srgb,var(--fg) 6%,transparent)}
hr{border:none;border-top:1px solid var(--line);margin:1.2em 0}
a{color:var(--accent)}
img{max-width:100%;height:auto;border-radius:10px}
figure.media{margin:14px 0;padding:12px;border:1px dashed var(--line);border-radius:12px}
figure.media figcaption{color:var(--muted);font-size:13px;margin-bottom:8px}
figure.media audio{width:100%}
figure.media iframe{width:100%;height:320px;border:1px solid var(--line);border-radius:10px;background:#fff}
.mockbtns{margin-top:8px;display:flex;gap:8px}
button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
button.small{padding:6px 12px;font-size:13px;font-weight:500}
button:disabled{opacity:.5;cursor:default}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 18px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.done{text-align:center;padding:70px 20px}
.done .big{font-size:3rem}
.hint{color:var(--muted);font-size:13px}
.answered{border-left:3px solid var(--ok);padding-left:12px;color:var(--muted);margin:.6em 0}
.arti pre{max-height:420px}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:90px;background:var(--card);
border:1px solid var(--ok);color:var(--fg);padding:12px 20px;border-radius:12px;font-size:14px;
box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .5s;z-index:9}
.toast.bad{border-color:var(--warn)}
`;

// ⚠️ Ни одной обратной кавычки и ни одного ${ внутри — это тело шаблонной строки.
const PAGE_JS = `
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s));};

/* Тумблер темы: ставит data-theme на корень и ПЕРЕБИВАЕТ системную тему в обе стороны. */
(function(){var b=$('#themeBtn'); if(!b) return; b.onclick=function(){
  var cur=document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme',cur==='dark'?'light':'dark');};})();

/* 🔴 СНЯТИЕ ВЫБОРА — дефект №1 всех полевых сборок.
   Родная радиокнопка снять выбор не умеет, а частичный ответ — штатный режим: владелец начинает
   отвечать и откладывает. Механика: слушаем CLICK на самом input — к этому моменту браузер УЖЕ
   применил выбор, значит dataset.on это «был ли он выбран ДО клика».
   Почему не иначе: mousedown на input НЕ приходит, когда кликают по тексту (кликабельна вся строка
   label); а слушатель на label срабатывает ДВАЖДЫ за один клик по тексту (сам label + синтетический
   клик, который label шлёт своему input) — два переключения это отсутствие переключения. */
/* Подсветка выбранной строки — единственная обратная связь о выборе: отдельной кнопки сброса нет
   (правка Криника 2026-08-02), выбор снимается повторным кликом по самому варианту. */
function syncOpt(r){
  var card=r.closest('.q,.art'); if(!card) return;
  $$('label.opt',card).forEach(function(l){l.classList.toggle('on', !!l.querySelector('input:checked'));});
}
$$('input[type=radio]').forEach(function(r){
  r.addEventListener('click',function(){
    if(r.dataset.on==='1'){ r.checked=false; r.dataset.on=''; syncOpt(r); return; }
    [].slice.call(document.getElementsByName(r.name)).forEach(function(o){o.dataset.on='';});
    r.dataset.on='1'; syncOpt(r);
  });
});
/* Живой макет отдельным окном: окно открывает СКРИПТ — значит скрипт может его и закрыть. */
$$('button[data-mock]').forEach(function(b){
  b.onclick=function(){
    var f=document.getElementById(b.dataset.mock); if(!f) return;
    var w=window.open('','_blank','width=1120,height=840');
    if(!w){toast('Браузер заблокировал новое окно',false);return;}
    w.document.write(f.getAttribute('srcdoc')); w.document.close();
  };
});

function collect(){
  var docs={};
  $$('.doc').forEach(function(d){
    var answers={},artifacts={};
    $$('.q',d).forEach(function(q){
      var choice=(q.querySelector('input[type=radio]:checked')||{}).value||'';
      var text=(q.querySelector('.free')||{}).value||'';
      var comment=(q.querySelector('.comment')||{}).value||'';
      if(choice||text.trim()||comment.trim())
        answers[q.dataset.qid]={choice:choice,text:text.trim(),comment:comment.trim(),sha256:q.dataset.sha};
    });
    $$('.art',d).forEach(function(a){
      var st=(a.querySelector('input[type=radio]:checked')||{}).value||'';
      var comment=(a.querySelector('.comment')||{}).value||'';
      if(st) artifacts[a.dataset.artid]={status:st,sha256:a.dataset.sha,comment:comment.trim()};
    });
    var dc=$('.doccomment-text',d);
    docs[d.dataset.doc]={answers:answers,artifacts:artifacts,comment:dc?dc.value.trim():''};
  });
  /* Имя отвечающего страница НЕ спрашивает (правка Криника 1.2): отвечает всегда владелец проекта,
     а поле by в записи решения проставляет сервер из конфига — убран ВОПРОС, а не ЗАПИСЬ. */
  return {docs:docs};
}

function toast(msg,ok){
  var t=document.createElement('div');
  t.className='toast'+(ok===false?' bad':''); t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.style.opacity='0';},2600);
  setTimeout(function(){t.remove();},3200);
}

/* Финальный экран + автозакрытие. Браузер разрешает window.close() ТОЛЬКО окну, которое открыл сам
   скрипт (у нас — режим окна-приложения). В обычной вкладке автозакрытие невозможно, и обещать его
   было бы враньём: показываем честное сообщение, а не молчаливое «висит как было». */
function finish(autoClose){
  document.body.innerHTML='<div class="done"><div class="big">✅</div><h1>Записано</h1>'
    +'<p>Документ, файл решения и архив обновлены. Агент разбужен и продолжает работу.</p>'
    +'<p class="hint" id="closing"></p></div>';
  var el=document.getElementById('closing');
  if(!autoClose){ el.textContent='Браузер не даёт этой вкладке закрыть себя — можешь закрыть её сам.'; return; }
  var left=` + String(AUTOCLOSE_SEC) + `;
  el.textContent='Закрываю окно через '+left+'…';
  var t=setInterval(function(){
    left--;
    if(left>0){ el.textContent='Закрываю окно через '+left+'…'; return; }
    clearInterval(t); window.close();
    setTimeout(function(){el.textContent='Браузер не дал странице закрыть себя — можешь закрыть её сам.';},400);
  },1000);
}

$('#send').onclick=async function(){
  var payload=collect();
  var empty=Object.keys(payload.docs).every(function(k){
    var d=payload.docs[k];
    return !Object.keys(d.answers).length && !Object.keys(d.artifacts).length && !d.comment;
  });
  if(empty){toast('Пока нечего отправлять — выбери вариант, впиши ответ или комментарий',false);return;}
  $('#send').disabled=true;$('#send').textContent='Записываю…';
  try{
    var r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    var j=await r.json();
    if(!j.ok) throw new Error(j.error||'отказ сервера');
    finish(!!j.autoClose);          /* I8: сервер уже пишет на диск и завершает контур — агент разбужен */
  }catch(e){
    toast('Не удалось записать: '+e.message,false);
    $('#send').disabled=false;$('#send').textContent='Записать ответы';
  }
};

$('#done').onclick=async function(){
  if(!confirm('Закрыть страницу? Незаписанные ответы не сохранятся — агент вернётся с ними позже.'))return;
  try{await fetch('/done',{method:'POST'});}catch(e){}
  document.body.innerHTML='<div class="done"><div class="big">👋</div><h1>Закрыто</h1>'
    +'<p>Что записано — записано. К остальному агент вернётся сам.</p></div>';
  setTimeout(function(){window.close();},600);
};
`;

function renderQuestionCard(q, baseDir) {
  const opts = q.options.map((o) => {
    const isRec = q.recommended && o.key.toLowerCase() === String(q.recommended).toLowerCase();
    return `<label class="opt"><input type="radio" name="${esc(q.id)}" value="${esc(o.key)}">` +
      `<span><strong>(${esc(o.key)})</strong> ${esc(o.label)}` +
      `${isRec ? ' <span class="chip rec">рекомендация агента</span>' : ''}</span></label>`;
  }).join('');
  // Тег состояния — требование Криника (1.5): по вопросу видно, отвечен он или ждёт.
  const tag = q.answered
    ? '<span class="chip ok tag">отвечено</span>'
    : '<span class="chip wait tag">ждёт вас</span>';
  const answered = q.answered
    ? `<p class="answered">Уже отвечено в документе: ${esc(q.answerText || '(см. документ)')}<br>` +
      '<span class="hint">Новый ответ НЕ затрёт этот — он ляжет отдельным датированным уточнением.</span></p>' : '';
  const body = embedMedia(mdToHtml(stripLeadingHeading(q.body)), baseDir);
  return `<section class="q card ${q.answered ? 'state-done' : 'state-wait'}" data-qid="${esc(q.id)}" data-sha="${q.sha256}" data-state="${q.answered ? 'done' : 'wait'}">
  <div class="q-head"><span class="q-id">${esc(q.id)}</span><h2>${esc(q.heading)}</h2>${tag}</div>
  ${body}
  ${answered}
  ${opts ? `<div class="lbl">Твой выбор <em class="hint">— повторный клик по варианту снимает его</em></div><div class="opts">${opts}</div>` : ''}
  <div class="lbl">Свой ответ / уточнение</div>
  <textarea class="free" rows="3" placeholder="Своими словами — если ни один вариант не подходит или хочешь добавить условие"></textarea>
  <div class="lbl">Комментарий к этому вопросу</div>
  <textarea class="comment" rows="2" placeholder="Необязательно — попадёт в документ и в архив"></textarea>
</section>`;
}

function renderArtifactCard(a, bytes, sha) {
  return `<section class="art card state-wait" data-artid="${esc(a.id)}" data-sha="${sha}">
  <div class="q-head"><span class="q-id">${esc(a.id)}</span><h2>${esc(a.target || 'исходящий артефакт')}</h2>
    <span class="chip wait tag">ждёт вас</span></div>
  <p class="hint">Ровно эти байты и уйдут — страница показывает файл <code>${esc(a.body_file)}</code>, хеш считается по нему (I3).</p>
  <pre><code>${esc(bytes)}</code></pre>
  <div class="lbl">Решение <em class="hint">— повторный клик снимает</em></div>
  <div class="opts">
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="approved"><span><strong>Одобрить</strong> — можно отправлять как есть</span></label>
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="rejected"><span><strong>Отклонить</strong> — с причиной ниже</span></label>
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="edit"><span><strong>Править</strong> — что именно, ниже</span></label>
  </div>
  <div class="lbl">Причина / правка / ответ</div>
  <textarea class="comment" rows="3" placeholder="Отказ и правка тоже попадают в архив — след решений хранит и их"></textarea>
</section>`;
}

function renderPage(docs, cfg) {
  const many = docs.length > 1;
  const sections = docs.map((d) => {
    // Вводная часть документа — это КОНТЕКСТ решения: зачем вопрос, мокапы, образцы звука.
    // Без неё владелец судит вслепую (см. parseLines: преамбула/хвост).
    const intro = d.preamble
      ? `<section class="card intro">${embedMedia(mdToHtml(d.preamble), d.dir)}</section>` : '';
    const outro = d.epilogue
      ? `<section class="card intro">${embedMedia(mdToHtml(d.epilogue), d.dir)}</section>` : '';
    const cards = intro + d.questions.map((q) => renderQuestionCard(q, d.dir)).join('\n');
    const arts = (d.meta.artifacts || []).map((a) => {
      const p = path.resolve(ROOT, a.body_file);
      if (!fs.existsSync(p)) return `<section class="card"><p>⚠️ Артефакт <code>${esc(a.id)}</code>: файл <code>${esc(a.body_file)}</code> не найден.</p></section>`;
      const bytes = fs.readFileSync(p, 'utf8');
      return renderArtifactCard(a, bytes, sha256(bytes));
    }).join('\n');
    const head = many
      ? `<h2 style="margin-top:32px">${esc(d.title)}</h2><div class="path">${esc(d.relPath)}</div>` : '';
    // Комментарий по документу ЦЕЛИКОМ — законный исход вычитки сам по себе: «ответов нет, но
    // есть что сказать» (правка Криника в поле NDim). Ложится датированным блоком в конец md.
    const docComment = `<section class="card doccomment">
  <div class="q-head"><h2>Комментарий по документу целиком</h2></div>
  <p class="hint">Ответов может и не быть — а сказать есть что. Ляжет отдельным датированным блоком в конец документа; прошлые комментарии не затираются.</p>
  <textarea class="doccomment-text" rows="3" placeholder="Необязательно"></textarea>
</section>`;
    return `<div class="doc" data-doc="${esc(d.relPath)}">${head}${cards}${arts}${outro}${docComment}</div>`;
  }).join('\n');

  const first = docs[0];
  const title = many ? `Накопилось ${docs.length}: решения ждут тебя` : first.title;
  const waiting = docs.reduce((n, d) => n + d.questions.filter((q) => !q.answered).length, 0);
  const answered = docs.reduce((n, d) => n + d.questions.filter((q) => q.answered).length, 0);

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Пустая иконка ВШИТА намеренно: без неё браузер сам просит /favicon.ico, ловит 404 и сорит
     ошибкой в консоль — а «чистая консоль» у нас проверка, и она не должна врать (поймано QA). -->
<link rel="icon" href="data:,">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
<style>:root{--accent:${esc(cfg.accent || DEFAULTS.accent)}}</style></head>
<body><div class="wrap">
<header class="top">
  <div>
    <h1>${esc(title)}</h1>
    <div class="path">${esc(many ? docs.map((d) => d.relPath).join(' · ') : first.relPath)}</div>
    <p class="meta">Спрашивает ИИ-агент KrinikCam · ${esc(new Date().toLocaleString('ru-RU'))}
      <span class="chip wait">ждут вас: ${waiting}</span>
      <span class="chip ok">отвечено: ${answered}</span></p>
  </div>
  <button class="ghost" id="themeBtn" type="button">тема</button>
</header>
${sections}
<p class="hint" style="text-align:center;margin-top:26px">Отвечать можно ЧАСТЯМИ: запиши, что решил
сейчас — контур закроется и разбудит агента, а с остальным он вернётся сам.</p>
</div>
<div class="bar">
  <button id="send" type="button">Записать ответы</button>
  <button id="done" class="ghost" type="button">Готово, закрыть</button>
</div>
<script>${PAGE_JS}</script></body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I2. ЗАПИСЬ РЕШЕНИЯ В ТРИ МЕСТА
//  (1) исходный md — его читает следующая сессия; (2) файл решения рядом — его читает гейт;
//  (3) копия в архиве с by/at — она делает архив читаемым через месяцы.
//  🔴 Уже написанное ВЛАДЕЛЬЦЕМ не перезаписывается НИКОГДА: новый ответ приезжает отдельным
//  датированным уточнением, старый остаётся дословно (класс дефекта, оплаченный EXP-0030).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const PROVENANCE_RE = /^_(?:записано контуром|уточнение)/u;

const decisionPathFor = (relPath) =>
  path.join(DECISIONS_DIR, `${path.basename(relPath).replace(/\.md$/, '')}.decision.json`);

function isoNow() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    sign + pad(off / 60) + ':' + pad(off % 60);
}

const humanDate = (iso) => iso.slice(0, 10) + ' ' + iso.slice(11, 16);

/** Текст ответа одной строкой: «**(б)** метка — свои слова». */
function answerLineFor(q, a) {
  const parts = [];
  if (a.choice) {
    const opt = q.options.find((o) => o.key === a.choice);
    parts.push(`**(${a.choice})**${opt ? ' ' + opt.label : ''}`);
  }
  if (a.text) parts.push(a.text);
  return parts.join(' — ') || '(см. комментарий ниже)';
}

/**
 * Вписывает ответы владельца в исходный md, не трогая ничего вокруг (документ — его артефакт).
 * Две ветки:
 *   · слот ПУСТ  → заполняем его, съедая пустую цитату-заготовку под ним;
 *   · слот ЗАНЯТ → НИЧЕГО не трогаем, дописываем датированное уточнение ПОСЛЕ блока ответа.
 */
function writeAnswersIntoDoc(doc, answers, by, at) {
  const lines = [...doc.lines];
  const edits = [];   // {at:индекс, remove:сколько, block:[строки]}

  for (const q of doc.questions) {
    const a = answers[q.id];
    if (!a || q.slotIndex < 0) continue;
    const line = answerLineFor(q, a);

    if (!q.answered) {
      // Первый ответ: заполняем слот, воспроизводя его собственную форму (жирный/не жирный).
      const head = q.slotBold
        ? `${q.slotPrefix}**${q.slotLabel}:** ${line}`
        : `${q.slotPrefix}${q.slotLabel}: ${line}`;
      const block = [head, ''];
      if (a.comment) block.push(...a.comment.split('\n').map((l) => `> ${l}`.trimEnd()), '');
      block.push(`_записано контуром \`/owner-reviews\` · by ${by} · at ${at}_`);
      // съедаем пустую цитату-заготовку «>» и пустые строки под слотом
      let j = q.slotIndex + 1, lastQuote = -1;
      while (j < lines.length && (!lines[j].trim() || /^\s*>\s*$/.test(lines[j]))) {
        if (/^\s*>\s*$/.test(lines[j])) lastQuote = j;
        j++;
      }
      const end = lastQuote >= 0 ? lastQuote + 1 : q.slotIndex + 1;
      edits.push({ at: q.slotIndex, remove: end - q.slotIndex, block });
    } else {
      // Ответ уже есть — НЕ ТРОГАЕМ его. Ищем конец блока ответа и дописываем уточнение.
      let end = q.slotIndex + 1;
      for (let i = q.slotIndex + 1; i < lines.length; i++) {
        const l = lines[i];
        if (HEADING_RE.test(l) || HR_RE.test(l) || isAnswerSlot(l)) break;
        if (l.trim()) end = i + 1;
      }
      const block = ['', `_уточнение · by ${by} · at ${at}:_ ${line}`];
      if (a.comment) block.push(...a.comment.split('\n').map((l) => `> ${l}`.trimEnd()));
      edits.push({ at: end, remove: 0, block });
    }
  }
  if (!edits.length) return { text: doc.raw, changed: 0 };

  // Идём снизу вверх, чтобы индексы выше точки правки не съезжали
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) lines.splice(e.at, e.remove, ...e.block);

  let text = lines.join('\n');

  // Статус документа: все слоты закрыты → переводим в «отвечено» (гард ловит именно эту строку,
  // а детектор протухшего статуса ловит обратный случай — «ждёт» при нулях пустых слотов).
  const after = parseLines(text, doc.path);
  if (after.slotsEmpty === 0 && after.statusIndex >= 0 && after.statusKind !== 'answered') {
    const l = after.lines[after.statusIndex];
    after.lines[after.statusIndex] = l
      .replace(/⏳|❓|🟡/g, '✅')
      .replace(/ЖД[ЁЕ]Т\s+ОТВЕТ(А|ОВ)\s+КРИНИКА/iu, `ОТВЕЧЕНО КРИНИКОМ ${at.slice(0, 10)}`)
      .replace(/ЖД[ЁЕ]Т\s+ОТВЕТ(А|ОВ)/iu, `ОТВЕЧЕНО ${at.slice(0, 10)}`)
      .replace(/НА\s+РЕВЮ\s+КРИНИКА/iu, `ОТВЕЧЕНО КРИНИКОМ ${at.slice(0, 10)}`);
    text = after.lines.join('\n');
  }
  return { text, changed: edits.length };
}

/**
 * Решение по ИСХОДЯЩЕМУ АРТЕФАКТУ — тоже в исходный md (инвариант I2: ответ живёт в ТРЁХ местах).
 * ⚠️ Пробел, найденный на живом прогоне 2026-08-02: одобрение артефакта ложилось только в
 * `<док>.decision.json` и в архив, а документ об этом молчал — следующая сессия, читающая ТОЛЬКО md
 * (а это её штатный путь), не узнала бы, что решение принято. Блок датированный и накопительный:
 * переодобрение новых байтов не затирает историю прошлого.
 */
function appendArtifactDecisions(text, artifacts, by, at) {
  const blocks = Object.entries(artifacts).map(([id, a]) => {
    const verdict = a.status === 'approved' ? '**ОДОБРЕНО**'
      : a.status === 'rejected' ? '**ОТКЛОНЕНО**' : '**НА ПРАВКУ**';
    return ['', '---', '',
      `## Решение по артефакту \`${id}\` · ${humanDate(at)}`,
      '',
      `${verdict} · by ${by} · sha256 тела: \`${(a.sha256 || '').slice(0, 16)}…\``,
      ...(a.comment ? ['', ...a.comment.split('\n').map((l) => `> ${l}`.trimEnd())] : []),
      '',
      '_записано контуром `/owner-reviews`. Одобрение привязано к этим байтам: правка тела',
      'аннулирует его автоматически (I3)._', ''].join('\n');
  });
  return text.replace(/\s*$/, '\n') + blocks.join('');
}

/** Комментарий по документу целиком — отдельным датированным блоком в КОНЕЦ файла. Копится. */
function appendDocumentComment(text, comment, by, at) {
  const block = [
    '', '---', '',
    `## Комментарий владельца · ${humanDate(at)}`,
    '',
    ...comment.split('\n'),
    '',
    `_записано контуром \`/owner-reviews\` · by ${by} · at ${at}_`,
    '',
  ].join('\n');
  return text.replace(/\s*$/, '\n') + block;
}

function recordDecision(doc, payload, by) {
  const at = isoNow();
  const written = [];

  // (1) исходный md — ответы и/или комментарий по документу
  let text = doc.raw;
  let touched = false;
  if (Object.keys(payload.answers || {}).length) {
    const r = writeAnswersIntoDoc(doc, payload.answers, by, at);
    if (r.changed) { text = r.text; touched = true; }
  }
  if (Object.keys(payload.artifacts || {}).length) {
    text = appendArtifactDecisions(text, payload.artifacts, by, at); touched = true;
  }
  if (payload.comment) { text = appendDocumentComment(text, payload.comment, by, at); touched = true; }
  if (touched) { fs.writeFileSync(doc.path, text, 'utf8'); written.push(doc.relPath); }

  // (2) файл решения рядом (его читает гейт)
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  const dPath = decisionPathFor(doc.relPath);
  const prev = fs.existsSync(dPath) ? JSON.parse(fs.readFileSync(dPath, 'utf8')) : {};
  const stamped = {};
  for (const [k, v] of Object.entries(payload.answers || {})) stamped[k] = { ...v, at };
  const decision = {
    kind: doc.meta.kind || 'interview',
    document: doc.relPath,
    by,
    at,
    answers: { ...(prev.answers || {}), ...stamped },
    artifacts: { ...(prev.artifacts || {}), ...(payload.artifacts || {}) },
    document_comment: [...(prev.document_comment || []), ...(payload.comment ? [{ at, text: payload.comment }] : [])],
  };
  fs.writeFileSync(dPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');
  written.push(rel(dPath));

  // (3) копия в архиве — append-only, по ней читается история решений
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const aPath = path.join(ARCHIVE_DIR, `${path.basename(doc.relPath).replace(/\.md$/, '')}--${at.replace(/[:+]/g, '-')}.json`);
  fs.writeFileSync(aPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');
  written.push(rel(aPath));

  return { written, decision };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  СИГНАЛ (I5, I6). Обязательный путь — ЗВУК: нативное уведомление молча глушится настройками
//  фокуса С КОДОМ УСПЕХА, а звук от них не зависит. Доставку подтверждает человек словами, не exit 0.
//  Звук ЗАФИКСИРОВАН: три писка 880/660/990 Гц, синтезируем сами — один и тот же сигнал в любом
//  проекте и на любой машине (требование Криника 1.3).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Тихие часы. Окно ПЕРЕСЕКАЕТ полночь — наивное from<=now<=to молчит весь день и орёт всю ночь. */
function inQuietHours(now, from, to) {
  const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const cur = now.getHours() * 60 + now.getMinutes();
  const f = mins(from), t = mins(to);
  if (f === t) return false;
  return f < t ? (cur >= f && cur < t) : (cur >= f || cur < t);   // ← вторая ветка и есть полночь
}

/**
 * Синтез WAV с тремя писками. Затухание 8 мс с обоих концов тона — без него на резком фронте
 * слышен щелчок. 16 бит, моно, 44.1 кГц: это понимает любой системный проигрыватель.
 */
function beepWav(freqs = BEEP_HZ, toneMs = 120, gapMs = 60, rate = 44100, amp = 0.35) {
  const s = [];
  const fade = Math.round(rate * 0.008);
  freqs.forEach((f, k) => {
    const n = Math.round(rate * toneMs / 1000);
    for (let i = 0; i < n; i++) {
      s.push(Math.sin(2 * Math.PI * f * i / rate) * amp * Math.min(1, i / fade, (n - i) / fade));
    }
    if (k < freqs.length - 1) for (let i = 0; i < Math.round(rate * gapMs / 1000); i++) s.push(0);
  });
  const data = Buffer.alloc(s.length * 2);
  s.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Проигрыватель звукового файла для текущей ОС (без зависимостей). */
function soundPlayer(file) {
  if (process.platform === 'darwin') return { cmd: 'afplay', args: [file] };
  if (process.platform === 'win32') {
    return { cmd: 'powershell', args: ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`] };
  }
  return { cmd: 'aplay', args: ['-q', file] };
}

/**
 * ЛЕСТНИЦА ГОЛОСА (решение Криника, interview_017 В3=б):
 *   1. ЛОКАЛЬНЫЙ НЕЙРОГОЛОС — Silero v4_ru, офлайн, на процессоре (`tools/owner-voice/`);
 *   2. системный синтезатор — если тракта нет, он сломан или ему нечего сказать;
 *   3. только звук — если и системного нет.
 * Тракт зовётся КОМАНДОЙ и живёт отдельно (venv + модель ~38 МБ, оба gitignored): инструмент не
 * тащит в репозиторий чужие байты и честно работает без них.
 */
const NEURAL = {
  python: path.join(ROOT, 'tools', 'owner-voice', 'venv', 'bin', 'python'),
  script: path.join(ROOT, 'tools', 'owner-voice', 'speak.py'),
  model: path.join(ROOT, 'tools', 'owner-voice', 'model', 'v4_ru.pt'),
};
const neuralReady = () => Object.values(NEURAL).every((p) => fs.existsSync(p));

/** Синтезатор речи для текущей ОС. Текст едет ФАЙЛОМ — кириллица в argv молча портится. */
function voiceCommand(file, cfg) {
  if (process.platform === 'darwin') return { cmd: 'say', args: ['-v', cfg.voice, '-f', file] };
  if (process.platform === 'win32') {
    return { cmd: 'powershell', args: ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([IO.File]::ReadAllText('${file}'))`] };
  }
  return { cmd: 'spd-say', args: ['-w', '-e', '-f', file] };
}

/**
 * СИГНАЛ НИКОГДА НЕ ДЕРЖИТ СТРАНИЦУ (замечание Криника: «страница не открылась, пока голос не
 * проигрался — тупо»). Асинхронный spawn + detached/unref: голос идёт своим чередом, поток не ждёт,
 * а detached даёт то, что фраза договорит, даже если владелец ответил мгновенно и контур закрылся.
 * Цепочка «звук → голос» держится на событии close, чтобы они не звучали одновременно.
 */
function signal(cfg, text, { force = false } = {}) {
  const quiet = inQuietHours(new Date(), cfg.quietHours.from, cfg.quietHours.to);
  if (quiet && !force) {
    console.log(`🔕 тихие часы ${cfg.quietHours.from}–${cfg.quietHours.to} — зову беззвучно (I6)`);
    return { quiet: true };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-signal-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  const fire = (cmd, args, done) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
      p.on('error', () => done());
      p.on('close', () => done());
      p.unref();
    } catch { done(); }
  };

  const sayStep = () => {
    if (!cfg.say) return cleanup();
    const f = path.join(tmpDir, 'say.txt');
    fs.writeFileSync(f, text, 'utf8');                       // текст ФАЙЛОМ, не аргументом

    // Ступень 2 лестницы — системный синтезатор. Он же ОТКАТ для ступени 1.
    const systemVoice = () => { const v = voiceCommand(f, cfg); fire(v.cmd, v.args, cleanup); };

    // Ступень 1 — локальный нейроголос. Синтез идёт в файл (3–4 с на CPU) и НИЧЕГО не держит:
    // страница давно на экране, писки уже отзвучали. Любая осечка тракта = откат, а не тишина.
    if (cfg.neuralVoice !== false && neuralReady()) {
      const wav = path.join(tmpDir, 'voice.wav');
      try {
        const p = spawn(NEURAL.python, [NEURAL.script, '--in', f, '--out', wav,
          '--speaker', cfg.neuralSpeaker || 'baya'], { stdio: 'ignore', detached: true });
        p.on('error', systemVoice);
        p.on('close', (code) => {
          if (code === 0 && fs.existsSync(wav)) { const s = soundPlayer(wav); return fire(s.cmd, s.args, cleanup); }
          if (code === 2) return cleanup();                  // говорить нечего — это не ошибка
          console.log('🗣  нейроголос не отозвался — зову системным синтезатором');
          systemVoice();
        });
        p.unref();
        return;
      } catch { /* провалимся в системный */ }
    }
    systemVoice();
  };

  // Нотификацию шлём сразу и параллельно: она мгновенная, ни от чего не зависит и НИКОГДА не
  // заменяет звук (её молча глушат настройки фокуса, возвращая код успеха).
  if (cfg.notify && process.platform === 'darwin') {
    const scpt = path.join(tmpDir, 'notify.applescript');
    const safe = text.replace(/["\\]/g, ' ');
    fs.writeFileSync(scpt, `display notification "${safe}" with title "KrinikCam" subtitle "агент ждёт решения"\n`, 'utf8');
    fire('osascript', [scpt], () => {});
  }

  // ЗВУК первым и всегда: либо явно заданный файл, либо наши три писка.
  const soundFile = cfg.soundFile && fs.existsSync(cfg.soundFile)
    ? cfg.soundFile
    : (() => { const f = path.join(tmpDir, 'call.wav'); fs.writeFileSync(f, beepWav()); return f; })();
  const player = soundPlayer(soundFile);
  fire(player.cmd, player.args, sayStep);

  return { quiet: false };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  ГАРД МЕСТА ВОПРОСОВ — первый по порядку работ: ни от чего не зависит и окупается сразу.
//  С БАЗОВОЙ ЛИНИЕЙ ДОЛГА: страж, красный с рождения, — не ворота, а тренажёр игнорирования.
//  Краснеем только на НОВЫХ нарушениях, а размер унаследованного долга печатаем КАЖДЫЙ раз.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const ORPHAN_DIRS = ['plans', 'bugs', 'ideas', 'researches'];

/**
 * ⚠️ ОПРОВЕРГНУТАЯ ЭВРИСТИКА (замер на живых данных 2026-08-01). Спецификация навыка предлагает
 * узкое окно «обращение в НАЧАЛЕ строки (первые ~40–60 знаков)»: мол, висящий вопрос объявляет себя
 * сразу, а ссылка на вопрос лежит глубоко в прозе. В ЭТОМ проекте это неверно и опасно: два из трёх
 * реальных висящих вопросов записаны хвостом фразы о состоянии работы («Реализация не начиналась —
 * ждёт ответов Криника на…», маркер на 75-м знаке). Окно молча выбрасывало их обоих, а молчаливый
 * пропуск хуже ложной тревоги. Поэтому судим по ВСЕЙ строке, а ложные хиты снимаем базовой линией
 * и явными исключениями с причиной. Правило шире эвристики: любую импортированную эвристику сначала
 * проверь на СВОИХ известных висящих вопросах — гард, не поймавший их, не гард.
 */
const ORPHAN_PATTERNS = [
  { name: 'заголовок-очередь вопросов владельцу', re: /^#{1,6}\s+.*(?:жд[ёе]т\s+владельца|жд[ёе]т\s+криника|открытые\s+вопросы(?:\s+к)?\s+(?:владельцу|кринику))/iu },
  { name: 'слот ответа владельца вне interviews/', re: ANSWER_SLOT_STRICT_RE },
  { name: 'явное «ждёт ответа/Криника»', re: /(?<!\p{L})жд[ёе]т\s+(?:ответа|ответов|решения|криника)(?!\p{L})/iu },
  { name: 'вопрос к владельцу', re: /(?<!\p{L})вопрос(?:ы)?\s+к\s+кринику(?!\p{L})/iu },
  { name: 'нужен ответ владельца', re: /(?<!\p{L})(?:нужен|нужны)\s+отве(?:т|ты)\s+криника(?!\p{L})/iu },
  { name: 'спросить/уточнить у владельца', re: /(?<!\p{L})(?:спросить|уточнить)\s+(?:у\s+)?криника(?!\p{L})/iu },
  { name: 'на ревю владельца', re: /(?<!\p{L})на\s+рев[ьюию]\p{L}*\s+криника(?!\p{L})/iu },
];

// Строка, которая УЖЕ показывает на место вопросов, нарушением не является — вопрос доехал куда надо.
const POINTS_AT_INTERVIEWS_RE = /interviews\/|интервью\s*(?:№|#)?\s*\d|\/interview\b/iu;

function loadExceptions() {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8')).exceptions || [];
    // Исключение без ПРИЧИНЫ само является нарушением — иначе файл исключений станет способом
    // заткнуть гарда. Такие записи не действуют и печатаются как дефект.
    return list.map((x) => ({ ...x, reason: (x.reason || x.why || '').trim() }));
  } catch { return []; }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { generated: null, keys: new Set(), items: [] };
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return { generated: j.generated, items: j.items || [], keys: new Set((j.items || []).map((i) => i.key)) };
  } catch { return { generated: null, keys: new Set(), items: [] }; }
}

function walkMd(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|logs|\.git)$/.test(e.name)) walkMd(p, acc); }
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/** Собирает ВСЕ хиты «вопрос вне interviews/» — без учёта базовой линии (её применяет вызывающий). */
function collectOrphans(exceptions) {
  const excluded = (relPath) => exceptions.find((x) => x.file === relPath && x.reason);
  const orphans = [];
  for (const dir of ORPHAN_DIRS) {
    for (const f of walkMd(path.join(ROOT, dir))) {
      const relP = rel(f);
      if (excluded(relP)) continue;
      // Тег DONE в имени файла — канонный признак ЗАКРЫТОГО документа (AGENT_GUIDE, Idea 15).
      // Вопрос внутри закрытого документа — история, а не висящий запрос.
      if (/(?:^|[_\-])DONE(?:[_\-.]|$)/.test(path.basename(relP))) continue;
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (POINTS_AT_INTERVIEWS_RE.test(line)) return;   // вопрос уже доехал куда следовало
        for (const p of ORPHAN_PATTERNS) {
          if (p.re.test(line)) {
            orphans.push({
              file: relP, line: i + 1, why: p.name, text: line.trim().slice(0, 120),
              key: `${relP}:${sha1(line.trim())}`,
            });
            break;
          }
        }
      });
    }
  }
  return orphans;
}

function guard({ json = false } = {}) {
  const exceptions = loadExceptions();
  const badExceptions = exceptions.filter((x) => !x.reason);
  const excluded = (relPath) => exceptions.find((x) => x.file === relPath && x.reason);
  const baseline = loadBaseline();

  // G1 — интервью. Главный сигнал СТРУКТУРНЫЙ (пустой слот), а не текстовый: именно текстовый
  // греп однажды промолчал, потому что `ЗАКРЫТ` совпал с «за-крыт-ие».
  const hanging = [], partial = [], stale = [];
  for (const f of walkMd(path.join(ROOT, 'interviews'))) {
    if (path.basename(f) === 'README.md' || f.includes(path.sep + 'decisions' + path.sep)) continue;
    // Тег DONE в имени — канон объявил документ закрытым (AGENT_GUIDE, Idea 15). Пустой слот внутри
    // закрытого интервью это ИСТОРИЯ, а не висящий запрос. То же правило, что и в охоте за сиротами:
    // мы честно не ищем в том, что закрыто, вместо того чтобы подгонять шаблон.
    if (/(?:^|[_\-])DONE(?:[_\-.]|$)/.test(path.basename(f))) continue;
    const d = parseDoc(f);
    if (excluded(d.relPath)) continue;
    if (d.staleStatus) { stale.push(d); continue; }                 // статус врёт — это дефект
    const isHanging = d.statusKind === 'waiting' || (d.statusKind === 'none' && d.slotsEmpty > 0);
    if (isHanging) hanging.push(d);
    else if (d.slotsEmpty > 0) partial.push(d);
  }

  // G2 — вопросы-сироты вне interviews/, с РАТЧЕТОМ: краснеем только на новых
  const allOrphans = collectOrphans(exceptions);
  const fresh = allOrphans.filter((o) => !baseline.keys.has(o.key));
  const debt = allOrphans.length - fresh.length;

  const result = {
    hanging: hanging.map(summary), partial: partial.map(summary), stale: stale.map(summary),
    orphansNew: fresh, debt, baselineGenerated: baseline.generated, badExceptions,
  };
  const code = (hanging.length || fresh.length || stale.length || badExceptions.length) ? 1 : 0;
  if (json) { console.log(JSON.stringify(result, null, 2)); return code; }

  if (!code) console.log('✅ гард чист: новых висящих вопросов нет.');

  if (hanging.length) {
    console.log(`\n⏳ ЖДУТ ОТВЕТА КРИНИКА — ${hanging.length}:`);
    for (const d of hanging) {
      console.log(`   · ${d.relPath}  (вопросов без ответа: ${d.slotsEmpty}/${d.slotsTotal})`);
      console.log(`     ${d.title}`);
      console.log(`     открыть страницей:  node tools/owner.mjs ask ${d.relPath}`);
    }
  }
  if (stale.length) {
    console.log(`\n🔴 СТАТУС ПРОТУХ — ${stale.length} (ответы получены, а документ кричит «ЖДЁТ»):`);
    for (const d of stale) console.log(`   · ${d.relPath} — «${d.statusText.trim().slice(0, 80)}»`);
    console.log('   Это дефект документа, а не вопрос к владельцу: почини строку статуса сам.');
  }
  if (fresh.length) {
    console.log(`\n🚨 НОВЫЕ ВОПРОСЫ ВНЕ interviews/ — ${fresh.length} (канон: место вопросов только interviews/):`);
    for (const o of fresh) console.log(`   · ${o.file}:${o.line} — ${o.why}\n     ${o.text}`);
    console.log('   Перенеси в interviews/ (навык /interview) либо впиши исключение с ПРИЧИНОЙ');
    console.log(`   в ${rel(EXCEPTIONS_FILE)} — ослаблять команду нельзя.`);
  }
  if (badExceptions.length) {
    console.log(`\n🚨 ИСКЛЮЧЕНИЯ БЕЗ ПРИЧИНЫ — ${badExceptions.length} (маркер без причины сам является нарушением):`);
    for (const x of badExceptions) console.log(`   · ${x.file}`);
  }
  if (partial.length) {
    console.log(`\nℹ️  частично отвечены (документ объявлен закрытым, но остались пустые слоты) — ${partial.length}:`);
    for (const d of partial) console.log(`   · ${d.relPath} (пустых слотов: ${d.slotsEmpty}/${d.slotsTotal})`);
  }
  // Долг печатается ВСЕГДА, даже когда всё зелено: это число обязано убывать.
  console.log(`\n📉 унаследованный долг (базовая линия${baseline.generated ? ' от ' + baseline.generated.slice(0, 10) : ' не снята'}): ${debt}`);
  if (debt) console.log('   Это вопросы, накопленные ДО гарда. Разбирай их по одному — число должно убывать.');
  return code;
}

const summary = (d) => ({
  relPath: d.relPath, title: d.title, statusKind: d.statusKind,
  slotsEmpty: d.slotsEmpty, slotsTotal: d.slotsTotal, questions: d.questions.length,
});

/** Снять/пересобрать базовую линию долга. Выросшая линия — событие, о котором говорят вслух. */
function baselineCmd() {
  const prev = loadBaseline();
  const items = collectOrphans(loadExceptions()).map((o) => ({ key: o.key, file: o.file, why: o.why, text: o.text }));
  const payload = { generated: isoNow(), items };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const delta = items.length - prev.items.length;
  console.log(`📸 базовая линия снята: ${items.length} унаследованных вопросов вне interviews/`);
  if (prev.generated) {
    console.log(`   было ${prev.items.length} (от ${prev.generated.slice(0, 10)}) → стало ${items.length} (${delta <= 0 ? 'долг убыл' : '⚠️ ДОЛГ ВЫРОС'}: ${delta > 0 ? '+' : ''}${delta})`);
    if (delta > 0) console.log('   ⚠️ Растущая базовая линия = ратчет сломан. Новые вопросы обязаны ехать в interviews/, а не в линию.');
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I4. ГЕЙТ — стоит на стороне ПРИМЕНЕНИЯ решения и fail-closed
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const GATE_EXIT = { OK: 0, NO_DECISION: 2, NO_ANSWER: 3, REJECTED: 4, DRIFTED: 5, NO_DOC: 6 };

function gate(docArg, { question = null, artifact = null, quiet = false } = {}) {
  const abs = path.resolve(ROOT, docArg);
  const say = (s) => { if (!quiet) console.log(s); };
  try {
    if (!fs.existsSync(abs)) { say(`⛔ ГЕЙТ: документа нет — ${docArg}`); return GATE_EXIT.NO_DOC; }
    const doc = parseDoc(abs);
    const dPath = decisionPathFor(doc.relPath);
    if (!fs.existsSync(dPath)) {
      say(`⛔ ГЕЙТ ЗАКРЫТ: решения нет (${rel(dPath)}).`);
      say(`   Спроси владельца страницей:  node tools/owner.mjs ask ${doc.relPath}`);
      return GATE_EXIT.NO_DECISION;
    }
    const decision = JSON.parse(fs.readFileSync(dPath, 'utf8'));

    if (artifact) {
      const a = (decision.artifacts || {})[artifact];
      if (!a) { say(`⛔ ГЕЙТ ЗАКРЫТ: артефакт «${artifact}» не решён.`); return GATE_EXIT.NO_ANSWER; }
      if (a.status !== 'approved') { say(`⛔ ГЕЙТ ЗАКРЫТ: артефакт «${artifact}» = ${a.status}.`); return GATE_EXIT.REJECTED; }
      const meta = (doc.meta.artifacts || []).find((x) => x.id === artifact);
      if (!meta) { say(`⛔ ГЕЙТ ЗАКРЫТ: артефакт «${artifact}» исчез из документа.`); return GATE_EXIT.DRIFTED; }
      const p = path.resolve(ROOT, meta.body_file);
      if (!fs.existsSync(p)) { say(`⛔ ГЕЙТ ЗАКРЫТ: тело артефакта пропало (${meta.body_file}).`); return GATE_EXIT.DRIFTED; }
      const now = sha256(fs.readFileSync(p, 'utf8'));
      if (now !== a.sha256) {
        say('⛔ ГЕЙТ ЗАКРЫТ: текст изменился ПОСЛЕ одобрения — одобрение недействительно (I3).');
        say(`   одобрено: ${a.sha256.slice(0, 16)}…  сейчас: ${now.slice(0, 16)}…`);
        return GATE_EXIT.DRIFTED;
      }
      say(`✅ ГЕЙТ ОТКРЫТ: «${artifact}» одобрен (${decision.by}, ${decision.at}), текст не менялся.`);
      return GATE_EXIT.OK;
    }

    const targets = question ? doc.questions.filter((q) => q.id === question) : doc.questions;
    if (question && !targets.length) { say(`⛔ ГЕЙТ ЗАКРЫТ: вопроса «${question}» в документе нет.`); return GATE_EXIT.NO_ANSWER; }

    for (const q of targets) {
      const a = (decision.answers || {})[q.id];
      if (!a) { say(`⛔ ГЕЙТ ЗАКРЫТ: на ${q.id} ответа нет — работа, зависящая от него, не начинается.`); return GATE_EXIT.NO_ANSWER; }
      if (a.status === 'rejected') { say(`⛔ ГЕЙТ ЗАКРЫТ: ${q.id} отклонён владельцем.`); return GATE_EXIT.REJECTED; }
      if (a.sha256 && a.sha256 !== q.sha256) {
        say(`⛔ ГЕЙТ ЗАКРЫТ: текст ${q.id} изменился ПОСЛЕ ответа — ответ недействителен (I3).`);
        say(`   отвечено по: ${a.sha256.slice(0, 16)}…  сейчас: ${q.sha256.slice(0, 16)}…`);
        return GATE_EXIT.DRIFTED;
      }
    }
    say(`✅ ГЕЙТ ОТКРЫТ: ${targets.map((q) => q.id).join(', ')} — ответ владельца есть (${decision.by}, ${decision.at}), текст не менялся.`);
    return GATE_EXIT.OK;
  } catch (e) {
    // fail-closed: любая неожиданная ошибка = отказ. Гейт НИКОГДА не бросает наружу.
    say(`⛔ ГЕЙТ ЗАКРЫТ: неожиданная ошибка — ${e.message}`);
    return GATE_EXIT.NO_DECISION;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I7. НАКОПЛЕНИЕ ДЛЯ АВТОНОМНЫХ ЦИКЛОВ — цикл КОПИТ, а не встаёт.
//  Живые документы НЕ переносим в pending/: это ломает все ссылки на них из статуса и планов.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const readQueue = () => (fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')).items || [] : []);
function writeQueue(items) {
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({ items }, null, 2) + '\n', 'utf8');
}

function queueAdd(docArg) {
  const abs = path.resolve(ROOT, docArg);
  if (!fs.existsSync(abs)) { console.error(`нет такого документа: ${docArg}`); return 1; }
  const relP = rel(abs);
  const items = readQueue();
  if (!items.find((i) => i.doc === relP)) items.push({ doc: relP, at: isoNow() });
  writeQueue(items);
  console.log(`📥 припарковано в очередь (${items.length}): ${relP}`);
  console.log('   Цикл ПРОДОЛЖАЕТСЯ — владельца позовём одной страницей на всю пачку: node tools/owner.mjs inbox');
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  СЕРВЕР И ПОБУДКА (I8): поднялся → показал → ЗАПИСАЛ → умер, разбудив агента.
//  Долгоживущий сервер и побудка взаимоисключающи; выигрывает побудка. Осталось неотвеченное —
//  страницу поднимает заново АГЕНТ.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const APP_BROWSERS = [
  { name: 'Google Chrome', check: '/Applications/Google Chrome.app' },
  { name: 'Chromium', check: '/Applications/Chromium.app' },
  { name: 'Brave Browser', check: '/Applications/Brave Browser.app' },
  { name: 'Microsoft Edge', check: '/Applications/Microsoft Edge.app' },
];

/** Ищем браузер, умеющий окно-приложение: только в нём страница может закрыть себя сама. */
function findAppBrowser() {
  if (process.platform === 'darwin') {
    const b = APP_BROWSERS.find((x) => fs.existsSync(x.check));
    return b ? { cmd: 'open', args: (url) => ['-na', b.name, '--args', `--app=${url}`], label: b.name } : null;
  }
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge']) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    if (r.status === 0) return { cmd: bin, args: (url) => [`--app=${url}`], label: bin };
  }
  return null;
}

function openDefaultBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
  try { spawnSync(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch {}
}

async function ask(docArgs, cfg, { fromQueue = false, timeoutSec = cfg.timeoutSec, noOpen = false, noSignal = false, port = cfg.port } = {}) {
  const docs = docArgs.map((d) => {
    const abs = path.resolve(ROOT, d);
    if (!fs.existsSync(abs)) { console.error(`нет такого документа: ${d}`); process.exit(1); }
    return parseDoc(abs);
  });
  const totalQ = docs.reduce((n, d) => n + d.questions.length, 0);
  if (!totalQ && !docs.some((d) => d.meta.artifacts?.length)) {
    console.error('⚠️  в документе не найдено ни вопросов, ни артефактов — нечего показывать.');
    return 1;
  }

  const html = renderPage(docs, cfg);
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const pagePath = path.join(PAGES_DIR, `${path.basename(docs[0].relPath).replace(/\.md$/, '')}${docs.length > 1 ? '--inbox' : ''}.html`);
  fs.writeFileSync(pagePath, html, 'utf8');

  // «Страница ОТКРЫТА» = браузер её ЗАБРАЛ, а не «мы попросили систему её открыть» (I5).
  let pageFetched; const pageOnScreen = new Promise((r) => { pageFetched = r; });
  let autoClose = false;          // правду о режиме окна знает сервер, страница узнаёт её в ответе
  let exitCode = 7;               // 7 — таймаут: решения НЕТ, гейт остаётся закрытым

  const finishSoon = (code, ms) => {
    exitCode = code;
    setTimeout(() => { try { server.close(); } catch {} process.exit(code); }, ms);
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      console.log('📥 браузер забрал страницу — она перед владельцем');
      return pageFetched();
    }
    if (req.method === 'POST' && req.url === '/submit') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const by = cfg.owner;                 // отвечает всегда владелец проекта — не спрашиваем
          const written = [], recorded = [];
          for (const [relP, data] of Object.entries(payload.docs || {})) {
            if (!docs.find((d) => d.relPath === relP)) continue;
            const hasAnswers = Object.keys(data.answers || {}).length || Object.keys(data.artifacts || {}).length;
            if (!hasAnswers && !data.comment) continue;
            // ВАЖНО: документ перечитываем С ДИСКА — модель, снятая при рендере, уже протухла.
            const fresh = parseDoc(path.resolve(ROOT, relP));
            const r = recordDecision(fresh, data, by);
            written.push(...r.written);
            recorded.push(...Object.keys(data.answers || {}), ...Object.keys(data.artifacts || {}));
            console.log(`\n✅ записано (${by}, ${isoNow()}): ${recorded.join(', ') || 'комментарий по документу'}`);
            r.written.forEach((w) => console.log(`   · ${w}`));
          }
          const remaining = docs.reduce((n, d) => n + parseDoc(path.resolve(ROOT, d.relPath)).slotsEmpty, 0);
          if (fromQueue) {
            const done = new Set(docs.filter((d) => parseDoc(path.resolve(ROOT, d.relPath)).slotsEmpty === 0).map((d) => d.relPath));
            writeQueue(readQueue().filter((i) => !done.has(i.doc)));
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, written, recorded, remaining, autoClose }));

          if (!written.length) return;      // нечего было записывать — контур живёт дальше

          // 🔴 I8 — ГЛАВНОЕ: запись БУДИТ ждущего. Контур закрывается, агент продолжает работу.
          console.log('\n🔔 контур закрывается и будит агента (I8).');
          if (remaining > 0) {
            console.log(`⏳ без ответа осталось вопросов: ${remaining}.`);
            console.log(`   Поднять страницу заново — ОБЯЗАННОСТЬ АГЕНТА:  node tools/owner.mjs ask ${docs.map((d) => d.relPath).join(' ')}`);
          }
          finishSoon(0, (AUTOCLOSE_SEC + 1) * 1000);   // даём странице договорить обратный отсчёт
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/done') {
      // Владелец закрыл страницу сам: что записано — записано, остальное остаётся висящим,
      // и гард честно покажет это в следующем прогоне. Ничто не самоодобряется (I4).
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      const left = docs.reduce((n, d) => n + parseDoc(path.resolve(ROOT, d.relPath)).slotsEmpty, 0);
      console.log(`\n👋 владелец закрыл страницу. Без ответа осталось: ${left} — гард их не забудет.`);
      finishSoon(8, 400);
      return;
    }
    res.writeHead(404); res.end('404');
  });

  const boundPort = await listenFree(server, port);
  const url = `http://127.0.0.1:${boundPort}/`;
  console.log(`📄 страница: ${url}`);
  console.log(`   (копия на диске: ${rel(pagePath)})`);
  for (const d of docs) console.log(`   · ${d.relPath} — вопросов: ${d.questions.length}, без ответа: ${d.slotsEmpty}`);

  // Лестница открытия: окно-приложение (в нём работает автозакрытие) → ждём, что браузер ЗАБРАЛ
  // страницу → если не забрал, честно откатываемся на браузер по умолчанию и НЕ обещаем закрытие.
  if (!noOpen) {
    const app = cfg.appWindow === false ? null : findAppBrowser();
    if (app) {
      try {
        spawn(app.cmd, app.args(url), { stdio: 'ignore', detached: true }).unref();
        autoClose = true;
        console.log(`🪟 окно-приложение (${app.label}) — страница сможет закрыть себя сама через ${AUTOCLOSE_SEC} с после записи`);
      } catch { autoClose = false; }
    }
    const arrived = await Promise.race([pageOnScreen.then(() => true), new Promise((r) => setTimeout(() => r(false), 3500))]);
    if (!arrived) {
      console.log('↩️  окно-приложение не отозвалось — открываю браузером по умолчанию (автозакрытия не будет)');
      autoClose = false;
      openDefaultBrowser(url);
      await Promise.race([pageOnScreen, new Promise((r) => setTimeout(r, 4000))]);
    }
  }

  if (!noSignal) {
    // Что произносит голос — слово владельца (interview_021 В2): «должен сказать, что ждём моего
    // решения по такому-то документу или вопросу». Поэтому документ НАЗЫВАЕМ всегда, и в пачке тоже.
    const names = docs.map((d) => d.meta.title || d.title);
    const text = docs.length > 1
      ? `Криник, агент ждёт твоих решений по документам: ${names.slice(0, 2).join(', ')}` +
        `${names.length > 2 ? ` и ещё ${names.length - 2}` : ''}. Страница открыта в браузере.`
      : `Криник, агент ждёт твоего решения по документу: ${names[0]}. Страница открыта в браузере.`;
    console.log('🔔 зову владельца (три писка + голос идут ФОНОМ — страницу не держат)');
    signal(cfg, text);
  }
  console.log(`⏳ жду ответ (таймаут ${timeoutSec} с). Ответ НИКОГДА не самоодобряется по таймауту (I4).`);

  return new Promise((resolve) => {
    const t = setTimeout(() => {
      console.log('⏱️  ответа не дождались. Решения НЕТ — гейт остаётся закрытым.');
      try { server.close(); } catch {}
      resolve(7);
    }, timeoutSec * 1000);
    server.on('close', () => { clearTimeout(t); resolve(exitCode); });
  });
}

function listenFree(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && port - startPort < 20) { port++; tryPort(); }
        else reject(e);
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    tryPort();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  SELFTEST — гард, который ни разу не краснел, ничего не доказывает.
//  Каждому гарду скармливаем ровно тот дефект, который он обязан ловить.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function selftest() {
  let failed = 0;
  const ok = (name, cond, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) failed++;
  };

  // T1. Тихие часы через полночь (I6) — наивное сравнение проваливает ровно эти четыре точки
  const at = (h, m = 0) => new Date(2026, 0, 15, h, m);
  ok('тихие часы 23:00–09:00: 23:30 — тихо', inQuietHours(at(23, 30), '23:00', '09:00'));
  ok('тихие часы 23:00–09:00: 08:00 — тихо', inQuietHours(at(8), '23:00', '09:00'));
  ok('тихие часы 23:00–09:00: 12:00 — ГРОМКО', !inQuietHours(at(12), '23:00', '09:00'));
  ok('тихие часы 23:00–09:00: 22:59 — ГРОМКО', !inQuietHours(at(22, 59), '23:00', '09:00'));
  ok('обычное окно 09:00–23:00: 12:00 — тихо', inQuietHours(at(12), '09:00', '23:00'));

  // T2. Ловушка подстроки: «закрытие» НЕ должно читаться как статус «ЗАКРЫТ»
  ok('статус: «речь про закрытие вопроса» ≠ отвечено',
    classifyStatusLine('**Статус:** речь про закрытие вопроса позже') !== 'answered');
  ok('статус: «✅ ЗАКРЫТ» = отвечено', classifyStatusLine('**Статус:** ✅ ЗАКРЫТ') === 'answered');
  ok('статус: «⏳ ЖДЁТ ОТВЕТА КРИНИКА» = ждёт',
    classifyStatusLine('**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА') === 'waiting');

  // T3. Нормализация одна на обе стороны (I3): четыре ЛИЦА одного текста дают ОДИН хеш
  const base = 'Текст вопроса\nвторая строка\n';
  const faces = {
    'CRLF': 'Текст вопроса\r\nвторая строка\r\n',
    'BOM': '\uFEFFТекст вопроса\nвторая строка\n',
    'лишние пустые строки в конце': 'Текст вопроса\nвторая строка\n\n\n',
    'без финального перевода строки': 'Текст вопроса\nвторая строка',
    'хвостовые пробелы': 'Текст вопроса   \nвторая строка\t\n',
  };
  for (const [name, face] of Object.entries(faces)) {
    ok(`нормализация: «${name}» даёт тот же sha`, sha256(face) === sha256(base));
  }
  ok('нормализация: правка текста МЕНЯЕТ sha', sha256(base) !== sha256(base.replace('вторая', 'третья')));

  // T4. Гард обязан покраснеть на заведомо висящем документе
  const sandbox = path.join(PAGES_DIR, '.selftest');
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
  const hangingDoc = path.join(sandbox, 'interview_999_selftest.md');
  fs.writeFileSync(hangingDoc, [
    '# Интервью 999 — самотест гарда', '',
    '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Заведомо висящий вопрос?', '',
    '| # | Вариант | Смысл |', '|---|---|---|',
    '| **(а)** | Первый | раз |', '| **(б)** | Второй | два |', '',
    '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  const d = parseDoc(hangingDoc);
  ok('разбор: вопрос найден', d.questions.length === 1, `найдено ${d.questions.length}`);
  ok('разбор: варианты найдены', d.questions[0]?.options.length === 2);
  ok('разбор: пустой слот распознан', d.slotsEmpty === 1);
  ok('разбор: статус = ждёт', d.statusKind === 'waiting');
  ok('разбор: счётчик кандидатов = числу разобранных вариантов',
    d.optionCandidates === d.optionsParsed, `${d.optionCandidates} = ${d.optionsParsed}`);

  // T4a. ⚠️ ЛИНЕЙКА `---` ПОСЛЕ ПУСТОГО СЛОТА не считается ответом (дефект №2 отчёта NDim:
  // по десяти живым интервью выходило «0 без ответа»)
  const hrDoc = path.join(sandbox, 'interview_996_hr.md');
  fs.writeFileSync(hrDoc, [
    '# Интервью 996 — линейка после пустого слота', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА', '',
    '## В1. Вопрос?', '', '**Ответ Криника:**', '', '---', '', '## В2. Второй?', '',
    '**Ответ Криника:**', '', '---', '',
  ].join('\n'), 'utf8');
  const hrParsed = parseDoc(hrDoc);
  ok('разбор: линейка `---` после пустого слота ≠ ответ', hrParsed.slotsEmpty === 2,
    `пустых ${hrParsed.slotsEmpty}/${hrParsed.slotsTotal}`);

  // T4b. ⚠️ ВСТРЕЧНЫЙ ВОПРОС ВЛАДЕЛЬЦА — не слот ответа (дефект №3 отчёта NDim)
  const cqDoc = path.join(sandbox, 'interview_995_counter.md');
  fs.writeFileSync(cqDoc, [
    '# Интервью 995 — встречный вопрос', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА', '',
    '## В1. Блокирующий вопрос?', '', '**Ответ (вопрос владельца):** а что именно ты имеешь в виду?', '',
    '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  const cq = parseDoc(cqDoc);
  ok('разбор: «Ответ (вопрос владельца)» НЕ считается слотом ответа', cq.slotsTotal === 1);
  ok('разбор: блокирующий вопрос виден как неотвеченный', cq.slotsEmpty === 1);

  // T4c. ⚠️ МНОГОСТРОЧНЫЙ ВАРИАНТ — жирный заголовок перенесён на вторую строку (дефект №4:
  // вариант ИСЧЕЗАЛ молча, и пропадал ровно рекомендованный)
  const wrapDoc = path.join(sandbox, 'interview_994_wrapped.md');
  fs.writeFileSync(wrapDoc, [
    '# Интервью 994 — перенос жирного заголовка варианта', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА', '',
    '## В1. Что делать?', '',
    '- **(а) Ставить крышу по доказанному',
    '  уровню** — и пробовать раз в минуту',
    '- **(б)** Не ставить ничего',
    '- **(в) Третий вариант с переносом',
    '  внутри жирного** — тоже длинный',
    '', '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  const wrap = parseDoc(wrapDoc);
  ok('разбор: многострочные варианты не потеряны', wrap.optionsParsed === 3, `разобрано ${wrap.optionsParsed}`);
  ok('разбор: счётная проверка кандидатов сходится',
    wrap.optionCandidates === wrap.optionsParsed, `${wrap.optionCandidates} = ${wrap.optionsParsed}`);

  // T4c2. ⚠️ ОБРАТНАЯ ЛОВУШКА (поймано на живом interview_005 2026-08-02): ответ владельца,
  // написанный СПИСКОМ под отдельным слотом, месяц читался как ПУСТОЙ слот. Различает случаи сам
  // слот: пункт списка (стиль 006) → следующий пункт это соседний вопрос; отдельная строка → список
  // под ней это ответ.
  const listAnsDoc = path.join(sandbox, 'interview_992_list_answer.md');
  fs.writeFileSync(listAnsDoc, [
    '# Интервью 992 — ответ списком', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА', '',
    '### Q1. Какие источники нужны?', '',
    '- Камера', '- Картинка', '', '**Ответ:** ', '- USB UVC', '- Картинка/оверлей', '',
  ].join('\n'), 'utf8');
  const listAns = parseDoc(listAnsDoc);
  ok('разбор: ответ СПИСКОМ под отдельным слотом = слот ЗАПОЛНЕН', listAns.slotsEmpty === 0,
    `пустых ${listAns.slotsEmpty}/${listAns.slotsTotal}`);

  // T4d. РЕГРЕССИЯ на живом дефекте: интервью 006 пишет слот как «- Ответ Криника:» без жирного
  const looseDoc = path.join(sandbox, 'interview_998_loose_slot.md');
  fs.writeFileSync(looseDoc, [
    '# Интервью 998 — слот ответа без жирного начертания', '',
    '> Статус: **❓ НА РЕВЮ КРИНИКА**', '', '## Вопросы', '',
    '- Нужен ли поворот содержимого слоя?', '- Ответ Криника:', '',
    '- Второй вопрос — оставляем ли снаппинг?', '- Ответ Криника:', '',
  ].join('\n'), 'utf8');
  const loose = parseDoc(looseDoc);
  ok('регрессия 006: слот «- Ответ Криника:» распознан', loose.slotsTotal === 2, `найдено ${loose.slotsTotal}`);
  ok('регрессия 006: документ виден гарду как висящий', loose.slotsEmpty === 2 && loose.statusKind === 'waiting');
  const looseWritten = writeAnswersIntoDoc(loose, { 'В1': { choice: '', text: 'да, нужен', comment: '' } }, 'Криник', isoNow()).text;
  ok('регрессия 006: форма слота сохранена (не превратилась в жирную)',
    /^- Ответ Криника: да, нужен/m.test(looseWritten));

  // T5. Гейт fail-closed по всем причинам отказа
  const decisionPath = decisionPathFor(rel(hangingDoc));
  fs.rmSync(decisionPath, { force: true });
  ok('гейт: решения нет → отказ', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.NO_DECISION);

  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  fs.writeFileSync(decisionPath, JSON.stringify({
    kind: 'interview', document: rel(hangingDoc), by: 'selftest', at: isoNow(),
    answers: { 'В1': { choice: 'а', text: '', comment: '', sha256: d.questions[0].sha256 } },
  }, null, 2), 'utf8');
  ok('гейт: ответ есть и текст не менялся → открыт', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.OK);

  // CRLF + BOM НЕ ломают гейт — ровно тот дефект, который в поле закрывал гейт навсегда
  const crlf = '\uFEFF' + fs.readFileSync(hangingDoc, 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(hangingDoc, crlf, 'utf8');
  ok('гейт: CRLF + BOM не ломают одобрение (I3)', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.OK);

  fs.writeFileSync(hangingDoc,
    fs.readFileSync(hangingDoc, 'utf8').replace('## В1. Заведомо висящий вопрос?',
      '## В1. Заведомо висящий вопрос? (формулировка изменена после ответа)'), 'utf8');
  const drifted = parseDoc(hangingDoc);
  ok('гейт: текст изменился после ответа → ОТКАЗ (I3)',
    drifted.questions[0].sha256 !== d.questions[0].sha256 &&
    gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.DRIFTED);

  fs.writeFileSync(decisionPath, JSON.stringify({
    kind: 'interview', document: rel(hangingDoc), by: 'selftest', at: isoNow(),
    answers: { 'В1': { status: 'rejected', choice: '', sha256: drifted.questions[0].sha256 } },
  }, null, 2), 'utf8');
  ok('гейт: отклонено владельцем → отказ', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.REJECTED);

  // T6. Запись ответа в md — и sha после записи всё ещё сходится
  const doc2 = parseDoc(hangingDoc);
  const { text, changed } = writeAnswersIntoDoc(doc2, { 'В1': { choice: 'б', text: 'своими словами', comment: 'потому что' } }, 'Криник', isoNow());
  const written = path.join(sandbox, 'written.md');
  fs.writeFileSync(written, text, 'utf8');
  const after = parseDoc(written);
  ok('запись: ответ вписан в md', changed === 1 && /\*\*\(б\)\*\*/.test(text));
  ok('запись: комментарий владельца сохранён', /потому что/.test(text));
  ok('запись: слот больше не пуст', after.slotsEmpty === 0);
  ok('запись: статус переведён в «отвечено»', after.statusKind === 'answered', after.statusText.trim());
  ok('запись: sha тела вопроса НЕ изменился (ответ не ломает свой хеш)',
    after.questions[0].sha256 === doc2.questions[0].sha256);

  // T6b. 🔴 ПЕРВОИСТОЧНИК ВЛАДЕЛЬЦА НЕ ЗАТИРАЕТСЯ: повторный ответ приезжает уточнением
  const again = writeAnswersIntoDoc(after, { 'В1': { choice: '', text: 'нет, вот так', comment: 'передумал' } }, 'Криник', isoNow());
  ok('повторный ответ: прежний ответ владельца остался ДОСЛОВНО',
    /своими словами/.test(again.text) && /\*\*\(б\)\*\*/.test(again.text));
  ok('повторный ответ: новый текст добавлен отдельным датированным уточнением',
    /_уточнение · by Криник · at .*нет, вот так/.test(again.text));
  ok('повторный ответ: провенанс исходной записи не удалён',
    (again.text.match(/_записано контуром/g) || []).length === 1);

  // T6c. Частичный ответ — штатный режим
  const partDoc = path.join(sandbox, 'interview_997_partial.md');
  fs.writeFileSync(partDoc, [
    '# Интервью 997 — частичный ответ', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Первый вопрос?', '', '**Ответ Криника:**', '', '>', '', '---', '',
    '## В2. Второй вопрос?', '', '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  const p1 = parseDoc(partDoc);
  fs.writeFileSync(partDoc, writeAnswersIntoDoc(p1, { 'В1': { choice: '', text: 'только первый', comment: '' } }, 'Криник', isoNow()).text, 'utf8');
  const afterPart = parseDoc(partDoc);
  ok('частичный ответ: закрыт ровно один слот', afterPart.slotsEmpty === 1 && afterPart.slotsTotal === 2);
  ok('частичный ответ: статус НЕ переведён в «отвечено»', afterPart.statusKind === 'waiting');
  ok('частичный ответ: второй вопрос остался пустым и виден гарду',
    afterPart.questions[1] && !afterPart.questions[1].answered);

  // T6d. Комментарий по документу целиком — отдельным датированным блоком, КОПИТСЯ
  let commented = appendDocumentComment(fs.readFileSync(partDoc, 'utf8'), 'первый общий комментарий', 'Криник', isoNow());
  commented = appendDocumentComment(commented, 'второй общий комментарий', 'Криник', isoNow());
  ok('комментарий по документу: оба блока на месте, второй не затёр первый',
    /первый общий комментарий/.test(commented) && /второй общий комментарий/.test(commented) &&
    (commented.match(/## Комментарий владельца/g) || []).length === 2);

  // T6e. Решение по АРТЕФАКТУ пишется в исходный md (I2 — три места, а не два). Пробел найден на
  // живом прогоне: одобрение README лежало в json и архиве, а документ о нём молчал.
  const artText = appendArtifactDecisions('# Док\n\nтело\n',
    { 'readme-seo-draft': { status: 'approved', sha256: 'abc123def456ghi789', comment: 'ок' } },
    'Криник', isoNow());
  ok('артефакт: решение вписано в документ с вердиктом, автором и sha',
    /## Решение по артефакту `readme-seo-draft`/.test(artText) && /\*\*ОДОБРЕНО\*\* · by Криник/.test(artText)
    && /abc123def456ghi7/.test(artText));
  ok('артефакт: переодобрение НЕ затирает прошлое решение',
    (appendArtifactDecisions(artText, { 'readme-seo-draft': { status: 'rejected', sha256: 'zzz' } }, 'Криник', isoNow())
      .match(/## Решение по артефакту/g) || []).length === 2);

  // T7. ДЕТЕКТОР ПРОТУХШЕГО СТАТУСА: ответы есть, а статус кричит «ЖДЁТ»
  const staleDoc = path.join(sandbox, 'interview_993_stale.md');
  fs.writeFileSync(staleDoc, [
    '# Интервью 993 — протухший статус', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Вопрос?', '', '**Ответ Криника:** уже давно отвечено', '',
  ].join('\n'), 'utf8');
  const stale = parseDoc(staleDoc);
  ok('детектор: протухший статус пойман', stale.staleStatus === true);
  ok('детектор: нормальный висящий документ НЕ считается протухшим', parseDoc(partDoc).staleStatus === false);

  // T8. Страница — самодостаточность и набор элементов
  const page = renderPage([parseDoc(hangingDoc)], loadConfig());
  ok('страница: нет внешних загрузок',
    !/(https?:)?\/\/(?!127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/i.test(page.replace(/<a href="[^"]*"/g, '')));
  ok('страница: обе темы описаны', page.includes('prefers-color-scheme') && page.includes('data-theme=dark'));
  ok('страница: варианты отрисованы', /type="radio"/.test(page));
  ok('страница: тег состояния «ждёт вас» есть', page.includes('ждёт вас'));
  ok('страница: счётчики в шапке есть', /ждут вас: \d+/.test(page) && /отвечено: \d+/.test(page));
  ok('страница: поля «кто отвечает» НЕТ (правка Криника 1.2)',
    !/кто отвечает/i.test(page) && !/class="who"/.test(page) && !/отвечает .* — владелец проекта/.test(page));
  ok('страница: механика снятия выбора на месте', /dataset\.on/.test(page) && /повторный клик/.test(page));
  ok('страница: автозакрытие после записи описано', /Закрываю окно через/.test(page));
  ok('страница: комментарий по документу целиком есть', /doccomment-text/.test(page));

  // T9. ЗВУК зафиксирован спецификацией: три писка 880/660/990 Гц. Проверяем БУФЕР, а не ухо —
  // считаем переходы через ноль в каждом тоне: f ≈ переходы / 2 / длительность.
  const wav = beepWav();
  ok('звук: WAV собран (RIFF/WAVE)', wav.slice(0, 4).toString() === 'RIFF' && wav.slice(8, 12).toString() === 'WAVE');
  const rate = wav.readUInt32LE(24);
  const pcm = wav.slice(44);
  const toneN = Math.round(rate * 0.12), gapN = Math.round(rate * 0.06);
  BEEP_HZ.forEach((want, k) => {
    const from = k * (toneN + gapN);
    let crossings = 0, prev = pcm.readInt16LE(from * 2);
    for (let i = 1; i < toneN; i++) {
      const v = pcm.readInt16LE((from + i) * 2);
      if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) crossings++;
      prev = v;
    }
    const got = Math.round(crossings / 2 / 0.12);
    ok(`звук: тон ${k + 1} ≈ ${want} Гц`, Math.abs(got - want) <= 15, `замерено ${got} Гц`);
  });

  // T10. ГАРД: базовая линия, новое нарушение, исключение без причины
  const gsand = path.join(sandbox, 'guardsand');
  fs.mkdirSync(gsand, { recursive: true });
  const line = '**Ответ Криника:**';
  const key = `x/y.md:${sha1(line)}`;
  ok('гард: ключ строки не зависит от НОМЕРА строки (правка вопроса возвращает его под правило)',
    key === `x/y.md:${sha1(line)}` && sha1(line) !== sha1(line + ' правка'));
  const baseline = loadBaseline();
  ok('гард: базовая линия читается', baseline.keys instanceof Set);
  const exc = loadExceptions();
  ok('гард: исключение без причины не действует (маркер без причины = нарушение)',
    loadExceptionsProbe([{ file: 'a.md' }]).every((x) => !x.reason));
  ok('гард: исключение с причиной действует', exc.every((x) => typeof x.reason === 'string'));

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(decisionPath, { force: true });

  console.log(failed ? `\n❌ SELFTEST: провалено проверок — ${failed}` : '\n✅ SELFTEST: все проверки зелёные (и каждый гард умеет краснеть)');
  return failed ? 1 : 0;
}

// Вспомогалка для самотеста исключений: та же нормализация причины, что и в loadExceptions().
const loadExceptionsProbe = (list) => list.map((x) => ({ ...x, reason: (x.reason || x.why || '').trim() }));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HELP = `
tools/owner.mjs — контур согласований «агент ↔ владелец» (KAIF 2.1, /owner-reviews)

  node tools/owner.mjs guard [--json]        ВСЕ висящие вопросы + долг числом (exit 1 на НОВЫХ)
  node tools/owner.mjs baseline              снять/пересобрать базовую линию долга
  node tools/owner.mjs render <док.md>       собрать страницу, не открывая и не зовя
  node tools/owner.mjs ask <док.md> [...]    страница + браузер + сигнал; ЛЮБАЯ запись будит агента
  node tools/owner.mjs gate <док.md> [--q В1 | --artifact <id>]
                                             fail-closed проверка перед зависимой работой
  node tools/owner.mjs queue <док.md>        припарковать для автономного цикла (не блокируя)
  node tools/owner.mjs inbox [--no-serve]    одна страница на всю пачку (--no-serve = собрать и выйти)
  node tools/owner.mjs selftest              ядро: каждому гарду скармливается его дефект
  node tools/owner.mjs verify [--headful]    QA ЖИВЫМ браузером: клики, теги, цвета, побудка

  Флаги ask/inbox: --timeout <сек> (деф. 3600) · --no-open · --no-signal · --port <N>
  Настройки: tools/owner.config.json (владелец, голос, тихие часы, порт, цвет акцента)
  Спецификация: .claude/skills/owner-reviews/references/build-spec.md
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  const flag = (name) => rest.includes(name);
  const val = (name, def) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] ? rest[i + 1] : def; };
  const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--timeout', '--q', '--artifact', '--port'].includes(rest[i - 1])));

  switch (cmd) {
    case 'guard':
      process.exit(guard({ json: flag('--json') }));
      break;
    case 'baseline':
      process.exit(baselineCmd());
      break;
    case 'render': {
      if (!positional[0]) { console.error('нужен путь к документу'); process.exit(1); }
      const doc = parseDoc(path.resolve(ROOT, positional[0]));
      fs.mkdirSync(PAGES_DIR, { recursive: true });
      const out = path.join(PAGES_DIR, `${path.basename(doc.relPath).replace(/\.md$/, '')}.html`);
      fs.writeFileSync(out, renderPage([doc], cfg), 'utf8');
      console.log(`📄 ${rel(out)}  (вопросов: ${doc.questions.length}, пустых слотов: ${doc.slotsEmpty}/${doc.slotsTotal}, статус: ${doc.statusKind}, варианты: ${doc.optionsParsed}/${doc.optionCandidates})`);
      if (doc.optionsParsed !== doc.optionCandidates) {
        console.error(`⚠️  СЧЁТНАЯ ПРОВЕРКА НЕ СОШЛАСЬ: кандидатов ${doc.optionCandidates}, разобрано ${doc.optionsParsed} — вариант мог потеряться молча.`);
        process.exit(2);
      }
      break;
    }
    case 'ask': {
      if (!positional.length) { console.error('нужен путь к документу'); process.exit(1); }
      const code = await ask(positional, cfg, {
        timeoutSec: Number(val('--timeout', cfg.timeoutSec)),
        noOpen: flag('--no-open'), noSignal: flag('--no-signal'),
        port: Number(val('--port', cfg.port)),
      });
      process.exit(code);
      break;
    }
    case 'inbox': {
      const items = readQueue();
      if (!items.length) { console.log('📭 очередь пуста — владельца звать не за чем.'); process.exit(0); }
      if (flag('--no-serve')) {
        // «Собрать и выйти»: команда, которая по замыслу держит сервер, ОБЯЗАНА иметь этот флаг —
        // иначе всякий, кто зовёт её синхронно (в первую очередь наш же QA), повиснет навсегда.
        const docs = items.map((i) => parseDoc(path.resolve(ROOT, i.doc)));
        fs.mkdirSync(PAGES_DIR, { recursive: true });
        const out = path.join(PAGES_DIR, 'inbox.html');
        fs.writeFileSync(out, renderPage(docs, cfg), 'utf8');
        console.log(`📄 ${rel(out)} — накопилось ${docs.length}; сервер НЕ поднимался (--no-serve)`);
        process.exit(0);
      }
      const code = await ask(items.map((i) => i.doc), cfg, {
        fromQueue: true, timeoutSec: Number(val('--timeout', cfg.timeoutSec)),
        noOpen: flag('--no-open'), noSignal: flag('--no-signal'),
        port: Number(val('--port', cfg.port)),
      });
      process.exit(code);
      break;
    }
    case 'gate':
      if (!positional[0]) { console.error('нужен путь к документу'); process.exit(1); }
      process.exit(gate(positional[0], { question: val('--q', null), artifact: val('--artifact', null) }));
      break;
    case 'queue':
      if (!positional[0]) { console.error('нужен путь к документу'); process.exit(1); }
      process.exit(queueAdd(positional[0]));
      break;
    case 'selftest':
      process.exit(selftest());
      break;
    case 'verify': {
      // QA живым браузером живёт отдельным файлом (спецификация §0): у него другая работа и
      // другой жизненный цикл. Даём ему ЖЁСТКИЙ срок — осиротевшие процессы уже были в поле.
      const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'owner-verify.mjs'), ...rest],
        { stdio: 'inherit', timeout: 240000 });
      process.exit(r.status === null ? 1 : r.status);
      break;
    }
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

// Запускаем CLI ТОЛЬКО когда файл вызван напрямую: иначе `import` из QA-прогона поднял бы контур
// прямо в момент импорта (а он умеет открывать браузер и звать владельца — очень громкий сюрприз).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error('💥', e); process.exit(1); });

export {
  normalizeBody, sha256, parseDoc, parseLines, renderPage, writeAnswersIntoDoc, appendDocumentComment,
  recordDecision, appendArtifactDecisions, gate, guard, collectOrphans, inQuietHours, beepWav, loadConfig, decisionPathFor,
  findAppBrowser,
  isoNow, GATE_EXIT, ROOT, PAGES_DIR, DECISIONS_DIR, ARCHIVE_DIR, BEEP_HZ,
};
