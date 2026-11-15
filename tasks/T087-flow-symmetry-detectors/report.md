# T087 report — round 1

## Summary

Added independent, netlist-based `signalDirection` and `netlistSymmetry` measurements to full readability evaluation. Existing flow/symmetry metrics and selection weights are unchanged. Synthetic tests exercise feedback flow, source-degenerated differential symmetry, incompatible models, rails, passive pin permutations, common-axis tolerance, deterministic input ordering, and the search size bound.

**Partial: the prescribed pooled fit fails the main-layout validation discrimination gate (67.72% versus 68.25%).** Dev discrimination improves to 69.48%. The new detectors expose both flagged defects, but the fit assigns `netlistSymmetry` zero weight, so that defect remains diagnostic-only. No validation-driven tuning or manual weights were applied.

## Steps

| Step                  | Status  | Notes                                                                                                                                                                                   |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigate        | done    | Both recognition gaps reproduced; baseline coverage counted over all 628 human drawings.                                                                                                |
| 2. Signal direction   | done    | Pin-role direction, passive traversal with directed-Net boundaries, explicit interface direction, visible port centres and transformed amplifier pins.                                  |
| 3. Netlist symmetry   | done    | Complete bounded involution with strict symbol/model matching and fixed rails, independent of R88.                                                                                      |
| 4. Synthetic tests    | done    | Nine tests in `packages/auto-layout/test/readability-detectors.test.ts`.                                                                                                                |
| 5. Refit and validate | partial | Both sets remeasured and the evaluation file regenerated from 878 dev pairs. Main val discrimination misses the acceptance threshold by one pair; final invariance/check results below. |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Logs and evaluation artifacts are under `tmp/t087/`.

```text
pnpm build → 0; all packages built (existing Vite chunk-size advisory); build-final.log
pnpm typecheck → 0; tsc --noEmit; typecheck-final.log
pnpm lint → 0; 2076 files, 0 errors, 3500 warnings; lint-final.log
pnpm format:check → 0; All matched files use Prettier code style!; format-check-final.log
pnpm test:local → 0; 801 files passed / 3 skipped, 8257 tests passed / 117 skipped; 111.14 s; test-local-final.log
pnpm test:slow → 0; 2 files, 8 tests passed; 41.30 s; test-slow-final.log
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 completed, 628 equivalent; current-eval.log
pnpm exec vitest run packages/auto-layout/test/readability-detectors.test.ts packages/auto-layout/test/readability-metrics.test.ts → 0; 2 files, 43 tests passed; readability-tests.log
node tmp/t087/verify-large.mjs → 0; 6/6 identical and deterministic; large.log / large.json
node tmp/t087/timing.mjs → 0; 7/7 identical and deterministic, median deltas within noise; timing.log / timing.json
```

Earlier attempts are retained: the sandboxed local suite hit `connect EPERM ::1:5432` / `127.0.0.1:5432` and was interrupted; a focused server test confirmed the access failure. The first service-enabled full-suite attempt overlapped heavy evaluations, hit approximately five-second test limits in component-library, component-catalog and branch-columns tests, and was interrupted (130) to rerun after those evaluations. No timeout or assertion was weakened. The final service-enabled launch initially hit an automatic approval-review timeout, then succeeded on the permitted retry. One exploratory baseline evaluation was interrupted after the power-pin rail handling correction and restarted from scratch; only completed corrected runs were used for the fit.

## Investigation results

### Why the old detectors miss the flagged drawings

- `wvwmyesa4g`: the input interface Net `net-cell-pin-p1` is classified `internal`, while `net-cell-pin-p2` is `output`. Both interface directions are passive. The input capacitor separates the input port from the amplifier's inverting-input Net `net-ui-1`. There is no grounded source to seed traversal, and `signalDistances`' generic-block fallback only seeds an external Net directly attached to an input pin. It therefore produces an empty Net-distance map. There are no finite device distances for `backwardFlow` and no input ports for `portOrder`; both metrics have zero opportunities on human and result.
- `bv9zwmd835`: the transistor sources connect to distinct Nets `net-ui-28` and `net-ui-29`, through R3/R4 to `net-move-27` and I1. R88 seeds its involution from recognized differential/cross-coupled pairs. Differential recognition requires `b.s === seed.s`, so the two degeneration resistors prevent a seed; no symmetry component or opportunity results. The new detector validates the M1/M2, R1/R2 and R3/R4 swaps, including reversed R3/R4 pin correspondence, with the tail source fixed.

Identifiers above are investigation evidence only; none appear in detector code or tests.

### Baseline human coverage

From `tmp/main-a2120ab-report.json`, all 628 cases:

| Zero opportunities                  | Drawings |
| ----------------------------------- | -------: |
| `backwardFlow`                      |      274 |
| `portOrder`                         |      349 |
| Both flow metrics                   |      250 |
| All three existing symmetry metrics |      499 |
| Both flow metrics and symmetry      |      237 |

### Detector semantics and bounds

`readability-netlist.ts` uses the authoritative electrical topology projection and resolved pin roles. Ground, power and supply-role pins identify fixed rail Nets. It does not inspect displayed names, labels, titles, planner structures or layout groups. IDs only identify vertices and break deterministic search ties; geometry is used only to measure the selected topology.

`signalDirection` counts every placed input/output pin pair on a device having both roles. It also counts input/output port pairs, using explicit interface directions when available, otherwise walking two-pin passive devices until reaching directed-pin Nets. Traversal stops at those Nets, so passive feedback beyond the amplifier input does not relabel the external input as an output. Rails stop traversal; conflicting input/output reachability remains unclassified. Port comparisons use visible symbol centres; device pin comparisons use transformed pin positions. An output strictly left of its input violates; equal x does not.

`netlistSymmetry` searches each non-rail-connected device component. Marker instances do not become device pairs. Every candidate starts with a same-symbol, same-model transistor pair; remaining devices may map to themselves or compatible partners. Named model, internal/external subcircuit and unresolved subcircuit bindings retain their identities; missing model identity only matches missing identity. Pin names/roles are preserved, except that two-pin passive devices can exchange endpoints. Net mappings are involutions: an established self-map can never be replaced by a swap, and each rail is fixed. The entire component must validate before any pair is counted.

Search has at most 10,000 candidate assignments per component across all seeds, and a 256-device component limit. Exceeding either bound yields no detection, never a partially validated pairing. Stable search order chooses the first complete involution, preferring self-maps for unforced devices. These bounds are fixed algorithm constants, not corpus-fitted parameters.

Each placed swapped pair is one opportunity. Its visible centres must be level within one document grid and reflected within one grid about a common vertical axis. That axis is the median of the pair midpoints (mean of the middle two for even counts). A pair violating either condition counts once. Recognition does not depend on placement; unplaced pairs have no geometric opportunity.

### New coverage and flagged detector counts

All pre-existing metric counts match the original main report exactly on every human/result pair. The new detector adds coverage on 104 of the 250 previously unmeasured flow drawings, and 20 of the 499 previously unmeasured symmetry drawings. The existing metrics remain available alongside these conservative new measurements.

| New metric        | Human drawings with opportunities | Opportunities, human / main | Violations, human / main |
| ----------------- | --------------------------------: | --------------------------: | -----------------------: |
| `signalDirection` |                         187 / 628 |                   741 / 741 |                  71 / 81 |
| `netlistSymmetry` |                          85 / 628 |                   211 / 211 |                  52 / 29 |

| Drawing    | Metric            | Human violations / opportunities | Main violations / opportunities |
| ---------- | ----------------- | -------------------------------: | ------------------------------: |
| wvwmyesa4g | `signalDirection` |                            0 / 3 |                           1 / 3 |
| bv9zwmd835 | `netlistSymmetry` |                            0 / 3 |                           2 / 3 |

Both required detector assertions pass; neither flagged human drawing violates its new metric. `6r2q6deeq9` has no opportunities in either new detector.

### Pooled refit

The existing T086 procedure was used without changes to fitting iterations, regularization, learning rate or normalization. Both source builds existed. The main source is the supplied `/tmp/t086-baseline/dist/index.js` (1737221, planner plans identical to a2120ab); the historical source is `/tmp/t086-eb72cb1/packages/auto-layout/dist/index.js`. Each supplies 439 dev pairs, for 878 training pairs. No val pair participates in training.

```bash
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-baseline/dist/index.js
# preserved as tmp/t087/main-report.json
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-eb72cb1/packages/auto-layout/dist/index.js
# preserved as tmp/t087/historical-report.json
node scripts/readability-fit.mjs tmp/t087/main-report.json --source-commit 17372217c5cd175d0e7cfe3c95ae11ac27187245 --pool tmp/t087/historical-report.json --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59 --write
```

Generated provenance records both report SHA-256 checksums and the actual frozen-build commit 1737221. After validation, the generator was rerun to correct the initial logical-main label a2120ab to the supplied build’s actual SHA; all coefficients and scales were asserted exactly unchanged. The current evaluator report retains its as-run logical-main provenance label; its numeric model is identical to the final generated model. `tmp/t087/fit.json` contains the fit; `tmp/t087/analysis.json` independently rescores each layout set under both weight sets.

| Layouts    | Weights | Dev human-better | Val human-better | Dev result / human | Val result / human |
| ---------- | ------- | ---------------: | ---------------: | -----------------: | -----------------: |
| main       | T086    |         68.5649% |         68.2540% |           1.191063 |           1.205184 |
| main       | T087    |         69.4761% |         67.7249% |           1.195438 |           1.202294 |
| historical | T086    |         85.1936% |         82.5397% |           1.658697 |           1.581717 |
| historical | T087    |         85.4214% |         82.5397% |           1.655193 |           1.583518 |

The candidate new goal baseline is **dev 1.1954× / val 1.2023× human**. It is not an accepted replacement baseline because main validation discrimination falls from 129/189 to 128/189 (dev rises from 301/439 to 305/439). Validation flips are `9267mkznwd` and `caafz7vv6j` losing human-better status, and `hdag4x8jrw` gaining it. These are reporting observations only; no detector or fit was adjusted in response.

### Generated weights

The score uses `weight × violations / scale`; zero weights remain reported diagnostics.

| Metric                |         Weight |        Scale |
| --------------------- | -------------: | -----------: |
| area                  |   0.2977731114 |  442.1081136 |
| avoidableJogs         |  0.03143414328 | 0.2547945709 |
| backwardFlow          |              0 |  1.345709456 |
| bends                 |  0.02771091089 |  4.162556819 |
| blockedJoins          |   0.0116731462 | 0.1753616504 |
| collinearAbutment     |  0.00329586593 |  1.133965164 |
| controlSeparation     |              0 |  0.280334977 |
| crossings             |  0.08563509944 |  1.141473292 |
| detour                |              0 |  1.360227774 |
| labelClearance        |              0 |  2.237086455 |
| labelOverlaps         |  0.04057686828 | 0.1967850949 |
| labelOwnerDistance    |              0 | 0.4188062001 |
| narrowBands           |              0 |  2.639933388 |
| netlistSymmetry       |              0 | 0.4091771842 |
| portOrder             |  0.02308996572 | 0.9850823538 |
| potentialOrder        |              0 | 0.3357919955 |
| railCrossings         |  0.06844497339 | 0.4295465639 |
| railMarkerOrder       |              0 | 0.4387287496 |
| signalDirection       |  0.06880840931 | 0.6774937063 |
| signalSeriesVertical  |              0 | 0.6121399039 |
| sourcePolarity        |  0.02313011636 |  0.143182188 |
| structureIntrusion    |              0 |  0.143182188 |
| symmetryLevel         |              0 | 0.3408417825 |
| symmetryMirror        |              0 | 0.4295465639 |
| symmetryOrientation   |              0 | 0.6186177552 |
| terminalDepartures    | 0.002579225308 | 0.4565394244 |
| transistorOrientation |              0 | 0.8148675424 |
| unownedDrafting       |   0.3158481645 |  1.285985436 |
| wireThroughSymbols    |              0 |  1.329103008 |

`signalDirection` receives positive weight (0.0688084); `netlistSymmetry` receives zero. Across main drawings the latter has 52 human versus 29 result violations, so exposing the targeted asymmetry does not guarantee a positive coefficient under the prescribed aggregate nonnegative fit. Its zero coefficient is an unresolved limitation of the intended composite goal, not a missing detector result.

### Three flagged drawings, both layout sets

| Layouts    | Drawing    | T086 human / result | T087 human / result | T087 result / human |
| ---------- | ---------- | ------------------: | ------------------: | ------------------: |
| main       | 6r2q6deeq9 | 0.747047 / 1.240847 | 0.717989 / 1.181131 |            1.645054 |
| main       | bv9zwmd835 | 0.393779 / 0.479966 | 0.363361 / 0.451929 |            1.243745 |
| main       | wvwmyesa4g | 0.259755 / 0.510664 | 0.249126 / 0.589211 |            2.365108 |
| historical | 6r2q6deeq9 | 0.747047 / 1.379644 | 0.717989 / 1.325002 |            1.845435 |
| historical | bv9zwmd835 | 0.393779 / 0.494603 | 0.363361 / 0.468434 |            1.289169 |
| historical | wvwmyesa4g | 0.259755 / 0.560922 | 0.249126 / 0.637653 |            2.559558 |

All three flagged results remain worse than human under the generated evaluation model, for both layout sets.

### Planner invariance and large documents

Both the fresh baseline and final current-planner measurement have **628/628 plan hashes identical** to `tmp/main-a2120ab-report.json`, with **628/628 electrical equivalence**. Current and remeasured-main per-case readability measurements and independently rescored aggregates agree exactly. Selection weights are byte-identical to a2120ab. Isolated held-out timing is reported below.

The six large documents were each planned with the supplied main build, current code and a current repeat (`node tmp/t087/verify-large.mjs`). All plan JSON is byte-identical to main and deterministic on repeat; no error diagnostics were emitted.

| Drawing    | Instances | Byte-identical to main | Deterministic repeat |
| ---------- | --------: | ---------------------- | -------------------- |
| 38m8wdesbh |        50 | True                   | True                 |
| 4fb59zv76m |        50 | True                   | True                 |
| 8b2n3zf9vj |        51 | True                   | True                 |
| b9afqhsjzv |       103 | True                   | True                 |
| g47e465db5 |        70 | True                   | True                 |
| sm663cbs8b |        94 | True                   | True                 |

### Held-out timing

Run alone after evaluations and tests, using `node tmp/t087/timing.mjs`: both planners warmed once per fixture; three measured samples each, alternating order. All seven fixtures have identical main/current hashes and deterministic repeats.

| Fixture          | Main median ms | Current median ms | Change |
| ---------------- | -------------: | ----------------: | -----: |
| fd-two-stage     |         1753.9 |            1764.1 | +0.58% |
| common-source-ac |         1046.1 |            1065.5 | +1.85% |
| skew             |         1782.7 |            1792.1 | +0.53% |
| deadtime         |        10037.7 |           10070.9 | +0.33% |
| ota-sky130       |          695.6 |             690.2 | -0.78% |
| widlar           |         5370.3 |            5395.1 | +0.46% |
| ltc3452          |        13831.2 |           14051.9 | +1.60% |

Median changes are within −0.78% to +1.85%, consistent with noise. The timing and planner-invariance gates pass. Raw samples and hashes are in `tmp/t087/timing.json`.

## Deviations and open questions

- **Unmet gate:** main validation discrimination is below T086. Per the task workflow, the implementation stops short of claiming acceptance; changing the fit objective or forcing a positive symmetry coefficient would require a revised plan. The generated candidate weights are left reviewable.
- No planner placement/routing/selection code, R88 recognition, dependencies, lockfile, plan or review was changed. No provider API calls, commits or branch operations were performed.
- The existing fit/evaluator scripts discover metric keys automatically, so they need no source changes.
- Exact involution is conservative: asymmetric graph components and exhausted searches can have no opportunity even if a human could recognize a local partial symmetry. Passive paths reaching conflicting directed roles remain ambiguous.
- These are topology/readability measurements; no electrical behavior changed or simulation was required.

### Proposed spec text

> Full readability evaluation additionally reports `signalDirection` and `netlistSymmetry`. Neither changes planner selection weights. Signal direction derives input/output precedence from resolved pin roles and infers unset interface directions through passive connectivity, stopping at rails or directed-pin Nets. Opportunities are placed input/output port pairs and device input/output pin pairs; an output left of its input violates.
>
> Netlist symmetry is independent of planner recognition. It validates a nontrivial connectivity-graph involution containing a transistor pair, preserving device symbol/model identity and pin roles, with reversible passive endpoints and fixed rail/self-mapped Nets. Search is deterministic and limited to 10,000 candidate assignments and 256 devices per non-rail-connected component; incomplete searches contribute no opportunities. Each placed swapped pair is an opportunity, and violates if its visible centres differ in y by more than one grid or fail reflection within one grid about the component's median pair-midpoint axis. Evaluation weights are generated by the dev-only pooled procedure; validation cases remain reporting-only.
