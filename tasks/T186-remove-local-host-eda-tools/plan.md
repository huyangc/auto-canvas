# T186 — Remove `apps/local-host`, `eda/`, `tools/`, and their orphan helpers and docs

- Branch: `task/T186-remove-local-host-eda-tools`
- Base: `main` at `1cd864dc`
- Status: approved
- Plan review: self-checked against the code (user requested coordinator plan + Codex implementation + review)

## Goal

Remove three retired standalone tool/host subtrees that are no longer part of `auto-canvas` — `apps/local-host/` (superseded by `apps/server`), `eda/` (offline Aether/Virtuoso import scripts and docs), and `tools/` (one-off Razavi PDF vector extractor and calibration scripts) — along with the helper modules, exports, `package.json` dependency (`pngjs`), Knip entries, and documentation links whose only consumers were those subtrees.

## Context

Verified against `origin/main` at `1cd864dc`:

- **`apps/local-host/`**:
  - Workspace package `@icm/local-host` (`apps/local-host/{package.json,tsconfig.json,src/*}`). No other package or script depends on it.
  - Referenced in: `knip.config.js:98-100`, `README.md:134`, `README_zh.md:120`, `docs/adr/persistence.md:4`, and `docs/specs/rnl-interchange.md:61,70-72,486-487`.
  - Removing `apps/local-host/` changes the workspace graph; the coordinator will refresh `pnpm-lock.yaml` offline after Codex finishes.
- **`eda/`**:
  - Standalone Python/MJS Aether and Virtuoso import scripts + `docs/eda-import.md`.
  - Referenced in: `knip.config.js:53-55,62`, `README.md:44,141,161,175`, `README_zh.md:38,127,145`, `docs/README.md:16`, and `packages/netlist/src/export.ts:141-185`.
  - Removing `eda/snapshot.mjs` leaves `export const NETLIST_MARK_RULE_VERSION = 15` in `packages/netlist/src/export.ts:185` with zero remaining consumers (remove the dead constant and its doc comment).
- **`tools/`**:
  - Standalone `tools/calibration/razavi/` and `tools/pdf-vector-extract/` directories.
  - Referenced in: `knip.config.js:48,61` and `docs/specs/razavi-visual-contract.md:9-11` (keep line 27's `"pdf-vector-extract"` manifest `kind` contract, which is actively validated by `scripts/lib/razavi-reference-authority.mjs` and the Razavi symbol generators).
  - Removing `tools/calibration/razavi/` leaves four files/exports with zero remaining consumers:
    - `scripts/lib/razavi-fidelity.mjs` (only imported by `tools/calibration/razavi/symbol-fidelity-diff.mjs`)
    - `scripts/lib/symbol-rasterize.mjs` (only imported by `scripts/lib/razavi-fidelity.mjs`)
    - `scripts/lib/png-io.mjs` (only imported by `tools/calibration/razavi/text-fidelity-diff.mjs`, `symbol-fidelity-diff.mjs`, `scripts/lib/razavi-fidelity.mjs`, and `scripts/lib/symbol-rasterize.mjs`)
    - `pngjs` devDependency in root `package.json:114` (only imported by `scripts/lib/png-io.mjs`)
    - `export` on `getRazaviCatalogSymbol` in `packages/symbols/src/razavi-catalog.ts:148` (still called internally on line 156, and re-exported by `packages/symbols/src/index.ts` if applicable — drop the export so Knip stays green).
- **Bonus doc cleanup in touched READMEs**:
  - `README.md:108` ("The offline desktop preview does not send events.") and `README_zh.md:95` ("离线桌面预览不向服务端发送事件。") and `README.md:175` ("the desktop preview and the EDA export scripts") can be tidied while editing `README.md` / `README_zh.md`.
- **Keep**:
  - `fixtures/visual-reference/razavi-reference-v1/**` and `scripts/lib/razavi-reference-authority{.mjs,.test.mjs}` and `scripts/generate-razavi-*.mjs` (actively used by `pnpm symbols:razavi:check` and `pnpm components:check`).
  - `packages/exporters`'s `rasterizeSvgBytes` (actively used by `scripts/pwa-icons.mjs`).

## Scope

Owned paths (may be created, edited or deleted):

- `apps/local-host/**`
- `eda/**`
- `tools/**`
- `docs/eda-import.md`
- `scripts/lib/razavi-fidelity.mjs`
- `scripts/lib/symbol-rasterize.mjs`
- `scripts/lib/png-io.mjs`
- `package.json`
- `knip.config.js`
- `packages/netlist/src/export.ts`
- `packages/symbols/src/razavi-catalog.ts`
- `packages/symbols/src/index.ts`
- `README.md`
- `README_zh.md`
- `docs/README.md`
- `docs/adr/persistence.md`
- `docs/specs/razavi-visual-contract.md`
- `docs/specs/rnl-interchange.md`
- `apps/server/src/base-path.test.ts`
- `.gitignore` (only if removing `tools/`-specific comments; keep unrelated lines untouched)
- `tasks/T186-remove-local-host-eda-tools/report.md`

Out of scope (do not change):

- `pnpm-lock.yaml` (do not edit or run `pnpm install`; the coordinator refreshes `pnpm-lock.yaml` offline after this round)
- `package.json` lines outside `pngjs` (leave other dependencies to T184 to avoid merge conflicts)
- `fixtures/visual-reference/**` and `scripts/lib/razavi-reference-authority*` and `scripts/generate-razavi-*.mjs`
- `docs/specs/rnl-interchange.md` lines 33–60 (owned by T184; only update the `local-host` sentences at lines 61–73 and 486–487)

## Steps

1. Delete `apps/local-host/`, `eda/`, `tools/`, and `docs/eda-import.md`.
2. Delete the now-unreferenced calibration helper scripts `scripts/lib/razavi-fidelity.mjs`, `scripts/lib/symbol-rasterize.mjs`, and `scripts/lib/png-io.mjs`.
3. Remove `pngjs` from `devDependencies` in root `package.json` (do NOT edit other dependencies, do NOT edit `pnpm-lock.yaml`, and do NOT run `pnpm install`).
4. Remove dead entries from `knip.config.js`:
   - Remove `"tools/**/*.mjs!"` (lines 48 and 61).
   - Remove `"eda/{build,export,snapshot}.mjs!"` (line 55) and `"eda/**/*.mjs!"` (line 62) and update the comment on lines 53–54.
   - Remove the `"apps/local-host"` workspace block (lines 98–100).
5. Clean up exports left unused by deleting `eda/` and `tools/`:
   - In `packages/netlist/src/export.ts`: remove `NETLIST_MARK_RULE_VERSION` and its doc comment (lines 141–185).
   - In `packages/symbols/src/razavi-catalog.ts`: drop `export` from `getRazaviCatalogSymbol` (keep it as a local helper for line 156); if `packages/symbols/src/index.ts` re-exports it explicitly, remove it there too.
   - Run `pnpm deadcode` to confirm whether any other export in `packages/*` or `scripts/` became unused; if any other symbol in owned paths is flagged, clean it up cleanly.
6. Update documentation references:
   - `README.md`: remove the `eda/` feature bullet (line 44), remove `The offline desktop preview does not send events.` (line 108), remove `local-host/` (line 134) and `eda/` (line 141) from Repository layout, remove `- [EDA tools](docs/eda-import.md)` (line 161).
   - `README_zh.md`: remove the `eda/` feature bullet (line 38), remove `离线桌面预览不向服务端发送事件。` (line 95), remove `local-host/` (line 120) and `eda/` (line 127) from 仓库结构, remove `- [EDA 工具](docs/eda-import.md)` (line 145).
   - `docs/README.md`: remove the `EDA tools` row (line 16).
   - `docs/adr/persistence.md`: remove `, \`apps/local-host\`` from line 4.
   - `docs/specs/razavi-visual-contract.md`: update lines 9–11 to drop the deleted `tools/calibration/razavi/README.md` and `tools/pdf-vector-extract/README.md` links while keeping the `[component guide](../../packages/components/README.md)` link and all provenance/authority rules intact.
   - `docs/specs/rnl-interchange.md`: update lines 61 and 70–72 to remove the `local-host` composition wording (keep Web editor **Open RNL Viewer** behavior intact, and leave lines 33–60 untouched to stay conflict-free with T184), and delete lines 486–487 (`apps/local-host/src/local-host.test.ts`).
7. Run the acceptance commands below and write `tasks/T186-remove-local-host-eda-tools/report.md` following `tasks/_template/report.md`.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm format:check              # expected: exit 0
pnpm docs:check                # expected: exit 0
pnpm agent-docs:generated:check # expected: exit 0
pnpm components:check          # expected: exit 0
pnpm symbols:razavi:check      # expected: exit 0
pnpm typecheck                 # expected: exit 0
pnpm lint                      # expected: exit 0
pnpm deadcode                  # expected: exit 0
pnpm build                     # expected: exit 0
pnpm test:local packages/netlist packages/symbols scripts/lib/razavi-reference-authority.test.mjs # expected: exit 0
```

Behavioral checks:

- `grep -rn "apps/local-host\|eda/\|docs/eda-import\|tools/calibration\|tools/pdf-vector-extract\|NETLIST_MARK_RULE_VERSION\|razavi-fidelity\|symbol-rasterize\|png-io" README.md README_zh.md docs/ scripts/ packages/ apps/ knip.config.js --exclude-dir=dist --exclude-dir=node_modules` returns no matches.
- `pnpm symbols:razavi:check` and `pnpm components:check` still pass (Razavi symbol generation and reference authority remain intact).

## Notes for the implementer

- Do NOT run `pnpm install` and do NOT touch `pnpm-lock.yaml`; the coordinator will refresh `pnpm-lock.yaml` offline after this round.
- Do NOT commit; leave changes in the working tree on `task/T186-remove-local-host-eda-tools`.
- Avoid touching lines 33–60 of `docs/specs/rnl-interchange.md` or non-`pngjs` lines of `package.json` so this branch merges cleanly alongside T184.
