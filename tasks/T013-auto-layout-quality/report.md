# T013 report — round 2

## Summary

Addressed all three must-fix findings from the latest review. R22 now charges
300 per input/output Cell Pin on its unconventional side. R25 captures original
pin contacts, reserves touching marker hosts before id-order pairing, and adds
exact clearance-checked stubs for power contacts that R12 otherwise leaves
unjoined. R26 gives singleton power Nets a clearance-checked outward stub when a
removed Route/Junction owns their naming authority.

All nine corpus and seven held-out documents now commit with preserved terminal
partitions and no non-drafting routing audit problems. The three required
held-out commits succeed. The 30-instance deadtime case now commits in 2614.5 ms,
below the 3 s limit. Accepted held-out metric trade-offs remain documented below.
No commit, branch switch, dependency or lockfile change was made. The supplied
plan.md/review.md were read and left untouched; their pre-existing working-tree
state was preserved.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                            |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Spec includes R18–R26, the revised R22 score, R6a contact precedence and R12 singleton behavior. R7/R8 and T014 references retained.                                                                                                                             |
| 2    | done   | Retained round 1 pin-derived stack pitches, collision repair, Cell Pin side/spacing, and HPWL orientation. Added shared touching-host assignment for placement and routing.                                                                                      |
| 3    | done   | R22 adds named OFF_CONVENTION_WEIGHT=300; two passes, 24-candidate bound, deterministic full replays and fixed-instance exclusion remain.                                                                                                                        |
| 4    | done   | Retained final R23 audit and terminal/name-preservation guards.                                                                                                                                                                                                  |
| 5    | done   | 78 package tests pass. Added symbolic Vout-right assertion, touching-host precedence/reservation tests, physical-contact/name-claim checks for held-out commits, multiple-touching-pin exact stubs, and supply/ground singleton stub plus obstructed-stub tests. |
| 6    | done   | Review script prints and renders all sixteen cases in separate corpus/held-out sections, including before/after metrics, score, candidates and timing.                                                                                                           |
| 7    | done   | Refusal causes, new outcomes, metrics, timing, and visual limits recorded below.                                                                                                                                                                                 |

## Review findings addressed

1. **R22 / symbolic Vout on the left.** The score includes
   `offConvention × 300`, counting input Cell Pins on the right and output Cell
   Pins on the left. The regression failed before the fix (`P12.x=370`,
   `X8.x=650`) and now passes: P12 is right of X8. Fig. 17-19b retains one output
   on each edge and its zero-crossing result; both cases are asserted in the
   corpus. The score's remaining weights are unchanged.
2. **R25 / fd-two-stage lost ground contacts.** Frozen groups now retain their
   original coincident pin pairs, excluding MOS bulk. A shared assignment helper
   reserves touched hosts before pairing other markers by id. The actual input
   pairs are C1.2–GND3.0, C2.2–GND4.0, GND1.0–I2.- and GND2.0–I1.-. All four
   remain physically connected in the committed result; net-tail-1 and net-tail-2
   no longer merge into ground. Other touching power pairs receive exact stub
   targets, using the existing clearance-checked wire planner. The held-out test
   verifies physical components as well as the complete terminal partition. A
   hand-built multi-contact case also caught stub-id reuse when several pairs
   share a source pin (whole-list replay reported a missing Route leg). Exact
   stub ids now include both endpoints; all members stay physically joined.
3. **R26 / common-source-ac missing claim owner.** The frozen singleton
   net-power-vdd7 (R3.1) records that its name claim needs replacement geometry.
   The new stub runs from (620,420) to (620,380). Both original VDD claims now name
   `auto-layout-stub-be3ed66adf3db81e-route` as their owner, retaining id, name,
   scope and power domain. label-VDD7 retains its content and Net at the stub's
   pin endpoint (620,420): R15 leaves a label free at the nearest pin when the
   Net has no horizontal leg. Supply and ground directions, claim transfer,
   label location and clear routing have unit coverage. An obstructed free end
   still yields no edits and an R10 error.

Review note 4: ota-sky130 still gains two bends versus 05276cb; ltc3452 still gains
three crossings. Review note 5: skew remains in the visual table; label collisions
remain a known limit, without a case-specific placement rule.

## Acceptance results

Commands ran from the repository root. Local tests used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline
  → 0; Already up to date; pnpm 11.16.0; lockfile unchanged.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint
  → 0; oxlint: 1926 files, 0 errors, 2483 warnings.
pnpm vitest run packages/auto-layout
  → 0; 78 tests passed in 7 files; duration 10.60 s alongside static checks.
pnpm test:local
  → 0 with approved local socket/database access; 7359 passed, 116 skipped;
     743 files passed, 2 skipped; duration 45.92 s.
pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → 1 from grep; no output, as expected (deadcode has existing main failures).
pnpm build
  → 0; package/app builds completed; existing chunk-size warnings.
pnpm auto-layout:review
  → 0; 9 corpus and 7 held-out SVGs plus index.html; all sixteen commit.
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures
  → 0; empty.
git diff --check
  → 0.
```

The initial sandboxed full-suite run exited 1: 57 failed, 7268 passed, 149 skipped;
17 failed files, 726 passed, 2 skipped, one unhandled error. It reported
`connect EPERM 127.0.0.1:5432` and `listen EPERM 127.0.0.1`. The same command was
rerun with approved loopback/socket access; final results are recorded above.
Logs are `/tmp/t013-round2-test-local.log`,
`/tmp/t013-round2-test-local-approved.log`, `/tmp/t013-round2-build.log` and
`/tmp/t013-round2-review.log`.

## Investigation results

### Metrics against 05276cb

Baseline measurements remain in
`packages/auto-layout/test/baseline-metrics.json`, captured in round 1 before
implementation. The branch's starting auto-layout code matched 05276cb. Each
metric triple is **crossings / bends / wire length**. Baseline Widlar metrics
refer to its unsafe drawing, not an acceptable result. Scores below use the
revised R22 formula, so round 1 scores without the convention term are not
strictly comparable. Candidate counts exclude the default plan. Times are wall
milliseconds from the final review run; the clock never affects decisions.

| Document           | 05276cb                         | Round 2         | Routed score | Candidates | Wall ms |
| ------------------ | ------------------------------- | --------------- | -----------: | ---------: | ------: |
| five-t-ota         | 0 / 2 / 1070                    | 0 / 1 / 1120    |          512 |          4 |   306.7 |
| fig-17-19b         | 2 / 5 / 1280                    | 0 / 0 / 1100    |          710 |          4 |   226.0 |
| two-inverters      | 1 / 2 / 1500                    | 1 / 2 / 1500    |         1350 |          6 |   238.8 |
| differential-stage | 0 / 0 / 360                     | 0 / 0 / 360     |           36 |          4 |    40.3 |
| common-source      | 0 / 2 / 1000                    | 0 / 2 / 1000    |          300 |          0 |    22.5 |
| rc-lowpass         | 0 / 0 / 360                     | 0 / 0 / 360     |           36 |          0 |     8.8 |
| rc-highpass        | 0 / 0 / 360                     | 0 / 0 / 360     |           36 |          0 |     8.6 |
| rlc                | 0 / 0 / 480                     | 0 / 0 / 480     |           48 |          0 |    12.5 |
| two-stage-symbolic | 1 / 3 / 1010                    | 0 / 3 / 1060    |          406 |          6 |   204.7 |
| fd-two-stage       | refused                         | 12 / 13 / 5930  |        13893 |          4 |   449.4 |
| common-source-ac   | refused                         | 2 / 8 / 980     |         2898 |          0 |    32.1 |
| skew               | refused                         | 4 / 4 / 2130    |         4913 |          5 |   328.6 |
| deadtime           | refused                         | 17 / 36 / 7430  |        21343 |         18 |  2614.5 |
| ota-sky130         | 6 / 5 / 2720                    | 3 / 7 / 2520    |        14252 |          4 |   190.7 |
| widlar             | 5 / 14 / 3140; 3 audit problems | 5 / 13 / 3140   |         6614 |          5 |   220.0 |
| ltc3452            | 19 / 28 / 9900                  | 22 / 25 / 10060 |        25506 |         22 |  2756.5 |

All sixteen commits have no non-drafting audit problems. The sole remaining
routing warning is ota-sky130's supply trunk touching PVDD's drawing. Widlar and
LTC3452 have no unrouted warning. Corpus crossings/bends meet every target.
Relative to round 1, symbolic Vout's conventional side costs ten wire units;
two-inverters returns to its baseline two bends rather than putting its output
on the left. Both remain within the explicit corpus targets.

The accepted held-out trade-offs remain: ota-sky130 changes from 6 crossings /
5 bends to 3 / 7, with 200 fewer wire units. LTC3452 changes from 19 / 28 to
22 / 25, with 160 more wire units but its unrouted warning removed. R22's 10000
unrouted penalty drives that score improvement. No weight or rule was tuned to
an individual held-out document, instance id, Reference or symbol beyond the
existing marker/MOS classifications.

### Held-out refusal causes and outcomes

1. **fd-two-stage.** Baseline template association placed two mirror groups on
   the same origins. Round 1's corresponding-channel stack association and
   bounded collision repair remove that collision. The next refusal came from
   marker pairing separating touching current-source negatives and ground,
   causing transform reconciliation to materialize unchecked straight Routes
   and merge the two tail Nets with ground. R25 keeps each marker with its
   touched host; full replay now commits, preserves every original touching
   pair and terminal partition, and passes the routing audit.
2. **common-source-ac.** Baseline marker-host placement put C1-copy-1.2 and
   GND5.0 at (620,580). R24 separates that collision. Round 1 then correctly
   refused because singleton R3.1 had no Route to receive its removed VDD naming
   authority. R26 creates the 40-unit stub, transfers both claims, and preserves
   the power label. It now commits with a clear routing audit.
3. **skew.** Baseline VDD1-copy-1/VDD1 host columns were only 20 units apart,
   overlapping their envelopes. R24 repairs the collision. R25's contact-aware
   marker assignment also changes the drawing without a special case. It
   commits with 4 crossings / 4 bends, down from round 1's 4 / 7. The old ground
   symbol between M2 and M3 is absent in the new rendering, but QA/QB and VDD
   label collisions and retained free drawing content remain visible limits.
4. **deadtime.** Baseline VDD3.P/VDD4.P coincided with C6.1/C1.1. R24 removes
   those collisions. Round 1 then refused an overlapping different-Net replay
   Route. R25's contact-aware host assignment plus bounded refinement now
   produce a clean commit (17 crossings / 36 bends). It evaluates 18 candidates
   in 2614.5 ms, under 3 s; the timing assertion passes.
5. **ota-sky130.** Still commits; three crossings instead of six, with the
   accepted two-bend increase and existing supply-trunk warning.
6. **widlar.** Baseline's failed R1.1–Q1.E route was materialized across R1 and
   another Net during reconciliation. The R23 regression still refuses this
   unsafe orientation, naming the objects. R21's selected orientation commits
   with no warnings or audit problems (5 crossings / 13 bends).
7. **ltc3452.** Still commits; no unrouted warning. The accepted crossing/length
   regression and bend reduction remain as reported above.

### Visual and behavioral verification

Rendered results are in `tmp/auto-layout-review/index.html`, with separate corpus
and held-out sections, sixteen SVGs and `metrics.json`. Inspected raster renders
of five-t-ota, fig-17-19b and two-stage-symbolic: drain columns are straight,
Fig. 17-19b inputs stay level with their gates and outputs use opposite edges,
and X7 has + above − with Vout exiting right of X8. Also inspected fd-two-stage,
common-source-ac and skew; their label/free-drawing limitations remain visible.
The real Edit Engine commit, terminal partition, physical-contact, name-claim and
routing audit checks establish topology/display preservation. This task does
not change or simulate circuit electrical behavior.

## Deviations and open questions

- No unresolved must-fix finding or out-of-scope product change remains.
- The old singleton-claim refusal test was updated for R26's newly authorized
  success behavior. Its rejection protection is retained by the new obstructed
  singleton-stub test; no test was skipped, deleted or weakened to hide a failure.
- Existing lock, fixed-instance, transaction-limit, content, undo, deterministic
  and stable-replanning checks remain intact. Internal helpers stay absent from
  the package's public index; no public signature or dependency changed.
- Accepted metric trade-offs and skew's label placement limits remain review
  considerations. Generic annotation collision avoidance, locks and the editor
  button remain T014/out of scope.
