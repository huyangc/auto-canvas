# T175 report — round 1

## Summary

The implementer (Opus subagent) committed `b1451c1` and `fc6031d`, and Opus
added one review fix (see review.md). `pnpm test:local` dropped from about
165 s (2 workers) to about 45–49 s (config default, 9 workers on 18 cores),
and from 168 s to 136 s when pinned to `--maxWorkers=2`. Default suite:
9056 → 9055 tests (8 moved to slow, 7 added); slow suite: 8 → 16 tests.

## Steps

| Step                  | Status               | Notes                                                                                                                                                                                                                                                                                                                                |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Worker count        | done                 | Root `test.maxWorkers` in `vitest.config.ts`: Vitest 4.1.10 `resolveMaxWorkers` takes a project's own value, then the root's; no project sets one, and `--maxWorkers` replaces the root value (checked: 9 local, 18 with `CI=1`, 1 with `--maxWorkers=1`). Flags removed from `test:local`/`test:slow`; stale ci.yml comment removed |
| 2 CI format check     | done, CI log pending | `fetch-depth: 2` and `FORMAT_BASE_SHA` from `pull_request.base.sha`. This PR touches `package.json`, so its own run falls back to a full check by design; the changed-files path is shown locally (`Formatting changed files: 1`)                                                                                                    |
| 3 current-source-tail | done                 | Both full-search `it.each` blocks moved verbatim to `current-source-tail.slow.test.ts`; builders in `current-source-tail.test-support.ts`; 4 quick-planning default cases                                                                                                                                                            |
| 4 Large/perturbation  | done (+ review fix)  | stages 120 → slow, default 41-device chain (review fix; was 40); layered 85 → slow, 60 stays; differential perturb → slow, quick default cases via `checkSingleStage({ quick })` in `differential-branches.test-support.ts`                                                                                                          |
| 5 Duplicate replay    | done                 | Only the R22 re-plan removed from `quality.test.ts`; comment points to the corpus determinism check                                                                                                                                                                                                                                  |
| 6 Split long poles    | done                 | corpus → `corpus.test.ts` (rest), `corpus-two-inverters`, `corpus-common-source`; held-out → rest, `held-out-ltc3452`, `held-out-deadtime`; bodies in `*.test-support.ts`, one plan cache per file. quality (13.9–14.7 s) was under 15 s and not split                                                                               |
| 7 Docs                | done                 | `docs/testing/README.md` Local validation                                                                                                                                                                                                                                                                                            |

## Investigation results

Quick planning (`search: { seed: 1, evaluations: 0 }`) geometry that holds for
both cases of an input and is therefore asserted in the default suite:

- Source-resistor tail: none of the geometry (validity, replay,
  `equivalentTerminals`, `unsafeProblems` only). Quick planning leaves one
  crossing and different rows/axis.
- Input stage: u on the b side, `bias.x === axis`, the junction tee on
  `common` above the bias, `crossings <= (follower ? 2 : 0)`.
- Degenerated differential branches: mirrored pairs on one row,
  `connectionsIntact`, empty `unsafeProblems`; output rows, sides, symmetry
  and zero crossings need full search.

Files still above 15 s at 9 workers: `scripts/launcher.test.mjs` (~26 s,
out of scope) and `apps/editor/src/features/netlist-export/rnl-round-trip.test.ts`
(~17 s, not auto-layout).

## Timing (18 cores)

| Run                                | Before                               | After                                     |
| ---------------------------------- | ------------------------------------ | ----------------------------------------- |
| `pnpm test:local` (config default) | 165 s (2 workers); 66 s at 9 workers | 44.8 s (Opus rerun), 48.9 s (implementer) |
| `--maxWorkers=2`                   | 168 s                                | 136 s                                     |
| `pnpm test:slow`                   | 8 tests                              | 16 tests, 64 s                            |

## Deviations

1. Helpers are named `*.test-support.ts` (the plan said
   `current-source-tail-cases.ts`): `.oxlintrc.json` relaxes
   `no-non-null-assertion` only for test and test-support files, and knip
   already treats them as test support.
2. `differential-branches.test-support.ts` is new: the slow file needs
   `checkSingleStage`, and importing a test file would register its tests twice.
3. Only quick-planning geometry that holds for both cases of each input is asserted.
4. `quality.test.ts` was not split (under 15 s after step 5).
