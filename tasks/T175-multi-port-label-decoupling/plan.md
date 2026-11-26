# T175: Multi-Port Local Signal Decoupling

- Branch: `monte_carlo_circuit_placement`
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

Preserve semantic local port decoupling on non-rail Base Nets that carry multiple named `port` / `port-filled` markers (such as inter-block signals `RST`, `clkp`, `Qn`, `DN` in `yje2n6eva2`, and distributed gate bias ports `VB1`–`VB7` in `38m8wdesbh`). Instead of pushing duplicate signal ports to the canvas edge and forcing one giant cross-canvas wire tree across unrelated blocks, pair each local port with its own local device host(s), place each port locally beside its assigned host (falling back to edge aligned to its host when blocked), route each local port cluster independently, and recognize named multi-port physical components as logically joined in `routing-audit.ts` while keeping unmarked components and floating pins strictly enforced.

## Why

In multi-block and multi-bias schematics (e.g. `yje2n6eva2` and `38m8wdesbh`), authors place multiple named `port` markers on the same non-rail Base Net — one directly beside each local device pin (`XMASTER.reset` + `P13`, `XSLAVE.reset` + `P13_2`; `M24.G`/`M25.G`/`M26.G` each with its own `VB1` port). Currently:

1. `placeCellPins` (`packages/auto-layout/src/place-markers.ts`) only grants local R71 seats when `connected.length === 1`, so every port on a multi-port signal net is pushed to the canvas edge.
2. `routeGroup` (`packages/auto-layout/src/route.ts`) always passes `[{ pins: group.pins }]` for non-power nets, forcing a single physical spanning tree across the entire schematic (`yje2n6eva2` jumps from 0 → 30 crossings and 1,330 → 8,310 wire length; `38m8wdesbh` jumps from 2 → 27 crossings and 3,476 → 9,986 wire length).
3. `netComponents` (`packages/auto-layout/src/routing-audit.ts`) merges distinct physical components that each carry a named power marker (T071), but does not yet do the same for distinct physical components of a non-rail Base Net that each carry a named `port` / `port-filled` marker.

Because `restorePinGroups` and `equivalentTerminals` preserve the exact Base Net membership, decoupling multi-port named signal nets into local port-hosted clusters preserves 100% electrical equivalence, netlist export identity, zero floating pins, and full unmarked-component checking.

## Owned Paths

- `packages/auto-layout/src/multi-port-nets.ts` (new)
- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/routing-audit.ts`
- `packages/auto-layout/test/multi-port-decoupling.test.ts` (new)
- `docs/specs/auto-layout.md`

## Implementation Steps

1. **Create `packages/auto-layout/src/multi-port-nets.ts`**:
   - Define `isPortSymbol(symbolId: string): boolean` (`symbolId === "port" || symbolId === "port-filled"`).
   - Define `isNamedPort(document: SchematicDocument, instanceId: string, netId: string, logicalNetNames?: ReadonlyMap<string, string | undefined>): boolean`:
     - Returns `true` if `document.netlist?.terminals.some(t => t.interfaceInstanceIds.includes(instanceId) && t.name.trim().length > 0)`, OR if the Base Net `netId` has a non-empty logical name from `resolveDocumentLogicalNets(document).byBaseNetId.get(netId)?.name?.trim()`.
     - Returns `false` for unnamed synthetic ports with no terminal name and no Base Net name (preserving all existing unnamed-port unit tests).
   - Define `DecoupledPortCluster`: `{ port: TerminalRef; primaryHost: TerminalRef; hosts: TerminalRef[] }`.
   - Define `decoupledSignalPortClusters(document, netId, pins, roles, contacts, pinPositions?)`:
     - Only applies to non-rail Base Nets (`!roles.rails.has(netId)`).
     - Split `pins` into `ports` (instances with `isPortSymbol`) and `devicePins` (non-marker instances, excluding `isMarker` — i.e., neither `ground`/`vdd-port` nor `port`/`port-filled`).
     - Require:
       - `ports.length >= 2`,
       - `devicePins.length >= ports.length`,
       - Every port in `ports` satisfies `isNamedPort(document, port.instanceId, netId, ...)`,
       - No non-port power markers are mixed into `pins`.
     - Deterministic pairing (`assignSignalPortHosts`):
       1. Sort `ports` by `compareIds(a.instanceId, b.instanceId)` and `devicePins` by `compareIds(a.instanceId, b.instanceId) || compareIds(a.pinName, b.pinName)`.
       2. First pass (preserve authored local contacts, analogous to `assignRailHosts` in `pin-contacts.ts`): for each port, if `contacts` contains a pair `[port, d]` (in either order) where `d` is an unassigned pin in `devicePins`, bind `port -> d` as `primaryHost` and mark `d` assigned.
       3. Second pass: for each remaining unassigned port, bind it to the next unassigned pin in `devicePins` (deterministic `compareIds` order, independent of port placement so `placeCellPins`, `portSeatCandidates`, `nextMarkerPlacements`, and `routeGroup` always agree on the exact same `primaryHost`).
       4. Third pass (when `devicePins.length > ports.length`): assign each remaining unassigned device pin `d` to the cluster whose `primaryHost` is nearest to `d` (by Manhattan distance when `pinPositions` are provided, breaking ties by `compareIds(cluster.port.instanceId)` — or by `compareIds` if positions are unavailable). Note that whenever `ports.length === devicePins.length`, every cluster has `hosts = [primaryHost]` (size 1, 1-to-1).
     - Return `DecoupledPortCluster[]` (or `undefined` when the net does not qualify).

2. **Update `packages/auto-layout/src/place-markers.ts`**:
   - In `placeCellPins`:
     - Precompute `contacts = touchingPins(document, resolver)` (same as `placePowerMarkers`) and for each non-rail Base Net compute `decoupledSignalPortClusters(...)`.
     - For a port belonging to a `DecoupledPortCluster`:
       - Restrict its `connected` hosts to `cluster.hosts` (with `cluster.primaryHost` first), so `host` / `coordinate` / `side` reflect ITS OWN local host pin rather than an unrelated block's pin!
       - Set `singleHost` to `cluster.hosts.length === 1 ? cluster.primaryHost : undefined` so R71/R93 places each 1-to-1 local port directly beside its assigned host pin's outward exit (falling back cleanly to the edge aligned with its own host if the local seat is blocked).
     - Keep rail nets (`roles.rails.has(net)`) and single-port nets 100% unchanged (preserving R62, R71, R93, R164).
   - In `portSeatCandidates`:
     - When `portId` belongs to a `DecoupledPortCluster`, restrict `hosts` to `cluster.hosts` (so `port-seat-search` only evaluates seats around that port's own local host(s) rather than dragging it to another block).
   - In `nextMarkerPlacements`:
     - When checking whether a blocked port is currently seated at its local R71 seat, also resolve `host` from `decoupledSignalPortClusters` when `cluster.hosts.length === 1`, so blocker repair falls back cleanly to the edge seat.

3. **Update `packages/auto-layout/src/route.ts`**:
   - In `routeGroup`:
     - When `!power(group)`, check `decoupledSignalPortClusters(working, group.netId, group.pins, roles, group.contacts, pinPositions)`.
     - If decoupled clusters are returned, build `targets` as one `RoutingTarget` per cluster: `clusters.map(cluster => ({ pins: [cluster.port, ...cluster.hosts] }))` instead of `[{ pins: group.pins }]`.
     - Keep `contacts` handling intact: avoid emitting duplicate `stub: true` + non-stub targets that could fail fatally on a blocked contact if a cluster's general `planRouteNet` target can cleanly route around an obstacle — specifically, for a decoupled cluster, only unshift a direct `contacts` pair if that contact is NOT between a decoupled port and its host (let `planRouteNet` handle `[cluster.port, ...cluster.hosts]`, which routes straight when clear and detours cleanly when blocked, never throwing a fatal touching-pin stub error!).

4. **Update `packages/auto-layout/src/routing-audit.ts`**:
   - In `netComponents(document, resolver)`:
     - Parallel to T071's power-marker component merge, add a named-port component merge:
       - Do NOT restrict to `document.instances.length <= 40` (large schematics like `38m8wdesbh` have 50 instances).
       - For any Base Net `netId` that still has `components.get(netId).size >= 2`:
         - Find all visible pins in `netId` whose instance is a `port` or `port-filled` satisfying `isNamedPort(document, pin.instanceId, netId, logicalNames)`.
         - If those named ports span `>= 2` distinct physical components, map each such port-bearing physical component to a shared token `${netId}:named-port` (leaving any physical component WITHOUT a named port untouched and unmerged!).
     - Leave `floatingPins` purely physical (unchanged!), so every local port MUST still be physically routed to at least one host pin (`component size >= 2`), and any unmarked device pin still produces `missingConnections > 0` and triggers R10 refusal.

5. **Update `docs/specs/auto-layout.md`**:
   - Update **R86** to mention that distinct physical components of a Base Net that each carry a named `port`/`port-filled` marker are treated as logically joined (parallel to T071 named power markers), while unmarked components and floating pins remain defects.
   - Add **R172 — Multi-port local signal decoupling**: document the eligibility criteria (non-rail Base Net with ≥ 2 named ports and ≥ as many device pins), deterministic contact-first port-to-host assignment, local R71-style seating beside each port's host, independent per-cluster routing, and electrical/Base Net equivalence preservation.

6. **Add comprehensive tests in `packages/auto-layout/test/multi-port-decoupling.test.ts`**:
   - Multi-block local-port fixture (modeled after `yje2n6eva2`: two multi-pin blocks + output stage sharing named multi-port signals `RST`, `clkp`, `Qn` with local port markers) -> `planAutoLayout` completes with `missingConnections === 0`, `floatingPins === []`, `equivalentTerminals === true`, keeps each duplicate port seated near its own host, and avoids cross-canvas bus crossings.
   - Multi-bias 50-instance (> 40 instances!) fixture (modeled after `38m8wdesbh`: multiple bias nets `VB1`..`VB4` with 2–4 named ports each) -> `planAutoLayout` preserves local bias ports, `missingConnections === 0`, `floatingPins === []`, `equivalentTerminals === true`.
   - 2-ports-to-3-device-pins fixture -> each port routes its own local cluster (`missingConnections === 0`, `floatingPins === []`).
   - Negative / guard tests:
     - Unnamed bare ports on an unnamed net -> NOT decoupled (`missingConnections > 0` if physically split, routed as one tree).
     - Multi-port net with an unmarked stranded device pin -> `missingConnections === 1` (unmarked component is NOT forgiven).
     - Floating local port (not wired to any host) -> `floatingPins` still reports it and `planAutoLayout` refuses if fixed/unroutable.
     - Rail net with duplicate ports -> R62 behavior unchanged.
     - Deterministic & idempotent re-run (`planAutoLayout` on committed output produces clean layout with unchanged instance count and `equivalentTerminals === true`).

## Acceptance Criteria

Run all of the following and verify zero errors:
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`
7. `pnpm test:slow`
