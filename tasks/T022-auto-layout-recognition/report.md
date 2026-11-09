# T022 report — round 2

## Summary

Addressed all six must-fix findings. Pair tails follow member polarity in template and layered placement, including shared tails and tails inside mirror units. Persisted mirrors keep their chosen output through the shared movement-unit builder. Deferred tails no longer hide labeled input pairs or composites. The BJT layered fixture now reaches the existing MOS-gated dispatch; the three shared-source fixtures share one mirror-load helper, and the unrelated R26 edit is reverted.

All 283 auto-layout tests pass. The full local suite passes with local PostgreSQL/socket access (7,564 passed, 116 skipped). Full structures score perfectly on all four recognition sources; no baseline-exact expectation is lost. Quick-mode width still exceeds the 1.5 ceiling on one validation document, so acceptance remains partial despite the other quick targets passing.

## Steps

| Step | Status  | Notes                                                                                                                                              |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Retained the benchmark and attributed fixtures; rescored the original unit predictions without changing before-units.json.                         |
| 2    | done    | R80 branches and descriptor/model families retained.                                                                                               |
| 3    | done    | Role-aware candidate rules retained; A1 fixes polarity-dependent tail placement.                                                                   |
| 4    | done    | Composite recognition retained; deferred-tail scoring now includes labeled composites.                                                             |
| 5    | done    | A2 shares unit construction and stacked-load reversal with persisted templates.                                                                    |
| 6    | done    | BJT C/E helpers retained; dispatch and layered BJT level rules remain frozen.                                                                      |
| 7    | done    | Regression tests cover p/n tails, shared p tails, mirror-member tails, persisted partner/reversal, and deferred tails; all auto-layout tests pass. |
| 8    | done    | Updated R7, R81, R83 and R84 for review findings, including the accepted BJT template-row effect.                                                  |
| 9    | partial | All acceptance commands run and evidence reported; one quick width ceiling remains exceeded.                                                       |

## Review findings addressed

| Finding                | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — tail direction     | Member polarity controls above/below placement. Template tail placement follows all member templates so a later mirror cannot overwrite it; the entire tail mirror moves together. Layered shared-tail rows use the same direction; single-tail axis alignment accounts for the tail pin within a mirror. Existing shared-tail horizontal bundling and median-axis handling remain. Tests cover both strategies, n/p current sources, p mirror tails and a shared p tail. |
| 2 — deferred tails     | Strip deferred tail members before prediction eligibility, mark the comparison tail-unlabeled, and omit it from labeled-tail outcomes. Core deferred members still exclude the structure. CircuitGenome marks pair/composite expectations tail-unlabeled when tail_current is deferred.                                                                                                                                                                                   |
| 3 — persisted mirrors  | Both paths use movementUnits. Persisted mirrors select their reference plus the lowest eligible output inside the persisted group; pairs retain their recognized tail. Stacked-load orientation uses recognized pairs even when only the load is persisted. R66 changes only its authorized comment/assertion.                                                                                                                                                            |
| 4 — BJT layered test   | Added an NMOS channel with drain on the BJT output, gate on a port and source on ground only in the layered fixture. BJT-only template coverage remains. R83 documents generic fallback for BJT-only layered documents.                                                                                                                                                                                                                                                   |
| 5 — unrelated R26 edit | Removed the extra supply-source evidence record. routing.test.ts now changes only the authorized shared-tail fixture and its helper import.                                                                                                                                                                                                                                                                                                                               |
| 6 — duplicated fixture | addMirrorLoads in document-fixture.ts supplies the mirror devices, supply Net and evidence for all three tests. Original geometric assertions remain.                                                                                                                                                                                                                                                                                                                     |

## Acceptance results

All commands used `ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`, and `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`. A3 substitutions use T021 baselines and frozen-file commit a188149. Logs are in git-ignored `tmp/t022/round2/`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date; pnpm 11.16.0.
pnpm format:check → 0; All matched files use Prettier code style.
pnpm docs:check → 0; no broken documentation links.
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; 0 errors (repository non-null-assertion warnings remain).
pnpm vitest run packages/auto-layout → 0; 15 files, 283 tests passed.
pnpm test:local (sandbox) → 1; 18 failed files, 58 failed tests, 7,472 passed, 149 skipped; PostgreSQL and loopback EPERM, plus launcher/recovery failures.
pnpm test:local (local access granted) → 0; 751 files passed, 2 skipped; 7,564 tests passed, 116 skipped.
pnpm deadcode 2>&1 | grep -E 'auto-layout|auto-layout-recognition' → 1; no output (grep found no matches, as required).
  Underlying knip exits 1 for unrelated unused files/exports in apps and other packages; no task-owned findings.
pnpm build → 0; all workspace builds complete (editor chunk-size warning remains).
pnpm auto-layout:review → 0; corpus review completes, including existing R14 route warnings.
pnpm auto-layout:recognition --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/after.json → 0.
pnpm auto-layout:recognition --units --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/after-units.json → 0.
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t022/t021-quick.json → 0; 33 completed.
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 --baseline tmp/t022/t021-search120.json → 0; 33 completed.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures → 0; empty.
git diff --stat a188149 -- packages/auto-layout/src/route.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/index.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/search-moves.ts packages/auto-layout/src/place.ts packages/auto-layout/src/place-fallback.ts scripts/auto-layout-eval.mjs scripts/auto-layout-review.mjs pnpm-lock.yaml → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|tmp/' → 1; no matches, as required.
git diff --check → 0.
```

Additional quick ablations use the same lane, baseline and evaluator with `--jobs 12`; both exit 0. Each ablation was built with only that fix active, then final sources were restored. No branch switches, commits, lockfile changes, plan/review edits or dependency changes were made.

## Investigation results

### Recognition

The original `tmp/recognition/before-units.json` is byte-for-byte unchanged (SHA-256 checked). `before-rescored.json` reuses its predictions with the corrected scorer and corrected CircuitGenome expectation annotations. `round1-rescored.json` applies the same correction to the previous full-structure predictions; it equals the new full-structure aggregate scores. Scores below are expected/predicted/matched, followed by precision/recall/exact percentages. Exact counts equal matched counts in every displayed row. Matched units are deliberately unscored.

| Source                      | Kind               | Before units, rescored        | After structures               | After units                    |
| --------------------------- | ------------------ | ----------------------------- | ------------------------------ | ------------------------------ |
| Hand (18)                   | mirror             | 7/9/4; 44.4/57.1/57.1         | 7/7/7; 100.0/100.0/100.0       | 7/7/5; 71.4/71.4/71.4          |
| Hand (18)                   | pair               | 9/10/5; 50.0/55.6/55.6        | 9/9/9; 100.0/100.0/100.0       | 9/9/9; 100.0/100.0/100.0       |
| Hand (18)                   | pair + mirror load | 3/0/0; 100.0/0.0/0.0          | 3/3/3; 100.0/100.0/100.0       | 3/0/0; 100.0/0.0/0.0           |
| Hand (18)                   | cross-coupled      | 1/0/0; 100.0/0.0/0.0          | 1/1/1; 100.0/100.0/100.0       | 1/0/0; 100.0/0.0/0.0           |
| Hand (18)                   | matched            | unscored                      | 1/1/1; 100.0/100.0/100.0       | unscored                       |
| Committed CircuitGenome (5) | mirror             | 6/6/6; 100.0/100.0/100.0      | 6/6/6; 100.0/100.0/100.0       | 6/6/6; 100.0/100.0/100.0       |
| Committed CircuitGenome (5) | pair               | 5/5/4; 80.0/80.0/80.0         | 5/5/5; 100.0/100.0/100.0       | 5/5/5; 100.0/100.0/100.0       |
| Committed CircuitGenome (5) | pair + mirror load | 2/0/0; 100.0/0.0/0.0          | 2/2/2; 100.0/100.0/100.0       | 2/0/0; 100.0/0.0/0.0           |
| All CircuitGenome (864)     | mirror             | 336/444/336; 75.7/100.0/100.0 | 336/336/336; 100.0/100.0/100.0 | 336/444/336; 75.7/100.0/100.0  |
| All CircuitGenome (864)     | pair               | 432/432/288; 66.7/66.7/66.7   | 432/432/432; 100.0/100.0/100.0 | 432/432/432; 100.0/100.0/100.0 |
| All CircuitGenome (864)     | pair + mirror load | 78/0/0; 100.0/0.0/0.0         | 78/78/78; 100.0/100.0/100.0    | 78/0/0; 100.0/0.0/0.0          |
| LOADBench (101)             | mirror             | 199/199/116; 58.3/58.3/58.3   | 199/199/199; 100.0/100.0/100.0 | 199/199/116; 58.3/58.3/58.3    |
| LOADBench (101)             | pair               | 59/59/59; 100.0/100.0/100.0   | 59/59/59; 100.0/100.0/100.0    | 59/59/59; 100.0/100.0/100.0    |
| LOADBench (101)             | pair + mirror load | 19/0/0; 100.0/0.0/0.0         | 19/19/19; 100.0/100.0/100.0    | 19/0/0; 100.0/0.0/0.0          |

All hand kinds have precision/recall/exact 1, including all 54 seeded rename/shuffle trials. Both external datasets meet or exceed the corrected unit baseline for every scored kind. The retention audit has **zero lost baseline-exact expectations**. Full mirrors recover the 83 LOADBench multi-output sets that two-member units cannot express. CircuitGenome units contain 108 extra partial mirrors whose full structures include deferred members; these remain visible in unit scoring. Unscored full matched-pair predictions: committed CircuitGenome 1, all CircuitGenome 216, LOADBench 1.

Scoring correction versus round 1: CircuitGenome pair matches rise 288→432 and composites 52→78; LOADBench pair matches rise 47→59 and composites 17→19. Predictions did not change. The corrected old unit baseline also rises to 288/432 CircuitGenome pairs and 59/59 LOADBench pairs, so the comparison uses the same rules on both sides.

| Source                      | Mode             | Labeled tails | Correct | Wrong | Missed | Ambiguous |
| --------------------------- | ---------------- | ------------: | ------: | ----: | -----: | --------: |
| Hand (18)                   | before units     |             9 |       5 |     1 |      3 |         0 |
| Hand (18)                   | after structures |             9 |       8 |     0 |      0 |         1 |
| Hand (18)                   | after units      |             9 |       8 |     0 |      0 |         1 |
| Committed CircuitGenome (5) | before units     |             5 |       4 |     0 |      1 |         0 |
| Committed CircuitGenome (5) | after structures |             5 |       5 |     0 |      0 |         0 |
| Committed CircuitGenome (5) | after units      |             5 |       5 |     0 |      0 |         0 |
| All CircuitGenome (864)     | before units     |           288 |     144 |     0 |    144 |         0 |
| All CircuitGenome (864)     | after structures |           288 |     288 |     0 |      0 |         0 |
| All CircuitGenome (864)     | after units      |           288 |     288 |     0 |      0 |         0 |
| LOADBench (101)             | before units     |             0 |       0 |     0 |      0 |         0 |
| LOADBench (101)             | after structures |             0 |       0 |     0 |      0 |         0 |
| LOADBench (101)             | after units      |             0 |       0 |     0 |      0 |         0 |

Correct includes a correctly absent tail; ambiguous outcomes are separate. Deferred or unlabeled tails are excluded from tail statistics. The five most frequent mismatch shapes per source/mode are below; per-case details remain in tmp/recognition.

| Source                      | Mode             | Mismatch shapes (count)                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand (18)                   | before units     | unexpected mirror (1 output, 1 reference): **5**; unexpected pair (2 input): **4**; missing pair (2 input, 1 tail): **3**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **3**; missing mirror (2 output, 1 reference): **1**                                                                            |
| Hand (18)                   | after structures | none                                                                                                                                                                                                                                                                                                                                                                          |
| Hand (18)                   | after units      | missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **3**; unexpected mirror (1 output, 1 reference): **2**; missing mirror (2 output, 1 reference): **1**; missing mirror (1 output, 2 reference): **1**; missing cross-coupled (2 member): **1**                                                             |
| Committed CircuitGenome (5) | before units     | missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **2**; missing pair (2 input, 1 tail): **1**; unexpected pair (2 input): **1**                                                                                                                                                                             |
| Committed CircuitGenome (5) | after structures | none                                                                                                                                                                                                                                                                                                                                                                          |
| Committed CircuitGenome (5) | after units      | missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **2**                                                                                                                                                                                                                                                      |
| All CircuitGenome (864)     | before units     | missing pair (2 input, 1 tail): **144**; unexpected pair (2 input): **144**; unexpected mirror (1 output, 1 reference): **108**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **52**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference): **26** |
| All CircuitGenome (864)     | after structures | none                                                                                                                                                                                                                                                                                                                                                                          |
| All CircuitGenome (864)     | after units      | unexpected mirror (1 output, 1 reference): **108**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference, 1 tail): **52**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference): **26**                                                                              |
| LOADBench (101)             | before units     | unexpected mirror (1 output, 1 reference): **83**; missing mirror (2 output, 1 reference): **40**; missing mirror (3 output, 1 reference): **32**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference): **19**; missing mirror (4 output, 1 reference): **9**                                                           |
| LOADBench (101)             | after structures | none                                                                                                                                                                                                                                                                                                                                                                          |
| LOADBench (101)             | after units      | unexpected mirror (1 output, 1 reference): **83**; missing mirror (2 output, 1 reference): **40**; missing mirror (3 output, 1 reference): **32**; missing pair + mirror load (1 input-output-side, 1 input-reference-side, 1 load-output, 1 load-reference): **19**; missing mirror (4 output, 1 reference): **9**                                                           |

### Layout and isolated fixes

All comparisons use the documents completed by both runs. T021 quick completes 32; all T022 quick variants complete 33. The review’s rebased round-1 quick result is 274/370 dev/val crossings, 705 bends and 64 floating pins on common documents. A2 alone reproduces those values. A1 includes the direction change plus required whole-mirror tail placement and pin-axis alignment.

| Run (32 common) | Dev crossings | Val crossings | Total | Bends | Floating pins | Wire length | Label overlaps | Label clearance | Terminal departures | Max width ratio |
| --------------- | ------------: | ------------: | ----: | ----: | ------------: | ----------: | -------------: | --------------: | ------------------: | --------------: |
| T021 quick      |           263 |           387 |   650 |   702 |            63 |      219860 |              3 |              59 |                  13 |          1.0000 |
| A1 only         |           239 |           385 |   624 |   680 |            54 |      222640 |              2 |              63 |                  14 |          1.5776 |
| A2 only         |           274 |           370 |   644 |   705 |            64 |      217020 |              3 |              64 |                  16 |          1.0784 |
| A1 + A2         |           239 |           385 |   624 |   680 |            54 |      222640 |              2 |              63 |                  14 |          1.5776 |
| T021 search120  |           195 |           322 |   517 |   607 |            72 |      214480 |              5 |              54 |                  12 |          1.0000 |
| T022 search120  |           188 |           301 |   489 |   584 |            60 |      217500 |              3 |              56 |                  13 |          1.7011 |

Quick: crossings improve 650→624, bends 702→680, floating pins 63→54. Common-document wire length changes by +1.26%. Completion, split-crossing, bend and floating-pin targets pass; unchanged corpus and held-out tests pass. **Width fails:** the maximum is 1.5776, above 1.5.

The newly completed dev document is separate: 60 crossings, 58 bends, 17 floating pins, 18470 wire units, width 1815; label overlaps/clearance/departures 1/19/1. It is the sole document affected by ambiguous-source pairing: four unsupported switch pairs are removed. T021 has no completed result or width denominator. Including this drawing gives 684 crossings and 241110 wire units; the overall wire increase is 9.67%, explained by the newly completed document (common rise is below 5%).

Search ran with no other heavy task active, `--search 120 --seed 1 --jobs 12`, against T021’s **517** crossings (195 dev / 322 val), not the superseded T020 total 495. Common-document crossings are 489 (-28); wire length changes +1.41%. Search completes 33 documents. The newly completed drawing contributes 60 crossings, 58 bends, 17 floating pins and 18470 wire units (label overlaps/clearance/departures 1/19/1); total crossings including it are 549. Including the new drawing, search wire length is 235970 (+10.02% versus T021); its 18470 units explain most of the rise, while the common-document increase is 1.41%. Search label clearance rises 54→56 and terminal departures 12→13 alongside the changed tail placements and selected search candidates; overlaps improve 5→3. Search is wall-clock dependent.

### Anonymous quick effects

The following rows include every changed common-document metric and the newly completed drawing. Labels are report-local and contain no case identifiers. Values are crossings / bends / floating pins / wire length; readability is label overlaps / clearance / terminal departures. The A1 column compares final quick to A2-only, isolating tail placement from recognition. No held-out-specific tuning was performed.

| Document | Split | T021 quick            | Final quick           | A1 crossing delta | Width ratio | Readability before → after |
| -------- | ----- | --------------------- | --------------------- | ----------------: | ----------: | -------------------------- |
| Q01      | dev   | 43 / 31 / 6 / 9360    | 33 / 27 / 0 / 9220    |               -10 |      0.9249 | 0/4/1 → 0/3/2              |
| Q02      | val   | 21 / 22 / 8 / 6190    | 30 / 31 / 8 / 11040   |                +9 |      1.5776 | 0/5/0 → 0/4/1              |
| Q03      | dev   | 63 / 36 / 0 / 16310   | 46 / 35 / 7 / 13340   |               -17 |      0.9878 | 0/2/2 → 0/6/1              |
| Q04      | val   | 27 / 29 / 7 / 13610   | 32 / 26 / 0 / 15630   |                +9 |      1.1862 | 0/1/0 → 0/0/0              |
| Q05      | val   | 133 / 73 / 21 / 26190 | 133 / 76 / 21 / 26130 |                +0 |      0.9929 | 3/16/1 → 2/18/1            |
| Q06      | dev   | 17 / 18 / 0 / 5510    | 14 / 17 / 0 / 5380    |                -7 |      1.0000 | 0/0/0 → 0/0/0              |
| Q07      | dev   | 6 / 18 / 3 / 3560     | 7 / 19 / 3 / 3660     |                +0 |      1.0186 | 0/0/0 → 0/2/0              |
| Q08      | dev   | not completed         | 60 / 58 / 17 / 18470  |                +0 |           — | — → 1/19/1                 |
| Q09      | dev   | 11 / 20 / 0 / 5330    | 11 / 20 / 0 / 5000    |                +0 |      1.0227 | 0/1/1 → 0/2/1              |
| Q10      | val   | 28 / 22 / 0 / 8370    | 25 / 18 / 0 / 8120    |                +0 |      1.0000 | 0/1/1 → 0/0/1              |
| Q11      | val   | 10 / 19 / 3 / 3710    | 7 / 18 / 0 / 4370     |                +0 |      1.0784 | 0/0/0 → 0/0/1              |
| Q12      | val   | 56 / 52 / 0 / 19280   | 52 / 43 / 0 / 18430   |                -4 |      0.9920 | 0/1/0 → 0/1/0              |
| Q13      | val   | 14 / 16 / 0 / 3720    | 8 / 10 / 0 / 2920     |                -3 |      0.8811 | 0/1/0 → 0/0/0              |
| Q14      | dev   | 7 / 11 / 0 / 3610     | 12 / 5 / 0 / 4290     |                -1 |      1.0914 | 0/0/1 → 0/0/0              |

The width outlier is a p pair with a PMOS tail (not a mirror member). Correcting its supply-side row changes the selected portfolio candidate from layered to template; width is 883→1393 and crossings 21→30. The tail-direction ablation reproduces it, while A2 alone does not. The table exposes other per-document crossing/readability costs. Aggregate label clearance rises 59→63 and terminal departures 13→14 because tail rows and the resulting selected placements change; label overlaps improve 3→2. These counts are reported without changing frozen T021 scoring or the router. The accepted BJT C/E template-row effect remains a +1-crossing dev change.

### Counts per rule

Counts use the human documents with layout groups cleared, as in the original survey, and compare against T021 recognition. `git diff 5a1af66 a188149 -- recognize.ts net-roles.ts` is empty; rerunning the final human recognition survey gives exactly the same structural results as round 1. A1 changes placement and A2 changes persisted reconstruction, not these clean-document structures. A changed unit keeps its kind/two representatives but changes ordering, tail or extra members. Tail gains/losses refer to retained pair identities. Family rejections count same-polarity shared-source candidates rejected by descriptor/model; finger counts are multi-instance logical branches.

| Measure                        | Dev | Val |
| ------------------------------ | --: | --: |
| Units before                   |  32 |  41 |
| Units after                    |  28 |  37 |
| Units added                    |   0 |   3 |
| Units removed                  |   4 |   7 |
| Units changed                  |   3 |   9 |
| Pairs dropped as ambiguous     |   4 |   0 |
| Tails gained on retained pairs |   2 |   2 |
| Tails lost on retained pairs   |   0 |   2 |
| Tail-bearing units before      |  14 |  10 |
| Tail-bearing units after       |  12 |  10 |
| BJT units                      |   0 |   0 |
| Family rejections              |   0 |   0 |
| Finger branches                |   1 |   2 |

## Deviations and open questions

1. **Width acceptance remains open for Opus:** one validation drawing is 1.5776× T021 width. The required p-tail direction is retained. No adjustment was made to frozen portfolio scoring or routing to force that ceiling to pass; Opus should decide whether to accept this tradeoff or authorize follow-up. Other quick numeric ceilings pass on common documents.
2. No product-scope deviations were made. Template mirror-tail postprocessing and layered pin offsets implement the review’s explicit whole-mirror/axis requirement; the BJT test and R66 expectation follow A2 and review item 4.
3. Family policy is exact descriptor id and matching model identity when both carry one. Depletion MOS and DMOS match only their own descriptor, never ordinary nmos/pmos. Sizes are ignored; missing metadata permits compatibility but different model identities do not collapse into one branch.
4. Retained round-1 test change: the three-candidate shared-source test yields an a/c matched pair instead of an arbitrary a/b differential pair because a/c share a gate and no unique composite identifies two inputs. Three R32 fixtures now supply mirror-load evidence without weakening geometry assertions.
5. Full local tests require PostgreSQL/loopback access; the sandbox attempt and successful permitted rerun are both recorded. Global deadcode findings remain outside task ownership; the required task-path filter is empty.
6. No human drawing, excerpt, case id, id-keyed output, LOADBench file or local mismatch detail is included in tracked changes. Only the permitted five attributed CircuitGenome fixtures remain. This work verifies topology/layout, not transistor operating points; no simulation claim is made.
