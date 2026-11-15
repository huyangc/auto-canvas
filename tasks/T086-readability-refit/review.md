# T086 review

## Round 1 — Opus, 2026-11-15

Verdict: **one more round, with a scope change.** The score itself is better:
on the unchanged main layouts, human-better discrimination rises dev 64.0% →
70.6%, val 60.3% → 69.8%, and all three flagged drawings now score worse than
human. But switching the **planner** to the new weights caused 98 per-drawing
regressions, 4 `VISUAL_*` increases, 17 failing tests and 1.3–2.4× timing on
three held-out fixtures (more finishing / relocation / port searches, not the
cost of measuring bends). Measuring and optimising are separate steps; this
task does only the measuring.

The refit also has a structural flaw: fitted only on current main pairs, it
zeroes every metric where the planner now beats human (`portOrder`,
`sourcePolarity`, `avoidableJogs`, `blockedJoins`, `controlSeparation`,
`terminalDepartures`). A frozen score that ignores them cannot notice a future
regression there.

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | scope | The planner's selection changed with the weights. | Split the weights. The planner keeps **selection weights** equal to main's current weights exactly (move them, with their T070 provenance header, to a selection weights module used by `readabilityScore` in planner paths, R74 / T074 / finished-selection / R148–R160 acceptances, and the planner's weighted-mode metric set). The refit produces **evaluation weights**, used by the evaluator (`scripts/auto-layout-eval.mjs` scoreboard and per-case `readabilityScore`) and reporting. Revert the round 1 test edits that encoded new coefficients. Required: all 628 plan hashes and the six large documents byte-identical to main; `test:local` / `test:slow` green; no timing change beyond noise. |
| 2   | must-fix | fit | Fitting only on current pairs drops metrics the planner currently wins. | Refit on **pooled dev pairs**: human vs main `1737221` layouts **and** human vs T070's `eb72cb1` layouts (the planner the original weights were fitted on), both scored with **today's** metric code (area unit, new metric). Build `eb72cb1`'s planner outside the repo (e.g. `git archive eb72cb1` into `/tmp`, install offline, build) and run the evaluator's planning with it, or add a baseline-planner option to the evaluator; do not commit its output. Keep the method (non-negative, RMS-normalised per pooled set, dev only) and record both sources in the generated header. Report the weights, discrimination on dev and val for **each** layout set (old and new weights), and the three flagged drawings. |
| 3   | must-fix | metric | `collinearAbutment` gets zero weight: it is higher for human in 55 dev pairs, and the flagged `bv9zwmd835` gap is 40 units (4 grid) so it counts 0. | Classify the human-heavy cases (which drawings, which nets, what pattern) and narrow the metric to "two different Nets read as one wire": e.g. facing ends that end in a pin entry or bend (not a port, marker or label), gap up to one R154 member pitch so `bv9zwmd835` counts. Show the classification in the report. If it still fits to zero weight, keep it as a reported (unweighted) metric. |
| 4   | should-fix | baseline | — | Report the new goal baseline: main `1737221` layouts scored with the new evaluation weights (dev / val composite and ratio), plus the per-metric human / result totals. |
| 5   | should-fix | docs | — | In the report, proposed spec text describing evaluation vs selection weights and when each is used. |

The two detection gaps the round found (feedback amplifier with no
backward-flow / port-order opportunity; degenerated differential pair with no
symmetry pair) are a follow-up task, not this round.
