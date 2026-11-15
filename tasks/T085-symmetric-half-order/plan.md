# T085 — Two-pin parts outside the transistors in a symmetric half (gated)

- Branch: `task/T085-symmetric-half-order`
- Base: `main` at `578a79e`
- Status: approved

## Goal

Finish the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). After T084, dev composite is about 52.880 vs human
43.900 (**1.2046×**), val 1.164×. Dev must fall by about **0.2 composite
units** (≈ 2 ordinary crossings) without val rising above 1.2× and with no
drawing worse.

T080's investigation found dev `m3ek9hty4p` (human 0 crossings, result 4,
composite excess 0.434): inside one R89 symmetric block, the capacitor and
resistor pairs sit **closer to the axis** than the transistor pairs. The left
drain Net `M1.D/M2.D/R.2` crosses `C.2/M1.G/R.1` twice, and the right half
mirrors it. All three strategies produce the same core, so no existing
candidate has fewer crossings. Humans place such two-pin feedback / load
parts on the **outside** of their transistor (away from the axis) so the
drain and gate nets do not cross. The same pattern may exist in other dev /
val drawings with symmetric blocks.

## Context

- R89 symmetric blocks: `docs/specs/auto-layout.md:983`, `symmetry.ts`
  (`symmetryTopology` `:70`), half layout built from left partners with R32 /
  R33 node order; cross-coupled members move next to the axis; two-pin parts
  keep R31 orientation. The block is one rigid unit afterwards (R94).
- R145 stage symmetry (`stage-symmetry.ts`), R92 facing.
- Finished finalists (`finished-selection.ts`: runner, localLoop, attachment,
  gateRow) if a variant is needed; T078 comparator.
- Frozen readability: `readability-metrics.ts`, `readability-weights.ts`
  (do not change).
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  baseline `tmp/main-578a79e-report.json`; `python3 tmp/excess.py <report>`;
  `python3 tmp/opus-compare.py <baseline> <report>`. T080 round 1
  investigation (on branch `task/T080-stage-flank`,
  `tasks/T080-stage-flank/report.md`) has the `m3ek9hty4p` net details.
  Dependencies are installed and `pnpm build` passed. Main's build is at
  `/tmp/t085-baseline/dist`. Large documents / timing: `tmp/t080-harness/`
  (fix `W`, output paths and baseline import; T080 needed a local
  module-resolution link for `@icm/*`). Dumps / render helpers from an older
  main: `tmp/gap3/`.

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts`,
`readability-rail-crossings.ts`, `readability-weights.ts`;
`packages/auto-layout/test/**`; `tasks/T085-symmetric-half-order/report.md`.
Proposed spec text goes in the report.

## Steps

1. **Investigate (gate).** Find every dev and val drawing whose result has a
   crossing between two nets inside one R89 block half where a two-pin part
   sits between its transistor and the axis (or otherwise inward), and what
   the human does. Prototype the ordering change on `m3ek9hty4p` and two
   others. **Gate:** continue only if the prototype lowers the summed frozen
   composite of the prototyped drawings by at least 0.2 without raising any
   of them; otherwise stop and report.
2. **Implement** generally, from connectivity and pin roles only: in the
   half layout, a two-pin part whose non-rail pins connect only to one
   transistor's terminals (e.g. drain–gate feedback, drain load) is ordered
   on the side of that transistor away from the axis; cross-coupled members
   and axis devices keep their R89 positions; mirror pairs stay mirrored. If
   changing the default would move other drawings, offer it as an extra
   finished finalist instead (fixed order after `gateRow`, ≤ 40 instances,
   T078 comparator decides).
3. Tests: a symmetric pair with drain–gate RC feedback lays the RC outside
   with fewer crossings; a block without such parts is unchanged; symmetry
   preserved; determinism. Synthetic circuits only.
4. Evaluate all 628; review page for the affected drawings and the 25
   samples.

## Acceptance

Same commands as T084 (`pnpm build`, `typecheck`, `lint`, `format:check`,
`test:local` with local services, `test:slow`, full evaluation). Dev
composite ≤ 52.68 (≤ 1.2× human) is the target; dev lower and val not higher
than main are required; no drawing worse; 628/628 equivalent; guards;
determinism; six large documents identical; held-out medians within +20%.
