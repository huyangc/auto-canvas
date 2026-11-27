# T191 — LNS Ruin-and-Recreate & Stack-Column Preservation

- Branch: `task/T191-lns-and-stack-columns`
- Base: `main` at `06e46877` (post-PR #165)
- Status: approved
- Plan review: self-checked against the code and 591-case unsealed evaluation (`eval-t189-final`)
- Implementation model: `gpt-6.2-astra` (hard — multi-unit neighborhood ruin-and-recreate placement with topological crossing/legality guarantees and analog stack-column alignment without adding per-case latency)
- Parallelism: 100% disjoint owned paths from `T190` (`task/T190-auto-layout-tail-latency`); `auto-layout.ts`, `transaction.ts`, `place-markers.ts`, `local-reroute.ts`, `packages/model`, and `packages/derived` are out of scope here.

## Goal

Break out of multi-device crossing local minima and reduce broken analog conducting stacks (`stackColumns.broken`) across the full unsealed corpus without increasing per-case wall-clock latency:

1. **Deterministic LNS (Large Neighborhood Search / Ruin-and-Recreate)** around the worst crossing nets (`packages/auto-layout/src/lns-recreate.ts`, invoked inside `aprDetailPlace` so it reuses R173's bounded single-`finish()` pipeline and adds `< 60ms` proxy time and zero extra `finish()` calls).
2. **Stack-Column Preservation & Alignment** both in proxy-space APR refinement (`apr-detail-place.ts`) and in post-finish stack repair (`crossing-polish.ts`: `repairBrokenStacks` & `stackTrials`).
3. **PR #165 R5 APR P2/P3 hardening** inside `apr-detail-place.ts` (rotation-aware `canMirrorVertical`, reserved evaluation budget for row & LNS stages, and moved-rail-seat vs stationary-pin legality).

## Context (Data & Code Facts)

From `eval-t189-final` (576 paired unsealed completions):
- **195 broken stack columns across 130 cases**: e.g. `q9hvr9f7yj` (27i, **10 broken**, 8 crossings), `7wj4a56a3b` (12i, 4 broken), `8prnjcqxqn` (14i, 4 broken), `wj76fmt2de` (16i, 4 broken), `ecw4mse7vb` (13i, 3 broken), `ycg43babwa` (21i, 3 broken, 13 crossings), `3kdhdapd4a` (40i, 2 broken, 18 crossings).
- **High-crossing local minima (`<=40i`)** where single-device moves and equal-size pairwise swaps cannot untangle 3–6 device clusters: `q44rkdkb5b` (34i, `x=19`), `3kdhdapd4a` (40i, `x=18`), `8pvqfhsxqr` (37i, `x=16`), `bsvsx7bmns` (24i, `x=13`), `r462vjaatg` (31i, `x=13`), `ycg43babwa` (21i, `x=13`), `9r4prxnen5` (35i, `x=11`).
- In `packages/auto-layout/src/crossing-polish.ts`:
  - `stackTrials` (lines 390–451) only tries `gaps = along < 0 ? [0] : [1, 2, 3]`, never falls back to `[1, 2, 3]` when `along < 0` and `gap = 0` is obstructed, never tries horizontal mirror on transistors, and never attempts shifting a single movable neighbor 1–2 grid steps sideways to clear the stack column.
  - `crossingTrials` (lines 274–310) only swaps units with identical device counts (`a.count === b.count`).
- In `packages/auto-layout/src/apr-detail-place.ts`:
  - `canMirrorVertical` (lines 407–416) checks `pinExit` at `rotation: 0` instead of the device's actual rotation.
  - `runMacroColumnPass` shares the full `maxProxyEvals` budget with `runWindowedRowPass` (lines 1518–1546), so large column counts can starve row/LNS stages.
  - `movedHasConflict` (lines 847–855) checks moved pins against reserved seats, but not moved rail-host seats against stationary pins.
  - Proxy scoring does not yet account for `stackPairs` alignment (`stackHolds`), nor does APR run a legalized stack-snapping or LNS ruin-and-recreate pass.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/lns-recreate.ts` (new)
- `packages/auto-layout/src/apr-detail-place.ts`
- `packages/auto-layout/src/crossing-polish.ts`
- `packages/auto-layout/src/stack-snap.ts` (only if helper export is needed)
- `packages/auto-layout/test/lns-recreate.test.ts` (new)
- `packages/auto-layout/test/crossing-polish.test.ts` (or existing crossing/stack test file)

Out of scope (do NOT modify — owned by parallel task T190):

- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/transaction.ts`
- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/local-reroute.ts`
- `packages/model/**`
- `packages/derived/**`
- `docs/specs/auto-layout.md` (will be synced when T191 rebases after T190)

## Steps

1. **Create deterministic LNS Ruin-and-Recreate engine (`packages/auto-layout/src/lns-recreate.ts`)**:
   - Export a clean, bounded, deterministic `runLnsRuinRecreate(...)` operating on rigid analog `AprUnit[]` (reusing the exact same unit invariants, `evaluatePoses`, `movedHasConflict`, `rightFacing`, `canMirrorVertical`, and `budgetExhausted` callbacks from `apr-detail-place.ts`).
   - **Ruin selection (hotspot-driven, general, deterministic)**:
     - Trigger only when `currentEval.crossings >= 2` and there are at least 3 movable rigid units.
     - Rank non-rail, non-decoupled MST edges by how many topological crossings they participate in; identify the top 1–2 hotspot crossing neighborhoods (each containing `k = 3..6` movable units touching the highest-crossing edges / their 1-hop connected movable neighbors).
     - Never ruin locked/fixed units, symmetry/template internals, or split already-aligned conducting stacks (rigid units already preserve them).
   - **Recreate (guided constructive placement + orientation search)**:
     - Remove the ruined `k` units' original positions while keeping all non-ruined units fixed as obstacles.
     - Generate a small, deterministic set of candidate anchor slots from: (a) the vacated bounding slots of the ruined units (allowing permutation/reassignment across slots even when unit sizes differ, legalized by grid-snapped clearance checks), plus (b) barycenter-guided grid seats aligned with each unit's connected stationary/already-placed neighbors (pin-exit aligned and `stackPairs`-column aligned!).
     - Place the ruined units greedily in descending degree/size order across 2–3 deterministic ordering seeds (e.g., highest-degree-first, left-to-right signal-flow order, and reverse-crossing order); for each unit, test valid legal seats + valid orientations (channel-preserving horizontal mirror for MOS/BJT, rotation-aware mirror states for multi-pin blocks, skipping `rightFacing` leftward poses), picking the seat with lowest incremental crossing + wirelength + stack-break proxy cost.
     - Verify full legality (`movedHasConflict` + zero overlap + width/height expansion bounded `<= 1.15x + 120` so canvas never balloons) and accept only when `nextEval.crossings < bestEval.crossings` or (`nextEval.crossings === bestEval.crossings && nextEval.score < bestEval.score - 0.15`) without increasing broken stacks.
   - Keep a strict deterministic evaluation cap (e.g., <= 350 proxy evals, `< 50ms`) so LNS never violates sub-150ms APR placement time.

2. **Integrate LNS, Stack-Column Scoring/Snapping, and R5 Hardening in `packages/auto-layout/src/apr-detail-place.ts`**:
   - **Stack-column awareness**:
     - Precompute `stackPairs(devices, resolver, roles)` once in `aprDetailPlace`.
     - Add a soft penalty for broken `stackPairs` in `evaluatePoses` (e.g., `+2.5` per broken stack — weaker than a crossing `+18`, strong enough to prefer aligned stacks on ties and prevent passes from breaking aligned stacks!).
     - Add a fast, legalized **Stack-Column Snap sub-pass** (or integrate into `runWindowedRowPass` / post-row pass): for any broken `stackPair` whose two endpoints belong to different movable rigid units, try snapping the lighter unit's pin onto the anchor pin's column/row at clear grid gaps `[1, 2, 3]` (preserving existing held stacks and `movedHasConflict`), accepting if crossings do not worsen and score improves!
   - **LNS stage integration**:
     - Invoke `runLnsRuinRecreate` from `aprDetailPlace` (Track D: run on the best of `initial` / `combined` when crossings `>= 2` and `!budgetExhausted()`), recording its best improved state via `record("lns", ...)` (or extending candidate phase type cleanly) so `aprDetailPlace`'s top-ranked candidates automatically compete in `auto-layout.ts`'s existing single-`finish()` pipeline!
   - **PR #165 R5 P2/P3 fixes**:
     - Fix `canMirrorVertical` (lines 407–416) to evaluate `pinExit` at the device's actual `rotation` (not hardcoded `0`).
     - Partition `maxProxyEvals` across stages (e.g., reserve budget shares for orient, macro, row, stack-snap, and LNS so an oversized macro-column run cannot starve row or LNS!).
     - In `movedHasConflict` (lines 847–855), also verify that rail-marker seats carried by *moved* rail hosts do not land directly on *stationary* device pins.
     - Keep total `aprDetailPlace` time under `150ms` even on 120-instance stress fixtures by capping legalization attempts alongside proxy evaluations.

3. **Strengthen `repairBrokenStacks` in `packages/auto-layout/src/crossing-polish.ts`**:
   - In `stackTrials` (lines 390–451):
     - When `along < 0`, try `gaps = [0, 1, 2, 3]` (not just `[0]`), so if the direct sideways slide is blocked, a 1–3 grid-step clearance shift along the stack axis still aligns the column.
     - For movable single-device transistors (`unit.length === 1 && mover.transistor`), also consider horizontal mirror (`reflectOrientation(old, "left-right")`, respecting `rightFacing` and `keepsOrder`) when aligning a stack column.
     - When a single non-locked, non-symmetry unit blocks the direct target seat of a broken stack, try a bounded 1-step cooperative nudge (shifting that blocker horizontally out of the column by the minimum clear grid step while preserving all existing held stacks and `proposalFor` overlap checks).
   - Keep `repairBrokenStacks` budget tight (do NOT increase `planningBudget(..., 8)` so per-case latency does not grow!) and preserve all existing guard checks (`crossings <= before`, `bends <= before`, no label/symmetry/stack regressions).

4. **Add comprehensive unit tests**:
   - `packages/auto-layout/test/lns-recreate.test.ts`:
     - Synthetic 4–6 unit tangled cluster (where single-device moves & equal-size pairwise swaps are stuck in a local minimum) untangled by `runLnsRuinRecreate` / `aprDetailPlace` with zero overlaps and strictly fewer crossings.
     - Broken conducting stack snapped back into column alignment without breaking other held stacks or locked units.
     - Rotation-aware `canMirrorVertical` test (90°-rotated block with locally sideways rail pin does not get vertically mirrored to reverse the rail pin).
     - Moved rail-host seat colliding with stationary pin is rejected by APR legality.
     - 120-resistor stress test stays well under budget and completes rapidly.
   - `packages/auto-layout/test/crossing-polish.test.ts` (or new focused test):
     - `repairBrokenStacks` resolves a broken stack whose `gap = 0` slot is occupied (using `gap > 0` or cooperative blocker nudge) without increasing crossings or breaking other stacks.

## Acceptance

Run from the T191 worktree root; all must pass:

```bash
pnpm build
pnpm typecheck
node scripts/lint.mjs
node scripts/format.mjs --check
node scripts/check-markdown-links.mjs
pnpm exec vitest run packages/auto-layout packages/spice apps/editor/src/features/auto-layout
pnpm exec vitest run --mode slow --project slow
```

Benchmark & Visual Acceptance (run by Task Lead after implementation):

- Full 591-case unsealed A/B evaluation vs `06e46877` (`origin/main`):
  - Measurable reduction in `stackColumns.broken` (from 195) and/or `crossings` (from 531) and `composite` (from 396.07).
  - Zero regressions in `completed`, `nonEquivalent`, `floatingPins`, `missingConnections`, `unsafeProblems`, `VISUAL_LABEL_OVERLAP`, `VISUAL_SYMBOL_OVERLAP`.
  - Per-case latency neutral (no case slowed down meaningfully; `aprDetailPlace` stays `< 150ms`).
  - Mandatory visual PNG inspection via `read_file` for top improved AND any regressed cases.

## Notes for the implementer

- Do **not** run a full 591-case evaluation inside the Codex round; rely on targeted unit tests, synthetic benchmarks, and `vitest` / `slow` tests. The Task Lead will run the full 591-case A/B and PNG inspection.
- Stay strictly within the owned paths listed above so T191 merges cleanly alongside parallel task T190.
- Do not commit, switch branches, or edit `plan.md`.
