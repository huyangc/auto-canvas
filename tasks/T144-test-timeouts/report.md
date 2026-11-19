# T144 report — round 2

## Summary

Every planner test in `packages/auto-layout/test/` now carries an explicit
timeout instead of relying on Vitest's 5 s default. **96 tests across 35 files**
were added in this round on top of the 73 the first round fixed; the scan now
reports **0**, with one test deliberately left out because it exercises a
timeout on purpose.

The diff is timeout arguments only. Two files were additionally re-wrapped by
Prettier, because adding the timeout stops the callback from being the last
argument; `git diff -w` shows those are whitespace-only.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | The plan's 83 did not reproduce. On the plan commit's own tree the correct scan finds **115**, not 83: the plan's scan matched only `it.each` start lines (its per-file sample lists exactly those) and missed every plain `it(...)` planner test, plus two whole files (`auto-layout.test.ts`, `amp-gate-row.test.ts`). See "Deviations". |
| 2 | done | One test skipped: `drafting-interface.test.ts:276` "still refuses when search stops %s" (`it.each(["during", "deadline"])`) — it deliberately runs the planner with `deadline: 0` and with an `AbortController`, so it must not get a longer timeout. Two timing-adjacent tests were checked and kept: `recover-drafting-owners.test.ts:359` and `net-label-follow.test.ts:290` assert call counts, not a clock. |
| 3 | done | 96 more tests now pass `60_000`. |
| 4 | done | `git diff -U0` shows `});` → `}, 60_000);` (76) and `  });` → `  }, 60_000);` (20), plus the two Prettier re-wraps. `git diff -w` on those two shows only re-wrapping. |
| 5 | not done | Did not re-run with an artificially reduced timeout; saying so rather than implying it. |
| 6 | done | The slowest tests are listed below. |

## Review findings addressed

Round 1 — the codex review of the first commit said the diff contained only
`plan.md` and `report.md` with no test edits. It was right; that commit was made
from a stale staging state and the work was redone.

Round 2 — the first round's own scan was found to be incomplete (see
"Deviations"), and this round covers the rest.

## Acceptance results

```text
npx vitest run packages/auto-layout → exit 0
  Test Files  74 passed (74)
  Tests       1105 passed (1105)
pnpm typecheck → exit 0
pnpm lint → exit 0 (0 errors; 3696 warnings, pre-existing)
pnpm format:check → exit 0
```

1105 is the same count as before the change and on `main`: no test was added,
removed or skipped. (`pnpm --filter @icm/auto-layout test` in the plan is a
no-op — that package has only a `build` script — so the root `npx vitest` form
is what was run.)

## Investigation results

The scan (throwaway, not committed) matches a test's body by balanced parens
over a comment- and string-masked copy, so quotes and braces cannot fool it. A
*planner test* calls `planAutoLayout`, `planWithSeriesLevels`, `planDocument` or
the corpus helper `defaultPlan`; *on the default timeout* means the argument
list ends without a numeric timeout, including the cross-line
`},\n  30000,\n);` form.

```text
before this round   97 planner tests on the default timeout (3 it.each, 94 plain)
after                0   (1 skipped on purpose, see above)
reference, plan commit 23b2d6a:  115
```

Slowest of the 97 on a serial local run — none is close to 5 s, so these were
the latent population rather than the observed CI failures:

```text
865ms  signal-series.test.ts:108
730ms  branch-columns.test.ts:140
713ms  branch-columns.test.ts:178
676ms  symmetric-half-order.test.ts:181
655ms  netlist-presentation.test.ts:583
650ms  local-loop-amplifier.test.ts:605
582ms  quality.test.ts:400
461ms  netlist-presentation.test.ts:302
445ms  quality.test.ts:597
428ms  netlist-presentation.test.ts:570
```

## Deviations and open questions

1. **The plan's own scan was wrong and this round corrected it.** The plan said
   83 and gave a per-file sample; that sample is exactly the set of `it.each`
   tests. Its stated criterion covers every planner test, so its count was
   short by 32 (115 on the plan commit) and, on the tree this round started
   from, by 97. Worth recording because a mechanical sweep's definition decides
   its answer, and the plan's was narrower than its goal.
2. **`stages.test.ts:255`** ("is deterministic for a synthetic 120-device
   document") is the slowest planner test in the package at **8.0 s locally**
   and already carries `}, 60000);`. On a 4× CI runner that is ~32 s — fine,
   but it is the closest to the budget of anything here.
3. **`held-out.test.ts` runs ~64 s locally** with a 30 s timeout written on its
   own line, so it is already over its own budget. Left alone (it already had a
   timeout); raising it or moving it to `*.slow.test.ts` is a policy call.
