# T164b — Stage M: a managed start inside a silicon-notebook clone, and T164's follow-ups

- Branch: `task/T164b-notebook-managed-start`
- Base: `main` at `9e66529`
- Status: approved (the owner delegated T164b–T167 on 2026-11-24, "一直把之前规划的做完，不要中途停下来"; the scope is stage M of the integration plan v7, approved by the owner on 2026-11-22, and the follow-ups recorded on PR 135)
- Plan review: self-checked against the code (no codex plan review: the workflow runs it only on request)

## Goal

Prove, on real processes, that a silicon-notebook deployment built with the
`/canvas` rewrite and configured with the auto-canvas plugin starts the canvas
as a managed companion service and that two notebook users get separate,
authenticated canvases through the notebook's origin; observe the rollback
and partial-rollback behaviour the T164 README could only infer; and close
the seven non-blocking findings the code review of T164 (PR 135) left open.

Two parts, one branch:

- **Part 1** — seven small fixes to what T164 delivered.
- **Part 2** — a new stage `M` of `scripts/notebook-integration-check.mjs`,
  run on demand like stages T and A (not in CI).

## Context

Facts read in the code; paths in auto-canvas unless marked **SN**
(silicon-notebook at `origin/master`, `b5850d6`, read-only).

**silicon-notebook revisions.** The owner's checkout
`/Users/huzhifeng/workspace/silicon-notebook` has `master` at `f068ec8`, which
does **not** contain the `/canvas` rewrite. `origin/master` (`b5850d6`)
contains it (`dd5729452`, PR 1077) and the proxy-failure log redaction (PR
1078). Stage A resolves `--ref` inside a `git clone` of that checkout, where
`master` and `origin/master` both mean the checkout's local `master`
(`scripts/lib/notebook-integration/stage-a.mjs:207-221`), so stage M is run
with the full SHA of `origin/master` (`git -C <notebook> rev-parse origin/master`);
the implementer verifies first that a bare SHA resolves in the clone
(Investigate, step 8). `frontend/package-lock.json` is the same in `f068ec8`
and `b5850d6`, so the copied `node_modules` fits.

**The integration check** (T160): `scripts/notebook-integration-check.mjs`
(167 lines, stages chosen by if/else: `USAGE` `:28-32`, `parseArgs` `:36-52`,
dispatch `:121-126`, `observeSource` skipped for S `:130-134`, `finish()`
`:82-89`, signal handling `:98-116`) and `scripts/lib/notebook-integration/`:
`sandbox.mjs` (1028), `stage-a.mjs` (1079), `steps.mjs` (626),
`transport.mjs` (448), `self-check.mjs` (1867), `stage-t.mjs` (320),
`modules.mjs` (222), `clone-safety.mjs` (172). Stage A's step A6 already
clones the notebook into the sandbox, copies its `frontend/node_modules`,
builds the frontend, launches it with `npm run start` (SN `scripts/prod.sh`)
and stops it — the path stage M follows:

- Clone, revision and refusals: `stage-a.mjs:187-296`, `clone-safety.mjs`;
  any dotenv file in the clone refuses the stage (`DOTENV_FILES`,
  `stage-a.mjs:37-49`, checked `:258-269`).
- Modules: `prepareModules` (`modules.mjs:29-40`).
- Build: `build()` is a closure in `stageABody` (`stage-a.mjs:357-390`), as
  are `cleanNext` and `refuseUnsafeClone` (`:281`); not exported.
- Launch: `sandbox.start("npm", ["run","start"], …)` with `ALLOW_NO_ENV_FILE=1`,
  `SKIP_INSTALL=1`, `SKIP_BUILD=1`, `PYTHON_BIN=<--python>`, `PORT`,
  `FRONTEND_PORT`, `BACKEND_PROXY_TARGET`, a random
  `SILICON_NOTEBOOK_ADMIN_PASSWORD`, `COLUMNS=1000` (`stage-a.mjs:725-746`);
  readiness through `awaitOwnership` and `proxiedGate` (`:751-960`); stop by
  `sandbox.stopGroup(launcher.pgid)` and `survivingPids` (`:1032-1066`).
- Child environment: `sandbox.env()` (`sandbox.mjs:550-582`) passes only
  `PATH`, a sandboxed `HOME` and `TMPDIR`, the offline guard in
  `NODE_OPTIONS` (loopback and Unix sockets pass, any other host is refused
  and logged; Python is not guarded), npm offline settings, **and
  `SILICON_NOTEBOOK_ENV_FILE=""`** (`:576`).
- Ports: `sandbox.freePort()` never returns 3000, 8000 or 4310
  (`sandbox.mjs:11, 876-890`).
- `rawRequest` (`transport.mjs:38-83`) sends no headers and no body;
  `ownershipGate` covers one listener, `proxiedGate` two.

**silicon-notebook's start and companion services** (SN):

- `scripts/prod.sh`: sources `<root>/.env` with `set -a` when present
  (`:32-54`); `ensure_port_free` on the backend and frontend ports only;
  **`extension_services_start` (`:164`) runs before the backend and the
  frontend**; then prints `backend : … (PID n)` / `frontend : … (PID n)` and
  exits 0.
- `scripts/extension_services.py`: environment from
  `build_python_environment(root)` = `{**dotenv(<root>/.env), **os.environ}`
  with `PYTHONPATH = root/backend + env + file` (`scripts/python_env.py`);
  `EXTENSIONS_CONFIG` empty means no services. It validates the TOML, `cwd`,
  the command, `env_from` sources, and imports the bundles
  (`scripts/check_cli_extensions.py`); state under
  `<root>/.local/run/extensions`. **The supervisor and each service worker
  start with `start_new_session=True`**, outside the launcher's process
  group; the worker sends SIGTERM to its group, sleeps
  `shutdown_timeout_seconds` (default 15 s) and sends SIGKILL. Health:
  `healthcheck_url`, 2xx counts; startup timeout default 60 s. Stop:
  `extension_services.py stop`.
- **`npm run stop` (SN `scripts/stop.sh`) kills whatever listens on `PORT` and
  `FRONTEND_PORT`, default 8000 and 3000 — the owner's servers.** It is never
  run.
- The plugin bundle is found by `importlib` from `PYTHONPATH`; no
  installation is needed (`backend/app/extensions/discovery.py:227-290`).
  silicon-notebook needs Python 3.13 or newer; the interpreter T160 used,
  `/opt/homebrew/Caskroom/miniconda/base/bin/python` (3.14.6), has the
  backend's dependencies.
- Accounts: `POST /api/auth/register` `{username, password}` → `{token, user}`;
  usernames match `^[a-z][0-9]{8}$`; registration is open (refused only under
  SSO); `POST /api/auth/logout` deletes the session row (204), after which
  `/api/me` is 401 at once; `GET /api/me` returns `id`, `display_name`,
  `role`, …; `SILICON_NOTEBOOK_AUTH_OPTIONAL` must stay unset.
- The rewrite (`frontend/next.config.mjs:14-29, 43-55, 95`): a bare loopback
  origin; `/canvas` → `<target>/@notebook/canvas/` and
  `/canvas/:path(<segment regex>)*` → `<target>/@notebook/canvas/:path*`,
  frozen into the routes manifest at build time. Stage A (A2–A6) already
  verifies the rules, the destinations, the refused values and the frozen
  target; stage M does not repeat that. With the target built in and nothing
  listening there, Next's proxy answers **500** (SN
  `frontend/node_modules/next/dist/server/lib/router-utils/proxy-request.js:74-83`).

**The canvas side** (T164): `integrations/silicon-notebook/serve.sh` needs
`AUTO_CANVAS_DATABASE_URL` (guarded form `postgresql://user@host[:port]/name`),
`AUTO_CANVAS_NOTEBOOK_API` (the notebook **backend** origin: the canvas asks
`<origin>/api/me`, `apps/server/src/notebook-identity.ts:214`) and
`AUTO_CANVAS_NOTEBOOK_ENV_FILE` (absolute path of the notebook's `.env`), and
refuses an environment holding `SILICON_NOTEBOOK_ENV_FILE` (even empty) or a
differently-cased `DATABASE_URL`; `init-db.sh --notebook-root <dir>` needs
`<dir>/.env` and an empty database. The `.env` grammar
(`apps/server/src/guarded-database.ts:95-160`) accepts literal `KEY=value`
lines; `DATABASE_URL=sqlite:///.local/silicon_notebook.db`,
`EXTENSIONS_CONFIG=/abs/path.toml`, `PYTHONPATH=/abs/path`,
`AUTO_CANVAS_DATABASE_URL=postgresql://…` all fit. The canvas trusts a
validated token for 60 s (`AUTHORIZATION_WINDOW_MS`,
`notebook-identity.ts:27`). The canvas API (`apps/server/src/projects.ts`,
`app.ts:203-286`): `POST /api/projects` `{name, projectText}` → 201
`{project:{id, revision}}`; `GET /api/projects/:id` scoped by user (another
user gets 404); `PUT /api/projects/:id` with `If-Match: revision-N`;
`GET /api/projects` `{projects, limit}`; no Origin header needed;
`Sec-Fetch-Site: cross-site` is refused; without a bearer every `/api/*` but
the two public probes is 401. Project text:
`serializeProject(createEmptyProject(id, name))` from `@icm/model` and
`@icm/project-protocol` (built `dist`); a script reaches them, and `pg`,
through `createRequire` on `apps/server/package.json` as
`scripts/notebook-e2e-fixture.mjs:32-34` does.

**PostgreSQL on this machine**: 16, on 127.0.0.1:5432, `trust` for
127.0.0.1; the test role may create databases (T164's
`migration-guard.test.ts` creates `auto_canvas_it_<12 hex>_<n>` and drops them
`WITH (FORCE)`, `:37, 86-92, 167-191`).

**T164's open findings** (`tasks/T164-notebook-launcher/review.md`, PR 135
comments): listed in Part 1.

## Part 1 — follow-ups from the code review of T164

1. **The migration writes to the schema the guard checked**
   (`apps/server/src/migrate.ts`). The guard reads `current_schema()` (the
   first _existing_ schema of the `search_path`); a schema another session
   creates ahead of it before the next statement would receive the
   migration's unqualified statements. After the guard returned the schema
   name and before `CREATE TABLE IF NOT EXISTS schema_migrations`, a guarded
   migration runs
   `SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), true)`
   (transaction-local). Without a guard nothing changes. Tests
   (`migration-guard.test.ts`):
   - Order, deterministic: the injected `createDb` wraps the real pool so the
     test records the text of every query the migration connection sends; in
     a guarded start the pinning `set_config(…, true)` comes after the
     guard's `current_schema()` query and before the first `CREATE`; in an
     unguarded start there is none.
   - Effect: database `search_path` `a, b`, schema `a` absent, schema `b`
     holding a canvas migrated up to the second-to-last shipped file; a
     guarded start applies the last one into `b`; afterwards a fresh
     connection still sees the database default `search_path`.
2. **No NUL in decoded credentials** (`apps/server/src/guarded-database.ts`):
   a user name or password decoding to a string with `\u0000` refuses, value
   free. Unit cases for `%00` in each.
3. **The Node executable found on `PATH` is absolute** (`serve.sh`,
   `init-db.sh`): a relative result of `type -P node` is made absolute against
   the directory the script started in, before the script changes to the
   canvas root. Launcher case: `PATH` beginning with `./bin` holding the
   stand-in, started from the directory holding `bin`; the stand-in runs.
4. **An unusable log file is a configuration error** (`serve.sh`): before the
   final `exec`, `if ! : 2>/dev/null >>"$log"; then fail …` with status 2 and a
   message naming `AUTO_CANVAS_LOG_FILE` (or "the default log file") without
   the path. Launcher cases: the variable naming a directory, and an existing
   file without write permission; exit 2, no record file.
5. **README link**: silicon-notebook's deployment document is linked at
   `blob/master/…` (its default branch is `master`).
6. **README rollback order**: stop silicon-notebook (which stops the managed
   canvas) first, then remove the plugin entry and `CANVAS_PROXY_TARGET`,
   rebuild and start. The partial-rollback paragraph states what stage M
   observes (Part 2, M-a and M-b), no longer "inferred".
7. **No fixed migration count** (`migration-guard.test.ts:619`): compare with
   the shipped files the test lists, not the literal 5.

## Part 2 — stage M

### Invocation

```text
node scripts/notebook-integration-check.mjs --stage M --notebook <dir> --ref <full sha> --python <interpreter>
```

`--ref` and `--python` are required for M (as for A; `--base` is not used).
The admin database URL is `AUTO_CANVAS_TEST_DATABASE_URL`, default
`postgresql:///auto_canvas_test` (the same variable the server tests use);
stage M creates its databases there and drops them. The canvas that stage M
runs is **this checkout** (the managed `cwd` is the repository root), so
`pnpm build` and `pnpm build:notebook-editor` must have been run;
stage M refuses with exit 2, before allocating anything, when
`apps/server/dist/cli.js` or `apps/editor/dist-notebook/index.html` is
missing.

### Shared pieces (refactor, behaviour of stages T, A, S unchanged)

- Move `build`, `cleanNext` and `refuseUnsafeClone` out of `stageABody` into a
  module of their own (`scripts/lib/notebook-integration/notebook-clone.mjs`),
  together with the clone/revision/refusal/modules steps A6 and M share
  (stage-a's lines 187–296 and `makeLocal`, `survivingPids`), as functions
  taking `{ sandbox, report, … }`. Stage A calls them; its output lines and
  check names stay the same (acceptance compares stage A's line set before
  and after, see Acceptance).
- `sandbox.env(extra, { envFile: false })`: an option that leaves
  `SILICON_NOTEBOOK_ENV_FILE` out of the child environment (default: as
  today). Stage M uses it for every notebook and canvas process.
- The stage's own dotenv: `refuseUnsafeClone` takes a list of files the stage
  wrote itself, each with the SHA-256 of what it wrote; such a file is
  accepted only while it is a regular file (not a symlink) with that hash;
  any other dotenv still refuses.
- `rawRequest(port, path, method, deadline, { headers, body })`: optional
  request headers and a body (sent with `content-length`); the response keeps
  its current shape and adds the body text. A `tripleGate` (frontend,
  notebook backend, canvas) on the model of `proxiedGate`: each request
  through `/canvas` is sent only when all three listeners are still the
  recorded pids.

### Setup (M0)

1. Refuse early (exit 2) as above; resolve the candidate in the clone
   (`--ref`), clone, check out, run stage A's clone refusals, copy modules
   (reuse).
2. Ports from `freePort()`: `api`, `web`, `canvas` (never 3000, 8000, 4310).
3. Databases: with `pg` (through `createRequire` on `apps/server/package.json`)
   on the admin URL, `CREATE DATABASE auto_canvas_it_m_<12 hex>` (the canvas)
   and `…_s` (the standalone canvas of M-ext); record each name only after it
   was created; drop both `WITH (FORCE)` in the stage's cleanup, also after a
   failure or an interrupt, and report whether they are gone. The guarded
   canvas URL is `postgresql://<current_user>@127.0.0.1:<port>/<name>`, with
   the role from `SELECT current_user` and the port from `SHOW port` on the
   admin connection (`inet_server_port()` is null over a Unix socket, which
   the lane's hostless URL uses); `trust` on loopback, no password. Before
   use, the stage proves this URL connects and reports the intended
   `current_database()`.
4. Files the stage writes (validated writer, recorded with their hashes):
   - `<clone>/.env`, exactly these literal lines:
     `DATABASE_URL=sqlite:///.local/silicon_notebook.db`,
     `AUTO_CANVAS_DATABASE_URL=<guarded url>`,
     `PYTHONPATH=<repo>/integrations/silicon-notebook/plugin/src`,
     `EXTENSIONS_CONFIG=<sandbox>/extensions.toml`,
     `SILICON_NOTEBOOK_ADMIN_PASSWORD=<random hex>`.
     (Refuse with exit 2 if the repository path contains a character the
     `.env` grammar does not accept in an unquoted value.)
   - `<sandbox>/extensions.toml`: the managed example of
     `integrations/silicon-notebook/extensions.example.toml` with
     `cwd = "<repo>"`, `healthcheck_url` on the `canvas` port,
     `env`: `AUTO_CANVAS_NOTEBOOK_API = "http://127.0.0.1:<api>"`,
     `AUTO_CANVAS_NOTEBOOK_ENV_FILE = "<clone>/.env"`,
     `AUTO_CANVAS_PORT = "<canvas>"`,
     `AUTO_CANVAS_LOG_FILE = "<sandbox>/canvas.log"` (never the checkout's
     `.local`), `AUTO_CANVAS_NODE = "<process.execPath>"`;
     `env_from`: `AUTO_CANVAS_DATABASE_URL`; `shutdown_timeout_seconds = 2`.
     The external variant (M-ext): the example's external table with the same
     `healthcheck_url`. The "no plugin" variant: `EXTENSIONS_CONFIG` pointing
     at a file with no table, or the line removed (implementer's choice,
     reported).
5. `init-db.sh --notebook-root <clone>` (run under the sandbox, with
   `AUTO_CANVAS_DATABASE_URL` and `AUTO_CANVAS_NODE`, env without the
   env-file key): exit 0, "initialised"; the canvas database then holds the
   five-name ledger (`pg`).

### Build 1 (M1)

`npm run build` in the clone's `frontend` with
`BACKEND_PROXY_TARGET=http://127.0.0.1:<api>` and
`CANVAS_PROXY_TARGET=http://127.0.0.1:<canvas>` (reuse `build`); the manifest
holds the four rules and every destination is `api` or `canvas`
(`expectDestinations`).

### The managed run (M2–M8)

Launch `npm run start` in the clone (reuse A6's launch, with `.env` present —
no `ALLOW_NO_ENV_FILE` — and the env-file key left out), then:

- **M2 started by silicon-notebook**: the launcher exits 0; within 90 s
  `<clone>/.local/run/extensions/state.json` reports the service ready; the
  `canvas` port is held by a Node process whose command line is
  `… apps/server/dist/cli.js --require-canvas-database` and whose environment
  carried the guard marker (`guardLoaded`); record its pid, its process group
  and the supervisor pid from `state.json`.
- **M3 ready**: `GET /canvas/api/integration/ready.json` through `web` → 200
  `{"ok":true,"mode":"notebook"}` (triple gate).
- **M4 signed out**: `GET /canvas/api/projects` without a bearer → 401; `GET
/canvas` → 200 and the body equals
  `apps/editor/dist-notebook/index.html`.
- **M5 two users**: register `a<8 digits>` and `b<8 digits>` (random) through
  `web` `/api/auth/register`; `/api/me` with each token → 200 with its id.
- **M6 A's project**: through `/canvas/api/projects` with A's bearer: create
  (201), read back (200, same name), save a new revision with `If-Match`
  (200), read again (the new revision and name) — "imports, saves, reopens"
  at API level; the project text is a three-resistor project built with
  `@icm/model` (as `apps/editor/e2e/notebook-fixtures.ts:199-212`).
- **M7 separation**: with B's bearer, `GET /canvas/api/projects/<A's id>` →
  404 and B's list does not contain it; B creates one of its own (201), A's
  list does not contain B's.
- **M8 sign-out**: A `POST /api/auth/logout` → 204; `/api/me` with A's token
  → 401; `/canvas/api/projects` with A's token → 401 within 75 s (polled every
  5 s; the first 401 time reported); B's token still → 200 afterwards.
- **M9 stop**: stop the launcher's group (backend, frontend) as A6 does, then
  `"$PYTHON" <clone>/scripts/extension_services.py stop` with the clone's
  environment (bounded, 40 s); within 10 s after it: the recorded supervisor,
  the canvas pid and its group are gone, and the `api`, `web` and `canvas`
  ports have no listener. **Never `npm run stop`.**

### External mode and a misrouted upstream (M-ext)

Same build. The stage starts the canvas itself with `serve.sh` (sandbox
supervised, same environment as the managed service) on `canvas`; the
notebook is launched with the external TOML → ready (state reports ready
without a worker of its own); `/canvas/api/projects` with a fresh user's
token → 200. Then the stage stops its canvas, checks the `canvas` port is
vacant, and starts a **standalone** canvas there instead
(`AUTO_CANVAS_AUTH=local`, no base path, `EDITOR_ROOT=apps/editor/dist`,
database `…_s`, migrated by its own start) with one project it seeds through
its own API (as `apps/server/src/app.test.ts` does, `Origin` header
included). Through the notebook, with that user's token and without, the raw
requests `GET /canvas`, `/canvas/api/projects`, `/canvas/api/auth/me`,
`/canvas/../api/projects`, `/canvas/%2e%2e/api/projects`: none answers 200
with JSON, and no body contains the seeded project's id or name or the
standalone user's name. Stop all (M9's checks).

### Partial and full rollback (M-a, build 2, M-b, M-full)

- **M-a** (plugin entry removed, build still has the target): same build,
  "no plugin" configuration, the `canvas` port checked vacant immediately
  before each request: `GET /canvas` and `/canvas/api/projects` → 500;
  `GET /api/health` without a session → 401 (the notebook itself works);
  no canvas process exists. Stop.
- **Build 2**: rebuild without `CANVAS_PROXY_TARGET` (`BACKEND_PROXY_TARGET`
  kept); the manifest has today's two rules only.
- **M-b** (plugin kept, build without the target): managed configuration →
  the canvas starts and its ready probe on `canvas` answers 200 directly, but
  `GET /canvas` through `web` → 404. Stop (M9's checks).
- **M-full** (both removed): "no plugin" configuration → `GET /canvas` → 404,
  `GET /` → 200, no canvas process. Stop.

### Cleanup and interrupts

In the stage's `finally`, in this order, each step bounded and reported:
`extension_services.py stop` with the clone's environment (when a launch
happened); stop any process group the stage started; for every recorded
companion pid (supervisor, worker, canvas) still alive after that, SIGTERM
then SIGKILL **by pid** (they were started by this run and recorded; never by
name); drop the databases. An interrupt (SIGINT/SIGTERM to the check) runs the
same cleanup and exits 130, as the other stages do. Stage S gains controls for
the new shared pieces (below).

### Stage S controls (new)

- `sandbox.env(…, { envFile: false })` leaves the key out; the default keeps
  it.
- The stage's own `.env` is accepted with its recorded hash; replaced by a
  symlink, or with one byte changed, it refuses; another dotenv file still
  refuses.
- `rawRequest` with headers and a body, against a local stub: method, headers,
  body and `content-length` arrive as sent.
- `tripleGate` sends nothing when any one of three listeners is not the
  recorded pid.

## Scope

Owned paths:

- Part 1: `apps/server/src/migrate.ts`, `apps/server/src/guarded-database.ts`,
  `apps/server/src/guarded-database.test.ts`,
  `apps/server/src/migration-guard.test.ts`,
  `integrations/silicon-notebook/serve.sh`,
  `integrations/silicon-notebook/init-db.sh`,
  `integrations/silicon-notebook/README.md`,
  `scripts/notebook-launcher.test.mjs`.
- Part 2: `scripts/notebook-integration-check.mjs`,
  `scripts/lib/notebook-integration/*.mjs` (existing files and new ones:
  `stage-m.mjs`, `notebook-clone.mjs`), `docs/testing/README.md` (stage M,
  how to run it, what it needs),
  `docs/specs/server.md` only to link stage M from the companion-service
  section.
- `tasks/T164b-notebook-managed-start/report.md`.

Out of scope: product code other than the two Part 1 server files; the
editor; `packages/**`; `package.json`, the lockfile; silicon-notebook (its
checkout is never written to, its `.env`, `.local` and databases are never
opened, nothing is started there); the entry link (T165); packaging (T166,
T167).

## Steps

1. Part 1, items 1–7, with their tests.
2. Refactor: `notebook-clone.mjs` with the shared clone/build pieces; stage A
   calls them. Run stage A before and after (Acceptance) and compare.
3. `sandbox.env` option, the recorded-dotenv acceptance in
   `refuseUnsafeClone`, `rawRequest` headers/body, `tripleGate`; stage S
   controls for each.
4. `stage-m.mjs`: setup, build 1, managed run, M-ext, M-a, build 2, M-b,
   M-full, cleanup; wire `--stage M` into the entry script (usage, argument
   checks, dispatch, the summary).
5. Documentation: `docs/testing/README.md` (stage M: command, prerequisites —
   the two canvas builds, a Python 3.13+ with silicon-notebook's backend
   dependencies, a PostgreSQL role that may create databases — what it
   proves, how long it takes, how it cleans up); the README's rollback text
   from what M-a and M-b observed.
6. Investigate, before step 4, and report: (a) whether silicon-notebook's
   backend settings accept the extra `.env` keys the stage writes
   (`AUTO_CANVAS_DATABASE_URL`, `PYTHONPATH`, `EXTENSIONS_CONFIG`) — read
   the `model_config` of SN `backend/app/core/config.py` (`extra=`); if it
   forbids unknown keys, stop and report; (b) whether a bare full SHA resolves as `--ref` in
   the clone (`git clone --no-hardlinks` of a local checkout copies all
   objects, but `origin/master`'s commits may only be reachable from a
   remote-tracking ref the clone does not keep); if not, stage M resolves the
   candidate as stage A does but also fetches the source's
   `refs/remotes/origin/*` into the clone (`git fetch <source>
'refs/remotes/origin/*:refs/remotes/source/*'`) — report which.

## Acceptance

Lane 2 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`).
Never look at, bind, contact or signal ports 3000, 8000, 4310; never run
`pnpm start`, `pnpm stop`, `pnpm dev`, `pnpm restart`, `pnpm test:e2e:local`,
or silicon-notebook's `npm run stop`; never kill by name or pattern.

```bash
set -euo pipefail
NB=/Users/huzhifeng/workspace/silicon-notebook
PY=/opt/homebrew/Caskroom/miniconda/base/bin/python
REF=$(git -C "$NB" rev-parse origin/master)            # b5850d6…
BASE=d3388036b
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 AUTO_CANVAS_TEST_PYTHON=/opt/homebrew/bin/python3.13
unset SILICON_NOTEBOOK_ENV_FILE DATABASE_URL PORT HOST AUTO_CANVAS_AUTH AUTO_CANVAS_API_URL
mkdir -p tmp/t164b
pnpm install --frozen-lockfile --offline
pnpm build
pnpm build:notebook-editor
for p in 3000 8000 4310; do echo "$p $(lsof -ti tcp:$p -sTCP:LISTEN | tr '\n' ' ')"; done > tmp/t164b/owner-before.txt
git -C "$NB" status --short > tmp/t164b/nb-before.txt
pnpm exec vitest run apps/server/src/guarded-database.test.ts apps/server/src/migration-guard.test.ts scripts/notebook-launcher.test.mjs   # all pass, none skipped
pnpm test:local                                                                  # no failure
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm deadcode
node scripts/notebook-integration-check.mjs --stage S --notebook "$NB"          # exit 0, every control ok
node scripts/notebook-integration-check.mjs --stage T --notebook "$NB"          # exit 0
node scripts/notebook-integration-check.mjs --stage A --notebook "$NB" --ref "$REF" --base "$BASE" --python "$PY" > tmp/t164b/A-after.out 2>&1   # exit 0
node scripts/notebook-integration-check.mjs --stage M --notebook "$NB" --ref "$REF" --python "$PY" > tmp/t164b/M.out 2>&1                     # exit 0
for p in 3000 8000 4310; do echo "$p $(lsof -ti tcp:$p -sTCP:LISTEN | tr '\n' ' ')"; done | diff tmp/t164b/owner-before.txt -
git -C "$NB" status --short | diff tmp/t164b/nb-before.txt -
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE left(datname, 15) = 'auto_canvas_it_'"   # 0
```

Also:

- Stage A's line set: run stage A (same arguments) **before** step 2 and keep
  its output as `tmp/t164b/A-before.out`, and again on the final tree; the
  `ok`/`FAIL`/`note` lines, with port numbers, pids, hashes and paths
  normalised, are the same set (report the diff and the normaliser).
- Interrupt: start stage M, send SIGINT to the check once the managed canvas
  is ready (the stage prints a line saying so), → exit 130 within 60 s; no
  supervisor, worker or canvas pid recorded by that run is alive; no
  `auto_canvas_it_m_` database remains; the sandbox is gone.
- The report quotes stage M's full output and its timing.

## Notes for the implementer

- Everything silicon-notebook runs is the clone in the sandbox; the owner's
  checkout is read only through `git clone` and the module copy, as stages A
  and T do.
- The companion processes leave the launcher's process group by design
  (`start_new_session`); the stage must stop them through
  `extension_services.py stop` and by recorded pid, never by port or name.
- Requests that go through `/canvas` use the triple gate; requests to the
  notebook's own API use `proxiedGate`.
- Tokens, passwords and the database URL never appear in the check's output.
- No new dependency, no lockfile change, no LLM API call; the offline guard
  stays on for every Node child.
- Do not commit, stash, push, merge, rebase or switch branches.
- Report: `git status --short`; per step what was done and where; each
  acceptance command with exit status and decisive output; stage M's full
  output; the interrupt run; the stage-A comparison; the Investigate answer;
  deviations; anything not done or not verified.
