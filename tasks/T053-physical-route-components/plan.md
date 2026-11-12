# T053 — Auto-layout routes to physical components, not label-joined ones

- Branch: `task/T053-physical-route-components`
- Base: `main` at `b507797` (after PRs #47 and #48)
- Status: approved

## Goal

Auto-layout must never leave a pin floating because `planRouteNet` counted it
as already joined through a same-name label. After this task, `planRouteNet`
called by auto-layout groups the requested pins by physical connectivity
(Routes and contacts only, the same basis R11, R43 and R86 use), so every
requested pin gets drawn ink. On the ≤10-part Gallery evaluation,
`qzszatannt` (T052 class C) finishes with 0 floating pins, 0 missing
connections and no `AUTO_LAYOUT_NET_UNROUTED` warning; no other drawing gets
worse. Editor and Agent `route-net` behavior is unchanged.

## Context

Root cause (verified by Opus on T052 head `14cd077`):

- R11 (`docs/specs/auto-layout.md:249-252`) freezes pin groups per Base Net with
  `deriveElectricalTopologyProjection` and routes `target: { kind: "pins" }`.
  `deriveElectricalTopologyProjection`
  (`packages/derived/src/electrical-topology-projection.ts:87-176`) unions
  only Route connections and contact evidence; labels never join physical
  components. `floatingPins` and `missingConnections`
  (`packages/auto-layout/src/routing-audit.ts:13-82`, R43/R86) read
  `endpointToPhysicalComponent` from that projection.
- `planRouteNetOnce` (`packages/edit-engine/src/route-net-planner.ts:247-276`)
  instead groups the selected endpoints with `deriveNetConnectivity`
  (`packages/derived/src/connectivity.ts:99-252`), whose components also union
  endpoints bound to same-name net and power labels (`connectivity.ts:169-226`).
  A component containing any selected pin is one routing component; it is
  joined once, through whichever of its nodes is cheapest.
- In `qzszatannt` four hidden `power-label`s on `n-gnd`, object-anchored to
  instances `M10n`, `M12`, `M13`, `MN`, bind (no Routes yet) to the nearest
  Net endpoint: `M10n.B`, `M12.B`, `M13.B`, `MN.S`. The router asked to join
  `I2.-` and `MN.S` sees one component `{M10n.B, M12.B, M13.B, MN.S}`, draws
  `I2.-`→`M12.B` and reports nothing unjoined. `MN.S` gets no wire, so it is a
  floating pin (R43) and one missing connection (R86), reported as
  `AUTO_LAYOUT_NET_UNROUTED: Net n-gnd: floating pins: MN.S`.
- Aggravating factor, not the root cause: `resolveNetLabelBinding`
  (`packages/derived/src/net-label.ts:75-114`) binds a free/object-anchored
  label to the nearest same-Net Route once one exists, so the first wire moves
  all four labels onto that Route and even the visible grouping disappears.
  Opus prototyped making instance-anchored labels bind stably to their
  instance's pin: visible connectivity then stays joined, but `MN.S` is still
  physically floating, because the router still draws nothing to it. So the
  label binding is out of scope here.
- Prototype of the chosen fix (Opus, discarded; diff in
  `tmp/t053/prototype.diff`): a `planRouteNet` option that splits each visible
  component by `endpointToPhysicalComponent`, passed by both auto-layout
  callers. Eval on T052 head: 626 of 627 completed drawings have identical
  metrics; `qzszatannt` goes to 0 floating / 0 missing / no diagnostics,
  crossings 6→5, `equivalent: true`; no status change.

Callers of `planRouteNet` (`grep -rn "planRouteNet(" packages apps scripts`):

- `packages/auto-layout/src/route.ts:633` — R12–R14/R86 first pass
  (`netScope: "base"`, `partial: true`).
- `packages/auto-layout/src/local-reroute.ts:186` — R95/local reroute.
- `apps/editor/src/agent/browser-agent-command.ts:589` — Agent `route-net`;
  must keep today's behavior (option off by default).
- Tests: `packages/edit-engine/src/route-net-planner.test.ts`,
  `packages/auto-layout/test/{routing,rip-up,fresh-ids}.test.ts`.

Data and evaluation (local, git-ignored, never committed):

- `tmp/le10-input/` holds symlinks to the 628 projects in
  `/Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/by-size/{0-4,5-10}/`.
  Third-party drawings: do not copy them or excerpts into the repository.
  Recreate it if missing by copying the symlinks from another worktree
  (`cp -a <worktree>/tmp/le10-input tmp/`).
- `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12` takes about
  3 min and writes `tmp/auto-layout-eval/report.json`; move it aside before
  the next run.
- Base report: Opus runs the eval on the base commit into
  `tmp/le10-t053-base/report.json` before dispatch. Comparison:
  `python3 -I tmp/le10-analysis/compare.py <base> <new> /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/edit-engine/src/route-net-planner.ts`
- `packages/edit-engine/src/route-net-planner.test.ts`
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/local-reroute.ts`
- `packages/auto-layout/test/routing.test.ts` (or a new test file under
  `packages/auto-layout/test/`)
- `docs/specs/auto-layout.md` (R11 wording)
- `tasks/T053-physical-route-components/report.md`

Out of scope (do not change):

- `packages/derived/**`, including `resolveNetLabelBinding` and
  `deriveNetConnectivity` semantics.
- Default `planRouteNet` behavior for the editor and the Agent.
- R14 label fallback, search budgets, any other auto-layout rule.

## Steps

1. Add an option to `planRouteNet` (e.g. `components?: "visible" | "physical"`,
   default `"visible"`). With `"physical"`, `planRouteNetOnce` splits each
   `deriveNetConnectivity` component that contains a selected endpoint by
   `deriveElectricalTopologyProjection(document, resolver).endpointToPhysicalComponent`
   (compute the projection once per call). Each piece containing a selected
   endpoint becomes its own routing component, with a stable, deterministic id
   (derive from the visible component id and the physical component id);
   its other nodes in that piece stay attachment candidates. Pieces with no
   selected endpoint are skipped. Endpoints missing from the projection fall
   back to their own key.
   Everything downstream (trunk, tree, clearance, `unjoined`) is unchanged.
2. Pass the option from both auto-layout callers (`route.ts:633`,
   `local-reroute.ts:186`). Do not change the Agent caller.
3. Edit-engine test in `route-net-planner.test.ts`: a synthetic document with
   pins A, B, C on one Net and two same-name power labels (hidden or visible)
   binding to B and C, no Routes. Requesting pins A and C: default mode keeps
   today's result (one wire, C reached through the label group); `"physical"`
   mode draws wires so that A, B-if-requested and C are in one physical
   component (`deriveElectricalTopologyProjection`) and reports no `unjoined`.
   The physical-mode assertion must fail on the base.
4. Auto-layout regression: a small synthetic circuit (no Gallery data) where a
   non-bulk pin's only same-Net partner before routing is a same-name hidden
   label also bound to another pin (mirror the `qzszatannt` shape: a MOS
   source and other MOS bulks on ground, each with a hidden ground label
   object-anchored to its instance). Assert `planAutoLayout` returns no
   `AUTO_LAYOUT_NET_UNROUTED` and `floatingPins`/`missingConnections` are 0.
   Must fail on the base.
5. Amend R11 in `docs/specs/auto-layout.md`: `planRouteNet` groups the frozen
   pins by physical component (Routes and contacts); a label-only connection
   never counts as joined. No new rule number.
6. Run the acceptance commands and the eval; write `report.md` with the
   comparison output and every drawing whose metrics changed.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build                                   # expected: succeeds
pnpm typecheck                               # expected: succeeds
pnpm lint                                    # expected: 0 errors
pnpm format:check                            # expected: succeeds
pnpm exec vitest run packages/edit-engine packages/auto-layout/test   # expected: all pass, including the new tests
git diff --check                             # expected: clean
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12   # expected: 628 cases
python3 -I tmp/le10-analysis/compare.py tmp/le10-t053-base/report.json tmp/auto-layout-eval/report.json /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json
```

Behavioral checks:

- `qzszatannt`: completed, `equivalent: true`, 0 floating pins, 0 missing
  connections, no `AUTO_LAYOUT_NET_UNROUTED` warning.
- Every other drawing: no status change, still equivalent, and crossings,
  bends, floating pins and missing connections not higher than on the base.
  List any drawing whose metrics change at all.
- Both new tests fail on the base and pass on the branch.

## Notes for the implementer

- Fix the router's grouping, not the drawing: no case-specific code.
- Do not touch label binding in `packages/derived`; it is a separate editor
  question.
- Keep the change small; the prototype was about 15 lines in the planner.
- Do not run anything that calls an LLM API.
