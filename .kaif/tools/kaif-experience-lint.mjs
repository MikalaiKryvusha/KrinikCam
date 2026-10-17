#!/usr/bin/env node
// kaif-experience-lint.mjs — the OPTIONAL experience-journal linter (2.7, epic EL; EXPERIENCE.md
// header → "Two strikes → a mechanism, never a third reminder"; /experience step 0; origin issue
// #69 — a field audit of one project's whole journal: "7 of 120 failure entries mechanized (5.8 %),
// 14 of 15 failure classes recurred AFTER their lesson was written, 4 AFTER a guard was built, five
// lessons written 6–17 times in different words"). Deployed to .kaif/tools/.
//
// What it mechanizes: the journal's own deadline. The rule existed as PROSE plus one field on one
// entry, and nobody counted the RECURRENCE — tags are free, and "the same class" was visible only
// to a human who read the journal end to end (which is how the audit found it). This linter makes
// the class a UNIT: every entry carries `class: <slug>`, and the SECOND failure entry of one class
// with no `mechanized:` is a finding that names the class and both entries by id — the repair is to
// name the guard, never to write a third record.
//
// What it does NOT do, said aloud: it cannot tell a good class from a bad one — a wrong slug gives a
// false GREEN (two entries land in different classes), never a false red, so the marking may be
// imperfect and the axis stays honest; it does not judge whether a named guard actually prevents the
// class (that is the judge's re-run and the guard's own @guard block); and it never rewrites the
// journal by itself — `--shrink` shows, and writes only with `--yes`.
//
// Boundaries, so the linter never becomes bureaucracy:
//   · field keywords are a per-language table (like kaif-testrun-lint); a project adds a row;
//   · rules are DATA (one engine + rules-as-data): a new rule is a table row, not a new script;
//   · ADVISORY: exit 1 = findings, exit 0 = judged and clean, exit 3 = SKIPPED (not one `class:` in
//     the journal — "not judged" must never read as "clean");
//   · the class list in the journal's header (`<!-- classes: a, b, c -->` or a "Lesson classes"
//     section) is a CONTROLLED list, not a closed one: a slug outside it is a WARNING, never a
//     refusal — a new class is exactly what a new lesson brings;
//   · inherited field debt lives in a baseline the caller passes (`--baseline <file>`; the origin's
//     wrapper owns its own) and ONLY SHRINKS — an always-red guard teaches itself to be ignored.
//     The baseline covers the FIELD rules it was captured for; it never silences a repeated class,
//     because a pair of entries is exactly what has to get a fate;
//   · that fate is one of two, and both are WRITTEN: name the guard in the entry
//     (`mechanized: <the tool>`), or re-check the price ONCE FOR THE WHOLE CLASS and declare it —
//     `<!-- class-ok: <slug> — <why it is not cheaply possible> -->` in the journal. The declaration
//     is a decision with a reason in words, not a mute switch: an empty one is itself a finding, and
//     every declared class is printed on the summary line (that list, too, only shrinks). A second
//     `none-cheap:` inside one class is therefore not an answer — twice "not cheaply possible" is
//     exactly the moment to re-check the price and say the result out loud.
//
// Commands:
//   node .kaif/tools/kaif-experience-lint.mjs check [journal] [--baseline <file>]   # default: EXPERIENCE.md
//        [--verbose]   # list every pre-class failure entry instead of the one fold line (origin issue #80)
//        [--write-baseline]   # record the inherited field debt ONCE (default file .kaif/experience-lint.baseline.json,
//                             # read by every later bare `check`); a later write only shrinks it (origin issue #80)
//   node .kaif/tools/kaif-experience-lint.mjs --shrink EXP-NNNN [journal] [--yes]   # show; --yes writes
//   node .kaif/tools/kaif-experience-lint.mjs selftest                              # PROVE every rule (EN + RU)
//
// @guard experience-lesson-repeat
// THREAT:         the same failure class is written a second (and a sixth, and a seventeenth) time
//                 instead of being mechanized — the journal becomes the default sink and the
//                 deadline "two strikes" has no carrier (origin issue #69; recurrence of #14)
// PROVED-AGAINST: the selftest below — a journal with two failure entries of one class and no
//                 `mechanized:` reddens with `repeat` naming the class and BOTH ids, in both
//                 shipped languages; one mechanized entry of the pair silences it; a journal with
//                 no `class:` at all exits 3 (SKIPPED), never 0; sandbox suite s28 runs the
//                 deployed copy, and the red is proven on the 2.6 core via the KAIF_DIST seam
//                 (the module does not exist there) and on mutants of the repeat axis itself
// GAP:            a WRONG slug splits a real pair into two classes — a false green, invisible to
//                 this axis (the marking is a human judgement; the linter only counts); an entry
//                 whose marker is a bare success is out of scope by construction; `dangling` reads
//                 the value as text, so a guard named in prose ("the check axis of the core") is
//                 neither confirmed nor denied; the journal of a project that keeps its lessons
//                 outside EXPERIENCE.md is invisible to it
// ON-REAL-PATH:   2026-09-18 — run over the origin's own 136-entry journal after its classes were
//                 marked, and over copies of two field journals (testcases/reports/2026-09-18_experience-lint.md)
// [TESTED: 2026-09-18 · selftest 68 cases green (7 rules x 2 languages, mutation N reddens rule N only);
//  suite s28 "all 30 checks green", red proven on the 2.6 core via KAIF_DIST ("10 of 30 check(s) failed")
//  and on six mutants of the axis (0 invisible, each reddening its own named assert);
//  FUNCTIONAL RUN on real state: the origin's own live journal after its 136 entries were marked —
//  14 repeated classes and one field named, every one given a fate, the re-run green (0 findings,
//  14 classes with a declared price); copies of two field journals — 328 entries with no class field
//  => SKIPPED (exit 3), 168 entries with two => 169 findings and 120 failure entries invisible to the
//  deadline, output read line by line; four defects of this module were found by those runs, not by
//  reasoning (a numeric-only id skipped 13 of 328 entries; an ignored runtime path read as a dangling
//  guard; guard addresses "missing" for a journal outside its tree; a declaration whose reason carried
//  `<...>` dropped silently) — report: testcases/reports/2026-09-18_experience-lint.md]
// [TESTED: 2026-09-24 · the no-class fold (2.8, epic CK step CK5.7, origin issue #80): selftest 75 cases green (fold,
//  oldest-first, --verbose, same-day history, a misplaced newer entry, a one-date journal); three mutants on copies —
//  the two earlier editions (by date alone · direction from the first and last entries) and the later-date guard
//  removed — each red on its own case; a copy of the origin's journal made into the field's shape (the class line
//  removed from EXP-0001…EXP-0116): this module prints ONE no-class line for 90 entries, the HEAD module 90 lines,
//  --verbose 90 —
//  report: testcases/reports/2026-09-24_ck57-experience-fold.md]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// OW8 (KAIF 2.8, origin issue #101): the command runs only when this file IS the program — imported by a project's own tool, the
// module stays silent and never exits the importer (the same guard as the shipped contour's review.mjs).
import { pathToFileURL as __kaifToUrl } from 'node:url';
import { resolve as __kaifResolve } from 'node:path';
const IS_MAIN = import.meta.url === __kaifToUrl(__kaifResolve(process.argv[1] || '')).href;

const argv = process.argv.slice(2);
const EXIT_SKIPPED = 3;
const DEFAULT_JOURNAL = 'EXPERIENCE.md';
// The inherited field debt of a DEPLOYED project lives next to the journal, under .kaif/ (origin issue #80: a journal updated
// from 2.6 carries 88–246 entries written before the fields existed, and the shipped module could not record them — only the
// origin's own wrapper could). `check --write-baseline` records it; a bare `check` reads it when it is there.
const DEFAULT_BASELINE = join('.kaif', 'experience-lint.baseline.json');

// ---------------------------------------------------------------------------
// The fields per language. A project whose owner writes in another language adds a row; the engine
// does not change. `\uXXXX` escapes, not letters: the payload of this framework carries no Cyrillic
// (a build invariant), and an escape is exactly as readable to the engine (paid-for lesson EXP-0135).
export const KEYWORDS = {
  en: { klass: 'class', mechanized: 'mechanized', noneCheap: 'none-cheap', subject: 'subject-lesson',
        classes: 'classes', classList: 'Lesson classes' },
  ru: { klass: '\u043A\u043B\u0430\u0441\u0441', mechanized: '\u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E',
        noneCheap: '\u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435\u0442',
        subject: '\u0443\u0440\u043E\u043A \u043E \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u0435',
        classes: '\u043A\u043B\u0430\u0441\u0441\u044B', classList: '\u041A\u043B\u0430\u0441\u0441\u044B \u0443\u0440\u043E\u043A\u043E\u0432' },
};
const alt = (pick) => Object.values(KEYWORDS).map(pick).join('|');

// The outcome markers of an entry heading: ❌ (U+274C) alone or ❌→✅ is a FAILURE entry — the only
// kind the recurrence deadline speaks about; a bare ✅ (U+2705) is a success and out of scope.
const FAILURE_MARK = /\u274C/;
// The `class:` line: its own line (an optional list bullet and optional bold), never mid-sentence —
// prose like "the owner named the class: the environment dossier…" is not a field (observed in a
// field journal). The value is a SLUG; anything else is said aloud, not silently grouped.
const CLASS_LINE = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?(?:\\*\\*)?(?:${alt((k) => k.klass)})(?:\\*\\*)?[ \\t]*:[ \\t]*(?:\\*\\*)?([^\\n]*)$`, 'im');
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
// No `\b`: a word boundary in JavaScript is blind to non-ASCII letters (paid-for lesson EXP-0082).
const FIELD_MECH = new RegExp(`(${alt((k) => k.mechanized)})\\s*:`, 'i');
const FIELD_NONE = new RegExp(`(${alt((k) => k.noneCheap)})\\s*:`, 'i');
const FIELD_SUBJ = new RegExp(`(${alt((k) => k.subject)})`, 'i');
// I4 — a TRAP BY FORM: an entry whose text reduces to an order of actions ("first A, then B",
// "don't forget X") may not answer `subject-lesson`; it carries mechanized/none-cheap.
const TRAP_FORM = new RegExp('(\u0441\u043D\u0430\u0447\u0430\u043B\u0430 [^\\n]{0,60}(?:\u043F\u043E\u0442\u043E\u043C|\u0437\u0430\u0442\u0435\u043C)' +
  '|\u043D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C|\u043F\u0435\u0440\u0435\u0434 \u0442\u0435\u043C \u043A\u0430\u043A' +
  '|\u0432\u0441\u0435\u0433\u0434\u0430 [^\\n]{0,40}\u043F\u0435\u0440\u0435\u0434' +
  "|first [^\\n]{0,60}then|don'?t forget|before running)", 'i');
// The value of `mechanized:` up to the next field separator — what `dangling` reads as text.
const MECH_VALUE = new RegExp(`(?:${alt((k) => k.mechanized)})\\s*:\\s*([^\\n]*)`, 'i');
// The class list of the journal header: a machine comment or a section that lists slugs.
const CLASSES_COMMENT = new RegExp(`<!--\\s*(?:${alt((k) => k.classes)})\\s*:([\\s\\S]*?)-->`, 'i');
const CLASSES_SECTION = new RegExp(`^#{1,4}[^\\n]*(?:${alt((k) => k.classList)})[^\\n]*$([\\s\\S]*?)(?=^#{1,4} |\\Z)`, 'im');
// The DECLARED exemption, per class: `<!-- class-ok: <slug> — <why> -->` says the price of mechanizing
// this class was re-checked and named, so the axis stays silent about it (the precedent of every
// KAIF axis: the owner's tree never fails on the owner's own declared decision). A declaration with
// no reason declares nothing and is said aloud — "two strikes" answered by an empty comment is the
// loophole this whole epic exists to close.
// The reason is read up to the comment's own terminator (`[\s\S]*?-->`, never `[^>]*`): a reason that
// quotes a placeholder or a template — `consulted <own reasoning>` — carries `>` inside it, and a
// character class would end the match early and drop the declaration silently (found on the origin's
// own journal: 13 of 14 declarations parsed, the fourteenth was the one with `<…>` in its text).
const CLASS_OK = /<!--\s*class-ok\s*:\s*([a-z0-9][a-z0-9-]*)\s*(?:--+|[—–:])?\s*([\s\S]*?)-->/gi;
const NPM_RUN = /npm run ([\w:-]+)/g;
const PATH_TOKEN = /(?:^|[\s`(])((?:\.kaif\/|tools\/|scripts\/|bin\/|framework\/)[\w./-]+\.\w{1,5})/g;

// ---------------------------------------------------------------------------
// Parsing — entries open with `### EXP-NNNN …` (the id is the heading's first token). The id is NOT
// assumed numeric: a field journal writes `### EXP-NEW-<slug> · …` for entries captured before their
// number was assigned, and a parser that demanded digits skipped 13 of 328 entries SILENTLY — a false
// green, found by running this module over a copy of that real journal (the EXP-0133 class: a fixture
// written by its author does not carry the forms other agents write).
export function parseEntries(text) {
  const out = [];
  const re = /^### +([A-Z]{2,6}-[A-Za-z0-9][\w-]*)([^\n]*)\n/gm;
  let m, prev = null;
  while ((m = re.exec(text))) {
    if (prev) out.push({ ...prev, body: text.slice(prev.end, m.index) });
    prev = { id: m[1], heading: m[2], line: text.slice(0, m.index).split('\n').length, end: re.lastIndex };
  }
  if (prev) out.push({ ...prev, body: text.slice(prev.end) });
  return out.map((e) => {
    const cm = CLASS_LINE.exec(e.body);
    const raw = cm ? cm[1].trim().split(/[\s\u00B7|]+/)[0].replace(/\*+$/, '') : null;
    return {
      ...e,
      failure: FAILURE_MARK.test(e.heading),
      date: (/\b(\d{4}-\d{2}-\d{2})\b/.exec(e.heading) || [null, null])[1],
      rawClass: raw,
      klass: raw && SLUG.test(raw) ? raw : null,
      mech: FIELD_MECH.test(e.body),
      none: FIELD_NONE.test(e.body),
      subj: FIELD_SUBJ.test(e.body),
      trap: TRAP_FORM.test(e.body),
      mechValue: (MECH_VALUE.exec(e.body) || [null, ''])[1].trim(),
    };
  });
}

/** The controlled list of class slugs declared in the journal's header (null = the journal has none). */
export function classList(text) {
  const src = (CLASSES_COMMENT.exec(text) || CLASSES_SECTION.exec(text) || [])[1];
  if (!src) return null;
  const slugs = (src.match(/[a-z][a-z0-9-]{2,}/g) || []).filter((s) => SLUG.test(s));
  return slugs.length ? [...new Set(slugs)] : null;
}

/** The classes whose price was re-checked and DECLARED in the journal → { declared: Map, empty: [slug…] }. */
export function declaredClasses(text) {
  const declared = new Map(), empty = [];
  for (const m of text.matchAll(CLASS_OK)) {
    const why = m[2].trim().replace(/^[—–-]+\s*/, '');
    if (why) declared.set(m[1], why); else empty.push(m[1]);
  }
  return { declared, empty };
}

/** Guards named in `mechanized:` that the project does not contain (read as TEXT — see GAP).
 *  `tree` is the project as two questions — does this path exist, is it deliberately ignored — so the
 *  selftest can hand over a SYNTHETIC tree and prove the rule without depending on the checkout it
 *  happens to run inside (s28: the deployed copy failed ten selftest cases when the rule read the disk). */
function danglingOf(value, root, tree) {
  const missing = [];
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* no package.json — npm scripts are not checked */ }
  for (const m of value.matchAll(NPM_RUN))
    if (pkg && pkg.scripts && !(m[1] in pkg.scripts)) missing.push(`npm run ${m[1]}`);
  // A path the project deliberately IGNORES is expected to be absent from a checkout — a runtime
  // state file is not a dangling guard (found by the functional run on the origin's own journal:
  // `mechanized: .kaif/guarded-loop.json in the ignore list` was named as missing, and the very
  // point of that lesson is that the file must NOT be in the tree).
  for (const m of value.matchAll(PATH_TOKEN))
    if (!tree.exists(m[1]) && !tree.ignored(m[1])) missing.push(m[1]);
  return missing;
}

let ignoreCache = null;
function isIgnored(rel, root) {
  if (ignoreCache === null) {
    try { ignoreCache = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); }
    catch { ignoreCache = []; }
  }
  return ignoreCache.some((p) => rel === p.replace(/^\/+|\/+$/g, '') || rel.startsWith(p.replace(/^\/+/, '').replace(/\/+$/, '') + '/'));
}

// ---------------------------------------------------------------------------
// The rules — data. Each: id · kind (finding = exit 1, warning = exit 0) · run(ctx) → [message…].
// ctx = { entries, text, root, baseline: Set<id>, list: string[]|null }
export const RULES = [
  // EL (2.7, #69): the deadline itself. Two failure entries of ONE class with no `mechanized:` —
  // an allowlist by construction (silence only on the positive evidence "mechanized"), because a
  // denylist of "unmechanized shapes" is silent on every shape it does not know (EXP-0133).
  { id: 'repeat', kind: 'finding', run: ({ entries, declared }) => {
      const byClass = new Map();
      for (const e of entries) {
        if (!e.failure || !e.klass || e.mech) continue;
        if (!byClass.has(e.klass)) byClass.set(e.klass, []);
        byClass.get(e.klass).push(e);
      }
      return [...byClass.entries()].filter(([k, g]) => g.length >= 2 && !declared.has(k)).map(([k, g]) =>
        `class ${k}: ${g.map((e) => e.id).join(', ')} — ${g.length} failure entries, not one mechanized: name the guard` +
        ` in the entry (\`${KEYWORDS.en.mechanized}: <the tool>\`), or re-check the price once for the whole class and` +
        ` declare it — \`<!-- class-ok: ${k} — <why mechanizing it is not cheaply possible> -->\` — never a third record:` +
        ' two strikes, never a third reminder');
    } },
  // A declared exemption with no reason declares nothing.
  { id: 'class-ok-without-reason', kind: 'finding', run: ({ declaredEmpty }) => declaredEmpty
      .map((k) => `<!-- class-ok: ${k} --> carries no reason — the declaration is the RE-CHECKED PRICE of the class, said in words, never a silencer`) },
  // I1, ported from the origin's guard (epic X 2.3, origin issue #14): exactly one of three fields.
  // The field rules judge an entry that carries `class:` - the 2.7 format; an entry written before it is
  // out of them: a field journal updated from 2.6 has hundreds, the deployed module ships no baseline
  // writer, and the first 2.7 lesson used to stop the closing ritual on 112-290 findings (court of 2.7, E-F1).
  { id: 'no-mechanization-field', kind: 'finding', run: ({ entries, baseline }) => entries
      .filter((e) => e.klass && !baseline.has(e.id) && !e.mech && !e.none && !e.subj)
      .map((e) => `${e.id} (line ${e.line}): no mechanization field — one of \`${KEYWORDS.en.mechanized}:\` · \`${KEYWORDS.en.noneCheap}: <why>\` · \`${KEYWORDS.en.subject}\``) },
  // I4: a trap by form may not answer `subject-lesson`.
  { id: 'trap-answered-subject', kind: 'finding', run: ({ entries, baseline }) => entries
      .filter((e) => e.klass && !baseline.has(e.id) && e.trap && !e.mech && !e.none)
      .map((e) => `${e.id} (line ${e.line}): the text reduces to an order of actions (a trap by form) — it needs \`${KEYWORDS.en.mechanized}:\` or \`${KEYWORDS.en.noneCheap}: <why>\`, never \`${KEYWORDS.en.subject}\``) },
  // A failure entry with no class is invisible to the deadline — the axis says so instead of counting it green.
  // History written BEFORE the journal's first classed entry is outside the field rules by the release's own words, so it
  // folds into ONE line (origin issue #80: 88 per-entry lines buried the one line that mattered, on every closing); an
  // unclassed failure written after it stays its own warning: that one is a real finding. "Before" is the entry's PLACE in
  // the journal, read in the journal's own direction, AND never a later date than the edge entry's: comparing dates alone
  // left same-day history unfolded (a copy of the origin's journal: 5 lines instead of 1), and a direction guessed from the
  // first and last entries alone was flipped by ONE misplaced entry, folding a real warning (light judge of CK5.7). So the
  // direction is the MAJORITY of adjacent dated pairs, and a journal whose order the dates cannot tell (no dates, one date,
  // a tie) is not folded at all — the noise stays, a real warning is never hidden.
  { id: 'no-class', kind: 'warning', run: ({ entries, baseline, verbose }) => {
    const bare = entries.filter((e) => e.failure && !e.klass && !baseline.has(e.id));
    const dated = entries.filter((e) => e.date);
    let down = 0, up = 0;
    for (let i = 1; i < dated.length; i++) {
      if (dated[i].date < dated[i - 1].date) down++;
      else if (dated[i].date > dated[i - 1].date) up++;
    }
    const direction = down > up ? 'newest-first' : up > down ? 'oldest-first' : null;
    const classedAt = entries.map((e, i) => (e.klass ? i : -1)).filter((i) => i >= 0);
    const edge = direction && classedAt.length ? (direction === 'newest-first' ? Math.max(...classedAt) : Math.min(...classedAt)) : -1;
    const first = edge >= 0 ? entries[edge] : null;
    const legacy = first && !verbose ? bare.filter((e) => {
      const i = entries.indexOf(e);
      const beyond = direction === 'newest-first' ? i > edge : i < edge;
      return beyond && !(e.date && first.date && e.date > first.date);
    }) : [];
    const fold = legacy.length ? [`${legacy.length} failure entr${legacy.length === 1 ? 'y carries' : 'ies carry'} no \`${KEYWORDS.en.klass}:\` and` +
      ` predate${legacy.length === 1 ? 's' : ''} the first classed entry (${first.id}${first.date ? `, ${first.date}` : ''}) — outside the field` +
      ` rules; list them: --verbose (classify from the newest end: the fold shrinks as you go)`] : [];
    return fold.concat(bare.filter((e) => !legacy.includes(e))
      .map((e) => `${e.id} (line ${e.line}): a failure entry with no \`${KEYWORDS.en.klass}: <slug>\`${e.rawClass ? ` (the value "${e.rawClass}" is not a slug — lowercase latin, digits and dashes)` : ''} — recurrence cannot be counted for it`)); } },
  // A slug outside the header's list: a warning, because a new class is what a new lesson brings.
  { id: 'unlisted-class', kind: 'warning', run: ({ entries, list }) => {
      if (!list) return [];
      const unlisted = new Map();
      for (const e of entries) if (e.klass && !list.includes(e.klass) && !unlisted.has(e.klass)) unlisted.set(e.klass, e.id);
      return [...unlisted.entries()].map(([k, id]) => `class ${k} (${id}) is not in the journal's class list — add the slug to the header list, or reuse an existing class`);
    } },
  // A guard named in `mechanized:` that the project does not contain — the mechanization is a claim.
  { id: 'dangling', kind: 'warning', run: ({ entries, root, addressable, tree }) => !addressable ? [] : entries.flatMap((e) => {
      if (!e.mech || !e.mechValue) return [];
      const missing = danglingOf(e.mechValue, root, tree);
      return missing.length ? [`${e.id} (line ${e.line}): \`${KEYWORDS.en.mechanized}:\` names what the project does not contain — ${missing.join(' · ')}` +
        ' (a mechanization nobody can run is a claim; fix the address or say what replaced it)'] : [];
    }) },
];
export const RULE_IDS = RULES.map((r) => r.id);

export function lint(text, { root = '.', baseline = new Set(), tree = null, addressable = null, verbose = false } = {}) {
  const entries = parseEntries(text);
  const list = classList(text);
  const { declared, empty } = declaredClasses(text);
  // Guard ADDRESSES are checked against the journal's own tree. A journal read outside its project —
  // a copy in a scratchpad, a neighbour's file — cannot confirm any address, and "the project does not
  // contain it" would be a claim about a tree that is not there (found on copies of two field journals:
  // seven honest mechanizations were named as dangling). No tree, no `dangling`, said aloud.
  const realTree = { exists: (rel) => existsSync(join(root, rel)), ignored: (rel) => isIgnored(rel, root) };
  const t = tree || realTree;
  const addr = addressable === null ? (existsSync(join(root, 'package.json')) || existsSync(join(root, 'tools'))) : addressable;
  const ctx = { entries, text, root, baseline, list, declared, declaredEmpty: empty, addressable: addr, tree: t, verbose };
  const findings = [], warnings = [];
  for (const rule of RULES)
    for (const msg of rule.run(ctx)) (rule.kind === 'finding' ? findings : warnings).push({ id: rule.id, msg });
  return { entries, list, declared, addressable: addr, findings, warnings };
}

// ---------------------------------------------------------------------------
// The command line, parsed ONCE over the WHOLE argv: a flag that takes a value consumes it, the
// command word is a command, everything else is positional. (The first cut sliced off argv[0] and then
// read indices against the slice, so `--shrink EXP-0002 <journal>` took the ID as the journal — caught
// by suite s28, not by reasoning.)
const flagValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = () => {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline' || a === '--shrink') { i++; continue; }
    if (a.startsWith('--') || a === 'check' || a === 'selftest') continue;
    out.push(a);
  }
  return out;
};

// An explicit `--baseline <file>` must exist; without the flag the project's own file next to the journal is read when present.
function loadBaseline(path, fallback) {
  if (!path) return fallback && existsSync(fallback) ? new Set(JSON.parse(readFileSync(fallback, 'utf8').replace(/^\uFEFF/, '')).ids || []) : new Set();
  if (!existsSync(path)) { console.error(`\u2716 experience-lint: no baseline at ${path}`); process.exit(1); }
  return new Set(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')).ids || []);
}

// `check --write-baseline`: the first capture records every entry id of the journal; a later one only SHRINKS the line \u2014 it keeps
// the ids still present and adopts none written since (those are exactly what the field rules are for), and says how many it
// refused. Same contract as the origin's wrapper and the attribution lint's baseline: an always-red guard teaches itself to be
// ignored, a baseline that grows teaches the same thing quieter.
// [TESTED: 2026-09-25 · suite s28 on the DEPLOYED module: write → 4 ids, a bare check reads it, a second write adopts no new
//  entry; red on the 2.7 dist; functional run on a copy of a field journal (122 entries): one fold warning before, 0 after,
//  "inherited field debt 122" — testcases/reports/2026-09-25_ck57b-experience-baseline.md]
function writeBaseline(text, path) {
  const ids = parseEntries(text).map((e) => e.id);
  const prev = existsSync(path) ? new Set(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')).ids || []) : null;
  const kept = prev ? ids.filter((id) => prev.has(id)) : ids;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    note: 'inherited field debt of the lesson journal (origin issues #14, #80): it only SHRINKS, new entries are never adopted; a repeated class is never silenced by it',
    capturedAt: new Date().toISOString(), ids: kept,
  }, null, 2) + '\n', 'utf8');
  console.log(`experience-lint: baseline written \u2014 ${path}, ${kept.length} entr${kept.length === 1 ? 'y' : 'ies'}` +
    `${prev ? ` (was ${prev.size}; ${ids.length - kept.length} entr${ids.length - kept.length === 1 ? 'y' : 'ies'} written after the first capture NOT adopted \u2014 the line only shrinks)` : ''}` +
    ' \u2014 commit it with the closing');
}

function check() {
  const journal = positional()[0] || DEFAULT_JOURNAL;
  if (!existsSync(journal)) {
    console.log(`\u26A0 experience-lint SKIPPED — no journal at ${journal}; nothing was judged (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  const text = readFileSync(journal, 'utf8');
  const root = dirname(resolve(journal));
  const ownBaseline = join(root, DEFAULT_BASELINE);
  if (argv.includes('--write-baseline')) writeBaseline(text, flagValue('--baseline') || ownBaseline);
  const baseline = loadBaseline(flagValue('--baseline'), ownBaseline);
  const { entries, list, declared, addressable, findings, warnings } = lint(text, { root, baseline, verbose: argv.includes('--verbose') });
  const classed = entries.filter((e) => e.klass);
  if (!classed.length) {
    console.log(`\u26A0 experience-lint SKIPPED — not one entry of ${journal} carries \`${KEYWORDS.en.klass}: <slug>\` (${entries.length} entries read);` +
      ` recurrence of a class cannot be counted, so nothing was judged — "not judged" is not "clean" (exit ${EXIT_SKIPPED}).` +
      ` Add the field to the entries (/experience) and a class list to the header.`);
    process.exit(EXIT_SKIPPED);
  }
  const mech = entries.filter((e) => e.mech).length;
  console.log(`experience-lint: ${entries.length} entries \u00B7 ${classed.length} classed \u00B7 ${new Set(classed.map((e) => e.klass)).size} classes` +
    ` \u00B7 ${mech} mechanized \u00B7 class list ${list ? `${list.length} slugs` : 'NONE in the header (a new slug is not checked)'}` +
    `${declared.size ? ` \u00B7 ${declared.size} class(es) declared price-re-checked (must only shrink): ${[...declared.keys()].join(', ')}` : ''}` +
    `${baseline.size ? ` \u00B7 inherited field debt ${baseline.size} (must only shrink)` : ''}` +
    `${addressable ? '' : ' \u00B7 guard addresses NOT checked: the journal is outside a project tree (no package.json, no tools/)'}`);
  for (const w of warnings) console.log(`\u26A0 ${w.id}: ${w.msg}`);
  for (const f of findings) console.log(`\u2716 ${f.id}: ${f.msg}`);
  if (findings.length) {
    console.log(`\u2716 experience-lint: ${findings.length} finding(s) in ${journal} — a lesson repeated without a mechanism is a lesson that failed as text`);
    process.exit(1);
  }
  console.log(`\u2705 experience-lint OK — ${journal}, 0 findings${warnings.length ? `, ${warnings.length} warning(s) above` : ''}`);
}

// ---------------------------------------------------------------------------
// --shrink: a MECHANIZED lesson collapses to one line with a pointer to its guard; the text itself
// stays in the git history (BUG_FIXING_FRAMEWORK → a mechanized lesson shrinks). Shows by default.
export function shrink(text, id) {
  const entries = parseEntries(text);
  const e = entries.find((x) => x.id === id);
  if (!e) return { error: `no entry ${id} in the journal` };
  if (!e.mech) return { error: `${id} carries no \`${KEYWORDS.en.mechanized}:\` — only a mechanized lesson shrinks (this one still owes its answer)` };
  const cm = CLASS_LINE.exec(e.body);
  const repro = (/^[ \t]*(?:\*\*)?(?:Repro|\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435)(?:\*\*)?[ \t]*:[ \t]*([^\n]*)$/im.exec(e.body) || [null, ''])[1].trim();
  const line = `**Lesson \u2192 guard:** ${e.mechValue || '(see the class line)'}` +
    `${repro ? ` \u00B7 repro: ${repro}` : ''} \u00B7 full text: \`git log -p -S "${id}" -- <this journal>\`\n`;
  const kept = (cm ? cm[0].trim() + '\n' : '');
  const next = text.slice(0, e.end) + kept + line + '\n' + text.slice(e.end + e.body.length);
  return { removed: e.body, replacement: kept + line, next };
}

function shrinkCmd() {
  const id = flagValue('--shrink');
  const journal = positional()[0] || DEFAULT_JOURNAL;
  if (!id) { console.error('usage: --shrink EXP-NNNN [journal] [--yes]'); process.exit(1); }
  if (!existsSync(journal)) { console.error(`\u2716 experience-lint: no journal at ${journal}`); process.exit(1); }
  const text = readFileSync(journal, 'utf8');
  const r = shrink(text, id);
  if (r.error) { console.error(`\u2716 experience-lint --shrink: ${r.error}`); process.exit(1); }
  console.log(`--- ${id}: the body that would be removed (${r.removed.split('\n').length} lines) ---\n${r.removed}`);
  console.log(`--- ${id}: what stands instead ---\n${r.replacement}`);
  if (!argv.includes('--yes')) {
    console.log(`\u26A0 shown, NOT written — re-run with --yes to write ${journal} (the removed text stays in the git history)`);
    return;
  }
  writeFileSync(journal, r.next, 'utf8');
  console.log(`\u2705 ${id} shrunk in ${journal} — one line with a pointer to its guard; the full text is in the git history`);
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures, in both shipped languages:
// mutation N reddens rule N and only N, the clean journal yields nothing (EXP-0127: "reddens with
// something" is an assert that passes for the wrong reason).
const CLEAN = {
  en: `# EXPERIENCE

<!-- classes: shown-as-link, escaping-layer, claim-before-evidence -->

## Entries

### EXP-0003 · 2026-03-03 · \u2705 · #ok
class: claim-before-evidence
**Lesson:** a success entry, out of the deadline's scope.
**Repro:** \`node tools/x.mjs\`
**Mechanization:** subject-lesson

### EXP-0002 · 2026-02-02 · \u274C\u2192\u2705 · #show
class: shown-as-link
**Lesson:** showing was replaced by a link a second time.
**Repro:** \`node tools/showcase-lint.mjs\`
**Mechanization:** mechanized: \`tools/showcase-lint.mjs\`

### EXP-0001 · 2026-01-01 · \u274C · #show
class: shown-as-link
**Lesson:** showing was replaced by a link.
**Repro:** \`node tools/showcase-lint.mjs\`
**Mechanization:** none-cheap: the class is a human judgement, no machine evidence
`,
  ru: `# EXPERIENCE

<!-- \u043A\u043B\u0430\u0441\u0441\u044B: shown-as-link, escaping-layer, claim-before-evidence -->

## \u0417\u0430\u043F\u0438\u0441\u0438

### EXP-0003 · 2026-03-03 · \u2705 · #ok
\u043A\u043B\u0430\u0441\u0441: claim-before-evidence
**\u0423\u0440\u043E\u043A:** \u0437\u0430\u043F\u0438\u0441\u044C \u043E\u0431 \u0443\u0441\u043F\u0435\u0445\u0435.
**\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435:** \`node tools/x.mjs\`
**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u0443\u0440\u043E\u043A \u043E \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u0435

### EXP-0002 · 2026-02-02 · \u274C\u2192\u2705 · #show
\u043A\u043B\u0430\u0441\u0441: shown-as-link
**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439 \u0432\u0442\u043E\u0440\u043E\u0439 \u0440\u0430\u0437.
**\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435:** \`node tools/showcase-lint.mjs\`
**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E: \`tools/showcase-lint.mjs\`

### EXP-0001 · 2026-01-01 · \u274C · #show
\u043A\u043B\u0430\u0441\u0441: shown-as-link
**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439.
**\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435:** \`node tools/showcase-lint.mjs\`
**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435\u0442: \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u043E\u0435 \u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435
`,
};
// Each mutation: the id of the rule it must redden, and the edit that produces it.
const MUTATIONS = {
  // The deadline: the mechanized entry of the pair loses its field → two unmechanized entries of one class.
  repeat: {
    en: (t) => t.replace('**Mechanization:** mechanized: `tools/showcase-lint.mjs`', '**Mechanization:** subject-lesson'),
    ru: (t) => t.replace('**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E: `tools/showcase-lint.mjs`',
                          '**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u0443\u0440\u043E\u043A \u043E \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u0435'),
  },
  'no-mechanization-field': {
    en: (t) => t.replace('**Mechanization:** none-cheap: the class is a human judgement, no machine evidence', ''),
    ru: (t) => t.replace('**\u041C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F:** \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435\u0442: \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u043E\u0435 \u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435', ''),
  },
  'trap-answered-subject': {
    en: (t) => t.replace('**Lesson:** a success entry, out of the deadline\'s scope.', '**Lesson:** first run the build, then the suite.'),
    ru: (t) => t.replace('**\u0423\u0440\u043E\u043A:** \u0437\u0430\u043F\u0438\u0441\u044C \u043E\u0431 \u0443\u0441\u043F\u0435\u0445\u0435.',
                          '**\u0423\u0440\u043E\u043A:** \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u0431\u043E\u0440\u043A\u0430, \u043F\u043E\u0442\u043E\u043C \u0441\u0432\u043E\u0434.'),
  },
  'no-class': {
    en: (t) => t.replace('class: shown-as-link\n**Lesson:** showing was replaced by a link.', '**Lesson:** showing was replaced by a link.'),
    ru: (t) => t.replace('\u043A\u043B\u0430\u0441\u0441: shown-as-link\n**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439.',
                          '**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439.'),
  },
  'unlisted-class': {
    en: (t) => t.replace('class: shown-as-link\n**Lesson:** showing was replaced by a link.', 'class: shown-as-a-link\n**Lesson:** showing was replaced by a link.'),
    ru: (t) => t.replace('\u043A\u043B\u0430\u0441\u0441: shown-as-link\n**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439.',
                          '\u043A\u043B\u0430\u0441\u0441: shown-as-a-link\n**\u0423\u0440\u043E\u043A:** \u043F\u043E\u043A\u0430\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u0451\u043D \u0441\u0441\u044B\u043B\u043A\u043E\u0439.'),
  },
  'class-ok-without-reason': {
    en: (t) => t.replace('## Entries', '<!-- class-ok: shown-as-link -->\n\n## Entries'),
    ru: (t) => t.replace('## \u0417\u0430\u043F\u0438\u0441\u0438', '<!-- class-ok: shown-as-link -->\n\n## \u0417\u0430\u043F\u0438\u0441\u0438'),
  },
  dangling: {
    en: (t) => t.replace('mechanized: `tools/showcase-lint.mjs`', 'mechanized: `tools/no-such-guard.mjs`'),
    ru: (t) => t.replace('\u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E: `tools/showcase-lint.mjs`',
                          '\u043C\u0435\u0445\u0430\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E: `tools/no-such-guard.mjs`'),
  },
};

function selftest() {
  // The selftest is HERMETIC: the `dangling` rule is handed a SYNTHETIC tree (one path exists, one is
  // ignored), so the proof holds wherever the module runs — the origin, a deployed `.kaif/tools/`, a
  // copy in a scratchpad. A selftest that reads the checkout it happens to sit in proves the checkout.
  const TREE = { exists: (rel) => rel === 'tools/showcase-lint.mjs', ignored: (rel) => rel.startsWith('tools/state/') };
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  \u2717 ${name}`); } else console.log(`  \u2713 ${name}`); };
  for (const lang of Object.keys(CLEAN)) {
    const opts = { root: '.', tree: TREE, addressable: true };
    const clean = lint(CLEAN[lang], opts);
    const cleanIds = [...clean.findings, ...clean.warnings].map((x) => x.id);
    say(cleanIds.length === 0, `${lang}: the clean journal — 0 findings and 0 warnings (got [${cleanIds.join(',')}])`);
    say(clean.entries.length === 3 && clean.list && clean.list.length === 3,
      `${lang}: three entries parsed and the header's class list read (got ${clean.entries.length} entries, ${clean.list ? clean.list.length : 'no'} slugs)`);
    for (const id of RULE_IDS) {
      const mut = MUTATIONS[id];
      say(!!mut && !!mut[lang], `${lang}: rule ${id} has a mutation`);
      if (!mut || !mut[lang]) continue;
      const src = mut[lang](CLEAN[lang]);
      say(src !== CLEAN[lang], `${lang}: mutation ${id} changed the fixture`);
      const got = lint(src, opts);
      const ids = [...got.findings, ...got.warnings].map((x) => x.id);
      say(ids.length === 1 && ids[0] === id, `${lang}: mutation ${id} \u2192 exactly [${id}] (got [${ids.join(',')}])`);
    }
    // The deadline names the CLASS and BOTH ids — the whole point of the axis (criterion 24).
    const pair = lint(MUTATIONS.repeat[lang](CLEAN[lang]), opts).findings.find((f) => f.id === 'repeat');
    say(!!pair && /class shown-as-link:/.test(pair.msg) && pair.msg.includes('EXP-0002') && pair.msg.includes('EXP-0001'),
      `${lang}: the repeat finding names the class and BOTH entries (got "${pair ? pair.msg.slice(0, 70) : 'nothing'}")`);
    // A THIRD entry of the class does not reset anything: all three are named.
    const third = CLEAN[lang].replace(/^## /m, `### EXP-0004 \u00B7 2026-04-04 \u00B7 \u274C \u00B7 #show\n${KEYWORDS[lang].klass}: shown-as-link\n**x:** y\n\n## `);
    const t3 = lint(MUTATIONS.repeat[lang](third), opts).findings.find((f) => f.id === 'repeat');
    say(!!t3 && t3.msg.includes('EXP-0004') && /3 failure entries/.test(t3.msg), `${lang}: a third entry of the class is named too, with the count (got "${t3 ? t3.msg.slice(0, 60) : 'nothing'}")`);
    // A success entry of the same class is NOT a strike (the deadline speaks about failures).
    const success = CLEAN[lang].replace(`### EXP-0002 \u00B7 2026-02-02 \u00B7 \u274C\u2192\u2705`, `### EXP-0002 \u00B7 2026-02-02 \u00B7 \u2705`);
    const noPair = lint(MUTATIONS.repeat[lang](success), opts).findings.map((f) => f.id);
    say(!noPair.includes('repeat'), `${lang}: a success entry of the same class is not a strike (got [${noPair.join(',')}])`);
    // The DECLARED price of the class silences exactly that class — and only with a reason in words.
    const declaredOk = lint(MUTATIONS.repeat[lang](CLEAN[lang]).replace('## ', '<!-- class-ok: shown-as-link — the price was re-checked: the class is a human judgement, no machine evidence -->\n\n## '), opts);
    say(declaredOk.findings.length === 0 && declaredOk.declared.get('shown-as-link'),
      `${lang}: a declared class-ok WITH a reason silences its own class (got [${declaredOk.findings.map((f) => f.id).join(',')}])`);
    const declaredOther = lint(MUTATIONS.repeat[lang](CLEAN[lang]).replace('## ', '<!-- class-ok: escaping-layer — the price was re-checked -->\n\n## '), opts);
    say(declaredOther.findings.some((f) => f.id === 'repeat'), `${lang}: a declaration for ANOTHER class silences nothing here`);
    // The baseline silences the FIELD rule it was captured for — and never the repeat.
    const withBaseline = lint(MUTATIONS.repeat[lang](CLEAN[lang]), { ...opts, baseline: new Set(['EXP-0001', 'EXP-0002']) });
    say(withBaseline.findings.some((f) => f.id === 'repeat'), `${lang}: a baseline does NOT silence a repeated class`);
    // --shrink: shown, never written; and a lesson that still owes its answer refuses.
    const sh = shrink(CLEAN[lang], 'EXP-0002');
    say(!sh.error && /Lesson \u2192 guard:/.test(sh.replacement) && sh.replacement.split('\n').filter((l) => l.trim()).length === 2 &&
        /git log -p -S "EXP-0002"/.test(sh.replacement) && !sh.next.includes(sh.removed.trim()),
      `${lang}: --shrink collapses a mechanized entry to the class line plus one pointer line (got ${sh.error || sh.replacement.split('\n').filter((l) => l.trim()).length + ' lines'})`);
    say(!!shrink(CLEAN[lang], 'EXP-0001').error, `${lang}: --shrink refuses an entry with no mechanized: (it still owes its answer)`);
    say(!!shrink(CLEAN[lang], 'EXP-9999').error, `${lang}: --shrink refuses an id the journal does not carry`);
    // A journal with no class field at all: the caller must SKIP, never read clean.
    const noClass = CLEAN[lang].replace(new RegExp(`^${KEYWORDS[lang].klass}: [a-z-]+$`, 'gm'), '');
    say(lint(noClass, opts).entries.filter((e) => e.klass).length === 0, `${lang}: a journal with no class field has 0 classed entries (the caller exits ${EXIT_SKIPPED})`);
  }
  // A field journal's own forms, met on copies of two real journals: an id with no number
  // (`EXP-NEW-<slug>`) is an entry, and CRLF line endings do not hide the `class:` field.
  const fieldForms = '# EXPERIENCE\r\n\r\n## Entries\r\n\r\n### EXP-NEW-shell-ate-the-quotes · 2026-08-30 · ❌ · #x\r\nclass: shell-lied\r\n**Lesson:** y\r\n**Mechanization:** subject-lesson\r\n';
  const ff = lint(fieldForms, { root: '.', tree: TREE, addressable: true });
  say(ff.entries.length === 1 && ff.entries[0].id === 'EXP-NEW-shell-ate-the-quotes' && ff.entries[0].klass === 'shell-lied' && ff.entries[0].failure,
    `an id with no number under CRLF is an entry with its class (got ${ff.entries.length} entries, class ${ff.entries[0] && ff.entries[0].klass})`);
  // A journal updated from 2.6: legacy entries (no `class:`, no mechanization field, a trap by form) under ONE
  // 2.7 lesson - no finding; the legacy failure entry is only a no-class warning (court of 2.7, E-F1).
  const legacy = '# EXPERIENCE\n\n## Entries\n\n### EXP-0010 \u00B7 2026-09-18 \u00B7 \u274C \u00B7 #x\nclass: shown-as-link\n**Lesson:** y\n**Mechanization:** mechanized: `tools/showcase-lint.mjs`\n\n### EXP-0009 \u00B7 2026-01-01 \u00B7 \u274C \u00B7 #old\n**Lesson:** first run the build, then the suite.\n';
  const lg = lint(legacy, { root: '.', tree: TREE, addressable: true });
  say(lg.findings.length === 0 && lg.warnings.map((w) => w.id).join() === 'no-class',
    `a journal updated from 2.6 - legacy entries under one 2.7 lesson: 0 findings, one no-class warning (got [${lg.findings.map((f) => f.id)}] / [${lg.warnings.map((w) => w.id)}])`);
  // Origin issue #80 (a field journal: 88 per-entry no-class lines on every closing): pre-class history folds into ONE
  // line; an unclassed failure written AFTER the first classed entry stays its own warning; --verbose lists them all.
  const foldJ = '# EXPERIENCE\n\n## Entries\n\n### EXP-0012 \u00B7 2026-09-20 \u00B7 \u274C \u00B7 #x\n**Lesson:** after the first classed one.\n\n' +
    '### EXP-0011 \u00B7 2026-09-18 \u00B7 \u274C \u00B7 #x\nclass: shown-as-link\n**Lesson:** y\n**Mechanization:** mechanized: `tools/showcase-lint.mjs`\n\n' +
    '### EXP-0003 \u00B7 2026-09-01 \u00B7 \u274C \u00B7 #x\n**Lesson:** a.\n\n### EXP-0002 \u00B7 2026-08-01 \u00B7 \u274C \u00B7 #x\n**Lesson:** b.\n\n' +
    '### EXP-0001 \u00B7 2026-07-01 \u00B7 \u274C \u00B7 #x\n**Lesson:** c.\n';
  const fw = lint(foldJ, { root: '.', tree: TREE, addressable: true }).warnings.filter((w) => w.id === 'no-class').map((w) => w.msg);
  say(fw.length === 2 && /^3 failure entries carry no/.test(fw[0]) && /\(EXP-0011, 2026-09-18\)/.test(fw[0]) && /^EXP-0012 /.test(fw[1]),
    `#80: three pre-class entries fold into ONE line naming the first classed entry; the entry written after it stays its own (got ${JSON.stringify(fw)})`);
  // the same journal written oldest-first (the dates say so) folds the same three and keeps the same one
  const oldestFirst = foldJ.split(/\n(?=### )/).slice(1).reverse().join('\n').replace(/^/, '# EXPERIENCE\n\n## Entries\n\n');
  const fo = lint(oldestFirst, { root: '.', tree: TREE, addressable: true }).warnings.filter((w) => w.id === 'no-class').map((w) => w.msg);
  say(fo.length === 2 && /^3 failure entries carry no/.test(fo[0]) && /^EXP-0012 /.test(fo[1]),
    `#80: an oldest-first journal folds the same pre-class history (got ${JSON.stringify(fo)})`);
  const fv = lint(foldJ, { root: '.', tree: TREE, addressable: true, verbose: true }).warnings.filter((w) => w.id === 'no-class');
  say(fv.length === 4 && fv.every((w) => /^EXP-00\d\d /.test(w.msg)), `#80: --verbose lists every unclassed failure entry by id (got ${fv.length})`);
  // Light judge of CK5.7: the three shapes that broke the first two editions, each locked by a case.
  const ent = (id, date, klass, lesson) => `### ${id} · ${date} · ❌ · #x\n` + (klass ? `class: ${klass}\n` : '') +
    `**Lesson:** ${lesson}.\n` + (klass ? '**Mechanization:** mechanized: `tools/showcase-lint.mjs`\n' : '') + '\n';
  const J = (...es) => '# EXPERIENCE\n\n## Entries\n\n' + es.join('');
  const noClassOf = (text) => lint(text, { root: '.', tree: TREE, addressable: true }).warnings.filter((w) => w.id === 'no-class').map((w) => w.msg);
  // (1) history written the SAME day as the first classed entry is history too (a date-only fold kept it per entry)
  const sameDay = noClassOf(J(ent('EXP-0005', '2026-09-18', null, 'after'), ent('EXP-0004', '2026-09-18', 'shown-as-link', 'y'),
    ent('EXP-0003', '2026-09-18', null, 'same day, before'), ent('EXP-0002', '2026-09-10', null, 'b'), ent('EXP-0001', '2026-09-01', null, 'c')));
  say(sameDay.length === 2 && /^3 failure entries carry no/.test(sameDay[0]) && /^EXP-0005 /.test(sameDay[1]),
    `#80: history of the same day as the first classed entry folds with the rest (got ${JSON.stringify(sameDay)})`);
  // (2) ONE newer entry appended at the bottom of a newest-first journal neither flips the direction nor hides itself
  const misplaced = noClassOf(J(ent('EXP-0010', '2026-09-22', null, 'newer'), ent('EXP-0009', '2026-09-21', 'shown-as-link', 'y'),
    ent('EXP-0003', '2026-09-03', null, 'a'), ent('EXP-0002', '2026-09-02', null, 'b'), ent('EXP-0001', '2026-09-01', null, 'c'),
    ent('EXP-0011', '2026-09-23', null, 'appended at the bottom')));
  say(misplaced.length === 3 && /^3 failure entries carry no/.test(misplaced[0]) && misplaced.some((m) => /^EXP-0010 /.test(m)) && misplaced.some((m) => /^EXP-0011 /.test(m)),
    `#80: a misplaced newer entry at the bottom stays its own warning, the history still folds (got ${JSON.stringify(misplaced)})`);
  // (3) a journal whose order the dates cannot tell (one date) is not folded at all — nothing real is ever hidden
  const oneDay = noClassOf(J(ent('EXP-0003', '2026-09-18', null, 'a'), ent('EXP-0002', '2026-09-18', 'shown-as-link', 'y'), ent('EXP-0001', '2026-09-18', null, 'c')));
  say(oneDay.length === 2 && oneDay.every((m) => /^EXP-000\d /.test(m)),
    `#80: an undecidable order (one date) folds nothing — every unclassed failure stays its own line (got ${JSON.stringify(oneDay)})`);
  // Prose that merely contains the word "class:" mid-sentence is NOT the field (a field journal does this).
  const prose = CLEAN.en.replace('**Lesson:** showing was replaced by a link.', '**Lesson:** the owner named the class: the dossier was supposed to make it impossible.');
  say(lint(prose, { root: '.', tree: TREE, addressable: true }).entries.filter((e) => e.klass).length === 3, 'prose with "class:" mid-sentence is not the field (got a fourth class)');
  if (failed) { console.error(`\u2716 experience-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`\u2705 experience-lint selftest OK — ${cases} cases, ${RULE_IDS.length} rules \u00D7 ${Object.keys(CLEAN).length} languages, every rule red on its mutation only and silent on the clean journal`);
}

// ---------------------------------------------------------------------------
if (IS_MAIN) {
  if (argv.includes('--shrink')) shrinkCmd();
  else if (argv[0] === 'check' || argv.length === 0) check();
  else if (argv[0] === 'selftest') selftest();
  else { console.error('usage: node .kaif/tools/kaif-experience-lint.mjs check [journal] [--baseline <file>] [--verbose] [--write-baseline] | --shrink EXP-NNNN [journal] [--yes] | selftest'); process.exit(1); }
}
