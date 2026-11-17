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
