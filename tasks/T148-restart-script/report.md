# T148 report — `pnpm restart` / `npm run restart`

Written and implemented by the coordinator (tooling, about 15 lines of Bash).

## What was built

- `scripts/restart.sh`: checks config, prerequisites, the base path and the
  database and builds first; then runs `stop.sh` and `start.sh` (with
  `SKIP_BUILD=1`, so the build just made is served).
- `package.json`: `restart`.
- Two tests in `scripts/launcher.test.mjs`.
- `README.md` and `apps/server/README.md` name the command.

One choice beyond "stop, then start": the build happens before the stop. A
restart whose build, database check or prerequisites fail leaves the running
process and its API up, and the API's downtime is the stop and start only.

## Review

An independent Opus review (APPROVE) and the codex hook raised the same P2:
the first wording said a failed build "keeps the old server serving". The
build rewrites `apps/editor/dist`, which the running server reads on every
request (`apps/server/src/static-editor.ts`), so editor pages can 404 during
the rebuild and stay incomplete after a failed build; `pnpm start` never
builds under a live server. The reviewer judged build-first still the better
order (stop-first takes the API down for the whole build). Fixed by saying
exactly that in the script comment and both READMEs. Building into a staging
directory and swapping it in would close the window; not done here.

Left as they are (P3): no extra hint when the start fails after the stop (the
"stopped" line and start's own error are shown); no test for a hidden
listener aborting the restart or for a start failing after the stop.

## Acceptance

| Command                                    | Result                |
| ------------------------------------------ | --------------------- |
| `npx vitest run scripts/launcher.test.mjs` | 22 passed (20 before) |
| `pnpm format:check`                        | pass                  |
| `pnpm lint`                                | 0 errors              |
| `pnpm docs:check`                          | pass                  |

Real run on the owner's machine (PostgreSQL 16, port 4310):

- `npm run start`: exit 0 in 7 s (builds cached), editor `HTTP 200`,
  `/api/health` `{"ok":true}`.
- `npm run restart`: exit 0, "Stopping listeners on port 4310", a new PID
  serves, health ok.
- `SKIP_BUILD=1 npm run restart`: exit 0, no build output, a new PID serves.
- `npm run stop`: exit 0, the port is free; a second stop says "not running".
- `npm run restart` from stopped: says "not running", then starts; exit 0.

## Not covered

- `shellcheck` is not installed here; the script passes `bash -n`.
- Restart keeps `stop.sh`'s rule: it stops whatever listens on `PORT`, found
  by port, as `pnpm stop` does.
