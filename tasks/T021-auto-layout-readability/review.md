# T021 review

## Round 1 — accepted

Reviewed: the uncommitted working tree after Codex round 1. Codex's report is accurate.

What Codex built:

- R73 seats instance labels, as one name-and-value group, and port text on every
  complete plan.
- R74 adds label overlap (400), label clearance (150) and terminal departure (200) to
  `routedScore`.
- A final pass faces each single-pin port and marker along its sole route. It runs after
  quick or search selection, followed by a whole-list replay, which avoids a
  repeat-planning partition failure without touching frozen code.

On dev, every one of the 33 terminal departures was a sideways exit from a one-pin
symbol: 28 ports and 5 power markers. Seating and scoring add 3.2% to planning time.

Opus reran acceptance on lane 1:

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck / lint → 0
pnpm vitest run packages/auto-layout     → 0 (184 tests)
pnpm test:local                          → 0 (7465 passed, 116 skipped)
pnpm deadcode | grep auto-layout         → no output
pnpm build / auto-layout:review          → 0; corpus targets and held-out ceilings hold
pnpm auto-layout:eval ... (quick)        → 0
pnpm auto-layout:eval ... --search 120 --seed 1 --jobs 12 → 0
protected paths, tracked private data    → none
```

All 32 completed documents:

| Mode                       | Crossings | Bends | Floating | Label overlaps | Label clearance | Terminal departures |
| -------------------------- | --------: | ----: | -------: | -------------: | --------------: | ------------------: |
| T020 quick                 |       647 |   703 |       63 |             45 |             242 |                  68 |
| T021 quick                 |       650 |   702 |       63 |              3 |              59 |                  13 |
| T020 search, 120 s         |       495 |   612 |       59 |              — |               — |                   — |
| T021 search, 120 s (Codex) |       512 |     — |       66 |              5 |               — |                   — |
| T021 search, 120 s (Opus)  |       522 |   590 |       53 |              5 |              50 |                  12 |

Every quick-mode target is met. Dev and val both improve on all three readability
counts.

Search results vary with machine load: floating pins were 66 in Codex's run and 53 in
Opus's. In Opus's run, the extra crossings against T020 search come from three dev
documents:

- one gains 12 crossings but drops from 7 floating pins to 0;
- two others gain 6 and 4.

Search ends with more crossings than quick mode in only one document. Search label
overlaps (5) exceed quick mode's (3). Accepted:

- the search crossing target (520) is within run-to-run noise;
- both trades come from the starting weights, which the planned preference task will
  calibrate.

| #   | Severity | Where       | Finding                                                                                  | Expected fix                                 |
| --- | -------- | ----------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | note     | R74 weights | Search trades a few crossings for readability and for floating pins.                     | Calibrate with the pairwise preference task. |
| 2   | note     | R73 scope   | Free and route-anchored labels are not seated, and drafting objects do not follow parts. | Follow-up.                                   |

## PR review — codex round 1 on `e0c6290`

One P2, confirmed with a hand-built test that failed before the fix. When an instance
shows several `instance-value` annotations (separately displayed parameters), seating gave
each one the aggregate-value slot and stacked them on one point. Opus fixed it in
`seat-labels.ts`:

- such a group now moves rigidly with its name, so the values keep their relative rows;
- a group without a name, or with a locked member, stays where it is.

Package tests pass (185). Quick-mode human results are unchanged.
