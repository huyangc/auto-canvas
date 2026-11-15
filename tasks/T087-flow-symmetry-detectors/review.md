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
