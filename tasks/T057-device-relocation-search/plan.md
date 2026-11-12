# T057 — Relocate devices next to the pins they connect to

- Branch: `task/T057-device-relocation-search` (stacked on `task/T056-port-seat-search`, PR #51)
- Base: `task/T056-port-seat-search` at `abaae9f`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings, by general methods only. After T056, on
the 627 completed ≤10-part drawings, ratios to human are crossings 2.31,
bends 1.28, wire 1.54, median area 1.57 (`tmp/le10-t056r2/report.json`). The
remaining gap is device placement. This task adds one general kind of search
move, **relocating a placement unit next to a pin it connects to**, and
accepts it only by finished routed score with the T056 guards.

## Plan change after round 1 (Opus, 2026-11-12)

- **Partition fallback is default planning.** `partition.test.ts:666` states
  the contract: when a partition cannot be used, the result equals plain
  planning plus its warning. "Partition behavior unchanged" applies to plans
  that use a partition, not to the fallback. Run both R146 (port seats) and
  R147 (relocation) on the fallback path exactly as in plain planning, so the
  two tests pass unchanged. This also corrects T056, which disabled R146 there.
- **Use the timing headroom.** Round 1 measured median 1.34× and p95 1.39× of
  the base against limits of 2× and 1.5×. Round 2 may spend the rest on R147
  (for example a second coordinate pass or a larger trial cap), tuned on dev,
  if it lowers dev crossings or wire without a guard increase.

## Context

Measured by Opus:

- **Placement, not routing.** Routing human placements gives 0.99× crossings,
  0.70× bends, 0.94× wire (T055 review).
- **The existing annealer plateaus.** `--search 30` on dev with the current
  code: crossings 2.42 → 1.77×, bends 1.36 → 1.05×, but wire 1.55 → 1.61× and
  area 1.59 → 1.64 (`tmp/le10-t056-s30dev/report.json`). Its moves
  (`search-moves.ts`: same-row swap, shift by grid or `COLUMN_PITCH`, reflect
  a single, flip a side, block shift/swap/reverse/mirror) cannot move one
  device into another column or row and turn it in one step.
- **What goes wrong**, from small dev drawings where the human has no crossing
  and default has one or two (`3ykthcctg8`, `jqzavktq25`, `j8ap3bv7d6`,
  `29hn4q6qbk`): a device that humans stack directly under the device it
  connects to is put in another column and mirrored, so a feedback wire
  crosses; a gate port has no free seat because neighbouring columns leave no
  room; duplicate ports of one Net end up next to each other instead of next
  to their own hosts.
- **Cheap estimates are weak.** `createPlacementEstimator` correlates 0.40
  with routed crossings, a pin-direction-aware variant 0.51 with routed bends;
  pairwise agreement with routed results about 80%
  (`tmp/proto/est2-probe.mjs`). Use estimates only to shortlist; decide by
  finished routing.
- **What already works:** T056's `searchPortSeats` (`port-seat-search.ts`):
  deterministic coordinate pass, shortlist by estimate, finish each trial with
  the incumbent's passes, accept on lower calibrated score with no increase in
  floating pins, missing connections or any `VISUAL_*` count, translate back
  to the anchor. Reuse its structure.
- Placement units: `search-moves.ts:128-160` (rigid units from structures,
  attachments, layout groups, constraints, couplings). Never split a unit.
- Existing layout contracts in tests (source-to-load order, facing, finishing
  passes last, symmetry blocks) must hold; T055 round 1 shows that freezing
  every order and orientation leaves nothing to search, so enforce the tested
  contracts, not more.

Evaluation as in T055/T056: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`
(scoreboard with primary ratios, visual guards, breakdowns, timing). Base for
comparison: `tmp/le10-t056r2/report.json`. Data are third-party drawings
under `tmp/le10-input/`; never commit them. Rules end at R146; new rules take
R147 and up.

## Scope

Owned paths:

- `packages/auto-layout/src/**`, `packages/auto-layout/test/**`
- `docs/specs/auto-layout.md`
- `tasks/T057-device-relocation-search/report.md`

Out of scope: the router and other packages; optimized and partition modes;
documents above 40 instances (byte-identical to the base).

## Steps

1. **Candidates.** For each movable unit, for each of its pins connected on a
   non-rail Net to a pin of another unit, generate poses that put the unit's
   pin facing and aligned with that other pin (using `pinExit` and the
   transformed pin position) at one or two short distances, for each
   orientation the unit may take. Reject poses that overlap other units'
   bounds plus room for markers and ports.
2. **Search.** One or more deterministic coordinate passes over units
   (stable order), shortlisting a few poses per unit by estimate, then finishing
   and scoring them exactly as T056 does; accept on lower calibrated score with
   no guard increase; keep the anchor. Run it where T056's port search runs
   (default mode, ≤40 instances), before the port-seat pass so ports can then
   follow the moved devices.
3. **Budget.** Evaluation counts, not wall clock. Paired timing: median at most
   2× the base, p95 at most 1.5× the base p95.
4. **Tests.** Synthetic documents for: a device stacked under the device it
   feeds; a feedback device moved next to its driver; a blocked pose; a rigid
   unit moved whole; determinism; locked devices untouched.
5. Spec: the new rule, and R66 if the search budget changes.
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

Behavioral checks against `tmp/le10-t056r2/report.json`:

- Crossings and wire length lower on dev **and** val; bends not higher.
- Milestone (report if missed): all-drawing crossings ≤ 2.0× and wire ≤ 1.4×
  human.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism (plan hashes and non-timing results); the 6 large documents
  byte-identical; timing as in step 3.

## Notes for the implementer

- General method only: the same candidate rule for every unit of every
  document; no branches on circuit type, symbol family, tag, id, name or
  coordinates.
- Tune on dev; report val.
- If a tested contract blocks a clearly better layout, report the case; do not
  edit the test.
