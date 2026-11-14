# T074 report — round 3

## Summary

Fixed the remaining port-seat contract failure. R146's finalist compaction
moved hosts after generating a seat, making that seat stale. R146 now
regenerates candidates from the finished geometry, excluding the incumbent,
and rejects any trial that invalidates its own seat or a seat selected earlier
in the pass. The original corpus assertion is unchanged and passes.

Updated the two review-authorized tests: R72 prioritizes physical completeness
above soft score while retaining equal-completeness rejection; the V2
partition snapshot records the lower-scoring arrangement. The latest review's
accepted owner-distance increase is reflected in the spec and reported below.

Retained **W = 30000**, selected on dev and accepted in round-2 review.
Final readability improves **24.79% on dev and 24.61% on val**.
All 628 drawings complete and remain equivalent; floating/missing totals match
main (dev 6/4, val 0/0). Every weighted metric and corpus guard passes under
the review's accepted exceptions. All acceptance commands pass.

**Status: done.**

## Steps

| Step | Status | Notes                                                                                                                                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained shared memoized frozen readability term at complete-candidate comparisons through 40 instances.                                                    |
| 2    | done   | Retained review-accepted dev calibration over W=0, 3000, 10000, 30000, 60000. Ran fresh dev-only verification before full evaluation; no validation tuning. |
| 3    | done   | Retained completeness-first selection and hard guards. Added finished port-seat membership validation. Final corpus guards reported below.                  |
| 4    | done   | Retained accepted dev ablations: remove mirrored drafts and small-layout offConvention proxy; keep conventional port candidates.                            |
| 5    | done   | Original port-seat corpus regression passes; authorized R72 and partition tests updated; full local and slow results below.                                 |
| 6    | done   | Updated R146 spec; reran all 628, comparison-page replay, determinism, six large plans and held-out timing.                                                 |

## Review findings addressed

1. **Must-fix #1 — final port seat.** Reproduced with
   `pnpm exec vitest run packages/auto-layout/test/corpus.test.ts -t 'two-inverters'`:
   expected generated seats to contain `{240,20}`, but the corresponding seat
   was `{240,10}`. The existing nine-instance fixture supplies a fast
   public-planner regression, so diagnosis narrowed the test invocation without
   modifying the reviewer-required fixture or assertion. Temporary stage tracing localized the defect to R146's
   replan/finishing callback, not label repair or later gap closing. A proposed
   port at `{290,20}` was generated before compaction; finishing moved the
   device columns and shortened the device-row separation from 100 to 90,
   producing a stale port at `{250,20}`. A later whole-layout translation
   yielded the reported `{240,20}`. The final geometry is now checked using
   `portSeatCandidates(..., false, false)`, so the incumbent cannot validate
   itself. Earlier R146 selections are checked too. The existing corpus and
   port-seat suites pass (32 tests); no corpus assertion or fixture changed.
   All temporary source instrumentation was removed.
2. **Authorized #2 — R72.** Parameterized the expensive-detour case over
   improved and equal completeness. It asserts the actual floating-plus-missing
   counts and the higher routed score in both cases, then requires acceptance
   only for improved completeness. Both cases pass.
3. **Authorized #3 — V2 snapshot.** Updated only the expected hash to
   `4c227341fb473f10a85c1d4023ea7ac8f40463b565a86d6a96192340e7c21529`.
   Main's template refinement chooses unmirrored `c`; T074 retains the template
   candidate with `c` vertically mirrored and different offsets: a/b move from
   x=20/100 to 40/110, c/d from x=40/120 to 20/100. Both retain y=10/210 block
   levels. Under the current objective the score falls **521.97691 → 512.29221**,
   frozen composite **0.00566590 → 0.00527641**; crossings/bends remain 0/3,
   floating/missing remain 0/0, wire increases 520→540. Bounds, membership,
   equivalence and deterministic replay assertions remain unchanged and pass.
   [Partition evidence](../../tmp/t074-r3/partition.json).
4. **Accepted #4 — owner distance.** Reported below under the review's accepted
   +1 allowance; it is not treated as an unresolved failure.

The earlier rounds' completeness, drafting-caption and R150 fixes remain in
place. Their unchanged tests pass in the full local suite. The two-inverters
fixture now has **zero crossings, zero bends and zero floating/missing**;
composite is **0.00960320** versus main **0.02898537** (round 2: 0.02685810).
The previously authorized bend ceiling is unchanged in this round.
[Fixture evidence](../../tmp/t074-r3/fixture.json).

## Acceptance results

```text
pnpm build → 0; all packages/apps built; Vite chunk-size warning only.
pnpm typecheck → 0.
pnpm lint → 0; 2056 files, 0 errors, 3428 warnings.
pnpm format:check → 0; all matched files formatted.
pnpm test:local → 0; 793 files passed, 3 skipped;
  8109 tests passed, 117 skipped (8226 total), 144.89 s.
pnpm test:slow → 0; 7 tests passed in 1 file, 73.26 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628/628 completed, 0 non-equivalent; every metric/guard gate passes.
```

The initial sandbox local-suite run was interrupted after confirming
`connect EPERM` on localhost PostgreSQL; the focused socket repro exited 1.
The complete suite was rerun with approved local socket/database access and
passed. No test timeout was raised or changed. Evidence:
[command records](../../tmp/t074-r3/checks.json),
[local log](../../tmp/t074-r3/logs/test-local.log),
[slow log](../../tmp/t074-r3/logs/test-slow.log),
[final evaluator report](../../tmp/t074-r3/result.json).

## Investigation results

### Objective and calibration

The frozen metric definitions and fitted weights remain unchanged. Readability
is memoized per final document and resolver; cheap unrouted proposals do not
compute it. Complete routed annealing trials do. Physical completeness precedes
soft scores, with equal-completeness annealing exploration still permitted.
Above 40 instances the legacy selection path remains in effect.

The calibration below is the review-accepted round-2 sweep, retained rather
than retuned against validation. Round 3 changes a feasibility guard, not W or
the evaluation function. All 439 fresh dev plan hashes match the accepted
round-2 W=30000 run, with composite 71.72259890782419 and no gate failures.
Fresh dev-only verification is recorded in
[dev.json](../../tmp/t074-r3/dev.json); final mixed-corpus hashes are compared
against it to check independence from the rest of the corpus.

### Accepted round-2 development weight sweep

Review accepted this dev-only calibration. Round 3 retains W=30000 and separately reruns dev and the full corpus after the seat-membership fix. Timing below is from round 2 with 12 evaluator workers.

| W     | Composite | Crossings | Bends |      Wire | Area (grid²) | Median / p95 ms |
| ----- | --------: | --------: | ----: | --------: | -----------: | --------------: |
| 0     |  97.83857 |       231 |  1698 | 398538.68 |    663334.41 | 1620.9 / 8542.6 |
| 3000  |  78.38701 |       230 |  1836 | 408066.12 |    632944.95 | 1808.5 / 9838.5 |
| 10000 |  72.91995 |       248 |  1873 | 411950.12 |    611514.71 | 1836.7 / 9753.1 |
| 30000 |  71.72260 |       257 |  1986 | 420670.12 |    611047.02 | 1842.6 / 9566.6 |
| 60000 |  71.79643 |       265 |  2039 | 424790.12 |    607997.30 | 1829.6 / 9685.6 |

Weighted contributions (sum equals composite):

| Metric             |      W=0 |   W=3000 |  W=10000 |  W=30000 |  W=60000 |
| ------------------ | -------: | -------: | -------: | -------: | -------: |
| area               | 12.46348 | 11.89248 | 11.48983 | 11.48104 | 11.42374 |
| avoidableJogs      |  5.16710 |  1.40921 |  0.46974 |  0.23487 |  0.23487 |
| blockedJoins       |  0.16015 |  0.16015 |  0.16015 |  0.16015 |  0.16015 |
| controlSeparation  |  1.67106 |  1.57276 |  1.52361 |  1.37616 |  1.47446 |
| crossings          | 25.06942 | 24.96090 | 26.91436 | 27.89109 | 28.75929 |
| labelOverlaps      |  0.00134 |  0.00134 |  0.00134 |  0.00401 |  0.00535 |
| portOrder          | 28.24233 | 18.23520 | 14.45474 | 12.89807 | 12.34212 |
| railCrossings      |  6.04929 |  6.41592 |  4.94942 |  4.58280 |  3.84955 |
| sourcePolarity     |  6.97493 |  2.05145 |  1.64116 |  1.23087 |  1.23087 |
| terminalDepartures |  0.60373 |  0.60373 |  0.58360 |  0.60373 |  0.70435 |
| unownedDrafting    | 11.43575 | 11.08388 | 10.73201 | 11.25981 | 11.61168 |

Development gate failures for each W:

- W=0: composite reduction <8%; portOrder >+5%; sourcePolarity >+5%.
- W=3000: none.
- W=10000: none.
- W=30000: none.
- W=60000: terminalDepartures >+5%; VISUAL_TERMINAL_DEPARTURE 31→35.

### Final composite and every nonzero weighted metric

| Metric             |      Dev main → T074 (change) |      Val main → T074 (change) |
| ------------------ | ----------------------------: | ----------------------------: |
| composite          | 95.36321 → 71.72260 (-24.79%) | 48.58123 → 36.62331 (-24.61%) |
| area               |  12.45402 → 11.48104 (-7.81%) |    8.09731 → 7.42547 (-8.30%) |
| avoidableJogs      |   4.93224 → 0.23487 (-95.24%) |   0.70461 → 0.23487 (-66.67%) |
| blockedJoins       |    0.16015 → 0.16015 (+0.00%) |  0.08007 → 0.00000 (-100.00%) |
| controlSeparation  |   1.76935 → 1.37616 (-22.22%) |   0.24574 → 0.14745 (-40.00%) |
| crossings          |  27.89109 → 27.89109 (+0.00%) |  16.49590 → 16.27885 (-1.32%) |
| labelOverlaps      |   0.00669 → 0.00401 (-40.00%) |        0.00000 → 0.00000 (0%) |
| portOrder          | 21.45972 → 12.89807 (-39.90%) |  11.23022 → 5.89308 (-47.52%) |
| railCrossings      |   8.06573 → 4.58280 (-43.18%) |   5.68267 → 2.74968 (-51.61%) |
| sourcePolarity     |   6.56464 → 1.23087 (-81.25%) |   1.64116 → 0.41029 (-75.00%) |
| terminalDepartures |    0.62385 → 0.60373 (-3.23%) |   0.18112 → 0.14087 (-22.22%) |
| unownedDrafting    |  11.43575 → 11.25981 (-1.54%) |   4.22243 → 3.34276 (-20.83%) |

Zero-weight metrics (weighted contribution remains zero on both splits): backwardFlow, bends, detour, labelClearance, labelOwnerDistance, narrowBands, potentialOrder, railMarkerOrder, signalSeriesVertical, structureIntrusion, symmetryLevel, symmetryMirror, symmetryOrientation, transistorOrientation, wireThroughSymbols.

### Final guards

| Guard                            | Dev main → T074 | Val main → T074 |
| -------------------------------- | --------------: | --------------: |
| completed                        |       439 → 439 |       189 → 189 |
| nonEquivalent                    |           0 → 0 |           0 → 0 |
| floatingPins                     |           6 → 6 |           0 → 0 |
| missingConnections               |           4 → 4 |           0 → 0 |
| VISUAL_AMBIGUOUS_JUNCTION        |           0 → 0 |           0 → 0 |
| VISUAL_CONSTRAINT_VIOLATION      |           0 → 0 |           0 → 0 |
| VISUAL_LABEL_CLEARANCE           |       134 → 188 |         59 → 80 |
| VISUAL_LABEL_OVERLAP             |           5 → 3 |           0 → 0 |
| VISUAL_LABEL_OWNER_DISTANCE      |           0 → 0 |           1 → 2 |
| VISUAL_LABEL_RUN_ON              |         26 → 21 |         12 → 10 |
| VISUAL_OUTSIDE_PAGE              |           0 → 0 |           0 → 0 |
| VISUAL_ROUTE_OVERLAP             |           0 → 0 |           0 → 0 |
| VISUAL_SHORT_SEGMENT             |           0 → 0 |           0 → 0 |
| VISUAL_SYMBOL_OVERLAP            |           0 → 0 |           0 → 0 |
| VISUAL_TERMINAL_DEPARTURE        |         31 → 30 |           9 → 7 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE |           0 → 0 |           1 → 1 |
| VISUAL_UNPLACED_INSTANCE         |           0 → 0 |           0 → 0 |
| VISUAL_UNRESOLVED_SYMBOL         |           0 → 0 |           0 → 0 |
| VISUAL_WIRE_THROUGH_SYMBOL       |           6 → 4 |           2 → 1 |

Only validation case `kmpa4qk7k9` changes from round 2: composite
0.13256745→0.13385477, crossings 0→1, bends remain 3, wire 860→1100,
floating/missing remain 0/0. Main composite is 0.70289912. This is the cost
of rejecting a finished seat outside the generated set, and is reported
without validation-based retuning. The other 627 plan hashes match round 2.

Label clearance has zero readability weight and is reported without a gate,
per review. The latest review accepts the single validation owner-distance
increase for `s78j9fyzha`. Other visual totals remain subject to the original
non-increase gate.

### Geometry and human comparison

| Metric     |       Dev main → T074 |       Val main → T074 |
| ---------- | --------------------: | --------------------: |
| crossings  |       257.00 → 257.00 |       152.00 → 150.00 |
| bends      |     1771.00 → 1986.00 |       734.00 → 835.00 |
| wireLength | 406472.68 → 420670.12 | 182588.56 → 184105.99 |

The composite is 1.493× human on dev, 1.357× human on val. The broader within-20%-of-human goal is not yet met.

### Visual review and determinism

[Human | main 789d513 | T074 comparison page](../../tmp/t074-r3/review.html)
contains the 25 fixed samples, the ten largest reductions and five largest
increases, regenerated from the final code. The main implementation is the
read-only round-1 archive; no branch was switched.

37 unique drawings: main hashes match 37/37, current hashes match 37/37, deterministic repeated plans 37/37. [Replay evidence](../../tmp/t074-r3/review-verification.json).

Dev-only versus mixed-corpus plan hashes match 439/439.

Inspected all ten newly rendered sheets (`review-1.png` through `review-10.png`),
covering all 37 drawings, plus the separate view of the one changed validation
case. The page fits its 1800-pixel viewport without horizontal overflow.

- Clear local gains include `jjm94e9cp8` (crossings 2→1, bends 9→4),
  `7nmbghagg3` (1→0, 6→3), `x7evbngj49` (crossings 6→2), and `c3qbntbj56`
  (4→0). The latter two remove several enclosing routes, although their
  arrangements still differ substantially from the human structures.
- `rgyv3sw7qe` replaces main's long single row with a more compact arrangement.
  `zbq2cgqygw` improves input/output ordering while adding one crossing.
- Lower composites do not guarantee a convincing drawing: `8nfxbjkaa5` adds
  a rectangular detour, `jhratny58g` folds the capacitor route, `fsd5zg82be`
  leaves its LDO drafting detached, and `yje2n6eva2` retains dense routing
  and detached drafting. `xr9crqb93w` still separates explanatory content
  from the electrical arrangement.
- All five largest composite increases remain visibly problematic:
  `r4dp7mhqar` adds crossings 1→7; `2bqpr5kx5c` adds 2→5;
  `bv9zwmd835` adds 0→1 and changes input ordering; `7qbprrj7bn` leaves W/L
  annotations far above devices; `ean7z7acmp` becomes crowded, with bends 2→13.
- The only round-3 changed case, `kmpa4qk7k9`, is narrower but routes an input
  across the core. Its lower score versus main is a measurable tradeoff, not
  a claim that it matches the human arrangement. See the
  [separate comparison](../../tmp/t074-r3/changed-review.html).
- Several fixed samples remain unchanged, including `x387bqtwkq`,
  `atrwhd4c55`, `n6f5agek33`, `2effzpvkdq` and `zp3r9haqg7`.

### Held-out timing and large plans

Three alternating main/current pairs per held-out drawing, without deadlines,
after other CPU-heavy checks and evaluation completed.

| Drawing          | Main median ms | T074 median ms |  Ratio |
| ---------------- | -------------: | -------------: | -----: |
| fd-two-stage     |         4059.9 |         1718.5 | 0.423× |
| common-source-ac |          805.8 |          847.4 | 1.052× |
| skew             |         1811.4 |         1975.9 | 1.091× |
| deadtime         |        18307.5 |        11450.7 | 0.625× |
| ota-sky130       |          723.0 |          721.0 | 0.997× |
| widlar           |         3867.7 |         4329.2 | 1.119× |
| ltc3452          |        15144.6 |        14526.0 | 0.959× |

Repeated plans match 13/13; large plans byte-identical to main 6/6. Timing passes 7/7, maximum ratio 1.119×. [Raw evidence](../../tmp/t074-r3/verification.json).

Large cases: `38m8wdesbh.json` (50 instances), `4fb59zv76m.json` (50 instances), `8b2n3zf9vj.json` (51 instances), `b9afqhsjzv.json` (103 instances), `g47e465db5.json` (70 instances), `sm663cbs8b.json` (94 instances).

## Deviations and open questions

- The accepted round-2 calibration and round-1 T073 mechanism ablations are
  retained. Fresh dev and full-corpus verification measure this round's guard
  fix; no weight or behavior was tuned using validation.
- The broader within-20%-of-human goal remains unmet, despite satisfying this
  task's relative-improvement gates. Some individual layouts worsen; the
  requested comparison page includes the largest regressions.
- Product changes stay within owned paths. Temporary scripts and evidence are
  under `tmp/t074-r3/`. Frozen metrics/weights, evaluator, other packages,
  dependencies/lockfile, generated sources, plan and review are unchanged.
  No provider API call, commit, push, merge, rebase or branch switch occurred.
