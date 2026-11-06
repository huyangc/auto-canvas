# T010 review

## Round 1 — changes requested

Round 1 was interrupted by the end of the Claude Code session while its final
`pnpm check` rerun was running; the report was written before that. Its live
acceptance (start, health, editor HTML, port-conflict refusal, Playwright
against the started app, stop, npm variants, `pnpm dev` with Ctrl+C) passed.

| #   | Severity | Where                                  | Finding                                                                                                                                          | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | launchers (new requirement from owner) | Configuration (database URL, port, limits) can only be given as shell variables.                                                                 | `start.sh`, `dev.sh` and `stop.sh` load the repository-root `.env` when it exists (`set -a; source .env; set +a`), before applying defaults; variables already exported in the shell take precedence over `.env`. A missing `.env` is fine (defaults apply). Add a commented `.env.example` listing every server and launcher variable with its default; `.gitignore` ignores `.env` but not `.env.example`. Document it in both READMEs and `apps/server/README.md`. Add launcher tests: `.env` value used, shell value wins, missing `.env` works. |
| 2   | must-fix | acceptance                             | The final `pnpm check` rerun did not finish; an earlier run had two 5000 ms timeouts in unchanged server tests while other work ran in parallel. | Rerun every acceptance command with nothing else running and record the results. If the timeouts recur, report them with output; do not edit those tests.                                                                                                                                                                                                                                                                                                                                                                                            |

## Round 2 — accepted

Reviewed: working tree after Codex round 2; acceptance rerun by Opus with
nothing else running.

Every changed path is in scope; no product code changed. `.env` loading
snapshots exported variables, sources `.env` with `set -a`, then restores the
snapshot, so shell values win; a missing `.env` is fine. Automatic database
creation applies only when `DATABASE_URL` names the default `auto_canvas`
database and it is missing. `.env` is ignored, `.env.example` is tracked and
documents every server and launcher variable.

Acceptance rerun:

```text
pnpm check → 0 (7280 passed)
pnpm start → ready at http://127.0.0.1:4310; /api/health {"ok":true}; editor HTML served
SKIP_BUILD=1 pnpm start (second) → refused, names the node process on 4310, pnpm exit 1
pnpm stop → stopped; 4310 free
.env PORT=4399 → started on 4399, stopped
PORT=4398 with .env PORT=4399 → started on 4398 (shell wins), stopped
npm run start / npm run stop → same behavior
no listener left on 4310, 4398, 4399; .env untracked
```
