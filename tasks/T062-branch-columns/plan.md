# T062 — Draw DC branches as vertical columns

- Branch: `task/T062-branch-columns` (stacked on `task/T061-default-search-budget`, PR #56)
- Base: `task/T061-default-search-budget` at `d18bbca`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods only. After T061 on the
627 completed ≤10-part drawings, ratios to human: crossings 1.78, bends 1.14,
wire 1.46, median area 1.41 (`tmp/le10-t061r3/report.json`). Crossings are the
largest gap; the 20 worst dev drawings carry 74 of 192 excess dev crossings,
and they are bias and reference circuits.

In those drawings humans draw every DC branch (supply → devices in series →
ground) as one vertical column under a supply bar, branches side by side,
with amplifiers between them. The auto layouts put the same devices in one
horizontal band: branch members end up in different columns and rows, and
wires cross. Examples on dev (for diagnosis only): `2adejzy693` (human 0
crossings, auto 10), `ray97q5c2j` (0 / 6), `dr4e8zhyjg` (0 / 5),
`7aevq3rx4z` (0 / 4). This task finds why the existing layering does not
produce branch columns and fixes it generally.

## Context

The machinery for this exists (`docs/specs/auto-layout.md`):

- R30–R33 (lines 362-387, `layered.ts`): net levels (NMOS D above S, PMOS S
  above D, BJT collector/emitter per type, supply forced top, ground bottom,
  longest-path levels), rows, barycentre order, Brandes–Köpf-style columns
  aligning shared channel pins (R18).
- R50–R59 (lines 446-500, `stages.ts`): stages are components joined on
  non-rail Nets through DC-conducting pins; each stage laid out with R30–R33;
  stages share rails (R52), are ordered by R53/R54, spaced by R56; R59 attaches
  single-device stages to hosts.
- R55/R58: template, layered and stages compete by routed score.
- Then R147 relocation, R146 port seats, rail search, R149 gap closing, R150
  drafting, all decided by `calibratedScore` and `routedGuards`
  (`routed-search-score.ts`).

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
base `tmp/le10-t061r3/report.json`. Third-party data under `tmp/le10-input/`,
never committed. New rules take R151 and up.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `scripts/auto-layout-eval.mjs` (metric in step 1
only), `tasks/T062-branch-columns/report.md`.

Out of scope: other packages; optimized and partition modes (partition
fallback keeps its T061 budget); documents above 40 instances
(byte-identical); adding instances.

## Steps

1. **Metric.** Add to the evaluation scoreboard a general "branch verticality"
   measure, for human and result: among pin-to-pin connections between two
   devices on a non-rail Net through DC-conducting pins (R50's definition),
   the share drawn as a single straight vertical wire segment. Report it per
   split.
2. **Investigate** on the four example drawings and on dev overall: which
   strategy wins, how R30 levels and R31 rows come out for each branch, and at
   which step branch members leave a common column (levels, rows, order,
   columns, stage merging, R59 attachment, or a later search). Report findings
   with evidence.
3. **Fix the dominant cause generally.** Options, to choose by step 2: make
   R30/R31 place a branch's series devices in consecutive rows of one column;
   align series channel pins as R33 stack links; let R53 order branches by
   their shared control Nets; or add a "branch columns" candidate to the
   R55/R58 portfolio. Decide by finished routed score with the existing guards.
4. Budget: paired median ≤ 1.5× base, aggregate p95 ≤ 1.5× base p95.
5. Tests: synthetic circuits with two and three supply-to-ground branches
   joined by a gate Net and by an amplifier; determinism; locks.
6. Spec; evaluate all 628; report dev and val.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t061r3/report.json`:

- Crossings lower on dev **and** val; branch verticality higher on both.
- Bends, wire and median area not higher on either split by more than 2%
  relative.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; timing as in step 4.

## Notes for the implementer

- General method only: rules may use supply/ground rails, DC-conducting pins,
  channel pins, Nets and device classes as R50/R60 define them; no branches
  on circuit type, tag, id, name or coordinates. The example drawings are for
  diagnosis, never special-cased.
- Tune on dev; report val.
- If a tested contract blocks a clearly better layout, report it; do not edit
  the test.
