# T137 review

Implemented by Claude subagents (Opus), reviewed by the planner; the owner
asked on 2026-11-16 for subagents instead of Codex.

## Round 1 — accepted after two guards were added

The implementation was made on `main` at `65075a0`. T136 (R166) and T138
(R168) merged while it was reviewed; it was rebased twice and the numbers
below are for the final tree on `main` at `347082f`.

What changed during review:

- **Relation checks.** The experiment's acceptance read four structural
  detector counts. On 302 cases the pass without them and with a gate-level
  check alone had the same worse cases (14) and crossings; the check cost
  bends (1247 against 1240), so the implementation shipped none. Two guards
  came back for reasons found later (below).
- **Stack guard.** On the first reviewer run the pass shifted one member of a
  stack that R166 keeps in column in five cases: R147's rigid units join only
  vertical facing stacks of transistors, resistors, diodes and inductors, so a
  current source over a transistor moved alone. A stack (R166's relation and
  `stackHolds`) that holds on the incumbent must hold on the trial.
- **Level-row guard.** A blind preference test (below) preferred the earlier
  drawing mainly where the pass had pulled a transistor out of the row it
  shared with another transistor to straighten a gate line; 53 of 206 accepted
  moves on the judged cases did that. A pair of transistors level on the
  incumbent (same channel axis, reference points at most 2 apart) must stay
  level. Both guards are monotone: a relation already broken blocks nothing.
- **Declined replan.** R149's replan returned the pre-gap incumbent for a
  declined trial, which the pass could have taken for progress (42 such trials
  on 302 cases, none accepted). A declined trial is now rejected; R149's replan
  closure is hoisted for it and shares one incumbent object that R149 only
  reads.
- Not adopted, measured: rejecting a move that leaves a new step larger than 20
  on a moved pin (one fewer worse case, 39 fewer jogs removed, a judged gain
  partly lost); restricting the pass to the selected finalist (finalist
  switches give both the largest regressions and judged gains; measured
  offline only).

Two existing tests changed:

- `block-direction.test.ts`: the pinned plan of a block-free document
  (`b75ab103…` on `main` at `65075a0`) has two jogs that R167 straightens; the
  pin is now `477fddfc…`, recorded from this branch, with a comment. It
  guards that shape against later drift but no longer proves equality with the
  plan before R164. Unchanged beside it: the mechanism test "does not reverse
  a chain whose input is a grounded source" and the pin of "plans a document
  without directed blocks exactly as main".
- `cross-coupled.test.ts`: R144's route call is found by its option instead of
  being the last call, because R167 trials may route after it.
- `corpus.test.ts` (from the PR 91 review): a ground marker may sit on its
  host pin only when that is the pin it touched in the input.

Reviewer run on the final tree: build, typecheck, lint, format:check,
docs:check 0; `pnpm test:local` 0 (819 files, 8473 passed, 117 skipped);
`pnpm test:slow` 0 (2 files, 8 passed); both evaluations 0.

| Plan acceptance line                                    | Result against `main` (`347082f`)                                                                                                     | State        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| No threw; same 16 refused; equivalent; no defects       | 612 / 16 same; 0 not equivalent; introduced dangling / unconnected / touching 0                                                       | met          |
| A case without a jog keeps its plan hash                | Not remeasured here. On `65075a0`, 7 such plans changed, all finalist switches (explained in the implementer report)                  | not met      |
| Crossings, bends not higher                             | 316 → 316; 2134 → 2048                                                                                                                | met          |
| Label overlaps, label clearance not higher              | 3 → 3; 217 → 212; label-ownership flags 12 → 10                                                                                       | met          |
| Long-narrow not higher                                  | 73 → 73 (aspect ≥ 2, measured in round 2)                                                                                             | met          |
| Planner-only jogs, dev and val                          | 311 left on this tree; `main` has no jog key to compare. On `65075a0`, before the guards: 432 → 290                                   | not measured |
| Worse cases at most 31                                  | 11 of 79 changed by the plan's full definition (crossings, bends, wire +40, an extent +20), 2 of them restricted; measured in round 2 | met          |
| The experiment's 6 gained cases keep their jogs removed | On `65075a0`: 4 of 6; the other two had no jog on that base                                                                           | not measured |
| Planning time                                           | Median ×1.02, p90 ×1.08 interleaved on 40 cases on `65075a0`, before the guards; the guards add two pose comparisons per trial        | not measured |
| Netlist (node 0)                                        | 515 completed and equivalent, no introduced defect; 76 changed; crossings 326 → 326; bends 2077 → 2016                                | met          |
| Renders                                                 | Implementer's 16 on `65075a0`; the reviewer looked at the blind material                                                              | not measured |

No R166 stack is newly broken in either mode (five cases before the guard).

Blind reviews:

- Acceptable or not (two calibrated reviewers, before/after without version
  labels, 90 judged cases): acceptable 22 → 24; 4 gained, 2 lost. This review
  was made on the first reviewer run, before both guards, and was not
  repeated on the final tree. The pass straightens wires in drawings that are
  rejected or accepted for other reasons; this measure barely moves.
- Which of the two (ORIGINAL beside the two automatic drawings, sides assigned
  at random; not calibrated against the owner's labels). Before the row guard,
  98 cases: new 38, earlier 28, same 32. On the final tree, 79 changed cases:
  67 are byte-identical to pairs judged earlier (before the rebase onto R168,
  most of them before the row guard was added, eight after it), 9 of those 67
  are restricted and have no verdict, so 58 verdicts carry over; 12 were judged
  afresh by one reviewer; 70 verdicts in total: new 32, earlier 14, same 24 (clear preferences 7 to 4; "clear" is
  the reviewer's own strength label, slight or clear, given with each
  preference). This evidence supports the change but does not decide it: 67
  of the 79 pairs are byte-identical to pairs judged earlier, 9 of those 67 are
  restricted and have no verdict, so 58 verdicts carry over; 12 were judged
  afresh; 70 verdicts in total; and the method is not calibrated against the owner. The decisive
  facts are no introduced defect, fewer bends and no relation broken.

Measured on the way and not in this change: giving R147's alignment-phase
replan the contact policy of the gaps phase (it rejects every trial in a
document with a licensed pin contact today) changes 73 plans on `65075a0`,
crossings 334 → 328, bends 2337 → 2297. A follow-up task.

Open after this task: about 310 planner-only jogs remain (overlap, rising
bends, the router re-jogging after the move); finalist switches; the three
cases the last reviewer preferred the earlier drawing in (an output moved to
the top, a taller narrower outline, a resistor crowded beside a source).

## Round 2 — changes requested (PR review of 513d478)

| #   | Severity | Where                                 | Finding                                                                  | Resolution                                                                                                                                                                      |
| --- | -------- | ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1       | `pin-jogs.ts` `translatedUnit`        | A carried one-pin marker in `fixedInstanceIds` could move                | The trial is skipped when a carried marker is fixed or locked (leaving it behind would make a new jog at it); test "does not carry a fixed marker"; clause in R167              |
| 2   | P2       | R167 rationale in the specification   | The paragraph said the stack and level checks are not part of the rule   | Rewritten for the shipped rule; counts recounted on `main` 347082f with R167                                                                                                    |
| 3   | P2       | this record, "Worse cases at most 31" | Not measured by the plan's full definition                               | Measured below                                                                                                                                                                  |
| 4   | P3       | `pin-jogs.test.ts`                    | The locked half of the fixed/locked test passed without the pass's check | Split: "never moves a fixed part" and "does not try a unit with a locked member", whose replan ignores the lock                                                                 |
| 5   | P3       | `block-direction.test.ts`             | The name claimed a plan "as before"                                      | Renamed "leaves a source-driven passive chain without an input port to R167 alone"; comment says what it guards                                                                 |
| 6   | P3       | `auto-layout.ts` timing               | R167 time was reported under "gaps"                                      | Own phase `pinJogs`; no script reads phase names, and the one test that does uses `toMatchObject`                                                                               |
| 7   | P3       | budget                                | Not halved for attachment-draft finalists                                | Left un-halved: the specification halves only the relocation, port-seat and rail-seat budgets, and R167's eight trials are rarely used (at most seven, most passes one or none) |
| 8   | P3       | this record, blind reviews            | Run, "clear" and the weight of the pairwise evidence unstated            | Stated in the round 1 list above                                                                                                                                                |

The P1 was not reproduced through public `planAutoLayout` with
`fixedInstanceIds`: ten resistor-chain shapes with a fixed ground marker left
no fixed instance moved even without the check (the selected plan had no jog
for R167 to act on), and the transistor shapes tried did not plan. The test
uses the pass directly, as the reviewer's probe did. Other moved instances: the
pass moves only the unit and its carried markers (ports are markers); R149's
replan moves single-host ports with their host but excludes fixed ports.

### Round 2 result

From `tmp/rv-drawing/report.json` (reviewer run of `513d478`) against
`tmp/inputs/main-347082f-drawing-report.json`. The P1 fix does not change a
corpus plan (no corpus case has fixed instances).

Changed cases: 79, of them 9 restricted. The others: 23wahmw6b2 2bgg3pxz64
3byq69ryhz 3qr7ymvw7w 55g7v28588 57zs7ayept 59zd8d2t9q 5sjds93cfr 66v23j7kaw
6ecccd6yxz 6h64rkphmh 85c84m4tjv 9db5aza768 a2nn9n6pbn aqfb9kjcfj az52eb56jd
b8q5tfkf2f bbr8qbcane bxw2egnpy9 d6egcq7hxy dagyjgbwgw dhnx9vs3zf dkp3ehx5jt
ean7z7acmp ec8bty96h4 etswaaj69w f1a0b46a-180f-47cc-9bb2-815554aa7575
faf6sbq7bc g8xh7jm33z gebpb6er9t gh3gcb5h3a gwer4fr5c3 gx36d3sre9 gxkpf3k899
hatmn7acta hdag4x8jrw hjtfydjx52 hn696gkbcc hrya6nrqet hxtd3j2d3f jgpyrcegvt
jhpfmtx5ay jxsdnr86f8 jzq4wvkwmf k62rb9a48j k6bybqnz4b kaxfrg2ass kcjf773py8
kr2aqwe5cc ksx7dv7cfw mfeab85zqw mk48adpv2c ne46whs3fw nwarxxcwp7 nxd3aqa7fp
p2whdap25e qgc6fm8kpe qmcytns39z rgyv3sw7qe sgr73ppwvq sgtt4psa7z tc45yqjk5g
tcb2mf7y5d v4s2nhgpw3 wxe2jap3xa x7wr36szy7 z7zzac64t2 z8wdtvknpa zp3r9haqg7
zsgcm4w69n.

Worse cases by the plan's definition (crossings or bends higher, wire +40 or
more, width or height +20 or more): 11, of them 2 restricted; none is worse
on crossings. Non-restricted (crossings / bends / wire / width / height):
jhpfmtx5ay 0/0/−20/−58/+168, 6ecccd6yxz 0/−5/−20/+160/−12, ec8bty96h4
0/−7/−110/+79/+2, kr2aqwe5cc 0/−1/−70/−35/+60, qmcytns39z 0/+1/−80/−32/−30,
kcjf773py8 0/0/+20/−10/+30, hn696gkbcc 0/−3/−40/−18/+20, gxkpf3k899
0/−1/−20/0/+20, ean7z7acmp 0/−2/−40/0/+20. The largest five, from the
reports' strategies and metrics (not from the drawings):

- jhpfmtx5ay: strategy switch (layered → stages); taller and narrower.
- 6ecccd6yxz: strategy switch (stages → template); wider, five bends fewer.
- ec8bty96h4: finalist switch within stages (chain 2 → 1 on `65075a0`);
  wider, seven bends fewer, wire −110.
- kr2aqwe5cc: strategy switch (stages → layered); taller.
- qmcytns39z: same convention draft; one bend more, outline smaller on both
  axes, wire −80.

Ranked by the largest growth of one extent; qmcytns39z is listed for its extra
bend. One restricted case would rank fifth by that measure (+58).

Long-narrow (aspect of the layout box at least 2, the measure of
`scripts/netlist-input-compare.mjs`; the drawing report has none of its own)
over all completed cases: 73 → 73; long-narrow where the human drawing is not
(also at least 1.5 × its aspect): 48 → 47.

Reviewer check of round 2: build, typecheck, lint, format:check, docs:check 0;
`pnpm test:local` 0 (819 files, 8475 passed, 117 skipped); `pnpm test:slow` 0
(2 files, 8 passed); both evaluations 0. Every plan hash of both evaluations
equals the round-1 reviewer run (the corpus fixes no instance, so the
fixed-marker check cannot change a corpus plan); the numbers and the blind
reviews of round 1 stand.
