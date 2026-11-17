# T134 review

## Round 1 — changes requested

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T134-block-direction`; acceptance rerun by the reviewer (every plan hash
equal to the implementer's run); a blind review of the changed cases by two
calibrated reviewer subagents.

Plan deviation accepted: step 1's stop condition fired (disabling only the
search's left-right reflect leaves 17 of 24 results with an output facing
left). The other sources were found — two-pin blocks turned 180° in the
layered rows, stage mirrors, relocation poses — and they are generators the
rule in step 3 covers, so continuing was right. It is why eleven source files
change.

Acceptance rerun by the reviewer:

```text
pnpm build / typecheck / lint (0 errors) / format:check / docs:check → 0
pnpm test:local → 0 (810 files, 8340 passed, 117 skipped)
pnpm test:slow  → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 5 → 0
```

Corpus against `main` at `fb61255`: 612 completed and equivalent, the same 16
refused, none threw; no introduced dangling wire, unconnected pin or touching
pin. Results with a block output facing left 24 → 7, with an output port left
of its driver 34 → 3 (all on a block cycle). 74 plans change; the 454 cases
without a directed block keep their plan hash. Crossings 343 → 342, bends
2481 → 2469; 32 changed cases are worse on bends or crossings, 22 better.

Blind review (65 changed non-sealed cases, 64 judgeable): acceptable on `main`
7, here 13; 9 gained, 3 lost (`zp8mp5jyyf`, `n39nbzrxsd`, `4wce8zcf6c`). Of
the 28 metric-worse cases 22 are unacceptable in both versions.

| #   | Severity   | Where                                      | Finding                                                                                                                                                                                                                                                                                                                                                                                      | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `stages.ts` (stage not mirrorable), drafts | A block that must face right can end up at the left end of its chain, with the parts that drive its input to its right: the block faces right and the signal runs right to left (`zp8mp5jyyf`: the op-amp left of R1–R3 and C1–C2, its output wire running back over the row). On `main` the mirrored op-amp hid this. Forbidding the stage mirror removes the one move that reverses a row. | Measure first: a detector "block against the flow" (a right-facing block whose input Nets' other pins lie mostly to its right and whose output Net's other pins lie mostly to its left) on base results, these results and the human drawings. If these results have at least five more such cases than base, fix it generally: the row is reversed (stage or draft mirrored) and the guarded blocks are then re-righted in place, as R153 does for series parts. Otherwise report the counts and leave it. |
| 2   | should-fix | `directed-blocks.ts` block cycle           | A loop of blocks closed through pass devices (switches, MOS channels, two-pin parts between one block's output Net and the next block's input Net) is not a block cycle, so its blocks are forced right (`gx36d3sre9`: crossings 1 → 3, bends 9 → 17).                                                                                                                                       | Measure first: how many corpus documents have a cycle only when one pass device between an output Net and an input Net is followed, and how many of them the human draws with a block facing left. If at least five documents and the human faces a block left in most, extend the cycle definition by that one hop; otherwise report and leave it.                                                                                                                                                         |
| 3   | note       | `n39nbzrxsd`, `4wce8zcf6c`                 | Lost in the blind review for extra corners after the search took another path. `4wce8zcf6c` is in the subset T135 gives a feedback-row draft.                                                                                                                                                                                                                                                | none here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | note       | rule number                                | T129 (netlist rail symbols) also numbered its rule R164.                                                                                                                                                                                                                                                                                                                                     | the later delivery renumbers at rebase                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Acceptance for round 2: the plan's checks; the round-1 corpus criteria still
hold; against the round-1 report (`tmp/t134-report.json`) list the plans that
change and why; `zp8mp5jyyf` and `gx36d3sre9` rendered before and after.

## Round 2 result — measurements only; round 3 requested

Both gates were measured on the 174 documents with a directed block.

- Cycle through one pass device: 3 documents, and the human faces a block left
  in none. The cycle definition stays. (`gx36d3sre9` is not such a loop: its
  inverters drive switch gates; its regression is another search path.)
- Block against the flow. The detector as the review wrote it misses
  `zp8mp5jyyf` (its feedback parts sit on the output Net). Refined: a
  right-facing block not on a cycle whose input Nets' other pins lie mostly to
  its right, feedback parts excluded. Results on `main` 30 cases, round 1 31,
  human drawings 10; ten cases newly against the flow in round 1 and nine
  cleared. The net change does not meet the gate, but the count itself does:
  20 more cases than the human drawings, on `main` and here alike. Cause: the
  stages draft can put a block left of the network that drives it, and R57
  reverses a row only when ports say which side is the input.

| #   | Severity | Where                              | Finding                                                                                                                                                 | Expected fix                                                                                                                                                                                                                                                                                                                                             |
| --- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `stages.ts`, `signal-direction.ts` | A right-facing block is drawn left of the parts that drive its input in 31 results (human 10): the block faces right and the signal runs right to left. | A stage holding a guarded block may be mirrored again; each guarded block is then turned back to face right in place (as R153 re-rights series parts). Without ports, the input Nets of guarded blocks mark the input side for the R57 reversal. Add the detector to the report-only `blockDirection` counts (`againstFlow`). Tests for both mechanisms. |

Acceptance for round 3: the plan's checks; results against the flow fall from
31 to at most 15; output facing left stays at most 11 and output port left at
most 5; the 454 cases without a directed block keep their plan hash; total
crossings and bends within +1% of `main`; no integrity defect; the plans that
change against round 1 listed; `zp8mp5jyyf` rendered before and after.

## Round 3 result — accepted in substance; round 4 requested

Round 3 reverses rows that run against their guarded blocks and re-rights the
blocks in place: mirrorable stages again (`stages.ts`), the search's block
mirror with a guard against new against-the-flow blocks (`search-moves.ts`),
block inputs as the input side for R57 when no port says (`signal-direction.ts`),
and a whole-draft mirror when it leaves fewer blocks against the flow
(`place.ts`). The last two apply only to documents without MOS or BJT: without
that limit results against the flow fall to 9, but the local-loop and
gate-row variants (R156, R159) collapse onto the baseline (six existing tests
fail) and regulators are redrawn with mirrored transistors. The reviewer
accepts the limit; results against the flow are 30 → 23 on `main`'s corpus
(target 15 missed; 15 of the 23 contain MOS or BJT).

The task is now stacked on T135 (feedback-row draft), because round 3 acts on
the same documents; this task's rule is renumbered R164. Reviewer run of the
combination: build, typecheck, lint, format:check, docs:check 0; `pnpm
test:local` 0 (811 files, 8351 passed, 117 skipped); `pnpm test:slow` 0 (2
files, 8 passed); evaluation 0 — 612 completed and equivalent, the same 16
refused, no introduced dangling wire, unconnected pin or touching pin. Against
T135 alone: 91 plans change (31 better, 32 worse on bends or crossings);
crossings 339 → 335, bends 2373 → 2347 (`main`: 343, 2481). Results with an
output facing left 5, an output port left of its driver 1, a block against the
flow 22.

Blind review (80 changed non-sealed cases, T135 alone against T135 with this
task, two calibrated reviewers, 78 judgeable): acceptable 28 → 33; 10 gained,
5 lost. Gained cases include the two T135 lost for an output port on the left
(`2sqrha67j7`, `4wce8zcf6c`).

| #   | Severity | Where                                          | Finding                                                                                                                                                                                                                                                                     | Expected fix                                                                                                                                                                                                                                                                                                 |
| --- | -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | `place.ts` draft mirror, `signal-direction.ts` | The whole-draft mirror and the block-marked R57 side look only at blocks. A drawing whose input is an input source rather than a port is reversed so that the source ends on the right (`mbpnznx3p5`, lost in the blind review: "reversed flow, long wires"; `vf8bt5jxya`). | Explicit input evidence outranks block inference: the reversal is taken only when it does not move an input port or an input source (the start of the signal distance R32 already uses) to the right of what it drives. Measure how many documents the reversal applies to before and after; tests for both. |

Acceptance for round 4: the plan's checks on the stacked branch; against the
round-3 combined report (`tmp/t134-combined-report.json`): the plans that
change, with `mbpnznx3p5` and `vf8bt5jxya` rendered before and after; output
facing left, output port left and against-the-flow counts not higher; totals
of crossings and bends not higher by more than 1%; no integrity defect; the
documents without a directed block keep their plan hash.

## Round 4 result — accepted

The whole-draft mirror (`place.ts`) and the block-marked R57 side
(`signal-direction.ts`) are vetoed when they would put an explicit input — an
input port's Net, or an input source on a signal root — right of what it
drives (`inputsOnRight` in `directed-blocks.ts`). A veto, not a summed count:
with a sum, righting two blocks could pay for moving one explicit input to the
right. The mirror is taken in 49 corpus documents instead of 59; no
`feedback-rows` draft is ever mirrored. One new test (a chain driven by
grounded sources keeps its source left of the amplifier).

Reviewer rerun on the stack (T135 at `2d3ffac`, then this task): build,
typecheck, lint (0 errors), format:check, docs:check 0; `pnpm test:local` 0
(811 files, 8358 passed, 117 skipped); `pnpm test:slow` 0 (2 files, 8 passed);
evaluation 0 — 612 completed and equivalent, the same 16 refused, none threw,
no introduced dangling wire, unconnected pin or touching pin. Every plan hash
equals the implementer's round-4 run.

Against round 3: 8 plans change. `mbpnznx3p5` (lost in the round-3 blind
review) and `vf8bt5jxya`, `jkw9pk932h`, `wrfpdjv2ph`, `ax88crfm22` return to
T135's drawing; `vrra9vwhb3` and `yx945wjdj4` lose a bend; `btx8qnb5jd` is
worse (bends 1 → 5). No new blind review for these eight: two of the five
round-3 losses return to a drawing judged acceptable, and none of the ten
gains is among them.

Against T135 alone: 86 plans change; crossings 339 → 334, bends 2373 → 2337
(`main`: 343, 2481). Results with a block output facing left 5 (`main` 24),
an output port left of its driver 1 (34), a block against the flow 23 (30;
human drawings 9).

Open after this task: 15 of the 23 against-the-flow results contain MOS or
BJT, where the reversal is not offered (it collapses the R156 and R159
variants and mirrors regulators); `btx8qnb5jd`, `n39nbzrxsd`, `hn8ma6xaxq`,
`sxc4y2gcbw` worse after the search takes another path.
