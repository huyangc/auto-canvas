# T061 report — round 3

## Summary

Retained Opus's default budget of 24 for plain planning through 40 instances,
with 8 for optimized and partitioned planning and 2 above 40. Also preserved
budget 8 when partition planning falls back to plain planning. Updated the
chain's pinned default box and fixed the planner's gap-closing treatment of
single-host ports and feedback bands. The original corpus assertions remain
unchanged. All three latest must-fix findings are addressed.

All six acceptance commands pass, including 642 tests and the full 628-drawing
evaluation. Crossings fall on both splits, both area ratios remain within +2%,
and no additional guard increases appear beyond the validation increases Opus
accepted in round 2. All six large plans remain byte-identical.

Overall status is **partial solely because idle-machine timing remains
unverified**. Two fresh paired runs pass both numerical timing limits and
reproduce every plan hash, but both record unrelated desktop/system CPU
activity. The first run was repeated as instructed; neither is claimed as a
“nothing else running” measurement.

## Steps

| Step                        | Status                          | Notes                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — dev sweep and selection | done (reviewed evidence reused) | Retained the reviewed round 1 8/16/24/32 dev sweep and Opus's selected budget 24. No new budget selection or tuning on val. Historical sweep and fresh round 3 metrics are distinguished below.                                                 |
| 2 — paired timing           | partial                         | Two fresh paired runs, 628 drawings each, 12 workers, alternating order; numerical median and p95 limits pass. Competing CPU activity persisted, so the idle-machine condition remains unverified.                                              |
| 3 — default, R66, tests     | done                            | Retained Opus's default/R66/evaluator changes; preserved the partition fallback budget; updated the pinned box and added optimized/partition default equivalence tests. Fixed the reviewed planner failure without weakening corpus assertions. |
| 4 — all drawings            | done                            | Exact acceptance command evaluated all 628 inputs: 627 completed, none non-equivalent, floating 10, missing 18. Both dev and val satisfy the latest review's quality conditions.                                                                |

## Review findings addressed

1. **Latest round must-fix 1 — pinned chain box:** updated width 202 → 182
   and height 12.36 → 12.74, the actual budget-24 box. Its x/y remain
   999/983.63. Kept all anchoring, transaction, and 1.5× span assertions.
2. **Latest round must-fix 2 — stale port seat:** reproduced the exact
   `(370, 220)` failure with
   `pnpm exec vitest run packages/auto-layout/test/corpus.test.ts -t two-stage-symbolic`.
   Phase probes confirmed R149 moved a host after R146/R148, leaving its port
   behind. Gap trials now carry movable single-host signal ports with their
   hosts before finishing/routing/scoring, and restore the enclosing anchor.
   Fixing that assertion exposed the same fixture's feedback-band assertion;
   gap trials now reject separation of those existing vertical relationships.
   The entire corpus test is unchanged and passes, including the port-seat,
   feedback, anchoring, topology, and repeat-planning assertions.
3. **Latest round must-fix 3 — re-evaluation:** reran all 628 drawings with
   the fix. Dev crossings 320 → 283, val 151 → 134; median area +0.5908%
   and +1.4094%; floating 10, missing 18, zero non-equivalent. All visual
   totals are reported below. The previously accepted val increases persist,
   with no new guard failure.

## Acceptance results

Logs are in `tmp/t061-r3/`; command exits are in `acceptance.json`.

```text
pnpm build → 0; all package/app builds completed
pnpm typecheck → 0; no type errors (also rerun after the added mode tests)
pnpm lint → 0; 2021 files, 0 errors, 3281 warnings
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0; 42 files passed, 642 tests passed, 129.53s; timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 inputs, 627 completed, zero non-equivalent
```

Additional verification:

```text
pnpm exec vitest run packages/auto-layout/test/corpus.test.ts -t two-stage-symbolic → 0; both matching tests pass after the fix
node --import ./tmp/t061-r3/baseline-hook.mjs tmp/t061-r3/large.mjs → 0; all six full plans byte-identical
node --import ./tmp/t061-r3/baseline-hook.mjs tmp/t061-r3/modes.mjs → 0; all 13 sample plans match T060
python3 tmp/t061-r3/timing-run.py → 0; all 628 baseline and candidate hashes reproduce
python3 tmp/t061-r3/timing-repeat.py → 0; all 628 baseline and candidate hashes reproduce again
```

## Investigation results

### Cause and correction

The failing fixture is a deterministic public-planner/real-transaction regression,
reproducing in about four seconds. It was retained intact as the regression test
rather than replacing its surrounding topology with a synthetic scenario.
Temporary phase probes (`tmp/t061-r3/probe.log`) ruled out R146/R148 as the source
of the stale seat: device/port poses match immediately before gap closing.
R149 then moves X7 from `(490, 280)` to `(540, 230)`, while P13 moves only from
`(370, 270)` to `(370, 220)`. Thus its horizontal host offset changes by 50.

The gap callback now derives single-host signal-port relationships from the
finished incumbent's topology, carries their offsets through each proposed
translation, restores the enclosing anchor when no instance is fixed, then
routes and finishes normally. Existing trial counts, scoring, topology,
connectivity, and visual guards still decide acceptance. Fixed ports remain
fixed; rail seats keep their existing handling.

The subsequent C10 assertion exposed a second relationship R149 could split:
a passive spanning two non-rail nets of a signal block must keep its vertical
feedback offset. This is the same general feedback-band relationship already
protected by `compactRows`; gap trials now reject changes to that offset.
There are no circuit names, coordinates, or fixed feedback distances in the fix.
All temporary source/test probes were removed.

Partition fallback also needed an explicit inherited search policy: removing
`partition` before recursively calling the plain planner would otherwise change
its default from 8 to 24. The existing fallback test now compares against an
explicit budget 8, while preserving the explicit-search branch and every other
assertion. Two added tests compare optimized/partition defaults with real
explicit-budget-8 planning calls.

### Reviewed dev selection

These are the reviewed round 1 sweep results, **not a new sweep of the repaired
planner**. Latest review explicitly applied budget 24; this round retained that
choice and evaluated the required planner correction without retuning on val.
Artifacts remain in `tmp/t061-r1/dev-{8,16,24,32}/report.json`.

| Budget | Dev crossings | Dev bends |      Dev wire | Median area / human |
| -----: | ------------: | --------: | ------------: | ------------------: |
|      8 |           320 |      2005 | 479165.350647 |            1.423394 |
|     16 |           303 |      1958 | 477695.350647 |            1.436033 |
|     24 |           284 |      1945 | 476873.350647 |            1.438066 |
|     32 |           279 |      1942 | 479603.350647 |            1.447722 |

The reviewed best is 279, giving a 2% threshold of 284.58; 24 was the smallest
eligible budget. Fresh repaired-budget-24 dev crossings are 283. The timing below
measures the repaired planner against the actual T060 baseline.

### Fresh quality against T060 and round 2 candidate 24

Base: `tmp/le10-t060r2/report.json`. Round 2 candidate:
`tmp/t061-r2/candidate-24/report.json`. Round 3:
`tmp/t061-r3/report.json` (copy of `tmp/auto-layout-eval/report.json`).
Structured comparisons: `tmp/t061-r3/evidence.json`.

| Split | Measure             |   T060 base 8 | Round 2 candidate 24 |          Round 3 default 24 |
| ----- | ------------------- | ------------: | -------------------: | --------------------------: |
| dev   | crossings           |           320 |                  284 |                         283 |
| dev   | bends               |          2005 |                 1945 |                        1945 |
| dev   | wireLength          | 479165.350647 |        476873.350647 |               476861.350647 |
| dev   | median area / human |      1.423394 |             1.438066 | 1.431803 (+0.5908% vs base) |
| val   | crossings           |           151 |                  134 |                         134 |
| val   | bends               |           764 |                  745 |                         744 |
| val   | wireLength          | 198873.675324 |        200647.233765 |               200577.233765 |
| val   | median area / human |      1.365934 |             1.380158 | 1.385185 (+1.4094% vs base) |

The val wire increase is about 0.86% over T060, below the approximately 0.89%
increase Opus accepted. Dev wire is lower; bends are lower on both splits.
Median area is within +2% on each split, including val's increase relative to
round 2. The one unchanged refusal is `yje2n6eva2`. Floating pins remain 10 and
missing connections 18; all 627 completed plans are electrically equivalent.

Every visual total (including unchanged zeros):

| Diagnostic                         | Dev base | Dev r2 | Dev r3 | Val base | Val r2 | Val r3 |
| ---------------------------------- | -------: | -----: | -----: | -------: | -----: | -----: |
| `VISUAL_AMBIGUOUS_JUNCTION`        |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_CONSTRAINT_VIOLATION`      |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_LABEL_CLEARANCE`           |      134 |    134 |    134 |       45 |     50 |     50 |
| `VISUAL_LABEL_OVERLAP`             |        5 |      5 |      5 |        0 |      0 |      0 |
| `VISUAL_LABEL_OWNER_DISTANCE`      |        3 |      0 |      0 |        2 |      2 |      2 |
| `VISUAL_LABEL_RUN_ON`              |       35 |     31 |     29 |        8 |      7 |      7 |
| `VISUAL_OUTSIDE_PAGE`              |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_ROUTE_OVERLAP`             |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_SHORT_SEGMENT`             |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_SYMBOL_OVERLAP`            |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_TERMINAL_DEPARTURE`        |       72 |     67 |     67 |       17 |     17 |     17 |
| `VISUAL_TERMINAL_ON_FOREIGN_ROUTE` |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_UNPLACED_INSTANCE`         |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_UNRESOLVED_SYMBOL`         |        0 |      0 |      0 |        0 |      0 |      0 |
| `VISUAL_WIRE_THROUGH_SYMBOL`       |       12 |     12 |     12 |        6 |      8 |      8 |

The only increases over T060 remain the accepted val label-clearance 45 → 50
and wire-through-symbol 6 → 8. Corpus totals remain 179 → 184 and 18 → 20.
This fix introduces no further increase in any visual total on either split;
dev label-run-on improves further, 31 → 29 versus round 2.

### Determinism and protected behavior

Both fresh paired runs reproduce all 628 base hashes against T060 and all 628
candidate hashes against the fresh evaluation, including val and the refusal.
The repair changes 46 plan hashes relative to round 2's candidate; their ids are
recorded in `evidence.json`, so prior hashes are not misrepresented as unchanged.

All six above-40-instance drawings (50, 50, 51, 103, 70, 94 instances) have
byte-identical full serialized plans against T060; see `large.json`. All 13
additional compatibility samples match T060, including optimized, explicit
zero/search-16, and successful partition calls; see `modes.json`. The unchanged
explicit-search option/budget is still honored. The required R149 bug fix applies
to its shared positive-budget plain-planning path, including explicit searches
that reach that path; sample equality is not a claim that every explicit-search
plan is globally unchanged.

The temporary baseline hook loads `auto-layout.ts` from `ed8d78b` in memory using
Node's type stripping. Other product code is unchanged from that baseline
(`ed8d78b..HEAD` contains only the task plan). No built/generated files were
hand-edited. Hash equality against the saved T060 report verifies the baseline
harness itself. Evaluations used no LLM or partition-provider option.

### Paired timing and unrelated CPU activity

Both runs use all 628 inputs, the same 12 workers, a quick-plan warmup, and
alternating baseline/candidate order per input. Planner calls alone are timed.
No other task build, test, or evaluation ran concurrently with either run.
All numerical ratios pass median ≤1.6× and aggregate p95 ≤1.5×:

| Run    | Base median ms | Candidate median ms | Median ratio | Median paired ratio | Base p95 ms | Candidate p95 ms | p95 ratio |
| ------ | -------------: | ------------------: | -----------: | ------------------: | ----------: | ---------------: | --------: |
| first  |       2503.944 |            3367.037 |    1.344694× |           1.318475× |   12833.388 |        14156.561 | 1.103104× |
| repeat |       2517.210 |            3359.469 |    1.334600× |           1.313236× |   12640.619 |        14189.559 | 1.122537× |

Process snapshots were taken every 15 seconds. Both runs contain unrelated CPU
activity, so neither establishes the plan's idle-machine condition:

- First: 44 snapshots, 46 unrelated-process observations at ≥20% CPU. Largest
  peaks: Chrome renderer 126.9%, Spotlight updater 83.7%, BackgroundShortcutRunner
  78.3%, pkd 77.0%, siriactionsd 74.7%.
- Repeat: 44 snapshots, 37 such observations. Largest peaks: pkd 73.4%,
  BackgroundShortcutRunner 69.3%, siriactionsd 67.2%, eligibilityd 45.5%, lsd 35.0%.

The 20% figure summarizes observations; it is not an invented acceptance
threshold. Raw snapshots and summarized peaks are in
`paired-processes.txt`, `paired-repeat-processes.txt`, and `load-summary.json`.
Timing and hashes are in `paired-dev.json` and `paired-repeat.json`; despite the
first filename, both contain all 628 drawings. The first loaded run was repeated
as required. Unrelated processes were not stopped.

## Deviations and open questions

- The remaining acceptance limitation is a quiet timing window. Numerical timing
  passes twice, but competing CPU activity persists; no idle-machine pass is
  claimed. This is why the overall status remains partial despite addressing
  all three latest must-fix findings and passing all quality guards as amended.
- Reused the reviewed budget sweep and retained Opus's choice of 24. It was not
  rerun after the relationship repair; the fresh quality table is explicitly
  separate from that historical selection evidence.
- Latest review authorizes the planner correction beyond the original
  budget-only edit. Feedback-band protection was necessary to pass another
  unchanged assertion in the same failing fixture, revealed after fixing ports.
  Production edits stayed in `auto-layout.ts`; no out-of-scope helper was edited.
- Opus's existing `scripts/auto-layout-eval.mjs`, R66, and budget changes were
  preserved. `plan.md` and `review.md` were not edited. No dependencies,
  lockfiles, annealer moves/scores, test timeouts, or generated sources were
  changed. No LLM API calls, commits, pushes, merges, rebases, or branch switches
  occurred. Branch remains `task/T061-default-search-budget`.
