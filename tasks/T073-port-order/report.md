# T073 report — round 2

## Summary

Implemented the review's revised seat and draft policy: restored main's R19/R71
seeds, added a guarded conventional R146 candidate, replaced lexicographic
convention preference with calibrated scoring, and compared original and
corrected template/layered drafts through the existing draft router.

**Partial: not ready for acceptance.** All 628 layouts now complete, including
`yje2n6eva2`, with no non-equivalent results. The unchanged corpus crossing tests
pass. Floating pins, missing connections and every visual diagnostic total are
at or below main. However, portOrder improves only 1.55% on dev and 3% on val;
readability composite and crossings regress on both splits. No metric, weight,
test limit or search budget was changed.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                 |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Template/layered drafts compare both directions with the existing routed draft scorer; corrected wins ties. R153's layered row comparison includes the direction comparison. Only the winning draft enters normal refinement/finishing.                                                               |
| 2    | done    | Restored original initial seats. Added one horizontal conventional candidate beyond the outermost host on the directed side, inside the existing two-seat shortlist and evaluation budget. R74 remains positional at weight 300. R146 selects by finished calibrated score and rejects blocked joins. |
| 3    | done    | 44 focused/corpus tests pass, including both strategies, corrected ties, preservation of rigid groups, fixed ports, rotated hosts, reproducible candidates, determinism, and equal-geometry output preference. Corpus assertions and crossing limits remain unchanged.                                |
| 4    | partial | All 628 evaluated. Required quality gates fail. Rendered review, determinism, large-document identity and runtime evidence are recorded below.                                                                                                                                                        |

## Review findings addressed

1. **Initial seats — fixed.** R19 nearest-edge and R71 transformed pin-exit
   seating are restored to main. The conventional candidate is appended after
   existing candidates so tied estimates preserve existing seats. Candidate
   generation depends on host geometry, not the incumbent port position; this
   lets the unchanged corpus candidate check reproduce the chosen seat. The
   same geometry/contact and straight-join filters apply.
2. **R146 ranking — fixed.** Removed separate crossing/convention/score ranking.
   The cheap shortlist uses one scalar crossing/wire estimate with the existing
   R74 penalty scaled into that same score. Finished selection uses only strict
   calibrated-score improvement, incumbent ties, compaction checks and routed
   guards. Blocked candidates are not routed; finished trials cannot block the
   selected port's joins or increase the total blocked joins across all markers.
   The two-seat and total evaluation caps are unchanged.
3. **R57 comparison — fixed.** The original and corrected drafts share the
   normal draft router. Placement failures score infinity, identical drafts
   avoid redundant routing, and corrected wins ties. Results are memoized within
   the existing planning session. Rigid stages and fixed-device exclusions are
   unchanged; no complete strategy plan was added.
4. **Refusal and corpus limits — fixed.** Both original failures were reproduced
   before changes: `five-t-ota` and `fig-17-19b` each had one crossing against a
   limit of zero. Restoring only the seed policy made both pass. The final full
   corpus file passes unchanged. `yje2n6eva2` now has no error diagnostics and a
   successful edit preview; it also completes in the full evaluation.
5. **Runtime — fixed.** Five alternating pairs put `ota-sky130` at a median
   paired ratio of **1.06456× (+6.46%)**, below both the review’s +20% limit and
   the preferred +10%. Phase timings and the remaining held-out checks are below.

## Acceptance results

```text
pnpm build → 0; full final-source build; existing Vite chunk-size warning.
pnpm typecheck → 0.
pnpm lint → 0; 2048 files, 0 errors, 3398 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 0; 791 passed / 3 skipped files;
  8093 passed / 117 existing skipped tests; no timeout failures.
pnpm test:slow → 0; 1 file, all 7 tests passed; no timeout failures.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  439 dev + 189 val completed; zero refusals; zero non-equivalent layouts.
```

Slow-suite log: `/tmp/t073-r2-test-slow.log`.
Final local-suite log: `/tmp/t073-r2-test-local-isolated.log`.
Final build/static logs: `/tmp/t073-r2-{build,typecheck,lint,format}-final.log`.
Focused checks: `/tmp/t073-r2-final-focused.log` (44 tests), and
`/tmp/t073-r2-refusal.log`. Evaluation log: `/tmp/t073-r2-eval-final.log`.

The initial sandboxed suite hit PostgreSQL/loopback `EPERM`. A permitted local
network rerun passed all auto-layout tests, but its server component-client test
hit the unchanged five-second timeout while other checks were running. The
isolated rerun passed without the evaluation competing for resources. No timeout
limit was increased and no test was newly skipped or removed. The initial sandboxed suite also
started before the final candidate-generation fix; its intermediate failures
are not the final-source result.

### Corpus comparison

Baseline: `tmp/main-865924b-report.json`. Final artifacts:
[full evaluation](../../tmp/t073-r2/result.json) and
[comparison](../../tmp/t073-r2/comparison.json).

| Metric                    | Dev main → T073                | Val main → T073              |
| ------------------------- | ------------------------------ | ---------------------------- |
| Completed                 | 439 → 439                      | 189 → 189                    |
| portOrder                 | 193 → 190 (−1.55%)             | 100 → 97 (−3.00%)            |
| Readability composite sum | 100.02685 → 101.13782 (+1.11%) | 49.92095 → 50.25044 (+0.66%) |
| Crossings                 | 273 → 280 (+2.56%)             | 157 → 163 (+3.82%)           |
| Bends                     | 1778 → 1773 (−0.28%)           | 737 → 731 (−0.81%)           |
| Blocked joins             | 4 → 5                          | 2 → 2                        |
| Rail crossings            | 60 → 64                        | 36 → 37                      |
| Floating pins             | 6 → 6                          | 0 → 0                        |
| Missing connections       | 11 → 11                        | 5 → 5                        |
| Non-equivalent layouts    | 0 → 0                          | 0 → 0                        |

Other weighted metrics above +2% on dev: avoidableJogs 21 → 22 and
controlSeparation 36 → 38. Crossings, blockedJoins and railCrossings also fail
as shown above. On val, crossings and railCrossings exceed +2%. Every `VISUAL_*`
total is at or below main on both splits. There are 111 changed plan hashes.

The final result removes the round 1 refusal and most of its geometry
regressions, but does not meet the prescribed quality outcome. The blocked-join
guard in R146 protects its incumbent; it does not constrain changes introduced
by other planning stages relative to main.

### Rendered review and determinism

[Human | main 865924b | T073 comparison page](../../tmp/t073-r2/review.html)
contains the 25 fixed samples and ten largest portOrder reductions (35 unique
drawings). All 35 main hashes match the baseline, all 35 T073 hashes match the
final evaluation, and all 35 repeated T073 plans are byte-identical.
[Verification evidence](../../tmp/t073-r2/review-verification.json).

Visually inspected all nine screenshot sheets, `tmp/t073-r2/review-1.png`
through `review-9.png`. The page has no horizontal overflow at 1800 px. The
fixed sample `c84038b6-33e4-41ac-b79d-1daeaf463770` again matches main's direct
outer input seats, without round 1's extra crossing. `bqdpf9829a` now places
the output on the right without adding crossings or bends; `kr2aqwe5cc` and
`sf6e58mmjb` also improve the port seats without worsening either measure.
In contrast, `5etmybq44s` brings the inputs toward the left but adds a crossing,
and `aqfb9kjcfj` reverses the draft while adding a crossing and a bend. These
views confirm mixed local improvements, not a corpus-wide readability win.
Review scripts both exit 0; logs `/tmp/t073-r2-review.log` and
`/tmp/t073-r2-screenshots.log`.

| Top reduction drawing                  | portOrder main → T073 | Crossings main → T073 | Bends main → T073 |
| -------------------------------------- | --------------------- | --------------------- | ----------------- |
| `5etmybq44s`                           | 5 → 1                 | 2 → 3                 | 9 → 7             |
| `9ggfasx38f`                           | 4 → 2                 | 2 → 2                 | 4 → 5             |
| `aqfb9kjcfj`                           | 4 → 2                 | 0 → 1                 | 1 → 2             |
| `4dv8cc97xc`                           | 4 → 3                 | 2 → 2                 | 3 → 4             |
| `63213272-9ba5-442d-88c8-11e4abd514a7` | 1 → 0                 | 0 → 1                 | 7 → 8             |
| `bqdpf9829a`                           | 1 → 0                 | 0 → 0                 | 4 → 4             |
| `hdag4x8jrw`                           | 4 → 3                 | 0 → 1                 | 2 → 2             |
| `kr2aqwe5cc`                           | 1 → 0                 | 0 → 0                 | 0 → 0             |
| `nqmdjx54je`                           | 4 → 3                 | 0 → 1                 | 2 → 2             |
| `sf6e58mmjb`                           | 2 → 1                 | 0 → 0                 | 5 → 5             |

### Held-out runtime and large documents

All seven held-out and six large drawings produced byte-identical repeated
T073 plans (13/13), with no error diagnostics. All six large complete plans
are byte-identical to main: `38m8wdesbh` (50 instances), `4fb59zv76m` (50),
`8b2n3zf9vj` (51), `b9afqhsjzv` (103), `g47e465db5` (70), and `sm663cbs8b` (94).
Evidence: [verification.json](../../tmp/t073-r2/verification.json), generated by
`node tmp/t073-r2/verify.mjs` (exit 0); log `/tmp/t073-r2-verify.log`.

| Fixture          | Main first pass ms | T073 first pass ms | First ratio | Five-pair median ratio |
| ---------------- | -----------------: | -----------------: | ----------: | ---------------------: |
| fd-two-stage     |             3720.5 |             3228.2 |      0.868× |                      — |
| common-source-ac |              883.6 |              853.2 |      0.966× |                      — |
| skew             |             1765.6 |             1951.1 |      1.105× |                 1.084× |
| deadtime         |            17697.8 |            18299.0 |      1.034× |                      — |
| ota-sky130       |              748.9 |              778.1 |      1.039× |                 1.065× |
| widlar           |             3871.8 |             3845.2 |      0.993× |                      — |
| ltc3452          |            14890.0 |            16697.2 |      1.121× |                 1.029× |

`skew` and `ltc3452` exceeded +10% in their first pass and received five
alternating pairs. All final held-out checks are within +10%.

`ota-sky130` received five alternating pairs even though its first pass was
within +10%, to verify the review finding explicitly. Its median paired ratio
is **1.06456× (+6.46%)**, versus round 1's **1.763× (+76.32%)**. Main/current
elapsed medians are **807.6 / 850.3 ms**. Final phase medians:

| Phase        | Main ms | T073 ms |
| ------------ | ------: | ------: |
| Port search  |  423.59 |  470.18 |
| Finishing    |   95.27 |  115.94 |
| Label repair |  109.29 |  106.94 |
| Annealer     |  112.96 |  112.97 |

Phases can overlap and must not be summed. Round 1's extra cost concentrated in
port search, finishing and label repair. The revised policy removes most of
that cost: finishing calls return from 24 to main's 22, and label-repair cost
is no longer elevated. The final profiler reports 37 seating calls versus
main's 39 (round 1 had 43). The timing checks run without competing evaluation
or test jobs; no runtime-based decision enters the planner.

## Investigation results

The unchanged focused command
`pnpm exec vitest run packages/auto-layout/test/corpus.test.ts -t 'five-t-ota|fig-17-19b'`
reproduced both review failures. Restoring main's seed seats alone made it pass,
confirming the early-seating cause for those two regressions. Logs:
`/tmp/t073-r2-repro.log` and `/tmp/t073-r2-seeds.log`.

New regression assertions first failed for unscored mirror selection, missing
conventional candidates, and convention overriding a cheaper routed edge
(`/tmp/t073-r2-red.log`). Final tests cover both cheaper-original selection and
corrected ties, and show that a conventional output wins when routed crossings,
bends and length are identical. Score assertions now use the finished calibrated
objective required by the review. The label-owner guard fixture starts farther
away so its invalid candidate still wins that objective; the rejection assertion
is retained.

Appending a new candidate before existing equal-cost candidates displaced the
better midpoint from the bounded shortlist. Appending after existing candidates
retains stable ties. A candidate tied to the incumbent's nearest host could not
be regenerated after removing the incumbent, as the corpus test requires; the
final additional candidate uses the outermost host on the conventional side.
These corrections were made before the final dev/val evaluation.

The preliminary development-only run completed 439/439 with portOrder 190,
crossings 280, bends 1774 and composite 101.16090. Final host-only candidate
generation yields bends 1773 and composite 101.13782; it does not close the main
portOrder gap. No tuning followed validation results.

## Deviations and open questions

- The review supersedes the plan's forced initial conventional seats and its
  separate convention rank. The final implementation follows the review.
- Existing round 1 bounds remain: new direction/convention behavior is limited
  to at most 40 instances; partition/given drafts and fixed-device drawings
  retain their existing correction exclusions. No differential house-style
  rule was added.
- The prescribed local port-to-host convention plus routed scoring is
  insufficient for the frozen input-to-output `portOrder` target on this
  corpus. Further behavior or objective changes need a revised plan. The
  remaining quality failures are retained rather than changing metrics, weights,
  acceptance limits or files owned by T071.
- No plan, review, spec, dependency, lockfile, generated file or T071-owned file
  was edited. No provider API was called. No commit, push, merge, rebase or
  branch switch was performed.

### Proposed spec text for Opus

**R19 / R71 — Initial Cell Pin seats.** Preserve nearest-edge and transformed
pin-exit initial seating, spacing, fixed ports and contact rules. Do not force
an input/output side before routing. R146 may consider a conventional side as
an additional guarded alternative.

**R57 — Signal direction.** Share the existing host-mean test. Up to 40
instances, compare original and corrected template/layered drafts through the
existing routed draft scorer before refinement; corrected wins ties. Identical
drafts need no extra route. Reflect rigid stages as units, preserving their
internal convention. Skip correction for fixed-device, partition and supplied
placement drafts. Stages retain their existing correction. Do not add a complete
strategy plan.

**R74 — Port convention.** Up to 40 instances, count directed non-rail ports by
position relative to their nearest connected non-marker host pin. Inputs belong
left, outputs right; either equally near host may satisfy the rule. Accepted
coincident contacts are neutral. Use explicit interface direction, otherwise
existing Net roles. Retain weight 300 and all other score weights. Above-40
behavior remains unchanged.

**R146 — Routed port-seat search.** Append one horizontal conventional candidate
at the ordinary offset beyond the outermost host on the directed side. Generate
it from host geometry alone; apply existing geometry/contact and straight-join
filters. Keep the two-seat shortlist and total budget, using one scalar
crossing/wire estimate with the scaled R74 penalty; preserve existing candidates
on estimate ties. Accept only a strictly lower finished calibrated score under
routed and compaction guards. Never route a blocked seat, accept a finished
blocked port, or increase the total number of blocked joins. Incumbent wins
finished-score ties; fixed ports remain untouched.
