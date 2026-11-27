# T189 — User analytics dashboard UI, account admin controls, and editor instrumentation

- Branch: `user_analytics_system`
- Base: `user_analytics_system` at `b7663d5a`
- Status: approved
- Plan review: self-checked against the code

## Goal

Build the administrator user analytics dashboard at `<basePath>/analytics`
for both standalone `accounts` mode and `notebook` mode (where silicon-notebook
administrators inherit admin access), integrate `T178` account administration
actions in `accounts` mode (disable/enable, grant/revoke admin, reset password,
delete account), wire the 5 new editor usage events (`layout.auto`,
`export.svg`, `export.raster`, `export.netlist`, `export.project`), and proxy
`/api/admin` in Vite dev/preview.

The dashboard must be lazy-loaded so it has zero impact on the editor's
first-paint bundle budget and must use zero browser storage APIs so the
notebook per-user storage guard passes unchanged.

## Context

- Stage 1 (`T188`, commit `b7663d5a`) implemented PostgreSQL persistence and
  the six read-only endpoints under `/api/admin/analytics/*` in both `accounts`
  and `notebook` modes:
  - `GET /api/admin/analytics/overview?days=30`
  - `GET /api/admin/analytics/trends?days=30`
  - `GET /api/admin/analytics/features?days=30`
  - `GET /api/admin/analytics/retention?weeks=8`
  - `GET /api/admin/analytics/users?q=&filter=&sort=&order=&days=30&offset=0&limit=50`
  - `GET /api/admin/analytics/users/:id?days=30`
  See `apps/server/src/user-analytics.ts` and `docs/specs/server.md`.
- Account administration write endpoints (`accounts` mode only, already
  implemented in `apps/server/src/account-administration.ts`):
  - `PATCH /api/admin/users/:id` `{ role?: "user" | "admin", disabled?: boolean }`
  - `POST /api/admin/users/:id/reset-password` → `{ temporaryPassword }`
  - `DELETE /api/admin/users/:id` `{ username }` → `{ deleted }`
  All reject self-mutations with 409 `own-account`.
- `apps/editor/dev/api-server-proxy.ts` currently forwards `/api/session`,
  `/api/usage`, `/api/auth`, `/api/projects`, `/api/components`, `/api/health`,
  but **omits `/api/admin`**. Add `"/api/admin"` there.
- `apps/editor/src/accounts/session.ts` reads `GET /api/session`; the server
  already returns `user: { id, displayName, email, provider, role, isAdmin,
  mustChangePassword }` (`apps/server/src/standalone-accounts.ts`). Update the
  `Account` type in `session.ts` to expose `role`, `isAdmin`, and
  `mustChangePassword`.
- `apps/editor/src/accounts/account-context.tsx` currently passes
  `{ username, prepareLogout, logout }`. Add optional `id?: string` and
  `isAdmin?: boolean` (optional so existing tests that construct minimal
  context values remain valid).
- `apps/editor/src/accounts/account-gate.tsx` installs the `X-Canvas-Account`
  scoped `window.fetch` once signed in and renders `editor()`. When
  `isAnalyticsPath(window.location.pathname)` matches, render the lazy-loaded
  analytics route (or an admin-only notice for non-admins) without mounting
  the schematic editor.
- `apps/editor/src/notebook/gate.ts` and `apps/editor/src/entries/notebook.tsx`
  authenticate via `GET api/auth/me` (returning `NotebookUser` with
  `isAdmin: boolean`), install per-user storage and Bearer-token scoped
  `fetch`. `scripts/notebook-editor-build.test.mjs` strictly asserts:
  1. Exact `STORAGE_CONSUMERS` list (do **not** use `localStorage`,
     `sessionStorage`, `indexedDB`, `BroadcastChannel`, `navigator.locks`,
     `caches`, or `document.cookie` anywhere inside `features/analytics/`).
  2. Every static/dynamic `import()` uses a literal specifier and stays under
     `/canvas/`.
  3. Standard build contains no `/apps/editor/src/notebook/` modules.
- `scripts/editor-bundle-budget.mjs --check` checks first-paint byte budgets
  for `/editor` and `/gallery`. Keep `features/analytics/` strictly behind a
  dynamic `import()` boundary and use lightweight pure SVG charts (no new npm
  dependencies).
- `apps/editor/src/styles.css` defines `--icm-*` design tokens.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/dev/api-server-proxy.ts`
- `apps/editor/src/features/analytics/**` (new)
- `apps/editor/src/accounts/session.ts`
- `apps/editor/src/accounts/account-context.tsx`
- `apps/editor/src/accounts/account-gate.tsx`
- `apps/editor/src/accounts/header-account-menu.tsx`
- `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/notebook/gate.ts`
- `apps/editor/src/entries/notebook.tsx`
- `apps/editor/src/notebook/entry.integration.test.tsx`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/features/editor-shell/editor-file-commands.ts`
- `apps/editor/src/features/editor-shell/editor-file-commands.test.ts`
- `apps/editor/src/document/use-project-file-lifecycle.ts`
- `apps/editor/src/features/auto-layout/use-auto-layout.ts`
- `apps/editor/src/features/auto-layout/use-auto-layout.test.tsx`

Out of scope (do not change):

- Everything under `apps/server/` and `packages/`
- `package.json`, `pnpm-lock.yaml`, `scripts/notebook-editor-build.test.mjs`,
  `fixtures/editor-bundle-budget/report.json`

## Steps

1. **Proxy `/api/admin` in Vite dev/preview**:
   - Add `"/api/admin"` to the proxied path list in
     `apps/editor/dev/api-server-proxy.ts`.

2. **Wire the 5 new editor usage events** (`packages/project-protocol` already
   allows them):
   - In `apps/editor/src/features/editor-shell/editor-file-commands.ts`:
     - `exportSvg`: call `recordUsage?.("export.svg", "ok")` after successful
       delivery (when not cancelled), and `"failed"` in the catch branch.
     - `exportRaster`: call `recordUsage?.("export.raster", "ok")` after
       successful delivery (when not cancelled), and `"failed"` in the catch
       branch.
     - `exportDesignNetlist`: call `recordUsage?.("export.netlist", "ok")` when
       file delivery (non-cancelled) or clipboard copy succeeds, and `"failed"`
       when blocked or catching an error (including `copyRnlNetlist`).
   - In `apps/editor/src/document/use-project-file-lifecycle.ts`:
     - Accept optional `recordUsage?: RecordEditorUsage | undefined` in the
       hook options and pass it from `apps/editor/src/app/App.tsx`.
     - In `exportProjectFile`, call `recordUsage?.("export.project", "ok")`
       when saved/download-requested, and `"failed"` on failure (not on cancel).
   - In `apps/editor/src/features/auto-layout/use-auto-layout.ts`:
     - Accept optional `recordUsage?: RecordEditorUsage | undefined` in
       `AutoLayoutEditorBinding` and pass it from `apps/editor/src/app/App.tsx`.
     - Report `recordUsage?.("layout.auto", "ok")` when an auto-layout run
       completes with an applied plan, and `"failed"` when a run fails (do not
       report when cancelled or abandoned).
   - Add unit assertions for these new `recordUsage` calls in
     `editor-file-commands.test.ts` and `use-auto-layout.test.tsx`.

3. **Create the lazy-loaded analytics module** under
   `apps/editor/src/features/analytics/` (zero browser storage usage, zero
   third-party chart libraries):
   - `analytics-route.ts`: pure helper `isAnalyticsPath(pathname, base = import.meta.env.BASE_URL)` returning true for `<base>analytics` or `<base>analytics/`.
   - `analytics-client.ts`: typed fetch functions for:
     - `fetchAnalyticsOverview(days, fetchLike)`
     - `fetchAnalyticsTrends(days, fetchLike)`
     - `fetchAnalyticsFeatures(days, fetchLike)`
     - `fetchAnalyticsRetention(weeks, fetchLike)`
     - `fetchAnalyticsUsers(params, fetchLike)`
     - `fetchAnalyticsUserDetail(userId, days, fetchLike)`
     - Accounts-mode admin mutations:
       - `updateAdminUser(userId, patch, fetchLike)` (`PATCH /api/admin/users/:id`)
       - `resetAdminUserPassword(userId, fetchLike)` (`POST /api/admin/users/:id/reset-password`)
       - `deleteAdminUser(userId, username, fetchLike)` (`DELETE /api/admin/users/:id`)
     All paths use `apiUrl(...)` so `AUTO_CANVAS_BASE_PATH` and notebook
     `/canvas/api/...` work seamlessly.
   - `analytics-charts.tsx`: lightweight accessible pure-SVG charts:
     - `GrowthActivityChart`: daily new users (bars) + DAU (line) with UTC
       date labels and hover/focus details.
     - `OperationsTrendChart`: daily total actions broken down by project
       saves, netlist/layout ops, exports, and other actions.
     - `ConversionFunnel`: horizontal bars showing `Total Users → Opened Editor → Saved Project → Active (7d)` with counts and conversion percentages.
     - `UserDailyChart`: per-user daily ok/failed bar chart for the user detail
       panel.
   - `analytics-dashboard.css`: clean responsive layout built strictly on
     existing `--icm-*` CSS variables from `styles.css`.
   - `analytics-dashboard.tsx`:
     - Props: `{ mode: "accounts" | "notebook"; currentUserId: string; username: string; isAdmin: boolean; editorHref?: string; onSignOut?: () => void }`.
     - If `!isAdmin`: render a clear access-denied view (`Administrator access required`) with a link back to `editorHref ?? appUrl("")`.
     - Header bar: page title (`User Analytics`), mode badge (`Accounts` or
       `Notebook`), `UTC daily cutoff` indicator, time range selector (`7d`,
       `30d`, `90d`), `Refresh` button, `Back to Editor` link, and optional
       `Sign out` button (`accounts` mode).
     - Three tabs (managed in React state, zero browser storage):
       1. **Overview**:
          - 6 KPI cards:
            - Total users (`active` / `disabled` / `admins` breakdown in
              `accounts`; total & `admins` in `notebook`)
            - New users (today, 7d, 30d, and window vs previous window delta)
            - Active users (DAU / WAU / MAU and DAU/MAU stickiness %)
            - Live / recent activity (`activeSessions` + `activeLastHour` in
              `accounts`; `activeLastHour` in `notebook` with note that
              sessions are managed by silicon-notebook)
            - Retention (D1 and D7 rate + eligible/retained counts)
            - Cloud assets (total projects, avg projects/user, published
              components, actions & saves in window)
          - `GrowthActivityChart` and `OperationsTrendChart`
          - `ConversionFunnel`
          - Weekly retention cohort table (D1, D3, D7, D14, D30; displays
            `—` when not yet eligible and notes `excludedUnknownFirstSeen` when
            greater than 0)
       2. **Features**:
          - Auto vs Draw mode preference summary card (unique users and counts)
          - Feature adoption table (action, category badge, ok count, failed
            count, total, unique users, success rate bar)
       3. **Users**:
          - Search input (`q`), filter dropdown (`all`, `active7d`, `dormant30d`,
            `admin`, plus `disabled` in `accounts` mode only), sort dropdown
            (`lastActive`, `firstSeen`, `projects`, `actions`, `name`), sort
            order toggle (`asc`/`desc`), total matching count, and pagination
            controls (`Previous` / `Next`).
          - User table displaying username/display name, role badge, status
            badge (`accounts` mode: Active / Disabled / Password reset required),
            first seen & last active timestamps (formatted cleanly in local
            time with `—` for null), project count, component count, active
            days, and actions in window.
          - Clicking a user opens a **User Detail** panel showing their summary,
            `UserDailyChart`, and per-action breakdown (strictly metadata &
            counts, never private project content).
          - **Account management controls (`mode === "accounts"` only)**:
            - On every user row other than `currentUserId` (mark the admin's
              own row `Current account` with management buttons disabled):
              - Grant/Revoke admin (`PATCH role`)
              - Disable/Enable (`PATCH disabled`)
              - Reset password (`POST reset-password`, with inline
                confirmation and a dismissible banner showing the one-time
                16-character temporary password plus a Copy button)
              - Delete account (`DELETE`, requiring the admin to type the exact
                username to confirm before submitting)
            - After any mutation succeeds, reload the users list and overview
              metrics and surface clear inline status or error messages.
          - In `mode === "notebook"`, render no account mutation controls and
            show a brief note that accounts and admin roles are inherited from
            and managed by silicon-notebook.

4. **Wire `accounts` mode entry and header menu**:
   - Update `apps/editor/src/accounts/session.ts` so `Account` includes
     optional `role?: "user" | "admin"`, `isAdmin?: boolean`, and
     `mustChangePassword?: boolean`.
   - Update `apps/editor/src/accounts/account-context.tsx` to include optional
     `id?: string` and `isAdmin?: boolean`.
   - Update `apps/editor/src/accounts/account-gate.tsx`:
     - Pass `id` and `isAdmin: identity.user.isAdmin === true` into
       `AccountContext.Provider`.
     - When `isAnalyticsPath(window.location.pathname)` is true after sign-in:
       - If `identity.user.mustChangePassword`: render a notice explaining that
         a password change is required before accessing analytics, with a Sign
         out button.
       - Otherwise, lazy-load `../features/analytics/analytics-dashboard` via
         `React.lazy` and render `<AnalyticsDashboard mode="accounts" ... />`
         directly (without calling `editor()`).
   - Update `apps/editor/src/accounts/header-account-menu.tsx`:
     - When `account.isAdmin === true`, render an **Analytics** menu item
       (`<a href={appUrl("analytics")} target="_blank" rel="noopener" data-testid="open-analytics">User Analytics</a>`)
       inside the account popover (between My Cloud Projects and Auto-save to
       Cloud) that closes the popover on click.
     - Keep non-admin markup unchanged.
   - Add unit tests in `apps/editor/src/accounts/header-account-menu.test.tsx`.

5. **Wire `notebook` mode entry and admin chrome link**:
   - Update `apps/editor/src/notebook/gate.ts`:
     - Pass `identity.user` as an optional 3rd argument to `mountApp(modules,
       read.token, identity.user)` and optional argument to `loadApp(identity.user)`.
       Preserve backwards compatibility for callers/tests passing 0 or 2 args.
   - Update `apps/editor/src/entries/notebook.tsx`:
     - Keep the exact startup gate, token check, storage namespace binding, and
       Bearer-token `scopedFetch` installation.
     - If `isAnalyticsPath(page.location.pathname, baseUrl)`:
       - In `loadApp`, dynamically import only
         `../features/analytics/analytics-dashboard` (not `App`), using a
         static string specifier so `notebook-editor-build.test.mjs` verifies
         locality.
       - In `mountApp`, render `<AnalyticsDashboard mode="notebook"
         currentUserId={user.id} username={user.displayName}
         isAdmin={user.isAdmin === true} editorHref={baseUrl} />` inside
         `EditorErrorBoundary`.
     - Otherwise (normal canvas editor route):
       - Pass `analyticsHref={user.isAdmin ? `${baseUrl}analytics` : undefined}`
         to `<App ... />`.
   - Update `apps/editor/src/app/App.tsx`, `editor-menus.tsx`, and
     `editor-app-chrome.tsx`:
     - Add optional `analyticsHref?: string` on `AppProps`, passed through to
       `EditorAppChrome`.
     - When `analyticsHref` is provided (only notebook-mode admins), render a
       compact top-bar link button (`data-testid="open-analytics"`, `target="_blank"`,
       `rel="noopener"`) next to the right-side actions. Non-admins and
       accounts/local modes see no change in `EditorAppChrome`.
   - Add integration tests in `apps/editor/src/notebook/entry.integration.test.tsx`
     verifying that on `/canvas/analytics`, a notebook admin mounts the
     analytics view (not the editor) and a non-admin sees the access-denied
     notice, while normal `/canvas/` still mounts the editor.

6. **Add thorough UI & client tests** in
   `apps/editor/src/features/analytics/analytics-dashboard.test.tsx`:
   - Test `accounts` mode: KPI rendering, time range switching (re-fetches with
     new `days`), Trends/Features/Users tabs, user search/filter/sort/paging,
     user detail drawer, and all 4 account admin actions (grant/revoke admin,
     disable/enable, reset password showing temporary password, delete with
     username confirmation), plus own-account controls disabled.
   - Test `notebook` mode: notebook admin inherits access, displays notebook
     mode badge and hourly activity KPI without active sessions, hides account
     mutation buttons, and displays silicon-notebook management note.
   - Test non-admin (`isAdmin: false`) renders access-denied view and makes zero
     analytics API requests.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm exec vitest run apps/editor/src/features/analytics apps/editor/src/accounts apps/editor/src/notebook apps/editor/src/features/editor-shell/editor-file-commands.test.ts apps/editor/src/features/auto-layout/use-auto-layout.test.tsx scripts/notebook-editor-build.test.mjs   # all pass
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check                                                                                                                                                                                                            # exit 0
pnpm deadcode                                                                                                                                                                                                                                                                  # no new finding
pnpm build && pnpm build:notebook-editor && node scripts/editor-bundle-budget.mjs --check                                                                                                                                                                                      # exit 0
```

Behavioral checks:

- `scripts/notebook-editor-build.test.mjs` passes without modifying
  `STORAGE_CONSUMERS` or relaxing locality checks.
- `node scripts/editor-bundle-budget.mjs --check` passes without raising
  `fixtures/editor-bundle-budget/report.json` ceilings.
- Existing `apps/editor/src/accounts/*`, `apps/editor/src/notebook/*`, and
  `apps/server/*` tests continue to pass unchanged.

## Notes for the implementer

- Do **not** use `localStorage`, `sessionStorage`, `indexedDB`,
  `BroadcastChannel`, `navigator.locks`, `caches`, or `document.cookie` inside
  `apps/editor/src/features/analytics/`.
- Do **not** add any npm dependencies or modify `package.json` / `pnpm-lock.yaml`.
- Use static string specifiers in all dynamic `import(...)` calls (e.g.
  `import("../features/analytics/analytics-dashboard")`).
- Match existing editor CSS tokens (`--icm-*`) so light/dark and chrome styles
  look cohesive.
- Remember to respect `import.meta.env.BASE_URL` via `appUrl` / `apiUrl` for
  all routes and API calls.
