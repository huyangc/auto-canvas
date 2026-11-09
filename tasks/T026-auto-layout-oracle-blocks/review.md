# T026 review

## Round 1 — accepted as an experiment

Reviewed: the uncommitted working tree after Codex round 1. Codex's report is accurate.

What the experiment delivers:

- the partition contract and its validator;
- the H (human-drawing) and L (LOADBench) oracle adapters;
- block placement with V1 (automatic floorplan) and V2 (oracle floorplan);
- evaluator flags and dashed block boxes in the result SVGs.

Hooks in shared files are a few lines, with most code in new `partition-*.ts` files.
Without `partition`, the serialized output equals `f8f15fe` on all 33 human cases.
7,639 tests pass.

Human cases, all 33 completed (dev / val):

| Variant                               | Crossings | Bends     | Floating | Block overlap area | Arrangement agreement |
| ------------------------------------- | --------- | --------- | -------- | ------------------ | --------------------- |
| V0, main quick                        | 295 / 321 | 401 / 391 | 0 / 1    | 0.90M / 0.97M      | 44% / 39%             |
| V1-H, partition + automatic floorplan | 355 / 359 | 424 / 441 | 3 / 0    | 0 / 0              | 72% / 80%             |
| V2-H, partition + human floorplan     | 301 / 305 | 400 / 431 | 4 / 3    | 0 / 0              | 95% / 94%             |

Opus's reading:

1. **A good partition with a good floorplan gives human block structure at no wiring
   cost.** V2 keeps blocks apart and matches 94–95% of human block relations; V0 matches
   about 40% and interleaves blocks. Its crossings stay level with V0 (606 against 616).
2. **A partition with a naive floorplan costs wiring.** V1 adds 12–20% crossings. On
   LOADBench's functional partitions, V1 roughly doubles crossings (dev 517 → 999). The
   floorplan is the critical piece, not the partition alone.
3. **The upper bound is understated.** Four limits:
   - The H proxy is coarse: about 2.6 blocks per document, and two of six rendered sets
     collapse to one block.
   - Block placement has no block-level refinement or annealing.
   - Inter-block wiring is not optimized.
   - The V3 reference (human placement with today's router) is unavailable: 30 of 33
     documents fail the frozen R10 geometry checks, mostly coincident pins and
     overlapping parts in the human drawings.

**Recommendation:** pursue hierarchy for readability. The LLM step must propose a coarse
floorplan (block roles and relative positions) as well as the partition. Block-level
placement then needs its own optimization.

| #   | Severity | Where     | Finding                                                                                               | Expected fix                                                      |
| --- | -------- | --------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | note     | V3        | The human-placement reference needs relaxed checks to exist at all.                                   | A throwaway relaxed build in a later experiment, if still useful. |
| 2   | note     | LOADBench | 18 of 101 XMLs reference a capacitor missing from the converted netlist; they stay explicit failures. | Fix in T022's converter if LOADBench is used again.               |

## PR review — codex round 1 on `2715321`

One P2, reproduced. The evaluator extracted the human oracle unconditionally, so a
document with an unplaced device failed default evaluation with "Oracle partition
requires placed devices", before the planner ran. Opus fixed `scripts/auto-layout-eval.mjs`:
oracle extraction is now required only with `--partition`, and otherwise its failure
becomes an `ORACLE_UNAVAILABLE` warning with no block metrics.

On the same unplaced fixture, the fixed evaluator now fails exactly as `main`'s evaluator
does: an unrelated route on the unplaced part. The oracle no longer adds a failure.

## PR review — codex round 2 on `e152a91`

One P2, reproduced: with the oracle unavailable, rendering still called `partitionBounds` on
an undefined partition. The previous head marked a document with an unplaced, unrouted part
`threw` ("Cannot read properties of undefined (reading 'blocks')"). Overlays are now skipped
without a partition, as `blockMetrics` already did. With both fixes the same document
completes default evaluation and renders its SVGs.

## Rebase onto main with T025, and PR review on `d6e1e37`

Rebased onto `078f407`. T025's symmetric components are rigid, so one spanning two
partition blocks would pull devices out of their block. In partition mode, only components
wholly inside one block apply. Without a partition, all 33 human cases match clean `main`
in metrics and plan hash.

One P2, reproduced: a case that completed in the baseline but is now refused skipped the
equality check, so `--baseline` exited 0 on the worst regression. A previously completed
case that is now refused is now unequal. A 121-instance fixture exits 0 before the fix and
1 after.
