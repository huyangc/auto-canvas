# T064 report — round 2

## Summary

Added the amended R150 skip condition, preserving round 1's reuse and
instance-count budgets. The base planning pass records R10 translations;
when none occurred and no owned movable input drafting group intersects a
finished base device's bounds grown by 60 units, R150 reuses the base candidate.
Drafting seating still runs, so remote titles continue to follow the layout.
The observation is synchronous and restored in `finally` between calls.

This round is **partial**: the skip path passes its regression tests, but
the predicate skips one of 293 eligible drawings in the evaluation corpus.
That drawing changes its plan; the other 626 completed plans remain
byte-identical to T062. The quality gate passes with identical primary metrics
and guards. The four timing targets remain unmet. Remaining phase
costs are reported below as requested by the amended plan and review.

## Steps

| Step | Status  | Notes                                                                                                                                                                      |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Retained the measured T062 profile, verified its source matches HEAD, remeasured the starting round 1 implementation and profiled the final implementation.                |
| 2    | done    | Implemented the measured R150 skip and retained shared preview/audit reuse. Skips one corpus drawing and preserves quality; none of the four benchmark paths skips a pass. |
| 3    | done    | Kept round 1's accepted size-only curve and reuse as instructed; no additional cuts retained.                                                                              |
| 4    | partial | All 655 auto-layout tests pass with unchanged timeouts; all four isolated timing targets fail.                                                                             |
| 5    | done    | Both splits pass every primary metric and guard; one changed completed-plan hash, with unchanged primary metrics and guards.                                               |
| 6    | done    | Updated R10/R150 documentation and wrote this report; R66 and the R146–R149 budget documentation remain in place.                                                          |

## Review findings addressed

1. **R150 wrapper:** no longer unconditionally plans a second candidate for
   every drawing with movable drafting. `drafting-search.ts` observes R10 and
   checks owned input ink against finished base device bounds; `auto-layout.ts`
   reuses the base candidate when clear. Existing title and owned-note tests now assert
   whether the second pass ran; a new test covers R10 translation and isolation
   from the following planning call. All original R150 assertions remain.
   The implementation is conservative: any R10 translation within the base
   portfolio, including a rejected trial, retains the second pass. It does
   not claim that the predicate proves equal plans.
2. **Timing:** targets remain unmet. The final isolated measurements and
   per-phase profile below identify the remaining work, as permitted by the
   review's expected fix. This report does not claim the task's speed goal or
   CI performance acceptance has been achieved.

## Acceptance results

```text
pnpm build → 0; all builds complete; existing editor chunk-size warnings.
pnpm typecheck → 0.
pnpm lint → 0; 2028 files, 0 errors, 3291 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0; 44 files, 655 tests passed; 102.72 s.
node tmp/fixture-timing.mjs . held-out-cases.json → 0; deadtime 30 instances 36173 ms; ltc3452 21 instances 28542 ms; targets FAIL.
node tmp/fixture-timing.mjs . corpus-cases.json → 0; two-inverters 9 instances 1547 ms; common-source 9 instances 1370 ms; targets FAIL.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; report.json and index.html written; 627/628 completed, matching baseline.
python3 /tmp/t064-r2-targets.py → 1; all four printed durations exceed their target.
node /tmp/t064-compare.mjs → 0; dev and val pass all primary/guard thresholds; one changed plan hash (dev); primary metrics and all guards unchanged.
node /tmp/t064-r2-count-skips.mjs → 0; dev 1/213 eligible skipped; val 0/80 eligible skipped.
node /tmp/t064-measure.mjs final --repeat → 0; all four complete plans baseIdentical=true and deterministic=true.
node /tmp/t064-large.mjs → 0; all six large complete plans byte-identical to T062.
node /tmp/t064-r2-case.mjs → 0; one corpus pass skipped; deterministic; quality unchanged.
node /tmp/t064-r2-title.mjs → 0; second pass skipped; complete plan unchanged and deterministic.
```

The evaluation has **628 inputs**, with the same 627 completions and one
refusal (`yje2n6eva2`) as `tmp/le10-t062r1/report.json`. The round 1 report's
“627” describes completed drawings, not the full input count. The first added
R10 test used ink outside the planned device envelope and failed to exercise
a translation. Moving that synthetic obstacle to `(80, 0)` exercised the
intended path; the focused test and full suite then passed. No original test
assertions or timeouts were weakened, removed, or skipped.

## Investigation results

### Baseline and retained budgets

`git diff 18fbac2 HEAD -- packages/auto-layout/src` is empty. The round 1
instrumented T062 profile in `/tmp/t064-base-profile.jsonl` therefore remains
the baseline; it has not been relabeled as a new round 2 run. Milliseconds:

| Fixture       | Total   | Annealer | R147    | R146    | Rail seats | R149  | R150 second pass | Finishing |
| ------------- | ------- | -------- | ------- | ------- | ---------- | ----- | ---------------- | --------- |
| two-inverters | 2376.4  | 642.6    | 4.3     | 669.8   | 2.6        | 84.0  | 0.0              | 513.6     |
| common-source | 2186.0  | 737.8    | 495.4   | 2.2     | 3.5        | 653.5 | 1012.7           | 705.2     |
| deadtime      | 45942.9 | 6151.1   | 13424.9 | 11295.9 | 4080.1     | 15.7  | 23455.6          | 17270.7   |
| ltc3452       | 37403.3 | 6203.4   | 12839.6 | 10.7    | 3088.3     | 15.4  | 18639.4          | 11345.6   |

Phase columns overlap: R150 contains the entire second planner, the searches
include trial finishing, and finishing includes repairs, rip-up, compaction
and following/separating labels. Do not add these columns together.

The retained curve preserves caps through 30 instances, then uses
`floor(b * (30 / n)^3)` through 40. The plain annealer uses `b=24` with a
minimum of two; finishing uses `b=10` for the shared R147/R149 budget,
`b=12` for R146 and `b=8` for marker seating. Optimized/partitioned defaults
remain eight; explicit annealer budgets remain authoritative. Above 40,
all previous behavior remains unchanged. Counts include ports and markers.

| Instances | Annealer | R147 + R149   | R146          | Marker seats  |
| --------- | -------- | ------------- | ------------- | ------------- |
| 0–30      | 24       | 10            | 12            | 8             |
| 31        | 21       | 9             | 10            | 7             |
| 34        | 16       | 6             | 8             | 5             |
| 40        | 10       | 4             | 5             | 3             |
| >40       | 2        | previous path | previous path | previous path |

Round 1 already tested larger cuts: the cubic curve starting at ten instances
failed the primary quality limits; a later plateau curve introduced one
floating pin and one missing connection on deadtime. The reported 7.784 s
was from that **rejected** deadtime configuration, not the retained tree.
The amended plan/review summary's 7.8 s deadtime and 18.5 s ltc3452 are not
reproduced by the starting tree. Round 2's initial isolated measurements were
36.426 s and 29.410 s respectively (two-inverters 1.624 s; common-source
1.408 s). No rejected budget configuration was restored.

Round 1's retained call-scoped reuse remains: transaction previews (maximum
256 per document/resolver), routed placements (128 per fixed-drafting pass),
and immutable audit/span/guard observations. Explicit zero-budget planning
retains its routing-call sequence. The existing caller-mutation regression
continues to pass. No additional cache or budget change was made this round.

Round 1's isolated reuse ablations (milliseconds, each column cumulative)
are retained as historical evidence; they were not rerun in round 2:

| Fixture       | T062    | + Preview reuse | + Routed-placement reuse | + Audit/span/guard reuse |
| ------------- | ------- | --------------- | ------------------------ | ------------------------ |
| two-inverters | 2376.4  | 1768.3          | 1643.5                   | 1579.1                   |
| common-source | 2186.0  | 1438.2          | 1462.0                   | 1466.6                   |
| deadtime      | 45942.9 | 36870.1         | 36441.6                  | 35787.1                  |
| ltc3452       | 37403.3 | 30133.5         | 29099.5                  | 28567.8                  |

All four complete plans remained identical in each ablation. The later
common-source columns are run-to-run noise, not evidence of extra savings.
The conservative retained budget curve also left all corpus plans unchanged;
it does not reduce the budgets of the 21- or 30-instance benchmarks.

### R150 skip and separate quality effect

The predicate uses input group bounds and finished base non-marker device bounds;
ownership can still refer to an instance, route, or junction. It observes the
entire base portfolio conservatively, rather than trying to infer translation
from the final drawing's envelope. If it skips, it still passes the base through
`followDraftingGroups` with the existing scoring, connectivity and visual guards.

| Split | Inputs | Completed | Movable-drafting eligible | Skipped second passes | Changed completed plans |
| ----- | ------ | --------- | ------------------------- | --------------------- | ----------------------- |
| dev   | 439    | 439       | 213                       | 1                     | 1                       |
| val   | 189    | 188       | 80                        | 0                     | 0                       |

All four benchmark plans also remain identical to T062. Two-inverters has no
second pass to save; the other three retain it because their base portfolios
translate under R10. This round's skip supplies **zero saved planning passes
on the four benchmarks**, independently of ordinary timing noise.

The first round 2 probe checked input device bounds as well as input drafting
bounds. That overly conservative interpretation skipped zero corpus drawings.
It was corrected to check the finished base's device bounds, and the full
acceptance was rerun. The earlier probe's report is preserved at
`/tmp/t064-r2-input-bounds-report.json`; its primary metrics and all plan hashes
were identical to T062.

For the one skipped corpus drawing, `pxxj67dmag` (nine instances), an isolated
round 1 reuse-only / round 2 comparison with one warm-up and three measured
calls per implementation gives median 2492.1 → 901.2 ms (63.8% lower).
The second planning pass falls from 1578.1 ms to zero.
The resulting plan is deterministic; its edit count changes from 56
to 55. The replayed document differs in: annotations, drafting. Primary metrics and all guards remain unchanged.

The remote-title regression fixture demonstrates that the skip executes. An
isolated comparison against the round 1 reuse-only build, with one warm-up
and ten measured calls per implementation, gives median 41.27 → 23.11 ms
(44.0% lower). Every complete plan is identical and deterministic.
This synthetic result is not evidence of corpus or benchmark improvement.

### Final isolated timing and remaining profile

| Fixture       | T062 baseline (s) | Round 2 final (s) | Target (s) | Result |
| ------------- | ----------------- | ----------------- | ---------- | ------ |
| deadtime      | 45.943            | 36.173            | ≤9         | fail   |
| ltc3452       | 37.403            | 28.542            | ≤12        | fail   |
| two-inverters | 2.376             | 1.547             | ≤1.5       | fail   |
| common-source | 2.186             | 1.370             | ≤0.6       | fail   |

The acceptance timing scripts return zero even when their printed durations
miss the targets; those exit codes are not evidence that the targets pass.
Final acceptance timings and the subsequent profile/repeat run were sequential,
with no build, test, evaluation or other benchmark from this task running
alongside them. The earlier exploratory `/tmp/t064-r2-skip-profile.jsonl`
overlapped evaluation and is explicitly excluded from performance evidence.

| Fixture       | Total   | Annealer | R147    | R146   | Rail seats | R149  | R150 second pass | Finishing |
| ------------- | ------- | -------- | ------- | ------ | ---------- | ----- | ---------------- | --------- |
| two-inverters | 1545.9  | 385.6    | 2.5     | 473.7  | 1.2        | 47.6  | 0.0              | 348.6     |
| common-source | 1342.4  | 561.9    | 265.3   | 0.6    | 1.5        | 330.4 | 625.6            | 362.8     |
| deadtime      | 35503.3 | 5335.8   | 10016.1 | 8446.1 | 3047.2     | 0.8   | 18385.9          | 13358.7   |
| ltc3452       | 28603.2 | 5099.9   | 9399.3  | 3.2    | 2221.3     | 1.0   | 14192.0          | 8745.1    |

Every benchmark plan equals its T062 complete serialized plan and an immediate
repeat call. No timing observations participate in search decisions.

The costs explain the remaining gap: R150 still repeats substantial work;
R147 and R146 dominate deadtime, R147 dominates ltc3452, port seating dominates
two-inverters, and annealing plus relocation/gap finishing dominate
common-source. The approved skip condition does not remove these phases.

Subtracting only the observed R150 second-pass time would still leave two-inverters 1.546 s, common-source 0.717 s, deadtime 17.117 s, ltc3452 14.411 s. Those residuals also exceed the targets; skipping R150 alone cannot close the measured gap.

### Quality and invariants

Both split primary metrics and all guards are exactly equal to T062:

| Split | Crossings | Bends | Wire length        | Median area / human | Non-equivalent | Floating | Missing |
| ----- | --------- | ----- | ------------------ | ------------------- | -------------- | -------- | ------- |
| dev   | 279       | 1914  | 473601.350647363   | 1.4361001317523057  | 0              | 8        | 12      |
| val   | 127       | 726   | 197834.23376490863 | 1.3954894080915783  | 0              | 2        | 6       |

Every tracked `VISUAL_*` count is unchanged on both splits; each primary
change is 0%, within the +1% limit. 626 completed-plan hashes match; `pxxj67dmag` is the only changed plan.

All six large documents retain byte-identical complete plans:

| Document          | Instances | Byte-identical to T062 |
| ----------------- | --------- | ---------------------- |
| `38m8wdesbh.json` | 50        | yes                    |
| `4fb59zv76m.json` | 50        | yes                    |
| `8b2n3zf9vj.json` | 51        | yes                    |
| `b9afqhsjzv.json` | 103       | yes                    |
| `g47e465db5.json` | 70        | yes                    |
| `sm663cbs8b.json` | 94        | yes                    |

### Evidence locations

Acceptance logs are `/tmp/t064-r2-{build,typecheck,lint,format,suite}.log`,
`/tmp/t064-r2-{held-out,corpus}-timing.log`, and
`/tmp/t064-r2-eval-skip.log`. Comparison details are in
`/tmp/t064-r2-quality-comparison.json` and `/tmp/t064-r2-skips.json`;
the starting profile is `/tmp/t064-r2-before.jsonl`; final profile/repeat and
large-plan evidence are `/tmp/t064-r2-final-profile.jsonl` and
`/tmp/t064-r2-large.jsonl`. The report records their substantive results.

## Deviations and open questions

- Timing targets are still unmet. The amended plan permits reporting the
  remaining phase profile, but this is not completion of T064's original
  performance goal and does not establish that slow CI runners will pass.
- R10 observation conservatively includes discarded trials. A predicate
  limited to the winning plan would require tracking translation provenance
  through refinement, annealing and finishing; this implementation does not
  invent that provenance from final coordinates. Only one corpus drawing skips the second pass; none of the timing fixtures
  does. A follow-up plan should resolve this before
  expecting the R150 change alone to meet the targets.
- The starting worktree contained round 1 edits and Opus's plan/review changes.
  They were preserved. No commits, pushes, merges, rebases, branch switches,
  dependency or lockfile changes, LLM-provider calls, or edits to `plan.md` or
  `review.md` were made in this round.
