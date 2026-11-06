# Analog auto layout

Status: `proposed`

Primary owner: `packages/auto-layout`

This contract defines pure structure recognition and template placement for one
Schematic Document. It consumes the existing [model](schematic-model.md),
[connectivity](connectivity-and-routing.md) and [typed edits](edit-engine.md).
Routing, locks and the UI entry are **T012/T013, not yet specified**.

## Rules

- **R1 — Boundary and determinism.** Take a `SchematicDocument`, its
  `SymbolResolver` and `{ fixedInstanceIds?: ReadonlySet<string> }`. Return
  `{ edits: SchematicEdit[], groups: RecognizedGroup[], diagnostics:
AutoLayoutDiagnostic[] }`. Fixed instances retain their exact placements;
  a collision with the template returns no edits and an R10 diagnostic.
  Obstacle-aware placement belongs to T013. Identical inputs produce byte-identical serialized edits. Break
  ties by instance id in code-unit order; use neither randomness nor time.
- **R2 — Edits.** First re-anchor each route-anchored annotation, in Document
  annotation order, with `upsert_schematic_annotation`: preserve every other
  field and use a free anchor at its old `fallbackPosition`. Then remove each
  Route's geometry in Document order, then
  add new layout groups, then transform instances in id order. Place tray
  instances; for already placed instances emit rotation, mirror and movement
  in that order, only for changed values. Never clear/reset the drawing,
  delete instances or edit connectivity. Preserve drafting, annotation
  content and bindings, Nets and existing layout groups. Re-anchored labels
  remain at their old page positions until T012 re-anchors them.
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
  pair them with hosts sorted by device id, then x. Use one channel or
  two-pin-device terminal per host device: its lowest pin for ground, highest
  for VDD; never a MOS bulk pin. The marker pin sits at the host x, 40 units
  below for ground or above for VDD. Extra markers share the last host and
  are nudged by grid steps.
- **R7 — Templates.** Group members share y and reflect about a vertical
  axis, with 100-unit origin pitch. Differential left/right mirrors are
  `none`/`horizontal`; tails lie on the axis one row below. Mirror and
  matched left/right mirrors are `horizontal`/`none`. Place the diode side
  over the left differential member it feeds. Stacked groups share an axis.
- **R8 — Horizontal flow and Cell Pins.** Order ungrouped row devices by net
  distance from input. Place input Cell Pins left, output right, supply top
  and ground bottom, 80 units outside the device box at the connected pin's
  coordinate. Left pins use rotation 0 and mirror `none`; right pins use
  rotation 0 and mirror `horizontal` to keep labels upright. Top/bottom
  rotations are 90/270. On each side sort by the connected coordinate, then
  id, and shift later pins by grid steps until they are at least 40 apart.
  With MOS present, a two-pin device's lower pin takes the x of the drain it
  connects to one row below, when free.
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
  step of the old corner. The Edit Engine may add Routes to preserve direct
  contacts separated by placement (`reconcileTransformDirectContacts`).
  These expected Routes connect endpoints on the same original Base Net;
  T012 replaces them. No input Route id survives. If any rule cannot be met, return no
  edits with a diagnostic naming the rule.

- **Existing locks and conflicts.** Members of a locked layout group or
  constraint are treated as fixed instances under R1, because the Edit Engine
  refuses to transform them. A recognized group whose generated id already
  names an existing group, a locked annotation anchored to a Route, or a Route with a `locked` leg, makes
  the planner return no edits and an R5 or R2 diagnostic instead of a plan the
  Edit Engine would reject or that would overwrite user intent. A placed pin
  that lands on a retained Junction of another Net would merge the Nets, so
  R10 refuses it too.

## Contract

The public entry point is `planAutoLayout`. Edits use the existing
[edit-engine schema](../../packages/edit-engine/src/edit-schema.ts); group
records use the existing [presentation schema](../../packages/model/src/schema/presentation.ts).
No file format or connectivity edit is introduced.

Known limit: free net/power labels such as `in`, `out` and VDD retain their
old page positions and can float away from the placed circuit until T012.

## Acceptance criteria

The [nine-case corpus](../../packages/auto-layout/test/corpus.test.ts) commits
real transactions and checks electrical equivalence, route removal, content
preservation, grid, bounds, pin uniqueness, templates, vertical order, Cell
Pin sides, determinism and stable repeated placement. The review command
`pnpm auto-layout:review` renders originals and results for human inspection.
