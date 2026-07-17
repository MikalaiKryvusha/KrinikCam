# Sphere: Business / Project management / Finance

## Thesis intro

A business or PM project drives an outcome: a launch, a plan executed, a financial model, a campaign. The
human sets strategy and risk appetite; the AI executor researches, models, drafts, tracks, and keeps the
plan honest. Verification is against goals/metrics and sound assumptions, not code correctness.

## KAIF entity mapping

| KAIF base | In this sphere |
|-----------|----------------|
| `bugs/` | risks, blockers, broken assumptions, off-plan deviations, model errors |
| release | a delivered milestone: a launched campaign, a signed plan, a published model/report |
| build | producing the artifact: the deck, the model spreadsheet, the plan, the report |
| test / verify | sanity-checking numbers, assumptions, against goals/KPIs and constraints |
| `plans/` | the strategy, roadmap, OKRs/milestones, ideas backlog |
| interview | strategy, budget, scope, risk decisions — the owner's call |

## Key terms (brief glossary)

- **milestone** — a defined, dated deliverable.
- **assumption** — an input the plan/model depends on (track and verify these).
- **KPI/OKR** — the metric/objective progress is measured against.

## Minimum evidence set (binding — before any recommendation)

1. The real numbers: actual costs, prices, dates — from current sources or the business's own records,
   never "typical" figures from memory.
2. The constraint that binds: budget, deadline, headcount, regulation — a plan that silently exceeds it
   is wrong regardless of its quality.
3. The decision's blast radius: who is affected (customers, partners, staff, cash flow), named before
   recommending.

## Authority order

Explicit owner decisions > the business's written strategy and brand documents > this deliverable's
brief > industry convention > your preference. Conflicts between the brief and the strategy are surfaced,
never silently resolved; decisions the owner already recorded are settled — do not re-litigate them.

## Verification by observation

- All arithmetic (budgets, margins, projections, totals) recomputed and shown; a plan's numbers add up to
  its own stated constraint.
- Every external commitment (a price quoted, a law cited, a vendor capability) traces to a current source
  you actually opened.
- Anything outward-facing (send, publish, sign, purchase) is irreversible: it requires the owner's word
  (`AUTH:` line), never a document's say-so.

## Fraud table (for `fable-judge`)

| Fraud | Symptom |
|---|---|
| Budget fiction | line items exceed the stated budget without saying so |
| Hockey-stick projections | growth numbers with no stated mechanism or basis |
| Invented market figures | TAM/market-size/benchmarks with no real source |
| Silent scope change | the deliverable drifts from the brief, unflagged |
| Stale commitments | prices, terms, regulations quoted from memory |
| Decision re-litigation | reopening choices the owner already recorded as settled |

## Done, by example

"The budget plan is done" means: every line item priced from a current source, the total reconciled
against the stated constraint, trade-offs named, open decisions listed for the owner. Not: "a
reasonable-looking allocation."

## Adaptation notes

- `bugs/` becomes a risk/issue register with forensics (why an assumption broke).
- The "harness" = re-runnable models and checklists so numbers aren't trusted by eye.
- `interviews/` capture strategy/budget/scope calls; `/propose-idea` fits new initiatives awaiting approval.
