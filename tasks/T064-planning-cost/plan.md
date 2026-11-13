# T064 — Bring planning time on mid-size documents back down

- Branch: `task/T064-planning-cost` (stacked on `task/T062-branch-columns`, PR #57)
- Base: `task/T062-branch-columns` at `18fbac2`
- Status: approved

## Goal

CI fails on PRs #51–#57 with test timeouts only. The searches added by T056–
T062 multiplied planning time on mid-size documents, which the ≤10-part
evaluation (median and p95 over mostly small drawings) did not show. A user
waits 46 s for a 30-instance drawing that took 6 s before. This task brings
planning time back down with general budget and reuse changes, keeping the
layout-quality gains, and makes CI pass **without raising any test timeout**.

## Context

Single-process planning time of `planAutoLayout(document, resolver)` on this
machine (`tmp/fixture-timing.mjs <repo-root> <cases.json>`, per PR head):

| Head                             | deadtime (30 inst.) | ltc3452 (21) | two-inverters (9) | common-source (9) |
| -------------------------------- | ------------------: | -----------: | ----------------: | ----------------: |
| main `bdb5f36`                   |               5.8 s |        8.1 s |             1.0 s |            0.26 s |
| T055 `a022890`                   |                 6.0 |          8.2 |               1.0 |              0.26 |
| T056 `abaae9f` (R146 port seats) |                10.7 |          8.1 |               1.8 |              0.27 |
| T057 `05692db` (R147 relocation) |                19.6 |         13.2 |               1.8 |              0.55 |
| T058 `f37bf21` (rail search)     |                23.9 |         14.7 |               1.8 |              0.56 |
| T059 `408d0a7` (R149 gaps)       |                23.8 |         14.8 |               1.8 |              0.90 |
| T060 `ed8d78b` (R150 drafting)   |                45.2 |         29.1 |               1.9 |              1.70 |
| T061 `d18bbca` (budget 24)       |                46.8 |         36.0 |               2.2 |              2.25 |
| T062 `18fbac2` (branch columns)  |                46.5 |         36.9 |               2.4 |              2.25 |

CI failures on #57 (run 43337108719): `quality.test.ts` R22 cases
`two-inverters` and `common-source` (15 s timeout; each plans three times),
`branch-columns.test.ts` "routes the column portfolio deterministically"
(5 s), `held-out.test.ts` `deadtime` 153 s and `ltc3452` 122 s (60 s timeout).
CI runners are several times slower than this machine.

Main causes visible in the table:

- **R150 (T060)** runs the whole planner twice whenever unlocked drafting
  exists (`auto-layout.ts`, `planAutoLayout` wrapper calling
  `planWithFixedDrafting` for base and candidate), even when drafting never
  constrained the base layout.
- **R147 (T057)**, **R146 (T056)**, the rail search (T058) and R149 (T059)
  finish every trial with the full finishing passes; their trial caps do not
  scale with document size.
- **T061** tripled the annealer's evaluations for every document ≤ 40
  instances.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T064-planning-cost/report.md`.

Out of scope: test timeouts (must not change); other packages; layout rules
themselves (only budgets, reuse and skipping provably redundant work).

## Steps

1. **Profile** `deadtime`, `ltc3452`, `common-source` and `two-inverters` on
   the base and report time per phase (annealer, R147, R146, rail search,
   R149, R150 second pass, finishing passes).
2. **R150 reuse.** Run the drafting-free candidate only when drafting actually
   constrained the base plan (R10 moved the layout or a device/route meets
   drafting bounds); otherwise the candidate equals the base and must not be
   planned. Reuse anything else shared by the two passes.
3. **Size-scaled budgets.** Scale the trial caps of R146, R147, the rail search
   and R149, and the T061 annealer budget, by instance count, so small
   documents keep today's budgets and mid-size documents spend far less.
   Choose the curve by measurement; report it.
4. **Targets (this machine, single process):** deadtime ≤ 9 s, ltc3452 ≤ 12 s,
   two-inverters ≤ 1.5 s, common-source ≤ 0.6 s; and the full auto-layout
   suite passing with existing timeouts.
5. **Quality.** On the ≤10-part evaluation, crossings, bends, wire and median
   area each within +1% of `tmp/le10-t062r1/report.json` on dev and on val;
   guards (completed, equivalence, floating, missing, every `VISUAL_*`) not
   above it.
6. Spec (R66 budget and each changed rule), report with before/after timings.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, timeouts unchanged
node tmp/fixture-timing.mjs . held-out-cases.json   # step 4 targets
node tmp/fixture-timing.mjs . corpus-cases.json     # step 4 targets
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12   # step 5
```

The 6 large documents stay byte-identical; determinism holds.

## Notes for the implementer

- Same rules for every document; budgets may depend on instance count only.
- Prefer skipping provably redundant work over cutting useful search.
- Report each change's time saving and quality effect separately.
