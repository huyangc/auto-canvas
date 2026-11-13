# T070 review

## Round 1 — changes-requested

Reviewed: the round 1 report, `git diff`, `readability-metrics.ts`,
`readability-fit.mjs` and the evaluator change on 2026-11-13. Not rerun yet
(T069 timing runs were in progress); the report's evidence is consistent:
628/628 plan hashes unchanged, composite prefers the human drawing in 82.2% of
dev and 79.9% of val pairs, all four flagged defects registered by named
metrics, runtime unchanged.

| #   | Severity | Where                                                  | Finding                                                                                                                                                                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `auto-layout-eval.mjs` (`fitReadability` on every run) | The composite's weights and scales are refitted on every evaluation from human-minus-result differences, so they move whenever the planner changes. The next task optimizes the planner against this score; a moving target makes ratios across commits incomparable and can reward regressions.                                                                                                   | Freeze the fit: `scripts/readability-fit.mjs --write` fits on the dev split of a given report and writes `packages/auto-layout/src/readability-weights.ts` (generated, committed, header naming the source commit, report and command; Gallery-derived statistics may be committed). `readability-metrics.ts` exports `readabilityScore(metrics)` using the frozen weights and scales. The evaluator uses the frozen score; it may still print a refit accuracy as a diagnostic. Commit weights fitted on the `eb72cb1` report. |
| 2   | must-fix | scoreboard                                             | The goal is "each readability metric within 20% of human". The scoreboard has no target view, and nine metrics score the human drawing worse than the result (`narrowBands`, `wireThroughSymbols`, `labelClearance`, `detour`, `symmetryOrientation`, `transistorOrientation`, `labelOwnerDistance`, `structureIntrusion`, `symmetryLevel`) — they do not measure what humans do and get weight 0. | Add `readability.targets` per split: for every metric with a nonzero frozen weight, human total, result total, ratio and `withinTarget` (ratio ≤ 1.2, or result ≤ human + 2 when the human total is below 10), plus the composite ratio. Keep the zero-weight metrics as reported diagnostics, marked as such in `docs/testing/readability.md` with the reason (human worse).                                                                                                                                                   |
| 3   | should   | `narrowBands`                                          | It counts every gap below two pitches, so compact human drawings score worse (1446 vs 1018), and the human Common-Source Amplifier scores 4 against 1 for main. It does not capture the user's complaint (an empty strip created by one tall part in a row of short ones).                                                                                                                         | Either redefine it as wasted strips (an empty band beside a part that is taller/wider than its row neighbours, bounded by that part) and show it registers the `05050fd` case while the human scores lower, or keep it as a zero-weight diagnostic and say so. Do not tune on val.                                                                                                                                                                                                                                              |

Acceptance unchanged, plus: planner hashes unchanged; composite computed with
the committed weights reproduces the round 1 dev/val pairwise accuracies
within ±1 point when the weights are fitted on the same report.

## Round 2 — accepted

Reviewed: round 2 report and diff on 2026-11-13. Frozen weights in the
generated `readability-weights.ts` (fitted on the `eb72cb1` dev split, header
names commit, report hash and command); `readabilityScore` uses them; the
evaluator reports per-metric targets for the 11 weighted metrics and the
composite. Opus reran build, typecheck, lint (0 errors), format, the 15
focused tests and `readability-fit.mjs` (exit 0). Codex's full evaluation:
628/628 planner hashes unchanged, round 1 scores reproduced exactly, runtime
+0.31% on the uncontended repeat (the first run overlapped T069's evaluation).
Targets on main: 1/11 metrics within 1.2× on dev, 4/11 on val; composite not
within target on either split.
