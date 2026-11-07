# T017 report — round 2

## Summary

Added R63 exact initial-edit deduplication before ranking, with hand-built tests for one refinement of identical strategies, selection of the next distinct strategy, and repair of an initially refused candidate that wins. Removed R61 and restored zero refinement above 40 instances, including the specification and 60-instance test. R60 and R62 are unchanged from round 1.

This round is **partial**. Exact deduplication exposes a conflict in the approved plan: refused strategies all return `edits: []`, although their refinement replays can differ. The existing two-inverter corpus replan test fails because deduplication discards the only repairable strategy. The test and R10 remain unchanged. The required human-case quality targets also remain unmet; measured results appear below.

## Steps

| Step              | Status  | Notes                                                                                                                                                                                            |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — R60           | done    | Kept the round 1 device-class conduction and winding isolation implementation.                                                                                                                   |
| 2 — R61           | done    | Removed as directed by amendment step 7.                                                                                                                                                         |
| 3 — R62           | done    | Kept the round 1 rail Cell Pin clearance implementation. Updated R14 results are below.                                                                                                          |
| 4 — Tests         | done    | Kept R60/R62 tests; revised the 60-instance test to assert zero candidates, deterministic results and input purity. Added two R63 tests and extended the existing portfolio test.                |
| 5 — Report        | done    | Comparisons against T016 and round 1, the isolated step 6 effect, timing and six rendered pairs are below.                                                                                       |
| 6 — R63           | partial | Implemented the specified deduplication, ordering, candidate limits and R44 replay. All three hand-built R63 behaviors pass. The all-refused replan conflict prevents full acceptance.           |
| 7 — Remove R61    | done    | Restored the original size budget. Round 1 measured only one crossing saved, five extra bends and additional planning time.                                                                      |
| 8 — Merged stages | done    | Investigated dev documents only. Three general ordering/mirroring probes failed to remove both regressions; restored all experimental changes and kept stage formation unchanged, as authorized. |

## Review findings addressed

1. **Must-fix 1 — duplicates/refused candidates:** initial edit lists are compared exactly in `template`, `layered`, `stages` order before ranking. Distinct candidates retain the existing score and tie rules; a refused candidate fills an available refinement slot and can win after repair. Tests use real placement, routing and transactions. This finding remains **partial** because the plan's exact-edit rule also collapses distinct refused replays; see the conflict below.
2. **Must-fix 2 — R61:** removed its implementation and specification rule. Above 40 instances, refinement tries zero candidates. The 60-instance test now checks bounded deterministic planning, without requiring refinement.
3. **Must-fix 3 — merged switch stages:** reproduced and investigated the stage regressions. No tested general mechanism removed the cause, so no placement change was retained. Device-class stage splitting was not introduced.

## Acceptance results

Every listed command was run on the named branch. Lane 1 was used: `ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`, `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. Logs and command exit codes are in `tmp/t017-r2-logs/`.

```text
pnpm install --frozen-lockfile --offline → exit 0; already up to date; offline, frozen lockfile
pnpm format:check → exit 0; All matched files use Prettier code style!
pnpm docs:check → exit 0; Validated local Markdown links
pnpm typecheck → exit 0; no type errors
pnpm lint → exit 0; 0 errors, 2674 existing warnings
pnpm vitest run packages/auto-layout → exit 1; 126 pass, 1 fails: two-inverters replan at corpus.test.ts:544
pnpm test:local → exit 1; sandbox run: 58 failed, 7317 passed, 149 skipped; EPERM for local services/processes plus the corpus replan failure
pnpm deadcode 2>&1 | grep -E 'auto-layout' → exit 1; no output; grep exit 1 means no auto-layout findings
pnpm build → exit 0; all builds complete
pnpm auto-layout:review → exit 0; 9 corpus and 7 held-out initial layouts commit; all review gates pass
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → exit 0; 32 completed; electrical equivalence, routing safety and R14 coverage pass
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → exit 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → exit 1; no output; grep exit 1 means no tracked private case/evaluation files
```

Reran `pnpm test:local` with access to local PostgreSQL, test listeners and process control: **exit 1; 7,407 passed, 1 failed, 116 skipped**, across 744 passed files, 1 failed file and 2 skipped files. The only remaining failure is the same two-inverter corpus replan at `corpus.test.ts:544`. Local-service and process errors disappear. Evidence: `tmp/t017-r2-logs/local-services.log` (65.25 s suite duration).

The three R63 hand-built behaviors pass, as does R44. The focused suite has 9 files: 8 pass and 1 fails. Its one failure is an existing rejection/replanning contract, not a changed quality threshold. No test was weakened, skipped or removed to conceal it. The deadcode and privacy pipelines have the expected empty output; grep's no-match exit status is 1.

## Investigation results

### Round metrics

Each cell is **T016 → round 1 → round 2**, over all completed documents, using `tmp/t016-final-eval.json`, the saved round 1 evaluation and `tmp/t017-r2-final-eval.json`.

| Split | Completed    | Crossings       | Bends           | Floating pins |
| ----- | ------------ | --------------- | --------------- | ------------- |
| dev   | 17 → 17 → 17 | 274 → 303 → 285 | 332 → 360 → 345 | 44 → 35 → 39  |
| val   | 15 → 15 → 15 | 483 → 480 → 481 | 434 → 457 → 452 | 52 → 44 → 44  |
| all   | 32 → 32 → 32 | 757 → 783 → 766 | 766 → 817 → 797 | 96 → 79 → 83  |

Main metric: **757 → 766 crossings**, a **+1.19% change** (−1.19% improvement). Against round 1, **783 → 766**, a **−2.17% change** (2.17% improvement). Dev is 274 → 285 (+4.01%); val is 483 → 481 (−0.41%). Against round 1, dev improves by 18 crossings while val worsens by one. No val documents were used to investigate or tune placement.

Targets against T016: crossings lower = **FAIL**; completed at least 32 = pass; bends at most 766 = **FAIL** (797); floating pins at most 96 = pass (83); slowest at most 12 s = pass (11.379 s, 31 instances). Electrical equivalence and routing safety hold for completed evaluation transactions. These changes affect topology presentation only; electrical models and simulation behavior are unchanged.

### Effect of step 6 alone

R63 was built and evaluated **before** removing R61, with R60/R61/R62 otherwise unchanged. Saved evidence: `tmp/t017-r2-step6-eval.json` and `tmp/t017-r2-logs/step6-eval.log`.

| Split | Completed, round 1 → R63 only | Crossings | Bends     | Floating pins |
| ----- | ----------------------------- | --------- | --------- | ------------- |
| dev   | 17 → 17                       | 303 → 285 | 360 → 345 | 35 → 39       |
| val   | 15 → 15                       | 480 → 480 | 457 → 457 | 44 → 44       |
| all   | 32 → 32                       | 783 → 765 | 817 → 802 | 79 → 83       |

The isolated change saves 18 crossings (2.30%) and 15 bends, but adds four floating pins, all in one 24-instance dev document. It refines the formerly refused stage strategy, which wins. Val is unchanged. Removing R61 afterward adds one crossing, removes five bends and leaves floating pins unchanged. Step 8 retains no production change, so it has no effect on final metrics.

### Corpus and held-out

| Set      | Completed, T016 → round 1 → round 2 | Crossings    | Bends        | Floating pins |
| -------- | ----------------------------------- | ------------ | ------------ | ------------- |
| corpus   | 9 → 9 → 9                           | 1 → 1 → 1    | 8 → 8 → 8    | 0 → 0 → 0     |
| held-out | 7 → 7 → 7                           | 45 → 45 → 45 | 92 → 92 → 92 | 12 → 9 → 9    |

Initial-layout corpus targets and held-out crossing ceilings hold. **Corpus acceptance as a whole fails** because of the two-inverter replan regression below; the review script measures initial layouts and does not cover this boundary.

### Exact-edit deduplication conflicts with refusal recovery

Reproduction: `pnpm vitest run packages/auto-layout/test/corpus.test.ts -t two-inverters`. The existing test commits the first plan, then plans the committed document again. The second plan returns `R10: whole-list replay changed a terminal Base Net partition` at `corpus.test.ts:544`.

A throwaway trace (`node tmp/t017-r2-replan.mjs`) isolates the problem:

| Strategy on the committed document | Initial edits | Initial score | Score after independent refinement |
| ---------------------------------- | ------------- | ------------- | ---------------------------------- |
| template                           | `[]`          | infinity      | infinity                           |
| layered                            | `[]`          | infinity      | 1339                               |
| stages                             | `[]`          | infinity      | infinity                           |

The specified fixed-order deduplication retains template and drops layered. Their returned edit lists match exactly because refusing safely returns no edits; their candidate replays are not interchangeable. Before deduplication, the all-refused tie rule selected layered and refinement repaired it. Preserving that behavior requires amending what is deduplicated, or exempting some refused runs. Neither exception is in the approved step. Per AGENTS.md, no different design or R10 relaxation was improvised. The exact-rule implementation is left reviewable, with the failing test intact.

### Merged-stage investigation (dev only)

The deterministic probe `node tmp/t017-r2-stage-probe.mjs` reproduces the routed-crossing symptom and fails with `merged-stage regressions remain`. It compares the stage strategy in two dev documents with its recorded pre-R60 stage result. Private inputs and trace details stay under ignored `tmp/`.

| Dev document size | Merged stage size | Pre-R60 crossings | Current crossings |
| ----------------- | ----------------- | ----------------- | ----------------- |
| 19                | 13                | 8                 | 19                |
| 25                | 16                | 9                 | 17                |

`netLevels` adds channel edges for MOS/source channels and two-terminal devices adjacent to rails. Most floating two-terminal switches have no such channel edge. When R60 merges their conducting network into a stage, 12 devices occupy the same initial row in each probe. R32 minimizes adjacent-row inversions and same-row Net spans; it does not score actual horizontal trunk/branch intersections. The resulting compact order can therefore remain crossing-heavy. The old singleton stages had a different search surface: each device block could move or mirror independently under the stage estimator.

Ranked hypotheses were missing levels, an incomplete row-order objective, and stage mirroring. Probes changed one mechanism at a time, using the real placement/router path:

| General trial                                                         | Crossings at 19 instances | Crossings at 25 instances |
| --------------------------------------------------------------------- | ------------------------- | ------------------------- |
| Reverse each in-stage row before column assignment                    | 16                        | 15                        |
| Three adjacent-swap passes ranked by the existing placement estimator | 18                        | 15                        |
| Disable stage-block mirroring                                         | 19                        | 14                        |

None removes both regressions to the pre-R60 level. These probes support the row-level/order limitation and show that mirroring alone is insufficient. No arbitrary direction for undirected switch channels or device-class stage split was added. All experimental source changes were restored, checked byte-for-byte against the pre-probe source, and the package rebuilt. Full dev documents were retained as the investigation seam because the observed symptom is the complete routed layout; no minimized private fixture or experimental fix was promoted into tracked tests.

### Planning time against size

Sequential final evaluation, with no concurrent tests or build work; includes the refused document. Times are seconds inside `planAutoLayout`, and candidate counts describe the selected strategy.

| Instances | Documents | Minimum s | Median s | Maximum s | Maximum selected candidates |
| --------- | --------- | --------- | -------- | --------- | --------------------------- |
| 1–20      | 11        | 0.256     | 1.576    | 3.787     | 14                          |
| 21–40     | 16        | 0.472     | 5.207    | 11.379    | 14                          |
| 41–60     | 3         | 1.124     | 1.748    | 1.808     | 0                           |
| 61–80     | 1         | 2.547     | 2.547    | 2.547     | 0                           |
| 81–120    | 2         | 3.726     | 5.060    | 6.395     | 0                           |

R61 removal restores zero candidate routing above 40 instances. All initial strategy routes and the single R44 replay remain. The 60-instance hand-built test confirms zero candidates, deterministic edits/metrics and input purity.

### Remaining R14 floating-pin causes

Every completed document with floating pins is represented below. Raw Net/pin identifiers and messages remain in local evaluation artifacts.

| Split | Instances | Floating pins | R14 causes                                                   |
| ----- | --------- | ------------- | ------------------------------------------------------------ |
| dev   | 50        | 6             | different-Net pin contact                                    |
| val   | 40        | 8             | instance blocks branch                                       |
| dev   | 50        | 6             | instance blocks branch                                       |
| val   | 35        | 8             | instance blocks branch                                       |
| val   | 103       | 19            | instance blocks branch, different-Net Route endpoint contact |
| dev   | 20        | 3             | instance blocks branch                                       |
| val   | 20        | 1             | different-Net Route endpoint contact                         |
| dev   | 23        | 10            | instance artwork blocks trunk, different-Net pin contact     |
| dev   | 25        | 9             | instance blocks branch                                       |
| val   | 31        | 5             | instance blocks branch                                       |
| val   | 20        | 3             | different-Net pin contact                                    |
| dev   | 24        | 5             | different-Net pin contact, instance blocks branch            |

R62's general rail Cell Pin clearance fix is retained. Remaining failures are artwork/branch obstruction and unintended different-Net contacts. The newly selected 24-instance dev placement has five floating pins instead of one; its routed score trades four pins for 18 fewer crossings and 15 fewer bends. No additional cause was addressed outside the amendment's scope.

### Six rendered pairs

Fresh human/automatic SVG and PNG pairs were rendered under `tmp/t017-r2-pairs/`, with private selection identifiers confined to its ignored `selection.json`. Metric cells are **T016 → round 1 → round 2**. Both largest documents and a switched-capacitor dev document are included.

| Pair | Instances | Split | Switches | Crossings       | Bends        | Floating pins | Artifact                       |
| ---- | --------- | ----- | -------- | --------------- | ------------ | ------------- | ------------------------------ |
| 1    | 103       | val   | 22       | 162 → 162 → 163 | 75 → 80 → 75 | 23 → 19 → 19  | `tmp/t017-r2-pairs/pair-1.png` |
| 2    | 94        | val   | 5        | 107 → 102 → 102 | 58 → 69 → 69 | 0 → 0 → 0     | `tmp/t017-r2-pairs/pair-2.png` |
| 3    | 37        | dev   | 12       | 45 → 55 → 55    | 31 → 21 → 21 | 0 → 0 → 0     | `tmp/t017-r2-pairs/pair-3.png` |
| 4    | 23        | dev   | 0        | 1 → 1 → 1       | 0 → 0 → 0    | 10 → 10 → 10  | `tmp/t017-r2-pairs/pair-4.png` |
| 5    | 15        | dev   | 0        | 3 → 3 → 3       | 9 → 9 → 9    | 0 → 0 → 0     | `tmp/t017-r2-pairs/pair-5.png` |
| 6    | 16        | dev   | 0        | 6 → 6 → 6       | 10 → 10 → 10 | 0 → 0 → 0     | `tmp/t017-r2-pairs/pair-6.png` |

Inspected all six PNGs. The two largest results retain wide spans and long global wires. The switched-capacitor result remains crossing-heavy. Pair 4 still has unrouted connections and crowded labels; the smaller feedback examples retain extra crossings and overlapping labels. These renderings document the current result, not a visual-quality improvement claim.

## Deviations and open questions

- Step 6 cannot currently satisfy both exact returned-edit deduplication and the existing all-refused replanning contract. Opus needs to amend the candidate-equivalence rule before acceptance can pass; no refusal exception or alternative design was invented.
- The main-metric and bend targets fail despite improvement over round 1. Step 8 found no tested general placement mechanism that removes the merged-stage regression, so its allowed no-change outcome was used.
- All acceptance commands ran; failing outputs and the local-service rerun are recorded above. No tests were weakened and no dependency versions, generated files, router behavior, R10, R23 or `lostNameClaim` were changed in round 2.
- No commits, pushes, merges, rebases, branch switches, plan/review edits or out-of-scope product edits were made. The plan/review working-tree changes present at entry were left alone.
