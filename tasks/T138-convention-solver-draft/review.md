# T138 review

Implemented by a Claude subagent (Opus), reviewed by the planner; the owner
asked on 2026-11-16 for subagents instead of Codex.

## Round 1 — accepted

The implementation was made on the first commit of T136 (`36b51ef`) and
rebased onto `main` at `8144011` (T136 merged; same source tree) before the
reviewer run. No conflict.

Two existing tests changed, both checked by the reviewer:

- `corpus.test.ts` "common-source" accepts a ground marker 0, 20 or 40 below
  its host (was 20 or 40). The convention draft is now selected there and the
  marker keeps the pin contact it has in the input: its pin coincides only
  with a capacitor pin of the same Net, the Net needs no route, the routing
  audit reports nothing and the test's equivalence, coincident-pin and overlap
  checks pass. R6a (the host the marker touches) and R12 (a licensed contact
  needs no stub) specify this outcome.
- `stack-snap.test.ts`, "plans no-stack Documents exactly as main at 65075a0":
  the shape `twoLoads` has a transistor and R168 now owns its plan, so the R166
  test would have pinned an R168 result. It is replaced by a transistor-free
  `rcDivider`, which R168 never offers the draft to; its hash was recorded from
  a clean build of the base without R168 (which reproduces both earlier pins).
  The `inverter` shape stays: the draft is offered there and not selected.

Reviewer run on the rebased tree: build, typecheck, lint, format:check,
docs:check 0; `pnpm test:local` 0 (818 files, 8448 passed, 117 skipped);
`pnpm test:slow` 0 (2 files, 8 passed); both evaluations 0.

| Plan acceptance line                                 | Result against `main` (`8144011`)                                                                      | State |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| No threw; same 16 refused; equivalent; no defects    | 612 / 16 same; 0 not equivalent; introduced dangling / unconnected / touching 0                        | met   |
| A case that is not eligible keeps its hash           | 100 changed, all of them among the 278 offered the draft; 99 select it                                 | met   |
| Crossings and bends lower                            | 340 → 316; 2301 → 2132                                                                                 | met   |
| Label overlaps, long-narrow not higher               | 3 → 3; long-narrow 83 → 73 (implementer's measure, before the rebase); label-ownership 13 → 12         | met   |
| Cases worse on crossings or bends, listed            | 10; the largest five with reasons in the implementer's report (below)                                  | met   |
| Judged gains of the experiment (20)                  | 17 still the solver's drawing; in 2 the R166 candidate wins, in 1 `layered` (plans as on main)         | met   |
| Planning time, median at most ×1.25                  | ×1.10 interleaved on 40 eligible cases, p90 ×1.32 (implementer); not rerun by the reviewer             | met   |
| Netlist (node 0): 515 equivalent, no defect, no drop | 515 completed and equivalent, no introduced defect; 97 changed; crossings 345 → 326; bends 2217 → 2075 | met   |
| Renders of the first 16 changed cases                | Implementer's set; the reviewer looked at the blind material instead                                   | done  |

The draft is the recorded strategy in 95 of the 100 changed drawing plans and
in 91 of the 97 netlist plans; the others came through its portfolio and ended
from another start.

Blind review (two calibrated reviewers, before/after pairs without version
labels, the 86 changed cases that are neither sealed nor owner-labelled; two
not judgeable): acceptable 26 → 34 of 84; 16 gained, 8 lost. That is weaker
than the experiment promised (10 gained to 2 lost, twice): the base now has
the R166 candidates, and the product keeps original drafts unchanged.

What the lost cases show (reviewers' words): an input or bias terminal ends up
inside the drawing or pointing inward in three of the eight; one output on the
left in a tall narrow drawing; one full adder with long loops; one current
marker detached from its source; two with a device pushed off its place. The
worse-by-count cases named by the implementer are of another kind:
resistor-loaded differential pairs that the symmetry topology does not see
get the draft and come out asymmetric.

Differences to the experiment, accepted: the stack relation is R166's (29
passive-only stacks in 26 cases are no longer objects); the soft pair term is
gone (no eligible case has a non-rigid pair); hierarchical symbols are not
eligible (one case); the draft's runs stay out of the annealer and reroute
portfolios when it is not selected, so originals plan as before.

Open after this task:

- Terminals inside the drawing: the solver places devices only; ports are
  seated afterwards and the input-left term reads device pins. Three of eight
  judged losses.
- Symmetric circuits the topology misses still get the draft.
- The node limit ends 213 of 278 searches; half and double the limit each
  change 4 of 40 plans. The limit is part of the result.
- No circuit above 10 devices exists in the corpus; eligibility stops at 12.

## Round 2 — changes requested (PR review of aabdd1a)

The full review text is in the PR. Fixes were made by the implementer
subagent and were committed in round 2.

| #   | Pri | Finding                                                                  | Resolution                                                                                                                                                                                  |
| --- | --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2  | The draft takes a refinement slot and can beat a better refined original | Measured, then variant X adopted: the draft must also beat `chosen.selected` (`compareRuns < 0`). R168 states the displacement and the extra comparison. Test on the reviewer's reproducer. |
| 2   | P2  | Worse cases and changed cases not listed                                 | Listed below                                                                                                                                                                                |
| 3   | P3  | "99 select it" vs "95 recorded strategy"                                 | Explained below; round 1's "99" was miscounted                                                                                                                                              |
| 4   | P3  | A transistor without an upright pose fell back to rotation 0             | The fallback is removed: the device gets no pose and the solver refuses the draft (existing refusal). Test with a synthetic nmos whose source is never under its drain.                     |
| 5   | P3  | Offset 0 was allowed for every ground marker in `corpus.test.ts`         | 0 is allowed only for a marker whose pin coincides with a pin of its Net in the input document                                                                                              |
| 6   | P3  | The `inverter` pin also covers R168                                      | Comment added in `stack-snap.test.ts`, plus one line on why `twoLoads` left                                                                                                                 |
| 7   | P3  | Report field names                                                       | `offered` was renamed `eligible`. `docs/testing/readability.md` and R168 now say that `selected` is the final recorded strategy.                                                            |
| 8   | P3  | Hierarchical-symbol and 40-instance exclusions had no test               | Two tests added: a hierarchical-port symbol, and 40 vs 41 instances with 4 devices                                                                                                          |

### Round 2 result

**Finding 1: measurement**

- Head `aabdd1a` reproduces the round-1 drawing run on all 100 changed cases
  (plan hashes are equal).
- Variant X was planned on those 100 cases with default search:
  - 98 keep the draft's plan.
  - 2 return to main's plan: gfym3hxbpn and vcfdca5hqp. Both were judged
    needs-improvement before and after.
  - 0 others.
- Crossings and bends on the 100:

  | Planner | Crossings | Bends |
  | ------- | --------- | ----- |
  | main    | 45        | 384   |
  | aabdd1a | 21        | 215   |
  | X       | 21        | 217   |

- Among the 84 judgeable cases the verdict file counts 16 gained and 8 lost;
  a 17th "gained" entry is one of the two cases the reviewers could not judge
  (defective original). Under X all 17 and all 8 lost keep the draft. X loses
  0 gained cases, which is at most 2, so X is adopted.
- X can change only plans in which the draft was selected: the 100 changed
  cases plus 4 whose plan already equalled main's. So no other corpus plan
  moves.
- The reviewer should rerun both evaluations and a blind check of the 2
  returned cases.
- Reproducer (quick mode): with X the plan is `layered` with main's hash
  (`be5323cb…`). Without the X condition it is `convention`. The new test
  fails when the condition is removed.

**Changed drawing cases** (100; 14 restricted, given as a count only; 86
listed):
23wahmw6b2 3byq69ryhz 3tte4aw3tf 5etmybq44s 5nrdf75rpd 5sjds93cfr
63213272-9ba5-442d-88c8-11e4abd514a7 69ksgcs72g 6acrn4nr4v 6c58xn673d
6dwz87zh3j 6ejj2kkc4t 6fhjgjnqq2 6vz3msbhvt 6ztdex4gtw 78f2kqva2z 7nmbghagg3
7qbprrj7bn 85c84m4tjv a2nn9n6pbn ag6jww5e97 b23bz45g2q b5dqwtrbn3 b7v4fcpcfw
bbkez6s3yw bbr8qbcane bv9zwmd835 bxafand9vg c5tctbsh33 c9bv7j22xb chy424wh5v
czmmfvytar d8nv5m7cje den8hdwcyr dhnx9vs3zf dr4e8zhyjg e2dj5fphtt eaejh7b8m2
ebe93ae5-943e-46cc-89e5-886c8c2b8a0e ewh674kmsv frw3b53jtz fs89889q47
ftrjkg4566 fv87gdk257 fyvnex6hn4 gaa8pa8vfh gdkneq9f89 gfym3hxbpn gjjws82g9a
hjtfydjx52 jjm94e9cp8 jkbdeaz3fr jqzavktq25 jzq4wvkwmf k234gfaas6 kw9emv433j
m6rez5w83z mf5c5v8g7s n4byvdcnar nmb7jqwgz3 p2whdap25e pfakspv4kx pskqwzjj2t
pxxj67dmag q5pwp63nfs qf5f4t5p8q qmcytns39z qn9hqksgdb r4dp7mhqar s5zkfkqdsh
sf6e58mmjb sjwfsqd453 sqzs5tv6f6 t7v7m8ps4e thvk3esjhs v4rcysdnav vcfdca5hqp
vkafsqxh8n wde2p3x9h8 wncj74jmhn wyabv9t3jz xtk2ekkzp5 xy58cpp5m8 xyqfyedxrc
z7zzac64t2 z9mewmgkst

**Changed cases worse on crossings or bends** (10; 2 restricted; values are
crossings c and bends b, main → aabdd1a):

- r4dp7mhqar (c 7→3, b 8→18): a full adder drawn as a tangle; ports and
  rails scattered.
- m6rez5w83z (b 2→5): a differential pair with current-source loads that
  the symmetry topology does not see. Drawn compressed, with the outputs
  crossing over.
- sf6e58mmjb (c 0→1, b 7→6): a resistor-loaded, degenerated differential
  pair that the topology misses. Left-right symmetry is lost and an output
  wire is long. This plan came through the draft's portfolio and ended as
  another strategy.
- b23bz45g2q (c 0→1, b 10→5): much more compact; worse on one count only.
- gaa8pa8vfh (c 2→1, b 2→3): trades one bend for one crossing.
- Also worse: ag6jww5e97 (b 7→8, otherwise as main), den8hdwcyr (b 1→2) and
  dr4e8zhyjg (c 1→2, b 10→4).

**Selection counts (finding 3)**

- Round 1's "99 select it" counted the completed plans whose final recorded
  strategy (`refinementMetrics(plan).strategy`) is `convention`. That count
  was taken over all 612 completed cases, not over the 100 changed ones.
  - 95 of those 99 changed.
  - In the other 4 (2 restricted), the finished plan equals main's.
- Of the 100 changed plans:
  - 95 record `convention`.
  - 5 record another strategy: bbr8qbcane, dr4e8zhyjg, fv87gdk257,
    nmb7jqwgz3 and sf6e58mmjb.
- So "99 select it" in the round-1 table was wrong for the changed set. The
  correct statement is: 95 record the draft, and 5 came through it.
- The 5 do not contradict R168, as the review asked. Temporary per-call
  instrumentation in round 1 showed, for bbr8qbcane and dr4e8zhyjg, that the
  draft was selected in the planning call the plan came from. The annealer or
  finishing then ended from another start (layered, or a result without
  metrics). The other 3 (fv87gdk257, nmb7jqwgz3, sf6e58mmjb) were not
  instrumented, so the claim is unverified for them; the PR reviewer's random
  probes found no counter-example.

Reviewer check of round 2: build, typecheck, lint, format:check, docs:check 0;
`pnpm test:local` 0 (818 files, 8452 passed, 117 skipped); `pnpm test:slow` 0
(2 files, 8 passed); both evaluations 0. Against `main` (`8144011`): drawing
98 plans changed, crossings 340 → 316, bends 2301 → 2134, every completed case
equivalent, no introduced dangling wire, unconnected pin or touching pin;
netlist 95 changed, crossings 345 → 326, bends 2217 → 2077, 515 completed and
equivalent. Against round 1 exactly two plans differ in each mode, and both
return to `main`'s plan (drawing: gfym3hxbpn, vcfdca5hqp, judged
needs-improvement before and after), so the blind review of round 1 stands:
of 84 judged cases 26 → 34 acceptable, 16 gained, 8 lost, none of them among
the two.

### Round 2 acceptance

Against `main` (`8144011`), from the reviewer check above. Planning time,
long-narrow, the 20 judged gains and renders were not measured on the round-2
head; the round-1 values above stand, and exactly two plans differ in each
mode.

| Plan acceptance line                                 | Result on the round-2 head                                                       | State        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ |
| No threw; same 16 refused; equivalent; no defects    | every completed case equivalent; introduced dangling / unconnected / touching 0  | met          |
| A case that is not eligible keeps its hash           | 98 changed; X changes only plans in which the draft was selected                 | met          |
| Crossings and bends lower                            | 340 → 316; 2301 → 2134                                                           | met          |
| Label overlaps, long-narrow not higher               | label overlaps 3 → 3; long-narrow not measured on the round-2 head               | not measured |
| Cases worse on crossings or bends, listed            | 10 listed above                                                                  | met          |
| Judged gains of the experiment (20)                  | not measured on the round-2 head (round-1 values above; two plans differ)        | not measured |
| Planning time, median at most ×1.25                  | not measured on the round-2 head (round-1 values above; two plans differ)        | not measured |
| Netlist (node 0): 515 equivalent, no defect, no drop | 515 completed and equivalent; 95 changed; crossings 345 → 326; bends 2217 → 2077 | met          |
| Renders of the first 16 changed cases                | not measured on the round-2 head (round-1 values above; two plans differ)        | not measured |
