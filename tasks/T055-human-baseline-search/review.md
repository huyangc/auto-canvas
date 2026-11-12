# T055 review

## Round 1 — changes-requested

Reviewed: `git diff origin/main` on `task/T055-human-baseline-search` on
2026-11-12; report and acceptance logs read, evaluation numbers checked
against Opus's own runs on `bdb5f36`.

The implementation is careful and honest about its result, and the
scoreboard and calibration are useful. The guarded two-level search does not
earn its cost: 9 of 628 plans change, wire −550 units (0.07%), crossings,
bends and area unchanged, planning time 1.26× and p95 at 9.84 s against a
10 s limit. The guards that make it safe (all strict left-to-right orders,
rotations and every per-drawing visual count frozen) also leave it nothing to
explore.

Opus measured where the gap actually is, on the 627 completed drawings
(`tmp/proto/{wire-breakdown,spacing,crossing-kinds}.mjs`):

|                                        |             Human |           Default |        Excess |
| -------------------------------------- | ----------------: | ----------------: | ------------: |
| Wire on port Nets                      |           132,515 |           265,520 |      +133,005 |
| … single-host ports                    |            21,534 |            61,200 |       +39,666 |
| … multi-host ports                     |           115,957 |           212,920 |       +96,963 |
| Wire on rail Nets                      |            97,737 |           148,077 |       +50,340 |
| Wire on signal Nets                    |           234,972 |           358,992 |      +124,020 |
| Crossings involving a port Net         |               127 |               269 |          +142 |
| Crossings rail–signal / rail–rail      |                12 |               121 |          +109 |
| Crossings signal–signal                |                95 |               190 |           +95 |
| Device bounds width / height (sum)     | 134,028 / 108,365 | 186,316 / 118,754 | 1.39× / 1.10× |
| Median gap to the next device in a row |                57 |                49 |               |

A global estimator-annealing prototype with devices fixed and the existing
planner routing them (`tmp/proto/global-place.mjs`) was worse than default
(crossings 3.03×, wire 1.88×): the estimator ignores rails and ports, which
are placed afterwards. Port seats (R19 edges, R71's single local seat) and
rail placement are the levers; they get their own tasks.

| #   | Severity | Where                                                  | Finding                                                                             | Expected fix                                                                                   |
| --- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | must-fix | `packages/auto-layout/**`, `docs/specs/auto-layout.md` | R146 guarded search and the weight split add 26% planning time for 9 changed plans. | Revert to `origin/main`; keep the calibration only as report evidence.                         |
| 2   | must-fix | `scripts/auto-layout-eval.mjs`                         | Scoreboard lacks the breakdowns that locate the gap.                                | Add wire by net kind, crossings by kind pair, port wire by host count, as in the amended plan. |
| 3   | note     | report                                                 | Exact `report.json` byte equality cannot hold with timing fields.                   | Compare plan hashes and non-timing fields, as round 1 did.                                     |

Acceptance rerun: not rerun for round 1; the round is redirected.

## Round 2 — accepted

Reviewed: `git diff origin/main` on `task/T055-human-baseline-search` on
2026-11-12; acceptance rerun by Opus.

Only `scripts/auto-layout-eval.mjs` and this task's files change. The
scoreboard prints and stores dev/val/all primary ratios, every visual guard,
connectivity guards, timing, wire by net kind, crossings by kind pair and port
wire by host count; the buckets add up to the totals (all: rail 148,077 + port
265,520 + signal 358,992 = 772,590 result wire).

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 594 tests passed
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 627/628, scoreboard printed and in report.json
```
