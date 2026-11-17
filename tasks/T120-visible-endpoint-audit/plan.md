# T120 — Audit only visible endpoints; declared rails stay rails

- Branch: `task/T120-visible-endpoint-audit`
- Base: `main` at `ac0db38`
- Status: approved (user, 2026-11-16: land the integrity fixes separately)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

Two measurement bugs in the auto-layout evaluation are fixed with no change to
any planned layout: (1) a Net declared `powerDomain: ground | vdd` by a name
claim counts as a rail in the readability netlist even when no rail marker is
left on it; (2) `missingConnections` / `floatingPins` only consider endpoints
that are visible, so supply pins hidden by a symbol's `signal-pins` artwork no
longer count as missing wires.

## Context

- `packages/auto-layout/src/readability-netlist.ts:24` builds `rails` from
  markers only. `projection.nameClaimsByOwner` (from
  `deriveElectricalTopologyProjection`) carries `powerDomain` and `netId`.
- `packages/auto-layout/src/routing-audit.ts:25-31` (`computeConnectionPins`)
  lists every non-bulk symbol pin. `isVisibleEndpoint(document, resolver,
  { kind: "terminal", instanceId, pinName })` is exported by `@icm/derived`
  (`packages/derived/src/endpoint.ts`).
- On main, corpus cases `ne46whs3fw` and `s75dft4ssy` report
  `missingConnections: 2` each because an op-amp's hidden VDD/VSS pins are
  counted.
- Reference implementation (read-only, do not copy unrelated hunks):
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/codex-readability-trust`
  — `git -C <that> diff HEAD -- packages/auto-layout/src/readability-netlist.ts
  packages/auto-layout/src/routing-audit.ts`, tests
  `packages/auto-layout/test/visible-supply.test.ts` and the two power-domain
  tests in `packages/auto-layout/test/readability-detectors.test.ts` (search
  `powerDomain`). In the `routing-audit.ts` hunk take ONLY the
  `isVisibleEndpoint` half; the `mosBulkShouldBeVisible` half belongs to T121.

## Scope

Owned paths:

- `packages/auto-layout/src/readability-netlist.ts`
- `packages/auto-layout/src/routing-audit.ts`
- `packages/auto-layout/test/visible-supply.test.ts` (new)
- `packages/auto-layout/test/readability-detectors.test.ts` (two tests only)
- `docs/specs/auto-layout.md`, `docs/testing/readability.md` (only the
  sentences describing these two measures, if they exist)

Out of scope: any planner behaviour, bulk pins, the evaluation script, every
other file. No test fixture copied from a Gallery drawing; fixtures are
synthetic.

## Steps

1. In `readabilityNetlist`, add every claim with `powerDomain` ground or vdd to
   `rails`, normalised through `logicalNet` like terminals.
2. In `computeConnectionPins`, keep a pin only if `isVisibleEndpoint` is true
   (bulk pins stay excluded exactly as today).
3. Add the tests named above (synthetic documents).
4. Investigate: confirm by a targeted run that planned layouts are unchanged —
   the planner must not consume either function in a way that changes plans.
   `grep -rn "readabilityNetlist\|floatingPins\|missingConnections"
   packages/auto-layout/src` and report every planner call site and why its
   decisions cannot change, or which cases change.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build            # 0
pnpm typecheck        # 0
pnpm lint             # 0 errors
pnpm format:check     # 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs /Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/le10-input --jobs 6
```

- Plan hashes equal those in the report below, except cases whose false
  missing connections changed the R22 ranking (review round 1: only
  `s75dft4ssy`); every such case is listed and looked at. Reference:
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/auto-layout-eval/report.json`.
- `ne46whs3fw` and `s75dft4ssy`: `result.missingConnections` 2 → 0; list every
  other case whose `missingConnections`, `floatingPins`, `signalDirection` or
  `netlistSymmetry` changed, for human and result.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation; the reviewer commits. If plans change in step 4,
stop and report instead of adjusting the planner.
