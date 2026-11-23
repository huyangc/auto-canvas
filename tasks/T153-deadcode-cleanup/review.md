# T153 review

## Round 1 — accepted

Reviewed: the working tree on `task/T153-deadcode-cleanup` against `122b837`
(plan commit on `main` `387a3de`) on 2026-11-22; acceptance rerun by Opus.

Changed paths are all in the plan's owned paths (55 files, +135 / −1,755;
13 files deleted); `plan.md` and the four acceptance helpers are unchanged; no
dependency or lockfile change.

| #   | Severity | Where                                            | Finding                                                                                                                          | Expected fix                                    |
| --- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | note     | `docs/specs/netlist-conversion.md:9-11`          | One prose line was left over-long after the hand edit.                                                                           | Re-wrapped by the reviewer (wording unchanged). |
| 2   | note     | `packages/spice/src/conversion.test.ts`          | The two moved assertions (the `ngspice` alias; `UNSUPPORTED_PARAMETER` at line 2 with no partial text) are present and pass.     | none                                            |
| 3   | note     | `apps/editor/src/components/account.tsx`         | `signOut` stays and is still called by the menu's sign-out button; only its `export` went.                                       | none                                            |
| 4   | note     | `packages/agent-adapter/src/project-resource.ts` | The Gallery schemas stay inside `AgentProjectResourceResponseSchema`; the generated Agent API values hash the same as on `main`. | none                                            |

Acceptance rerun (lane 1 variables exported):

```text
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0 (oxlint: 2140 files, 0 errors, 3701 warnings)
pnpm build → 0
pnpm test:local → 0 (833 files passed, 3 skipped; 8624 tests passed, 117 skipped)
node tasks/T153-deadcode-cleanup/knip-expect.mjs → 0
  default: exit 1 with exactly the 23 expected findings, no hints
  production: exit 1 with exactly the 35 expected findings, no hints
pnpm agent-kit:catalog:check → 0
pnpm agent-docs:generated:check → 0
pnpm components:check → 0
pnpm --filter "@icm/agent-adapter..." build → 0
agent-api-hashes.mjs | diff - agent-api-hashes.expected → 0
git diff --exit-code -- fixtures/agent-api → 0
pnpm agent-api:artifacts:check → 1 with main's message, unchanged
13 deleted paths absent → 0; exactly 13 deletions against HEAD
pnpm test:slow → 0 (2 files, 8 tests passed)
```

`pnpm format:check` and `pnpm docs:check` were run again after finding 1's
re-wrap: both 0.
