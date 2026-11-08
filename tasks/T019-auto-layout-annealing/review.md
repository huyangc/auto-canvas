# T019 review

## Round 1 — changes-requested

Reviewed: the uncommitted working tree after Codex round 1. Codex's report is accurate,
and it flagged the sprawl itself. Opus rebuilt the package, read the evaluation data,
and probed the sprawling document.

At 10 minutes the result is strong: 755 → 474 crossings, 766 → 517 bends, 82 → 66
floating pins, with dev and val both improving. Quick mode is unchanged. Corpus and
held-out targets pass at 10 minutes.

**Layout drift is systematic, not a single outlier.** The width ratio against quick mode,
on the human cases:

| Budget | Median width ratio | Documents above 1.3× | Worst |
| ------ | -----------------: | -------------------: | ----: |
| 30 s   |               1.00 |                    3 |  5.1× |
| 2 min  |               1.00 |                    3 | 22.2× |
| 10 min |               0.98 |                    3 |  100× |

The probe found the cause in the worst document. Every device had translated about
23,000 units to the right, while one ground marker on an unrouted Net stayed in place.
Three things combine:

- the energy is invariant to translation;
- an Net that is already unrouted costs the same at any distance;
- shift moves accumulate in the random walk.

The other drifting documents need the same check.

| #   | Severity | Where                                  | Finding                                                                                                                                             | Expected fix                                                                                                                  |
| --- | -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/search.ts`, `src/search-moves.ts` | The layout drifts without bound, as shown above.                                                                                                    | Plan step 8.                                                                                                                  |
| 2   | must-fix | `scripts/auto-layout-eval.mjs`         | The report has no span check, so drift went unnoticed until rendering.                                                                              | Plan step 9.                                                                                                                  |
| 3   | note     | 30 s and 2 min held-out                | `deadtime` exceeds its ceiling (21 against 17). Search trades crossings for one fewer unrouted Net and fewer bends.                                 | Accepted as an energy-weight question for T020. The 10-minute gate passes. The short-budget ceilings are reported, not gated. |
| 4   | note     | pre-filter, schedule                   | The four-proposal R54 pre-filter is kept on equal-budget dev evidence. Cooling within 256 evaluations, with restarts every 64, is justified on dev. | None.                                                                                                                         |

## Round 2 — accepted

Reviewed: the uncommitted working tree after Codex round 2. Codex fixed both findings.

- **R67:** the bounding box of every search state is limited to 1.5× the quick result.
  It is checked twice: when a move is proposed, and after shared placement finishing.
- **Anchoring:** each supplied state is anchored to the quick box's corner before
  markers are regenerated, so a pure translation yields the same plan.
- **Drift causes:** the two severe drift documents share the reported cause. The third
  one, at 1.40×, is local rearrangement.
- **Tests:** hand-built regressions cover a marker on an unrouted Net and a whole-layout
  translation.

Opus reran acceptance on lane 1:

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck / lint → 0
pnpm vitest run packages/auto-layout     → 0 (141 tests)
pnpm test:local                          → 0 (7422 passed, 116 skipped)
pnpm deadcode | grep auto-layout         → no output
pnpm build / auto-layout:review          → 0
pnpm auto-layout:eval ... (quick)        → 0; 268 / 487 crossings, 766 bends, 82 floating: identical to T017
pnpm auto-layout:eval ... --search 30 --seed 1 --jobs 12 → 0; 235 / 452 crossings, 723 bends, 81 floating
protected paths, tracked private data    → none
```

Opus checked Codex's 10-minute raw report:

- all 32 documents completed: 150 / 345 crossings, 540 bends and 68 floating pins;
- no unsafe geometry, and every document is equivalent;
- the slowest document took 599.9 s, and the largest width ratio against T017 is 1.30;
- two documents end with more crossings but a lower routed score: 26 → 30 and 7 → 8.
  This is the same weight question as review note 3, and is left to T020.

Deadline-limited runs vary with machine load: Opus's 30 s run gave 687 crossings, and
Codex's gave 704.

## CI fix on PR #22

CI failed on `ddafcc1`. The three R67 seed cases took 7–8 s each on the CI runner,
above vitest's default 5 s timeout; locally they finish within it. No assertion failed.
Every search test now has the same 30 s timeout as the other planner-heavy tests (the
held-out and large synthetic cases). The search tests pass (13).

A second CI run then timed out the corpus `two-inverters` case at 5016 ms. No assertion
failed. Both corpus test tables now use the same 30 s timeout.
