# T025 review (T024 in rounds 1–2; renumbered after round 2, see plan "Round 3")

## Round 1 — changes-requested

Reviewed: `git diff 5314954` on `task/T024-auto-layout-symmetry` (now `task/T025-auto-layout-symmetry`) (working tree,
uncommitted) on 2026-11-08; acceptance partly rerun by Opus (see below). Codex reported
`STATUS: partial` and stopped at three plan gaps instead of inventing rules; that was the
right call. All three gaps are plan defects, fixed by the Round 2 amendment appended to
`plan.md`. Two further findings come from reading the diff. Scope is clean: every changed
path is owned, no lockfile or dependency change, `plan.md` untouched, nothing from
`tmp/human-cases` tracked.

| #   | Severity   | Where                                                                                                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                   | Expected fix                                                                                                                                                                                                                                                                      |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `packages/auto-layout/src/symmetry.ts` (`invalidDevices`, Net proposals)                                                      | The round-1 R88 conflict rule treats a mirror load's shared gate (`n = m`) as contradicting the pair's drain mapping, drops the load from the component, and then R18 cannot stack it inside the block. Two tests fail for this reason. The rule was wrong in the plan.                                                                                                                   | Implement the corrected rule of the amendment (a shared connection proposes self only as a default; Net conflicts never invalidate device pairs). Step 1's first test expects `r`/`o` paired, no conflicted device.                                                               |
| 2   | must-fix   | `symmetry.ts` `throw new Error("R88: ...")`                                                                                   | `detectSymmetry` throws for a pair reachable from the seeds only through self-mapped Nets; the throw escapes `planAutoLayout`, so two human drawings (one dev, one val) now fail where `5314954` completes them. The planner must never throw on a valid Document.                                                                                                                        | Amendment: such a pair takes the R7 convention (lower id left). Remove the throw; the "self-Net twin" test passes.                                                                                                                                                                |
| 3   | must-fix   | `layered.ts` `symmetryRows` (axis placement), `place.ts` `resolveCollisions` (`internal`)                                     | Two axis devices in one row are both centred on the axis, collide, and the document is refused (one dev drawing).                                                                                                                                                                                                                                                                         | Amendment: axis devices sharing a row form one run with 40-unit gaps, its pin-centre midpoint on the axis.                                                                                                                                                                        |
| 4   | must-fix   | `layered.ts` `symmetryRows` (left-member orientation); `test/corpus.test.ts` `fig-17-19b` orientations                        | Inside a block every left member keeps mirror `none`, so a recognized mirror or matched pair faces its gates outward, against R7 (`horizontal`/`none`). The corpus expectation for `fig-17-19b` was rewritten to the new orientation. Step 7 allows rebuilding a geometry value, not changing the rule a test names.                                                                      | Amendment: orientation inside the block follows R7 for recognized groups and the gate-Net rule for other pairs. Revert the `fig-17-19b` orientation expectation to `main`.                                                                                                        |
| 5   | must-fix   | `layered.ts` `symmetryRows` (axis `right + 40`); `test/quality.test.ts` R18 pitches; `test/corpus.test.ts` `five-t-ota` pitch | The axis is the left half's right extent plus 40, so pitches no longer follow R7/R18 (smallest pitch `MEMBER_PITCH`, the other derived from the pins): the R18 test went from `100 / 100 + 4·offset` to `140 + 4·offset` both, `five-t-ota` from 100 to 80. The plan's axis rule caused this; it is replaced.                                                                             | Amendment: `A` is the smallest grid x giving every pair a pitch ≥ `MEMBER_PITCH`, keeping left bodies left of the axis, and leaving 40 units to an axis run in its row. Revert both pitch expectations to `main`; `fig-17-19b`'s minimum pitch is then reported, not pre-decided. |
| 6   | must-fix   | `layered.ts` `netLevels`                                                                                                      | BJTs get no channel levels, so a BJT block's members share one row and the mirror load lands beside its pair (`recognition-placement.test.ts` "stacks a BJT mirror load" fails even once finding 1 is fixed).                                                                                                                                                                             | Amendment: `netLevels` names BJT channel pins `C`/`E` as it does `D`/`S`. Opus verified on a scratch copy of `5314954` that this two-line change passes all 289 auto-layout tests and typecheck.                                                                                  |
| 7   | should-fix | `docs/specs/auto-layout.md` R88, R89, R31                                                                                     | R88 still describes the round-1 conflict rule; R89 lacks orientation, the pitch-based axis, axis runs and outside devices in a block row; R31 does not mention BJT channels.                                                                                                                                                                                                              | Update with the amendment's wording.                                                                                                                                                                                                                                              |
| 8   | note       | `tasks/T024-auto-layout-symmetry/report.md`                                                                                   | Timeline matches the report: acceptance commands ran, the three red tests are the ones reported, the search run was interrupted once after the empty-row fix and rerun to completion, no test was weakened to pass. Paired timing 0.917× on 30 common documents and 100% mirrored/level on completed documents are credible interim numbers; targets are re-measured on 33/33 in round 2. | —                                                                                                                                                                                                                                                                                 |

Decisions on the report's open questions: (1) sides → R7 convention; (2) R18 vs contiguous
block rows → moot once mirror loads are inside the block; outside nodes stay beside the
block; (3) axis devices sharing a row → run; (4) BJT rows → `netLevels` change; (5) the
throw goes. A correct mirrored placement that costs crossings is accepted as the plan says;
the per-document table stays in the report.

Acceptance rerun (lane 1, Opus):

```text
pnpm vitest run packages/auto-layout → 1; 3 failed (the three above), 300 passed
git status --short / git diff --stat origin/main → only owned paths; plan.md unchanged
scratch copy of 5314954 + netLevels BJT change: pnpm typecheck → 0; pnpm vitest run packages/auto-layout → 0 (289 passed)
```

Plan change: `plan.md` gains "Round 2 amendment" (R88 conflict rule, sides, axis runs,
outside devices, orientation, axis position, BJT levels, tests, report items). The base
commit and every other part of the plan stand.

## Round 2 — changes-requested

Reviewed: `git diff 5314954` of the round-2 working tree on 2026-11-09, then the same
tree rebased by Opus onto `f8f15fe` (see "Renumber and rebase" below); acceptance partly
rerun by Opus. The six round-1 findings are fixed: the mirror load is paired and stacked
inside the block, sides fall back to the R7 convention, axis runs exist, R7 orientations
and R18 pitches are restored (`five-t-ota`, `fig-17-19b`, the R18 offset test and the BJT
mirror-load test pass unchanged), BJT channels have levels. Quick mode completes 33 of 33
with every detected pair mirrored and level and every axis device on the axis; dev
crossings 318 against the 5314954 baseline's 314. Codex also found and fixed a real
defect of its own (a paired capacitor pulled out of its block by stage bridge extraction)
with a regression test. Four tests still fail; two of them are plan defects again, one is
a test written against an impossible exactness, one is a real rule gap that round 2's own
amendment created.

| #   | Severity   | Where                                                                                                          | Finding                                                                                                                                                                                                                                                                                                                                | Expected fix                                                                                                     |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `symmetry.ts` self-Net device pairing                                                                          | The PMOS-tail fixture pairs the tail `t` with its mirror reference `r` because both sit on the supply rail and are each other's only candidate there; the block then mirrors the tail off its axis, and both "moves a PMOS tail's entire mirror unit" tests fail. Rail connectivity is not symmetry evidence.                          | Plan K: rails never pair devices; an outside tail is seated by R7 in both strategies.                            |
| 2   | must-fix   | `symmetry.ts` (removed within-pair check)                                                                      | The stage-mirror fixture's recognized cross-coupled pair `b`/`e` maps `top2` to two different Nets from its own pins; amendment A removed the only check that caught it, so an inconsistent seed now forms a block and the stage can no longer mirror ("mirrors a whole stage to remove a crossing" fails).                            | Plan L: a pair whose own pins propose two different non-self partners for one Net is invalid, defaults excluded. |
| 3   | should-fix | `test/symmetry.test.ts` "centres a run of axis devices"                                                        | Asserts an exact 40-unit visible gap, which on-grid origins and fractional symbol bounds cannot produce; the layout (41.87) is correct.                                                                                                                                                                                                | Plan M: at least 40, less than 40 + grid; midpoint within half a grid of the axis. Say "at least 40" in R89.     |
| 4   | must-fix   | `place.ts`, `template-placement.ts`, `stages.ts`, `layered.ts` (`deviceRows` default argument, `symmetryRows`) | `detectSymmetry` runs four to five times per `placeDocument` call, for every strategy and every search candidate; it includes `recognizeSubstructures`. Paired time 1.29× on a loaded machine; cheap to remove.                                                                                                                        | Plan N: detect once per `placeDocument` and pass components and Net map down.                                    |
| 5   | note       | `report.md`                                                                                                    | Timeline matches the report: all acceptance commands ran, the four red tests are the ones reported, the interrupted search was rerun, restored expectations verified by Opus's rerun (`4 failed, 303 passed`). The frozen-path check against `origin/main` was non-empty only because `main` had moved; against `5314954` it is empty. | —                                                                                                                |
| 6   | note       | crossings                                                                                                      | Nine documents gain crossings for full symmetry; the two largest (33 → 47 and 54 → 78, both dev) are drawings whose humans mirror all 10 pairs or draw 22 crossings. Accepted as the plan says; search recovers most of it (dev 252 vs quick 318). The dev quick total still has to meet the new ceiling after round 3.                | —                                                                                                                |

Decisions on the report's open questions: (1) → K; (2) → L; (3) → M; (4) resolved by
the rebase; (5) → N, then remeasure on a quiet machine.

### Renumber and rebase

While round 2 ran, PR 27 merged into `main` as `f8f15fe` under the number T024 with
rules R90–R93. This task is now T025 with rules R88, R89 and R94; the directory,
branch, spec, `place.ts` message and plan are renamed. Opus rebased the round-2 working
tree onto `f8f15fe`: two conflicts, both resolved by hand.

- `docs/specs/auto-layout.md`: both rule blocks kept, in number order (R88, R89, then
  the merged R90–R93, then R94).
- `layered.ts` tail alignment: the merged task's split-tail case (`facing: "outward"`
  → offset 0) combined with this task's centring on the pair's two members.

The plan's base, baselines (`tmp/t025/`, quick dev 295 / val 321 on `f8f15fe`),
targets and the R92 facing interaction are in the plan's "Round 3" section. Codex's
round-2 changes stay uncommitted on the rebased branch; only the plan is committed.

Acceptance rerun (lane 1, Opus):

```text
pnpm vitest run packages/auto-layout (round-2 tree on 5314954) → 1; 4 failed (the four above), 303 passed
pnpm typecheck (rebased tree on f8f15fe) → 0
pnpm vitest run packages/auto-layout (rebased tree) → 1; 6 failed, 353 passed: the four above plus
  "centers outward split tails one row below the pair" (template, layered) from the merged T024:
  split tails inside the block get mirror horizontal/none, R92 wants none/horizontal (plan Round 3, R92 bullet)
```

The paired-timing copy `tmp/t025/paired-base/` is the `f8f15fe` planner with its
evaluation script importing this branch's `dist/symmetry.js` for the symmetry columns;
rebuild this branch (`pnpm build`) before running it.

## Round 3 — accepted

Reviewed: `git diff f8f15fe` on `task/T025-auto-layout-symmetry` on 2026-11-09;
acceptance rerun by Opus on lane 1 (below). Every round-2 finding is fixed as the plan's
Round 3 section prescribes, and the six tests that failed on the rebased tree pass
unchanged. Scope is clean: only owned paths changed, frozen files and protected packages
are byte-identical to `f8f15fe`, no lockfile or dependency change, nothing from
`tmp/human-cases` tracked, `plan.md` untouched by Codex.

| #   | Severity | Where                                                          | Finding                                                                                                                                                                                                                                                                                                       | Expected fix |
| --- | -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | note     | `symmetry.ts` `applyDevices`                                   | Within-pair consistency (plan L) is checked on every proposed pair, seeds included, with `n === m` skipped so shared defaults never count. The inconsistent cross-coupled seed test and the genuine cross-coupled test both pass. Correct.                                                                    | —            |
| 2   | note     | `symmetry.ts` rail loop                                        | `if (roles.rails.has(n)) continue;` skips rails in Net-to-device pairing while rails stay hard self mappings (plan K). Three dev pairs that rested only on rail evidence are gone (61 → 58); Codex replayed round 2's detector to attribute every lost pair. Accepted.                                        | —            |
| 3   | note     | `place.ts`, `stages.ts`, `template-placement.ts`, `layered.ts` | `symmetryTopology` runs once in `placeDocument` and is threaded through; the helpers keep a default argument for direct callers (tests, the evaluation). `createMoveGenerator` keeps its one call. Paired time 0.954× (Codex, sequential on a quiet machine) and 0.981× (Opus, both planners simultaneously). | —            |
| 4   | note     | `test/symmetry.test.ts` axis run                               | Asserts gap in `[40, 40 + grid)` and midpoint within half a grid (plan M); observed gap 41.87. Spec R89 says "at least 40". Accepted.                                                                                                                                                                         | —            |
| 5   | note     | `test/layered.test.ts` shared-tail fixture                     | The one rebuilt expectation: the two pairs sharing a tail are now one four-member block node in row 0 instead of two group nodes. The rule the test names (tail centred between the pair axes, pairs adjacent) is still asserted. Allowed by step 7 and listed in the report.                                 | —            |
| 6   | note     | crossings                                                      | Nine documents gain crossings for full symmetry (largest 52 → 66 and 17 → 29, both dev); four lose (85 → 49, 39 → 21). Dev total falls 295 → 287, val rises 321 → 338. Accepted as the plan says: the rule is right, the cost is reported per document.                                                       | —            |

Timeline matches the report: the six failures were reproduced first, the two new detection
tests went red before the fix, every acceptance command ran, no run was interrupted, and
`pgrep` showed no other evaluator before either timing run.

Acceptance rerun (lane 1, Opus, on the final tree):

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check → 0; pnpm docs:check → 0; pnpm typecheck → 0; pnpm lint → 0 (0 errors)
pnpm vitest run packages/auto-layout → 0; 361 passed, 18 files
pnpm test:local → 0; 7647 passed, 116 skipped (755 files, 2 skipped)
pnpm deadcode 2>&1 | grep -E 'auto-layout|symmetry' → 1; no output
pnpm build → 0; pnpm auto-layout:review → 0
paired quick, both planners at once with --jobs 10 (f8f15fe archive in tmp/t025/paired-base vs this tree):
  33/33 both; summed planning time 0.981× (baseline 275.1 s, result 269.8 s; slowest document 22.8 s on both); result metrics identical to Codex's result-quick.json (33/33 documents)
  dev crossings 295 → 287, bends 401 → 371, floating 0 → 0, wire 123,660 → 127,850, readability 0/40/7 → 0/32/8
  val crossings 321 → 338, bends 391 → 403, floating 1 → 1, wire 147,150 → 148,230, readability 0/31/5 → 1/31/6
  symmetry (pairs/mirrored/level/orientation/axis/onAxis): dev human 58/31/54/34/7/4, main 58/13/57/34/7/1, T025 58/58/58/58/7/7; val human 29/19/29/23/4/3, main 29/12/29/19/4/0, T025 29/29/29/29/4/4
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33/33; crossings 523 → 520 (dev 235 → 221, val 288 → 299), bends 740 → 712, floating 1 → 1, none above quick, every pair mirrored and level, 11/11 on axis
git diff --stat f8f15fe -- <frozen files, protected packages, lockfile> → empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → empty
```

Rendered human | before | after sheets (`tmp/t025/sheets/`, chosen by measurable change,
never by id) were inspected and sent to the user: the fully differential OTA and the
switched-capacitor comparator now mirror all 10 pairs each; the 70-instance mixer goes
85 → 49 crossings with 9 of 9 pairs mirrored; the two-stage amplifier with common-mode
feedback pays 52 → 66 crossings for 12 of 12 mirrored pairs.
