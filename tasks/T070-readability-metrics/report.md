# T070 report — round 2

## Summary

Fixed both must-fix findings from the latest review. Generated a frozen model
from the verified `eb72cb1` round 1 report, exposed `readabilityScore(metrics)`,
and removed fitting from evaluation. Every human, quick and result score now
uses the same fixed weights and scales. Added a target view for the 11 metrics
with nonzero weights and the composite; all 26 metrics remain reported.

The frozen model exactly reproduces round 1: **361/439 dev pairs (82.23%)** and
**151/189 val pairs (79.89%)** strictly prefer the human, with no ties. Composite
result/human ratios remain **2.7125 dev** and **2.1181 val**. These do not meet
the 1.2 target; this task measures readability and does not optimize layouts.

## Steps

| Step                      | Status | Notes                                                                                                                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — metric set            | done   | Retained all 26 measurements and definitions from round 1; no planner changes.                                                                                     |
| 2 — human calibration     | done   | All per-metric totals, ratios, opportunities, human-zero shares and better/worse/equal shares remain in each scoreboard split. Added diagnostic flags and targets. |
| 3 — composite             | done   | `--write` generates `readability-weights.ts`; evaluation imports frozen scoring and never refits. Source metadata and SHA-256 accompany the model.                 |
| 4 — flagged cases         | done   | Regenerated the four historical/current comparisons with unchanged metrics; evidence below.                                                                        |
| 5 — review page           | done   | Refreshed `tmp/t070/readability.html` for round 2, retaining the 25 supplied samples and four flagged comparisons.                                                 |
| 6 — tests and definitions | done   | 15 tests; added fixed-score and target-boundary regressions. Documented all zero-weight diagnostics and reasons.                                                   |

## Review findings addressed

1. **Must-fix #1 — moving fit:** `readabilityScore(metrics)` imports the generated
   frozen weights/scales. The evaluator calls it for human, quick and result
   snapshots and summarizes it without fitting. The standalone CLI retains
   diagnostic refitting; only explicit `--write` regenerates the artifact.
   Its header names source commit, report and command, and exported metadata
   includes the report SHA-256 and training settings. The source report's 628
   hashes match `tmp/main-eb72cb1-report.json`. All source per-drawing scores,
   split composites, weights and scales reproduce round 1 **exactly**, exceeding
   the ±1 percentage-point requirement. Regeneration is byte-identical.
2. **Must-fix #2 — targets:** each split has `readability.targets` with human
   total, result total, ratio and `withinTarget` for all 11 nonzero-weight
   metrics, plus the composite. Metrics use `result <= 1.2 * human`, or
   `result <= human + 2` when human is strictly below 10. The composite uses
   the 1.2 ratio threshold. All 15 zero-weight metrics remain visible as
   `diagnostic: true`, with reasons documented in `docs/testing/readability.md`.
3. **Should #3 — narrow bands:** retained as a zero-weight diagnostic, as
   permitted by the review. It measures compact projection gaps, not wasted
   strips beside tall parts. Human dev totals are worse (1446 vs 1018), and the
   flagged human is also worse (4 vs 2 historical / 1 current). No definition
   or weight was retuned on val.

## Acceptance results

```text
pnpm build
  → 0; apps/editor build: Done (existing bundle-size warning).
pnpm typecheck
  → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint
  → 0; oxlint: 2043 files, 0 errors, 3357 warnings.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test/readability-metrics.test.ts
  → 0; 1 file passed, 15 tests passed.
pnpm test:local
  → 0; 789 files passed, 3 skipped; 8067 tests passed, 117 skipped.
  Ran with approved access to existing localhost/test-database services,
  because round 1 established that sandbox networking blocks those tests.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
  → 0; 628/628 completed; scoreboard contains all metrics, frozen composite
    and targets for dev/val/all; wrote report.json and index.html.
node scripts/readability-fit.mjs tmp/auto-layout-eval/report.json
  → 0; printed weights/scales and single-metric/composite accuracies.
git diff --check
  → 0.
```

Logs and evidence are under `tmp/t070/round2-*`. The full local suite finished
before evaluator timing began; no tests were weakened or skipped by this task.

Planner invariance: **628/628 plan hashes match** the supplied `eb72cb1` baseline
in both the final evaluator and fresh baseline runs. The final report contains
48,984 finite non-negative metric measurements, unchanged from round 1, and
1,884 independently verified frozen scores. Evidence:
`tmp/t070/round2-verification.json`.

Runtime: the final sequential baseline/evaluator comparison **passes**:
**240.40 s new / 239.66 s baseline (+0.31%)**, below +25%. CPU totals are
3438.83 s new / 3437.00 s baseline (+0.05%). Commands were wrapped in
`/usr/bin/time -p`, with 12 workers and no overlapping repository checks.

The initial new-evaluator run took **399.84 s** (3699.39 s CPU), which **failed**
the limit against the fresh baseline (+66.84% wall, +7.63% CPU). The much larger
wall-time difference prompted one repeat, immediately after the baseline,
without changing any code. That repeat passed and reproduced all hashes,
metrics and scores. The first timing remains in
`round2-eval-time.log`; it is not discarded or claimed to pass. The exact cause
of its wall-time variation was not established. Baseline and repeat timing are
in `round2-baseline-time.log` and `round2-eval-repeat-time.log`; the full
comparison is in `round2-performance-verification.json`.

The baseline helper is exactly `eb72cb1:scripts/auto-layout-eval.mjs`, verified
byte-for-byte after normalizing only relocated imports and its temporary output
directory. Command:
`node tmp/t070/baseline-eval.mjs tmp/le10-input --jobs 12` (exit 0).

## Investigation results

### Frozen calibration and score independence

Generation command:

```bash
node scripts/readability-fit.mjs tmp/t070/eb72cb1-readability-report.json --write --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59
```

The source is a preserved copy of the completed round 1 readability report;
the older supplied baseline has hashes but no readability measurements. Its
SHA-256 is `607720ccd8ac524f6a5d05a5e658500c1ad25703204d8e57f6b5e32617c03172`.
The generated artifact contains aggregate statistics only. No raw Gallery
files are included in repository changes.

`round2-calibration-verification.json` records exact score/fit reproduction and
628 source plan-hash matches. `round2-corpus-invariance.json` records a retained
drawing's identical score after multiplying the other 627 drawings' result
penalties by 100. Unit tests also cover val-only scoring, absent dev training
for diagnostic fits, zero human totals, human totals of 9 and 10, target
boundaries, ties, zero-weight exclusion and opportunity-independent scoring.

### Per-metric targets

All 11 weighted metrics are shown below. H/R is human/result total; pass/fail
uses the documented small-count rule. Full totals, ratios and discrimination
for all 26 metrics remain in the evaluator scoreboard and standalone fit output.

| Metric               |                   Dev H/R |   Ratio | Target |                   Val H/R |  Ratio | Target |
| -------------------- | ------------------------: | ------: | ------ | ------------------------: | -----: | ------ |
| `area`               | 464461.0385 / 766295.6338 |  1.6499 | fail   | 281566.1925 / 574534.2027 | 2.0405 | fail   |
| `avoidableJogs`      |                    4 / 22 |  5.5000 | fail   |                     1 / 2 |      2 | pass   |
| `blockedJoins`       |                     5 / 9 |  1.8000 | fail   |                    0 / 10 |   null | fail   |
| `controlSeparation`  |                   25 / 37 |  1.4800 | fail   |                     4 / 6 | 1.5000 | pass   |
| `crossings`          |                 154 / 279 |  1.8117 | fail   |                  80 / 153 | 1.9125 | fail   |
| `labelOverlaps`      |                     4 / 5 |  1.2500 | pass   |                     1 / 0 |      0 | pass   |
| `portOrder`          |                 118 / 198 |  1.6780 | fail   |                  74 / 102 | 1.3784 | fail   |
| `railCrossings`      |                    8 / 66 |  8.2500 | fail   |                   10 / 31 | 3.1000 | fail   |
| `sourcePolarity`     |                    6 / 14 |  2.3333 | fail   |                     3 / 5 | 1.6667 | pass   |
| `terminalDepartures` |                   27 / 39 |  1.4444 | fail   |                    3 / 10 | 3.3333 | fail   |
| `unownedDrafting`    |                  15 / 214 | 14.2667 | fail   |                    7 / 53 | 7.5714 | fail   |
| `composite`          |        48.0446 / 130.3225 |  2.7125 | fail   |         26.9892 / 57.1657 | 2.1181 | fail   |

The target view makes the remaining layout work explicit: **1/11 dev** and
**4/11 val** metrics meet their targets; the composite fails on both splits.
No target failure was hidden by refitting or by dropping a reported metric.

### Historical flagged cases

All measurements below use the same current metric code on regenerated
historical and current layouts. The existing isolated `05050fd` build was reused;
its stale dependency symlinks were refreshed to this worktree after an initial
`ERR_MODULE_NOT_FOUND`. No dependencies were installed and no branch switched.

| Drawing                                                          | Defect metric              | Human | 05050fd | eb72cb1 |
| ---------------------------------------------------------------- | -------------------------- | ----: | ------: | ------: |
| Common-Source Amplifier (`f1a0b46a-180f-47cc-9bb2-815554aa7575`) | `signalSeriesVertical`     |     0 |       1 |       0 |
| Same drawing                                                     | `narrowBands` (diagnostic) |     4 |       2 |       1 |
| Source degeneration (`bv9zwmd835`)                               | `blockedJoins`             |     0 |       1 |       0 |
| gain-boost cascode half-circuit (`8w2ra7hdrw`)                   | `controlSeparation`        |     0 |       1 |       1 |
| New Circuit (`75k4jskamd`)                                       | `controlSeparation`        |     0 |       1 |       1 |
| Same drawing                                                     | `unownedDrafting`          |     0 |       3 |       3 |

The two required historical defects remain strictly worse on their named
metrics. Source degeneration's output marker obstructs an already aligned join;
this is `blockedJoins`, not the two-terminal-only `avoidableJogs` metric.
`75k4jskamd` is the New Circuit drawing with two control amplifiers and free
circle/text pseudo-ports. Names and identifiers are not used by the metrics.

The dev-only narrow-gap calibration remains 439 drawings / 2,456 positive gaps,
with first quartile 0.8 pitches and median 1.8 pitches; the threshold remains
strictly below two pitches. Retaining that statistic does not establish a
readability target, which is why narrow bands remain diagnostic-only.

The review page preserves every metric and denominator, 29 sections and 62 SVGs,
with gap/drafting overlays on flagged cases. The round 1 visual layout is
unchanged; round 2 refreshes renders, measurements and the frozen-model notice.
Local reproduction: `tmp/t070/flagged.mjs`, `tmp/t070/review.mjs`.

## Deviations and open questions

- The review explicitly adds `readability-weights.ts` to the required output;
  it was produced by the generator, not hand-edited. It is ready for Opus to
  commit after review; this implementer made no commits.
- The evaluator's former `readabilityFit` field is replaced by
  `readabilityModel` so fixed provenance cannot be mistaken for a fit on the
  current run. The fitting CLI's diagnostic output still uses `fit`.
- Metric-level small-count tolerance does not apply to the continuous composite;
  its target is always the 1.2 ratio. This distinction is documented and tested.
- Definitions are unchanged. Some human conventions and compact drawings score
  worse on diagnostic metrics. The composite also prefers the auto Source
  degeneration drawing over the human; it is not a universal ranking.
- Existing limitations remain: control-separation normalization can be diluted
  by distant geometry, Manhattan MST detour is not a Steiner optimum, inference
  may abstain, and approximate drafting ownership can miss wrong nearby owners.
  Electrical equivalence and routing safety checks remain authoritative.
- No existing planner source, guard, dependencies, lockfile, plan or review was
  edited. No LLM calls, commits, pushes, merges, rebases or branch switches.
