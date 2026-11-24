# T162b review

## Round 1 — accepted

Reviewed: the working tree on `task/T162b-notebook-browser-tests` (base
`f91d829`, the merge of `task/T162-notebook-editor-gate` and
`task/T168-project-file-spec-collection`) on 2026-11-22. The plan had four
rounds of codex `gpt-6.2-astra` review (verdict approve). Implementation by a
Claude Opus subagent. Read by the reviewer: the diff of `playwright.config.ts`,
the refusals, cleanup and server start of `scripts/notebook-e2e-fixture.mjs`,
and the cases N5b and the case list; the whole Acceptance block was rerun by
the reviewer.

| #   | Severity | Where                           | Finding                                                                                                                                                                                                                        | Expected fix                                                                                                                                        |
| --- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | note     | both spec files, `trace: "off"` | With the configured `trace: "retain-on-failure"` the trace recorder fetched every preview a second time without `Authorization` (401 in the fixture log), which a wire-level bearer assertion cannot tell from a page request. | Accepted: tracing is off in the notebook specs only; screenshots on failure stay.                                                                   |
| 2   | note     | plan, N5a ("places a resistor") | The editor arms its leave prompt only for a drawing of three or more objects (`MEANINGFUL_CONTENT_MIN_OBJECTS` in `document/project-content.ts`), so the calibration never raised a dialog with one.                           | The plan's wording was wrong; the case draws three, the calibration raises exactly one dialog, the switch none. Accepted.                           |
| 3   | note     | N4c                             | The case opens the Shelf picker, not the Shelf wall: the picker already sends `GET api/projects`, which is the request the case needs to answer 401.                                                                           | Accepted.                                                                                                                                           |
| 4   | note     | N10f                            | Measured: every version-row observer has `.version-list` as its root, which never scrolls (the dialog does); all three version previews are requested before any scrolling at 1280×200 and 1280×420.                           | The accepted limit of T162 (PR 114, codex round 5, P3): at most three rows. A measurement, not an assertion.                                        |
| 5   | note     | N4a                             | Chrome reported no `requestfailed` for the abandoned POST.                                                                                                                                                                     | Diagnostic only, as the plan says: the buffered complete POST with Alice's bearer, its 201 on release and the two users' lists establish ownership. |
| 6   | note     | T163                            | These cases run against T162's code. With T163 (per-user storage) the signed-out probes that call `indexedDB.databases()` on the page will throw by design.                                                                    | T163b owns adapting them (its contract says so).                                                                                                    |

No product finding: every prescribed assertion passes against the product.

Acceptance rerun by the reviewer (lane 2, `AUTO_CANVAS_API_URL` set for
Playwright commands only):

```text
pnpm build → 0; pnpm build:notebook-editor → 0
standard listing → 459 tests equal the reviewer's baseline
prefix listing → exactly the base-path case
notebook listing → 26 notebook tests in the two notebook spec files
11 refusals → each exits non-zero and names its variable
node scripts/notebook-e2e-fixture-check.mjs → 0; four fail-at stages, SIGINT, server SIGKILL, 27 refusals: all cleaned
AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test → 26 passed (37.1s); the report check: every one passed
this run's schema and both PIDs gone; no notebook_e2e_ schema before or after
env -u AUTO_CANVAS_API_URL pnpm test:local → 851 files passed, 3 skipped; 8831 tests passed, 117 skipped
pnpm typecheck → 0; pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0
changed paths → only owned files; docs/specs/server.md → only the two links
```

The `playwright.config.ts` diff, read separately: the standard branch gains
one ignore pattern (`**/notebook-*.spec.ts`); the base-path branch, the
standard web servers, reuse and launch settings are unchanged (the launch
options expression became a shared constant with the same value).

Open for W3: T162c (service worker, HTTP cache, offline, the C-1 / C-4 / C-5
evidence and the full standard run).

## Round 2 — changes-requested

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 117 at `0ca0f33` (three
P2, three P3; no blocking finding), each checked against the code and found
valid.

| #   | Severity   | Where                                                    | Finding                                                                                                                                                                                   | Expected fix                                                                                                                                                                                                    |
| --- | ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | should-fix | `scripts/notebook-e2e-fixture.mjs` (startup and cleanup) | A signal while `CREATE SCHEMA` is in flight lets cleanup drop the schema before it exists, and the create then leaves it behind; startup can also go on allocating after cleanup has run. | Startup does not advance once shutdown has begun; cleanup waits for the allocation in flight. The check script signals during schema creation and during server startup and verifies the exact schema and PIDs. |
| 8   | should-fix | fixture `/__fixture/reset`                               | Reset kept buffered held requests; a failed case could pass its held POST to the next one.                                                                                                | Reset discards held requests without forwarding them, and a body that finishes arriving after the reset is not queued. Checked directly.                                                                        |
| 9   | should-fix | `notebook-auth.spec.ts`, N10f                            | The measurement waited for all three version previews, making today's eager loading a requirement.                                                                                        | Wait for the observers' first evaluation, then record whatever was requested; assert only 0–3.                                                                                                                  |
| 10  | should-fix | `scripts/notebook-e2e-fixture-check.mjs`                 | A failing assertion after `ready` left the fixture running until the watchdog killed it, skipping cleanup.                                                                                | Stop and wait in a `finally`.                                                                                                                                                                                   |
| 11  | should-fix | `notebook-fixtures.ts`, config, fixture                  | A port written as `04273` is accepted but the helper's origin keeps the zero.                                                                                                             | One rule everywhere: refuse it, or normalise it.                                                                                                                                                                |
| 12  | should-fix | `notebook-auth.spec.ts` (Bob's editor after a switch)    | "None of Alice's names" was asserted page-wide; browser storage is shared until T163, so a restored tab may carry her name.                                                               | Scope to the Shelf.                                                                                                                                                                                             |

## Round 3 — accepted

Reviewed: the working tree after the round-2 fixes, on 2026-11-22. The fixture
diff read by the reviewer; the whole Acceptance block rerun by the reviewer.

| #   | Severity | Where                            | Finding                                                                                                                                      | Expected fix                                                                                                                                                                                                                                                                  |
| --- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | fixed    | fixture                          | Every startup allocation goes through `allocate()`, which refuses to start once shutdown has begun; cleanup awaits the allocation in flight. | New check cases: SIGINT and SIGTERM at a pause during schema creation and during server startup (four runs): exit 1, never ready, exact schema and PIDs gone. The pause makes the timing deterministic; it does not force the `CREATE` to be uncommitted when cleanup starts. |
| 8   | fixed    | fixture reset                    | A generation counter; held requests are ended unanswered and unforwarded.                                                                    | New check case with one complete and one half-sent POST.                                                                                                                                                                                                                      |
| 9   | fixed    | N10f                             | A probe records each observer's root, targets and first callback; the case asserts only 0–3.                                                 | Observed unchanged: all three requested, every row observer rooted at `.version-list`.                                                                                                                                                                                        |
| 10  | fixed    | fixture check                    | `withRun()` stops the fixture in a `finally`.                                                                                                | —                                                                                                                                                                                                                                                                             |
| 11  | fixed    | fixture, config, helper          | Refused everywhere ("without leading zeros"); the refusal list has the two port forms (29 refusals).                                         | —                                                                                                                                                                                                                                                                             |
| 12  | fixed    | `expectBobsOwnEditor` (N4a, N4b) | The name search is scoped to the Shelf wall.                                                                                                 | The other cases search the signed-out or cleared page, which is right.                                                                                                                                                                                                        |

Acceptance rerun by the reviewer: see the PR comment for this head.
