# T205 Review — Round 1

- Verdict: `needs-fix`
- Reviewer: coordinator (code review + independent 10-command acceptance + 131-case corpus benchmark on `human-30` and `loadbench-101`)

## Acceptance & Benchmark Summary (Round 1)

- All 10 acceptance commands (`pnpm build`, `pnpm vitest run packages/auto-layout`, `pnpm test:slow`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm agent-docs:generated:check`, `pnpm components:check`, `pnpm deadcode`) passed.
- Empirical before/after benchmark vs `main`:
  - `human-30` (`n=30`, 29 both valid): only 1 win (`dxeky39qvp`: crossings `3 -> 1`, WL `2520 -> 1560`, readability `0.347 -> 0.126`). Zero improvement on target large circuits `4fb59zv76m` (48 inst, 35 devices), `bsvsx7bmns` (21 inst, 16 devices), and `r462vjaatg` (29 inst, 22 devices).
  - `loadbench-101` (`n=101`): 8 wins, total crossings `619 -> 611 (-8)`, bends `1629 -> 1623 (-6)`, WL `435231 -> 430511 (-4720)`, readability `0.8279 -> 0.8115`, **but 1 crossing regression** (`OneStageOpAmps-SimpleOpAmp82`: crossings `7 -> 8`, readability `0.822 -> 0.914`).

## Must-Fix Findings

### 1. Whole-component merging freezes symmetric circuits into single immovable bricks (`packages/auto-layout/src/skeleton-sa.ts:321-322`)
- **Problem**: `const symmetryBlocks = symmetry.map((c) => [...c.pairs.flat(), ...c.axis]); const units = mergeBlocks([...movable, ...symmetryBlocks]);` welds every entire symmetry component into one rigid block. On `4fb59zv76m` (25 of 35 devices in component 0) and `bsvsx7bmns` (15 of 16 devices in component 0), SA cannot reorder, tighten, widen, or flip any internal symmetric pairs — proxy crossings stayed completely unchanged (`13 -> 13` on `4fb59zv76m`, `1 -> 1` on `bsvsx7bmns`).
- **Required fix**:
  - Keep whole symmetry components as coarse blocks for inter-component moves, **and** decompose each symmetry component into symmetry-preserving paired sub-units around its axis `x_axis`:
    - Build paired sub-units `(leftIds, rightIds)` from `c.pairs` (merging any pair members that share a non-symmetry rigid unit such as a cascode stack on the left half together with its mirrored counterparts on the right half; exclude any pair whose non-symmetry unit crosses the axis or breaks mirroring).
    - Add **symmetry-preserving paired SA moves** that keep `symmetryCounts` (`mirrored === pairs`, `level === pairs`, `orientationMirrored === pairs`, `onAxis === axisDevices`) exact on every step:
      1. **Paired symmetric X shift**: translate `leftIds` by `+dx` and `rightIds` by `-dx` (widening or narrowing the pair symmetrically around `x_axis`, snapped to integer grid / column steps or aligned toward a connected pin's X).
      2. **Paired symmetric horizontal swap**: for two paired sub-units `(L1, R1)` and `(L2, R2)` in the same symmetry component (sharing a row, or swapping mirrored sub-columns when non-overlapping), shift `L1` by `dx = left(L2) - left(L1)`, `L2` by `-dx`, `R1` by `-dx`, and `R2` by `+dx` so exact mirror symmetry around `x_axis` is preserved.
      3. **Paired symmetric horizontal mirror**: for a single-device pair `(L, R)` where neither device is a directed block that would face left (or re-righted only if still mirrored), reflect both `L` and `R` left-right simultaneously so `orientationMirrored` stays exact.
  - Add a unit test in `packages/auto-layout/test/skeleton-sa.test.ts` verifying that a multi-pair symmetric circuit (at least 4 symmetric pairs inside one symmetry component) can reorder/reposition its internal pairs to strictly reduce proxy energy while keeping `symmetryCounts` exact (`mirrored === pairs`, `level === pairs`, `orientationMirrored === pairs`, `onAxis === axisDevices`).

### 2. Zero-gap body packing crushes routing channels and crossing weight is too weak (`packages/auto-layout/src/skeleton-sa.ts:154-169, 258-265, 450-456, 546-565`)
- **Problem**: `geometryCheck` only forbids strict bounding-box overlap (`a.x < b.x + b.width`), while `kind === 0` (`±grid`) and the post-SA greedy snap push devices flush against neighbors to minimize `length + 0.25 * span`. On `r462vjaatg`, proxy crossings dropped `8 -> 3`, yet raw routed crossings degraded (`34 -> 35`) because adjacent devices lost the corridor space needed by orthogonal routing. Also, `220 * crossings` is small relative to `length` in raw schematic units (`pitch = 120..160`), letting SA accept an extra crossing to save ~2 columns of wirelength.
- **Required fix**:
  - In `geometryCheck`, preserve routing-channel clearance between device bounding boxes: pad each device's box by `margin = grid` on each side (minimum `2 * grid` gap between distinct device boxes) for every pair `(a, b)` that did **not** already sit closer than `2 * grid` in the initial seed (record any already-close seed pairs so legal seeds remain legal, while SA moves never crush two previously separated devices closer than `2 * grid`).
  - Raise the crossing penalty weight in `evaluateEnergy` (e.g., `500 * crossings` instead of `220 * crossings`) so proxy crossing reduction clearly dominates small Manhattan wirelength trade-offs.
  - Keep horizontal translation steps clean (prefer `2 * grid` / half-pitch / full-pitch steps or pin-alignment snaps rather than squeezing by `1 * grid` into tight corridors), and run a post-SA greedy pass for both regular units and symmetric pairs.
  - For `devices.length > 40`, do not starve the solver relative to smaller circuits (keep `1500` steps, matching `<= 40`, since `geometryCheck` caching keeps 1500 steps well under 50ms).

### 3. Guard `skeletonSa` against crossing regressions in `selectFinishedLayout` (`packages/auto-layout/src/finished-selection.ts:216-221`)
- **Problem**: On `loadbench-101`, `OneStageOpAmps-SimpleOpAmp82` regressed crossings (`7 -> 8`) and readability (`0.822 -> 0.914`) because `selectFinishedLayout` only checked `unsafeProblems` for `kind === "skeletonSa"`.
- **Required fix**:
  - In `packages/auto-layout/src/finished-selection.ts`, when `kind === "skeletonSa"` and `compareCompleteness(candidateRun, baseRun, resolver) === 0`, reject the candidate if `auditRouting(after.document, resolver).crossings > auditRouting(before.document, resolver).crossings`.
  - Also update the R174 wording in `docs/specs/auto-layout.md` to reflect the symmetric paired moves, channel-clearance preservation, and no-crossing-regression finalist guard.

## Verification Required

After fixing all three items, re-run every acceptance command from `tasks/T205-skeleton-proxy-sa/plan.md` and update `tasks/T205-skeleton-proxy-sa/report.md`.

---

# T205 Review — Round 2

- Verdict: `approved`
- Reviewer: coordinator (full diff review + independent 10-command acceptance + 131-case corpus benchmark on `human-30` and `loadbench-101`)

## Verification of Must-Fix Findings

1. **Symmetry-preserving paired moves (`packages/auto-layout/src/skeleton-sa.ts:104-134, 534-597`)**: Verified. Each symmetry component is decomposed into mirrored paired sub-units (`pairedUnits`) preserving rigid groups and stacks, supporting paired symmetric X shift, paired horizontal swap, and paired reflection, plus post-SA pin-alignment polish. Verified by the new 6-pair symmetry test in `packages/auto-layout/test/skeleton-sa.test.ts:121-228`.
2. **Channel clearance & crossing weight (`packages/auto-layout/src/skeleton-sa.ts:136-237, 323, 628-630, 689`)**: Verified. Seed-relative `2 * grid` body clearance prevents zero-gap corridor crushing, crossing weight raised to `500`, and all eligible sizes run 1,500 proposals.
3. **Crossing guard in finished selection (`packages/auto-layout/src/finished-selection.ts:216-225`)**: Verified. Rejects `skeletonSa` finalists that increase `unsafeProblems` or increase routed crossings at equal completeness.

## Independent Acceptance & Benchmark Results (Round 2)

- All 10 acceptance commands passed (`pnpm build`, `pnpm vitest run packages/auto-layout`: 97 files / 1,324 tests, `pnpm test:slow`: 6 files / 18 tests, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm agent-docs:generated:check`, `pnpm components:check`, `pnpm deadcode`).
- Before/after corpus comparison vs `origin/main`:
  - `human-30` (`n=30`, 29 both valid): crossings `252 -> 248 (-4)` (2/0 better/worse), bends `574 -> 571 (-3)`, wireLength `166950 -> 166290 (-660)`, readability mean `1.3211 -> 1.3061`.
  - `loadbench-101` (`n=101`, 101 both valid): crossings `619 -> 614 (-5)`, bends `1629 -> 1627 (-2)`, wireLength `435231 -> 433301 (-1930)`, readability mean `0.8279 -> 0.8152`.
  - `spice-515`: all cases have `<= 10` devices (`skeletonSaDraftEligible === false`, 0 changes).
