# T185 report — round 2

## Summary

Completed the Project protocol export cleanup identified in round 1. Both Knip runs passed, along with all 361 tests in the three requested test runs.

## Steps

| Step | Status | Notes                                                                                                                                   |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Round 1 removed Gallery migration and example-promotion scripts. Offline converter tests passed again.                                  |
| 2    | done   | Round 1 removed Worker allowance and policy handling. Account and request-failure tests passed again.                                   |
| 3    | done   | Round 1 removed publication metadata from editor state and Cloud Project requests. The editor lifecycle and service tests passed again. |
| 4    | done   | Round 1 removed the retired server summary field, request validation and related test cases.                                            |
| 5    | done   | Round 1 updated the migration, persistence and server specs. Documentation checks passed again.                                         |
| 6    | done   | Removed obsolete migration re-exports and updated the tests that imported report helpers through the package entry points.              |
| 7    | done   | Ran all planned acceptance checks and recorded the results below.                                                                       |

## Review findings addressed

1. Removed 51 type re-exports, the four schema 49 through 53 upgrade re-exports, and all 25 report-helper re-exports from `previous-to-current.ts`. Eight test files now import report helpers directly from their transforms. Five helpers became module-local. The remaining 20 helpers, `validateProject`, and `PREVIOUS_PROJECT_SCHEMA_VERSION` carry an `@internal` tag explaining their use in tests. The migration test changes are confined to imports.
2. Re-ran the planned checks, including both Knip modes, the Project protocol suite, and the browser Agent host contract tests.

## Acceptance results

```text
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 74 files
pnpm agent-docs:generated:check → 0, 6 outputs, 0 stale
pnpm components:check → 0, validated 110 components, 38 electrical descriptors, 66 subcircuit descriptors, 106 Razavi symbol assets and 1 semantic primitive
pnpm typecheck → 0
pnpm lint → 0, 2183 files, 0 errors, 4001 warnings
pnpm deadcode → 0, both knip --no-progress and knip --production --no-progress passed
pnpm build → 0, editor build completed with a Vite chunk-size warning
pnpm test:local scripts/convert-project-format.test.mjs apps/editor/src/request-failure.test.ts apps/editor/src/components/account.test.tsx apps/editor/src/features/editor-shell/cloud-projects.test.ts apps/editor/src/services/web-editor-services.test.ts apps/editor/src/app/agent-workspace-requests.test.ts apps/editor/src/document/use-project-file-lifecycle.test.tsx apps/editor/src/document/workspace-reopen.test.ts → 0, 8 files and 139 tests passed
pnpm test:local packages/project-protocol → 0, 49 files and 214 tests passed
pnpm test:local apps/editor/src/agent/browser-agent-project-host.test.ts → 0, 1 file and 8 tests passed
grep -rn "galleryEntryId\|noteGalleryPublication\|noteProjectPublished\|publishedSnapshotToken\|daily-allowance\|usage-policy-note\|prepare-gallery-format-migration\|promote-example\|example-promotion" apps/editor/src apps/server/src scripts docs/specs --exclude="browser-agent-project-host*" --exclude="agent-session.test.ts" --exclude="agent-api.md" → 1, zero matches as expected
git diff --check → 0
```

## Investigation results

Both Knip modes passed after the export cleanup using the existing configuration.

## Deviations and open questions

The full PostgreSQL-backed test run is assigned to the coordinator during review.
