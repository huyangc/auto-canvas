# T060 report — round 2

## Summary

Addressed both round 1 must-fix findings. Drafting that overlapped its instance
owner in the input now keeps its preferred owner-relative offset, rounded to
integer coordinates. Seating and the candidate's drafting audit exempt only that
existing owner/object pair; other devices, labels, routes, dots and drafting
remain obstacles. The finished score, routing metrics, electrical equivalence and
visual guards still protect the original R10 fallback.

An already-settled electrical candidate may now win with no edits. Unchanged
drafting upserts are omitted, so repeating layout on the owned rectangle does
not discard that candidate and push its owner down through R10.

All acceptance commands and quantitative criteria pass. Dev and val median area
ratios improve; the suggested 1.35 ratio remains unreached. No LLM provider calls
were made.

## Steps

| Step                | Status | Notes                                                                                                                                                                                    |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — ownership       | done   | Retained geometric ink grouping and nearest-owner assignment; locked components remain fixed.                                                                                            |
| 2 — follow          | done   | Owned groups follow their owners; free groups move rigidly on the same side; rejected candidates retain R10. Existing owner overlap and repeat-layout behavior are now preserved.        |
| 3 — seat            | done   | Retained nearby-seat search and score/guard gates. Only input overlaps with the same instance owner are exempt from seating and candidate audit collisions.                              |
| 4 — tests           | done   | Split the R10 contract into owned and unowned cases, amended only the authorized corpus assertions, and retained collision seating coverage. All 640 tests pass with unchanged timeouts. |
| 5 — spec/evaluation | done   | R10/R150 documented, including the owner-overlap exception. Evaluated all 628 drawings, repeated determinism/timing/compatibility checks and reran vertical-margin attribution.          |

## Review findings addressed

1. **Must-fix #1 — R150 seating:** `follow-drafting-groups.ts` records individual
   drafting/instance pairs that overlap in the input. Those pairs are exempt in
   seating and the candidate-specific `auditRouting` call. The ordinary audit
   retains its original behavior. The owned rectangle test checks exact rounded
   owner displacement, overlap before and after, unchanged unblocked placement,
   and no edits on a second layout call.
2. **Must-fix #2 — replaced R10 assertions:** `routing.test.ts` now has an owned
   rectangle case and an unowned rectangle outside every owner's reach. The latter
   uses two initially separated resistors, retains unchanged drafting and all
   minimum-downward-grid clearance assertions, and proves repeat-layout stability.
   Only `rc-lowpass` and `rc-highpass` receive the amended corpus contract: every
   non-anchor field remains equal (content, style, z-order, lock and rotation),
   ink dimensions remain equal, and each moved object remains within reach of its
   input owner. Other corpus drafting equality assertions remain unchanged.

The synthetic collision test's note starts clear of its owner, then collides with
a device at its preferred post-placement position. Added assertions prove both
conditions; the existing final device-clearance assertion is unchanged. This
keeps that test about seating a newly introduced collision rather than removing
an input overlap that the amended plan explicitly preserves.

## Acceptance results

```text
pnpm build → 0; all package/app builds completed.
pnpm typecheck → 0.
pnpm lint → 0; 2021 files, 0 errors, 3272 warnings.
pnpm format:check → 0.
pnpm exec vitest run packages/auto-layout/test → 0;
  42 files passed; 640 tests passed; duration 122.15s; timeouts unchanged.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  all 628 inputs processed; 627 completed; no exceptions or non-equivalent results.
```

Final command logs and exit codes are in `tmp/t060-r2/{build,typecheck,lint,format,
vitest,eval}.log` and `acceptance.json`. A preliminary validation run was stopped
to fix the repeat-layout regression; the results above are the complete rerun.
The evaluator report and rendered pairs are in `tmp/auto-layout-eval/`.
The sole refusal remains `yje2n6eva2`, as in T059.

| Split / measure         | T059 baseline | T060 round 2 |
| ----------------------- | ------------: | -----------: |
| Dev median area / human |      1.557172 |     1.423394 |
| Val median area / human |      1.521283 |     1.365934 |
| All median area / human |      1.554821 |     1.406495 |
| Dev crossings           |           320 |          320 |
| Val crossings           |           151 |          151 |
| Dev bends               |          2005 |         2005 |
| Val bends               |           765 |          764 |
| Dev wire length         |    479571.351 |   479165.351 |
| Val wire length         |    199023.675 |   198873.675 |

Guards pass: 627 completed, zero non-equivalent, 10 floating pins and 18 missing
connections. `VISUAL_LABEL_CLEARANCE` decreases from 139 to 134 on dev and
47 to 45 on val; every other `VISUAL_*` total is unchanged on each split.
`AUTO_LAYOUT_DRAFTING_OVERLAP` warnings decrease from 38 to 19. The supplied
baseline JSON contains 38 warning entries rather than the context's 35; the
current total is below either count. No tuning was performed on val.

### Determinism, compatibility and timing

`node tmp/t060-r2/paired.mjs` exited 0: all 628 saved T059 hashes reproduce,
and all 628 repeated current hashes match this round's ordinary evaluation.
The saved T059 runtime from round 1 was reused without switching branches.
The run used 12 workers, warmed both planners, alternated baseline/current order
by case, and timed only default planning. No tests or other evaluation workload
ran concurrently.

| Timing measure                                      |                   Value |
| --------------------------------------------------- | ----------------------: |
| Median of per-case current/base ratios              |               1.103701× |
| p95 of per-case current/base ratios (informational) |               2.101926× |
| Baseline / current median time                      |  1854.566 / 2618.200 ms |
| Baseline / current p95 time                         | 9274.457 / 13313.985 ms |
| Current p95 / baseline p95                          |               1.435554× |

The median ratio is below 2× and aggregate p95 is below 1.5×. As the amended
plan specifies, per-case ratio p95 is reported but is not the acceptance gate.

`node tmp/t060-r2/large.mjs` exited 0: all six large documents (50, 50, 51,
103, 70 and 94 instances) produce byte-identical full plans.
`node tmp/t060-r2/modes.mjs` exited 0: all 12 optimized/partition/zero-budget
probes match baseline, with no errors or partition fallback.
`node tmp/t060-r2/drafting-integrity.mjs` exited 0: all 1,372 drafting
objects retain their content, style, dimensions, z-order and lock state;
758 have position/anchor changes. The corpus has no locked drafting;
the synthetic locked-note/box test supplies that coverage.

`python3 tmp/t060-r2/verify.py` exited 0; every acceptance check passes.
210 of 628 plans differ from T059. The complete comparison matrix,
paired rows, integrity results, compatibility hashes and command exit codes are
in `tmp/t060-r2/{verification,paired,drafting-integrity,large,modes,evidence}.json`.

## Investigation results

### Vertical margin attribution

Reran the T059/round 1 method on the human, actual baseline and repeated current
documents. For each side of the visible-instance envelope, overlapping
protrusion bands are shared equally among categories reaching them. Constant
SVG padding is 80 units per drawing; the renderer/rounding remainder is separate.
These values attribute vertical margin rather than total layout height or area.

| Dev: 439 completed drawings        |     Human |      T059 | T060 round 2 |
| ---------------------------------- | --------: | --------: | -----------: |
| Total vertical margin              | 47537.466 | 73269.008 |    60479.008 |
| Drafting                           |  2067.848 | 24087.001 |    10984.073 |
| Net/power labels                   |  3355.219 |  8028.981 |     8432.435 |
| Port labels                        |   903.107 |   645.407 |      675.595 |
| Device reference labels            |  1862.541 |   867.016 |     1006.763 |
| Device values                      |    19.055 |    60.115 |       60.115 |
| Routing                            |  2170.264 |  1950.065 |     2132.520 |
| Export padding                     | 35120.000 | 35120.000 |    35120.000 |
| Symbol/renderer/rounding remainder |  2039.432 |  2510.423 |     2067.508 |

Dev excess over human falls from 25,731.542 to 12,941.542 units.
Drafting's share of excess falls from 85.57% to 68.90%; its
attributed margin decreases by 13,102.928 units.

| Val: 188 completed drawings        |     Human |      T059 | T060 round 2 |
| ---------------------------------- | --------: | --------: | -----------: |
| Total vertical margin              | 19578.845 | 29231.087 |    23089.087 |
| Drafting                           |   317.449 |  8315.844 |     2121.411 |
| Net/power labels                   |  1331.558 |  3196.221 |     3434.423 |
| Port labels                        |   500.302 |   252.945 |      272.087 |
| Device reference labels            |   645.433 |   458.553 |      511.667 |
| Device values                      |    58.182 |     0.000 |        0.000 |
| Routing                            |   773.127 |   745.314 |      803.287 |
| Export padding                     | 15040.000 | 15040.000 |    15040.000 |
| Symbol/renderer/rounding remainder |   912.794 |  1118.436 |      906.211 |

Val excess over human falls from 9,652.242 to 3,510.242 units.
Drafting's share of excess falls from 82.87% to 51.39%; its
attributed margin decreases by 6,194.432 units.

All four attribution commands exited 0:
`node tmp/t060-r2/margins.mjs dev`, `node tmp/t060-r2/margins.mjs val`,
`node tmp/t060-r2/base-margins.mjs dev`, and
`node tmp/t060-r2/base-margins.mjs val`. Per-case evidence and totals are in
`tmp/t060-r2/{base-margins,margins}-{dev,val}.json`. Some label contributions
increase as shared protrusion bands are apportioned differently; visual guard
totals do not increase.

## Deviations and open questions

- No unresolved must-fix finding or failed acceptance criterion.
- The suggested 1.35 area ratio is not reached; both split medians are lower as
  required. The second complete planning pass still has a measurable cost,
  within the amended aggregate timing budget.
- No commits, pushes, branch switches, dependency/lockfile changes, LLM calls,
  or out-of-scope product changes. `plan.md` and `review.md` were not edited;
  their pre-existing working-tree state was preserved.
