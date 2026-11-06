# T012 — Auto-layout v1, part 2: automatic routing

- Branch: `task/T012-auto-layout-routing`
- Base: `main` at `19a04d7`
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected in this task.
- Status: approved

## Goal

Second of three tasks for one-click analog auto layout in the Razavi textbook
style. T011 placed parts but left them unconnected on the page. After this
task, `planAutoLayout` returns one edit list that, committed as **one
transaction** (one Undo), also draws the wires: stubs from Ground and VDD
markers to their devices, a supply trunk, signal nets, and re-anchored labels.
Nets that cannot be drawn stay electrically connected and are reported, and a
named one gets labels. The review page then shows complete schematics
comparable with the hand-drawn originals. The lock field and the editor button
are T013.

## Context

Verified on `main@19a04d7`.

### What T011 left

- `packages/auto-layout/src/auto-layout.ts` `planAutoLayout`: refuses with a
  diagnostic on an id conflict (R5), a locked Route-anchored annotation or a
  locked Route leg (R2); then emits (a) `upsert_schematic_annotation` to free
  each `route`-anchored annotation, (b) `remove_route_geometry`, (c)
  `set_layout_group`, (d) instance transforms.
- `docs/specs/auto-layout.md` holds rules R1–R10 and marks routing "T012/T013,
  not yet specified". `packages/auto-layout/test/corpus.test.ts` runs nine
  cases from `corpus-cases.json`; `pnpm auto-layout:review` writes
  before/after pairs to `tmp/auto-layout-review/`.
- `knip.config.js` has a `packages/auto-layout` entry to remove in T013.

### Spike run while planning (throwaway test, deleted)

Applied T011's edits with `dryRun: true`, then called `planRouteNet` for every
Net of the result in id order, applying each result with `dryRun`, then
replayed the concatenated list as one real transaction on the input:

| Result                                       | Evidence                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Concatenated edits commit as one transaction | All nine cases committed                                                                                |
| Electrical equivalence holds                 | `equal` for seven, two `uncheckable` (no route comparison)                                              |
| Replay can differ from the stepwise result   | `JSON.stringify(routes)` differed for `five-t-ota`, `fig-17-19b`, `two-inverters`, `two-stage-symbolic` |
| Fully routed with no change to the algorithm | `differential-stage`, `rc-lowpass`, `rc-highpass`, `rlc`, `two-stage-symbolic`                          |

Failure causes, all addressed below:

- **Stale Junctions.** `remove_route_geometry` leaves Junctions behind, for
  example `junction-ui-16`. They are then route endpoints and obstacles:
  `no clear path from Junction junction-ui-16 to M3.S`.
- **Stale Net ids.** `Expected one Net for net-split-…; found 0`: routing an
  earlier Net renames or merges later ones, so a list of Net ids goes stale.
- **Whole-Net power routing.** Ground markers were being joined to each other.
- **Direct-contact Routes** added by `reconcileTransformDirectContacts` (T011)
  sit in the way: `VDD.+ sits on Route route-canonical-… of a different Net`.

The replay difference exists because the Edit Engine reconciles direct contacts
after the edit loop (`packages/edit-engine/src/transaction.ts:746`), and
generated ids use `document.revision`
(`route-net-planner.ts`, `deriveStableId("route-net", document.id, String(document.revision), part)`).
So only the committed result of the whole list counts; never trust the stepwise
preview alone.

### Existing APIs

- `planRouteNet(document, resolver, { target, trunk? }, maxEdits)`
  (`packages/edit-engine/src/route-net-planner.ts:44`), exported from
  `@icm/edit-engine`. `target` may be `{ kind: "pins", pins: [{ instanceId,
pinName }] }`. Returns `{ edits }` and **throws** with a readable message when
  no clear path exists, naming the obstacle. Its comment: "Not a general
  autorouter: each wire takes the cheapest of a few simple paths". `trunk:
{ start, end }` draws one straight horizontal or vertical trunk and taps the
  components onto it. The agent uses it at
  `apps/editor/src/agent/browser-agent-command.ts:589`.
- `executeTransaction` is pure: it returns a new Document and never mutates its
  input. With `dryRun: true` it returns the validated candidate in `.document`
  (`transaction.ts:1277`), `applied: false`.
- `remove_junction { junctionId }` (`edit-schema.ts:268`,
  `transaction-route-topology.ts:353`).
- `upsert_schematic_annotation { annotation }`. Anchors
  (`packages/model/src/schema/annotations.ts:14-32`): `free { position }`,
  `object { objectId, localOffset, fallbackPosition }`, `route { routeId, legId,
t, normalOffset, direction, orientation, fallbackPosition }`.
- Limit: `MAX_SCHEMATIC_EDITS_PER_TRANSACTION = 1024`
  (`packages/edit-engine/src/edit-schema.ts:532`).

### Corpus facts

- VDD on `five-t-ota` and `fig-17-19b` is `label-VDD1`, a `power-label` anchored
  to `junction-vdd1-end` by an `object` anchor, on a hand-drawn `power-rail`.
  No `vdd-port` instance exists. A Junction carrying a label needs the same
  freeing as a Route-anchored label before it can go.
- Port labels (`instance-label-P1`, kind `net-label`) are `object`-anchored to
  their port Instance and follow it. Leave them alone.
- MOS bulk: `B` pins are members of their Nets but not drawn in the textbook
  variant. `docs/specs/schematic-model.md` "MOS bulk" resolves them. Never route
  a `B` pin.
- `add_power_rail` creates its own label and name claim
  (`edit-schema.ts:312-323`), so using it would duplicate the existing VDD
  label. v1 draws the supply trunk as an ordinary wire; the thick rail look is a
  known limit.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-review.mjs`
- `docs/adr/routing.md`: only the sentence "There is no Contact object or
  autorouter", to say the bounded auto-layout routing lives in
  `packages/auto-layout`

Out of scope (do not change):

- `packages/edit-engine/**`, `packages/model/**`,
  `packages/project-protocol/**`, `packages/spice/**`, `fixtures/**`
- `apps/**`: no UI or Agent operation
- Lock fields, the editor button and placing around fixed instances (T013)
- Thick `power-rail` presentation, a new general-purpose router, and BJT or
  hierarchy templates

If `planRouteNet` cannot express a needed step, record it and fall back through
R14. Do not edit `packages/edit-engine`.

## Steps

1. **Spec.** Add rules R11–R17 to `docs/specs/auto-layout.md` and update R2, R7,
   R8 and R10 as below. Remove "T012 … not yet specified" for routing; keep it
   for T013.

   - **R2 update.** Edit order becomes: (a) free every annotation anchored to a
     Route **or by an `object` anchor to a Junction** that step (c) removes, at
     its `fallbackPosition`; (b) `remove_route_geometry`; (c) `remove_junction`
     for each Junction left with no Route; (d) groups; (e) instance transforms;
     (f) routing (R11–R13); (g) label re-anchoring (R15).
   - **R7 update.** Two recognized differential pairs sharing one tail: return no
     edits and an R7 diagnostic instead of letting the second overwrite the
     first.
   - **R8 update.** For a recognized differential pair, the Cell Pin on the right
     member's gate goes on the right edge, level with that gate, so inputs sit
     on both sides as Razavi draws them.
   - **R10 update.** Replace the direct-contact sentence: a contact separated by
     placement is drawn by R11–R13 like any other connection. Before returning,
     commit the whole edit list with `dryRun` on the input and require: the
     transaction is accepted, and every terminal keeps its Base Net partition
     (`deriveElectricalTopologyProjection`). If either fails, return no edits
     and an R10 diagnostic.
   - **R11 Routing set.** Freeze, from the input Document before any edit, the
     pin groups per Base Net, using `deriveElectricalTopologyProjection`. Exclude
     MOS `B` pins and pins of Instances with `placement: null` in the result.
     Route by those frozen pin lists (`target: { kind: "pins", pins }`), never by
     Net id.
   - **R12 Power.**
     - Each `ground` or `vdd-port` marker gets one straight stub to its R6a host
       pin. Markers are never joined to each other, and other pins of the net
       are not joined to them by wire: the remaining membership stays unrouted,
       as a textbook draws each ground separately.
     - A supply Net with no `vdd-port` and no supply Cell Pin but with at least
       two channel pins gets one horizontal trunk 40 units above the topmost
       device row, wide enough to span its pins, passed as `trunk` to
       `planRouteNet`.
     - A ground Net with no `ground` marker and no ground Cell Pin gets the same
       trunk 40 units below the bottom row.
     - A supply or ground Cell Pin joins its Net's pins through a trunk the same
       way, with the Cell Pin on it.
   - **R13 Signal order.** After power: first nets touching a recognized group,
     pair members before mirrors, then the rest by the lowest instance `id` they
     touch. Pins of one Net are one `planRouteNet` call.
   - **R14 Fallback.** A `planRouteNet` failure for a net never fails the whole
     plan. The planner keeps the routes of every other net, records
     `AUTO_LAYOUT_NET_UNROUTED` with severity `warning`, and its pins stay
     unrouted members of the Net. If the net has a name, it also adds one
     `net-label` per unconnected pin group: a short stub from one pin of the
     group, ending in a label bound to the existing Net name. An unnamed net
     stays unrouted and is only reported: generating a name would change the
     netlist's net names.
   - **R15 Labels.** After routing, each freed `net-label` or `power-label` whose
     Net has a Route moves to that Net's longest horizontal leg, using a `route`
     anchor with `t: 0.5`. A label with no such leg stays free, at the nearest
     pin of its Net. Its id, content and binding do not change.
   - **R16 Edit limit.** If the complete list exceeds
     `MAX_SCHEMATIC_EDITS_PER_TRANSACTION`, return no edits and an R10 diagnostic.
   - **R17 Diagnostics.** `AutoLayoutDiagnostic` gains `severity: "error" |
"warning"`. Only `error` means no edits. Every existing diagnostic is
     `error`.

2. **`src/auto-layout.ts`.** Split into a placement phase and a routing phase. The
   phases run on a working Document produced by `dryRun` transactions, and the
   final list is validated from the input per R10.

3. **`src/route.ts`** (new): R11–R14, with separate functions for pin groups,
   power and signal nets. **`src/labels.ts`** (new): R15. **`src/place.ts`** and
   **`src/place-markers.ts`**: the R7 and R8 updates.

4. **Tests.**
   - Unit tests: the frozen pin groups exclude `B`; a net made unroutable gives a
     warning and keeps the others; a named failing net gets labels; an unnamed
     one gets none; the shared-tail R7 diagnostic; the R16 limit (exercise it
     with a fixture, not by editing the constant).
   - Extend `corpus.test.ts` for every case: the committed result of the whole
     list passes the equivalence, grid, coincident-pin and overlap checks; no
     Route segment crosses an Instance bound other than at its own pins; two
     Routes of different Nets never overlap collinearly; R15 for each freed label;
     determinism; a second run gives identical `move_instance`, `rotate_instance`
     and `mirror_instance` lists (empty) and does not change the Route count.
   - **Fully routed:** `differential-stage`, `rc-lowpass`, `rc-highpass`, `rlc`,
     `two-stage-symbolic`, `five-t-ota` and `two-inverters` have no
     `AUTO_LAYOUT_NET_UNROUTED` diagnostic.
   - `fig-17-19b` and `common-source` may report unrouted nets; assert the exact
     list you get and record it in the report, with the reason.
   - `five-t-ota`: P2 is right of all devices, level with M4.G.

5. **Review script.** Show `warning` diagnostics per case. Exit nonzero only for
   an `error` or a committed-result violation. Remove the "preserved contact
   Route" reporting, which no longer applies.

6. **Investigate and report:** (a) crossing count, bend count and total wire
   length per case; (b) planning wall time per case; (c) what differs visually
   from the hand-drawn original in each case, as a table.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output (deadcode itself exits 1 on main)
pnpm build                                           # expected: exit 0
pnpm auto-layout:review && ls tmp/auto-layout-review # expected: exit 0, 9 SVGs and index.html
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
```

Baseline on `main@19a04d7`: T011's merge passed `format:check`, `docs:check`,
`typecheck`, `lint`, `build` and `test:local` (7317 tests). `deadcode` exits 1
with the pre-existing findings listed in T011's plan.

Behavioral checks:

- `five-t-ota` in the review page reads like the original: a VDD trunk across
  the PMOS sources, the mirror's gates joined, the diode connection on M2, drains
  down to the pair, sources to the tail, and the input ports wired from both
  sides.
- Electrical equivalence holds for every case. A failure is a blocking defect.

## Notes for the implementer

- Decisions made with the user: one click is one Undo, so all edits go in one
  transaction; routing failure never fails the whole operation; label fallback
  applies only to nets that already have a name (R14). The user approved this
  narrowing of "fall back to net labels" so that no net name is invented.
- `planRouteNet` throws for an expected condition. Catch it around each call, turn
  it into R14, and let nothing else be swallowed.
- Never key behavior to a corpus case, a Reference or an instance id.
- Do not tune a constant to make one corpus case pretty. Report it instead.
- If the replay of the list differs from the stepwise preview in a way that breaks
  R15's route anchors (a `routeId` or `legId` that no longer exists), record that
  case and keep the label free rather than emitting an anchor that fails.
