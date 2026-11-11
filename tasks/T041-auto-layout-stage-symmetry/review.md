# T041 review

## Round 1 — accepted

Reviewed: `git diff 83f6a4b` on `task/T041-auto-layout-stage-symmetry` after round 1;
acceptance rerun by Opus.

`stageComponents` (`packages/auto-layout/src/stage-symmetry.ts`) implements the
prototype's split: pairs joined, devices joined through non-rail Nets on R50 conducting
pins, parts with at least two pairs become components, everything else stays with the
largest (first pair on ties), a single resulting part keeps the component unchanged.
Placement, annealing and R97 rigid units use it without a partition; partition mode and
the whole-component `symmetry` metric are unchanged. No existing test changed.

| #   | Severity | Where           | Finding                                                                                                                                                              | Expected fix                                    |
| --- | -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | note     | plan Goal table | The human per-stage figures in the plan (43/59, 27/29) came from the prototype's every-part split; with the chosen rule they are 40/59 and 25/29, as Codex reported. | None; the plan's targets do not depend on them. |
| 2   | note     | timing          | Opus's unpaired rerun shows 1.11× against an earlier baseline; Codex's sequential paired runs give 1.005×.                                                           | Accepted; the split adds no routing work.       |

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (33 files, 573 tests)
pnpm test:local → 0 (774 files passed, 3 skipped; 7924 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'stage-symmetry|place\.ts|search-moves' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0, 33 completed; against 83f6a4b:
  dev crossings 268 → 254, bends 362 → 367; val 306 → 310, bends 397 → 394
  floating and missing unchanged; per-stage mirrored 59/59 and 29/29 (human 40, 25);
  whole-axis 55/59 and 23/29; 29 of 33 plans identical
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev → 0
protected paths → empty; no tracked tmp files
```
