# T085 report — round 1

## Summary

Implemented an optional fifth finished finalist, `halfOrder`, after `gateRow`.
It recognizes mirrored two-pin attachments by connectivity and MOS/BJT terminal
roles, orders them toward the outside of each R89 half, then uses the existing
T078 admission and finished comparator. The default placement, frozen metrics,
and weights are unchanged. The full corpus meets the target: dev composite
**52.441790 (1.194580× human)** and val **27.131157 (1.149846× human)**, with
**2 improved / 0 worse / 626 identical** plans and **628/628 equivalent**.

The investigation gate passed: three prototypes improved summed frozen
composite by **0.776493693**, with no increase. Acceptance is **partial**.
Opus's round 1 review arrived during final verification; its requested bounded
proximity assertion now passes for the feedback resistor and capacitor, but
the inductor extends **102 units** beyond its host bounds, exceeding the
computed **80-unit** R154 member pitch by **22 units**. The requested bound is
preserved; the remaining failure is reported below.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Scanned all 628 dev/val drawings; replayed all 32 crossing drawings with paired two-pin R89 members and verified baseline hashes. Four drawings have internal-half crossings involving an inward part. Prototype gate passed.                                                                                                                  |
| 2    | done    | General connectivity recognition; stable outward ordering; paired eligibility; cross-coupled hosts and axis members excluded; fifth finalist under the existing ≤40-instance bound.                                                                                                                                                            |
| 3    | partial | New synthetic tests pass for RC crossing reduction, mirroring, determinism, unchanged blocks and cross-coupled devices, and rejected mixed-host feedback. Applied the arriving review’s replacement proximity assertion without changing other assertions. Resistor/capacitor pass; inductor exceeds the required one-pitch bound by 22 units. |
| 4    | done    | Full 628-case evaluation passes the target and guards; all six large documents are identical and deterministic; all seven held-out timing medians pass. Reviewed all 27 required drawings.                                                                                                                                                     |

## Review findings addressed

`review.md` was absent at task start and appeared during the final status check.
It has not been edited.

**Must-fix #1 — partially addressed.** Replaced only the host-bounds loop and
renamed its test description. Horizontal bounds now allow exactly
`placementPitch(classifyNets(d, resolver)).member` on each side; vertical bounds
are unchanged. Pin-centre Euclidean distance must be smaller to the passive's
own transistor than to the opposite transistor. Pair detection, Net mapping,
axis-side checks, mirrored sums, equal levels, orientation reflection and the
reversed-input detection repeat are unchanged.

Local verification (`node /tmp/t085-proximity-check.mjs`, exit 0) applies the
same bounds/proximity checks to both actual main and T085 plans and to a
mutated corner-stacked placement. Full evidence is in
`/tmp/t085-proximity-check.json`.

| Part      | Main passes | T085 passes | Corner-stack rejected on both |
| --------- | ----------- | ----------- | ----------------------------- |
| Resistor  | yes         | yes         | yes                           |
| Capacitor | yes         | yes         | yes                           |
| Inductor  | yes         | **no**      | yes                           |

The remaining inductor failure is exact: its visible left edge is **−3**, while
the hosts start at **99**, so the allowed minimum is **99 − 80 = 19**. Its right
partner symmetrically exceeds the upper bound. Both retain same-half and
own-transistor proximity. No literal allowance was inferred from the result,
and the pitch limit was not relaxed to pass this test. This requested
assertion therefore cannot be reported as passing on this branch.

## Acceptance results

Logs and detailed evidence are in `/tmp/t085-*`; corpus artifacts are in
`tmp/auto-layout-eval/`.

```text
pnpm build → 0.
pnpm typecheck → 0.
pnpm lint → 0; 2071 files, 0 errors, 3474 warnings.
pnpm format:check → 0; all matched files use Prettier style.
pnpm test:local packages/auto-layout/test/symmetric-half-order.test.ts packages/auto-layout/test/finished-selection.test.ts
  → 0; 2 files, 16 tests passed.
pnpm test:slow → 0; 2 files, 8 tests passed.
pnpm test:local → 1 in sandbox; 18 failed files, 782 passed, 3 skipped;
  63 failed tests, 8134 passed, 150 skipped, 2 local-listen errors.
pnpm test:local (with local-service access) → 1; 799 passed files,
  1 failed, 3 skipped; 8227 passed tests, 3 failed, 117 skipped.
  Historical run before the review arrived: all 3 failures were the original
  inside-host-bounds assertions.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 completed.
python3 tmp/excess.py tmp/auto-layout-eval/report.json → 0.
python3 tmp/opus-compare.py tmp/main-578a79e-report.json tmp/auto-layout-eval/report.json
  → 0; 2 better / 0 worse / 626 same; 628/628 equivalent;
  floating/missing unchanged at 6/4; no visual total increases.
node /tmp/t085-verify-large.mjs → 0; six identical, deterministic plans.
pnpm test:local packages/auto-layout/test/symmetry.test.ts
  → 1 before review; 39 passed, 3 failed (original inside-host-bounds assertions).
pnpm test:local packages/auto-layout/test/symmetry.test.ts (after review)
  → 1; 41 passed, 1 failed (inductor exceeds one member pitch).
pnpm test:local (after review, with local-service access)
  → 1; 799 passed files, 1 failed, 3 skipped;
  8229 passed tests, 1 failed, 117 skipped (100.09 s).
  Only the inductor's one-member-pitch proximity assertion fails.
pnpm typecheck / pnpm lint / pnpm format:check (after review) → all 0.
  lint: 2071 files, 0 errors, 3474 warnings.
```

### Corpus and guard results

| Split | Main composite | T085 composite | Human composite | T085 / human |
| ----- | -------------- | -------------- | --------------- | ------------ |
| Dev   | 52.880307921   | 52.441789672   | 43.899767814    | 1.194580115  |
| Val   | 27.469132806   | 27.131157361   | 23.595473540    | 1.149845851  |

Dev is below **52.68**, and both splits improve on main. Only
`m3ek9hty4p` and `3m82hv6t7a` change plan hashes; the other **626 plans are
byte-identical**. Their scores and crossing reductions match the prototype
table below. All **628/628** drawings remain electrically equivalent;
floating/missing totals remain **6 / 4**, and no `VISUAL_*` guard total increases.
`/tmp/t085-compare.log` records the comparison.

Both changed drawings retain all four mirrored, level, orientation-mirrored
pairs; `3m82hv6t7a` also retains its one on-axis device. The frozen comparator
allows unweighted tradeoffs: bends rise 4→6 and narrow bands 1→5 in
`m3ek9hty4p`; bends rise 7→8 and narrow bands 4→8 in `3m82hv6t7a`.
Crossings fall to zero in both, area decreases, and neither introduces a visual
guard increase. No score/weight was changed to obtain the improvement.

All six large documents (**50, 50, 51, 103, 70, 94 instances**) are byte-identical
to main and deterministic across independent repeated calls. Evidence:
`/tmp/t085-large.json`. The harness uses the preserved main build at
`/tmp/t085-baseline/dist`, with a local dependency-resolution symlink to the
already installed auto-layout dependencies; no installation was performed.

### Review page and determinism

[Human | main 578a79e | T085 review page](/tmp/t085-review/review.html) contains
**27 drawings**: both affected drawings and the original 25 samples from
`/tmp/t080-round1/samples.json`. Every independent replay matches the full
corpus plan hash; both changed baseline drawings were separately replanned and
verified against the baseline report. Evidence:
`/tmp/t085-review/review-verification.json`.

Inspected all seven rendered sheets, `review-1.png` through `review-7.png`.
Both changed drawings now place the RC parts outside their transistor columns
and eliminate the internal crossings. The results retain vertical resistors
and some tight input/output label spacing; they are not copies of the human
layouts. The 25 sample drawings retain baseline geometry, including its
existing readability limitations. The page has no horizontal overflow
(content and viewport both 1800 px). Evidence:
`/tmp/t085-review/review-layout.json`.

```text
node /tmp/t085-review.mjs → 0; 27 independent replay hashes verified.
node /tmp/t085-render.mjs → 0 with installed Chrome/local process access;
  27 drawings rendered across 7 sheets, no horizontal overflow.
node /tmp/t085-timing.mjs → 0; all 7 timing and determinism checks pass.
```

Chrome initially could not launch in the sandbox (exit 1, “Target page,
context or browser has been closed”); the same renderer succeeded with local
process access. No browser or dependency was installed.

### Isolated held-out timing

Each implementation was warmed once, then measured three times in alternating
order with the other task workloads stopped. All seven baseline and current
hash sets are deterministic and identical. Every median is within +20%; the
worst change is **+5.342%**. Evidence: `/tmp/t085-timing.json`.

| Case               | Main median (ms) | T085 median (ms) | Change  |
| ------------------ | ---------------- | ---------------- | ------- |
| `fd-two-stage`     | 1637.1           | 1724.6           | +5.342% |
| `common-source-ac` | 1025.9           | 1041.2           | +1.487% |
| `skew`             | 1766.0           | 1818.3           | +2.960% |
| `deadtime`         | 9924.7           | 9911.4           | -0.135% |
| `ota-sky130`       | 689.2            | 686.5            | -0.390% |
| `widlar`           | 5358.2           | 5348.2           | -0.186% |
| `ltc3452`          | 13969.1          | 13907.0          | -0.445% |

## Investigation results

### Inventory and human layouts

`/tmp/t085-inventory.mjs` scans all **439 dev / 189 val** inputs using the actual
R88 topology and R145 stage split. **48** drawings have paired two-pin members
(including sources); **32** of those have baseline crossings. Replanning all
32 with seed 1 and the evaluation budget reproduces every baseline plan hash.
`/tmp/t085-dump.mjs` records human/result pins, routes, crossing coordinates and
metrics. `/tmp/t085-analyze.py` finds 20 broad inward-part candidates; the stricter
`/tmp/t085-analyze-internal.py` excludes a crossing Net when it also touches the
opposite half. This leaves **four** drawings. The complete geometry and expanded
terminal identities are in `/tmp/t085-internal-matches.json`; all 20 broad
candidates remain recorded in `/tmp/t085-matches.json`.

| Drawing      | Split | Every matching internal-half crossing                                                                     | Human arrangement                                                                                                                                                                                                           |
| ------------ | ----- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m3ek9hty4p` | dev   | `M1.D/M2.D/R1.2` × `M1.G/C1.2/R1.1` at (290,440), (340,490); mirrored right Nets at (530,440), (480,490). | C1/R1 at x=260, outside the left transistor column x=330; right C/R at x=530, outside x=460. Human has 0 crossings.                                                                                                         |
| `3m82hv6t7a` | val   | `M1.D/M3.D/R1.1` × `M3.G/C1.2/R1.2` at (440,270); `M2.D/M4.D/R2.2` × `M4.G/C2.2/R2.1` at (680,270).       | C1 x=330 and R1 x=350 lie outside the left x=390 column; C2 x=570 and R2 x=550 lie outside x=510. Human has 1 crossing elsewhere.                                                                                           |
| `zda3hfp2e5` | val   | `M1.D/R3.2` × `M1.G/M2-copy-1.D/R2.2` at (200,270).                                                       | R3 x=390 sits above M1 x=380, approximately on its drain column, rather than distinctly outside. Human has 2 crossings.                                                                                                     |
| `zk9vmd4pkx` | dev   | `M1.D/M3.D/M2-copy-1.G` × `M3.G/M2-copy-1.S/I2.+` at (400,250), with mirrored right Nets at (600,250).    | I2 x=260 lies outward of the left transistor positions x=270/310; I1 x=480 lies outward of x=470/420. These current sources share ambiguous transistor hosts, so the final recognizer excludes them. Human has 3 crossings. |

The other 16 broad candidates involve shared/cross-half Nets. `8prnjcqxqn`
was retained as an additional conservative prototype stress case; its capacitor
is inward, but the crossing is not strictly internal to one half.

### Broader shared/cross-half cases

The full broad inventory is retained rather than assuming every inward part
should move. Human relationships below compare distance to the same recognized
pair axis; coordinates and exact crossing Net IDs are preserved in the dumps.
This includes shared rails and cross-coupled Nets, which the stricter four-case
classification deliberately separates.

| Drawing                                | Human crossings | Human arrangement of implicated parts                                      |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `2b6xxwhh59`                           | 5               | Both resistors inward.                                                     |
| `2effzpvkdq`                           | 1               | Inductors inward, resistors outward.                                       |
| `2qfxanstqy`                           | 1               | Inductors inward, resistors outward.                                       |
| `8prnjcqxqn`                           | 2               | Implicated capacitor inward.                                               |
| `9ggfasx38f`                           | 3               | Left resistor inward, right resistor outward.                              |
| `ah64ejacsg`                           | 1               | Inductors inward, resistors outward.                                       |
| `b5a651f0-5275-421e-acf5-2a63dfd8c9d8` | 1               | Inductors inward, resistors outward.                                       |
| `bfb98pk8sw`                           | 2               | Both inductors outward.                                                    |
| `dpc8h45vg7`                           | 2               | Both inductors outward.                                                    |
| `e8mjvj9x64`                           | 3               | Implicated inductors and resistors inward.                                 |
| `f3anf69kk6`                           | 3               | Both inductors outward.                                                    |
| `g9gb6dwm5s`                           | 0               | Both capacitors inward.                                                    |
| `m555cn422h`                           | 0               | One inductor outward/one inward; resistors have the opposite relationship. |
| `n2axrdxmxn`                           | 2               | Left resistor inward, right resistor outward.                              |
| `pd8crnm97d`                           | 0               | Both capacitors outward.                                                   |
| `westxcef83`                           | 1               | Inductors inward, resistors outward.                                       |

### Prototype gate

Temporary prototype: stable sorting of two-pin nodes before transistor nodes,
while retaining the cross-coupled/axis suffix. The original and prototype
`layered.ts` are saved in `/tmp/t085-layered-original.ts` and
`/tmp/t085-layered-prototype.ts`; no prototype hook remains in product code.
Scores use the unchanged frozen weights and actual finished result geometry.

| Drawing      | Baseline composite | Prototype composite | Change          | Crossings before → after |
| ------------ | ------------------ | ------------------- | --------------- | ------------------------ |
| `m3ek9hty4p` | 0.627115494512     | 0.188597246130      | −0.438518248382 | 4 → 0                    |
| `3m82hv6t7a` | 0.461828411840     | 0.123852967230      | −0.337975444610 | 2 → 0                    |
| `8prnjcqxqn` | 0.243533823475     | 0.243533823475      | 0               | 2 → 2                    |

Summed decrease **0.776493692992 ≥ 0.2**, no drawing increases. Prototype dumps
are in `/tmp/t085-prototype/`; baseline dumps are in `/tmp/t085-dumps/`.
The narrower final recognizer reproduces the first two improvements and leaves
the third baseline plan unchanged.

### Implementation and proposed spec text

Recognition requires both pins connected, at least one non-rail Net, and exactly
one same-half MOS/BJT whose D/G/S or C/B/E Nets contain every non-rail Net of the
part. The two attachment hosts must themselves be a recognized mirror pair.
This permits drain–gate feedback and rail-to-terminal loads, rejects ambiguous
hosts and cross-coupled hosts, and uses neither names nor initial coordinates.
Eligible two-pin nodes precede ordinary transistor nodes in each half row;
stable ordering retains the previous order inside each class. R31 orientations,
R89 mirroring and the cross-coupled/axis suffix remain in force.

Proposed R89 addition: “A bounded finished variant may place paired two-pin
loads/feedback outside the ordinary nodes of each half row when all non-rail
connections identify one corresponding transistor host on each side. Keep
cross-coupled and axis nodes in their existing inner suffix, retain two-pin R31
orientation, and unfold the half with the existing reflection rules.”

Proposed finished-selection addition: “After runner, localLoop, attachment and
gateRow, consider halfOrder for at most 40 instances, excluding explicit
floorplans. Admit only distinct competitive drafts through the existing
completeness/score-margin gate; finish without a second annealing search using
an independent bounded finishing budget; select with the unchanged T078
comparator and guards.”

## Deviations and open questions

- **Unresolved must-fix #1:** the exact new assertion requested by the arriving
  review passes on main for R/C/L, passes on T085 for R/C, and rejects the old
  corner-stacking geometry. T085's inductor exceeds the permitted horizontal
  extension by 22 units. The test reports `expected -3 to be greater than or
equal to 19`. No source workaround or additional tolerance was introduced
  outside that review request. A revised proximity bound or separately scoped
  placement adjustment is needed before acceptance is complete.
- No product source changed after the full corpus, visual, large-document and
  timing checks. Following the review, those checks were not needlessly rerun;
  local-service tests, typecheck, lint and formatting were rerun for the test edit.
- No dependencies, lockfile, frozen metrics, generated sources, plan or review
  were edited. No LLM provider API was called. No commit or branch operation
  was performed.
