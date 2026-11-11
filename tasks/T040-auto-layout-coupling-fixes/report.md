# T040 report — round 2

## Summary

Completed the remaining R143 dotted-pin conflict warning. Every successful layout
run emits one `AUTO_LAYOUT_COUPLING_DOT_CONFLICT` warning per conflicting winding,
with its member id, sorted coupling ids and the chosen pin from the lowest
coupling id. Quick, seeded search, partitioned plans and persisted replanning
retain the warning. Plans without conflicts retain their diagnostics.

Round 1's connected coupling groups, rigid placement/search behavior and canonical
aliases remain in place. All 33 default drawing plan hashes and all 33 named and
anonymous payloads match the retained `c529aee` baseline. Cached v5 evaluation
reconciles all 18 development drawings from 54 valid-first-try samples.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                              |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained connected components, sorted members and lowest-coupling-id dot selection. Added one deterministic warning per conflicting member in successful layout results.                                                           |
| 2    | done   | Retained all-member placement, fixed-member anchoring and rigid collision/search movement; regression suite passes.                                                                                                                |
| 3    | done   | Retained canonical coupling edges and anonymous role normalization; unequal/equal-k permutation tests pass.                                                                                                                        |
| 4    | done   | Added warning assertions for quick/search with and without partitions, reversed input order, persisted replanning, no-conflict diagnostics and multiple conflicting windings. All 31 coupled tests and 564 auto-layout tests pass. |
| 5    | done   | R143 now specifies the warning code, severity, cardinality, identifying information and applicable planning modes.                                                                                                                 |
| 6    | done   | Repeated the result evaluation and compared with round 1's retained baseline: 33/33 completed and identical plan hashes; all named and anonymous payloads identical. All 18 cached development cases completed/reconciled.         |

## Review findings addressed

Round 1 must-fix finding 1: fixed in `packages/auto-layout/src/auto-layout.ts`,
using the round 2 scope amendment. Warning assembly uses the same valid-coupling
filter as recognition and is attached only to successful results. It emits rule
`R143`, severity `warning`, code `AUTO_LAYOUT_COUPLING_DOT_CONFLICT`, naming the
member and coupling ids. Tests verify exactly one warning per conflicting member
through quick, search and partition paths, including fallback after a no-op
persisted partition plan. The deferred spec sentence is included.

## Acceptance results

Every command uses `ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311` and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. API-key and token
environment variables are removed by the existing ignored launcher. The LLM
evaluator calls `createPartitioner()` with `allowApi=false`; no provider call is
made.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0; All matched files use Prettier code style!.
pnpm docs:check → 0; Validated local Markdown links in 74 files.
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; 1994 files, 0 errors, 3123 warnings.
pnpm vitest run packages/auto-layout → 0; 32 files, 564 tests passed.
pnpm test:local → 1 in sandbox; 19 files / 63 tests failed; 2 errors, including listen/connect EPERM on loopback and PostgreSQL.
pnpm test:local → 0 with sandbox escalation; 773 files passed, 3 skipped; 7915 tests passed, 117 skipped (74.03 s).
pnpm deadcode 2>&1 | grep -E 'coupl|recognize|units' → 1; no output (expected grep status for no matches).
pnpm build → 0; workspace builds completed; existing large-chunk warning.
pnpm auto-layout:review → 0; wrote 9 corpus and 7 held-out SVGs.
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; 33 completed; all 33 plan hashes equal c529aee.
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7 → 0; 18 completed/reconciled; 54 valid-first-try cached samples.
git status --short packages/model packages/derived packages/edit-engine apps scripts pnpm-lock.yaml package.json → 0; empty.
git ls-files tmp | head -1 → 0; empty.
```

Initial type checking caught an explicit undefined optional search property in
the new test; it now omits that property. Initial auto-layout tests caught the
existing partition fallback diagnostic on no-op persisted replanning; the test
now asserts that diagnostic alongside the conflict warning. No existing tests
were weakened or removed. Final `git diff --check` is clean.

Logs are under ignored `tmp/t040/r2-*.log`; aggregate comparison evidence is in
`tmp/t040/r2-comparison.json`. Private drawing snapshots, payloads and result
reports remain ignored; this report contains no drawing identifiers.

## Investigation results

The successful result assembly in `buildPlan` is shared by quick, search and
partition candidates; adding diagnostics there preserves the warning through
candidate selection and final facing. Valid couplings alone participate, and
sorting member/coupling ids makes diagnostics stable under input reordering.

The `c529aee` baseline evaluation and payload snapshots were retained from round
1 and accepted by the review. Round 2 compares freshly built result outputs to
those snapshots without switching branches or changing source for a baseline
run. None of the 33 drawings contains a coupling; all plan hashes and payload
strings remain identical, preserving cache-key inputs.

## Deviations and open questions

No open findings remain. The required full-suite run passed with sandbox
escalation after the restricted run failed. No out-of-scope source changes,
plan/review edits, commits, branch switches, dependency changes, lockfile changes
or LLM provider calls were made.
