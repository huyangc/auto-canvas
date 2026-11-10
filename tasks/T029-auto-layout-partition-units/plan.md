# T029 — Auto-layout: complete sub-component partition from graph units and LLM grouping

- Branch: `task/T029-auto-layout-partition-units`
- Base: `task/T027-auto-layout-llm-partition` at `f23a06d` (stacked on PR #31)
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Rules: R110–R114
- Status: approved

## Goal

The user decided (2026-11-10) how the LLM and the rules divide the work:

- The LLM only partitions the netlist into functional sub-components and names their
  function. It never gives positions, a floorplan or a block order.
- Graph matching (rule recognition) and the LLM are combined to make sub-component
  recognition stronger.
- The rules and annealing do all placement. That is T031, not this task.

The user also raised a concern: an LLM partition can be **incomplete**. It can omit
devices, form disconnected or wrong-size blocks, miss a sub-component, or change between
samples. This task makes the final partition complete and valid **by construction**:

1. Graph rules cut every device into atomic **units**.
2. The rules give a complete fallback partition.
3. The LLM only proposes how to group units, and may report units it is unsure of.
4. Graph checks validate each proposed block.
5. A deterministic merge keeps the valid blocks and completes the rest from the rules.
6. Several samples are combined by consensus.

Every block carries its provenance (`llm`, `attached` or `rule`) and a confidence value.
T030 adds the fingerprint library; T031 uses the partition in placement.

## Context

- **T027 (PR #31, this branch's base)** added the pieces this task changes:
  - `describeCircuit`, the prompt (v3), `llmResultToPartition`, and an LLM schema with
    `floorplan` and `flow`, in `src/partition-prompt.ts`;
  - the cached and budgeted call script `scripts/auto-layout-llm-partition.mjs`, whose
    default provider is `deepseek-flash`;
  - `--partition llm --sample k` in `scripts/auto-layout-eval.mjs`, plus `partitionMetrics`
    (`src/partition-metrics.ts`).

  On 18 dev documents, prompt v3 gave no disconnected blocks; samples agreed at a mean
  ARI of about 0.72, and agreement with LOADBench's functional labels was ARI 0.69.

- **Recognition.** `recognizeSubstructures` (`src/recognize.ts:76`) returns `Structure`s
  with roles (`src/types.ts:68-90`). Its kinds are mirror, differential pair, cross-coupled
  pair, matched pair, pair plus mirror load, and common-gate pair, with tails and finger
  branches. `recognizeStructures` and `persistedTemplates` give templates, and
  `parallelAttachments` (`src/stages.ts:198`) gives R69 attachments.
- **Fallback partition.** `findStages` (`src/stages.ts:87`) gives channel-connected stages:
  the rule partition today.
- **Partition contract.** `validatePartition` (`src/partition.ts:14`) checks
  `LayoutPartition`. It puts devices missing from every block into one `other` block, and
  merges blocks that split an L0 structure.
- **Net roles.** `classifyNets` (`src/net-roles.ts`) gives `byNet` roles, `rails` and
  `pinNet`; `isMosBulk` marks bulk pins.

### Binding constraints (unchanged)

- **Human cases.** The third-party cases stay in git-ignored `tmp/human-cases/`; no
  case, case id or derived id-keyed data is ever committed. Nothing in CI uses them or the
  network.
- **Splits.** Tune on dev; val is evaluated once.
- **Frozen code.** The router, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `edit-engine`, `derived` and `apps/` do not change.
  `packages/auto-layout` stays offline and pure; only `scripts/` call the network.
- **Placement.** Not in scope: placement code (`place.ts`, `stages.ts` placement,
  `search*.ts`, `refine.ts`, `auto-layout.ts`) does not change. T031 owns it.

## Scope

Owned paths:

- New files: `packages/auto-layout/src/units.ts`, `src/partition-reconcile.ts`, and their
  tests.
- `src/partition-prompt.ts`, `src/partition-metrics.ts`, and `src/types.ts` (additions
  only).
- `scripts/auto-layout-llm-partition.mjs`, `scripts/auto-layout-eval.mjs`, and a new
  `scripts/auto-layout-partition-report.mjs`.
- `docs/specs/auto-layout.md`: the experimental partition section and R110–R114.

## Steps

1. **R110 Units (`recognitionUnits`, `src/units.ts`).** A pure, deterministic function
   from a Document and resolver to units that cover **every** non-marker device exactly
   once. A unit is one of:
   - one recognized `Structure`, with its members and roles;
   - one `RecognizedGroup` template or persisted template, with its tail and extra
     members;
   - an R69 parallel attachment, the device together with its host;
   - a single device.

   Overlapping candidates merge with union-find. Each unit records its member ids, its
   kind (the strongest structure kind, otherwise the device class), member roles and
   source. Unit ids are assigned from a canonical order that depends only on topology,
   never on source ids or instance order. Anonymized payloads must not leak order, as
   T027 required.

2. **R111 Rule partition (`rulePartition`).**
   - Map `findStages` onto units; when a unit spans stages, merge them. This is the
     complete fallback.
   - Give each rule block a role by `inferRole`, the first match below:
     1. it contains a differential pair whose gates are on input-role nets → `input`;
     2. it contains a differential pair → `gain`;
     3. it contains a mirror reference or a diode-connected device and no input-role or
        output-role net → `bias`;
     4. it holds a channel pin on an output-role net → `output`;
     5. it contains only switches → `switch`;
     6. it contains logic gates → `logic`;
     7. it contains only capacitors → `compensation`;
     8. otherwise → `other`.

     Titles come from roles, such as "Bias" or "Input stage". Document the rule in the
     spec and test each branch.

3. **R112 LLM grouping of units (prompt v4).**
   - The payload adds `units`: id, kind and members with roles. Devices and nets stay as
     in T027.
   - The prompt asks the model to group **units** into functional sub-components, each
     one connected sub-circuit, and to name each one with a title and a role.
   - The schema becomes
     `{ blocks: {id, title, role, units: string[], reason}[], uncertain: string[] }`, with
     **no `flow` and no `floorplan`**. Units listed in `uncertain` may be left out of all
     blocks.
   - Bump `PROMPT_VERSION`. Remove the floorplan and flow handling from the LLM path.
     T026's `arrangement` option and its human and LOADBench paths stay.

4. **R113 Validation and completion (`reconcilePartition`, `src/partition-reconcile.ts`).**

   Input: the Document, the resolver, and zero or more LLM samples. Output: a complete
   `LayoutPartition`; per-block `provenance`, `confidence` and `unitIds`; diagnostics;
   and statistics. It is pure and deterministic.

   1. **Consensus.**
      - With k ≥ 2 samples, choose the _medoid_ sample, the one with the highest mean ARI
        to the others at unit level. Ties go to the lowest sample index.
      - In each medoid block, keep a unit only if its mean co-assignment with its block
        mates across samples is at least 0.5.
      - Dropped units count as unassigned.
      - With k = 1, every unit is kept. With k = 0, there are no LLM blocks.
   2. **Hard checks per LLM block.**
      - Unknown units are dropped. A unit that is already in an earlier block is dropped
        from the later one.
      - Connectivity: the block's devices must link through non-rail nets, excluding MOS
        bulk pins. A disconnected block keeps its largest component, with ties by unit
        id; other components become unassigned.
      - Size: a block holding more than 50% of the devices **and** more than 12 devices is
        split along the rule partition inside it. Each part keeps the title with a suffix.
      - An empty block is dropped.
   3. **Soft role check.** It applies to `input` (needs a differential pair, or a gate on
      an input-role net), `bias` (needs a diode-connected device or a mirror reference)
      and `output` (needs a channel pin on an output-role net). When the check fails, the
      role becomes `other`, the confidence falls, and a diagnostic is recorded. The title
      stays.
   4. **Completion.**
      - An unassigned unit whose non-rail nets connect to exactly one accepted block
        joins that block (`attached`). Repeat until nothing changes.
      - The remaining units form blocks from the rule partition: rule blocks restricted to
        the remaining units, split into connected components, with `inferRole` roles
        (`rule`).
   5. **Confidence:**
      - `llm` blocks: the medoid consensus share, ×0.5 when the soft role check fails;
      - `attached` blocks: inherit their host block's confidence;
      - `rule` blocks: 0.

   **Statistics:**
   - LLM coverage: the share of devices in `llm` blocks before completion;
   - counts for each check;
   - pairwise sample ARI;
   - the number of blocks by provenance.

   The result must pass `validatePartition` with no L0 merge.

5. **R114 Evaluator and report.**
   - `--partition llm` builds the partition with `reconcilePartition` from the cached
     samples `--samples k` (default 3; missing samples are allowed). With no sample at
     all, it uses the rule partition and records that. `--variant v1` only; V2 needs an
     LLM floorplan, which no longer exists, so the evaluator refuses that combination.
   - Block boxes show the title and role, coloured by provenance: llm purple, attached
     blue, rule grey.
   - Add `scripts/auto-layout-partition-report.mjs <folder> --samples k`. It writes
     `tmp/auto-layout-partition/report.json` with per-document and split totals of:
     - LLM coverage, per-check counts, pairwise sample ARI, and consensus-to-sample ARI;
     - with LOADBench XML: ARI, **block recall** (the share of reference blocks matched by
       a final block at IoU ≥ 0.5), and role match;
     - with a human drawing: the overlap of final blocks in the human picture
       (`partitionMetrics`).
   - The report also writes an HTML page that draws the final blocks on the human drawing.

6. **Tests.** Hand-built, no network:
   - units cover all devices exactly once and never split a structure; they are invariant
     under renaming, instance reordering and moved placements;
   - `rulePartition` is complete, and each `inferRole` branch is covered;
   - consensus with k = 0, 1 and 3, including the medoid choice and a dropped unstable
     unit;
   - each hard check: unknown, duplicate, disconnected, oversized, empty;
   - the soft role check, and completion (attached and rule);
   - the result always passes `validatePartition` with no merges, and is deterministic;
   - the provider and cache tests are updated for the new schema, with no network.

7. **Report**, by Codex: what was built and the test results. Opus runs the real LLM calls
   and adds recognition results.

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
node scripts/auto-layout-partition-report.mjs tmp/human-cases --samples 0          # expected: exit 0; rule-only partitions, no network
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0, default output equals the base
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition/|auto-layout-partition/'  # expected: no output
```

Targets for the real run, which Opus performs (prompt v4, `deepseek-flash`, 3 samples):

- every final partition is complete, connected, and has no L0 split, on both splits;
- LLM coverage ≥ 80% on dev and val;
- on LOADBench, block recall ≥ 0.70 and ARI ≥ 0.69;
- consensus-to-sample ARI ≥ the pairwise sample ARI.

## Notes for the implementer

- One general mechanism per step. Never key anything to a case, Reference or instance id.
- Make no network call from `packages/auto-layout` or from any test.
- The thresholds (0.5 consensus, 50% / 12 devices size) are starting values. Keep them as
  named constants.
