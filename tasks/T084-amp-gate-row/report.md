# T084 report — round 1

## Summary

The step 2 prototype **failed the continuation gate**. On the three selected
high-crossing dev drawings, the selected layouts removed **1 crossing and 2 rail
crossings**, versus the required **4 crossings or 3 rail crossings**, with no
selected composite increase. The plan explicitly permits a negative result.
The prototype and investigation instrumentation were removed; this report is
the only retained change. No production implementation or new rule is proposed.

## Steps

| Step | Status  | Notes                                                                                                                                                                 |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Replanned all 15 drawings, reproduced all baseline plan hashes, identified every crossing and human arrangement, and traced R156 admission and finished comparisons.  |
| 2    | done    | Tried the dominant arrangement on `2adejzy693`, `3cr8ap2k4c`, and `54a79nkqef` as a separate finished finalist. Gate failed; stopped as instructed.                   |
| 3    | blocked | Not authorized to continue after the failed gate. No generalized production rule retained.                                                                            |
| 4    | blocked | No production implementation to test after the gate. Existing tests were not edited, weakened, or removed.                                                            |
| 5    | partial | Full 628-case acceptance evaluation requested below; the conditional human/main/T084 review page and top-ten/25-sample review were not pursued after the gate failed. |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Validation is against the restored, unchanged production sources. Logs are in
`/tmp/t084-*.log`; evaluation artifacts are in `tmp/auto-layout-eval/`.

```text
pnpm build → 0; all workspace builds completed (existing bundle-size warning).
pnpm typecheck → 0.
pnpm lint → 0; oxlint: 2067 files, 0 errors, 3467 warnings.
pnpm format:check → pending.
pnpm test:local → pending.
pnpm test:slow → pending.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → pending.
```

Corpus comparison and additional guard evidence: pending.

## Investigation results

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

The accepted layout's gain on one drawing is insufficient to pass the explicit
gate. The rejected second candidate shows that seating the amplifier between
branches does not itself make the routed/finished outcome better. The third
case cannot provide a competitive distinct draft with this placement. No second
arrangement, extra tuning round or generalized implementation was attempted after
this failure.

## Deviations and open questions

- Stopped after step 2 exactly as the plan's gate requires. The production code
  was restored byte-for-byte; no tests, dependencies, lockfile, plan or review
  changed, and no commit or branch operation was performed.
- No spec text is proposed because no production behavior is retained.
- A follow-up plan would need evidence for a broader rigid-row/branch-order
  move, or a different amplifier seat, while preserving safe routing. The
  experiment does not justify weakening T078 or copying human wire-through-symbol
  geometry.
- Conditional production tests and the three-column review page were not
  created after the failed gate. The full listed acceptance commands are still
  run and recorded above.
