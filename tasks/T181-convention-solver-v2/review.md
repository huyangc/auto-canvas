# T181 review

## Round 1

Verdict: **changes required** (test isolation for expanded R168 eligibility; all `src/` implementation and corpus gates look great and passed cleanly).

### Findings

1. **must-fix — Isolate 3 non-R168 unit tests from expanded R168 eligibility and update 1 base-hash fixture.**
   The 5 failing assertions in `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout` occur because T181's expanded R168 eligibility now produces optimal 0-crossing, 0-bend layouts on those non-R168 fixtures. All 4 files have now been added to `plan.md`'s owned paths. Fix them without weakening any rule assertion:
   - `packages/auto-layout/test/compact.test.ts` (`"R97 compacts the routed finalist only for a strict score decrease and repeats without moves"`, line 184): spy on `conventionRelations.conventionDraftEligible` returning `false` (restored in `finally`) with a brief comment explaining that this test isolates R97 compaction from R168.
   - `packages/auto-layout/test/device-relocation-search.test.ts` (`"R147 alignment may still move a feedback part that is not in its row"`, line 566): spy on `conventionRelations.conventionDraftEligible` returning `false` (restored in `finally`) with a brief comment explaining that this test isolates R147 alignment from R168.
   - `packages/auto-layout/test/local-loop-amplifier.test.ts` (the two `regulator()` tests at lines 567 and 605): spy on `conventionRelations.conventionDraftEligible` returning `false` (restored in `finally`), matching the existing `nodeAttachments`/`localLoopAmplifiers` isolation pattern.
   - `packages/auto-layout/test/partition.test.ts` (`"keeps no-partition quick output byte-identical to the approved base"`, line 208): verify the 4-resistor `sample()` layout under T181 is complete and clean, then update the approved base SHA-256 hash and its comment to reflect T181.

### Notes for round 2

- Do **not** modify any `packages/auto-layout/src/*` files or `docs/specs/auto-layout.md` (they are already verified and approved).
- Because no `src/` files change in Round 2, you do **not** need to rerun the two `scripts/auto-layout-eval.mjs` corpus evaluations — reuse `tmp/t181/{netlist,drawing}/report.json` and re-run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout`, and `pnpm test:slow`, then update `tasks/T181-convention-solver-v2/report.md` for round 2.
