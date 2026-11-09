# T026 report — round 1

## Summary

Implemented the experimental partition contract, deterministic human/LOADBench adapters,
V1 automatic and V2 oracle floorplans, evaluation flags/metrics/overlays, and synthetic tests.
All product changes are opt-in. The approved base is `f8f15fe`; the starting branch differs
from that base only by this task's plan. No commits or branch changes were made.

**Recommendation: do not advance to LLM partition prediction on this evidence.** Neither
variant clearly beats V0 on both splits. V2 improves on V1, but versus V0 its dev crossings
increase (295 → 301) while val crossings decrease only modestly (321 → 305). Floating pins
increase from 0/1 (dev/val) to 4/3. Block cohesion and arrangement agreement improve, but
those gains do not establish better routed drawings. This is a negative result for this
mechanism, not proof that an ideal manual partition could never help.

## Steps

| Step | Status                         | Notes                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done                           | `partition.ts` validates member/block/flow/centre identity, fills missing devices, merges recognized L0 units transitively, and reports conflicts. Caller data remains unchanged.                                                                                                                                                      |
| 2    | done with coverage limit       | H uses positions, enclosing drafting rectangles and non-rail Net edges; L maps functional XML parts to T022-converted references. All 101 L inputs are recorded; 18 have unmappable XML members.                                                                                                                                       |
| 3    | done                           | Reuses stages' layered local layout and recognized templates/rail alignment. V1 respects flow (otherwise signal distance); side roles occupy a separate lower row. V2 uniformly scales centres and separates boxes along the smaller overlap axis. Existing finishing/routing/refinement/repair/label/transaction paths remain active. |
| 4    | partial, frozen-rule limit     | V3 was attempted for every human case with all instances fixed. Only 3 dev and 0 val cases pass existing R10. R10 was not changed.                                                                                                                                                                                                     |
| 5    | done                           | CLI flags, dev/val summaries, geometry/readability/cohesion/agreement metrics, plan hashes, baseline equality check, and dashed SVG block overlays. Refusals/errors stay in JSON and HTML.                                                                                                                                             |
| 6    | done                           | 12 hand-built tests cover validation, L0 merge, missing devices, flow/side roles, V2 arrangement/overlap, crossing rejection, replay, oracle clustering/XML mapping and a base-output hash. No CI test uses private data.                                                                                                              |
| 7    | done with unavailable V3 cells | Metrics, threshold sensitivity, six rendered sets and recommendation below. Unavailable references are shown as unavailable, never as zero-quality successes.                                                                                                                                                                          |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Logs are under git-ignored `tmp/t026/logs/`. Runtime/database checks use lane 2:
`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; no broken links.
pnpm typecheck → 0.
pnpm lint → 0; 0 errors (repository warnings remain).
pnpm vitest run packages/auto-layout → 0; 18 files, 353 tests passed.
pnpm test:local → 0 outside sandbox; 755 files passed, 7639 tests passed, 116 skipped (sandbox attempt: 1, EPERM).
pnpm deadcode 2>&1 | grep -E 'auto-layout' → grep 1; no output, as expected.
pnpm build → 0; editor build completed (chunk-size warnings only).
pnpm auto-layout:review → 0; wrote 9 corpus and 7 held-out SVGs.
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0; 33/33 completed, all original metrics equal base.
pnpm auto-layout:eval tmp/human-cases --partition human --variant v1 --jobs 12 → 0; 33/33 completed.
pnpm auto-layout:eval tmp/human-cases --partition human --variant v2 --jobs 12 → 0; 33/33 completed.
pnpm auto-layout:eval tmp/human-cases --fixed-human --jobs 12 → 0; 3/33 completed, 30 explicit R10 refusals.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|recognition/' → 0; three pre-existing T022 task Markdown paths (see below).
```

The tracked-data grep is broader than its stated intent: it matches
`tasks/T022-auto-layout-recognition/{plan,report,review}.md`, already present in the base.
No case, case excerpt, case id, id-keyed data, or evaluation artifact was added to tracked files.
The initial auto-layout suite run overlapped several corpus worker pools and hit two timeouts
(5 s quality test, 30 s 120-device test); the subsequent run passed without changing any timeout.
The sandboxed full suite failed on local PostgreSQL/process access (`connect EPERM`);
the lane-2 run outside the sandbox is recorded separately below.

Additional evidence: serialized **entire plan** SHA-256 hashes match the pre-change approved
base for all 33 human cases (not just scores). The synthetic default-plan hash is also pinned
in the committed hand-built test. Base snapshots/hashes live only under `tmp/t026/`.

## Investigation results

### Measurement conventions and safety

H threshold is **3 × median device visible-ink span**, chosen on dev before evaluating val.
Non-rail connectivity and rectangle enclosure are the only spatial merge mechanisms;
recognized L0 units remain atomic. H has no inferred functional roles, so its SVG roles are
`unlabeled`. The optional role contract is exercised by hand-built and LOADBench inputs.
V1 receives H's flow but not its centres. V2 receives both.

Counts and wire lengths are summed over completed documents. Area is the mean per-document
ratio of SVG drawing-bound width × height to the human drawing. Cohesion is summed pairwise
block bounding-box intersection area (lower is better). Agreement is the share of block pairs matching both centroid left/right and above/below
relations wherever the human coordinates are not tied; no constrained pair means N/A.
Electrical equivalence uses the terminal partition and, when the input graph is ready,
the projected electrical graph.

All completed H and L variants replay through the existing transaction checks, preserve the
terminal partition (and the electrical graph wherever ready), and have zero unsafe-routing
problems. Floating pins
are still reported and backed by existing R14 warnings; zero unsafe geometry does not mean
all Nets routed successfully. No router, R10, R23 or `lostNameClaim` implementation changed.

### Human results

| Split | Variant | Completed | Crossings | Bends | Floating | Label overlap | Label clearance | Terminal departures | Wire length | Mean area ratio | Block overlap area | Arrangement agreement |
| ----- | ------- | --------- | --------- | ----- | -------- | ------------- | --------------- | ------------------- | ----------- | --------------- | ------------------ | --------------------- |
| dev   | V0      | 18/18     | 295       | 401   | 0        | 0             | 40              | 7                   | 123660      | 2.734           | 904982.6           | 43.6%                 |
| dev   | V1-H    | 18/18     | 355       | 424   | 3        | 0             | 40              | 4                   | 127960      | 2.430           | 0.0                | 71.8%                 |
| dev   | V2-H    | 18/18     | 301       | 400   | 4        | 0             | 33              | 5                   | 130170      | 3.005           | 0.0                | 94.9%                 |
| dev   | V3      | 3/18      | 21        | 38    | 1        | 0             | 20              | 2                   | 13390       | 1.025           | 66118.7            | 100.0%                |
| val   | V0      | 15/15     | 321       | 391   | 1        | 0             | 31              | 5                   | 147150      | 2.441           | 968973.3           | 38.6%                 |
| val   | V1-H    | 15/15     | 359       | 441   | 0        | 0             | 31              | 4                   | 137180      | 2.305           | 0.0                | 79.5%                 |
| val   | V2-H    | 15/15     | 305       | 431   | 3        | 0             | 30              | 1                   | 126290      | 2.418           | 0.0                | 93.8%                 |
| val   | V3      | 0/15      | —         | —     | —        | —             | —               | —                   | —           | —               | —                  | —                     |

V3 is **not** comparable to the full-split V0/V1/V2 totals: dev retains only 3 drawings and
val has none. Its 30 refusals are: dev 9 coincident-pin, 4 overlapping-device-bound and
2 drafting-clearance violations; val 9 coincident-pin and 6 overlapping-device-bound
violations. Per-document messages remain in `tmp/auto-layout-eval/v3/report.json`.
The plan's assumption that fixing every instance always provides a router-only reference
does not hold with the frozen R10 checks. Reconstructing the older T016 reference would
require a separately approved design; no guard was weakened here.

For the 3 dev drawings that **do** complete V3, the matched comparison is:

| Variant | Crossings | Bends | Floating | Label overlap | Label clearance | Terminal departures | Wire length | Mean area ratio | Block overlap area | Arrangement agreement |
| ------- | --------- | ----- | -------- | ------------- | --------------- | ------------------- | ----------- | --------------- | ------------------ | --------------------- |
| V0      | 28        | 53    | 0        | 0             | 4               | 3                   | 16470       | 1.991           | 39740.8            | 33.3%                 |
| V1-H    | 52        | 77    | 1        | 0             | 6               | 2                   | 19900       | 1.622           | 0.0                | 100.0%                |
| V2-H    | 47        | 63    | 0        | 0             | 5               | 2                   | 19950       | 1.749           | 0.0                | 100.0%                |
| V3      | 21        | 38    | 1        | 0             | 20              | 2                   | 13390       | 1.025           | 66118.7            | 100.0%                |

### Dev-only threshold sensitivity

All three probes used V1 and `--split dev --jobs 12`. Selection prioritized completion,
then compared crossings on the common 14 documents; threshold 3 wins both. No val score
was consulted during selection. Smaller thresholds create many isolated blocks; threshold
3 merges more of the drawing, which limits how strongly this can be called an oracle upper
bound rather than a deterministic spatial proxy.

| Threshold | Completed / 18 | Total blocks | Crossings (completed) | Crossings (common 14) | Floating (common 14) | Mean area ratio |
| --------- | -------------- | ------------ | --------------------- | --------------------- | -------------------- | --------------- |
| 1         | 14/18          | 217          | 313                   | 313                   | 2                    | 3.142           |
| 2         | 16/18          | 98           | 262                   | 247                   | 2                    | 2.618           |
| 3         | 18/18          | 46           | 355                   | 225                   | 2                    | 2.430           |

Probe reports are `tmp/t026/dev-threshold-{1,2,3}/report.json`. The chosen threshold is
frozen in the oracle adapter and evaluator default. Product default mode does not use it.

### LOADBench

Source: [LOADBench, Zenodo 10.5281/zenodo.21759759](https://doi.org/10.5281/zenodo.21759759),
CC BY 4.0. Data were copied to this worktree's ignored `tmp/t026/loadbench/`.
T022's `loadbench`/`importBody` conversion functions were reused in a throwaway script,
wrapping their Documents in Projects and copying matching XML alongside them in
`tmp/t026/loadbench-projects/`. The converter produces placeable Documents. We use the
XML's functional parts; repeated XML labels deduplicate and overlapping labels merge.

83/101 documents map and complete; 12 dev and 6 val XMLs reference a capacitor absent from
the converted document. They remain explicit `threw` entries with the missing-member
reason, and the additional L evaluator command exits 1 rather than silently dropping them.
No id-specific workaround was added. There is no human geometry or arrangement reference,
so area ratio/agreement and V2-L are unavailable. CircuitGenome was not needed.

| Split | Variant      | Completed / inputs | Crossings | Bends | Floating | Label overlap | Label clearance | Terminal departures | Wire length | Mean area ratio | Block overlap area | Arrangement agreement |
| ----- | ------------ | ------------------ | --------- | ----- | -------- | ------------- | --------------- | ------------------- | ----------- | --------------- | ------------------ | --------------------- |
| dev   | V0-L matched | 59/71              | 517       | 972   | 0        | 0             | 0               | 0                   | 330760      | —               | 4102768.2          | —                     |
| dev   | V1-L         | 59/71              | 999       | 1497  | 7        | 0             | 0               | 0                   | 416550      | —               | 0.0                | —                     |
| val   | V0-L matched | 24/30              | 246       | 462   | 0        | 0             | 0               | 0                   | 147210      | —               | 1710954.0          | —                     |
| val   | V1-L         | 24/30              | 422       | 699   | 0        | 0             | 0               | 0                   | 174910      | —               | 0.0                | —                     |

Command: `pnpm auto-layout:eval tmp/t026/loadbench-projects --partition loadbench --variant v1 --jobs 12`.
Raw results are in `tmp/auto-layout-eval/v1-loadbench-3/report.json`.
LOADBench also shows worse crossings with this block mechanism; grouping alone is not a
sufficient placement objective.

### Six rendered sets

`tmp/t026/rendered/set-01.html` through `set-06.html` and corresponding PNGs contain
**human | V0 | V1 | V2**, each with the chosen H partition's dashed boxes. Sets 01–03
are dev and 04–06 are val. Within each split they show the best, median and worst V2
crossing change versus V0; the deterministic ignored manifest records their identities.
All full per-variant SVGs and metrics remain in `tmp/auto-layout-eval/`.
All six PNGs were visually inspected. Sets 02 and 05 collapse into one block, so V1 and V2
are effectively the same local placement; this illustrates the proxy's limits. Set 04
recovers a two-dimensional floorplan from the long V1 row, while set 06 exposes longer
inter-block routing. Dense diagrams can be zoomed in the accompanying vector HTML/SVG.
The final V2 checks include a regression for nearly coincident centres on unequal-size
blocks: grid snapping is corrected to oracle order before overlap pushes.
The evaluator's final agreement score counts a pair only when both specified directions
match; a synthetic probe verifies that matching just one of two directions scores zero.

## Deviations and open questions

- Partition mode is quick-only, as the plan permits. A supplied search request gets an
  explicit warning and the same quick result; no annealing move can cross a block.
- Local placement uses the stages' existing layered/template rules for both variants.
  Cross-block parallel/driver attachments are scoped to their own partition; finishing
  that crosses a separating axis is refused. The default strategy portfolio is unchanged.
- Bias/other/CMFB/compensation roles occupy one row below signal blocks. Mixed-role L0
  merges become `other`, which can put a mixed signal/bias unit in that row; this simple
  rule may partly explain the LOADBench regression.
- V3 cannot supply a full reference without changing frozen geometry behavior. L coverage
  is limited by the converter/XML mismatch. These are recorded limitations, not dropped
  documents or favorable substitutions.
- This spatial H proxy sometimes collapses much of a drawing into one block. Before an
  LLM phase, review the six sets and consider a separately scoped in-block placement or
  floorplan objective experiment. The present data do not demonstrate a clear gain on
  both splits, and the floorplan gain over V1 comes with more incomplete routing.
