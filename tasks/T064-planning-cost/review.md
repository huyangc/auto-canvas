# T064 review

## Round 1 — changes-requested

Reviewed: the round 1 report on `task/T064-planning-cost` on 2026-11-12.
Safe reuse and conservative budgets keep every plan identical and bring
deadtime to 7.8 s. ltc3452 (18.5 s), two-inverters (1.57 s) and
common-source (1.36 s) miss the targets; at that speed CI still risks the
60 s held-out and 15 s R22 timeouts. Codex correctly reported that no
cheap condition proves the R150 passes equal; the plan is amended to accept
a measured skip under a quality gate.

| #   | Severity | Where        | Finding                                                                   | Expected fix                                                          |
| --- | -------- | ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | must-fix | R150 wrapper | The second full pass still runs for every drawing with unlocked drafting. | Skip it under the amended condition; gate on the ≤10-part evaluation. |
| 2   | must-fix | timing       | Three targets missed.                                                     | Meet them, or report the remaining per-phase profile.                 |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted as a partial step (targets missed)

Reviewed: the round 2 report and `git status` on `task/T064-planning-cost`
on 2026-11-12; acceptance rerun by Opus.

Round 2 adds call-scoped reuse of immutable previews and audits, size-scaled
budgets that start above 20/24 instances, and an R150 skip that triggers on
one corpus drawing (2.49 → 0.90 s). Every plan in the ≤10-part evaluation and
all six large documents match T062 except that one drawing, whose metrics are
equal; all quality gates pass. Timing targets are missed (deadtime 36.2 s,
ltc3452 28.5 s, two-inverters 1.55 s, common-source 1.37 s; T062 46.5 / 36.9 /
2.4 / 2.25). Accepted as a quality-neutral ~20% saving; the remaining cost
(R150 second pass replanning every search, R147/R146 trial finishing) is the
next task. Note: the 7.8 s deadtime figure Opus quoted in round 1's amendment
came from a rejected budget curve, as the report records.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 655 tests
git diff --check → 0
```
