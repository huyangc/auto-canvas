# T204 — Face shared-gate diode-connected cascode pairs inward in symmetric blocks

- Branch: `netlist_canvas_algorithm_comparison`
- Base: `main` at `f45c0797`
- Status: approved
- Plan review: self-checked against `packages/auto-layout/src/layered.ts`, `packages/auto-layout/src/symmetry.ts`, `packages/auto-layout/src/recognize.ts`, and `docs/specs/auto-layout.md` (R89/R90/R92)

## Goal

In symmetric half-circuit placement (`packages/auto-layout/src/layered.ts`), orient any paired transistor pair whose left and right members share the exact same gate Net inward (`horizontal` / `none`), even when one member is diode-connected (`G = D`) to a mirrored drain Net and `netMap.get(gate)` therefore maps to the opposite drain Net instead of `gate`. This eliminates the outward-facing wraparound wire, crossing, and extra bends seen on diode-connected cascode mirrors (hitting 29/101 LOADBench op-amps, such as `OneStageOpAmps-SimpleOpAmp4`).

## Context

- `packages/auto-layout/src/layered.ts:584-597` sets the left member's `mirror` for each `[left, right]` pair in a `SymmetryComponent`:
  - Recognized `groups` follow `facesOutward(group)`.
  - Unrecognized paired transistors fall back to `gate && netMap.get(gate) === gate ? "horizontal" : "none"`.
- For a diode-connected cascode pair (e.g., `mNormalTransistorNmos4` + `mDiodeTransistorNmos1` in `OneStageOpAmps-SimpleOpAmp4`):
  - They do not share `S`, so `recognizeSubstructures` does not emit `current-mirror` (`recognize.ts:171`) or `matched-pair` (`recognize.ts:358`).
  - One member is diode-connected, so R90 `common-gate-pair` (`recognize.ts:387,395`) excludes them.
  - R88 `symmetryTopology` pairs them via their mirrored drains (`D_left <-> D_right`), where `netMap.get(gate)` is `D_left` (`!== gate`) because `gate === D_right`.
  - Consequently `layered.ts:596` sets `p.mirror = "none"` (outward), and R94 locks the symmetric component as a rigid unit in `placementUnits`, preventing downstream refinement/SA/APR from flipping them inward.
- `docs/specs/auto-layout.md` lines 1742–1744 (R89) document this orientation rule and must be updated to match.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/layered.ts`
- `packages/auto-layout/test/symmetry.test.ts`
- `docs/specs/auto-layout.md`
- `tasks/T204-shared-gate-cascode-facing/plan.md`
- `tasks/T204-shared-gate-cascode-facing/report.md`

Out of scope (do not change):

- R88 `symmetryTopology` net involution rules (`symmetry.ts`)
- R90 `common-gate-pair` recognition semantics (`recognize.ts`, which would change recognized group membership and persisted layout groups)
- Larger algorithmic synthesis work (tracked separately after user scope confirmation)

## Steps

1. Update `packages/auto-layout/src/layered.ts:591-597` so unpaired symmetric channel devices orient inward (`"horizontal"`) when `gate && (netMap.get(gate) === gate || gate === roles.pinNet(right, channel.gate))`.
2. Update `docs/specs/auto-layout.md` (R89, lines 1742–1744) to document the shared-gate inward facing rule.
3. Add regression tests in `packages/auto-layout/test/symmetry.test.ts` covering a diode-connected shared-gate cascode pair stacked between a differential pair and a lower current mirror (verifying inward orientation `["horizontal", "none"]`, zero crossings, and fewer bends in full `planAutoLayout`).
4. Build and run full verification (`pnpm build`, `pnpm vitest run packages/auto-layout`, `pnpm test:slow`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`), plus measure exact before/after metrics on `loadbench-101`, `spice-515`, and `human-30`.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm vitest run packages/auto-layout
pnpm test:slow
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
```

Behavioral checks:

- Diode-connected shared-gate cascode pairs (such as `OneStageOpAmps-SimpleOpAmp4`) face inward with a single straight horizontal gate wire between them and no wraparound crossing over the left drain.
- Ordinary differential pairs (distinct gates), split tails (`facing: "outward"`), and non-diode common-gate pairs remain unchanged.

## Notes for the implementer

- Keep the change minimal and strictly deterministic.
- Verify no regressions on existing `symmetry.test.ts`, `recognition-cascode.test.ts`, `test:slow`, or the 3 benchmark datasets.
