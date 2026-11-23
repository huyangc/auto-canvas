# Repository reference cleanup

## Summary

Reviewed the checkout for GitHub URLs, escaped URL patterns, repository slugs and local source checkout paths. The initial scan found direct upstream repository references in 21 tracked files and two EDA command examples using the upstream checkout name.

## Steps

| Step | Status | Result |
| --- | --- | --- |
| Editor and desktop | Done | Desktop source permalinks target the project's Git origin. The crash screen offers local recovery actions. Change Log opens dated release notes in the current editor and returns focus to its button on close. |
| MCP distribution | Done | The server advertises the locally packaged executable and supplies host registration commands. The installer stops before downloading when the server declares local-only installation. Remote installation declarations must still match the project's exact release URL and pass the integrity check. |
| Documentation | Done | Removed upstream repository links and historical issue permalinks, updated EDA paths, and replaced upstream desktop release instructions with local packaging information. Regenerated the MCP documentation. |

## Acceptance results

- TypeScript check passed.
- The initial cleanup passed 115 focused Vitest tests. After the feedback and Change Log revision, all 48 tests in the five affected editor suites passed.
- MCP packaging completed, including the project build. The local stdio handshake reported version 0.17.88 and 25 tools. npm used a writable temporary cache.
- The Markdown link checker and generated agent documentation check passed.
- The tracked-file scan found one remaining repository address in the third-party desktop notice. No executable, configuration or test refers to the upstream repository.
- Two Chrome end-to-end tests passed against the built editor. One verified the local Change Log, Escape, Close, focus restoration and a single tab. The other exercised an actual render crash and reloaded the editor. Packaged Windows desktop acceptance was not run.

## Scope

The user authorized this independent worktree without a separate task plan. The base was the locally available origin/main at 42a13ed. The original desktop notice explicitly requires intact redistribution and is packaged verbatim. Its upstream URL, the original license, author credits and snapshot identification are preserved. Product names, protocol identifiers and hosted editor URLs fall outside the repository-link cleanup.
