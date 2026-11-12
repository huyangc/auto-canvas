# T046 — Local rerouting of crossed candidates

After selecting a layout, shortlist crossed signal nets, retain all other conductors, remove one net's geometry, restore its terminal memberships and compare bounded tree/trunk alternatives at its existing pins. This changes no device coordinates in the local trial. The budget is three nets and at most eleven paths per net. Small layouts can compare two additional crossed placements from the existing refinement pool. The acceptance decision uses the replayed transaction; the original drawing wins ties and incomparable wire tradeoffs. Fixed layouts do not explore alternative placements; quick mode and partitioned layouts skip this additional search.

| Default search    | Reference: length / bends / crossings | T045              | T046              |
| ----------------- | ------------------------------------- | ----------------- | ----------------- |
| 0–4 devices (13)  | 3,800 / 19 / 0                        | 7,710 / 25 / 0    | 7,710 / 25 / 0    |
| 5–10 devices (17) | 19,383 / 86 / 15                      | 28,695 / 118 / 27 | 28,655 / 113 / 27 |

Four drawings improved over T045. Brokaw lost a bend (6 → 5), AnalogGenie #477 lost another 40 length units and two other drawings lost two bends each. Across both stages 14 of 30 drawings improved on at least one wire metric. No individual drawing regressed in length, bends or crossings at either step. Totals for label overlap, label clearance and terminal departures are unchanged. Crossing counts did **not** improve on the Gallery batch. A synthetic crossed pair of nets verifies the local pass can remove a crossing at fixed placement without increasing bends or wire length.

## Acceptance

- Package TypeScript build, repository typecheck and the auto-layout suite passed (579 tests, 34 files). Package lint: 0 errors (repository warnings remain). The offline pnpm dependency-verification setting from the repository runner was used for lint. Formatting, doc link checks and diff whitespace checked.
- Independently evaluated both device buckets from their original input files after T045 and again after T046, using `node scripts/auto-layout-eval.mjs <bucket> --block-boxes off --jobs 2`. Each stage: 30/30 completed, 0 missing connections, 0 floating pins, 0 unsafe routes, 30 equal terminal partitions and 27/27 equal extractable electrical graphs. Three source graphs are uncheckable. Verified each default result's plan hash, exported it, reopened it, and checked the geometry and connection metrics again.
- Brokaw: 1 crossing, 5 bends, 1,405 units; reference 1 / 4 / 879. The four output/base pins are on the same physical component, including the previously floating two. A is on the branch containing Q2.C, R3.2 and X1.IN+; B is on Q1.C, R4.2 and X1.IN−. Their ink centres are 13.3 and 13.1 units from the matching branch dots. 1 follows the transistor displayed as Q₁, n follows Q₂; bindings survived serialization and repeated APR.
- The main workspace's `output/apr-small-t046/index.html` presents all 30 four-way drawings at a common scale within each case, their source provenance, metrics and both downloadable native results. The adjacent `comparisons.json`, `brokaw-labels.json`, `brokaw-physical.json` and `brokaw-comparison.png` record the evidence.

## Limits and follow-up

An orthogonal elbow-only prototype and a repeat of the previous one-pass rerouter on alternative placements did not improve this corpus. A wider probe could remove Brokaw's last crossing but required 182 more units than the row-compacted layout. The final algorithm declines that trade. It also rejects options that buy shorter wires at the price of more label-clearance or terminal-departure findings. In the source comparison Diamond Buffer still has 4 crossings versus 1: moving the signal branches into a more suitable placement is a better next experiment than increasing the local routing budget indiscriminately. Results describe these 30 schematics, not a general performance or optimality guarantee.
