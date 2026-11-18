# T136 review

Implemented by a Claude subagent (Opus), reviewed by the planner; the owner
asked on 2026-11-16 for subagents instead of Codex.

## Round 1 — accepted, one acceptance line not met

The implementation was made on `main` at `2b2cf7c` and rebased onto `main` at
`65075a0` (T134 merged) before the reviewer run. Only
`docs/testing/readability.md` conflicted.

Found in the rebase and fixed there: twelve built-in directed blocks have
exactly two pins (buffer, inverter, voltage amplifier, ...), so they are stack
members, and the alignment moves a two-pin part first. A probe turned a
right-facing buffer by 270° to line it up with a drain, against R164. A mover
that R164 keeps facing right now only shifts sideways
(`stack-snap.ts`), with a test that fails without the fix; R166 says so.

Reviewer run on the rebased tree: build, typecheck, lint, format:check,
docs:check 0; `pnpm test:local` 0 (817 files, 8430 passed, 117 skipped);
`pnpm test:slow` 0 (2 files, 8 passed); both evaluations 0.

| Measure (completed cases)                    | drawing input     | netlist input (node 0) |
| -------------------------------------------- | ----------------- | ---------------------- |
| completed / refused                          | 612 / 16 (same)   | 515 / 0                |
| not equivalent                               | 0                 | 0                      |
| introduced dangling / unconnected / touching | 0 / 0 / 0         | 0 / 0 / 0              |
| introduced label-ownership flags             | 12 → 13           | 1 → 1                  |
| plans changed against `main`                 | 61                | 50                     |
| crossings                                    | 334 → 340         | 343 → 345              |
| bends                                        | 2337 → 2301       | 2239 → 2217            |
| wire                                         | −5067             | −4800                  |
| worse on crossings or bends                  | 19 (10 crossings) | 21 (6 crossings)       |

The implementer's numbers on the old base (63 changed; planner-only broken
stacks 236 → 189 in 149 → 122 cases; pair-mirroring misses 15 → 16; long-narrow
87 → 84; planning time median ×1.02, p90 ×1.11 interleaved on 40 cases; the
ablation counts behind every choice in R166) were not rerun on the new base.

**Not met:** "crossings not higher" (+6 in drawing mode, +2 in netlist mode).
Accepted on the blind review below; the line was a proxy for it.

Blind review (two calibrated reviewers, before/after pairs without version
labels, the 55 changed cases that are neither sealed nor owner-labelled; one
not judgeable): acceptable 10 → 20 of 54; 11 gained, 1 lost. Of the 16 judged
cases that are worse on crossings or bends, 3 gained and 1 lost; of the 9 worse
on crossings, 2 gained and 1 lost.

Step 4 of the plan (keep a stack-selected result only when its finished score
is not worse) stays out: on the old base it reverts 22 of 63 changed plans,
among them two cases the reviewers of the experiment judged gained, for about
17% more planning time; the blind review above shows the worse-by-count cases
gain more often than they lose.

Deviations from the plan, accepted:

- `packages/auto-layout/test/search.test.ts` (outside the owned paths): the
  shared `commit` check accepts a licensed R38 pin contact, because an aligned
  load lets R38 close a facing gap in "R66 translates recognized pairs".
- Three of the experiment's eleven gained cases plan exactly as on `main`:
  they had changed only through the larger portfolio, which the plan's
  "original drafts unchanged" removes.
- The capacitor shift is 4 grid steps, not the experiment's 8 (more than 4 was
  used by two drafts of one case).
- `stackColumns.plannerOnly` is null with `--reference` (netlist inputs name
  instances differently).

Open after this task: 34 of the 54 judged cases are still not acceptable
(messy routing and crossings lead the reasons); a finished-result comparison
across strategies remains a candidate if a later change makes it cheaper.

## Round 2 — changes requested (PR review of 36b51ef)

Independent review (Claude Opus): no P1. `packages/auto-layout/src` stays as in
`36b51ef`; this round changes tests and documents only.

| #   | Severity | Where                                        | Finding                                                                                                     | Expected fix                                                                   |
| --- | -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | P2       | `test/stack-snap.test.ts` (search guard)     | Only the guard factory call is checked; removing `keepsAligned(...)` from the pool filter passes all tests  | Search-level test that fails without the filter                                |
| 2   | P2       | `src/auto-layout.ts` ~1191, ~1450            | "Offered but not selected plans as on main" is untested; leaking candidates at either line passes all tests | Test with an offered, valid, unselected candidate; pinned no-stack base hashes |
| 3   | P2       | this record                                  | Several plan Acceptance lines unreported or from the old base                                               | Each line met / unmet / not measured on `65075a0`                              |
| 4   | P3       | `test/search.test.ts` `commit`               | Contact-policy check loosened for all 17 tests; one needs it                                                | Restrict it to that test                                                       |
| 5   | P3       | `src/auto-layout.ts` 1184–1192               | When a candidate wins `select(all)`, main's second original is never refined                                | Optional: compare with `select(ranked)` too                                    |
| 6   | P3       | `src/search.ts`; R166                        | Guard checks proposals from the start's aligned Nets, not routed runs                                       | One sentence in R166                                                           |
| 7   | P3       | tests                                        | `fixedInstanceIds` and `partition.arrangement` untested through `planAutoLayout`                            | One test each                                                                  |
| 8   | P3       | `scripts/lib/stack-columns.mjs`; readability | No test; the doc does not say `stacks` counts the result drawing                                            | Doc sentence (test optional)                                                   |

### Round 2 result

- #1 done: "never evaluates a proposal that breaks the aligned column" plans
  the self-biased stage with 8 annealer evaluations and checks every placement
  the search hands back to `placeDocument` (given state inside search bounds):
  16 proposals, all keep Net a's column. With `keepsAligned` removed from the
  filter, 8 of 16 break it and the test fails; restored.
- #2 done: "plans exactly as without R166 when an offered candidate is not
  selected" (a topology fixture found among random 4–7-device documents)
  checks that `layered+stack` is built, the plan is not a candidate's, the
  output equals the output with `stackPairs` mocked to `[]`, and no
  `reroutePortfolio` call receives a `+stack` run. Fails under each temporary
  edit (`withStacks ? withStacks : select(ranked)`; reroute filter `() => true`);
  restored. A random search of 450 search-mode documents found no case where
  the reroute leak alone changes the output, hence the spy. "plans no-stack
  Documents exactly as main at 65075a0" pins sha256 of two quick plans, recorded
  with `tmp/t136-r2/pin.mjs` from a clean `git archive 65075a0` + `tsc` build
  (sources hash-checked; same hashes from `tmp/review90/base` and from `36b51ef`).
- #3 below. #4 done: `commit(..., contacts)`; only "R66 translates recognized
  pairs" passes `true`. #6 done (R166). #7 done: fixed `m1` stays put; with both
  stack members fixed the output equals the `stackPairs`-mocked output; under
  an explicit floorplan `alignStacks` is never called (it is without the
  arrangement). #8 doc done; the script test stays **open**. #5 stays **open**.

Acceptance on `65075a0` (reports `main-65075a0-*` vs reviewer run of `36b51ef`;
detector runs `tmp/t136-r2/runs/`, base hashes 612/612, new 61/61):

| Plan acceptance line                                         | Result on 65075a0                                                                                                                                                                                                                                                                                                                                                                             | State              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| No threw; same 16 refused; equivalent; no introduced defects | 612 / 16 same; 0 non-equivalent; dangling / unconnected / touching 0                                                                                                                                                                                                                                                                                                                          | met                |
| A case without a broken draft keeps its hash                 | 61 changed (list in the PR 90 reviewer run, `tmp/handoff/t136/status.txt` in the planner's records; below the plan's expected 70–80 because originals are kept bit-identical): 46 flagged, 15 outside; all 61 have a broken stack in an original draft (269 such cases); none changed without one, so no mechanism to explain                                                                 | met                |
| Crossings / bends not higher                                 | 334 → 340 / 2337 → 2301                                                                                                                                                                                                                                                                                                                                                                       | unmet (crossings)  |
| Long-narrow not higher                                       | 85 → 83                                                                                                                                                                                                                                                                                                                                                                                       | met                |
| Pair-mirroring misses ≤ +1                                   | 15 → 16                                                                                                                                                                                                                                                                                                                                                                                       | met                |
| Label overlaps not higher                                    | 3 → 3; label-ownership 12 → 13: s75dft4ssy (layered+stack), label φ1 ends 270 from its Net and 232 from another Net's wire                                                                                                                                                                                                                                                                    | met (flag noted)   |
| Planner-only broken stacks                                   | 235 → 186 objects, 148 → 122 cases                                                                                                                                                                                                                                                                                                                                                            | reported           |
| Worse on crossings or bends ≤ 22                             | 19 (`tmp/t136-r2/worse.txt`); largest five: ecyqst76jd (+2/+2), 6xrx9wwkh9 and at7pdcq4ea (+2/−3), 7d93gjqbw8 (+1/+2), sqzs5tv6f6 (+1/+1). Each finishes with a higher routed score than main (+4196 to +10748): the stack draft ranked first before finishing, finishing reversed it (ecyqst76jd ends on an original layered finalist of the stack path). 5 better on crossings, 28 on bends | met                |
| 11 gained cases keep their stacks in column                  | In column: fwrdbcwvmd, mpddw4ksfx, ph4skdh9v4, sahr77a4gy, sk29mm2ky6, sqzs5tv6f6, xy58cpp5m8 (all judged gained again); qmcytns39z 2 → 1 broken (gained again); as main: 9db5aza768, ecw4mse7vb, xwejn63mbt                                                                                                                                                                                  | unmet (4)          |
| Planning time, interleaved on 40                             | median ×1.006, p90 ×1.10 (83 s → 80 s)                                                                                                                                                                                                                                                                                                                                                        | met                |
| Netlist (node 0)                                             | 515 completed and equivalent, no presentation drop, label-ownership 1 → 1; 50 changed; crossings 343 → 345, bends 2239 → 2217, long-narrow 74 → 71                                                                                                                                                                                                                                            | met (crossings +2) |
| Renders, first 16 changed non-sealed non-forbidden           | `tmp/t136-r2/png16`, notes in `renders.txt`: better 5 (bv9zwmd835, 7nmbghagg3, sahr77a4gy, 89q69jrp8b, xy58cpp5m8), similar 3, mixed 5, worse 3 (p2whdap25e, e77nshjvzt, ftrjkg4566)                                                                                                                                                                                                          | done               |

Reviewer check of round 2: `git diff 36b51ef -- packages/auto-layout/src
scripts` is empty, so the corpus evaluations of round 1 stand; build,
typecheck, lint, format:check, docs:check 0; `pnpm test:local` 0 (817 files,
8434 passed, 117 skipped); `pnpm test:slow` 0 (the two slow files, 8 tests;
the run also picked up the same two files from an untracked scratch copy of
the base under `tmp/`).

The two unmet lines are accepted. Crossings (+6 drawing, +2 netlist): the
blind review of round 1 judged the changed cases 10 → 20 acceptable with one
loss, and the cases worse by count gained more often than they lost. The
gained cases: the three that plan as on `main` changed in the experiment only
through the larger portfolio, which this task removes on purpose; the other
eight were judged gained again, including qmcytns39z, which keeps one of its
two stacks broken (2 → 1).
