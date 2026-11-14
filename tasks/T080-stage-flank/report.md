# T080 report — round 2

## Summary

**Partial: implementation and regression checks pass, but the required corpus
improvements are not achieved.** Added a topology-triggered flank finalist after
`attachment`, with the review-approved symmetric widening during initial
construction. Downstream halves retain their internal offsets and orientations;
axis members follow the shared axis. The driver is unchanged during construction.
Subsequent collision repair and given-state finishing retain existing R89/R94
rigidity. Protected geometry and explicit partitions are excluded.

The new synthetic differential amplifier test reduces routed crossings from
**5 to 3**. However, the finished selector rejects the corpus candidates: all
**628/628** final plans remain byte-identical to main. Composite and crossings
therefore remain equal, rather than lower, on both dev and val. No acceptance
threshold, comparator safeguard, readability metric, or weight was relaxed.

All seven acceptance commands completed successfully. Six large documents are
byte-identical and deterministic. All seven held-out median timings pass the
+20% bound; the maximum measured slowdown is **3.9%**.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                           |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Retained and checked round 1's investigation: two named dev flank cases, two val flank cases, three other dev interstage problems and one single-block attachment problem.                                                                                                                                                      |
| 2    | done    | Added `stage-flank.ts`, wired construction into `place.ts` and registered an independent last finalist in `auto-layout.ts` / `finished-selection.ts`. Uses ≤24 instances, the existing margin and participation gates, and half relocation / port-seat / rail-seat budgets. Existing finalists retain their behavior and order. |
| 3    | done    | Added 11 synthetic tests covering fewer crossings, connectivity, rigid halves, mirrored orientation, axis members, protected geometry, explicit floorplans, non-symmetric chains, topology-only recognition, rejection and determinism. Extended finalist-order coverage.                                                       |
| 4    | partial | Evaluated all 628; generated and inspected Human / main / T080 review page, all six large replays and isolated held-out timing. Improvement gates fail. There are no improved drawings from which to select a top ten.                                                                                                          |

## Review findings addressed

1. **Must-fix #1 — scope:** implemented the permitted widening and extra finalist.
   Recognition uses R145/R89 stage topology, mirrored Net correspondence and
   conducting-output-to-gate/base connectivity. Placement uses the generated
   geometry to align axes and put downstream halves outside the driver's visible
   bounds. Each half moves by one common vector, with equal and opposite widening;
   axis members receive only the common translation. Templates, layout groups,
   constraints or fixed members that would be split abort construction atomically.
   Explicit partitions are conservatively excluded. The implementation is present,
   but its finished corpus effectiveness remains unmet.
2. **Must-fix #2 — tests:** added `stage-flank.test.ts` and extended the existing
   finalist-order test. The amplifier routing test checks electrical terminal
   partitions, zero missing connections, safe routing and reduced crossings.
   The rejection test exercises real finished selection, verifies the worse
   candidate is rejected and compares repeated full plans. No Gallery document
   was added to tests or tracked files.
3. **Must-fix #3 — evidence:** corrected the supplied harness's worktree, baseline,
   large-input and output paths. Used `/tmp/t080-baseline/dist` and linked its
   runtime dependency resolution to this worktree's existing auto-layout
   `node_modules`; no dependencies were installed or changed. Ran six large
   documents against main and twice against current. Ran the timing harness alone,
   after evaluation, builds, tests and browser rendering had stopped. It warms both
   implementations, alternates execution order, and takes three samples per side.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing large-chunk warning.
pnpm typecheck → 0.
pnpm lint → 0; 2,067 files, 0 errors, 3,463 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0 with local-service access;
  798 passed / 3 skipped files; 8,200 passed / 117 skipped tests.
pnpm test:slow → 0; 2 files, 8 tests passed.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed; report.json and index.html written.
pnpm exec vitest run packages/auto-layout/test/{stage-flank,finished-selection}.test.ts
  → 0; 2 files, 22 tests passed.
node tmp/t080-harness/verify-large.mjs → 0; 6/6 identical and deterministic.
node tmp/t080-harness/timing.mjs → 0; 7/7 medians within +20%.
```

The sandboxed local-suite attempt failed the initial server test. A direct
PostgreSQL probe returned `Operation not permitted` on the local socket. Stopped
that attempt (exit 130) and reran the complete suite with local-service access;
it passed. Headless Chrome likewise required a sandbox retry to render the local
review page; rendering then passed. Initial harness imports failed until the
existing dependency-resolution link was supplied.

[Command logs and artifacts](../../tmp/t080-round2/).

| Measure             |           Dev main |        Dev round 2 |          Val main |       Val round 2 |
| ------------------- | -----------------: | -----------------: | ----------------: | ----------------: |
| Composite sum       | 61.058969145544395 | 61.058969145544395 | 33.57548076639148 | 33.57548076639148 |
| Crossings           |                234 |                234 |               143 |               143 |
| Floating pins       |                  6 |                  6 |                 0 |                 0 |
| Missing connections |                  4 |                  4 |                 0 |                 0 |

- **Fail:** composite strictly lower on dev and val; crossings strictly lower on
  dev and val. Every value is equal to main.
- **Pass:** no drawing's composite higher; 628/628 electrically equivalent;
  floating and missing not increased; all `VISUAL_*` totals identical, including
  label clearance; all 628 plan hashes equal main. Zero improved, zero regressed.
- **Pass:** six large documents (50, 50, 51, 103, 70 and 94 instances) match main
  byte-for-byte and match their independent current repeat. Synthetic and all
  seven held-out plans also repeat deterministically. Four additional flank-case
  replays each match the evaluation and their independent repeat.

[Evaluation](../../tmp/auto-layout-eval/report.json),
[baseline comparison](../../tmp/t080-round2/comparison.json),
[large hashes](../../tmp/t080-round2/large.json),
[flank-case replays](../../tmp/t080-round2/replay.json),
[held-out samples, hashes and phase timings](../../tmp/t080-round2/timing.json).

Held-out timings, in milliseconds:

| Case             | Main median | Round 2 median |  Ratio |
| ---------------- | ----------: | -------------: | -----: |
| fd-two-stage     |      1636.9 |         1700.4 | 1.039× |
| common-source-ac |      1049.0 |         1024.5 | 0.977× |
| skew             |      1786.4 |         1765.1 | 0.988× |
| deadtime         |      9938.1 |         9844.1 | 0.991× |
| ota-sky130       |       679.1 |          676.2 | 0.996× |
| widlar           |      5306.9 |         5321.5 | 1.003× |
| ltc3452          |     13894.2 |        13892.0 | 1.000× |

Every held-out plan is also byte-identical to main. These measurements were
isolated; concurrent corpus/test durations were not used as timing evidence.

## Investigation results

### Cases and composition

| Drawing      | Split | R145 components | Human → main → round 2 crossings | Finding                                                            |
| ------------ | ----- | --------------: | -------------------------------- | ------------------------------------------------------------------ |
| `vcgtzej894` | dev   |               2 | 1 → 5 → 5                        | Mirrored downstream stage chained right of its driver.             |
| `6qg2h7weje` | dev   |               2 | 1 → 5 → 5                        | Same flank opportunity.                                            |
| `m3ek9hty4p` | dev   |               1 | 0 → 4 → 4                        | RC attachments lie inward inside one symmetry block.               |
| `en97w8v92y` | dev   |               0 | 0 → 6 → 6                        | Three amplifier/feedback paths flattened into a horizontal row.    |
| `2bqpr5kx5c` | dev   |               1 | 2 → 5 → 5                        | Asymmetric driver stacks beside one cross-coupled symmetric stage. |
| `jz7rweg6gg` | dev   |               0 | 0 → 3 → 3                        | Bootstrap/feedback topology split into two conducting stages.      |
| `sbfkkj67cm` | val   |               2 | 1 → 5 → 5                        | Mirrored downstream stage, same topology as `6qg2h7weje`.          |
| `x5jaqe94t7` | val   |               2 | 1 → 3 → 3                        | Same topology with fewer output-port crossings.                    |

Among the six named dev cases: **two flank cases, three other interstage-order
cases, one single-block attachment case**. Of the 36 validation drawings with
excess crossings, exactly two have multiple R145 components; both are flank
cases. There are no other interstage-order cases in that qualifying val subset.

For all four flank cases, template/layered put the downstream axis 190 units
right of the driver; stages puts it 280 units right. Each block has 100/140-unit
pair spans. Stages wins on main. In `6qg2h7weje`, driver nets are
`M1.D/M3.D/M5.G` and `M2.D/M4.D/M6.G`; the latter crosses the former and the
output nets. The corresponding nets in `vcgtzej894` are
`X2.D/X3.D/M4.G` and `X1.D/M6.D/M3.G`. The accepted review decision resolves the
original equal-span rigidity conflict by allowing initial widening only.

The other four named dev cases remain outside this two-component construction.
All three strategies retain inward RC attachments for `m3ek9hty4p`. For
`2bqpr5kx5c`, template separates the driver stacks, layered puts both left and
stages places the symmetric block between them; layered wins. Template wins the
flattened `en97w8v92y` feedback layout. Stages wins `jz7rweg6gg`, whose crossings
involve bootstrap supply/input and feedback nets. Full strategy placements and
crossed-net geometry remain in the
[round 1 investigation](../../tmp/t080-round1/investigation.json) and
[route dumps](../../tmp/t080-round1/dumps/).

### Why the new finalist does not win

On the dev probe `6qg2h7weje`, the final construction passes the provisional
margin (35,132.89 incumbent versus 42,712.54 flank) and participation gate. After
finishing, crossings fall **5 → 4**, but port-order violations rise **0 → 4** and
area rises. The composite worsens **0.568958 → 0.906415**, so the unchanged
finished selector rejects it. The ports follow the existing seating pipeline;
a left output beside the flanking stage conflicts with globally ordered input
and output ports.

Dev-only probes of nearby vertical placements and coordinated edge-port seats
also failed to produce an admissible finished winner. A more distant placement
reached zero crossings but introduced port-order and blocked-join violations.
Those experiments are not product changes; the implementation candidate keeps
near-node construction and all selection safeguards. This is evidence of an
unsuccessful construction policy, not proof that every flank design is impossible.
No tuning was performed on val.

[Final-policy rejected dev candidate](../../tmp/t080-round2/rejected-dev-finalist.json).

### Review page

Generated and visually inspected all eight sheets of the
[Human | main | T080 page](../../tmp/t080-round2/review.html): **32 unique drawings**,
including all six named dev cases, the two qualifying val cases and the original
25 samples (one overlap). There is no top-ten improvement subset because no
composite decreased. Independent main SVGs were archived before the new run;
current panels come from the new evaluation. The page has no horizontal overflow
at 1,800 pixels and confirms that all selected layouts remain unchanged.
[Membership](../../tmp/t080-round2/review-cases.json),
[render checks](../../tmp/t080-round2/render.json).

## Deviations and open questions

- **Unmet goal:** the construction creates a valid flank candidate but does not
  improve the selected corpus layouts. Further construction/port coordination
  needs design review; widening alone with existing marker seating is insufficient
  in the measured cases. Do not accept this round as meeting the improvement gates.
- Optional parallel-stage reordering was not implemented. Ambiguous multi-driver
  stages, connected chains/cycles and shared-driver compositions are conservatively
  excluded; explicit partitions are excluded even without an arrangement.
- Proposed **R158** spec text for Opus: “For documents with at most 24 instances,
  mirrored output nets of one R145 symmetric component reaching another component's
  paired inputs may admit an extra flank finalist after attachment. During initial
  construction only, downstream halves may translate outward by equal and opposite
  amounts about the driver's axis, preserving each half's internal offsets and
  orientations and leaving the driver unchanged. Axis members stay on the shared
  axis. If fixed members, templates, protected geometry or an explicit floorplan
  prevent this construction, omit the variant. The resulting whole component is
  rigid for collision repair, search and given-state finishing. Apply the existing
  participation/margin gate, half relocation/port-seat/rail-seat budgets and the
  unchanged finished-layout comparator.”
- No plan, review, dependency, lockfile, generated source, readability metric or
  weight was edited. No LLM provider API was called. No commit, push, merge,
  rebase or branch switch was performed.
