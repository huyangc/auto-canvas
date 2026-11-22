# T168 — Make the browser suite collectable again (`project-file.spec.ts`)

- Branch: `task/T168-project-file-spec-collection`
- Base: `origin/main` at `387a3de`
- Status: approved (a one-line test fix found while planning T162b; done by the reviewer)

## Goal

`pnpm exec playwright test --list` collects the browser suite again, so
`pnpm test:e2e:local` runs. Today a single spec fails while it is loaded and
Playwright then collects nothing at all.

## Context

- `apps/editor/e2e/project-file.spec.ts:15` imports `CLOUD_PROJECT_LIMIT` from
  `apps/editor/src/features/editor-shell/cloud-projects.ts`. That module imports
  `../../request-failure` → `usage-policy-note` →
  `components/site-resource-links.ts:10`, which evaluates
  `appUrl("privacy")`; `appUrl`'s default parameter reads
  `import.meta.env.BASE_URL` (`apps/editor/src/lib/app-url.ts:2`). Under
  Playwright's Node transform `import.meta.env` is undefined, so loading the
  spec throws `TypeError: Cannot read properties of undefined (reading
'BASE_URL')`.
- Since commit `c549225` (T011), which changed `SITE_PRIVACY_PATH` from a
  literal to `appUrl("privacy")`. One collection error makes
  `playwright test --list` report "Total: 0 tests in 0 files".
- CI did not notice: `.github/workflows/ci.yml` has no Playwright step
  (`docs/workflow.md`, CI). Later tasks ran named spec files only.
- The constant is used once in the spec, at `:449`, in the visible text
  `Cloud Projects (up to 200)`. Its value is `200`
  (`cloud-projects.ts:16`).

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/e2e/project-file.spec.ts`
- `tasks/T168-project-file-spec-collection/`

Out of scope (do not change):

- every file under `apps/editor/src` (a product-side fix would change emitted
  code and is not needed)
- every other spec and helper

## Steps

1. In `apps/editor/e2e/project-file.spec.ts`, replace the import of
   `CLOUD_PROJECT_LIMIT` with a local literal `const CLOUD_PROJECT_LIMIT = 200;`
   and a comment saying why: the browser test pins the visible limit, and a
   spec must not import an editor module that reads `import.meta.env` when it
   is evaluated.

## Acceptance

Run from the repository root; all must pass. The run starts its own servers on
lane 2 and must not reach an external editor or reuse a listener that is
already there.

```bash
unset ICM_E2E_BASE_URL ICM_E2E_SERVER AUTO_CANVAS_E2E_BASE_PATH AUTO_CANVAS_AUTH VITE_AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH
export ICM_E2E_ISOLATED=1 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
lsof -nP -iTCP:4273 -iTCP:4321 -sTCP:LISTEN | wc -l                               # expected: 0 before any run
pnpm exec playwright test --list apps/editor/e2e/project-file.spec.ts | tail -1   # expected: "Total: 8 tests in 1 file", exit 0
pnpm exec playwright test --list | tail -1                                        # expected: a total above 400 tests, exit 0
pnpm exec playwright test apps/editor/e2e/project-file.spec.ts --workers=1        # expected: 8 passed
git diff --exit-code origin/main -- apps/editor/src                               # expected: no difference
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check               # expected: exit 0
pnpm test:e2e:local                                                               # expected: the whole suite runs; record the result
```

Behavioral checks:

- The case "Cloud Projects (up to 200)" still asserts the visible text.

## Notes for the implementer

- Test-Impact: `tests-updated`.
- If `pnpm test:e2e:local` shows failures in other specs, they were hidden by
  the collection error: record them in the report with the failing test names;
  do not fix them in this task.
