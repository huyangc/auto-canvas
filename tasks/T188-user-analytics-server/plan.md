# T188 — User analytics persistence and admin APIs (accounts & notebook modes)

- Branch: `user_analytics_system`
- Base: `main` at `2b1ebdea`
- Status: approved
- Plan review: self-checked against the code

## Goal

Persist user activity metrics in PostgreSQL and expose administrator-only
read-only analytics endpoints under `/api/admin/analytics/*` for both
standalone `accounts` mode and `notebook` mode (silicon-notebook companion
deployment, where notebook admins inherit administrator access). All daily
aggregations and retention windows use **UTC calendar days** to match
silicon-notebook's time conventions. Administrators never see private drawing
contents, project names, or netlist text.

This is stage 1 of 2 (server persistence, expanded action allowlist, and
analytics APIs). Stage 2 (`T189`) builds the lazy-loaded `/analytics`
dashboard UI and integrates account administration buttons.

## Context

- `apps/server/src/migrations/001-single-user.sql` defines `users(id, display_name)`,
  `cloud_projects`, and `cloud_project_versions`.
- `apps/server/src/migrations/004-standalone-accounts.sql` and
  `006-account-administration.sql` define `standalone_accounts(username, user_id,
  salt, password_hash, role, disabled, must_change_password, credentials_version,
  created_at)` and `standalone_sessions`.
- `apps/server/src/standalone-mode.test.ts` (lines 205–231) pins exact SHA-256
  digests for every file in `apps/server/src/migrations/` and (lines 163–202)
  asserts the exact SQL queries issued in `local` mode for `GET /api/auth/me`
  and `GET /api/projects`. Never modify `001`–`006`; add `007-user-analytics.sql`
  and add its SHA-256 digest to `standalone-mode.test.ts`. Do not issue extra
  database queries in `local` mode.
- `apps/server/src/usage-log.ts` currently writes JSONL `{"type":"usage",...}`
  lines to `log` for 6 project routes and `POST /api/usage/:action/:result`
  (allowed actions in `packages/project-protocol/src/editor-usage.ts`). It does
  not persist to PostgreSQL yet.
- `apps/server/src/standalone-accounts.ts` (lines 72–79) already marks
  `/api/admin` and `/api/admin/*` in `needsBinding` (requiring
  `X-Canvas-Account`) and calls `registerAccountAdministration` at line 432.
  Registration (`POST /api/auth/register`) and login (`POST /api/auth/login`)
  run before the `/api/*` auth middleware.
- `apps/server/src/account-administration.test.ts` asserts that
  `/api/admin/users*` routes return 404 in `local` and `notebook` modes. Keep
  `/api/admin/users*` accounts-mode only; mount `/api/admin/analytics/*` in
  both `accounts` and `notebook` modes (404 in `local` mode).
- `apps/server/src/app.ts` (`registerNotebook`, lines 203–211) upserts
  `users(id, display_name)` from `notebook-identity.ts` (`profile.isAdmin`
  reflects silicon-notebook `role === "admin"`). Updating this upsert to also
  store `last_role` enables role reporting in notebook user listings.
- `apps/server/src/notebook-auth.test.ts` (lines 610–674) verifies JSONL usage
  logs under `/canvas/api/usage/:action/:result` and `/canvas/api/projects`.
  Preserve the existing JSONL format and fields.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/project-protocol/src/editor-usage.ts`
- `apps/server/src/migrations/007-user-analytics.sql` (new)
- `apps/server/src/usage-log.ts`
- `apps/server/src/user-analytics.ts` (new)
- `apps/server/src/user-analytics.test.ts` (new)
- `apps/server/src/app.ts`
- `apps/server/src/standalone-accounts.ts`
- `apps/server/src/standalone-mode.test.ts`
- `apps/server/src/server-main.test.ts`
- `docs/specs/server.md`

Out of scope (do not change):

- Everything under `apps/editor` (covered in stage 2)
- Existing migration files `001`–`006`
- Account administration write endpoints in `apps/server/src/account-administration.ts`
- `local` mode query behavior and `notebook-identity.ts` token validation rules

## Steps

1. **Expand `editorUsageActions`** in `packages/project-protocol/src/editor-usage.ts`.
   Keep all 5 existing actions (`editor.open`, `mode.draw`, `mode.auto`,
   `netlist.import`, `netlist.edit`) and append:
   - `"layout.auto"`
   - `"export.svg"`
   - `"export.raster"`
   - `"export.netlist"`
   - `"export.project"`

2. **Add migration `apps/server/src/migrations/007-user-analytics.sql`**:
   - Alter `users`:
     - `ADD COLUMN first_seen_at timestamptz`
     - `ADD COLUMN last_active_at timestamptz`
     - `ADD COLUMN last_role text CHECK (last_role IN ('user', 'admin'))`
     - Then `ALTER TABLE users ALTER COLUMN first_seen_at SET DEFAULT now();`
       (so pre-existing rows without a known registration time keep `NULL`,
       while newly inserted rows automatically record their first-seen instant).
     - Backfill existing standalone accounts:
       `UPDATE users u SET first_seen_at = a.created_at, last_role = a.role FROM standalone_accounts a WHERE u.id = a.user_id;`
   - Create daily per-user action counter table:
     ```sql
     CREATE TABLE usage_daily_user_actions (
       day date NOT NULL,
       mode text NOT NULL CHECK (mode IN ('accounts', 'notebook', 'local')),
       user_id text NOT NULL,
       action text NOT NULL,
       ok_count integer NOT NULL DEFAULT 0,
       failed_count integer NOT NULL DEFAULT 0,
       PRIMARY KEY (day, mode, user_id, action)
     );
     CREATE INDEX usage_daily_user_actions_mode_user_day
       ON usage_daily_user_actions (mode, user_id, day DESC);
     ```
     Do **not** add an `ON DELETE CASCADE` foreign key on `user_id`, so deleting
     an account never rewrites historical DAU or feature totals.
   - Add the SHA-256 digest of `007-user-analytics.sql` to
     `apps/server/src/standalone-mode.test.ts`.

3. **Persist usage events in `apps/server/src/usage-log.ts`** and wire in
   `apps/server/src/app.ts` and `apps/server/src/standalone-accounts.ts`:
   - Pass `db: Pool` and optional `now?: () => number` into `registerUsageLog`.
   - Keep the exact JSONL output format written via `log(...)` for all modes.
   - When `mode === "accounts" || mode === "notebook"`, await a best-effort
     PostgreSQL upsert wrapped in `try / catch` (log errors via `console.error`,
     never fail or delay-reject the HTTP response):
     - Compute `timestamp = new Date(now ? now() : Date.now())` and UTC calendar
       day `day = timestamp.toISOString().slice(0, 10)`.
     - Upsert `(day, mode, user_id, action, ok_count, failed_count)` in
       `usage_daily_user_actions` incrementing `ok_count` or `failed_count`.
     - Update `users SET last_active_at = GREATEST(COALESCE(last_active_at, '-infinity'::timestamptz), $2::timestamptz) WHERE id = $1`.
   - Observe two additional server routes in `usage-log.ts`:
     - `PUT /api/components/:id` → `"component.publish"` (when `sessionUser?.id` exists)
     - `POST /api/agent/sessions` → `"agent.pair"` (when `sessionUser?.id` exists)
   - Return a helper `{ registerUsageEndpoint, recordServerUsage }` from
     `registerUsageLog` so `standalone-accounts.ts` can call
     `await recordServerUsage(userId, action === "register" ? "auth.register" : "auth.login", "ok", status)`
     immediately after a successful registration (201) or login (200).
   - Keep `local` mode writing JSONL only (no DB writes, preserving
     `standalone-mode.test.ts` exact query assertions).
   - In `apps/server/src/app.ts` (`registerNotebook` `onProfile`), update the
     upsert to set `last_role = $3` (`profile.isAdmin ? "admin" : "user"`),
     and in `standalone-accounts.ts` registration insert, set `last_role = 'user'`.

4. **Implement `apps/server/src/user-analytics.ts`** and mount it in both
   `registerAccounts` (`apps/server/src/standalone-accounts.ts`) and
   `registerNotebook` (`apps/server/src/app.ts`):
   - Guard `/api/admin/analytics` and `/api/admin/analytics/*`: require
     `c.get("sessionUser")?.isAdmin === true`, else 403 `{ error: "forbidden" }`.
     Always set `Cache-Control: private, no-store`.
   - Accept optional `now?: () => number` so tests can control the current UTC
     instant deterministically.
   - Define mode-scoped user base SQL cleanly:
     - `accounts`: `standalone_accounts a JOIN users u ON u.id = a.user_id`
       (`first_seen_at` = `a.created_at`, `role` = `a.role`, `disabled` = `a.disabled`,
       `must_change_password` = `a.must_change_password`, `username` = `a.username`,
       `display_name` = `u.display_name`).
     - `notebook`: `users u LEFT JOIN standalone_accounts a ON a.user_id = u.id
       WHERE u.id <> 'local' AND a.user_id IS NULL`
       (`first_seen_at` = `u.first_seen_at`, `role` = `COALESCE(u.last_role, 'user')`,
       `disabled` = `false`, `must_change_password` = `false`,
       `username` = `NULL`, `display_name` = `u.display_name`).
   - Implement six read-only endpoints (reject invalid query params or NUL bytes
     with 400 `{ error: "invalid-fields" }`):
     1. `GET /api/admin/analytics/overview?days=30` (`days` integer `1..365`, default `30`):
        - `mode`, `timezone: "UTC"`, `days`, `asOf`, `today` (`YYYY-MM-DD` UTC)
        - `users`: `{ total, activeAccounts, disabledAccounts, admins, withKnownFirstSeen, newToday, new7d, new30d, newInWindow, prevNewInWindow }`
        - `engagement`:
          - `dau` (distinct `user_id` in `usage_daily_user_actions` for `mode` on `today`)
          - `wau` (last 7 UTC days including `today`)
          - `mau` (last 30 UTC days including `today`)
          - `stickiness` (`mau > 0 ? Number((dau / mau).toFixed(4)) : null`)
          - `activeSessions` (`accounts`: distinct `user_id` in `standalone_sessions` where `expires_at > now`; `notebook`: `null`)
          - `activeLastHour` (distinct mode-scoped users with `last_active_at >= now - 1 hour`)
        - `retention`: `{ d1Rate, d1Eligible, d1Retained, d7Rate, d7Eligible, d7Retained }`
          computed over users whose `first_seen_at` (UTC date `d0`) is at least
          1 day (or 7 days) before `today` and within the last 90 days, counting
          users who have a row in `usage_daily_user_actions` on `d0 + 1` (or `d0 + 7`).
        - `assets`: `{ totalProjects, avgProjectsPerUser, totalComponents, actionsInWindow, savesInWindow }`
          scoped to the current mode's users (`cloud_projects` joined to mode users;
          `components` with `status <> 'deleted'` joined to mode users; actions in
          `[today - (days - 1), today]`).
        - `funnel`: `{ totalUsers, openedEditor, savedProject, activeLast7d }`
          where `openedEditor` = distinct mode users with any `editor.open` ok
          record, `savedProject` = distinct mode users with `>= 1` row in
          `cloud_projects` or any `project.create`/`project.save` ok record,
          `activeLast7d` = distinct mode users active in the last 7 UTC days.
     2. `GET /api/admin/analytics/trends?days=30` (`days` `1..365`, default `30`):
        - Returns `{ mode, timezone: "UTC", days, series }` with one entry per
          UTC day from `today - (days - 1)` through `today` (zero-filled):
          `{ day, newUsers, dau, totalActions, projectSaves, netlistOps, exports }`,
          where `projectSaves` = `project.create + project.save`,
          `netlistOps` = `netlist.import + netlist.edit + layout.auto`,
          `exports` = `export.svg + export.raster + export.netlist + export.project`.
     3. `GET /api/admin/analytics/features?days=30` (`days` `1..365`, default `30`):
        - Returns `{ mode, timezone: "UTC", days, features, modePreference }`.
        - Each feature row: `{ action, category, okCount, failedCount, totalCount, uniqueUsers }`,
          sorted by `totalCount DESC, action ASC`, with stable category mapping
          (`"editor"`, `"project"`, `"netlist"`, `"export"`, `"component"`, `"auth"`, `"agent"`).
        - `modePreference`: `{ autoUsers, drawUsers, autoCount, drawCount }` from
          `mode.auto` and `mode.draw` in the window.
     4. `GET /api/admin/analytics/retention?weeks=8` (`weeks` `1..26`, default `8`):
        - Groups mode users with non-null `first_seen_at` by ISO UTC week start
          (Monday `YYYY-MM-DD`) over the last `weeks` weeks (most recent `weeks`
          Monday-aligned UTC weeks including current week).
        - Also reports `excludedUnknownFirstSeen` (count of mode users with
          `first_seen_at IS NULL`).
        - For each cohort `{ weekStart, size, d1, d3, d7, d14, d30 }`, each offset
          `N` is `{ eligible, retained, rate }` where `eligible` counts cohort
          users whose UTC `d0 + N <= today`, `retained` counts those with any
          activity on UTC date `d0 + N`, and `rate = eligible > 0 ? Number((retained / eligible).toFixed(4)) : null`.
     5. `GET /api/admin/analytics/users?q=&filter=&sort=&order=&days=30&offset=0&limit=50`:
        - Validate `q` (`<= 100` chars, no NUL), `filter` (`all | active7d | dormant30d | admin | disabled`, default `all`),
          `sort` (`firstSeen | lastActive | projects | actions | name`, default `lastActive`),
          `order` (`asc | desc`, default `desc`), `days` (`1..365`, default `30`),
          `offset` (`0..100000`, default `0`), `limit` (`1..200`, default `50`).
        - Return `{ mode, timezone: "UTC", days, total, offset, limit, users }` where
          each user has `{ id, username, displayName, role, disabled, mustChangePassword, firstSeenAt, lastActiveAt, projectCount, componentCount, activeDaysInWindow, actionsInWindow }`.
        - Never return password hashes, salts, session tokens, project names, or
          drawing content.
     6. `GET /api/admin/analytics/users/:id?days=30`:
        - Validate `:id` (no NUL) and `days` (`1..365`, default `30`).
        - Return 404 `{ error: "not-found" }` if the user does not belong to the
          current mode.
        - Return `{ mode, timezone: "UTC", days, user, daily, actions }`, where
          `user` has the same summary shape as the list item, `daily` is the
          zero-filled `days`-length array `[{ day, okCount, failedCount }]`, and
          `actions` is `[{ action, category, okCount, failedCount, totalCount }]`.

5. **Comprehensive real-PostgreSQL tests** in `apps/server/src/user-analytics.test.ts`:
   - Cover both `accounts` mode and `notebook` mode (and verify `local` mode returns 404 on `/api/admin/analytics/*`).
   - Auth & security: signed out → 401, plain user → 403, missing/mismatched `X-Canvas-Account` in accounts mode → 401, notebook `role: "admin"` inherits admin access → 200, notebook plain user → 403, `Cache-Control: private, no-store` on all responses, invalid query parameters / NUL bytes → 400.
   - Verify `/api/admin/users` remains 404 in `notebook` mode.
   - Event persistence: editor `/api/usage/:action/:result` (including new actions `layout.auto`, `export.svg`, etc.), server project ops, `component.publish`, `auth.register`, `auth.login`, `agent.pair` all accumulate in `usage_daily_user_actions` and update `users.last_active_at`, while preserving JSONL output.
   - UTC day boundary check: inject `now` around `2026-11-26T23:59:50Z` and `2026-11-27T00:00:10Z` to verify UTC calendar-day bucketing.
   - Deleting an account removes it from `/api/admin/analytics/users` but preserves historical DAU and feature counts in `overview`/`trends`/`features`.
   - Verify `overview`, `trends`, `features`, `retention`, `users` (filter/sort/search/pagination/`total`), and `users/:id` (including 404 for cross-mode/unknown user) against known seeded fixtures, and assert no private project names or circuit text appear in any response.
   - Verify migration upgrade from schema 006 (with pre-existing `users` and `standalone_accounts`) to 007 backfills `users.first_seen_at` and `users.last_role` cleanly while preserving `NULL` for legacy accounts without `created_at`.

6. **Update `docs/specs/server.md`** to document the `/api/admin/analytics/*`
   read-only endpoints, UTC day bucketing, dual-mode (`accounts` & `notebook`)
   availability, and privacy guarantees.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm exec vitest run apps/server packages/project-protocol packages/component-library   # all pass
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check                    # exit 0
pnpm deadcode                                                                          # no new finding
pnpm build && node scripts/server-mode-check.mjs                                       # exit 0
```

Behavioral checks:

- All existing server tests (`standalone-mode.test.ts`, `notebook-auth.test.ts`,
  `account-administration.test.ts`, `migration-guard.test.ts`, `app.test.ts`)
  pass without weakening assertions.
- New `user-analytics.test.ts` passes on real PostgreSQL covering both
  `accounts` and `notebook` modes.

## Notes for the implementer

- Never log passwords, tokens, session cookies, or private project names/contents.
- Keep all SQL queries parameterized; never interpolate untrusted input into
  `ORDER BY` or `WHERE` (use explicit whitelisted SQL expressions for `sort`
  and `order`).
- Do not modify existing migration files `001`–`006`.
- Do not install or modify any package dependencies or `pnpm-lock.yaml`.
- Use lane 1 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
  which is free in this workspace.
