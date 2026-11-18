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

### Block direction (report-only)

Each human, quick and result metric set has `blockDirection`
(`scripts/lib/block-direction.mjs`, R164): `outputFacesLeft` counts output
pins of directed blocks (an input-role and an output-role pin) that leave to
the left, and `outputPortLeft` counts their output pins whose Net carries
ports that all lie left of the block's visible centre. Pins and ports join
through the drawing's own Net terminals. Split totals count the cases with at
least one finding of each kind. `againstFlow` is the planner's own R164
counter (`againstFlowCounter`) applied to the drawing: free directed blocks (on
no block cycle) whose outputs all leave to the right while more than half of
the other device pins on their non-rail input Nets lie right of the mean x of
the block's pins. Pins of parts that also touch one of the block's output Nets
are feedback and are ignored, as are markers, ports and MOS bulk pins; Nets
come from `classifyNets`. None of the three counts has a selection or
evaluation weight; the first two count blocks on a block cycle too, since human
drawings face latch and ring blocks left.

### Stack columns (report-only)

Each drawing's `stackColumns` counts R166's stacks (two devices carrying the
only two conduction terminals on a non-rail Net, at least one a transistor)
and the ones the drawing breaks: `stacks`, `broken` and the device-pair keys
`brokenKeys`. A stack is kept when its two pins lie on one line along their
exits (2-unit tolerance) and face each other with no device body between
them. Each split's `stackColumns` sums `stacks` and the broken counts of the
`human` and `result` drawings over the completed pairs, and `plannerOnly`
counts the stacks the result breaks while the human drawing keeps them
(`null` with `--reference`, whose drawing names its devices differently). These
counts take no part in the composite, targets or acceptance gates
(`scripts/lib/stack-columns.mjs`).

## Visible integrity

`scripts/visible-integrity.mjs` reports visible connection defects that the
routing audit (`missingConnections`, `floatingPins`, `unsafeProblems`) does not
see. The evaluator stores `visibleIntegrity` on the human and result sides; the
quick reference has none. Its `erc` groups the product ERC findings
(`diagnoseProject`, the Document placed in its own Project) of three codes,
each finding with its object ids: `danglingWires` (`ERC_DANGLING_WIRE`: Route,
Junction, Net), `unconnectedPins` (`ERC_UNCONNECTED_PIN`; it
judges netlist membership plus NoConnect marks, not drawn wires) and
`touchingNotConnected` (`ERC_TOUCHING_NOT_CONNECTED`: a pin drawn on another
Net's wire or pin).

`labelOwnership` lists visible Net labels and power labels that read as naming
another Net (the measure lives in
`packages/auto-layout/src/label-ownership.ts`; the planner's R15a step seats
both by the same definition). Since T126 the list, and so every count of label
flags, includes power labels: text naming a rail drawn without a power symbol.
A power label anchored to a ground or `vdd-port` marker, or to an instance
owning a `power-marker` name claim on the label's Net, is that marker's caption
and is not measured. A
label's Net is the Logical Net of its bound Base Net (Base Nets joined by a
matching name are one). Its rendered ink box is measured against every resolved
wire segment and every visible pin that sits on a Net; a segment crossing or
touching the box, or a pin inside it, is at distance 0. A label is flagged
when no wire or pin of its own Logical Net comes within one grid of the box
(two grids for a power label: a rail's name is drawn a grid clear of the
rail's end, 1.17 grid from its wire in 169 of the corpus's 212 marker-less
power labels), or when a wire or pin of another Logical Net is strictly closer
than its own nearest one. The flag's reason is `foreign-closer` when that nearer foreign wire
or pin is itself within one grid (the label stands on another Net), and
`own-far` otherwise (the label stands apart from its Net); it also records both
distances, the nearest foreign object and the label box.

Per case, `integrity.introduced` holds what the result shows and its source did
not. A dangling wire end counts as carried only when its Route is one the
planner carries over from the source (Route id prefix `auto-layout-carried-`,
R158), and only up to the number of open ends the source has on that Net; every
other open end is introduced, since the planner regenerates Route and Junction
ids. Also introduced are unconnected pins (by instance, pin and member) the
source did not report, flagged labels (by annotation id) the source did not
flag, and touching-not-connected findings: a pin on another Net's wire always
(every wire is re-routed), a pin on another Net's pin unless the source reports
the same pin pair, which fixed or locked instances keep.
`integrity.sourceDefects` lists the source's touching-not-connected pins: the
drawing looks connected where its netlist is not, which layout preserves, so
they are input defects and not regressions. Each split total has
`visibleIntegrity` with introduced counts, cases introducing each kind, source
defects and the raw human/result counts; the per-case table's `integrity`
column reads introduced dangling ends / unconnected pins /
touching-not-connected pins / label flags. An introduced dangling wire,
unconnected pin or touching-not-connected pin fails the run like an unsafe
problem; label ownership is reported only until it is calibrated.

## Netlist input

Automatic layout must also work from a netlist alone. `scripts/netlist-input.mjs`
turns each corpus drawing into the Project the editor would open from its
netlist: the top Document is exported with `createDesignNetlistExport`
(SPICE), imported with `importSpiceSources` after the editor's
`prepareImportSources`, and given the editor's `withImportedInstanceDisplays`.
The two editor steps live in `apps/editor`; `scripts/lib/import-display-bundle.mjs`
builds them into `tmp/netlist-input/.bundle/` with every `@icm/*` import left
to the built `packages/*/dist`, so conversion and evaluation run the same
package code. Nothing in this path changes the planner. One editor step is
left out: on install the editor materialises MOS bulk connections
(`materializeRazaviProjectBulkConnections`,
`apps/editor/src/document/use-project-file-lifecycle.ts`). The drawing-input
evaluation does not apply it to the corpus either, so both inputs keep the
bulk implicit.

Two forms are reported, because the planner knows different things in each:

- `vss`: ground is a pin of the top subcircuit (`groundPin: "pin"`, the
  design export's default). This is what the product's own design export
  gives back; ground comes back as a `VSS` port and is a rail only by its name.
- `global`: ground stays SPICE node 0 (`groundPin: "global"`), as a deck
  states it; the import gives it a `global-declaration` ground claim.

```bash
node scripts/netlist-input.mjs tmp/inputs/le10-input --form vss --jobs 6
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 6
node scripts/auto-layout-eval.mjs tmp/netlist-input/vss --reference tmp/inputs/le10-input --out tmp/auto-layout-eval/netlist-vss --jobs 6
node scripts/netlist-input-compare.mjs tmp/auto-layout-eval/netlist-vss/report.json tmp/auto-layout-eval/report.json
```

The conversion writes, per case, `<id>.meta.json` (stage `converted`,
`export-blocked`, `import-failed` or `threw`; error codes and first message;
the re-export verdict `identical`, `same-cards`, `differs` or `blocked`; the
electrical-graph verdict of source against import; pins the import nets that
the drawing does not, by device name and pin; added and lost Cell terminal
names; presentation counts of source and import) and, when it converts,
`<id>.sp` and `<id>.json`. Output is sorted and has no timestamps: two runs
give the same bytes whatever the job count.

With `--reference <folder>`, the evaluator plans and checks `<id>.json` of the
input folder and takes `<folder>/<id>.json` as the human drawing: `human`
metrics, with their symmetry components and stages, come from the reference;
equivalence, `integrity` (its baseline is the input's `visibleIntegrity`) and
the quick run stay on the input. Devices are paired by file id only, since
device ids differ. The partition oracle is unavailable, so there are no block
or arrangement metrics. Each case stores `reference`, the conversion meta as
`conversion`, and `railMarkersReference` (the reference's ground and supply
markers on rail Nets); the report names both folders in `netlistInput`.
`--out <dir>` sets the output folder. Exit criteria are those of a drawing
run. Every run, drawing input included, stores `netKindDetail` on each side:
bends per Net kind (the `netBreakdown` kind rule: rail, port, signal),
crossings with a rail Net on at least one side, and the ground and supply
symbols, ports, Net labels and power labels drawn.

`scripts/netlist-input-compare.mjs` pairs a netlist-input report with a
drawing-input report by file id and writes `compare.json` beside the netlist
report. Per split (dev, val, all) it reports conversion coverage by stage and
code; planner status, equivalence, floating and missing pins and warning
codes; human / drawing input / netlist input totals of crossings, bends, wire,
area, mean aspect and long-narrow layouts (aspect ≥ 2, and ≥ 2 with ≥ 1.5 ×
the human's), with netlist-against-drawing better/equal/worse counts; wire,
bends and crossings by Net kind and crossings involving a rail; symmetry and
signal-direction totals; the same totals by what the conversion lost (more
than one ground marker, a supply marker, label-joined Nets, pins netted only
in the import, pin contacts, none of these) and by the conversion's
electrical-graph and re-export verdicts; and every case failing an exit
criterion, classified as a hidden supply or control pin made explicit (every
pin concerned is one the import nets and the drawing does not) or other. The
paired table and the per-kind totals are printed twice: over all pairs, and
over the pairs whose import the electrical-graph check calls the same circuit
as the drawing (`electricalGraphEqual`), since a `different` or `uncheckable`
import may not be the drawn circuit. "Drawing completed, netlist not" splits
into cases that never converted and converted cases the planner did not
complete. A drawing report written before `netKindDetail` existed has no
per-kind bends (`null`); its crossings involving a rail are the rail entries
of `netBreakdown.crossingsByKindPair`.

Symmetry and signal-direction totals have different denominators per side.
`symmetry` and `symmetryStage` count the pairs and stages detected on the
Document a side was planned from (the drawing for the human side and for
drawing input, the netlist-input Document for netlist input);
`signalDirection` and `netlistSymmetry` are detected on each measured
Document itself. Compare each side's violations with its own opportunities.

Not comparable between the inputs, and so not reported as a difference:

| Metric                      | Reason                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| Label overlap and clearance | The import carries the default instance labels, not the drawing's labels. |
| Label ownership             | The import draws no Net or power labels.                                  |
| Drafting                    | Drafting objects do not survive a netlist.                                |
| `railMarkers`               | The import has no rail markers; see `railMarkersReference`.               |
| `sourceDefects`             | Measured on the netlist-input Document, not the drawing.                  |
| Refusal status              | A drawing refusal (for example R161 drafting frames) has no counterpart.  |

With `--presentation netlist` the evaluator passes `presentation: "netlist"`
to the planner (auto-layout R165), so the planner decides ground and supply
symbols before it plans:

```bash
node scripts/auto-layout-eval.mjs tmp/netlist-input/vss --reference tmp/inputs/le10-input --presentation netlist --out tmp/auto-layout-eval/netlist-vss --jobs 6
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/auto-layout-eval/netlist-global --jobs 6
```

Each case then stores `presentation`: the ground markers and supply symbols
the pre-pass added, the gate's verdict (`change`, `null` when kept), its
warning codes, and `reexport`, whether the planned Document exports the same
netlist text as the input in the conversion's form (`identical`, `differs` or
`blocked`). `equivalent` checks the presentation against the input with the
R165 gate and the plan against the presented Document with R10's partition
check, plus the electrical graph as before.

These are measurements, not an acceptability score: whether a netlist-input
layout is acceptable is judged by blind review.

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
