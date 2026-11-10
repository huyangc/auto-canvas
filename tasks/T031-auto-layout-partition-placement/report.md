# T031 report — round 2

## Summary

Completed the round 1 implementation and all five must-fix review findings. Valid
partitions without an arrangement now fall back to the default planner after an
error or empty plan, retaining other options and validation diagnostics. The final
fallback is measured against the partition. The evaluator reports fallback counts
and block-local symmetry. Side-row membership is returned explicitly through
`placeStages` and `placeDocument`, replacing the module-level WeakMap.

Investigation found that an estimated side-row improvement can worsen actual
routing. Partition placement now retains a single-row candidate in the existing
routed strategy comparison. On the 17 previously completed dev documents,
crossings decrease from 201 to 195. With the recovered document, all 18 complete
with 241 crossings, compared with 271 for default quick mode. Default plan hashes
are unchanged on all 33 human cases against base `917737a`.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 0 / R130a | done | Recognition-unit validation, block-local group and symmetry trimming retained. Oracle partitions change in 4/33 documents; aggregate blocks change from 99 to 96. All 18 reconciled dev partitions produce zero planner merges. LOADBench corpus measurement unavailable; see limitations. |
| 1 / R130 | done | Partition blocks use stage ordering, direction, spacing and within-block attachments. Estimator-selected rows return explicitly. A single-row candidate also reaches routed ranking. Arrangement placement stays on its existing path. |
| 2 / R131 | done | Finishing may cross boundaries; distinct-device intrusion is scored at weight 500 and measured on the final preview. |
| 3 / R132 | done | Partition search uses partition blocks and row exchanges; deterministic search and intrusion checks pass. |
| 4 / R133 | done | Replay, fixed-instance, terminal-partition and deterministic checks pass. Default hashes match the base on 33/33 cases; existing arrangement golden remains unchanged. |
| 5 / evaluator | done | Per-document fallback flag, per-split fallback count, block symmetry counts/totals, intrusion, agreement and area metrics. Existing whole-component symmetry stays unchanged. |
| 6 / tests | done | 452 auto-layout tests pass, including fallback with and without search, preservation of fixed instances, arrangement refusal, empty-plan fallback, row alternatives, and the corrected rail-only assertion. |
| 7 / report | done | Rule-only and cached three-sample dev evaluations completed; findings and acceptance evidence below. |
| Round 2 / R134 | done | Replan without partition on placement/routing error or no edits; retain the first problem in `AUTO_LAYOUT_PARTITION_FALLBACK`, validation diagnostics and final intrusion metrics. Invalid partition input still fails validation. |

## Review findings addressed

1. **Missing report / unfinished acceptance:** ran every listed acceptance command
   and wrote this round 2 report. Logs are in git-ignored `tmp/t031-round2/`.
2. **Partition refusal:** added R134 fallback. A hand-built four-resistor fixture
   with one fixed device and a drafting obstacle refuses partition placement but
   successfully replays the exact default edits. The test checks both quick and
   seeded search options, fixed-device preservation, terminal equivalence,
   unchanged input, intrusion metrics, and continued refusal with an arrangement.
   An empty-document test covers the no-edits fallback without recursion.
3. **Rail-only expectation:** changed only that test's diagnostic assertion in
   `partition-reconcile.test.ts` to expect no diagnostics.
4. **Invisible local symmetry:** evaluator applies
   `symmetryCounts(..., partitionSymmetry(components, partition))` to partition
   results and sums all six counts. The original `symmetry` calculation is unchanged.
5. **Hidden row state:** removed `sideRows` and `partitionStageRows`; stage
   placement returns `{ placements, sideRow? }`. Existing stage consumers and
   their tests now read `.placements`, including the stage call in the symmetry
   test. Annealing receives the row set through the placement result.

## Acceptance results

Commands ran on `task/T031-auto-layout-partition-placement`. Local tests use
`ICM_E2E_PORT=4373`, `AUTO_CANVAS_E2E_API_PORT=4331`, and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`.

```text
pnpm install --frozen-lockfile --offline
  → 0; Already up to date; no lockfile/dependency changes.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0.
pnpm lint
  → 0; oxlint: 1981 files, 0 errors, 3049 warnings.
pnpm vitest run packages/auto-layout
  → 0; 24 files, 452 tests passed.
pnpm test:local
  → 1 in sandbox; 19 failed / 745 passed / 3 skipped files;
    63 failed / 7702 passed / 150 skipped tests; 2 errors.
    Representative output: connect EPERM ::1:5432;
    connect EPERM 127.0.0.1:5432;
    listen EPERM: operation not permitted 127.0.0.1.
    Local-access retry → 0; 764 passed / 3 skipped files;
    7798 passed / 117 skipped tests (77.60 seconds).
pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → 1 from grep; no output, as expected for no auto-layout findings.
pnpm build
  → 0; editor build completed; existing bundle-size warning.
pnpm auto-layout:review
  → 0; Wrote 9 corpus and 7 held-out SVGs and tmp/auto-layout-review/index.html.
pnpm auto-layout:eval tmp/human-cases --jobs 8
  → 0; 33/33 completed. All 33 plan hashes match base 917737a.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 0 --split dev --jobs 8
  → 0; 18/18 completed and equivalent; zero fallbacks; zero intrusion.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 8
  → 0; 18/18 completed and equivalent; one fallback; intrusion 11.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures
  → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition/'
  → 0; prints three pre-existing task documents:
    tasks/T027-auto-layout-llm-partition/plan.md
    tasks/T027-auto-layout-llm-partition/report.md
    tasks/T027-auto-layout-llm-partition/review.md
    The pattern matches the task-directory name; no private case/cache/output
    is tracked. These documents also exist at the base and were not changed.
git diff --check
  → 0.
```

The base comparison used a git archive of `917737a` under ignored temporary
storage, compiled against the unchanged workspace dependencies. It did not
switch branches or modify tracked files. Comparison used SHA-256 of serialized
complete plans, including edits, groups and diagnostics.

## Investigation results

### Dev quick-mode crossings

Only dev partition layouts were evaluated. No partitioned val or long-budget
LLM search evaluation was run; those remain Opus's evaluation work.

| Run | Completed | Crossings on 17 common documents | Crossings on all completed | Intrusion | Fallbacks |
| --- | --- | --- | --- | --- | --- |
| Default quick | 18/18 | 225 | 271 | — | — |
| Round 1 tree, three cached samples | 17/18 | 201 | 201 | 1 | 0 |
| Round 2, three cached samples | 18/18 | 195 | 241 | 11 | 1 |
| Round 2, rule-only (`--samples 0`) | 18/18 | — | 285 | 0 | 0 |

Three-sample dev arrangement agreement is 50.22%, versus 45.29% for the same
partitions measured on default quick layouts: +4.93 percentage points, below
Opus's +10-point target. Mean area ratio to the human drawing is 2.859; routed
bends total 444. These remain visible alongside intrusion and symmetry metrics.

The recovered 70-instance document contributes 46 crossings, exactly the default
plan, and 10 intruding devices. The other 17 have one intrusion in total. Thus the
fallback intentionally sacrifices block separation in one document rather than
refusing a layout that the default planner completes; normal partition results
have not become fully mixed.

The reproduced before-run has crossing deltas `+11, +5, +3, +3, +2, +1`
relative to each document's default quick result. The review listed the first
five; this fresh run additionally measured one `+1`. No case identifiers or
case-keyed data are included here; detailed temporary comparisons stay ignored.

- **Largest regression, 37 instances, +11:** default uses stage placement with
  one 22-device stage and four singleton stages (plus an attached device).
  Partition placement makes six functional blocks: input 4, gain 8, two CMFB
  blocks of 3, other 5 and load 4. The estimator puts both CMFB blocks below the
  signal row. A ten-pair symmetry component becomes five local components with
  2/4/1/1/2 pairs; the four recognized groups remain four. Estimated crossings
  are 8, while routed crossings are 31 versus default 20. Disabling side roles
  produces 26 routed crossings. Retaining a single-row candidate in routed
  ranking gives that same 26 without discarding roles or special-casing a case.
  The remaining +6 reflects different block/local placement and symmetry axes.
- **Second largest, 22 instances, +5:** four blocks of 2/3/2/4 devices, ordered
  gain/other/load/other, replace a default seven-device stage and four singleton
  stages. There is no side row, recognized group or symmetry component to trim.
  Removing roles changes nothing. The partition estimator predicts zero
  crossings but routing gives 9; default layered placement routes with 6 before
  refinement and 4 finally. This is block/local geometry interacting with the
  routing and refinement steps, not a side-row or symmetry-loss issue. The
  single-row alternative leaves it unchanged at 9.
- **Third largest, 29 instances, +3:** partition blocks of 3/4/8/2 devices sit in
  logic/switch/output/other order; default stages contain one ten-device stage
  and seven singleton stages. Two recognized groups remain two; a three-pair
  symmetry component becomes separate one-pair and two-pair local components.
  There is no side row, and removing roles leaves 11 crossings unchanged.
  Default quick has 8. The difference is block placement/local axes and their
  resulting routes; the estimator's one crossing does not predict the final 11.
- **Other tied +3, 24 instances:** five blocks of 6/2/3/1/6 devices replace four
  two-device default stages and eight singletons (plus two attached devices). There are no groups or symmetry
  components, and no side row. Removing roles changes 15 crossings to 13 versus
  default 12, showing a direction-role interaction in addition to local block
  placement. This round did not introduce another direction mechanism.

One general mechanism was changed: the `layered` partition candidate retains
one row while the other candidates retain the estimator's row selection. The
existing routed ranking/refinement selects among them. It removes five crossings
from the largest regression and one from another document, for 201 → 195 on the
common documents. With fallback alone the comparable full-dev count would be
247; the final result is 241. Default and arrangement behavior are unchanged.

### Symmetry and partition validation

Three-sample dev results report whole-component symmetry of 20/58 mirrored pairs
and 1/7 axis devices, alongside block-local symmetry of 44/44 mirrored, level and
orientation-mirrored pairs and 7/7 axis devices. Rule-only results have 44/44 local
pairs and 5/5 local axis devices. All six block-symmetry totals were checked against
the sum of their per-document results, and fallback totals against the flags.

The new unit validator changes the oracle's final block membership in 4 of 33
human documents (99 blocks before, 96 after spatial clustering). All 18 dev
reconciled partitions pass with zero planner merges. No LOADBench XML corpus is
available in this worktree, so a corpus-wide LOADBench changed-document count
cannot be supplied. The existing hand-built LOADBench import/validation coverage
passes.

## Deviations and open questions

- No `plan.md` or `review.md` edits were made. Their modified/untracked status was
  present at entry. No commit, push, rebase or branch switch was performed.
- No frozen package, app, router, R10/R23/name-claim implementation, T030-owned
  source, dependency, lockfile or private corpus file was changed.
- The tracked-file grep's expected empty output is not attainable without
  changing unrelated, pre-existing T027 task documentation. Private inputs,
  caches, reports, comparison scripts and the archived base are git-ignored.
- LOADBench corpus measurement and Opus's partitioned val / long-search targets
  remain unmeasured. Rule-only quick crossings (285) exceed default (271), and
  the identified residual quick regressions remain visible in the report.
- The initial full-suite failures were sandbox localhost restrictions; the retry
  with local access passed without code or test changes.
