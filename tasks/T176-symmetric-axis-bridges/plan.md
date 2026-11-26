# T176: Symmetric Axis Bridge Recognition & Centered Vertical Stacking

- Branch: `monte_carlo_circuit_placement`
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

Recognize two-pin non-polar passive bridge devices that span a mirrored net pair (such as source-degeneration `R_S` and `C_S` bridging `M1.S` and `M2.S` in CTLE `sf6e58mmjb`) as self-symmetric `axis` devices in R88 (`symmetryTopology`), and place them in R89 (`layered.ts`) **horizontally centered on the symmetry axis**, **oriented left-to-right to match their mirrored nets without self-crossing**, and **vertically stacked between the upper and lower branch rows** instead of dumping them as asymmetric leftovers to the far right.

## Why

On `sf6e58mmjb` (and any symmetric differential stage with cross-branch RC/R/C degeneration or bridging):
1. `symmetry.ts` currently only adds a device `a` to `axis` when `own.every(n => netMap.get(n) === n)`. A two-pin non-polar bridge across a mirrored pair `(n1, n2)` with `netMap.get(n1) === n2` fails that check, leaving `axis: []`.
2. Because `R_S` and `C_S` are excluded from the symmetric block, R89 dumps them outside to the far right of `M2`, arranged side-by-side horizontally (`521x324` aspect ratio, awkward narrow protrusion on the right, 1 unnecessary wire crossing, `V_outp` dragged far right, and `C_L` squeezed into the center instead of sitting outside `M1`/`M2`).
3. Recognizing unique non-polar cross-pair bridges as `axis` devices and placing parallel axis bridges horizontally centered and vertically stacked (`R_S` above `C_S`) between `M1.S` and `I1.+` restores the textbook compact symmetric layout (`0` crossings, balanced aspect ratio, clean labels).

## Owned Paths

- `packages/auto-layout/src/symmetry.ts`
- `packages/auto-layout/src/layered.ts`
- `packages/auto-layout/test/symmetry.test.ts`
- `packages/auto-layout/test/symmetric-axis-bridges.test.ts` (new)
- `docs/specs/auto-layout.md`

## Implementation Steps

1. **Recognize cross-mirror 2-pin non-polar bridges as `axis` devices in `packages/auto-layout/src/symmetry.ts`**:
   - In the fixed-point axis check (`symmetry.ts:448-468`), in addition to devices where `own.every(n => netMap.get(n) === n)`, also detect a free two-pin non-polar device `a` (`nonPolar(a.id)`) whose two pins connect to two distinct non-rail nets `[n1, n2]` such that `netMap.get(n1) === n2 && netMap.get(n2) === n1` (an exact mirrored net pair) and no other free compatible device `b !== a` connects to the same unordered net pair `{n1, n2}` (keeping the same uniqueness guard so `R_S` + `C_S` both qualify while two identical parallel bridges remain unambiguous).
   - Add `[a.id, a.id]` to `devicePairs` so `a` joins `component.axis`.

2. **Place horizontal axis bridge devices centered and vertically stacked in `packages/auto-layout/src/layered.ts`**:
   - Inside `foldSymmetry` (`layered.ts:385-618`):
     - Identify `bridgeAxisIds`: devices `id` in `component.axis` that are 2-pin non-polar (`resistor`, `capacitor`, `inductor`, `inductor-compact`, or `devicePins(inst, resolver).length === 2` with non-polar symbol) whose two pins connect to two distinct non-rail nets `n0, n1` with `netMap.get(n0) === n1 && netMap.get(n1) === n0`.
     - Track `leftNets`: the set of non-rail nets touched by left-half paired devices (`component.pairs.map(([left]) => left)`).
     - **Horizontal orientation without self-crossing**: For each bridge `id` in `bridgeAxisIds`, set its pose to horizontal (`rotation: 90, mirror: "none"` or `rotation: 270, mirror: "none"`): pick whichever puts the pin connected to `leftNets` at the smaller transformed `x` (left side) and the pin connected to the mirrored right-half net at the larger transformed `x` (right side).
     - **Parallel grouping & deterministic stacking order**: Group `bridgeAxisIds` by their canonical unordered mirrored net pair `[n0, n1].sort().join("|")`. Within each group, sort bridges deterministically by symbol priority (`resistor` → `capacitor` → `inductor`/`inductor-compact` → other), then `compareIds(a, b)` so `R_S` stacks above `C_S`.
     - **Vertical placement between connected branch rows**:
       - Compute the left-half non-axis neighbors touching `leftNet` (the net in `leftNets` of the bridge pair).
       - Let `neighborYs` be their distinct sorted `y` coordinates in `halfRows.placements`.
       - Use a clean grid-snapped vertical spacing `bridgeStep = Math.max(50, snap(placementPitch(roles).row / 2))` (50 units at standard 100-unit row pitch, giving generous clearance for both horizontal symbols and their labels without overlap).
       - **Case A (neighbors span an upper row and lower row, i.e. `neighborYs.length >= 2`)**:
         - Find the adjacent split `[upperY, lowerY]` across the bridge's neighbors (for a 2-row span like `M1` at `upperY` and `I1` at `lowerY`, `upperY = neighborYs[0]`, `lowerY = neighborYs[1]`).
         - Place bridge `j` (`0 .. k-1`) at `y0 + j * bridgeStep`, where `y0 = snap(upperY + Math.max(50, Math.round(placementPitch(roles).row / 2)))`.
         - Compute required `minLowerY = snap(y0 + (k - 1) * bridgeStep + Math.max(60, Math.round(placementPitch(roles).row * 0.6)))`.
         - If `lowerY < minLowerY`, shift ALL non-bridge devices in `halfRows.placements` (and already-placed bridges below `lowerY`) that have `y >= lowerY` downward by `deltaY = minLowerY - lowerY` (preserving alignment of `I1`/`I2` and everything below!).
       - **Case B (all neighbors share a single row `rowY`, or no non-axis neighbors)**:
         - Place single bridge at `rowY`; for `k >= 2` parallel bridges, stack vertically centered around `rowY` with spacing `bridgeStep` (snapped to grid).
     - **Axis centering & horizontal clearance**:
       - Exclude `bridgeAxisIds` from the same-row horizontal side-by-side `run` loop (`layered.ts:518-561`) so parallel bridges NEVER get spread side-by-side horizontally!
       - Instead, for each bridge `id` in `bridgeAxisIds`, center it directly on the symmetry axis: `placed.get(id).position.x = -pinCentre(id)` before adding `axis`, and compute its left edge relative to `axis` (`bridgeLeft = b.x - placed.get(id).position.x - pinCentre(id)`).
       - Ensure `minimum` (`layered.ts:562-577`) leaves horizontal clearance `>= 40` between every left-half device's right edge and the bridge's left edge (`b.bounds.x + b.bounds.width + Math.max(20, 40 - bridgeLeft)` on overlapping y-bands, or globally across the component when bridges exist so horizontal leads from `M1.S`/`M2.S` into `R_S`/`C_S` have clean unobstructed routing channels!).
     - Ensure `rows.nodes` (`layered.ts:595-616`) keeps non-bridge rows clean and includes bridge axis devices cleanly without breaking downstream `assignColumns` / `resolveCollisions` / `symmetryCounts`.
     - Verify `symmetryCounts`: every bridge in `component.axis` has `Math.abs(centre.x - axis) <= 60` (`onAxis === axisDevices`).

3. **Update existing T172 tests and add new tests**:
   - Update the two T172 assertions in `packages/auto-layout/test/symmetry.test.ts` (lines 1111 and 1216) where a single `bridge` capacitor/resistor spanning `m1.S`–`m2.S` now reports `axis: ["bridge"]` instead of `axis: []`.
   - Create `packages/auto-layout/test/symmetric-axis-bridges.test.ts` testing:
     - CTLE differential pair with parallel `R_S` + `C_S` source degeneration bridges and `C_L` load caps (modeled on `sf6e58mmjb`):
       - `symmetryTopology` reports `R_S` and `C_S` in `axis`.
       - `planAutoLayout` completes with `0` crossings, `missingConnections === 0`, `floatingPins === []`, `equivalentTerminals === true`.
       - Both `R_S` and `C_S` are oriented horizontally (`rotation` 90 or 270) with left pin facing `M1.S` and right pin facing `M2.S`, centered on the symmetry axis between `M1` and `M2` (`M1.x < R_S.x < M2.x` and `M1.x < C_S.x < M2.x`), and stacked vertically (`R_S.y < C_S.y`, `|R_S.x - C_S.x| <= 10`, with `|C_S.y - R_S.y| >= 40`).
       - No overlapping device bounds and no label collisions on `R_S`/`C_S`.
     - Reversed pin order test (`R_S` pin `1` on left half vs pin `2` on left half) -> verifies horizontal orientation picks 90 vs 270 so neither self-crosses!
     - Single-bridge differential drain load test (Case B, neighbors on same row) -> bridge centered horizontally on the axis between drains with 0 crossings.

4. **Update `docs/specs/auto-layout.md`**:
   - Update **R88** to document that unique 2-pin non-polar bridges spanning a mirrored net pair belong to `axis`.
   - Update **R89** to document horizontal left-to-right orientation and centered vertical stacking of parallel axis bridges between their connected branch rows.

## Acceptance Criteria

Run all 7 checks and verify 100% pass (0 errors):
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`
7. `pnpm test:slow`
