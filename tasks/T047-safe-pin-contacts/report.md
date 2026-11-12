# T047 report — safe same-net pin contacts

## Summary

The default planner can close an empty strip between aligned, facing pins. The allowed pairs come from the original terminal declarations: retain an existing contact or try the two device pins of a two-pin group. A coordinate coincidence or an equal net name does not establish permission. The contact uses no wire; a branch can depart from the shared landing without running along either device's ink. No circuit, symbol ID, reference, or example coordinate selects the optimization.

## Steps

| Step | Status | Result |
| --- | --- | --- |
| Freeze identity and validate geometry | Done | Both scalar pin identities must belong to the same explicitly declared Base Net, directions must oppose, the actual pin locations must match, and device bodies must end on opposite sides. Other pin and body overlaps remain invalid. |
| Bounded search and acceptance | Done | Try at most four fully routed post-search placements. Preserve rigid relationships. Replay the transaction; reject new disconnections, unsafe routes, lost anchored labels, or worse routing/readability. The quick mode does not search for new contacts. A fully fixed layout can retain existing safe contacts. |
| Compare and reopen native exports | Done | All 30 default plans reproduced their evaluation hashes. Reopened the exported projects. Rechecked physical and electrical connectivity, route metrics, per-net terminal span, and the Brokaw anchors. |

## Acceptance results

- Package builds: TypeScript compiled edit-engine and auto-layout. Repository typecheck passed; lint of both packages passed, as did changed-source Prettier and diff whitespace checks.
- Vitest: 129 files, 1,540 passed, 4 skipped. Focused contact and wire-clearance tests passed again following the final test-fixture typing correction. New coverage includes a renamed CMOS inverter with fixed and free poses, previously separated passive pins, rigid groups, three-way contact, unowned/conflicting pins, branching from either end, body/lead collision and equal names on different Base Nets.
- Three pre-existing corpus cases now form valid contacts. The corpus test still checks every pin and all pairs of boxes; at a shared landing it checks source ownership, direction and visible pins, allowing only the two units of overlapping interaction padding. A separate pre-existing route-label test exposed loss of an anchor when its entire route disappeared; rejection of that candidate restored the original behavior.
- Run the batch with `node scripts/auto-layout-eval.mjs <by-size/bucket> --block-boxes off --jobs 2`. To verify all three sets of native files, run `node tasks/T047-safe-pin-contacts/compare.mjs <gallery/by-size> <previous-output> <current-output>` from this worktree after building the packages. The main workspace contains the rendered three-way gallery at `output/apr-small-t047/index.html`, per-case measurements, native projects, and two Brokaw evidence files.

## Investigation results

Each cell is **pin span / wire length / bends / crossings**. Pin span sums bounding-box width plus height over the routable pins of each frozen Base Net; implicit MOS bulk pins are excluded. Lengths are rounded here. References are the original Gallery drawings: 23 tagged Human made, one separately documented as hand-drawn, five unverified and one marked AI.

| Devices | Gallery original | Previous default (T046) | Current default |
| --- | --- | --- | --- |
| 0–4 (13) | 3,270 / 3,800 / 19 / 0 | 7,050 / 7,710 / 25 / 0 | 6,280 / 6,940 / 25 / 0 |
| 5–10 (17) | 14,451 / 19,383 / 86 / 15 | 24,461 / 28,655 / 113 / 27 | 23,901 / 28,095 / 113 / 27 |
| Total | 17,721 / 23,183 / 105 / 15 | 31,511 / 36,365 / 138 / 27 | 30,181 / 35,035 / 138 / 27 |

13 cases improved (8 small, 5 medium); the other 17 tied on all four metrics. The 30 results have 21 direct contacts, previously zero. All four metrics were non-increasing on each individual case. No physical component joins terminals from distinct source Base Nets; every new contact checked back to its source terminal declarations. All 30 terminal partitions agree, no missing connections, floating pins or unsafe routes. The 27 extractable source graphs compare equal; the remaining three, including Brokaw, are covered by terminal and physical checks rather than claimed as netlist graph matches.

CMOS inverter: both M1.D–M2.D and M1.S–VDD1.P meet at physical landings. Span and length are 80 in the reference, 380 previously, 240 now. All three have no bends or crossings. Full fixed-position rerouting of the original reaches 80 with the two contacts. At default placement the residual span gap of 160 comes from the input (+70), output (+60), and ground (+30) nets.

Brokaw: unchanged 1,301 / 1,405 / 5 / 1. Q1.B, Q2.B, P1.P and X1.OUT are on the same physical component. A and B still follow the correct IN+ and IN− branch dots (ink-centre distances 13.3 and 13.1); 1 and n follow the same original transistor instances. Text records and successful anchor resolution survived export/reopen and a second APR.

## Deviations and open questions

No change to the search budget of the main placement optimizer; the contact polish is separately capped. Aligned pairs only: no speculative rotation, arbitrary multi-terminal pairing or transistor-specific template. Direct contacts helped linear distance here; neither the bend count nor the crossing count improved on this batch. Variable port and ground spacing is the next measurable opportunity on the inverter.
