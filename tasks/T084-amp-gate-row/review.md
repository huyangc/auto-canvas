# T084 review

## Round 1 — Opus, 2026-11-14

Verdict: **gate passes on composite; implement.** Opus stopped round 1 after
the report was written (the remaining acceptance runs were on unchanged
code). The investigation is good (inventory of all 25 crossings).

The gate in the plan was written in crossing counts ("4 crossings or 3 rail
crossings"), but its purpose is composite gain, and the frozen weights price
a rail crossing at about 1.7 ordinary crossings (per unit 0.183 vs 0.108).
The prototype removed 1 crossing + 2 rail crossings ≈ 4.4 crossing
equivalents, with no composite rise; `2adejzy693` alone fell 0.801 → 0.404,
which is 62% of the 0.64 units dev still needs. **That passes the gate's
intent.** Opus's mistake in the wording, not yours.

| #   | Severity | Area | Finding | Required change |
| --- | -------- | ---- | ------- | --------------- |
| 1   | must-fix | scope | Steps 3–5 not done because the gate was judged by counts. | Restore the prototype (saved in this worktree at `tmp/t084-proto/t084-amp-gate-row.ts` and `tmp/t084-proto/t084-prototype.patch`; runs in `tmp/t084-proto/runs/`) and implement it generally as plan steps 3–5 describe: an extra finished finalist after `attachment` (≤ 40 instances, its own bounded budget, the T078 comparator decides, fixed order), recognition from connectivity / pin roles / device class only, rows and R89 / R94 blocks rigid, protected members and floorplans untouched. Then evaluate all 15 drawings and the full corpus. |
| 2   | should-fix | coverage | The inventory shows 8 of 10 rail crossings involve the amplifier output `G` crossing a VDD source stub or row rail, and many ordinary crossings are `G` × a sensed drain (`F±`). | While implementing, check whether the same arrangement (amplifier between the sensed branches, output toward the gate row) also removes `G` × sensed-drain crossings in `7aevq3rx4z`, `d2bpftaqyq`, `gh3gcb5h3a`, `2jhdk32et5`, `6qd8k68e2t`, `vhg3q4gax7`; report per drawing. Do not add a second arrangement unless it is cheap and covered by tests. |

Gates (unchanged from the plan): dev composite lower than main's 53.315
(target ≤ 52.68), val not higher, no drawing worse, 628/628 equivalent,
guards, determinism, six large documents identical, held-out medians within
+20% (timing alone). Review page human | main | T084 for the 15 drawings, the
ten largest falls and the 25 samples.
