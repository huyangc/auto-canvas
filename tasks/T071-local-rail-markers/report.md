# T071 report — round 2

## Summary

Addressed the round 1 local-rail search findings with R155: per-pin and
per-device candidates, up to eight finished trials, geometry-aware local seats,
marker approach routing, and support for annotation/conductor-owned power
claims. Added claim-only equivalence and rejection coverage, preserved original
power-label identities while reanchoring removed-route labels, updated the
review script's equivalence predicate, and added a local-rail timing phase.

The complete 57-rail dev diagnosis identifies round 1's dominant failure:
25 candidates were stopped by the preliminary symbol-bounds overlap test.
Eighteen more rails had no marker instance; five had no explicit name claim.
The final probe accepts 12 rail changes in 11 drawings, reducing total crossings
in these 45 affected dev drawings from 93 to 77. **Partial acceptance:** rail crossings fall 26.67% on dev and 13.89% on val;
total crossings fall 5.86% and 3.18%. All four reduction gates fail. One inherited
validation run-on increase also fails the visual guard. Details follow below.

## Steps

| Step                     | Status  | Notes                                                                                                                                                                                                                                        |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — investigate          | done    | Real Edit Engine fixtures establish explicit terminal membership and copied name/scope/domain, including existing claim-only rails.                                                                                                          |
| 2 — R155                 | partial | Both requested cluster partitions, bounded seats/trials, protection, calibrated-score selection and routed/readability guards implemented. Rail/total crossing thresholds fail on dev and val; one inherited visual regression also remains. |
| 3 — equivalence and Undo | done    | Preserve original partitions; validate every added marker's own claim against original naming authority. Review script now uses this predicate plus its existing ready-graph check. Same transaction and Undo coverage retained.             |
| 4 — tests                | done    | Ten focused tests pass, including claim-only ground route-label reanchoring, ground/AVDD partition authority, altered name/scope/domain rejection, deterministic planning, no marker growth, fixed/grouped objects and one Undo.             |
| 5 — spec and evaluation  | partial | R155 and R10/R12/R14/R43/R148 references updated. All 628 evaluated three times, review page rendered, six large plans byte-identical, no marker growth on six changed-count drawings; timing/hash evidence is complete.                     |

## Review findings addressed

1. **All crossed dev rails diagnosed.** The table below covers all 57 rails
   in 45 drawings, including every one of the 39 rails with instance markers.
   Raw round 1 and final round 2 records retain candidate-level diagnostics,
   guard names and before/after values. No accepted candidate leaves its target
   rail crossing count unchanged.
2. **Candidate coverage and dominant rejection causes.** Generate a candidate
   separating pins whose paths to a marker cross another Net (other pins share
   a retained/rebuilt trunk), and a candidate with one tree per device. Reuse
   existing markers before adding any. Share eight complete trials per document;
   geometric seating tries 28 local positions before routing. Check finished
   symbol/label/route guards instead of rejecting on all preliminary marker
   bounding-box intersections, including unrelated pre-existing intersections.
   Local single-pin wiring preserves the marker's vertical approach. Reanchor
   eligible route-owned power labels before cleanup; seat unlocked, unprotected
   labels after routing. Score/readability select the result, permitting partial
   rail-crossing improvements. Corpus bends/wire gates remain unchanged.
3. **Claim-only symbols and equivalence.** A power-marker-owned claim with
   `ground` or `vdd` domain authorizes the default corresponding symbol on its
   original partition. The model represents supply as `vdd`; its schema does
   not have a separate `supply` power-domain value. No model package change or
   invented name is needed. Original marker variants retain their existing
   authorization. Every added marker must have its own matching name, scope,
   domain and Net membership. A regression fixture with a generic Net-label
   claim preceding the power claim validates the input through the real Edit
   Engine and proves that evidence order cannot hide power authority.
   Equivalence searches matching original claims instead of assuming the first
   claim owns an added marker's identity. Generic named Nets remain excluded.
4. **Rule number.** The new rule and its cross-references use R155; T069's R154
   remains unchanged.
5. **Runtime diagnosis.** Added a separate `localRails` timing phase and compared
   main, archived round 1 and round 2 in alternating pairs. The final local pass
   is not the cause of the reported FD regression: it consumes under 1 ms on
   that drawing. Port search and label repair account for most extra elapsed
   time. The accepted marker-aware missing metric changes this input's missing
   count from 3 to 0, affecting earlier search scoring. CPU profiling puts
   missing-connection checking below 1% of samples; a temporary per-call cache
   did not improve elapsed time and was removed. The amended +20% median gate
   is used below; the +10% preference is reported separately.
6. **Review-script note.** `scripts/auto-layout-review.mjs` now checks
   `equivalentTerminals` for every committed result, in addition to the existing
   electrical graph comparison when the input graph is ready.

## Acceptance results

```text
pnpm build        → 0
pnpm typecheck    → 0
pnpm lint         → 0; 2051 files, 0 errors, 3424 warnings
pnpm format:check → 0; all matched files use Prettier code style
pnpm test:local   → 1 in sandbox; EPERM on local PostgreSQL/localhost services
pnpm test:local   → 0 with local-service access; 8090 passed, 117 skipped
pnpm test:slow    → 0; 3 files, 21 tests passed; no timeout changes
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
                  → 0 on all three runs; 628 completed, 0 non-equivalent, all hashes/metrics match
pnpm exec vitest run packages/auto-layout/test/local-rail-markers.test.ts --maxWorkers=2
                  → 0; 10 passed
```

The test retry used the same command; no timeout, assertion or dependency was
changed. [Round 2 command logs](../../tmp/t071/round2/logs/) preserve output.

### Corpus gates

All 628 completed; zero non-equivalent. Evidence:
[final full evaluation](../../tmp/auto-layout-eval/report.json),
[first full evaluation](../../tmp/t071/round2/evaluation-first.json),
[gate comparison](../../tmp/t071/round2/comparison.json).
The `netBreakdown.crossingsByKindPair` rail-involving sums agree with readability's
rail-crossing counts. No validation-driven parameter tuning was performed.

| Metric                  | Dev main → round 2            | Val main → round 2            | Gate     |
| ----------------------- | ----------------------------- | ----------------------------- | -------- |
| Rail crossings          | 60 → 44 (-26.67%)             | 36 → 31 (-13.89%)             | **FAIL** |
| Total crossings         | 273 → 257 (-5.86%)            | 157 → 152 (-3.18%)            | **FAIL** |
| Bends                   | 1778 → 1771                   | 737 → 734                     | pass     |
| Wire length             | 409362.675324 → 406472.675324 | 183468.558441 → 182588.558441 | pass     |
| Median area ratio       | 1.175025 → 1.175025           | 1.171972 → 1.171972           | pass     |
| Readability composite   | 100.026848 → 95.363214        | 49.920952 → 48.581228         | pass     |
| Floating pins           | 6 → 6                         | 0 → 0                         | pass     |
| Missing connections     | 11 → 4                        | 5 → 0                         | pass     |
| `VISUAL_LABEL_RUN_ON`   | 26 → 26                       | 11 → 12                       | **FAIL** |
| Other `VISUAL_*` totals | no increase                   | no increase                   | pass     |

Required reductions remain unmet: rail crossings must fall at least 30%, and
total crossings at least 10%, on both splits. The remaining visual failure is
`a8fbcba9-e418-4a5e-9b42-ba979f911c5c`: its run-on count is 0 with main, 1 with
archived round 1, and 1 with round 2. The local rail pass generates no change
there. [Independent reproduction](../../tmp/t071/round2/logs/visual-guard-probe.log)
shows this inherited earlier-planning regression; it remains an acceptance
failure and is not waived. The round 1 report's statement that all visual totals
were unchanged does not hold in this reproduction.

Missing-connection reductions include the already accepted marker-aware metric:
separate named marker components on one Base Net count as complete. They do not
all represent new physical wires. Floating-pin checks remain physical.

### Marker counts and re-runs

The evaluator retains human/result counts for every original rail Net. These
are the only rails whose instance-marker count changes:

| Drawing      | Rail Net               | Human | Round 2 |
| ------------ | ---------------------- | ----: | ------: |
| `3cr8ap2k4c` | `net-power-vdd1`       |     0 |       3 |
| `6n2s63bxv4` | `net-10529a21724082f1` |     1 |       6 |
| `k6bybqnz4b` | `net-power-vdd2`       |     0 |       4 |
| `p3af2sg23j` | `net-power-gnd2`       |     1 |       4 |
| `vgk5a82dfc` | `net-gnd-1`            |     1 |       2 |
| `x5jaqe94t7` | `net-power-vdd1`       |     0 |       4 |

All six changed-count drawings have deterministic repeated plans and equivalent
re-runs with no marker growth. [Re-run evidence](../../tmp/t071/round2/marker-verification.json).

| Drawing      | Input → first → re-run instances |
| ------------ | -------------------------------- |
| `3cr8ap2k4c` | 15 → 18 → 18                     |
| `6n2s63bxv4` | 11 → 16 → 16                     |
| `k6bybqnz4b` | 13 → 17 → 17                     |
| `p3af2sg23j` | 12 → 15 → 15                     |
| `vgk5a82dfc` | 10 → 11 → 11                     |
| `x5jaqe94t7` | 16 → 20 → 20                     |

All three complete 628-case evaluations, including the final claim-order fix,
have identical plan hashes and result metrics.
[Full-corpus determinism](../../tmp/t071/round2/determinism.json).
Final held-out timing is recorded below.

### Held-out runtime and phase profile

Three alternating main/task pairs per fixture, measured after other heavy checks
finished. Every held-out plan is deterministic and equivalent. The amended gate
is +20% of main's median; +10% remains the preference.
[Final-source timing evidence](../../tmp/t071/round2/verification.json).

| Fixture          | Main median ms | Round 2 median ms |   Ratio | +20% gate | +10% preference |
| ---------------- | -------------: | ----------------: | ------: | --------- | --------------- |
| fd-two-stage     |         3518.3 |            4071.8 | 1.1573× | pass      | miss            |
| common-source-ac |          869.2 |             825.9 | 0.9501× | pass      | pass            |
| skew             |         1830.2 |            1787.1 | 0.9764× | pass      | pass            |
| deadtime         |        17748.6 |           18655.0 | 1.0511× | pass      | pass            |
| ota-sky130       |          713.3 |             710.2 | 0.9956× | pass      | pass            |
| widlar           |         3870.3 |            3835.9 | 0.9911× | pass      | pass            |
| ltc3452          |        14789.4 |           14816.2 | 1.0018× | pass      | pass            |

FD phase medians below identify where the reported round 1 slowdown occurs.
Phases can be nested, so their times must not be summed.

| Phase       |  Main ms | Round 2 ms | Difference ms |
| ----------- | -------: | ---------: | ------------: |
| ports       | 1795.352 |   2187.122 |      +391.771 |
| labelRepair |  230.049 |    294.606 |       +64.557 |
| finishing   |  977.833 |    971.386 |        -6.447 |
| annealer    |  424.135 |    427.512 |        +3.377 |
| localRails  |    0.000 |      0.451 |        +0.451 |

The FD input's missing-connection count changes from 3 under main's metric to 0
under the accepted marker-aware metric. That score is used by the earlier search,
where most elapsed-time differences occur. The new final local-rail phase is
negligible on FD. A CPU sample attributed 25 of 3,547 samples to missing-connection
checking; caching that result within one public call did not materially improve
elapsed time and was removed. The [three-version diagnostic profile](../../tmp/t071/round2/fd-profile.json)
compares main, archived round 1 and the experimental round 2 cache; it is separate
from the final-source gate above.

### Large documents

All six full plans are byte-identical to main, including statistics and edits.
[Hashes and instance counts](../../tmp/t071/round2/large-verification.json).

| Drawing           | Instances | Full plan      |
| ----------------- | --------: | -------------- |
| `38m8wdesbh.json` |        50 | byte-identical |
| `4fb59zv76m.json` |        50 | byte-identical |
| `8b2n3zf9vj.json` |        51 | byte-identical |
| `b9afqhsjzv.json` |       103 | byte-identical |
| `g47e465db5.json` |        70 | byte-identical |
| `sm663cbs8b.json` |        94 | byte-identical |

### Review page

[Human | main | round 2](../../tmp/t071/review.html) contains the original 25
samples plus the ten largest rail reductions, with 33 distinct drawings after
overlap removal. [Sample/ranking list](../../tmp/t071/review-samples.json).
Rendered with the installed Chrome and visually inspected the
[page top](../../tmp/t071/round2/review-top.png),
[largest reduction](../../tmp/t071/round2/review-largest-drop.png), and
[added claim-only supplies](../../tmp/t071/round2/review-added-supply.png).
The bundled Playwright browser was absent; no browser/dependency was installed.

## Investigation results

`add_instance` alone does not join a Net. `connect_endpoints` authors explicit
membership; a fresh marker-owned name claim copies the existing claim exactly.
The original round 1 ground and AVDD tests still prove separate physical
components with the same Base Net. New claim-only fixtures prove that an existing
annotation-owned ground/AVDD claim can authorize a symbol, and that changing
name, scope, domain or original authority is rejected. A route-owned power label
keeps its identity and binding when its removed route is replaced by local trees.

Round 1 diagnosis: 25 preliminary overlap failures, 18 missing instance templates,
5 missing claims, 2 replay/equivalence/name failures, 1 routing-transaction failure,
and 6 finished candidates (2 accepted). Thus all 37 unchanged marked rails are
accounted for. The new pass does not weaken the finished visual guards.

Raw evidence: [baseline diagnosis](../../tmp/t071/round2/baseline-diagnosis.json),
[final candidate diagnosis](../../tmp/t071/round2/revised-diagnosis.json),
[phase profile](../../tmp/t071/round2/fd-profile.json).

### Every crossed dev rail

The table gives each original rail's outcome. For rejected finished trials it
shows the best candidate's failing guards; the linked JSON contains every trial.
All numbers are before → after. Construction failures are distinguished from
finished-candidate guard rejections. The complete table follows.

| Drawing      | Rail Net                                                  | Round 1 outcome                                                                                | Round 2 outcome                                                                                                                           |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `2adejzy693` | `net-power-gnd5`                                          | no finished candidate: symbol overlap                                                          | accepted (rail 2 → 0)                                                                                                                     |
| `2adejzy693` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[2,2],"readability":[0.605331,0.607825]}                                                                     |
| `2jhdk32et5` | `net-power-gnd5-copy-1`                                   | no finished candidate: symbol overlap                                                          | rejected pin/1: {"VISUAL_LABEL_CLEARANCE":[2,3]}                                                                                          |
| `3cr8ap2k4c` | `net-contact-gnd4-copy-1-copy-1-copy-1-copy-1`            | no finished candidate: symbol overlap                                                          | accepted (rail 1 → 0)                                                                                                                     |
| `3cr8ap2k4c` | `net-split-bea6f4ed03ac2b08`                              | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,2],"VISUAL_TERMINAL_DEPARTURE":[1,2],"score":[8694.084527,9539.084527],"readability":[0.445365,0.756065]} |
| `3cr8ap2k4c` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | accepted (rail 2 → 1)                                                                                                                     |
| `43fnp4b7tw` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[1,1],"readability":[0.307215,0.309605]}                                                                     |
| `4vtqat76zf` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[2,2],"readability":[0.4305,0.432736]}                                                                       |
| `54a79nkqef` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[3,4],"VISUAL_LABEL_CLEARANCE":[0,1],"score":[14000.008643,15512.444543],"readability":[0.623374,0.915211]}  |
| `5nrdf75rpd` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[2,2],"readability":[0.421321,0.42615]}                                                                      |
| `69ksgcs72g` | `net-power-agent-rail-0350a8230bee0e3d`                   | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[3,3],"floating":[0,1],"missing":[0,1],"score":[11639.247116,20620.112507]}                                  |
| `69ksgcs72g` | `net-power-gnd1`                                          | no finished candidate: routing transaction                                                     | no finished candidate: transaction/equivalence/name                                                                                       |
| `6n2s63bxv4` | `net-10529a21724082f1`                                    | accepted                                                                                       | accepted (rail 1 → 0)                                                                                                                     |
| `6n2s63bxv4` | `net-contact-gnd2_2`                                      | rejected: {"crossings":[1,1],"score":[4880.134344,4880.134344]}                                | rejected pin/2: {"crossings":[1,1]}                                                                                                       |
| `6r2q6deeq9` | `net-681813769330fd73`                                    | no finished candidate: equivalence or name claim                                               | no finished candidate: transaction/equivalence/name                                                                                       |
| `6s67mqbxx9` | `net-power-instance-bf226033-ff5c-497a-a2db-465f35c29438` | rejected: {"crossings":[2,2],"remaining rail crossings":1,"score":[10778.996027,10778.996027]} | no finished candidate: router                                                                                                             |
| `7d93gjqbw8` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[2,2],"readability":[0.486542,0.490318]}                                                                     |
| `a5tz83j7hp` | `net-ui-3`                                                | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1],"readability":[0.295391,0.295733]}                                                                     |
| `d2bpftaqyq` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[2,2],"readability":[0.459496,0.460025]}                                                                     |
| `d6egcq7hxy` | `net-power-gnd1-copy-1`                                   | no finished candidate: symbol overlap                                                          | no finished candidate: local tree length                                                                                                  |
| `d7zhk9xjnn` | `net-ui-6`                                                | no finished candidate: no name claim                                                           | no finished candidate: no name claim                                                                                                      |
| `dz689bvy2n` | `net-cell-pin-f64dd31fd36f3b09`                           | no finished candidate: no name claim                                                           | no finished candidate: no name claim                                                                                                      |
| `ecyqst76jd` | `net-split-70c79b5c3a9e833b`                              | no finished candidate: symbol overlap                                                          | accepted (rail 1 → 0)                                                                                                                     |
| `ecyqst76jd` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[3,3],"readability":[0.779881,0.784497]}                                                                     |
| `en97w8v92y` | `net-split-ee25290d83456574`                              | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[7,7],"VISUAL_TERMINAL_DEPARTURE":[0,1],"readability":[0.963885,0.984009]}                                   |
| `etswaaj69w` | `net-power-gnd1_2`                                        | rejected: {"crossings":[1,1],"remaining rail crossings":1,"score":[8662.198807,8662.198807]}   | rejected pin/2: {"crossings":[1,1],"VISUAL_TERMINAL_DEPARTURE":[0,1],"score":[8662.198807,9042.198807],"readability":[0.330276,0.350401]} |
| `fbnrez8q5g` | `net-power-gnd1`                                          | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1],"VISUAL_TERMINAL_DEPARTURE":[0,1],"VISUAL_LABEL_CLEARANCE":[0,1],"readability":[0.410357,0.431141]}    |
| `ftrjkg4566` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[3,3],"readability":[0.543649,0.546715]}                                                                     |
| `g8xh7jm33z` | `net-contact-vdd1`                                        | no finished candidate: no name claim                                                           | no finished candidate: no name claim                                                                                                      |
| `gbvzf4h3fj` | `net-power-vdd3`                                          | no finished candidate: no name claim                                                           | no finished candidate: no name claim                                                                                                      |
| `gh3gcb5h3a` | `net-power-gnd2`                                          | rejected: {"crossings":[3,3],"remaining rail crossings":1,"score":[12086.647383,12086.647383]} | rejected device/1: {"crossings":[3,3],"score":[12086.647383,12086.647383]}                                                                |
| `gh3gcb5h3a` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[3,3],"readability":[0.810396,0.814402]}                                                                     |
| `hr85s6jbqz` | `net-power-gnd2`                                          | no finished candidate: symbol overlap                                                          | no finished candidate: local tree length                                                                                                  |
| `jz7rweg6gg` | `net-cell-pin-vdd3`                                       | no finished candidate: no name claim                                                           | no finished candidate: no name claim                                                                                                      |
| `jzq4wvkwmf` | `net-contact-gnd1`                                        | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1],"readability":[0.295936,0.296077]}                                                                     |
| `k6bybqnz4b` | `net-power-vdd2`                                          | no finished candidate: no template or protected/mixed markers                                  | accepted (rail 2 → 0)                                                                                                                     |
| `kjs4xgzkba` | `net-ui-3`                                                | no finished candidate: equivalence or name claim                                               | no finished candidate: local tree length                                                                                                  |
| `kyxytts7gz` | `net-power-gnd3`                                          | no finished candidate: symbol overlap                                                          | accepted (rail 2 → 0)                                                                                                                     |
| `kyxytts7gz` | `net-split-0fe83a934d6139a8`                              | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[2,2]}                                                                                                       |
| `mfeab85zqw` | `net-10529a21724082f1_3`                                  | no finished candidate: symbol overlap                                                          | no finished candidate: transaction/equivalence/name                                                                                       |
| `n756yysrkx` | `net-power-gnd1-copy-1`                                   | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1],"readability":[0.299388,0.29956]}                                                                      |
| `ne46whs3fw` | `net-power-gnd1`                                          | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1]}                                                                                                       |
| `nxd3aqa7fp` | `net-contact-gnd1-copy-1`                                 | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[0,0]}                                                                                                       |
| `nxd3aqa7fp` | `net-split-6a8cae8b7cbbb536`                              | no finished candidate: symbol overlap                                                          | accepted (rail 2 → 0)                                                                                                                     |
| `p2whdap25e` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[1,1],"readability":[0.680691,0.684478]}                                                                     |
| `p3af2sg23j` | `net-power-gnd2`                                          | no finished candidate: symbol overlap                                                          | accepted (rail 1 → 0)                                                                                                                     |
| `ray97q5c2j` | `net-power-gnd5`                                          | accepted                                                                                       | accepted (rail 1 → 0)                                                                                                                     |
| `s75dft4ssy` | `net-power-gnd1_2`                                        | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1]}                                                                                                       |
| `sk29mm2ky6` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"VISUAL_LABEL_CLEARANCE":[0,3]}                                                                                          |
| `t3r2dvffgc` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[1,1],"readability":[0.478885,0.482055]}                                                                     |
| `westxcef83` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | no finished candidate: local tree length, transaction/equivalence/name                                                                    |
| `x4p48f96bp` | `net-42382e996e60a954`                                    | no finished candidate: symbol overlap                                                          | accepted (rail 1 → 0)                                                                                                                     |
| `x7evbngj49` | `net-contact-gnd4-copy-1-copy-1`                          | no finished candidate: symbol overlap                                                          | rejected pin/1: {"VISUAL_LABEL_CLEARANCE":[1,3]}                                                                                          |
| `x7evbngj49` | `net-power-gnd5-copy-1-copy-1`                            | no finished candidate: symbol overlap                                                          | no finished candidate: no clear local seat                                                                                                |
| `x7evbngj49` | `net-power-vdd1`                                          | no finished candidate: no template or protected/mixed markers                                  | rejected pin/1: {"crossings":[6,6],"readability":[1.697421,1.702207]}                                                                     |
| `yn2pjbpeby` | `net-ede067c7782ea5cf`                                    | no finished candidate: symbol overlap                                                          | rejected pin/1: {"crossings":[1,1],"VISUAL_TERMINAL_DEPARTURE":[0,1],"VISUAL_LABEL_CLEARANCE":[1,2],"readability":[0.297229,0.366383]}    |
| `yn2pjbpeby` | `net-d116ab7bd9b94c10`                                    | no finished candidate: symbol overlap                                                          | accepted (rail 2 → 1)                                                                                                                     |

## Deviations and open questions

- The original scope excluded all rails without marker instances. The approved
  plan amendment and review finding 3 explicitly extend scope to existing
  power-domain claims; only that extension is implemented.
- The original runtime gate was +10%; the approved review changes it to +20%
  median, retaining +10% as the preference.
- Pre-existing canonical route geometry may only materialize at transaction
  reconciliation. Candidates preserve/materialize available finished geometry
  before cleanup, then require whole-list replay and equivalence. Remaining
  transaction refusals are recorded rather than bypassed.
- **Open quality failures:** insufficient crossing reductions on both splits,
  and one inherited validation run-on increase. The remaining candidate refusals
  (short-tree bounds, whole-list replay, routing/visual/readability guards) are
  preserved in the per-rail diagnosis. The bounded candidate portfolio does not
  reach the requested reduction with the finished device poses. Broader placement
  changes were not substituted for the reviewed local-rail design. No acceptance
  threshold or test was weakened.
- No changes to other packages, dependencies, lockfile, plan or review. No
  commits, pushes, merges, rebases, branch switches or LLM-provider calls.
