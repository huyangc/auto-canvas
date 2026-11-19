# T144 — planner tests stop relying on the 5 s default timeout

- Branch: `task/T144-test-timeouts`
- Base: `main` at `11f3cec` (after T141) — rebase if main moves
- Status: draft — mechanical, needs no design decision

## Goal

Three CI failures in a row have come from the same cause: a test that runs the default planner search, with no explicit timeout, on a runner about four times slower than a laptop. T140 fixed six tests in `block-direction.test.ts`; T142 fixed one in `local-loop-amplifier.test.ts`. There are 83 more.

After this task no test in the repository runs the planner on the 5 s default. The fix is uniform: `60_000` on each test that plans.

## Context

The scan (a throwaway script, not committed) finds 83 tests across `packages/auto-layout/test/` that reference `planAutoLayout`, `planWithSeriesLevels` or `planDocument` and pass no explicit timeout:

```
83 planner tests on the default timeout
attachment-seat.test.ts:64, :174
attachments.test.ts:78, :119, :177, :208, :280
blocker-repair.test.ts:148, :242
branch-columns.test.ts:64, :276, :297
column-rail-trunk.test.ts:50
compact.test.ts:75, :228
corpus.test.ts:61, :810
coupled.test.ts:156, :179, :247, :264, :402, :506, :587
cross-coupled.test.ts:41, :103
device-relocation-search.test.ts:59, :150
follow-drafting-groups.test.ts:125, :303
follow-drafting-labels.test.ts:31
held-out.test.ts:14
layered.test.ts:155
llm-layout.test.ts:108
local-loop-amplifier.test.ts:86, :129, :216, :402, :451
… (the full list is reproducible with the scan in step 1)
```

The repository already has the convention: 17 tests use `}, 60_000);`, including the six T140 added and the one T142 added. `vitest.config.ts` sets no global `testTimeout`, so the Vitest default (5 000 ms) applies.

Two things to know before editing:

- `corpus.test.ts`, `held-out.test.ts`, `layered.test.ts` and others use `it.each(...)`; the timeout goes on the **`it.each` call's closing parenthesis**, not inside the body. A parametrised test is one timeout for all its cases.
- A test that deliberately exercises a **timeout** or a deadline must not get this treatment. Grep for `deadline` and for `stop` before editing each file; if a test asserts a time bound, leave it alone and say so in the report.

## Scope

Owned paths:

- `packages/auto-layout/test/*.test.ts` (timeouts only)

Out of scope:

- Any assertion, fixture, import or test name.
- `vitest.config.ts`. Do not raise the global default — that would hide the problem for every package and slow a genuine hang down to a minute. The task is explicit per test.
- `*.slow.test.ts` files: they are opt-in and already have their own budget.

## Steps

1. **Reproduce the list.** Write a throwaway scan (do not commit it) that reports, for every `packages/**/test/*.test.ts` that mentions the planner, the start line of each test whose closing `});` carries no timeout. Confirm you get 83 and record the exact command in the report.
2. **Skip the timing tests.** Identify every test in that list that asserts a deadline, a stop, or a time bound, and exclude it. Record which and why.
3. **Add the timeouts.** For each remaining test, `}, 60_000);`. For an `it.each(...)` call, the timeout is the second argument to the `it.each` invocation, not a third argument to the inner `it`.
4. **Prove nothing changed but the timeouts.** `git diff` must show only `});` → `}, 60_000);` lines. Check with `git diff -U0 | grep '^[+-]' | grep -v '^[+-][+-]'` and confirm every line is one of those two forms or an `it.each` closing line.
5. **Run the suite twice.** Once as-is, once with an artificially reduced timeout to prove the tests that should now be protected actually are (optional; say whether you did it).
6. **Report the timing.** For the slowest ten of the 83, record their local duration from the test output, so the next person can see which of them are close to the CI budget even at 60 s.

## Acceptance

```bash
pnpm --filter @icm/auto-layout test
pnpm typecheck
pnpm lint
pnpm format:check
```

Behavioral:

- The scan from step 1 reports **0** planner tests on the default timeout.
- `git diff --stat` touches only `*.test.ts` files under `packages/auto-layout/test/`.
- The test count is unchanged (no test may be removed or skipped).

## Notes for the implementer

- This is mechanical. Do not refactor, do not rename, do not reorganise. If a file's layout makes the edit awkward, say so rather than restructuring it.
- If a test turns out to be on the list only because it mentions the planner in a comment, still give it a timeout: the cost is zero and the next person does not have to re-derive whether it plans.
- Times: 60 000 is the convention; do not pick different numbers per file.
