# T205 — Deterministic proxy-evaluated skeleton SA draft for medium and large transistor circuits

- Branch: `task/T205-skeleton-proxy-sa`
- Base: `main` at `f45c0797`
- Status: approved
- Plan review: self-checked against `packages/auto-layout/src/auto-layout.ts`, `place.ts`, `search-moves.ts`, `estimate.ts`, `finished-selection.ts`, `symmetry.ts`, `stages.ts`, and `docs/specs/auto-layout.md`

## Goal

Add a fast, deterministic, proxy-evaluated simulated annealing draft strategy (`"skeleton-sa"`) in `packages/auto-layout` for medium and large transistor circuits (`devices.length >= 12` and `document.instances.length <= 120`, search mode only), inspired by Netlist2Schematic's topology-preserving active-skeleton SA. Because every inner-loop step evaluates a fast geometric proxy (no routing inside the SA loop), it can run 1,500–2,000 calibrated annealing moves in tens of milliseconds — lifting the 40-instance search cliff (where R66 real-routed SA is throttled to 2 evaluations and refinement is disabled) and improving non-symmetric / multi-branch 12–120 device circuits while leaving quick mode and `<=11`-device circuits byte-identical.

## Context

- `packages/auto-layout/src/auto-layout.ts`:
  - `defaultLayoutSearch` (`L210-L222`) drops `evaluations` to `2` above 40 instances.
  - `refineLayout` (`packages/auto-layout/src/refine.ts:205`) sets `limit = 0` above 40 instances.
  - `selectFinalLayout` (`L1321-L1327`) disables `finalists` above 40 instances.
  - `conventionDraftEligible` and `mctsDraftEligible` only cover small circuits (`<=20` devices / `<=40` instances).
  - Draft strategies are orchestrated in `planWithSeriesLevels` (`L2243-L2460`), with `mcts` deferred to a guarded finalist (`mctsFinalist`) when `options.finalists` is active (`<=40` instances) so it never displaces an annealable incumbent or introduces readability/visual regressions.
- `packages/auto-layout/src/place.ts`:
  - `placeDocument` (`L469-L556`) dispatches `"convention"` and `"mcts"` via `planningMemo`, verifies all devices are placed and symmetry counts are preserved (`L523-L544`), and marks `oriented = new Set(targets.keys())`.
- `packages/auto-layout/src/search-moves.ts`:
  - `placementUnits` (`L58-L165`) already builds rigid topology units preserving recognized groups, R88/mirror symmetry components, R18 aligned stacks, and parallel attachments, plus `randomStream` (Mulberry32 deterministic PRNG).
- `packages/auto-layout/src/estimate.ts`:
  - `createPlacementEstimator` (`L70-L129`) computes exact Prim-MST Manhattan wirelength and sweep-line orthogonal segment crossings for any placement map.
- `packages/auto-layout/src/finished-selection.ts`:
  - `FinalistKind` (`L21-L30`) enumerates guarded finalist tracks evaluated through `selectFinishedLayout`.
- `packages/auto-layout/src/types.ts`:
  - `LayoutStrategy` (`L7-L16`) enumerates draft strategy names.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/skeleton-sa.ts` (new)
- `packages/auto-layout/src/types.ts`
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/finished-selection.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/skeleton-sa.test.ts` (new)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- Quick mode (`options.search?.evaluations === 0`) behavior or byte-identical outputs on circuits with `< 12` devices
- `packages/edit-engine` routing core
- Existing `template`, `layered`, `stages`, `convention`, or `mcts` placement algorithms
- `packages/auto-layout/src/layered.ts` (T204 owns that change on a separate branch)

## Steps

1. **Add `"skeleton-sa"` to `LayoutStrategy` (`packages/auto-layout/src/types.ts`) and `FinalistKind` (`packages/auto-layout/src/finished-selection.ts`)**:
   - Ensure `draftStrategy` / `isStackStrategy` in `stack-snap.ts` (check read-only) handles `"skeleton-sa"` cleanly without requiring a `+stack` variant (and do not emit `"skeleton-sa+stack"`).
   - Add `"skeletonSa"` to `FinalistKind` and include it in `rankedFinalists` / `selectFinishedLayout` with the same guarded selection criteria used for `"mcts"`.
2. **Implement `packages/auto-layout/src/skeleton-sa.ts`**:
   - Export `skeletonSaDraftEligible(document, resolver, options)`:
     - Returns `true` only when:
       - `options.search?.evaluations !== 0` (never runs in quick mode)
       - `!options.partition`
       - `!options.fixedInstanceIds?.size`
       - no locked `layoutGroups` or `constraints`
       - `document.instances.length <= 120`
       - non-marker `devices.length >= 12`
       - `hasTransistor(document)` is true
       - no hierarchical pin roles (`devicePins(i, resolver).some(p => p.role.includes("hierarchical"))`)
   - Export `solveSkeletonSaDraft(document, resolver, roles, templates, topology, options?)`:
     - **Multi-seed initialization**: Build candidate initial device placements from both `layered` (`placeLayered` / `deviceRows` + `assignColumns`) and `stages` (`placeStages`), keep those passing `geometryProblem` and preserving symmetry, and pick the lowest proxy energy seed (tie-break: `layered` first).
     - **Rigid movement units & constraints**:
       - Reuse `placementUnits(document, resolver, new Set(), undefined, { unsplitSymmetry: roles.unsplitSymmetry ?? false, mirrorSymmetry: roles.mirrorSymmetry ?? false })` and `findStages(devices, resolver, roles, templates, topology.components)`.
       - Never split a rigid placement unit or break `expectedSymmetry` (`symmetryCounts` for `topology.components` or `mirrorSymmetryTopology` when `topology.components` is empty).
       - Respect `rightFacingBlocks` / `againstFlowCounter` (R164) and integer grid alignment (`document.presentation.grid`).
     - **Fast geometric proxy energy (`evaluateEnergy`)**:
       - Use `createPlacementEstimator(devices, resolver, roles)` for exact Prim-MST Manhattan `length` and sweep-line `crossings`.
       - Add fast, topology-derived analog terms:
         - **Vertical conducting-channel alignment**: for every non-rail net joining conducting channel pins (`D`/`S` or `C`/`E`) of two devices on different rows (`|yA - yB| > grid`), penalize `|pinA.x - pinB.x| / colPitch` (weighted by `1 / max(1, netChannelMembers - 1)`).
         - **Signal flow / gate backtracking**: using `signalDistances(document, devices, resolver, roles)`, penalize non-rail gate/signal edges where downstream device lies strictly to the left of upstream device (`x_to < x_from`).
         - **Stage / block dispersion**: for each stage block or recognized group, penalize excess horizontal span across members sharing a row.
         - **Compact bounding span**: small weight on `(bboxWidth + bboxHeight)` so SA stays compact and does not drift units outward.
       - Combine with balanced weights (e.g., `220 * crossings + 1.0 * length + 80 * verticalMisalignment + 60 * gateBacktracking + 50 * dispersion + 0.25 * span`).
     - **Calibrated deterministic SA loop**:
       - Fixed seed (`20261029`, or `options.search?.seed ?? 1` mixed deterministically) via `randomStream` — never `Math.random()`, never wall-clock-dependent iteration counts (check `signal?.aborted` / `deadline` only every 32 steps to allow clean cancellation).
       - **Move proposals** (row-preserving for transistors/rigid units; local horizontal/vertical shifts allowed for free two-pin passives):
         1. Horizontal unit translation (`±1..4` column steps, or pin-alignment snap to a connected unit's pin X).
         2. Same-row rigid unit swap (exchanging X positions of two units sharing a row).
         3. Multi-row stage block horizontal swap or sub-range reversal (slot-preserving).
         4. Horizontal mirror of a free single transistor/passive or free ungrouped block (re-righting directed blocks in place per R164).
         5. Free two-pin passive local row/column move toward its connected host pins (only for ungrouped non-channel passives not in a symmetry pair).
       - Reject any move that fails grid alignment, `geometryProblem`, `againstFlowCounter`, or symmetry preservation.
       - Sample up to 64 valid moves to calibrate initial temperature `T0` for ~70% uphill acceptance (`T0 = Math.max(1, -meanPosDelta / Math.log(0.7))`), run `1500` iterations (capped at `1200` when `devices.length > 40` to stay fast), exponential cooling `T0 * Math.pow(0.015, step / maxSteps)`, with up to 2 reheats back to best state on stagnation.
       - **Post-SA greedy pin-alignment polish**: one deterministic pass over movable units (in canonical ID order) trying small horizontal snaps toward connected pins and keeping strictly energy-improving, geometry-valid moves.
     - Return `{ placements, improved, beforeEnergy, afterEnergy, steps }` (returning `problem` if no valid seed or no improvement over the seed).
3. **Wire `"skeleton-sa"` into `packages/auto-layout/src/place.ts` and `packages/auto-layout/src/auto-layout.ts`**:
   - In `place.ts`: add `else if (strategy === "skeleton-sa")` calling `planningMemo(..., () => solveSkeletonSaDraft(...))`, validating completeness & `symmetryCounts` (mirroring the `"mcts"` branch), and setting `oriented = new Set(targets.keys())`.
   - In `auto-layout.ts`:
     - Only invoke when `skeletonSaDraftEligible(document, resolver, options)` and `!stopped()`.
     - Route the `"skeleton-sa"` candidate once via `route("skeleton-sa", emptyOverrides())`. Discard if non-finite `routedScore`, duplicate edits, or broken connections (`floatingPins > 0` or `missingConnections > 0` when incumbent is intact).
     - **When `options.finalists` is active (`<=40` instances)**: defer `"skeleton-sa"` to a guarded `skeletonSaFinalist` registered in `options.finalists` (identical to `mctsFinalist`) so it competes through `selectFinishedLayout` with full readability and visual-guard protection, never displacing an annealable incumbent.
     - **When `options.finalists` is absent (`>40` instances)**: finish `"skeleton-sa"` only if it has distinct placements and beats `incumbent` on completeness or strictly improves `routedScore` without increasing `auditRouting(...).unsafeProblems.length` or `routedGuards` (protecting against visual/completeness regressions while unlocking large-circuit gains!).
4. **Update `docs/specs/auto-layout.md`**:
   - Document the new rule (next R-number after the highest existing R-number in `docs/specs/auto-layout.md`) for the deterministic proxy-evaluated skeleton SA draft.
5. **Write comprehensive tests in `packages/auto-layout/test/skeleton-sa.test.ts`**:
   - Eligibility tests: `<12` devices ineligible, quick mode (`evaluations: 0`) ineligible, partitioned/fixed/locked/hierarchical ineligible, `>=12` transistor circuit eligible (including `>40` instances).
   - Determinism test: identical input produces byte-identical serialized edits across repeated runs.
   - Symmetry & R164 preservation test: R88 symmetric pairs stay mirrored/level and rigid; directed blocks never flip against flow.
   - Quality & electrical integrity tests: multi-stage / non-symmetric 14–24 transistor circuits and a `>40`-instance (e.g. 46-instance) transistor+passive circuit complete with zero floating pins, zero missing connections, intact `terminalPartition`, zero `unsafeProblems`, and `solveSkeletonSaDraft` strictly reduces proxy energy on a scrambled multi-column topology.
   - Quick-mode invariance test: `evaluations: 0` produces identical edits to baseline (never triggers `skeleton-sa`).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm vitest run packages/auto-layout
pnpm test:slow
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm deadcode
```

Behavioral checks:

- All existing unit tests (1,318+) and slow quality benchmarks (`pnpm test:slow`) pass with zero regressions.
- `skeleton-sa` never runs in quick mode or on circuits with `<12` devices.
- On `>=12`-device circuits (including `>40` instances), `"skeleton-sa"` runs in deterministic pure TS, preserves electrical equivalence and symmetry, and never introduces new `unsafeProblems` or missing connections.

## Notes for the implementer

- Check `packages/auto-layout/src/stack-snap.ts` and `packages/auto-layout/src/auto-layout.ts` carefully for exhaustive `LayoutStrategy` / `FinalistKind` handling (e.g. `pending` record map in `auto-layout.ts` where every `FinalistKind` key is initialized!).
- Keep `solveSkeletonSaDraft` fast (target <150ms per circuit even at 50–80 instances) so `pnpm test:slow` and large-circuit tests remain fast.
- Do not add any external dependencies or touch `pnpm-lock.yaml`.
