# T015 review

## Round 1 — changes-requested

Reviewed: `git status`, the report, and the six failing tests, which Opus reran
(6 failed, 78 passed). Opus also measured where crossings come from on ten dev
results: 161 of 233 involve a signal Net with four or more pins, and only 20 a
power Net. Layered placement helps and generalizes: val dropped more than dev,
from 262 to 187 crossings. It is not enough on its own, and it regressed the RC,
RLC, symbolic and several held-out cases.

**plan.md was edited for round 2** with R36–R42 and a held-out non-regression
requirement. The user asked that earlier results not get worse and that fixes stay
general. Read them again. This is round 2 of 3.

| #   | Severity | Where                               | Finding                                                                                                                                                                                 | Expected fix                                                                                                 |
| --- | -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | `src/place.ts`, new strategy module | `rlc` gets 1 crossing and 4 bends against 0/0, `two-stage-symbolic` 5 bends against 3, RC order fails, and held-out `widlar` goes 5→10, `deadtime` 17→26, `skew` 4→5, `ota-sky130` 3→4. | R36 portfolio. Restore the T013 placement as a strategy and keep the layered one.                            |
| 2   | must-fix | `src/layered.ts` levels             | R4 calls a grounded source's + Net supply, so R30 forces it to the top and directs passives away from it.                                                                               | R37.                                                                                                         |
| 3   | must-fix | `src/route.ts`                      | Six human cases are refused because reconciliation adds unchecked Routes across instances or between Nets.                                                                              | R38. Report which refusals remain and why.                                                                   |
| 4   | must-fix | `src/route.ts`                      | High-fanout Nets drawn as spanning trees cause most crossings.                                                                                                                          | R39.                                                                                                         |
| 5   | must-fix | `src/layered.ts` order              | Same-row and long Nets are invisible to the sweeps (your own note).                                                                                                                     | R40.                                                                                                         |
| 6   | must-fix | geometry helpers                    | R25 off-grid tap `50.00000000000001`.                                                                                                                                                   | R41.                                                                                                         |
| 7   | must-fix | `src/refine.ts`                     | 103 instances take 23 s.                                                                                                                                                                | R42; target at most 15 s.                                                                                    |
| 8   | must-fix | `test/quality.test.ts`              | The R23 injected-orientation test depends on an overlap the new geometry no longer creates.                                                                                             | Build the overlap explicitly in the test, keeping the assertion that it is refused with both problems named. |

Evaluation targets stay as written. If the 50% crossing target is still missed,
report where each split stands; never add a rule for one case.

## Round 2 — changes-requested

Reviewed: the report, the eval tables, and rendered results. Opus reran
`pnpm vitest run packages/auto-layout` (93 passed) and the acceptance list (all
pass), and confirmed the corpus and all seven held-out cases are within limits,
most improved (`widlar` 5→1, `deadtime` 17→10, `ltc3452` 22→15, 103 instances in
2.5 s).

Opus changed code in the working tree; keep these changes:

- `restoreBulkPins` (`src/transaction.ts`) and `freezePinGroups({ includeBulk })`:
  the group restore left `B` pins out, so three documents lost bulk membership and
  were refused. They now complete: 32 of 33.

Opus also checked whether humans avoid crossings with labels. They do not: 19 of
700 Nets are physically split. Their advantage is placement.

**plan.md was edited for round 3:** R43, R44, the floating-pin metric, and at least
32 complete. This is the last round.

| #   | Severity | Where                                   | Finding                                                                                                                                                                                                                                                               | Expected fix                                                                                   |
| --- | -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/route.ts` `powerTargets`           | With one marker and many rail pins, the others stay undrawn. `am2bbdtcq2` shows 8 floating pins against 1 in the human drawing, `mcbrza282w` 7 against 1, `x8wctv9v73` 5 against 0. The drawing misleads, and the crossing totals are flattered by the missing wires. | R43.                                                                                           |
| 2   | must-fix | `scripts/auto-layout-eval.mjs`          | Floating pins are not measured.                                                                                                                                                                                                                                       | Add the metric, per document and in totals, for human and result. Add a corpus assertion of 0. |
| 3   | must-fix | `src/refine.ts` or `src/auto-layout.ts` | `8pvqfhsxqr` regressed from 52 to 73 crossings.                                                                                                                                                                                                                       | R44.                                                                                           |
| 4   | note     | report                                  | Crossings will rise once rail wires exist.                                                                                                                                                                                                                            | Report before and after honestly. Do not trade floating pins for crossings.                    |

## Round 3 — accepted with targets missed

Reviewed: the round 3 report, the eval tables, and rendered `am2bbdtcq2` and
`x8wctv9v73`. Opus reran the acceptance list on lane 1 (`tmp/t015-opus3/`):

```text
pnpm install --frozen-lockfile --offline     → 0
pnpm format:check                            → 0
pnpm docs:check                              → 0
pnpm typecheck                               → 0
pnpm lint                                    → 0
pnpm vitest run packages/auto-layout         → 0 (97 tests)
pnpm test:local                              → 0 (744 files; 7378 tests passed, 116 skipped)
pnpm deadcode | grep auto-layout             → no output (deadcode exits 1, as on main)
pnpm build                                   → 0
node scripts/auto-layout-review.mjs          → 0; nine corpus cases with 0 floating pins; seven held-out within their crossing limits
protected paths                              → unchanged
git ls-files | grep -E 'human-cases|auto-layout-eval/' → no output
```

This is the last round, so it is accepted with its targets reported as missed.
Earlier results do not regress. The human-case gains are real and appear on both
splits.

| Measure                      | Target             | Result                                                                                                                                          |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus targets and geometry  | hold               | hold; 0 floating pins                                                                                                                           |
| Held-out crossings vs T013   | not above          | `fd-two-stage` 8 (≤12), `common-source-ac` 0 (≤2), `skew` 2 (≤4), `deadtime` 13 (≤17), `ota-sky130` 3 (≤3), `widlar` 4 (≤5), `ltc3452` 20 (≤22) |
| Human cases completed        | ≥32                | 32 of 33 (T013: 24)                                                                                                                             |
| Crossings, dev / val         | −50%               | −20.8% / −29.8%, with rail wires now drawn                                                                                                      |
| Bends                        | not above baseline | 338→286 / 256→213                                                                                                                               |
| Floating pins on common docs | —                  | 107 → 40, each named in an R14 warning                                                                                                          |
| 103 instances                | ≤15 s              | 4.4 s                                                                                                                                           |

Known limits:

- Crossings are still far above the human drawings (dev 228 against 26 on common
  documents).
- `8pvqfhsxqr` regressed from 52 to 73 crossings, and R44 did not recover it.
- `g47e465db5` is still refused: a touching-pin stub has no clear path.
- Where a rail trunk cannot be routed, pins fall back to `0` labels
  (`x8wctv9v73`), which is valid but untidy.
- Drafting notes and boxes stay at their old positions.

## PR review round 1 — fixed by Opus

The codex PR review on `004f709` raised one P1 and one P2. Opus verified and
fixed both, since the task's three Codex rounds were used.

| Finding                                                                               | Fix                           | Check                                |
| ------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------ |
| P1: every candidate order compared all edge pairs, and a high-fanout Net expands to ` | A                             | ×                                    | B   | `edges;`orderRows` took 101 s on 101 instances | `crossingPairs` counts the same objective in O(E log E) per row pair with a Fenwick tree, and barycentres read a prebuilt adjacency map | Exact against the pairwise definition on seeded random segments. The high-fanout test finishes in 2 s and times out at 20 s with the old count |
| P2: moving a tail that is also a mirror member left the other member behind           | Move every member of the node | The test fails with the fix reverted |

The evaluation is unchanged: 32 of 33 complete, crossings 228 and 184, bends 286
and 213. Rerun: format, docs, typecheck, lint, build → 0; `pnpm test:local` → 7381
passed; deadcode finds nothing under auto-layout; review script → 0.

Known limit for T014: the slowest document takes about 14 s, so the editor must
not run the planner on the main thread.

## PR review round 2 — P2 findings fixed by Opus

Round 2 on `2662659` raised two P2 findings. Opus verified both and fixed them.

| Finding                                                                                                      | Fix                                                                   | Check                                                   |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Centring a shared tail that is also a mirror member moved only the tail, leaving origins 150 units apart     | The whole group translates                                            | The test reproduces 150 without the fix and 100 with it |
| `floatingPins` skipped every pin named `B`, including `and-gate.B`, so real disconnected pins went uncounted | New `isMosBulk`, also used by the three same mistakes in `layered.ts` | The test fails with the audit fix reverted              |
