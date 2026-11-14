# T079 report — round 3

## Summary

Implemented both round 2 must-fix code changes. T078's runner-up retains its
own full finishing slot and original margin rule. Local-loop and attachment
variants retain the participation gate and share one additional slot, ranked
by the provisional comparator. The selected variant receives half the normal
relocation, port-seat, and rail-seat trial allowances, rounded down with a
minimum of one; other finishing passes are unchanged.

**Partial delivery: the prescribed policy still fails quality acceptance.**
Dev composite improves **2.385%**, retaining **81.30%** of round 1's gain.
Validation improves **2.581%**, retaining only **58.44%**, below the required
3.5% improvement / 80% retention. Two dev drawings regress against main.
All seven acceptance commands exit successfully; quantitative gates are
reported separately below. All 628 outputs are electrically equivalent,
counts of floating/missing connections and guarded visual totals pass, and
all six large documents remain byte-identical to main and deterministic.
**Deadtime remains 1.791× main**, exceeding the revised +50% maximum; the
other six held-out runtime medians pass +20%.

## Steps

| Step | Status  | Notes                                                                                                                                                                                       |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Retained the original dev connectivity/placement investigation; independently reproduced and diagnosed both remaining dev regressions.                                                      |
| 2    | done    | Attachment recognition, seating, clearance, protection, and explicit-floorplan behavior are unchanged.                                                                                      |
| 3    | partial | Implemented the revised independent runner slot and one reduced-budget variant slot. Quality gates still fail.                                                                              |
| 4    | done    | Updated slot-policy tests, verified full versus half budgets through the real planner, and added rounding/minimum-budget boundary coverage. Existing protection and determinism tests pass. |
| 5    | partial | Evaluated all 628; regenerated and inspected the 39-case review page; replayed all review hashes; verified six large plans. Validation gain retention and per-drawing non-regression fail.  |

## Review findings addressed

**Round 2, must-fix 1 — budget: implemented.**

- `rankedFinalists` always returns the eligible runner first, independently
  of provisional variant scores. Local-loop and attachment share one further
  slot, selected with `compareRuns` and stable registration order on ties.
- Removed the round 2 participation gate from the runner, restoring main's
  exact distinct-placement, completeness, margin, and completeness-safety
  eligibility checks. Both new variants retain their existing participation
  and margin gates.
- A real-planner regression test confirms a runner still finishes when the
  participation probe is forced false. Selection tests cover competing
  variants, stable ties, absence of a runner, and no eligible finalists.

**Round 2, must-fix 2 — cost: implemented.**

- `finishingTrialBudget` halves the incumbent's effective size-dependent
  allowance, floors the result, and clamps it to at least one. It leaves full
  allowances unchanged for the incumbent and runner.
- Relocation's alignment and gap passes still share one mutable allowance.
  Port-seat and rail-seat searches accept an optional explicit trial limit;
  their existing default limits remain unchanged for other callers.
- Through the real planner, the competing-finalist test observes relocation
  allowances **10 / 10 / 5**, port limits **12 / 12 / 6**, and rail limits
  **8 / 8 / 4** for incumbent / runner / local-loop variant. Boundary tests
  cover size scaling, odd-number rounding, and the minimum of one.
- No other finishing pass, finished comparator, readability metric, weight,
  attachment recognizer, or placement algorithm was changed this round.

**Round 2, change 3 — gates: not satisfied.** Dev gain retention passes;
validation gain retention and the no-drawing-regression requirement fail.
Runtime measurements are recorded below. Implementing the requested rules
does not establish that their resulting trade-off satisfies acceptance.

**Round 1, must-fix 1 — superseded budget policy.** The latest review explicitly
replaces the all-extras shared slot. The requested one-versus-two dev
experiment was completed in round 2 and is retained below for comparison.

**Round 1, note 2 — out of scope.** No drafting-caption change was made for
`yb27wfgqkz`.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing large-chunk warning only.
pnpm typecheck → 0.
pnpm lint → 0; 2,065 files, 0 errors, 3,455 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0; 797 passed / 3 skipped files; 8,189 passed / 117 skipped tests.
pnpm test:slow → 0; 2 files, 8 tests passed.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628/628 equivalent; report.json and index.html written.
```

[Round 3 command logs](../../tmp/t079-round3/logs/).
The local suite ran with local-service access because the previous round
established that the sandbox blocks PostgreSQL and loopback listeners.
Headless Chrome likewise used local execution to render the review page.
No installation, network fetch, or provider API call was needed.

The initial focused run exposed the old round 2 assertion that allowed only
one total extra. Updated it to the latest review's runner-plus-one policy and
added checks for all three actual allowances; the final focused run passes
**65/65** tests. No acceptance assertion was weakened to conceal a failure.

The separate two-case diagnostic reproduction deliberately checks the unmet
corpus non-regression gate and exits **1**, with **2/2 failures**. Both repeat
hash checks pass before those score assertions fail. Its source and output
are retained as investigation evidence, outside the shipped test suite;
these failures are not represented as successful quality acceptance.

## Investigation results

### Corpus quality and guards

| Measure               |     Dev main |  Dev round 3 |     Val main |  Val round 3 |
| --------------------- | -----------: | -----------: | -----------: | -----------: |
| Drawings              |          439 |          439 |          189 |          189 |
| Frozen composite sum  | 62.659389735 | 61.164989191 | 34.464037017 | 33.574681807 |
| Improvement           |            — |     2.38496% |            — |     2.58053% |
| Round 1 gain retained |            — |    81.29519% |            — |    58.44214% |
| Crossings             |          243 |          235 |          146 |          143 |
| Floating pins         |            6 |            6 |            0 |            0 |
| Missing connections   |            4 |            4 |            0 |            0 |
| Improved composites   |            — |           66 |            — |           28 |
| Increased composites  |            — |            2 |            — |            0 |

All **628/628** outputs are electrically equivalent. **529** plan hashes
match main. `VISUAL_LABEL_RUN_ON` decreases **31 → 29**, and
`VISUAL_TERMINAL_DEPARTURE` decreases **35 → 34**. Every other guarded visual
total is unchanged; zero totals remain zero. The exempt zero-weight label
clearance count increases **267 → 271**.

[Full evaluation](../../tmp/t079-round3/report.json),
[comparison and guard totals](../../tmp/t079-round3/summary.json).

### Dev trade-off

| Policy                                    | Dev composite | Change vs main | Round 1 gain retained | Crossings | Drawings worse | Finishing-phase calls |
| ----------------------------------------- | ------------: | -------------: | --------------------: | --------: | -------------: | --------------------: |
| Main `a1b022f`                            |  62.659389735 |              — |                     — |       243 |              — |                18,629 |
| Round 1, unrestricted extras              |  60.821150021 |         −2.93% |                  100% |       232 |              0 |                22,625 |
| Round 2, one shared extra                 |  62.730002654 |         +0.11% |                −3.84% |       239 |             11 |                19,198 |
| Round 2 experiment, two shared extras     |  60.900744048 |         −2.81% |                95.67% |       231 |              3 |                22,308 |
| Round 3, runner + one half-budget variant |  61.164989191 |         −2.38% |                81.30% |       235 |              2 |                21,516 |

Round 3 reduces dev finishing-phase calls **4.90%** versus round 1. These
counts include trials within finishing passes, not just outer finalist
passes. Corpus evaluation overlapped other checks, so corpus wall times are
not used as isolated runtime evidence. Round 2's two-extra experiment remains
dev-only; no validation-driven tuning was performed this round.

Prior experiment evidence: [one extra](../../tmp/t079-round2/dev-one.json),
[two extras](../../tmp/t079-round2/dev-two.json).

### Reproduced causes of the two dev regressions

| Drawing      | Main composite | Round 3 composite | Main → round 3 crossings | Independent probe restoring main    |
| ------------ | -------------: | ----------------: | -----------------------: | ----------------------------------- |
| `75k4jskamd` |    0.064839948 |       0.069663892 |                    0 → 0 | Bypass the participation gate only  |
| `ajwgak3wbv` |    0.417976316 |       0.519172418 |                    3 → 4 | Restore full finishing budgets only |

For `75k4jskamd`, the participation probe rejects the local-loop variant, so
only the runner is available. Bypassing that probe admits the local-loop
variant, which reaches main's exact score even at half budget. Restoring
full budgets or finishing all already-eligible variants does not fix it.

For `ajwgak3wbv`, local-loop and attachment both pass participation. Local-loop
ranks first (24,327.358 versus 30,223.958). Its half-budget finished score is
0.486426498 and the existing finished guards reject it; the incumbent remains
0.519172418. Restoring full trial budgets alone produces 0.417976316 and the
finished selector accepts it. Bypassing participation or finishing both
eligible variants at half budget does not fix it.

The real-input replay first reproduced each score and matched both the full
evaluation hash and an independent repeat. One-variable probes then tested
participation, budgets, and ranking independently. The exact corpus inputs
were retained because acceptance compares these drawings; no topology
minimization or alternative production policy was introduced. These are
limitations of the prescribed policy, not drawing-specific exceptions.

[Failing reproduction](../../tmp/t079-round3/regression-repro.test.ts),
[failure output](../../tmp/t079-round3/logs/regression-repro.log),
[probe source](../../tmp/t079-round3/probes.test.ts),
[probe results](../../tmp/t079-round3/probes.json).
The archived reproduction can be rerun with:

```bash
pnpm exec vitest run --config tmp/t079-round3/vitest.config.ts tmp/t079-round3/regression-repro.test.ts
```

### Review page and determinism

The [Human | main | round 3 review page](../../tmp/t079-round3/review.html)
contains the five requested examples, this round's ten largest composite
reductions across both splits, and the original 25 samples: **39 unique
drawings**. All ten rendered sheets were inspected; no horizontal overflow
occurs at 1,800 pixels. Verified main SVGs from the prior rounds were reused;
diagnostic block overlays are omitted consistently.

The five named examples retain main's composites and crossings. In particular,
`386ggqhz53` returns to main's **0.130569401 / one crossing**, fixing round 2's
lost-runner regression. `bv9zwmd835` and `gh3gcb5h3a` also return to main in the
sample review. The page shows shorter routes in `dwyz9ezgd7`, `hr85s6jbqz`,
`p3af2sg23j`, and `c5tctbsh33`, as well as the remaining layout regression in
`75k4jskamd`.

All **39/39** independent review replays match the full evaluation hashes.
All six large plans match main byte for byte and repeat exactly:
`38m8wdesbh`, `4fb59zv76m`, `8b2n3zf9vj`, `b9afqhsjzv`, `g47e465db5`, and
`sm663cbs8b` (50–103 instances).

[Membership](../../tmp/t079-round3/review-cases.json),
[render verification](../../tmp/t079-round3/render.json),
[replay hashes](../../tmp/t079-round3/verification.json),
[large-plan evidence](../../tmp/t079-round3/large.json).

### Held-out runtime

Measured under Node v26.7.0 with no corpus evaluation, tests, diagnostic
replays, or rendering running. Each fixture warms both implementations, then
runs three alternating main/current pairs without deadlines; each column
uses its own median.

| Drawing          | Main median ms | Round 3 median ms |  Ratio | Revised gate     |
| ---------------- | -------------: | ----------------: | -----: | ---------------- |
| fd-two-stage     |         1628.7 |            1635.1 | 1.004× | pass             |
| common-source-ac |         1002.2 |            1018.5 | 1.016× | pass             |
| skew             |         1725.3 |            1808.8 | 1.048× | pass             |
| deadtime         |         9976.1 |           17867.2 | 1.791× | **FAIL (>+50%)** |
| ota-sky130       |          713.2 |             683.8 | 0.959× | pass             |
| widlar           |         4921.8 |            5364.6 | 1.090× | pass             |
| ltc3452          |        14441.5 |           14620.8 | 1.012× | pass             |

**Runtime acceptance fails.** Six fixtures pass +20%; deadtime is **1.791×**
main, exceeding even the allowed single-fixture +50% exception. Round 2 was
1.879×; the prescribed half budgets are insufficient. Deadtime finishing-phase
calls fall from **89** in round 2 to **80**, versus **50** on main. Skew stays
at **42** finishing-phase calls on both main and round 3.

All seven fixtures repeat identically across the three samples; six also
match main byte for byte. Deadtime selects a different plan.

[Timing harness](../../tmp/t079-round3/timing.mjs),
[timing samples, hashes, and phase counts](../../tmp/t079-round3/timing.json).

### Original attachment investigation

Round 1's connectivity/placement investigation remains applicable because
recognition and placement were not changed this round. Among 95 dev drawings
with excess crossings (144 excess crossings in that subset), recognition found
230 attachments in 79 drawings, including 33 single-device stages and 38
protected parts. Their serving nets participated in 95 result crossings versus
15 human crossings across 60 drawings. This measures involvement, not the
number of crossings seating can remove.

For the 205 one-node attachments, inward/far counts were template **52/25**,
layered **35/13**, stages **35/0**, and main finished **32/3**. “Far” means more
than four small row pitches (400 units). Template/fallback rows separate parts
from serving pins; stage placement reduces distance but can keep the inner side.

- `kaxfrg2ass`: six attachments participate in all three main crossings;
  `C2` serves `M3` but strategies put it on different sides/heights.
- `6r2q6deeq9`: five attachments include three sources; their serving nets
  participate in all three main crossings. Load/capacitor fallback rows are
  farther from the node than stage placement.
- `m3ek9hty4p`: paired capacitors and resistors are protected symmetry members;
  all four main crossings remain.
- `386ggqhz53`: `S2`/`S4` attach to capacitor-side nodes, while main's remaining
  crossing lies on transistor-side nets.
- `6qg2h7weje`: only tail source `I1` qualifies and is symmetry-protected;
  all five transistor-path crossings remain.

[Original investigation measurements](../../tmp/t079-round1/investigation.json).

### Proposed spec text for Opus

Recognize two-pin or single-stage attachments through connectivity and pin
roles: their non-rail connections reach one host node, or bridge two nodes of
one host. Seat them beside the served pin on its exit side, oriented along
the pin, using the nearest free grid seat with body clearance; bridge parts
sit between their host nodes and rail pins face their rail side. Preserve
fixed, template, symmetry, and layout-group members. Preserve explicit
partition arrangements. A blocked seat retains the old placement.

For eligible bounded planning, preserve T078's independent runner slot and
original margin/completeness rules. Local-loop and attachment variants retain
the distinct-placement, margin, and incumbent weighted-participation gates;
rank them with the provisional comparator, retaining registration order on
ties, and finish at most one. This additional variant receives half the
incumbent's effective size-dependent relocation, port-seat, and rail-seat
trial allowances, rounded down with at least one each. Alignment and gap
relocations share the reduced allowance. Other finishing passes and the
complete-layout comparison/guards remain unchanged. Quick and above-40
planning retain their existing behavior.

This describes the implemented experiment; **it is not a quality-preserving
policy ready for acceptance**, because the validation-gain and per-drawing
non-regression gates fail.

## Deviations and open questions

- The latest review's two must-fix code changes are implemented, but the task
  is not accepted: validation gain retention is 58.44%, and two dev drawings
  regress. Per AGENTS.md, the required gate and budget design was retained;
  no unplanned selector, expanded finishing allowance, frozen-weight change,
  or drawing-specific exception was substituted to make the gates pass.
- Deadtime remains 1.791× main, beyond the revised +50% maximum. Six other
  held-out medians pass +20%. Further quality/runtime policy changes require
  a revised plan; successful command exits do not override these failures.
- Investigation probes are archived under `tmp/t079-round3`; no temporary
  probes or debug logging remain in product source or shipped tests. The
  deliberately failing corpus reproduction remains available as evidence.
- No plan, review, spec, dependency, lockfile, or generated source was edited.
  No LLM provider API was called. No commit, push, merge, rebase, or branch
  switch was performed.
