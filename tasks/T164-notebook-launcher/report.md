# T164 report — round 1

## Summary

The canvas can now be started as a silicon-notebook companion service.
`integrations/silicon-notebook/serve.sh` starts it in the foreground in
notebook mode on `127.0.0.1` under `/canvas`, and only on an existing canvas
database; `init-db.sh --notebook-root <dir>` initialises an empty one once.
Both rely on two server flags, `--require-canvas-database` and
`--init-empty-database`, whose checks run before any pool exists (the guarded
URL form, silicon-notebook's `.env` read as text) and inside the migration
transaction (schema, database name, ledger and tables, emptiness). A guarded
server serves from a second pool whose connections are pinned to the schema
the guard checked. Without a flag the server behaves as before. The directory
also holds a Python plugin package with no contributions, a managed and an
external TOML example, and the deployment and rollback instructions.

Two opus subagents implemented it: the first was cut off by a gateway 503
after steps 1–5 and part of 6–7; the second checked the inherited draft,
fixed it and finished. Nothing was committed by either.

## Steps

| Step                                   | Status | Notes                                                                                   |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| 1 `guarded-database.ts` and unit tests | done   | `guardedPostgresUrl`, `notebookDatabase`, `GuardedConfigurationError`; 66 tests         |
| 2 Guards in `migrate.ts`               | done   | `MigrationRefused`, `checkGuard`; guarded transactions open with `READ COMMITTED`       |
| 3 Flags, two pools, pin                | done   | `guardedStart`, `pinSchema` in `server-main.ts`; `createDb(url, onConnect?)` in `db.ts` |
| 4 `serve.sh`                           | done   | ends with the plan's `exec` line                                                        |
| 5 `init-db.sh`                         | done   | resolves `--notebook-root` with `pwd -P`                                                |
| 6 Plugin package and TOML              | done   | `AutoCanvasBundle`, id `auto_canvas.integration`                                        |
| 7 `scripts/notebook-launcher.test.mjs` | done   | 40 tests; the Python harness fails rather than skips                                    |
| 8 `migration-guard.test.ts`            | done   | 56 tests on databases of their own                                                      |
| 9 Documentation                        | done   | README, `docs/specs/server.md`, `docs/testing/README.md`                                |

## Investigation results

- The local test role (`huzhifeng` on `postgresql:///auto_canvas_test_2`) may
  create databases (`rolcreatedb OR rolsuper` is true). CI's `postgres` role
  is a superuser.
- The loopback form `postgresql://<user>@127.0.0.1/<db>` connects and reports
  the intended `current_database()`; the test proves it again in `beforeAll`.
  Local loopback authentication does not check passwords, so the secrets case
  adds a recognisable password only when the admin URL has none.

## Deviations

1. `db.ts` passes the hook through a cast: `@types/pg` declares `onConnect` as
   returning void, while pg-pool 3.14 awaits the promise (lint's
   `no-misused-promises` otherwise fails).
2. `USER_RELATION_COUNT` in `migrate.ts` is exported with an `@internal` tag so
   the test measures with the guard's own query; `knip.config.js` is
   unchanged.
3. `migration-guard.test.ts`: fixture URLs drop the admin URL's query and
   fragment (the guarded form forbids them); the serving environment sets
   `AUTO_CANVAS_BASE_PATH=/canvas` as `serve.sh` does; the `no-schema` and
   identity cases run for both flags; `afterAll` bounds every close to 3 s so
   a leaked client cannot prevent the drops.
4. The launcher test's refusals also assert the absence of the notebook
   connection string.
5. README, rollback: what happens when only one of the parts is removed is
   derived from the two settings' roles and marked as not yet observed
   (T164b).

## Evidence from the implementer

Mutation checks (each reverted): a plain `BEGIN` fails the repeatable-read
concurrency case; a `db.ts` that drops the hook fails the pinned-schema and
failed-pin cases; `LIKE 'pg_%'` fails the `pgXtemp_data` case; accepting any
`relkind` fails the `users`-as-view case; not ending the migration pool fails
five cases. A probe on the built server showed `createDb` call 1 without a
hook and its pool ended, call 2 with a hook, and a new connection reading
`current_schema()` as the pinned schema after the database default changed.

## Not done or not verified

- The reviewer-only prefixed standalone check
  (`AUTO_CANVAS_BASE_PATH=/canvas pnpm build`, `base-path-proxy.mjs --check`).
- The plugin was imported from source by the test, never built or installed.
- A managed start inside a real silicon-notebook (T164b).
- During mutation runs two batches of `auto_canvas_it_*` databases were left
  behind (one after a hook timeout, one unexplained) and dropped by name; every
  normal run cleaned up.
