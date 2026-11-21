# T148 — `pnpm restart` / `npm run restart`

- Branch: `task/T148-restart-script`
- Base: `main` at `e2d1336`
- Status: approved (owner, 2026-11-21: "把服务启动、服务停止、服务重启的脚本给做上，让我能
  npm run start、npm run stop、npm run restart")

## Goal

`npm run start` and `npm run stop` exist since T010 (`scripts/start.sh`,
`scripts/stop.sh`, shared code in `scripts/lib/launcher.sh`). There is no
restart. After this task `pnpm restart` / `npm run restart` rebuilds and
replaces the running server, and starts one when none is running.

## Context

- `package.json` scripts `start` and `stop` run the two Bash launchers; npm and
  pnpm both work (README.md "Quick start").
- `start.sh` checks config, prerequisites, the base path, that the port is
  free and the database, then builds (unless `SKIP_BUILD=1`) and starts the
  server in the background, waiting for `/api/health`.
- `stop.sh` finds the listener by port (no PID file), terminates it with a
  grace period, and exits 0 with "not running" when nothing listens.
- `scripts/launcher.test.mjs` runs the real scripts against a fixture
  repository with stubbed `pnpm`, `psql` and `createdb` and a real TCP server.

## Scope

Owned paths: `scripts/restart.sh` (new), `scripts/launcher.test.mjs`,
`package.json` (one script), `README.md`, `apps/server/README.md`,
`tasks/T148-restart-script/`.

Out of scope: `start.sh`, `stop.sh`, `dev.sh`, `scripts/lib/launcher.sh`, the
server and the editor.

## Steps

1. `scripts/restart.sh`: config, prerequisites, base path and database check,
   then the build (unless `SKIP_BUILD=1`), all **before** the running server is
   touched; then `stop.sh`; then `start.sh` with `SKIP_BUILD=1`, so the build
   made first is the one served. A failure before the stop leaves the old
   server serving.
2. `package.json`: `"restart": "bash scripts/restart.sh"`.
3. Tests in `scripts/launcher.test.mjs`: restart with nothing running starts a
   server; restart replaces a running server (new PID, old one gone, healthy,
   one build per restart); `SKIP_BUILD=1` builds nothing; a failed build, an
   unreachable database and missing dependencies each leave the running server
   alive and healthy.
4. Document the command in `README.md` and `apps/server/README.md`.

## Acceptance

```bash
npx vitest run scripts/launcher.test.mjs   # expected: all pass, 2 new tests
pnpm format:check                          # expected: exit 0
pnpm lint                                  # expected: 0 errors
pnpm docs:check                            # expected: exit 0
```

Behavioral check on a machine with PostgreSQL: `npm run start`, open the
printed URL, `npm run restart` (a new process serves the same URL),
`npm run stop` (the port is free), `npm run restart` again (starts from
stopped).
