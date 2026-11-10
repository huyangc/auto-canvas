# T034 review

## Round 1 — changes-requested

Reviewed: `git diff 88eab98` on `task/T034-auto-layout-compaction` after round 1;
acceptance rerun by Opus.

R97 and R98 match the plan. The corpus passes unchanged, including repeated placement.
The R98 root cause is reproduced without compaction (`fresh-ids.test.ts`), and the
paired evaluation meets every target: dev median instance-box area 2.769 → 2.572, val
2.367 → 2.255, crossings and bends unchanged, 1.079× planning time. Opus rendered human |
before | after sheets from the reported artifacts (`tmp/t034/sheets-r1/`): compacted
drawings keep their crossings and bends and lose only empty columns.

| #   | Severity   | Where                                                                                                                                          | Finding                                                                                                                                                                                                                                                                                                                                                                                     | Expected fix                                                                                                                                                                                                                                                                     |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `packages/auto-layout/test/quality.test.ts:417`                                                                                                | The R44 assertion `alternative.final?.instances` equals `selected.final!.instances` fails because R97 narrows only the winner, as the plan requires. The plan missed this assertion.                                                                                                                                                                                                        | Authorized, as Codex proposed: compare the alternative's placements with the winner's placements before R97 (read the input of `compactPlacements` with a spy, or compare against the R96 run), and keep the final score assertion unchanged. Nothing else in this test changes. |
| 2   | should-fix | `packages/auto-layout/src/auto-layout.ts:626`, `packages/auto-layout/src/route.ts:46`, `packages/edit-engine/src/route-net-planner.ts:64`      | The list "every object id of a Document" (instances, nets, routes, junctions, annotations, groups, constraints, evidence, no-connects, couplings, drafting, legs, bends) is written out three times. A future object kind added to one copy and not the others would reopen R98 silently. `freshWirePlan` also checks membership with `Array.includes` on that list for every candidate id. | Export one helper from `@icm/edit-engine` (for example `documentObjectIds(document): Set<string>`), use it in all three places, and check membership on `Set`s. Add a short test that it covers every id-bearing collection in a Document.                                       |
| 3   | should-fix | `route-net-planner.ts` (`for (let attempt = 0; ; attempt++)` and the `id()` loop), `route.ts` `freshWirePlan` (`for (let salt = 0; ; salt++)`) | The salt loops have no bound. They terminate today because every emitted id depends on the salt, but an emitted id that does not (for example a future annotation kept by id) would hang planning forever instead of failing.                                                                                                                                                               | Bound each loop, for example to 64 attempts, then throw an `Error` naming the colliding id. `routeGroup` and `fallbackLabels` already turn a thrown planner error into an R14 failure. Add one test for the bound with a reserved set that collides on every attempt.            |

Acceptance rerun:

```text
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm build → 0
pnpm vitest run packages/edit-engine packages/auto-layout → 1 (1 failed | 1427 passed | 4 skipped; only the R44 assertion of finding 1)
```

Round 2 scope: findings 1–3 only. Do not rebase; Opus rebases onto the current `main`
before the PR. Rerun the full acceptance list. Rerun the paired evaluation only if
product behaviour changes (findings 2 and 3 should not change any plan); otherwise show
that the 33 result plan hashes match round 1's.

## Round 2 — accepted

Reviewed: `git diff 88eab98` on `task/T034-auto-layout-compaction` after round 2;
acceptance rerun by Opus.

Findings 1–3 are fixed as requested: the R44 placement assertion reads the input of
`compactPlacements`; `documentObjectIds` in `route-net-planner.ts` is the one list of
Document object ids, used by `planRouteNet`, `freshWirePlan` and `buildPlan`, with a
test over every id-bearing collection; the three salt loops stop after 64 attempts
with an `Error` naming the colliding id, with a test at the bound. All 33 evaluation
plan hashes equal round 1's.

| #   | Severity | Where                                                             | Finding                                                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                             |
| --- | -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | note     | `packages/auto-layout/src/auto-layout.ts` `compact`               | The next R44 assertion, `alternative.choices` equals `selected.choices`, failed: R97's exact replan returns empty side/orientation choices. Compaction moves columns only, so the winner's choices still describe the compacted plan, and nothing reads `choices` after finishing. | Fixed by Opus (one line, no test change): an accepted R97 candidate keeps `run.choices`. Edits and diagnostics are unchanged, since `choices` is not part of the result. |
| 2   | note     | `route.ts` `freshWirePlan`, `route-net-planner.ts` `planRouteNet` | The "ids emitted by these edits" extraction is still written twice.                                                                                                                                                                                                                | Left as is: both lists are local to their planners and covered by the R98 tests.                                                                                         |

Acceptance rerun after the Opus fix:

```text
pnpm format:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm docs:check → 0
pnpm build → 0
pnpm vitest run packages/edit-engine packages/auto-layout → 0 (120 files, 1430 passed, 4 skipped)
pnpm deadcode 2>&1 | grep -E 'compact|route-net-planner|auto-layout' → no output
pnpm test:local → 0 (767 files passed, 3 skipped; 7824 tests passed, 117 skipped)
pnpm auto-layout:review → 0
git diff --stat 88eab98 -- packages/auto-layout/test/corpus.test.ts → empty
protected paths and tracked tmp/human-cases files → empty
```
