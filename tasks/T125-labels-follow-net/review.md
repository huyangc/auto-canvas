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
