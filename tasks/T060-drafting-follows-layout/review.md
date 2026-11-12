# T060 review

## Round 1 — changes-requested

Reviewed: the round 1 report on `task/T060-drafting-follows-layout` on
2026-11-12. Strong result: median area 1.557 → 1.432 (dev) and 1.521 → 1.366
(val), crossings and bends not higher, wire lower, drafting-overlap warnings
38 → 19, all guards within base, determinism holds. Timing passes under the
plan's aggregate definition (p95 1.40×). Three contract tests block
acceptance; the plan is amended to resolve them.

| #   | Severity | Where                                       | Finding                                                                    | Expected fix                                                                                                                                     |
| --- | -------- | ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | R150 seating                                | A rectangle overlapping its owner in the input is seated beside the owner. | An owner is not a collision for its own drafting: keep the input offset when it was overlapping in the input.                                    |
| 2   | must-fix | `routing.test.ts:578`, `corpus.test.ts:201` | Assertions encode the replaced R10 rule.                                   | Rewrite exactly as the amended plan says (owned case + unowned minimum-downward case; corpus content/style/dimension/z/lock equality and reach). |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted

Reviewed: `git diff HEAD` on `task/T060-drafting-follows-layout` on
2026-11-12; acceptance and the full evaluation rerun by Opus.

Owned drafting now keeps its input offset to its owner (an owner is not a
collision for its own drafting); the rewritten tests follow the amended plan:
`routing.test.ts` has an owned and an unowned case, the unowned one keeping the
old minimum-downward contract; `corpus.test.ts` checks content, style, size,
z-order and lock equality and owner reach for the two fixtures with moved
notes. Note: that corpus branch names the two fixtures; a rule applied to all
fixtures would be cleaner, but it does not affect product behavior.

| Ratio to human | T059 dev / val / all  | Round 2 dev / val / all |
| -------------- | --------------------- | ----------------------- |
| Crossings      | 2.078 / 1.888 / 2.013 | unchanged               |
| Bends          | 1.250 / 1.017 / 1.176 | 1.250 / 1.016 / 1.175   |
| Wire length    | 1.458 / 1.459 / 1.459 | 1.457 / 1.458 / 1.457   |
| Median area    | 1.557 / 1.521 / 1.555 | 1.423 / 1.366 / 1.407   |

Drafting-overlap warnings 38 → 19; every visual guard equal or lower;
floating 10, missing 18; 627/628 completed.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 640 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
