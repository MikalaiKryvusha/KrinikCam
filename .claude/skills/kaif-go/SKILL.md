---
name: kaif-go
description: The KICK — one short command that resumes work already in flight, with no "shall I continue?" round trip. Picks the resume point up from the parking note, the active plan or STATUS, refreshes only if a refresh trigger has fired, and carries on. Use when the human says "/kaif-go", "/go", "go", "go on", "continue", "keep going", "carry on", "next", "дальше", "продолжай", "поехали" — as a STANDALONE command, never as those words appearing mid-sentence. NOT a blanket yes: it never stands in for the owner's approval on vision-level forks, never lifts the write-gate or an AUTH line, and never pre-authorizes destructive or outward-facing actions. Cold context at the start of a session → /resume instead; nothing in flight → /what-next. Trigger aliases (ru): «/go», «дальше», «поехали», «давай», «продолжай»
---

# /kaif-go — the kick (short alias: `/go`)

The human wants the work to move, not to be asked about it. This skill is the shortest legal way to
say *"continue by the plan"* — and it is deliberately narrow: it restarts **momentum**, it never
grants **authority**.

> **One line of difference from its neighbours.** `/resume` = ENTER a session with empty context
> (full canon pass). `/pause` = park and leave a note. **`/kaif-go` = a session already warm, work
> already chosen — go.** If the context is cold, do not fake warmth: run `/resume` instead.
> And the neighbour rule of position: a message that OPENS with a skill's word (`resume` …) and
> carries the task below it runs that skill first (`AGENT_GUIDE.md` → "A leading skill word is an
> order") — the kick's "standalone only" boundary is about the word mid-sentence, not the first word.

## Step 1. Find the resume point — read it, do not reconstruct it

Take the FIRST one that exists, in this order:

0. **A `PARKED:` line** at the top of `STATUS.md` → "where to continue" — a task an owner's "switch" set aside (`AGENT_GUIDE.md` →
   "The owner's word mid-turn"); it survives compaction, a chat note may not. Once the work that displaced it is done, it is next.
1. **The parking note** left in this chat by `/pause` — it names the next concrete action.
2. **The active plan** — the step after the last checked box, quoted by its anchor line
   (`AGENT_GUIDE.md` → quote the plan line you are about to execute).
3. **`STATUS.md` → "where to continue"** — its first unfinished item.
4. Nothing of the above → this is not a kick, it is a choice: run `/what-next` and offer, do not guess.

Name the resume point in one line in the chat before acting. That line is the whole ceremony —
a kick that reports for three paragraphs has defeated its own purpose.

## Step 2. Refresh only if a trigger has fired — otherwise do not re-read

The kick is used many times per session; re-reading the canon on each one would burn the very
context it protects. Check the refresh triggers (`AGENT_GUIDE.md` → Context refresh): more than an
hour since the last refresh · a heavy task starting · returning from compaction or a long idle.

- **No trigger** → do not re-read anything. Go.
- **A trigger fired** → refresh the re-read core first, update the witness (marker + a quoted line),
  then go. The kick does not exempt you from the refresh canon; it just does not invent a reason.

## Step 3. Continue — and do not ask whether to continue

Execute the next step. Do not reply with a plan of the plan, do not re-derive decisions already
recorded, do not ask for a confirmation the human has just pre-empted by kicking you.

If the work was parked ON A FORK with a recommended option, the kick means *take the recommended
option and continue* — provided the fork is task-level (see the border below). Say which option you
took, in one line, and move.

## The border — what the kick does NOT authorize

The kick removes the friction of "continue", not the owner's authorship. It is **never** a yes to:

- **Vision-level forks** — brand, naming, scope, product shape. These live in `interviews/`, and
  they are answered by the owner's own words, not by a kick.
- **The write-gate** on the owner's canon artifacts — new entities still need the owner's "yes",
  and AI-written text still carries its provenance marks.
- **`AUTH:` lines** — releases, deploys, outward publications and sends, force-pushes, deletion of
  shared data. Standing authorization covers routine commits and nothing beyond it.
- **Destructive or irreversible actions** that would otherwise be confirmed.

Hit one of these while carrying on? Do everything that does NOT depend on it, then stop at that one
point and ask there. A kick met with silence on a vision fork is how a guess becomes canon.

## Notes

- **Standalone only.** Treat these words as the command when they stand alone as the whole message.
  The same words inside a sentence ("continue reading the log and tell me what you see") are prose —
  obey the sentence, not the alias.
- **The kick is idempotent.** Kicked twice on the same step? You are behind on narration, not on
  work: say where you are in one line and keep going.
- **Momentum is not haste.** The kick does not shorten verification: what is claimed done is still
  observed done (`TESTING_FRAMEWORK.md`), and a task called complete still faces `/fable-judge`.
