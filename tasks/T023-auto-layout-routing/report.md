# T023 report — round 1

## Summary

Implemented opt-in Base Net clearance (R85), rail tree fallback and partial routing with component-level refusal reasons and missing-connection scoring (R86), and indexed crossing-aware paths (R87). Auto-layout opts in; the editor and Agent defaults remain unchanged. Added the evaluation metric, regression tests, rebuilt the named obstruction fixtures, and updated the spec.

All acceptance commands have their expected outcome, including the full local suite with PostgreSQL and loopback access. All drawing-quality targets pass. **The quick planning-time target does not pass in this run:** 339.458 s on the 32 common drawings versus 226.146 s in the supplied baseline (1.501×; limit 1.35× = 305.297 s). This remains for Opus’s paired remeasurement; implementation and investigation are complete.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Scoped pin/wire clearance and all auto-layout Net/stub calls to Base Nets. Propagated scope through the existing own-wire tap helper too. Added same-name Base Net and opposing fallback-stub tests. |
| 2 | done | Partial trunk/tree results retain unjoined endpoints and router reasons; incomplete rails try trees; candidates rank unjoined components first. Missing connections replace diagnostic count in the unchanged 10000-weight term. |
| 3 | done | Crossing cost remains exactly 20 grid steps. Foreign axis-aligned segments are bucketed by orientation/coordinate and searched by coordinate range; diagonal segments use strict-intersection checks. |
| 4 | done | Evaluation records human/result missing connections, totals, and console columns. No other evaluation behavior changed. |
| 5 | done | Rebuilt the shared routing/blocker fixtures with actual enclosures. Kept warning, safety, partition, named/unnamed labels, fixed placement, determinism, and undo assertions. The rejected repair has better connectivity but a measured expensive detour. Verified the quick hash result’s partition/safety and crossing ceiling before updating the hash. |
| 6 | done | Added R85–R87; amended R12, R14, R22, R39, R43, R74 and known limits. |
| 7 | done | Quick/search reports, ablations, regression counts, missing-connection investigation, timing evidence, and six rendered pairs are in ignored tmp/t023. Timing target miss is explicit below. |

## Review findings addressed

Round 1; no `review.md` was present.

## Acceptance results

All commands below ran with `ICM_E2E_PORT=4373`, `AUTO_CANVAS_E2E_API_PORT=4331`, and `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`. Logs are in `tmp/t023/round1/`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date; pnpm 11.16.0
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Markdown links resolve.
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit
pnpm lint → 0; 1948 files, 0 errors, 2778 warnings
pnpm vitest run packages/edit-engine → 0; 93 files passed; 952 passed, 4 skipped
pnpm vitest run packages/auto-layout → 0; 14 files passed; 190 tests passed
pnpm test:local → 0; 751 files passed, 2 skipped; 7476 tests passed, 116 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout|route-clearance|route-net-planner|wire-batch-planner|route-options' → 1; empty output (grep found no matches, as expected)
pnpm build → 0; all workspace builds passed; existing chunk-size advisory
pnpm auto-layout:review → 0; 9 corpus and 7 held-out SVG pairs generated
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t023/base-quick.json --jobs 10 → 0; 33/33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33/33 completed
git diff --stat origin/main -- packages/edit-engine/src/route-net-planner.test.ts packages/edit-engine/src/wire-batch-planner.test.ts packages/edit-engine/src/stretched-route-clearance.test.ts packages/edit-engine/src/stretched-route-clearance.ts → 0; empty
git status --short packages/model packages/derived packages/agent-adapter packages/project-protocol packages/spice apps fixtures docs/agent pnpm-lock.yaml package.json → 0; empty
git diff --stat origin/main -- packages/auto-layout/src/recognize.ts packages/auto-layout/src/types.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/template-placement.ts packages/auto-layout/src/layered.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/search.ts packages/auto-layout/src/search-moves.ts packages/auto-layout/src/stages.ts packages/auto-layout/test/recognize.test.ts → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1; empty output (expected no matches)
git diff --check → 0; empty
```

The initial sandboxed full suite failed with `connect EPERM ::1:5432`, `connect EPERM 127.0.0.1:5432`, and `listen EPERM 127.0.0.1`. Its full output is in `test-local.log`. A rerun with local-service access initially saw the new fixture while it was being corrected; the final run is clean (`test-local-final.log`). Earlier focused failures and fixes are retained in the logs. No test was skipped or removed to obtain the final pass.

## Investigation results

### Quick and search comparison

“Common” means the baseline’s 17 dev + 15 val completed drawings. “All” includes the formerly refused dev drawing. Baseline all-completed totals equal its common totals (32/33 complete). Readability is label overlaps / label clearance / terminal departures. All rows have zero unsafe problems and zero inequivalent results.

| Run | Population | Split | Completed | Crossings | Bends | Floating pins | Missing connections | Wire length | Readability |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline quick | common | dev | 17 | 263 | 307 | 23 | 21 | 98,560 | 0 / 28 / 10 |
| Baseline quick | common | val | 15 | 387 | 395 | 40 | 32 | 121,300 | 3 / 31 / 3 |
| T023 quick | common | dev | 17 | 235 | 350 | 0 | 0 | 103,180 | 0 / 26 / 9 |
| T023 quick | common | val | 15 | 354 | 407 | 1 | 1 | 160,740 | 0 / 24 / 5 |
| T023 quick | all | dev | 18 | 315 | 422 | 0 | 0 | 129,920 | 0 / 36 / 10 |
| T023 quick | all | val | 15 | 354 | 407 | 1 | 1 | 160,740 | 0 / 24 / 5 |
| Baseline search 120 | common | dev | 17 | 207 | 235 | 17 | not recorded | 96,110 | 0 / 16 / 8 |
| Baseline search 120 | common | val | 15 | 315 | 355 | 36 | not recorded | 121,070 | 5 / 34 / 4 |
| T023 search 120 | common | dev | 17 | 177 | 317 | 0 | 0 | 102,810 | 0 / 17 / 5 |
| T023 search 120 | common | val | 15 | 301 | 396 | 1 | 1 | 160,810 | 0 / 27 / 4 |
| T023 search 120 | all | dev | 18 | 249 | 387 | 0 | 0 | 133,290 | 0 / 21 / 5 |
| T023 search 120 | all | val | 15 | 301 | 396 | 1 | 1 | 160,810 | 0 / 27 / 4 |

Baseline quick missing connections were measured with a temporary bundle reading the five changed planner/scoring files from `a188149` via `git show`, without switching branches or changing tracked files. Its completion, crossings, bends, wire length, and floating-pin results match the supplied baseline document by document. The supplied search baseline lacks missing-connection measurements; these are not inferred from floating pins.

On the 32 common drawings, quick has **589 crossings, 757 bends, 1 floating pin, 1 missing connection, 263,920 wire units, and readability 0 / 50 / 14**. Every individual floating-pin count is at or below its baseline. All drawing-quality ceilings pass. Search has **478 crossings, 713 bends, 1 floating pin, 1 missing connection, 263,620 wire units, and readability 0 / 44 / 9**, versus baseline search’s 522 crossings, 590 bends, and 53 floating pins. Search does not exceed quick’s floating count. Median search evaluations were dev 501 / val 202 versus 666 / 370; deadline-limited search varies with machine load.

Reports were copied immediately after each evaluation to `tmp/t023/result-quick.json` and `tmp/t023/result-search120.json`. The earlier overlapping-load quick report is retained as `result-quick-loaded.json`.

### Ablations

The first two stages were built and evaluated before enabling the next stage. No production switches or environment-dependent routing behavior were added.

| Stage | Population | Split | Completed | Crossings | Bends | Floating | Wire length | Readability |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Base clearance | common | dev | 17 | 263 | 307 | 23 | 98,560 | 0 / 28 / 10 |
| Base clearance | common | val | 15 | 351 | 388 | 33 | 136,500 | 1 / 24 / 4 |
| Base clearance | all | dev | 18 | 329 | 369 | 32 | 121,530 | 1 / 40 / 11 |
| Base clearance | all | val | 15 | 351 | 388 | 33 | 136,500 | 1 / 24 / 4 |
| + partial / fallback / score | common | dev | 17 | 259 | 333 | 0 | 102,760 | 0 / 25 / 7 |
| + partial / fallback / score | common | val | 15 | 399 | 395 | 0 | 159,190 | 0 / 22 / 4 |
| + partial / fallback / score | all | dev | 18 | 344 | 404 | 0 | 128,970 | 0 / 35 / 8 |
| + partial / fallback / score | all | val | 15 | 399 | 395 | 0 | 159,190 | 0 / 22 / 4 |
| + crossing cost | common | dev | 17 | 235 | 350 | 0 | 103,180 | 0 / 26 / 9 |
| + crossing cost | common | val | 15 | 354 | 407 | 1 | 160,740 | 0 / 24 / 5 |
| + crossing cost | all | dev | 18 | 315 | 422 | 0 | 129,920 | 0 / 36 / 10 |
| + crossing cost | all | val | 15 | 354 | 407 | 1 | 160,740 | 0 / 24 / 5 |

Reports: `tmp/t023/step1-quick.json` and `step2-quick.json`. Step 1 alone fixes the refused drawing. Step 2 draws all missing pins in the common drawings but raises val crossings as the new wires are drawn. Step 3 reduces crossings while leaving one val connection missing. The prescribed crossing cost was not tuned.

### Every quick crossing increase (counts only)

| Split | Crossings before → after | Floating pins before → after |
| --- | ---: | ---: |
| val | 21 → 36 | 8 → 0 |
| dev | 6 → 8 | 3 → 0 |
| val | 27 → 34 | 7 → 0 |
| val | 9 → 10 | 1 → 0 |
| dev | 1 → 4 | 10 → 0 |
| dev | 7 → 9 | 1 → 0 |

All six crossing increases accompany removal of floating pins. These are reported rather than suppressing the additional connections.

### Missing connections on dev

There are **zero remaining missing connections on dev**, both on the 17 common drawings and all 18 completed drawings, in quick and search. Cause count is zero; no outstanding dev connection requires changing Net order or placement. Val retains one missing connection, reported separately and not used to tune a constant.

### Timing

| Population | Split | Baseline sum (s) | T023 sum (s) | Baseline slowest (s) | T023 slowest (s) |
| --- | --- | ---: | ---: | ---: | ---: |
| common | dev | 99.730 | 138.538 | 12.173 | 20.059 |
| common | val | 126.415 | 200.920 | 20.612 | 28.071 |
| all | dev | 99.730 | 147.633 | 12.173 | 20.059 |
| all | val | 126.415 | 200.920 | 20.612 | 28.071 |

The final `--jobs 10` quick run did not overlap this task’s tests or another evaluation. System one-/five-/fifteen-minute loads were **13.13 / 11.23 / 12.92** at start and **29.58 / 17.66 / 15.24** at finish (`quick-timing-load.log`); other machine activity was not controlled. The first quick run overlapped tests and summed 375.735 s on common drawings. Neither timing passes the supplied 305.297 s ceiling. Opus should rerun baseline and result back to back under comparable load.

A separate, temporary instrumented bundle counted candidate calls, produced route-plan edits, and time inside the indexed crossing counter. It ran one quick plan per common drawing serially, with unchanged routing constants; these are investigation measurements, not a substitute for the prescribed production `--jobs 10` timing.

| Stage | Split | Net candidates | Produced route-plan edits | Partial plans | Crossing-count calls | Crossing-count time (s) | Planning time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base clearance | dev | 8,638 | 10,896 | 0 | 0 | 0.000 | 73.486 |
| Base clearance | val | 7,650 | 11,085 | 0 | 0 | 0.000 | 90.276 |
| + partial / fallback / score | dev | 8,347 | 14,699 | 969 | 0 | 0.000 | 50.078 |
| + partial / fallback / score | val | 7,861 | 14,749 | 776 | 0 | 0.000 | 64.346 |
| + crossing cost | dev | 8,632 | 15,409 | 1,020 | 3,634,594 | 0.642 | 66.821 |
| + crossing cost | val | 7,861 | 14,905 | 777 | 3,942,617 | 0.552 | 96.720 |

The full profile spent **1.194 s counting crossings out of 163.541 s planning (0.73%)**. Compared with Base clearance alone, candidates increase from 16,288 to 16,493 (+1.3%), while successful candidate route plans produce 30,314 edits versus 21,981 (+37.9%). These edit counts include alternatives and repeated complete previews; they are not final Document edits. Newly drawn connections account for most of the wire increase: common wire length rises from 235,060 after step 1 to 261,950 after step 2, then 263,920 with crossing cost. Step 2 accounts for 93% of that staged increase.

Thus indexed crossing arithmetic and the number of extra candidates are small parts of the cost. The profile shows substantially more geometry produced and replayed as previously missing connections are drawn. Crossing-aware ordering also changes which detours must undergo the existing clearance checks; their cost and preview/replay cost were not individually timed, so the remaining wall-time difference is not assigned a precise percentage. Serial staged planning sums were 163.762 s / 114.424 s / 163.541 s; their non-monotonic timing also illustrates why the loaded acceptance measurement needs a paired rerun.

The same instrumented replays measured common missing-connection totals of **21 dev / 27 val** after step 1, **0 / 0** after step 2, and **0 / 1** with all changes. Raw counters are in `tmp/t023/profile-counts-sequential.json`; no instrumentation is in tracked source.

### Rendered pairs

Six baseline-quick / result-quick comparisons are in `tmp/t023/pairs/index.html`, with individual HTML and PNG files. They include the formerly refused drawing (baseline side explicitly shows its original because no baseline plan committed), two drawings losing floating pins, a drawing whose crossings increase, and additional crossing reductions. All six PNGs were inspected. Baseline SVGs were regenerated from `a188149` and matched to the supplied baseline metrics; current SVGs came from the quick evaluation.

## Deviations and open questions

- **Open acceptance item: timing.** Drawing quality, safety, equivalence, deterministic corpus behavior, and every acceptance command pass, but the measured quick time exceeds the hard ratio. No constant or rule was relaxed.
- Scope also had to propagate through `tapOwnWire` inside the owned wire-batch planner; otherwise its own-Net lookup would interpret Base IDs as Logical IDs. Defaults remain unchanged.
- The old three-label expectation now becomes two labels for two disconnected components: the reachable rail members are physically joined, while the enclosed pin remains separate. The warning, good Net, partition, label bindings, unnamed case, and one undo remain asserted.
- The shared blocker fixtures use locked custom groups for stationary enclosure walls, preserving tests that explicitly fix only the original device IDs. The final prefix-ID regression remains unchanged and passes.
- The default Playwright Chromium download was absent. No dependency or browser was installed; the six optional PNG renderings used the installed Chrome with a temporary profile and approved local process access.
- Human drawings, excerpts, identifiers, and identifier-keyed measurements remain only in ignored `tmp/`. This report contains counts only.
- No commits, branch switches, dependency changes, lockfile changes, protected-code edits, or T022-owned-file edits.
