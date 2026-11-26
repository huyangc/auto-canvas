# T175 Review — Round 1

## Summary

The core decoupling architecture (`multi-port-nets.ts`, `place-markers.ts`, `route.ts`, `routing-audit.ts`, spec, and tests) is clean, well-structured, and passes all 1,261 existing `auto-layout` tests + `pnpm test:slow`.

Two `must-fix` issues were found during review (both solvable cleanly inside the existing owned paths without modifying `port-seat-search.ts`, `stub-seat.ts`, or `blocker-repair.ts`):

## Findings

### 1. [must-fix] Preserve physical-component port-to-host associations across replay and wired inputs

**Why**: Currently `assignSignalPortHosts` only checks touching-pin `contacts`. Once a touching contact is routed into a wire (as in `portSeatCandidates` / `nextMarkerPlacements` on a replayed finalist, causing `multi-port-decoupling.test.ts:313` to fail), or when an input drawing already connects each local port to its host via a short wire rather than a zero-length contact (as in real gallery case `38m8wdesbh`), `contacts` is empty and `assignSignalPortHosts` falls back to `compareIds`, swapping ports to the wrong hosts.

**Fix (inside owned paths)**:
- In `packages/auto-layout/src/route.ts` (`PinGroup` and `freezePinGroups`): add `portAssociations?: PinContact[]` on `PinGroup`. Inside `freezePinGroups` (which already computes `projection = deriveElectricalTopologyProjection(document, resolver)` on the pre-cleanup document), for each `group`, inspect `projection.endpointToPhysicalComponent` across `group.pins`: whenever a physical component contains **exactly one** port (`isPortSymbol`) and **at least one** non-marker device pin, record `[port, devicePin]` pairs in `group.portAssociations`. (Keep `group.contacts` unchanged so `contactPolicy` only licenses true touching contacts.)
- In `packages/auto-layout/src/multi-port-nets.ts`: accept `portAssociations: readonly PinContact[] = []` in `decoupledSignalPortClusters` / `assignSignalPortHosts`:
  1. Pass 1: pair ports using authored touching-pin `contacts` (existing behavior).
  2. Pass 2: for remaining unpaired ports, pair using `portAssociations` (single-port physical-component co-membership from drawn wires, whether authored in the input or produced by routing in a replayed finalist).
  3. Pass 3: for remaining unpaired ports, deterministic `compareIds` fallback.
  4. For spare device pins when `devices.length > ports.length`: prefer the cluster whose port already shares a `portAssociations` pair with that device pin before falling back to nearest-primary Manhattan distance.
- Thread `group.portAssociations` in both `packages/auto-layout/src/place-markers.ts` (`localPortHosts`) and `packages/auto-layout/src/route.ts` (`routeGroup`). Because `localPortHosts` calls `freezePinGroups` on the current routed document in `portSeatCandidates` and `nextMarkerPlacements`, the routed wire pairing is preserved automatically with zero changes outside owned paths.

### 2. [must-fix] Avoid local-seat collisions and wrong-side edge fallbacks for decoupled signal ports

**Why**: Visual inspection of real multi-port cases (`38m8wdesbh` and `yje2n6eva2`) revealed two seating defects when `placeCellPins` only tries a single distance (`cellPinOffset(document)`):
- In `38m8wdesbh` (`cellPinOffset = 80`), facing gates of adjacent columns (e.g. `M12.G` at `x=110, exit=-1` and `M14.G` at `x=-50, exit=+1`) both compute the exact same local seat `x=30`, so the second port collides with the first and is kicked all the way to the far-left canvas edge (`x=-300`), creating long cross-canvas wires and crossings (`VB2`, `VB3`, `VB4`, `VB5`).
- In `yje2n6eva2` (`cellPinOffset = 40`), adjacent pins spaced 20 units apart on hierarchical blocks (`XMASTER`/`XSLAVE`) collide at the single 40-unit offset, kicking ports like `P13_2` (`XSLAVE.reset`, facing right at `x=730`) all the way to the far-left edge (`x=-180`).

**Fix (inside `packages/auto-layout/src/place-markers.ts`)**:
- For a decoupled multi-port signal port with a single host (`assigned !== undefined && host !== undefined`), try staggered local distances along `exit` before falling back to the canvas edge:
  - `[snap(cellPinOffset(document) / 2), cellPinOffset(document), snap(cellPinOffset(document) * 1.5)]` (filtered to unique values `>= grid * 2`, so `cellPinOffset = 80` tries `[40, 80, 120]` and `cellPinOffset = 40` tries `[20, 40, 60]`).
  - Keep single-port non-decoupled R71 behavior unchanged (`[cellPinOffset(document)]`) so existing R71/R93 tests remain untouched.
- When a decoupled port (`assigned !== undefined`) cannot take a local seat and falls back to a vertical edge (`left`/`right`), orient its default `side` toward its own host pin's horizontal exit when `exit.x !== 0` (`exit.x > 0 ? "right" : "left"`) before applying `box` centre comparison, so a right-facing pin on the right side of a block is never sent to the far-left canvas edge.
- Update `nextMarkerPlacements` (`local` check around line 944) so a decoupled single-host port seated at any of its staggered local distances is recognized as locally seated during blocker repair.
- Add a focused test in `packages/auto-layout/test/multi-port-decoupling.test.ts` covering facing opposite gates (where `cellPinOffset` collides at the midpoint) to verify both ports take non-colliding staggered local seats without falling back to the canvas edge, and verify the previously failing `preserves reversed authored contacts through placement and routing` regression now passes.

## Acceptance Criteria

Re-run all 7 acceptance commands from `plan.md` and ensure 100% pass (0 failures):
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`
7. `pnpm test:slow`
