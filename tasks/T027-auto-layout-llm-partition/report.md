# T027 report — round 1

## Summary

Implemented the offline LLM partition experiment: electrical-only circuit descriptions,
a versioned prompt, strict structured-output schema and partition conversion, an injected
provider runner with one repair turn, caching and usage-based budgeting, and cache-backed
V1/V2 evaluation with titled block boxes and partition metrics. No real API calls were made.
All 33 human-case default layouts remain equal to the supplied baseline, including plan
hashes and result metrics, and electrically equivalent.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | done   | `partition-prompt.ts` whitelists electrical inputs, uses sorted terminal membership for canonical Net tokens, includes classified roles/rails and recognized L0 members/roles, and supports anonymous device ids without display names.                                                                                                                                                                |
| 2    | done   | Prompt version `1`; strict Zod schema in the script; pure `llmResultToPartition` checks complete membership and unique floorplans, applies 240-unit grid pitch, then reuses existing partition validation/L0 merging. Added optional display-only `title` to `LayoutPartition.blocks`.                                                                                                                 |
| 3    | done   | Added the CLI and all planned flags. SDK use stays in `scripts/`; requests use high effort, structured JSON output and server-side fallback. Cache keys include payload, prompt version, model, sample and anonymization. Records response attempts, usage, serving model and stop reason; repairs once with unchanged assistant content.                                                              |
| 4    | done   | Evaluator reads cached LLM results, fails missing/failed samples explicitly, drops arrangement for V1 and retains it for V2, and supports `--block-boxes on                                                                                                                                                                                                                                            | off`. Added human overlap fraction, ARI against H, proposed floorplan agreement and validity/L0 merge counts. Metrics are in a pure evaluation helper. |
| 5    | done   | Synthetic tests cover geometry/drafting/route independence, canonical tokens, anonymity, validation failures, L0 merges, repair, refusal/token-limit stops, double failure, cache reuse, budget/concurrency, credential exclusion and partition metrics. End-to-end CLI tests cover dry run, missing cache, V1/V2 and escaped titles/box visibility. Existing no-partition golden test remains intact. |
| 6    | done   | This report records implementation and offline acceptance. Real pilot/dev/val/LOADBench experiments remain assigned to Opus after review.                                                                                                                                                                                                                                                              |

## Review findings addressed

Round 1; no `review.md` exists for this task.

## Acceptance results

Commands ran on `task/T027-auto-layout-llm-partition`. Local tests used lane 2:
`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`.

```text
pnpm install --frozen-lockfile --offline
  → 0; all 23 workspace projects, already up to date; package files unchanged.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint
  → 0; oxlint: 1964 files, 0 errors, 2873 warnings.
pnpm vitest run packages/auto-layout
  → 0; 20 files passed, 377 tests passed.
pnpm test:local
  → 0 with approved local socket/database access; 757 files passed, 2 skipped;
    7,663 tests passed, 116 skipped (7,779 total).
pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → 1 from grep; no output, as expected (no auto-layout findings).
pnpm build
  → 0; workspace builds completed; existing Vite chunk-size advisory.
pnpm auto-layout:review
  → 0; wrote 9 corpus and 7 held-out SVGs and review index.
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run --split dev
  → 0; 18 jobs, 70,426 aggregate payload bytes, 0 cached entries;
    heuristic two-attempt estimate $6.67296; no SDK client or API call.
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json
  → 0; 33/33 completed, baselineEqual=true and equivalent=true for all;
    dev 18/18 and val 15/15. This is default-layout verification, not an LLM val run.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures
  → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition'
  → 0; only tasks/T027-auto-layout-llm-partition/plan.md (already tracked).
    The new script/source/test files remain untracked for Opus to review and commit.
    No private cases, responses, caches or id-keyed evaluation data are tracked.
```

The first sandboxed full-suite attempt failed on local socket/PostgreSQL access
(`listen EPERM 127.0.0.1`, `connect EPERM` on port 5432): 740 files passed,
17 failed, 2 skipped. An automatically approved rerun with local access passed
757 files and 7,662 tests before the final synthetic evaluator test was added.
The final full-suite rerun includes the integration test and passes 7,663 tests;
the updated auto-layout suite passes all 377 tests.
No tests were weakened or removed.

The unfiltered extra `pnpm deadcode` check exits 1 for findings outside this task
(3 unused files, 47 unused exports, 6 unused exported types). The planned filter
has no auto-layout output. Those unrelated files were left unchanged.

Acceptance logs are in `/tmp/t027-*.log`; private baseline evaluation output remains
in git-ignored `tmp/t027-baseline-eval.log` and `tmp/auto-layout-eval/`.

## Investigation results

No separate investigation step was requested. The installed SDK exposes the planned
beta fallback and structured-output fields; the adapter uses `beta.messages.create`
plus the same Zod schema for text validation, without forced tools, temperature or
thinking-budget overrides. Fake-provider tests check the actual request shape and
unchanged assistant content on repair.

## Deviations and open questions

- No placement, router, R10, R23, `lostNameClaim`, frozen package/app, dependency or
  lockfile changes. `types.ts` changes only the planned optional display title.
  Existing `validatePartition` needed no change; LLM-specific completeness checks
  stay at the adapter boundary.
- Samples are zero-based. Grid coordinates are integers from -16 through 16.
  Unconnected pins are represented by `net: null`.
- The cost estimate is heuristic, not a cap. Budget checks use completed usage;
  already in-flight calls may overshoot. Jobs stopped before their first request
  are not cached; attempted failures are cached and never automatically retried.
- The plan's tracked-file grep also matches its already-tracked task plan by name;
  no private data is present. No staging, commit, push or branch switch occurred.
- Opus still owns real API calls, dev prompt tuning/freeze, the single LLM val run,
  LOADBench comparison and the experiment decision gate. No experimental quality
  claim is made from fake-provider tests or the default-layout baseline check.
