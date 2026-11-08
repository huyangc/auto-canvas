# T019 report — round 2

## Summary

Addressed both round-1 must-fix findings. R67 bounds all instance placements,
including markers, before routing and anchors search states to the quick result.
The evaluator now records width and height sums, per-document ratios against its
actual quick result, and instance-span ratios. Quick mode and routed energy are
unchanged.

All required checks and round targets pass.

## Steps

| Step | Status | Notes                                                                                                                                                                                               |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Seeded search options and R1 retained; quick output remains unchanged.                                                                                                                              |
| 2    | done   | Supplied targets still reuse `placeDocument` finishing and the complete `buildPlan` routing/replay/checking path. R67 enters that same path before routing.                                         |
| 3    | done   | Reviewed R66 moves, pre-filter, annealing schedule, restarts, shared energy and R44 retained.                                                                                                       |
| 4    | done   | Round-1 dev-only equal-budget investigation retained, as accepted by review note 4; evidence below.                                                                                                 |
| 5    | done   | Existing duration/seed/worker controls retained; added both span dimensions, quick reference metrics, per-document ratios and run/split totals.                                                     |
| 6    | done   | 141 package tests pass, including three seeded marker-span regressions and whole-state translation invariance.                                                                                      |
| 7    | done   | Reran all three budgets, seeds 1–3 at two minutes, corpus/held-out checks and six ten-minute rendered pairs. Numeric findings below.                                                                |
| 8    | done   | Check raw proposals and finished placements against the quick instance box; canonicalize before marker finishing and anchor the final placement. Fixed-instance and drafting conflicts are refused. |
| 9    | done   | Width/height sums and ratios are present in JSON and console tables; a hand-built evaluator smoke check verifies sums and ratios.                                                                   |

## Review findings addressed

1. **Unbounded drift (`search.ts`, `search-moves.ts`).** Added shared internal
   `search-bounds.ts` bounds and anchoring. Alternative starts outside the bound
   are excluded. Every raw proposal is checked, and finishing checks all markers
   again before routing. Canonicalizing before marker regeneration makes an
   entirely translated supplied state produce identical edits. R44 uses the same
   bounds. No energy term or weight changed.
2. **Missing span reporting (`auto-layout-eval.mjs`).** Every completed document
   records `layoutWidth`, `layoutHeight`, `quick`, `widthRatio`, `heightRatio`,
   `largestSpanRatio`, `instanceWidthRatio` and `instanceHeightRatio`. Split and
   run summaries give dimension sums and maximum ratios. The quick reference is
   computed even without `--baseline`.

The implementation enforces **1.5×** instance dimensions, which satisfies both
R67's looser 1.5× plus two-column allowance and the amendment's stricter ratio
target. Corners are snapped to the Document grid (at most half a grid pitch from
its exact visible box corner). A fixed instance prevents any anchoring translation;
a candidate needing further drafting-clearance translation is refused.

## Acceptance results

Final checks and raw logs are under ignored `tmp/t019-r2/`. Local tests used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date, pnpm 11.16.0
pnpm format:check → 0; All matched files use Prettier code style
pnpm docs:check → 0; Validated local Markdown links in 74 files
pnpm typecheck → 0
pnpm lint → 0; existing warning-only policy
pnpm vitest run packages/auto-layout → 0; 10 files, 141 tests passed
pnpm test:local → 0; 746 files passed, 2 skipped; 7422 tests passed, 116 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → 1; no output (expected no grep matches)
pnpm build → 0
pnpm auto-layout:review → 0; 9 corpus and 7 held-out cases
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0; every recorded T017 metric and completion status is identical
pnpm auto-layout:eval tmp/human-cases --search 600 --seed 1 --jobs 12 → 0; 32 completed, transaction/graph checks pass
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → 1; no output (expected no matches)
```

The initial sandboxed full suite failed on denied local PostgreSQL/loopback access;
the rerun with local-service access passed. The initial package run also exceeded
the default five-second timeout in the new test that combined all three seeds.
Each seed now has its own test with the same 128-evaluation budget and all the
same assertions; no timeout or existing test was weakened.

The final reporting-only maximum-aggregation edge fix was checked with the
hand-built CLI fixture: its shrinking height is reported as 0.862944×. Recomputing
all recorded run/split maxima confirms their values are unchanged by this fix.

The hand-built pre-fix regression reproduced a 1,038.4-unit width against a
552-unit quick result (limit 828). All three seeded variants now pass. A separate
CLI probe verifies both dimension sums and all quick-reference ratios on a
hand-built project. Additional human duration/seed runs exited 0. Short-budget
held-out ceiling failures are reported below and are not gated, per review note 3.

## Investigation results

### Drift diagnosis

Examined all three documents whose original ten-minute rendered width exceeded
1.3× quick mode. The two severe outliers (40 and 20 instances; 15.25× and 100.06×)
share the review's cause: most devices translated roughly 12,000 or 129,000 units
right, while a ground marker stayed within 100 units of its previous location.
Both have an unrouted marker Net. Their marker Nets have gate/body or body/collector
terminals without an eligible power-marker host, so marker finishing falls back
to the origin. Translation-invariant routed cost and constant unrouted-Net cost
permit the separation. The 400-evaluation replay reproduced the same displacement
pattern. Per-instance probes stay in ignored `tmp/t019-r2/`.

The 51-instance document is different: its original width was 1.395× quick,
with no unrouted warning or floating pin. Devices have different displacements
(-80 to +590), and a marker moves left by 1,250 units. This is local rearrangement
and marker relocation rather than a coherent unbounded translation. The same
all-instance span constraint bounds that mechanism; no case-specific move or
additional energy term is needed.

### Placement hook

The seam is the strategy/finishing boundary inside `placeDocument`. The internal
`planLayoutOnce` accepts supplied placements and passes them through `buildPlan`
to that seam. Strategy selection is skipped, while collision resolution, marker
placement, wire-cost orientation, grid/drafting handling and final legality checks
remain shared. Routing and transaction checks are unchanged. Search additionally
rejects proposals with device overlaps/coincident pins before routing and rejects
finishing that splits a group, its tail or an aligned template stack.

The original R44 result is retained as the search incumbent, while the walk starts
at the R58/R63 winner. This retains the quick-mode score ceiling even when its
routing alternative beats that initial winner. Search evaluations count additional
candidate plans and its final R44; mandatory quick initialization is outside that
budget. Cancellation returns the best checked plan without starting another R44.

### Dev-only pre-filter comparison

Seed 1, the same routed-evaluation cap, 17 completed dev documents in each variant:

| Evaluations per document | Raw crossings / bends / floating pins | Four-proposal R54 crossings / bends / floating pins |
| ------------------------ | ------------------------------------- | --------------------------------------------------- |
| 64                       | 230 / 343 / 35                        | 223 / 319 / 38                                      |
| 256                      | 202 / 314 / 32                        | 177 / 264 / 35                                      |

The pre-filter improves dev crossings at both equal budgets and was retained.
It changes proposal selection only; all acceptance energies still use the existing
routed weights. Full per-document curves remain in ignored
`tmp/t019/prefilter-64.json` and `tmp/t019/prefilter-256.json`; no human case ids or
id-keyed derivatives are included in tracked files.

### Schedule

Initial heat is the median sampled positive delta divided by `ln(2)`, using at
most 16 early evaluations. Geometric cooling ends at 0.1% heat within 256
evaluations (or the smaller budget); that low heat is retained thereafter. Every
64 evaluations the walk restarts at the best state with probability 0.75, otherwise
at a valid strategy start. A maximum of 128 consecutively empty proposal pools
bounds searches with no available move. These constants are general and were
chosen on dev only. The two-minute dev measurements were:

| Variant                                        | Crossings | Bends | Floating pins | Completed |
| ---------------------------------------------- | --------- | ----- | ------------- | --------- |
| Raw, cooling across the nonbinding hard cap    | 259       | 328   | 28            | 17        |
| Raw, cooling within 256 evaluations            | 221       | 284   | 25            | 17        |
| R54 pre-filter, cooling within 256 evaluations | 188       | 256   | 40            | 17        |

Capping the cooling horizon improves dev crossings and bends in deadline runs;
256 evaluations and 64-evaluation restarts were frozen before final validation.
The pre-filter's floating-pin tradeoff is shown explicitly. No validation or
held-out case was used to tune these settings.

### Routed-score curves for the pre-filter investigation

Summed best routed score across the 17 completed dev documents (lower is better):

| Run budget | Evaluation checkpoint | Raw    | Four-proposal R54 |
| ---------- | --------------------- | ------ | ----------------- |
| 64         | 0                     | 408287 | 408287            |
| 64         | 16                    | 385791 | 391727            |
| 64         | 32                    | 367190 | 381429            |
| 64         | 64                    | 351106 | 362202            |
| 256        | 0                     | 408287 | 408287            |
| 256        | 16                    | 391724 | 395146            |
| 256        | 32                    | 382315 | 382021            |
| 256        | 64                    | 377761 | 364337            |
| 256        | 128                   | 344332 | 331417            |
| 256        | 256                   | 310900 | 300662            |

At 64 evaluations the filter improves the main crossing metric while its total
energy is worse. At 256 it improves both crossings and total energy. Rendered
curves are in `tmp/t019/prefilter-curves.svg` and
`tmp/t019/prefilter-curves.png`; the rendered plot was visually checked.

The investigation and schedule tables above are retained round-1 dev evidence,
accepted in review note 4. Round 2 did not retune them or use validation/held-out
data to tune the new mechanism.

### Human evaluation

All-completed totals against `tmp/t017-final-eval.json`; seed 1:

| Budget       | Dev crossings / bends / floating | Val crossings / bends / floating | All crossings / bends / floating | Completed |
| ------------ | -------------------------------- | -------------------------------- | -------------------------------- | --------- |
| Quick / T017 | 268 / 336 / 38                   | 487 / 430 / 44                   | 755 / 766 / 82                   | 32        |
| 30 s         | 241 / 323 / 34                   | 463 / 420 / 47                   | 704 / 743 / 81                   | 32        |
| 2 min        | 191 / 244 / 41                   | 430 / 399 / 39                   | 621 / 643 / 80                   | 32        |
| 10 min       | 150 / 194 / 33                   | 345 / 346 / 35                   | 495 / 540 / 68                   | 32        |

Every completed result preserves terminal connectivity and electrical equivalence,
has no unsafe audit problems, and has a nonincreasing best routed-score curve.
The pre-existing refusal remains refused. Raw timing, evaluation counts, curves
and rendered results are in `tmp/t019-r2/human-<seconds>-seed<n>/`.

### Span reporting

Rendered dimensions include routing, labels and drafting; instance ratios use
R67's all-instance visible box. Sums cover the 32 completed documents. Maxima are
per-document ratios against the corresponding quick result, not ratios of sums.

| Run             | Sum width | Sum height | Largest rendered width / height ratio | Largest instance width / height ratio |
| --------------- | --------- | ---------- | ------------------------------------- | ------------------------------------- |
| quick           | 40841     | 21591      | 1.0000 / 1.0000                       | 1.0000 / 1.0000                       |
| human-30-seed1  | 41589     | 21657      | 1.2998 / 1.2577                       | 1.4584 / 1.3092                       |
| human-120-seed1 | 40284     | 22153      | 1.2998 / 1.2953                       | 1.4584 / 1.4643                       |
| human-120-seed2 | 40822     | 21583      | 1.3155 / 1.2577                       | 1.4584 / 1.3092                       |
| human-120-seed3 | 40598     | 22057      | 1.2998 / 1.3340                       | 1.4584 / 1.4666                       |
| human-600-seed1 | 38853     | 21808      | 1.2998 / 1.2637                       | 1.4584 / 1.3092                       |

Across every budget and seed, the largest rendered span ratio is 1.3341 and the
largest instance span ratio is 1.4666; both satisfy the 1.5 target.

### Corpus and held-out checks

| Budget | Corpus completed; crossings / bends / floating | Held-out completed; crossings / bends / floating | Ceiling failures                      |
| ------ | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| Quick  | 9; 1 / 8 / 0                                   | 7; 45 / 92 / 9                                   | None                                  |
| 30 s   | 9; 1 / 4 / 0                                   | 7; 47 / 72 / 5                                   | `deadtime`: 20 crossings (ceiling 17) |
| 120 s  | 9; 1 / 4 / 0                                   | 7; 38 / 72 / 0                                   | `deadtime`: 20 crossings (ceiling 17) |
| 600 s  | 9; 1 / 4 / 0                                   | 7; 26 / 68 / 0                                   | None                                  |

All transaction safety, terminal partition, name-claim and corpus target checks
pass. The short-budget held-out failures are recorded without changing energy
weights or treating them as gates. Detailed results and SVGs are in
`tmp/t019-r2/review-<seconds>.json` and sibling render folders.

| Budget | Corpus sum width / height | Held-out sum width / height | Largest rendered width / height ratio, both sets |
| ------ | ------------------------- | --------------------------- | ------------------------------------------------ |
| 30 s   | 4699.4 / 3299.2           | 6321.5 / 3559.8             | 1.0888 / 1.0203                                  |
| 120 s  | 4659.4 / 3273.1           | 6001.3 / 3559.8             | 1.0722 / 1.0373                                  |
| 600 s  | 4659.4 / 3263.1           | 5922.3 / 3633.8             | 1.0000 / 1.0582                                  |

### Two-minute seed spread

| Seed | Dev crossings | Val crossings | All crossings | Bends | Floating | Completed | Evaluations |
| ---- | ------------- | ------------- | ------------- | ----- | -------- | --------- | ----------- |
| 1    | 191           | 430           | 621           | 643   | 80       | 32        | 42732       |
| 2    | 180           | 425           | 605           | 670   | 82       | 32        | 43818       |
| 3    | 208           | 437           | 645           | 695   | 77       | 32        | 43442       |

### Time and evaluations by size

Seed 1, completed cases only. Times include quick initialization and the search
call, and exclude parsing, rendering and the evaluator's separate quick-reference
run. Deadline-limited results vary with available compute; fixed evaluation budgets
remain deterministic. Wall time per document differs from elapsed batch time.

| Budget | Instances        | Evaluations median (range) | Time median / maximum, seconds |
| ------ | ---------------- | -------------------------- | ------------------------------ |
| 30 s   | 1–20 (11 cases)  | 175 (77–4336)              | 29.46 / 29.90                  |
| 30 s   | 21–40 (16 cases) | 60 (4–214)                 | 29.03 / 29.62                  |
| 30 s   | 41–120 (5 cases) | 18 (2–29)                  | 25.98 / 27.06                  |
| 120 s  | 1–20 (11 cases)  | 866 (389–21568)            | 119.20 / 119.90                |
| 120 s  | 21–40 (16 cases) | 354.5 (117–3084)           | 118.86 / 119.62                |
| 120 s  | 41–120 (5 cases) | 80 (34–130)                | 115.40 / 116.55                |
| 600 s  | 1–20 (11 cases)  | 5516 (2309–133585)         | 599.51 / 599.87                |
| 600 s  | 21–40 (16 cases) | 2452.5 (912–23890)         | 599.07 / 599.61                |
| 600 s  | 41–120 (5 cases) | 532 (315–980)              | 596.54 / 598.06                |

| Run             | Total search evaluations | Batch elapsed, seconds |
| --------------- | ------------------------ | ---------------------- |
| human-30-seed1  | 8163                     | 116.45                 |
| human-120-seed1 | 42732                    | 385.75                 |
| human-120-seed2 | 43818                    | 386.81                 |
| human-120-seed3 | 43442                    | 386.11                 |
| human-600-seed1 | 273783                   | 1822.48                |

### Ten-minute targets

| Measure                    | Required             | Observed                                                 |
| -------------------------- | -------------------- | -------------------------------------------------------- |
| Dev / val crossings        | Both below 268 / 487 | 150 / 345                                                |
| Completed                  | At least 32          | 32                                                       |
| Bends                      | At most 766          | 540                                                      |
| Floating pins              | At most 82           | 68                                                       |
| Maximum human plan time    | At most 600 s        | 599.874 s                                                |
| Corpus / held-out ceilings | Pass                 | Pass                                                     |
| Quick mode                 | Identical            | Every T017 recorded metric and completion status matches |

### Six rendered pairs

Six paired SVG/PNG renderings are in ignored `tmp/t019-r2/pairs/`, including both
largest completed documents and the prior worst drift case. All six were visually
inspected.

| Pair | Instances | Split | Crossings quick → search | Bends quick → search | Width quick → search | Height quick → search |
| ---- | --------- | ----- | ------------------------ | -------------------- | -------------------- | --------------------- |
| 1    | 103       | val   | 163 → 116                | 75 → 92              | 2837 → 2957          | 1007 → 1017           |
| 2    | 94        | val   | 107 → 67                 | 58 → 40              | 3387 → 3693          | 957 → 1077            |
| 3    | 50        | dev   | 62 → 27                  | 37 → 33              | 1483 → 1533          | 878 → 888             |
| 4    | 37        | dev   | 45 → 23                  | 31 → 24              | 1949 → 1939          | 828 → 828             |
| 5    | 15        | dev   | 3 → 1                    | 9 → 0                | 669 → 491            | 523 → 523             |
| 6    | 20        | dev   | 7 → 7                    | 12 → 12              | 1306 → 1306          | 823 → 823             |

Pairs 1–4 reduce crossings while retaining comparable drawing scale. Pair 1
increases bends (75 → 92), and the large layouts still contain long rails and
crowded labels. Pair 5 reduces crossings and bends but concentrates overlapping
labels in a small cluster; the numeric gain does not imply a clear visual gain.
Pair 6 retains the quick result, with width 1306 and 7 crossings. The previous
130682-unit sprawl is absent.

The bounded ten-minute total is 495 crossings, compared with 474 in unbounded
round 1. Both dev and validation still improve against T017, and all required
round targets hold.

## Deviations and open questions

- The stricter 1.5× bound resolves the discrepancy between the amendment's
  two-column allowance and its raw ratio target, without changing energy weights.
- Deadline checks remain cooperative between synchronous full plans. They reserve
  three times the slowest observed candidate duration (minimum 100 ms), with
  remaining-time checks before R44. No in-flight plan can be preempted.
- The overlapping quick and first short-budget run initially overwrote some
  standalone SVGs in the shared output directory. Archived SVGs were restored
  from each run’s embedded HTML, then all drawings were checked against their
  report dimensions. Numerical reports and embedded drawings were unaffected.
- Label crowding can still worsen (pair 5). This round bounds layout span;
  existing label/drafting warnings remain visible. No label-placement or energy
  redesign was made outside the plan.
- All third-party inputs, per-document derivatives, curves and renderings remain
  under ignored `tmp/`. No router, editor, model, Edit Engine, dependency or
  lockfile change was made. `plan.md` and `review.md` were not edited.
