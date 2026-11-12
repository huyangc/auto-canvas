# T056 report — round 2

## Summary

Reworked R146 to compare fully finished candidates with the finished default
incumbent. Each accepted move must preserve floating pins, missing connections
and every `VISUAL_*` count. Added median/pair-midpoint seats for multi-host Nets,
20-unit local seats, wire weight 4 for port-seat comparison, and grid-snapped
whole-layout translation to retain the R1 anchor. Updated the permitted corpus
seat assertions and added regression coverage. All 606 auto-layout tests pass.

This round is partial: aggregate port wire decreases **19.27%** (target
25%) and port-related crossings decrease **13.75%** (target 20%). The
remaining reduction targets are not claimed as fixed. Paired timing
passes the amended relative limits; full measurements follow.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                         |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Every host contributes snapped 20/40/80/120-unit exit seats. Multi-host Nets also contribute four inward-facing seats, 40 units from the coordinate median and every pair midpoint. Current and R19/R20 fallback seats remain available.                      |
| 2    | done   | Rank by R54 MST length/crossings with the calibrated 4/1000 ratio; evaluate two alternatives per port, at most 12 seat trials for the finished winner. Strict finished-score improvement, incumbent on ties, and per-drawing connectivity/all-visual guards.  |
| 3    | done   | Paired base/new `--jobs 12`; all-drawing median 1.084× base, p95 1.499× base.                                                                                                                                                                                 |
| 4    | done   | 606 tests pass with unchanged timeouts, including second-host selection, obstructed local seats, edge-only routing, determinism, locks, excluded modes, midpoint generation, anchor translation, finished label-owner regression and connectivity regression. |
| 5    | done   | R19/R20/R71/R93 references retained; R146 updated to the finished comparison, candidate set, budget, weights and guards.                                                                                                                                      |
| 6    | done   | Evaluated all 628 drawings twice; dev/val results below. Reduction targets remain partial.                                                                                                                                                                    |

## Review findings addressed

1. **Must-fix 1 — fixed.** The original default result is completed first.
   Each seat trial then runs R72, R95/R96, R97/R144, facing, local rerouting,
   ordinary label seating, drafting-label following and final label separation
   before scoring and guard checks. Label finishing runs exactly once for
   each result, including the returned winner. The guard compares every
   `VISUAL_*` diagnostic from both visual-quality and label-clearance audits,
   plus floating pins and missing connections, against the finished incumbent.
   Independent evaluation finds **no per-drawing guard regressions**. In
   `3ze5gasahn`, `Q1.B` remains connected: floating/missing counts stay 0/0,
   port wire is 367 → 204, and its port crossing is 1 → 0.
2. **Must-fix 2 — fixed.** Only the amended seat-contract block of
   `corpus.test.ts` was rewritten. It accepts the old local/edge seat or an
   actual searched seat, checks finishing-facing stability and physical
   connection of every host to its port, and retains existing overlap and
   edge-spacing assertions. Candidate checking removes the incumbent first,
   avoiding a tautological membership assertion. All other assertions and
   timeouts remain unchanged.
3. **Must-fix 3 — method fixed; target still missed.** Added between-host
   candidates, calibrated port wire weight 4, and whole-placement translation
   rather than anchor rejection. Other R74 comparisons retain weight 0.1.
   The best tested dev configuration reduces port wire 19.00%, below 25%;
   full-corpus result is 19.27%. See calibration and remaining gap below.
4. **Must-fix 4 — aggregate limit met.** Both full evaluators ran concurrently with
   `--jobs 12`, after builds, tests and large-document checks finished.
   Median ratio is 1.084× (limit 2×), p95 ratio is
   1.499× (limit 1.5×).

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing editor chunk-size warning.
pnpm typecheck → 0.
pnpm lint → 0; 2011 files, 0 errors, 3221 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0; 38 files, 606 tests passed; 49.76 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 627/628 completed.
node tmp/t056-r2-base-eval.mjs tmp/le10-input --jobs 12 → 0; concurrent paired baseline.
node tmp/t056-r2-repeat-eval.mjs tmp/le10-input --jobs 12 → 0; repeated full evaluation.
node tmp/t056-r2/verify.mjs → 0; baseline/repeat/dev hashes, all non-timing fields, per-drawing guards and six large plans verified.
node tmp/t056-unchanged.mjs → 0; six above-40 plans byte-identical.
node tmp/t056-modes.mjs → 0; optimized, zero-budget and partition spot checks byte-identical.
git diff --check → 0.
```

## Investigation results

### Dev calibration and budget choice

Used the plan-approved wire component of the T055 dev calibration: wire 4.
T055 fitted wire/span weights on 310 dev comparisons, choosing wire 4 / span 4
with preference agreement 289/310 (93.23%), versus 186/310 (60.00%) for legacy
wire 0.1 / span 0. R146 adopts only the wire coefficient, not the span term;
that combined historical calibration is not presented as independent evidence
for wire alone. All remaining R74 coefficients stay unchanged.

Dev quality measurements and the final budget result:

| Dev configuration                                                              | Port wire            | Port crossings | Total crossings | Total wire |
| ------------------------------------------------------------------------------ | -------------------- | -------------- | --------------- | ---------- |
| Base                                                                           | 186,455.23           | 178            | 400             | 548,835.03 |
| Two seats; 40/80/120; R54 shortlist                                            | 155,822.40 (−16.43%) | 154 (−13.48%)  | 373             | 516,912.19 |
| Three-seat timing trial; 20/40/80/120; 4/1000 shortlist; final local rerouting | 151,345.84 (−18.83%) | 152 (−14.61%)  | 371             | 511,055.63 |

The final two-seat configuration gives dev port wire
151,035.84, port crossings
152, total crossings
372, and total wire
510,791.63.

All configurations include median/midpoint candidates, finished guards and
anchor translation. The three-seat variant's paired dev p95 was 15,315.18 ms
against base 9,926.59 ms (1.543×), missing the 1.5× limit; all-drawing p95 was
1.672×. On that dev timing evidence, reduced the final shortlist to two seats
while retaining 20-unit candidates, the 4/1000 cheap ranking and final local
rerouting. No val quality metrics were consulted for this adjustment. The
final configuration keeps the same cap of 12 seat trials. A trial is a complete normal-pipeline evaluation, including the R44
routing alternatives and bounded repairs; it is not just one router call.
The expanded candidate/ranking/local-rerouting changes were tested together,
so their individual effects are not claimed. No validation data fitted the
weights or quality search. The three-seat full run reproduces its dev-only
hashes; the final two-seat repeat verifies every final dev and val hash.

### Full corpus

Values are `tmp/le10-t055r2/report.json` → round 2. Primary sums cover the
same 627 completed pairs. The same drawing, `yje2n6eva2`, is refused.

| Metric                 | Dev (439)                         | Val (189)                        | All (628)                         |
| ---------------------- | --------------------------------- | -------------------------------- | --------------------------------- |
| Completed              | 439 → 439                         | 188 → 188                        | 627 → 627                         |
| Non-equivalent         | 0 → 0                             | 0 → 0                            | 0 → 0                             |
| Port wire              | 186,455.23 → 151,035.84 (-19.00%) | 79,065 → 63,320 (-19.91%)        | 265,520.23 → 214,355.84 (-19.27%) |
| Port-related crossings | 178 → 152 (-14.61%)               | 91 → 80 (-12.09%)                | 269 → 232 (-13.75%)               |
| Total crossings        | 400 → 372 (-7.00%)                | 180 → 169 (-6.11%)               | 580 → 541 (-6.72%)                |
| Total wire             | 548,835.03 → 510,791.63 (-6.93%)  | 223,754.68 → 206,469.68 (-7.72%) | 772,589.70 → 717,261.31 (-7.16%)  |
| Bends                  | 2,185 → 2,188                     | 813 → 819                        | 2,998 → 3,007                     |
| Floating pins          | 8 → 8                             | 2 → 2                            | 10 → 10                           |
| Missing connections    | 12 → 12                           | 6 → 6                            | 18 → 18                           |

Port-wire host breakdown (all): singleHost: 60,530.00 → 41,790.00 (-30.96%); multiHost: 204,990.23 → 172,565.84 (-15.82%).
The remaining wire is concentrated in multi-host Nets. A bounded greedy seat
search and cheap MST/crossing shortlist do not exhaust jointly beneficial
port placements; a lower weighted score also need not minimize port wire or
port crossings separately. Finished guards deliberately reject any visual or
connectivity regression. These are limitations of the current method, not
justification for weakening the acceptance thresholds. No circuit-specific
rules, ids, names, coordinates or validation-fitted exceptions were added.

### Visual guards

| Diagnostic                       | Dev base → new | Val base → new | All base → new |
| -------------------------------- | -------------- | -------------- | -------------- |
| VISUAL_AMBIGUOUS_JUNCTION        | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_CONSTRAINT_VIOLATION      | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_LABEL_CLEARANCE           | 170 → 156      | 56 → 51        | 226 → 207      |
| VISUAL_LABEL_OVERLAP             | 5 → 5          | 0 → 0          | 5 → 5          |
| VISUAL_LABEL_OWNER_DISTANCE      | 5 → 4          | 2 → 2          | 7 → 6          |
| VISUAL_LABEL_RUN_ON              | 39 → 39        | 13 → 9         | 52 → 48        |
| VISUAL_OUTSIDE_PAGE              | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_ROUTE_OVERLAP             | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_SHORT_SEGMENT             | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_SYMBOL_OVERLAP            | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_TERMINAL_DEPARTURE        | 93 → 85        | 24 → 18        | 117 → 103      |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_UNPLACED_INSTANCE         | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_UNRESOLVED_SYMBOL         | 0 → 0          | 0 → 0          | 0 → 0          |
| VISUAL_WIRE_THROUGH_SYMBOL       | 20 → 14        | 6 → 6          | 26 → 20        |

Every visual total is at or below baseline. The independent comparison is
stronger than aggregate acceptance: no completed drawing increases any visual,
floating-pin or missing-connection count. Electrical equivalence is preserved;
this work changes schematic presentation, not circuit behavior, so no simulator
or provider API was invoked.

### Timing, determinism and exclusions

The paired full run used identical inputs and concurrent `--jobs 12` evaluators,
with no build, unit-test or large-document workload. Times are milliseconds.

| Split | Base median | New median | Ratio  | Base p95 | New p95   | Ratio  |
| ----- | ----------- | ---------- | ------ | -------- | --------- | ------ |
| dev   | 2,556.39    | 2,795.59   | 1.094× | 8,135.05 | 12,075.46 | 1.484× |
| val   | 2,433.63    | 2,568.22   | 1.055× | 7,302.88 | 13,412.09 | 1.837× |
| all   | 2,511.95    | 2,722.16   | 1.084× | 8,063.81 | 12,089.54 | 1.499× |

Aggregate timing meets the amended limits, but p95 is only 0.000766× below
its 1.5× bound (about 6.17 ms of headroom). Dev p95 also passes at 1.484×.
**Val-only p95 is 1.837× and does not meet a per-split interpretation of the
limit.** The plan's timing limit is reported on all drawings; the val result
and negligible aggregate headroom remain a performance risk, not a robust
margin. No absolute 10 s timing pass is claimed.

The saved pre-T056 compiled baseline reproduces all 628 T055 plan hashes.
Two current full runs reproduce all 628 plan hashes and every non-timing
report field. Only `milliseconds`, `timing` and `planningMilliseconds` fields
are excluded, recursively. No timing-based candidate budget was introduced.

All six required large documents match the base byte-for-byte:
`38m8wdesbh` (50), `4fb59zv76m` (50), `8b2n3zf9vj` (51), `b9afqhsjzv` (103),
`g47e465db5` (70), `sm663cbs8b` (94). Optimized, zero-budget and partition
spot checks also match, and the unit test excludes partition fallback from R146.

Local evidence remains ignored under `tmp/`:

- `tmp/auto-layout-eval/report.json`: full paired new run.
- `tmp/t056-r2-base/report.json`: paired base run.
- `tmp/t056-r2-repeat/report.json`: repeated new run.
- `tmp/t056-r2/dev-two-seats.json`, `tmp/t056-r2-tuned/report.json`: dev experiments.
- `tmp/t056-r2/three-seats-full.json`, `three-seats-paired-base.json`: rejected timing budget.
- `tmp/t056-r2/verification.json`, `comparison.json`: independent checks and totals.
- `tmp/t056-unchanged.json`, `tmp/t056-modes.json`: byte comparisons.
- `tmp/t056-r2/logs/`: acceptance, evaluation and compatibility logs.

## Deviations and open questions

- The reduction targets remain missed as reported above. Aggregate p95 has
  negligible margin and the val-only p95 exceeds 1.5× base. Further improvement
  needs a better shortlist or coordinated port moves within the timing budget;
  no router, device-placement or out-of-scope change was attempted.
- To satisfy review 1, R146 starts from the completed default winner, then
  sends every trial through the normal finishing pipeline before comparison.
  This preserves the actual baseline guards instead of comparing provisional
  plans. R1 anchoring translates all placements by grid multiples and retains
  the existing half-grid bounds tolerance.
- The amended relative timing contract supersedes the stale absolute 10 s
  wording in step 3. The measured relative result is reported without
  substituting unpaired dev timings.
- No commits, pushes, merges, rebases, branch switches, dependency/lockfile
  changes, LLM-provider calls, or edits to `plan.md`/`review.md` were made.
  Their initial modifications/untracked state were preserved. Third-party
  drawings, build snapshots and benchmark artifacts remain untracked in `tmp/`.
