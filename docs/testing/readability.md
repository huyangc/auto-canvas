# Circuit readability evaluation

`packages/auto-layout/src/readability-metrics.ts` measures a placed, routed
schematic without a reference drawing or planner state. The evaluator calls
exactly the same function for human, quick and result documents. Nothing in
this module changes layout planning, its guards, or `readability.ts`.

Each measurement contains `violations` (lower is better) and `opportunities`
(exposure). Counts are not necessarily bounded by exposure: for example two
Nets may cross several times. Area and detour are continuous penalty masses,
not literal counts. Missing inference supplies no opportunity, not a violation.
Coordinates have screen orientation: increasing y is downward. Symbol bounds
come from `visibleInstanceBounds`; pins and route endpoints use resolved
geometry. As with the existing derived APIs, documents are immutable snapshots.

## Definitions

| Metric                  | Violation / penalty                                                                                                                                                                                                                                                                                                                       | Opportunities                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `backwardFlow`          | On each non-power Net, an unordered pair of devices with distinct finite `signalDistances` has decreasing x as signal distance increases. Equal x is allowed.                                                                                                                                                                             | Such ordered-by-distance device pairs, once per Net.                               |
| `portOrder`             | An input marker/source is at or to the right of an output marker/source. Inputs use `classifyNets` or a non-rail distance-zero signal root; outputs use the classified output role.                                                                                                                                                       | Distinct input/output instance pairs.                                              |
| `potentialOrder`        | A DC-conducting device's centre is below the next device's centre when its inferred bottom pin shares a Net with the next device's inferred top pin. Direction comes from `netLevels`, including `inferSeriesChannels`; `conductingPins` excludes non-conducting edges.                                                                   | Directed, bottom-to-top conducting device pairs per Net.                           |
| `railMarkerOrder`       | A supply marker pin is below, or a ground marker pin above, its closest non-marker host pin on the same rail Net. Ties use instance and pin identifiers.                                                                                                                                                                                  | Rail marker pins with a resolved host.                                             |
| `transistorOrientation` | A transistor source/emitter exit is not down for n-type or up for p-type, using the channel direction supplied by the existing inference. Horizontal exits also violate the convention.                                                                                                                                                   | Placed MOS/BJT devices with a resolved source/emitter and inferred channel.        |
| `sourcePolarity`        | A voltage/current source's positive pin is below its negative pin. Horizontal sources are allowed.                                                                                                                                                                                                                                        | Sources with both pins resolved.                                                   |
| `symmetryMirror`        | R88 pair midpoints fail the existing 40-unit common-axis tolerance.                                                                                                                                                                                                                                                                       | R88 pairs.                                                                         |
| `symmetryLevel`         | R88 pairs fail the existing 20-unit pin-centre y tolerance.                                                                                                                                                                                                                                                                               | R88 pairs.                                                                         |
| `symmetryOrientation`   | R88 paired orientations are not exact left-right reflections.                                                                                                                                                                                                                                                                             | R88 pairs.                                                                         |
| `structureIntrusion`    | A foreign non-marker device's entire visible box lies inside a recognized group's box (including extra members and its tail, when present).                                                                                                                                                                                               | Recognized-group / foreign-device pairs.                                           |
| `controlSeparation`     | A device with an output-role pin drives a transistor gate/base on a non-rail Net, but their Manhattan centre distance exceeds `max(4 pitches, (drawing width + height)/4)`. Duplicate outputs to the same host count once.                                                                                                                | Output-device / controlled-device pairs.                                           |
| `crossings`             | Existing routing audit's deduplicated proper crossings.                                                                                                                                                                                                                                                                                   | All unordered resolved route-segment pairs (exposure, including ineligible pairs). |
| `railCrossings`         | Existing routing audit's crossings per unordered pair of routed Nets with at least one classified rail. A multi-Net intersection can count in multiple pairs.                                                                                                                                                                             | Routed Net pairs involving a rail.                                                 |
| `bends`                 | Existing routing audit's non-collinear bends.                                                                                                                                                                                                                                                                                             | Interior resolved route points.                                                    |
| `avoidableJogs`         | Existing T068 `signalPathMetrics`: a bent two-terminal Net whose opposing exits can be joined by a collision-free perpendicular translation of at most one grid pitch.                                                                                                                                                                    | Nets with exactly two resolved pins.                                               |
| `blockedJoins`          | Existing T068 `signalPathMetrics`: a marker body obstructs a potential straight join between adjacent opposing device pins.                                                                                                                                                                                                               | Unordered same-Net resolved pin pairs (exposure).                                  |
| `detour`                | Sum over routed Nets of `max(0, routedLength / terminalMSTLength - 1)`. The denominator is a deterministic Manhattan minimum spanning tree, not a rectilinear Steiner optimum; shared trunks can legitimately be shorter than this tree.                                                                                                  | Routed Nets with positive terminal MST length.                                     |
| `wireThroughSymbols`    | Existing `VISUAL_WIRE_THROUGH_SYMBOL` diagnostic count, including informational backwards travel through an endpoint's own symbol.                                                                                                                                                                                                        | Resolved segment / visible-symbol pairs.                                           |
| `area`                  | Visible-symbol enclosing-box area divided by squared grid pitch. The scoreboard additionally reports human and result median areas.                                                                                                                                                                                                       | One document.                                                                      |
| `narrowBands`           | Project all visible symbol boxes, including markers, onto each axis. Merge touching/overlapping intervals. A positive gap between consecutive merged intervals is a violation if **strictly less than two grid pitches**. This is a full-span strip empty of symbol ink; wires, labels and free drafting do not fill it. Count both axes. | All positive projection gaps.                                                      |
| `signalSeriesVertical`  | Existing T068 signal-series passive orientation count, excluding devices with an inferred DC direction.                                                                                                                                                                                                                                   | Horizontal plus vertical eligible series passives.                                 |
| `labelOverlaps`         | Existing `readabilityCounts.labelOverlaps`.                                                                                                                                                                                                                                                                                               | Unordered annotation pairs (exposure).                                             |
| `labelClearance`        | Existing `readabilityCounts.labelClearance`.                                                                                                                                                                                                                                                                                              | Annotations.                                                                       |
| `terminalDepartures`    | Existing `readabilityCounts.terminalDepartures`; sideways departures from multi-pin bodies are intentionally allowed by this diagnostic.                                                                                                                                                                                                  | Resolved pins.                                                                     |
| `labelOwnerDistance`    | Existing `diagnoseLabelClearance` owner-distance diagnostic count.                                                                                                                                                                                                                                                                        | Annotations.                                                                       |
| `unownedDrafting`       | Existing `draftingGroups` connected ink groups for which nearest-geometric ownership finds no nearby device, junction or route. Locked groups are excluded by that inference. No text content is read.                                                                                                                                    | Eligible drafting groups.                                                          |

No proposed category was removed. Row-height irregularity was optional and is
not added: projection gaps and potential order already measure distinct space
and row problems. `signalSeriesVertical` preserves the direct device-convention
signal for the flagged upright series resistor. `unownedDrafting` extends the
label category to cover detached pseudo-ports made of free circles and text;
ordinary annotation diagnostics cannot see their missing electrical ownership.
It is an indicator, not proof of the intended owner: a detached object may find
a different nearby owner, and a legitimate free note may have no owner.

## Calibration and composite

The narrow-band threshold was selected from **dev human geometry only**, before
inspecting val metrics: 439 drawings supplied 2,456 positive gaps, with quartiles
0.8 and 1.8 pitches (first quartile and median). Rounding the median up gives two
pitches. The threshold is frozen for this evaluation. No definition is fitted
on val. All other tolerances are stated above or inherited unchanged.

`node scripts/readability-fit.mjs tmp/auto-layout-eval/report.json` reports a
**diagnostic refit**, without changing the evaluation model. It fits
non-negative weights with pairwise logistic loss and L2 regularization. For
metric k, normalize raw violations by the dev RMS human/result difference
(use scale 1 for a constant metric). Starting at zero, take 2,000 full-batch
projected gradient steps with learning rate 0.1 and L2 coefficient 0.01.
Normalize final weights to sum to one. A document's composite is the weighted
sum of these normalized penalties. Denominators are reported for audit, not
used as divisors: a layout must not lower its bend penalty by adding bends.
Training optimizes a smooth ranking surrogate, not an exact global maximum of
strict pairwise accuracy. Fixed inputs and order produce identical results.

Only completed human/result pairs participate in the fit and paired summaries.
The inherited split is `sha256(id) % 3 == 0` for val, dev otherwise. For every
metric and the composite, the scoreboard reports human/result totals, their
ratio, and strict human-better / human-worse / equal shares. The human-better
share is pairwise accuracy; ties are not wins. Numerical equality uses tolerance
`1e-10`. Each metric additionally reports opportunities and human zero share.
Ratios with zero human total are null for a positive result and 1 for two zeros.
The frozen model, scales and source metadata are saved as `readabilityModel` in
`report.json`, alongside per-drawing scores (human, quick and result). Evaluation
uses `readabilityScore(metrics)` from `readability-metrics.ts`, with weights and
scales imported from generated `readability-weights.ts`. It never refits them,
even when the planner or evaluated corpus changes. Val-only runs still have a
frozen composite; only a diagnostic refit without dev data has no composite
(`null`), and the fitting CLI rejects such training input.

To deliberately regenerate the model from the preserved `eb72cb1` report:

```bash
node scripts/readability-fit.mjs tmp/t070/eb72cb1-readability-report.json --write --source-commit eb72cb1f11ea2cb083d9d10c5525a03b6bba2a59
```

`--write` fits dev pairs and generates the TypeScript artifact with full-precision
weights/scales and a header naming the source commit, report and command. The
metadata also records the report SHA-256 and training settings. The caller must
identify the source planner commit explicitly; the original report predates
commit metadata. Its 628 plan hashes were checked against the supplied baseline.
The artifact contains aggregate statistics only, no raw Gallery drawings.
Changing this artifact deliberately changes the score version; compare planner
commits using the same artifact. Run `pnpm build` after generating it.

### Targets and diagnostic metrics

Each split's `readability.targets` contains every metric with a nonzero frozen
weight, with `human`, `result`, `ratio` and `withinTarget`. The target is
`result <= 1.2 * human`, except when the human total is **strictly below 10**,
where it is `result <= human + 2`. The latter also handles a zero human total.
`targets.composite` reports the frozen composite totals and ratio with the 1.2
ratio target (no small-count exception, since the composite is not a count).
These are aggregate split targets, not a claim that every drawing meets them.

All 26 metrics remain in `readability.metrics`; zero-weight ones have
`diagnostic: true` and are excluded from the composite and target view. In the
frozen dev calibration, 15 metrics received zero weight:

| Diagnostics                                                                                                                                                                  | Reason for retaining only as diagnostics                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `narrowBands`, `wireThroughSymbols`, `labelClearance`, `detour`, `symmetryOrientation`, `transistorOrientation`, `labelOwnerDistance`, `structureIntrusion`, `symmetryLevel` | Human totals are worse than result totals; these definitions penalize accepted human conventions or compactness. They do not reliably measure human readability in this corpus. |
| `backwardFlow`, `railMarkerOrder`, `signalSeriesVertical`, `symmetryMirror`                                                                                                  | Human totals and strict pairwise comparisons are worse on dev; kept to inspect particular defects, not as optimization targets.                                                 |
| `potentialOrder`                                                                                                                                                             | Human total is slightly worse (24 vs 23); the joint dev fit assigns zero weight despite some useful individual comparisons.                                                     |
| `bends`                                                                                                                                                                      | Human total is better (1604 vs 1751), but the joint fit adds no positive weight after accounting for the other metrics.                                                         |

In particular, `narrowBands` counts compact gaps, not the wasted strip beside a
tall part in a row of short parts. The flagged Common-Source drawing scores
human 4, historical 2, current 1; it registers the historical change but ranks
the human poorly. It stays a zero-weight diagnostic with its definition
unchanged; redefining it requires a separate dev-only calibration. No val
geometry or accuracy was used to adjust the definitions or frozen weights.

This is a relative drawing-quality diagnostic, not an electrical correctness
score or proof that every human drawing is best. The existing equivalence,
missing-connection and routing-safety checks remain authoritative. In
particular, normalization by drawing span can hide control separation in a
very large drawing, topology inference can abstain, and free drafting ownership
is approximate. Inspect single metrics alongside the learned composite.

## Evidence and reproduction

The round 2 task report records acceptance commands, fitted accuracies,
performance, plan-hash comparison and flagged-case measurements. Local artifacts
live under `tmp/t070/` and `tmp/auto-layout-eval/`; raw Gallery data is not tracked.
`tmp/t070/readability.html` shows the same 25 IDs as the supplied sample page plus
the four flagged cases, with human/result metrics and historical comparisons.
Tests in `packages/auto-layout/test/readability-metrics.test.ts` cover clean and
violating synthetic cases for every metric, shared human/result semantics,
repeatability, dev-only fitting, ties, missing training data, frozen scoring,
corpus-independent scores and target boundaries.
