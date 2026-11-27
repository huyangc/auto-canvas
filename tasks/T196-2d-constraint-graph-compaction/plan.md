# T196 — General 2D Constraint-Graph Compaction

- Branch: `task/T196-2d-constraint-graph-compaction`
- Base: `main` at `7e033b808777ac8099a144302408eaec6b3da1a3`
- Status: approved
- Plan review: self-checked against `compact.ts`, `gap-closing.ts`, `device-relocation-search.ts`, `pack-rows.ts`, `auto-layout.ts`, `routed-search-score.ts`, and full 591-case post-T195 Gallery diagnostics (`area` accounts for `+74.12` / 73.4% of the remaining `+100.97` readability gap; 50.3% of all circuits have `instanceAreaRatio > 1.2x`).

## Goal

Add a general, deterministic **2D Constraint-Graph Compaction** module (`compact-2d.ts`) and wire it into the post-finalist finishing pipeline (`compactFinalist2D` in `auto-layout.ts`), shrinking excess 2D inter-device and inter-block whitespace across all device levels (including both `<= 40` and `> 40` devices) without breaking symmetry, pin alignment, rigid structures, routing quality, or per-case latency budgets.

## Context

Verified in the codebase at `7e033b80`:
- `packages/auto-layout/src/compact.ts` (`compactPlacements` lines 21–92, `compactRows` lines 139–214) only performs **1D global sweep-line** compaction with `MARGIN = 20` on both sides (`40u` forced empty corridor across the entire schematic width/height). Any staggered multi-row or multi-column layout blocks global 1D cuts completely.
- `packages/auto-layout/src/gap-closing.ts` (`gapClosingCandidates` lines 8–80) and `packages/auto-layout/src/device-relocation-search.ts` (`searchDeviceRelocations` lines 257–369) only slide one rigid unit at a time within a shared 10-trial budget (and skip `> 40` devices because `readabilityTerm` returns `0` above 40 instances in `readability-selection.ts:16`). Single-unit moves cannot cascade a chain of loosely spaced columns or rows inward together.
- `packages/auto-layout/src/auto-layout.ts:463-470` invokes `foldElongatedFinalist` followed by `routeSelectedFinalist`. `foldElongatedFinalist` (lines 507–693) already demonstrates the exact safe pattern for post-finalist device-only replanning (`planLayoutOnce(..., devices, ..., true, false, contacts)` → `finalizeFacing` → `followDraftingLabels` → `separateLabels` → `followDraftingGroups` on a cloned base → `finish(labeled)` → strict guards + best-candidate selection).
- Passing non-marker device poses to `planLayoutOnce` allows `placeMarkers` to automatically re-seat rail markers and ports tightly against the compacted device core rather than leaving stale markers floating in empty space.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/compact-2d.ts` (new)
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/compact-2d.test.ts` (new)

Out of scope (do not change):

- Frozen evaluation weights (`readability-weights.ts`, `readability-selection-weights.ts`)
- Any circuit-specific / ID-based rules or hardcoded gallery overrides
- Existing 1D `compactPlacements` / `compactRows` public signatures or unrelated packages

## Steps

1. **Create `packages/auto-layout/src/compact-2d.ts`** implementing general, deterministic 2D visibility / constraint-graph compaction for non-marker devices:
   - **Axis-Specific Rigid Units (`compactionUnits(document, resolver, roles, groups, axis)`)**:
     - Operates on non-marker devices (`!isMarker(i)`).
     - Base rigid bindings shared by both axes: user `layoutGroups`, `constraints`, `validInductorCouplings(document)`, `parallelAttachments`, `driverAttachments`, and 2-pin feedback parts spanning two non-rail nets of one signal block (same criteria as `compact.ts:174-183`).
     - Recognized structures & symmetry preservation:
       - In the **X-pass** (`axis === "x"`): keep each `resolvedSymmetry` component rigid (preserving exact mirror axis and equidistant pairs), keep recognized `groups` (`members`, `extraMemberIds`, `tailInstanceId`, `diodeInstanceId`) rigid, and merge **aligned vertical conducting stacks** (two devices sharing a non-rail net whose conducting pins have `a.x === b.x`, opposing vertical pin exits, and `(b.y - a.y) * a.exit.y > 0`, as in `relocationUnits`) so vertical straight connections never break into doglegs.
       - In the **Y-pass** (`axis === "y"`): keep every **same-Y symmetry pair** `(a, b)` (`Math.abs(y_a - y_b) <= grid`) rigid together and every same-Y recognized pair (`members` sharing the same Y) rigid together, while allowing distinct vertical rows of a symmetric tower (e.g., load row, diff-pair row, tail row) to compress vertically toward each other without breaking horizontal pair symmetry or the shared X axis. Merge **aligned horizontal conducting series** (two devices sharing a non-rail net whose conducting pins have `a.y === b.y`, opposing horizontal pin exits, and `(b.x - a.x) * a.exit.x > 0`) so horizontal straight wires stay level.
     - Deterministic unit IDs and member sorting via `compareIds`.
   - **Wire-Channel-Aware Visibility DAG & Longest-Path Solver (`compactAxis2D(...)`)**:
     - For each unit `u`, compute its combined bounding box from `visibleInstanceBounds` AND transformed pin coordinates of its members (`pinPoints`), snapped/padded to exact coordinates.
     - Build directed visibility edges `u -> v` whenever `u` precedes `v` along `axis` (`u.hi <= v.lo` or strictly smaller center without box overlap along `axis`) AND their cross-axis intervals overlap when inflated by `crossClearance` (`2 * grid`).
     - Compute the minimum required gap `gap(u, v)` (grid-snapped) as:
       - `baseGap` (parameterized: e.g. `2 * grid` for tight tier, `3 * grid` for standard tier),
       - PLUS wire-channel allowance when the incumbent `document.routes` has distinct routed non-rail nets with segments traversing the corridor between `u` and `v` within their overlapping cross-axis band: add `Math.min(4, crossingTrackCount) * grid` (or `Math.min(3, ...)` in tight tier),
       - PLUS extra `grid` if either unit has a pin directly facing into the corridor toward a different-net pin on the opposite unit (preventing `collinearAbutment` / pin-clearance cramping).
     - Solve **forward longest path** `minPos[v]` (snapped up to `grid`) to get compacted span `spanNew = max_v(minPos[v] + size(v))`.
     - Solve **backward longest path** `maxPos[u]` within `[0, spanNew]` (snapped down to `grid`) so every unit has a guaranteed collision-free, span-preserving slack window `[minPos[u], maxPos[u]]`.
     - **Wire-Length-Minimizing Slack Distribution**: run 4 deterministic Gauss-Seidel passes updating each unit's position toward the median pin-alignment target of its signal-connected neighbor units (using non-rail nets), clamped to its live predecessor/successor constraint bounds `[lo, hi]` and snapped to `grid`.
     - Anchor the compacted result back to the original minimum coordinate along `axis` (grid-snapped), translate each unit's members rigidly, and validate `geometryProblem(devicesOnlyDoc, resolver) === undefined`.
   - **Multi-Order Candidate Generator (`generateCompacted2DCandidates(...)`)**:
     - Honors `stopped()` callback inside every pass/order loop.
     - Generates up to 3 complementary 2D compaction orders:
       1. `X -> Y` with `baseGap = 2 * grid` (tight, wire-channel aware)
       2. `Y -> X` with `baseGap = 2 * grid` (tight, wire-channel aware)
       3. `X -> Y` with `baseGap = 3 * grid` (relaxed, wire-channel aware)
     - Also tries single-axis `X` and `Y` (`baseGap = 2 * grid`) only if neither 2D pass passed geometry validation.
     - Deduplicates identical device pose maps (`JSON.stringify` sorted by instance id).
     - **Fast zero-overhead pre-screen**:
       - Compute device-only enclosing area before vs after (`layoutAspectMetrics`).
       - Discard any candidate that does not meaningfully compact devices: require `afterDevArea <= beforeDevArea * 0.94` OR (`afterDevArea <= beforeDevArea * 0.97` and `(afterDevW <= beforeDevW - 2 * grid || afterDevH <= beforeDevH - 2 * grid)`).
       - Discard any candidate that makes elongation significantly worse on an already-wide drawing (`afterDevElong > Math.max(2.2, beforeDevElong * 1.15)`).
       - If no candidate survives pre-screening, return `[]` immediately (zero routing calls!).
     - Rank surviving distinct candidates by `(estimatedCrossings * 1000 + estimatedWireLength * 0.5 + afterDevArea / 100)` using `createPlacementEstimator` and return at most the top **2** candidates (or **3** if `devices.length >= 20`).

2. **Wire `compactFinalist2D` in `packages/auto-layout/src/auto-layout.ts`**:
   - Export `@internal compactFinalist2D(source, resolver, options, incumbent, finish)` alongside `foldElongatedFinalist` and call it in `planAutoLayout` right after `foldElongatedFinalist` and before `routeSelectedFinalist`.
   - Early exits (zero routing calls):
     - `(partition && !fallback.length)` or `effective.search?.evaluations === 0` or `stopped()` or `fixed.size > 0` or any locked `layoutGroup`/`constraint`.
     - `final` missing, `final.instances.length !== source.instances.length`, or `final.instances.length < 4`.
   - Replan each candidate from `generateCompacted2DCandidates` through the full safe finishing pipeline:
     - `planLayoutOnce(source, resolver, effective, emptyOverrides(), refinementMetrics(incumbent)?.strategy, true, devices, undefined, undefined, true, false, contacts)`
     - `finalizeFacing` → `followDraftingLabels` → `separateLabels`
     - If `source.drafting?.objects.length`, run `followDraftingGroups` against a cloned `base` and skip the candidate if `drafted !== labeled` (preserving the T195 drafting-fallback safety invariant!).
     - `const candidate = finish(labeled)`.
   - **Strict Acceptance Gate** (zero regressions):
     - Hard safety & integrity: `!audit.unsafeProblems.length`, `connectionsIntact`, identical `terminalPartition`, `!lostNameClaim`, `!lostDrawnBodyLead`, `!aprGuardsRegressed`, no `routedGuards` regression, no `unownedDrafting` regression, `keepIntactReroute` intact, and **no `netlistSymmetry` regression** (`netlistSymmetry(after).violations <= netlistSymmetry(final).violations`).
     - No routing regression: `audit.crossings <= baseline.crossings` and `afterRail <= beforeRail`.
     - Strict improvement:
       - For `source.instances.length <= 40`: `readabilityTerm(after, resolver) < readabilityTerm(final, resolver)` AND `afterMetrics.layout.area <= beforeMetrics.layout.area`.
       - For `source.instances.length > 40`: `afterMetrics.layout.area < beforeMetrics.layout.area * 0.98` AND `audit.wireLength <= baseline.wireLength * 1.02` AND `audit.bends <= baseline.bends * 1.05`.
     - Evaluate all budgeted candidates (stopping early on `stopped()`) and select the **best** passing candidate (lowest `readabilityTerm` for `<= 40`; lowest `[crossings, afterRail, layoutArea, wireLength]` for `> 40`), carrying partition diagnostics and retaining refinement metrics.

3. **Create focused unit & regression tests in `packages/auto-layout/test/compact-2d.test.ts`**:
   - Staggered 2-row multi-column circuit where 1D global `compactPlacements`/`compactRows` finds zero gaps, verifying `generateCompacted2DCandidates` compresses both X and Y (`deviceArea` drops by >= 25%), preserves grid alignment, `geometryProblem === undefined`, and routes with 0 crossings.
   - Symmetric differential amplifier with loose vertical row spacing & loose side stage: verifies X-pass preserves mirror axis and pair equidistance, Y-pass compresses row pitch while keeping symmetric pairs level (`y_L === y_R`), and `netlistSymmetry` does not regress.
   - Vertical conducting stack & horizontal signal chain preservation: verifies X-pass keeps vertical conducting pins aligned (`x_a === x_b`) and Y-pass keeps horizontal conducting pins aligned (`y_a === y_b`).
   - Wire-channel clearance awareness: verifies wider inter-unit gap is reserved when multiple routed wires traverse the corridor between two blocks vs when the corridor has no wires.
   - Guard & zero-overhead invariants: already-compact circuit returns `[]` with zero extra `routeDocument` calls; honors `fixedInstanceIds`, locked `layoutGroups`, aborted `AbortSignal`, expired `deadline`, drafting-fallback safety (incumbent untouched and `finish` not called), and `> 40`-device circuit compaction with `terminalPartition` intact (with explicit test timeout `30000` for any multi-planner test).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/auto-layout/test/compact-2d.test.ts
pnpm exec vitest run packages/auto-layout/test
pnpm test:slow
```

Behavioral checks (verified by Task Lead on full 591-case Gallery A/B):
- Common-completed readability score improves cleanly on both `dev` and `val` with `0` newly refused circuits.
- Total area / `instanceAreaRatio` drops meaningfully across L2–L5 without regressing crossings, rail crossings, symmetry, or elongation (`W/H > 3.0`).
- Per-case median and p95 latency remain tightly bounded.

## Notes for the implementer

- Keep all algorithms 100% general and topology/geometry-driven — never hardcode circuit IDs, symbol names (beyond standard `isMarker` / `channelPins` / existing repo helpers), or gallery-specific heuristics.
- Check `CODING_STANDARDS.md` (strict TypeScript, zero `any`, clean helper decomposition, no unused exports/variables).
- Add explicit timeouts (e.g., `30000`) to any Vitest test that runs full `planAutoLayout` or routes > 40 devices so CI never flakes under runner load.
- Write your concise implementation summary to `tasks/T196-2d-constraint-graph-compaction/report.md` (untracked; do not commit).
