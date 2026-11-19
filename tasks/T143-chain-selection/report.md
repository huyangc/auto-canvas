# T143 report — round 1

## Summary

The two places where the planner chooses between *finished* plans now charge a
CHAIN column, at one bend's weight (~100). On the 628-case corpus: **CHAIN
columns held rise 34 → 55 across the 67 cases that change** (a net +21), at a
cost of crossings 310 → 312, bends 2037 → 2053 and wire 522 177 → 524 363 — and
zero defects.

The annealer, refinement and every finishing pass still score with the old
`routedScore`, so their objective is unchanged; only `selectFinished` and
`reroutePortfolio`'s incumbent-vs-alternate comparison use
`finishedSelectionScore`, which is `routedScore` plus the CHAIN credit.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | partially | The implementer stopped before reproducing the 40-case selection audit; I took over and completed the corpus measurement myself. The audit numbers are not re-derived here — see "Deviations". |
| 2 | done | `chain-columns.ts`: `chainColumns`, `heldChainColumns`, `chainColumnCount`. The relation follows `pt-align/align-lib.js`: a non-rail Net with two conduction terminals on two devices, at least one a transistor, plus a tap terminal between them, collinear within 2 units with no body between. A MOS bulk is not a tap (that stays an R166 STACK). |
| 3 | done | One weight, `chainColumns: 100`, and one function, `finishedSelectionScore = withChainColumns(routedScore)`. Wired at `selectFinished`'s finalist comparison and in `reroutePortfolio`'s alternate acceptance. |
| 4 | not done | The per-class check (6 bend-only flip, 20 tie, 3 crossing-decided stay) was not run; the corpus numbers below stand in for it and the crossing count confirms the last part. |
| 5 | done | Corpus measured — see "Acceptance results". |
| 6 | not done | Owner-label effect not measured. |
| 7 | done | `chain-columns.test.ts` written. |
| 8 | done | What still does not move: the objects broken before the draft — see "Deviations". |

## Acceptance results

```text
npx vitest run packages/auto-layout → 77 files, 1129 tests, exit 0
pnpm typecheck → exit 0
pnpm format:check → exit 0
```

Corpus, 628 cases, main → this branch:

| metric | main | T143 |
| --- | --- | --- |
| completed / refused | 612 / 16 | 612 / 16 |
| crossings | 310 | **312** |
| bends | 2037 | 2053 |
| wire | 522 177 | 524 363 |
| missing / floating | 0 / 0 | **0 / 0** |
| plans changed | – | 67 |

CHAIN columns held, summed over those 67 cases (measured in three batches, each
planning with the branch's build and counting with the branch's counter):

| batch | before | after |
| --- | --- | --- |
| 20 cases | 17 | 25 |
| 20 cases | 12 | 17 |
| 27 cases | 5 | 13 |
| **total** | **34** | **55** |

Among the 67 changed cases, by crossings-and-bends alone: 32 worse, 15 better,
20 unchanged. That is the expected shape: the term trades bends for columns, and
the whole question is whether the columns are worth it — which the owner's own
judgement should settle, not this table.

## Deviations and open questions

1. **The implementer was stopped mid-task** (it had stopped producing output for
   40 minutes with no compute running). It had written all five files and got as
   far as the boundary trace; I ran the corpus measurement and wrote this record.
   The 40-case selection audit from step 1 was not re-derived, and the per-class
   decision check from step 4 was not run.
2. **The CHAIN counter is slow to run over a whole corpus**: one pass over the
   67 changed cases did not finish in ~40 minutes and had to be split into
   batches of 20. Worth knowing before anyone runs it over 628.
3. **The owner-label effect is unmeasured**, and that matters more here than in
   the earlier tasks: this change deliberately trades bends for a structure the
   owner asked for, so the only evidence that it is right is whether the drawings
   read better. The 67 changed cases are the natural blind-review set.
4. **What it does not fix**: the objects already broken before the draft (the
   trace measured 74 of 123 at the chain's start). No score term reaches those;
   they need a draft change, which the trace recommends studying separately.
