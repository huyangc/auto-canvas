# T027 — Auto-layout: LLM block partition and coarse floorplan (experiment)

- Branch: `task/T027-auto-layout-llm-partition`
- Base: `task/T026-auto-layout-oracle-blocks` at `a7a1692` (stacked on PR #28)
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`); no browser
  test is expected.
- Status: approved

## Goal

T026 showed that a good partition with a good floorplan reaches human block structure at
no wiring cost: arrangement agreement 94–95% against about 40% today, and 606 crossings
against 616. A partition with a naive floorplan costs 12–20% more crossings.

This task asks: **can an LLM, reading only the netlist, supply both the partition and a
coarse floorplan well enough to get that benefit?**

The user decided (2026-11-09) that:

- netlists, including the third-party evaluation cases, may be sent to an LLM API;
- block boxes are drawn with names, behind a switch.

This task is an experiment. Without a partition, planner output stays byte-identical. The
LLM only proposes grouping and order. It never changes connectivity, and every result
still goes through the existing transaction and equivalence checks.

## Context

### Reuse from T026

`AutoLayoutOptions.partition`, `validatePartition` (`src/partition.ts:14`), the V1 and V2
placement paths, and the evaluator's block metrics and dashed overlays. V1 is used when a
partition has no `arrangement`; V2 when it has one.

### What the netlists contain

Measured on the 33 human cases:

- 715 Nets. None has a `name` field. 253 are Cell terminals and 101 carry net labels.
  **405 (57%) have only generated ids**, so the LLM must rely on structure as much as on
  names.
- Net ids such as `net-power-gnd1` and `net-cell-pin-vdd1` leak drawing-tool provenance.
- 18 documents have drafting text, for example a box titled "Bias Network". That is
  drawing content, not netlist, and must never reach the prompt.
- A compact netlist is small: a median of about 1.3k characters, 5.8k at most.

### API facts

- SDK: `@anthropic-ai/sdk`. Root dev dependencies `@anthropic-ai/sdk@1.6.0` and
  `zod@4.4.3` are added with this plan, so `--offline` installs work.
- Model `claude-opus-5-5`, `output_config.effort: "high"`. Thinking is always on for this
  model: do not send `budget_tokens`, or `thinking: {type: "disabled"}`, or `temperature`.
- JSON output: `output_config.format` with `zodOutputFormat` from
  `@anthropic-ai/sdk/helpers/zod`. Forced `tool_choice` returns a 400 on this model, so do
  not use it. Dictionaries with arbitrary keys are not expressible in strict schemas, so
  use arrays.
- Enable server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and record `response.model`, because a fallback changes which
  model is being measured. Always check `stop_reason` (`refusal`, `max_tokens`) before
  reading output.
- If the beta `parse` helper does not accept this combination, call
  `client.beta.messages.create` with `output_config.format` and validate the text with
  the same Zod schema.
- Use the SDK's retries and typed errors; do not string-match errors.
- Prompts are small, so prompt caching is not used.

### Binding constraints

- **Human cases.** Git-ignored only. Never commit a case, excerpt, case id, response or
  id-keyed data; caches stay in `tmp/`. Nothing in CI or `pnpm test:local` may call the
  network or depend on them.
- **Credentials.** Read from the environment or SDK profile only. Never logged, never
  written to a file.
- **Splits.** Prompt changes are tuned on dev only. Val runs once, with the frozen prompt.
- **Frozen code.** The router, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `packages/edit-engine`, `packages/derived` and `apps/` do not change.
- **`packages/auto-layout` stays offline and pure.** Only `scripts/` imports the SDK.
- **Concurrent work.** T025 (symmetry axis, lane 1) touches `place.ts`, `stages.ts`,
  `types.ts`. Avoid editing them; this task should need no placement changes.

## Scope

Owned paths:

- `packages/auto-layout/**`: new `partition-prompt.ts`, small additions to `partition.ts`
  and `types.ts`
- `scripts/auto-layout-llm-partition.mjs` (new), `scripts/auto-layout-eval.mjs`
- `docs/specs/auto-layout.md`: the experimental section only
- `package.json`, `pnpm-lock.yaml`: already changed by the plan commit; do not change them

**Codex makes no API calls.** It builds and tests everything with an injected fake
provider. Opus runs the real calls after review, in the order under Experiment procedure.

## Steps

1. **Netlist description (`describeCircuit`), pure and tested.** From a Document and
   resolver, produce a JSON payload:
   - devices: id, device class, symbol, and each pin's canonical Net token;
   - Nets: canonical tokens `N1…` assigned deterministically from topology, never from
     source ids; a display name only when one comes from a Cell terminal or a net or
     power label; role and rail from `classifyNets`;
   - L0 structures from the recognizer, with members and roles.

   It must contain **no** coordinates, orientations, Routes, drafting objects, annotation
   positions or layout groups.

   Add an `anonymize` mode that renames devices to `D1…` and drops display names.

2. **Prompt and schema.** A versioned system prompt in `partition-prompt.ts` with a
   `PROMPT_VERSION`. It states the task, the roles in `BlockRole`, drawing conventions
   (signal left to right, supply on top, ground below, bias beside its consumers) and
   that L0 structures stay whole. Any example must be hand-written and synthetic. The
   payload is sent as data, delimited from the instructions.

   Output schema:

   ```ts
   {
     blocks: { id: string; title: string; role: BlockRole; members: string[]; reason: string }[];
     flow: string[];                                    // signal blocks, left to right
     floorplan: { block: string; column: number; row: number }[]; // small grid, one per block
   }
   ```

   Add `llmResultToPartition`, which validates the result and maps `floorplan` to
   `arrangement` by fixed pitch. Extend `LayoutPartition.blocks` with an optional `title`
   for display only.

   Validation errors, in addition to `validatePartition`:
   - a device listed in no block or in several;
   - an unknown id;
   - a block missing from `floorplan`, or listed twice;
   - two blocks on one grid cell.

3. **Call script.** `scripts/auto-layout-llm-partition.mjs <folder>` with `--split`,
   `--limit`, `--samples <n>`, `--anonymize`, `--max-usd <n>`, `--concurrency <n>`
   (default 6) and `--dry-run` (prints payload size and cost estimate, no calls).
   - **Repair.** On validation failure, send one repair turn listing the errors, with the
     assistant content passed back unchanged. If it still fails, record the failure and
     move on.
   - **Cache.** `tmp/llm-partition/<sha256(payload, PROMPT_VERSION, model, sample, anonymize)>.json`
     stores the output, attempts, usage, `stop_reason` and serving model. A cached entry
     is never re-requested.
   - **Budget.** Keep a running cost from `usage` at $4 and $20 per MTok, and stop starting
     new calls at `--max-usd`.
   - The provider is injected, so tests use a fake.

4. **Evaluator.** Add to `scripts/auto-layout-eval.mjs`:
   - `--partition llm` with `--sample <k>` and `--anonymize`, reading the cache. A missing
     entry is reported as a failed document, never silently dropped. `--variant v1` drops
     the LLM floorplan; `--variant v2` uses it.
   - `--block-boxes on|off` (default on). Boxes show `title` and role when present. This is
     the evaluation form of the switch the user asked for; the editor switch comes when
     block placement ships.
   - Partition metrics per document:
     - **human overlap**: pairwise overlap of block boxes _measured in the human drawing_
       as a share of total block area, a threshold-free test of whether the blocks are the
       ones a person drew;
     - **ARI** against the H partition (secondary, because H is coarse);
     - **floorplan agreement** with human block relations;
     - validity: valid first try, repaired, failed, and L0 merges.

5. **Tests.** Hand-built, no network:
   - moving parts, or adding routes or drafting text, leaves the payload byte-identical;
   - no coordinate or drafting text can appear in a payload;
   - Net tokens do not depend on source ids or instance order;
   - anonymize removes names and device ids;
   - each validation error above is caught; a repair turn fixes a fake bad answer;
   - a refusal, a `max_tokens` stop and a double failure are recorded, not thrown;
   - a cache hit makes no provider call; the budget stops new calls;
   - no credential appears in any written file;
   - without a partition, output equals the base.

6. **Report**, by Codex: what was built, and test results. The experiment results are added
   by Opus after the real run.

## Experiment procedure (run by Opus after review)

1. **Pilot:** 3 dev documents. Read the blocks and titles by eye, and fix the prompt.
2. **Dev:** all 18 with 3 samples each (stability), then 1 anonymized pass (dependence on
   names). Prompt changes happen here only, and bump `PROMPT_VERSION`.
3. **Freeze** the prompt, then run **val** once (15 documents).
4. **LOADBench:** 30 topologies chosen by hash. Compare with `partitioning.xml` (ARI and
   role match) as an independent functional ground truth.
5. Run the layout variants and compare V0, V1-H, V2-H, LLM-V1 and LLM-V2, on dev and val
   separately, with all T026 metrics. Render human | V0 | LLM-V1 | LLM-V2 with titled boxes.

**Decision gate** (for the report; not an acceptance condition). Continue to block-level
optimization if, on both splits, LLM-V2:

- reaches arrangement agreement of at least 75%;
- has no block overlap;
- stays within +5% of V0 crossings;
- fails on no more than 10% of documents.

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
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run --split dev   # expected: exit 0, no network
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0, equals base
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition'  # expected: only the script and its source files, no data
```

## Notes for the implementer

- One general mechanism per step. Never key anything to a case, Reference or instance id.
- Do not add a network call to `packages/auto-layout` or to any test.
- If a limit in this plan blocks you, report it rather than working around it.
