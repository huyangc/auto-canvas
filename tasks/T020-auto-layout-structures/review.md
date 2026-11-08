# T020 review

## Round 1 — changes-requested

Reviewed: the uncommitted working tree after Codex round 1. Codex's report is
accurate. Changes to existing tests keep R19/R20 covered:

- the R19/R20 fixtures now use multiple-host ports;
- the corpus check exempts only ports that sit exactly at their single host.

In quick mode, crossings fall from 755 to 621 (−18%), bends from 766 to 701, and wire
length by 11.6%. With 2-minute search, crossings are 483, against T019's 621. Floating
pins rise from 82 to 101, which fails the round target.

Floating pins are sensitive to any placement change. Each rule alone adds 7–11
floating pins, including R69, which touches only 5 devices. Opus read the R14 messages
for the five documents that gained floating pins. Every failure is one of two kinds:

1. **A marker blocks a rail branch.** A ground or supply branch passes through, or
   touches, the rail's own marker (`passes through GND1`, `touches VDD1's drawing`).
   Placement order is correct: markers are placed after the attachments. The marker
   simply lands on a column that another pin's branch needs.
2. **A port blocks a branch or trunk.** A branch or trunk of another Net passes over a
   port's pin (`passes over pin P2.P of a different Net`). Several of these are R71
   local ports.

Ports and markers can move without changing topology. That makes a general repair
possible: replace the blocker and replan, still with no router change.

| #   | Severity | Where                                        | Finding                                                                                                                      | Expected fix       |
| --- | -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | must-fix | `src/auto-layout.ts`, `src/place-markers.ts` | Floating pins rise from 82 to 101. Every new failure is a branch or trunk blocked by a marker or a port.                     | Plan step 7 (R72). |
| 2   | note     | tests                                        | Changes to existing tests preserve R19/R20 coverage.                                                                         | None.              |
| 3   | note     | R68 investigation                            | Of the 5 tail-less pairs on dev, 1 is a driver pair and is now excluded. The other 4 still meet the rule and stay unchanged. | None.              |

## Round 2 — accepted with an Opus fix

Reviewed: the uncommitted working tree after Codex round 2.

Codex implemented R72 and tightened obstruction matching. The two changes are:

- a marker seat now avoids horizontal rail trunk rows;
- obstruction matching is safe when one id is a prefix of another.

Codex's report is accurate. As delivered, quick mode has 88 floating pins, above the
target of 82.

**Opus fix: judge a repair by routed score, not by "no added crossings"**
(`src/blocker-repair.ts`). A trace of the one document that newly gained floating pins
found the repair was correct but rejected:

- moving its ground marker by one grid routes the whole unnamed ground Net;
- floating pins go from 7 to 0, at a cost of two crossings (6 → 8);
- the plan's rule against added crossings rejected it.

R72 now keeps a repair only when it has fewer floating pins **and** a lower `routedScore`.
That is the same energy that refinement and R66 use, where an unrouted Net weighs ten
crossings. In the tests:

- the test asserting rejection of any added crossing became a test that keeps such a
  repair when it routes a Net;
- a new test rejects a repair whose routed score is not lower.

Opus reran acceptance on lane 1:

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck / lint → 0
pnpm vitest run packages/auto-layout     → 0 (172 tests)
pnpm test:local                          → 0 (7453 passed, 116 skipped)
pnpm deadcode | grep auto-layout         → no output
pnpm build / auto-layout:review          → 0; corpus targets and held-out ceilings hold
pnpm auto-layout:eval ... (quick)        → 0
pnpm auto-layout:eval ... --search 120 --seed 1 --jobs 12 → 0
protected paths, tracked private data    → none
```

All 32 completed documents, against T019:

| Mode               | Crossings, dev / val / all | Bends | Floating pins | Wire length |
| ------------------ | -------------------------- | ----: | ------------: | ----------: |
| T019 quick         | 268 / 487 / 755            |   766 |            82 |        238k |
| T020 quick         | 260 / 387 / 647            |   703 |            63 |        220k |
| T019 search, 120 s | 621                        |   643 |            80 |        234k |
| T020 search, 120 s | 181 / 314 / 495            |   612 |            59 |        218k |

Every round target is met. In every result, all documents are equivalent and safe.
The largest width ratio is 1.42.

Some documents trade crossings for routed Nets. Three documents drop from 6, 9 and 5
floating pins to 0. One of them gains 6 crossings. Lint shows no errors; warnings rose,
mostly non-null assertions in new code, a pattern the package already uses.

## PR review — codex round 1 on `901c50c`

One P2, confirmed with a hand-built test that failed before the fix. A MOS with D and S
on one Net matched any two-terminal device on that Net as a parallel host. Opus fixed it:
the host's D and S Nets must differ. Package tests pass (173). Quick-mode human results
are unchanged in every document.
