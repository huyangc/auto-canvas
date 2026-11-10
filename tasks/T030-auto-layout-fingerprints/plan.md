# T030 — Auto-layout: sub-component fingerprint library (canonical fingerprints, matcher, mining)

- Branch: `task/T030-auto-layout-fingerprints`
- Base: `task/T029-auto-layout-partition-units` at `917737a` (stacked on the T029 PR)
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Rules: R120–R124
- Status: approved

## Goal

The user approved a **fingerprint library** (2026-11-09). It makes graph-matching
recognition grow from LLM recognition:

1. Every high-confidence LLM sub-component gets a canonical structural fingerprint.
2. Fingerprints that recur across circuits with a consistent function become candidate
   templates.
3. Once the user approves them, the candidates enter a tracked library.
4. A graph matcher then finds library templates deterministically and turns them into
   recognition units with a known title and role, so the LLM starts from a higher level.

This task builds the mechanism. It does **not** add templates mined from third-party cases
to the tracked library. Candidates are reported for the user's batch review, and promotion
is a separate, explicit step.

T031 (placement) runs in parallel on lane 3. It owns:

- the placement and search files;
- `src/partition.ts`, the planner validator, which T031 moves onto recognition units;
- `scripts/auto-layout-eval.mjs`.

Do not edit those. T031 calls `recognitionUnits(document, resolver)` without library
entries, so keep that call signature working, with an optional trailing parameter for the
entries.

## Context

- **Canonical labelling.** T029's `src/units.ts` has `canonicalOrder`, which canonically
  labels a graph by colour refinement with individualization and minimizes its certificate,
  and `canonicalDevices`. Reuse them; do not write a second canonicalizer.
- **Units.** `recognitionUnits` builds units from candidate relations, restricted to one
  stage and internally connected (amended R110).
- **Reconciliation.** `reconcilePartition` (`src/partition-reconcile.ts`) returns blocks
  with `unitIds`, `provenance` and `confidence`.
- **Prompt.** `src/partition-prompt.ts` (prompt v4) sends units to the LLM.
- **Cache.** The LLM sample cache is `tmp/llm-partition/`. The script is
  `scripts/auto-layout-llm-partition.mjs`; the report is
  `scripts/auto-layout-partition-report.mjs`.
- **Device classes and polarity** come from `deviceDescriptor` (`@icm/devices`). Net roles
  and rails come from `classifyNets`.

### Binding constraints (unchanged)

- **Human cases.** Git-ignored; never commit a case, case id, excerpt or id-keyed data. A
  fingerprint mined from a third-party drawing is derived data: it stays in `tmp/` until the
  user approves it.
- **Purity.** `packages/auto-layout` stays offline and pure. Without a library entry, every
  output equals the base.
- **Frozen code.** The router, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `edit-engine`, `derived` and `apps/` do not change.

## Scope

Owned paths (may be created, edited or deleted):

- New: `packages/auto-layout/src/fingerprint.ts` and its tests.
- New: `packages/auto-layout/fingerprint-library.json`, outside `src/`, with no entries.
- `src/units.ts`, `src/partition-reconcile.ts`, `src/partition-prompt.ts`, `src/types.ts`
  (additions only).
- New: `scripts/auto-layout-fingerprint-mine.mjs`.
- `scripts/auto-layout-partition-report.mjs`.
- `docs/specs/auto-layout.md`, for R120–R124.

Out of scope (do not change):

- placement, routing and search: `place.ts`, `stages.ts`, `search*.ts`, `refine.ts`,
  `partition-floorplan.ts`, `partition-geometry.ts`, and the router;
- `src/partition.ts` and `scripts/auto-layout-eval.mjs`, which belong to T031;
- `packages/model`, `edit-engine`, `derived`, `project-protocol`, `spice`, `apps/`,
  `fixtures/`.

## Steps

1. **R120 Fingerprint.** `blockFingerprint(document, resolver, deviceIds)` returns
   `{ hash, canonical }`. It is built from a typed bipartite graph of the sub-circuit:
   - **Device nodes** are labelled by device class, polarity and family, from the
     descriptor.
   - **Net nodes** are labelled by kind:
     - `internal`: every terminal is inside the set;
     - `external`: some terminal is outside;
     - `supply` or `ground`: a rail.
   - **Edges** are labelled by pin role:
     - MOS D, G and S, and BJT C, B and E, are distinct;
     - pins of symmetric two-terminal passives and switches are unlabeled, so swapping
       them does not change the fingerprint;
     - MOS bulk is ignored.

   Canonicalize with `canonicalOrder`. The hash is a SHA-256 of the canonical
   serialization. It must not change under renaming, instance reordering, geometry or
   symmetric pin swaps, and different topologies must hash differently.

2. **R121 Library.**
   - `packages/auto-layout/fingerprint-library.json` is `{ "version": 1, "entries": [] }`.
     Each entry is `{ hash, canonical, title, role, approvedBy, sources }`.
   - `parseFingerprintLibrary(value: unknown)` in `fingerprint.ts` validates the parsed
     JSON and rejects malformed entries, unknown roles, hashes that do not match
     `canonical`, and duplicate hashes.
   - The package never reads files. The scripts read the file and pass the entries in.
   - The file ships with **no entries**. Tests use hand-built synthetic entries.

3. **R122 Matcher.** `matchFingerprints(document, resolver, entries)` finds device sets
   whose fingerprint equals an entry, by typed backtracking subgraph isomorphism over the
   entry's canonical graph:
   - an `internal` pattern net maps to a net whose terminals all lie inside the match;
   - an `external` net maps to a net with at least one terminal inside the match;
   - a rail maps to a rail of the same kind.

   Confirm each candidate by recomputing `blockFingerprint`. Bound the search with a node
   budget. Choose non-overlapping occurrences deterministically: larger entries first, then
   canonical device order.

4. **R123 Template units.** `recognitionUnits` accepts library entries. Every match
   becomes one unit: unioned with the R110 units it overlaps, kind `template`, carrying the
   entry's title and role.
   - The LLM payload marks such units with their title.
   - In `reconcilePartition`, a template unit that no accepted LLM block contains becomes
     its own block during completion, with provenance `template`, the entry's title and
     role, and confidence 1. This comes before rule completion.
   - With an empty library, all results equal T029's: units, rule partition, reconciled
     partition and the LLM payload. The payload must stay byte-identical, so the prompt-v4
     cache keys stay valid. Template titles enter the payload only when a template unit
     exists.
   - `scripts/auto-layout-partition-report.mjs` loads the library and passes it. The
     evaluator `scripts/auto-layout-eval.mjs` belongs to T031 and does not load it in this
     task.

5. **R124 Mining.** `scripts/auto-layout-fingerprint-mine.mjs <folder…> --samples k`
   reconciles each document from the cache, without network.
   - **Fingerprinted blocks.** It fingerprints every `llm` block with confidence ≥ 0.6 and
     2–16 devices that is not a single unit.
   - **Aggregation.** Blocks are aggregated by hash, recording: the number of distinct
     documents, titles, a role histogram, and example documents with their block members.
   - **Candidates.** A hash qualifies when it appears in at least 2 documents and its
     dominant role holds at least 60% of the role histogram.
   - **Output.** It writes `tmp/fingerprints/candidates.json` and an HTML page. The page
     shows each candidate's title and role, its counts and its canonical structure, with
     the examples highlighted on their human drawings when available.
   - `--promote <hash…> --approved-by <name>` appends the chosen candidates from
     `tmp/fingerprints/candidates.json` to `packages/auto-layout/fingerprint-library.json`
     and writes it with Prettier's JSON style. It is run only after the user approves.
     `sources` holds counts and roles, never case ids, file names or titles from cases;
     example documents stay in `tmp/`.

6. **Report additions.** `auto-layout-partition-report.mjs` reports template units and
   template-provenance blocks per document.

7. **Tests.** Hand-built:
   - fingerprint invariance (rename, reorder, move, symmetric pin swap) and
     discrimination;
   - the matcher finds every occurrence in a larger circuit, honours internal, external
     and rail, chooses deterministically without overlap, and stops at its budget;
   - the library loader;
   - template units and completion;
   - an empty library leaves T029 results unchanged;
   - mining aggregation on synthetic caches, and `--promote`.

8. **Report**, by Codex: what was built and the tests. Opus mines the real caches, which are
   dev, val and LOADBench, and reports the candidates.

### Round 2 amendment (after review round 1)

**Owned paths added:** `scripts/auto-layout-llm-partition.mjs` and its test
`packages/auto-layout/test/partition-provider.test.ts`. `scripts/auto-layout-eval.mjs` stays
with T031: keep every exported function it imports callable with today's arguments.

1. **R113 soft role check only reports.** In `reconcilePartition`, an LLM role that the
   electrical evidence does not support is still counted in `checks.softRole` and listed in
   the diagnostics. The block keeps the LLM's role, and its confidence is the mean consensus
   share alone. Update the spec sentence in R113 and the tests that expect `other` and a
   halved confidence.

2. **Rule partition without templates.** `rulePartition` computes its stage blocks from the
   units as they are without library entries. With entries:
   - every template unit is one rule block of its own, with the entry's title and role;
   - every other device stays in the rule block it has without entries, less the template
     devices, split into connected components.

   So a template that spans two stages never merges them. `reconcilePartition` uses this
   partition as its fallback. Test: a synthetic entry whose match spans two stages leaves
   two separate rule blocks beside the template block.

3. **Matcher support per candidate.** After aggregation, the mining script runs
   `matchFingerprints` for each candidate, as a one-entry library, over every mined
   document. `candidates.json` and the HTML page gain `matchedDocuments` and
   `matchedOccurrences`, and note a budget that ran out. Order candidates by
   `matchedDocuments`, then by `documents`.

4. **Library in the call script; one cache reader.**
   - `scripts/auto-layout-llm-partition.mjs` loads the library and passes its entries to
     `describeCircuit`, so samples are requested and cached for the payload with template
     units. With an empty library the payload, the cache keys and the dry-run output are
     unchanged.
   - `cachedSamples(document, resolver, count, anonymize, cacheDirectory, entries = [])`
     builds the same payload. The report script uses it; remove the report's own
     `templateSchema` and `samplesFor`.

5. **`--library <path>`.** The call script, the report script and the mining script accept
   `--library <path>`; the default is the tracked file. `--promote` writes to that path. An
   experiment can then use a library file under `tmp/` and leave the tracked file empty.
   Test the option on the mining script with a temporary library.

**Acceptance added.** The last line replaces the old tracked-file grep, which also matched
task document names.

```bash
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run --split dev      # expected: exit 0; jobs 18; payloadBytes 91293, as on the base
node scripts/auto-layout-fingerprint-mine.mjs tmp/human-cases --samples 0 --library tmp/fingerprints/empty-library.json   # expected: exit 0 with a copy of the empty library
git ls-files | grep -E '^tmp/|(^|/)(human-cases|llm-partition|fingerprints)/'           # expected: no output
```

### Round 3 amendment (after review round 2)

No step of this task calls an LLM provider. Any run that spends LLM API tokens needs the
user's confirmation first; neither Codex nor the tests start one.

**1. Mining precision (R124).** A library entry forces a unit wherever the matcher finds its
pattern. So a candidate is useful only if those places are blocks the LLM draws. For each
candidate, compare every matcher occurrence with the reconciled partition of its document
(reconciled without library entries, as mining does today):

- `matchedAsBlock`: occurrences whose device set equals one block with provenance `llm` or
  `attached`;
- `matchedIntact`: occurrences whose devices all lie in one block;
- `precision` = `matchedAsBlock` / `matchedOccurrences`, or 0 without occurrences.

Then:

- A candidate also needs `precision` ≥ `MIN_PRECISION` (0.8, a named constant).
  `--promote` refuses a hash below it.
- `candidates.json` gains a `rejected` list: the fingerprints that pass the document and
  role gates but fail precision, with the same fields. The HTML page shows them in a second
  section, without drawings.
- Order candidates by `precision`, then `matchedDocuments`, then `documents`, then hash.
- When the matcher's budget ran out for a document, that document's occurrences are
  partial; keep reporting it as today.

Tests on synthetic caches: a pattern the LLM always draws as a block qualifies with
precision 1; a small pattern that also matches inside larger LLM blocks is rejected and
listed; `--promote` refuses the rejected hash.

**2. Rule blocks are connected (R111).** A `findStages` stage need not be connected through
the devices it owns: a transformer is drawn in its primary's stage, while its secondary
joins other consumers. `rulePartition` then returns a block whose devices share no net.

`rulePartition` splits every block into components connected through non-rail nets,
excluding MOS bulk pins, with or without library entries. Use one code path for this and for
the remnants beside a template. Test: the R60 transformer fixture of `stages.test.ts` gives
rule blocks for which `partitionInvariantErrors` returns nothing, and the existing rule
partition tests pass unchanged.

**Acceptance.** As before; the dry run still gives 18 jobs and 91293 payload bytes.

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
node scripts/auto-layout-partition-report.mjs tmp/human-cases --samples 0             # expected: exit 0, no network
node scripts/auto-layout-fingerprint-mine.mjs tmp/human-cases --samples 0             # expected: exit 0, no candidates from rule-only partitions
node -e 'const l=JSON.parse(require("fs").readFileSync("packages/auto-layout/fingerprint-library.json","utf8")); if (l.entries.length) process.exit(1)'   # expected: exit 0 (no entries)
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition/|fingerprints/'   # expected: no output
```

## Notes for the implementer

- One general mechanism per step. Never key anything to a case, Reference or instance id.
- The thresholds (confidence 0.6, 2–16 devices, 2 documents, 60%) are starting values;
  keep them as named constants.
