# Analog auto layout

Status: `proposed`

Primary owner: `packages/auto-layout`

This contract defines pure structure recognition, template placement and bounded routing for one
Schematic Document. It consumes the existing [model](schematic-model.md),
[connectivity](connectivity-and-routing.md) and [typed edits](edit-engine.md).
Locks and the UI entry are **T014, not yet specified**.

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

The experimental LLM adapter (`partition-prompt.ts`, prompt version 4) describes
only electrical device classes, symbols, pin-to-Net membership, explicit terminal
or label names, classified Net roles/rails, recognized structures and atomic units.
Canonical device ordering uses labelled topology refinement and individualization,
never placements or source ids. Anonymization substitutes `D1…` and removes display
names. Unconnected pins have `net: null`. Drawing annotations, routes, drafting,
references and group titles are excluded; recognized persisted template membership
is used by unit recognition. The package remains pure and offline.

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
  Obstacle-aware placement belongs to T014. Identical inputs produce byte-identical serialized edits. Break
  ties by instance id in code-unit order. Quick mode uses neither randomness nor
  time. With `search`, the same seed and evaluation budget produce byte-identical
  edits; only a deadline or cancellation that truncates the run may change the
  result. The PRNG is seeded and never uses `Math.random`.
- **R2 — Edits.** In Document order: (a) free every annotation anchored to
  a Route or by an object anchor to a Junction removed in (c), at its
  `fallbackPosition`, preserving all other fields; (b) `remove_route_geometry`
  for every Route; (c) `remove_junction` for every Junction left without a
  Route; (c2) restore frozen pin groups split by cleanup with `connect_endpoints`,
  joining one pin per extra component to a pin of the first component;
  (d) add layout groups; (e) transform instances in id order; (f) route
  by R11–R13; (g) transfer removed power-marker name claims by R12;
  (h) re-anchor labels by R15. Place tray instances; for placed
  instances emit rotation, mirror and movement in that order, only when
  changed. Preserve drafting, annotation content/bindings, Net membership and
  existing layout groups. Never delete instances or reset the drawing.
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
  net unless that net is input.
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
  for VDD; never a MOS bulk pin. The marker pin sits at the host x, 40 units
  below for ground or above for VDD. Extra markers share the last host and
  are nudged by grid steps.
- **R7 — Templates.** Group members share y and reflect about a vertical
  axis, with 100-unit origin pitch unless R18 aligns a stack. Differential left/right mirrors are
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
  160 units. Grounded-negative sources stand vertically in the leftmost
  columns, positive up. Series two-pin elements with neither pin on power lie
  horizontally, lower-distance pin left. Shunts with one power pin stand
  vertically, in the column just right of their node's driver, below the row
  for ground or above for supply, signal pin toward the row. Multi-pin blocks
  sit on the row in distance order. A series element bridging two nets already
  reached by earlier columns lies horizontally 120 units above the row,
  centered between its net columns.
- **R10 — Validity.** Origins lie on the Document grid. No pins coincide and
  no visible instance bounds overlap, except ground/VDD markers with their
  host device. With no fixed instances, translate the whole layout by
  `(snap(oldBox.x - newBox.x), snap(oldBox.y - newBox.y))`, where `snap`
  rounds to the Document grid and boxes are visible-instance envelopes.
  Fractional envelope edges leave the resulting corner within half a grid
  step of the old corner. A direct contact separated by placement is drawn
  by R11–R13 like any other connection. Before returning, replay the complete
  list with `dryRun` on the input. Require transaction acceptance and the same
  Base Net partition for every terminal, using
  `deriveElectricalTopologyProjection`. Otherwise return no edits and an R10
  diagnostic. Drafting objects are obstacles: if placed device bounds grown
  by 60 units on every side intersect any drafting bounds, translate the
  whole layout down by grid steps until clear, never up or sideways.
  No input Route id survives.
- **R11 — Routing set.** Before any edit, freeze pin groups per input Base Net
  with `deriveElectricalTopologyProjection`. Exclude MOS `B` pins and pins of
  instances unplaced in the result. Route frozen `target: { kind: "pins",
pins }` lists, never Net ids.
- **R12 — Power.** Each ground/VDD marker gets one straight stub to its R6a
  host pin. R43 connects every remaining non-bulk rail member through a
  horizontal trunk, including one marker host to join the marker's drawing.
  If the trunk is refused or incomplete, compare a plain tree under R86.
  A supply or ground Cell Pin joins its Net through a trunk, with the Cell Pin on it.
  A grounded source driving a passive chain has a supply role under R4 but is
  routed as a signal, so it gets no trunk.
  Re-upsert each name claim owned by a removed Route/Junction power marker
  with the same id, name, scope and powerDomain, using the frozen group's
  current Net id and its trunk Route as owner, or its longest new Route.
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
  labels: never invent a name that would change the netlist.
- **R15 — Labels.** After routing, each freed net/power label moves to its Net's
  longest horizontal leg with a route anchor at `t: 0.5`. Preserve the original
  route anchor's `normalOffset`, `direction` and `orientation`; otherwise use
  `normalOffset: -10`, `direction: "forward"`, `orientation: "horizontal"`
  to place the text above the wire. Without a horizontal
  leg it stays free at the nearest pin of its Net. Preserve id, content and
  binding. If whole-list replay invalidates a preview Route/leg id, keep that
  label free instead of emitting a broken anchor.
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

- **R18 — Pin-aligned stacks.** Stacked groups share vertical channel pin
  lines. Derive pitches from each pin's local `x` after orientation; the smaller
  pitch is `MEMBER_PITCH`, the other follows, both on grid. Unstacked groups keep
  `MEMBER_PITCH`. A tail's shared channel pin lies on the axis. PMOS above NMOS
  sharing a drain align drain pins rather than origins. Read oriented `pin.at`;
  never encode a symbol or pin offset.
  Outside stack groups attach to R89 block channel columns as one alignment unit.
- **R19 — Cell Pin side.** Inputs and outputs use the left or right edge nearest
  their host pin, measured from the device bounds' centre. Exact ties put inputs
  left and outputs right. Supply and ground stay top and bottom.
- **R20 — Port spacing.** Keep a Cell Pin level with its host. If two on one side
  are less than 40 units apart, move the one whose Net has more pins away from
  the other; a tie moves the later id. Its wire can tap elsewhere.
- **R21 — Orientation by wire cost.** An instance without a template-fixed
  orientation chooses between `none` and `vertical` for a multi-pin block, or
  its two pin-to-pin flips for a two-pin part where R9 allows both. Minimize
  half-perimeter wire length across its Nets given other placements; ties keep
  the first option. Make two passes in id order.
- **R22 — Refinement by routed cost.** Score each complete final preview as
  `unrouted × 10000 + crossings × 1000 + offConvention × 300 + bends × 100 + wireLength / 10 + labelOverlaps × 400 + labelClearance × 150 + terminalDepartures × 200`,
  with named weights. `unrouted` counts missing physical connections: for each
  Base Net, the number of physical components among non-bulk symbol pins minus
  one, summed (R86). Count input Cell Pins on the right edge and output Cell
  Pins on the left edge as `offConvention`, so a port leaves its conventional
  side only when that saves a crossing. Signal flow stays left to right. In id order, try flipping one left/right Cell Pin side or one
  R21 orientation. Replan fully, discard candidates with error diagnostics,
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
  pin point away from that Net; other passives add no constraint.
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
  Row pitch is 120 units. With no transistor channel constraint, R9 is unchanged.
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
  contact to materialize.
- **R39 — Signal trunks.** For signal Nets with at least three routable pins,
  compare the existing tree, a horizontal trunk spanning the pins at median y,
  and a vertical trunk at median x. Discard candidates that throw. Minimize
  unjoined components, then proper crossings with previously planned other
  Nets, then bends, then length;
  ties retain the listed candidate order.
- **R40 — Order objective.** Sweeps include same-row Net spans and virtual
  positions in every intervening row for long Nets.
- **R41 — Integer geometry.** Round points computed by rotation or mirroring
  to integers before using them in placement, trunks, taps or stubs.
- **R42 — Refinement scale.** R22's candidate budget is 24 per strategy up to
  40 instances, eight from 41 to 80, and zero above 80.

- **R43 — No floating rail pins.** Every non-bulk rail pin is drawn connected.
  Pins with their own marker keep their stubs. All remaining rail pins join
  one horizontal trunk above the device rows for supply or below them for
  ground, together with one marker host. This applies to both strategies and
  every rail size; never add an instance. A refused or incomplete trunk gets a
  tree fallback under R86. Remaining failures produce R14 warnings naming
  the affected pins. A floating pin is the sole non-bulk pin in its physical
  component while its Base Net has other non-bulk pins.
- **R44 — Routing alternative.** After R36 selects a plan, replan its placement
  and refinement choices once with R39 disabled, without another refinement.
  R96 replans the selected finalist with R95 after R72 repair. Keep the lower
  R22 routed score, retaining the selected plan on a tie. R97 then compacts
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
  R94 joins every R88 component into one stage and uses the shared R89 layout.
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
  compare stages and layered by real routing without refinement. Keep the lower routed score,
  retaining the earlier strategy on ties. Run R44 once on the winner. This
  supersedes R34, R36 and R42's strategy and large-document refinement budgets.
- **R57 — Signal direction.** After R53, compare the mean x coordinates of
  input and output Cell Pins' host pins. If inputs lie to the right of outputs,
  reverse the stage order and mirror each stage where group handedness permits.
  With no input or no output hosts, keep the order.
- **R58 — Refine the top two.** Route each eligible strategy once without
  refinement and rank by R22's routed score. Up to 40 instances, refine the top
  two independently, reusing their initial routed plans, with at most 14
  candidates each. Keep the lower refined score; ties retain the higher-ranked
  strategy. Above 40 instances, keep R55's unrefined comparison. R44 runs once
  on the winner. After R72 repair, R96 replans the selected finalist with R95,
  then R97 compacts the R44 winner, without adding refinement candidates.
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
  order before ranking by the existing routed score. A refused run returns no
  edits, so refused runs are never treated as duplicates. Refine at most two distinct strategies
  through 40 instances, reusing their initial routes. If fewer than two valid
  distinct candidates exist, a refused candidate may fill the second slot; if
  all are refused, refinement may repair the first candidate. Retain R58's
  ranking ties and R44's single routing alternative. Above 40 instances keep
  R55's unrefined comparison: R61 was removed because round 1 measured no
  meaningful quality benefit for its extra planning time.

- **R66 — Offline annealing.** Optional `search` takes `seed: number`,
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
  evaluation budget equals quick mode.

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

- **R71 — Single-host ports.** A non-rail Cell Pin Net that reaches exactly
  one device pin gets a local seat, 80 units along that pin's transformed exit
  direction. Face the port toward the host; the existing port-label renderer
  keeps text upright. Reserve local seats in id order. If a seat overlaps a
  device, power marker or earlier port, use R19/R20. Rails and multiple-host
  ports retain R19/R20 and their edge spacing; R71 seats are excluded from
  edge spacing and side refinement.

- **R72 — Blocker repair.** After a complete quick plan, collect movable ports
  (`port`, `port-filled`) and descriptor-defined net markers named as R14
  obstructions. The unchanged router throws plain errors, so resolve only its
  obstruction label (`reference ?? id`) to an unambiguous instance; do not use
  Net names, suggested detours or coordinates from the message. A local R71
  port falls back to R19/R20. An edge port advances by R20 spacing along its
  edge; a power marker advances by grid steps along its rail in R6a/R12 id
  order. Choose the nearest free seat in either direction, with positive ties, whose
  ink clears other pin branch rows/columns and R43 horizontal rail spans.
  Preserve every device, fixed instance and unrelated marker placement, and
  replay the complete routing/transaction pipeline. Keep a repair only with
  strictly fewer floating pins and a strictly lower R22 routed score, so an
  unrouted Net outweighs the few crossings its route may add; try at most two
  passes.
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

- **R74 — Readability energy.** `ROUTED_SCORE_WEIGHTS` exports all R22 energy
  weights together. The unchanged `unrouted` weight of 10000 multiplies missing
  connections, not diagnostic count (R86). Count the unchanged derived diagnostics
  `VISUAL_LABEL_OVERLAP` (clustered), `VISUAL_LABEL_CLEARANCE`, and
  `VISUAL_TERMINAL_DEPARTURE` on the final seated preview, with starting weights
  400, 150, and 200 respectively. Cache counts per immutable preview and resolver.
  These starting values await preference calibration in T022. Evaluation reports
  the three counts for both human and automatic drawings and dev/val totals.
  Review-only timing records cumulative seating and readability scoring time
  across complete candidates, without changing deterministic output.

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
  counts minus one for each Base Net, using all symbol pins except MOS bulk.
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
  are excluded. Paired devices imply paired Nets at every same-named symbol pin,
  including MOS bulk. Paired Nets imply same-symbol, family-compatible devices
  only for mutually unique unmapped candidates at the same pin name. A self Net
  similarly pairs mutually unique devices, except on rails: rail connectivity
  never pairs devices. An unmapped device whose connected
  Nets all map to themselves and that has no unmapped identical-topology twin
  maps to itself. Compute implications from the preceding round, then apply
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
  touched conflicted devices.

- **R89 — Symmetric blocks.** Partners use the smaller R31 row; axis devices
  retain their rows. Build a half Document from left partners and axis devices,
  folding right Nets onto left Nets. Reuse R32 and R33 with these rows and only
  groups contained in the half, moving axis devices to each row's right end.
  Before column assignment, orient recognized left members by R92: outward
  `none`, inward `horizontal`. Other paired devices with a gate use
  `horizontal` when the gate Net is self-mapped, otherwise `none`. Two-pin parts
  and axis devices keep R31 orientation.
  Axis devices sharing a row form one run in half-layout order with at least
  40-unit gaps between visible bounds, origins snapped up to the grid, and its
  pin-centre midpoint within half a grid of the axis. A lone axis
  device centres its channel pin (D/S or C/E), otherwise its pin centre.
  Choose the smallest grid axis A giving every pair origin pitch
  `2·(A − x_left) ≥ MEMBER_PITCH` (100 units), keeping each row's left visible
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

- **R94 — Symmetry across strategies and search.** Join all R88 component
  members into a stage and forbid mirroring that stage. Stage-local placement
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
  Apply the same procedure to offline search's final best. Initial strategy
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
  partitions, any fixed instance (including locked groups/constraints), missing
  final Documents or infinite scores. A finish adds at most one exact replan;
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
  and local axis/conflict members; a lone pair member is unconstrained.
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
  eligible mirrors use partition blocks, regardless of the starting strategy.
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

- **Existing locks and conflicts.** Members of a locked layout group or
  constraint are treated as fixed instances under R1, because the Edit Engine
  refuses to transform them. A recognized group whose generated id already
  names an existing group, a locked annotation anchored to a removed Route or Junction, or a Route with a `locked` leg, makes
  the planner return no edits and an R5 or R2 diagnostic instead of a plan the
  Edit Engine would reject or that would overwrite user intent.

## Contract

The public entry point is `planAutoLayout`. Edits use the existing
[edit-engine schema](../../packages/edit-engine/src/edit-schema.ts); group
records use the existing [presentation schema](../../packages/model/src/schema/presentation.ts).
No file format or connectivity edit is introduced.

Known limits: supply trunks are ordinary wires, without thick power-rail
presentation. The bounded router can still leave components unreachable under
R14, but draws reachable components and tries a tree for refused rail trunks.
Crossing cost chooses among bounded candidates. R95 revisits crossed signal
Nets once on the selected finalist, keeping strictly better routing; it does
not guarantee a globally crossing-free drawing. The remaining crossing gap
to applying rip-up inside every refinement candidate is known; that broader
search has a higher planning cost. R97 compacts columns only; rows keep their pitch.

## Acceptance criteria

The [nine-case corpus](../../packages/auto-layout/test/corpus.test.ts) commits
real transactions and checks electrical equivalence, routing clearance, fallback labels, content
preservation, grid, bounds, pin uniqueness, templates, vertical order, Cell
Pin sides, determinism and stable repeated placement and Route count. The review command
`pnpm auto-layout:review` renders originals and results for human inspection.

Evaluation detects R88 components on the input and measures both the human drawing
and result with the same components. Report pairs, mirrored pairs, level pairs,
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
  Restrict each relation to each resulting stage, split it into components
  through non-rail nets excluding MOS bulk pins, then union overlapping components.
  Every other non-marker device, including a bridge outside the stages, is a
  singleton. Each unit is internally connected and stays within one stage;
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
