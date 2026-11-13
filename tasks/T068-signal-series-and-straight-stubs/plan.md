# T068 — Series signal parts in the signal path, and straight two-pin joins

- Branch: `task/T068-signal-series-and-straight-stubs`
- Base: `main` at `05050fd`
- Status: approved

## Goal

The user reviewed sampled layouts (2026-11-13,
`tmp/le10-analysis/main-05050fd-samples.html`) and pointed out defects the
current metrics cannot see:

1. **Common-Source Amplifier** (`f1a0b46a-180f-47cc-9bb2-815554aa7575`):
   the source resistor Rs, a two-pin part between the input source's + Net and
   the gate Net, is stood up vertically in the top row next to Rd, leaving a
   narrow, pointless band. Humans draw it horizontally in the signal path from
   Vin to the gate. It already looked like this before this optimisation effort
   (`bdb5f36`), and no symmetry pair is detected, so it is the R30/R31 row
   rule, not R88 symmetry.
2. **Source degeneration** (`bv9zwmd835`): under the left Rd the wire to M1's
   drain has a jog; Rd's lower pin is not aligned with the drain pin, although
   a straight vertical wire is possible.

Fix both generally, and add metrics so that these kinds of defects are
measured from now on.

## Context

- R30 net levels (`docs/specs/auto-layout.md:374`, `layered.ts` `netLevels`):
  "Two-pin passives with a rail pin point away from that Net; other passives add
  no constraint." T063 added series levels for two-pin DC devices on a
  supply-to-ground path (`series-levels.ts`, `planSeriesDispatch` in
  `auto-layout.ts`). R31 rows and orientation (line 384): "Two-pin parts on one
  level lie horizontally in that row."
- R18 pin-aligned stacks (line 323) and R33 columns (line 398) align shared
  channel pins of stacked devices; two-pin parts attached to a channel pin
  (a load resistor on a drain) are not necessarily aligned with it.
- Searches after placement (R147 relocation, R146 ports, rail, R149 gaps,
  T067 stub repair) decide by `calibratedScore` + `routedGuards`
  (`routed-search-score.ts`); a one-unit jog costs one bend (weight 100).
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  base `tmp/le10-main-05050fd/report.json`; sampled review page generator is
  in this conversation's history (human | start | current, 5 per size band).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `scripts/auto-layout-eval.mjs` (metrics only),
`tasks/T068-signal-series-and-straight-stubs/report.md`.
Out of scope: other packages; symmetry detection (a later task).

## Steps

1. **Metrics** (scoreboard, human and result, per split):
   - _avoidable jogs_: routes between exactly two pins whose pins could be
     joined by one straight segment along a pin's exit direction after moving
     one of the two parts by at most one grid pitch, but are routed with bends;
     report the count (define precisely, keep it cheap and deterministic);
   - _signal-path series parts upright_: two-pin parts (resistor, capacitor,
     inductor) whose two Nets are both non-rail and which lie on no
     supply-to-ground DC path (T063's inference says no direction), counted as
     vertical vs horizontal.
2. **Investigate** on the two named drawings and on dev: why Rs ends up in the
   top row vertically, and why Rd's pin is off the drain's x. Report.
3. **Fix generally:**
   - a two-pin part with two non-rail Nets and no inferred DC direction takes
     the row of its signal-side neighbour and lies horizontally between its
     two Nets in signal-flow order (left→right by signal distance), unless a
     template or group fixes it;
   - when a two-pin part connects to a device channel pin on one of its Nets
     and nothing else on that side blocks it, align its pin with that channel
     pin (colinear along the part's axis) so the join is a straight wire.
     Decide by finished score with the existing guards; prefer making these the
     placement rules over adding search candidates.
4. Tests: synthetic CS amplifier with source resistor and Cgs/Cgd; degenerated
   pair with drain resistors; determinism.
5. Spec; evaluate all 628; render the review page again for the two named
   drawings and the 25 samples.

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

Against `tmp/le10-main-05050fd/report.json`:

- Avoidable jogs and upright signal-path series parts lower on dev **and** val.
- Crossings, bends, wire and median area not higher by more than 1% relative
  on either split.
- Guards: completed ≥ 628; none non-equivalent; floating ≤ 6; missing ≤ 16;
  every `VISUAL_*` total not above the base.
- In the two named drawings: Rs horizontal in the Vin→gate path; the Rd–drain
  join straight. Determinism; the 6 large documents byte-identical; held-out
  times within +10% of main.

## Notes for the implementer

- Same rule for every document; no branches on circuit type, ids, names or
  coordinates. The named drawings are for diagnosis only.
- Tune on dev; report val.
- If a tested contract blocks this, report it; Opus decides.
