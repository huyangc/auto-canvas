# T041 — Auto-layout: one symmetry axis per stage

- Branch: `task/T041-auto-layout-stage-symmetry`
- Base: `main` at `83f6a4b` (T040 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. Nothing else is in
  flight. No browser test is expected.
- Rules claimed: R145.
- Status: approved

## Goal

R88 builds one symmetry component per seed and R94 lays the whole component out as one
block on one axis. When a mirrored stage is only **gate-driven** by another (the user's
pre-amplifier: a detection stage `M7/M8`, `M9/M10` driven by the pre-amplifier's
outputs), R94 pulls it into the pre-amplifier's block and rows, and wires detour. Human
drawings give each such stage its own axis and put it beside the first.

Opus prototyped two splits on `83f6a4b` (`tmp/t041/`, placement only, default mode) on
the 33 human drawings, quick mode, counts only:

| Variant                             | dev crossings / bends | val crossings / bends | whole-axis mirrored | per-stage mirrored | median area dev / val |
| ----------------------------------- | --------------------- | --------------------- | ------------------- | ------------------ | --------------------- |
| `83f6a4b`                           | 268 / 362             | 306 / 397             | 59/59, 29/29        | 59/59, 29/29       | 2.57 / 2.26           |
| split every conduction part         | 271 / 378             | 303 / 382             | 44/59, 15/29        | 59/59, 29/29       | 2.76 / 2.26           |
| **split only parts with ≥ 2 pairs** | **254 / 367**         | **310 / 394**         | 55/59, 23/29        | 59/59, 29/29       | 2.65 / 2.25           |

Human drawings: whole-axis 32/59 and 19/29, per-stage 43/59 and 27/29. The chosen
variant (bold) changes 4 of 33 drawings: the user's pre-amplifier 10 → 8 crossings with
the detection stage beside the pre-amplifier as in the human drawing; a 50-instance dev
drawing 63 → 51; two val drawings +1 and +3. Splitting every part also cut single bias
pairs off the main axis, which humans keep there.

## Context

Everything below was verified on `83f6a4b`. Paths are relative to the repository root.

- `packages/auto-layout/src/symmetry.ts`: `symmetryTopology` (`:69`) returns
  `{ components, netMap }`; `detectSymmetry` returns the components; `symmetryCounts`
  (`:337`) measures each component about its own median-midpoint axis.
- Consumers of components for placement:
  - `place.ts:231`–`:240`: `topology = symmetryTopology(…)`, R140's
    `placementPartition(…, topology.components)`, `symmetry =
partitionSymmetry(topology.components, partition)`; `topology` is then passed to the
    template, stages and layered strategies (`:293`, `:306`, `:317`, `:341`) and
    `symmetry` to collision repair.
  - `search-moves.ts:98`: annealing joins `detectSymmetry(…)` components as rigid units.
  - `template-placement.ts:249`, `stages.ts:447`: default parameters only.
  - `auto-layout.ts:215`: R97 rigid units read `symmetryTopology(run.final, …)`.
- R50 conducting pins: `conductingPins` (`stages.ts:71`, exported since T035).
- The prototype (`tmp/t041/`, env `T041_SPLIT=2` in a scratch tree's `place.ts`): for
  each component, union pair members, and union devices that share a non-rail Net on
  R50 conducting pins; parts with at least two pairs become components; every other part
  (one pair, or only axis devices) merges into the part with the most pairs (ties: the part
  holding the first pair in component order); if only one part remains, keep the
  component unchanged. It applied this in `place.ts` only; annealing and R97 still used
  the whole components.
- Evaluation: `scripts/auto-layout-eval.mjs` reports `symmetry` from
  `detectSymmetry` of the input for result and human drawings.

## Scope

Owned paths: a new `packages/auto-layout/src/stage-symmetry.ts` (or a function in an
existing module if no import cycle arises), `packages/auto-layout/src/place.ts`,
`search-moves.ts`, `auto-layout.ts` (R97 rigid units only), new
`packages/auto-layout/test/stage-symmetry.test.ts`, `scripts/auto-layout-eval.mjs` (one
added metric), `docs/specs/auto-layout.md`.

Out of scope: `symmetryTopology`/`detectSymmetry` themselves (the whole-component view
stays available and is what the existing `symmetry` metric measures); partition mode
(R140 already stacks partition blocks by conduction; with a partition, placement keeps
today's behaviour); routing; every other test file unless step 5's rule applies;
`packages/model`, `packages/derived`, `packages/edit-engine`, `apps/`, dependencies.

## Steps

1. **`stageComponents(document, resolver, roles, components)`.** Implement the split of
   the prototype exactly as described in Context: deterministic, independent of placement
   and of input order, preserving pair order, axis order and `conflicted` lists.
2. **Placement uses stage components.** Without a partition, `placeDocument` uses
   `stageComponents(…)` wherever it uses the R88 components today (the `topology` it
   passes to every strategy, collision repair, frozen sets); the `netMap` is unchanged.
   With a partition, nothing changes. Each stage component gets the existing R89 block
   and R94 treatment, so a split stage becomes its own block on its own axis.
3. **Annealing and R97.** `createMoveGenerator` joins stage components (without a
   partition) instead of whole components; R97's rigid units use stage components too.
   Both stay unchanged with a partition.
4. **Evaluation.** Add `symmetryStage` per case for result and human drawings,
   `symmetryCounts` over `stageComponents` of the input, and print it beside `symmetry`
   in the split summary. The existing `symmetry` metric is unchanged.
5. **Tests** (`stage-symmetry.test.ts`, synthetic Documents): a differential stage driving
   a second mirrored stage through gates splits into two components and the second is
   placed beside the first on its own axis; a single bias pair driving the first stage stays
   in its component; a component with one conduction part is returned unchanged;
   determinism and input-order independence; all three strategies and a seeded search keep
   each stage mirrored. If an existing test's fixture has a gate-driven stage of at least two
   pairs, its expectation may change: change only that expectation and name it in the report.
6. **Spec.** Add **R145 — Stage symmetry** after R144 and amend R94 to refer to stage
   components in default mode; describe `symmetryStage` in the evaluation section.
7. **Measure** on the 33 human drawings, default quick mode, `83f6a4b` and the result one
   after the other: crossings, bends, wire, floating pins, missing connections, both
   symmetry metrics, median area, time; the drawings that change. Copy reports and
   human | before | after renders of every changed drawing to `tmp/t041/result/`
   (git-ignored).

## Acceptance

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'stage-symmetry|place\.ts|search-moves'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7   # expected: exit 0; plan hashes equal 83f6a4b's (partition mode unchanged)
git status --short packages/model packages/derived packages/edit-engine apps pnpm-lock.yaml package.json   # expected: empty
git ls-files tmp | head -1                           # expected: no output
```

**Targets** (33 human drawings, default quick mode, against `83f6a4b`):

| Measure                                    | Required                             |
| ------------------------------------------ | ------------------------------------ |
| Dev crossings                              | ≤ 258 (prototype 254)                |
| Val crossings                              | ≤ 312, report it                     |
| Per-stage mirrored pairs (`symmetryStage`) | every pair mirrored, as on `83f6a4b` |
| Floating pins, missing connections         | no increase on any drawing           |
| Drawings without a split component         | plan hashes unchanged                |
| Planning time                              | ≤ 1.10 × base                        |

## Notes for the implementer

- No LLM calls; never set an API key.
- Human cases stay git-ignored; never commit a case, excerpt, id or id-keyed data.
