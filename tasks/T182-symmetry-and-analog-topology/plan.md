# T182 — Symmetry & Analog Topology Upgrade: unsplit symmetry competition, netlistMirrorPairs fallback finalist, and p-channel top current-source tail

- Branch: `optimize_circuit_placement`
- Base: `8599b99` (after T181)
- Status: approved
- Plan review: approved directly (plans skip Codex plan review)

## Goal

Eliminate the highest-impact analog symmetry and differential-topology defects
remaining after T181 across both the 628-case drawing corpus and the 515-case
netlist corpus:

1. **Compete whole-component (unsplit) symmetry against R145 `stageComponents`
   split via `FinalistPass`**: on concentric two-stage symmetric amplifiers
   (`vcgtzej894`, `6qg2h7weje`, `px5yta2b98`, `sbfkkj67cm`, `x5jaqe94t7`,
   `wj76fmt2de`), R88 finds one unified single-axis symmetry component, but
   `place.ts:344-350` unconditionally splits it via `stageComponents` into two
   side-by-side axes — causing 4/4 `netlistSymmetry` violations and 3–6
   crossings (vs human 1). Competing an `"unsplitSymmetry"` finalist via
   `selectFinishedLayout` retains every beneficial R145 split while fixing
   over-split symmetric amplifiers.
2. **Add a `"mirrorSymmetry"` finalist seeded from T087 `netlistMirrorPairs`**:
   on 22 netlist cases (including 13 of the 17 remaining symmetry-violating
   netlist cases such as `5etmybq44s`, `59gjj8gczh`, `5nrdf75rpd`,
   `4qk6efgw4z`, `m9xz6y5jy4`, `m9knq7tpsz`, `bv9zwmd835`), R88's
   `symmetryTopology` returns `[]` because it seeds only from direct
   shared-source differential or cross-coupled pairs, while
   `netlistMirrorPairs` (`readability-netlist-symmetry.ts`) already detects the
   exact `>= 2`-pair graph involution. Offering that topology as a guarded
   `"mirrorSymmetry"` finalist recovers mirrored analog layouts without taking
   away R168 convention wins where convention is cleaner.
3. **Support p-channel differential pairs with a high-side current-source tail
   in `current-source-tail.ts` and `tail-branch-seats.ts`**: remove the p-pair
   early bailout (`current-source-tail.ts:311`) and parameterize vertical
   direction (`tailDir = isP ? -1 : 1`) so p-channel differential pairs get a
   centered high-side tail above the pair, source degeneration elements between
   pair and tail, loads below the pair, and exterior input ports (while keeping
   n-channel behavior 100% identical).

## Context

Verified in the codebase at `8599b99`:

- `packages/auto-layout/src/place.ts:270, 336-350`: computes `topology =
  symmetryTopology(document, resolver, roles)` and unconditionally runs
  `topology.components = stageComponents(document, resolver, roles,
  topology.components)` when `!partition`. Four of the top-7 worst remaining
  drawing cases in `tmp/t181/drawing/report.json` (`px5yta2b98`, `6qg2h7weje`,
  `sbfkkj67cm`, `vcgtzej894`, all `sym=4/4` and `cross=1->5/6`) and two netlist
  cases (`x5jaqe94t7`, `wj76fmt2de`) suffer directly from this unconditional
  split.
- `packages/auto-layout/src/symmetry.ts:89-107`: R88 `symmetryTopology` seeds
  exclusively from `recognizeSubstructures` (`differential-pair` /
  `cross-coupled-pair`). On 22 of 514 completed netlist cases (and 13 of 17
  symmetry-violating netlist cases), R88 returns `[]` while
  `netlistMirrorPairs(readabilityNetlist(document, resolver))`
  (`packages/auto-layout/src/readability-netlist-symmetry.ts:34-194`) finds an
  exact deterministic involution with `>= 2` pairs.
- `packages/auto-layout/src/readability-netlist.ts:11-60`: `readabilityNetlist`
  uses `deriveElectricalTopologyProjection` and symbol pins only; `netlistMirrorPairs`
  never reads `centres` or placements, so it is 100% placement-independent and
  deterministic on both unplaced netlists and placed drawings.
- `packages/auto-layout/src/current-source-tail.ts:308-311`: explicitly skips
  p-channel drivers (`if (driver && polarity(driver) === "p") return prior;`),
  leaving 4 netlist cases (e.g. `8szwjcnvxz`) without centered top-tail routing
  and exterior input seating.
- `packages/auto-layout/src/tail-branch-seats.ts:14-391`: builds exterior input
  and feedback-bank seats for `current-source-tail.ts`.
- `packages/auto-layout/src/auto-layout.ts:201-210, 1400-1415, 1760-1835,
  2395-2440`, `packages/auto-layout/src/finished-selection.ts:19-26, 135-152`,
  `packages/auto-layout/src/net-roles.ts:70-85`,
  `packages/auto-layout/src/search-moves.ts:105-115`,
  `packages/auto-layout/src/contact-search.ts:120-135`: clean plumbing for
  per-finalist layout flags (`symmetricHalfOrder` pattern).
- Baseline reports on `8599b99` (T181):
  - `tmp/t181/netlist/report.json`: 514/515 completed, crossings 273, bends
    1,851, wire 455,268, broken stacks 214/761, jogs 256, `netlistSymmetry`
    violations 44/285.
  - `tmp/t181/drawing/report.json`: 612/628 completed, crossings 297, bends
    1,927, wire 510,928, broken stacks 225/890, jogs 291, `netlistSymmetry`
    violations 80/314.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/symmetry.ts`
- `packages/auto-layout/src/net-roles.ts`
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/finished-selection.ts`
- `packages/auto-layout/src/search-moves.ts`
- `packages/auto-layout/src/contact-search.ts`
- `packages/auto-layout/src/current-source-tail.ts`
- `packages/auto-layout/src/tail-branch-seats.ts`
- `packages/auto-layout/test/stage-symmetry.test.ts`
- `packages/auto-layout/test/symmetry.test.ts`
- `packages/auto-layout/test/current-source-tail.test.ts`
- `docs/specs/auto-layout.md` (update R88/R145/R170 sections as applicable)
- `tmp/t182/` (untracked acceptance output)

Out of scope (do not change):

- `packages/derived`, `packages/edit-engine`, `packages/spice`, `apps/*`.
- `packages/auto-layout/src/convention-*.ts` (T181).
- `packages/auto-layout/src/readability-selection-weights.ts`,
  `packages/auto-layout/src/readability-netlist-symmetry.ts`,
  `packages/auto-layout/src/readability-netlist.ts`.
- `tasks/T182-symmetry-and-analog-topology/plan.md` and `review.md`.

## Steps

1. **Add `mirrorSymmetryTopology` helper in `packages/auto-layout/src/symmetry.ts`.**
   - Import `channelPins` from `./net-roles.js`, `directedPins` from
     `./directed-blocks.js`, `readabilityNetlist` from `./readability-netlist.js`,
     and `netlistMirrorPairs` from `./readability-netlist-symmetry.js`.
   - Export `mirrorSymmetryTopology(document, resolver, roles)`:
     - Calls `netlistMirrorPairs(readabilityNetlist(document, resolver))` (note:
       completely independent of placements and input order).
     - Filters to involutions where:
       - `pairs.length >= 2`,
       - at least one pair is a transistor pair (`channelPins(a.symbolId) && channelPins(b.symbolId)`),
       - no device in `pairs.flat()` or `axisDevices` has a hierarchical-port
         pin (`p.role.includes("hierarchical")`) or is a directed block
         (`directedPins(i, resolver).outputs.length > 0`).
     - Maps logical nets in `netPairs` back to Base Nets in `roles` (for each
       device pin `(id, pinName)` and its mapped partner `(mate, matePin)`,
       populate `netMap: Map<string, string>` using `roles.pinNet` so folding /
       template placement has the exact Base Net involution it expects; rail
       nets map to themselves).
     - Orients each component's `pairs` deterministically into consistent
       `[left, right]` halves using the exact same non-self `netMap` propagation
       as R88 (`symmetry.ts:282-314`), starting from the lowest-id transistor
       pair (sorted by `compareIds`) and breaking disconnected ties with lower
       id on the left.
     - Returns `{ components: SymmetryComponent[], netMap: Map<string, string> }`
       sorted by `compareIds(a.pairs[0]![0], b.pairs[0]![0])`, with
       `conflicted: []`.
   - Leave `symmetryTopology` and `detectSymmetry` completely unchanged so R88's
     unit tests and R168 eligibility stay intact.

2. **Plumb `unsplitSymmetry` and `mirrorSymmetry` flags cleanly through
   `net-roles.ts`, `place.ts`, `search-moves.ts`, `contact-search.ts`, and
   `auto-layout.ts`.**
   - In `packages/auto-layout/src/net-roles.ts`:
     - Add optional `unsplitSymmetry?: boolean` and `mirrorSymmetry?: boolean`
       to `NetRoles` right beside `symmetricHalfOrder?: boolean`.
   - Create a small shared helper (e.g. `resolvedSymmetry(document, resolver, roles, partition)`
     in `symmetry.ts` or inline helper) used consistently by `place.ts`,
     `search-moves.ts`, `contact-search.ts`, and `auto-layout.ts:1404`:
     - If `roles.mirrorSymmetry && !partition`: use
       `mirrorSymmetryTopology(document, resolver, roles)` (unsplit — do NOT
       split fallback mirror components with `stageComponents`).
     - Else: use `symmetryTopology(document, resolver, roles)`, and apply
       `stageComponents(...)` only when `!partition && !roles.unsplitSymmetry`.
   - In `packages/auto-layout/src/place.ts`:
     - Include `roles.unsplitSymmetry` and `roles.mirrorSymmetry` in the
       `row-drafts` memo key (`place.ts:270`) so cached drafts never collide
       between split, unsplit, and mirror-symmetry runs.
     - Use the resolved topology at `place.ts:336-351`.
   - In `packages/auto-layout/src/search-moves.ts` (`placementUnits` /
     `createMoveGenerator`) and `packages/auto-layout/src/contact-search.ts`
     and `packages/auto-layout/src/auto-layout.ts:1404`:
     - Respect `unsplitSymmetry` and `mirrorSymmetry` when computing rigid
       symmetry units during annealing / contact search / symmetry enforcement
       for those finalists (default `false` preserves all existing callers).

3. **Register `"unsplitSymmetry"` and `"mirrorSymmetry"` in `FinalistPass`
   (`finished-selection.ts`, `auto-layout.ts`).**
   - In `packages/auto-layout/src/finished-selection.ts`:
     - Add `"unsplitSymmetry"` and `"mirrorSymmetry"` to `FinalistKind` and
       `rankedFinalists`:
       `["runner", "convention", "unsplitSymmetry", "mirrorSymmetry", "localLoop", "attachment", "gateRow", "halfOrder"]`.
   - In `packages/auto-layout/src/auto-layout.ts`:
     - Add `unsplitSymmetry?: boolean` and `mirrorSymmetry?: boolean` to
       `LevelOptions`, forward them into `roles` alongside `symmetricHalfOrder`
       (around line 2626), and thread them through `finishFinalist` cleanly
       (e.g. via an options object or boolean parameters so `finishFinalist`
       stays readable).
     - **`unsplitSymmetryFinalist`**: when `options.finalists && !options.finalists.alternate && !options.partition`:
       - Compute `rawSym = symmetryTopology(document, resolver, roles).components`
         and check `stageComponents(document, resolver, roles, rawSym).length > rawSym.length`.
       - When true, plan `unsplitSymmetry` with `{ ...options, unsplitSymmetry: true }`
         trying both `selected.strategy` and `"layered"` (if different) and
         keeping the better `compareRuns` result (with `emptyOverrides()` when
         switching strategy).
       - Admit when `unsplitRun.final` exists, `Number.isFinite(routedScore(unsplitRun, resolver))`,
         `!floatingPins(unsplitRun.final, resolver).length`,
         `!missingConnections(unsplitRun.final, resolver)`, and either
         `shouldFinishRunner(selected.run, unsplitRun, resolver)` OR
         (distinct placement AND `auditRouting(unsplitRun.final, resolver).crossings < auditRouting(selected.run.final!, resolver).crossings`).
     - **`mirrorSymmetryFinalist`**: when `options.finalists && !options.finalists.alternate && !options.partition`:
       - Only when `rawSym.length === 0` AND
         `mirrorSymmetryTopology(document, resolver, roles).components.length > 0`.
       - Plan `mirrorSymmetry` with `{ ...options, mirrorSymmetry: true }` using
         `"layered"` and `"template"` (keeping the better `compareRuns` run).
       - Admit when `mirrorRun.final` exists, `Number.isFinite(routedScore(mirrorRun, resolver))`,
         `!floatingPins(mirrorRun.final, resolver).length`,
         `!missingConnections(mirrorRun.final, resolver)`, and
         `shouldFinishRunner(selected.run, mirrorRun, resolver)`.
     - Register both finalists in `options.finalists.available` and `pending`
       (running `finishFinalist(candidate, false, ...)` on their pass).
     - Keep `selectFinishedLayout` untouched: a finalist wins ONLY when its
       fully finished layout strictly improves `compareRuns` with zero
       readability or visual/routing guard regressions.

4. **Generalize `current-source-tail.ts` and `tail-branch-seats.ts` for
   p-channel differential pairs with a high-side current-source tail.**
   - In `packages/auto-layout/src/current-source-tail.ts`:
     - Remove the early bailout `if (driver && polarity(driver) === "p") return prior;`
       at line 311.
     - Determine `highSide = !!driver && polarity(driver) === "p"` (so
       `tailDir = highSide ? -1 : 1`: for n-channel `tailDir = +1` keeps tail
       below and loads above; for p-channel `tailDir = -1` puts tail above and
       loads below).
     - Update `centeredTail(doc, r, s, t, highSide)`:
       - For `highSide === false`: identical to current checks (`foot.y > a.y`,
         `body.y > foot.y`, tee junction `a.y <= y < foot.y`, vertical stem
         `[y, foot.y]`).
       - For `highSide === true`: symmetric vertical checks (`foot.y < a.y`,
         `body.y < foot.y`, tee junction `foot.y < y <= a.y`, vertical stem
         `[foot.y, y]`).
     - Update `branchSeats(..., highSide)`:
       - Source degeneration elements sit at `y + tailDir * row` (oriented so
         their non-common pin faces the driver source).
       - Loads sit at `y - tailDir * row` (for passive loads, rotate so the
         output-side pin faces the driver drain: `highSide ? (pin.at.y > 0 ? 180 : 0) : (pin.at.y < 0 ? 180 : 0)`).
       - Tail current source sits at `y + tailDir * ((hasSourceElements ? 2 : 1) * row + (reverse ? g : 2 * g))`,
         rotated so `t.entry` faces the driver pair:
         `highSide ? (t.entry.at.y > 0 ? 0 : 180) : (t.entry.at.y < 0 ? 0 : 180)`.
       - Pass `ports(seats, highSide ? 1 : -1, 1)` so output ports sit on the load
         side (below for p-channel, above for n-channel).
     - Update `exteriorTailSeats` in `packages/auto-layout/src/tail-branch-seats.ts`
       to respect `highSide` (keeping `highSide = false` 100% identical to
       existing n-channel seats; for `highSide = true`, mirror vertical offsets
       so tail/loads/ports stay on their correct polarity sides and never invert
       any transistor).

5. **Unit and integration tests (`stage-symmetry.test.ts`, `symmetry.test.ts`,
   `current-source-tail.test.ts`).**
   - In `packages/auto-layout/test/stage-symmetry.test.ts`:
     - Keep all existing R145 split tests passing.
     - Add a regression test for a concentric two-stage symmetric amplifier
       (mirroring the `vcgtzej894`/`x5jaqe94t7` topology where R145 splits a
       4-pair single-axis component into two 2-pair stages): verify
       `planAutoLayout` evaluates the `"unsplitSymmetry"` finalist and delivers
       a single-axis symmetric layout with fewer crossings, zero errors, and
       exact electrical equivalence.
   - In `packages/auto-layout/test/symmetry.test.ts`:
     - Add unit tests for `mirrorSymmetryTopology` verifying:
       - a degenerated differential pair (source resistors breaking direct
         shared-source R88 seeding) returns a 3+ pair symmetric component with
         consistent `[left, right]` halves, axis device, and Base Net `netMap`,
         deterministically regardless of instance/net order;
       - circuits with directed blocks or hierarchical symbols are excluded;
       - public `planAutoLayout` admits `"mirrorSymmetry"` when R88 finds none
         and delivers a clean symmetric layout with exact `terminalPartition`.
   - In `packages/auto-layout/test/current-source-tail.test.ts`:
     - Keep all existing n-channel and high-side p-channel tests passing.
     - Add a regression test for a loaded p-channel differential pair with
       source resistors and a high-side `current-source` tail (both polarities
       of the tail symbol): verify supply above current-source tail above pair
       above loads, centered tee junction on the symmetry axis with stem UP to
       the tail's bottom pin, exterior inputs, 0 crossings, and exact
       `equivalentTerminals`.

6. **Update spec (`docs/specs/auto-layout.md`).**
   - Update **R145** to document that when `stageComponents` splits an R88
     component, an `"unsplitSymmetry"` finalist competes through
     `selectFinishedLayout` so single-axis concentric stages can win when they
     route cleaner.
   - Document **`mirrorSymmetry`** fallback finalist (under R88 / finished
     selection) when R88 finds no component and T087 `netlistMirrorPairs` finds
     a `>= 2`-pair transistor involution without blocks/hierarchy.
   - Update **R170** to document high-side p-channel current-source tail support
     (tail above pair, loads below pair, centered tee stem upward).

7. **Corpus evaluation and strict gate check (netlist + drawing).**
   - Build and run both corpora with `--jobs 6` into `tmp/t182/netlist` and
     `tmp/t182/drawing`.
   - Run the strict gate script comparing against `tmp/t181/` (514/515 netlist,
     612/628 drawing) and report full aggregate deltas (crossings, bends, wire
     length, broken stacks, pin jogs, `netlistSymmetry` violations, and
     non-sealed top movers) in `report.md`.

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
mkdir -p tmp/t182
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input \
  --presentation netlist --out tmp/t182/netlist --jobs 6 > tmp/t182/netlist.log 2>&1   # exit 0
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t182/drawing --jobs 6 > tmp/t182/drawing.log 2>&1   # exit 0
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
check("netlist", "tmp/t181/netlist/report.json", "tmp/t182/netlist/report.json", 515, 514);
check("drawing", "tmp/t181/drawing/report.json", "tmp/t182/drawing/report.json", 628, 612);
'   # exit 0
```

Behavioral expectations:

- Zero lost completions (`>= 514/515` netlist, `>= 612/628` drawing), zero throws,
  zero equivalence/routing-safety/ERC regressions.
- Clear reductions in `netlistSymmetry` violations and crossings on over-split
  symmetric stages (`vcgtzej894`, `6qg2h7weje`, `px5yta2b98`, `sbfkkj67cm`,
  `x5jaqe94t7`), mirror-fallback circuits, and high-side p-channel current-source
  tail stages.

## Notes for the implementer

- Do not print `tmp/t182/netlist.log` or `tmp/t182/drawing.log` directly (they
  contain sealed IDs). Use aggregate checks and redact IDs in
  `tmp/inputs/sample.json` (`sealed`) and `tmp/inputs/forbidden.json`.
- Run the two `scripts/auto-layout-eval.mjs --jobs 6` commands **sequentially**
  (not concurrently with Vitest) so CPU contention never causes test timeouts
  or inflated timings.
- Do not commit, push, or switch branches; do not edit `plan.md` or `review.md`.
- Write `tasks/T182-symmetry-and-analog-topology/report.md` following
  `tasks/_template/report.md`.
