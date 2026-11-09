# T025 report — round 3

## Summary

Implemented the round 3 amendments on `task/T025-auto-layout-symmetry`, based on
`f8f15fe`. Rails no longer pair devices; internally inconsistent pairs are rejected;
block facing follows R92; placement detects topology once and passes it through
all strategies and half layouts. Axis-run assertions now express the specified
on-grid tolerance. All six original failures and both new detection regressions pass.

All required quick targets pass: 33/33 completed, dev crossings 287 (ceiling 310),
all detected pairs mirrored and level, all axis devices on-axis, and paired
planning time 0.954× baseline (ceiling 1.25×). The full local suite passes with
local-service access. Search evidence follows below.

## Steps

| Step | Status | Notes                                                                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | R88 rail exclusion and within-pair non-self consistency; genuine cross-coupled and shared-default cases remain accepted.    |
| 2    | done   | R89 half layout preserves R92 facing, R18 alignment, minimum pitch, grid-valid axis runs and rigid row nodes.               |
| 3    | done   | All three strategies receive the detected topology. Existing outside-tail unit seating and split-tail tests pass unchanged. |
| 4    | done   | Rigid search and finishing protection retained; determinism and zero-budget equivalence pass.                               |
| 5    | done   | Human/result symmetry evaluation retained; baseline geometry remeasured using current input components.                     |
| 6    | done   | R88, R89 and R94 updated for K–N and R92; merged R90–R93 preserved.                                                         |
| 7    | done   | All 361 auto-layout tests pass; original corpus/quality/PMOS-tail/stage-mirror/cascode expectations preserved.              |
| 8    | done   | Quick, paired timing, search, topology counts, per-document trade-offs and six rendered comparisons.                        |

## Review findings addressed

| Latest review finding                      | Fix and evidence                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — must-fix, rail-based pairing           | Skip rails during Net-to-device pairing while retaining hard rail self mappings. New detection regression went red before the fix. Both existing PMOS-tail tests pass unchanged: the layered axis seat is retained by the template path, which includes the tail's whole outside group.                                                                    |
| 2 — must-fix, internally inconsistent seed | Validate each proposed device pair against its own non-self Net implications before accepting it; conflict its devices on disagreement. Shared defaults and conflicts between different pairs do not invalidate device pairs. New inconsistent-seed regression went red before the fix; genuine cross-coupled detection and existing stage mirroring pass. |
| 3 — should-fix, exact axis-run assertions  | Assert visible gap in `[40, 40 + grid)` and midpoint within half a grid. The measured 41.872093-unit gap is valid; R10 and mirrored-pair assertions remain. Spec now states at least 40 units.                                                                                                                                                             |
| 4 — must-fix, repeated detection           | `placeDocument` calls `symmetryTopology` once and passes the result to template, stages and layered placement; stage-local and half layouts receive components and Net map. No module cache. Direct helper callers retain a single default detection; move generation and evaluation retain their own single calls.                                        |
| Rebase interaction — R92                   | Use `facesOutward(group)` before half-column alignment. Both split-tail tests pass unchanged.                                                                                                                                                                                                                                                              |

The initial auto-layout run reproduced exactly 6 failures / 353 passes. The two
new detection tests independently failed before the fixes. The focused rerun
passed 72/72; final full auto-layout run passed 361/361.

## Acceptance results

Every acceptance command used lane 1: `ICM_E2E_PORT=4173`,
`AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
The pnpm dependency-verification environment flags were disabled as prescribed
by the repository runner; the explicit offline frozen install still ran.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check → 0; all matched files use Prettier style
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0; 0 errors (existing warnings remain)
pnpm vitest run packages/auto-layout → 0; 361 passed, 18 files
pnpm test:local (sandbox) → 1; 58 failed, 7556 passed, 149 skipped; PostgreSQL connect EPERM and loopback listen EPERM
pnpm test:local (local-service access) → 0; 7647 passed, 116 skipped; 755 files passed, 2 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout|symmetry' → 1; no output (expected grep status)
pnpm build → 0
pnpm auto-layout:review → 0; 9 corpus and 7 held-out SVGs
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t025/base-quick.json --jobs 10 → 0; 33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33 completed
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent pnpm-lock.yaml package.json → 0; empty
git diff --stat f8f15fe -- packages/auto-layout/src/recognize.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/route.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/routing-audit.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/search.ts packages/auto-layout/src/place-markers.ts packages/auto-layout/src/place-fallback.ts scripts/auto-layout-recognition.mjs scripts/auto-layout-review.mjs → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1; empty
```

The frozen-path comparison uses `f8f15fe`, as the round 3 amendment requires.
The service-access rerun resolved all environment failures. Logs, exit records,
investigation scripts and private case-keyed artifacts are under ignored
`tmp/t025/round3/`. No dependency or lockfile change was made.

## Investigation results

### Quick mode against f8f15fe

Dev completed 18/18 and val 15/15. Both have zero unsafe problems and zero
inequivalent documents. No document has more floating pins than its baseline.

| Split | Run      | Crossings | Bends | Floating | Missing | Wire length | Labels / clearance / departures |
| ----- | -------- | --------: | ----: | -------: | ------: | ----------: | ------------------------------- |
| dev   | Baseline |       295 |   401 |        0 |       0 |     123,660 | 0 / 40 / 7                      |
| dev   | Result   |       287 |   371 |        0 |       0 |     127,850 | 0 / 32 / 8                      |
| val   | Baseline |       321 |   391 |        1 |       1 |     147,150 | 0 / 31 / 5                      |
| val   | Result   |       338 |   403 |        1 |       1 |     148,230 | 1 / 31 / 6                      |

Six symmetry counts are `pairs / mirrored / level / orientationMirrored / axisDevices / onAxis`.
Human, baseline and result use the same round 3 input components. Baseline
symmetry is remeasured from `base-svg/`, rather than an obsolete detector's counts.

| Split | Human                     | Baseline layout           | Result                    |
| ----- | ------------------------- | ------------------------- | ------------------------- |
| dev   | 58 / 31 / 54 / 34 / 7 / 4 | 58 / 13 / 57 / 34 / 7 / 1 | 58 / 58 / 58 / 58 / 7 / 7 |
| val   | 29 / 19 / 29 / 23 / 4 / 3 | 29 / 12 / 29 / 19 / 4 / 0 | 29 / 29 / 29 / 29 / 4 / 4 |

| Population | Mirrored pairs | Level pairs  | On-axis devices |
| ---------- | -------------- | ------------ | --------------- |
| dev        | 58/58 (100%)   | 58/58 (100%) | 7/7 (100%)      |
| val        | 29/29 (100%)   | 29/29 (100%) | 4/4 (100%)      |
| all 33     | 87/87 (100%)   | 87/87 (100%) | 11/11 (100%)    |

| Required quick measure              | Result             | Ceiling or minimum              | Verdict |
| ----------------------------------- | ------------------ | ------------------------------- | ------- |
| Completed                           | 33/33              | 33/33                           | pass    |
| Dev mirrored / level / on-axis      | 100% / 100% / 100% | ≥85% / ≥95% / ≥85%              | pass    |
| Dev crossings                       | 287                | ≤310                            | pass    |
| Dev bends                           | 371                | ≤440                            | pass    |
| Dev wire length                     | 127850             | ≤136000                         | pass    |
| Dev labels / clearance / departures | 0 / 32 / 8         | ≤1 / ≤44 / ≤10                  | pass    |
| Floating dev / val                  | 0 / 1              | 0 / ≤1; none above own baseline | pass    |
| Unsafe / inequivalent               | 0 / 0              | 0 / 0                           | pass    |
| Paired summed time                  | 0.954×             | ≤1.25×                          | pass    |

Val is reported separately and was not used to choose a constant. Corpus and
held-out ceilings pass in the unchanged quality tests and review command.

### Crossing increases

Every quick result with more crossings is listed as counts only. Seven dev and
two val documents gain crossings even though dev total improves. These are the
costs of the required symmetry rule; no rule was dropped to hide them.

| Split | Crossings before → after | Six counts before        | Six counts after          |
| ----- | ------------------------ | ------------------------ | ------------------------- |
| dev   | 17 → 29                  | 10 / 6 / 10 / 10 / 1 / 0 | 10 / 10 / 10 / 10 / 1 / 1 |
| val   | 20 → 29                  | 10 / 4 / 10 / 4 / 0 / 0  | 10 / 10 / 10 / 10 / 0 / 0 |
| dev   | 52 → 66                  | 12 / 0 / 12 / 6 / 0 / 0  | 12 / 12 / 12 / 12 / 0 / 0 |
| dev   | 12 → 15                  | 6 / 0 / 6 / 2 / 2 / 1    | 6 / 6 / 6 / 6 / 2 / 2     |
| dev   | 3 → 8                    | 2 / 0 / 2 / 1 / 0 / 0    | 2 / 2 / 2 / 2 / 0 / 0     |
| dev   | 8 → 10                   | 3 / 2 / 3 / 3 / 0 / 0    | 3 / 3 / 3 / 3 / 0 / 0     |
| dev   | 7 → 15                   | 1 / 1 / 1 / 1 / 1 / 0    | 1 / 1 / 1 / 1 / 1 / 1     |
| val   | 25 → 35                  | 8 / 0 / 8 / 5 / 2 / 0    | 8 / 8 / 8 / 8 / 2 / 2     |
| dev   | 11 → 13                  | 5 / 3 / 5 / 3 / 1 / 0    | 5 / 5 / 5 / 5 / 1 / 1     |

### Recognition and remaining dev pairs

| Split | Round-1 conflicted devices now paired | Convention-side pairs | Axis-run rows | Devices in runs | Round-2 paired devices with rail evidence | Devices dependent on rail evidence |
| ----- | ------------------------------------: | --------------------: | ------------: | --------------: | ----------------------------------------: | ---------------------------------: |
| dev   |                                    12 |                     4 |             1 |               2 |                                        14 |                                  6 |
| val   |                                     8 |                     1 |             0 |               0 |                                        12 |                                  0 |

K's dev rail-pairing count is 14 devices with rail-based proposals in round 2.
Of these, 6 devices (3 pairs) depended on that evidence; the other 8 also have
non-rail evidence and remain paired. This was checked by replaying the saved
round-2 detector with only rail pairing disabled. All 12 val devices with rail
proposals also have non-rail evidence. Replaying with rail exclusion alone
removes 3 dev pairs and 0 val pairs; adding L's within-pair consistency check
removes 0 further dev pairs and 2 val pairs. This explains the denominators
58 dev / 29 val versus round 2's 61 / 31. The round-1 conflict comparison and
convention-side counts use temporary instrumentation only in ignored files.

All 58 detected dev pairs are mirrored; there are zero detected-pair failures
from different rows, collision repair or other causes. Against the original
61-pair reference probe, 58 are retained and mirrored; 3 are outside seeded
symmetry after excluding rail-only evidence. Conflicted: 0; different rows: 0;
collision repair: 0; other: 0. These exclusions are structural changes required
by K, not placement failures or denominator tuning.

### Paired timing

The supplied `tmp/t025/paired-base/` is the `f8f15fe` planner; only its scratch
evaluator imports this branch's symmetry measurement. It ran after this branch's
build. Immediately before both baseline and quick, the required
`pgrep -fl 'auto-layout-eval|vitest'` returned no processes (exit 1); logs are saved.
No external evaluator was encountered and no waiting for another session was
necessary. The runs were sequential, with 10 jobs and no test run alongside.

| Run      | Documents | Summed planning ms | Slowest planning ms | Elapsed s | One-minute load before → after |
| -------- | --------: | -----------------: | ------------------: | --------: | ------------------------------ |
| Baseline |        33 |          187,188.9 |            16,125.0 |     51.99 | 2.52 → 5.90                    |
| Result   |        33 |          178,487.9 |            15,562.6 |     50.15 | 4.24 → 7.13                    |

Summed ratio 0.954×. This is more than 0.1 below the 1.25 ceiling, so the
amendment's near-ceiling remeasurement condition does not apply.

### Search against f8f15fe

Completed 33/33; refused 0; threw 0. Documents with more
floating pins than quick: 0. The comparison uses all 33 common completed
documents from `tmp/t025/base-search120.json`.

| Split | Run             | Crossings | Bends | Floating | Missing | Wire length | Labels / clearance / departures |
| ----- | --------------- | --------: | ----: | -------: | ------: | ----------: | ------------------------------- |
| dev   | Baseline search |       235 |   354 |        0 |       0 |     125,400 | 0 / 23 / 5                      |
| dev   | Result search   |       221 |   326 |        0 |       0 |     131,820 | 0 / 21 / 7                      |
| val   | Baseline search |       288 |   386 |        1 |       1 |     150,260 | 0 / 28 / 5                      |
| val   | Result search   |       297 |   383 |        1 |       1 |     149,310 | 1 / 30 / 6                      |

| Split | Search symmetry counts    | Unsafe | Inequivalent |
| ----- | ------------------------- | -----: | -----------: |
| dev   | 58 / 58 / 58 / 58 / 7 / 7 |      0 |            0 |
| val   | 29 / 29 / 29 / 29 / 4 / 4 |      0 |            0 |

Search elapsed 381.54 s, one-minute load 5.75 → 9.92.
It overlapped only this task's lightweight investigation, rendering and report
work; paired quick timing had already finished. Search is a budgeted measurement,
not a deterministic evaluation count.

### Rendered comparisons and artifacts

Six side-by-side baseline/result quick comparisons are in
`tmp/t025/pairs/index.html`, `pair-01.html` through `pair-06.html`, and matching
PNGs. All six were rendered and visually inspected. They include the three
human drawings mirroring every pair (10/10, 10/10, 5/5), low-human-symmetry cases
(0/12 and 1/9), and crossing increases (17→29, 52→66 and 20→29).
The panels show complete drawings without clipping; full symmetry visibly
redistributes the partner branches and can lengthen cross-block wiring.

Quick and search reports are copied immediately after each run to
`tmp/t025/result-quick.json` and `tmp/t025/result-search120.json`; quick SVGs
are preserved separately in `tmp/t025/quick-svg/`. Human cases, excerpts,
identifiers and case-keyed data remain ignored and untracked.

## Deviations and open questions

No implementation deviation or unresolved must-fix remains. Local-service access
was required to execute the full suite and the headless renderer; their initial
sandbox failures and successful reruns are retained. No commit, push, rebase,
branch switch, dependency edit, or edit to `plan.md` / `review.md` was made.
This is topology/display work, with electrical equivalence checked by the
planner; no electrical behavior or simulation claim is made.

Existing expectation rebuilt under step 7 (carried from round 2): the layered
shared-tail fixture's first row has 1 four-member R89 block node instead of 2
group nodes; its tail-centre and grouping rules remain. Round 3 only changes the
new axis-run test from exact gap 40 and exact midpoint to the explicit M grid
tolerances (observed gap 41.872093). No existing test was deleted or weakened.
The corpus and R18 expectations previously restored remain unchanged: minimum
pitch 100 in `five-t-ota` and `fig-17-19b`; mirror orientation
`horizontal/none`; offset-derived R18 load/input pitches 100/140 at offset 10
and 100/180 at offset 20. All pass.
