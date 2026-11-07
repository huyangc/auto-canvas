# Analog auto layout

Status: `proposed`

Primary owner: `packages/auto-layout`

This contract defines pure structure recognition, template placement and bounded routing for one
Schematic Document. It consumes the existing [model](schematic-model.md),
[connectivity](connectivity-and-routing.md) and [typed edits](edit-engine.md).
Locks and the UI entry are **T014, not yet specified**.

## Rules

- **R1 — Boundary and determinism.** Take a `SchematicDocument`, its
  `SymbolResolver` and `{ fixedInstanceIds?: ReadonlySet<string> }`. Return
  `{ edits: SchematicEdit[], groups: RecognizedGroup[], diagnostics:
AutoLayoutDiagnostic[] }`. Fixed instances retain their exact placements;
  a collision with the template returns no edits and an R10 diagnostic.
  Obstacle-aware placement belongs to T014. Identical inputs produce byte-identical serialized edits. Break
  ties by instance id in code-unit order; use neither randomness nor time.
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
  blocks, use the generic fallback. Above 40 instances return no edits and
  one `AUTO_LAYOUT_TOO_LARGE` diagnostic.
- **R4 — Net roles.** Each Base Net is supply, ground, input, output or
  internal. Supply comes from VDD claims/markers or supply Cell Pin/label
  names; ground comes from Ground claims/markers or ground names. Use the
  import shelf's supply, ground and output name regexes locally. A Cell Pin
  or voltage-source positive net reaching a MOS gate but no drain is input;
  a Cell Pin reaching a MOS drain or an output name makes an output. Other
  nets are internal. A grounded-negative voltage source supplies its positive
  net unless that net is input.
- **R5 — Recognition.** Match MOS devices by connectivity, never Reference.
  Differential pairs have equal symbols, shared non-power S, distinct D and
  distinct G nets. Mirrors have equal symbols, shared S and G and exactly
  one diode-connected member; record that member. Matched pairs have equal
  symbols, either both diode-connected or shared G, and shared S or D.
  Assign each instance at most once, in differential/mirror/matched order.
  Record a MOS D or current-source positive terminal on a pair's shared S
  as its tail. Existing layout groups suppress intersecting new groups.
  New ids are `auto-<kind>-<first member id>`.
- **R6 — Rows.** With MOS present, rank channel devices from supply toward
  ground using MOS D/S and two-pin device terminals. Supply-connected
  devices start at row zero; the next row shares its upper net with the
  previous row's lower net. Ground-connected devices end their stack.
  PMOS precede NMOS sharing a drain. Row pitch is 120 units. Without MOS, use R9.
- **R6a — Power markers.** On each net, sort ground/VDD markers by id and
  prefer the host pin they touch in the input (R25), then pair the remaining
  markers with unused hosts sorted by device id, then x. Use one channel or
  two-pin-device terminal per host device: its lowest pin for ground, highest
  for VDD; never a MOS bulk pin. The marker pin sits at the host x, 40 units
  below for ground or above for VDD. Extra markers share the last host and
  are nudged by grid steps.
- **R7 — Templates.** Group members share y and reflect about a vertical
  axis, with 100-unit origin pitch unless R18 aligns a stack. Differential left/right mirrors are
  `none`/`horizontal`; tails lie on the axis one row below. Mirror and
  matched left/right mirrors are `horizontal`/`none`. Place the diode side
  over the left differential member it feeds. Stacked groups share an axis. Two recognized differential pairs sharing one
  tail return no edits and an R7 diagnostic.
- **R8 — Horizontal flow and Cell Pins.** Order ungrouped row devices by net
  distance from input. Place Cell Pins by R19 and R20, 80 units outside the
  device box. Left pins use rotation 0 and mirror `none`; right pins use
  rotation 0 and mirror `horizontal` to keep labels upright. Top/bottom
  rotations are 90/270. With MOS present, a two-pin device's lower pin takes
  the x of the drain it connects to one row below, when free.
- **R9 — Fallback.** Unrankable devices, generic blocks and all devices in a
  Document without MOS follow one horizontal signal row. Columns increase
  in net distance from input, or a grounded source's positive net when no
  input exists; column pitch is 160 units. Grounded-negative sources stand
  vertically in the leftmost columns, positive up. Series two-pin elements
  with neither pin on power lie horizontally, lower-distance pin left.
  Shunts with one power pin stand vertically, rotated as their symbol's pin
  axis requires, in the column just right of their node's driver, below the row for ground or above for supply, signal pin toward
  the row. Multi-pin blocks sit on the row in distance order. A series
  element bridging two nets already reached by earlier columns lies
  horizontally 120 units above the row, centered between its net columns.
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
  host pin. Never join markers to each other or wire other Net members to
  those stubs; the remaining membership stays unrouted. A supply Net without
  a VDD marker or supply Cell Pin, with at least two MOS D/S pins, gets a
  horizontal trunk 40 units above its topmost device row, spanning its pins,
  passed as `trunk` to `planRouteNet`. A ground Net without a ground marker
  or Cell Pin gets the same trunk 40 units below its bottom row. A supply or
  ground Cell Pin joins its Net through such a trunk, with the Cell Pin on it.
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
  All pins of one Net go into one `planRouteNet` call.
- **R14 — Fallback.** Catch each `planRouteNet` failure independently. Keep
  other Nets' routes and the failed Net's unrouted electrical membership;
  report `AUTO_LAYOUT_NET_UNROUTED` with severity `warning`. For an already
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
  `unrouted × 10000 + crossings × 1000 + offConvention × 300 + bends × 100 + wireLength / 10`,
  with named weights. Count input Cell Pins on the right edge and output Cell
  Pins on the left edge as `offConvention`, so a port leaves its conventional
  side only when that saves a crossing. Signal flow stays left to right. In id order, try flipping one left/right Cell Pin side or one
  R21 orientation. Replan fully, discard candidates with error diagnostics,
  accept the best strictly improving move, and repeat for at most two passes
  and 24 evaluated candidates total. Fixed instances never move. If all
  candidates fail, retain the default. Identical inputs give identical results.
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
  on a power Net left unjoined by R12 becomes an additional exact,
  clearance-checked stub target. Exclude MOS `B` pins. This prevents transform
  reconciliation from adding an unchecked straight Route across other Nets.
- **R26 — Single-pin power Nets.** A power Net with one routable pin and a
  name claim owned by removed geometry receives one clearance-checked 40-unit
  stub, up for supply and down for ground. Transfer the claim to the stub Route
  under R12 and its label under R15. If no clear stub exists, refuse under R10.

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
presentation. The existing bounded router can leave Nets unrouted under R14.

## Acceptance criteria

The [nine-case corpus](../../packages/auto-layout/test/corpus.test.ts) commits
real transactions and checks electrical equivalence, routing clearance, fallback labels, content
preservation, grid, bounds, pin uniqueness, templates, vertical order, Cell
Pin sides, determinism and stable repeated placement and Route count. The review command
`pnpm auto-layout:review` renders originals and results for human inspection.
