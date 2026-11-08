# T020 report — round 2

## Summary

Implemented R72 on top of the reviewed R68–R71 implementation. Complete quick plans and final R66 states can reseat reported port/net-marker blockers and replay the full routing and transaction pipeline. Each accepted repair strictly reduces floating pins without increasing crossings. Devices, fixed instances, router behavior, energy weights, R10, R23 and `lostNameClaim` stay unchanged.

**Partial: quick floating pins fall from 101 to 88, but remain above the target of 82.** Quick crossings remain 621 and bends remain 701, versus T019's 755 / 766. All 32 previously completed documents still complete. Three markers move in three dev documents; no human-case port repair passes the acceptance guard. Correct repairs that add crossings are rejected as required, with their dev results recorded below.

## Steps

| Step                  | Status  | Notes                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — R68               | done    | Kept reviewed one-way driver exclusion and mutual cross-coupled matched-pair recognition. Dev tail-less investigation retained below.                                                                                                                                                                                                                   |
| 2 — R69               | done    | Kept parallel attachment units, descriptor-based eligibility, all-strategy seating and rigid R66 moves.                                                                                                                                                                                                                                                 |
| 3 — R70               | done    | Kept guarded driver-stage attachments across template, layered and stages placement.                                                                                                                                                                                                                                                                    |
| 4 — R71               | done    | Kept safe local single-host ports and R19/R20 fallback. R72 can return a reported local blocker to the edge.                                                                                                                                                                                                                                            |
| 5 — Tests             | done    | 171 auto-layout tests pass. Seven new R72 tests cover local-port and ground-branch repair, a horizontal rail obstruction, actual crossing-increase rejection, fixed blockers, punctuation and prefix ambiguity in ids, deterministic quick planning, final-search repair, transaction replay and terminal partitions. Existing tests were not weakened. |
| 6 — Evaluation/report | partial | Final quick, corpus, held-out and rendered comparisons supplied. The floating-pin ceiling remains unmet. Search results below.                                                                                                                                                                                                                          |
| 7 — R72               | partial | Repair mechanism implemented and tested; quantitative target remains 6 pins above its ceiling. At most two full replans per candidate plan. No repair runs per R66 energy evaluation.                                                                                                                                                                   |

## Review findings addressed

**Round 1 must-fix #1: partially addressed.** Added a bounded R72 repair after refinement and before final R44 selection in quick mode, and only after annealing for search. Keeping it after refinement preserves R63 strategy deduplication and refinement slots. Refined candidate-count evidence is retained across repaired plans.

`planRouteNet` throws plain `Error` strings and supplies no structured obstruction. The repair resolves only the obstruction label (`reference ?? id`) from the `passes over pin`, `passes through` or `touches … drawing` clause to an unambiguous instance. It does not consume Net names, pin-member lists, suggested detours or message coordinates. Only ports and descriptor-defined net markers are eligible; fixed blockers are excluded.

Seating reuses R19/R20 for local ports, advances edge ports by R20 spacing, and advances power markers along their rail in id order. It chooses the nearest free position in either direction, with positive ties, clearing instance bounds, other pin branch rows/columns and geometry-derived horizontal R43 rail spans. Exact replacement placements bypass device placement/collision finishing, then run the original cleanup, routing, replay, connectivity, name-claim and audit checks. Search repairs also retain R67 span bounds. Refused, non-improving and crossing-increasing repairs leave the original plan intact.

The mechanism removes 13 floating pins, but does not meet the requested 82-pin cap. This finding remains open for Opus's decision; no router or weight change was made to force acceptance.

## Acceptance results

Final logs and private artifacts are in git-ignored `tmp/t020-r2/`. Lane 1 was used for repository-wide tests.

```text
pnpm install --frozen-lockfile --offline → 0; already up to date, pnpm 11.16.0
pnpm format:check → 0; all matched files use Prettier style
pnpm docs:check → 0; 74 Markdown files validated
pnpm typecheck → 0
pnpm lint → 0; 0 errors, repository warnings remain
pnpm vitest run packages/auto-layout → 0; 12 files, 171 tests passed
pnpm test:local (sandbox) → 1; 17 files failed, PostgreSQL/loopback/process EPERM
pnpm test:local (final, local socket/process access) → 0; 748 files passed, 2 skipped; 7,452 tests passed, 116 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → grep 1; no output
pnpm build → 0; existing chunk-size warnings
pnpm auto-layout:review (final, serial) → 0; 9 corpus and 7 held-out drawings committed
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0; 32/33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 32/33 completed
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json --jobs 12 (final-source parity) → 0; 33 identical case results, 32 byte-identical result SVGs
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → grep 1; no output
```

The grep exit codes are the expected absence of matching lines. No lockfile or dependency change resulted from the authorized offline install. An initial test-only typecheck failure (`string[]` supplied for `ReadonlySet<string>`) was corrected. An early repair timing placed R72 inside strategy refinement and failed two R63 tests; repairs now run after refinement and those unchanged tests pass. A concurrent `build`/`auto-layout:review` attempt failed with `Static service worker cache placeholder is missing`; both final builds were rerun separately and pass. The initial search pilot was interrupted when the dev-only horizontal-rail regression was fixed; only the completed search for the frozen placement rules is reported below.

### Human evaluation

All completed documents; C / B / F means crossings / bends / floating pins. Baselines are T019 quick and round 1, not the older common-subset baseline printed by the required evaluation command.

| Run                        | Dev C / B / F  | Val C / B / F  | Total C / B / F | Completed | Wire length |
| -------------------------- | -------------- | -------------- | --------------- | --------- | ----------- |
| T019 quick                 | 268 / 336 / 38 | 487 / 430 / 44 | 755 / 766 / 82  | 32/33     | 237,920     |
| T020 round 1 quick         | 240 / 306 / 56 | 381 / 395 / 45 | 621 / 701 / 101 | 32/33     | 210,320     |
| T020 round 2 quick         | 240 / 306 / 43 | 381 / 395 / 45 | 621 / 701 / 88  | 32/33     | 212,730     |
| T019 120 s, seed 1         | 191 / 244 / 41 | 430 / 399 / 39 | 621 / 643 / 80  | 32/33     | 234,370     |
| T020 round 1 120 s, seed 1 | 174 / 247 / 46 | 309 / 369 / 41 | 483 / 616 / 87  | 32/33     | 211,700     |

Quick targets: dev crossings 240 ≤ 268; val 381 ≤ 487; completed 32 ≥ 32; bends 701 ≤ 766; **floating pins 88 > 82**. Wire length is 10.59% below T019 quick. Maximum rendered width ratio against T019 quick is 1.4190; no document exceeds 1.5. All completed plans replay with preserved terminal partitions/electrical graphs and zero unsafe routing problems. The same 70-instance document remains refused under R10.

| Run                        | Dev C / B / F  | Val C / B / F  | Total C / B / F | Completed | Wire length |
| -------------------------- | -------------- | -------------- | --------------- | --------- | ----------- |
| T020 round 2 120 s, seed 1 | 174 / 244 / 36 | 309 / 372 / 41 | 483 / 616 / 77  | 32/33     | 213,620     |

The final search completes 32/33 documents. Against T019's 621 / 643 / 80, its totals are 483 / 616 / 77; against round 1's 483 / 616 / 87, the deltas are +0 crossings, +0 bends and -10 floating pins. Search wire length is 213,620, versus 234,370 for T019 and 211,700 for round 1. Maximum rendered width ratio against this run's actual repaired quick result is 1.2871; the maximum instance span ratio is 1.4005. Against T019 quick, maximum rendered width ratio is 1.4190. All completed search results preserve equivalence and have zero unsafe routing problems. Search remains time-budgeted, so differences from earlier 120-second runs also reflect CPU contention rather than an isolated R72 ablation.

### R72 alone on top of round 1, quick mode

| Split | Δ crossings | Δ bends | Δ floating pins | Δ wire length | Completed |
| ----- | ----------- | ------- | --------------- | ------------- | --------- |
| Dev   | +0          | +0      | -13             | +2,410        | 17 → 17   |
| Val   | +0          | +0      | +0              | +0            | 15 → 15   |
| Total | 0           | 0       | −13             | +2,410        | 32 → 32   |

The total wire-length rise against round 1 is 1.15%, below 5%. It restores visible rail branches. Per-document R72 changes are counts only:

| Anonymous row | Split | Δ crossings | Δ bends | Δ floating pins | Δ wire length | Width / T019 quick |
| ------------- | ----- | ----------- | ------- | --------------- | ------------- | ------------------ |
| 1             | dev   | +0          | +0      | -9              | +1,820        | 1.0000             |
| 2             | dev   | +0          | +0      | -3              | +470          | 0.8923             |
| 3             | dev   | +0          | +0      | -1              | +120          | 0.9700             |

### Each earlier rule alone, quick mode

Each isolated variant starts from the unmodified T019 implementation and enables only the named rule (plus shared helpers). Built in ignored directories; no product feature flags or dataset dependencies were added. Each variant was fixed before its val run; no behavior was selected using val results.

| Enabled rule | Dev crossings | Val crossings | Total crossings | Bends | Floating pins | Completed | Wire length |
| ------------ | ------------- | ------------- | --------------- | ----- | ------------- | --------- | ----------- |
| R68          | 260           | 445           | 705             | 743   | 92            | 32/33     | 227,120     |
| R69          | 264           | 487           | 751             | 762   | 89            | 32/33     | 236,080     |
| R70          | 272           | 482           | 754             | 757   | 93            | 32/33     | 235,290     |
| R71          | 250           | 385           | 635             | 720   | 91            | 32/33     | 208,960     |

R70 alone raises dev crossings by 4 while reducing val by 5. R68/R69/R70/R71 alone increase floating pins by 10/7/11/9; the combined increase is 19. These are reported tradeoffs, without changing routing or dropping the approved recognition rules.

These R68–R71 isolation results are retained from round 1 because those implementations are unchanged. R72's separate effect is the measured round 2 minus round 1 table above.

### Corpus and held-out

All nine corpus documents commit: 1 crossing, 7 bends, 6,860 wire units, zero floating pins and zero unsafe problems. All seven held-out documents commit: 44 crossings, 90 bends, 19,920 wire units, 9 warned floating pins and zero unsafe problems. Corpus targets and every held-out crossing ceiling pass.

| Held-out fixture | Crossings | Ceiling |
| ---------------- | --------- | ------- |
| fd-two-stage     | 8         | 12      |
| common-source-ac | 0         | 2       |
| skew             | 1         | 4       |
| deadtime         | 13        | 17      |
| ota-sky130       | 0         | 3       |
| widlar           | 3         | 5       |
| ltc3452          | 19        | 22      |

### Counts touched by the rules

Eligibility includes all 33 drawings; final seating uses the 32 completed quick plans. R68–R71 counts were rechecked against final transforms; they remain unchanged. Private mappings stay under `tmp/t020-r2/`.

| Rule                                             | Dev     | Val     |
| ------------------------------------------------ | ------- | ------- |
| R68 one-way differential candidates excluded     | 1       | 2       |
| R68 cross-coupled matched groups                 | 2       | 2       |
| R69 eligible / seated attachments                | 3 / 3   | 2 / 2   |
| R69 diode / capacitor attachments                | 2 / 1   | 0 / 2   |
| R70 eligible stages, all drawings                | 11      | 1       |
| R70 eligible / seated stages, completed drawings | 6 / 5   | 1 / 1   |
| R71 eligible ports, all drawings                 | 47      | 50      |
| R71 eligible / local ports, completed drawings   | 33 / 28 | 50 / 43 |
| R72 documents with an accepted repair            | 3       | 0       |
| R72 moved power markers                          | 3       | 0       |
| R72 moved local / edge ports                     | 0 / 0   | 0 / 0   |
| R72 moved devices or fixed instances             | 0       | 0       |

The refused dev drawing still accounts for five driver candidates and fourteen eligible ports without a completed placement. One eligible driver stage is blocked in the selected completed layout. Five dev and seven val eligible ports retain edge fallback.

### Rendered comparisons

Six T019-quick / round-2-quick pairs were rendered to SVG and PNG and inspected as a contact sheet in `tmp/t020-r2/pairs/overview.png`; the browser index is `tmp/t020-r2/pairs/index.html`. Pair 1 includes a driver pair and parallel diodes; pair 2 shows single-host ports; pair 3 shows a cross-coupled pair; pair 4 shows an accepted R72 marker repair; pair 5 is the largest completed drawing; pair 6 is an additional larger drawing. Full-resolution files are `pair-1.png` through `pair-6.png`, with matching SVGs. The third-party images and selection mapping remain git-ignored.

## Investigation results

R68, retained from round 1: of the nine previously observed tail-less differential pairs, five are on dev. Four remain genuine candidates under the approved topology predicate, zero are cross-coupled, and one is a one-way driver pair now excluded. The four val pairs were not inspected for tuning. This is topology/display validation, without an electrical operating-point claim.

R72 diagnosis used hand-built reproductions and then only dev documents. The initial failing regression reproduced a ground marker blocking its own rail branch. A second reproduction covered a local port blocking another Net's branch. The horizontal-rail regression demonstrated why clearing pin columns alone is insufficient; the free-seat check now also clears geometry-derived rail spans. No message coordinates or case-specific data enter production code. The placement rules were frozen before final val evaluation. A final identifier-only parser correction disambiguates a port id from another id with that prefix, using the actual symbol pin suffix. All 33 human documents have zero such label-prefix conflicts (`tmp/t020-r2/label-prefix-parity.log`), so the quick/search metrics are unchanged by that correction; final source tests, typecheck, lint and builds include it. A final-source quick rerun with `--jobs 12` additionally confirms identical statuses, diagnostics and metrics for all 33 documents, with byte-identical SVGs for all 32 completed results (`tmp/t020-r2/final-source-parity.log`).

Three remaining dev repairs would reduce floating pins but add crossings, so the required guard rejects them:

| Anonymous dev candidate | Floating pins before → proposed | Crossings before → proposed | Decision |
| ----------------------- | ------------------------------- | --------------------------- | -------- |
| A                       | 13 → 0                          | 45 → 63                     | reject   |
| B                       | 7 → 0                           | 6 → 8                       | reject   |
| C                       | 10 → 8                          | 1 → 6                       | reject   |

Another dev marker repair leaves the floating count unchanged because the marker's own branch still runs through its drawing. Device-pin obstructions and a Route-to-Route trunk-end conflict are outside R72's repairable blocker set. Detailed diagnostics and proposal measurements stay in `tmp/t020-r2/probe-dev-private.json`. No val failure was inspected for tuning.

## Deviations and open questions

- The round's floating-pin target remains unmet: 88 versus 82, despite a 13-pin improvement over round 1. Must-fix #1 remains partially open. The specified rejection guard prevents keeping the crossing-increasing proposals above; no extra placement search, router change or weight change was introduced to bypass it.
- The router exposes only error prose, so obstruction-label parsing is necessary. Ambiguous labels are conservatively skipped. Marker classes come from `@icm/devices`; no case, instance or symbol id is hard-coded to a human drawing.
- Search repair is bounded to two full replans per final routing candidate and is absent from energy evaluations. Quick planning remains deterministic. Time-budgeted search measurements depend on CPU contention.
- Repository-wide tests require local PostgreSQL/loopback/process access; the sandbox failure and passing final rerun are recorded above.
- The working tree already contained round 1 changes and the amended plan/review when this round began. They were preserved. No commits, branch changes, plan/review edits, dependency/lockfile changes, generated-file hand edits or third-party fixture additions were made.
