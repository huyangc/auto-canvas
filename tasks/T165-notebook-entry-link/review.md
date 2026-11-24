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

## Round 4 — changes-requested

Reviewed: codex PR review round 2 on PR 143 (head `eaeaae1`, gpt-6.2-sol),
each finding checked against the code by Opus. Past the skill's three-round
limit; continued under the owner's instruction of 2026-11-24 to finish the
planned tasks without stopping (reported to the owner).

| #   | Severity        | Where                                                     | Finding                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix (P1)   | `stage-l.mjs` `forwardingProxy` / `webGate`               | `held()` calls `sandbox.listenerState()`, which can throw (an `lsof` failure) inside the proxy's request and CONNECT handlers: an uncaught exception ends Node before Chrome is stopped or the databases dropped. A stalled `lsof` can also block. | Every verification at the proxy boundary is caught: an error or a timeout counts as "gate not held" (refused and recorded with `why: "gate"`, detail kept); the listener check has a time bound. A stage S control: a `held` that throws and one that never answers → the request is refused, the process lives, the verdict fails.               |
| 2   | must-fix (P2)   | `stage-l.mjs` `browserSessions.close` / `closeOpen`       | `close()` clears `open` before disposal ends, so an interrupt during a normal close makes `closeOpen()` return at once and the clone can be stopped while Chrome still runs.                                                                       | The session stays registered until disposal ends; `close()` returns one shared promise per session that both callers await. Extend the shutdown control: `closeOpen` during a normal close waits for it.                                                                                                                                          |
| 3   | must-fix (P2)   | `managed-clone.mjs` `lostCreatesRunning`                  | A `pg_stat_activity` poll that starts just before `lostBy` can use up the whole database reserve.                                                                                                                                                  | Each poll's query is bounded by the time left until `lostBy` (statement timeout or a race with cancellation), without lowering the deadline for the drops after it.                                                                                                                                                                               |
| 4   | must-fix (P2)   | same                                                      | With `track_activities` off, the query text does not match and an empty result is taken as "finished".                                                                                                                                             | Look up the recorded backend pid itself (any row with that pid, whatever its query and state); "finished" only when that backend is idle or gone; an unreadable or text-less row (`query` empty, `<insufficient privilege>`, `track_activities` off) counts as still running until the deadline, then unresolved. Extend the follow-up 5 control. |
| 5   | should-fix (P3) | `integrations/silicon-notebook/README.md` removal snippet | With `set -eo pipefail`, `grep -vxF` exits 1 when it removes the only entry, so the snippet stops before `unset`.                                                                                                                                  | A filter that succeeds on empty output (e.g. `{ grep -vxF … \|\| true; }`, or a pure-Bash loop); test it under `set -euo pipefail` with one, three and no matching entries.                                                                                                                                                                       |

## Round 5 — accepted

Reviewed: the round 4 diff (Opus implementer) against review round 4's five
findings; acceptance rerun by Opus (`tmp/t165-review-r4.sh`, logs in
`tmp/t165-review/r4/`). All five fixed, each with a stage S control that
fails with its fix reverted (implementer's evidence). Accepted deviation: a
readable row on the recorded backend showing another statement counts as
ended (`CREATE DATABASE` cannot run in a transaction, so the pid was
reused); unreadable rows count as running until the deadline.

```text
pnpm build / pnpm build:notebook-editor                      → 0
launcher + package tests                                     → 0
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
package build + check                                        → 0 (21 of 21)
--stage S / M / L                                            → 0 (94 / 114 / 89 passed)
leftover auto_canvas_it_* databases                          → 0
notebook checkout git status before/after                    → identical
pnpm test:local                                              → 0 (862 files passed, 3 skipped)
```

## Round 6 — changes-requested

Reviewed: codex PR review round 3 on PR 143 (head `7319f0e`, gpt-6.2-sol),
each finding checked against the code by Opus (continued under the owner's
instruction, as round 4).

| #   | Severity        | Where                                                   | Finding                                                                                                                                                   | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix (P1)   | `stage-l.mjs` `launchChrome`                            | WebRTC (ICE/STUN over UDP) is neither routed by Playwright nor sent to the HTTP proxy, so a page could reach another host or an owner port by UDP unseen. | Launch Chrome so WebRTC uses only proxied connections: `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (and `--webrtc-ip-handling-policy=disable_non_proxied_udp`), or disable WebRTC outright if that is not honoured. A stage S control in real headless Chrome launched as stage L does: a page that creates an `RTCPeerConnection` with a STUN server on a loopback UDP port the run listens on (never 3000/8000/4310) and gathers candidates → no datagram arrives within a bound; with the flag removed, one does. |
| 2   | must-fix (P2)   | `self-check.mjs` redirect control                       | The control's browser is closed only in its local `finally`; an interrupt during `browsers.open()` lets the sandbox go while Chrome runs.                 | Register `browsers.closeOpen` with `sandbox.beforeDispose()` before starting Chrome, as stage L does.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | must-fix (P2)   | `stage-l.mjs` `notebookGuards`                          | A guard that exits 0 while `sandbox.run()` could not stop its process group still passes, and the stage goes on using the clone.                          | Call `checkStopped()` (as `makeBuild()` does) before accepting each guard's result; a surviving group fails the check and stops the stage.                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | should-fix (P3) | `integrations/silicon-notebook/README.md` setup snippet | Rerunning the setup appends the canvas's path again; silicon-notebook's sync refuses duplicate package names, so the next build fails.                    | Append only when the path is not already an entry; extend the README control to rerun the setup twice and with the path already present.                                                                                                                                                                                                                                                                                                                                                                                             |

## Round 7 — accepted

Reviewed: the round 6 diff (Opus implementer) against review round 6's four
findings; acceptance rerun by Opus (`tmp/t165-review-r6.sh`, logs in
`tmp/t165-review/r6/`). All four fixed, each with a stage S control that
fails with its fix reverted (implementer's evidence). Finding 1: Chrome 158
ignores `--force-webrtc-ip-handling-policy` alone and honours
`--webrtc-ip-handling-policy`; both are passed, and stage S proves in real
headless Chrome that no STUN datagram leaves.

```text
pnpm build / pnpm build:notebook-editor                      → 0
launcher + package tests                                     → 0
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
package build + check                                        → 0 (21 of 21)
--stage S / M / L                                            → 0 (98 / 114 / 89 passed)
leftover auto_canvas_it_* databases                          → 0
notebook checkout git status before/after                    → identical
pnpm test:local                                              → 0 (862 files passed, 3 skipped)
```
