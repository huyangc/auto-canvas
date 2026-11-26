# T186 report — round 3

## Summary

The Razavi visual contract now requires reviewers to compare every affected target with its pinned witness before approving a geometry or typography change. This includes symbols absent from golden projects.

## Steps

| Step | Status | Notes                                                                                                                                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–5  | done   | Earlier rounds removed the retired tools and their helpers, dependency, configuration and exports. The reference scan and both Knip runs passed this round. |
| 6    | done   | Updated the Pixel fidelity section of the Razavi visual contract.                                                                                           |
| 7    | done   | Ran every acceptance command from the plan and recorded the results below.                                                                                  |

## Review findings addressed

1. The approval procedure requires the evidence and catalog checks, a visual comparison against the pinned raster or PDF crop for each affected orientation, sample and variant, and the formal scene and export golden checks.
2. Ran the formatting and documentation checks and updated this report.

## Acceptance results

```text
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 73 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components, 106 Razavi symbol assets and 1 semantic primitive
pnpm symbols:razavi:check → 0, validated signal flow and magnetic assets, component and symbol catalogs, and generated Agent docs
pnpm typecheck → 0, no TypeScript diagnostics
pnpm lint → 0, 2190 files, 0 errors and 4001 warnings
pnpm deadcode → 0, both Knip runs completed without findings
pnpm build → 0, editor build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/symbols scripts/lib/razavi-reference-authority.test.mjs → 0, 1274 tests passed and 109 skipped (78 files passed and 1 skipped)
grep -rn "apps/local-host\|eda/\|docs/eda-import\|tools/calibration\|tools/pdf-vector-extract\|NETLIST_MARK_RULE_VERSION\|razavi-fidelity\|symbol-rasterize\|png-io" README.md README_zh.md docs/ scripts/ packages/ apps/ knip.config.js --exclude-dir=dist --exclude-dir=node_modules → 1, no matches as expected
```

## Investigation results

Knip found no further unused exports.

## Deviations and open questions

None.
