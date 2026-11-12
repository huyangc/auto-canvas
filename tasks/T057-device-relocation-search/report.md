# T057 report — round 2

## Summary

Fixed partition fallback to call plain planning with the original non-partition
options, including R147 device relocation followed by R146 port seating. Removed
the fallback-only search-disabling parameter. Empty documents skip both no-op
searches, preserving the existing empty-fallback test unchanged. Successful
partition plans keep their existing path.

Raised R147's deterministic finished-trial cap from eight to ten after dev-only
comparison showed shorter wire and fewer bends without a guard increase. The
candidate geometry, two-pose shortlist per unit, rigid-unit protection, finished
score, guards and anchor handling are unchanged from round 1. Updated R66/R147
budgets, R146/R147 fallback wording, and the new relocation budget assertions.

All six acceptance commands pass. Both dev and val improve crossings, bends and
wire against T056; guard, timing, determinism and excluded-mode checks pass.
The requested milestone remains missed: crossings 2.1453× and wire 1.4878× human.

## Steps

| Step | Status | Notes                                                                                                                   |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained general non-rail pin-facing candidates at 40/80 units, legal orientations, deduplication and bounds clearance. |
| 2    | done   | R147 runs before R146 in plain planning and partition fallback; both original fallback-equality tests pass unchanged.   |
| 3    | done   | Ten finished trials maximum, selected on dev; paired median and p95 satisfy the 2×/1.5× limits.                         |
| 4    | done   | All 620 tests pass, including 14 relocation tests; no existing test assertions or timeouts changed.                     |
| 5    | done   | R66/R147 specify ten trials; R146/R147 distinguish successful partition planning from fallback.                         |
| 6    | done   | Evaluated all 628 drawings twice; fresh base, split metrics, guards, timing, hashes and non-timing equality verified.   |

## Review findings addressed

- **Round 1 #1, must-fix:** partition fallback now calls `planAutoLayout` with
  `fallbackOptions`, so both searches run exactly as in plain planning. The two
  `R134 falls back after partition placement refuses` tests pass unchanged for
  default and explicit search. Successful partition byte identity is checked
  separately against the base.
- **Round 1 #2, should-fix:** spent additional budget on ten trials. On 439 dev
  drawings, eight → ten trials changed crossings **347 → 348**, bends
  **2077 → 2061**, and wire **493882.35 → 490213.35**. Floating/missing stayed
  8/12; label clearance 149 → 148, label-owner distance 4 → 3 and terminal
  departure 81 → 80; every other visual count stayed unchanged. Kept ten on
  the plan's wire-improvement criterion, acknowledging the extra crossing.
  Validation was evaluated only after this selection and did not drive tuning.
  Evidence: `tmp/t057-r2-tuning-comparison.json` and `tmp/t057-r2-ten-dev.json`.

## Acceptance results

```text
pnpm build → 0; all package/app builds completed (existing chunk-size warning).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2014 files, 0 errors, 3238 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0;
  Test Files 39 passed (39)
  Tests 620 passed (620)
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 documents; 627 completed; zero non-equivalent completed results.
```

Final-source logs are `tmp/t057-r2-logs/build-final.log`, `typecheck-final.log`,
`lint-final.log`, `format-check-final.log`, `vitest-final.log` and `eval.log`.
An earlier full-suite attempt failed one unchanged empty-document fallback spy
assertion (619 passed); adding the shared empty-document guard resolved it.
The final focused suites pass 47/47 and the complete suite passes 620/620.

Base → final candidate metrics:

| Split | Completed | Crossings | Bends       | Wire length           | Crossings/human | Wire/human      |
| ----- | --------- | --------- | ----------- | --------------------- | --------------- | --------------- |
| dev   | 439/439   | 372 → 348 | 2188 → 2061 | 510791.63 → 490213.35 | 2.4156 → 2.2597 | 1.5534 → 1.4908 |
| val   | 188/189   | 169 → 154 | 819 → 784   | 206469.68 → 201924.68 | 2.1125 → 1.9250 | 1.5137 → 1.4804 |
| all   | 627/628   | 541 → 502 | 3007 → 2845 | 717261.31 → 692138.03 | 2.3120 → 2.1453 | 1.5418 → 1.4878 |

All-drawing median area ratio improves from 1.5746 to 1.5583. The same one drawing,
`yje2n6eva2`, is refused. Floating pins remain 10 and missing connections remain 18. Every visual total is at or below base:

| Visual diagnostic                  | Base | Final |
| ---------------------------------- | ---- | ----- |
| `VISUAL_AMBIGUOUS_JUNCTION`        | 0    | 0     |
| `VISUAL_CONSTRAINT_VIOLATION`      | 0    | 0     |
| `VISUAL_LABEL_CLEARANCE`           | 207  | 195   |
| `VISUAL_LABEL_OVERLAP`             | 5    | 5     |
| `VISUAL_LABEL_OWNER_DISTANCE`      | 6    | 5     |
| `VISUAL_LABEL_RUN_ON`              | 48   | 44    |
| `VISUAL_OUTSIDE_PAGE`              | 0    | 0     |
| `VISUAL_ROUTE_OVERLAP`             | 0    | 0     |
| `VISUAL_SHORT_SEGMENT`             | 0    | 0     |
| `VISUAL_SYMBOL_OVERLAP`            | 0    | 0     |
| `VISUAL_TERMINAL_DEPARTURE`        | 103  | 97    |
| `VISUAL_TERMINAL_ON_FOREIGN_ROUTE` | 0    | 0     |
| `VISUAL_UNPLACED_INSTANCE`         | 0    | 0     |
| `VISUAL_UNRESOLVED_SYMBOL`         | 0    | 0     |
| `VISUAL_WIRE_THROUGH_SYMBOL`       | 20   | 18    |

`tmp/t057-r2-comparison.json` contains split comparisons, and
`tmp/auto-layout-eval/report.json` contains net breakdowns and per-case results.

Paired timing, sequential runs with 12 workers and no concurrent tests:

| Split | Base median ms | Final median ms | Ratio  | Base p95 ms | Final p95 ms | Ratio  | Repeat median / p95 ratios |
| ----- | -------------- | --------------- | ------ | ----------- | ------------ | ------ | -------------------------- |
| dev   | 1513.97        | 1921.64         | 1.269× | 6234.78     | 9048.34      | 1.451× | 1.226× / 1.428×            |
| val   | 1507.93        | 1918.41         | 1.272× | 8129.18     | 8175.25      | 1.006× | 1.274× / 0.955×            |
| all   | 1509.86        | 1920.02         | 1.272× | 6310.65     | 8673.54      | 1.374× | 1.239× / 1.373×            |

The cached base's 55 source files exactly match `HEAD`; its fresh 628 plan hashes
and all non-timing results exactly match `tmp/le10-t056r2/report.json`.
The two final-candidate runs have identical plan hashes and all non-timing
results for all 628 cases. The full run also retains every dev tuning hash.
Evidence: `tmp/t057-r2-base-verification.json`, `tmp/t057-r2-verification.json`
and `tmp/t057-r2-repeat-comparison.json`.

All six >40-instance plans (50, 50, 51, 103, 70 and 94 instances) are
byte-identical to base. 10 successful partition checks, one optimized
check and one zero-budget check are byte-identical to base; partition checks
explicitly require nonempty plans, no errors and no fallback. Evidence:
`tmp/t057-unchanged.json` and `tmp/t057-r2-modes.json`.

Additional evidence commands:

```text
node tmp/t057-r2-base-eval.mjs tmp/le10-input --jobs 12 → 0
node tmp/t057-r2-repeat-eval.mjs tmp/le10-input --jobs 12 → 0
node tmp/t057-unchanged.mjs → 0
node tmp/t057-r2-modes.mjs → 0
node tmp/t057-r2-compare.mjs → 0
node tmp/t057-r2-repeat-compare.mjs → 0
node tmp/t057-r2-verify.mjs → 0; pass: true.
git diff --check → 0.
```

`tmp/t057-r2-runs.json` records evaluation commands and exit codes. Evaluation
inputs, reports and helper scripts remain under ignored `tmp/`.

## Investigation results

No explicit investigation steps. The dev-only budget comparison above addresses
the review's requested timing-headroom investigation. Ten trials reduce dev wire
by 3669 units (0.74%) and bends by 16, at the cost of one crossing, with no guard
increase. Paired timing confirms the extra budget fits.

## Deviations and open questions

- The aspirational all-drawing milestone is missed: 2.1453× crossings exceeds
  2.0× and 1.4878× wire exceeds 1.4× human. The plan requires reporting this;
  all other behavioral acceptance checks pass.
- No remaining must-fix findings. No existing tests or timeouts were weakened,
  skipped or removed; only the new R147 budget assertions changed from 8 to 10.
- No commits, pushes, merges, rebases, branch changes, dependency/lockfile changes,
  generated-source edits, router changes or provider API calls. `plan.md` and
  `review.md` were not edited; their pre-existing changes remain untouched.
