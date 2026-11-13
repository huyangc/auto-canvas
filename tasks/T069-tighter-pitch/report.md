# T069 report — round 3

## Summary

Round 3 is **partial**. Retained the 100/80/120 pitch through 40 instances and
120/100/160 above 40. Port-seat search now applies the straight-join filter
before shortlisting: obstructing seats are considered only when no clear
alternative exists. Finished port seats and label repairs cannot introduce
newly obstructing markers. Relocation bounds speculative trials on physically
complete layouts, retaining the existing ten-slot budget and all gap trials.
The two R151 tests are updated within round 2's authorization. Earlier rounds
tested 100/80/120, 80/80/120 and 100/80/100 on dev; that pitch selection remains
unchanged (artifacts under `tmp/t069-r1/`).

## Steps

| Step | Status  | Notes                                                                                                                                  |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Retained the dev-selected small-document pitch; no round 3 pitch tuning.                                                               |
| 2    | done    | Applied straight-join seat checks to port finishing and label-repair acceptance.                                                       |
| 3    | done    | Kept the reviewed geometric legacy-pitch retry; rechecked corpus connectivity/refusals.                                                |
| 4    | done    | Added blocked-seat and bounded-relocation regressions; updated the two authorized R151 tests.                                          |
| 5    | partial | Updated R146/R147/R154; evaluated all 628, checked determinism/large plans/timing, and rendered the 25-sample review. See gates below. |

## Review findings addressed

1. **Authorized R151 tests — done.** The portfolio test now compares `calibratedScore` instead of separately requiring crossings, bends and wire to improve. Its determinism, Net preservation, row ordering and complete selector-equivalence assertions remain. The rejection fixture fixes `q0` at (100, 100), making the series-level result demonstrably worse (1005.72 vs 2918.70 in the fixture probe); it asserts the strict score inequality, selector rejection and equality of the public planner with the selector.
2. **Blocked joins — done.** New round 2 dev cases: `9nrfdtqnta`, `hr85s6jbqz`, `kyxytts7gz`, `t4j5wwx5x4`, `x7wr36szy7`, each main 0 → round 2 1. All five targeted replays now measure 0. The old search accepted its obstructing fallback first, lowering the score below all clear alternatives. Clear candidates now take precedence; finishing and label repair reuse `straight-joins.ts` to reject newly obstructing seats.
3. **Runtime — done.** Before the fix, Widlar measured 1.243× main; relocation grew 519 → 1385 ms. Trial traces showed rejected alignments that increased estimated wire substantially without reducing estimated crossings. The final rule skips physically complete-layout proposals with no estimated crossing reduction and over 5% more estimated wire. Skipped proposals still consume their original slot, so later gap search cannot expand. Incomplete layouts and gap proposals keep every original trial. Final paired timing below.

## Acceptance results

```text
pnpm build → 0; see command log
pnpm typecheck → 0; see command log
pnpm lint → 0; oxlint: 2045 files, 0 errors, 3389 warnings
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0; Test Files  790 passed | 3 skipped (793); Tests  8077 passed | 117 skipped (8194); Duration  86.19s (transform 8.33s, setup 0ms, import 18.97s, tests 148.23s, environment 493ms)
pnpm test:slow → 0; Test Files  1 passed (1); Tests  7 passed (7); Duration  50.32s (transform 952ms, setup 0ms, import 1.17s, tests 49.09s, environment 0ms)
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628-case report includes readability.targets.
```

The initial sandboxed local run failed with PostgreSQL/loopback `EPERM` (60 failed tests, 7984 passed, 150 skipped; two conversion-test timeouts after denied listeners). It is preserved as `test-local-sandbox.log`. The command was rerun with local-service access, and all six commands were rerun again after the final runtime change; the table above records the final source version. No timeout setting was increased. Logs and reproducible local harnesses are under `tmp/t069-r3/`.

### Full-corpus gates

| Metric          |  Main dev |  T069 dev |  Change |  Main val |  T069 val |  Change |
| --------------- | --------: | --------: | ------: | --------: | --------: | ------: |
| readability     |    130.32 |    122.06 |  -6.34% |     57.17 |     54.85 |  -4.05% |
| crossings       |       279 |       273 |  -2.15% |       153 |       157 |  +2.61% |
| bends           |      1751 |      1780 |  +1.66% |       737 |       744 |  +0.95% |
| wireLength      | 428454.63 | 409452.68 |  -4.43% | 191616.12 | 183668.56 |  -4.15% |
| medianAreaRatio |  1.273875 |  1.183622 |  -7.08% |  1.226279 |  1.176090 |  -4.09% |
| blockedJoins    |         9 |         4 | -55.56% |        10 |         2 | -80.00% |

Baseline: preserved frozen T070 report `tmp/t069-r3/main-readability.json` (main eb72cb1, layout-identical after T070). Final evaluation: `result.json`; exact gate decisions: `comparison.json`. The amended +2% crossing/bend, +3% clearance, +1 owner-distance and +20% timing limits are used. Wire and median-area still require −4% on both splits. Readability targets are reported separately from the task’s requirement to improve the composite.

| Guard                            | Main | T069 |
| -------------------------------- | ---: | ---: |
| floatingPins                     |    6 |    6 |
| missingConnections               |   16 |   16 |
| VISUAL_LABEL_CLEARANCE           |  191 |  196 |
| VISUAL_LABEL_OVERLAP             |    5 |    5 |
| VISUAL_LABEL_OWNER_DISTANCE      |    2 |    3 |
| VISUAL_LABEL_RUN_ON              |   40 |   37 |
| VISUAL_TERMINAL_DEPARTURE        |   49 |   42 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE |    1 |    1 |
| VISUAL_WIRE_THROUGH_SYMBOL       |   17 |    8 |

All omitted visual totals are zero. All 628 drawings completed, with zero non-equivalent results; completion and equivalence are recorded in `comparison.json`. Per-drawing visual rises are retained there rather than hidden by aggregate improvements.

### Determinism and held-out timing

All 13 verification fixtures were replayed. The six >40-instance documents are compared byte-for-byte with `/tmp/t069-main/dist` (main eb72cb1). Timing ran separately from this task’s builds, suites and evaluation; every fixture above +10% initially received five alternating main/task pairs. Decisions use the median paired ratio when present.

| Fixture          | Main ms | T069 ms | First ratio | Five-pair median | Gate |
| ---------------- | ------: | ------: | ----------: | ---------------: | ---- |
| fd-two-stage     |  3867.2 |  3359.0 |      0.869× |                — | pass |
| common-source-ac |  1023.6 |   827.1 |      0.808× |                — | pass |
| skew             |  1779.2 |  1675.1 |      0.942× |                — | pass |
| deadtime         | 14899.9 | 17275.0 |      1.159× |           1.183× | pass |
| ota-sky130       |   744.8 |   719.6 |      0.966× |                — | pass |
| widlar           |  3369.6 |  3844.1 |      1.141× |           1.191× | pass |
| ltc3452          | 16535.0 | 14720.1 |      0.890× |                — | pass |

Large-plan results: 38m8wdesbh.json (50: identical), 4fb59zv76m.json (50: identical), 8b2n3zf9vj.json (51: identical), b9afqhsjzv.json (103: identical), g47e465db5.json (70: identical), sm663cbs8b.json (94: identical).

Determinism: all 13 byte-identical on repeat.

### Phase timing

Final phase medians over the five pairs where required, otherwise the first pass. Phases overlap and must not be summed.

| Fixture      | Main relocation ms | T069 relocation ms | Main finishing ms | T069 finishing ms | T069 label repair ms |
| ------------ | -----------------: | -----------------: | ----------------: | ----------------: | -------------------: |
| fd-two-stage |                3.9 |                4.0 |            1011.3 |             929.8 |                241.3 |
| deadtime     |             2283.8 |             3726.5 |            3559.1 |            4833.0 |                625.7 |
| ota-sky130   |                2.1 |                2.0 |              92.4 |              85.7 |                100.5 |
| widlar       |              522.2 |              932.8 |             493.7 |             463.9 |                153.3 |

### Rendered review

[25-sample review page](../../tmp/t069-r3/review.html): human | main | T069, using the same sample ids as T068. `review-full.png` and two named-case screenshots accompany the page. Both named screenshots were visually inspected.

## Investigation results

The broad initial runtime heuristic (reject every worse alignment estimate) was discarded: its dev result had 1790 bends, 8 floating pins and 12 missing connections. The seat-only ablation passes dev quality: 270 crossings, 1754 bends, wire 409332.68, median area ratio 1.189227, blocked joins 4, floating 6, missing 11; readability 122.2056. A 20% wire-growth bound passed corpus quality but still failed Widlar timing at a 1.254× five-pair median (`bound20/`). A crossing-based shortcut was also discarded after it added four dev clearance findings across three drawings. The selected 5% wire-growth bound alone restored those counts and measured 1.194× in its isolated five-pair Widlar development probe; it was evaluated on dev before the final validation run. No validation-driven parameter change was made. Evidence: `dev.json`, `dev-seat-only.json`, `dev-bound.json`, `dev-final-bound.json`, `dev-selected.json`, `relocation-estimate.log`, `probe-before.log`, `probe-after.log`.

The final validation crossing total is 157 against main’s 153 (+2.61%, over the +2% gate). Relative to the earlier 20% bound, `d8nv5m7cje` changes from 2 to 3 crossings; see `validation-crossing-changes.json`. No validation-driven retuning was performed; this gate remains for Opus review.

The original `gbvzf4h3fj` failed-connection and `yje2n6eva2` refusal investigations remain covered by the unchanged geometric fallback; final per-case outcomes are in `result.json`.

### Assertion and fixture rewrites

Round 3 changes only the two authorized existing R151 tests described above; no existing behavioral test was removed. New regressions exercise blocked-seat preflight and avoidance of a longer aligned-join routing trial. Both were run against original implementations before the fixes. The earlier focused suite passed 5 files and 59 tests; the final full local suite covers those same contracts.

### Inherited round 1/2 geometry rewrites

Every changed existing assertion is listed here; no test was removed or weakened.

- `corpus.test.ts`: unstacked member pitch 100→document member pitch; tail row
  offset +120→document row pitch; C10 feedback offset −120→document row pitch.
  The stacked-group minimum remains its existing 100-unit assertion because
  the R89 visible-geometry clearance still requires that span in these cases.
- `coupled.test.ts`: two winding dot-pin separation and the three winding
  indexed separation now use the document member pitch (two assertions).
- `layered.test.ts`: centred mirror-member separation 100→document member pitch.
- `recognition-cascode.test.ts`: t1-to-pair row offset uses document row pitch.
- `recognition-placement.test.ts`: signed tail-to-pair offset, PMOS mirror-tail
  offset, and shared PMOS tail offset use document row pitch (three assertions).
- `symmetry.test.ts`: unfolded a/b offsets 480→four document row pitches and
  c/d offsets 240→two document row pitches (four assertions).

Round 2 fixtures: the fixed-collision case blocks tight/legacy columns at x=120/160; R97 adds a resistor branch at n0 to leave an empty column; R63 moves its fixed input from x=-180 to x=-140 and updates the matching pose assertion. R44 updates the final-four-call sequence after tight placement removes one empty-column trial; its single replay/comparison and minimum-score assertions remain unchanged.

## Deviations and open questions

- Remaining failed gates: val:crossings.
- No plan, review, dependency, lockfile, evaluator or other-package edits; no commits, pushes, branch switches or LLM-provider calls.
