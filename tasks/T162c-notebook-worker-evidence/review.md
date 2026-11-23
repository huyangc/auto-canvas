# T162c review

## Round 1 — accepted with one correction

Reviewed: the working tree on `task/T162c-notebook-worker-evidence` (on the
T162b head `bfcf72e`) on 2026-11-23. The plan had five rounds of codex
`gpt-6.2-astra` review (verdict approve). Implementation by a Claude Opus
subagent.

| #   | Severity | Where                                          | Finding                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                                                               |
| --- | -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | note     | `apps/editor/e2e/notebook-worker.spec.ts` (N7) | Playwright's `response.body()` returned the seed for the no-store preview fetches while the response headers, the wire and the shown image were the server's. The comment stated the cause (the HTTP cache entry) as a fact; it was an inference.  | Corrected by the reviewer: the comment says what was observed and that the cause was not established. The measured response is the fixture's hash of the bytes on the wire, compared with the shown image. |
| 2   | note     | the implementer's round-1 report               | "Lane 2 only" was not exact: the evidence script was run by hand twice on port 4399 (cleaned up; nothing touched 3000, 8000 or 4310). The round-1 acceptance was not on one frozen tree (the evidence script was edited while the full suite ran). | Corrected by the implementer in its round-2 report. The reviewer's rerun below is on one committed tree.                                                                                                   |
| 3   | note     | section B                                      | The disposable-checkout evidence (C-4, C-1(d), C-5) is the reviewer's to run.                                                                                                                                                                      | Run by the reviewer: below.                                                                                                                                                                                |

## Round 2 — changes-requested

Reviewed: two codex `gpt-6.2-sol` PR reviews of PR 117 (T162b) at `bfcf72e`
(four P2, five P3; no blocking finding), each checked and found valid. They
concern the fixture, the helpers, the configuration and two session cases —
files this task has already extended — so they are fixed on this branch; for
that this task's owned paths were widened by `playwright.config.ts`,
`notebook-auth.spec.ts` and `notebook-bfcache.spec.ts`.

| #   | Severity   | Where                                          | Finding                                                                                                                                        | Expected fix                                                                    |
| --- | ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 13  | should-fix | the three database-URL validators              | `postgresql:auto_canvas_test` (no slash) passed validation, but the driver strips the first character of the path: database `uto_canvas_test`. | Require the leading slash; refusal cases.                                       |
| 14  | should-fix | fixture and evidence script, cleanup           | A stalled `CREATE` or `DROP SCHEMA` made cleanup wait without a deadline.                                                                      | Bounded database work; `cleanup incomplete: schema <name>` and a non-zero exit. |
| 15  | should-fix | both check scripts                             | Output was inspected at the child's `exit`, before its streams had drained.                                                                    | Wait for `close`.                                                               |
| 16  | should-fix | N10f                                           | The measurement did not check the bearer of the version-preview requests.                                                                      | `expectBearers` per viewport phase.                                             |
| 17  | should-fix | `seedSingleUserRecovery`                       | The seeded single-user recovery record was one the real reader classifies as corrupt.                                                          | A record the production reader accepts, with a positive control.                |
| 18  | should-fix | notebook `webServer` in `playwright.config.ts` | Playwright probed the port before launching the fixture, so an occupant received a request before the fixture's bind check could refuse.       | Wait for the fixture's own `ready` line.                                        |
| 19  | should-fix | fixture and evidence script, child tracking    | A spawn that fails before a PID exists left cleanup waiting for an exit.                                                                       | Track a child once it has a PID; remove on `error`.                             |
| 20  | should-fix | N4a and similar windows                        | Between the switch and the new document's navigation the log rule allowed Bob's bearer.                                                        | No API request at all in that window.                                           |

## Round 3 — accepted

Reviewed: the working tree after round 2, then the branch restacked on `main`
(`2542db6`, after T162 was merged) on 2026-11-23.

| #     | Severity | Where     | Finding                                                                                                                                                                                                                                                                                                                                                        | Expected fix                           |
| ----- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 13–20 | fixed    | as listed | All eight fixed as asked. For 17 a new case, N11d, shows the standard production build offering the seeded draft and restoring it; with the old seed that case fails. For 18 a listener on the lane port received no request (it received `GET /canvas/api/health` with the old configuration). For 14 a silent PostgreSQL and a held lock are both exercised. | The check scripts and the 31 cases.    |
| 4     | note     | N4b       | Its window contains Alice's deliberate save, and its rule already requires every API request there to carry Alice's bearer; silence between the synthetic `focus` and the reload is not asserted there (N5b asserts it for the real `storage` event).                                                                                                          | Accepted as argued by the implementer. |
| 5     | note     | `main`    | `main` gained `entries/web-uuid` (a `crypto.randomUUID` fallback for plain-HTTP LAN origins), loaded first by `main.tsx`, so by the notebook build too. It touches neither storage nor the network.                                                                                                                                                            | The cases pass with it.                |

Acceptance on the restacked, committed tree, by the reviewer (lane 2;
`AUTO_CANVAS_API_URL` set for Playwright commands only):

```text
pnpm build → 0; pnpm build:notebook-editor → 0
standard listing → 459 tests equal the baseline; prefix listing → exactly the base-path case; notebook listing → 31 tests
13 configuration refusals → each fails and names its variable
node scripts/notebook-e2e-fixture-check.mjs → 0; five fail-at stages, ready, SIGINT, two SIGKILLs, four in-flight signals, reset, seed, failed spawn, stalled DROP, silent PostgreSQL twice, 33 refusals
node scripts/standalone-build-evidence-check.mjs → 0; 20 refusals, three interrupts, exit statuses, a descendant in its own group, failed spawn, stalled DROP, silent PostgreSQL
pnpm test:local scripts/launcher.test.mjs → 22 passed
AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test → 31 passed (50.3s); the report check: every one passed
C-1(a): the token key in 0 files of apps/editor/dist; the build test → 6 passed
env -u AUTO_CANVAS_API_URL pnpm test:local → 853 files passed, 3 skipped; 8868 tests passed, 117 skipped
pnpm typecheck / lint / format:check / docs:check → 0; changed paths only owned files
N12, pnpm test:e2e:local → 457 passed, 2 skipped by design (18.2m)
```

Section B, in a disposable checkout of the committed candidate (`1138788`),
by the reviewer:

```text
C-4: standard build, then notebook build → "C-4 ok: 5 references", "cleanup ok", exit 0
C-1(d): Agent-enabled standard production build on the owned server, the four Agent spec files without "a render crash" → 14 passed (28.3s), "cleanup ok", exit 0
interrupt of a real Playwright run after its browser had launched → exit 130; all 6 recorded processes gone, the browser included; "cleanup ok"; the schema gone
C-5: AUTO_CANVAS_BASE_PATH=/canvas pnpm build; node scripts/base-path-proxy.mjs --check → "Prefix proxy integration passed"; the base-path browser test → 1 passed
no standalone_evidence_ or prefix_test_ schema before or after; port 4273 free after each step
```

No product finding. With this, the browser half of work package W3 is
complete: T162 (merged), T162b and this task.

## Round 5 — accepted

Reviewed: the working tree after the round-4 fixes, on 2026-11-23. The
implementer worked on a copy branch (`review/t162c-round4` at the same head,
because the task branch is checked out in another worktree); the work was read
and the acceptance rerun by the reviewer.

| #   | Severity | Where                                                                                                                 | Finding                                                                                        | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 21  | fixed    | `scripts/notebook-e2e-fixture.mjs` `testDatabaseUrl()`, the evidence script's validator, `checkNotebookEnvironment()` | The database checked was the WHATWG pathname, which is not always what the driver connects to. | All three resolve the name with the driver's own parser (`pg-connection-string`, reached through `apps/server`) and refuse the parameters that redirect the connection (`host`, `socket`, `db`, `dbname`, `database`), quoting the resolved name. Cases: `?host=/tmp`, `?socket=/tmp`, `?database=`, `?db=`, `postgresql://%2Ftmp/auto_canvas_test_2?host=/tmp` (resolves `%2Ftmp/auto_canvas_test_2`), and the slash-less form (resolves `uto_canvas_test`). Refusals: fixture 33 → 38, evidence script 20 → 24, config loop 6 new forms. |
| 22  | fixed    | `apps/editor/e2e/notebook-worker.spec.ts` N7                                                                          | Only the two SVG responses were checked for `fromServiceWorker()`.                             | Every `/canvas/api` response during the controlled phases is recorded with its phase; after phase B none may come from the worker, with a positive control (`apiResponses.length > 0`); observed `{"perPhase":{"control":5,"alice":5,"bob":5},"fromServiceWorker":[]}`.                                                                                                                                                                                                                                                                    |
| 23  | fixed    | `scripts/standalone-build-evidence.mjs`                                                                               | A detached Chromium reparented between two scans matched neither group nor parent.             | A per-run UUID in the run children's environment; `ps eww` marks every process carrying it, added to the group and parent rules, so `cleanup ok` prints only when none survives. New check cases: an orphan in its own session whose parent exits at once (found by the marker) and a process that left the group. Stated limit: `ps` shows no environment for Apple's own binaries (verified on this macOS), so a system binary that also left the group and lost its parent is found by neither rule; `resource marker=active            | inert` reports whether the marker reaches our processes. |
| 24  | fixed    | `scripts/standalone-build-evidence.mjs` C-4                                                                           | Any script or style reference was accepted with either a JavaScript or a CSS type.             | The type must match the use (JavaScript for scripts and module preloads, `text/css` for stylesheets; an empty type is a problem); check case with a module script served as CSS and a stylesheet served as JavaScript.                                                                                                                                                                                                                                                                                                                     |

Acceptance rerun by the reviewer on this tree (lane 2, `AUTO_CANVAS_API_URL`
for Playwright only):

```text
pnpm build → 0; pnpm build:notebook-editor → 0
standard listing → 459 tests equal the baseline; notebook listing → 31 tests
4 database-URL forms (host, database, encoded socket host, slash-less) → each refused by the config, naming the variable
node scripts/notebook-e2e-fixture-check.mjs → 0; 38 refusals
node scripts/standalone-build-evidence-check.mjs → 0; 24 refusals; the C-4 type case, the marker orphan and the left-group case ok
pnpm test:local scripts/launcher.test.mjs → 22 passed
AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test → 31 passed (50.4s)
both printed schemas gone, all three printed PIDs gone, the schema list before = after
env -u AUTO_CANVAS_API_URL pnpm test:local → 8868 passed, 117 skipped
pnpm typecheck / lint / format:check / docs:check → 0
lanes free afterwards
```

Note: a first combined run of the same script reported the evidence check and
the notebook run as failed; both pass alone and in an immediate rerun of the
same script, and the first run's servers had already exited, so the reviewer
attributes it to the two steps overlapping on the lane rather than to a
reproducible defect. Recorded for honesty; the rerun above is the result of
record.
