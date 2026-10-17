---
description: URGENTLY CLOSE this chat RIGHT NOW, without the long ceremonies — capture only the essentials that must not be lost (status + the handover for the next chat), commit AND push, say goodbye in one line. Use when the human says "закрой чат срочно", "сворачиваемся прямо сейчас", "закрывай немедленно, без церемоний", "end the chat now", "force-close the chat", "end-chat-force". The skipped ceremonies (judge pass, bonsai trim, README refresh, showcase linters) become an explicit debt line in STATUS.md that the next /end-chat-soft pays. For an unhurried full closure use /end-chat-soft; for a light in-chat pause use /pause. Trigger aliases (ru): «закрой чат срочно», «сворачиваемся прямо сейчас», «закрывай немедленно», «без церемоний»
---

# /end-chat-force — the urgent closure: save what must not be lost, and go

The human needs this chat closed NOW. Speed wins over ceremony — but never over the handover: a
closure that loses the essentials is not fast, it is destructive. Three steps, minutes total.

## Step 1. The handover — only what must not be lost

Update `STATUS.md`, tersely:

- **What was done in this chat** — the facts a stranger cannot recover from git alone.
- **Where we are** — what works, what is mid-flight and in what state.
- **What the next session does FIRST** — commands, paths, open questions with owners.
- **The ceremonies debt line** — in the owner's language (origin issue #97; the English form below):
  `⚠️ Force-closed <date+time>: ceremonies skipped (judge pass, bonsai trim, README, showcase
  linters) — the first /end-chat-soft pays this debt.`
- **The standing falsehood line** — one phrase, in the owner's language (the English form): `Standing falsehood: none`, or
  `Standing falsehood: <the statement> → still stands in <place>, <place>` (`AGENT_GUIDE.md` → "a
  falsehood is corrected where it stands"). Force mode may skip a ceremony; it never drops a lie left
  standing under the owner's name — a statement this session learned was false and corrected only in
  the chat is named here with every place, and the next session's first move is the five steps.
- Convert relative dates to absolute.

Uncommitted work-in-progress that cannot land safely: name it in the handover (file, state, next
move) instead of finishing it — naming survives, rushing corrupts.

## Step 2. Commit and push

Commit through the project's staging gate and push:

KrinikCam: `node tools/commit.mjs "<type>: <one line>"` — bumps the build in `version.json`, `git add -A`,
commits and pushes in one move (multi-line message via a file or `$'…\n…'`).

If the build is known-broken, say so IN the commit message (`wip:` prefix) — an honest broken
state beats a silently lost one. If a push is rejected (non-fast-forward) — `git pull --rebase`,
retry once, and if it still fails, tell the human: the commit exists locally, nothing is lost.

## Step 3. The one-line farewell

One line to the human: the commit hash, the single most important thing for the next chat, and
the reminder that the ceremonies debt is recorded in `STATUS.md`. Goodbye.

## What this skill refuses to skip

- **The handover.** No closure without Step 1 — that is the one thing force mode exists to protect.
- **The staging gate.** A sweeping add that grabs the owner's stray files is not faster, it is a
  leak; the gate's refusal is obeyed even in force mode.
- **Honesty.** Skipped ceremonies are DECLARED (the debt line), never silently dropped — a force
  closure that pretends to be a full one is the fraud `/fable-judge` hunts.

## Notes

- The family in one line: **/pause — the chat continues later; /end-chat-soft — finish properly,
  then say goodbye; /end-chat-force — capture the essentials and say goodbye right now.**
- Force mode is the human's call, not the agent's shortcut: never pick it on your own initiative
  just because the session ran long.
