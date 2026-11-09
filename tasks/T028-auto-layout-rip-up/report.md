# T028 report — round 2

## Summary

Implemented the round 2 amendment: R95 makes one pass at every document size, and R96 reroutes only the selected finalist after R72 repair. The R44 alternative remains a plain replan. Removed the second-pass bookkeeping; the shared first-pass/retry routing, transactional removal, strict acceptance, replay identity, and diagnostic replacement behavior remain intact.

Updated only the two authorized R44/R63 test blocks in `quality.test.ts`, updated the R96 integration test to require one final rip-up call, and revised R22/R44/R58/R66/R95/R96 and known limits in the spec. All 381 auto-layout tests and all 7,727 runnable local tests pass. Quick-mode drawing targets and the paired timing target pass. No corpus or held-out ceiling changed.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                 |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained round 1's shared per-group R12–R14 function and default-off routing option. The existing routing, route-quality, corpus, and held-out suites pass.                                                                           |
| 2    | done   | One deterministic candidate pass at every size. Transactional removal and strict lexicographic acceptance retained. Full candidate audits are permitted because the timing target now passes. Seven hand-built regression tests pass. |
| 3    | done   | Only the repaired selected finalist gets R95 in quick and search paths; the alternative remains plain. Quick and zero-budget search agree; refinement counts stay unchanged.                                                          |
| 4    | done   | Spec describes one selected-finalist pass and the known quality gap to rerouting all refinement candidates.                                                                                                                           |
| 5    | done   | Both authorized R44/R63 call-sequence expectations now match R96; all existing tests pass. No ceiling changed and no test removed.                                                                                                    |
| 6    | done   | Quick/search comparisons, quiet paired timing, single-pass instrumentation, per-document trade-offs, and six rendered pairs recorded below.                                                                                           |

## Review findings addressed

| Must-fix                          | Resolution                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — both finalists rerouted       | `finish` applies `ripUpFinalist` only to the selected run; the alternative receives R72 repair without R95. Shared by quick and offline search.                                                                                                                                                                                       |
| 2 — second rip-up pass            | Removed the pass loop and its stop/acceptance bookkeeping. Candidates are computed once at the start of the single pass.                                                                                                                                                                                                              |
| 3 — stale routing-call assertions | R44 requires exactly one `signalTrunks=false` call, followed by the selected rip-up call with `{ ripUp: true }`, and retains the one-comparison, placement, and score checks. R63 requires `5 + candidates` calls and identifies the final rip-up call by its options. Nothing outside these two blocks changed in `quality.test.ts`. |
| 4 — prototype-derived target      | Applied the plan's amended dev target of ≤272; measured 271. The spec records the remaining gap to all-candidate rip-up. No constants, router costs, placements, or first-pass ordering were tuned.                                                                                                                                   |

## Acceptance results

All acceptance commands ran from the repository root with:

```text
ICM_E2E_PORT=4173
AUTO_CANVAS_E2E_API_PORT=4311
AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test
```

```text
pnpm install --frozen-lockfile --offline → 0; already up to date.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm docs:check → 0.
pnpm typecheck → 0.
pnpm lint → 0; no errors.
pnpm vitest run packages/auto-layout → 0; 19 files, 381 tests passed.
pnpm test:local → 0; 759 files passed, 3 skipped; 7727 tests passed, 117 skipped.
pnpm deadcode 2>&1 | grep -E 'auto-layout|rip-up' → 1 from grep; no output (expected).
pnpm build → 0.
pnpm auto-layout:review → 0; 9 corpus and 7 held-out SVGs rendered.
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t028/base-quick.json --jobs 10 → 0; 33/33 completed.
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33/33 completed.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent scripts pnpm-lock.yaml package.json → 0; empty.
git diff --stat 078f407 -- packages/auto-layout/src/refine.ts packages/auto-layout/src/search.ts packages/auto-layout/src/place.ts packages/auto-layout/src/place-markers.ts packages/auto-layout/src/place-fallback.ts packages/auto-layout/src/layered.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/template-placement.ts packages/auto-layout/src/symmetry.ts packages/auto-layout/src/recognize.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/types.ts packages/auto-layout/src/seat-labels.ts packages/auto-layout/src/readability.ts packages/auto-layout/src/face-ports.ts packages/auto-layout/src/finalize-facing.ts packages/auto-layout/src/timing.ts → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1 from grep; no output (expected).
```

The initial sandboxed `pnpm test:local` exited 1: 17 files failed, 742 passed, 3 skipped; 60 tests failed, 7,634 passed, 150 skipped, and 2 errors. Failures included `connect EPERM 127.0.0.1:5432` and `listen EPERM 127.0.0.1`. The complete suite was rerun with required local access and passed as recorded above. No test or environment-dependent assertion was disabled.

Round 2 logs: `tmp/t028/r2-check-0.log` through `r2-check-9.log`, `r2-check-results.json`, and `r2-test-local-unrestricted.log`. Quick/search runs and recorded loads are in `r2-evaluation-runs.json`; the evaluation logs are `paired-base-quick.log`, `result-quick.log`, and `result-search120.log`.

## Investigation results

### Quick mode

Dev completed 18/18; val completed 15/15. Baseline is the supplied `base-quick.json`:

| Measure            | Dev baseline → result             | Val baseline → result             |
| ------------------ | --------------------------------- | --------------------------------- |
| crossings          | 287 → 271                         | 337 → 310                         |
| bends              | 371 → 367                         | 400 → 397                         |
| floatingPins       | 0 → 0                             | 1 → 1                             |
| missingConnections | 0 → 0                             | 1 → 1                             |
| wireLength         | 127,850 → 128,600                 | 148,260 → 148,830                 |
| readability        | 0/32/8 → 0/33/8                   | 1/31/6 → 1/31/6                   |
| symmetry           | 58/58/58/58/7/7 → 58/58/58/58/7/7 | 29/29/29/29/4/4 → 29/29/29/29/4/4 |

Dev crossings fall by 5.57% to 271 (target ≤272). Bends, wire length, readability, connectivity, symmetry, and safety targets also pass. No document gains crossings, floating pins, or missing connections. Unsafe problems: 0; electrical-equivalence failures: 0. 17 of 33 drawings lose crossings.

Readability is label overlaps / label clearance / terminal departures. Symmetry is pairs / mirrored / level / mirrored orientations / axis devices / on-axis devices. Val is reported separately and was not used to choose behavior or constants.

Every quick-mode bend increase, as counts without case identifiers:

| Split | Instances | Crossings before → after | Bends before → after |
| ----- | --------: | -----------------------: | -------------------: |
| dev   |        37 |                  21 → 20 |              25 → 26 |
| dev   |        70 |                  49 → 46 |              34 → 35 |
| val   |        20 |                   10 → 9 |              19 → 20 |
| dev   |        29 |                   10 → 8 |              14 → 17 |
| val   |        34 |                  34 → 30 |              28 → 33 |

### Single-pass statistics

Ignored `tmp/t028/instrument-r2.mjs` uses a Node load hook on built modules, without editing tracked source or generated files. A separate quick evaluation measures the selected-finalist pass. Each selected finalist runs one pass, including candidates that are considered after earlier accepted retries remove their crossing. These are routing-pass statistics before the outer R22 finalist comparison.

| Split | Finalist runs / passes | Candidates | Accepted reroutes | Crossing reduction |
| ----- | ---------------------: | ---------: | ----------------: | -----------------: |
| dev   |                18 / 18 |        162 |                17 |                 16 |
| val   |                15 / 15 |        190 |                28 |                 27 |

There is no second pass; its crossing-reduction share is 0%.

Instrumented cost breakdown in summed seconds. First-pass routing includes strategies, refinement candidates, and the selected-finalist replan. Rip-up time excludes separately listed R95 scoring. Other planning includes placement, R22 scoring, seating labels, and finalization. Instrumented times are separate from the uninstrumented timing qualification.

| Split | First-pass routing | Rip-up pass | R95 scoring | Other planning |
| ----- | -----------------: | ----------: | ----------: | -------------: |
| dev   |             72.505 |       7.823 |       0.339 |         21.402 |
| val   |             92.041 |      13.433 |       0.532 |         19.260 |

### Paired timing

Used the prepared, installed and built `078f407` archive at `tmp/t028/paired-base/`. Ran its quick evaluation and this branch's quick evaluation sequentially with `--jobs 10`. Before each, `pgrep -fl 'auto-layout-eval|vitest'` returned no matches. The local test suite had finished before the pair, and our search and instrumented evaluations ran afterwards.

- Baseline load: `4:11  up 5 days,  3:21, 3 users, load averages: 3.34 4.63 6.83`.
- Branch load: `4:12  up 5 days,  3:22, 3 users, load averages: 7.99 5.79 7.13`.
- Summed planning time: **189.083 s → 227.541 s (1.203×)**, passing ≤1.25×.
- Slowest planning time: **16.022 s → 24.045 s**.
- Evaluator wall time: 52.862 s → 62.095 s. The target uses summed `timing.milliseconds`, not wall time.

Five largest documents:

| Split | Instances | Baseline seconds | Branch seconds |  Ratio |
| ----- | --------: | ---------------: | -------------: | -----: |
| val   |       103 |           16.022 |         24.045 | 1.501× |
| val   |        94 |            7.684 |         11.263 | 1.466× |
| dev   |        70 |            6.325 |         10.213 | 1.615× |
| val   |        51 |            1.968 |          3.378 | 1.716× |
| dev   |        50 |            3.452 |          5.867 | 1.700× |

Full candidate audits and a full pass-boundary audit remain in use. The summed target passes, although large documents still have the per-document overhead shown above.

### Offline search

`--search 120 --seed 1 --jobs 12` completed dev 18/18 and val 15/15. Baseline is the supplied `base-search120.json`:

| Measure            | Dev baseline → result             | Val baseline → result             |
| ------------------ | --------------------------------- | --------------------------------- |
| crossings          | 221 → 208                         | 296 → 277                         |
| bends              | 327 → 332                         | 389 → 372                         |
| floatingPins       | 0 → 0                             | 1 → 1                             |
| missingConnections | 0 → 0                             | 1 → 1                             |
| wireLength         | 130,950 → 132,050                 | 149,030 → 149,520                 |
| readability        | 0/22/7 → 0/27/7                   | 1/29/6 → 1/29/6                   |
| symmetry           | 58/58/58/58/7/7 → 58/58/58/58/7/7 | 29/29/29/29/4/4 → 29/29/29/29/4/4 |

Search documents with more floating pins than quick: 0; unsafe problems: 0; electrical-equivalence failures: 0. Search is deadline-limited, so evaluation counts and outcomes depend on execution speed.

### Artifacts

- Reports: `tmp/t028/result-quick.json`, `result-search120.json`, and `paired-base-quick.json`.
- Quick drawings: `tmp/t028/quick-svg/`; baseline drawings: `tmp/t028/base-svg/`.
- Instrumented report/statistics: `tmp/t028/r2-instrumented-quick.json`, `r2-stats-summary.json`; hook and log: `instrument-r2.mjs`, `r2-instrumented-final.log`.
- Six updated SVG comparisons and PNG renders in `tmp/t028/pairs/`, with `index.html`: the three largest crossing reductions, one unchanged drawing, the largest document, and the greatest bend increase. Categories can select the same drawing. Baseline is left; round 2 quick result is right.
- Corpus/held-out review renders: `tmp/auto-layout-review/index.html`.

An initial instrumentation attempt stopped before evaluation because another task's evaluator was present. After it exited, the first hook run failed because the evaluator invokes an untimed quick-reference plan before the measurement reset; initialized the hook on that path and reran successfully. Only the successful instrumentation rerun is used above; the failed hook report/log are retained as `r2-instrumented-initial-error.json` and `r2-instrumented-initial-error.log`. Product code was unchanged.

All human cases, identifiers, id-keyed measurements, instrumentation, and comparisons remain ignored under `tmp/`. Round 1 reports used for comparison were preserved in `tmp/t028/round1/`; round 2 acceptance uses only the new runs.

## Deviations and open questions

- No unresolved must-fix findings or unmet amended acceptance targets. The withdrawn −10% crossing target was not used for acceptance; the amended ≤272 target passes.
- Full per-candidate audits remain, as allowed when the timing target passes. No incremental-scoring claim is made. Per-document overhead and bend increases are disclosed above.
- No corpus or held-out ceiling changed. No commits, branch switches, dependency/lockfile changes, frozen-path edits, or edits to `plan.md`/`review.md` were made.
