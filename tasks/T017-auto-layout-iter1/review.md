# T017 review

## Round 1 — changes-requested

Reviewed: the uncommitted working tree on `task/T017-auto-layout-iter1` against
`36bf035`. Opus reran the package tests (9 files, 125 tests pass) and evaluated the
human cases five times: all changes on, each of R60, R61 and R62 switched off alone,
and all three off. Throwaway switches went into a built copy only; `dist` was then
rebuilt from source.

All completed human documents, against `tmp/t016-final-eval.json`:

| Build            | Crossings | Bends | Floating pins |
| ---------------- | --------: | ----: | ------------: |
| T016             |       757 |   766 |            96 |
| all three off    |       757 |   766 |            96 |
| round 1          |       783 |   817 |            79 |
| without R60      |       758 |   771 |            86 |
| without R61      |       784 |   812 |            79 |
| without R62      |       781 |   817 |            89 |

All three off reproduces T016 exactly, so the switches isolate each change.

- **R60** costs 25 crossings and 46 bends, and saves 7 floating pins. Its effect varies
  by document: three improve strongly and four get much worse.
- **R61** changes almost nothing (−1 crossing, +5 bends) and adds planning time.
- **R62** saves 10 floating pins for 2 crossings and about 4% wire length.

Tracing the worst R60 regression found two general defects in R58's portfolio, not in
R60:

1. **Identical candidates.** In 7 of the 27 documents up to 40 instances, two strategies
   produce identical initial edits. R58 still refines the top two, so one refinement is
   spent on a duplicate.
2. **Refused initial candidates are never refined.** An initial plan refused by a rule
   scores infinity and ranks last. In 4 of those 27 documents at least one strategy is
   refused before refinement. In the traced document, the stage strategy is refused
   initially, but refinement repairs it to 11 crossings, against 29 for the selected
   strategy.

The other R60 regressions are inside one strategy. Once switches conduct, a
switch network merges with its MOS devices into one stage of 13–16 devices. The
in-stage layered placement draws that stage with more crossings than the previous
single-device stages.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `packages/auto-layout/src/auto-layout.ts:73-105` | R58 refines duplicates and never refines a refused initial plan. | Plan step 6 (R63). |
| 2 | must-fix | `packages/auto-layout/src/refine.ts:85-94`, R61 in the spec, its 60-instance test | R61 has no measurable benefit and costs time. | Plan step 7: remove R61 and restore zero refinement above 40 instances. |
| 3 | must-fix | `packages/auto-layout/src/stages.ts` | Merged switch stages draw worse than single-device stages. | Plan step 8: investigate and report; fix only with a general placement mechanism. |
| 4 | note | `packages/auto-layout/src/place-markers.ts` | R62 moves every top and bottom rail Cell Pin left of the device span, not only duplicates. | Keep; its floating-pin gain outweighs the cost. |
| 5 | note | `tasks/T017-auto-layout-iter1/report.md` | The report's tables are accurate; Opus reproduced 783 / 817 / 79. | None. |

Acceptance rerun:

```text
pnpm vitest run packages/auto-layout                  → 0 (125 tests passed)
node scripts/auto-layout-eval.mjs tmp/human-cases     → 0, in each of five builds
git ls-files | grep -E 'human-cases|auto-layout-eval/' → no output
```

## Round 2 — accepted with Opus fixes

Reviewed: the uncommitted working tree after Codex round 2. Codex implemented R63,
removed R61 and investigated merged switch stages without a production change. Its
report is accurate. It left one corpus replan test failing, correctly, because the
approved exact-deduplication rule conflicted with refusal recovery.

Opus fixes (a few lines each):

1. **R63 deduplicates valid runs only** (`packages/auto-layout/src/auto-layout.ts`). A
   refused run returns no edits, so every refused strategy looked identical and the
   only repairable one was dropped. This was a plan defect. The corpus replan test
   passes again. Codex's refused-candidate test asserted that `template` wins; with
   both `template` and `layered` refused and kept, the existing tie rule ranks
   `layered` first. The assertion now accepts either repaired refused strategy, which
   is what the test is for.
2. **Switches do not conduct** (`packages/auto-layout/src/stages.ts`). Round 2's
   investigation shows why a merged switch network draws worse: it has no channel
   levels under R30 and packs into one row. Until a later task levels such networks,
   switches stay out of conduction. R60 keeps descriptor classes, diodes and
   transformer windings. The two switch tests now assert that switches stay out of
   channel stages and that a diode conducts. The spec says why.

Human cases, all completed documents, Opus's evaluations:

| Build                              | Crossings | Bends | Floating pins |
| ---------------------------------- | --------: | ----: | ------------: |
| T016                               |       757 |   766 |            96 |
| round 2 as delivered by Codex      |       766 |   797 |            83 |
| round 2, no R60 at all             |       759 |   766 |            86 |
| round 2 with switches not conducting |     755 |   766 |            82 |

The last row is the accepted state. Every round target is met: crossings lower (−0.3%),
completed 32, bends not above 766, floating pins at most 96. For the stopping rule this
round counts as **less than 5% improvement**.

## PR review — codex round 1 on `2682237`

One P2, verified by a hand-built test that failed before the fix: with a resistor on
a transformer's S− and a coupling capacitor on S+, the capacitor's owner was the
secondary channel component's root stage, which does not draw the transformer. Its
contact list was empty and the stage strategy failed R10 on a NaN coordinate. Opus
fixed it in `findStages`: a bridge owner is a device that draws a pin on the Net,
preferring one in the conducting component. Human-case results are unchanged
(755 / 766 / 82); package tests 128 pass; format, typecheck, lint (no new warning),
build and review pass.
