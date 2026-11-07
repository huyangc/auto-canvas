# T016 report — round 3

## Summary

Implemented the revised R58: route the eligible strategies once, rank their real routed scores, then independently refine the top two with at most 14 candidates each. Reuse the initial routes, retain the higher-ranked strategy on a refined tie, and run R44 only on the winner. Above 40 instances the unrefined stages/layered comparison remains in place.

Fixed R59 generally by preserving vertical rail escapes for hosts and attached parts. The placement search tries horizontal alternatives inside the host span before widening it; it no longer stacks shunts across an earlier part's rail exit. Added hand-built supply/ground regressions and updated the real-pipeline top-two search-budget test. The unchanged `ltc3452` ceiling passes again at 19 crossings (limit 22).

All acceptance commands were run. The full suite passes with the required local database/socket access. This round is **partial** because human-case crossing targets remain unmet: dev 164 against 144 and val 133 against 131. Floating-pin, bend, completion, safety and timing targets pass. No router, Edit Engine, dependency, fixture, plan, or review edits were made in this round.

## Steps

| Step                  | Status  | Notes                                                                                                                                               |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Spec              | done    | R58 now specifies two refinements of 14 candidates; R59 documents clear rail escapes. R50–R57 remain implemented.                                   |
| 2 — Implementation    | done    | Ranked portfolio in `auto-layout.ts`; bounded initial-route reuse in `refine.ts`; attachment escape clearance in `stages.ts`.                       |
| 3 — Tests             | done    | All 116 auto-layout tests pass, including all corpus/held-out protections and two new shunt regressions. No existing test or ceiling was weakened.  |
| 4 — Evaluation/report | partial | Full 33-document evaluation, common-set comparison, timing, refusal, and eight current rendered pairs recorded below; unmet quality targets remain. |

## Review findings addressed

| Latest finding                                                | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Round 2 #1 — must-fix: unrefined rank loses `ltc3452` ceiling | Refine both top-ranked strategies independently, at most 14 candidates each, and select by refined routed cost with stable ties. The protected fixture returns to 19 crossings; all held-out ceilings pass. Timing is measured below without concurrent jobs.                                                                                                                                                                                                                                          |
| Round 2 #2 — must-fix: attached parts increase floating pins  | Identified every R1→R2 increase (anonymous table below), reproduced the dev regressions, and minimized the blocked-escape pattern to two attached shunts. Both supply and ground regression tests failed before the fix and pass after it. Preserve existing host/attachment rail exits and require a clear exit for each new part. The dev fixed-stage probes improve ordinals 15 from 4→3 and 33 from 6→1 floating pins. A remaining intrinsic host-pin conflict is reported, with no router change. |

## Acceptance results

```text
pnpm install --frozen-lockfile --offline → 0; already up to date, pnpm 11.16.0
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0; existing warnings remain, no errors
pnpm vitest run packages/auto-layout → 0; 116 passed
pnpm test:local → 1 in sandbox; 7307 passed, 57 failed, 149 skipped; local PostgreSQL/socket/launcher access denied (EPERM), 1 unhandled error
ICM_E2E_PORT=4173 AUTO_CANVAS_E2E_API_PORT=4311 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test pnpm test:local (unrestricted) → 0; 7397 passed, 116 skipped; 745 files passed, 2 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → 1; no output (expected grep no-match)
pnpm build → 0; existing Vite large-chunk advisory
pnpm auto-layout:review → 0; all 9 corpus and 7 held-out cases commit and meet their ceilings
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0; 32 completed, 1 refused, 0 throws; all completed equivalent and safe
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → 1; no output (expected grep no-match)
```

The unrestricted rerun distinguishes the sandbox failures from product regressions. The full suite passes without changing any unrelated test or source. Logs remain in ignored `tmp/t016-round3-logs/`. `results.json` records command exits and durations. The human-case evaluation ran alone; no concurrent test, build, rendering or benchmark job affected its timing.

## Investigation results

### Common-set quality and width

C/B/L/F means crossings / bends / wire length / floating pins. Each split uses exactly the documents completed in both `baseline.json` and this round. T015 is the fixed `tmp/t015-final-eval.json`; its rendered widths come from the pre-T016 runtime preserved in `tmp/t016-t015-width/`. Width is the rounded rendered viewBox width, including preserved drafting objects. R1/R2 are the preserved previous-round measurements.

| Split | Common | Baseline C/B/L/F       | T015 C/B/L/F           | R1 C/B/L/F             | R2 C/B/L/F             | R3 C/B/L/F             | Crossing ceiling |
| ----- | -----: | ---------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------- |
| dev   |     14 | 288 / 338 / 92330 / 62 | 224 / 291 / 69530 / 27 | 140 / 261 / 73720 / 24 | 157 / 251 / 70910 / 30 | 164 / 244 / 74270 / 17 | ≤ 144: miss      |
| val   |     10 | 262 / 256 / 96150 / 45 | 184 / 213 / 58740 / 14 | 139 / 197 / 57580 / 10 | 144 / 197 / 54260 / 14 | 133 / 193 / 50400 / 14 | ≤ 131: miss      |

| Split | T015 width sum / mean | R1 width sum / mean | R2 width sum / mean | R3 width sum / mean | R3 vs T015 | R3 vs R2 |
| ----- | --------------------: | ------------------: | ------------------: | ------------------: | ---------: | -------: |
| dev   |        14770 / 1055.0 |      18883 / 1348.8 |      16452 / 1175.1 |      16307 / 1164.8 |     +10.4% |    -0.9% |
| val   |        11281 / 1128.1 |      12281 / 1228.1 |      11196 / 1119.6 |      10485 / 1048.5 |      -7.1% |    -6.4% |

| Split | Completed / total | All completed T015 C/B/L/F | All completed R3 C/B/L/F |
| ----- | ----------------: | -------------------------- | ------------------------ |
| dev   |           17 / 18 | 340 / 387 / 98030 / 54     | 276 / 333 / 102320 / 44  |
| val   |           15 / 15 | 580 / 468 / 133020 / 48    | 482 / 437 / 132700 / 52  |

Completion: **32/33**; **0 throws**. Every completed document is electrically equivalent and has empty `unsafeProblems`. Maximum planning time: **11.44 s**; **0 exceed 12 s**.

dev: crossings 164 > 144 (miss); bends 244 ≤ 291 (pass); floating pins 17 ≤ 27 (pass).
val: crossings 133 > 131 (miss); bends 193 ≤ 213 (pass); floating pins 14 ≤ 14 (pass).

Against R2, dev crossings increase 157→164 while floating pins decrease 30→17; val crossings decrease 144→133 and floating pins stay at 14. Wire length increases 70910→74270 on dev and decreases 54260→50400 on val. This is not a crossing improvement on dev. These results were not tuned to validation or to any individual drawing. The remaining ceiling misses are retained as findings. Width/length differences include portfolio selection as well as R59 geometry.

### Strategy and metrics for every document

Anonymous ordinals use sorted evaluator order. Private ids, mappings, diagnostics and derived human-case artifacts remain only in ignored `tmp/`; no excerpt is tracked.

| Ordinal | Split | Instances | Winner   | T015 C/B/L/F          | R3 C/B/L/F            | R3 width | Planning ms | Status    |
| ------: | ----- | --------: | -------- | --------------------- | --------------------- | -------: | ----------: | --------- |
|      01 | dev   |        50 | layered  | 42 / 31 / 8590 / 12   | 42 / 31 / 8590 / 12   |      861 |      1737.4 | completed |
|      02 | val   |        40 | layered  | 26 / 30 / 7130 / 8    | 26 / 30 / 7130 / 8    |      884 |     10409.2 | completed |
|      03 | dev   |        19 | stages   | 16 / 28 / 5370 / 0    | 6 / 22 / 7650 / 3     |     1906 |      3497.1 | completed |
|      04 | dev   |        50 | layered  | 62 / 37 / 15420 / 6   | 62 / 37 / 15420 / 6   |     1483 |      1859.8 | completed |
|      05 | dev   |        16 | template | 6 / 10 / 2610 / 0     | 6 / 10 / 2610 / 0     |      677 |      1554.3 | completed |
|      06 | val   |        30 | stages   | 50 / 40 / 11020 / 0   | 10 / 24 / 6540 / 0    |     1938 |      4856.6 | completed |
|      07 | val   |        51 | layered  | 38 / 46 / 10590 / 0   | 38 / 46 / 10590 / 0   |     1442 |      1104.1 | completed |
|      08 | dev   |        37 | stages   | 73 / 42 / 11370 / 0   | 45 / 31 / 12340 / 0   |     1949 |      4732.2 | completed |
|      09 | val   |        35 | stages   | 50 / 37 / 9140 / 8    | 35 / 35 / 10340 / 8   |     1735 |     11025.7 | completed |
|      10 | val   |        19 | layered  | 12 / 11 / 4490 / 0    | 12 / 11 / 4490 / 0    |      894 |      1988.0 | completed |
|      11 | dev   |        15 | stages   | 6 / 10 / 2980 / 0     | 5 / 10 / 2360 / 0     |      669 |      1245.4 | completed |
|      12 | val   |       103 | layered  | 162 / 75 / 30470 / 23 | 162 / 75 / 30470 / 23 |     2837 |      6570.0 | completed |
|      13 | dev   |        24 | stages   | 17 / 18 / 5540 / 0    | 16 / 24 / 5820 / 0    |      887 |      1863.4 | completed |
|      14 | val   |        17 | template | 3 / 19 / 3360 / 0     | 3 / 19 / 3360 / 0     |     1263 |      1136.8 | completed |
|      15 | dev   |        20 | stages   | 3 / 20 / 2800 / 4     | 7 / 12 / 4340 / 3     |     1306 |      2096.9 | completed |
|      16 | dev   |        70 | layered  | —                     | —                     |        — |      2245.1 | refused   |
|      17 | val   |        20 | stages   | 20 / 22 / 7980 / 1    | 9 / 18 / 4120 / 1     |     1072 |      3425.6 | completed |
|      18 | dev   |        29 | layered  | 11 / 20 / 6030 / 0    | 11 / 20 / 6030 / 0    |     1048 |      5213.5 | completed |
|      19 | dev   |        22 | stages   | 13 / 20 / 4780 / 7    | 19 / 20 / 7370 / 0    |     1169 |      3363.3 | completed |
|      20 | dev   |        23 | layered  | 1 / 0 / 1320 / 10     | 1 / 0 / 1320 / 10     |      631 |       478.6 | completed |
|      21 | dev   |        24 | stages   | 14 / 33 / 6070 / 0    | 16 / 29 / 8530 / 0    |     2251 |      5336.2 | completed |
|      22 | val   |         7 | template | 0 / 3 / 1060 / 0      | 0 / 3 / 1060 / 0      |      684 |       255.6 | completed |
|      23 | val   |        34 | layered  | 25 / 26 / 6720 / 0    | 25 / 26 / 6720 / 0    |     1188 |      7629.3 | completed |
|      24 | val   |        27 | layered  | 14 / 27 / 6020 / 0    | 14 / 27 / 6020 / 0    |     1172 |      5895.1 | completed |
|      25 | dev   |        25 | stages   | 12 / 28 / 4490 / 9    | 8 / 21 / 4040 / 9     |     1440 |      5399.9 | completed |
|      26 | val   |        31 | layered  | 22 / 22 / 7090 / 5    | 22 / 22 / 7090 / 5    |      828 |     11439.9 | completed |
|      27 | val   |        20 | stages   | 11 / 23 / 4100 / 3    | 8 / 27 / 3770 / 7     |      926 |      2434.7 | completed |
|      28 | val   |        94 | stages   | 135 / 74 / 19980 / 0  | 106 / 61 / 27130 / 0  |     3306 |      3742.6 | completed |
|      29 | dev   |        19 | stages   | 9 / 14 / 3260 / 0     | 7 / 10 / 3790 / 0     |      743 |      1917.9 | completed |
|      30 | dev   |        22 | layered  | 7 / 22 / 3000 / 0     | 7 / 22 / 3000 / 0     |      999 |      1690.4 | completed |
|      31 | val   |        22 | layered  | 12 / 13 / 3870 / 0    | 12 / 13 / 3870 / 0    |      562 |      3528.4 | completed |
|      32 | dev   |        17 | stages   | 19 / 21 / 3640 / 5    | 11 / 16 / 3870 / 0    |      796 |      1357.8 | completed |
|      33 | dev   |        24 | stages   | 29 / 33 / 10760 / 1   | 7 / 18 / 5240 / 1     |     1276 |      4617.7 | completed |

Completed winners: template 3, layered 13, stages 16.

### Planning time against size

| Instances | Documents | Median ms | Maximum ms |
| --------- | --------: | --------: | ---------: |
| 1–20      |        11 |    1917.9 |     3497.1 |
| 21–40     |        16 |    5035.0 |    11439.9 |
| 41–80     |         4 |    1798.6 |     2245.1 |
| 81–120    |         2 |    5156.3 |     6570.0 |

### Floating-pin diagnosis

All R1→R2 increases are listed here, including documents outside the baseline common set. Dev ordinals 03, 15 and 33 were probed with the same unrefined stages strategy before and after the fix, separating attachment geometry from portfolio selection. Only dev documents were used to design and probe the change; validation results were measured without tuning to them.

| Ordinal | Split | R1 F | R2 F | R3 F | R1→R2 mechanism / remaining limitation                                                                                                                                                                                                                      |
| ------: | ----- | ---: | ---: | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|      02 | val   |    3 |    8 |    8 | Winner changed from stages to layered; the selected result had more floating pins.                                                                                                                                                                          |
|      03 | dev   |    0 |    3 |    3 | Attached rail endpoint changes the rail extent; a branch from a block output passes over a different output on that same host. A host-only synthetic probe also cannot route that rail, so this is not repaired by spacing attached bodies.                 |
|      12 | val   |   16 |   23 |   23 | Winner changed from stages to layered above 40 instances; the R1 stages result had fewer floating pins. R58 still requires unrefined selection at this size.                                                                                                |
|      15 | dev   |    3 |    4 |    3 | An attached rail part moves the rail extent past another part on its vertical path. Clear rail escapes recover the earlier floating count in the fixed-stage probe.                                                                                         |
|      27 | val   |    0 |    7 |    7 | A supply trunk intersects a supply marker; it is not an electrical-equivalence failure. Final result and winner are recorded above.                                                                                                                         |
|      33 | dev   |    4 |    6 |    1 | Attached rail parts congest marker/trunk paths; R2 diagnostics include a rail branch through a ground marker and a supply trunk touching a supply marker. Escape clearance and changed geometry reduce the fixed-stage probe from six floating pins to one. |

The minimized, hand-built two-shunt test fails for supply and ground before the fix because a rail exit encounters the other shunt. The fix tries deterministic x positions ordered by required stage growth, then proximity to the host, while clearing device ink and rail exits with the existing 20-unit margin. It preserves the original stage/group rules and does not inspect case identities. This fixes the reproducible attachment class; it cannot guarantee every rail trunk will clear every marker or intrinsic multi-pin host.

### Corpus and held-out changes

All 16 cases commit, preserve electrical equivalence, and pass the existing routing safety and crossing protections. Corpus floating pins remain zero. T015 values below come from the preserved pre-T016 review runtime.

| Section  | Case               | T015 C/B/L/F       | R3 C/B/L/F         | Winner   |
| -------- | ------------------ | ------------------ | ------------------ | -------- |
| corpus   | five-t-ota         | 0 / 1 / 1120 / 0   | 0 / 1 / 1120 / 0   | template |
| corpus   | fig-17-19b         | 0 / 0 / 1100 / 0   | 0 / 0 / 1100 / 0   | template |
| corpus   | two-inverters      | 1 / 2 / 1190 / 0   | 1 / 2 / 1190 / 0   | layered  |
| corpus   | differential-stage | 0 / 0 / 340 / 0    | 0 / 0 / 340 / 0    | layered  |
| corpus   | common-source      | 0 / 2 / 1000 / 0   | 0 / 2 / 1000 / 0   | template |
| corpus   | rc-lowpass         | 0 / 0 / 360 / 0    | 0 / 0 / 360 / 0    | template |
| corpus   | rc-highpass        | 0 / 0 / 360 / 0    | 0 / 0 / 200 / 0    | stages   |
| corpus   | rlc                | 0 / 0 / 480 / 0    | 0 / 0 / 480 / 0    | template |
| corpus   | two-stage-symbolic | 0 / 3 / 1060 / 0   | 0 / 3 / 1060 / 0   | template |
| held-out | fd-two-stage       | 8 / 11 / 3330 / 0  | 8 / 11 / 3330 / 0  | layered  |
| held-out | common-source-ac   | 0 / 2 / 1040 / 2   | 0 / 1 / 600 / 2    | stages   |
| held-out | skew               | 2 / 4 / 1740 / 0   | 2 / 4 / 1740 / 0   | layered  |
| held-out | deadtime           | 13 / 38 / 5180 / 6 | 13 / 38 / 5180 / 6 | layered  |
| held-out | ota-sky130         | 0 / 2 / 1310 / 3   | 0 / 2 / 1310 / 3   | layered  |
| held-out | widlar             | 3 / 11 / 1600 / 1  | 3 / 11 / 1600 / 1  | layered  |
| held-out | ltc3452            | 19 / 25 / 5980 / 0 | 19 / 25 / 5980 / 0 | layered  |

### Remaining refusals

Only ordinal 16 (70 instances, dev) refuses, as in T015 and both earlier rounds. Both large-document strategies refuse under R10, and layered is retained on the infinite-score tie. A frozen touching gate-to-block contact cannot obtain a clearance-checked stub past a transistor. Its diagnostic is unchanged. Fixing that protected contact/router behavior is outside scope; no safety check or diagnostic was relaxed.

### Eight rendered pairs inspected

Current local-only pairs: `tmp/t016-round3-visuals/pair-1.png` through `pair-8.png`. Full human/result SVG comparisons remain in ignored `tmp/auto-layout-eval/`.

| Pair | Instances | Winner   | What still looks wrong                                                                                                                                                     |
| ---: | --------: | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 |         7 | template | The output lead and compensation loop remain stretched relative to the human drawing.                                                                                      |
|    2 |        16 | template | Template still places the input on the far right/bottom. The vertical capacitor/feedback path is long, with crowded labels. R57 only normalizes stages.                    |
|    3 |        20 | stages   | The drafting box is detached above the circuit. Long reset/control paths cross the page and the far-right capacitor/control labels remain cramped.                         |
|    4 |        24 | stages   | Stages wins now, but the drawing still interleaves upper and lower branches, stretches input paths over the top, and uses long rectangular loops around the lower devices. |
|    5 |        31 | layered  | Layered loses the repeated branch rhythm. Preserved headings float above the circuit, devices crowd the upper middle, and vertical control connections dominate.           |
|    6 |        40 | layered  | Inputs remain on the right. Central crossings and the lower capacitor/control cluster are crowded, with labels touching nearby routes.                                     |
|    7 |        50 | layered  | Duplicate supply and bias markers remain detached at the edges. Interleaved devices and long routes obscure the human drawing’s symmetry.                                  |
|    8 |       103 | layered  | The result remains a very wide strip with tiny labels at fit-to-page scale, long parallel routes, and detached drafting text and markers.                                  |

## Deviations and open questions

- The human-case ceiling misses above remain unresolved; no case-specific fallback, validation tuning, changed cost weight, or relaxed acceptance test was introduced.
- R59 preserves vertical rail escapes within each host stage. Marker placement and the protected router can still produce a trunk/marker conflict or a branch over another pin on a multi-pin host. Those remaining mechanisms are reported rather than patched outside scope.
- R57 normalizes only stages and preserves group handedness; other strategies may still put an input on the right. Preserved drafting objects can dominate rendered width.
- R10, R23 and `lostNameClaim` remain unchanged. No dependency, generated source, fixture, app, or out-of-scope package edit was made.
- `plan.md` was already modified and `review.md` already untracked on entry. Both were read and left untouched. No commit, push, merge, rebase or branch switch was performed.
