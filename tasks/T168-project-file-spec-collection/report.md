# T168 report

(From the implementer subagent's hand-back; saved by the reviewer, because the
harness refuses a subagent's write of a `.md` file.)

## Summary

`apps/editor/e2e/project-file.spec.ts` no longer imports
`CLOUD_PROJECT_LIMIT` from the editor source; it declares the literal `200`
with a comment saying why. Playwright can collect the browser suite again:
459 tests in 53 files.

## Steps

| Step | Status | Notes                                                                                                                                    |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | The import is removed; `const CLOUD_PROJECT_LIMIT = 200;` follows the imports, with the comment the plan asks for. Nothing else changed. |

## Review findings addressed

None (round 1).

## Acceptance results

Run on lane 3 (`ICM_E2E_PORT=4373`, `AUTO_CANVAS_E2E_API_PORT=4331`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`,
`ICM_E2E_ISOLATED=1`, `AUTO_CANVAS_API_URL=http://127.0.0.1:4331`), because
lane 2 was in use by another task. Both ports were free before and after.

```text
pnpm exec playwright test --list apps/editor/e2e/project-file.spec.ts → 0; Total: 8 tests in 1 file
pnpm exec playwright test --list → 0; Total: 459 tests in 53 files
pnpm exec playwright test apps/editor/e2e/project-file.spec.ts --workers=1 → 0; 8 passed
git diff --exit-code origin/main -- apps/editor/src → 0; no difference
pnpm typecheck, pnpm lint, pnpm format:check, pnpm docs:check → 0
pnpm test:e2e:local --workers=1 → 0; 457 passed, 2 skipped (17.8m)
```

The two skipped tests are in `performance.spec.ts` (lines 220 and 330). No
test failed, so the collection error had hidden no failure.

## Deviations and open questions

- The fresh worktree had no built workspace packages, so the first `--list`
  failed on missing `@icm/*` `dist` modules. The build step of
  `test:e2e:local` was run first, then everything was rerun.
- The first full run was started without `AUTO_CANVAS_API_URL` and stopped by
  the PIDs of its own process tree after 22 tests, none of them from
  `web-agent-session.spec.ts`. The full suite was then run again with the
  variable set; the result above is from that run only. See the review.
