# T085 review

## Round 1 — Opus, 2026-11-14

Verdict: **one small round.** The finalist works: dev composite 52.880 →
52.442 (**1.1946×** human, the goal), val 27.469 → 27.131, two better, none
worse, 628/628 equivalent, large documents identical. Human drawings place the
paired RC outside their transistor columns, as the variant does.

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | tests | `symmetry.test.ts:691` ("pairs swapped %s pins and places both partners mirrored inside the block", R / C / L) asserts each feedback passive lies **inside the combined a / b / tail bounds**. It came from T038 (R142), whose user report was mirrored resistors **stacked in a corner with detours**; its intent is "near the block, mirrored, level", not "between the transistors". The human drawings and the frozen composite now prefer the passives just outside their transistor. | Keep every other assertion (pairing, net map, axis sides, sum = 2·axis, same level, reflected orientation, the reversed-order repeat). Replace only the inside-bounds loop with: each passive's visible bounds lie within the hosts' horizontal span **extended by one R154 member pitch on each side** (use the document's member pitch as the planner computes it, not a literal from the result) and within the hosts' vertical span; and each passive is nearer to its own transistor (`passive-left` → `a`, `passive-right` → `b`) than to the other. This still fails for the old corner-stacking bug. Show in the report that the new assertion fails on a placement that parks the passives in a corner (a quick local check is enough; no new fixture needs committing) and passes on both main and this branch. |

Then rerun `pnpm test:local` (local services) and `pnpm format:check`; the
corpus does not need rerunning if no source file changes. Finish the timing
table already running.
