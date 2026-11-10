# T029 review

## Round 1 — changes requested

Reviewed: the uncommitted working tree after Codex round 1. The report is accurate, and
Codex was right to stop at the scope boundary.

What works:

- `units.ts` covers every device and assigns canonical, topology-ordered ids by colour
  refinement with individualization;
- `rulePartition` and `inferRole`, `reconcilePartition`, prompt v4, the evaluator and the
  partition report are all implemented.

**Baseline (plan defect).** The acceptance line compared against
`tmp/auto-layout-eval/baseline.json`, a stale T013-era file. Opus compared the default
evaluation instead with this branch's base (T027 head, recorded in
`tmp/t027-results/{dev,val}/v0`): plan hashes and metrics are identical on all 33
documents. Default output is unchanged.

**Unit definition (plan defect; it causes both failing tests).** Step 1 made every whole
recognized structure an atomic unit. That is wrong in two ways:

1. Membership depends on source ids. Greedy `recognizeStructures` picks one matched pair
   out of an ambiguous bank by id.
2. A structure can span stages. A multi-output bias mirror (T022) has its reference in
   the bias network and its outputs as tails or loads of other stages. As one unit, it
   would force bias and several stages into one block. A pair of diode-connected devices
   that share only a rail is not even connected.

| #   | Severity | Where                        | Finding                                                                                           | Expected fix                                                                                                                             |
| --- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/units.ts`               | Units depend on greedy, id-ordered picks, and can span stages or be connected only through rails. | Amended step 1 (R110), below.                                                                                                            |
| 2   | must-fix | `src/partition-reconcile.ts` | Connectivity is checked between units but assumed inside them.                                    | Once units are internally connected (amended R110), checking between units is exact. Keep the check, and assert the invariant in a test. |
| 3   | must-fix | tests                        | The two blocker tests fail.                                                                       | Both pass under the amended definition; neither is weakened.                                                                             |
| 4   | note     | plan acceptance              | The stale baseline line.                                                                          | Replaced in the plan by a comparison with the T027 head, which Opus ran.                                                                 |

## Round 2 — changes requested

Reviewed: the uncommitted working tree after Codex round 2. The report is accurate. Codex
stopped correctly at `src/partition.ts`, which the plan does not own.

What works:

- **Candidate relations.** `units.ts` enumerates all candidate pairs; no greedy movement
  pick decides a unit.
- **Unit construction.** Each relation is cut by stage and by non-rail, non-bulk
  connectivity, then the pieces are unioned.
- **Canonical aliases.** They also drive the descriptive structure hints, and the
  ambiguous-bank renaming test passes.

Two problems remain, both plan defects:

1. **Current-source tails are cut off their pairs.** `findStages(..., [])` has no conducting
   channel for a two-terminal current source, so the tail lands in a stage of its own. The
   amended R110 then cuts it from its differential pair, and `rulePartition` puts it in its
   own block. The default planner keeps a tail with its pair, because there `findStages`
   joins every group's `tailInstanceId`. The plan should have said which relations join
   stages.
2. **The planner validator is not this task's to change.** `validatePartition` (T026) merges
   any greedy `recognizeStructures` group that spans blocks. Partition placement needs that
   merge today, because it lays out such a group as one template. The plan wrongly asserted
   T029's invariants on the validator's output.

   The fix belongs with placement: the validator uses recognition units as its atomic groups
   and placement trims groups to block members. That is now part of T031, the
   partition-placement task. The 11 documents the rule-only report rejected all carry this
   warning.

| #   | Severity | Where                                                   | Finding                                                                                                | Expected fix                                                                                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/units.ts` (`recognitionUnits`, `rulePartition`)    | A two-terminal current-source tail is cut off its differential pair.                                   | Round 3 amendment, stage map: `findStages` with tail groups only. A test shows `pair()` keeps its tail in one unit and one rule block, and a multi-output mirror still splits by stage. The unchanged fallback test passes, `validatePartition` included. |
| 2   | must-fix | `test/partition-reconcile.test.ts` (`valid`, rail-only) | Asserts T029's invariants on the legacy validator's merged output.                                     | Assert complete, no unit split and every block connected on `reconcilePartition`'s output. `validatePartition` returns no error diagnostics; a legacy L0 warning is allowed and checked by its text. The `[1, 1]` block-size assertion stays.             |
| 3   | must-fix | `scripts/auto-layout-partition-report.mjs`              | Rejects documents because of the planner's L0-merge warning.                                           | Report planner merges per document and in total. Reject only for error diagnostics or a broken T029 invariant. Run it on both splits.                                                                                                                     |
| 4   | must-fix | `src/partition-reconcile.ts` (attach waves)             | A unit attaches when adjacent to exactly one block, so repeated waves can absorb whole omitted stages. | Round 3 amendment, completion: attach only leaves, units whose every non-rail neighbour lies in the host block. Test both cases: a stage the LLM omitted becomes rule blocks, and a shunt capacitor attaches.                                             |
| 5   | note     | T031                                                    | The planner validator and per-block group trimming move to T031.                                       | No action in T029.                                                                                                                                                                                                                                        |

## Round 3 — accepted

Reviewed: the uncommitted working tree after Codex round 3. The report matches the code and
the logs.

- **Findings 1–4 are fixed as amended.**
  - `partitionTailGroups` joins only differential-pair inputs and tails, in both
    `recognitionUnits` and `rulePartition`.
  - Completion attaches only leaf units.
  - `partitionInvariantErrors` checks coverage, uniqueness, intact units and connected
    blocks on T029's own output. The tests and the report use it.
  - The planner's L0 warnings are counted, not rejected.
  - The round 1 blocker tests and the fallback test pass unweakened.
- **Acceptance, rerun by Opus on lane 2.** Every command exits 0:
  - `pnpm vitest run packages/auto-layout`: 443 of 443 tests pass.
  - `pnpm test:local`: 7789 passed, 117 skipped.
  - `pnpm deadcode` reports nothing for auto-layout.
  - `pnpm auto-layout:review` passes.
  - The dry run plans 18 jobs.
  - The rule-only report completes 33 of 33. There are 17 planner merges: 6 on dev, 11 on
    val.
  - The frozen paths are clean.
  - `git ls-files` matches only the three T027 task documents, which hold no case data.
- **Default output is unchanged.** `pnpm auto-layout:eval tmp/human-cases --jobs 8` gives
  the same plan hash and result metrics as the T027 head (`tmp/t027-results/{dev,val}/v0`)
  on all 33 of 33 documents.

Known limit: the planner validator still merges 17 greedy structure groups that span blocks
in the rule-only partitions. T031 replaces that merge with unit-level validation and
trimming groups to block members.

## Real LLM results (Opus, after round 3)

Provider `deepseek-flash`, prompt v4, 3 samples per document. 189 calls: 54 on dev, 45 on val
and 90 on the 30 LOADBench circuits. 186 were valid on the first try; 3 stopped at the
32000-token output limit and were valid on a retry. Cost: about $3.1. Reports are in
`tmp/t029-results/` (git-ignored).

| Corpus          | Documents | Complete | LLM coverage | LLM blocks | Rule blocks | Pairwise sample ARI | Consensus-to-sample ARI |
| --------------- | --------- | -------- | ------------ | ---------- | ----------- | ------------------- | ----------------------- |
| Human cases dev | 18        | 18       | 97.6%        | 84         | 8           | 0.67                | 0.82                    |
| Human cases val | 15        | 15       | 97.5%        | 68         | 9           | 0.66                | 0.81                    |
| LOADBench       | 30        | 30       | 97.0%        | 176        | 4           | 0.70                | 0.84                    |

No sample named an unknown or duplicate unit, and none proposed a disconnected or oversized
block. Consensus dropped 12 unstable units, and 2 blocks emptied.

**Targets.**

| Target                                                   | Result                                    |
| -------------------------------------------------------- | ----------------------------------------- |
| Complete, connected, no unit split, on both splits       | Met: 33 of 33, and 30 of 30 on LOADBench. |
| LLM coverage at least 80%                                | Met: 97%.                                 |
| Consensus-to-sample ARI at least the pairwise sample ARI | Met: 0.81–0.84 against 0.66–0.70.         |
| LOADBench block recall at least 0.70, ARI at least 0.69  | **Not met:** recall 0.43, ARI 0.38.       |

**The LOADBench target was wrong.** It came from T027's ARI of 0.69. T027 scored the LLM
answer and the LOADBench reference after `validatePartition` had merged recognized
structures in both, which inflates agreement. T029's report scores against the raw labels.
Measured the same way for both tasks, on the labelled devices of the 30 circuits:

| Mean ARI against LOADBench labels                | T027 (prompt v3) | T029 | Rules only | Best possible with T029's units |
| ------------------------------------------------ | ---------------- | ---- | ---------- | ------------------------------- |
| Parts (gm, load and bias parts; 8.7 per circuit) | 0.28             | 0.38 | 0.27       | 0.76                            |
| Stages (2.7 per circuit)                         | 0.18             | 0.41 | 0.81       | 1.00                            |

- T029 agrees with the labels better than T027 at both levels.
- The LLM draws about 6 blocks per circuit, between LOADBench's parts and its stages. The
  difference is granularity. LOADBench labels a tail transistor and each bias device as a
  part of its own; the LLM, like a human drawing, keeps a tail with its pair.
- The rule partition matches LOADBench's stages well (0.81).
- Against the spatial grouping of the human drawings (the T026 oracle, 2–3 blocks per
  drawing), mean ARI rises from 0.19 to 0.27 on dev and from 0.22 to 0.30 on val.

No reference here measures drawing blocks directly. The layout results in T031 and the
rendered blocks are the evidence for that.

**Finding moved to T030.** The soft role check rejects 24 of 152 LLM blocks on the human
cases and 52 of 176 on LOADBench. Most are sound, such as current sources called `bias`. The
check then sets the role to `other` and halves the confidence. T030 round 2 makes the check
report only.

## Round 4 — changes requested (from the PR review of `c24e2da`)

The codex review of PR #32 raised two findings. Opus checked both; both hold.

| #   | Severity | Where                             | Finding                                                                                                                                                                                                                                                                                      | Expected fix                                                                                              |
| --- | -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/units.ts` (`canonicalOrder`) | Identical branches with private nets cost k! search leaves. Reproduced: 6, 7 and 8 isolated resistors take 24 ms, 124 ms and 1144 ms; a mirror with 5, 6 and 7 outputs takes 3 ms, 22 ms and 182 ms. The prompt, the units and reconciliation all call it, so a 12-output mirror would hang. | Round 4 amendment, item 1: orbit pruning with an explicit automorphism check, and the tests listed there. |
| 2   | must-fix | `src/partition-metrics.ts`        | ARI, block recall and role match compare the complete partition with a reference that labels only some devices. `adjustedRandIndex` needs one universe.                                                                                                                                      | Round 4 amendment, item 2: restrict the partition to the labelled devices for these three metrics.        |

The LOADBench figures in "Real LLM results" above that come from the report script (ARI
0.40, recall 0.43) carry finding 2's error. The part-level and stage-level table was
computed on labelled devices only and stands. Opus reruns the report after this round and
corrects the record.

## Round 4 — accepted

Reviewed: the uncommitted working tree after Codex round 4. The round's process was killed
when the session restarted, after the code and tests were done and while the last
acceptance command ran. There is no round 4 report; this review rests on Opus's own rerun.

- **Finding 1 is fixed.** `canonicalOrder` prunes a branch only when the two first-leaf
  certificates are equal and the vertex map they define sends the explored vertex to this
  one and fixes every individualized vertex. Every change in `units.ts` is inside
  `canonicalOrder`. Timings after the change: 8 isolated resistors 4 ms (was 1144 ms), a
  mirror with 7 outputs 3 ms (was 182 ms). The new tests cover 16 resistors, a 16-output
  mirror and a 12-inverter ring, under renaming and reordering, and a changed connection.
- **Finding 2 is fixed.** ARI, block recall and role match use the partition restricted to
  the devices the reference labels.
- **Acceptance, rerun by Opus on lane 2.** Every command exits 0:
  - `pnpm vitest run packages/auto-layout`: 447 of 447 tests pass before the two fixes
    below, 449 of 449 after.
  - `pnpm test:local`: 7793 passed, 117 skipped.
  - `pnpm deadcode` reports nothing for auto-layout; `pnpm auto-layout:review` passes.
- **Nothing else moved.**
  - Default plans and metrics equal the T027 head on 33 of 33 human cases.
  - The dry-run payload is still 91293 bytes with 18 cached samples, so the canonical order
    and the prompt-v4 cache keys are unchanged.

**Corrected LOADBench record.** With finding 2 fixed, the report gives mean ARI 0.38 and
block recall 0.43 on the 30 circuits. The "Real LLM results" section above said ARI 0.40;
its target row now reads 0.38. The conclusion does not change.

**Two fixes by Opus, from the subagent review of PR #31 (T027).** Both are in files this
task already changes.

| #   | Severity | Where                                   | Finding                                                                                                                                                                                                     | Fix                                                                                                                                                                               |
| --- | -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2       | `scripts/auto-layout-llm-partition.mjs` | A response that stops at the output limit, or for a provider-specific reason such as an overload, was cached as a failure and never asked again. Three real samples hit this and had to be deleted by hand. | Only a refusal is cached as a failure. Any other stop is reported as `unavailable` and is not cached. Two tests added; the `max_tokens` expectation of one existing test follows. |
| 2   | P2       | `docs/specs/auto-layout.md`             | The spec did not say how the provider is selected, where the payload goes or where the key comes from.                                                                                                      | The provider paragraph names `LLM_PARTITION_PROVIDER`, the DeepSeek endpoint and `SYSTEM_GENERAL_API_KEY`, and states the cache rule above.                                       |
