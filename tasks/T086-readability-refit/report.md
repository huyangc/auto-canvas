# T086 report — round 2

## Summary

Separated the frozen planner selection weights from the refitted evaluation weights. `readability-selection-weights.ts` is a byte-for-byte copy of main's T070 weights, including its provenance header; planner scoring, weighted-mode measurements, and finished-selection's metric participation use it. The evaluator explicitly supplies evaluation weights for per-case scores and scoreboards.

Revised `collinearAbutment` to count facing pin entries or two-way bends across at most one R154 member pitch, excluding open/straight junction ends, unmarked branch junctions, marker/port ends, labeled attachments (including offset text) and intervening symbol bodies. The flagged VDD/tail gap now counts. Fitted evaluation weights on the pooled 878 dev pairs from main and the historical T070 planner, using today's metrics throughout.

## Steps

| Step                  | Status | Notes                                                                                                                                  |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigate        | done   | All flagged metrics and the 55 human-heavy cases are documented below.                                                                 |
| 2. New metric         | done   | Facing-end classification and R154 threshold; both axes, boundaries, pin-entry example and exclusions tested.                          |
| 3. Refit              | done   | 439 dev pairs from each of two planners; unchanged non-negative logistic fitting method.                                               |
| 4. Validate score     | done   | Separate dev/val discrimination for each layout set, three flagged drawings, 20 rises/falls and ten render checks below.               |
| 5. Planner validation | done   | Review supersedes the original planner refit: preserve main selection exactly; corpus hashes, large documents, timing and tests below. |

## Review findings addressed

1. **Selection/evaluation split:** moved main's exact weights to the selection module; `readabilityScore` defaults to those weights and accepts explicit evaluation weights. `finished-selection.ts` also imports the selection module for its two direct weighted-feature checks. Reverted the round-1 fixed crossing coefficient assertion to `0.10852563607446113`. Full/weighted equivalence tests now use selection weights. No placement, routing or search policy was changed.
2. **Pooled fit:** archived `eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59` into `/tmp/t086-eb72cb1`, built its planner and workspace dependencies, and evaluated it through the new `--baseline-planner` option. Both reports use today's area unit and abutment definition. `--pool` keeps both pairs for each drawing, normalizes RMS differences over all dev pairs, and records each planner SHA, report hash and training-pair count in the generated header. A CLI test covers repeated IDs across sources, pooled RMS and validation-data exclusion.
3. **Abutment:** classified all 55 human-heavy drawings below; both the threshold and endpoint classification are revised. The reported metric counts the flagged 40-unit gap. Its fitted coefficient and paired differences are reported without manual tuning.
4. **New goal baseline:** main layouts under evaluation weights, including composite totals, ratios and all per-metric totals, appear below.
5. **Proposed spec text:** included under deviations/documentation below.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing editor bundle-size warning.
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2072 files, 0 errors, 3483 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0; 800 passed | 3 skipped files;
  8245 passed | 117 skipped tests (8362), 157.51 s.
pnpm test:slow → 0; 2 passed files, 8 passed tests, 58.43 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed, 628 equivalent; wrote report.json and index.html.
```

Evidence is retained under `tmp/t086-r2/`: `build-final.log`, `typecheck-final.log`, `lint-final.log`, `format-final.log`, `test-local-final.log`, `test-slow.log`, `final-eval.log`, `final-report.json`, `final-comparison.json`, `large.json`, `timing.json` and their scripts/logs. Focused metric/performance tests also pass **49/49**. The original local-suite attempt exposed one remaining direct evaluation-weight import in finished-selection; it was fixed and the full suite rerun successfully. A later label-attachment correction has dedicated free/object/route-label coverage and the final full-suite results above.

The final historical and main corpus remeasurements were repeated after the label-attachment correction. Their full human/result metric vectors equal the earlier runs; the fit's numeric coefficients are unchanged. Report checksums and the generated provenance were refreshed from those final reports. The final evaluator run uses that generated model.

Additional audit (not a plan acceptance command): `pnpm deadcode` → 1. Knip reports **3 unused files, 49 unused exports and 6 unused exported types**, all in untouched paths (including editor/server, simulation/schema helpers, `pin-portfolio.ts`, and `scripts/lib/verify-pr-selection.mjs`). No changed readability file/export is reported. Full output is in `deadcode.log`; these out-of-scope findings were left alone. Since the first Knip command failed, its production-mode second command did not run. `git diff --check` passes.

## Investigation results

### Provenance and reproduction

Main source: `17372217c5cd175d0e7cfe3c95ae11ac27187245`. Historical source: `eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59`. Both have 628 completed/equivalent layouts: 439 dev and 189 val. Training includes 878 dev pairs; validation pairs are never fitted. Method remains 2,000 iterations, L2 0.01, learning rate 0.1, non-negative projection and RMS paired-difference normalization over the pooled dev set.

```bash
mkdir -p /tmp/t086-eb72cb1
git archive eb72cb1 | tar -x -C /tmp/t086-eb72cb1
pnpm install --offline --frozen-lockfile --dir /tmp/t086-eb72cb1
# Offline installation failed: ERR_PNPM_NO_OFFLINE_TARBALL for jsdom 26.1.0.
# Reused existing third-party package links, with @icm links pointing inside
# the archive; built all historical auto-layout workspace dependencies.
python3 tmp/t086-r2/link-historical-deps.py
pnpm_config_verify_deps_before_run=false pnpm --dir /tmp/t086-eb72cb1 --filter @icm/auto-layout... build
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-eb72cb1/packages/auto-layout/dist/index.js
# Preserve output as tmp/t086-r2/historical-report.json.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
# Preserve output as tmp/t086-r2/main-report.json.
node scripts/readability-fit.mjs tmp/t086-r2/main-report.json --source-commit 17372217c5cd175d0e7cfe3c95ae11ac27187245 --pool tmp/t086-r2/historical-report.json --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59 --write
```

No lockfile difference exists between these two source commits. The successful historical build uses archived source for all workspace dependencies and already-installed third-party packages; no repository dependency files were changed. The failed offline install and initial missing MathJax link build are retained in the local evidence. No network/provider/LLM calls were made.

### Evaluation weights and pooled differences

Positive/negative/tied counts use result minus human on the **878 pooled dev pairs**. Coefficients shown are rounded for reading; the generated module preserves full precision.

| Metric                |     Weight | RMS scale | Positive | Negative | Tied | Sum of differences |
| --------------------- | ---------: | --------: | -------: | -------: | ---: | -----------------: |
| area                  |    0.30893 |   442.108 |      654 |      224 |    0 |             127615 |
| avoidableJogs         |   0.045338 |  0.254795 |       18 |        4 |  856 |                 15 |
| backwardFlow          |          0 |   1.34571 |      103 |      130 |  645 |               -124 |
| bends                 |  0.0305449 |   4.16256 |      392 |      315 |  171 |                445 |
| blockedJoins          |  0.0112077 |  0.175362 |       13 |        8 |  857 |                  3 |
| collinearAbutment     | 0.00837475 |   1.13397 |      194 |      168 |  516 |                 29 |
| controlSeparation     |          0 |  0.280335 |       25 |       14 |  839 |                 13 |
| crossings             |  0.0930833 |   1.14147 |      190 |       70 |  618 |                200 |
| detour                |          0 |   1.36023 |      322 |      460 |   96 |            -187.87 |
| labelClearance        |          0 |   2.23709 |       87 |      329 |  462 |               -474 |
| labelOverlaps         |   0.043632 |  0.196785 |        4 |        6 |  868 |                  0 |
| labelOwnerDistance    |          0 |  0.418806 |        0 |        6 |  872 |                -30 |
| narrowBands           |          0 |   2.63993 |      264 |      444 |  170 |               -593 |
| portOrder             |  0.0315941 |  0.985082 |       93 |       71 |  714 |                 70 |
| potentialOrder        |          0 |  0.335792 |       25 |       19 |  834 |                 -1 |
| railCrossings         |  0.0657753 |  0.429547 |       64 |       11 |  803 |                 68 |
| railMarkerOrder       |          0 |  0.438729 |       22 |       52 |  804 |                -35 |
| signalSeriesVertical  |          0 |   0.61214 |       29 |       43 |  806 |                -55 |
| sourcePolarity        |  0.0240465 |  0.143182 |        9 |        6 |  863 |                  4 |
| structureIntrusion    |          0 |  0.143182 |        0 |       18 |  860 |                -18 |
| symmetryLevel         |          0 |  0.340842 |        0 |       16 |  862 |                -34 |
| symmetryMirror        |          0 |  0.429547 |        4 |       20 |  854 |                -24 |
| symmetryOrientation   |          0 |  0.618618 |        0 |       90 |  788 |               -148 |
| terminalDepartures    | 0.00433936 |  0.456539 |       46 |       35 |  797 |                 11 |
| transistorOrientation |          0 |  0.814868 |       54 |       79 |  745 |                -81 |
| unownedDrafting       |   0.333134 |   1.28599 |       54 |        1 |  823 |                206 |
| wireThroughSymbols    |          0 |    1.3291 |        6 |      247 |  625 |               -449 |

Pooling restores positive evaluation weights for `avoidableJogs`, `blockedJoins`, `portOrder`, `sourcePolarity` and `terminalDepartures`, all zeroed by the round-1 current-only fit. `collinearAbutment` also becomes positive (194 worse, 168 better, 516 tied pooled dev pairs; sum +29). In main alone it has 107 positive / 80 negative / 252 tied dev differences (sum +39); historical alone has 87 / 88 / 264 (sum −10).

`controlSeparation` still fits to zero despite 25 positive versus 14 negative pairs (sum +13). Its final unnormalized logistic-loss gradient is **+0.00860448**, so increasing it would increase the fitted objective after accounting for the retained features; the non-negative step projects it to zero. This residual blind spot is reported, not replaced by a manual floor. For the flagged defects, backward flow (sum −124), detour (−187.870), symmetry mirroring (−24), symmetry level/orientation and potential order also stay zero. Their final gradients at zero are positive; see `gradients.json`, reproduced with the identical 2,000-step algorithm and checked against every generated coefficient. Bends remain positive and capture part of the flagged routing degradation. Positive aggregate differences alone do not guarantee a positive coefficient in a joint fit.

### Discrimination and new goal baseline

Discrimination is the fraction with human score strictly lower (tolerance 1e-10); ties remain in the denominator. Old/new weights are applied to the same metrics in each layout set.

| Layout set | Split | Pairs | Old discrimination | New discrimination | Old ratio | New ratio | New human total | New result total |
| ---------- | ----- | ----: | -----------------: | -----------------: | --------: | --------: | --------------: | ---------------: |
| main       | dev   |   439 |           64.0091% |           68.5649% |  1.194580 |  1.191063 |      210.201503 |       250.363195 |
| main       | val   |   189 |           60.3175% |           68.2540% |  1.149846 |  1.205184 |       90.785877 |       109.413677 |
| historical | dev   |   439 |           82.4601% |           85.1936% |  2.781251 |  1.658697 |      210.201503 |       348.660590 |
| historical | val   |   189 |           79.8942% |           82.5397% |  2.080018 |  1.581717 |       90.785877 |       143.597579 |

The **main** rows above define the new goal baseline. The layouts are unchanged; only evaluation changes.

### Three flagged drawings

| Drawing    |  Old human / result |  New human / result | New result/human |
| ---------- | ------------------: | ------------------: | ---------------: |
| bv9zwmd835 | 0.230652 / 0.117659 | 0.393779 / 0.479966 |         1.218870 |
| wvwmyesa4g | 0.006393 / 0.011561 | 0.259755 / 0.510664 |         1.965947 |
| 6r2q6deeq9 | 0.019101 / 0.527610 | 0.747047 / 1.240847 |         1.661002 |

For completeness, the same drawings in the historical layout set score as follows. The acceptance gate concerns the main layouts above.

| Drawing    | Old human / historical | New human / historical |
| ---------- | ---------------------: | ---------------------: |
| 6r2q6deeq9 |    0.019101 / 0.532528 |    0.747047 / 1.379644 |
| bv9zwmd835 |    0.230652 / 0.123233 |    0.393779 / 0.494603 |
| wvwmyesa4g |    0.006393 / 0.012912 |    0.259755 / 0.560922 |

Every metric below is human → main result, whether weighted or diagnostic.

| Metric                |        wvwmyesa4g |         6r2q6deeq9 |        bv9zwmd835 |
| --------------------- | ----------------: | -----------------: | ----------------: |
| area                  | 340.229 → 615.293 |  1016.59 → 996.364 | 440.233 → 486.097 |
| avoidableJogs         |             0 → 0 |              0 → 0 |             0 → 0 |
| backwardFlow          |             0 → 0 |              0 → 0 |             3 → 0 |
| bends                 |            3 → 11 |             5 → 18 |             3 → 7 |
| blockedJoins          |             0 → 0 |              0 → 0 |             0 → 0 |
| collinearAbutment     |             0 → 0 |              0 → 2 |             0 → 1 |
| controlSeparation     |             0 → 0 |              0 → 0 |             0 → 0 |
| crossings             |             0 → 0 |              0 → 3 |             0 → 1 |
| detour                |  0.1875 → 1.21892 | 1.05072 → 0.846561 |    0.4 → 0.595238 |
| labelClearance        |             1 → 1 |              1 → 0 |             0 → 0 |
| labelOverlaps         |             0 → 0 |              0 → 0 |             0 → 0 |
| labelOwnerDistance    |             0 → 0 |              0 → 0 |             0 → 0 |
| narrowBands           |             3 → 2 |              0 → 3 |             4 → 4 |
| portOrder             |             0 → 0 |              0 → 0 |             2 → 0 |
| potentialOrder        |             0 → 0 |              0 → 0 |             0 → 2 |
| railCrossings         |             0 → 0 |              0 → 1 |             0 → 0 |
| railMarkerOrder       |             0 → 0 |              0 → 0 |             0 → 0 |
| signalSeriesVertical  |             0 → 0 |              1 → 0 |             0 → 0 |
| sourcePolarity        |             0 → 0 |              0 → 0 |             0 → 0 |
| structureIntrusion    |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryLevel         |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryMirror        |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryOrientation   |             0 → 0 |              0 → 0 |             0 → 0 |
| terminalDepartures    |             0 → 0 |              0 → 0 |             0 → 0 |
| transistorOrientation |             0 → 0 |              0 → 0 |             0 → 0 |
| unownedDrafting       |             0 → 0 |              0 → 0 |             0 → 0 |
| wireThroughSymbols    |             0 → 0 |              2 → 0 |             0 → 0 |

- `wvwmyesa4g`: bends and detour see the feedback loop's extra routing. Backward-flow and port-order opportunities are zero on both sides, so those metrics cannot detect the reversed flow here.
- `6r2q6deeq9`: bends, crossings and rail crossings see the torn-apart bridge's routing cost. Detour decreases; no metric explicitly models the bridge arrangement.
- `bv9zwmd835`: potential order, bends, crossings and detour see parts of the tail displacement. Symmetry opportunities are zero on both sides, so the missing mirrored pair remains a recognition gap. The revised abutment metric is 0 → 1. The facing entries are `R2.1` on `net-power-vdd1` and `R3.1` on `net-move-27`, 40 units apart with grid 10; these identities/coordinates are investigation evidence only.
- Both `VISUAL_ROUTE_OVERLAP` and `VISUAL_AMBIGUOUS_JUNCTION` remain zero on that result. Overlap compares same-Net routes; ambiguous junction requires a junction on an unrelated route. Neither detects an empty different-Net gap. The two recognition gaps are explicitly deferred by the review.

### Main per-metric totals under today's measurement

All entries are human / result violations. Zero-weight diagnostics are retained.

| Metric                | Dev human / result | Val human / result |
| --------------------- | -----------------: | -----------------: |
| area                  |    243866 / 286868 |    100943 / 121269 |
| avoidableJogs         |              4 / 1 |              1 / 1 |
| backwardFlow          |          407 / 344 |          221 / 223 |
| bends                 |        1604 / 1902 |          755 / 808 |
| blockedJoins          |              5 / 4 |              0 / 0 |
| collinearAbutment     |          459 / 498 |          208 / 199 |
| controlSeparation     |            25 / 26 |              4 / 2 |
| crossings             |          154 / 229 |           80 / 138 |
| detour                |  262.258 / 186.541 |  95.6347 / 68.7613 |
| labelClearance        |          401 / 193 |           145 / 77 |
| labelOverlaps         |              4 / 3 |              1 / 0 |
| labelOwnerDistance    |             15 / 0 |             12 / 2 |
| narrowBands           |        1446 / 1281 |          661 / 554 |
| portOrder             |          118 / 108 |            74 / 49 |
| potentialOrder        |            24 / 24 |            10 / 13 |
| railCrossings         |             8 / 18 |            10 / 14 |
| railMarkerOrder       |            37 / 16 |             15 / 4 |
| signalSeriesVertical  |            56 / 29 |            16 / 14 |
| sourcePolarity        |              6 / 2 |              3 / 0 |
| structureIntrusion    |              9 / 0 |             10 / 0 |
| symmetryLevel         |             17 / 0 |              3 / 0 |
| symmetryMirror        |             21 / 8 |            19 / 12 |
| symmetryOrientation   |             74 / 0 |             39 / 0 |
| terminalDepartures    |            27 / 26 |              3 / 6 |
| transistorOrientation |            88 / 50 |            28 / 15 |
| unownedDrafting       |            15 / 22 |              7 / 8 |
| wireThroughSymbols    |            233 / 4 |             82 / 0 |

### Classification of the 55 human-heavy drawings

Round 1's human-heavy dev subset contains 72 counted segment pairs: **28 bend/branch, 9 branch/branch, 23 bend/bend, 9 open-or-straight-junction/open-or-straight-junction, and 3 bend/open-or-straight-junction**. Thus 49 of the original pairs lack the newly required facing pin/bend ends. A branch has three or more incident directions; a two-way bend has exactly two perpendicular directions; an open/straight junction has no qualifying turn. Junctions are classified from all incident same-Net segments, not just their stored route endpoint tag.

The narrower end classification removes all abutments in 28 of these drawings. Increasing reach from 20 to the 80-unit small-document member pitch also exposes other qualifying pairs: the subset's total changes from 72 to 78, so this is not a promise that every human count falls. The full-corpus paired distributions above determine the coefficient.

Each row identifies every originally counted pair, in facing-end order, with the pattern. Abbreviations: B = two-way bend; T = branch; O = open/straight junction. Counts are old-human / old-result → revised-human. Full segment addresses and geometry are in `tmp/t086-r2/human-classification.json`.

| Drawing                              | Counts    | Net pairs and facing-end pattern                                                                                                                                                                             |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2bgg3pxz64                           | 1 / 0 → 0 | `net-ui-5` / `net-ui-11` (T/B)                                                                                                                                                                               |
| 2sqrha67j7                           | 1 / 0 → 0 | `net-contact-x1-copy-1-copy-1` / `net-power-gnd1-copy-1-copy-1` (T/B)                                                                                                                                        |
| 4mrnbmegkb                           | 1 / 0 → 0 | `net-ui-273` / `net-power-gnd2` (T/B)                                                                                                                                                                        |
| 4wce8zcf6c                           | 1 / 0 → 0 | `net-power-gnd1-copy-1-copy-1` / `net-power-gnd2-copy-1-copy-1` (T/B)                                                                                                                                        |
| 5yj2bfc5gy                           | 2 / 0 → 0 | `net-ui-2` / `net-ui-1` (T/T); `net-ui-3` / `net-ui-3-copy-1` (T/T)                                                                                                                                          |
| 6xrx9wwkh9                           | 1 / 0 → 5 | `wire-df181a4e-3e40-40cf-82ee-362df50eeadb-net` / `wire-b8183c13-52a7-4f58-bc60-11ed75a58c98-net` (B/B)                                                                                                      |
| 7ary9f5v85                           | 1 / 0 → 0 | `net-contact-c3-2-copy-1-copy-1` / `net-power-gnd2-copy-1-copy-1` (T/B)                                                                                                                                      |
| 7h6eqbghwc                           | 1 / 0 → 0 | `net-contact-x1-copy-1-copy-1-copy-1-copy-1-copy-1` / `net-split-f1a8f31b06eeae9c` (T/B)                                                                                                                     |
| 7qezt94gkg                           | 1 / 0 → 0 | `net-contact-c3-2` / `net-power-gnd2` (T/B)                                                                                                                                                                  |
| 8vm5s26vq3                           | 1 / 0 → 1 | `net-ui-1` / `net-ui-2` (B/B)                                                                                                                                                                                |
| 8ws52x9256                           | 2 / 0 → 0 | `net-ui-33` / `net-ui-9` (O/B); `net-ui-36` / `net-ui-53` (O/B)                                                                                                                                              |
| ah64ejacsg                           | 2 / 0 → 0 | `net-ui-112` / `net-ui-130` (O/O); `net-ui-130` / `net-ui-112` (O/O)                                                                                                                                         |
| aqfb9kjcfj                           | 1 / 0 → 5 | `wire-691e65d8-b5d3-4313-9a2f-6fb7d950ecb7-net` / `net-cell-pin-9eabb3c052212793` (B/B)                                                                                                                      |
| avqe2g6qrf                           | 1 / 0 → 1 | `net-cell-pin-p2` / `net-split-e65e329901609215` (T/B)                                                                                                                                                       |
| b5a651f0-5275-421e-acf5-2a63dfd8c9d8 | 2 / 0 → 0 | `net-ui-4` / `net-route-ui-7` (O/O); `net-route-ui-7` / `net-ui-4` (O/O)                                                                                                                                     |
| d2bpftaqyq                           | 1 / 0 → 3 | `net-ui-27` / `net-ui-38` (B/B)                                                                                                                                                                              |
| d6egcq7hxy                           | 1 / 0 → 0 | `net-contact-x1-copy-1` / `net-power-gnd1-copy-1` (T/B)                                                                                                                                                      |
| dc4m5429tm                           | 1 / 0 → 8 | `net-09c8499c4e15e7b7` / `net-ui-11` (T/B)                                                                                                                                                                   |
| dmwa7gqwqr                           | 1 / 0 → 4 | `net-ui-33` / `net-split-e0d3b9972408660d` (O/O)                                                                                                                                                             |
| dz689bvy2n                           | 1 / 0 → 1 | `wire-8d26bb83-57e9-4744-9c22-ff6a340775bb-net` / `wire-e6bdf46a-5225-4251-bff7-69076a7ff068-net` (B/B)                                                                                                      |
| e5t32hnn2g                           | 2 / 0 → 1 | `net-ui-74` / `net-power-gnd2` (B/B); `net-power-gnd1-copy-1` / `net-power-gnd2-copy-1` (T/B)                                                                                                                |
| ecyqst76jd                           | 1 / 0 → 5 | `net-ui-309-copy-1` / `net-ui-314-copy-1` (B/B)                                                                                                                                                              |
| ekyrd7cwpc                           | 1 / 0 → 0 | `net-ui-136` / `net-power-gnd1` (T/B)                                                                                                                                                                        |
| fbnrez8q5g                           | 1 / 0 → 0 | `net-contact-c1` / `net-power-gnd1` (T/B)                                                                                                                                                                    |
| fp92gscg3m                           | 2 / 0 → 0 | `net-ui-2_2` / `net-0dca5fdca05ee3dc` (T/T); `net-80f5394fd74a470a` / `net-ui-2_3` (T/T)                                                                                                                     |
| gbvzf4h3fj                           | 1 / 0 → 1 | `net-ui-166` / `net-split-2e84fcf31d6db320` (B/B)                                                                                                                                                            |
| hn8ma6xaxq                           | 1 / 0 → 0 | `net-ui-88` / `net-power-gnd2` (T/B)                                                                                                                                                                         |
| hr85s6jbqz                           | 2 / 0 → 0 | `net-ui-85` / `net-power-gnd2` (T/B); `net-8c6062646861cbea` / `net-power-gnd2-copy-1` (T/B)                                                                                                                 |
| j462r7dnbk                           | 1 / 0 → 0 | `net-split-7f23e2445316cfd4` / `net-split-1d6130c30e2f64f0` (T/B)                                                                                                                                            |
| j67zaehvjp                           | 2 / 0 → 1 | `net-ui-1` / `net-ui-4` (T/T); `net-2c81c40d48c9a8a5` / `net-750500a00cb420fb` (B/B)                                                                                                                         |
| jkbdeaz3fr                           | 2 / 0 → 0 | `net-ui-25_2` / `net-ui-46_2` (O/O); `net-contact-r2-2_2` / `net-contact-r2-2_3` (O/O)                                                                                                                       |
| jv9yfs5gnx                           | 1 / 0 → 0 | `net-contact-c1` / `net-power-gnd1` (T/B)                                                                                                                                                                    |
| kggd45xdt5                           | 1 / 0 → 1 | `net-ui-203` / `net-split-89c8217d358049be` (B/B)                                                                                                                                                            |
| kjs4xgzkba                           | 2 / 0 → 2 | `net-47d9affb30fc01ea` / `net-3c2b789bdd459b33` (O/B); `net-47d9affb30fc01ea` / `net-3c2b789bdd459b33` (B/B)                                                                                                 |
| n756yysrkx                           | 1 / 0 → 0 | `net-contact-c1-copy-1` / `net-power-gnd1-copy-1` (T/B)                                                                                                                                                      |
| ne46whs3fw                           | 1 / 0 → 0 | `net-424289e67dc021d5` / `net-power-gnd1` (T/B)                                                                                                                                                              |
| nqmdjx54je                           | 1 / 0 → 5 | `wire-691e65d8-b5d3-4313-9a2f-6fb7d950ecb7-net` / `net-cell-pin-9eabb3c052212793` (B/B)                                                                                                                      |
| nwarxxcwp7                           | 1 / 0 → 1 | `net-ui-4` / `net-ui-5` (B/B)                                                                                                                                                                                |
| p8efzmbdd6                           | 1 / 0 → 0 | `net-ui-2` / `net-ui-6` (T/B)                                                                                                                                                                                |
| q7zt3ydkyh                           | 1 / 0 → 0 | `net-contact-x5` / `net-power-gnd2` (T/B)                                                                                                                                                                    |
| qj62dz4qvm                           | 6 / 0 → 1 | `net-ui-11` / `net-ui-14` (T/T); `net-ui-11` / `net-ui-14` (T/T); `net-ui-185` / `net-ui-191` (T/T); `net-ui-185` / `net-ui-191` (T/T); `net-ui-386` / `net-ui-342` (B/T); `net-ui-349` / `net-ui-368` (B/T) |
| ray97q5c2j                           | 1 / 0 → 4 | `net-edb33fb71c103e02` / `net-c97a5d57375279c9` (B/B)                                                                                                                                                        |
| rryf923yjz                           | 1 / 0 → 5 | `net-ui-9` / `net-ui-10` (B/B)                                                                                                                                                                               |
| s75dft4ssy                           | 1 / 0 → 0 | `net-60a6dfe3677cdba9` / `net-power-gnd1_2` (T/B)                                                                                                                                                            |
| t4j5wwx5x4                           | 1 / 0 → 3 | `net-ui-1` / `net-ui-5` (B/B)                                                                                                                                                                                |
| tsvpdfd75s                           | 1 / 0 → 0 | `net-contact-x1-copy-1-copy-1-copy-1-copy-1` / `net-power-gnd1` (T/B)                                                                                                                                        |
| vfs7xjtcn3                           | 2 / 0 → 2 | `net-2da57ba94320a396` / `net-750500a00cb420fb` (B/B); `net-2da57ba94320a396` / `net-750500a00cb420fb` (B/B)                                                                                                 |
| vhg3q4gax7                           | 1 / 0 → 3 | `net-ui-13` / `net-ui-4` (B/B)                                                                                                                                                                               |
| vrenfp5n3w                           | 1 / 0 → 3 | `net-cell-pin-p2` / `net-ui-8` (B/B)                                                                                                                                                                         |
| w7bdvc28hc                           | 1 / 0 → 0 | `net-ui-1` / `net-ui-3` (T/B)                                                                                                                                                                                |
| wsgc5ae43p                           | 1 / 0 → 1 | `import-e7e4992f8f28d9b8` / `import-e7e49c2f8f28ded1` (B/B)                                                                                                                                                  |
| x7wr36szy7                           | 2 / 0 → 4 | `net-cell-pin-p3-2` / `net-bb51d547b35dfafd` (O/O); `net-cell-pin-p3-2` / `net-bb51d547b35dfafd` (O/O)                                                                                                       |
| xnjc69vr35                           | 1 / 0 → 3 | `net-cell-pin-p2-2` / `net-ui-8` (B/B)                                                                                                                                                                       |
| y2qecpr77m                           | 1 / 0 → 4 | `net-1511f102e8c8408c` / `net-96897796be4aec19` (B/B)                                                                                                                                                        |
| ysw8genh97                           | 1 / 0 → 0 | `net-b67384ebf49c6a87` / `net-power-gnd1` (T/B)                                                                                                                                                              |

The metric groups exact axis-aligned lines; opportunities remain distinct-Net segment pairs on each line. Positive-length overlaps and degenerate segments are not abutments. A facing end must be a non-marker pin entry or a two-way bend, with no same-Net continuation toward the gap and no net/power/route label anchored there. The gap is at most `placementPitch(roles).member` (80 units through 40 instances, otherwise 100). An intervening symbol body blocks it, using the existing visual diagnostic's 1.5-unit inset to avoid treating pin stroke caps as symbol bodies. No drawing IDs, titles or text values influence detection or weights.

### Largest ratio changes on unchanged main layouts

Ranked by additive new-minus-old result/human ratio. Driver = largest signed change in a metric's normalized contribution, including the changed human denominator. These are scoring changes, not layout changes.

#### 20 largest rises

| Drawing    | Split | Old ratio | New ratio |  Change | Driver |
| ---------- | ----- | --------: | --------: | ------: | ------ |
| n25frq3xqh | dev   |    0.1002 |    1.6429 | +1.5427 | area   |
| 7nmbghagg3 | dev   |    0.6446 |    2.0419 | +1.3973 | area   |
| dagyjgbwgw | val   |    0.0593 |    1.4541 | +1.3948 | area   |
| seenreyfeb | dev   |    0.0599 |    1.4308 | +1.3709 | area   |
| b45cdfxcfk | dev   |    0.0647 |    1.3893 | +1.3246 | area   |
| jkw9pk932h | val   |    0.0710 |    1.3569 | +1.2859 | area   |
| tgz65cq5kt | val   |    0.0358 |    1.3053 | +1.2695 | area   |
| sxc4y2gcbw | dev   |    0.3061 |    1.4552 | +1.1491 | area   |
| s75dft4ssy | dev   |    0.1129 |    1.1855 | +1.0726 | area   |
| jvkws955tv | dev   |    0.5843 |    1.6506 | +1.0662 | area   |
| kmpa4qk7k9 | val   |    0.2822 |    1.3196 | +1.0375 | area   |
| qdadm49css | dev   |    0.0340 |    1.0433 | +1.0094 | area   |
| zsgcm4w69n | val   |    0.3625 |    1.3716 | +1.0091 | area   |
| mszmgeytz2 | val   |    0.0321 |    1.0214 | +0.9892 | area   |
| t4j5wwx5x4 | dev   |    1.0436 |    2.0322 | +0.9886 | area   |
| 6ztdex4gtw | dev   |    0.0639 |    1.0435 | +0.9797 | area   |
| 7wffppqsd7 | dev   |    0.3917 |    1.3700 | +0.9783 | area   |
| n8bkenwpcd | dev   |    0.2292 |    1.2006 | +0.9714 | area   |
| hrn83wyyde | dev   |    0.0282 |    0.9975 | +0.9694 | area   |
| c3qbntbj56 | val   |    0.1112 |    1.0762 | +0.9650 | area   |

#### 20 largest falls

| Drawing                              | Split | Old ratio | New ratio |    Change | Driver          |
| ------------------------------------ | ----- | --------: | --------: | --------: | --------------- |
| qk9r4bb46n                           | val   |  135.4680 |    3.6232 | -131.8448 | unownedDrafting |
| 7me953ys54                           | dev   |   62.8029 |    2.3081 |  -60.4948 | portOrder       |
| x7evbngj49                           | dev   |   49.4375 |    1.8143 |  -47.6232 | crossings       |
| 7sxpwb4am7                           | val   |   45.3120 |    1.9488 |  -43.3632 | portOrder       |
| xtmvvp3efx                           | dev   |   41.3027 |    0.6246 |  -40.6780 | sourcePolarity  |
| ftzsrk2wva                           | dev   |   42.3280 |    2.3858 |  -39.9423 | portOrder       |
| 63213272-9ba5-442d-88c8-11e4abd514a7 | dev   |   40.7665 |    1.9697 |  -38.7969 | portOrder       |
| ftrjkg4566                           | dev   |   39.6997 |    2.2206 |  -37.4791 | crossings       |
| en97w8v92y                           | dev   |   35.9417 |    1.8318 |  -34.1099 | crossings       |
| kggd45xdt5                           | dev   |   35.3091 |    1.2348 |  -34.0743 | crossings       |
| t3r2dvffgc                           | dev   |   35.4241 |    2.0174 |  -33.4068 | crossings       |
| jkbdeaz3fr                           | dev   |   33.6357 |    1.9479 |  -31.6878 | unownedDrafting |
| kjs4xgzkba                           | dev   |   31.7336 |    1.6491 |  -30.0845 | crossings       |
| jzq4wvkwmf                           | dev   |   32.3195 |    2.9546 |  -29.3649 | crossings       |
| 6r2q6deeq9                           | dev   |   27.6224 |    1.6610 |  -25.9614 | crossings       |
| vyqjt4w5gv                           | val   |   28.2120 |    2.6503 |  -25.5618 | crossings       |
| y3ez763xm8                           | val   |   27.2789 |    2.0731 |  -25.2058 | crossings       |
| a5tz83j7hp                           | dev   |   26.1635 |    1.4725 |  -24.6910 | crossings       |
| sk29mm2ky6                           | dev   |   24.3489 |    1.5325 |  -22.8164 | crossings       |
| dkp3ehx5jt                           | val   |   23.7547 |    1.2529 |  -22.5018 | crossings       |

### Render checks

Inspected the five largest rises and five largest falls as PNG pairs rendered from the unchanged main SVGs. Files: `tmp/t086-r2/<id>-comparison.png`; render command and log are preserved in that directory. Purple dashed boxes and “unlabeled” text are evaluator overlays, not measured schematic labels. Each SVG is independently fitted to its panel; area conclusions use the metric totals, not screenshot scale.

| Direction | Drawing    | Observation                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rise      | n25frq3xqh | Human keeps the source/resistor input branch to the left and capacitor loads around the device. Main stacks the source, resistor and transistor into a tall column; the larger area contribution removes the old strong preference for main.                                                                                                                                           |
| Rise      | 7nmbghagg3 | Main rearranges the clocked transistor network into a taller drawing with a long outer path down to the ground rail. The changed area contribution raises its ratio above two.                                                                                                                                                                                                         |
| Rise      | dagyjgbwgw | Human has a compact vertical amplifier with the input resistor entering from the left. Main stretches the sources and transistors into a wide row with long top/bottom connections. The increased area penalty agrees with that visible loss of compactness.                                                                                                                           |
| Rise      | seenreyfeb | Human shows balanced transistor/load columns, the degeneration resistor between them and two tail sources below. Main moves the resistor and sources to the far left and puts both transistors in the same orientation. The rise is driven by area; it does not demonstrate that symmetry recognition was fixed.                                                                       |
| Rise      | b45cdfxcfk | Human wraps the amplifier feedback around the pass device and divider. Main uses a tall device/divider column with a large rectangular feedback loop. Its lower port-order penalty no longer masks the area increase.                                                                                                                                                                  |
| Fall      | qk9r4bb46n | Main flattens the human impedance sketch into a line, with detached/moved arrows and text. The ratio falls from 135.47 to 3.62 as the tiny old human denominator is replaced; main is still scored substantially worse. The visible drafting weakness remains.                                                                                                                         |
| Fall      | 7me953ys54 | Both retain the paired transistor columns. Main spreads the inputs/outputs to both sides, centers the bias port, and lengthens the tail connection. Reducing port-order's relative influence lowers the extreme old ratio; the new ratio still exceeds two.                                                                                                                            |
| Fall      | x7evbngj49 | Main places the amplifier far right and uses long outer loops and internal crossings, losing the human's organized vertical feedback layout. The ratio falls sharply but remains 1.81; the changed score has not repaired the drawing.                                                                                                                                                 |
| Fall      | 7sxpwb4am7 | Both retain the differential pair. Main distributes ports across both sides and lengthens the tail; the human has the inputs together at left. Lower relative port-order influence reduces the old 45.31 ratio to 1.95, still preferring human.                                                                                                                                        |
| Fall      | xtmvvp3efx | Main compacts the sources into a short row while the explanatory voltage/current annotations become detached from the original teaching sketch. The new ratio is 0.62 and prefers main. This is a remaining semantic-drafting weakness: the reference-free score rewards compactness and changes the relative polarity penalty; it does not fully capture the explanatory arrangement. |

### Planner invariance, guards and timing

All **628/628 plan hashes match main** and all **628/628 match the prior current run**. Both models use the new evaluation weights for comparison: **zero per-drawing score regressions**, identical dev/val composite totals and ratios, **628/628 equivalent**, floating pins **6 → 6**, missing connections **4 → 4**, and every `VISUAL_*` count unchanged. Per-case human/result/quick scores and all scoreboard splits were independently checked against the generated evaluation weights; no score mismatches. The current evaluator also records the separate selection calibration in `selectionReadabilityModel`; a supplied historical planner has its own selection policy.

Nonzero visual totals (main / final):

| Diagnostic                       | Main | Final |
| -------------------------------- | ---: | ----: |
| VISUAL_LABEL_CLEARANCE           |  270 |   270 |
| VISUAL_LABEL_OVERLAP             |    3 |     3 |
| VISUAL_LABEL_OWNER_DISTANCE      |    2 |     2 |
| VISUAL_LABEL_RUN_ON              |   29 |    29 |
| VISUAL_TERMINAL_DEPARTURE        |   32 |    32 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE |    1 |     1 |
| VISUAL_WIRE_THROUGH_SYMBOL       |    4 |     4 |

All other reported visual counts are zero on both sides.

Six large documents were planned with main, current, and a current repeat:

| Drawing    | Instances | Byte-identical to main | Deterministic repeat |
| ---------- | --------: | ---------------------- | -------------------- |
| 38m8wdesbh |        50 | True                   | True                 |
| 4fb59zv76m |        50 | True                   | True                 |
| 8b2n3zf9vj |        51 | True                   | True                 |
| b9afqhsjzv |       103 | True                   | True                 |
| g47e465db5 |        70 | True                   | True                 |
| sm663cbs8b |        94 | True                   | True                 |

The held-out harness ran **alone**, after the corpus evaluations, tests and large-document runs finished. Each implementation was warmed once per fixture, followed by three measured runs per implementation in alternating order. Values below are medians; phase instrumentation and individual samples are retained in `timing.json`. All seven fixtures retain identical plan hashes and deterministic repeats.

| Fixture          | Main median ms | Current median ms | Change |
| ---------------- | -------------: | ----------------: | -----: |
| fd-two-stage     |         1765.6 |            1745.0 | -1.16% |
| common-source-ac |         1059.1 |            1066.5 | +0.70% |
| skew             |         1783.7 |            1806.4 | +1.28% |
| deadtime         |         9832.6 |            9921.6 | +0.90% |
| ota-sky130       |          683.2 |             680.4 | -0.41% |
| widlar           |         5291.7 |            5293.4 | +0.03% |
| ltc3452          |        13775.6 |           13775.7 | +0.00% |

All held-out median changes are within **-1.16% to +1.28%**, comfortably inside the +20% gate and consistent with run-to-run noise. The round-1 search-trajectory regressions disappear when the selection weights are restored. No phase bound or planner search change is needed.

## Deviations and open questions

- The review's scope change supersedes original step 5's instruction to optimize planner selection with the refit. Planner selection is unchanged; there is no placement/routing fix in this round.
- `finished-selection.ts` and the new selection weights module are included under the review's explicit required split, extending the original owned-file list only as requested.
- The original two-grid threshold is superseded by the review's one-member-pitch/facing-end definition. Wider reach can increase counts despite narrowing endpoint eligibility; those changes are reported, not hidden.
- Overall round status: **done**. All plan acceptance gates pass under the review’s revised scope; the optional dead-code audit and residual metric limitations are disclosed above.
- No commits, branch changes, plan/review edits, lockfile edits, provider calls, hand-set weights or weakened acceptance tests. The only generated coefficient file was regenerated through `readability-fit.mjs`; the selection module copies main's original bytes.
- The feedback-flow and degenerated-pair symmetry recognition gaps remain a follow-up, as directed by the review.

### Proposed spec text

> Readability has two frozen models. **Selection weights** retain the T070 calibration and are used by default by `readabilityScore`, by all planner acceptance/ranking paths (R74/T074, finished-selection and R148–R160), and to determine the metric set in `readabilityMetrics(..., "weighted")`. Updating evaluation weights must not change planner behavior. **Evaluation weights** are generated by the dev-only pooled fit and supplied explicitly to `readabilityScore` by the evaluator for every case and aggregate scoreboard; evaluation computes all metrics. The calibration records every source planner, report checksum and dev-pair count. Validation pairs are used only for reporting discrimination. Any later adoption of evaluation weights for planner selection is a separate scoped task with its own planner quality, determinism and timing gates.
>
> `collinearAbutment` measures exact same-line different-Net segment pairs separated by at most one R154 member pitch, including touching, when both facing ends are non-marker pin entries or two-way bends and no symbol body lies in the gap. Same-Net continuation toward the gap, marked/labeled ends, open/straight-junction ends, unmarked branches, perpendicular crossings, positive-length overlap and zero-length segments do not violate. Opportunities are the different-Net axis-aligned segment pairs on each line. The metric remains reported even when its fitted evaluation coefficient is zero.
