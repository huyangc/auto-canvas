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
