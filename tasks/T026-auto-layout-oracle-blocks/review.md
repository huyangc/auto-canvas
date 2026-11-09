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
