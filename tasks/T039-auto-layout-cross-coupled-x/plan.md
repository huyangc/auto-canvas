# T039 — Auto-layout: draw cross-coupled pairs with a diagonal X

- Branch: `task/T039-auto-layout-cross-coupled-x`
- Base: `main` at `3526e33`
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. No browser test is
  expected.
- Rules claimed: R144.
- Status: approved

## Goal

The user asked whether diagonal wires help for cross-coupled modules. Every human
drawing among the 33 that contains a cross-coupled pair (4 drawings) draws its two cross
connections as two diagonal lines forming an X between the devices; those are 8 of the 15
diagonal segments in all 33 drawings. Auto-layout routes only orthogonally.

Opus prototyped it on `3526e33` (`tmp/t037/patch-x.py` lineage; geometry below) and
evaluated the 33 drawings:

| Drawing (cross-coupled) | main crossings / bends              | prototype                        | human crossings |
| ----------------------- | ----------------------------------- | -------------------------------- | --------------- |
| val, 34 instances       | 30 / 33                             | 25 / 29, **but 2 floating pins** | 14              |
| dev, 17 instances       | 13 / 16                             | 12 / 21                          | 4               |
| two others              | unchanged (no X drawn or no change) |                                  |                 |

The X reads like the human drawings, but drawing it unconditionally stranded two pins on
one drawing. This task draws it as a finishing alternative that is kept only when the
routed score does not get worse.

The X only reads well when the pair sits side by side at the centre. After T038, R89
seats the user's pre-amplifier's cross-coupled pair at the two ends of its row (the
half layout orders the row by connectivity and only forces axis devices to the axis
end), so the X would span the whole block. Human drawings put the pair innermost, next to
the axis, with the X between them. This task seats it there too.

## Context

Everything below was verified on `3526e33`. Paths are relative to the repository root.

- `packages/auto-layout/src/recognize.ts:76` `recognizeSubstructures` reports
  `cross-coupled-pair` structures (`:145`), each with two members.
- R89 places a recognized pair mirrored: on all four human drawings the left device is
  `mirror: horizontal`, the right `none`, gates facing each other, drains on the outer
  sides, e.g. left `G (640,750)`, `D (610,730)`; right `G (700,750)`, `D (730,730)`.
- `packages/auto-layout/src/route.ts:721` `routeDocument(document, resolver, frozen,
roles, structures, signalTrunks, options = { ripUp }, reservedIds)`; the R13 loop starts
  at `:755`. `freshWirePlan` (R98) derives collision-free wire ids from `reservedIds`.
- The Edit Engine wire planner accepts `routingMode: "octilinear"` with explicit
  `waypoints` (`packages/edit-engine/src/wire-intent-planner.ts:366`–`:393`); a 45° step
  without a routing mode is refused. `planWireBatch(…, { keepClear })` replans around
  obstacles orthogonally, which loses the diagonal: the prototype calls it without
  `keepClear` and rejects a result whose `auditRouting(…).problems` grow.
- Prototype geometry, for a control pin `g` (gate or base) and the opposite output pin
  `d` (drain or collector) on the same Net: `corner = (d.x, g.y + up·|d.x − g.x|)` with
  `up` the vertical direction from `g` toward `d`; draw `g → corner` (45°) then
  `corner → d` (vertical); skip when the corner would fall short of `d`. The two diagonals
  of a pair cross once between the devices, above the gates.
- R89 half layout: `packages/auto-layout/src/layered.ts` `symmetryRows` (`:252`) orders
  each half row with `orderRows`, then sorts nodes holding an axis device to the axis end
  (`:333`–`:338`); a pair `(left, right)` of `component.pairs` is cross-coupled when the
  left device's control pin shares a Net with the right device's output pin and vice
  versa (`roles.pinNet`; gate/drain for MOS, base/collector for BJT). Recognition reports
  such pairs as `matched-pair` groups in `recognizeStructures`.
- Finishing in `packages/auto-layout/src/auto-layout.ts`: `ripUpFinalist` (R96, `:159`),
  `compact` (R97, `:186`), `finish` (`:233`) compacts only the R44 winner before
  `selectRoutingAlternative` (`:248`).
- `quality.test.ts` R44/R63 and `search.test.ts` R66 assert exact finishing call
  sequences on fixtures without cross-coupled pairs; they must stay unchanged.

## Scope

Owned paths: `packages/auto-layout/src/route.ts`, `packages/auto-layout/src/auto-layout.ts`,
`packages/auto-layout/src/layered.ts` (the R89 row order only),
new `packages/auto-layout/test/cross-coupled.test.ts`, `docs/specs/auto-layout.md`.

Out of scope: placement, recognition, symmetry, partitions, the Edit Engine, every other
test file, `apps/`, `scripts/`, dependencies.

## Steps

0. **Innermost seat (R89).** In `symmetryRows`, after `orderRows`, sort each half row so
   that nodes holding an axis device stay at the axis end and nodes holding a member of a
   cross-coupled pair come immediately before them; the order among other nodes is
   unchanged. Add a test that a latch's pair sits adjacent across the axis in all three
   strategies.
1. **Router option.** Add `crossX?: boolean` to `routeDocument`'s options. When set,
   before the R13 loop, for each recognized cross-coupled pair with both devices placed,
   for each direction where one device's control pin and the other's output pin share a
   Net, plan the two-segment wire above (`octilinear`, the corner as the only waypoint,
   ids through the R98 reservation), preview it, and keep it only if the preview succeeds
   and `auditRouting(…).problems` does not grow. The R13 loop then routes the rest of
   every Net as today; R95 never removes these wires.
2. **Finishing (R144).** After R97 in `finish`, if the R44 winner's final Document
   contains a cross-coupled pair, replan its exact placements once with `ripUp` and
   `crossX`, with the winner's signal-trunk setting; keep the candidate when its R22
   routed score is not higher (a tie keeps the X: it is the drawing convention). Skip for
   fixed instances, as R97 does. Ranking, refinement candidates and annealing evaluations
   never draw the X.
3. **Tests** (`cross-coupled.test.ts`, synthetic Documents): a latch gets exactly two
   diagonal segments that cross once between the pair, the result commits with unchanged
   electrical topology, and repeated runs are byte-identical; a pair whose corner falls
   short of the drain gets no X; a candidate whose score is higher is rejected (show it with
   a fixture or a spy on the scoring); documents without a cross-coupled pair have
   unchanged edits and finishing call sequences.
4. **Spec.** Add **R144 — Cross-coupled X** after R143 (or after R142 if R143 is not on
   `main` yet): geometry, router option, acceptance, and that it never runs inside
   candidate evaluations.
5. **Measure** on the 33 human drawings, default quick mode, `3526e33` and the result one
   after the other: per split crossings, bends, wire, floating pins, missing
   connections, readability; the drawings that changed and how. Render human | before |
   after for each changed drawing into `tmp/t039/result/` (git-ignored).

## Acceptance

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'route\.ts|auto-layout\.ts'   # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed
git ls-files tmp | head -1                           # expected: no output
```

**Targets:** floating pins and missing connections never increase on any drawing;
per-split crossings do not increase; drawings without a cross-coupled pair keep their
plan hashes; in every drawing with a cross-coupled pair inside an R88 component, the
pair's two devices are adjacent across the axis.

## Notes for the implementer

- No LLM calls. Human cases stay git-ignored; never commit a case, excerpt, id or
  id-keyed data.
