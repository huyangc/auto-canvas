# T186 report — round 1

## Summary

Removed the retired static host, offline EDA import scripts and Razavi calibration and PDF extraction tools. Cleaned up their dependencies, exports and documentation. All acceptance checks passed.

## Steps

| Step | Status | Notes                                                                                                                                                                        |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Removed the three subtrees and the EDA guide. The deleted host and EDA tests exercised entry points removed in this round.                                                   |
| 2    | done   | Removed the fidelity, rasterization and PNG I/O helpers used by the retired tools.                                                                                           |
| 3    | done   | Removed the root pngjs devDependency.                                                                                                                                        |
| 4    | done   | Removed the obsolete tool entries and host workspace from Knip.                                                                                                              |
| 5    | done   | Removed NETLIST_MARK_RULE_VERSION and made getRazaviCatalogSymbol local. The symbols index had no explicit re-export.                                                        |
| 6    | done   | Updated both READMEs, the documentation index, the persistence ADR and the Razavi and RNL contracts. The Web editor Viewer flow and the PDF manifest kind remain documented. |
| 7    | done   | Ran all acceptance commands and the reference scan.                                                                                                                          |

## Review findings addressed

First implementation round. No review findings were supplied.

## Acceptance results

```text
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 73 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components, 106 Razavi symbol assets and 1 semantic primitive
pnpm symbols:razavi:check → 0, signal flow, magnetic assets, component and symbol catalogs and generated docs validated
pnpm typecheck → 0, TypeScript completed without diagnostics
pnpm lint → 0, 2190 files, 0 errors and 4001 warnings
pnpm deadcode → 0, both Knip runs completed without findings
pnpm build → 0, editor build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/symbols scripts/lib/razavi-reference-authority.test.mjs → 0, 1274 tests passed and 109 skipped (78 files passed and 1 skipped)
grep -rn "apps/local-host\|eda/\|docs/eda-import\|tools/calibration\|tools/pdf-vector-extract\|NETLIST_MARK_RULE_VERSION\|razavi-fidelity\|symbol-rasterize\|png-io" README.md README_zh.md docs/ scripts/ packages/ apps/ knip.config.js --exclude-dir=dist --exclude-dir=node_modules → 1, no matches as expected
```

## Investigation results

Knip found no additional unused exports after the planned removals.

## Deviations and open questions

The supplied task branch was at `51990353`. Its existing owned files matched the plan's baseline `1cd864dc`. The offline lockfile refresh remains assigned to the coordinator.
