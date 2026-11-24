# auto-canvas as a silicon-notebook companion service

This directory holds what a silicon-notebook deployment needs to run the
canvas beside it, under silicon-notebook's `/canvas` path:

- `serve.sh` — the foreground start command silicon-notebook's service
  manager runs (or an operator runs, in the external mode);
- `init-db.sh` — the one-time initialisation of the canvas database;
- `plugin/` — the Python plugin package `silicon-notebook-auto-canvas`
  (bundle `silicon_notebook_auto_canvas.bundle:BUNDLE`, id
  `auto_canvas.integration`, version 0.2.0). It has no backend
  contributions; the extensions TOML declares the canvas as its service, and
  it provides the capability `auto_canvas.integration.available` (always
  available, decided without I/O) that the workspace entry is gated on;
- `ui/auto-canvas/` — the UI package of that entry: the side-panel button
  **打开电路画布** ([below](#the-entry-link-in-a-notebook));
- `extensions.example.toml` (managed mode) and
  `extensions.external.example.toml` (external mode).

It needs a silicon-notebook that has the `/canvas` rewrite
([huyangc/silicon-notebook#1077](https://github.com/huyangc/silicon-notebook/pull/1077),
merged 2026-11-23); see that repository's deployment document,
[`docs/deployment-and-configuration_zh.md`](https://github.com/huyangc/silicon-notebook/blob/master/docs/deployment-and-configuration_zh.md).
How the server behaves in this mode, the start flags and the database guards
are specified in [docs/specs/server.md](../../docs/specs/server.md#running-as-a-silicon-notebook-companion-service).

Not yet covered: an offline installation is described separately (T167). A
managed start against a real silicon-notebook clone is checked by stage M of
the [integration check](../../docs/testing/README.md#stage-m-a-managed-start-in-a-silicon-notebook-clone),
the entry link in a browser by [stage L](../../docs/testing/README.md#stage-l-the-entry-link-in-a-browser).

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

## The entry link in a notebook

The UI package [`ui/auto-canvas/`](ui/auto-canvas) adds one button,
**打开电路画布**, to silicon-notebook's workspace side panel: a signed-in user
who opens a notebook sees it in the Sources panel's tool row (beside
补全论文信息), and its click takes them to `/canvas`, where the canvas editor
opens as that same user. Nothing of the notebook or its sources is passed to
the canvas. silicon-notebook shows the button only to users who may read the
notebook, and only while its backend reports the plugin's entry available:
with the plugin package installed and configured as in steps 6 and 7. The
two halves are matched by plugin id, version and entry id: build with the UI
package of the same checkout whose plugin package is installed (both 0.2.0);
after an upgrade, reinstall the plugin and rebuild, or the button does not
render.

The package is built into silicon-notebook's frontend, never loaded at run
time. Add its absolute path to `SILICON_NOTEBOOK_UI_PLUGINS` in step 8's
build environment. The variable is a `:`-separated list of UI packages: when
it already names others, append the canvas's path and keep them; otherwise
set it to the path alone.

```bash
CANVAS_UI=/opt/auto-canvas/integrations/silicon-notebook/ui/auto-canvas
export SILICON_NOTEBOOK_UI_PLUGINS="${SILICON_NOTEBOOK_UI_PLUGINS:+$SILICON_NOTEBOOK_UI_PLUGINS:}$CANVAS_UI"
```

silicon-notebook's `npm run build` copies the package to
`frontend/features/ext-auto-canvas/` (with a `.ui-plugin-origin` marker),
writes `frontend/features/extension-sdk/registry.local.ts` and its contract
`frontend/.local/ui-extension-contract.json`; none of them is committed.
silicon-notebook's own checks of a plugin (its node test lane,
`scripts/check_ui_vocabulary.py`, `npm run typecheck` with the variable set,
`scripts/cli.sh extensions check` and `scripts/check_deployment_extension_parity.py`)
pass on it; stage L of the integration check runs them in a clone. The
browser bundle's `NEXT_PUBLIC_API_BASE_URL` must be the same-origin `/api`
(silicon-notebook's documented proxied deployment), as for any build behind
`BACKEND_PROXY_TARGET`.

To remove the entry, take only the canvas's path out of
`SILICON_NOTEBOOK_UI_PLUGINS` and rebuild silicon-notebook; the other UI
packages the list names stay. Unset the variable only when the canvas's path
was its only entry. The snippet also runs under `set -euo pipefail` (grep's
status 1, "nothing left", is not an error there; its real errors still are):

```bash
CANVAS_UI=/opt/auto-canvas/integrations/silicon-notebook/ui/auto-canvas
rest=$(printf '%s' "${SILICON_NOTEBOOK_UI_PLUGINS-}" | tr ':' '\n' | { grep -vxF "$CANVAS_UI" || [ $? -eq 1 ]; } | paste -sd: -)
if [ -n "$rest" ]; then export SILICON_NOTEBOOK_UI_PLUGINS="$rest"; else unset SILICON_NOTEBOOK_UI_PLUGINS; fi
```

The build deletes `ext-auto-canvas` and writes the registry without it (the
empty registry when no package is left), and the button is gone while the canvas, the plugin and
`/canvas` stay as they were. The [rollback](#rollback) below removes it with
everything else.

## Offline package

For a site without network or package manager, a build machine with a
checkout makes one self-contained package:

```bash
AUTO_CANVAS_PACKAGE_PYTHON=/path/to/python pnpm notebook:package
```

It runs `pnpm build` and `pnpm build:notebook-editor`, then
`scripts/package-notebook-canvas.mjs`, which writes
`output/notebook-canvas/auto-canvas-notebook-<version>/` and the tarball
`auto-canvas-notebook-<version>.tar.gz` of it (`<version>` is the root
version and the commit, `-dirty` for a changed working tree; the tarball is
deterministic: sorted entries, owner root, the commit time as every mtime).
`AUTO_CANVAS_PACKAGE_PYTHON` names a Python with pip and setuptools 68 or
newer, which builds the plugin wheel offline (`pip wheel --no-index`).
`--out <dir>` (after the command) writes elsewhere.

The package keeps this checkout's paths, so the launchers run unchanged:

- `apps/server/dist/cli.js` — the server bundled into one module with every
  dependency (pure JavaScript; `pg-native`, `bufferutil` and `utf-8-validate`
  stay optional, as in a checkout), with `apps/server/dist/migrations/` and
  `apps/server/package.json`;
- `apps/editor/dist-notebook/` — the notebook build of the editor;
- `integrations/silicon-notebook/` — `serve.sh`, `init-db.sh`, this file
  and the two TOML examples (and `ui/` once it exists);
- `wheels/silicon_notebook_auto_canvas-<version>-py3-none-any.whl` — the
  plugin, installed instead of the `plugin/` directory of step 6;
- `env.example` — the `AUTO_CANVAS_DATABASE_URL` line for silicon-notebook's
  `.env`; `VERSION`; `THIRD-PARTY-NOTICES.txt` — the licences of the
  packages bundled into the server.

Node is not shipped: the site runs the package with silicon-notebook's own
Node, named by `AUTO_CANVAS_NODE`. The offline installation steps at a site
are described separately (T167). `node scripts/package-notebook-canvas-check.mjs`
proves a built package in an empty directory (see
[docs/testing/README.md](../../docs/testing/README.md#local-validation)).

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

1. Stop silicon-notebook with its own stop command; that also stops the
   canvas it manages. (In the external mode, stop the canvas as the operator
   started it.)
2. Remove the `[extensions."auto_canvas.integration"…]` tables from the
   extensions TOML (or the whole file from `EXTENSIONS_CONFIG` when it held
   nothing else), remove `CANVAS_PROXY_TARGET` from silicon-notebook's
   build environment, and take the canvas's path out of
   `SILICON_NOTEBOOK_UI_PLUGINS` as in
   [the entry link](#the-entry-link-in-a-notebook) (other UI packages stay;
   the variable goes only when the canvas's path was its only entry).
   **Keep an existing `BACKEND_PROXY_TARGET`**: it is silicon-notebook's own
   API rewrite.
3. Rebuild silicon-notebook and start it.
4. Optionally uninstall the plugin package (`pip uninstall
silicon-notebook-auto-canvas`). The canvas database is left as it is.

Removing only one part, as observed against a real silicon-notebook (stage M
of the [integration check](../../docs/testing/README.md#stage-m-a-managed-start-in-a-silicon-notebook-clone)):

- Without the TOML entry but with `CANVAS_PROXY_TARGET` in the build,
  silicon-notebook starts no canvas and still rewrites `/canvas` to the port
  nothing serves any more: `/canvas` and `/canvas/api/…` answer 500, while
  silicon-notebook itself works.
- With the entry but a build without `CANVAS_PROXY_TARGET`, silicon-notebook
  keeps starting the canvas, which answers on its own port, but `/canvas`
  answers 404: the canvas runs unreachable.

With both removed, `/canvas` answers 404 and no canvas process runs.

## An origin that has served a single-user canvas

An origin that has ever served a single-user (standalone) canvas, at its root
or at `/canvas/`, must not serve the notebook canvas until its users have
exported their unsaved work and cleared the origin's site data. This rule is
permanent; see
[the editor in notebook mode](../../docs/specs/server.md#the-editor-in-notebook-mode).
