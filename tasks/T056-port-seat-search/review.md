# T056 review

## Round 1 — changes-requested

Reviewed: `git diff HEAD` on `task/T056-port-seat-search` on 2026-11-12;
report and evaluation numbers read.

Good progress: port-related crossings −23.4% (target met), port wire −15.2%,
total wire and crossings lower on dev and val, determinism and all six large
documents identical. The plan has been amended (see "Plan change after round
1"): the old seat assertions may be rewritten, timing is now relative, and the
port-seat comparison may use a calibrated wire weight.

| #   | Severity | Where                                   | Finding                                                                                                                                                                 | Expected fix                                                                                                                                                                                                                                                                             |
| --- | -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `port-seat-search.ts`, `auto-layout.ts` | `3ze5gasahn` gains a floating pin (`Q1.B`) and terminal departures rise 117 → 120: candidates are compared with the provisional incumbent, before the finishing passes. | Compare each accepted seat set after the same finishing passes (R72, R95/R96, R97, facing, labels) against the finished incumbent; reject if floating pins, missing connections or any `VISUAL_*` count increases.                                                                       |
| 2   | must-fix | `corpus.test.ts:452-488`                | Four assertions require the old seat geometry.                                                                                                                          | Rewrite them to the new contract in the amended plan; keep every other assertion.                                                                                                                                                                                                        |
| 3   | must-fix | port wire −15.2% vs target −25%         | Shortlist misses multi-host seats, the 0.1 wire weight discards shorter seats, and anchor preservation rejects seats that move the top-left corner.                     | Add candidate seats between hosts of multi-host Nets (for example at the host pins' median or on the segment between two hosts, facing outward); use a calibrated wire weight for the seat comparison; restore the anchor by translating the whole layout instead of rejecting the seat. |
| 4   | must-fix | timing                                  | p95 12.14 s.                                                                                                                                                            | Meet the amended relative limits (median ≤ 2×, p95 ≤ 1.5× base, paired).                                                                                                                                                                                                                 |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted (targets partly missed)

Reviewed: `git diff HEAD` on `task/T056-port-seat-search` on 2026-11-12;
acceptance and the full evaluation rerun by Opus.

Accepted because every guard holds and every primary ratio except bends
improves; the task's own reduction targets and the val-only p95 are missed and
recorded below as known limits.

| Metric (all, ratio to human) | T055 base | Round 2 |
| ---------------------------- | --------: | ------: |
| Crossings                    |      2.48 |    2.31 |
| Bends                        |      1.27 |    1.28 |
| Wire length                  |      1.66 |    1.54 |
| Median area ratio            |      1.66 |    1.57 |

Port wire −19.3% (target −25%), port-related crossings −13.8% (target −20%).
Visual guards all equal or lower (terminal departures 117 → 103, label
clearance 226 → 207, wire through symbol 26 → 20); floating pins 10 and
missing connections 18 unchanged; 627/628 completed, none non-equivalent.
Timing (Codex's paired run): median 1.08× base, p95 1.499× base overall, but
1.84× on val alone.

The rewritten `corpus.test.ts` port assertions replace only the old
80-unit/edge geometry, as the amended plan allows; they add candidate
membership (with the incumbent removed), full physical connectivity of each
port with its hosts and a facing check, and keep the rail-port rotations.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 38 files, 606 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
