# T029 report — round 3

## Summary

Addressed all four round 2 must-fix findings under the round 3 amendment.
Differential-pair input/tail relations now define the shared stage map for units
and the rule fallback. Completion attaches only leaf units, preserving omitted
stages for rule blocks. T029 invariants are checked on the returned partition
before legacy planner validation; planner merge warnings are reported separately.

The offline rule-only report completes all 33 documents: 18 dev and 15 val, with
no invariant failures or planner errors. It records 17 legacy planner merges
across 10 documents (6 merges on dev, 11 on val). Placement and the planner
validator remain unchanged for T031.

## Steps

| Step                       | Status | Notes                                                                                                                                                                                           |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — R110 units             | done   | Shared differential input/tail stage relations preserve current-source tails; candidate stage/connectivity cuts and canonical aliases remain intact. Multi-output mirrors still split by stage. |
| 2 — R111 rules             | done   | Uses the same tail stage relations. Tests assert complete, connected blocks with no split units on rulePartition output. All role branches remain covered.                                      |
| 3 — R112 prompt            | done   | Retained prompt/schema v4, unit grouping, canonical anonymization, and no LLM placement fields. Provider/cache tests pass offline.                                                              |
| 4 — R113 reconcile         | done   | Attachment requires all adjacent units to belong to one accepted block. Added pre-planner invariant checking and retained hard/soft checks, consensus, confidence and completion behavior.      |
| 5 — R114 evaluation/report | done   | Report rejects invariant failures and planner errors, counts planner merges per document, per split and overall, and retains planner diagnostics. Both splits complete rule-only.               |
| 6 — tests                  | done   | All 443 auto-layout tests pass, including tail retention, unchanged fallback validation, rail-only split, omitted amplifier stage, shunt attachment, and invalid partition rejection.           |
| 7 — report                 | done   | Round 3 implementation and acceptance evidence recorded here.                                                                                                                                   |

## Review findings addressed

1. **Must-fix 1 — current-source tail:** `partitionTailGroups` builds one stage
   relation per differential-pair or differential-pair-mirror-load structure,
   containing all input fingers and tail members. Both `recognitionUnits` and
   `rulePartition` pass these relations to `findStages`; other recognized kinds
   never join stages. `pair()` keeps its tail in one unit and one rule block.
   The existing fallback test, including its no-diagnostics planner validation,
   passes unchanged; the multi-output mirror regression also passes.
2. **Must-fix 2 — invariant boundary:** `valid()` checks the reconciler's original
   output for exact device coverage, intact units and device-level non-rail,
   non-bulk connectivity. Planner diagnostics must be warnings matching
   `L0 structure split ...; merged into ...`. The rail-only regression retains
   its `[1, 1]` assertion and explicitly checks the legacy merge warning.
   The rule-unit test helper also checks invariants on rulePartition output.
3. **Must-fix 3 — planner merges in reports:** report validation uses the same
   explicit T029 invariant checker, with a negative test for missing, duplicate,
   unknown, disconnected and split-unit input. Planner error diagnostics still
   reject; L0 warnings contribute `plannerMerges` counts and remain visible in
   `plannerDiagnostics`. JSON and HTML include split totals; JSON also includes
   the overall merge count. Both splits were evaluated offline without rejection.
4. **Must-fix 4 — attachment waves:** an unassigned unit attaches only if it has
   a neighbour and every adjacent unit belongs to its one host block. A regression
   proposes only the input stage of a two-stage amplifier: the second stage
   remains a rule block, while the input-stage shunt capacitor attaches and
   inherits confidence. Chain/ambiguous-neighbour tests preserve rule completion.

## Acceptance results

Local tests use lane 2: `ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`.
No provider/network calls were made. The full test suite's local-service rerun
uses approved sandbox escalation for loopback listeners and PostgreSQL.

```text
pnpm install --frozen-lockfile --offline
  → 0; Already up to date; pnpm v11.16.0. No lockfile changes.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0.
pnpm lint
  → 0; oxlint: 1981 files, 0 errors, 3038 warnings.
pnpm vitest run packages/auto-layout
  → 0; 24 test files passed; 443 tests passed.
pnpm test:local
  → 0 with approved local-service access; 764 passed | 3 skipped test files;
    7789 passed | 117 skipped tests. Duration 82.05s.
  Initial sandbox run stopped with exit 130 after reproducible local-listener
  failures. Focused launcher reproduction: exit 1, 20 failures, all
  `Error: listen EPERM: operation not permitted 127.0.0.1`.
pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → 1 from grep; no output (expected no matches).
pnpm build
  → 0; package/app builds completed; editor chunk-size warning only.
pnpm auto-layout:review
  → 0; Wrote 9 corpus and 7 held-out SVGs and tmp/auto-layout-review/index.html.
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run --split dev
  → 0; jobs:18, payloadBytes:91293, cached:0; no network.
node scripts/auto-layout-partition-report.mjs tmp/human-cases --samples 0
  → 0; 33/33 completed rule-only, 0 failed.
    dev: 18/18 completed, 6 planner merges; val: 15/15 completed, 11 planner merges.
    Overall: 17 planner merges across 10 documents; no T029 invariant failures.
    Wrote tmp/auto-layout-partition/report.json and index.html; no network.
pnpm auto-layout:eval tmp/human-cases
  → 0; 33/33 completed and 33/33 electrically equivalent.
    Wrote tmp/auto-layout-eval/report.json and index.html.
  Uses the round 2 amendment; superseded stale-baseline command not run.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures
  → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|llm-partition/|auto-layout-partition/'
  → 0; three pre-existing task-document matches:
    tasks/T027-auto-layout-llm-partition/plan.md
    tasks/T027-auto-layout-llm-partition/report.md
    tasks/T027-auto-layout-llm-partition/review.md
  No private cases, cached samples or generated evaluation artifacts are tracked.
git diff --check
  → 0.
```

## Investigation results

No separate investigation step was requested. The prior blockers are resolved
within the amendment: current-source tails need explicit stage joins, and the
legacy planner's merge warnings belong to a separate contract boundary. The
report scores/draws T029's returned partition, not the planner's merged copy.

## Deviations and open questions

- Used the amended default evaluation command without the stale T013 baseline.
  Opus owns comparison against T027 head; the round 1 review records the earlier
  unchanged-default comparison. No baseline was regenerated.
- The raw tracked-file regex has three pre-existing T027 task-document matches;
  these are not private-artifact leaks.
- Planner L0 merges remain visible by design. T031 owns recognition-unit planner
  validation and trimming movement groups to block members.
- Real LLM calls and recognition-quality targets remain Opus's work. The rule-only
  run on both splits neither tunes on val nor claims LLM quality results.
- No commits, pushes, branch switches, plan/review edits, dependency/lockfile
  changes, or hand edits to generated files. Pre-existing plan/review changes
  were preserved. Frozen packages, apps, placement and routing were not edited.
