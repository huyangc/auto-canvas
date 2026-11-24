# T178 — Account administration on the server

- Branch: `task/T178-accounts-admin`
- Base: `main` at `9e66529`
- Status: approved
- Plan review: self-checked against the code

## Goal

In accounts mode an account can be an administrator. Administrators list
accounts, grant and revoke the role, disable and enable, reset a password and
delete an account over HTTP. A command on the server names the first
administrator. Any user can change their own password. This is the server
foundation for the shared circuit library and usage statistics (see Series);
it has no user interface of its own.

## Series

Confirmed with the owner on 2026-11-24. Only T178 is planned in detail here;
each later task gets its own plan once the one it builds on is merged.

| Task | Content                                                                                                      | After      |
| ---- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| T178 | Server: administrator role, account administration, password change                                          | —          |
| T179 | Editor: Administration page with the user list; password change in the account menu; forced change on sign-in | T178, PR 136 |
| T180 | Server: shared circuit library — tables, submit, withdraw, review, administrator maintenance                 | T178       |
| T181 | Editor: browse and open library circuits, submit a Cloud Project, own submissions, administrator review      | T179, T180 |
| T182 | Usage statistics: daily counters in PostgreSQL, totals and per-user detail on the Administration page        | T179       |

Owner decisions:

- Both libraries take publications: User Components and circuits.
- A submitted circuit is visible to others only after an administrator
  approves it. An administrator can return it with a reason. The submitter
  sees the state of their submissions and can withdraw one.
- Statistics: totals and per-user detail. Administrators never see the
  content of private drawings.
- Administration: disable/enable, reset password, delete.

Design defaults:

- A library circuit is a snapshot copied at submission. Editing or deleting
  the private Project later does not change it; opening a library circuit
  makes an independent private copy.
- Deleting an account deletes its private Projects. Its approved circuits and
  published components stay, with the author's name. Its pending submissions
  are deleted.
- The library starts empty, with the repository's bundled example Projects
  added by an administrator if wanted. Analog-canvas Gallery drawings are
  never imported.
- Statistics accumulate from the T182 release on; accounts that already exist
  have no registration time.

Open with the owner: whether User Component publication keeps its current
rule (visible at once, administrator marks official) or also needs approval.
It does not affect T178.

## Context

- `apps/server/src/standalone-accounts.ts`: `session()` (line ~70) returns
  `role: "user", isAdmin: false` for every account, so in accounts mode nobody
  can manage other people's components or mark one official
  (`component-management.ts`). Setting `isAdmin` from the database makes those
  existing rules work; `component-library-card.tsx` and
  `component-definition-editor.tsx` already show the controls for `isAdmin`.
- `registerComponents` and `registerProjects` are called at the end of
  `registerAccounts`, after the authentication middleware.
- `needsBinding` in `session()` lists the GET paths that require
  `X-Canvas-Account`; administrative reads must be on it.
- Tables: `users(id, display_name)`, `standalone_accounts(username, user_id,
  salt, password_hash)` (`004`, `user_id` cascades from `users`),
  `standalone_sessions` (cascades from `standalone_accounts`),
  `account_agent_pairings` (`005`, cascades from sessions). `cloud_projects.user_id`
  references `users(id)` **without** cascade (`001`), so Projects must be deleted
  before the user. `components.author_id` and `component_write_receipts.user_id`
  have no foreign key.
- Ending a session is two steps: delete the session rows in a transaction while
  collecting the pairings (`removeSessions`), then
  `relay.endAccountPairings(ids)` after commit. The relay joins
  `standalone_sessions`, so a deleted session already denies its pairings.
- `POST /api/projects` locks the `users` row and ignores whether it exists
  (`projects.ts` `save`), so a create racing account deletion would fail with a
  foreign-key error (500).
- Login reads the password hash before opening its transaction; without a
  recheck a login in flight could survive a disable, reset or deletion.
- Released migrations are immutable: `standalone-mode.test.ts` ("keeps the
  released migrations byte for byte") pins digests. `migration-guard.test.ts`
  reads the shipped list from disk.
- `server-main.ts` handles `--migrate` and the two guard flags. Local branch
  `task/T164b-notebook-managed-start` may touch the same area; rebase if it
  merges first.
- Notebook and local mode keep their own `isAdmin` and are unchanged.

## Scope

Owned paths:

- `apps/server/src/migrations/006-account-administration.sql` (new)
- `apps/server/src/account-administration.ts` and its test (new)
- `apps/server/src/standalone-accounts.ts`
- `apps/server/src/identity.ts`
- `apps/server/src/projects.ts` (the missing-user case only)
- `apps/server/src/server-main.ts`, `apps/server/src/server-main.test.ts`
- `apps/server/src/app.test.ts`, `apps/server/src/standalone-mode.test.ts`
- `apps/server/README.md`, `docs/specs/server.md`

Out of scope: everything under `apps/editor`, the Component Library's rules,
notebook and local mode, the usage log, statistics, self-service account
deletion, open registration (stays as it is).

## Steps

1. **Migration 006.** On `standalone_accounts` add `role text NOT NULL DEFAULT
   'user' CHECK (role IN ('user','admin'))`, `disabled boolean NOT NULL DEFAULT
   false`, `must_change_password boolean NOT NULL DEFAULT false`, and
   `created_at timestamptz` whose default `now()` is set in a separate
   statement after the column is added, so existing rows stay NULL (unknown).
   Add the file's digest to `standalone-mode.test.ts`.
2. **Session.** `session()` joins `standalone_accounts` and returns no user for
   a disabled account. `role`, `isAdmin` and `mustChangePassword` come from the
   row. Add optional `mustChangePassword` to `SessionUser`. Add `/api/admin`
   and its subpaths to `needsBinding`.
3. **Login.** Inside the transaction that inserts the session, lock the
   account row (`FOR SHARE`) and require that it exists, is not disabled and
   still has the hash that was verified; otherwise answer exactly as for a
   wrong password (401, same message). A disabled account is not revealed.
4. **Forced change.** While `must_change_password` is true, every authenticated
   route other than `GET /api/session`, `GET /api/auth/me`,
   `POST /api/auth/password` and `POST /api/auth/logout` is 403
   `password-change-required`. The agent pairing creation route is included.
5. **Own password.** `POST /api/auth/password {currentPassword, newPassword}`:
   same length rule, body limit, JSON check, `active` bound and attempt
   throttling as login; 401 for a wrong current password **without**
   `X-Canvas-Session: expired`, which would make the editor end the session.
   Use 400 `invalid-fields` for a bad new password and 400 `password-unchanged` when equal. On success it stores a new
   salt and hash, clears `must_change_password`, deletes the user's other
   sessions and ends their pairings; the presented session stays. The update
   requires the verified hash to be still current.
6. **Administration routes** in `account-administration.ts`, registered by
   `registerAccounts` after authentication. A middleware answers 403
   `forbidden` unless the current session is an administrator. Every mutation
   re-reads the acting account's role under lock in its own transaction, so a
   demotion in flight cannot race it.
   - `GET /api/admin/users?q=&cursor=&limit=` → `{users, nextCursor}` ordered by
     username, case-insensitive substring `q`, default 50 and at most 200. Each
     user: `{id, username, role, disabled, mustChangePassword, createdAt|null,
     projectCount}`. No hash, salt, session or Project field.
   - `PATCH /api/admin/users/:id {role?, disabled?}` (at least one, nothing
     else; otherwise 400 `invalid-fields`).
   - `POST /api/admin/users/:id/reset-password` → `{temporaryPassword}`, shown
     once: 16 characters from an unambiguous alphabet by `crypto.randomInt`.
     Sets `must_change_password`.
   - `DELETE /api/admin/users/:id {username}`; the name must match (400
     `confirmation-mismatch`). Deletes sessions, Projects (versions cascade)
     and the `users` row in one transaction. Components stay.
   Disable, reset and delete remove all the target's sessions and end their
   pairings. Unknown ids are 404 `not-found`, including `users` rows without an
   account (`local`, notebook users). All responses keep
   `Cache-Control: private, no-store`.
7. **Invariants.** An administrator cannot disable, demote, reset or delete
   themself (409 `own-account`). Serialise role/disable/delete mutations with
   one transaction advisory lock (`pg_advisory_xact_lock(4310, 3)`); 1 and 2 are
   taken by migrations and the Component Library. They then always leave the
   acting, enabled administrator.
   The acting account is re-read **after** that lock is taken.
8. **First administrator.** `--grant-admin <username>` (like `--migrate`:
   migrates, acts, ends the pool, returns null, listens on nothing). Accounts
   mode only; excludes `--migrate` and the guard flags, checked before any pool
   exists. An unknown or malformed username is an error naming no other
   account. Granting also enables the account. Idempotent.
9. **Project create** for a user row that no longer exists is 401
   `unauthorized` instead of a 500. Handle a Project update or restore racing
   deletion as the existing 404.
10. **Documents.** The accounts section and endpoint table of
    `docs/specs/server.md` ("account deletion … unimplemented" changes); the
    command and the rules in `apps/server/README.md`.

## Acceptance

```bash
pnpm exec vitest run apps/server packages/component-library   # all pass
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # exit 0
pnpm deadcode   # no new finding compared with main
pnpm build && node scripts/server-mode-check.mjs   # exit 0
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm exec playwright test apps/editor/e2e/standalone-accounts.spec.ts --workers=1   # same as main
```

Run the first Playwright baseline on `main` before judging a failure.

Behavioral checks, each a test on real PostgreSQL:

- A database at migration 005 with an account migrates; the account signs in,
  is a plain user and has a null `createdAt`; a new one has a time.
- Every `/api/admin` route: signed out 401, plain user 403, missing or other
  `X-Canvas-Account` 401, cross-site mutation 403, local and notebook mode 404.
- An administrator can set a component of another author `official`; a plain
  user cannot. A demotion takes effect on the next request.
- Disable, reset and delete: existing cookies and Agent pairings stop working
  at once; a login whose password was verified before the change (held in the
  test) gets no session.
- After a reset only the listed routes work until the password is changed;
  the old password no longer signs in.
- Two administrators demoting each other at once: exactly one succeeds.
- Delete removes the user's Projects and versions, leaves other users' data
  and the user's published components; the username can register again as a
  new user without access to the old data. A concurrent Project create never
  leaves a row and never answers 500.
- `--grant-admin` on a fresh registered account, twice, on an unknown name, in
  notebook mode and combined with each excluded flag.

## Notes for the implementer

- Never log passwords, temporary passwords, tokens or request bodies.
- Reuse `removeSessions`' locking order (session rows ordered by hash, then
  pairings); generalise it rather than writing a second one.
- Lock order everywhere: advisory lock, `users` row, `standalone_accounts` row,
  then sessions. Check it against register, login and Project create, and
  report the result.

Lane 2 for every command that needs one: `ICM_E2E_PORT=4273`,
`AUTO_CANVAS_E2E_API_PORT=4321`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`.
