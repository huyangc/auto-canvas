# T181 — Convention Solver v2: fast flat objective, crossing-aware polish, directed-block support, and FinalistPass competition

- Branch: `optimize_circuit_placement`
- Base: `55bef52` (after T180)
- Status: approved
- Plan review: approved directly (plans skip Codex plan review)

## Goal

Substantially improve layout quality (fewer wire crossings, bends, broken stacks,
and shorter wire length) and solver speed across small-to-medium analog and
mixed-signal schematics by upgrading the R168 convention solver
(`packages/auto-layout/src/convention-*.ts`) and allowing competitive convention
drafts to compete at the finished-layout stage (`FinalistPass`):

1. **Fast zero-allocation objective & candidate filtering**: eliminate per-node
   `Map`, string-key, and `.flatMap`/object allocations in `conventionObjective`
   and `candidates`, speeding up `solveConventionDraft` by an order of magnitude
   while keeping deterministic, instance-order-independent results.
2. **Crossing-aware polish + pairwise swaps**: add a bounded, deterministic
   post-polish pass using R54 `createPlacementEstimator` (`estimate.ts`) when the
   initial convention draft has `est.crossings > 0`, eliminating wire crossings
   that the pure HPWL+convention objective cannot see.
3. **Broader eligibility (directed blocks, ≥4-device non-transistor circuits, up
   to 18 devices)**: allow non-hierarchical directed blocks (e.g. `opamp`,
   `comparator`, `buffer`, logic gates) with strict R164 right-facing and R169
   input-polarity pose constraints, a `blockFlow` convention term, and T180
   non-visible pin exclusion (`!isVisibleEndpoint`); raise `MAX_DEVICES` from 12
   to 18; allow non-transistor non-hierarchical documents with `>= 4` devices
   (fixing high-crossing passive/switch circuits such as `6r2q6deeq9`, while
   keeping trivial `<= 3`-device passive circuits and all hierarchical/symmetric
   circuits out).
4. **Finished-stage `FinalistPass` competition**: add `"convention"` to
   `FinalistKind` / `rankedFinalists` so a competitive convention draft that
   loses provisionally by a narrow margin (e.g. `p8mbn2ej8c`, `wqpaqw7b27`) still
   gets finished and compared via `selectFinishedLayout`, winning only when its
   fully finished layout strictly improves `compareRuns` with zero readability or
   visual/routing guard regressions.

## Context

Verified in the codebase at `55bef52`:

- `packages/auto-layout/src/convention-objective.ts:509-570`: on every evaluated
  node (up to 75,000 per call), `placed(state)` builds a fresh `Map<string,
  PosedPin>` keyed by `` `${q.id}\u0000${q.name}` `` and clones every pin and
  box; `cost(state)` then loops `for (const net of wireNets) for (const p of
  at.pins)` (O(nets × pins)) and calls `at.boxes.find`, `at.pins.filter`, and
  `Math.min(...at.boxes.map(...))`. On 11 open dev cases (`p9a6ba2x8n`,
  `6r2q6deeq9`, `rxdzz3wdry`, `dr4e8zhyjg`, `ecyqst76jd`, `2adejzy693`,
  `p8mbn2ej8c`, `7aevq3rx4z`, `qxwk24thw8`, `wqpaqw7b27`, `465ye6znxc`), 11/11
  hit `limitHit: true` taking 46–447 ms each.
- `packages/auto-layout/src/convention-solver.ts:114-198`: `candidates(state, k)`
  re-allocates placed pin and box arrays with `.flatMap` + spread objects on
  every recursive call and runs `pose.boxes.some(b => boxes.some(q => overlaps({...b, ...}, q)))`
  allocating a new box object per overlap test.
- `packages/auto-layout/src/convention-objective.ts:20-42`: `CONVENTION_WEIGHTS`
  has zero crossing awareness. Adding a bounded R54 `createPlacementEstimator`
  (`packages/auto-layout/src/estimate.ts:70-129`) polish pass when
  `est.crossings > 0` resolves crossing ties without slowing down 0-crossing
  drafts.
- `packages/auto-layout/src/convention-relations.ts:21-22, 179-215`:
  - `MAX_DEVICES = 12` (raising to `18` covers larger non-symmetric analog blocks
    within `MAX_INSTANCES = 40`).
  - `isBlock` currently excludes BOTH `role.includes("output")` AND
    `role.includes("hierarchical")`. Excluding only `role.includes("hierarchical")`
    unlocks opamp+MOS circuits (`ecyqst76jd`, `2adejzy693`, `7aevq3rx4z`) where
    the convention draft immediately cuts estimated crossings from 4–5 down to
    1–2!
  - `!hasTransistor(document)` currently excludes switch/passive networks like
    `6r2q6deeq9` (currently 7 crossings vs convention's 1 estimated crossing!).
    Allowing non-transistor documents with `devices.length >= 4` preserves the
    existing 3-device passive exclusion test in `convention-solver.test.ts:341-357`
    while unlocking multi-device passive/switch networks.
  - Because `devicePins` (`placement-connectivity.ts:10-15`) returns ALL symbol
    definition pins including hidden pins (`opamp.VDD`, `opamp.VSS`), every pin
    collection in `convention-relations.ts` and `convention-objective.ts` MUST
    filter `isVisibleEndpoint(document, resolver, { kind: "terminal", instanceId, pinName })`
    alongside `!isMosBulk(...)` (consistent with T180).
  - For directed blocks, R164 (`directed-blocks.ts`: `rightFacingBlocks`,
    `outputFacesLeft`, `againstFlowCounter`) and R169 (`polarity-order.ts`:
    `keepsOrder`) MUST be enforced as hard pose filters in `devicePoses`.
- `packages/auto-layout/src/auto-layout.ts:1648-1695, 2375-2410` and
  `packages/auto-layout/src/finished-selection.ts:19-21, 135-140`:
  - Currently, if `convention` loses provisional `compareRuns` by even a tiny
    margin (e.g. `p8mbn2ej8c`, `wqpaqw7b27`), it is discarded and never enters
    `FinalistPass`. Adding `"convention"` to `FinalistKind` and `rankedFinalists`
    (gated by `shouldFinishRunner` and `selectFinishedLayout`) lets competitive
    convention drafts compete fairly after compaction, port facing, and local
    rail markers, while preserving provisional portfolio isolation (`anneal` and
    `reroutePortfolio` on the primary winner still never include `"convention"`
    when another strategy wins provisionally).
- Baseline reports on `55bef52` (T180):
  - `tmp/t180/netlist/report.json`: 514/515 completed, crossings 293, bends 2003,
    wire 469,048, broken stacks 221/761, jogs 253, convEligible 225, convSelected 32.
  - `tmp/t180/drawing/report.json`: 612/628 completed, crossings 312, bends 2047,
    wire 524,683, broken stacks 228/890, jogs 299, convEligible 277, convSelected 95.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/convention-objective.ts`
- `packages/auto-layout/src/convention-relations.ts`
- `packages/auto-layout/src/convention-solver.ts`
- `packages/auto-layout/src/finished-selection.ts`
- `packages/auto-layout/src/auto-layout.ts` (only `conventionFinalist` wiring
  alongside `alternateFinalist`/`localFinalist`/`gateRowFinalist`/`halfOrderFinalist`)
- `packages/auto-layout/test/convention-solver.test.ts`
- `packages/auto-layout/test/compact.test.ts` (isolate R97 test from expanded R168 eligibility)
- `packages/auto-layout/test/device-relocation-search.test.ts` (isolate R147 feedback-row test from expanded R168 eligibility)
- `packages/auto-layout/test/local-loop-amplifier.test.ts` (isolate R156 regulator finalist tests from expanded R168 eligibility)
- `packages/auto-layout/test/partition.test.ts` (update approved base hash for the 4-resistor unpartitioned fixture)
- `docs/specs/auto-layout.md` (R168 section only)
- `tmp/t181/` (untracked acceptance output)

Out of scope (do not change):

- `packages/derived`, `packages/edit-engine`, `packages/spice`, `apps/*`.
- `packages/auto-layout/src/symmetry.ts`, `stage-symmetry.ts`,
  `current-source-tail.ts`, `differential-stage-columns.ts` (reserved for T182).
- `packages/auto-layout/src/readability-selection-weights.ts`,
  `search-moves.ts`, `device-relocation-search.ts` (reserved for T183).
- `tasks/T181-convention-solver-v2/plan.md` and `review.md`.

## Steps

1. **Visibility filtering, directed-block constraints, and eligibility expansion
   (`convention-relations.ts`, `convention-objective.ts`).**
   - In `packages/auto-layout/src/convention-relations.ts`:
     - Raise `MAX_DEVICES` from `12` to `18` (keep `MAX_INSTANCES = 40`).
     - Replace `isBlock` with `hasHierarchicalPin(instance, resolver)` checking
       `!isMarker(instance) && !channelPins(instance.symbolId) && devicePins(instance, resolver).some((p) => p.role.includes("hierarchical"))`.
     - Update `conventionDraftEligible`:
       - Still return `false` when `document.instances.length > MAX_INSTANCES`,
         `options.partition`, `new Set(options.fixedInstanceIds).size`, any
         locked layoutGroup/constraint, `devices.length > MAX_DEVICES`,
         `devices.some((i) => hasHierarchicalPin(i, resolver))`, or
         `stageComponents(..., symmetryTopology(...).components).length > 0`.
       - Allow documents with `hasTransistor(document) || devices.length >= 4`
         (so trivial `<= 3`-device non-transistor documents stay out, while
         `>= 4`-device passive/switch/block networks and all transistor
         documents up to 18 devices are eligible).
     - In `conventionRelations`, import `isVisibleEndpoint` from `@icm/derived`
       and skip pins where `!isVisibleEndpoint(document, resolver, { kind: "terminal", instanceId: instance.id, pinName: pin.name })`
       when building `terminals` and `levels` (and when checking two-pin parts
       for `shunts`, filter visible non-bulk pins).
   - In `packages/auto-layout/src/convention-objective.ts`:
     - Add `blockFlow: 2` to `CONVENTION_WEIGHTS`.
     - Pass `document: SchematicDocument` to `conventionUnits` and
       `conventionObjective` (update their call sites in `convention-solver.ts`).
     - Import `isVisibleEndpoint` from `@icm/derived`, `directedPins`,
       `outputFacesLeft`, `rightFacingBlocks` from `./directed-blocks.js`, and
       `keepsOrder` from `./polarity-order.js`.
     - In `devicePoses`:
       - Filter pins to visible non-bulk pins:
         `!isMosBulk(instance.symbolId, p.name) && isVisibleEndpoint(document, resolver, { kind: "terminal", instanceId: instance.id, pinName: p.name })`.
       - For any device in `rightFacingBlocks(devices, resolver, roles)`:
         - Enforce **R164** and **R169** as hard pose constraints: filter
           `orientations` to `keepsOrder(instance, o, resolver)` and
           `!outputFacesLeft(instance, o, resolver)`. If any surviving pose has
           an output pin exiting strictly right (`outputs.some(p => pinExit(p, o).x > 0)`),
           restrict to those poses (leaving upright right-facing poses such as
           `none@0` for `opamp`).
     - In `conventionObjective`:
       - Filter `railPins` and `netDevices` using visible non-bulk pins only
         (same predicate as `devicePoses`).
       - Add `blockFlow` terms for each free right-facing directed block `b`:
         - Determine `b`'s visible non-rail input Nets (`inNets`) and output
           Nets (`outNets`).
         - Find non-feedback input driver terminals `(d.id, pin)` on other
           devices (devices that do NOT touch any `outNets`, matching
           `againstFlowCounter` in `directed-blocks.ts`) and non-feedback
           output load terminals `(d.id, pin)` on other devices (devices that do
           NOT touch any `inNets`).
         - For each such `(b, driver)` pair, add a `blockFlow` term (weight
           `weights.blockFlow / totalFlowPairs` for that block, or split evenly
           across the block's flow pairs so one high-fanout block doesn't swamp
           all other conventions): violated when `driverPin.x >= blockMeanPinX`.
         - For each such `(b, load)` pair, add a `blockFlow` term (same per-block
           normalized weight): violated when `loadPin.x <= blockOutputMeanX`.

2. **Optimize `conventionObjective` & `candidates` with flat pre-indexed arrays
   (`convention-objective.ts`, `convention-solver.ts`).**
   - In `packages/auto-layout/src/convention-objective.ts`:
     - Pre-index every device pin into a fixed dense integer slot `0 .. pinCount - 1`
       and every device box into a fixed dense integer slot `0 .. boxCount - 1`
       (assigned deterministically in `units` order).
     - For each `(unitIndex, poseIndex)`, precompute compact numeric arrays of
       `pinSlot`, `localX`, `localY`, `ex`, `ey` and `boxSlot`, `localX0`,
       `localY0`, `localX1`, `localY1` (so updating a placed unit writes directly
       into pre-allocated `Float64Array` buffers `px`, `py`, `pex`, `pey`,
       `bx0`, `by0`, `bx1`, `by1` and `Uint8Array` `unitPlaced` / `boxPlaced`
       with **zero heap allocations**!).
     - Precompile every `Term` to operate directly on integer pin/box slot
       indices and flat arrays (no string keys, no `Map.get`, no `.find`, no
       `.filter`, no `.map`).
     - Precompile `wireNets` as `Int32Array[]` of pin slots (`netPinSlots`) +
       their `pinUnit` array so HPWL computes `x0/x1/y0/y1` in one tight numeric
       loop over each net's pins (only counting pins whose `unitPlaced[u]` is 1).
     - Compute `shape` bounding box in one tight loop over `boxSlot` where
       `boxPlaced[b] === 1` (no `.map` or spread `...`).
     - Provide both:
       - `cost(state, parts?)` (same signature as before, populating flat buffers
         from `state` with zero allocations — fast enough for external callers
         and tests), AND
       - `beginSearch()` / `placeUnit(k, spot)` / `unplaceUnit(k)` / `currentCost()`
         (or maintain flat buffers incrementally inside `convention-solver.ts`
         during DFS and polish so evaluating a candidate spot only writes the
         1–2 devices of unit `k`!).
     - Preserve exact determinism and monotonicity: partial state cost remains a
       valid lower bound for completions.
   - In `packages/auto-layout/src/convention-solver.ts`:
     - Eliminate `.flatMap` + object cloning inside `candidates(state, k)`:
       read placed boxes and placed same-net pins directly from numeric arrays
       and perform numeric overlap checks without allocating temporary `Box`
       objects.
     - Preserve deterministic candidate sorting (`pose`, `x`, `y`) and
       instance-order independence.
     - Ensure `limited.nodes` still strictly honors `nodeLimit` for search and
       `polishLimit = nodes + Math.max(POLISH_MIN, Math.floor(nodeLimit / 4))`
       for polish.

3. **Add bounded crossing-aware polish & pairwise unit swaps
   (`convention-solver.ts`).**
   - Import `createPlacementEstimator` from `./estimate.js`.
   - After the convention-cost polish loop finishes, build a helper
     `stateToPlacements(state)` (snapped to `grid`, shifted to `ORIGIN` or
     unshifted — estimator is translation-invariant) and evaluate
     `baseEst = estimator(stateToPlacements(current))`.
   - Only when `baseEst.crossings > 0` AND `nodes < polishLimit`:
     - Define `CROSSING_WEIGHT = 1.5` and `EST_LENGTH_WEIGHT = 0.0005`, and
       `crossingObjective(convCost, est) = convCost + CROSSING_WEIGHT * est.crossings + EST_LENGTH_WEIGHT * est.length`.
     - Run at most 2 deterministic passes (staying strictly inside `polishLimit`,
       and bounding crossing-estimator evaluations to at most `1_500` calls per
       solve so runtime stays bounded and predictable):
       1. **Top-K single-unit crossing relocation**: for each unit `k` in
          `order`, score all `candidates(trial, k)` with the fast flat
          `conventionCost` (counting toward `nodes` only up to `polishLimit`),
          keep the top `24` candidates with lowest `conventionCost` (ties broken
          deterministically by `pose, x, y`), and evaluate `crossingObjective`
          with `createPlacementEstimator` on those top `24`. Accept the best
          spot if it strictly lowers `crossingObjective` (by `> 1e-6`) without
          increasing `est.crossings`.
       2. **Pairwise compatible unit swaps**: for each pair `(u, v)` of
          single-device units (`ids.length === 1`) that share the same symbol
          family (both two-pin passives, or same `symbolId`), try swapping their
          reference `(x, y)` (trying each unit's valid poses at the swapped
          position, skipping any overlapping placement). Accept the swap if it
          strictly lowers `crossingObjective` (by `> 1e-6`) without increasing
          `est.crossings`.
     - Update `currentCost = cost(current)` before returning.

4. **Wire `"convention"` into `FinalistPass` (`finished-selection.ts`,
   `auto-layout.ts`).**
   - In `packages/auto-layout/src/finished-selection.ts`:
     - Extend `FinalistKind` to:
       `"runner" | "convention" | "localLoop" | "attachment" | "gateRow" | "halfOrder"`.
     - Update `rankedFinalists` to include `"convention"` immediately after
       `"runner"`.
   - In `packages/auto-layout/src/auto-layout.ts`:
     - Right after `alternateFinalist` (around line 1692):
       - When `options.finalists && !options.finalists.alternate && solved && selected.strategy !== "convention"`:
         - Let `convCandidate = withSolved?.refined.find((c) => c.strategy === "convention") ?? solved`.
         - Admit `conventionFinalist` if `convCandidate.run.final` exists,
           `Number.isFinite(routedScore(convCandidate.run, resolver))`,
           `!floatingPins(convCandidate.run.final, resolver).length`,
           `!missingConnections(convCandidate.run.final, resolver)`, and
           `shouldFinishRunner(selected.run, convCandidate.run, resolver)` —
           snapshotting `copyResult(convCandidate.run.result)` exactly like
           `alternateFinalist`.
     - Register `["convention", conventionFinalist]` in the `options.finalists.available`
       loop and `pending.set(finalistKey, { ..., convention: conventionFinalist ? () => finishFinalist(conventionFinalist, false) : () => copyResult(snapshot) })`
       (around lines 2380–2410).
     - Do NOT change lines 1663–1675 or 1967–1973: when another strategy wins
       provisionally, the primary winner's `annealLayout` and `reroutePortfolio`
       still do not receive `"convention"` runs, preserving existing isolation
       guarantees.

5. **Update and expand unit tests (`packages/auto-layout/test/convention-solver.test.ts`).**
   - Update `"above the device limit"` fixture from `chain(6, true)` (13 devices)
     to `chain(9, true)` (19 devices > `MAX_DEVICES = 18`).
   - Keep `"with a symmetry component"`, `"without a transistor"` (the 3-device
     RC fixture has `devices.length === 3 < 4`, so it stays ineligible!), `"with
     a fixed instance"`, `"with a locked instance"`, `"with a partition"`, `"with
     a hierarchical symbol"`, and `"above 40 instances"` asserting
     `conventionDraftEligible === false`.
   - Update the `"with a directed block"` case:
     - Verify `conventionDraftEligible` is now `true` for a transistor +
       `buffer` or transistor + `opamp` document (and `false` when a
       hierarchical-port symbol is added).
     - Add a test verifying an `opamp` + MOS circuit (including hidden `X1.VDD`)
       solves cleanly with R164 right-facing output, R169 preserved `IN+`/`IN-`
       order, and no hidden pin distorting rail/wire costs.
   - Add a test verifying a 4+ device non-transistor circuit (e.g. switch +
     resistors + capacitor) is eligible and solves cleanly.
   - Add a deterministic crossing-aware polish regression test (a small circuit
     where swapping two units eliminates an estimated crossing while keeping
     convention cost flat/low).
   - Update `"leaves the original portfolio alone when the draft is not selected"`
     (lines 412–440): verify `anneal` and `reroutePortfolio` on the primary run
     still exclude `"convention"`, and if `FinalistPass` selects `"convention"`
     on `mirrorLoad()`, verify the finished layout is strictly better (or update
     the hash assertion / add an explicit test verifying `convention` finalist
     competition via `selectFinishedLayout`).

6. **Update spec (`docs/specs/auto-layout.md`).**
   - Update **R168** to reflect:
     - `MAX_DEVICES = 18` (keeping `MAX_INSTANCES = 40`).
     - Non-hierarchical directed-block eligibility with hard R164 right-facing
       and R169 input-polarity pose constraints, `blockFlow` term (weight 2),
       and non-visible pin exclusion (`!isVisibleEndpoint`).
     - Eligibility for non-transistor non-hierarchical documents with at least 4
       devices (excluding `<= 3`-device passive circuits, symmetric circuits,
       hierarchical symbols, partitions, fixed/locked instances).
     - Bounded deterministic crossing-aware polish (R54 `createPlacementEstimator`)
       and pairwise unit swaps when the draft has estimated crossings.
     - Finished-stage `FinalistPass` competition via `selectFinishedLayout` when
       a provisionally-losing convention draft is competitive (`shouldFinishRunner`).

7. **Corpus evaluation and strict gate check (netlist + drawing).**
   - Build and run both corpora with `--jobs 6` into `tmp/t181/netlist` and
     `tmp/t181/drawing`.
   - Run the strict gate script comparing against `tmp/t180/` (514/515 netlist,
     612/628 drawing) and report full aggregate deltas (crossings, bends, wire
     length, broken stacks, pin jogs, `convEligible`, `convSelected`, runtime,
     and non-sealed top-mover summary) in `report.md`.

## Acceptance

Run from the repository root; all must pass.

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build                         # exit 0
pnpm typecheck                     # exit 0
pnpm lint                          # 0 errors
pnpm format:check                  # exit 0
pnpm docs:check                    # exit 0
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout   # 0 failures
pnpm test:slow                     # 8 passed (2 files)
mkdir -p tmp/t181
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input \
  --presentation netlist --out tmp/t181/netlist --jobs 6 > tmp/t181/netlist.log 2>&1   # exit 0
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t181/drawing --jobs 6 > tmp/t181/drawing.log 2>&1   # exit 0
node -e '
import { readFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("tmp/inputs/sample.json", "utf8"));
const forbidden = new Set(JSON.parse(readFileSync("tmp/inputs/forbidden.json", "utf8")));
const hidden = new Set([...(sample.sealed ?? []).map(x => typeof x === "string" ? x : x.id), ...forbidden]);
const redact = (id) => (hidden.has(id) ? "<sealed>" : id);
function check(name, basePath, nextPath, expectedTotal, expectedBaseCompleted) {
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const next = JSON.parse(readFileSync(nextPath, "utf8"));
  const baseById = new Map(base.cases.map(c => [c.id, c]));
  const nextById = new Map(next.cases.map(c => [c.id, c]));
  if (base.cases.length !== expectedTotal || baseById.size !== expectedTotal)
    throw new Error(`${name}: unexpected base count ${base.cases.length}`);
  if (next.cases.length !== expectedTotal || nextById.size !== expectedTotal)
    throw new Error(`${name}: unexpected next count ${next.cases.length}`);
  for (const id of baseById.keys())
    if (!nextById.has(id)) throw new Error(`${name}: missing ${redact(id)}`);
  let completed = 0, threw = 0, lost = 0, recovered = 0, hashChanged = 0;
  let bCross = 0, nCross = 0, bBends = 0, nBends = 0, bWire = 0, nWire = 0;
  let bStacks = 0, nStacks = 0, bJogs = 0, nJogs = 0;
  let bConvElig = 0, nConvElig = 0, bConvSel = 0, nConvSel = 0;
  const failures = [];
  for (const [id, b] of baseById) {
    const c = nextById.get(id);
    if (c.status === "threw") threw++;
    if (b.status === "completed" && c.status !== "completed") { lost++; failures.push(`lost:${redact(id)}`); }
    if (b.status !== "completed" && c.status === "completed") recovered++;
    if (c.status !== "completed") continue;
    completed++;
    const r = c.result, intro = c.integrity?.introduced;
    const validHash = typeof c.planHash === "string" && /^[0-9a-f]{64}$/.test(c.planHash);
    const validShape = validHash && r && typeof r.crossings === "number" && typeof r.bends === "number" &&
      typeof r.wireLength === "number" && typeof r.missingConnections === "number" &&
      Array.isArray(r.floatingPins) && Array.isArray(r.unsafeProblems) &&
      intro && Array.isArray(intro.danglingWires) &&
      Array.isArray(intro.unconnectedPins) && Array.isArray(intro.touchingNotConnected);
    if (!validShape || c.equivalent !== true || r.missingConnections !== 0 ||
        r.floatingPins.length !== 0 || r.unsafeProblems.length !== 0 ||
        intro.danglingWires.length !== 0 || intro.unconnectedPins.length !== 0 ||
        intro.touchingNotConnected.length !== 0) {
      failures.push(`invalid:${redact(id)}`);
      continue;
    }
    if (b.status === "completed") {
      if (b.planHash !== c.planHash) hashChanged++;
      bCross += b.result.crossings; nCross += r.crossings;
      bBends += b.result.bends; nBends += r.bends;
      bWire += b.result.wireLength; nWire += r.wireLength;
      bStacks += b.result.stackColumns?.broken ?? 0; nStacks += r.stackColumns?.broken ?? 0;
      bJogs += b.result.pinJogs?.jogs ?? 0; nJogs += r.pinJogs?.jogs ?? 0;
      if (b.conventionDraft?.eligible) bConvElig++;
      if (c.conventionDraft?.eligible) nConvElig++;
      if (b.conventionDraft?.selected) bConvSel++;
      if (c.conventionDraft?.selected) nConvSel++;
    }
  }
  console.log(name, {
    completed, expectedBaseCompleted, threw, lost, recovered, hashChanged,
    crossings: `${bCross}->${nCross}`,
    bends: `${bBends}->${nBends}`,
    wire: `${Math.round(bWire)}->${Math.round(nWire)}`,
    brokenStacks: `${bStacks}->${nStacks}`,
    jogs: `${bJogs}->${nJogs}`,
    convEligible: `${bConvElig}->${nConvElig}`,
    convSelected: `${bConvSel}->${nConvSel}`,
    failures: failures.length,
  });
  if (threw || lost || failures.length) {
    console.error("GATE FAILED:", name, failures.slice(0, 15));
    process.exit(1);
  }
}
check("netlist", "tmp/t180/netlist/report.json", "tmp/t181/netlist/report.json", 515, 514);
check("drawing", "tmp/t180/drawing/report.json", "tmp/t181/drawing/report.json", 628, 612);
'   # exit 0
```

Behavioral expectations:

- Zero lost completions (`>= 514/515` netlist, `>= 612/628` drawing), zero throws,
  zero equivalence/routing-safety/ERC regressions.
- Clear aggregate improvement on crossings, bends, wire length, and/or broken
  stacks across both corpora (especially on eligible directed-block,
  non-transistor, and previously-rejected convention finalist cases), with fast
  per-case solve time and deterministic plans.

## Notes for the implementer

- Do not print `tmp/t181/netlist.log` or `tmp/t181/drawing.log` directly (they
  contain sealed IDs). Use aggregate checks and redact IDs in
  `tmp/inputs/sample.json` (`sealed`) and `tmp/inputs/forbidden.json`.
- Notice `pnpm test:slow` checks held-out crossing ceilings (`held-out.slow.test.ts`)
  and above-40 byte-identity (`finished-selection.slow.test.ts`); `convention`
  only applies up to 40 instances so above-40 plans remain byte-identical.
- Do not commit, push, or switch branches; do not edit `plan.md` or `review.md`.
- Write `tasks/T181-convention-solver-v2/report.md` following
  `tasks/_template/report.md`.
