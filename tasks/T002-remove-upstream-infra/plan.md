# T002 — Remove upstream delivery, process and Gallery tooling

- Branch: `task/T002-remove-upstream-infra`
- Base: `main` at `8f7e904`
- Status: approved

## Goal

auto-canvas has no hosted deployment, GitHub CI, npm/GitHub releases, Gallery
or upstream Issue/PR process. Remove the infrastructure that only served those,
so the repository holds the product code, its tests, its generators and a
simple local check. Afterwards `pnpm check` is the one command that says the
repository is healthy, and it passes except for the 3 known simulation
failures.

This task does **not** remove `worker/` (task T003 replaces it with a server),
simulation code, containers and simulator scripts (task T004), the desktop
app, the MCP server and its packaging, RNL, or `eda/`.

## Context

Verified on `main` at `8f7e904`:

- `pnpm test:local` has 5 failures: 3 pre-existing in
  `apps/editor/src/features/simulation/simulation-artifact-files.test.ts`
  (left for T004) and 2 in the upstream CI gate catalog
  (`scripts/lib/ci-validation-plan.test.mjs:123`,
  `scripts/lib/validation-gates.test.mjs:323`), which this task removes.
- CI and gates: `.github/` (12 workflows, actions, PR template),
  `config/validation-gates.json`, root scripts `gate:*`, `verify:*`, `ci:*`,
  `test:impact`, `test:affected`, and `scripts/` files such as `gate-plan`,
  `gate-run`, `verify-pr`, `ci-plan`, `ci-package-build`, `ci-workflow.test`,
  `check-test-impact`, `test-affected`, `check-core-results`, `e2e-slowest`,
  `run-environment-tests`, `environment-workflows.test`, `lib/ci-*`,
  `lib/validation-gates*`, `lib/verify-pr-selection*`, `lib/test-impact*`,
  `lib/changed-paths.test`, `lib/e2e-durations*`, `lib/environment-test-lanes`.
- Hosted deploy and release: `deploy-*`, `deployment-candidate*`,
  `preview-candidate*`, `lib/preview-candidate`, `retain-previous-assets*`,
  `editor-production-smoke`, `release-smoke`, `package-release`,
  `mcp-release-bump*`, `mcp-release-smoke`, `mcp-release-workflow.test`,
  `check-mcp-distribution*`, `verify-agent-manifest*`, `lib/published-mcp*`,
  `lib/mcp-release-integrity*`, `desktop-preview-workflow.test`,
  `simulator-host-workflow.test`. Root `wrangler.jsonc` and
  `wrangler.preview.jsonc` stay until T003 removes `worker/`.
- **Must stay:** `config/agent-mcp-distribution.json` is read by
  `packages/agent-adapter/src/mcp-distribution.ts`,
  `scripts/lib/headless-bundle.mjs`, `scripts/package-mcp.mjs` and
  `worker/agent-session.test.ts`. `scripts/package-mcp.mjs`,
  `scripts/package-headless.mjs` and `scripts/lib/headless-bundle.mjs` build
  the local MCP and headless bundle and stay. `config/gallery-*.json` are read
  by `worker/` and stay until T003.
- Imported from outside `scripts/` (must stay unless the importer goes too):
  `scripts/lib/distribution-security.mjs`, `lib/native-example-runner.mjs`,
  `lib/png-io.mjs`, `lib/razavi-fidelity.mjs`,
  `lib/razavi-reference-authority.mjs`.
- Gallery tooling outside `worker/`: `scripts/gallery-*`, `curate-gallery*`,
  `prepare-gallery-format-migration`, `refresh-gallery-redline`,
  `lib/gallery-*`, `apps/editor/census/` (Gallery census, with its own
  `vitest.config.ts`), `apps/editor/build/{editor-preload,gallery-early-fetch,usage-policy-shell}{,.test}.ts`
  (their Vite registrations were already removed in T001),
  `fixtures/gallery-redline/`. `packages/project-protocol/src/controlled-source-persistence.test.ts`
  imports `apps/editor/src/features/editor-shell/gallery-publish.ts`.
  T001 left these Gallery source helpers in `apps/editor/src` because of
  such consumers: `features/editor-shell/gallery-{example-commands,import,publication-permission,publish}.ts`,
  `gallery-early-fetch.ts`, `phone-viewing.ts`, `usage-policy-note.ts`, and
  the `gallery-*.ts` modules at the top level. `worker/` still imports
  `gallery-search.ts`, `gallery-reserved-ids.ts`, `gallery-client.ts` (types),
  `gallery-topology-match.ts`, `gallery-topology-selection.ts` and
  `apps/editor/analytics/{routes,worker}.ts`; those stay until T003.
- Upstream process: `.agents/skills/`, `references/`,
  `scripts/setup-agent-skills*`, `scripts/check-references.mjs`,
  `scripts/fetch-references.ps1`, root scripts `setup:skills`,
  `references:check`, `docs/development-workflow.md`, `docs/agents/`,
  `docs/deployment.md`, `docs/gallery-backup.md`. Feature specs for
  removed community features: `docs/specs/{community-gallery,selection-boards,analog-arena,component-publication}.md`.
  `CHANGELOG.md` is the upstream product changelog.
- `pnpm docs:check` (`scripts/check-markdown-links.mjs`) fails on links to
  deleted documents; links in kept docs must be fixed or removed.
- `knip.config.js`, `vitest.config.ts` and `playwright.config.ts` may list
  entries or projects for deleted files.

## Scope

Owned paths:

- `.github/**`, `.agents/**`, `references/**`, `config/validation-gates.json`
- `scripts/**` — except: simulation/simulator/VACASK/SG13G2/ngspice/native
  example scripts (T004), desktop packaging and security scripts, symbol and
  component generators, fonts, `format`, `lint`, `check-markdown-links`,
  `generate-agent-docs`, `generate-agent-authoring-catalog`,
  `agent-api-artifacts`, `package-mcp`, `package-headless`,
  `lib/headless-bundle`, `draw-batch` (+ its lib), `convert-project-format`,
  `rnl-canvas-package`, `export-golden`, `visual-golden`, `pwa-icons`,
  `editor-bundle-budget`, `performance-baseline`, `measure-edit-workloads`,
  `build-e2e-editor`, `codex-task.sh`, and any `lib/` module a kept script
  or kept code imports.
- `apps/editor/census/**`, `apps/editor/build/{editor-preload,gallery-early-fetch,usage-policy-shell}*`,
  `fixtures/gallery-redline/**`
- `apps/editor/src/**` — only to delete Gallery helpers that no remaining
  code imports after the deletions above (never one `worker/` imports).
- `packages/project-protocol/src/controlled-source-persistence.test.ts` —
  only to drop its dependency on `gallery-publish.ts` while keeping the
  persistence behavior it tests.
- `docs/**` (delete the documents named in Context; fix links elsewhere),
  `README.md`, `CHANGELOG.md`, `CODING_STANDARDS.md` (only references to the
  removed process), root `package.json` `scripts` (no dependency changes),
  `knip.config.js`, `vitest.config.ts`, `playwright.config.ts`.

Out of scope (do not change): `worker/**`, `wrangler*.jsonc`,
`config/agent-mcp-distribution.json`, `config/gallery-*.json`,
`config/vacask-preview-environment.json`, `containers/**`, `packages/**`
(except the one test above), `apps/{desktop,mcp-server,local-host}/**`,
`eda/**`, `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, `tasks/**`,
`.claude/**`, dependencies and `pnpm-lock.yaml`.

## Steps

1. Delete CI and gates: `.github/`, `config/validation-gates.json` and the
   gate/CI scripts in Context, plus any `scripts/lib` module only they use.
2. Delete hosted deploy and release scripts in Context, plus `lib/` modules
   only they use. Keep MCP/headless packaging working
   (`pnpm mcp:package`, `pnpm headless:package`).
3. Delete Gallery tooling: the scripts, `apps/editor/census/`, the three
   `apps/editor/build` Gallery modules and tests, `fixtures/gallery-redline/`.
   Rewrite `controlled-source-persistence.test.ts` so it no longer imports
   `gallery-publish.ts` (keep its assertions about persistence). Then delete
   the `apps/editor/src` Gallery helpers that nothing imports any more;
   keep every one `worker/` imports.
4. Delete the upstream process: `.agents/`, `references/`, skill setup and
   reference scripts, `docs/development-workflow.md`, `docs/agents/`,
   `docs/deployment.md`, `docs/gallery-backup.md`, the four community specs,
   `CHANGELOG.md`, `.github/pull_request_template.md` (with step 1).
   Remove mentions of the removed process from `CODING_STANDARDS.md`
   (it may still describe review standards). Fix every broken link
   (`pnpm docs:check`).
5. Root `package.json` scripts: remove every script that points at a deleted
   file or deleted script; remove `ci:*`, `gate:*`, `verify:*`,
   `release:*`, `mcp:release:*`, `mcp:distribution:check`, `mcp:smoke`,
   `setup:skills`, `references:check`, `test:impact`, `test:affected`,
   `gallery:*`. Add:
   `"check": "pnpm format:check && pnpm docs:check && pnpm agent-docs:generated:check && pnpm components:check && pnpm typecheck && pnpm lint && pnpm test:local && pnpm build"`.
   Update `knip.config.js`, `vitest.config.ts`, `playwright.config.ts` for
   deleted files.
6. Rewrite `README.md` for auto-canvas, in Chinese, under 60 lines: what it
   is (web schematic canvas for automatic analog placement and routing with
   human fine-tuning; origin in UPSTREAM.md; AGPL-3.0), how to install and
   run (`pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm check`), the
   repository layout (apps, packages, eda, docs/specs), and a link to
   `docs/workflow.md`. Fix `docs/README.md` so its map lists only documents
   that exist.
7. Sweep: `grep -rnE "\.github|gate:|verify:pr|ci:check|setup:skills|references/|development-workflow|\.agents/skills|tokenzhang|cloudflare.yml"` over
   kept files (excluding `worker/`, `node_modules`, `tasks/`, `AGENTS.md`,
   `CLAUDE.md`) and fix or justify each hit in the report.

## Acceptance

```bash
pnpm check                 # passes except: test:local reports exactly the
                           # 3 simulation-artifact-files.test.ts failures
pnpm mcp:package           # exit 0 (builds the local MCP bundle)
pnpm headless:package      # exit 0
pnpm test:desktop-build    # exit 0
pnpm deadcode              # report output; no unused file introduced by this task
git ls-files .github .agents references config/validation-gates.json apps/editor/census   # no output
```

Behavioral check: `pnpm dev` still serves the editor (Opus verifies).

## Notes for the implementer

- Rule for every deletion: find importers with `grep -rn` across the whole
  repository. If a kept file (anything out of scope, especially `worker/`,
  `packages/`, `apps/desktop`, `apps/mcp-server`, simulation scripts)
  imports it, keep it and list it in the report.
- `pnpm check` must not be made to pass by removing a kept check: keep
  `agent-docs:generated:check` and `components:check`. If a generator's
  output changes because a referenced doc was deleted, run the generator
  and report it.
- The commands `pnpm check`'s sub-steps run must work offline.
