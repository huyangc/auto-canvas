# T076 — Owned drafting follows when fixed ink blocks reuse, and pinless owners

- Branch: `task/T076-drafting-follow`
- Base: `main` at `01fd2ad`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human). After T074 the frozen readability composite is dev 71.72
(1.49× human), val 36.62 (1.36×). `unownedDrafting` (drafting groups with no
nearby owner after layout) is 36% of the remaining dev excess: 64 vs human 15.
An Opus analysis (2026-11-14, instrumented copy of `dist`, every plan hash
matching main) traced the excess groups:

- **16 groups:** when fixed remote ink sits close to the devices,
  `fixedDraftingBlocksReuse` makes R150 return the R10-shifted base
  (`auto-layout.ts:372`), so no owned group follows its owner either
  (`nqksde5dtj` 6, `e5t32hnn2g` 3, others 2 each).
- **24 groups:** the owner is a wire or junction on a Net with no terminals (a
  drawn wire touching no pin). Routing drops that Net and
  `draftingDisplacements` refuses the group (`drafting-groups.ts:244`,
  `owner.net === "[]"`); 10 of them in the block-diagram drawing `qj62dz4qvm`.
- 8 groups have no free seat (all 81 offsets collide); 2 others.

Two experiments measured on all 628 drawings (no drawing worse in either):

- **U1** — in the fixed-ink branch, return
  `followDraftingGroups(document, resolver, base, base, ownedGroups)` instead
  of the bare base: dev −2.64 composite units (unowned −15), val −0.20.
- **U2** — a group whose owner is on a terminal-less Net follows the nearest
  visible instance in the source (in `draftingDisplacements` only; the
  ownership inference `draftingGroups` used by the metric stays unchanged):
  dev −2.46 (unowned −14), val −0.70.

Implement both properly.

## Context

- R150 (`docs/specs/auto-layout.md`, "Drafting follows layout", T072 text),
  `auto-layout.ts` around line 360–390 (fixed-ink branch),
  `drafting-search.ts` (`fixedDraftingBlocksReuse`),
  `drafting-groups.ts` (`draftingGroups`, `draftingDisplacements`),
  `follow-drafting-groups.ts` (`followDraftingGroups`).
- Experiment patches and harness from the analysis (instrumentation of a
  `dist` copy, for reference only): `tmp/patch_al.py`, `tmp/patch_pinless.py`,
  `tmp/exp.mjs`, `tmp/expagg.py`, `tmp/seattrace.mjs`, `tmp/seatclass.py`,
  `tmp/dispclass.py`, `tmp/unowned.py`.
- Metric: `readability-metrics.ts` `unownedDrafting` — do not change the metric
  or `readability-weights.ts`.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`,
  base `tmp/main-01fd2ad-report.json`; `python3 tmp/excess.py <report>` prints
  the per-metric excess.
- Parallel work: T075 edits `readability-metrics.ts` and
  `readability-selection.ts` (performance only, plans unchanged). Do not edit
  those.

## Scope

Owned: `packages/auto-layout/src/auto-layout.ts` (the R150 fixed-ink branch
only), `drafting-groups.ts` (`draftingDisplacements` only),
`follow-drafting-groups.ts`, `drafting-search.ts`,
`packages/auto-layout/test/**`, `docs/specs/auto-layout.md` (R150),
`tasks/T076-drafting-follow/report.md`.

## Steps

1. **U1.** In R150's fixed-ink branch, keep the base placements (R10 shift
   retained) but still move and seat owned groups with
   `followDraftingGroups`, under its existing guards; fixed and unowned ink
   stay as they are.
2. **U2.** In `draftingDisplacements`, a group whose owner sits on a Net with
   no terminals follows the nearest visible instance of the source document
   (by bounds distance; ties by id). Never invent ownership in
   `draftingGroups`.
3. Tests: fixed remote ink near the devices no longer stops an owned caption
   from following; a group drawn on a pinless wire follows the nearest
   device; determinism; locked groups untouched.
4. R150 spec text; evaluate all 628; review page human | main | T076 for the
   drawings whose unowned count changes most (at least 12) plus
   `75k4jskamd`, `qj62dz4qvm`, `nqksde5dtj`.

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

Against `tmp/main-01fd2ad-report.json`:

- `unownedDrafting` lower by at least 30% on dev, not higher on val;
  readability composite lower on dev and val.
- No other weighted readability metric higher by more than 2%; crossings,
  bends, floating, missing not higher; every `VISUAL_*` total not above main
  except label clearance (zero readability weight).
- 628/628 equivalent; determinism; six large documents byte-identical unless
  their drafting changes (then show them); held-out times within +10%.

## Notes for the implementer

- General rules only; no ids, text or coordinates.
- Tune on dev; report val.
