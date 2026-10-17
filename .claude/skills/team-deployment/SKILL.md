---
name: team-deployment
description: Design and deploy a TEAM of AI agents for a project — analyze the project's work profile, suggest an evidence-informed team composition (roles, archetype, sizing), and deploy it as isolated workspaces governed by a generated Team Constitution and a shared status board. Optional skill; distilled from a live field team (six roles in git worktrees) and 2026 multi-agent research. KAIF fixes the methodology (what must hold); the project's agent builds the tools (how). Use when the owner says "deploy a team", "set up an AI agent team", "organize a team of agents", "разверни команду", "организуй команду агентов", "команда агентов", or asks to parallelize work across several agent sessions. NOT for spawning subagents inside one session — this skill deploys long-lived parallel sessions in their own workspaces. Trigger aliases (ru): «разверни команду», «организуй команду агентов», «команда агентов», «развёртывание команды»
---

# /team-deployment — deploy a team of AI agents

One KAIF agent is disciplined by the canon; a TEAM of agents needs an ORGANIZATION — explicit
roles, an addressing scheme, a communication regimen, a status board, git discipline, and rules
for the machine they share. This skill turns a hand-built field practice into a repeatable
deployment: it analyzes the project, suggests a team design, and materializes it.

The guiding principle (and the first sizing rule):

> **Optimize the organization of cognitive work, not the number of agents.**
> Do not spawn agents because you can. Spawn them because the work graph justifies them.

Five references ship with this skill in `references/` — four templates to copy and adapt (never
invent from memory) and the adopt path for a team that already runs:

| Reference | Becomes (suggested name) |
|---|---|
| `references/team-constitution-template.md` | `TEAM_CONSTITUTION.md` — the team's operating canon |
| `references/team-status-board-template.md` | `TEAM_STATUS.md` — the live status board (ignored by git) |
| `references/team-roles-library.md` | role sections pasted into the constitution + role instructions |
| `references/team-ci-template.md` | `.github/workflows/team-ci.yml` — the CI that ships with the team |
| `references/team-adopt.md` | no file — the adopt path: inventory · three-bucket delta · the owner's decision |

**Boundaries of this skill (deliberate).** It delivers METHODOLOGY as markdown: constitution,
board, role contracts, archetypes, procedures. It does NOT deliver an orchestrator: no scheduler
machinery, no YAML schemas, no metrics automation, no auto-reconfiguration — a team of disciplined
KAIF agents coordinated by a manager role needs none of that to start, and the field team proved
it. Tools the constitution requires (status-board updater, workplace manager) are built BY THE
PROJECT'S AGENT to the contracts in the templates — same rule as the review contour: KAIF fixes
what must hold; the project builds how.

**Team mode ADDS to the canon, never replaces it.** Every role works by the full KAIF framework
of the project within its specialization and its zone of responsibility. The constitution binds
on top of `AGENT_GUIDE.md`, not instead of it.

## Operation 1 — analyze: profile the project before proposing anyone

Never start from "how many agents do you want". Start from the work.

1. Read the project canon (`STATUS.md`, `MASTER_PLAN.md`, the maps) and name the **project
   profile** in categories, not numbers: type · domain · maturity · size · complexity · risk ·
   UI complexity · verification difficulty · parallelism potential · dependency density ·
   expected duration.
2. Name the **required capabilities** — the kinds of expertise the work actually needs (product
   reasoning, architecture, UI design, implementation, verification, release…), each with:
   required or optional · risk level · rough volume · whether it demands INDEPENDENCE (a judge
   must not judge their own work).
3. Name the **constraints of the machine and the owner**: how many parallel sessions the hardware
   and the owner's attention sustain; which resources are singletons (test stand, emulators,
   ports, deploy door); how much human time exists for approvals.

Output: a short analysis note (a plan or research doc per project convention). No team yet.

## Operation 2 — suggest: an evidence-informed team design, approved by the owner

0. **A team ALREADY runs here → the adopt path (`references/team-adopt.md`), not a design.**
   Inventory the live constitution, board, tools and names against the canon → sort every delta
   into *matches* · *bring-to-canon* · *better-than-canon* (a SIGNAL TO THE ORIGIN, not a defect)
   → the owner decides BEFORE any change → apply only approved items around the owner's recorded
   words; two owner's words on one parameter → the project owner's wins, as a `FORK:`. Operation 3
   then applies ONLY the approved bring-to-canon items — never copy over a live constitution.
   **Run `node .kaif/kaif-core.mjs check` at the START of the inventory:** every obligation of the
   template it names as lost is a *bring-to-canon* candidate the owner has not yet been asked
   about — and one the live constitution never had, rather than one it gave up.
1. Pick the nearest **archetype** from `references/team-roles-library.md` (web-product-small ·
   web-product-medium · hardware-lab-small — the last whenever one physical singleton under test
   serializes the core work) and adapt: activate optional roles only when their condition holds
   (architect — architecture complexity at least medium; designer — UI complexity at least
   medium; second/third engineer — parallelizable work exceeds one engineer's sustainable pace).
2. Size by the starting heuristics — then justify every seat:
   - low complexity → 1–2 agents · medium → 3–6 · high → 5–9, staged;
   - every added agent must be paid for by INDEPENDENT work that exists without inventing it;
   - coordination is a cost: if a seat adds more synchronization than parallel work, cut it.
3. Check the design against the **anti-patterns** (below). Kill what matches.
4. Present the design to the owner as a decision — composition, who reports to whom, what each
   role owns, what stays with the owner — through the project's question channel (interview or
   review contour). **The team composition is an owner-level decision**: it spends the owner's
   machine, money, and attention. Deploy nothing before the owner's yes.

## Operation 3 — deploy: materialize the approved design

1. **Constitution.** Copy `references/team-constitution-template.md` → `TEAM_CONSTITUTION.md`;
   fill the placeholders (team name, roles map, project resources, singleton locks); paste the
   role contracts of the chosen roles from the library; delete roles the design did not take.
   The nine invariant sections stay — they are the paid-for field lessons, not decoration.
   🔴 **Then run `node .kaif/kaif-core.mjs check` and read its lines about the constitution** —
   the generated document must retain EVERY obligation of the template it came from. Deleting a
   *role* is legal; deleting a *rule* is loss, and a shorter document looks like editorial
   tightening (origin issue #68: a generated constitution kept 5 of the template's 9 § 2 rules and
   no gate said a word). The axis names each lost obligation; restore it, or declare the omission
   beside the item with `<!-- constitution-ok: <why> -->` — the owner's decision, written down.
2. **Status board.** Copy `references/team-status-board-template.md` → `TEAM_STATUS.md` (one row
   per role) **and add it to `.gitignore` in the same motion** — the board is session state, not
   history (template → "Where the board lives"; the named opt-out is the owner's). Build or adapt
   the board updater tool to its contract (in the template): one board per team, reachable from
   every workspace; each role rewrites ONLY its own row; atomic writes; `audit-waiting` alarms.
3. **Workspaces.** One isolated workspace per implementation role; the manager works in the main
   copy. For git projects the reference mechanism is `git worktree` with the naming invariant
   **session address = directory name = branch name = `<project>-team-<role>`** (owner's word on
   the pattern): the project prefix keeps team windows distinguishable from other projects on
   the same machine, the `team` infix marks the window as a team seat at a glance, the suffix
   names the seat. Build the workplace tool to the contract in the constitution template
   (create / list / reset-from-main / remove). Each workspace CALLS the owner under its seat's name — the contour derives it from
   the directory (`<role>`; `KAIF_SESSION_NAME` overrides), so a call says which seat needs the owner (2.8, `/owner-reviews` I28b).
4. **Role instructions.** For each seat, prepare the manager's briefing message from the role
   contract: you are <Role> · your zone · read the constitution in full · run the project's
   resume ritual on a FRESH main · announce yourself on the board · report readiness.
5. **Launch.** The owner opens one window per role and types one line per window (the session
   rename to the role address). Everything else is the manager's job: fresh `main` for every
   role BEFORE their resume ritual, then briefings, then task dispatch — **at first launch**,
   whenever the owner opens the windows; before that, honestly report "waiting for windows".
6. **CI travels with the team** (the owner's order, origin issue #29). Materialize
   `.github/workflows/team-ci.yml` from `references/team-ci-template.md` — the fenced block plus
   its five constraints (cheap gates only, commands READ from `package.json` / the build canon,
   red CI blocks the merge per constitution § 5, a non-GitHub remote gets the same job as the
   named pre-push script). Like every artifact of this operation: by the owner's yes.

## Operation 4 — status: the board is the team's shared truth

The manager reads the board before dispatching and watches team health: friction, idle roles,
bottlenecks, uneven context load. Every role updates its row at every state change (took a task ·
waiting on someone · freed). The board shows the moment; the project's `STATUS.md` still carries
the handover between sessions — the board never replaces it.

## Operation 5 — retrospective: after a milestone, judge the ORGANIZATION

Triggers: a milestone — **and dormancy**: the windows are closed, solo sessions continue, and
role branches sit unmerged — that is silent organizational debt, and it opens a retrospective
exactly like a milestone does. The board as it stood at the end of the shift is copied into the
retrospective document (the board itself is not in git — template → "Where the board lives").
Answer in writing: was the team correctly staffed · which roles were overloaded / underutilized ·
which capabilities were missing or duplicated · where did coordination become the bottleneck ·
which verification gates caught real defects · what changes next deployment. Proposed changes must
be explicit, not generic observations. Reconfiguration (add/remove/merge seats) is redesign:
run suggest again on the evidence and take the owner's yes. Persist lessons in the project's
experience journal — the next team starts smarter.

## Anti-patterns — detect and refuse

- **Agent explosion** — more agents than independent work.
- **Manager bottleneck** — all work waiting on one overloaded coordinator.
- **Verification collapse** — no independent verifier despite elevated risk.
- **Role duplication** — two seats doing the same reasoning.
- **Shared workspace mutation** — two agents writing one workspace.
- **Authority ambiguity** — two roles believing they own one decision.
- **Unbounded collaboration** — permanent high-bandwidth chatter between many roles.
- **Bureaucratic overengineering** — an organization more complex than the project.

## The paid-for field lessons (why the templates say what they say)

These cost a live team real incidents; they ride in the constitution template and are the reason
this skill exists as distillation rather than theory:

1. **Fresh `main` BEFORE the resume ritual — and it is the MANAGER'S duty.** A role refreshing
   its context on a stale branch reports stale numbers with full confidence: it honestly read
   what it had.
2. **Document numbers are assigned by the manager at merge.** Role branches cannot see each
   other; "next free number" collides. Roles create `NEW_<slug>` placeholders.
3. **An undelivered message is NOT rerouted to a stranger.** Other projects' sessions live on the
   same machine. The result already lives in artifacts (branch, board row); note "report
   undelivered" on the board and finish.
4. **Context windows are a resource the manager balances.** Big work is cut into one-session
   portions; heavy tasks alternate between seats; a role feeling context pressure says so in one
   line — that is a resource signal, not weakness.
5. **The status board lives in ONE place** reachable from every workspace, or every role gets a
   private board nobody reads.
6. **Singleton resources take a lock on the board** (stand, emulators, ports): take → run →
   release; holding "just in case" is forbidden.
7. **Merges only through the manager, only after the verifier's verdict.** Push rights may be
   locked for roles — then the manager reviews and pushes; two different doors, both stay.
8. **A finished seat announces itself FREE, naming candidates** (constitution § 2 rule 6; origin
   issue #68). A seat that has closed its task and has no next one is indistinguishable from a
   working one — to itself: no error, no red gate, no debt line. So the announcement is an
   obligation with an exit condition, not a courtesy, and the board row carries the same request;
   an idle the OWNER had to end is a defect, and one idle seat in six is 17% of the team spent in
   silence. The obligation is inverted relative to its cost until it is written down: a blocker is
   felt by the agent, availability only by the dispatcher.

## Done when

- The owner approved the team design (composition, reporting lines, ownership).
- `TEAM_CONSTITUTION.md` and `TEAM_STATUS.md` exist, filled from the templates.
- `node .kaif/kaif-core.mjs check` says nothing about `TEAM_CONSTITUTION.md` — every obligation of
  the template survived generation, or the omission is declared beside the item with
  `<!-- constitution-ok: <why> -->`; run it and READ the lines, never assume the copy was faithful.
- Board and workplace tools exist to their contracts and are proven on a broken case
  (a foreign-row edit refused; a stale lock recovered).
- Every seat has a workspace, a briefing, and a fresh-main start; `team-ci.yml` exists (or the
  named pre-push script for a non-GitHub remote) and the board is ignored by git.
- At first launch, the first dispatch round completes: tasks assigned in the constitution's
  message form, reports came back in the report form (before the windows open: "waiting for windows").
- A live team was ADOPTED, not overwritten: the owner's decision on the delta is recorded and the
  local constitution's wording survives byte-wise except the approved additions.
