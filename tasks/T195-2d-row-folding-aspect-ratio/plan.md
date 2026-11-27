# T195 — General 2D Multi-Row Stage & Component Folding for Aspect-Ratio Compaction

- Branch: `task/T195-2d-row-folding-aspect-ratio`
- Base: `main` at `f2118afe4a9aed1424959260ac78929a99d686f4`
- Status: approved
- Plan review: self-checked against `origin/main` (`f2118afe`) and full 591-case Gallery aspect-ratio & visual audit

## Goal

Eliminate overly elongated horizontal strip schematics (`W / H > 2.0`, especially in 11–103 device circuits where pure-device median `W / H` currently reaches `2.26–2.53` and `W / H >= 3.0` occurs at 2× the human reference rate) using general, topology-driven 2D multi-row folding and shelf packing. The optimization must be 100% general (zero circuit-specific heuristics or hardcoded IDs), incur zero extra latency on already well-proportioned layouts (`~85%` of Gallery cases), preserve all connectivity/safety/visual/symmetry/R162 body-lead guards, and improve both visual aspect ratio (`W / H` closer to the human comfort range `0.8–1.8`) and Gallery readability composite (`area`, `crossings`, `wireLength`).

## Context

Verified on `origin/main` (`f2118afe`) across all 576 completed Gallery cases:

1. **Single-row stage concatenation in `packages/auto-layout/src/stages.ts:788-878`**:
   - `placeStages` already decomposes devices into topological stages (`blocks`) via `findStages`, but its `twoRows` / `rowPitch` logic is gated strictly on `partition` (`const rowPitch = partition ? ... : 0`). Without an external partition, every stage and disconnected component is laid end-to-end along one horizontal row (`row = 0`, `x += b.width + 80`), producing 3:1–11:1 strips on multi-branch and multi-component circuits (`stages` accounts for 30/60 elongated cases, `template` 21/60, `layered` 8/60).
2. **No aspect-ratio awareness in `createPlacementEstimator` (`packages/auto-layout/src/estimate.ts:127`) or above-40 selection (`packages/auto-layout/src/readability-selection.ts:16`)**:
   - `estimate.ts` scores only `crossings + length / 1000`, so disconnected or weakly coupled components never prefer 2-row packing over a 1-row strip.
   - `readabilityTerm` returns `0` for `instances.length > 40`, and `readabilityMetrics` measures only `W * H` area without distinguishing `1200 x 200` from `490 x 490`.
3. **Marker re-seating via `given` in `packages/auto-layout/src/place.ts:375-406, 832`**:
   - Calling `planLayoutOnce(..., given, ...)` with `exact = undefined` and `given` containing only non-marker device placements (`!isMarker(i)`) validates grid/collision geometry and automatically runs `placeMarkers(...)` at `place.ts:832` so ports and power/ground markers re-seat cleanly around the new 2-row device bounding box.
4. **Finalist entry point in `packages/auto-layout/src/auto-layout.ts:442-466`**:
   - `planDocument` runs `selectFinalLayout -> finish -> preserveDrawnSymmetry / refineNetlistPlacement -> routeSelectedFinalist`. Running a tightly gated 2D folding check right before `routeSelectedFinalist` ensures any accepted folded finalist also receives T192 negotiated routing, channel track selection, `drawSourceBodies`, `followNetLabels`, and `preserveDraftingInterfaces`, while skipping `~85%` of circuits that are already well-proportioned (`layout W/H <= 1.85` and `instance W/H <= 2.1`).
5. **Latency & frozen metric rules**:
   - Do **not** modify `readability-weights.ts`, `readability-selection-weights.ts`, or `readability-metrics.ts`.
   - Honor `search.signal?.aborted` and `search.deadline` inside every candidate generation / trial loop.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/pack-rows.ts` (new pure computational-geometry & graph-folding module)
- `packages/auto-layout/src/stages.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/pack-rows.test.ts` (new regression & property tests)

Out of scope (do not change):

- `packages/auto-layout/src/readability-weights.ts`, `packages/auto-layout/src/readability-selection-weights.ts`, `packages/auto-layout/src/readability-metrics.ts`
- `packages/edit-engine/**`, `packages/derived/**`, `packages/model/**`, `packages/symbols/**`
- Any circuit-specific ID checks, fixture names, or special-case rules.

## Steps

1. **Create `packages/auto-layout/src/pack-rows.ts` — General 2D Multi-Row Folding Engine**:
   - Define `FoldingBlock`: `{ id: string; devices: Instance[]; placements: Map<string, Placement>; bounds: Rect; width: number; height: number; distance: number; canMirror?: boolean }`.
   - Implement `layoutAspectMetrics(document, resolver, placements)` returning `{ width, height, aspectRatio, elongation, area }` on visible device bounds (excluding markers) as well as full layout bounds, where `elongation = Math.max(width / height, height / width)`.
   - Implement `decomposePlacedBlocks(document, resolver, roles, groups, placements, symmetry)`:
     - Operates on placed non-marker devices (`!isMarker(i)`).
     - Keeps rigid units intact (recognized groups/templates, `symmetry` components, coupled inductors, `parallelAttachments`, `driverAttachments`, `layoutGroups`, and `constraints` members).
     - Builds two general decompositions:
       1. **Signal connected components** (connected via non-rail, non-bulk pins, unioning rigid units).
       2. **Stage blocks** via `findStages` (excluding bridge capacitors initially, then re-attaching bridges or placing bridges in their inter-stage gap), preserving each block's relative device poses from `placements`.
   - Implement three principled, deterministic 2D row-packing modes (targeting `TARGET_ASPECT = 1.35`, grid-snapped via `document.presentation.grid`, inter-row vertical clearance `rowGap >= 60` and horizontal clearance `colGap >= 60` snapped to grid):
     - **Mode A (`packComponentsIntoRows`)**: When signal connected components `>= 2`, pack components into `k = 2` (and `k = 3` when `components.length >= 4` and single-row `W / H > 2.8`) rows using deterministic shelf / balanced-width partitioning (evaluating exact subset/order splits when `n <= 8` or greedy Longest-Processing-Time / width-balanced bin assignment when `n > 8`), minimizing `max(rowWidths) * sum(rowHeights) * (1 + 0.35 * Math.max(0, elongation - 1.5))`.
     - **Mode B (`foldParallelBranches`)**: When `blocks.length >= 3`, inspect the inter-block non-rail signal graph. Identify parallel branch blocks (two or more blocks that have no direct signal edge between them — or substantially fewer direct edges than edges to a shared upstream/downstream hub block — and comparable signal depth). Stack parallel branches vertically into Row 0 and Row 1 (preserving signal flow left-to-right), and place any shared upstream hub on the left / shared downstream hub on the right vertically centered between Row 0 and Row 1.
     - **Mode C (`foldStageSequence`)**: Given horizontally ordered blocks (`blocks.length >= 2`, `W / H > 1.85`), evaluate split points `s` partitioning the sequence into 2 rows (and 3 rows when `blocks.length >= 6 && W / H > 3.2`). For 2-row splits, test both **left-to-right stacked** (`Row 0: 0..s-1 L->R`, `Row 1: s..n-1 L->R`) and **serpentine/boustrophedon** (`Row 0: 0..s-1 L->R`, `Row 1: s..n-1 R->L`, mirroring only `canMirror` blocks or keeping device poses intact to preserve R164 right-facing blocks). Align Row 1 horizontally relative to Row 0 using median inter-row signal pin-X clamped within `[0, max(0, row0Width - row1Width)]`, re-seat bridge parts between their owner blocks when applicable, snap all origins to grid, and reject any candidate where `geometryProblem(...)` is non-empty.
   - Implement `generateFoldedCandidates(document, resolver, roles, groups, basePlacements, symmetry, stopped)`:
     - Fast exit (`return []`) if `stopped()`, fewer than 6 non-marker devices, or device-only `width / height <= 1.85` (when `layoutWidth / layoutHeight` is already compact).
     - Run Modes A, B, C (respecting `stopped()` between modes/splits), deduplicate by quantized placement key, filter to collision-free (`!geometryProblem`) candidates that reduce device elongation by at least 18% (or achieve `elongation <= 1.75` from `> 2.1`), score with `createPlacementEstimator` + compact area/aspect penalty, and return at most **2** best distinct candidates.

2. **Wire General 2-Row Folding into `packages/auto-layout/src/stages.ts`**:
   - In `placeStages` (`stages.ts:788-990`), when `!partition` and `blocks.length >= 2`:
     - After the existing single-row local search finishes (`best`), compute device bounding-box aspect ratio `W / H`.
     - If `W / H > 2.0`, evaluate `pack-rows.ts` candidates built directly from `blocks` (and `bridgeInfo`, honoring `canMirror` and `roles.rightFacing`).
     - Accept a 2D folded `stages` placement inside `placeStages` only when it is collision-free (`!geometryProblem`), keeps `reversedSignalHosts` false, reduces `W / H` significantly (`>= 20%` reduction toward `1.35`), and either strictly reduces `estimate(candidate).score` OR keeps `estimate(candidate).crossings <= estimate(best).crossings` and `estimate(candidate).length <= estimate(best).length * 1.08` while reducing bounding-box area `W * H`.
     - Preserve existing behavior verbatim when `partition` is supplied or when single-row `W / H <= 2.0`.

3. **Add Gated Finalist 2D Folding in `packages/auto-layout/src/auto-layout.ts`**:
   - Implement `foldElongatedFinalist(source, resolver, options, incumbent, finish)` called in `planDocument` right before `routeSelectedFinalist` (`auto-layout.ts:458`).
   - **Strict eligibility & fast exit** (0 ms overhead on ~85% of drawings):
     - Exit immediately returning `incumbent` if:
       - `options.partition` is set (or `AUTO_LAYOUT_PARTITION_FALLBACK` not needed — wait: handle partition fallback identically to `routeSelectedFinalist` by stripping `partition` only if `AUTO_LAYOUT_PARTITION_FALLBACK` is present, else skip when `options.partition` is set),
       - `options.fixedInstanceIds?.size > 0`,
       - any `layoutGroups` or `constraints` is `locked`,
       - `options.search?.evaluations === 0` or `stopped()`,
       - `incumbent` has error diagnostics or `!final` or `source.instances.length !== final.instances.length` (e.g. added rail markers that rebuild cannot mirror) or `source.drafting?.objects.length` has seated drafting groups that moved relative to source (check cleanly so R150 seated drafting is never lost — or re-apply `followDraftingGroups`),
       - BOTH `layoutWidth / layoutHeight <= 1.85` AND `instanceWidth / instanceHeight <= 2.1` (computed on `final` visible bounds!).
   - When eligible:
     - Extract non-marker device placements from `final`, call `generateFoldedCandidates(...)` to get at most 2 distinct folded device placement maps.
     - For each candidate (checking `stopped()` before each):
       - Route via `planLayoutOnce(source, resolver, effectiveOptions, emptyOverrides(), refinementMetrics(incumbent)?.strategy, true, undefined, undefined, candidateDevices, true, false, contactPolicy(source, freezePinGroups(source, resolver), true))`.
       - Note `exact` is `undefined`, so `placeDocument` automatically re-seats markers/ports cleanly around the 2-row layout via `placeMarkers(...)`!
       - Apply `finish(finishLabels(finalizeFacing(source, resolver, effectiveOptions, trial.result)))` (and if `source.drafting?.objects.length`, preserve drafting via `followDraftingGroups` before `finish`).
       - Verify ALL hard guards on `after`:
         - `connectionsIntact(after, resolver)`
         - `auditRouting(after, resolver).unsafeProblems.length === 0`
         - `terminalPartition(final, resolver) === terminalPartition(after, resolver)`
         - `!lostNameClaim(final, after)`
         - `!lostDrawnBodyLead(drawnBodyLeads(final, resolver), after, resolver)`
         - `!aprGuardsRegressed(final, after, resolver)`
         - `routedGuards(after, resolver)` has no key exceeding `routedGuards(final, resolver)`
         - `readabilityMetrics(after, resolver, "weighted").unownedDrafting.violations <= readabilityMetrics(final, resolver, "weighted").unownedDrafting.violations`
         - `keepIntactReroute(source, resolver, incumbent, candidate) === candidate`
       - **Acceptance rule** (strictly protects crossings & readability while rewarding dramatic aspect-ratio cleanup):
         - Let `beforeAudit = auditRouting(final, resolver)`, `afterAudit = auditRouting(after, resolver)`, `beforeRail = railCrossingMetrics(...)`, `afterRail = railCrossingMetrics(...)`.
         - Reject if `afterAudit.crossings > beforeAudit.crossings` or `afterRail.violations > beforeRail.violations` (unless `source.instances.length <= 40` and frozen `readabilityTerm(after)` strictly beats `readabilityTerm(final)` AND `afterAudit.crossings <= beforeAudit.crossings + 1`? Keep it even safer: **never** accept increased `crossings` or `railCrossings` on a folding trial unless `readabilityTerm` strictly improves by at least 5% AND `afterRail <= beforeRail`).
         - For `source.instances.length <= 40`:
           - Accept if `readabilityTerm(after, resolver) < readabilityTerm(final, resolver)` (strictly better frozen readability composite!), OR
           - Accept if `readabilityTerm(after, resolver) <= readabilityTerm(final, resolver) * 1.02` AND `afterAudit.crossings <= beforeAudit.crossings` AND `afterRail.violations <= beforeRail.violations` AND `afterLayoutArea <= beforeLayoutArea * 1.02` AND `afterElongation <= beforeElongation * 0.78` (at least 22% elongation reduction toward square!).
         - For `source.instances.length > 40`:
           - Accept if `afterAudit.crossings <= beforeAudit.crossings` AND `afterRail.violations <= beforeRail.violations` AND (strictly smaller `afterLayoutArea < beforeLayoutArea` OR (`afterLayoutArea <= beforeLayoutArea * 1.05` AND `afterElongation <= beforeElongation * 0.78` AND `afterAudit.wireLength <= beforeAudit.wireLength * 1.10`)).
       - Carry any `partition` / `AUTO_LAYOUT_PARTITION_FALLBACK` diagnostics and call `retainRefinementMetrics` when promoting a winner.

4. **Add Comprehensive Unit & Regression Tests in `packages/auto-layout/test/pack-rows.test.ts`**:
   - Test Mode A (2 and 3 disconnected multi-device chains laid out horizontally -> packed into 2 rows with `W / H` reduced by >35%, 0 crossings, intact connectivity, deterministic order).
   - Test Mode B (two parallel signal branches feeding a shared output block -> stacked into 2 vertical rows with shared hub centered on the right, reduced `W / H` and wire length).
   - Test Mode C (long 4-stage / 6-stage chain -> folded into 2 rows with collision-free grid-aligned coordinates and reduced `W / H`).
   - Test fast-exit invariance: already square drawings (`W / H <= 1.85`) return `[]` from `generateFoldedCandidates` and incur zero extra routing calls in `planAutoLayout`.
   - Test guard preservation: fixed instances, locked layout groups, drawn MOS body leads (R162), and expired search deadlines (`deadline: 0` / aborted `AbortSignal`) are respected cleanly.
   - Test `> 40`-device elongated multi-component drawing folds cleanly with 0 missing connections and reduced `W / H`.

## Acceptance

Run from the repository root; all must pass:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/auto-layout/test/pack-rows.test.ts
pnpm exec vitest run packages/auto-layout/test
pnpm test:slow
```

Behavioral checks (verified by Task Lead on full 591-case Gallery A/B vs `origin/main` `f2118afe`):

- Zero new refusals, zero non-equivalent circuits, `floatingPins = 0`, `missingConnections = 0`, `VISUAL_LABEL_OVERLAP = 0`.
- Measurable reduction in elongated schematics (`W / H > 2.0`, `W / H >= 2.5`, `W / H >= 3.0`, and L4/L5 device median `W / H`) with frozen readability composite improved or neutral (no regression on either `dev` or `val` split).
- Median and p95 per-case planning latency stay bounded (no latency spikes on square drawings).
- Visual PNG before/after audit confirms cleaner, squarer layouts without overlapping labels, stranded wires, or broken symmetry.

## Notes for the implementer

- **Strict generalization**: Never branch on circuit IDs, device instance names, or symbol names beyond existing generic categories (`isMarker`, `isMos`, `deviceDescriptor`).
- **Exact optional property types**: Remember `tsconfig` enables `exactOptionalPropertyTypes` — omit optional fields instead of passing `undefined`.
- **Determinism**: Sort all maps/sets/component lists via `compareIds` so placement hashes are 100% deterministic across runs.
- **No frozen-metric edits**: Leave `readability-weights.ts`, `readability-selection-weights.ts`, and `readability-metrics.ts` untouched.
- **Keep `placeStages` fast**: Guard `pack-rows` trials inside `placeStages` strictly on `!partition && blocks.length >= 2 && W / H > 2.0`, and keep estimator screening O(1) candidates (at most 2 routed trials in `foldElongatedFinalist`).
