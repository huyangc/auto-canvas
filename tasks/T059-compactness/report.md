# T059 report — round 2

## Summary

Addressed the compaction tradeoff in R149: `compactionRegresses` rejects increases in crossings or bends for every new gap-closing trial and any R146/R147/R148 choice that needs the span term to beat the incumbent. Existing T058 wire-driven choices keep their primary-metric behavior. Refit crossing, bend, wire and visible-span coefficients on dev; the selected weights are 1000, 100, 4 and 0.5. A 120-unit span reduction is worth 60, below the cost of one bend. The original R147 pin-alignment pass keeps first use of its ten-trial budget; the gap pass uses only the remainder after port and rail optimization, so its guards compare against the completed incumbent.

The round is **done**. All amended acceptance checks pass.

## Steps

| Step                | Status | Notes                                                                                                               |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| 1 — score           | done   | Dev refit and isolated span-term experiment; visible bounds include ports, markers, routes, labels and drafting.    |
| 2 — moves           | done   | Retained round 1 horizontal/vertical gap candidates; primary guards prevent compaction-driven crossing/bend trades. |
| 3 — budget          | done   | Complete-placement evaluation counts, including nested finishing, compared pairwise to T058.                        |
| 4 — tests           | done   | 634 tests in 41 files; ten compactness tests. Existing tests and timeouts unchanged.                                |
| 5 — spec and corpus | done   | R146/R149 spec updated; all 628 drawings evaluated and repeated; dev and val reported separately.                   |

## Review findings addressed

1. **Must-fix 1 — compaction trades primary metrics:** added `compactionRegresses` at the three calibrated search acceptance points. If a non-gap trial already strictly improves T058’s wire-weighted score, the new primary guard does not veto it; the calibrated score and existing guards must still pass. Otherwise both audited primary metrics must not increase. Every gap move checks both, even when it improves the wire score. Refit procedure and agreement are below. Two regression tests offer strictly better weighted-score gap closures with an extra crossing or bend and verify rejection; the bend case also verifies that the score itself rejects exchanging one bend for 120 units of span.
2. **Must-fix 2 — split acceptance:** dev and val crossings/bends are at or below T058 and median area is lower on both.
3. **Should-fix 3 — vertical margin:** investigated all 439 completed dev drawings against human layouts. Drafting objects explain most of the excess, followed by net/power labels. Detailed attribution is below.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing chunk-size warning.
pnpm typecheck → 0.
pnpm lint → 0; 2018 files, 0 errors, 3256 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0; 41 files, 634 tests passed in 72.79 s; existing timeouts unchanged.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 627/628 completed.
node tmp/t059/r2final-eval.mjs tmp/le10-input --jobs 12 → 0; instrumented full repeat.
node tmp/t059/large.mjs → 0; six large plans byte-identical.
node tmp/t059/modes.mjs → 0; optimized, zero-budget and successful partition samples byte-identical; no provider calls.
python3 tmp/t059-r2/verify.py → 0; all checks pass.
git diff --check → 0.
```

Logs and analysis are under `tmp/t059-r2/`: `build-final.log`, `typecheck-final.log`, `lint-final.log`, `format-final.log`, `vitest-final.log`, `eval.log`, `repeat.log`, `large.log`, `modes.log`, `verification.log`, `calibration.json` and `margins.json`. The ordinary evaluator report is `tmp/auto-layout-eval/report.json`; the repeat is `tmp/t059/r2final-eval/report.json`. All local runtime copies and third-party data remain ignored.

The first full test run overlapped three corpus experiments and failed six existing timeouts (627 passed). All six failures explicitly reported timeout errors; there were no assertion failures. An isolated rerun passed all 633 tests. After narrowing the guard scope and deferring the gap pass as described below, the full suite was rerun again; the final run above is the acceptance result. The early new bend-route test fixture initially used an intermediate endpoint instead of a route bend; correcting that fixture made both new primary-guard tests pass.

## Investigation results

### Dev refit

Repeated T058 default and fixed-human routing on dev only, following T055’s paired preference procedure. All 439 default hashes match the supplied T058 report; 310 pairs complete on both paths. Prefer the fully routed fixed-human placement in each pair. Features are the full legacy routed score plus corrections for crossing, bend and wire weights and the actual finished visible span (not instance span or SVG padding). Other R74 coefficients remain fixed and included in every comparison.

Searched crossings `{1000, 2000, 4000, 8000}`, bends `{100, 200, 400, 800, 1600}`, wire `{0.1, 0.25, 0.5, 1, 2, 4}` and span `{0.1, 0.25, 0.5, 1, 2, 4}`. Require `bendWeight > 120 * spanWeight`, leaving 576 combinations. Maximize strict pairwise agreement; ties prefer lower normalized crossing/bend coefficients, then smaller wire+span, then smaller wire. This constraint directly implements the review’s one-bend/120-span requirement; the hard primary guards independently reject such trades at any distance.

| Objective                                           | Human-preference agreement |
| --------------------------------------------------- | -------------------------: |
| R74 legacy                                          |           181/310 (58.39%) |
| T058: wire 4, span 0                                |           267/310 (86.13%) |
| Round 1: wire 4, span 4                             |           279/310 (90.00%) |
| Selected: crossing 1000, bend 100, wire 4, span 0.5 |           270/310 (87.10%) |

The constrained refit sacrifices some preference agreement to preserve the requested bend/span priority. Wire remains at the grid’s upper bound; this is a bounded dev fit, not a global optimum. No validation data selected weights or moves.

### Isolated span term and gap moves on dev

The corrected score-only variant enables the 0.5 span term and its compaction guard with no gap pass. With span disabled, any strictly improving candidate necessarily improves the T058 wire score, so the conditional guard cannot reject it; the measured T058 run is the zero-span/no-gap reference. The final dev variant adds gap moves after port and rail optimization. Validation was first evaluated only after these dev runs fixed the implementation.

| Dev variant                                | Crossings | Bends |        Wire | Median area ratio |
| ------------------------------------------ | --------: | ----: | ----------: | ----------------: |
| T058                                       |       320 |  2024 | 484,083.351 |          1.560784 |
| Compaction guard + span only               |       320 |  2022 | 483,383.351 |          1.557172 |
| Final: compaction guard + span + gap moves |       320 |  2005 | 479,571.351 |          1.557172 |

An earlier broad-guard experiment applied crossing/bend limits to every existing trial, even wire-driven ones. Its dev result regressed: crossings 328, bends 1911, wire 498,295.026, median area 1.574715, label clearance 147 and wire-through-symbol 20. The no-span/no-gap broad-guard control already regressed (325 crossings, 1927 bends, wire 500,930.026, median area 1.587765). This showed the problem was changing existing T058 choices, not just adding compactness. That variant was discarded; the final guard applies to compaction-driven choices as the amended plan specifies.

The conditional guard with the original early gap pass still gave dev crossings 323 (base 320), bends 2021, wire 480,914.351 and median area 1.556399. Tracing the crossing regressions showed locally legal closures removed opportunities for later port moves to reduce crossings. The gap pass is therefore deferred until after R146 and all R148 routing, using the same remaining R147 budget. This changes only scheduling of the new compaction moves; it does not rerun or replace the original searches. The final evaluation below measures that scheduling.

The span term alone changes 8/439 final dev plan hashes. Stage-output hashes differ after R147 on 6 drawings, after R146 on 8, and after R148 on 8. Later-stage differences include changes propagated from earlier stages; they are not independent acceptance-flip counts.

### Full-corpus quality

| Split / version    | Crossings (ratio) |  Bends (ratio) |         Wire (ratio) | Median area ratio | Median width ratio | Median height ratio |
| ------------------ | ----------------: | -------------: | -------------------: | ----------------: | -----------------: | ------------------: |
| dev / T058         |      320 (2.0779) | 2,024 (1.2618) | 484,083.351 (1.4722) |          1.560784 |           1.154891 |            1.343685 |
| dev / T059 round 2 |      320 (2.0779) | 2,005 (1.2500) | 479,571.351 (1.4584) |          1.557172 |           1.154567 |            1.341297 |
| val / T058         |      151 (1.8875) |   775 (1.0306) | 201,504.675 (1.4773) |          1.541663 |           1.180880 |            1.319360 |
| val / T059 round 2 |      151 (1.8875) |   765 (1.0173) | 199,023.675 (1.4591) |          1.521283 |           1.177401 |            1.309401 |
| all / T058         |      471 (2.0128) | 2,799 (1.1880) | 685,588.026 (1.4737) |          1.558327 |           1.168394 |            1.336406 |
| all / T059 round 2 |      471 (2.0128) | 2,770 (1.1757) | 678,595.026 (1.4586) |          1.554821 |           1.163265 |            1.329218 |

Rendered sum-width / sum-height ratios:

| Split | T058 width → T059 width | T058 height → T059 height |
| ----- | ----------------------: | ------------------------: |
| dev   |     1.220812 → 1.216547 |       1.313784 → 1.310659 |
| val   |     1.208671 → 1.201594 |       1.316811 → 1.314085 |
| all   |     1.217297 → 1.212218 |       1.314687 → 1.311682 |

### Connectivity and visual guards

Completed 627/628; non-equivalent 0. The existing R10 refusal remains `yje2n6eva2`. These are layout/connectivity checks; no simulation or LLM-provider run was performed.

| Guard                            | Dev: T058 → T059 | Val: T058 → T059 | All: T058 → T059 |
| -------------------------------- | ---------------: | ---------------: | ---------------: |
| floatingPins                     |            8 → 8 |            2 → 2 |          10 → 10 |
| missingConnections               |          12 → 12 |            6 → 6 |          18 → 18 |
| VISUAL_AMBIGUOUS_JUNCTION        |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_CONSTRAINT_VIOLATION      |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_LABEL_CLEARANCE           |        142 → 139 |          47 → 47 |        189 → 186 |
| VISUAL_LABEL_OVERLAP             |            5 → 5 |            0 → 0 |            5 → 5 |
| VISUAL_LABEL_OWNER_DISTANCE      |            3 → 3 |            2 → 2 |            5 → 5 |
| VISUAL_LABEL_RUN_ON              |          35 → 35 |            9 → 8 |          44 → 43 |
| VISUAL_OUTSIDE_PAGE              |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_ROUTE_OVERLAP             |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_SHORT_SEGMENT             |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_SYMBOL_OVERLAP            |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_TERMINAL_DEPARTURE        |          73 → 72 |          17 → 17 |          90 → 89 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_UNPLACED_INSTANCE         |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_UNRESOLVED_SYMBOL         |            0 → 0 |            0 → 0 |            0 → 0 |
| VISUAL_WIRE_THROUGH_SYMBOL       |          12 → 12 |            6 → 6 |          18 → 18 |

### Determinism, exclusions and budget

All 628 repeated plan hashes and all non-timing report fields match. All 439 frozen dev hashes match the full run. The round 1 instrumented T058 baseline reproduces all 628 supplied baseline hashes. Only timing fields and instrumentation-only counters/stage hashes are removed when comparing ordinary versus instrumented reports.

The six documents above 40 instances (50, 50, 51, 103, 70, 94) produce byte-identical plans against T058. Optimized and zero-budget samples, plus ten successful partition samples constructed from existing placements, also match. No LLM partitioner was invoked; R134 fallback still uses plain planning.

Budget counts every complete `planLayoutOnce` evaluation, including nested refinement and finishing, not wall time. Bounded single-Net local routing repair is not a complete placement evaluation. The production shared R147/R149 budget remains ten finished trials across both phases; a regression test verifies that exhausting the alignment budget leaves no gap trials. Paired counts include all 628 attempts.

| Measure                               | T058 | T059 |              Ratio / limit |
| ------------------------------------- | ---: | ---: | -------------------------: |
| Median complete placement evaluations | 43.0 | 48.0 | paired median 1.041869 ≤ 2 |
| p95 complete placement evaluations    |   91 |   91 |             1.000000 ≤ 1.5 |

### Vertical margin attribution (dev, T058 versus human)

Measured all 439 completed dev pairs. Margin is rendered SVG height (including integer rounding) minus the visible-instance bounding-box height. Dev totals are human 47,537.466 and auto 73,280.042 (1.5415×). The plan’s 67,116 / 102,572 figures refer to the full corpus; this investigation is dev-only as requested.

For each category, measure the top and bottom protrusions of visible annotation room/ink, drafting bounds and routing outside the instance envelope. Split overlapping vertical bands equally among categories that reach them, so the attributed contributions add rather than double-count. Port labels are annotations owned by port instances; net/power labels are classified by annotation kind. Device values are separate from reference labels. Constant SVG padding is 80 units per drawing. The remaining symbol/renderer/rounding difference is reported explicitly.

| Source                             | Human attributed margin | Auto attributed margin |      Change |
| ---------------------------------- | ----------------------: | ---------------------: | ----------: |
| device reference labels            |               1,862.541 |                853.524 |  -1,009.017 |
| device values                      |                  19.055 |                 60.115 |     +41.060 |
| net/power labels                   |               3,355.219 |              8,035.149 |  +4,679.930 |
| port labels                        |                 903.107 |                635.961 |    -267.146 |
| drafting                           |               2,067.848 |             24,091.053 | +22,023.205 |
| routing                            |               2,170.264 |              1,968.687 |    -201.577 |
| export padding                     |              35,120.000 |             35,120.000 |      +0.000 |
| symbol/renderer/rounding remainder |               2,039.432 |              2,515.553 |    +476.122 |

Drafting accounts for +22,023.205 of the +25,742.576 dev excess (85.55%); net/power labels add +4,679.930. Device reference labels and port-label contributions decrease. Raw, overlapping category protrusions are available in `margins.json`: drafting 2,595.842 → 27,107.812, net/power 4,764.680 → 11,649.270, reference labels 2,196.115 → 1,571.498, and port labels 994.569 → 1,058.068. There is no contribution from pins beyond the instance envelope.

The 213 dev drawings with drafting contain 764 text objects, 223 arrows, 64 rectangles, 37 construction lines and seven circles. Of 1,095 objects, 1,058 have free anchors, eight route anchors and 29 object anchors. These authored notes and diagram elements can dominate the rendered box even when the electrical instances compact. This is report-only: changing drafting placement is not part of this plan.

## Deviations and open questions

- The dated “Plan change after round 1” explicitly supersedes the older 1.40 area line in the Acceptance section. This report uses lower median area on both dev and val with non-increasing crossings/bends, and reports the reached value; it does not claim 1.40.
- No amended acceptance check remains failing.
- Hard primary guards apply to every new gap move and every span-driven calibrated acceptance; existing wire-driven trials are exempt from the new primary guard. Existing visual/connectivity guards and rigid-unit, lock, mode and size contracts remain in force.
- No commits, pushes, merges, rebases, branch switches, dependency/lockfile changes, or edits to `plan.md`/`review.md`. Their pre-existing changes remain untouched. Product changes are confined to owned source/test paths, the auto-layout spec and this report. Work remained on `task/T059-compactness` at HEAD `61ed1c7b26ca426b2a5be04a23229b8a09fa29a1`; the original plan/review checksums are unchanged.
