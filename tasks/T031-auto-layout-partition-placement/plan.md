# T031 — Auto-layout: place sub-component partitions with stage ordering, soft block boundaries and annealing

- Branch: `task/T031-auto-layout-partition-placement`
- Base: `task/T029-auto-layout-partition-units` at `917737a` (stacked on the T029 PR)
- Lane: 3 (`ICM_E2E_PORT=4373`, `AUTO_CANVAS_E2E_API_PORT=4331`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`)
- Rules: R130–R134
- Status: approved

## Goal

The user decided (2026-11-09) that the LLM only partitions the netlist into functional
sub-components. The rules and annealing do all placement. T029 produces a complete
partition: graph units, LLM grouping, validation, completion and consensus. This task makes
placement use it well.

T026 and T027 showed what placement must solve:

- with a partition but a naive automatic floorplan (V1), crossings rose by 12–20%;
- hard block boundaries refused 7–22% of documents;
- partitioned layouts ran in quick mode only.

This task fixes those three things:

1. partition blocks go through the normal stage ordering;
2. block boundaries become a score term, not a refusal;
3. annealing runs with partitions, with block-level moves.

It first resolves the contract boundary that T029 left open:

- **Validator.** The planner validator (`validatePartition`, T026) still merges every greedy
  `recognizeStructures` group that spans blocks.
- **Units.** T029's recognition units are deliberately finer: they are cut by stage and by
  non-rail connectivity.
- **The fix.** The validator moves to units, and placement trims groups to the members of
  each block.

T030 (fingerprint library) runs in parallel on lane 2 and owns `units.ts`,
`partition-reconcile.ts`, `partition-prompt.ts` and a new mining script. Do not edit those.

## Context

- **Partition entry.** `planAutoLayout` (`src/auto-layout.ts:55-93`) handles
  `options.partition`. It validates the partition, rejects one with error diagnostics,
  strips `search` (quick mode only), and warns `AUTO_LAYOUT_PARTITION_QUICK_ONLY` when
  `search` was given.
- **Block layout.** `placeStages` (`src/stages.ts:441`) builds per-block local layouts and
  rail alignment from partition blocks, then returns `partitionFloorplan`
  (`src/partition-floorplan.ts`). That function arranges blocks by `flow`, puts
  `bias/other/cmfb/compensation` blocks in a row below (V1), or uses `arrangement` (V2).
  Without a partition, `placeStages` continues into the R53/R54 estimate-driven ordering
  and mirroring, R57 direction, R56 spacing and R59 attached shunts.
- **Hard boundary.** `partitionPlacementProblem` (`src/partition-geometry.ts:49`) refuses
  finishing that crosses block boundaries (`src/place.ts:559-568`). It is the main cause
  of refusals.
- **Annealing.** R66 search (`src/search.ts`, `src/search-moves.ts`) has stage-block moves
  built from `findStages` (`src/search-moves.ts:105`).
- **Score.** `routedScore` and `ROUTED_SCORE_WEIGHTS` are in `src/refine.ts:15-27`.
- **Data.** T029 provides `reconcilePartition`, and the evaluator's
  `--partition llm --samples k` builds partitions from cached LLM samples
  (`tmp/llm-partition/`, prompt v4), or from rules when there are none.

### Binding constraints (unchanged)

- **Human cases.** The third-party cases stay git-ignored; never commit a case, case id or
  id-keyed data.
- **Splits.** Tune on dev only; val is evaluated once.
- **Frozen code.** The router, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `edit-engine`, `derived` and `apps/` do not change.
- **Default output.** Without `partition`, output is byte-identical to the base on all 33
  human cases.
- **T026 path.** The `arrangement` (V2) path keeps working.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/`: `auto-layout.ts`, `place.ts`, `stages.ts`, `partition.ts`,
  `partition-from-placement.ts`, `partition-floorplan.ts`, `partition-geometry.ts`,
  `refine.ts`, `search.ts`, `search-moves.ts`, and their tests.
- `scripts/auto-layout-eval.mjs`, for metrics only. `scripts/auto-layout-partition-report.mjs`
  belongs to T030; do not edit it. It counts the validator's warning by its text, so keep
  the warning text `L0 structure split across …; merged into …`.
- `docs/specs/auto-layout.md`, for R130–R134.

Out of scope (do not change):

- `src/units.ts`, `src/partition-reconcile.ts`, `src/partition-prompt.ts`,
  `scripts/auto-layout-partition-report.mjs`, `scripts/auto-layout-llm-partition.mjs`
  and any fingerprint file, which belong to T030;
- the router (`packages/edit-engine`), R10, R23 and `lostNameClaim`;
- `packages/model`, `derived`, `project-protocol`, `spice`, `apps/`, `fixtures/`.

## Steps

0. **R130a Validator on units, groups trimmed to blocks.**
   - `validatePartition` (`src/partition.ts`) merges blocks only when they split a
     recognition unit (`recognitionUnits` from `src/units.ts`, imported, not edited). It no
     longer merges on greedy `recognizeStructures`, `recognizeSubstructures` or persisted
     template groups.
   - Placement with a partition trims every `RecognizedGroup` to the members of one block.
     A group whose members span blocks keeps, in each block, the members that lie there. A
     member left alone is no longer a group, and `tailInstanceId` and `diodeInstanceId` are
     dropped when they lie in another block. The same rule applies to symmetry components;
     the T025 rule kept only components wholly inside one block.
   - The default path, without a partition, is untouched.
   - The oracle (`partitionFromPlacement`) and LOADBench partitions also go through the new
     validator. Report how many documents changed their merged blocks.
   - The partition report's planner-merge count then counts unit splits. It must be 0 for
     partitions from `reconcilePartition`.

1. **R130 Partition blocks through stage ordering.** When `partition` has no
   `arrangement`, do not use `partitionFloorplan`. Run partition blocks through the same
   machinery as `findStages` stages:
   - R53/R54 estimate-driven order and mirroring;
   - R57 signal direction;
   - R56 spacing;
   - R59 attached shunts, kept within their block.

   `role` may guide two things, nothing more. First, an optional second row holds blocks
   whose role is `bias`, `cmfb` or `compensation`. Treat this as a candidate the estimator
   compares, not a fixed rule. Second, `input` and `output` roles may bias the R57
   direction. The `arrangement` path is unchanged.

2. **R131 Soft block boundaries.**
   - Replace the `partitionPlacementProblem` refusal with a score term. `blockIntrusion` is
     the number of devices whose visible bounds intersect another block's bounding box in
     the final preview.
   - Add it to `routedScore` with weight `ROUTED_SCORE_WEIGHTS.blockIntrusion` (start at 500) only when a partition is given.
   - Finishing may then move devices freely. Report the intrusion count in
     `refinementMetrics` and the evaluator.

3. **R132 Annealing with partitions.**
   - Remove the quick-only restriction.
   - With a partition, the stage-block moves in `search-moves.ts` use partition blocks
     instead of `findStages` stages.
   - Unit moves inside blocks stay as they are.
   - Add one move: swap a block between the signal row and the side row, if R130 made two
     rows.
   - Energy is `routedScore`, including `blockIntrusion`. R67 bounds and the other
     invariants still apply.

4. **R133 Determinism and safety.** Quick mode with a partition is deterministic, and
   search is deterministic for a given seed and budget. Every result passes the existing
   transaction and equivalence checks.

5. **Evaluation** (`scripts/auto-layout-eval.mjs`):
   - add `blockIntrusion` to the results and totals;
   - `--partition llm` now accepts `--search <seconds>`;
   - keep the arrangement-agreement and area metrics.

6. **Tests.** Hand-built:
   - partition blocks are ordered by the estimator: a fixture where V1's fixed row order
     costs a crossing that R130 avoids;
   - a finishing step that crosses a boundary is no longer refused and is counted;
   - search with a partition is deterministic, uses partition blocks, and keeps
     `blockIntrusion` from rising against the quick result in a fixture;
   - the default and `arrangement` paths are unchanged.

7. **Report**, by Codex: what was built, tests, and a smoke run on dev with rule-only
   partitions (`--samples 0`). Opus runs the LLM-partition evaluation.

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
pnpm auto-layout:eval tmp/human-cases --jobs 8                                         # expected: exit 0; Opus compares with the base
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 0 --split dev --jobs 8 # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition/'                  # expected: no output
```

Opus's targets, on LLM partitions (3 samples) and on both splits:

- 33 of 33 complete, in quick mode and with `--search 120`;
- arrangement agreement at least 10 points above V0;
- with `--search 120`, crossings at most 5% above V0;
- block intrusion in the final layouts low and reported.

## Notes for the implementer

- One general mechanism per step. Never key anything to a case, Reference, instance id or
  symbol id.
- `blockIntrusion` weight 500 is a starting value; keep it in `ROUTED_SCORE_WEIGHTS`.
- If removing the hard boundary makes partitions meaningless (blocks fully mixed), report
  it with numbers. Do not reinstate the refusal.
