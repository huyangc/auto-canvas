# T080 review

## Round 1 — Opus, 2026-11-14

Verdict: **decision given; implement.** Round 1 made no product change.
Its investigation is sound: four drawings in the corpus (dev `vcgtzej894`,
`6qg2h7weje`; val `sbfkkj67cm`, `x5jaqe94t7`) have the mirrored-downstream-stage
pattern, and their downstream halves cannot flank the driver by rigid
translation alone (equal 100 / 140 pair spans). The other four named dev
drawings are different problems and stay out of scope for this task.

### Decision on the open question

**Widening is allowed during the flank finalist's initial construction.**
The two halves of the downstream R89 block move outward symmetrically about
the driver's axis, by equal and opposite amounts; each half keeps its
internal offsets and orientations, and every mirrored pair stays mirrored.
The resulting block is then one rigid block for collision repair, search and
given-state finishing exactly as R89 / R94 require today. Use your proposed
spec text (in the report) as the basis for R158.

- Members on the downstream block's axis (tail source, shared bias, any
  axis-centred device) stay on the shared axis; they are not split.
- If a protected member, explicit floorplan or template spans both halves
  so that the halves cannot move apart without changing its internal
  geometry, do not build the variant for that document.
- The driver block is not changed.

### Findings

| #   | Severity | Area     | Finding | Required change |
| --- | -------- | -------- | ------- | --------------- |
| 1   | must-fix | scope    | Step 2 blocked on widening. | Implement the flank variant with the widening rule above, as an extra finalist after `attachment` (≤ 24 instances, half relocation / port-seat / rail-seat budgets, participation gate as for `attachment`; the runner, local-loop and attachment finalists keep their current behavior and order). Trigger only from connectivity and the R145 / R89 symmetry topology: the driver's mirrored output nets reach the downstream pair's inputs. Parallel-stage reordering by driver pin is optional; do it only if it is cheap and covered by tests. |
| 2   | must-fix | tests    | Step 3 not done. | A two-stage fully differential amplifier whose second stage flanks the first with fewer crossings; widening keeps each half rigid and pairs mirrored; an axis member stays on the axis; a non-symmetric chain is unchanged; a worse variant is rejected; determinism. Synthetic circuits only — never commit a Gallery drawing. |
| 3   | must-fix | evidence | Large documents and held-out timing were not measured. | Use the harness copied into `tmp/t080-harness/`: `large-input/` holds the six large documents; `verify-large.mjs` and `timing.mjs` are T079's scripts (fix their worktree path `W` and output paths to this worktree). The main `8cdec30` build is at `/tmp/t080-baseline/dist` (`index.js`, `timing.js`). Run timing alone, with nothing else running. |

### Gates for round 2

Against `tmp/main-8cdec30-report.json`: composite lower on dev and val;
crossings lower on dev and val; no drawing's composite higher than main;
628/628 equivalent; floating and missing not above main; every `VISUAL_*`
total not above main except label clearance; six large documents
byte-identical and deterministic; held-out medians within +20%. All
acceptance commands in the plan. Review page human | main | T080 for the four
flank drawings, the ten whose composite falls most, and the 25 samples.

## Round 2 — Opus, 2026-11-14

Verdict: **closed, not merged.** The flank finalist is built correctly and is
safe (628/628 byte-identical to main, large documents identical, held-out
≤ +3.9%), but it never wins finished selection: on `6qg2h7weje` crossings fall
5 → 4 while port order rises 0 → 4 and area grows (composite 0.569 → 0.906).
Only four corpus drawings qualify, so even a successful port-coordination
round would move dev by at most about 0.5 composite units, against the 3.4
still needed. Code that never changes a plan is not worth carrying; the work
stays on this branch for reference. Remaining effort goes to larger excess
sources (rail crossings, unowned drafting, area, other crossing causes).
