#!/usr/bin/env node
// texts.mjs — the LOCALIZED DATA of the shipped interactive contour (KAIF 2.6, epic IC; plans/93 IC3).
// [TESTED: 2026-09-05 · `review.mjs --selftest`: RU/EN dictionaries resolve, an unknown language falls back to EN and
//  is announced; s22 on a ru deployment: page lang=ru, button «Записать решение», chip «рекомендую», queue line
//  «НИ РАЗУ НЕ ПОКАЗАН»; check-framework guard 5d green with this file named as a data carrier]
//
// This file is a DATA CARRIER: every string an owner reads on the page or hears in the call, every
// label the parser must recognise in the owner's documents (answer labels, comment labels, status
// words, option letters), and the month names of the human-readable provenance — for each language
// the contour ships. Nothing here executes; the generator (`review.mjs`) and its core (`core.mjs`)
// stay free of any non-Latin script, so the payload guard (check-framework 5d) keeps judging them
// as machinery and excuses THIS file by name as data (like kaif-scenario-lint's RU keywords).
//
// Language is READ from the deployment marker (`.kaif/kaif.json` → `language`, owner rule #97:
// parameters are never asked); a language without a dictionary here falls back to English, which
// the page then says out loud in its header so the owner knows why the texts are not theirs.
//
// Adding a language = adding one object below with the same keys as `en`; `texts()` fills any
// missing key from `en`, so a partial dictionary never breaks the page — it only mixes languages.

// ── Parser vocabulary — what the owner's documents may say (both scripts, all languages) ─────────
// The parser reads a project's living documents. Labels are recognised in BOTH the shipped
// languages at once (a project may hold RU interviews and EN homework side by side), so these are
// alternations, not per-language switches. Unicode letter classes, never \b (JS \b is ASCII-only).
export const PARSER = {
  // option letters in list form `- **A)** …` and table form `| **A** | … |`
  letters: 'A-ZА-Я',
  // OW3 (2.8, #86): the words by which a document's STATUS BLOCK says its answers await application — the field's own proven matcher
  awaitingApplication: 'awaiting application|ждут\\s+внесения|ждёт\\s+внесения|ждет\\s+внесения',
  // question heading prefixes: `### Q1.` (EN) · `### В1.` (RU)
  questionPrefixes: 'Q|В',
  // a heading that LOOKS like a question but is not in the form above (QL1, origin #56): `### Question 3` · `### Вопрос 3`
  questionWords: 'Question|Вопрос',
  // 2.9, epic CP (origin issue #124): a BACKWARD or SIDEWAYS reference that sends the owner out of the question for its own content.
  // Russian: the field project's pattern, its standing rule for six weeks (issue #124, verbatim), with a forward «см. ниже» left
  // legal; English: its mirror. A forward reference ("options below") is legal by the owner's word in the ticket.
  // The light judges of epic CP, F3 and N2: «выше» / "above" is a REFERENCE unless a comparison follows it — a number or «чем» / "than"
  // («нагрузка выше 80%», «B выше, чем A», "above 80%" stay legal; «формула выше», «в таблице выше», "the list above", «как указано выше»
  // refuse); «см. <…> ниже» (forward) and «см. также» / "see also" (a reference NEXT to the content) stay legal.
  refBack: '(?<!\\p{L})(?:выше(?!\\p{L})(?!\\s*,?\\s*(?:чем(?!\\p{L})|[\\d~≈<>]|на\\s+\\d|в\\s+\\d))|вон\\s+т[оеа]\\p{L}*|в\\s+разделе|в\\s+шапке|см\\.\\s(?!(?:[\\p{L}\\d«»"\'-]+\\s+){0,3}?ниже)(?!также)|above(?!\\p{L})(?!\\s*(?:than(?!\\p{L})|[\\d~<>]|by\\s+\\d))|see\\s+(?:§|the\\s+section|section)|in\\s+the\\s+(?:section|header)|§\\s?\\d)',
  originLabels: 'Origin|Источник|Родитель',
  // the answer field label: `**Answer:**` · `**Ответ:**` · `**Ответ владельца:**`
  answerLabels: 'Answer|Ответ(?:\\s+владельца)?',
  // a counter-question is NOT an answer (contract C4 rule 2)
  counterQuestion: 'встречн\\p{L}*\\s+вопрос|counter-?question',
  // an owner's comment under an empty answer is NOT the answer text (pilot 008)
  commentLabels: 'Комментарий\\s+владельца|Owner\'?s\\s+comment',
  // where the answer goes back to (may list several addressees, one per line)
  targetLabels: 'Адресат\\s+ответа|Answer\\s+target|Addressee',
  // the agent's recommendation in prose — its letter is shown ON the option as a chip
  recommendLabels: 'Рекомендация\\s+агента|Agent\'?s?\\s+recommendation',
  // status line of the document head (`> Status:` / `> **Статус:**`)
  statusLabels: 'Status|Статус',
  // 2.9, epic CP (origin #109, #121 R3): an EXPLICIT closing word at the START of the status value (after an optional mark and bold) closes
  // the document even when an explanation after it carries a negation («✅ ЗАКРЫТО — ВОПРОС СНЯТ АГЕНТОМ, А НЕ ОТВЕЧЕН ВЛАДЕЛЬЦЕМ»); the
  // project's own closed words — «перенесено», «СНЯТО», WITHDRAWN — were read as a LIVE document and stood in the owner's queue
  statusClosedWord: '^\\s*(?:[✅⛔➡🟢]\\uFE0F?\\s*)?\\*{0,2}\\s*(?:CLOSED|WITHDRAWN|MOVED|ЗАКРЫТ[ОАЫ]?|СНЯТ[ОАЫ]?|ПЕРЕНЕС[ЕЁ]Н[ОАЫ]?)(?!\\p{L})',
  statusClosed: '✅|🟢|STATUS:\\s*DONE|ANSWERS\\s+RECEIVED|ОТВЕЧЕНО',
  statusWaiting: '🟡|awaiting|ждёт\\s+ответ|ожидает\\s+ответ',
  // (the light re-judge of epic CP, F5) on a line that opens with a closing word the document waits only for an UNNEGATED waiting marker
  // («больше не ждёт ответа», "no longer awaiting" close) or a NOT-YET mark («Q2 — ещё не отвечен»); a bare «не отвечен» still closes —
  // a question withdrawn by the agent is written that way.
  statusWaitingNegation: '(?:(?<!\\p{L})не|\\bnot|\\bno\\s+longer|\\bno)',
  statusPending: '(?<!\\p{L})(?:ещ[её]|пока)\\s+не(?!\\p{L})|\\bnot\\s+yet\\b|\\bno\\b[^.]{0,40}\\byet\\b',
  // negation outranks the tick (bugs/70): «пока НЕ отвечено», "no answers yet", "not answered"
  statusNegation: '(?<!\\p{L})не\\s*отвечен|неотвечен|(?<!\\p{L})пока\\s+не(?!\\p{L})|(?<!\\p{L})ещё\\s+не(?!\\p{L})|\\bno\\b[^.]{0,40}\\byet\\b|\\bnot\\b[^.]{0,40}\\banswer',
  // the declared free field of a question with no options (naming / taste questions)
  freeFieldMarker: '<!--\\s*(?:questions-guard:no-scenario|contour:free-field)\\s+\\S',
  // the owner row of the identity table in AGENT_GUIDE.md — default for `contour.ownerName`
  identityOwnerLabels: 'Author\\s*/\\s*owner|Автор\\s*/\\s*владелец',
  // headings of the questions section, dropped from the prose render (cards are the only form)
  questionsSectionHeadings: 'QUESTIONS|Вопросы',
  // the CREATION line of the document head (`> Created: …` · `> **Создан:** …`) — the archaeology axis
  // (AQ 2.7) takes the document's date from it, so an ANSWER date standing above never ages a document
  // forward and an old interview stays silent.
  createdLabels: 'Created|Создан\\p{L}*|Дата\\s+создания',
  // AQ (2.7, origin issue #70): words the grep command of a question heading drops — pure function
  // words of both shipped languages. The pick is machine (letters, length, this list), never a
  // judgement about nouns: a stop list is data a project can read, an opinion is not.
  archaeologyStopWords: [
    'чтобы', 'какой', 'какая', 'какое', 'какие', 'когда', 'нужно', 'нужен', 'нужна', 'надо', 'ли',
    'если', 'или', 'этот', 'этого', 'этом', 'эта', 'это', 'эти', 'там', 'тоже', 'также', 'так',
    'быть', 'будет', 'было', 'есть', 'делаем', 'делать', 'берём', 'брать', 'можно', 'нельзя',
    'сейчас', 'потом', 'после', 'перед', 'между', 'через', 'вместо', 'кроме', 'себя', 'свой',
    'своя', 'своё', 'свои', 'него', 'them', 'that', 'this', 'these', 'those',
    'with', 'without', 'from', 'into', 'onto', 'over', 'under', 'after', 'before', 'between',
    'what', 'which', 'when', 'where', 'whom', 'whose', 'should', 'shall', 'would', 'could',
    'does', 'done', 'will', 'have', 'been', 'being', 'make', 'made', 'take', 'takes', 'keep',
    'instead', 'about', 'also', 'else', 'than', 'then', 'they', 'your', 'ours', 'only', 'ever',
    // добавлено первым функциональным прогоном оси (2026-09-18): команда по живому вопросу соседнего
    // развёртывания несла «выше», «того», «первы», «перва» — служебные слова заголовка, не предмет.
    'выше', 'ниже', 'того', 'тому', 'тогда', 'потому', 'первый', 'первая', 'первое', 'первые',
    'первыми', 'второй', 'вторая', 'третий', 'каждый', 'каждая', 'каждое', 'самый', 'самая',
    'above', 'below', 'first', 'second', 'third', 'again', 'still',
  ].join('|'),
};

// ── Owner-facing dictionaries ────────────────────────────────────────────────────────────────
const EN = {
  lang: 'en',
  months: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],
  // written back into the source md (the next session reads it; the parser recognises both scripts)
  wb: {
    followUp: (atHuman) => 'Answer (follow-up, ' + atHuman + '):',
    ownerComment: (atHuman) => "Owner's comment (" + atHuman + '):',
    proofread: (atHuman) => "Owner's proofreading comments (" + atHuman + '):',
    recovered: "picked up from the owner's computer", // LP (#66): the provenance comment says the answer came from the local save
  },
  kind: { interview: 'interview', homework: 'homework', document: 'document', notice: 'notice',
    queue: 'queue', proofread: 'proofreading', mockup: 'mockup review' },
  tag: { answered: 'answered', unanswered: 'no answer', you: 'waits for you', allAnswered: 'all answered',
    answeredN: (n) => 'answered ' + n, waitN: (n) => 'waiting for you ' + n, rec: 'recommended',
    noAnswerNote: 'no answer owed', noBody: 'no body', outbound: 'outbound' },
  head: { questions: 'Questions', noQuestions: 'The document has no questions — you can leave a comment on the whole.',
    outbound: 'Outbound — your decision is needed', docComment: 'Comment on the document as a whole',
    optComment: 'Comment (optional)', paragraphs: 'Paragraphs — a comment field under each',
    mockup: 'Mockup — your comments', noticeGroup: 'Notices — no answer owed',
    accumulated: 'Accumulated', queueEmpty: 'The queue is empty — nothing to answer.',
    archive: (n) => 'Archive of the settled — ' + n + ' answered question(s) and the document text (nothing removed)',
    noPending: 'No unanswered questions — the document waits by status.',
    langFallback: (lang) => 'texts in English — no dictionary for "' + lang + '" ships yet' },
  count: { docs: (n) => n + ' document(s)', questions: (n) => n + ' unanswered question(s)',
    notices: (n) => n + ' unread notice(s)', pendingQ: (n) => n + ' question(s) without an answer',
    waitsByStatus: 'waits by status', unread: 'unread', open: 'open →' },
  ph: { own: 'Your own option or the answer text', comment: 'Comment', addComment: 'Add a comment — your answer stays as it is',
    docComment: 'You may leave no answers — just say it', noticeComment: (btn) => 'You may write nothing — the "' + btn + '" mark is enough',
    paragraph: 'Comment on this paragraph', mockup: 'What to change on the mockup',
    noRemarks: 'No remarks — just press Done: that is a recorded verdict too',
    artComment: 'What to fix (when rejecting — by meaning, or the agent will not know what to change)' },
  btn: { reloadRev: 'Open the new revision', save: 'Save decision', saveDoc: 'Save decisions for this document', read: 'OK, read', done: 'Done',
    copy: 'Copy', retry: 'Retry saving', approve: '<strong>Approve</strong> — send as is',
    reject: '<strong>Reject</strong> — do not send' },
  art: { goesOut: 'Goes out', missing: (file) => 'File <code>' + file + '</code> not found — nothing to approve. This is a defect, not your choice.',
    bytes: 'bytes' },
  st: { draft: (n) => 'Draft picked up: ' + n + ' field(s) restored from the browser', saving: 'Saving…',
    saved: (w) => 'Saved: ' + w + '. The window will close by itself…', nothing: 'Nothing to save: no answer, no comment',
    noRemarksWritten: 'no remarks',
    needArt: 'A decision on the outbound is needed: approve or reject', err: (m) => 'SAVE ERROR: ' + m,
    serverGone: 'THE CONTOUR SERVER IS UNREACHABLE — the answer will NOT be sent. The draft is kept in the browser; copy the text (button below) or restart the contour.',
    // LP (2.7, origin issue #66): with the window's own profile in the project the answer survives the server — no dialog, no choice
    serverGoneLocal: 'The contour server is unreachable — keep writing and press Save as usual: the answer is saved on this computer, in the project folder, and the agent will pick it up.',
    savedLocally: 'The server is unreachable — your answer is saved on this computer (in the project folder); the agent will pick it up. You can close the window.',
    // CP (2.9, origin issue #125): a long message goes to the bar above the page (it keeps the Save column free); the pill under the
    // button carries a short label only — a pill six lines tall covered the document's title
    savedLocallyShort: 'Saved on this computer', pillOk: 'Details in the bar above', pillErr: 'Attention — see the bar above',
    closeYourself: 'The browser refused to close the window — please close it yourself',
    // OW6 (2.8): answers are saved one at a time — the page stays; a save against another revision of the document is refused
    left: (n) => 'Saved. Questions left: ' + n + ' — the page stays open; answer the rest now or later.',
    stale: 'The document was CHANGED after this page opened — this answer was NOT saved. Your text is below; open the new revision: drafts of unchanged questions come back.',
    rewritten: 'The document was rewritten after this page opened — saving here is off. Open the new revision:',
    orphan: 'Draft of a previous revision — these questions changed or are gone; your text is kept here:',
    duplicate: 'already recorded',
    copied: 'Copied to the clipboard', copyManually: 'Select and copy by hand',
    rescue: 'Saving failed — your text is below, it is not lost.', noticeHint: 'Without the mark the notice comes back.',
    selfcheck: (r, q) => 'PAGE SELF-CHECK FAILED: ' + r + ' radio group(s) for ' + q + ' question(s) — the form is broken, do not answer here; tell the agent.',
    tabnote: 'This page opened as a TAB in a browser, not in the contour\'s own window — your draft lives in this tab only: do not close it until you have saved. The agent has been told (I26).' },
  // the call — the human decides "go now or after" BEFORE reading the page, so it names class and numbers
  call: {
    notice: (o, p, title) => o + ', a ' + p + ' notice: "' + title + '" — no answer owed, just read it. The page is open.',
    batch: (o, p, parts) => o + ', accumulated in ' + p + ': ' + parts.join(', ') + '. The page is open.',
    interview: (o, p, kind, title, nWait) => o + ', ' + p + ' ' + kind + ' "' + title + '" awaits your review' +
      (nWait ? ': questions without an answer ' + nWait : '') + '. The page is open.',
    proofread: (o, p, title) => o + ', ' + p + ' asks for proofreading: "' + title + '". The page is open.',
    mockup: (o, p, title) => o + ', ' + p + ' asks you to look at a mockup: "' + title + '". The page is open.',
    from: (s) => 'this is ' + s, // OW4 (2.8, #98): «<owner>, this is <session>. …»
    parts: { docs: (n) => 'documents ' + n, questions: (n) => 'questions without an answer ' + n, notices: (n) => 'unread notices ' + n },
  },
  // OW4 (2.8, #98): how the voice says a session's name — known words and numbers; an unknown word stays as written
  spoken: { words: [], // pairs [written, spoken] — a dictionary, not a schema: the pack's array is taken whole
    ones: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
    tens: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] },
  // the queue without a browser (`--queue --list`) — read by the agent, quoted by the rituals
  list: { waits: (d) => 'waiting ' + d + ' d', shown: (date, ago, t) => 'shown: ' + date + ' — ' + ago + ' d ago (' + t + ')',
    never: 'NEVER SHOWN — the owner does not know this question exists', empty: "The owner's queue is empty — no waiting documents.",
    gate: (n) => 'GATE (I42): never shown — ' + n + '. Printing the queue is not delivering the question; showing is the agent\'s action.',
    how: (cmd) => 'Raise it as a page: ' + cmd + ' --queue · asked it pointedly in chat — record the fact: ' + cmd + ' --mark-shown <doc> --transport chat',
    dead: 'A dead document with nothing to show → close it by status and it leaves the queue.',
    awaiting: (n) => 'OWNER DECISIONS AWAIT APPLICATION — ' + n + ': every question answered, the status not closed. Apply them FIRST, ahead of the plan (#86), then close the status.',
    answered: (d) => 'answered ' + d + ' d ago',
    foreign: (f) => 'the project keeps its own queue: ' + f + ' is not this contour\'s shape — read as no items here and never written; its waiting documents are raised by the project\'s own contour (see HOUSE_RULES.md), the interviews are still scanned',
    foreignWrite: (f) => 'not written: ' + f + ' is the project\'s own queue (another shape) — this contour never overwrites it; raise the document with the project\'s own contour',
    stale: (doc, d, lim, cmd) => 'stale in the queue (' + d + ' d > ' + lim + '): ' + doc + ' — not in the list above; close it by status or show it on purpose: ' + cmd + ' --queue --include-stale' },
  transport: { page: 'page', batch: 'batch', chat: 'chat' },
  // the FOURTH fact — implemented (2.7 QL2, origin issue #54: an already-implemented question was raised again and produced a false second decision)
  impl: {
    marked: (doc, q, where, file) => 'Implemented recorded (I44): ' + doc + ' ' + q + ' → ' + where + ' → ' + file,
    gate: (doc, ids) => 'implemented, but open: ' + doc + ' ' + ids.join(', ') + ' → close the status (or fill the answer); an implemented question is never raised again (I45)',
    badge: (where, date) => 'implemented → ' + where + ' (' + date + ')',
    withdrawnBadge: (why, date) => 'withdrawn — ' + why + ' (' + date + ')',
    withdrawn: (doc, q, why, file) => 'Withdrawn recorded: ' + doc + ' ' + q + ' — ' + why + ' → ' + file + ' (the question became moot; never an answer on the owner\'s behalf)',
    answeredNotWithdrawn: (doc, q) => doc + ' ' + q + ' is ANSWERED by the owner — only an open question is withdrawn; nothing recorded',
    noSuch: (doc, q, ids) => 'no question ' + q + ' in ' + doc + ' — known: ' + (ids.join(', ') || '(none)'),
  },
  // `--check <doc>` — the form check WITHOUT a page (2.7 QL1, origin issue #56: the only check was the show, and the show is the call)
  check: {
    summary: (doc, n, ids) => 'check: ' + doc + ' — blocks ' + n + ', recognised ' + ids.length + (ids.length ? ': ' + ids.join(', ') : ''),
    unrecognised: (n) => 'not recognised: ' + n + ' block(s) look like questions but are not in the form `### Q<n>.` — the page would open WITHOUT them:',
    line: (l, text) => '  line ' + l + ': ' + text,
    counts: (w, a) => 'unanswered ' + w + ', answered ' + a,
    // AQ (2.7, origin issue #70): the door says what it judged AND what it did not — a silent axis
    // that never says "not judged" reads as a green one (the bug-34 class).
    archaeology: (n, m, ex) => 'archaeology: ' + n + ' of ' + m + ' live question(s) attested'
      + (ex ? ' (' + ex + ' exempt: declared n/a)' : ''),
    archaeologyOld: (date, since) => 'archaeology: not judged — header date '
      + (date ? date : 'none') + ' is before ' + since + ' (the axis judges forward; old documents stay silent)',
    ok: 'check OK — the page may open; nothing was shown and nobody was called (--check never serves).',
    refused: 'check REFUSED (exit 3) — fix the form before any page opens; nothing was shown and nobody was called.',
    partial: (n) => 'WARNING: ' + n + ' block(s) look like questions but are not recognised — the page opens WITHOUT them (run --check to see which).',
    partialHead: (n) => 'not recognised: ' + n + ' question-like block(s) — not on this page',
  },
};

const RU = {
  lang: 'ru',
  months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  wb: {
    followUp: (atHuman) => 'Ответ (дополнение, ' + atHuman + '):', // CP (2.9, #127 p. 2): the label in the document's language
    ownerComment: (atHuman) => 'Комментарий владельца (' + atHuman + '):',
    proofread: (atHuman) => 'Замечания владельца по вычитке (' + atHuman + '):',
    recovered: 'забран с компьютера владельца', // LP (#66): комментарий провенанса называет, что ответ пришёл из локальной записи
  },
  kind: { interview: 'интервью', homework: 'домашка', document: 'документ', notice: 'сообщение',
    queue: 'очередь', proofread: 'вычитка', mockup: 'отсмотр макета' },
  tag: { answered: 'отвечено', unanswered: 'без ответа', you: 'ждёт вас', allAnswered: 'все отвечены',
    answeredN: (n) => 'отвечено ' + n, waitN: (n) => 'ждут вас ' + n, rec: 'рекомендую',
    noAnswerNote: 'ответа не ждёт', noBody: 'тела нет', outbound: 'исходящее' },
  head: { archive: (n) => 'Архив решённого — ' + n + ' отвеченных вопрос(ов) и текст документа (ничего не удалено)',
    questions: 'Вопросы', noQuestions: 'Вопросов в документе нет — можно оставить общий комментарий.',
    outbound: 'Исходящее — нужно ваше решение', docComment: 'Комментарий по документу целиком',
    optComment: 'Комментарий (по желанию)', paragraphs: 'Абзацы — поле замечания под каждым',
    mockup: 'Макет — ваши замечания', noticeGroup: 'Сообщения — ответа не ждут',
    accumulated: 'Накопилось', queueEmpty: 'Очередь пуста — отвечать нечего.',
    noPending: 'Неотвеченных вопросов нет — документ ждёт статусом.',
    langFallback: (lang) => 'тексты по-английски — словаря для «' + lang + '» в поставке пока нет' },
  count: { docs: (n) => n + ' документ(ов)', questions: (n) => n + ' неотвеченных вопрос(ов)',
    notices: (n) => n + ' непрочитанных сообщени(й)', pendingQ: (n) => n + ' вопрос(ов) без ответа',
    waitsByStatus: 'ждёт статусом', unread: 'не прочитано', open: 'открыть →' },
  ph: { own: 'Свой вариант или текст ответа', comment: 'Комментарий', addComment: 'Дополнить комментарием — ваш ответ останется как есть',
    docComment: 'Можно без ответов — просто сказать', noticeComment: (btn) => 'Можно ничего не писать — достаточно пометки «' + btn + '»',
    paragraph: 'Замечание к этому абзацу', mockup: 'Что поправить на макете',
    noRemarks: 'Замечаний нет — просто нажмите «Готово»: это тоже записанное решение',
    artComment: 'Что поправить (при отклонении — обязательно по смыслу, иначе агент не знает, что менять)' },
  btn: { reloadRev: 'Открыть новую редакцию', save: 'Записать решение', saveDoc: 'Записать решения по этому документу', read: 'ОК, прочитано', done: 'Готово',
    copy: 'Скопировать', retry: 'Повторить запись', approve: '<strong>Одобряю</strong> — отправить как есть',
    reject: '<strong>Отклоняю</strong> — не отправлять' },
  art: { goesOut: 'Уйдёт наружу', missing: (file) => 'Файл <code>' + file + '</code> не найден — одобрять нечего. Это дефект, а не ваш выбор.',
    bytes: 'байт' },
  st: { draft: (n) => 'Подхвачен черновик: ' + n + ' полей(я) восстановлено из браузера', saving: 'Записываю…',
    saved: (w) => 'Записано: ' + w + '. Окно закроется само…', nothing: 'Нечего записывать: ни ответа, ни комментария',
    noRemarksWritten: 'замечаний нет',
    needArt: 'Нужно решение по исходящему: одобряю или отклоняю', err: (m) => 'ОШИБКА ЗАПИСИ: ' + m,
    serverGone: 'СЕРВЕР КОНТУРА НЕДОСТУПЕН — ответ НЕ уйдёт. Черновик сохранён в браузере; скопируйте текст (кнопка ниже) или перезапустите контур.',
    // LP (2.7, #66): окно на своём профиле в папке проекта — ответ переживает сервер; ни диалога, ни выбора (слово владельца Q2 = D)
    serverGoneLocal: 'Сервер контура недоступен — пишите дальше и нажмите «Записать» как обычно: ответ сохранится на этом компьютере, в папке проекта, и агент его заберёт.',
    savedLocally: 'Сервер недоступен — ответ сохранён на этом компьютере (в папке проекта); агент его заберёт. Окно можно закрыть.',
    // CP (2.9, тикет #125): длинное сообщение — в полосу над страницей (она оставляет колонку кнопки свободной); в пилюле под кнопкой —
    // только короткая метка: пилюля в шесть строк закрывала заголовок документа
    savedLocallyShort: 'Сохранено на этом компьютере', pillOk: 'Подробнее — в полосе сверху', pillErr: 'Внимание — см. полосу сверху',
    closeYourself: 'Браузер не дал закрыть окно — закройте его, пожалуйста, сами',
    // OW6 (2.8): ответы записываются по одному — страница остаётся; запись по другой редакции документа отказывается
    left: (n) => 'Записано. Осталось вопросов: ' + n + ' — страница остаётся открытой; на остальные можно ответить сейчас или позже.',
    stale: 'Документ ИЗМЕНЁН после того, как страница открылась, — этот ответ НЕ записан. Ваш текст ниже; откройте новую редакцию: черновики неизменённых вопросов вернутся.',
    rewritten: 'Документ переписан после того, как страница открылась, — запись здесь выключена. Откройте новую редакцию:',
    orphan: 'Черновик прошлой редакции — эти вопросы изменились или исчезли; ваш текст сохранён здесь:',
    duplicate: 'уже записано',
    copied: 'Скопировано в буфер', copyManually: 'Выделите и скопируйте вручную',
    rescue: 'Запись не прошла — ваш текст ниже, он не потерян.', noticeHint: 'Без пометки сообщение придёт снова.',
    selfcheck: (r, q) => 'САМОПРОВЕРКА СТРАНИЦЫ НЕ ПРОШЛА: радиогрупп ' + r + ' на ' + q + ' вопрос(ов) — форма сломана, здесь не отвечайте; скажите агенту.',
    tabnote: 'Эта страница открылась ВКЛАДКОЙ в браузере, а не окном контура — черновик живёт только в этой вкладке: не закрывайте её, пока не записали. Агент предупреждён (I26).' },
  call: {
    notice: (o, p, title) => o + ', сообщение ' + p + ': «' + title + '» — ответа не ждёт, только прочитать. Страница открыта.',
    batch: (o, p, parts) => o + ', накопилось в ' + p + ': ' + parts.join(', ') + '. Страница открыта.',
    interview: (o, p, kind, title, nWait) => o + ', ' + kind + ' ' + p + ' «' + title + '» ждёт вычитки' +
      (nWait ? ': вопросов без ответа ' + nWait : '') + '. Страница открыта.',
    proofread: (o, p, title) => o + ', ' + p + ' просит вычитку: «' + title + '». Страница открыта.',
    mockup: (o, p, title) => o + ', ' + p + ' просит отсмотреть макет: «' + title + '». Страница открыта.',
    from: (s) => 'это ' + s, // OW4 (2.8, #98): «<владелец>, это <сессия>. …»
    parts: { docs: (n) => 'документов ' + n, questions: (n) => 'вопросов без ответа ' + n, notices: (n) => 'сообщений непрочитанных ' + n },
  },
  // OW4 (2.8, #98): как голос произносит имя сессии — латиницу и цифры синтезатор читает плохо («dev2» → «дев два»)
  spoken: { words: [['main', 'мейн'], ['dev', 'дев'], ['master', 'мастер'], ['test', 'тест'], ['tester', 'тестер'], ['qa', 'кью эй'], ['prod', 'прод'],
    ['stage', 'стейдж'], ['staging', 'стейджинг'], ['review', 'ревью'], ['reviewer', 'ревьюер'], ['docs', 'докс'], ['doc', 'док'], ['feature', 'фича'],
    ['fix', 'фикс'], ['hotfix', 'хотфикс'], ['ops', 'опс'], ['lead', 'лид'], ['manager', 'менеджер'], ['design', 'дизайн'], ['designer', 'дизайнер'],
    ['ui', 'ю ай'], ['api', 'эй пи ай'], ['backend', 'бэкенд'], ['frontend', 'фронтенд'], ['bug', 'баг'], ['release', 'релиз'], ['team', 'тим'],
    ['agent', 'агент'], ['writer', 'райтер'], ['analyst', 'аналитик']],
    ones: ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать',
      'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
    tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'] },
  list: { waits: (d) => 'ждёт ' + d + ' дн.', shown: (date, ago, t) => 'показан: ' + date + ' — ' + ago + ' дн. назад (' + t + ')',
    never: 'НИ РАЗУ НЕ ПОКАЗАН — владелец не знает, что этот вопрос существует', empty: 'Очередь владельца пуста — ждущих документов нет.',
    gate: (n) => 'ГЕЙТ (I42): ни разу не показанных — ' + n + '. Напечатать очередь ≠ донести вопрос; показ — действие агента.',
    how: (cmd) => 'Подними страницей: ' + cmd + ' --queue · задал точечно в чате — запиши факт: ' + cmd + ' --mark-shown <док> --transport чат',
    dead: 'Документ мёртв и показывать нечего → закрой его статусом, и он уйдёт из очереди.',
    awaiting: (n) => 'РЕШЕНИЯ ВЛАДЕЛЬЦА ЖДУТ ВНЕСЕНИЯ — ' + n + ': все вопросы отвечены, статус не закрыт. Внеси их ПЕРВЫМИ, раньше плана (#86), затем закрой статус.',
    answered: (d) => 'отвечено ' + d + ' дн. назад',
    foreign: (f) => 'очередь у проекта своя: ' + f + ' — не той формы, что у этого контура; здесь читается как пустая и никогда не пишется; её документы поднимает свой контур проекта (см. HOUSE_RULES.md), интервью сканируются как прежде',
    foreignWrite: (f) => 'не записано: ' + f + ' — своя очередь проекта (другой формы); этот контур её никогда не перезаписывает — подними документ своим контуром проекта',
    stale: (doc, d, lim, cmd) => 'протух в очереди (' + d + ' дн. > ' + lim + '): ' + doc + ' — в списке выше его нет; закрой статусом или покажи намеренно: ' + cmd + ' --queue --include-stale' },
  transport: { page: 'страница', batch: 'пачка', chat: 'чат' },
  impl: {
    marked: (doc, q, where, file) => 'Факт «внесено» записан (I44): ' + doc + ' ' + q + ' → ' + where + ' → ' + file,
    gate: (doc, ids) => 'внесено, но открыто: ' + doc + ' ' + ids.join(', ') + ' → закрой статус (или впиши ответ); внесённый вопрос очередь второй раз не поднимет (I45)',
    badge: (where, date) => 'внесено → ' + where + ' (' + date + ')',
    withdrawnBadge: (why, date) => 'снят — ' + why + ' (' + date + ')',
    withdrawn: (doc, q, why, file) => 'Факт «снят» записан: ' + doc + ' ' + q + ' — ' + why + ' → ' + file + ' (вопрос стал беспредметным; это не ответ за владельца)',
    answeredNotWithdrawn: (doc, q) => doc + ' ' + q + ' ОТВЕЧЕН владельцем — снять можно только открытый вопрос; ничего не записано',
    noSuch: (doc, q, ids) => 'в ' + doc + ' нет вопроса ' + q + ' — известны: ' + (ids.join(', ') || '(нет)'),
  },
  check: {
    summary: (doc, n, ids) => 'проверка: ' + doc + ' — блоков ' + n + ', узнано ' + ids.length + (ids.length ? ': ' + ids.join(', ') : ''),
    unrecognised: (n) => 'не узнано: ' + n + ' блок(ов) похожи на вопрос, но не в форме `### В<n>.` / `### Q<n>.` — страница откроется БЕЗ них:',
    line: (l, text) => '  строка ' + l + ': ' + text,
    counts: (w, a) => 'без ответа ' + w + ', отвечено ' + a,
    archaeology: (n, m, ex) => 'археология: аттестовано ' + n + ' из ' + m + ' живых вопрос(ов)'
      + (ex ? ' (вне оси: ' + ex + ' — объявленное n/a)' : ''),
    archaeologyOld: (date, since) => 'археология: не судится — дата шапки '
      + (date ? date : 'отсутствует') + ' раньше ' + since + ' (ось действует вперёд; старые документы молчат)',
    ok: 'проверка OK — страницу можно открывать; ничего не показано, никто не позван (--check не поднимает страницу).',
    refused: 'проверка ОТКАЗАЛА (код 3) — поправь форму до открытия страницы; ничего не показано, никто не позван.',
    partial: (n) => 'ВНИМАНИЕ: ' + n + ' блок(ов) похожи на вопрос, но не узнаны — страница открывается БЕЗ них (--check покажет, какие).',
    partialHead: (n) => 'не узнано: ' + n + ' блок(ов), похожих на вопрос, — на этой странице их нет',
  },
};

const DICTS = { en: EN, ru: RU };
export const SHIPPED_LANGUAGES = Object.keys(DICTS);

/** Deep-fill `partial` from `base` so a partial dictionary never leaves a hole on the page. */
function fill(base, partial) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], p = partial ? partial[k] : undefined;
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && typeof b !== 'function')
      ? fill(b, p) : (p === undefined ? b : p);
  }
  return out;
}

/**
 * The dictionary for a deployment language. Unknown language → English, with `fallbackFrom` set
 * so the page can say so in its header (an honest degradation, never a silent one — I36 spirit).
 */
export function texts(language) {
  const lang = String(language || 'en').toLowerCase().slice(0, 2);
  if (DICTS[lang]) return { ...fill(EN, DICTS[lang]), fallbackFrom: null };
  return { ...fill(EN, EN), fallbackFrom: lang };
}
