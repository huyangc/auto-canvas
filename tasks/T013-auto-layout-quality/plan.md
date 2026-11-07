# T013 — Auto-layout v1, part 3: drawing quality and generality

- Branch: `task/T013-auto-layout-quality`
- Base: `task/T012-auto-layout-routing` at `05276cb` (stacked on open PR #16)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user reviewed T012 and found avoidable corners and crossings: a jog at M4 in
`five-t-ota`, outputs wired far around in `fig-17-19b`, and a flipped op amp in
`two-stage-symbolic`. They asked for a general fix, not per-circuit patches.
After this task the planner chooses placement details from pin geometry and
wire cost, proves itself on circuits nobody tuned it on, and no longer accepts a
drawing that reads as a short. The lock field and editor button move to T014.

## Context

Verified on `05276cb`.

### Root causes

1. **Fixed member pitch.** `expandTemplates` (`packages/auto-layout/src/place.ts`)
   uses `MEMBER_PITCH` (100) for every group, measured between origins. MOS D/S
   pins sit at local `x: +10` (`packages/components/definitions/{n,p}mos.json`),
   and pair and mirror members are mirrored oppositely, so drain columns of a
   stacked mirror and pair differ by 20 units and need a jog. The hand-drawn OTA
   uses pitches 100 and 140, which cancels this exactly.
2. **Cell Pin side by role only.** `placeCellPins`
   (`packages/auto-layout/src/place-markers.ts:113`) sends every output right, so
   a left-branch output crosses the circuit. The `rightGate` branch is a
   one-off for the same issue.
3. **Default block orientation.** `placeFallback`
   (`packages/auto-layout/src/place-fallback.ts`) always uses `mirror: "none"`.
   `opamp` has `IN-` at `y: -10` and `IN+` at `y: +10`, so the feedback input
   faces up. The hand-drawn circuit shows `+` on top.
4. **Port nudging.** In `placeCellPins`, the 40-unit spacing pushes whichever
   port sorts later. In `fig-17-19b` that moves Vin off its gate and adds a jog,
   though Vout could tap its vertical wire at any height.

### Spike (throwaway, reverted)

Hard-coding pair pitch 140, left-of-centre outputs to the left edge and a vertical
mirror on the op amp gave:

| Case               | Crossings | Bends              |
| ------------------ | --------- | ------------------ |
| five-t-ota         | 0 → 0     | 2 → 1              |
| fig-17-19b         | 2 → 0     | 5 → 2              |
| two-inverters      | 1 → 1     | 2 → 1              |
| differential-stage | 0 → 0     | 0 → 1 (regression) |
| two-stage-symbolic | 1 → 0     | 3 → 3              |

The direction is right. The hard-coded values are not acceptable. The regression
shows pitch must change only for a stacked group.

### Held-out circuits

Run on `05276cb`, never used to tune anything:

| Held-out id        | File · Document                                                                              | Instances | Today                                               |
| ------------------ | -------------------------------------------------------------------------------------------- | --------: | --------------------------------------------------- |
| `fd-two-stage`     | `apps/editor/src/examples/fully-differential-two-stage-op-amp.icproj.json` · `document-main` |        20 | refused: `R10: coincident pin at 440,230`           |
| `common-source-ac` | `apps/editor/src/examples/common-source-amplifier.icproj.json` · `document-main`             |        10 | refused: `R10: coincident pin at 620,580`           |
| `skew`             | `fixtures/gallery-redline/f22q5vhdb5.icproj.json` · top                                      |        18 | refused: `R10: bounds overlap VDD1-copy-1, VDD1`    |
| `deadtime`         | `fixtures/gallery-redline/3tfmrzevfe.icproj.json` · top                                      |        30 | refused: coincident pin                             |
| `ota-sky130`       | `apps/editor/src/examples/five-transistor-ota-sky130.icproj.json` · `document-ota-5t`        |        12 | commits; 6 crossings, 5 bends, supply trunk warning |
| `widlar`           | `fixtures/gallery-redline/b5cn37k3a9.icproj.json` · `document-main`                          |        10 | commits, **3 audit problems**                       |
| `ltc3452`          | `fixtures/gallery-redline/ycg43babwa.icproj.json` · `document-main`                          |        21 | commits; 19 crossings, 28 bends, one warning        |

`widlar` is a real defect. `R1.1` to `Q1.E` fails to route, and the Edit Engine's
direct-contact reconciliation then adds a Route that crosses R1 and overlaps
another Net. That reads as a short, and the planner reports success.

### Existing helpers

- `auditRouting(document, resolver)` (`src/routing-audit.ts:47`) returns
  `crossings`, `bends`, `wireLength`, `problems`.
- `planAutoLayout` (`src/auto-layout.ts`) replays the full list in `preview`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-review.mjs`
- `knip.config.js`: only the comment that names T013 as removal point, now T014

Out of scope (do not change):

- `packages/edit-engine/**`, `packages/model/**`,
  `packages/project-protocol/**`, `packages/spice/**`, `fixtures/**`, `apps/**`
- A new general-purpose router, lock fields and the editor button (T014)

## Steps

1. **Spec.** Add R18–R26 to `docs/specs/auto-layout.md`, update R7 and R8, and
   change every "T013" to "T014".

   - **R18 Pin-aligned stacks (replaces fixed pitch for stacks).** When one
     group is stacked on another, the channel pins they share lie on one vertical
     line. Derive the two pitches from the pins' local `x` after orientation: the
     smaller pitch is `MEMBER_PITCH`, the other follows, and both stay on the
     grid. An unstacked group keeps `MEMBER_PITCH`. A tail's shared channel pin
     lies on the axis. A PMOS above an NMOS sharing a drain aligns those drain
     pins, not the origins. Never name a pin offset or a symbol in the code: read
     `pin.at` through the orientation.
   - **R19 Cell Pin side.** An input or output Cell Pin goes to the left or right
     edge nearest its host pin, measured from the centre of the device bounds.
     An exact tie follows the convention: input left, output right. This replaces
     the `rightGate` branch. Supply and ground stay top and bottom.
   - **R20 Port spacing.** A Cell Pin stays level with its host pin. When two on
     one side are less than 40 units apart, the one whose Net has more pins moves,
     away from the other, because its wire can tap elsewhere. A tie moves the
     later `id`.
   - **R21 Orientation by wire cost.** Each instance whose orientation no template
     fixes is a choice: a multi-pin block between `"none"` and `"vertical"`, a
     two-pin part between its two pin-to-pin flips where R9 allows both. Each takes
     the option with the smallest half-perimeter wire length over its Nets, given
     the other placements; ties keep the first. Two passes in `id` order.
   - **R22 Refinement by routed cost.** After a complete plan, score it from the
     final preview: `unrouted × 10000 + crossings × 1000 + offConvention × 300 +
bends × 100 + wireLength / 10`, each weight a named constant.
     `offConvention` counts input Cell Pins on the right edge and output Cell
     Pins on the left edge, so a port leaves its conventional side only when that
     saves a crossing. Signal flow stays left to right. Candidate moves, in `id`
     order: flip one Cell Pin's side between left and right; flip one R21 choice.
     Replan each fully. Accept the best improving move, and repeat for at most two
     passes and at most 24 evaluated candidates. Fixed instances never move.
     A candidate with an `error` diagnostic is discarded, and the default plan
     still stands if every candidate fails. Same input, same result.
   - **R23 Audit as a guard.** After the final preview, run `auditRouting`. A
     Route crossing an Instance or two Routes of different Nets overlapping is an
     `error`: return no edits and an R10 diagnostic naming them. Drafting
     intersections stay the existing warning.
   - **R25 Touching pins stay joined.** Pins that coincide in the input and are
     on one frozen pin group stay physically joined. A `ground` or `vdd-port`
     marker's R6a host is the pin it touches, if any, before the id-order pairing.
     Any other touching pair on a power Net that R12 would leave unjoined becomes
     one more exact stub target. MOS `B` pins are excluded. Otherwise placement
     separates the pair and the Edit Engine's `reconcileTransformDirectContacts`
     adds a straight Route with no clearance check, which is how `fd-two-stage`
     merges `net-tail-1` and `net-tail-2` into ground.
   - **R26 Single-pin power Nets.** A power Net with one routable pin whose
     `name-claim` is owned by removed geometry (`common-source-ac`:
     `net-power-vdd7`, R3.1 only) gets one clearance-checked stub 40 units
     outward, up for supply and down for ground. The stub Route takes the claim
     under R12 and the label under R15. If no clear stub exists, R10 still
     refuses.
   - **R24 Placement collisions.** A coincident pin or overlap between instances
     no template pins together is not a reason to refuse. Resolve it by moving the
     later `id` along its row or column in grid steps, up to 40 steps, and refuse
     only if that fails. Investigate each held-out refusal first and report its
     cause.

2. **`src/place.ts`:** R18, R24. **`src/place-markers.ts`:** R19, R20.
   **`src/place-fallback.ts`:** R21.

3. **`src/refine.ts`** (new): R22, calling the existing plan in a loop.
   `planAutoLayout` keeps its signature. The plan needs an internal options
   argument for side and orientation overrides, not exported.

4. **`src/auto-layout.ts`:** R23.

5. **Tests.**
   - `corpus.test.ts`: replace the old `MEMBER_PITCH` assertions with R18. For
     every case, crossings and bends must not exceed these targets (the best of
     T012 and the spike):

     | Case                         | Crossings | Bends |
     | ---------------------------- | --------: | ----: |
     | five-t-ota                   |         0 |     1 |
     | fig-17-19b                   |         0 |     2 |
     | two-inverters                |         1 |     2 |
     | differential-stage           |         0 |     0 |
     | common-source                |         0 |     2 |
     | rc-lowpass, rc-highpass, rlc |         0 |     0 |
     | two-stage-symbolic           |         0 |     3 |

   - Explicit: in `five-t-ota`, M2.D and M3.D share `x`, M1.D and M4.D share `x`,
     and M4's drain Route has no bend; in `fig-17-19b`, M1.S and M2.D share `x`,
     each input Cell Pin is level with its gate, and the two output Cell Pins are
     on opposite edges; in `two-stage-symbolic`, X7.IN+ is above X7.IN-.
   - New `held-out.test.ts` over the seven held-out ids. For each: never throws;
     either an `error` diagnostic and no edits, or a commit that keeps every
     terminal's Net with an empty `auditRouting.problems`, drafting entries aside.
     `fd-two-stage`, `common-source-ac` and `skew` must commit. Do not assert
     crossing counts here, and never tune a constant or rule to a held-out case.
   - Unit tests: R18 on a hand-built stack, including a symbol with different pin
     offsets; R19 tie; R20 which port moves; R23 refusal; R22 determinism and that
     the result never scores worse than the default plan.

6. **Review script:** add the held-out ids in a separate section, with score and
   metrics, and print the before and after table of step 7.

7. **Investigate and report:** the metrics table for all sixteen documents next to
   the `05276cb` values above; candidates evaluated and wall time per case; each
   held-out refusal's cause and outcome.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output (deadcode itself exits 1 on main)
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0, 9 corpus and 7 held-out results
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
```

Baseline on `05276cb`: all of the above pass, with 7330 tests.

Behavioral checks:

- `five-t-ota`, `fig-17-19b` and `two-stage-symbolic` read like their hand-drawn
  originals in the review page.
- `planAutoLayout` stays under 3 s on the 30-instance `deadtime`.

## Notes for the implementer

- Never key behavior to a corpus or held-out case, a Reference, an instance id or
  a symbol id, other than the existing marker and MOS classifications.
- The weights in R22 are starting values. Keep them named and in one place. If a
  case needs a different weight, report it instead of special-casing.
- A rule that helps the corpus but hurts held-out metrics is not an improvement.
  Report the trade-off.
- Keep `planAutoLayout` deterministic: no clock in any decision.
