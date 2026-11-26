# T177: Port Line-of-Sight Guard, Private-Gate Axis Tails, Symmetric Half Column Order & Multi-Port Rails

- Branch: `monte_carlo_circuit_placement`
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

Eliminate the four concrete visual and structural defects observed on multi-column symmetric folded-cascode schematics such as `38m8wdesbh`:
1. **No port teleportation through intervening devices (zero label/symbol overlap)**: prevent `placeCellPins` from choosing a local port seat whose straight line-of-sight segment from the host pin passes through another device's bounds (which previously caused `VB6`/`VB7` ports from `M6.G`/`M7.G` to jump across `M14`/`M15`/`M12`/`M13`, stamp text directly over those transistors, and add U-turn crossings).
2. **Private-gate axis tail recognition**: recognize a unique channel device (MOS/BJT) connected to a proven self-mapped axis net whose remaining non-rail pin(s) are strictly private singleton nets (such as tail transistor `M21` with private `V_CMFB` gate port) as an `axis` device in R88 (`symmetry.ts`).
3. **Axis-aware symmetric half column ordering**: pin `axisIds` (and `crossIds`) on the axis side *during* `orderRows` sweeps in `foldSymmetry` (`layered.ts`) and evaluate both normal and reversed (axis-inward / output-outward) initial column orders so multi-column symmetric halves (like folded-cascode OTAs) place axis-connected input pairs closest to the symmetry axis and output cascode branches on the outside instead of inside-out.
4. **Local decoupling for 1-to-1 named multi-port rail nets**: extend `multi-port-nets.ts` / `place-markers.ts` / `route.ts` to locally seat and route rail Base Nets that carry `>= 2` named `port` / `port-filled` markers (with no `ground`/`vdd-port` power markers and `>= ports.length` visible non-bulk device pins), keeping R62 (duplicate rail ports on fewer hosts or unnamed ports) 100% untouched.

## Why

Visual inspection of `38m8wdesbh` (human original: 2 crossings, 761×581, zero overlaps; previous auto-layout: 16 crossings, 754×921, 4 severe text/symbol overlaps on `M14`/`M15`/`M12`/`M13`) exposed four general layout defects:
1. `placeCellPins` only tested `geometryProblem` at the destination point `host + exit * distance`, never checking whether the segment `host → seat` passed through an intervening device box.
2. `symmetry.ts` required `own.every(n => netMap.get(n) === n)` for axis devices, which missed tail transistors whose gate connects to a dedicated private bias port (e.g. `V_CMFB` on `M21`).
3. `foldSymmetry` ran `orderRows` *before* moving `axisIds` to the right end of each row, causing `orderRows` to place input pairs (`distance = 0`) on the outer edge and output columns (`distance = 2`) on the inner edge, and then yanking axis tails `M26`/`M21` to the right created massive cross-overs.
4. Multi-port `VDD` / `VSS` nets (3 named `VDD` ports on 3 PMOS sources, 3 named `VSS` ports on 3 NMOS sources) were excluded by `roles.rails.has(netId)` and piled into a staircase bus at the top-left / bottom-left corners.

## Owned Paths

- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/symmetry.ts`
- `packages/auto-layout/src/layered.ts`
- `packages/auto-layout/src/multi-port-nets.ts`
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/test/port-los-and-symmetric-columns.test.ts` (new)
- `packages/auto-layout/test/symmetry.test.ts`
- `docs/specs/auto-layout.md`

## Implementation Steps

1. **Add local port line-of-sight obstruction guard in `packages/auto-layout/src/place-markers.ts`**:
   - Import `symbolBlocksJoin` from `./straight-joins.js`.
   - Before accepting a candidate local seat `p` for a single-host port (`host -> p`) in `placeCellPins`:
     - Compute the port's transformed pin position `seatPin` (using `devicePins(entry.i, resolver)[0]` and `transformPoint`, or `p.position`).
     - Form the axial segment from `host.point` to `seatPin` (`axis = exit.x ? "x" : "y"`, `across = exit.x ? "y" : "x"`, `line = host.point[across]`, `low = Math.min(host.point[axis], seatPin[axis])`, `high = Math.max(host.point[axis], seatPin[axis])`).
     - Compute `visibleInstanceBounds` for all other instances in `occupied` excluding `entry.i.id` and `host.instanceId`.
     - If ANY other instance's `bounds` satisfies `symbolBlocksJoin(bounds, segment)`, **reject `p`** (do NOT allow a port to jump over an intervening device or already-placed marker to sit on its far side!).
   - Also apply the same line-of-sight guard when evaluating local distances for a port in `portSeatCandidates` (so `port-seat-search` never proposes a seat that jumps across another device either!).

2. **Recognize private-gate axis channel devices in `packages/auto-layout/src/symmetry.ts`**:
   - Precompute `deviceNetCount`: for each non-rail net `n`, count how many non-marker devices in `devices` have a pin on `n` (ignoring MOS bulk pins, consistent with `pins`).
   - In the fixed-point axis loop (`symmetry.ts:470-495`), for a free channel device `a` (`channelPins(a.symbolId)` is defined):
     - Let `own = nets(a.id)`.
     - Check if:
       - `own` has at least one non-rail net `n` with `netMap.get(n) === n` (connected to a proven axis node, e.g., shared tail of a mirrored pair),
       - Every net `n` in `own` is EITHER already self-mapped (`netMap.get(n) === n`), OR is a **private singleton non-rail net** (`!roles.rails.has(n) && deviceNetCount.get(n) === 1 && !netMap.has(n) && !badNets.has(n)`),
       - No other free compatible device `b !== a` matches `a` on all currently mapped nets (`own.filter(n => netMap.get(n) === n)`).
     - If so, push `[a.id, a.id]` to `devicePairs` (so `M21` with private `V_CMFB` joins `axis` alongside `M26`, and its private gate net maps to itself cleanly in the next round).

3. **Keep axis devices pinned during `orderRows` and compare normal vs axis-inward symmetric half order in `packages/auto-layout/src/layered.ts`**:
   - Extend `orderRows` with an optional parameter `options?: { rightOrder?: (node: RowNode) => number; reverseTie?: boolean }`:
     - When `options?.rightOrder` is provided (e.g., `axisOrder` in `foldSymmetry`, where `axisIds -> 2`, `crossIds -> 1`, others `-> 0`), enforce `rightOrder` in every row after initial sort, after every barycentre sort, and after every adjacent transposition (just like `bundleTails` and `orderBlocks`), so `orderRows` optimizes column order **with axis devices already pinned on the symmetry axis**!
     - When `options?.reverseTie` is true, reverse the `distance` tie-breaker (`b.distance - a.distance`) for non-axis nodes so input-side nodes start on the inner (right/axis) side and output-side nodes start on the outer (left) side.
   - In `foldSymmetry` (`layered.ts:458-489`):
     - Compute `crossIds` and `axisOrder` *before* calling `orderRows`.
     - If the half has `>= 2` non-axis nodes sharing at least one row (multi-column half, e.g. folded-cascode OTA), run `orderRows` twice with `rightOrder: axisOrder`: once with `reverseTie: false` and once with `reverseTie: true`.
     - Compare the resulting row orders using the same `rowGraph` crossing + span objective, breaking ties in favor of the order where **axis-adjacent non-axis devices sit closer to the right (axis)** and **output-port-connected devices sit closer to the left (outer)**.
     - Keep single-column halves and existing `outer` (`symmetricHalfOrder`) handling intact so existing tests and simple 1-column symmetric stages do not regress.

4. **Extend multi-port local decoupling to 1-to-1 named rail port nets in `packages/auto-layout/src/multi-port-nets.ts`, `place-markers.ts`, and `route.ts`**:
   - In `multi-port-nets.ts`:
     - Add `decoupledMultiPortClusters(document, netId, pins, roles, contacts, pinPositions, portAssociations)` (or extend `decoupledSignalPortClusters` with an option `{ allowRails?: boolean }`):
       - For non-rail nets: exact existing behavior.
       - For rail nets (`roles.rails.has(netId)`): eligible ONLY when:
         - There are NO `ground` or `vdd-port` power markers in `pins` (only `port` / `port-filled` markers + non-marker device pins),
         - `ports.length >= 2`,
         - Every port in `ports` is named (`isNamedPort` is true — specifically has an interface terminal name or logical net name),
         - `devicePins.length >= ports.length` (so R62 with 3 rail ports on 1 host is NEVER matched!).
       - Note: `freezePinGroups` already excludes MOS bulk pins (`B`), so for `VDD` in `38m8wdesbh`, `devicePins` are `[M24.S, M25.S, M26.S]` (3 pins = 3 `VDD` ports!), and for `VSS`, `devicePins` are `[M18.S, M19.S, M21.S]` (3 pins = 3 `VSS` ports!).
   - In `place-markers.ts`:
     - Allow `localPortHosts` and `placeCellPins` (`singleHost`) to include eligible decoupled rail multi-port clusters!
     - When a decoupled rail port seats locally beside its host pin (e.g. `M24.S` with `exit = (0, -1)` above, or `M18.S` with `exit = (0, +1)` below), use `localPortDistances` (and the new line-of-sight guard!) so `VDD` ports sit cleanly directly above `M24.S`, `M26.S`, `M25.S` and `VSS` ports sit cleanly directly below `M18.S`, `M21.S`, `M19.S`!
     - Keep R62 (`quality.test.ts:536`, 3 unnamed ports on 1 host) 100% unchanged!
   - In `route.ts` (`routeGroup`):
     - When `power(group)` is true, check if `decoupledMultiPortClusters` qualifies (rail with `>= 2` named `port` markers, no `ground`/`vdd-port`, `devicePins.length >= ports.length`). If so, route each cluster independently (`clusters.map(c => ({ pins: [c.port, ...c.hosts] }))`) instead of calling `powerTargets` (which builds a cross-canvas horizontal rail trunk).
     - Note: `routing-audit.ts` (`netComponents`) ALREADY merges distinct physical components that each carry a named `port`/`port-filled` marker on the same Base Net, so `missingConnections === 0` and `floatingPins === []` work seamlessly!

5. **Update `docs/specs/auto-layout.md`**:
   - Update **R71 / R172** to document the local port line-of-sight obstruction guard (a local port seat must not place its wire across an intervening instance's visible bounds) and 1-to-1 named multi-port rail decoupling.
   - Update **R88** to document private-gate axis channel devices (connected to a proven axis net with remaining non-rail pins strictly private).
   - Update **R89** to document pinning axis/cross-coupled nodes during half-layout `orderRows` sweeps and evaluating axis-inward column order on multi-column symmetric halves.

6. **Add comprehensive tests**:
   - Create `packages/auto-layout/test/port-los-and-symmetric-columns.test.ts` testing:
     - **Line-of-sight obstruction guard**: a port on `M6.G` facing right across a closely placed neighboring transistor `M14` does NOT jump past `M14` to land on `M14`'s far side (no crossing of `M14`'s visible bounds and no label overlap with `M14`).
     - **Private-gate axis tail**: a symmetric diff pair whose tail transistor `M21` has a private bias port `V_CMFB` on its gate is recognized in `symmetryTopology().components[0].axis` and placed on the symmetry axis.
     - **Multi-column folded-cascode symmetric half**: a folded-cascode OTA fixture (complementary/single diff pair + axis tail(s) + middle folding devices + outer output cascode stacks + multi-port `VB*`, `VDD`, `VSS` ports):
       - Input pair sits closer to the symmetry axis than the outer output cascode columns (`|input.x - axis| < |output.x - axis|`).
       - Tail transistor(s) sit on the symmetry axis.
       - Multi-port `VDD` / `VSS` ports seat locally above/below their respective column sources (no top/bottom staircase rail bus).
       - `missingConnections === 0`, `floatingPins === []`, `equivalentTerminals === true`, zero device/label overlaps, low crossings.
   - Add a targeted unit test in `packages/auto-layout/test/symmetry.test.ts` for private-gate axis tail recognition (and verify a non-private external gate shared with an asymmetric device is NOT falsely pulled onto the axis).

## Acceptance Criteria

Run all 7 checks and verify 100% pass (0 errors):
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`
7. `pnpm test:slow`
