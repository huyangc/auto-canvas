# T151 review

## Round 1 — accepted

Reviewed: the working tree on `task/T151-refinement-direction` against the base
`7256569` (PR 106 head) on 2026-11-22; acceptance rerun by Opus.

Changed paths are all in the plan's owned paths; `plan.md` unchanged; no
dependency or lockfile change.

| #   | Severity | Where                                                 | Finding                                                                                                                                                                   | Expected fix        |
| --- | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | note     | `packages/auto-layout/src/netlist-power-flow.ts`      | The `y` condition is the exact negation of the old loop's skip test (`!differential`, `flow.y <= 0`, `overall.y <= 0`, not both zero).                                    | none                |
| 2   | note     | `packages/auto-layout/src/netlist-reflection-veto.ts` | Matches the measured rule: a port missing from the incumbent reads as half 0, so an input on the right or an output on the left still vetoes; the neutral band is strict. | none                |
| 3   | note     | `packages/auto-layout/src/netlist-port-sides.ts`      | The `mirrored` flag is set per frame and cleared after the frame loop, so the slide and corridor trials that follow are not vetoed.                                       | none                |
| 4   | note     | `pnpm deadcode`                                       | Exits 1 as on the base; none of its items is in a file this task touches.                                                                                                 | none (pre-existing) |

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (oxlint: 2170 files, 0 errors, 3896 warnings)
pnpm format:check → 0
pnpm docs:check → 0
pnpm test:local → 0 (841 files passed, 3 skipped; 8673 tests passed, 117 skipped)
pnpm test:slow → 0 (2 files, 8 tests passed)
netlist corpus eval → 0
gate vs tmp/exp/runs/T151b --same-plans → GATE PASSED (499 completed, 16 refused; re-export 495 identical, 4 blocked; 0 plans differ)
gate vs tmp/exp/runs/s0 --differ 31 → GATE PASSED (31 plans differ from the base)
drawing corpus eval → 0
gate vs tmp/pr106/pr-drawing --same-plans → GATE PASSED (612 completed, 16 refused; 0 plans differ)
```

## PR review round 1 — one test fix by the reviewer

codex (gpt-6.2-sol) on `e3eec9e`: no production defect; [P2] the R170 regression
test in `netlist-port-sides.test.ts` passed a router that returns nothing, so
only the directly reflected plan reached the veto. Fixed by the reviewer (a few
lines, test only): the fixture now returns the planner's own router, and the
test runs once without a router and once with it. With the veto disabled both
rows fail.
