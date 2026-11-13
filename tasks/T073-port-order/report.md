# T073 report — round 1

## Summary

Implemented shared signal-direction correction for template, layered and stages
placement, position-based initial port seating and R74 scoring, and conventional
side preference in R146. Changes remain uncommitted on `task/T073-port-order`.

**Partial: not ready for acceptance.** The final evaluation completed 627/628
layouts. Dev portOrder fell 20.21%, below the required 25%, while crossings,
bends, readability composite and several guards regressed. One validation
layout is newly refused. The ordinary suite has two crossing-limit failures;
these assertions remain unchanged. No metric or calibration weights changed.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                          |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Extracted R57's host-mean check into `signal-direction.ts`; `place.ts` applies it to template/layered drafts. Stages reuse the helper. Rigid stages translate as units; free devices reflect their positions and orientations. No extra strategy plan.         |
| 2    | done    | `port-convention.ts` resolves interface direction and compares a seat to its nearest host pin. R19/R71 seed the conventional side; R74 retains weight 300; R146 ranks crossings, convention, then length, retaining its two-seat shortlist and evaluation cap. |
| 3    | partial | New and updated focused tests pass, including both strategies, rigid-stage geometry, rotated input hosts, output seating, positional scoring, determinism and fixed ports. Two unchanged corpus crossing limits fail.                                          |
| 4    | partial | Ran all 628. Quality gates fail. Review and timing evidence are described below.                                                                                                                                                                               |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing Vite chunk-size warning.
pnpm typecheck → 0.
pnpm lint → 0; 2048 files, 0 errors, 3404 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 1; 1 failed / 790 passed / 3 skipped files;
  2 failed / 8086 passed / 117 skipped tests; no timeout raised.
  corpus.test.ts:188, five-t-ota and fig-17-19b:
  expected 1 to be less than or equal to 0 (crossings).
pnpm test:slow → 0; 1 file, all 7 tests passed, no timeout raised.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  439 dev completed, 188 val completed, 1 val refused.
```

The first sandboxed local-suite run also failed PostgreSQL connections and
loopback listeners with `EPERM`. Re-running the same command with approved
local network access eliminated those environment failures; the two corpus
failures above remain. No tests were removed or limits relaxed.

Final focused checks: `port-order.test.ts` (10 tests) and
`port-seat-search.test.ts` (13 tests) pass. The earlier six-file check including
attachments, recognition-cascode, short-stubs and cleanup-labels passed all
77 tests before six additional direction/rigidity cases were added.

Logs: `/tmp/t073-{build,typecheck,lint,format}.log`,
`/tmp/t073-test-local-final.log`, `/tmp/t073-test-slow-final.log`,
`/tmp/t073-eval.log`, `/tmp/t073-port-tests.log`,
`/tmp/t073-rigid-tests.log`, `/tmp/t073-regressions-final.log`.

### Corpus comparison

Baseline: `tmp/main-865924b-report.json`. Final report:
[full evaluation](../../tmp/t073-r1/result.json). Detailed totals:
[comparison](../../tmp/t073-r1/comparison.json).

| Metric                           | Dev main → T073                | Val main → T073              |
| -------------------------------- | ------------------------------ | ---------------------------- |
| Completed                        | 439 → 439                      | 189 → 188                    |
| portOrder                        | 193 → 154 (−20.21%)            | 100 → 72 (−28.00%)           |
| Readability composite sum        | 100.02685 → 108.75096 (+8.72%) | 49.92095 → 45.20640 (−9.44%) |
| Crossings                        | 273 → 346 (+26.74%)            | 157 → 145 (−7.64%)           |
| Bends                            | 1778 → 1869 (+5.12%)           | 737 → 734 (−0.41%)           |
| Floating pins                    | 6 → 6                          | 0 → 0                        |
| Missing connections              | 11 → 11                        | 5 → 5                        |
| Non-equivalent completed layouts | 0 → 0                          | 0 → 0                        |

**The validation totals above are not evidence of a passing improvement:** the
refused drawing contributed five portOrder violations, 37 crossings, 40 bends
and 6.12342 composite points to main. On the 188 common completed validation
layouts: portOrder **95 → 72 (−24.21%)**, crossings **120 → 145 (+20.83%)**,
bends **697 → 734 (+5.31%)**, composite **43.79754 → 45.20640 (+3.22%)**.
Both splits fail the intended quality outcome.

Other weighted metrics exceeding +2%:

- Dev: avoidableJogs 21 → 24; blockedJoins 4 → 42; controlSeparation 36 → 37;
  labelOverlaps 5 → 6; railCrossings 60 → 79; terminalDepartures 31 → 34.
  Crossings also fail, as shown above.
- Val: blockedJoins 2 → 21; sourcePolarity 4 → 5; unownedDrafting 24 → 25.
  Common-completed crossings also fail.

Visual regressions: dev `VISUAL_LABEL_CLEARANCE` 135 → 150,
`VISUAL_LABEL_OVERLAP` 5 → 6, `VISUAL_TERMINAL_DEPARTURE` 31 → 34;
val `VISUAL_LABEL_RUN_ON` 11 → 12. All other visual totals are not higher.
236 serialized plan hashes differ from the baseline.

The new refusal is validation case `yje2n6eva2`:

```text
R10: touching-pin stub for net-split-785eadcf370c3f49: no clear path from
P8.P to XSLAVE.dp: the direct one passes over pin XMASTER.iref of a different
Net (iref) at (240, 180) between (480, 180) and (200, 180).
```

### Determinism, large documents, timing and rendered review

[Human | main 865924b | T073 review page](../../tmp/t073-r1/review.html)
contains all 25 fixed samples and the ten largest portOrder reductions (35
unique drawings). All nine rendered screenshot sheets were visually inspected;
see `tmp/t073-r1/review-1.png` through `review-9.png`. The generator checks both
versions against their evaluation plan hashes and repeats T073: all 35 baseline
hashes match, all 35 task hashes match, and all 35 repeats are byte-identical.
[Verification evidence](../../tmp/t073-r1/review-verification.json).

| Top reduction drawing | portOrder main → T073 | Crossings main → T073 | Bends main → T073 |
| --------------------- | --------------------- | --------------------- | ----------------- |
| `5etmybq44s`          | 5 → 0                 | 2 → 6                 | 9 → 10            |
| `v4rcysdnav`          | 4 → 0                 | 0 → 0                 | 5 → 2             |
| `v9c7fgk7rm`          | 4 → 0                 | 2 → 2                 | 6 → 7             |
| `4dv8cc97xc`          | 4 → 2                 | 2 → 3                 | 3 → 10            |
| `6acrn4nr4v`          | 2 → 0                 | 0 → 0                 | 4 → 1             |
| `6s67mqbxx9`          | 5 → 3                 | 2 → 3                 | 10 → 14           |
| `aqfb9kjcfj`          | 4 → 2                 | 0 → 2                 | 1 → 4             |
| `gx36d3sre9`          | 2 → 0                 | 2 → 7                 | 13 → 15           |
| `hdag4x8jrw`          | 4 → 2                 | 0 → 2                 | 2 → 4             |
| `jvkws955tv`          | 7 → 5                 | 0 → 1                 | 0 → 2             |

Visual findings: `v4rcysdnav` and `6acrn4nr4v` improve local signal placement
without extra crossings. In contrast, `5etmybq44s` eliminates five portOrder
violations while increasing crossings from two to six; `gx36d3sre9` eliminates
two while increasing crossings from two to seven. The fixed sample
`c84038b6-33e4-41ac-b79d-1daeaf463770` now routes an input around the inward side
of the right transistor, adding one crossing and two bends. These diagrams
confirm that the numerical portOrder gains are not a general readability win.

The seven held-out drawings and six large drawings also produced byte-identical
T073 repeats (13/13), with no error diagnostics. All six large complete plans
are byte-identical to main: `38m8wdesbh` (50 instances), `4fb59zv76m` (50),
`8b2n3zf9vj` (51), `b9afqhsjzv` (103), `g47e465db5` (70), and `sm663cbs8b` (94).
Evidence: [verification.json](../../tmp/t073-r1/verification.json), generated by
`node tmp/t073-r1/verify.mjs` (exit 0); log `/tmp/t073-verify.log`.

| Held-out fixture | Main first pass ms | T073 first pass ms |  Ratio | Five-pair median ratio |
| ---------------- | -----------------: | -----------------: | -----: | ---------------------: |
| fd-two-stage     |             4077.4 |             3462.9 | 0.849× |                      — |
| common-source-ac |             1024.2 |              954.3 | 0.932× |                      — |
| skew             |             1993.8 |             1793.3 | 0.899× |                      — |
| deadtime         |            20346.3 |            19513.5 | 0.959× |                      — |
| ota-sky130       |              771.9 |             1293.2 | 1.675× |                 1.763× |
| widlar           |             3901.7 |             4051.3 | 1.038× |                      — |
| ltc3452          |            15090.3 |            15776.0 | 1.045× |                      — |

`ota-sky130` was the only fixture above +10% in the first pass, so it received
five additional alternating main/T073 pairs. Its median paired ratio is
**1.763× (+76.32%)**, failing the runtime gate; the main/T073 elapsed medians
are **698.1 / 1260.7 ms**. Phase medians show port search about 369.3 → 640.6 ms,
finishing about 84.6 → 222.4 ms and label repair about 95.2 → 242.3 ms. These phases
can overlap and must not be summed. All other first-pass ratios are below
1.10×. No test timeout or search budget was raised.

## Investigation results

The first development-only run tried additional horizontal R146 candidates and
applied input convention to all `internal` ports. It reduced dev portOrder
193 → 153 but increased crossings 273 → 348 and refused one development
layout. The expanded candidate set displaced a better existing midpoint seat
from the fixed shortlist. The final implementation retains the existing R146
candidate set and changes its ranking only.

Treating every internal/passive port as an input also changed split-tail bias
seats and broke the visible bulk-contact test. The final helper requires an
explicit input/output interface direction or an existing input/output Net role;
undirected ports retain their old initial seats. Accepted R38 contacts are
convention-neutral, preserving the existing touching-port test. These fixes
were made before the final dev/val run. No validation-driven tuning followed.

The final failure is broader than seat orientation: conventional seats can
increase routed crossings and block previously straight joins. For example,
dev `en97w8v92y` adds nine crossings and `gx36d3sre9` adds five. The existing
finalist guards do not compare each replaced strategy draft with its old main
layout. The frozen metric and routing/transaction authorities were left intact.

## Deviations and open questions

- New direction/seating behavior is limited to at most 40 instances to honor
  the plan's requirement that the six large plans remain byte-identical. The
  existing larger-document R57 and mirror-flag scoring paths remain intact.
- Template/layered whole-draft correction is skipped when a device is fixed;
  mirroring a partial drawing would violate the whole-unit requirement. Fixed
  ports remain occupied and unchanged.
- R19/R71 use the existing side override during refinement. R146 keeps its
  obstruction, compaction and routed guards, so conventional preference cannot
  bypass those checks. Licensed zero-length contacts remain eligible.
- No plan, review, spec, metric, calibration, dependency, lockfile or parallel
  T071-owned file was edited. No provider API was called. No commit, branch
  switch, push, merge or rebase was performed.
- Opus must revise or constrain the design before acceptance: the current
  implementation does not satisfy the crossing, readability, completion or
  visual-quality gates. The two corpus tests must remain failing until the
  behavior is fixed; their limits were not rewritten.

### Proposed spec text for Opus

**R19 — Cell Pin side.** Up to 40 instances, directed input Cell Pins prefer
seats left of their device host pin and outputs prefer seats right of it.
Resolve direction from explicit interface direction, otherwise the existing
Net role; do not derive new roles from label text or geometry. Supply/ground
remain top/bottom and undirected ports retain the nearest-edge rule. Keep
fixed ports occupied and immovable. R20 spacing, explicit side refinement and
R146's guarded routed alternatives continue to apply.

**R57 — Signal direction.** Share the input/output host-mean test across
placement strategies. Up to 40 instances, when input hosts lie right of output
hosts, reflect a free template/layered draft left-right before marker placement
and normal routed strategy scoring. Rigid group/symmetry stages translate as
units to the reflected side while retaining internal orientation, handedness
and aligned pin columns. Do not reflect a draft containing a fixed device.
Stages retain their stage-order reversal and mirrorable-stage correction;
partition arrangements retain their existing policy. Missing either host side
leaves the draft unchanged. Do not add a complete strategy plan.

**R71 clarification.** For directed single-host ports up to 40 instances, try a
horizontal local seat on the conventional host side, facing the host, before
R19/R20 fallback. Preserve the existing offset, collision checks, local-seat
reservation, rail behavior and fixed-port handling. Undirected and larger
ports retain the transformed pin-exit policy.

**R74 — Port convention.** Up to 40 instances, count a directed non-rail port
off convention by position relative to its nearest connected non-marker host
pin, using Manhattan distance. Inputs require a smaller x and outputs a larger
x; equal-distance hosts permit a seat if either host satisfies the rule.
Accepted coincident contacts are convention-neutral. Artwork mirror alone is
not the test. Retain weight 300 and all other scoring terms. Larger documents
retain the existing scoring path.

**R146 — Routed port-seat search.** Keep the existing candidate set, clear-seat
preference, two-seat shortlist and bounded evaluation count. Rank estimated
crossings first, then positional convention, then spanning length. Compare
finished candidates by routed crossings, then convention, then calibrated
score. Keep the incumbent on ties; preserve all obstruction, compaction,
connectivity and visual guards, including fixed ports.
