# T075 review

## Round 1 — accepted (performance target not met, by design of the scope)

Reviewed: round 1 report and diff on 2026-11-14. `readabilityMetrics` gains a
`"weighted"` mode used by the planner's `readabilityTerm`; rail crossings are
counted in one pass (`readability-rail-crossings.ts`) with the same per-pair
point de-duplication as the old pairwise audits. Codex verified all 628 plan
hashes, all 97,968 readability metric values and all 1,884 scores identical
to main; the existing metric tests now also assert weighted-path parity.

Timing: every held-out median improves 1.6–10.4%; `two-inverters` improves
only 2.5% and stays 1.47× its pre-T074 time, missing the plan's target. The
profile explains why: readability takes 4.6–15.3% of planning time (6.4% on
`two-inverters`). T074's slowdown comes from the different search paths the
new selection takes, not from computing the score; that is outside this
task's scope. Opus accepts T075 as a result-preserving speed-up; the user
accepts some planning cost for readability gains.
