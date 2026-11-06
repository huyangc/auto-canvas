# T012 report — round 2

## Summary

Partial on `task/T012-auto-layout-routing`. Implemented the round 2 spec
changes: cleanup pin-group restoration, power name-claim transfer after
routing, preserved/default label offsets, and downward placement translation
around drafting bounds. All nine complete plans now commit as one transaction,
preserve electrical topology, route without warnings, and pass the committed
geometry, label, determinism, repeat-placement and one-Undo checks.

One acceptance failure remains: the **cleanup-only** `five-t-ota` transaction
loses M1.B/M2.B before the power name claims are transferred at step (g).
The specified `connect_endpoints` restoration fixes the four reviewed split-net
cases, but cannot supply the missing power naming authority. The full
`five-t-ota` transaction transfers that authority and passes equivalence.
The cleanup assertion remains enabled and failing; no test was skipped or
weakened to hide the conflict between the required cleanup boundary and the
later transfer boundary.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Updated R2(c2/g/h), R10 drafting clearance, R12 claim transfer and R15 offsets in the spec. Retained the permitted routing ADR change from round 1.                                                                                                                                                                                                                  |
| 2    | partial | Added cleanup/restoration and name-transfer previews; retained whole-list acceptance and terminal-partition validation. All complete corpus plans pass. Cleanup alone still cannot preserve `five-t-ota` default bulk membership under the specified ordering.                                                                                                       |
| 3    | partial | `route.ts` transfers claims to a replacement trunk or longest Route. `transaction.ts` restores frozen pin components with geometry-free connections. `labels.ts` preserves route-anchor presentation or defaults to -10/forward/horizontal. `place.ts` translates below drafting ink/geometry, leaving 60 units around devices. The cleanup-only bulk issue remains. |
| 4    | partial | Package tests: 44 passed, 1 failed. All nine complete-result corpus tests and eight cleanup tests pass. Added nondefault label-anchor and minimum downward drafting-shape regressions; the R14 obstruction fixture now also exercises removal/restoration of a Junction-connected Net before fallback.                                                               |
| 5    | done    | Review script succeeds for all nine cases, includes warnings, audits committed drafting clearance through the shared routing audit, and writes nine SVGs, index.html and metrics.json.                                                                                                                                                                               |
| 6    | done    | Recorded committed geometry metrics/timings and visual differences below; investigated the raised RLC source lead.                                                                                                                                                                                                                                                   |

## Review findings addressed

| Finding                       | Status  | Fix and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — VDD name-claim loss       | fixed   | After routing, replay the whole list, locate each removed power-marker claim's frozen group's current Net, and re-upsert the same evidence on a replacement horizontal trunk or longest Route. Another replay precedes label anchoring. `five-t-ota` commits, compares `equal`, has no unrouted warning, and keeps M1.B/M2.B on the source/VDD Net. Corpus assertions check bulk membership and retained claim ids/fields with valid new Route owners.     |
| 2 — cleanup splits pin groups | partial | Step (c2) adds one `connect_endpoints` per extra cleanup Base Net component, targeting pins from the frozen input groups. Cleanup-prefix tests include these edits and pass for `fig-17-19b`, `two-inverters`, `common-source` and `two-stage-symbolic`. All connections are accepted. The additional `five-t-ota` cleanup-only bulk loss remains; see investigation.                                                                                      |
| 3 — labels sit on wires       | fixed   | Preserve original route-anchor offset/direction/orientation; object-anchored labels receive -10/forward/horizontal. Every re-anchored corpus label has a nonzero offset. The RLC `in` and fig-17-19b VDD labels render above the wire. A real-transaction regression preserves offset 14, direction reverse and orientation follow.                                                                                                                        |
| 4 — drafting collision        | fixed   | Use `resolveDraftingTextInkBounds` for text and `resolveDraftingObjectGeometry` for other drafting objects. Move the entire layout down in grid steps until device bounds grown by 60 units clear drafting. Fixed-instance conflicts or anchors that cannot clear by whole-layout translation return R10. The corpus/review audit checks every Route segment and every instance against drafting bounds. `common-source` no longer draws through its text. |

Review note 5 is recorded in the visual table without changing annotation
placement. Review note 6 is investigated below; no router or placement rule
was changed for it.

## Acceptance results

All commands ran from the repository root. The full suite used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline → 0
  Scope: all 23 workspace projects; Already up to date; pnpm v11.16.0.
pnpm format:check → 0
  All matched files use Prettier code style!
pnpm docs:check → 0
  Validated local Markdown links in 74 files.
pnpm typecheck → 0
  tsc -p tsconfig.check.json --noEmit
pnpm lint → 0
  oxlint: 1921 files, 0 errors, 2467 warnings
pnpm vitest run packages/auto-layout → 1
  Test Files 1 failed | 4 passed (5)
  Tests 1 failed | 44 passed (45)
  Duration 1.93s
pnpm test:local → 1 (final rerun with local access)
  Test Files 1 failed | 740 passed | 2 skipped (743)
  Tests 1 failed | 7325 passed | 116 skipped (7442)
  Duration 41.82s
pnpm deadcode 2>&1 | grep -E 'auto-layout' → 1; no output
  grep's no-match status; no auto-layout findings, as expected by the plan.
pnpm build → 0
  All workspace builds finish; existing Vite/chunk-size warnings remain.
pnpm auto-layout:review && ls tmp/auto-layout-review → 0
  All nine cases: Committed; no diagnostics or committed-result violations.
  Nine SVGs, index.html and metrics.json exist.
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures → 0; empty
```

The one failed test in both final test runs is:
`five-t-ota: R2 re-anchoring and Route removal preserve terminal membership`.
Its terminal-partition assertion at `corpus.test.ts:529` detects the missing
M1.B/M2.B. The original electrical-graph equality assertion remains after it.
The nine complete-result tests all pass, including `five-t-ota`.

The first sandboxed full-suite run had 59 failures (including this defect),
with local socket/PostgreSQL `EPERM` errors; it is not the final acceptance
result. Rerunning with approved local access removes those environment
failures. Logs are `/tmp/t012-r2-*.log`; the final full-suite log is
`/tmp/t012-r2-test-local-access.log`. `git diff --check` also passes.

## Investigation results

### Cleanup-only bulk conflict

R2 removes the original VDD Route and Junction owners before step (c2).
For `five-t-ota`, that removes these power-marker claims:

- `connectivity-evidence-25e634a2eea84516`, previously owned by
  `route-vdd1-rail-a-1`;
- `connectivity-evidence-362a0827f36de02c`, previously owned by
  `junction-vdd1-end`.

At this cleanup-only transaction boundary, MOS bulk reconciliation has no
remaining VDD naming authority. Its terminal partition contains
`[M1.S, M2.S]` where the input has `[M1.B, M1.S, M2.B, M2.S]`.
R11 excludes B pins from the frozen routing groups, so the specified (c2)
connections cannot restore the policy target. A temporary probe also tried
restoring the bulk endpoints themselves: the transaction accepted the edits,
but reconciliation still removed M1.B/M2.B. The probe was deleted; its
partition evidence is `/tmp/t012-r2-probe.json`.

At step (g), a replacement trunk finally exists and can own the original
claims exactly as R12 specifies. Replaying the complete list restores the
original VDD authority and both bulk pins; the corpus graph compares `equal`.
Thus the remaining failure is specifically the requirement to commit the
prefix through (c2) alone, before the prescribed transfer. Solving that
boundary needs a reviewed rule for preserving naming authority during
cleanup, or a reviewed change to the tested boundary. Neither was improvised,
and the failing assertion was retained under AGENTS.md.

### Diagnostics and electrical checks

The exact `AUTO_LAYOUT_NET_UNROUTED` lists for `fig-17-19b` and
`common-source` are both `[]`: every requested bounded routing call succeeds.
All other seven cases likewise have `[]`; all nine complete plans have no
error diagnostics.

Seven ready project electrical graphs compare `equal`: `five-t-ota`,
`fig-17-19b`, `two-inverters`, `common-source`, `rc-lowpass`, `rc-highpass`
and `rlc`. `differential-stage` and `two-stage-symbolic` remain uncheckable
through that graph API and pass the terminal/Base-Net projection assertions.
All nine complete results additionally pass partition comparison independent
of Net-id spelling. These are topology/display checks, not analog simulation
or circuit-performance claims.

### Geometry metrics and planning time

From the successful review command's `tmp/auto-layout-review/metrics.json`.
Time includes planning, dry-run transactions and final replay; one run is not
a performance threshold. Wire length uses Document units. Crossings count
unique proper intersections between different-Net Routes, excluding
same-Net branches and collinear contacts. Bends count direction changes
within each Route centerline; a turn split across separate Routes/Junctions
is not counted as an internal bend (notably the raised RLC trunk).

| Case               | Routes | Crossings | Bends | Wire length | Planning ms |
| ------------------ | -----: | --------: | ----: | ----------: | ----------: |
| five-t-ota         |     16 |         0 |     2 |        1070 |      69.665 |
| fig-17-19b         |     18 |         2 |     5 |        1280 |      32.755 |
| two-inverters      |     17 |         1 |     2 |        1500 |      34.238 |
| differential-stage |      4 |         0 |     0 |         360 |       5.903 |
| common-source      |     10 |         0 |     1 |        1080 |      21.627 |
| rc-lowpass         |      6 |         0 |     0 |         440 |       8.376 |
| rc-highpass        |      6 |         0 |     0 |         440 |       8.719 |
| rlc                |      7 |         0 |     0 |         560 |      11.495 |
| two-stage-symbolic |      9 |         1 |     3 |        1010 |      20.654 |

### Raised RLC source lead (review note 6)

There is **no obstacle being avoided**. R4 classifies the grounded-negative
voltage source's positive Net (`in`, `net-3cc118a1672a4767`) as `supply`:
it does not reach a MOS gate. R12 therefore gives it a horizontal trunk
40 units above its two device pins. In the committed result, V1.+ and R1's
left pin are at y=180, and the trunk is at y=140; V1.+ first rises from
(170,180) to (170,140), then the wire crosses and drops to R1. The generated
geometry is recorded in `/tmp/t012-r2-rlc-geometry.json`. This follows the
specified classification/power-routing rules, rather than a placement-rule
bug, so it was investigated and left unchanged.

### Visual comparison

Inspected rasterized originals and results, including full-size results for
`five-t-ota`, `fig-17-19b`, `common-source` and `rlc`; temporary comparison
sheets and PNGs are under `/tmp/t012-r2-*-pair.svg*`. Review SVGs and the HTML
page remain in `tmp/auto-layout-review/`.

| Case               | Difference from the hand-drawn original                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| five-t-ota         | Taller and wider regular rows; VDD is a thin ordinary trunk with its label centered above it instead of a thick rail with the label at the right. Mirror gates and M2's diode connection are drawn; drains connect to the pair, sources to the centered tail. Vin1/Vin2 enter from opposite sides level with their gates, and P2 is right of every device. |
| fig-17-19b         | Taller symmetric rows; Vin enters from the left while outputs/feedback move to the right, producing two crossings. Thin VDD trunk and taps replace the original thick rail; VDD is above the wire.                                                                                                                                                         |
| two-inverters      | Greater stage/row spacing; supply and ground Cell Pins sit at the left ends of their trunks. The internal nbit port moves right, with one crossing and its label touching XSN's instance label (review note 5, unchanged). Dashed bulk wires disappear.                                                                                                    |
| differential-stage | Diagonal hand-drawn wires become orthogonal. The one ground marker connects only to its assigned host; other ground membership remains electrical without a wire joining the devices, per R12.                                                                                                                                                             |
| common-source      | Sources occupy separate left columns, RD is above XM1 and CL is on the right. Ground markers have separate short stubs. The entire layout moves down so the large supply connection clears the unchanged drafting text.                                                                                                                                    |
| rc-lowpass         | Wider source/resistor/capacitor spacing; the source's positive lead rises to a supply-style trunk before dropping to R1. The freed out label sits above the longest horizontal leg close to the R1 reference.                                                                                                                                              |
| rc-highpass        | Wider series-capacitor/shunt-resistor arrangement; source positive feed uses a raised trunk. Ground stubs remain separate; drafting stays above the circuit.                                                                                                                                                                                               |
| rlc                | Wider horizontal R/L row with a raised input trunk caused by R4/R12, as explained above. In/out labels are above their selected horizontal legs. Separate ground stubs and drafting remain.                                                                                                                                                                |
| two-stage-symbolic | Wider stages/output/load spacing. The compensation capacitor is one row above the stages; feedback takes a large upper loop with one crossing instead of the compact lower return in the original.                                                                                                                                                         |

## Deviations and open questions

- Status is **partial**: must-fix finding 2 remains incomplete for the
  cleanup-only bulk boundary. All required acceptance commands were run;
  package/full tests remain failing for that explicit requirement. The full
  routed results and review command succeed.
- No out-of-scope Edit Engine/model/protocol/SPICE/app/fixture changes were
  made. No dependency or lockfile changes, generated-file edits, commits,
  pushes, merges, rebases or branch switches were made. The pre-existing
  modifications to plan.md and the supplied review.md were left untouched.
- The temporary attempt to restore bulk endpoints was removed; final (c2)
  uses the R11 frozen groups and never routes B pins. A reviewed cleanup
  naming-authority policy is still needed to satisfy the remaining assertion.
- Existing R14 tests cover blocked trunk routing with clear fallback stubs;
  they do not establish availability of a fallback stub under every possible
  obstacle arrangement. Drafting anchors that move with the layout and
  cannot clear it are refused under R10 rather than looping indefinitely.
- Shared `routing-audit.ts`/`transaction.ts` helpers and the extra metrics.json
  artifact were retained from round 1. No test was deleted, skipped or relaxed.
