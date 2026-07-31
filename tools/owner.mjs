#!/usr/bin/env node
/**
 * tools/owner.mjs — КОНТУР СОГЛАСОВАНИЙ «агент ↔ владелец» (KAIF 2.1, навык `/owner-reviews`).
 * План работ и обоснование: plans/22_owner_reviews_contour.md
 *
 * ЗАЧЕМ. Всё, что агент хочет ОТ Криника (развилка, вычитка, одобрение, ответ), по канону живёт
 * только в `interviews/`. Этот инструмент делает такой запрос ВИДИМЫМ и МЕХАНИЧЕСКИ ПРОВЕРЯЕМЫМ:
 * рендерит документ в локальную HTML-страницу, зовёт владельца голосом и звуком, записывает решение
 * в три места и отказывается пускать зависимую работу дальше, пока решения нет.
 *
 * ГЛАВНОЕ: HTML — это транспорт, а цель — ГАРД. Правило «место вопросов» нарушают даже агенты,
 * которые его знают (чат дешевле в моменте), поэтому команда `guard` важнее всей остальной красоты.
 *
 * ИНВАРИАНТЫ (нормативные, plans/22):
 *   I1  md — источник, HTML — производное. Страница строится заново при каждом вызове.
 *   I2  Ответ пишется в ТРИ места: исходный md · <док>.decision.json · копия в архиве с by/at.
 *   I3  Одобрение привязано к sha256 ТЕЛА, а не к клику. Нормализация ОДНА на обе стороны —
 *       см. normalizeBody(): CRLF→LF, снять BOM, срезать хвостовые пробелы в каждой строке,
 *       срезать пустые строки в начале и конце, гарантировать финальный \n. Самый дорогой полевой
 *       дефект этого контура — страница считала байты файла, а отправитель нормализованный текст:
 *       оба самотеста зелёные, гейт отказывает ВСЕГДА.
 *   I4  Гейт стоит на стороне ПРИМЕНЕНИЯ и fail-closed: любое сомнение = отказ, exit != 0.
 *       Запрос НИКОГДА не самоодобряется по таймауту.
 *   I5  Сигнал идёт ПОСЛЕ успешно поднятой страницы (иначе класс «позвал, а показать нечего»).
 *   I6  Тихие часы важнее всего, включая явно запрошенный голос; окно ПЕРЕСЕКАЕТ полночь.
 *   I7  Автономные циклы КОПЯТ, а не блокируются (queue → inbox: один зов на пачку).
 *
 * КАНОН ПРОЕКТА, соблюдённый здесь:
 *   · текст ходит ФАЙЛАМИ, а не аргументами командной строки — `say -f`, `osascript <файл>`
 *     (кириллица в argv молча портится, AGENT_GUIDE «Гигиена документов и текста»);
 *   · регулярки по русскому тексту используют \p{L} с флагом u — в Node `\w`/`\b` ASCII-only;
 *   · гард обязан УМЕТЬ КРАСНЕТЬ: `selftest` скармливает каждому гарду его дефект.
 *
 * Ноль внешних зависимостей: stdlib Node + системные утилиты macOS (say/afplay/osascript/open).
 *
 * Команды: guard · render · ask · gate · queue · inbox · selftest   (`node tools/owner.mjs help`)
 *
 * СТАТУС ПРОВЕРКИ (честно, по частям — TESTING_FRAMEWORK.md):
 *   [TESTED: 2026-07-31 · `selftest` — 36 проверок зелёные, каждому гарду скормлен ровно его дефект:
 *     ловушка «за-крыт-ие», окно тихих часов через полночь, слот `- Ответ Криника:`, частичный и
 *     повторный ответ, четыре причины отказа гейта] — разбор, нормализация/sha, гейт, запись в md.
 *   [TESTED: 2026-07-31 · прогон по ВСЕМ 15 живым интервью — 0 падений; `guard` на живом репозитории
 *     нашёл 1 висящее интервью и 4 вопроса-сироты] — рендер и гард.
 *   [NOT-TESTED] — ПОВЕДЕНИЕ СТРАНИЦЫ В БРАУЗЕРЕ (снятие выбора, частичная отправка, тосты): его
 *     наблюдает только человек, агент браузер не видит. Переключать маркер — по слову Криника.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = path.join(ROOT, 'tools', 'owner-pages');          // производное, gitignored (I1)
const DECISIONS_DIR = path.join(ROOT, 'interviews', 'decisions');    // решения — версионируем
const ARCHIVE_DIR = path.join(DECISIONS_DIR, 'archive');
const QUEUE_FILE = path.join(DECISIONS_DIR, '_queue.json');
const EXCEPTIONS_FILE = path.join(ROOT, 'tools', 'owner-guard-exceptions.json');
const CONFIG_FILE = path.join(ROOT, 'tools', 'owner.config.json');

// ── Конфигурация ────────────────────────────────────────────────────────────────────────────────
// Голос — ПАРАМЕТР, а не меню: на машине 186 голосов, пригоден ровно один русский (Milena).
// Тихие часы обязательны, а не опциональны.
const DEFAULTS = {
  owner: 'Криник',
  voice: 'Milena',
  sound: '/System/Library/Sounds/Submarine.aiff',
  quietHours: { from: '23:00', to: '09:00' },
  port: 8787,
  say: true,
  notify: true,
  timeoutSec: 3600,
};

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  РАЗБОР ЖИВОГО ДОКУМЕНТА
//  Формат интервью в проекте разнородный — это ФАКТ, снятый с 15 живых файлов (plans/22):
//  заголовки `## В1.` `### Q1:` `### Q1 — `, документы вовсе без заголовков вопросов, статус в
//  четырёх разных обёртках или отсутствующий. Парсер обязан переваривать всё это, а не эталон.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// Заголовок вопроса: «## В1. …», «### Q1: …», «### Q1 — …», «## Вопрос 3 …»
const QUESTION_HEADING_RE = /^#{2,4}\s+(?:\*\*)?(В|Q|Вопрос|ВОПРОС)\s*\.?\s*(\d+)\s*(?:[.):—–-]\s*)?(.*)$/u;
/**
 * Слот ответа владельца. В проекте живут ЧЕТЫРЕ формы, и это факт с живых файлов, а не догадка:
 *   `**Ответ Криника:** …`   `**Ответ:** …`   `- Ответ Криника: …`   `Ответы Криника:`
 * Узкий шаблон (только жирная форма) молча ПРОПУСКАЛ интервью 006 целиком: 0 вопросов, 0 пустых
 * слотов — то есть новое интервью в этом стиле было бы невидимо и для страницы, и для гарда.
 * Группы: 1 — префикс строки (отступ/цитата/маркер списка), 2/4/5 — звёздочки жирного,
 *         3 — подпись слота, 6 — то, что владелец написал в ту же строку.
 */
const ANSWER_SLOT_RE = /^(\s*(?:>\s*)?(?:[-*+]\s+)?)(\*\*)?(Ответ(?:ы)?(?:\s+Криника)?)(\*\*)?\s*[:：](\*\*)?(.*)$/u;
// Для гарда «слот вне interviews/» шаблон намеренно СТРОГИЙ (только канонная жирная форма):
// у него другая работа — искать посаженную не туда заготовку ответа, а не всякое слово «ответ».
const ANSWER_SLOT_STRICT_RE = /^\s*(?:>\s*)?\*\*Ответ(?:ы)?(?:\s+Криника)?\s*:\*\*/u;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

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

/** Заполнен ли слот ответа: текст на той же строке ИЛИ непустой блок под ним (цитата/абзац). */
function slotFilled(lines, slotIndex) {
  const m = lines[slotIndex].match(ANSWER_SLOT_RE);
  if (m && m[6].trim()) return true;
  // Блок ответа под слотом — это цитата-заготовка или абзац ВПЛОТНУЮ к слоту. Жадный скан «до
  // следующего заголовка» ошибочно засчитывал СЛЕДУЮЩИЙ ПУНКТ СПИСКА как ответ, и документ в
  // стиле интервью 006 выглядел отвеченным, будучи пустым. Пустой слот — главный сигнал гарда,
  // поэтому граница блока здесь строгая.
  for (let i = slotIndex + 1; i < lines.length; i++) {
    const l = lines[i];
    if (HEADING_RE.test(l) || HR_RE.test(l) || ANSWER_SLOT_RE.test(l)) break;
    if (!l.trim()) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (next && /^\s*>/.test(next)) continue;   // дальше цитата — она и есть заготовка ответа
      break;
    }
    if (/^\s*[-*+]\s/.test(l)) break;             // новый пункт списка — это уже не ответ
    const content = l.replace(/^\s*>\s?/, '').trim();
    if (content) return true;
  }
  return false;
}

/**
 * Разбирает документ в модель: заголовок, статус, список вопросов со своими телами, вариантами,
 * слотами ответа и sha256 тела (I3). Документы без заголовков вопросов (001, 006, 011) разбираются
 * по слотам ответа — это и есть их естественная структура.
 */
function parseDoc(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
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
    if (ANSWER_SLOT_RE.test(l)) slots.push(i);
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
    }
  } else if (slots.length) {
    // Запасной путь: вопрос = кусок текста, заканчивающийся слотом ответа
    let prev = 0;
    slots.forEach((s, k) => {
      questions.push(buildQuestion(lines, prev, s + 1, `В${k + 1}`, '', slots));
      prev = s + 1;
    });
  }

  const emptySlots = slots.filter((s) => !slotFilled(lines, s)).length;
  return {
    path: absPath,
    relPath: rel(absPath),
    title,
    raw,
    lines,
    statusIndex: status.index,
    statusText: status.text,
    statusKind: classifyStatusLine(status.text),
    slotsTotal: slots.length,
    slotsEmpty: emptySlots,
    questions,
    meta: parseMetaBlock(raw),
  };
}

function buildQuestion(lines, start, end, id, headingText, allSlots) {
  const slotIndex = allSlots.find((s) => s >= start && s < end) ?? -1;
  // Тело вопроса = всё до слота ответа (сам ответ в хеш НЕ входит: иначе ответ ломает свой же хеш)
  const bodyEnd = slotIndex >= 0 ? slotIndex : end;
  const bodyLines = lines.slice(start, bodyEnd);
  const body = bodyLines.join('\n');
  return {
    id,
    heading: headingText || (bodyLines.find((l) => l.trim()) || id).replace(/^#+\s*/, '').slice(0, 120),
    body,
    bodyHtml: mdToHtml(stripLeadingHeading(body)),
    sha256: sha256(body),
    options: parseOptions(bodyLines),
    recommended: parseRecommendation(body),
    slotIndex,
    // Форму слота ЗАПОМИНАЕМ и воспроизводим при записи: документ владельца не меняет стиль
    // только потому, что ответ пришёл со страницы, а не из редактора.
    slotPrefix: slotIndex >= 0 ? (lines[slotIndex].match(ANSWER_SLOT_RE)?.[1] ?? '') : '',
    slotLabel: slotIndex >= 0 ? (lines[slotIndex].match(ANSWER_SLOT_RE)?.[3] || 'Ответ Криника') : 'Ответ Криника',
    slotBold: slotIndex >= 0 ? Boolean(lines[slotIndex].match(ANSWER_SLOT_RE)?.[2] || lines[slotIndex].match(ANSWER_SLOT_RE)?.[5]) : true,
    answered: slotIndex >= 0 ? slotFilled(lines, slotIndex) : false,
    answerText: slotIndex >= 0 ? (lines[slotIndex].match(ANSWER_SLOT_RE)?.[6] || '').trim() : '',
  };
}

const stripLeadingHeading = (body) => body.replace(/^#{1,6}\s+.*\n?/, '');

/**
 * Варианты ответа. В проекте они живут двумя способами: строками таблицы `| **(а)** | … |` и
 * жирными буквами в списках. Разбор НЕ обязан быть идеальным — на странице всегда есть поле
 * свободного ответа, поэтому непонятый вариант стоит владельцу одной строки текста, а не тупика.
 */
function parseOptions(bodyLines) {
  const opts = [];
  const seen = new Set();
  for (const line of bodyLines) {
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && !c) && !(i === a.length - 1 && !c));
      const keyCell = cells.find((c) => /^\*\*\(?([A-Za-zА-Яа-яЁё])\)?\*\*$/u.test(c));
      if (keyCell) {
        const key = keyCell.replace(/[*()]/g, '').trim();
        const label = cells[cells.indexOf(keyCell) + 1] || '';
        if (!seen.has(key)) { seen.add(key); opts.push({ key, label: plain(label) }); }
      }
      continue;
    }
    const m = line.match(/^\s*(?:[-*+]\s+)?\*\*\(?([A-Za-zА-Яа-яЁё])\)?[.)]?\*\*\s*[—–-]?\s*(.*)$/u);
    if (m && !seen.has(m[1])) { seen.add(m[1]); opts.push({ key: m[1], label: plain(m[2]).slice(0, 200) }); }
  }
  return opts;
}

/** Рекомендация агента — чтобы владелец видел её отдельной меткой, а не искал в прозе. */
function parseRecommendation(body) {
  const m = body.match(/рекоменд\p{L}*\s*[—–-]?\s*\*{0,2}\(?([A-Za-zА-Яа-яЁё])\)?\*{0,2}/iu);
  return m ? m[1] : null;
}

const plain = (md) => md.replace(/[*`_~]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

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
  // Минимальный разбор списка артефактов (нам не нужен полный YAML — нужен один плоский список)
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
//  СТРАНИЦА
//  Самодостаточна: ни одной внешней загрузки, открывается офлайн и из файла. Обе темы ОС —
//  тёмный код на тёмном фоне однажды поймал владелец, а не самопроверка (plans/22, риск 6).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const PAGE_CSS = `
:root{--bg:#f7f7f9;--fg:#16161a;--muted:#5d5d6b;--card:#fff;--line:#e3e3ea;--brand:#FF1A8C;
--code-bg:#f0f0f4;--ok:#12855b;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#131317;--fg:#ececf0;--muted:#a0a0b0;--card:#1c1c22;
--line:#2e2e38;--code-bg:#26262f;--ok:#3ddc9a;--warn:#f0b429}}
:root[data-theme=light]{--bg:#f7f7f9;--fg:#16161a;--muted:#5d5d6b;--card:#fff;--line:#e3e3ea;--code-bg:#f0f0f4;--ok:#12855b;--warn:#b45309}
:root[data-theme=dark]{--bg:#131317;--fg:#ececf0;--muted:#a0a0b0;--card:#1c1c22;--line:#2e2e38;--code-bg:#26262f;--ok:#3ddc9a;--warn:#f0b429}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:24px 18px 120px}
header.top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:1.6rem;line-height:1.25;margin:.2em 0}
.path{color:var(--muted);font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.badge.wait{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn);border-color:transparent}
.badge.rec{background:color-mix(in srgb,var(--brand) 16%,transparent);color:var(--brand);border-color:transparent}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:18px 0}
.card h2,.card h3{margin-top:.2em}
.q-title{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.q-id{color:var(--brand);font-weight:700}
.opts{display:flex;flex-direction:column;gap:8px;margin:14px 0}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}
label.opt:hover{border-color:var(--brand)}
label.opt input{margin-top:4px}
textarea,input[type=text]{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:15px/1.5 inherit;resize:vertical}
textarea:focus,input:focus{outline:2px solid var(--brand);outline-offset:1px}
.lbl{display:block;margin:12px 0 6px;color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
pre{background:var(--code-bg);padding:12px 14px;border-radius:10px;overflow-x:auto}
code{background:var(--code-bg);padding:.12em .35em;border-radius:5px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.1em 0 .1em 14px;border-left:3px solid var(--line);color:var(--muted)}
.tw{overflow-x:auto;margin:.8em 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:color-mix(in srgb,var(--fg) 6%,transparent)}
hr{border:none;border-top:1px solid var(--line);margin:1.2em 0}
a{color:var(--brand)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 18px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
button{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
button:disabled{opacity:.5;cursor:default}
.who{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:14px}
.who input{width:150px;padding:8px 10px}
.done{text-align:center;padding:60px 20px}
.done .big{font-size:3rem}
.hint{color:var(--muted);font-size:13px;margin-top:6px}
.arti pre{max-height:420px}
.answered{border-left:3px solid var(--ok);padding-left:12px;color:var(--muted)}
.sentmark{color:var(--ok);font-size:13px;font-weight:600}
.q.sent{border-color:var(--ok)}
.lbl .hint{text-transform:none;letter-spacing:0;font-weight:400;font-style:normal}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:90px;background:var(--card);
  border:1px solid var(--ok);color:var(--fg);padding:12px 20px;border-radius:12px;font-size:14px;
  box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .5s;z-index:9}
.toast.bad{border-color:var(--warn)}
`;

const PAGE_JS = `
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
(function theme(){const b=$('#themeBtn');if(!b)return;b.onclick=()=>{
  const cur=document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme',cur==='dark'?'light':'dark');};})();
// Радиокнопка обязана СНИМАТЬСЯ повторным кликом: владелец вправе передумать и отвечать не на всё.
// Штатное поведение radio этого не даёт — восстанавливаем вручную (+ кнопка «сбросить» у вопроса).
(function deselectable(){
  // Ловить mousedown НА КРУЖКЕ нельзя: кликабельна вся строка <label>, и до input событие мыши
  // не доходит — снятие выбора не срабатывало (поймал владелец на пилоте). Поэтому храним
  // ПРЕДЫДУЩЕЕ состояние в самом элементе: click на radio приходит уже ПОСЛЕ того, как браузер
  // поставил галочку, значит dataset.on — это «был ли выбран до клика».
  const clear=(r)=>{r.checked=false;r.dataset.on='';};
  $$('input[type=radio]').forEach(r=>{
    r.addEventListener('click',()=>{
      if(r.dataset.on==='1'){ clear(r); return; }                       // повторный клик = снять
      [...document.getElementsByName(r.name)].forEach(o=>{o.dataset.on='';});
      r.dataset.on='1';
    });
  });
})();
function collect(){
  const docs={};
  $$('.doc').forEach(d=>{
    const p=d.dataset.doc, answers={}, artifacts={};
    $$('.q',d).forEach(q=>{
      const id=q.dataset.qid, sha=q.dataset.sha;
      const choice=(q.querySelector('input[type=radio]:checked')||{}).value||'';
      const text=(q.querySelector('.free')||{}).value||'';
      const comment=(q.querySelector('.comment')||{}).value||'';
      if(choice||text.trim()||comment.trim()) answers[id]={choice,text:text.trim(),comment:comment.trim(),sha256:sha};
    });
    $$('.art',d).forEach(a=>{
      const st=(a.querySelector('input[type=radio]:checked')||{}).value||'';
      const comment=(a.querySelector('.comment')||{}).value||'';
      if(st) artifacts[a.dataset.artid]={status:st,sha256:a.dataset.sha,comment:comment.trim()};
    });
    docs[p]={answers,artifacts};
  });
  return {docs};   // «кто отвечает» не спрашиваем: отвечает всегда владелец проекта (owner в конфиге)
}
function toast(msg,ok=true){
  const t=document.createElement('div');
  t.className='toast'+(ok?'':' bad'); t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';},2600);
  setTimeout(()=>{t.remove();},3200);
}
// ЧАСТИЧНЫЙ ОТВЕТ — штатный режим, а не исключение: владелец отвечает на то, что готов решить
// сейчас, страница остаётся живой, остальные вопросы ждут. Сервер умирает, только когда отвечено
// всё или нажато «Готово».
$('#send').onclick=async()=>{
  const payload=collect();
  const empty=Object.values(payload.docs).every(d=>!Object.keys(d.answers).length&&!Object.keys(d.artifacts).length);
  if(empty){toast('Пока нечего отправлять — выбери вариант или впиши ответ',false);return;}
  $('#send').disabled=true;$('#send').textContent='Записываю…';
  try{
    const r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(!j.ok) throw new Error(j.error||'отказ сервера');
    (j.recorded||[]).forEach(id=>{
      const card=$$('.q').find(c=>c.dataset.qid===id);
      if(card){ card.classList.add('sent'); const b=card.querySelector('.sentmark');
        if(b) b.textContent='записано ✅'; }
    });
    if(j.remaining===0){
      document.body.innerHTML='<div class="done"><div class="big">✅</div><h1>Все ответы записаны</h1>'
        +'<p>Документ, файл решения и архив обновлены. Агент продолжает работу.</p></div>';
      return;
    }
    toast('Записано. Осталось без ответа: '+j.remaining);
  }catch(e){
    toast('Не удалось записать: '+e.message,false);
  }finally{
    $('#send').disabled=false;$('#send').textContent='Записать ответы';
  }
};
$('#done').onclick=async()=>{
  if(!confirm('Закрыть страницу? Незаписанные ответы не сохранятся, к остальным вопросам вернёмся позже.'))return;
  try{await fetch('/done',{method:'POST'});}catch(e){}
  document.body.innerHTML='<div class="done"><div class="big">👋</div><h1>Закрыто</h1>'
    +'<p>Что записано — записано. К остальным вопросам агент вернётся позже.</p></div>';
};
`;

function renderQuestionCard(q) {
  const opts = q.options.map((o) => {
    const isRec = q.recommended && o.key.toLowerCase() === String(q.recommended).toLowerCase();
    return `<label class="opt"><input type="radio" name="${esc(q.id)}" value="${esc(o.key)}">` +
      `<span><strong>(${esc(o.key)})</strong> ${esc(o.label)}` +
      `${isRec ? ' <span class="badge rec">рекомендация агента</span>' : ''}</span></label>`;
  }).join('');
  const answered = q.answered
    ? `<p class="answered">Уже отвечено в документе: ${esc(q.answerText || '(см. документ)')}</p>` : '';
  return `<section class="q card" data-qid="${esc(q.id)}" data-sha="${q.sha256}">
  <div class="q-title"><span class="q-id">${esc(q.id)}</span><h2>${esc(q.heading)}</h2>
    <span class="sentmark"></span></div>
  ${q.bodyHtml}
  ${answered}
  ${opts ? `<span class="lbl">Твой выбор <em class="hint">— повторный клик снимает</em></span><div class="opts">${opts}</div>` : ''}
  <span class="lbl">Свой ответ / уточнение</span>
  <textarea class="free" rows="3" placeholder="Своими словами — если ни один вариант не подходит или хочешь добавить условие"></textarea>
  <span class="lbl">Комментарий (попадёт в документ и в архив)</span>
  <textarea class="comment" rows="2" placeholder="Необязательно"></textarea>
</section>`;
}

function renderArtifactCard(a, bytes, sha) {
  return `<section class="art card arti" data-artid="${esc(a.id)}" data-sha="${sha}">
  <div class="q-title"><span class="q-id">${esc(a.id)}</span><h2>${esc(a.target || 'исходящий артефакт')}</h2></div>
  <p class="hint">Ровно эти байты и уйдут — страница показывает файл <code>${esc(a.body_file)}</code>, хеш считается по нему (I3).</p>
  <pre><code>${esc(bytes)}</code></pre>
  <span class="lbl">Решение <em class="hint">— повторный клик снимает</em></span>
  <div class="opts">
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="approved"><span><strong>Одобрить</strong> — можно отправлять как есть</span></label>
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="rejected"><span><strong>Отклонить</strong> — с причиной ниже</span></label>
    <label class="opt"><input type="radio" name="art_${esc(a.id)}" value="edit"><span><strong>Править</strong> — что именно, ниже</span></label>
  </div>
  <span class="lbl">Причина / правка / ответ</span>
  <textarea class="comment" rows="3" placeholder="Отказ и правка тоже попадают в архив — след решений хранит и их"></textarea>
</section>`;
}

function renderPage(docs, cfg) {
  const many = docs.length > 1;
  const sections = docs.map((d) => {
    const cards = d.questions.map(renderQuestionCard).join('\n');
    const arts = (d.meta.artifacts || []).map((a) => {
      const p = path.resolve(ROOT, a.body_file);
      if (!fs.existsSync(p)) return `<section class="card"><p>⚠️ Артефакт <code>${esc(a.id)}</code>: файл <code>${esc(a.body_file)}</code> не найден.</p></section>`;
      const bytes = fs.readFileSync(p, 'utf8');
      return renderArtifactCard(a, bytes, sha256(bytes));
    }).join('\n');
    const head = many
      ? `<h2 style="margin-top:32px">${esc(d.title)}</h2><div class="path">${esc(d.relPath)}</div>` : '';
    return `<div class="doc" data-doc="${esc(d.relPath)}">${head}${cards}${arts}</div>`;
  }).join('\n');

  const first = docs[0];
  const title = many ? `Накопилось ${docs.length}: решения ждут тебя` : first.title;
  const waiting = docs.filter((d) => d.statusKind === 'waiting').length;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<header class="top">
  <div>
    <h1>${esc(title)}</h1>
    <div class="path">${esc(many ? docs.map((d) => d.relPath).join(' · ') : first.relPath)}</div>
    <p class="hint">Спрашивает ИИ-агент KrinikCam · ${new Date().toLocaleString('ru-RU')}
    ${waiting ? ` · <span class="badge wait">ждёт ответа: ${waiting}</span>` : ''}</p>
  </div>
  <button class="ghost" id="themeBtn" type="button">тема</button>
</header>
${sections}
</div>
<div class="bar">
  <span class="who">отвечает ${esc(cfg.owner)} — владелец проекта</span>
  <button id="send" type="button">Записать ответы</button>
  <button id="done" class="ghost" type="button">Готово, закрыть</button>
</div>
<p class="hint" style="text-align:center">Отвечать можно ЧАСТЯМИ: записал что решил — страница
остаётся, к остальному вернёшься позже. Повторный клик по кружку снимает выбор.</p>
<script>${PAGE_JS}</script></body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I2. ЗАПИСЬ РЕШЕНИЯ В ТРИ МЕСТА
//  (1) исходный md — его читает следующая сессия; (2) файл решения рядом — его читает гейт;
//  (3) копия в архиве с by/at — она делает архив читаемым через месяцы.
//  Имя файла решения ВЫВЕДЕНО из имени документа: общий файл затирается следующим интервью.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Строка-провенанс, которой контур подписывает КАЖДЫЙ свой ответ в документе: она же служит
// границей блока при повторном ответе (владелец вправе передумать — хвосты копиться не должны).
const PROVENANCE_RE = /^_записано контуром/u;

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

/** Вписывает ответы владельца в исходный md, не трогая ничего вокруг (документ — его артефакт). */
function writeAnswersIntoDoc(doc, answers, by, at) {
  const lines = [...doc.lines];
  const edits = [];   // {slotIndex, block:[строки], dropFollowingEmptyQuote:boolean}

  for (const q of doc.questions) {
    const a = answers[q.id];
    if (!a || q.slotIndex < 0) continue;
    const parts = [];
    if (a.choice) {
      const opt = q.options.find((o) => o.key === a.choice);
      parts.push(`**(${a.choice})**${opt ? ' ' + opt.label : ''}`);
    }
    if (a.text) parts.push(a.text);
    const answerLine = parts.join(' — ') || '(см. комментарий ниже)';
    const head = q.slotBold
      ? `${q.slotPrefix}**${q.slotLabel}:** ${answerLine}`
      : `${q.slotPrefix}${q.slotLabel}: ${answerLine}`;
    const block = [head, ''];
    if (a.comment) { block.push(...a.comment.split('\n').map((l) => `> ${l}`.trimEnd()), ''); }
    block.push(`_записано контуром \`/owner-reviews\` · by ${by} · at ${at}_`);
    edits.push({ slotIndex: q.slotIndex, block });
  }
  if (!edits.length) return { text: doc.raw, changed: 0 };

  // Идём снизу вверх, чтобы индексы выше точки правки не съезжали
  edits.sort((a, b) => b.slotIndex - a.slotIndex);
  for (const e of edits) {
    let end = e.slotIndex + 1;
    // (а) Владелец отвечает ПОВТОРНО (передумал) — съедаем прошлый блок контура целиком, до своей
    //     же провенанс-строки включительно, иначе в документе копятся хвосты старых ответов.
    let prov = -1;
    for (let i = e.slotIndex + 1; i < lines.length; i++) {
      const l = lines[i];
      if (HEADING_RE.test(l) || HR_RE.test(l) || ANSWER_SLOT_RE.test(l)) break;
      if (PROVENANCE_RE.test(l.trim())) { prov = i; break; }
    }
    if (prov >= 0) {
      end = prov + 1;
    } else {
      // (б) Первый ответ — съедаем пустую цитату-заготовку «>» под слотом (и пустые строки вокруг)
      let j = e.slotIndex + 1, lastQuote = -1;
      while (j < lines.length && (!lines[j].trim() || /^\s*>\s*$/.test(lines[j]))) {
        if (/^\s*>\s*$/.test(lines[j])) lastQuote = j;
        j++;
      }
      end = lastQuote >= 0 ? lastQuote + 1 : e.slotIndex + 1;
    }
    lines.splice(e.slotIndex, end - e.slotIndex, ...e.block);
  }

  let text = lines.join('\n');

  // Статус документа: все слоты закрыты → переводим в «отвечено» (гард ловит именно эту строку)
  const after = parseDocFromText(text, doc.path);
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

function parseDocFromText(text, absPath) {
  const tmp = path.join(os.tmpdir(), `owner-parse-${process.pid}-${Math.abs(hashInt(text))}.md`);
  fs.writeFileSync(tmp, text, 'utf8');
  try { const d = parseDoc(tmp); d.path = absPath; return d; } finally { fs.unlinkSync(tmp); }
}
const hashInt = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

function recordDecision(doc, payload, by) {
  const at = isoNow();
  const written = [];

  // (1) исходный md
  if (Object.keys(payload.answers || {}).length) {
    const { text, changed } = writeAnswersIntoDoc(doc, payload.answers, by, at);
    if (changed) { fs.writeFileSync(doc.path, text, 'utf8'); written.push(doc.relPath); }
  }

  // (2) файл решения рядом (его читает гейт)
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  const dPath = decisionPathFor(doc.relPath);
  const prev = fs.existsSync(dPath) ? JSON.parse(fs.readFileSync(dPath, 'utf8')) : {};
  const decision = {
    kind: doc.meta.kind || 'interview',
    document: doc.relPath,
    by,
    at,
    answers: { ...(prev.answers || {}), ...(payload.answers || {}) },
    artifacts: { ...(prev.artifacts || {}), ...(payload.artifacts || {}) },
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
//  I6. СИГНАЛ. Обязательный путь — ЗВУК: нативное уведомление молча глушится настройками фокуса
//  С КОДОМ УСПЕХА, а звук от них не зависит. Доставку подтверждает человек словами, не exit 0.
//  Текст в `say`/`osascript` уходит ФАЙЛОМ: кириллица в argv портится молча (канон проекта).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Тихие часы. Окно ПЕРЕСЕКАЕТ полночь — наивное from<=now<=to молчит весь день и орёт всю ночь. */
function inQuietHours(now, from, to) {
  const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const cur = now.getHours() * 60 + now.getMinutes();
  const f = mins(from), t = mins(to);
  if (f === t) return false;
  return f < t ? (cur >= f && cur < t) : (cur >= f || cur < t);   // ← вторая ветка и есть полночь
}

function signal(cfg, text, { force = false } = {}) {
  const quiet = inQuietHours(new Date(), cfg.quietHours.from, cfg.quietHours.to);
  if (quiet && !force) {
    console.log(`🔕 тихие часы ${cfg.quietHours.from}–${cfg.quietHours.to} — зову беззвучно (I6)`);
    return { quiet: true };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-signal-'));
  try {
    if (cfg.sound && fs.existsSync(cfg.sound)) spawnSync('afplay', [cfg.sound], { stdio: 'ignore' });
    if (cfg.say) {
      const f = path.join(tmpDir, 'say.txt');
      fs.writeFileSync(f, text, 'utf8');                       // текст ФАЙЛОМ, не аргументом
      spawnSync('say', ['-v', cfg.voice, '-f', f], { stdio: 'ignore' });
    }
    if (cfg.notify) {
      const scpt = path.join(tmpDir, 'notify.applescript');
      const safe = text.replace(/["\\]/g, ' ');
      fs.writeFileSync(scpt, `display notification "${safe}" with title "KrinikCam" subtitle "агент ждёт решения"\n`, 'utf8');
      spawnSync('osascript', [scpt], { stdio: 'ignore' });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { quiet: false };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  ГАРД МЕСТА ВОПРОСОВ — первый по порядку работ: ни от чего не зависит и окупается сразу
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Ищем ровно там, где вопросы РЕАЛЬНО теряются, — в директориях знаний. Канон-доки и летопись
// говорят О правиле, а не содержат живых вопросов: их скан даёт только ложные тревоги, а ложная
// тревога учит игнорировать гард (то есть хуже пропуска).
const ORPHAN_DIRS = ['plans', 'bugs', 'ideas', 'researches'];

const ORPHAN_PATTERNS = [
  { name: 'слот ответа владельца вне interviews/', re: ANSWER_SLOT_STRICT_RE },
  { name: 'явное «ждёт ответа/Криника»', re: /(?<!\p{L})жд[ёе]т\s+(?:ответа|ответов|решения|криника)(?!\p{L})/iu },
  { name: 'вопрос к владельцу', re: /(?<!\p{L})вопрос(?:ы)?\s+к\s+кринику(?!\p{L})/iu },
  { name: 'нужен ответ владельца', re: /(?<!\p{L})(?:нужен|нужны)\s+отве(?:т|ты)\s+криника(?!\p{L})/iu },
  { name: 'спросить/уточнить у владельца', re: /(?<!\p{L})(?:спросить|уточнить)\s+(?:у\s+)?криника(?!\p{L})/iu },
  { name: 'на ревю владельца', re: /(?<!\p{L})на\s+рев[ьюию]\p{L}*\s+криника(?!\p{L})/iu },
];

function loadExceptions() {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8')).exceptions || []; }
  catch { return []; }
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

function guard({ json = false } = {}) {
  const exceptions = loadExceptions();
  const excluded = (relPath) => exceptions.find((x) => x.file === relPath);

  // G1 — интервью. Главный сигнал СТРУКТУРНЫЙ (пустой слот), а не текстовый: именно текстовый
  // греп однажды промолчал, потому что `ЗАКРЫТ` совпал с «за-крыт-ие» внутри прозы.
  const hanging = [], partial = [];
  for (const f of walkMd(path.join(ROOT, 'interviews'))) {
    if (path.basename(f) === 'README.md' || f.includes(path.sep + 'decisions' + path.sep)) continue;
    const d = parseDoc(f);
    const isHanging = d.statusKind === 'waiting' || (d.statusKind === 'none' && d.slotsEmpty > 0);
    if (isHanging && !excluded(d.relPath)) hanging.push(d);
    else if (d.slotsEmpty > 0 && !excluded(d.relPath)) partial.push(d);
  }

  // G2 — вопросы-сироты вне interviews/
  const orphans = [];
  for (const dir of ORPHAN_DIRS) {
    for (const f of walkMd(path.join(ROOT, dir))) {
      const relP = rel(f);
      if (excluded(relP)) continue;
      // Тег DONE в имени файла — канонный признак ЗАКРЫТОГО документа (AGENT_GUIDE, Idea 15).
      // Вопрос внутри закрытого документа — история, а не висящий запрос. Это НЕ ослабление гарда:
      // ослабление — это подгонка шаблона, а здесь мы честно не ищем в том, что объявлено закрытым.
      if (/(?:^|[_\-])DONE(?:[_\-.]|$)/.test(path.basename(relP))) continue;
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const p of ORPHAN_PATTERNS) {
          if (p.re.test(line)) { orphans.push({ file: relP, line: i + 1, why: p.name, text: line.trim().slice(0, 120) }); break; }
        }
      });
    }
  }

  const result = { hanging: hanging.map(summary), partial: partial.map(summary), orphans, exceptions };
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.hanging.length || result.orphans.length ? 1 : 0; }

  if (!hanging.length && !orphans.length) {
    console.log('✅ гард чист: висящих вопросов нет.');
  }
  if (hanging.length) {
    console.log(`\n⏳ ЖДУТ ОТВЕТА КРИНИКА — ${hanging.length}:`);
    for (const d of hanging) {
      console.log(`   · ${d.relPath}  (вопросов без ответа: ${d.slotsEmpty}/${d.slotsTotal})`);
      console.log(`     ${d.title}`);
      console.log(`     открыть страницей:  node tools/owner.mjs ask ${d.relPath}`);
    }
  }
  if (orphans.length) {
    console.log(`\n🚨 ВОПРОСЫ ВНЕ interviews/ — ${orphans.length} (канон: место вопросов только interviews/):`);
    for (const o of orphans) console.log(`   · ${o.file}:${o.line} — ${o.why}\n     ${o.text}`);
    console.log('   Перенеси в interviews/ (навык /interview) либо впиши исключение с ПРИЧИНОЙ');
    console.log(`   в ${rel(EXCEPTIONS_FILE)} — ослаблять команду нельзя.`);
  }
  if (partial.length) {
    console.log(`\nℹ️  частично отвечены (документ объявлен закрытым, но остались пустые слоты) — ${partial.length}:`);
    for (const d of partial) console.log(`   · ${d.relPath} (пустых слотов: ${d.slotsEmpty}/${d.slotsTotal})`);
  }
  return hanging.length || orphans.length ? 1 : 0;
}

const summary = (d) => ({
  relPath: d.relPath, title: d.title, statusKind: d.statusKind,
  slotsEmpty: d.slotsEmpty, slotsTotal: d.slotsTotal, questions: d.questions.length,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I4. ГЕЙТ — стоит на стороне ПРИМЕНЕНИЯ решения и fail-closed
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const GATE_EXIT = { OK: 0, NO_DECISION: 2, NO_ANSWER: 3, REJECTED: 4, DRIFTED: 5, NO_DOC: 6 };

function gate(docArg, { question = null, artifact = null, quiet = false } = {}) {
  const abs = path.resolve(ROOT, docArg);
  const say = (s) => { if (!quiet) console.log(s); };
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
      say(`⛔ ГЕЙТ ЗАКРЫТ: текст изменился ПОСЛЕ одобрения — одобрение недействительно (I3).`);
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
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  I7. НАКОПЛЕНИЕ ДЛЯ АВТОНОМНЫХ ЦИКЛОВ — ночной цикл КОПИТ, а не встаёт
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
//  СЕРВЕР: поднялся → записал → умер. Живёт секунды-минуты, слушает только 127.0.0.1.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function ask(docArgs, cfg, { fromQueue = false, timeoutSec = cfg.timeoutSec, noOpen = false, noSignal = false } = {}) {
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

  const pending = new Set(docs.map((d) => d.relPath));

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'POST' && req.url === '/submit') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const by = cfg.owner;                 // отвечает всегда владелец проекта — не спрашиваем
          const written = [], recorded = [];
          for (const [relP, data] of Object.entries(payload.docs || {})) {
            if (!docs.find((d) => d.relPath === relP)) continue;
            if (!Object.keys(data.answers || {}).length && !Object.keys(data.artifacts || {}).length) continue;
            // ВАЖНО для частичных ответов: документ перечитываем С ДИСКА. Модель, снятая при
            // рендере страницы, после первой записи протухает, и вторая запись затёрла бы первую.
            const fresh = parseDoc(path.resolve(ROOT, relP));
            const r = recordDecision(fresh, data, by);
            written.push(...r.written);
            recorded.push(...Object.keys(data.answers || {}), ...Object.keys(data.artifacts || {}));
            console.log(`\n✅ записано (${by}, ${isoNow()}): ${Object.keys(data.answers || {}).join(', ')}`);
            r.written.forEach((w) => console.log(`   · ${w}`));
          }
          // Сколько вопросов ещё без ответа — считаем ПО ДИСКУ, а не по памяти страницы
          const remaining = docs.reduce((n, d) => n + parseDoc(path.resolve(ROOT, d.relPath)).slotsEmpty, 0);
          docs.forEach((d) => { if (parseDoc(path.resolve(ROOT, d.relPath)).slotsEmpty === 0) pending.delete(d.relPath); });
          if (fromQueue) writeQueue(readQueue().filter((i) => pending.has(i.doc)));

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, written, recorded, remaining }));

          if (remaining === 0) {
            console.log('\n🎉 отвечено всё — контур закрывается.');
            setTimeout(() => { server.close(); process.exit(0); }, 400);
          } else {
            console.log(`⏳ без ответа осталось вопросов: ${remaining} — страница живёт дальше.`);
          }
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
      setTimeout(() => { server.close(); process.exit(0); }, 300);
      return;
    }
    res.writeHead(404); res.end('404');
  });

  const port = await listenFree(server, cfg.port);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`📄 страница: ${url}`);
  console.log(`   (копия на диске: ${rel(pagePath)})`);
  for (const d of docs) console.log(`   · ${d.relPath} — вопросов: ${d.questions.length}`);

  // I5 — зовём ТОЛЬКО после того, как страница реально поднялась и открыта
  if (!noOpen) spawnSync('open', [url], { stdio: 'ignore' });
  if (!noSignal) {
    const text = docs.length > 1
      ? `Криник, накопилось ${docs.length} решений. Страница открыта в браузере.`
      : `Криник, агент ждёт твоего решения: ${docs[0].title}. Страница открыта в браузере.`;
    signal(cfg, text);
  }
  console.log(`⏳ жду ответ (таймаут ${timeoutSec} с). Ответ НИКОГДА не самоодобряется по таймауту (I4).`);

  return new Promise((resolve) => {
    const t = setTimeout(() => {
      console.log('⏱️  ответа не дождались. Решения НЕТ — гейт остаётся закрытым.');
      server.close(); resolve(7);
    }, timeoutSec * 1000);
    server.on('close', () => clearTimeout(t));
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
  const at = (h, m = 0) => { const d = new Date(2026, 0, 15, h, m); return d; };
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

  // T3. Нормализация одна на обе стороны (I3): разный «мусор» — один хеш; иной текст — иной хеш
  const a = 'Текст вопроса\r\nвторая строка   \n\n';
  const b = '\n\nТекст вопроса\nвторая строка\n';
  ok('нормализация: CRLF/хвосты/пустые строки не меняют sha', sha256(a) === sha256(b), sha256(a).slice(0, 12));
  ok('нормализация: правка текста МЕНЯЕТ sha', sha256(a) !== sha256(a.replace('вторая', 'третья')));

  // T4. Гард обязан покраснеть на заведомо висящем документе и на вопросе-сироте
  const sandbox = path.join(PAGES_DIR, '.selftest');
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
  const hangingDoc = path.join(sandbox, 'interview_999_selftest.md');
  fs.writeFileSync(hangingDoc, [
    '# Интервью 999 — самотест гарда',
    '',
    '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА',
    '',
    '## В1. Заведомо висящий вопрос?',
    '',
    '| # | Вариант | Смысл |',
    '|---|---|---|',
    '| **(а)** | Первый | раз |',
    '| **(б)** | Второй | два |',
    '',
    '**Ответ Криника:**',
    '',
    '>',
    '',
  ].join('\n'), 'utf8');
  const d = parseDoc(hangingDoc);
  ok('разбор: вопрос найден', d.questions.length === 1, `найдено ${d.questions.length}`);
  ok('разбор: варианты найдены', d.questions[0]?.options.length === 2);
  ok('разбор: пустой слот распознан', d.slotsEmpty === 1);
  ok('разбор: статус = ждёт', d.statusKind === 'waiting');

  // T4b. РЕГРЕССИЯ на живом дефекте: интервью 006 пишет слот как «- Ответ Криника:» без жирного.
  // Узкий шаблон давал по такому документу 0 вопросов и 0 пустых слотов — то есть висящее интервью
  // было бы НЕВИДИМО и для страницы, и для гарда. Самый опасный класс: молчаливый пропуск.
  const looseDoc = path.join(sandbox, 'interview_998_loose_slot.md');
  fs.writeFileSync(looseDoc, [
    '# Интервью 998 — слот ответа без жирного начертания',
    '',
    '> Статус: **❓ НА РЕВЮ КРИНИКА**',
    '',
    '## Вопросы',
    '',
    '- Нужен ли поворот содержимого слоя?',
    '- Ответ Криника:',
    '',
    '- Второй вопрос — оставляем ли снаппинг?',
    '- Ответ Криника:',
    '',
  ].join('\n'), 'utf8');
  const loose = parseDoc(looseDoc);
  ok('регрессия 006: слот «- Ответ Криника:» распознан', loose.slotsTotal === 2, `найдено ${loose.slotsTotal}`);
  ok('регрессия 006: документ виден гарду как висящий', loose.slotsEmpty === 2 && loose.statusKind === 'waiting');
  const looseWritten = writeAnswersIntoDoc(loose, { 'В1': { choice: '', text: 'да, нужен', comment: '' } }, 'Криник', isoNow()).text;
  ok('регрессия 006: форма слота сохранена (не превратилась в жирную)',
    /^- Ответ Криника: да, нужен/m.test(looseWritten));

  // T5. Гейт fail-closed по всем четырём причинам отказа
  const decisionPath = decisionPathFor(rel(hangingDoc));
  fs.rmSync(decisionPath, { force: true });
  ok('гейт: решения нет → отказ', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.NO_DECISION);

  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  fs.writeFileSync(decisionPath, JSON.stringify({
    kind: 'interview', document: rel(hangingDoc), by: 'selftest', at: isoNow(),
    answers: { 'В1': { choice: 'а', text: '', comment: '', sha256: d.questions[0].sha256 } },
  }, null, 2), 'utf8');
  ok('гейт: ответ есть и текст не менялся → открыт', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.OK);

  // Правку вносим в ТЕЛО вопроса (не после слота ответа): хеш стережёт формулировку вопроса,
  // а дописка ниже слота его законно не трогает — иначе сам ответ ломал бы свой же хеш.
  fs.writeFileSync(hangingDoc,
    fs.readFileSync(hangingDoc, 'utf8').replace('## В1. Заведомо висящий вопрос?',
      '## В1. Заведомо висящий вопрос? (формулировка изменена после ответа)'), 'utf8');
  const drifted = parseDoc(hangingDoc);
  const sameSha = drifted.questions[0].sha256 === d.questions[0].sha256;
  ok('гейт: текст изменился после ответа → ОТКАЗ (I3)',
    !sameSha && gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.DRIFTED);

  fs.writeFileSync(decisionPath, JSON.stringify({
    kind: 'interview', document: rel(hangingDoc), by: 'selftest', at: isoNow(),
    answers: { 'В1': { status: 'rejected', choice: '', sha256: drifted.questions[0].sha256 } },
  }, null, 2), 'utf8');
  ok('гейт: отклонено владельцем → отказ', gate(rel(hangingDoc), { quiet: true }) === GATE_EXIT.REJECTED);

  // T6. Запись ответа в md — и sha после записи всё ещё сходится (иначе гейт закрылся бы сам собой)
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

  // T6b. ЧАСТИЧНЫЙ и ПОВТОРНЫЙ ответ (поймано владельцем на пилоте 2026-07-31): отвечать можно
  // не на всё сразу, а передумав — переписать ответ, не накапливая хвосты прошлых записей.
  const partDoc = path.join(sandbox, 'interview_997_partial.md');
  fs.writeFileSync(partDoc, [
    '# Интервью 997 — частичный ответ', '', '**Статус:** ⏳ ЖДЁТ ОТВЕТА КРИНИКА', '',
    '## В1. Первый вопрос?', '', '**Ответ Криника:**', '', '>', '', '---', '',
    '## В2. Второй вопрос?', '', '**Ответ Криника:**', '', '>', '',
  ].join('\n'), 'utf8');
  let p1 = parseDoc(partDoc);
  fs.writeFileSync(partDoc, writeAnswersIntoDoc(p1, { 'В1': { choice: '', text: 'только первый', comment: '' } }, 'Криник', isoNow()).text, 'utf8');
  const afterPart = parseDoc(partDoc);
  ok('частичный ответ: закрыт ровно один слот', afterPart.slotsEmpty === 1 && afterPart.slotsTotal === 2);
  ok('частичный ответ: статус НЕ переведён в «отвечено» (вопрос ещё висит)',
    afterPart.statusKind === 'waiting');
  ok('частичный ответ: второй вопрос остался пустым и виден гарду',
    afterPart.questions[1] && !afterPart.questions[1].answered);
  // передумал: отвечаем на В1 второй раз
  fs.writeFileSync(partDoc, writeAnswersIntoDoc(afterPart, { 'В1': { choice: '', text: 'нет, вот так', comment: 'передумал' } }, 'Криник', isoNow()).text, 'utf8');
  const reText = fs.readFileSync(partDoc, 'utf8');
  ok('повторный ответ: заменил прошлый, а не удвоил', (reText.match(/_записано контуром/g) || []).length === 1);
  ok('повторный ответ: старый текст исчез, новый на месте',
    !/только первый/.test(reText) && /нет, вот так/.test(reText));
  ok('повторный ответ: второй вопрос по-прежнему не тронут', parseDoc(partDoc).slotsEmpty === 1);

  // T7. Рендер страницы — самодостаточность (ни одной внешней загрузки)
  const page = renderPage([doc2], loadConfig());
  ok('страница: нет внешних загрузок', !/(https?:)?\/\/(?!127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/i.test(page.replace(/<a href="[^"]*"/g, '')));
  ok('страница: обе темы описаны', page.includes('prefers-color-scheme') && page.includes('data-theme=dark'));
  ok('страница: варианты отрисованы', /type="radio"/.test(page));

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(decisionPath, { force: true });

  console.log(failed ? `\n❌ SELFTEST: провалено проверок — ${failed}` : '\n✅ SELFTEST: все проверки зелёные (и каждый гард умеет краснеть)');
  return failed ? 1 : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const HELP = `
tools/owner.mjs — контур согласований «агент ↔ владелец» (KAIF 2.1, /owner-reviews)

  node tools/owner.mjs guard [--json]        показать ВСЕ висящие вопросы (exit 1, если есть)
  node tools/owner.mjs render <док.md>       собрать страницу, не открывая и не зовя
  node tools/owner.mjs ask <док.md> [...]    страница + браузер + звук/голос, ждать ответ
  node tools/owner.mjs gate <док.md> [--q В1 | --artifact <id>]
                                             fail-closed проверка перед зависимой работой
  node tools/owner.mjs queue <док.md>        припарковать для автономного цикла (не блокируя)
  node tools/owner.mjs inbox                 одна страница на всю накопленную пачку
  node tools/owner.mjs selftest              доказать, что каждый гард умеет краснеть

  Флаги ask/inbox: --timeout <сек> (деф. 3600) · --no-open · --no-signal
  Настройки: tools/owner.config.json (голос, звук, тихие часы, порт, владелец)
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  const flag = (name) => rest.includes(name);
  const val = (name, def) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] ? rest[i + 1] : def; };
  const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--timeout', '--q', '--artifact'].includes(rest[i - 1])));

  switch (cmd) {
    case 'guard':
      process.exit(guard({ json: flag('--json') }));
      break;
    case 'render': {
      if (!positional[0]) { console.error('нужен путь к документу'); process.exit(1); }
      const doc = parseDoc(path.resolve(ROOT, positional[0]));
      fs.mkdirSync(PAGES_DIR, { recursive: true });
      const out = path.join(PAGES_DIR, `${path.basename(doc.relPath).replace(/\.md$/, '')}.html`);
      fs.writeFileSync(out, renderPage([doc], cfg), 'utf8');
      console.log(`📄 ${rel(out)}  (вопросов: ${doc.questions.length}, пустых слотов: ${doc.slotsEmpty}/${doc.slotsTotal}, статус: ${doc.statusKind})`);
      break;
    }
    case 'ask': {
      if (!positional.length) { console.error('нужен путь к документу'); process.exit(1); }
      const code = await ask(positional, cfg, {
        timeoutSec: Number(val('--timeout', cfg.timeoutSec)),
        noOpen: flag('--no-open'), noSignal: flag('--no-signal'),
      });
      process.exit(code);
      break;
    }
    case 'inbox': {
      const items = readQueue();
      if (!items.length) { console.log('📭 очередь пуста — владельца звать не за чем.'); process.exit(0); }
      const code = await ask(items.map((i) => i.doc), cfg, {
        fromQueue: true, timeoutSec: Number(val('--timeout', cfg.timeoutSec)),
        noOpen: flag('--no-open'), noSignal: flag('--no-signal'),
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
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
