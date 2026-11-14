# T075 report — round 1

## Summary

**Status: partial.** The implementation and all listed command checks are complete, and exact-output checks pass. The required `two-inverters` speed target is not met.

Added an internal weighted mode to `readabilityMetrics` and switched the planner's readability term to it. The default evaluator path still computes all 26 metrics. Rail crossings now resolve routes once and count proper crossings in one traversal, deduplicating points per Net pair with the original audit's arithmetic and three-decimal keys.

## Steps

| Step | Status  | Notes                                                                                                                                                                                |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | done    | Profiled `two-inverters` and all seven held-out fixtures against unchanged `01fd2ad` auto-layout code; breakdown below.                                                              |
| 2    | done    | Skip zero-weight diagnostic blocks and label-clearance calls in weighted mode. Shared geometry, signal-path, and visual helpers retain their existing semantics.                     |
| 3    | done    | Replaced rail-pair full audits with `readability-rail-crossings.ts`; no per-Net audit loop remains on the weighted path. The full evaluator retains its original detour calculation. |
| 4    | done    | Added 18 fixture/rail tests and applied weighted/full parity assertions throughout the existing synthetic metric tests, including rails, ports, labels, drafting, and determinism.   |
| 5    | partial | All 628 hashes and readability values match. Five alternating pairs completed; every held-out median improves, but `two-inverters` misses both alternative speed thresholds.         |

## Review findings addressed

Not applicable: round 1; no `review.md` was present.

## Acceptance results

```text
pnpm build → 0; build completed (existing bundle-size warning).
pnpm typecheck → 0.
pnpm lint → 0; 2058 files, 0 errors, 3429 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → initial sandbox run 1; local PostgreSQL and listeners denied with EPERM.
  17 failed / 777 passed / 3 skipped files; 60 failed / 8034 passed / 150 skipped tests.
pnpm test:local → retry with local service access 0;
  794 passed / 3 skipped files; 8127 passed / 117 skipped tests; 161.52 s.
pnpm test:slow → 0; 1 file, 7 tests passed; 72.04 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  all 628 completed; wrote tmp/auto-layout-eval/report.json and index.html.
node tmp/t075/compare.mjs → 0;
  628 matching plan hashes, 97,968 metric values and 1,884 scores; no differences.
node tmp/t075/pairs.mjs → 0; five alternating pairs for all eight fixtures,
  plus five alternating two-inverters pairs against 789d513.
node tmp/t075/summarize-timing.mjs → 1;
  twoInverters: false; noHeldOutSlower: true. All measured main/current plans identical.
pnpm test:local packages/auto-layout/test/readability-metrics.test.ts packages/auto-layout/test/readability-perf.test.ts packages/auto-layout/test/readability-selection.test.ts
  → 0; 3 files, 38 tests passed.
```

Logs and temporary profiling/benchmark harnesses are under `tmp/t075/`. No provider API was called.

## Investigation results

### Baseline profile

Used a temporary Node module-load hook to instrument the unchanged built `01fd2ad` metric function, without editing generated files. One full default planning call per fixture, in a single process. The times below are instrumented wall-clock observations, not the five-pair acceptance benchmark. `setup` includes roles, bounds, pins, distances, and net levels; `devices` combines transistor orientation, source polarity, and control separation. The other rows follow consecutive computation blocks in the original function. All percentages use total planning time as denominator.

| Fixture          | Planning ms | Readability ms |  Share | Calls |
| ---------------- | ----------: | -------------: | -----: | ----: |
| two-inverters    |     2124.77 |         136.84 |  6.44% |    83 |
| fd-two-stage     |     1854.71 |         109.83 |  5.92% |    26 |
| common-source-ac |      928.25 |          64.75 |  6.98% |    34 |
| skew             |     2008.24 |         176.23 |  8.78% |    38 |
| deadtime         |    11436.16 |        1752.71 | 15.33% |   113 |
| ota-sky130       |      735.22 |          34.31 |  4.67% |    16 |
| widlar           |     4379.29 |         281.38 |  6.43% |   172 |
| ltc3452          |    14463.84 |         670.71 |  4.64% |   118 |

| Part (% of planning time) | two-inverters | fd-two-stage | common-source-ac | skew | deadtime | ota-sky130 | widlar | ltc3452 |
| ------------------------- | ------------: | -----------: | ---------------: | ---: | -------: | ---------: | -----: | ------: |
| setup                     |          1.16 |         0.90 |             0.90 | 0.75 |     1.00 |       0.76 |   1.14 |    0.73 |
| netOrders                 |          0.11 |         0.10 |             0.06 | 0.08 |     0.09 |       0.08 |   0.14 |    0.10 |
| ports                     |          0.02 |         0.01 |             0.04 | 0.02 |     0.01 |       0.01 |   0.01 |    0.00 |
| devices                   |          0.02 |         0.01 |             0.02 | 0.02 |     0.02 |       0.02 |   0.02 |    0.01 |
| symmetry                  |          0.14 |         0.38 |             0.08 | 0.09 |     0.08 |       0.28 |   0.12 |    0.07 |
| structures                |          0.07 |         0.05 |             0.03 | 0.03 |     0.02 |       0.06 |   0.03 |    0.02 |
| auditAndPaths             |          0.06 |         0.04 |             0.04 | 0.03 |     0.06 |       0.04 |   0.05 |    0.03 |
| railAudits                |          1.01 |         1.38 |             2.49 | 4.12 |     8.20 |       1.02 |   1.28 |    1.30 |
| detourAudits              |          0.57 |         0.66 |             0.70 | 1.25 |     2.08 |       0.50 |   0.63 |    0.52 |
| signalPath                |          1.90 |         1.32 |             1.37 | 1.11 |     1.05 |       1.19 |   1.68 |    0.98 |
| visual                    |          0.29 |         0.26 |             0.00 | 0.13 |     0.21 |       0.00 |   0.34 |    0.13 |
| labelOwner                |          0.89 |         0.63 |             0.68 | 0.55 |     0.55 |       0.71 |   0.74 |    0.41 |
| labels                    |          0.19 |         0.17 |             0.02 | 0.12 |     0.22 |       0.00 |   0.21 |    0.08 |
| narrowBands               |          0.02 |         0.01 |             0.02 | 0.01 |     0.01 |       0.01 |   0.02 |    0.01 |
| drafting                  |          0.00 |         0.00 |             0.52 | 0.45 |     1.75 |       0.00 |   0.00 |    0.24 |

`railAudits` alone accounts for 53.5% of readability time on `deadtime`; the weighted path eliminates those repeated full audits. `auditAndPaths` is already cheap because the planner reuses its routing audit. Shared helpers still calculate incidental diagnostics needed by their other callers; their implementations are outside this task's scope.

### Equality and timing

Compared every case by ID with `tmp/main-01fd2ad-report.json`: all 628 `planHash` values, statuses, and all 26 metrics' `violations` and `opportunities` on each of `human`, `result`, and `quick` are identical. Composite scores also match exactly. The comparison uses strict equality, without numeric tolerances. Evidence: `tmp/t075/comparison.json`.

Five alternating pairs against `01fd2ad`, sequentially with no concurrent tests or evaluation, using fresh Node processes per version and the same fixture order. Each timed region contains only default `planAutoLayout(document, resolver)`, without quick mode or search overrides; parsing and resolver construction are excluded. Versions run baseline/current in odd pairs and current/baseline in even pairs. Runtime: Node 26.7.0, pnpm 11.16.0.

The `01fd2ad` reference is the untouched auto-layout build saved before edits. The `789d513` reference was extracted read-only with `git show` and compiled with the existing TypeScript compiler/configuration and dependencies under `tmp/t075/`; no branch was switched. Other packages are unchanged between these two reference commits.

| Fixture          | Main median ms | Current median ms | Current/main | Faster |
| ---------------- | -------------: | ----------------: | -----------: | -----: |
| two-inverters    |        2264.55 |           2208.50 |      0.9753× |  2.47% |
| fd-two-stage     |        2027.78 |           1899.98 |      0.9370× |  6.30% |
| common-source-ac |         993.03 |            951.16 |      0.9578× |  4.22% |
| skew             |        2172.74 |           1991.34 |      0.9165× |  8.35% |
| deadtime         |       12198.06 |          10924.81 |      0.8956× | 10.44% |
| ota-sky130       |         789.31 |            772.29 |      0.9784× |  2.16% |
| widlar           |        4707.00 |           4556.39 |      0.9680× |  3.20% |
| ltc3452          |       15169.77 |          14923.11 |      0.9837× |  1.63% |

All seven held-out medians are faster than main. All ten complete plan JSON hashes for each of the eight main/current fixture comparisons are identical across versions and runs.

For the alternative pre-T074 threshold, five additional alternating pairs of `two-inverters` give `789d513` median **1483.60 ms** and current median **2187.49 ms**, or **1.4745×**. This exceeds 1.15×. Against `01fd2ad`, the 2.47% reduction also falls short of the alternative 30% reduction. **The performance acceptance criterion therefore fails.**

Raw samples and hashes: `tmp/t075/timing-pairs.jsonl`; calculated medians and assertions: `tmp/t075/timing-summary.json`.

### Weighted-path profile

One final instrumented pass measured the weighted function in actual planning calls. This is descriptive profiling, not the paired timing acceptance test. The number of calls and complete plan hashes equal the original profile on every fixture.

| Fixture          | Original metric ms | Weighted metric ms | Metric time reduction | Weighted share of planning |
| ---------------- | -----------------: | -----------------: | --------------------: | -------------------------: |
| two-inverters    |             136.84 |              74.80 |                45.34% |                      3.41% |
| fd-two-stage     |             109.83 |              49.78 |                54.67% |                      2.62% |
| common-source-ac |              64.75 |              28.35 |                56.21% |                      2.99% |
| skew             |             176.23 |              53.66 |                69.55% |                      2.71% |
| deadtime         |            1752.71 |             497.76 |                71.60% |                      4.58% |
| ota-sky130       |              34.31 |              14.98 |                56.33% |                      1.96% |
| widlar           |             281.38 |             148.78 |                47.12% |                      3.29% |
| ltc3452          |             670.71 |             324.46 |                51.62% |                      2.18% |

Raw profiles: `tmp/t075/profile-before.jsonl` and `tmp/t075/profile-after.jsonl`. The term itself is substantially cheaper, but its share of total planning time limits the end-to-end gain.

## Deviations and open questions

The initial local-suite failure was an environment restriction, confirmed by `connect EPERM ::1:5432` / `127.0.0.1:5432` and `listen EPERM`. The targeted service test and then the full suite passed with local service access; no tests were weakened or skipped to address it.

The scoped metric optimization does not meet the overall `two-inverters` timing target. Its original metric computation occupied only 6.44% of the measured planning call; most planning time is outside this function. Per the plan's ownership rule, no other planner files were changed to chase the threshold. A follow-up needs a revised performance target or a broader planner-profiling scope.

The proper-crossing predicate is intentionally mirrored from the audit because `routing-audit.ts` is outside the owned paths. The retained pairwise-audit oracle and the 628-case metric comparison guard its precision and counting semantics.

Temporary profiling, reference builds, and timing scripts live in ignored `tmp/t075/`, as allowed by the plan's harness/evaluation steps. No generated file was hand-edited. No commits, branch changes, dependency changes, evaluator changes, or edits to the frozen weights, plan, or review.
