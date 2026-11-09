# T022 review

## Round 1 — changes-requested

Reviewed: the round-1 working tree on `task/T022-auto-layout-recognition`.

**Rebase.** Opus rebased the plan commit and the uncommitted round-1 work onto `main` at
`a188149`, where T021 has merged. The only conflict was `docs/specs/auto-layout.md`;
Opus kept T021's R73/R74 followed by R80–R84. The branch now starts at `37bb4f7`
(plan) on `a188149`. **All layout baselines are now T021's** (see the plan's round-2
amendment).

**What holds up.**

- The recognizer and both converters are sound.
- Hand cases are exact, and the rename and shuffle runs pass.
- LOADBench mirrors went from 58% to 100%, and composites from 0% to 89%.
- Every baseline-exact structure is kept.

**Opus's quick rerun on the rebased tree,** against T021 quick (`tmp/t022/t021-quick.json`):

| Documents           | Measure                           | T021 | Round 1      |
| ------------------- | --------------------------------- | ---- | ------------ |
| 32 common           | crossings                         | 650  | 644          |
| 32 common           | bends                             | 702  | 705          |
| 32 common           | floating pins                     | 63   | 64           |
| dev common          | crossings                         | 263  | 274          |
| val common          | crossings                         | 387  | 370          |
| newly completed (1) | crossings / bends / floating pins | —    | 60 / 58 / 17 |

**Where dev regresses.** Opus rendered the two largest dev regressions (+4 and +6
crossings), human | before | after, in `tmp/t022/render/r1-dev0{0,2}.png`. Both are PMOS
pairs that newly gained a current-source tail fed from the supply. Template and layered
placement both put every tail **one row below** its pair:

- `template-placement.ts`, the tail block in `expandTemplates`: `rows.set(tail, row + 1)`;
- `layered.ts:207-220`: `node.row = Math.max(node.row, pairRow + 1)`.

So the PMOS tail lands at the bottom of the drawing, and its supply wire runs back up
across the circuit. The human drawings place it above the pair, under the supply.
Before T022 almost no PMOS pair had a tail, which is why this never showed.

| #   | Severity | Where                                                                                                                                                                                      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                  | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/template-placement.ts` (tail block in `expandTemplates`), `src/layered.ts:207-220` and any other tail-row assumption in `layered.ts` (`:353-357`, `:504-517`, `:607-613`, `:700-718`) | Tails always sit one row below their pair, so a p pair's supply-side tail lands at the bottom (plan amendment A1).                                                                                                                                                                                                                                                                                                       | A tail sits one row toward its supply side: **below an n pair, above a p pair**. Polarity comes from the pair members (`polarity()`). This applies to shared tails and to a tail that is a mirror member. Add tests: a PMOS pair whose current-source tail goes to VDD has the tail one row above the pair, on the pair axis, in `template` and `layered`; the NMOS case is unchanged. Report the dev/val quick effect of this fix alone.                                                                                                                                                                                                           |
| 2   | must-fix | `src/recognition-score.ts:61-64` and the CircuitGenome converter in `scripts/auto-layout-recognition.mjs`                                                                                  | **A deferred tail makes the whole prediction unscored.** A pair whose tail is a deferred cascode device is dropped, so a correct pair counts as missed. This causes the 144 "missing pair (2 input)" in CircuitGenome and the 12 in LOADBench, plus the composite misses. In addition, the CircuitGenome converter labels a pair whose tail slot is deferred with no tail instead of `tailUnlabeled`, a gap in the plan. | In the scorer, drop a `tail` member that is deferred from a prediction **before** the eligibility check; that structure is then compared as tail-unlabeled. In the converter, mark the pair and composite expectations `tailUnlabeled` whenever the `tail_current` slot is not labeled. Update R84. Rerun all four sources and report before/after again (the `--units` baseline file stays as is; rescore it with the new scorer).                                                                                                                                                                                                                 |
| 3   | must-fix | `src/recognize.ts` `persistedTemplates` and `test/search.test.ts:345-371`                                                                                                                  | **A user-persisted mirror template is silently lost.** A persisted `current-mirror` group `[a, c]` over a mirror with outputs `b, c, d` yields no template: the inferred unit `[a, b]` is not a subset of `{a, c}`. The search test then fails (plan amendment A2).                                                                                                                                                      | `persistedTemplates` builds each persisted group's unit from the recognized structures, using the same unit-building code as `recognizeStructures` (no copy):<br>• **mirror:** reference representative in the group plus the lowest-id output representative in the group;<br>• **pairs:** both members in the group, with the structure's tail;<br>• the existing stacked-load reversal applies.<br>Change `search.test.ts:371` to `[["a", "c"]]` and update its comment to say the persisted mirror keeps its chosen output. The test's purpose (search units equal quick templates) stays. Add a recognize test for the persisted-partner case. |
| 4   | must-fix | `test/recognition-placement.test.ts:16-58`                                                                                                                                                 | A BJT-only document never reaches layered placement: the `place.ts:188` dispatch requires a MOS channel, and `place.ts` stays frozen.                                                                                                                                                                                                                                                                                    | Keep the `template` case. For `layered`, add one NMOS whose drain is the mirror output Net (gate on a port, source on ground), so the existing dispatch reaches layered, and assert the same BJT symmetry. State in R83 that BJT-only documents keep the generic fallback.                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | must-fix | `test/routing.test.ts` (R26 "refuses a singleton stub…", `supply-source` evidence)                                                                                                         | An unrelated test was changed. Opus reverted the hunk and the test passes without it.                                                                                                                                                                                                                                                                                                                                    | Revert that hunk. Change only the three tests the plan names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | must-fix | `test/layered.test.ts:95`, `:389`, `test/routing.test.ts:213`                                                                                                                              | The same ~45-line block (mirror loads, supply net, two evidence records) is pasted three times.                                                                                                                                                                                                                                                                                                                          | Move it into one helper in `test/document-fixture.ts`, for example `addMirrorLoads(document, pairs)`, and call it from all three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | note     | `src/template-placement.ts:22-36`                                                                                                                                                          | `channels()` now includes BJT C/E, so `rankRows` also ranks BJTs in template placement. One dev BJT document moved by +1 crossing.                                                                                                                                                                                                                                                                                       | Accepted: the plan named this helper. Mention it in R83 as a template-row effect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | note     | report, layout section                                                                                                                                                                     | Round 1 compared against T020.                                                                                                                                                                                                                                                                                                                                                                                           | Round 2 compares against T021 (amendment A3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Acceptance rerun by Opus** (lane 2, rebased tree):

```text
pnpm vitest run packages/auto-layout → 1; 262 passed, 2 failed (BJT layered, R66 search units), as reported
pnpm vitest run packages/auto-layout/test/routing.test.ts -t "R26 refuses a singleton stub" with Codex's evidence hunk removed → 0; 1 passed
pnpm build → 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t022/t021-quick.json → 0; 33 completed (numbers above)
```

## Round 2 — accepted

Reviewed: the round-2 working tree on `task/T022-auto-layout-recognition`, rebased on
`a188149`. Opus reran every acceptance command (lane 2; logs in `tmp/t022/accept2/`).
Opus's quick result is byte-identical to Codex's.

All six findings are fixed:

- **Tail direction.** Tails sit below n pairs and above p pairs in both strategies. A tail
  that belongs to a mirror moves with its whole mirror.
- **Scorer.** A deferred tail is stripped before the eligibility check.
- **Persisted templates.** They share the unit builder with inferred templates.
- **BJT layered test.** It reaches layered placement through an added NMOS.
- **Fixtures.** The R26 edit is reverted, and the three shared-source fixtures share
  `addMirrorLoads`.

**Recognition** (full structures, Opus rerun). Hand, committed CircuitGenome, all 864
CircuitGenome and the 101 LOADBench cases score precision = recall = exact = 1 for every
labeled kind. No baseline-exact expectation is lost.

LOADBench labels are independent (ACST structure recognition). CircuitGenome mirror
outputs are derived from slot seeds by the same definitional rule, so treat CircuitGenome
as a consistency check rather than independent evidence.

**Layout**, 32 documents common with T021 quick (`tmp/t022/t021-quick.json`):

| Measure                                          | T021                    | T022                    |
| ------------------------------------------------ | ----------------------- | ----------------------- |
| Crossings                                        | 650 (dev 263 / val 387) | 624 (dev 239 / val 385) |
| Bends                                            | 702                     | 680                     |
| Floating pins                                    | 63                      | 54                      |
| Wire length                                      | 219,860                 | 222,640 (+1.3%)         |
| Label overlaps / clearance / terminal departures | 3 / 59 / 13             | 2 / 63 / 14             |

- **Newly completed dev document.** It completes for the first time: 60 crossings, 58
  bends and 17 floating pins. It is the current-steering document whose four id-ordered
  fake pairs are now dropped.
- **Search** (`--search 120`, Codex's run with no other heavy work; Opus did not rerun
  it, because T023's Codex was running at the same time): 489 crossings against 517,
  584 bends against 607, 60 floating pins against 72.

**Accepted exception: one val document exceeds the 1.5 width ceiling (1.58).**

- Its p pair now has its PMOS tail correctly above the pair. With that, the portfolio
  picks `template` over `layered`. The result is 883 → 1393 wide, with crossings 21 → 30.
- A1 improves every dev document it touches (−17, −10, −7, −1 crossings). On val it is
  mixed (+9, +9, −4, −3) but still lowers the val total.
- Tuning on val is not allowed, and the rule is correct.
- **Opus decision:** accept, report the case plainly with its render, and leave portfolio
  selection for p-pair tails to a follow-up.

Another per-document cost: one dev document drops 17 crossings but gains 7 floating
ground pins. Its grounds become fallback labels instead of routed wires.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm vitest run packages/auto-layout → 0; 283 passed (15 files)
pnpm test:local → 0; 7564 passed, 116 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout|auto-layout-recognition' → no output
pnpm build → 0
pnpm auto-layout:review → 0
pnpm auto-layout:recognition --loadbench … --circuitgenome … → 0 (all kinds 1/1/1)
pnpm auto-layout:recognition --units --loadbench … --circuitgenome … → 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t022/t021-quick.json → 0; 33 completed
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures → empty
git diff --stat a188149 -- <frozen files> → empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|tmp/' → no output
```
