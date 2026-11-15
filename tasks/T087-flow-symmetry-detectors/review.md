# T087 review

## Round 1 — Opus, 2026-11-15

Verdict: **accepted with one documented gate deviation.** Both detectors work
from the netlist and pin roles only: `wvwmyesa4g` human 0 / result 1
`signalDirection` violation, `bv9zwmd835` human 0 / result 2
`netlistSymmetry` violations. They add flow coverage to 104 and symmetry
coverage to 20 human drawings that had none. All 628 plans and the six large
documents are byte-identical to main; selection weights unchanged.

The pooled refit (same T086 method) gives `signalDirection` a real weight
(0.069, about 0.10 per violation, close to one crossing) and dev
discrimination 68.56% → 69.48%; val moves 68.25% → 67.72%, **one pair of
189** below the plan's "not lower" gate. `netlistSymmetry` fits to zero: on
most drawings the planner's R89 blocks already mirror more consistently than
the human drawings, so the metric does not separate human from result;
`bv9zwmd835` is an exception. Opus accepts this: one val pair is within noise,
the gain on dev is larger, and tuning against val is not allowed. The
symmetry metric stays as a reported, unweighted metric so a future regression
is visible. All three flagged drawings still score worse than human.

## Round 2 request — Opus, 2026-11-15

The codex PR review of `99362d7`
(https://github.com/huyangc/auto-canvas/pull/77#issuecomment-6897106490)
found a real defect:

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | metric | `readability-netlist.ts:16-19`: `endpointToBaseNet` keeps label-connected Base Nets separate, so ports or devices joined through matching Net labels look disconnected. Splitting an amplifier input into two label-connected Base Nets changes `signalDirection` from 3 opportunities / 1 violation to 2 / 0 with identical electrical connectivity; symmetry detection fragments the same way (`CODING_STANDARDS.md:8-9`). | Map Base Nets through `projection.logicalNetByBaseNet` (and normalise explicit interface Net references the same way) in both detectors. Add tests: the split-by-label amplifier gives the same `signalDirection` counts as the joined one; a label-joined degenerated pair still forms its symmetric pairs. |

Then remeasure both pooled layout sets, regenerate the evaluation weights
with the same command, and update the report (weights, discrimination dev /
val for both layout sets, flagged drawings, coverage counts, new baseline).
Selection weights and plans must stay byte-identical to main. Rerun all
acceptance commands.
