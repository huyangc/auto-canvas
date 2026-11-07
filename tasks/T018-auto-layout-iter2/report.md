# T018 report — round 1

## Summary

Main metric **755 → 716 crossings (5.17% improvement)**, with 32 completed documents, 739 bends, 75 floating pins and a quiet-run maximum of 11.304 s. Held-out acceptance remains unsatisfied: `ltc3452` has 23 crossings against a ceiling of 22.

Implemented R65 bounded deterministic row search in the layered strategy and inside each stage. Adjacent swaps carry entire row nodes; horizontal mirrors exclude recognized group members and tails. Every candidate reuses R33 column assignment, preserves fixed assigned placements and accepts only a strict R54 score improvement. The size-scaled estimator-call budget applies above 40 instances. Identical row-search inputs are cached only for the current `planAutoLayout` call, and each caller receives an independent copy; refinement replays therefore avoid repeating the same search. The cache changes no search budget or candidate order.

The R64 prototype failed the required fidelity gate and was discarded: pooled Spearman correlation fell from **0.4424 to 0.3543** on the same 360 valid dev candidates. R54 and the router remain unchanged. This round is **partial**, with a known held-out quality regression; see acceptance and final metrics below. No thresholds were weakened.

## Steps

| Step | Status                   | Notes                                                                                                                                                          |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done                     | Captured all actual portfolio/refinement runs on dev, plus the R44 replay; measured 371 runs, 360 valid pairs, per-document and pooled ranks.                  |
| 2    | done (discarded by gate) | Prototyped signal median trunks, rail trunks, Cell Pin geometry and marker stubs. Correlation did not improve; retained no R64 production change.              |
| 3    | partial                  | R65 implemented in `layered.ts`, wired through `place.ts` and `stages.ts`; existing-estimator fidelity still limits routed quality.                            |
| 4    | partial                  | Hand-built tests cover crossing removal, fixed placements, whole moving groups, grid, determinism and unchanged inputs. No test for discarded R64 is retained. |
| 5    | done                     | Final evaluation, isolated effects, timings and six renderings recorded below. Held-out acceptance remains unsatisfied.                                        |

## Review findings addressed

Round 1; no `review.md` was present at entry. Branch was `task/T018-auto-layout-iter2` and the working tree was clean.

## Acceptance results

All commands ran from the repository root, using lane 1 environment values. Final-code logs are under `tmp/t018/logs/final/`; the initial sandbox-only run is under `tmp/t018/logs/`.

```text
pnpm install --frozen-lockfile --offline → exit 0; frozen offline install complete
pnpm format:check → exit 0; All matched files use Prettier code style!
pnpm docs:check → exit 0; Markdown links valid
pnpm typecheck → exit 0
pnpm lint → exit 0
pnpm vitest run packages/auto-layout → exit 1; 130 passed, 1 failed; 9 files passed, 1 failed
pnpm test:local → exit 1; 7,411 passed, 1 failed, 116 skipped; 745 files passed, 1 failed, 2 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → exit 1; no output (grep no-match)
pnpm build → exit 0; all package/app builds complete
pnpm auto-layout:review → exit 1; all 16 initial transactions commit, but ltc3452 has 23 crossings > ceiling 22
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → exit 0; 32 completed; electrical equivalence, safety and R14 coverage pass
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → exit 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → exit 1; no output (grep no-match)
```

The single final product failure is `held-out.test.ts:79`: **expected 23 to be less than or equal to 22** for `ltc3452`. The review script independently detects the same regression. The three new hand-built tests pass, including a group that actually translates as a unit while a fixed device stays put, and isolation of cached results from caller translations. Existing corpus replan tests also pass. No test was weakened, deleted or skipped.

The first sandbox-only full run had 58 failures (7,320 passed, 149 skipped), including local PostgreSQL/listener/process restrictions. Re-running with local-service access removed those environment failures: the pre-cache rerun had 7,410 passes and only the same held-out failure. The final-code local-service rerun above adds the cache test and again has only that failure.

## Investigation results

### Estimator fidelity (dev only)

The probe observes `planLayoutOnce` for each actual candidate, preserving placement maps and auditing the completed run. The existing portfolio omits template above 40 instances; this was preserved. The sample also includes each R44 no-signal-trunk replay. Eleven refused runs are recorded but excluded from rank correlation, since they have no valid routed outcome. All 18 dev documents were visited, including the 70-instance document with no valid candidates. No val document was used to fit or select estimator/search behavior.

The old estimator was measured with device pins only, as production R54 is called. The prototype was measured on precisely the same placement maps, with marker pins and rails included. Tied observations receive average ranks; constant or empty samples have undefined correlation. Pooled ranking is over individual candidates, without per-document normalization. Duplicate candidate layouts remain in the sample because they were actually routed.

| Dev document size | Valid candidates | R54 Spearman | R64 prototype Spearman |
| ----------------: | ---------------: | -----------: | ---------------------: |
|                50 |                3 |    undefined |              undefined |
|                19 |               32 |       0.7184 |                 0.7304 |
|                50 |                3 |       1.0000 |                 1.0000 |
|                16 |               28 |       0.3285 |                 0.6429 |
|                37 |               15 |       0.9093 |                 0.8554 |
|                15 |               24 |       0.7776 |                 0.1245 |
|                24 |               12 |      -0.6896 |                -0.4128 |
|                20 |               24 |       0.3187 |                 0.7838 |
|                70 |                0 |    undefined |              undefined |
|                29 |               30 |       0.8215 |                 0.8563 |
|                22 |               30 |      -0.1765 |                 0.6996 |
|                23 |                6 |    undefined |                 0.8216 |
|                24 |               32 |       0.5136 |                -0.3376 |
|                25 |               32 |       0.4299 |                 0.8272 |
|                19 |               22 |       0.4106 |                 0.8374 |
|                22 |               25 |       0.7803 |                 0.6074 |
|                17 |               13 |       0.8388 |                 0.8425 |
|                24 |               29 |       0.5978 |                -0.5265 |

Pooled: **0.4424 → 0.3543**. Across the 360 valid observations, routed crossings total **5,965**; original R54 predicts **1,137**, and the prototype predicts **1,776**. Improved count magnitude did not improve ordering, so the prototype was discarded as required. Source and measured observations remain only under ignored `tmp/t018/`.

The prototype used R39's tree and horizontal/vertical median-trunk alternatives, scoring against already estimated Nets; it included R38/R43 outer rail levels, Cell Pin levels, and marker-host stubs. It reused the existing `powerHosts`/`assignPowerHosts` helpers and `placeMarkers` for missing marker placements. No shared trunk-choice helper exists outside the router, and the router was not edited. It still approximated clearance detours, tree taps, routing priority and bend costs, and did not exactly reproduce outside-row rail splitting or the source-driven supply special case. Fidelity conclusions apply to this prototype. These limitations are material: an idealized tree/trunk choice can look good while the actual clear path crosses other wires.

### Systematic misses

Crossing locations in routed geometry were classified by the Nets involved, with priority rail, then marker-bearing Net, then other signal. This identifies omitted network geometry, not exact causal attribution to an individual trunk or stub. Counts sum over candidates, rather than independent documents:

| Geometry implicated                          | Crossings | Implication                                                                             |
| -------------------------------------------- | --------: | --------------------------------------------------------------------------------------- |
| At least one rail Net                        |       942 | Original R54 skips these entirely.                                                      |
| Non-rail Net containing a Cell Pin or marker |     2,273 | Device-only estimates omit external pins and their long joins.                          |
| Other signal Nets                            |     2,750 | Tree/trunk topology, branch direction and clearance detours still differ substantially. |

Large misses include a 37-instance dev document (922 actual crossings summed over 15 candidates versus 461 estimated), a 29-instance document (575 versus 107), and a 24-instance document (617 versus 56). Another 22-instance document has a **negative** original within-document correlation (−0.1765): its 30 candidates total 525 actual crossings versus 28 estimated. This is evidence that the estimator can direct the search in the wrong direction, not just systematically undercount by a constant factor.

Two diagnostic variants were also tried, on dev only. Adding rails and markers without median-trunk selection raised pooled correlation to 0.5061, but did not satisfy the requested R39 mechanism and was not promoted. Matching signal routing priority in the complete prototype yielded 0.3314. Neither replaces the failed full R64 gate. No third-party example was converted into a tracked fixture.

### Main metric against T017

Each cell below is **T017 → T018**, over all completed human documents.

| Split | Completed | Crossings |     Bends | Floating pins |
| ----- | --------: | --------: | --------: | ------------: |
| dev   |   17 → 17 | 268 → 279 | 336 → 327 |       38 → 38 |
| val   |   15 → 15 | 487 → 437 | 430 → 412 |       44 → 37 |
| all   |   32 → 32 | 755 → 716 | 766 → 739 |       82 → 75 |

Main metric: **755 → 716**, **−5.17% change / 5.17% improvement**. Dev worsens **4.10%** (268 → 279), while val improves **10.27%** (487 → 437). This is explicitly a val-driven aggregate improvement; no val document was used for tuning. The two-consecutive-rounds-under-5% stop condition is **not** reached by this round.

Crossings, completion, bends and floating-pin round targets pass. All 32 completed transactions preserve electrical equivalence, satisfy routing safety and report every floating pin under R14. These are drawing/topology checks; no electrical models or simulation behavior changed.

### Effect of each step alone

| Dev experiment                 | Completed | Crossings | Bends | Floating pins |
| ------------------------------ | --------: | --------: | ----: | ------------: |
| T017 baseline                  |        17 |       268 |   336 |            38 |
| R64 prototype only (discarded) |        17 |       276 |   349 |            34 |
| R65 only, retained             |        17 |       279 |   327 |            38 |

The isolated R64 experiment used a throwaway package copy, disabled R65 by restoring the R33 call sites, and passed the full document to the prototype estimator for marker geometry. It worsens dev crossings by 2.99% and bends by 3.87%. Its val effect was not measured because it failed the dev fidelity gate. The discarded step contributes zero to the retained result. R65 alone therefore accounts for the retained all-split **755 → 716** result.

The first R65 budget trial (`min(240, max(16, 4*N))`) produced 297 dev crossings, 337 bends and 38 floating pins. The retained `min(160, max(16, 2*N))` budget produced 279/327/38. A mirror-first visiting order and a lexicographic crossing/length trial did not remove the held-out failure; neither was retained. None of these trials used val human documents for tuning.

The planning-local cache changes no candidate order, budget, score, strategy, or edit geometry. Cache-before and cache-after metrics match, and the automatic-result SVGs compare byte-for-byte for all 33 documents (including the refused drawing). Initial uncached timings overlapped other work for part of that run, so they are not presented as a controlled speedup measurement. Final timings below are from a quiet sequential evaluator.

### Corpus and held-out

| Set      | Completed | Crossings |   Bends | Floating pins |
| -------- | --------: | --------: | ------: | ------------: |
| corpus   |     9 → 9 |     1 → 1 |   8 → 8 |         0 → 0 |
| held-out |     7 → 7 |   45 → 51 | 92 → 88 |         9 → 9 |

Corpus targets and replan contracts pass. Held-out acceptance **fails**: `ltc3452` rises from 19 to 23 crossings, exceeding its unchanged ceiling of 22. The other held-out ceilings hold. The main-metric improvement does not override this failure.

### Planning time against size

All 33 documents, including the refused 70-instance document; seconds spent inside `planAutoLayout`, without concurrent tests, builds or probes:

| Instances | Documents | Minimum s | Median s | Maximum s |
| --------- | --------: | --------: | -------: | --------: |
| 1–20      |        11 |     0.269 |    1.521 |     3.295 |
| 21–40     |        16 |     0.535 |    4.804 |    11.304 |
| 41–60     |         3 |     1.314 |    1.901 |     2.678 |
| 61–80     |         1 |     5.136 |    5.136 |     5.136 |
| 81–120    |         2 |     5.293 |    7.678 |    10.064 |

Slowest: **11.304 s**, 40 instances; the ≤12 s target **passes**.

### Six rendered pairs

Fresh human/automatic SVG and PNG pairs are under ignored `tmp/t018/pairs/`. Private selection identifiers stay only in its ignored `selection.json`. Both largest documents are included. Values are **T017 → T018**.

| Pair | Instances | Split | Crossings |   Bends | Floating pins | Artifact                    |
| ---- | --------: | ----- | --------: | ------: | ------------: | --------------------------- |
| 1    |       103 | val   | 163 → 142 | 75 → 71 |       19 → 12 | `tmp/t018/pairs/pair-1.png` |
| 2    |        94 | val   |  107 → 91 | 58 → 55 |         0 → 0 | `tmp/t018/pairs/pair-2.png` |
| 3    |        37 | dev   |   45 → 45 | 31 → 31 |         0 → 0 | `tmp/t018/pairs/pair-3.png` |
| 4    |        23 | dev   |     1 → 1 |   0 → 0 |       10 → 10 | `tmp/t018/pairs/pair-4.png` |
| 5    |        15 | dev   |     3 → 2 |   9 → 7 |         0 → 0 | `tmp/t018/pairs/pair-5.png` |
| 6    |        16 | dev   |     6 → 6 | 10 → 10 |         0 → 0 | `tmp/t018/pairs/pair-6.png` |

Inspected all six PNG pairs. Both largest automatic drawings still have wide spans, long global wires and scattered labels despite their lower crossing counts. The 37-instance switched-capacitor drawing remains crossing-heavy and stretches a compact human topology horizontally. Pair 4 still exposes missing physical branches and crowded labels (ten floating pins, all reported); pair 5 has fewer crossings than T017 but still crowded feedback wiring; pair 6 retains the template strategy's crossing-heavy arrangement. These artifacts do not establish human-level drafting quality.

## Deviations and open questions

- R64 was discarded under its explicit correlation gate. R65 therefore uses unchanged R54; this is recorded explicitly instead of claiming the router-shaped objective was delivered.
- The new R65 behavior is left reviewable even though the held-out ceiling currently fails. Improving the estimator's missing clearance/tree-tap geometry, or adding another routed portfolio candidate, needs a follow-up plan; the router and existing portfolio/refinement budgets were not redesigned here.
- Existing tests and thresholds remain intact. No dependencies, lockfile, router, Edit Engine, R10, R23 or `lostNameClaim` behavior were changed. No commits, pushes, merges, rebases, branch switches, or plan/review edits were made.
