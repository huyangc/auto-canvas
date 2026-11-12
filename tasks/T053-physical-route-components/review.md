# T053 review

## Round 1 — accepted

Reviewed: `git diff HEAD` on `task/T053-physical-route-components` on
2026-11-12; acceptance rerun by Opus.

| #   | Severity | Where                                       | Finding                                                                                                                                                                                                                       | Expected fix |
| --- | -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | note     | `route-net-planner.ts`                      | Matches the plan and the Opus prototype: opt-in `components: "physical"` splits each visible component by `endpointToPhysicalComponent`; default editor/Agent behavior unchanged. Only one line removed in tests (an import). | None.        |
| 2   | note     | `packages/auto-layout/test/routing.test.ts` | The regression needs a four-terminal NMOS variant so bulk pins are attachment candidates, as in drawings with explicit bulk geometry. Synthetic; fails on base per the report.                                                | None.        |
| 3   | note     | label binding (`packages/derived`)          | The first-wire re-binding of free/object-anchored labels in `resolveNetLabelBinding` remains; it no longer affects auto-layout. Editor-side question, out of scope.                                                           | None here.   |

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors, 3210 warnings, as on main)
pnpm format:check → 0
pnpm exec vitest run packages/edit-engine packages/auto-layout/test → 0; 131 files, 1553 passed, 4 skipped
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 cases, 627 completed, 1 refused (yje2n6eva2, as on base)
compare.py tmp/le10-t053-base (b507797) vs round 1 → no status change; all equivalent; only qzszatannt changed:
  floating 1→0, missing 1→0, AUTO_LAYOUT_NET_UNROUTED warning gone, crossings 6→5; 626 others identical
```
