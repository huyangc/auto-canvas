# T167 — Paired offline deployment: instructions and stage P

- Branch: `task/T167-notebook-offline-pair`
- Base: `main` at `7dc9821`
- Status: approved (the owner delegated T164b–T167 on 2026-11-24; the scope is
  work package W8 of the integration plan v7, approved 2026-11-22; Q5 approved
  that stage P may download portable Node and wheels)
- Plan review: self-checked against the code (no codex plan review: the
  workflow runs it only on request)
- Implementer: Codex `gpt-6.2-astra` (hard: a new end-to-end stage with
  packing, offline install, upgrade and rollback; the owner's routing of
  2026-11-25)

## Goal

An operator with a build machine (network) and an offline site (no network,
no package manager, no checkout) can follow one section of
`integrations/silicon-notebook/README.md` to install silicon-notebook's
offline package together with the canvas's offline package, upgrade
silicon-notebook without losing the canvas, and switch back to a default
silicon-notebook package. A new stage `P` of the integration check performs
exactly those commands on a disposable clone and temporary directories, and
proves each state works. The four T165 follow-ups (PR 143 round 4) are fixed; the five T166 follow-ups are T180.

## Context

**silicon-notebook's offline packaging** (SN = `origin/master` `b5850d6`):

- `scripts/pack.sh` (build machine): env-only inputs `VERSION` (default
  `<date>-<sha>`), `OUT_DIR` (default `<repo>/dist`; it `rm -rf`s
  `$OUT_DIR/stage`), `NODE_VERSION` (follows `node -v`, major 26 required),
  `NODE_DIST_URL`, `NODE_TARBALL`, `SKIP_WHEELHOUSE`, `PACK_PYTHON` (its minor
  version must equal the site's), `PIP_INDEX_URL`. `CANVAS_PROXY_TARGET`,
  `SILICON_NOTEBOOK_UI_PLUGINS` and **`BACKEND_PROXY_TARGET`** pass through
  to `npm run build` and are **baked into the package** (the backend rewrite
  defaults to `127.0.0.1:8000`). It needs a git toplevel with full history
  (release manifest), runs `npm ci` and `next build` in `<repo>/frontend`
  (writes into its source tree), downloads portable Node (nodejs.org, cached
  in `$OUT_DIR`), builds the wheelhouse from PyPI (`pip wheel
  --require-hashes`; `hnswlib` compiles, needs a C++ toolchain) and writes
  `$OUT_DIR/silicon_notebook_<VERSION>_<os>-<arch>.tar.gz`. Caches: npm's and
  pip's (override with `npm_config_cache`, `PIP_CACHE_DIR`).
- In the package: `install.sh` (`PYTHON_BIN` ≥ 3.13, `OFFLINE=1` installs
  only from `wheelhouse/`; copies `.env.example` → `.env` and
  `model-services.example.toml` → `.local/model-services.toml` when missing),
  `start.sh` (sources `.env`; `BACKEND_HOST/PORT` default 8000,
  `FRONTEND_HOST/FRONTEND_PORT` default 3000; starts extension services like
  `prod.sh`; pidfiles in `.local/run`), `stop.sh` (pidfile-based, then
  `extension_services.py stop`; safe — unlike the **source** `scripts/stop.sh`,
  which kills by port and must never run), `upgrade.sh` → `upgrade.py
  --target <dir> [--recover] [--extra-wheelhouse <dir>]…` run from the new
  unpacked package: target stopped, same platform, replaces `backend/app`,
  `frontend`, `node`, `scripts`, `wheelhouse`, the examples and docs, builds a
  new venv offline, keeps `.env` and `.local`; packages in the old venv that
  the new package does not provide (the plugin) need `--extra-wheelhouse`,
  else it refuses (`upgrade.py:225-230`). No version ordering check: any
  package of the same platform can be applied (`upgrade.py:201-204`).
  Further refusals in `validate` (`upgrade.py:190-222`): the new package must
  be unpacked outside the target; the target must be stopped
  (`assert_stopped`); any configured data, config or plugin path (the
  extensions TOML, a service `cwd`) must not lie inside a program directory
  or `.venv` — keep the TOML in `.local/` or outside the install directory,
  and the canvas outside it. Extras are reinstalled `--no-deps
  --only-binary=:all:` pinned to the old version and constrained to the core
  lock, then `pip check`; the original configuration is loaded with the new
  backend (`discover_deployment_extensions`) before any file is swapped. The
  previous program is archived under `.local/upgrade-backups/`. After an
  upgrade SN says to check `/api/ready`.
- `start.sh` (package): ports from `PORT` (backend) and `FRONTEND_PORT` in
  the environment or `.env`; refuses to start during an interrupted upgrade
  (`.local/offline-upgrade`); `trap` cleans up its children on failure.
- Installing a plugin into a package: not documented by SN; the equivalent is
  `.venv/bin/python -m pip install --no-index --find-links <dir> <wheel>`.
  `EXTENSIONS_CONFIG` is read at runtime from `.env`;
  `SILICON_NOTEBOOK_UI_PLUGINS` only at build time (pack machine).
- SN documents to link, not copy: `packaging/DEPLOY.md` (in the package;
  in-place upgrade), `docs/deployment-and-configuration.md` §5 (offline
  packaging, upgrade, the canvas companion, the `BACKEND_PROXY_TARGET` port
  example), `docs/deployment-extensions-sop*.md` (plugin delivery, upgrade).

**auto-canvas** (on main after T165):

- The canvas package (T166): `pnpm notebook:package` →
  `output/notebook-canvas/auto-canvas-notebook-<version>/` and its tarball:
  server bundle, migrations, notebook editor build, `integrations/silicon-notebook/`
  (launchers, README, TOML examples, `ui/` since T165),
  `wheels/silicon_notebook_auto_canvas-<v>-py3-none-any.whl`, `env.example`,
  `VERSION`, `THIRD-PARTY-NOTICES.txt`. Node is not shipped:
  `AUTO_CANVAS_NODE` names silicon-notebook's packaged `node/bin/node`.
  `scripts/package-notebook-canvas-check.mjs` proves a package in an empty
  directory against a stub `/api/me`.
- The integration check (`scripts/notebook-integration-check.mjs`, modules in
  `scripts/lib/notebook-integration/`): sandbox with an allow-listed child
  environment, a Node offline guard (`sandbox.mjs:70-135`, log
  `offline.log`), process groups, `freePort` that never returns 3000, 8000 or
  4310; `notebook-clone.mjs` (full `--no-hardlinks` clone at `--ref`,
  clone-safety refusals); stages M and L share set-up, user registration,
  gates, the two-user flow, the browser click and cleanup (T165's factored
  module).
- README today: "Offline package" section (build machine command, package
  layout) ends with "The offline installation steps at a site are described
  separately (T167)"; "Rollback" section is the source-deployment rollback;
  "The entry link in a notebook" (T165) covers the UI package for a source
  build.
- Lessons from stage L (T165, `stage-l.mjs`): the browser bundle bakes
  `NEXT_PUBLIC_API_BASE_URL` at build time and silicon-notebook's source
  default is `http://127.0.0.1:8000/api` (the owner's port); `pack.sh`
  defaults it to `/api`, which every pack in stage P must keep (pass it
  explicitly). A new user's first notebook shows a one-time hint (知道了)
  over the entry. Every launch of a clone wipes `.local`; a package keeps
  its `.local` across `start.sh` runs and upgrades (it holds `run/`, logs,
  upgrade backups), so stage P's data persists without stage L's
  `DATABASE_URL` workaround — verify that instead of assuming it.

## Design (decided)

**README** — a new section "Offline installation with silicon-notebook's
offline package", replacing the T167 pointer, with build-machine and site
commands in separate lists:

- Build machine: choose the site's ports first (they are baked);
  silicon-notebook's `pack.sh` with `BACKEND_PROXY_TARGET`,
  `CANVAS_PROXY_TARGET` and `SILICON_NOTEBOOK_UI_PLUGINS=<canvas checkout>/integrations/silicon-notebook/ui/auto-canvas`
  exported; `pnpm notebook:package` for the canvas; what to carry to the site.
- Site: unpack silicon-notebook into its install directory and run
  `install.sh` with `OFFLINE=1`; unpack the canvas package **outside** that
  directory (silicon-notebook's `upgrade.sh` replaces whole directories and
  does not check a companion's `cwd`); install the plugin wheel into
  silicon-notebook's `.venv` with `--no-index --find-links`; add
  `AUTO_CANVAS_DATABASE_URL` and `EXTENSIONS_CONFIG` to silicon-notebook's
  `.env`; write the TOML from `extensions.example.toml` with `cwd` = the
  canvas directory and `AUTO_CANVAS_NODE` = `<notebook>/node/bin/node`;
  `init-db.sh --notebook-root <notebook>`; `start.sh`; `stop.sh`.
- Upgrading silicon-notebook: stop; unpack the new canvas-enabled package;
  `upgrade.sh --target <notebook> --extra-wheelhouse <canvas package>/wheels`;
  start. Upgrading the canvas: stop, unpack the new canvas package to a new
  directory, point `cwd` at it, start.
- **No database topics** (the owner, 2026-11-25: offline upgrades and
  database matters are decoupled): the offline installation, upgrade and
  switch-back text says nothing about database backup, restore, pairing or
  migrations; silicon-notebook's own documents cover its database.
- Switching back to a default silicon-notebook package (the offline rollback):
  stop; remove the canvas tables from the TOML (or `EXTENSIONS_CONFIG`);
  uninstall the plugin from `.venv`; `upgrade.sh --target <notebook>` from a
  default package (built without the canvas variables); start. The canvas
  directory is left in place.
- Link SN's documents (above) for everything else.

**Stage P** (`--stage P --notebook <dir> --ref <sha> --python <python ≥ 3.13>
[--package-python <python>] [--cache <dir>]`), slow and network-using, never
in CI. `--python` is silicon-notebook's pack and install interpreter (its
minor version is baked into the wheelhouse); `--package-python` (default
`--python`) builds the canvas's plugin wheel and needs setuptools ≥ 68:

1. Build machine, in the sandbox: one disposable clone at `--ref` (stage M's
   clone helpers); ports for the site chosen once (`freePort`); `npm` and
   `pip` caches in `--cache` (default: inside the sandbox, removed);
   portable Node downloaded once and passed as `NODE_TARBALL` to later packs.
   The offline guard is **off** here (network allowed) and the environment
   names only what `pack.sh` needs.
   - Pack `default` (`VERSION=<base>-1`, no canvas variables,
     `BACKEND_PROXY_TARGET` = the site's API port).
   - Pack `canvas` (`VERSION=<base>-2`, plus `CANVAS_PROXY_TARGET` and
     `SILICON_NOTEBOOK_UI_PLUGINS`), and `canvas-next` (`VERSION=<base>-3`,
     same variables).
   - The canvas package: `scripts/package-notebook-canvas.mjs` into the
     sandbox from this checkout's existing build (the stage requires
     `pnpm build` and `pnpm build:notebook-editor` to have run, like stage M).
   Checks: each tarball exists; the `default` package's
   `frontend/.next/routes-manifest.json` has no `/canvas` rule, the canvas
   packages' have both; the clone is clean apart from the paths
   `clone-safety.mjs` allows.
2. Site (`site/` in the sandbox; the offline guard **on**, `PIP_NO_INDEX=1`,
   `npm_config_offline=true`, a `PATH` of system tools without `node`, `npm`,
   `pnpm`; nothing refers to the clone or this checkout):
   - P1 default: unpack `default`, `OFFLINE=1 install.sh`, `start.sh` with
     the site's ports → `/api/ready` 200 (silicon-notebook's packaged readiness probe; `/api/health` needs a session there), `/canvas` silicon-notebook's 404;
     `stop.sh` → pids gone, ports free. Remove the directory.
   - P2 paired install: unpack `canvas` and the canvas package (separate
     directories), the README's site steps verbatim (the stage reads no
     command from the README; the README and the stage list the same steps,
     reviewed side by side) → stage M's managed-start checks, its two-user
     flow and stage L's click (reused functions, same check names prefixed
     `P2`); `stop.sh` → stage M's stop checks.
   - P3 upgrade: unpack `canvas-next`; `upgrade.sh --target` without
     `--extra-wheelhouse` → refused (the plugin is extra); with it →
     succeeds; start → A's project from P2 is still listed and reopens,
     the click still works; stop.
   - P4 switch back: the README's rollback steps, `upgrade.sh` from
     `default` → `/canvas` is silicon-notebook's 404, `/api/ready` 200, A
     still signs in and sees the notebook from P2; the entry is absent; the
     canvas database still holds A's project (read through `psql`-free SQL on
     the stage's admin connection); stop.
   - The offline log is empty at the end of the site phase.
3. Cleanup as stage M (companions by recorded pid, databases, browser,
   sandbox), with one deadline; on interrupt exit 130 and nothing left.

**T165 follow-ups** (codex round 4 on PR 143, recorded there), in stage L's
browser and stage M's cleanup, which stage P reuses:

1. A Chrome launch still pending at the cleanup's deadline stays owned
   (awaited and disposed, or cancelled) instead of being unregistered; a
   control with a stand-in launch that outlasts the close budget proves no
   browser process is left.
2. Lost-create polling is bounded by the earlier of `lostBy` and the admin
   session's own budget (or cancellation and reconciliation get a budget of
   their own), so a database known to exist is always sent its `DROP`.
3. Stage L keeps its screenshots and console on a network-only failure too
   (captured before the context closes, kept by the combined verdict).
4. The README snippets compare `SILICON_NOTEBOOK_UI_PLUGINS` entries after
   silicon-notebook's trim-and-resolve normalisation (a trailing slash names
   the same package); extend the README control.

Each with a control that fails with its fix reverted. Stage P's browser
reuses stage L's launch (proxy for every hop, the WebRTC policy).

## Scope

Owned paths:

- `integrations/silicon-notebook/README.md`
- `scripts/notebook-integration-check.mjs`,
  `scripts/lib/notebook-integration/*.mjs` (stage P; the T165 follow-ups;
  otherwise no behaviour change to stages T, A, S, M, L beyond shared
  helpers)
- `docs/testing/README.md` (stage P: what it needs — network, time, disk —
  and when to run it)
- `tasks/T167-notebook-offline-pair/report.md`

Out of scope: product code (`apps/**`, `packages/**`); silicon-notebook's
checkout (never written to; its `.env`, `.local` and databases never opened,
not even listed); changes to silicon-notebook's packaging scripts (report a
gap instead); the canvas's packaging scripts `scripts/package-notebook-canvas*.mjs`
(T180 fixes their five T166 follow-ups in parallel; stage P only runs them).

## Acceptance

Lane 2. Never look at, bind, contact or signal ports 3000, 8000, 4310; never
run silicon-notebook's source `scripts/stop.sh` or `npm run stop`, `pnpm
start/stop/dev/restart`, `pnpm test:e2e:local`; never kill by name or
pattern. Stage P is the only command here that uses the network (npm
registry, nodejs.org, PyPI), as approved (Q5).

```bash
set -euo pipefail
NB=/Users/huzhifeng/workspace/silicon-notebook
PY=/opt/homebrew/bin/python3.13   # silicon-notebook's pack.sh (PACK_PYTHON) and install.sh (PYTHON_BIN): one minor version
PKG_PY=/opt/homebrew/Caskroom/miniconda/base/bin/python   # builds the canvas's plugin wheel (needs setuptools >= 68; python3.13 here has none; the wheel is py3-none-any)
REF=$(git -C "$NB" rev-parse origin/master)
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 AUTO_CANVAS_TEST_PYTHON=$PY
unset SILICON_NOTEBOOK_ENV_FILE SILICON_NOTEBOOK_UI_PLUGINS DATABASE_URL PORT HOST AUTO_CANVAS_AUTH AUTO_CANVAS_API_URL
pnpm install --frozen-lockfile --offline
pnpm build
pnpm build:notebook-editor
pnpm exec vitest run scripts/package-notebook-canvas.test.mjs scripts/notebook-launcher.test.mjs   # all pass
pnpm test:local
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm deadcode
AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY pnpm notebook:package --out "$TMPDIR/t167-pkg"
AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY node scripts/package-notebook-canvas-check.mjs --tarball "$(ls "$TMPDIR"/t167-pkg/auto-canvas-notebook-*.tar.gz)"   # every check ok, incl. the browser boot
node scripts/notebook-integration-check.mjs --stage S --notebook "$NB"
node scripts/notebook-integration-check.mjs --stage M --notebook "$NB" --ref "$REF" --python "$PKG_PY"
node scripts/notebook-integration-check.mjs --stage L --notebook "$NB" --ref "$REF" --python "$PKG_PY"
node scripts/notebook-integration-check.mjs --stage P --notebook "$NB" --ref "$REF" --python "$PY" --package-python "$PKG_PY"   # exit 0
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE left(datname, 15) = 'auto_canvas_it_'"   # 0
```

(`pnpm notebook:package` passes `--out` through to `package-notebook-canvas.mjs`.)

Also: the owner's ports and the notebook checkout's `git status` unchanged
(snapshot before and after); a control for each T165 follow-up that fails
with its fix reverted; an interrupt of stage P in the site phase → exit 130,
nothing left. Record stage P's duration and the disk it used in the report.

## Notes for the implementer

- If one of silicon-notebook's scripts cannot do what the README says (for
  example `upgrade.sh` refuses the paired upgrade), stop and report with the
  output; do not patch silicon-notebook or work around it in the stage.
- Tokens are compared, never printed. No new dependency, no lockfile change,
  no LLM API call.
- Do not commit, stash, push, merge, rebase or switch branches.
- The Codex sandbox has no network and writes only inside this worktree.
  Run every acceptance command the sandbox allows; for each one it refuses
  (network, PostgreSQL, Chrome, the system temporary directory), report the
  command and its error verbatim and go on. Never work around the sandbox,
  and never ask for an escalation that would let a command reach ports 3000,
  8000 or 4310 or the owner's checkout. The reviewer runs the refused
  commands (stage P among them) outside the sandbox and returns their
  failures as the next round.
