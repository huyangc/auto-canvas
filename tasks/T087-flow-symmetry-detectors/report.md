# T087 report — round 2

## Summary

Fixed label-connected Base Nets being treated as separate electrical Nets by both readability detectors. The shared netlist helper now maps terminal Base Nets through `projection.logicalNetByBaseNet`; explicit interface Net references use the same normalization. Added three synthetic regression tests for split feedback flow, label-joined degenerated symmetry, and explicit directions on nonrepresentative Base Nets.

Both pooled layout sets were remeasured and evaluation weights regenerated. Coefficients and composite scores are unchanged from round 1; `netlistSymmetry` normalization changes from 0.4091771842 to 0.6535342849. Symmetry coverage rises from 85 to 116 human drawings. The main-layout validation discrimination remains 67.72% versus T086's 68.25%, the one-pair gate deviation explicitly accepted by Opus in `review.md` round 1. No validation-driven tuning was applied.

## Steps

| Step                  | Status | Notes                                                                                                                                                  |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Investigate        | done   | Both recognition gaps reproduced; baseline coverage counted over all 628 human drawings.                                                               |
| 2. Signal direction   | done   | Pin-role direction, passive traversal with directed-Net boundaries, explicit interface direction, visible port centres and transformed amplifier pins. |
| 3. Netlist symmetry   | done   | Complete bounded involution with strict symbol/model matching and fixed rails, independent of R88.                                                     |
| 4. Synthetic tests    | done   | Twelve tests in `packages/auto-layout/test/readability-detectors.test.ts`.                                                                             |
| 5. Refit and validate | done   | Both sets freshly remeasured and evaluation weights regenerated from 878 dev pairs. The previously accepted one-pair main val deviation is unchanged.  |

## Review findings addressed

**Must-fix #1 addressed.** `readability-netlist.ts` now converts terminal Base Nets into logical Net representatives before either detector builds its graph, including rail identity. `readability-signal-direction.ts` normalizes explicit interface `netId` references through the same projection before matching.

Before the fix, `pnpm exec vitest run packages/auto-layout/test/readability-detectors.test.ts` exited 1: split feedback dropped from 3 opportunities / 1 violation to 2 / 0, and label-joined differential symmetry dropped from 3 opportunities to 0. After the fix, all 46 tests across the detector and metrics suites pass. The explicit-interface regression uses nonrepresentative Base Net references and passive-only connectivity so inference cannot hide a missing explicit direction. The symmetry regression splits a source, the tail and a supply connection, checks all three pairs, and then detects a deliberately displaced resistor.

The review supplied the specific cause and required correction; the failing synthetic reproductions confirmed it, so broad hypothesis generation and instrumentation were unnecessary. No debug instrumentation was added.

## Acceptance results

All round 2 logs and evaluation artifacts are under `tmp/t087-round2/`. Commands were rerun for round 2; the full local suite had local PostgreSQL access and ran separately from evaluations.

```text
pnpm build → 0; all packages built (existing Vite chunk-size advisory); build-final.log
pnpm typecheck → 0; tsc --noEmit; typecheck-final.log
pnpm lint → 0; 2076 files, 0 errors, 3500 warnings; lint-final.log
pnpm format:check → 0; All matched files use Prettier code style!; format-check-final.log
pnpm test:local → 0; 801 files passed / 3 skipped, 8260 tests passed / 117 skipped; 97.64 s; test-local.log
pnpm test:slow → 0; 2 files, 8 tests passed; 41.29 s; test-slow.log
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 completed, 628 equivalent; current-eval.log
pnpm exec vitest run packages/auto-layout/test/readability-detectors.test.ts packages/auto-layout/test/readability-metrics.test.ts → 0; 2 files, 46 tests passed; readability-tests.log
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-baseline/dist/index.js → 0; 628 completed, 628 equivalent; main-eval.log
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-eb72cb1/packages/auto-layout/dist/index.js → 0; 628 completed, 628 equivalent; historical-eval.log
node scripts/readability-fit.mjs tmp/t087-round2/main-report.json --source-commit 17372217c5cd175d0e7cfe3c95ae11ac27187245 --pool tmp/t087-round2/historical-report.json --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59 --write → 0; 878 dev pairs; fit.json
python3 tmp/t087-round2/verify-reports.py → 0; main/current/historical hashes, equivalence, unchanged old metrics and current/main metric agreement all 628/628; verification.log
node tmp/t087-round2/verify-large.mjs → 0; 6/6 identical and deterministic; large.log / large.json
node tmp/t087-round2/timing.mjs → 0; 7/7 identical and deterministic, median deltas within noise; timing.log / timing.json
```

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

`readability-netlist.ts` uses the authoritative electrical topology projection and resolved pin roles. Terminal and explicit interface Base Net IDs are normalized to logical Net representatives, so matching scoped Net labels preserve electrical connectivity in both detectors. Ground, power and supply-role pins identify fixed rail Nets. It does not interpret displayed names, labels, titles, planner structures or layout groups itself; label-based electrical equivalence comes from the authoritative projection. IDs only identify vertices and break deterministic search ties; geometry is used only to measure the selected topology.

`signalDirection` counts every placed input/output pin pair on a device having both roles. It also counts input/output port pairs, using explicit interface directions when available, otherwise walking two-pin passive devices until reaching directed-pin Nets. Traversal stops at those Nets, so passive feedback beyond the amplifier input does not relabel the external input as an output. Rails stop traversal; conflicting input/output reachability remains unclassified. Port comparisons use visible symbol centres; device pin comparisons use transformed pin positions. An output strictly left of its input violates; equal x does not.

`netlistSymmetry` searches each non-rail-connected device component. Marker instances do not become device pairs. Every candidate starts with a same-symbol, same-model transistor pair; remaining devices may map to themselves or compatible partners. Named model, internal/external subcircuit and unresolved subcircuit bindings retain their identities; missing model identity only matches missing identity. Pin names/roles are preserved, except that two-pin passive devices can exchange endpoints. Net mappings are involutions: an established self-map can never be replaced by a swap, and each rail is fixed. The entire component must validate before any pair is counted.

Search has at most 10,000 candidate assignments per component across all seeds, and a 256-device component limit. Exceeding either bound yields no detection, never a partially validated pairing. Stable search order chooses the first complete involution, preferring self-maps for unforced devices. These bounds are fixed algorithm constants, not corpus-fitted parameters.

Each placed swapped pair is one opportunity. Its visible centres must be level within one document grid and reflected within one grid about a common vertical axis. That axis is the median of the pair midpoints (mean of the middle two for even counts). A pair violating either condition counts once. Recognition does not depend on placement; unplaced pairs have no geometric opportunity.

### New coverage and flagged detector counts

All pre-existing metric counts match the original main report exactly on every human/result pair. The new detector adds coverage on 104 of the 250 previously unmeasured flow drawings, and 32 of the 499 previously unmeasured symmetry drawings. The existing metrics remain available alongside these conservative new measurements. Relative to round 1, logical connectivity changes symmetry counts on 43 drawings and flow opportunity counts on one drawing; 31 more human drawings now have symmetry opportunities (116 versus 85), including 12 more with none in the old symmetry metrics (32 versus 20).

| New metric        | Human drawings with opportunities | Opportunities, human / main | Violations, human / main |
| ----------------- | --------------------------------: | --------------------------: | -----------------------: |
| `signalDirection` |                         187 / 628 |                   742 / 742 |                  71 / 81 |
| `netlistSymmetry` |                         116 / 628 |                   323 / 323 |                  91 / 81 |

| Drawing    | Metric            | Human violations / opportunities | Main violations / opportunities |
| ---------- | ----------------- | -------------------------------: | ------------------------------: |
| wvwmyesa4g | `signalDirection` |                            0 / 3 |                           1 / 3 |
| bv9zwmd835 | `netlistSymmetry` |                            0 / 3 |                           2 / 3 |

Both required detector assertions pass; neither flagged human drawing violates its new metric. `6r2q6deeq9` has no opportunities in either new detector.

### Pooled refit

The existing T086 procedure was used without changes to fitting iterations, regularization, learning rate or normalization. Both source builds existed. The main source is the supplied `/tmp/t086-baseline/dist/index.js` (1737221, planner plans identical to a2120ab); the historical source is `/tmp/t086-eb72cb1/packages/auto-layout/dist/index.js`. Each supplies 439 dev pairs, for 878 training pairs. No val pair participates in training.

```bash
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-baseline/dist/index.js
# preserved as tmp/t087-round2/main-report.json
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 --baseline-planner /tmp/t086-eb72cb1/packages/auto-layout/dist/index.js
# preserved as tmp/t087-round2/historical-report.json
node scripts/readability-fit.mjs tmp/t087-round2/main-report.json --source-commit 17372217c5cd175d0e7cfe3c95ae11ac27187245 --pool tmp/t087-round2/historical-report.json --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59 --write
```

Generated provenance records both freshly measured report SHA-256 checksums and the actual frozen-build commit 1737221. `tmp/t087-round2/fit.json` contains the fit; `tmp/t087-round2/analysis.json` independently rescores each layout set under both T086 and regenerated T087 weight sets. All coefficients and all other scales match round 1 exactly; only the zero-weight `netlistSymmetry` scale and report provenance change.

| Layouts    | Weights | Dev human-better | Val human-better | Dev result / human | Val result / human |
| ---------- | ------- | ---------------: | ---------------: | -----------------: | -----------------: |
| main       | T086    |         68.5649% |         68.2540% |           1.191063 |           1.205184 |
| main       | T087    |         69.4761% |         67.7249% |           1.195438 |           1.202294 |
| historical | T086    |         85.1936% |         82.5397% |           1.658697 |           1.581717 |
| historical | T087    |         85.4214% |         82.5397% |           1.655193 |           1.583518 |

The new goal baseline is **dev 1.1954× / val 1.2023× human**, unchanged from round 1. Main validation discrimination is 128/189 versus T086’s 129/189 (dev rises from 301/439 to 305/439). Opus explicitly accepted this one-pair gate deviation in the round 1 review; the round 2 refit introduces no further deviation. Validation flips are `9267mkznwd` and `caafz7vv6j` losing human-better status, and `hdag4x8jrw` gaining it. These are reporting observations only; no detector or fit was adjusted in response.

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
| netlistSymmetry       |              0 | 0.6535342849 |
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

`signalDirection` receives positive weight (0.0688084); `netlistSymmetry` receives zero. Across main drawings the latter has 91 human versus 81 result violations, so exposing the targeted asymmetry does not guarantee a positive coefficient under the prescribed aggregate nonnegative fit. Its zero coefficient remains a documented limitation of the composite goal, accepted in round 1; symmetry remains a reported diagnostic metric.

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

Both the fresh baseline and final current-planner measurement have **628/628 plan hashes identical** to `tmp/main-a2120ab-report.json`, with **628/628 electrical equivalence**. Current and remeasured-main per-case readability measurements and independently rescored aggregates agree exactly. The historical remeasurement also has 628/628 hashes identical to its round 1 report and 628/628 electrical equivalence. Selection weights are byte-identical to a2120ab. Isolated held-out timing is reported below.

The six large documents were each planned with the supplied main build, current code and a current repeat (`node tmp/t087-round2/verify-large.mjs`). All plan JSON is byte-identical to main and deterministic on repeat; no error diagnostics were emitted.

| Drawing    | Instances | Byte-identical to main | Deterministic repeat |
| ---------- | --------: | ---------------------- | -------------------- |
| 38m8wdesbh |        50 | True                   | True                 |
| 4fb59zv76m |        50 | True                   | True                 |
| 8b2n3zf9vj |        51 | True                   | True                 |
| b9afqhsjzv |       103 | True                   | True                 |
| g47e465db5 |        70 | True                   | True                 |
| sm663cbs8b |        94 | True                   | True                 |

### Held-out timing

Run alone after evaluations and tests, using `node tmp/t087-round2/timing.mjs`: both planners warmed once per fixture; three measured samples each, alternating order. All seven fixtures have identical main/current hashes and deterministic repeats.

| Fixture          | Main median ms | Current median ms | Change |
| ---------------- | -------------: | ----------------: | -----: |
| fd-two-stage     |         1776.3 |            1761.9 | -0.81% |
| common-source-ac |         1059.8 |            1049.5 | -0.98% |
| skew             |         1826.5 |            1824.8 | -0.09% |
| deadtime         |        10000.1 |           10109.9 | +1.10% |
| ota-sky130       |          696.0 |             691.6 | -0.63% |
| widlar           |         5386.2 |            5414.1 | +0.52% |
| ltc3452          |        13968.6 |           14074.0 | +0.75% |

Median changes range from -0.98% to +1.10%, consistent with noise. The timing and planner-invariance gates pass. Raw samples and hashes are in `tmp/t087-round2/timing.json`.

## Deviations and open questions

- **Previously accepted gate deviation:** main validation discrimination remains 67.72% versus T086’s 68.25% (one pair out of 189). Opus accepted this in round 1; round 2 leaves discrimination unchanged. No fit-objective changes, validation tuning or forced symmetry coefficient were introduced.
- No planner placement/routing/selection code, R88 recognition, dependencies, lockfile, plan or review was changed. No provider API calls, commits or branch operations were performed.
- The existing fit/evaluator scripts discover metric keys automatically, so they need no source changes.
- Exact involution is conservative: asymmetric graph components and exhausted searches can have no opportunity even if a human could recognize a local partial symmetry. Passive paths reaching conflicting directed roles remain ambiguous.
- These are topology/readability measurements; no electrical behavior changed or simulation was required.

### Proposed spec text

> Full readability evaluation additionally reports `signalDirection` and `netlistSymmetry`. Neither changes planner selection weights. Both detectors normalize Base Nets to the authoritative logical Net projection, including explicit interface references, so label-connected parts remain electrically connected. Signal direction derives input/output precedence from resolved pin roles and infers unset interface directions through passive connectivity, stopping at rails or directed-pin Nets. Opportunities are placed input/output port pairs and device input/output pin pairs; an output left of its input violates.
>
> Netlist symmetry is independent of planner recognition. It validates a nontrivial connectivity-graph involution containing a transistor pair, preserving device symbol/model identity and pin roles, with reversible passive endpoints and fixed rail/self-mapped Nets. Search is deterministic and limited to 10,000 candidate assignments and 256 devices per non-rail-connected component; incomplete searches contribute no opportunities. Each placed swapped pair is an opportunity, and violates if its visible centres differ in y by more than one grid or fail reflection within one grid about the component's median pair-midpoint axis. Evaluation weights are generated by the dev-only pooled procedure; validation cases remain reporting-only.
