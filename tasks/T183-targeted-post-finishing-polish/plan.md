# T183 — Defect-Targeted Post-Finishing Polish: Crossing Untangling, Broken-Stack Repair, and Peer-Unit Pin-Jog Straightening

- Branch: `optimize_circuit_placement`
- Base: `95af59a` (after T182)
- Status: approved
- Plan review: approved directly (plans skip Codex plan review)

## Goal

Attack the three largest remaining visual-quality gaps vs human schematics
across both the 628-case drawing corpus and the 515-case netlist corpus — with
strictly defect-triggered, zero-regression post-finishing passes:

1. **Crossing-targeted finished polish (`polishCrossings`)**: triggered ONLY
   when `auditRouting(final).crossings > 0`. Uses `crossingsByNet` to identify
   the exact devices/units on crossing nets and tries bounded, deterministic
   orientation flips/turns (including horizontal/vertical mirror on custom
   multi-pin blocks like `p9a6ba2x8n`, `qzszatannt`, `rxdzz3wdry`, `dr4e8zhyjg`,
   `yje2n6eva2`, transistor gate flips, and 2-pin reversals) and pairwise unit
   swaps, pre-ranked by R54 `createPlacementEstimator` and accepted only on
   strict crossing reduction (or equal crossings with strict bend + score
   improvement) with zero safety/guard/stack/symmetry regressions.
2. **Finished-stage broken-stack repair (`repairBrokenStacks`)**: triggered ONLY
   when at least one R166 `stackPairs` pair is broken (`!stackHolds`) on the
   finished layout (currently 227/890 broken in drawing vs human 91, and 215/761
   broken in netlist vs human 80). Snaps unlocked units of broken stacks into
   collinear facing alignment (including rotating a 2-pin non-transistor stack
   partner vertical/facing when helpful) with strict zero-regression guards.
3. **Peer-unit pin-jog straightening (`pin-jogs.ts`)**: extends R167
   `straightenPinJogs` (currently 293 drawing / 257 netlist pin jogs vs human
   93 / 84) so that when moving `jog.instanceId`'s rigid unit by `+jog.step` is
   locked, overlaps, or rejected, it also tries moving the opposite-endpoint
   device's rigid unit on `jog.routeId` by `-jog.step`, and increases
   `PASS_TRIALS` from `8` to `12`.

## Context

Verified in the codebase at `95af59a`:

- `packages/auto-layout/src/auto-layout.ts:2431-2465`: the bounded finishing
  chain (`<= 40` instances, `!options.partition`, `search.evaluations > 0`) runs
  `gapClosed = searchDeviceRelocations(...)` followed by
  `closed = straightenPinJogs(gapClosed, resolver, fixed, gapReplan, stopped, gapIncumbent)`
  and `repairStubLabels(...)`. Inserting `polishCrossings` and
  `repairBrokenStacks` right between `gapClosed` and `straightenPinJogs` (using
  the exact same `gapReplan` callback and `gapIncumbent` declined sentinel)
  keeps above-40 plans, partitioned plans, quick plans, and clean 0-defect
  plans (including `pin-jogs.test.ts`'s two byte-identical hashes) 100%
  unchanged.
- `packages/auto-layout/src/routing-audit.ts:224-250`: `crossingsByNet(document,
  resolver)` already computes the exact `Map<string, number>` of crossing Base
  Nets using `properCrossing`.
- `packages/auto-layout/src/pin-jogs.ts:20-29, 306-383, 392-504`:
  `straightenPinJogs` currently uses `PASS_TRIALS = 8` and only tries
  translating `jog.instanceId`'s unit by `+jog.step`. It never tries translating
  the connected peer unit at the opposite end of `jog.routeId` by `-jog.step`.
- `packages/auto-layout/src/stack-snap.ts:61-127`: `stackPairs` and `stackHolds`
  define R166 branch stacks, currently only snapped at draft stage before
  annealing/compaction/relocation/finishing, leaving 227/890 broken stacks in
  drawing and 215/761 in netlist.
- `packages/auto-layout/src/directed-blocks.ts:127-135` (`outputFacesLeft`,
  `rightFacingBlocks`) and `packages/auto-layout/src/polarity-order.ts`
  (`keepsOrder`): enforce R164/R169 pose validity when considering orientation
  flips in `polishCrossings`.
- Baseline reports on `95af59a` (T182):
  - `tmp/t182/netlist/report.json`: 514/515 completed, crossings 271, bends
    1,854, wire 456,508, broken stacks 215/761, pin jogs 257, `netlistSymmetry`
    violations 39/285.
  - `tmp/t182/drawing/report.json`: 612/628 completed, crossings 292, bends
    1,924, wire 510,738, broken stacks 227/890, pin jogs 293, `netlistSymmetry`
    violations 72/314.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/crossing-polish.ts` (new: `polishCrossings` and
  `repairBrokenStacks`)
- `packages/auto-layout/src/pin-jogs.ts`
- `packages/auto-layout/src/timing.ts` (add `crossingPolish` and `stackRepair` phase keys)
- `packages/auto-layout/src/auto-layout.ts` (wire `polishCrossings` and
  `repairBrokenStacks` between `gapClosed` and `straightenPinJogs` near line
  2441, plus symmetry-unit preservation if needed)
- `packages/auto-layout/test/crossing-polish.test.ts` (new)
- `packages/auto-layout/test/pin-jogs.test.ts` (add peer-unit straightening
  regression test)
- `packages/auto-layout/test/stack-snap.test.ts` (isolate R166 draft-selection test from finished-stage `repairBrokenStacks`)
- `docs/specs/auto-layout.md` (document crossing-targeted polish, finished-stage
  stack repair, and R167 peer-unit straightening)
- `tmp/t183/` (untracked acceptance output)

Out of scope (do not change):

- `packages/derived`, `packages/edit-engine`, `packages/spice`, `apps/*`.
- `packages/auto-layout/src/convention-*.ts`, `symmetry.ts`, `current-source-tail.ts`.
- `packages/auto-layout/src/readability-selection-weights.ts`.
- `tasks/T183-targeted-post-finishing-polish/plan.md` and `review.md`.

## Steps

1. **Create `packages/auto-layout/src/crossing-polish.ts` with `polishCrossings`
   and `repairBrokenStacks`.**
   - **`polishCrossings(initial, resolver, fixed, replan, stopped, declined)`**:
     - Early exit returning `initial` immediately if `!initial.final`,
       `!Number.isFinite(calibratedScore(initial, resolver))`, `stopped()`, or
       `auditRouting(initial.final, resolver).crossings === 0`.
     - Build `locked` from `fixed` plus locked `layoutGroups`/`constraints`.
     - Budget: `planningBudget(initial.final.instances.length, 10)` replan
       trials across up to 2 greedy passes (stopping early as soon as
       `crossings === 0`, `stopped()`, or a pass makes no improvement).
     - On each pass over `document = current.final!`:
       - Compute `crossingNets = crossingsByNet(document, resolver)` and find
         all non-marker devices with a pin on any net with `crossingNets.get(netId) > 0`.
       - Compute `units = relocationUnits(document, resolver)` and identify
         unlocked units containing at least one crossing device.
       - Compute `rightFacing = rightFacingBlocks(devices, resolver, roles, locked)`
         and `symmetryDevices` (from `symmetryTopology` / `netlistMirrorPairs`
         so single-device orientation flips do not break mirrored pairs).
       - Generate deterministic candidate placement maps (never overlapping any
         non-moving `visibleInstanceBounds`, snapped to `grid`, and anchored to
         `enclosingBox(initial.final, resolver)` top-left when `!locked.size`):
         1. **Single-device orientation flips/turns** for unlocked 1-device
            crossing units not in `symmetryDevices`:
            - Transistor (`channelPins`): horizontal mirror
              (`reflectOrientation(pose, "left-right")`, preserving upright
              channel polarity).
            - Two-pin non-transistor part: `180°` rotation and `90°`/`270°`
              rotations (keeping rail-pin vertical side if one pin is on a rail).
            - Multi-pin non-transistor part: horizontal mirror
              (`reflectOrientation(pose, "left-right")`) and vertical mirror
              (`reflectOrientation(pose, "top-bottom")`), filtering out any pose
              that violates R164 (`rightFacing.has(id) && outputFacesLeft(...)`)
              or R169 (`!keepsOrder(...)`).
            - Preserve the device's bounding-box centre (snapped to `grid`) so
              flipping an asymmetric symbol keeps its slot instead of jumping
              across the canvas!
         2. **Pairwise unit swaps** for pairs `(u, v)` of distinct unlocked
            crossing units where both units have the same device count (`1` or
            same size `<= 4`): swap their unit bounding-box centres (snapped to
            `grid`, translating each unit's members and its exclusive carried
            markers together) and verify zero body overlap against all other
            instances.
       - Pre-rank all valid non-duplicate candidates using R54
         `createPlacementEstimator(devices, resolver, roles)` (ascending
         `est.crossings`, then `est.length`, then deterministic candidate key).
       - Evaluate top candidates with `replan(proposal)` up to remaining budget,
         accepting a candidate ONLY when ALL hold:
         - `candidate.final && candidate !== declined && candidate.final !== document`;
         - `compareCompleteness(candidate, current, resolver) <= 0`;
         - `!splitsRigidUnit(document, candidate.final, units)`;
         - `routedGuards(candidate.final, resolver)` does NOT increase on any
           key AND `diagnoseLabelClearance(candidate.final, resolver)` count of
           `VISUAL_LABEL_OWNER_DISTANCE` does NOT increase;
         - `netlistSymmetry(candidate.final, resolver).violations <= beforeSym`;
         - No already-held R166 stack breaks (`!stacks.some(s => stackHolds(s, was) && !stackHolds(s, now))`);
         - Strictly fewer crossings (`afterAudit.crossings < beforeAudit.crossings`)
           OR (`afterAudit.crossings === beforeAudit.crossings && afterAudit.bends < beforeAudit.bends && compareRuns(candidate, current, resolver, calibratedScore) < 0`).
         - On acceptance, update `current`, `limits`, `beforeSym`, and break to
           recompute `crossingsByNet` on the improved layout!
   - **`repairBrokenStacks(initial, resolver, fixed, replan, stopped, declined)`**:
     - Early exit returning `initial` immediately if `!initial.final`,
       `!Number.isFinite(calibratedScore(initial, resolver))`, `stopped()`, or
       no broken R166 `stackPairs` exist on `initial.final`.
     - Budget: `planningBudget(initial.final.instances.length, 8)` replan trials.
     - In a greedy loop (while `budget > 0 && !stopped()`):
       - Recompute `units = relocationUnits(document, resolver)` and broken
         stacks `broken = stacks.filter((s) => !stackHolds(s, poses))`.
       - For each broken stack `s` (sorted deterministically by `s.net`) and
         both directions (`mover = s.a, anchor = s.b` and `mover = s.b, anchor = s.a`):
         - Look up `moverUnit` and `anchorUnit` in `units`. Skip if same unit or
           `moverUnit` contains a locked instance.
         - Compute the alignment candidate(s) for `moverUnit` (carrying its
           exclusive markers, snapped to `grid`):
           - Determine `anchorPin` point and exit vector (`ax, ay`, `aex, aey`).
           - If `mover` is a single-device 2-pin non-transistor unit
             (`moverUnit.length === 1 && !mover.transistor`), try poses whose
             stack pin exit opposes `anchor`'s exit (`mex === -aex && mey === -aey`)
             — both keeping its current orientation if already opposing and
             rotating `90°`/`180°`/`270°` if needed.
           - Otherwise (transistor or multi-device rigid unit), keep `moverUnit`'s
             current orientation when `mover`'s stack pin exit already opposes
             `anchor`'s exit.
           - Compute the translation `(dx, dy)` that aligns the cross-axis
             coordinate (`dx = anchorPin.x - moverPin.x, dy = 0` for vertical
             stacks; `dy = anchorPin.y - moverPin.y, dx = 0` for horizontal
             stacks) when the pins already face each other on the stack axis;
             if they are on the wrong side of each other along the stack axis,
             compute the smallest non-overlapping grid step along the stack axis
             that places `mover` on the facing side (at a gap of 1–3 grid steps).
           - Check non-overlap of moved bodies against all non-moved
             `visibleInstanceBounds`, deduplicate via `tried` set, anchor box
             top-left when `!locked.size`, and run `replan(proposal)`.
       - Accept ONLY when ALL hold:
         - `candidate.final && candidate !== declined && candidate.final !== document`;
         - `compareCompleteness(candidate, current, resolver) <= 0`;
         - `!splitsRigidUnit(document, candidate.final, units)`;
         - `routedGuards` + `VISUAL_LABEL_OWNER_DISTANCE` do NOT increase;
         - `netlistSymmetry` violations do NOT increase;
         - No already-held R166 stack breaks AND total broken stacks strictly
           decreases (`afterBroken < beforeBroken`);
         - `afterAudit.crossings <= beforeAudit.crossings`;
         - `afterAudit.bends <= beforeAudit.bends`;
         - `afterAudit.wireLength <= beforeAudit.wireLength + 60`;
         - `afterLabels.labelOverlaps <= beforeLabels.labelOverlaps` AND
           `afterLabels.labelClearance <= beforeLabels.labelClearance`.

2. **Extend R167 `straightenPinJogs` with peer-unit translation
   (`packages/auto-layout/src/pin-jogs.ts`).**
   - Raise `PASS_TRIALS` from `8` to `12`.
   - Export or reuse `carriedMarkers` cleanly if helpful, and add a helper
     `jogPeerDevice(document, jog)`:
     - Look up `route = document.routes.find((r) => r.id === jog.routeId)` and
       inspect `routeEndpoints(route)`.
     - If the opposite endpoint of `route` is a non-marker terminal
       `other.instanceId !== jog.instanceId`, return `other.instanceId`.
     - If the opposite endpoint is a junction connected to routes of the same
       `netId`, check if there is a unique non-marker terminal `other.instanceId !== jog.instanceId`
       at the far end of a straight/adjacent route on that junction — if so,
       return `other.instanceId` (deterministic by id).
   - In `straightenPinJogs`'s candidate loop (`pin-jogs.ts:432-442`):
     - For each `jog` in `jogs`:
       1. First try translating `jog.instanceId`'s `unit` by `+jog.step` (exact
          existing priority and key).
       2. If that proposal is skipped (locked, already tried, or overlaps),
          look up `peerId = jogPeerDevice(document, jog)`, find its `peerUnit`
          in `units`, and when `peerUnit && peerUnit !== unit && !peerUnit.some((id) => locked.has(id))`,
          try translating `peerUnit` by `{ x: -jog.step.x, y: -jog.step.y }`
          (using the same `tried` set, `translatedUnit`, `replan`, and strict
          acceptance checks).
   - Keep all existing R167 acceptance checks (`stackHolds`,
     `levelTransistorPairs`, `routedGuards`, `crossings`, `bends`, `corners`,
     `jogs`, `labelOverlaps`, `labelClearance`, `WIRE_ALLOWANCE`,
     `EXTENT_ALLOWANCE`) completely unchanged.

3. **Wire `polishCrossings` and `repairBrokenStacks` into `auto-layout.ts`.**
   - In `packages/auto-layout/src/auto-layout.ts` around lines 2441–2452:
     - Import `polishCrossings` and `repairBrokenStacks` from
       `./crossing-polish.js`.
     - Chain:
       1. `const crossingPolished = timePhase("crossingPolish", () => polishCrossings(gapClosed, resolver, fixed, gapReplan, stopped, gapIncumbent));`
       2. `const stackRepaired = timePhase("stackRepair", () => repairBrokenStacks(crossingPolished, resolver, fixed, gapReplan, stopped, gapIncumbent));`
       3. `const closed = timePhase("pinJogs", () => straightenPinJogs(stackRepaired, resolver, fixed, gapReplan, stopped, gapIncumbent));`
     - Notice: for any document with 0 crossings and 0 broken stacks, both new
       passes return their input immediately without calling `gapReplan`,
       preserving exact byte-identity of clean documents!

4. **Unit and integration tests (`crossing-polish.test.ts`, `pin-jogs.test.ts`).**
   - Create `packages/auto-layout/test/crossing-polish.test.ts`:
     - **Test 1 (crossing untangling via device flip)**: construct a routed
       fixture with two crossing nets caused by a flipped 2-pin part or
       multi-pin non-polarity block; verify `polishCrossings` flips it, reduces
       crossings from `> 0` to `0`, preserves `terminalPartition`, respects
       `fixed` and `stopped`, and is deterministic.
     - **Test 2 (crossing untangling via pairwise unit swap)**: construct a
       routed fixture where two parallel units' wires form an X-crossing; verify
       `polishCrossings` swaps the two units, eliminates the crossing, and
       preserves R164/R169 and held stacks.
     - **Test 3 (R164/R169 protection)**: verify `polishCrossings` never flips a
       right-facing `opamp` to face left or reverse its `IN+`/`IN-` order.
     - **Test 4 (broken-stack repair)**: construct a routed fixture with an NMOS
       and load resistor offset horizontally (`dx = 40`, broken R166 stack, 2
       bends); verify `repairBrokenStacks` snaps the resistor into collinear
       alignment (`stackHolds === true`), reduces broken stacks to `0` and bends
       without increasing crossings/guards, and respects `fixed` / `stopped`.
     - **Test 5 (zero-defect no-op)**: verify both `polishCrossings` and
       `repairBrokenStacks` return the exact input reference without invoking
       `replan` when `crossings === 0` and all stacks hold.
   - In `packages/auto-layout/test/pin-jogs.test.ts`:
     - Add a regression test where the jogging resistor `b` is fixed/blocked
       (cannot move by `+step`), while its peer resistor `a` at the opposite end
       of the jogging wire is free: verify `straightenPinJogs` translates `a` by
       `-step` and reduces `pinJogs` to `0`!
     - Confirm all existing R167 tests (including the two byte-identical hash
       checks) still pass unchanged.

5. **Update spec (`docs/specs/auto-layout.md`).**
   - Document `polishCrossings` and `repairBrokenStacks` in the finishing
     pipeline (right after R149 gap closing and before R167 pin-jog
     straightening) and update R167 to note peer-unit `-step` fallback and
     `PASS_TRIALS = 12`.

6. **Corpus evaluation and strict gate check (netlist + drawing) AND cumulative
   summary vs `c5f1678`.**
   - Build and run both corpora **sequentially** with `--jobs 6` into
     `tmp/t183/netlist` and `tmp/t183/drawing`.
   - Run the strict gate comparing against `tmp/t182/` AND print the cumulative
     `c5f1678` (`tmp/baseline/`) → `T183` (`tmp/t183/`) comparison in
     `report.md`.

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
mkdir -p tmp/t183
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input \
  --presentation netlist --out tmp/t183/netlist --jobs 6 > tmp/t183/netlist.log 2>&1   # exit 0
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t183/drawing --jobs 6 > tmp/t183/drawing.log 2>&1   # exit 0
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
  let bStacks = 0, nStacks = 0, bJogs = 0, nJogs = 0, bSym = 0, nSym = 0;
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
      bJogs += b.result.pinJogs?.count ?? 0; nJogs += r.pinJogs?.count ?? 0;
      bSym += b.result.readabilityMetrics?.netlistSymmetry?.violations ?? 0;
      nSym += r.readabilityMetrics?.netlistSymmetry?.violations ?? 0;
    }
  }
  console.log(name, {
    completed, expectedBaseCompleted, threw, lost, recovered, hashChanged,
    crossings: `${bCross}->${nCross}`,
    bends: `${bBends}->${nBends}`,
    wire: `${Math.round(bWire)}->${Math.round(nWire)}`,
    brokenStacks: `${bStacks}->${nStacks}`,
    jogs: `${bJogs}->${nJogs}`,
    netlistSymmetryViol: `${bSym}->${nSym}`,
    failures: failures.length,
  });
  if (threw || lost || failures.length) {
    console.error("GATE FAILED:", name, failures.slice(0, 15));
    process.exit(1);
  }
}
check("netlist vs T182", "tmp/t182/netlist/report.json", "tmp/t183/netlist/report.json", 515, 514);
check("drawing vs T182", "tmp/t182/drawing/report.json", "tmp/t183/drawing/report.json", 628, 612);
'   # exit 0
```

Behavioral expectations:

- Zero lost completions (`>= 514/515` netlist, `>= 612/628` drawing), zero throws,
  zero equivalence/routing-safety/ERC regressions.
- Clear aggregate reductions in crossings, broken stacks, bends, and pin jogs
  across both corpora with zero regressions on clean 0-defect circuits.

## Notes for the implementer

- Do not print `tmp/t183/netlist.log` or `tmp/t183/drawing.log` directly (they
  contain sealed IDs). Use aggregate checks and redact IDs in
  `tmp/inputs/sample.json` (`sealed`) and `tmp/inputs/forbidden.json`.
- Run the two `scripts/auto-layout-eval.mjs --jobs 6` commands **sequentially**
  (and not concurrently with Vitest).
- Do not commit, push, or switch branches; do not edit `plan.md` or `review.md`.
- Write `tasks/T183-targeted-post-finishing-polish/report.md` following
  `tasks/_template/report.md`.
