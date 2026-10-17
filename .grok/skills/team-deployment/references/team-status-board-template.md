# TEAM_STATUS — <team name> status board

> Template from the KAIF `team-deployment` skill. Copy to the project root of the MAIN copy as
> `TEAM_STATUS.md`, one row per seat of the approved design. Rules — the team's constitution
> (`TEAM_CONSTITUTION.md` § 4); this file carries the board itself, its form rules, and the
> CONTRACT for the board tool the project's agent builds.
>
> The board is the state IN THE MOMENT — transparent to the whole team so agents do not
> interrupt each other, respect each other's busyness, and can see where help is needed.
> The project's `STATUS.md` still carries the handover between sessions; the board never replaces it.
> **An existing LIVE team: take the skill's adopt path — do not copy this template over its
> board or its board tool;** a tool that already holds the contract below is a match, not a defect.

## Board

| Role | State | Doing | Waiting for | Updated |
|---|---|---|---|---|
| manager | 🟢 free | — | — | <stamp> |
| <role> | 🟢 free | — | — | <stamp> |

*("Doing" — one short line: what and on whose assignment. "Waiting for" — the ADDRESS of who
blocks, or "—". "Updated" — the project's canonical moment stamp.)*

**Four states, and each is a ROLE with an obligation** (two states were not enough: three seats
of six once stood "busy" while standing still, and the "Waiting for" column obliged nobody):

| State | Meaning | Obligation of the seat | Obligation of the Manager |
|---|---|---|---|
| 🟢 free | no assignment in hand → **the row carries the REQUEST** | write what is done and which candidates you ask for, named from `STATUS.md`/the backlog ("done X; can take A / B / C") in the SAME write that sets `free`, and send the same one-line request to the Manager (constitution § 2 rule 6) | read a QUEUE, not a poll: answer with one of the named candidates, or "wait" |
| 🔴 busy | working on a named assignment | "Doing" names it; row refreshed at every cut | do not interrupt (§ 2 rule 4) |
| 🟡 blocked | cannot proceed | "Waiting for" names the ADDRESS and the matter; one message to the holder | react to `audit-waiting` (contract item 8) — a blocked seat is the Manager's queue |
| ⚫ offline | window closed / session gone | row cleared on stop (§ 9); locks released | clear a vanished seat's row and locks (Manager-only override) |

## Resource locks

| Resource | Holder | Taken |
|---|---|---|
| <singleton resource 1 of N> | — free — | — |

*(one row per singleton the constitution names in § 7: test stand, emulators, port-bound
previews… Take → run → release; holding "just in case" is forbidden.)*

## Form rules (from the owner's field order — keep them)

- **Statuses are short; the document never grows** — rows are REWRITTEN, never appended.
- Update your row at EVERY state change: took a task · waiting on someone · freed.
- Successes and difficulties are legal status content — that is how neighbors see where to help.
- Reading the board before messaging someone is part of the communication regimen (constitution
  § 2 rule 4).

## Where the board lives — session state OUTSIDE git

The board is the state of the moment, not history: it is rewritten at every state change, so a
TRACKED board makes the `main` tree dirty by construction (field: 105 board commits in ten days,
14 of them only to clean the tree before a gate). Therefore:

- **`TEAM_STATUS.md` is ignore-first** — one line in `.gitignore` when operation 3 materializes
  it (the same class as `.kaif/refresh-marker.json` and the heartbeat); it is never committed.
- **A snapshot travels to the retrospective:** operation 5 copies the board as it stood at the
  end of the shift into the retrospective document — that is where its history belongs.
- **Named opt-out:** a team that wants the board tracked (audit trail, no shared disk) writes the
  opt-out into the constitution § 4 with its price stated — a dirty tree at every state change —
  and exempts the board from the tree-cleanliness gates by name.

## Board tool — the contract (the project's agent builds it)

KAIF fixes the invariants; the implementation belongs to the project's agent, in the project's
stack. Reference implementation in the origin field project: ~500 lines of dependency-free
Node.js. The tool MUST hold:

1. **One board per team.** The board lives in the main copy; the tool invoked from ANY workspace
   finds the one true board (for git worktrees: resolve the common git directory — e.g.
   `git rev-parse --git-common-dir` — never the local checkout; a per-workspace copy would give
   every role a private board nobody reads).
2. **The caller's role is DERIVED from the working directory** (workspace naming invariant,
   constitution § 1), never passed as a claim. The tool edits ONLY the caller's row and refuses
   foreign rows; clearing a vanished role's stale row is a Manager-only override, explicit flag.
3. **Concurrent writes are safe:** a lock file next to the board (create-exclusive with retries;
   a lock older than a named timeout counts as abandoned), writes atomic (temp file + rename).
4. **Lock rows name the holder with its address** where the resource maps to per-role parameters
   (ports, slots): the reader must see WHOSE ports occupy the place — capacity rows (places) and
   role addresses (slots) are different things; conflating them was a paid-for field bug.
5. **Stamps use the project's canonical moment format**, taken from the system clock by the tool
   itself — never remembered by the session.
6. **Proven on a broken case before trusted** (project testing canon): a foreign-row edit is
   refused; an abandoned lock is recovered; two concurrent writers do not corrupt the table.
7. **`--free` carries the request, or it is not a free row.** Setting a row to `🟢 free` takes the
   candidates the seat asks for — `--free --asking "<candidates>"` — and writes them into the row
   (constitution § 2 rule 6, origin issue #68). A `--free` with nothing asked for is refused, or
   at the very least named in `show`: a bare `free` row turns the Manager back into a poller, and
   an idle seat that the owner has to notice is exactly the defect this contract closes.
8. **`audit-waiting` — the wait column obliges someone.** The tool lists every 🟡 blocked row and
   judges it: the "Waiting for" cell must name a seat by its ADDRESS (matched on word boundaries
   that understand the project's script, not ASCII `\b`); a named seat that is not 🔴 busy means
   "nobody is working on what you wait for"; an unnamed addressee means "nothing to check". Any
   such row is an ALARM: non-zero exit code, and the Manager reacts before anything else (reassign,
   unblock, or clear). Proven red on a fixture with a dead addressee and a nameless wait.

Suggested command surface (adapt names to the project):

```
<board-tool> set [--busy|--free|--blocked] [--doing "…"] [--waiting "<address>: …"]   # my row only
<board-tool> set --free --asking "<candidates>"                   # freeing ASKS: the row carries the request
<board-tool> lock <resource> | unlock <resource>                  # singleton locks (N slot rows for capacity N)
<board-tool> show                                                 # print the board
<board-tool> audit-waiting                                        # blocked rows judged; exit ≠ 0 on an alarm
<board-tool> set --role <r> …                                     # Manager-only: clear a stale/offline row
```
