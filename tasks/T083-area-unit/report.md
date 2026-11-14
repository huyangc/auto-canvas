# T083 report — round 2

## Summary

Resolved round 1's must-fix finding using review option (a): widened the
three-device drafting fixture's input branch and ran every original assertion
at both grid 1 and grid 10. The fixture now exercises route and object anchor
recovery without depending on the former inflated grid-1 area penalty.
No planner code changed in this round. The existing fixed
`READABILITY_AREA_UNIT = 10` implementation and area regression remain intact;
other metrics and frozen weights/scales remain unchanged. All acceptance gates pass.

## Steps

| Step       | Status | Notes                                                                                                                           |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1          | done   | Existing area implementation uses fixed 10 × 10 document-unit squares.                                                          |
| 2          | done   | Area regression covers grid invariance and shrinking; repaired drafting fixture covers both grids with all original assertions. |
| 3          | done   | Reevaluated all 628 drawings and compared with main; all six large documents match.                                             |
| Acceptance | done   | Every acceptance command exits 0; corpus and large-document checks pass.                                                        |

## Review findings addressed

- **Round 1, finding 1 (must-fix):** investigated the free anchors using the
  original fixture, the public planner/transaction preview, drafting ownership
  and displacement calculations, and direct caption recovery. Both notes still
  follow their inferred owners; the free-anchor result is not stranded ink.
  Changed only the left/right input x coordinates from `10`/`190` to
  `-100`/`300` and parameterized the test over grids `[1, 10]`. All original
  assertions remain: drawn branch evidence, no error diagnostics, exact device
  content/object owner, unchanged locked/distant notes, resolving route anchor
  on the original terminal partition, and resolving route anchor after a
  second public planning call. No assertion was weakened or removed.

## Acceptance results

Logs and diagnostic/verification harnesses are in `tmp/t083-round2/`.

```text
pnpm test:local packages/auto-layout/test/follow-drafting-labels.test.ts
  → 1 before the fixture change; expected object anchor, received free.
pnpm test:local packages/auto-layout/test/readability-metrics.test.ts packages/auto-layout/test/follow-drafting-labels.test.ts
  → 0 after the change; 2 files / 18 tests passed in 2.31 s.
pnpm build → 0; all builds completed; bundle-size warnings only.
pnpm typecheck → 0.
pnpm lint → 0; oxlint: 2065 files, 0 errors, 3455 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0 with local-service access; 797 passed / 3 skipped files,
  8191 passed / 117 skipped tests; 153.35 s. No test failures or errors.
pnpm test:slow → 0; 2 files / 8 tests passed in 74.94 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  Wrote tmp/auto-layout-eval/report.json and index.html.
python3 tmp/t083-round2/compare.py → 0; 621 grid-10 hashes/metrics identical,
  628 equivalent, no per-drawing floating/missing regressions.
python3 tmp/excess.py tmp/auto-layout-eval/report.json → 0; output: excess.log.
node tmp/t083-round2/verify-large.mjs → 0; six baseline/current/repeat plans
  byte-identical; no error diagnostics. Data: large.json; log: large.log.
```

## Investigation results

### Why the original fixture retains free anchors

The failing test reproduces in 1.48 s. Scratch diagnostics are in
`diagnose.test.ts`, `diagnose-1.json` and `diagnose-10.json`.

At grid 1, `lower` moves from `(100, 190)` to `(-5, 379)` without rotating.
Caption `m` moves from `(120, 217)` to `(15, 406)`, preserving its exact
`(20, 27)` input displacement. Drafting ownership still identifies `lower`.
At grid 10, `lower` rotates to 270° but `m` still stays free: its `(5, 27)`
displacement from the visible ink centre remains unchanged after following
that centre. Rotation therefore does not itself imply an object anchor.

`F` is inferred as a **route** group in the input, near `(90.241856, 100)`,
rather than as a junction-owned group. R150 maps that conductor by its terminal
partition and nearest projected geometry. At grid 1 its mapped contact is
`(-5, 319)`; `F` finishes at `(-17, 321)`, with the original vertical offset
and a 12-unit leftward clearance adjustment. At grid 10 its mapped contact is
`(30, 320)` and the note finishes at `(20, 332)`. It remains beside the same
Net's routed ink, although this group-following path does not preserve its
original proximity to the exact branch dot. In both outputs the nearest
ownership calculation associates `F` with `left`; neither note becomes
unowned. The frozen `unownedDrafting` measurement remains `1 / 3`: only the
distant `G` is unowned, and locked `k` is excluded from movable groups.

`movedObject` preserves free anchors while translating a group. The successful
joint group-seating path can return without a caption-finishing callback;
standalone caption recovery also runs in other finishing/fallback paths.
`followDraftingLabels` has no condition requiring an owner rotation or a
reroute before anchoring. Calling it directly on either original fixture's
selected plan creates resolving route/object anchors, so safe caption seats
exist; group-following and final selection explain the retained free anchors.
The unit fix changes the selected plan, exposing a fixture assumption about
which finishing path wins, rather than a failure to move the notes.

A bounded scratch search varied device placement while retaining the full
assertion set. Widening the branch to x = -100 and 300 passes at both grids.
The new selected layouts move `lower` to `(-120, 284)` / `(-120, 290)` and
reroute the branch to `(-46, 284)` / `(-20, 290)` (grid 1 / 10). Both create
an object anchor for `m` and a resolving route anchor for `F`, and retain it
on repeated planning. `lower` stays unrotated in both, further confirming that
rotation is not a prerequisite. Diagnostic experiments remain under ignored
`tmp/`; no production instrumentation was added.

### Baseline and corpus invariance

The round 2 evaluation was compared against `tmp/main-8cdec30-report.json`
(main `8cdec30`). All 628 input IDs match. All 621 grid-10 cases have identical
SHA-256 plan hashes, complete readability metric objects, and composite scores
for human, result, and quick layouts. All 628 complete with electrical
equivalence. Floating pins remain 6 and missing connections remain 4 (all in
dev; val remains 0/0), with no increase on any drawing. Full comparison data,
including the seven grid-1 hashes and scores, is in
`tmp/t083-round2/comparison.json`. This independently regenerated comparison
is exactly equal to round 1's comparison; the tables below are confirmed by
the round 2 run.

### Split composites

Values are the evaluator's summed frozen composites; ratio is result/human.

| Split | Drawings | Human before |  Human after | Result before | Result after | Ratio before | Ratio after |
| ----- | -------: | -----------: | -----------: | ------------: | -----------: | -----------: | ----------: |
| dev   |      439 | 48.044550611 | 43.899767814 |  61.058969146 | 54.370761083 |  1.270882303 | 1.238520470 |
| val   |      189 | 26.989218584 | 23.595473540 |  33.575480766 | 27.996936455 |  1.244033082 | 1.186538444 |
| all   |      628 | 75.033769195 | 67.495241354 |  94.634449912 | 82.367697538 |  1.261224792 | 1.220348218 |

The ratios improve beyond the plan's rescaling-only estimate because three
grid-1 drawings select different plans. Weights and scales were not refitted.

### Seven grid-1 drawings

Before → after values below use each version's own selected layout and area
unit. Human area is divided by 100 in every case; result area can also reflect
a changed layout. Values are rounded here; full precision is in the comparison JSON.

| Split / drawing  |                Human area |                 Result area |           Human composite |          Result composite | Plan changed? |
| ---------------- | ------------------------: | --------------------------: | ------------------------: | ------------------------: | ------------- |
| dev `3ze5gasahn` | 80981.919828 → 809.819198 |   58038.656832 → 580.386568 | 1.679254094 → 0.172890125 | 1.090495830 → 0.010904958 | no            |
| dev `dr4e8zhyjg` | 48337.813993 → 483.378140 | 133400.945018 → 1334.009450 | 0.908225439 → 0.009082254 | 2.790947796 → 0.309525062 | no            |
| dev `rxdzz3wdry` | 38775.129229 → 387.751292 |   82089.840000 → 899.498400 | 0.904485468 → 0.183220059 | 1.826856807 → 0.125426428 | yes           |
| dev `tr828v3mrc` | 54728.090253 → 547.280903 |   64886.258939 → 839.462847 | 1.136818802 → 0.118808568 | 1.550062490 → 0.124298412 | yes           |
| val `qzszatannt` | 79945.925927 → 799.459259 |  88601.532322 → 1082.250399 | 1.902477556 → 0.415384356 | 2.390685772 → 0.237385815 | yes           |
| val `s78j9fyzha` | 57475.299720 → 574.752997 |   69059.881380 → 690.598814 | 1.744387831 → 0.675276099 | 1.737006857 → 0.452407564 | no            |
| val `vyqjt4w5gv` | 45026.041300 → 450.260413 | 115080.784179 → 1150.807842 | 0.846000114 → 0.008460001 | 2.379319011 → 0.238673950 | no            |

### Large documents

Reran a scratch copy of the supplied harness in round 2 with the current worktree/input
and output paths and `/tmp/t081-baseline/dist/index.js` as the baseline. Its
existing module-resolution link worked. Compared serialized complete plans,
not just summary metrics, and reran each current plan to check determinism.
All six use grid 10; all match byte-for-byte and have no error diagnostics.
The supplied baseline's compiled JavaScript differs from this worktree's
build only in `readability-metrics.js` (rechecked in round 2).

| Drawing      | Instances | Baseline = current = repeat SHA-256                                |
| ------------ | --------: | ------------------------------------------------------------------ |
| `38m8wdesbh` |        50 | `4458efc1175dec18d7d3d490621f35788695b1c1d060073a607c6e1158377029` |
| `4fb59zv76m` |        50 | `d161eee65e7df08e225c767e934de0e746b59246997310e5070ec46e7addbb1c` |
| `8b2n3zf9vj` |        51 | `18f8a763ffc0a44cc82b90fe3f60797d499c4bd202cb77b8d3da85c0fe5544e6` |
| `b9afqhsjzv` |       103 | `17a349567a59cd582a62073a8043b7e1d41d693e8e4042843984f283e21aaed6` |
| `g47e465db5` |        70 | `3daf09718ae2709487691ec39cca0b506e863cdbf0fb3de1f6674f830b6cc848` |
| `sm663cbs8b` |        94 | `1c97643de4048a58f4f9cd782e547ef3d7e8d6180a36364c2ce0515e3f87c82d` |

## Deviations and open questions

- Used the review's explicitly authorized fixture repair; no planner change
  was necessary. Held-out timing conditional on planner changes is therefore
  not required. The required slow suite is still run.
- `docs/specs/auto-layout.md` does not state the readability area's unit, so
  the plan's conditional documentation change remains unnecessary.
- No dependencies, generated weights, plan/review files, or unrelated paths
  were changed. No LLM-provider calls, commits, pushes, merges, rebases, or
  branch switches were performed.
