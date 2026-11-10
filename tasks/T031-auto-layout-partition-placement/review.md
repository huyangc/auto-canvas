# T031 review

## Round 1 — changes requested

Reviewed: the uncommitted working tree after Codex round 1. The round was cut off by a
process kill while the report was being written, so there is no `report.md`. That is not an
implementation defect. The code for steps 0–6 is in the working tree; continue from it.

Opus measured the working tree on dev with real LLM partitions (prompt v4, 3 samples; the
cache `tmp/llm-partition/` is in this worktree):

| Run on dev (18 documents)                     | Completed | Crossings on the 17 common documents | Block intrusion |
| --------------------------------------------- | --------- | ------------------------------------ | --------------- |
| V0, quick                                     | 18        | 225                                  | —               |
| LLM partition, quick                          | 17        | 201                                  | 1               |
| V0, `--search 60`                             | 18        | 174                                  | —               |
| LLM partition, `--search 60` (paired, 4 jobs) | 17        | 132                                  | 0               |

With search, no document has more crossings than V0. Bends rise from 306 to 352, and total
width from 20289 to 24894.

Two things are wrong in these results:

1. **One document is refused.** The 70-instance dev document fails in both modes with
   `R10: touching-pin stub … no clear path`. The default path completes it.
2. **The symmetry numbers collapse and nothing reports why.** The evaluator's symmetry
   metric measures the document's whole symmetry components. Pairs mirrored drop from 49 of
   49 to 11 of 49, and axis devices on the axis from 7 of 7 to 1 of 7. The cause is R130a:
   each block keeps the pairs that lie wholly inside it and mirrors them about its own axis,
   and the blocks sit side by side. That is this task's intended behaviour, but the
   evaluator must show it.

| #   | Severity | Where                                                    | Finding                                                                                                                                              | Expected fix                                                                                                                                                                                                                                   |
| --- | -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `tasks/…/report.md`                                      | No report; acceptance was not finished.                                                                                                              | Rerun every acceptance command on the final tree and write `report.md`.                                                                                                                                                                        |
| 2   | must-fix | `src/auto-layout.ts`                                     | A partition can turn a layout that the default path completes into a refusal.                                                                        | Round 2 amendment, R134: fall back to the default plan with warning `AUTO_LAYOUT_PARTITION_FALLBACK`. The evaluator counts fallbacks per split. Test: a fixture whose partition placement is refused returns the default plan and the warning. |
| 3   | must-fix | `test/partition-reconcile.test.ts` (rail-only test only) | The T029 test expects the legacy `L0 structure split` warning that R130a removes. The file belongs to T030, so round 1 rightly left it failing.      | This round owns that one assertion: `validatePartition` returns no diagnostics for a reconciled partition. Change nothing else in the file.                                                                                                    |
| 4   | must-fix | `scripts/auto-layout-eval.mjs`                           | The symmetry metric shows only whole components, so the effect of R130a is invisible.                                                                | Round 2 amendment: add `blockSymmetry` to each partition result and to the totals. Keep the existing `symmetry` metric unchanged.                                                                                                              |
| 5   | must-fix | `src/stages.ts` (`sideRows` WeakMap)                     | The chosen side row travels through a module-level `WeakMap` keyed by the placements map. That is hidden state between `placeStages` and its caller. | Return the side-row set explicitly from `placeStages`, or through `placeDocument`'s result object. Behaviour does not change.                                                                                                                  |
| 6   | note     | quick mode                                               | Five dev documents have more crossings than V0 in quick mode: +11, +5, +3, +3, +2.                                                                   | Investigate step in the amendment. Report the cause for the three largest. Fix only with a general mechanism, with dev numbers before and after.                                                                                               |

## Round 2 — accepted

Reviewed: the uncommitted working tree after Codex round 2. The report matches the code and
the logs.

- **Findings 1–5 are fixed.**
  - R134 falls back to the default plan and warns `AUTO_LAYOUT_PARTITION_FALLBACK`.
  - The evaluator reports `partitionFallback` and `blockSymmetry`.
  - `placeStages` and `placeDocument` return the side row; the module-level `WeakMap` is
    gone.
  - The rail-only test expects no diagnostics, and nothing else changed in that file.
- **Investigation (finding 6).** The estimator can prefer a side row that costs more after
  routing. The `layered` candidate now keeps one row, and the routed comparison chooses.
  The other regressions come from block order and local geometry; they stay as a known
  limit.
- **Acceptance, rerun by Opus on lane 3.** Every command exits 0:
  - `pnpm vitest run packages/auto-layout`: 452 of 452 tests pass.
  - `pnpm test:local`: 7798 passed, 117 skipped.
  - `pnpm deadcode` reports nothing for auto-layout.
  - The frozen paths are clean.
- **Default output is unchanged.** Plan hashes equal the T027 head on 33 of 33 documents.
  The oracle-partition metrics change on 4 documents, because the validator now merges only
  split recognition units.

**Dev results, measured by Opus** with real LLM partitions (prompt v4, 3 samples). Each pair
ran at the same time with the same jobs.

| Dev, 18 documents             | Completed | Crossings  | Bends      | Width        | Height       |
| ----------------------------- | --------- | ---------- | ---------- | ------------ | ------------ |
| Default, quick                | 18        | 271        | 367        | 21844        | 11845        |
| LLM partition, quick          | 18        | 241 (−11%) | 444 (+21%) | 26227 (+20%) | 10493 (−11%) |
| Default, `--search 120`       | 18        | 208        | 330        | 23419        | 12296        |
| LLM partition, `--search 120` | 18        | 163 (−22%) | 388 (+18%) | 27966 (+19%) | 11069 (−10%) |

- The human drawings have 59 crossings.
- Quick: 9 documents improve and 6 get worse, by at most 6 crossings.
- Search: 14 improve and none gets worse.
- One document falls back to the default plan in both modes.
- Block intrusion is 11 in quick mode and 13 with search; 10 of those are the fallback
  document.
- No pin floats and no connection is missing.

**Targets.**

- Completion and the crossing target are met on dev.
- Arrangement agreement rises by 4.9 points in quick mode, below the 10-point target.
- Val is evaluated once, on the combination of T029, T030 and T031.

**Known limits.**

1. **Whole-circuit symmetry is lost.** Each block mirrors about its own axis, and blocks sit
   side by side. Pairs mirrored about one axis drop from 58 of 58 to 20 of 58 on dev;
   inside blocks, 44 of 44 pairs are mirrored. Stacking the blocks of one stage along the
   current path, on a shared axis, is the next task.
2. **Layouts get wider and have more bends.** Width rises by about 20% and bends by about
   20%; height falls by about 10%.
3. **Six dev documents have more crossings in quick mode.**
4. **A fallback plans twice.** With search it can take twice the search budget.

## Subagent review before merge (opus, read-only)

The user asked for an independent subagent review before merging. It read
`917737a..856a2b9` through git objects. Verdict: merge-ready; no P0, P1 or P2.

It went through every hunk for the default path and found no way for a plan without
`partition` to differ from the base: the trimming helpers return their input, the side-row
branch never runs, the score gains an exact `+ 0`, and seeded search draws the same random
numbers.

P3 notes, accepted as known limits:

- After a fallback, `metrics.score` includes the intrusion penalty against a partition the
  plan did not use, and the reported planning time covers only the second plan.
- The oracle (`arrangement`) test no longer runs with `search`, so nothing tests that path
  with search.
- A trimmed group keeps its `kind` with fewer members: a current mirror cut by a block can
  become a "current-mirror" of two outputs without its reference.

**Rebase.** The branch was rebased without conflicts onto T029's round 4 head, which itself
sits on `main` with T032.
