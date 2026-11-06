# T010 — One-command local start, stop and dev

- Branch: `task/T010-start-stop`
- Base: `main` at `3e696b6`
- Lane: 1
- Status: approved

## Goal

Start, stop and develop auto-canvas from one place, like silicon-notebook's
`npm run start` / `npm run stop` (`../silicon-notebook/scripts/{prod,stop,dev}.sh`):

- `pnpm start` (also `npm run start`): one command brings up the whole app on
  one URL. The server serves the built editor, the API and the Agent relay on
  `127.0.0.1:4310`, runs in the background, and the command returns once it is
  healthy.
- `pnpm stop` (also `npm run stop`): stops it cleanly.
- `pnpm dev` (also `npm run dev`): one command for development — the server in
  the background plus the Vite editor with hot reload in the foreground;
  Ctrl+C stops both.

## Context

- Server CLI `apps/server/src/cli.ts`: migrates, starts the Agent relay, serves
  `EDITOR_ROOT` when set (`static-editor.ts`, SPA fallback, `/api/*` never falls
  back), listens on `HOST` (default `127.0.0.1`) / `PORT` (default 4310), handles
  SIGINT/SIGTERM (closes the relay, HTTP server and pool), `GET /api/health`.
  Config table: `apps/server/README.md`.
- Root scripts today (`package.json`): `dev` = `pnpm --filter @icm/editor dev`
  (Vite, port 5173, proxies `/api/*` to `AUTO_CANVAS_API_URL`, default
  `http://127.0.0.1:4310`), `server:dev`, `server:migrate`, `build` (all
  packages and apps; the editor's `vite build` writes `apps/editor/dist`).
- Databases: `auto_canvas` (dev) and `auto_canvas_test` must exist, owned by
  the OS user (`createdb`); README "Requirements".
- silicon-notebook reference behavior to mirror: refuse to start when a port
  is already in use (and say which process holds it); background start that
  waits for readiness and exits; logs under `.local/logs/`; `stop` finds the
  listening process by port (not by stored PID), sends SIGTERM, waits, then
  SIGKILL after a grace period; a launcher interrupted mid-start cleans up
  what it started. macOS (`lsof`) and Linux (`ss`/`lsof`) both work.
- Playwright can test an already-running app: `ICM_E2E_BASE_URL=<url>`
  (`playwright.config.ts`, editor-only cases; no web servers started).
- `.gitignore` has no `.local/` entry yet.

## Scope

Owned paths: new `scripts/start.sh`, `scripts/stop.sh`, `scripts/dev.sh` (and a
shared `scripts/lib/launcher.sh` if useful), root `package.json` scripts,
`.gitignore`, `README.md`, `README_zh.md`, `apps/server/README.md`,
`apps/server/src/cli.ts` only if a launcher need cannot be met otherwise
(report it), tests for any non-trivial script logic.

Out of scope: product code, dependencies, the CI workflow.

## Steps

1. `scripts/start.sh`:
   - fail fast with a clear message if `node_modules` is missing (tell the user
     to run `pnpm install --frozen-lockfile`) or if `pnpm` is not on `PATH`;
   - ensure the databases exist: if `psql`/`createdb` are available and
     `auto_canvas` is missing, create it (never drop or modify existing ones);
     if PostgreSQL is unreachable, fail with the `DATABASE_URL` it tried;
   - build with `pnpm build` unless `SKIP_BUILD=1`;
   - refuse to start if `PORT` (default 4310) is in use, naming the process;
   - start `node apps/server/dist/cli.js` detached with
     `EDITOR_ROOT=apps/editor/dist`, logs appended to `.local/logs/server.log`;
   - wait for `GET /api/health` (timeout, default 60 s); on failure print the
     log tail, stop what it started and exit non-zero; on success print the
     URL and how to stop.
     Honor `PORT`, `HOST`, `DATABASE_URL` and the server's other variables.
2. `scripts/stop.sh`: find the process listening on `PORT`, SIGTERM, wait up to
   a grace period (default 10 s), then SIGKILL; report "not running" when
   nothing listens.
3. `scripts/dev.sh`: build what the server needs (`pnpm --filter @icm/server...
build`), start the server in the background (same port check and health
   wait, its own log `.local/logs/server-dev.log`), then run Vite in the
   foreground; on exit or Ctrl+C stop the server it started.
4. Root `package.json`: `start`, `stop`, `dev` point at the scripts (keep
   `server:dev` and `server:migrate`; the old `dev` behavior stays available as
   `dev:editor`). `.gitignore` gains `.local/`.
5. Docs: README / README_zh quick start becomes `pnpm install
--frozen-lockfile` then `pnpm start` (open the printed URL) and `pnpm stop`;
   development uses `pnpm dev`; one line that `npm run start|stop|dev` works
   the same but installing must use pnpm. `apps/server/README.md` mentions the
   launchers.

## Acceptance

```bash
pnpm check                                    # passes
bash -n scripts/start.sh scripts/stop.sh scripts/dev.sh
pnpm start                                    # exit 0, prints http://127.0.0.1:4310
curl -sf http://127.0.0.1:4310/api/health     # {"ok":true}
curl -sf http://127.0.0.1:4310/ | grep -q '<div id="root"'   # editor HTML served
pnpm start                                    # second start refuses: port in use, exit non-zero
ICM_E2E_BASE_URL=http://127.0.0.1:4310 pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts --grep 'every web path' --workers=1   # pass against the started app
pnpm stop                                     # exit 0; port 4310 free afterwards
pnpm stop                                     # "not running", exit 0
npm run start && npm run stop                 # same behavior through npm
```

`pnpm dev` (manual, record what you saw): the server starts, Vite serves on
5173, Ctrl+C stops both and frees 4310.

## Notes for the implementer

- Bash, `set -euo pipefail`, no new dependencies.
- Do not leave processes running after your acceptance runs.
- Find the root `index.html` marker that actually exists in `apps/editor/dist`
  if `<div id="root"` differs, and use it in the check.
