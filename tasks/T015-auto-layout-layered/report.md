# T015 report — round 3

## Summary

Implemented R43 rail completion, floating-pin measurements and R44 routing comparison while preserving Opus’s bulk-pin restoration. Rail members without their own marker join a horizontal trunk and one marker host; aligned trunks are split at pins to respect the existing router’s clearance rules. Routing failures and any residual floating pins name the affected pins in R14 warnings. No router or Edit Engine changes were made.

All acceptance commands meet their stated command-level expectations after rerunning the full suite outside the sandbox. All nine corpus cases have zero floating pins and retain their existing geometry, crossings and bend assertions. All seven held-out cases commit safely within their T013 crossing limits. The evaluator completes 32/33 without throws; every completed document is electrically equivalent and has no unsafe routing. The crossing-reduction quality targets remain missed, as detailed below.

## Steps

| Step                  | Status                | Notes                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Evaluator         | done                  | Retained the pre-placement T013 baseline. Added human/result floating-pin lists and split totals, including totals for all human drawings and all completed results. Replayed the retained T013 implementation to backfill baseline floating-pin measurements; every old status, crossing, bend, length and unsafe metric matched exactly before adding fields. |
| 2 — Spec              | done                  | Updated R12’s superseded unrouted-membership text and documented R43/R44. Earlier R30–R42 work is retained.                                                                                                                                                                                                                                                     |
| 3 — Layered placement | done (earlier rounds) | Kept the layered functions, template portfolio and Opus’s `restoreBulkPins` / `includeBulk` changes. R36 supersedes deleting the template strategy.                                                                                                                                                                                                             |
| 4 — Tests             | done                  | 97 auto-layout tests pass. Added rail connectivity through real routing/replay for both polarities and small/large rails, floating-pin semantics, R44 placement reuse/score selection, zero-floating corpus assertions and named-warning held-out assertions. No existing target was relaxed or test removed.                                                   |
| 5 — Investigation     | partial               | Full tables, refusal, timings, corpus/held-out metrics and six final visual pairs are below. Quality-target misses remain explicit.                                                                                                                                                                                                                             |

## Review findings addressed

1. **Round 2 must-fix 1, R43:** unmarked rail members now get a trunk connected to one marker host, while existing marker stubs remain. The same routing path serves both placement strategies. Trunks are planned before marker stubs; a level trunk is split at selected pins, since the existing router cannot reuse a free trunk endpoint already incident to a wire or pass over an intermediate pin. Non-level trunks run outside the device rows, between outer pins and their 40-unit marker offsets. Clearance failures remain R14 warnings naming pins.
2. **Round 2 must-fix 2, floating pins:** shared `floatingPins` derives Base Net membership and physical components from the existing topology projection, omitting bulk pins. A singleton physical pin stays floating even if it has a label stub; a genuinely singleton Net is excluded. The evaluator records lists per drawing and result and counts in totals. All nine corpus results assert zero; the evaluator, review tool and held-out tests check warning coverage of residual result pins.
3. **Round 2 must-fix 3, R44:** after the portfolio chooses its refined plan, reuse precisely its strategy and layout overrides for one full replay with R39 disabled. Compare R22 scores and preserve the selected plan on ties; do not refine the alternative. Refinement metrics remain attached to the returned result. The specific quality regression motivating R44 is still present after rail completion (see below); the prescribed comparison is implemented and tested.

## Acceptance results

```text
pnpm install --frozen-lockfile --offline → 0; already up to date, pnpm 11.16.0
pnpm format:check → 0; all matched files use Prettier style
pnpm docs:check → 0; validated local Markdown links in 74 files
pnpm typecheck → 0
pnpm lint → 0; 1930 files, 0 errors, 2605 warnings
pnpm vitest run packages/auto-layout → 0; 8 files, 97 tests passed
pnpm test:local → 1 in sandbox; loopback/PostgreSQL EPERM failures
pnpm test:local (unrestricted rerun) → 0; 744 files passed, 2 skipped; 7378 tests passed, 116 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → 1; no output (expected grep no-match result)
pnpm build → 0; Vite reports its existing large-chunk advisory
pnpm auto-layout:review → 0; all 9 corpus and 7 held-out cases committed
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → 1; no output (expected grep no-match result)
```

Logs are under ignored `tmp/t015-round3-*.log`. The initial sandbox suite could not bind loopback or connect to PostgreSQL; the unrestricted full rerun passed without changing out-of-scope code or tests. No browser test is expected by the plan.

## Investigation results

### Split totals against T013 and the reviewed pre-round-3 tree

Comparisons use only documents completed in both T013 and this round. C/B/L/F means crossings / bends / wire length / floating pins. The pre-round-3 measurement includes Opus’s bulk fix (32 completed), unlike the earlier round-2 report which recorded 29.

| Split | Completed / total | Common | Human C/B/L/F        | T013 C/B/L/F           | Pre-round-3 C/B/L | Round 3 C/B/L/F        | Crossing reduction |
| ----- | ----------------: | -----: | -------------------- | ---------------------- | ----------------- | ---------------------- | -----------------: |
| dev   |           17 / 18 |     14 | 26 / 149 / 28787 / 4 | 288 / 338 / 92330 / 62 | 202 / 282 / 63350 | 228 / 286 / 69760 / 26 |              20.8% |
| val   |           15 / 15 |     10 | 47 / 152 / 26608 / 4 | 262 / 256 / 96150 / 45 | 173 / 212 / 55610 | 184 / 213 / 58740 / 14 |              29.8% |

The 50% crossing-reduction target is missed on both splits. Bends remain below T013 on both splits. Restored rail wires raise crossings versus the reviewed pre-round-3 totals; no pin was deliberately left floating to protect those counts. Every residual floating result pin is explicitly named in an R14 warning; original drawings’ floating counts are measurements of those drawings, not planner warnings.

| Split | All human C/B/L/F    | All completed result C/B/L/F |
| ----- | -------------------- | ---------------------------- |
| dev   | 59 / 202 / 49799 / 6 | 344 / 382 / 98260 / 53       |
| val   | 63 / 246 / 50484 / 4 | 570 / 463 / 132460 / 48      |

### Full dev table

| Case       | Instances | Human C/B/L/F      | T013 C/B/L/F        | Round 3 C/B/L/F     | Planning ms | Status    | Equivalent / unsafe |
| ---------- | --------: | ------------------ | ------------------- | ------------------- | ----------: | --------- | ------------------- |
| 38m8wdesbh |        50 | 2 / 8 / 3476 / 0   | —                   | 42 / 31 / 8590 / 12 |      6924.9 | completed | yes / 0             |
| 4as9q55bq4 |        19 | 2 / 15 / 2200 / 0  | 30 / 34 / 8500 / 4  | 16 / 28 / 5370 / 0  |      5024.8 | completed | yes / 0             |
| 4fb59zv76m |        50 | 22 / 17 / 8070 / 2 | —                   | 62 / 37 / 15420 / 6 |      6145.3 | completed | yes / 0             |
| 57zs7ayept |        16 | 0 / 6 / 1490 / 0   | 6 / 10 / 2460 / 1   | 6 / 10 / 2610 / 0   |      1554.4 | completed | yes / 0             |
| 8pvqfhsxqr |        37 | 0 / 13 / 3410 / 1  | 52 / 45 / 10890 / 0 | 73 / 42 / 11370 / 0 |      4104.6 | completed | yes / 0             |
| b23bz45g2q |        15 | 0 / 3 / 1320 / 0   | 6 / 11 / 2920 / 0   | 6 / 10 / 2980 / 0   |      1444.8 | completed | yes / 0             |
| bsvsx7bmns |        24 | 5 / 13 / 3060 / 0  | 26 / 23 / 9390 / 11 | 17 / 18 / 5540 / 0  |      2768.4 | completed | yes / 0             |
| f7r5apxvfx |        20 | 2 / 13 / 1595 / 1  | 4 / 18 / 3520 / 4   | 3 / 20 / 2800 / 3   |      2078.8 | completed | yes / 0             |
| g47e465db5 |        70 | 7 / 12 / 6070 / 0  | —                   | —                   |      7130.9 | refused   | —                   |
| m7jcwrpkex |        29 | 4 / 10 / 1720 / 0  | 23 / 29 / 7860 / 0  | 11 / 20 / 6030 / 0  |      9127.8 | completed | yes / 0             |
| mcbrza282w |        22 | 0 / 7 / 2100 / 1   | 44 / 30 / 11600 / 7 | 13 / 20 / 4780 / 7  |      3144.6 | completed | yes / 0             |
| mthfqxzyk8 |        23 | 0 / 10 / 1730 / 0  | 2 / 14 / 1510 / 12  | 1 / 0 / 1320 / 10   |       452.7 | completed | yes / 0             |
| p7mrh78gjj |        24 | 4 / 15 / 2730 / 0  | 15 / 28 / 6570 / 2  | 18 / 28 / 6300 / 0  |     10326.7 | completed | yes / 0             |
| qv83v5afdg |        25 | 2 / 16 / 3396 / 0  | —                   | 12 / 28 / 4490 / 9  |      5236.2 | completed | yes / 0             |
| tk5krsz2df |        19 | 3 / 11 / 1750 / 0  | 15 / 17 / 3740 / 6  | 9 / 14 / 3260 / 0   |      2156.1 | completed | yes / 0             |
| wz9txzf2qf |        22 | 0 / 4 / 580 / 0    | 13 / 24 / 7500 / 1  | 7 / 22 / 3000 / 0   |      1647.9 | completed | yes / 0             |
| x8wctv9v73 |        17 | 4 / 14 / 2832 / 0  | 30 / 20 / 6760 / 8  | 19 / 21 / 3640 / 5  |       996.9 | completed | yes / 0             |
| y6tj635phz |        24 | 2 / 15 / 2270 / 1  | 22 / 35 / 9110 / 6  | 29 / 33 / 10760 / 1 |      7626.0 | completed | yes / 0             |

### Full val table

| Case       | Instances | Human C/B/L/F      | T013 C/B/L/F         | Round 3 C/B/L/F       | Planning ms | Status    | Equivalent / unsafe |
| ---------- | --------: | ------------------ | -------------------- | --------------------- | ----------: | --------- | ------------------- |
| 3kdhdapd4a |        40 | 10 / 23 / 4207 / 1 | 38 / 35 / 11520 / 13 | 26 / 30 / 7130 / 8    |     15582.4 | completed | yes / 0             |
| 5jvc96bjrx |        30 | 0 / 8 / 1470 / 0   | 50 / 44 / 12920 / 0  | 50 / 40 / 11020 / 0   |      8151.5 | completed | yes / 0             |
| 8b2n3zf9vj |        51 | 0 / 9 / 2070 / 0   | —                    | 38 / 46 / 10590 / 0   |      3892.2 | completed | yes / 0             |
| 9r4prxnen5 |        35 | 2 / 11 / 4020 / 0  | —                    | 40 / 32 / 8580 / 8    |      6582.9 | completed | yes / 0             |
| am2bbdtcq2 |        19 | 5 / 16 / 2651 / 1  | 15 / 16 / 5990 / 8   | 12 / 11 / 4490 / 0    |      1978.9 | completed | yes / 0             |
| b9afqhsjzv |       103 | 7 / 20 / 8230 / 0  | —                    | 162 / 75 / 30470 / 23 |      4386.5 | completed | yes / 0             |
| dxeky39qvp |        17 | 1 / 2 / 593 / 1    | 3 / 19 / 3360 / 0    | 3 / 19 / 3360 / 0     |      1127.1 | completed | yes / 0             |
| j528438392 |        20 | 2 / 14 / 2010 / 0  | 18 / 26 / 7060 / 4   | 20 / 22 / 7980 / 1    |      5193.9 | completed | yes / 0             |
| ptbzg5vr6a |         7 | 0 / 4 / 560 / 0    | 0 / 3 / 1060 / 0     | 0 / 3 / 1060 / 0      |       310.6 | completed | yes / 0             |
| q44rkdkb5b |        34 | 14 / 27 / 5280 / 1 | 54 / 31 / 13470 / 0  | 25 / 26 / 6720 / 0    |      8392.4 | completed | yes / 0             |
| q9hvr9f7yj |        27 | 3 / 35 / 4188 / 0  | 45 / 45 / 20830 / 10 | 14 / 27 / 6020 / 0    |      7639.4 | completed | yes / 0             |
| r462vjaatg |        31 | 6 / 17 / 3800 / 0  | 25 / 23 / 13620 / 9  | 22 / 22 / 7090 / 5    |     10990.2 | completed | yes / 0             |
| s9w2762ebp |        20 | 5 / 22 / 3816 / 0  | —                    | 11 / 23 / 4100 / 3    |      1560.5 | completed | yes / 0             |
| sm663cbs8b |        94 | 2 / 32 / 5740 / 0  | —                    | 135 / 74 / 19980 / 0  |      2471.1 | completed | yes / 0             |
| x3sbbhkreg |        22 | 6 / 6 / 1850 / 0   | 14 / 14 / 6320 / 1   | 12 / 13 / 3870 / 0    |      4189.5 | completed | yes / 0             |

### Remaining refusal and routing limits

- **g47e465db5** (70 instances): R10: touching-pin stub for net-contact-x1_17: no clear path from M32.G to X5.Y: the direct one passes through M18 between (780, 890) and (780, 530). Move the parts apart, give a trunk, or name the Net at each end with a Net Label on a short stub

R10, R23 and name-claim checks remain intact. Opus’s bulk restoration is preserved and the prior bulk-only refusals now complete. There are 101 floating pins across all 32 completed results (40 on the common baseline subset, versus 107 in T013). The 33 original human drawings have 10. Residual floating pins on completed results are routing/clearance failures covered by R14; their exact pin lists and diagnostics are in the ignored evaluator JSON and HTML.

For **8pvqfhsxqr**, T013 has 52 crossings and this round still has 73. A read-only diagnostic replay of the selected layered placement gives R39-on score **78337** (73 crossings, 42 bends, 11370 length) and R39-off score **78431** (73 crossings, 43 bends, 11310 length). R44 correctly keeps the lower score, but does not recover the T013 crossing count for this placement. No new circuit-specific exception was added.

### Planning time against instance count

| Instances | Documents | Median ms | Maximum ms |
| --------- | --------: | --------: | ---------: |
| 1–20      |        11 |    1560.5 |     5193.9 |
| 21–40     |        16 |    7104.4 |    15582.4 |
| 41–80     |         4 |    6535.1 |     7130.9 |
| 81–120    |         2 |    3428.8 |     4386.5 |

The 103-instance case **b9afqhsjzv** completes in **4.39 s**, below the 15 s target. Timing includes refusal work and the single R44 replay. Some acceptance checks overlapped this evaluation, so these are observed developer-machine timings, not isolated benchmark results.

### Corpus and held-out metrics

All sixteen results commit, are electrically equivalent and have empty `unsafeProblems`. All nine corpus cases have zero floating pins. The seven held-out cases remain within T013 crossing limits, with every remaining floating pin named in an R14 warning. The table includes every case so all metric changes are visible; T013 is the pre-placement capture in `tmp/t015-corpus-baseline.json`.

| Section  | Case               | T013 C/B/L      | Round 3 C/B/L/F    |
| -------- | ------------------ | --------------- | ------------------ |
| corpus   | five-t-ota         | 0 / 1 / 1120    | 0 / 1 / 1120 / 0   |
| corpus   | fig-17-19b         | 0 / 0 / 1100    | 0 / 0 / 1100 / 0   |
| corpus   | two-inverters      | 1 / 2 / 1500    | 1 / 2 / 1190 / 0   |
| corpus   | differential-stage | 0 / 0 / 360     | 0 / 0 / 340 / 0    |
| corpus   | common-source      | 0 / 2 / 1000    | 0 / 2 / 1000 / 0   |
| corpus   | rc-lowpass         | 0 / 0 / 360     | 0 / 0 / 360 / 0    |
| corpus   | rc-highpass        | 0 / 0 / 360     | 0 / 0 / 360 / 0    |
| corpus   | rlc                | 0 / 0 / 480     | 0 / 0 / 480 / 0    |
| corpus   | two-stage-symbolic | 0 / 3 / 1060    | 0 / 3 / 1060 / 0   |
| held-out | fd-two-stage       | 12 / 13 / 5930  | 8 / 11 / 3330 / 0  |
| held-out | common-source-ac   | 2 / 8 / 980     | 0 / 2 / 1040 / 2   |
| held-out | skew               | 4 / 4 / 2130    | 2 / 4 / 1740 / 0   |
| held-out | deadtime           | 17 / 36 / 7430  | 13 / 28 / 6670 / 6 |
| held-out | ota-sky130         | 3 / 7 / 2520    | 3 / 7 / 2520 / 3   |
| held-out | widlar             | 5 / 13 / 3140   | 4 / 12 / 1930 / 1  |
| held-out | ltc3452            | 22 / 25 / 10060 | 20 / 29 / 7540 / 5 |

No existing corpus assertion changed. The new zero-floating assertion strengthens the existing outcome contract. Prior rounds’ synthetic limit, shared-tail and R23 overlap tests remain intact.

### Six final side-by-side pairs inspected

Rendered six pairs directly from the final `tmp/auto-layout-eval/index.html` using the already-installed Resvg renderer, then inspected the PNGs. Each side is independently fitted to its panel.

| Case       | Instances | Observation                                                                                                                                                                                                                                         |
| ---------- | --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ptbzg5vr6a |         7 | Both stages and feedback remain clear. The load sits farther right and compensation loop is taller than the human drawing, but signal flow remains easy to follow.                                                                                  |
| b23bz45g2q |        15 | The result is tall with input at the lower right. Central resistors, capacitors and node labels crowd together; the human’s adjacent stages remain easier to read.                                                                                  |
| mcbrza282w |        22 | Multiple rows avoid the old single-row collapse, but the top band is congested, lower return wires are long, and original colored drafting arrows remain stranded above the moved circuit. Seven floating result pins remain named in R14 warnings. |
| bsvsx7bmns |        24 | The supply and ground drawing is more complete and has zero floating pins. A wide lower band and long vertical returns obscure the stages; central labels still overlap.                                                                            |
| 4fb59zv76m |        50 | Devices span several rows, but long horizontal bias and feedback wires dominate. Top supply markers and nearby references crowd together; the human’s stage hierarchy is clearer. Six floating result pins remain named in R14 warnings.            |
| b9afqhsjzv |       103 | The circuit becomes a very wide band with long return routes and small fit-to-page labels. Detached supply/context text persists above and below the devices. The human’s repeated blocks are easier to distinguish.                                |

The final pairs still fall short of human visual quality. Stage locality, label spacing and drafting-context preservation remain general placement problems.

## Deviations and open questions

- Crossing quality targets remain missed; R44 also leaves the cited individual development regression unresolved after the prescribed comparison. These are reported rather than chased with case-specific rules.
- R43 uses segmented, exact, clearance-checked wire batches for a level horizontal trunk and the existing `planRouteNet` trunk for other rails. This avoids the router’s occupied-endpoint/intermediate-pin limitation without changing the router.
- Some rail connections still fail the existing router’s clearance/path restrictions. R14 names their pins; the evaluator and tests reject undocumented floating result pins. Human drawings still have their own pre-existing floating pins.
- No dependency or lockfile change, generated-file hand edit, out-of-scope source change, commit, push, merge, rebase or branch switch occurred. Existing plan/review changes were left untouched. Private cases and derived artifacts remain in ignored `tmp/`; case ids occur only in this report outside `tmp/`.
