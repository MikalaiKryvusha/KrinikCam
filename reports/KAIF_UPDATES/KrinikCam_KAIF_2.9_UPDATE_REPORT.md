# KrinikCam — KAIF 2.1 → 2.9 update report (core-update route across eight releases, on a NEW machine: macOS → Windows)

**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/158

> **Created:** 2026-10-17 · **Parent:** the owner's order in the chat, 2026-10-17, verbatim: «продолжи за прошлой сессией
> разворачивать на этом компе проект KrinikCam и обновлять его KAIF до 2.9» and later «KAIF до 2.9 тоже обновлять и делать, что он
> предписывает» · **Agent:** Claude Opus 5.5 (1M context), VS Code extension, auto mode, with 3 recon + 3 executor subagents ·
> **Host:** Windows 11 Pro 10.0.26200, Node v24.15.0, Git Bash 5.2 + PowerShell 5.1, `core.autocrlf=true`, `core.ignorecase=true`,
> `NoDefaultCurrentDirectoryInExePath=1` · **Deployment:** tracking `origin` · lang `ru` · sphere `programming` · 5 agent systems ·
> **Previous report:** `KAIF_2.1_UPDATE_REPORT.md` (1.6 → 2.1, root of the repo).

## 1. Chronology

| Step | Command | Result |
|---|---|---|
| Fresh clone on a new machine | `git clone https://github.com/MikalaiKryvusha/KrinikCam.git` (previous session) | KAIF 2.1 tree, last commit `d33c055` (2026-08-02, macOS) |
| Mechanical update | `node .kaif/kaif-core.mjs update` (previous session, the 2.1 core) | replaced 13 · mergedModules 16 · added 38 · kept 49 · 25 diverged (translated wholesale) · 7 module diffs |
| Hooks | `node .kaif/kaif-core.mjs wire-hooks` | `4 of 4 KAIF hooks added; a new file` — the harness did NOT refuse the write; hooks fired in this very session (timer order on the next prompt) |
| Ignore-first | `.gitignore` | added refresh/voice markers, `.kaif/contour-window/`, `.kaif/.contour-tmp/`, `interviews/decisions/*.lock`; anchored `/KAIF.md` & co. after `check` reddened (R2) |
| `check` | `node .kaif/kaif-core.mjs check` | exit 1 → (R2 fix) → exit 0, `manifest satisfied: 102 files + 152 agent artifacts` |
| Contour | `review.mjs --selftest` · `--queue --list` · `--check` on 25 interviews | `contour selftest green: 138 checks` · queue empty after closing 5 old documents by a standalone status line (R4) |
| Voice | `review.mjs --call "<phrase>" --dry-run`, then live | `CALL: voice — eugene via KAIF_VOICE_TOOL`; the owner: «голос слышу чётко» |
| Attribution baseline | `kaif-attribution-lint.mjs check --write-baseline` | `0 finding(s) recorded as debt` |
| Checkpoints | `checkpoint policy-changes · merge-modules · deprecations` | recorded; others at the close (§3) |

## 2. Rakes

- **R1 · the update task of an OLD core on a long jump.** The task was written by the 2.1 core: no `wire-hooks`, `lint-baselines`,
  `field-report`, `owner-voice-core` items, and `policy-changes` still says «put each in front of the owner» — the very order 2.9
  retracts (#114). Followed the 2.9 rule from the news instead. Cost: had to read 120 lines of news to find the items the task lacked.
- **R2 · case-insensitive git hides deployed artifacts.** On Windows (`core.ignorecase=true`) the bare `.gitignore` line `KAIF.md`
  (written by an older core) matched `.clinerules/kaif.md` and `.roo/rules/kaif.md`; `check`: `✖ INCOMPLETE: 2 artifacts missing`.
  `check` named the cure precisely (anchor to the root); fixed by hand before `checkpoint recheck`. Works as designed in 2.9 — reported
  as confirmation that the 2.9 detection is valuable on a machine change.
- **R3 · hooks README smoke line is a false negative in Git Bash.** `printf '{"prompt":"resume\\nplan the day"}' | node
  .kaif/hooks/prompt-resume-word.mjs` printed NOTHING: Git Bash `printf` turns `\\n` into a real newline inside the JSON string →
  invalid JSON → the hook exits silently. With JSON built by `node -e 'JSON.stringify(…)'` the order prints. (A sibling, KUMM, saw
  the same; dedupe before filing.)
- **R4 · old interviews vs the 2.9 parser.** 5 documents of 2026-06/07 failed `--check` and 4 stood «stale in the queue» although
  answered: their status lived mid-line in a combined head (`> **Кому:** … · **Статус:** ✅ ОТВЕЧЕНО …`). Cured by adding a
  standalone `> **Статус:** ✅ ЗАКРЫТ — …` line (owner answers untouched). Wish: the parser could read a `**Статус:**` field anywhere
  in the first `>` head line.
- **R5 · machine change is not an update, but it is where updates break.** The project's own tools hard-coded macOS paths
  (Android Studio JBR, `~/Library/Android/sdk`), a bare `adb` resolved to an ancient 1.0.32 in `C:\adb`, a bare `gradlew.bat` was
  refused by `NoDefaultCurrentDirectoryInExePath=1`, and the user-level `JAVA_HOME` pointed at a deleted JDK. Fixed in the project
  (shared `tools/env.mjs`), not a KAIF defect — but the environment dossier of 2.2 is exactly the place that would have warned.

- **R6 · shipped skill frontmatter is not strict YAML.** A clean-context judge parsed every `SKILL.md` with js-yaml
  (strict): 15 of 37 fail — `bad indentation of a mapping entry` — because the plain-scalar `description:` carries `: ` (e.g.
  `/kaif-go` «…NOT a blanket yes: it…», `/end-chat-soft` «Trigger aliases (ru): «…»»). Visible in Claude Code: the skill list showed
  the file body / the H1 instead of the description for `/fable-domain`, `/fable-loop`, `/derive-styleguide`. Our own Russian skills
  (`/dayloop`, `/nightloop`, `/interview`, `/resume`) were fixed locally by single-quoting; the shipped bytes were left untouched so
  the next update stays a clean replace. Wish: quote or `>-` every shipped description, and a build-time strict-YAML gate.

## 3. What was exercised vs NOT

- Exercised: `wire-hooks` (live), the four hook scripts by hand, `check`, contour `--selftest`/`--check`/`--queue --list`/`--call`
  (live voice, owner confirmed), attribution baseline, `sync` (at `update-verify`).
- NOT exercised: a live owner page (`review.mjs <doc>` with the app window) — no open question this session; `--wait`; `--close`.

## 4. Rule changes accepted with the version (2.9 rule, #114)

All `policy-changes` lines 2.2–2.9 accepted without questions to the owner; none collides with a recorded [OWNER] decision of this
project. The owner gave the explicit order «делать, что он предписывает» the same day.

## 5. Final state and the judge verdict

- `update-verify`: `✅ update-verify passed — the update is complete and self-cleaned` (9 expected `MODULE ABSENT` lines: AGENT_GUIDE is
  translated wholesale, the 2.2–2.9 news were folded by hand from `git diff v2.1 v2.9` of the framework templates).
- `check --gate-budgets`: debt recorded for STATUS.md (356/200) and MASTER_PLAN.md (534/300).
- Hand merges: AGENT_GUIDE / PHILOSOPHY / BUG_FIXING + new HOUSE_RULES.md (environment dossier probed in both shells); 18 of 22
  translated skills got the delta, 4 had an empty delta (bug-research, kaif-fork, kaif-switch-origin, revision).
- Judge (clean-context subagent, read-only): `VERIFIED WITH CAVEATS` — 8/10 claims verified; refuted (a) a live `/end-chat`
  order in AGENTS.md — fixed; (b) R6 above — reported here, shipped bytes untouched.
- Entry cost: `/resume reads 9 re-read core document(s) + HOUSE_RULES.md ~ 123k tokens — 12 % of a 1M-token model window`.
