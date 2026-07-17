# KAIF spheres — universal adaptivity across domains

KAIF is not only for programming. The same method (externalized memory, bounded autonomy, simplicity,
living docs, the lifecycle) serves any domain where a human visionary works with an AI executor:
mathematics, physics, space, biology, medicine, sociology, education, design, project management,
advertising, sport, nutrition, finance, law, music, writing, and more.

A **sphere** tailors the deployment to the project's domain: which terminology to use, what a "bug",
"release", "test", or "build" *means* there, and which guidance/skills to emphasize. The framework's
structure stays the same; the **language and term libraries** adapt.

Since KAIF 1.5 a sphere library also carries the domain's **execution discipline** (schema adapted from
the domain adapters of [fable-method](https://github.com/Sahir619/fable-method), MIT): a **binding
minimum evidence set** (what must actually be opened before acting, every time), the **authority order**
(whose word wins in the sphere's classic conflict), what **verification by observation** means there,
a **fraud table** that `fable-judge` hunts on non-code work, and a one-sentence **"done, by example"**.
A sphere changes only the nouns, never the loop (`fable-method`); medical/clinical work deliberately has
no sphere adapter — it needs qualified review, not a checklist.

## How sphere adaptation works (at deploy time)

1. The agent determines the project's sphere — by inspecting the project and/or asking the human.
2. It records the sphere in `.kaif/kaif.json` → `sphere`.
3. It uses the matching sphere library below (or `_template.md` to author a new one) to adapt the
   deployed wrapper's terminology — e.g. mapping KAIF's base entities to the sphere's language:
   - `bugs/` → defects/issues/observations/anomalies/symptoms (per sphere)
   - "release" → the sphere's notion of shipping a finished increment
   - "test/build" → the sphere's notion of verification and producing an artifact
4. It gives the agent a brief thesis introduction to the sphere (a term library) so it understands the
   vocabulary it will meet in the project's docs and tools.

## Sphere libraries

A sphere library (`framework/spheres/<sphere>.md`) is a concise term glossary + an entity mapping +
adaptation notes. Authored ones in this repo:

- **`programming.md`** — the reference sphere (worked in full).
- **`science.md`**, **`design.md`**, **`business.md`** — concise examples across very different domains.

Other spheres (math, physics, space, biology, medicine, sociology, education, project-management,
advertising, sport, nutrition, finance, law, music, writing, …) are authored **on demand from
`_template.md`** at deploy time — that's the point: KAIF adapts to *your* sphere even if no prebuilt
library exists yet. Contributions of new sphere libraries are welcome.

## Generic fallback

If the sphere is unknown or cross-disciplinary, use programming-neutral wording: "issues" for `bugs/`,
"milestone/version" for release, "verification" for testing. KAIF still works — sphere adaptation is an
optimization, not a prerequisite.
