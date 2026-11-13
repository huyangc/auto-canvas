# T063 report — round 3

## Summary

Completed the inherited R30 series inference and guarded old-level fallback,
retained main's R152 branch candidate, and added reuse of identical routed
placements between the two level variants. The reuse is limited to one public
planning call and its Document/resolver pair, with at most 512 cached entries.
The finished calibrated-score and per-drawing diagnostic comparisons remain
intact. Search budgets and test timeouts are unchanged.

**Partial: round 3 finding 1 remains open.** Quality, corpus timing, all required
test suites, determinism, and large-document preservation pass. Held-out timing
fails the 1.3× limit: deadtime is **2.029500×** main and ltc3452 is **1.833406×**.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                              |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | R30 uses shared DC-channel inference for internal two-pin devices, retaining deterministic cycle breaking and the original Document's 40-instance bound. R152 remains a distinct stage candidate; it infers channels once on the full graph, preserving main's behavior in both fallback variants. |
| 2    | done    | Retained the prior dev investigation and unchanged group-row rules; its measured removal of grouping increased aggregate crossings. Details below.                                                                                                                                                 |
| 3    | partial | Fresh main comparison: paired median 0.990499×, aggregate p95 1.245980×, both within 1.3×. Both held-out timing ratios fail. Shared routing does not remove enough of their distinct search work.                                                                                                  |
| 4    | done    | Series branches, shared gates, all three placement strategies, ambiguous resistor loop, capacitor exclusion, original-document size bound, and finished fallback guards are covered. All required suites pass with unchanged timeouts.                                                             |
| 5    | done    | Updated R30/R151, evaluated all 628 drawings twice, and recorded dev/val quality and verticality against the new baseline.                                                                                                                                                                         |

## Review findings addressed

- **Round 1 finding 1 — fixed:** `selectSeriesLayout` compares complete plans
  after routing, facing, labels and drafting. It retains the old plan when the
  candidate has a higher calibrated score or adds any floating pin, missing
  connection or individual `VISUAL_*` count. Tests cover cheaper-but-unsafe
  candidates, score ties, higher scores, refused plans and terminal departure.
  The full corpus has zero per-drawing guard regressions against main.
- **Round 1 finding 2 — fixed:** the permitted T062 test rewrite compares
  crossings, bends and wire against the old-level plan and checks the selected
  branch members' level order. Its other assertions remain. It additionally
  checks that shared routing selects exactly the same complete result as
  independently planning both variants.
- **Round 3 finding 1 — partially addressed, still must-fix:** routed placements
  with identical routing options share results across variants. The existing
  preview/audit reuse scopes enclose both passes. Corpus timing passes, but the
  held-out timing table below fails; this finding is not closed.
- **Round 3 finding 2 — fixed:** quality uses
  `tmp/le10-t065r2/report.json`. A separately compiled `a6ae6a0` snapshot produces
  the same 628 plan hashes as that file. All required quality gates pass.
- **Round 3 finding 3 — fixed:** `pnpm test:local` and `pnpm test:slow` pass.
  No timeout was raised and no test was skipped, removed or weakened to pass.
  The reported skips are the existing suite skips.

## Acceptance results

Final code results (logs under `tmp/t063-r3/`):

```text
pnpm build → 0; editor build completed, existing bundle-size warnings.
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2034 files, 0 errors, 3296 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/auto-layout/test → 0;
  45 files passed, 673 tests passed; 34.01 s.
pnpm test:local → 0 (final run with local PostgreSQL/loopback access);
  786 files passed, 3 skipped; 8026 tests passed, 117 skipped; 103.89 s.
pnpm test:slow → 0;
  2 files passed, 14 tests passed; 99.28 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 evaluated, 627 completed, zero non-equivalent.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 (repeat) → 0;
  all 628 plan hashes and statuses match.
node tmp/t063-r3/main-eval.mjs tmp/le10-input --jobs 12 → 0;
  all 628 main plan hashes match the supplied T065 quality baseline.
node tmp/fixture-timing.mjs tmp/t063-r3/main held-out-cases.json → 0;
  deadtime 19390 ms; ltc3452 16117 ms.
node tmp/fixture-timing.mjs . held-out-cases.json → 0;
  deadtime 39352 ms; ltc3452 29549 ms; both timing thresholds FAIL.
node tmp/t063-r3/large.mjs → 0;
  all six large complete plans byte-identical to a6ae6a0.
node tmp/t063-r3/modes.mjs → 0;
  optimized/partition fixture plans change; no errors or partition fallback.
node tmp/t063-r3/verify.mjs → 0;
  zero baseline mismatches, repeat mismatches or per-drawing guard regressions.
node tmp/t063-r3/check-acceptance.mjs tmp/t063-r3/final.json tmp/t063-r3/acceptance.json → 1;
  only deadtime and ltc3452 timing ratios fail.
git diff --check → 0.
```

The first sandboxed `pnpm test:local` exited 1: 17 files failed, 60 tests failed,
7933 passed, 150 skipped, and two errors. Its output includes
`connect EPERM ::1:5432`, `connect EPERM 127.0.0.1:5432`,
`Server tests require reachable PostgreSQL at postgresql:///auto_canvas_test`,
and `listen EPERM: operation not permitted 127.0.0.1`. The approved local-access
rerun passed, and the final rerun after the last code correction also passed.
Evidence: `test-local.log`, `test-local-retry.log`, `test-local-final.log`.

## Investigation results

### Quality and guards

Baseline: `tmp/le10-t065r2/report.json`; result: `tmp/t063-r3/final.json`.
Validation was reported without using it to tune a rule.

| Metric               |    Dev main |    Dev T063 |    Val main |    Val T063 |
| -------------------- | ----------: | ----------: | ----------: | ----------: |
| Completed            |     439/439 |     439/439 |     188/189 |     188/189 |
| Crossings            |         279 |         275 |         127 |         125 |
| Bends                |       1,920 |       1,860 |         732 |         709 |
| Wire length          | 474,801.351 | 467,811.351 | 198,604.234 | 194,054.234 |
| Median area / human  |    1.442731 |    1.447722 |    1.405670 |    1.407807 |
| Vertical connections |   423/1,255 |   430/1,255 |     174/599 |     178/599 |
| Branch verticality   |    33.7052% |    34.2629% |    29.0484% |    29.7162% |
| Floating pins        |           8 |           8 |           2 |           2 |
| Missing connections  |          12 |          12 |           6 |           6 |

Crossings decrease and verticality increases on both splits. Bends and wire
improve. Median area rises 0.3460% dev and 0.1520% val, within the +2% limit.
There are 40 changed complete plans: 28 dev and 12 val. All 627 completed
results are electrically equivalent; `yje2n6eva2` remains the sole refusal.

| Visual diagnostic             | Main total | T063 total |
| ----------------------------- | ---------: | ---------: |
| `VISUAL_LABEL_CLEARANCE`      |        181 |        179 |
| `VISUAL_LABEL_RUN_ON`         |         35 |         30 |
| `VISUAL_TERMINAL_DEPARTURE`   |         85 |         83 |
| `VISUAL_WIRE_THROUGH_SYMBOL`  |         20 |         20 |
| `VISUAL_LABEL_OVERLAP`        |          5 |          5 |
| `VISUAL_LABEL_OWNER_DISTANCE` |          2 |          2 |

Every other `VISUAL_*` total remains zero. Stronger than the aggregate guard,
no completed drawing adds any floating pin, missing connection or individual
visual diagnostic relative to main. Evidence: `comparison.json`,
`verification.json`, `acceptance.json` in `tmp/t063-r3/`.

### Timing and the remaining finding

The main snapshot was extracted from `a6ae6a0` and compiled under ignored
`tmp/t063-r3/main/`; the working branch was never switched. Main and task
corpus runs, and the final held-out timing runs, ran sequentially without
other tests or builds from this task overlapping them.

| Timing gate            |         Main |          T063 |     Ratio | Limit | Result |
| ---------------------- | -----------: | ------------: | --------: | ----: | ------ |
| Corpus paired median   |            — |             — | 0.990499× |  1.3× | pass   |
| Corpus aggregate p95   | 8,532.392 ms | 10,631.190 ms | 1.245980× |  1.3× | pass   |
| deadtime, 30 instances |    19,390 ms |     39,352 ms | 2.029500× |  1.3× | fail   |
| ltc3452, 21 instances  |    16,117 ms |     29,549 ms | 1.833406× |  1.3× | fail   |

An earlier held-out measurement also failed (main 19,554/16,303 ms versus
39,499/29,468 ms). The final measurements therefore confirm the problem.
These are observed wall times, not a claim about intrinsic machine-independent
speed. The supplied historical corpus report is used for quality; the fresh
main run is used for the timing ratios above.

Sharing exact routed placements preserves independent search decisions and
budgets, but is insufficient on these held-out drawings. Their topology
actually gains inferred internal channels (two in deadtime, five in ltc3452),
so eligibility alone cannot eliminate the second search. Skipping the old
plan just because a new result has zero visual guards would not establish
that its finished calibrated score is no higher than the old result. A further
reuse optimization remains necessary; no such shortcut or budget reduction
was applied in this round.

### Group rows, determinism and scope boundaries

The earlier dev group-row investigation remains the basis for leaving
R31–R33 unchanged. It found 18 affected drawings; removing grouping reduced
raw crossings for `dr4e8zhyjg` from 6 to 4 but increased their aggregate from
66 to 68 (`m6rez5w83z`: 2 to 8; `y2qecpr77m`: 10 to 16). This was a raw
placement/routing probe, not a finished-portfolio comparison or proof of a
safe row-only rule. No general change with measured net benefit was established.
These are retained prior-round findings, not a new round 3 measurement:
`tmp/t063/dev-diagnosis.json`, `tmp/t063/diagnosis.json`,
`tmp/t063/group-probe.json`. This round changes fallback/reuse, not group rows.

Both complete 628-drawing runs have identical plan hashes and statuses,
including the refusal. The six large Documents (50, 50, 51, 103, 70 and 94
instances) have byte-identical complete JSON-serialized plans against main.
Evidence: `tmp/t063-r3/verification.json` and `tmp/t063-r3/large.json`.

Optimized and partition modes retain their pipelines. Their quick placements
can change through R30: the two-branch fixture produces different complete
plans in both modes, without errors or partition fallback. Their existing
suite tests pass. Evidence: `tmp/t063-r3/modes.json`.

## Deviations and open questions

- Round 3 is **partial**, because the held-out timing must-fix remains open.
  All other measured acceptance requirements pass. The evaluator's exit 0
  does not override the stricter timing checker, which exits 1.
- R151 is extended in place. R152 is retained and preserves its original
  full-graph inference; it is not replaced by a second inference inside each
  stage.
- No dependency/lockfile changes, generated-file edits, provider API calls,
  commits, pushes, merges, rebases or branch switches. `plan.md` and `review.md`
  were left as received; the plan modification was already present at entry.
- Third-party inputs, main snapshot, comparison scripts, reports and logs stay
  under ignored `tmp/`. No product-code changes were made after observing the
  final dev/val evaluation.
