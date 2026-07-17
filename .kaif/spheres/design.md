# Sphere: Design (product / graphic / UX)

## Thesis intro

A design project shapes how something looks, feels, and works for people. The human owns taste, brand,
and the creative vision; the AI executor explores options, drafts, critiques against principles, and
maintains the system. Verification is fitness to brief, consistency with the design system, and user fit
— inherently more subjective, so owner interviews matter more.

## KAIF entity mapping

| KAIF base | In this sphere |
|-----------|----------------|
| `bugs/` | inconsistencies, accessibility issues, off-brand elements, usability problems |
| release | a finished, handed-off design: a published mockup, a shipped design-system version |
| build | producing the deliverable: exporting assets, compiling the design system, prototyping |
| test / verify | design review, heuristic/accessibility checks, against the brand & system |
| `plans/` | design roadmap, the design system, ideas for explorations |
| interview | brand, visual language, key UX decisions — **frequently** the owner's call |

## Key terms (brief glossary)

- **design system** — the reusable components/tokens/rules that keep work consistent.
- **brief** — the stated goal/constraints a design must satisfy.
- **heuristic review** — checking against usability/accessibility principles.

## Minimum evidence set (binding — before any pixel)

1. The design system's own rules: the brand doc, design tokens, component conventions — opened; if none
   exists, say so before inventing one.
2. The existing neighboring surfaces — actually looked at, so new work belongs to the same family.
3. The interaction states the surface must serve: hover, focus, loading, error, empty, overflow — not
   just the happy path.

## Authority order

Explicit owner/client direction > the brand doc and design tokens > the referenced design file > existing
component conventions > your aesthetic preference. Classic conflict: "make it pop" does not override a
token system — surface the conflict.

## Verification by observation

- The surface is actually rendered and looked at (screenshot or live), at more than one width if
  responsive; unrendered UI work is unverified by definition.
- Colors, spacing, radii, and type trace to tokens, not hardcoded values (grep for raw hex/px beside an
  existing token system).
- Accessibility is checked, not asserted: contrast computed, focus visible, labels present, keyboard path
  walked.
- All states from the minimum evidence set exist and were seen, including error and empty.

## Fraud table (for `fable-judge`)

| Fraud | Symptom |
|---|---|
| Unrendered "done" | "matches the design" with no render or screenshot performed |
| Token betrayal | hardcoded hex/px/fonts beside an existing token system |
| Asserted accessibility | "WCAG compliant" with no contrast/keyboard/label check shown |
| Happy-path-only | error, empty, loading, overflow states missing, unmentioned |
| Off-family surface | new work visibly foreign to neighboring pages, unflagged |
| Placeholder debris | lorem ipsum, dummy images, dead links left in "finished" work |

## Done, by example

"The page is done" means: rendered and reviewed at two widths, every value from tokens, contrast computed
on new color pairs, all states present, consistent with sibling pages. Not: "the component compiles and
looks fine."

## Adaptation notes

- `/interview` is used **more** here — taste/brand/UX are owner-level by nature.
- The "harness" = objective checks where possible (contrast ratios, spec conformance) over eyeballing.
- Keep accumulated critique in `bugs/` so design debt isn't forgotten.
