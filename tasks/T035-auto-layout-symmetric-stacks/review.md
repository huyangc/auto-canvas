# T035 review

## Round 1 — accepted

Reviewed: `git diff 5d27471` on `task/T035-auto-layout-symmetric-stacks` after round 1;
acceptance rerun by Opus.

R140 matches the plan. `placementPartition` joins blocks of one whole-Document R88
component that share a non-rail Net on R50 conducting pins, transitively, keeping the
first block's id, title and members order; placement (`placeDocument`, including all
four attachment scopes) and annealing (`createMoveGenerator`) read the derived
partition, and R131, R134, records and metrics keep the supplied one. No existing test
changed. Default mode is byte-identical (33 of 33 plan hashes). Human | default |
partition | T035 sheets in `tmp/t035/sheets/t035-case*.png` show stacked symmetric
cores with gate-driven stages beside them.

| #   | Severity | Where                                                                    | Finding                                                                                                                                              | Expected fix                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | note     | `packages/auto-layout/src/place.ts`, `partition.ts` `placementPartition` | With a partition, `placeDocument` detected R88 topology twice (once inside the derivation), against R94's "detect topology once per placement call". | Fixed by Opus: `placementPartition` takes optional components, and `placeDocument` passes the topology it already computes. Results unchanged (dev table identical). |
| 2   | note     | plan acceptance                                                          | `git ls-files \| grep 'llm-partition'` matches four files that predate the task (`scripts/auto-layout-llm-partition.mjs` and T027's task files).     | Plan defect; no human case, cache entry or evaluation output is tracked.                                                                                             |
| 3   | note     | dev search, report only                                                  | `--search 30`: crossings 169 → 197, mirrored pairs 16/58 → 49/58.                                                                                    | Accepted: the user chose symmetry first.                                                                                                                             |

Acceptance rerun after the Opus fix:

```text
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm build → 0
pnpm vitest run packages/auto-layout → 0 (29 files, 503 tests)
pnpm test:local → 0 (770 files passed, 3 skipped; 7854 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'partition|stages|search-moves|place\.ts' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 --baseline <5d27471-equivalent report> → 0; baselineEqual 33 of 33
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7 → 0, 18 completed:
  crossings 239 → 257, mirrored pairs 20/58 → 49/58, block-local 44/44, floating 0, missing 0,
  width 22683 → 20595, fallbacks 1 → 0
protected paths → empty
```
