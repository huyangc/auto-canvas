# T077 — Seat a local-loop amplifier beside the device it controls

- Branch: `task/T077-local-loop-amplifier`
- Base: `main` at `01fd2ad`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main (T074) the frozen composite is dev 71.72
(1.49× human), val 36.62 (1.36×); crossings are 47% of the dev excess. An Opus
analysis (2026-11-14; scripts in `tmp/gap2/`, `blocks.py` reproduces the
numbers) found that dev drawings containing a block amplifier / comparator /
gate output (113 drawings) go from **22 crossings in the human drawings to 76
in ours** (+54, about 5.9 composite units); val stays 11 → 11. In the worst
cases (`ajwgak3wbv`, `gh3gcb5h3a`, `2adejzy693`, `t3r2dvffgc`, and the user's
flagged gain-boost cascode `8w2ra7hdrw` and "New Circuit" `75k4jskamd`) the
control or feedback amplifier sits at a row end or detached, so its loop wraps
around the circuit. None of the existing candidates had fewer crossings for
these drawings, so the planner needs a new placement, not a new weight.

The user flagged this at the start (2026-11-13): "gain-boost cascode
half-circuit … 运放没有放在它调节的晶体管旁边".

## Context

- R70 gate-driver attachments (`docs/specs/auto-layout.md:635`, implemented
  in `stages.ts` around line 278): a stage of at most three devices whose
  **sole** non-rail link reaches only gate/control pins of one receiver is
  translated onto the receiver's pin-exit side, aligned to the receiving pin.
  A local-loop amplifier is excluded: its output drives a gate, but its inputs
  also sense the controlled device's drain / source (or a node in its
  branch), so it has more than one link.
- R31 puts a multi-pin block in its output Net's row, which pushes it to the
  row end (`layered.ts`); stages compose blocks by R53.
- Selection (T074): complete candidates are compared by completeness first,
  then routed score + 30000 × frozen readability composite
  (`readability-selection.ts`). A new candidate only has to be generated; the
  selection decides.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`,
  base `tmp/main-01fd2ad-report.json`; `python3 tmp/excess.py <report>`.
- Parallel work: T075 (`readability-metrics.ts`, `readability-selection.ts`)
  and T076 (`auto-layout.ts` R150 branch, `drafting-groups.ts`) are about to
  merge; do not edit those files.

## Scope

Owned: `packages/auto-layout/src/stages.ts`, `layered.ts`,
`template-placement.ts`, `place.ts`, new files under
`packages/auto-layout/src/`, `packages/auto-layout/test/**`,
`tasks/T077-local-loop-amplifier/report.md`. Write the proposed R70 / new rule
spec text in the report; Opus applies it.

## Steps

1. **Investigate** the six named drawings and the dev drawings with block
   amplifiers: how the amplifier's pins connect to the controlled device
   (output → gate / base; inputs → that device's drain / source / emitter,
   or a reference), where each strategy puts it, and why. Report.
2. **Rule (local-loop amplifier).** A multi-pin block (opamp, comparator,
   amplifier symbol) whose output drives the control pin of one device and
   at least one of whose inputs connects to a non-rail terminal of that same
   device (or of a device in that device's DC branch) is placed beside the
   controlled device: output facing the control pin, inputs toward the
   sensed node, on the side away from the device's other connections, with
   the existing body clearance. Provide it as a placement in all three
   strategies (or as an additional draft each strategy routes), so the T074
   selection chooses. Rigid groups, symmetry blocks and fixed instances are
   untouched; a collision leaves the block where it was.
3. Tests: a regulated cascode (gain-boost) and a source-follower regulator
   place the amplifier beside its transistor with fewer crossings than the
   row-end placement; a block with no local loop is unchanged; determinism.
4. Evaluate all 628; review page human | main | T077 for the six named
   drawings plus the ten whose composite falls most and the five whose
   composite rises most.

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

- Readability composite lower on dev and val; dev crossings in drawings with a
  block amplifier lower by at least 25%.
- No weighted readability metric higher by more than 2% on either split.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical; held-out times within
  +15% median.

## Notes for the implementer

- Recognise the loop from connectivity and pin roles only; no circuit names,
  ids, text or coordinates.
- Tune on dev; report val (val barely has this pattern — say so).
