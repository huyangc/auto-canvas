# T018 — Auto-layout optimization iteration 2: estimator fidelity and placement search

- Branch: `task/T018-auto-layout-iter2`
- Base: `task/T017-auto-layout-iter1` at `a276360` (stacked on PR #20)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user asked for repeated optimization rounds, stopping once two consecutive rounds
improve the main metric by less than 5%. The main metric is **total crossings over all
completed human cases**. T017 ended at **755** (bends 766, floating pins 82, 32
completed), a 0.3% improvement: the first round under 5%. If this round is also under
5% (above 717), the iteration stops.

This round targets the cause T017 found: placement search is guided by objectives that
do not measure what the router draws.

## Context

### Where the gap is

The human drawings total 115 crossings over the same documents. An earlier experiment
held the human placements fixed and ran our router: 176 crossings. Our placement plus
our router gives 755. **Placement is the gap; do not change the router.**

### The objectives placement uses

- **R32 row order** (`orderRows`, `src/layered.ts:290`) minimizes inversions between
  adjacent rows and same-row Net spans. T017's investigation showed it does not score
  horizontal-trunk and branch intersections, so a compact order can still route with many
  crossings.
- **R54 estimator** (`createPlacementEstimator`, `src/estimate.ts`) draws each signal
  Net as an L-shaped minimum spanning tree and counts strict H/V intersections. It skips
  rails and MOS bulk. Only the stage strategy uses it (`src/stages.ts:464-560`): for block
  order, mirroring and attachments. The router instead draws R39 trunks for Nets with
  three or more pins, rail trunks above and below the rows (R38/R43), and marker stubs.
- **Routed refinement** (`refineLayout`, `src/refine.ts`) is exact but costly. It
  replays whole plans and only flips sides and orientations: up to 14 candidates through
  40 instances, none above.

Nobody has measured how well the R54 estimate predicts routed crossings.

### Binding constraints from earlier tasks

- The human cases are third-party drawings in git-ignored `tmp/human-cases/`. Never
  commit any of them, any excerpt, any case id, or any id-keyed derived data. Nothing in
  CI or `pnpm test:local` may depend on them.
- Tune on dev only (`sha256(id) % 3 != 0`); report val separately.
- R10, R23 and `lostNameClaim` stay as they are. The router does not change.
- Planning stays deterministic and within 12 s per document on the evaluator.

## Scope

Owned paths: `packages/auto-layout/**`, `docs/specs/auto-layout.md`,
`scripts/auto-layout-eval.mjs`, `scripts/auto-layout-review.mjs`. Throwaway probes go
in git-ignored `tmp/`.

Out of scope: the router and Edit Engine, the lock field and editor button (T014),
everything T016 excluded.

## Steps

1. **Investigate: estimator fidelity.** On dev documents only, collect placements that
   the planner actually routes: the three portfolio candidates and every refinement
   candidate. For each, record the R54 estimate and the routed crossings
   (`auditRouting`). Report Spearman rank correlation per document and pooled, and the
   largest systematic misses by cause. Causes could be trunks, rails, marker stubs, or
   Nets the estimator skips. Keep raw data in `tmp/`.

2. **R64 Router-shaped estimate.** Change R54 so it draws each Net the way the router
   will, using rules that already exist:
   - R39's trunk choice for signal Nets with three or more pins;
   - rail trunks for supply and ground per R38/R43;
   - Cell Pin and marker stubs.

   Share one helper with the router if it exists, without changing the router's output.
   Report fidelity again as in step 1. Keep the change only if pooled correlation
   improves.

3. **R65 Estimated placement search.** After column assignment, and before routing, run
   a bounded deterministic local search driven by the step 2 estimate. Do this in the
   layered strategy and inside each stage of the stage strategy. Moves:
   - swap two adjacent nodes in a row, carrying their grouped members;
   - mirror one ungrouped device.

   Keep R33 alignment, group templates (R2/R3), fixed instances and the R40 integer grid.
   Bound the search by estimator calls, scaled by size, so documents above 40 instances
   also benefit. Accept only strict improvements, in a fixed visiting order.

4. **Tests.** Hand-built only:
   - the router-shaped estimate counts a trunk crossing that the spanning-tree estimate
     misses;
   - the search removes a known crossing in a two-row fixture;
   - the search never moves a fixed instance or splits a group;
   - results are deterministic and the input document is unchanged.

5. **Report** as in T017:
   - main metric, against `tmp/t017-final-eval.json` (755), by dev and val, completed,
     bends and floating pins;
   - percentage change;
   - corpus and held-out;
   - planning time against size;
   - fidelity before and after step 2;
   - effect of each step alone;
   - six rendered pairs, including both largest documents.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Round targets, against `tmp/t017-final-eval.json`:

| Measure                      | T017 | Required  |
| ---------------------------- | ---: | --------- |
| Main metric                  |  755 | lower     |
| Completed documents          |   32 | not fewer |
| Bends, all completed         |  766 | not above |
| Floating pins, all completed |   82 | not above |
| Slowest document             |    — | ≤ 12 s    |

Corpus targets and held-out ceilings must hold.

## Notes for the implementer

- One general mechanism per step. Never key behavior to a case, Reference, instance id
  or symbol id.
- If dev improves and val does not, say so.
- If step 1 shows the estimator already predicts routed crossings well, say so. Then do
  step 3 with the existing estimator and skip step 2.
