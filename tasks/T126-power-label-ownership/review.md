# T126 review

## Round 1 — changes requested

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T126-power-label-ownership`; acceptance rerun by the reviewer; renders of
`qswem98h8m`, `b7v4fcpcfw` and `westxcef83` looked at.

Plan change accepted by the reviewer. Step 1's stop condition ("fewer than 10
cases affected") fired on the literal count, because T125's one-grid reach
flags the source drawings too: 183 of the 212 marker-less power labels sit
more than a grid from their rail (169 at the same offset, 11.7 units), and a
flag the source already has is never counted as introduced. The reported
defect (`qswem98h8m`, `c3qbntbj56`) was therefore invisible to the measure.
The measure is recalibrated instead: a power label's reach is two grids, and a
power label anchored to a power-marker instance is that symbol's caption and
is not read. On that measure `main` has 19 introduced power-label flags in 19
cases (15 foreign-closer from R15's re-anchoring at the middle of the Net's
longest horizontal leg with no foreign-wire check, 4 own-far where the result
draws no wire and no visible pin of the rail).

| #   | Severity | Where                                                          | Finding                                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                                                                     |
| --- | -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `packages/auto-layout/src/net-label-seat.ts` `followNetLabels` | A 60-line guard replays the plan, finds seats drawn elsewhere than judged and retries them as free seats. No test; one corpus case (`westxcef83`); the cause is not named, although the replay only appends annotation upserts to the edits `final` is built from. | Find the mechanism with file:line and count strays over the corpus. If seater and engine read a route attachment against different geometry, fix that and delete the guard; add a test built from the mechanism. |
| 2   | must-fix | `net-label-seat.ts` `seatOnNet`                                | Pin seats are limited to the named piece only on the Base-Net path; the Logical-Net fallback is unfiltered.                                                                                                                                                        | Filter both paths, or show which cases need the fallback unfiltered; a test either way.                                                                                                                          |

## Round 2 — accepted

1. Cause found and fixed; guard deleted. The engine applies a label upsert
   inside the edit loop, on the Routes as `set_route_path` drew them, and only
   at the end of the transaction rejoins each Net's Routes at their junctions
   (`packages/edit-engine/src/transaction.ts`, `conductor-topology.ts`), handing
   leg ids out by position. The seater judged seats on the rejoined legs, so a
   leg id could name another segment when the engine read it. A route seat is
   still judged on the finished drawing but is now written against the drawn
   Route and leg of its Net that holds its point; a seat no drawn leg holds is
   not a candidate. Test "writes a seat against the leg the plan draws, not the
   rejoined one" fails without the translation. On the 66 corpus cases with
   pending labels (81 seats: 67 net, 14 power) the old writing strays once
   (`westxcef83`), the new one never.
2. Both seat paths (pins and the Logical-Net route fallback) are limited to
   the named piece; test "does not seat a label by another Base Net joined to
   its own by name". No corpus plan depended on the unfiltered fallback.

| #   | Severity | Where                             | Finding                                                                                                                                                                                                                                     | Expected fix                     |
| --- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | note     | corpus                            | Four power-label flags remain (`bxafand9vg`, `chy424wh5v`, `pskqwzjj2t`, `qgc6fm8kpe`, all own-far): the result draws no wire and no visible pin of the rail (its only member is a hidden bulk pin, or none). Text placement cannot fix it. | follow-up: keep the rail drawing |
| 2   | note     | renders                           | `qswem98h8m` and `b7v4fcpcfw`: the VDD text now names its own wire but is a pin seat on a short rail leg and touches that wire (label clearance unchanged). The rail is a short inner jog; that is placement, not text.                     | none here                        |
| 3   | note     | `net-label-seat.ts` `drawnRoutes` | The seater models which Routes the edits leave before the transaction ends (`set_route_path`, `remove_route_geometry`, `add_junction` splits). An edit kind that changes legs and is not modelled would make a seat stray again.            | independent review to weigh      |
| 4   | note     | below-wire seats for Net labels   | Still struck by their own wire with the Net-label offset; left unchanged so Net-label results stay identical.                                                                                                                               | follow-up                        |

Acceptance rerun by the reviewer on the round-2 code:

```text
pnpm build        → 0
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (808 files, 8317 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6 → 0
```

Corpus against `main` at `c26e267` (reviewer's run): 612 completed and
equivalent, the same 16 refused, none threw; no introduced dangling wires,
unconnected pins or touching pins. 17 plan hashes change, all in cases with a
label R15a moves; wire, crossings and bends are identical in every case. In 15
of them a power label moves; in `2bqpr5kx5c` and `wsgc5ae43p` only the leg id
a Net-label seat is written against changes (same drawing). Introduced
ownership flags: 11 = the 7 Net-label flags `main` has, unchanged, plus 4
power-label flags (19 on `main` by the same measure). Label clearance 253 →
241, label overlaps 2 → 2; neither rises in any case.
