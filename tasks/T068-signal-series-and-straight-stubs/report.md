# T068 report — round 3

## Summary

Implemented the latest review's signal-part scope, stage direction, layered
row-draft comparison and guarded port-seat fallback. Both named drawings pass
the geometry assertions. The original synthetic Vin→Rs→gate ordering test is
unchanged and passes. Acceptance is **partial**: dev crossings are +1.087%
(limit +1%), dev avoidable jogs are unchanged rather than lower, and the R63
strategy-order test fails. The required common-source five-pair runtime gate
also fails at +20.8%. Determinism and all six large-document identities pass.

## Steps

| Step | Status  | Notes                                                                                                                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Orientation metrics and placement share the revised eligibility definition; baseline remeasured with that definition. Existing jog and blocked-join metrics retained.                    |
| 2    | done    | Diagnosed both named drawings, all eight review examples and the common-source runtime phases.                                                                                           |
| 3    | done    | General signal/stage rules, routed row-draft selection, and guarded obstructing-seat fallback implemented within owned paths.                                                            |
| 4    | partial | Synthetic direction/determinism assertion preserved; added bridge/port eligibility and fallback-seat coverage. Existing R63 ordering assertion fails; left unchanged for Opus.           |
| 5    | partial | R153 updated; all 628 evaluated; 25 samples and named drawings rendered. Dev crossing, jog and common-source runtime gates fail; determinism and all six large-document identities pass. |

## Review findings addressed

1. **Signal-series scope.** A candidate must connect different instances. When
   its Nets share a non-passive device and either side lacks another such
   device/source, it is a bridge and retains legacy rows. Other passive
   bridges and interface ports do not establish a second device. Source→gate
   resistors and port→device series parts remain eligible. Both placement and
   metrics call the same classifier, with full-document eligibility retained
   when stages build local rows. The old Cgd-orientation expectation and metric
   counts were updated to the definition explicitly requested by the review;
   the final Vin→Rs→gate test was not weakened.
2. **Stages.** A source driving a signal part was being seated below it as a
   rail shunt. It now sits beside the driven pin. Stage ordering preserves
   forward series flow; free stages with uniformly reversed series flow are
   mirrored before scoring. Templates/symmetry retain their geometry.
3. **Drafts and seats.** Layered placement builds both row policies and routes
   the resulting drafts through the existing candidate router to choose the
   lower routed score. There is one normal strategy/refinement/annealing/
   finishing pipeline. R71 keeps its ordinary starting seat. R146 evaluates
   at most one obstructing fallback before its two clear-seat candidates,
   within the existing total trial budget, so a clear seat cannot raise the
   routed guards relative to an accepted fallback. Rail searches retain their
   incumbent and reject regressing candidates. The two reviewed extra
   wire-through-symbol regressions are gone in the targeted recheck.
4. **Runtime.** Phase measurements reproduced the round-2 regression in
   relocation, not port-seat geometry. Draft choices and routed drafts are
   cached within the current public planning call; the cache does not survive
   caller edits. This avoids repeating the new draft comparisons but does not
   resolve the relocation cost: the required median runtime remains +20.8%.
   Finding 4 is therefore **partial**, not fixed.

## Acceptance results

```text
pnpm build → 0; all package/app builds complete (build-final.log).
pnpm typecheck → 0 (typecheck-final.log).
pnpm lint → 0; 2039 files, 0 errors, 3329 warnings (lint-final.log).
pnpm format:check → 0; all matched files use Prettier (format-final.log).
pnpm test:local → 1; sandbox socket/PostgreSQL EPERM failures (test-local.log).
pnpm test:local [outside sandbox] → 1;
  1 failed | 787 passed | 3 skipped files;
  1 failed | 8051 passed | 117 skipped tests (test-local-final.log).
pnpm test:slow → 0; 2 files, 14 tests passed in 51.52 s (test-slow.log).
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed (439 dev / 189 val), none non-equivalent (eval-final.log).
python3 tmp/t068-r3/compare.py → 1;
  failed gates: dev:crossings, dev:avoidableJogs.
node tmp/t068-r3/verify.mjs → 0;
  all 15 repeated plans deterministic and error-free; six large plans match main.
python3 tmp/t068-r3/check-verification.py → 0;
  identity/determinism and initial single-pair held-out timings pass.
node tmp/t068-r3/profile-after.mjs → 0 (measurement command);
  five-pair common-source median ratio 1.207928: runtime gate FAIL.
```

The sandboxed local run also had a 5000-ms socket test timeout. The unrestricted
rerun had no timeout failures; no timeout setting was changed. The only remaining
failure is `quality.test.ts:474`, R63: the RC stages draft now scores 31 versus
62 for template/layered, so the score-sorted refinement candidates are stages
then template. The test requires template then stages. Its assertions remain
unchanged. Evidence: `r63-diagnosis.log` and the complete failure diff in
`test-local-final.log`. The focused signal/port tests passed before the final
suite, which also passed the additional bridge/port and fallback assertions.

| Metric                  | Dev main → round 3             | Val main → round 3             | Gate                                       |
| ----------------------- | ------------------------------ | ------------------------------ | ------------------------------------------ |
| Crossings               | 276 → 279 (+1.087%)            | 153 → 153                      | **dev fails**                              |
| Bends                   | 1808 → 1751 (−3.15%)           | 764 → 737 (−3.53%)             | pass                                       |
| Wire length             | 429854.63 → 428454.63 (−0.33%) | 192716.12 → 191616.12 (−0.57%) | pass                                       |
| Median area ratio       | 1.284404 → 1.273875 (−0.82%)   | 1.239508 → 1.226279 (−1.07%)   | pass                                       |
| Avoidable jogs          | 22 → 22                        | 2 → 2                          | **dev not lower**; combined 24 → 24 passes |
| Blocked joins           | 40 → 9                         | 15 → 10                        | pass                                       |
| Upright signal parts    | 39 → 28                        | 17 → 12                        | pass                                       |
| Horizontal signal parts | 159 → 170                      | 60 → 65                        | informational                              |

All guards pass: floating=6, missing=16, non-equivalent=0. Nonzero visual totals:
label clearance 192→191, label overlap 5→5, label-owner distance 2→2, label run-on
42→40, terminal departure 49→49, terminal on foreign route 1→1, wire through
symbol 17→17. Every other `VISUAL_*` total is zero in both runs.

The baseline was re-evaluated with the revised metric definition; all 628 plan
hashes match `tmp/le10-main-05050fd/report.json`. Human orientation counts also
use the new definition: dev 56 vertical/142 horizontal, val 16/61. This avoids
comparing new eligibility against the old round-2 totals. Evidence:
`baseline/report.json`, `result.json`, `comparison.json`, `quality-changes.json`.

Rendered and inspected artifacts include the two named drawings, all eight
review examples and all additional crossing/jog regressions. The same 25-sample
page is at `tmp/t068-r3/review.html`, with `review-full.png`. No validation-driven
tuning followed the final evaluation.

### Determinism, large-document identity and runtime

All 15 fixtures (seven held-out, two named, six large) have byte-identical
repeated task plans and no error diagnostics. All six large plans are also
byte-identical to main (50, 50, 51, 103, 70 and 94 instances). Evidence:
`verification.json`, `verification-check.json`, `verification.log`.

| Held-out fixture | Main ms | Round 3 ms | Initial ratio |
| ---------------- | ------: | ---------: | ------------: |
| fd-two-stage     |  3703.3 |     3579.0 |        0.966× |
| common-source-ac |   881.9 |      960.4 |        1.089× |
| skew             |  1845.4 |     1748.1 |        0.947× |
| deadtime         | 14951.8 |    14945.0 |        1.000× |
| ota-sky130       |   680.5 |      721.6 |        1.060× |
| widlar           |  3350.1 |     3250.1 |        0.970× |
| ltc3452          | 16732.3 |    16436.4 |        0.982× |

The initial common-source measurement (+8.9%) does **not** establish the runtime
gate. Five further isolated pairs alternating main/task order give ratios
0.989×, 1.270×, 1.236×, 1.208× and 1.166×; median paired ratio **1.207928**.
Median durations are main 753.1 ms and task 907.6 ms. No other test/evaluation
workload ran during either timing exercise. Evidence: `profile-after.json`
and `profile-after.log`.

The pre-fix round-2 measurement reproduced a 1.139835 median paired ratio;
median relocation was main 131.9 ms / task 373.1 ms. Final profiling still
shows relocation main 131.3 ms / task 404.8 ms, versus annealing 403.6 / 374.4 ms,
ports 0.42 / 0.44 ms, gaps 53.7 / 0.13 ms, and finishing 107.0 / 149.3 ms.
Finishing is nested in other phases, so these phase values must not be summed.
The changed placements increase relocation work; the suggested per-seat
straight-join checks are not the measured bottleneck. Per-call draft/routing
reuse bounds repeated comparisons, but does not bring this case within +10%.
No search budget or timeout was changed to make the timing gate pass.

## Investigation results

### Named drawings

The common-source Rs originally came from the legacy template: Vin's positive
Net has a supply role without being a rail, while Rs has no R151 DC direction.
The final geometry has Vin.+=(300,320), Rs input=(350,320), Rs output=(390,320),
and M2.G=(430,320).

The source-degeneration load and drain already shared x=290. P2 had been seated
on their open join. Final R1.2=(290,220), M1.D=(290,270), P2=(320,250); the route
covers the vertical interval with a branch at (290,250). Both named assertions
pass, including no errors and zero blocked joins.

### Reviewed regression drawings

- `3byq69ryhz`: the explicit same-device Cgs/Cgd bridges are excluded and the
  legacy layered draft wins; crossings return to zero. C2/C4/C5 remain eligible
  under the requested topology definition: the exported M1.B has no Net,
  while the external bulk port has its own Net. No missing bulk connection is
  inferred from names or artwork. The regression test covers all four bridge
  types when their connections to the same transistor are explicit.
- `gx36d3sre9`: the legacy draft wins (routed score 9118 versus 12180 for the
  signal draft); final crossings return from round 2's 6 to main's 2.
- `hpfcqs6cjr`: the legacy draft wins (2783 versus 4746); final crossings return
  from 1 to main's 0.
- `t3r2dvffgc`: the legacy draft wins (4089 versus 5025); final crossings return
  from 2 to main's 1.
- `5nrdf75rpd`: main's layered draft scored 3460 and its stages draft 5828;
  changed stages score 3252 and win. The series resistor between two branch
  devices is eligible under the general rule. Centering it in that stage
  changes feedback routing; final crossings remain 0→2. This is a remaining
  finished-strategy tradeoff, not a missing legacy layered draft.
- `czmmfvytar`: the retained legacy layered draft scores 3347. Main's stages
  draft scored 1601, but signal-stage placement now scores 4810. Layered wins
  and finishes with one crossing versus main's zero. The input and feedback
  capacitors connect distinct devices and remain eligible. Restoring another
  complete plan was not attempted.
- `9ggfasx38f`: the obstructing port-seat fallback restores the guarded routing;
  wire-through-symbol warnings return from 2 to main's 0, crossings remain 2.
- `xnjc69vr35`: the same fallback restores wire-through-symbol warnings from 2
  to main's 1, crossings remain 1. Its pre-existing warning is retained.

The eight before/after renders were inspected. Evidence:
`diagnosis.json`, `diagnosis-main.json`, `review-findings.html` and
`review-<id>.png`. Named geometry: `named-check.json` and both named SVGs.

### Additional final quality-gate causes

The five dev crossing increases are `5nrdf75rpd` (+2), `czmmfvytar` (+1),
`en97w8v92y` (+1), `fteqwehmtf` (+1), and `p3af2sg23j` (+2). Improvements on
other drawings offset four of those seven crossings, leaving net +3.

- `en97w8v92y`: eligible coupling/feedback capacitors C1/C4 change stage
  geometry. Stages now score 24262 (two draft crossings but an unrouted
  penalty), versus 13370 for template/layered. The finished winner changes
  stages→template; amplifier feedback routes grow from 7 to 8 crossings and
  wire 2960→3970. Keeping the legacy layered draft cannot recover the old stage.
- `fteqwehmtf`: R3/R4 are series input resistors around a differential block.
  The stages winner remains, but its signal ordering places the feedback
  paths above the stage, adding one crossing; bends fall 12→10, wire rises
  1140→1340. Both layered row policies have the same 11241 draft score.
- `p3af2sg23j`: input resistor R1 and capacitor C3 change stage placement;
  template/layered score 1587 versus stages 1899. The winner changes
  stages→template, putting the input path on one row and routing the feedback
  branch above it. Crossings rise 0→2, bends fall 5→4, wire rises 890→1100.
- `jfp369kpj5` removes one jog: the horizontal inter-device capacitor moves
  into the signal path; winner stages→layered, bends 4→2 and wire 960→680.
- `wde2p3x9h8` adds the offsetting jog: the finished stages result leaves R1.1
  at (470,270) and M1.G at (500,260), with opposing horizontal exits. The route
  bends at (470,260); moving R1 up one pitch would straighten this join.
  Bends rise 2→3 and wire 250→260. Source→R1 has perpendicular exits and is
  not counted by the jog metric. Evidence: `jog-diagnosis.log`.

These final causes were measured and rendered, not tuned away. See
`diagnosis-additional.json`, `review-additional.html`, and `review-<id>.png`.

## Deviations and open questions

- Acceptance remains partial. Opus must decide the two remaining quality gates
  and the R63 strategy-order contract, as well as the +20.8% common-source
  median runtime regression. No test was weakened and no second complete-plan
  fallback was restored.
- No branch switch, commit, dependency change, plan/review edit or provider API
  call was performed. Tests and evaluation use local inputs only.
