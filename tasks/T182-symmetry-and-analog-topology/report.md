# T182 report — round 2

## Summary

The planner now tries all three distinct strategies for whole-component symmetry and can finish either symmetry finalist when its draft improves crossings or offers a bounded symmetry improvement. Finished selection preserves the routed score and hard guards while allowing symmetry improvements to outweigh minor readability costs. Every acceptance command passed. The netlist and drawing corpora gained two and five fewer crossings respectively, and five and eight fewer symmetry violations. Several named targets retained their baseline metrics.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                           |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Mapped T087 logical nets back to Base Nets, including reversible passive pins. Oriented the component from the lowest-id transistor pair and excluded hierarchy and directed blocks.                            |
| 2    | done    | Shared topology resolution across drafts, rigid units, contact search, and compaction. Keyed draft and finishing caches by the symmetry options.                                                                |
| 3    | done    | Registered both finalists. Round 2 expands draft strategy coverage and admission, and passes the finalist kind to finished selection.                                                                           |
| 4    | done    | Centered the high-side tail with an upward stem and placed loads and output ports below the p-channel pair.                                                                                                     |
| 5    | done    | Verified whole-axis placement, mirror topology and replay, both high-side tail pin orientations, and the guarded finished-selection exception.                                                                  |
| 6    | done    | Documented R88 fallback, R145 whole-component competition, R170 high-side tails, and the round 2 selection rule.                                                                                                |
| 7    | partial | Both sequential corpus commands and the strict gate passed. The named concentric and mirror targets improved in some cases, with several unchanged results and no measured gain on the named high-side example. |

## Review findings addressed

1. The unsplit finalist drafts the selected strategy, layered, and template once each. It retains the selected strategy's overrides and compares drafts with `compareRuns`.
2. Both finalists require a distinct, complete draft. They can qualify through the runner gate, fewer crossings, or equal crossings with fewer netlist symmetry violations and a routed score within 2.2 times the incumbent's.
3. Both kinds must improve the finished comparator and routed score. A symmetry gain with non-increasing crossings can outweigh the readability term or a minor zero-baseline violation. Routing and visual guards and the five severe zero-baseline vetoes still apply. The regression test replays layouts with real routing and shows that a new label-owner-distance violation vetoes an otherwise winning candidate.

## Acceptance results

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0, 0 errors and 3,988 warnings
pnpm format:check → 0
pnpm docs:check → 0, validated links in 75 files
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0, 1,253 tests passed in 91 files
pnpm test:slow → 0, 8 tests passed in 2 files
node scripts/auto-layout-eval.mjs (netlist, --jobs 6) → 0, 514/515 completed
node scripts/auto-layout-eval.mjs (drawing, --jobs 6) → 0, 612/628 completed
Plan strict gate against tmp/t181 → 0, zero throws, lost completions, or integrity failures in either corpus
```

### Corpus deltas on matched completions

| Metric                       | Netlist                    | Drawing                  |
| ---------------------------- | -------------------------- | ------------------------ |
| Crossings                    | 273 → 271 (−2)             | 297 → 292 (−5)           |
| Bends                        | 1,851 → 1,854 (+3)         | 1,927 → 1,924 (−3)       |
| Wire length                  | 455,268 → 456,508 (+1,240) | 510,928 → 510,738 (−190) |
| Broken stacks                | 214/761 → 215/761 (+1)     | 225/890 → 227/890 (+2)   |
| Pin jogs                     | 256 → 257 (+1)             | 291 → 293 (+2)           |
| `netlistSymmetry` violations | 44/285 → 39/285 (−5)       | 80/314 → 72/314 (−8)     |
| Changed plan hashes          | 4                          | 2                        |

Netlist retained 514/515 completions and drawing retained 612/628. Neither corpus recovered any additional completions. See `tmp/t182/netlist/report.json`, `tmp/t182/drawing/report.json`, and `tmp/t182/round2-strict-gate.log`.

### Named targets

| Case         | Netlist crossings | Netlist symmetry | Drawing crossings | Drawing symmetry |
| ------------ | ----------------- | ---------------- | ----------------- | ---------------- |
| `px5yta2b98` | 1 → 0             | 0/4 → 0/4        | 6 → 2             | 4/4 → 0/4        |
| `vcgtzej894` | 2 → 2             | 0/4 → 0/4        | 5 → 5             | 4/4 → 4/4        |
| `6qg2h7weje` | 1 → 1             | 0/4 → 0/4        | 5 → 5             | 4/4 → 4/4        |
| `sbfkkj67cm` | 1 → 1             | 0/4 → 0/4        | 5 → 5             | 4/4 → 4/4        |
| `x5jaqe94t7` | 3 → 3             | 4/4 → 4/4        | 3 → 3             | 4/4 → 4/4        |
| `wj76fmt2de` | 1 → 1             | 2/2 → 2/2        | 0 → 0             | 2/2 → 2/2        |
| `4qk6efgw4z` | 2 → 2             | 3/5 → 3/5        | 2 → 2             | 2/5 → 2/5        |
| `5nrdf75rpd` | 0 → 0             | 4/4 → 4/4        | 0 → 0             | 4/4 → 4/4        |
| `bv9zwmd835` | 0 → 0             | 0/3 → 0/3        | 1 → 1             | 3/3 → 3/3        |
| `5etmybq44s` | 3 → 3             | 4/4 → 4/4        | 2 → 2             | 4/4 → 4/4        |
| `59gjj8gczh` | 2 → 2             | 4/4 → 4/4        | 2 → 2             | 4/4 → 4/4        |
| `m9xz6y5jy4` | 2 → 1             | 3/5 → 0/5        | 3 → 3             | 4/5 → 4/5        |
| `m9knq7tpsz` | 2 → 2             | 2/3 → 2/3        | 4 → 4             | 0/1 → 0/1        |
| `8szwjcnvxz` | 0 → 0             | 0/1 → 0/1        | 2 → 2             | 0/1 → 0/1        |

### Non-sealed movers

| Corpus  | Case         | Crossings | Bends | Wire length | Broken stacks | Pin jogs | Symmetry violations |
| ------- | ------------ | --------: | ----: | ----------: | ------------: | -------: | ------------------: |
| Netlist | `m9xz6y5jy4` |        −1 |    +7 |        +880 |             0 |       +1 |                  −3 |
| Netlist | `px5yta2b98` |        −1 |    −3 |        +290 |            +2 |       +1 |                   0 |
| Netlist | `6n39a2gvtc` |         0 |     0 |         +30 |             0 |        0 |                  −2 |
| Netlist | `7wj4a56a3b` |         0 |    −1 |         +40 |            −1 |       −1 |                   0 |
| Drawing | `px5yta2b98` |        −4 |    −3 |        −320 |            +2 |       +1 |                  −4 |
| Drawing | `zda3hfp2e5` |        −1 |     0 |        +130 |             0 |       +1 |                  −4 |

## Investigation results

The concentric amplifier fixture finishes with four mirrored pairs on one axis, fewer crossings than the split-only run, and exact terminal partition. The mirror fallback fixture evaluates a symmetric finalist when R88 finds no component. The high-side fixture replays both current-source pin orientations with exterior inputs, zero crossings, and equivalent terminals.

The ten traced runs reproduced the full corpus plan hashes. The drawing finalist for `px5yta2b98` won with two crossings and no symmetry violations, down from six and four. For drawings `vcgtzej894`, `6qg2h7weje`, and `sbfkkj67cm`, the best unsplit draft still used the stages strategy and increased crossings from five to six. The best unsplit draft for netlist `x5jaqe94t7` increased crossings from three to five. These drafts failed admission.

Netlist `bv9zwmd835` passed admission on fewer crossings. Its finished mirror candidate reduced crossings from one to zero and raised the routed score from 5,211 to 7,945, so the incumbent held. Netlist `4qk6efgw4z` reached final selection, where a new `VISUAL_LABEL_RUN_ON` finding vetoed it. Netlist `5nrdf75rpd` passed the new finished selection rule with zero crossings and four fewer symmetry violations despite a higher readability term. Its final public plan still matched the baseline.

## Deviations and open questions

The round 2 review supersedes the original plan's instruction to leave finished selection untouched. The previous selection rules continue to apply to other finalist kinds and callers that omit the kind. Crossings and symmetry improved in aggregate, while broken stacks and pin jogs increased in both corpora. The high-side tail passed both fixture variants. The corpus example `8szwjcnvxz` retained its baseline metrics in both presentations.
