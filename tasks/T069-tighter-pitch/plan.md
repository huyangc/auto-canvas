# T069 — Tighter placement pitch for small documents, with label repair

- Branch: `task/T069-tighter-pitch`
- Base: `main` at `eb72cb1`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
1.2× of the human Gallery drawings on crossings, bends, wire and median area,
by general rules only. After T068 (628 ≤10-part drawings, ratio to human,
dev / val): crossings 1.81 / 1.91, bends 1.09 / 0.98, wire 1.30 / 1.39, median
area 1.27 / 1.23. Placement pitches are much larger than human spacing. Opus
measured on T068 with the three pitch constants made configurable (all 628,
`/tmp/ac-exp`, env `ROW_P` / `MEM_P` / `COL_P`):

| Row / member / column  | Crossings   | Bends       | Wire        | Median area | Label clearance | Run-on | Wire through symbol |
| ---------------------- | ----------- | ----------- | ----------- | ----------- | --------------: | -----: | ------------------: |
| 120 / 100 / 160 (main) | 1.81 / 1.91 | 1.09 / 0.98 | 1.30 / 1.39 | 1.27 / 1.23 |             191 |     40 |                  17 |
| 100 / 80 / 120         | 1.75 / 1.88 | 1.11 / 0.99 | 1.25 / 1.32 | 1.20 / 1.17 |             206 |     48 |                   8 |
| 80 / 80 / 120          | 1.79 / 1.99 | 1.13 / 1.03 | 1.19 / 1.28 | 1.14 / 1.10 |             215 |     47 |                   8 |
| 120 / 100 / 100        | 1.75 / 1.54 | 1.09 / 0.90 | 1.28 / 1.28 | 1.25 / 1.22 |             196 |     34 |                  17 |

(The last row refused one drawing, `yje2n6eva2`; missing connections were 17
instead of 16 in all three experiments.) Tighter pitch reaches the area target
and most of the wire target, but crowds labels. This task makes tighter pitch
the default for small documents and repairs the labels it crowds, so that the
label guards do not rise.

## Context

- Constants: `packages/auto-layout/src/geometry.ts:25-29` (`ROW_PITCH = 120`,
  `MEMBER_PITCH = 100`, `COLUMN_PITCH = 160`). Users: `layered.ts` (rows, half
  rows, block widths: lines 222, 256, 308, 346, 438-442, 542-547, 917),
  `template-placement.ts` (lines 142-405), `place-fallback.ts` (R9, lines
  35-220), `place.ts:82`, `search-moves.ts:245,306` (annealing step sizes).
  They are module constants; documents above 40 instances must keep today's
  values (the six large plans byte-identical), so the pitch has to become a
  per-document value (for example on `NetRoles`, which already carries
  `instanceCount`, or a small pitch object passed down).
- Spec: R31 "Row pitch is 120 units" (`docs/specs/auto-layout.md:391`), R18 /
  member pitch (line 217, 324-325), R9 column pitch (line 232), R89 axis pitch
  (line 872). T034 memory: rows were not compacted because corpus tests pin
  exact row relations (tail +120, feedback capacitor −120).
- Post-hoc label repair already exists for stubs (T067,
  `packages/auto-layout/src/stub-seat.ts` `repairStubLabels`: diagnosed
  `VISUAL_LABEL_CLEARANCE` / `VISUAL_LABEL_RUN_ON`, bounded trials, accept
  when the targeted diagnostic disappears, no routed guard rises and
  `compactionRegresses` is false). Gap closing R149 and relocation R147 run
  after placement and decide by `calibratedScore` + `routedGuards`
  (`routed-search-score.ts`).
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  base report `tmp/t068-opus/report.json` (T068 head; main `eb72cb1` produces
  the same plans). Held-out timing: `node tmp/fixture-timing.mjs . held-out-cases.json`
  against an isolated main build (see T068 report for the paired method).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T069-tighter-pitch/report.md`.
Out of scope: other packages, `@icm/derived` diagnostics, the evaluator
(no metric changes), documents above 40 instances (must stay byte-identical).

## Steps

1. **Per-document pitch.** Replace direct uses of the three constants with a
   per-document pitch: today's values above 40 instances; tighter values up
   to 40 instances. Start from row 100 / member 80 / column 120 and tune on dev
   only (grid multiples; try at least 100/80/120, 80/80/120, 100/80/100). Keep
   R18 pin-aligned stacks, R89 axis rules and R94 rigid blocks valid with the
   new values.
2. **Label repair.** After routing and label finishing, for each label that a
   `VISUAL_LABEL_CLEARANCE` / `VISUAL_LABEL_RUN_ON` / `VISUAL_LABEL_OVERLAP`
   diagnostic names, try opening space locally: move the implicated instance
   (or its row / column neighbour) away by one old-pitch difference, or reuse
   the T067 stub extension. Bounded (≤ 12 trials, stable order), accept like
   T067: targeted diagnostic gone, no routed guard rises, no new crossing or
   bend (`compactionRegresses`). Prefer extending the existing repair over a
   new pass.
3. **Investigate** any refusal or new missing connection the tighter pitch
   causes (the experiments lost one connection and refused `yje2n6eva2` at
   column 100); fix generally or keep the old pitch for that document through
   the existing finished-score fallback. Report.
4. Tests: a small document gets the tighter pitch and a >40-instance document
   keeps the old one; a crowded label gets repaired; determinism.
   **Authorized test rewrites (old geometry only):** assertions that pin exact
   distances derived from 120 / 100 / 160 (row offsets, member spacing, column
   spacing) may be updated to the new per-document values; keep each test's
   behavioral intent. List every rewritten assertion in the report.
5. Spec (R9, R18, R31, R89 text and the repair rule); evaluate all 628; render
   the 25-sample review page (human | main | T069) as in T068.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0, no timeout raised
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/t068-opus/report.json`:

- Median area ratio and wire lower by at least 4% relative on dev **and** val.
- Crossings and bends not higher by more than 1% relative on either split.
- Guards: completed 628; none non-equivalent; floating ≤ 6; missing ≤ 16;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; held-out times within
  +10% of main (five alternating pairs for any fixture above +10% in the
  first pass).

## Notes for the implementer

- Same rule for every document of a size class; no circuit-, id- or
  coordinate-specific code.
- Tune on dev; report val.
- If a tested contract other than the authorized geometry pins blocks this,
  report it; Opus decides.
