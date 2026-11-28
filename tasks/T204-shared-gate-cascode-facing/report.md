# T204 — Report

## Summary

Fixed symmetric half-circuit orientation in `packages/auto-layout/src/layered.ts` (R89) so that paired transistors sharing the same gate Net face inward (`"horizontal"` / `"none"`) even when one member is diode-connected (`G = D`) to a mirrored drain Net and `netMap.get(gate)` therefore maps to the opposite drain Net rather than `gate`. Updated `docs/specs/auto-layout.md` (R89) and added a regression test in `packages/auto-layout/test/symmetry.test.ts`.

## Changes

- `packages/auto-layout/src/layered.ts`: In symmetric pair facing (R89, lines 591–599), check `gate && (netMap.get(gate) === gate || gate === rightGate)` where `rightGate = roles.pinNet(right, channel.gate)`.
- `docs/specs/auto-layout.md`: Updated R89 wording (lines 1742–1745) to document inward facing when the gate Net is self-mapped or shared by both paired members.
- `packages/auto-layout/test/symmetry.test.ts`: Added regression test `"faces a diode-connected shared-gate cascode pair inward even when its gate maps to the mirrored drain"` verifying both layered placement orientation (`["horizontal", "none"]`) and full `planAutoLayout` zero-crossing output.

## Verification

| Command | Result |
| --- | --- |
| `pnpm build` | Pass |
| `pnpm vitest run packages/auto-layout` | Pass — 96 files, 1,318/1,318 tests |
| `pnpm test:slow` | Pass — 6 files, 18/18 slow quality tests |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm docs:check` | Pass — 73 Markdown files validated |

## Corpus Impact (646 circuits, `presentation: "netlist"`, default search)

| Dataset | Valid | Changed | Crossings (Before → After) | Bends (Before → After) | WireLength (Before → After) | Mean Readability | Per-case Crossing Improved / Worse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| `loadbench-101` | 101/101 | 27 | `619 → 590` (**-29**) | `1,629 → 1,609` (**-20**) | `435,231 → 429,571` (**-5,660**) | `0.8279 → 0.7964` | **24 / 0** |
| `spice-515` | 514/515 | 3 | `219 → 216` (**-3**) | `1,822 → 1,819` (**-3**) | `442,904 → 442,544` (**-360**) | `0.1145 → 0.1138` | **3 / 0** |
| `human-30` | 29/30 | 0 | `252 → 252` (0) | `574 → 574` (0) | `166,950 → 166,950` (0) | `1.3211 → 1.3211` | **0 / 0** |

Standout fixes:
- `OneStageOpAmps-SimpleOpAmp4` / `6` / `13` / `36` / `40`: crossings `1 → 0`, bends `4 → 3`, wireLength `-120` to `-180`, readability `0.123 → 0.015`.
- `OneStageOpAmps-SimpleOpAmp46`: crossings `9 → 6`, readability `1.020 → 0.697`.
- `OneStageOpAmps-SimpleOpAmp82`: crossings `7 → 6`, bends `20 → 15`, wireLength `6,290 → 3,950`.
- `spice-515` (`9rb2z7hx4g`, `g4ebjfcbh4`, `vkkn3nhe76`): all `1 → 0` crossings, `3 → 2` bends, `-120` wireLength.
