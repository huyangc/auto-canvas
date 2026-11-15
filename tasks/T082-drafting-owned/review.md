# T082 review

## Round 1 — Opus, 2026-11-14

Verdict: **one more round.** The result is good: dev composite 61.06 → 59.83
(1.271× → 1.245× human), val 33.58 → 33.05 (1.244× → 1.224×), unowned
drafting dev 29 → 22, val 11 → 8, seven drawings better and none worse,
628/628 equivalent, large documents identical, held-out ≤ 1.127×. Opus reran
build, typecheck, lint, format, `test:local` (with local services) and
`test:slow`: all 0. An independent code review found one contract violation
and three robustness gaps.

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | contract | `recover-drafting-owners.ts:133-151` re-adds the **input** Route, leg, bend and Junction ids. R10 (`docs/specs/auto-layout.md:262`, "No input Route id survives") and R98 (`:1078`, every generated Route/Junction id differs from every input id, including removed ones) forbid this. Reusing ids also silently re-activates drafting anchored to those routes/junctions without any drafting edit (only locked ink is guarded, L158-165). | Allocate fresh ids with the existing R98 reservation / salting (`documentObjectIds`, the same helpers routing uses). Re-anchor any movable drafting that was anchored to a carried conductor **explicitly**, with drafting edits that point at the new ids (or move it by the same rigid translation as a free anchor); locked drafting stays exactly where it is. Remove the special-case guard that existed only because of id reuse. Report how much of the round 1 gain survives. |
| 2   | must-fix | cancellation / runtime | `stopped()` is checked only before the call (`auto-layout.ts:197-216`); `reseat` (L382-461) may try 81 + 6561 offsets per group, each running whole-document `draftingGroups`, `acceptable` and `preview`. | Pass `stopped` in and check it per Net, per group and per offset; cap the number of expensive (clearance-passing) trials per group and per document, scaled like other finishing passes (`finishingTrialBudget`). |
| 3   | must-fix | gating | Recovery runs where R150 does not: partition and optimized planning (`auto-layout.ts:320-326`; spec `:256` "plain planning") and zero-budget planning (R148 / R149 gate, `:176-180`). | Use the same gate as R150's seating (plain planning, nonzero budget, the same instance limit). Default-mode corpus results must not drop. |
| 4   | should-fix | acceptance / cost | Carried Nets are not scored one at a time: one Net that raises the composite makes the final check reject every recovery, reseats included. `terminalPartition(base)` is recomputed every iteration (L210). | Accept each carried Net individually (`acceptable` per Net, keep the winners), hoist the partition. |
| 5   | should-fix | tests | The collision test only asserts the route is missing; no test has a translated conductor touching a terminal-Net pin, junction or wire; "reseats a stranded instance caption" may pass on main through ordinary R150; no abort / optimized / partition coverage. | Assert the rejection reason; add the terminal-Net contact case; make the stranded-caption test fail on 8cdec30 (check it against `/tmp/t081-baseline/dist`); add an abort test and a gate test; add an id-freshness test (no output Route/Junction id equals an input id). |
| 6   | nit | edge cases | Junctions with `contactAnchor` and routes with bus `members` are carried; `sameOwner` accepts any terminal instance of a multi-terminal Net (L226-228); a group merged with locked ink (`next` undefined, L489-492) is reseated although R150 freezes it; `draftingGroups` is called once per owned group (L489). | Skip `contactAnchor` junctions and bus-member routes; restrict `sameOwner` to the singleton case; leave merged-with-locked groups alone; call `draftingGroups` once per replay. |

Gates as in the plan; rerun the corpus, large documents and held-out timing
(alone). Write the proposed spec text in the report reflecting fresh ids.

## Round 2 — Opus, 2026-11-14

Verdict: **one more round (small).** Round 2 fixed every round 1 finding.
Rebased on main `8387e36` (T083), Opus reran everything: build, typecheck,
lint, format, `test:local` (8208), `test:slow` (8), full evaluation — dev
1.2385 → 1.2145×, val 1.1865 → 1.1642×, six better, none worse, 628/628
equivalent. CI is green.

The codex PR review of `d1b883a`
(https://github.com/huyangc/auto-canvas/pull/73#issuecomment-6883414008)
raised one P2:

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | drafting | `recover-drafting-owners.ts` re-anchoring (~L201-250): when R150 seated a touching group with a clearance offset, restoring the source conductor anchor drops that offset only for conductor-anchored members; free members keep theirs, so the group is split (the reviewer's probe: two initially aligned captions, an 8-unit seating offset, result separated by 8) and mixed-anchor arrows can stretch. R150 moves a component as one rigid unit. | First write a test that **fails on `d1b883a`** reproducing the probe. Opus tried and failed to reproduce it with a direct `recoverDraftingOwners` call on a hand-made seated base (the carried conductor may already be present in `planAutoLayout`'s output), so build the case through the real planner path. Then fix: either re-anchor with an anchor that resolves to the member's **current** position on the new conductor (preferred: keeps the conductor and the seat), or translate the whole component together; as a last resort reject the carry. The working tree holds an unverified Opus guard (after `const ink = draftingBounds(replay…)`: reject the carry unless every member of each group moves by one common translation and keeps its size); keep it only if your test shows it is needed. |

Gates: all acceptance commands; corpus vs `tmp/main-8387e36-report.json`
(main after T083): composite not higher on dev or val than this branch's
current 53.315 / 27.469 by more than 0.05, no drawing worse than main,
628/628 equivalent; large documents identical. Timing only if the change
touches more than the re-anchoring path.
