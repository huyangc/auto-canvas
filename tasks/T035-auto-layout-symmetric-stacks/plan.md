# T035 — Auto-layout: symmetric stacks for partition placement

- Branch: `task/T035-auto-layout-symmetric-stacks`
- Base: `main` at `5d27471` (T034 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. No other task is in
  flight in `packages/auto-layout`; the session that wrote T027–T031 has handed this
  area over and plans nothing in it. No browser test is expected.
- Rules claimed: R140 (symmetric stacks). R141–R144 stay free.
- Status: approved

## Goal

With an LLM partition, auto-layout lays out each block on its own and places the blocks
left to right. Symmetric halves that span several blocks (an input pair in one block, its
load in another, the tail in a third) lose their shared axis: on the 18 dev drawings only
20 of 58 R88 pairs end up mirrored about one axis, against 58 of 58 without a partition.
The user chose **symmetry first**: like R94 in default mode, partition blocks that belong
to one symmetric current path are placed as one block on one axis, accepting the
crossings this costs.

Opus prototyped four variants on the dev split, quick mode, with the cached LLM samples
(`pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev`, no API
calls). Counts only:

| Dev, partition mode                                          | Crossings | Mirrored pairs | Width (sum) | Intrusion |
| ------------------------------------------------------------ | --------: | -------------: | ----------: | --------: |
| `5d27471`                                                    |       239 |          20/58 |       22683 |        11 |
| merge every block of an R88 component                        |       272 |          58/58 |       19491 |        68 |
| **merge blocks of one component joined on a conducting Net** |   **257** |      **49/58** |   **20595** |    **50** |
| stack blocks vertically, each keeping its own layout         |       283 |          43/58 |       19935 |        17 |
| best of `5d27471` and stacking per drawing, by crossings     |      ~229 |         ~25/58 |           — |         — |

Default mode (no partition) has 271 crossings and 58/58 on the same drawings. The
chosen variant (bold) stays below default mode's crossings, is 9% narrower than
partition mode today, and restores 29 mirrored pairs. The 9 pairs it does not restore
have their two halves in blocks that share no conducting Net (for example two output
branches joined only through gates or rails); this task leaves them as they are.

## Context

Everything below was verified on `5d27471`. Paths are relative to the repository root.

### 1. How a partition reaches placement

- `packages/auto-layout/src/place.ts` `placeDocument`:
  - `:158`–`:159`: `topology = symmetryTopology(…)`, then
    `symmetry = partitionSymmetry(topology.components, options.partition)` keeps only the
    pairs whose both members are in one block (`partition.ts:54`).
  - `:165`–`:168`: `templates = partitionGroups([...groups, ...persisted], options.partition)`
    trims recognized and persisted groups to blocks (R130a).
  - `:205`–`:218`: with a partition, every strategy calls `placeStages(…, { ...topology,
components: symmetry }, options.partition, strategy !== "layered")`.
  - `:296`–`:299`, `:343`–`:346`, `:509`–`:512`: `partitionDocuments(…, options.partition)`
    scopes parallel and driver attachments to one block.
  - `symmetry` also feeds `resolveCollisions` (`:287`–`:293`, `:332`–`:338`,
    `:360`–`:366`) and the frozen sets at `:306`, `:328`, `:353`.
- `packages/auto-layout/src/stages.ts` `placeStages` (`:441`):
  - with a partition, `found.stages` are the blocks (`:455`–`:463`); each is laid out
    alone by `deviceRows`/`orderRows`/`assignColumns` with the components whose first
    pair member it holds (`:557`–`:618`), then blocks are ordered and composed left to
    right (`:773`–`:916`);
  - R59 attachment hosts must share a block (`:506`–`:510`); side-row candidates are the
    blocks with role `bias`, `cmfb` or `compensation` (`:777`–`:781`); the R57 direction
    falls back to `input`/`output` block roles (`:947`–`:950`).
  - `conductingPins` (`:71`) is R50's definition of DC-conducting pins (MOS D/S, BJT C/E,
    both pins of resistors and inductors, …), module-private.
- `packages/auto-layout/src/search-moves.ts` `createMoveGenerator(…, partition)` (`:42`):
  groups (`:56`), block ownership for joins (`:71`–`:78`), symmetry (`:88`–`:91`),
  attachments (`:114`) and stage blocks (`:133`–`:134`) all read the partition. It is
  called from `search.ts:87` with `initial.run.partition`, which is
  `options.partition`.
- Not placement: `buildPlan` (`auto-layout.ts`) trims recognized groups to blocks for the
  layout-group records and routing order; `routedScore` adds R131 `blockIntrusion`
  (`refine.ts:21`, 500 per device) against `run.partition`; `planAutoLayout` measures
  intrusion and runs R134 fallback against the validated partition; the evaluation
  reports block metrics against the supplied partition.

### 2. Why merging, and why on a conducting Net

- The prototype that merged every block touching a component reproduced default mode's
  layout (272 crossings): the partition's ordering gains vanish.
- Requiring a shared non-rail Net on DC-conducting pins merges the blocks of one current
  path (pair, load, tail) and keeps gate-driven stages (a detection or output stage
  driven by the pair) as separate blocks. In the inspected dev pre-amplifier this matches
  the human drawing: pair over cross-coupled load on one axis, detection stage beside it.
- Keeping each block's own layout and only stacking blocks (fourth row) made drawings
  tall and added crossings on the larger documents.

### 3. Prototype

`tmp/t035/patch-c.py` applies the chosen variant to `5d27471` behind `T035_STACK=C`:
`stackedPartition` in `stages.ts` and three replacements in `place.ts` (`symmetry`,
`templates`, the `placeStages` argument). It does not yet use the derived partition for
attachments or annealing. Its result is the bold row above; it is a reference, not the
code to copy.

### 4. Measurement tools (git-ignored)

- `tmp/llm-partition/` holds the cached LLM samples. `cachedSamples`
  (`scripts/auto-layout-llm-partition.mjs:87`) only reads that cache; a missing sample
  reports `missing` and never calls an API.
- `tmp/t035/table.mjs <dir> <base> <name>…` prints crossings, bends, wire, floating,
  missing, whole and block symmetry, intrusion, width, median area and fallback counts
  from `variant-<name>.json` files.
- `tmp/t035/b/variant-base5.json` is `5d27471`'s dev partition report.
- `tmp/t034/result/variant-rebased.json` is the default-mode report of a tree identical
  to `5d27471`; each case carries `planHash`, and `--baseline <report.json>` makes the
  evaluation mark `baselineEqual` per case.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/partition.ts` (the new derivation)
- `packages/auto-layout/src/stages.ts` (export or move `conductingPins` only, unchanged)
- `packages/auto-layout/src/placement-connectivity.ts` (only if `conductingPins` moves
  there)
- `packages/auto-layout/src/place.ts`, `packages/auto-layout/src/search-moves.ts`
  (use the derived partition)
- `packages/auto-layout/test/partition.test.ts` and a new
  `packages/auto-layout/test/stacks.test.ts`
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- default mode (no partition) and the `arrangement` (V2) path: byte-identical results;
- R131 scoring, R134 fallback, layout-group records, routing, refinement, finishing
  (R72, R96, R97), the evaluation script and every other test file;
- `partitionSymmetry`, `partitionGroups`, `partitionDocuments` themselves;
- `packages/model`, `packages/derived`, `apps/`, `scripts/`, `pnpm-lock.yaml`,
  dependencies.

## Steps

1. **`placementPartition(document, resolver, roles, partition)` in `partition.ts`.**
   Return the input unchanged when there is no partition or it has an `arrangement`.
   Otherwise:
   - take the R88 components of the whole Document (`symmetryTopology(…).components`);
   - for each component, for each two blocks holding any of its pair or axis devices,
     join them when they share a non-rail Net on R50 conducting pins of their own
     members (reuse `conductingPins`; move it to a shared module if the import would be
     circular, without changing it); joins are transitive;
   - return a partition whose blocks are the joined groups: the id of the first block in
     partition order, members in partition order, the common `role` if every joined block
     has the same one, else `other`; unjoined blocks unchanged; `flow` ids renamed to the
     surviving id with repeats removed; `title` of the first block.
     Deterministic, no dependence on positions or ids beyond partition order.

2. **Use it for placement.** In `placeDocument`, derive the placement partition once and
   use it everywhere `options.partition` is read for placement: `partitionSymmetry`,
   `partitionGroups` for `templates`, the `placeStages` argument and the three
   `partitionDocuments` calls. In `createMoveGenerator`, derive it the same way from its
   `partition` argument before its first use, so annealing joins, block moves, symmetry
   and attachments use the same blocks. Nothing else reads it: R131, R134, records and
   metrics keep the supplied partition.

3. **Tests, `stacks.test.ts`** (synthetic Documents only):
   - a differential pair block, a load-mirror block and a tail block joined through drain
     and tail Nets become one placement block; the pair is mirrored about one axis in
     `planAutoLayout`'s result with that partition; the supplied partition's block
     intrusion is still reported;
   - a block joined to the pair only through gates (a second stage) stays a separate
     placement block, placed beside;
   - two mirror-half blocks sharing only a rail stay separate;
   - roles: same role kept, mixed roles become `other`; `flow` renaming; an `arrangement`
     partition and a partition without spanning components are returned unchanged;
   - determinism: identical inputs give byte-identical edits.

4. **Existing tests.** `partition.test.ts` must pass. If a test's fixture contains a
   component spanning blocks joined on a conducting Net, its expected placement may
   change: change only that expectation, say in the report which test and why, and show
   that the new result satisfies R140. Do not change other tests.

5. **Spec.** Add **R140 — Symmetric stacks** after R134: the join rule of step 1, that
   placement (R130 ordering and its local layout, R130a trimming of groups and symmetry,
   R59 attachments, R132 annealing) uses the joined blocks, and that validation, R131,
   R134, layout-group records and metrics keep the supplied partition. Amend R130a's last
   sentence and R132's "use partition blocks" to point at R140. In "Known limits", state
   that pairs whose halves sit in blocks without a shared conducting Net keep block-local
   symmetry only.

6. **Measure and report** (cached samples only; never set an API key):
   - dev quick: `5d27471` and the result, one after the other on the same machine; table
     as in the Goal, per split totals and medians, plus the number of joined stacks and
     their block counts;
   - val quick: the same, report only;
   - dev search: `--search 30` for both, one after the other; report crossings and
     mirrored pairs;
   - default mode: `pnpm auto-layout:eval tmp/human-cases --jobs 7` on both; the 33 plan
     hashes must be identical.
     Copy the reports to `tmp/t035/result/` (git-ignored).

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'partition|stages|search-moves|place\.ts'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed, plan hashes equal 5d27471's
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7   # expected: exit 0, 18 completed
git status --short packages/model packages/derived packages/edit-engine apps scripts fixtures docs/agent pnpm-lock.yaml package.json   # expected: empty
git ls-files | grep -E 'human-cases|llm-partition|auto-layout-eval/|^tmp/'   # expected: no output
```

On `5d27471`, `pnpm deadcode` exits 1 for findings outside these paths; only the filtered
output counts. Every other command above passes on `5d27471`.

**Targets** (dev, quick, cached samples, sequential runs):

| Measure                                       | Required                           |
| --------------------------------------------- | ---------------------------------- |
| Mirrored R88 pairs (whole-circuit)            | ≥ 45/58 (base 20/58)               |
| Crossings                                     | ≤ 262 (base 239; default mode 271) |
| Block-local mirrored pairs                    | 44/44, unchanged                   |
| Floating pins, missing connections, fallbacks | no increase                        |
| Instance width (sum)                          | ≤ base                             |
| Default-mode plan hashes                      | identical on all 33 drawings       |

## Notes for the implementer

- **Symmetry first is the user's decision.** Do not add a candidate that picks the
  unjoined layout by crossings, and do not add a symmetry weight to the score.
- **One derived partition, one rule.** Placement code reads the derived partition;
  everything that judges or reports blocks reads the supplied one. Do not thread a second
  flag through `placeStages`.
- **No LLM calls.** Every partition evaluation reads `tmp/llm-partition/`; do not run
  `scripts/auto-layout-llm-partition.mjs` in any mode that calls an API, and never export
  an API key.
- **Human cases.** They stay in git-ignored `tmp/human-cases/`. Never commit any case,
  excerpt, case id or id-keyed data; nothing in CI or `pnpm test:local` depends on them.
