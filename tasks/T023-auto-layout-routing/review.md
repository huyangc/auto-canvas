# T023 review

## Round 1 — accepted

Reviewed: the uncommitted working tree after Codex round 1, on
`task/T023-auto-layout-routing` at `da3773f`. Acceptance rerun by Opus on lane 3.
Codex's report is accurate. Its `STATUS: partial` rests on one item, the planning-time
target, which the paired measurement below meets.

What Codex built:

- R85: `netScope: "base"` on `createRouteClearance`, `planRouteNet` and `planWireBatch`.
  Auto-layout passes it for every Net, stub and fallback stub.
- R86: `partial` routing in `planRouteNet`, which returns the unjoined components with
  the router's reason. A rail whose trunk is refused or incomplete is compared with a
  plain tree. `missingConnections` replaces the diagnostic count in `routedScore`.
- R87: `crossingCost` in the clearance's path cost, with an indexed crossing count.
  Auto-layout passes 20 grid steps.

Every changed path is in the plan's owned paths. `plan.md`, the lockfile and all
dependencies are untouched.

Acceptance rerun:

```text
pnpm install --frozen-lockfile --offline            → 0
pnpm format:check / docs:check / typecheck          → 0
pnpm lint                                           → 0; 0 errors, 2778 warnings (2770 on main)
pnpm vitest run packages/edit-engine                → 0; 952 passed, 4 skipped
pnpm vitest run packages/auto-layout                → 0; 190 passed
pnpm test:local                                     → 0; 7476 passed, 116 skipped
pnpm deadcode | grep <task paths>                   → no output (unfiltered exits 1 on main too)
pnpm build                                          → 0
pnpm auto-layout:review                             → 0; corpus targets and held-out ceilings hold
pnpm auto-layout:eval ... --baseline ... --jobs 5   → 0; 33 of 33 completed
pnpm auto-layout:eval ... --search 120 --seed 1 --jobs 12 → 0; 33 of 33 completed
existing Edit Engine routing tests, frozen files    → no diff
out-of-scope packages, apps, T022-owned files       → no diff
tracked private data                                → none
pnpm agent-docs:generated:check / components:check  → 0 (CI runs both)
```

Quick mode, the 32 documents `a188149` completes. Opus's run equals Codex's document by
document.

| Measure                                 | `a188149` |      T023 | Required    |
| --------------------------------------- | --------: | --------: | ----------- |
| Completed documents                     |  32 of 33 |  33 of 33 | 33 of 33    |
| Crossings, dev                          |       263 |       235 | ≤ 245       |
| Crossings, val                          |       387 |       354 | ≤ 387       |
| Bends                                   |       702 |       757 | ≤ 780       |
| Floating pins                           |        63 |         1 | ≤ 6         |
| Missing connections                     |        53 |         1 | —           |
| Label overlaps / clearance / departures | 3 / 59 / 13 | 0 / 50 / 14 | ≤ 3 / 62 / 18 |
| Unsafe problems; not equivalent         |     0 / 0 |     0 / 0 | 0 / 0       |
| Wire length                             |   219,860 |   263,920 | report      |

No document has more floating pins than before. Humans draw the same 32 with 115
crossings and 10 floating pins.

Effect of each step, same 32 documents:

| Stage                       | Completed | Crossings | Bends | Floating pins | Wire length |
| --------------------------- | --------: | --------: | ----: | ------------: | ----------: |
| `a188149`                   |  32 of 33 |       650 |   702 |            63 |     219,860 |
| R85                         |  33 of 33 |       614 |   695 |            56 |     235,060 |
| R85 and R86                 |  33 of 33 |       658 |   728 |             0 |     261,950 |
| R85, R86 and R87            |  33 of 33 |       589 |   757 |             1 |     263,920 |

Search, `--search 120 --seed 1 --jobs 12`, same 32 documents, Opus's run:

| Measure                    | `a188149` | T023 |
| -------------------------- | --------: | ---: |
| Crossings                  |       522 |  477 |
| Bends                      |       590 |  709 |
| Floating pins              |        53 |    1 |
| Median evaluations         |       629 |  478 |

In no document does search end with more crossings or more floating pins than quick
mode. The largest span ratio against quick mode is 1.33.

**Planning time.** Codex measured 1.50 times the baseline, but against a baseline
recorded under a different machine load. Opus ran `a188149` and the result at the same
time, each with `--jobs 5`:

| Split | `a188149` |    T023 | Ratio |
| ----- | --------: | ------: | ----: |
| dev   |    70.9 s |  83.3 s |  1.18 |
| val   |    93.4 s | 123.2 s |  1.32 |
| all   |   164.3 s | 206.5 s |  1.26 |

The target is 1.35. The slowest single plan is 16.7 s before and 16.5 s after. Codex's
profile attributes the added time to the Nets that are now drawn, not to crossing
counts (0.7% of planning time).

**Default router behavior.** A fingerprint script calls `planRouteNet` (tree and
explicit trunk) and `planWireBatch` with `keepClear`, without any new option, on the
human placements with their wires removed: 1281 calls on 30 documents. Built from
`a188149` and from the result, all 1284 output lines are identical. The three existing
Edit Engine routing test files have no diff.

**New tests guard real defects.** Opus ran three of the new fixtures on a pristine
`a188149` build:

- the blocked ground trunk leaves an R14 warning and a floating pin there, none now;
- the opposing fallback stubs are refused there with R10, and commit now;
- the removable crossing is drawn there, and gone now.

**Existing tests.** The ten tests named in the plan keep their assertions on rebuilt
fixtures. Two expectations change: two fallback labels instead of three, because the
reachable rail pins are now one drawn component; and the pinned quick-result hash, after
a check that the new result is equivalent, safe and has no more crossings. No test was
removed: the three files have 7, 20 and 9 tests before and after.

**Corpus and held-out fixtures.** The nine corpus results are unchanged. Four of seven
held-out results change, all within their ceilings. Over the 16 fixtures floating pins
go from 9 to 1, crossings from 45 to 42 and bends from 98 to 108.

| #   | Severity | Where                                          | Finding                                                                                                                                                      | Expected fix                                                        |
| --- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | note     | six documents                                  | Crossings rise in six documents (6→8, 9→10, 1→4, 7→9, 27→34, 21→36). All six go from floating pins to none: the Nets now drawn cross others.                  | Accepted. Net order and rip-up are a follow-up task.                |
| 2   | note     | bends, wire length                             | Bends rise 8% and wire length 20%. R86 accounts for most of both: Nets that were not drawn are drawn.                                                        | Accepted; within the bend target.                                   |
| 3   | note     | `packages/auto-layout/src/route.ts:531`        | A rail whose trunk threw still previews and audits its tree, although the tree is then the only candidate.                                                   | None required; the saving is small.                                 |
| 4   | note     | `test/route-quality.test.ts`, tree fallback    | The test does not itself assert that the trunk is refused. Opus confirmed on `a188149` that the fixture yields the R14 warning.                               | None required.                                                      |
| 5   | note     | lint                                           | Eight new non-null-assertion warnings in the three router files, a pattern both packages already use. No errors.                                             | None required.                                                      |
| 6   | note     | one val document                               | One connection is still missing: a port whose only clear path is blocked by another Net's pin.                                                               | Follow-up with net order or placement.                              |
| 7   | note     | T022 (`task/T022-auto-layout-recognition`)     | A trial merge with T022's pull-request head conflicts only in `docs/specs/auto-layout.md`, where both add rules at one place. Both test files merge cleanly. | Whichever merges second is rebased by Opus and re-measured.         |
