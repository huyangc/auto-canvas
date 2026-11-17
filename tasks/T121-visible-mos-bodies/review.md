# T121 review

## Round 1 — changes requested

Implemented by a Claude subagent (Opus). Reviewed: the implementer's corpus
reports and renders; the reviewer looked at `qzszatannt` and `8szwjcnvxz`.

Round-1 result (variant B: bodies drawn on the selected layout, device poses
identical to the T120 base): 19 plans changed, all body cases; +10 crossings
(all val), +62 bends, +2940 wire; label clearance violations +29; 2 audit unit
tests outside the owned paths fail.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `routeVisibleBulkConnections`, `drawVisibleBodies` | The task's goal is to draw the body connections **the source draws**. Round 1 draws every body `mosBulkShouldBeVisible` asks for, including bodies the source shows with no lead. In `qzszatannt` the original has no body leads at all; the result adds six dashed loops and 5 crossings. | Draw a body only when the source drawing has an authored lead on that body pin (`hasExplicitMosBulkRoute` in `@icm/derived` if it means exactly that — check; otherwise: the B pin is a Route endpoint in the source). A body the source leaves without a lead stays without one. An authored body that cannot be drawn on the final layout is reported under R14 as in round 1. |
| 2 | must-fix | `packages/auto-layout/src/routing-audit.ts` | Counting every `mosBulkShouldBeVisible` body in `missingConnections` / `floatingPins` makes hand drawings without body leads count as defective and breaks two audit tests (`route-quality.test.ts`, `routing.test.ts`). | Revert the audit to the T120 state (bulk pins excluded) and drop `deferVisibleBodies`. Loss of an authored body lead is detected by the planner's own R14 report in this task; an evaluation check that compares body leads of source and result is a follow-up in `scripts/visible-integrity.mjs` (not this task). `pnpm vitest run packages/auto-layout` must pass with no test outside the owned paths edited. |
| 3 | must-fix | label seating | Bodies are drawn after label seating; leads run through instance labels (`8szwjcnvxz`: both leads strike the M1/M2 labels; clearance +29 on the corpus). | After drawing bodies, run the planner's existing label repair/reseat for labels struck by the new leads (find the function the pipeline already uses after rerouting; do not write a new seater), or rank body targets with label strikes as a cost before crossings. Corpus label clearance and label overlaps must not be worse than the T120 base by more than a handful; list every case that is. |
| 4 | should-fix | `planAutoLayout` wrapper | T122 also wraps `planAutoLayout`. | Keep this task's change to that function as small as possible (one call); note the exact lines so the two can be merged. |
| 5 | note | step-2 table | With finding 1 the set of drawn bodies shrinks (census: 32 of 53 required bodies have an authored lead). | Redo the corpus table for the authored bodies only. |

Expected after round 2: plans change only in cases with an authored body lead;
the val crossings increase is much smaller than +10; `qzszatannt` equals the
base.

## Round 2 — accepted

All five findings addressed.

- A body gets a lead exactly when its B pin ends a Route in the source (34
  bodies in 18 corpus cases; `hasExplicitMosBulkRoute` only sees dashed leads
  and misses two solid ones, so the Route-endpoint rule is used).
- `routing-audit.ts` equals the T120 state; the two audit tests pass untouched.
- Instance labels struck by a new lead are reseated with the pipeline's R73
  seater; corpus label clearance +3 (dev 193 → 195, val 77 → 78), overlaps
  unchanged.
- `planAutoLayout` is one call around the unchanged body (`planSelectedLayout`).

Acceptance rerun by the reviewer:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors (3506 warnings; 3500 on the base)
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (803 files, 8269 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> → 0 (by the implementer; report read by the reviewer)
```

Corpus against the T120 base: 628 completed and equivalent; 18 plan hashes
changed, all cases with a source body lead; device poses identical. Totals
(crossings / bends / wire): dev 229 / 1900 / 411834 → 229 / 1938 / 413170,
val 138 / 808 / 179356 → 143 / 823 / 180424. On the 18 cases the hand drawings
have 10 crossings and 112 bends; the results 23 and 133.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | lead shape | Each body is led to its target on its own. Where the source joins several bodies and takes one lead to the rail (`8szwjcnvxz`), the result draws two leads and two crossings. | follow-up: join bodies of one group first |
| 2 | note | val crossings +5 | `8szwjcnvxz` +2, `d8nv5m7cje` +1, `vbhxg297an` +2: placement does not see the leads. | follow-up with finding 1 |
| 3 | note | one sealed case | One authored body cannot be drawn safely and is reported under R14. | none |
| 4 | note | evaluation | No evaluation check compares body leads of source and result; the planner's own R14 report is the only signal. | follow-up in `scripts/visible-integrity.mjs` |
