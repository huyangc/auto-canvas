# T026 — Auto-layout: oracle upper bound for block-level (hierarchical) placement

- Branch: `task/T026-auto-layout-oracle-blocks`
- Base: `main` at `f8f15fe`
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`); no browser
  test is expected.
- Status: approved

## Goal

People read and draw a schematic in blocks, levels and stages, so its function shows at a
glance. The user wants to know whether hierarchical, block-level placement would improve
our drawings. If it does, a later task will have an LLM propose the block partition from
the netlist.

The user decided (2026-11-09) to measure the upper bound first, with no LLM.

1. Take "oracle" block partitions from data that already encode them.
2. Lay out with those partitions.
3. Measure how much better the drawings get.

This task is an experiment. Its product code stays behind an experimental option. With the
option absent, output must stay byte-identical to `main`.

## Context

### Prior experiment of the same kind

T016 held the human placements fixed and ran our router. Human placement plus our router
gave 176 crossings, against 884 for our placement plus our router, which showed that
placement was the gap. This task asks the next question: given the human partition into
blocks, but our own placement, how close do we get?

### Data that encode partitions

- **33 third-party human cases**, in git-ignored `tmp/human-cases/`. Each human drawing's
  device positions imply its blocks: humans draw a block's devices close together, with
  space between blocks. 6 documents also contain drafting rectangles (8 in total) that
  frame blocks explicitly.
- **LOADBench**: CC BY 4.0, Zenodo 10.5281/zenodo.21759759.
  - Location: T022 fetched 101 op-amp topologies to
    `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t022-auto-layout-recognition-fe5011/tmp/recognition/loadbench/`.
  - Files per topology: `partitioning.xml` (functional blocks), `struct_recognition.xml`
    and netlists.
  - Converter: T022's local scripts live under that worktree's `tmp/t022/`.
- **CircuitGenome**: MIT. Synthesized op-amps with block labels sit in the same
  `tmp/recognition/circuitgenome/`.

Copy whatever you use into this worktree's git-ignored `tmp/`. Never commit cases,
case ids or id-keyed data.

### Code facts

- `placeDocument` (`src/place.ts:122`) dispatches the `template`, `layered` and `stages`
  strategies. The `stages` strategy (`placeStages`, `src/stages.ts:422`) works in two
  parts:
  - it lays each block out on its own with the layered rules;
  - it puts the blocks side by side, aligns them by rail, and orders them by signal
    distance and the R54 estimate.

  Today its blocks come from `findStages` (channel-connected components).

- `AutoLayoutOptions` is defined in `src/types.ts:7`. Annealing (`search`) is R66/R67. The
  portfolio, refinement and repair are in `src/auto-layout.ts`.
- Fixing every instance (`fixedInstanceIds` = all ids) makes the planner route a given
  placement unchanged. This yields "human placement + today's router" with no throwaway
  build.

### Concurrent work

The symmetry-axis task runs in another session on lane 1, on branch
`task/T024-auto-layout-symmetry`, which is being renamed to T025. It touches:

- `recognize.ts`, `stages.ts`, `place.ts`, `template-placement.ts` and `layered.ts`;
- annealing moves.

Keep this task's changes in new files where you can. Limit hooks in shared files to a
few lines.

### Binding constraints

- **Human cases.** Git-ignored only. Never commit any case, excerpt, case id or id-keyed
  data. Nothing in CI may depend on them.
- **Splits.** Tune any parameter on dev only (`sha256(id) % 3 != 0`). Report val
  separately.
- **Frozen code.** The router, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `packages/edit-engine`, `packages/derived` and `apps/` do not change.
- **Netlist equivalence.** Every result must keep it, through the existing transaction
  checks.

## Scope

Owned paths:

- `packages/auto-layout/**`: new files plus minimal hooks.
- `scripts/auto-layout-eval.mjs`.
- `docs/specs/auto-layout.md`: document the experimental option only.

Throwaway probes go in git-ignored `tmp/`.

## Steps

1. **Partition contract.** Add an experimental, internal option
   `partition?: LayoutPartition`.

   ```ts
   interface LayoutPartition {
     blocks: { id: string; role?: BlockRole; members: string[] }[];
     /** Block ids in signal order, left to right; optional. */
     flow?: string[];
     /** Optional relative block centres (any unit), e.g. from a human drawing. */
     arrangement?: Record<string, { x: number; y: number }>;
   }
   type BlockRole =
     | "bias"
     | "input"
     | "gain"
     | "output"
     | "load"
     | "cmfb"
     | "compensation"
     | "switch"
     | "logic"
     | "other";
   ```

   A later LLM step will fill this same contract, so keep it general and documented.

   Validate it:
   - members are real device ids;
   - each device appears in exactly one block, and devices missing from the partition go
     into an `other` block;
   - a recognized L0 structure (R5/R68/R80+/R90+) is never split across blocks: report
     such conflicts and merge those blocks.

2. **Oracle partitions.**
   - **H — from the human drawing.** Add a deterministic `partitionFromPlacement`. It
     clusters devices by their drawn positions, keeps L0 structures whole, and merges
     only across shared non-rail Nets. Also use drafting rectangles that enclose
     devices. Choose the distance threshold on dev, and report the sensitivity at three
     thresholds. Set `flow` from block x order, and `arrangement` from block centroids in
     the human drawing.
   - **L — from LOADBench.** Map `partitioning.xml` blocks to the converted document's
     devices. If T022's converter does not produce placeable Documents, report that and
     skip L. The layout metrics then have no human reference.

3. **Block-level placement.** It runs when `partition` is given, in two variants:
   - **V1, partition with automatic floorplan.**
     - Lay each block out on its own with the existing strategies, including recognized
       templates.
     - Arrange the blocks with the `stages` machinery: side by side in `flow` order, or by
       signal distance when there is no `flow`. Align them to rails.
     - Bias and other side blocks should not sit between signal blocks. Use one simple
       general rule, for example placing `bias` blocks below or left of their consumers,
       and report it.
   - **V2, partition with oracle floorplan.** Same in-block layouts as V1, but block
     positions follow `arrangement`: scale the centroids, then resolve overlaps by
     pushing blocks apart along the smaller overlap axis, keeping their relative order.

   The rest of the pipeline is unchanged and runs after placement:
   - markers;
   - routing;
   - refinement;
   - R44/R72 repair;
   - label seating (R73);
   - every transaction check.

   Annealing may move whole blocks and devices inside a block, but must not move a device
   across blocks. If that is more than a few lines, run quick mode only and report it.

4. **Reference V3: human placement with today's router.** Evaluate each human case with
   every instance fixed.

5. **Evaluation.**
   - In `scripts/auto-layout-eval.mjs`:
     - add `--partition human|loadbench`;
     - add `--variant v1|v2`;
     - add `--fixed-human` for V3.
   - Report, per variant, split by dev and val:
     - crossings, bends, floating pins and the three readability counts;
     - wire length;
     - area ratio against the human drawing, as width × height of the drawing bounds;
     - block cohesion: overlap between block bounding boxes;
     - arrangement agreement: the share of block pairs whose left/right and above/below
       relation matches the human drawing.
   - In the result SVGs, draw each block's bounding box dashed with its role. This lets a
     reviewer check partitions by eye; it is evaluation output only, not a product
     feature.

6. **Tests.** Hand-built only:
   - partition validation: unknown id, duplicate member, a split L0 structure merged,
     missing devices put into `other`;
   - without `partition`, output equals `main`;
   - V1 places blocks in `flow` order;
   - V2 follows a given arrangement and resolves an overlap;
   - no device is moved across blocks;
   - transactions replay with an unchanged terminal partition.

7. **Report.**
   - A table of V0 (today's `main` quick), V1-H, V2-H and V3, with L variants if
     available. Give dev and val separately for every metric above.
   - Sensitivity of the H partition to its threshold.
   - Six rendered sets: human | V0 | V1 | V2, with block boxes.
   - A plain recommendation. Does block-level placement with a good partition beat V0
     clearly on both splits? Which matters more, the partition (V1) or the floorplan
     (V2)?

## Acceptance

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json                 # expected: exit 0, equals main
pnpm auto-layout:eval tmp/human-cases --partition human --variant v1 --jobs 12                     # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --partition human --variant v2 --jobs 12                     # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --fixed-human --jobs 12                                      # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|recognition/'  # expected: no output
```

There is no quality target: this task measures. Requirements:

- with the option absent, quick-mode human results equal `main`'s in every document;
- every variant result is electrically equivalent and has no unsafe geometry;
- corpus targets and held-out ceilings hold in default mode.

## Notes for the implementer

- One general mechanism per step. Never key behavior to a case, Reference, instance id or
  symbol id.
- Keep the partition contract independent of where partitions come from: human drawing,
  LOADBench, rules or LLM.
- If a variant cannot run on a document, record why. Do not drop the document silently.
