# T058 review

## Round 1 — accepted (rail target partly missed)

Reviewed: `git diff HEAD` on `task/T058-rail-crossings` on 2026-11-12;
acceptance and the full evaluation rerun by Opus.

The investigation found that rail crossings sit mostly on marker branches
(66 of 105 dev incidences) and pin drops (33), rarely on trunks (6); 52 of the
marker-branch incidences come from rails with no eligible device host, so
their markers sat far away. Round 1 adds a bounded rail repair against the
finished signal geometry and a marker-seat search near the connected pins,
both decided by the finished calibrated score with the existing guards, and
routes trials through the R140 contact policy.

| Ratio to human           | T057 dev / val / all  | Round 1 dev / val / all |
| ------------------------ | --------------------- | ----------------------- |
| Crossings                | 2.260 / 1.925 / 2.145 | 2.078 / 1.887 / 2.013   |
| Bends                    | 1.285 / 1.043 / 1.208 | 1.262 / 1.031 / 1.188   |
| Wire length              | 1.491 / 1.480 / 1.488 | 1.472 / 1.477 / 1.474   |
| Median area              | 1.561 / 1.542 / 1.558 | 1.561 / 1.542 / 1.558   |
| Rail-involving crossings | 92 / 43 / 135         | 64 / 40 / 104           |

Accepted: every guard equal or lower (terminal departures 97 → 90, label
clearance 195 → 189), floating 10 and missing 18 unchanged, 627/628
completed, determinism and timing pass. The −30% rail target is met on dev
(−30.4%) but not overall (−23.0%; val −7%), recorded as a known limit.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 40 files, 624 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
