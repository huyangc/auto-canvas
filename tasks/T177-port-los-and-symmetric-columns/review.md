# T177 Review — Round 1

## Visual & Automated Review Summary

Visual inspection of `38m8wdesbh` after Round 1 shows dramatic structural progress:
- Both `M26` and `M21` sit dead-center on the symmetry axis.
- The 3 `VDD` ports sit locally atop `M24`, `M26`, `M25` and the 3 `VSS` ports sit locally below `M18`, `M21`, `M19`.
- The column hierarchy is now right-side-out (`M24–M17` outer, `M6–M7` middle, `M2–M0` inner core).
- The 4 previous `VB6`/`VB7`-on-`M14`/`M15`/`M12`/`M13` overlaps are completely gone.

However, both visual inspection of `38m8wdesbh` and the test suite revealed three concrete `must-fix` issues that we must resolve before shipping:

## Findings

### 1. [must-fix] Scope the port line-of-sight guard so R72 and R164 single-port tests do not regress

**Why**: Five `R72` tests in `blocker-repair.test.ts` (5–6 instances, `cellPinOffset = 40`) deliberately trap a single-port R71 stub inside a fixed resistor enclosure to exercise R72 blocker repair, and one `R164` test in `block-direction.test.ts` (`<= 40` instances) pins an exact edit hash on a single-port chain. On `<= 40` instances, a 40-unit single-port stub cannot jump completely over a MOS transistor, whereas decoupled multi-port nets (at any circuit size) and long `> 40`-unit stubs (`document.instances.length > 40`, where `cellPinOffset = 80`) can.

**Fix (in `packages/auto-layout/src/place-markers.ts`)**:
- Apply the line-of-sight obstruction guard (`symbolBlocksJoin`) in `placeCellPins` and `portSeatCandidates` whenever:
  - the port belongs to a decoupled multi-port net (`entry.decoupled` / `localHosts.has(portId)`), **OR**
  - `distance > 40` (i.e. any long stub such as `cellPinOffset = 80` on `> 40`-instance documents, which still protects the `M6`/`M14` single-port regression test in `port-los-and-symmetric-columns.test.ts`!).
- Do NOT apply the guard to standard `<= 40`-unit single-port non-decoupled R71 stubs so all 5 `R72` tests in `blocker-repair.test.ts` and the `R164` test in `block-direction.test.ts` pass unchanged.

### 2. [must-fix] Use the inward/outward tie-breaker inside `optimizeRows` sweeps (fixes `foldedCascode` test)

**Why**: In `packages/auto-layout/src/layered.ts:1039`, `optimizeRows` only accepts a sweep when `count < bestCount` (strict `<`). On the complementary folded-cascode OTA fixture (`port-los-and-symmetric-columns.test.ts:160`), the upward sweep from `M21` finds the clean axis-inward order `[C1, M1]` (putting `M1` directly over `M21` and `C1` directly under `F1` and over `S1`), which ties the prior sweep's crossing+span score (`4 === 4`) and is discarded. As a result, both `order(false)` and `order(true)` converge to the worse `[M1, C1]` order with 11 crossings.

**Fix (in `packages/auto-layout/src/layered.ts`)**:
- Add an optional `tieScore?: (rows: RowNode[][]) => number` (higher is better) to `RowOrderOptions` in `optimizeRows`.
- In `optimizeRows`, track `bestTie = tieScore ? tieScore(best) : 0`. Update `best` whenever `count < bestCount || (tieScore !== undefined && count === bestCount && tieScore(ordered) > bestTie)`.
- Similarly, in the adjacent transposition loop (`layered.ts:1029-1036`), accept a swap when `next < score || (tieScore !== undefined && next === score && tieScore(ordered) > currentTie)`.
- Pass `tieScore: preference` from `foldSymmetry` when `multiColumn` is true (using the existing `inwardWeight` preference — axis-adjacent nodes inward, output-connected nodes outward).

### 3. [must-fix] Reserve horizontal aisle width between symmetric half columns for facing decoupled local bias ports (eliminates remaining crossings & `V_CMFB`/`V_B4` overlap on `38m8wdesbh`)

**Why**: Visual inspection of `38m8wdesbh` showed two remaining visual defects caused by the hardcoded `40`-unit horizontal column gap in `assignColumns` (`layered.ts:1346` & `1398`):
- `M14` (`-280`), `M6` (`-210`), and `M2` (`-130`) are only 70–80 units center-to-center (`40` units between bounds). That gap is too narrow for `VB2` (`M14.G`), `VB3` (`M15.G`), `VB6` (`M6.G`), and `VB7` (`M7.G`) to seat locally between columns, kicking all 8 bias ports to the far outer edges and wrapping 8 long crossing wires back across `M14`/`M15`/`M12`/`M13` (pushing `38m8wdesbh` to 17 crossings).
- Between `M16` (`V_B4` facing right) and `M21` (`V_CMFB` facing left), `M7`'s vertical drain wire passes right between `V_B4` and `V_CMFB` in a narrow gap, causing `V_CMFB` and `V_B4` labels to overlap.

**Fix (in `packages/auto-layout/src/layered.ts`, `assignColumns`)**:
- Compute a helper `columnGap(a: RowNode, b: RowNode): number` used at both constraint sites (`layered.ts:1346` and `1398`, defaulting to `40`):
  - Identify non-rail nets in `document` that carry a decoupled multi-port cluster (using `decoupledSignalPortClusters` or checking `>= 2` named `port`/`port-filled` markers on the net, plus private single-device bias ports on a MOS/BJT gate when inside a multi-column symmetric half).
  - For a constraint `{ a, b }` (where `a` is immediately left of `b` in the same row):
    - Check if any device in `a.members` has a right-facing gate pin (`pinExit.x > 0` under `targets.get(id)`) whose net is a decoupled multi-port net.
    - Check if any device in `b.members` has a left-facing gate pin (`pinExit.x < 0` under `targets.get(id)`) whose net is a decoupled multi-port net (or a private single-device gate port on an axis device).
    - If neither faces a local port into the gap, keep the exact default **`40`**.
    - If one side faces a local port into the gap, use **`80`** (enough for a clean `40`-unit local port stub + label without colliding with the adjacent column).
    - If both sides face local ports into the gap, use **`120`**.
- Note: in `foldSymmetry`, `assignColumns` runs on `halfDocument` (`half` devices only, without `port` instances!), so pass the full `document` (or precompute the set of decoupled/private gate net IDs from the full `document` before calling `assignColumns` on `halfDocument`!) so `assignColumns` knows which gate nets have local ports!
- Keep `foldSymmetry`'s `minimum` clearance (`layered.ts:562-577`) aware of right-facing decoupled ports on the innermost left-half column (`M2`/`M0` or `M6`/`M7` when facing right toward the axis) only if needed, and keep default `40` everywhere else so single-column / non-multi-port layouts remain 100% unchanged.

## Acceptance Criteria

Re-run all 7 acceptance commands and verify **100% pass (0 failures)**:
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`
7. `pnpm test:slow`
