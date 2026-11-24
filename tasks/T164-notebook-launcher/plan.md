# T164 — Notebook launcher, database guards and plugin skeleton

- Branch: `task/T164-notebook-launcher`
- Base: `main` at `af05b80`
- Status: approved (scope and the four decisions confirmed by the owner, 2026-11-24)
- Plan review: codex `gpt-6.2-astra`, round 1 `revise` (9 P1, 5 P2),
  round 2 `revise` (9 P1, 2 P2), round 3 `revise` (6 P1, 3 P2), round 4
  `revise` (3 P1, 2 P2), round 5 **`approve`** (no P0/P1; its 4 P2 and 1 P3
  are applied). Raw outputs: `tasks/T164-notebook-launcher/logs/`

## Goal

A silicon-notebook deployment can start the canvas as one of its companion
services. This task delivers what that needs on the canvas side and nothing
that needs a running silicon-notebook: a foreground start command
(`integrations/silicon-notebook/serve.sh`) that can only ever serve the
notebook mode on its own database, an explicit one-time database
initialisation (`init-db.sh`) that refuses silicon-notebook's database, the
server-side database guards they rely on, an installable Python plugin package
with no contributions, two TOML examples (managed and external), and the
deployment and rollback instructions for a source deployment. Standalone
auto-canvas is unchanged: without the new flags the server migrates and starts
exactly as today.

Parent: the silicon-notebook integration plan (version 7), section 4.5 and work
package W5. Stage M of the integration check (a managed start inside a
disposable silicon-notebook clone, two users) is **not** in this task; it is
T164b and uses what this task delivers.

## Context

Facts read in the code at the base commit.

**Server start and migration**

- `apps/server/src/cli.ts:1-9` calls `startServer()` and closes on SIGINT /
  SIGTERM.
- `apps/server/src/server-main.ts:29-47`: `startServer` reads the auth mode
  (`readAuthConfig`), the base path, creates the pool with
  `createDb(env.DATABASE_URL)` (injectable: `StartOptions.createDb`), calls
  `migrate(db)`, and returns `null` after it when `argv` includes `--migrate`.
  Configuration errors are raised before any connection (`:35-38`). `:97-98`:
  `PORT` (default 4310) and `HOST` (default `127.0.0.1`).
- `apps/server/src/migrate.ts:4-36`: one transaction (`BEGIN`) on one
  connection; `pg_advisory_xact_lock(4310, 1)`;
  `CREATE TABLE IF NOT EXISTS schema_migrations`; then every `*.sql` of
  `./migrations/` in sorted order that has no row. All names are unqualified,
  so they are created in the first schema of the connection's `search_path`
  that exists (`current_schema()`). Shipped files: `001-single-user.sql`
  (creates `users`, `cloud_projects`, `cloud_project_versions`),
  `002-component-library.sql`, `003-agent-relay.sql`,
  `004-standalone-accounts.sql`, `005-account-agent-pairings.sql`. The build
  copies them to `apps/server/dist/migrations/` (`apps/server/package.json`).
- `apps/server/src/db.ts:3-7`: `createDb(connectionString)` falls back to
  `process.env.DATABASE_URL`, then `postgresql:///auto_canvas`. `pg` reads
  libpq's environment (`PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, …) for
  whatever the URL leaves out, and its URL parser differs from libpq's: for
  `postgresql://localhost/a?dbname=b` libpq connects to `b` and `pg` to `a`;
  `pg` also accepts a `sqlite:///name` URL as a PostgreSQL connection. The
  installed pool (pg-pool 3.14.0 with pg 8.23.1) has an `onConnect` option
  that it awaits for each new physical connection before handing the client
  out, ending the client when the hook rejects
  (`node_modules/.pnpm/pg-pool@3.14.0_pg@8.23.1/node_modules/pg-pool/index.js:288-303`);
  a `pool.on("connect")` listener is not awaited.
- `apps/server/src/auth-config.ts:13-53`: `AUTO_CANVAS_AUTH` unset or
  `accounts` is the standalone accounts mode (the default), `local` the legacy
  single-user mode, `notebook` needs `AUTO_CANVAS_NOTEBOOK_API`, a loopback
  origin.
- Notebook mode answers only under `/@notebook/` (`server-main.ts:76-95`,
  `integration-mount.ts`). The ready probe, as silicon-notebook reaches it, is
  `GET /@notebook/canvas/api/integration/ready.json` (`app.ts:245`): 200 only
  in notebook mode after a database query, no token needed. A standalone
  server answers 404 to that URL; its own `/api/integration/ready.json` can
  answer 401 in accounts mode (`standalone-accounts.ts:256` authenticates
  `/api/*`), which is not what the checks below ask about.
- Environment the server reads besides those: `EDITOR_ROOT`,
  `AUTO_CANVAS_BASE_PATH`, `AGENT_ALLOWED_ORIGIN`, `AGENT_SESSION`,
  `AUTO_CANVAS_USER_NAME`, `AUTO_CANVAS_PROJECT_LIMIT`,
  `AUTO_CANVAS_AGENT_IDLE_MS`, `ANALOG_CANVAS_API_URL`.
- Tests of the start path use a throwaway **schema** of the test database
  (`server-main.test.ts:17-24`: a pool with `options: -c search_path=<schema>`).
  The notebook browser fixture (`scripts/notebook-e2e-fixture.mjs`) starts the
  notebook-mode server on an empty schema and relies on the default migration:
  that path must keep working.

**The standalone launcher (for style, not to be changed)**

- `scripts/start.sh` and `scripts/lib/launcher.sh` start
  `node apps/server/dist/cli.js` with `.env` loaded, logs under `.local/logs/`
  (git-ignored). `scripts/launcher.test.mjs` tests them in a temporary root
  with fake executables; the same technique fits the new scripts.
- `pnpm build:notebook-editor` writes the notebook editor to
  `apps/editor/dist-notebook/` (`package.json:89`).
- Vitest collects `apps/**/*.test.{ts,tsx}`, `packages/**/*.test.{ts,tsx}` and
  `scripts/**/*.test.mjs` (`vitest.config.ts`); no configuration change is
  needed for the new test files. CI runs `pnpm build` before
  `pnpm test:local`, but not `pnpm build:notebook-editor`; its PostgreSQL role
  may create databases; it runs `pnpm deadcode` (knip): an export nothing
  imports fails the check.
- `python3` differs per shell on the development machine (3.9 in a plain
  environment, 3.14 in another); `python3.13` is at
  `/opt/homebrew/bin/python3.13`. CI's `python3` is 3.12.

**silicon-notebook's side (read-only; not a dependency of any test here)**

- A companion service is declared in the extensions TOML next to the plugin's
  `bundle`: `mode = "managed"` needs `cwd` and a non-empty argv `command`, and
  exactly one of `healthcheck_url` / `healthcheck_command`; `env` adds literal
  strings, `env_from` maps a target name to an existing source variable name,
  and the two key sets may not overlap; `mode = "external"` takes the health
  check only and rejects `command`, `cwd`, `env`, `env_from`
  (`docs/deployment-and-configuration_zh.md`, 配套服务配置;
  `backend/app/extensions/service_config.py:23-26,145-162`). A relative `cwd`
  is resolved against the TOML's directory. There is no shell. Ids match
  `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$` (`service_config.py:19`).
  `healthcheck_url` must be http(s) without credentials, query or fragment
  (`:214-229`). The managed example below was parsed by that parser in the
  plan review.
- **The child inherits silicon-notebook's whole start environment**, including
  its effective `DATABASE_URL` and `PORT` (same document). The manager
  discards the child's stdout and stderr; a service logs to its own file,
  stays in the foreground (`exec` at the end of a shell wrapper), handles
  SIGTERM, and must not install anything at start
  (`docs/deployment-extensions-sop_zh.md`, 配套服务交付契约, which also asks
  for a path example relative to the configuration file). Default start
  timeout 60 s, stop timeout 15 s.
- silicon-notebook's start scripts load `<root>/.env` with
  `set -a; source "$ROOT/.env"; set +a` (`scripts/prod.sh`,
  `packaging/start.sh:32-36`); a literal assignment there wins over the
  inherited environment. `DATABASE_URL` accepts the schemes `sqlite`,
  `postgresql`, `postgres` (`backend/app/core/database_url.py:25-29`) and
  defaults to `sqlite:///.local/silicon_notebook.db`
  (`backend/app/core/config.py:2067`); its backend connects through libpq.
- The `/canvas` rewrite rules are silicon-notebook's pull request
  `huyangc/silicon-notebook#1077` (merged 2026-11-23, after the revision in
  the owner's checkout): `CANVAS_PROXY_TARGET` is a **bare loopback origin**,
  `http(s)://127.0.0.1[:port]` or `localhost`, for example
  `http://127.0.0.1:4310`; silicon-notebook appends `/@notebook/canvas…`
  itself, and a value with a path fails its build (`frontend/next.config.mjs`,
  `docs/deployment-and-configuration_zh.md` there). Its own API rewrite uses
  `BACKEND_PROXY_TARGET`, which a deployment may already set.
- A plugin package with no contributions is valid: the sample
  `examples/extensions/managed-service/src/silicon_notebook_managed_service/bundle.py`
  is a frozen dataclass with a `manifest` and a no-op `register`, importing
  only `app.extension_sdk` (`EXTENSION_API_VERSION`, `ExtensionManifest`); its
  `pyproject.toml` uses setuptools, `requires-python = ">=3.13"`,
  `dependencies = []`.

## Design (decided; do not redesign)

The purpose of everything below: a mistake in silicon-notebook's environment
or configuration must not make the canvas migrate or serve silicon-notebook's
database. When a case is ambiguous, refuse.

What the guards establish, and their limits (to be said in the
documentation): the canvas initialises only a database that holds no relation
in any non-system schema (functions and types without a relation are not
looked at) and whose name differs from the database silicon-notebook's `.env`
names; it serves only a database that holds the canvas ledger and tables in
the schema it writes to and whose name differs likewise. The limits:

- The comparison is by database name, so both products must connect to
  PostgreSQL directly (a proxy that maps database names, such as PgBouncer
  aliases, is not supported), and two databases of the same name on different
  servers are refused.
- silicon-notebook must be started by its own start scripts, which load
  `<root>/.env`, from an environment that holds no other spelling of
  `DATABASE_URL` (its settings loader ignores case, so an inherited
  `database_url` could win over the file) and no `SILICON_NOTEBOOK_ENV_FILE`
  (which makes its Python launcher read another file). `serve.sh` and
  `init-db.sh` refuse when their own environment holds either; a launcher of
  the external mode must meet the same conditions.
- The file is read when the canvas starts, silicon-notebook's environment when
  silicon-notebook starts. They agree only if both are (re)started from the
  same revision of the file: the instructions give the procedure for changing
  silicon-notebook's database — stop both, edit, start both — and say that
  restarting only one of them after such an edit is not supported.
- None of this replaces giving the canvas its own PostgreSQL role, which the
  instructions recommend.

### 1. `apps/server/src/guarded-database.ts` (new): two pure functions

Used only when one of the new flags is given. Both refuse by throwing a
`GuardedConfigurationError` (exported, used by `server-main.ts`) whose message
names the reason — and, for the file, the line number — and never a value.

- `guardedPostgresUrl(value)` accepts exactly: `postgresql://` or
  `postgres://`, an optional `user[:password]@`, a **non-empty host** (a name,
  an IPv4 address or a bracketed IPv6 address), an optional numeric port, `/`,
  and a database name of `[A-Za-z0-9_-]{1,63}` (PostgreSQL truncates longer
  names, so a longer spelling could differ from `current_database()`); **no
  query string, no fragment, no percent sign in the host or the database
  name**. It returns the database name. Everything else is refused: a missing
  or empty value, another scheme, `postgresql:///name` (no host), `?dbname=`,
  `?host=`, `?service=`, `?options=`, a socket directory. In this form libpq
  and `pg` resolve the same host and database name.
- `notebookDatabase(envFileText)` validates the **whole file** against a
  grammar that needs no shell to interpret, and never executes it. Lines end
  with LF. Before any line is looked at, a NUL, a carriage return or any other
  control character except tab and LF anywhere in the file refuses it (Bash
  keeps a carriage return in the value and can stop reading at a NUL, even
  inside a comment). Every line must be one of:
  - blank (only spaces and tabs);
  - a comment (first non-blank character `#`);
  - an assignment: optional leading blanks, optional `export` and blanks, a
    key `[A-Za-z_][A-Za-z0-9_]*`, `=`, a value, optional trailing blanks. The
    value is one of: empty; unquoted, of characters other than whitespace and
    ``$ ` \ " ' ; & | < > ( ) { } * ? [ ] ~ # !``; single-quoted with no `'`
    inside; double-quoted with none of ``$ ` \ "`` inside.

  Any other line (a compound command, an expansion, a continuation, an
  unterminated quote) refuses the file with its line number: Bash could then
  give `DATABASE_URL` a value this function cannot know. An assignment to a
  variable whose assignment could change how Bash reads the rest of the file
  or what `DATABASE_URL` ends up as is refused too (some are evaluated
  arithmetically even when quoted, which can run code; others make Bash touch
  files). The list protects the interpretation of the database URL; it is
  not a promise that sourcing the file has no other effect on the shell. A
  key that starts with `BASH`, `HIST`,
  `COMP_`, `READLINE_` or `PROMPT_`, or is one of `_`, `OPTIND`, `OPTARG`,
  `OPTERR`, `RANDOM`, `SRANDOM`, `SECONDS`, `LINENO`, `EPOCHSECONDS`,
  `EPOCHREALTIME`, `IFS`, `PPID`, `UID`, `EUID`, `GROUPS`, `SHELLOPTS`,
  `FUNCNAME`, `FUNCNEST`, `DIRSTACK`, `PIPESTATUS`, `ENV`, `POSIXLY_CORRECT`,
  `GLOBIGNORE`,
  `MAILCHECK`, `TMOUT`, `IGNOREEOF`, `histchars`, `PS0`, `PS1`, `PS2`, `PS3`,
  `PS4`. Plain strings a deployment may well set (`PATH`, `HOME`, `LANG`,
  `LC_*`, `TMPDIR`, `HOSTNAME`) are ordinary keys. So is every other name,
  with one exception: the key `SILICON_NOTEBOOK_ENV_FILE` refuses the file,
  because silicon-notebook's Python launcher would then read settings from a
  second file (`scripts/python_env.py:17-37`). Keys are
  compared
  whole: exactly one assignment may have the key `DATABASE_URL`; a second one,
  none, or a key that equals `DATABASE_URL` only when case is ignored
  (silicon-notebook reads settings case-insensitively) refuses.
  `SHADOW_DATABASE_URL`, `DATABASE_URL_BACKUP` and `AUTO_CANVAS_DATABASE_URL`
  are other keys and do not count. The value of that one assignment is then
  either a SQLite URL in silicon-notebook's own form (`sqlite:///` followed by
  a non-empty path) → the result is `null` (nothing to compare), or it must
  pass `guardedPostgresUrl` → the result is its database name. The active
  lines of silicon-notebook's `.env.example` fit this grammar.

### 2. Guards in the migration transaction (`migrate.ts`)

`migrate(db, guard?)` gets an optional guard
`{ kind: "canvas" | "empty"; notDatabase: string | null }` and returns the
name of the schema it wrote to when a guard was given. With a guard the
transaction is opened with `BEGIN ISOLATION LEVEL READ COMMITTED` (so a start
that waited for the advisory lock sees what the holder committed, whatever the
role's or database's default isolation is); without one, `BEGIN` exactly as
today, and the same statements in the same order. The guard is checked on the
migration connection **after** the advisory lock and **before**
`CREATE TABLE IF NOT EXISTS schema_migrations`. A failed guard throws an
exported `MigrationRefused` error with a `reason` code; the transaction rolls
back and no statement of the migration has run. All catalog references are
schema-qualified (`pg_catalog.pg_class`, …). A "system schema" below is
`information_schema` or a schema whose name starts with the three characters
`pg_` (compare with `left(nspname, 3) = 'pg_'`, not with `LIKE`, where `_` is
a wildcard; PostgreSQL reserves that prefix, so no user schema has it).

Checks, in this order:

1. `current_schema()` is not null and is not a system schema — this also
   refuses a temporary schema first in the `search_path` (reason `no-schema`).
2. When `notDatabase` is not null, `current_database()` differs from it
   (reason `notebook-database`).
3. `kind: "canvas"` — in `current_schema()`, `schema_migrations`, `users` and
   `cloud_projects` each exist **as a table** (`relkind` `r` or `p`; a view,
   sequence or index of that name does not count; reasons `no-ledger`,
   `no-users`, `no-projects`), and the applied names, sorted, are a non-empty
   prefix of the shipped file names, sorted (reason `ledger-mismatch`).
   Pending shipped migrations are then applied as today.
4. `kind: "empty"` — `pg_catalog.pg_class` has **no row, of any kind, in any
   schema that is not a system schema** (reason `not-empty`). Then the
   migrations run.

### 3. Flags (`server-main.ts`), not environment switches

A managed child inherits silicon-notebook's environment, so the guards are
selected by command-line flags.

- `--require-canvas-database` → guard `canvas`, then the server serves.
- `--init-empty-database` → guard `empty`; `startServer` ends the pool and
  returns `null`, as `--migrate` does. `readAuthConfig` is still called first,
  so `init-db.sh` sets `AUTO_CANVAS_AUTH=local`.

With either flag, **before `createDb` is called** (the pre-pool refusals, all
`GuardedConfigurationError` except the first, which is a plain configuration
`Error`):

1. Both flags together, or either flag with `--migrate` (the message names the
   two flags).
2. `DATABASE_URL` must pass `guardedPostgresUrl` (no fallback to a default).
3. `AUTO_CANVAS_NOTEBOOK_ENV_FILE` must be set to an absolute path of a
   regular file that can be read; its text goes to `notebookDatabase`, whose
   result is the guard's `notDatabase`.

Then the pool is created and `migrate` runs with the guard; a
`MigrationRefused` ends the pool and is rethrown (the catalog refusals).

**The serving schema is pinned, with two pools.** With
`--require-canvas-database` the pool the migration ran on is **ended** as soon
as `migrate` returned the schema name, and the server serves from a second
pool created with the pool option `onConnect` (pg-pool 3.14 awaits it for
every new physical connection before the client is handed out, and discards
the client when it rejects): it runs
`SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), false)`
with that name and then requires `current_schema()` to equal it, rejecting
otherwise (the schema was dropped or renamed since the start). No connection
of the serving pool exists unpinned, a failed pin fails the checkout instead
of serving from another schema, and a later
change of the role's or database's default `search_path` cannot move the
serving connections. For this, `createDb` in `db.ts` and the injectable
`StartOptions.createDb` take an optional second argument,
`onConnect?: (client: pg.ClientBase) => Promise<void>`, passed to `pg.Pool`;
`createDb` with one argument behaves exactly as today.

Neither flag: today's behaviour, unchanged, in every auth mode, including the
`createDb` default, URLs outside the guarded form, one pool and no
`onConnect`.

### 4. `integrations/silicon-notebook/serve.sh`

Foreground, no options. In this order, each failure exiting with status 2 and
one line on stderr that names the variable or file, never a value:

1. `AUTO_CANVAS_DATABASE_URL`, `AUTO_CANVAS_NOTEBOOK_API` and
   `AUTO_CANVAS_NOTEBOOK_ENV_FILE` are set and not empty; the last is an
   absolute path of an existing regular file (the script does not read it).
   No environment variable has a name that equals `DATABASE_URL` when case is
   ignored other than `DATABASE_URL` itself (iterate `compgen -e`; the message
   says a differently-cased spelling is set, without its value), and
   `SILICON_NOTEBOOK_ENV_FILE` is not set, not even to the empty string.
2. `AUTO_CANVAS_PORT`, when set, is a decimal integer from 1 to 65535 (default
   4310).
3. The Node executable: `AUTO_CANVAS_NODE` when set (an absolute path to an
   executable file), otherwise `node` found on `PATH`.
4. The canvas root is two directories above the script, resolved with
   `pwd -P`. `<root>/apps/server/dist/cli.js` and
   `<root>/apps/editor/dist-notebook/index.html` exist (the message says which
   build command makes the missing one).
5. The log file: `AUTO_CANVAS_LOG_FILE` when set (an absolute path), otherwise
   `<root>/.local/logs/notebook-canvas.log`; its directory is created.

Then it sets `DATABASE_URL` to `AUTO_CANVAS_DATABASE_URL` (the inherited
`DATABASE_URL`, silicon-notebook's, is overwritten and used for nothing),
`HOST=127.0.0.1`, `PORT`, `AUTO_CANVAS_BASE_PATH=/canvas`,
`AUTO_CANVAS_AUTH=notebook`,
`EDITOR_ROOT=<root>/apps/editor/dist-notebook`; unsets
`AGENT_ALLOWED_ORIGIN`, `AGENT_SESSION`, `AUTO_CANVAS_USER_NAME`,
`ANALOG_CANVAS_API_URL`, `PGDATABASE`, `PGHOST`, `PGHOSTADDR`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS` (the
inherited ones are silicon-notebook's; `PGPASSFILE` and `PGSSL*` stay);
changes to the root; and ends with exactly this line:

```bash
exec "$node" apps/server/dist/cli.js --require-canvas-database >>"$log" 2>&1
```

There is no way to make it serve another mode, another host, or without the
guard, and it never initialises a database. Because the notebook's `.env` is
read at every start, an edit that makes it ambiguous (see design 1) stops the
canvas from starting, with the line number in the log; the instructions say
so.

### 5. `integrations/silicon-notebook/init-db.sh --notebook-root <dir>`

An installation step, run by hand once.

1. Exactly one option, `--notebook-root <dir>`; the directory and a regular
   file `<dir>/.env` must exist. No connection string for silicon-notebook's
   database is accepted on the command line or from the caller's environment.
   The script does not read, source or print the file.
2. The same checks as `serve.sh` for `AUTO_CANVAS_DATABASE_URL`, the
   differently-cased spellings of `DATABASE_URL`, `SILICON_NOTEBOOK_ENV_FILE`,
   the Node executable and
   `<root>/apps/server/dist/cli.js`. `AUTO_CANVAS_NOTEBOOK_API` is not needed.
3. It changes to the root and runs, in the foreground with output on the
   terminal, the server with `DATABASE_URL` set to `AUTO_CANVAS_DATABASE_URL`,
   `AUTO_CANVAS_AUTH=local`, `AUTO_CANVAS_NOTEBOOK_ENV_FILE` set to the
   absolute path of `<dir>/.env` (replacing an inherited value), the same
   libpq variables unset, and the argument `--init-empty-database`. Its exit
   status is the script's; on success it prints one line saying the database
   is initialised.

### 6. Plugin package

`integrations/silicon-notebook/plugin/`: `pyproject.toml` (setuptools, name
`silicon-notebook-auto-canvas`, `requires-python = ">=3.13"`,
`dependencies = []`) and `src/silicon_notebook_auto_canvas/` with `__init__.py`
(empty) and `bundle.py`: a frozen dataclass bundle like the managed-service
sample, manifest id `auto_canvas.integration`, version `0.1.0`,
`api_version=EXTENSION_API_VERSION` (the imported constant, not a literal),
`display_name="电路画布"`, `trust="deployment"`, empty `contributions`,
`requires`, `provides` and `ui_contributions`, a `register` that does nothing.
Importing it has no side effect. The entry link (a UI contribution) is T165.

### 7. TOML examples (two files)

`integrations/silicon-notebook/extensions.example.toml`:

```toml
[extensions."auto_canvas.integration"]
bundle = "silicon_notebook_auto_canvas.bundle:BUNDLE"
enabled = true

[extensions."auto_canvas.integration".services.canvas]
mode = "managed"
# The canvas installation, outside silicon-notebook's directory. A path
# relative to this file works too, for example "../auto-canvas".
cwd = "/opt/auto-canvas"
command = ["./integrations/silicon-notebook/serve.sh"]
healthcheck_url = "http://127.0.0.1:4310/@notebook/canvas/api/integration/ready.json"

[extensions."auto_canvas.integration".services.canvas.env]
AUTO_CANVAS_NOTEBOOK_API = "http://127.0.0.1:8000"
AUTO_CANVAS_NOTEBOOK_ENV_FILE = "/opt/silicon-notebook/.env"
AUTO_CANVAS_PORT = "4310"

[extensions."auto_canvas.integration".services.canvas.env_from]
AUTO_CANVAS_DATABASE_URL = "AUTO_CANVAS_DATABASE_URL"
```

`integrations/silicon-notebook/extensions.external.example.toml`: the same
`[extensions."auto_canvas.integration"]` table and a
`[extensions."auto_canvas.integration".services.canvas]` table with
`mode = "external"` and the same `healthcheck_url`, nothing else; a comment
says the operator starts and stops the same `serve.sh` with the same three
required variables.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/server/src/migrate.ts`
- `apps/server/src/server-main.ts`
- `apps/server/src/db.ts` (the optional `onConnect` argument only)
- `apps/server/src/guarded-database.ts` (new)
- `apps/server/src/guarded-database.test.ts` (new)
- `apps/server/src/migration-guard.test.ts` (new)
- `integrations/silicon-notebook/serve.sh` (new, executable)
- `integrations/silicon-notebook/init-db.sh` (new, executable)
- `integrations/silicon-notebook/extensions.example.toml` (new)
- `integrations/silicon-notebook/extensions.external.example.toml` (new)
- `integrations/silicon-notebook/README.md` (new)
- `integrations/silicon-notebook/plugin/pyproject.toml` (new)
- `integrations/silicon-notebook/plugin/src/silicon_notebook_auto_canvas/__init__.py` (new)
- `integrations/silicon-notebook/plugin/src/silicon_notebook_auto_canvas/bundle.py` (new)
- `scripts/notebook-launcher.test.mjs` (new)
- `docs/specs/server.md` (the notebook-mode section: the start command, the
  flags and the guards)
- `docs/testing/README.md` (the new tests and what they need)
- `knip.config.js` only if `pnpm deadcode` needs the new directory named
- `tasks/T164-notebook-launcher/report.md`

Out of scope (do not change):

- Every other file of `apps/server/src` (`cli.ts`, `app.ts`, `auth-config.ts`,
  the migrations), the editor, `packages/**`.
- `scripts/start.sh`, `scripts/stop.sh`, `scripts/lib/launcher.sh`,
  `scripts/notebook-e2e-fixture.mjs`, `scripts/notebook-integration-check.mjs`
  and its library, `playwright.config.ts`, `vitest.config.ts`, `package.json`,
  the lockfile.
- silicon-notebook: its checkout
  `/Users/huzhifeng/workspace/silicon-notebook` is never written to; its
  `.env`, `.local` and databases are never read; nothing there is started.
- An entry link or any UI contribution (T165), the offline package (T166),
  the paired offline instructions (T167), stage M (T164b).

## Steps

1. **`guarded-database.ts`** with the two functions of design 1 and
   **`guarded-database.test.ts`** (pure unit tests):
   - `guardedPostgresUrl` accepts `postgresql://h/db`,
     `postgres://u:p@h:5432/db`, `postgresql://u@127.0.0.1/a_b-1`,
     `postgresql://[::1]:5432/db`, a 63-character name; refuses, each with its
     own case, an empty value, `sqlite:///x`, `mysql://h/db`,
     `postgresql:///db`, `postgresql://h/`, `postgresql://h/db?dbname=other`,
     `?host=/tmp`, `?service=x`, `?options=-csearch_path%3Dx`, a fragment,
     `postgresql://h/d%62`, `postgresql://h/db/extra`, a database name with a
     space, a 64-character name, a non-numeric port, text before the scheme.
     No refusal message contains the password of the value it refused.
   - `notebookDatabase` accepts `DATABASE_URL=postgresql://u:p@h/db`,
     `export DATABASE_URL=…`, double- and single-quoted values, leading and
     trailing blanks, a commented
     `# DATABASE_URL=sqlite:///…` beside a real one, a `sqlite:///x` value
     (→ `null`), lines for `SHADOW_DATABASE_URL`, `DATABASE_URL_BACKUP` and
     `AUTO_CANVAS_DATABASE_URL` beside the real one, other keys with empty,
     quoted and unquoted literal values; refuses, each with its own case and
     with the right line number in the message: no `DATABASE_URL` key, two of
     them, a `database_url` key (alone, and beside the upper-case one),
     `DATABASE_URL="${DATABASE_URL:-sqlite:///x}"`, `DATABASE_URL=$OTHER`,
     ``DATABASE_URL=`cmd` ``, `DATABASE_URL=$(cmd)`, an **inactive**
     assignment (`if false; then` / the assignment / `fi` on three lines), a
     value continued over two lines inside quotes, a line `; other` after a
     value, an unterminated quote, a non-assignment line elsewhere in the file
     (`echo hi`, `unset DATABASE_URL`, `source other`), another key whose
     value has an expansion (`OTHER=$HOME`), CRLF line ends (one file, every
     line), a NUL inside a comment before the `DATABASE_URL` line, an
     assignment to `OPTIND`, to `BASH_ENV`, to `HISTFILESIZE`, to `IFS` and to
     `SILICON_NOTEBOOK_ENV_FILE` (each beside a valid `DATABASE_URL` line; a
     file that sets `PATH`, `HOSTNAME` and `LANG` beside it is accepted), `sqlite://host/x`, `sqlite:///`, a
     PostgreSQL value outside the guarded form. No message contains a value
     from the file. One more case reads silicon-notebook's shipped
     `.env.example` **as a copy the test carries as a string** (its active
     lines at the revision the plan cites, with the secret-looking values
     replaced by `change-me`; the test does not read the sibling checkout)
     and expects the database name `silicon_notebook`.
2. **Guards.** In `migrate.ts`, add the optional second parameter, the
   `MigrationRefused` class and the checks of design 2.
3. **Flags.** In `server-main.ts` and `db.ts`, implement design 3: the
   pre-pool refusals, the guarded migration on a pool that is then ended,
   and the serving pool with the `onConnect` pin.
4. **`serve.sh`**, as designed. Bash 3.2 compatible (macOS),
   `set -euo pipefail`, no `eval`, every expansion quoted.
5. **`init-db.sh`**, as designed.
6. **Plugin package and the two TOML files**, as designed.
7. **`scripts/notebook-launcher.test.mjs`** (vitest, node). Each case copies
   the two scripts into a temporary root with the expected layout
   (`integrations/silicon-notebook/`, a stand-in `apps/server/dist/cli.js`,
   `apps/editor/dist-notebook/index.html`); **one of the roots has a space in
   its path**. A **recording Node stand-in** is an executable script that
   writes its pid, argv, working directory and the environment variables named
   below to a record file, prints one distinct marker on stdout and another on
   stderr, and exits (or, for the foreground case, stays until SIGTERM). No
   real server, no database, no port. Cases:
   - `serve.sh`, started from another working directory, parent environment
     with `DATABASE_URL=<notebook value>`, `PORT=8000`, `HOST=0.0.0.0`,
     `AUTO_CANVAS_AUTH=local`, `AUTO_CANVAS_BASE_PATH=/x`,
     `EDITOR_ROOT=/elsewhere`, and **every** name of the unset list, each with
     a value: the stand-in sees `DATABASE_URL` equal to
     `AUTO_CANVAS_DATABASE_URL`, `AUTO_CANVAS_NOTEBOOK_ENV_FILE` unchanged,
     `HOST=127.0.0.1`, `PORT=4310`, `AUTO_CANVAS_BASE_PATH=/canvas`,
     `AUTO_CANVAS_AUTH=notebook`, `EDITOR_ROOT` under the temporary root, none
     of the unset names (the test iterates the same list it seeded), argv
     exactly `apps/server/dist/cli.js --require-canvas-database`, cwd the
     resolved root. `AUTO_CANVAS_PORT=4399` gives `PORT=4399`.
   - The stand-in given through `AUTO_CANVAS_NODE`, and, separately, found as
     `node` on a `PATH` the test builds.
   - A parent environment that also holds `database_url=x`, or
     `Database_Url=x` (Node's `spawn` passes such names), or
     `SILICON_NOTEBOOK_ENV_FILE` (with a path, and empty): exit 2, no record
     file, for `serve.sh` and for `init-db.sh`.
   - Each missing or empty required variable (three of them), a relative
     `AUTO_CANVAS_NOTEBOOK_ENV_FILE`, one naming a missing file, one naming a
     directory, a bad port (`0`, `65536`, `80a`, empty), a relative or
     non-executable `AUTO_CANVAS_NODE`, no `node` on `PATH`, a missing
     `cli.js`, a missing `index.html`, a relative `AUTO_CANVAS_LOG_FILE`:
     exit 2, no record file, stderr names the variable or file and contains
     neither connection string.
   - Both markers of the stand-in land in the default log file, and in
     `AUTO_CANVAS_LOG_FILE` when set, appended (a second run keeps the first
     run's lines); neither is on the script's stdout or stderr.
   - Foreground and signal: the pid in the record equals the pid the test
     spawned (the script `exec`s), and SIGTERM to it ends it.
   - The scripts work through a symlinked path to the root.
   - `init-db.sh`: with a temporary notebook root holding an `.env` file → the
     stand-in sees `AUTO_CANVAS_NOTEBOOK_ENV_FILE` equal to the absolute path
     of that file although the parent set another value, `DATABASE_URL` equal
     to `AUTO_CANVAS_DATABASE_URL`, `AUTO_CANVAS_AUTH=local`, none of the libpq
     names although the parent set them, argv
     `apps/server/dist/cli.js --init-empty-database`, cwd the root; a relative
     `--notebook-root` gives an absolute path; an `.env` whose content would
     print or fail if sourced (`echo leaked; exit 7`) changes nothing (no
     `leaked` in the output, the exit status is the stand-in's); missing
     `--notebook-root`, an unknown option, a second positional argument, a
     missing directory, a missing `.env`, an `.env` that is a directory →
     exit 2, no record file; the stand-in's non-zero exit status is the
     script's and no success line is printed.
   - The plugin and the TOML files, with a Python interpreter of version 3.12
     or newer: the test takes `AUTO_CANVAS_TEST_PYTHON` when set, otherwise
     the first of `python3.13`, `python3.12`, `python3` on `PATH` whose
     `sys.version_info >= (3, 12)` (3.11 has `tomllib` but raises no audit
     event when a thread starts), and **fails with a message
     naming that variable when there is none; it does not skip**. The
     subprocess runs with `-B`, `PYTHONPATH` set to a temporary stub directory
     and `plugin/src`, in an empty temporary cwd. The stub is an
     `app/extension_sdk/__init__.py` with a dataclass `ExtensionManifest`
     accepting the fields used and `EXTENSION_API_VERSION = "t164-sentinel"`.
     After the stub and the standard library are imported and before the
     bundle is, the harness installs `sys.addaudithook` and records every
     event named `open` that can write — a string mode containing `w`, `a`,
     `x` or `+`, or, when the mode is `None` (as `os.open` reports it),
     numeric flags with `O_WRONLY`, `O_RDWR`, `O_CREAT`, `O_APPEND` or
     `O_TRUNC` — and every `subprocess.Popen`, `os.system`, `os.fork`,
     `os.exec`, `os.posix_spawn`, `socket.connect`, `socket.bind`,
     `_thread.start_new_thread` and `_thread.start_joinable_thread` (the
     event Python 3.13 raises for `threading.Thread.start`). Then: the import
     succeeds; nothing was
     recorded; the cwd is still empty; the manifest has the id, the display
     name, `trust == "deployment"`, `api_version == "t164-sentinel"`, and the
     four empty tuples; `BUNDLE.register(object())` returns `None`. Three
     controls in the same test, each a throwaway module the harness **does**
     record: one writes a file with `pathlib.Path.write_text`, one with
     `os.open(…, os.O_WRONLY | os.O_CREAT)`, one starts and joins a
     `threading.Thread`. With `tomllib`:
     the managed file equals, key for key, the document of design 7 (plugin
     key, `bundle`, `enabled = true`, `mode`, `cwd`, the exact `command`, the
     exact `healthcheck_url`, the three `env` entries, the `env_from` entry;
     no other key); the external file has the same plugin table and a service
     with exactly `mode = "external"` and that `healthcheck_url`.
8. **`apps/server/src/migration-guard.test.ts`** (vitest, node, real
   PostgreSQL). The `empty` guard looks at the whole database, so these cases
   need databases of their own.
   - Setup: an admin pool on
     `AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test"`. One
     run prefix `auto_canvas_it_<12 hex>`; a helper creates `<prefix>_<n>`
     with `CREATE DATABASE` and adds the name to a list **only after the
     statement succeeded**. `afterAll` closes every pool and server the file
     opened, drops every listed database (`DROP DATABASE … WITH (FORCE)`),
     also after a failed case, and then asserts that no database with one of
     this run's exact names remains. **Investigate first** that the local
     test role may create databases
     (`SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user`);
     if it may not, stop and report. (CI's role may; on the development
     machine it may, measured for the plan.)
   - URLs for those databases: **clone the configured admin URL and replace
     only its database path**, keeping its credentials and endpoint (CI:
     `postgresql://postgres:postgres@localhost:5432/…`). When the admin URL
     has no host (the local lane form `postgresql:///auto_canvas_test_2`), set
     the host to `127.0.0.1` and the user to the admin connection's
     `current_user`, and **prove first** that this URL connects and reports
     the intended `current_database()` (on the development machine it does,
     measured for the plan); if it does not, stop and report.
   - The unflagged hostless case passes a real hostless URL,
     `postgresql:///<name>`, and asserts first that `new URL(…).hostname` is
     empty. Where the admin URL has a host and credentials (CI), the case
     gives them to the connection through `PGHOST`, `PGPORT`, `PGUSER` and
     `PGPASSWORD` set in `process.env` for that case only and restored in a
     `finally`; it then asserts the server reached the intended database
     (the ledger exists there).
   - Per-database settings only: a fixture that needs another `search_path` or
     default isolation sets it with `ALTER DATABASE <its own database> SET …`
     (never `ALTER ROLE`, which would reach other lanes' sessions), opens
     fresh connections and verifies the effective value before the case
     starts.
   - **Pre-pool refusals** assert the error class
     (`GuardedConfigurationError`, or the plain configuration error for flag
     conflicts), a message that names the variable or the two flags, and
     that the injected `createDb` spy was **not called**:
     both flags; each flag with `--migrate`; with each flag, `DATABASE_URL`
     missing, `sqlite:///x`, hostless, or carrying `?dbname=`;
     `AUTO_CANVAS_NOTEBOOK_ENV_FILE` missing, relative, naming a missing file
     or a directory, or naming a file `notebookDatabase` refuses (one such
     file is enough here; the grammar has its own unit tests).
   - **Catalog refusals** assert `MigrationRefused` and its `reason`, that the
     database's relation count (the guard's own emptiness query) is unchanged,
     and that the pool was ended. One invalid condition per fixture:
     - `--require-canvas-database`: an empty database → `no-ledger`; the
       ledger and `cloud_projects` but no `users` → `no-users`; the ledger and
       `users` but no `cloud_projects` → `no-projects`; `users` present only
       as a **view** → `no-users`; fully migrated but the ledger holds a name
       the build does not ship → `ledger-mismatch`; the ledger lacks
       `001-single-user.sql` but has the later names → `ledger-mismatch`; an
       empty ledger → `ledger-mismatch`.
     - Schema: a canvas migrated into schema `b`, the database's
       `search_path` set to `a, b` with an empty schema `a` → `no-ledger`, and
       `a` is still empty; `search_path` naming only a schema that does not
       exist → `no-schema`; `search_path` set to `pg_temp, public` →
       `no-schema`, for both flags.
     - Identity: the notebook `.env` (a file the test writes into a temporary
       directory) names the **same** database, with only the scheme spelling
       changed against the canvas URL (`postgres:` and `postgresql:`) →
       `notebook-database` for `--require-canvas-database` on a valid canvas
       database and for `--init-empty-database` on an empty one (which stays
       empty).
     - `--init-empty-database` on a database that holds, in separate
       fixtures: one table in `public`; one table in another schema; one
       table in a schema named `pgXtemp_data`; one sequence; one view; one
       standalone composite type (`CREATE TYPE t AS (a int)`) → `not-empty`
       each, nothing added.
   - **Accepted starts:**
     - No flag, empty database: migrates and serves as today (the ledger has
       the five names). No flag in `notebook` mode on an empty database: the
       same. No flag with the hostless URL form: still starts (above). No
       flag: `createDb` was called once, with no second argument.
     - `--require-canvas-database` with a notebook `.env` naming another
       database, on a database migrated by a default start: serves;
       `GET /@notebook/canvas/api/integration/ready.json` → 200 in notebook
       mode. With an `.env` holding `sqlite:///x`: serves. On a database
       holding only the first three migrations (applied by the test): serves
       and the ledger then has all five.
     - Pinned schema. The injected `createDb` of these cases is a spy that
       **delegates to the production `createDb` of `db.ts`** with both
       arguments and keeps the pools it returned, so a `db.ts` that dropped
       the hook fails the case. Fixture: schemas `a` and `b` both exist, the
       canvas is migrated in `b`, the database `search_path` is `b, a`.
       After a guarded start: the spy was called twice, the first pool is
       ended, the second call carried a function. The test then sets the
       database default to `a, b`, takes **two** clients from the serving
       pool at the same time (two physical connections, different backend
       pids, both opened after the change) and reads `current_schema()` and
       a canvas table through each: `b`, and the table is found; a request
       through the HTTP server that reads a canvas table succeeds too.
     - A failed pin, inside the production hook: after a guarded start on
       the same kind of fixture and **before any request** (the serving pool
       has opened no connection yet: assert `totalCount === 0` and that the
       pool is not ended), the test renames schema `b` from its own admin
       connection; a checkout from the serving pool rejects with the hook's
       own schema-mismatch error (assert its class or message, so an ended
       pool's rejection cannot pass), and the pool holds no client
       (`totalCount === 0`). The test renames the schema back and a checkout
       from **that same pool** then succeeds and reads `current_schema()`
       as `b`.
     - `--init-empty-database` with an `.env` naming another database:
       migrates, returns `null`, the pool is ended; a following
       `--require-canvas-database` start serves. With an `.env` holding
       `sqlite:///x`: migrates.
   - **Concurrency, synchronised.** A test connection to one empty database
     holds the session-level `pg_advisory_lock(4310, 1)` (advisory locks are
     per database, and a session-level lock conflicts with the migration's
     `pg_advisory_xact_lock(4310, 1)` from another session). The test starts
     two `--init-empty-database` runs on that database, waits — with a bound
     of 10 s, failing the test when it passes — until `pg_locks` shows two
     ungranted advisory waiters for that key in that database, then releases
     with `pg_advisory_unlock`; the holder is released in a `finally` whatever
     happens. Exactly one run migrates and the other is refused with
     `not-empty`; the ledger has each name once. The same once more on a
     database whose default isolation was set to `repeatable read` (with
     `ALTER DATABASE`, verified on a fresh connection first).
   - One case uses a URL with a recognisable password and asserts that no
     error message, and nothing given to `log`, contains it.
9. **Documentation.**
   `integrations/silicon-notebook/README.md`: what the directory is; that it
   needs a silicon-notebook with the `/canvas` rewrite
   (`huyangc/silicon-notebook#1077`), with a link to that repository's
   deployment document; a source deployment step by step (build:
   `pnpm install --frozen-lockfile`, `pnpm build`,
   `pnpm build:notebook-editor`; create the canvas database with its own name
   and, recommended, its own role; `AUTO_CANVAS_DATABASE_URL` in the guarded
   form, in silicon-notebook's `.env`; what the canvas requires of that `.env`
   (the grammar of design 1, in plain words, and that an edit breaking it
   stops the canvas at the next start); `init-db.sh`; install the plugin
   package into silicon-notebook's backend interpreter with `pip install`; the
   managed TOML with an absolute and a configuration-relative `cwd` example,
   and `EXTENSIONS_CONFIG`; silicon-notebook's build variable
   `CANVAS_PROXY_TARGET=http://127.0.0.1:4310`, a bare origin on the port
   `AUTO_CANVAS_PORT` names); every variable `serve.sh` reads, sets and
   removes; where the log is; the external mode and that its launcher must
   give `serve.sh` the same three variables; what the guards establish and
   their limits (the list at the head of the design, including the two
   conditions on the launching environment and the procedure
   for changing silicon-notebook's database: stop both, edit, start both);
   rollback (remove
   the plugin entry and `CANVAS_PROXY_TARGET`, **keep an existing
   `BACKEND_PROXY_TARGET`**, rebuild silicon-notebook, start; what happens
   when only one of the parts is removed); the permanent rule about an origin
   that has served a single-user canvas (link to `docs/specs/server.md`); that
   offline installation is described separately (T167) and that a managed
   start has not yet been run against a real silicon-notebook (T164b).
   `docs/specs/server.md`: the start command, the two flags, the guarded URL
   form, the `.env` grammar and what each guard checks, in the notebook-mode
   section. `docs/testing/README.md`: the three new test files, that
   `migration-guard.test.ts` creates and drops databases `auto_canvas_it_*` on
   the test server, and how the launcher test finds its Python interpreter.

## Acceptance

Run from the repository root; all must pass. Lane 2. Never look at, bind,
contact or signal ports 3000, 8000 or 4310; never run `pnpm start`,
`pnpm stop`, `pnpm dev`, `pnpm restart` or `pnpm test:e2e:local`.

```bash
set -euo pipefail
pnpm install --frozen-lockfile --offline
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321
export AUTO_CANVAS_TEST_PYTHON=/opt/homebrew/bin/python3.13
unset SILICON_NOTEBOOK_ENV_FILE DATABASE_URL PORT HOST AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH EDITOR_ROOT AUTO_CANVAS_DATABASE_URL AUTO_CANVAS_NOTEBOOK_API AUTO_CANVAS_PORT AUTO_CANVAS_NODE AUTO_CANVAS_LOG_FILE AUTO_CANVAS_NOTEBOOK_ENV_FILE AUTO_CANVAS_API_URL FORMAT_BASE_SHA PGDATABASE PGHOST PGPORT PGUSER PGPASSWORD PGSERVICE PGOPTIONS
"$AUTO_CANVAS_TEST_PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'
pnpm build
pnpm exec vitest run apps/server/src/guarded-database.test.ts apps/server/src/migration-guard.test.ts scripts/notebook-launcher.test.mjs
pnpm exec vitest run apps/server/src
pnpm test:local
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm deadcode
bash -n integrations/silicon-notebook/serve.sh
bash -n integrations/silicon-notebook/init-db.sh
test -x integrations/silicon-notebook/serve.sh
test -x integrations/silicon-notebook/init-db.sh
```

Expected: the run of the three new files reports every test passed and **none
skipped**; `pnpm exec vitest run apps/server/src` and `pnpm test:local` report
no failure (the full suite has skips of its own — a Windows-only suite, the
optional simulator tests — which the report lists as they were at the base).
The database test itself asserts that the databases it created are gone.

Behavioral checks, run by the implementer and again by the reviewer, on real
processes, from one script the implementer keeps under `tmp/` (git-ignored)
and quotes in the report. The script: chooses free ports by a bind attempt
(never 3000, 8000, 4310); creates two databases under names with a fresh
random suffix, `auto_canvas_it_manual_<8 hex>_a` and `_b`; installs an `EXIT`
trap **before** the first `CREATE DATABASE` that stops every process it
started (by recorded pid), drops every database it recorded as created,
checks that those exact names are gone, and **exits non-zero** when the
script had failed, when a drop failed or when a name remains (it keeps the
original failure status otherwise); writes three temporary notebook roots,
`nb-good` with an `.env` holding one literal `DATABASE_URL` line naming `_b`,
`nb-bad` whose `.env` holds
`DATABASE_URL="${DATABASE_URL:-sqlite:///x}"`, and `nb-same` whose `.env`
names `_a`; starts a stub `/api/me` on a
free port as the notebook origin. Every expected refusal is an explicit check
of the exit status and of the reason printed, not a command left to fail. The
script is a working file under the git-ignored `tmp/`, outside the owned-path
list; the report carries its full text.

- After `pnpm build:notebook-editor`: `serve.sh` on the empty `_a` exits
  non-zero, the log names `no-ledger`, `_a` has no relation.
- `init-db.sh --notebook-root nb-good` with `AUTO_CANVAS_DATABASE_URL` naming
  `_b`: refused (`notebook-database`), `_b` untouched. Naming `_a`: succeeds;
  a second run is refused (`not-empty`). `init-db.sh --notebook-root nb-bad`
  with `AUTO_CANVAS_DATABASE_URL` naming the still-empty `_b`: refused before
  any connection, naming line 1; `_b` still has no relation.
- `serve.sh` on `_a` with `AUTO_CANVAS_NOTEBOOK_ENV_FILE` naming `nb-bad`'s
  file: refused, the log names line 1, nothing listens.
- `serve.sh` on `_a` with `nb-good`'s file and a parent environment that
  also holds `database_url`: exit 2 before Node starts.
- `serve.sh` on `_a` with `nb-good`'s file and a parent environment that sets
  `DATABASE_URL` to **`_a`** (the inherited value is used for nothing: were
  it compared, this start would be refused) and `PORT` to another free port:
  it listens on its own port only (the parent's `PORT` is never bound);
  `GET /@notebook/canvas/api/integration/ready.json` → 200;
  `GET /@notebook/canvas/` → the notebook editor's HTML; `GET /` → 404;
  `GET /@notebook/canvas/api/projects` with the stub's token → 200, without
  one → 401; `_b` still has no relation. SIGTERM → the process exits within
  15 s and the port is free.
- `serve.sh` on `_a` with `nb-same`'s file: refused (`notebook-database`).
- A standalone server (`AUTO_CANVAS_AUTH` unset and `local`, each with and
  without `AUTO_CANVAS_BASE_PATH=/canvas`, `EDITOR_ROOT` set, on a throwaway
  schema as the existing tests do) answers **404** to
  `GET /@notebook/canvas/api/integration/ready.json` in all four
  configurations.

Reviewer only, in a disposable checkout (it overwrites `apps/editor/dist`),
with the lane's `ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321` and test
database exported: `AUTO_CANVAS_BASE_PATH=/canvas pnpm build`, then
`node scripts/base-path-proxy.mjs --check` passes (the prefixed standalone
deployment is unaffected).

## Notes for the implementer

- Do not add options, environment switches or a "force" path to either
  script, and do not let `serve.sh` initialise a database.
- No new dependency and no lockfile change. `pg` is already a dependency of
  the server; the scripts use only Bash, coreutils and the Node executable.
- Error messages and logs never contain a connection string, a password, a
  token or a value from silicon-notebook's `.env`.
- The Python package is not installed, built or uploaded by any command here;
  the test only imports it from its source directory.
- No LLM API call, no outbound connection, no process killed by name or
  pattern: only pids the test or the check started.
- Do not commit, stash, push or switch branches; `tasks/**` is edited only for
  the report.
- Report: `git status --short`; each acceptance command with its exit status
  and decisive line; the full-suite skips as they were at the base; the
  behavioural check script and its output; the answer to the "Investigate"
  item; evidence from a guarded start that the migration pool was ended and
  the serving pool ran its hook; anything not done or not verified.
