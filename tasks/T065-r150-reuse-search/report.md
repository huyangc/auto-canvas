# T065 report — round 2

## Summary

Fixed review finding 1: the R150 reuse candidate removes and reseats only owned
drafting groups. Unowned and locked ink remains at its input positions and in
the candidate's obstacles. If that fixed ink blocks the 60-unit device clearance,
retain the base instead of accepting the layout with R10 removed.

The finishing pass also recovers standalone caption anchors after rerouting,
without separating members of multi-object drafting groups. The original
caption test, including repeat layout, passes unchanged. A new test verifies
that an accepted candidate removes the R10 shift while unowned and locked notes
remain unchanged.

The final suite passes all 658 tests. Both speed targets and both split quality
gates pass, including the plan's accepted dev terminal-departure exception.
All six large-document plans are byte-identical to T064.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                              |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained round 1's searched-placement reuse, R10 provenance and geometry/routing fallback. Restricted candidate drafting removal and seating to owned groups; kept fixed ink's clearance and restored standalone caption anchors during finishing. |
| 2    | done   | Existing finished calibrated-score, wire, drafting-overlap, routed-guard and terminal-partition comparisons remain unchanged. Fixed ink that cannot be seated clear retains the base.                                                              |
| 3    | done   | Reran both timing commands and the full ≤10-part evaluation. Both timing targets and the quality gates pass with the accepted exception.                                                                                                           |
| 4    | done   | All existing R150, routing and caption tests pass unchanged. Retained searches-once tests and added an accepted-reuse regression for unowned and locked drafting. No timeout changes.                                                              |
| 5    | done   | Updated the R150 specification and recorded per-phase measurements below.                                                                                                                                                                          |

## Review findings addressed

- **Round 1, finding 1 (must-fix):** `planWithBranches` now leaves unowned
  objects in the stripped document and passes only owned groups to candidate
  seating. Locked components were already excluded by `draftingGroups` and
  remain fixed. The unchanged `follow-drafting-labels.test.ts` passes, including
  its original remote/locked object equality and repeat route-anchor assertions.
- **Round 1, finding 2 (note):** dev `VISUAL_TERMINAL_DEPARTURE` remains 67 → 68,
  as explicitly accepted in the updated plan. No other visual guard increases.

## Acceptance results

```text
pnpm build → 0; editor build completed (existing large-chunk warnings).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2028 files, 0 errors, 3294 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0;
  Test Files 44 passed (44)
  Tests 658 passed (658)
  Duration 59.15s; test timeouts unchanged.
node tmp/fixture-timing.mjs . held-out-cases.json → 0;
  deadtime 30 instances 18660 ms
  ltc3452 21 instances 15328 ms
node tmp/fixture-timing.mjs . corpus-cases.json → 0;
  two-inverters 9 instances 1629 ms
  common-source 9 instances 765 ms
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  Wrote tmp/auto-layout-eval/report.json and index.html.
node /tmp/t065-r2-compare.mjs → 0; dev and val pass with the approved exception.
node /tmp/t065-measure.mjs final --repeat → 0;
  all four fixture plans baseline-identical and deterministic; no full fallback.
node /tmp/t065-large.mjs → 0; all six complete serialized plans byte-identical.
node /tmp/t065-r2-changed.mjs → 0; all 91 changed plans verified and repeated.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 (repeat) → 0;
  all 628 plan hashes, statuses and diagnostics match the first pass.
node /tmp/t065-r2-compare.mjs (repeat report) → 0; dev and val pass.
git diff --check → 0.
```

The initial focused run reproduced the unchanged caption test failure at line
72 (`object` expected, `free` received). Restricting movement to owned drafting
fixed the first layout but exposed a repeat-layout route-anchor failure at line 95. Including standalone captions in finishing fixed that failure. The first
full suite then found the unchanged fixed-ink clearance assertion in
`routing.test.ts:688` (`-20` was not greater than `0`); retaining the base when
fixed ink blocks the candidate's clearance fixed it. The final focused run
passed 36/36 tests and the final full suite passed 658/658. No assertion was
removed or weakened.

## Investigation results

### Timing and phase costs

All timing commands and the profile/repeat run were sequential, with no build,
test, evaluation or other benchmark from this task running alongside them.

| Fixture       | T064 (s) | Round 2 (s) | Reduction | Gate                |
| ------------- | -------- | ----------- | --------- | ------------------- |
| deadtime      | 36.173   | 18.660      | 48.41%    | pass; ≥35%          |
| ltc3452       | 28.542   | 15.328      | 46.30%    | pass; ≥35%          |
| two-inverters | 1.547    | 1.629       | −5.30%    | measured; no target |
| common-source | 1.370    | 0.765       | 44.16%    | measured; no target |

Using the plan's rounded baselines, the required maxima are 23.530 s and
18.525 s. Timing-script zero exits are not used as substitutes for these gates.

Milliseconds below compare T064's isolated phase profile with round 2's
isolated profile. Phase columns overlap (finishing occurs inside searches and
R150), so they must not be summed.

| Fixture       | Version | Total   | Annealer | R147    | R146   | Rails  | R149  | R150 candidate | Finishing |
| ------------- | ------- | ------- | -------- | ------- | ------ | ------ | ----- | -------------- | --------- |
| two-inverters | T064    | 1545.9  | 385.6    | 2.5     | 473.7  | 1.2    | 47.6  | 0.0            | 348.6     |
| two-inverters | T065 r2 | 1634.6  | 407.0    | 2.8     | 505.0  | 1.2    | 51.5  | 0.0            | 367.5     |
| common-source | T064    | 1342.4  | 561.9    | 265.3   | 0.6    | 1.5    | 330.4 | 625.6          | 362.8     |
| common-source | T065 r2 | 781.2   | 320.4    | 151.5   | 0.3    | 0.7    | 182.4 | 18.6           | 201.0     |
| deadtime      | T064    | 35503.3 | 5335.8   | 10016.1 | 8446.1 | 3047.2 | 0.8   | 18385.9        | 13358.7   |
| deadtime      | T065 r2 | 18174.7 | 2841.4   | 4556.9  | 4492.7 | 1232.3 | 0.4   | 235.4          | 6014.1    |
| ltc3452       | T064    | 28603.2 | 5099.9   | 9399.3  | 3.2    | 2221.3 | 1.0   | 14192.0        | 8745.1    |
| ltc3452       | T065 r2 | 15259.3 | 2691.4   | 4944.0  | 1.7    | 1155.6 | 0.5   | 328.4          | 4679.5    |

All four fixtures call the annealer, R147, R146, rail and gap searches once.
No fixture uses a full-plan fallback. `two-inverters` keeps its existing zero
additional-candidate path. Each complete serialized plan matches the saved
T062/T064 fixture plan and an immediate repeat.

### Quality against T062

The evaluation contains 628 inputs: **627 completed**, one unchanged refusal,
**zero non-equivalent**, **10 floating pins**, and **18 missing connections**.
Dev completes 439 with floating 8 and missing 12; val completes 188 with
floating 2 and missing 6. Every count equals the T062 reference.

| Split | Metric              | T062       | Round 2    | Change  | Gate |
| ----- | ------------------- | ---------- | ---------- | ------- | ---- |
| dev   | crossings           | 279        | 279        | +0.000% | pass |
| dev   | bends               | 1914       | 1920       | +0.313% | pass |
| dev   | wire length         | 473601.351 | 474801.351 | +0.253% | pass |
| dev   | median area / human | 1.436100   | 1.442731   | +0.462% | pass |
| val   | crossings           | 127        | 127        | +0.000% | pass |
| val   | bends               | 726        | 732        | +0.826% | pass |
| val   | wire length         | 197834.234 | 198604.234 | +0.389% | pass |
| val   | median area / human | 1.395489   | 1.405670   | +0.730% | pass |

Every val `VISUAL_*` total is unchanged. On dev, label-clearance warnings
improve from 133 to 131; terminal departures are 67 → 68 (accepted exception);
all other visual totals are unchanged. The extra departure remains the reviewed
`57zs7ayept` searched-base outcome; no comparison guard was relaxed in code.

### Changed drawings and determinism

Against T064, **91 completed plans change** (57 dev, 34 val); 536 plan hashes
remain identical. Replaying those plans gives:

| Replayed-document change                                      | Drawings | Explanation                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance placements, usually with routes, drafting and labels | 47       | The candidate retains the searched base seats and removes its recorded R10 shift; fixed drafting can also cause the candidate to be rejected instead of selecting the old independent-search winner. |
| Drafting only                                                 | 18       | Unowned ink remains fixed on the additional-candidate path; owned drafting follows the reused seats.                                                                                                 |
| Annotations and drafting                                      | 7        | Fixed/owned drafting handling and caption finishing produce different ink and label edits.                                                                                                           |
| Annotations only                                              | 13       | Finishing the reused seats produces different label seats or edits.                                                                                                                                  |
| No replayed-document change                                   | 6        | The edit list differs but the final document is identical.                                                                                                                                           |

Thus **85 final documents change**. Relative to reviewed round 1, 39 plan hashes
change (23 dev, 16 val). Every one of the 91 changed T064 plans was replayed
against the verified temporary T064 build: old hashes match the saved reference,
and independently repeated current hashes match the round 2 evaluation.

Counters record 292 additional-candidate attempts: 291 reuse the searched base
without another annealer and one uses full fallback. The other 336 inputs take
no additional-candidate path. The fallback remains `yje2n6eva2`, the unchanged
refusal whose base cannot route its pin stub without crossing a foreign-Net pin;
there is no valid base result to reuse. No new fallback trigger or case-specific
code was introduced.

Both complete evaluations produce **identical plan hashes, statuses and
diagnostics for all 628 inputs**, including all 627 completed plans and the
unchanged refusal. Their quality scoreboards are identical; only measured
planning-duration aggregates differ. The repeat evaluation and changed-plan
replay overlapped each other and were not used as performance evidence.

### Large-document preservation

All six complete serialized plans are byte-identical to the T064 source build:

| Document   | Instances | Byte-identical |
| ---------- | --------- | -------------- |
| 38m8wdesbh | 50        | yes            |
| 4fb59zv76m | 50        | yes            |
| 8b2n3zf9vj | 51        | yes            |
| b9afqhsjzv | 103       | yes            |
| g47e465db5 | 70        | yes            |
| sm663cbs8b | 94        | yes            |

The comparison uses `/tmp/t065-base`; all 66 source files were checked against
`de5be0e` with no differences. No branch switch was used.

### Evidence

Final logs: `/tmp/t065-r2-{build,typecheck,lint,format}.log`,
`/tmp/t065-r2-suite-final.log`, `/tmp/t065-r2-focused.log`,
`/tmp/t065-r2-{held-out,corpus}-timing.log`, `/tmp/t065-r2-profile.jsonl`,
`/tmp/t065-r2-eval.log`, `/tmp/t065-r2-quality-comparison.json`, and
`/tmp/t065-r2-large.jsonl`, `/tmp/t065-r2-changed.json`, and
`/tmp/t065-r2-changed.jsonl`, `/tmp/t065-r2-eval-repeat.log`, and
`/tmp/t065-r2-determinism.json`. Evaluation output is
`tmp/auto-layout-eval/report.json`; the first round 2 pass is also saved at
`/tmp/t065-r2-first-report.json`.

## Deviations and open questions

No unresolved acceptance failures or must-fix findings remain.

- The existing direct-base title-following path remains unchanged. The new
  fixed-unowned-ink behavior applies when building the additional reuse
  candidate, as required by the review and the unchanged R150 tests.
- The accepted terminal-departure exception is the only quality allowance.
  There are no case-specific branches, relaxed comparison guards, or changes
  to R146/R147 algorithms.
- All edits are within the owned paths. Existing tests and timeouts, dependencies,
  lockfiles, `plan.md` and `review.md` were left unchanged. No LLM provider calls,
  commits, pushes, merges, rebases or branch switches were made.
