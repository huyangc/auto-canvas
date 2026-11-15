# T084 report — round 2

## Summary

Restored and generalized the approved prototype as a fourth finished finalist,
after runner, local-loop and attachment. It recognizes a direct amplifier-driven
MOS gate/BJT base bank with two distinct directly sensed conducting branches,
and seats only the unprotected amplifier between them, facing the rigid row.
The existing T078 admission and finished comparator decide whether it wins.

All acceptance commands pass. The full corpus has 2 improved, 0 worse and
626 identical plans, with 628/628 electrical equivalence and no guard regression.
Dev composite improves 53.315154 → 52.880308; val is unchanged. The 52.68
target remains unmet. All seven held-out timing medians are within
+20% (worst +2.13%); all six large-document plans are byte-identical to main.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                                 |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained the round 1 inventory of all 25 crossings and three human arrangements below.                                                                                                                                                                                                                                |
| 2    | done   | Restored the saved prototype; review accepts its 1 crossing + 2 rail-crossing reduction as passing the gate's composite intent.                                                                                                                                                                                       |
| 3    | done   | General electrical recognition, fixed finalist order, ≤40 instances, independent bounded finishing budget; protected amplifiers and explicit floorplans are excluded. Receiver placements remain rigid.                                                                                                               |
| 4    | done   | Synthetic tests cover routed crossing reduction, unchanged receiver placements, MOS/BJT recognition, missing feedback, one receiver, same-branch ambiguity, protection, collisions across partitions, floorplans, given placements, worse finished layout rejection, fixed finalist order and deterministic planning. |
| 5    | done   | Evaluated all 628, replayed and visually reviewed 47 drawings, verified six large documents and seven isolated held-out timing cases. The 52.68 target remains unmet.                                                                                                                                                 |

## Review findings addressed

- **Must-fix #1:** restored the prototype from `tmp/t084-proto`, removed all
  investigation hooks, and implemented steps 3–5. Recognition is independent
  of instance/net names and initial coordinates. The seat uses coordinates only
  after recognition. R89/R94 members, coupled members, explicit symmetric
  constraints, layout groups, templates and fixed members are protected;
  receiver rows are never moved by this variant.
- **Should-fix #2:** evaluated the same arrangement on all six requested
  sensed-drain examples; per-drawing results follow. No second arrangement added.

## Acceptance results

Logs: `/tmp/t084-r2-*.log`. Full report:
[`tmp/t084-round2/report.json`](../../tmp/t084-round2/report.json).

```text
pnpm build → 0; all workspace builds passed (existing bundle-size warning).
pnpm typecheck → 0.
pnpm lint → 0; 2069 files, 0 errors, 3467 warnings.
pnpm format:check → 0; all matched files use Prettier style.
pnpm test:local → 0 with local-service access; 799 files passed, 3 skipped;
                  8225 tests passed, 117 skipped (103.11 s).
pnpm test:slow → 0; 2 files, 8 tests passed.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 completed.
```

Focused synthetic/selection tests: **24/24 passed** in two files.
The initial sandbox local suite had 18 failed files, 781 passed, 3 skipped;
61 failed tests, 8131 passed, 150 skipped, and two local-listen errors.
The complete suite passed after rerunning with local-service access.
Its initial detailed errors are preserved in `/tmp/t084-r2-test-local.log`.

### Corpus and guards

- Dev composite **53.315154 → 52.880308** (−0.434846), human 43.899768,
  ratio **1.204569×**. Lower than main, but **0.200308 above the 52.68 target**;
  the overall 20% readability goal remains unmet.
- Val composite unchanged at **27.469133**, human 23.595474, ratio **1.164170×**.
- **2 improved / 0 worse / 626 equal** per-drawing composites.
- **628/628 equivalent**. Floating/missing totals unchanged at **6 / 4**.
- **No `VISUAL_*` total increased**, including label clearance.
- All **six large documents** are byte-identical to main and deterministic
  across independent repeated calls: 50, 50, 51, 103, 70 and 94 instances.
  Evidence: [`large.json`](../../tmp/t084-round2/large.json).
- All **seven held-out timing medians pass** the +20% limit; worst **+2.13%**.
  Each baseline/current implementation was warmed once, then run three times
  in alternating order with all other task workloads stopped. All seven current
  and baseline plan hashes are deterministic and identical. Evidence:
  [`timing.json`](../../tmp/t084-round2/timing.json).

### All 15 investigated drawings

| Drawing      | Main crossings / rail | T084 crossings / rail | Main composite | T084 composite | Plan hash unchanged |
| ------------ | --------------------- | --------------------- | -------------- | -------------- | ------------------- |
| `2adejzy693` | 3 / 2                 | 2 / 0                 | 0.800925       | 0.404022       | no                  |
| `3cr8ap2k4c` | 2 / 2                 | 2 / 2                 | 0.734830       | 0.734830       | yes                 |
| `54a79nkqef` | 2 / 1                 | 2 / 1                 | 0.468597       | 0.468597       | yes                 |
| `7d93gjqbw8` | 2 / 1                 | 2 / 1                 | 0.511056       | 0.511056       | yes                 |
| `ecyqst76jd` | 2 / 1                 | 2 / 1                 | 0.502493       | 0.464550       | no                  |
| `x7evbngj49` | 2 / 1                 | 2 / 1                 | 0.530071       | 0.530071       | yes                 |
| `7aevq3rx4z` | 2 / 0                 | 2 / 0                 | 0.284147       | 0.284147       | yes                 |
| `d2bpftaqyq` | 2 / 0                 | 2 / 0                 | 0.276184       | 0.276184       | yes                 |
| `gh3gcb5h3a` | 2 / 0                 | 2 / 0                 | 0.335690       | 0.335690       | yes                 |
| `ray97q5c2j` | 1 / 1                 | 1 / 1                 | 0.450641       | 0.450641       | yes                 |
| `rryf923yjz` | 1 / 1                 | 1 / 1                 | 0.356246       | 0.356246       | yes                 |
| `2jhdk32et5` | 1 / 0                 | 1 / 0                 | 0.195018       | 0.195018       | yes                 |
| `6qd8k68e2t` | 1 / 0                 | 1 / 0                 | 0.123339       | 0.123339       | yes                 |
| `vhg3q4gax7` | 1 / 0                 | 1 / 0                 | 0.168757       | 0.168757       | yes                 |
| `wkcb83t9pg` | 1 / 0                 | 1 / 0                 | 0.282646       | 0.282646       | yes                 |

The same arrangement removes neither gate × sensed-drain crossing in
`7aevq3rx4z`, nor the gate × sensed-drain crossings in `d2bpftaqyq`,
`gh3gcb5h3a`, `2jhdk32et5`, `6qd8k68e2t`, or `vhg3q4gax7`: all six selected
plans are byte-identical to main, so their precise crossing identities remain
those recorded in the inventory below. This addresses review finding #2.

`2adejzy693` retains the prototype's 1 total/2 rail-crossing reduction and gains
0.396902 composite. `ecyqst76jd` gains 0.037943 without a crossing reduction:
area falls 1748.709 → 800.354 and terminal-departure violations fall 1 → 0.
Crossing identities after finishing are also recorded in
`tmp/t084-round2/dumps/`: `2adejzy693` has two G × F+ crossings at (310,470)
and (260,500), with neither rail stub crossing remaining; `ecyqst76jd` now
has G × F+ at (510,510) and F+ × a rail stub at (370,560).

Other metrics can trade off under the existing comparator: its detour metric
rises 0.177 → 2.329, while the total frozen composite improves. No comparator
or weight was changed.

### Review page and determinism

[Human | main 8c37219 | T084 review page](../../tmp/t084-round2/review.html):
**47 unique drawings**, comprising all 15 named examples, the ten largest
composite falls (two improvements plus eight unchanged ties), and the original
25 samples. All 47 independently replayed hashes match the corpus report;
changed baseline drawings were separately replanned and their hashes verified.

Inspected all 12 rendered sheets (`review-1.png` through `review-12.png`).
`2adejzy693` loses both rail crossings but still has two signal crossings;
`ecyqst76jd` becomes more compact but retains two crossings and a detached Y
annotation. The other 45 reviewed drawings retain main's geometry. No horizontal
overflow: content and viewport both 1800px. Browser rendering used installed
Chrome with local process access; no dependency or browser installation.
Evidence: [`review-verification.json`](../../tmp/t084-round2/review-verification.json)
and [`review-layout.json`](../../tmp/t084-round2/review-layout.json).

```text
node tmp/t084-round2/verify-large.mjs → 0; 6/6 identical and deterministic.
node tmp/t084-round2/dump.mjs <15 IDs> → 0; per-crossing geometry recorded.
node tmp/t084-round2/review.mjs → 0; 47 replay hashes verified.
node tmp/t084-round2/render.mjs → 0 with installed Chrome/local process access.
node tmp/t084-round2/timing.mjs → 0; 7/7 timing and determinism checks pass.
```

### Isolated held-out timing

| Case               | Main median (ms) | T084 median (ms) | Change |
| ------------------ | ---------------- | ---------------- | ------ |
| `fd-two-stage`     | 1581.2           | 1614.9           | +2.14% |
| `common-source-ac` | 1016.0           | 1007.9           | -0.80% |
| `skew`             | 1761.4           | 1764.8           | +0.19% |
| `deadtime`         | 9964.2           | 10011.1          | +0.47% |
| `ota-sky130`       | 677.5            | 681.8            | +0.64% |
| `widlar`           | 5354.6           | 5278.8           | -1.42% |
| `ltc3452`          | 14056.9          | 14083.5          | +0.19% |

## Investigation results

### Round 2 implementation

`amplifierGateRows` narrows the existing local-loop recognition to a direct
output-to-gate/base bank of at least two MOS/BJT devices, with exactly two
non-rail conducting terminals sensed by distinct amplifier inputs on distinct
receivers. Indirect/passive chains and ambiguous sensed banks are excluded.
This topology check also avoids drafting a gate-row variant for unrelated
single-transistor feedback loops.

For an aligned sensed pair, the amplifier output is snapped to the midpoint,
40 coordinate units toward the sensed-terminal side; its output faces the row.
The stable rotation/reflection order and minimum input-to-sensed-pin Manhattan
distance choose the seat. Whole-document collision checking includes obstacles
outside the local partition. Every non-amplifier target stays unchanged.

The existing ≤40-instance finalist bound applies. Each admitted gate-row
continuation gets its own standard finishing trial budget, without repeating
strategy search or annealing. The unchanged comparator enforces completeness,
composite, zero-baseline weighted violations and visual/routing guards.
Quick mode and larger documents do not admit the variant.

### Round 1 investigation (retained evidence)

### Method and evidence

Used the actual bounded planner (seed 1, `defaultLayoutSearch` evaluations),
not the older result dumps supplied with the plan. All **15/15** generated plan
SHA-256 hashes matched `tmp/main-8c37219-report.json`. Temporary hooks observed
R156's provisional drafts and the fully finished results immediately before
`selectFinishedLayout`; hooks did not change selection. Human geometry came
from the input projects. No LLM provider call was made.

Reproducible local evidence, deliberately outside the committed tree:

- `/tmp/t084-dump.mjs`, `/tmp/t084-dumps/<id>.json`: baseline replans, human/result
  pin positions, segments, crossing coordinates and exact Net IDs, and finalist traces.
- `/tmp/t084-analyze.py`, `/tmp/t084-analysis.txt`: expanded crossing/terminal
  lists and admission/finished scores for all 15.
- `/tmp/t084-prototype.mjs`, `/tmp/t084-prototype/<id>.json`: the three prototype
  runs, including the rejected finished candidate.
- `/tmp/t084-prototype.patch` plus `/tmp/t084-amp-gate-row.ts`: the temporary
  wiring/instrumentation diff and new prototype source, saved before removal.

### Crossing inventory

Each `G` is the Net on the drawing's amplifier `OUT`; `F+` and `F−` are its
`IN+` and `IN−` Nets. These terminal identities unambiguously identify the Nets
without copying long import-generated IDs. `VDD` denotes the actual classified
supply Net, not text-based recognition. `Qright` in `3cr8ap2k4c` is
`Q1-copy-1-copy-1`. Parenthesized coordinates are the **baseline result** crossing
points. Rail crossings are a subset of total crossings, not an additional count.

| Drawing      | Total / rail | Every crossing and the two Nets involved                                                          |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `2adejzy693` | 3 / 2        | G × VDD/M2.S (400,150); Q3.B/GND7.0 rail stub × R2.2/Q3.E (690,200); F−/M1.D × F+/M2.D (300,230). |
| `3cr8ap2k4c` | 2 / 2        | Qright.B/GND5 rail stub × Qright.E/R1.2 (620,240); G × VDD receiver-source stub (320,160).        |
| `54a79nkqef` | 2 / 1        | G × VDD row rail (390,110); G × F+/M2.D (550,110).                                                |
| `7d93gjqbw8` | 2 / 1        | G × VDD receiver-source stub (420,210); F−/left receiver D × F+/middle receiver D (320,290).      |
| `ecyqst76jd` | 2 / 1        | G × VDD receiver-source stub (510,280); F−/left receiver D × F+/middle receiver D (410,360).      |
| `x7evbngj49` | 2 / 1        | G × VDD source rail (250,160); F−/left receiver D × F+/right receiver D (370,270).                |
| `7aevq3rx4z` | 2 / 0        | G × F−/left sensed receiver D (310,230); G × F+/right sensed receiver D (430,230).                |
| `d2bpftaqyq` | 2 / 0        | G × F+/M1.D/M3.D (310,150); F+ × F−/M2.D/M4.D/M3.G/M4.G (290,170).                                |
| `gh3gcb5h3a` | 2 / 0        | F+/M1.D × F−/M2.D (460,310); G × F−/M2.D (530,280).                                               |
| `ray97q5c2j` | 1 / 1        | G × VDD/M1.D/M2.D/M3.D rail stub (380,80).                                                        |
| `rryf923yjz` | 1 / 1        | G × VDD/M1.S/M2.S (240,140).                                                                      |
| `2jhdk32et5` | 1 / 0        | G × F−/left receiver D (490,320).                                                                 |
| `6qd8k68e2t` | 1 / 0        | G × F−/M1-copy-1.D/R2.1 (280,400).                                                                |
| `vhg3q4gax7` | 1 / 0        | G × F+/M2.D/M4.D (290,290).                                                                       |
| `wkcb83t9pg` | 1 / 0        | G × M2.D/M4.D branch drop (390,250), which is not the amplifier's sensed branch.                  |

There are 25 total crossings, including 10 rail crossings. Eight rail crossings
involve G; two are unrelated grounded BJT-base stubs. The remaining 15 are
signal/signal: ten G/branch crossings and five crossings between amplifier input
branches. Thus a gate-Net-only reroute cannot directly address all of the excess.

### Human arrangements: three groups

**A — amplifier between branches, below the receiver row, output upward**
(13 drawings, 23 total / 10 rail crossings in the result). The gate conductor
runs horizontally at the receiver gate level above the amplifier. The first
pair's gates face inward; extra receivers generally continue rightward. Sources
are above and sensed drains below for PMOS, while `ray97q5c2j` has NMOS drains
above and sensed sources below. The amplifier inputs face down toward the
branch nodes. This is the dominant arrangement selected for the prototype.

The following row orders are **human left to right**; “extra” is a receiver
whose conducting terminal is not directly sensed by the amplifier. The table
also identifies the input-to-branch mapping, including exceptions to direct
sensing.

| Drawing      | Human receiver row order                             | Amplifier location and sensed branches                                                                                                 |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `2adejzy693` | M1(F−), M2(F+), M2-copy-1(extra)                     | Between M1/M2, below gates; F−=M1.D/Q1.E, F+=M2.D/R1.1.                                                                                |
| `3cr8ap2k4c` | M1-long-copy(F−), M2-long-copy(F+), M1-copy-1(extra) | Between the first pair, below gates; F− reaches left D/Q emitter, F+ reaches middle D/R1.1. “long-copy” means four `-copy-1` suffixes. |
| `54a79nkqef` | M1(F−), M2(F+), M3(extra)                            | Between M1/M2, below gates; F−=M1.D/Q1.E, F+=M2.D/R1-copy-1.1.                                                                         |
| `7d93gjqbw8` | M1-copy(F−), M2-copy(F+), extra M2-copy              | Between the first pair, below gates; senses their drains (left Q emitter, middle resistor top).                                        |
| `ecyqst76jd` | M1-copy(F−), M2-copy(F+), extra M2-copy              | Same arrangement; left D/Q emitter and middle D/resistor top.                                                                          |
| `x7evbngj49` | M1-copy(F−), M2-copy(F+)                             | Between the pair, below gates; senses both drains, with resistor attachments on both branches.                                         |
| `7aevq3rx4z` | M1-long-copy(F−), M2-long-copy(F+), M1(extra)        | Between the first pair, below gates; senses both drains, with resistor attachments.                                                    |
| `d2bpftaqyq` | M2(F−), M1(F+)                                       | Between PMOS branches, below gates; F−=left PMOS/NMOS drain and NMOS gates, F+=right PMOS/NMOS drain.                                  |
| `gh3gcb5h3a` | M1(F+), M2(F−), M3(extra)                            | Between M1/M2, below gates; reflected inputs, F+=left D/Q1.E/R2.1, F−=middle D/R1.1/R4.1.                                              |
| `ray97q5c2j` | M1(F−), M2(F+), M3(extra)                            | Between M1/M2, below gates; F− senses left S/Q1.E/R3.1, F+ senses middle S/R1.1/R4.1.                                                  |
| `rryf923yjz` | M2(left branch), M1(right branch)                    | Between the pair, below gates; F+ senses left branch **after R1** (R1.2/R3.1), F− senses right branch **after R2** (R2.2/Q2.E).        |
| `2jhdk32et5` | M1-copy(F−), M2-copy(F+)                             | Between the pair, below gates; F−=left D/Q emitter, F+=right D/resistor top.                                                           |
| `6qd8k68e2t` | M1-copy(F−), M2-copy(extra)                          | Between the pair, below gates; F− senses left D/R2.1; F+ is the separate V1 reference, not the other receiver's D.                     |

**B — amplifier between branches, above the receiver row, output downward**
(`vhg3q4gax7`, 1 / 0). NMOS receiver order is M4(F+) then M3(F−). The horizontal
gate line is below the amplifier. Its upward-facing inputs sense the left
M4.D/M2.D branch and right M3.D/M1.D branch; the left NMOS gate faces right and
the right gate faces left.

**C — amplifier on the left, output along the row**
(`wkcb83t9pg`, 1 / 0). PMOS receiver order is M5, M3, M4, all gates facing left.
The amplifier is left of M5 and points right along the gate level. F+ senses
M5.D/I1.+; F− is an external input port. The crossed M4.D branch is farther
right and unsensed. It is not the between-two-sensed-branches case.

The human zero-crossing reference is not universally a safe routing template:
`2adejzy693`, `3cr8ap2k4c`, and `54a79nkqef` respectively have **1, 2, 1** frozen
`wireThroughSymbols` violations. In `2adejzy693`, the straight human gate line
continues through the middle receiver body toward the third gate. A safe router
must go around that body, which can intersect a source/drain drop. This observation
explains why copying the visual straight line alone is insufficient; it does not
prove that a different rigid-block arrangement could never improve it.

### Why R156 did not win

All 15 were recognized and a local-loop draft was built. “Same” below means
that the provisional placements were identical and so no additional finishing
was admitted; it does not mean recognition failed. Multiple values correspond
to the planner's separate series/pitch paths. Distinct drafts must satisfy the
unchanged T078 routed-score margin `min(12500, 0.55 × incumbent score)`.
For all rejected distinct paths except `vhg3q4gax7`, the margin was 12500;
for that drawing it was 3868.769. Provisional routed-score deltas are not frozen
composite deltas.

| Drawing      | R156 provisional routed-score delta(s)             | Finished outcome                                     |
| ------------ | -------------------------------------------------- | ---------------------------------------------------- |
| `2adejzy693` | Same; +41954.154 (over margin)                     | Not finished.                                        |
| `3cr8ap2k4c` | +42680.504 (over margin); +51720.026 (over margin) | Not finished.                                        |
| `54a79nkqef` | Same; +24278.814 (over margin)                     | Not finished.                                        |
| `7d93gjqbw8` | Same; +86254.483 (over margin)                     | Not finished.                                        |
| `ecyqst76jd` | Same; +61443.844 (over margin)                     | Not finished.                                        |
| `x7evbngj49` | +32228.907 (over margin); +16299.353 (over margin) | Not finished.                                        |
| `7aevq3rx4z` | +23483.228 (over margin); +1352.945 (admitted)     | Composite 0.284147 → 0.626051 (+0.341904); rejected. |
| `d2bpftaqyq` | +4544.470 (admitted)                               | Composite 0.276184 → 0.328027 (+0.051843); rejected. |
| `gh3gcb5h3a` | +21154.991 (over margin); +26814.259 (over margin) | Not finished.                                        |
| `ray97q5c2j` | +15428.632 (over margin); +22125.627 (over margin) | Not finished.                                        |
| `rryf923yjz` | +1454.548 (admitted); +9053.075 (admitted)         | Composite 0.356246 → 0.530268 (+0.174022); rejected. |
| `2jhdk32et5` | Same; +23668.208 (over margin)                     | Not finished.                                        |
| `6qd8k68e2t` | Same                                               | Not finished.                                        |
| `vhg3q4gax7` | +6072.640 (over margin)                            | Not finished.                                        |
| `wkcb83t9pg` | +17948.056 (over margin)                           | Not finished.                                        |

### Prototype and continuation gate

The trial used the dominant A arrangement on the three highest-ranked examples
in the plan. It recognized direct amplifier output-to-gate/base banks of MOS/BJT
devices, required two distinct directly sensed conducting branches, and placed
only the unprotected amplifier between those branches. It aligned the output
40 grid-coordinate units toward the sensed-terminal side of the gates, facing
the row, and chose the input reflection with the shorter sensed-pin distance.
Receiver placements, templates, symmetry pairs and other rigid units were not
moved. A collision or non-aligned pair left the placement unchanged. Explicit
floorplans were excluded. Recognition used connectivity, pin roles and device
class; coordinates were used only to place the recognized structure.

The prototype registered `gateRow` after `runner`, `localLoop`, and `attachment`,
used the existing ≤40-instance finalist bound, T078 admission and finished
comparator, and its own full finishing budget. Existing finalists retained their
order and budgets. No metrics, weights or comparator rules changed.

| Drawing      | Main crossing / rail | Selected prototype crossing / rail | Main composite | Selected composite | Candidate disposition                                                                                                               |
| ------------ | -------------------- | ---------------------------------- | -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `2adejzy693` | 3 / 2                | 2 / 0                              | 0.800925       | 0.404022           | Finished and selected; both provisional paths admitted (+11419.038 and −30245.988 routed-score deltas).                             |
| `3cr8ap2k4c` | 2 / 2                | 2 / 2                              | 0.734830       | 0.734830           | Finished candidate composite 0.779197 (+0.044367), still 2 / 2; rejected.                                                           |
| `54a79nkqef` | 2 / 1                | 2 / 1                              | 0.468597       | 0.468597           | First path +39434.837 routed-score delta exceeds 12500 margin; second path has identical placements. No distinct finalist finished. |
| Total        | 7 / 5                | 6 / 3                              | —              | —                  | Net removal: **1 total crossing, 2 rail crossings**.                                                                                |

The round 1 count-only gate interpretation is superseded by the review: this
passes the intended composite gate (about 4.4 ordinary-crossing equivalents).

## Deviations and open questions

- The review explicitly authorizes continuation on the prototype's composite
  gain despite the original count wording. No metrics, weights or comparator
  rules were changed.
- The readability target remains unmet by 0.200308 composite units. The six
  additional sensed-drain cases show no selected improvement from this same
  arrangement; no second arrangement was introduced.
- No dependency changes, provider API calls, commits or branch changes.
- Proposed spec addition: for documents of at most 40 instances, after existing
  finalists, offer one direct amplifier gate/base-row finalist between two
  distinct directly sensed conducting branches. Keep receivers and protected
  units rigid, exclude explicit floorplans, use a separate bounded finishing
  budget, and accept only through T078's existing admission and final guards.
