# T014 report — Auto Layout in the editor

Written by the coordinator from the implementer's hand-back and an independent
rerun (a repository hook stops a subagent from writing report files).

## What was built

Circuit → Layout → **Auto Layout** (`layout.auto`, `layout.auto-cancel`) plans
the open Cell in a module Web Worker and applies the result as one
revision-fenced human transaction.

- `apps/editor/src/features/auto-layout/`: protocol, pure core
  (`runAutoLayout`), worker shell, session state machine, React hook, Details
  dialog, a refused-frame fixture for tests.
- `editor-transaction-commands.ts`: `transactAtRevision`, sharing the status
  and tool-cancelling tail of `transact` through a factored `commitDocument`.
- Command router, Circuit menu section, status-bar chip (elapsed seconds,
  "evaluation n/N", Cancel; afterwards "refused" / "N warnings" with Details).
- `knip.config.js`: the `packages/auto-layout` override is removed.
- Docs: `docs/specs/editor-interaction.md` gains "Automatic layout";
  `docs/specs/auto-layout.md` points at it.

Commits: `aff7651` (feature), `73b53e7` (budget computed in the worker, browser
spec).

## Step 1: the shipped examples

Every symbol resolves with `builtInSymbols`, no diagnostics, every plan applies.

| Example                                 | Parts | Quick ms | Default ms |
| --------------------------------------- | ----- | -------- | ---------- |
| common-source-amplifier                 | 10    | 456      | 1712       |
| two-stage-op-amp (visible change)       | 7     | 135      | 938        |
| current-mirror-loaded-differential-pair | 10    | 120      | 190        |
| fully-differential-two-stage-op-amp     | 20    | 924      | 1778       |
| five-transistor-ota-sky130              | 11    | 158      | 1436       |

The slowest plans in under 3 s, so the browser spec has no Cancel case; Cancel
is covered by the session tests and the manual check below.

## Acceptance (coordinator's rerun before the rebase onto `a46b4af`, a docs-only change)

| Command                                                   | Result                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm build`                                              | pass                                                   |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`        | pass                                                   |
| `pnpm docs:check`                                         | pass                                                   |
| `pnpm test:local`                                         | pass: 8523 passed, 117 skipped                         |
| `npx playwright test apps/editor/e2e/auto-layout.spec.ts` | pass: 2 passed (ports 4193 / 4331, local Chrome)       |
| `pnpm deadcode`                                           | exit 1, **as on `main`** (see below)                   |
| `node scripts/editor-bundle-budget.mjs --check`           | fails, **as on `main`** (implementer; not rerun by me) |
| `git diff --stat c116f55 -- packages/auto-layout`         | `src/index.ts` only                                    |

`pnpm deadcode`: the output is line-for-line the output of `main` c116f55,
except that the hint "`src/**/*.worker.ts!` … no matches" is gone because the
editor now has a worker. The failure is not caused by this task.

Bundle budget: the script reads a preload generator that T002 deleted
(`d088df1`), so it fails on `main` too. The implementer's own check: shell plus
the editor's App chunk is 797.7 KiB gzip (old ceiling 1047 KiB), no
planner-only string in a first-paint chunk, and the worker is a separate
`auto-layout.worker-*.js` asset.

Manual checks in the dev server (`?example=two-stage-op-amp`), by the
coordinator:

- The menu item is in a "Layout" section, enabled, with its tooltip.
- The chip shows "Auto Layout… 0 s", then "evaluation 1/24 … 24/24", with
  Cancel; the status ends at "Auto Layout applied (revision N)".
- One Undo restores the original drawing (the canvas markup at the same fit
  is identical); Undo is then disabled; Redo brings the layout back.
- Cancel while planning: "Auto Layout cancelled; the drawing is unchanged.",
  drawing identical, nothing new to undo.
- While planning the menu item is disabled: "Auto Layout is already running".
- A commit made while planning: "The drawing changed while Auto Layout was
  planning; nothing was applied."

## Knip

Four unused type re-exports were dropped from `packages/auto-layout/src/index.ts`.
`planAutoLayoutWithLlm`, `LlmPartitioner` and `ROUTED_SCORE_WEIGHTS` are used
only by tests and are tagged `@internal`; `llmPartition` is tagged `@public`
for `scripts/auto-layout-eval.mjs`.

## Deviations from the plan

1. **The worker computes the default search budget.** Importing
   `defaultLayoutSearch` on the main thread pulled planner module side effects
   into the App chunk (the plan's step-5 fallback). The chip learns the budget
   from the first progress message.
2. Planner values are imported in `auto-layout-core.ts`, which only the worker
   imports, rather than in the worker shell alone.
3. The session tests' fake worker forces quick mode.
4. `sameDocumentJson` is private to the controller; tests compare Document
   JSON without `revision`.
5. The Details dialog reuses the `editor-action-dialog` shell.
6. After an applied plan the status reads "Auto Layout applied …", overwriting
   the "tool cancelled" note the shared tail may have written.
7. `pnpm install` reformatted the lockfile; it was restored with Prettier, so
   the lockfile diff is the three-line workspace link.

## Not covered

- The `applied: false` branch ("Already laid out; nothing changed") has no
  test: the planner is not idempotent on any shipped example.
- There is no React-level test of `use-auto-layout.ts`; the session it wraps is
  tested with the real controller, and the browser spec exercises the hook.
- The planner is not idempotent: running Auto Layout twice changes the drawing
  again. Not a defect of this task, but a user will notice.
