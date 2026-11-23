# T154 review

## Round 1 — accepted

Reviewed: the working tree on `task/T154-deadcode-simulation` against `02e4ab5`
(the plan commit on `main` `a97ce3d`) on 2026-11-23; acceptance rerun by Opus.

Changed paths are all in the plan's owned paths (85 files, +528 / −5,628;
27 deleted, 3 new); the plan, ledger and their checkers are unchanged by the
implementer; no dependency or lockfile change.

| #   | Severity | Where                                                     | Finding                                                                                                                              | Expected fix                                                                                          |
| --- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | note     | `tasks/T154-deadcode-simulation/test-ledger.md`           | The `equivalence.test.ts` row said 3 rewritten while its per-case list has 2 (the row sum disagreed with the header's 35).           | Corrected by the reviewer to 2.                                                                       |
| 2   | note     | `tasks/T154-deadcode-simulation/plan.md`                  | The Context and Acceptance figures came from an earlier trial revision (8,681 passing; +536 / −5,665; new files +198).               | Corrected by the reviewer to the measured final tree (8,682; +528 / −5,628; +207; 119 fewer passing). |
| 3   | note     | `packages/netlist/src/simulation-external-vacask.test.ts` | The plan-mandated message assertion (the converted-text guard, which the pending draft would otherwise mask) is present and passes.  | none                                                                                                  |
| 4   | note     | `packages/model/src/simulation-folder.test-support.ts`    | The builder's body matches the deleted product function; knip's `testSupport` glob covers it; no product or e2e importer.            | none                                                                                                  |
| 5   | note     | `.github/workflows/ci.yml`                                | `pnpm deadcode` sits directly after `pnpm lint`, before `pnpm build`; knip maps built-package paths to source, so it needs no build. | none                                                                                                  |

Acceptance rerun (lane 1 variables exported):

```text
pnpm format:check → 0; pnpm docs:check → 0; pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm build → 0
pnpm test:local → 0 (834 files passed, 3 skipped; 8682 tests passed, 116 skipped)
pnpm deadcode → 0
knip --no-progress → 0, stdout 0 bytes, stderr 0 bytes
knip --production --no-progress → 0, stdout 0 bytes, stderr 0 bytes
pnpm agent-kit:catalog:check / agent-docs:generated:check / components:check → 0
three migration suites → 0 (9 tests passed)
schema-check.mjs → 0
agent-api hashes | diff → 0; fixtures diff → 0
agent-api:artifacts:check → exit 1 with main's message, unchanged
27 deletions, none still present; createSimulationFolder absent from the built @icm/model; 0 product importers of the fixture
CI step after `pnpm lint` → 0
pnpm test:slow → 0 (2 files, 8 tests passed)
```
