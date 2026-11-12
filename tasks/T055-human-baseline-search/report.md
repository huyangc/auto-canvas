# T055 report — round 2

## Summary

Completed the amended measurement-only scope. The evaluator prints and saves dev, val and all scoreboards, now including wire by Net kind, crossings by unordered kind pair, and port wire by device-pin host count. All round-1 product and spec changes were removed: `packages/auto-layout/**` and `docs/specs/auto-layout.md` match `origin/main` (`bdb5f365610f16d5673388467e1959c2350585f1`). All six acceptance commands pass.

All 628 Gallery plan hashes match bdb5f36, including the refused drawing. Separate calls to `planAutoLayout(document, resolver)` without options also match all 628 baseline hashes. All six large-document plans match the original compiled baseline. The repeated evaluator matches every plan hash and all non-timing report fields.

## Steps

| Amended step | Status | Notes |
| --- | --- | --- |
| 1 — scoreboard and breakdowns | done | `scripts/auto-layout-eval.mjs`; printed and persisted for dev, val and all. |
| 2 — remove product changes | done | Restored `auto-layout.ts`, `refine.ts` and the spec; removed `baseline-search.ts` and its six tests. Calibration retained below as historical evidence only. |
| 3 — identical default plans | done | 628/628 baseline hashes, independently verified with no-options calls; 6/6 large plans unchanged. |
| Evaluation | done | All required commands, bucket/aggregate checks, full repeat and compatibility checks passed. Original optimization/search/budget/spec steps are superseded by the round-2 amendment. |

## Review findings addressed

1. **Must-fix 1:** removed R146 guarded search, calibrated product weights and the spec changes. Product paths have no diff against `origin/main`, including no additional untracked source/test files. The removed six tests exercised the removed search; all 594 original tests pass with their timeouts unchanged.
2. **Must-fix 2:** added `netBreakdown` to each measured drawing and to each split's scoreboard, with `wireLengthByNetKind`, `crossingsByKindPair` and `portWireLengthByHostCount` for human and result.
3. **Note 3:** determinism compares plan hashes and every non-timing field. Raw JSON bytes differ only because timings are measured again; timing keys removed for comparison are `milliseconds`, `timing` and `planningMilliseconds` (including curve entries).

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing chunk-size warning.
pnpm typecheck → 0.
pnpm lint → 0; 2009 files, 0 errors, 3210 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0; 37 files, 594 tests passed; 31.87 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 627/628 completed; scoreboard printed and stored.
node tmp/t055-round2/check-breakdown.mjs → 0; focused breakdown checks passed.
python3 -I tmp/t055-round2/verify.py → 0; baseline, conservation and aggregate checks passed.
node tmp/t055-round2/default-plans.mjs → 0; 628/628 no-options Gallery plans and 6/6 large plans match.
Repeated full evaluator → 0; 627/628 completed.
python3 -I tmp/t055/compare-results.py tmp/t055-round2/default.json tmp/t055-round2/repeat.json → 0; all 628 hashes and non-timing fields equal.
git diff --check → 0.
git diff origin/main --stat → only scripts/auto-layout-eval.mjs and this task's plan.md (already present).
```

Logs and verification scripts are under `tmp/t055-round2/`: `build.log`, `typecheck.log`, `lint.log`, `format.log`, `vitest.log`, `eval.log`, `repeat.log`, `breakdown-check.log`, `default-plans.log`, `verification.json`, `default-plans.json` and `determinism.json`. The first default report is preserved as `default.json`; its scoreboard is also in `scoreboard.json`. The repeated report is `repeat.json` and `tmp/auto-layout-eval/report.json`. These local artifacts and Gallery data remain ignored. The report and review are untracked task files, so `git diff --stat` does not list them.

## Investigation results

### Measurement definitions

Primary sums and breakdowns cover the same completed human/result pairs: 439 dev, 188 val, 627 all. Guards cover all available human references (628) and all completed results (627); consequently human guard totals include the refused drawing. Planning median/p95 cover all measured attempts. The first default run was measured without concurrent build, test or probe workloads; subsequent repeat/compatibility timings are not used below.

Net kinds are disjoint: `classifyNets(...).rails` first, then Nets containing a `port`/`port-filled` terminal, then signal. All routes of a Net use its kind. Host count means distinct non-marker device pins in that Net, not devices, port markers or per-port copies. The explicit `noHost` bucket preserves wire conservation for port-only Nets. Rails that also contain ports stay in the rail bucket and are excluded from port-host totals. These definitions avoid double counting port Nets that have multiple port terminals; the review's preliminary host totals were not an additive partition of its port-kind total.

Wire length and crossings use the existing routing audit on route subsets. Crossings are distinct proper crossing points per unordered pair of Nets, combining all routes belonging to each Net. Endpoint touches and same-Net intersections are excluded. A point involving multiple Net pairs can contribute more than once to the breakdown even though the primary audit counts that location once. All six kind pairs and all wire/host buckets are emitted, including zeros.

The focused probe covers rail/port precedence, both port symbols, zero/one/multiple device pins (including two pins on one device), duplicate-route deduplication, same-Net exclusion, endpoint touches, route-order independence, empty documents and wire conservation. Full-corpus verification independently sums every bucket, primary metric, guard and timing percentile and checks every completed result against the original baseline.

### Base/default scoreboard

The product implementation is the baseline; the current default scoreboard therefore also records the base scoreboard.

| Split | Documents / completed / paired / non-equivalent | Crossings human / result (ratio) | Bends human / result (ratio) | Wire human / result (ratio) | Median area ratio |
| --- | --- | --- | --- | --- | --- |
| dev | 439 / 439 / 439 / 0 | 154 / 400 (2.5974) | 1604 / 2185 (1.3622) | 328,826.022 / 548,835.026 (1.6691) | 1.6615 |
| val | 189 / 188 / 188 / 0 | 80 / 180 (2.2500) | 752 / 813 (1.0811) | 136,398.056 / 223,754.675 (1.6405) | 1.6334 |
| all | 628 / 627 / 627 / 0 | 234 / 580 (2.4786) | 2356 / 2998 (1.2725) | 465,224.078 / 772,589.701 (1.6607) | 1.6584 |

Wire breakdown entries are human / result.

| Metric | Dev | Val | All |
| --- | --- | --- | --- |
| Rail wire | 70053 / 107885 | 27684 / 40192 | 97737 / 148077 |
| Port wire | 91,399.492 / 186,455.234 | 41,115.359 / 79065 | 132,514.851 / 265,520.234 |
| Signal wire | 167,373.531 / 254,494.792 | 67,598.696 / 104,497.675 | 234,972.227 / 358,992.468 |
| Port wire: no host | 1400 / 0 | 0 / 0 | 1400 / 0 |
| Port wire: one device pin | 13860 / 41970 | 6154 / 18560 | 20014 / 60530 |
| Port wire: more than one device pin | 76,139.492 / 144,485.234 | 34,961.359 / 60505 | 111,100.851 / 204,990.234 |

Crossing breakdown entries are human / result.

| Unordered kind pair | Dev | Val | All |
| --- | --- | --- | --- |
| rail-rail | 0 / 15 | 1 / 3 | 1 / 18 |
| port-rail | 1 / 22 | 5 / 14 | 6 / 36 |
| rail-signal | 7 / 73 | 4 / 30 | 11 / 103 |
| port-port | 22 / 42 | 10 / 22 | 32 / 64 |
| port-signal | 56 / 114 | 33 / 55 | 89 / 169 |
| signal-signal | 68 / 134 | 27 / 56 | 95 / 190 |

Port Nets account for 133,005.383 units of excess wire (43.3% of the total excess) and 142 of the 346 excess crossings. Rail–rail/rail–signal crossings add 109, and signal–signal crossings add 95. These reproduce the review’s gap attribution while keeping the host buckets additive.

Crossing-pair totals equal primary point totals on every paired drawing in this corpus; details are in `verification.json`. Wire-kind totals equal primary wire sums, and host buckets equal port-kind wire, within floating-point precision on every paired drawing and split.

Visual guard entries are human / result.

| Code | Dev | Val | All |
| --- | --- | --- | --- |
| VISUAL_AMBIGUOUS_JUNCTION | 5 / 0 | 1 / 0 | 6 / 0 |
| VISUAL_CONSTRAINT_VIOLATION | 0 / 0 | 0 / 0 | 0 / 0 |
| VISUAL_LABEL_CLEARANCE | 401 / 170 | 145 / 56 | 546 / 226 |
| VISUAL_LABEL_OVERLAP | 4 / 5 | 1 / 0 | 5 / 5 |
| VISUAL_LABEL_OWNER_DISTANCE | 15 / 5 | 12 / 2 | 27 / 7 |
| VISUAL_LABEL_RUN_ON | 11 / 39 | 6 / 13 | 17 / 52 |
| VISUAL_OUTSIDE_PAGE | 0 / 0 | 0 / 0 | 0 / 0 |
| VISUAL_ROUTE_OVERLAP | 27 / 0 | 17 / 0 | 44 / 0 |
| VISUAL_SHORT_SEGMENT | 6 / 0 | 8 / 0 | 14 / 0 |
| VISUAL_SYMBOL_OVERLAP | 67 / 0 | 32 / 0 | 99 / 0 |
| VISUAL_TERMINAL_DEPARTURE | 27 / 93 | 3 / 24 | 30 / 117 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE | 28 / 0 | 10 / 0 | 38 / 0 |
| VISUAL_UNPLACED_INSTANCE | 0 / 0 | 0 / 0 | 0 / 0 |
| VISUAL_UNRESOLVED_SYMBOL | 0 / 0 | 0 / 0 | 0 / 0 |
| VISUAL_WIRE_THROUGH_SYMBOL | 233 / 20 | 82 / 6 | 315 / 26 |

| Guard / time | Dev | Val | All |
| --- | --- | --- | --- |
| floatingPins | 66 / 8 | 21 / 2 | 87 / 10 |
| missingConnections | 63 / 12 | 35 / 6 | 98 / 18 |
| Planning median (ms) | 2,264.318 | 2,121.156 | 2,199.958 |
| Planning p95 (ms) | 7,224.279 | 6,728.629 | 7,060.201 |

Every primary metric and visual/connectivity guard equals the original default baseline. `yje2n6eva2` remains the same R10 refusal; no completed baseline drawing is lost. All 627 completed drawings remain electrically equivalent. These checks establish layout/connectivity preservation; no simulation was needed for this measurement-only change.

### Historical dev calibration (evidence only)

Round 1 joined 310 dev cases completed by both baseline default and `--fixed-human` routing. With preference for the fixed-human routed placement, the grid searched wire `{0.1, 0.25, 0.5, 1, 2, 4}` and instance-span `{0, 0.1, 0.25, 0.5, 1, 2, 4}` using the legacy score plus `(wire - 0.1) * wireLength + span * (instanceWidth + instanceHeight)`. It maximized strict preference agreement, breaking ties by smaller total weight and then smaller wire weight. All other legacy coefficients and guard terms stayed fixed; validation was not fitted.

Wire **4**, span **4** won with **289/310 (93.23%)**, versus **186/310 (60.00%)** for legacy wire 0.1 / span 0. Both winning weights are grid upper bounds, so this is bounded empirical evidence, not a global optimum. The evidence remains in `tmp/t055/calibration.json` and `tmp/t055/calibrate.py`. Neither calibrated weights nor round-1 search remain in product code; `ROUTED_SCORE_WEIGHTS` and default search are exactly bdb5f36.

## Deviations and open questions

- The round-2 amendment replaces the original 1.2× primary targets with measurement and byte-identical plan acceptance. The restored default still misses seven of eight original split targets; only val bends passes. No optimization success is claimed. Port/rail placement improvements are deferred to T056 onward as directed by the plan/review.
- Breakdown crossing counts intentionally represent unordered Net-pair events; primary crossings retain the audit's unique-point definition. The difference is documented above rather than silently changing either metric.
- Raw report byte equality is impossible with measured timing fields; plan hashes and all non-timing report fields match, as requested by review note 3.
- No commits, pushes, branch switches, dependency/lockfile changes, LLM-provider calls, or edits to `plan.md`/`review.md` were made. Their initial changes were left untouched. Product paths and the spec are restored exactly; retained changes are confined to the evaluator and this report.
