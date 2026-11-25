# T183 review

## Round 1

Verdict: **changes required** — Round 1's crossing polish, broken-stack repair, and peer-unit pin-jog straightening delivered strong corpus gains across both corpora (netlist crossings `271 → 251`, bends `1,854 → 1,814`, broken stacks `215 → 204`; drawing crossings `292 → 274`, bends `1,924 → 1,878`, broken stacks `227 → 185`, pin jogs `293 → 276`) with zero lost completions and zero integrity failures. Fix the two remaining scope-gated items (both files have now been added to `plan.md`'s owned paths).

### Findings

1. **must-fix — Isolate `packages/auto-layout/test/stack-snap.test.ts:332` from finished-stage `repairBrokenStacks`.**
   That test mocks `snap.stackPairs` to `[]` to verify that R166 draft alignment (`layered+stack`) leaves the portfolio untouched when an original draft wins. Because `repairBrokenStacks` also calls `snap.stackPairs`, the mock inadvertently disabled finished-stage stack repair in `without` while leaving it enabled in `plan`. Spy on `crossingPolish.repairBrokenStacks` returning `initial` across both `without` and `plan` (restored in `finally`) with a brief comment explaining the isolation from finished-stage stack repair, leaving all existing assertions intact.

2. **must-fix — Add `"crossingPolish"` and `"stackRepair"` to `packages/auto-layout/src/timing.ts` and wrap both calls in `auto-layout.ts` with `timePhase(...)`.**
   Add both phase keys to `PlanningPhase` and their zero-initialized entries in `phases` and `phaseCalls` in `timing.ts`, and wrap `polishCrossings` and `repairBrokenStacks` in `packages/auto-layout/src/auto-layout.ts` with `timePhase("crossingPolish", ...)` and `timePhase("stackRepair", ...)`.

### Notes for round 2

- Do **not** alter the layout logic in `crossing-polish.ts` or `pin-jogs.ts` (already verified and approved).
- Because neither `timing.ts` nor `stack-snap.test.ts` changes any deterministic layout output, you do **not** need to rerun the two `scripts/auto-layout-eval.mjs` corpus evaluations — reuse `tmp/t183/{netlist,drawing}/report.json` and run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`, `pnpm test:slow`, and the strict gate check, then write `tasks/T183-targeted-post-finishing-polish/report.md` for round 2.
