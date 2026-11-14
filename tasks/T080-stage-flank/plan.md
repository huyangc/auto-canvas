# T080 — Symmetric downstream stages flank their drivers, as a finished finalist

- Branch: `task/T080-stage-flank`
- Base: `main` at `8cdec30`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main `8cdec30` the frozen composite is dev 61.06
(1.271× human), val 33.58 (1.244×); crossings are two-thirds of the
remaining excess (dev 234 vs 154; val 143 vs 80, of which 30 are in one
drawing, `yje2n6eva2`, awaiting a user decision on repeated named ports).

The Opus analysis (2026-11-14, `tmp/gap2/`) found about 12 of the top-20 dev
excess crossings in drawings where a **mirrored second stage** is chained to
the right of (or stacked onto) the first stage instead of flanking it, or
where parallel stages run in the opposite order to their driver pins, so
nets from the first stage's left half cross the whole circuit to reach the
second stage's left half (`vcgtzej894`, `6qg2h7weje`, `m3ek9hty4p`,
`en97w8v92y`, `2bqpr5kx5c`, `jz7rweg6gg`). Its estimate: about 1 composite
unit on dev and 2 on val. No existing candidate had fewer crossings for the
flank cases, so a new placement is needed.

## Context

- R145 stage symmetry (`docs/specs/auto-layout.md:1154`, `stage-symmetry.ts`
  `stageComponents`): each stage component gets its own R89 block and axis;
  R89 symmetric blocks (`:860`, `symmetry.ts`, layered half layout); R53
  stage order with mirroring (`:478`, `stages.ts`); R54 fast estimate.
- Finished selection: `finished-selection.ts` (finalists `runner`,
  `localLoop`, `attachment`; `rankedFinalists` fixed order; margin rule
  `shouldFinishRunner`; comparator `selectFinishedLayout`). T077 / T079 show
  how a placement variant becomes an extra finalist (`place.ts`,
  `auto-layout.ts`); T079 bounds its variant to ≤ 24 instances and half
  budgets to keep runtime.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`,
  base `tmp/main-8cdec30-report.json`; `python3 tmp/excess.py <report>`.

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts` and
`readability-weights.ts`, `packages/auto-layout/test/**`,
`tasks/T080-stage-flank/report.md`. Proposed spec text goes in the report.

## Steps

1. **Investigate** the six dev drawings and the val drawings with excess
   crossings that contain two or more stage components: how the stages are
   composed by each strategy and which nets cross. Report how many cases are
   "downstream mirrored stage not flanking its driver" and how many are other
   stage-order problems.
2. **Flank variant.** When a stage component's left/right halves are driven by
   the left/right halves of another symmetric stage component (the driver's
   mirrored output nets reach the downstream pair's inputs), compose the two
   with a shared axis: the downstream halves flank the driver's halves on the
   outside, nearest to the driving nodes, with their attachments outward;
   otherwise order parallel stages by where their driver pins sit. Keep every
   R89 / R94 block rigid; never break a symmetry pair. Offer it as an extra
   finalist after `attachment` (≤ 24 instances, half budgets, participation
   gate as for `attachment`), so it is used only when its finished layout is
   better.
3. Tests: a two-stage fully differential amplifier whose second stage flanks
   the first, with fewer crossings; a non-symmetric chain is unchanged; a
   worse variant is rejected; determinism.
4. Evaluate all 628; review page human | main | T080 for the named drawings,
   the ten whose composite falls most, and the 25 samples.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-8cdec30-report.json`:

- Readability composite lower on dev and val; crossings lower on dev and val;
  no drawing's composite higher than main.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical; held-out medians within
  +20%.

## Notes for the implementer

- Recognise drivers and stages from connectivity and the existing symmetry
  topology; no ids, names, text or coordinates.
- Tune on dev; report val.
