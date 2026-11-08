# T019 — Auto-layout: offline search by simulated annealing

- Branch: `task/T019-auto-layout-annealing`
- Base: `main` at `f7139d0`
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

Add an **offline optimization mode** to `planAutoLayout`. It improves the current
quick result by simulated annealing, using real routed cost as its energy.

The user decided (2026-11-07):

- an offline run may take up to 10 minutes when it gives a better result;
- results may differ from click to click;
- the quick mode stays as it is.

The editor job, its worker thread and its progress UI belong to T014. This task
delivers the algorithm, the public options and the evaluation.

## Context

### Why annealing, and why routed energy

- T016 showed placement causes the gap. On the human cases, human placement plus our
  router gives 176 crossings, against 884 for our placement plus our router.
- T018 measured the fast placement estimate (`createPlacementEstimator`,
  `src/estimate.ts`). It ranks routed crossings at a pooled Spearman of only 0.44 and
  predicts about one fifth of them. A search guided by that estimate made dev worse.
- The only search guided by real routed cost is today's refinement (`refineLayout`,
  `src/refine.ts`). It tries at most 14 binary flips: Cell Pin side and orientation.
- Opus measured one full plan (placement, routing and every R10 check, through
  `planLayoutOnce`) on the 32 completed human cases:

  | Instances | Median | Maximum | Evaluations in 10 minutes |
  | --------- | -----: | ------: | ------------------------: |
  | 1–20      |  90 ms |  201 ms |                    ~6,000 |
  | 21–40     | 179 ms |  408 ms |                    ~3,000 |
  | 41–120    | 820 ms | 2363 ms |                  ~250–700 |

  So annealing on real routed cost is affordable offline.

### Code facts

- `planAutoLayout` (`src/auto-layout.ts:43`):
  - routes three strategies and ranks them by `routedScore` (`src/refine.ts:53`);
  - refines the best two (R58, R63);
  - finishes with R44's routing alternative.
- `planLayoutOnce` → `buildPlan` (`src/auto-layout.ts:131-…`) does one full plan:
  - placement through `placeDocument` (`src/place.ts:91`);
  - edits, routing (`routeDocument`) and whole-list replay;
  - the R10 checks: `terminalPartition`, `lostNameClaim` and the audit.
- Inside `placeDocument`, the strategy produces device targets. Then
  `resolveCollisions`, `placeMarkers`, `orientByWireCost` and `placeMarkers` again
  finish the placement (`src/place.ts:185-210`).
- `geometryProblem` (`src/geometry.ts:92`) is the cheap legality check.
- `AutoLayoutOptions` (`src/types.ts:7`) has only `fixedInstanceIds`.
- R1 (`docs/specs/auto-layout.md:14`) requires byte-identical output with no
  randomness or time.
- Nothing outside the package calls `planAutoLayout` except
  `scripts/auto-layout-eval.mjs` and `scripts/auto-layout-review.mjs`.
- The machine running the evaluation has 18 cores.

### Binding constraints from earlier tasks

- The human cases are third-party drawings in git-ignored `tmp/human-cases/`.
  - Never commit any of them, any excerpt, any case id, or any id-keyed derived
    data.
  - Nothing in CI or `pnpm test:local` may depend on them.
- Tune on dev only (`sha256(id) % 3 != 0`). Report val separately. A result that
  improves only val is not accepted.
- R10, R23 and `lostNameClaim` stay as they are. The router does not change.

## Scope

Owned paths:

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs`, `scripts/auto-layout-review.mjs`

Throwaway probes go in git-ignored `tmp/`.

Out of scope:

- the editor, worker thread and progress UI (T014);
- the router and the Edit Engine;
- refitting the energy weights (T020);
- synthetic circuits (T021).

## Steps

1. **Public options.** Extend `AutoLayoutOptions` with an optional `search`:

   ```ts
   search?: {
     seed: number;                 // PRNG seed; never Math.random
     evaluations: number;          // budget of full routed evaluations
     deadline?: number;            // optional wall-clock cap, ms since epoch
     signal?: AbortSignal;         // cancel; return the best so far
     onProgress?: (p: { evaluations: number; best: number; current: number }) => void;
   }
   ```

   - Without `search`, output stays byte-identical to `main`. Every existing test must
     pass unchanged.
   - With `search`, a given seed and evaluation budget give byte-identical output.
   - Only a `deadline` or `signal` that cuts the run short may change the result.

   Amend R1 accordingly.

2. **Evaluate a given placement.** Add an internal path that skips the strategy and
   runs one full plan from given device placements:
   - placement finishing: `resolveCollisions`, `placeMarkers`, `orientByWireCost`;
   - then routing and every R10 check, exactly as `buildPlan` does today.

   Placement, routing and checking must not be duplicated. Investigate where the hook
   belongs and report it.

3. **R66 Simulated annealing.**

   **Start.** Begin from the quick-mode winner, which is the best result after R58
   and R63. Also keep the other valid strategies' routed results as alternative
   starting points.

   **State.** The device placements, plus Cell Pin sides and orientations.

   **Moves.** All move kinds below are general; none is keyed to a case, an instance id
   or a symbol id.

   - Swap two nodes in the same row, keeping their column slots. A recognized group
     moves as one unit.
   - Shift a node by one grid pitch or one column slot.
   - Mirror one ungrouped device.
   - Move, swap, reverse or mirror a whole stage block (stages strategy).
   - Flip one Cell Pin side.

   **Legality.** Reject illegal states before routing:
   - fixed instances move;
   - group templates break;
   - instances overlap or pins coincide (`geometryProblem`);
   - a position is off the grid.

   **Energy.**
   - Use `routedScore`. Keep its weights in one place so that T020 can replace them.
   - Refused runs have infinite energy and are never accepted.

   **Schedule.**
   - Set the initial temperature from sampled uphill deltas, so that about half of
     them are accepted.
   - Cool geometrically to near zero over the budget.
   - Keep the best state ever seen.
   - Use a seeded PRNG.

   **Result.** Run R44 once on the best state. The result can never score worse than
   quick mode.

4. **Investigate: estimate as a pre-filter.** On dev only, compare two variants at the
   same routed-evaluation budget:
   - route every proposed move;
   - propose k moves, rank them by the R54 estimate, and route only the best one.

   Keep the pre-filter only if it improves dev at equal budget. Report both curves.

5. **Evaluation script.** In `scripts/auto-layout-eval.mjs`, add:
   - `--search <seconds>`: sets a per-document deadline and an evaluation budget large
     enough not to bind first;
   - `--seed <n>`;
   - `--jobs <n>`: one Node worker per document, at most n at a time.

   Report per-document time, the evaluations used and the best-score curve.

6. **Tests.** Hand-built only:
   - without `search`, the result equals today's result;
   - the same seed and budget give identical edits;
   - search never moves a fixed instance or splits a recognized group;
   - the result's `routedScore` is never above quick mode's;
   - an aborted search returns a valid best-so-far plan;
   - every search result passes `executeTransaction` with an unchanged
     `terminalPartition`, no `lostNameClaim`, and no unsafe audit problems;
   - a small fixture where a known swap removes a crossing that quick mode leaves.

7. **Report.** Give each item for `--search` budgets of 30 s, 2 min and 10 min per
   document, with seed 1, against `tmp/t017-final-eval.json`:
   - the main metric (total crossings, all completed human cases);
   - dev and val separately, plus bends, floating pins and completed count;
   - corpus and held-out results with search;
   - evaluations used and time per document by size;
   - the spread over seeds 1–3 at the 2-minute budget;
   - six rendered pairs at 10 minutes, including both largest documents.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0, quick mode equals T017
pnpm auto-layout:eval tmp/human-cases --search 600 --seed 1 --jobs 12                 # expected: exit 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Round targets at the 10-minute budget, against `tmp/t017-final-eval.json`:

| Measure                      | T017           | Required               |
| ---------------------------- | -------------- | ---------------------- |
| Crossings, dev / val         | 268 / 487      | **both** lower         |
| Completed documents          | 32             | not fewer              |
| Bends, all completed         | 766            | not above              |
| Floating pins, all completed | 82             | not above              |
| Quick mode                   | 755 / 766 / 82 | identical              |
| Time per document            | —              | ≤ 10 min, deadline met |

Corpus targets and held-out ceilings must hold, with and without search.

## Notes for the implementer

- Use one general mechanism. Never key a move, weight or schedule to a case, a
  Reference, an instance id or a symbol id.
- Tune schedule parameters on dev only, at the 2-minute budget, and say which
  values you chose and why.
- If dev improves and val does not, or the reverse, say so plainly.
