# T036 — Auto-layout: LLM partition in the layout entry

- Branch: `task/T036-auto-layout-llm-entry`
- Base: `main` at `3526e33` (T035 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. Nothing else is in
  flight in `packages/auto-layout` or `scripts/auto-layout-*`. No browser test is
  expected.
- Rules claimed: R141 (LLM layout entry).
- Status: approved

## Goal

Today the LLM partition exists only inside the evaluation script: `auto-layout-eval.mjs`
reads cached samples, reconciles them and passes `options.partition` to
`planAutoLayout`. The user wants the LLM in the main flow. After this task
`@icm/auto-layout` exports one asynchronous layout entry that asks an injected LLM
partitioner for function blocks, reconciles them and plans with that partition, falling
back to the default plan when no answer is usable. The evaluation script uses that entry,
so what is measured is what a caller gets. The editor UI is not part of this task (the
user chose "close to the layout entry").

No output changes: for the cached samples, the partition-mode evaluation gives the same
plan hashes as `3526e33`, and default mode is untouched. This task makes **no LLM API
call**.

## Context

Everything below was verified on `3526e33`. Paths are relative to the repository root.

### 1. Where the LLM path lives today

- `packages/auto-layout/src/partition-prompt.ts`: `PROMPT_VERSION = "4"` (`:13`),
  `BLOCK_ROLES` (`:15`), `PARTITION_SYSTEM_PROMPT` (`:28`), `describeCircuit(document,
resolver, anonymize, entries)` (`:45`, the user payload), `LlmPartitionResult` (`:157`),
  `llmResultToPartition` (`:169`, reconciles one answer).
- `packages/auto-layout/src/partition-reconcile.ts:88`: `reconcilePartition(document,
resolver, results, entries)` merges up to k answers into one validated partition
  (consensus, completion by rule units). With no answers it returns a rule-only partition.
- `scripts/auto-layout-llm-partition.mjs` (the only network code):
  - `PROVIDERS` (`:30`): `deepseek-flash` over the OpenAI protocol, key from
    `SYSTEM_GENERAL_API_KEY`; `claude-opus-5-5` through the Anthropic SDK.
  - `cacheKey(payload, sample, anonymize)` (`:69`) hashes
    `[payload, PROMPT_VERSION, MODEL, sample, anonymize]`; `readCachedPartition` (`:74`),
    `cachedSamples` (`:87`, read-only, never calls an API).
  - `inputMessage` (`:124`) wraps the payload in `<circuit-data>…</circuit-data>`.
  - `openaiProvider` (`:147`), `sdkProvider` (`:208`), `validateCachedResult` (`:215`).
  - `runPartitionJobs(jobs, { provider, cacheDirectory, concurrency, maxUsd })` (`:227`):
    cache first, coalesced keys, one repair turn, budget and concurrency, never caches a
    call without an answer, never persists credentials or provider error bodies.
  - `main` (`:388`): the CLI; tests in `packages/auto-layout/test/partition-provider.test.ts`
    and `fingerprint-mine.test.ts` import this module.
- `scripts/auto-layout-eval.mjs`:
  - imports `cachedSamples` (`:3`);
  - with `--partition llm` (`:308`–`:330`): `cachedSamples(document, resolver, samples,
anonymize)` → `reconcilePartition(document, resolver, cached.samples)` → partition,
    with `partitionValidity`/`partitionStatistics` measurements; status `rule-only` when
    no sample is cached;
  - plans with `planAutoLayout(document, resolver, layoutOptions)` (`:404`), timed;
  - `evaluateFile` (`:244`) is synchronous and runs in a worker (`:570`).
- `planAutoLayout` (`packages/auto-layout/src/auto-layout.ts:61`) already validates a
  partition and applies R134 fallback. `packages/auto-layout/src/index.ts` is the package
  export list.

### 2. Rules that bind this task

- [Confirm before LLM API use](../../docs/workflow.md#规则): no command in this task may
  call an LLM API. Every run reads `tmp/llm-partition/`. Do not set any API key.
- Human cases and cached samples stay git-ignored; never commit a case, excerpt, id or
  cache entry.

## Scope

Owned paths (may be created, edited or deleted):

- new `packages/auto-layout/src/llm-layout.ts`, `packages/auto-layout/src/index.ts`
  (exports)
- `scripts/auto-layout-llm-partition.mjs` (a partitioner adapter over the existing job
  code; existing exports keep their behaviour)
- `scripts/auto-layout-eval.mjs` (`--partition llm` goes through the entry)
- new `packages/auto-layout/test/llm-layout.test.ts`; additions to
  `packages/auto-layout/test/partition-provider.test.ts`
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- `partition-prompt.ts` (prompt text, payload, `PROMPT_VERSION`), `partition-reconcile.ts`,
  placement, routing and scoring code;
- `planAutoLayout`'s signature and behaviour;
- `apps/`, `packages/model`, `packages/derived`, `packages/edit-engine`, `pnpm-lock.yaml`,
  dependencies.

## Steps

1. **`llm-layout.ts`.** Export:
   - `type LlmPartitioner = (request: { system: string; payload: ReturnType<typeof
describeCircuit>; sample: number; anonymize: boolean }) => Promise<LlmPartitionResult
| undefined>`; `undefined` means no usable answer.
   - `async function llmPartition(document, resolver, llm)`, with `llm = { partitioner,
samples = 3, anonymize = false, entries = [] }`: build the payload once with
     `describeCircuit`, request samples `0…samples-1` concurrently, treat a rejected
     promise as no answer, reconcile the usable answers in sample order with
     `reconcilePartition`, and return `{ partition | undefined, statistics, diagnostics,
samples: [{ sample, status: "answered" | "missing" }] }`. No usable answer returns no
     partition (not a rule-only one).
   - `async function planAutoLayoutWithLlm(document, resolver, options = {})`, where
     `options` is `AutoLayoutOptions & { llm?: … }`: without `llm`, or when
     `options.partition` is already given, return `planAutoLayout(document, resolver,
options)` unchanged. Otherwise call `llmPartition`; with a partition, return
     `planAutoLayout(document, resolver, { ...options, partition })` with reconciliation
     diagnostics appended; without one, return the default plan plus a warning
     `AUTO_LAYOUT_LLM_UNAVAILABLE` (rule `R141`) that names no provider detail.
   - Identical partitioner answers give byte-identical results.
     Export the three from `index.ts`.

2. **Script partitioner.** In `auto-layout-llm-partition.mjs` export
   `createPartitioner({ cacheDirectory, allowApi = false, provider, concurrency, maxUsd,
entries })` returning an `LlmPartitioner`. With `allowApi` false it reads the cache
   only, exactly as `cachedSamples` judges an entry (valid status and schema); it never
   constructs a provider. With `allowApi` true it runs one job through the existing
   `runPartitionJobs` logic (cache, repair, budget, coalescing). Keep `cacheKey`,
   `cachedSamples`, `runPartitionJobs` and the CLI unchanged, so every existing cache entry
   stays valid.

3. **Evaluation through the entry.** In `auto-layout-eval.mjs`, `--partition llm` builds a
   cache-only partitioner and calls `llmPartition` (making `evaluateFile` async is fine;
   the worker awaits it). Keep the existing measurements: `partitionValidity.status` is
   `reconciled` when at least one sample answered and `rule-only` otherwise, and the
   rule-only case still plans with `reconcilePartition(document, resolver, [])` as today,
   so reports are unchanged. The timed `planAutoLayout` call stays as it is.

4. **Tests.**
   - `llm-layout.test.ts` with a fake partitioner over a synthetic Document: three
     answers reconcile into the same partition as `reconcilePartition` on the same
     answers; a rejected or `undefined` sample is skipped; no answers give the default
     plan and the warning; an explicit `options.partition` bypasses the partitioner (it
     is never called); without `llm` the result equals `planAutoLayout`; repeated calls
     are byte-identical; the request carries `PARTITION_SYSTEM_PROMPT` and the
     `describeCircuit` payload.
   - `partition-provider.test.ts`: a cache-only partitioner returns cached valid answers,
     returns `undefined` for missing and failed entries, and never calls the provider; an
     API-allowed partitioner with a fake provider writes the same cache entry as
     `runPartitionJobs`.

5. **Spec.** Add **R141 — LLM layout entry** after R140: the entry, the partitioner
   contract, sample reconciliation, fallback and warning, bypass rules, and that the
   package itself performs no network access.

## Acceptance

Run from the repository root, with the lane-1 variables set and no API key in the
environment; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'llm-layout|auto-layout-llm-partition|auto-layout-eval'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7   # expected: exit 0, 18 completed
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split val --jobs 7   # expected: exit 0, 15 completed
git status --short apps packages/model packages/derived packages/edit-engine pnpm-lock.yaml package.json   # expected: empty
git ls-files tmp | head -1                           # expected: no output
```

Behavioral checks:

- Partition-mode reports for dev and val have the same per-case `planHash` as
  `3526e33`'s (Opus saved them as `tmp/status/part-dev.json` and `part-val.json`), and
  the same `partitionValidity.status` counts.
- Default-mode plan hashes equal `tmp/status/new.json` (also `3526e33`).
- No request leaves the machine: show it with the cache-only test and by running the
  evaluations with no key set.

## Notes for the implementer

- **The package stays offline.** `@icm/auto-layout` imports no SDK, no `fetch` and no
  file system for this feature; the partitioner is injected.
- **Do not change the prompt or the payload.** The next task changes the prompt; cache
  keys must stay valid here.
- **No LLM calls.** Never run the partition CLI without `--dry-run`, never set
  `SYSTEM_GENERAL_API_KEY` or an Anthropic key.
