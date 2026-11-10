# T034 — Auto-layout: column compaction of the routed finalist

- Branch: `task/T034-auto-layout-compaction`
- Base: `main` at `88eab98` (T031 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. T030 (PR 36, lane 2)
  owns `fingerprint*.ts`, `units.ts`, `partition-*.ts`, `types.ts` and the partition
  scripts; this task touches none of them. No browser test is expected.
- Rules claimed: R97 (column compaction), R98 (fresh generated ids). R99 stays free.
- Status: approved

## Goal

Auto-layout drawings are about three times the area of the human drawings of the same
circuits. Most of the excess is empty columns: a stage spacing or column pitch that the
final wires do not need. After this task the planner removes those empty vertical strips
from the routed finalist and keeps the narrower drawing whenever its routed score is
strictly lower. Rows, symmetry, recognized structures and Cell Pin seats are unchanged.

Opus prototyped this on `88eab98` (`tmp/t034/proto2/`: `compact.ts`, applied by
`patch.py`) and ran `pnpm auto-layout:eval tmp/human-cases --jobs 7` sequentially, base
then prototype, on one tree. Counts only:

| 33 human drawings (dev 18 / val 15)                             | `88eab98`            | prototype       |
| --------------------------------------------------------------- | -------------------- | --------------- |
| Median instance-box area ratio vs human                         | 2.92 / 2.37          | 2.62 / 2.26     |
| Median layout-area ratio vs human                               | 2.68 / 2.35          | 2.32 / 2.19     |
| Median instance width ratio vs human                            | 2.00 / 1.84          | 1.85 / 1.75     |
| Wire length (sum)                                               | 128600 / 148830      | 123280 / 145190 |
| Crossings / bends                                               | 271 / 367, 310 / 397 | unchanged       |
| Floating pins, missing connections, readability, mirrored pairs | —                    | unchanged       |
| Documents compacted                                             | —                    | 9 / 5           |
| Planning time                                                   | 1.00×                | 1.07×           |

The prototype with the same rules applied on both axes reached 2.33 / 1.96, but y
compaction breaks exact row relations the corpus pins down (a tail 120 below its pair, a
feedback capacitor 120 above its amplifier). Rows are out of scope here; this task
compacts columns only.

## Context

Everything below was verified on `88eab98`. Paths are relative to the repository root.

### 1. Where finishing happens

`packages/auto-layout/src/auto-layout.ts`, inside `planAutoLayoutMeasured` (`:118`):

- `repair` (`:135`–`:154`) runs R72 blocker repair through `planLayoutOnce` with exact
  placements; in search mode it is bounded by `repairBounds` (`:306`).
- `ripUpFinalist` (`:156`–`:182`) is R96: one exact replan with `ripUp = true`, kept only
  if `routedScore` strictly drops.
- `finish` (`:183`–`:200`) returns
  `selectRoutingAlternative(ripUpFinalist(repair(run)), repair(alternative), …)`.
  Quick mode calls it at `:268`; search calls it at `:304` (zero budget) and `:307`.
- `planLayoutOnce(document, resolver, options, overrides, strategy, signalTrunks, given,
bounds, exact, ripUp)` (`:316`); with `exact` it uses those placements verbatim and
  only checks `geometryProblem` (`buildPlan`, `exact ? … : placeDocument(…)`).
- `selectRoutingAlternative` and `routedScore` are in `packages/auto-layout/src/refine.ts`
  (`:56`, `:83`). R22's weights make wire length worth `1/10` per unit, a crossing 1000
  and a bend 100, so a narrower drawing with the same crossings and bends scores lower.
- `options.partition` (T031) and `fixed` (`:123`–`:125`, fixed ids and locked groups or
  constraints) are both visible in `planAutoLayoutMeasured`.

### 2. What a compaction must keep (the corpus pins these exactly)

`packages/auto-layout/test/corpus.test.ts`:

- `:401`–`:436`: a Cell Pin with one non-rail host is "local" if it sits exactly 80 along
  its host pin's exit (R71); every other `port`/`port-filled` with rotation 0 must sit at
  `deviceBox.x - 80` or `deviceBox.x + deviceBox.width + 80` (R8), where `deviceBox` is
  the enclosing box of all instances except `port`, `port-filled`, `ground`, `vdd-port`.
  The first prototype failed here five times: it shortened the horizontal wire between
  the device box and the Cell Pin column.
- `:309`–`:320`: a tail's channel pin is at its pair's x midpoint and its origin exactly
  120 below the pair. `:565`: in `two-stage-symbolic`, `C10` is exactly 120 above `X7`.
  Both fail under any y compaction; x compaction keeps them if a structure moves as one.
- `:569`–`:605`: `planAutoLayout(after)` on the committed result returns no diagnostics
  and no `move_instance`, `rotate_instance` or `mirror_instance` edits ("stable repeated
  placement"). Two facts follow:
  - `recognizeStructures` (`recognize.ts:446`) skips devices already in a layout group,
    so on the second run it returns none of the groups the first run recorded. A
    compaction that derives rigid units from `recognizeStructures(document, …)` of the
    input decides differently on the second run (seen in `five-t-ota`: the first run kept
    `M3, M4, M5` rigid, the second run kept nothing, and moved `M5`, `P4`, `GND1`).
    Rigid units must come from the routed finalist itself.
  - **A latent id collision.** `two-inverters`, compacted, committed and planned again,
    fails every strategy with `R10: whole-list replay changed a terminal Base Net
partition`: the replanned ground Routes end up on the supply Net's id. The generated
    junction id `route-net-2e542d5fcbabeef3-to-junction` exists in the committed input on
    the supply Net and is generated again by the relayout for a ground trunk. Renaming
    every Route and Junction id of the input (consistently) makes all three strategies
    and `planAutoLayout` succeed, and forcing exhaustive clearance checks does not, so
    T032's prefilter is not involved. Generated ids come from
    `deriveStableId("route-net", document.id, String(document.revision), part)`
    (`packages/edit-engine/src/route-net-planner.ts:214`), and auto-layout derives
    further ids in `packages/auto-layout/src/route.ts:310` and `:481`. Replanning a
    Document can therefore regenerate an id that the same edit list removes from the
    input, and the regenerated object inherits the removed object's Net. Nothing on
    `main` exposes it today; compaction does, because its exact replan routes at
    revisions the relayout reuses.

### 3. Tests that encode the current finishing sequence

- `packages/auto-layout/test/quality.test.ts:395` (R44, `two-inverters`): exactly one
  `routeDocument` call with `signalTrunks === false`, and the last two calls are that
  alternative and the R96 rip-up (`:407`–`:409`).
- `quality.test.ts:435` (R63, RC circuit): `routeDocument` called `5 + candidates` times,
  the last two being the alternative and the R96 rip-up (`:473`, `:477`–`:479`).
- `packages/auto-layout/test/search.test.ts:61`: the SHA-256 of the quick result of
  `crossed()` (`:71`), and `evaluations: 0` equals quick mode.
- `search.test.ts:77`: `progress.at(-1).best` equals the final score (`:122`).

With the prototype, these four fail for the expected reason (one more replan, a compacted
result, a final score below annealing's best) and nothing else fails except
`two-inverters`' relayout above.

### 4. Evaluation script

`scripts/auto-layout-eval.mjs` already records per case `instanceWidth`/`instanceHeight`
(`metrics`, `:144`–`:163`, the enclosing box of all instances) and `areaRatio` (layout
box against the human drawing, `:457`–`:462`), and per split `meanAreaRatio` (`:648`).
It has no median and no instance-box ratio; Opus computed both in `tmp/t033/table.mjs`.

### 5. Two review nits from T032 to fold in

- `docs/specs/auto-layout.md:731`–`:743` (R87): the sentence "Clearance checks skip parts
  and foreign Routes whose padded bounds miss the path" omits pins, which are skipped too,
  and it now separates "the twenty-grid exchange rate" from "This is an optional
  path-length cost", so "This" reads as the clearance check.
- `packages/edit-engine/src/route-clearance.ts:311`: the test-only `exhaustive` option
  sits in the exported options without an `@internal` mark.

## Scope

Owned paths (may be created, edited or deleted):

- new `packages/auto-layout/src/compact.ts`
- `packages/auto-layout/src/auto-layout.ts` (`finish`, a new compaction step)
- `packages/auto-layout/src/route.ts` and `packages/edit-engine/src/route-net-planner.ts`
  (R98 only)
- `packages/edit-engine/src/route-clearance.ts` (the `@internal` doc tag only)
- new `packages/auto-layout/test/compact.test.ts`
- `packages/auto-layout/test/quality.test.ts` (R44 and R63 sequence assertions only)
- `packages/auto-layout/test/search.test.ts` (the R66 hash literal and the best-score
  assertion only)
- one added test file or test case for R98 in `packages/edit-engine/src/` and/or
  `packages/auto-layout/test/`
- `scripts/auto-layout-eval.mjs` (two medians and one per-case ratio)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- `corpus.test.ts` and every other existing test; they must pass as they are;
- placement (`place.ts`, `layered.ts`, `stages.ts`, `symmetry.ts`, `recognize.ts`),
  refinement and search (`refine.ts`, `search*.ts`), partition code, `types.ts`;
- the transaction and Edit Engine semantics other than the planner's id choice;
- `packages/model`, `packages/derived`, `apps/`, `pnpm-lock.yaml`, dependencies.

## Steps

1. **Investigate R98 first and report.** Reproduce the id collision without compaction
   if you can (a test Document whose existing Route or Junction ids equal ids the planner
   generates for another Net), otherwise with the prototype applied. Report the exact
   mechanism: which edit regenerates the id, at which revision, and why the new object
   takes the old Net. Record every place in the planner's routing path that derives an
   object id (`route-net-planner.ts:214`, `route.ts:310`, `route.ts:481`, and any other).

2. **R98 — fresh generated ids.** Make every Route, Junction and label id that the
   auto-layout planner generates differ from every object id in the planner's input
   Document. Prefer an optional reserved-id set passed into `planRouteNet` (and used by
   the auto-layout id helpers): when a derived id is reserved or already present, derive
   again with a deterministic salt until it is free. Without the option, `planRouteNet`
   returns exactly what it returns today, so editor and Agent routing are unchanged. Add
   a regression test that fails before the fix (a relayout of a Document carrying a
   colliding id) and passes after it. Documents without a collision plan byte-identical
   edits; check that every existing test passes unchanged at this point.

3. **R97 — column compaction, `compact.ts`.** Export one function that takes the routed
   final Document, the resolver and the rigid units, and returns exact placements with
   only `position.x` changed, or `undefined` when nothing can be removed:
   - Occupied x intervals, with `MARGIN = 20` and `WIRE_MARGIN = 10` as named constants:
     - each placed instance's `visibleInstanceBounds` widened by `MARGIN`;
     - each vertical wire segment's x widened by `WIRE_MARGIN`; both ends of each
       horizontal segment widened by `WIRE_MARGIN`; a horizontal segment with an end on a
       Cell Pin's pin is occupied over its whole length (keeps R71 seats);
     - each junction's x widened by `WIRE_MARGIN`;
     - between the device box (instances other than `port`, `port-filled`, `ground`,
       `vdd-port`) and each Cell Pin box entirely outside it, the whole span (keeps R8's
       80-unit seats);
     - each rigid unit's span over its members' bounds, widened by `MARGIN`.
   - Search gaps only between the lowest and highest instance bounds (all instances), so
     the enclosing box's left edge never moves. Floor each gap to the Document grid; drop
     zero-width gaps. Each instance moves left by the summed width of the gaps that end at
     or before its bounds' left edge.
   - Read geometry with existing `@icm/derived` helpers (`visibleInstanceBounds`,
     `resolveRouteGeometry`) and `pinPoints`; no symbol offsets are hard-coded.

4. **R97 — wiring in `auto-layout.ts`.** Add a `compact(run, strategy, signalTrunks)`
   step next to `ripUpFinalist`:
   - skip when `options.partition` is set, when `fixed` is non-empty, or when the run has
     no final Document or an infinite `routedScore`;
   - rigid units come from `run.final` only: each `layoutGroups` record's `objectIds`;
     each group of `recognizeStructures({ ...run.final, layoutGroups: [] }, roles)` with
     its members, `extraMemberIds`, `tailInstanceId` and `diodeInstanceId`; each R88
     component of `symmetryTopology(run.final, …)` (`pairs` and `axis`);
   - replan the compacted placements once with `planLayoutOnce(…, exact, true)` and the
     run's `signalTrunks`; return the candidate only if its `routedScore` is strictly
     lower, otherwise the run unchanged.
   - In `finish`, compute the R96 result and the repaired alternative as today, then
     compact only the one that wins R44 (`routedScore(alternative) < routedScore(current)`
     picks the alternative; ties keep the current run) and pass both to
     `selectRoutingAlternative` unchanged otherwise. One finish therefore adds at most one
     `planLayoutOnce`. Ranking, refinement candidates and annealing evaluations never
     compact, and R97 replans are not refinement candidates.

5. **Tests in `compact.test.ts`.** Small synthetic Documents, no human case:
   - an empty column between two parts joined by a horizontal wire is removed, to the
     grid, and parts right of it move left by that width; a part left of it does not move;
   - a vertical wire, a junction, or a rigid unit spanning the gap keeps it;
   - an edge Cell Pin keeps its 80-unit offset from the device box, and a local Cell Pin
     keeps its 80-unit seat;
   - no y changes, left-to-right order is kept, the enclosing box's left edge is kept, and
     two calls give identical placements;
   - integration: `planAutoLayout` on a Document with a removable column returns a
     narrower instance box than the finalist before R97 (spy on the exported function to
     read its input), with a routed score strictly below that finalist's, and committing
     the result and planning again returns no moves and no diagnostics.

6. **Update the four finishing tests** (section 3), and nothing else in them:
   - R44: the single `signalTrunks === false` call is still exactly one; after it come
     the R96 rip-up call and, when R97 replans, one more call with `{ ripUp: true }` and
     the winner's `signalTrunks`. Assert the exact sequence this fixture produces. The
     score assertion against `selectRoutingAlternative`'s arguments stays as it is.
   - R63: `routeDocument` is called `5 + candidates + k` times, where `k` is the number of
     R97 replans on this fixture (assert the exact number); the last call is R97's if
     `k = 1`.
   - R66 hash: first confirm, with R97 disabled locally, that the old hash
     `3a873691…c26311` is reproduced, then update the literal to the compacted result's
     hash. The crossing bound and the `evaluations: 0` equality stay.
   - R66 search: finishing after annealing (R72, R96, R97) may only lower the score:
     assert `score(result, after) <= progress.at(-1)!.best` instead of equality, and keep
     every other assertion.

7. **Evaluation.** In `scripts/auto-layout-eval.mjs` add per case
   `instanceAreaRatio` (result instance-box area over the human one, `null` without a
   human drawing) and per split `medianAreaRatio` and `medianInstanceAreaRatio` beside
   `meanAreaRatio`; print them in the split summary. No other change to the report.

8. **Spec, `docs/specs/auto-layout.md`.**
   - Add **R97 — Column compaction** after R96 stating steps 3 and 4: what occupies a
     column, the grid floor, the left-edge anchor, rigid units from the finalist, the one
     exact replan with R95, strict R22 acceptance, the R44 winner only, the skips
     (partition, fixed instances), and that y and left-to-right order never change.
   - Add **R98 — Fresh generated ids** after R97: generated Route, Junction and label ids
     never equal an object id of the input Document; editor and Agent routing are
     unchanged.
   - R56: one sentence that R97 may narrow a stage gap after routing, never below
     `2 × MARGIN` (40 units).
   - R44, R58 and R66 each mention R96 after repair; add that R97 then compacts the R44
     winner. Contract "Known limits": R97 compacts columns only; rows keep their pitch.
   - Evaluation section: name the new per-case ratio and the two medians.
   - R87: "Clearance checks skip pins, parts and foreign Routes whose padded bounds miss
     the path", and "The crossing cost is an optional path-length cost" in place of "This
     is an optional path-length cost".

9. **`exhaustive`.** Mark the option `/** @internal Test aid: … */` in
   `route-clearance.ts`; no behaviour change.

10. **Measure and report.** Run the evaluation on `88eab98` and on the result, one after
    the other on the same machine with nothing else heavy running, and report the table
    of the Goal section (counts and medians only, dev and val separately), the number of
    documents where R97 found a gap but the replan was rejected, and the paired time
    ratio. Copy `tmp/auto-layout-eval/report.json` of both runs to
    `tmp/t034/result/variant-base.json` and `variant-result.json` and the result SVGs to
    `tmp/t034/result/svg-result/` (git-ignored).

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/edit-engine packages/auto-layout   # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'compact|route-net-planner|auto-layout'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed
git diff --stat 88eab98 -- packages/auto-layout/test/corpus.test.ts   # expected: empty
git status --short packages/model packages/derived packages/project-protocol apps fixtures docs/agent pnpm-lock.yaml package.json   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/'   # expected: no output
```

On `88eab98`, `pnpm deadcode` exits 1 for findings outside these paths; only the filtered
output counts. Every other command above passes on `88eab98`.

**Targets** (sequential runs of the evaluation, `88eab98` then the result):

| Measure                                              | Required                  |
| ---------------------------------------------------- | ------------------------- |
| Dev median instance-box area ratio                   | ≤ 2.70 (base 2.92)        |
| Val median instance-box area ratio                   | ≤ base (2.37); report it  |
| Crossings, bends, floating pins, missing connections | no split total increases  |
| Readability totals, mirrored symmetry pairs          | no split total gets worse |
| Planning time                                        | ≤ 1.12 × base             |
| `corpus.test.ts`                                     | passes unchanged          |

Behavioral checks:

- For every corpus fixture, planning the committed result again returns no diagnostics
  and no moves (the corpus test checks it; `two-inverters` exercises R98).
- With `fixedInstanceIds` or a partition, the edits equal those of `88eab98` for the same
  input (show it with one test each, or explain why an existing test already shows it).

## Notes for the implementer

- **The prototype is a reference, not the code.** `tmp/t034/proto2/compact.ts` and
  `patch.py` carry `T034_*` environment switches and an xy mode; the product code has no
  switch and compacts x only.
- **Root cause before workaround.** Do not skip compaction for documents where the
  relayout fails, and do not rename ids after the fact in the edit list. If R98 needs a
  different mechanism than a reserved-id set, explain why in the report.
- **No new acceptance channel.** R97 replaces the finalist only by R22's strict decrease;
  do not add area to the score.
- **Human cases.** They stay in git-ignored `tmp/human-cases/`. Never commit any case,
  excerpt, case id or id-keyed data; nothing in CI or `pnpm test:local` depends on them.
- **No LLM calls.** Nothing in this task spends LLM API tokens; do not run the partition
  scripts.
