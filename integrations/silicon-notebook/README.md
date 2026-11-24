# auto-canvas as a silicon-notebook companion service

This directory holds what a silicon-notebook deployment needs to run the
canvas beside it, under silicon-notebook's `/canvas` path:

- `serve.sh` — the foreground start command silicon-notebook's service
  manager runs (or an operator runs, in the external mode);
- `init-db.sh` — the one-time initialisation of the canvas database;
- `plugin/` — the Python plugin package `silicon-notebook-auto-canvas`
  (bundle `silicon_notebook_auto_canvas.bundle:BUNDLE`, id
  `auto_canvas.integration`). It has no contributions yet; it exists so that
  the extensions TOML can declare the canvas as the plugin's service;
- `extensions.example.toml` (managed mode) and
  `extensions.external.example.toml` (external mode).

It needs a silicon-notebook that has the `/canvas` rewrite
([huyangc/silicon-notebook#1077](https://github.com/huyangc/silicon-notebook/pull/1077),
merged 2026-11-23); see that repository's deployment document,
[`docs/deployment-and-configuration_zh.md`](https://github.com/huyangc/silicon-notebook/blob/main/docs/deployment-and-configuration_zh.md).
How the server behaves in this mode, the start flags and the database guards
are specified in [docs/specs/server.md](../../docs/specs/server.md#running-as-a-silicon-notebook-companion-service).

Not yet covered: an offline installation is described separately (T167), and
a managed start has not yet been run against a real silicon-notebook (T164b).

## Source deployment, step by step

1. **Build the canvas** in its own directory, outside silicon-notebook's (for
   example `/opt/auto-canvas`):

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   pnpm build:notebook-editor
   ```

   `serve.sh` refuses to start without `apps/server/dist/cli.js` (made by
   `pnpm build`) or `apps/editor/dist-notebook/index.html` (made by
   `pnpm build:notebook-editor`). Nothing is installed or built at start.

2. **Create the canvas database** on the PostgreSQL server, with a name of its
   own (not silicon-notebook's database) and, recommended, a role of its own
   that cannot reach silicon-notebook's database:

   ```sql
   CREATE ROLE auto_canvas LOGIN PASSWORD '…';
   CREATE DATABASE auto_canvas OWNER auto_canvas;
   ```

   A new role can still connect to silicon-notebook's database: PostgreSQL
   grants `CONNECT` on every database to `PUBLIC` by default. To make the
   separation real, take that away on silicon-notebook's database and give
   it back to the roles that need it (silicon-notebook's own role first, or
   it locks itself out), then check it:

   ```sql
   REVOKE CONNECT ON DATABASE silicon_notebook FROM PUBLIC;
   GRANT CONNECT ON DATABASE silicon_notebook TO silicon_app;
   SELECT has_database_privilege('auto_canvas', 'silicon_notebook', 'CONNECT');  -- f
   ```

   (`silicon_notebook` and `silicon_app` are the names of
   silicon-notebook's `.env.example`; use the deployment's own. A superuser
   or the database's owner can always connect, and `pg_hba.conf` may
   restrict access further.) Without this, or an equivalent existing
   policy, the separation rests on the guards below alone.

3. **Name it in silicon-notebook's `.env`** as `AUTO_CANVAS_DATABASE_URL`, in
   the guarded form: `postgresql://` (or `postgres://`), an optional
   `user[:password]@`, a host (a name, an IPv4 address or a bracketed IPv6
   address), an optional port, `/` and a database name of at most 63 letters,
   digits, `_` or `-`; no `?…` parameters, no `#`, no percent-encoding in the
   host or the name. A socket directory (`postgresql:///name`, `?host=/tmp`)
   is refused.

   ```bash
   AUTO_CANVAS_DATABASE_URL=postgresql://auto_canvas:…@127.0.0.1:5432/auto_canvas
   ```

4. **Keep silicon-notebook's `.env` readable without a shell.** The canvas
   reads that file at every start to learn which database silicon-notebook
   uses, and refuses to start when it cannot tell for sure. In plain words,
   every line must be blank, a comment starting with `#`, or
   `KEY=value` (optionally preceded by `export` and blanks), where the value
   is a literal: empty, a word without spaces and without
   ``$ ` \ " ' ; & | < > ( ) { } * ? [ ] ~ # !``, `'…'` without a `'`
   inside, or `"…"` without ``$ ` \ "`` inside. No variable expansions
   (`${…}`, `$OTHER`), no command substitutions, no `if`, `source` or other
   commands, no values spanning two lines, no carriage returns (Windows line
   ends), no trailing comments after a value. Exactly one line assigns
   `DATABASE_URL` (no second one, no `database_url` in another case), and its
   value is `sqlite:///<path>` or a PostgreSQL URL in the guarded form above.
   The file must not set `SILICON_NOTEBOOK_ENV_FILE` or a variable Bash treats
   specially (`IFS`, `OPTIND`, `BASH_ENV`, `HIST…`, `PS1`, …). silicon-notebook's
   own `.env.example` fits. **An edit that breaks one of these rules stops the
   canvas at its next start**; the line number is in the canvas log.

5. **Initialise the canvas database once**, from the canvas directory, with
   the canvas URL in the environment and silicon-notebook's directory named:

   ```bash
   AUTO_CANVAS_DATABASE_URL='postgresql://auto_canvas:…@127.0.0.1:5432/auto_canvas' \
     ./integrations/silicon-notebook/init-db.sh --notebook-root /opt/silicon-notebook
   ```

   It takes exactly the option `--notebook-root <dir>`; `<dir>/.env` must be a
   regular file, which the script itself never reads, sources or prints (the
   server checks it as text). It refuses a database that holds any table,
   view, sequence or other relation outside the system schemas
   (`not-empty`), or that is the database silicon-notebook's `.env` names
   (`notebook-database`). Output goes to the terminal; on success it prints
   that the database is initialised. `serve.sh` never initialises a database.

6. **Install the plugin package** into the Python interpreter silicon-notebook's
   backend runs on:

   ```bash
   "$PYTHON_BIN" -m pip install /opt/auto-canvas/integrations/silicon-notebook/plugin
   ```

7. **Declare the service** in silicon-notebook's extensions TOML, starting
   from [`extensions.example.toml`](extensions.example.toml), and point
   `EXTENSIONS_CONFIG` at that file in the environment silicon-notebook is
   built and started from. `cwd` is the canvas directory: an absolute path
   (`cwd = "/opt/auto-canvas"`) or one relative to the TOML file
   (`cwd = "../auto-canvas"` for a TOML in `/opt/silicon-notebook-config/`).
   The example passes the notebook API origin, the absolute path of
   silicon-notebook's `.env` and the port in `env`, and the canvas URL from
   silicon-notebook's environment in `env_from`. `healthcheck_url` is the
   readiness probe on the canvas port:
   `http://127.0.0.1:4310/@notebook/canvas/api/integration/ready.json`.

8. **Build silicon-notebook with `CANVAS_PROXY_TARGET`**, a bare loopback
   origin on the port `AUTO_CANVAS_PORT` names, for example
   `CANVAS_PROXY_TARGET=http://127.0.0.1:4310` (no path: silicon-notebook
   appends `/@notebook/canvas…` itself, and a value with a path fails its
   build). Then start silicon-notebook with its own start scripts; it starts
   the canvas.

## What `serve.sh` reads, sets and removes

Reads (each failure exits with status 2 and one line on stderr naming the
variable or file, never a value):

| Variable                        | Meaning                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `AUTO_CANVAS_DATABASE_URL`      | Required. The canvas database, in the guarded form.                                       |
| `AUTO_CANVAS_NOTEBOOK_API`      | Required. silicon-notebook's API origin on loopback, for example `http://127.0.0.1:8000`. |
| `AUTO_CANVAS_NOTEBOOK_ENV_FILE` | Required. Absolute path of silicon-notebook's `.env`.                                     |
| `AUTO_CANVAS_PORT`              | Optional, 1–65535, default `4310`.                                                        |
| `AUTO_CANVAS_NODE`              | Optional. Absolute path of the Node executable; otherwise `node` on `PATH`.               |
| `AUTO_CANVAS_LOG_FILE`          | Optional. Absolute path of the log file.                                                  |

It refuses to start when the environment holds a differently-cased spelling of
`DATABASE_URL` (`database_url`, `Database_Url`, …) or any
`SILICON_NOTEBOOK_ENV_FILE`, even an empty one.

Sets, for the server only: `DATABASE_URL` to `AUTO_CANVAS_DATABASE_URL` (the
inherited `DATABASE_URL` is silicon-notebook's and is used for nothing),
`HOST=127.0.0.1`, `PORT`, `AUTO_CANVAS_BASE_PATH=/canvas`,
`AUTO_CANVAS_AUTH=notebook`, `EDITOR_ROOT=<canvas>/apps/editor/dist-notebook`.

Removes: `AGENT_ALLOWED_ORIGIN`, `AGENT_SESSION`, `AUTO_CANVAS_USER_NAME`,
`ANALOG_CANVAS_API_URL`, and libpq's `PGDATABASE`, `PGHOST`, `PGHOSTADDR`,
`PGPORT`, `PGUSER`, `PGPASSWORD`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`
(inherited from silicon-notebook; `PGPASSFILE` and `PGSSL*` stay).

Then it runs, from the canvas directory and in the foreground,
`node apps/server/dist/cli.js --require-canvas-database` in place of itself, so
SIGTERM reaches the server. There is no option for another mode, another host
or an unguarded start. `init-db.sh` makes the same environment checks (without
`AUTO_CANVAS_NOTEBOOK_API`), unsets the same libpq variables and runs the
server with `AUTO_CANVAS_AUTH=local` and `--init-empty-database`.

**The log.** silicon-notebook discards a service's output, so the server's
output is appended to `AUTO_CANVAS_LOG_FILE`, by default
`<canvas>/.local/logs/notebook-canvas.log`. A refused start (for example
`no-ledger` on an uninitialised database, or a `.env` line the canvas cannot
read) is explained there.

## External mode

With [`extensions.external.example.toml`](extensions.external.example.toml)
silicon-notebook only checks the canvas's health; the operator starts and
stops the same `serve.sh` with the same three required variables
(`AUTO_CANVAS_DATABASE_URL`, `AUTO_CANVAS_NOTEBOOK_API`,
`AUTO_CANVAS_NOTEBOOK_ENV_FILE`). That launcher must meet the same conditions
on its environment as silicon-notebook's start (below).

## What the guards establish, and their limits

The canvas initialises only a database that holds no relation in any
non-system schema (functions and types without a relation are not looked at)
and whose name differs from the database silicon-notebook's `.env` names. It
serves only a database that holds the canvas ledger and tables in the schema
it writes to and whose name differs likewise; every serving connection is
pinned to that schema. The limits:

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
  same revision of the file. To change silicon-notebook's database: stop
  both, edit the `.env`, start both. Restarting only one of them after such an
  edit is not supported.
- None of this replaces giving the canvas its own PostgreSQL role.

## Rollback

1. Remove the `[extensions."auto_canvas.integration"…]` tables from the
   extensions TOML (or the whole file from `EXTENSIONS_CONFIG` when it held
   nothing else) and remove `CANVAS_PROXY_TARGET` from silicon-notebook's
   build environment. **Keep an existing `BACKEND_PROXY_TARGET`**: it is
   silicon-notebook's own API rewrite.
2. Rebuild silicon-notebook and start it.
3. Optionally uninstall the plugin package (`pip uninstall
silicon-notebook-auto-canvas`). The canvas database is left as it is.

Removing only one part: without the TOML entry but with
`CANVAS_PROXY_TARGET`, silicon-notebook still rewrites `/canvas` to a port
nothing serves any more, so the canvas pages fail to load; with the entry but
without `CANVAS_PROXY_TARGET`, silicon-notebook keeps starting the canvas but
no longer routes `/canvas` to it, so the canvas runs unreachable. (Inferred
from the two settings' roles; not yet observed against a real
silicon-notebook, T164b.)

## An origin that has served a single-user canvas

An origin that has ever served a single-user (standalone) canvas, at its root
or at `/canvas/`, must not serve the notebook canvas until its users have
exported their unsaved work and cleared the origin's site data. This rule is
permanent; see
[the editor in notebook mode](../../docs/specs/server.md#the-editor-in-notebook-mode).
