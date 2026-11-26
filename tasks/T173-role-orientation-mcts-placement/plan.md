# T173 — Functional role orientations, DC branch matrix, and discrete MCTS placement candidate

- Branch: `monte_carlo_circuit_placement`
- Base: `monte_carlo_circuit_placement` at `20b2399` (after T172)
- Status: approved
- Plan review: skipped (owner requested no codex plan review unless explicitly specified)

## Goal

Add a deterministic, discrete-space **Monte Carlo Tree Search (MCTS)** placement candidate (`strategy: "mcts"`) built on **functional device role recognition** and **DC vertical branch-column decomposition**, offered as a non-regressing candidate in the R63 portfolio (using the exact same portfolio-replacement gate as R168 `convention`). This directly targets functional readability failures that rigid rules and single-step annealing miss:

1. **Horizontal bridge / pass transistors** (`m6rez5w83z`-class triode MOS source degeneration, `59zd8d2t9q`-class series pass transistor) are no longer forced upright; they receive horizontal poses and inter-column bridge placement.
2. **Centered vertical branch-clamp op-amps** (`vhg3q4gax7`-class op-amp clamping two symmetric DC branches and driving their shared gate Net) receive vertical poses centered between the two branches instead of being forced right-facing on the far left.
3. **Multi-branch DC column matrices & discrete MCTS** (`dr4e8zhyjg`, `qzszatannt`, `sf6e58mmjb`, `vkkn3nhe76`, `5rfesjhe2f`, `59zd8d2t9q`): extract vertical DC branches (PMOS/supply above NMOS/ground), then run bounded deterministic single-player MCTS (UCT with max+mean backup) over `(branch column order, per-branch/per-device mirror & role-allowed orientation, bridge/clamp/inter-branch passive slots)` guided by a fast multi-objective proxy (sweep-line crossings, Prim MST wire length, DC potential order, gate-facing alignment, signal flow, and aspect-ratio compactness penalty).

## Context

- `packages/auto-layout/src/types.ts:7-15` defines `LayoutStrategy` (`"template" | "layered" | "stages" | "feedback-rows" | "convention" | "template+stack" | "layered+stack" | "stages+stack"`).
- `packages/auto-layout/src/place.ts:448-475` dispatches `strategy === "convention"` via `planningMemo`, clones placements, and sets `oriented = new Set(targets.keys())` so R21 preserves every solver-chosen orientation.
- `packages/auto-layout/src/auto-layout.ts:1642-1675` offers R168 (`"convention"`) through a strict non-regressing gate: it ranks within `chosen.portfolio`, replaces the portfolio ONLY when `withSolved.selected.strategy === "convention"` AND `compareRuns(withSolved.selected.run, chosen.selected.run, resolver) < 0`, and lines `1961-1967` exclude `"convention"` from `reroutePortfolio` when not selected.
- `packages/auto-layout/src/estimate.ts:70-129` (`createPlacementEstimator`) already provides a microsecond-level deterministic proxy computing exact Fenwick-tree sweep-line orthogonal `crossings` and Prim MST `length` from `placements`.
- `packages/auto-layout/src/search-moves.ts:46-54` (`randomStream`) provides the repository's seeded Mulberry32 PRNG (R1 determinism: no `Math.random`, no wall-clock cutoffs).
- `packages/auto-layout/src/geometry.ts` provides `pinExit`, `transformPoint`, `geometryProblem`, `withPlacements`, `enclosingBox`, and `placementPitch`.
- `packages/auto-layout/src/net-roles.ts` provides `classifyNets`, `channelPins`, `polarity`, `isMos`, `isMosBulk`.
- `packages/auto-layout/src/polarity-order.ts:90-95` (`keepsOrder` / R169) treats horizontally level `+`/`-` pins (`rotation: 90` or `270`, where `order === 0`) as neutral, so vertical branch-clamp op-amps do not conflict with R169.
- `packages/auto-layout/test/convention-solver.test.ts:412-440` pins an exact plan hash for `mirrorLoad()` and asserts that `convention` does not leak into `annealLayout` or `reroutePortfolio` when not selected. Following the same strict non-regressing gate ensures `mcts` never alters plans where it does not strictly win `compareRuns`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/functional-roles.ts` (new: role detection for horizontal bridge/pass transistors, centered vertical branch-clamp amplifiers, inter-branch bridge passives, and DC vertical branch extraction)
- `packages/auto-layout/src/mcts-placement.ts` (new: deterministic single-player UCT MCTS solver + fast multi-objective proxy + greedy polish + eligibility predicate)
- `packages/auto-layout/src/types.ts` (add `"mcts"` to `LayoutStrategy`)
- `packages/auto-layout/src/place.ts` (wire `strategy === "mcts"` branch with `planningMemo` and `oriented = new Set(targets.keys())`)
- `packages/auto-layout/src/auto-layout.ts` (offer `"mcts"` via the same non-regressing gate after R168 and keep it out of `reroutePortfolio` when unselected)
- `packages/auto-layout/test/mcts-placement.test.ts` (new: synthetic unit + integration tests covering role detection, branch decomposition, MCTS determinism, eligibility, non-regression, and target topologies)
- `docs/specs/auto-layout.md` (add **R171 — Role-oriented MCTS draft (T173)** and mention `"mcts"` in R63)

Out of scope (do not change):

- `packages/auto-layout/src/symmetry.ts`, `convention-solver.ts`, `convention-objective.ts`, `convention-relations.ts`
- `packages/auto-layout/src/readability-weights.ts`, `readability-selection-weights.ts`, `readability-netlist-symmetry.ts`
- `packages/auto-layout/src/search.ts` (`annealLayout`)
- Netlist importer symbol recovery and semantic Net Label decoupling (separate task T174)
- Existing test assertions in `convention-solver.test.ts`, `symmetry.test.ts`, `corpus.test.ts`, `held-out.slow.test.ts`

## Steps

1. **Create `packages/auto-layout/src/functional-roles.ts` for topology-derived functional roles and DC vertical branch extraction.**
   - Pure over `(document, resolver, roles)`, deterministic (all sorting by `compareIds`).
   - **DC vertical branch extraction (`extractDcBranches`)**:
     - Identify vertical conducting devices: upright transistors (excluding horizontal bridge/pass transistors below), current/voltage sources, and two-pin passives on rail-to-channel or series-channel paths.
     - First detect **horizontal bridge / pass transistors** (`bridgeTransistors: Set<string>`):
       - A transistor `t` (`channelPins(t.symbolId)`) whose `drain` Net `d` and `source` Net `s` are both defined, distinct (`d !== s`), and **neither is a rail Net** (`!roles.rails.has(d) && !roles.rails.has(s)`), AND either:
         - (a) **Parallel bridge pair** (`m6rez5w83z`-class): another transistor or two-pin passive also connects `{d, s}` (same unordered non-rail endpoint pair), AND both `d` and `s` connect to at least one other conducting device (e.g., an input transistor or current source); OR
         - (b) **Series pass transistor** (`59zd8d2t9q`-class): neither `d` nor `s` connects to a supply/ground rail through a vertical DC stack of the same polarity, and at least one of `{d, s}` connects to a capacitor/port while `t`'s gate is driven by an internal bootstrap/control node (not tied to `d` or `s`).
     - Detect **branch-clamp amplifiers** (`clampAmplifiers: Map<string, { plusNet: string; minusNet: string; outputNet: string; targetHalf: "upper" | "lower" }>`):
       - A non-transistor directed block with `+`/`IN+` and `-`/`IN-` input pins and an output pin (`role.includes("output")`), where `plusNet` and `minusNet` are distinct non-rail Nets connected to distinct vertical DC branches, and `outputNet` drives the gate(s) of transistors in those branches.
       - `targetHalf` is `"lower"` if `outputNet` primarily drives NMOS/ground-side gates, `"upper"` if it drives PMOS/supply-side gates.
     - Detect **inter-branch bridge passives** (`bridgePassives: Map<string, [string, string]>`):
       - Two-pin passive devices (`resistor`, `capacitor`, `inductor`) whose two endpoints are distinct non-rail Nets belonging to **two different** vertical DC branches (such as `R_S` / `C_S` bridging two differential sources, `C_c` Miller compensation bridging gain and output stages, or `R_S` in `5nrdf75rpd`).
     - Group remaining conducting devices into ordered vertical **DC branches** (`DcBranch[]`):
       - Walk conducting-pin adjacency (MOS `D`/`S`, BJT `C`/`E`, two-pin device pins, excluding rails, `bridgeTransistors`, `clampAmplifiers`, and `bridgePassives`).
       - Order devices top-to-bottom within each branch by DC potential tier: supply-rail-connected / PMOS / upper loads first → intermediate cascode/amplifiers → NMOS / lower loads → ground-rail-connected / tail sources last (ties broken by conducting path distance from supply/ground and `compareIds`).
       - Keep any remaining ungrouped devices as single-device columns so every non-marker device is accounted for.

2. **Create `packages/auto-layout/src/mcts-placement.ts` with eligibility, fast proxy scoring, deterministic single-player MCTS, and 1-step greedy polish.**
   - **Eligibility (`mctsDraftEligible(document, resolver, options)`)**:
     - `document.instances.length <= 40`
     - `2 <= devices.length <= 20` (where `devices` excludes markers)
     - `hasTransistor(document)`
     - `!options.partition`
     - `!options.fixedInstanceIds?.size`
     - no locked `layoutGroups` or `constraints`
     - no device with a `hierarchical` pin role (`p.role.includes("hierarchical")`)
     - At least 2 DC branches OR at least 1 functional role device (`bridgeTransistors.size > 0 || clampAmplifiers.size > 0 || bridgePassives.size > 0`).
   - **Discrete state & geometry builder (`buildPlacements`)**:
     - Uses snapped grid coordinates (multiples of `document.presentation.grid`, column pitch from `placementPitch(roles).column` = `120` or `140` when a horizontal bridge/clamp sits between adjacent columns, row pitch `100` / `80`).
     - **Decision layers** (fixed canonical depth order so the search space is a true tree with zero permutation transpositions):
       1. **Branch column permutation**: sequentially assign each column `0 .. B-1` by choosing from the remaining unassigned branches (with heuristic ordering: input-side branches earlier, output-side branches later, connected branches adjacent). If `B > 6`, fix input/output outer anchors or cap branching width to top-4 heuristic candidates per depth to keep branching compact.
       2. **Per-branch / per-transistor facing (`mirror: "none" | "horizontal"`)**: for each branch (and individually for transistors whose gate connects to a different branch than their branch peers), choose facing (`none` vs `horizontal`) so gates can face their driver column or shared-gate mirror partner without crossing channels.
       3. **Role-specific device poses & slots**:
          - For each `bridgeTransistor`: try horizontal poses (`rotation: 90` and `270`, `mirror: "none" | "horizontal"`) placed horizontally centered between its two endpoint columns at candidate rows (aligned with endpoint pin `y`, or stacked ±`60` units when multiple bridge devices share the same two endpoints like `M3`/`M4` in `m6rez5w83z`), plus standard upright fallback poses.
          - For each `clampAmplifier`: try vertical poses (`rotation: 90` pointing down for `targetHalf === "lower"`, `rotation: 270` pointing up for `targetHalf === "upper"`, both `mirror: "none" | "horizontal"` so `+`/`-` match left/right branch order) centered between the two clamped columns at the midpoint row between the clamped nodes and driven gates.
          - For each `bridgePassive`: try horizontal orientation (`rotation: 90` or `0` depending on symbol pin axis so pins exit left/right) centered between its two endpoint columns at candidate rows aligned with its endpoint pins (stacked vertically when multiple passives like `R_S || C_S` share the same two endpoints), plus vertical fallback.
     - Verify every terminal placement with `geometryProblem` (no overlapping device bodies or coincident pins on different nets); if a minor spacing collision exists on a bridge/clamp column, widen the affected inter-column gap by `+40` / `+80` grid units deterministically before rejecting.
   - **Fast Multi-Objective Proxy Cost (`evaluateProxy`)**:
     - Reuse `createPlacementEstimator(devices, resolver, roles)` from `estimate.ts` once per solve call for `crossings` and `length`.
     - Combine named weighted terms (every constant named and documented):
       - `CROSSING_WEIGHT = 240` × `estimate.crossings`
       - `WIRE_WEIGHT = 1` × `estimate.length`
       - `POTENTIAL_WEIGHT = 300` × vertical potential inversions (PMOS below NMOS in same branch, supply-connected device below ground-connected device)
       - `GATE_FACING_WEIGHT = 90` × transistors whose gate exit faces strictly away from the mean `x` of other non-rail pins on its gate Net
       - `SIGNAL_FLOW_WEIGHT = 250` × explicit input-net pin strictly right of explicit output-net pin
       - `ASPECT_WEIGHT = 180` × `Math.max(0, aspect - 1.8)` where `aspect = Math.max(width / Math.max(height, 60), height / Math.max(width, 60))` over device bounds (directly penalizing elongated strips like `59zd8d2t9q`)
       - `BRIDGE_CENTER_WEIGHT = 120` × bridge/clamp devices not positioned strictly between their two endpoint columns (or not horizontally oriented for bridge devices / vertically oriented for clamp amps).
   - **Deterministic Single-Player MCTS (`solveMctsDraft`)**:
     - Fixed constants: `MCTS_SEED = 1`, `MCTS_ITERATIONS = 320`, `UCT_C = 0.7`, `MAX_BACKUP_BLEND = 0.6`, `ROLLOUT_EPSILON = 0.25`.
     - Uses `randomStream(MCTS_SEED)` exclusively (zero `Math.random`, zero `Date.now()`).
     - Each tree node stores `visits`, `sumReward`, `bestReward`, `untriedActions`, `children`.
     - Normalized reward in `(0, 1]`: `reward = 1 / (1 + cost / baselineCost)` where `baselineCost = Math.max(1, firstValidCost)`.
     - Selection uses single-player max-mean UCT:
       `score = MAX_BACKUP_BLEND * child.bestReward + (1 - MAX_BACKUP_BLEND) * (child.sumReward / child.visits) + UCT_C * Math.sqrt(Math.log(node.visits) / child.visits)`.
     - Rollout completes remaining layers using `ε`-greedy heuristic guidance (`1 - ROLLOUT_EPSILON` picks lowest incremental heuristic action, `ROLLOUT_EPSILON` explores uniformly via `randomStream`).
     - Track the global minimum-cost valid terminal state `(bestCost, bestPlacements)` across all rollouts.
     - Run a bounded deterministic **1-step greedy polish** on the best MCTS state (single-device mirror flip, adjacent column swap, bridge row/orientation tweak) accepting any strictly lower proxy cost while preserving `geometryProblem === undefined`.
     - Return `{ placements, cost, iterations }` (or `{ problem }` if no valid placement was found).

3. **Wire `"mcts"` into `types.ts`, `place.ts`, and `auto-layout.ts`.**
   - `packages/auto-layout/src/types.ts`: add `"mcts"` to `LayoutStrategy`.
   - `packages/auto-layout/src/place.ts`: add `else if (strategy === "mcts")` (parallel to `"convention"` at lines 448–475), memoized under `"mcts-draft"`, checking completeness (`devices.some((i) => !draft.placements!.has(i.id))`), cloning placements, and setting `oriented = new Set(targets.keys())`.
   - `packages/auto-layout/src/auto-layout.ts`:
     - Immediately after the R168 `"convention"` gate (lines 1648–1675), evaluate `"mcts"` when `mctsDraftEligible(document, resolver, options)` (wrapping in `try/catch` and discarding duplicates of already-routed strategies).
     - Replace the selected portfolio ONLY when `withMcts.selected.strategy === "mcts"` AND `compareRuns(withMcts.selected.run, incumbent.selected.run, resolver) < 0` AND the `"mcts"` run introduces no floating pins or missing connections compared to incumbent (`compareCompleteness <= 0`).
     - In `reroutePortfolio` (lines 1961–1967), exclude `run.strategy === "mcts"` whenever the selected portfolio did not switch to `withMcts.portfolio`, preserving the exact same isolation contract as `"convention"`.

4. **Add comprehensive tests in `packages/auto-layout/test/mcts-placement.test.ts`.**
   - **Role detection**:
     - MOS-degenerated differential pair (`m6rez5w83z`-class: `M1/M2` vertical + `M3/M4` parallel triode bridge + `I1/I2` tails) detects `M3` and `M4` as `bridgeTransistors`, and `solveMctsDraft` places `M3`/`M4` horizontally (`rotation === 90 || rotation === 270`) strictly between `M1`/`I2` and `M2`/`I1` columns with zero geometry problems.
     - Series pass-transistor charge pump (`59zd8d2t9q`-class) detects `M_pass` as a `bridgeTransistor` and `solveMctsDraft` produces a compact layout (`aspect < 2.2`, horizontal `M_pass`) rather than an elongated horizontal strip.
     - Op-amp clamped two-branch bias (`vhg3q4gax7`-class: `R1-M2-M4`, `M1-M3`, central `opamp`) detects the op-amp as a `clampAmplifier` (`targetHalf: "lower"`) and `solveMctsDraft` places it vertically (`rotation === 90`) centered horizontally between the two transistor columns.
     - Multi-branch PMOS-top / NMOS-bottom bias circuit (`dr4e8zhyjg`-class) extracts vertical DC branches with PMOS above NMOS in each column and produces zero geometry problems with `solveMctsDraft`.
     - Passive-bridged differential stage (`sf6e58mmjb`-class: `RS || CS` between `M1.S` and `M2.S`) detects `RS`/`CS` as `bridgePassives` and places them horizontally between the two branch columns.
   - **Determinism & invariants**:
     - Running `solveMctsDraft` twice produces byte-identical placements, cost, and iteration count.
     - End-to-end `planAutoLayout` on the synthetic topologies commits cleanly via `executeTransaction`, passes `equivalentTerminals`, has 0 unsafe routing problems, and has 0 floating/missing pins.
     - Eligibility returns `false` when `partition`, `fixedInstanceIds`, locked group, hierarchical block, >40 instances, >20 devices, or no transistors.

5. **Update specification in `docs/specs/auto-layout.md`.**
   - Mention `"mcts"` in R63's strategy list and add **R171 — Role-oriented MCTS draft (T173)** documenting functional roles (`bridgeTransistors`, `clampAmplifiers`, `bridgePassives`), DC branch matrix decomposition, deterministic single-player UCT MCTS bounds/weights, and the non-regressing portfolio gate.

6. **Run all acceptance commands and write `tasks/T173-role-orientation-mcts-placement/report.md`.**

## Acceptance

Run from the repository root; all must pass.

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build                                                                    # expected: exit 0
pnpm typecheck                                                                # expected: exit 0
pnpm lint                                                                     # expected: exit 0 (0 errors)
pnpm format:check                                                             # expected: exit 0
pnpm docs:check                                                               # expected: exit 0
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout     # expected: 0 failures
pnpm test:slow                                                                # expected: 0 failures
```

Behavioral checks:

- All existing 1,240 tests in `packages/auto-layout` and `apps/editor/src/features/auto-layout` plus all 8 `pnpm test:slow` tests pass unchanged (including `convention-solver.test.ts` pinned hashes).
- All new unit and integration tests in `packages/auto-layout/test/mcts-placement.test.ts` pass, proving role detection, horizontal bridge/pass MOS orientation, vertical centered clamp op-amp placement, multi-branch PMOS-above-NMOS matrix layout, compact aspect ratio, and strict determinism.

## Notes for the implementer

- Do not commit, switch branches, or edit `plan.md` or `review.md`.
- Do not install or change dependencies.
- Keep `solveMctsDraft` fast (target < 50 ms median per eligible circuit): reuse `createPlacementEstimator` once per solve call instead of rebuilding topology maps on every rollout.
- Never use `Math.random()` or wall-clock time (`Date.now()` / `performance.now()`) inside `mcts-placement.ts` or `functional-roles.ts`.
- Check symbol pin local coordinates from `resolver.resolve(symbolId, symbolVariantId)` when computing horizontal/vertical orientations (for example, verify whether built-in `resistor`/`capacitor` pins are vertical at `rotation: 0` and become horizontal at `rotation: 90`, and verify which `rotation` (`90` vs `270`) points built-in `opamp`'s output pin downward `+y` vs upward `-y`!). Record the verified built-in pin orientations in `report.md`.
- If `mcts` wins on any existing pinned-hash fixture in `convention-solver.test.ts`, investigate why and check eligibility/gate carefully rather than weakening any existing test.
