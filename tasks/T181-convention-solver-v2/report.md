# T181 report — round 2

## Summary

The R97, R147, and R156 tests now exercise their intended paths with R168
eligibility disabled for those fixtures. The four-resistor partition test
verifies the unpartitioned T181 layout before checking its updated plan hash.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Round 1 added visible-pin filtering, directed-block constraints and flow cost, and expanded eligibility. |
| 2 | done | Round 1 pre-indexed pins, boxes, and objective terms for flat incremental scoring and candidate filtering. |
| 3 | done | Round 1 added bounded crossing-aware relocation and compatible unit swaps. |
| 4 | done | Round 1 enabled guarded finished-stage competition for convention drafts. |
| 5 | done | Kept the solver regressions and addressed the review's four affected test files. |
| 6 | done | The Round 1 R168 specification reflects the solver and selection changes. |
| 7 | done | Both six-worker evaluations produced fresh reports, and the strict gate passed. All case statuses and available plan hashes match Round 1. |

## Review findings addressed

- `compact.test.ts` disables R168 eligibility for the R97 strict-decrease and
  repeatability test and restores the spy in `finally`.
- `device-relocation-search.test.ts` applies the same isolation to the R147
  feedback-row movement test and restores the spy in `finally`.
- `local-loop-amplifier.test.ts` disables R168 in both regulator finalist
  tests and restores the spies in `finally`. The existing selection, score,
  and budget assertions still run.
- `partition.test.ts` previews the four-resistor plan and checks that all
  instances are placed, the terminal partition is preserved, and there are
  no diagnostics, missing connections, floating pins, or unsafe routes.
  A focused run reached the old hash assertion after all of these checks
  passed. The test now pins the observed T181 SHA-256
  `8ae10651b1d0af4260f1005c64f5c6138a9c1648b1ad2c53df3582f5c841a5ac`.

## Acceptance results

```text
pnpm build → 0. Packages and editor built with Vite warnings.
pnpm typecheck → 0. TypeScript completed.
pnpm lint → 0. 2,200 files, 0 errors, 3,971 warnings.
pnpm format:check → 0. All matched files use Prettier code style.
pnpm docs:check → 0. Validated local Markdown links in 75 files.
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0 with VITEST_MAX_WORKERS=3. 1,245 passed in 91 files.
pnpm test:slow → 0. 8 passed in 2 files.
mkdir -p tmp/t181 → 0.
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t181/netlist --jobs 6 → 514/515 completed. The evaluator's exit check passed on the fresh report.
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t181/drawing --jobs 6 → 612/628 completed. The evaluator's exit check passed on the fresh report.
node -e '<strict gate from plan.md>' → 0. Zero throws, lost completions, or integrity failures in either corpus.
```

The strict gate verified matching case sets, valid plan hashes, electrical
equivalence, zero missing connections, zero floating pins, zero unsafe routes,
and zero introduced ERC defects for all completed cases. The fresh evaluations
matched Round 1 on case status and available plan hashes for all 515 netlist
and all 628 drawing cases.

| Metric | Netlist T180 → T181 | Drawing T180 → T181 |
| --- | ---: | ---: |
| Completed | 514/515 → 514/515 | 612/628 → 612/628 |
| Changed plan hashes | 76 | 97 |
| Crossings | 293 → 273 (−20) | 312 → 297 (−15) |
| Bends | 2,003 → 1,851 (−152) | 2,047 → 1,927 (−120) |
| Wire length | 469,048 → 455,268 (−13,780) | 524,683 → 510,928 (−13,755) |
| Broken stacks | 221/761 → 214/761 (−7) | 228/890 → 225/890 (−3) |
| Pin jogs | 253 → 256 (+3) | 299 → 291 (−8) |
| `convEligible` | 225 → 358 (+133) | 277 → 448 (+171) |
| `convSelected` | 32 → 81 (+49) | 95 → 188 (+93) |
| Summed per-case planning time | 3,673 → 5,211 s (+1,538 s) | 2,276 → 3,287 s (+1,011 s) |
| Median / p95 planning time | 3.315 / 24.992 → 4.893 / 36.938 s | 2.107 / 11.428 → 3.262 / 16.768 s |
| Approximate corpus elapsed time | 1,458 → 1,044 s | 1,074 → 817 s |

The quality totals use cases completed in both versions. The strict gate
reads `result.pinJogs.jogs`, which yields zero in both reports. The table uses
`result.pinJogs.count`, the count field emitted by the evaluator. T180 used
three workers per corpus. T181 used six per corpus and ran the two corpora
concurrently, with Vitest active for part of the run. The elapsed times use
the start and report-write timestamps and reflect different worker contention.

The non-sealed cases with the largest crossing changes are listed below.
Bend changes break ties. Deltas are T181 minus T180.

| Corpus | Case | Crossings | Bends | Wire length | Broken stacks | Pin jogs |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Netlist | `6r2q6deeq9` | −5 | −4 | −470 | 0 | 0 |
| Netlist | `wsgc5ae43p` | −4 | −26 | −2,720 | 0 | −1 |
| Netlist | `ecyqst76jd` | −4 | −10 | −1,190 | −1 | 0 |
| Netlist | `8w2ra7hdrw` | +1 | +8 | +10 | 0 | 0 |
| Netlist | `3cr8ap2k4c` | +1 | +5 | +880 | +1 | 0 |
| Drawing | `wsgc5ae43p` | −2 | −17 | −2,360 | 0 | 0 |
| Drawing | `zbq2cgqygw` | −2 | −5 | −190 | 0 | −1 |
| Drawing | `6xrx9wwkh9` | −2 | −4 | −30 | 0 | 0 |
| Drawing | `sahr77a4gy` | +1 | +2 | +120 | +1 | −1 |
| Drawing | `fxpjxwtwgq` | +1 | −2 | −410 | 0 | −1 |

## Investigation results

- Round 1 measured the solver on the 11 open drawing cases named in the plan.
  Median solve time fell from 443.0 ms to 54.6 ms (8.1×). The summed time fell
  from 5.01 s to 0.64 s. Both measurements used one warmup per case and ran
  while corpus work was active.
- The swap regression brings estimated crossings from two to zero at the
  same estimated wire length. Reversing instance order produces the same
  draft and evaluation count.
- The `mirrorLoad()` regression exercises finished comparison with an
  eligible convention draft. The layered layout retains its plan hash, and
  the primary annealing and reroute portfolios exclude convention drafts.

## Deviations and open questions

The first full Vitest run passed all four review files and timed out in five
other cases (one above-device-limit test, three differential output-placement
variants, and the two-inverter R22 test) while build and evaluation jobs were
active. The three-worker rerun passed the full suite with the existing timeouts.

The review allowed reuse of the Round 1 corpus reports. Both corpus commands
were rerun to satisfy the implementation brief's request to execute all plan
acceptance commands. Round 2 changed tests and this report.

The timing wrapper exited with `zsh:3: read-only variable: status` after
each evaluator completed and wrote its final output marker. This masked
the direct exit codes. The evaluator's final exit-check expression was
rerun against both fresh reports and passed. The plan's strict gate also
exited zero on those reports.
