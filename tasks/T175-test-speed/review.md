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

## Round 2 — accepted (codex PR review round 1 findings, fixed by Opus)

Codex `gpt-6.2-sol` reviewed `bcb64b7` (PR 134 comment 7126190022): three P2,
all verified and fixed in review (each a few lines).

| #   | Severity | Where                                                                 | Finding                                                                                                                       | Fix                                                                                                                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2       | `scripts/format.mjs:39`                                               | `path.matchesGlob` skips dot segments, so a PR changing only `.oxlintrc.json` checked 0 files while the full check covers it. | Also match the path with leading dots stripped from each segment; two regression cases in `scripts/format.test.mjs` (fail on the old script, pass now). `scripts/format.*` added to the task's touched paths for this fix. |
| 2   | P2       | `packages/auto-layout/test/corpus.test-support.ts:95`                 | The removed R22 replay compared the whole plan; the corpus replay compares only edits.                                        | The corpus replay now also asserts `toEqual(plan)` on the same re-plan (no extra planner call); R22 comment updated.                                                                                                       |
| 3   | P2       | `packages/auto-layout/test/differential-branches.test-support.ts:112` | Quick cases checked routing but not terminal membership.                                                                      | Adds `equivalentTerminals(netlistPresentation(source).document, doc)`.                                                                                                                                                     |

Acceptance rerun:

```text
pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint --quiet && pnpm deadcode → 0
pnpm test:local → 0 (858 files passed, 3 skipped; 8941 passed, 116 skipped of 9057; real 50.8 s)
pnpm test:slow → 0 (6 files, 16 passed; real 69.9 s)
```

## Round 3 — accepted (codex PR review round 2 findings, fixed by Opus)

Codex `gpt-6.2-sol` reviewed `550ff4c` (PR 134 comment 7126596553): two P2
and one P3, all verified and fixed.

| #   | Severity | Where                                                   | Finding                                                                       | Fix                                                                                                                                                                                             |
| --- | -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2       | `scripts/format.mjs:34`                                 | A `.gitattributes` change can alter checked-out bytes of unchanged files.     | `.gitattributes` joins the full-check triggers; regression case added.                                                                                                                          |
| 2   | P2       | `scripts/format.mjs:39-46`                              | Stripping leading dots changed scope (`.json` skipped, `.apps/x.ts` checked). | Dot segments get a letter prefix instead, so wildcards match them as Prettier's glob does and literal segments stay distinct; cases for `.json` (checked) and `.apps/example.ts` (not checked). |
| 3   | P3       | `packages/auto-layout/test/current-source-tail.test.ts` | Quick cases dropped geometry that holds for individual inputs.                | Asserted per input: tail below its foot (reverse=false), v on the a side (reverse=true), inputs outside both banks (feedback), as measured in report.md.                                        |

Acceptance rerun:

```text
pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint --quiet && pnpm deadcode → 0
pnpm test:local → 0 (858 files passed, 3 skipped; 8944 passed, 116 skipped of 9060; real 45.9 s)
```

`test:slow` is unchanged by this round (no slow file or shared helper touched).

## Round 4 — accepted (codex PR review round 3 finding, fixed by Opus)

Codex `gpt-6.2-sol` reviewed `d2225ee` (PR 134 comment 7126852962): one P2.

| #   | Severity | Where                   | Finding                                                                          | Fix                                                                        |
| --- | -------- | ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | P2       | `scripts/format.mjs:34` | A PR that widens `patterns` passes PR mode while the full check on `main` fails. | `scripts/format.mjs` joins the full-check triggers; regression case added. |

Acceptance rerun:

```text
pnpm format:check → 0
pnpm exec vitest run scripts/format.test.mjs → 0 (23 passed)
pnpm lint -- scripts/format.mjs scripts/format.test.mjs → 0 errors, 0 warnings
```
