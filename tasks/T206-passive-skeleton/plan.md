# T206 — Active-skeleton / passive-module decoupling and bounded local 2D slot insertion

- Branch: `task/T206-passive-skeleton`
- Base: `main` at `f45c0797`
- Status: approved
- Plan review: self-checked against `packages/auto-layout/src/stages.ts`, `attachment-seat.ts`, `layered.ts`, `place.ts`, `finished-selection.ts`, `auto-layout.ts`, `types.ts`, and `docs/specs/auto-layout.md`

## Goal

Add a deterministic, active-first placement draft strategy (`"passive-skeleton"`, **R176**) in `packages/auto-layout`, inspired by Netlist2Schematic's `passive_skeleton` decoupling architecture:
1. Extract maximal unambiguous two-port **series/parallel passive modules** (e.g., Miller RC compensation `R_c + C_c`, parallel bypass/load banks `C1 || C2` or `R || C`, resistor/inductor feedback bridges, and shunt rail-attached passive sub-chains) without merging or altering any electrical net.
2. Place the **active transistor skeleton first** (keeping active stages and symmetric pairs tight without passive bridge clutter pushing columns apart), then insert each passive module into a **bounded local 2D slot** (horizontal or vertical series/parallel geometry, respecting pin polarity and `2 * grid` body clearance) around its active host anchor pins.
3. Compete as a strictly guarded deferred finalist (search/optimized mode only, never in quick mode), rejecting any unsafe routing increase, visual-guard regression, readability regression, or crossing increase at equal completeness.

## Context

- `packages/auto-layout/src/stages.ts`:
  - `findStages` (`L132-L155`) currently separates only **single capacitors** as inter-stage `bridges`. Series RC compensation networks (`R_c + C_c`), resistor feedback bridges, parallel passive banks, and multi-passive shunt branches are NOT separated and end up distorting active stage columns.
- `packages/auto-layout/src/attachment-seat.ts`:
  - `nodeAttachments` / `seatNodeAttachments` (`L22-L279`) seats single two-pin devices around a single host, but does not decouple multi-device series/parallel passive modules or inter-stage two-host passive bridges before active column assignment.
- `packages/auto-layout/src/place.ts`:
  - `placeDocument` (`L469-L556`) dispatches specialized drafts (`"convention"`, `"mcts"`) via `planningMemo`, verifies all devices are placed and recognized symmetry (`symmetryCounts`) is preserved, and marks `oriented = new Set(targets.keys())`.
- `packages/auto-layout/src/finished-selection.ts` and `packages/auto-layout/src/auto-layout.ts`:
  - Guarded finalists (`FinalistKind`, `rankedFinalists`, `selectFinishedLayout`) allow new draft strategies to compete only after full finishing and readability/visual-guard checks without displacing annealable incumbents.
  - Note on quick mode: both `options.search?.evaluations === 0` AND `options.search === undefined` (when `options.quality !== "optimized"`) are quick mode! Search mode is active only when `(options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) > 0`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/passive-skeleton.ts` (new)
- `packages/auto-layout/src/types.ts`
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/finished-selection.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/passive-skeleton.test.ts` (new)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- Quick mode (`(options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) === 0`) behavior — must remain byte-identical
- `packages/edit-engine` routing core
- Existing `template`, `layered`, `stages`, `convention`, or `mcts` placement algorithms
- `packages/auto-layout/src/layered.ts` or `packages/auto-layout/src/route.ts`

## Steps

1. **Add `"passive-skeleton"` to `LayoutStrategy` (`packages/auto-layout/src/types.ts`) and `"passiveSkeleton"` to `FinalistKind` (`packages/auto-layout/src/finished-selection.ts`)**:
   - Register `"passiveSkeleton"` in `rankedFinalists`.
   - In `selectFinishedLayout`, when `kind === "passiveSkeleton"`:
     - Reject if `auditRouting(after.document, resolver).unsafeProblems.length > auditRouting(before.document, resolver).unsafeProblems.length`.
     - Measure actual physical completeness (`missingConnections + floatingPins.length`) on both `before.document` and `after.document`; when completeness ties (or regresses), reject if `afterAudit.crossings > beforeAudit.crossings` (or if completeness regresses).
2. **Implement `packages/auto-layout/src/passive-skeleton.ts`**:
   - **Export `findPassiveModules(document, resolver, roles, templates, topology)`**:
     - Identify eligible guest devices: non-marker, two-terminal passive devices (`deviceClass` in `{"resistor", "capacitor", "inductor", "diode"}` via `deviceDescriptor(i.symbolId)`), with exactly 2 distinct visible pins connected to 2 distinct nets, excluding:
       - any member of `templates` (including `extraMemberIds`, `tailInstanceId`, `diodeInstanceId`),
       - any member of `topology.components` (`pairs` or `axis`) or `mirrorSymmetryTopology(document, resolver, roles).components`,
       - any member of a valid `inductorCouplings` group (`validInductorCouplings(document)`),
       - any fixed/locked device or device with hierarchical pins.
     - Define **boundary nets**: any net that is a rail (`roles.rails.has(net)`), has at least one non-guest terminal (active device, source, port, etc.), or has degree 1.
     - Partition eligible guest devices into connected components across **non-boundary** (internal) nets. Keep only components whose incident boundary nets have cardinality **exactly 2** (`ends: [netA, netB]`, sorted deterministically by `compareIds`).
     - Reduce each 2-port component via iterative **series/parallel reduction** into a layout tree (`{ kind: "part", deviceId, pins: [pinA, pinB], ends: [netA, netB] } | { kind: "series", ends, children } | { kind: "parallel", ends, children }`):
       - Merge parallel branches sharing the exact same unordered `{end0, end1}` pair (sorted canonically).
       - Merge degree-2 internal joints (not in `ends`) into series chains, flipping child direction so ends chain cleanly (`start -> joint -> finish`).
       - Skip non-series-parallel bridges (e.g., Wheatstone bridges) cleanly without error.
     - Classify each reduced module:
       - `role: "two-port-bridge"` if neither `netA` nor `netB` is a rail and both have at least one core (non-guest) anchor terminal.
       - `role: "rail-attachment"` if exactly one of `netA`, `netB` is a rail (`supply` or `ground`) and the other has at least one core anchor terminal.
       - Skip modules with zero core anchors (`unanchored`) or rail-to-rail shunts with no active anchor (leave them in the core).
     - Return `{ modules, guestIds, coreDevices }`.
   - **Export `passiveSkeletonDraftEligible(document, resolver, options)`**:
     - Return `false` unless:
       - `(options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) > 0` (never in quick mode!)
       - `!options.partition`
       - `!options.fixedInstanceIds?.size`
       - `document.instances.length <= 120`
       - no locked `layoutGroups` or `constraints`
       - `hasTransistor(document)` is true
       - no hierarchical pin roles (`devicePins(i, resolver).some(p => p.role.includes("hierarchical"))`)
     - Compute `findPassiveModules(...)` and return `true` only when `coreDevices.length >= 2` and `modules.length >= 1` AND at least one of:
       - a module has `members.length >= 2` (series/parallel multi-passive network such as Miller RC or parallel bank), OR
       - a `two-port-bridge` module contains a non-capacitor passive (e.g. resistor/inductor/diode bridge), OR
       - `modules.length >= 2` (multiple decoupled passive modules where active-first packing tightens the core).
   - **Export `solvePassiveSkeletonDraft(document, resolver, roles, templates, topology, options?)`**:
     - Recheck cancellation (`signal?.aborted` / `deadline`) cleanly.
     - **Step A — Active-first core placement**:
       - Build a core sub-document containing only `coreDevices` (plus markers excluded, matching `deviceDocument`) while computing `coreRoles = classifyNets(coreDoc, resolver)` (preserving `roles.pitch`, `roles.unsplitSymmetry`, `roles.mirrorSymmetry`, `roles.symmetricHalfOrder`).
       - Place `coreDevices` using both `layered` (`deviceRows` + `orderRows` + `assignColumns`) and `stages` (`placeStages`) on the core sub-document. Filter candidates that pass `geometryProblem`, grid alignment, R164 `rightFacingBlocks`, and exact `symmetryCounts` for `symmetry` (`topology.components` or `mirrorSymmetryTopology`).
       - Pick the lower proxy-energy valid core placement using `createPlacementEstimator(coreDevices, resolver, coreRoles)`. If no valid core seed exists, return `{ problem: "R176: no legal core seed" }`.
     - **Step B — Local 2D module shape synthesis**:
       - For any series/parallel module tree, synthesize compact relative device poses (`Map<string, Placement>`) in both **horizontal** and **vertical** orientations (with `2 * grid` clearance between sibling bodies inside a series chain or parallel bank, snapped to integer `grid`, respecting polar diode orientation and `supply`-top / `ground`-bottom rail pin exit direction for `rail-attachment` modules, and trying both `[netA -> netB]` and `[netB -> netA]` entry directions for bridges).
     - **Step C — Bounded deterministic 2D local slot insertion**:
       - Order modules deterministically: `two-port-bridge` before `rail-attachment`, then larger `members.length` first, then `compareIds(module.id)`.
       - For each module:
         - Resolve anchor pin coordinates on the already-placed core devices for its boundary signal nets (preferring conducting pins `D`/`S`/`C`/`E` over gate/base pins, then nearest pair between `netA` and `netB` for two-port bridges).
         - Generate a bounded deterministic set of local 2D anchor positions around the midpoint (for `two-port-bridge`: centered between the two anchors and stepping perpendicularly/horizontally in `grid` / `2 * grid` increments up to `±2 * colPitch` / `±1.5 * rowPitch`; for `rail-attachment`: stepping outward along the host pin exit and toward the rail side up to `±1.5 * colPitch`).
         - Filter candidates that satisfy integer grid alignment, zero coincident pin contacts, `2 * grid` body clearance against all already-placed devices (falling back to `grid` clearance only if no `2 * grid` slot exists, never overlapping `geometryProblem`), and R164 orientation.
         - Score legal candidates by local proxy energy: `500 * crossings + length` (using `createPlacementEstimator` on the full partial placement when feasible, or Manhattan anchor distance + span + crossing count against placed edges) and pick the best deterministic slot.
         - If any module cannot be legally seated, return `{ problem: "R176: unseated passive module" }`.
     - Verify full-document `geometryProblem`, grid alignment, R164, and exact `symmetryCounts` on the combined placement map, and return `{ placements, moduleCount, guestCount }`.
3. **Wire `"passive-skeleton"` into `packages/auto-layout/src/place.ts` and `packages/auto-layout/src/auto-layout.ts`**:
   - In `place.ts`: add `else if (strategy === "passive-skeleton")` calling `planningMemo(..., () => solvePassiveSkeletonDraft(...))`, checking completeness and symmetry counts (mirroring `"mcts"`), and marking `oriented = new Set(targets.keys())`.
   - In `auto-layout.ts`:
     - Only invoke when `passiveSkeletonDraftEligible(document, resolver, options)` and `!stopped()`.
     - Recheck `stopped()` after solving and before routing so expired deadlines never launch extra routing.
     - Route `"passive-skeleton"` once via `route("passive-skeleton", emptyOverrides())`, discard if non-finite score, duplicate edits, or identical placements.
     - Up to 40 instances (`options.finalists` active): defer to `passiveSkeletonFinalist` registered in `options.finalists`, competing through `selectFinishedLayout`.
     - Above 40 instances (`!options.finalists`): finish and run `finishLabels` on both `base` and `candidate` before comparing physical completeness, `unsafeProblems`, `routedGuards`, and `selectFinishedLayout(..., "passiveSkeleton")` so annotated large drawings never regress visual guards.
4. **Update `docs/specs/auto-layout.md`**:
   - Document **R176 — Active-skeleton / passive-module decoupling draft** right after **R160** (before R161, keeping diffs clean and disjoint from other rule additions).
5. **Write comprehensive tests in `packages/auto-layout/test/passive-skeleton.test.ts`**:
   - Module extraction tests:
     - Series RC Miller compensation (`R_c` + `C_c` between stage 1 drain and stage 2 output) reduces to a single `series` `two-port-bridge` module.
     - Parallel capacitor/resistor bank (`C1 || C2` to GND) reduces to a `parallel` `rail-attachment` module.
     - Non-series-parallel bridge (Wheatstone bridge) and symmetric paired passives are skipped cleanly without errors.
   - Eligibility & quick-mode tests:
     - Quick mode (`options.search === undefined` and `options.search = { seed: 1, evaluations: 0 }`) returns `false` and produces byte-identical edits to baseline.
     - Partitioned / fixed / locked / hierarchical / no-transistor drawings return `false`.
   - Solver & end-to-end integrity tests:
     - Two-stage op-amp with series Miller RC compensation (`R_c + C_c`) and parallel load bank (`R_L || C_L`) solves deterministically, places all devices with zero `geometryProblem`, preserves recognized differential symmetry (`symmetryCounts` exact), and routes through `planAutoLayout` with intact `terminalPartition`, `0` missing connections, `0` floating pins, and `0` `unsafeProblems`.
     - Determinism check: repeated calls produce byte-identical serialized edits.

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

## Notes

- Keep `passive-skeleton.ts` strictly deterministic (canonical `compareIds` sorting, no `Math.random()`, no wall-clock branching).
- Follow `CODING_STANDARDS.md` and `docs/testing/README.md`.
- Do NOT modify `packages/auto-layout/src/layered.ts`, `route.ts`, or `packages/edit-engine`.
