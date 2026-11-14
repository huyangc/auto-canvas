# T078 review

## Round 1 — changes-requested

Reviewed: round 1 report and diff on 2026-11-14. Finishing the runner-up and
choosing on finished layouts works: readability composite dev 66.62 → 62.36
(−6.40%, 1.298× human), val 35.72 → 33.56 (−6.06%, 1.243×); 61 drawings
improve, none regress; 628/628 equivalent; floating / missing unchanged;
visual totals fall; six large plans byte-identical; deterministic.

| #   | Severity | Where                                                                     | Finding                                                                                                                                                                                                             | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | `packages/auto-layout/test/fixtures/finished-selection.json`              | It is a Gallery drawing ("Addition of RS to define the currents"). Raw Gallery drawings must never be committed (standing rule; statistics only).                                                                   | Delete it. Replace the test with a synthetic document built in code (as other tests do with `circuit(...)`) that reproduces the situation: the provisional winner finishes worse than the runner-up. If no small synthetic case reproduces it, test the selection function directly with two constructed finished runs.                                                                                                                                                                                                                          |
| 2   | must-fix | runtime                                                                   | Finishing every runner-up is too expensive: `deadtime` 2.53×, `skew` 2.07× (same final plan), `ltc3452` 1.46×; dev median overhead +29–30%. On dev 366 of 439 drawings finish a runner-up, but only 42 end with it. | Finish the runner-up only when it can plausibly win: use the provisional comparator (completeness, then routed score + readability) and skip the runner-up when its provisional score is worse than the winner's by more than a margin calibrated on dev; also skip when both finalists have the same placements. Optionally give the runner-up a smaller finishing budget. Keep at least 80% of the round 1 dev composite gain (≥ 3.4 units) and bring every held-out median within +40%. Report the dev trade-off curve (margin → gain, cost). |
| 3   | check    | rewritten tests (`branch-columns`, `follow-drafting-groups`, `partition`) | Existing assertions were changed without explicit authorization.                                                                                                                                                    | In the report, list each changed assertion, the old and new expectation, and why it follows from finished selection (call counts, winner identity). Keep every behavioral check (routing, locks, drafting, collisions).                                                                                                                                                                                                                                                                                                                          |

Accepted: the zero-baseline guard (a finished alternative may not introduce a
weighted violation absent from the incumbent).

## Round 2 — accepted

Reviewed: round 2 report and diff on 2026-11-14. The Gallery fixture is gone;
a synthetic two-resistor circuit reproduces the ranking reversal through the
public planner. The runner-up is finished only when its provisional score is
within 55% (capped at 12,500 points) of the winner's and its placements
differ: dev runner-up finishing 366 → 226 drawings, 89% of round 1's gain
kept (3.80 composite units). Every changed assertion is listed with its old
and new expectation; the changes follow from finished selection (call
counts, winner identity, a fixture position that still exercises a real
collision, the partition fallback compared with the single-finalist
pipeline) and keep every behavioral check.

Against main `a9ee786`: readability composite dev 66.62 → 62.82 (1.31×
human), val 35.72 → 34.47 (1.28×); 40 drawings improve, none regress; every
weighted metric unchanged or lower; 628/628 equivalent; six large plans
byte-identical; held-out medians at most 1.274×.
