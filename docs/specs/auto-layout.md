# Analog auto layout

Status: `proposed`

Primary owner: `packages/auto-layout`

This contract defines pure structure recognition, template placement and bounded routing for one
Schematic Document. It consumes the existing [model](schematic-model.md),
[connectivity](connectivity-and-routing.md) and [typed edits](edit-engine.md).
The editor entry is specified in [editor-interaction.md](editor-interaction.md#automatic-layout)
(T014); locks are a later task.

## Experimental internal block partition

`AutoLayoutOptions.partition?: LayoutPartition` opts into hierarchical placement.
It is an experiment, not a persisted model field or UI setting. Omitting it keeps
the default planner unchanged. The source-independent contract is:

```ts
interface LayoutPartition {
  blocks: { id: string; title?: string; role?: BlockRole; members: string[] }[];
  flow?: string[]; // distinct block ids, left to right; omitted ids follow
  arrangement?: Record<string, { x: number; y: number }>; // relative centres
}
type BlockRole =
  | "bias"
  | "input"
  | "gain"
  | "output"
  | "load"
  | "cmfb"
  | "compensation"
  | "switch"
  | "logic"
  | "other";
```

Members are device instance ids; ports and rail markers are placed by the existing
marker rules. Unknown members, duplicate membership, empty/duplicate block ids,
empty blocks, invalid flow references and missing/nonfinite arrangement entries
are refused before edits. Omitted devices form an `other` block (with a fresh id
if needed). Its oracle centre defaults to the mean supplied centre. Recognition
units from `recognitionUnits` cannot span blocks: conflicting blocks merge transitively with
warning diagnostics. The first block id survives; conflicting roles become
`other`; flow references collapse and centres merge with member-count weights.
The input contract is never mutated. Greedy structures and persisted templates
alone do not merge blocks.

V1 (no `arrangement`) uses R130 stage ordering and compares a possible side row
with the estimator. `flow` is retained as partition metadata; it does not force
placement order. V2 retains the oracle floorplan: it scales oracle centres
uniformly by median local span / median pair distance, then resolves overlap
along the smaller overlap axis with an 80-unit gap. Snapped centres are first
restored to oracle order. Subsequent suffix translations in oracle coordinate
order preserve directional order (ties use block ids).
Finishing can cross block boundaries, with R131 charging the final routed score.
Parallel and driver attachment placement stays scoped to each block. Both quick
mode and seeded search support partitions. Routing, refinement, repairs, label
seating and transaction/electrical checks run through the existing pipeline.

The evaluation-only `partitionFromPlacement` starts with atomic recognition units and
joins devices on shared non-rail Nets when their positions are within a threshold
multiple of median device ink span (default 3, selected on dev), or both device bounds lie inside a drafting
rectangle. It derives flow from x order and centres from mean device positions.
These oracle coordinates do not enter V1. The LOADBench adapter reads functional
parts from `partitioning.xml`, maps device names to converted references/ids,
deduplicates repeated XML parts and merges overlapping labels before validation.

`scripts/auto-layout-eval.mjs` accepts `--partition human|loadbench|llm`,
`--variant v1|v2` and `--fixed-human` (all instances fixed, V3). LOADBench input is
a folder of converted project JSONs with matching `<stem>.partitioning.xml` files;
it has no human reference and supports V1 only. `--threshold` and `--split dev|val`
allow dev-only sensitivity probes. Outputs are git-ignored SVG/JSON/HTML files;
dashed role boxes are evaluation overlays only. Area ratio uses drawing view-box
width × height against the human; cohesion is summed pairwise block bounding-box
overlap area. Arrangement agreement is the share of block pairs matching all non-tied human
centroid directions on both axes; it is null when no pair has a specified direction. Report completion counts alongside metrics so refusals stay visible.

The experimental LLM adapter (`partition-prompt.ts`, prompt version 5) describes
only electrical device classes, symbols, pin-to-Net membership, explicit terminal
or label names, classified Net roles/rails, recognized structures and atomic units.
Canonical device ordering uses labelled topology refinement and individualization,
never placements or source ids. Anonymization substitutes `D1…` and removes display
names. Unconnected pins have `net: null`. Drawing annotations, routes, drafting,
references and group titles are excluded; recognized persisted template membership
is used by unit recognition. Prompt version 5 adds the `cross-coupled` and
`coupled-inductors` roles and a canonical `couplings` list with device members
and coupling coefficients; the key is absent when there are no couplings.
Listed couplings must stay inside one block. The package remains pure and offline.

The LLM returns `{ blocks: {id, title, role, units, reason}[], uncertain: string[] }`.
It groups indivisible units and names functions, with no flow, positions, floorplan
or block order. Omitted/uncertain units are completed by rules. Shape-invalid answers
receive one repair turn; graph-invalid groups are reconciled deterministically.
T026's human and LOADBench partition paths and optional `arrangement` stay unchanged.

`scripts/auto-layout-llm-partition.mjs <folder>` accepts `--split dev|val`,
`--limit n`, `--samples n`, `--anonymize`, `--max-usd n`, `--concurrency n` (default 6)
and `--dry-run`. Samples are zero-based. Dry runs do not construct a network client.
The environment variable `LLM_PARTITION_PROVIDER` selects the provider. The default,
`deepseek-flash`, sends the payload to `https://api.deepseek.com` over the OpenAI
protocol and reads its key from `SYSTEM_GENERAL_API_KEY`. `claude-opus-5-5` uses the
Anthropic SDK's credential resolution and retains its structured output. Both share
the one-repair scheduler. Cost uses the selected provider's
configured rates. Each attempt records serving model, stop reason and usage.
Caches in git-ignored `tmp/llm-partition/` hold successes, answers that failed
validation twice and refusals, keyed by
payload, prompt version, model, sample and anonymization. A response that stops at the
output limit or for another provider reason is reported as unavailable and is not
cached, so the next run asks again. Budget stops new calls
and repairs; already in-flight calls can overshoot. Unstarted calls are not cached.
Private cases, responses and credentials must never enter tracked files. Opus
runs real calls: tune on dev, freeze the prompt, evaluate val once.

The evaluator accepts `--partition llm --samples k` (default 3) and `--anonymize`.
It reads available shape-valid cached samples only; missing/failed entries are
reported and zero available samples explicitly selects rule-only completion.
LLM partitions support V1 only; V2 is refused because there is no LLM arrangement.
`--block-boxes on|off` controls title/role overlays: purple for LLM, blue for blocks
extended by attachment, grey for rules. Partition placement follows R130–R134; the router is unchanged.

`scripts/auto-layout-partition-report.mjs <folder> --samples k` writes git-ignored
`tmp/auto-layout-partition/report.json` and `index.html`, with final blocks on each
available human drawing. Per-document and dev/val totals include device-weighted
LLM coverage, check counts, provenance counts, pairwise sample ARI and final
consensus-to-sample ARI, plus planner L0 merge counts and diagnostics. T029 checks
completeness, unit integrity and non-rail/non-bulk block connectivity on the original
partition before planner validation. Planner merge warnings are reported, not rejected;
errors and broken T029 invariants reject the document. The planner validator merges recognition-unit splits only; reconciled partitions
therefore have zero planner merges. Missing units in a sample are individual singleton clusters.
LOADBench metrics use independent XML labels: ARI, reference block recall at
membership IoU ≥ 0.5 and role agreement among recalled blocks (best IoU match,
first final block breaks ties). These three metrics restrict final blocks to devices
labelled by the reference and drop empty blocks. Human overlap and floorplan metrics
still use the whole partition. Human overlap is pairwise block-box overlap area
divided by summed box area. Unavailable metrics are null, and failures remain
visible in completion counts. No offline test asserts real recognition targets.

## Rules

- **R1 — Boundary and determinism.** Take a `SchematicDocument`, its
  `SymbolResolver` and `AutoLayoutOptions` (optional fixed instance ids and
  R66 search options). Return
  `{ edits: SchematicEdit[], groups: RecognizedGroup[], diagnostics:
AutoLayoutDiagnostic[] }`. Fixed instances retain their exact placements;
  a collision with the template returns no edits and an R10 diagnostic.
  Obstacle-aware placement belongs to the locks task. Identical inputs produce byte-identical serialized edits. Break
  ties by instance id in code-unit order. Quick mode uses neither randomness nor
  time. With `search`, the same seed and evaluation budget produce byte-identical
  edits; only a deadline or cancellation that truncates the run may change the
  result. The PRNG is seeded and never uses `Math.random`.
- **R2 — Edits.** In Document order: (a) free every annotation anchored to
  a Route or by an object anchor to a Junction removed in (c), at its
  `fallbackPosition`, preserving all other fields; (b) `remove_route_geometry`
  for every Route; (c) `remove_junction` for every Junction left without a
  Route; (c2) restore frozen pin groups split by cleanup with `connect_endpoints`,
  joining one pin per extra component to a pin of the first component.
  Rejoin excluded MOS bulk and non-visible pins (`!isVisibleEndpoint`) with
  one edit per extra component that the visible-pin restoration did not join,
  including Nets composed entirely of excluded pins;
  (d) add layout groups; (e) transform instances in id order; (f) route
  by R11–R13; (g) transfer removed power-marker name claims by R12;
  (h) re-anchor labels by R15. Place tray instances; for placed
  instances emit rotation, mirror and movement in that order, only when
  changed. Preserve drafting content and style, annotation content/bindings, Net membership and
  existing layout groups. Never delete instances or reset the drawing.
  After selecting and facing the final layout, move compact, unlocked drafting
  labels with a clear source association. Match a nearby branch dot by the
  Net's terminal membership and unique visible branch, and attach the text
  to an incident conductor. A nearby device caption gets an object anchor.
  Prefer the source ink offset and check candidate seats against final symbol,
  wire, dot, label and drafting geometry. Distant or ambiguous free text
  stays at its authored position. Repeated layout treats captions attached to
  parts or recognized branches as moving ink during placement.
- **R3 — Content and limit.** Recognize NMOS, PMOS, resistors, capacitors,
  inductors (including compact), voltage/current sources, ground, VDD and
  port/filled-port markers. Other symbols, including hierarchy and multi-pin
  blocks, use the generic fallback. Above 120 instances return no edits and
  one `AUTO_LAYOUT_TOO_LARGE` diagnostic.
- **R4 — Net roles.** Each Base Net is supply, ground, input, output or
  internal. Supply comes from VDD claims/markers or supply Cell Pin/label
  names; ground comes from Ground claims/markers or ground names. Use the
  import shelf's supply, ground and output name regexes locally. A Cell Pin
  or voltage-source positive net reaching a MOS gate but no drain is input;
  a Cell Pin reaching a MOS drain or an output name makes an output. Other
  nets are internal. A grounded-negative voltage source supplies its positive
  net unless that net is input. On netlist input R165 uses the supply role to decide
  a supply symbol.
- **R5 — Recognition.** Recognize logical transistor branches (R80) by
  connectivity. D/G/S below also mean C/B/E for BJTs. A mirror reference has
  D=G and D≠S; include every compatible output with the same G/S and D≠G,
  D≠S. Two compatible reference branches on the same G/S are ambiguous and
  produce no mirror. Roles are `reference` and `output`.
  For each non-rail source Net and compatible family, remove candidates that
  are diode-connected, have D=S, or drive another candidate's gate through D
  or S. Exactly two remaining candidates with distinct D and G form a
  `differential-pair` with `input` roles. Three or more require the mirror-load
  evidence of R82; unresolved candidates are ambiguous. A tail is optional
  supporting evidence (R81). Finally, on compatible branches belonging to no
  mirror, pair or cross-coupled structure, retain the id-ordered matched rule:
  both diode-connected or shared G, and shared S or D, with `member` roles.
  R90 then recognizes anchored common-gate pairs outside those structures.
  Structures can overlap and recognition ignores persisted layout groups;
  R83 selects the movement units consumed by placement.
- **R6a — Power markers.** On each net, sort ground/VDD markers by id and
  prefer the host pin they touch in the input (R25), then pair the remaining
  markers with unused hosts sorted by device id, then x. Use one channel or
  two-pin-device terminal per host device: its lowest pin for ground, highest
  for VDD; never a MOS bulk pin. The marker pin sits at the host x, below for
  ground or above for VDD, with a 20-unit default stub up to 40 instances
  and a 40-unit default above that. A marker left without such a host, or
  that would share one, next takes an unused extra host (T127): one visible
  pin of each non-MOS, non-two-pin device on the Net (BJT, op-amp, block),
  sorted by device id then x, preferring a pin whose exit faces the rail,
  then the lowest pin for ground or highest for VDD. A pin whose exit faces
  away from the rail never hosts, and a MOS gate keeps its R43 join. Seat a
  facing pin's marker straight on its exit at one or two marker offsets; seat
  a sideways pin's marker one or two offsets out along the exit and one or
  two offsets toward the rail, nearest first, so one bend joins them. Take
  the first seat clear of devices and placed markers; with none, the marker
  is treated as a remaining marker. Remaining markers share the last channel
  host and are nudged by grid steps; without one they are unhosted, placed
  from the origin by grid steps.
  Fixed markers retain their poses. R165's netlist-input markers arrive
  unplaced, one per hostable device, and take hosts by these rules.
  In default mode with a nonzero search budget, at most 40 instances and no
  supplied partition, after routing and label finishing, try the 40-unit seat
  only for a marker named by a label-clearance, label-run-on or label-overlap
  diagnostic (including its labels).
  Keep the longer seat only if the named problem disappears and no routed
  guard increases, even when the finished calibrated score rises. Together
  with port label repair, cap trials at the number of diagnosed movable stubs,
  bounded by twelve, in id/host order. R154 local opening shares the twelve-trial
  cap. Reuse identical finished seat previews.
  R38 remains the authority for direct contacts; a shorter seat does not
  license coincident pins.
- **R7 — Templates.** Group members share y and reflect about a vertical
  axis, with the per-document member pitch (R154) unless R18 aligns a stack. Differential left/right mirrors are
  `none`/`horizontal`; tails lie on the axis one row toward the supply side:
  below n pairs and above p pairs. Mirror and
  matched left/right mirrors are `horizontal`/`none`. Place the diode side
  over the left differential member it feeds. Stacked groups share an axis. Two recognized differential pairs sharing one
  tail sit adjacent, with the tail centred between their axes (R32).
  Within an R88 component, the R89 block determines the member geometry.
- **R8 — Horizontal flow and Cell Pins.** Order ungrouped row devices by net
  distance from input. Place Cell Pins by R19 and R20, 80 units outside the
  device box. Left pins use rotation 0 and mirror `none`; right pins use
  rotation 0 and mirror `horizontal` to keep labels upright. Top/bottom
  rotations are 90/270. With MOS present, a two-pin device's lower pin takes
  the x of the drain it connects to one row below, when free.
- **R9 — Signal row.** A Document with no transistor channel constraint uses the
  horizontal signal-row layout: columns increase in net distance from input,
  or a grounded source's positive net when no input exists; column pitch is
  the per-document column pitch (R154). Grounded-negative sources stand vertically in the leftmost
  columns, positive up. Series two-pin elements with neither pin on power lie
  horizontally, lower-distance pin left. Shunts with one power pin stand
  vertically, in the column just right of their node's driver, below the row
  for ground or above for supply, signal pin toward the row. Multi-pin blocks
  sit on the row in distance order. A series element bridging two nets already
  reached by earlier columns lies horizontally one per-document row pitch above the row,
  centered between its net columns.
- **R10 — Validity.** Origins lie on the Document grid. Only a validated R38 direct contact may
  have coincident pins or intersecting interaction padding; device interiors stay apart. With no fixed instances, translate the whole layout by
  `(snap(oldBox.x - newBox.x), snap(oldBox.y - newBox.y))`, where `snap`
  rounds to the Document grid and boxes are visible-instance envelopes.
  Fractional envelope edges leave the resulting corner within half a grid
  step of the old corner. A direct contact separated by placement is drawn
  by R11–R13 like any other connection. Before returning, replay the complete
  list with `dryRun` on the input. Require transaction acceptance and the same
  Base Net partition for every original terminal, using
  `deriveElectricalTopologyProjection`. R155 may add ground/supply terminals
  only to a Net with the same existing marker symbol and explicit name, or an
  existing power-marker-owned name claim authorizing its ground/supply domain.
  Otherwise return no edits and an R10
  diagnostic. In plain planning with at most 40 instances, R150 can try
  moving unlocked drafting with its owners, retaining the following behavior
  as its fallback. Locked drafting always remains an obstacle. In the fallback,
  if placed device bounds grown
  by 60 units on every side intersect any drafting bounds, translate the
  whole layout down by grid steps until clear, never up or sideways.
  No input Route id survives.
  During cleanup, temporarily free unlocked device-anchored labels that own
  Net name claims, then restore their anchors after restoring frozen pin groups.
  A transient split must not reassign a label's name to another pin of its device.
- **R11 — Routing set.** Before any edit, freeze pin groups per input Base Net
  with `deriveElectricalTopologyProjection`. Exclude MOS `B` pins, non-visible
  pins (`!isVisibleEndpoint`, including variant `hiddenPinNames` and base
  pins with `implicit` visibility), and pins of instances unplaced in the
  result from physical routing targets. Route frozen `target: { kind: "pins",
pins }` lists, never Net ids. `planRouteNet` groups the frozen pins by physical
  component (Routes and contacts); a label-only connection never counts as joined.
- **R12 — Power.** Each ground/VDD marker gets one straight stub to its R6a
  host pin at the selected distance; an accepted R38 contact needs no stub.
  An R6a extra host gets the stub only while the marker sits on one of its
  seat shapes in the routed geometry (straight on a facing exit, or out along
  a sideways exit and toward the rail, each leg at most two marker offsets);
  otherwise the marker takes the stub to the last channel host it shares
  under R6a, or without one is a remaining member under R43. Plan a seated
  extra host's stub from the host pin, so it leaves along the pin's exit and
  turns once.
  Singleton power stubs and R43 trunk offsets use the same document-size
  marker default.
  R43 connects every remaining visible non-bulk rail member through a
  horizontal trunk, including one marker host to join the marker's drawing.
  If the trunk is refused or incomplete, compare a plain tree under R86.
  Members that all share one column have no span for a horizontal trunk and
  join by the plain tree alone; never widen a trunk past its outermost members.
  After finishing, R155 may replace a crossed trunk with named local marker
  trees on documents of at most 40 instances.
  A supply or ground Cell Pin joins its Net through a trunk, with the Cell Pin on it.
  A grounded source driving a passive chain has a supply role under R4 but is
  routed as a signal, so it gets no trunk.
  Re-upsert each name claim owned by a removed Route/Junction power marker
  with the same id, name, scope and powerDomain, using the frozen group's
  current Net id and its trunk Route as owner, or its longest new Route.
  When an object-anchored bound label presents a removed power marker's claim,
  move that claim to the surviving annotation during cleanup instead; retain
  that owner after routing so its semantic name and RichText override stay valid.
  A singleton power Net receives the R26 stub when its claim needs a new owner;
  without a clear replacement Route, leave R10 as the guard. This preserves supply-bound
  MOS bulk membership when the old rail and its naming authority are removed.
- **R13 — Signal order.** After power, route Nets touching recognized groups,
  pair members before mirrors, then the rest by their lowest instance id.
  All pins of one Net go into one `planRouteNet` call. This is the first
  pass; R95 may reroute signal Nets afterwards.
- **R14 — Fallback.** Catch each `planRouteNet` failure independently. Keep
  other Nets' routes and the failed Net's unrouted electrical membership.
  Draw a partial Net's reachable components too. Report one
  `AUTO_LAYOUT_NET_UNROUTED` warning as `Net <id>: <router reason>; pins: <pins>`,
  preserving the router's reason verbatim. A partial Net lists only unjoined
  component pins; a completely failed Net lists all its target pins. For an already
  named Net, add one `net-label` per unconnected pin group, on a short stub
  from one pin, bound to the existing Net name. An unnamed Net receives no
  labels: never invent a name that would change the netlist. R155's additional
  ground/supply markers are a separate successful-layout optimization; they
  also require an existing explicit name and marker of the same symbol.
- **R14a — Delivery gate.** A finished plan is delivered only when
  `missingConnections === 0` and `floatingPins.length === 0` on the Document the
  edits produce. When a clean finished candidate exists it wins over a defective
  one whatever the score says; when none does, the plan returns no edits and one
  `AUTO_LAYOUT_CONNECTION_REFUSED` error (rule R10) naming the unconnected Nets
  and floating pins, with the R14 `AUTO_LAYOUT_NET_UNROUTED` warnings kept on
  the same result so the router's reason stays legible. The gate is on the
  output, not the input: an input drawing that already carries an undrawn Net
  may still plan and be delivered when the planner draws it.
- **R15 — Labels.** After routing, each freed net/power label moves to its Net's
  longest horizontal leg with a route anchor at `t: 0.5`. Preserve the original
  route anchor's `normalOffset`, `direction` and `orientation`; otherwise use
  `normalOffset: -10`, `direction: "forward"`, `orientation: "horizontal"`
  to place the text above the wire. Without a horizontal
  leg it stays free at the nearest pin of its Net. Preserve id, content and
  binding. If whole-list replay invalidates a preview Route/leg id, keep that
  label free instead of emitting a broken anchor.
  Round persisted midpoint fallback coordinates to integer page units; keep
  `t: 0.5` for the precise derived position on the leg.
- **R15a — Net and power labels follow their Net.** Once the plan is
  selected and finished (after R155 local rails, drafting-owner recovery and
  R162 body leads), judge every visible, unlocked free or route-anchored
  `net-label`, and every such `power-label` (text naming a rail drawn without
  a power symbol; a power label anchored to a ground or `vdd-port` marker, or
  to an instance owning a `power-marker` name claim on the label's Net, is
  that marker's caption and is not judged), on the final drawing by the label-ownership measure
  (`label-ownership.ts`, shared with the evaluation's visible-integrity
  report): it reads as its Net's when a wire or pin of its Logical Net comes
  within one grid of its ink box (two grids for a power label, whose text a
  rail's end conventionally has a grid clear of it) and no other Net's wire or
  pin is strictly closer. A power label's own Net is the rail Net its claim
  names (its `netId`). A label that reads as
  its Net's keeps its place, and so does one whose source drawing already
  misreads (an R14 label the planner added has no source and is judged on the
  result), one a layout group or constraint lists in `objectIds`, and a bus
  selector (a `net-name` binding with `memberEndpoint(s)`), which stays on the
  branch Route it selects from. A label names one drawn piece of its Net: the
  physical component its Net-label binding resolves to (its anchor Route, or
  for a free label the nearest wire of its Base Net, else the nearest pin), as
  ERC reads it. A Net drawn in pieces joined only by name needs its label on
  each piece, so the label may only move to a seat that names the same piece:
  the piece the source label names, found in the result by the pins it joins
  (an R14 label: the piece it names on the result). When the layout splits
  that piece and the label names one of the result pieces now, it stays on
  that one. Any other label moves to
  the best clear seat on that piece: route anchors at `t` 0.5, 0.25, 0.75, 0.1, 0.9 and
  every grid step (at most 24) along every leg of at least one grid of its
  Base Net's wires on that piece (another Base Net joined by name is another
  piece), on either
  side, in the reading directions of its rotation (0 or 270; other rotations
  keep their place), and free seats beside, over or under each of its pins on
  that piece within one grid. An upright power label beside a horizontal leg
  takes its offsets from its own measured ink: the same clearance over or
  under the wire as a Net label's ink over it. A seat is rejected when it
  names another piece, fails the
  ownership measure, or its ink meets another label, free text or a part's
  symbol; and a seat with a wire drawn across its text (the clearance
  model's `struck` wires) is rejected when the label's current place has
  none. Among the rest prefer, in order, fewer wires drawn across the text;
  fewer other labels within one grid; for a power label, the outer side of
  its rail (above a supply rail, below a ground rail as its claim's
  `powerDomain` says; a seat by a vertical leg has no outer side); a seat of
  the same kind as in the
  source (by a pin when the source label's nearest own feature is a pin, by a
  wire otherwise); the least distance from the final position of the pin of
  the source label's piece nearest its ink, or, without a source label or
  such a pin, from the label's current position; then candidate order.
  Accepted seats update the clearance context before the next label (id
  order). Without a seat the label stays. The step changes only annotation
  anchors and alignment, never wires or parts, so it cannot change the
  selected layout. It is skipped for a plan with errors and after a stopped
  search (aborted signal or passed deadline); it stops adding seats at the
  transaction edit limit, and when the final replay of the plan with its
  seats fails, the plan is returned unchanged. A seat is judged on the
  finished drawing but written into the plan's edits, where the engine reads
  its leg on the Routes as the edits draw them and only at the transaction's
  end rejoins each Net's Routes at their junctions, keeping the label at the
  conductor point it read; rejoining can give a leg id to another segment or
  the leg to another Route id. A route seat is therefore written against the
  drawn Route (the source's, redrawn by `set_route_path`; one another edit
  makes, such as a split half, as the finished drawing has it) and leg of its
  Net
  that holds its point; a route seat no drawn leg holds is not taken. The engine stores each drawn
  Route normalised (collinear and zero-length legs merged), which this does
  not follow; so after the final replay every written label is measured on
  the replayed drawing, and if any label's Route leg does not resolve or its
  ink box lies more than half a unit from where it was judged, the plan is
  returned unchanged, as for a failed replay.
- **Marker stubs and drafting.** A marker stub is one wire between exactly
  the marker pin and its R6a host pin, planned with clearance checks, so
  markers sharing a host are never wired to each other. The router does not
  know drafting objects: a Route that crosses one is reported as an
  `AUTO_LAYOUT_DRAFTING_OVERLAP` warning.
- **Name claims.** Every input `name-claim` must survive with its name, scope
  and power domain; the partition check cannot see a lost name. A claim that
  cannot move to a new Route of its Net makes the planner return no edits and
  an R10 diagnostic. Fallback stubs use clearance-checked planning; a pin with
  no clear stub stays an unrouted member, already reported by R14.
- **R16 — Edit limit.** A complete list exceeding
  `MAX_SCHEMATIC_EDITS_PER_TRANSACTION` returns no edits and an R10 diagnostic.
- **R17 — Diagnostics.** Every diagnostic has severity `error` or `warning`.
  Only an error means no edits. All diagnostics predating R14 are errors.
  R14a's `AUTO_LAYOUT_CONNECTION_REFUSED` is an error of that kind: a caller
  that reads an empty edit list as "nothing changed" sees the drawing
  untouched, and the error says why.

- **R18 — Pin-aligned stacks.** Stacked groups share vertical channel pin
  lines. Derive pitches from each pin's local `x` after orientation; the smaller
  pitch is the per-document member pitch (R154), the other follows, both on
  grid. Unstacked groups keep that member pitch. A tail's shared channel pin lies on the axis. PMOS above NMOS
  sharing a drain align drain pins rather than origins. Read oriented `pin.at`;
  never encode a symbol or pin offset.
  Outside stack groups attach to R89 block channel columns as one alignment unit.
- **R19 — Cell Pin side.** Inputs and outputs use the left or right edge nearest
  their host pin, measured from the device bounds' centre. Exact ties put inputs
  left and outputs right. Supply and ground stay top and bottom.
  R146 may replace a non-rail port's initial seat after routed comparison.
- **R20 — Port spacing.** Keep a Cell Pin level with its host. If two on one side
  are less than 40 units apart, move the one whose Net has more pins away from
  the other; a tie moves the later id. Its wire can tap elsewhere.
  This spacing applies to the initial edge seats and R146's edge fallback.
- **R21 — Orientation by wire cost.** An instance without a template-fixed
  orientation chooses between `none` and `vertical` for a multi-pin block, or
  its two pin-to-pin flips for a two-pin part where R9 allows both. Minimize
  half-perimeter wire length across its Nets given other placements; ties keep
  the first option. Make two passes in id order.
- **R22 — Refinement by routed and readability cost.** Score each complete final preview as
  `unrouted × 10000 + crossings × 1000 + offConvention × 300 + bends × 100 + wireLength / 10 + labelOverlaps × 400 + labelClearance × 150 + terminalDepartures × 200`,
  with named weights, plus R74's frozen readability term through 40 instances.
  Through 40 instances, compare floating pins plus missing physical connections
  lexicographically before this soft score: a larger total cannot win, regardless
  of readability weight. Equal totals use the score; differences below 1e-9
  score units are ties to avoid rotated-geometry roundoff changing the winner
  when a constant drafting cost is added. `unrouted` counts missing physical connections: for each
  Base Net, the number of physical components among non-bulk symbol pins minus
  one, summed (R86). Through 40 instances, remove the position-based
  `offConvention` proxy; the frozen composite measures global input/output
  port order. Above 40 instances retain the legacy facing penalty of 300.
  In id order, try flipping one left/right Cell Pin side or one
  R21 orientation (R163's draft has none; it gets side flips only). Replan
  fully, discard candidates with error diagnostics,
  accept the best strictly improving move, and repeat for at most two passes
  and 24 evaluated candidates total. Fixed instances never move. If all
  candidates fail, retain the default. Identical inputs give identical results.
  R96 replans the selected finalist with R95 after refinement.
- **R23 — Audit guard.** Audit the final preview. A Route crossing an Instance
  or Routes of different Nets overlapping returns no edits and an R10 error
  naming the objects. Drafting intersections remain warnings.
- **R24 — Placement collisions.** For coincident pins or overlapping instances
  that no template pins together, move the later id along its row or column in
  grid steps, up to 40 steps. Refuse only if this fails; fixed/template conflicts
  retain their existing rejection protection.

- **R25 — Touching pins stay joined.** Pins coincident in the input on one
  frozen pin group remain physically joined. A ground/VDD marker uses the pin
  it touches as its R6a host before id-order pairing. Any other touching pair
  on any Net left unjoined by placement becomes an additional exact,
  clearance-checked stub target. Exclude MOS `B` pins. This prevents transform
  reconciliation from adding an unchecked straight Route across other Nets.
- **R26 — Single-pin power Nets.** A power Net with one routable pin and a
  name claim owned by removed geometry receives one clearance-checked 40-unit
  stub, up for supply and down for ground. Transfer the claim to the stub Route
  under R12 and its label under R15. If no clear stub exists, refuse under R10.

- **R30 — Net levels.** Devices constrain Nets vertically: NMOS D above S,
  PMOS S above D, and source + above -. Two-pin passives with a rail
  pin point away from that Net. In Documents of at most 40 instances,
  two-pin R50 DC-conducting devices between non-rail Nets also receive the
  R151 inferred direction; other passives add no constraint. The size bound
  uses the original Document, including when placing one stage or folded half.
  Supply rails are forced to the top and ground rails to the bottom when present;
  neither is required. Levels are longest paths. Break cycles deterministically
  by dropping back edges in id-ordered depth-first search. Missing supply never
  makes a constrained Document fall into one signal row.
- **R31 — Rows and orientation.** A device whose channel terminals have
  different levels occupies its upper Net's row, vertically. Two-pin parts
  on one level lie horizontally in that row. Gate and block input Nets only
  pull order and columns. Multi-pin blocks occupy their output Net's row.
  BJT channels use collector above emitter for NPN and emitter above collector
  for PNP, parallel to MOS channel levels.
  R153 overrides unrelated Net levels for eligible signal-series passives.
  Row pitch follows the original document size under R154. With no transistor channel constraint, R9 is unchanged.
- **R32 — Order.** A recognized group is one node, with adjacent symmetric
  members. A vertical channel chain may stay together. Seed rows by signal
  distance; sweep barycentres down and up over Nets spanning adjacent rows,
  keeping the fewest net crossings. At most eight sweeps; ties use signal
  distance then id. Pairs sharing a tail sit adjacent and centre the tail
  between their axes, replacing the R7 refusal.
  R89 replaces component members in each row with one contiguous block node.
- **R33 — Columns.** Align shared channel pins (R18), longest chains first,
  in the spirit of Brandes–Köpf. Other devices move toward the median of
  neighbours' pins subject to order and a 40-unit gap between instance bounds.
  Group symmetry takes priority over median alignment.
  R89 block offsets enter compaction as one alignment component before stack links.
- **R34 — Scale.** The instance limit is 120. R22 evaluates at most 24
  candidates per strategy up to 40 instances, eight from 41 to 80, and zero above 80 (R42).
- **R35 — Small cases.** R7, R8 and R18–R26 still apply. Every corpus target
  and explicit geometry assertion must continue to hold.

- **R36 — Strategy portfolio.** Up to 40 instances, refine both the T013
  template placement restored from `309a368` and R30–R33 independently under
  R22. Select the lower routed score; ties retain the template plan. Above 40
  instances use layered placement only.
- **R37 — Rails.** R30 uses only explicit VDD/Ground claims or markers,
  supply/ground Cell Pins, or R12's supply test with at least two MOS D/S pins.
  A grounded source driving passives is not a rail. Use R9 unless a transistor
  channel constraint exists.
- **R38 — General contacts.** R25 applies to every Net. Any two non-bulk pins
  touching in the input on one frozen group receive an exact, clearance-checked
  stub unless they remain touching. Replay reconciliation has no missing
  contact to materialize. If whole-list replay materializes an unsafe dashed
  wire for a separated visible MOS bulk contact, replace that implicit wire
  with a clearance-checked authored wire between the same terminals and replay
  again. Ordinary bulk pins remain excluded from the routing set. If the
  bounded repair cannot complete, the R10 audit still refuses the layout.
  Default search can close an axial gap between a facing
  pair on the same explicitly declared Base Net: an input contact, or the two
  device terminals of a two-pin group. Only visible scalar endpoints qualify.
  Preserve rigid groups, reject other overlaps, and require the two symbols
  to meet at the actual pin point with their bodies on opposite sides. Route
  once per shared landing; a branch may meet its peer only at its endpoint.
  Try at most four routed alternatives and keep the incumbent on regression.
  The axial-gap search runs only up to 40 instances; each alternative is a
  full replan, which tripled planning time on large documents.
  Locked poses can retain an already-safe contact without exploring moves.
- **R39 — Signal trunks.** For signal Nets with at least three routable pins,
  compare the existing tree, a horizontal trunk spanning the pins at median y,
  and a vertical trunk at median x. Try the horizontal trunk only when pins
  span distinct x coordinates and the vertical trunk only when they span
  distinct y coordinates. Discard candidates that throw. Minimize
  unjoined components, then proper crossings with previously planned other
  Nets, then bends, then length;
  ties retain the listed candidate order.
- **R40 — Order objective.** Sweeps include same-row Net spans and virtual
  positions in every intervening row for long Nets.
- **R41 — Integer geometry.** Round points computed by rotation or mirroring
  to integers before using them in placement, trunks, taps or stubs.
- **R42 — Refinement scale.** R22's candidate budget is 24 per strategy up to
  40 instances, eight from 41 to 80, and zero above 80.

- **R43 — No floating rail pins.** Every visible non-bulk rail pin is drawn
  connected. Non-visible pins retain electrical membership without drawn
  wires. Pins with their own marker keep their stubs. All remaining visible
  non-bulk rail pins join one horizontal trunk above the device rows for
  supply or below them for ground, together with one marker host. This applies
  to both strategies and
  every rail size. Only R155 may add marker instances and replace this trunk
  with local trees; R165 adds ground markers before planning, on netlist input
  only. A refused or incomplete trunk gets a
  tree fallback under R86. Remaining failures produce R14 warnings naming
  the affected pins. A floating pin is the sole visible non-bulk pin in its
  physical component while its Base Net has other visible non-bulk pins.
- **R44 — Routing alternative.** After R36 selects a plan, replan its placement
  and refinement choices once with R39 disabled, without another refinement.
  R96 replans the selected finalist with R95 after R72 repair. Keep the lower
  R22 completeness-first comparison including the frozen readability term, retaining the selected plan on a tie. R97 then compacts
  only the R44 winner.

- **R50 — Stages.** A stage is a connected component of devices joined on a
  non-rail Net through DC conducting pins: MOS D/S, BJT C/E, and both pins of
  resistors and inductors. Gates, bases and capacitors do not conduct. Recognized
  group members always merge into one stage. Devices touching only rails or
  non-conducting pins, including blocks without channel pins, form their own
  stages. A capacitor joins the stage at its non-rail pin, or bridges two stages
  under R53.
- **R51 — Stage layout.** Lay out each stage independently with R30–R33 in
  local coordinates, preserving templates, symmetry and shared-pin alignment.
  R94 joins every R145 stage component in default mode (R88 component with a
  partition) into one stage and uses the shared R89 layout.
- **R52 — Stage rows.** Stages share rails. Align a stage's top row with the
  supply when it touches one; otherwise align its bottom row with ground when
  present. Centre a stage touching neither rail.
- **R53 — Stage order.** Seed left-to-right order by increasing signal distance.
  Minimize R54 using adjacent swaps, moving one stage to any position, and
  horizontally mirroring one stage unless a group forbids it. Repeat until no
  move improves, for at most five passes. Ties retain the earlier order. A
  capacitor bridging two stages sits between them, level with its pins.
- **R54 — Fast estimate.** Without routing, build a Manhattan minimum spanning
  tree of each non-rail Net's non-bulk pins. Draw each edge as a horizontal-first
  L path. Count proper crossings between different Nets, plus total Net length
  divided by 1000 as a tie-break. This estimate is pure, deterministic and fast
  enough for thousands of calls on 120 instances.
- **R55 — Stage portfolio.** Stages join R36 as a third strategy at every size.
  Up to 40 instances, compare all three strategies by real routing. Above 40,
  compare stages and layered by real routing without refinement (R163 adds a
  fourth draft for its subset). Keep the lower routed score,
  retaining the earlier strategy on ties. Run R44 once on the winner. This
  supersedes R34, R36 and R42's strategy and large-document refinement budgets.
- **R57 — Signal direction.** After R53, compare the mean x coordinates of
  input and output Cell Pins' host pins. If inputs lie to the right of outputs,
  reverse the stage order and mirror each stage where group handedness permits.
  With no input or no output hosts, keep the order. This remains the stages
  strategy's existing correction. T074 removes the T073 template/layered
  mirrored-draft comparison and correction after a dev-only ablation improved
  the frozen composite. Template/layered drafts retain their original direction;
  complete strategy/refinement candidates still use R22's readability term.
- **R58 — Finish the top two.** Route each eligible strategy once without
  refinement and rank by R22's completeness-first routed score. Up to 40
  instances, refine the top two independently, reusing their initial routed
  plans, with at most 14 candidates each. The lower refined score (ties retain
  the higher-ranked strategy) remains the starting point for R66's annealer.
  Preserve that existing finished result as the fallback. Also finish the other
  distinct, physically complete refined finalist, without repeating refinement
  or annealing. K is two; an incomplete runner-up or one with identical
  instance placements adds no search, even if its routed edits differ. For
  equally complete finalists, skip the runner-up when its provisional R22
  score exceeds the winner's by more than min(55% of the winner's score,
  12,500). This dev-calibrated margin bounds extra finishing work; improved
  completeness takes precedence over the score margin.
  Each finalist retains the existing finishing budgets and order: R72 repair,
  R96 rip-up, R44 routing comparison, R97 compaction, cross-coupled routing,
  facing, crossing reroutes and contacts, R147 relocation, R146 ports, R148
  rails, R149 gaps, finished crossing polish and stack repair, R167 pin jogs,
  branch columns and stub-label repair, label/drafting
  finishing, and finally R155 local rails. Quality modes retain their existing
  eligibility rules for each pass. Share per-call routing and finished-seat
  caches, but copy mutable finalist results and reset per-finalist budgets.
  Compare only after the outer pitch/series/drafting passes and local rails
  have completed, using R22's shared comparator; ties keep the fallback.
  Accept the other finalist only if its frozen readability composite, floating
  and missing counts, and every visual diagnostic except label clearance do
  not increase. A weighted readability metric with zero violations in the
  fallback must remain zero: a percentage allowance cannot admit a new kind
  of violation from a zero baseline. Cancellation/deadlines retain the completed fallback. Explicit
  zero-evaluation quick planning and above-40 planning retain their previous
  selection and finishing sequence. Above 40, R55's unrefined comparison and
  single-winner R44/R96/R97 behavior remain unchanged.
- **R59 — Attached parts.** A single-device stage with one non-rail Net and a
  rail pin (a shunt capacitor, load or bias resistor) takes no separate column.
  Place it next to its Net's host pin in the host stage's span, below for ground
  and above for supply. Widen the host stage only when necessary. Rail shunt
  capacitors attached under R50 follow the same rule, extending R9 to stages.
  Keep the vertical rail escapes of hosts and attached parts clear of other
  parts, including prior attachments; seek another x before widening the stage.
- **R56 — Stage spacing.** Keep at least 80 units between stage bounds. A
  bridging capacitor adds its own width to the gap. Compact gaps to avoid sprawl.
  R97 may narrow a stage gap after routing, never below `2 × MARGIN` (40 units).

- **R60 — Device-class conduction.** R50 classifies devices with the device
  registry. Resistors, inductors and diodes conduct through their main
  terminals. Switches do not conduct yet: a merged switch network has no
  channel levels under R30, packs into one row, and drew with more crossings
  than single-switch stages. Capacitors, including variable capacitors,
  remain bridges. MOS D/S, BJT C/E and source
  behavior are unchanged. Drawn magnetic network definitions supply the
  winding pairs: a transformer joins devices within each winding, never across
  the isolation boundary. Its artwork belongs to its primary winding's stage.
- **R62 — Rail Cell Pin clearance.** Place top and bottom Cell Pins outside
  the device span in x. On each Net, put the first pin in routing order nearest
  the devices and stagger subsequent pins outward. The trunk can then end at
  its first Cell Pin without passing through its artwork or through duplicate
  Cell Pins at the same level. This is a placement rule; routing is unchanged.

- **R63 — Distinct, repairable portfolio.** Compare valid initial edit lists
  exactly, keeping the first equal list in `template`, `layered`, `stages`
  (then R163's `feedback-rows` for its subset) order before ranking by the
  existing routed score. R166 adds stack-aligned candidates, R168 adds
  `convention`, and R171 then offers `mcts`. A refused run returns no
  edits, so refused runs are never treated as duplicates. Refine at most two distinct strategies
  through 40 instances, reusing their initial routes. If fewer than two valid
  distinct candidates exist, a refused candidate may fill the second slot; if
  all are refused, refinement may repair the first candidate. Retain R58's
  ranking ties and R44's single routing alternative per finalist. Above 40 instances keep
  R55's unrefined comparison: R61 was removed because round 1 measured no
  meaningful quality benefit for its extra planning time.

- **R66 — Bounded annealing.** By default use seed 1 and at most 24 additional
  routed evaluations through 30 instances (including ports and markers). For
  31–40 instances use `max(2, floor(24 * (30 / n)^3))`, where `n` is the
  instance count; above 40 retain two. Optimized and partitioned planning keep
  eight through 40 instances. These are candidate budgets, not time limits.
  R146–R149 retain their finishing-trial caps through 30 instances. For 31–40
  instances scale each cap `b` to `floor(b * (30 / n)^3)`: R146 uses `b=12`,
  R147/R149 share `b=10`, R148's marker-seat search uses `b=8`, finished crossing
  polish and stack repair use separate caps of `b=10` and `b=8`, and R167 uses
  its own `b=12`.
  For example, 40 instances permit ten annealer evaluations, four shared
  relocation/gap trials, five port trials and three marker-seat trials. Rail
  rerouting retains its separate cap. Explicit `search` overrides only the
  annealer and takes `seed: number`,
  `evaluations: number`, `deadline?: number` (epoch milliseconds),
  `signal?: AbortSignal`, and
  `onProgress?: (p: { evaluations: number; best: number; current: number }) => void`.
  The evaluation budget is a nonnegative integer counting additional complete
  candidate plans, including refused candidates and the final R44, after quick
  mode. Start at R58/R63's winner and retain the other valid strategies as
  alternative starts. Keep the completed quick result as the score ceiling.
  Search device placements, orientations and Cell Pin sides using rigid same-row
  node swaps, grid/column shifts, ungrouped mirrors, stage block moves, swaps,
  reversals and mirrors, and Cell Pin flips. Templates, tails and aligned stacks
  move together; a stage containing a template cannot mirror.
  R94 adds symmetric blocks to rigid units and finishing validation. Reject off-grid,
  fixed, overlapping or coincident-pin states before routing. Placement finishing,
  routing, replay, R10 and R23 use the quick planner's existing path. Refused
  candidates have infinite energy. R22's named routed-score weights are shared.
  Rank four proposed moves by R54 and route the best estimated proposal; this
  pre-filter was retained after equal-budget dev comparison. Calibrate initial
  heat from at most 16 sampled positive deltas for approximately 50% uphill
  acceptance. Cool geometrically to 0.1% of that heat within the first 256
  evaluations (or the smaller evaluation budget), retaining the low heat for
  the remaining budget and the best state ever seen. Every 64 evaluations,
  restart at the incumbent (75%) or another valid strategy (25%). Apply R44 once to the best search placement, within the budget
  and remaining time, retaining quick mode on a tie. Cancellation returns the
  valid best so far. A synchronous full plan cannot be interrupted midway;
  deadline checks reserve time for finishing and the routing alternative.
  After repair, R96 replans the search's final best with R95; annealing energy
  evaluations do not rip up. R97 then compacts only the R44 winner. A zero
  evaluation budget equals quick mode (evaluator: `--quick`). Compare both
  finalists after repair, compaction and facing. Retain quick on a score tie,
  any increase in missing connections or floating pins, or a strictly dominated
  wire layout at equal connectivity (crossings, bends and wire length; include
  block intrusion for partitioned placements).

- **R67 — Bounded offline span.** Use the completed quick result's bounding
  box of all instances, including markers, as the search reference. Reject
  proposals before routing when either dimension exceeds 1.5 times its quick
  dimension; this also satisfies the looser 1.5-times-plus-two-column-pitches
  limit. Check both raw proposals and the shared placement finishing result.
  Anchor finished search placements at the quick box's top-left corner, snapped
  to the Document grid. Reject anchoring that would move a fixed instance or
  require a further drafting-clearance translation. Translation alone therefore
  cannot accumulate in accepted states. Keep the routed energy unchanged.
  Evaluation reports include rendered layout width/height sums, each document's
  width/height ratios against its actual quick result, their maximum, and
  instance span ratios for checking this rule.

- **R68 — Driver and cross-coupled pairs.** Use R80 branches and families.
  A branch whose D or S drives another candidate's gate is excluded from
  differential-pair candidacy. Two compatible non-diode branches with mutual
  gate-to-drain or gate-to-source connections form a `cross-coupled-pair`
  with two `member` roles. A branch with multiple such partners is ambiguous;
  neither it nor its partners forms an arbitrary cross pair. R83 maps the
  structure to the existing symmetric `matched-pair` movement unit and
  persisted kind; no model schema change is needed.

- **R69 — Parallel attachments.** A two-terminal device whose distinct Nets
  exactly match a MOS's drain and source attaches to the first matching MOS by
  id. In all three strategies, place it beside the channel, away from the gate,
  rotate its pins to match the drain/source levels where the symbol span allows,
  and otherwise align the pin midpoint. Search outward on the grid for clear
  artwork. This is a placement unit, without a persisted group. Collision
  repair and R66 translation moves carry the attachment with its host; stage
  moves merge intersecting units and cannot mirror a parallel unit.

- **R70 — Gate-driver attachments.** Extend R59 with stages of at most three
  devices whose sole non-rail link to other devices reaches only gate or
  control pins of one receiver. Translate the whole stage onto the receiver's
  pin-exit side, aligning its first output pin with the receiving pin, leaving
  60 units of body clearance. Place upstream attachments after their receiver
  stage. Apply the same finishing rule in template, layered and stages
  placement. A device overlap or fixed member leaves the stage in place.

- **R156 — Local-loop amplifier attachment (T077).** In a document of at most
  40 instances, a multi-pin signal block with one output and at least one input
  forms a local-loop placement variant when its non-rail output Net reaches one
  or more gate/base/control receivers, directly or through at most one two-pin
  passive (direct receivers take precedence over passive output loads; an
  indirect path must identify one unambiguous control Net), and at least one
  input senses a non-rail conducting terminal of a receiver or of a device in
  its rail-cut DC branch. Recognition uses only connectivity, pin roles and
  device class (R50 conducting pairs; never through control terminals,
  capacitor feedback or rails). Seat the block on the receiver group's
  control-pin side, output facing the gate line, anchored on the nearest
  receiver gate and clear of the whole receiver bank, with the optional series
  passive between output and gate moving as one unit; keep R70's 60-unit
  clearance and the grid; choose the input reflection nearest the sensed
  terminals. Fixed, template, symmetry-block and layout-group members are not
  moved; a protected member or a collision keeps the old placement. The
  variant never replaces a strategy's draft: it is an additional finalist in
  the finished selection (T078, same margin rule and comparator), so a variant
  that finishes worse is never returned. Large documents are unchanged.

- **R157 — Node attachments (T079).** In a document of at most 24 instances,
  two-pin parts and single-device stages whose non-rail connections reach one
  host node, or bridge two nodes of one host, form an attachment placement
  variant (connectivity and pin roles only): each is seated beside the served
  pin on its exit side, oriented along the pin, at the nearest free grid seat
  with body clearance; a bridge part sits between its host nodes; rail pins
  face their rail side. Fixed, template, symmetry-block, layout-group members
  and explicit partition arrangements are not moved; a blocked seat keeps the
  old placement. The variant is an additional finished finalist, after the
  T078 runner-up and the R156 local-loop finalist (which keep their own slots,
  full budgets and gates). It is finished only when it is distinct, within
  the T078 margin, and moves a device that takes part in a weighted readability
  violation of the incumbent, with half the incumbent's relocation, port-seat
  and rail-seat trial budgets (at least one each); the finished comparator
  decides.
- **R158 — Drafting owner recovery (T082).** After the finished winner is
  chosen, in plain planning with a nonzero search budget and 1–40 instances,
  recover drafting ownership that R16 and R150 lost. First, a routed
  conductor on a Net with no terminal (no device pin, port or marker) is
  carried rigidly by R150's terminal-less displacement (the nearest visible
  source instance), with its bends and junctions, under fresh R98 ids;
  bus-member routes and contact-anchored or member junctions are not carried.
  It must touch no symbol, pin, junction, conductor or drafting ink, must not
  join a terminal Net, and must keep the terminal partition. Each carried Net
  is accepted on its own. Movable drafting anchored to it is re-anchored by
  explicit drafting edits to the new ids, with anchor parameters recomputed so
  every member keeps its current (R150-seated) position and the component stays
  rigid; an anchor that cannot represent that position keeps its seated anchor.
  Locked drafting never moves. Then
  an owned drafting group whose R150 seat failed or left its owner's radius
  searches seats around its owner on both sides (grid steps up to ±40),
  accepting only a seat that keeps the same owner; groups merged with locked
  ink stay fixed. Every accepted change keeps R150's batch acceptance
  (terminal partition, no new drafting overlap, no R146 guard regression,
  crossings / bends / wire only with a strictly lower frozen composite) and
  never raises the frozen composite. Cancellation is checked per Net, group
  and offset; clearance-passing seat trials are capped at 128 per group and
  512 per document, scaled by `finishingTrialBudget`.
- **R159 — Amplifier between its sensed branches (T084).** In documents that
  run the finished-finalist pass (at most 40 instances), an R156 amplifier
  without a series passive whose output drives the gate/base line of at least
  two MOS or BJT receivers, and whose two inputs directly sense conducting
  terminals of two distinct receivers in a straight row, forms a gate-row
  variant: the amplifier's output pin is seated midway between the two sensed
  receivers' control pins, 40 units toward their sensed terminals (grid
  snapped), its exit facing the gate line; among rotations and mirrors with no
  geometry conflict, take the one with the shortest Manhattan distance from
  each input pin to the terminal it senses. Only the amplifier moves; receivers, fixed,
  template, symmetry-block, coupled and layout-group members stay put, and
  explicit floorplans are excluded. The variant is an additional finished
  finalist after `attachment` (fixed order), admitted by the T078 margin rule
  and decided by the finished comparator, so a worse variant is never returned.
- **R160 — Local two-pin parts outside their transistor (T085).** In documents
  that run the finished-finalist pass (at most 40 instances), a paired two-pin
  part of an R89 / R145 symmetric component is a local part when its pins are
  all connected and every non-rail Net it touches is a drain, gate or source
  Net of exactly one transistor of the same half, that transistor is not
  cross-coupled with its partner, and both partners' hosts are themselves a
  mirrored pair. A half-order variant sorts such parts to the outer end of
  each half row (away from the axis), keeping cross-coupled members and axis
  devices at the inner end and every other node in its R89 order; mirroring
  and the rigid block are unchanged. It is an additional finished finalist
  after `gateRow` (fixed order), admitted by the T078 margin rule and decided
  by the finished comparator.
- **R161 — Drawn frame interfaces (T122).** A drawn rectangle is a functional
  frame when open wire ends (a junction touched by exactly one Route) of at
  least two distinct terminal Nets lie on its edges; two Nets on the same edge
  are two contacts. On every exit of `planAutoLayout`, including a stopped
  search, the selected plan is checked: a contact is detached when no route end
  of the same Net remains at the contact's place on the frame after the plan
  (a frame the plan removes detaches all its contacts). If any contact is
  detached, the plan is refused and the source stays unchanged: no edits, no
  groups and exactly one error `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED`
  naming the frames, whether or not the source itself is complete and safe.
  Documents without rectangles, frames touched by one Net and plans that keep
  every contact get the selected plan as it is. Placement does not know about
  frames yet; wiring lost contacts again and frame-aware placement are future
  work.
- **R162 — Source body leads (T121).** A MOS body whose B pin ends a Route
  in the input drawing (dashed or solid) gets a lead again; a body the input
  shows without a lead stays without one, whatever its body Net. Planning,
  ranking and every finishing pass are unchanged, so device placement equals
  the plan without leads. On the selected result only, each
  such body not already joined to its frozen group is wired with one
  clearance-checked wire to the best of at most four same-group ordinary
  terminals (its own source first, then nearest; other bodies of the group
  it is not already joined to, only when every ordinary target fails). A
  routable own source wins outright; other targets are compared by crossings,
  bends and wire length. Every redrawn lead is a dashed body lead, also where
  the input drew it solid. The edits are appended and the whole list is replayed,
  partition-, name-claim- and safety-checked; then R73 reseats the instance
  labels the new leads strike, kept only if the same replay checks pass. A
  listed body still not joined to its group is reported as one
  `AUTO_LAYOUT_NET_UNROUTED` R14 warning per Net
  (`Net <id>: visible body connection could not be routed safely; pins: ...`).
  The R86/R43 audits keep excluding MOS bulk pins.
- **R163 — Feedback-row draft (T135).** A document of at most 40 instances,
  without a partition, fixed instance or locked owner, is in the subset when
  it has no MOS or BJT and a directed block (a pin with an input role and one
  with an output role, not hierarchical) has a feedback chain: one to four
  two-pin non-block parts in series from the block's output Net to one of its
  input Nets, each inner Net reaching exactly two device pins and no port.
  For the subset only, the portfolio gains a fourth draft, `feedback-rows`,
  after `stages` in R63 order; it is routed, deduplicated, ranked, refined,
  searched, finished and selected like the other drafts, and no other
  document plans differently. Its devices are outside R21, so the draft has
  no orientation choices and R22 offers it Cell Pin side flips only. The draft reads connectivity and symbol
  geometry only. Signal distance runs forward from input terminals, else
  undriven interface Nets, source outputs and open leads, else block inputs no
  block drives, through blocks from input to output only and never through
  feedback parts. A part with exactly two pins that are not control inputs
  conducts between those two: its control Net never links it into a row, and
  when both share one Net it links nothing. Any other part links all its
  signal Nets. Each independent
  circuit gets its own band, top to bottom by signal distance. In a band,
  blocks are placed by signal distance; the chain to a block's fed-back input
  (a single-output block is mirrored vertically when, unmirrored, the input pin
  of its first feedback chain lies below its output pin) forms the
  main row by the shortest series path from its entry Net, input leads and
  sources at the left, the block next, its output continuing right. A shunt
  (two terminals, one on a rail) hangs vertically below its node (above for a
  supply), in a column reserved beside the node. Chains to the block's other
  inputs take rows of their own beside the block, away from the main row
  (the second half of a differential block below). Each feedback chain lies
  horizontally in a row above the block, below when it feeds the lower input
  pin, centred between the input and output pin columns; several chains of
  one block stack outward. Remaining forward parts are branches in rows below
  the Net they leave, continued until they rejoin a placed Net; a part joining
  two placed Nets is a bridge in a row above them. Rows keep the lane their
  wires span clear of other parts. A draft that cannot be built or
  leaves a device unplaced is a refused candidate (R63); the other strategies
  still plan the document. Markers,
  ports and labels are seated by the existing rules (R19, R71, R146).

- **R164 — Directed blocks face right (T134).** A directed block is a
  non-marker symbol whose definition has a pin with an `input` role
  (`input`, `non-inverting-input`, `inverting-input`) and a pin with an
  `output` role (`output`, `output-complement`); hierarchical ports carry no
  direction (`directed-blocks.ts`). Directed blocks are linked from each
  output pin's Net to every other directed block with an `input`-role pin on
  that Net; `clock`, `reset` and other pins are not edges, so a loop closed
  only through a clock or reset pin leaves its blocks free. A block in a
  strongly connected component of two or more blocks (found iteratively, with
  Nets indexed to the blocks that read them) is on a block cycle (latches,
  rings) and keeps today's behaviour. Every other directed block is free;
  `classifyNets` records the free ones over the whole document, leaving out
  instances in locked layout groups or constraints, and planning also leaves
  out the caller's fixed instances. The convention is enforced where candidates are generated,
  with no selection or evaluation weight: no R66 single-device move reflects a
  free block left-right (it reflects top-bottom instead, drawing the same
  random numbers); two-pin layered row placement and R21 turn it by 180
  degrees or reflect it top-bottom, never facing its output left; R147
  relocations, R72 fanout turns, R156 local-loop amplifiers, R159 amplifier
  seats and R157 attachment seats skip poses that face its output left (so
  R156 offers no variant when its only seat would face the amplifier left). A
  mirror of a whole stage (R53, R57, R153) or of a stage block (the R66
  block-mirror move) reflects the free blocks in it too and then turns each
  back to face right in place: reflected left-right again and shifted to keep
  its visible box centre, snapped to the grid. A stage stays unmirrorable when
  a free block in it hosts an attached part or a device in it hosts an
  attached free block, since righting would leave the part behind. A free block is against the flow when more
  than half of the other pins on its non-rail input Nets lie right of it (the
  mean x of its own pins); parts that also touch one of its output Nets are
  feedback and do not count, nor do MOS bulk pins. In a document without MOS
  or BJT devices (transistor drawings keep their own left-right conventions)
  and outside partition mode, R57 without a port on a side takes that side
  from the free blocks: their output pins mark the output side, the counted
  pins on their input Nets the input side; and a draft without fixed
  instances is replaced by its whole-draft mirror (free blocks righted in
  place) when that draws fewer blocks against the flow. Explicit input
  evidence outranks this inference: on the input side the positive terminal
  of a grounded source on a signal root (R32's start) is used before the
  blocks (only in a document with a free block), and the whole-draft mirror is
  vetoed when it would move a signal root's input from beside to right of
  what it drives (a source's positive pin right of the
  mean of the root Net's other pins; without a source, those pins' mean right
  of the devices' centre, the edge R19 would seat the input port on). A veto,
  not a count summed with the blocks, so no number of righted blocks can buy
  a reversed input; a root already on the right does not veto. A document
  without a free block reaches none of these mechanisms. No R66 move may draw
  more blocks
  against the flow than its starting state. A non-rail Cell Pin whose Net a free block's output pin drives is
  hosted by that pin (the first driver by id whose output does not leave to
  the left, so a fixed block facing left hosts nothing) and seats on the right
  whatever
  the R19 side choice, so search cannot flip its side, and R146 discards every
  seat at or left of that block's centre. Fixed instances keep their pose; a
  document without directed blocks plans exactly as before.

- **R165 — Netlist presentation (T129).** With `presentation: "netlist"` the
  input carries only its netlist, so before the other rules the planner decides the
  rail symbols from the Document alone (no geometry), plans the Document those
  edits produce with the unchanged pipeline, and returns the presentation
  edits followed by the plan's edits as one transaction. Without the option
  this rule is not entered.
  Ground Nets are the Nets with a name claim of `0`, global, in the ground
  domain (node `0`); no other ground claim qualifies. A Ground marker
  exports only as global node `0`, so a Net named otherwise (a `VSS` Cell
  Pin's Net without node 0) would be renamed and, under a node-0 export,
  printed as `0`: such a Net gets no ground symbol. A Ground
  Net without a `ground` marker gets one `ground` marker per device with a
  pin R6a can host (a MOS source or drain, a two-pin part's pin, or a T127
  extra host whose exit does not leave away from the rail at the device's
  pose, its default one when unplaced), in the tray, with explicit membership
  of that Base Net and a power-marker-owned claim of global node `0` with the
  ground domain: the only name a Ground marker exports. The markers stay on
  the one Base Net; R6a seats each at its own host and R12 gives it a stub, so
  each is its own routed piece, while pins R6a cannot host (MOS gates, pins
  leaving away from the rail) and Cell Pins stay on the R43 trunk as today. A
  Ground Net holding a Cell Pin with only one such device gets no marker: the
  Cell Pin is wired to that host anyway. The host test is R6a's own (`channelHostPin`,
  `offersExtraHost`); the extra host's exit is read before planning, at the
  device's input or default pose, while R6a reads it at the planned pose, and
  the planner may turn a channel host so that its grounded pin leaves away
  from the rail. Such a marker takes R6a's fallback or a turned-back stub; on
  the T129 corpus none was left unhosted; 25 of 1012 markers in 18 `global`-form Documents and 1 of 69 in one `vss`-form Document ended on a turned-back stub, all on channel hosts. R165 does not change orientation choice. A Cell Pin named `VDD` (any case) whose interface instance is a `port`,
  whose Net R4 classifies as supply and carries no name claim becomes a
  `vdd-port` (`set_instance_symbol`) when it is the Document's only such Cell
  Pin and its Net has none. The symbol gives the Net the supply domain; the
  design export already ranks a `VDD` Cell Pin as the supply, while any other
  name (`AVDD`, `vdd!`) would move in the exported Cell pins, so it keeps its
  port; several candidates also keep theirs, with an
  `AUTO_LAYOUT_NETLIST_SUPPLY_AMBIGUOUS` warning. A rail that already has its power symbol is left alone.
  The edits are replayed with `dryRun`; they are kept only if the transaction
  is accepted and every original terminal keeps its Base Net and Logical Net
  partition, every Net keeps its name, scope, conflicts and domain (except a
  `vdd-port` Cell Pin's Net, which gains the supply domain), Cell terminals,
  evidence and MOS bulk defaults are unchanged, every MOS body resolves as
  before, the only symbol change is `port` to `vdd-port` on a Cell Pin whose
  folded name is `vdd`, and each added instance is such a ground marker.
  Otherwise, or when the markers would pass R3's 120 instances, or the
  presented Document plans to a refusal or to no edits, or the combined list
  passes the transaction edit limit, the Document is planned without them and an
  `AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED` (or `_SKIPPED`) R165 warning says
  why. R10's partition check applies to the presented Document. The
  evaluation checks the electrical graph and the re-exported netlist text.
  The editor asks for this presentation on a netlist-only Cell (an
  `importReference` and no routes), after a SPICE import and from the Auto
  Layout command ([Automatic layout](editor-interaction.md#automatic-layout)).

- **R166 — Stack-aligned candidates (T136).** A stack is two devices that
  carry the only two conduction terminals (a MOS drain or source, a BJT
  collector or emitter, either pin of a two-pin part other than a capacitor)
  on a non-rail Net, at least one of them a transistor. It holds when the two
  pins lie on one line along their exits and face each other. For each of the
  `template`, `layered` and `stages` drafts of a Document with a stack and no
  explicit floorplan, R63 also routes the same draft with its broken stacks
  aligned (`<strategy>+stack`): after attachments and before markers, each
  stack that does not hold, or has a device body between its pins, is aligned
  by moving one member sideways (across the stack axis) so that its pin lands
  on the other's exit line, on the side it already lies on. Never moved: fixed
  and locked devices, R94 symmetry members, recognized template members,
  extra members and tails, coupled inductors, R69 attachments and their hosts,
  layout-group and symmetric-constraint members, members of an exactly-two
  mirror pair (same gate Net and source, different drains) or differential
  pair (same non-rail source Net, different gates and drains) of one
  polarity, and both members of a stack that already holds or was aligned
  earlier in the pass. Arbitrary choices, each kept because corpus drafts use
  it (counted over the 1113 `+stack` drafts of the 371 corpus Documents with a
  stack; 327 drafts in 200 Documents align something): transistor-transistor
  stacks before transistor-load stacks (changes 11 drafts), then Net id
  order; the two-pin member moves before a transistor (71 drafts), then the
  lower id (25); a two-pin mover may take any of the eight orientations and a
  transistor only the reflection that keeps both channel exits, moving its
  gate to the other side (11 drafts), and no orientation an R22 override
  fixed or of an R164 directed block kept facing right (which may only
  shift); the cheapest pose wins, a turned pose costing 40 units of shift
  (71 drafts; turning at all, 34); a free shunt capacitor whose body blocks
  the slot steps sideways by the nearest of up to four grid steps that neither
  overlaps nor blocks (53 drafts; more than four steps would serve two drafts
  of one Document). A move is rejected when the mover overlaps a device, a
  body remains between the pins, R10's geometry check fails or a stack that
  held breaks or is obstructed; the stack is then skipped. A candidate joins
  the portfolio only when it is valid and its edit list differs from every
  original draft's and earlier candidate's; one that cannot be built or
  refuses is not offered. Candidates rank right after their own draft (ties
  keep the original). When none of them ranks among the drafts R63 refines,
  or refinement of those does not select one, the originals are ranked,
  refined, searched, finished and selected exactly as without R166: the
  annealer's alternative starts and the crossing-reroute portfolio contain no
  candidate. When refinement selects a candidate, the candidates stay in the
  portfolio for the annealer's alternative starts and the reroute portfolio,
  and a search that starts from it never accepts a proposal that breaks one of
  the stacks its draft aligned while that stack holds (a stack already broken
  does not block a move). The guard checks each proposal before it is
  routed, against the stacks that search's start draft aligned, also after a
  restart from another start; a routed run that comes back with a column
  broken is not guarded for that column from then on. The original drafts and R66's existing stack guard
  are unchanged. Evaluation reports the stacks present and broken as
  `stackColumns` (report-only).

- **Finished crossing polish and stack repair (T183).** After R149's gap
  visits and before R167, use the same finished replan for two bounded passes.
  Crossing polish runs only when the finished drawing has a proper crossing.
  It considers the rigid units attached to the crossing Base Nets. It mirrors
  or turns eligible single devices around their body centres and exchanges the
  centres of same-size units of up to four devices, carrying their exclusive
  markers. Trials stay on the grid, avoid overlapping bodies, and preserve the
  anchor when nothing is locked. Individual turns preserve vertical rail exits
  and exclude mirrored pairs and poses that violate R164 or R169. The R54
  estimator orders trials by estimated crossings, then wire length and a
  deterministic placement key. A finished trial must reduce crossings, or
  keep crossings equal while reducing both bends and the calibrated run
  comparison. Up to two greedy passes share the ten-trial budget scaled under
  R66.

  Finished stack repair runs only if an R166 stack is broken. It tries moving
  either unlocked rigid unit, with its exclusive markers, to align the
  conducting pin to the other unit's pin. A single two-pin non-transistor
  device may turn so the pins face one another. When the pins are on the wrong
  side, it uses the smallest clear gap of one to three grid steps on the
  facing side. Existing collinear, opposing pins in direct contact do not
  need a gap. A finished repair must reduce the broken-stack count without
  adding crossings, bends, label overlaps or label clearance findings. It
  may add up to 60 units of wire and has an eight-trial budget scaled under
  R66. Both passes preserve physical completeness, rigid units, held stacks,
  routing guards, label owner-distance counts and netlist symmetry.

- **R167 — Straighten pin jogs (T137, T183).** In the planning that runs R149
  (default mode, a nonzero search budget, at most 40 instances), every
  finalist chain runs one pass after finished stack repair and before R152.
  A **pin jog** is judged on the drawing's own routed wires. Its subject pin is
  a MOS gate or BJT base on a non-rail Net that reaches a non-bulk pin of
  another instance, or either pin of a two-pin non-transistor part. From the
  pin the wire runs along the pin's exit (a leg of length zero when it leaves
  the pin tip sideways), steps perpendicular by at most 20 units, and then
  either goes on in the exit direction (Z) or ends on a junction (L). Moving
  the part by that step straightens the wire. `auditRouting` does not count a
  sideways departure from a pin tip as a bend, so the routed score barely sees
  these jogs; R147 proposes only poses that face another pin at 40 or 80 units,
  never this step.
  On the current incumbent, jogs are taken Z before L, then smaller step, then
  by instance and pin id. The trial translates the subject's R147 rigid unit,
  with the one-pin markers all of whose wires end on that unit, by exactly the
  step. A unit with a fixed or locked member is skipped, and so is one that
  would carry a fixed or locked marker (leaving the marker behind would only
  make a new jog at it); an off-grid step is skipped, and so is a trial in
  which a moved body would overlap another body (no clearance is required).
  If the subject move is skipped or rejected, try the opposite step on a
  distinct unlocked peer unit at the other end of the wire. At a junction,
  the peer must be the unique non-marker terminal on a straight adjacent
  route of the same Net. Each unit and step is tried once. When nothing is
  fixed or locked the whole placement keeps the incumbent's anchor, as in
  R147.
  Every trial is finished through R149's replan, and a trial that replan
  declines (it hands back an earlier run) is rejected. A finished trial is
  accepted only if physical completeness is not worse, no rigid unit is split,
  no `routedGuards` count rises, no R166 stack that holds on the incumbent
  breaks (one already broken does not block a move), no two transistors drawn
  level stop being level (the same channel axis, and reference points at most
  2 units apart across it; pairs already off level do not block a move), and
  crossings, counted bends, **visible corners** (route bends plus sideways
  pin-tip departures), pin jogs, label overlaps and label clearance findings
  do not rise; wire may grow by at most 40 units and the routed width and
  height by at most 20 each. It must also
  make progress: fewer pin jogs, fewer visible corners, or a strictly lower
  calibrated score. After an accepted move the jogs are detected again. The
  pass has its own budget of 12 finished trials, scaled under R66 (five at
  40 instances). The score and its weights stay the same. Without any pin
  jogs, R167 returns its input directly.

  The choices are empirical. Counts are on main 347082f with R167: moves
  accepted in all finalist chains of the 79 corpus drawing cases whose plan
  R167 changes (79 cases with a move, 145 moves). Step at most 20: before R167, on
  `main` at `65075a0`, the planner drew 445 such jogs and humans 93, while in the T137
  pre-test humans drew more steps of 30 and up than the planner; the 145
  moves are 61 of 10 units and 84 of 20. Rigid units of two or more members:
  18 moves in 13 cases. Progress: 124 moves in 74 cases by fewer jogs, 12 in
  10 by fewer corners only, 9 in 7 by score only. The trial cap was never
  reached (at most seven trials in a pass). The stack and level conditions
  came from review of the changed drawings: without the stack condition a
  current source or resistor was shifted off its transistor's drain line, and
  without the level condition a transistor was lifted out of the row it
  shared with other transistors, which a blind pairwise review named as the
  main reason to prefer the drawing without R167. Measured and not part of
  the rule: a limit on width plus height (never the only reason to reject a
  trial); a gate-level check (left the worse-case count and crossings
  unchanged and kept more bends); checks on differential and mirror pairs and
  on shunt parts; rejecting a move that leaves a new perpendicular step above
  20 on a moved pin (added new worse cases and lost part of a
  reviewer-confirmed gain). Because the pass runs in every finalist chain, a
  straightened chain can win finalist selection, so a document whose selected
  plan had no jog can still plan differently. Z before L, the carried markers,
  the 40-unit wire allowance and the 20-unit extent allowance were set in the
  experiment on `65075a0`; their case counts were not recounted for the
  shipped rule.

- **R168 — Convention-solved draft (T138, T181).** A Document is in the
  subset when it has at most 40 instances and 18 devices, and either contains
  a MOS or BJT or has at least four devices. Partitions, fixed instances,
  locked layout groups and constraints, and hierarchical symbols are
  ineligible. Symmetric circuits keep their template drafts when the
  placement symmetry topology (R94 `symmetryTopology` followed by R140
  `stageComponents` on `classifyNets` roles) finds a component. R63
  also routes a `convention` draft that places every device at once,
  minimising violated drawing conventions; markers, ports, labels,
  collisions, attachments, routing, refinement, search and finishing are the
  existing rules, and its devices are outside R21. The draft reads
  connectivity (`classifyNets` Nets) and symbol geometry. Only visible,
  non-bulk pins participate in the convention and wire costs.
  - Conventions (one object each, from connectivity): STACK is R166's stack
    and excludes two-pin-only stacks.
    LEVEL is a transistor gate (or base) on a non-rail Net that reaches
    another device pin, held when another pin of the Net lies straight out of
    the gate on its exit side or the gate line T-joins a straight segment of
    two of them, and counted as held when the Net also reaches a port or rail
    marker, which is seated later. SHUNT is each part
    of a group of two to four two-pin non-transistor parts on the same two
    Nets (rail Nets compared by kind), held when a group partner with a
    parallel axis is aligned beside it with no device centre between. An
    exactly-two mirror (same gate Net and source, different drains) or
    differential pair (same non-rail source Net, different gates and drains)
    of one polarity whose members are in no other pair is one rigid unit, its
    members one column pitch (120) apart. A differential pair faces its
    gates outward and a mirror faces its gates inward.
  - Hard: a transistor is upright, never inverted (channel vertical, gate
    sideways, the drain or collector of an n device and the source or emitter
    of a p device on top; human drawings invert 0.5%); one pose per distinct
    pin layout; two-pin parts take the four rotations, other parts the
    distinct ones of all eight poses. Free R164 directed blocks keep R169
    input polarity and exclude poses with any left-facing output. When a
    valid pose has an output exiting right, only poses with a right-facing
    output are allowed. Device bodies stay at least 40 apart in x or 30 in y.
  - Cost, weights per violated object: STACK 1, LEVEL 1, SHUNT 1; inputs
    left of outputs, 4 shared by the input/output Net pairs of
    `classifyNets` roles and violated when the input mean device-pin x is at
    or to the right of the output mean; `blockFlow`, 2 per free R164
    directed block, shared by its non-feedback signal driver and load
    terminals. Drivers must lie left of the block's visible pin mean x
    and loads right of its output pin mean x. Devices that also touch the
    opposite side's signal Nets are treated as feedback. Rail side is
    1 per rail pin of a non-transistor part that is at or below its other
    pins for supply, or at or above them for ground. Supply above ground
    is 2 shared by the supply/ground pin pairs of different devices. Wire
    costs 1/150 per unit of half-perimeter of each non-rail Net with at
    least two device pins, and shape costs 1/200 per unit of the longer
    side of the device outline.
  - Search: each unit's reference point (a transistor's channel line and gate
    level, a two-pin part's pin axis and midpoint, otherwise its body centre)
    takes half-column (60) and row (50) lattice values within four steps of a
    placed unit it shares a non-rail Net with (any placed unit when none),
    plus the values that align one of its pins with a placed pin of the same
    Net, or a sideways pin with the midpoint of two collinear ones. Units are
    taken most connected first (ties: more members, then id), then most
    connected to those placed; depth-first branch and bound over the children
    sorted by cost, pose, x and y, with limited-discrepancy rounds (0, 1, 2, 4,
    ...), ends when the tree is exhausted or after 60 000 evaluated
    placements. Polish uses a shared budget of an additional quarter of
    the search limit, with a minimum of 5 000 evaluations. It first
    relocates units while convention cost improves. If the resulting
    placement has R54 estimated crossings, up to two further passes
    estimate the best 24 relocations per unit by convention cost and try
    swapping compatible single-device units at each other's positions.
    Compatible units have the same symbol or are both two-pin passives.
    Each accepted change lowers convention cost plus 1.5 per estimated
    crossing and 0.0005 per unit of estimated wire length without adding
    crossings. This stage uses at most 1 500 estimator calls including the
    initial estimate. The search and polish are deterministic.
  - Offer: the draft joins only when it is valid and its edit list differs
    from every original and R166 candidate; a solver failure, a draft that
    misses a device or a refused run is not offered. It ranks within the
    portfolio R166 left (ties keep the earlier draft), so it can take a
    refinement slot from an original. It wins provisionally only when
    refinement selects it and its refined run also compares better than
    the refined choice planning makes without it. When an original wins provisionally,
    its annealer and crossing-reroute portfolio use the original
    candidates. A complete, distinct and competitive convention draft can
    still enter `FinalistPass` through `shouldFinishRunner`. It can win via
    `selectFinishedLayout` only when it strictly improves the finished
    comparison and passes the readability and visual/routing guards.
    Evaluation reports `conventionDraft` (`eligible`, `selected`).

- **R169 — Input polarity of directed blocks (T142).** A polarity block is a
  symbol with an input-role pin and an output-role pin plus one pin named `+`
  or `IN+` and one named `-` or `IN-` (case-sensitive, after trimming and
  folding Unicode plus, minus and dash variants), all non-hierarchical, the two
  at distinct local positions: the op-amp and comparator family. Its unrotated,
  unmirrored pose fixes the vertical order of the two on the page; a pose that
  draws them in a different vertical order (exchanged, or level when the
  symbol's are not, or the reverse) is out of order. Before routing, every
  placement map that reaches `buildPlan` (a strategy draft, a supplied
  placement, or exact seats replanned by refinement, relocation or finishing)
  passes one check: an out-of-order block takes the first of the eight poses
  (rotations 0, 90, 180, 270, each without and then with horizontal mirror)
  that has the symbol's order and keeps the exit direction of its first output
  pin. Its position does not change. A block with no such pose keeps its pose.
  A block in `fixedInstanceIds` or owned by a locked layout group or constraint
  is never rewritten. The rewritten map is used only when `geometryProblem` (or
  `contactGeometryProblem` when a contact policy is passed, as on the
  exact-seat path) reports no problem on it; otherwise the original map stands.
  R164 still chooses the exit direction; for a polarity block R169 replaces the
  reflection or turn it used with the ordered pose. On the corpus at main
  fcd8fc4 (628 Documents): blocks with exchanged inputs 40 of 137 → 0 (37
  Documents → 0); 4 blocks (`opamp`, `opamp-wide`) stay out of order by the
  rule's own test, at 90° poses where the inputs are side by side and no
  ordered pose keeps the exit; 51 plans change, crossings 310 → 312, bends 2037
  → 2047, no equivalence or integrity defect. The rewrite is applied after the
  search has checked its proposal, so R166's stack guard does not see it:
  broken stacks stay 228, with 5 Documents breaking a stack they kept and 4
  keeping one they broke. The rule follows the symbol, not the source drawing:
  in 14 of the 37 Documents the human drawing has the same exchange. A blind
  comparison of 37 changed drawings (2026-11-19), which are not the same set as
  those 37, preferred the earlier drawing in 8 of the 10 whose human drawing
  exchanges the inputs, and the new one in 15 of the other 27.

- **R170 — Reflections in netlist refinement (T151).** Four limits on the
  refinement that runs on netlist input. (1) The power-flow step never reflects
  a drawing left-right; it may still reflect it top-bottom and move rail leads.
  (2) A top-bottom reflection is rejected when an instance whose pose in the
  incumbent keeps its symbol's input order under R169 does not keep it in the
  reflected drawing. A block the incumbent already draws out of order does not
  veto. (3) Every trial of the port search's mirror frame (the reflected plan,
  the routed mirrored seats and the edge columns built on the mirrored drawing)
  is compared with the best drawing at that moment and dropped when either
  holds for a single item: (a) a free directed block (R164: on no block cycle,
  not locked) has an output pin exiting west and had none in the incumbent; (b)
  a `port` or `port-filled` on a non-rail Net is on the wrong half and was not
  in the incumbent. An input is wrong on the right half and an output on the
  left half; a port without a known direction (explicit interface direction,
  else Net role) counts as an input. The half is the sign of `dx`, the port's x
  minus the unsnapped midpoint of the non-marker instances' enclosing box in
  the same drawing, and neither half when `|dx|` is strictly less than one grid
  step. An item that improves never offsets one that gets worse. Ports without
  a placement or a Net on `P`, blocks on a cycle and the search's other frames
  are not vetoed. (4) The current-source tail step uses the differential
  pair's polarity. For a p-channel pair it seats the tail above the pair,
  puts any source-degeneration elements between the pair and the tail, and
  places loads and output ports below the pair. The centered tee has an upward
  stem to the tail's lower contact. The n-channel step keeps the tail below
  the pair. Both use the same completeness, routing and readability guards.

- **R171 — Role-oriented MCTS draft (T173).** For 2–20 devices in at most
  40 instances, a transistor circuit with at least two DC branches or a lateral
  role can offer an additional draft. Partitioned drawings, fixed instances,
  locked groups or constraints and hierarchical devices are ineligible.
  Conducting terminals form vertical columns ordered from supply to ground.
  Parallel degeneration and internally controlled pass transistors
  (`bridgeTransistors`) and two-pin loads across columns (`bridgePassives`)
  get horizontal slots. A differential amplifier sensing two columns and
  driving their gates (`clampAmplifiers`) points toward the driven half from
  the midpoint. Column coordinates follow the posed conducting-pin axis.
  Shorter columns align shared-gate partners of the same polarity where row
  order permits. Parallel bridges stack at 60-unit intervals around the
  endpoint midpoint, with at least 120 units between branch rows for a pair.
  With seed 1, single-player UCT explores 320 completions of column order,
  gate facing and lateral poses. Above six columns it considers the first
  four heuristic choices per position. Rollouts explore uniformly with
  probability 0.25. UCT blends best and mean normalized rewards in a 60:40
  ratio with exploration coefficient 0.7. Reward is `1 / (1 + cost / base)`,
  with the first valid cost (at least 1) as the base.
  The proxy counts estimated crossings × 240, MST wire length × 1,
  potential inversions × 300, misdirected gates × 90, reversed input/output
  pairs × 250, aspect ratio above 1.8 × 180 and misplaced bridges or clamps
  × 120. Gates on an external port or input net prefer to face outward at
  the two outer columns. Other gates face the other pins on their net.
  A bounded local polish tries adjacent swaps, facing changes and
  alternate slots. Drafts must pass geometry validation and preserve recognized
  stage symmetry (paired position, reflected facing and axis devices). R63 replaces the
  incumbent portfolio only when the distinct MCTS draft wins refinement,
  strictly improves the incumbent run and preserves or improves physical
  completeness. A losing draft stays out of annealing and rerouting.

- **R172 — Multi-port local signal decoupling (T175).** A non-rail Base Net
  with at least two ports, a name for every port (interface terminal or logical
  Net name), at least one device pin per port, and no power markers can use
  local wire trees. In port id order, reserve distinct authored touching hosts
  first, then preserve hosts from physical components containing a single port.
  Assign other primaries in instance and pin-name order. Spare device pins stay
  with their wired port when possible, then use the nearest primary by Manhattan
  distance with port id breaking ties. A port with one host tries half, one and
  one and a half R71 offsets along the host exit, with a minimum of two grid
  steps. Route each cluster independently while preserving Base Net membership
  and terminal equivalence.

- **R71 — Single-host ports.** A non-rail Cell Pin Net that reaches exactly
  one device pin gets a local seat along that pin's transformed exit direction.
  Use a 40-unit default seat up to 40 instances and 80 units above that,
  with clear artwork. Face the port toward the host;
  the port-label renderer keeps text upright. Reserve local seats in id order.
  If the seat is blocked, use R19/R20. Multiple-host ports retain R93 and
  R19/R20 with the same document-size edge offset. Rail ports retain R62 clearance.
  Local seats are excluded from edge spacing and side refinement. Fixed ports
  remain occupied and never move; touching ports require R38 validation.
  After routing and label finishing, a diagnosed short port stub can extend
  to 80 units under R6a's shared bounded label repair and guard checks.
  R146 also considers other distances and every host of a non-rail Net.

- **R72 — Blocker repair.** After a complete quick plan, collect movable ports
  (`port`, `port-filled`) and descriptor-defined net markers named as R14
  obstructions. The unchanged router throws plain errors, so resolve only its
  obstruction label (`reference ?? id`) to an unambiguous instance; do not use
  Net names, suggested detours or coordinates from the message. If R14 has no
  movable blocking marker, use physically floating, unlocked ports as alternative
  repair targets. A local R71
  port falls back to R19/R20. An edge port advances by R20 spacing along its
  edge; a power marker advances by grid steps along its rail in R6a/R12 id
  order. Choose the nearest free seat in either direction, with positive ties, whose
  ink clears other pin branch rows/columns and R43 horizontal rail spans.
  Preserve every device, fixed instance and unrelated marker placement, and
  replay the complete routing/transaction pipeline. Keep a repair only with
  no increase in missing connections, strictly fewer floating pins and a lower R22 routed score, so an
  unrouted Net outweighs the few crossings its route may add; try at most two
  passes. If reseating a formerly floating port completes all nets but leaves
  its signal fanout crossed, allow one further full replan outside the energy
  budget. For same-row hosts with one declared output driver on an outer
  column, exchange the driver column with the median host column and face
  horizontal receiver pins toward it. Skip partitions and moves that touch
  fixed, constrained or grouped instances. Keep the candidate only with
  complete, safe routing, fewer crossings and a lower routed score.
  In R66, repair only the final best state and its routing-only alternative
  before R44, within R67 span bounds, with no repair work per energy evaluation.

- **R73 — Label seating.** After routing and R15, seat visible, unlocked
  annotations attached to the instances placed by the plan. Fixed instances'
  annotations stay put. Evaluate the shared derived instance-label sides and
  default name/value rows together, and `portLabelCandidates` for Cell Pins.
  A locked name or value pins its group to its existing recognized side.
  Greedily process the most conflicted group first (annotation-id ties), for at
  most two passes. Minimize label overlaps, then wire conflicts, then part-ink
  conflicts, then distance to the owner, lexicographically. Accepted positions
  update the shared clearance context before the next group. Upserts change
  only anchor offsets/fallback positions and alignment; retain content, bindings,
  style, rotation and locks. Every complete candidate includes seating and
  whole-list replay before scoring.
  Round computed fallback coordinates and local offsets to integer page units,
  including candidates derived from odd grid sizes or fractional ink positions.

- **R74 — Readability energy.** `ROUTED_SCORE_WEIGHTS` exports all R22 energy
  weights together. The unchanged `unrouted` weight of 10000 multiplies missing
  connections, not diagnostic count (R86). Count the unchanged derived diagnostics
  `VISUAL_LABEL_OVERLAP` (clustered), `VISUAL_LABEL_CLEARANCE`, and
  `VISUAL_TERMINAL_DEPARTURE` on the final seated preview, with starting weights
  400, 150, and 200 respectively. Cache counts per immutable preview and resolver.
  Through 40 instances add `READABILITY_SELECTION_WEIGHT` times the frozen
  T070 `readabilityScore(readabilityMetrics(final, resolver))`, with selection
  weight 30000, the dev minimum satisfying all round-2 development guards. The selection weight is evaluated on dev only; metric definitions, scales and fitted weights
  remain frozen. Memoize the composite per immutable final document and resolver
  within one public planning call; no corpus state enters the score. Apply it
  to complete strategy, refinement, routed annealing, routing alternative,
  compaction, device/port/rail seat, drafting, local-rail and repair comparisons.
  Unrouted placement estimators do not measure it. Above 40 instances the term
  is zero and the prior scoring and guard behavior remains in effect.
  Evaluation reports
  the three counts for both human and automatic drawings and dev/val totals.
  Review-only timing records cumulative seating and readability scoring time
  across complete candidates, without changing deterministic output.
  T086: readability has two frozen weight sets. **Selection weights**
  (`readability-selection-weights.ts`, the T070 calibration) are the only ones
  the planner uses: `readabilityScore` by default, every R74 / T074, finished
  selection and R148–R160 comparison, and the metric set of
  `readabilityMetrics(..., "weighted")`. **Evaluation weights**
  (`readability-weights.ts`, generated by `scripts/readability-fit.mjs` from a
  dev-only fit pooled over human vs `1737221` and human vs `eb72cb1` layouts,
  all scored with the same metric code) are passed explicitly by the evaluator
  and measure the readability goal. Regenerating evaluation weights never
  changes a plan; adopting them for selection is a separate task with its own
  quality and timing gates. The metric `collinearAbutment` counts different-Net
  wire ends facing on one line within one member pitch where both facing ends
  are a pin entry or a two-way bend (not a branch, an open stub or a marked
  end).
  T087: full evaluation also measures `signalDirection` and `netlistSymmetry`,
  neither depending on planner recognition nor changing selection weights.
  `signalDirection` derives input → output precedence from resolved pin roles
  and infers unset interface directions through passive connectivity
  (stopping at rails, including Nets with an explicit ground/vdd name claim,
  and directed-pin Nets); opportunities are placed
  input/output port pairs and device input/output pin pairs, and an output
  left of its input violates. `netlistSymmetry` validates a nontrivial
  connectivity-graph involution containing a transistor pair (same symbol and
  model, pin roles kept, reversible passive ends, rails and self-mapped Nets
  fixed), with a deterministic search of at most 10,000 candidate
  assignments and 256 devices per component (an incomplete search contributes
  nothing); each placed swapped pair is an opportunity and violates if its
  visible centres differ in y by more than one grid or are not reflected
  within one grid about the component's median pair-midpoint axis. Its fitted
  evaluation weight is currently zero (reported only).

  After quick/search selection, a movable non-rail port with one routed departure faces that
  wire, keeping the terminal's world position fixed. Keep the old orientation
  when rotation would move the envelope's top/left, overlap a part, or violate
  the routing audit. Fixed ports, rail ports and trunk taps retain their existing
  conventions. Reseat the selected result and replay its whole edit list.
  Apply this correction only to the selected plan: correcting facing inside the
  search can change a tied placement to one whose next cleanup the frozen
  partition guard refuses. This changes port artwork only; routing, marker stubs, R10,
  R23 and name-claim protection remain unchanged.

- **R80 — Logical branches and families.** MOS uses D/G/S; BJT uses C/B/E.
  Polarity is n for nmos-class MOS and NPN, p for pmos-class MOS and PNP.
  Descriptor ids must match; when both instances have model identities,
  those identities must match too (model name or external-subcircuit definition).
  Depletion MOS and DMOS pair only with their own descriptor id: `nmos`,
  `depletion-nmos` and `ndmos` are three distinct families, as are their p
  equivalents. Never compare sizes or parameters.
  Instances with equal descriptor, model identity and every symbol-pin Net
  (including equally unconnected pins) form one logical branch. Its lowest id
  is the representative; every structure member lists all branch instances.
  Recognition never resolves structural ties by id, except the retained
  matched-pair fallback in R5. Sort structures by kind and lowest instance id,
  members by role then lowest id, and instance lists ascending.

- **R81 — Pair tails.** On a pair's common source/emitter Net N, count tail
  candidates by branch, excluding the pair itself: a same-polarity transistor
  with drain/collector on N; a current source with + on N for n pairs or − on
  N for p pairs and its other terminal off N; or a resistor between N and
  ground for n pairs or supply for p pairs. Exactly one candidate gets the
  `tail` role; two qualifying parallel branches get both tail roles under R91.
  Other multiple candidates give a tail ambiguity and no tail. Zero candidates
  leaves a valid pair without a tail. One tail may support multiple pairs.
  Placement uses the pair members' polarity: the tail lies one row below n
  pairs or above p pairs, including shared tails and tails in mirror units.
  The netlist refinement's current-source tail step uses the same polarity (R170).

- **R82 — Differential pair with mirror load.** A mirror reference drain on
  input A's drain and an output drain on input B's distinct drain form a
  `differential-pair-mirror-load`. Roles are `input-reference-side`,
  `input-output-side`, `load-reference`, `load-output`, and optional `tail`.
  A load touching only one drain is insufficient. On source Nets with three
  or more candidates, accept only pairs identified uniquely by one such
  composite. A candidate fitting multiple composites remains unpaired and
  ambiguous. Other mirror outputs are not members of that composite.

- **R83 — Movement units and persisted groups.** Choose units in cross-coupled,
  differential-pair, mirror, common-gate, matched order. Split tails form their
  own matched unit. A unit has two ascending branch
  representatives, unless stacked-unit alignment follows its anchor's left/right
  channel Nets, including chains. Skip a unit if either representative already belongs to
  a unit or persisted layout group. Tails may overlap units. Mirror partners
  prefer an output in a composite whose pair is already a unit; otherwise
  choose the lowest output representative. Keep `diodeInstanceId` and
  `tailInstanceId` as representatives. Cross-coupled and common-gate units use
  `matched-pair`. Facing defaults to outward for differential pairs and inward
  for other kinds; R92 permits an explicit override.
  Ids remain `auto-<kind>-<lower member id>`.
  Sorted `extraMemberIds` holds other outputs and fingers, excluding tails
  and existing layout-group members; omit an empty list. Extra members place
  freely, but `set_layout_group.objectIds` persists members plus extras.
  Persisted templates use the same unit builder, restricted to the persisted
  group: mirrors keep their reference and lowest output representative within
  that group; pairs keep both members and their recognized tail. Apply the same
  stacked-load reversal. Routing continues to use movement units.
  Template channel helpers align BJT C/E just as MOS D/S and include BJTs in
  template row ranking. BJT-only documents keep the generic fallback for the
  layered strategy; layered BJT level and row rules are unchanged.

- **R84 — Recognition benchmark.** Committed JSON cases contain `id`, `source`,
  `symbols`, `nets` (`instance.pin` lists), optional `models` and `deferred`,
  optional `deferredByKind: {kind: ids[]}`, and `expected` structures with
  instance-to-role maps, including `common-gate-pair` with two `member` roles
  and pairs with two `tail` members. Expectations can mark
  `tailUnlabeled`. The scorer matches equal instance sets of the same kind
  one-to-one; exact matches additionally require every role equal. Exclude
  unlabeled tails from comparison. Before checking prediction eligibility,
  remove any deferred tail member and compare that structure as tail-unlabeled,
  including composites. Exclude any expected or remaining predicted structure
  containing a deferred instance, globally or for its kind. Score only kinds
  labeled by each source;
  count other predictions separately. Precision is matched/predicted, recall
  matched/expected, and exact rate exact/expected; an empty denominator yields
  one. Report labeled-tail outcomes (correct, wrong, missed, ambiguous) and
  per-case missing, unexpected and role mismatches.
  LOADBench conversion uses the first op-amp subcircuit, rewrites MOS X lines
  as M and capacitors as 1p, grounds sourceNmos and adds a supply and primitive
  models. Merge XML simple mirrors by reference-device set; label normal-array
  pair inputs, leaving tails unlabeled, and label composites by drain Nets.
  Defer devices in cascode, wide-swing, Wilson, improved-Wilson mirrors,
  folded/cascoded differential pairs and voltage references. Label every
  `MosfetGateConnectedCouple` by its two normal arrays; for common-gate scoring
  only, folded/cascoded differential pairs are not deferred. Cascode-mirror
  deferral still applies.
  CircuitGenome conversion strips the flat subcircuit wrapper, grounds gnd!,
  adds supply/models and reads hierarchical slot variants. Label ordinary
  input pairs, simple mirror/resistor tails and active mirror loads, including
  same-gate/source outputs anywhere in the circuit. Defer every other slot or
  variant except ordinary resistor/current-source loads, which label no
  structure. Telescopic/folded load variants also label same-bias-gate pairs
  whose sources are in1/in2 or the drains of an already-labeled common-gate
  pair, using hierarchical bias port bindings. Those devices remain deferred
  for other kinds. Pair and composite expectations leave tails unlabeled whenever
  the tail_current slot is deferred. Imported committed cases carry explicit ground markers and MIT
  provenance. No local dataset or human drawing is required by tests.
  Run `pnpm auto-layout:recognition [--loadbench <dir>] [--circuitgenome <dir>]
[--units] [--out <file>]`. It always scores committed cases, prints source
  and kind tables and optionally writes JSON mismatches. `--units` scores the
  placement representation (mirror reference/output and pair input/tail),
  including common-gate units by their recognized identity and both split tails,
  but ignoring ordinary matched units. `--emit-cases <file>` with `--circuitgenome` emits up
  to six attributed fixtures totaling less than 20 KB. Hand cases require
  exact recognition under three seeded bijective renames and order shuffles.

- **R85 — Base-Net clearance.** Auto-layout asks every Net route and stub,
  including fallback stubs, to keep other Base Nets clear, even when names
  join them into one Logical Net. Foreign pins and wires cannot be touched
  or followed; proper wire crossings remain allowed. Refusal messages retain
  Logical Net names. The Edit Engine's default Logical Net scope is unchanged.

- **R86 — Rail fallback and partial Nets.** Auto-layout enables partial routing.
  A blocked trunk branch is omitted; a tree stops when no remaining component
  has a clear path. Record each unjoined component's endpoints and first router
  refusal verbatim. Still refuse a blocked trunk, a missing tree seed, or a
  result joining fewer than two components. For a rail, try a plain tree only
  if the trunk threw or left components unjoined. Compare candidates by
  `[unjoined components, crossings, bends, wireLength]`, retaining the earlier
  candidate on ties; preview and audit only when comparing alternatives.
  Draw the winner, report remaining pins under R14, and label disconnected
  components of named Nets. `missingConnections` sums physical component
  counts minus one for each Base Net, using all visible symbol pins except MOS
  bulk (pins hidden by the selected symbol variant's artwork are not audited).
  As with named power markers, distinct components of one Base Net that each
  carry a named `port` or `port-filled` count as logically joined. Unmarked
  components still need a drawn connection, and floating pins remain physical
  defects regardless of marker names.
  R22's existing `unrouted` weight applies to that count in every ranking and
  search. Default Edit Engine calls remain all-or-nothing.

- **R87 — Crossing-aware paths.** Auto-layout adds a cost of `20 × grid` for
  each proper crossing with another Base Net's wire. A proper crossing is a
  strict interior intersection; endpoint touches and collinear runs remain
  clearance conflicts. R22 values one crossing at ten bends, and the bounded
  router charges two grid steps per bend, giving the twenty-grid exchange
  rate. Collect foreign segments once per clearance, indexed by orientation
  and coordinate; only non-axis-aligned segments may be scanned. Clearance checks
  skip pins, parts and foreign Routes whose padded bounds miss the path; the result of
  every check is unchanged. The crossing cost is an optional path-length cost,
  zero by default, leaving Agent/editor routing
  unchanged. The first pass's order is unchanged; R95 reroutes afterwards
  without changing placement.

- **R88 — Seeded symmetry.** Detect an involution over devices and Base Nets
  from R81 differential input representatives and cross-coupled pairs, independently
  of placements and persisted layout groups. Rails map to themselves; markers
  are excluded. Paired devices imply paired Nets through their pin correspondence:
  equal pin names, including MOS bulk, except for R142 non-polar passives.
  Paired Nets imply same-symbol, family-compatible devices only for mutually unique
  unmapped candidates at the same pin name, or either passive pin under R142. A self Net
  similarly pairs mutually unique devices, except on rails: rail connectivity
  never pairs devices. An unmapped device whose connected
  Nets all map to themselves and that has no unmapped identical-topology twin
  maps to itself. A two-pin non-polar passive spanning a distinct mirrored pair
  of non-rail Nets also maps to itself with reversed pins when no other free
  compatible device spans that unordered pair. Compute implications from the preceding round, then apply
  together to a fixpoint. Shared connections propose self mappings only as
  defaults: non-self Net proposals replace them, including defaults from earlier
  rounds. Rails remain hard self mappings. Different non-self proposals for a
  Net conflict, removing that Net and its proposed partners permanently; nothing
  propagates through them. Conflicts between pairs never invalidate device pairs.
  A pair whose own pins propose two different non-self partners for one Net is
  invalid and its devices are conflicted; shared defaults do not count.
  Device-level partner disagreements also remove device mappings, and ids never
  resolve a detection tie. Join pairs and axis devices through non-rail Nets
  and retain only components containing a seed. The seed pair with the lowest
  member id establishes left/right with its lower-id member left; sides propagate
  through the component. Pairs reached only through self Nets use the same
  lower-id-left drawing convention. Report partner pairs, axis devices and
  touched conflicted devices. When R88 finds no component in an unpartitioned
  layout, the `mirrorSymmetry` finalist can use T087's exact netlist involution
  for a component with at least two pairs and a transistor pair. Components
  containing directed blocks or hierarchical pins are excluded. Map the matched
  pins' logical Nets to a Base Net involution and place the component on one
  axis and try layered and template drafts. Both symmetry finalists can enter
  finishing with a distinct, complete draft within the runner margin, with
  fewer crossings, or with fewer netlist symmetry violations, equal crossings
  and at most 2.2 times the incumbent's routed score. Both must strictly improve
  the finished comparison and routed score, with no routing or visual guard
  increases, including label-owner distance. If netlist symmetry violations
  fall and crossings do not increase, a higher readability term or new minor
  violations may be accepted. Zero baselines still veto new crossings, rail
  crossings, source polarity violations, wires through symbols and unowned
  drafting. Otherwise the usual readability term and zero-baseline rules apply.

- **R89 — Symmetric blocks.** Partners start on the smaller R31 row and axis devices
  start on their R31 rows. Build a half Document from left partners and axis devices,
  folding right Nets onto left Nets. Reuse R32 and R33 with these rows and only
  groups contained in the half, moving axis devices to each row's right end.
  Cross-coupled members (mutual G/D or B/C Nets) come immediately before axis
  devices, keeping all other nodes in their prior order.
  Before column assignment, orient recognized left members by R92: outward
  `none`, inward `horizontal`. Other paired devices with a gate use
  `horizontal` when the gate Net is self-mapped, otherwise `none`. Two-pin parts
  and axis devices keep R31 orientation except for cross-branch axis bridges.
  Centre each bridge on the axis and rotate it horizontally so its left pin
  faces the branch on its Net. Stack parallel bridges between the first two
  connected branch rows, moving the lower rows down for clearance. With a
  single connected row, centre the stack vertically on that row. Resistors
  precede capacitors, then inductors, with device id breaking ties. Keep at
  least 40 units between the bridge and the visible extent of the left half.
  The remaining axis devices sharing a row form one run in half-layout order with at least
  40-unit gaps between visible bounds, origins snapped up to the grid, and its
  pin-centre midpoint within half a grid of the axis. A lone axis
  device centres its channel pin (D/S or C/E), otherwise its pin centre.
  Choose the smallest grid axis A giving every pair origin pitch
  `2·(A − x_left) ≥ member pitch` (R154), keeping each row's left visible
  extent at least 20 units left of A and, if that row has an axis run, at least
  40 units left of the centred run's left edge. Reflect each left placement
  about the axis, including orientation, to produce its right partner.
  Preserve these relative offsets as one rigid block. Each occupied row has
  one node: left partners in half-layout order, axis devices, then right partners
  in reverse. Register all block rows as one alignment component before outside
  R18 stack links; row compaction and median pulls translate the whole block.
  Blocks that share rows keep one left-to-right order in every row;
  `orderRows` enforces it inside its sweeps.
  Outside devices sharing a block row sit beside its span, never inside it;
  skip an R18 alignment that would violate that row order.

- **R90 — Anchored common-gate pairs.** Two compatible branches sharing G,
  with distinct non-rail S and distinct D, neither diode-connected nor D=S,
  outside mirror, differential, cross-coupled and matched structures, are
  candidates. Accept only if their two sources match a recognized symmetric
  unit's two drains by side, or their two drains match its two sources.
  Symmetric anchors are differential, cross-coupled, matched or common-gate
  pairs. Iterate to a fixed point. Reachable candidates sharing a branch are
  ambiguous; reject both rather than choosing by id, and do not use rejected
  anchors to support a chain. Each accepted structure has two `member` roles.
  Movement and persistence use `matched-pair`, aligned by the anchor's sides.
  A mirror on a common-gate chain's drains also forms the input pair's
  composite, preserving the input-reference/output sides and its tails.

- **R91 — Split tails.** Exactly two tail candidates on a pair's common-source
  Net N are split tails when both are same-polarity transistors with D on N,
  compatible families, the same S Net and distinct connected G Nets. Both
  carry `tail`; composites include both. The pair's `tailInstanceId` is the
  lower representative. The two tail representatives form a `matched-pair`
  movement unit with `facing: "outward"`, centered on the pair axis one row
  toward the supply. Other multiple-candidate cases remain ambiguous under R81.

- **R92 — Template facing.** `RecognizedGroup.facing` optionally selects
  `inward` or `outward`. The default is outward for differential pairs and
  inward for all other kinds. Template and layered placement both use it:
  outward means left unmirrored/right horizontally mirrored; inward reverses
  those orientations. Only split-tail units set an explicit facing. Their
  single-host gate ports use the existing R71 seats.

- **R93 — Two-gate axis seats.** In the R71 local-seat pass, in port id order,
  a non-rail port whose Net reaches exactly two device pins, both gates
  (MOS G or BJT B), gets an axis seat if the gates lie on one horizontal line
  and their exits face each other. Place it at the midpoint x, half
  `CELL_PIN_OFFSET` (snapped to the grid) above the gate line, facing that
  line with R71's orientation. If the R71 overlap check rejects it, try below.
  If both seats overlap, use unchanged R19/R20 edge seating. This rule reads
  geometry, not recognition, and honors fixed ports and forced edge reseating.
  The chosen axis seat remains the incumbent when R146 searches alternatives.

- **R94 — Symmetry across strategies and search.** In default mode use R145
  stage components; with a partition retain R88 components and the existing
  partition-local trimming. Join all component members into a stage and forbid
  mirroring that stage. Stage-local placement
  uses R89. Template placement uses one component template instead of its
  contained group templates, removing its members from ranked singles. An outside
  unit containing a block pair's tail retains R7 seating on the block axis one
  row toward the supply. Detect topology once per placement call and pass its
  components and Net map through the strategies and half layout.
  Annealing moves all block members together and cannot mirror a containing
  stage. Collision repair translates whole blocks. Given-state finishing
  refuses any change to a block's relative positions or orientations. Conflicted
  and unmapped devices retain the existing placement rules around the block.

- **R95 — Bounded rip-up and reroute.** After the R12–R14 first pass, count
  distinct proper crossings per Base Net, attributing each crossing to both
  Nets. Consider signal frozen groups with crossings in descending count,
  breaking ties by R13 order. Power groups keep their first-pass routing.
  Remove only the candidate group's authored Routes, Junctions and R14 labels
  through validated edits, then rerun the same contacts, trunk candidates,
  partial routing and crossing cost against all retained geometry. Keep the
  retry only if `[missing connections, crossings, bends, wire length]` is
  strictly smaller lexicographically. Failed or non-improving retries retain
  the prior edits and diagnostics exactly. Replace the group's R14 warning
  and fallback labels with those warranted by its accepted routing.
  Compute candidates at the start of a single pass, at every instance count.
  Transactional removal advances the planning revision beyond retained edits,
  preventing generated Route id
  collisions. Whole-list replay reproduces the accepted geometry and audit.
  Routing and candidate ordering are deterministic. The internal routing
  option defaults off; Editor and Agent routing defaults do not change.
- **R96 — Finalist-only rerouting.** After R72 repair, replan the
  selected placement once with exact placements and R95 enabled; the R44
  alternative stays a plain replan. Replace the selected finalist only if its
  R22 routed score strictly decreases, then compare them with R44 as before.
  Apply the same procedure to offline search's final best and, through 40
  instances, R58's other complete refined finalist. Initial strategy
  ranking, R58 refinement candidates and annealing evaluations never run R95; finalist
  replans do not count as refinement candidates.

- **R97 — Column compaction.** After R72 repair and R96 rerouting, compact only
  the R44 winner (a strictly lower R22 score selects the alternative; ties keep
  the current plan). Occupied x intervals comprise each visible instance bound
  widened by `MARGIN = 20`; each vertical wire and Junction widened by
  `WIRE_MARGIN = 10`; and both ends of each horizontal wire widened by
  `WIRE_MARGIN`. A horizontal segment ending on a Cell Pin's pin occupies its
  whole length, preserving R71 seats. Preserve the whole span from the device
  box (excluding Cell Pins and power markers) to each entirely external Cell
  Pin box, preserving R8 seats. Each rigid unit occupies its members' bounding
  span widened by `MARGIN`.
  Derive rigid units from the routed finalist: persisted layout groups;
  structures recognized with layout groups cleared, including extras, tails and
  diode members; and each R88 symmetry component's pairs and axis devices.
  Search gaps only between the lowest and highest instance bounds, floor their
  widths to the Document grid, and discard zero-width gaps. Move each instance
  left by the sum of gaps ending at or before its bounds' left edge. The enclosing
  box's left edge, y coordinates and left-to-right order never change.
  Replan these exact placements once with R95 and the winner's signal-trunk
  setting; accept only a strict R22 routed-score decrease. Skip compaction for
  fixed instances (including locked groups/constraints), missing final Documents
  or infinite scores. Partitioned layouts compact only in optimized quality
  with search enabled and no explicit arrangement. Each partition block is a
  rigid unit. Both axes must pass the wire comparison and preserve or reduce
  block intrusion. This column pass adds at most one exact replan;
  strategy ranking, refinement candidates and annealing evaluations never
  compact, and this replan is not a refinement candidate.
- **R98 — Fresh generated ids.** Every Route, Junction and label id generated by
  auto-layout differs from every object id in its input Document, including
  objects removed by the same edit list. Routing reserves these identities and
  deterministically salts a colliding derivation until it is free, including
  wire-derived Junction and split-Route ids. Without reservations, editor and
  Agent routing retain their existing id choices and behavior.

- **R130a — Partition validation and local templates.** Only recognition
  unit splits cause planner merges. Preserve the diagnostic text `L0 structure
split across …; merged into …` for evaluation tooling. Trim each recognized
  or persisted group to each block's members, including parallel members;
  fewer than two surviving members no longer form a group. Drop tail and diode
  references outside that block. Symmetry components retain whole local pairs
  and local axis/conflict members; a lone pair member is unconstrained. Placement
  trims groups and symmetry against the joined blocks defined by R140.
- **R130 — Partition stage ordering.** Without an oracle `arrangement`, feed
  partition blocks through R53/R54 ordering and mirroring, R57 signal direction,
  R56 spacing and R59 shunt attachment within the owning block. Compare a second
  row for `bias`, `cmfb` and `compensation` blocks against a single row using the
  same estimator; roles never force the side row. Input/output roles may supply
  R57 direction when interface hosts do not. The V2 floorplan stays available.
  Retain a single-row candidate in the routed strategy comparison, since an
  estimated side-row improvement can become a routing regression.
- **R131 — Soft block boundaries.** `blockIntrusion` counts distinct devices
  whose final visible bounds intersect another block's enclosing visible bounds.
  Count a device only once even if it intersects multiple foreign boxes. Add
  `500 * blockIntrusion` to the routed score only when a partition is supplied,
  using `ROUTED_SCORE_WEIGHTS.blockIntrusion`. Boundaries do not refuse finishing.
  Report the count through `refinementMetrics` after final facing/label seating.
- **R132 — Partition annealing.** Stage-block translations, swaps, reversals and
  eligible mirrors use R140's joined partition blocks, regardless of the starting strategy.
  Keep rigid unit moves within their owning block. When R130 selects two rows,
  also propose exchanging whole blocks between the signal and side rows.
  Acceptance uses the full routed score, including R131. R67 bounds and all
  existing fixed-instance, transaction and electrical invariants still apply.
- **R133 — Partition determinism and safety.** Quick placement is deterministic;
  search repeats for a given seed and evaluation budget without a deadline.
  Deadline/abort requests retain the existing bounded-search semantics. Every
  accepted result passes the existing replay, connectivity and name-claim checks.
  Omitting the partition keeps the default output unchanged.
- **R134 — Partition fallback.** If a valid partition without `arrangement`
  produces an error or no edits, replan without it using the same other options.
  Return the default result, partition validation diagnostics, and warning
  `AUTO_LAYOUT_PARTITION_FALLBACK` (rule `partition`) carrying the first problem.
  Measure final block intrusion against the validated partition. Invalid partitions
  and the explicit `arrangement` path retain their refusal behavior.
  Report fallback counts per split, block intrusion and block-local symmetry
  (`pairs`, `mirrored`, `level`, `orientationMirrored`, `axisDevices`, `onAxis`)
  alongside the unchanged whole-component symmetry, arrangement agreement and
  area metrics. Block symmetry uses surviving within-block pairs about local axes. Accept
  `--partition llm --search <seconds>`. Tune only on dev; keep third-party cases
  and all case-keyed artifacts git-ignored. Rule-only smoke runs use `--samples 0`.

- **R140 — Symmetric stacks.** Without an `arrangement`, derive placement blocks
  from whole-Document R88 symmetry components. For each component, join two blocks
  containing any of its pair or axis devices when their own members share a
  non-rail Net on R50 DC-conducting pins. Joins are transitive; gate-only and
  rail-only connections do not join blocks. Each joined block keeps the first
  block's id and title in partition order, concatenates members in partition
  order, and keeps the common role only when all joined roles agree, otherwise
  `other`. Rename flow ids to their surviving id and remove repeats. Unjoined
  blocks remain unchanged; derivation does not depend on placement geometry.
  Placement uses these blocks for R130 ordering and local layout, R130a group
  and symmetry trimming, R59 attachments and R132 annealing. Validation, R131
  scoring, R134 fallback, layout-group records and metrics keep the supplied
  partition. No-partition and explicit `arrangement` paths remain unchanged.

- **R141 — LLM layout entry.** `planAutoLayoutWithLlm(document, resolver, options)`
  is the asynchronous entry for an injected `llm` partitioner. `LlmPartitioner`
  receives `{ system, payload, sample, anonymize }` and returns a promise of a
  shape-valid `LlmPartitionResult` or `undefined` for no usable answer. The package
  performs no network access. `llmPartition` builds the unchanged circuit payload
  once, including optional fingerprint `entries`, and requests zero-based samples
  concurrently (default three; anonymization defaults to false). Rejected or
  missing answers are skipped; usable answers are reconciled in sample order.
  It returns the partition, statistics, reconciliation diagnostics and per-sample
  `answered`/`missing` status. With no usable answer its partition is undefined.
  The layout entry plans with the reconciled partition and appends reconciliation
  diagnostics as R141 warnings (`AUTO_LAYOUT_LLM_RECONCILED`). With no answer it
  returns the default plan plus `AUTO_LAYOUT_LLM_UNAVAILABLE`, an R141 warning
  without provider details. An explicit `options.partition` or absent `options.llm`
  bypasses the partitioner and calls `planAutoLayout` unchanged. Identical answers
  produce byte-identical results. The evaluation script uses a cache-only
  partitioner and `llmPartition`; for measurement compatibility its no-answer path
  still plans with the rule-only partition.
  With optimized quality and a positive search budget, partition placement can
  compress empty space between rigid blocks and reroute crossed nets at fixed
  device positions. An explicit arrangement keeps its block spacing. For inferred
  partitions using the default budget, the asynchronous entry also evaluates one
  ordinary optimized plan. An explicit search budget goes to the partitioned plan.
  A fully connected, safe alternative may replace an incomplete drawing, or a
  complete drawing when wire length, bends and crossings weakly improve, at least
  one strictly improves, label overlaps do not increase, and the total routed score
  (including readability) decreases. The entry
  records the choice with an `AUTO_LAYOUT_PARTITION_FALLBACK` diagnostic. A tie
  retains the proposed blocks.
- **R142 — Non-polar passives.** Same-symbol, family-compatible resistors,
  capacitors and inductors with exactly two pins pair by their unordered pair of
  Nets. Select the pin correspondence that agrees with non-self entries of the
  current Net involution, ignoring self-mapped defaults; prefer equal pin names
  when both orders fit or there is no non-self evidence. Seeds and all other
  devices keep equal pin names. Use the selected correspondence for device-pair validation, Net implications and axis-twin checks.
  A free passive with pin `p` on a non-self mapped Net `n ↔ m` finds candidates
  with any pin `q` on `m`. Use `p ↔ q` and map the remaining pins to each other,
  without requiring anything of the other Nets. Candidates must remain mutually
  unique in both directions. Self-Net candidate matching retains equal pin names.
  Every pre-existing pair retains its correspondence; only swapped passive pairs
  are added. Passives whose Nets both map to themselves retain the axis rule, including the exclusion of identical-topology twins regardless of
  pin order. A unique passive between two distinct mirrored non-rail Nets follows
  the R88 axis bridge rule.
- **R143 — Coupled modules.** Prompt version 5 adds `cross-coupled` for a
  regenerative transistor pair driving each other's control pins (latch,
  comparator core, negative-resistance core or load), and `coupled-inductors`
  for magnetically coupled inductors (transformer, coupled tank or balun).
  The electrical payload includes `couplings: [{ members: [deviceId, deviceId], k }]`,
  sorted by member ids and then canonically by record; anonymization replaces
  these ids too. Canonical device ordering includes valid couplings as edges
  in both directions, labelled by `k` text and the endpoint's dotted pin.
  Anonymous unit and structure hints assign primary/secondary roles in alias
  order, so interchangeable windings still produce identical payloads under
  instance reordering. Omit the key when no coupling exists. Keep each coupling
  in one block. Recognition reports valid two-inductor couplings with `primary`
  and `secondary` roles in recorded member order; missing, non-inductor or
  invalid-dot members are ignored. Magnetic coupling forms an atomic unit
  across isolated windings, independent of rail and stage boundaries.
  A block consisting of a recognized cross-coupled pair or coupled-inductor
  pair receives its corresponding role and title. Cross-coupled candidates
  also join across R50 stages, keeping a rail-fed latch in one atomic unit.
  Placement joins connected components of valid couplings into one
  `matched-pair` movement/persistence template per component, while recognition
  keeps one structure per coupling. The two lowest ids are `members`; the rest
  are sorted `extraMemberIds`. `coupledDotPins` has one entry per member in
  member then extra-member order. If a winding has conflicting dotted pins,
  use its coupling with the lowest coupling id to choose the dotted pin.
  Every successful plan, including quick, search and partition plans, emits one
  R143 `warning` with code `AUTO_LAYOUT_COUPLING_DOT_CONFLICT` per conflicting
  winding, naming the member and coupling ids.
  In all three strategies, inductors are vertical and side by side in id order, with `MEMBER_PITCH`
  between pin columns and dotted pins level at the top. A top/bottom reflection
  accommodates opposite electrical dot pins and different winding lengths.
  Anchor the component at its first fixed member, or its first member when none
  is fixed. Collision repair and annealing translate the whole component
  rigidly. Conflicting fixed placements refuse the template. The coupling and its members survive commit
  unchanged; no model or connectivity edit is introduced.
  Block connectivity accepts non-rail nets (excluding MOS bulk pins) or valid
  listed couplings, so isolated primary and secondary circuits may share a block.
- **R144 — Cross-coupled X.** After R97, replan the R44 winner's exact placements
  once with R95 `ripUp` and the router's optional `crossX: true`, preserving the
  winner's signal-trunk setting. Skip fixed instances and Documents without a
  recognized cross-coupled pair. Keep the candidate only when its R22 routed
  score is no higher; ties keep the X as the drawing convention. Strategy ranking,
  refinement candidates and annealing evaluations never enable `crossX`.
  Before R13, for each placed two-device cross-coupled pair, connect each control
  pin G (MOS) or B (BJT) to the opposite output D or C when they share a Net.
  For control point g and output d, let up be the vertical direction from g to d
  and corner = `(d.x, g.y + up * abs(d.x - g.x))`. Skip zero horizontal or vertical
  separation and corners falling short of d. Plan g → corner → d with
  `routingMode: "octilinear"`, the corner as the sole waypoint, and R98-reserved
  ids. Preview without orthogonal keep-clear replanning; retain a wire only if
  the preview succeeds and the routing audit's problem count does not grow.
  R13 connects the remaining members of every Net. R95 retains Nets seeded with
  X wires, including any pieces reconciliation splits while routing the rest.

- **R145 — Stage symmetry.** In default mode split each R88 component by
  conduction: union pair members, then devices sharing a non-rail Net on R50
  conducting pins. Each resulting part with at least two pairs becomes a stage
  component. Merge all smaller parts (single pairs and axis-only parts) into the
  part with the most pairs, breaking ties by the first pair in component order.
  If only one component remains, retain the original component unchanged.
  Preserve pair and axis order and copy the original conflicted list to every
  stage component. This depends on topology, never placement or Document
  instance, Net or terminal order. Each stage gets its own R89 block and axis
  through R94 in every placement strategy, collision repair and frozen sets.
  Annealing and R97 compaction use the same stage components as rigid units.
  When R145 splits a component, an `unsplitSymmetry` finalist can keep it on a
  single axis. Try the selected strategy, layered and template, and take the
  best distinct strategy draft by the routed comparator. It competes through
  `selectFinishedLayout` under the R88 symmetry-finalist guards. Partition
  placement continues to use the whole-component R88 view.

- **R146 — Routed port-seat search.** In default mode, for documents of at
  most 40 instances and a nonzero search budget, search non-rail `port` and
  `port-filled` instances in id order against the finished incumbent.
  Start from the short R71 defaults, then retain the finished-layout search
  and R148 rail search.
  For every device pin on the port's Net, generate grid-snapped seats 20, 40, 80
  and 120 units along its transformed exit, facing the host. For multi-host
  Nets also generate seats 40 units outward from the coordinate median and
  each pair midpoint, facing inward. Include the current seat and R19/R20
  fallback on both sides with other ports held fixed; deduplicate and reject
  overlap and unlicensed coincident pins, preserving validated R38 contacts.
  Preserve device and rail placement relative to one another;
  when nothing is fixed, translate all placements together to restore the
  incumbent's top-left anchor within R1's half-grid tolerance. Fixed and locked
  instances never move.
  Append the T073 conventional horizontal seat beyond the outermost directed
  host after existing candidates, preserving estimate ties and the trial cap.
  Rank alternatives by R54's non-rail Manhattan MST length and estimated
  crossings, weighted 4 and 1000. Do not add the removed host-position
  convention proxy to the shortlist estimate. Apply the straight-join seat filter before
  shortlisting: consider obstructing seats only if no clear alternative exists,
  and reject finishing that turns a clear seat into an obstructing one.
  Fully evaluate the best two clear seats per port (or one blocked fallback), at
  most 12 trials total, scaled by instance count under R66, with no wall-clock budget. Each trial runs the normal
  R72, R95/R96, R97, facing, local rerouting and label passes before comparison.
  Regenerate seats from the finished geometry without the incumbent seat:
  the trial port and every port already selected in this pass must still occupy
  a generated position after compaction or other finalist repairs.
  Compare physical completeness first as in R22; at equal completeness accept
  only a strictly lower R74 score with wire weight 4 and finished visible span
  weight 0.5 (R149, T059 dev refit). Other R74 comparisons
  retain wire weight 0.1 and no span term. Reject any increase in finished floating pins,
  missing connections or any `VISUAL_*` count except the zero-readability-weight
  label clearance and label owner distance. T074 corpus totals must stay at or
  below main except label clearance and the accepted owner-distance increase of one.
  Label clearance is reported but is no longer a corpus gate. Keep the incumbent on ties.
  Global input/output order enters the frozen readability term after routing;
  host-side convention is a candidate option, not a score proxy or filter.
  Successful partition planning, optimized quality, zero-budget planning and
  documents above 40 instances retain their prior behavior. R134 partition
  fallback runs plain planning, including R147 and R146.

- **R147 — Routed device relocation.** In default mode, for at most 40
  instances and a nonzero search budget, run one deterministic coordinate pass
  over rigid device units before R146. Reuse R66's recognized structures,
  attachments and symmetry units; join user groups, constraints, couplings and
  already pin-aligned vertical conducting stacks. A fixed or locked member
  freezes its entire unit. Multi-device units translate without changing their
  relative positions or orientations; free single devices may take any quarter
  turn or reflection.
  For each non-rail connection to a device in another unit, align the moving
  pin to the other pin's transformed exit, facing it at 40 or 80 units. Reject
  off-grid poses and bounds that overlap another instance or its two-grid
  clearance. Deduplicate poses, rank by R54 crossing estimate plus non-rail
  Manhattan MST length divided by 250, and shortlist the best two per unit.
  On physically complete layouts, skip speculative alignment proposals with
  no estimated crossing reduction and over 5% more estimated wire. Retain
  their consumed budget slots so this cannot expand the later gap pass.
  Incomplete layouts and gap proposals retain their full trials. Finish with
  at most ten trials total, scaled under R66. This count is shared with R149 and separate from R66's annealing and
  R146's port-seat budgets; it has no wall-clock cutoff.
  Use R146's complete finalist finishing path, readability-augmented calibrated
  score and guards; replan each trial with R148's licensed contacts (R140's
  declared-pair policy: any two pins declared on one Net may abut, drawn or
  not), so a contact in the finalist does not refuse the trial while a
  coincidence across Nets or with an undeclared pin still does. R147's
  candidates keep two grid steps of clearance and so cannot create a new
  contact. Decline a trial that takes a feedback part out of its row: a
  two-pin part that is not a directed block, across two non-rail Nets of one
  signal block, lies in its row when it is horizontal and exactly one
  placement row above or below that block, and such a part stays in its row
  on the same side. The guard reads the trial's proposed placements before
  the replan, against the alignment-phase incumbent, on placement origins;
  compactRows binds the same pair while finishing. It applies to every
  document, also one without any pin contact;
  keep ties and reject any finished rigid-unit distortion. Preserve the
  incumbent anchor by a whole-placement grid translation when nothing is
  fixed. Optimized, successful partition, zero-budget and above-40-instance
  planning retain their prior behavior. R134 partition fallback uses this
  search under the same conditions as plain planning.

- **R148 — Finished rail search.** After R147 and R146, in default mode with
  a nonzero search budget and at most 40 instances, search existing one-pin
  markers on crossed rail Nets. This search keeps marker count and orientation;
  R155 may add markers afterwards. Do not use
  device-family eligibility to choose a host. At each non-bulk device pin on
  the rail, propose seats 20 or 40 units along the transformed pin exit and on
  the rail's supply/ground side. Snap to the grid, reject geometry conflicts,
  deduplicate, and rank by the shortest Manhattan branch to a rail device pin.
  Finish the best two seats per marker, with at most eight trials overall,
  scaled by instance count under R66.
  Check the moved marker against other pins and bounds, retaining unrelated
  legal contacts. Markers belonging to user groups or constraints, and fixed
  markers, stay put. Preserve licensed contacts through R140's declared-pair
  policy. Use R146's complete finishing path, readability-augmented calibrated
  score and all routed
  guards; retain the incumbent on ties.
  Then retry at most three crossed rail Nets against the retained signal
  geometry, ordered by crossing count with stable Net-id ties. Compare a tree
  and at most five horizontal trunk tracks: the rail pin envelope's low/high
  levels, its grid-snapped centre, and one grid step outside either level.
  Preserve direct contacts and protected or locked routing by skipping those
  Nets. Replay and finish labels before comparing each candidate. Require a
  strictly better calibrated score. Crossings, bends and wire may increase
  only with a strictly lower frozen readability composite. Require no lost name
  claim or terminal partition change, and no routing, connectivity
  or `VISUAL_*` guard regression. Keep earlier candidates on ties. All bounds
  are evaluation counts, with caller cancellation checked between trials.
  Optimized, successful partition, zero-budget and above-40-instance planning
  retain their prior behavior; R134 fallback uses plain planning's search.

- **R149 — Finished compactness and gap closing.** R146, R147 and R148
  add half the finished visible width plus height to their calibrated
  score. T059 refits crossings, bends, wire and visible span together against
  dev human placements, retaining the other R74 terms: crossing weight 1000,
  bend weight 100, wire weight 4 and span weight 0.5. A 120-unit span reduction
  is worth 60, less than one added bend. Add R74's frozen readability term.
  A strict improvement in physical completeness takes priority over soft
  crossing/bend vetoes. At equal completeness, a strict decrease in the frozen
  composite also overrides these vetoes, including gap moves; all hard routed
  guards still apply.
  Otherwise, independently of the weighted score,
  all three searches reject any increase in finished crossings or bends when
  the span term drives acceptance (the trial would not strictly improve T058's
  wire-weighted score). Trials that also improve the wire-weighted score retain
  its existing primary-metric tradeoffs.
  Without a strict readability improvement, every new gap-closing trial must
  keep both primary metrics non-increasing, even when it also improves the
  wire-weighted score.
  Measure the union
  of visible instance bounds (including ports and rail markers), pins, routed
  centerlines, visible label room and ink, and drafting bounds. This is a
  visible-geometry search objective; the evaluation still measures the SVG
  view box, including its export margin.
  Reserve the remainder of R147's size-scaled budget after its pin-alignment
  pass. Once R146 and R148 have finished, propose a rigid unit's largest grid-aligned
  translation toward another rigid device unit in each cardinal direction. Use swept
  instance bounds and leave two grid lanes around every external instance,
  including markers and ports. Standalone markers and ports constrain moves
  but never attract a unit on their own. An occupied corridor cannot be crossed; an
  unbounded direction produces no candidate. Keep unit orientation and all
  internal offsets. Rank these candidates by the existing R54 estimate and
  try at most two per unit in a second stable coordinate pass, using only the
  remainder of R147's shared size-scaled budget. This preserves every original
  pin-alignment trial before considering gap closures. Comparing against the
  completed port/rail incumbent prevents an early closure from losing a later
  crossing-reducing port opportunity. Fully finish every trial and use
  the same strict score improvement, crossing/bend, rigid-unit, connectivity and `VISUAL_*`
  guards, so a geometric gap may remain to protect label room. Fixed and
  locked units remain untouched. The R147 mode and size restrictions apply.

- **R150 — Drafting follows layout.** Group touching or nearly touching input
  drafting ink, including an object's drafting-anchor target. A locked member
  freezes its entire component. Assign each movable component to the nearest
  visible instance, route segment or junction within 1.5 times its larger ink
  dimension. Preserve its displacement from that owner after placement; map
  rerouted conductors by their terminal partition and nearest projected
  geometry, including a conductor collapsed to a direct pin contact.
  T072: refine an already-owned group to a unique visible terminal when its
  input circle touches that terminal (within one unit of its radius) or its
  conductor contact coincides with it; preserve that pin identity through
  mirroring and rotation, and reject clearance offsets that put the translated
  contact at least as close to a different visible pin. If a matched Net has
  exactly one terminal and its routed conductor has disappeared, map the
  owner to that surviving terminal. For an owner on a terminal-less Net, use
  the displacement of the nearest visible source instance by bounds distance,
  breaking ties by instance id; refuse if that instance has no visible final
  bounds. This displacement fallback does not change inferred ownership or
  the readability metric. Never guess an ambiguous nonempty terminal
  partition. If the jointly seated candidate fails, try
  each owned touching component independently against the ordinary finished
  plan in input group order, keeping all other drafting as obstacles; missing
  owners, unsupported rotations and failed seats leave that whole component
  fixed, and unowned components stay one rigid batch. Each accepted batch
  preserves the terminal partition and cannot increase drafting overlaps or
  any R146 routed guard. Crossings, bends and wire may increase only when the
  frozen readability composite strictly decreases; it changes drafting only. An
  owned batch may raise the R149 calibrated score only when it reduces the
  final number of unowned drafting groups. When
  seating directly on the base without an additional candidate, unowned
  components move as one rigid block, keeping their input edge gap on the same
  side of the circuit and their centre offset along that edge.
  Compare the ordinary finished plan with a candidate routed with fixed and
  unowned drafting as obstacles. Build that candidate from the base's final device,
  port and marker placements, subtracting the recorded R10 whole-layout
  translation. Carry that translation through selected search and finishing
  trials; do not infer it from the final envelope. Keep every searched seat,
  rotation and mirror. Route those exact placements once, move and seat the
  owned drafting groups, then finish local rerouting, fixed drafting and standalone
  captions, and label separation once. Independent drafting fallback batches also
  recover standalone caption anchors after moving the ink, before replay and
  guards; they retain refinement accounting and never split multi-object groups.
  Unowned and locked drafting stays at its
  input positions when undoing R10. Recover standalone caption anchors after
  routing; multi-object groups retain their rigid seating.
  Retain the base placements and R10 translation if fixed ink blocks the
  candidate's 60-unit device clearance; that ink has no alternative seat.
  Still move and seat owned groups on that base under the same guards,
  keeping fixed and unowned ink at their input positions.
  The annealer, R147, R146, rail-seat and R149 searches run only on the base.
  Fall back to a full drafting-free plan only if the reused placements fail
  geometry, replay or routing checks (including increased floating pins or
  missing connections). A worse finished score or guard retains the base
  without another search. Reuse identical routed placements within each fixed-drafting
  pass, and immutable transaction previews and audits within the public planning
  call; discard these caches before returning. Reuse the base as the candidate
  when its planning pass made no R10 drafting-clearance translation and no
  owned movable group's input ink bounds intersect a finished base device's visible
  bounds grown by 60 units on every side. Ports and rail markers are not
  devices for this test. Conservatively build the exact-placement candidate even
  when only a discarded base trial translated. This is a measured search-budget heuristic,
  not an equivalence proof: drafting can affect R149 scoring and label seating
  without those intersections. The dev/val quality gate bounds that tradeoff.
  Seat the movable
  components against the routed electrical ink,
  trying a nine-by-nine grid of nearby offsets, nearest preferred offset first,
  with pitch `max(4, Document grid)`. Reject seats intersecting devices, routes,
  labels, junction dots or other drafting, except an object's existing overlap
  with its own instance owner. Preserve that overlap at the preferred offset
  (rounded to integer coordinates); it is also exempt from the candidate's
  drafting-overlap audit. Only positions and anchors change;
  authored content and shape are preserved. Unsupported route-following
  rotations, missing owners, failed seats or invalid replay retain the ordinary
  plan. Accept only when the finished R149 calibrated score, drafting-overlap
  count and every R146 routed guard do not increase, and the terminal partition
  is unchanged. Crossings, bends and wire length must also not increase unless
  the frozen readability composite strictly decreases. Optimized and successful
  partition planning and documents above 40 instances retain their prior
  behavior; partition fallback uses plain planning. Candidate cancellation is
  checked before building the additional candidate.

- **R151 — Internal DC series levels.** R30 extends through two-terminal
  R50 DC devices between non-rail Nets that have no directed channel edge yet
  in Documents of at most 40 instances. This applies wherever the template,
  layered and stages strategies calculate R30 levels. Build an undirected
  graph of the R50 conducting pin pairs and measure
  distance from supply and from ground, stopping traversal at the opposite
  rail. Orient an internal pair away from the nearer supply; equal or missing
  supply distances use decreasing distance to ground. An unresolved tie adds
  no edge. MOS/BJT polarity and existing rail-directed edges retain their R30
  direction. R30's cycle breaking and longest-path levels then apply unchanged.
  This uses topology and device classes only, never drawing coordinates or
  circuit names. Plain planning compares complete old-level and new-level
  plans for each eligible Document (one containing an internal two-pin DC
  device without an existing channel direction and with a DC path to a rail).
  Keep the new plan only when
  its finished calibrated score is no higher and no floating-pin,
  missing-connection or individual `VISUAL_*` count increases; otherwise keep
  the old plan. Both variants retain the R152 candidate's original full-graph
  channel inference; its stage placement consumes those channels without
  inferring again. Compare after all
  routing, facing, labels and drafting following. Cancellation is checked
  before the additional pass. The two variants reuse identical routed
  placements within the same public call and Document/resolver pair, retaining
  at most 512 entries; their search budgets and choices remain independent.
  Optimized and partition planning retain their
  existing pipeline with the new R30 quick placements; Documents above 40
  instances retain their old levels and pipeline.

- **R152 — Branch-column candidate.** After the ordinary R149 finalist, plain
  planning with positive search budget and at most 40 instances tries one
  additional placement when supply and ground rails exist and a non-rail Net
  joins DC pins of distinct devices.
  Preserve R89/R94 protected symmetry by declining documents containing such
  blocks. Use R50 stages without recognized-pair merging, R151 levels,
  R31–R33 local placement and R52–R59 stage composition. Thus a control Net
  does not merge independent branches or force unequal-depth devices into
  one row. Compact empty device columns and rows before seating markers and
  ports, then run the existing finalist repair, routing alternatives,
  compaction, facing and label finishing. Compare the complete candidate to
  the complete incumbent using `calibratedScore`; require strict improvement
  and no increase in any `routedGuards` count or in crossings/bends (the R149
  compaction guard). Refused or blocked placements
  retain the incumbent. Fixed instances, authored layout groups, constraints,
  inductor couplings, optimized/partition modes (including partition fallback),
  and documents above 40 instances do not enter this candidate. Cancellation
  is checked before the extra trial. Existing search budgets are unchanged.

  Evaluation reports **branch verticality** for human and result on each split:
  among unordered pairs of distinct devices' R50 DC pins on a non-rail Net,
  count those connected by one continuous straight vertical wire segment.
  Touching collinear route pieces count as one geometric segment; aligned pins
  with a gap, coincident pins without a segment, bends, gates/bases and rail
  connections do not count as vertical. Missing placements remain in the
  denominator. Split shares divide summed vertical counts by summed eligible
  connection counts on the same completed human/result pairs; an empty
  denominator is `null`.

- **R153 — Signal-series rows and evaluation.** Every layered row build for
  at most 40 instances (including markers) gives a resistor, capacitor or
  inductor with exactly two pins on distinct non-rail Nets and no R151 inferred
  DC direction a horizontal signal-row placement. Its Nets must reach different
  devices (or a device and source/port). Exclude bridges around one device when
  both Nets touch that device and either side has no other non-passive device/source host;
  other passive bridges and interface ports do not establish a distinct device.
  Placement and metrics use the same definition. Prefer the row of a
  connected gate/base or block input, then another connected non-series,
  non-source device by signal distance and id. With no such neighbour, retain
  the ordinary row. Orient its nearer signal Net left; distance ties retain
  pin order. Seed the crossing-minimizing row order with its ordering distance
  halfway after that nearer Net; preserve the chosen crossing-minimizing order.
  Templates and symmetry blocks retain their geometry. An independent input
  source with one rail pin inherits the row of its connected signal part and
  aligns its other pin with that part's pin when symbol geometry allows.
  Stages retain full-document eligibility, place input sources beside their
  driven signal parts, and keep series flow left to right before scoring.
  The layered strategy compares signal-row and legacy-row drafts by routed
  score before its normal refinement. This rule is independent of R151
  DC-level selection and adds no complete-plan comparison.
  Existing strategy competition uses finished score and guards;
  the above-40 pipeline is unchanged.

  In small drawings, R146 port seats and rail-seat search candidates avoid
  the open straight segments between adjacent facing device pins, including
  Nets with more than two pins. R71 retains its ordinary starting seat;
  finished seat searches move it only when score improves without raising
  routed guards, retaining an obstructing seat if alternatives regress.
  A local port can sit beside the segment's midpoint, with its stub branching
  from the trunk. Fixed seats remain fixed.

  The evaluator reports four additional summed primary metrics for human and
  result on the same completed pairs, separately for dev, val and all:
  `signalSeriesVertical` and `signalSeriesHorizontal` count the above topology
  class by the world-space axis between its two placed pins, independent of
  planning size, strategy or group membership. Unplaced parts are omitted.
  `avoidableJogs` counts each bent Net with exactly two symbol pins once,
  including marker pins. Both pins must be placed, on different instances,
  with opposite exits. Translating either part perpendicular to the exit by
  zero or one grid pitch must align the pins into a positive-length forward
  segment, without overlapping another instance's visible bounds or crossing
  another instance's bounds along that segment. At least one resolved route
  on that Net must contain a non-collinear turn. This is a cheap geometric
  opportunity metric: other wires, locks, labels and rerouting the moved
  part's other Nets are not predicted. Multi-pin Nets, including two devices
  plus a port, are outside this metric.
  `blockedJoins` counts each adjacent facing pair of device pins on a Net
  whose open straight segment intersects the visible bounds of any marker or
  port, once regardless of the number of blockers. The pins must have opposing
  exits and the same cross coordinate, with no other device pin of that Net
  strictly between them. Marker/port terminals are seats, not intermediate
  devices: a port pin on the segment must not hide its own obstruction.
  Touching the segment's cross coordinate counts; touching only its endpoints
  does not. Like the orientation counts, this metric applies at every size.

- **R154 — Per-document pitch and crowded labels.** Up to 40 instances, use
  row/member/column pitches of 100/80/120 units; above 40 keep 120/100/160.
  Stages and folded symmetry halves inherit the original document's pitch.
  R18 pin alignment, R89 axes and R94 rigid blocks retain their rules; seeded
  search uses the same document's column pitch for its large translation step.
  After routing and label finishing, extend R6a's bounded stub repair with
  local opening for diagnosed `VISUAL_LABEL_CLEARANCE`, `VISUAL_LABEL_RUN_ON`
  and `VISUAL_LABEL_OVERLAP`. Also repair `VISUAL_LABEL_OWNER_DISTANCE` by
  bringing an unlocked label toward its owner, and `VISUAL_TERMINAL_DEPARTURE`
  by seating the implicated marker on an opposing host exit. Resolve departure
  diagnostics to terminals before rerouting, since route ids can change.
  For implicated instances or label owners, move
  their complete R18/R94 placement unit in stable id order by one legacy-to-new
  member/column difference horizontally or row difference vertically, rounded
  up to the document grid. Try away from the diagnostic first, then the
  opposite direction. A diagnostic naming a movable marker remains owned by
  stub extension. Share at most twelve routed trials, respect fixed/locked
  units and cancellation, and use the complete finishing path. Accept only
  when the targeted diagnostic disappears, no routed guard rises, and neither
  crossings nor bends increases (`compactionRegresses`). Apply the existing
  straight-join seat filter to the finished geometry as well: a stub extension
  or local opening must not introduce a newly obstructing marker.
  Small documents with coupled label groups start seating from canonical
  slots, so a previous plan's name/value seats cannot reorder their neighbours.
  Search retains aligned, opposing passive-load/channel pins under R33;
  recognized R18/R94 units keep their existing movement rules.
  Retry the legacy pitch only for an R10 refusal or a failed connection whose
  straight segment is obstructed by a foreign pin or symbol. Missing physical
  connections alone (including logically joined rails) do not trigger retry.
  Use R151's finished-score/guard comparison and share resolved routing and
  finished-placement work within the public call. This retry is based on
  diagnostics and geometry, never circuit identity.

- **R155 — Local rail markers.** After all placement, routing, label and
  drafting finishing, consider crossed rail Nets in decreasing crossing count
  with Net-id ties, for documents with at most 40 instances. Require an existing
  `ground`/`vdd-port` with an explicit name claim, or an existing power-marker-owned
  name claim with domain `ground`/`vdd` (the model's supply domain). Never infer
  or invent a name. A claim-only rail may receive the corresponding symbol.
  Generate a per-pin candidate by removing crossed edges from the rail tree:
  pins outside the existing markers' remaining components receive local markers;
  the other pins retain a shared trunk. Also generate one marker per device,
  joining its non-bulk rail pins in one short tree. Reuse existing markers in
  nearest-host/id order before adding copies; never exceed 40 total instances.
  Share at most eight finished trials per document. Give both partitions a
  trial before considering a second seat preference; with more than two crossed
  rails retain only the first preference to share the budget across rails.
  Seat on the pin's exit and rail side using up to 28 cheap geometric seats,
  considering symbol, label and foreign-wire clearance. Preserve the vertical
  approach to a power marker, with grid-aligned bends. Bound each local tree
  by four marker offsets per host pin; the retained trunk is exempt.
  Keep device poses, fixed/locked markers, user groups, locked routes and
  protected annotation/drafting owners. Move eligible power labels off removed
  routes onto the local marker; retain their identities, bindings and claims.
  Copy marker symbol/variant/style and named labels. Every added marker gets
  explicit endpoint membership and a claim with the existing name, scope and
  domain. Supply copies without an authored label receive a bound net-name label.
  Seat unlocked labels after routing. Compare complete transaction replays by
  the readability-augmented calibrated finished score, requiring fewer total
  crossings or a strictly lower frozen composite, no unsafe routing or increased
  routed guard, and no increase in T070's frozen readability composite. Ties retain the incumbent. Bends and wire length are evaluated by
  the score and the corpus acceptance gates. Cancellation and the transaction
  edit cap apply. All additions are `add_instance` edits in the layout transaction,
  hence one Undo. Reuse prevents marker growth on a re-run.
  Equivalence preserves every original terminal partition. Added one-pin markers
  must match an original marker's symbol/variant and claim, or the original
  partition's power claim and corresponding default symbol. Each added marker's
  own claim must preserve name, scope and domain on that same partition.
  Strict fixed-terminal callers retain their behavior. Named same-symbol marker
  components count as complete local rail trees for the small-document
  missing-connection guard; unmarked components still require wires and floating
  pins still use physical components. Documents above 40 retain prior behavior.

- **Existing locks and conflicts.** Members of a locked layout group or
  constraint are treated as fixed instances under R1, because the Edit Engine
  refuses to transform them. A recognized group whose generated id already
  names an existing group, a locked annotation anchored to a removed Route or Junction, or a Route with a `locked` leg, makes
  the planner return no edits and an R5 or R2 diagnostic instead of a plan the
  Edit Engine would reject or that would overwrite user intent.

### Bounded finishing after column compaction

R58 runs these finishing steps independently for each retained finalist through
40 instances, with the existing per-finalist caps and shared per-call caches.
The final selection waits until label/drafting finishing and R155 local rails
are complete; it always retains the previous fully finished choice as fallback.
Above 40 instances, the single-winner sequence is unchanged.

After the R97 column trial, the planner also evaluates closing empty horizontal bands.
It reserves symbol ink plus clearance, pin-to-body spans, recognized and authored groups,
stage symmetry, couplings and constraints. Parallel and driver attachments, the feedback
seat across a signal block and aligned local marker seats keep their vertical offsets.
Overlapping reserved bands cannot be split. The planner removes only whole grid steps
between them. All members of a band move by the same vertical displacement; x and
orientation stay unchanged. The R97 eligibility and rigid-block rules also apply here. Exact replanning must improve the routed score and at least one of crossings,
bends or length without increasing the other two, missing connections or floating pins.

With a positive search budget, a completed crossed finalist with no partition or
optimized partition quality can retry
up to three crossed signal nets, highest crossing count first. The retained conductors
are obstacles. For each retry, compare a tree and at most ten horizontal/vertical trunk
tracks at the pin envelope, its centre or one grid step outside. Leave rails, direct
pin-contact groups, protected branches and diagonal geometry alone. Replay the edits from
the input document; require equivalent terminal groups and names, complete physical
connectivity and safe wires. Only strict wire and score improvements with no worsening of
the three wire metrics or readability counts are eligible. Ties keep the incumbent.

For unpartitioned layouts of at most 40 instances with no fixed instance, up to two distinct, previously evaluated
crossed placements can also undergo this finishing pass. They must survive compaction,
facing and a successful local reroute to replace the incumbent. The extra work is
bounded separately from annealing evaluations and checks the search deadline and
cancellation. This is not a global minimum-crossing guarantee.

Optimized quality can also search pin placements for unpartitioned layouts of at
most 40 instances with a positive search budget and no fixed instances, constraints,
couplings or layout groups. Each proposal includes devices and markers, is translated
on the Document grid to the input envelope corner (R10), and is rejected before
routing if its width or height exceeds 1.5 times the quick layout's corresponding
span (R67). Translated duplicates are routed only once. The routed result must also
remain within half a grid step of the input corner on each axis and within the same
span bounds before it can replace the incumbent.

## Contract

The public planning entries are `planAutoLayout` and `planAutoLayoutWithLlm`. Edits use the existing
[edit-engine schema](../../packages/edit-engine/src/edit-schema.ts); group
records use the existing [presentation schema](../../packages/model/src/schema/presentation.ts).
No file format or connectivity edit is introduced.

Known limits: pairs whose halves sit in blocks without a shared conducting Net
keep block-local symmetry only. Supply trunks are ordinary wires, without thick power-rail
presentation. The bounded router can still leave components unreachable under
R14 inside a candidate, but a finished plan that still has one is not
delivered: R10's delivery gate (below) refuses it.
Crossing cost chooses among bounded candidates. R95 revisits crossed signal
Nets once on the selected finalist, keeping strictly better routing; it does
not guarantee a globally crossing-free drawing. The remaining crossing gap
to applying rip-up inside every refinement candidate is known; that broader
search has a higher planning cost. Row compaction can remove only gaps outside protected bands; a crossing that needs a longer detour can remain.

## Acceptance criteria

The [nine-case corpus](../../packages/auto-layout/test/corpus.test.ts) commits
real transactions and checks electrical equivalence, routing clearance, fallback labels, content
preservation, grid, bounds, pin uniqueness, templates, vertical order, Cell
Pin sides, determinism and stable repeated placement and Route count. The review command
`pnpm auto-layout:review` renders originals and results for human inspection.

Evaluation detects R88 components on the input and measures both the human drawing
and result with the same components as `symmetry`. Also derive R145 stage
components from that same input and measure human and result drawings as
`symmetryStage`, printed beside `symmetry` in per-case and split summaries.
Report pairs, mirrored pairs, level pairs,
mirrored orientations, axis devices and on-axis devices in per-document results
and dev/val totals. The axis is the median pair pin-centre midpoint; mirrored
pairs satisfy `|x_a + x_b − 2·axis| ≤ 40`, level pairs satisfy `|y_a − y_b| ≤ 20`,
and axis-device pin centres lie within 60 units of the axis. Each completed case
also reports `instanceAreaRatio`, the result's instance-box area divided by the
human drawing's (null without a human drawing). Split summaries include
`medianAreaRatio` and `medianInstanceAreaRatio` beside `meanAreaRatio`; medians
exclude null ratios.

- **R110 — Atomic recognition units.** Collect every recognized Structure and
  Ambiguity instance set, every candidate pair satisfying the matched,
  differential, mirror, cross-coupled and anchored common-gate predicates,
  persisted templates (including tails and extras), and every eligible R69
  parallel-host relation. Enumerate candidates without greedy movement picks.
  Both unit construction and rule partitioning call `findStages` with only
  differential-pair and differential-pair-mirror-load input/tail relations. Each
  relation joins every input finger and tail member; mirrors and other relations
  never join stages. Thus a two-terminal current-source tail stays with its pair.
  Except for R143's atomic coupled pairs, restrict each relation to each resulting
  stage, split it into components through non-rail nets excluding MOS bulk pins,
  then union overlapping components.
  Every other non-marker device, including a bridge outside the stages, is a
  singleton. Each unit is internally connected through non-rail nets or couplings;
  units other than R143's coupled pairs stay within one stage;
  multi-output bias mirrors therefore separate their reference from outputs in
  other stages. Number
  units in canonical topology order. Canonical ordering minimizes the labelled-graph
  certificate; equivalent search branches are pruned only when equal first-leaf
  certificates define an automorphism mapping one branch vertex to the other and
  fixing every previously individualized vertex (exact twins also share a branch).
  Each carries kind, per-member roles and
  source. Strongest kind order is differential pair with mirror load, differential
  pair, mirror, cross-coupled pair, common-gate pair, matched pair, device class.
- **R111 — Complete rule partition.** Map channel-connected `findStages` onto
  units and merge stages spanned by a unit; bridge capacitors are included as
  independent devices. Split every resulting block into components connected
  through non-rail nets, excluding MOS bulk pins, using the same connectivity
  rule for remnants beside templates. Infer role by first match: differential pair with an input
  gate → input; differential pair → gain; mirror reference or diode-connected device
  without input/output nets → bias; output channel pin → output; only switches →
  switch; any logic gate → logic; only capacitors → compensation; otherwise other.
  Titles derive from roles (for example Bias and Input stage).
- **R112 — Unit grouping only.** Prompt v4 requests connected functional blocks
  containing unit ids, display titles, roles and reasons, plus uncertain unit ids.
  It never requests placement, order, flow or a floorplan.
- **R113 — Reconcile and complete.** Choose the sample with maximal mean unit ARI
  (lowest index on ties). Keep medoid units with mean co-assignment ≥ 0.5; one
  sample keeps all units and zero samples has no LLM proposals. Drop unknown and
  later duplicate units. Keep the largest non-rail, non-MOS-bulk connected component
  (device count, then unit id); drop empties. Blocks with both >12 devices and >50%
  of all devices split along rule blocks. Unsupported input/bias/output roles are counted and reported in diagnostics
  without changing the LLM role, title or consensus confidence. Repeatedly attach units that
  have at least one non-rail neighbour and whose every adjacent unit is already
  in the same accepted block (leaf attachment), then fill remaining rule blocks, split into
  connected components. LLM confidence is mean retained-unit consensus share;
  extended hosts become attached and retain confidence; rule confidence is zero.
  Coverage counts LLM devices before attachment. The result covers every device
  once, never splits a unit and has internally connected blocks before planner
  validation. Legacy planner L0 merges are counted and reported; error diagnostics
  still reject. T031 owns replacement of those merges and block-local placement.
- **R114 — Offline evaluation.** Read up to k cached samples, allow missing samples,
  explicitly report rule-only fallback and refuse LLM V2. Report provenance-coloured
  overlays, coverage/check counts, sample and consensus ARI, LOADBench block recall
  and role match, human-drawing overlap and planner merges, with dev/val totals. Real calls and
  recognition-quality acceptance belong to Opus, not the offline tests.
- **R120 — Canonical block fingerprints.** Build a typed bipartite graph from
  selected non-marker devices and their nets. Device labels contain descriptor
  class, polarity and family (descriptor identity); unknown symbols retain their
  symbol identity. Nets are internal when all non-bulk terminals belong to the
  set, external when any terminal lies outside it, or supply/ground according to
  `classifyNets`. Unconnected pins get individual internal nets. MOS D/G/S and
  BJT C/B/E remain distinct; MOS bulk is absent. Two-pin resistors, capacitors,
  inductors and switches have unlabeled edges. Reuse R110's canonical labelling
  and SHA-256 the canonical JSON. Names, instance ordering, geometry and symmetric
  pin swaps do not affect the fingerprint.
- **R121 — Approved library boundary.** The version-1
  [fingerprint library](../../packages/auto-layout/fingerprint-library.json)
  ships empty. Entries contain hash, canonical graph, display title, role,
  approvedBy and aggregate sources (document/occurrence counts and role counts).
  Parsing rejects malformed graphs, invalid roles, mismatched hashes and duplicate
  hashes. The package does no file or network I/O; scripts supply parsed entries.
- **R122 — Bounded template matching.** Typed injective backtracking matches
  device and net nodes and pin roles. Internal nets have no outside terminals;
  external nets have inside terminals and must retain an external boundary when
  the fingerprint is recomputed; rails retain their kind. Confirm every device
  set by recomputing R120. A shared default budget of 100,000 visited search nodes
  returns a deterministic partial result and exhaustion flag. Select disjoint
  occurrences by decreasing device count, then canonical device order, then hash.
  Stable input-id ordering resolves exact automorphisms without changing R110.
- **R123 — Template recognition units.** Each library match unions the R110 units
  it overlaps. Such a unit has kind/source template and carries the entry title
  and role. When several matches join through one R110 unit, the first match in
  R122 priority order supplies its title and role. The prompt includes the title.
  Rule stages are computed without templates; each template gets its own block,
  and the remaining devices keep their base rule block, split into connected
  components. A template spanning stages never merges those stages.
  Unclaimed template units become their own confidence-1, template-provenance
  blocks before leaf attachment and rule completion; accepted LLM blocks retain
  precedence. Template completion blocks are not leaf-attachment hosts. An empty
  library preserves R110/R111/R113 results and the exact prompt-v4 payload bytes.
  Reports count template units and blocks and use green template overlays; cache
  reads and sample requests share the exact template payload rather than
  reinterpreting base unit ids. Call, report and mining scripts accept
  `--library <path>`, defaulting to the tracked library.
- **R124 — Offline mining and explicit promotion.** The
  [mining script](../../scripts/auto-layout-fingerprint-mine.mjs) reconciles cached
  samples without library entries or network calls. Fingerprint only LLM-provenance blocks with
  confidence ≥0.6, 2–16 devices and more than one unit. Aggregate by hash, counting
  distinct document paths, occurrences, titles and roles and retaining examples
  and members. A candidate needs ≥2 documents, a dominant role share ≥60%,
  and precision ≥80%.
  Each candidate is matched independently as a one-entry library across every
  mined document. Record matched document and occurrence counts and documents
  with exhausted search budgets; counts for exhausted searches may be partial.
  Count `matchedAsBlock` when an occurrence's device set equals an LLM- or
  attached-provenance block, and `matchedIntact` when all its devices lie in one
  block. Precision is `matchedAsBlock / matchedOccurrences`, or zero without
  occurrences. Order candidates by precision, then matched documents, then mining
  documents, then hash. Fingerprints passing the document and role gates but
  failing precision appear in a separate `rejected` list and HTML section without
  drawings. Promotion also enforces the precision threshold.
  JSON and HTML, including canonical structures and highlighted human drawings
  where available, stay in `tmp/fingerprints/`. Only an explicit user-approved
  `--promote <hash…> --approved-by <name>` invocation appends selected candidates
  to the selected library path, formatted as Prettier JSON. Sources contain only counts and
  roles; case ids, filenames, source titles and example members never enter sources.
  Real-cache mining and candidate review remain a separate Opus step.
