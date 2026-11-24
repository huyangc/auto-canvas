# T165 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T165-notebook-entry-link` (uncommitted
work of the Opus implementer on `16d60c7`); acceptance rerun by Opus
(`tmp/t165-review.sh`, logs in `tmp/t165-review/r1/`).

| #   | Severity                         | Where                                       | Finding                                                                                                                                                                                                                                                                                                                                                                                         | Expected fix                                                                                                               |
| --- | -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix (fixed by the reviewer) | `scripts/package-notebook-canvas-check.mjs` | Its Python stand-in for `app.extension_sdk` lacks `Availability` and `app.extension_sdk.ui`, so the packaged plugin (0.2.0) no longer imports there (reported by the implementer).                                                                                                                                                                                                              | The stand-in gains the same two names as the launcher test's; the check passes 21 of 21. Done in this round (a few lines). |
| 2   | note                             | `stage-l.mjs`                               | Deviations 1–7 of the report (same-origin `NEXT_PUBLIC_API_BASE_URL`, notebook data outside `.local`, the first-visit hint, the stricter browser guard with a recording proxy for branded Chrome's own connections, a profile per browser, screenshots only on failure, one 1,639-line shared module) are accepted: each follows from silicon-notebook's behaviour or makes the stage stricter. | —                                                                                                                          |
| 3   | note                             | T167                                        | `NEXT_PUBLIC_API_BASE_URL` is baked at build time; silicon-notebook's `pack.sh` defaults it to `/api`, so stage P must keep that default.                                                                                                                                                                                                                                                       | Carry into T167's plan.                                                                                                    |

Acceptance rerun:

```text
pnpm build                                        → 0
pnpm build:notebook-editor                        → 0
vitest run notebook-launcher + package-notebook-canvas tests → 0 (56 passed)
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
node scripts/package-notebook-canvas.mjs --python <miniconda> → 0 (the tarball holds integrations/silicon-notebook/ui/auto-canvas/)
node scripts/package-notebook-canvas-check.mjs    → 0 (21 of 21)
--stage S                                         → 0 (89 passed)
--stage M                                         → 0 (114 passed)
--stage L                                         → 0 (85 passed)
leftover auto_canvas_it_* databases               → 0
notebook checkout git status before/after         → identical
pnpm test:local                                   → 0 (862 files passed, 3 skipped; 9135 tests)
```

## Round 2 — changes-requested

Reviewed: codex PR review round 1 on PR 143 (head `a9fca64`, gpt-6.2-sol),
each finding checked against the code by Opus.

| #   | Severity      | Where                                                                            | Finding                                                                                                                                                                                                                                         | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix (P1) | `scripts/lib/notebook-integration/stage-l.mjs` `guardNetwork`, `browserSessions` | `context.route` does not see redirect hops, and the proxy bypasses all of 127.0.0.1, so a redirect from the clone to another 127.0.0.1 port (an owner port included) would be followed unseen. The token init script also runs on every origin. | Every hop goes through a layer the run controls: send loopback through the run's proxy too (Chrome `--proxy-bypass-list=<-loopback>`, no `bypass`), and make that proxy forward only to `127.0.0.1:<web port>` (and only while the listener gate holds), refusing and recording everything else, CONNECT included. Keep `context.route` as a second layer. The init script writes the token only when `location.origin` is the clone's web origin. A stage S control: a stand-in page whose redirect goes to another loopback port the run listens on → the hop never arrives there and the stage fails it. |
| 2   | must-fix (P2) | `stage-l.mjs` `browserSessions.open` / `closeOpen`                               | An interrupt while `tripwire()` or `launchPersistentContext` is pending marks the session closed; startup then still launches Chrome, and later `close()` returns early.                                                                        | Cleanup awaits (within its deadline) the in-flight start and disposes whatever it produced (proxy, context, recorded process); `open` refuses to launch once shutdown began. A control that interrupts during the launch.                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | must-fix (P2) | `managed-clone.mjs` ledger (lost-reply reconcile)                                | After a lost reply the server may still be executing `CREATE DATABASE`; the catalog lookup can come too early and miss a database that commits later.                                                                                           | Keep the backend pid of an unknown-outcome create; before looking up `pg_database`, wait (within the cleanup deadline) until that backend no longer runs the statement (`pg_stat_activity`), then look up and drop; on timeout report the name as unresolved. Extend the follow-up 5 control.                                                                                                                                                                                                                                                                                                               |
| 4   | must-fix (P2) | `integrations/silicon-notebook/README.md` (entry link, rollback)                 | `SILICON_NOTEBOOK_UI_PLUGINS` is a `:`-separated list; the instructions set and unset it whole, which drops other UI packages.                                                                                                                  | Document adding the canvas's path to an existing list and removing only that path, unsetting the variable only when the list becomes empty (setup, removal and rollback step 2).                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Round 3 — accepted

Reviewed: the round 2 diff (Opus implementer) against review round 2's four
findings; acceptance rerun by Opus (`tmp/t165-review-r2.sh`, logs in
`tmp/t165-review/r2/`). All four fixed: every browser connection, loopback
included, goes through the run's forwarding proxy, which forwards only to
the clone's web origin under the listener gate (the route stays as a second
layer; the token is written only on the web origin); a browser start in
flight is awaited and disposed by the cleanup; a lost create waits for its
backend's statement before the catalog lookup; the README adds and removes
only the canvas's path in `SILICON_NOTEBOOK_UI_PLUGINS`. Each has a stage S
control that fails with its fix reverted (implementer's evidence). Stage S
now needs the system Chrome (the redirect control runs it).

```text
pnpm build / pnpm build:notebook-editor                      → 0
launcher + package tests                                     → 0 (56 passed)
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
package build + check                                        → 0 (21 of 21)
--stage S / M / L                                            → 0 (91 / 114 / 89 passed)
leftover auto_canvas_it_* databases                          → 0
notebook checkout git status before/after                    → identical
pnpm test:local                                              → 0 (862 files passed, 3 skipped)
```
