# T174: Transparent 1-Device Wrapper Subcircuit Symbol Recovery

- Branch: `monte_carlo_circuit_placement`
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

When importing SPICE netlists that wrap a single primitive or reviewed PDK device inside a local `.subckt` wrapper (such as SKY130 SI-unit wrappers `IV_SKY_N_SI`, `IV_SKY_P_SI`, and `IV_SKY_PNP3`), recover the wrapped device's built-in schematic symbol (`nmos`, `pmos`, `ndmos`, `pdmos`, `npn`, `pnp`, `diode`, `zener-diode`, `resistor`, `capacitor`, `inductor`, `inductor-compact`) on callers instead of degrading every transistor to an opaque 4-pin `hierarchical-symbol-*` box, while preserving exact child-subcircuit binding, formal parameters, ERC validity, and lossless SPICE netlist export round-trips.

## Why

In Netlist-mode evaluations (e.g., `qzszatannt`, `dr4e8zhyjg`, `rxdzz3wdry`), PDK device wrappers such as:

```spice
.subckt IV_SKY_N_SI D G S B params: W=20u L=1u MULT=1
.param FINGER_W={min(10u,max(1u,W))}
.param WRAP_PARALLEL_M={MULT*W/FINGER_W}
XPDK D G S B sky130_fd_pr__nfet_g5v0d10v5 W={FINGER_W} L={L} m={WRAP_PARALLEL_M}
.ends IV_SKY_N_SI
```

currently hit `symbolFor`'s unconditional `instance.target.kind === "subcircuit"` fallback in `packages/spice/src/importer.ts`, assigning `hierarchical-symbol-*`. Because `auto-layout` only sees anonymous 4-pin boxes instead of `nmos`/`pmos`/`pnp` devices, polarity ordering, MOS symmetry, DC branch columns, and functional role placement cannot recognize the transistors at all.

Meanwhile, existing upstream policy (#1450, tested in `packages/spice/src/import-reviewed-symbol.test.ts`) deliberately keeps external standard-cell calls (e.g. `sky130_fd_sc_hd__nand2_1`) as external blocks because their 4 supply/body rails have no canvas pins on Library gate symbols. This task preserves #1450 untouched and strictly targets transparent 1-device local `.subckt` wrappers where every formal port maps 1-to-1 to a real canvas pin of the wrapped primitive symbol.

## Owned Paths

- `packages/spice/src/importer.ts`
- `packages/spice/src/import-wrapper-symbol.test.ts` (new)
- `packages/auto-layout/src/net-roles.ts`
- `packages/netlist/src/roundtrip.test.ts` (add round-trip coverage for transparent wrapper subcircuits)
- `docs/specs/spice-frontend.md`

## Implementation Steps

1. **Add transparent 1-device wrapper resolution in `packages/spice/src/importer.ts`**:
   - Import `builtInSymbols` from `@icm/symbols` (already a dependency of `@icm/spice`).
   - Build a helper `resolveTransparentWrapperSymbols(cells, modelTypeByName, symbolMappings, builtInBodies, namingProfile)` invoked in `importCircuitIR` on the filtered non-built-in, non-library `cells` before calling `importDocument`:
     - Eligible wrapped device classes: `const WRAPPER_DEVICE_CLASSES = new Set(["mos", "bjt", "diode", "resistor", "capacitor", "inductor"])`.
     - Map `builtInSymbolById = new Map(builtInSymbols.map(s => [s.id, s]))`.
     - Resolve each cell lazily with memoization and a `visiting: Set<string>` cycle guard (supporting nested 1-device wrappers while preventing infinite recursion on cyclic definitions).
     - A `cell` qualifies as a transparent 1-device wrapper if and only if ALL of the following hold:
       1. `cell.instances.length === 1`, the sole instance `sole` is not a mutual inductor (`!isMutualInductor(sole)`), has `sole.terminals.length > 0`, and `calledBuiltInBody(sole, builtInBodies)` is undefined.
       2. `cell.ports.length === sole.terminals.length` and `cell.ports.length > 0`.
       3. Resolving `sole` via `symbolFor(sole, modelTypeByName, symbolMappings, wrapperSymbols)` (recursively resolving `sole.target.cellName` if `sole.target.kind === "subcircuit"`) returns a mapping `inner` such that:
          - `isPdkMappableSymbolId(inner.symbolId)` is true,
          - `WRAPPER_DEVICE_CLASSES.has(deviceDescriptor(inner.symbolId)?.deviceClass ?? "")`,
          - `symbolDef = builtInSymbolById.get(inner.symbolId)` exists and `symbolDef.pins.length === sole.terminals.length`.
       4. Bijective 1-to-1 port pass-through:
          - All `cell.ports` have distinct `netId`s.
          - All `sole.terminals` have distinct `netId`s.
          - Every `cell.ports[p].netId` matches a unique terminal `sole.terminals[t]` (so no shorted pins, no internal hidden nodes, no internal ground `0` tap).
       5. Exact canvas pin-name compatibility (required for `extract-subcircuit.ts` and `erc.ts` compatibility):
          - For each terminal `t` of `sole`, compute `innerPinName = inner.pinNames?.[t] ?? sole.terminals[t].name`. Every `innerPinName` must be defined, distinct across `sole.terminals`, and present in `symbolDef.pins.map(p => p.name)`.
          - For each formal port `p` of `cell`, compute `importedPortName = importedNetName(port.name, cell.nets.find(n => n.id === port.netId)?.scope ?? "local", namingProfile).name`.
          - Find the unique `t` with `sole.terminals[t].netId === port.netId` and verify `importedPortName === innerPinName` (exact-case match).
     - When qualified, record `{ symbolId: inner.symbolId, pinNames }` for `cell.name.toLowerCase()`, where `pinNames` is ordered by `cell.ports` (each port's matched `innerPinName`). Do NOT copy `registryId` or `reviewedMaster` onto the wrapper mapping so callers keep their `subcircuit` binding and verbatim SI/formal parameter values without SKY130 micron conversion.
   - Thread `wrapperSymbols` into `importDocument` -> `importInstance` -> `symbolFor`:
     - In `symbolFor`, when `instance.target.kind === "subcircuit"`, if `wrapper = wrapperSymbols.get(instance.target.cellName.toLowerCase())` exists and `wrapper.pinNames?.length === instance.terminals.length`, return `wrapper`. Otherwise return the existing `hierarchical-symbol-*` mapping.
   - Keep `importedNetlistBinding`, `importProvenance`, and `bindImportedChildDocuments` semantics intact so the calling instance keeps `binding: { kind: "subcircuit", childDocumentId }` and `importProvenance.kind === "subcircuit"`.

2. **Preserve child-subcircuit binding identity in `packages/auto-layout/src/net-roles.ts`**:
   - In `modelIdentity(instance)`, handle `binding?.kind === "subcircuit"` by returning `` `child:${binding.childDocumentId}` `` so `familyCompatible` treats devices bound to the same wrapper subcircuit as family-compatible and devices bound to different wrapper subcircuits as distinct families.

3. **Update specification in `docs/specs/spice-frontend.md`**:
   - Document the transparent 1-device wrapper subcircuit symbol recovery rule alongside the existing `X` / `.subckt` import rules: a local `.subckt` whose body contains a single mappable primitive/PDK device (`mos`, `bjt`, `diode`, `resistor`, `capacitor`, `inductor`) with a bijective 1-to-1 pass-through of formal ports whose names match the wrapped symbol's canvas pins exact-case renders callers with that built-in symbol while keeping the child `subcircuit` binding and formal parameters unchanged.

4. **Add comprehensive tests**:
   - Create `packages/spice/src/import-wrapper-symbol.test.ts` covering:
     - `IV_SKY_N_SI` / `IV_SKY_P_SI` wrapping `sky130_fd_pr__nfet_g5v0d10v5` / `sky130_fd_pr__pfet_g5v0d10v5` -> callers import as `nmos`/`pmos`, keep `binding.kind === "subcircuit"`, preserve `W`/`L` in SI units, map `D/G/S/B` terminals accurately, and preserve `mosBulkDefaults`.
     - `IV_SKY_PNP3` wrapping `sky130_fd_pr__pnp_05v5_W3p40L3p40` -> caller imports as `pnp` with `C/B/E` pins.
     - Permuted formal port order (e.g., `.subckt WRAP_N G D S B` wrapping `XPDK D G S B sky130_fd_pr__nfet_g5v0d10v5`) -> callers map positional terminals according to wrapper port order.
     - Nested 2-level wrapper (`WRAP_OUTER -> WRAP_INNER -> sky130_fd_pr__nfet_01v8`) -> imports as `nmos`.
     - Primitive and `.model` wrappers (e.g., `.subckt MY_RES 1 2; R1 1 2 {R}; .ends` and `.subckt MY_NMOS D G S B; M1 D G S B nch; .ends`) -> import as `resistor` and `nmos`.
     - Negative/guard cases that MUST stay `hierarchical-symbol-*`:
       - 2-device subcircuit (e.g. CMOS inverter)
       - Diode-connected/shorted 1-device wrapper (`XPDK D D S B ...`)
       - 3-port wrapper tying `B` to `0` internally
       - Case/name mismatch on formal ports (`.subckt MY_N d g s b` or `drain gate source bulk`)
       - 4-port wrapper around a 3-canvas-pin device (`sky130_fd_pr__npn_05v5_W1p00L1p00` whose `S` is a property pin)
       - Caller terminal-count mismatch
       - Mutually cyclic 1-device wrapper subcircuits (terminates cleanly without throwing)
   - Add a round-trip test in `packages/netlist/src/roundtrip.test.ts` verifying that a SPICE netlist with `IV_SKY_N_SI` / `IV_SKY_P_SI` imports with `nmos`/`pmos` symbols, passes `createDesignNetlistExport` with zero errors, and re-exports with an equivalent electrical graph (`compareElectricalGraphs` === `"equivalent"`).

## Acceptance Criteria

Run all of the following and verify zero errors:
1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm docs:check`
6. `pnpm vitest run packages/spice packages/netlist packages/derived packages/auto-layout`
7. Existing #1450 standard-cell test in `packages/spice/src/import-reviewed-symbol.test.ts` continues to pass unchanged.
