# Sphere: <SPHERE NAME>

> Template for a KAIF sphere library. Copy to `framework/spheres/<sphere>.md` and fill in. Keep it
> concise — a thesis intro + a term glossary + an entity mapping (the terminology half), then the
> **discipline half**: what the agent must open before acting, whose word wins, what "verified" means
> here, and what the frauds look like. The agent reads this to "get" the domain quickly at deploy time;
> `fable-method` reads it before gathering evidence; `fable-judge` hunts non-code work by its fraud table.
> (Discipline-section schema adapted from the domain adapters of
> [fable-method](https://github.com/Sahir619/fable-method), MIT.)

## Thesis intro (what working in this sphere is like)

`<2–4 sentences: the nature of work in this sphere, what "a project" and "progress" look like, what the
human-visionary vs. AI-executor split tends to be here.>`

## KAIF entity mapping (how base concepts read in this sphere)

| KAIF base | In this sphere |
|-----------|----------------|
| `bugs/` (defects) | `<what counts as a defect/anomaly/observation here>` |
| release | `<what "shipping a finished increment" means here>` |
| build | `<what "producing the artifact" means here>` |
| test / verify | `<how correctness/quality is verified here>` |
| `plans/` (roadmap) | `<the planning unit/cadence here>` |
| interview (owner decision) | `<the kinds of decisions that are the human's alone here>` |

## Key terms (brief glossary)

- **`<term>`** — `<one-line definition>`
- **`<term>`** — `<one-line definition>`
- …

## Minimum evidence set (binding — open these before acting, every time)

1. `<the governing document or ground truth of this sphere, and what to do when it does not exist>`
2. `<the subject's own primary material that claims must trace to>`
3. `<one live external reference — fetched now, not recalled>`

## Authority order

`<A single ordered chain using ">", from explicit owner/user instruction down to your own preference or
memory. Then one sentence: the sphere's classic conflict and which side wins.>`

## Verification by observation

- `<3–5 bullets: what "observed" (not inferred) means for this sphere's claims — the checks that must
  actually be run, opened, recomputed, or looked at; exactness requirements.>`

## Fraud table (for `fable-judge`)

| Fraud | Symptom |
|---|---|
| `<name the fraud in 2–3 words>` | `<the observable symptom a judge can hunt by diffing, re-running, or re-fetching>` |
| … (4–7 rows) | |

## Done, by example

"`<A typical deliverable>` is done" means: `<the observed checklist in one sentence>`. Not:
"`<the sphere's classic hollow claim>`".

## Adaptation notes

`<Anything the agent should emphasize or de-emphasize in this sphere: which skills matter most, what the
"harness" (objective verification) looks like, domain-specific cautions.>`

## Sources (for spheres authored on demand)

`<When you author a new sphere at deploy time: one line per regulation, policy, figure, or practice the
sphere names — the link plus the access date. A claim with no source is memory wearing a suit; fetch it
or cut it. Prebuilt spheres in this repo are maintained with the framework itself.>`
