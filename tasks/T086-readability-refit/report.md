# T086 report — round 1

## Summary

Implemented geometry-only `collinearAbutment` and regenerated the frozen weights with the unchanged non-negative, dev-only fitting method. Weighted measurement now activates diagnostic calculations according to the generated weights. Added tests for both axes, touching ends, the two-pitch boundary, symbol interruption, same-Net continuations, perpendicular crossings, overlap, degeneracy and order independence; retained full/weighted score equivalence tests.

The score-validation gate passes on the unchanged main layouts, and all three flagged results score worse than human. The two-pitch metric misses the actual flagged four-pitch gap and remains zero-weight because the dev pairs predominantly improve it; this is a measured diagnostic, not a new active penalty. The per-drawing regression and visual gates fail; planner/test acceptance results are recorded below; no weights were set by hand and no placement or routing rules were changed.

## Steps

| Step                  | Status  | Notes                                                                                                                                                                                                          |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigate        | done    | Full metric table and diagnostic blind spots below.                                                                                                                                                            |
| 2. New metric         | partial | Counts same-line, non-overlapping different-Net segment pairs with a gap in [0, 2 × grid], excluding intervening visible symbol bounds. The actual flagged gap is four pitches, outside the planned threshold. |
| 3. Refit              | done    | 439 dev pairs; original algorithm and hyperparameters; source main `17372217c5cd175d0e7cfe3c95ae11ac27187245`.                                                                                                 |
| 4. Validate score     | done    | Both discrimination gates pass, three flagged pairs pass, 20 rises/20 falls and 10 render checks below.                                                                                                        |
| 5. Planner validation | partial | Full corpus evaluated; aggregate score and connectivity pass, per-drawing and visual gates fail. Large documents and determinism pass; three held-out timing gates fail.                                       |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

All seven acceptance commands were run. Final results:

```text
pnpm build → 0; all packages/apps built (existing bundle-size warning).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2071 files, 0 errors, 3478 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 1; 11 failed | 789 passed | 3 skipped test files;
  17 failed | 8218 passed | 117 skipped tests (8352), 98.54 s.
pnpm test:slow → 0; 2 passed files, 8 passed tests, 100.61 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed, 628 equivalent; wrote report.json and index.html.
```

Logs: `tmp/t086/build.log`, `typecheck.log`, `lint.log`, `format.log`, `test-local-final.log`, `test-slow.log`, `planner-eval.log`. Calibration evaluation also exited 0 (`calibration-eval.log`). Focused final metric/performance tests: **39/39 pass** (`focused-final.log`). Large-document and isolated timing harnesses both exited 0. `git diff --check` passes.

The first sandboxed local suite failed on PostgreSQL/socket/launcher access in addition to layout assertions (78 failures). An authorized local-service rerun cleared those infrastructure failures. Its remaining 18 failures included the old fixed crossing coefficient; that precise numeric expectation was updated for the generated model, and the final full rerun has the 17 failures listed below. No test was removed, skipped, or weakened.

### Remaining local-test failures

Every failure is under `packages/auto-layout/test/`. Exact full output is retained in `tmp/t086/test-local-final.log`; these are the relevant assertion outputs:

| File / test                                                                                                  | Output                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| blocker-repair / R72 keeps a repair that routes a Net even when it adds a crossing                           | expected 92969.91314648383 to be less than 92852.12762162642                         |
| branch-columns / keeps the complete old-level plan when series levels increase its score                     | expected 3658.864988302946 to be greater than 5893.39503034729                       |
| compactness-search / R149 judges a gap trial with added crossings by frozen readability                      | expected 4620.398299038407 to be greater than 46521.45348866713                      |
| corpus / two-inverters                                                                                       | expected route points to contain `{x:100,y:120}`; actual points differ               |
| corpus / two-stage-symbolic                                                                                  | expected 430 to be less than 420                                                     |
| finished-selection / returns the finished runner-up when finishing reverses the provisional ranking          | expected 0 to be less than 0                                                         |
| finished-selection / admits an interior source participating in a weighted polarity violation                | expected false to be true                                                            |
| follow-drafting-groups / R150 seats a colliding note near its owner without covering a device                | expected false to be true                                                            |
| port-seat-search / R146 selects the best calibrated routed seat and preserves devices                        | expected 7671.043903453406 to be ≤ 7079.85123678343                                  |
| quality / R44 compares one routing-only replay of the selected refined placement                             | expected routing replay call arrays to be deeply equal; actual rip-up choice differs |
| readability-selection / selects one added crossing that fixes two port-order pairs, including gap compaction | expected 130526.63186156584 to be less than 126513.32880194842                       |
| readability-selection / rejects a lower old routed score when its readability cost outweighs the saving      | selected result object differs from expected retained result                         |
| recover-drafting-owners / preserves the clearance seat of touching captions anchored to a junction           | actual first point `{x:270,y:420}`, expected `{x:310,y:420}`                         |
| recover-drafting-owners / same caption case anchored to a horizontal route                                   | same differing clearance-seat points                                                 |
| recover-drafting-owners / same caption case anchored to a vertical route                                     | same differing clearance-seat points                                                 |
| recover-drafting-owners / keeps a mixed-anchor arrow rigid at its clearance seat                             | actual `{x:270,y:420}`, expected `{x:310,y:420}`                                     |
| signal-series / finishes a deterministic horizontal Vin-to-gate series resistor with Cgs/Cgd                 | expected 40 to be 50                                                                 |

Some assertions encode the old active features (for example port order and source polarity now have zero weight); others protect layout/annotation outcomes that changed under selection. They remain failures for review. This plan does not authorize redesigning placement/routing or deleting their coverage.

## Investigation results

### Provenance and unchanged calibration planner

The branch started clean on `task/T086-readability-refit`, HEAD `e7c936d8799c9813fa71ea2aac85f20aa5f42275`. `git diff 1737221 -- packages/auto-layout scripts/auto-layout-eval.mjs scripts/readability-fit.mjs` was empty before implementation. The original weights stayed in place for the calibration evaluation; all **628 plan hashes match** the supplied main report. Thus the extra metric and weighted-mode refactor did not change calibration layouts.

Commands:

```bash
pnpm build
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
# Preserve report and SVGs as tmp/t086/calibration-report.json and calibration-renders/
node scripts/readability-fit.mjs tmp/t086/calibration-report.json --write --source-commit 17372217c5cd175d0e7cfe3c95ae11ac27187245
```

Generated metadata records the report SHA-256, source commit, exact command and fitting settings. Fitting remains RMS-normalized pairwise logistic regression, 2,000 iterations, L2 0.01, learning rate 0.1, non-negative projection, dev only. No LLM/provider calls were made.

### Every metric on the three flagged main layouts

Each cell is human → main result, using violations (not opportunity-normalized rates). The new metric was absent from the old model and is shown with old weight 0.

| Metric                |  Old weight | New weight |        wvwmyesa4g |         6r2q6deeq9 |        bv9zwmd835 |
| --------------------- | ----------: | ---------: | ----------------: | -----------------: | ----------------: |
| area                  |    0.149349 |   0.363594 | 340.229 → 615.293 |  1016.59 → 996.364 | 440.233 → 486.097 |
| avoidableJogs         |   0.0776628 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| backwardFlow          |           0 |          0 |             0 → 0 |              0 → 0 |             3 → 0 |
| bends                 |           0 |    0.11643 |            3 → 11 |             5 → 18 |             3 → 7 |
| blockedJoins          |  0.00764347 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| collinearAbutment     |           0 |          0 |             0 → 0 |              0 → 1 |             0 → 0 |
| controlSeparation     |   0.0140744 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| crossings             |    0.138307 |   0.132552 |             0 → 0 |              0 → 3 |             0 → 1 |
| detour                |           0 |          0 |  0.1875 → 1.21892 | 1.05072 → 0.846561 |    0.4 → 0.595238 |
| labelClearance        |           0 |          0 |             1 → 1 |              1 → 0 |             0 → 0 |
| labelOverlaps         | 0.000306101 |   0.022528 |             0 → 0 |              0 → 0 |             0 → 0 |
| labelOwnerDistance    |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| narrowBands           |           0 |          0 |             3 → 2 |              0 → 3 |             4 → 4 |
| portOrder             |    0.118427 |          0 |             0 → 0 |              0 → 0 |             2 → 0 |
| potentialOrder        |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 2 |
| railCrossings         |    0.099754 |  0.0269825 |             0 → 0 |              0 → 1 |             0 → 0 |
| railMarkerOrder       |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| signalSeriesVertical  |           0 |          0 |             0 → 0 |              1 → 0 |             0 → 0 |
| sourcePolarity        |   0.0678343 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| structureIntrusion    |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryLevel         |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryMirror        |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| symmetryOrientation   |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| terminalDepartures    |   0.0098887 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| transistorOrientation |           0 |          0 |             0 → 0 |              0 → 0 |             0 → 0 |
| unownedDrafting       |    0.316753 |   0.337913 |             0 → 0 |              0 → 0 |             0 → 0 |
| wireThroughSymbols    |           0 |          0 |             0 → 0 |              2 → 0 |             0 → 0 |

- `wvwmyesa4g`: bends and detour capture the long feedback route (3 → 11 and 0.1875 → 1.21892). `backwardFlow` and `portOrder` have **zero opportunities on both sides**, so neither recognizes the reversed flow here. The fit activates bends, not detour.
- `6r2q6deeq9`: bends (5 → 18), crossings (0 → 3) and rail crossings (0 → 1) capture the torn-apart bridge's routing cost. Detour actually decreases; these metrics do not explicitly recognize the bridge's arrangement.
- `bv9zwmd835`: potential order (0 → 2), bends (3 → 7), detour and crossings capture some of the pulled-up tail layout. All three symmetry metrics have **zero opportunities on both sides**, so reweighting them cannot recognize this degenerated pair's missing mirror. The new abutment metric remains 0 → 0: the actual gap is four pitches, beyond the specified two-pitch limit. Backward flow and port order prefer the result, illustrating conflicting proxy signals.
- On `bv9zwmd835`, both `VISUAL_ROUTE_OVERLAP` and `VISUAL_AMBIGUOUS_JUNCTION` are zero. Source inspection confirms overlap only compares routes of the same Net, while ambiguous junction requires a junction directly on an unrelated route. Neither measures the empty VDD/tail gap.

### Why defects retain zero weight

The following are dev result-minus-human paired differences. “Positive” means a worse result; ties use 1e-10 tolerance. A negative aggregate gives the fit evidence in the opposite direction; correlated features can also be projected to zero. No val data was used to adjust weights.

| Metric              | Positive pairs | Negative pairs | Ties | Sum of differences | New weight |
| ------------------- | -------------: | -------------: | ---: | -----------------: | ---------: |
| backwardFlow        |             51 |             64 |  324 |                -63 |          0 |
| bends               |            205 |            153 |   81 |                298 |    0.11643 |
| detour              |            170 |            224 |   45 |           -75.7169 |          0 |
| symmetryMirror      |              2 |             10 |  427 |                -13 |          0 |
| symmetryLevel       |              0 |              8 |  431 |                -17 |          0 |
| symmetryOrientation |              0 |             45 |  394 |                -74 |          0 |
| potentialOrder      |             14 |             10 |  415 |                  0 |          0 |
| collinearAbutment   |              8 |             55 |  376 |                -63 |          0 |

`collinearAbutment` is worse in only 8 dev pairs and better in 55 (net −63), so the specified method does not support a positive weight. Backward flow, detour and symmetry similarly favor the current planner across dev. Potential order has net zero difference and contributes no retained conditional signal. The full 27-feature paired distribution is in `tmp/t086/score-validation.json`.

### Fixed-layout score validation

Discrimination is the fraction of pairs with human score strictly lower; ties count in the denominator. Both models use the **same calibration report**.

| Split | Pairs | Old discrimination | New discrimination | Old composite ratio | New composite ratio |
| ----- | ----: | -----------------: | -----------------: | ------------------: | ------------------: |
| dev   |   439 |           64.0091% |           70.6150% |            1.194580 |            1.218773 |
| val   |   189 |           60.3175% |           69.8413% |            1.149846 |            1.219059 |

| Flagged drawing |  Old human / result |  New human / result | New result/human |
| --------------- | ------------------: | ------------------: | ---------------: |
| bv9zwmd835      | 0.230652 / 0.117659 | 0.487224 / 0.772699 |         1.585920 |
| wvwmyesa4g      | 0.006393 / 0.011561 | 0.395201 / 0.867304 |         2.194592 |
| 6r2q6deeq9      | 0.019101 / 0.527610 | 1.072334 / 1.910851 |         1.781955 |

The larger area coefficient and newly active bends now outweigh the old port-order preference for `bv9zwmd835`; its new abutment measurement is not responsible for the score reversal because its fitted weight is zero.

### Largest ratio changes (unchanged layouts)

Ranked by the additive change in result/human ratio, new minus old. The driver is the largest signed change in a metric's contribution to that ratio, including each model's changed human denominator. This is attribution of a score change, not a changed layout. In particular, large falls often reflect tiny old human scores.

#### 20 largest rises

| Drawing    | Split | Old ratio | New ratio | Δ ratio | Driver          |
| ---------- | ----- | --------: | --------: | ------: | --------------- |
| qgc6fm8kpe | dev   |    2.4940 |    5.0284 | +2.5344 | unownedDrafting |
| tgz65cq5kt | val   |    0.0358 |    2.0416 | +2.0057 | area            |
| dagyjgbwgw | val   |    0.0593 |    1.9675 | +1.9082 | area            |
| 9qf7cz8p63 | dev   |    0.0199 |    1.8125 | +1.7926 | area            |
| astd8h7a2w | dev   |    0.0136 |    1.7737 | +1.7601 | area            |
| seenreyfeb | dev   |    0.0599 |    1.8146 | +1.7547 | area            |
| gzheekv3cf | val   |    0.0136 |    1.6986 | +1.6850 | area            |
| n25frq3xqh | dev   |    0.1002 |    1.7666 | +1.6664 | area            |
| hrn83wyyde | dev   |    0.0282 |    1.6638 | +1.6356 | area            |
| b45cdfxcfk | dev   |    0.0647 |    1.5316 | +1.4670 | area            |
| 7nmbghagg3 | dev   |    0.6446 |    2.1106 | +1.4660 | area            |
| zsgcm4w69n | val   |    0.3625 |    1.7854 | +1.4229 | area            |
| jkw9pk932h | val   |    0.0710 |    1.4797 | +1.4087 | area            |
| qdadm49css | dev   |    0.0340 |    1.4118 | +1.3778 | area            |
| jvkws955tv | dev   |    0.5843 |    1.9302 | +1.3458 | area            |
| kmpa4qk7k9 | val   |    0.2822 |    1.6243 | +1.3422 | area            |
| n8bkenwpcd | dev   |    0.2292 |    1.5493 | +1.3201 | bends           |
| mszmgeytz2 | val   |    0.0321 |    1.3451 | +1.3129 | area            |
| vrzwa72yfe | dev   |    0.1191 |    1.4241 | +1.3050 | area            |
| 4vtqat76zf | dev   |    0.7713 |    2.0696 | +1.2983 | area            |

#### 20 largest falls

| Drawing                              | Split | Old ratio | New ratio |   Δ ratio | Driver          |
| ------------------------------------ | ----- | --------: | --------: | --------: | --------------- |
| qk9r4bb46n                           | val   |  135.4680 |    7.7596 | -127.7085 | unownedDrafting |
| 7me953ys54                           | dev   |   62.8029 |    1.8297 |  -60.9732 | portOrder       |
| x7evbngj49                           | dev   |   49.4375 |    1.8863 |  -47.5512 | crossings       |
| 7sxpwb4am7                           | val   |   45.3120 |    1.4029 |  -43.9090 | portOrder       |
| xtmvvp3efx                           | dev   |   41.3027 |    0.1831 |  -41.1196 | sourcePolarity  |
| ftzsrk2wva                           | dev   |   42.3280 |    1.8501 |  -40.4779 | portOrder       |
| 63213272-9ba5-442d-88c8-11e4abd514a7 | dev   |   40.7665 |    1.6300 |  -39.1366 | portOrder       |
| ftrjkg4566                           | dev   |   39.6997 |    2.5093 |  -37.1904 | crossings       |
| kggd45xdt5                           | dev   |   35.3091 |    1.2502 |  -34.0589 | crossings       |
| en97w8v92y                           | dev   |   35.9417 |    1.9723 |  -33.9694 | crossings       |
| t3r2dvffgc                           | dev   |   35.4241 |    2.2557 |  -33.1684 | crossings       |
| kjs4xgzkba                           | dev   |   31.7336 |    1.5394 |  -30.1942 | crossings       |
| jkbdeaz3fr                           | dev   |   33.6357 |    5.6760 |  -27.9597 | unownedDrafting |
| jzq4wvkwmf                           | dev   |   32.3195 |    4.7494 |  -27.5701 | crossings       |
| 6r2q6deeq9                           | dev   |   27.6224 |    1.7820 |  -25.8404 | crossings       |
| vyqjt4w5gv                           | val   |   28.2120 |    2.3971 |  -25.8149 | crossings       |
| y3ez763xm8                           | val   |   27.2789 |    2.0362 |  -25.2428 | crossings       |
| a5tz83j7hp                           | dev   |   26.1635 |    1.5057 |  -24.6579 | crossings       |
| 3ykthcctg8                           | dev   |   24.6030 |    1.7700 |  -22.8330 | crossings       |
| sk29mm2ky6                           | dev   |   24.3489 |    1.5162 |  -22.8327 | crossings       |

### Render spot-checks: first five in each direction

Inspected side-by-side PNGs rendered from preserved human/main SVGs, `tmp/t086/<id>-comparison.png`. These are the original layouts used for fitting, before new-weight planner evaluation.

| Direction | Drawing    | Visual observation                                                                                                                                                                                                      |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rise      | qgc6fm8kpe | The compact horizontal result leaves VDD text detached above the devices and rotates the bias-source arrangement; the larger unowned-drafting penalty agrees with the visible loss of association.                      |
| Rise      | tgz65cq5kt | The result stretches the parallel tank and displaces the lower bias branches, with staggered ground routes; the human is a tighter stacked arrangement.                                                                 |
| Rise      | dagyjgbwgw | The human's vertical transistor/source structure becomes a long row with input on the right and large return wires; the original small ratio understated this loss.                                                     |
| Rise      | 9qf7cz8p63 | Parallel branches that share a clean horizontal human bus become a tall, staggered arrangement with a long outer return.                                                                                                |
| Rise      | astd8h7a2w | A compact feedback stage becomes a tall loop with the current source at the bottom and the amplifier at the top.                                                                                                        |
| Fall      | qk9r4bb46n | The result is compact, but collapses the two-terminal impedance depiction into a row with crowded/detached formula labels. It still scores 7.76× human; the drop from 135× is predominantly denominator/scaling change. |
| Fall      | 7me953ys54 | The result keeps a clean mirrored differential pair and moves inputs outward; losing the port-order penalty reduces the former extreme ratio.                                                                           |
| Fall      | x7evbngj49 | The result still has long enclosing routes and loses the human's clear stacked feedback structure. It remains 1.89× human despite a much smaller crossing contribution to its ratio.                                    |
| Fall      | 7sxpwb4am7 | The result retains two mirrored columns and a centered tail, with ports split to both sides; removing port-order weight reduces the old large penalty.                                                                  |
| Fall      | xtmvvp3efx | The result is compact and flips source symbols, but crowds/detaches voltage annotations. Dropping source-polarity weight makes it score better than human; this remains a visible limitation of the fitted proxy.       |

### Planner re-evaluation, guards, large documents and timing

Both main and the new planner are scored using the regenerated weights. Reproduction: `node tmp/t086/compare.mjs`; full per-drawing data is in `tmp/t086/planner-comparison.json`, with the rescored original report in `tmp/t086/main-rescored.json` and new report in `tmp/t086/planner-report.json`.

| Split | Main result/human | New planner result/human | Main result sum | New result sum |
| ----- | ----------------: | -----------------------: | --------------: | -------------: |
| dev   |          1.218773 |                 1.126588 |      377.825417 |     349.247682 |
| val   |          1.219059 |                 1.157447 |      164.088153 |     155.795091 |

These are the new goal baselines. They are below 1.2× despite the expected rise; the unchanged main layouts were above 1.2× under the new score. After planner selection changes, discrimination is dev 61.9590% and val 58.7302%. These are not the step-4 fixed-layout discrimination comparison: the planner has now optimized against the new ruler.

The final three results still score worse than human:

| Drawing    |    Human | New planner | Result/human |
| ---------- | -------: | ----------: | -----------: |
| 6r2q6deeq9 | 1.072334 |    1.898989 |     1.770893 |
| bv9zwmd835 | 0.487224 |    0.874435 |     1.794727 |
| wvwmyesa4g | 0.395201 |    0.437384 |     1.106740 |

331 drawings improve, **98 regress**, 199 have equal scores; 434 plan hashes change. **59 regressions exceed 0.05**, with maximum 2.038461. This fails the ≤5 regressions / ≤0.05 each gate. All regressions (absolute new-score differences) are listed here; no routing/placement change was made to force the gate to pass.

| Drawing    | Split | Score increase |
| ---------- | ----- | -------------: |
| z9mewmgkst | dev   |       2.038461 |
| bxw2egnpy9 | val   |       0.767348 |
| ray97q5c2j | dev   |       0.581482 |
| 52fcykxabp | val   |       0.554895 |
| hr85s6jbqz | dev   |       0.444572 |
| qf5f4t5p8q | dev   |       0.439882 |
| 9bkznd2j3q | dev   |       0.426321 |
| v9c7fgk7rm | dev   |       0.415004 |
| mfeab85zqw | dev   |       0.324492 |
| ted9j68az2 | dev   |       0.322301 |
| ecyqst76jd | dev   |       0.295775 |
| ftrjkg4566 | dev   |       0.293105 |
| gbvzf4h3fj | dev   |       0.292336 |
| dc4m5429tm | dev   |       0.270645 |
| 7q2gadzqmk | dev   |       0.235136 |
| 9db5aza768 | dev   |       0.232851 |
| 3n26zc52rs | val   |       0.226807 |
| nmcsrad5qg | val   |       0.221467 |
| 69ksgcs72g | dev   |       0.217308 |
| de47b9g8hy | val   |       0.209587 |
| en97w8v92y | dev   |       0.206343 |
| kw9emv433j | dev   |       0.196880 |
| g8xh7jm33z | dev   |       0.194443 |
| nsc9bht75e | dev   |       0.183112 |
| 59zd8d2t9q | dev   |       0.169258 |
| kjs4xgzkba | dev   |       0.168785 |
| jkbdeaz3fr | dev   |       0.167073 |
| 8gmbexw4m7 | dev   |       0.155808 |
| dr4e8zhyjg | dev   |       0.144408 |
| xyqfyedxrc | val   |       0.139330 |
| v4rcysdnav | val   |       0.134583 |
| qmcytns39z | dev   |       0.133039 |
| jkw9pk932h | val   |       0.126929 |
| tjatf7fjdr | dev   |       0.125187 |
| ymgvbwf9jv | val   |       0.123849 |
| 3ze5gasahn | dev   |       0.121736 |
| 5sjds93cfr | val   |       0.119911 |
| p2whdap25e | dev   |       0.112383 |
| zevf5z56bn | dev   |       0.111746 |
| 3m82hv6t7a | val   |       0.111683 |
| nfa75tcbqf | dev   |       0.105126 |
| 3byq69ryhz | dev   |       0.103597 |
| bv9zwmd835 | dev   |       0.101736 |
| kdnfpy92ye | dev   |       0.094068 |
| aghg8rnzch | dev   |       0.090751 |
| fp92gscg3m | dev   |       0.082121 |
| x5v9g25v3b | val   |       0.080346 |
| 2sqrha67j7 | dev   |       0.078504 |
| evfgv48paz | val   |       0.078155 |
| 93vpe8chja | val   |       0.076614 |
| 6sp7wwcfkg | val   |       0.073163 |
| rryf923yjz | dev   |       0.071661 |
| 7wffppqsd7 | dev   |       0.070846 |
| 4wce8zcf6c | dev   |       0.067923 |
| nj7zffxnvv | dev   |       0.064328 |
| kyxytts7gz | dev   |       0.061924 |
| ne46whs3fw | dev   |       0.060156 |
| dh2d736kxc | dev   |       0.059033 |
| caafz7vv6j | val   |       0.050387 |
| 7c8zm2gr7e | dev   |       0.042303 |
| j462r7dnbk | dev   |       0.041939 |
| ecw4mse7vb | val   |       0.041689 |
| n4byvdcnar | dev   |       0.041642 |
| dkp3ehx5jt | val   |       0.036155 |
| waknkwmj9v | dev   |       0.034136 |
| 3tte4aw3tf | dev   |       0.034037 |
| eaejh7b8m2 | val   |       0.033710 |
| 3pdxhn7cd8 | dev   |       0.033053 |
| wyq4sp8ycf | dev   |       0.032242 |
| qegvy9c2f6 | dev   |       0.031303 |
| z8wdtvknpa | dev   |       0.028147 |
| hjtfydjx52 | val   |       0.027614 |
| jfp369kpj5 | dev   |       0.027495 |
| pd8crnm97d | val   |       0.025610 |
| ftzsrk2wva | dev   |       0.025071 |
| b5cn37k3a9 | val   |       0.022878 |
| fteqwehmtf | dev   |       0.021668 |
| 59qxym4d4f | val   |       0.021340 |
| vf8bt5jxya | dev   |       0.019201 |
| pke2x27f2e | val   |       0.015442 |
| x5jaqe94t7 | val   |       0.015211 |
| a2nn9n6pbn | dev   |       0.013806 |
| ced3zr4rr6 | dev   |       0.012520 |
| xf9rc3sbtk | val   |       0.012262 |
| 683wwkngmd | dev   |       0.011226 |
| qgc6fm8kpe | dev   |       0.010838 |
| vj8pxfzb9a | dev   |       0.010441 |
| 56a67nmqbb | dev   |       0.009710 |
| c8g3kvjkjd | val   |       0.009456 |
| btx8qnb5jd | dev   |       0.007297 |
| y3ez763xm8 | val   |       0.005953 |
| 5szk39hcj3 | dev   |       0.003018 |
| wj76fmt2de | dev   |       0.002789 |
| jz7rweg6gg | dev   |       0.002632 |
| 95z435k8zx | dev   |       0.002026 |
| kr3ty682m7 | dev   |       0.001737 |
| ag6jww5e97 | val   |       0.001515 |
| 8prnjcqxqn | dev   |       0.000892 |

#### Connectivity and visual guards

628/628 equivalent in both runs. Floating pins remain 6; missing connections remain 4. Four `VISUAL_*` aggregate counts rise, so that gate fails:

| Diagnostic                 | Main | New planner |
| -------------------------- | ---: | ----------: |
| VISUAL_LABEL_CLEARANCE     |  270 |         348 |
| VISUAL_LABEL_RUN_ON        |   29 |          32 |
| VISUAL_TERMINAL_DEPARTURE  |   32 |          46 |
| VISUAL_WIRE_THROUGH_SYMBOL |    4 |           8 |

Every other visual diagnostic total is equal or lower; the complete totals are in `planner-comparison.json`.

#### Six large documents and determinism

Ran `node tmp/t086/verify-large.mjs` using the supplied `/tmp/t086-baseline/dist` build. Adapted the T080 harness only under ignored `tmp/t086/`; `/tmp/t086-baseline/node_modules` links to this worktree's auto-layout package dependencies for local module resolution. No dependency was installed or changed. All six plans are byte-identical to main, repeat byte-identically, and have no error diagnostics:

| Drawing         | Instances | Byte-identical | Repeat deterministic |
| --------------- | --------: | -------------- | -------------------- |
| 38m8wdesbh.json |        50 | yes            | yes                  |
| 4fb59zv76m.json |        50 | yes            | yes                  |
| 8b2n3zf9vj.json |        51 | yes            | yes                  |
| b9afqhsjzv.json |       103 | yes            | yes                  |
| g47e465db5.json |        70 | yes            | yes                  |
| sm663cbs8b.json |        94 | yes            | yes                  |

#### Held-out timing, run alone

Ran `node tmp/t086/timing.mjs` after the full corpus, large documents and final local suite finished, with no other build/test/evaluation running. Warmed each implementation once; three samples each with alternating order; medians below. Full samples, phase timings, call counts and hashes are in `tmp/t086/timing.json`.

| Fixture          | Main median ms | New median ms | Ratio | ≤1.20  | Repeat deterministic | Same plan as main |
| ---------------- | -------------: | ------------: | ----: | ------ | -------------------- | ----------------- |
| fd-two-stage     |         1733.6 |        1960.9 | 1.131 | yes    | yes                  | yes               |
| common-source-ac |         1042.7 |        1379.0 | 1.323 | **no** | yes                  | yes               |
| skew             |         1780.3 |        4194.4 | 2.356 | **no** | yes                  | no                |
| deadtime         |        10053.5 |       18352.4 | 1.825 | **no** | yes                  | no                |
| ota-sky130       |          684.3 |         702.1 | 1.026 | yes    | yes                  | no                |
| widlar           |         5420.4 |        5339.7 | 0.985 | yes    | yes                  | no                |
| ltc3452          |        14074.5 |       13963.3 | 0.992 | yes    | yes                  | yes               |

Three timing gates fail. Determinism passes for all seven new and baseline runs. The principal growing phase medians are below; `finishing` is nested instrumentation, so these phase costs must not be summed as independent wall time.

| Fixture          | Phase      | Main ms | New ms | Main/new call count (first samples) |
| ---------------- | ---------- | ------: | -----: | ----------------------------------: |
| common-source-ac | relocation |   259.1 |  374.4 |                               2 / 3 |
| common-source-ac | rails      |     1.4 |   95.7 |                               2 / 3 |
| common-source-ac | finishing  |   100.8 |  199.4 |                             49 / 72 |
| skew             | relocation |    10.9 |  684.1 |                               1 / 2 |
| skew             | ports      |    22.6 | 1445.1 |                               1 / 2 |
| skew             | gaps       |   158.9 |  263.2 |                               1 / 2 |
| skew             | drafting   |    80.7 |  183.6 |                               1 / 2 |
| skew             | finishing  |   199.3 |  826.7 |                             42 / 58 |
| deadtime         | relocation |    27.8 | 5188.9 |                               1 / 1 |
| deadtime         | ports      |    32.5 | 3349.9 |                               1 / 1 |
| deadtime         | rails      |   410.1 |  591.3 |                               1 / 1 |
| deadtime         | finishing  |   721.7 | 6011.1 |                             50 / 48 |

Direct readability timing grows only 17.2 → 24.1 ms (common-source-ac), 21.9 → 39.5 ms (skew), and 104.4 → 155.6 ms (deadtime). The much larger wall-time increases are primarily changed search/finishing trajectories, not just calculating the newly active bend count.

Proposed follow-up bound (not implemented, as it changes search policy): retain pre-refit finalist-pass caps (≤2 for the common-source workload, ≤1 for the skew workload) using generic deterministic candidate budgets, and bound relocation/port trial evaluations for the deadtime workload. These are workload observations, not permission to dispatch by fixture ID. Revalidate against total median ceilings of **1251.2 ms**, **2136.4 ms**, and **12064.2 ms** respectively on this machine (1.2 × baseline). Count budgets preserve determinism; these ceilings are acceptance targets, not a claim that a particular cap is already proven to meet them. Retain the best complete incumbent and all existing physical/visual guards. A separate scoped planner plan is needed.

Direct baseline geometry inspection (`tmp/t086/abutment-inspection.log`) found the VDD segment at x=280–350, y=180 and the tail segment at x=390–430, y=180. The gap is 40 with grid 10. These coordinates are investigation evidence only, not metric logic. The requirement that this exact example count conflicts with the specified threshold; the implementation preserves the threshold and the test covers four-pitch exclusion.

## Deviations and open questions

- No commits, pushes, branch switches, dependency changes, hand-edited generated files, plan/review edits or placement/routing edits.
- Metric semantics: opportunities are different-Net non-degenerate axis-aligned segment pairs on the same exact line. Positive-length overlap is excluded from abutment violations; intervening symbols use the repository's visible symbol bounds. These choices and the threshold should be recorded in the readability spec by the reviewer; no docs outside the owned report were edited.
- The generic weighted-mode gates retain the full evaluator path and activate previously diagnostic calculations when their fitted weight becomes positive. The current refit activates only bends among previously zero-weight metrics.
- The frozen score improves the requested pairwise discrimination but is not a complete model of visual readability. In particular, backward flow/symmetry have recognition gaps on the flagged examples, and the new abutment metric receives no active penalty under the required fit. A future change to recognition or to the learning objective requires a separate plan.

- The requirement that `bv9zwmd835` itself count cannot be met at the specified two-pitch threshold: its actual VDD/tail gap is four pitches. A revised definition needs a new plan; this round did not widen the threshold or change the grid.
- The generated calibration changes several existing planner-choice assumptions and visual outcomes. Scope explicitly excludes placement/routing rules; failed assertions and guards were preserved for review rather than weakening them or introducing a new selection design.
- Updated the frozen one-crossing regression expectation from 0.10852563607446113 to the generated coefficient 0.13377676865391394. The assertion retains its 12-decimal precision and its separate linearity, opportunity independence and diagnostic-zero checks.

- Overall round status: **partial**. Remaining blockers are the four-pitch example versus two-pitch definition, 17 local test failures, 98 per-drawing regressions (59 above 0.05), four increasing visual diagnostics, and three timing regressions. No acceptance failure is treated as a pass.
