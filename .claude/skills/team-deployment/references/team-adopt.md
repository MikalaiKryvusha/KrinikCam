# team-adopt — the adopt path for a team that ALREADY runs

> Reference from the KAIF `team-deployment` skill (operation 2, step 0). A live team is never
> designed from scratch and never overwritten by the templates: its constitution, board and tools
> are INVENTORIED against the canon, the delta goes to the owner as a decision, and only approved
> items are applied — around the owner's recorded words. Distilled from a field team that had to
> invent this path on the spot while the skill knew only greenfield (2.4 field report).

## When this path binds

Any of these on disk means a live team, not a greenfield: a `TEAM_CONSTITUTION.md` (or its
equivalent under another name), a status board with a board tool, role workspaces, a naming
pattern for seats. Then operation 2 starts HERE, operation 3 applies only what the owner approved,
and "materialize" never copies a template over a live document.

## Step 1 — inventory: the live team against the canon, item by item

Read the live documents and tools in full; then fill one row per item below. Compare CONTRACTS,
never wording — a local rule that says the same thing in the owner's words is a match.

| Canon item | Where the canon states it | What to compare in the live team |
|---|---|---|
| Nine invariant sections | constitution template § 1–9 | each section present in substance; which parameters differ |
| Naming invariant + the manager's exception | constitution § 1 | seat address = directory = branch; the manager's seat is the main copy |
| Communication regimen (nine rules, re-send throttle) | constitution § 2 | assignment and report forms; the undelivered-message rule |
| Escalation through the manager | constitution § 3 | does any role address the owner directly? |
| Git discipline incl. the push boundary and CI | constitution § 5 · `team-ci-template.md` | merges via the manager after a verdict; a role pushes its own branch; CI on role branches |
| Numbering at merge | constitution § 6 | `NEW_<slug>` placeholders or an equivalent |
| Singletons, locks, capacity N | constitution § 7 | lock rows; seat ≠ slot |
| Context budget | constitution § 8 | portions sized to one session |
| Launch and stop incl. lock release | constitution § 9 | fresh `main` before the resume ritual; locks and waits cleared on stop |
| Board: four states as roles · contract items 1–8 · lives outside git | board template | the states; `audit-waiting`; the `.gitignore` line or a named opt-out |
| Role contracts | roles library (contract form) | mission · decides alone / needs approval · escalates when — the load-bearing minimum |
| Archetype fit | roles library | the nearest archetype; seats without independent work |

## Step 2 — sort every delta into three buckets

- **matches** — the live team already holds the invariant, in its own words. Nothing to do;
  record the row.
- **bring-to-canon** — the live team lacks or weakens an invariant. A CANDIDATE change, for the
  owner to approve; never applied on the agent's authority.
- **better-than-canon** — the live team holds a rule stricter or wiser than the template (a
  field team's push-delegation boundary, capacity as N lock rows and the re-send throttle all
  entered the canon this way). This bucket is a SIGNAL TO THE ORIGIN — file it with
  `/report-bug` (template B, an improvement request) — and never a defect of the team.

A delta the agent cannot place is a question to the owner, not a guess (the three doors).

## Step 3 — the owner decides BEFORE any change

Put the delta to the owner through the project's question channel (an interview or the review
contour), one row per bring-to-canon item: *what the canon says · what the team does · the price
of the gap · recommendation*. **Two owner's words on one parameter** — a naming pattern recorded
before the canon arrived against the canon's, a local lock rule against § 7 — is a fork the agent
does not settle: the PROJECT OWNER's word wins by default, and the choice is written at the
decision point as `FORK: options <local | canon> · price of error <…> · consulted <owner>`; local
names that carry the owner's word stay legitimate under a note in the constitution.

## Step 4 — apply only what was approved, around the owner's words

- Add approved sections and rules INTO the live constitution — never replace the document; the
  owner's recorded words survive byte-wise except the approved additions.
- A board tool that already holds the contract is a match; a missing item (e.g. `audit-waiting`)
  is built to the contract, not by replacing the tool.
- The CI is operation 3, step 6 — by the owner's yes, like every materialized artifact.
- Record the delta table and the owner's decision in a plan or research document of the project;
  the retrospective (operation 5) reads it.

## Done when

- The inventory table exists with every row sorted into a bucket.
- The owner's decision on each bring-to-canon item is recorded (approved / declined / later).
- Approved items are applied; the diff of the live constitution shows ONLY those additions.
- Every better-than-canon item has a ticket to the origin, or a named reason why not.

## Anti-patterns — refuse

- **A template over a live document** — "materialize" onto an existing constitution or board.
- **Reconciling by rewriting** — restating the owner's rule in the template's words.
- **Stricter-as-defect** — treating a local rule tougher than the canon as a deviation to fix.
- **Silent adoption** — applying bring-to-canon items because "the canon says so".
