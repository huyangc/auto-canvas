# T185 review

- Verdict: approved (round 2)
- Reviewer: coordinator (Antigravity)
- Reviewed commit base: `origin/main` (`1cd864dc`)

## Round 1 findings (resolved in round 2)

1. Removing `scripts/promote-example.mjs`'s dynamic `import("../packages/project-protocol/dist/index.js")` exposed 25 unused exports and 51 unused exported types in `packages/project-protocol/src/` under Knip. Scope was expanded to `packages/project-protocol/src/**` and resolved cleanly in round 2 (`previous-to-current.ts` reduced from 205 to 28 lines, 5 unused `*WithReport` helpers unexported, 8 migration tests pointed directly to `./transforms/*.js`, and test-only contract exports tagged `@internal` per `knip.config.js`).

## Checks run by reviewer

- `pnpm format:check` — exit 0
- `pnpm docs:check` — exit 0
- `pnpm agent-docs:generated:check` — exit 0
- `pnpm components:check` — exit 0
- `pnpm typecheck` — exit 0
- `pnpm lint` — exit 0 (0 errors)
- `pnpm deadcode` — exit 0 (both `knip` and `knip --production` passed)
- `pnpm build` — exit 0
- `pnpm test:local` — 844/854 passed in the parallel run; the 8 PostgreSQL-backed files that timed out due to bloated local `auto_canvas_test` schemas were re-run after recreating `auto_canvas_test` and all passed (`apps/server/src/{app,notebook-auth,component-catalog,component-library,component-management}.test.ts` + `apps/editor/src/{agent/browser-agent-components,agent/component-management-live,agent/component-publication-live,features/user-components/component-publication-host}.test.ts`).

## Findings

None. All edits stay inside the approved scope and preserve the tombstoned Agent API `GALLERY_UNAVAILABLE` contract and all migration test assertions.
