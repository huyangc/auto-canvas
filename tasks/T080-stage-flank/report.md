# T080 report — round 1

## Summary

**Blocked at step 2 by conflicting placement requirements.** Investigation
confirmed the flanking opportunity, but the relevant downstream R89 blocks
cannot flank their drivers while retaining their existing rigid offsets.
The plan requires both. Per AGENTS.md, stopped that step rather than replacing
whole-block rigidity with a different construction contract. Requested
clarification about widening during initial construction; no answer was
received during this round.

No product code or tests changed. All seven prescribed acceptance commands
were run successfully, with the local suite retried with local-service access
after a sandbox PostgreSQL refusal. The unchanged implementation reproduces
all 628 main plan hashes. The required composite and crossing improvements
are **not achieved**.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                  |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Investigated all six named dev cases and scanned all 36 validation cases with excess crossings. Exactly two validation cases have multiple R145 symmetry components; both are flanking cases. Recorded all three strategies and actual crossed nets.                                   |
| 2    | blocked | Equal-span downstream and driver blocks cannot be composed as outside flanks by rigid translation. Construction-time widening needs an explicit exception to the plan's whole-block rigidity requirement. No alternative design was implemented.                                       |
| 3    | blocked | New-variant tests depend on resolving step 2. Existing tests were run without changes.                                                                                                                                                                                                 |
| 4    | partial | Evaluated all 628 and inspected an unchanged-baseline review page covering the six named cases, two qualifying validation cases, and 25 samples. No improvements exist from which to select ten winners. Separate large-document replay and held-out timing medians remain unverified. |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

```text
pnpm build → 0; all packages/apps built; existing large-chunk warning.
pnpm typecheck → 0.
pnpm lint → 0; 2,065 files, 0 errors, 3,455 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0 on local-service retry;
  797 passed / 3 skipped files; 8,189 passed / 117 skipped tests.
pnpm test:slow → 0; 2 files, 8 tests passed.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed; report.json and index.html written.
```

The first sandboxed `pnpm test:local` attempt failed its initial server test;
a direct local PostgreSQL connection probe returned `EPERM`. Stopped that
attempt (exit 130) and reran the complete command with local-service access.
The connection probe and full suite then passed. No dependency installation
was needed. [Command logs and investigation artifacts](../../tmp/t080-round1/).

Against `tmp/main-8cdec30-report.json`:

| Measure             |           Dev main |        Dev round 1 |          Val main |       Val round 1 |
| ------------------- | -----------------: | -----------------: | ----------------: | ----------------: |
| Composite sum       | 61.058969145544395 | 61.058969145544395 | 33.57548076639148 | 33.57548076639148 |
| Crossings           |                234 |                234 |               143 |               143 |
| Floating pins       |                  6 |                  6 |                 0 |                 0 |
| Missing connections |                  4 |                  4 |                 0 |                 0 |

All **628/628** results are electrically equivalent. Every `VISUAL_*` total
is identical, including label clearance. There are zero improved and zero
regressed drawings. All **628/628** plan hashes match main; all **29/29**
additional investigation replays also match main. This verifies baseline
reproduction, not the requested new behavior. Strict composite/crossing
improvement gates fail because the values are equal.

[Evaluation](../../tmp/auto-layout-eval/report.json),
[comparison](../../tmp/t080-round1/comparison.json),
[independent replays](../../tmp/t080-round1/replay.json).

## Investigation results

### Case counts and scope

Among the six named dev drawings, **two** are downstream mirrored stages
not flanking their driver, **three** are other interstage order/composition
problems, and **one** is an attachment-order problem inside a single rigid
symmetry block. The latter three interstage cases are not recognized as two
symmetric stages and are not all reducible to sorting parallel stages by
driver-pin position.

Of 36 validation drawings with excess crossings, exactly **two** have two
or more R145 stage components: `sbfkkj67cm` and `x5jaqe94t7`. Both are
downstream mirrored-stage flanking cases; there are **zero other
stage-order cases in that qualifying validation subset**. A broader R50
stage scan found 23 validation drawings with multiple conducting stages;
their topology and placements are also archived, without equating an R50
stage to an R145 symmetry component.

| Drawing      | Split | R145 components | Human → main crossings | Finding                                                                     |
| ------------ | ----- | --------------: | ---------------------: | --------------------------------------------------------------------------- |
| `vcgtzej894` | dev   |               2 |                  1 → 5 | Mirrored output stage chained to the right of the driver.                   |
| `6qg2h7weje` | dev   |               2 |                  1 → 5 | Mirrored output stage chained to the right of the driver.                   |
| `m3ek9hty4p` | dev   |               1 |                  0 → 4 | Capacitor/resistor attachments sit inward inside one symmetry block.        |
| `en97w8v92y` | dev   |               0 |                  0 → 6 | Three amplifier/feedback paths flattened into a horizontal row.             |
| `2bqpr5kx5c` | dev   |               1 |                  2 → 5 | Two asymmetric driver stacks placed beside a cross-coupled symmetric stage. |
| `jz7rweg6gg` | dev   |               0 |                  0 → 3 | Bootstrap/feedback topology split into two conducting stages.               |
| `sbfkkj67cm` | val   |               2 |                  1 → 5 | Same mirrored two-stage topology as `6qg2h7weje`.                           |
| `x5jaqe94t7` | val   |               2 |                  1 → 3 | Same mirrored two-stage topology, with fewer output-port crossings.         |

### Strategy composition and crossed nets

- In all four flanking cases, template and layered strategies put the
  downstream block 190 units to the right of the driver's axis; stages puts
  it 280 units to the right. The finished winner is stages. Each block has
  pair-origin spans of 100 and 140 units. The output/input connections are
  discovered from conducting pins reaching the downstream gates and the
  existing symmetry pairing, independently of references or input geometry.
  References below identify evidence only.
- For `6qg2h7weje` and `sbfkkj67cm`, the mirrored driver nets are
  `M1.D/M3.D/M5.G` and `M2.D/M4.D/M6.G`. The latter crosses the former,
  the right output net once, and the left output net twice; the two output
  nets also cross each other. `x5jaqe94t7` retains the driver-net crossing
  plus one crossing with each output net. `vcgtzej894` has the same pattern,
  using driver nets `X2.D/X3.D/M4.G` and `X1.D/M6.D/M3.G`.
- For `m3ek9hty4p`, all three strategies produce the same core: capacitor
  and resistor pairs lie closer to the axis than the transistor pairs. The
  left drain net `M1.D/M2.D/R.2` crosses `C.2/M1.G/R.1` twice; the right
  counterpart also crosses twice. R145 does not split this conducting
  structure into two stages, so the proposed two-component trigger cannot
  address it directly while keeping the existing block rigid.
- For `2bqpr5kx5c`, template puts one driver stack left and one right;
  layered puts both left; stages puts the symmetric stage between the two
  stacks and mirrors the right stack. Layered wins. The net
  `M10.D/M2.G/M6.G/M9.S` crosses both lower conducting branches and the
  other driver-output net (the latter twice). The remaining crossing is
  the symmetric stage's cross-coupling. This is not a second mirrored R145
  component.
- For `en97w8v92y`, template/layered place all three amplifiers in a compact
  horizontal row with displaced capacitors/resistors; stages separates
  their local blocks farther along the same row. Template wins. Four of
  its six crossings involve `C3.1/R1.1/X1-copy-2.OUT`; the other two involve
  the shared input and feedback/output nets. The human arrangement is
  vertical and preserves local feedback paths.
- For `jz7rweg6gg`, template/layered interleave members of the two R50
  stages; stages places two blocks side by side and mirrors the right
  block. Stages wins. Crossings are the `M7.G/M8.S` supply net with the
  `M1.G` input; `M3.G/M4.D/M5.G/M7.D` with `C1.2/M2.D/M3.D/M5.S`; and
  `C1.1/M1.S/M4.S` with `M4.G/M5.D/M6.D`. This is a bootstrap/feedback
  composition problem, not a mirrored-stage flank.

[Topology, nets, and all strategy placements](../../tmp/t080-round1/investigation.json),
[finished-route crossing geometry](../../tmp/t080-round1/dumps/).

### Concrete rigidity conflict

For `6qg2h7weje` under stages, driver origins are:

```text
M1 (280,480), M2 (420,480), M3 (300,380), M4 (400,380); axis 350.
M5 (560,380), M6 (700,380), M7 (580,480), M8 (680,480); axis 630.
```

Rigidly translating the downstream block to axis 350 places M5/M6 at
x=280/420 and M7/M8 at x=300/400. At y=480, downstream M7/M8 lie **inside**
driver M1/M2; at y=380, the two sets of transistor symbols are only 20 units
apart horizontally. No common translation can increase both downstream
halves' distances from their shared axis. Widening requires moving the two
halves in opposite directions and changing the 100/140-unit pair spans.

R89 explicitly says to preserve relative offsets as one rigid block;
R94 permits whole-block collision translation and rejects relative-position
or orientation changes during given-state finishing. R145 assigns each stage
its own such block. The plan repeats whole-block rigidity. This is a
construction-contract issue, not an unavailable tool or a failing test.

### Review page

Generated and visually inspected all eight sheets of the
[Human | main | unchanged round 1 page](../../tmp/t080-round1/review.html):
**32 unique drawings**, consisting of the six named dev cases, two qualifying
validation cases, and the original 25 samples (one overlap). No horizontal
overflow at 1,800 pixels. Main and round 1 reuse the same SVG only after
verifying their independently reproduced plan hashes match. Existing
diagnostic block overlays are retained on all panels.

The page confirms the four side-by-side downstream blocks, inward RC
attachments in `m3ek9hty4p`, and displaced feedback layout in `en97w8v92y`.
There is no top-ten improvement subset because every composite is unchanged.
[Membership](../../tmp/t080-round1/review-cases.json),
[render checks](../../tmp/t080-round1/render.json).

## Deviations and open questions

- **Required decision:** may initial construction widen the downstream
  block while retaining each half's internal offsets and mirrored pairing,
  then freeze the resulting whole block for search and finishing? Or must
  the existing whole-block offsets remain invariant? The former is a
  possible clarification, not an implemented or validated design.
- Proposed spec clarification for Opus, conditional on that decision:
  “During the flank finalist's initial construction only, paired downstream
  halves may translate outward symmetrically about the driver's axis while
  each half remains rigid. The resulting component becomes rigid before
  collision repair, search, and given-state finishing.” The plan must also
  settle how axis members and protected templates spanning both halves are
  handled. Existing text was not edited.
- The six large documents named in prior reports are absent from
  `tmp/le10-input` and its baseline report. No separate large-document replay
  was performed. Held-out runtime medians were not remeasured; concurrent
  corpus/test timings are not used as runtime acceptance evidence.
- No plan, review, dependency, lockfile, generated source, readability metric,
  or weight was edited. No LLM provider API was called. No commit, push,
  merge, rebase, or branch switch was performed.
