# T036 review

## Round 1 — accepted

Reviewed: `git diff 3526e33` on `task/T036-auto-layout-llm-entry` after round 1;
acceptance rerun by Opus with no API key in the environment.

`planAutoLayoutWithLlm` and `llmPartition` (`packages/auto-layout/src/llm-layout.ts`)
match R141: one `describeCircuit` payload, concurrent samples, rejected or missing
samples skipped, `reconcilePartition` over the answers in sample order, default plan plus
`AUTO_LAYOUT_LLM_UNAVAILABLE` without an answer, and a bypass for an explicit partition or
no `llm` option. The package stays offline; `createPartitioner` in the script reads the
cache only unless `allowApi` is set. The evaluation goes through the entry with
unchanged reports. Existing tests are unchanged; the one assertion Codex rewrote was in
its own new test.

| #   | Severity | Where                                                       | Finding                                                                                                                                                                   | Expected fix                                                                                                                   |
| --- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | note     | `scripts/auto-layout-llm-partition.mjs` `createPartitioner` | With `allowApi`, each sample runs its own `runPartitionJobs`, so `maxUsd` and `concurrency` apply per call, not across a whole run. The CLI's shared budget is unchanged. | Accepted for now: batch resampling keeps using the CLI. Share one budget across calls before a product caller enables API use. |
| 2   | note     | prepared-payload jobs                                       | Validation without a Document checks the wire schema only. `llmResultToPartition` already returns no semantic errors, so the repair turn behaves as before.               | None.                                                                                                                          |

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (30 files, 512 tests)
pnpm test:local → 0 (771 files passed, 3 skipped; 7863 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'llm-layout|auto-layout-llm-partition|auto-layout-eval' → no output
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; planHash equal to 3526e33 on 33 of 33
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7 → 0; 18 of 18 equal; 18 reconciled
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split val --jobs 7 → 0; 15 of 15 equal; 15 reconciled
protected paths → empty; no tracked tmp files
```
