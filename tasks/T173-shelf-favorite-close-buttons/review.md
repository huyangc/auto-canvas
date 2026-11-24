# T173 review

## Round 1 — accepted

Reviewer: Opus main session.

- Diff (plan commit..implementation) touches 23 files, all owned except
  `project-tabs.css`; that edit applies the same `:where` exclusion to the
  tab-strip host's leaking rules, which the plan's "both hosts" check requires.
  Accepted.
- Reran: `pnpm format:check`, `pnpm typecheck`, `pnpm deadcode`, vitest on
  components / auto-layout / version-history preview (24 files, 142 tests),
  `pnpm build` — all pass. After rebasing onto `fa9a252` (PR 128): typecheck
  passes; the seven listed e2e specs pass on lane 2 (63 passed).
- Screenshots (File host: wall, rename, version history) match the request:
  heart right of the name, red when on; filter top right; × top right of
  version history with no footer; compact Save/Cancel.
- Heart is a sibling of the link (no nested interactive content), toggle uses
  `aria-pressed`; no test weakened.

## Round 2 — codex PR review round 1 findings (P2/P3), fixed by Opus as a small fix

- P2 menu outlives a filter switch: `showFilter` closes the tile menu before
  changing the filter; `shelf-wall-limit.test.tsx` opens Bias's menu, switches
  to Favorites by click (no outside pointerdown) and expects no menu. The test
  fails without the fix (1 failed) and passes with it.
- P3 clipped focus ring: `.shelf-filter button:focus-visible` draws an inset
  2px outline.
- P2 missing acceptance results, rerun by Opus on this head:
  `pnpm format:check` OK; `pnpm lint` exit 0; `pnpm test:local` exit 0
  (848 files passed / 3 skipped, 8780 tests passed / 116 skipped); the plan's
  Close-text scan over `apps/editor/src` (excluding `hosts/native`) finds no
  hits.
