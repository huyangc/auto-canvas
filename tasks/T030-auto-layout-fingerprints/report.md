# T030 report — round 3

## Summary

Addressed both must-fix findings from review round 2. Mining now measures whether
matcher occurrences equal LLM or attached blocks, enforces precision ≥0.8, and
reports rejected fingerprints separately. Rule partitions split disconnected
stage groups and template remnants through one connectivity helper.

The earlier R120–R124 implementation and round-2 fixes remain in place. The
tracked library is empty, and the dry run retains 18 jobs and 91,293 payload
bytes. No LLM provider was called or real candidate promoted.

## Steps

| Step                    | Status | Notes                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — R120 fingerprint    | done   | Retained canonical typed fingerprints and invariance/discrimination tests.                                                                                                                                                                                                                                     |
| 2 — R121 library        | done   | Retained validation and the empty tracked library; promotion tests write temporary libraries only.                                                                                                                                                                                                             |
| 3 — R122 matcher        | done   | Retained bounded deterministic matching and partial-count diagnostics.                                                                                                                                                                                                                                         |
| 4 — R123 template units | done   | Rule stage groups and remnants beside templates share non-rail, non-MOS-bulk connectivity splitting. Template stage boundaries and completion remain covered.                                                                                                                                                  |
| 5 — R124 mining         | done   | Added matchedAsBlock, matchedIntact, precision, MIN_PRECISION, rejection reporting and precision-first ordering. Promotion refuses low or missing precision. Mining reads and reconciles base caches without library entries.                                                                                  |
| 6 — report additions    | done   | Retained template reporting; mining HTML includes precision counts and a rejected section without drawings. Updated R111 and R124 in the spec.                                                                                                                                                                 |
| 7 — tests               | done   | 465 auto-layout tests pass. Synthetic cache tests cover exact and nested matches, rejection, CLI promotion refusal, and independence from an experimental library. Additional assertions cover attached blocks, the 80% boundary, zero-occurrence precision, budgets, ranking and the R60 transformer fixture. |
| 8 — report              | done   | Replaced the round-2 report with this round-3 report using the required template.                                                                                                                                                                                                                              |

## Review findings addressed

1. **Mining precision:** each candidate is matched independently against every
   distinct mined document. A match counts toward `matchedAsBlock` only when its
   device set equals an `llm` or `attached` block; containment in any block counts
   toward `matchedIntact`. Precision is exact-block matches divided by matcher
   occurrences, or zero without occurrences. Candidates need the named 0.8
   threshold in both mining and promotion. Those passing document/role gates but
   failing precision retain the same fields in `rejected`; their HTML section
   omits drawings. Ranking is precision, matched documents, mining documents,
   then hash. Exhausted-budget documents remain reported as partial.
2. **Disconnected rule blocks:** extracted the template-remnant connectivity
   logic into `connectedUnitGroups` and applied it to ordinary rule-stage groups
   too. The R60 transformer fixture now produces the connected primary block and
   two separate secondary resistor blocks, both with and without a template;
   `partitionInvariantErrors` returns no errors. Existing rule-partition tests
   pass unchanged.

## Acceptance results

Commands ran on `task/T030-auto-layout-fingerprints`. Full-suite runs use lane 2:
`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`, and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`.

```text
pnpm install --frozen-lockfile --offline
  → exit 0; Already up to date; pnpm 11.16.0. Lockfile unchanged.

pnpm format:check
  → exit 0; All matched files use Prettier code style!

pnpm docs:check
  → exit 0; Validated local Markdown links in 74 files.

pnpm typecheck
  → exit 0; tsc -p tsconfig.check.json --noEmit.

pnpm lint
  → exit 0; oxlint: 1985 files, 0 errors, 3064 warnings.

pnpm vitest run packages/auto-layout
  → exit 0; 26 files passed; 465 tests passed.

pnpm test:local
  → sandbox run: exit 1; 17 failed / 749 passed / 3 skipped files;
    60 failed / 7718 passed / 150 skipped tests; 2 unhandled errors.
    Local listeners and PostgreSQL connections failed with EPERM.
    A separate loopback-listener diagnostic also returned listen EPERM.
  → local-integration rerun: exit 0; 766 passed / 3 skipped files;
    7811 passed / 117 skipped tests.

pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → no output; exit 1 is grep's expected no-match status.

pnpm build
  → exit 0; workspace builds completed; Vite reports its chunk-size warning.

node scripts/auto-layout-partition-report.mjs tmp/human-cases --samples 0
  → exit 0; 33 documents completed, 0 failed.

node scripts/auto-layout-fingerprint-mine.mjs tmp/human-cases --samples 0
  → exit 0; 33 documents, 0 candidates, 0 failures.

node -e 'const l=JSON.parse(require("fs").readFileSync("packages/auto-layout/fingerprint-library.json","utf8")); if (l.entries.length) process.exit(1)'
  → exit 0; tracked library remains empty.

git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures
  → exit 0; empty output.

node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run --split dev
  → exit 0; jobs 18; payloadBytes 91293; cached 18. No provider call.

node scripts/auto-layout-fingerprint-mine.mjs tmp/human-cases --samples 0 --library tmp/fingerprints/empty-library.json
  → exit 0; 33 documents, 0 candidates, 0 failures, using a copy of the empty library.

git ls-files | grep -E '^tmp/|(^|/)(human-cases|llm-partition|fingerprints)/'
  → no output; exit 1 is grep's expected no-match status.

git diff --check
  → exit 0.
```

The amended path-anchored tracked-file check replaces the original broad grep,
as specified by the plan. Acceptance logs are under `tmp/t030-round3/` and remain
untracked. The focused fingerprint/mining/unit suite also passed (39 tests).

## Investigation results

No explicit investigation steps were required. Synthetic caches demonstrate an
exact-block pattern with precision 1 and a small pattern with precision 2/3 that
also occurs inside a larger LLM block; the latter is rejected and cannot be
promoted. The dry run confirms unchanged empty-library prompt bytes. The full
local suite passed once loopback and local PostgreSQL access were available.

## Deviations and open questions

- No implementation deviations. Mining now explicitly ignores library entries
  when reading/reconciling cached samples, as required by the round-3 amendment;
  `--library` still selects and validates the promotion destination. A CLI test
  verifies identical mining results after promoting into a temporary library.
- Finite matcher budgets can produce partial counts; JSON and HTML retain the
  exhaustion diagnostics. Real-cache mining and candidate approval remain with
  Opus and the user. Real-data mining in this round used zero samples only;
  provider tests use injected synthetic responses.
- No commits, branch switches, dependency changes, or edits to plan.md/review.md
  were made. Their existing working-tree status predates this round. Frozen paths
  and T031-owned files remain unchanged.
