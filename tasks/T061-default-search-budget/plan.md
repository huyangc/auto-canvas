# T061 — Raise the default annealer budget for small documents

- Branch: `task/T061-default-search-budget` (stacked on `task/T060-drafting-follows-layout`, PR #55)
- Base: `task/T060-drafting-follows-layout` at `06ec4c7`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods. After T060, ratios to
human on 627 completed ≤10-part drawings: crossings 2.01, bends 1.18, wire
1.46, median area 1.41 (`tmp/le10-t060r2/report.json`). Crossings remain the
largest gap. The existing R66 annealer runs only 8 routed evaluations by
default for documents up to 40 instances
(`packages/auto-layout/src/auto-layout.ts:92-94`).

## Context

Opus measured the budget on the T058 code (dev split, `/tmp/ac-exp`, env
override of `defaultLayoutSearch`):

| Default evaluations | Crossings | Bends |  Wire | Median area |                             Median ms | p95 ms |
| ------------------: | --------: | ----: | ----: | ----------: | ------------------------------------: | -----: |
|                   8 |     2.078 | 1.262 | 1.472 |       1.561 |                                 1,853 |  9,320 |
|                  24 |     1.857 | 1.231 | 1.467 |       1.556 |                                 2,684 | 10,109 |
|                  48 |     1.792 | 1.219 | 1.479 |       1.554 | (measured under load; not comparable) |        |

Visual guards at 24 were equal or lower than at 8. The 48 run's gain over 24 is
small. R66 in `docs/specs/auto-layout.md` documents the default budget;
`search.test.ts:86` reads `defaultLayoutSearch`. Later searches (R146 ports,
R147 relocation, rail search, gap closing) have their own trial caps and run
after the annealer.

## Scope

Owned: `packages/auto-layout/src/auto-layout.ts` (the default budget),
`packages/auto-layout/test/**`, `docs/specs/auto-layout.md` (R66),
`tasks/T061-default-search-budget/report.md`.

Out of scope: everything else; documents above 40 instances (budget 2
unchanged, plans byte-identical); explicit `options.search`; optimized and
partition modes keep their own budgets.

## Steps

1. Measure on dev with the current code at budgets 8 (base), 16, 24 and 32;
   choose the smallest budget whose dev crossings are within 2% of the best
   measured and whose paired timing meets step 2. Report the table.
2. Timing (paired with the base, same `--jobs`, nothing else running): median
   at most 1.6× base, aggregate p95 at most 1.5× base p95.
3. Set the default, update R66 and any test that pins the old value.
4. Evaluate all 628 drawings; report dev and val.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t060r2/report.json`: crossings lower on dev **and** val;
bends, wire and median area not higher on either split; completed ≥ 627; none
non-equivalent; floating ≤ 10; missing ≤ 18; every `VISUAL_*` total not above
the base; determinism; the 6 large documents byte-identical; timing as in step 2.

## Notes for the implementer

- Choose the budget on dev; report val.
- Do not change the annealer's moves or score in this task.
