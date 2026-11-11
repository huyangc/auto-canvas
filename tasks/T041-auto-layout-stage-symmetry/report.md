# T041 report — round 1

## Summary

Implemented R145 stage symmetry in default placement, annealing rigid units and
R97 compaction. Gate-driven conduction parts with at least two pairs receive
separate axes; single bias pairs and axis-only parts remain attached to the
largest part, with the specified first-pair tie break. Partition behavior and
the R88 whole-component view are unchanged.

Added `symmetryStage` for human, result and quick-reference measurements and
split summaries. Added nine synthetic tests and updated R94, R145 and the
related stage/evaluation specification. All acceptance checks and measurement
targets passed. No existing test expectations changed.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Added `stageComponents` in `stage-symmetry.ts`, using R50 conducting pins and non-rail Nets. Preserves pair/axis order and conflicted lists; returns unsplit components unchanged.                                                                   |
| 2    | done   | `placeDocument` replaces topology components only without a partition, covering strategies, collision repair and frozen members while retaining the Net map.                                                                                         |
| 3    | done   | Annealing uses stage components without a partition. R97 uses the same helper within its existing default-mode guard.                                                                                                                                |
| 4    | done   | Added `symmetryStage` using components derived from the input, alongside unchanged `symmetry`.                                                                                                                                                       |
| 5    | done   | Nine tests cover gate-driven splitting, bias retention, unchanged conduction parts, tie/size rules, ordering, geometry independence, all three strategies, independent seeded moves and deterministic seeded search through transaction application. |
| 6    | done   | Added R145 after R144; amended R94, its R51 reference, and evaluation documentation.                                                                                                                                                                 |
| 7    | done   | Ran baseline then result on all 33 drawings, then baseline/result cached partition evaluations. Reports, comparisons and changed-drawing renders are in `tmp/t041/result/`.                                                                          |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Every command used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline
  → 0; Already up to date. Done using pnpm v11.16.0.
pnpm format:check
  → 0; final rerun passed.
pnpm docs:check
  → 0; no broken Markdown links.
pnpm typecheck
  → 0; final rerun passed.
pnpm lint
  → 0; final rerun passed.
pnpm vitest run packages/auto-layout
  → 0; 33 files passed, 573 tests passed.
pnpm test:local
  → 0; 774 files passed, 3 skipped; 7,924 tests passed, 117 skipped.
pnpm deadcode 2>&1 | grep -E 'stage-symmetry|place\.ts|search-moves'
  → 1 from grep; no output, as required (no matching findings).
pnpm build
  → 0; build completed; existing Vite large-chunk advisory remains.
pnpm auto-layout:review
  → 0; wrote 9 corpus and 7 held-out SVGs and review index.
pnpm auto-layout:eval tmp/human-cases --jobs 7
  → 0 for baseline and result; 33/33 completed in each.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7
  → 0 for baseline and result; 18/18 completed, all 18 plan hashes equal.
git status --short packages/model packages/derived packages/edit-engine apps pnpm-lock.yaml package.json
  → 0; empty output.
git ls-files tmp | head -1
  → 0; no output.
```

Logs are under `tmp/t041/result/logs/`. The final focused checks are
`recheck-0.log` through `recheck-3.log`; the final full suite is
`local-tests-verified.log`.

Initial new-test runs exposed two fixture mistakes: model-bound instances
needed authored references, and a single-conduction-part fixture needed a
non-rail shared source Net to seed the differential pair. Both fixtures were
corrected without weakening assertions. The first full suite also encountered
sandbox `EPERM` failures for loopback listeners/PostgreSQL access; the final
full rerun with approved local socket access passed.

## Investigation results

### Measurement method

Extracted `83f6a4b` with `git archive` into the ignored result directory; no
branch switch or commit occurred. Verified every tracked baseline planner
source byte against that commit. Added only the new measurement helper and
evaluation instrumentation to the baseline snapshot so both runs report
`symmetryStage`; baseline placement/search/compaction remained unchanged.
The metric is computed outside the planner timer.

Ran baseline and result sequentially with seven jobs after tests finished.
The cached partition command uses `createPartitioner()` with `allowApi=false`;
no provider calls or API keys were used.

### Default quick-mode results

Symmetry columns show mirrored pairs / total pairs. Area columns are median
result-to-human ratios. Both area definitions are included because the plan's
prototype table uses instance-box area, while `medianAreaRatio` uses rendered
view-box area.

| Split / run  | Crossings | Bends | Wire length | Floating pins | Missing connections | Whole symmetry | Stage symmetry | Median rendered area | Median instance area | Planning time sum (s) |
| ------------ | --------: | ----: | ----------: | ------------: | ------------------: | -------------- | -------------- | -------------------: | -------------------: | --------------------: |
| Dev human    |        59 |   202 |   49,798.67 |             6 |                  20 | 32/59          | 40/59          |                    — |                    — |                     — |
| Dev baseline |       268 |   362 |     123,230 |             0 |                   0 | 59/59          | 59/59          |               2.3225 |               2.5722 |                67.187 |
| Dev result   |       254 |   367 |     126,340 |             0 |                   0 | 55/59          | 59/59          |               2.3875 |               2.6536 |                68.562 |
| Val human    |        63 |   246 |   50,484.42 |             4 |                   4 | 19/29          | 25/29          |                    — |                    — |                     — |
| Val baseline |       306 |   397 |     145,250 |             1 |                   1 | 29/29          | 29/29          |               2.1866 |               2.2551 |                70.206 |
| Val result   |       310 |   394 |     145,470 |             1 |                   1 | 23/29          | 29/29          |               2.0397 |               2.2525 |                69.522 |

All 88 result pairs remain level and orientation-mirrored, and all 11 axis
devices remain on their stage axes. Full symmetry counters are in the JSON
reports. No drawing gained floating pins or missing connections; the one
existing validation floating pin and missing connection remain unchanged.

Total planning time was 137.393 s baseline and 138.084 s result, **1.0050×**
(the limit is 1.10×). These are sums of per-case planning timers, not elapsed
wall time: the parallel evaluation commands took 52.02 s and 52.73 s.

Exactly four drawings have split components, and only those four changed plan
hashes. The other 29 hashes are identical. Changes, without private identifiers:

| Split | Instances | Crossings before → after | Bends before → after |
| ----- | --------: | ------------------------ | -------------------- |
| Dev   |        17 | 10 → 8                   | 11 → 9               |
| Dev   |        50 | 63 → 51                  | 34 → 41              |
| Val   |        40 | 25 → 26                  | 19 → 18              |
| Val   |        34 | 26 → 29                  | 33 → 31              |

The plan's contextual human stage counts, 43/59 and 27/29, reproduce exactly
with the existing scratch prototype's **split every conduction part** helper.
The specified **at least two pairs** helper correctly yields 40/59 and 25/29
because it retains single pairs on the main axis. Baseline and result stage
counts still meet the required 59/59 and 29/29 targets.

### Artifacts

- `tmp/t041/result/before/` and `after/`: full default reports, SVGs and indexes.
- `tmp/t041/result/partition-before/` and `partition-after/`: cached partition reports and renders.
- `tmp/t041/result/comparison.json`: complete per-drawing comparison, split detection, hash checks and target checks.
- `tmp/t041/result/changed/index.html`: human | before | after for all four changed drawings, with their twelve SVGs alongside.
- `tmp/t041/result/base/`: isolated baseline snapshot and measurement instrumentation.

All human cases, identifiers, per-case data and renders remain git-ignored.

## Deviations and open questions

No implementation deviations or open blockers. The human stage-count and area
metric terminology differences in the plan's contextual table are explained
above; the implemented metric follows the specified helper exactly. No
out-of-scope source, dependencies, lockfile, plan or review was edited. No
commit, push, merge, rebase or branch switch was performed.
