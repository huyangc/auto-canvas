# T164 review

## Round 1 — accepted

Reviewed: the working tree on `task/T164-notebook-launcher` over `34e8d48`
(2026-11-24); the diff read in full for the server files, both scripts, the
plugin, the TOML examples and the documentation; acceptance rerun by Opus.

Every changed path is in the plan's owned list; `plan.md` is unchanged; no
dependency or lockfile change.

| #   | Severity | Where                                     | Finding                                                                                                                                                                                                                     | Expected fix                                                             |
| --- | -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | note     | `apps/server/src/migrate.ts`              | Without a guard the SQL statements and their order are unchanged; the directory listing now happens before `CREATE TABLE IF NOT EXISTS schema_migrations` instead of after it.                                              | None: no statement moved.                                                |
| 2   | note     | `apps/server/src/db.ts`                   | The hook is cast to `@types/pg`'s void signature; pg-pool 3.14 awaits it (`pg-pool/index.js:288-303`), and the failed-pin test exercises the production path.                                                               | None.                                                                    |
| 3   | note     | `apps/server/src/app.test.ts:774`         | One full-suite run failed here (`expected 'PROJECT_REPLACED' to be 'SESSION_REVOKED'`, standalone accounts, Agent credentials). The file is not touched by this task; it passed alone three times and in a second full run. | None here: an existing race in that test, reported to the owner.         |
| 4   | note     | `integrations/silicon-notebook/README.md` | The partial-rollback paragraph is derived, not observed.                                                                                                                                                                    | Observe it in T164b (the managed start inside a silicon-notebook clone). |

Acceptance rerun:

```text
python3.13 version preflight                                   → 0
pnpm build                                                     → 0
vitest run (the three new files)                               → 0   3 files, 162 passed, 0 skipped
vitest run apps/server/src                                     → 0   21 files, 371 passed
pnpm test:local                                                → 1   9101 passed, 1 failed (finding 3), 116 skipped
pnpm test:local (second run)                                   → 0   857 files passed, 3 skipped; 9102 passed, 116 skipped
vitest run apps/server/src/app.test.ts (three times)           → 0   24 passed each
pnpm typecheck / lint / format:check / docs:check / deadcode   → 0
bash -n serve.sh, init-db.sh; test -x both                     → 0
pnpm build:notebook-editor                                     → 0
bash tmp/t164/behaviour.sh                                     → 0   40 PASS, 0 FAIL; 6 processes stopped, 2 databases dropped, none remaining
databases named auto_canvas_it_* afterwards                    → 0
```

Not rerun: the reviewer-only prefixed standalone check, which overwrites
`apps/editor/dist` and needs a disposable checkout; the task changes nothing
on that path (no flag, one pool, no hook), which the unflagged cases of
`migration-guard.test.ts` and the unchanged `server-main.test.ts` and
`standalone-mode.test.ts` cover.

## Round 2 — accepted (fixes by the reviewer)

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 135 at `5032eeb` (three
P2, no blocking finding), each checked and found valid. The fixes are a few
lines each and were made by the reviewer.

| #   | Severity | Where                                     | Finding                                                                                                                                                                           | Fix                                                                                                                                                                                                           |
| --- | -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | fixed    | `serve.sh`, `init-db.sh`                  | Under an inherited `nocasematch`, `[[ "$name" != DATABASE_URL ]]` compares without case, so a differently-cased spelling was accepted (reproduced with `bash -O nocasematch`).    | Both scripts turn `nocasematch` off and compare the canonical spelling with `[`, which is exact. A launcher case passes `BASHOPTS=nocasematch` (effective on Bash 4.1+; the macOS 3.2 check was run by hand). |
| 6   | fixed    | `guarded-database.ts`                     | A bracketed host that is no IPv6 address (`[:::]`) passed the lexical form; `pg` would refuse it only when connecting, and in the notebook `.env` it was accepted as an identity. | A value must also parse (`URL.canParse`); two unit cases.                                                                                                                                                     |
| 7   | fixed    | `integrations/silicon-notebook/README.md` | A role of its own can still connect to silicon-notebook's database: `PUBLIC` has `CONNECT` by default.                                                                            | The step shows the `REVOKE`/`GRANT` pair, the check with `has_database_privilege`, and says what holds without it.                                                                                            |

Rerun: the three new files 165 passed, none skipped; typecheck, lint, format,
docs, deadcode 0; the behavioural script 40 checks passed, its databases
dropped.

## Round 3 — accepted (fixes by the reviewer; one finding answered)

Reviewed: codex `gpt-6.2-sol` PR review round 2 of PR 135 at `08c7cee` (two
P2, one P3, no blocking finding).

| #   | Severity | Where                     | Finding                                                                                                                                               | Outcome                                                                                                                                                                                                                                                                                                        |
| --- | -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | answered | `server-main.ts`, the pin | If the host name resolves to another server between the migration and a serving checkout, the hook accepts a database with the same schema name.      | Not changed. Identity is compared by name by decision (plan, the limits at the head of the design): a second server with a database of the same name is indistinguishable to every check of this task, at start as well. Re-running the ledger check per connection would not change that. Answered on the PR. |
| 9   | fixed    | `serve.sh`, `init-db.sh`  | With tracing on (`bash -x`, or an inherited `SHELLOPTS=xtrace`) the required-variable check printed the database URL, password included (reproduced). | Both scripts start with `set +x`; a launcher case runs them with `SHELLOPTS=xtrace` and finds no URL or password in their output.                                                                                                                                                                              |
| 10  | fixed    | `guarded-database.ts`     | Credentials that are not valid percent-encoding passed the form and failed in `pg` at the first checkout.                                             | The user name and password must decode; two unit cases.                                                                                                                                                                                                                                                        |

Rerun: the three new files 168 passed, none skipped; typecheck, lint, format,
deadcode 0; the behavioural script 40 checks passed.

## Codex round 3 — no blocking finding; follow-ups for T164b

Codex `gpt-6.2-sol` PR review round 3 of PR 135 at `73e7790`: one P2, three
P3. None is changed in this task; each is answered on the PR.

- P2, `migrate.ts`: set a transaction-local `search_path` to the checked
  schema before the table checks and the migration, so a schema created by
  another session ahead of it in the `search_path` cannot receive the
  migration's unqualified statements. Needs its own fixture: T164b.
- P3, `guarded-database.ts`: refuse a NUL in decoded credentials. T164b.
- P3, `migration-guard.test.ts`: fixture URLs drop the admin URL's query, so a
  TLS-only test server needs `PGSSLMODE` in the environment. Not used by this
  repository's lanes or CI.
- P3, `serve.sh`: an unusable `AUTO_CANVAS_LOG_FILE` (a directory, or not
  appendable) exits 1 with Bash's message instead of the status-2 diagnostic.
  T164b.

## Round 4 — CI failure of the secrets case (fixed by the reviewer)

CI's `pnpm test:local` failed on `73e7790` and `08c7cee` in
`migration-guard.test.ts`, "never gives the password to an error message or
the log": CI's database password is `postgres`, and the refusal message
contains `postgresql://`. The case passed locally because the lane URL has no
password. Reproduced locally with
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql://<user>:postgres@127.0.0.1:5432/auto_canvas_test_2`
(1 failed, 55 passed), then fixed in the test: the pre-pool refusal, which
never connects, uses a password of its own that no message could contain by
coincidence; the connecting cases look for the configured password where a URL
holds it (`:<password>@`) and for the URL itself. With the CI-shaped URL 56
passed; with the lane URL the three new files 168 passed.

The same CI run also timed out six `packages/auto-layout` tests at 5000 ms
(`differential-branches.test.ts`, `units.test.ts`); that run took 380 s
against 247 s for the previous head, and neither file is touched here.
