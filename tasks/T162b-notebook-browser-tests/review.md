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
