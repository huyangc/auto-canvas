# T010 report — round 2

## Summary

Completed both round 1 must-fix findings. All three launchers now load the
optional repository-root `.env` before applying defaults, preserving values
already exported by the invoking shell. Added a commented `.env.example`,
ignored `.env`, documented configuration in both READMEs and the server README,
and expanded launcher coverage from 12 to 17 tests. Every plan acceptance
command was rerun sequentially and passed with its expected outcome.

The round 1 start/stop/dev implementation remains in place. No server or
other product code, dependencies or lockfile changed.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | `scripts/start.sh` uses the shared helper for prerequisites, database checks, full build or `SKIP_BUILD=1`, port diagnostics, detached server, logs, health wait and failure cleanup. The helper now loads root `.env` before defaults and preserves exported shell values. |
| 2    | done   | `scripts/stop.sh` loads the same configuration, discovers listeners by configured port, sends SIGTERM then SIGKILL after the grace period, and succeeds when absent.                                                                                                        |
| 3    | done   | `scripts/dev.sh` loads the same configuration, builds server dependencies, waits for API readiness, runs foreground Vite, and cleans up both services on Ctrl+C.                                                                                                            |
| 4    | done   | Root start/stop/dev scripts and `dev:editor` are retained; existing server scripts are unchanged. `.local/` and `.env` are ignored; `.env.example` is not ignored.                                                                                                          |
| 5    | done   | Both root READMEs and `apps/server/README.md` explain `.env`, shell precedence and defaults. `.env.example` lists server and launcher variables, including Agent idle timeout, project limit and PostgreSQL CLI timeout.                                                    |

## Review findings addressed

1. **Configuration only available through shell variables:** the shared Bash
   helper sources root `.env` with `set -a; source ...; set +a` before defaults.
   It snapshots exported names and values in Bash arrays and restores them
   afterward, without evaluating their contents. Exported empty, quoted and
   multiline values are preserved. Parameterized tests exercise start and dev
   using `.env` values and shell overrides, then stop using the corresponding
   configured port. A missing-file test proves the default stop port; existing
   launcher tests also exercise start and dev without `.env`.
2. **Incomplete full-check evidence:** reran every acceptance command without
   competing test/application jobs. `pnpm check` finished with exit 0; the two
   unchanged server test timeouts from round 1 did not recur. No existing tests
   in the server were changed, disabled or removed.

## Acceptance results

```text
pnpm check → 0; formatting, Markdown links, generated docs/components, typecheck, lint, local tests and build passed. 736 test files passed, 2 skipped; 7280 tests passed, 116 skipped. Vitest duration: 42.16s. Full output: /tmp/T010-round2-check.log.
bash -n scripts/start.sh scripts/stop.sh scripts/dev.sh → 0
pnpm start → 0; auto-canvas is ready at http://127.0.0.1:4310
curl -sf http://127.0.0.1:4310/api/health → 0; {"ok":true}
curl -sf http://127.0.0.1:4310/ | grep -q '<div id="root"' → 0
pnpm start (second invocation) → 1, expected refusal; Port 4310 is already in use; diagnostic named node, PID 38850, user and listening address.
ICM_E2E_BASE_URL=http://127.0.0.1:4310 pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts --grep 'every web path' --workers=1 → 0; 1 passed (4.2s).
pnpm stop → 0; auto-canvas stopped. lsof -nP -iTCP:4310 -sTCP:LISTEN → 1 with no output, confirming the port was free.
pnpm stop (again) → 0; auto-canvas is not running on port 4310.
npm run start && npm run stop → 0; ready at http://127.0.0.1:4310, then auto-canvas stopped.
pnpm dev (terminal check) → API ready at http://127.0.0.1:4310; Vite ready at http://localhost:5173/ (121ms). Direct API and Vite-proxied /api/health returned {"ok":true}; Vite served editor HTML. Terminal Ctrl+C → 130, expected interruption; both services stopped.
lsof -nP -iTCP:4310 -iTCP:5173 -sTCP:LISTEN (after Ctrl+C) → 1 with no output; neither port had a listener.
pnpm stop (after Ctrl+C) → 0; auto-canvas is not running on port 4310.
pnpm test:local scripts/launcher.test.mjs → 0; 17 tests passed (15.53s), before the full acceptance run.
bash -n scripts/start.sh scripts/stop.sh scripts/dev.sh scripts/lib/launcher.sh → 0
git check-ignore .env .env.example → 0; only .env was listed.
pnpm format:check (after writing the round 2 report) → 0; All matched files use Prettier code style!
git diff --check → 0
```

The initial focused launcher test attempt under the filesystem sandbox failed
because binding a local TCP socket was denied (`listen EPERM: operation not
permitted 127.0.0.1`). The approved rerun with local socket/process access
passed all 17 tests. Full acceptance ran with approved local socket and
PostgreSQL access, sequentially after that rerun. There were no competing
Vitest, Playwright, check, server or Vite processes before acceptance began.

Lint completed with 0 errors and 2434 warnings; Vite reported existing config,
browser externalization and bundle-size warnings. npm warned about the runner's
`verify-deps-before-run` environment setting. These did not fail acceptance.

## Investigation results

- The built editor contains `<div id="root"`; the plan's HTML check works.
- The existing CLI meets launcher requirements; `apps/server/src/cli.ts` did
  not need changes.
- `.env` resolves against the repository root even when a launcher is invoked
  from another directory. Missing `.env` uses the existing defaults. Direct
  server commands and tests do not load it through the launchers.
- `pnpm start` retains its fixed `EDITOR_ROOT=apps/editor/dist`; `pnpm dev`
  unsets it and defaults the API proxy target to its configured server URL.
  These launcher-specific behaviors are documented in the example and README.
- The shared helper remains compatible with macOS Bash 3.2. Native acceptance
  used macOS/lsof; Linux ss listener parsing remains covered by fixture output,
  including multiple PIDs and listeners with hidden process identities.

## Deviations and open questions

No unresolved findings or scope deviations. `.env.example` and its ignore rule
were explicitly requested by review. No plan, review, dependencies, lockfile or
product code was edited. No commits, pushes or branch changes were made.
Acceptance processes were stopped; ports 4310 and 5173 were free afterward.
