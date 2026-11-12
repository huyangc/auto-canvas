# T057 review

## Round 1 — changes-requested

Reviewed: `git status` and the report on `task/T057-device-relocation-search`
on 2026-11-12. Results are good: crossings 2.31× → 2.15× human, wire 1.54× →
1.50×, bends and area lower, guards and determinism hold, timing within
limits. One contract issue is a planning mistake on Opus's side and is fixed
in the amended plan.

| #   | Severity   | Where                                                               | Finding                                                                                    | Expected fix                                                                                                                                                       |
| --- | ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix   | `auto-layout.ts` (partition fallback path), `partition.test.ts:666` | Two fallback-equality tests fail: fallback skips R146/R147 while plain planning runs them. | Run R146 and R147 on the fallback path as in plain planning (amended plan); both tests pass unchanged; successful partition plans stay byte-identical to the base. |
| 2   | should-fix | R147 budget                                                         | Timing headroom remains (median 1.34×/2×, p95 1.39×/1.5×).                                 | Spend it if dev crossings or wire improve with no guard increase; report the dev comparison.                                                                       |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted (milestone missed)

Reviewed: `git diff HEAD` on `task/T057-device-relocation-search` on
2026-11-12; acceptance and the full evaluation rerun by Opus.

Fallback now runs R146 and R147 like plain planning; `partition.test.ts`
passes unchanged. The trial cap is ten. Shared scoring and guards moved to
`routed-search-score.ts`, used by both searches.

| Ratio to human | T056 dev / val / all  | Round 2 dev / val / all |
| -------------- | --------------------- | ----------------------- |
| Crossings      | 2.416 / 2.112 / 2.312 | 2.260 / 1.925 / 2.145   |
| Bends          | 1.364 / 1.089 / 1.276 | 1.285 / 1.043 / 1.208   |
| Wire length    | 1.553 / 1.514 / 1.542 | 1.491 / 1.480 / 1.488   |
| Median area    | 1.588 / 1.563 / 1.575 | 1.561 / 1.542 / 1.558   |

Floating pins 10 and missing connections 18 unchanged; 627/628 completed;
visual guards all equal or lower (terminal departures 103 → 97, label
clearance 207 → 195, wire through symbol 20 → 18). Milestone (crossings ≤ 2.0,
wire ≤ 1.4) missed and recorded.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 39 files, 620 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
