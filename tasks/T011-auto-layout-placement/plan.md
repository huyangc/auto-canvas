# T011 — Auto-layout v1, part 1: structure recognition and template placement

- Branch: `task/T011-auto-layout-placement`
- Base: `main` at `074541c`
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  or database test is expected in this task.
- Status: approved

## Goal

First of three tasks that deliver one-click analog auto layout and routing
("美化") in the Razavi textbook style. This task adds a new pure package,
`@icm/auto-layout`, that takes one Schematic Document and returns a list of
typed `SchematicEdit`s which, committed as one transaction, (1) remove every
Route's geometry while keeping electrical membership, (2) record recognized
analog structures as `LayoutGroup`s, and (3) place every device and Cell Pin
by structure templates: supply on top, ground at the bottom, PMOS above NMOS,
inputs left, outputs right, matched pairs mirror-symmetric about one axis.
It also adds the normative spec for those rules and a corpus test that proves,
on nine real Documents, that the result is electrically identical
to the input, overlap-free, deterministic and follows the rules. Routing
(T012) and the lock field plus the editor button (T013) come later, so after
this task the placed parts are connected only by unrouted membership.

## Context

Verified on `main@074541c`.

### What exists

- No auto layout or autorouter exists (`docs/adr/routing.md`: "There is no
  Contact object or autorouter"). The only automatic placement is the SPICE
  import shelf, `withShelfPlacements` and `cellPinSide` in
  `packages/spice/src/importer.ts:710-825`: a square grid in source order,
  Cell Pins on the side their name or drive suggests (`SUPPLY_NAME`,
  `GROUND_NAME`, `OUTPUT_NAME` regexes at `:726-728`). Its comment says it is
  "not an analog auto-layout". This task does **not** change it.
- `docs/specs/razavi-visual-contract.md` governs symbol geometry, strokes and
  node dots only. Nothing in the repository defines how a circuit is arranged;
  the new spec in step 1 is that authority.
- Layout intent already has a schema and edits:
  - `LayoutGroupSchema` (`packages/model/src/schema/presentation.ts:174-184`):
    `{ id, kind: "differential-pair" | "current-mirror" | "matched-pair" |
"custom", objectIds (min 1), locked }`. `LayoutConstraintSchema` (`:185-196`)
    exists but no product code uses it; leave it alone.
  - Document fields `layoutGroups` and `constraints`
    (`packages/model/src/schema/document.ts:107`).
  - Edits `set_layout_group` / `remove_layout_group`
    (`packages/edit-engine/src/edit-schema.ts:426-433`). Locked layout-intent
    records cannot be replaced or removed, and a locked group rejects
    transforms of any referenced instance (`docs/specs/edit-engine.md:38-40`).
- Instance edits (`packages/edit-engine/src/edit-schema.ts:77-100`):
  `place_instance { instanceId, placement: { position, rotation, mirror } }`
  for a tray instance (`placement: null`); it **rejects** an already placed one
  ("Instance is already placed", `transaction-instance-transform.ts:66-68`).
  Placed instances use `move_instance { instanceId, position }`,
  `rotate_instance { rotation }`, `mirror_instance { mirror }`.
  `RotationSchema` is 0/90/180/270, `MirrorSchema` is
  `"none" | "horizontal" | "vertical" | "both"`
  (`packages/model/src/schema/common.ts:68`). Moving an instance moves its
  attached annotations in the same transaction.
- Route removal: `remove_route_geometry { routeId }`
  (`edit-schema.ts:287`, `transaction-route-geometry.ts:238`) keeps unrouted
  membership (`docs/specs/connectivity-and-routing.md:121-124`).
  **Do not use `clear_cell_drawing`**: it also deletes every drafting object
  (`edit-schema.ts:48-49`, `cell-reset-planner.ts:91-101`), i.e. user text and
  shapes. `simulation-common-source` has 3 drafting objects that must survive.
- Transactions (`packages/edit-engine/src/transaction.ts:111`
  `executeTransaction(document, { transactionId, documentId,
expectedRevision, actor: { kind: "human" | "agent", id }, dryRun?, edits },
{ resolver })`): atomic, every Point validated against the Document grid
  (off-grid rejects, nothing is snapped), at most
  `MAX_SCHEMATIC_EDITS_PER_TRANSACTION = 1024` edits (`edit-schema.ts:532`).
- Contacts by coincidence: when placement makes a pin newly coincide with a
  visible endpoint, the Base Nets merge (`connectivity-and-routing.md`,
  "Authoring rules"). Placement must therefore never put two pins at one
  point; the equivalence check below catches a violation.
- Symbol pins (`packages/components/definitions/*.json`, unrotated):
  `nmos` D north, G west, S south, B east; `pmos` D **south**, G west,
  S **north**, B east; `resistor`/`capacitor` 1 north, 2 south;
  `voltage-source`/`current-source` + north, − south; `ground` pin `0` north;
  `vdd-port` P south; `port` P east (lead drawn facing east; the shelf turns
  ports with rotation `{ top: 90, bottom: 270, left: 0, right: 180 }`,
  `importer.ts:792`). Pin anchors are on the 10-unit grid.
- Page bounds of placed parts: `visibleInstanceBounds(document, resolver)`
  (`packages/derived/src/visual.ts:376`, exported from `@icm/derived`).
- Symbol resolver for a whole Project, including hierarchy symbols:
  `createProjectSymbolResolver(project, builtInSymbols)` from
  `@icm/symbols` (`packages/symbols/src/resolver.ts:124`; the second argument
  is required).
- Electrical equivalence:
  - `projectElectricalGraph(project)` and `compareElectricalGraphs(a, b)` from
    `@icm/netlist` (`packages/netlist/src/equivalence.ts:432, 572`); result
    `{ status: "ready", graph } | { status: "uncheckable", reason }`.
  - Fallback for an uncheckable Project:
    `deriveElectricalTopologyProjection(document, resolver).endpointToBaseNet`
    from `@icm/derived`, compared as in
    `packages/edit-engine/src/conductor-topology-redline.test.ts:36-70`.
- Precheck done while planning (a throwaway test, deleted): committing
  `clear_cell_drawing` on each corpus Document leaves `compareElectricalGraphs`
  at `equal` for the six checkable Projects; `two-stage-op-amp` ("Parameterized
  hierarchy needs manual comparison") and `differential-stage` ("Required pin
  M2.G is not connected") are `uncheckable` and need the fallback. This was
  **not** run with per-Route `remove_route_geometry`, which this task must use
  instead; corpus test item 2 is the first proof of it. If that edit cannot
  reproduce the result (for example a Junction left behind or a rail refused),
  record the diagnostic and stop that case. Do not fall back to
  `clear_cell_drawing`.
- New-package wiring, modeled on `packages/agent-routing`: `package.json`
  (`"exports"` with `development`/`types`/`default`, `"build": "tsc -p
tsconfig.json"`), `tsconfig.json` extending `../../tsconfig.base.json` with
  `composite`, `outDir: dist`, `rootDir: src`, `tsBuildInfoFile`; a path entry
  in `tsconfig.check.json` (`:21` shows agent-routing's); `pnpm-workspace.yaml`
  already globs `packages/*`; Vitest picks up `packages/**/*.test.ts`
  (`vitest.config.ts:4-8`); knip treats `packages/*` uniformly
  (`knip.config.js:94-97`).
- Headless SVG for review: `scripts/visual-golden.mjs` imports
  `parseProject` from `packages/project-protocol/dist`, `renderDocumentSvg`
  from `packages/render-svg/dist` and the resolver from
  `packages/symbols/dist`; outputs go under the git-ignored `tmp/`.

### Validation corpus (connectivity read from the files)

| Case id                     | File · Document                                                                                  | Content                                                                                                                                                                                     | Expected structures                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `five-t-ota`                | `apps/editor/src/examples/current-mirror-loaded-differential-pair.icproj.json` · `document-main` | 5T OTA: M1,M2 PMOS (S on VDD power-label net, gates tied to M2.D = diode), M3,M4 NMOS input pair (S shared, drains to M2.D / M1.D), M5 tail, ports P1,P2 (gates), P3 (out), P4 (bias), GND1 | `differential-pair {M3,M4}`, `current-mirror {M1,M2}` (M2 is the diode side)      |
| `fig-17-19b`                | `fixtures/gallery-redline/7sxpwb4am7.icproj.json` · top Document                                 | M2,M4 NMOS pair (S shared on I1.+), M1,M3 NMOS diode-connected loads to VDD, I1 tail current source, ports P1–P4, GND1                                                                      | `differential-pair {M2,M4}`; M1,M3 form a `matched-pair` (equal-role diode loads) |
| `two-inverters`             | `fixtures/gallery-redline/2rmm2vb45f.icproj.json` · `document-82822626bf0850db`                  | Two CMOS inverters in series (XDP/XDN, XSP/XSN), 5 Cell Pins                                                                                                                                | none required; each PMOS directly above its NMOS                                  |
| `differential-stage`        | `fixtures/projects/differential-stage/project.icproj.json`                                       | M1,M2 NMOS with shared S and shared D, M2.G open; already has user group `group-input-pair` (`differential-pair {M1,M2}`)                                                                   | keeps the user group unchanged; adds no duplicate                                 |
| `common-source`             | `apps/editor/src/examples/simulation-common-source.icproj.json`                                  | XM1 NMOS, RD load, CL, sources VDD and VIN, four ground instances, 3 drafting objects                                                                                                       | none; RD above XM1; drafting objects survive                                      |
| `rc-lowpass`, `rc-highpass` | `apps/editor/src/examples/simulation-rc.icproj.json` (both Documents)                            | V, R, C, grounds                                                                                                                                                                            | none (passive fallback)                                                           |
| `rlc`                       | `apps/editor/src/examples/simulation-rlc.icproj.json`                                            | V, R, L, C, grounds                                                                                                                                                                         | none (passive fallback)                                                           |
| `two-stage-symbolic`        | `apps/editor/src/examples/two-stage-op-amp.icproj.json` · `document-main`                        | opamp, voltage-amplifier, 2 capacitors, ports, ground                                                                                                                                       | none (generic left-to-right fallback)                                             |

`fixtures/projects/manual-basics` was considered and dropped: its parts are
unplaced and it has no Nets. The 24-part top Document of `2rmm2vb45f` is out
of v1 scope.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**` (new package `@icm/auto-layout`)
- `docs/specs/auto-layout.md` (new) and its row in `docs/specs/README.md`
- `tsconfig.check.json` (one `paths` entry for `@icm/auto-layout`)
- `knip.config.js`: only if `pnpm deadcode` flags the package's public exports,
  which no product code consumes until T013 (`includeEntryExports: true`,
  `knip.config.js:95`). Add the narrowest ignore for `packages/auto-layout`
  with a comment naming T013 as its removal point.
- `pnpm-lock.yaml`: only the importer entry `pnpm install --offline` adds for
  the new workspace package. No new external dependency.
- `scripts/auto-layout-review.mjs` (new) and one `package.json` script entry
  `"auto-layout:review"`

Out of scope (do not change):

- `packages/spice/**` (the import shelf stays as is), `packages/edit-engine/**`,
  `packages/model/**`, `packages/project-protocol/**`: no new edit kinds, no
  schema or file-format change. If an existing edit cannot express a needed
  step, stop and report it.
- `apps/**`: no UI and no Agent operation in this task.
- Routing of any kind (T012), lock fields and the editor button (T013).
- The corpus fixture files themselves: read them, never rewrite them.

## Steps

1. **Spec.** Create `docs/specs/auto-layout.md` from
   `docs/specs/spec.template.md`, `Status: proposed`, primary owner
   `packages/auto-layout`, and add its row to the table in
   `docs/specs/README.md`. Its Rules section states the rules R1–R10 below in
   the spec's own words; its Acceptance section links the corpus test from
   step 7. Mark routing, locks and the UI entry as "T012/T013, not yet
   specified".

   - **R1 Input and output.** Input: one `SchematicDocument`, its
     `SymbolResolver`, and options `{ fixedInstanceIds?: ReadonlySet<string> }`
     (empty in v1 callers; a fixed instance keeps its placement and is an
     obstacle). Output: `{ edits: SchematicEdit[], groups: RecognizedGroup[],
diagnostics: AutoLayoutDiagnostic[] }`. Pure and deterministic: the same
     input yields byte-identical `JSON.stringify(edits)`; ties break by
     instance `id` in code-unit order. No randomness, no clock.
   - **R2 Edit order.** (a) one `remove_route_geometry` per Route, in
     `document.routes` order; (b) `set_layout_group` for each new group;
     (c) per instance in `id` order: `place_instance` if unplaced, otherwise
     `rotate_instance`, `mirror_instance`, `move_instance`, each emitted only
     when the value changes. Never `clear_cell_drawing`,
     `reset_cell_placement`, `remove_instance` or any connectivity edit.
     Drafting objects, annotations' content, Nets and existing layout groups
     are never edited directly.
   - **R3 Supported content.** Devices: `nmos`, `pmos`, `resistor`,
     `capacitor`, `inductor`/`inductor-compact`, `voltage-source`,
     `current-source`, and any other single- or two-pin symbol handled as a
     generic block; markers: `ground`, `vdd-port`, `port`, `port-filled`.
     Anything else (hierarchy symbols, multi-pin blocks such as `opamp`) is a
     generic block placed by R9. A Document with more than 40 instances
     returns no edits and one `AUTO_LAYOUT_TOO_LARGE` diagnostic.
   - **R4 Net roles.** Each Base Net gets one role: `supply` (a VDD power
     claim, a `vdd-port`, or a Cell Pin/label name matching the shelf's
     `SUPPLY_NAME`), `ground` (a `ground` instance, Ground claim, or
     `GROUND_NAME`, or the net of a `ground` pin), `input` (a Cell Pin or
     voltage-source + net that reaches a MOS gate and no MOS drain), `output`
     (a Cell Pin net that a MOS drain drives, or `OUTPUT_NAME`), otherwise
     `internal`. A voltage source whose − pin is on ground and whose + net is
     not `input` makes that + net `supply` (`common-source`: VDD drives RD,
     VIN drives the gate). Re-implement the name tests in
     this package with the same regexes as `importer.ts:726-728`; do not
     import `@icm/spice`.
   - **R5 Structure recognition** over MOS instances, by connectivity only
     (never by Reference text):
     - `differential-pair {A,B}`: same symbol, S on one shared net that is
       not supply/ground, D on two different nets, G on two different nets.
     - `current-mirror {A,B}`: same symbol, S on one shared net, G on one
       shared net, and exactly one of them diode-connected (its D net equals
       the shared G net). The diode side is recorded.
     - `matched-pair {A,B}`: same symbol, both diode-connected or G on one
       shared net, and S on one shared net or D on one shared net, not already
       a mirror or a pair. (`fig-17-19b`: M1 and M3 are diode-connected and
       share D, while their sources differ.)
     - Tail: a MOS or current source whose D (or +) is a differential pair's
       shared S net; recorded on the pair, not as a group.
     - An instance joins at most one group, first match in the order above.
     - Existing `layoutGroups` are authoritative: a recognized group whose
       members intersect an existing group's `objectIds` is not emitted.
       New group ids are `auto-<kind>-<first member id>`.
   - **R6 Vertical order.** Applies to Documents containing a MOS; a Document
     with no MOS uses R9 alone. Rank rows from the top by the channel path from
     supply to ground: a device's channel terminals are MOS D/S and both pins
     of two-pin devices. Row 0 holds devices with a channel terminal on a
     supply net; each next row holds devices whose upper channel terminal
     shares a net with a lower terminal of the row above; ground-connected
     devices take the lowest row of their stack. PMOS are always above every
     NMOS they share a drain net with. Rows are 120 units apart; a ground
     instance sits 40 units below its lowest connected pin; a `vdd-port`
     40 units above its highest connected pin.
   - **R7 Templates.** Members of one group share one row (same `y`) and are
     mirror images about the group's vertical axis.
     - `differential-pair`: left member `mirror: "none"` (gate faces left,
       outward), right member `"horizontal"` (gate faces right). The tail sits
       on the axis one row below.
     - `current-mirror` and `matched-pair`: left member `"horizontal"`, right
       `"none"`, so gates face the axis. The diode side goes on the side whose
       drain feeds the left pair member.
     - A mirror or matched pair stacked on a differential pair shares its
       axis.
     - Member pitch: 100 units between the two members' origins when no
       device sits between them.
       These orientations reproduce the hand-drawn `five-t-ota`
       (M2 `horizontal` left of M1 `none`; M3 `none` left of M4 `horizontal`).
   - **R8 Horizontal order and Cell Pins.** Within a row, order ungrouped
     devices left to right by signal flow: distance in nets from an `input`
     net. Cell Pins: `input` nets on the left edge, `output` on the right,
     `supply` on top, `ground` at the bottom, each facing the circuit with the
     shelf's rotations, 80 units outside the device bounding box, at the
     height (or `x`) of the pin it connects to, nudged by grid steps to avoid
     collisions.
   - **R9 Generic fallback.** Devices R6–R7 cannot rank (no channel path, or
     generic blocks) are layered left to right by distance from `input` nets,
     one column per layer, 160 units apart, vertically centered on the main
     block; two-pin sources whose − pin is on ground stand vertically with
     their ground below them, left of the circuit they drive.
   - **R10 Validity.** Every position is a multiple of
     `document.presentation.grid`; no two pins of the result coincide; no two
     instance bounds (`visibleInstanceBounds`) overlap except a ground or
     `vdd-port` with the device it hangs from; the whole layout's bounding box
     has its top-left corner at the old bounding box's top-left corner
     (snapped to the grid), so the drawing does not jump on the page. If a
     rule cannot be met, return no edits and a diagnostic naming the rule.

2. **Package skeleton.** Create `packages/auto-layout` modeled on
   `packages/agent-routing`: `package.json` (`"name": "@icm/auto-layout"`,
   dependencies `@icm/model`, `@icm/derived`, `@icm/symbols`,
   `@icm/edit-engine` for the `SchematicEdit` type only, `@icm/devices` if
   needed for device classes; tests may also use `@icm/netlist` and
   `@icm/project-protocol`, declared as dependencies or devDependencies as
   knip requires), `tsconfig.json`, `src/index.ts`. Add the `tsconfig.check.json`
   path. Run `pnpm install --no-frozen-lockfile --offline` once to register
   the workspace package; the only lockfile change must be the new importer.

3. **`src/net-roles.ts`**: `classifyNets(document, resolver)` implementing R4,
   with unit tests on hand-built small Documents (at least one per role, and a
   gate-only internal net that is not an input).

4. **`src/recognize.ts`**: `recognizeStructures(document, roles)` implementing
   R5, returning groups with kind, ordered members, diode side and tail. Unit
   tests: each kind; the exclusivity order; an existing group suppressing a
   duplicate; a pair with shared drains (as `differential-stage`) is not a
   `differential-pair`.

5. **`src/place.ts`**: `placeDocument(document, resolver, roles, groups,
options)` implementing R6–R10 and returning target placements per
   instance. Keep row ranking, template expansion, Cell Pin placement and the
   generic fallback in separate functions.

6. **`src/auto-layout.ts`**: public `planAutoLayout(document, resolver,
options)` composing steps 3–5 and emitting edits per R1–R2. Export it and
   the result types from `src/index.ts`.

7. **Corpus test** `packages/auto-layout/test/corpus.test.ts` over the nine
   case ids in the Context table. For each: parse with `parseProject`, build
   the resolver with `createProjectSymbolResolver(project, builtInSymbols)`,
   run `planAutoLayout`, commit the edits with `executeTransaction` (actor
   `{ kind: "agent", id: "auto-layout-test" }`), and assert:
   1. the transaction commits;
   2. electrical equivalence: `compareElectricalGraphs` of the whole Project
      before/after is `equal`; when `projectElectricalGraph` is
      `uncheckable` before, compare `endpointToBaseNet` of
      `deriveElectricalTopologyProjection` for the changed Document instead
      (every terminal endpoint keeps its Base Net);
   3. R10: grid, no coincident pins, no overlapping bounds;
   4. every Route is gone, every drafting object and annotation id is still
      present, and every pre-existing layout group is unchanged;
   5. the expected structures in the table are recognized (exact kinds and
      member sets);
   6. template geometry: group members share `y`, are symmetric about the
      group axis, have the orientations of R7; a tail is on the axis below;
   7. vertical order: in `five-t-ota` M1,M2 above M3,M4 above M5; in
      `two-inverters` each PMOS above its NMOS; in `common-source` RD above
      XM1;
   8. Cell Pin sides per R8 for `five-t-ota` (P1,P2 left of all devices or on
      the left edge; P3 right) and `two-inverters`;
   9. determinism: running `planAutoLayout` twice on the input gives equal
      `JSON.stringify(edits)`;
   10. stability: running it again on the committed result emits no
       `move_instance`, `rotate_instance` or `mirror_instance`.

8. **Review script** `scripts/auto-layout-review.mjs` and the root script
   `"auto-layout:review": "pnpm build && node scripts/auto-layout-review.mjs"`.
   For each corpus case it writes `tmp/auto-layout-review/<case>.svg` (the
   result rendered with `renderDocumentSvg`) and one
   `tmp/auto-layout-review/index.html` showing, per case, the original
   rendering and the result side by side with the recognized groups listed.
   Import from the packages' `dist` as `scripts/visual-golden.mjs` does.

9. **Investigate and report:** (a) whether any corpus Document needs an edit
   R2 does not allow (for example a power label left at a stale position
   after its Route is removed); record what you see in the review HTML, do
   not add edits for it; (b) wall time of `planAutoLayout` on each case.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline            # expected: exit 0 (lockfile already includes the new importer)
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass, corpus covers 9 cases
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'         # expected: no output (deadcode itself exits 1 on main, see baseline)
pnpm build                                           # expected: exit 0
pnpm auto-layout:review && ls tmp/auto-layout-review # expected: 9 SVGs and index.html
git diff --stat origin/main -- pnpm-lock.yaml        # expected: only the packages/auto-layout importer added
git status --short packages/spice packages/edit-engine packages/model packages/project-protocol apps fixtures   # expected: empty
```

Baseline on `main@074541c` (run while planning; logs in `tmp/baseline/`,
summary in `tmp/baseline/status`): `format:check`, `docs:check`,
`typecheck`, `lint` and `test:local` exit 0. `deadcode` exits 1 on `main`
with pre-existing findings (unused exports in `packages/agent-adapter`,
`packages/model`, `packages/spice`, `scripts/lib/verify-pr-selection.mjs`);
this task must add none and must not fix them.

Behavioral checks:

- Open `tmp/auto-layout-review/index.html`: for `five-t-ota` the PMOS mirror
  is on top with gates facing each other, the NMOS pair below it mirrored
  about the same axis, the tail on the axis below, inputs left, output right.
  Report anything that looks wrong rather than tuning the rules silently.
- Electrical equivalence holds for every case (test item 2). A case that
  fails it is a blocking defect, not a tolerance to relax.

## Notes for the implementer

- Decisions made with the user: Razavi textbook style is the v1 target;
  structures are recognized first and placed by template; the entry will be a
  UI button (T013); user-adjusted parts will be preserved through a lock
  field (T013), which is why `fixedInstanceIds` exists now; failed routing
  will fall back to Net labels (T012). None of T012/T013 is in this task.
- The numeric constants in R6–R9 (row pitch 120, member pitch 100, Cell Pin
  offset 80, column pitch 160, marker offset 40) are starting values. Keep
  them as named constants in one place; if one produces an overlap in the
  corpus, report it and propose a value instead of special-casing a circuit.
- Never key behavior to a corpus case, a Reference string or an instance id.
- Prefer reading connectivity through `@icm/derived` projections over walking
  raw `document.nets` when a projection already answers the question; power
  and ground claims are owner-addressed markers, not instance names.
- If `executeTransaction` rejects the edits for a reason the plan does not
  anticipate, record the diagnostic in the report and stop that case; do not
  work around it by editing `packages/edit-engine`.
