# T062 review

## Round 1 — accepted

Reviewed: `git diff HEAD` on `task/T062-branch-columns` on 2026-11-12;
acceptance and the full evaluation rerun by Opus.

Investigation: R30 gave internal two-pin DC devices (series resistors between
two non-rail Nets) no level edge, so they and downstream devices collapsed into
row 0 (198 such devices in 122 dev drawings); recognized pairs also pulled
branch members into one row. A branch-column candidate now levels internal
series devices between their upstream and downstream devices, compacts before
rail/port placement, and competes by finished score under the R149 crossing/
bend guard; protected symmetry blocks and circuits without both rails are
excluded. A branch-verticality metric is added to the scoreboard.

| Ratio to human | T061 all |                             Round 1 all |
| -------------- | -------: | --------------------------------------: |
| Crossings      |    1.782 |    1.735 (dev 283 → 279, val 134 → 127) |
| Bends          |    1.141 |                                   1.121 |
| Wire length    |    1.456 |                                   1.443 |
| Median area    |    1.414 | 1.424 (+0.3% dev, +0.7% val, within 2%) |

Visual guards equal or lower; floating 10, missing 18; 627/628; determinism;
large documents identical; paired timing about 1.0×.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 647 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
