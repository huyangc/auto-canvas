# T192 — Global-route rail/track ordering, negotiated rip-up & APR guard hardening

- Branch: `task/T192-global-route-track-ordering`
- Base: `main` at `e933dde65fd9e466f9a1f113707cdbddf2641237`
- Status: approved
- Plan review: self-checked against `packages/auto-layout/src/route.ts`, `local-reroute.ts`, `auto-layout.ts`, `readability-metrics.ts`, and 591-case eval metrics (`scratch/eval-t191-r2/report.json`).

## Goal

Reduce real routed wire crossings (`crossings`) and power/rail wire crossings (`railCrossings`) across the full schematic corpus using **general, topology- and geometry-driven global routing algorithms** (no circuit-specific heuristics or hardcoded IDs), while keeping per-case latency bounded and closing the two non-blocking P2 edge cases recorded in PR #167 Round 2 review (`polishKey` bounds isolation and constraint-ID-level APR guard checks).

## Context

From the 576 completed Gallery cases after T191 (`e933dde6`), the readability gap vs human layouts is concentrated in three structural metrics (`area`, `crossings` 292 vs 197 dev / 531 total, `railCrossings` 27 vs 10 dev / 66 total across 29 circuits). Reading the routing pipeline reveals four general algorithmic limitations:

1. **Arbitrary net routing order (`packages/auto-layout/src/route.ts:1056-1062`)**:
   - Signal nets with equal `signalPriority` are ordered solely by string `instanceId`/`netId`. A long/high-fanout global net that happens to sort first steals direct straight corridors from short 2-pin local nets, causing avoidable crossings.
   - Power rails are always routed before signal nets with trunks placed purely from pin extrema, never seeing where signal buses actually run.
2. **Limited rip-up-and-reroute (`packages/auto-layout/src/route.ts:1098-1190`)**:
   - `routingScore` does not distinguish `railCrossings` from signal-signal crossings.
   - The R95 `ripUp` pass skips power rails (`!power(group)`), only retries one net at a time (so mutually crossing pairs `(A, B)` remain locked when ripping up `A` alone while `B` blocks `A`'s direct corridor), and never attempts an alternative geometry-driven global routing order (ascending HPWL / fanout, or signals-before-rails when rail crossings persist).
3. **Narrow candidate tracks and blocked crossing elimination on large schematics (`packages/auto-layout/src/local-reroute.ts:41-65, 166-177` & `packages/auto-layout/src/auto-layout.ts:2470-2785`)**:
   - `trunkTracks` only tries tracks derived from the single net's own pin envelope (`low`, `high`, `mid`, `low - grid`, `high + grid`). When a rail's pins lie in an interior row, every candidate track slices through internal signal buses; outer schematic envelope corridors and empty inter-row/inter-column channel tracks are never tried.
   - `rerouteNets` hard-caps `trials === 3` even when a schematic has 10+ crossed nets.
   - `rejectRouting` (`local-reroute.ts:166-174`) rejects ANY crossing reduction that increases `bends` or `wireLength` whenever `improvesReadability` returns `false` — and `improvesReadability` is hardcoded `false` for `instances > 40`, completely preventing crossing-eliminating detours on large schematics.
   - `rerouteRailCrossings` (`auto-layout.ts:2774`) only runs inside the `instances <= 40` finalist polish block, so schematics with `> 40` instances never get post-signal rail rerouting.
4. **PR #167 Round 2 P2 items (`packages/auto-layout/src/auto-layout.ts:1325-1347, 2558-2585`)**:
   - `polishKey` (and `finishedSeats` memo key) omits effective `repairBounds`, allowing an unbounded alternate finalist to reuse a primary finalist's `repairBounds`-constrained polish result.
   - `aprGuardsRegressed` compares only the aggregate count of `VISUAL_CONSTRAINT_VIOLATION`, so fixing one constraint while newly breaking a different constraint can pass unnoticed.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/local-reroute.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/global-route-order.ts` (new helper module for geometry-driven net ordering, channel/envelope track discovery, and pairwise crossing extraction)
- `packages/auto-layout/test/` (new unit tests for global route ordering, pairwise rip-up, channel/envelope rail & signal rerouting, >40 rail rerouting, `polishKey` bounds isolation, and constraint-ID APR regression guard)

Out of scope (do not change):

- `packages/edit-engine/**` (owned by parallel task T193)
- `packages/model/**`, `packages/derived/**`
- `packages/auto-layout/src/readability-weights.ts` and `packages/auto-layout/src/readability-selection-weights.ts` (frozen calibration weights)
- Any circuit-specific IDs, schematic names, or template-specific special cases.

## Steps

1. **Create `packages/auto-layout/src/global-route-order.ts`** (pure, general geometry/topology utilities):
   - Compute deterministic net span metrics from pin coordinates: half-perimeter wirelength (HPWL), bounding-box area, and pin count, yielding an ascending-HPWL / ascending-fanout net comparator (with deterministic `compareIds` tie-break).
   - Implement `crossingNetPairs(document, resolver)`: returns distinct pairs of routed nets `(netA, netB)` that properly cross, sorted by descending pairwise crossing count then deterministic IDs.
   - Implement `discoverChannelTracks(document, resolver, netPoints, axis, options)`:
     - Given `visibleInstanceBounds(document, resolver)` and `netPoints`, returns deterministic grid-aligned candidate tracks combining:
       1. Net pin-envelope tracks (`low`, `high`, mid, `low - grid`, `high + grid`),
       2. Schematic outer-envelope tracks (`envMin - grid`, `envMax + grid`, and for rails `envMin - 2 * grid`, `envMax + 2 * grid`),
       3. Up to 4 clear inter-device channel tracks (midpoints of empty intervals between sorted device bounding-box projections along `axis` that lie within or adjacent to the net's perpendicular span, ordered by proximity to the net centroid).
     - Deduplicate coordinates and cap candidate count so runtime stays strictly bounded.

2. **Upgrade `routeDocument` in `packages/auto-layout/src/route.ts`** (zero extra work on 0-crossing schematics):
   - Enhance `routingScore(document, resolver, roles?)` so that when `roles` is available, `railCrossings` (via `railCrossingMetrics(document, resolver, roles.rails).violations`) is penalized alongside total `crossings`:
     - Compare `[missingConnections, audit.crossings + railCrossings, audit.crossings, audit.bends, audit.wireLength]` (so eliminating a rail crossing is preferred over an equal-count signal crossing, while never trading 1 rail crossing for 2 signal crossings).
   - Keep the existing primary routing pass unchanged when `!options.ripUp` or when `audit.crossings === 0`.
   - When `options.ripUp && audit.crossings > 0`:
     - **Single-net rip-up**: include crossed power rails (skipping any `cross.nets` or protected/contact-bound nets) in addition to crossed signal nets, and allow a second convergence sweep only if the first sweep made progress (capped at 2 sweeps total).
     - **Negotiated pairwise order-reversal rip-up**: for the top `K` (at most 4) mutually crossing non-power, non-`cross.nets` signal pairs `(A, B)` remaining after single-net rip-up, rip up both `A` and `B` together and re-route in reversed order `(B, A)` (and `(A, B)` if `A` originally came after `B`), accepting strictly better `routingScore` with zero new `unsafeProblems` or `missingConnections`.
     - **Bounded global-order alternative pass**: if crossings still remain (`audit.crossings > 0`), try ONE complete re-route using the geometry-driven order from `global-route-order.ts` (ascending HPWL/fanout for signals; and if `railCrossings > 0`, route signals first and rails second so rails see the finished signal geometry and select clear tracks via `planningMemo`). Accept ONLY if it strictly improves `routingScore` without increasing `unsafeProblems`, `missingConnections`, or `floatingPins`.
   - Ensure `routedGroups` / returned `edits` and `diagnostics` remain transactionally replayable from the input `document` (whole-list replay consistency, just like existing R95).

3. **Upgrade `packages/auto-layout/src/local-reroute.ts` and >40 rail rerouting in `packages/auto-layout/src/auto-layout.ts`**:
   - In `local-reroute.ts`:
     - Upgrade `trunkTracks` to use `discoverChannelTracks` (outer schematic envelope + clear inter-row/column channels + pin-envelope tracks), keeping the MST (`undefined`) candidate first.
     - Scale trial cap cleanly from `3` to `Math.min(8, Math.max(3, counts.size))` for signal rerouting and `Math.min(4, Math.max(3, counts.size))` for rail rerouting, always respecting `stopped()` and stopping early when `!audit.crossings`.
     - Refine `rejectRouting`: keep all hard safety/integrity invariants (`unsafeProblems === 0`, `missingConnections === 0`, `floatingPins === 0`, `terminalPartition`, `lostNameClaim`, `!readabilityRegressed`, rail guards). Allow a track candidate that **strictly reduces `crossings` (or `railCrossings`)** with strictly improved `score(final) < bestScore` even when `bends` or `wireLength` increases slightly (bounded by `next.bends <= audit.bends + 4 * crossingDrop` and `next.wireLength <= audit.wireLength + Math.max(8 * grid, 24 * grid * crossingDrop)`), instead of unconditionally rejecting whenever `improvesReadability` is false (which always happened on `instances > 40`).
     - When `rails === true`, also prefer lower `railCrossings` when evaluating candidates (and avoid introducing new `railCrossings` during signal rerouting unless `improvesReadability` is true and total score strictly improves).
   - In `auto-layout.ts`:
     - For `instances > 40` (outside the `<= 40` polish block), when `search.evaluations > 0 && !stopped() && !options.partition` and the post-`reroutePortfolio` layout still has `railCrossings > 0`, run a bounded `keepIntactReroute(..., rerouteRailCrossings(...))` pass (using `finishLabels`) so large schematics also benefit from post-signal rail track selection.

4. **Fix the two PR #167 Round 2 P2 items in `packages/auto-layout/src/auto-layout.ts`**:
   - Include effective `repairBounds` (serialized deterministically, e.g., `repairBounds ?? null`) in `polishKey` (`auto-layout.ts:2559-2565`) and in the `finishedSeats` cache key inside `finishPlacement` so bounded primary finalists and unbounded alternate finalists never share a mismatched cache entry.
   - Update `aprGuardsRegressed` (`auto-layout.ts:1325-1347`) so that for `VISUAL_CONSTRAINT_VIOLATION` it inspects the set of violated constraint IDs (from `diagnoseVisualQuality(doc, resolver)` where `code === "VISUAL_CONSTRAINT_VIOLATION"`) and returns `true` if `after` introduces ANY violated constraint ID not present in `before` (even when the aggregate count is unchanged).

5. **Add comprehensive unit tests in `packages/auto-layout/test/`**:
   - Test ascending-HPWL net ordering and channel/envelope track discovery (`global-route-order.test.ts`).
   - Test pairwise rip-up-and-reroute resolving a mutual signal crossing where single-net rip-up gets stuck.
   - Test rail rerouting choosing an outer-envelope / channel track to eliminate a `railCrossing` (including on a synthetic `> 40`-instance schematic).
   - Test `polishKey` / `repairBounds` isolation.
   - Test `aprGuardsRegressed` equal-count constraint swap (fixing constraint A while breaking constraint B must return `true`).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/auto-layout/test
pnpm test:slow
```

Behavioral & benchmark checks (run by Task Lead after implementation):

- Zero regressions on existing unit and `test:slow` suites (`pnpm test:slow`).
- Measurable corpus-wide improvement in `crossings`, `railCrossings`, and `composite` across the 591 unsealed Gallery cases without circuit-specific logic.
- Per-case latency stays well-controlled (no tail explosion).
- Mandatory visual inspection of rendered PNG pairs on changed schematics.

## Notes for the implementer

- **General algorithms ONLY**: Never branch on circuit IDs, net names, instance references, or fixture-specific magic numbers. Every decision must follow from topology, pin/body geometry, crossing counts, and safety guards.
- **Keep latency bounded**: Do zero extra work on 0-crossing layouts; reuse `planningMemo`; respect `stopped()` inside all new loops; keep candidate track lists deduplicated and small (≤ 12 tracks per net).
- **Preserve whole-list transaction replay**: Every `edits` sequence returned by `routeDocument` and `rerouteNets` must replay cleanly from the original `document` via `preview(source, resolver, edits)`.
- Do not modify `readability-weights.ts`, `readability-selection-weights.ts`, or anything in `packages/edit-engine/`.
- Write your implementation report to `tasks/T192-global-route-track-ordering/report.md` (untracked; do not commit or push).
