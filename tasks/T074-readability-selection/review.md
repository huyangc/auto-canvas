# T074 review

## Round 1 — changes-requested

Reviewed: round 1 report on 2026-11-13. The direction is right and the effect
is large: the frozen readability composite falls dev 95.36 → 70.92 (−25.6%),
val 48.58 → 36.25 (−25.4%), i.e. from 1.99× to about 1.48× human on dev and
from 1.80× to 1.34× on val. portOrder −40% / −46%, rail crossings −55% / −52%,
source polarity −75%, avoidable jogs −100% / −67%, crossings −2% / −5%; every
weighted metric within +5%; held-out timing at most 1.08×; six large plans
byte-identical; deterministic. Removing the T073 mirror and the `offConvention`
proxy and keeping conventional seat candidates is accepted (dev ablations).

Blocking: physical connectivity got worse — floating pins dev 6 → 28, val
0 → 2; missing connections dev 4 → 16, val 0 → 1. The readability score does
not measure connectivity, and at W = 30000 its gain outweighs the finite
`unrouted` cost (10000 per missing connection). An unconnected wire is never
more readable.

| #   | Severity             | Where                                                              | Finding                                                                                                                                                         | Expected fix                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix             | every complete-candidate comparison                                | Floating pins and missing connections rise.                                                                                                                     | Make physical completeness lexicographic: compare (floating pins + missing connections) first, then the score. A candidate with more of them never wins, whatever W is. Floating and missing totals not above main on either split. Then re-pick W on dev among {3000, 10000, 30000} (and one higher value if 30000 is still the minimum). |
| 2   | must-fix             | `follow-drafting-labels.test.ts` (caption `m` keeps a free anchor) | Drafting caption no longer follows its device.                                                                                                                  | Find why (different winner, or the follow step skipped under the new score) and fix generally; the test stays unchanged.                                                                                                                                                                                                                   |
| 3   | must-fix             | `routing.test.ts` owned drafting                                   | The drafting-follow candidate's electrical placement differs from the drafting-free baseline (R150 contract: the candidate reuses the base's final placements). | Restore the R150 contract (both runs must score with the same readability term, or the drafting candidate must reuse the base placements exactly); test unchanged.                                                                                                                                                                         |
| 4   | authorized           | `quality.test.ts` R44 replay                                       | The test pins the final score to the candidate minimum computed with the old score; the final is now lower.                                                     | Restate the same contract with the score actually used for selection (including the readability term): the R44 winner equals the minimum candidate under that score. Keep every other assertion.                                                                                                                                           |
| 5   | decide-with-evidence | `corpus.test.ts` two-inverters bend limit 2 → 3                    | One more bend.                                                                                                                                                  | If, after fix 1, the fixture's readability composite is lower than on main and its floating/missing are not higher, update the limit to the new count and say so; otherwise fix the cause.                                                                                                                                                 |

Accepted by Opus: `VISUAL_LABEL_CLEARANCE` rises (dev 134 → 187, val 59 → 82).
It carries zero readability weight because human drawings score worse on it
(T070: dev human 401 vs result 135), and the result stays below the human
level. Report it; it is no longer a gate. Every other `VISUAL_*` total must
not rise.

Acceptance otherwise as in the plan (composite −8% dev and val, weighted
metrics within +5%, guards, determinism, large documents, timing +30%).

## Round 2 — changes-requested (final Codex round)

Reviewed: round 2 report on 2026-11-14. Completeness-first selection works:
floating / missing equal main (dev 6 / 4, val 0 / 0); 628/628 equivalent;
W = 30000 chosen on dev only; readability composite dev 95.36 → 71.72
(−24.8%), val 48.58 → 36.62 (−24.6%); every weighted metric within +5%;
drafting tests pass unchanged; the two-inverters bend ceiling change follows
the authorization (composite 0.02899 → 0.02686, 0/0 floating / missing).

| #   | Severity   | Where                                   | Finding                                                                                                                                                                           | Expected fix                                                                                                                                                                               |
| --- | ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix   | `corpus.test.ts:572` (two-inverters)    | Final port seat `{240, 20}` is not among the regenerated R146 seats (T067 contract: every final port seat is a `portSeatCandidates` member).                                      | Find which pass moves the port off the generated set (label repair local opening, conventional seat, or a translation) and fix it generally; the assertion stays unchanged.                |
| 2   | authorized | `blocker-repair.test.ts:293` R72 veto   | The test requires a candidate with better physical connectivity but a higher soft score to be rejected; that contradicts the completeness-first rule the round 1 review required. | Rewrite it to the new contract: the candidate with fewer floating + missing wins even with a higher soft score; keep a case where equal completeness and a higher score is still rejected. |
| 3   | authorized | `partition.test.ts:158` V2 snapshot     | Arrangement hash changed with the selection score; bounds, membership, equivalence and replay assertions pass.                                                                    | Update the snapshot hash and state in the report why it changed (which choice moved and that it scores lower under the new objective).                                                     |
| 4   | accepted   | val `VISUAL_LABEL_OWNER_DISTANCE` 1 → 2 | One drawing (`s78j9fyzha`). Zero readability weight; human drawings score worse (dev human 15 vs result 0); T069 already allowed +1.                                              | Report only.                                                                                                                                                                               |

Acceptance unchanged otherwise.

## Round 3 — accepted

Reviewed: round 3 report and diff on 2026-11-14. The port-seat defect was in
R146 itself (its finishing pass compacted rows after the trial seat was
generated); seats are now validated against the finished geometry and the
unchanged corpus assertion passes. The R72 test follows the authorization
(the same expensive detour wins only when completeness improves; at equal
completeness it still loses). The partition snapshot changed because the new
objective keeps the template choice with resistor `c` mirrored and different
block offsets (score 521.98 → 512.29, 0 floating / missing).

Results against main `789d513`: readability composite dev −24.79%, val
−24.61%; every weighted metric within +5%; floating / missing equal main;
628/628 equivalent; six large plans byte-identical; deterministic; held-out
medians at most 1.119×. Accepted exceptions as in the round 1 and round 2
reviews (label clearance, one val owner-distance).
