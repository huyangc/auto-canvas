# T065 — R150 candidate from the searched base plan, not a second full plan

- Branch: `task/T065-r150-reuse-search` (stacked on `task/T064-planning-cost`)
- Base: `task/T064-planning-cost` at `de5be0e`
- Status: approved

## Goal

Planning time on mid-size documents is still several times main's (T064
report: deadtime 36.2 s vs 5.8 s on main, ltc3452 28.5 s vs 8.1 s), which is
why CI times out on the stacked PRs. The largest single cost is R150's
drafting-free candidate: it reruns the whole planner, including the annealer,
R147 relocation, R146 port seats, rail search and R149, a second time
(deadtime 18.4 s, ltc3452 14.2 s of the totals). This task builds that
candidate from the already searched base plan instead, so the searches run
once. Work valid whichever product option the user picks for the speed/
quality trade (pending), because it removes duplicated work.

## Context

- R150 (`planAutoLayout` wrapper in `auto-layout.ts`; `drafting-groups.ts`,
  `follow-drafting-groups.ts`, `drafting-search.ts`): plan the base with
  drafting as obstacles (R10 pushes the layout down until clear), plan a
  candidate with movable drafting removed, then move owned groups with their
  owners and seat them; keep the candidate if its finished calibrated score is
  not higher and no guard increases (T060).
- R10's drafting clearance is a whole-layout translation
  (`place.ts:500-556`): the base and drafting-free placements differ by that
  translation plus any search decision that drafting influenced (for example
  R149 span scores and label seating, which T064 found also read drafting).
- T064 profile per fixture (`tasks/T064-planning-cost/report.md` lines
  176-207) and reuse helpers (`planning-reuse.ts`, `planning-budget.ts`).
- Timing script: `node tmp/fixture-timing.mjs . held-out-cases.json` and
  `… corpus-cases.json` (single process; absolute root resolved).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T065-r150-reuse-search/report.md`.
Out of scope: test timeouts; other packages; R146/R147 algorithms (their
trial cost is a later task).

## Steps

1. Build R150's candidate from the base plan's final placements: undo the
   R10 drafting translation, keep every searched device, port and marker
   placement, then move owned drafting groups with their owners, seat them,
   and run the finishing passes once. Only replan from scratch if that
   candidate fails geometry or routing checks.
2. Keep the existing comparison (finished calibrated score not higher, no
   guard increase) between base and candidate.
3. Measure: timing per fixture and the ≤10-part evaluation.
4. Tests: existing R150 tests pass unchanged; add one that asserts the
   searches run once when the candidate is built (for example via the
   timing/evaluation counters).
5. Spec (R150 text); report before/after per phase.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, timeouts unchanged
node tmp/fixture-timing.mjs . held-out-cases.json
node tmp/fixture-timing.mjs . corpus-cases.json
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

- Timing: deadtime and ltc3452 at least 35% faster than T064 (36.2 s, 28.5 s).
- Quality against `tmp/le10-t062r1/report.json`: crossings, bends, wire and
  median area each within +1% on dev and on val; completed ≥ 627; none
  non-equivalent; floating ≤ 10; missing ≤ 18; every `VISUAL_*` total not
  above it.
- Determinism; the 6 large documents byte-identical.

## Notes for the implementer

- Same rule for every document; no case-specific code.
- Report how many drawings change plan and why.
