# T056 — Choose port seats by routed score

- Branch: `task/T056-port-seat-search` (stacked on `task/T055-human-baseline-search`, PR #50)
- Base: `task/T055-human-baseline-search` at `a022890` (`main` `bdb5f36` + the T055 scoreboard)
- Status: approved

## Goal

Part of the user's goal (2026-11-12): bring default-mode auto-layout within
20% of the human Gallery drawings by general methods: optimization and
search, never circuit-specific rules. On the 627 completed ≤10-part drawings,
port Nets (Nets with a `port`/`port-filled` Cell Pin) carry 265,520 units of
wire against the humans' 132,515, and 269 crossings involve a port Net against 127. This task replaces the fixed port seats with a search over candidate
seats ranked by the planner's own routed score, so that ports sit where
routing is cheapest, as humans place them.

## Plan change after round 1 (Opus, 2026-11-12)

- **Test contract.** `corpus.test.ts:452-488` encodes the old R71/R19 seat
  (exactly 80 units, or the edge x). This task replaces that rule by design, so
  round 2 may rewrite those assertions to the new contract: every port is
  either at its previous seat or at a searched seat; it faces its host side;
  its Net is fully connected; no overlap. Do not weaken any other assertion.
- **Timing.** The base itself has p95 8.8-10.4 s under paired load, so the
  absolute 10 s limit is replaced by: paired median at most 2× base and paired
  p95 at most 1.5× base p95.
- **Port wire weight.** R74's `wireLength: 0.1` makes a shorter port wire lose
  to almost any bend. The port-seat comparison may use the T055 dev
  calibration (wire 4, see `tasks/T055-human-baseline-search/report.md`) or a
  value fitted on dev the same way; report the choice and its dev evidence.
  Other R74 comparisons keep their weights.

## Context

How ports are seated today (`packages/auto-layout/src/place-markers.ts`,
`placeCellPins`, lines 135-395):

- A non-rail port whose Net reaches exactly one device pin gets **one** local
  seat, `CELL_PIN_OFFSET` (80) along that pin's exit (R71, lines 218-290). If
  that seat collides, it falls back to the edge.
- A port between two facing gates gets two seats above and below (R93,
  lines 245-275).
- Everything else uses R19 (left/right edge nearest the host pin from the
  device-bounds centre; inputs left, outputs right on ties) and R20 (level with
  the host, 40-unit spacing), lines 291-395. R62 handles rail Cell Pins.
- `nextMarkerPlacements` (R72, lines 448-617) reseats reported blockers.
  `face-ports.ts` turns ports toward their routes after routing.
- Routed score: `routedScore` in `refine.ts` (R22/R74), including
  `offConvention` (input on the right or output on the left costs 300).

Measured on `bdb5f36` (T055 scoreboard, `tmp/le10-t055r2/report.json`):

| Port wire (all)                |   Human | Default |
| ------------------------------ | ------: | ------: |
| single-host ports              |  20,014 |  60,530 |
| multi-host ports               | 111,101 | 204,990 |
| crossings involving a port Net |     127 |     269 |

Opus's prototype, `tmp/proto/port-seat.mjs` (not product code): after the
default plan, for each port in id order, try seats at 40, 80 and 120 units
along the exit of **every** host pin of its Net, in four orientations, and
keep the one with the lowest `missing·10000 + crossings·1000 + bends·100 +
wire·1` after a full replan with devices and ports fixed. Against the same
fixed-placement replan without the port moves, on 314 drawings: crossings
377 → 304 (−19.4%), bends −7.8%, wire −11.5%, 261 drawings improved. It
costs about 49 full replans per drawing, far too slow for the product, and
its fixed-placement replan does not reproduce the default plan exactly, so
use it only as evidence of the opportunity, not as a design.

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`
prints the T055 scoreboard (primary ratios, every visual guard, net-kind
breakdowns, timing). Base report for comparison: `tmp/le10-t055r2/report.json`.
Data are third-party Gallery drawings under `tmp/le10-input/` (symlinks);
never commit them. Dev/val split as in T055. Rules end at R145; new rules
take R146 and up.

## Scope

Owned paths:

- `packages/auto-layout/src/**` (mainly `place-markers.ts`, `auto-layout.ts`,
  `refine.ts`, a new module if useful), `packages/auto-layout/test/**`
- `docs/specs/auto-layout.md` (R19, R20, R71, R93 and a new rule)
- `tasks/T056-port-seat-search/report.md`

Out of scope:

- The router, `packages/derived`, `packages/edit-engine`, `packages/model`.
- Device placement and rail (supply/ground) markers.
- `quality: "optimized"` and partition mode behavior; documents above 40
  instances (their plans stay byte-identical to the base).

## Steps

1. Generate candidate seats for every non-rail port: for each host pin of its
   Net, seats along the pin's exit at a few grid-snapped distances, facing the
   host; plus its current R19/R20 edge seat. Keep the input-left / output-right
   convention as the existing `offConvention` score term, not as a filter.
2. Rank candidates cheaply first (for example half-perimeter or MST length of
   the port's Net plus estimated crossings with other Nets, in the style of
   `estimate.ts`), then fully route and score only the best few with
   `routedScore`, inside the planner's normal pipeline (before R72, R95 and
   the finishing passes, so they still run). Keep the current seat on ties.
   Deterministic: candidate counts, not wall-clock time.
3. Choose the evaluation budget so a paired timing run (base and new at the
   same time, same `--jobs`) gives median planning time at most 2× base and
   p95 at most 10 s per drawing.
4. Tests: synthetic documents where a port's best seat is next to a second
   host pin, where the local seat is blocked, and where only the edge seat
   routes; determinism; fixed (locked) ports untouched.
5. Update the spec rules you change and add the new rule.
6. Evaluate all 628 drawings; report dev and val.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Behavioral checks against `tmp/le10-t055r2/report.json`:

- Port wire (all) at least 25% lower; crossings involving a port Net at least
  20% lower; total crossings and total wire lower on dev **and** on val.
- Guards: completed ≥ 627, no non-equivalent drawing, floating pins ≤ 10,
  missing connections ≤ 18, every `VISUAL_*` total not above the base.
- Determinism: two runs give identical plan hashes and non-timing results.
- The 6 documents above 40 instances in
  `/Users/huzhifeng/workspace/auto-canvas-cases/human/cases/` produce plans
  byte-identical to the base.
- Timing as in step 3.

If a target is missed, report the best result, which target, and why.

## Notes for the implementer

- General method only: the same candidate generation and scoring for every
  port of every document. No branches on circuit type, symbol family, tag,
  id, name or coordinates.
- Tune on dev; report val.
- Existing tests encode layout contracts (port facing, order of source and
  load, finishing passes run last). Satisfy them; do not edit them. If one
  conflicts with the goal, stop and report it.
