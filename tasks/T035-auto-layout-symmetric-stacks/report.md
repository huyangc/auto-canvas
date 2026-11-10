# T035 report — round 1

## Summary

Implemented R140 placement-only symmetric stacks. Blocks in one whole-document
R88 component join transitively when their own members share a non-rail Net on
R50 conducting pins. Placement and annealing use the derived partition;
validation, scoring, fallback, records and metrics retain the supplied partition.
The existing conducting-pin helper is exported unchanged.

All dev quick targets are met: 49/58 mirrored pairs, 257 crossings, 44/44 local
pairs, zero floating/missing connections, no fallbacks, and total width 20,595
versus 22,683. All 33 default-mode plan hashes match the fresh baseline.

## Steps

| Step | Status | Notes                                                                                                                                                                                                          |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Added `placementPartition` with transitive joins, stable first-block metadata/member order, common roles and deduplicated flow; identity returns for no joins/default/arrangement.                             |
| 2    | done   | Derived once in each placement/move-generator call. All placement partition reads, including four attachment-related `partitionDocuments` calls, use it.                                                       |
| 3    | done   | Seven synthetic tests cover joins, metadata, unchanged paths, gate/rail exclusions, quick/search determinism, shared symmetry, a beside-positioned gate-driven R88 pair, and nonzero supplied-block intrusion. |
| 4    | done   | Existing `partition.test.ts` passes unchanged, including its V2 plan hash. No existing test expectations changed.                                                                                              |
| 5    | done   | Added R140 after R134; amended R130a, R132 and Known limits.                                                                                                                                                   |
| 6    | done   | Fresh base/result dev quick, val quick, dev search and default runs completed sequentially on the same machine; cached samples only. Reports and aggregate stack counts are in `tmp/t035/result/`.             |

## Review findings addressed

Round 1; no `review.md` was present.

## Acceptance results

All commands used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`, and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
Logs are under `tmp/t035/result/`.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files
pnpm typecheck → 0
pnpm lint → 0; 0 errors (existing warnings remain)
pnpm vitest run packages/auto-layout → 0; 29 files, 503 tests passed
pnpm test:local → initial sandbox run 1; localhost TCP listen/connect EPERM
  Final rerun with localhost/PostgreSQL access → 0; 770 files passed, 3 skipped;
  7,854 tests passed, 117 skipped (test-local-unrestricted.log).
pnpm deadcode 2>&1 | grep -E 'partition|stages|search-moves|place\.ts'
  → 1 from grep because there were no matching lines; expected filtered output is empty
pnpm build → 0
pnpm auto-layout:review → 0; 9 corpus and 7 held-out SVGs generated
pnpm auto-layout:eval tmp/human-cases --jobs 7
  → base 0, 33 completed; result 0, 33 completed
  Result additionally used --baseline tmp/t035/result/variant-base-default.json:
  33/33 baselineEqual=true and 33/33 equal planHash values.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7
  → base 0 and result 0; 18 completed each
Same partition command with --split val → base 0 and result 0; 15 completed each
Same dev partition command with --search 30 → base 0 and result 0; 18 completed each
git status --short packages/model packages/derived packages/edit-engine apps scripts fixtures docs/agent pnpm-lock.yaml package.json
  → 0; empty
git ls-files | grep -E 'human-cases|llm-partition|auto-layout-eval/|^tmp/'
  → 0; four pre-existing tracked paths (see below), so the expected empty output is not met
git diff --check → 0
```

The last grep also matches these legitimate repository filenames, identically on
`5d27471` (`git ls-tree -r --name-only 5d27471` with the same filter):

```text
scripts/auto-layout-llm-partition.mjs
tasks/T027-auto-layout-llm-partition/plan.md
tasks/T027-auto-layout-llm-partition/report.md
tasks/T027-auto-layout-llm-partition/review.md
```

No human drawings, cached samples, evaluation artifacts or `tmp/` files are tracked.
The check was run as written; these out-of-scope files were left unchanged.

## Investigation results

The initial tree differed from `5d27471` only by this task's plan. Built that tree
and completed all four baseline evaluations before rebuilding the implementation.
Neither branch switching nor source replacement was needed. Each evaluation ran
with seven jobs; baseline and result evaluations did not overlap. All LLM
partition runs used the cache-reading evaluator; no provider calls or API keys.
An initial report-copy path typo was corrected by copying each completed report
from `tmp/auto-layout-eval/v1-llm-3-samples-3/` before its next overwrite.

Quick results (width rounded; area is the median instance-area ratio to the human
drawing; intrusion uses supplied validated blocks):

| Split / variant | Completed | Crossings | Mirrored pairs | Local pairs | Width sum | Intrusion | Median area | Floating | Missing | Fallbacks |
| --------------- | --------: | --------: | -------------: | ----------: | --------: | --------: | ----------: | -------: | ------: | --------: |
| Dev base        |        18 |       239 |          20/58 |       44/44 |    22,683 |        11 |        2.86 |        0 |       0 |         1 |
| Dev result      |        18 |       257 |          49/58 |       44/44 |    20,595 |        50 |        2.82 |        0 |       0 |         0 |
| Val base        |        15 |       274 |          15/29 |       29/29 |    19,685 |         5 |        2.29 |        1 |       1 |         1 |
| Val result      |        15 |       281 |          21/29 |       29/29 |    19,588 |        13 |        2.16 |        1 |       1 |         0 |

Additional quick totals and per-drawing medians:

| Split / variant | Crossings median | Bends sum / median | Wire sum / median | Width median | Intrusion median |
| --------------- | ---------------: | -----------------: | ----------------: | -----------: | ---------------: |
| Dev base        |                8 |         445 / 23.5 |   134,220 / 5,270 |     1,164.04 |                0 |
| Dev result      |                9 |           437 / 23 |   124,630 / 5,405 |     1,111.22 |                0 |
| Val base        |                7 |           416 / 23 |   145,770 / 8,020 |     1,091.13 |                0 |
| Val result      |                7 |           414 / 22 |   145,550 / 8,020 |     1,111.13 |                0 |

Joined stacks, after normal validation and before placement:

| Split | Drawings with joins | Stacks | Original blocks joined | Stack sizes (blocks → count) |
| ----- | ------------------: | -----: | ---------------------: | ---------------------------- |
| Dev   |                   6 |      6 |                     23 | 2 → 2; 4 → 2; 5 → 1; 6 → 1   |
| Val   |                   3 |      3 |                      7 | 2 → 2; 3 → 1                 |

Dev search (`--search 30`, report only):

| Variant | Crossings | Mirrored pairs | Local pairs | Floating / missing | Fallbacks |
| ------- | --------: | -------------: | ----------: | -----------------: | --------: |
| Base    |       169 |          16/58 |       44/44 |              0 / 0 |         1 |
| Result  |       197 |          49/58 |       44/44 |              0 / 0 |         0 |

Deadline-based search counts are measurements of these runs, not fixed-budget
reproducibility assertions. Synthetic fixed-seed/evaluation-budget tests prove
repeatable edits. Default mode stayed at 271 crossings and 58/58 pairs on dev,
310 crossings and 29/29 on val, with all 33 plan hashes identical.

Saved reports: `variant-base-{dev,val,search,default}.json` and
`variant-result-{dev,val,search,default}.json`; aggregate-only measurement files
are `aggregate-metrics.json` and `stack-counts.json` in `tmp/t035/result/`.

## Deviations and open questions

- The plan mentions three `partitionDocuments` calls, but the baseline has four;
  all four were updated as required by its instruction to replace every placement
  read, including the attachment frozen-set calculation.
- The tracked-file grep cannot yield the stated empty output because of existing
  source/task filenames. No out-of-scope repair was attempted.
- The first full test run was restricted by the sandbox's localhost policy;
  the permitted rerun passed in full.
  It also caught an invalid new test assumption: planner validation can merge L0
  units before measuring intrusion. The corrected synthetic fixture explicitly
  verifies validation preserves its supplied blocks and proves positive reported
  intrusion while the derived single block has zero intrusion.
- Higher intrusion and some extra crossings are the selected symmetry-first
  tradeoff. R131/R134 and all default/arrangement behavior were left unchanged.
- No commits, branch changes, dependency changes, generated-file edits, or
  provider API calls were made.
