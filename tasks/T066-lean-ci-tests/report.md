# T066 report — round 1

## Summary

Added an opt-in `pnpm test:slow` Vitest project and moved the unchanged
full-search held-out suite to `held-out.slow.test.ts`. The default suite keeps
quick-mode validity, routing safety and Net/terminal preservation on the same
seven drawings. Corpus tests reuse a file-local default plan; determinism and
changed-document replanning still execute the planner independently. Review
documentation now requires Opus to rerun the slow suite and post PR evidence.

Implementation is partial against acceptance: the measured default auto-layout
test-file total fell **33.74%**, short of the required 50%. No assertion or
existing timeout was weakened to reach the target.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                       |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Both default Vitest projects exclude `*.slow.test.{ts,tsx,mjs}`. `test:slow` enables and selects the isolated `slow` project. `test`, `test:local`, `check` and the CI workflow retain their default behavior.                                                                                              |
| 2    | done    | The original held-out file is copied byte-for-byte to `held-out.slow.test.ts`. Default held-out tests use `search: { seed: 1, evaluations: 0 }` and retain every non-crossing assertion.                                                                                                                    |
| 3    | done    | `createCorpusPlans()` provides separate lazy caches per file. The corpus's transaction and R2 tests share each original default plan. R22 retains its independent repeat and unrefined initial plan; its only other real-fixture planning test uses different options and spies, so cannot share this plan. |
| 4    | done    | All large synthetic determinism/bounds tests pass within existing timeouts; kept unchanged in the default suite as directed.                                                                                                                                                                                |
| 5    | done    | Updated `docs/testing/README.md` and the review evidence rule in `docs/workflow.md`.                                                                                                                                                                                                                        |
| 6    | partial | Measured before/after under the same two-worker command; 133.53 s → 88.48 s summed file duration (33.74% lower). Slow-suite timing and acceptance results below. The 50% acceptance target is unmet.                                                                                                        |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

```text
pnpm build → 0; apps/editor build: Done (Vite emitted its large-chunk warning).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2030 files, 0 errors, 3295 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files.
pnpm test:local (sandbox) → 1; 17 files failed, 768 passed, 3 skipped;
  60 tests failed, 7918 passed, 150 skipped; 2 unhandled errors; 91.57 s.
pnpm test:local (elevated rerun) → 0; 785 files passed, 3 skipped;
  8011 tests passed, 117 skipped; 85.98 s elapsed.
pnpm test:slow → 0; 1 file / 7 tests passed; 51.43 s elapsed, 50.12 s tests.
git diff --check → 0.
```

The sandbox run could not connect to the existing PostgreSQL test database
or bind local HTTP listeners. Representative output:

```text
Error: Server tests require reachable PostgreSQL at postgresql:///auto_canvas_test
Error: connect EPERM ::1:5432 - Local (:::0)
Error: connect EPERM 127.0.0.1:5432 - Local (0.0.0.0:0)
Error: listen EPERM: operation not permitted 127.0.0.1
```

The two netlist-conversion tests timed out after their listener setup threw
`listen EPERM`, also reported as two unhandled errors. A focused run of
`pnpm exec vitest run packages/agent-adapter/src/http.test.ts --maxWorkers=2`
reproduced the same loopback `EPERM` (exit 1), confirming the environment
restriction. An elevated full-suite rerun was approved by automatic review
and passed without changing code or timeouts. All seven acceptance commands
therefore have a successful run; the separate 50% timing criterion remains
unmet.

No default-suite timeout was raised. The slow run collected only
`held-out.slow.test.ts`; the focused default run collected no slow files.

## Investigation results

### Timing

Node v26.7.0, pnpm 11.16.0. Before/after runs were sequential with no concurrent
build or other test run. Both passed all **658 tests in 44 files**. Commands:

```text
pnpm test:local packages/auto-layout --reporter=json --outputFile=/tmp/t066-before.json → 0
pnpm test:local packages/auto-layout --reporter=json --outputFile=/tmp/t066-after.json → 0
```

The before run used the original tests. Vitest had loaded the original config
before it was edited; no test file changed until that run finished. Summed file
durations are `sum(endTime - startTime)` from Vitest JSON, not wall time.
Elapsed time here is the last file's `endTime` minus the run's `startTime`.

| Measurement                              |   Before |   After |
| ---------------------------------------- | -------: | ------: |
| All default auto-layout files, summed    | 133.53 s | 88.48 s |
| Run elapsed through last file completion |  68.93 s | 46.40 s |
| Held-out                                 |  53.85 s | 14.59 s |
| Corpus                                   |  18.89 s | 14.03 s |
| Quality                                  |  10.19 s | 10.26 s |
| Search                                   |  11.41 s | 10.94 s |
| Stages                                   |  11.28 s | 11.14 s |
| Layered                                  |   8.23 s |  8.09 s |

The standalone `pnpm test:slow` run took **51.43 s elapsed**, with **50.12 s**
reported test execution time. It ran without a concurrent build or test run.

The baseline large synthetic cases took 2.53 s (60-device layered), 4.96 s
(85-device layered), 9.80 s (120-device stages), and 1.46 s (60-instance R55).
Their existing timeouts are respectively 30, 30, 60 and 30 seconds. None
qualified for moving under step 4. The corpus contains nine fixture entries,
expanded to eighteen tests; sharing saves one default plan per fixture.
`quality.test.ts` already used only one default plan plus the required repeat
per fixture; the third run is an unrefined `planLayoutOnce` score baseline,
which must remain independent.

### Assertion preservation and replacement protection

`cmp packages/auto-layout/test/held-out.slow.test.ts
<(git show HEAD:packages/auto-layout/test/held-out.test.ts)` returned 0: the
entire full-search suite, including limits and timeout, is byte-identical.
Every original held-out assertion is listed below. Old paths are under
`packages/auto-layout/test/held-out.test.ts` at HEAD; new paths are under
`packages/auto-layout/test/held-out.slow.test.ts`. Line numbers are identical.
Each assertion runs over all seven original fixture entries.

| Assertion                                        | Old line(s) | New line(s) |
| ------------------------------------------------ | ----------- | ----------- |
| Refinement candidates ≤ 24                       | 38          | 38          |
| No error diagnostics                             | 40          | 40          |
| Real transaction applied                         | 52          | 52          |
| Terminal partition unchanged                     | 54–56       | 54–56       |
| No lost Net name claim                           | 57          | 57          |
| Contact terminal has a physical component        | 65          | 65          |
| Contact peer is in the same physical component   | 66–68       | 66–68       |
| No unsafe routing problems                       | 71          | 71          |
| Every floating pin has its R14 warning           | 73–80       | 73–80       |
| Crossings ≤ original fixture-specific T013 limit | 81          | 81          |

Only the final crossing assertion leaves the default suite. Its exact limits
remain at lines 14–22 in the slow file. All other assertions also remain in
`held-out.test.ts`, running the real planner and transaction boundary with
zero search evaluations. No rejection, compatibility, history, or safety
assertion is deleted. All corpus and quality assertion expressions are
unchanged, including independent determinism, history/undo, R2 cleanup,
changed-document replanning, and routed-score comparisons. Cached plans are
created inside the requesting test, so planning still counts against the
existing test timeout; tests with different inputs/options or active spies
continue to call the planner directly.

## Deviations and open questions

- The 50% performance acceptance criterion is not met. The prescribed changes
  save 45.05 s of the 133.53 s baseline. Further savings need a revised plan:
  the current plan explicitly retains synthetic cases that meet their
  timeouts, requires full corpus/R22 assertions and independent determinism,
  and excludes product optimizations. No extra suite migration or reduced
  coverage was introduced to force a passing measurement.
- No product code, dependency versions, lockfile, CI workflow, plan or review
  file was changed. No commits, pushes, merges, rebases or branch switches.
- Acceptance command logs and timing JSON are retained in `/tmp/t066-*`.
