# T207 — Compressed Hanan-grid A* fallback and post-route safe orthogonal wire simplification

- Branch: `task/T207-hanan-route-simplify`
- Base: `main` at `f45c0797`
- Status: approved
- Plan review: self-checked against `packages/edit-engine/src/route-clearance.ts`, `packages/edit-engine/src/route-net-planner.ts`, `packages/auto-layout/src/route.ts`, `packages/auto-layout/src/local-reroute.ts`, `packages/auto-layout/src/auto-layout.ts`, and `docs/specs/auto-layout.md`

## Goal

Bring two Netlist2Schematic-inspired routing strengths natively into `auto-canvas` without slowing down quick mode or editing workflows:
1. **Opt-in compressed Hanan-grid A\* path fallback (`pathSearch: "hanan-fallback"`)** in `packages/edit-engine`: when the fast L/Z/C pattern router in `createRouteClearance.path()` cannot find a clear path (e.g. multi-obstacle detours or perimeter escapes beyond `±8 * grid`) or produces a crossing path under `crossingCost > 0`, run a bounded, deterministic A\* search on a sparse Hanan coordinate grid and validate the resulting polyline through the existing exact `conflict()` checker.
2. **Deep crossing-reroute integration & post-route safe wire simplification** in `packages/auto-layout`:
   - Rescue failed/partially-unjoined nets in `routeDocument` with `hanan-fallback` before falling back to labeled stubs.
   - Include a trunk-free `hanan-fallback` candidate in `rerouteCrossings(..., { deep: true })`.
   - Add a guarded post-route orthogonal simplification pass (`simplifyRoutes`) at the end of finishing to remove redundant bends, detours, and unnecessarily long leaf branches while strictly preserving electrical connectivity, zero unsafe problems, non-increasing crossings, and visual/readability guards.

## Context

- `packages/edit-engine/src/route-clearance.ts`:
  - `createRouteClearance` (`L617-L1158`) already maintains spatially indexed `bodies`, `pins`, `routes`, `crossingCounter`, and exact `conflict(points, ends)`.
  - `path(from, to)` (`L915-L1156`) only tries L-shapes, 1..4-step pin escapes, and single-corridor Z/C detours (`lines()` capped to `±8 * grid` outside `[low, high]`). Multi-turn escapes around two obstacles or outer-perimeter detours fail or cross multiple nets.
- `packages/edit-engine/src/route-net-planner.ts`:
  - `planRouteNet` (`L74-L130`) passes options into `createRouteClearance` (`L336-L356`) and builds `WireIntent[]` with `waypoints` and `cornerOrder` compiled via `planWireBatch`.
- `packages/auto-layout/src/route.ts`:
  - `routeDocument` (`L795-L883`) calls `planRouteNet(..., { netScope: "base", components: "physical", partial: true, crossingCost: 20 * grid, reservedIds })`, falling back to `fallbackLabels` when `unjoinedPins` remain.
- `packages/auto-layout/src/local-reroute.ts`:
  - `rerouteNets` (`L122-L416`) retries crossed signal nets over `trunkTracks` using `planRouteNet(..., { crossingCost: 100 * grid })` with full replay and guard checks.
- `packages/auto-layout/src/auto-layout.ts`:
  - `finishReroutes` (`L819-L907`) runs `negotiateFinalist`, `rerouteCrossings(..., { deep: true })`, and `rerouteRailCrossings`, guarded by `keepIntactReroute`, `routedGuards`, `readabilityRegressed`, `terminalPartition`, `lostNameClaim`, and `lostDrawnBodyLead`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/edit-engine/src/hanan-astar.ts` (new)
- `packages/edit-engine/src/route-clearance.ts`
- `packages/edit-engine/src/route-net-planner.ts`
- `packages/edit-engine/src/hanan-astar.test.ts` (new)
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/local-reroute.ts`
- `packages/auto-layout/src/route-simplify.ts` (new)
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/route-simplify.test.ts` (new)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- Default `pathSearch: "pattern"` behavior of `createRouteClearance` and `planRouteNet` (editor/Agent/quick paths must remain unchanged)
- Quick mode (`options.search?.evaluations === 0`) planning behavior
- Placement strategies (`layered.ts`, `stages.ts`, `place.ts`, `skeleton-sa.ts`)
- `packages/derived` or `packages/model` core schemas

## Steps

1. **Implement `packages/edit-engine/src/hanan-astar.ts` and opt-in `pathSearch?: "pattern" | "hanan-fallback"` in `route-clearance.ts` & `route-net-planner.ts`**:
   - Add optional `pathSearch?: "pattern" | "hanan-fallback"` to `createRouteClearance` options and `planRouteNet` options (default `"pattern"`).
   - Export `findHananPath(...)` in `packages/edit-engine/src/hanan-astar.ts`:
     - Build a deterministic, grid-snapped sparse Hanan coordinate grid `(xs, ys)` from:
       - `start` and `end` coordinates, plus 1-step outward escape points (`away(start, startAxis, 1)`, `away(end, endAxis, 1)`).
       - Outer perimeter tracks (`minX - grid`, `minX - 2 * grid`, `maxX + grid`, `maxX + 2 * grid`, and same for Y) around the scene's visible bodies and routes so perimeter escapes work even when devices span `> 8 * grid`.
       - Clearance tracks (`floor(box.min / grid) * grid - grid` and `ceil(box.max / grid) * grid + grid`) around obstacle bodies inside the expanded search window, plus `±grid` around foreign route bend/endpoint coordinates inside the window.
       - Deduplicate, sort ascending, and cap each axis deterministically to at most `44` coordinates (always preserving `start`, `end`, escape coordinates, and outer perimeter tracks, then preferring coordinates nearest to `start`/`end` and evenly spaced across the span).
     - Run a deterministic binary-heap A\* search over states `(ix, iy, axis)` where `axis` is `-1` (start), `0` (horizontal), or `1` (vertical):
       - Cost model matches `route-clearance.ts`: `length + 2 * grid * turning + grid * departureOrArrivalTurnAway + crossingCost * edgeCrossings`.
       - Admissible heuristic: Manhattan distance `|x - end.x| + |y - end.y|`.
       - Prune any step that conflicts with an obstacle body, foreign pin, foreign route overlap/vertex touch, or blocked point; use a fast per-edge check during expansion (caching edge results by `(ix, iy, jx, jy)`) and verify the full compressed path with `conflict(points, [fromEnd, toEnd])`.
       - Hard cap `maxExpansions = 2500` so worst-case search takes only a few milliseconds.
       - Deterministic heap tie-breaking (`f`, `g`, `ix`, `iy`, `axis`).
     - Compress collinear points, extract interior corners as `waypoints = points.slice(1, -1)`, determine `cornerOrder` so `orthogonalClearancePoints(a, b, waypoints, cornerOrder)` reproduces `points`, verify `conflict(points, [fromEnd, toEnd]) === null`, compute exact total `cost`, and return `ClearPath | undefined`.
   - In `route-clearance.ts`:
     - After the existing L/Z/C pattern search finishes (`const winner = choose() ?? best`), ONLY when `own.pathSearch === "hanan-fallback"` and `grid > 0` and (`!winner` or (`crossingCost > 0` and `(crossings?.(winner.points) ?? 0) >= 1`)):
       - Call `findHananPath(...)`.
       - Return the Hanan result if `!winner` or if its exact `cost < winner.cost`.
2. **Integrate `hanan-fallback` into `packages/auto-layout/src/route.ts` and `packages/auto-layout/src/local-reroute.ts`**:
   - In `route.ts`:
     - In `routeDocument`, when routing a non-stub, non-freeEnd target fails (`!best`) or leaves `best.plan.unjoined?.length > 0` and `!stopped()`:
       - Retry `planRouteNet` once (without a forced trunk) with `pathSearch: "hanan-fallback"` (using its own `planningMemo` key).
       - Accept the fallback plan if it succeeds where pattern routing failed, or strictly reduces `unjoined.length` (while remaining preview-valid and adding no new `unsafeProblems`).
   - In `local-reroute.ts`:
     - In `rerouteNets`, when `deep === true` and `!rails`, add a trunk-free `hanan-fallback` trial (`planRouteNet(..., { netScope: "base", components: "physical", crossingCost: 100 * doc.presentation.grid, pathSearch: "hanan-fallback", reservedIds })`) alongside the existing `trunkTracks` candidates, subject to the exact same replay, guard, readability, and score checks.
3. **Implement post-route safe orthogonal wire simplification (`packages/auto-layout/src/route-simplify.ts`) and hook into `packages/auto-layout/src/auto-layout.ts`**:
   - Export `simplifyRoutes(source, resolver, result, stopped, final?)`:
     - Guard early exits: empty edits, error diagnostics, `stopped()`, or `missingConnections > 0` / `floatingPins.length > 0` / `unsafeProblems.length > 0`.
     - Collect eligible non-rail signal nets (`!roles.rails.has(netId)`, not `"supply"`/`"ground"`, not in `protectedIds`, no locked/protected/bus/diagonal routes or junctions, no `contacts`, no drawn MOS `B` leads) whose materialized routes have total bends `>= 2`.
     - Order deterministically by `(bends desc, wireLength desc, compareIds(netId))`, capping to at most `8` nets per pass.
     - For each eligible net:
       - **Candidate A (Trunk-free clean replan)**: remove the net's routes and junctions, restore its frozen pin group, and replan via `planRouteNet(..., { netScope: "base", components: "physical", crossingCost: 100 * doc.presentation.grid, pathSearch: "hanan-fallback", reservedIds })`.
       - **Candidate B (Single-route leaf/segment shortcut)**: for up to 4 individual routes of the net with `centerline.length >= 4` (`>= 2` bends), remove only that route and attempt a cleaner replacement via `planWireBatch(..., { keepClear: true, netScope: "base" })` (direct endpoint-to-endpoint, and if one end is a terminal and the other is a junction, also try tapping straight onto the nearest remaining same-net orthogonal segment via `wire-at` if it reduces distance/bends and removes an unnecessary stub junction).
       - Replay every candidate from `source` via `preview(source, resolver, edits)` and accept ONLY if ALL guards hold:
         - `edits.length <= MAX_SCHEMATIC_EDITS_PER_TRANSACTION`
         - `missingConnections === 0`, `floatingPins.length === 0`, `nextAudit.unsafeProblems.length === 0`
         - `terminalPartition(nextDoc, resolver) === partition`
         - `!lostNameClaim(doc, nextDoc)` and `!lostDrawnBodyLead(bodyLeads, nextDoc, resolver)`
         - `nextAudit.crossings <= audit.crossings` and `nextRailCrossings <= railCrossings`
         - No increase in any `routedGuards` metric, and `!readabilityRegressed(doc, nextDoc, resolver)`
         - Strict geometric improvement: `(nextAudit.crossings < audit.crossings) || (nextAudit.crossings === audit.crossings && nextAudit.bends < audit.bends && nextAudit.wireLength <= audit.wireLength + 2 * doc.presentation.grid) || (nextAudit.crossings === audit.crossings && nextAudit.bends === audit.bends && nextAudit.wireLength < audit.wireLength)`.
   - In `packages/auto-layout/src/auto-layout.ts`:
     - Invoke `simplifyRoutes` at the end of `finishReroutes` (for both zero-crossing and nonzero-crossing finished layouts, never in quick mode), wrapped with `acceptFinishedSignals`-style label finishing and full guard/readability/intact checks so it can never regress any metric or label clearance.
4. **Update `docs/specs/auto-layout.md`**:
   - Document **R175 — Hanan-grid A\* routing fallback and safe post-route wire simplification** right after **R148** (in the finished routing section, avoiding conflicts with placement rule additions).
5. **Write thorough tests**:
   - `packages/edit-engine/src/hanan-astar.test.ts`:
     - Multi-obstacle maze where default `pathSearch: "pattern"` fails with `"no clear path"`, while `pathSearch: "hanan-fallback"` finds a legal, conflict-free orthogonal route.
     - Crossing-avoidance case where pattern routing crosses foreign nets while `hanan-fallback` with `crossingCost > 0` routes around them with fewer crossings.
     - Determinism check and invariance check confirming default `pathSearch: "pattern"` is untouched.
   - `packages/auto-layout/test/route-simplify.test.ts`:
     - `routeDocument` rescues a blocked multi-turn net via `hanan-fallback` without emitting fallback stub labels (`missingConnections === 0`, `unsafeProblems === []`).
     - `rerouteCrossings(..., { deep: true })` reduces crossings via `hanan-fallback` on a dense crossing layout.
     - `simplifyRoutes` removes unnecessary bends / detours on a signal net while preserving `terminalPartition`, `0` unsafe problems, `0` crossing increase, and `0` readability regression.
     - Quick mode (`evaluations: 0`) produces byte-identical edits to baseline.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm vitest run packages/edit-engine packages/auto-layout
pnpm test:slow
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm deadcode
```

## Notes

- Keep `hanan-astar.ts` and `route-simplify.ts` strictly deterministic (canonical ID/coordinate sorting, no `Math.random()`, no wall-clock branching).
- Follow `CODING_STANDARDS.md` (clean helper decomposition, minimal comments explaining *why*, no `any`).
- Do NOT modify `packages/auto-layout/src/layered.ts`, `place.ts`, or `finished-selection.ts`.
