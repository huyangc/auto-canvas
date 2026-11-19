# T143 report — round 2: the term does not hold more columns; stopping

## Summary

**This does not work and the branch should not merge.** Under the relation
definition the plan specifies — a tap that leaves from *between* the two
conduction pins — the term changes nothing for the better.

Corrected round 2 (crossings never bought, tap required between the pins),
measured on the 54 cases the change moves, with **both sides counted by the
same corrected counter**:

| | main | T143 |
| --- | --- | --- |
| CHAIN columns held | **7** | **6** |
| crossings | 310 | 307 |
| bends | 2037 | 2030 |
| missing / floating | 0 / 0 | 0 / 0 |

The column count goes *down* by one. The crossings and bends improvement comes
from the hard "never buy a crossing" veto I added in round 2 — it biases the
comparison toward the quick (cheaper) finalist — **not** from the CHAIN term.
Without that veto the term costs crossings (310 → 312), which the plan forbids.

## Why round 1's 34 → 55 was wrong

Round 1 counted a column as held whenever the two conduction pins were
collinear. The plan requires the tap to sit **between** them, and the owner's
own words say so ("在两个器件中间"). With that check the population collapses:
on the same cases the counter finds 7 columns on main and 6 on the branch rather
than 34 and 55. Round 1's number was measuring a looser relation than the one
the task is about.

## Why this is the second negative round on owner comment #38

1. **Draft-level candidate** (`pt-chain-draft`): 0 of 628 plans changed, 0
   objects fixed. The objects the candidate could reach are not the ones people
   draw.
2. **This score term**: under the correct definition, −1 column.

Both tried the same thing — make the planner prefer the CHAIN structure — and
both failed for the same underlying reason: the relation as the plan defines it
(tap strictly between the pins) is rare in this corpus, so there is almost
nothing for a term or a candidate to win.

What the phase trace did establish and still stands: 91 % of the breaks are
present before R147 runs, so no finishing guard reaches them, and the 74
objects broken at the draft are the real population. That points at the draft,
not at the selection.

## What is left

The honest next step is not another selection or guard attempt on #38. It is
either:

- a **draft-level** change that keeps the two conduction pins of a tap Net in
  one column while the draft places devices (the earlier `pt-chain-draft` did
  the opposite: it tried to *move* them afterwards, and could not), or
- accepting that the relation as defined is too rare to be worth more work, and
  telling the owner that #38 is not reachable by the mechanism we have.

## Status

Branch reverted to the round-1 commit; PR closed rather than merged. The two
corrections (never buy a crossing; tap must lie between the pins) are worth
keeping if anyone tries this again, and are described above so they need not be
rediscovered.
