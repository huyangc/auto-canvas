# T125 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T125-labels-follow-net`; acceptance rerun by the reviewer; the
`5hjsy2g863` render looked at (VOUT now sits at its own node).

Step-1 finding: 59 of the 75 flagged labels are free-anchored and no planner
step positions them at all; 13 are seated by R15 on the Net's longest leg with
no foreign-Net check; 3 are R15/R14 fallbacks. Fix: R15a `followNetLabels`
re-seats, on the selected and finished drawing, every visible unlocked Net
label that the shared ownership measure rejects and whose source did not.

| #   | Severity | Where                    | Finding                                                                                                                                                                                                                                                                                                  | Expected fix             |
| --- | -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | note     | plan deviation, accepted | The plan asked for a fix where labels are first seated. Doing it inside R15 changed candidate ranking (15 plans, `5hjsy2g863` +1 crossing, +460 wire), so the step runs after selection and only moves text. Later steps re-wire after R15 anyway, and R2 already seats drafting labels after selection. | none                     |
| 2   | note     | owned paths              | `docs/testing/readability.md` got one sentence from the reviewer naming the measure's new home.                                                                                                                                                                                                          | none                     |
| 3   | note     | 5 remaining flags        | `d294ejx3g9` CLKB, `gn3g4kzvjv` VAMPOUT, `gwer4fr5c3` g1, `ne46whs3fw` φ1/φ2: every candidate seat is rejected (crowded single-pin Nets).                                                                                                                                                                | follow-up                |
| 4   | note     | measure                  | A label one grid from its own wire passes even beside another Net's long wire (`yb27wfgqkz` S); layout-group captions are not in the clearance model (`kggd45xdt5`).                                                                                                                                     | follow-up to the measure |

Acceptance rerun by the reviewer:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (804 files, 8282 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> → 0 (by the implementer; report read by the reviewer)
```

Corpus against the T124 base: 628 completed and equivalent; introduced
label-ownership flags 75 → 5 (39 → 4 cases); 39 plan hashes changed, all cases
that had a flag; crossings, bends and wire identical in every case; label
clearance dev 194 → 185, val 77 → 71; label overlaps dev 3 → 2.

## Round 2 — changes requested (independent PR review of 56a9e01)

The Opus PR review approved with two P2 and five P3 findings; the reviewer
accepts them and wants the P2s fixed before merge. The branch has been rebased
onto `main` (`af3a8e7`, which now has T121 and T122): `planAutoLayout` is
`preserveDraftingInterfaces(followNetLabels(drawSourceBodies(selectFinalLayout)))`.

| #   | Severity   | Where                                                        | Finding                                                                                                                                                                                                                                                                                                      | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `packages/auto-layout/src/net-label-seat.ts` candidate seats | Seats are taken from every route and pin of the label's Base Net. A Net drawn in pieces joined only by name needs its label on each piece; a label moved to another piece leaves its piece unnamed (`ERC_NET_JOINED_ONLY_IN_DATA`), which the evaluation does not count.                                     | Restrict candidate seats to the drawn (physical) piece the label names in the final drawing: the piece of the wire or pin the label was attached to or nearest in the source, mapped to the result by its terminals. If that piece has no seat, leave the label where it is. Test: a Net in two pieces each with its own label; one label's piece moves; the label follows its own piece and never lands on the other. Evidence: count `ERC_NET_JOINED_ONLY_IN_DATA` (via `diagnoseProject`, ERC domain) on the base and on the result for all corpus cases — no case may have more than its base. |
| 2   | must-fix   | same file, label selection                                   | Net labels referenced by a layout group or constraint (`objectIds`) are moved; other steps protect such members (`local-rail-markers.ts` `protectedIds`; locked owners in `auto-layout.ts` and `separate-labels.ts`).                                                                                        | Do not move a Net label that any layout group or constraint references. Test for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | should-fix | same file                                                    | Bus-selector Net labels (`binding.memberEndpoint(s)`) must stay route-anchored on their branch route; a wrong seat fails the final replay and silently disables the step for the whole document.                                                                                                             | Skip those labels. Test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | should-fix | `label-ownership.ts` `ownPins`                               | Tie-break uses `localeCompare`.                                                                                                                                                                                                                                                                              | Use `compareIds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | should-fix | ranking                                                      | A label clear of wires can be moved onto a wire to fix ownership (`frw3b53jtz` label clearance 1 → 2).                                                                                                                                                                                                       | Among seats that pass ownership, a seat that strikes a wire may be chosen only when the label's current place also strikes one or no clear seat exists; report per-case label clearance increases (expected: none, or each explained).                                                                                                                                                                                                                                                                                                                                                             |
| 6   | should-fix | `docs/specs/auto-layout.md` R15a                             | Wording: "wires drawn across the text" is the clearance model's `struck`; the distance reference falls back to the label's current position without a source label or own pin; a failed replay or the transaction limit leaves the plan unchanged; the piece restriction and the group/constraint exclusion. | Update the rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | note       | stopped search                                               | R15a still runs after an abort.                                                                                                                                                                                                                                                                              | Skip R15a when the search signal is aborted or the deadline passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Acceptance for round 3: all checks of the plan; on the full corpus against a
main (`af3a8e7`) baseline report: introduced label-ownership flags reported
(expected a little above 5 because of the piece restriction — list every
remaining one with its reason), crossings/bends/wire identical in every case,
plan hashes change only in cases that had a flag, no per-case label clearance or
overlap increase left unexplained, joined-only-in-data ERC not above the base in
any case, the 16 frame cases still refused.

## Round 2 result — accepted

All seven findings fixed; two were applied more strictly than written and the
reviewer accepts both: a seat is tied to the piece by ERC's own label-binding
rule (so the check agrees with what `ERC_NET_JOINED_ONLY_IN_DATA` counts), and
a label clear of wires is never moved onto one (a struck seat is allowed only
when the current place is struck too).

Acceptance rerun by the reviewer:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (807 files, 8306 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> → 0 (by the implementer; report read by the reviewer)
```

Corpus against `main` (`af3a8e7`): 612 completed, the same 16 refused, none
threw; introduced label-ownership flags 72 (38 cases) → 7 (6 cases); 38 plan
hashes changed, all cases that had a flag; crossings, bends and wire identical
in every case; no case with higher label clearance or overlaps (totals
clearance 270 → 253, overlaps 3 → 2); `ERC_NET_JOINED_ONLY_IN_DATA` 0 on main
and 0 on the result in every case (7 in the source drawings). The 7 remaining
flags have no acceptable seat on their own piece (single-pin pieces beside a
foreign stub; crowded nodes; `frw3b53jtz` IN kept clear of wires).
