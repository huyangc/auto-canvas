# T076 report — round 1

## Summary

Implemented U1 and U2. Fixed ink that blocks placement reuse now retains the
R10-shifted base placements while owned drafting groups still follow and seat
under the existing guards. A group owned by a terminal-less Net now uses the
nearest visible source instance's bounds-centre displacement, with distance
ties resolved by instance id. Ownership inference and frozen metrics/weights
are unchanged.

**Status: partial.** All seven acceptance commands exit 0, and all 628 drawings
remain equivalent. Unowned drafting falls **45.31% on dev** and **26.32% on val**;
readability composite falls **7.11% / 2.47%**. However, the separate metric gates
fail: bends increase by two on each split, and validation rail crossings
increase 15→16 (+6.67%). These failures are not waived.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                   |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | R150 fixed-ink branch calls `followDraftingGroups(document, resolver, base, base, ownedGroups)`. Keeps searched placements and R10 shift; fixed/unowned ink remains unchanged.                                                                                          |
| 2    | done    | Pinless route/junction owners use the nearest visible source instance by group-to-instance bounds distance, ties by id; refuse if no source instance or no visible final counterpart. No mutation of inferred owners.                                                   |
| 3    | done    | Six new regression cases cover fixed-ink following, pinless-wire following, deterministic ties/refusals, and object/layout-group/constraint locks. Existing pinless-junction expectation now checks the newly specified displacement. All 18 drafting-group tests pass. |
| 4    | partial | Updated R150; evaluated all 628; created and visually inspected the comparison page. Equivalence, replay and large-plan checks pass. Metric gates above remain unmet; held-out timing is recorded below.                                                                |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

```text
pnpm build → 0; all package/app builds completed; Vite chunk-size warning only.
pnpm typecheck → 0.
pnpm lint → 0; 2056 files, 0 errors, 3428 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 0; 793 files passed, 3 skipped;
  8115 tests passed, 117 skipped (8232 total); 202.53 s.
pnpm test:slow → 0; 7 tests passed in 1 file; 69.81 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628/628 completed and equivalent; separate comparison gates fail as below.
node tmp/t076-r1/compare.mjs → 1; dev bends, val railCrossings >2%, val bends.
```

No timeout was raised or changed. A preliminary local-socket probe returned
`EPERM`; the complete local suite ran with approved localhost/test-database
access and passed. Early focused-test fixture schema errors were corrected
before the final checks. The existing pinless-junction test's stationary-ink
assertion was replaced with an exact nearest-device displacement assertion,
as required by U2; its caption-following and deterministic-replay checks remain.
No test was removed or skipped to obtain a pass.

Logs: [build](../../tmp/t076-r1/logs/build.log),
[typecheck](../../tmp/t076-r1/logs/typecheck.log),
[lint](../../tmp/t076-r1/logs/lint.log),
[format](../../tmp/t076-r1/logs/format.log),
[local tests](../../tmp/t076-r1/logs/test-local.log),
[slow tests](../../tmp/t076-r1/logs/test-slow.log),
[focused tests](../../tmp/t076-r1/logs/focused.log),
[evaluator](../../tmp/t076-r1/logs/eval.log).

## Investigation results

### Corpus comparison

Compared against the supplied `tmp/main-01fd2ad-report.json`. No tuning was
performed on validation. The unchanged base build was copied to
`tmp/t076-r1/main/` before source edits; HEAD differs from `01fd2ad` only by
the task plan. No branch switch or generated-file hand edit was used.

The table lists raw totals for every nonzero-weight readability metric, plus
the frozen composite. [Full comparison](../../tmp/t076-r1/comparison.json),
[628-case evaluator report](../../tmp/auto-layout-eval/report.json),
[excess breakdown](../../tmp/t076-r1/excess.txt).

| Metric             |             Dev main → T076 |             Val main → T076 |
| ------------------ | --------------------------: | --------------------------: |
| area               | 611047.01859 → 611011.37154 | 395200.57870 → 395851.58568 |
| avoidableJogs      |                       1 → 1 |                       1 → 1 |
| blockedJoins       |                       4 → 4 |                       0 → 0 |
| controlSeparation  |                     28 → 28 |                       3 → 3 |
| crossings          |                   257 → 257 |                   150 → 149 |
| labelOverlaps      |                       3 → 3 |                       0 → 0 |
| portOrder          |                   116 → 116 |                     53 → 52 |
| railCrossings      |                     25 → 25 |                     15 → 16 |
| sourcePolarity     |                       3 → 3 |                       1 → 1 |
| terminalDepartures |                     30 → 30 |                       7 → 7 |
| unownedDrafting    |                     64 → 35 |                     19 → 14 |
| composite          |         71.72260 → 66.61983 |         36.62331 → 35.71947 |

All other weighted metrics stay within +2%. The final composite is 1.387×
human on dev and 1.323× on val, so the broader within-20%-of-human goal is
still unmet. Nineteen plan hashes change: seventeen drawings improve their
composite and two retain the same composite; no drawing's composite worsens.
The other 609 plan hashes match main.

| Guard                            | Dev main → T076 | Val main → T076 |
| -------------------------------- | --------------: | --------------: |
| crossings                        |       257 → 257 |       150 → 149 |
| bends                            |     1986 → 1988 |       835 → 837 |
| floatingPins                     |           6 → 6 |           0 → 0 |
| missingConnections               |           4 → 4 |           0 → 0 |
| VISUAL_AMBIGUOUS_JUNCTION        |           0 → 0 |           0 → 0 |
| VISUAL_CONSTRAINT_VIOLATION      |           0 → 0 |           0 → 0 |
| VISUAL_LABEL_CLEARANCE           |       188 → 188 |         80 → 79 |
| VISUAL_LABEL_OVERLAP             |           3 → 3 |           0 → 0 |
| VISUAL_LABEL_OWNER_DISTANCE      |           0 → 0 |           2 → 2 |
| VISUAL_LABEL_RUN_ON              |         21 → 21 |         10 → 10 |
| VISUAL_OUTSIDE_PAGE              |           0 → 0 |           0 → 0 |
| VISUAL_ROUTE_OVERLAP             |           0 → 0 |           0 → 0 |
| VISUAL_SHORT_SEGMENT             |           0 → 0 |           0 → 0 |
| VISUAL_SYMBOL_OVERLAP            |           0 → 0 |           0 → 0 |
| VISUAL_TERMINAL_DEPARTURE        |         30 → 30 |           7 → 7 |
| VISUAL_TERMINAL_ON_FOREIGN_ROUTE |           0 → 0 |           1 → 1 |
| VISUAL_UNPLACED_INSTANCE         |           0 → 0 |           0 → 0 |
| VISUAL_UNRESOLVED_SYMBOL         |           0 → 0 |           0 → 0 |
| VISUAL_WIRE_THROUGH_SYMBOL       |           4 → 4 |           1 → 1 |

All `VISUAL_*` totals meet their gates. Floating pins and missing connections
are unchanged; crossings are unchanged on dev and decrease by one on val.

### Unmet gates

- **`h8m97x36dw` (dev):** unowned 3→1, bends 2→4, wire 380→520,
  crossings unchanged. Composite decreases by 0.35253888. This accounts for
  the entire dev bend increase (1986→1988).
- **`pd8crnm97d` (val):** unowned 2→1, bends 9→11, rail crossings 1→2,
  total crossings 3→2, wire 1810→2240. Composite decreases by 0.20010666.
  This accounts for the entire val bend increase (835→837) and the weighted
  rail-crossing gate failure (15→16).

U2 makes previously refused joint drafting candidates feasible. The existing
R150 policy can accept their changed electrical geometry when the frozen
readability composite improves, including additional bends. The plan asks
for U1/U2 under those existing guards while imposing stricter aggregate
acceptance gates. I retained that specified policy and recorded the failures
instead of introducing an unplanned candidate-selection rule or tuning on
validation. Resolving these gates needs a reviewed change to that policy.

### Visual review and determinism

[Human | main 01fd2ad | T076 page](../../tmp/t076-r1/review.html) contains the
12 largest unowned-count reductions (ties by id), the required
`75k4jskamd`, `qj62dz4qvm`, `nqksde5dtj`, and the additional validation gate
failure `pd8crnm97d`: **14 unique drawings**. Inspected all seven rendered
sheets (`tmp/t076-r1/review-1.png` through `review-7.png`). No horizontal
page overflow at 1800 pixels.

- `nqksde5dtj` improves 8→2: voltage/port annotations return near the circuit,
  but several current arrows remain detached. It still does not reproduce
  the human two-rail arrangement.
- `e5t32hnn2g` improves 5→2: capacitor/output captions return near the
  components; the two subfigure labels remain remote.
- `qj62dz4qvm` improves 15→12, but remains a fragmented block diagram with
  many absent drawn links and displaced labels. The metric gain is modest
  and does not restore the human diagram's structure.
- `jhpfmtx5ay`, `m3ek9hty4p`, `p2whdap25e`, and `qmcytns39z` bring arrows,
  output labels or formulas closer to the circuitry. Some annotation text
  remains separated from its arrow; geometric proximity is not proof of
  semantic correctness.
- `jkbdeaz3fr`, `qk9r4bb46n`, and `7m8apb7wyx` reduce detached ink while
  retaining conspicuous differences from the human drawing. In particular,
  the input arrows and active-circuit box are not restored to authored links.
- `nmcsrad5qg` moves two labels closer to the circuit; much of the remote
  timing annotation remains disconnected.
- `h8m97x36dw` brings annotations closer but introduces rectangular detours;
  `pd8crnm97d` moves the CMFB box beside a wider layout with additional bends
  and a rail crossing. Both gate failures are visible in the page.
- `75k4jskamd` is byte-identical to main.

Replayed all **19 changed drawings plus `75k4jskamd`**: base hashes match
20/20, current hashes match 20/20, repeated current plans match 20/20.
[Replay evidence](../../tmp/t076-r1/review-verification.json).

### Six large documents

All six plans are **byte-identical to main and deterministic**: `38m8wdesbh`
(50 instances), `4fb59zv76m` (50), `8b2n3zf9vj` (51), `b9afqhsjzv` (103),
`g47e465db5` (70), `sm663cbs8b` (94). These separate fixtures were read from
`/Users/huzhifeng/workspace/auto-canvas-cases/human/cases/`; they are not part
of the 628-case input directory. No large drawing changes, so no additional
large-drawing visual comparison is needed.
[Large-plan evidence](../../tmp/t076-r1/large.json).

### Held-out timing

Five alternating main/current pairs per held-out fixture, without deadlines,
after all other CPU-heavy verification finished. All seven pass the +10%
limit; the maximum median ratio is **1.018×**. Every repeated plan is
deterministic, and all seven held-out plans are byte-identical to main.

| Drawing          | Main median ms | T076 median ms |  Ratio |
| ---------------- | -------------: | -------------: | -----: |
| fd-two-stage     |         1832.3 |         1855.3 | 1.013× |
| common-source-ac |          879.1 |          866.4 | 0.985× |
| skew             |         1963.7 |         1998.1 | 1.018× |
| deadtime         |        11861.1 |        11869.0 | 1.001× |
| ota-sky130       |          741.0 |          745.5 | 1.006× |
| widlar           |         4563.7 |         4618.7 | 1.012× |
| ltc3452          |        14989.6 |        14892.9 | 0.994× |

[Raw timing evidence](../../tmp/t076-r1/timing.json),
[timing log](../../tmp/t076-r1/logs/timing.log). The timing verifier exits 0.

## Deviations and open questions

- The implementation is complete, but acceptance is **partial** because the
  dev/val bend and val rail-crossing gates fail. No acceptance threshold,
  test timeout, metric, weight, or validation split was changed.
- Product edits stay within the owned paths. Temporary scripts, baseline
  build, rendered review and evidence are under `tmp/t076-r1/`; evaluator
  output is under `tmp/auto-layout-eval/`.
- No provider API call, dependency/lockfile change, commit, push, merge,
  rebase, branch switch, or edit to `plan.md`/`review.md` occurred.
