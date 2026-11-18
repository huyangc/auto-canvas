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
