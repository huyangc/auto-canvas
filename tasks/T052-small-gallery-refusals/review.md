# T052 review

## Round 1 — accepted

Reviewed: `git diff origin/main` on `task/T052-small-gallery-refusals` on
2026-11-12; acceptance rerun by Opus. The user accepted the round with the
partial result below ("接受，开 PR").

| #   | Severity | Where                                              | Finding                                                                                                                                                                                                                                                                                                                                                                          | Expected fix                                                                                                                        |
| --- | -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | note     | `qzszatannt` (class C)                             | Completes with an R14 warning, 1 floating pin and 1 missing connection, so the plan's strict "no new floating pins" check holds for 7 of the 8 recoveries. Cause: the router treats pins joined only by same-name hidden power labels as connected; the first Route changes the labels' attachment (`packages/derived/src/net-label.ts`), so that virtual connection disappears. | Follow-up task; fixing it needs `packages/derived`, outside this plan's scope. The user preferred a completed drawing to a refusal. |
| 2   | note     | `yje2n6eva2` (class D)                             | Stays refused: the bounded router finds no clear path for the `P12.P`–`XMASTER.dn` contact and the Net has no name, so R14 labels are not allowed. As agreed in the plan.                                                                                                                                                                                                        | None in this task.                                                                                                                  |
| 3   | note     | `packages/auto-layout/test/corpus.test.ts:671-709` | The cleanup-prefix assertion no longer counts the leading annotation edits; it checks they are annotation or claim upserts and that removals keep their exact order. Looser than before but justified by the new claim-transfer and device-label edits.                                                                                                                          | None.                                                                                                                               |
| 4   | note     | plan acceptance                                    | `pnpm --filter @icm/auto-layout exec vitest run` finds no tests (root-relative include globs). `pnpm exec vitest run packages/auto-layout/test` covers the same files.                                                                                                                                                                                                           | Use the root invocation in future plans.                                                                                            |

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors, 3210 warnings, as on main)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 37 files, 591 tests passed
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 cases, 627 completed, 1 refused
compare.py tmp/le10-base vs round 1 → 8 refused→completed; 619 prior results identical; none not equivalent
```
