# T135 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T135-feedback-rows`; acceptance rerun by the reviewer; a blind review of
the changed cases by two calibrated reviewer subagents.

Where the draft enters: a fourth strategy value, `feedback-rows`, appended
last to the R63 list for its subset only (`feedbackRowsEligible`: at most 40
instances, no partition, no fixed or locked objects, no MOS or BJT, a block
with a chain of one to four two-pin parts from its output Net to one of its
input Nets). In the subset `template` and `layered` give the same edit list,
so R63 already drops one of them. Routing, refinement, search, finishing and
selection are unchanged. The subset is 62 corpus cases.

| #   | Severity | Where                                           | Finding                                                                                                                                                                                                                         | Expected fix                                             |
| --- | -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | note     | output port seat                                | The output port is still often seated at the top end of the feedback row or on the left (`2sqrha67j7`, `4wce8zcf6c`, `d6egcq7hxy`: three of the four cases lost in the blind review). The plan leaves this seat to T134's rule. | re-measure both tasks together when the second one lands |
| 2   | note     | later search                                    | Search lifts an input chain to the feedback row's height in some cases (`n8bkenwpcd`, `x4ffy7hf34`); five narrow cases do not select the draft.                                                                                 | follow-up                                                |
| 3   | note     | `place.ts`                                      | R21 does not re-orient the draft's parts: it kept un-mirroring the block (crossings on the subset 2 → 0 with the exclusion).                                                                                                    | none                                                     |
| 4   | note     | `attachments.test.ts`, `stage-symmetry.test.ts` | A type annotation added in each: typecheck fails without it once `LayoutStrategy` has a fourth value.                                                                                                                           | none                                                     |
| 5   | note     | `feedback-rows.ts`                              | 1008 lines in one new file, 54 non-null assertions (lint warnings, as elsewhere in the package).                                                                                                                                | independent review to weigh                              |
| 6   | note     | rule number                                     | The rule is numbered R163 here; two parallel tasks also use R163.                                                                                                                                                               | the later deliveries renumber at rebase                  |

Acceptance rerun by the reviewer:

```text
pnpm build / typecheck / lint (0 errors) / format:check / docs:check → 0
pnpm test:local → 0 (810 files, 8343 passed, 117 skipped)
pnpm test:slow  → 0 (the 2 slow files, 8 passed; untracked scratch copies under tmp/ were picked up as well)
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 4 → 0
```

Corpus against `main` at `fb61255`: 612 completed and equivalent, the same 16
refused, none threw; no introduced dangling wire, unconnected pin or touching
pin; 51 plans change, all in the subset; the other 577 keep their plan hash.

On the subset (62 cases; main → this task, human): aspect ≥ 2 in 27 → 6 (5);
single-row results 19 → 2 (8); bends 315 → 207 (234); crossings 4 → 0 (0);
wire 44.9k → 33.4k (26.8k); label clearance 11 → 2 (38); label overlaps 0 →
0; median area 93.7k → 98.0k (96.7k). The draft is the selected one in 51.

Blind review (46 changed non-sealed cases, `main` against this task, shuffled
and unlabelled, judged against the original by two reviewer subagents
calibrated on the owner's verdicts; 45 judgeable): acceptable 14 → 29; 19
gained, 4 lost.

## Round 2 — changes requested (independent PR review of 9439765)

The Opus PR review approved with six P3 findings
(https://github.com/huyangc/auto-canvas/pull/88). Fix on this branch, with no
plan hash changing:

| #   | Severity   | Where                                      | Finding                                                                                                                                                                                                                                                           | Expected fix                                                                                                                                   |
| --- | ---------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | should-fix | `docs/specs/auto-layout.md` R163, R22, R55 | The draft's devices are all taken out of R21, so the draft has no orientation choices and R22 offers it only Cell Pin side flips; R163 says it is refined exactly like the other drafts. R55 still says three strategies.                                         | Say so in R163 and R22; cross-reference R163 from R55. No behaviour change in this round.                                                      |
| 2   | should-fix | `feedback-rows.ts:733`, R163               | The code mirrors the block when the fed-back input pin lies below the output pin; the rule says "so that pin is the upper input".                                                                                                                                 | Make the rule text say what the code does.                                                                                                     |
| 3   | should-fix | `feedback-rows.ts` `forwardDistances`      | Root tiers no corpus case uses: the `signalDistances` tier ran in 14 cases and gave no root in any; the "reference branch" pass is reached by none. The port test `symbolId.startsWith("port")` differs from the `["port", "port-filled"]` test in the same file. | Remove the tiers that produce nothing, or give each a synthetic test that needs it; use one port test. Every corpus plan hash must stay equal. |
| 4   | should-fix | `feedback-rows.test.ts`                    | The not-offered cases do not assert the plan equals today's; no tests for a multi-part chain (the four-part limit, refusal at five), two blocks feeding each other, a block with two output Nets, determinism.                                                    | Add them.                                                                                                                                      |
| 5   | note       | `feedback-rows.ts` `placeBand`             | One function of about 670 lines with some thirty closures over shared mutable state; a second signal distance beside `signalDistances`; 54 non-null assertions.                                                                                                   | follow-up task: split recognition, distances and row geometry into units with explicit state                                                   |
| 6   | note       | `auto-layout.ts` `feedbackRowsEligible`    | `classifyNets` runs before the MOS/BJT early exit; about 0.4 ms per document.                                                                                                                                                                                     | test for MOS/BJT first                                                                                                                         |

Acceptance for round 2: the plan's checks; all 628 plan hashes equal to round 1
(`tmp/t135-report.json`).

The repository's automatic codex review of the PR added one finding to this
round:

| #   | Severity | Where                        | Finding                                                                                                                                                                                                                           | Expected fix                                                                                                                                                                               |
| --- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7   | must-fix | `feedback-rows.ts` (far pin) | An eligible circuit with a controlled switch whose two conducting terminals share a Net makes the draft throw, which aborts planning although another strategy could succeed: the control Net was taken as a conducting terminal. | A control Net never links a part into a row; a part whose conducting pins share a Net links nothing; a draft that cannot place every device is refused, not thrown. Tests for both shapes. |

## Round 2 result — accepted

1. R163 and R22 say the draft's devices are outside R21 and that R22 offers
   the draft side flips only; R55 cross-references R163.
2. R163 says the block is mirrored when, unmirrored, the input pin of its
   first feedback chain lies below its output pin.
3. `forwardDistances`: the `signalDistances` root tier and the "reference
   branch" pass are removed (no corpus case used either); the undriven-block-input
   tier supplies the roots in the 14 cases without a port or source and stays.
   One port test.
4. Fifteen tests: the not-offered cases assert the plan equals the plan with
   the draft disabled; a four-part chain is drawn and a five-part chain is not
   recognised; two blocks feeding each other; a block with two output Nets;
   determinism.
5. Not in this round: splitting `placeBand` (follow-up task). The implementer
   notes that the rest of `placeBand` is not proven free of throws.
6. The transistor test runs before `classifyNets`.
7. Reproduced on the round-1 code (`TypeError`), fixed as requested, with a
   test for the reported topology and one for a two-pin part with both pins on
   one Net. A draft that leaves a device unplaced returns the problem
   `R163: draft left a device unplaced` and is refused like any strategy.

Reviewer rerun: build, typecheck, lint (0 errors), format:check, docs:check 0;
`pnpm test:local` 0 (810 files, 8349 passed, 117 skipped); `pnpm test:slow` 0
(the 2 slow files, 8 passed; untracked scratch copies under `tmp/` were picked
up as well); evaluation 0 with all 628 plan hashes equal to round 1.
