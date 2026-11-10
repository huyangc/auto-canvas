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

### Round 2 amendment (after review round 1)

**Amended step 1, R110 units.** A unit is a set of devices that are drawn together. Build
units from **candidate relations**, never from greedy picks:

1. **Candidate relation groups.** Each group is a set of devices. The groups are:
   - every `Structure` from `recognizeSubstructures`, and every `Ambiguity` instance set;
   - every **pair** satisfying R5/R68's matched, differential, mirror, cross-coupled and
     common-gate predicates. Enumerate all candidate pairs in `units.ts`, not
     `recognizeStructures`' greedy selection;
   - persisted templates;
   - every R69 parallel attachment, for each eligible host.
2. **Restrict each group to stages.** Restrict each group to the devices of one
   `findStages` stage, so a group spanning several stages yields one piece per stage.
3. **Split by connectivity.** Within each piece, connect members that share a non-rail
   net, excluding MOS bulk pins, and take the connected components.
4. **Union.** Union the components across all groups with union-find. Every device not
   covered becomes a singleton.

Each unit is then:

- independent of source ids and instance order;
- inside one stage;
- internally connected through non-rail nets.

So connectivity checked between units in R113 is exact.

A multi-output bias mirror therefore splits: its reference is a unit in the bias stage, and
each output joins the units of its own stage. Tests:

- the ambiguous-bank renaming test and the rail-only matched-pair test;
- a multi-output mirror whose outputs are tails of two stages: the reference and the
  outputs end up in different units;
- the invariant that every unit lies in one stage and is internally connected.

**Amended acceptance.** The stale `--baseline tmp/auto-layout-eval/baseline.json` line is
replaced. Run `pnpm auto-layout:eval tmp/human-cases`; Opus compares its default output with
the T027 head, recorded in `tmp/t027-results/{dev,val}/v0`.

### Round 3 amendment (after review round 2)

**Amended stage map (R110 step 2 and R111).** Stages come from `findStages(devices,
resolver, roles, tailGroups)`, called the same way in `recognitionUnits` and
`rulePartition`. `tailGroups` has one group per `differential-pair` or
`differential-pair-mirror-load` structure from `recognizeSubstructures`; the group joins the
pair's input devices with the structure's `tail` member or members. No other relation joins
stages: mirrors, matched pairs and the rest do not.

A pair therefore keeps a two-terminal current-source tail, which has no conducting channel
and would otherwise fall into a stage of its own. A multi-output bias mirror still splits by
stage.

**Contract boundary with the planner validator.** `validatePartition` (`src/partition.ts`,
T026) is outside this task. It still merges any greedy `recognizeStructures` group that
spans blocks, because the partition placement path places such a group as one template.
T031 replaces that merge: the validator will use recognition units as its atomic groups, and
placement will trim groups to block members.

Until then, the line between T029's contract and the planner's is:

- **T029's invariants hold on the partitions that `reconcilePartition` and `rulePartition`
  return:** complete, no unit split, every block internally connected. Tests assert them
  there.
- **A merge by the planner validator is reported, not rejected.** Its warning
  `L0 structure split …; merged into …` counts as a planner merge. Error diagnostics still
  reject.
- **The partition report** shows planner merges per document and in total, on both splits.
  A document is rejected only for error diagnostics or a broken T029 invariant.

**Amended completion (R113 attach).** An unassigned unit attaches to an accepted block only
when every unit adjacent to it through a non-rail net lies in that one block; that is, it is
a leaf of the block. Waves repeat until nothing changes.

The current rule is weaker: a unit attaches when it is adjacent to exactly one block. Wave
after wave, that rule can pull whole stages the LLM left out into one block, and they should
become rule blocks instead. Test: an LLM proposal that covers only the input stage of a
two-stage amplifier leaves the second stage to rule blocks, while a shunt capacitor whose
only neighbour is that block attaches to it.

### Round 4 amendment (after the PR review of `c24e2da`)

Rounds 1–3 are committed. This round changes only `src/units.ts` (`canonicalOrder`),
`src/partition-metrics.ts`, their tests and the spec sentences for them. T030 and T031 build
on this branch and edit other parts of `units.ts`: change nothing outside `canonicalOrder`
there.

**1. Canonical ordering prunes equivalent branches (R110).** `canonicalOrder` branches on
every member of a tied colour cell and skips only exact twins. With k identical branches
that have private nets it explores k! leaves. Measured on this branch: 8 isolated resistors
take 1.1 s, and a mirror with 7 outputs takes 0.18 s; each further branch multiplies the
time by k. A bias mirror with 12 outputs would not finish.

Add orbit pruning that is sound:

- **Prefix.** Each search node knows the vertices individualized on the way to it.
- **First leaf.** For a member of the tied cell, individualize it and refine; at every later
  tied cell take the first member, until the colouring is discrete. That gives a leaf order
  and its certificate key.
- **Skip rule.** Skip member `b` when an already explored member `a` of the same cell has a
  first leaf with the same key, and the vertex map π that sends the vertex at each position
  of `a`'s leaf to the vertex at that position of `b`'s leaf has π(`a`) = `b` and π(v) = v
  for every prefix vertex.
- **Why it is sound.** Equal keys make π an automorphism of the labelled graph. It fixes
  the prefix and maps `a` to `b`, and refinement depends only on the graph and the
  individualized sequence. So the two subtrees give the same set of certificates.
- **Otherwise** explore the member fully, as today.

The result is still the minimum certificate, and it does not depend on input order.

Tests, each on `canonicalDevices` and on the anonymized `describeCircuit` payload:

- 16 isolated identical resistors and a mirror with 16 outputs on private nets each finish
  inside the default test timeout. Today neither finishes.
- A ring of 12 identical inverters, which has only rotations as automorphisms, keeps a
  correct result.
- For each fixture, renaming and reordering the instances leaves the payload unchanged.
- Two fixtures that differ in one connection give different payloads.
- The existing ordering tests pass unchanged.

**2. Agreement on labelled devices only (R114).** A LOADBench reference can label only some
devices. `partitionMetrics` then compares partitions of different universes, and
`adjustedRandIndex` needs the same universe on both sides: `[[a,b],[c,d]]` against
`[[a,b]]` gives 0.57 although the labelled devices agree fully.

In `partitionMetrics`, compute `ari`, `blockRecall` and `roleMatch` on the partition
restricted to the devices the reference labels; drop blocks left empty. `humanOverlap` and
the floorplan metrics keep the whole partition. Test the example above: ARI 1, recall 1.

**Lane.** Lane 2, as before.

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
