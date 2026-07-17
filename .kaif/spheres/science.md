# Sphere: Science / Research (math, physics, biology, …)

## Thesis intro

A research project pursues understanding: questions → hypotheses → experiments/proofs → results. The
human sets the research vision and judges significance; the AI executor surveys literature, derives,
computes, runs analyses, and documents rigorously. Verification is reproducibility and peer-checkable
reasoning, not "it compiles".

## KAIF entity mapping

| KAIF base | In this sphere |
|-----------|----------------|
| `bugs/` | anomalies, failed reproductions, flawed derivations, contradicting data |
| release | a finished result: a proof, a paper/preprint, a dataset, a reproducible analysis |
| build | producing the artifact: compiling the paper, running the pipeline, generating figures |
| test / verify | reproduction, peer/self-review, statistical validity, derivation checks |
| `plans/` | research roadmap, open questions, hypotheses backlog |
| interview | research direction, methodology choices, what counts as a publishable result |

## Key terms (brief glossary)

- **hypothesis** — a testable proposed explanation.
- **reproducibility** — others (or a fresh run) get the same result from the same inputs.
- **preprint/paper** — the shipped, citable result.
- **derivation** — a step-by-step proof/calculation (the "code" of math).

## Minimum evidence set (binding — before any claim or analysis)

1. The primary material itself (the dataset, the paper, the derivation being extended) — opened, not
   summarized from memory.
2. The governing method: the procedure/statistic/proof technique behind this result, from its
   authoritative source.
3. One live external reference for any named figure, constant, or prior result — fetched now, cited.

## Authority order

The owner's research direction > the primary data > peer-reviewed sources > preprints/blogs > your
recall. Classic conflict: the analysis contradicts the cited literature — the discrepancy IS the finding;
never quietly adjust the analysis until it "agrees".

## Verification by observation

- Every number in the deliverable is recomputed from the data by a re-runnable script/pipeline, not
  transcribed by hand.
- Reproducibility observed: a fresh seeded run yields the result ("it worked once" is an anomaly, not a
  result).
- Every citation actually opened; quoted claims checked against the source's own words.
- Derivations checked step-by-step (or via an independent second path) before "proved" is claimed.

## Fraud table (for `fable-judge`)

| Fraud | Symptom |
|---|---|
| Fabricated citation | a referenced paper/figure that does not exist or does not say that |
| Cherry-picked data | excluded points/runs with no stated exclusion rule |
| Silent data cleaning | preprocessing that changes results, unmentioned |
| Post-hoc hypothesis | the hypothesis quietly rewritten to match the result |
| Unreproducible number | no seed/script/pipeline behind a reported figure |
| Stale constants | figures/constants from memory, not from a source |

## Done, by example

"The analysis is done" means: the pipeline re-ran from raw data end-to-end, the text's numbers match the
pipeline's output, every citation was opened, limitations stated. Not: "the notebook has the plots."

## Adaptation notes

- `bugs/` becomes a log of anomalies/failed reproductions; `/bug-research` maps perfectly to literature
  search + root-cause of a discrepancy.
- The "harness" = a reproducible pipeline (seeded, scripted) so results aren't eyeballed.
- `interviews/` capture methodology/direction calls that are the researcher's to make.
