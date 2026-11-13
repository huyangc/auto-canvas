# T066 review

## Round 1 — accepted (50% target missed)

Reviewed: `git diff HEAD` on `task/T066-lean-ci-tests` on 2026-11-12;
acceptance rerun by Opus, including the full `pnpm test:local` outside the
Codex sandbox.

`*.slow.test.*` files are excluded from the default `modules` and `isolated`
projects and run only through `pnpm test:slow` (`vitest --mode slow --project
slow`). `held-out.slow.test.ts` is byte-identical to the previous
`held-out.test.ts`; the default `held-out.test.ts` keeps every validity,
Net, name-claim and floating-pin assertion with a zero-budget search and drops
only the T013 crossing ceiling, which lives on in the slow file. Corpus plans
are shared per fixture (`corpus-plans.ts`); R22 keeps its two determinism
plans. Docs require `pnpm test:slow` as review evidence for auto-layout
changes.

Default auto-layout test-file time 133.5 → 88.5 s (−33.7%), below the 50% aim
because the remaining default tests legitimately plan with the full default
search (determinism, corpus electrical checks). Accepted: the aim was a proxy
for CI passing, which the combined PR's CI will show.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
git diff --check → 0
pnpm test:local → 0; 785 files, 8011 tests passed, 117 skipped
pnpm test:slow → 0; 1 file, 7 tests passed
```
