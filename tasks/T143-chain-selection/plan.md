# T143 — the selection prefers a plan that keeps a column when it can

- Branch: `task/T143-chain-selection`
- Base: `main` at `f170314` (after T141, T142 and T144 merged)
- Status: approved under the owner's 2026-11-16 goal (the owner's comment
  #38 asks for exactly this: "在两个器件中间，如果有一根线连出去，当前总是把这个结构给折掉")

## Goal

The owner's comment #38 — "在两个器件中间，如果有一根线连出去，当前总是把这个结构给折掉" — is the last large structure complaint without a fix. Two pre-tests have narrowed it:

- The relation is **CHAIN**: a non-rail Net whose two conduction pins are collinear across their exit axis with a third tap terminal between them. Planner 445/646 (68.9%), human 576/653 (88.2%), 150 planner-only breaks.
- The break is **not** in the finishing passes. 91 % of the breaks are already present when R147 first runs, and a monotone guard there can protect at most 11 of 123 objects (it fixed 4). A draft-level candidate fixed 0 of 628 plans.
- It **is** in the selection. On the 40 cases where `selectFinished` compared two finished finalists, the **quick one holds more CHAIN in 29** (40 objects), ties in 10, and the searched one is better in 1. The better drawing already exists; the score declined it on bends/wire — 6 of the 29 decisions turn on **bends alone**, 20 on bends plus a small wire gain, and in all 29 the kept finalist has no more crossings than the quick one.

After this task the planner charges a broken CHAIN Net in the two places where a finished plan is chosen between alternatives, at a weight of about one bend. It should keep 40–55 more of the 123 objects, at a cost of roughly one bend per affected case, with no drawing electrically worse and nothing refused.

## Context

Measured by `tmp/handoff/pt-chain-trace/results.txt` (read sections 4–5 completely) in the coordinator's worktree, on main `cebad62`.

Where the 123 facing CHAIN breaks first appear, keyed to the finishing chain that emitted the plan:

| boundary | broken / 123 |
| --- | --- |
| draft (chain start) | 74 |
| annealed finalist (`searchedFinal`) | +39 (65/67) |
| `selectFinished` pick | 63/65 |
| `reroutePortfolio` | 112 (49 breaks — **all from an alternate finalist replacing the incumbent, none from routing**) |
| R146 / R145 | 0 |
| R147 | +2 |
| R149 | +4 |
| R167 | 0 |
| labelRepair | +6 |

Corrections to earlier measurements, both worth knowing so nobody re-derives them: `pt-align` §8's trace probe was keyed on the `finishFinalist` counter instead of the per-`finish()` chain, so its "broken at entry" figure (4/20) is wrong and the right one is 112/123; `pt-chain-draft` §5's "the draft draws 123 aligned" holds only for the 4 cases it instrumented — on the population 74/123 (60 %) are already broken on the draft.

Also relevant: the planner's own R152 branch candidate (`auto-layout.ts:1825-1857`) draws **32 of the 74 draft-broken objects as held** and was emitted **0 times**, losing the same score comparison. A score term at the same weight makes it win where it is the only candidate that holds the column — which is why this is a score term rather than a candidate-specific rule.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/chain-columns.ts` (new — the counter)
- `packages/auto-layout/src/refine.ts` (the weight and the term)
- `packages/auto-layout/src/auto-layout.ts` (the selection points, if the term does not reach them through `routedScore`)
- `packages/auto-layout/src/reroute-portfolio.ts`
- `packages/auto-layout/test/chain-columns.test.ts` (new)
- `packages/auto-layout/test/*.test.ts` (recorded hashes, where the change moves a plan for the stated reason)

Out of scope (do not change):

- Any finishing pass, any guard, `stackPairs`, `alignStacks`, the draft portfolio's order.
- Draft-level repair for the 74 objects the draft already breaks — a separate study (a per-move anneal trace of the 29 cases is the next step there).
- The annealing objective. Putting the term into `compareRuns` globally would change what the annealer optimises, which is a different and larger question; this task puts it only where a finished plan is chosen between alternatives.
- `compareCompleteness`, `preferIntact` or anything T141 added.

## Steps

1. **Investigate: reproduce the selection audit.** Re-run the 40 multi-finalist cases from `pt-chain-trace/selection.json` and confirm: quick holds more CHAIN in 29, equal in 10, searched better in 1; median score cost of the better-CHAIN choice 115. Record the numbers; they are the test's ground truth.
2. **Write the counter.** `chain-columns.ts` exporting `chainCount(document, resolver): number` — the number of CHAIN Nets drawn as held. Reuse the relation definition from the pre-tests (`pt-chain.js` / `align-lib.js`) so the number matches what they measured: a non-rail Net with exactly two conduction terminals on two different devices plus a third tap terminal between them, collinear across their exit axis with no device body between. Netlist-only, no new IR, memoised per document.
3. **Wire it in.** Add one weight to `ROUTED_SCORE_WEIGHTS` — `chainColumns: 100`, i.e. one bend — and add the term to `routedScore`. Verify it reaches both selection points: `selectFinished` (which compares two `routedScore`s through `compareRuns`) and `reroutePortfolio`'s incumbent-vs-alternate comparison. If `reroutePortfolio` does not compare through `routedScore`, add the term at its own comparison site rather than restructuring it.
4. **Check the three decision classes.** On the 29 cases: the 6 bend-only decisions must flip, the 20 bend+wire ones must tie or flip, and the 3 crossing-decided ones must **not** flip (no crossing may be bought by a CHAIN). If any of the 3 flips, the weight is too high — report it rather than tuning it further.
5. **Measure the corpus.** On all 628: CHAIN held before/after (target 445/646 → at least 485/646), plans changed, crossings (must stay 310), bends (expected ≤ 2037 + affected cases), wire, defects, status, and the R166 stack and symmetry counts. Then the netlist corpus too, since the term is netlist-only in its input.
6. **Owner labels.** Effect on the 71 labelled rows and on the 46 drawings the owner called "better". Sealed ids aggregate only.
7. **Tests.** `chain-columns.test.ts`: the counter on a held CHAIN, a broken one, a two-device Net with no tap (not a CHAIN), a rail Net (excluded), and a Net whose third terminal is outside the two pins (not between). Plus a planning test asserting the R152 branch candidate is selected on one of the 29 named cases.
8. **Record what does not move.** The 74 draft-broken objects cannot be fixed here; state how many of the 123 remain broken after the change and why.

## Acceptance

```bash
pnpm --filter @icm/auto-layout test
pnpm typecheck
pnpm lint
pnpm format:check
```

Behavioral:

- 628-case corpus: crossings 310 unchanged; 0 defects, 0 new refusals; CHAIN held improves by at least 30 objects.
- The 29 named cases: emitted CHAIN ≥ the quick finalist's CHAIN on each.
- The 3 crossing-decided cases: unchanged.
- R166 stacks and the symmetry counts reported; any degradation named with its cases.

## Notes for the implementer

- The weight is **one bend** (100). Do not tune it upward to catch more objects: the study showed the 3 crossing-decided cases are where a larger weight starts buying crossings, and there is no evidence the owner prefers a CHAIN over a crossing.
- A CHAIN Net that is broken in **every** candidate cannot be charged for — the term must be a count of held CHAINs, not of broken ones relative to some reference, or the plan that has fewer Nets altogether would win. Count what is held.
- Do not add the term to `compareRuns` globally. See the scope note.
- Timeouts: any test that runs the planner needs `60_000`; the default 5 s fails on CI.
