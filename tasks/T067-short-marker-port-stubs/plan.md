# T067 — Shorter marker and port stubs, chosen per seat

- Branch: `task/T067-short-marker-port-stubs`
- Base: `main` at `b00910b`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods only. Current ratios to
human on 627 completed ≤10-part drawings: crossings 1.71, bends 1.09, wire
1.42, median area 1.43 (`tmp/le10-t063final/report.json`).

An independent gap analysis (Opus subagent, 2026-11-12) found that fixed stub
lengths cause about half of the excess wire and most of the excess area:
humans put ground/VDD markers at the host pin (median distance 0; 57% of
grounds touch the pin) and ports about 20 from it, while the planner always
uses `MARKER_OFFSET` 40 (R6a) and `CELL_PIN_OFFSET` 80 (R71). Opus checked it
with the two constants made configurable (dev, 439 drawings, main code):

| Marker / port offset | Crossings | Bends |  Wire | Median area | Floating | Missing |
| -------------------- | --------: | ----: | ----: | ----------: | -------: | ------: |
| 40 / 80 (main)       |     1.786 | 1.161 | 1.425 |       1.448 |        8 |      12 |
| 40 / 40              |     1.721 | 1.122 | 1.351 |       1.323 |        8 |      12 |
| 20 / 40              |     1.695 | 1.114 | 1.299 |       1.278 |        6 |      11 |

Visual totals main → 20/40: `VISUAL_LABEL_CLEARANCE` 129 → 136,
`VISUAL_LABEL_RUN_ON` 24 → 38, `VISUAL_WIRE_THROUGH_SYMBOL` 12 → 13,
`VISUAL_TERMINAL_DEPARTURE` 66 → 34. So shorter stubs help every primary metric
but crowd some labels. This task shortens stubs where the labels still fit.

## Plan change after round 1 (Opus, 2026-11-13)

Round 1's per-seat pre-checks kept only about half of the experiment's gain
(dev wire −4.7% vs −8.8%, area −8.2% vs −11.7%) and raised bends, because
mixing short and long stubs adds jogs and the pre-checks cannot see later
routing and label finishing. Round 2 changes approach:

- **Short defaults everywhere.** Marker offset 20 (R6a/R12) and single-host
  port offset 40 (R71); R146 and the rail search generate candidates around
  the new defaults. Touching remains only through validated R38 contacts.
- **Post-hoc label repair only.** After routing and label finishing, for each
  marker or port that a `VISUAL_LABEL_CLEARANCE`/`VISUAL_LABEL_RUN_ON`
  diagnostic names (or whose label it names), try its longer seat; keep it if
  that diagnostic disappears and the finished calibrated score is not higher.
  Bounded, deterministic.
- **Defects to fix (not test rewrites):** repeated layout of `rc-lowpass` /
  `rc-highpass` must be stable again (no `mirror_instance`/`move_instance`
  on a second run); every final port seat must be a member of
  `portSeatCandidates` (corpus line 538).
- **Authorized test rewrites (old geometry only):** `attachments.test.ts`
  R71 seat distances, `quality.test.ts` R25 marker y, `corpus.test.ts`
  ground-host +40 checks (line 636), `recognition-cascode.test.ts` origins:
  update to the new defaults. `blocker-repair.test.ts`: move fixture parts so
  each fixture still produces its intended initial obstruction under the new
  defaults; keep every repair assertion.
- Runtime: held-out times within +10% of main (round 1: ltc3452 +21.8%).

## Plan change after round 2 (Opus, 2026-11-13)

Round 2 (short defaults + bounded post-hoc repair) reaches dev wire −8.3%,
area −11.6%, and on val drawings completed in both runs wire −6.4%, crossings
−6.4%, but bends +1.8%, label run-on 30 → 49, label clearance 179 → 191, one
terminal-on-foreign-route; ltc3452 +20.4%; large documents changed. Round 3
(final Codex round):

- **Large documents unchanged.** Use the short defaults only for documents up
  to 40 instances; above that keep 40/80, so the six large plans are
  byte-identical again.
- **Repair acceptance.** Accept a longer seat when the targeted label
  diagnostic for that marker/port disappears and no other guard rises,
  regardless of the calibrated score (labels are guards; wire is not). Raise
  the trial cap from 4 to the number of diagnosed stubs, bounded by 12.
- **Runtime.** Held-out `ltc3452` within +10% of main; reuse finished previews
  across repair trials where possible.
- **Authorized rewrites (old geometry only):** `routing.test.ts:789` (stub
  ±40 → new default), `port-seat-search.test.ts:136` (candidate set now also
  contains the short edges), `rail-crossings.test.ts:232` (initial trunk
  wire 1300 → new value; keep the crossings/bends checks).
- **Acceptance** otherwise as before. If bends or a label total still rise
  after this, report the per-drawing causes; Opus will decide with the user.

## Context

- Constants: `packages/auto-layout/src/geometry.ts:27-29`
  (`CELL_PIN_OFFSET = 80`, `MARKER_OFFSET = 40`); used in `place-markers.ts`,
  `compact.ts`, `route.ts` (23 references).
- Rules: R6a power markers (`docs/specs/auto-layout.md:200-206`, "40 units
  below for ground or above for VDD"), R12 power stubs (line 257), R71
  single-host port seat (line 610, 80 along the exit), R146 port-seat search
  candidates (40/80/120 along each host exit; `port-seat-search.ts`,
  `portSeatCandidates` in `place-markers.ts`), rail seat search (T058,
  `rail-seat-search.ts`), R62 rail Cell Pin clearance.
- Visual guards come from `@icm/derived` (`diagnoseVisualQuality`,
  `diagnoseLabelClearance`); the shared search score and guards are in
  `routed-search-score.ts`.
- Experiment harness used above: `/tmp/ac-exp` (main with env overrides
  `MARK_OFF`, `CELL_OFF`; reports in `/tmp/ac-exp/tmp/res-off-*`).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T067-short-marker-port-stubs/report.md`.
Out of scope: `@icm/derived` diagnostics, other packages, adding instances.

## Steps

1. **Seat candidates, not constants.** For each power marker and each
   non-rail port, try the shortest stub first (marker 20, port 40, or touching
   the host pin where a direct contact is valid under R38), then the current
   distances, and take the shortest whose marker/port label and stub clear
   other symbols, labels and wires (the label-clearance and run-on checks that
   the guards count). Keep R146/T058 searches working on top of the new
   defaults.
2. Keep R62, R10 validity and electrical equivalence. A touching marker must
   be an accepted direct contact, not a coincident-pin error.
3. Tests: a marker/port that takes the short seat; one whose short seat would
   crowd a label and therefore keeps the long one; determinism; locked
   markers/ports untouched.
4. Spec R6a, R12, R71, R146 text; evaluate all 628; report dev and val.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0, no timeout raised
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t063final/report.json`:

- Wire and median area lower on dev **and** val by at least 5% relative;
  crossings and bends not higher.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; `tmp/fixture-timing.mjs`
  held-out times not above main by more than 10%.

## Notes for the implementer

- Same rule for every marker and port; no circuit-, symbol-family-, id- or
  coordinate-specific code.
- Tune on dev; report val.
- If a tested contract pins the old 40/80 geometry, report it; Opus will decide.
