# T016 — Auto-layout: stage blocks from channel-connected components

- Branch: `task/T016-auto-layout-stages`
- Base: `task/T015-auto-layout-layered` at `8b11de3` (stacked on open PR #18)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user asked to keep optimizing. An experiment shows placement is now the whole
problem. This task adds a placement strategy that draws a circuit as humans do:
stages side by side, each a vertical stack, joined through gates. It keeps every
earlier result from getting worse. The lock field and editor button stay in T014.

## Context

Verified on `8b11de3`.

### The experiment

The human drawings' placements were held fixed and only our router ran, with
validity checks relaxed in a throwaway build:

| Crossings, all documents that complete | dev | val |
| -------------------------------------- | --: | --: |
| Human drawing                          |  52 |  63 |
| Human placement + our routing          |  81 |  95 |
| Our placement + our routing            | 321 | 563 |

So routing costs about 1.5× and placement 4× to 6×. **Do not work on the router in
this task.**

### Why layered placement falls short

`layered.ts` assigns every device to one global set of rows. Unrelated stages share
rows and interleave, so a Net between two stages runs across unrelated devices. In
human drawings each stage is its own vertical stack, the stacks sit side by side in
signal order, and gates carry the signal between them.

The electrical concept for a stage is a **channel-connected component**: devices
joined through a DC current path, cut at rails and gates. It is general, needs no
circuit knowledge, and is standard in MOS analysis.

### Reuse

- `netLevels`, `deviceRows`, `orderRows`, `assignColumns` in `layered.ts` lay out one
  block: run them on the block's own devices.
- `recognizeStructures` for groups, `placeMarkers` for Cell Pins and markers.
- The R36 portfolio in `src/auto-layout.ts` and `src/refine.ts`.
- `roles.rails` (R37), `signalDistances`.
- Evaluator: `pnpm auto-layout:eval tmp/human-cases --baseline <file>`.
  `tmp/t015-final-eval.json` is the current result.

### Binding constraints from earlier tasks

- The 33 human cases are third-party drawings in git-ignored `tmp/human-cases/`.
  **Never commit any of them, any excerpt, or any id-keyed derived data.** Nothing in
  CI or `pnpm test:local` may depend on them.
- Tune on dev only (`sha256(id) % 3 != 0`). Rules and constants may not refer to any
  case. Validation shows whether the change generalizes.
- Corpus targets and geometry assertions, zero floating pins on the corpus, and the
  held-out crossing ceilings in `held-out.test.ts` must keep holding.
- R10, R23 and `lostNameClaim` stay as they are.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs`, `scripts/auto-layout-review.mjs`

Out of scope (do not change):

- `packages/edit-engine/**`, `packages/model/**`,
  `packages/project-protocol/**`, `packages/spice/**`, `fixtures/**`, `apps/**`
- `src/route.ts` behavior, other than what R55 needs to compare strategies
- Lock fields and the editor button

## Steps

1. **Spec.** Add R50–R59 to `docs/specs/auto-layout.md`.

   - **R50 Stages.** A stage is a connected component of devices joined through a
     non-rail Net by DC conducting pins: MOS `D`/`S`, BJT collector and emitter, and
     both pins of resistors and inductors. Capacitors and gates and bases do not
     conduct. Devices in one recognized group are always merged into one stage. A
     device touching only rails or only non-conducting pins is its own stage, and a
     capacitor joins the stage of a non-rail pin, or sits between two stages (R53).
     Blocks with no channel pins are stages of their own.
   - **R51 Stage layout.** Lay out each stage alone with R30–R33 in local coordinates,
     keeping templates, symmetry and pin alignment.
   - **R52 Stage rows.** Stages share rails. Align each stage's top row with the
     supply rail when it touches one, and otherwise its bottom row with the ground
     rail, so rail trunks stay straight. A stage touching neither is centred.
   - **R53 Stage order.** Order stages left to right to minimize R54, starting from
     increasing signal distance. Try: adjacent swaps, moving one stage to any
     position, and mirroring one stage horizontally when no group forbids it
     (a symmetric stage is unchanged by this). Repeat until no move improves, at most
     five passes. Ties keep the earlier order. A capacitor between two stages goes
     between them, level with its pins.
   - **R54 Fast estimate.** Estimate a placement without routing: for each non-rail
     Net, a minimum spanning tree of its non-bulk pins, each edge an L path,
     horizontal first. Count proper crossings between different Nets, plus each
     Net's total length divided by 1000 as a tie-break. It must be pure, deterministic
     and fast enough to call thousands of times on 120 instances.
   - **R55 Portfolio.** Stages join R36 as a third strategy at every size. Up to 40
     instances run all three with refinement. Above 40, score stages and layered by
     real routing without refinement and keep the lower. The R44 alternative still
     runs on the winner.
   - **R57 Signal direction.** R54 does not change when a layout is reversed. After
     R53, if the mean `x` of the input Cell Pins' host pins is right of the mean `x` of
     the output Cell Pins' host pins, reverse the stage order and mirror each stage
     (group handedness kept, as in R53). Crossings stay the same and signal runs left
     to right. With no inputs or no outputs, keep the order.
   - **R58 Refine the top two.** Replaces "run all three with refinement" in R55. Route
     each strategy once without refinement and rank by routed score. Up to 40
     instances, refine the top two with at most 14 candidates each and keep the lower
     score; a tie keeps the higher-ranked. Above 40 instances, keep the current rule.
     An unrefined rank does not predict the refined result: refining only the first
     broke `ltc3452`'s ceiling (23 against 22; T015 had 19).
   - **R59 Attached parts.** A single-device stage with one non-rail Net and one rail
     pin (a shunt capacitor, a load or bias resistor) does not take a column. It stands
     next to the host pin of its Net, in that stage's own span, below for ground and
     above for supply, and only widens the stage if it must. This is R9's shunt rule
     applied to stages.
   - **R56 Spacing.** Stages are at least 80 units apart, and a capacitor between
     them adds its own width. Compact gaps, so a drawing does not sprawl.

2. **`src/stages.ts`** (new): R50–R53. **`src/estimate.ts`** (new): R54. Wire R55 into
   `src/auto-layout.ts` and `src/refine.ts`.

3. **Tests.** Unit tests on hand-built circuits only:
   - two common-source stages joined by a gate become two stages, placed side by side
     with no shared row interleaving;
   - a current mirror spanning two stacks merges them through its group;
   - a coupling capacitor does not merge stages, and sits between them;
   - R54 counts a known crossing and zero for parallel Nets;
   - a mirrored stage reduces crossings on a constructed input;
   - a synthetic 120-device document stays deterministic.

4. **Report:** the eval table against `tmp/t015-final-eval.json`, and which strategy won
   per document; planning time against size; corpus and held-out changes; each
   remaining refusal; at least eight rendered pairs across sizes with a plain
   statement of what still looks wrong.

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
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output (deadcode itself exits 1 on main)
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Baseline on `8b11de3`: all pass, with 7383 tests.

Evaluation targets, for **each** of dev and val, over documents completed in both the
`baseline.json` run and this one:

- crossings at most half of `baseline.json` (dev 144, val 131; today 224 and 184);
- bends not above today (291 and 213);
- floating pins not above today (27 and 14);
- every completed document electrically equivalent, with `unsafeProblems` empty.

Over all 33 documents:

- at least 32 complete, none throws;
- no document above 12 s, measured with no other job running.

If a target is missed, report where it stands. Never chase it with a rule for one case.

## Notes for the implementer

- This adds one mechanism. A new `if` for a kind of circuit is a sign of the wrong
  design. Prefer changing what R50 cuts on or what R54 counts.
- Never key behavior to a case, a Reference, an instance id or a symbol id, other than
  device classification: MOS, BJT, resistor, inductor, capacitor, marker.
- A rule that helps dev and not val is not an improvement. Say so.
- Keep planning deterministic: no clock in any decision.
- Do not change the router or the Edit Engine to reach a target. Record it.
