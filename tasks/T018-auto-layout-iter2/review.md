# T018 review

## Round 1 — rejected; optimization stops

Reviewed: the uncommitted working tree after Codex round 1. Opus rebuilt the package
and reran the human-case evaluation, reproducing Codex's totals exactly. Codex's
report is accurate. It discarded R64 at the fidelity gate, as the plan required, and
left the failing held-out test intact.

### R64: estimator fidelity

On 360 routed dev candidates, the R54 estimate ranks routed crossings with a pooled
Spearman correlation of only **0.44**. Within single documents it ranges from **−0.69**
to 1.0. It predicts 1,137 crossings where routing produces 5,965. The geometry missing
from the estimate:

| Missing geometry                         | Crossings |
| ---------------------------------------- | --------: |
| rail Nets                                |       942 |
| Nets with a Cell Pin or marker           |     2,273 |
| other signal Nets (trunk shape, detours) |     2,750 |

The router-shaped prototype predicted more crossings but ranked candidates worse
(0.35), so it was discarded. **Any search guided by this estimate is unreliable**,
which also limits R53/R54's stage ordering.

### R65: estimated placement search

All completed documents, against `tmp/t017-final-eval.json` (Opus's rerun):

| Split | Crossings | Bends     | Floating pins |
| ----- | --------- | --------- | ------------- |
| dev   | 268 → 279 | 336 → 327 | 38 → 38       |
| val   | 487 → 437 | 430 → 412 | 44 → 37       |
| all   | 755 → 716 | 766 → 739 | 82 → 75       |

The total passes 5%, but Opus rejects R65:

1. **Dev, the tuning split, gets worse** by 4.1%. The two worst changes are on dev
   (+14 at 50 instances, +7 at 19).
2. **The gain comes from two documents.** The two largest val documents give −37 of
   the −39. The other 30 documents go from 485 to 483.
3. **Restricting R65 to large documents is not supported.** The two dev documents
   above 40 instances get +1 and +14. Choosing such a rule would tune on val.
4. **Acceptance fails.** A held-out document exceeds its ceiling, 23 crossings against 22.
5. The cause is understood: the search optimizes an estimate that ranks candidates
   barely better than chance.

The R65 code and its tests are kept on branch `experiment/T018-r65` for the user's
batch review. They are not part of this task branch.

### Stopping rule

T017 improved the main metric by 0.3%, and T018 delivers 0%. That makes two
consecutive rounds under 5%, so **the optimization iteration stops**, per the user's
rule.

Further gains need a new approach, not tuning the existing one, for example:

- **A placement objective the router actually realizes.** Either route candidates
  (bounded, as R58 does), or make the estimator rank well first, with rails and
  marker Nets included.
- **Channel levels for floating switch networks**, so that switches can conduct (R60).
