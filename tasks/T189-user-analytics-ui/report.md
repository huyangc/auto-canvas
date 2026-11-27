# T189 report — round 1

## Summary

Implemented the administrator analytics dashboard for standalone accounts and silicon-notebook, the account management controls, and five editor usage events on `user_analytics_system` at base `b7663d5a`. The implementation and regression tests pass. Both production builds succeed. The route byte-budget check is blocked by a missing preload manifest in the base build.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Vite forwards the deployment-prefixed admin API in dev and preview. |
| 2 | done | SVG, raster, netlist, project export and auto-layout report outcomes. File-command and layout tests cover delivery, failure and cancellation. |
| 3 | done | Added a base-aware client, overview, SVG charts, cohorts, feature adoption, user search and detail, and accounts-mode mutations. Reset passwords are shown in a dismissible banner. Deletion requires an exact username match. |
| 4 | done | Signed-in accounts enter analytics through the account gate with the existing scoped fetch. The account menu exposes the link to admins. Password-change-required accounts see a notice and sign-out control. |
| 5 | done | The notebook gate passes the confirmed identity through startup. The analytics route loads its own module. Normal editor sessions expose the analytics link to notebook admins. |
| 6 | done | UI tests exercise time windows, paging, search, sorting, drill-down, mutation refresh, own-account protection, clipboard copy, rejected mutations, notebook restrictions and denied access. Notebook entry tests verify the deployment-prefixed API path and bearer header. |

## Review findings addressed

Round 1 had no review findings.

## Acceptance results

```text
pnpm exec vitest run apps/editor/src/features/analytics apps/editor/src/accounts apps/editor/src/notebook apps/editor/src/features/editor-shell/editor-file-commands.test.ts apps/editor/src/features/auto-layout/use-auto-layout.test.tsx scripts/notebook-editor-build.test.mjs
  → 0. 16 files and 214 tests passed, including the original notebook storage and import-locality checks.

pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check
  → 0. Typecheck passed. Lint reported 0 errors and 4003 warnings. Formatting passed. The documentation checker validated 73 files.

pnpm deadcode
  → 0. Both Knip passes completed without findings.

pnpm build && pnpm build:notebook-editor && node scripts/editor-bundle-budget.mjs --check
  → 1. Both builds exited 0. The budget script stopped at scripts/editor-bundle-budget.mjs:52 with “No editor preload resources found in index.html”.

pnpm exec vitest run apps/server
  → 0 with local PostgreSQL access. 23 files and 431 tests passed. The first sandboxed run was denied a loopback connection to port 5432.

pnpm exec vitest run apps/editor/src/document/use-project-file-lifecycle.test.tsx
  → 0. All 65 lifecycle regression tests passed.

git diff --check
  → 0.
```

## Investigation results

The budget script expects `editorResources` and `galleryResources` in the standard build's HTML. A separate build from a clean archive of `b7663d5a` reproduced the same error. That commit lacks the preload generator named by the script.

Both new production builds emitted separate dashboard JavaScript and CSS chunks. Inspection of the HTML asset references and their transitive static JavaScript imports found neither dashboard chunk in either initial shell. The standard shell had six static assets in both builds, totaling 234,932 raw bytes at the base and 235,848 raw bytes after this change. This measurement covers only the initial shell.

## Deviations and open questions

The editor and gallery route ceilings remain unverified. Reconciling the budget script with the branch's build output requires work outside the approved paths. The budget fixture and notebook build assertions retain their original contents.
