# T063 — Level internal series devices in R30 for every strategy

- Branch: `task/T063-level-series-devices` (stacked on `task/T062-branch-columns`, PR #57)
- Base: `task/T062-branch-columns` at `18fbac2`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods only. After T062, ratios
to human on 627 completed ≤10-part drawings: crossings 1.735, bends 1.121,
wire 1.443, median area 1.424 (`tmp/le10-t062r1/report.json`).

T062 found the root cause of collapsed DC branches
(`tasks/T062-branch-columns/report.md`, investigation table): R30 adds no
level edge for a two-pin DC-conducting device between two non-rail Nets (a
series resistor inside a supply-to-ground branch), so that device and every
device below it stay in row 0 (198 devices in 122 dev drawings). T062 fixed it
only inside a separate "branch columns" candidate, which rarely wins the
portfolio, so crossings fell just 3%. This task moves the fix into R30 itself,
so the template, layered and stages strategies all level such devices.

## Context

- R30 (`docs/specs/auto-layout.md:362-368`, `layered.ts`): devices constrain
  Nets vertically (NMOS D above S, PMOS S above D, source + above −, BJT C/E by
  type); two-pin passives with a rail pin point away from that Net; other
  passives add no constraint; supply top, ground bottom; longest-path levels;
  cycles broken deterministically.
- T062 added `branch-columns.ts` and `branch-verticality.ts` and the
  scoreboard's branch verticality (dev 31.4% base vs human 46.0%; val 27.2% vs
  43.7%). Its inferred internal edges orient a series device along the DC path
  from supply to ground.
- Second cause from T062 (`dr4e8zhyjg`): a recognized group takes its members'
  minimum row, pulling a branch member out of its column; R33 skips
  group-to-singleton alignment. Investigate whether it matters on dev after
  step 1; fix only if general and measured.

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
base `tmp/le10-t062r1/report.json`. Third-party data under `tmp/le10-input/`,
never committed. Next free rule number after T062's.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T063-level-series-devices/report.md`.

Out of scope: other packages; optimized and partition modes' behavior (their
quick placements may change only if their own tests still pass and the change
is reported); documents above 40 instances (byte-identical); adding
instances.

## Steps

1. Add to R30 the inferred level edge for two-pin DC-conducting devices
   between two non-rail Nets, oriented along the DC path from supply to ground
   (reuse T062's inference). Keep cycle breaking deterministic. If the
   T062 candidate becomes redundant, remove it.
2. Measure on dev; if the group-row cause from T062 still costs crossings,
   investigate and report; fix only with a general rule and evidence.
3. Budget: paired median ≤ 1.5× base, aggregate p95 ≤ 1.5× base p95.
4. Tests: series resistor between two transistors in one branch; two branches
   sharing a gate Net; a resistor in a loop without a clear DC direction
   (must stay deterministic and unconstrained or consistently oriented).
5. Spec (R30 text); evaluate all 628; report dev and val, with verticality.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t062r1/report.json`:

- Crossings lower on dev **and** val; branch verticality higher on both.
- Bends, wire and median area not higher by more than 2% relative on either
  split.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; timing as in step 3.

## Notes for the implementer

- General method only: rails, DC-conducting pins and device classes as R50/R60
  define them; no branches on circuit type, tag, id, name or coordinates.
- Tune on dev; report val.
- If a tested contract blocks a clearly better layout, report it; do not edit
  the test.
