# T078 report — round 2

## Summary

Addressed both must-fix findings from round 1: removed the raw Gallery fixture
and replaced it with a synthetic public-planner ranking-reversal test; added a
dev-calibrated provisional-score cutoff and identical-placement deduplication
before spending a second finishing budget. The cutoff preserves 3.803186 units
of dev composite improvement (89.25% of round 1) while reducing runner-up
finishing from 366 to 226 of 439 dev drawings.

All seven acceptance commands pass. All corpus quality gates pass: 628/628
equivalent, 40 improved composites, none worse, all weighted metrics unchanged
or lower, and six large plans byte-identical. The held-out timing gate
passes all seven fixtures; exact measurements appear below.

## Steps

| Step | Status | Notes                                                                                                                                              |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Investigated dev score margins, retained gains and extra finishing cost; measured three combined cutoffs.                                          |
| 2    | done   | K=2 with completeness-first eligibility, a 55%/12,500 score margin, identical-placement rejection and the unchanged full finishing budgets/caches. |
| 3    | done   | Synthetic end-to-end reversal/determinism, duplicate-placement and margin tests; completeness, refusal, tie and above-40 hash coverage retained.   |
| 4    | done   | Updated R58, evaluated all 628, regenerated and visually inspected the review page; all large-document and replay hashes checked.                  |

## Review findings addressed

1. **Raw Gallery fixture (must-fix):** removed the untracked `test/fixtures/finished-selection.json` and its empty directory. The replacement builds two resistors, their Net, and a caption in code. It runs the real public planner, observes the provisional comparator before finishing, proves that finishing reverses the ranking and returns the runner-up, and repeats deterministically. It reads no drawing file. Completeness, refusal and tie tests remain.
2. **Runtime (must-fix):** `shouldFinishRunner` compares instance placements by ID (position, rotation and mirror), skips duplicates even when routing edits differ, and applies the completeness-first provisional comparator. At equal completeness the permitted gap is `min(0.55 × incumbent score, 12500)`. Dev calibration and actual gate results appear below. Existing per-finalist budgets, caches, finishing order, the original fallback, the zero-baseline guard and above-40 behavior remain intact. No drawing-specific logic or validation tuning was added.
3. **Changed assertions (check):** the complete inventory relative to main is below. No routing, lock, drafting or collision checks were removed.

| Test / assertion                                                | Main expectation                                                          | Round 1 expectation                                                                        | Round 2 expectation and reason                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch-columns`: old-level fallback winner                     | Public result equals `selectSeriesLayout(...)`'s old-level winner         | Public edits differ; `selectFinishedLayout` accepts the public result; repeat is identical | Restored exact equality to the old-level winner because the new provisional cutoff skips this runner-up. Retained the added finished-selection guard and determinism assertions, the worse-series score comparison and fixed-pose checks.                                                                                                                      |
| `follow-drafting-groups`: R150 accepted=true and accepted=false | One relocation, ports, rails, gaps and drafting call each                 | Two calls each                                                                             | Still two: these synthetic finalists are distinct and inside the margin. Exactly one annealer and zero drafting fallbacks remain required; exact placements, translation, fixed ink and determinism remain checked.                                                                                                                                            |
| `follow-drafting-groups`: unowned/locked ink                    | One drafting call                                                         | Two drafting calls                                                                         | Still two for the same eligible finalist pair; one annealer and zero drafting fallbacks remain required, with all fixed-ink and position assertions.                                                                                                                                                                                                           |
| `follow-drafting-groups`: colliding caption input               | Caption starts at x=645, y=400                                            | Caption starts at x=555, y=400                                                             | Unchanged from round 1. Finished selection changes the preferred device seats; x=555 exercises an actual collision in the selected layout. The clear-input, colliding-preferred-seat, moved-caption and no-final-device-coverage assertions all remain. This changes fixture geometry, not those assertions.                                                   |
| `partition`: both refusal-fallback variants                     | Fallback equals public plain planning plus the partition-fallback warning | Fallback equals `planWithSeriesLevels`' legacy complete pipeline including diagnostics     | Unchanged from round 1. Public plain planning may now choose an extra finished finalist; the internal single-finalist path expresses the original fallback. Still checks nonempty edits, exact entire result/diagnostics, the specific warning, fixed placements, terminal partition, intrusion accounting, input immutability and arranged-partition refusal. |

## Acceptance results

Final [check logs](../../tmp/t078-round2/checks/):

```text
pnpm build                                        → 0; all package/app builds complete
pnpm typecheck                                    → 0
pnpm lint                                         → 0; 2061 files, 0 errors, 3429 warnings
pnpm format:check                                 → 0; all matched files use Prettier code style
pnpm test:local                                   → 0; 795 files passed, 3 skipped; 8140 tests passed, 117 skipped
pnpm test:slow                                    → 0; 2 files passed; 8 tests passed
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
                                                  → 0; 628 completed; report.json and index.html written
```

The initial sandboxed full suite failed (63 tests and two unhandled errors),
primarily on PostgreSQL access and loopback `EPERM`; it also showed three
recovery-store/coordinator assertions that did not recur in the unrestricted
full run. The authorized unrestricted rerun passed the entire suite without
changes outside owned paths. The final synthetic test also passed a focused
rerun (7/7), and final typecheck/lint passed after its update. No tests were
skipped, disabled or removed to obtain a pass; the skip counts are existing
suite configuration. Headless Chrome needed an authorized unrestricted launch
to render the local review page. No browser or dependencies were installed.

### Corpus gates against main a9ee786

[Evaluation report](../../tmp/auto-layout-eval/report.json),
[machine-readable gates](../../tmp/t078-round2/acceptance.json),
[comparison](../../tmp/t078-round2/comparison.txt).

| Weighted metric    |      Dev: main → T078 |      Val: main → T078 |
| ------------------ | --------------------: | --------------------: |
| composite          | 66.619827 → 62.816641 | 35.719469 → 34.467689 |
| area               | 611011.37 → 609600.21 | 395851.59 → 395654.38 |
| avoidableJogs      |                 1 → 1 |                 1 → 1 |
| blockedJoins       |                 4 → 4 |                 0 → 0 |
| controlSeparation  |               28 → 26 |                 3 → 2 |
| crossings          |             257 → 244 |             149 → 146 |
| labelOverlaps      |                 3 → 3 |                 0 → 0 |
| portOrder          |             116 → 111 |               52 → 51 |
| railCrossings      |               25 → 21 |               16 → 16 |
| sourcePolarity     |                 3 → 2 |                 1 → 0 |
| terminalDepartures |               30 → 28 |                 7 → 7 |
| unownedDrafting    |               35 → 32 |               14 → 12 |

Dev composite falls 5.71%; validation falls 3.50%. There are 29 dev and 11 val
improvements, with no individual composite increases. All weighted metrics
meet the +2% allowance; in this round none increases at all. All 628 drawings
remain equivalent, with no increased floating-pin or missing-connection count.
588 plans match main byte for byte. Visual totals change only by label
clearance −1, terminal departure −2 and wire-through-symbol −1; every other
`VISUAL_*` total is unchanged.

### Determinism and large documents

The independent dev probe matches final evaluation hashes **439/439**.
Review-page replay matches main's supplied hashes **32/32**, current evaluation
hashes **32/32**, and repeated current plans **32/32**.
[Replay evidence](../../tmp/t078-round2/verification.json).

All six separate large plans remain byte-identical to main and repeat exactly:
`38m8wdesbh` (50 instances), `4fb59zv76m` (50), `8b2n3zf9vj` (51),
`b9afqhsjzv` (103), `g47e465db5` (70), `sm663cbs8b` (94).
[Large-plan evidence](../../tmp/t078-round2/large.json).
The synthetic 41-instance slow test independently retains the main-generated
hash `1e3787ce0780e743485aff3f7fa843615eabefd26626c61c0aeb3300fb6a8760`.

### Held-out timing

Five alternating main/current pairs per fixture, without deadlines, after all
corpus, test, replay, large-document and rendering processes had finished.
Main and current used the same Node runtime and fixtures. All seven outputs
are byte-identical to main and deterministic across all repetitions.
[Raw timing evidence](../../tmp/t078-round2/timing.json).

| Drawing          | Main median ms | T078 median ms |  Ratio | +40% gate |
| ---------------- | -------------: | -------------: | -----: | --------- |
| fd-two-stage     |         1697.0 |         1686.3 | 0.994× | pass      |
| common-source-ac |          813.2 |         1036.2 | 1.274× | pass      |
| skew             |         1784.1 |         1820.5 | 1.020× | pass      |
| deadtime         |        10371.5 |        10521.8 | 1.014× | pass      |
| ota-sky130       |          719.6 |          705.9 | 0.981× | pass      |
| widlar           |         4355.4 |         5140.3 | 1.180× | pass      |
| ltc3452          |        14448.8 |        14553.9 | 1.007× | pass      |

The median of the seven per-fixture median ratios is
1.014×. The largest individual median increase is
27.42%.
The provisional gap skips the formerly expensive runner-ups for `skew`,
`deadtime` and `ltc3452`; these are consequences of the same dev-calibrated
rule used for every drawing, not fixture exceptions.

### Review page

[Human | main a9ee786 | T078](../../tmp/t078-round2/review.html) includes the
25 fixed samples plus the ten largest improvements (32 unique drawings).
There are no composite increases, so no five regression samples exist.
Inspected all eight rendered sheets (`review-1.png` through `review-8.png` in
that directory); all drawings render and the page has no horizontal overflow
at 1800 pixels.

The largest retained changes include a narrower layout with fewer long crossing
paths in `386ggqhz53`, shorter lower return routing in `v9c7fgk7rm`, and captions
brought closer to their mirrors in `7qbprrj7bn` and `c9bv7j22xb`. The unchanged
fixed samples remain unchanged visually. Lower composite still does not
necessarily mean closer resemblance to the human layout: `bv9zwmd835` loses
the human differential-pair balance, while `gzheekv3cf` and `9qf7cz8p63` stagger
formerly parallel branches. The frozen objective accepts these tradeoffs.

## Investigation results

K remains two. Round 1 already measured 366/439 dev drawings with another complete refined finalist; 63 finished alternatives beat the original path under the shared comparator, and the final guards retained 42 composite improvements totaling 4.261236 units. Round 2 retains the complete pipeline for competitive finalists and avoids finishing clearly worse ones.

The initial screening used round 1's dev provisional scores, gains and measured extra times. An absolute cap avoids spending extra work on a large score gap merely because the incumbent score is high; the relative margin avoids spending it on a small score whose runner-up is much worse proportionally. The combined rule was calibrated on dev. The final 55% rule was probed on all 439 dev drawings. The 40% and 50% rows replayed all 34 and 12 drawings, respectively, whose eligibility could differ, and reused unchanged observations for the others. Thus the reported layouts, gains and eligible counts are actual results, not predictions that the unrestricted winner survives a filter. Timing for those two rows combines replay and reused observations and is diagnostic rather than a controlled benchmark.

The chosen 55% margin is the first tested combined setting above the required 3.4-unit gain. It retains 89.25% of round 1's dev improvement: 3.803186 units, with 29 improved composites. The probe flags 33 candidate-identity returns, including four where the cached incumbent and candidate coincide; those four are not counted as improvements. Runner-up eligibility falls from 366 to 226 drawings (−38.25%). The 55% probe's median paired incremental finishing overhead is 6.76%, versus round 1's 28.99%; its median base/total times are 2069.8/2488.5 ms (+20.23%). These concurrent probe measurements are distinct from the quiet held-out timing table.

The frozen readability implementation and weights were not changed. Validation was evaluated only after selecting the dev cutoff. The second finalist keeps its full existing finishing budget; no reduced-budget approximation was needed.

### Dev trade-off curve

| Margin rule         | Drawings finishing a runner-up | Improved composites | Composite gain | Total extra finishing ms | Median paired overhead |
| ------------------- | -----------------------------: | ------------------: | -------------: | -----------------------: | ---------------------: |
| No cutoff (round 1) |                            366 |                  42 |       4.261236 |                  678,996 |                 28.99% |
| 40%, cap 12,500     |                            196 |                  27 |       3.264550 |                  253,190 |                  0.00% |
| 50%, cap 12,500     |                            216 |                  28 |       3.374023 |                  274,429 |                  0.00% |
| 55%, cap 12,500     |                            226 |                  29 |       3.803186 |                  296,110 |                  6.76% |

Evidence: [final probe](../../tmp/t078-round2/investigation.json),
[curve](../../tmp/t078-round2/curve.json),
[40% replay](../../tmp/t078-round2/margin-0.4/merged.json),
[50% replay](../../tmp/t078-round2/margin-0.5/merged.json),
[preserved round 1 probe](../../tmp/t078-round2/round1-investigation.json).
Zero median paired overhead at the lower margins means more than half the
corpus skips the runner-up; eligible drawings still incur the reported extra
finishing work. Absolute timing between probe runs is sensitive to concurrent
load, so only the quiet held-out table determines timing acceptance.

## Deviations and open questions

- The cutoff is the review-authorized adjustment to round 1's unconditional
  second finishing pass. Both must-fix findings and the assertion-inventory
  check are addressed. No acceptance gate remains open.
- The broader goal of being within 20% of human readability is not yet reached:
  the resulting composite ratios are 1.307× on dev and 1.277× on validation.
- The main comparison uses the preserved original built package from round 1;
  replay hashes verify it against the supplied a9ee786 report. Review/probe
  artifacts are ignored under `tmp/`; no raw Gallery drawing is included in
  the source or tests.
- No commits, pushes, merges, rebases, branch switches, dependency/lockfile
  changes, LLM-provider calls, or edits to `plan.md`, `review.md` or the frozen
  readability metrics/weights were made. Electrical acceptance is graph/Net
  equivalence and routing guards; no circuit simulation was requested or run.
