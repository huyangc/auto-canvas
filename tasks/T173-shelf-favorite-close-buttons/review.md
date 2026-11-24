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
