# T016 review

## Round 1 — changes-requested

Reviewed: `git status`, the report, and the tables. Opus reran
`pnpm vitest run packages/auto-layout` (110 passed). Stages clearly work: dev
crossings 224→140, val 184→139, with both of the worst documents far better (73→30
and 50→10). Corpus and held-out results hold. The report's privacy handling, with
anonymous ordinals and id-keyed data only in `tmp/`, is correct; keep it.

**plan.md was edited for round 2:** R57, R58, R59, and a 12 s limit in place of the
per-document increase. This is round 2 of 3.

| #   | Severity | Where                                 | Finding                                                                                                                         | Expected fix                                                |
| --- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | must-fix | `src/auto-layout.ts`, `src/refine.ts` | Three strategies each refining costs up to 20.5 s, and 11 documents exceed the time budget.                                     | R58.                                                        |
| 2   | must-fix | `src/stages.ts`                       | The estimate is mirror-symmetric, so a drawing can come out with its input on the far right (your pair 2).                      | R57. Unit test on a hand-built two-stage circuit.           |
| 3   | must-fix | `src/stages.ts`                       | Many small stages each take a column, and drawings sprawl into a long band (your pair 3). Wire length rose on dev, 69530→73720. | R59. Report wire length and layout width on the common set. |
| 4   | note     | report                                | Val misses its ceiling by 8 crossings.                                                                                          | Report where it lands. Do not tune to it.                   |
| 5   | note     | `src/refine.ts`                       | Some documents gain crossings to lose floating pins, as the score intends.                                                      | No change; keep them in the table.                          |

## Round 2 — changes-requested

Reviewed: the round 2 report and tables. Opus reran `pnpm vitest run
packages/auto-layout` (113 passed, 1 failed, matching the report). Speed and width
are fixed: slowest 7.3 s, width −12.9% and −8.8%, wire length down. Refining only the
winner cost crossings (dev 140→157, val 139→144) and broke the `ltc3452` ceiling.
Not adding a case-specific fallback was correct.

**plan.md was edited for round 3:** R58 now refines the top two. This is the last round.

| #   | Severity | Where                                 | Finding                                                                                                               | Expected fix                                                                                                                                                                                                     |
| --- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/auto-layout.ts`, `src/refine.ts` | `ltc3452` is at 23 crossings against a ceiling of 22, because the unrefined rank does not predict the refined result. | R58 as revised. Keep the 12 s limit.                                                                                                                                                                             |
| 2   | must-fix | `src/stages.ts` R59                   | Dev floating pins rose 24→30, above the ceiling of 27; val rose 10→14. Attached parts probably block trunk paths.     | Find out which documents gained floating pins and why, and fix it in R59 generally, for example by keeping the rail side of an attached part clear. If the fix is not general, report it and leave R59 as it is. |
| 3   | note     | report                                | Crossing ceilings may still be missed.                                                                                | Report where they land. Do not tune to them.                                                                                                                                                                     |

## Round 3 — accepted with targets missed

Reviewed: the round 3 report and tables, and rendered results. All three Codex rounds
are used. Earlier results do not regress, so this is accepted with its targets
reported as missed.

Opus made one fix after round 3: R57 used R4's `input` role, which needs a gate on the
Net. An input reached through a series resistor is `internal`, so direction correction
did nothing and one dev document's input stayed on the right. Any non-rail, non-output Cell
Pin now counts as the input side. The new test fails with the fix reverted.

Acceptance rerun by Opus on lane 1 (`tmp/t016-opus/`):

```text
pnpm install --frozen-lockfile --offline     → 0
pnpm format:check                            → 0
pnpm docs:check                              → 0
pnpm typecheck                               → 0
pnpm lint                                    → 0
pnpm vitest run packages/auto-layout         → 0
pnpm test:local                              → 0 (7398 tests passed, 116 skipped)
pnpm deadcode | grep auto-layout             → no output (deadcode exits 1, as on main)
pnpm build                                   → 0
node scripts/auto-layout-review.mjs          → 0
protected paths                              → unchanged
git ls-files | grep -E 'human-cases|auto-layout-eval/' → no output
```

| Measure, common documents | Baseline  | T015      | T016       | Target              |
| ------------------------- | --------- | --------- | ---------- | ------------------- |
| Crossings, dev            | 288       | 224       | 162 (−44%) | ≤144, missed        |
| Crossings, val            | 262       | 184       | 133 (−49%) | ≤131, missed        |
| Bends, dev / val          | 338 / 256 | 291 / 213 | 243 / 193  | not above T015, met |
| Floating pins, dev / val  | 62 / 45   | 27 / 14   | 17 / 14    | ≤27 / ≤14, met      |
| Slowest document          | —         | 14 s      | 11.6 s     | ≤12 s, met          |
| Completed                 | 24        | 32        | 32         | ≥32, met            |

All completed documents are electrically equivalent with no unsafe geometry.

Known limits:

- Switches are not conducting in R50, so a switched-capacitor circuit (with ordinal 06)
  still draws as a long band of single-part stages.
- Dev width is 10% above T015.
- The 70-instance document is still refused.
- Drafting notes stay at their old positions.
