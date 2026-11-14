# T077 report — round 3

## Summary

Removed the provisional local-loop draft replacement. The winning refined
strategy now offers its amplifier-seated placement as an additional T078
finalist under the existing completeness and score-margin rule. The original
incumbent and runner-up remain available. All candidates finish through the
same outer drafting and local-rail passes before the shared comparator chooses
the result. Recognition, receiver groups, single-passive chains, protected
placements, collision fallback and frozen weights remain unchanged.

All round 3 acceptance gates pass. Dev composite improves 0.250334%, val
improves 0.010595%, and no drawing's composite increases. Eligible-dev
crossings fall 34 → 33; all 628 drawings remain equivalent. The visual gain
is limited to a few drawings, as detailed below.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                              |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Reused the connectivity and placement investigation from rounds 1–2; recognition is unchanged. Round 3 comparisons use main `9cbdeef`.                                                                                             |
| 2    | done   | Removed early draft selection from `place.ts`; added an independent local-loop continuation in `auto-layout.ts` and `finished-selection.ts`.                                                                                       |
| 3    | done   | Explicit variant tests cover all three strategies and fixed/group protection. Public-planner tests retain the incumbent when the finished local variant loses, including a worse source-follower composite, and check determinism. |
| 4    | done   | All 628 evaluated; revised quality gates pass; review page inspected; 19 deterministic cases, six identical large plans, and seven held-out timing bounds pass.                                                                    |

## Review findings addressed

1. **Additional finished finalist — fixed.** Default strategy placement no
   longer consults or selects the local-loop draft. After the original refined
   winner is known, generate its local variant and apply `shouldFinishRunner`.
   Store a separate continuation, preserving T078's existing runner-up. Finish
   the local variant without repeating ranking, refinement or annealing. At
   the public planner boundary, compare complete results with
   `selectFinishedLayout`, after drafting and rail passes. The comparator's
   combined score, composite and visual/routing protections are unchanged.
2. **Expanded ownership — followed.** The new `auto-layout.ts` and
   `finished-selection.ts` changes only carry and select the additional
   finalist. The other edited product file is the already-owned `place.ts`.
3. **Round 3 acceptance — applied.** Main is `9cbdeef`; superseded round 1/2
   thresholds are not substituted for the latest review's gates.

## Acceptance results

### Corpus against main 9cbdeef

The evaluation completed all 628 projects. The executable assertions in
[`assert-corpus.py`](../../tmp/t077-round3/assert-corpus.py) pass every round 3
corpus gate, including the original weighted-metric and visual guards.

| Requirement                       | Main → round 3                           | Result |
| --------------------------------- | ---------------------------------------- | ------ |
| Dev composite lower               | 62.816640905 → 62.659389735 (−0.250334%) | pass   |
| Val composite not higher          | 34.467688795 → 34.464037017 (−0.010595%) | pass   |
| No drawing composite higher       | 5 improve, 623 equal, 0 worse            | pass   |
| Eligible-dev crossings not higher | 34 → 33                                  | pass   |
| Equivalent                        | 628/628                                  | pass   |
| Floating / missing                | Dev 6 / 4 → 6 / 4; val 0 / 0 → 0 / 0     | pass   |
| Guarded VISUAL totals             | All unchanged                            | pass   |
| No weighted metric rises over 2%  | Only rise: dev area +0.003694%           | pass   |

The exempt zero-weight label-clearance count rises 188 → 189 on dev and is
unchanged on val. The broad block cohort's crossings fall 72 → 71 on dev and
stay 11 on val; the eligible val cohort stays at one crossing. No val tuning
was performed. Six plan hashes change: five improve composite and one
(`z636m9949r`) ties; all other plans are byte-identical to main's evaluation.

| Improved drawing | Split | Main composite | Round 3 composite | Crossings |
| ---------------- | ----- | -------------: | ----------------: | --------- |
| `ajwgak3wbv`     | dev   |    0.519172418 |       0.417976316 | 4 → 3     |
| `vtvb2bzz89`     | dev   |    0.058050073 |       0.007218427 | 0 → 0     |
| `75k4jskamd`     | dev   |    0.069663892 |       0.064839948 | 0 → 0     |
| `hqnvsva2a4`     | val   |    0.017018280 |       0.013366502 | 0 → 0     |
| `b8q5tfkf2f`     | dev   |    0.016024388 |       0.015624908 | 0 → 0     |

All six earlier regressions (`hpfcqs6cjr`, `gn3g4kzvjv`, `9267mkznwd`,
`dh2d736kxc`, `ray97q5c2j`, `6qd8k68e2t`) now retain main `9cbdeef`'s plan
hash and composite. The revised acceptance gate is met; the overall gain
remains small, and the original broad-cohort 25% crossing-reduction target
would still fail.

[Full evaluation](../../tmp/auto-layout-eval/report.json),
[comparison data](../../tmp/t077-round3/comparison.json),
[weighted excess](../../tmp/t077-round3/excess.log),
[corpus assertions](../../tmp/t077-round3/assert-corpus.log).

### Commands, determinism and visual review

```text
pnpm build → 0; all workspace builds completed
pnpm typecheck → 0
pnpm lint → 0; 2063 files, 0 errors, 3435 warnings
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0; 796 files passed, 3 skipped; 8166 tests passed, 117 skipped
pnpm test:slow → 0; 2 files passed, 8 tests passed
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628 completed
pnpm test:local packages/auto-layout/test/local-loop-amplifier.test.ts packages/auto-layout/test/finished-selection.test.ts → 0; 33 passed
python3 tmp/t077-round3/assert-corpus.py → 0; all corpus gates pass
node tmp/t077-round3/verify.mjs → 0; 19 repeated cases
python3 tmp/t077-round3/assert-verification.py → 0; determinism, identity, timing and replay hashes pass
git diff --check → 0
```

Logs are under [`tmp/t077-round3/`](../../tmp/t077-round3): `build.log`,
`typecheck.log`, `lint.log`, `format-check.log`, `test-local-approved.log`,
`test-slow.log`, `eval.log` and `focused.log`. Build retains its existing
bundle-size advisory; lint has warnings and no errors. No test timeout was
raised and no test was removed or weakened. The local suite took 94.85 seconds; the slow suite took 40.97 seconds.

The first sandboxed `pnpm test:local` exited 1 (62 failed tests, 18 failed
files, two unhandled errors); its log is `test-local.log`. PostgreSQL and
loopback listeners were denied with `connect/listen EPERM`. The complete
suite was rerun with automatically approved local access and passed. Headless
Chrome likewise required approved access after a sandbox launch failure;
the screenshot rerun succeeded. No assertion was changed for either failure.

Held-out timing uses three alternating main/T077 pairs per drawing, seed 1,
the default deterministic evaluation budget and no deadline. No build, test,
evaluation or browser-render job ran alongside this timing run. Every median
passes the +15% gate; the largest increase is **3.97%**. All seven held-out
plans are byte-identical to main.

| Drawing          | Main median ms | T077 median ms |  Ratio |
| ---------------- | -------------: | -------------: | -----: |
| fd-two-stage     |         1685.8 |         1626.7 | 0.965× |
| common-source-ac |          999.8 |         1005.9 | 1.006× |
| skew             |         1759.7 |         1741.6 | 0.990× |
| deadtime         |        10050.6 |        10190.6 | 1.014× |
| ota-sky130       |          704.9 |          696.2 | 0.988× |
| widlar           |         4945.1 |         4988.7 | 1.009× |
| ltc3452          |        13857.8 |        14407.3 | 1.040× |

All **19 cases repeat deterministically**: seven held-out drawings, six large
ones and the six named examples. All **six large plans are byte-identical to
main `9cbdeef`**: `38m8wdesbh` (50 instances), `4fb59zv76m` (50),
`8b2n3zf9vj` (51), `b9afqhsjzv` (103), `g47e465db5` (70), and
`sm663cbs8b` (94). The six named main and current replay hashes also match
their respective 628-drawing reports. The large fixture copies are in
`tmp/t077/large-input` and lie outside the 628 small-drawing corpus.

[`verify.mjs`](../../tmp/t077-round3/verify.mjs) and
[`assert-verification.py`](../../tmp/t077-round3/assert-verification.py) both
exit 0; [raw results](../../tmp/t077-round3/verification.json) and
[assertion output](../../tmp/t077-round3/assert-verification.log) preserve the
evidence. The +15% timing gate applies to held-out drawings. Named examples
use one main run and two current runs for determinism; their observed
ratios reach 1.50×, so this is not a universal runtime-improvement claim.

The [human | main | T077 review page](../../tmp/t077-round3/review.html)
contains the six named drawings, ten greatest reductions and five greatest
increases (13 unique drawings). There are only five improvements and no
regressions, so zero-delta ties fill the remaining ranks and are labeled as
such. Main replays were hash-checked against `main-9cbdeef-report.json`.
All 13 [screenshots](../../tmp/t077-round3/screenshots) were visually inspected.
Human/T077 include the evaluator's purple inferred-block overlays; Main does
not. Those overlays are not schematic geometry.

- `ajwgak3wbv`: the upper amplifier faces and sits beside its transistor;
  crossings fall 4 → 3. The second loop still wraps around the drawing.
- `75k4jskamd`: the upper amplifier moves to its controlled transistor's
  height; the other amplifier's feedback remains extended.
- `vtvb2bzz89` and `hqnvsva2a4`: the amplifier moves onto the gate side,
  with a direct output-to-gate connection and a compact local feedback loop.
- `b8q5tfkf2f`: a small amplifier/branch placement adjustment improves area;
  the switched-capacitor chain remains horizontal.
- `gh3gcb5h3a`, `2adejzy693`, `t3r2dvffgc` and `8w2ra7hdrw` retain main's
  exact plans. Their human drawings remain more compact and easier to follow;
  offering the local variant did not yield an accepted improvement here.
- All zero-delta filler drawings retain main's exact plans. No visual
  regression was observed in the comparison page.

## Investigation results

The original investigation covers all 149 block-containing drawings (113 dev,
36 val), including logic gates, adders and flip-flops. The original single-
receiver rule matched 12 dev drawings with only four main crossings. The round 2
rule matches **31 dev drawings** and **8 val drawings**. Against main
`01fd2ad` those drawings had 36 dev crossings and one val crossing; against
round 3's `9cbdeef` baseline they have 34 and one. The broad block cohort remains 113 dev / 36 val.

The original placement and topology records remain in
[baseline investigation](../../tmp/t077/investigation-baseline.json) and
[topology investigation](../../tmp/t077/investigation.json). Round 2 evidence:
[eligibility](../../tmp/t077-round2/eligibility.json),
[six-drawing placements](../../tmp/t077-round2/placements.json).

| Drawing      | Connectivity and original cause                                                                                                                                                    | Round 2 behavior                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ajwgak3wbv` | X1 → M1.G, IN− senses M1.S/M2.D; X1-copy-1 → M3.G, IN− senses M3.S/M4.D. R31/template fallback puts the amplifiers at row ends; stages separates them from the receivers' heights. | Both singleton loops remain eligible.                                                                 |
| `8w2ra7hdrw` | X1 → M1.G, IN− senses M1.S/M1_3.D; X1_2 → M2.G, IN+ senses M2.S/M2_2.D. Original strategies seat the blocks at a common height rather than beside their distinct receivers.        | Both singleton loops remain eligible.                                                                 |
| `75k4jskamd` | X1 → M2.G, IN− senses M2.S/M1.D; X2 → M3.G, IN− senses M3.S/M4.D. Same output-row / stage-composition issue.                                                                       | Both singleton loops remain eligible.                                                                 |
| `gh3gcb5h3a` | X1 drives M1.G, M2.G and M3.G; inputs sense the M1/M2 drain branches. Previously excluded by the single-receiver predicate.                                                        | All three receivers form one group; local placement drafts exist in all three strategies.             |
| `2adejzy693` | X1 drives M1.G, M2.G and M2-copy-1.G; inputs sense M1.D and M2.D. Previously excluded for multiple receivers.                                                                      | All three receivers form one group; local drafts exist in all three strategies.                       |
| `t3r2dvffgc` | X1.OUT → R1 → M1-copy-1-copy-1.G / M2-copy-1-copy-1.G; inputs sense the two PMOS drain branches. Previously excluded because the output did not directly reach a gate.             | Recognizes the one-resistor chain; moves X1 and R1 together in local drafts for all three strategies. |

All three original strategies are still available. R31 derives a block's row
from its output Net, template fallback packs unrecognized blocks after the
conducting devices, and R53 composes the amplifier's stage independently.
R70's sole-non-rail-link predicate excludes these feedback loops. The shared
local-loop pass supplies the new association without changing those rules.

The round 2 regressions came from discarding the original placement after a
provisional comparison. Finishing could reverse that comparison. Round 3
retains the original complete result through the final decision; the public
source-follower regression test demonstrates rejection of a worse finished
local-loop composite. Corpus replay results are recorded above.

### Proposed spec text for Opus

Keep R70's existing sole-non-rail-link driver rule unchanged. Add:

> **Local-loop amplifier attachment.** In a small document (at most 40
> instances), a multi-pin signal block with one output and at least one input
> may form a local-loop placement draft when its non-rail output Net reaches
> one or more gate/base/control receivers, directly or through at most one
> two-pin passive. Direct receivers take precedence over passive output loads;
> an indirect path must identify one unambiguous passive/control Net. At least
> one input must sense a non-rail conducting terminal of a receiver or a device
> in its rail-cut DC branch. Use the established conducting-pair model; do not
> traverse control terminals, capacitor feedback paths or rails. Recognition
> depends only on connectivity, pin roles and device class, never labels,
> circuit names, IDs or source coordinates.
>
> Seat the block on the receiver group's control-pin side, output facing the
> group's gate line. Use the nearest receiver gate as the transverse anchor
> and clear the whole receiver bank's bounds. Place an optional series passive
> between output and gate, moving it and the amplifier as one unit. Retain the
> existing 60-unit attachment clearance and document grid. Choose the input
> reflection that minimizes distance to the sensed conducting terminals.
> Stable device order breaks geometric ties.
>
> Do not move fixed, recognized-template, symmetry-block or persisted
> layout-group members. If either moving member is protected or the proposed
> unit collides, retain the old placements for the whole unit. Receiver
> placements remain unchanged. Template, layered and stages offer the new
> draft through their shared placement pass. Large-document behavior stays
> unchanged.

The winning refined strategy's local-loop variant is an additional finalist,
not a replacement draft. Apply T078's distinct-placement, completeness and
provisional score-margin gate. Finish it through the same repairs, compaction,
facing, labels, drafting and local-rail passes, then compare it with the retained
incumbent (including T078's finished runner-up) using the shared finished
comparator. Reject a worse composite, worse guarded visual/routing result,
new nonzero weighted violation or non-improving combined score. Quick mode
and documents above 40 instances retain their existing behavior.

## Deviations and open questions

- No LLM option or provider call was used. Evaluation reads local projects.
- No dependencies, lockfile, generated source, plan or review were edited.
  No commit, push, merge, rebase or branch switch was performed.
- Evaluation, isolated baseline compilation and review artifacts are under
  ignored `tmp/t077-round3/`. Main's source was read from `9cbdeef` into that
  temporary directory and compiled against the same workspace dependencies.
