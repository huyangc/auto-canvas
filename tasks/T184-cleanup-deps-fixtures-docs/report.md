# T184 report — round 1

## Summary

Removed seven unused dependency declarations across five manifests, the orphan Gallery configs and fixtures, the Nix flake, and their obsolete Git rules and documentation. The RNL spec now directs users to the Netlist panel for copying and **File → Export → Export Netlist** for saving.

## Steps

| Step | Status | Notes                                                                                                  |
| ---- | ------ | ------------------------------------------------------------------------------------------------------ |
| 1    | done   | Removed the seven specified declarations and verified the three dependencies identified for retention. |
| 2    | done   | Deleted the three Gallery configs and the batch-drawing paragraph for the retired import command.      |
| 3    | done   | Deleted the editor production smoke and ngspice failure fixtures.                                      |
| 4    | done   | Deleted the Nix flake and its lock file.                                                               |
| 5    | done   | Removed the obsolete Wrangler, ngspice and PDK rules and associated comments.                          |
| 6    | done   | Updated the four specs for current web editor and server behavior, retaining the local-host text.      |
| 7    | done   | Ran all eight acceptance scripts and both behavioral checks.                                           |

## Review findings addressed

Round 1 had no review findings.

## Acceptance results

```text
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 74 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components, 38 electrical descriptors, 66 subcircuit descriptors, 106 Razavi symbol assets and 1 semantic primitive
pnpm typecheck → 0, no diagnostics
pnpm lint → 0, oxlint: 2190 files, 0 errors, 4001 warnings
pnpm deadcode → 0, both Knip passes completed
pnpm build → 0, editor build completed with a Vite chunk-size warning
pnpm exec knip --include dependencies --no-progress → 1, only the three retained declarations listed below
grep -rn "gallery-sim\|gallery-taxonomy\|gallery-sources\|editor-production-smoke\|ngspice-failures\|flake\.nix" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=tasks → 1, no matches
git diff --check → 0
```

## Investigation results

The targeted Knip scan reported only the planned exceptions. Each has a consumer:

| Retained declaration                             | Consumer                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Editor’s `@fontsource-variable/google-sans-code` | CSS import in `apps/editor/src/styles.css:1`                                 |
| Agent client’s `@icm/model`                      | Public declaration in `packages/agent-client/dist/session-resources.d.ts:76` |
| Auto-layout’s `@icm/netlist`                     | Test import in `packages/auto-layout/test/corpus.test-support.ts:10`         |

## Deviations and open questions

The coordinator owns the planned lockfile refresh. This round used the existing dependency installation.
