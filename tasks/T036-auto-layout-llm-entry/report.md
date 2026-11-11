# T036 report — round 1

## Summary

Added the injected asynchronous LLM layout entry, a cache-only-by-default script
adapter, and evaluation through `llmPartition`. The package performs no network
access. All 33 default, 18 dev partition and 15 val partition cases completed;
every plan hash matches the saved `3526e33` baseline. All acceptance checks passed
(the local suite required sandbox escalation). Partition validity counts,
statistics and diagnostics also match. No LLM API was called.

## Steps

| Step | Status | Notes                                                                                                                                                                        |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Added `llm-layout.ts` and package exports: concurrent samples, ordered reconciliation, default fallback warning, explicit-partition and no-LLM bypasses.                     |
| 2    | done   | Added `createPartitioner`; cache-only reads use the existing status/schema criteria. API-enabled requests use the existing job scheduler. Verified with fake providers only. |
| 3    | done   | Evaluation awaits `llmPartition`, retaining cached entry metadata, rule-only fallback and the original timed planning call.                                                  |
| 4    | done   | Added seven entry tests and two adapter tests. Package suite: 30 files, 512 tests passed.                                                                                    |
| 5    | done   | Added R141 and updated the public planning entry description.                                                                                                                |

## Review findings addressed

Not applicable: round 1; no `review.md` exists.

## Acceptance results

Every command ran with `ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`
and `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. The command
launcher removed all environment variables containing `API_KEY`, plus
`ANTHROPIC_AUTH_TOKEN` and `OPENAI_TOKEN`. No credentials were set.
Logs and case-keyed comparison artifacts remain ignored under
`tmp/status/t036-round1/`.

```text
pnpm install --frozen-lockfile --offline
  → 0; Already up to date.
pnpm format:check
  → 0; All matched files use Prettier code style! (also passed after the test fix)
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0.
pnpm lint
  → 0; 1992 files, 0 errors, 3088 warnings.
pnpm vitest run packages/auto-layout
  → 0; 30 files passed, 512 tests passed.
pnpm test:local
  → Initial sandbox run: 1; 17 files failed, 754 passed, 3 skipped;
    60 tests failed, 7770 passed, 150 skipped; 2 errors.
    PostgreSQL connect EPERM ::1:5432 / 127.0.0.1:5432 and local listen EPERM.
  → Unrestricted rerun: 0; 771 files passed, 3 skipped;
    7863 tests passed, 117 skipped (7980 total).
pnpm deadcode 2>&1 | grep -E 'llm-layout|auto-layout-llm-partition|auto-layout-eval'
  → No output, as expected; pipeline exit 1 is grep's no-match result.
pnpm build
  → 0; build completed, with the existing large-chunk warning.
pnpm auto-layout:eval tmp/human-cases --jobs 7
  → 0; 33 completed; 33/33 plan hashes equal tmp/status/new.json.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7
  → 0; 18 completed; 18/18 plan hashes equal tmp/status/part-dev.json.
    partitionValidity: reconciled=18, rule-only=0, matching baseline.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split val --jobs 7
  → 0; 15 completed; 15/15 plan hashes equal tmp/status/part-val.json.
    partitionValidity: reconciled=15, rule-only=0, matching baseline.
git status --short apps packages/model packages/derived packages/edit-engine pnpm-lock.yaml package.json
  → 0; empty.
git ls-files tmp | head -1
  → 0; no output.
git diff --check
  → 0.
```

The initial package run found one failure in the new adapter test: the SDK's
structured-output format constructs fresh parser functions, so deep equality of
provider request objects failed despite identical wire data. The assertion now
compares serialized requests; byte-for-byte cache comparison remains in place.
The focused entry/adapter rerun passed all 23 tests, followed by the passing full
package rerun above.

Cache-only tests cover valid, repaired, failed, schema-invalid and absent entries,
assert the injected provider is never called, and verify a miss without an
injected provider produces no cache write. Evaluations explicitly use the
cache-only default and ran without API keys. API-enabled adapter tests use a fake
provider and compare its cache bytes with direct `runPartitionJobs` output.

## Investigation results

No investigation steps were requested. Two interface details needed bridging:

- Partitioner requests carry a prepared payload, while existing jobs carry a
  document/resolver. The scheduler now also accepts prepared-payload jobs and the
  supplied system prompt. Those jobs validate the output schema; the package
  reconciles their answers together. Existing document-based jobs, cache key
  construction, cached sample reads and CLI behavior are preserved.
- Reconciliation diagnostics have `{ check, block, message }`, while layout
  diagnostics require severity/code/rule/message. The layout wrapper maps them
  to R141 `AUTO_LAYOUT_LLM_RECONCILED` warnings, preserving check and block in
  the message. `llmPartition` and evaluation retain the original diagnostics.

## Deviations and open questions

No scope or dependency changes. The required local suite needed sandbox
escalation because its PostgreSQL and local socket tests cannot run inside the
sandbox; the original failed run is recorded above. No tests were removed or
weakened. No browser test was required. No commit, push, branch switch, or edit to
`plan.md`/`review.md` was made.
