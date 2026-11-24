# T175 review

## Round 1 — accepted

Reviewed: `git diff origin/main` on `task/T175-test-speed` at `fc6031d`;
acceptance rerun by Opus.

| #   | Severity                   | Where                                          | Finding                                                                                                                                                                                                              | Expected fix                                                                                                                                                                   |
| --- | -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | should-fix (fixed by Opus) | `packages/auto-layout/test/stages.test.ts:255` | The plan's 40-device default replacement still runs the full search budget (5.1 s alone, ~9 s under load) and largely repeats R55's 60-instance determinism check; it also dropped the `candidates === 0` assertion. | 41 devices: the smallest chain on the same large-document budget as the 120-device case, 1.1 s, and `candidates === 0` holds again. Two-line fix plus comment, done in review. |
| 2   | note                       | `corpus.test.ts`                               | The "rest" file keeps the T074 two-inverters timeout comment although two-inverters now runs in its own file.                                                                                                        | Harmless; left as is.                                                                                                                                                          |
| 3   | note                       | CI                                             | This PR changes `package.json`, so its own format step falls back to a full check; the changed-files path shows on the next PR that does not touch formatting config.                                                | Check on a later PR's CI log.                                                                                                                                                  |

Checked: every changed path is in the owned paths (plus the `*.test-support.ts`
deviation recorded in report.md); moved slow blocks keep titles, assertions and
timeouts; split files cover each original title once (implementer's `vitest
list` diff, consistent with the 9055/16 counts below).

Acceptance rerun:

```text
pnpm build && pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint --quiet && pnpm deadcode → 0
pnpm test:local → 0 (858 files passed, 3 skipped; 8939 passed, 116 skipped of 9055; real 44.76 s)
pnpm test:slow → 0 (6 files, 16 passed; real 64.31 s)
pnpm exec vitest run packages/auto-layout/test/stages.test.ts (after fix) → 0 (21 passed)
```
