# T003 report — round 1

## Summary

Implemented `apps/server`: a Hono Node server with PostgreSQL migrations,
persisted local identity, Cloud Projects, SVG previews, optimistic revisions,
three historical versions, favorites and restore. Added optional built-editor
hosting, Vite dev/preview API proxies, server scripts, contract documentation,
16 PostgreSQL-backed tests and a real browser workflow. The Worker and editor
application source are unchanged. No commits or branch changes were made.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | `app.ts`, `db.ts`, `migrate.ts`, ordered SQL migration and CLI. Startup migrations use a transaction and advisory lock. Optional static editor hosting includes MIME types, COOP, SPA fallback and traversal/symlink guards. Health queries PostgreSQL.                                                                     |
| 2    | done   | Fixed `local` identity, persisted display name, profile validation, disabled providers, no-op logout and same-origin guard.                                                                                                                                                                                                 |
| 3    | done   | Canonical Project serialization, configured limit, user-scoped queries, atomic revision checks/history, retry idempotency, favorites, cascade deletion, formula-aware previews and cache headers. Per-user create locks prevent limit races; per-project locks serialize changed saves.                                     |
| 4    | done   | 16 tests against isolated schemas in `auto_canvas_test`; real editor client create/open/list/update/conflict/delete; concurrency, ownership, history, restore, rendering failure and static hosting. Unreachable DB fails the suite with its configured URL.                                                                |
| 5    | done   | Vite dev/preview proxy for auth/projects/health preserves Host/Origin, registered after the narrower Agent relay. Root `server:dev` and `server:migrate`; recursive build includes server and copies SQL migrations. Knip includes the server workspace. Existing Vitest and TypeScript `apps/**` globs already include it. |
| 6    | done   | Browser test places a resistor, saves, reloads, opens from a fresh browser's shelf, saves a renamed revision and sees v1 in history. Playwright starts a server on 4311 against the test database. Both required browser checks pass.                                                                                       |
| 7    | done   | Added `docs/specs/server.md`, server configuration README, root development instructions and documentation links.                                                                                                                                                                                                           |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

```text
pnpm check → 1; exactly the 3 known simulation-artifact-files failures.
  Formatting: all matched files use Prettier code style.
  Docs: validated local Markdown links in 87 files.
  Agent docs: 6 outputs, 0 stale.
  Component generation checks, typecheck and lint passed (0 lint errors).
  Test Files 1 failed | 895 passed | 3 skipped (899)
  Tests      3 failed | 8780 passed | 135 skipped (8918)
  Duration   63.47s
  Failed file: apps/editor/src/features/simulation/simulation-artifact-files.test.ts
  - keeps diagnostic bytes exportable without classifying them as Explorer outputs
  - packages a group into category folders without changing artifacts
  - packages selected source and temporary artifacts into one hierarchy
  These fail with expected true / received false. No tests were weakened.
  The command stops at tests, so its trailing build was run separately below.

pnpm exec vitest run apps/server → 0
  Test Files 1 passed (1); Tests 16 passed (16); Duration 1.46s.

pnpm --filter @icm/server build → 0
  tsc -p tsconfig.json; SQL migrations copied to dist/migrations.

pnpm exec playwright test apps/editor/e2e/cloud-projects-server.spec.ts --workers=1 → 0
  1 passed (9.0s).

pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts --grep 'every web path' --workers=1 → 0
  1 passed (8.7s).

Additional verification:
pnpm build → 0; all workspace builds, including apps/server, passed.
git diff --check → 0.
Parsed lockfile comparison → only five authorized workspace links changed semantically.
pnpm deadcode → 1; 39 unused exports and 5 unused exported types in unchanged
  editor, Worker, package and script files; no server unused-code findings.
```

The full check also passes the existing Worker auth and Cloud Project tests.
Initial focused testing was blocked by sandbox loopback restrictions (`EPERM`);
reruns with local database access passed. Earlier check attempts caught a
lockfile-formatting issue and a promise-returning test cleanup callback; both
were fixed before the final run.

## Investigation results

`loadAccountState` deliberately returns `user: null` when all providers are
false, even though it also starts `/api/auth/me`. Cloud functionality does not
use that value: `createWebEditorServices` uses `fetchSessionUser` directly,
`useCloudProjects` loads identity through that service, and the shelf loads
`/api/projects` directly. The real editor-client test and browser workflow
both pass with providers disabled. No editor source change is needed for
Cloud Save, shelf opening or history in this task.

The editor still declares `CLOUD_PROJECT_LIMIT = 20`, passed into
`projectStore.limit` and displayed in shelf counts, replacement-dialog copy
and limit error messages. The server correctly defaults to 200 and lists all
Projects; a contract test creates and lists 21. The UI copy needs a subsequent
client task to reflect the configured server limit. No client limit source
was changed here.

## Deviations and open questions

- Added only the five permitted workspace dependencies (`derived`, `model`,
  `project-protocol`, `render-svg`, `symbols`). Offline linking used the
  existing populated pnpm cache, with zero downloads and no version changes.
  The initial sandbox-selected cache was empty; the first reinstall failed.
  Automatic review initially rejected access to the populated cache because
  it lacked the plan authorization; after verifying the plan's explicit
  offline-install permission, the retry was approved and completed.
- pnpm regenerated its lockfile in its native formatting; repository
  `format:check` rejected that formatting. Running Prettier reformatted the
  lockfile mechanically. A parsed comparison with HEAD confirms that the
  five workspace links are its only semantic changes.
- Followed the plan's explicit null/missing-name normalization to an empty
  name and empty-preview 404 behavior. Worker-only legacy preview backfill,
  Gallery binding/backup maintenance, account/session machinery and the
  Worker's fixed-20-limit equality assertion are not ported.
- Extra deadcode findings are outside the owned paths; they were reported
  without editing unrelated code.
- The operator's development-server restart/reopen acceptance remains for
  Opus as the plan specifies. Automated tests cover persisted profile/Project
  reads across app recreation, repeated migrations and a fresh browser open.
